/**
 * VERSUS DUOS: the 2v2 tag-team mode (owner design 2026-10-25, R-DUOS-01; docs/design/2026-10-25-versus-duos.md).
 *
 *   "TAG-TEAM, like Hearthstone Battlegrounds Duos: one combat per round, team vs team. Your board fights first; when
 *    it is wiped, your teammate's board steps in against whatever survived on the other side." SHARED team pool;
 *    EXACTLY 2v2 (4 players, the 4-seat Versus room); unrated.
 *
 * Owner rulings (2026-10-25: "you have all the rules right except passing should cost 1 gold"):
 *   - TEAMS are seat pairs: p1 + p2 (left of the VS mark) vs p3 + p4 (right). Team ids are letters by seat pair
 *     (`duosTeamOf`: p1 + p2 = a, p3 + p4 = b, and on), so a future 4-team Duos (8 seats, owner: "We will likely add 4
 *     team duos at some point") extends the same helpers; today's room and server enforce 2 teams.
 *   - ONE HEALTH POOL PER TEAM (owner 2026-10-26, R-DUOS-HEALTH-01: "The duo gets 30 hp plus the sum of both armors";
 *     7 team hearts until then). The losing team takes the lobby's damage, round-capped, Armor first: the tavern tier
 *     of the winning side's board that ENDED the fight plus its survivors' tiers (`simulate` swaps a side's run context
 *     when its reserve steps in, so its damage already reads that board). A draw costs nobody. A team at 0 is out; the
 *     other team wins. (The old "2 hearts for a stomp" has no Health equivalent: the second board never stepping in
 *     already shows in the damage, as more survivors.)
 *   - PLACEMENT IS BY TEAM (owner: "In duos you only place 1 and 2 in a 2v2"): the winners are both 1st, the losers
 *     both 2nd (with N teams: a team placed by how many teams were still in when it went out).
 *   - WHO FIGHTS FIRST ALTERNATES inside each team, round by round (owner 2026-11-05, R-DUOS-ORDER-01, replacing the
 *     2026-10-25 per-round 50/50): a seeded coin picks round 1, then the teammates take turns. No player can change it.
 *     `duosAlternatingFirst` derives it from the match seed + round + team, so every client, the resolver and a replay
 *     land the same pick, known from the start of the shop. The rail shows it: the top row of a team fights first.
 *   - The second board's Start of Combat, hero effects and rune / quest mods fire when it steps in; the turn order
 *     carries on and the incoming board starts from its left-most (core `simulate`'s tag-team, R-DUOS-TAGTEAM-01).
 *
 * THREE OR FOUR TEAMS (owner 2026-11-06, R-VERSUS-EIGHT-01: "up to 4 teams of 2"): the same tag-team fight, paired over
 * teams by the Group schedule (`versusDuosTeamPairings`: three teams left = one fight and the odd team faces a COPY of
 * another team, never hurting it; four = two fights). `resolveVersusDuosTable` resolves such a round. A two-team match
 * keeps `resolveVersusDuosRound` byte for byte. Teams out in the same round share the lower place.
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
import { hitVitals, stampVersusDamage, versusRoundCap, type VersusVitals } from './vitals';
import { VERSUS_GROUP_SEATS, versusGroupPairings, type VersusGroupEliminations, type VersusGroupSeat } from './group';

/** A team id: a letter per seat pair (a = p1 + p2, b = p3 + p4, ...). The 2v2 round uses a and b. */
export type VersusDuosTeam = 'a' | 'b';
/** Any team of a Duos room: up to four (R-VERSUS-EIGHT-01). */
export type VersusDuosTeamId = 'a' | 'b' | 'c' | 'd';
export const VERSUS_DUOS_TEAM_IDS: readonly VersusDuosTeamId[] = ['a', 'b', 'c', 'd'];
/** The two teams of a 2v2, by seat pair: p1 + p2 vs p3 + p4 (`duosTeamSeats` for any team). */
export const VERSUS_DUOS_TEAMS: Readonly<Record<VersusDuosTeam, readonly [VersusGroupSeat, VersusGroupSeat]>> = {
  a: ['p1', 'p2'],
  b: ['p3', 'p4'],
};
/** The Gold a pass costs the sender (owner 2026-10-25: "passing should cost 1 gold"). */
export const VERSUS_DUOS_PASS_GOLD = 1;
/** Server cap on passes per seat per round (Gold bounds it anyway; this bounds a misbehaving client). Mirrored in SQL. */
export const VERSUS_DUOS_PASS_CAP = 10;

const seatNo = (seat: string): number => Number(seat.slice(1));
/** A seat's team: its seat pair's letter (p1 / p2 = a, p3 / p4 = b, p5 / p6 = c, ...). Mirrors `versus_duos__team`. */
export const duosTeamOf = (seat: VersusGroupSeat): VersusDuosTeamId => String.fromCharCode(97 + Math.floor((seatNo(seat) - 1) / 2)) as VersusDuosTeamId;
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

/** The team member (0 or 1) who fights first in `round` (R-DUOS-ORDER-01): a seeded coin for round 1, then they alternate. */
export function duosFirstMember(matchSeed: number, round: number, team: number): 0 | 1 {
  const opener = makeRng(versusDuosOrderSeed(matchSeed, 1, team)).next() < 0.5 ? 0 : 1;
  return (round % 2 === 1 ? opener : 1 - opener) as 0 | 1;
}

/** WHO FIGHTS FIRST in `round` (R-DUOS-ORDER-01): for each team, the seat whose turn it is (`duosFirstMember`). Pure in
 *  (matchSeed, round, teams): the shop shows it from the start, the resolver fights it, a replay reproduces it. No
 *  player can change it (the old flip is gone). An empty first board still hands over at resolve. */
export function duosAlternatingFirst(matchSeed: number, round: number, teams = 2): Record<VersusDuosTeam, VersusGroupSeat> & Partial<Record<VersusDuosTeamId, VersusGroupSeat>> {
  const out: Record<string, VersusGroupSeat> = {};
  for (let k = 0; k < teams; k++) {
    out[String.fromCharCode(97 + k)] = `p${2 * k + 1 + duosFirstMember(matchSeed, round, k)}` as VersusGroupSeat;
  }
  return out as Record<VersusDuosTeam, VersusGroupSeat> & Partial<Record<VersusDuosTeamId, VersusGroupSeat>>;
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
  /** Each team's shared Health and Armor going INTO the round (`versusVitalsBefore`). Absent (a parity fixture from
   *  before 2026-10-26) = damage is computed and stamped, but no pool is charged. */
  vitals?: Partial<Record<VersusDuosTeam, VersusVitals>>;
}

export interface VersusDuosRoundResult {
  round: number;
  /** The seat of each team whose board fought first (after an empty first board handed over). */
  first: Record<VersusDuosTeam, VersusGroupSeat>;
  chair: VersusDuosTeam;
  outcome: VersusDuosTeam | 'draw';
  /** The team that lost the fight (null on a draw), and the damage its pool takes (the lobby formula, round-capped). */
  losingTeam: VersusDuosTeam | null;
  damage: number;
  /** Each team's pool after the round (only when the input carried `vitals`). */
  vitals?: Partial<Record<VersusDuosTeam, VersusVitals>>;
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
  const sides = Object.fromEntries(VERSUS_GROUP_SEATS.map((s) => [s, side(s)])) as Record<VersusGroupSeat, PreparedCombatSide>;
  const pick = duosAlternatingFirst(input.matchSeed, input.round);
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
  const cap = versusRoundCap(input.round);
  const aResult = stampVersusDamage(result, cap);
  const bResult = stampVersusDamage(mirrorForEnemySeat(result), cap);
  const damage = losingTeam === 'a' ? aResult.playerDamage : losingTeam === 'b' ? bResult.playerDamage : 0;
  let vitals: Partial<Record<VersusDuosTeam, VersusVitals>> | undefined;
  if (input.vitals) {
    vitals = {};
    for (const t of ['a', 'b'] as const) {
      const before = input.vitals[t];
      if (!before) continue;
      vitals[t] = hitVitals(before, losingTeam === t ? damage : 0);
    }
    if (vitals.a) aResult.versusVitals = { ...vitals.a };
    if (vitals.b) bResult.versusVitals = { ...vitals.b };
  }
  return { round: input.round, first, chair, outcome, losingTeam, damage, ...(vitals ? { vitals } : {}), aResult, bResult, refused };
}

// ── THREE OR FOUR TEAMS (R-VERSUS-EIGHT-01) ─────────────────────────────────────────────────────

/** One fight of a table round: team `a` against team `b`, or a COPY of team `b` (team `b` itself fights elsewhere). */
export interface VersusDuosTeamPairing {
  a: VersusDuosTeamId;
  b: VersusDuosTeamId;
  copy: boolean;
}

/** Each team's elimination round (`null` / absent = still in). */
export type VersusDuosEliminations = Partial<Record<VersusDuosTeamId, number | null | undefined>>;

const teamIndex = (t: VersusDuosTeamId): number => t.charCodeAt(0) - 97;
const teamAtSeat = (seat: VersusGroupSeat): VersusDuosTeamId => VERSUS_DUOS_TEAM_IDS[seatNo(seat) - 1]!;

/** The round's team fights: the Group schedule over teams (each team stands in for one Group seat), so every client and
 *  the resolver derive it from the seed-free public state, and "alive at round r" reads as it does for a Group seat. */
export function versusDuosTeamPairings(teams: readonly VersusDuosTeamId[], eliminated: VersusDuosEliminations, round: number): VersusDuosTeamPairing[] {
  const seatOf = (t: VersusDuosTeamId): VersusGroupSeat => VERSUS_GROUP_SEATS[teamIndex(t)]!;
  const elim: VersusGroupEliminations = {};
  for (const t of teams) elim[seatOf(t)] = eliminated[t];
  return versusGroupPairings(teams.map(seatOf), elim, round).map((p) => ({ a: teamAtSeat(p.a), b: teamAtSeat(p.b), copy: p.copy }));
}

/** A table round's fight seed: the 2v2's mixer with the fight index, so no two fights of a round share a seed. */
export function versusDuosTableSeed(matchSeed: number, round: number, fight: number): number {
  let h = 0x811c9dc5 | 0;
  for (const part of [matchSeed, round, 4 /* TAG.COMBAT */, 0xd005 /* duos salt */, fight + 1]) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 13;
  }
  return h | 0;
}

export interface VersusDuosTableInput {
  matchSeed: number;
  round: number;
  /** Every team of the match, in letter order, whatever its state. */
  teams: readonly VersusDuosTeamId[];
  eliminated: VersusDuosEliminations;
  sides: Partial<Record<VersusGroupSeat, unknown>>;
  vitals?: Partial<Record<VersusDuosTeamId, VersusVitals>>;
}

export interface VersusDuosTableFight {
  fight: number;
  /** Each side's board that fought first (after an empty first board handed over). */
  a: VersusGroupSeat;
  b: VersusGroupSeat;
  aTeam: VersusDuosTeamId;
  bTeam: VersusDuosTeamId;
  /** Side b is a copy of team b's boards for this round (never takes damage). */
  copy: boolean;
  chair: 'a' | 'b';
  outcome: 'a' | 'b' | 'draw';
  /** The team that takes this fight's damage, or null (a draw, or the loser is a copy / already out). */
  losingTeam: VersusDuosTeamId | null;
  damage: number;
  aResult: CombatResult;
  bResult: CombatResult;
}

export interface VersusDuosTableResult {
  round: number;
  fights: VersusDuosTableFight[];
  vitals?: Partial<Record<VersusDuosTeamId, VersusVitals>>;
  refused: Partial<Record<VersusGroupSeat, string>>;
}

/** Resolve a round of a 3-4 team match: one tag-team simulate() per fight. Pure and deterministic. */
export function resolveVersusDuosTable(input: VersusDuosTableInput): VersusDuosTableResult {
  const refused: Partial<Record<VersusGroupSeat, string>> = {};
  const sides = new Map<VersusGroupSeat, PreparedCombatSide>();
  for (const t of input.teams) {
    for (const s of duosTeamSeats(t)) {
      const r = versusSideOrEmpty(input.sides[s]);
      if (r.error && r.error !== 'missing') refused[s] = r.error;
      sides.set(s, r.side);
    }
  }
  const order = duosAlternatingFirst(input.matchSeed, input.round, VERSUS_DUOS_TEAM_IDS.length);
  const firstOf = (t: VersusDuosTeamId): VersusGroupSeat => {
    const seat = order[t]!;
    const mate = duosMateOf(seat);
    return sides.get(seat)!.board.length === 0 && sides.get(mate)!.board.length > 0 ? mate : seat;
  };
  const stillIn = (t: VersusDuosTeamId): boolean => input.eliminated[t] == null;
  const chair = duosChair(input.round);
  const cap = versusRoundCap(input.round);
  const fights = versusDuosTeamPairings(input.teams, input.eliminated, input.round).map((p, i): VersusDuosTableFight => {
    const a = firstOf(p.a);
    const b = firstOf(p.b);
    const A = sides.get(a)!;
    const A2 = sides.get(duosMateOf(a))!;
    const B = sides.get(b)!;
    const B2 = sides.get(duosMateOf(b))!;
    const result = simulate(
      structuredClone(A.board),
      structuredClone(B.board),
      makeRng(versusDuosTableSeed(input.matchSeed, input.round, i)),
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
    const boards: Partial<Record<VersusGroupSeat, PreparedCombatSide['board']>> = {};
    for (const s of [...duosTeamSeats(p.a), ...duosTeamSeats(p.b)]) boards[s] = structuredClone(sides.get(s)!.board);
    result.duosBoards = boards;
    result.duosFirst = { a, b } as CombatResult['duosFirst'];
    const outcome: VersusDuosTableFight['outcome'] = result.result === 'draw' ? 'draw' : result.result === 'win' ? 'a' : 'b';
    const lost = outcome === 'a' ? p.b : outcome === 'b' ? p.a : null;
    const losingTeam = lost && !(outcome === 'a' && p.copy) && stillIn(lost) ? lost : null;
    const aResult = stampVersusDamage(result, cap);
    const bResult = stampVersusDamage(mirrorForEnemySeat(result), cap);
    const damage = losingTeam === p.a ? aResult.playerDamage : losingTeam === p.b ? bResult.playerDamage : 0;
    return { fight: i, a, b, aTeam: p.a, bTeam: p.b, copy: p.copy, chair, outcome, losingTeam, damage, aResult, bResult };
  });
  let vitals: Partial<Record<VersusDuosTeamId, VersusVitals>> | undefined;
  if (input.vitals) {
    vitals = {};
    for (const t of input.teams) {
      const before = input.vitals[t];
      if (!before) continue;
      vitals[t] = hitVitals(before, fights.find((f) => f.losingTeam === t)?.damage ?? 0);
    }
    for (const f of fights) {
      if (vitals[f.aTeam]) f.aResult.versusVitals = { ...vitals[f.aTeam]! };
      if (!f.copy && vitals[f.bTeam]) f.bResult.versusVitals = { ...vitals[f.bTeam]! };
    }
  }
  return { round: input.round, fights, ...(vitals ? { vitals } : {}), refused };
}

/** The member index of `seat` in a round: 0 = its board fought first, 1 = it was the reserve. */
export const duosMemberOf = (seat: VersusGroupSeat, first: Record<VersusDuosTeam, VersusGroupSeat>): 0 | 1 =>
  ((first as Partial<Record<string, VersusGroupSeat>>)[duosTeamOf(seat)] === seat ? 0 : 1);

/**
 * ONE SEAT's view of the round: its team's view of the fight (`player` = its team), with the `player*` carry-back
 * fields replaced by ITS OWN board's (`tagTeam.members.player[member]`; none at all when its board never fought). The
 * events, the outcome, the damage and the pool are the team's. Never mutates.
 */
export function duosMemberView(teamView: CombatResult, member: number): CombatResult {
  const out: Record<string, unknown> = { ...teamView };
  // The blow fields are the TEAM's (the team's damage, before and after the cap), like the outcome and the pool.
  for (const k of Object.keys(out)) if (k.startsWith('player') && k !== 'playerDamage' && k !== 'playerDamageUncapped') delete out[k];
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
