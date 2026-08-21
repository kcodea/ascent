/**
 * The phase-advance schedule must be monotonic for EVERY slider configuration.
 *
 * The bug this pins (found live 2026-08-21): the voiceline's tuner mark doubled as the `voicing` phase
 * advance. Sliding it past `transformAtMs` made the materializing advance fire from `focusing` — an illegal
 * skip the single-step machine correctly rejects — and the ceremony wedged: no transform, no identity, no
 * Start Game. `ceremonyAdvanceSchedule` now orders the advances by construction, and the voiceline is pure
 * audio scheduled at its raw mark.
 */
import { describe, expect, it } from 'vitest';
import { HERO_CEREMONY_TIMING, ceremonyAdvanceSchedule, type HeroCeremonyTiming } from './heroCeremonyTiming';
import { CEREMONY_IDLE, ceremonyReduce, type HeroCeremonyState } from './heroCeremonyMachine';

const T = HERO_CEREMONY_TIMING;

/** Run the machine through the schedule's five advances in time order — the runner's exact behavior. */
function runSchedule(t: HeroCeremonyTiming): HeroCeremonyState {
  const sched = ceremonyAdvanceSchedule(t);
  const marks = [
    [sched.dismissAt, 'dismissing'], [sched.focusAt, 'focusing'], [sched.voicePhaseAt, 'voicing'],
    [sched.materializeAt, 'materializing'], [sched.readyAt, 'ready'],
  ] as const;
  // Stable sort by time — equal marks keep registration (= phase) order, exactly like the timer queue.
  const ordered = [...marks].sort((a, b) => a[0] - b[0]);
  let s = ceremonyReduce(CEREMONY_IDLE, { type: 'select', heroId: 'h', rect: { left: 0, top: 0, width: 100, height: 140 }, index: 0, now: 0 });
  for (const [, phase] of ordered) s = ceremonyReduce(s, { type: 'advance', to: phase });
  return s;
}

describe('ceremonyAdvanceSchedule is monotonic for any slider configuration', () => {
  it('the shipped defaults reach ready', () => {
    expect(runSchedule(T).phase).toBe('ready');
  });

  it('a voiceline slid PAST the transform still reaches ready (the shipped wedge)', () => {
    expect(runSchedule({ ...T, voiceAtMs: T.transformAtMs + 500 }).phase).toBe('ready');
  });

  it('…and does not delay the visuals: the materialize mark stays at transformAtMs', () => {
    const sched = ceremonyAdvanceSchedule({ ...T, voiceAtMs: T.transformAtMs + 500 });
    expect(sched.materializeAt).toBe(T.transformAtMs);
  });

  it('a voiceline slid before the focus start still reaches ready', () => {
    expect(runSchedule({ ...T, voiceAtMs: 0 }).phase).toBe('ready');
  });

  it('every pairwise extreme of the five marks still completes', () => {
    // Brute-force the corners: each timing knob at 0 and at 3000, independently.
    const keys: (keyof HeroCeremonyTiming)[] = ['optionExitDelayMs', 'focusDelayMs', 'voiceAtMs', 'transformAtMs', 'readyAtMs'];
    for (const a of keys) for (const va of [0, 3000]) for (const b of keys) for (const vb of [0, 3000]) {
      const t = { ...T, [a]: va, [b]: vb };
      expect(runSchedule(t).phase, `${a}=${va} ${b}=${vb} must not wedge the ceremony`).toBe('ready');
    }
  });

  it('marks are non-decreasing in phase order', () => {
    const t = { ...T, voiceAtMs: 2600, focusDelayMs: 900, optionExitDelayMs: 400 };
    const s = ceremonyAdvanceSchedule(t);
    expect(s.dismissAt).toBeLessThanOrEqual(s.focusAt);
    expect(s.focusAt).toBeLessThanOrEqual(s.voicePhaseAt);
    expect(s.voicePhaseAt).toBeLessThanOrEqual(s.materializeAt);
    expect(s.materializeAt).toBeLessThanOrEqual(s.readyAt);
  });
});
