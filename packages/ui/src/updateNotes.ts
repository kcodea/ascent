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

/** Entries dated on or after the day BEFORE `sinceDate` (R-UPDATE-NOTES-DAY-01). `sinceDate` is a UTC date (a build's
 *  or a release's timestamp) while patch notes are dated by the owner's own calendar, so an evening ship in the Americas
 *  is already "tomorrow" in UTC: v0.2.1's notes came out empty because v0.2.0 published 2026-11-05 UTC, the evening of
 *  2026-11-04 locally. Showing a day's notes twice is harmless; dropping a fix is not. With no known date, only the
 *  newest entry. `notes` is newest first. */
export function notesSince(notes: PatchNote[], sinceDate: string | null): PatchNote[] {
  if (sinceDate === null) return notes.slice(0, 1);
  const from = dayBefore(sinceDate);
  return notes.filter((n) => n.date >= from);
}

/** `YYYY-MM-DD` one calendar day earlier (an unparseable date is returned unchanged). */
export function dayBefore(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(t) ? date : new Date(t - 86_400_000).toISOString().slice(0, 10);
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
