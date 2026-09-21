/**
 * MEDAL RANK — the client-side contract between the submission seam (`remoteBoards.submitRating`), the durable
 * pending queue (`rankSubmission.ts`) and the store slice the post-game screen reads (see README.md here).
 * The rules + result shapes themselves live in `@game/sim` (`rank.ts`); this file names the states a
 * submission can be in, re-exports the rules contract for the presentation (`RankBar`, `RankScreen`, the
 * formatting helper) and adds the few presentation-only helpers the rules module has no reason to carry.
 */
import {
  RANK_MEDALS, RANK_RULES, divisionTierOf, hasDemotionGate, isRankPosition, medalOf as medalOfRules, promotionKindAt, rankTopDivision,
  type RankPosition, type RankResult, type RankedProfile,
} from '@game/sim';

// ── The rules contract, re-exported so every presentation file imports through here ──────────────────────
export type { RankPosition, RankedProfile, RankResult, PromotionKind, RankMedal } from '@game/sim';
export {
  RANK_RULES, RANK_MEDALS, rankLabel, rankScalar, medalOf, divisionTierOf, isPromotionReady, hasDemotionGate,
  promotionKindAt, requiredFinishFor, rankTopDivision,
} from '@game/sim';

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
  | { status: 'confirmed'; result: RankResult; profile: RankedProfile; deduped: boolean }
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

/** A medal's lowest division above Bronze (Silver III, Gold III, …) — where the demotion gate lives. */
export const isMedalFloor = (divisionIndex: number): boolean => hasDemotionGate(divisionIndex);

/**
 * Whether a STANDING (profile / position) is demotion-ready — the rules' STORED flag, read off the profile
 * (`profile.rank.demotionReady`) or its position (`position.demotionReady`), whichever the rules carry it on.
 * The flag is armed ONLY by a loss that clamps at 0 on a medal floor, cleared by any non-negative result and
 * never set by a promotion landing (rules 2026-09-20) — so a 0 at a medal floor is NOT derived into a gate
 * here (the landing is 10 since 2026-09-21, but the flag is the rules' to set, never the shape's). No flag
 * → not demotion-ready.
 */
export function standingDemotionReady(rank: unknown): boolean {
  if (!rank || typeof rank !== 'object') return false;
  const o = rank as { demotionReady?: unknown; position?: { demotionReady?: unknown } };
  if (typeof o.demotionReady === 'boolean') return o.demotionReady;
  if (o.position && typeof o.position === 'object' && typeof o.position.demotionReady === 'boolean') return o.position.demotionReady;
  return false;
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
