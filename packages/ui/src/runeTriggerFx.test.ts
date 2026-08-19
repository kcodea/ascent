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

  it('fires the slot whose count rose, and only that one', () => {
    const prev = new Map([[0, { pulse: 1 }], [1, { pulse: 4 }]]);
    const fired = bumpedSlots([slot(0, 'r_a', 2), slot(1, 'r_b', 4)], prev);
    expect(fired.map((f) => f.slot.slot)).toEqual([0]);
    expect(fired[0]!.times).toBe(1);
  });

  it('does NOT fire on a decrease — the combat-end reset must not burst the badge', () => {
    // Owner report 2026-08-19: a burst appeared once combat ENDED. `combatTriggeredQuests` is set to `{}` the
    // moment combat settles, so a rune that fired twice goes 2 -> 0; the first cut treated any change as a
    // fire and popped the badge on that reset, after the fight, attributable to nothing.
    expect(bumpedSlots([slot(0, 'r_a', 0)], new Map([[0, { pulse: 2 }]]))).toEqual([]);
  });

  it('reports a jump of N as N fires, so two triggers in one commit are two bursts', () => {
    // The other half of the same report: the second Void Cub never popped. The replay can reveal two
    // triggers in one commit, and a "did it change" test collapses them into a single burst.
    const fired = bumpedSlots([slot(0, 'r_a', 3)], new Map([[0, { pulse: 1 }]]));
    expect(fired).toHaveLength(1);
    expect(fired[0]!.times).toBe(2);
  });

  it('re-fires normally on the fight AFTER a reset', () => {
    // Guards the worry that motivated the (wrong) any-change rule: once the reset has been recorded as the
    // new baseline, the next combat's first trigger is an ordinary increase and fires.
    const prev = new Map<number, { pulse: number; seq?: number }>();
    captureSlots([slot(0, 'r_a', 2)], prev);            // end of fight 1
    expect(bumpedSlots([slot(0, 'r_a', 0)], prev)).toEqual([]); // the reset — silent
    captureSlots([slot(0, 'r_a', 0)], prev);
    const next = bumpedSlots([slot(0, 'r_a', 1)], prev); // fight 2, first trigger
    expect(next.map((f) => f.slot.slot)).toEqual([0]);
    expect(next[0]!.times).toBe(1);
  });

  it('treats a DUPLICATED rune as two independent badges', () => {
    // Rune of Duplication puts one id in `ownedRunes` twice. Keyed by id these would share a count and only
    // one could ever fire; keyed by slot they are separate.
    const prev = new Map([[0, { pulse: 1 }], [1, { pulse: 1 }]]);
    const fired = bumpedSlots([slot(0, 'r_dup', 2), slot(1, 'r_dup', 1)], prev);
    expect(fired.map((f) => f.slot.slot)).toEqual([0]);
    expect(fired).toHaveLength(1);
  });

  it('does not fire a slot that is new this pass, even beside one that bumped', () => {
    const prev = new Map([[0, { pulse: 1 }]]);
    const fired = bumpedSlots([slot(0, 'r_a', 2), slot(1, 'r_new', 7)], prev);
    expect(fired.map((f) => f.slot.slot)).toEqual([0]);
  });
});

describe('bumpedSlots — the seq channel', () => {
  it('treats ANY seq change as exactly ONE fire, however far it jumped', () => {
    // `questTendrilSeq` is a global per-action counter, so its delta counts ACTIONS, not procs. Folding it
    // into `pulse` would have fired one burst per intervening action for a single End-of-Turn trigger.
    const prev = new Map<number, { pulse: number; seq?: number }>([[0, { pulse: 0, seq: 3 }]]);
    const fired = bumpedSlots([{ slot: 0, id: 'r_eot', pulse: 0, seq: 47 }], prev);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.times).toBe(1);
  });

  it('does not fire when the seq is unchanged', () => {
    const prev = new Map<number, { pulse: number; seq?: number }>([[0, { pulse: 0, seq: 3 }]]);
    expect(bumpedSlots([{ slot: 0, id: 'r_eot', pulse: 0, seq: 3 }], prev)).toEqual([]);
  });

  it('caps a runaway repeat count rather than storming the frame', () => {
    const prev = new Map<number, { pulse: number; seq?: number }>([[0, { pulse: 0 }]]);
    const fired = bumpedSlots([slot(0, 'r_a', 500)], prev);
    expect(fired[0]!.times).toBe(4);
  });
});

describe('captureSlots', () => {
  it('records the current counts in place', () => {
    const prev = new Map<number, { pulse: number; seq?: number }>();
    captureSlots([slot(0, 'r_a', 2), slot(1, 'r_b', 5)], prev);
    expect([...prev.entries()]).toEqual([[0, { pulse: 2, seq: undefined }], [1, { pulse: 5, seq: undefined }]]);
  });

  it('drops slots that no longer exist, so a re-used slot index cannot inherit a stale count', () => {
    // A sold rune frees its slot; the next rune to land there must not be compared against the old one's
    // count (which would fire a phantom burst the instant it appeared).
    const prev = new Map([[0, { pulse: 1 }], [1, { pulse: 9 }]]);
    captureSlots([slot(0, 'r_a', 1)], prev);
    expect([...prev.keys()]).toEqual([0]);
  });

  it('round-trips with bumpedSlots — capture then re-check fires nothing', () => {
    const prev = new Map<number, { pulse: number; seq?: number }>();
    const now = [slot(0, 'r_a', 4), slot(1, 'r_b', 2)];
    captureSlots(now, prev);
    expect(bumpedSlots(now, prev)).toEqual([]);
  });
});
