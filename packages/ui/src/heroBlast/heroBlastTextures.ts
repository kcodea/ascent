/**
 * The Blast's four textures, painted ONCE per session on 2D canvases and kept (they are tiny: ~200 KB of GPU memory
 * in all). White, so every sprite tints them. Kept local rather than importing the crate's painters, so the gameplay
 * chunk does not pull the Collection's crate code in with it.
 */
import { CanvasSource, Texture } from 'pixi.js';
import type { HeroBlastTextures } from './heroBlastScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

function paintGlow(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const r = D / 2;
  const gr = k.g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.62)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, D, D);
  return k.c;
}

function paintSpark(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const r = D / 2;
  const gr = k.g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, D, D);
  return k.c;
}

/** +X aligned: dim tail on the left, white-hot tip on the right. */
function paintStreak(L: number): HTMLCanvasElement | null {
  const H = Math.max(6, Math.round(L / 5));
  const k = canvas(L, H); if (!k) return null;
  const gr = k.g.createLinearGradient(0, 0, L, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  k.g.fillStyle = gr;
  k.g.beginPath(); k.g.ellipse(L / 2, H / 2, L / 2, H / 2, 0, 0, Math.PI * 2); k.g.fill();
  return k.c;
}

function paintRing(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  k.g.shadowColor = '#fff'; k.g.shadowBlur = D * 0.05;
  k.g.strokeStyle = 'rgba(255,255,255,0.95)'; k.g.lineWidth = D * 0.04;
  k.g.beginPath(); k.g.arc(D / 2, D / 2, D * 0.4, 0, Math.PI * 2); k.g.stroke();
  return k.c;
}

let cached: HeroBlastTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the Blast then skips Pixi). */
export function heroBlastTextures(): HeroBlastTextures | null {
  if (cached) return cached;
  const glow = paintGlow(128), spark = paintSpark(32), streak = paintStreak(64), ring = paintRing(160);
  if (!glow || !spark || !streak || !ring) return null;
  cached = { glow: tex(glow), spark: tex(spark), streak: tex(streak), ring: tex(ring) };
  return cached;
}
