import { cubicBezier } from '../wipeGeometry';

/**
 * THE SIX PANELS (owner 2026-11-18): the awakening's centre beat, in place of the curtain and its title card.
 * Pure numbers only (the clock and the geometry), so the gate, the panels and the sparks all read ONE source and a
 * test can pin it. The owner's words:
 *   "a big (pixi fx driven) explosion occurs from the hero power"
 *   "the ancient itself to slide down into place from completely off the screen either top or bottom, and then slide
 *    and slam to a stop"
 *   "i dont like how the rainbow of colors shows up and then the ancients slide in. i want each background to slide in
 *    with the ancient quickly following. and we can try doing it outside to inside instead of left to right"
 *   "almost grinding against eachother as their edges meet. and land with a shaking thud and sparks where they hit the
 *    other edge of the screen"
 *   "then 3 shake and their edges glow as the other three fade out and fall away, revealing the ancient select screen"
 */
export interface PanelTiming {
  panelPairGapMs: number; panelFollowMs: number; panelSlideMs: number; panelStaggerMs: number;
  panelHoldMs: number; panelRattleMs: number; panelFallMs: number;
}

/** The slide is HOME at this fraction of its length; the rest is the thud settling from a small overshoot. */
export const PANEL_LAND = 0.84;
/** The slide's easing: it gathers speed the whole way (heavy stone) and stops dead. */
export const PANEL_SLIDE_EASE = [0.55, 0, 0.95, 0.6] as const;
/**
 * LAYERED PORTRAITS (owner 2026-11-19). Where an Ancient's tall cut-out figure (a 2:3 image) sits in its square, in %
 * of that square, so its mask lands where the flat painting's mask is: the panel ends by shrinking that square onto
 * the card's art, and the card shows the flat painting. `mx` is the mask's centre across the figure image (0..1).
 * Each was measured by eye from the mask's centre and height in both images; the figures are framed differently, so
 * each has its own.
 */
export interface PanelFigureFit { left: number; top: number; width: number; mx: number }
export const PANEL_FIGURE_FITS: Readonly<Record<string, PanelFigureFit>> = {
  death: { left: 4.4, top: -11.8, width: 88, mx: 0.527 },
  war: { left: -18.3, top: -34.6, width: 133, mx: 0.51 },
  fortune: { left: -0.9, top: -0.6, width: 98, mx: 0.54 },
  time: { left: 0, top: -20, width: 100, mx: 0.52 },
  genesis: { left: -3, top: -20, width: 100, mx: 0.52 },
  bonds: { left: -3.3, top: -9.8, width: 96, mx: 0.555 },
};
export const panelFigureFit = (id: string): PanelFigureFit => PANEL_FIGURE_FITS[id] ?? PANEL_FIGURE_FITS.death!;
/** A layered figure's height at rest, in screen heights: the whole cut-out stands in the strip and runs off the bottom
 *  (the flat painting only ever showed its middle). */
export const PANEL_FIGURE_REST_H = 1.09;
/**
 * The square's transform that stands a layered figure at rest (`translate(tx, ty) scale(s)` about the square's
 * centre, stage px): the figure `PANEL_FIGURE_REST_H` screens tall, its top just above the top of the screen and its
 * mask on the strip's centre line. The reveal animates from here onto the card (`translate(0, dy) scale(card / figS)`).
 */
export function panelFigureRest(g: PanelGeo, fit: PanelFigureFit): { tx: number; ty: number; s: number } {
  const w0 = g.figS * fit.width / 100, left0 = (fit.left / 100 - 0.5) * g.figS, top0 = (fit.top / 100 - 0.5) * g.figS;
  const s = PANEL_FIGURE_REST_H * g.vh / (w0 * 1.5);
  return { tx: -(left0 + fit.mx * w0) * s, ty: -0.02 * g.vh - g.vh / 2 - top0 * s, s };
}
/** The chosen three's edge glow over their rattle: up fast, then two pulses, ending lit. [offset, opacity]. */
export const PANEL_PULSE: readonly (readonly [number, number])[] = [[0, 0], [0.16, 1], [0.38, 0.4], [0.58, 1], [0.8, 0.45], [1, 1]];
/** The explosion's head start before the first background sets off (ms). */
export const PANEL_LEAD_MS = 220;
/** Outside to inside: the two outermost panels are rank 0, the two in the middle the last rank. */
export const panelRank = (i: number, n = 6): number => Math.min(i, n - 1 - i);

export interface PanelTimeline {
  /** Per panel, ms from the eruption's start: its background sets off, its Ancient sets off, its Ancient slams home. */
  bg: number[]; slide: number[]; land: number[];
  /** Every Ancient has settled. */
  allIn: number;
  /** The offered three start to rattle and glow. */
  pickAt: number;
  /** The other three start to fade and fall: only once the chosen three have pulsed (owner 2026-11-18: "their edges
   *  to pulse before the others fade away"). */
  fallAt: number;
  /** The select screen takes over (the gate's `reveal` beat). */
  revealAt: number;
}

export function panelTimeline(c: PanelTiming, n = 6): PanelTimeline {
  const bg: number[] = [], slide: number[] = [], land: number[] = [];
  for (let i = 0; i < n; i++) {
    // A pair sets off together but for a beat: the left of the two first, the right a moment after.
    bg.push(PANEL_LEAD_MS + panelRank(i, n) * Math.max(0, c.panelStaggerMs) + (i > n - 1 - i ? Math.max(0, c.panelPairGapMs) : 0));
    slide.push(bg[i]! + Math.max(0, c.panelFollowMs));
    land.push(slide[i]! + c.panelSlideMs * PANEL_LAND);
  }
  const allIn = Math.max(...slide) + c.panelSlideMs;
  const pickAt = allIn + Math.max(0, c.panelHoldMs);
  const fallAt = pickAt + c.panelRattleMs;
  return { bg, slide, land, allIn, pickAt, fallAt, revealAt: Math.max(pickAt + c.panelRattleMs, fallAt + c.panelFallMs * 0.75) };
}

/** Even panels come down from the top, odd ones up from the bottom. */
export const panelFromTop = (i: number): boolean => i % 2 === 0;

export interface PanelGeo {
  /** The stage's layout viewport (stage px). */
  vw: number; vh: number;
  n: number;
  /** One panel's visible width, and how far its top edge leans right of (and its bottom edge left of) centre. */
  stripW: number; slant: number;
  /** Each panel's box: `left[i]`, all `boxW` wide and `vh` tall. */
  boxW: number; left: number[];
  /** The Ancient's square, and how far off its place it starts (fully off screen). */
  figS: number; travel: number;
}

export function panelGeometry(vw: number, vh: number, slantPct: number, n = 6): PanelGeo {
  const stripW = vw / n, slant = Math.max(0, slantPct) * vw / 100;
  const figS = vh * 1.18;
  return { vw, vh, n, stripW, slant, boxW: stripW + 2 * slant, left: Array.from({ length: n }, (_, i) => i * stripW - slant), figS, travel: vh * 1.32 };
}

const px = (v: number): string => `${v.toFixed(1)}px`;

/** Panel `i`'s slanted strip, in its own box (px). The outer two run well past the stage's edge, so no corner shows. */
export function stripPolygon(g: PanelGeo, i: number): string {
  const far = g.vw; // comfortably off stage
  const l = i === 0 ? -far : 0, r = i === g.n - 1 ? g.boxW + far : g.boxW;
  return `polygon(${px(l + 2 * g.slant)} 0px, ${px(r)} 0px, ${px(r - 2 * g.slant)} ${px(g.vh)}, ${px(l)} ${px(g.vh)})`;
}

/** A card's art square, `w` wide from `top` to `bottom`, centred in the panel's box (the box itself is moved onto it). */
export function cardPolygon(g: PanelGeo, w: number, top: number, bottom: number): string {
  const l = g.boxW / 2 - w / 2, r = g.boxW / 2 + w / 2;
  return `polygon(${px(l)} ${px(top)}, ${px(r)} ${px(top)}, ${px(r)} ${px(bottom)}, ${px(l)} ${px(bottom)})`;
}

/** Stage x of the seam between panels `b - 1` and `b` (1..n-1) at stage height `y`. */
export function seamX(g: PanelGeo, b: number, y: number): number {
  return b * g.stripW + g.slant * (1 - 2 * y / g.vh);
}

const slideEase = cubicBezier(...PANEL_SLIDE_EASE);
/** Where the sliding Ancient's leading edge is, `t` (0..1) of the way home: it sweeps the whole screen, top to bottom
 *  for a panel from the top and bottom to top for one from below. Stage px. */
export function slideLeadY(g: PanelGeo, fromTop: boolean, t: number): number {
  const k = slideEase(Math.max(0, Math.min(1, t)));
  return fromTop ? g.vh * k : g.vh * (1 - k);
}
