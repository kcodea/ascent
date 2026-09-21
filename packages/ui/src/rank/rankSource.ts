/**
 * The seam between the store's rank slice and the presentation. The rules branch (`feat/rank-rules-server`)
 * adds `rankResult`, `rankSubmission`, `retryRankSubmission()` and `profile.rank` to the store; this reads
 * them WITHOUT a compile-time dependency on that slice, so the presentation builds (and its DEV previews +
 * tests run) before the slice lands, and lights up the moment it does. Every read is duck-typed and
 * defensive — a missing slice reads as "no rank system yet", never as a fabricated rank.
 */
import { useShallow } from 'zustand/react/shallow';
import { useGame } from '../store';
import { rankPositionOf, type RankPosition, type RankResult, type RankSubmission } from './types';

/** What the store slice looks like once the rules branch merges (mirrors its README). */
export interface RankStoreSlice {
  rankResult?: RankResult | null;
  rankSubmission?: RankSubmission;
  rankError?: string;
  retryRankSubmission?: () => void;
  profile?: { rank?: unknown };
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

/** Non-hook read for one-off callers (the Title's Play card renders from this too via the hook above). */
export function currentRankOf(state: unknown): RankPosition | null {
  return rankPositionOf((state as RankStoreSlice).profile?.rank);
}

/**
 * The rank state for the end screen of the run that just finished. Returns null when the store carries no
 * rank slice at all (the rules branch has not merged) — the caller then keeps its legacy rating block, so
 * nothing regresses on either side of the merge.
 */
export function useRankSource(): RankSource | null {
  // `useShallow` compares the picked fields, so the end screen re-renders only when the rank state changes.
  const picked = useGame(useShallow((s) => {
    const slice = s as unknown as RankStoreSlice;
    const current = rankPositionOf(slice.profile?.rank);
    return {
      submission: slice.rankSubmission,
      result: slice.rankResult ?? null,
      error: slice.rankError,
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
    error: typeof picked.error === 'string' ? picked.error : undefined,
    retry: typeof picked.retry === 'function' ? picked.retry : undefined,
  };
}
