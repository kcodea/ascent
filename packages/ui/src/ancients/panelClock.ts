import { cubicBezier } from '../wipeGeometry';

/**
 * THE SIX PANELS (owner 2026-11-18): the awakening's centre beat, in place of the curtain and its title card.
 * Pure numbers only (the clock and the geometry), so the gate, the panels and the sparks all read ONE source and a
 * test can pin it. The owner's words:
 *   "a big (pixi fx driven) explosion occurs from the hero power"
 *   "i want all 6 background colors to pop in from left to right, and then the ancient itself to slide down into place
 *    from completely off the screen either top or bottom, and then slide and slam to a stop"
 *   "almost grinding against eachother as their edges meet. and land with a shaking thud and sparks where they hit the
 *    other edge of the screen"
 *   "then 3 shake and their edges glow as the other three fade out and fall away, revealing the ancient select screen"
 */
export interface PanelTiming {
  panelPopGapMs: number; panelPopMs: number; panelSlideMs: number; panelStaggerMs: number;
  panelHoldMs: number; panelRattleMs: number; panelFallMs: number;
}

/** The slide is HOME at this fraction of its length; the rest is the thud settling from a small overshoot. */
export const PANEL_LAND = 0.84;
/** The slide's easing: it gathers speed the whole way (heavy stone) and stops dead. */
export const PANEL_SLIDE_EASE = [0.55, 0, 0.95, 0.6] as const;
/** The explosion's head start before the first colour pops (ms). */
export const PANEL_LEAD_MS = 220;
/** After the last colour pops, before the first Ancient sets off (ms). */
export const PANEL_AFTER_POP_MS = 280;

export interface PanelTimeline {
  /** Per panel, ms from the eruption's start: its colour pops, its Ancient sets off, its Ancient slams home. */
  pop: number[]; slide: number[]; land: number[];
  /** Every Ancient has settled. */
  allIn: number;
  /** "An Ancient Awakens" arrives over the six. */
  titleAt: number;
  /** The offered three start to rattle and glow. */
  pickAt: number;
  /** The other three start to fade and fall. */
  fallAt: number;
  /** The select screen takes over (the gate's `reveal` beat). */
  revealAt: number;
}

export function panelTimeline(c: PanelTiming, n = 6): PanelTimeline {
  const pop: number[] = [], slide: number[] = [], land: number[] = [];
  const lastPop = PANEL_LEAD_MS + (n - 1) * Math.max(0, c.panelPopGapMs);
  const t1 = lastPop + PANEL_AFTER_POP_MS;
  for (let i = 0; i < n; i++) {
    pop.push(PANEL_LEAD_MS + i * Math.max(0, c.panelPopGapMs));
    slide.push(t1 + i * Math.max(0, c.panelStaggerMs));
    land.push(slide[i]! + c.panelSlideMs * PANEL_LAND);
  }
  const allIn = slide[n - 1]! + c.panelSlideMs;
  const pickAt = allIn + Math.max(0, c.panelHoldMs);
  const fallAt = pickAt + c.panelRattleMs * 0.55;
  return { pop, slide, land, allIn, titleAt: allIn - 60, pickAt, fallAt, revealAt: Math.max(pickAt + c.panelRattleMs, fallAt + c.panelFallMs * 0.75) };
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
