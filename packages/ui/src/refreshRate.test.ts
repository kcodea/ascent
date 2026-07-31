import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REFRESH_HZ, JANK_FRAMES, LONG_FRAME_FRAMES, MAX_REFRESH_HZ, MIN_SAMPLES, REFRESH_LADDER,
  SLOW_CONFIRMATIONS, estimateRefreshHz, initialRefreshState, nextRefreshState, snapToLadder, thresholdsFor,
} from './refreshRate';

/**
 * These are the calibration under every `long` / `jank` number the perf HUD reports, and a mis-derived
 * threshold fails SILENTLY — it reports a clean session while frames drop. So the adversarial inputs are
 * pinned explicitly: a loaded warm-up, a throttled stretch, an absurd sample, and VRR jitter.
 */

/** n intervals of `ms`, with `jitterPct` of uniform-ish spread, deterministically (no Math.random). */
const stream = (ms: number, n: number, jitterPct = 0): number[] =>
  Array.from({ length: n }, (_, i) => ms * (1 + jitterPct * Math.sin(i * 2.399963)));

describe('refresh estimation — the fastest cadence, not the average one', () => {
  it('reads a clean 240 Hz stream as 240', () => {
    expect(estimateRefreshHz(stream(1000 / 240, 240))).toBe(240);
  });

  it('reads a clean 60 Hz stream as 60, and 360 as 360', () => {
    expect(estimateRefreshHz(stream(1000 / 60, 60))).toBe(60);
    expect(estimateRefreshHz(stream(1000 / 360, 360))).toBe(360);
  });

  it('A LOADED WARM-UP still reads the true refresh — the whole reason for a low percentile', () => {
    // The first second of a session is the most loaded second there is (module eval, shader link, first
    // paint). Nine frames in ten blow the budget; only one in ten hits the panel cadence. A mean or median
    // would read ~30 Hz here and then under-report for the rest of the session.
    const loaded = [
      ...Array.from({ length: 200 }, (_, i) => 12 + (i % 7)), // hitching badly
      ...Array.from({ length: 40 }, () => 1000 / 240),        // …but the panel is still a 240 Hz panel
    ];
    expect(estimateRefreshHz(loaded)).toBe(240);
    // Sanity: the mean of that stream is nowhere near the truth.
    const mean = loaded.reduce((a, v) => a + v, 0) / loaded.length;
    expect(1000 / mean).toBeLessThan(100);
  });

  it('tolerates rAF double-firing (near-zero deltas) instead of latching onto the minimum', () => {
    // The bare minimum would read these as thousands of Hz; a decile absorbs them.
    const s = [...stream(1000 / 120, 200), 0.02, 0.05, 0.01, 0.03];
    expect(estimateRefreshHz(s)).toBe(120);
  });

  it('rejects an ABSURD sample as no evidence rather than clamping it into range', () => {
    // Clamping would launder a broken clock into a confident-looking 1000 Hz / 24 Hz reading.
    expect(estimateRefreshHz(stream(0.05, 100))).toBeNull();  // ~20000 Hz
    expect(estimateRefreshHz(stream(200, 100))).toBeNull();   // 5 Hz — a stalled tab, not a display
  });

  it('rejects a THROTTLED window (few, long frames) as no evidence', () => {
    // A backgrounded tab is excluded upstream by the `hidden` flag; this is the belt-and-braces case where
    // rAF is throttled for some other reason and delivers a handful of 100ms+ frames.
    expect(estimateRefreshHz(stream(120, 8))).toBeNull();   // too few samples
    expect(estimateRefreshHz([])).toBeNull();
    expect(estimateRefreshHz(stream(1000 / 240, MIN_SAMPLES - 1))).toBeNull();
  });

  it('discards non-finite and non-positive intervals rather than dividing by them', () => {
    const s = [...stream(1000 / 144, 150), 0, -3, NaN, Infinity];
    expect(estimateRefreshHz(s)).toBe(144);
  });

  it('a VRR / jittery stream lands on ONE ladder rung instead of wandering', () => {
    // G-Sync never holds a clean cadence, so a raw estimate wobbles (143.2, 146.9, 141.8 …) and the
    // thresholds would wobble with it. Every one of these windows must produce the same 144.
    for (const jitter of [0.01, 0.02, 0.03, 0.04]) {
      expect(estimateRefreshHz(stream(1000 / 144, 144, jitter))).toBe(144);
    }
  });

  it('does not invent a rung for a rate that is genuinely off-ladder', () => {
    // 130 Hz is >6% from both 120 and 144, so it stays raw rather than being snapped to a lie.
    expect(snapToLadder(130)).toBe(130);
    expect(snapToLadder(238)).toBe(240);
    expect(snapToLadder(61.4)).toBe(60);
  });

  it('every ladder rung is inside the plausible band and strictly ascending', () => {
    for (let i = 1; i < REFRESH_LADDER.length; i++) expect(REFRESH_LADDER[i]!).toBeGreaterThan(REFRESH_LADDER[i - 1]!);
    expect(REFRESH_LADDER[REFRESH_LADDER.length - 1]!).toBeLessThanOrEqual(MAX_REFRESH_HZ);
  });
});

describe('threshold derivation', () => {
  it('reproduces the historic 33 / 50 ms constants at 60 Hz, so old logs stay comparable', () => {
    const th = thresholdsFor(60);
    expect(th.frameMs).toBeCloseTo(16.67, 2);
    expect(th.longFrameMs).toBeCloseTo(33.33, 1);
    expect(th.jankMs).toBeCloseTo(50, 1);
  });

  it('at 240 Hz the budget is 4.17 ms and long fires at 8.33, not 33', () => {
    const th = thresholdsFor(240);
    expect(th.frameMs).toBeCloseTo(4.17, 2);
    expect(th.longFrameMs).toBeCloseTo(8.33, 2);
    expect(th.jankMs).toBeCloseTo(12.5, 2);
    // The bug this fixes: a 16.7 ms frame is FINE at 60 Hz and 4x over budget at 240.
    expect(16.7).toBeGreaterThan(th.longFrameMs);
    expect(16.7).toBeLessThan(thresholdsFor(60).longFrameMs);
  });

  it('at 360 Hz the stretch budget is 2.78 ms', () => {
    expect(thresholdsFor(360).frameMs).toBeCloseTo(2.78, 2);
  });

  it('long is always exactly 2 frames and jank exactly 3, at every rung', () => {
    for (const hz of REFRESH_LADDER) {
      const th = thresholdsFor(hz);
      expect(th.longFrameMs).toBeCloseTo(th.frameMs * LONG_FRAME_FRAMES, 1);
      expect(th.jankMs).toBeCloseTo(th.frameMs * JANK_FRAMES, 1);
      expect(th.jankMs).toBeGreaterThan(th.longFrameMs); // jank is a strict subset of long
    }
  });

  it('is total: junk hz gives bounded thresholds rather than Infinity or NaN', () => {
    for (const bad of [0, -240, NaN, Infinity, 1e9]) {
      const th = thresholdsFor(bad);
      expect(Number.isFinite(th.frameMs)).toBe(true);
      expect(th.frameMs).toBeGreaterThan(0);
      expect(th.longFrameMs).toBeGreaterThan(0);
    }
  });

  it('carries the refresh it was derived from — a threshold alone is uninterpretable', () => {
    expect(thresholdsFor(240).refreshHz).toBe(240);
  });
});

describe('refresh state — faster is instant, slower must be earned', () => {
  const fold = (state = initialRefreshState(), ...candidates: (number | null)[]) =>
    candidates.reduce((s, c) => nextRefreshState(s, c), state);

  it('starts at the assumed default, flagged as NOT detected', () => {
    const s = initialRefreshState();
    expect(s.hz).toBe(DEFAULT_REFRESH_HZ);
    expect(s.detected).toBe(false);
  });

  it('the first real reading replaces the assumed default outright', () => {
    const s = fold(initialRefreshState(), 240);
    expect(s).toMatchObject({ hz: 240, detected: true });
  });

  it('adopts a FASTER reading immediately — load cannot manufacture a short interval', () => {
    // The failure that started all this was under-reporting the refresh, so there is no reason to be
    // cautious in this direction.
    expect(fold(initialRefreshState(), 120, 240).hz).toBe(240);
  });

  it('does NOT adopt a slower reading on one window — a transient throttle must not re-baseline', () => {
    let s = fold(initialRefreshState(), 240);
    s = nextRefreshState(s, 60); // one bad second
    expect(s.hz).toBe(240);
    s = nextRefreshState(s, 240); // recovered
    expect(s.hz).toBe(240);
    expect(s.pending).toBeNull(); // and the half-built case for 60 is gone
  });

  it('requires CONSECUTIVE corroboration — an intermittent slow window never accumulates', () => {
    let s = fold(initialRefreshState(), 240);
    for (let i = 0; i < 10; i++) s = fold(s, 60, 240); // alternating throttle / recovery, ten times
    expect(s.hz).toBe(240);
  });

  it('a NULL window (throttled to nothing) holds the estimate and breaks the slow streak', () => {
    let s = fold(initialRefreshState(), 240, 60, 60); // two-thirds of the way to adopting 60
    expect(s.pendingCount).toBe(2);
    s = nextRefreshState(s, null); // rAF delivered nothing usable
    expect(s.hz).toBe(240);
    expect(s.pendingCount).toBe(0); // streak broken — corroboration must be consecutive
    s = fold(s, 60, 60);
    expect(s.hz).toBe(240); // still not adopted: only two consecutive again
  });

  it('DOES adopt a sustained slower rate — dragging the window to a 60 Hz panel is real', () => {
    let s = fold(initialRefreshState(), 240);
    for (let i = 0; i < SLOW_CONFIRMATIONS; i++) s = nextRefreshState(s, 60);
    expect(s.hz).toBe(60);
    expect(thresholdsFor(s.hz).longFrameMs).toBeCloseTo(33.33, 1);
  });

  it('treats jitter within tolerance as the same display, not as a change', () => {
    let s = fold(initialRefreshState(), 240);
    for (const c of [236, 244, 239, 241, 238]) s = nextRefreshState(s, c);
    expect(s.hz).toBe(240); // never re-baselined by noise
    expect(s.pending).toBeNull();
  });

  it('mutually INCONSISTENT slow readings never corroborate each other', () => {
    // 30, then 90, then 45: all slower than 240, none the same display. Adopting on "three slow windows"
    // regardless of agreement would land on a number nothing ever measured.
    let s = fold(initialRefreshState(), 240);
    for (const c of [30, 90, 45]) s = nextRefreshState(s, c);
    expect(s.hz).toBe(240);
  });

  it('a fully hidden/throttled session can never drag the estimate below the floor', () => {
    // Belt and braces on top of the caller skipping hidden buckets: the estimator returns null for these,
    // and null holds.
    let s = fold(initialRefreshState(), 240);
    for (let i = 0; i < 100; i++) s = nextRefreshState(s, estimateRefreshHz(stream(500, 2)));
    expect(s.hz).toBe(240);
  });
});
