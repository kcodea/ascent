/**
 * The Arcana's textures, painted ONCE per session on 2D canvases and kept (about 150 KB of GPU memory on top of the
 * Blast's four, which it shares: glow, spark, streak, ring). Everything is white, so every sprite and strip tints it.
 *
 * Bold, clean shapes (the owner's bar: "clean", "thicker and cleaner"): a ribbon is a smooth strip with a solid middle
 * and feathered edges (never noise), the sigil is a crisp arcane circle with thick strokes that still read small, and
 * a glitter mote is a four-point star.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroBlastTextures } from '../heroBlast/heroBlastTextures';
import type { HeroArcanaTextures } from './heroArcanaScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/**
 * A ribbon strip's texture: U runs along the ribbon (0 = the tail, 1 = the head), V across it. `soft` is the glow (a
 * wide bell, bright middle); otherwise the body (solid across its middle, feathered over the outer quarter). The tail
 * fades in over the first 30% of U, so the ribbon ends in a clean point of light, never a hard cut.
 */
function paintRibbon(W: number, H: number, soft: boolean): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const v = g.createLinearGradient(0, 0, 0, H);
  if (soft) {
    v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.22, 'rgba(255,255,255,0.22)');
    v.addColorStop(0.42, 'rgba(255,255,255,0.75)'); v.addColorStop(0.5, 'rgba(255,255,255,1)');
    v.addColorStop(0.58, 'rgba(255,255,255,0.75)'); v.addColorStop(0.78, 'rgba(255,255,255,0.22)'); v.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.2, 'rgba(255,255,255,0.85)');
    v.addColorStop(0.3, 'rgba(255,255,255,1)'); v.addColorStop(0.7, 'rgba(255,255,255,1)');
    v.addColorStop(0.8, 'rgba(255,255,255,0.85)'); v.addColorStop(1, 'rgba(255,255,255,0)');
  }
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, W, 0);
  h.addColorStop(0, 'rgba(255,255,255,0)'); h.addColorStop(0.3, 'rgba(255,255,255,1)'); h.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = h; g.fillRect(0, 0, W, H);
  return k.c;
}

/** The arcane sigil: a thick outer ring, a ring of rune ticks, an inscribed hexagram and a small inner ring. */
function paintSigil(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.025;
  const ring = (r: number, w: number): void => { g.lineWidth = w; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); };
  ring(D * 0.44, D * 0.035);
  ring(D * 0.355, D * 0.016);
  // Rune ticks between the rings: long and short alternating, with a dot on the long ones.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const long = i % 2 === 0;
    const r0 = D * 0.365, r1 = D * (long ? 0.425 : 0.4);
    g.lineWidth = D * (long ? 0.018 : 0.012);
    g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
  }
  // The hexagram: two triangles, inscribed in the inner ring.
  g.lineWidth = D * 0.02;
  for (const off of [-Math.PI / 2, Math.PI / 2]) {
    g.beginPath();
    for (let i = 0; i <= 3; i++) {
      const a = off + (i / 3) * Math.PI * 2;
      const x = c + Math.cos(a) * D * 0.34, y = c + Math.sin(a) * D * 0.34;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  ring(D * 0.15, D * 0.018);
  g.beginPath(); g.arc(c, c, D * 0.035, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** A glitter mote: a four-point star (two long thin diamonds crossed) over a small soft glow. */
function paintStar(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const gl = g.createRadialGradient(c, c, 0, c, c, c * 0.5);
  gl.addColorStop(0, 'rgba(255,255,255,0.9)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gl; g.fillRect(0, 0, D, D);
  g.fillStyle = '#fff';
  const diamond = (rx: number, ry: number): void => {
    g.beginPath(); g.moveTo(c, c - ry); g.lineTo(c + rx, c); g.lineTo(c, c + ry); g.lineTo(c - rx, c); g.closePath(); g.fill();
  };
  diamond(D * 0.07, D * 0.48);
  diamond(D * 0.48, D * 0.07);
  return k.c;
}

let cached: HeroArcanaTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (Arcana then skips Pixi). */
export function heroArcanaTextures(): HeroArcanaTextures | null {
  if (cached) return cached;
  const base = heroBlastTextures();
  const soft = paintRibbon(64, 32, true), body = paintRibbon(64, 32, false), sigil = paintSigil(160), star = paintStar(48);
  if (!base || !soft || !body || !sigil || !star) return null;
  cached = { ...base, ribbonSoft: tex(soft), ribbonBody: tex(body), sigil: tex(sigil), star: tex(star) };
  return cached;
}
