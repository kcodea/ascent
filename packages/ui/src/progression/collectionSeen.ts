import type { ProgressionProfile } from '@game/progression';

/**
 * THE COLLECTION'S "SEEN" LIST: which owned items this account has looked at on THIS device (the NEW badge). Its own
 * module so the progression store can take the baseline without loading the album model. Local only, best-effort.
 */

const SEEN_KEY = (userId: string): string => `ascent.collection.seen.${userId}`;

/** The item ids this account has looked at on this device. Empty when unreadable. */
export function loadSeen(userId: string | null | undefined): Set<string> {
  if (!userId) return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY(userId)) ?? '[]') as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Remember that `ids` were seen. Best-effort; local only (never sent anywhere). */
export function saveSeen(userId: string | null | undefined, seen: ReadonlySet<string>): void {
  if (!userId) return;
  try { localStorage.setItem(SEEN_KEY(userId), JSON.stringify([...seen])); } catch { /* best-effort */ }
}

/** Add `ids` to the STORED list (a union with what is there, so the page, the baseline and a second tab never drop
 *  each other's ids). Writes only when something is new. */
export function addSeen(userId: string | null | undefined, ids: Iterable<string>): void {
  if (!userId) return;
  const seen = loadSeen(userId);
  const before = seen.size;
  for (const id of ids) seen.add(id);
  if (seen.size !== before) saveSeen(userId, seen);
}

const BASELINE_KEY = (userId: string): string => `ascent.collection.baseline.${userId}`;

/**
 * THE BASELINE (owner 2026-10-11: "whenever i load the game, all of my stuff that i already own shows up as 'new'").
 * The seen list lives in this browser's storage, so a device (or a new address: another dev port, the desktop app,
 * the web build) that has never seen the account started with an EMPTY list and badged the whole collection, one
 * click per item to clear. Now the first readable ownership list a device gets for an account is taken as already
 * seen, ONCE (a marker key), so only what is earned after that wears NEW. A list the device already had is kept and
 * topped up. A profile whose ownership could not be read (no `cosmetics`) is skipped: the next full read takes it.
 */
export function ensureSeenBaseline(userId: string | null | undefined, profile: Pick<ProgressionProfile, 'cosmetics'> | null | undefined): void {
  if (!userId || !profile?.cosmetics) return;
  try {
    if (localStorage.getItem(BASELINE_KEY(userId))) return;
    addSeen(userId, profile.cosmetics);
    localStorage.setItem(BASELINE_KEY(userId), '1');
  } catch { /* best-effort: blocked storage just means the badges show for this session */ }
}

/** An owned item not seen yet wears NEW. */
export const isNew = (id: string, owned: ReadonlySet<string>, seen: ReadonlySet<string>): boolean => owned.has(id) && !seen.has(id);
