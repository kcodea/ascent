import { CURRENT_SEASON, initialProfile, initialRankedProfile, isRankedProfile, MAX_LINE, MIN_LINE, rankScalar, type PlayerProfile } from '@game/sim';

/**
 * The player profile persistence seam (rank + rating + Line + high-water marks).
 *
 * This is a LOCAL MIRROR of the account's `profiles` row: the ONE place the app reads/writes the profile.
 * Since medals (2026-09-20) the authoritative state is `profile.rank` (a `RankedProfile` — division, points,
 * career-best, revision), adopted from the server after every settlement and on boot; the numeric fields are
 * derived from it (`rating` = `100 × division + points`). The stored shape is the flat `PlayerProfile`.
 *
 * All best-effort: localStorage may be unavailable, so a missing/corrupt profile falls back to a fresh one.
 */

const KEY = 'ascent.profile';

/** A stored value is a valid profile if it has finite rating + a Line in range; else we start fresh. */
function isValid(p: unknown): p is PlayerProfile {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.rating === 'number' && Number.isFinite(o.rating) &&
    typeof o.currentLine === 'number' && o.currentLine >= MIN_LINE && o.currentLine <= MAX_LINE &&
    typeof o.highestRating === 'number' && typeof o.highestLine === 'number'
  );
}

/** Load the player profile, or a fresh one (Bronze III 0/100, rating 0 / Line 7) on anything missing/corrupt. */
export function loadProfile(): PlayerProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialProfile();
    const parsed = JSON.parse(raw) as unknown;
    if (!isValid(parsed)) return initialProfile();
    // SEASON GATE (the true reset, owner ask 2026-07-31): a profile from an older season — including every
    // pre-season profile, which carries no season at all — starts fresh. Bumping CURRENT_SEASON resets
    // every client on its next launch, no server round-trip needed. Season 3 (medals) is such a bump: every
    // season-2 numeric mirror starts over at Bronze III, matching the server-side season reset.
    if ((parsed as PlayerProfile).season !== CURRENT_SEASON) return initialProfile();
    // RANK VALIDATION / MIGRATION: a same-season mirror whose `rank` is missing or malformed (a build from
    // the first hours of season 3, or a hand-edited store) heals to a fresh rank rather than crashing a read;
    // the server's copy replaces it on the next boot sync. The scalar is re-derived so the two can't disagree.
    const rank = (parsed as Partial<PlayerProfile>).rank;
    if (!isRankedProfile(rank) || rank.seasonId !== CURRENT_SEASON) {
      const fresh = initialRankedProfile();
      return { ...(parsed as PlayerProfile), rank: fresh, rating: rankScalar(fresh.position), highestRating: rankScalar(fresh.highest) };
    }
    const scalar = rankScalar(rank.position);
    if ((parsed as PlayerProfile).rating !== scalar) return { ...(parsed as PlayerProfile), rating: scalar };
    return parsed;
  } catch {
    return initialProfile();
  }
}

/** Persist the player profile. Best-effort — never throws. */
export function saveProfile(profile: PlayerProfile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch { /* ignore */ }
}

/** Wipe the stored profile (rank + rating + Line + high-water marks) — next load returns a fresh one. Best-effort. */
export function clearProfile(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
