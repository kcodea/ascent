import { describe, expect, it } from 'vitest';
import { claimPopSlot, livePopCount, MAX_STACKED_POPS } from './popStack';

/** R-BADGE-POP-STACK-01: a medallion bounces on every change, but never carries more than two pops at once. */
const fakeAnim = () => {
  const a = { cancelled: false, cancel() { a.cancelled = true; } };
  return a;
};

describe('pop stack cap (R-BADGE-POP-STACK-01)', () => {
  it('caps live pops on one element at two', () => {
    expect(MAX_STACKED_POPS).toBe(2);
  });

  it('a burst of pops keeps only the newest two, cancelling the oldest each time', () => {
    const badge = {};
    const anims = Array.from({ length: 6 }, fakeAnim);
    const slots = anims.map((a) => claimPopSlot(badge, a));
    // Every pop STARTED (each got a slot); only the newest two are still live.
    expect(livePopCount(badge)).toBe(2);
    expect(anims.map((a) => a.cancelled)).toEqual([true, true, true, true, false, false]);
    expect(slots.map((s) => s.evicted)).toEqual([true, true, true, true, false, false]);
  });

  it('a pop that finishes on its own frees its slot, so the next one evicts nothing', () => {
    const badge = {};
    const first = fakeAnim();
    const second = fakeAnim();
    claimPopSlot(badge, first).release();
    claimPopSlot(badge, second);
    const third = fakeAnim();
    claimPopSlot(badge, third);
    expect(first.cancelled).toBe(false);
    expect(second.cancelled).toBe(false);
    expect(livePopCount(badge)).toBe(2);
  });

  it('each element has its own stack', () => {
    const atk = {};
    const hp = {};
    const a = fakeAnim();
    claimPopSlot(atk, a);
    claimPopSlot(hp, fakeAnim());
    claimPopSlot(hp, fakeAnim());
    claimPopSlot(hp, fakeAnim());
    expect(a.cancelled).toBe(false);
    expect(livePopCount(atk)).toBe(1);
    expect(livePopCount(hp)).toBe(2);
  });

  it('releasing twice, or releasing an evicted slot, is harmless', () => {
    const badge = {};
    const s1 = claimPopSlot(badge, fakeAnim());
    claimPopSlot(badge, fakeAnim());
    claimPopSlot(badge, fakeAnim()); // evicts s1
    s1.release();
    s1.release();
    expect(livePopCount(badge)).toBe(2);
  });
});
