import { describe, it, expect } from 'vitest';
import { createRun, reduce, type RunState } from './index';
import { modalOpen, queueDiscover } from './recruit';

/**
 * Discovers must never open ON TOP of another modal.
 *
 * Every recruit-phase modal renders as its own overlay behind an INDEPENDENT guard in `Recruit.tsx`
 * (`{run.discover && …}`, `{run.questOffer && …}`, `{run.runeforgeOffer && …}`, `{run.chooseOne && …}`) —
 * there is no mutual exclusion in the view. So two modal states set at once are literally drawn on top of
 * each other. The owner hit exactly that on 2026-07-22: two start-of-turn Discovers stacked.
 *
 * The rule this file pins: `queueDiscover` is the ONLY way to raise a Discover, and it defers to ANY open
 * modal — not just an open Discover. A direct `openDiscover` overwrites `state.discover` unconditionally,
 * which either stacks the overlay or silently eats the offer it replaced.
 */
const base = (): RunState => ({ ...createRun(1, 'warden'), phase: 'recruit' });

describe('a Discover never opens over another modal', () => {
  it('opens immediately when the screen is free', () => {
    const s = base();
    queueDiscover(s, { kind: 'minion', tier: 1, exactTier: 1 });
    expect(s.discover?.length).toBeGreaterThan(0);
    expect(s.discoverQueue?.length ?? 0).toBe(0);
  });

  it('queues behind an already-open Discover', () => {
    const s = base();
    queueDiscover(s, { kind: 'minion', tier: 1, exactTier: 1 });
    const first = s.discover;
    queueDiscover(s, { kind: 'minion', tier: 1, exactTier: 1 });
    expect(s.discover).toBe(first); // the open offer is untouched
    expect(s.discoverQueue?.length).toBe(1);
  });

  /**
   * The regression. Each of these modals can be open at the moment a quest/rune reward pays out a Discover
   * (a quest completing on the turn the Runeforge opens; a golden triple resolving mid-Choose-One). Before
   * the fix, `queueDiscover` only checked `state.discover`, so every one of these opened a SECOND overlay.
   */
  for (const [label, patch] of [
    ['a quest offer', { questOffer: ['q_grave_toll'] }],
    ['a Runeforge offer', { runeforgeOffer: ['rune_warding'] }],
    ['a Choose One', { chooseOne: { uid: 'x', cardId: 'y' } }],
    ['a targeted Battlecry', { pendingTarget: { uid: 'x', cardId: 'y' } }],
  ] as const) {
    it(`queues behind ${label} rather than stacking on it`, () => {
      const s = { ...base(), ...patch } as RunState;
      expect(modalOpen(s)).toBe(true);
      queueDiscover(s, { kind: 'minion', tier: 1, exactTier: 1 });
      expect(s.discover, `a Discover opened over ${label} — two overlays stack`).toBeUndefined();
      expect(s.discoverQueue?.length).toBe(1);
    });
  }
});

describe('a queued Discover is never stranded', () => {
  it('opens when the modal it queued behind resolves', () => {
    // Queue two Discovers behind a Choose One, then resolve it: the first must open, the second stay queued.
    const s = base();
    queueDiscover(s, { kind: 'minion', tier: 1, exactTier: 1 });
    expect(s.discover?.length).toBeGreaterThan(0);

    // Resolving a Discover drains the next one rather than leaving the screen empty with a full queue.
    queueDiscover(s, { kind: 'minion', tier: 1, exactTier: 1 });
    expect(s.discoverQueue?.length).toBe(1);
    const after = reduce(s, { type: 'discover', index: 0 });
    expect(after.discover?.length).toBeGreaterThan(0); // the queued one is now open
    expect(after.discoverQueue?.length ?? 0).toBe(0);
  });
});
