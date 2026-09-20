/**
 * LEADERBOARD / HALL / RECENT GAMES — the pure half of the three ladder pages (owner polish 2026-09-20): every
 * label the banners and the ranked table print, kept synchronous and client-free so it is testable without a
 * backend. The pages themselves (`Rankings.tsx`, `Leaderboard.tsx`, `RecentGames.tsx`) only lay these out.
 *
 * NOTE — `outcomeOf` / `runLengthText` / `playedOnText` / `ordinalOf` are deliberately DUPLICATED from the
 * Career page's `careerData.ts` (branch `feat/career-page-v2`, in flight at the same time): that file did not
 * exist on `main` when this shipped, and the two branches must merge without touching each other's files.
 * Once both are in, fold these into ONE module (careerData's copies are the canonical ones) and delete these.
 */

/** 1st / 2nd / 3rd / 4th … (11th–13th handled). */
export function ordinalOf(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** The outcome block's headline: 1st reads VICTORY (green); any other placement reads as its ordinal ("4TH"),
 *  top-4 in the neutral cream, 5th–8th in red; no placement at all reads "—" (a pre-lobby row). */
export function outcomeOf(placement: number | null): { label: string; cls: 'won' | 'top4' | 'lost' | 'none' } {
  if (placement === null || !(placement > 0)) return { label: '—', cls: 'none' };
  if (placement === 1) return { label: 'VICTORY', cls: 'won' };
  return { label: ordinalOf(placement).toUpperCase(), cls: placement <= 4 ? 'top4' : 'lost' };
}

/** "36 min" for the outcome block; "<1 min" under a minute; "—" when unknown. */
export function runLengthText(durationMs: number | null): string {
  if (durationMs === null || durationMs < 0) return '—';
  const mins = Math.round(durationMs / 60_000);
  return mins < 1 ? '<1 min' : `${mins} min`;
}

/** "Sep 19, 2026" — the date a run was played; '' when unknown. */
export function playedOnText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Sep 19, 3:42 PM" — the date AND time, for a feed where several games share a day; '' when unknown. */
export function playedAtText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** A W–L–D record → the per-round string a leaderboard row prints ("9–4", or "9–4–1" only when a draw
 *  happened, so the common case stays two numbers). */
export function recordText(rec: { wins: number; losses: number; draws?: number } | null): string {
  if (!rec) return '—';
  const d = rec.draws ?? 0;
  return d > 0 ? `${rec.wins}–${rec.losses}–${d}` : `${rec.wins}–${rec.losses}`;
}

/** The W–L–D record folded out of a Hall row's per-round spread ("LLWLWWW…", one char per round: W/L/D).
 *  Null for a row logged before the `history` column existed. */
export function recordOfHistory(history: string | undefined | null): { wins: number; losses: number; draws: number } | null {
  if (!history) return null;
  let wins = 0, losses = 0, draws = 0;
  for (const c of history) {
    if (c === 'W') wins++;
    else if (c === 'L') losses++;
    else if (c === 'D') draws++;
  }
  return { wins, losses, draws };
}

/** The ranked-table medallion tier of a 1-based rank: gold / silver / bronze for the podium, plain beyond. */
export function medalOf(rank: number): 'gold' | 'silver' | 'bronze' | 'plain' {
  return rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'plain';
}

/** The "Partial recording" caption for a replay that doesn't start at round 1. */
export function partialText(firstRecordedWave: number | null): string {
  return firstRecordedWave !== null && firstRecordedWave > 1 ? `Partial recording · from round ${firstRecordedWave}` : 'Partial recording';
}
