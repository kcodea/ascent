import { describe, expect, it } from 'vitest';
import { bumpedSlots, captureSlots, type RuneSlotPulse } from './runeTriggerFx';

/**
 * The pure half of the rune-trigger flourish — "which rune slots fired since the last look".
 *
 * The DOM half (`badgeCenterOf`, `useRuneTriggerFx`) is not testable here for the same reason `recruitCues`
 * is not: this repo runs no jsdom. What IS worth pinning is the edge-detection, because every one of its
 * rules exists to stop a specific wrong burst — a first paint detonating every owned rune, a duplicated rune
 * firing once for two badges, or a counter RESET going blind for a whole combat.
 */

const slot = (s: number, id: string, pulse: number): RuneSlotPulse => ({ slot: s, id, pulse });

describe('bumpedSlots', () => {
  it('fires nothing on the first look — an initial count is a state, not an event', () => {
    // The guard against a page load / mid-combat remount detonating every rune the player owns at once.
    expect(bumpedSlots([slot(0, 'r_a', 3), slot(1, 'r_b', 0)], new Map())).toEqual([]);
  });

  it('fires the slot whose count moved, and only that one', () => {
    const prev = new Map([[0, 1], [1, 4]]);
    const fired = bumpedSlots([slot(0, 'r_a', 2), slot(1, 'r_b', 4)], prev);
    expect(fired.map((f) => f.slot)).toEqual([0]);
  });

  it('fires on ANY change, including a decrease', () => {
    // `combatTriggeredQuests` is reset to {} when a replay ends and re-derived per fight, so the counts are
    // not globally monotonic. A strict `>` test would go blind for the whole of the next combat after a
    // reset dropped the number — the rune would fire its bounce and no burst.
    const fired = bumpedSlots([slot(0, 'r_a', 0)], new Map([[0, 5]]));
    expect(fired.map((f) => f.slot)).toEqual([0]);
  });

  it('treats a DUPLICATED rune as two independent badges', () => {
    // Rune of Duplication puts one id in `ownedRunes` twice. Keyed by id these would share a count and only
    // one could ever fire; keyed by slot they are separate.
    const prev = new Map([[0, 1], [1, 1]]);
    const fired = bumpedSlots([slot(0, 'r_dup', 2), slot(1, 'r_dup', 1)], prev);
    expect(fired.map((f) => f.slot)).toEqual([0]);
    expect(fired).toHaveLength(1);
  });

  it('does not fire a slot that is new this pass, even beside one that bumped', () => {
    const prev = new Map([[0, 1]]);
    const fired = bumpedSlots([slot(0, 'r_a', 2), slot(1, 'r_new', 7)], prev);
    expect(fired.map((f) => f.slot)).toEqual([0]);
  });
});

describe('captureSlots', () => {
  it('records the current counts in place', () => {
    const prev = new Map<number, number>();
    captureSlots([slot(0, 'r_a', 2), slot(1, 'r_b', 5)], prev);
    expect([...prev.entries()]).toEqual([[0, 2], [1, 5]]);
  });

  it('drops slots that no longer exist, so a re-used slot index cannot inherit a stale count', () => {
    // A sold rune frees its slot; the next rune to land there must not be compared against the old one's
    // count (which would fire a phantom burst the instant it appeared).
    const prev = new Map([[0, 1], [1, 9]]);
    captureSlots([slot(0, 'r_a', 1)], prev);
    expect([...prev.keys()]).toEqual([0]);
  });

  it('round-trips with bumpedSlots — capture then re-check fires nothing', () => {
    const prev = new Map<number, number>();
    const now = [slot(0, 'r_a', 4), slot(1, 'r_b', 2)];
    captureSlots(now, prev);
    expect(bumpedSlots(now, prev)).toEqual([]);
  });
});
