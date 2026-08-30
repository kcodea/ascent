/**
 * WHAT AUTO-CAPTURE IS ALLOWED TO RECORD (owner ruling 2026-08-29: *"the auto perf hud stuff should only
 * capture full real 'play' mode games"*).
 *
 * Pure predicate, so it is tested here rather than by driving the browser. The cases that matter are the
 * EXCLUSIONS: each one records numbers that would mislead a comparison rather than inform it, and a shared
 * viewer full of Scene Builder spikes is worse than an empty one.
 */
import { describe, expect, it } from 'vitest';
import { isRealPlayRun } from './perfCaptureScope';
import type { RunState } from '@game/sim';

const run = (over: Partial<RunState> = {}): RunState => ({ mode: 'ascent', ...over } as RunState);

describe('auto-capture scope', () => {
  it('captures a real Ascent run', () => {
    expect(isRealPlayRun(run())).toBe(true);
  });

  it('treats an ABSENT mode as ascent, because RunState says so', () => {
    // `mode?: RunMode` with "Absent = 'ascent'" — a predicate that missed this would silently stop capturing
    // the most common case.
    expect(isRealPlayRun(run({ mode: undefined }))).toBe(true);
  });

  it('skips practice — a 3× shop timer and unlimited health is not the phase mix players see', () => {
    expect(isRealPlayRun(run({ mode: 'practice' }))).toBe(false);
  });

  it('skips the Scene Builder sandbox even though it rides ascent-shaped state', () => {
    // The sandbox is an ADDITIVE flag, not its own RunMode, so a mode-only check would let it through — and
    // it exists to hold pathological boards still, so its spikes would dominate every ranking.
    expect(isRealPlayRun(run({ mode: 'ascent', sandbox: true }))).toBe(false);
  });

  it('skips tutorial and rift', () => {
    expect(isRealPlayRun(run({ mode: 'tutorial' }))).toBe(false);
    expect(isRealPlayRun(run({ mode: 'rift' }))).toBe(false);
  });

  it('skips having no run at all — idling on the title is not a game', () => {
    expect(isRealPlayRun(null)).toBe(false);
    expect(isRealPlayRun(undefined)).toBe(false);
  });
});
