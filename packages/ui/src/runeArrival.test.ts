import { describe, expect, it } from 'vitest';
import { arrivalClasses } from './runeArrival';
import type { RuneArrivalCue } from './useRuneArrivalFx';

/**
 * THE RUNE ARRIVAL, PER SLOT (owner report 2026-08-31: *"the rune's art pop in is only working on the first
 * rune — make sure it works on all 3 slots"*).
 *
 * The bug was two indices that are only equal in one case. A badge is identified by which COPY OF ITS OWN ID
 * it is (the occurrence), because that is the only thing telling two badges apart when Rune of Duplication
 * puts the same rune in the tray twice — and `badgeCenterOf` resolves the FX anchor that way too. The tray
 * walk was matching on the SLOT instead, which is the same number only for the first rune of a run.
 */
const cue = (runeId: string, occurrence: number, phase: 'pending' | 'arrived' = 'arrived'): RuneArrivalCue =>
  ({ runeId, occurrence, phase, seq: 1 });

describe('rune arrival — which badge lights up', () => {
  it('marks the arriving rune in ANY slot, not just the first', () => {
    const tray = ['rune_a', 'rune_b', 'rune_c'];
    // The regression, stated three times: every slot must be reachable.
    expect(arrivalClasses(tray, cue('rune_a', 0))).toEqual([' rune-arrived', '', '']);
    expect(arrivalClasses(tray, cue('rune_b', 0))).toEqual(['', ' rune-arrived', '']);
    expect(arrivalClasses(tray, cue('rune_c', 0))).toEqual(['', '', ' rune-arrived']);
  });

  it('counts OCCURRENCES of one id, so a duplicated rune lights only the copy that arrived', () => {
    // Rune of Duplication is why the cue carries an occurrence at all. Slot 2 holds the SECOND `rune_a`, and
    // an arrival for occurrence 1 must land there and nowhere else.
    const tray = ['rune_a', 'rune_b', 'rune_a'];
    expect(arrivalClasses(tray, cue('rune_a', 1))).toEqual(['', '', ' rune-arrived']);
    expect(arrivalClasses(tray, cue('rune_a', 0))).toEqual([' rune-arrived', '', '']);
  });

  it('holds the art back while the ceremony is still running', () => {
    // `pending` is the whole reason the badge does not simply appear finished: the buy resolves before the
    // ceremony starts, so without this the tray is ahead of the story it is being told.
    expect(arrivalClasses(['rune_a', 'rune_b'], cue('rune_b', 0, 'pending'))).toEqual(['', ' rune-arriving']);
  });

  it('marks nothing when no ceremony is running, or when the cue names a rune not in the tray', () => {
    expect(arrivalClasses(['rune_a', 'rune_b'], null)).toEqual(['', '']);
    expect(arrivalClasses(['rune_a'], cue('rune_z', 0))).toEqual(['']);
    // An occurrence past the end is the sold/removed case — no badge, no class, no crash.
    expect(arrivalClasses(['rune_a'], cue('rune_a', 1))).toEqual(['']);
  });

  it('an empty tray is not a crash', () => {
    expect(arrivalClasses([], cue('rune_a', 0))).toEqual([]);
  });
});
