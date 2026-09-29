/**
 * Storm Call's textures, painted ONCE per session on 2D canvases and kept (about 130 KB of its own on top of the Blast
 * and Arcana basics it shares). Everything is white or grey, so every sprite and strip tints it.
 *
 * A BOLT is drawn as strips whose U runs along the bolt and V across it, so its textures only vary ACROSS (down the
 * canvas): the GLOW is a wide soft bell, the CORE a hard bright middle with a thin feather. The CLOUD PUFF is a lumpy
 * billow lit from above (a bright crown fading to a shaded underside), so a slate tint reads as a thick storm cloud.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { seededRng } from '../heroAttack/easing';
import type { HeroStormTextures } from './heroStormScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** The bolt's glow: a soft bell across (V), constant along (U). */
function paintBoltGlow(): HTMLCanvasElement | null {
  const k = canvas(8, 64); if (!k) return null;
  const gr = k.g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.25)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, 8, 64);
  return k.c;
}

/** The bolt's core: solid across the middle, a thin feather at the edges. */
function paintBoltCore(): HTMLCanvasElement | null {
  const k = canvas(8, 32); if (!k) return null;
  const gr = k.g.createLinearGradient(0, 0, 0, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.22, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)');
  gr.addColorStop(0.78, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, 8, 32);
  return k.c;
}

/** A storm puff: overlapping round lumps, each lit from above (a bright crown, a shaded underside), soft but defined. */
function paintPuff(D: number, seed: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(seed);
  const lumps: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.5, r = D * (0.11 + rnd() * 0.08);
    lumps.push([D / 2 + Math.cos(a) * r * 1.3, D / 2 + Math.sin(a) * r * 0.8, D * (0.15 + rnd() * 0.07)]);
  }
  lumps.push([D / 2, D / 2 - D * 0.04, D * 0.22]);
  lumps.sort((p, q) => q[1] - p[1]);
  for (const [x, y, rr] of lumps) {
    const gr = g.createRadialGradient(x - rr * 0.2, y - rr * 0.5, rr * 0.05, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(200,200,200,0.97)');
    gr.addColorStop(0.88, 'rgba(120,120,120,0.9)'); gr.addColorStop(1, 'rgba(100,100,100,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

let cached: HeroStormTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroStormTextures(): HeroStormTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const glow = paintBoltGlow(), core = paintBoltCore(), puff = paintPuff(128, 811), puff2 = paintPuff(128, 3571);
  if (!base || !glow || !core || !puff || !puff2) return null;
  cached = { ...base, boltGlow: tex(glow), boltCore: tex(core), puff: tex(puff), puff2: tex(puff2) };
  return cached;
}
