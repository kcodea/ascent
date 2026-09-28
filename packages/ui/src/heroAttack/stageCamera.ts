/**
 * THE HERO ATTACK CAMERA (moved out of the Blast, 2026-09-28, when Quake joined it). A style computes a zoom, an
 * anchor and a shake offset per frame; this writes ONE transform onto `#stage` (composed with the stage's own scale,
 * outermost) and mirrors the same transform onto the style's Pixi root, so the FX and the portraits zoom and shake as
 * one. A zoom anchored on a point keeps that point still, so the struck hero is never pushed off an edge.
 *
 * `#stage` is `display: contents` on an unscaled screen (no box to transform): it gets the same fixed full-screen box
 * the scaled stage already has for the few hundred ms the camera moves (same layout, so nothing reflows), promoted
 * with `will-change` only while it moves, and every property is restored exactly at the end.
 */
import type { Pt } from './easing';

const CAM_PROPS = ['display', 'position', 'left', 'top', 'width', 'height', 'transform', 'transform-origin', 'will-change'] as const;

/** Anything the camera mirrors onto (a style's Pixi scene). */
export interface CameraMirror { setCamera(ax: number, ay: number, z: number): void }

export class StageCamera {
  private on = false;
  private base = '';
  private saved: Record<string, string> | null = null;

  /** `el` null = no DOM camera (reduced motion, tests): the mirror still moves. */
  constructor(private readonly el: HTMLElement | null, private readonly mirror: CameraMirror | null) {}

  get active(): boolean { return this.on; }

  start(): void {
    const camera = this.el;
    if (!camera || this.on || typeof document === 'undefined') return;
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
    if (this.on || !this.el) this.mirror?.setCamera(ax, ay, zoom);
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
