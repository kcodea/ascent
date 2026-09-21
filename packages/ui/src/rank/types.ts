/**
 * MEDAL RANK — the client-side contract between the submission seam (`remoteBoards.submitRating`), the durable
 * pending queue (`rankSubmission.ts`) and the store slice the post-game screen reads (see README.md here).
 * The rules + result shapes themselves live in `@game/sim` (`rank.ts`); this file only names the states a
 * submission can be in.
 */
import type { RankResult, RankedProfile } from '@game/sim';

/**
 * Where the run-just-finished's rank settlement stands (blueprint §7 "Submission states"):
 *   • `pending`    — submitted (or queued) and awaiting the server's answer.
 *   • `confirmed`  — the server settled it: `rankResult` holds the immutable result, the profile was adopted.
 *   • `retryable`  — offline / timeout / 5xx / rate-limited: the request is persisted and will be retried
 *                    (boot, network return, `retryRankSubmission()`).
 *   • `unrated`    — this run never entered the ladder (practice / tutorial / sandbox / no backend / no
 *                    account at finish). No rank movement, nothing queued.
 *   • `rejected`   — the server refused it permanently (bad input, unsupported season / rules version, a
 *                    server that predates medals). `rankSubmissionError` carries the reason.
 */
export type RankSubmissionState = 'pending' | 'confirmed' | 'retryable' | 'unrated' | 'rejected';

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
