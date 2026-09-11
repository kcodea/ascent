/**
 * WHAT AUTO-CAPTURE IS ALLOWED TO RECORD (owner ruling 2026-08-29: *"the auto perf hud stuff should only
 * capture full real 'play' mode games"*).
 *
 * Pure predicate, so it is tested here rather than by driving the browser. The case that matters MOST is the
 * one that regressed: the Play button starts a LOBBY run, and a predicate written for the pre-lobby `'ascent'`
 * mode dropped every real game at the end (2026-09-11). Then the EXCLUSIONS: each one records numbers that
 * would mislead a comparison rather than inform it, and a shared viewer full of Scene Builder spikes is worse
 * than an empty one. The "finished games only" half of the rule lives at the call site and is pinned by
 * `perfAutoShare.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { isRealPlayRun } from './perfCaptureScope';
import type { RunMode, RunState } from '@game/sim';

const run = (over: Partial<RunState> = {}): RunState => ({ mode: 'lobby', ...over } as RunState);

describe('auto-capture scope', () => {
  it('captures a normal Play game — a LOBBY run, which is what the Play button starts', () => {
    // `Title.tsx` → `startLobby()` → `pendingMode: 'lobby'`. This is the primary player mode and the whole
    // point of the analytics; the predicate shipped without it.
    expect(isRealPlayRun(run({ mode: 'lobby' }))).toBe(true);
  });

  it('still captures a legacy Ascent run — the scored climb the store can still start', () => {
    expect(isRealPlayRun(run({ mode: 'ascent' }))).toBe(true);
  });

  it('treats an ABSENT mode as ascent, because RunState says so (an older save on Continue)', () => {
    // `mode?: RunMode` with "Absent = 'ascent'" — a predicate that missed this would drop a resumed legacy run.
    expect(isRealPlayRun(run({ mode: undefined }))).toBe(true);
  });

  it('skips practice — a 3× shop timer and unlimited health is not the phase mix players see', () => {
    expect(isRealPlayRun(run({ mode: 'practice' }))).toBe(false);
  });

  it('skips the tutorial — scripted and short', () => {
    expect(isRealPlayRun(run({ mode: 'tutorial' }))).toBe(false);
  });

  it('skips rift — its own ruleset', () => {
    expect(isRealPlayRun(run({ mode: 'rift' }))).toBe(false);
  });

  it('skips the Scene Builder sandbox whatever mode it rides', () => {
    // The sandbox is an ADDITIVE flag, not its own RunMode, so a mode-only check would let it through — and
    // it exists to hold pathological boards still, so its spikes would dominate every ranking. It rides lobby
    // (practice-bots) mechanics today and rode ascent-shaped state before; both stay out.
    expect(isRealPlayRun(run({ mode: 'lobby', sandbox: true }))).toBe(false);
    expect(isRealPlayRun(run({ mode: 'ascent', sandbox: true }))).toBe(false);
    expect(isRealPlayRun(run({ mode: 'practice', sandbox: true }))).toBe(false);
  });

  it('skips having no run at all — idling on the title is not a game', () => {
    expect(isRealPlayRun(null)).toBe(false);
    expect(isRealPlayRun(undefined)).toBe(false);
  });

  it('decides every RunMode explicitly — a new mode is excluded until someone rules on it', () => {
    // The full union, so adding a mode fails here rather than silently landing on one side of the gate.
    const verdict: Record<RunMode, boolean> = { lobby: true, ascent: true, practice: false, tutorial: false, rift: false };
    for (const [mode, expected] of Object.entries(verdict) as [RunMode, boolean][]) {
      expect(isRealPlayRun(run({ mode })), mode).toBe(expected);
    }
  });
});
