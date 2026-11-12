/**
 * Look Out Below's textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast / Arcana set
 * it reuses for rings, stars and sparks). Flat 2D with a hand-shaded finish, drawn in their own colours (the sprites
 * are not tinted, except the dust and the shadow):
 *  - ANVIL: the classic side silhouette (horn, flat face, heel, waist, flared foot with its arch) in black iron, lit
 *    from the top left: a bright worn face, a rim light down the horn, a cold sheen on the body.
 *  - PIANO: an upright seen from the front: a lid, a panelled case with a music desk, the keyboard shelf with its
 *    white and black keys, a lower panel, feet and two brass pedals.
 *  - KEY (white, black): one loose piano key each.
 *  - PUFF: a lumpy soft cloud of dust (white, tinted by the sprite).
 *  - SHADOW: a soft dark disc (white alpha, tinted by the sprite).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroAnvilTextures } from './heroAnvilScene';

/** Texture sizes (the scene scales by them). `*_BASE` is where the object's foot sits, as a fraction of the height. */
export const ANVIL_W = 256;
export const ANVIL_H = 176;
export const ANVIL_BASE = 166 / ANVIL_H;
/** The anvil's foot is not under the middle of the picture (the horn sticks out): its centre, as a fraction of the width. */
export const ANVIL_FOOT_X = 140 / ANVIL_W;
export const PIANO_W = 288;
export const PIANO_H = 272;
export const PIANO_BASE = 264 / PIANO_H;
export const KEY_W = 16;
export const KEY_H = 46;
export const PUFF_PX = 96;
export const SHADOW_PX = 128;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** The anvil's outline: horn to the left, the flat face along the top, the heel to the right, waist and flared foot. */
function anvilPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(8, 50);
  g.quadraticCurveTo(56, 32, 100, 32);
  g.lineTo(238, 32);
  g.quadraticCurveTo(244, 32, 244, 38);
  g.lineTo(244, 62);
  g.quadraticCurveTo(216, 68, 194, 80);
  g.quadraticCurveTo(172, 94, 172, 112);
  g.quadraticCurveTo(178, 132, 218, 142);
  g.lineTo(218, 166);
  g.lineTo(166, 166);
  g.quadraticCurveTo(140, 146, 114, 166); // the arch cut into the foot
  g.lineTo(62, 166);
  g.lineTo(62, 142);
  g.quadraticCurveTo(104, 132, 112, 112);
  g.quadraticCurveTo(114, 94, 96, 84);
  g.quadraticCurveTo(48, 76, 8, 54);
  g.closePath();
}

function paintAnvil(): HTMLCanvasElement | null {
  const k = canvas(ANVIL_W, ANVIL_H); if (!k) return null;
  const g = k.g;
  g.lineJoin = 'round';
  // The iron: a cold blue-black, lighter toward the top.
  const body = g.createLinearGradient(0, 30, 0, 168);
  body.addColorStop(0, '#565d6b'); body.addColorStop(0.28, '#33373f'); body.addColorStop(0.7, '#1c1e24'); body.addColorStop(1, '#0d0e12');
  anvilPath(g); g.fillStyle = body; g.fill();
  g.save();
  anvilPath(g); g.clip();
  // Shade the right and the underside (the light is top left).
  const side = g.createLinearGradient(40, 0, 250, 0);
  side.addColorStop(0, 'rgba(0,0,0,0)'); side.addColorStop(0.55, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = side; g.fillRect(0, 0, ANVIL_W, ANVIL_H);
  // The worn working face: a bright steel band along the top, with a hard lower edge.
  const face = g.createLinearGradient(0, 32, 0, 46);
  face.addColorStop(0, '#e9eef6'); face.addColorStop(0.5, '#aab3c2'); face.addColorStop(1, '#6d7584');
  g.fillStyle = face; g.fillRect(96, 30, 152, 13);
  g.fillStyle = 'rgba(10,11,14,0.55)'; g.fillRect(96, 43, 152, 2.5);
  // The horn's rim light, fading to its tip.
  const horn = g.createLinearGradient(8, 0, 100, 0);
  horn.addColorStop(0, 'rgba(210,220,235,0.2)'); horn.addColorStop(1, 'rgba(225,232,244,0.95)');
  g.strokeStyle = horn; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(14, 51); g.quadraticCurveTo(58, 36, 100, 36); g.stroke();
  // A cold sheen down the body and the waist.
  const sheen = g.createLinearGradient(100, 0, 150, 0);
  sheen.addColorStop(0, 'rgba(150,165,190,0)'); sheen.addColorStop(0.5, 'rgba(150,165,190,0.42)'); sheen.addColorStop(1, 'rgba(150,165,190,0)');
  g.fillStyle = sheen; g.fillRect(100, 46, 50, 122);
  // The heel's step and the foot's top edge catch a thin line of light.
  g.strokeStyle = 'rgba(170,182,204,0.6)'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(66, 144); g.quadraticCurveTo(104, 135, 113, 120); g.stroke();
  g.strokeStyle = 'rgba(120,130,150,0.4)';
  g.beginPath(); g.moveTo(214, 144); g.quadraticCurveTo(180, 134, 174, 118); g.stroke();
  // The hardy hole's shadow on the face, and a dent of use.
  g.fillStyle = 'rgba(15,16,20,0.75)'; g.fillRect(214, 33, 12, 5);
  g.restore();
  // A crisp dark outline so the silhouette holds on any board.
  anvilPath(g); g.strokeStyle = '#06070a'; g.lineWidth = 4; g.stroke();
  return k.c;
}

function paintPiano(): HTMLCanvasElement | null {
  const W = PIANO_W, H = PIANO_H;
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  g.lineJoin = 'round';
  const OUT = '#1c0e06';
  const wood = (y0: number, y1: number, a: string, b: string): CanvasGradient => { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
  // The feet.
  g.fillStyle = '#3a2010'; g.strokeStyle = OUT; g.lineWidth = 4;
  rr(g, 22, 240, 34, 24, 5); g.fill(); g.stroke();
  rr(g, W - 56, 240, 34, 24, 5); g.fill(); g.stroke();
  // The case.
  rr(g, 28, 22, W - 56, 230, 8); g.fillStyle = wood(22, 252, '#8f5a30', '#532d14'); g.fill(); g.stroke();
  // A soft light down the left of the case.
  g.save(); rr(g, 28, 22, W - 56, 230, 8); g.clip();
  const lit = g.createLinearGradient(28, 0, W - 28, 0);
  lit.addColorStop(0, 'rgba(255,214,160,0.3)'); lit.addColorStop(0.3, 'rgba(255,214,160,0)'); lit.addColorStop(0.75, 'rgba(0,0,0,0)'); lit.addColorStop(1, 'rgba(0,0,0,0.32)');
  g.fillStyle = lit; g.fillRect(28, 22, W - 56, 230);
  g.restore();
  // The upper panel, inset, with the music desk.
  rr(g, 48, 46, W - 96, 86, 5); g.fillStyle = wood(46, 132, '#6b3f1f', '#7d4c27'); g.fill(); g.strokeStyle = '#2c160a'; g.lineWidth = 3; g.stroke();
  g.strokeStyle = 'rgba(255,205,150,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(52, 129); g.lineTo(W - 52, 129); g.stroke();
  rr(g, 92, 84, W - 184, 40, 3); g.fillStyle = wood(84, 124, '#9c6535', '#7a4a25'); g.fill(); g.strokeStyle = '#2c160a'; g.lineWidth = 2.5; g.stroke();
  // The lower panel.
  rr(g, 48, 184, W - 96, 56, 5); g.fillStyle = wood(184, 240, '#6b3f1f', '#5a3319'); g.fill(); g.strokeStyle = '#2c160a'; g.lineWidth = 3; g.stroke();
  // The pedals.
  g.fillStyle = '#e2b84e'; g.strokeStyle = '#5a4210'; g.lineWidth = 2;
  rr(g, W / 2 - 22, 244, 14, 12, 4); g.fill(); g.stroke();
  rr(g, W / 2 + 8, 244, 14, 12, 4); g.fill(); g.stroke();
  // The lid, wider than the case, with a bright top edge.
  rr(g, 18, 12, W - 36, 20, 6); g.fillStyle = wood(12, 32, '#a66c3a', '#6a3c1c'); g.fill(); g.strokeStyle = OUT; g.lineWidth = 4; g.stroke();
  g.strokeStyle = 'rgba(255,225,180,0.7)'; g.lineWidth = 2.5; g.lineCap = 'round'; g.beginPath(); g.moveTo(28, 17); g.lineTo(W - 30, 17); g.stroke();
  // The keyboard shelf sticks out past the case, with a cheek block at each end.
  rr(g, 10, 138, W - 20, 44, 6); g.fillStyle = wood(138, 182, '#8a5730', '#4d2912'); g.fill(); g.strokeStyle = OUT; g.lineWidth = 4; g.stroke();
  // The keys: an ivory strip cut into white keys, the black keys over their top half.
  const kx = 30, ky = 144, kw = W - 60, kh = 26, n = 19;
  g.fillStyle = wood(ky, ky + kh, '#fffdf4', '#d9d2bf'); g.fillRect(kx, ky, kw, kh);
  g.strokeStyle = 'rgba(60,50,40,0.75)'; g.lineWidth = 1.2;
  for (let i = 1; i < n; i++) { const x = kx + (kw * i) / n; g.beginPath(); g.moveTo(x, ky); g.lineTo(x, ky + kh); g.stroke(); }
  g.fillStyle = '#17171b';
  for (let i = 1; i < n; i++) {
    if (i % 7 === 3 || i % 7 === 0) continue; // the gaps that group the black keys in twos and threes
    g.fillRect(kx + (kw * i) / n - 4, ky, 8, 15);
  }
  g.strokeStyle = '#2a170a'; g.lineWidth = 2.5; g.strokeRect(kx, ky, kw, kh);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(kx, ky + kh, kw, 3);
  return k.c;
}

function paintKey(black: boolean): HTMLCanvasElement | null {
  const k = canvas(KEY_W, KEY_H); if (!k) return null;
  const g = k.g;
  const w = black ? 10 : 14, h = black ? 32 : 44, x = (KEY_W - w) / 2, y = (KEY_H - h) / 2;
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  if (black) { gr.addColorStop(0, '#3a3a42'); gr.addColorStop(0.35, '#17171b'); gr.addColorStop(1, '#08080a'); }
  else { gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#f3eedd'); gr.addColorStop(1, '#c9c1ab'); }
  rr(g, x, y, w, h, 2); g.fillStyle = gr; g.fill();
  g.strokeStyle = black ? '#000000' : 'rgba(50,42,34,0.9)'; g.lineWidth = 1.5; g.stroke();
  // The front lip.
  g.fillStyle = black ? 'rgba(120,120,135,0.5)' : 'rgba(120,108,90,0.45)'; g.fillRect(x + 1.5, y + h - 6, w - 3, 2);
  return k.c;
}

function paintPuff(): HTMLCanvasElement | null {
  const D = PUFF_PX;
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  // Overlapping soft lobes: a lumpy little cloud.
  const lobes: [number, number, number][] = [[0.5, 0.56, 0.3], [0.3, 0.6, 0.2], [0.7, 0.6, 0.21], [0.4, 0.4, 0.22], [0.62, 0.4, 0.2]];
  for (const [x, y, r] of lobes) {
    const gr = g.createRadialGradient(x * D, y * D, 0, x * D, y * D, r * D);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.65, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x * D, y * D, r * D, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

function paintShadow(): HTMLCanvasElement | null {
  const D = SHADOW_PX;
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const gr = g.createRadialGradient(D / 2, D / 2, 0, D / 2, D / 2, D / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.62, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.86, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, D, D);
  return k.c;
}

let cached: HeroAnvilTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroAnvilTextures(): HeroAnvilTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const anvil = paintAnvil(), piano = paintPiano(), white = paintKey(false), black = paintKey(true), puff = paintPuff(), shadow = paintShadow();
  if (!base || !anvil || !piano || !white || !black || !puff || !shadow) return null;
  cached = { ...base, anvil: tex(anvil), piano: tex(piano), keyWhite: tex(white), keyBlack: tex(black), puff: tex(puff), shadow: tex(shadow) };
  return cached;
}
