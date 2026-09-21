/**
 * MEDAL RANK — the presentation's copy of the rules contract.
 *
 * >>> REPLACE WITH `@game/sim` rank.ts AT MERGE. <<<
 * The rules resolver lives on `feat/rank-rules-server` (`packages/sim/src/rank.ts`) and had not landed when
 * this presentation branch was cut, so the types below are an IDENTICAL local mirror of that contract
 * (blueprint §4, owner decisions 2026-09-20). Once the rules branch merges, this file should shrink to
 * re-exports — `export type { RankPosition, RankedProfile, RankResult } from '@game/sim'` — and every
 * consumer in `packages/ui/src/rank/` keeps compiling unchanged. Nothing here computes a rank: the
 * presentation only ever renders a `RankResult` the server confirmed (or a fixture in DEV).
 */

/** The eighteen divisions, lowest → highest: Bronze III (0) … Ascendant I (17). */
export interface RankPosition {
  /** integer 0..17 */
  divisionIndex: number;
  /** integer 0..100; uncapped only at index 17 (Ascendant I). */
  points: number;
}

export interface RankedProfile {
  seasonId: number;
  rulesVersion: number;
  /** authoritative monotonic profile revision */
  revision: number;
  position: RankPosition;
  highest: RankPosition;
}

/** The immutable, server-confirmed outcome of ONE rated lobby — what the post-game screen animates. */
export interface RankResult {
  runId: string;
  seasonId: number;
  rulesVersion: number;
  revisionBefore: number;
  revisionAfter: number;
  /** Final lobby placement, 1..8. */
  placement: number;
  before: RankPosition;
  after: RankPosition;
  /** The placement table's raw award (+40 … −40). */
  baseDelta: number;
  /** What actually moved: `scalar(after) − scalar(before)`. Differs from `baseDelta` at a gate cap or the floor. */
  appliedDelta: number;
  /** Points discarded by a gate cap / the Bronze floor (`baseDelta − appliedDelta`, absolute). */
  cappedPoints: number;
  /** This game was played FROM a promotion-ready position (100 points below Ascendant I). */
  wasPromotionGame: boolean;
  /** Which kind of gate this promotion game was — a division step (top-4) or a medal step (1st only). */
  promotionKind: 'division' | 'medal' | null;
  /** This game REACHED 100 (the next rated game is the promotion attempt). Never true alongside `promoted`. */
  promotionUnlocked: boolean;
  promoted: boolean;
  demoted: boolean;
}

/** The client's view of where the rated submission stands (mirrors the store slice on the rules branch). */
export type RankSubmission = 'pending' | 'confirmed' | 'retryable' | 'unrated' | 'rejected';

// ── Constants + the ONE index → label mapping (blueprint §8: no surface may disagree) ─────────────────────

export const MEDALS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Ascendant'] as const;
export type Medal = (typeof MEDALS)[number];
export const DIVISIONS_PER_MEDAL = 3;
export const POINTS_PER_DIVISION = 100;
export const DIVISION_COUNT = MEDALS.length * DIVISIONS_PER_MEDAL; // 18
export const TOP_DIVISION = DIVISION_COUNT - 1; // 17 — Ascendant I, uncapped
/** Division numerals within a medal, lowest → highest (owner decision 2026-09-20: III → II → I). */
export const DIVISION_NUMERALS = ['III', 'II', 'I'] as const;
export type DivisionNumeral = (typeof DIVISION_NUMERALS)[number];

const clampIndex = (i: number): number => Math.min(TOP_DIVISION, Math.max(0, Math.floor(i)));

/** The medal a division index belongs to (`medalOf(7)` → 'Gold'). */
export function medalOf(divisionIndex: number): Medal {
  return MEDALS[Math.floor(clampIndex(divisionIndex) / DIVISIONS_PER_MEDAL)]!;
}

/** The numeral within its medal (`divisionNumeralOf(7)` → 'II'). */
export function divisionNumeralOf(divisionIndex: number): DivisionNumeral {
  return DIVISION_NUMERALS[clampIndex(divisionIndex) % DIVISIONS_PER_MEDAL]!;
}

/** "Gold II" — the one label every surface prints. */
export function rankLabel(pos: RankPosition | number): string {
  const i = typeof pos === 'number' ? pos : pos.divisionIndex;
  return `${medalOf(i)} ${divisionNumeralOf(i)}`;
}

/** The reporting scalar `100 * divisionIndex + points` (NOT an ordering key on its own — see `compareRank`). */
export function rankScalar(pos: RankPosition): number {
  return POINTS_PER_DIVISION * pos.divisionIndex + pos.points;
}

/** Ascendant I has no cap. */
export const isUncapped = (divisionIndex: number): boolean => divisionIndex >= TOP_DIVISION;

/** Promotion-ready = sitting on the gate: 100 points in any division below Ascendant I. */
export function isPromotionReady(pos: RankPosition): boolean {
  return !isUncapped(pos.divisionIndex) && pos.points >= POINTS_PER_DIVISION;
}

/** Promoting OUT of a medal's division I is a MEDAL step (needs 1st); any other step is a division step (top 4). */
export function isMedalGate(divisionIndex: number): boolean {
  return clampIndex(divisionIndex) % DIVISIONS_PER_MEDAL === DIVISIONS_PER_MEDAL - 1;
}

/** Leaderboard ordering: division first, then points — adjacent divisions can tie on the scalar. */
export function compareRank(a: RankPosition, b: RankPosition): number {
  return b.divisionIndex - a.divisionIndex || b.points - a.points;
}

/** Duck-type a rank position off any object (a profile's `rank` may be a `RankedProfile` or a bare position). */
export function rankPositionOf(value: unknown): RankPosition | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as { position?: unknown; divisionIndex?: unknown; points?: unknown };
  if (o.position && typeof o.position === 'object') return rankPositionOf(o.position);
  if (typeof o.divisionIndex === 'number' && typeof o.points === 'number' && Number.isFinite(o.divisionIndex) && Number.isFinite(o.points)) {
    return { divisionIndex: clampIndex(o.divisionIndex), points: Math.max(0, Math.round(o.points)) };
  }
  return null;
}
