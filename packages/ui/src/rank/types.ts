/**
 * MEDAL RANK — the client-side contract between the submission seam (`remoteBoards.submitRating`), the durable
 * pending queue (`rankSubmission.ts`) and the store slice the post-game screen reads (see README.md here).
 * The rules + result shapes themselves live in `@game/sim` (`rank.ts`); this file names the states a
 * submission can be in, re-exports the rules contract for the presentation (`RankBar`, `RankScreen`, the
 * formatting helper) and adds the few presentation-only helpers the rules module has no reason to carry.
 */
import {
  RANK_MEDALS, RANK_RULES, divisionTierOf, isRankPosition, medalOf as medalOfRules, promotionKindAt, rankTopDivision,
  type RankPosition, type RankResult as RulesRankResult, type RankedProfile,
} from '@game/sim';

// ── The rules contract, re-exported so every presentation file imports through here ──────────────────────
export type { RankPosition, RankedProfile, PromotionKind, RankMedal } from '@game/sim';
export { RANK_RULES, RANK_MEDALS, rankLabel, rankScalar, medalOf, divisionTierOf, isPromotionReady, promotionKindAt, requiredFinishFor, rankTopDivision } from '@game/sim';

/**
 * The result the screen animates — the rules module's `RankResult`, plus the MEDAL-DEMOTION GATE fields the
 * owner added on 2026-09-20 (a loss at a medal's lowest division clamps at 0 and marks the player
 * demotion-ready; the NEXT rated game is a demotion game — bottom 4 demotes to the previous medal's I, top 4
 * escapes with its normal award). The rules resolver is still deciding the landing points, so these are
 * OPTIONAL here: absent → derived from the position shape (see `isDemotionUnlocked`). Delete the optionals
 * once `@game/sim` carries them.
 */
export interface RankResult extends RulesRankResult {
  /** This game was played FROM a demotion-ready position (0 at a medal floor after a clamped loss). */
  wasDemotionGame?: boolean;
  /** This game's loss clamped at 0 on a medal floor: the next rated game is the demotion game. */
  demotionUnlocked?: boolean;
}

/** Where the run-just-finished's rank settlement stands (blueprint §7 "Submission states"):
 *   • `pending`    — submitted (or queued) and awaiting the server's answer.
 *   • `confirmed`  — the server settled it: `rankResult` holds the immutable result, the profile was adopted.
 *   • `retryable`  — offline / timeout / 5xx / rate-limited: the request is persisted and will be retried
 *                    (boot, network return, `retryRankSubmission()`).
 *   • `unrated`    — this run never entered the ladder (practice / tutorial / sandbox / no backend / no
 *                    account at finish). No rank movement, nothing queued.
 *   • `rejected`   — the server refused it permanently (bad input, unsupported season / rules version, a
 *                    server that predates medals). `rankSubmissionError` carries the reason. */
export type RankSubmissionState = 'pending' | 'confirmed' | 'retryable' | 'unrated' | 'rejected';
/** The presentation's name for the same union. */
export type RankSubmission = RankSubmissionState;

/** What the client sends to settle ONE rated run. Pinned at finish time and retried byte-for-byte. */
export interface RankSubmitRequest {
  /** The run's stable identity — a persisted UUID for runs started since medals, `String(seed)` for older
   *  saved games. The server's dedupe key; NEVER regenerated on retry. */
  runId: string;
  /** Final lobby placement 1–8. */
  placement: number;
  seasonId: number;
  rulesVersion: number;
  /** The run seed — lets the server stamp the result onto the matching `run_history` row. */
  seed?: number;
}

/** The typed answer from `submitRating`. */
export type RankSubmitOutcome =
  | { status: 'confirmed'; result: RulesRankResult; profile: RankedProfile; deduped: boolean }
  | { status: 'retryable'; reason: string }
  | { status: 'rejected'; reason: string };

// ── Presentation-only helpers ─────────────────────────────────────────────────────────────────────────────

export const MEDALS = RANK_MEDALS;
export type Medal = (typeof RANK_MEDALS)[number];
export const DIVISIONS_PER_MEDAL = RANK_RULES.divisionsPerMedal;
export const POINTS_PER_DIVISION = RANK_RULES.divisionPoints;
export const TOP_DIVISION = rankTopDivision();
export const DIVISION_COUNT = TOP_DIVISION + 1;
export const DIVISION_NUMERALS = ['III', 'II', 'I'] as const;
export type DivisionNumeral = (typeof DIVISION_NUMERALS)[number];

/** The numeral within its medal as a string plate ("II" for Gold II). */
export function divisionNumeralOf(divisionIndex: number): DivisionNumeral {
  return DIVISION_NUMERALS[DIVISIONS_PER_MEDAL - divisionTierOf(divisionIndex)] ?? 'III';
}

/** Ascendant I has no cap. */
export const isUncapped = (divisionIndex: number): boolean => divisionIndex >= TOP_DIVISION;

/** Promoting OUT of a medal's division I is a MEDAL step (needs 1st); any other step is a division step. */
export const isMedalGate = (divisionIndex: number): boolean => promotionKindAt(divisionIndex) === 'medal';

/** A medal's lowest division above Bronze (Silver III, Gold III, …) — where a loss meets the demotion gate. */
export function isMedalFloor(divisionIndex: number): boolean {
  return divisionIndex > 0 && divisionIndex % DIVISIONS_PER_MEDAL === 0;
}

/** The demotion gate: `demotionUnlocked` when the rules carry it, else derived — a loss that clamped at 0 on
 *  a medal floor without demoting (so the next rated game is the demotion game). */
export function isDemotionUnlocked(r: RankResult): boolean {
  if (typeof r.demotionUnlocked === 'boolean') return r.demotionUnlocked;
  return r.baseDelta < 0 && !r.demoted && r.after.points === 0 && isMedalFloor(r.after.divisionIndex)
    && r.before.divisionIndex === r.after.divisionIndex;
}

/** Leaderboard / surface ordering: HIGHER rank first (division desc, then points desc). */
export function compareRankDesc(a: RankPosition, b: RankPosition): number {
  return b.divisionIndex - a.divisionIndex || b.points - a.points;
}

/** Duck-type a position off any object (a profile's `rank` is a `RankedProfile`; a row may carry a bare
 *  position). Null for anything else — never a fabricated rank. */
export function rankPositionOf(value: unknown): RankPosition | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as { position?: unknown };
  if (o.position && typeof o.position === 'object') return rankPositionOf(o.position);
  if (isRankPosition(value)) return { divisionIndex: value.divisionIndex, points: value.points };
  return null;
}

/** The medal name in lower case — the art key and CSS token. */
export const medalKey = (divisionIndex: number): string => medalOfRules(divisionIndex).toLowerCase();
