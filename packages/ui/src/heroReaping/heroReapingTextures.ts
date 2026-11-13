/**
 * The Reaping's textures, painted ONCE per session on 2D canvases and kept (seven small canvases on top of the shared
 * Blast set it reuses for soft glows, rings and streaks).
 *
 *  - The BLADE is a long thin crescent of light pointing along +x, its cutting (inner) edge toward +y: a teal halo, a
 *    teal body paling toward the edge, and a bone-white cutting edge. Drawn untinted and additive, so it reads as light.
 *    The same texture tinted black is its soft shade underneath (so it still reads over a bright board).
 *  - The LINE is a white strip profile (a hot core, a soft falloff, soft ends) that IV stretches across the screen.
 *  - The SNATH is the scythe's dark handle, a teal rim of light along its top.
 *  - The SHADOW is a tall hooded figure: an empty cowl, sloping shoulders, a robe that fades to nothing at its foot.
 *    No face, no hands: only a thin teal rim on the cowl and one shoulder.
 *  - The CANDLE is a bone-white stub with a dark wick; the FLAME is a small warm teardrop (its foot at the bottom).
 *  - The MOTE is a white fleck (a hot centre, a short soft halo) that the scene tints with the warm hues.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroBlastTextures } from '../heroBlast/heroBlastTextures';
import type { HeroReapingTextures } from './heroReapingScene';

/** Texture sizes the scene scales by. */
export const BLADE_TEX_W = 512;
export const BLADE_TEX_H = 128;
/** Where the blade's heel and point sit along the texture (0..1). */
export const BLADE_HEEL_U = 40 / 512;
export const BLADE_POINT_U = 500 / 512;
export const LINE_TEX_W = 256;
export const LINE_TEX_H = 32;
export const SNATH_TEX_W = 256;
export const SNATH_TEX_H = 16;
export const SHADOW_TEX_W = 256;
export const SHADOW_TEX_H = 416;
export const CANDLE_TEX_W = 48;
export const CANDLE_TEX_H = 96;
export const FLAME_TEX_W = 48;
export const FLAME_TEX_H = 80;
export const MOTE_TEX = 32;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** The crescent: heel at the left, point at the right, the spine bowed up, the cutting edge the shallower inner curve. */
function bladePath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(40, 70);
  g.quadraticCurveTo(250, -6, 500, 62); // the spine
  g.quadraticCurveTo(270, 44, 40, 70); // the cutting edge
  g.closePath();
}

function paintBlade(): HTMLCanvasElement | null {
  const k = canvas(BLADE_TEX_W, BLADE_TEX_H); if (!k) return null;
  const g = k.g;
  // The halo: two soft passes of teal.
  g.shadowColor = 'rgba(47,224,188,0.9)'; g.shadowBlur = 22;
  bladePath(g); g.fillStyle = 'rgba(47,224,188,0.55)'; g.fill();
  g.shadowBlur = 9;
  bladePath(g);
  // The body: deep teal at the spine, paling to bone at the cutting edge.
  const body = g.createLinearGradient(0, 14, 0, 70);
  body.addColorStop(0, '#0f7f6c'); body.addColorStop(0.55, '#2fe0bc'); body.addColorStop(1, '#eafff8');
  g.fillStyle = body; g.fill();
  g.shadowBlur = 0;
  // The cutting edge: a bone-white hairline that thins to the point.
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,250,0.95)'; g.lineWidth = 3.2;
  g.beginPath(); g.moveTo(52, 69); g.quadraticCurveTo(270, 45, 492, 62.5); g.stroke();
  // A darker line under the spine gives the crescent a second plane.
  g.strokeStyle = 'rgba(6,60,52,0.55)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(70, 61); g.quadraticCurveTo(255, 6, 470, 56); g.stroke();
  // The point: a small white-hot glint.
  const pt = g.createRadialGradient(494, 62, 0, 494, 62, 16);
  pt.addColorStop(0, 'rgba(255,255,255,1)'); pt.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = pt; g.fillRect(474, 42, 38, 40);
  return k.c;
}

/** A strip of light: a hot core and a soft falloff across it, soft ends along it. */
function paintLine(): HTMLCanvasElement | null {
  const k = canvas(LINE_TEX_W, LINE_TEX_H); if (!k) return null;
  const g = k.g;
  const v = g.createLinearGradient(0, 0, 0, LINE_TEX_H);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.3, 'rgba(255,255,255,0.14)'); v.addColorStop(0.44, 'rgba(255,255,255,0.6)');
  v.addColorStop(0.5, 'rgba(255,255,255,1)'); v.addColorStop(0.56, 'rgba(255,255,255,0.6)'); v.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v; g.fillRect(0, 0, LINE_TEX_W, LINE_TEX_H);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, LINE_TEX_W, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.06, 'rgba(0,0,0,1)'); h.addColorStop(0.97, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h; g.fillRect(0, 0, LINE_TEX_W, LINE_TEX_H);
  return k.c;
}

/** The snath: a slim dark handle (a touch thicker at the hands), a teal rim of light along the top. */
function paintSnath(): HTMLCanvasElement | null {
  const k = canvas(SNATH_TEX_W, SNATH_TEX_H); if (!k) return null;
  const g = k.g;
  const cy = SNATH_TEX_H / 2;
  g.beginPath();
  g.moveTo(2, cy - 3.6); g.lineTo(SNATH_TEX_W - 3, cy - 2.4); g.lineTo(SNATH_TEX_W - 3, cy + 2.4); g.lineTo(2, cy + 3.6);
  g.closePath();
  const body = g.createLinearGradient(0, cy - 4, 0, cy + 4);
  body.addColorStop(0, '#1b2a2a'); body.addColorStop(0.5, '#0a0f10'); body.addColorStop(1, '#030405');
  g.fillStyle = body; g.fill();
  g.strokeStyle = 'rgba(47,224,188,0.7)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(3, cy - 3.4); g.lineTo(SNATH_TEX_W - 4, cy - 2.2); g.stroke();
  return k.c;
}

/** The hooded shadow: a cowl with an empty opening, shoulders, a robe fading out at the foot. Faces +x by its rim light. */
function paintShadow(): HTMLCanvasElement | null {
  const k = canvas(SHADOW_TEX_W, SHADOW_TEX_H); if (!k) return null;
  const g = k.g;
  const W = SHADOW_TEX_W, H = SHADOW_TEX_H, cx = W / 2;
  const figure = (): void => {
    g.beginPath();
    g.moveTo(cx + 4, 8); // the cowl's peak, leaning a touch
    g.bezierCurveTo(cx + 46, 22, cx + 54, 78, cx + 44, 112); // the cowl's right side
    g.bezierCurveTo(cx + 78, 124, cx + 100, 150, cx + 104, 196); // the right shoulder
    g.bezierCurveTo(cx + 108, 280, cx + 116, 350, cx + 124, H); // the robe's right edge
    g.lineTo(cx - 124, H);
    g.bezierCurveTo(cx - 116, 350, cx - 108, 280, cx - 104, 196);
    g.bezierCurveTo(cx - 100, 150, cx - 78, 124, cx - 44, 112);
    g.bezierCurveTo(cx - 56, 76, cx - 44, 22, cx + 4, 8);
    g.closePath();
  };
  g.shadowColor = 'rgba(2,4,6,0.9)'; g.shadowBlur = 14;
  figure();
  const body = g.createLinearGradient(0, 0, 0, H);
  body.addColorStop(0, '#0b1012'); body.addColorStop(0.4, '#05070a'); body.addColorStop(1, '#020304');
  g.fillStyle = body; g.fill();
  g.shadowBlur = 0;
  // Two long folds in the robe (a hair lighter), so it is cloth and not a cut-out.
  g.strokeStyle = 'rgba(40,62,62,0.5)'; g.lineWidth = 2; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - 30, 150); g.bezierCurveTo(cx - 40, 230, cx - 52, 300, cx - 60, 380); g.stroke();
  g.beginPath(); g.moveTo(cx + 34, 160); g.bezierCurveTo(cx + 42, 240, cx + 50, 310, cx + 64, 384); g.stroke();
  // The cowl's opening: an empty, deeper dark. No face.
  g.beginPath(); g.ellipse(cx + 3, 76, 25, 34, 0.04, 0, Math.PI * 2);
  const hollow = g.createRadialGradient(cx + 3, 80, 2, cx + 3, 76, 34);
  hollow.addColorStop(0, '#000000'); hollow.addColorStop(1, '#030506');
  g.fillStyle = hollow; g.fill();
  // The rim of the opening, and a rim of teal light down one side of the cowl and shoulder.
  g.strokeStyle = 'rgba(47,224,188,0.42)'; g.lineWidth = 1.6;
  g.beginPath(); g.ellipse(cx + 3, 76, 25, 34, 0.04, -Math.PI * 0.62, Math.PI * 0.22); g.stroke();
  g.strokeStyle = 'rgba(47,224,188,0.6)'; g.lineWidth = 2;
  g.beginPath();
  g.moveTo(cx + 6, 9);
  g.bezierCurveTo(cx + 46, 22, cx + 54, 78, cx + 44, 112);
  g.bezierCurveTo(cx + 78, 124, cx + 100, 150, cx + 104, 196);
  g.stroke();
  // Fade the whole figure out toward its foot: it stands in nothing.
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.5, 'rgba(0,0,0,0.96)'); fade.addColorStop(0.82, 'rgba(0,0,0,0.5)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade; g.fillRect(0, 0, W, H);
  return k.c;
}

/** A short bone-white candle: shaded round, a pooled lip, one drip, a dark wick. */
function paintCandle(): HTMLCanvasElement | null {
  const k = canvas(CANDLE_TEX_W, CANDLE_TEX_H); if (!k) return null;
  const g = k.g;
  const W = CANDLE_TEX_W, H = CANDLE_TEX_H;
  const body = g.createLinearGradient(8, 0, W - 8, 0);
  body.addColorStop(0, '#8f8a7c'); body.addColorStop(0.35, '#efe9dc'); body.addColorStop(0.7, '#d8d1c0'); body.addColorStop(1, '#77725f');
  g.fillStyle = body;
  g.beginPath(); g.roundRect(10, 18, W - 20, H - 22, 4); g.fill();
  // The lip of melted wax, and a drip down the lit side.
  g.fillStyle = '#f7f3e8';
  g.beginPath(); g.ellipse(W / 2, 19, (W - 18) / 2, 4.5, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.roundRect(15, 18, 5, 26, 2.5); g.fill();
  g.fillStyle = 'rgba(60,56,46,0.5)';
  g.beginPath(); g.ellipse(W / 2, H - 5, (W - 14) / 2, 3.5, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1a1612'; g.lineWidth = 2; g.lineCap = 'round';
  g.beginPath(); g.moveTo(W / 2, 18); g.lineTo(W / 2 + 1, 9); g.stroke();
  return k.c;
}

/** A candle flame: an amber teardrop, a cream heart, a cool foot. Its foot is at the bottom centre. */
function paintFlame(): HTMLCanvasElement | null {
  const k = canvas(FLAME_TEX_W, FLAME_TEX_H); if (!k) return null;
  const g = k.g;
  const W = FLAME_TEX_W, H = FLAME_TEX_H, cx = W / 2;
  const drop = (w: number, top: number): void => {
    g.beginPath();
    g.moveTo(cx, top);
    g.bezierCurveTo(cx + w * 0.5, top + (H - top) * 0.45, cx + w, H - 20, cx, H - 4);
    g.bezierCurveTo(cx - w, H - 20, cx - w * 0.5, top + (H - top) * 0.45, cx, top);
    g.closePath();
  };
  g.shadowColor = 'rgba(255,170,60,0.9)'; g.shadowBlur = 10;
  drop(13, 12);
  const outer = g.createLinearGradient(0, 10, 0, H);
  outer.addColorStop(0, '#ffd27a'); outer.addColorStop(0.6, '#ff9a2e'); outer.addColorStop(1, '#c2531a');
  g.fillStyle = outer; g.fill();
  g.shadowBlur = 0;
  drop(7, 30);
  const inner = g.createLinearGradient(0, 30, 0, H);
  inner.addColorStop(0, '#fff6d8'); inner.addColorStop(1, '#ffe08a');
  g.fillStyle = inner; g.fill();
  const foot = g.createRadialGradient(cx, H - 8, 0, cx, H - 8, 9);
  foot.addColorStop(0, 'rgba(120,180,255,0.85)'); foot.addColorStop(1, 'rgba(120,180,255,0)');
  g.fillStyle = foot; g.fillRect(cx - 10, H - 18, 20, 18);
  return k.c;
}

/** A fleck of colour: a hot centre and a short halo (white; the scene tints it). */
function paintMote(): HTMLCanvasElement | null {
  const k = canvas(MOTE_TEX, MOTE_TEX); if (!k) return null;
  const g = k.g;
  const c = MOTE_TEX / 2;
  const r = g.createRadialGradient(c, c, 0, c, c, c);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.22, 'rgba(255,255,255,0.95)'); r.addColorStop(0.42, 'rgba(255,255,255,0.4)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, MOTE_TEX, MOTE_TEX);
  return k.c;
}

let cached: HeroReapingTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroReapingTextures(): HeroReapingTextures | null {
  if (cached) return cached;
  const base = heroBlastTextures();
  const blade = paintBlade(), line = paintLine(), snath = paintSnath(), shadow = paintShadow(), candle = paintCandle(), flame = paintFlame(), mote = paintMote();
  if (!base || !blade || !line || !snath || !shadow || !candle || !flame || !mote) return null;
  cached = { ...base, blade: tex(blade), line: tex(line), snath: tex(snath), shadow: tex(shadow), candle: tex(candle), flame: tex(flame), mote: tex(mote) };
  return cached;
}
