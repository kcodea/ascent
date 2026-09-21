/**
 * The seam between the store's rank slice (`rankResult`, `rankSubmission`, `rankSubmissionError`,
 * `rankRunId`, `retryRankSubmission()`, `profile.rank` — see README.md) and the presentation. The reads stay
 * defensive: a malformed result or a profile without a rank reads as "no rank", never as a fabricated one,
 * and the short error CODE the slice carries is turned into the truthful sentence the screen prints here.
 */
import { useShallow } from 'zustand/react/shallow';
import { useGame } from '../store';
import { rankPositionOf, type RankPosition, type RankResult, type RankSubmission } from './types';

/** The slice fields this seam reads (the store's own types are the source of truth; this is the subset). */
export interface RankStoreSlice {
  rankResult?: RankResult | null;
  rankSubmission?: RankSubmission;
  rankSubmissionError?: string | null;
  rankRunId?: string | null;
  retryRankSubmission?: () => void;
  profile?: { rank?: unknown };
}

/** The truthful sentence for a submission error code (blueprint §7: never label every failure "Unrated"). */
export function rankErrorText(code: string | null | undefined, submission: RankSubmission): string | undefined {
  if (!code) return undefined;
  const KNOWN: Record<string, string> = {
    timeout: 'The rank server did not answer in time.',
    offline: 'You are offline.',
    no_session: 'Not signed in yet — the result is saved and will rank once you are.',
    no_account: 'No account to rank under — sign in to keep a ranked record.',
    rate_limited: 'The rank server is busy.',
    server_error: 'The rank server hit an error.',
    unsupported_rules: 'The server no longer accepts this version of the rank rules. Update the game to rank this run.',
    unsupported_season: 'This run belongs to a season the server no longer ranks.',
    bad_input: 'The server rejected this result as invalid.',
    server_predates_medals: 'The server does not know medal ranks yet — this run cannot be ranked.',
  };
  const text = KNOWN[code] ?? `Rank update failed (${code}).`;
  return submission === 'rejected' ? `This result could not be ranked. ${text}` : text;
}

const SUBMISSIONS: readonly RankSubmission[] = ['pending', 'confirmed', 'retryable', 'unrated', 'rejected'];

function isResult(v: unknown): v is RankResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<RankResult>;
  return typeof r.placement === 'number' && !!rankPositionOf(r.before) && !!rankPositionOf(r.after)
    && typeof r.appliedDelta === 'number' && typeof r.baseDelta === 'number';
}

export interface RankSource {
  submission: RankSubmission;
  result: RankResult | null;
  current: RankPosition | null;
  /** The ranked identity of the run the slice describes — keys the presentation-consumed marker. */
  runId: string | null;
  error?: string;
  retry?: () => void;
}

/** The player's current rank position from the profile mirror, or null before the rank system exists. */
export function useCurrentRank(): RankPosition | null {
  const picked = useGame(useShallow((s) => {
    const pos = rankPositionOf((s as unknown as RankStoreSlice).profile?.rank);
    return { d: pos?.divisionIndex, p: pos?.points };
  }));
  return picked.d !== undefined && picked.p !== undefined ? { divisionIndex: picked.d, points: picked.p } : null;
}

/** The profile's DEMOTION-READY flag (owner rule 2026-09-20), once the rules carry it on `profile.rank`;
 *  false until then. Read separately from the position so the position selector stays a two-number pick. */
export function useDemotionReady(): boolean {
  return useGame((s) => {
    const rank = (s as unknown as RankStoreSlice).profile?.rank as { demotionReady?: unknown } | undefined;
    return rank?.demotionReady === true;
  });
}

/** Non-hook read for one-off callers (the Title's Play card renders from this too via the hook above). */
export function currentRankOf(state: unknown): RankPosition | null {
  return rankPositionOf((state as RankStoreSlice).profile?.rank);
}

/**
 * The rank state for the end screen of the run that just finished. Null only if the store somehow carries no
 * slice (a test double) — the caller then keeps its legacy rating block.
 */
export function useRankSource(): RankSource | null {
  // `useShallow` compares the picked fields, so the end screen re-renders only when the rank state changes.
  const picked = useGame(useShallow((s) => {
    const slice = s as unknown as RankStoreSlice;
    const current = rankPositionOf(slice.profile?.rank);
    return {
      submission: slice.rankSubmission,
      result: slice.rankResult ?? null,
      errorCode: slice.rankSubmissionError ?? null,
      runId: slice.rankRunId ?? null,
      retry: slice.retryRankSubmission,
      currentDivision: current?.divisionIndex,
      currentPoints: current?.points,
    };
  }));
  const submission = picked.submission;
  if (!submission || !SUBMISSIONS.includes(submission)) return null;
  const result = isResult(picked.result) ? picked.result : null;
  return {
    submission,
    result: submission === 'confirmed' ? result : null,
    current: picked.currentDivision !== undefined && picked.currentPoints !== undefined
      ? { divisionIndex: picked.currentDivision, points: picked.currentPoints }
      : null,
    runId: picked.runId,
    error: rankErrorText(picked.errorCode, submission),
    retry: typeof picked.retry === 'function' ? picked.retry : undefined,
  };
}
