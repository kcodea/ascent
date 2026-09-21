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
 * and bump `RANK_RULES_VERSION` in all three.
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

export interface RankPosition { divisionIndex: number; points: number; demotionReady?: boolean }

export interface RankOutcome {
  placement: number;
  before: RankPosition;
  after: RankPosition;
  baseDelta: number;
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

/** The STORED demotion-gate flag (absent = false): armed only by a loss that lands on 0 at a medal's lowest
 *  division above Bronze; cleared by any non-negative result; never set by a promotion landing. */
export const isDemotionReady = (p: RankPosition): boolean => p.demotionReady === true;
const hasDemotionGate = (d: number): boolean => d > 0 && d % RANK_DIVISIONS_PER_MEDAL === 0;

/** True for a placement the ladder accepts (an integer 1–8). */
export const isValidPlacement = (p: unknown): p is number =>
  typeof p === 'number' && Number.isInteger(p) && p >= 1 && p <= RANK_PLACEMENT_AWARDS.length;

/**
 * Resolve ONE rated game — identical to `resolveRank` in the sim and to the branches of `settle_rank`:
 *   • top division: add the award uncapped; below 0 → demote to `100 + result`.
 *   • at a gate (100 below the top): placement ≤ required (4 division / 1 medal) → promote to 0/100 of the
 *     next division; a positive award short of a MEDAL gate holds at 100; a negative award applies from 100.
 *   • at an ARMED demotion gate (`before.demotionReady`): a bottom-4 demotes one division to the previous
 *     medal's I at `100 + award`; a top-4 escapes with its award from 0 (and disarms).
 *   • otherwise add the award: ≥ 100 → exactly 100 + promotion unlocked; a LOSS landing on 0 at a medal's
 *     lowest division clamps at 0 and ARMS the gate; < 0 elsewhere → demote to `100 + result` within a medal,
 *     Bronze III floors at 0. A promotion landing is never armed.
 */
export function resolveRankOutcome(before: RankPosition, placement: number): RankOutcome {
  if (!isValidPlacement(placement)) throw new RangeError(`placement ${String(placement)}`);
  const cap = RANK_DIVISION_POINTS;
  const top = RANK_TOP_DIVISION;
  const baseDelta = RANK_PLACEMENT_AWARDS[placement - 1]!;
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
    if (start.divisionIndex === top) {
      if (pts >= 0) return { divisionIndex: top, points: pts, demotionReady: false };
      demoted = true;
      return { divisionIndex: top - 1, points: cap + pts, demotionReady: false };
    }
    if (pts >= cap) { promotionUnlocked = true; return { divisionIndex: start.divisionIndex, points: cap, demotionReady: false }; }
    if (delta < 0 && pts <= 0 && hasDemotionGate(start.divisionIndex)) {
      return { divisionIndex: start.divisionIndex, points: 0, demotionReady: true };
    }
    if (pts < 0) {
      if (start.divisionIndex === 0) return { divisionIndex: 0, points: 0, demotionReady: false };
      demoted = true;
      return { divisionIndex: start.divisionIndex - 1, points: cap + pts, demotionReady: false };
    }
    return { divisionIndex: start.divisionIndex, points: pts, demotionReady: false };
  };

  if (start.divisionIndex < top && start.points === cap) {
    wasPromotionGame = true;
    promotionKind = start.divisionIndex % RANK_DIVISIONS_PER_MEDAL === RANK_DIVISIONS_PER_MEDAL - 1 ? 'medal' : 'division';
    requiredFinish = promotionKind === 'medal' ? RANK_MEDAL_PROMOTION_FINISH : RANK_DIVISION_PROMOTION_FINISH;
    if (placement <= requiredFinish) {
      promoted = true;
      after = { divisionIndex: start.divisionIndex + 1, points: 0, demotionReady: false };
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
  return { placement, before: start, after, baseDelta, appliedDelta, cappedPoints, wasPromotionGame, promotionKind, requiredFinish, promotionUnlocked, promoted, wasDemotionGame, demotionUnlocked, demoted };
}

/** Field-by-field equality of two outcomes (what the runtime parity check compares). */
export function sameRankOutcome(a: RankOutcome, b: RankOutcome): boolean {
  return a.placement === b.placement
    && a.before.divisionIndex === b.before.divisionIndex && a.before.points === b.before.points
    && (a.before.demotionReady === true) === (b.before.demotionReady === true)
    && a.after.divisionIndex === b.after.divisionIndex && a.after.points === b.after.points
    && (a.after.demotionReady === true) === (b.after.demotionReady === true)
    && a.baseDelta === b.baseDelta && a.appliedDelta === b.appliedDelta && a.cappedPoints === b.cappedPoints
    && a.wasPromotionGame === b.wasPromotionGame && a.promotionKind === b.promotionKind && a.requiredFinish === b.requiredFinish
    && a.promotionUnlocked === b.promotionUnlocked && a.promoted === b.promoted
    && a.wasDemotionGame === b.wasDemotionGame && a.demotionUnlocked === b.demotionUnlocked && a.demoted === b.demoted;
}
