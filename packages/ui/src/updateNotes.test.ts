// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { PatchNote } from './patchNotes';
import { dayBefore, notesSince, readUpdateSeen, shouldShowUpdated, UPDATE_SEEN_KEY, writeUpdateSeen } from './updateNotes';

const note = (date: string, label?: string): PatchNote => ({ date, label, changes: [{ category: 'Systems', text: `n${date}` }] });
const NOTES = [note('2026-11-04'), note('2026-11-03'), note('2026-10-30')];

const setDesktop = (on: boolean): void => {
  (globalThis as { ascentDesktop?: unknown }).ascentDesktop = on ? { isDesktop: true, quit() {}, toggleFullscreen() {} } : undefined;
};

afterEach(() => { setDesktop(false); localStorage.clear(); });

describe('notesSince', () => {
  it('keeps entries on or after the date (same-day entries stay) and drops older ones', () => {
    expect(notesSince(NOTES, '2026-11-03').map((n) => n.date)).toEqual(['2026-11-04', '2026-11-03']);
  });
  it('reaches back one day: a ship whose UTC date is a day ahead of the notes still lists them (R-UPDATE-NOTES-DAY-01)', () => {
    // v0.2.0 published 2026-11-05 UTC (the evening of 11-04 locally); the fix shipped in v0.2.1 is dated 2026-11-04.
    expect(notesSince(NOTES, '2026-11-05').map((n) => n.date)).toEqual(['2026-11-04']);
    expect(notesSince(NOTES, '2026-11-01').map((n) => n.date)).toEqual(['2026-11-04', '2026-11-03']);
    expect(dayBefore('2026-11-01')).toBe('2026-10-31');
    expect(dayBefore('2027-01-01')).toBe('2026-12-31');
  });
  it('with no known date returns only the newest entry', () => {
    expect(notesSince(NOTES, null).map((n) => n.date)).toEqual(['2026-11-04']);
  });
  it('is empty-safe', () => {
    expect(notesSince([], null)).toEqual([]);
  });
});

describe('shouldShowUpdated', () => {
  const seen = { version: '0.2.0', buildDate: '2026-11-03' };
  it('first ever launch (nothing stored) shows nothing', () => {
    setDesktop(true);
    expect(shouldShowUpdated(null, '0.2.1')).toBe(false);
  });
  it('a new version shows, the same version does not', () => {
    setDesktop(true);
    expect(shouldShowUpdated(seen, '0.2.1')).toBe(true);
    expect(shouldShowUpdated(seen, '0.2.0')).toBe(false);
  });
  it('never shows in the browser build', () => {
    setDesktop(false);
    expect(shouldShowUpdated(seen, '0.2.1')).toBe(false);
  });
});

describe('update-seen storage', () => {
  it('round-trips and tolerates junk', () => {
    expect(readUpdateSeen()).toBeNull();
    writeUpdateSeen({ version: '0.2.1', buildDate: '2026-11-04' });
    expect(readUpdateSeen()).toEqual({ version: '0.2.1', buildDate: '2026-11-04' });
    localStorage.setItem(UPDATE_SEEN_KEY, '{nope');
    expect(readUpdateSeen()).toBeNull();
    localStorage.setItem(UPDATE_SEEN_KEY, JSON.stringify({ version: 5 }));
    expect(readUpdateSeen()).toBeNull();
  });
});
