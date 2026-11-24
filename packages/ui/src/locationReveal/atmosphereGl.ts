/**
 * HERO SELECT'S LIVING GROUND (owner 2026-11-24: "make it so that during the hero select those atmospheric effects continue
 * so it still feels like the player is really at this location ... keep some very slight movement"; R-LOCATION-04).
 * The same blurred painting hero select already stood on, drawn by one small WebGL 2 canvas: its mist drifts, its leaves
 * and cloth sway, its water runs, its lanterns and crystals flicker, motes float through it, and the whole place leans a
 * few pixels with its own depth. Built while the gate is shut, so it is already moving behind the leaving wave.
 *
 * CHEAP ON PURPOSE: three small pictures (the blur, the depth map and the water map), one full-screen pass and one
 * additive batch of points, at ATMO_ROWS rows whatever the window (it is a blurred ground, so that is all it can show).
 * Phones, reduced motion and machines without WebGL 2 keep the still picture underneath (`.hs-location`).
 */
import { dropRipple, warmRipple } from './heroRipple';
import type { LocationDef } from './locations';
import { Place } from './placeGl';
import { canRun } from './rippleSupport';

export { LEAN, leanAt, syncAtmosphere } from './placeGl';

export const ATMO_ROWS = 540;

/** True while the reveal's own picture covers the screen: nothing behind it needs drawing. */
let covered = false;
export function setAtmosphereCovered(v: boolean): void { covered = v; }

class AtmosphereGl {
  readonly canvas = document.createElement('canvas');
  private gl: WebGL2RenderingContext;
  private place: Place;
  private raf = 0;
  private born = 0;
  dead = false;

  constructor(readonly loc: LocationDef) {
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no WebGL 2');
    this.gl = gl;
    this.place = new Place(gl, loc);
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.destroy(); });
  }

  build(): Promise<boolean> { return this.place.build(() => this.dead); }

  /** The window's size (layout px). */
  resize(w: number, h: number): void {
    if (!w || !h || this.dead) return;
    this.place.frame(w, h);
    const H = Math.min(ATMO_ROWS, Math.round(h));
    const W = Math.round((H * w) / h);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
  }

  start(): void {
    this.born = performance.now();
    const tick = (): void => {
      if (this.dead) return;
      this.raf = requestAnimationFrame(tick);
      if (!covered) this.place.draw(this.canvas.width, this.canvas.height, Math.min(1, (performance.now() - this.born) / 500));
    };
    this.raf = requestAnimationFrame(tick);
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    try { this.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* already gone */ }
    this.canvas.remove();
  }
}

interface Warm { gl: AtmosphereGl; ready: Promise<AtmosphereGl | null> }
let warm: Warm | null = null;
let onScreen: AtmosphereGl | null = null;

function make(loc: LocationDef): Warm | null {
  if (!canRun()) return null;
  try {
    const gl = new AtmosphereGl(loc);
    const ready = gl.build().then((ok) => (ok && !gl.dead ? gl : null)).catch((err) => { console.warn('[atmosphere] the still picture stays', err); gl.destroy(); return null; });
    return { gl, ready };
  } catch {
    return null;
  }
}

/** Make it ready while the gate is shut (idempotent; nothing to do when hero select, behind the gate, already has it). */
export function warmAtmosphere(loc: LocationDef): void {
  if (onScreen && !onScreen.dead) return;
  if (warm && !warm.gl.dead && warm.gl.loc.id === loc.id) return;
  dropAtmosphere();
  warm = make(loc);
}

/** Let go of one that was made ready and never shown. */
export function dropAtmosphere(): void {
  warm?.gl.destroy();
  warm = null;
}

/** Show it in `host` (hero select's ground). Returns the way to take it down. Only one is ever on screen: a teammate's hero
 *  select over mine keeps the still picture. */
export function mountAtmosphere(host: HTMLElement, loc: LocationDef): () => void {
  if (onScreen && !onScreen.dead) return () => undefined;
  if (!warm || warm.gl.dead || warm.gl.loc.id !== loc.id) { dropAtmosphere(); warm = make(loc); }
  const mine = warm;
  warm = null;
  if (!mine) return () => undefined;
  onScreen = mine.gl;
  let warming = 0;
  const size = (): void => mine.gl.resize(host.clientWidth, host.clientHeight);
  void mine.ready.then((gl) => {
    if (!gl || gl.dead) return;
    size();
    gl.canvas.className = 'hs-atmo';
    host.appendChild(gl.canvas);
    window.addEventListener('resize', size);
    gl.start();
    // Once it is up and running, the pick's ripple is made ready behind it (a step a frame).
    const later = (): void => { warming = window.setTimeout(() => { if (covered) later(); else warmRipple(loc); }, 900); };
    later();
  });
  return () => {
    window.removeEventListener('resize', size);
    window.clearTimeout(warming);
    dropRipple();
    mine.gl.destroy();
    if (onScreen === mine.gl) onScreen = null;
  };
}
