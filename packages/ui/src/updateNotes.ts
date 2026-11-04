/**
 * The desktop app's "what changed" bookkeeping (desktop auto-update, spec 2026-11-04). Pure helpers: no React, and
 * deliberately NOT importing the `patchNotes.ts` list (its ~400 KB of text stays in its own lazy chunk; callers hand
 * the list in).
 *
 * The seen record is `{ version, buildDate }` under `ascent.desktop.updateSeen`: the build the player last
 * acknowledged, with its ship date as `YYYY-MM-DD` so it compares against `PatchNote.date` as a plain string.
 * Storage is try/catch-wrapped (private mode, cleared data): a blocked store just means no panel.
 */
import { isDesktop } from './desktop';
import type { PatchNote } from './patchNotes';

export const UPDATE_SEEN_KEY = 'ascent.desktop.updateSeen';

export interface UpdateSeen { version: string; buildDate: string }

/** Entries dated on or after `sinceDate` (a same-day entry may have shipped after the old build, so `>=`). With no
 *  known date, only the newest entry. `notes` is newest first. */
export function notesSince(notes: PatchNote[], sinceDate: string | null): PatchNote[] {
  if (sinceDate === null) return notes.slice(0, 1);
  return notes.filter((n) => n.date >= sinceDate);
}

export function readUpdateSeen(): UpdateSeen | null {
  try {
    const raw = localStorage.getItem(UPDATE_SEEN_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<UpdateSeen> | null;
    return v && typeof v.version === 'string' && typeof v.buildDate === 'string' ? { version: v.version, buildDate: v.buildDate } : null;
  } catch {
    return null;
  }
}

export function writeUpdateSeen(v: UpdateSeen): void {
  try { localStorage.setItem(UPDATE_SEEN_KEY, JSON.stringify(v)); } catch { /* storage blocked: the panel just may repeat */ }
}

/** Desktop only. A first-ever launch (nothing stored) shows nothing: the panel is for the version AFTER one you saw. */
export function shouldShowUpdated(seen: UpdateSeen | null, currentVersion: string): boolean {
  return isDesktop() && seen !== null && seen.version !== currentVersion;
}
