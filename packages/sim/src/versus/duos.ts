/**
 * VERSUS DUOS: the 2v2 tag-team mode (owner design 2026-10-25, R-DUOS-01; docs/design/2026-10-25-versus-duos.md).
 *
 *   "TAG-TEAM, like Hearthstone Battlegrounds Duos: one combat per round, team vs team. Your board fights first; when
 *    it is wiped, your teammate's board steps in against whatever survived on the other side." SHARED team hearts;
 *    EXACTLY 2v2 (4 players, the 4-seat Versus room); unrated.
 *
 * Owner rulings (2026-10-25: "you have all the rules right except passing should cost 1 gold"):
 *   - TEAMS are seat pairs: p1 + p2 (left of the VS mark) vs p3 + p4 (right).
 *   - 7 hearts PER TEAM. The losing team loses 1 heart, 2 when the winner never needed its second board. A draw costs
 *     nobody. A team at 0 is out; the other team wins.
 *   - WHO FIGHTS FIRST alternates by round (odd rounds p1 / p3, even rounds p2 / p4); either teammate may flip it
 *     during the shop, until the team's first End Turn (the server holds the round's order: `duos_first`).
 *   - The second board's Start of Combat, hero effects and rune / quest mods fire when it steps in; the turn order
 *     carries on and the incoming board starts from its left-most (core `simulate`'s tag-team, R-DUOS-TAGTEAM-01).
 *
 * ONE simulate() per round: team A's first board is simulate's `player`, team B's first board the `enemy`, each
 * side's teammate its `reserve`. The tie-break chair rotates (team A on odd rounds, team B on even ones). An EMPTY
 * first board hands over at once (the teammate's board fights first). Each SEAT lands its own view: its team's side
 * of the fight, carrying only its own board's carry-backs (`duosMemberView`).
 *
 * Bundle-safe: core + content + pure siblings only (rides `versus-resolve`).
 */
import { CARD_INDEX } from '@game/content';
import { makeRng, simulate, type CombatCarryBacks, type CombatResult } from '@game/core';
import type { PreparedCombatSide } from '../state';
import { versusSideOrEmpty } from './combat';
import { carryAsPlayerFields, mirrorForEnemySeat } from './mirror';
import type { VersusGroupSeat } from './group';

export type VersusDuosTeam = 'a' | 'b';
/** The two teams, by seat pair: p1 + p2 vs p3 + p4. */
export const VERSUS_DUOS_TEAMS: Readonly<Record<VersusDuosTeam, readonly [VersusGroupSeat, VersusGroupSeat]>> = {
  a: ['p1', 'p2'],
  b: ['p3', 'p4'],
};
/** Team hearts (owner 2026-10-25: 7 per team). */
export const VERSUS_DUOS_HEARTS = 7;
/** Hearts a loss costs when the winner never needed its second board. */
export const VERSUS_DUOS_STOMP_HEARTS = 2;
/** The Gold a pass costs the sender (owner 2026-10-25: "passing should cost 1 gold"). */
export const VERSUS_DUOS_PASS_GOLD = 1;
/** Server cap on passes per seat per round (Gold bounds it anyway; this bounds a misbehaving client). */
export const VERSUS_DUOS_PASS_CAP = 10;

export const duosTeamOf = (seat: VersusGroupSeat): VersusDuosTeam => (seat === 'p1' || seat === 'p2' ? 'a' : 'b');
export const duosMateOf = (seat: VersusGroupSeat): VersusGroupSeat =>
  ({ p1: 'p2', p2: 'p1', p3: 'p4', p4: 'p3' } as const)[seat];

/** Which seat of each team fights FIRST in `round` by default: the first seats on odd rounds, the second on even. */
export function duosDefaultFirst(round: number): Record<VersusDuosTeam, VersusGroupSeat> {
  return round % 2 === 1 ? { a: 'p1', b: 'p3' } : { a: 'p2', b: 'p4' };
}

/** The tie-break chair (`firstSide`): team A on odd rounds, team B on even ones. */
export const duosChair = (round: number): VersusDuosTeam => (round % 2 === 1 ? 'a' : 'b');

/** The round's fight seed: (matchSeed, round, combat tag, duos salt), the same mixer as `versusCombatSeed`. */
export function versusDuosCombatSeed(matchSeed: number, round: number): number {
  let h = 0x811c9dc5 | 0;
  for (const part of [matchSeed, round, 4 /* TAG.COMBAT */, 0xd005 /* duos salt */]) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 13;
  }
  return h | 0;
}

export interface VersusDuosRoundInput {
  matchSeed: number;
  round: number;
  /** The round's fight order as the server holds it (absent = the default alternation). */
  first?: Partial<Record<VersusDuosTeam, VersusGroupSeat>>;
  /** Each seat's FINAL side for this round (missing / malformed = the empty side). */
  sides: Partial<Record<VersusGroupSeat, unknown>>;
}

export interface VersusDuosRoundResult {
  round: number;
  /** The seat of each team whose board fought first (after an empty first board handed over). */
  first: Record<VersusDuosTeam, VersusGroupSeat>;
  chair: VersusDuosTeam;
  outcome: VersusDuosTeam | 'draw';
  /** The team that loses hearts this round (null on a draw), and how many. */
  losingTeam: VersusDuosTeam | null;
  heartsLost: number;
  /** Team A's view (simulate's `player`) and team B's (the mirror). Each carries `tagTeam` with every member's
   *  carry-backs; a seat lands `duosMemberView(teamView, member)`. */
  aResult: CombatResult;
  bResult: CombatResult;
  /** Side-validation notes for the log (seat → reason), only for sides that were refused. */
  refused: Partial<Record<VersusGroupSeat, string>>;
}

/** Resolve a Duos round's ONE fight. Pure and deterministic: same input, same bytes, in Node and in Deno. */
export function resolveVersusDuosRound(input: VersusDuosRoundInput): VersusDuosRoundResult {
  const refused: Partial<Record<VersusGroupSeat, string>> = {};
  const side = (s: VersusGroupSeat): PreparedCombatSide => {
    const r = versusSideOrEmpty(input.sides[s]);
    if (r.error && r.error !== 'missing') refused[s] = r.error;
    return r.side;
  };
  const sides = { p1: side('p1'), p2: side('p2'), p3: side('p3'), p4: side('p4') };
  const def = duosDefaultFirst(input.round);
  const first: Record<VersusDuosTeam, VersusGroupSeat> = { a: def.a, b: def.b };
  for (const t of ['a', 'b'] as const) {
    const want = input.first?.[t];
    if (want && VERSUS_DUOS_TEAMS[t].includes(want)) first[t] = want;
    // An empty first board hands straight over: the teammate's board fights first.
    if (sides[first[t]].board.length === 0 && sides[duosMateOf(first[t])].board.length > 0) first[t] = duosMateOf(first[t]);
  }
  const A = sides[first.a];
  const A2 = sides[duosMateOf(first.a)];
  const B = sides[first.b];
  const B2 = sides[duosMateOf(first.b)];
  const chair = duosChair(input.round);
  const result = simulate(
    structuredClone(A.board),
    structuredClone(B.board),
    makeRng(versusDuosCombatSeed(input.matchSeed, input.round)),
    CARD_INDEX,
    structuredClone(A.state),
    structuredClone(B.state),
    {
      firstSide: chair === 'a' ? 'player' : 'enemy',
      reserve: {
        player: { board: structuredClone(A2.board), state: structuredClone(A2.state) },
        enemy: { board: structuredClone(B2.board), state: structuredClone(B2.state) },
      },
    },
  );
  const outcome: VersusDuosRoundResult['outcome'] = result.result === 'draw' ? 'draw' : result.result === 'win' ? 'a' : 'b';
  const losingTeam: VersusDuosTeam | null = outcome === 'draw' ? null : outcome === 'a' ? 'b' : 'a';
  // "2 when the winner never needed its second board": the winning side's reserve never stepped in.
  const winnerSide = outcome === 'a' ? 'player' : 'enemy';
  const stomp = outcome !== 'draw' && result.tagTeam?.tagInAt[winnerSide] === undefined;
  const heartsLost = outcome === 'draw' ? 0 : stomp ? VERSUS_DUOS_STOMP_HEARTS : 1;
  return { round: input.round, first, chair, outcome, losingTeam, heartsLost, aResult: result, bResult: mirrorForEnemySeat(result), refused };
}

/** The member index of `seat` in a round: 0 = its board fought first, 1 = it was the reserve. */
export const duosMemberOf = (seat: VersusGroupSeat, first: Record<VersusDuosTeam, VersusGroupSeat>): 0 | 1 =>
  (first[duosTeamOf(seat)] === seat ? 0 : 1);

/**
 * ONE SEAT's view of the round: its team's view of the fight (`player` = its team), with the `player*` carry-back
 * fields replaced by ITS OWN board's (`tagTeam.members.player[member]`; none at all when its board never fought). The
 * events, the outcome and the hearts are the team's. Never mutates.
 */
export function duosMemberView(teamView: CombatResult, member: number): CombatResult {
  const out: Record<string, unknown> = { ...teamView };
  for (const k of Object.keys(out)) if (k.startsWith('player') && k !== 'playerDamage') delete out[k];
  const c: CombatCarryBacks | undefined = teamView.tagTeam?.members.player?.[member];
  return {
    ...(out as unknown as CombatResult),
    playerDeaths: c?.deaths ?? 0,
    enemyDeaths: c?.foeDeaths ?? 0,
    ...(c?.survivorCardIds?.length ? { playerSurvivorCardIds: c.survivorCardIds } : {}),
    ...(c ? carryAsPlayerFields(c) : { playerDeathrattles: 0 }),
    duosMember: member,
  } as CombatResult;
}
