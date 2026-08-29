/**
 * The diagnosis engine's reasoning, unit-tested.
 *
 * The sampler cannot run headlessly — it is rAF- and DOM-bound — which is exactly why the ANALYSIS was
 * split out of it. Everything that decides what a timeline means lives in `perfDiagnose.ts` and is
 * exercised here against hand-built timelines, so the claims the perf screen prints are checked rather than
 * eyeballed through a panel.
 *
 * Two properties get the most attention, because getting them wrong is worse than having no tool:
 *   · thresholds are DERIVED from each run's refresh (a 360 Hz run must not be judged by 60 Hz numbers);
 *   · a correlation is never dressed up as an attribution.
 */
import { describe, expect, it } from 'vitest';
import { compareRuns, diagnose, phaseBreakdown, subjectOf, worstSpikes } from './perfDiagnose';
import type { PerfBucket } from './perfMonitor';

/** One second of timeline. Defaults are a clean 60 Hz frame; override what a case is about. */
const b = (over: Partial<PerfBucket> = {}): PerfBucket => ({
  t: 1000, fps: 60, med: 16, p95: 16.6, worst: 16.6, long: 0, jank: 0, hz: 60, task: 0,
  counts: {}, heapMb: 0, nodes: 0, marks: {}, timings: {}, ...over,
});
/** `n` seconds, each stamped with an increasing `t` so the timeline reads as a sequence. */
const secs = (n: number, over: Partial<PerfBucket> | ((i: number) => Partial<PerfBucket>) = {}): PerfBucket[] =>
  Array.from({ length: n }, (_, i) => b({ t: (i + 1) * 1000, ...(typeof over === 'function' ? over(i) : over) }));

const idsOf = (d: ReturnType<typeof diagnose>): string[] => d.verdicts.map((v) => v.id);
const find = (d: ReturnType<typeof diagnose>, id: string) => d.verdicts.find((v) => v.id === id);

describe('perf diagnosis — the budget is derived, never assumed', () => {
  it('judges a 360 Hz run against 2.78 ms, not 16.7', () => {
    // The trap docs/performance.md §4 names: a fixed ms threshold is a 60 Hz assumption in disguise. A 10 ms
    // frame is FINE at 60 Hz and 3.6x over budget at 360.
    const at60 = diagnose(secs(10, { hz: 60, worst: 10, med: 8, p95: 9 }));
    const at360 = diagnose(secs(10, { hz: 360, worst: 10, med: 2, p95: 2.5, fps: 360 }));
    expect(at60.budgetMs, '60 Hz gives 16.67 ms').toBeCloseTo(16.67, 1);
    expect(at360.budgetMs, '360 Hz gives 2.78 ms').toBeCloseTo(2.78, 1);
    expect(idsOf(at60), 'a 10 ms frame fits a 60 Hz budget').toContain('within-budget');
    expect(idsOf(at360), 'the same frame is over budget at 360 Hz').toContain('over-budget');
  });

  it('takes the MEDIAN refresh, so one odd bucket cannot move the budget', () => {
    // A resize or a monitor switch produces a stray reading; the run's verdicts must not hinge on it.
    const bs = secs(11, (i) => ({ hz: i === 5 ? 30 : 240 }));
    expect(diagnose(bs).hz).toBe(240);
  });

  it('ranks severity by how far over budget the WORST frame went, not the mean', () => {
    // §0: "a mean improvement that leaves the worst frame where it was has not fixed anything."
    const mild = diagnose(secs(10, { hz: 60, worst: 20, jank: 1 }));
    const bad = diagnose(secs(10, { hz: 60, worst: 90, jank: 4 }));
    expect(find(mild, 'over-budget')!.severity).toBe('info');
    expect(find(bad, 'over-budget')!.severity).toBe('critical');
  });
});

describe('perf diagnosis — attribution vs correlation', () => {
  it('names a timed block as MEASURED when its own worst call blew the budget', () => {
    const d = diagnose(secs(10, {
      hz: 60, worst: 60, jank: 2,
      timings: { rebuildBoard: { n: 4, total: 180, max: 58 } },
    }));
    const hot = find(d, 'hotspot:rebuildBoard');
    expect(hot, 'a block over budget must be called out by name').toBeDefined();
    expect(hot!.confidence, 'the milliseconds are on the clock for that block').toBe('measured');
    expect(hot!.title).toContain('58');
  });

  it('does NOT promote a mark to a cause — a busy second is not a culprit', () => {
    const d = diagnose(secs(10, { hz: 60, worst: 40, jank: 3, marks: { 'fx:tendril': 12 } }));
    const s = find(d, 'suspect:fx:tendril');
    expect(s, 'it should still be ranked as a lead').toBeDefined();
    expect(s!.confidence, 'but only ever as correlation').toBe('correlated');
    expect(s!.suggestion, 'and it must say how to turn the guess into evidence').toContain('timing');
  });

  it('stays quiet about marks once something is directly attributable', () => {
    // A named, measured culprit makes the correlation list noise — the reader should follow the real one.
    const d = diagnose(secs(10, {
      hz: 60, worst: 60, jank: 3, marks: { 'fx:tendril': 12 },
      timings: { slowThing: { n: 2, total: 100, max: 58 } },
    }));
    expect(idsOf(d)).toContain('hotspot:slowThing');
    expect(idsOf(d), 'no suspect list while a measured cause is on the table')
      .not.toContain('suspect:fx:tendril');
  });

  it('treats a LOW measured share as a finding in its own right', () => {
    // The subtle one: nothing we time is slow, yet frames drop. That is information — the cost is in paint,
    // style or GC — and the tool must say so instead of reporting "no hotspots" and looking clean.
    const d = diagnose(secs(20, { hz: 60, worst: 50, jank: 3, timings: {} }));
    const u = find(d, 'unattributed-time');
    expect(u, 'silence from the timings is itself the signal').toBeDefined();
    expect(u!.suggestion, 'and it should point at the known cause class').toMatch(/paint|box-shadow|LOOP/i);
  });

  it('says nothing about attribution when the run is clean', () => {
    expect(idsOf(diagnose(secs(20, { hz: 60, worst: 12 })))).not.toContain('unattributed-time');
  });
});

describe('perf diagnosis — phases', () => {
  const mixed = (): PerfBucket[] => [
    ...secs(6, { phase: 'recruit', worst: 12, jank: 0 }),
    ...secs(6, { phase: 'combat', worst: 70, jank: 5 }),
  ];

  it('compares phases by jank RATE, so a long phase does not win on volume alone', () => {
    const bs = [
      ...secs(40, { phase: 'recruit', jank: 1, worst: 20 }),  // 40 janky frames, 1/s
      ...secs(4, { phase: 'combat', jank: 6, worst: 80 }),    // 24 janky frames, 6/s
    ];
    const [first] = phaseBreakdown(bs.filter((x) => !x.hidden), 16.67);
    expect(first!.phase, 'combat drops six times as often per second').toBe('combat');
  });

  it('calls out a phase holding most of the dropped frames', () => {
    const d = diagnose(mixed());
    const p = find(d, 'phase-concentrated');
    expect(p, 'one phase owning the jank is the most useful single fact in the report').toBeDefined();
    expect(p!.phase).toBe('combat');
    expect(p!.title).toContain('combat');
  });

  it('stays quiet when the pain is spread evenly — there is no phase to blame', () => {
    const even = [
      ...secs(6, { phase: 'recruit', jank: 3, worst: 40 }),
      ...secs(6, { phase: 'combat', jank: 3, worst: 40 }),
    ];
    expect(idsOf(diagnose(even))).not.toContain('phase-concentrated');
  });
});

describe('perf diagnosis — the standing project anti-patterns', () => {
  it('flags DOM growth as a leak that will surface as slow style recalc', () => {
    const d = diagnose(secs(40, (i) => ({ nodes: 1000 + i * 40, hz: 60 })));
    const g = find(d, 'dom-growth');
    expect(g).toBeDefined();
    expect(g!.title, 'the absolute counts belong in the headline, the ratio in the detail').toContain('1000');
    expect(g!.detail).toContain('2.6×');
  });

  it('does not call ordinary content growth a leak', () => {
    expect(idsOf(diagnose(secs(40, (i) => ({ nodes: 1000 + i * 2 }))))).not.toContain('dom-growth');
  });

  it('flags a blocking main-thread task separately from a heavy frame', () => {
    const d = diagnose(secs(10, { hz: 60, task: 180, phase: 'recruit', wave: 4, worst: 190, jank: 2 }));
    const t = find(d, 'long-task');
    expect(t!.severity).toBe('critical');
    expect(t!.detail, 'the phase and wave are what make it findable').toContain('recruit');
    expect(t!.detail).toContain('wave 4');
  });

  it('reports an FX count that spikes in janky seconds as a LEAD, not a cause', () => {
    const bs = [
      ...secs(5, { jank: 0, counts: { particles: 4 } }),
      ...secs(5, { jank: 3, worst: 60, counts: { particles: 90 } }),
    ];
    const d = diagnose(bs);
    const fx = d.verdicts.find((x) => x.id.startsWith('fx-volume:'));
    expect(fx).toBeDefined();
    expect(fx!.confidence).toBe('correlated');
    expect(fx!.suggestion, 'and it must say how to confirm it').toContain('re-record');
    // The `×` must be a RATIO, not the raw count wearing a multiplier sign. 90 live vs 4 is 22.5×, and a
    // title reading "90× higher" would be a precise-looking number that means something else entirely.
    expect(fx!.title, 'the multiplier is 90/4, not 90').toContain('22.5×');
    expect(fx!.detail, 'the raw averages belong in the evidence line').toContain('90');
  });
});

describe('perf diagnosis — honesty about thin data', () => {
  it('refuses to draw conclusions from two seconds', () => {
    const d = diagnose(secs(2, { worst: 400, jank: 40 }));
    expect(d.thin).toBe(true);
    expect(idsOf(d), 'a catastrophic-looking two seconds is still just two seconds').toEqual(['thin-sample']);
  });

  it('ignores backgrounded seconds entirely', () => {
    // rAF is suspended in a hidden tab, so an alt-tab would otherwise read as a total stall.
    const d = diagnose([...secs(10, { worst: 12 }), ...secs(5, { hidden: true, fps: 0, worst: 5000, jank: 300 })]);
    expect(d.seconds, 'only the live seconds count').toBe(10);
    expect(idsOf(d)).toContain('within-budget');
  });
});

describe('perf spikes', () => {
  it('returns the worst seconds annotated with what was happening in them', () => {
    const bs = [
      b({ t: 1000, worst: 12 }),
      b({ t: 2000, worst: 96, jank: 5, phase: 'combat', wave: 7, marks: { 'fx:crit': 3 },
          timings: { draw: { n: 2, total: 90, max: 80 } }, counts: { particles: 200 } }),
      b({ t: 3000, worst: 20 }),
    ];
    const [worst] = worstSpikes(bs, 3);
    expect(worst!.t, 'ordered by worst frame, not by time').toBe(2000);
    expect(worst!.phase).toBe('combat');
    expect(worst!.wave).toBe(7);
    expect(worst!.timings[0]!.label, 'timings ranked by the worst single call').toBe('draw');
    expect(worst!.marks[0]!.label).toBe('fx:crit');
  });
});

describe('run-over-run comparison', () => {
  const run = (over: Partial<PerfBucket>) => diagnose(secs(20, over));

  it('leads with the worst frame, because that is what a player feels', () => {
    const regs = compareRuns(run({ hz: 60, worst: 20, jank: 1 }), run({ hz: 60, worst: 60, jank: 4 }));
    expect(regs[0]!.metric).toBe('worst frame');
    expect(regs[0]!.severity).toBe('critical');
  });

  it('ignores changes inside the noise floor', () => {
    const regs = compareRuns(run({ hz: 60, worst: 20 }), run({ hz: 60, worst: 21 }));
    expect(regs.filter((r) => r.metric === 'worst frame')).toEqual([]);
  });

  it('reports an improvement rather than staying silent about it', () => {
    const regs = compareRuns(run({ hz: 60, worst: 60, jank: 4 }), run({ hz: 60, worst: 20, jank: 1 }));
    const w = regs.find((r) => r.metric === 'worst frame')!;
    expect(w.severity).toBe('info');
    expect(w.note).toContain('improved');
  });

  it('refuses to compare jank counts across different refresh rates', () => {
    // Different budgets mean a "janky frame" is a different thing in each run — comparing the counts would
    // manufacture a regression out of a monitor change.
    const regs = compareRuns(run({ hz: 60, worst: 20 }), run({ hz: 240, worst: 20 }));
    const note = regs.find((r) => r.metric === 'refresh');
    expect(note, 'the mismatch must be stated, not silently absorbed').toBeDefined();
    expect(note!.note).toContain('not comparable');
  });

  it('says nothing at all when either side is too thin to judge', () => {
    expect(compareRuns(diagnose(secs(1)), run({ worst: 90 }))).toEqual([]);
  });
});


/**
 * POINTING AT CONTENT (owner ask 2026-08-29: *"i want the perf hud to be so good that it points at cards or
 * mechanics or effects that are causing slowdowns"*).
 *
 * The instrumentation encodes its subject in the timing LABEL — `fx:<defId>` from `playDef`,
 * `reduce:<action>` and `reduce:<action>:<cardId>` from the store. These pin that a finding names the thing
 * a person can act on rather than the key the code happened to use, and that the suggested fix matches the
 * KIND of thing it found: advice about pooling a shader is worthless when the cost is a reducer pass.
 */
describe('perf diagnosis — naming the culprit', () => {
  it('decodes an effect, a card, a mechanic and plain code', () => {
    expect(subjectOf('fx:titan-hammer')).toMatchObject({ kind: 'effect', id: 'titan-hammer' });
    expect(subjectOf('reduce:play:dw_foreman')).toMatchObject({ kind: 'card', id: 'dw_foreman' });
    expect(subjectOf('reduce:endTurn')).toMatchObject({ kind: 'mechanic', id: 'endTurn' });
    expect(subjectOf('someBlock')).toMatchObject({ kind: 'code', id: 'someBlock' });
  });

  it('names the CARD when one card owns the cost', () => {
    const d = diagnose(secs(20, {
      hz: 60, worst: 70, jank: 3,
      timings: { 'reduce:play:dw_foreman': { n: 3, total: 180, max: 62 } },
    }));
    const hit = d.verdicts.find((v) => v.id.includes('dw_foreman'))!;
    expect(hit.title, 'the card id belongs in the headline').toContain('dw_foreman');
    expect(hit.title, 'and it should read as a sentence, not a log key').toContain('Playing');
    expect(hit.suggestion, 'the advice must be about a CARD').toMatch(/effects|board|clone/i);
  });

  it('names the EFFECT when an authored def owns the cost, with FX-specific advice', () => {
    const d = diagnose(secs(20, {
      hz: 60, worst: 90, jank: 4,
      timings: { 'fx:titan-hammer': { n: 6, total: 300, max: 84 } },
    }));
    const hit = d.verdicts.find((v) => v.id.includes('titan-hammer'))!;
    expect(hit.title).toContain('titan-hammer');
    expect(hit.title).toContain('Firing');
    // The spawn is where §3b's collision freeze lived, so the fix must talk about shaders and pooling —
    // not about card effects.
    expect(hit.suggestion).toMatch(/shader|pool|texture/i);
  });

  it('falls back to the ACTION when no single card owns it', () => {
    const d = diagnose(secs(20, {
      hz: 60, worst: 70, jank: 3,
      timings: { 'reduce:endTurn': { n: 2, total: 120, max: 65 } },
    }));
    const hit = d.verdicts.find((v) => v.id.includes('endTurn'))!;
    expect(hit.title).toContain('Resolving');
    expect(hit.suggestion, 'and the advice points at the resolution path, not at content')
      .toMatch(/every dispatch|sweeps|snapshot/i);
  });

  it('keeps working for a label it has never seen', () => {
    // Instrumenting something new must never require editing the decoder to stay correct.
    const d = diagnose(secs(20, { hz: 60, worst: 70, jank: 3, timings: { brandNewThing: { n: 1, total: 60, max: 60 } } }));
    const hit = d.verdicts.find((v) => v.id.includes('brandNewThing'))!;
    expect(hit.title).toContain('brandNewThing');
    expect(hit.confidence).toBe('measured');
  });
});
