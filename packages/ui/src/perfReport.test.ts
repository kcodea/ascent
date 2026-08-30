/**
 * The report is the artefact that leaves the machine, so what it says has to survive being read by someone
 * who was not there. These tests pin the properties that make that true — not the prose.
 */
import { describe, expect, it } from 'vitest';
import { buildReport } from './perfReport';
import type { PerfBucket } from './perfMonitor';

const b = (over: Partial<PerfBucket> = {}): PerfBucket => ({
  t: 1000, fps: 60, med: 16, p95: 16.6, worst: 16.6, long: 0, jank: 0, hz: 60, task: 0,
  counts: {}, heapMb: 0, nodes: 0, marks: {}, timings: {}, ...over,
});
const secs = (n: number, over: Partial<PerfBucket> = {}): PerfBucket[] =>
  Array.from({ length: n }, (_, i) => b({ t: (i + 1) * 1000, ...over }));

describe('perf report', () => {
  it('leads with the refresh and the budget, because every ms below is unreadable without them', () => {
    const r = buildReport({ buckets: secs(20, { hz: 240, worst: 9, fps: 240 }) });
    expect(r).toContain('240 Hz');
    expect(r).toContain('4.17ms');
    // The header must appear before any finding, so the reader calibrates before they judge.
    expect(r.indexOf('4.17ms')).toBeLessThan(r.indexOf('## Findings'));
  });

  it('keeps MEASURED and CORRELATED findings visibly different', () => {
    // The whole point. Once both are bullet points they look equally solid, and that is how an afternoon
    // gets spent on the wrong thing.
    const measured = buildReport({
      buckets: secs(20, { hz: 60, worst: 60, jank: 3, timings: { draw: { n: 3, total: 150, max: 58 } } }),
    });
    expect(measured).toContain('**MEASURED**');

    const lead = buildReport({ buckets: secs(20, { hz: 60, worst: 40, jank: 3, marks: { 'fx:tendril': 9 } }) });
    expect(lead).toContain('possible lead');
    expect(lead, 'a correlation must never be dressed as an attribution').not.toContain('**MEASURED**\n\n**Next:** This is measured');
  });

  it('reports a CLEAN run as a finding rather than printing nothing', () => {
    // A report that only lists problems reads as broken when there are none.
    const r = buildReport({ buckets: secs(20, { hz: 60, worst: 12 }) });
    expect(r).toContain('## Findings');
    expect(r).toMatch(/fit the .* budget/);
  });

  it('says so plainly when the recording is too thin to judge', () => {
    const r = buildReport({ buckets: secs(2, { worst: 900, jank: 90 }) });
    expect(r).toContain('too thin');
    expect(r, 'and draws no conclusions from it').not.toContain('## Findings');
  });

  it('carries the build and note, so a comparison can name WHICH change moved the number', () => {
    const r = buildReport({
      buckets: secs(20, { hz: 60, worst: 30, jank: 2 }),
      meta: { build: 'abc1234', note: 'after the sheen change', mode: 'ascent', heroId: 'sable' },
    });
    expect(r).toContain('abc1234');
    expect(r).toContain('after the sheen change');
    expect(r).toContain('sable');
  });

  it('annotates a spike with what was happening, not just how big it was', () => {
    const r = buildReport({
      buckets: [
        ...secs(19, { hz: 60, worst: 12 }),
        b({ t: 20000, hz: 60, worst: 120, jank: 6, phase: 'combat', wave: 9, task: 90,
            marks: { 'fx:crit': 4 }, timings: { plateGild: { n: 1, total: 88, max: 88 } },
            counts: { particles: 300 } }),
      ],
    });
    expect(r).toContain('## Worst moments');
    expect(r).toContain('combat');
    expect(r).toContain('wave 9');
    expect(r, 'the measured block is the shortlist').toContain('plateGild');
    expect(r).toContain('fx:crit');
    expect(r).toContain('particles');
  });

  it('compares against a previous run and marks the direction', () => {
    const before = secs(20, { hz: 60, worst: 20, jank: 1 });
    const after = secs(20, { hz: 60, worst: 60, jank: 5 });
    const r = buildReport({
      buckets: after,
      previous: { meta: { id: 'r1', startedAt: 0, seconds: 20, build: 'old', hz: 60, worstFrame: 20, jankFrames: 20, fpsMed: 60, note: 'baseline' }, buckets: before },
    });
    expect(r).toContain('worst frame');
    expect(r).toContain('worse');
    expect(r, 'the earlier run’s own note is what identifies it').toContain('baseline');
  });

  it('refuses to compare jank counts across refresh rates, and says why', () => {
    const r = buildReport({
      buckets: secs(20, { hz: 240, worst: 9, fps: 240 }),
      previous: { meta: { id: 'r1', startedAt: 0, seconds: 20, build: 'old', hz: 60, worstFrame: 20, jankFrames: 20, fpsMed: 60 }, buckets: secs(20, { hz: 60, worst: 20 }) },
    });
    expect(r, 'a monitor change must not be reported as a regression').toContain('not comparable');
  });

  it('is markdown a person can read, not a bucket dump', () => {
    const r = buildReport({ buckets: secs(60, { hz: 60, worst: 40, jank: 2, timings: { x: { n: 1, total: 5, max: 5 } } }) });
    expect(r.length, 'a 2400-bucket JSON blob helps nobody and costs the context window').toBeLessThan(12000);
    expect(r).not.toContain('"buckets"');
  });
});
