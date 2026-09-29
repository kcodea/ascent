/**
 * The Banana Barrage's textures. The STARS are King Oona's own PAINTED sprite sheets (owner 2026-09-29: "use oona's
 * animation as a guideline"), the same art her card FX (`fx/defs/oona-banana.json`) plays:
 *  - `defs/images/banana.png`: a 4 x 4 sheet (1024 px) of a glossy painted banana tumbling through 16 frames. Every
 *    projectile loops it (Oona plays it at ~41 fps with a random direction), and the Tier IV giant is the same banana,
 *    huge and gilded.
 *  - `defs/images/chatgpt-image-sep-25-2026-09-40-24-am.png`: a 4 x 4 sheet of a juicy yellow splat bursting open and
 *    dissipating. Every impact plays it once through.
 * Both are decoded by the FX image library (`fx/imageLibrary.ts`, the loader Oona's def uses; SHARED textures, never
 * destroyed here) and sliced into frames once. The decode is kicked the moment an attack starts, during the damage
 * formation (a 1 MB PNG decodes in tens of ms, the formation lasts well over a second), and the scene uploads each
 * sheet to the GPU with a near-invisible warm sprite before the first banana flies.
 *
 * Until a sheet is decoded (the very first frames of a session, and headless tests) the frame lists hold a small
 * canvas-painted stand-in; the lists are swapped IN PLACE when the paintings land, so a scene that is already running
 * picks them up on its next banana.
 *
 * The rest is the Blast / Arcana set (glow, spark, streak, ring, star) plus a soft disc and a thick shockwave ring.
 */
import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { getImageTexture } from '../fx/imageLibrary';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroBananaTextures } from './heroBananaScene';

/** Oona's painted sheets (the `image:` ids her card FX uses). */
export const BANANA_SHEET_ID = 'image:banana';
export const SPLAT_SHEET_ID = 'image:chatgpt-image-sep-25-2026-09-40-24-am';
/** Both sheets are 4 x 4. */
export const SHEET_COLS = 4;
export const SHEET_ROWS = 4;
/** The splat's playable frames (the first and last cells are empty). */
export const SPLAT_FIRST = 1;
export const SPLAT_LAST = 14;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** Slice a decoded sheet into its cells, row by row. */
export function sliceSheet(sheet: Texture, cols = SHEET_COLS, rows = SHEET_ROWS): Texture[] {
  const w = Math.floor(sheet.width / cols), h = Math.floor(sheet.height / rows);
  const out: Texture[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(new Texture({ source: sheet.source, frame: new Rectangle(c * w, r * h, w, h) }));
  return out;
}

/** The stand-in banana until the painting is decoded: a plain yellow crescent (never meant to be seen for long). */
function paintFallbackBanana(): HTMLCanvasElement | null {
  const k = canvas(128, 128); if (!k) return null;
  const g = k.g;
  g.fillStyle = '#f6cf2a';
  g.beginPath(); g.moveTo(20, 50); g.quadraticCurveTo(64, 120, 110, 44); g.quadraticCurveTo(64, 80, 20, 50); g.closePath(); g.fill();
  g.fillStyle = '#5b3a17';
  g.beginPath(); g.arc(110, 44, 4, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** The stand-in splat: a soft yellow burst. */
function paintFallbackSplat(): HTMLCanvasElement | null {
  const k = canvas(128, 128); if (!k) return null;
  const g = k.g;
  const gr = g.createRadialGradient(64, 64, 4, 64, 64, 60);
  gr.addColorStop(0, 'rgba(255,240,120,1)'); gr.addColorStop(0.6, 'rgba(252,214,20,0.9)'); gr.addColorStop(1, 'rgba(252,214,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return k.c;
}

/** A soft-edged solid disc (the flat shadow under the falling giant). */
function paintDisc(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const c = D / 2;
  const gr = k.g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, D, D);
  return k.c;
}

/** A THICK shockwave ring: clear inside, a dense band at 0.8 of the radius, a soft falloff outside. */
function paintShock(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const c = D / 2;
  const gr = k.g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,0)');
  gr.addColorStop(0.77, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.84, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, D, D);
  return k.c;
}

let cached: HeroBananaTextures | null = null;
let paintedBanana = false;
let paintedSplat = false;

/** Kick the decode of Oona's two sheets (idempotent; the FX library de-duplicates). Call as early as possible. */
export function preloadBananaSheets(): void {
  try { getImageTexture(BANANA_SHEET_ID); getImageTexture(SPLAT_SHEET_ID); } catch { /* no DOM here */ }
}

/** Swap the painted frames in (in place) the moment the sheets are decoded. */
function upgrade(t: HeroBananaTextures): void {
  if (!paintedBanana) {
    const sheet = getImageTexture(BANANA_SHEET_ID);
    if (sheet && sheet.width > 0) { t.banana.length = 0; t.banana.push(...sliceSheet(sheet)); paintedBanana = true; }
  }
  if (!paintedSplat) {
    const sheet = getImageTexture(SPLAT_SHEET_ID);
    if (sheet && sheet.width > 0) { t.splat.length = 0; t.splat.push(...sliceSheet(sheet).slice(SPLAT_FIRST, SPLAT_LAST + 1)); paintedSplat = true; }
  }
}

/** Whether both painted sheets are in (for tests and the capture rig). */
export function bananaSheetsReady(): boolean { return paintedBanana && paintedSplat; }

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroBananaTextures(): HeroBananaTextures | null {
  preloadBananaSheets();
  if (cached) { upgrade(cached); return cached; }
  const base = heroArcanaTextures();
  const fb = paintFallbackBanana(), fs = paintFallbackSplat(), disc = paintDisc(128), shock = paintShock(256);
  if (!base || !fb || !fs || !disc || !shock) return null;
  cached = { ...base, banana: [tex(fb)], splat: [tex(fs)], disc: tex(disc), shock: tex(shock) };
  upgrade(cached);
  return cached;
}

/** Pick up the painted sheets if they have landed since the textures were built (the runner calls it per beat). */
export function refreshBananaSheets(): void { if (cached) upgrade(cached); }
