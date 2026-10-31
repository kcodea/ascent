import { describe, expect, it } from 'vitest';
import { DOCK_DEFAULTS, dockedLayout, type DockAnchors, type DockPanel } from './lobbyRailDockedLayout';

/** The docked rail's layout (owner review 2026-10-31, "i loved the cutout slices"): slices against the board's right rail,
 *  the Refresh pill, the gem and the Gold coin cut cleanly out of the slices beside them with an even clearance, one
 *  straight left and right edge otherwise, the round slice above the first player (level with the pill), and every
 *  seat keeping its slice when it falls. */
const A: DockAnchors = {
  refresh: { left: 1437, top: 134, right: 1700, bottom: 246 },
  gem: { left: 1517, top: 382, right: 1669, bottom: 548 },
  gold: { left: 1535, top: 662, right: 1648, bottom: 775 },
  view: { left: 0, top: 0, right: 1920, bottom: 1080 },
};
const ids = (n: number, from = 0): string[] => Array.from({ length: n }, (_, i) => `s${i + from}`);
const railX = (A.gem.left + A.gem.right) / 2;

/** Does the slice's outline reach a point? */
function covers(p: DockPanel, x: number, y: number): boolean {
  const lx = x - p.x, ly = y - p.y;
  if (lx < 0 || ly < 0 || lx > p.w || ly > p.h) return false;
  let inside = false;
  for (let i = 0, j = p.outline.length - 1; i < p.outline.length; j = i++) {
    const [xi, yi] = p.outline[i]!, [xj, yj] = p.outline[j]!;
    if ((yi > ly) !== (yj > ly) && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe('docked rail layout', () => {
  const L = dockedLayout(A, ids(8), [])!;
  const all = [L.head, ...L.panels];

  it('stacks the round slice and all eight seats against the board rail, fully on screen, equal and apart', () => {
    expect(L.panels).toHaveLength(8);
    const { x, w, h } = L.panels[0]!;
    for (const p of L.panels) {
      expect(p.x).toBeCloseTo(x, 5); // one left edge
      expect(p.x + p.w).toBeCloseTo(x + w, 5); // one right edge
      expect(p.h).toBeCloseTo(h, 5);
      expect(p.x).toBeGreaterThan(railX); // never over the play area
      expect(p.x + p.w).toBeLessThanOrEqual(A.view.right - 1);
      expect(p.y).toBeGreaterThan(L.head.y + L.head.h - 0.01); // under the round slice
      expect(p.y + p.h).toBeLessThanOrEqual(A.gold.bottom + 0.5);
    }
    expect(L.head.x).toBeCloseTo(x, 5);
    expect(L.head.y).toBeGreaterThan(A.view.top);
    for (const a of all) for (const b of all) {
      if (a === b) continue;
      const apart = a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
      expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
    }
  });

  it('cuts every slice beside the pill, the gem or the coin clean round it, leaving each piece uncovered', () => {
    expect(all.filter((p) => p.cut).length).toBeGreaterThanOrEqual(3); // the pill's, the gem's, the coin's
    const gcx = railX, gcy = (A.gem.top + A.gem.bottom) / 2, gw = (A.gem.right - A.gem.left) / 2, gh = (A.gem.bottom - A.gem.top) / 2;
    const ccx = (A.gold.left + A.gold.right) / 2, ccy = (A.gold.top + A.gold.bottom) / 2, cr = (A.gold.right - A.gold.left) / 2;
    const pr = (A.refresh.bottom - A.refresh.top) / 2, pcx = A.refresh.right - pr, pcy = A.refresh.top + pr;
    for (const p of all) {
      for (let t = 0; t <= 1; t += 0.05) {
        for (const sgn of [-1, 1]) expect(covers(p, gcx + gw * (1 - t), gcy + sgn * gh * t * 0.99), `${p.id} covers the gem`).toBe(false);
      }
      for (let ang = -Math.PI / 2; ang <= Math.PI / 2; ang += 0.1) {
        expect(covers(p, ccx + cr * Math.cos(ang) * 0.99, ccy + cr * Math.sin(ang) * 0.99), `${p.id} covers the coin`).toBe(false);
        expect(covers(p, pcx + pr * Math.cos(ang) * 0.99, pcy + pr * Math.sin(ang) * 0.99), `${p.id} covers the Refresh pill`).toBe(false);
      }
    }
  });

  it('Slight eclipse: the first slice tucks under the pill\'s foot, a shallow cut on its top-left only', () => {
    const E = dockedLayout(A, ids(8), [], { ...DOCK_DEFAULTS, topMode: 'eclipse', eclipse: 0.22 })!;
    const p1 = E.panels[0]!;
    expect(p1.y).toBeGreaterThan(A.refresh.top + (A.refresh.bottom - A.refresh.top) / 2);
    expect(p1.y).toBeLessThan(A.refresh.bottom);
    expect(p1.cut).toBe(true);
    expect(E.panels[1]!.cut).toBe(false);
    expect(E.head.y + E.head.h).toBeLessThanOrEqual(A.refresh.top);
    expect(E.head.cut).toBe(false);
  });

  it('Below (default): the first slice starts under the pill, uncut; the round slice ties into the pill beside it', () => {
    const B = L;
    expect(DOCK_DEFAULTS.topMode).toBe('below');
    expect(B.panels[0]!.y).toBeGreaterThanOrEqual(A.refresh.bottom);
    expect(B.panels.every((p) => !p.cut || p.y > A.refresh.bottom + 50)).toBe(true);
    expect(B.head.y + B.head.h).toBeLessThanOrEqual(B.panels[0]!.y);
    // Beside the pill, the pill's height, nothing above or below it; its left edge cut round the pill's end.
    expect(B.head.y).toBeCloseTo(A.refresh.top, 3);
    expect(B.head.y + B.head.h).toBeCloseTo(A.refresh.bottom, 3);
    expect(B.head.cut).toBe(true);
    expect(B.wrap!.bandX).toBeGreaterThan(0);
  });

  it('Level: the first player is level with the Refresh pill and the round slice sits above it, clear of the pill', () => {
    const L = dockedLayout(A, ids(8), [], { ...DOCK_DEFAULTS, topMode: 'level' })!;
    const p1 = L.panels[0]!;
    // Level with the pill: its centre inside the pill's band, and the pill's cut stays on the first slice alone.
    expect(p1.y + p1.h / 2).toBeGreaterThan(A.refresh.top);
    expect(p1.y + p1.h / 2).toBeLessThan(A.refresh.bottom);
    expect(L.panels[1]!.cut).toBe(false);
    expect(L.head.y + L.head.h).toBeLessThanOrEqual(A.refresh.top);
    expect(L.head.cut).toBe(false);
    expect(p1.cut).toBe(true); // the pill bites the first player's slice
  });

  it('a knockout never moves the stack: the fallen keep their slice, ghosted', () => {
    const full = dockedLayout(A, ids(8), [])!;
    for (const n of [5, 2]) {
      const lay = dockedLayout(A, ids(n), ids(8 - n, n))!;
      expect(lay.panels).toHaveLength(8);
      lay.panels.forEach((p, i) => {
        expect(p.y).toBeCloseTo(full.panels[i]!.y, 5);
        expect(p.h).toBeCloseTo(full.panels[i]!.h, 5);
        expect(p.dead).toBe(i >= n);
      });
    }
    expect(full.panels[0]!.h).toBeLessThanOrEqual(DOCK_DEFAULTS.panelMax + 0.5);
  });

  it('scales with the board, not the window', () => {
    const half = (b: DockAnchors['gem']): DockAnchors['gem'] => ({ left: b.left / 2, top: b.top / 2, right: b.right / 2, bottom: b.bottom / 2 });
    const small = dockedLayout({ refresh: half(A.refresh), gem: half(A.gem), gold: half(A.gold), view: half(A.view) }, ids(8), [])!;
    expect(small.s).toBeCloseTo(L.s / 2, 5);
    expect(small.panels[0]!.h).toBeCloseTo(L.panels[0]!.h / 2, 3);
  });

  it('gives up (the caller falls back to the tile column) when there is no room beside the board', () => {
    expect(dockedLayout({ ...A, view: { ...A.view, right: 1680 } }, ids(8), [])).toBeNull();
  });
});
