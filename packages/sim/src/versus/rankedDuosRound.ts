/**
 * RANKED DUOS: one round of the four-team table (owner design 2026-10-26; docs/design/2026-10-26-ranked-duos.md
 * section 5.3). Pure and deterministic; bundle-safe (rides `versus-resolve`'s `finalize_ranked_duos`).
 *
 * - PAIRING over TEAMS with the lobby's own rule (`pairRunLobby`, R-LOBBY pairing): a seeded shuffle, an exhaustive
 *   matching that never repeats a pairing within 3 rounds unless nothing else is left, and at an odd count a BYE taken
 *   only by the bottom three (by Health + Armor), fairest first, which fights a GHOST: the most recently fallen team's two
 *   boards from the round it fell, never a ghost it just fought / knocked out unless that is the only one.
 * - Each pairing is ONE tag-team `simulate()` (the `reserve` primitive): each team's first board, then its teammate's
 *   board steps in. An empty first board hands straight over.
 * - Damage is the lobby's: the board that ENDED the fight on the winning side (tier + survivors' tiers), capped by the
 *   lobby round cap, Armor first, then Health. A ghost never loses Health; its win costs the bye team.
 * - A team at 0 is out; teams out in the same round share the LOWER place; if every team still in would go out at once,
 *   the one that entered the round with the most Health + Armor survives (then the team letter). The last team in is 1st.
 *   `maxRounds` (60) is the lobby's stalemate backstop: the teams still in are then placed by Health + Armor.
 */
import { CARD_INDEX } from '@game/content';
import { makeRng, simulate, type BoardMinion, type CombatResult } from '@game/core';
import type { PreparedCombatSide } from '../state';
import { versusSideOrEmpty } from './combat';
import { mirrorForEnemySeat } from './mirror';
import { hitVitals, stampVersusDamage, versusRoundCap, vitalsTotal, type VersusVitals } from './vitals';
import type { RankedDuosTeam } from './rankedDuos';

/** The lobby's no-repeat window (`NO_REPEAT_ROUNDS` in lobby/runLobby.ts). */
export const RANKED_DUOS_NO_REPEAT_ROUNDS = 3;
/** The lobby's stalemate backstop (`DEFAULT_LOBBY_RULES.maxRounds`). */
export const RANKED_DUOS_MAX_ROUNDS = 60;
/** Only the bottom this many teams (by Health + Armor) may take the bye (the lobby's rule). */
const BYE_ELIGIBLE_FROM_BOTTOM = 3;

/** One past meeting: a live fight (`a` vs `b`), or a bye (`bye` fought the ghost `b`, `a` = `bye`). */
export interface RankedDuosEncounter {
  round: number;
  a: string;
  b: string;
  bye?: string;
}

export interface RankedDuosPairingInput {
  seed: number;
  round: number;
  /** The teams still in, in TEAM-LETTER order, with Health + Armor going into the round. */
  alive: readonly { team: string; total: number }[];
  history: readonly RankedDuosEncounter[];
  /** Teams out BEFORE this round, with the round each fell (a ghost's source). */
  fallen: readonly { team: string; eliminatedRound: number }[];
}

export interface RankedDuosPairing {
  pairs: [string, string][];
  bye: string | null;
  /** The ghost the bye team fights (a fallen team), null when there is no bye or no ghost yet. */
  ghost: string | null;
}

/** The ghost `forTeam` would face: the most recently fallen team that is not a rematch, else the most recent. */
function ghostFor(input: RankedDuosPairingInput, forTeam: string): string | null {
  const fallen = input.fallen.filter((f) => f.eliminatedRound < input.round).sort((x, y) => y.eliminatedRound - x.eliminatedRound || (x.team < y.team ? -1 : 1));
  const rematch = (g: { team: string; eliminatedRound: number }): boolean => input.history.some((e) => {
    const between = (e.a === forTeam && e.b === g.team) || (e.b === forTeam && e.a === g.team);
    return between && (e.round === input.round - 1 || e.round === g.eliminatedRound);
  });
  return (fallen.find((g) => !rematch(g)) ?? fallen[0])?.team ?? null;
}

/** The lobby's pairing (`pairRunLobby`) over teams. Pure in its input. */
export function pairRankedDuosTeams(input: RankedDuosPairingInput): RankedDuosPairing {
  const rng = makeRng(input.seed ^ (input.round * 0x9e3779b9));
  const pool = input.alive.map((t) => t.team);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const met = new Map<string, number>();
  const lastMet = new Map<string, number>();
  for (const e of input.history) {
    if (e.bye) continue;
    for (const k of [`${e.a}|${e.b}`, `${e.b}|${e.a}`]) {
      met.set(k, (met.get(k) ?? 0) + 1);
      lastMet.set(k, Math.max(lastMet.get(k) ?? 0, e.round));
    }
  }
  const cost = (a: string, b: string): number => {
    const key = `${a}|${b}`;
    const since = input.round - (lastMet.get(key) ?? -Infinity);
    const recent = since < RANKED_DUOS_NO_REPEAT_ROUNDS ? 1e6 * (RANKED_DUOS_NO_REPEAT_ROUNDS - since) : 0;
    return recent + (met.get(key) ?? 0) * 100 - Math.min(since, 99);
  };
  let bestPairs: [string, string][] = [];
  let bestCost = Infinity;
  const search = (rest: string[], acc: [string, string][], total: number): void => {
    if (total >= bestCost) return;
    if (rest.length < 2) { bestCost = total; bestPairs = [...acc]; return; }
    const [head, ...others] = rest;
    for (let i = 0; i < others.length; i++) {
      acc.push([head!, others[i]!]);
      search(others.filter((_, j) => j !== i), acc, total + cost(head!, others[i]!));
      acc.pop();
    }
  };
  if (pool.length % 2 === 0) {
    search(pool, [], 0);
    return { pairs: bestPairs, bye: null, ghost: null };
  }
  const total = new Map(input.alive.map((t) => [t.team, t.total]));
  const standing = [...pool].sort((a, b) => (total.get(b)! - total.get(a)!) || a.localeCompare(b));
  const eligible = new Set(standing.slice(-BYE_ELIGIBLE_FROM_BOTTOM));
  const byeCount = new Map<string, number>();
  for (const e of input.history) if (e.bye) byeCount.set(e.bye, (byeCount.get(e.bye) ?? 0) + 1);
  const candidates = [...pool].filter((x) => eligible.has(x))
    .sort((a, b) => (byeCount.get(a) ?? 0) - (byeCount.get(b) ?? 0) || a.localeCompare(b));
  let bestTotal = Infinity;
  let out: RankedDuosPairing = { pairs: [], bye: null, ghost: null };
  for (const cand of candidates) {
    bestPairs = [];
    bestCost = Infinity;
    search(pool.filter((x) => x !== cand), [], 0);
    const ghost = ghostFor(input, cand);
    const g = ghost ? input.fallen.find((f) => f.team === ghost)! : null;
    const ghostRematch = g && input.history.some((e) => ((e.a === cand && e.b === g.team) || (e.b === cand && e.a === g.team))
      && (e.round === input.round - 1 || e.round === g.eliminatedRound)) ? 1e6 : 0;
    const t = bestCost + (byeCount.get(cand) ?? 0) * 10_000 + ghostRematch;
    if (t < bestTotal) { bestTotal = t; out = { pairs: bestPairs, bye: cand, ghost }; }
  }
  return out;
}

// ── The round ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** A team as it fights this round (a ghost: as it fought the round it fell). */
export interface RankedDuosTeamSides {
  team: string;
  /** Member 0 and member 1's sides (missing / malformed = the empty side). */
  sides: readonly [unknown, unknown];
  /** The member whose board fights first (before an empty first board hands over). */
  first: 0 | 1;
}

export interface RankedDuosRoundInput {
  matchSeed: number;
  round: number;
  /** Every team still in, letter order, with its pools going INTO the round and its sides. */
  alive: readonly (RankedDuosTeamSides & { vitals: VersusVitals })[];
  /** Fallen teams' sides from the round each fell (ghost material), with that round. */
  fallen: readonly (RankedDuosTeamSides & { eliminatedRound: number })[];
  history: readonly RankedDuosEncounter[];
  /** The team whose fights are stored in full (the live pair); every other fight keeps only its result. */
  liveTeam: string;
}

export interface RankedDuosFight {
  fight: number;
  a: string;
  b: string;
  /** `b` is a ghost (a fallen team's boards); it never loses Health. */
  ghost: boolean;
  chair: 'a' | 'b';
  outcome: 'a' | 'b' | 'draw';
  /** The team that lost Health this fight (null on a draw or a beaten ghost), and how much (capped). */
  loser: string | null;
  damage: number;
  /** Each fighting team's member who fought first (after an empty-board hand-over). */
  first: Record<string, 0 | 1>;
  /** The live team's view of its own fight (`player` = the live team), with every member's carry-backs. */
  liveResult?: CombatResult;
}

export interface RankedDuosRoundResult {
  round: number;
  pairing: RankedDuosPairing;
  fights: RankedDuosFight[];
  /** Every team still in going in: its pools after the round. */
  vitals: Record<string, VersusVitals>;
  /** Teams placed this round (out, or the last one standing / the backstop), with their place. */
  placed: { team: string; placement: number }[];
  /** The live team's first member this round (for the duo run's recorded order), when it fought. */
  liveFirst: 0 | 1 | null;
  /** Side-validation notes (team:member -> reason) for refused sides. */
  refused: Record<string, string>;
}

/** A team member's SEAT as the client sees it: the live pair (`a`) are p1 / p2; a recorded team has stable virtual
 *  seats by its letter (b = p3 / p4, c = p5 / p6, d = p7 / p8), so every Duos helper (`duosTeamOf`, `duosMateOf`) reads
 *  it unchanged. */
export function rankedDuosSeatOf(team: string, member: 0 | 1): string {
  const k = team.charCodeAt(0) - 97;
  return `p${2 * k + 1 + member}`;
}

/** A fight's seed: (matchSeed, round, combat tag, ranked salt, fight index), the Versus mixer. */
export function rankedDuosCombatSeed(matchSeed: number, round: number, fight: number): number {
  let h = 0x811c9dc5 | 0;
  for (const part of [matchSeed, round, 4 /* TAG.COMBAT */, 0x7d05 /* ranked duos salt */, fight]) {
    h = Math.imul(h ^ (part | 0), 0x01000193);
    h ^= h >>> 13;
  }
  return h | 0;
}

export function resolveRankedDuosRound(input: RankedDuosRoundInput): RankedDuosRoundResult {
  const refused: Record<string, string> = {};
  const sidesOf = (t: RankedDuosTeamSides): { first: PreparedCombatSide; second: PreparedCombatSide; firstMember: 0 | 1; members: [PreparedCombatSide, PreparedCombatSide] } => {
    const s = t.sides.map((raw, i) => {
      const r = versusSideOrEmpty(raw);
      if (r.error && r.error !== 'missing') refused[`${t.team}:${i}`] = r.error;
      return r.side;
    }) as [PreparedCombatSide, PreparedCombatSide];
    let firstMember = t.first;
    // An empty first board hands straight over.
    if (s[firstMember].board.length === 0 && s[1 - firstMember]!.board.length > 0) firstMember = (1 - firstMember) as 0 | 1;
    return { first: s[firstMember], second: s[1 - firstMember]!, firstMember, members: s };
  };
  const pairing = pairRankedDuosTeams({
    seed: input.matchSeed, round: input.round,
    alive: input.alive.map((t) => ({ team: t.team, total: vitalsTotal(t.vitals) })),
    history: input.history,
    fallen: input.fallen.map((f) => ({ team: f.team, eliminatedRound: f.eliminatedRound })),
  });
  const byTeam = new Map<string, RankedDuosTeamSides>([...input.alive, ...input.fallen].map((t) => [t.team, t]));
  const cap = versusRoundCap(input.round);
  const before = new Map(input.alive.map((t) => [t.team, t.vitals]));
  const after = new Map(input.alive.map((t) => [t.team, { ...t.vitals }]));
  const fights: RankedDuosFight[] = [];
  const matchups: [string, string, boolean][] = pairing.pairs.map(([a, b]) => [a, b, false]);
  if (pairing.bye && pairing.ghost) matchups.push([pairing.bye, pairing.ghost, true]);
  let liveFirst: 0 | 1 | null = null;

  matchups.forEach(([a, b, ghost], fight) => {
    const A = sidesOf(byTeam.get(a)!);
    const B = sidesOf(byTeam.get(b)!);
    const chair: 'a' | 'b' = input.round % 2 === 1 ? 'a' : 'b';
    const result = simulate(
      structuredClone(A.first.board), structuredClone(B.first.board),
      makeRng(rankedDuosCombatSeed(input.matchSeed, input.round, fight)), CARD_INDEX,
      structuredClone(A.first.state), structuredClone(B.first.state),
      {
        firstSide: chair === 'a' ? 'player' : 'enemy',
        reserve: {
          player: { board: structuredClone(A.second.board), state: structuredClone(A.second.state) },
          enemy: { board: structuredClone(B.second.board), state: structuredClone(B.second.state) },
        },
      },
    );
    // The live team's fight carries every board and the order by SEAT, perspective-free (the Versus Duos shape, so the
    // Duos client plays it unchanged): the live pair are p1 / p2, a recorded team its stable virtual seats
    // (`rankedDuosSeatOf`: b = p3 / p4, c = p5 / p6, d = p7 / p8).
    if (a === input.liveTeam || b === input.liveTeam) {
      const boards: Record<string, BoardMinion[]> = {};
      for (const [team, t] of [[a, A], [b, B]] as const) {
        t.members.forEach((m, i) => { boards[rankedDuosSeatOf(team, i as 0 | 1)] = structuredClone(m.board); });
      }
      const live = a === input.liveTeam ? A : B;
      const foe = a === input.liveTeam ? b : a;
      const foeT = a === input.liveTeam ? B : A;
      result.duosBoards = boards as CombatResult['duosBoards'];
      result.duosFirst = { a: rankedDuosSeatOf(input.liveTeam, live.firstMember), b: rankedDuosSeatOf(foe, foeT.firstMember) } as CombatResult['duosFirst'];
    }
    const outcome: RankedDuosFight['outcome'] = result.result === 'draw' ? 'draw' : result.result === 'win' ? 'a' : 'b';
    const aView = stampVersusDamage(result, cap);
    const bView = stampVersusDamage(mirrorForEnemySeat(result), cap);
    let loser: string | null = outcome === 'draw' ? null : outcome === 'a' ? b : a;
    if (ghost && loser === b) loser = null; // a ghost never loses Health
    const damage = loser === a ? aView.playerDamage : loser === b ? bView.playerDamage : 0;
    if (loser) after.set(loser, hitVitals(after.get(loser)!, damage));
    const out: RankedDuosFight = { fight, a, b, ghost, chair, outcome, loser, damage, first: { [a]: A.firstMember, [b]: B.firstMember } };
    if (a === input.liveTeam || b === input.liveTeam) {
      const view = a === input.liveTeam ? aView : bView;
      out.liveResult = { ...view, ...(after.get(input.liveTeam) ? { versusVitals: { ...after.get(input.liveTeam)! } } : {}) };
      liveFirst = a === input.liveTeam ? A.firstMember : B.firstMember;
    }
    fights.push(out);
  });

  // Placement (the lobby's rules).
  const placed: { team: string; placement: number }[] = [];
  const aliveIn = input.alive.map((t) => t.team);
  let dead = aliveIn.filter((t) => after.get(t)!.health <= 0);
  if (dead.length === aliveIn.length && aliveIn.length > 0) {
    // Everyone would go out: the team that entered with the most Health + Armor survives.
    const survivor = [...aliveIn].sort((x, y) => vitalsTotal(before.get(y)!) - vitalsTotal(before.get(x)!) || x.localeCompare(y))[0]!;
    dead = dead.filter((t) => t !== survivor);
  }
  for (const t of dead) placed.push({ team: t, placement: aliveIn.length });
  const still = aliveIn.filter((t) => !dead.includes(t));
  if (still.length === 1) placed.push({ team: still[0]!, placement: 1 });
  else if (still.length > 1 && input.round >= RANKED_DUOS_MAX_ROUNDS) {
    [...still].sort((x, y) => vitalsTotal(after.get(y)!) - vitalsTotal(after.get(x)!) || x.localeCompare(y))
      .forEach((t, i) => placed.push({ team: t, placement: i + 1 }));
  }
  return { round: input.round, pairing, fights, vitals: Object.fromEntries(after), placed, liveFirst, refused };
}

/** Which teams a round's teams map to, by letter (helper for callers that index by `RankedDuosTeam`). */
export const isRankedDuosTeam = (t: string): t is RankedDuosTeam => t === 'a' || t === 'b' || t === 'c' || t === 'd';
