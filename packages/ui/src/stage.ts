/**
 * THE STAGE: one uniform scale for the whole game on small screens (owner ask 2026-09-26: "when the screen shrinks
 * our art pieces fly all over the place").
 *
 * The layout itself was already resolution-independent in principle: every size and offset in styles.css is
 * authored in reference px × `--scale`, inside a 16:9 box (`--gw` × `--gh`, see the `:root` block). What broke on
 * small windows and phones was everything that did NOT ride `--scale`: thousands of raw-px borders, gaps, font
 * sizes and paddings, `clamp()` floors, viewport media queries, plus a separate "phone mode" (gh < 600) that
 * zoomed cards and the board art by hand. Below ~1080px tall those drifted apart from the board art.
 *
 * The fix is a FLOOR on the layout viewport. The game never lays out smaller than the design size
 * (`DESIGN_W` × `DESIGN_H`, the owner's 1080p desktop). On a smaller window it lays out at the design size and
 * the stage (`#stage`, wrapping `#root`) is scaled down by ONE transform, so every pixel of the tuned 1080p look shrinks together and nothing
 * can drift. On a window at or above the design size NOTHING changes: no transform, `s === 1`, and every helper
 * below is the identity, so desktop and ultrawide keep their existing code path byte for byte.
 *
 * THE COORDINATE RULE (see CLAUDE.md, UI conventions): screen space and stage space differ by `s` when the
 * stage is scaled. Measure in SCREEN space (`getBoundingClientRect`, `clientX/Y`, `window.innerWidth`), and
 * convert with `toStage` / `rectToStage` / `stageViewport` ONLY at the moment a measured value is written into a
 * DOM element's CSS (left / top / width / height / translate). The Pixi canvases stay in screen space (their
 * renderer is sized to the window, their CSS box to the stage), so rects go into Pixi unconverted.
 */

import { PHONE_DIAG, PHONE_GPU, setPixiPageScale } from './phoneDiag';
import { isPhone } from './deviceClass';

/** The design viewport: the layout never goes smaller than this. The owner's 1080p desktop look. */
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

/**
 * PHONES: THE DESKTOP GAME, ZOOMED (owner 2026-10-23/24, R-PHONE-ZOOM-01: "just take the normal game's 21:9 and zoom it
 * slightly as a starting point" ... "we need more zoom in general across the board"). A phone in landscape lays a RUN out
 * the way a desktop ~21:9 window does (the 1920 x 1080 box centred, the board art filling the sides, nothing
 * repositioned) and shows it `PHONE_ZOOM_VARIANTS[v]` times larger than the plain fit phones had before. The box and the
 * board are centred and their outer edges (empty board frame, background) are cropped. On a phone the visible part of the
 * box is about x 125..1795, y 150..930, and every HUD piece has ONE fixed seat in box coordinates, baked in place beside
 * or on its painted socket (touchUi.css, "Phones: the desktop game, zoomed, with the HUD BAKED IN PLACE"). Menus and
 * hero select keep the plain fit (they reflow to the window; a zoom would cut them).
 * Desktop, laptops and tablets never zoom (`phoneZoomApplies` needs `isPhone()`, a landscape window and a run).
 * Phone diagnostics: `pz125` / `pz135` / `pz145` pick the variant (1.35 by default), `nophonezoom` turns it off. The
 * retired experimental phone COMPOSITION (2:1 box, phoneLayout.css) stays behind the `phonelayout` switch only.
 */
export const PHONE_ZOOM_VARIANTS = { pz125: 1.25, pz135: 1.35, pz145: 1.45 } as const;
export type PhoneZoomVariant = keyof typeof PHONE_ZOOM_VARIANTS;
export const PHONE_ZOOM_DEFAULT: PhoneZoomVariant = 'pz135';
/** The variant the diagnostics flags pick (the first set wins), else the default. */
export function phoneZoomOf(flags: Partial<Record<string, 1>>): number {
  for (const k of Object.keys(PHONE_ZOOM_VARIANTS) as PhoneZoomVariant[]) if (flags[k]) return PHONE_ZOOM_VARIANTS[k];
  return PHONE_ZOOM_VARIANTS[PHONE_ZOOM_DEFAULT];
}
/** The HOUSED span of the 1920 x 1080 box (layout px): the union of every HUD piece that sits in a painted housing of the
 *  board art, at its exact desktop seat (the hero ring + Health plate + rune sockets, the hero power, Tier, Freeze,
 *  Refresh, End Turn, Gold, and in combat the foe's corner socket with its name plaque, Health, Shop tier, power and
 *  rune sockets), measured off the desktop layout, plus a 10 px breath. The phone zoom keeps all of it on screen. */
export const PHONE_HOUSED_SPAN = { left: 55, top: 18, right: 1887, bottom: 1055 }; // top 18 = a 6 px breath above the foe's name plaque (y 24)
/** The breathing gap kept either side of the housed span, layout px. */
export const PHONE_SIDE_GAP = 20;
/** The lowest housed piece (your Health / Armor plate under the hero ring, at its desktop seat): inside the safe area. */
export const PHONE_ART_BOTTOM = 1028; // the Health plate's foot (1044, raised 20 onto the ring's rim on a phone) + a breath
/**
 * THE GESTURE STRIP every phone keeps clear at its bottom edge (owner 2026-10-24, R-PHONE-PARITY-01: "Pixel and iPhone
 * should be 1:1 experience"), as a share of the screen height: the iPhone 15 Pro's home indicator inset (21 of 393 pt).
 * The hand's resting line, the pop's foot and the corner buttons sit on top of it. A phone whose browser reports a
 * bigger bottom inset keeps that instead; one that reports none (Chrome on a Pixel, whose gesture bar still sits there)
 * keeps the same share as an iPhone, so the bottom-edge pieces sit at the same place on every phone.
 */
export const PHONE_GESTURE_FRAC = 21 / 393;
/** Pure: the bottom strip a phone keeps clear, SCREEN px: the reported bottom inset or the shared share, the larger. */
export function phoneBottomStrip(vh: number, insetBottom: number): number {
  return Math.max(0, insetBottom, PHONE_GESTURE_FRAC * vh);
}
/**
 * THE RUN'S FOOT ON A PHONE (owner 2026-10-25, R-PHONE-ZOOM-02: "the mobile version still looks really small ... increase
 * the scale of the game / zoom it a bit more"): the lowest housed piece (your Health plate, display only, at the bottom
 * LEFT) frames down to this share of the screen height above the bottom edge, not above the whole gesture strip: the
 * home indicator / gesture bar is a short bar at the bottom CENTRE, nowhere near it. The strip still holds the hand's
 * resting line, the corner buttons and the pop's foot (`phoneBottomStrip`). A share, so every phone keeps one proportion.
 */
export const PHONE_FOOT_FRAC = 4 / 393;
/** The lobby rail's footprint at the right safe edge on a phone, layout px: its width (222) plus its margin (56), as
 *  touchUi.css places it (`--lr-w`, `--lr-right`). It sits outside the housed span, right of Refresh. */
export const PHONE_RAIL_FOOTPRINT = 222 + 56;
/** Refresh's right edge in the box (layout px): the housed piece the rail must stay clear of. */
export const PHONE_REFRESH_RIGHT = 1666;
/** The clear gap kept between Refresh and the rail, SCREEN px. */
export const PHONE_RAIL_GAP = 6;
/** Pure: does the phone zoom apply? A phone, in landscape, in a run (not the menus or hero select), not switched off. */
export function phoneZoomApplies(phone: boolean, w: number, h: number, off = false, inRun = true): boolean {
  return phone && !off && inRun && w > h;
}
export const PHONE_DESIGN_W = 2160;
export const PHONE_BOX_ASPECT = PHONE_DESIGN_W / DESIGN_H;
export const DESK_BOX_ASPECT = 16 / 9;
/** Pure: does the experimental phone composition apply? Only when switched ON (`phonelayout`), on a phone in landscape. */
export function phoneLayoutApplies(phone: boolean, w: number, h: number, on = false): boolean {
  return phone && on && w > h;
}

export interface StageFit {
  /** The stage's scale: screen px per layout px. 1 at or above the design size, < 1 below it. */
  s: number;
  /** The LAYOUT viewport (what `100vw` / `100vh` mean inside the stage), in layout px. >= the design size. */
  lw: number;
  lh: number;
  /** THE SAFE AREA, per side, in LAYOUT px (the screen inset / s): the notch / Dynamic Island / home indicator. */
  safe: SafeInsets;
  /** The game box's aspect: 16:9, or 2:1 in the phone layout (R-PHONE-LAYOUT-01). Absent = 16:9. */
  aspect?: number;
  /** The phone zoom (R-PHONE-ZOOM-01): the scale relative to the plain inset fit (the box is the full design size,
   *  placed at `barX` / `barY`, its edges cropped). Absent = no phone zoom. */
  zoom?: number;
  /** With the phone zoom: the box's left / top edge in layout px. */
  barX?: number;
  barY?: number;
  /** THE SCREEN SCALE (screen px per layout px) when it differs from `s`: on the page scale (R-PHONE-PAGESCALE-01) the
   *  browser scales the page, so coordinates are already layout px (`s === 1`) while the game is drawn `vs` times its
   *  layout size. Absent = `s`. Read it through `screenScale()`. */
  vs?: number;
}

/** Safe-area insets (`env(safe-area-inset-*)`), per side. */
export interface SafeInsets { top: number; right: number; bottom: number; left: number }
export const NO_INSETS: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Pure fit math: the uniform scale that fits a design-size layout into a `vw` × `vh` window, AFTER taking the safe
 * area off (owner 2026-10-18, R-TOUCH-SAFEAREA-01: "the camera line also lines up with some ui elements").
 *
 * `insets` are SCREEN px (what `env(safe-area-inset-*)` reports). The 16:9 game box must sit clear of them, so the scale
 * is fitted to the window less the insets (symmetric per axis: the box is centred, so the larger side counts for both),
 * which keeps the box exactly the tuned 1920 x 1080 layout. The layout viewport still covers the WHOLE window (its
 * origin stays the window's top-left, so `toStage` is unchanged) and backdrops keep bleeding to the physical edges.
 * The insets come back in LAYOUT px (`safe`) for the stylesheet's `--safe-*` vars. Before this the stylesheet added raw
 * `env()` inside the scaled stage, where the transform shrank a 59 px island inset to about 21 px on screen.
 */
export function fitStage(vw: number, vh: number, insets: SafeInsets = NO_INSETS, designW: number = DESIGN_W, zoom = 1, phone = false): StageFit {
  const w = vw > 0 ? vw : designW;
  const h = vh > 0 ? vh : DESIGN_H;
  const ix = Math.max(0, insets.left, insets.right);
  // ONE PHONE, ONE GAME (R-PHONE-PARITY-01): on a phone in landscape the bottom inset is the system's gesture strip (the
  // iPhone's home indicator, Android's gesture bar), not a cut-out, so it never shrinks the plain fit (the menus, hero
  // select). Each browser reports it differently (iOS 21 pt, Chrome on a Pixel 0), and counting it (twice: the fit is
  // symmetric per axis) made the menus ~12% smaller, relative to the screen, on an iPhone than on a Pixel. The strip is
  // still kept clear, by the same share of the screen on every phone, by the bottom-edge pieces themselves
  // (`phoneBottomStrip`, `--pz-safe-b`); the run's zoom frames above it (below).
  const iy = phone && w > h ? Math.max(0, insets.top) : Math.max(0, insets.top, insets.bottom);
  const aw = w - 2 * ix > 0 ? w - 2 * ix : w;
  const ah = h - 2 * iy > 0 ? h - 2 * iy : h;
  const s = Math.min(1, aw / designW, ah / DESIGN_H);
  const safe = { top: Math.max(0, insets.top) / s, right: Math.max(0, insets.right) / s, bottom: Math.max(0, insets.bottom) / s, left: Math.max(0, insets.left) / s };
  if (zoom > 1 && designW === DESIGN_W) {
    // THE PHONE ZOOM (R-PHONE-ZOOM-01): as large as the HOUSED span allows (every piece that sits in a painted housing
    // stays exactly in it and inside the safe area), capped at the plain fit times `zoom`; the box is placed so that
    // span is centred in the safe area, and everything outside it (empty frame, background) is cropped.
    // Width: the housed span plus a breathing gap fills the safe width. Height: the span (a breath above the foe's name
    // plaque down to the hero ring's foot) inside the safe area, top and bottom insets both. Whichever binds wins; the
    // span is centred in the safe area.
    const e = PHONE_HOUSED_SPAN;
    const iL = Math.max(0, insets.left), iR = Math.max(0, insets.right), iT = Math.max(0, insets.top), iB = Math.max(0, insets.bottom);
    const sw = w - iL - iR;
    const spanW = e.right - e.left + 2 * PHONE_SIDE_GAP;
    // ONE framing for the shop and combat (a blind critic 2026-10-24: the hero ring and the help row must not move
    // between phases), so the span's top is always a breath above the foe's name plaque, the highest housed piece.
    const top = e.top;
    const spanH = PHONE_ART_BOTTOM - top;
    // The bottom bound: the safe bottom; on a phone (R-PHONE-PARITY-01) the shared gesture strip instead, the same share of
    // the screen on every phone (an iPhone's 21 pt home indicator inset, the same share on a Pixel that reports none), so
    // every phone shows the game at the same share of its height. (Framing an iPhone against its full height instead does
    // not fit: its Dynamic Island insets leave the lobby rail no room right of Refresh, R-PHONE-ZOOM-01.)
    // R-PHONE-ZOOM-02: on a phone the Health plate frames down to a thin foot above the bottom edge (`PHONE_FOOT_FRAC`),
    // and the lobby rail joins the width: the housed span from its left edge to Refresh, then the rail's footprint,
    // must fit the safe width with `PHONE_RAIL_GAP` between Refresh and the rail.
    // Whatever bottom inset the browser reports (iOS: the home indicator, 21 pt in the app and in Safari; Chrome on a
    // Pixel: 0) it is a bar at the bottom centre, never under the Health plate at the bottom left.
    const foot = phone ? PHONE_FOOT_FRAC * h : iB;
    const railW = phone ? (sw - PHONE_RAIL_GAP) / (PHONE_REFRESH_RIGHT - e.left + PHONE_RAIL_FOOTPRINT) : Infinity;
    const sz = Math.min(1, s * zoom, sw / spanW, railW, (h - iT - foot) / spanH);
    const sf = { top: iT / sz, right: iR / sz, bottom: iB / sz, left: iL / sz };
    let barX = iL / sz + (sw / sz - (e.right - e.left)) / 2 - e.left;
    if (phone) {
      // Centred, unless that would bring the rail within the gap of Refresh: then the span slides left (never past the
      // left safe edge), the same rule on every phone (a wide Pixel never needs it).
      const railMax = (w - iR - PHONE_RAIL_GAP) / sz - PHONE_RAIL_FOOTPRINT - PHONE_REFRESH_RIGHT;
      barX = Math.max(iL / sz - e.left, Math.min(barX, railMax));
    }
    const barY = iT / sz - top; // top-pinned: any slack goes to the bottom (the hand, the hero cluster)
    return { s: sz, lw: w / sz, lh: h / sz, safe: sf, zoom: sz / s, barX, barY };
  }
  return designW === DESIGN_W ? { s, lw: w / s, lh: h / s, safe } : { s, lw: w / s, lh: h / s, safe, aspect: designW / DESIGN_H };
}

/** The shorter window side from which a touch device counts as a TABLET (it may play portrait, letterboxed). */
export const TABLET_MIN_SIDE = 700;
/** Pure: is a `w` x `h` window tablet-sized (its shorter side at least `TABLET_MIN_SIDE`)? */
export function isTabletSize(w: number, h: number): boolean { return Math.min(w, h) >= TABLET_MIN_SIDE; }

/** The box-clearing margin per axis, layout px: the larger of the two sides (the box is centred). */
export function safeAxes(f: StageFit): { x: number; y: number } {
  return { x: Math.max(f.safe.left, f.safe.right), y: Math.max(f.safe.top, f.safe.bottom) };
}

/** The `data-lv` tokens for a fit: which layout-viewport breakpoints hold (see the `[data-lv~=…]` rules in styles.css). */
export function layoutBreakpoints(f: StageFit): string[] {
  const out: string[] = [];
  if (f.lw >= 2200) out.push('w2200');
  if (f.lh >= 1000) out.push('h1000');
  if (f.lh >= 1200) out.push('h1200');
  if (f.lh >= 1360) out.push('h1360');
  return out;
}

// The identity until `installStage()` / `applyStage()` runs: nothing is scaled before the transform exists, and a
// test environment (jsdom's 1024x768 window) never installs it, so its helpers stay exact no-ops.
let fit: StageFit = { s: 1, lw: typeof window === 'undefined' ? DESIGN_W : window.innerWidth, lh: typeof window === 'undefined' ? DESIGN_H : window.innerHeight, safe: NO_INSETS };
const listeners = new Set<(f: StageFit) => void>();

/** The phone layout is on (R-PHONE-LAYOUT-01): the fit was made for the 2:1 phone box. False on desktop, always. */
export function phoneLayoutOn(): boolean { return fit.aspect !== undefined; }
/** The current stage scale: CSS px per layout px, what every measured coordinate is converted by. 1 on the page scale,
 *  where the browser scales the page and CSS px ARE layout px (R-PHONE-PAGESCALE-01). */
export function stageScale(): number { return fit.s; }
/** The SCREEN scale: screen px per layout px, how large the game is drawn (the touch UI's sizing reads it). Equals
 *  `stageScale()` except on the page scale. */
export function screenScale(): number { return fit.vs ?? fit.s; }
/** The safe area in CSS px (what a measured rect is in): the layout-px insets times the stage scale. */
export function cssSafeInsets(): SafeInsets {
  const k = fit.s;
  return { top: fit.safe.top * k, right: fit.safe.right * k, bottom: fit.safe.bottom * k, left: fit.safe.left * k };
}
/** The window in SCREEN px (CSS px at page scale 1), whatever path shrinks the stage. */
export function screenSize(): { w: number; h: number } {
  return pageScaleNow !== 1 ? windowSize(screenViewport()) : windowSize();
}
/** The current fit (scale + layout viewport). */
export function stageFit(): StageFit { return fit; }
/** The LAYOUT viewport size, i.e. `window.innerWidth/innerHeight` expressed in stage px. */
export function stageViewport(): { w: number; h: number } { return { w: fit.lw, h: fit.lh }; }

/** A screen-space length or coordinate (from a rect or a pointer) in stage px. The stage's origin is the window's
 *  top-left, so positions and lengths convert the same way. Identity when the stage is unscaled. */
export function toStage(v: number): number { return fit.s === 1 ? v : v / fit.s; }
/** A stage-space length or coordinate back to screen px. */
export function toScreen(v: number): number { return fit.s === 1 ? v : v * fit.s; }
/** A screen point in stage px. */
export function pointToStage(x: number, y: number): { x: number; y: number } { return { x: toStage(x), y: toStage(y) }; }

export interface StageRect { left: number; top: number; right: number; bottom: number; width: number; height: number; x: number; y: number }
/** A `getBoundingClientRect()` result in stage px. */
export function rectToStage(r: { left: number; top: number; width: number; height: number }): StageRect {
  const left = toStage(r.left), top = toStage(r.top), width = toStage(r.width), height = toStage(r.height);
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

/** Subscribe to stage changes (resize / rotation). Returns an unsubscribe. */
export function onStageChange(fn: (f: StageFit) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * The stage element: a wrapper around React's `#root` that carries the transform. Portals and imperatively
 * appended layers go HERE (after `#root`, exactly where `document.body` used to put them) so they scale and
 * z-order with the game. `display: contents` while unscaled, so on desktop it generates no box and the page is
 * laid out exactly as before it existed. Created on first use, wrapping `#root` if there is one.
 */
export function stageHost(): HTMLElement {
  if (typeof document === 'undefined') return undefined as unknown as HTMLElement;
  const existing = document.getElementById('stage');
  if (existing) return existing;
  const stage = document.createElement('div');
  stage.id = 'stage';
  const root = document.getElementById('root');
  if (root?.parentNode) { root.parentNode.insertBefore(stage, root); stage.appendChild(root); }
  else document.body.appendChild(stage);
  return stage;
}

/**
 * Recompute the fit from the window and apply it: the layout-viewport vars (`--lvw` / `--lvh` / `--vw` / `--vh`)
 * that styles.css uses in place of raw `vw` / `vh`, and the transform on `#stage`. Called on boot and on every
 * resize / orientation change (never per frame).
 */
/**
 * The safe-area insets in SCREEN px, read off a hidden probe whose padding is `env(safe-area-inset-*)`. The probe lives
 * on `<html>`, OUTSIDE the transformed stage. One style read per resize / rotation, never per frame.
 */
export function readSafeInsets(): SafeInsets {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return NO_INSETS;
  let probe = document.getElementById('safe-probe');
  if (!probe) {
    probe = document.createElement('div');
    probe.id = 'safe-probe';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.documentElement.appendChild(probe);
  }
  const c = getComputedStyle(probe);
  const n = (v: string): number => { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? x : 0; };
  return { top: n(c.paddingTop), right: n(c.paddingRight), bottom: n(c.paddingBottom), left: n(c.paddingLeft) };
}

/**
 * The window size the stage must cover, screen px. `innerWidth` / `innerHeight`, except in an installed Home Screen
 * app on a PHONE, where the app always IS the whole screen: there iOS can hand back a stale size after a rotation,
 * and the stage then leaves a bar of bare background down one side (owner report 2026-10-18: "Make sure it fills the
 * screen too"). So the screen's own size, oriented by the current orientation, wins whenever it is the larger.
 */
export function windowSize(base?: { w: number; h: number }): { w: number; h: number } {
  let w = base ? base.w : window.innerWidth;
  let h = base ? base.h : window.innerHeight;
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone = nav.standalone === true
      || (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);
    const sc = window.screen;
    if (standalone && sc && sc.width > 0 && sc.height > 0) {
      const long = Math.max(sc.width, sc.height);
      const short = Math.min(sc.width, sc.height);
      if (short <= 600) { // a phone (an iPad app can be a split-view window smaller than its screen)
        const type = sc.orientation?.type;
        const landscape = type ? type.startsWith('landscape') : w >= h;
        const sw = landscape ? long : short;
        const sh = landscape ? short : long;
        if (sw * sh > w * h) { w = sw; h = sh; }
      }
    }
  } catch { /* the plain window size stands */ }
  return { w, h };
}

/**
 * THE PAGE SCALE (R-PHONE-PAGESCALE-01, owner report 2026-10-25, a real iPhone: "Mobile looks like this", the Shop
 * minions collapsed to their badges in one spot, the lobby rail tiny, Tier / Freeze / the Refresh cost huge).
 *
 * A phone does not shrink the stage with a transform or CSS `zoom`. It lays the page out at the stage's layout size and
 * lets the BROWSER scale the page, the way it shows a desktop site: the meta viewport is written as
 * `width=<lw>, initial-scale=minimum-scale=maximum-scale=<s>`, and the stage itself is unscaled (`s === 1` for every
 * coordinate helper: rects, pointers and `innerWidth` are all in layout px, as on a desktop window of that size).
 *  - Why not CSS `zoom` (what phones used before): WebKit applies it in two ways Chromium does not. Every registered
 *    `@property` length DECLARED inside the zoomed subtree (`--ch` / `--cw` / `--ccw` / `--u`, re-declared per zone) is
 *    zoomed at the declaration AND again where it is used (the Shop cards came out 0.37^2 to 0.37^3 their size), and its
 *    minimum logical font size lifts every font that the zoom takes under 9 SCREEN px back to 9 px, before any transform
 *    (so text inside a scaled-up pill, Tier / Freeze, came out about twice its size). Neither can be turned off in CSS.
 *  - Why not the transform (what phones used before the zoom): WebKit backs every composited layer inside a transformed
 *    stage at its full stage size, about 9x the memory, and the owner's iPhone crashed at the hero pick on it
 *    (R-TOUCH-RUN-MEMORY-01).
 *  - A page scale is neither: style and layout are untouched (no zoom, so no clamp and no double-zoomed property) and
 *    the browser rasterises its layers at the page scale (their on-screen size), as it does for any zoomed-out page.
 * The Pixi renderers are sized in layout px, so their resolution folds in the page scale (`phonePixiOptions`).
 * Desktop never takes this path (`PHONE_GPU` is false there).
 */
export type StageMode = 'page' | 'zoom' | 'transform';
/**
 * Pure: how the stage is shrunk. Desktop: the transform, always. A phone: the page scale, unless a diagnostics switch
 * asks for an old path (`zoom`: CSS zoom everywhere; `nozoom`: the transform on the menus; `gamexf`: the transform in
 * hero select, the gate and the run).
 */
export function stageModeFor(phone: boolean, onMenus: boolean, flags: { zoom?: 1; nozoom?: 1; gamexf?: 1 }): StageMode {
  if (!phone) return 'transform';
  if (flags.zoom) return 'zoom';
  if (onMenus) return flags.nozoom ? 'transform' : 'page';
  return flags.gamexf ? 'transform' : 'page';
}

let pageScaleNow = 1;
/** The page scale the browser applies (screen px per CSS px), 1 off the page-scale path. Pixi resolutions fold it in. */
export function pageScale(): number { return pageScaleNow; }

/**
 * The visible viewport in SCREEN px (CSS px at page scale 1): the visual viewport's size times its scale, so it is the
 * same whatever page scale is applied. Falls back to the window size where there is no visualViewport.
 */
export function screenViewport(): { w: number; h: number } {
  const vv = window.visualViewport;
  if (vv && vv.width > 0 && vv.height > 0 && vv.scale > 0) return { w: vv.width * vv.scale, h: vv.height * vv.scale };
  return { w: window.innerWidth, h: window.innerHeight };
}

/**
 * Whether `env(safe-area-inset-*)` is reported in SCREEN px (unchanged by the page scale, as Chrome does) or in CSS px
 * of the scaled page (divided by it). Learnt once, the first time the page scale is applied, by comparing with the
 * insets read at scale 1; until then (and with no insets to compare) screen px.
 */
let insetsAt1: SafeInsets | null = null;
let insetsScaled: boolean | null = null;
function screenInsets(raw: SafeInsets, scale: number): SafeInsets {
  if (scale === 1 || insetsScaled !== true) return raw;
  return { top: raw.top * scale, right: raw.right * scale, bottom: raw.bottom * scale, left: raw.left * scale };
}
function learnInsetUnits(raw: SafeInsets, scale: number): void {
  if (insetsScaled !== null || !insetsAt1 || scale === 1) return;
  const a = Math.max(insetsAt1.left, insetsAt1.right, insetsAt1.top, insetsAt1.bottom);
  const b = Math.max(raw.left, raw.right, raw.top, raw.bottom);
  if (a < 1 || b < 1) return;
  insetsScaled = Math.abs(b * scale - a) < Math.abs(b - a);
}

let viewportMeta = '';
/** Write the meta viewport (only when it changes, so a resize it causes settles at once). */
function setViewportMeta(content: string): void {
  if (content === viewportMeta) return;
  let m = document.querySelector('meta[name="viewport"]');
  if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'viewport'); document.head.appendChild(m); }
  if (!viewportMeta) viewportMeta = m.getAttribute('content') ?? '';
  if (content === viewportMeta) return;
  m.setAttribute('content', content);
  viewportMeta = content;
}
/** The page's own meta viewport (index.html): every path but the page scale keeps it. */
export const DEVICE_VIEWPORT = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
/** Pure: the meta viewport for a page scale `s` over a layout `lw` px wide. */
export function pageViewportContent(lw: number, s: number): string {
  const k = Number(s.toFixed(6));
  return `width=${Math.round(lw)}, initial-scale=${k}, minimum-scale=${k}, maximum-scale=${k}, user-scalable=no, viewport-fit=cover`;
}

let pinchBlocked = false;
/** iOS Safari ignores `user-scalable=no`; its own gesture events are the only way to keep a pinch from zooming the page. */
function blockPinch(): void {
  if (pinchBlocked) return;
  pinchBlocked = true;
  const stop = (e: Event): void => { if (document.documentElement.hasAttribute('data-page-scale')) e.preventDefault(); };
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop, { passive: false });
}

export function applyStage(): StageFit {
  if (typeof window === 'undefined') return fit;
  const mode = stageMode();
  if (mode === 'page') return applyPageStage();
  if (pageScaleNow !== 1 || document.documentElement.hasAttribute('data-page-scale')) leavePageScale();
  return applyScaledStage();
}

/** Back from the page scale to a scale-1 page (a diagnostics switch, or a big tablet). */
function leavePageScale(): void {
  pageScaleNow = 1;
  setPixiPageScale(1);
  document.documentElement.removeAttribute('data-page-scale');
  setViewportMeta(DEVICE_VIEWPORT);
}

function applyPageStage(): StageFit {
  const de = document.documentElement;
  const cur = window.visualViewport?.scale ?? 1;
  const raw = readSafeInsets();
  if (cur === 1 && !de.hasAttribute('data-page-scale')) insetsAt1 = raw;
  learnInsetUnits(raw, cur);
  const insets = screenInsets(raw, cur);
  const { w, h } = windowSize(screenViewport());
  const phoneLayout = phoneLayoutApplies(isPhone(), w, h, !!PHONE_DIAG.phonelayout);
  de.toggleAttribute('data-phone-layout', phoneLayout);
  const phoneZoom = !phoneLayout && phoneZoomApplies(isPhone(), w, h, !!PHONE_DIAG.nophonezoom, inRun);
  de.toggleAttribute('data-phone-zoom', phoneZoom);
  de.toggleAttribute('data-phone-menus', phoneLayout && menuZoom);
  const vis = fitStage(w, h, insets, phoneLayout ? PHONE_DESIGN_W : DESIGN_W, phoneZoom ? phoneZoomOf(PHONE_DIAG) : 1, isPhone() && !phoneLayout);
  if (vis.s === 1) { leavePageScale(); return applyScaledStage(); } // at or above the design size: nothing to scale
  // The page is laid out at the layout size and the browser scales it by `vis.s`: every coordinate the game reads is
  // already in layout px, so the fit it sees is unscaled (`s === 1`); the box, the safe area and the bars stay as fitted.
  // The meta viewport takes a whole layout width, so the scale is snapped to it (under 0.05%): the browser's own scale,
  // width / layout width, is then exactly the one the layout is sized for.
  const k = w / Math.max(1, Math.round(vis.lw));
  fit = { ...vis, s: 1, vs: k, lw: w / k, lh: h / k };
  pageScaleNow = k;
  setPixiPageScale(k);
  blockPinch();
  de.setAttribute('data-page-scale', String(Number(k.toFixed(4))));
  setViewportMeta(pageViewportContent(fit.lw, k));
  writeFitVars(fit, w, h, insets, phoneLayout);
  // The stage-scale var stays the screen scale (screen px per layout px): the crash readout counter-scales by it.
  de.style.setProperty('--stage-s', String(k));
  const root = stageHost();
  if (root) {
    root.style.width = `${fit.lw}px`;
    root.style.height = `${fit.lh}px`;
    root.style.removeProperty('transform'); root.style.removeProperty('zoom');
  }
  listeners.forEach((l) => l(fit));
  return fit;
}

/** The layout vars every scaled path writes (safe area, breakpoints, the phone zoom's box, the gesture strip). */
function writeFitVars(next: StageFit, w: number, h: number, insets: SafeInsets, phoneLayout: boolean): void {
  const de = document.documentElement.style;
  de.setProperty('--safe-t', `${next.safe.top}px`); de.setProperty('--safe-r', `${next.safe.right}px`);
  de.setProperty('--safe-b', `${next.safe.bottom}px`); de.setProperty('--safe-l', `${next.safe.left}px`);
  document.documentElement.setAttribute('data-lv', layoutBreakpoints(next).join(' '));
  if (next.barX !== undefined && next.barY !== undefined) {
    de.setProperty('--pz-bx', `${next.barX}px`); de.setProperty('--pz-by', `${next.barY}px`);
    de.setProperty('--pz-vfit', String(Math.min(1, next.lh / DESIGN_H)));
  } else { de.removeProperty('--pz-bx'); de.removeProperty('--pz-by'); de.removeProperty('--pz-vfit'); }
  // The gesture strip in layout px: screen px over the SCREEN scale (h / lh), whatever path shrinks the stage.
  if (isPhone() && w > h && !phoneLayout) de.setProperty('--pz-safe-b', `${phoneBottomStrip(h, insets.bottom) * (next.lh / h)}px`);
  else de.removeProperty('--pz-safe-b');
  document.documentElement.toggleAttribute('data-tablet', isTabletSize(w, h));
  de.setProperty('--lvw', `${next.lw}px`); de.setProperty('--lvh', `${next.lh}px`);
  de.setProperty('--vw', `${next.lw / 100}px`); de.setProperty('--vh', `${next.lh / 100}px`);
  document.documentElement.setAttribute('data-stage-scaled', '');
}

function applyScaledStage(): StageFit {
  const { w, h } = windowSize();
  // THE PHONE LAYOUT (R-PHONE-LAYOUT-01): a phone in landscape lays out in the 2:1 box. Decided per fit (a rotation to
  // portrait drops it), written as `data-phone-layout` for phoneLayout.css. Desktop never has the attribute.
  const phoneLayout = phoneLayoutApplies(isPhone(), w, h, !!PHONE_DIAG.phonelayout);
  document.documentElement.toggleAttribute('data-phone-layout', phoneLayout);
  // THE PHONE ZOOM (R-PHONE-ZOOM-01): the desktop game, slightly larger. Written for styles.css (`--gw` / `--gh` pinned).
  const phoneZoom = !phoneLayout && phoneZoomApplies(isPhone(), w, h, !!PHONE_DIAG.nophonezoom, inRun);
  document.documentElement.toggleAttribute('data-phone-zoom', phoneZoom);
  // …and whether it is on the MENUS (title, mode pages) rather than hero select or a run: the in-game composition's
  // corner-button seats do not apply there (phoneLayout.css).
  document.documentElement.toggleAttribute('data-phone-menus', phoneLayout && menuZoom);
  const insets = readSafeInsets();
  const next = fitStage(w, h, insets, phoneLayout ? PHONE_DESIGN_W : DESIGN_W, phoneZoom ? phoneZoomOf(PHONE_DIAG) : 1, isPhone() && !phoneLayout);
  fit = next;
  const de = document.documentElement.style;
  // The SAFE AREA in layout px (R-TOUCH-SAFEAREA-01): the 16:9 box (`--gw` / `--gh`) and the edge-anchored HUD
  // (`--edge-*`) read these, so the island and the home indicator never cover UI, in either landscape rotation.
  de.setProperty('--safe-t', `${next.safe.top}px`); de.setProperty('--safe-r', `${next.safe.right}px`);
  de.setProperty('--safe-b', `${next.safe.bottom}px`); de.setProperty('--safe-l', `${next.safe.left}px`);
  // Layout-viewport breakpoints for the few stylesheet rules that used to be viewport @media queries (a media
  // query sees the WINDOW, which on a scaled stage is not the size the layout is drawn at).
  document.documentElement.setAttribute('data-lv', layoutBreakpoints(next).join(' '));
  // THE PHONE ZOOM's box placement (R-PHONE-ZOOM-01, touchUi.css); never written off a phone.
  if (next.barX !== undefined && next.barY !== undefined) {
    de.setProperty('--pz-bx', `${next.barX}px`); de.setProperty('--pz-by', `${next.barY}px`);
    // The layout viewport's height as a fraction of the design height: overlays sized off the viewport (the Runeforge)
    // keep their desktop proportions at the design height and scale by this to fit.
    de.setProperty('--pz-vfit', String(Math.min(1, next.lh / DESIGN_H)));
  } else { de.removeProperty('--pz-bx'); de.removeProperty('--pz-by'); de.removeProperty('--pz-vfit'); }
  // THE GESTURE STRIP (R-PHONE-PARITY-01): on a phone in landscape, the bottom strip its bottom-edge pieces keep clear (the
  // hand, the corner buttons, the menu pages' foot, the Compendium and Settings), in layout px: the same share of the
  // screen on every phone, whatever bottom inset its browser reports. Never written off a phone (they fall back to --safe-b).
  if (isPhone() && w > h && !phoneLayout) de.setProperty('--pz-safe-b', `${phoneBottomStrip(h, insets.bottom) / next.s}px`);
  else de.removeProperty('--pz-safe-b');
  // A TABLET may play upright, letterboxed (owner 2026-10-18, R-TOUCH-ROTATE-01): the rotate prompt is phones only.
  document.documentElement.toggleAttribute('data-tablet', isTabletSize(w, h));
  const root = stageHost();
  if (next.s === 1) {
    // Identity: the pre-stage behaviour exactly. Viewport units resolve against the real window.
    de.removeProperty('--lvw'); de.removeProperty('--lvh'); de.removeProperty('--vw'); de.removeProperty('--vh');
    de.removeProperty('--stage-s');
    document.documentElement.removeAttribute('data-stage-scaled');
    if (root) { root.style.removeProperty('width'); root.style.removeProperty('height'); root.style.removeProperty('transform'); root.style.removeProperty('zoom'); }
  } else {
    de.setProperty('--lvw', `${next.lw}px`); de.setProperty('--lvh', `${next.lh}px`);
    de.setProperty('--vw', `${next.lw / 100}px`); de.setProperty('--vh', `${next.lh / 100}px`);
    de.setProperty('--stage-s', String(next.s));
    document.documentElement.setAttribute('data-stage-scaled', '');
    if (root) {
      root.style.width = `${next.lw}px`;
      root.style.height = `${next.lh}px`;
      // The `zoom` phone diagnostics switch only (the old phone path, before the page scale, R-PHONE-PAGESCALE-01).
      // Desktop never takes this branch (`PHONE_GPU` is false there).
      if (stageMode() === 'zoom') { root.style.removeProperty('transform'); root.style.zoom = String(next.s); }
      else { root.style.removeProperty('zoom'); root.style.transform = `scale(${next.s})`; }
    }
  }
  listeners.forEach((l) => l(next));
  return next;
}

let menuZoom = false;
let inRun = false;
/** Game.tsx: a run is on screen (not the menus, not hero select). The phone zoom applies only then (R-PHONE-ZOOM-01).
 *  Re-applies the fit only when that changes. A no-op on desktop. */
export function setStageInRun(on: boolean): void {
  if (on === inRun) return;
  inRun = on;
  if (installed && isPhone()) applyStage();
}
/** How this device shrinks the stage on the current screen (see `stageModeFor`). Desktop: the transform. */
function stageMode(): StageMode {
  return PHONE_GPU ? stageModeFor(true, menuZoom, PHONE_DIAG) : 'transform';
}
/** Game.tsx: a phone is on the menus (title, mode pages, ladder pages; not hero select, not a run). Re-applies the fit
 *  only when that changes. A no-op on desktop. */
export function setStageMenuZoom(on: boolean): void {
  if (!PHONE_GPU || on === menuZoom) return;
  menuZoom = on;
  if (installed) applyStage();
}

let installed = false;
/** Install the resize / orientation listeners once and apply the first fit. Safe to call repeatedly. */
export function installStage(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  applyStage();
  // iOS reports a rotation before its new size (and its new safe-area insets) settle, so a rotation fits again a
  // beat later. Two timers per rotation, never per frame.
  let late: number[] = [];
  const settle = (): void => {
    applyStage();
    late.forEach((t) => window.clearTimeout(t));
    late = [150, 500].map((ms) => window.setTimeout(applyStage, ms));
  };
  window.addEventListener('resize', applyStage);
  window.addEventListener('orientationchange', settle);
  window.addEventListener('pageshow', settle);
  window.visualViewport?.addEventListener('resize', applyStage);
}

/** The 16:9 game box's caps (styles.css `--gw` / `--gh`: 16:9, never past 2560 x 1440 layout px). */
export const GAME_BOX_MAX_W = 2560;
export const GAME_BOX_MAX_H = 1440;
export interface GameBox { left: number; top: number; w: number; h: number }
/**
 * THE GAME BOX in SCREEN px: the centred 16:9 `.app` box every piece of UI is laid out in (styles.css `--gw` / `--gh`,
 * centred by `#root`'s flex), letterboxed inside a window of any other aspect. Pure math off the fit, no layout read,
 * so a pointer can be expressed as a fraction of the box and land on the same UI on any window (spectator cursor,
 * R-SPECTATE-CURSOR-01).
 */
export function gameBoxOf(f: StageFit): GameBox {
  const { x, y } = safeAxes(f); // the box clears the safe area (styles.css `--gw` / `--gh`)
  const aw = f.lw - 2 * x;
  const ah = f.lh - 2 * y;
  const a = f.aspect ?? DESK_BOX_ASPECT; // 2:1 in the phone layout (phoneLayout.css)
  // The phone zoom pins the box at the design size (it overflows the layout viewport and is cropped, styles.css).
  const w = f.zoom ? DESIGN_W : Math.min(aw, ah * a, GAME_BOX_MAX_W);
  const h = f.zoom ? DESIGN_H : Math.min(ah, aw / a, GAME_BOX_MAX_H);
  return { left: (f.barX ?? (f.lw - w) / 2) * f.s, top: (f.barY ?? (f.lh - h) / 2) * f.s, w: w * f.s, h: h * f.s };
}
/** The game box for the current window. The fit is refreshed on resize, but jsdom / pre-install reads the window. */
export function gameBox(): GameBox {
  if (typeof window !== 'undefined' && fit.s === 1 && (fit.lw !== window.innerWidth || fit.lh !== window.innerHeight)) {
    return gameBoxOf({ s: 1, lw: window.innerWidth || DESIGN_W, lh: window.innerHeight || DESIGN_H, safe: NO_INSETS });
  }
  return gameBoxOf(fit);
}
