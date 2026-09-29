/**
 * PATCH NOTES STAY CLEAN (2026-09-29). Merge-conflict resolutions on 2026-09-28 left three copies of that day's
 * notes (Enraged Strike, the damage formation, Phantom Blades and more, each listed 2-3 times). These pin the shape
 * so it cannot recur: one block per date + label (so one unlabeled block per date), every change once, newest first.
 * Rule: R-TEXT-PATCHNOTES-01.
 */
import { describe, expect, it } from 'vitest';
import { PATCH_NOTES, type PatchNote } from './patchNotes';

const keyOf = (n: Pick<PatchNote, 'date' | 'label'>): string => `${n.date}${n.label ? ` [${n.label}]` : ''}`;
const repeats = (xs: readonly string[]): string[] => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

/** The checks, as a pure function so the test can prove they catch a duplicate. */
function problems(notes: readonly PatchNote[]): string[] {
  const out: string[] = [];
  for (const k of repeats(notes.map(keyOf))) out.push(`duplicate block: ${k}`);
  for (const t of repeats(notes.flatMap((n) => n.changes.map((c) => c.text.trim())))) out.push(`duplicate change: ${t}`);
  notes.forEach((n, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n.date)) out.push(`bad date: ${n.date}`);
    const prev = notes[i - 1];
    if (prev && prev.date < n.date) out.push(`out of order: ${keyOf(n)} after ${keyOf(prev)}`);
    if (n.changes.length === 0) out.push(`empty block: ${keyOf(n)}`);
  });
  return out;
}

describe('patch notes: no duplicates', () => {
  it('one block per date + label, every change once, newest first', () => {
    expect(problems(PATCH_NOTES)).toEqual([]);
  });

  it('the check catches a repeated date and a repeated change', () => {
    const a: PatchNote = { date: '2026-09-28', changes: [{ category: 'Systems', text: 'A new Legendary hero attack, Enraged Strike, can drop from crates.' }] };
    const b: PatchNote = { date: '2026-09-28', changes: [{ category: 'Systems', text: 'Something else.' }, ...a.changes] };
    expect(problems([a, b])).toEqual([
      'duplicate block: 2026-09-28',
      'duplicate change: A new Legendary hero attack, Enraged Strike, can drop from crates.',
    ]);
    // A labeled patch on the same day is its own headline, not a duplicate.
    expect(problems([a, { ...b, label: 'Hotfix', changes: [{ category: 'Systems', text: 'Something else.' }] }])).toEqual([]);
  });
});
