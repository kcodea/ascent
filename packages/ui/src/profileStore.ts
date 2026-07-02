import { initialProfile, MAX_LINE, MIN_LINE, type PlayerProfile } from '@game/sim';

/**
 * The player profile persistence seam (rating + Line + high-water marks).
 *
 * Today this is a single localStorage object; it is the ONE place the app reads/writes the profile, so the
 * move to Supabase-backed accounts later is a swap of these two functions' internals (e.g. a local mirror
 * kept in sync with a `profiles` row) rather than a hunt-and-replace across the UI. The stored shape is the
 * flat `PlayerProfile`, which maps 1:1 to a future table row — first sign-in just upserts it under an account.
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

/** Load the player profile, or a fresh one (rating 0 / Line 7) on anything missing/corrupt. */
export function loadProfile(): PlayerProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialProfile();
    const parsed = JSON.parse(raw) as unknown;
    return isValid(parsed) ? parsed : initialProfile();
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

/** Wipe the stored profile (rating + Line + high-water marks) — next load returns a fresh one. Best-effort. */
export function clearProfile(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
