import type { ProgressionProfile } from '@game/progression';

/**
 * THE COLLECTION'S "SEEN" LIST ON THIS DEVICE: which owned items this account has looked at (the NEW badge).
 *
 * The list itself lives ON THE ACCOUNT (`player_cosmetics.seen_at`, 2026-10-11, owner: "i want to save the 'seen'
 * on the account level"); the progression store reads it and writes it (`refreshSeenList`, `markCosmeticsSeen`).
 * This file is the device's COPY of it, in localStorage, which does three jobs: the page can draw the badges before
 * the server answers (and offline), an item you just looked at stays seen even if the write did not get through, and
 * it IS the list on a server from before the migration (see `ensureSeenBaseline`). Local only, best-effort.
 */

const SEEN_KEY = (userId: string): string => `ascent.collection.seen.${userId}`;
const BASELINE_KEY = (userId: string): string => `ascent.collection.baseline.${userId}`;

/** The item ids this account has looked at, as this device knows it. Empty when unreadable. */
export function loadSeen(userId: string | null | undefined): Set<string> {
  if (!userId) return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY(userId)) ?? '[]') as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Remember that `ids` were seen. Best-effort. */
export function saveSeen(userId: string | null | undefined, seen: ReadonlySet<string>): void {
  if (!userId) return;
  try { localStorage.setItem(SEEN_KEY(userId), JSON.stringify([...seen])); } catch { /* best-effort */ }
}

/** Add `ids` to the STORED list (a union with what is there, so the page, the account's answer and a second tab
 *  never drop each other's ids). Writes only when something is new. */
export function addSeen(userId: string | null | undefined, ids: Iterable<string>): void {
  if (!userId) return;
  const seen = loadSeen(userId);
  const before = seen.size;
  for (const id of ids) seen.add(id);
  if (seen.size !== before) saveSeen(userId, seen);
}

/**
 * Whether this device KNOWS what the account has seen: the account's list has been read here at least once, or (on
 * a server from before the migration) the device took its baseline. Until then the Collection shows no NEW badge at
 * all: an empty list is "not asked yet", never "nothing seen" (that reading is what badged the whole collection).
 */
export function hasSeenBaseline(userId: string | null | undefined): boolean {
  if (!userId) return false;
  try { return !!localStorage.getItem(BASELINE_KEY(userId)); } catch { return false; }
}

/** The account's own list landed: copy it here and note that this device now knows it. */
export function adoptAccountSeen(userId: string | null | undefined, ids: Iterable<string>): void {
  if (!userId) return;
  addSeen(userId, ids);
  try { localStorage.setItem(BASELINE_KEY(userId), '1'); } catch { /* best-effort */ }
}

/**
 * THE DEVICE BASELINE, only for a server from BEFORE the seen migration (the list cannot live on the account yet):
 * the first readable ownership list this device gets is taken as already seen, ONCE, so only what is earned after
 * that wears NEW. Returns the ids it just took, or null when there was nothing to do (already taken, or the
 * ownership could not be read: no `cosmetics`, so a failed read never burns it).
 */
export function ensureSeenBaseline(userId: string | null | undefined, profile: Pick<ProgressionProfile, 'cosmetics'> | null | undefined): readonly string[] | null {
  if (!userId || !profile?.cosmetics || hasSeenBaseline(userId)) return null;
  adoptAccountSeen(userId, profile.cosmetics);
  return profile.cosmetics;
}

/** An owned item not seen yet wears NEW. */
export const isNew = (id: string, owned: ReadonlySet<string>, seen: ReadonlySet<string>): boolean => owned.has(id) && !seen.has(id);
