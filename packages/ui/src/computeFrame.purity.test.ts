import { describe, expect, it } from 'vitest';
import type { CombatEvent, MinionSnapshot } from '@game/core';
import { computeFrame } from './useCombatReplay';

const snap = (uid: string, health: number): MinionSnapshot =>
  ({ uid, cardId: 'sandbag', name: 'Sandbag', tribe: 'neutral', attack: 1, health, keywords: [] }) as MinionSnapshot;

const initial = { player: [snap('p1', 10)], enemy: [snap('e1', 10)] };
const events = [
  { type: 'attack', attacker: 'p1', defender: 'e1', step: 1 },
  { type: 'dmg', target: 'e1', amount: 3, step: 1 },
  { type: 'attack', attacker: 'e1', defender: 'p1', step: 2 },
  { type: 'dmg', target: 'p1', amount: 2, step: 2 },
] as unknown as CombatEvent[];
const names = new Map<string, string>();

/**
 * THE property the proc harness rests on. `seekTo` jumps `beatIdx` to an arbitrary moment, and that is only
 * safe because `computeFrame` rebuilds the board from `initial` on every call rather than folding
 * incrementally from the previous frame.
 *
 * If anyone ever "optimises" it into an incremental update — a reasonable-looking perf change — seeking
 * breaks SILENTLY: the board would show whatever state the last-played beat left behind. These tests are
 * what make that a red build instead of a bug report.
 */
describe('computeFrame is a from-scratch fold', () => {
  it('gives the same result for the same arguments, called twice', () => {
    const a = computeFrame(initial, events, 4, 2, names);
    const b = computeFrame(initial, events, 4, 2, names);
    expect(b).toEqual(a);
  });

  // The seek case: reaching beat N by jumping must equal reaching it by playing forward.
  it('is unaffected by what was computed before it — jumping equals playing forward', () => {
    const direct = computeFrame(initial, events, 4, 2, names);
    computeFrame(initial, events, 1, 0, names);
    computeFrame(initial, events, 2, 1, names);
    computeFrame(initial, events, 3, 2, names);
    const afterWalking = computeFrame(initial, events, 4, 2, names);
    expect(afterWalking).toEqual(direct);
  });

  // Backwards too — the harness re-seeks the same moment repeatedly while tuning.
  it('is unaffected by having previously computed a LATER frame', () => {
    const early = computeFrame(initial, events, 1, 0, names);
    computeFrame(initial, events, 4, 2, names);
    expect(computeFrame(initial, events, 1, 0, names)).toEqual(early);
  });

  // Guards the guard: every case above compares computeFrame against itself, which an inert function
  // returning a constant would also satisfy. This is what makes the suite prove it is actually folding.
  it('produces different frames for different upto values', () => {
    expect(computeFrame(initial, events, 4, 2, names)).not.toEqual(computeFrame(initial, events, 1, 0, names));
  });

  it('does not mutate the initial snapshots it is given', () => {
    const before = JSON.stringify(initial);
    computeFrame(initial, events, 4, 2, names);
    expect(JSON.stringify(initial)).toBe(before);
  });
});
