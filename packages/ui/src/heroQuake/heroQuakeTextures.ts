/**
 * The Quake's textures, painted ONCE per session on 2D canvases and kept (a few hundred KB of GPU memory in all). The
 * light textures (glow, spark, ring, streak, beam) are the Blast's own, shared; the ground ones are painted here.
 * Everything is white or grayscale, so every sprite tints it (the side colour, the chasm, the dust, the rock).
 *
 * Bold, clean shapes (owner bar 2026-09-28, "thicker and cleaner"): a crack segment is a crisp capsule, a rock is a
 * faceted chunk with a thick dark outline, a dust puff is a soft lumpy cloud, never noise.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroBlastTextures } from '../heroBlast/heroBlastTextures';
import type { HeroQuakeTextures } from './heroQuakeScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** A crack segment: a crisp capsule along +X (drawn stretched along the segment, so its round caps overlap cleanly). */
function paintCapsule(W: number, H: number, soft: boolean): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  if (soft) {
    // A soft bar: bright along the middle, feathered top, bottom and ends (the magma glow around a seam).
    const v = g.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.5, 'rgba(255,255,255,1)'); v.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = v; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-in';
    const h = g.createLinearGradient(0, 0, W, 0);
    h.addColorStop(0, 'rgba(255,255,255,0)'); h.addColorStop(0.2, 'rgba(255,255,255,1)');
    h.addColorStop(0.8, 'rgba(255,255,255,1)'); h.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = h; g.fillRect(0, 0, W, H);
    return k.c;
  }
  const r = H / 2 - 1;
  g.fillStyle = '#fff';
  g.beginPath();
  g.moveTo(r + 1, 1); g.lineTo(W - r - 1, 1);
  g.arc(W - r - 1, H / 2, r, -Math.PI / 2, Math.PI / 2);
  g.lineTo(r + 1, H - 1);
  g.arc(r + 1, H / 2, r, Math.PI / 2, -Math.PI / 2);
  g.closePath(); g.fill();
  return k.c;
}

/** A rock chunk: an irregular faceted polygon, lit from the top left, with a thick dark outline. Grayscale. */
function paintRock(D: number, seed: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  let s = seed;
  const rnd = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const n = 7;
  const cx = D / 2, cy = D / 2, R = D * 0.4;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const r = R * (0.72 + rnd() * 0.28);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  });
  const path = (): void => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); };
  // Base (the mid tone), then the lit facet (top left) and the shadow facet (bottom right), clipped to the chunk.
  path(); g.fillStyle = '#9a9086'; g.fill();
  g.save(); path(); g.clip();
  g.fillStyle = '#e9e2d8';
  g.beginPath(); g.moveTo(cx - R * 1.2, cy - R * 1.2); g.lineTo(cx + R * 0.5, cy - R * 1.2); g.lineTo(cx + R * 0.05, cy + R * 0.05); g.lineTo(cx - R * 1.2, cy + R * 0.3); g.closePath(); g.fill();
  g.fillStyle = '#4c443d';
  g.beginPath(); g.moveTo(cx + R * 1.2, cy - R * 0.1); g.lineTo(cx + R * 1.2, cy + R * 1.2); g.lineTo(cx - R * 0.5, cy + R * 1.2); g.lineTo(cx + R * 0.05, cy + R * 0.05); g.closePath(); g.fill();
  g.restore();
  path(); g.lineJoin = 'round'; g.lineWidth = D * 0.07; g.strokeStyle = '#17110c'; g.stroke();
  return k.c;
}

/** A dust puff: a soft lumpy cloud (a few overlapping soft circles), white, feathered to nothing at its rim. */
function paintDust(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const blobs: [number, number, number][] = [[0.5, 0.55, 0.36], [0.34, 0.5, 0.26], [0.66, 0.48, 0.27], [0.5, 0.36, 0.26], [0.42, 0.64, 0.22], [0.6, 0.64, 0.22]];
  for (const [x, y, r] of blobs) {
    const gr = g.createRadialGradient(x * D, y * D, 0, x * D, y * D, r * D);
    gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, D, D);
  }
  return k.c;
}

/** A thick soft ring (the dust shockwave rolling out from a slam): a feathered donut. */
function paintDustRing(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const r = D / 2;
  const gr = k.g.createRadialGradient(r, r, r * 0.45, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.75, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, D, D);
  return k.c;
}

/** The scorched crater: a dark donut (clear in the middle, so the portrait is never covered) with a ragged rim. */
function paintScorch(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const r = D / 2;
  const gr = g.createRadialGradient(r, r, r * 0.3, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.38, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, D, D);
  return k.c;
}

let cached: HeroQuakeTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the Quake then skips Pixi). */
export function heroQuakeTextures(): HeroQuakeTextures | null {
  if (cached) return cached;
  const light = heroBlastTextures();
  const crack = paintCapsule(64, 16, false), seamGlow = paintCapsule(64, 32, true);
  const rocks = [paintRock(48, 7), paintRock(48, 19), paintRock(48, 43)];
  const dust = paintDust(96), dustRing = paintDustRing(192), scorch = paintScorch(192);
  if (!light || !crack || !seamGlow || rocks.some((r) => !r) || !dust || !dustRing || !scorch) return null;
  cached = {
    ...light,
    crack: tex(crack), seamGlow: tex(seamGlow), rocks: rocks.map((r) => tex(r!)), dust: tex(dust), dustRing: tex(dustRing), scorch: tex(scorch),
  };
  return cached;
}
