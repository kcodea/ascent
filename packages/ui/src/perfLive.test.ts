import { describe, expect, it } from 'vitest';
import { FLAG_WARM, PHASE_CODES, type FrameRing, type PerfBucket } from './perfMonitor';
import { captureStats, counterPeak, graphColumns, rollingStats, topOffenders } from './perfLive';
import { thresholdsFor } from './refreshRate';

/**
 * The live monitor's reasoning, headless. The HUD is a drawing loop over these; if they are right the graph
 * and the offenders list are right, and if they are wrong no amount of looking at the panel would show it.
 */
const th240 = thresholdsFor(240); // budget 4.17, long 8.33, jank 12.5

/** Build a ring from (dt, flag) pairs, oldest first, at a fixed 4 ms cadence unless a frame says otherwise. */
function ring(frames: { dt: number; flag?: number }[], size = 16): FrameRing {
  const r: FrameRing = { dt: new Float32Array(size), t: new Float64Array(size), flag: new Uint8Array(size), head: 0, n: 0 };
  let t = 0;
  for (const f of frames) {
    t += f.dt;
    r.dt[r.head] = f.dt;
    r.t[r.head] = t;
    r.flag[r.head] = f.flag ?? 0;
    r.head = (r.head + 1) % size;
    if (r.n < size) r.n++;
  }
  return r;
}

const bucket = (over: Partial<PerfBucket> = {}): PerfBucket => ({
  t: 0, fps: 240, med: 4, p95: 5, worst: 6, long: 0, jank: 0, hz: 240, task: 0,
  counts: {}, heapMb: 0, nodes: 0, marks: {}, timings: {}, ...over,
});

describe('rollingStats — the window numbers', () => {
  it('reads only the frames since `sinceT`, newest first, and judges them against the thresholds given', () => {
    const r = ring([{ dt: 4 }, { dt: 4 }, { dt: 20 }, { dt: 4 }, { dt: 9 }, { dt: 4 }]); // t: 4,8,28,32,41,45
    const all = rollingStats(r, 0, th240);
    expect(all).toMatchObject({ frames: 6, worst: 20, long: 2, jank: 1, overBudget: 2 });
    // A window that starts after the 20 ms frame ended (t=28) must not see it.
    const late = rollingStats(r, 30, th240);
    expect(late).toMatchObject({ frames: 3, worst: 9, long: 1, jank: 0 });
  });

  it('EXCLUDES warm-up frames from the numbers but counts them, so the row can say "(12f warm)"', () => {
    const r = ring([{ dt: 80, flag: FLAG_WARM }, { dt: 40, flag: FLAG_WARM }, { dt: 4 }, { dt: 4 }]);
    const s = rollingStats(r, 0, th240);
    expect(s.warm).toBe(2);
    expect(s.frames).toBe(2);
    expect(s.worst).toBe(4); // the 80 ms warm-up spike is not the window's worst
  });

  it('survives a wrapped ring (head has lapped the buffer)', () => {
    const frames = Array.from({ length: 40 }, (_, i) => ({ dt: i === 37 ? 30 : 4 }));
    const r = ring(frames, 16); // only the last 16 frames survive
    const s = rollingStats(r, 0, th240);
    expect(s.frames).toBe(16);
    expect(s.worst).toBe(30);
  });

  it('is empty-safe', () => {
    expect(rollingStats(ring([]), 0, th240)).toMatchObject({ frames: 0, worst: 0, p95: 0 });
  });
});

describe('graphColumns — one worst frame per pixel', () => {
  it('keeps the WORST frame per column (never the mean), newest on the right', () => {
    // 8 frames of 4 ms then one 20 ms frame; 4 columns over the last 40 ms.
    const r = ring([{ dt: 4 }, { dt: 4 }, { dt: 4 }, { dt: 4 }, { dt: 4 }, { dt: 4 }, { dt: 4 }, { dt: 4 }, { dt: 20 }]);
    const untilT = r.t[(r.head - 1 + 16) % 16]!; // the newest frame's end
    const g = graphColumns(r, untilT, 40, 4, th240);
    expect(g.max[3]).toBe(20);                 // the spike is in the right-most column…
    expect(g.long[3]).toBe(1);                 // …flagged as a dropped frame…
    expect(Array.from(g.long.subarray(0, 3))).toEqual([0, 0, 0]); // …and nowhere else
    expect(Math.max(...Array.from(g.max.subarray(0, 3)))).toBe(4);
  });

  it('marks warm-up columns and carries the phase code of the newest frame in each', () => {
    const shop = PHASE_CODES.recruit! << 1;
    const combat = PHASE_CODES.combat! << 1;
    const r = ring([{ dt: 10, flag: shop }, { dt: 10, flag: shop | FLAG_WARM }, { dt: 10, flag: combat }, { dt: 10, flag: combat }]);
    const g = graphColumns(r, 40, 40, 4, th240);
    expect(Array.from(g.phase)).toEqual([PHASE_CODES.recruit, PHASE_CODES.recruit, PHASE_CODES.combat, PHASE_CODES.combat]);
    expect(Array.from(g.warm)).toEqual([0, 1, 0, 0]);
  });

  it('is safe with zero columns or an empty ring', () => {
    expect(graphColumns(ring([]), 100, 10_000, 0, th240).max.length).toBe(0);
    expect(Array.from(graphColumns(ring([]), 100, 10_000, 3, th240).max)).toEqual([0, 0, 0]);
  });
});

describe('topOffenders — who owns the dropped frames', () => {
  it('ranks by SELF time inside long frames, not by the single worst call and not by call count', () => {
    const off = topOffenders([
      bucket({
        long: 10,
        // fx:sim ran in all 10 dropped frames at ~3 ms; autosave stalled ONCE for 40 ms; store:set is
        // called constantly but is cheap and never in a dropped frame.
        longAttrib: { 'fx:sim': { ms: 30, frames: 10 }, autosave: { ms: 40, frames: 1 } },
        timings: {
          'fx:sim': { n: 240, total: 400, max: 4, self: 400 },
          autosave: { n: 1, total: 40, max: 40, self: 40 },
          'store:set': { n: 900, total: 90, max: 0.3, self: 90 },
        },
      }),
    ]);
    expect(off.map((o) => o.label)).toEqual(['autosave', 'fx:sim']);
    expect(off[1]).toMatchObject({ label: 'fx:sim', frames: 10, share: 1, avgMs: 3, maxMs: 4, n: 240 });
    expect(off[0]).toMatchObject({ label: 'autosave', frames: 1, share: 0.1, avgMs: 40, maxMs: 40 });
  });

  it('accumulates across buckets and skips hidden ones', () => {
    const off = topOffenders([
      bucket({ long: 2, longAttrib: { 'fx:sim': { ms: 6, frames: 2 } } }),
      bucket({ long: 3, longAttrib: { 'fx:sim': { ms: 9, frames: 3 } }, timings: { 'fx:sim': { n: 5, total: 20, max: 7 } } }),
      bucket({ long: 50, hidden: true, longAttrib: { autosave: { ms: 999, frames: 50 } } }),
    ]);
    expect(off).toHaveLength(1);
    expect(off[0]).toMatchObject({ label: 'fx:sim', ms: 15, frames: 5, share: 1, avgMs: 3, maxMs: 7 });
  });

  it('returns [] when nothing instrumented ran in a dropped frame — the render/paint/GC case', () => {
    expect(topOffenders([bucket({ long: 4 })])).toEqual([]);
  });

  it('tolerates buckets from before longAttrib existed', () => {
    const legacy = bucket({ long: 2 }) as Omit<PerfBucket, 'longAttrib'> & { longAttrib?: unknown };
    delete legacy.longAttrib;
    expect(topOffenders([legacy as PerfBucket])).toEqual([]);
  });
});

describe('captureStats + counterPeak', () => {
  it('worst is the max, p95 the median of per-second p95s, counts sum, hidden buckets excluded', () => {
    const s = captureStats([
      bucket({ worst: 6, p95: 5, long: 1 }),
      bucket({ worst: 30, p95: 9, long: 4, jank: 2 }),
      bucket({ worst: 8, p95: 6 }),
      bucket({ worst: 900, p95: 800, long: 99, hidden: true }),
    ]);
    expect(s).toEqual({ seconds: 3, worst: 30, p95: 6, long: 5, jank: 2 });
  });

  it('names the phase a counter peaked in', () => {
    const p = counterPeak([
      bucket({ phase: 'recruit', counts: { 'fx:particles': 120 } }),
      bucket({ phase: 'combat', counts: { 'fx:particles': 2340 } }),
      bucket({ phase: 'combat', counts: { 'fx:particles': 900 } }),
    ], 'fx:particles');
    expect(p).toEqual({ peak: 2340, phase: 'combat' });
    expect(counterPeak([bucket()], 'fx:particles')).toEqual({ peak: 0, phase: undefined });
  });
});
