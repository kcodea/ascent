import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSettlingPoint, settledSlotCenter } from './settledSlot';

// Node env (no jsdom): hand-rolled row/unit stubs with just what `settledSlotCenter` reads.
interface FakeUnit { el: Element }
function fakeRow(opts: { left: number; width: number; offsetWidth?: number; gap: number; units: { w: number; dying?: boolean; rect?: { top: number; height: number } }[] }) {
  const row = {
    children: [] as Element[],
    getBoundingClientRect: () => ({ left: opts.left, width: opts.width, top: 0, height: 100 }),
    offsetWidth: opts.offsetWidth ?? opts.width,
    __gap: opts.gap,
  };
  const units: FakeUnit[] = opts.units.map((u, i) => {
    const el = {
      parentElement: row,
      offsetWidth: u.w,
      hasAttribute: (n: string) => n === 'data-uid',
      classList: { contains: (c: string) => c === 'dying' && u.dying === true },
      getBoundingClientRect: () => ({ left: 0, width: u.w, top: u.rect?.top ?? 10, height: u.rect?.height ?? 80 }),
      __i: i,
    } as unknown as Element;
    return { el };
  });
  row.children = units.map((u) => u.el);
  return { row, units };
}

afterEach(() => vi.unstubAllGlobals());
const stubGap = () => vi.stubGlobal('getComputedStyle', (el: { __gap: number }) => ({ columnGap: `${el.__gap}px` }));

describe('settledSlotCenter — where a unit lands once its row stops reflowing (King Oona, owner 2026-09-24)', () => {
  it('places unit i of n at rowCentre + (i - (n-1)/2) * (width + gap), counting a still-GROWING slot at full width', () => {
    stubGap();
    // Row centred at x=500. Three units of 100px + 20px gap; the last one was just summoned and is 30px into
    // its grow. Settled: pitch 120, centres at 380 / 500 / 620.
    const { units } = fakeRow({ left: 0, width: 1000, gap: 20, units: [{ w: 100 }, { w: 100 }, { w: 30 }] });
    expect(settledSlotCenter(units[0]!.el)).toEqual({ x: 380, y: 50 });
    expect(settledSlotCenter(units[1]!.el)).toEqual({ x: 500, y: 50 });
    expect(settledSlotCenter(units[2]!.el)).toEqual({ x: 620, y: 50 });
  });

  it('a unit leaving its slot (dying) does not hold one', () => {
    stubGap();
    const { units } = fakeRow({ left: 0, width: 1000, gap: 20, units: [{ w: 100, dying: true }, { w: 100 }, { w: 100 }] });
    // Two survivors: centres at 440 / 560.
    expect(settledSlotCenter(units[1]!.el)?.x).toBe(440);
    expect(settledSlotCenter(units[2]!.el)?.x).toBe(560);
  });

  it('converts layout px to screen px on a scaled board', () => {
    stubGap();
    // Rendered at half size: rect width 500 for a 1000px layout width.
    const { units } = fakeRow({ left: 0, width: 500, offsetWidth: 1000, gap: 20, units: [{ w: 100 }, { w: 100 }] });
    // pitch (100 + 20) * 0.5 = 60, so the two centres sit at 250 ∓ 30.
    expect(settledSlotCenter(units[0]!.el)?.x).toBe(220);
    expect(settledSlotCenter(units[1]!.el)?.x).toBe(280);
  });

  it('is null for a unit that is not in a row', () => {
    expect(settledSlotCenter(null)).toBeNull();
    expect(settledSlotCenter({ parentElement: null } as unknown as Element)).toBeNull();
  });
});

describe('createSettlingPoint', () => {
  it('holds its start, then eases toward a new goal (never overshooting) and arrives', () => {
    let t = 0;
    const pt = createSettlingPoint({ x: 0, y: 0 }, () => t);
    expect(pt.get()).toEqual({ x: 0, y: 0 });
    pt.setGoal({ x: 100, y: 0 });
    t = 45; const a = pt.get().x;
    t = 90; const b = pt.get().x;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(100);
    t = 1000;
    expect(pt.get().x).toBeCloseTo(100, 1);
  });
});

describe('trackSettledSlot: a travelling effect follows its unit to where the row settles (owner 2026-11-12, the Execute beam)', () => {
  afterEach(() => vi.useRealTimers());
  it('starts on the settled slot, then eases to the new one when a neighbour starts dying mid-flight', async () => {
    const { SETTLE_TRACK_REMEASURE_MS, trackSettledSlot } = await import('./settledSlot');
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] });
    stubGap();
    // Three units; the first dies a moment after the effect leaves. Unit 2 settles at 620, then at 560.
    const spec = { left: 0, width: 1000, gap: 20, units: [{ w: 100, dying: false }, { w: 100 }, { w: 100 }] };
    const { units } = fakeRow(spec);
    const t = trackSettledSlot(() => units[2]!.el)!;
    expect(t.start.x).toBe(620);
    spec.units[0]!.dying = true;
    vi.advanceTimersByTime(SETTLE_TRACK_REMEASURE_MS + 1); // the re-measure picks up the collapse
    vi.advanceTimersByTime(2000);                          // long past the ease
    expect(t.get().x).toBeCloseTo(560, 0);
    t.stop();
    spec.units[1]!.dying = true; // after stop() nothing re-measures: the goal stays
    vi.advanceTimersByTime(1000);
    expect(t.get().x).toBeCloseTo(560, 0);
  });
  it('is null for a unit that is not on the board', async () => {
    const { trackSettledSlot } = await import('./settledSlot');
    expect(trackSettledSlot(() => null)).toBeNull();
  });
});
