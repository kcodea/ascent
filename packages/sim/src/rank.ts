/**
 * MEDAL RANK — the ladder's rules, as one pure, deterministic resolver (owner decisions 2026-09-20).
 *
 * Six medals × three divisions = 18 divisions (index 0 = Bronze I … 17 = Ascendant III), each 100 points wide.
 * A finished RATED lobby moves the player by its final placement (the placement-award table below) plus, for a
 * 1st place ONLY, the LOBBY-STRENGTH BONUS (owner 2026-09-22, `lobbyStrength.ts`): up to +15 for winning a
 * hard table, never on 2nd to 8th, never negative. No round-wins modifier, no hidden MMR. The rules that make
 * it a *medal* ladder rather than a number:
 *
 *   • PROMOTION GATE. Reaching 100 points does NOT promote — it makes the NEXT rated game a *promotion game*.
 *     Overflow past 100 is discarded (`cappedPoints`); the delta shown is the delta applied.
 *   • DIVISION promotion (Gold I → Gold II) needs a TOP-4 finish in that promotion game. MEDAL promotion
 *     (Gold III → Platinum I) needs a 1st PLACE.
 *   • A WON promotion game lands the player at **`promotionLanding` / 100 in the next division** (10 — owner
 *     2026-09-21; it was 0/100 on 2026-09-20) — NOT the game's award. The 10-point cushion absorbs a 5th (−6)
 *     straight after promoting (4/100, still in the division); a bigger loss still crosses 0 and follows the
 *     demotion rule below (it clamps at 0 and arms the demotion game — never an instant drop).
 *   • A LOST promotion game (5th–8th) applies the normal negative award from 100; the gate reopens when the
 *     player climbs back to 100.
 *   • At a MEDAL gate, a 2nd–4th finish neither promotes nor gains: the player STAYS at 100, still
 *     promotion-ready (`appliedDelta` 0, the award reported in `cappedPoints`). Only 5th–8th drops points.
 *   • THERE ARE NO INSTANT DEMOTIONS (owner 2026-09-21: "Hitting 0 MMR should halt the loss and put you in a
 *     demotion game. You need to then bottom-4 that game to demote." — this WIDENED the 2026-09-20 rule, which
 *     gated only the drop OUT of a medal, to EVERY division). In ANY division above Bronze I, a negative
 *     result that would cross below 0 CLAMPS at 0 (the absorbed loss in `cappedPoints`) and ARMS the gate —
 *     the STORED `demotionReady` flag on the position. It is set ONLY by a loss that lands on 0 (by clamp, or
 *     by exact subtraction: a loss that reaches exactly 0 counts too), cleared by ANY non-negative result,
 *     and never set by a promotion landing: 10/100 after a won promotion is NOT ready — the first loss there
 *     (any loss of 10 or more) clamps at 0 and arms, the second demotes. While armed, the NEXT rated game is
 *     a *demotion game*: a bottom-4 finish (5th–8th) demotes ONE division to the previous division at
 *     **`100 + that game's award`** (5th → 94, 6th → 84, 7th → 72, 8th → 60 — the mirror of the promotion
 *     landing rule; across a medal boundary the previous division is the previous medal's III: Gold I armed,
 *     8th → Silver III 60); a top-4 finish ESCAPES and applies its positive award normally from 0 (3rd → 16).
 *   • BRONZE I floors at 0 with no gate (nothing below it).
 *   • ASCENDANT III is uncapped: points keep climbing past 100, no promotion gate; a negative result there
 *     clamps at 0 and arms like everywhere else (its demotion game drops to Ascendant II).
 *   • No same-game promotion, no multi-division jumps, `highest` never decreases.
 *
 * The SERVER is the authority: `supabase/functions/_shared/lobbyRating.ts` (TypeScript, what the Edge Function
 * checks against) and the `settle_rank` plpgsql function (what actually writes) mirror these rules; the
 * parity test in `packages/ui/src/lobbyRatingParity.test.ts` drives the same fixtures through this file and
 * the shared TS mirror. Change the rules in ALL of them, bump `RANK_RULES.rulesVersion`, and the client +
 * server refuse to settle across a version mismatch instead of silently disagreeing. (The version bump is for
 * a change an OLD client would mis-show or refuse — the client never resolves locally, it adopts the server's
 * result verbatim, so a landing-only change like the 2026-09-21 10-point cushion shipped WITHOUT a bump: an
 * old client only mis-predicts the landing until the server answers.)
 *
 * Pure and side-effect-free: no storage, no `Math.random`, no clock. `resolveRank` throws on an invalid
 * placement or position (callers validate at the boundary — the Edge Function and the SQL both reject first).
 */

// ── Rules (one config object) ─────────────────────────────────────────────────────────────────────────────

export const RANK_MEDALS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant'] as const;
export type RankMedal = (typeof RANK_MEDALS)[number];

export interface RankRules {
  /** Bumped whenever ANY number/gate below changes. The client sends it with every submission and the server
   *  rejects a mismatch (`unsupported_rules`) rather than settling a game under rules the client didn't show. */
  readonly rulesVersion: number;
  /** Medal names, lowest first. */
  readonly medals: readonly RankMedal[];
  /** Divisions per medal (I → II → III, ascending — owner 2026-09-22). */
  readonly divisionsPerMedal: number;
  /** Points per division — the promotion gate sits at exactly this value. */
  readonly divisionPoints: number;
  /** Points by final placement, index 0 = 1st … 7 = 8th. Sums to zero (before the 1st-place strength bonus). */
  readonly placementAwards: readonly number[];
  /** Worst placement that still WINS a division promotion game (top-4). */
  readonly divisionPromotionFinish: number;
  /** Worst placement that still WINS a medal promotion game (1st only). */
  readonly medalPromotionFinish: number;
  /** Worst placement that still ESCAPES a demotion game (top-4 stays; 5th–8th demotes). */
  readonly demotionEscapeFinish: number;
  /** Points a WON promotion game lands on in the next division (owner 2026-09-21: 10, a cushion so a narrow
   *  loss straight after promoting does not demote; it was 0). Never the game's award. */
  readonly promotionLanding: number;
}

export const RANK_RULES: RankRules = Object.freeze({
  rulesVersion: 1,
  medals: RANK_MEDALS,
  divisionsPerMedal: 3,
  divisionPoints: 100,
  placementAwards: Object.freeze([40, 28, 16, 6, -6, -16, -28, -40]),
  divisionPromotionFinish: 4,
  medalPromotionFinish: 1,
  demotionEscapeFinish: 4,
  promotionLanding: 10,
});

/** The medal-ladder season. Season 1 = the course-rating era, 2 = the numeric lobby ladder, 3 = medals.
 *  Everyone starts season 3 at Bronze I 0/100 (owner 2026-09-20); the server's `settle_rank` carries the
 *  same constant and refuses a submission from another season. */
export const RANK_SEASON = 3;

/** Number of divisions under `rules` (18 by default). */
export const rankDivisionCount = (rules: RankRules = RANK_RULES): number => rules.medals.length * rules.divisionsPerMedal;
/** The uncapped top division's index (17 by default). */
export const rankTopDivision = (rules: RankRules = RANK_RULES): number => rankDivisionCount(rules) - 1;

// ── State + result contracts ──────────────────────────────────────────────────────────────────────────────

export interface RankPosition {
  /** Integer 0 … `rankTopDivision()`. */
  divisionIndex: number;
  /** Integer 0 … `divisionPoints` — uncapped only in the top division. */
  points: number;
  /** STORED (owner 2026-09-20, widened 2026-09-21): the demotion gate is ARMED — the next rated game is a
   *  demotion game. Only ever true at exactly 0 points in a division above Bronze I, and only set by a LOSS
   *  that landed there (never by a promotion landing). Absent = false (a `highest` never carries it). */
  demotionReady?: boolean;
}

/** The authoritative per-account ladder state. The server owns it; the client keeps a MIRROR and adopts the
 *  server's copy after every settlement (compare `revision` — a late, older answer must never roll back a
 *  newer one). */
export interface RankedProfile {
  seasonId: number;
  rulesVersion: number;
  /** Monotonic per account: +1 per settled game. */
  revision: number;
  position: RankPosition;
  /** Career best this season by `compareRank` (division first, then points). Never decreases. */
  highest: RankPosition;
}

/** Which gate a promotion game was played at. `'division'` (Gold I → Gold II, top-4 wins) or `'medal'`
 *  (Gold III → Platinum I, 1st wins). Null when the game was not a promotion game. */
export type PromotionKind = 'division' | 'medal' | null;

/** The immutable record of ONE settled game — what the post-game screen animates and what history keeps.
 *  Never recomputed from later rules: it is written once by the server and stored verbatim. */
export interface RankResult {
  runId: string;
  seasonId: number;
  rulesVersion: number;
  revisionBefore: number;
  revisionAfter: number;
  /** Final lobby placement, 1–8. */
  placement: number;
  before: RankPosition;
  after: RankPosition;
  /** The placement's table award (+40 … −40) PLUS the lobby-strength bonus (1st place only), before gates /
   *  caps / floors. `strengthBonus` says how much of it is the bonus. */
  baseDelta: number;
  /** The lobby-strength bonus folded into `baseDelta` (owner 2026-09-22): `round(15 × clamp((s − 55) / 45))`
   *  for a 1st place in a lobby of strength `s`, 0 otherwise. Added BEFORE the gate / cap logic, so a 1st at a
   *  promotion gate still lands on the landing and a 1st near 100 still caps at 100 with the overflow in
   *  `cappedPoints`. Missing on a pre-bonus row → parsed as 0. */
  strengthBonus: number;
  /** The lobby strength the server computed at settle time (0 to 100), when it had the seat keys; null when
   *  the settlement predates the bonus or the keys were not sent. */
  lobbyStrength: number | null;
  /** What actually moved: `rankScalar(after) − rankScalar(before)`. `+promotionLanding` (+10) on a won
   *  promotion game (10/100 in the new division against 100/100 in the old one as a scalar — the landing
   *  cushion, never the award) and 0 on a held medal gate. THIS is the number to show. */
  appliedDelta: number;
  /** Points of the base award that did NOT apply: overflow discarded at the 100 gate, a loss absorbed by the
   *  Bronze I floor, a loss absorbed by the 0 clamp that arms the demotion gate (Gold II 10, 8th → Gold II 0
   *  armed: 30 of the −40), or the whole award held at a medal gate (2nd–4th). 0 on a won promotion (the award
   *  converted into the promotion itself). Always ≥ 0. */
  cappedPoints: number;
  /** The game was played AT a gate (the player started it on exactly 100 below the top division). */
  wasPromotionGame: boolean;
  /** The gate's kind when `wasPromotionGame`, else null. */
  promotionKind: PromotionKind;
  /** The worst placement that passes the gate this game was played at: 4 or 1 for a promotion game (wins
   *  the promotion), 4 for a demotion game (ESCAPES the demotion). Null when the game was not a gate. */
  requiredFinish: number | null;
  /** This game reached 100 → the NEXT rated game is a promotion game. (Never true together with `promoted`.) */
  promotionUnlocked: boolean;
  promoted: boolean;
  /** The game was played AT an armed demotion gate (`before.demotionReady`). A bottom-4 then demotes, a top-4
   *  escapes (and disarms). */
  wasDemotionGame: boolean;
  /** This game ARMED the gate (`after.demotionReady`): a loss clamped at 0 in a division above Bronze I. The
   *  NEXT rated game is a demotion game. Never true after a promotion landing or a demotion game. */
  demotionUnlocked: boolean;
  demoted: boolean;
  /** The career best after this game (division first, then points) — for the profile the client adopts. */
  highestAfter: RankPosition;
}

/** `resolveRank`'s output: the position-level half of a `RankResult` (everything except run/season/revision
 *  bookkeeping, which `settleRank` adds). */
export type RankOutcome = Omit<RankResult, 'runId' | 'seasonId' | 'rulesVersion' | 'revisionBefore' | 'revisionAfter' | 'highestAfter'>;

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────

const ROMAN = ['I', 'II', 'III', 'IV', 'V'] as const;

/** The medal a division index belongs to ("Gold" for 6, 7, 8). */
export function medalOf(divisionIndex: number, rules: RankRules = RANK_RULES): RankMedal {
  const i = Math.floor(clampDivision(divisionIndex, rules) / rules.divisionsPerMedal);
  return rules.medals[i]!;
}

/** The division's numeral WITHIN its medal: 1 (I, the lowest) → 3 (III, the highest). Owner 2026-09-22: the
 *  numerals ASCEND with the climb (Bronze I → Bronze II → Bronze III → Silver I), reversing the 2026-09-20
 *  III → II → I order. Division INDEX is untouched by that flip — 0 is still the floor and 17 still the top,
 *  so nothing stored, compared or settled changes; only the numeral each index prints. */
export function divisionTierOf(divisionIndex: number, rules: RankRules = RANK_RULES): number {
  return (clampDivision(divisionIndex, rules) % rules.divisionsPerMedal) + 1;
}

/** "Gold II" — the ONE label mapping every surface (title, results, Career, Rankings) must share. Accepts a
 *  position or a bare division index. */
export function rankLabel(pos: RankPosition | number, rules: RankRules = RANK_RULES): string {
  const index = typeof pos === 'number' ? pos : pos.divisionIndex;
  return `${medalOf(index, rules)} ${ROMAN[divisionTierOf(index, rules) - 1] ?? String(divisionTierOf(index, rules))}`;
}

/** Derived reporting scalar `100 × divisionIndex + points`. NOT sufficient for ordering (Gold II 100 and
 *  Gold III 0 tie) — sort with `compareRank`. `profile.rating` carries this so legacy numeric surfaces keep
 *  working until they are medal-aware. */
export function rankScalar(pos: RankPosition, rules: RankRules = RANK_RULES): number {
  return rules.divisionPoints * pos.divisionIndex + pos.points;
}

/** Ordering: division first, then points. Negative when `a` is lower than `b`, 0 when equal. */
export function compareRank(a: RankPosition, b: RankPosition): number {
  return a.divisionIndex !== b.divisionIndex ? a.divisionIndex - b.divisionIndex : a.points - b.points;
}

/** Derived, never stored: standing on exactly 100 below the top division. */
export function isPromotionReady(pos: RankPosition, rules: RankRules = RANK_RULES): boolean {
  return pos.divisionIndex < rankTopDivision(rules) && pos.points === rules.divisionPoints;
}

/** The STORED demotion-gate flag, read safely (absent = false). True → the next rated game is a demotion
 *  game: a bottom-4 drops one division, a top-4 stays. Armed only by a loss that lands on 0 in any division
 *  above Bronze I (owner 2026-09-20, widened 2026-09-21); never by merely standing at 0. */
export function isDemotionReady(pos: RankPosition): boolean {
  return pos.demotionReady === true;
}

/** The kind of gate that leaves `divisionIndex` (null from the top division, which has none). */
export function promotionKindAt(divisionIndex: number, rules: RankRules = RANK_RULES): PromotionKind {
  if (divisionIndex >= rankTopDivision(rules)) return null;
  return divisionIndex % rules.divisionsPerMedal === rules.divisionsPerMedal - 1 ? 'medal' : 'division';
}

/** The worst placement that still wins a promotion gate of `kind`. */
export function requiredFinishFor(kind: PromotionKind, rules: RankRules = RANK_RULES): number | null {
  if (kind === 'medal') return rules.medalPromotionFinish;
  if (kind === 'division') return rules.divisionPromotionFinish;
  return null;
}

/** True for every division above Bronze I — everywhere a demotion gate exists (owner 2026-09-21: a loss that
 *  hits 0 in ANY division arms a demotion game; there are no instant demotions). Until 2026-09-21 this was
 *  only a medal's lowest division above Bronze (Silver I, Gold I, …); the name is kept, the reach widened.
 *  `rules` is accepted for signature parity with the other helpers (nothing in it changes the answer). */
export function hasDemotionGate(divisionIndex: number, rules: RankRules = RANK_RULES): boolean {
  return divisionIndex > 0 && divisionIndex <= rankTopDivision(rules);
}

export const initialRankPosition = (): RankPosition => ({ divisionIndex: 0, points: 0, demotionReady: false });

/** A fresh season-start profile: Bronze I 0/100, revision 0. */
export function initialRankedProfile(seasonId: number = RANK_SEASON, rules: RankRules = RANK_RULES): RankedProfile {
  return { seasonId, rulesVersion: rules.rulesVersion, revision: 0, position: initialRankPosition(), highest: initialRankPosition() };
}

/** Structural check for a persisted/remote position (integers, in range; the top division is uncapped). */
export function isRankPosition(x: unknown, rules: RankRules = RANK_RULES): x is RankPosition {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  const d = o.divisionIndex;
  const p = o.points;
  if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > rankTopDivision(rules)) return false;
  if (typeof p !== 'number' || !Number.isInteger(p) || p < 0) return false;
  if (d < rankTopDivision(rules) && p > rules.divisionPoints) return false;
  const r = o.demotionReady;
  if (r !== undefined && typeof r !== 'boolean') return false;
  // The flag may only be armed at 0 points in a division above Bronze I — anything else is corrupt state.
  if (r === true && !(hasDemotionGate(d, rules) && p === 0)) return false;
  return true;
}

/** Structural check for a persisted/remote ranked profile. */
export function isRankedProfile(x: unknown, rules: RankRules = RANK_RULES): x is RankedProfile {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return Number.isInteger(o.seasonId) && Number.isInteger(o.rulesVersion) && Number.isInteger(o.revision)
    && (o.revision as number) >= 0 && isRankPosition(o.position, rules) && isRankPosition(o.highest, rules);
}

function clampDivision(i: number, rules: RankRules): number {
  return Math.min(rankTopDivision(rules), Math.max(0, Math.floor(i)));
}

function assertPlacement(placement: number, rules: RankRules): void {
  if (!Number.isInteger(placement) || placement < 1 || placement > rules.placementAwards.length) {
    throw new RangeError(`rank: placement must be an integer 1–${rules.placementAwards.length}, got ${String(placement)}`);
  }
}

function assertPosition(pos: RankPosition, rules: RankRules): void {
  if (!isRankPosition(pos, rules)) throw new RangeError(`rank: invalid position ${JSON.stringify(pos)}`);
}

// ── The resolver ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Resolve ONE rated game from a position. Pure; identical on the client and (by parity test) the server.
 *
 * Order (owner rules 2026-09-20, demotion widened 2026-09-21):
 *   1. Invalid placement / position → throw (the boundaries reject before this runs).
 *   2. At a promotion gate (points === 100 below the top): a finish at or better than the gate's required
 *      placement promotes ONE division to `promotionLanding`/100 (10). A positive award that does not clear a
 *      MEDAL gate (2nd–4th) HOLDS at 100 (still promotion-ready). A negative award applies normally from 100.
 *   3. At an ARMED demotion gate (`before.demotionReady` — the STORED flag): a bottom-4 (5th–8th) demotes ONE
 *      division to the previous division at `100 + award` (across a medal boundary, the previous medal's III);
 *      a top-4 escapes with its award from 0. Either way the game disarms the flag.
 *   4. Otherwise add the award. A LOSS that lands on 0 (by clamp, or by exact subtraction) in ANY division
 *      above Bronze I stops at 0 and ARMS the gate — never an instant demotion. Below 0 in Bronze I floors
 *      at 0 with no gate. Ascendant III: a non-negative total is uncapped. Elsewhere ≥ 100 → exactly 100 and
 *      promotion-ready (overflow discarded). Every other result (any non-negative award, a promotion landing)
 *      leaves the flag false.
 */
export function resolveRank(before: RankPosition, placement: number, rules: RankRules = RANK_RULES, strength: { bonus?: number; lobbyStrength?: number | null } = {}): RankOutcome {
  assertPlacement(placement, rules);
  assertPosition(before, rules);
  const cap = rules.divisionPoints;
  const top = rankTopDivision(rules);
  // THE LOBBY-STRENGTH BONUS (owner 2026-09-22): 1st place only, never negative, folded into the award BEFORE
  // every branch below — the gate, the cap and the floor all see one number.
  const strengthBonus = placement === 1 ? Math.max(0, Math.round(strength.bonus ?? 0)) : 0;
  const baseDelta = rules.placementAwards[placement - 1]! + strengthBonus;
  const start: RankPosition = { divisionIndex: before.divisionIndex, points: before.points, demotionReady: before.demotionReady === true };

  let after: RankPosition;
  let wasPromotionGame = false;
  let promotionKind: PromotionKind = null;
  let requiredFinish: number | null = null;
  let promotionUnlocked = false;
  let promoted = false;
  let wasDemotionGame = false;
  let demoted = false;

  /** Add `delta` to a NON-gate position: a loss that lands on 0 (by clamp or by exact subtraction) in any
   *  division above Bronze I clamps at 0 and ARMS the demotion gate — it never demotes; Bronze I floors at
   *  0; Ascendant III is uncapped upward; elsewhere cap at 100 (gate unlocked). Every result here is disarmed
   *  except that arming loss. */
  const applyAward = (delta: number): RankPosition => {
    const pts = start.points + delta;
    if (delta < 0 && pts <= 0 && hasDemotionGate(start.divisionIndex, rules)) {
      return { divisionIndex: start.divisionIndex, points: 0, demotionReady: true }; // a loss lands on 0 → ARMED (no instant demotion)
    }
    if (pts < 0) return { divisionIndex: 0, points: 0, demotionReady: false };        // Bronze I floor, no gate (the only division left here)
    if (start.divisionIndex === top) return { divisionIndex: top, points: pts, demotionReady: false }; // Ascendant III: uncapped
    if (pts >= cap) { promotionUnlocked = true; return { divisionIndex: start.divisionIndex, points: cap, demotionReady: false }; }
    return { divisionIndex: start.divisionIndex, points: pts, demotionReady: false };
  };

  if (isPromotionReady(start, rules)) {
    wasPromotionGame = true;
    promotionKind = promotionKindAt(start.divisionIndex, rules);
    requiredFinish = requiredFinishFor(promotionKind, rules);
    if (requiredFinish != null && placement <= requiredFinish) {
      promoted = true;
      after = { divisionIndex: start.divisionIndex + 1, points: rules.promotionLanding, demotionReady: false }; // a won gate starts the next division at the landing (10) — NOT armed
    } else if (baseDelta >= 0) {
      after = { ...start, demotionReady: false }; // MEDAL gate, 2nd–4th: hold at 100, still promotion-ready — no gain, no loss
    } else {
      after = applyAward(baseDelta); // the normal negative award from 100; the gate reopens at 100 again
    }
  } else if (isDemotionReady(start)) {
    wasDemotionGame = true;
    requiredFinish = rules.demotionEscapeFinish;
    if (placement <= requiredFinish) {
      after = applyAward(baseDelta); // escape: the positive award applies normally from 0 — and disarms
    } else {
      demoted = true;                // a bottom-4 drops ONE division at 100 + award (the mirror of the promotion landing; across a medal boundary that is the previous medal's III)
      after = { divisionIndex: start.divisionIndex - 1, points: cap + baseDelta, demotionReady: false };
    }
  } else {
    after = applyAward(baseDelta);
  }

  const appliedDelta = rankScalar(after, rules) - rankScalar(start, rules);
  const cappedPoints = promoted ? 0 : Math.max(0, Math.abs(baseDelta) - Math.abs(appliedDelta));
  const demotionUnlocked = isDemotionReady(after);
  return {
    placement, before: start, after,
    baseDelta, strengthBonus, lobbyStrength: strength.lobbyStrength ?? null,
    appliedDelta, cappedPoints,
    wasPromotionGame, promotionKind, requiredFinish, promotionUnlocked, promoted,
    wasDemotionGame, demotionUnlocked, demoted,
  };
}

/**
 * Settle a game against a whole profile: the resolver plus the bookkeeping (run identity, season, revision,
 * career-best). Returns the immutable result AND the next profile. This is the shape the server's
 * `settle_rank` writes and returns; the client never applies it locally as authority — it adopts the server's
 * copy — but the same function gives tests, tools and a "what would this finish do" preview one truth.
 */
export function settleRank(
  profile: RankedProfile, placement: number, runId: string, rules: RankRules = RANK_RULES,
  strength: { bonus?: number; lobbyStrength?: number | null } = {},
): { result: RankResult; profile: RankedProfile } {
  const outcome = resolveRank(profile.position, placement, rules, strength);
  // `highest` is a plain standing — it never carries the gate flag.
  const highestAfter: RankPosition = compareRank(outcome.after, profile.highest) > 0
    ? { divisionIndex: outcome.after.divisionIndex, points: outcome.after.points, demotionReady: false }
    : { divisionIndex: profile.highest.divisionIndex, points: profile.highest.points, demotionReady: false };
  const result: RankResult = {
    runId, seasonId: profile.seasonId, rulesVersion: rules.rulesVersion,
    revisionBefore: profile.revision, revisionAfter: profile.revision + 1,
    ...outcome,
    highestAfter,
  };
  return {
    result,
    profile: {
      seasonId: profile.seasonId, rulesVersion: rules.rulesVersion, revision: result.revisionAfter,
      position: { ...outcome.after }, highest: highestAfter,
    },
  };
}

/** The identity a rated run submits under: its persisted `runId` (a UUID minted at creation since medals)
 *  or, for older saved games, `String(seed)` — the pre-medal dedupe key, kept so a save from before medals
 *  settles under the id it would always have used. Never regenerated at submit time. */
export function rankedRunIdOf(run: { runId?: string; seed: number }): string {
  return run.runId ?? String(run.seed);
}

/** Parse a `RankPosition` out of an unknown value (a server row / JSON), or null. The stored gate flag is
 *  normalised to an explicit boolean. */
export function parseRankPosition(x: unknown, rules: RankRules = RANK_RULES): RankPosition | null {
  return isRankPosition(x, rules) ? { divisionIndex: x.divisionIndex, points: x.points, demotionReady: x.demotionReady === true } : null;
}

/** Parse a `RankResult` out of an unknown value (the Edge Function's JSON), or null when malformed. */
export function parseRankResult(x: unknown, rules: RankRules = RANK_RULES): RankResult | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const before = parseRankPosition(o.before, rules);
  const after = parseRankPosition(o.after, rules);
  const highestAfter = parseRankPosition(o.highestAfter, rules);
  if (!before || !after || !highestAfter) return null;
  if (typeof o.runId !== 'string' || !Number.isInteger(o.placement) || !Number.isInteger(o.seasonId) || !Number.isInteger(o.rulesVersion)) return null;
  if (!Number.isInteger(o.revisionBefore) || !Number.isInteger(o.revisionAfter)) return null;
  if (!Number.isInteger(o.baseDelta) || !Number.isInteger(o.appliedDelta) || !Number.isInteger(o.cappedPoints)) return null;
  const kind = o.promotionKind === 'division' || o.promotionKind === 'medal' ? o.promotionKind : null;
  // Pre-bonus rows carry neither key: the bonus reads 0 and the strength null (never fabricated).
  const strengthBonus = Number.isInteger(o.strengthBonus) && (o.strengthBonus as number) >= 0 ? (o.strengthBonus as number) : 0;
  const lobbyStrength = typeof o.lobbyStrength === 'number' && Number.isFinite(o.lobbyStrength) ? o.lobbyStrength : null;
  return {
    runId: o.runId, seasonId: o.seasonId as number, rulesVersion: o.rulesVersion as number,
    revisionBefore: o.revisionBefore as number, revisionAfter: o.revisionAfter as number,
    placement: o.placement as number, before, after,
    baseDelta: o.baseDelta as number, strengthBonus, lobbyStrength, appliedDelta: o.appliedDelta as number, cappedPoints: o.cappedPoints as number,
    wasPromotionGame: o.wasPromotionGame === true, promotionKind: kind,
    requiredFinish: Number.isInteger(o.requiredFinish) ? (o.requiredFinish as number) : null,
    promotionUnlocked: o.promotionUnlocked === true, promoted: o.promoted === true,
    wasDemotionGame: o.wasDemotionGame === true, demotionUnlocked: o.demotionUnlocked === true, demoted: o.demoted === true,
    highestAfter,
  };
}

/** Parse a `RankedProfile` out of an unknown value, or null when malformed. */
export function parseRankedProfile(x: unknown, rules: RankRules = RANK_RULES): RankedProfile | null {
  if (!isRankedProfile(x, rules)) return null;
  const position = parseRankPosition(x.position, rules);
  const highest = parseRankPosition(x.highest, rules);
  if (!position || !highest) return null;
  return {
    seasonId: x.seasonId, rulesVersion: x.rulesVersion, revision: x.revision,
    position, highest: { divisionIndex: highest.divisionIndex, points: highest.points, demotionReady: false },
  };
}
