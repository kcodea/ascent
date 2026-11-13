/**
 * The Reaping's textures, painted ONCE per session on 2D canvases and kept (four small canvases on top of the shared
 * Blast set it reuses for soft glows, rings, sparks and streaks). Light only: no drawn props (the second pass removed
 * the hooded shadow, its snath and the candle).
 *
 *  - The BLADE is a long thin crescent of light pointing along +x, its cutting (inner) edge toward +y: a teal halo, a
 *    teal body paling toward the edge, and a bone-white cutting edge. Drawn untinted and additive, so it reads as light.
 *    The same texture tinted black is its soft shade underneath (so it still reads over a bright board).
 *  - The CRESCENT is III and IV's great blade: a WIDE crescent of light, heel at the left, point at the right, the
 *    spine bowed toward -y and the white-hot cutting edge toward +y (the side that leads the sweep). Same palette as
 *    the blade, several times its weight. Tinted teal it is its own afterimage; tinted black, its shade.
 *  - The LINE is a white strip profile (a hot core, a soft falloff, soft ends): the hairline along a cut, the line IV's
 *    cut leaves across the screen, and the bright front of the colour flooding back.
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
export const CRESCENT_TEX_W = 512;
export const CRESCENT_TEX_H = 176;
/** The crescent's heel and point along the texture (0..1), and where the heel-to-point chord sits down it (0..1). */
export const CRESCENT_HEEL_U = 24 / 512;
export const CRESCENT_POINT_U = 492 / 512;
export const CRESCENT_CHORD_V = 124 / 176;
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

/** The great crescent's outline: heel at the left, point at the right, a deep spine, a shallower cutting edge. */
function crescentPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(24, 128);
  g.quadraticCurveTo(250, -44, 492, 120); // the spine
  g.quadraticCurveTo(262, 92, 24, 128); // the cutting edge
  g.closePath();
}

function paintCrescent(): HTMLCanvasElement | null {
  const k = canvas(CRESCENT_TEX_W, CRESCENT_TEX_H); if (!k) return null;
  const g = k.g;
  // The halo: a wide soft pass of teal, then a tighter one.
  g.shadowColor = 'rgba(47,224,188,0.95)'; g.shadowBlur = 30;
  crescentPath(g); g.fillStyle = 'rgba(47,224,188,0.6)'; g.fill();
  g.shadowBlur = 12;
  crescentPath(g);
  // The body: deep teal at the spine, bright teal through the middle, bone white toward the cutting edge.
  const body = g.createLinearGradient(0, 34, 0, 118);
  body.addColorStop(0, '#0c6f5f'); body.addColorStop(0.45, '#2fe0bc'); body.addColorStop(0.8, '#b9fff0'); body.addColorStop(1, '#ffffff');
  g.fillStyle = body; g.fill();
  g.shadowBlur = 0;
  // Light running along the blade inside the body (two soft arcs), so it is a sheet of light and not a flat shape.
  g.save();
  crescentPath(g); g.clip();
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(234,255,248,0.34)'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(60, 112); g.quadraticCurveTo(256, 30, 460, 108); g.stroke();
  g.strokeStyle = 'rgba(6,60,52,0.5)'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(54, 104); g.quadraticCurveTo(252, -14, 468, 100); g.stroke();
  g.restore();
  // The cutting edge: a white-hot line that thins to the point, inside a tight glow.
  g.lineCap = 'round';
  g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 8;
  g.strokeStyle = 'rgba(255,255,252,1)'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(40, 126.5); g.quadraticCurveTo(262, 93, 480, 120); g.stroke();
  g.shadowBlur = 0;
  // The point: a white-hot glint.
  const pt = g.createRadialGradient(488, 120, 0, 488, 120, 22);
  pt.addColorStop(0, 'rgba(255,255,255,1)'); pt.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = pt; g.fillRect(462, 96, 50, 48);
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
  const blade = paintBlade(), crescent = paintCrescent(), line = paintLine(), mote = paintMote();
  if (!base || !blade || !crescent || !line || !mote) return null;
  cached = { ...base, blade: tex(blade), crescent: tex(crescent), line: tex(line), mote: tex(mote) };
  return cached;
}
