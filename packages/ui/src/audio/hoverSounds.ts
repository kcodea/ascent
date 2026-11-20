/**
 * HOVER SOUNDS (Settings > Audio, R-SETTINGS-HOVERSFX-01, 2026-11-20): the soft tick a button plays when the mouse moves
 * onto it (Game.tsx's one `pointerover` listener). On by default; off silences only the hover tick (clicks, cards and
 * combat keep their sounds). Read on each hover from a module variable, so the listener costs nothing extra. Saved on
 * this device (localStorage, try/catch).
 */
const KEY = 'ascent.hoverSounds';

let on: boolean | null = null;

export function hoverSoundsOn(): boolean {
  if (on === null) {
    try { on = localStorage.getItem(KEY) !== 'off'; } catch { on = true; }
  }
  return on;
}

export function setHoverSoundsOn(v: boolean): void {
  on = v;
  try { if (v) localStorage.removeItem(KEY); else localStorage.setItem(KEY, 'off'); } catch { /* lasts this session */ }
}
