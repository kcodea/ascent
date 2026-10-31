/**
 * THE DOCKED RAIL'S LAYOUT (owner 2026-10-31: "What if we like almost made it look built into the board, cut out around
 * the gem so the panels would prob be slightly rectangular but fit between refresh and the gold area", "I think they
 * need to be stacked", "make it a 10/10", "use more vertical space", "Put a slice that holds the round info and max dmg
 * etc at the top of the list", then "i loved the cutout slices, go back to that concept"). DEV only, under owner review
 * (lobbyRailVariant.ts).
 *
 * One stack of slices standing against the board's right rail: the ROUND SLICE (Round N, players left, max damage) above
 * the Refresh pill, then one slice per seat, the first level with the pill, down to the Gold coin's foot (equal heights,
 * equal gaps; a knocked-out seat keeps its slice, ghosted, so the stack never moves). The board's right-hand pieces BITE
 * INTO the slices: the Refresh pill's rounded end, the End Turn gem's diamond and the Gold
 * coin's disc each cut a clean, matching curve out of every slice beside them (the pill and the coin as concave arcs, the
 * gem at its own diamond angle), with one even clearance all round. Every slice otherwise shares one straight left and
 * right edge. The caller draws the gold edge along the same outline, so every cut reads as finished.
 *
 * PURE: anchors in, rectangles and outlines out. Every input is in the LAYER's own CSS px (useDockedRail measures the
 * board's Refresh / gem / Gold once per layout change, never per frame). Sizes in `DockCfg` are in board px at the 1080p
 * reference and are multiplied by the board's own scale (`s`, the gem's height over its 1080p height), so the column
 * grows and shrinks with the board, not with the window.
 */

export interface Box { left: number; top: number; right: number; bottom: number }

export interface DockAnchors {
  refresh: Box;
  gem: Box;
  gold: Box;
  /** The visible part of the layer (the window, in layer px): the column never leaves it. */
  view: Box;
}

/** Where the first player's slice sits against the Refresh pill (owner 2026-10-31: "I think the top player needs to be
 *  slightly eclipsing refresh. Being in line shrinks it too much, or top player is directly below it"):
 *    eclipse  its top-left corner tucks under the pill's foot, so only a shallow cut of the pill's lower edge bites it
 *    below    it starts just under the pill's foot, uncut; the round slice TIES INTO the pill (owner: "i like B more",
 *             then "I don't want it to go over the refresh button, maybe just tie into it"): beside the pill, the
 *             pill's height, its left edge cut round the pill's rounded end. The default.
 *    level    its centre on the pill's band (the deep arc cut); the earlier pick, kept for comparison */
export const DOCK_TOP_MODES = ['eclipse', 'below', 'level'] as const;
export type DockTopMode = (typeof DOCK_TOP_MODES)[number];

export interface DockCfg {
  /** Where the first player's slice sits against the Refresh pill. */
  topMode: DockTopMode;
  /** Eclipse: how much of the pill's height the first slice tucks under, 0..1. */
  eclipse: number;
  /** Tallest a slice may grow (a short table, e.g. a 4-player Versus group), board px. */
  panelMax: number;
  /** Space between slices, board px. */
  gap: number;
  /** The even clearance between a board piece (pill, gem, coin) and the slice cut round it, board px. */
  notch: number;
  /** From the board's right rail (the gem's centre line) to the slices' left edge, board px. */
  offset: number;
  /** Moves the first player's slice up (−) or down (+) from level with the Refresh pill, board px. */
  topShift: number;
  /** Margin kept from the window's edges, board px. */
  edge: number;
  /** The round slice's height, board px. */
  headH: number;
  /** Widest a slice may be, board px. */
  maxW: number;
}

export const DOCK_DEFAULTS: DockCfg = { topMode: 'below', eclipse: 0.22, panelMax: 160, gap: 7, notch: 7, offset: 17, topShift: 0, edge: 14, headH: 58, maxW: 198 };

/** The gem's 1080p height (`.etb-base`), the board-scale reference. */
export const GEM_REF_H = 166;

export type Pt = [number, number];

export interface DockPanel {
  id: string;
  dead: boolean;
  x: number; y: number; w: number; h: number;
  /** The slice's outline in its own px (a rectangle, or the rectangle with the board's pieces cut out of its left side). */
  outline: Pt[];
  /** True when a board piece cuts into it. */
  cut: boolean;
  /** Where the slice's foot starts clear of a cut, px from its left (the Health bar starts here). */
  footX: number;
  /** Where its top edge starts clear of a cut, px from its left (the standing medal sits here). */
  topX: number;
  /** The deepest cut along its middle band, px (the round slice centres its text in what is left). */
  midX: number;
}

export interface DockLayout {
  /** Board scale: every board px above is multiplied by this. */
  s: number;
  panels: DockPanel[];
  /** The round slice, first in the stack. */
  head: DockPanel;
  /** Below (the wrap): the height of the round slice's band above the pill, and how far the pill bites into the part
   *  beside it, px (the slice lays its text out in those two open areas). Absent in the other modes. */
  wrap?: { topH: number; bandX: number };
  /** The Guides tab's top-left (under the stack). */
  tab: { x: number; y: number };
}

interface Shape { kind: 'circle' | 'diamond'; cx: number; cy: number; rx: number; ry: number }

/** The leftmost x a slice may use at height `y`: its left edge, pushed right round each board piece (+ clearance). */
function leftAt(y: number, L: number, shapes: readonly Shape[]): number {
  let x = L;
  for (const sh of shapes) {
    const dy = Math.abs(y - sh.cy);
    if (dy >= sh.ry) continue;
    x = Math.max(x, sh.kind === 'diamond' ? sh.cx + sh.rx * (1 - dy / sh.ry) : sh.cx + sh.rx * Math.sqrt(1 - (dy * dy) / (sh.ry * sh.ry)));
  }
  return x;
}

/** The slice's left contour, top to bottom: exact at the diamond's corners and where each cut starts and ends, finely
 *  sampled along the arcs, with collinear runs merged, so the cut edge is clean. */
function contour(x: number, y: number, w: number, h: number, L: number, shapes: readonly Shape[]): Pt[] {
  const ys = new Set<number>([y, y + h]);
  for (const sh of shapes) {
    const a = sh.cy - sh.ry, b = sh.cy + sh.ry;
    // The shape's own top and bottom, plus a hair inside each, so a cut that ends on a flat edge (the pill's foot) ends
    // square instead of on a slope.
    for (const v of [a, a + 0.01, sh.cy, b - 0.01, b]) if (v > y && v < y + h) ys.add(v);
    // Arcs are sampled by ANGLE (every 1.5 degrees), so the cut stays smooth right up to where it meets a straight edge.
    if (sh.kind === 'circle') for (let t = -90; t <= 90; t += 1.5) { const v = sh.cy + sh.ry * Math.sin((t * Math.PI) / 180); if (v > y && v < y + h) ys.add(v); }
    else {
      // Where the diamond's edges cross the slice's own left edge.
      const t = 1 - (L - sh.cx) / sh.rx;
      if (t > 0 && t < 1) for (const v of [sh.cy - t * sh.ry, sh.cy + t * sh.ry]) if (v > y && v < y + h) ys.add(v);
    }
  }
  const maxIn = x + w * 0.72; // a cut never takes more than ~3/4 of a slice
  const pts: Pt[] = [...ys].sort((p, q) => p - q).map((yy) => [Math.min(maxIn, Math.max(x, leftAt(yy, L, shapes))) - x, yy - y]);
  // Merge collinear runs (straight edges stay one segment).
  const out: Pt[] = [];
  for (const p of pts) {
    if (out.length >= 2) {
      const [ax, ay] = out[out.length - 2]!, [bx, by] = out[out.length - 1]!;
      if (Math.abs((bx - ax) * (p[1] - ay) - (by - ay) * (p[0] - ax)) < 0.05) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** Rounds every real corner of an outline (a turn sharper than ~14 degrees) with a small curve of radius `r`, so a cut
 *  meets the slice's straight edges without a point, and the slice's own corners match. Sampled arcs (tiny turns) pass. */
export function roundCorners(pts: readonly Pt[], r: number): Pt[] {
  if (r <= 0 || pts.length < 3) return [...pts];
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, a = pts[(i - 1 + n) % n]!, b = pts[(i + 1) % n]!;
    const ax = a[0] - p[0], ay = a[1] - p[1], bx = b[0] - p[0], by = b[1] - p[1];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) { out.push(p); continue; }
    const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb))));
    if (turn < 0.25) { out.push(p); continue; }
    const d = Math.min(r, la / 2, lb / 2);
    const A: Pt = [p[0] + (ax / la) * d, p[1] + (ay / la) * d], B: Pt = [p[0] + (bx / lb) * d, p[1] + (by / lb) * d];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, u = 1 - t;
      out.push([u * u * A[0] + 2 * u * t * p[0] + t * t * B[0], u * u * A[1] + 2 * u * t * p[1] + t * t * B[1]]);
    }
  }
  return out;
}

function slice(id: string, dead: boolean, x: number, y: number, w: number, h: number, L: number, shapes: readonly Shape[], rr = 0): DockPanel {
  const c = contour(x, y, w, h, L, shapes);
  const cut = c.some(([cx]) => cx > 0.5);
  const at = (f0: number, f1: number): number => Math.max(0, ...c.filter(([, cy]) => cy >= h * f0 - 0.01 && cy <= h * f1 + 0.01).map(([cx]) => cx), leftAt(y + h * f0, L, shapes) - x, leftAt(y + h * f1, L, shapes) - x);
  return {
    id, dead, x, y, w, h,
    outline: roundCorners([[w, 0], [w, h], ...[...c].reverse()], rr),
    cut,
    footX: Math.min(w * 0.72, at(0.72, 1)),
    topX: Math.min(w * 0.72, at(0, 0.3)),
    midX: Math.min(w * 0.72, at(0.2, 0.8)),
  };
}

/**
 * Lay the seats out. `live` in standing order, `dead` in place order. Returns null when the anchors leave no room (the
 * caller then falls back to the tile column).
 */
export function dockedLayout(a: DockAnchors, live: readonly string[], dead: readonly string[], cfg: DockCfg = DOCK_DEFAULTS): DockLayout | null {
  const gemH = a.gem.bottom - a.gem.top;
  if (!(gemH > 0)) return null;
  const s = gemH / GEM_REF_H;
  const gap = cfg.gap * s, clr = cfg.notch * s, edge = cfg.edge * s;
  const railX = (a.gem.left + a.gem.right) / 2;
  const L = railX + cfg.offset * s;
  const R = Math.min(a.view.right - edge, L + cfg.maxW * s);
  const T = a.view.top + edge;
  const B = Math.min(a.view.bottom - edge, Math.max(a.gold.bottom, a.gem.bottom));
  if (R - L < 110 * s || B - T < 260 * s) return null;
  const W = R - L;

  // The board pieces' VISIBLE outlines (owner 2026-10-31: "Make the cutouts really really clean around gold and refresh"),
  // each grown by the clearance. Measured off the rendered art at 1080p and kept as ratios of the elements' boxes, so they
  // hold at every board scale:
  //  - the Refresh pill: the board's copper socket round the button reaches past the button's box on the right; its end is
  //    a circle of radius 0.523 x the box height, centred 0.387 x the height in from the box's right edge and 0.018 x the
  //    height below its middle;
  //  - the End Turn gem: its diamond fills its box;
  //  - the Gold coin: the board's bronze ring round it, 1.21 x the coin's radius.
  const ph = a.refresh.bottom - a.refresh.top;
  const pillR = 0.523 * ph;
  const coinR = ((a.gold.right - a.gold.left) / 2) * 1.21;
  const shapes: Shape[] = [
    { kind: 'circle', cx: a.refresh.right - 0.387 * ph, cy: (a.refresh.top + a.refresh.bottom) / 2 + 0.018 * ph, rx: pillR + clr, ry: pillR + clr },
    { kind: 'diamond', cx: railX, cy: (a.gem.top + a.gem.bottom) / 2, rx: (a.gem.right - a.gem.left) / 2 + clr * Math.SQRT2, ry: gemH / 2 + clr * Math.SQRT2 },
    { kind: 'circle', cx: (a.gold.left + a.gold.right) / 2, cy: (a.gold.top + a.gold.bottom) / 2, rx: coinR + clr, ry: coinR + clr },
  ];

  // EVERY SEAT KEEPS ITS SLICE (owner 2026-10-31: "Ghosts should stay in the rail now as they are without changing the
  // look of the rail since it's clean"): one slice per seat, the living in standing order then the fallen in place
  // order, all the same height, so a knockout never moves the stack. The FIRST player's slice is level with the Refresh
  // pill (owner: "lower the rail so the top player is even with refresh"; its centre on the pill's centre, plus Tuner 2
  // "Top player offset"), and the stack runs down to the coin's foot.
  const ids = [...live, ...dead];
  const n = Math.max(1, ids.length);
  const cy = (a.refresh.top + a.refresh.bottom) / 2 + cfg.topShift * s;
  // The pill's cut belongs to the first player alone: the second slice starts below the pill's foot (+ clearance), so the
  // pill never clips a corner off it. (Solved by a few fixed-point steps: the height depends on where the stack starts.)
  const hAt = (top: number): number => Math.min(cfg.panelMax * s, (B - top - (n - 1) * gap) / n);
  const pillShape = shapes[0]!;
  const pillFoot = pillShape.cy + pillShape.ry + 0.5 * s; // the pill's visible foot + the clearance
  let y1: number;
  // Below: the round slice is the pill's own height beside it, and the first player starts one gap under it (and clear
  // of the pill's foot).
  if (cfg.topMode === 'below') y1 = Math.max(a.refresh.bottom + gap, pillFoot) + cfg.topShift * s;
  else if (cfg.topMode === 'eclipse') y1 = pillFoot - clr - (a.refresh.bottom - a.refresh.top) * Math.max(0, Math.min(1, cfg.eclipse)) + cfg.topShift * s;
  else {
    y1 = cy - hAt(cy) / 2;
    for (let it = 0; it < 8; it++) {
      const hh = hAt(y1);
      y1 = Math.max(cy - hh / 2, n > 1 ? pillFoot - gap - hh : -Infinity);
    }
  }
  const h = hAt(y1);
  if (!(h > 16 * s) || y1 < T) return null;
  const deadSet = new Set(dead);
  const panels: DockPanel[] = ids.map((id, i) => slice(id, deadSet.has(id), L, y1 + i * (h + gap), W, h, L, shapes, 3 * s));

  // THE ROUND SLICE above the first player, clear of the Refresh pill (so it needs no cut), at its own height.
  // Eclipse / level: above the pill, clear of it. Below: beside the pill, centred on its band, cut round its rounded end
  // (the pill's own height, so the cut is one clean arc that ends on the slice's top and bottom edges).
  let head: DockPanel;
  let wrap: DockLayout['wrap'];
  if (cfg.topMode === 'below') {
    // Beside the pill, its own height and centred on it, nothing above or below it: the left edge meets the pill's
    // rounded end in one clean concave arc (the even clearance, the gold edge), like a connector.
    const top = Math.max(T, a.refresh.top);
    const hh = Math.max(20 * s, Math.min(a.refresh.bottom, y1 - gap) - top);
    head = slice('__head', false, L, top, W, hh, L, shapes, 3 * s);
    let band = 0;
    for (let i = 0; i <= 24; i++) band = Math.max(band, leftAt(top + (hh * i) / 24, L, shapes) - L);
    wrap = { topH: 0, bandX: Math.min(head.w * 0.72, band) };
  } else {
    const hb = Math.min(y1 - gap, pillShape.cy - pillShape.ry);
    const ht = Math.max(T, hb - cfg.headH * s);
    head = slice('__head', false, L, ht, W, Math.max(20 * s, hb - ht), L, shapes, 3 * s);
  }

  return { s, panels, head, ...(wrap ? { wrap } : {}), tab: { x: R - 40 * s, y: B + 8 * s } };
}
