/**
 * THE HERO ATTACK CAMERA (moved out of the Blast, 2026-09-28, when Quake joined it). A style computes a zoom, an
 * anchor and a shake offset per frame; this writes ONE transform onto `#stage` (composed with the stage's own scale,
 * outermost), so the FX and the portraits zoom and shake as one. A zoom anchored on a point keeps that point still, so
 * the struck hero is never pushed off an edge.
 *
 * THE CAMERA IS APPLIED TO THE FX EXACTLY ONCE (2026-09-29). The same transform is mirrored onto the style's Pixi root
 * ONLY when the canvas that draws it does NOT already ride the camera element. Since the scaled stage (#1762) the shared
 * above-portrait canvas (`canvas.pixifx-above`) is appended INSIDE `#stage`, and the Collection sandbox's canvas sits
 * inside its own camera box, so in every real context the DOM camera already zooms and shakes the FX; mirroring as well
 * applied it twice (effectively a zoom of z² about the focus, plus a doubled shake), and every FX drifted off the
 * portrait by up to about a portrait radius whenever the focus was not the struck hero (found by the Banana Cannon,
 * #1839). The decision is made once per attack, at `start()` (no per-frame DOM reads). The mirror stays for a camera
 * whose canvas lives outside it, and for no DOM camera at all (tests), where it is the only camera.
 *
 * `#stage` is `display: contents` on an unscaled screen (no box to transform): it gets the same fixed full-screen box
 * the scaled stage already has for the few hundred ms the camera moves (same layout, so nothing reflows), promoted
 * with `will-change` only while it moves, and every property is restored exactly at the end.
 */
import type { Pt } from './easing';

const CAM_PROPS = ['display', 'position', 'left', 'top', 'width', 'height', 'transform', 'transform-origin', 'will-change'] as const;

/** Anything the camera mirrors onto (a style's Pixi scene). */
export interface CameraMirror { setCamera(ax: number, ay: number, z: number): void }

/** Finds the canvas a style's Pixi scene is drawn on (resolved once, at `start()`). */
export type FxCanvasResolver = () => Element | null;

/**
 * THE DECISION: does the FX canvas already ride the camera element's transform? True when the camera contains the
 * canvas. With no canvas found yet, the shared overlay is assumed: `pixiFx` always appends the above-portrait canvas
 * into `#stage` (`stageHost()`), so a `#stage` camera carries it. No camera: nothing to ride. Pure DOM query, no layout.
 */
export function fxCanvasRidesCamera(camera: Element | null, canvas: Element | null): boolean {
  if (!camera) return false;
  if (canvas) return camera === canvas || camera.contains(canvas);
  return camera.id === 'stage';
}

/**
 * Where a hero attack's Pixi scene is drawn: the sandbox's own canvas when the caller mounts the scene itself (`mount`,
 * the Collection preview: its canvas sits in `host` / the camera box), else the shared above-portrait overlay.
 */
export function heroFxCanvas(o: { mount?: unknown; host?: Element | null; camera?: Element | null }): FxCanvasResolver {
  return () => {
    try {
      if (o.mount) return o.host?.querySelector('canvas') ?? o.camera?.querySelector('canvas') ?? null;
      return typeof document === 'undefined' ? null : document.querySelector('canvas.pixifx-above');
    } catch { return null; }
  };
}

export class StageCamera {
  private on = false;
  private base = '';
  private saved: Record<string, string> | null = null;
  private mirrorOn = true;

  /**
   * `el` null = no DOM camera (reduced motion, tests): the mirror still moves. `canvas` finds the canvas the mirror is
   * drawn on (default: the shared above-portrait overlay); the mirror is skipped when that canvas rides `el`.
   */
  constructor(
    private readonly el: HTMLElement | null,
    private readonly mirror: CameraMirror | null,
    private readonly canvas: FxCanvasResolver = heroFxCanvas({}),
  ) {}

  get active(): boolean { return this.on; }
  /** Whether the camera is mirrored onto the Pixi root (false when the FX canvas already rides the DOM camera). */
  get mirrorsCamera(): boolean { return !!this.mirror && (!this.el || this.mirrorOn); }

  start(): void {
    const camera = this.el;
    if (!camera || this.on || typeof document === 'undefined') return;
    // Decided once per attack (the canvas is up by the charge): mirror only a canvas that does not ride the camera.
    let rides = false;
    try { rides = fxCanvasRidesCamera(camera, this.canvas()); } catch { rides = false; }
    this.mirrorOn = !rides;
    this.saved = Object.fromEntries(CAM_PROPS.map((k) => [k, camera.style.getPropertyValue(k)]));
    this.base = camera.style.transform || '';
    try {
      if (getComputedStyle(camera).display === 'contents') {
        camera.style.display = 'block'; camera.style.position = 'fixed'; camera.style.left = '0'; camera.style.top = '0';
        camera.style.width = '100%'; camera.style.height = '100%';
      }
    } catch { /* no layout engine: fine */ }
    camera.style.transformOrigin = '0 0';
    camera.style.willChange = 'transform';
    this.on = true;
  }

  /**
   * Write the frame: zoom `zoom` anchored on `focus`, displaced by `(sx, sy)` (in the points' space; `unit` converts
   * it to screen px: the stage scale, or 1 in a local sandbox).
   */
  apply(focus: Pt, zoom: number, sx: number, sy: number, unit: number): void {
    const ax = focus.x * (1 - zoom) + sx * unit;
    const ay = focus.y * (1 - zoom) + sy * unit;
    if (this.el && this.on) this.el.style.transform = `translate(${ax.toFixed(2)}px, ${ay.toFixed(2)}px) scale(${zoom.toFixed(4)})${this.base ? ` ${this.base}` : ''}`;
    if ((this.on && this.mirrorOn) || !this.el) this.mirror?.setCamera(ax, ay, zoom);
  }

  reset(): void {
    this.mirror?.setCamera(0, 0, 1);
    const camera = this.el;
    if (!camera || !this.on || !this.saved) return;
    for (const k of CAM_PROPS) { const v = this.saved[k]; if (v) camera.style.setProperty(k, v); else camera.style.removeProperty(k); }
    this.on = false;
  }
}

/** A portrait's transform, saved at the start and restored exactly at the end (transform only, never layout). */
export class PortraitMover {
  private readonly prev: string;
  constructor(readonly el: HTMLElement | null) { this.prev = el ? el.style.transform : ''; }
  /** Write a transform, or restore the resting one when `css` is null. */
  set(css: string | null): void { if (this.el) this.el.style.transform = css ?? this.prev; }
  reset(): void { if (this.el) this.el.style.transform = this.prev; }
}
