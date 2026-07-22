import { describe, it, expect } from 'vitest';
import { isStepProcTick } from './stepProcFxConfig';

/**
 * The step-proc FX fires when a unit's step counter completes. These lock the tick rule — in particular the
 * AVENGE case (owner report 2026-07-21), where the tally advances by more than one in a single beat and the
 * counter never displays the full reading.
 */
describe('isStepProcTick', () => {
  it('never fires on first sight of a counter (a card entering play already full must not burst)', () => {
    expect(isStepProcTick(null, 4, 4)).toBe(false);
    expect(isStepProcTick(null, 1, 4)).toBe(false);
  });

  it('does not fire when the value is unchanged (a re-render, not a tick)', () => {
    expect(isStepProcTick(4, 4, 4)).toBe(false);
    expect(isStepProcTick(2, 2, 4)).toBe(false);
  });

  it('fires when a cyclic counter LANDS on total (Guel: 3/4 → 4/4)', () => {
    expect(isStepProcTick(3, 4, 4)).toBe(true);
  });

  it('does not fire on ordinary partial ticks', () => {
    expect(isStepProcTick(1, 2, 4)).toBe(false);
    expect(isStepProcTick(2, 3, 4)).toBe(false);
  });

  it('does not double-fire on the post-proc reset (4/4 → 1/4 already fired when it landed)', () => {
    expect(isStepProcTick(4, 1, 4)).toBe(false);
  });

  // The Avenge bug: friendly deaths can arrive two-at-a-time (AoE / cleave / death cascade), so a 4-threshold
  // steps 3/4 → 1/4 and never shows 4/4 — but the Avenge did fire, so the burst must too.
  it('fires when a multi-tick beat SKIPS past total (Avenge: 3/4 → 1/4)', () => {
    expect(isStepProcTick(3, 1, 4)).toBe(true);
    expect(isStepProcTick(2, 1, 4)).toBe(true);   // 2 → (3,4 procced) → 1
    expect(isStepProcTick(3, 2, 4)).toBe(true);   // 3 → (4 procced) → 5 ⇒ shows 2
  });

  it('handles a threshold of 2 (Avenge every 2 deaths), including the skip', () => {
    expect(isStepProcTick(1, 2, 2)).toBe(true);   // landed
    expect(isStepProcTick(2, 1, 2)).toBe(false);  // post-proc reset
    expect(isStepProcTick(1, 1, 2)).toBe(false);  // unchanged
  });

  // Count-up counters clamp at their threshold and never wrap.
  it('fires once when a count-up reaches its threshold (Spirit Pup / Tara)', () => {
    expect(isStepProcTick(9, 10, 10)).toBe(true);
    expect(isStepProcTick(10, 10, 10)).toBe(false); // held at full — no re-fire
  });

  // The cadence counter counts DOWN ("2 Turns" → "1 Turn") and resets UP to total on the turn it fires.
  it('fires on the cadence reset, not on its countdown', () => {
    expect(isStepProcTick(2, 1, 2)).toBe(false);  // ticking down — not yet
    expect(isStepProcTick(1, 2, 2)).toBe(true);   // fired + reset
    expect(isStepProcTick(3, 2, 3)).toBe(false);  // 3 Turns → 2 Turns
    expect(isStepProcTick(1, 3, 3)).toBe(true);   // fired + reset
  });
});
