/**
 * SERVER-SIDE medal rank — the rules mirror the `submit-rating` Edge Function checks the database's answer
 * against (2026-09-20).
 *
 * The AUTHORITATIVE write is the `settle_rank` plpgsql function (schema.sql / the medal-rank migration): it
 * locks the profile row, dedupes against the `rank_results` ledger, resolves and commits in ONE transaction.
 * This file is the same rules in TypeScript, byte-for-byte in behaviour with `packages/sim/src/rank.ts`
 * (`resolveRank`): the client's parity test (`packages/ui/src/lobbyRatingParity.test.ts`) drives the same
 * fixtures through both, and the Edge Function re-derives every settlement here and flags a `parity: false`
 * in its response if the SQL ever disagrees — so a rules edit that misses one of the three copies is caught
 * in CI (TS ↔ TS) and at runtime (TS ↔ SQL) rather than silently writing a different ladder.
 *
 * Deno module (no npm) — dependency-free so it bundles cleanly into the function AND imports into the repo's
 * Node test without a runtime bridge. Change the numbers here, in `rank.ts`, and in `settle_rank` together,
 * and bump `RANK_RULES_VERSION` in all three when an OLD client would mis-show or refuse the result (the
 * client never resolves locally, so the 2026-09-21 landing change from 0 to 10 and the same day's widening of
 * the demotion gate to every division both shipped without a bump).
 */

export const RANK_SEASON = 3;
export const RANK_RULES_VERSION = 1;
export const RANK_DIVISION_POINTS = 100;
export const RANK_DIVISIONS_PER_MEDAL = 3;
export const RANK_TOP_DIVISION = 17;
/** Points by final placement, index 0 = 1st … 7 = 8th. MUST equal `RANK_RULES.placementAwards` in the sim. */
export const RANK_PLACEMENT_AWARDS: readonly number[] = [40, 28, 16, 6, -6, -16, -28, -40];
/** Worst placement that still wins a DIVISION promotion game (top-4). */
export const RANK_DIVISION_PROMOTION_FINISH = 4;
/** Worst placement that still wins a MEDAL promotion game (1st only). */
export const RANK_MEDAL_PROMOTION_FINISH = 1;
/** Worst placement that still ESCAPES a demotion game (top-4 stays; 5th–8th demotes). */
export const RANK_DEMOTION_ESCAPE_FINISH = 4;
/** Points a WON promotion game lands on in the next division (owner 2026-09-21: 10, a cushion so a narrow
 *  loss straight after promoting does not demote; it was 0). MUST equal `RANK_RULES.promotionLanding`. */
export const RANK_PROMOTION_LANDING = 10;

// ── LOBBY STRENGTH + the 1st-place bonus (owner 2026-09-22) — mirror of packages/sim/src/lobbyStrength.ts ──
// The strength of a table is the mean over the seven opponent seats of each seat's SMOOTHED win rate from the
// `run_fight_records` view: `(wins + 10) / (fights + 20)` (an unserved run reads 0.5), a generated seat
// (`bot:` key) a fixed 0.25; `round(100 × mean)`. A 1st place in a lobby of strength `s` adds
// `round(15 × clamp((s − 55) / 45, 0, 1))` to its award BEFORE the gate / cap logic. `settle_rank` computes
// the same number in SQL from the same view; MUST equal the sim's constants.
export const STRENGTH_PRIOR_WINS = 10;
export const STRENGTH_PRIOR_FIGHTS = 20;
export const STRENGTH_BOT_RATE = 0.25;
export const STRENGTH_BONUS_MAX = 15;
export const STRENGTH_BONUS_FLOOR = 55;
export const STRENGTH_BONUS_SPAN = 100 - STRENGTH_BONUS_FLOOR;
/** Tier cuts (labels only; the bonus reads the number): Easy < 35, Even 35–54, Hard 55–69, Brutal ≥ 70. */
export const STRENGTH_TIER_EVEN = 35;
export const STRENGTH_TIER_HARD = 55;
export const STRENGTH_TIER_BRUTAL = 70;

export interface StrengthInput { key: string; fights: number; wins: number }

export const seatStrengthRate = (i: StrengthInput): number => {
  if (i.key.startsWith('bot:')) return STRENGTH_BOT_RATE;
  const fights = Math.max(0, i.fights);
  const wins = Math.min(fights, Math.max(0, i.wins));
  return (wins + STRENGTH_PRIOR_WINS) / (fights + STRENGTH_PRIOR_FIGHTS);
};

/** 0–100; an empty list (no opponents known) reads 50. */
export function lobbyStrengthValue(inputs: readonly StrengthInput[]): number {
  const mean = inputs.length === 0 ? 0.5 : inputs.reduce((sum, i) => sum + seatStrengthRate(i), 0) / inputs.length;
  return Math.max(0, Math.min(100, Math.round(100 * mean)));
}

export function strengthTierOf(value: number): 'Easy' | 'Even' | 'Hard' | 'Brutal' {
  return value >= STRENGTH_TIER_BRUTAL ? 'Brutal' : value >= STRENGTH_TIER_HARD ? 'Hard' : value >= STRENGTH_TIER_EVEN ? 'Even' : 'Easy';
}

/** The 1st-place bonus at strength `value`; 0 for every other placement and for a null strength. */
export function strengthBonusOf(value: number | null | undefined, placement: number): number {
  if (placement !== 1 || value == null || !Number.isFinite(value)) return 0;
  const t = Math.max(0, Math.min(1, (value - STRENGTH_BONUS_FLOOR) / STRENGTH_BONUS_SPAN));
  return Math.round(STRENGTH_BONUS_MAX * t);
}

export interface RankPosition { divisionIndex: number; points: number; demotionReady?: boolean }

export interface RankOutcome {
  placement: number;
  before: RankPosition;
  after: RankPosition;
  baseDelta: number;
  /** The 1st-place lobby-strength bonus folded into `baseDelta` (0 otherwise). */
  strengthBonus: number;
  appliedDelta: number;
  cappedPoints: number;
  wasPromotionGame: boolean;
  promotionKind: 'division' | 'medal' | null;
  requiredFinish: number | null;
  promotionUnlocked: boolean;
  promoted: boolean;
  wasDemotionGame: boolean;
  demotionUnlocked: boolean;
  demoted: boolean;
}

export const rankScalar = (p: RankPosition): number => RANK_DIVISION_POINTS * p.divisionIndex + p.points;

/** The STORED demotion-gate flag (absent = false): armed only by a loss that lands on 0 in any division above
 *  Bronze I (owner 2026-09-20, widened to every division 2026-09-21); cleared by any non-negative result;
 *  never set by a promotion landing. */
export const isDemotionReady = (p: RankPosition): boolean => p.demotionReady === true;
/** Every division above Bronze I has a demotion gate (there are no instant demotions). */
const hasDemotionGate = (d: number): boolean => d > 0 && d <= RANK_TOP_DIVISION;

/** True for a placement the ladder accepts (an integer 1–8). */
export const isValidPlacement = (p: unknown): p is number =>
  typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= RANK_PLACEMENT_AWARDS.length;

/**
 * Resolve ONE rated game — identical to `resolveRank` in the sim and to the branches of `settle_rank`:
 *   • at a gate (100 below the top): placement ≤ required (4 division / 1 medal) → promote to the landing
 *     (10/100) of the next division; a positive award short of a MEDAL gate holds at 100; a negative award
 *     applies from 100.
 *   • at an ARMED demotion gate (`before.demotionReady`): a bottom-4 demotes ONE division to the previous
 *     division at `100 + award` (across a medal boundary, the previous medal's III); a top-4 escapes with its
 *     award from 0 (and disarms).
 *   • otherwise add the award: a LOSS landing on 0 (by clamp or exact subtraction) in ANY division above
 *     Bronze I clamps at 0 and ARMS the gate — there are no instant demotions (owner 2026-09-21); Bronze I
 *     floors at 0; Ascendant III is uncapped upward; elsewhere ≥ 100 → exactly 100 + promotion unlocked. A
 *     promotion landing is never armed.
 */
export function resolveRankOutcome(before: RankPosition, placement: number, bonus = 0): RankOutcome {
  if (!isValidPlacement(placement)) throw new RangeError(`placement ${String(placement)}`);
  const cap = RANK_DIVISION_POINTS;
  const top = RANK_TOP_DIVISION;
  const strengthBonus = placement === 1 ? Math.max(0, Math.round(bonus)) : 0; // 1st only, never negative, before every branch
  const baseDelta = RANK_PLACEMENT_AWARDS[placement - 1]! + strengthBonus;
  const start: RankPosition = { divisionIndex: before.divisionIndex, points: before.points, demotionReady: before.demotionReady === true };
  let after: RankPosition;
  let wasPromotionGame = false;
  let promotionKind: 'division' | 'medal' | null = null;
  let requiredFinish: number | null = null;
  let promotionUnlocked = false;
  let promoted = false;
  let wasDemotionGame = false;
  let demoted = false;

  const applyAward = (delta: number): RankPosition => {
    const pts = start.points + delta;
    if (delta < 0 && pts <= 0 && hasDemotionGate(start.divisionIndex)) {
      return { divisionIndex: start.divisionIndex, points: 0, demotionReady: true }; // a loss lands on 0 → ARMED (no instant demotion)
    }
    if (pts < 0) return { divisionIndex: 0, points: 0, demotionReady: false };        // Bronze I floor, no gate
    if (start.divisionIndex === top) return { divisionIndex: top, points: pts, demotionReady: false }; // Ascendant III: uncapped
    if (pts >= cap) { promotionUnlocked = true; return { divisionIndex: start.divisionIndex, points: cap, demotionReady: false }; }
    return { divisionIndex: start.divisionIndex, points: pts, demotionReady: false };
  };

  if (start.divisionIndex < top && start.points === cap) {
    wasPromotionGame = true;
    promotionKind = start.divisionIndex % RANK_DIVISIONS_PER_MEDAL === RANK_DIVISIONS_PER_MEDAL - 1 ? 'medal' : 'division';
    requiredFinish = promotionKind === 'medal' ? RANK_MEDAL_PROMOTION_FINISH : RANK_DIVISION_PROMOTION_FINISH;
    if (placement <= requiredFinish) {
      promoted = true;
      after = { divisionIndex: start.divisionIndex + 1, points: RANK_PROMOTION_LANDING, demotionReady: false };
    } else if (baseDelta >= 0) {
      after = { ...start, demotionReady: false };
    } else {
      after = applyAward(baseDelta);
    }
  } else if (isDemotionReady(start)) {
    wasDemotionGame = true;
    requiredFinish = RANK_DEMOTION_ESCAPE_FINISH;
    if (placement <= requiredFinish) {
      after = applyAward(baseDelta);
    } else {
      demoted = true;
      after = { divisionIndex: start.divisionIndex - 1, points: cap + baseDelta, demotionReady: false };
    }
  } else {
    after = applyAward(baseDelta);
  }

  const appliedDelta = rankScalar(after) - rankScalar(start);
  const cappedPoints = promoted ? 0 : Math.max(0, Math.abs(baseDelta) - Math.abs(appliedDelta));
  const demotionUnlocked = isDemotionReady(after);
  return { placement, before: start, after, baseDelta, strengthBonus, appliedDelta, cappedPoints, wasPromotionGame, promotionKind, requiredFinish, promotionUnlocked, promoted, wasDemotionGame, demotionUnlocked, demoted };
}

/** Field-by-field equality of two outcomes (what the runtime parity check compares). */
export function sameRankOutcome(a: RankOutcome, b: RankOutcome): boolean {
  return a.placement === b.placement
    && a.before.divisionIndex === b.before.divisionIndex && a.before.points === b.before.points
    && (a.before.demotionReady === true) === (b.before.demotionReady === true)
    && a.after.divisionIndex === b.after.divisionIndex && a.after.points === b.after.points
    && (a.after.demotionReady === true) === (b.after.demotionReady === true)
    && a.baseDelta === b.baseDelta && a.strengthBonus === b.strengthBonus && a.appliedDelta === b.appliedDelta && a.cappedPoints === b.cappedPoints
    && a.wasPromotionGame === b.wasPromotionGame && a.promotionKind === b.promotionKind && a.requiredFinish === b.requiredFinish
    && a.promotionUnlocked === b.promotionUnlocked && a.promoted === b.promoted
    && a.wasDemotionGame === b.wasDemotionGame && a.demotionUnlocked === b.demotionUnlocked && a.demoted === b.demoted;
}
