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

/** The design viewport: the layout never goes smaller than this. The owner's 1080p desktop look. */
export const DESIGN_W = 1920;
export const DESIGN_H = 1080;

export interface StageFit {
  /** The stage's scale: screen px per layout px. 1 at or above the design size, < 1 below it. */
  s: number;
  /** The LAYOUT viewport (what `100vw` / `100vh` mean inside the stage), in layout px. >= the design size. */
  lw: number;
  lh: number;
}

/** Pure fit math: the uniform scale that fits a design-size layout into a `vw` × `vh` window. */
export function fitStage(vw: number, vh: number): StageFit {
  const w = vw > 0 ? vw : DESIGN_W;
  const h = vh > 0 ? vh : DESIGN_H;
  const s = Math.min(1, w / DESIGN_W, h / DESIGN_H);
  return { s, lw: w / s, lh: h / s };
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

let fit: StageFit = typeof window === 'undefined' ? { s: 1, lw: DESIGN_W, lh: DESIGN_H } : fitStage(window.innerWidth, window.innerHeight);
const listeners = new Set<(f: StageFit) => void>();

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
export function applyStage(): StageFit {
  if (typeof window === 'undefined') return fit;
  const next = fitStage(window.innerWidth, window.innerHeight);
  fit = next;
  const de = document.documentElement.style;
  // Layout-viewport breakpoints for the few stylesheet rules that used to be viewport @media queries (a media
  // query sees the WINDOW, which on a scaled stage is not the size the layout is drawn at).
  document.documentElement.setAttribute('data-lv', layoutBreakpoints(next).join(' '));
  const root = stageHost();
  if (next.s === 1) {
    // Identity: the pre-stage behaviour exactly. Viewport units resolve against the real window.
    de.removeProperty('--lvw'); de.removeProperty('--lvh'); de.removeProperty('--vw'); de.removeProperty('--vh');
    de.removeProperty('--stage-s');
    document.documentElement.removeAttribute('data-stage-scaled');
    if (root) { root.style.removeProperty('width'); root.style.removeProperty('height'); root.style.removeProperty('transform'); }
  } else {
    de.setProperty('--lvw', `${next.lw}px`); de.setProperty('--lvh', `${next.lh}px`);
    de.setProperty('--vw', `${next.lw / 100}px`); de.setProperty('--vh', `${next.lh / 100}px`);
    de.setProperty('--stage-s', String(next.s));
    document.documentElement.setAttribute('data-stage-scaled', '');
    if (root) {
      root.style.width = `${next.lw}px`;
      root.style.height = `${next.lh}px`;
      root.style.transform = `scale(${next.s})`;
    }
  }
  listeners.forEach((l) => l(next));
  return next;
}

let installed = false;
/** Install the resize / orientation listeners once and apply the first fit. Safe to call repeatedly. */
export function installStage(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  applyStage();
  window.addEventListener('resize', applyStage);
  window.addEventListener('orientationchange', applyStage);
}
