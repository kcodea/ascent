/**
 * The Void's textures, painted ONCE per session on 2D canvases and kept (about 170 KB of its own on top of the Blast
 * and Arcana basics it shares: glow, spark, streak, ring, the ribbon strips, the star). Everything is white, so every
 * sprite tints it.
 *
 * Two shapes carry the whole look: the DISC (a solid circle with a short feathered edge; tinted near-black on a
 * NORMAL-blend layer it is the hole itself, so it stays black on any board) and the SWIRL (spiral arms of light
 * winding into an empty middle: spun behind the disc it is the accretion light being pulled in).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroVoidTextures } from './heroVoidScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** The circle's radius as a fraction of the disc texture's box (the rest is the feather). */
export const VOID_DISC_FILL = 0.46;

/** The hole: solid to 86% of its radius, then a short feather to nothing. */
function paintDisc(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2, r = D * VOID_DISC_FILL;
  const gr = g.createRadialGradient(c, c, 0, c, c, r);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.86, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, D, D);
  return k.c;
}

/**
 * The accretion swirl: `arms` spiral arms winding inward (clockwise on screen), thick and bright at the rim of the
 * hole and thinning to nothing at the outer edge, over a faint haze. The middle is left EMPTY (the disc sits there).
 */
function paintSwirl(D: number, arms: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const haze = g.createRadialGradient(c, c, D * 0.14, c, c, D * 0.48);
  haze.addColorStop(0, 'rgba(255,255,255,0.34)'); haze.addColorStop(0.5, 'rgba(255,255,255,0.1)'); haze.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = haze; g.fillRect(0, 0, D, D);
  g.lineCap = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.02;
  const STEPS = 40;
  const r0 = D * 0.17, r1 = D * 0.47, turn = 1.9;
  for (let a = 0; a < arms; a++) {
    const base = (a / arms) * Math.PI * 2;
    for (let i = 0; i < STEPS; i++) {
      const u0 = i / STEPS, u1 = (i + 1) / STEPS;
      const p = (u: number): [number, number] => {
        const r = r0 + (r1 - r0) * u, th = base + turn * u;
        return [c + Math.cos(th) * r, c + Math.sin(th) * r];
      };
      const [x0, y0] = p(u0), [x1, y1] = p(u1);
      g.strokeStyle = `rgba(255,255,255,${(Math.pow(1 - u0, 1.5) * 0.95).toFixed(3)})`;
      g.lineWidth = D * (0.006 + 0.03 * (1 - u0));
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
  }
  return k.c;
}

let cached: HeroVoidTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the Void then skips Pixi). */
export function heroVoidTextures(): HeroVoidTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const disc = paintDisc(128), swirl = paintSwirl(160, 5);
  if (!base || !disc || !swirl) return null;
  cached = { ...base, disc: tex(disc), swirl: tex(swirl) };
  return cached;
}
