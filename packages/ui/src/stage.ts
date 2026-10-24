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

import { PHONE_DIAG, PHONE_GPU } from './phoneDiag';
import { isPhone } from './deviceClass';

/** The design viewport: the layout never goes smaller than this. The owner's 1080p desktop look. */
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

/**
 * PHONES: THE DESKTOP GAME, SLIGHTLY ZOOMED (owner 2026-10-23, R-PHONE-ZOOM-01: "just take the normal game's 21:9 and
 * zoom it slightly as a starting point"). A phone in landscape (19.5:9 / 20:9) lays the game out the way a desktop
 * ~21:9 window does: the 1920 x 1080 box centred in a wider layout viewport, the board art filling the sides, the corner
 * HUD at the screen edges. Nothing is repositioned. Two things differ, both in how the stage is SCALED:
 *  - The box's top and bottom bands are empty board frame: the HUD spans only `PHONE_HUD_TOP`..`PHONE_HUD_BOTTOM` of its
 *    1080 rows. So the phone fits THAT span (not the whole box) into the screen less its top and bottom safe insets, and
 *    the empty bands are cropped. On an iPhone 15 Pro that is 1.13x the old inset-shrunk fit; on a Pixel 8 1.07x.
 *  - The box is placed so the HUD span starts at the safe top (`--pz-bar-y`, styles via touchUi.css), so the home
 *    indicator never covers the HUD.
 * Desktop, laptops and tablets never zoom (`phoneZoomApplies` needs `isPhone()` and a landscape window); the
 * `nophonezoom` diagnostics switch turns it off. The retired experimental phone COMPOSITION (2:1 box, phoneLayout.css)
 * stays in the code behind the `phonelayout` switch only (owner verdict 2026-10-23).
 */
/** The HUD's vertical span inside the 1080-row box (the timer's top to your Health plate's foot, plus a breath). */
export const PHONE_HUD_TOP = 38;
export const PHONE_HUD_BOTTOM = 1054;
/** Pure: does the phone zoom apply? A phone, in landscape, not switched off. */
export function phoneZoomApplies(phone: boolean, w: number, h: number, off = false): boolean {
  return phone && !off && w > h;
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
   *  its empty top and bottom bands cropped). Absent = no phone zoom. */
  zoom?: number;
  /** With the phone zoom: the box's top edge in layout px (negative: the cropped band). */
  barY?: number;
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
export function fitStage(vw: number, vh: number, insets: SafeInsets = NO_INSETS, designW: number = DESIGN_W, zoom = false): StageFit {
  const w = vw > 0 ? vw : designW;
  const h = vh > 0 ? vh : DESIGN_H;
  const ix = Math.max(0, insets.left, insets.right);
  const iy = Math.max(0, insets.top, insets.bottom);
  const aw = w - 2 * ix > 0 ? w - 2 * ix : w;
  const ah = h - 2 * iy > 0 ? h - 2 * iy : h;
  const s = Math.min(1, aw / designW, ah / DESIGN_H);
  const safe = { top: Math.max(0, insets.top) / s, right: Math.max(0, insets.right) / s, bottom: Math.max(0, insets.bottom) / s, left: Math.max(0, insets.left) / s };
  if (zoom && designW === DESIGN_W) {
    // THE PHONE ZOOM (R-PHONE-ZOOM-01): the HUD span (not the whole box) fitted between the safe top and bottom; the
    // box's empty top and bottom bands are cropped. `zoom` is reported against the plain inset fit.
    const span = PHONE_HUD_BOTTOM - PHONE_HUD_TOP;
    const vh2 = h - Math.max(0, insets.top) - Math.max(0, insets.bottom);
    const sz = Math.min(1, aw / designW, (vh2 > 0 ? vh2 : h) / span);
    const sf = { top: Math.max(0, insets.top) / sz, right: Math.max(0, insets.right) / sz, bottom: Math.max(0, insets.bottom) / sz, left: Math.max(0, insets.left) / sz };
    return { s: sz, lw: w / sz, lh: h / sz, safe: sf, zoom: sz / s, barY: sf.top - PHONE_HUD_TOP };
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
/** The current stage scale (screen px per layout px). */
export function stageScale(): number { return fit.s; }
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
export function windowSize(): { w: number; h: number } {
  let w = window.innerWidth;
  let h = window.innerHeight;
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

export function applyStage(): StageFit {
  if (typeof window === 'undefined') return fit;
  const { w, h } = windowSize();
  // THE PHONE LAYOUT (R-PHONE-LAYOUT-01): a phone in landscape lays out in the 2:1 box. Decided per fit (a rotation to
  // portrait drops it), written as `data-phone-layout` for phoneLayout.css. Desktop never has the attribute.
  const phoneLayout = phoneLayoutApplies(isPhone(), w, h, !!PHONE_DIAG.phonelayout);
  document.documentElement.toggleAttribute('data-phone-layout', phoneLayout);
  // THE PHONE ZOOM (R-PHONE-ZOOM-01): the desktop game, slightly larger. Written for styles.css (`--gw` / `--gh` pinned).
  const phoneZoom = !phoneLayout && phoneZoomApplies(isPhone(), w, h, !!PHONE_DIAG.nophonezoom);
  document.documentElement.toggleAttribute('data-phone-zoom', phoneZoom);
  // …and whether it is on the MENUS (title, mode pages) rather than hero select or a run: the in-game composition's
  // corner-button seats do not apply there (phoneLayout.css).
  document.documentElement.toggleAttribute('data-phone-menus', phoneLayout && menuZoom);
  const next = fitStage(w, h, readSafeInsets(), phoneLayout ? PHONE_DESIGN_W : DESIGN_W, phoneZoom);
  fit = next;
  const de = document.documentElement.style;
  // The SAFE AREA in layout px (R-TOUCH-SAFEAREA-01): the 16:9 box (`--gw` / `--gh`) and the edge-anchored HUD
  // (`--edge-*`) read these, so the island and the home indicator never cover UI, in either landscape rotation.
  de.setProperty('--safe-t', `${next.safe.top}px`); de.setProperty('--safe-r', `${next.safe.right}px`);
  de.setProperty('--safe-b', `${next.safe.bottom}px`); de.setProperty('--safe-l', `${next.safe.left}px`);
  // Layout-viewport breakpoints for the few stylesheet rules that used to be viewport @media queries (a media
  // query sees the WINDOW, which on a scaled stage is not the size the layout is drawn at).
  document.documentElement.setAttribute('data-lv', layoutBreakpoints(next).join(' '));
  // THE PHONE ZOOM's box top (R-PHONE-ZOOM-01, touchUi.css); never written off a phone.
  if (next.barY !== undefined) {
    de.setProperty('--pz-bar-y', `${next.barY}px`);
    de.setProperty('--pz-bar-b', `${next.lh - DESIGN_H - next.barY}px`); // the bar under the box (rules anchored by `bottom`)
  } else { de.removeProperty('--pz-bar-y'); de.removeProperty('--pz-bar-b'); }
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
      // PHONE MENUS (R-TOUCH-GPU-MEMORY-01): shrink with CSS `zoom`, whose layers WebKit lays out at their on-screen
      // size, instead of a transform, whose layers it pays at their full stage size x 3 x 3. See `setStageMenuZoom`.
      // Desktop never takes this branch (`PHONE_GPU` is false there).
      if (stageZoomed()) { root.style.removeProperty('transform'); root.style.zoom = String(next.s); }
      else { root.style.removeProperty('zoom'); root.style.transform = `scale(${next.s})`; }
    }
  }
  listeners.forEach((l) => l(next));
  return next;
}

let menuZoom = false;
/**
 * Pure: does the stage zoom instead of transform? Only on a phone (desktop: never, whatever else is passed).
 *   - On its MENUS: yes, unless the `nozoom` switch (R-TOUCH-GPU-MEMORY-01).
 *   - In HERO SELECT, THE GATE AND THE RUN (R-TOUCH-RUN-MEMORY-01, owner 2026-10-22: "I still can't even play it
 *     because of the crashing"): yes when this browser reports geometry under CSS zoom the standard way
 *     (`standardZoom`, see `zoomGeometryIsStandard`), because the game measures the screen with getBoundingClientRect
 *     and a browser that reports unzoomed rects would put every drag and effect in the wrong place. The `gamexf`
 *     switch keeps the games on the transform; the `zoom` switch zooms them even when the probe says no.
 * Why: a transformed stage makes WebKit pay every composited layer inside it at its full stage size times 3x3 (a
 * full-screen layer is about 87 MB); a zoomed stage lays them out at their on-screen size (about 11.5 MB).
 */
export function zoomedStage(
  phone: boolean, onMenus: boolean, flags: { zoom?: 1; nozoom?: 1; gamexf?: 1 }, standardZoom = false,
): boolean {
  if (!phone) return false;
  if (onMenus) return !flags.nozoom;
  if (flags.zoom) return true;
  return standardZoom && !flags.gamexf;
}

let zoomProbe: boolean | null = null;
/**
 * Does this browser report element geometry under CSS `zoom` the STANDARD way (getBoundingClientRect scaled by the
 * zoom, as a transform would)? Chrome since 128 and Safari since the CSS zoom standardisation do; older WebKit
 * returned the unzoomed size and divided the position by the zoom (WebKit bug 77998 / 185034). Measured once, with a
 * hidden 100 px box at left 100 px inside a zoom-0.5 host: standard reports 50 / 50. Phone only (never called on
 * desktop); false when it cannot measure.
 */
export function zoomGeometryIsStandard(): boolean {
  if (zoomProbe !== null) return zoomProbe;
  zoomProbe = false;
  try {
    if (typeof document === 'undefined' || !document.body) { zoomProbe = null; return false; }
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:400px;zoom:0.5;visibility:hidden;pointer-events:none;';
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:100px;top:100px;width:100px;height:100px;';
    host.appendChild(box);
    document.body.appendChild(host);
    const h = host.getBoundingClientRect();
    const r = box.getBoundingClientRect();
    host.remove();
    zoomProbe = Math.abs(r.width - 50) < 1.5 && Math.abs(r.height - 50) < 1.5
      && Math.abs(r.left - h.left - 50) < 1.5 && Math.abs(r.top - h.top - 50) < 1.5 && Math.abs(h.width - 200) < 1.5;
  } catch { zoomProbe = false; }
  return zoomProbe;
}

function stageZoomed(): boolean {
  if (!PHONE_GPU) return false;
  return zoomedStage(PHONE_GPU, menuZoom, PHONE_DIAG, menuZoom ? false : zoomGeometryIsStandard());
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
  return { left: ((f.lw - w) / 2) * f.s, top: (f.barY ?? (f.lh - h) / 2) * f.s, w: w * f.s, h: h * f.s };
}
/** The game box for the current window. The fit is refreshed on resize, but jsdom / pre-install reads the window. */
export function gameBox(): GameBox {
  if (typeof window !== 'undefined' && fit.s === 1 && (fit.lw !== window.innerWidth || fit.lh !== window.innerHeight)) {
    return gameBoxOf({ s: 1, lw: window.innerWidth || DESIGN_W, lh: window.innerHeight || DESIGN_H, safe: NO_INSETS });
  }
  return gameBoxOf(fit);
}
