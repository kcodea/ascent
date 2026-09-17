import { describe, expect, it } from 'vitest';
import { diagnose, longTaskLine, unlabelledLongTasks } from './perfDiagnose';
import { buildReport } from './perfReport';
import type { PerfBucket } from './perfMonitor';

/**
 * PR 1 of the 2026-09-17 perf handoff: the report and the diagnosis must SURFACE the new attribution — an
 * unlabelled long task names its trigger, DOM growth names its container, the move-path layout-read counter
 * is printed. Pinned end to end on synthetic buckets so the reader-facing wording cannot silently regress.
 */
const base = (i: number, over: Partial<PerfBucket> = {}): PerfBucket => ({
  t: i * 1000, fps: 240, med: 4, p95: 5, worst: 6, long: 0, jank: 0, hz: 240, task: 0,
  counts: {}, heapMb: 0, nodes: 100, marks: {}, timings: {}, phase: 'recruit', wave: 3, ...over,
});
const modeB: PerfBucket = base(5, {
  worst: 121, long: 1, jank: 1, task: 119,
  longTasks: [{ t: 5400, ms: 119, labels: [], lastEvent: { type: 'pointermove', target: 'div.card.shop[data-uid=u_42]', msBefore: 3 } }],
  counts: { pointermoves: 178, 'layout:read-in-move': 4 },
});
const modeA: PerfBucket = base(8, {
  worst: 60, long: 1, jank: 1, task: 55,
  longTasks: [{ t: 8100, ms: 55, labels: ['store:set', 'reduce:buy', 'layout:flip'] }],
  timings: { 'store:set': { n: 1, total: 19, max: 19 } },
});
const run = Array.from({ length: 40 }, (_, i) => (i === 5 ? modeB : i === 8 ? modeA : base(i, {
  nodesBy: { shop: 60 + i * 10, hand: 20, board: 30, fx: 4, portals: i * 7, other: 40 },
  nodes: 154 + i * 17,
})));

describe('an unlabelled long task names its trigger', () => {
  it('prints the event line, and the labels when it had them', () => {
    expect(longTaskLine(modeB.longTasks![0]!)).toBe('119 ms — no label open; last event: pointermove on div.card.shop[data-uid=u_42] 3.0 ms earlier');
    expect(longTaskLine(modeA.longTasks![0]!)).toBe('55 ms — ran: `store:set`, `reduce:buy`, `layout:flip`');
  });

  it('lists only the UNLABELLED tasks, worst first, with where they happened', () => {
    const blind = unlabelledLongTasks(run);
    expect(blind).toHaveLength(1);
    expect(blind[0]).toMatchObject({ ms: 119, phase: 'recruit', wave: 3 });
  });

  it('the long-task verdict carries the trigger and points at the move-path counter', () => {
    const d = diagnose(run);
    const lt = d.verdicts.find((v) => v.id === 'long-task')!;
    expect(lt.detail).toContain('No instrumented label was open');
    expect(lt.detail).toContain('pointermove on div.card.shop[data-uid=u_42] 3.0 ms earlier');
    expect(lt.suggestion).toContain('layout:read-in-move');
    const blind = d.verdicts.find((v) => v.id === 'unlabelled-long-tasks')!;
    expect(blind.title).toContain('right after a pointermove');
    expect(blind.severity).toBe('critical'); // 119 ms
  });

  it('a labelled long task names what ran inside it instead', () => {
    const d = diagnose(run.map((b) => (b === modeB ? base(5) : b)));
    const lt = d.verdicts.find((v) => v.id === 'long-task')!;
    expect(lt.detail).toContain('Inside it: `store:set`, `reduce:buy`, `layout:flip`');
    expect(d.verdicts.find((v) => v.id === 'unlabelled-long-tasks')).toBeUndefined();
  });
});

describe('DOM growth names its container', () => {
  it('the dom-growth verdict says where the nodes went', () => {
    const d = diagnose(run);
    const g = d.verdicts.find((v) => v.id === 'dom-growth')!;
    expect(g.title).toContain('mostly in shop');
    expect(g.detail).toContain('shop +');
    expect(g.detail).toContain('portals +');
  });
});

describe('the markdown report carries the new sections', () => {
  const md = buildReport({ buckets: run });
  it('has an unlabelled-long-tasks table with the event', () => {
    expect(md).toContain('## Unlabelled long tasks');
    expect(md).toContain('| 5s | 119.0ms | `pointermove` on `div.card.shop[data-uid=u_42]` 3.0 ms earlier | Shop, wave 3 |');
  });
  it('has a DOM-by-container table and the move-path layout-read count', () => {
    expect(md).toContain('## DOM nodes by container');
    expect(md).toMatch(/\| shop \| \d+ \| \d+ \| \+\d+ \| \d+ \|/);
    expect(md).toContain('`layout:read-in-move`): **4**');
  });
  it('annotates the worst moment with its long task', () => {
    expect(md).toContain('- long task 119 ms — no label open; last event: pointermove on div.card.shop[data-uid=u_42] 3.0 ms earlier');
  });
});
