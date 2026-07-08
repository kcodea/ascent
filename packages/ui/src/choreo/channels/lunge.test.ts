import { afterEach, describe, expect, it, vi } from 'vitest';
import { playLunge } from './lunge';

// This repo runs Vitest in the NODE environment (no jsdom) — sibling tests use a stubbed Element, not
// document.createElement. `playLunge` reads getBoundingClientRect + classList + querySelector off the
// attacker, so the stub supplies those. (gsap prints benign "Invalid property x/y" warnings when tweening a
// non-DOM object — expected, does not fail the tests.)
const fakeEl = (): Element => ({
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
  classList: { contains: () => false },
  querySelector: () => null,
}) as unknown as Element;

afterEach(() => vi.restoreAllMocks());

describe('playLunge', () => {
  it('fires onContact exactly once when the timeline is seeked to completion', () => {
    const onContact = vi.fn();
    const tl = playLunge({ attacker: fakeEl(), dx: 40, dy: 0, speed: 1, onContact });
    tl.progress(1);
    expect(onContact).toHaveBeenCalledTimes(1);
  });

  it('onContact fires BEFORE the timeline fully completes (mid-timeline, at the smack-lead position)', () => {
    let contactAtProgress = -1;
    const tl = playLunge({ attacker: fakeEl(), dx: 40, dy: 0, speed: 1, onContact: () => { contactAtProgress = tl.progress(); } });
    // Seek to 0.99 (not 1): an exact end-jump makes gsap report progress()===1 inside the callback, masking
    // that contact truly fires mid-timeline. 0.99 is past the contact position (~0.33) yet before completion.
    tl.progress(0.99);
    expect(contactAtProgress).toBeGreaterThan(0);
    expect(contactAtProgress).toBeLessThan(1);
  });

  it('timeScales the whole timeline by the given speed', () => {
    const tl = playLunge({ attacker: fakeEl(), dx: 10, dy: 0, speed: 2, onContact: () => {} });
    expect(tl.timeScale()).toBe(2);
  });
});
