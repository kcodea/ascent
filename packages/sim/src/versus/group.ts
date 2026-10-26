/**
 * VERSUS GROUP: the 3-4 player round robin (owner 2026-10-24, R-VERSUS-GROUP-01).
 *
 *   "for versus, how hard would it be to make a 4 player round robin lobby version?" Hearts 7 at first (Health and
 *   Armor since 2026-10-26), last one standing, 3 or 4 players, unrated; "if it's a 3 player game, maybe a player faces a copy of another
 *   player's board instead of a ghost".
 *
 * PAIRING (`versusGroupPairings`) is a pure function of the match's seats and each seat's elimination round, so every
 * client and the resolver derive the same schedule from public data, with nothing stored ahead of a round:
 *
 *   - 4 alive: the three perfect matchings of four players in turn (AB CD, AC BD, AD BC), so everyone meets everyone
 *     once per 3-round cycle before any repeat.
 *   - 3 alive: one real fight, and the odd player faces a COPY of another living player's locked board for that
 *     round. Over a 3-round cycle every pair fights once, every player faces the copy once and every player is copied
 *     once (A-B with C vs copy of A, A-C with B vs copy of C, B-C with A vs copy of B). Nobody faces a copy of
 *     themselves.
 *   - 2 alive: they face each other every round.
 *   - When the living set changes the cycle restarts on the new set, at the first offset whose real pair(s) did not
 *     already fight in the round just played (no immediate rematch when one can be avoided).
 *
 * "Alive at round r" = never eliminated, or eliminated IN round r or later (`eliminatedRound >= r`). A seat that leaves
 * or forfeits during round r's shop is eliminated in round r, so round r's pairing (already shown to everyone) never
 * changes under the players: it fights that round as a GHOST of its last locked board.
 *
 * HEALTH AND ARMOR (owner 2026-10-26, R-VERSUS-HEALTH-01; hearts until then): a fight's loser takes the lobby's
 * damage off the fight's one result, round-capped, Armor first (`vitals.ts`); a draw costs nobody. A COPY never takes
 * damage (damage to a copy does not hurt the copied player) and neither does a ghost (its seat is already out); their
 * wins DO damage the facing player, like a Battlegrounds ghost.
 *
 * ONE simulate() per fight, never a re-run with the sides swapped; side `a` is simulate's `player`, `b` takes the
 * mirrored perspective (as p1/p2 do in 1v1). The tie-break chair rotates: `a` on odd rounds, `b` on even ones.
 *
 * Bundle-safe: core + content + pure siblings only.
 */
import { CARD_INDEX } from '@game/content';
import { makeRng, simulate, type CombatResult } from '@game/core';
import type { PreparedCombatSide } from '../state';
import { versusSideOrEmpty } from './combat';
import { mirrorForEnemySeat } from './mirror';
import { hitVitals, stampVersusDamage, versusRoundCap, type VersusVitals } from './vitals';

export type VersusGroupSeat = 'p1' | 'p2' | 'p3' | 'p4';
export const VERSUS_GROUP_SEATS: readonly VersusGroupSeat[] = ['p1', 'p2', 'p3', 'p4'];

/** One fight of a round. `b` is a copy of seat `b`'s board when `copy` is set (seat `b` itself is not in this fight). */
export interface VersusGroupPairing {
  a: VersusGroupSeat;
  b: VersusGroupSeat;
  copy: boolean;
  /** VERSUS DUOS: a TEAM fight, named by each team's first board (both teammates of each team are in it). */
  duos?: boolean;
}

/** Each seat's elimination round (`null` / absent = still in). */
export type VersusGroupEliminations = Partial<Record<VersusGroupSeat, number | null | undefined>>;

const seatOrder = (s: VersusGroupSeat): number => VERSUS_GROUP_SEATS.indexOf(s);

/** The seats alive at the START of `round`, in seat order. */
export function versusGroupAliveAt(seats: readonly VersusGroupSeat[], elim: VersusGroupEliminations, round: number): VersusGroupSeat[] {
  return [...seats]
    .sort((x, y) => seatOrder(x) - seatOrder(y))
    .filter((s) => { const e = elim[s]; return e == null || e >= round; });
}

/** The cycle of pairings for a living set (see the header), before the epoch offset is applied. */
function cycleFor(alive: readonly VersusGroupSeat[]): VersusGroupPairing[][] {
  const [A, B, C, D] = alive;
  if (alive.length >= 4) {
    return [
      [{ a: A!, b: B!, copy: false }, { a: C!, b: D!, copy: false }],
      [{ a: A!, b: C!, copy: false }, { a: B!, b: D!, copy: false }],
      [{ a: A!, b: D!, copy: false }, { a: B!, b: C!, copy: false }],
    ];
  }
  if (alive.length === 3) {
    return [
      [{ a: A!, b: B!, copy: false }, { a: C!, b: A!, copy: true }],
      [{ a: A!, b: C!, copy: false }, { a: B!, b: C!, copy: true }],
      [{ a: B!, b: C!, copy: false }, { a: A!, b: B!, copy: true }],
    ];
  }
  if (alive.length === 2) return [[{ a: A!, b: B!, copy: false }]];
  return [[]];
}

const pairKey = (x: VersusGroupSeat, y: VersusGroupSeat): string => (seatOrder(x) < seatOrder(y) ? `${x}${y}` : `${y}${x}`);

/**
 * The round's fights, in fight-index order. Deterministic from the seats and their elimination rounds alone (no
 * seed): the schedule is walked from round 1 so the "no immediate rematch" offset of each new living set is known.
 */
export function versusGroupPairings(seats: readonly VersusGroupSeat[], elim: VersusGroupEliminations, round: number): VersusGroupPairing[] {
  let epochKey = '';
  let epochStart = 1;
  let offset = 0;
  let prev: VersusGroupPairing[] = [];
  let cur: VersusGroupPairing[] = [];
  for (let r = 1; r <= round; r++) {
    const alive = versusGroupAliveAt(seats, elim, r);
    const key = alive.join(',');
    const cycle = cycleFor(alive);
    if (key !== epochKey) {
      epochKey = key;
      epochStart = r;
      // The first offset whose real pairs did not fight last round (0 when none avoids it, or at round 1).
      const played = new Set(prev.filter((p) => !p.copy).map((p) => pairKey(p.a, p.b)));
      offset = 0;
      for (let o = 0; o < cycle.length; o++) {
        if (cycle[o]!.every((p) => p.copy || !played.has(pairKey(p.a, p.b)))) { offset = o; break; }
      }
    }
    cur = cycle[(r - epochStart + offset) % cycle.length]!;
    prev = cur;
  }
  return cur.map((p) => ({ ...p }));
}

/** The fight's RNG seed: (matchSeed, round, fight index, combat tag, group salt), the same mixer as `versusCombatSeed`. */
export function versusGroupCombatSeed(matchSeed: number, round: number, fight: number): number {
  let h = 0x811c9dc5 | 0;
  for (const part of [matchSeed, round, fight, 4 /* TAG.COMBAT */, 0x6e05 /* group salt */]) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 13;
  }
  return h | 0;
}

export interface VersusGroupRoundInput {
  matchSeed: number;
  round: number;
  /** Every seat of the match (3 or 4), whatever its state. */
  seats: readonly VersusGroupSeat[];
  /** Each seat's elimination round as the server holds it when the round is resolved. */
  eliminated: VersusGroupEliminations;
  /** Each seat's FINAL side for this round (missing/malformed = the empty side). */
  sides: Partial<Record<VersusGroupSeat, unknown>>;
  /** Each seat still in's Health and Armor going INTO the round (`versusVitalsBefore`). Absent (a parity fixture from
   *  before 2026-10-26) = damage is computed and stamped, but no pools are charged. */
  vitals?: Partial<Record<VersusGroupSeat, VersusVitals>>;
}

export interface VersusGroupFight {
  fight: number;
  a: VersusGroupSeat;
  b: VersusGroupSeat;
  /** `b` is a copy of seat b's locked board for this round (never takes damage). */
  copy: boolean;
  /** Which side held the tie-break (`firstSide`): `a` on odd rounds, `b` on even ones. */
  chair: 'a' | 'b';
  outcome: 'a' | 'b' | 'draw';
  /** The seat that takes this fight's damage, or null (a draw, or the loser is a copy / already out). */
  loser: VersusGroupSeat | null;
  /** The damage `loser` takes (the lobby formula, round-capped); 0 when nobody does. */
  damage: number;
  /** Side a's perspective (simulate's `player`) and side b's (the mirror), each stamped with the cap and its seat's
   *  pools after the round. */
  aResult: CombatResult;
  bResult: CombatResult;
}

export interface VersusGroupRoundResult {
  round: number;
  fights: VersusGroupFight[];
  /** Every charged seat's Health and Armor after the round (only seats the input carried `vitals` for). */
  vitals?: Partial<Record<VersusGroupSeat, VersusVitals>>;
  /** Side-validation notes for the log (seat → reason), only for sides that were refused. */
  refused: Partial<Record<VersusGroupSeat, string>>;
}

/** Resolve every fight of a group round. Pure and deterministic: same input, same bytes, in Node and in Deno. */
export function resolveVersusGroupRound(input: VersusGroupRoundInput): VersusGroupRoundResult {
  const pairings = versusGroupPairings(input.seats, input.eliminated, input.round);
  const refused: Partial<Record<VersusGroupSeat, string>> = {};
  const sides = new Map<VersusGroupSeat, PreparedCombatSide>();
  for (const s of input.seats) {
    const r = versusSideOrEmpty(input.sides[s]);
    if (r.error && r.error !== 'missing') refused[s] = r.error;
    sides.set(s, r.side);
  }
  const stillIn = (s: VersusGroupSeat): boolean => input.eliminated[s] == null;
  const chair: 'a' | 'b' = input.round % 2 === 1 ? 'a' : 'b';
  const cap = versusRoundCap(input.round);
  const fights = pairings.map((p, i): VersusGroupFight => {
    const A = sides.get(p.a)!;
    const B = sides.get(p.b)!;
    const result = simulate(
      structuredClone(A.board),
      structuredClone(B.board),
      makeRng(versusGroupCombatSeed(input.matchSeed, input.round, i)),
      CARD_INDEX,
      structuredClone(A.state),
      structuredClone(B.state),
      { firstSide: chair === 'a' ? 'player' : 'enemy' },
    );
    const outcome: VersusGroupFight['outcome'] = result.result === 'draw' ? 'draw' : result.result === 'win' ? 'a' : 'b';
    const lost = outcome === 'a' ? p.b : outcome === 'b' ? p.a : null;
    const loserIsCopy = outcome === 'a' && p.copy;
    const loser = lost && !loserIsCopy && stillIn(lost) ? lost : null;
    const aResult = stampVersusDamage(result, cap);
    const bResult = stampVersusDamage(mirrorForEnemySeat(result), cap);
    const damage = loser === p.a ? aResult.playerDamage : loser === p.b ? bResult.playerDamage : 0;
    return { fight: i, a: p.a, b: p.b, copy: p.copy, chair, outcome, loser, damage, aResult, bResult };
  });
  // Every seat fights at most once a round (a copy is not its seat), so each charged seat's pools move once.
  let vitals: Partial<Record<VersusGroupSeat, VersusVitals>> | undefined;
  if (input.vitals) {
    vitals = {};
    for (const s of input.seats) {
      const before = input.vitals[s];
      if (!before) continue;
      const hit = fights.find((f) => f.loser === s);
      vitals[s] = hitVitals(before, hit ? hit.damage : 0);
    }
    for (const f of fights) {
      if (vitals[f.a]) f.aResult.versusVitals = { ...vitals[f.a]! };
      if (!f.copy && vitals[f.b]) f.bResult.versusVitals = { ...vitals[f.b]! };
    }
  }
  return { round: input.round, fights, ...(vitals ? { vitals } : {}), refused };
}
