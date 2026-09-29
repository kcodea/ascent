/**
 * The Coin Flick's textures, painted ONCE per session on 2D canvases and kept (two small 96 px squares on top of the
 * shared Blast / Arcana set it reuses for glows, rings, stars and sparks). Painted in greys so a gold tint gives the
 * metal its tones: a bright raised rim, a cut groove, a field, and an embossed star lit from the top left.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroCoinTextures } from './heroCoinScene';

const COIN_D = 96;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, ro: number, ri: number, pts = 5): void {
  g.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / pts;
    const r = i % 2 ? ri : ro;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

/** The coin's face: rim, groove, reeded edge ticks, a field and an embossed star (grey, lit from the top left). */
function paintFace(): HTMLCanvasElement | null {
  const k = canvas(COIN_D, COIN_D); if (!k) return null;
  const g = k.g;
  const c = COIN_D / 2, R = COIN_D / 2 - 2;
  // The body: lit top left, shaded bottom right.
  const body = g.createLinearGradient(c - R, c - R, c + R, c + R);
  body.addColorStop(0, 'rgb(255,255,255)'); body.addColorStop(0.5, 'rgb(215,215,215)'); body.addColorStop(1, 'rgb(120,120,120)');
  g.fillStyle = body; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
  // The reeded edge: short dark ticks round the rim.
  g.strokeStyle = 'rgba(90,90,90,0.55)'; g.lineWidth = 1.4;
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    g.beginPath(); g.moveTo(c + Math.cos(a) * (R - 1), c + Math.sin(a) * (R - 1)); g.lineTo(c + Math.cos(a) * (R - 5), c + Math.sin(a) * (R - 5)); g.stroke();
  }
  // The groove inside the rim, and the field (shaded the other way, so it reads as sunk).
  g.strokeStyle = 'rgb(105,105,105)'; g.lineWidth = 2.2;
  g.beginPath(); g.arc(c, c, R * 0.8, 0, Math.PI * 2); g.stroke();
  const field = g.createLinearGradient(c - R, c - R, c + R, c + R);
  field.addColorStop(0, 'rgb(175,175,175)'); field.addColorStop(1, 'rgb(230,230,230)');
  g.fillStyle = field; g.beginPath(); g.arc(c, c, R * 0.76, 0, Math.PI * 2); g.fill();
  // The embossed star: a dark offset shadow, then the lit face on top.
  g.fillStyle = 'rgb(110,110,110)'; starPath(g, c + 1.6, c + 2, R * 0.46, R * 0.2); g.fill();
  const lit = g.createLinearGradient(c - R * 0.4, c - R * 0.4, c + R * 0.4, c + R * 0.4);
  lit.addColorStop(0, 'rgb(255,255,255)'); lit.addColorStop(1, 'rgb(200,200,200)');
  g.fillStyle = lit; starPath(g, c, c, R * 0.46, R * 0.2); g.fill();
  // A thin dark outline so the coin holds its shape on a bright board.
  g.strokeStyle = 'rgba(70,70,70,0.9)'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(c, c, R - 0.5, 0, Math.PI * 2); g.stroke();
  return k.c;
}

/** The gleam: a soft diagonal band of light across the face, clipped to the disc (additive, white). */
function paintShine(): HTMLCanvasElement | null {
  const k = canvas(COIN_D, COIN_D); if (!k) return null;
  const g = k.g;
  const c = COIN_D / 2, R = COIN_D / 2 - 3;
  g.save();
  g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.clip();
  const band = g.createLinearGradient(c - R, c - R * 0.2, c + R * 0.2, c + R);
  band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.38, 'rgba(255,255,255,0)');
  band.addColorStop(0.47, 'rgba(255,255,255,0.95)'); band.addColorStop(0.56, 'rgba(255,255,255,0)'); band.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = band; g.fillRect(0, 0, COIN_D, COIN_D);
  g.restore();
  return k.c;
}

let cached: HeroCoinTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroCoinTextures(): HeroCoinTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const face = paintFace(), shine = paintShine();
  if (!base || !face || !shine) return null;
  cached = { ...base, coinFace: tex(face), coinShine: tex(shine) };
  return cached;
}

/** The coin texture's diameter in texture px (the scene scales by it). */
export const COIN_TEX_D = COIN_D;
