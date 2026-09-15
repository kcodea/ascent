// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WARMUP, perfMonitor } from './perfMonitor';
import { phaseStartBetween, type RunLike } from './perfWarmup';

/**
 * WARM-UP (owner report 2026-09-15: *"Performance always spikes when a game starts, which destroys the
 * graph — delay the capture slightly so the initial spike doesn't wreck it."*)
 *
 * Two halves. The RULE — which store transitions are a phase start — is pure. The MONITOR half is driven
 * here with a hand-cranked rAF and clock, because the real sampler is rAF-bound and cannot run headlessly.
 */
const run = (o: Partial<RunLike> = {}): RunLike => ({ seed: 1, phase: 'recruit', wave: 3, ...o });

describe('phaseStartBetween — what counts as a phase start', () => {
  it('a new run (fresh seed) is a run start, even though it is also a phase change', () => {
    expect(phaseStartBetween(run({ phase: 'gameover' }), run({ seed: 2, wave: 1 }))).toBe('run');
  });
  it('a wave reset to 1 from later in a run is a run start too (fixed-seed restarts)', () => {
    expect(phaseStartBetween(run({ wave: 9 }), run({ wave: 1 }))).toBe('run');
  });
  it('recruit → combat is a combat start; combat → recruit is a shop open', () => {
    expect(phaseStartBetween(run({ phase: 'recruit' }), run({ phase: 'combat' }))).toBe('combat');
    expect(phaseStartBetween(run({ phase: 'combat' }), run({ phase: 'recruit', wave: 4 }))).toBe('shop');
  });
  it('the Runeforge opening (an overlay inside the shop) is a phase start; closing it is not', () => {
    expect(phaseStartBetween(run(), run({ runeforgeOffer: ['a', 'b'] }))).toBe('runeforge');
    expect(phaseStartBetween(run({ runeforgeOffer: ['a', 'b'] }), run())).toBeNull();
  });
  it('the end screen counts (it mounts a big tree)', () => {
    expect(phaseStartBetween(run({ phase: 'combat' }), run({ phase: 'gameover' }))).toBe('end');
  });
  it('an ordinary in-phase action (a buy, a roll) is NOT a phase start', () => {
    expect(phaseStartBetween(run(), run())).toBeNull();
  });
  it('the first run ever seen is a run start; no next run is nothing', () => {
    expect(phaseStartBetween(null, run())).toBe('run');
    expect(phaseStartBetween(run(), null)).toBeNull();
  });
});

describe('perfMonitor warm-up — the spike is diverted, not dropped', () => {
  let now = 0;
  let pending: FrameRequestCallback | null = null;
  /** Present one frame `dt` ms after the last. */
  const frame = (dt: number): void => {
    now += dt;
    const cb = pending;
    pending = null;
    cb?.(now);
  };
  const frames = (n: number, dt: number): void => { for (let i = 0; i < n; i++) frame(dt); };

  beforeEach(() => {
    now = 0;
    pending = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { pending = cb; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    localStorage.removeItem('ascent.perf.warmup');
    perfMonitor.clear();
    perfMonitor.registerContext(() => ({ phase: 'recruit', wave: 1 }));
  });
  afterEach(() => {
    perfMonitor.stop();
    perfMonitor.clear();
    perfMonitor.setWarmup(DEFAULT_WARMUP);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('starts warming up on start(), and stays in warm-up until BOTH the time and the frame count have passed', () => {
    perfMonitor.start();
    expect(perfMonitor.warmupState()).toMatchObject({ active: true, reason: 'start' });
    // 120 frames at 4 ms = 0.48 s: the frame limit is met, the 2 s time limit is not → still warming.
    frames(DEFAULT_WARMUP.frames, 4);
    expect(perfMonitor.warmupState().active).toBe(true);
    expect(perfMonitor.warmupState().framesLeft).toBe(0);
    // A few slow frames carry the clock past 2 s → the warm-up closes on the frame that crosses it.
    frames(4, 500);
    expect(perfMonitor.warmupState().active).toBe(false);
    const s = perfMonitor.startups();
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ reason: 'start', frames: DEFAULT_WARMUP.frames + 4, phase: 'recruit', wave: 1 });
    expect(s[0]!.worst).toBe(500); // the spike is RECORDED — in the startup record
  });

  it('the time limit alone is not enough: a throttled tab with no frames presented keeps warming up', () => {
    perfMonitor.setWarmup({ ms: 100, frames: 10 });
    perfMonitor.start();
    frames(2, 300); // 600 ms elapsed, only 2 frames
    expect(perfMonitor.warmupState()).toMatchObject({ active: true, framesLeft: 8 });
    frames(8, 1);
    expect(perfMonitor.warmupState().active).toBe(false);
  });

  it('warm-up frames never reach the main buckets; the bucket says how many were diverted', () => {
    perfMonitor.setWarmup({ ms: 500, frames: 10 });
    perfMonitor.start();
    // 0.5 s of warm-up with one 200 ms spike, then a clean half second → the first bucket closes at ~1 s.
    frames(10, 30);          // 300 ms, warm
    frame(200);              // the spike — 500 ms elapsed, 11 frames: the warm-up closes here
    frames(40, 12.5);        // 500 ms clean
    frame(12.5);             // crosses the 1 s bucket boundary
    const b = perfMonitor.latest();
    expect(b, 'a bucket closed').toBeTruthy();
    expect(b!.worst, 'the 200 ms spike is NOT in the bucket').toBeLessThanOrEqual(12.5);
    expect(b!.warmup, 'but the bucket says how many frames were diverted').toBe(11);
    expect(perfMonitor.startups()[0]!.worst).toBe(200);
  });

  it('measured spans inside a warm-up are attributed to the startup record, not the timeline', () => {
    perfMonitor.setWarmup({ ms: 100, frames: 2 });
    perfMonitor.start();
    perfMonitor.record('layout:flip', 40);   // during warm-up
    frames(2, 60);                            // closes the warm-up (120 ms, 2 frames)
    perfMonitor.record('layout:flip', 3);    // after it
    frames(80, 12);                           // close a bucket
    expect(perfMonitor.startups()[0]!.timings['layout:flip']).toMatchObject({ n: 1, max: 40 });
    expect(perfMonitor.latest()!.timings['layout:flip']).toMatchObject({ n: 1, max: 3 });
  });

  it('a phase start during a warm-up closes it and begins a new one, keeping both records', () => {
    perfMonitor.setWarmup({ ms: 1000, frames: 10 });
    perfMonitor.start();
    frames(5, 10);
    perfMonitor.beginWarmup('combat');
    expect(perfMonitor.warmupState()).toMatchObject({ active: true, reason: 'combat', framesLeft: 10 });
    expect(perfMonitor.startups().map((s) => s.reason)).toEqual(['start']);
    expect(perfMonitor.startups()[0]!.frames).toBe(5);
  });

  it('beginWarmup is inert while stopped, and setWarmup persists', () => {
    perfMonitor.beginWarmup('combat');
    expect(perfMonitor.warmupState().active).toBe(false);
    perfMonitor.setWarmup({ ms: 750 });
    expect(JSON.parse(localStorage.getItem('ascent.perf.warmup')!)).toEqual({ ms: 750, frames: DEFAULT_WARMUP.frames });
  });
});

describe('perfMonitor attribution — self time and long-frame ownership', () => {
  let now = 0;
  let pending: FrameRequestCallback | null = null;
  const frame = (dt: number): void => { now += dt; const cb = pending; pending = null; cb?.(now); };
  /** Advance the clock INSIDE a span, as if the wrapped work took `ms`. */
  const work = (ms: number): void => { now += ms; };

  beforeEach(() => {
    now = 0;
    pending = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { pending = cb; return 1; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    perfMonitor.clear();
    perfMonitor.setWarmup({ ms: 0, frames: 0 }); // no warm-up: this suite is about the main timeline
    perfMonitor.registerContext(() => ({ phase: 'combat', wave: 4 }));
    perfMonitor.start();
    frame(1); // the warm-up closes on the first frame with a zero rule
  });
  afterEach(() => {
    perfMonitor.stop();
    perfMonitor.clear();
    perfMonitor.setWarmup(DEFAULT_WARMUP);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('a nested span is charged to the inner label; the outer keeps only its SELF time', () => {
    perfMonitor.measure('store:set', () => {
      work(1);
      perfMonitor.measure('reduce:endTurn', () => { work(10); });
      work(2);
    });
    frame(1000); // close the bucket
    const t = perfMonitor.latest()!.timings;
    expect(t['reduce:endTurn']).toMatchObject({ n: 1, total: 10, self: 10 });
    expect(t['store:set']).toMatchObject({ n: 1, total: 13, self: 3 });
  });

  it('begin/end brackets nest exactly like measure, so fx:tick self = tick − sim − render', () => {
    perfMonitor.begin('fx:tick');
    work(0.5);
    perfMonitor.begin('fx:sim'); work(2); perfMonitor.end();
    perfMonitor.begin('fx:render'); work(3); perfMonitor.end();
    work(0.5);
    perfMonitor.end();
    perfMonitor.end(); // unbalanced extra end — ignored
    frame(1000);
    const t = perfMonitor.latest()!.timings;
    expect(t['fx:tick']).toMatchObject({ total: 6, self: 1 });
    expect(t['fx:sim']).toMatchObject({ total: 2, self: 2 });
    expect(t['fx:render']).toMatchObject({ total: 3, self: 3 });
  });

  it('charges a LONG frame to the labels that ran inside it, by self time, and not a clean frame', () => {
    // Frame 1: clean (4 ms) with some cheap measured work in it.
    perfMonitor.measure('choreo:step', () => { work(1); });
    frame(4);
    // Frame 2: a dropped frame (60 ms at the assumed 60 Hz calibration, long = 33.3 ms) owned by fx:sim.
    perfMonitor.begin('fx:tick');
    perfMonitor.begin('fx:sim'); work(50); perfMonitor.end();
    work(1);
    perfMonitor.end();
    frame(60);
    frame(1000);
    const la = perfMonitor.latest()!.longAttrib!;
    expect(la['fx:sim']).toEqual({ ms: 50, frames: 1 });
    expect(la['fx:tick']).toEqual({ ms: 1, frames: 1 }); // self only — the 50 ms is fx:sim's
    expect(la['choreo:step'], 'the clean frame charged nobody').toBeUndefined();
  });

  it('a bucket with no long frames carries no longAttrib at all', () => {
    perfMonitor.measure('choreo:step', () => { work(1); });
    frame(4);
    frame(1000);
    expect(perfMonitor.latest()!.longAttrib).toBeUndefined();
  });
});
