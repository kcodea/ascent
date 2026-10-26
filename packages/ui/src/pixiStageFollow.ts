/**
 * PIXI RENDERERS FOLLOW THE STAGE (R-PHONE-FXSIZE-01, owner report 2026-10-26, a tester: "some pixi effects dont seem to
 * be firing and that animations also seem to be offset up and to the left").
 *
 * Every screen-space Pixi canvas (`.pixi-screen`: the FX overlay and its under / above slots, the wipe, the gate) has its
 * CSS box pinned to the stage's layout viewport (`--lvw` x `--lvh`, styles.css), and draws DOM rects 1:1 into a renderer
 * sized by Pixi's `resizeTo`. Pixi resizes only on a window `resize` event. On the phone page scale
 * (R-PHONE-PAGESCALE-01) the layout size changes when stage.ts rewrites the meta viewport (the menus, hero select and
 * the run each fit their own scale), and WebKit fires NO `resize` for that (Chromium does). The renderer kept the size it
 * was created at (hero select: 2341 x 1079) while its box shrank to the run's (2212 x 1020), so every effect was drawn at
 * 0.945 of its coordinates: shifted up and left, more the further from the top-left corner, and softer (its resolution
 * still folded in the old page scale).
 *
 * `followStage(app)` (phones only; a no-op on desktop, which never takes the page scale) replaces the app's `resize` so a
 * window renderer is sized from the FIT (the box its canvas is drawn in) rather than `innerWidth`, re-folds the current
 * page scale into the resolution, and runs it on every stage change. An element-sized renderer (resized to its host) keeps
 * measuring its host, one frame after the change (its layout has settled by then). Pixi's own `resize` listener calls
 * the same replaced function, so a real window resize can no longer read a stale size either.
 */
import type { Application } from 'pixi.js';
import { onStageChange, stageFit } from './stage';
import { PHONE_GPU, pixiPageScaleNow } from './phoneDiag';
import { trackPixiApp, type TrackedPixiApp } from './fxLedger';

/** Pure: the renderer resolution after the page scale moved from `k0` (at creation) to `k`. */
export function followedResolution(r0: number, k0: number, k: number): number {
  return k0 > 0 && k > 0 ? r0 * (k / k0) : r0;
}

/** Pure: the screen size a WINDOW-sized screen renderer must have: its canvas box (the layout viewport) in screen px of
 *  the stage's own transform (`s`; 1 on the page scale, where the browser scales the page instead). */
export function followedWindowSize(f: { lw: number; lh: number; s: number }): { w: number; h: number } {
  return { w: f.lw * f.s, h: f.lh * f.s };
}

interface Resizable {
  resizeTo?: Window | HTMLElement | null;
  resize: () => void;
  queueResize?: () => void;
}

/**
 * Keep `app`'s renderer the size of its canvas box and at the current page scale's resolution, on a phone. Call once,
 * right after `app.init`. Returns the unsubscribe (also run by `app.destroy`).
 */
export function followStage(app: Application, phone: boolean = PHONE_GPU): () => void {
  // Every Application in the UI passes through here, so the phone perf log registers it here (a no-op when it is off).
  trackPixiApp(app as unknown as TrackedPixiApp);
  if (!phone || typeof window === 'undefined') return () => {};
  const a = app as unknown as Resizable;
  const r0 = app.renderer.resolution;
  const k0 = pixiPageScaleNow();
  a.resize = () => {
    const to = a.resizeTo;
    if (!to || !app.renderer) return;
    let w: number; let h: number;
    if (to === window) ({ w, h } = followedWindowSize(stageFit()));
    else { w = (to as HTMLElement).clientWidth; h = (to as HTMLElement).clientHeight; }
    if (!(w > 0 && h > 0)) return;
    // Two steps: the size at the current resolution, then the new resolution. A page-scale change moves the layout size
    // and the resolution in exact inverse proportion, so the BACKING size is often unchanged (2341 x 0.546 = 2212 x
    // 0.578 = 1278 px), and Pixi skips a resize whose pixel size is unchanged, frame and screen included: done in one
    // step, the renderer kept its old screen (seen in WebKit, 2026-10-26).
    app.renderer.resize(w, h);
    app.renderer.resize(w, h, followedResolution(r0, k0, pixiPageScaleNow()));
    app.render();
  };
  a.resize();
  let raf = 0;
  const off = onStageChange(() => {
    if (a.resizeTo === window) { a.resize(); return; }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { raf = 0; a.resize(); });
  });
  const destroy = app.destroy.bind(app);
  let done = false;
  const stop = (): void => { if (done) return; done = true; off(); cancelAnimationFrame(raf); };
  (app as unknown as { destroy: typeof destroy }).destroy = ((...args: Parameters<typeof destroy>) => { stop(); return destroy(...args); }) as typeof destroy;
  return stop;
}
