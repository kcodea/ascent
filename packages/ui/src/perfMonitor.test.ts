import { describe, it, expect } from 'vitest';
import { aggregateFrames, perfMonitor, summarize, type PerfBucket } from './perfMonitor';

/**
 * The sampler itself is rAF- + DOM-bound and can't run headlessly (a hidden tab suspends rAF entirely), so
 * the parts that can silently be WRONG — the percentile maths and the triage roll-up — are extracted as
 * pure functions and pinned here.
 */
const bucket = (over: Partial<PerfBucket> = {}): PerfBucket => ({
  t: 0, fps: 60, med: 16, p95: 17, worst: 18, long: 0, jank: 0, task: 0,
  counts: {}, heapMb: 0, nodes: 0, marks: {}, timings: {}, ...over,
});

describe('perf monitor — frame aggregation', () => {
  it('reports fps from the frame COUNT over elapsed time, not from the mean frame time', () => {
    // 60 frames in exactly 1s = 60fps. (Averaging frame times would drift on an uneven distribution.)
    const frames = Array.from({ length: 60 }, () => 16.67);
    expect(aggregateFrames(frames, 1000).fps).toBe(60);
  });

  it('counts long (>33ms) and jank (>50ms) frames, with jank a SUBSET of long', () => {
    const frames = [16, 16, 40, 16, 80, 16]; // one long-only, one that is both long and jank
    const r = aggregateFrames(frames, 1000);
    expect(r.long).toBe(2);
    expect(r.jank).toBe(1);
    expect(r.worst).toBe(80);
  });

  it('a single catastrophic frame survives into `worst` without moving the median', () => {
    // The whole point of keeping worst per bucket: a 500ms hitch inside an otherwise smooth second must
    // not be averaged away, which is exactly how "it felt slow but the graph looks fine" happens.
    const frames = [...Array.from({ length: 59 }, () => 16), 500];
    const r = aggregateFrames(frames, 1000);
    expect(r.worst).toBe(500);
    expect(r.med).toBe(16);
    expect(r.jank).toBe(1);
  });

  it('is safe on an empty bucket (a fully throttled second)', () => {
    expect(aggregateFrames([], 1000)).toEqual({ fps: 0, med: 0, p95: 0, worst: 0, long: 0, jank: 0 });
  });

  it('clamps p95 on tiny samples rather than reading past the end', () => {
    expect(aggregateFrames([20], 100).p95).toBe(20);
  });
});

describe('perf monitor — triage summary', () => {
  it('EXCLUDES backgrounded buckets, so an alt-tab is not reported as a stall', () => {
    const s = summarize([
      bucket({ t: 1000, fps: 60, worst: 18 }),
      bucket({ t: 2000, fps: 0.5, worst: 4000, jank: 1, long: 1, hidden: true }), // tab was hidden
      bucket({ t: 3000, fps: 60, worst: 20 }),
    ]);
    expect(s.buckets).toBe(2);
    expect(s.worstFrame).toBe(20); // NOT the 4000ms throttled frame
    expect(s.jankFrames).toBe(0);
    expect(s.fpsMin).toBe(60);
  });

  it('ranks marks by the jank that co-occurred with them, not by how often they fired', () => {
    const s = summarize([
      // `fx:pulse` fires constantly in smooth seconds — high count, no jank.
      bucket({ t: 1000, marks: { 'fx:pulse': 40 } }),
      bucket({ t: 2000, marks: { 'fx:pulse': 40 } }),
      // `fx:weld` fires rarely, but the second it fires is janky.
      bucket({ t: 3000, jank: 5, marks: { 'fx:weld': 7, 'fx:pulse': 2 } }),
    ]);
    expect(s.markTotals['fx:pulse']).toBe(82);
    expect(s.markTotals['fx:weld']).toBe(7);
    expect(s.suspects[0]).toEqual({ mark: 'fx:weld', jank: 5 });
    // pulse is implicated too — it shared the janky bucket. Correlation, not attribution.
    expect(s.suspects.map((x) => x.mark)).toContain('fx:pulse');
  });

  it('surfaces the worst buckets in order, so the log has an entry point', () => {
    const s = summarize([
      bucket({ t: 1000, worst: 20 }),
      bucket({ t: 2000, worst: 120, phase: 'combat', wave: 7 }),
      bucket({ t: 3000, worst: 45 }),
    ]);
    expect(s.worst.map((b) => b.worst)).toEqual([120, 45, 20]);
    expect(s.worst[0]!.phase).toBe('combat');
    expect(s.worst[0]!.wave).toBe(7);
    expect(s.spanSec).toBe(2);
  });

  it('is safe on an empty log', () => {
    const s = summarize([]);
    expect(s).toMatchObject({ buckets: 0, spanSec: 0, fpsMed: 0, worstFrame: 0 });
  });
});

describe('perf monitor — measured hotspots', () => {
  it('ranks by the WORST single call, not by total time', () => {
    // The distinction that matters for a hitch: a cheap thing called constantly can out-total the one slow
    // call that actually dropped the frame. `autosave` here totals far less than `reduce:hover` but is the
    // only thing capable of causing a visible stall.
    const s = summarize([
      bucket({ t: 1000, timings: { 'reduce:hover': { n: 900, total: 450, max: 0.9 } } }),
      bucket({ t: 2000, timings: { autosave: { n: 3, total: 62, max: 58 } } }),
    ]);
    expect(s.hotspots[0]).toMatchObject({ label: 'autosave', max: 58 });
    expect(s.hotspots[1]!.label).toBe('reduce:hover');
    expect(s.hotspots[1]!.total).toBeGreaterThan(s.hotspots[0]!.total); // …despite totalling more
  });

  it('accumulates one label across buckets (n and total add, max is the peak)', () => {
    const s = summarize([
      bucket({ t: 1000, timings: { autosave: { n: 2, total: 10, max: 7 } } }),
      bucket({ t: 2000, timings: { autosave: { n: 3, total: 20, max: 12 } } }),
    ]);
    expect(s.hotspots[0]).toEqual({ label: 'autosave', n: 5, total: 30, max: 12 });
    expect(s.measuredMs).toBe(30);
  });

  it('excludes measurements from backgrounded buckets', () => {
    const s = summarize([
      bucket({ t: 1000, hidden: true, timings: { autosave: { n: 1, total: 900, max: 900 } } }),
      bucket({ t: 2000, timings: { autosave: { n: 1, total: 5, max: 5 } } }),
    ]);
    expect(s.hotspots[0]!.max).toBe(5); // not the 900ms recorded while throttled
  });

  it('tolerates buckets with no timings at all (logs from before measure() existed)', () => {
    const legacy = { ...bucket({ t: 1000 }) } as PerfBucket & { timings?: unknown };
    delete legacy.timings;
    const s = summarize([legacy as PerfBucket]);
    expect(s.hotspots).toEqual([]);
    expect(s.measuredMs).toBe(0);
  });
});

describe('perf monitor — measure() as a wrapper', () => {
  // measure() sits in the dispatch hot path, so its contract when the monitor is OFF matters as much as
  // its timing: it must be a transparent passthrough that changes nothing about the call it wraps.
  it('returns the wrapped value', () => {
    expect(perfMonitor.measure('x', () => 42)).toBe(42);
  });

  it('propagates a throw instead of swallowing it', () => {
    expect(() => perfMonitor.measure('x', () => { throw new Error('boom'); })).toThrow('boom');
  });

  it('records nothing while stopped (no clock reads on a cold path)', () => {
    perfMonitor.measure('x', () => 1);
    expect(perfMonitor.isRunning).toBe(false);
    expect(summarize(perfMonitor.history()).hotspots).toEqual([]);
  });
});
