/**
 * Soul Stitch's textures, painted ONCE per session on 2D canvases and kept (three small canvases on top of the shared
 * Blast / Arcana set it reuses for glows, rings, stars, streaks and sparks).
 *
 *  - The NEEDLE is painted in its own colours (the Ancient of Bonds' crystal: a deep purple edge, violet facets, a lilac
 *    ridge, a white-hot point, a gold-banded eye at the back), pointing along +x. It is drawn untinted.
 *  - The THREAD is a white strip profile (solid core, feathered edges, no fade along it) that the thread meshes tint.
 *  - The SHARD is a faceted crystal splinter painted in greys, so a violet or lilac tint gives it its tones.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroStitchTextures } from './heroStitchScene';

/** Texture sizes the scene scales by. */
export const NEEDLE_TEX_W = 128;
export const NEEDLE_TEX_H = 28;
export const THREAD_TEX_H = 16;
export const SHARD_TEX = 32;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** The crystal needle: a long faceted spike, point at +x, a gold-banded eye at the back. */
function paintNeedle(): HTMLCanvasElement | null {
  const k = canvas(NEEDLE_TEX_W, NEEDLE_TEX_H); if (!k) return null;
  const g = k.g;
  const W = NEEDLE_TEX_W, H = NEEDLE_TEX_H, cy = H / 2;
  const back = 6, eye = 22, belly = 44, tip = W - 2;
  const half = H * 0.32;
  // The silhouette: a slim back, the eye, swelling to the belly, tapering to a hard point.
  const body = (): void => {
    g.beginPath();
    g.moveTo(back, cy);
    g.lineTo(back + 4, cy - half * 0.55);
    g.lineTo(belly, cy - half);
    g.lineTo(tip, cy);
    g.lineTo(belly, cy + half);
    g.lineTo(back + 4, cy + half * 0.55);
    g.closePath();
  };
  g.shadowColor = 'rgba(168,85,247,0.9)'; g.shadowBlur = 6;
  body();
  const grad = g.createLinearGradient(0, cy - half, 0, cy + half);
  grad.addColorStop(0, '#e9d5ff'); grad.addColorStop(0.42, '#c084fc'); grad.addColorStop(0.58, '#7e22ce'); grad.addColorStop(1, '#2e1065');
  g.fillStyle = grad; g.fill();
  g.shadowBlur = 0;
  // The facets: a bright ridge along the top half, a darker one along the bottom.
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(back + 6, cy - 1); g.lineTo(belly, cy - half * 0.35); g.lineTo(tip - 2, cy); g.stroke();
  g.strokeStyle = 'rgba(46,16,101,0.8)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(back + 6, cy + 1.5); g.lineTo(belly, cy + half * 0.5); g.lineTo(tip - 3, cy + 0.5); g.stroke();
  // The white-hot point.
  const pt = g.createRadialGradient(tip - 6, cy, 0, tip - 6, cy, 12);
  pt.addColorStop(0, 'rgba(255,255,255,1)'); pt.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = pt; g.fillRect(tip - 20, 0, 20, H);
  // The eye: a gold band round a slot the thread runs through.
  g.fillStyle = '#d4a537';
  g.fillRect(eye - 5, cy - half * 0.8, 3, half * 1.6);
  g.fillRect(eye + 6, cy - half * 0.8, 3, half * 1.6);
  g.fillStyle = '#2e1065';
  g.beginPath(); g.ellipse(eye + 2, cy, 3.4, 1.6, 0, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** The thread's cross-section along V (solid core, feathered edges); uniform along U. */
function paintThread(): HTMLCanvasElement | null {
  const k = canvas(32, THREAD_TEX_H); if (!k) return null;
  const g = k.g;
  const v = g.createLinearGradient(0, 0, 0, THREAD_TEX_H);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  v.addColorStop(0.4, 'rgba(255,255,255,1)'); v.addColorStop(0.6, 'rgba(255,255,255,1)');
  v.addColorStop(0.75, 'rgba(255,255,255,0.7)'); v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v; g.fillRect(0, 0, 32, THREAD_TEX_H);
  return k.c;
}

/** A crystal splinter: an irregular faceted diamond, lit from the top left (greys, tinted by the scene). */
function paintShard(): HTMLCanvasElement | null {
  const k = canvas(SHARD_TEX, SHARD_TEX); if (!k) return null;
  const g = k.g;
  const S = SHARD_TEX, c = S / 2;
  const P: [number, number][] = [[c, 1], [c + S * 0.24, c - 2], [c + S * 0.12, S - 2], [c - S * 0.2, c + 3]];
  g.beginPath(); P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
  g.fillStyle = 'rgb(200,200,200)'; g.fill();
  // Two facets: a lit one and a shaded one, split down the long axis.
  g.beginPath(); g.moveTo(P[0]![0], P[0]![1]); g.lineTo(P[3]![0], P[3]![1]); g.lineTo(P[2]![0], P[2]![1]); g.closePath();
  g.fillStyle = 'rgb(255,255,255)'; g.fill();
  g.beginPath(); g.moveTo(P[0]![0], P[0]![1]); g.lineTo(P[1]![0], P[1]![1]); g.lineTo(P[2]![0], P[2]![1]); g.closePath();
  g.fillStyle = 'rgb(150,150,150)'; g.fill();
  g.strokeStyle = 'rgba(70,70,70,0.8)'; g.lineWidth = 1;
  g.beginPath(); P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
  return k.c;
}

let cached: HeroStitchTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroStitchTextures(): HeroStitchTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const needle = paintNeedle(), thread = paintThread(), shard = paintShard();
  if (!base || !needle || !thread || !shard) return null;
  cached = { ...base, needle: tex(needle), thread: tex(thread), shard: tex(shard) };
  return cached;
}
