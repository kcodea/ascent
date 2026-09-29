/**
 * The Backstab's textures, painted ONCE per session on 2D canvases and kept (two small squares on top of the shared
 * Blast / Arcana set it reuses for glows, rings, stars and streaks). Greys, so every sprite tints them:
 *  - SMOKE: a lumpy billow with soft but defined edges, lit from the top (a puff of shadow, not a gradient disc).
 *  - SLASH: a crisp crescent, thick in the middle and tapering to two fine points (a dagger's cut), +X across.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { seededRng } from '../heroAttack/easing';
import type { HeroBackstabTextures } from './heroBackstabScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

function paintSmoke(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(7717);
  const lumps: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.6, r = D * (0.12 + rnd() * 0.08);
    lumps.push([D / 2 + Math.cos(a) * r, D / 2 + Math.sin(a) * r, D * (0.15 + rnd() * 0.07)]);
  }
  lumps.push([D / 2, D / 2, D * 0.21]);
  lumps.sort((p, q) => q[1] - p[1]);
  for (const [x, y, rr] of lumps) {
    const gr = g.createRadialGradient(x - rr * 0.3, y - rr * 0.35, rr * 0.05, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(200,200,200,0.85)');
    gr.addColorStop(0.9, 'rgba(150,150,150,0.7)'); gr.addColorStop(1, 'rgba(130,130,130,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

function paintSlash(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  // The crescent: an outer arc and a flatter inner arc meeting at two fine points.
  g.beginPath();
  g.moveTo(2, H * 0.62);
  g.quadraticCurveTo(W / 2, -H * 0.18, W - 2, H * 0.62);
  g.quadraticCurveTo(W / 2, H * 0.3, 2, H * 0.62);
  g.closePath();
  g.fillStyle = '#fff'; g.fill();
  return k.c;
}

let cached: HeroBackstabTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroBackstabTextures(): HeroBackstabTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const smoke = paintSmoke(128), slash = paintSlash(160, 48);
  if (!base || !smoke || !slash) return null;
  cached = { ...base, smoke: tex(smoke), slash: tex(slash) };
  return cached;
}
