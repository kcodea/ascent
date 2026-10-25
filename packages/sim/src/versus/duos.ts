/**
 * VERSUS DUOS: the 2v2 tag-team mode (owner design 2026-10-25, R-DUOS-01; docs/design/2026-10-25-versus-duos.md).
 *
 *   "TAG-TEAM, like Hearthstone Battlegrounds Duos: one combat per round, team vs team. Your board fights first; when
 *    it is wiped, your teammate's board steps in against whatever survived on the other side." SHARED team hearts;
 *    EXACTLY 2v2 (4 players, the 4-seat Versus room); unrated.
 *
 * Owner rulings (2026-10-25: "you have all the rules right except passing should cost 1 gold"):
 *   - TEAMS are seat pairs: p1 + p2 (left of the VS mark) vs p3 + p4 (right). Team ids are letters by seat pair
 *     (`duosTeamOf`: p1 + p2 = a, p3 + p4 = b, and on), so a future 4-team Duos (8 seats, owner: "We will likely add 4
 *     team duos at some point") extends the same helpers; today's room and server enforce 2 teams.
 *   - 7 hearts PER TEAM. The losing team loses 1 heart, 2 when the winner never needed its second board. A draw costs
 *     nobody. A team at 0 is out; the other team wins.
 *   - PLACEMENT IS BY TEAM (owner: "In duos you only place 1 and 2 in a 2v2"): the winners are both 1st, the losers
 *     both 2nd (with N teams: a team placed by how many teams were still in when it went out).
 *   - WHO FIGHTS FIRST is a 50/50 pick per team per round (owner ruling 2026-10-25, R-DUOS-ORDER-01: "I want the 'who
 *     fights first' to be a 50/50, not a player decision for duos teams. Every round it should say who fights first but
 *     players cannot decide who it is."). `duosRandomFirst` derives it from the match seed + round + team through the one
 *     seeded RNG, so every client, the resolver and a replay land the same pick, known from the start of the shop.
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

/** A team id: a letter per seat pair (a = p1 + p2, b = p3 + p4, ...). The 2v2 round uses a and b. */
export type VersusDuosTeam = 'a' | 'b';
/** The two teams of today's 2v2, by seat pair: p1 + p2 vs p3 + p4 (`duosTeamSeats` for any team). */
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
/** Server cap on passes per seat per round (Gold bounds it anyway; this bounds a misbehaving client). Mirrored in SQL. */
export const VERSUS_DUOS_PASS_CAP = 10;

const seatNo = (seat: string): number => Number(seat.slice(1));
/** A seat's team: its seat pair's letter (p1 / p2 = a, p3 / p4 = b, p5 / p6 = c, ...). Mirrors `versus_duos__team`. */
export const duosTeamOf = (seat: VersusGroupSeat): VersusDuosTeam => String.fromCharCode(97 + Math.floor((seatNo(seat) - 1) / 2)) as VersusDuosTeam;
/** A seat's teammate: the other seat of its pair. Mirrors `versus_duos__mate`. */
export const duosMateOf = (seat: VersusGroupSeat): VersusGroupSeat => `p${seatNo(seat) % 2 === 1 ? seatNo(seat) + 1 : seatNo(seat) - 1}` as VersusGroupSeat;
/** A team's two seats, in seat order. */
export const duosTeamSeats = (team: string): [VersusGroupSeat, VersusGroupSeat] => {
  const k = team.charCodeAt(0) - 97;
  return [`p${2 * k + 1}`, `p${2 * k + 2}`] as [VersusGroupSeat, VersusGroupSeat];
};

/** The seed of a team's fight-order draw: (matchSeed, round, order tag, team index) through the fight seed's mixer,
 *  then a full avalanche (murmur3's finalizer) so neighbouring seeds and rounds draw independently. */
export function versusDuosOrderSeed(matchSeed: number, round: number, team: number): number {
  let h = 0x811c9dc5 | 0;
  for (const part of [matchSeed, round, 0x0f1a /* order tag */, team]) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 13;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
}

/** WHO FIGHTS FIRST in `round` (R-DUOS-ORDER-01): for each team, a 50/50 seeded pick between its two seats. Pure in
 *  (matchSeed, round, teams): the shop shows it from the start, the resolver fights it, a replay reproduces it. No
 *  player can change it (the old flip is gone). An empty first board still hands over at resolve. */
export function duosRandomFirst(matchSeed: number, round: number, teams = 2): Record<VersusDuosTeam, VersusGroupSeat> {
  const out: Record<string, VersusGroupSeat> = {};
  for (let k = 0; k < teams; k++) {
    const heads = makeRng(versusDuosOrderSeed(matchSeed, round, k)).next() < 0.5;
    out[String.fromCharCode(97 + k)] = `p${2 * k + (heads ? 1 : 2)}` as VersusGroupSeat;
  }
  return out as Record<VersusDuosTeam, VersusGroupSeat>;
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
  const pick = duosRandomFirst(input.matchSeed, input.round);
  const first: Record<VersusDuosTeam, VersusGroupSeat> = { a: pick.a, b: pick.b };
  for (const t of ['a', 'b'] as const) {
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
  // Every seat's locked board and the order, by real seat, on the result (perspective-free: the mirror keeps them).
  result.duosBoards = { p1: structuredClone(sides.p1.board), p2: structuredClone(sides.p2.board), p3: structuredClone(sides.p3.board), p4: structuredClone(sides.p4.board) };
  result.duosFirst = { a: first.a as 'p1' | 'p2', b: first.b as 'p3' | 'p4' };
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
