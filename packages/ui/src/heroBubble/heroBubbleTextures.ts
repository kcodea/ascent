/**
 * Bubble Pop's textures, painted ONCE per session on 2D canvases and kept (a few small squares on top of the shared
 * Blast / Arcana set it reuses for glows, rings and stars).
 *  - FILM: a soap bubble's skin. Clear in the middle, a faint pastel swirl inside, and thin iridescent bands round the
 *    rim (pink, gold, mint, sky, lilac, blended lighter), with a crisp pale edge. Painted in colour (iridescence needs
 *    several hues at once); the sprite's tint (the Film colour, white by default) only warms or cools it.
 *  - SHEEN: the bubble's reflections: a curved window of light up and to the left, a small bright dot, a faint
 *    reflected arc low on the right (additive, white). It is drawn upright while the film turns under it, so the colours
 *    swirl and the light stays put.
 *  - DROP: a round droplet with a highlight, +X aligned (stretched along its flight by the pool).
 *  - TINY: a little bubble (a thin rim and a glint) for the fizz of tiny bubbles.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroBubbleTextures } from './heroBubbleScene';

export const FILM_D = 256;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

function paintFilm(): HTMLCanvasElement | null {
  const k = canvas(FILM_D, FILM_D); if (!k) return null;
  const g = k.g;
  const c = FILM_D / 2, R = FILM_D / 2 - 3;
  // The body: clear in the middle, a faint milky tint toward the rim.
  const body = g.createRadialGradient(c, c, 0, c, c, R);
  body.addColorStop(0, 'rgba(255,255,255,0.02)'); body.addColorStop(0.7, 'rgba(235,245,255,0.07)'); body.addColorStop(0.93, 'rgba(240,248,255,0.22)'); body.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = body; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
  // A faint pastel swirl inside (two soft blobs), so the film has colour when it turns.
  for (const [x, y, r, col] of [[c + R * 0.35, c - R * 0.25, R * 0.55, '255,170,215'], [c - R * 0.3, c + R * 0.35, R * 0.5, '160,245,215']] as const) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${col},0.16)`); gr.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // The iridescent rim: a smooth sweep of pastel hues round the ring (a conic gradient where the browser has one),
  // laid as soft concentric bands so it fades in toward the middle, blended lighter.
  g.globalCompositeOperation = 'lighter';
  const hues = ['255,150,210', '255,220,140', '150,245,205', '150,210,255', '200,170,255', '255,150,210'];
  const conic = (g as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient;
  for (let b = 0; b < 6; b++) {
    const r = R * (0.95 - b * 0.03);
    const alpha = 0.3 * (1 - b / 6);
    if (conic) {
      const cg = conic.call(g, b * 0.35, c, c);
      hues.forEach((h, i) => cg.addColorStop(i / (hues.length - 1), `rgba(${h},${alpha.toFixed(3)})`));
      g.strokeStyle = cg;
      g.lineWidth = R * 0.075;
      g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
    } else {
      g.lineWidth = R * 0.05;
      for (let i = 0; i < 24; i++) {
        const a0 = (i / 24) * Math.PI * 2 + b * 0.35;
        g.strokeStyle = `rgba(${hues[i % 5]},${alpha.toFixed(3)})`;
        g.beginPath(); g.arc(c, c, r, a0, a0 + Math.PI / 11); g.stroke();
      }
    }
  }
  g.globalCompositeOperation = 'source-over';
  // The crisp pale edge.
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2.4;
  g.beginPath(); g.arc(c, c, R - 0.8, 0, Math.PI * 2); g.stroke();
  return k.c;
}

function paintSheen(): HTMLCanvasElement | null {
  const k = canvas(FILM_D, FILM_D); if (!k) return null;
  const g = k.g;
  const c = FILM_D / 2, R = FILM_D / 2 - 3;
  g.lineCap = 'round';
  // The window: a curved band of light up and to the left.
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = R * 0.12;
  g.beginPath(); g.arc(c, c, R * 0.72, Math.PI * 1.08, Math.PI * 1.42); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = R * 0.06;
  g.beginPath(); g.arc(c, c, R * 0.72, Math.PI * 1.5, Math.PI * 1.58); g.stroke();
  // The bright dot.
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(c - R * 0.28, c - R * 0.52, R * 0.07, 0, Math.PI * 2); g.fill();
  // A faint reflected arc low on the right.
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = R * 0.05;
  g.beginPath(); g.arc(c, c, R * 0.78, Math.PI * 0.12, Math.PI * 0.38); g.stroke();
  return k.c;
}

function paintDrop(): HTMLCanvasElement | null {
  const k = canvas(32, 20); if (!k) return null;
  const g = k.g;
  const r = 7.5, cx = 32 - r - 2, cy = 10;
  g.fillStyle = 'rgba(235,245,255,0.95)';
  g.beginPath(); g.moveTo(2, cy); g.quadraticCurveTo(cx - r * 0.3, cy - r * 1.05, cx, cy - r); g.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2); g.quadraticCurveTo(cx - r * 0.3, cy + r * 1.05, 2, cy); g.closePath(); g.fill();
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(cx + r * 0.25, cy - r * 0.35, r * 0.3, 0, Math.PI * 2); g.fill();
  return k.c;
}

function paintTiny(): HTMLCanvasElement | null {
  const k = canvas(40, 40); if (!k) return null;
  const g = k.g;
  const c = 20, r = 16;
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2.2; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.ellipse(c - r * 0.4, c - r * 0.4, r * 0.24, r * 0.15, -0.7, 0, Math.PI * 2); g.fill();
  return k.c;
}

let cached: HeroBubbleTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroBubbleTextures(): HeroBubbleTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const film = paintFilm(), sheen = paintSheen(), drop = paintDrop(), tiny = paintTiny();
  if (!base || !film || !sheen || !drop || !tiny) return null;
  cached = { ...base, film: tex(film), sheen: tex(sheen), drop: tex(drop), tiny: tex(tiny) };
  return cached;
}
