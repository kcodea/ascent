/**
 * The Enraged Strike's textures, painted ONCE per session on 2D canvases and kept (about 400 KB of GPU memory on top of
 * the Blast's five and the Arcana ribbon strips, which it shares). Everything is white or grey, so every sprite and strip
 * tints it; the rock is grey with a white rim so a dark tint still shows its lit edge.
 *
 * The portrait GHOST (the afterimage) is the striking hero's own art, painted once per portrait image into a round
 * canvas (cached by its src), so the afterimages are the hero's face, not a disc. A sandbox with no portrait image, an
 * image not loaded yet, or one the canvas cannot read back falls back to a soft round silhouette.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { seededRng } from '../heroAttack/easing';
import { pixiFireTextures } from '../heroAttack/pixiFire';
import type { HeroEnragedTextures } from './heroEnragedScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** A smoke puff: a few overlapping soft blobs (seeded), so it reads as billowing, not as a perfect disc. */
function paintSmoke(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(907);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2, r = D * (0.05 + rnd() * 0.16);
    const x = D / 2 + Math.cos(a) * r, y = D / 2 + Math.sin(a) * r;
    const rr = D * (0.2 + rnd() * 0.14);
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, D, D);
  }
  return k.c;
}

/** A chunk of rock debris: an irregular polygon, grey with a white lit rim (a dark tint keeps a visible edge). */
function paintRock(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(4211);
  const n = 7;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
    const r = D * (0.28 + rnd() * 0.18);
    const x = D / 2 + Math.cos(a) * r, y = D / 2 + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = 'rgb(150,150,150)'; g.fill();
  g.lineWidth = D * 0.06; g.strokeStyle = 'rgb(255,255,255)'; g.lineJoin = 'round'; g.stroke();
  return k.c;
}

/** The crater's scorch: a dark ragged ring (white here; tinted near-black) round a clear middle. */
function paintScorch(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  // Clear in the middle (the struck portrait sits IN the crater, never under a dark disc), densest just outside it.
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.78, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, D, D);
  // Ragged splashes past the rim.
  const rnd = seededRng(77);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, r = c * (0.55 + rnd() * 0.3), rr = c * (0.08 + rnd() * 0.1);
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    const s = g.createRadialGradient(x, y, 0, x, y, rr);
    s.addColorStop(0, 'rgba(255,255,255,0.5)'); s.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = s; g.fillRect(0, 0, D, D);
  }
  return k.c;
}

/** The crater's glowing cracks: jagged lines radiating from the centre, forking, thick at the root. */
function paintCracks(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const rnd = seededRng(1337);
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.02;
  const crack = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
    let px = x, py = y, ang = a;
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      ang += (rnd() - 0.5) * 0.7;
      const nx = px + Math.cos(ang) * (len / steps), ny = py + Math.sin(ang) * (len / steps);
      g.lineWidth = Math.max(1, w * (1 - i / steps));
      g.beginPath(); g.moveTo(px, py); g.lineTo(nx, ny); g.stroke();
      if (depth > 0 && rnd() < 0.35) crack(nx, ny, ang + (rnd() < 0.5 ? 0.7 : -0.7), len * 0.45, w * 0.5, depth - 1);
      px = nx; py = ny;
    }
  };
  // They start at the portrait's rim (about 0.4 of the radius here), so the face stays readable.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.3;
    crack(c + Math.cos(a) * c * 0.38, c + Math.sin(a) * c * 0.38, a, c * (0.4 + rnd() * 0.2), D * 0.028, 1);
  }
  return k.c;
}

/** The fallback afterimage: a soft round silhouette with a brighter rim (the portrait's frame). */
function paintDisc(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.78, 'rgba(255,255,255,0.55)');
  gr.addColorStop(0.9, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, D, D);
  return k.c;
}

/** A thin crisp ring with a soft bloom (radius 118 of 256). */
function paintRim(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.03;
  g.strokeStyle = '#fff'; g.lineWidth = D * 0.022;
  g.beginPath(); g.arc(D / 2, D / 2, D * 0.46, 0, Math.PI * 2); g.stroke();
  return k.c;
}

/**
 * A soft ANNULUS (the aura's halo): clear in the middle, brightest just outside the portrait's rim (radius 0.5 of the
 * 0.5 half-size, i.e. the texture's half-width maps to 1.6 portrait radii), so the glow never sits over the face.
 */
function paintHalo(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0)');
  gr.addColorStop(0.64, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, D, D);
  return k.c;
}

/**
 * RIM CRACKS: short jagged fissures radiating off a ring at 0.62 of the half-width (the struck portrait's rim), each
 * thick where it leaves the rim and forking once. They hug the frame (never lightning across the board, never over the
 * face).
 */
function paintRimCracks(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const r0 = c * 0.62;
  const rnd = seededRng(2718);
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.012;
  const n = 16;
  for (let i = 0; i < n; i++) {
    let a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.25;
    let x = c + Math.cos(a) * r0, y = c + Math.sin(a) * r0;
    const len = c * (0.1 + rnd() * 0.16);
    const steps = 3;
    for (let s = 0; s < steps; s++) {
      a += (rnd() - 0.5) * 0.9;
      const nx = x + Math.cos(a) * (len / steps), ny = y + Math.sin(a) * (len / steps);
      g.lineWidth = D * 0.016 * (1 - s / steps) + 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      if (s === 1 && rnd() < 0.6) {
        const fa = a + (rnd() < 0.5 ? 0.8 : -0.8);
        g.lineWidth = D * 0.006 + 1;
        g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx + Math.cos(fa) * len * 0.35, ny + Math.sin(fa) * len * 0.35); g.stroke();
      }
      x = nx; y = ny;
    }
  }
  return k.c;
}

let cached: HeroEnragedTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroEnragedTextures(): HeroEnragedTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const smoke = paintSmoke(96), rock = paintRock(40);
  const scorch = paintScorch(192), cracks = paintCracks(256), disc = paintDisc(128), rim = paintRim(256), halo = paintHalo(128), rimCracks = paintRimCracks(256);
  if (!base || !smoke || !rock || !scorch || !cracks || !disc || !rim || !halo || !rimCracks) return null;
  // The rage aura, the haymaker's rear and its crater burn in live particle fire (owner 2026-09-29), from the shared set.
  cached = { ...base, smoke: tex(smoke), rock: tex(rock), scorch: tex(scorch), cracks: tex(cracks), disc: tex(disc), rim: tex(rim), halo: tex(halo), rimCracks: tex(rimCracks), fire: pixiFireTextures() };
  return cached;
}

const ghosts = new Map<string, Texture | null>();

/**
 * The striking hero's portrait as a round texture (the afterimages), painted once per image src and cached. Null when
 * there is no image, it has not loaded, or the canvas cannot read it back (the caller then uses the silhouette).
 */
export function portraitGhostTexture(img: HTMLImageElement | null | undefined): Texture | null {
  if (!img || typeof document === 'undefined') return null;
  const src = img.currentSrc || img.src;
  if (!src) return null;
  if (ghosts.has(src)) return ghosts.get(src) ?? null;
  if (!img.complete || !(img.naturalWidth > 0)) return null; // not cached: try again next time it is loaded
  const D = 128;
  const k = canvas(D, D);
  let out: Texture | null = null;
  if (k) {
    try {
      k.g.save();
      k.g.beginPath(); k.g.arc(D / 2, D / 2, D / 2 - 1, 0, Math.PI * 2); k.g.clip();
      // Cover-fit the art into the circle (a portrait is square or near it).
      const s = Math.max(D / img.naturalWidth, D / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      k.g.drawImage(img, (D - w) / 2, (D - h) / 2, w, h);
      k.g.restore();
      k.g.getImageData(0, 0, 1, 1); // throws on a tainted canvas (a cross-origin image): WebGL could not upload it
      out = tex(k.c);
    } catch { out = null; }
  }
  ghosts.set(src, out);
  return out;
}
