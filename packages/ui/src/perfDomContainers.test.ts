import { describe, expect, it } from 'vitest';
import { containerGrowth, growthSummary, PERF_DOM_CONTAINERS } from './perfDomContainers';
import type { PerfBucket } from './perfMonitor';

/**
 * The DOM leak in the 2026-09-17 captures (100 → 1,027 nodes) had a total and no address. The per-container
 * delta is what turns it into one; these pin the roll-up the report and HUD read.
 */
const bucket = (nodesBy: Record<string, number> | undefined, over: Partial<PerfBucket> = {}): PerfBucket => ({
  t: 0, fps: 240, med: 4, p95: 5, worst: 6, long: 0, jank: 0, hz: 240, task: 0,
  counts: {}, heapMb: 0, nodes: 0, marks: {}, timings: {},
  ...(nodesBy ? { nodesBy } : {}), ...over,
});

describe('DOM nodes by container', () => {
  it('ranks containers by growth, first→last, and keeps the peak', () => {
    const g = containerGrowth([
      bucket({ shop: 60, hand: 20, portals: 0, other: 100 }),
      bucket({ shop: 200, hand: 22, portals: 90, other: 100 }),
      bucket({ shop: 170, hand: 19, portals: 305, other: 100 }),
    ]);
    expect(g.map((x) => x.name)).toEqual(['portals', 'shop', 'other', 'hand']);
    expect(g[0]).toEqual({ name: 'portals', first: 0, last: 305, delta: 305, peak: 305 });
    expect(g[1]).toEqual({ name: 'shop', first: 60, last: 170, delta: 110, peak: 200 });
    expect(g[3]!.delta).toBe(-1);
  });

  it('skips hidden buckets and buckets recorded before the per-container count existed', () => {
    const g = containerGrowth([
      bucket(undefined),                                   // an old recording's bucket
      bucket({ shop: 500 }, { hidden: true }),             // alt-tabbed
      bucket({ shop: 60 }),
      bucket({ shop: 80 }),
    ]);
    expect(g).toEqual([{ name: 'shop', first: 60, last: 80, delta: 20, peak: 80 }]);
    expect(containerGrowth([bucket(undefined)])).toEqual([]);
  });

  it('summarises the growers only, biggest first, capped', () => {
    const g = containerGrowth([
      bucket({ shop: 61, hand: 30, portals: 0, fx: 4 }),
      bucket({ shop: 473, hand: 28, portals: 305, fx: 9 }),
    ]);
    expect(growthSummary(g)).toBe('shop +412 (61→473), portals +305 (0→305), fx +5 (4→9)');
    expect(growthSummary(g, 1)).toBe('shop +412 (61→473)');
    expect(growthSummary(containerGrowth([bucket({ a: 5 }), bucket({ a: 5 })]))).toBe('');
  });

  it('names every container a shop leak could hide in, and the FX + portal roots', () => {
    expect(Object.keys(PERF_DOM_CONTAINERS)).toEqual(['shop', 'hand', 'board', 'fx', 'portals']);
    expect(PERF_DOM_CONTAINERS.portals).toContain(':not(#root)'); // portals = body children outside the React root
  });
});
