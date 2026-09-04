/**
 * FRAME RATE CAP (owner ask 2026-09-04: "a setting for 60, 120, 144, 240 and 360").
 *
 * The game animates on three clocks: the Pixi effects ticker (every canvas renders from the MAIN controller's
 * ticker), GSAP (lunges, fly-ins, drag glide) and CSS transitions/animations. The first two have a built-in
 * max-fps; CSS runs at the display's refresh regardless (it is the cheap part). So a cap here throttles the
 * two expensive clocks: on a 144 Hz display, capping at 60 cuts their per-frame work by more than half.
 *
 * A cap can only LOWER the rate: the window is vsynced to the monitor, so an option above the display's
 * refresh does nothing (the Settings row says so next to the option). `0` = "Display", i.e. uncapped —
 * Pixi's `maxFPS = 0` and GSAP's own default (`fps(0)` → its built-in 240 ceiling).
 */
import gsap from 'gsap';
import { pixiFx, discoverFx } from './pixiFx';

/** 0 = the display's refresh (no cap). */
export const FPS_CAP_OPTIONS: readonly number[] = [0, 60, 120, 144, 240, 360];
const KEY = 'ascent.fpscap';

export function loadFpsCap(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return FPS_CAP_OPTIONS.includes(v) ? v : 0;
  } catch { return 0; }
}

export function saveFpsCap(cap: number): void {
  try { localStorage.setItem(KEY, String(cap)); } catch { /* ignore */ }
}

/** Push the cap onto every animation clock. Idempotent; safe before the FX canvases exist (the controller
 *  remembers it and applies it when its ticker comes up). */
export function applyFpsCap(cap: number): void {
  const n = FPS_CAP_OPTIONS.includes(cap) ? cap : 0;
  pixiFx.setMaxFps(n);
  discoverFx.setMaxFps(n);
  gsap.ticker.fps(n); // 0 → GSAP's default ceiling
}

/** Option label for the Settings row. */
export function fpsCapLabel(cap: number, displayHz?: number): string {
  if (cap === 0) return displayHz && displayHz > 0 ? `Display (${Math.round(displayHz)})` : 'Display';
  return String(cap);
}
