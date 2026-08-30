import { describe, expect, it } from 'vitest';
import { chosenRuneIndex } from './runeLockInCapture';

/**
 * Which offered rune did a recorded player buy? (owner ask 2026-08-30: the lock-in ceremony must play in
 * replays too.) `buyRune` clears the whole offer, so the outcome alone does not say which of the three was
 * picked — which is why the index is now recorded on the frame.
 */
describe('recovering the chosen rune for a replayed ceremony', () => {
  const offer = ['brood', 'overtime', 'cindergem'];

  it('uses the recorded index when the replay has one', () => {
    expect(chosenRuneIndex(2, offer, [], ['cindergem'])).toBe(2);
  });

  it('trusts the recorded index over the owned-rune diff', () => {
    // They agree in practice; if they ever disagree the RECORDED action is the truth, not the reconstruction.
    expect(chosenRuneIndex(0, offer, [], ['cindergem'])).toBe(0);
  });

  it('ignores an out-of-range index rather than crowning nothing', () => {
    // Falls through to the diff, which can still answer.
    expect(chosenRuneIndex(9, offer, [], ['overtime'])).toBe(1);
    expect(chosenRuneIndex(-1, offer, [], ['overtime'])).toBe(1);
  });

  it('falls back to the owned-rune diff on a pre-2026-08-30 recording', () => {
    expect(chosenRuneIndex(undefined, offer, ['someother'], ['someother', 'brood'])).toBe(0);
  });

  it('refuses to guess when the purchase was a DUPLICATE', () => {
    // Already owned → the list does not grow → nothing distinguishes the three. Play no ceremony rather
    // than crown the wrong rune. This is the case the recorded index exists to rescue.
    expect(chosenRuneIndex(undefined, offer, ['brood'], ['brood'])).toBe(-1);
  });

  it('refuses to guess when more than one rune appeared', () => {
    expect(chosenRuneIndex(undefined, offer, [], ['brood', 'overtime'])).toBe(-1);
  });

  it('returns -1 when the gained rune was not one of the offered ones', () => {
    // A rune granted by something else in the same step — never attribute it to the forge.
    expect(chosenRuneIndex(undefined, offer, [], ['unrelated'])).toBe(-1);
  });
});
