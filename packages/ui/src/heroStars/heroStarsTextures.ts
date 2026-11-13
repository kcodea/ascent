/**
 * Written in the Stars' textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast / Arcana
 * set it reuses for the soft glow and the ring). All white or grey, so every sprite tints them; nothing here is warm
 * or fiery: it is starlight.
 *  - GLINT: a constellation star: a small hot core with a long four-point glint and two faint diagonal rays.
 *  - DOT: a small soft point of light (the sky's background stars, the stardust).
 *  - LINE: one constellation line: a thin bright thread inside a soft glow, stretched from star to star.
 *  - TRAIL: a thread of light that fades toward its tail (behind the arrow and the falling star).
 *  - ARROW: the arrow of starlight: a thin shaft, a small head, two fletchings, and three bright points along it (the
 *    three stars it was made of).
 *  - HALO: a thin ring of light (a star's pop, the soft rings of the blow).
 *  - LIMB: a soft capsule (the hunter's ghost body between the lines).
 *  - VEIL: the night sky's vertical fade (lighter at the top, deepest at the bottom), tinted blue-black by the scene.
 *
 * The one piece of art it reads is the STRIKING HERO'S OWN PORTRAIT (Tier 4: "this hero, in the stars"): the portrait
 * image already on screen is copied once per image into a round, soft-edged texture and cached (`portraitStarTexture`).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroStarsTextures } from './heroStarsScene';

export const GLINT_PX = 128;
export const DOT_PX = 24;
export const LINE_W = 64;
export const LINE_H = 16;
export const TRAIL_W = 128;
export const TRAIL_H = 16;
export const ARROW_W = 192;
export const ARROW_H = 48;
export const LIMB_W = 64;
export const LIMB_H = 32;
export const VEIL_W = 4;
export const VEIL_H = 256;
export const PORTRAIT_PX = 256;
export const HALO_PX = 256;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** A star: a soft halo, a hot core, four long tapering rays and two short faint diagonals. */
function paintGlint(): HTMLCanvasElement | null {
  const k = canvas(GLINT_PX, GLINT_PX); if (!k) return null;
  const g = k.g;
  const c = GLINT_PX / 2;
  const halo = g.createRadialGradient(c, c, 0, c, c, c * 0.5);
  halo.addColorStop(0, 'rgba(255,255,255,0.55)'); halo.addColorStop(0.35, 'rgba(255,255,255,0.16)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo; g.fillRect(0, 0, GLINT_PX, GLINT_PX);
  // A ray: a needle that tapers to nothing, brightest at the core.
  const ray = (angle: number, len: number, half: number, alpha: number): void => {
    g.save(); g.translate(c, c); g.rotate(angle);
    const gr = g.createLinearGradient(0, 0, len, 0);
    gr.addColorStop(0, `rgba(255,255,255,${alpha})`); gr.addColorStop(0.3, `rgba(255,255,255,${alpha * 0.55})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, -half); g.quadraticCurveTo(len * 0.25, -half * 0.25, len, 0); g.quadraticCurveTo(len * 0.25, half * 0.25, 0, half); g.closePath(); g.fill();
    g.restore();
  };
  for (let i = 0; i < 4; i++) ray((i * Math.PI) / 2, c * (i % 2 ? 0.98 : 0.8), 3.4, 1);
  for (let i = 0; i < 4; i++) ray(Math.PI / 4 + (i * Math.PI) / 2, c * 0.34, 2.2, 0.5);
  const core = g.createRadialGradient(c, c, 0, c, c, 9);
  core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(0.55, 'rgba(255,255,255,0.95)'); core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core; g.beginPath(); g.arc(c, c, 9, 0, Math.PI * 2); g.fill();
  return k.c;
}

function paintDot(): HTMLCanvasElement | null {
  const k = canvas(DOT_PX, DOT_PX); if (!k) return null;
  const g = k.g;
  const c = DOT_PX / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.22, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, DOT_PX, DOT_PX);
  return k.c;
}

/** A line of light: a bright thin thread in a soft glow, with soft ends. `fade`: transparent at the left (a trail). */
function paintThread(w: number, h: number, fade: boolean): HTMLCanvasElement | null {
  const k = canvas(w, h); if (!k) return null;
  const g = k.g;
  const v = g.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.3, 'rgba(255,255,255,0.14)'); v.addColorStop(0.44, 'rgba(255,255,255,0.75)'); v.addColorStop(0.5, 'rgba(255,255,255,1)');
  v.addColorStop(0.56, 'rgba(255,255,255,0.75)'); v.addColorStop(0.7, 'rgba(255,255,255,0.14)'); v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  // The ends (and, for a trail, the whole length) fade along the line.
  g.globalCompositeOperation = 'destination-in';
  const a = g.createLinearGradient(0, 0, w, 0);
  if (fade) { a.addColorStop(0, 'rgba(0,0,0,0)'); a.addColorStop(0.6, 'rgba(0,0,0,0.45)'); a.addColorStop(1, 'rgba(0,0,0,1)'); }
  else { a.addColorStop(0, 'rgba(0,0,0,0.6)'); a.addColorStop(0.04, 'rgba(0,0,0,1)'); a.addColorStop(0.96, 'rgba(0,0,0,1)'); a.addColorStop(1, 'rgba(0,0,0,0.6)'); }
  g.fillStyle = a; g.fillRect(0, 0, w, h);
  return k.c;
}

/** The arrow of starlight, pointing right, its tip at the right edge. */
function paintArrow(): HTMLCanvasElement | null {
  const k = canvas(ARROW_W, ARROW_H); if (!k) return null;
  const g = k.g;
  const cy = ARROW_H / 2;
  const tail = 14, tip = ARROW_W - 6, neck = tip - 30;
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = 9;
  // The shaft: faint at the tail, bright at the head.
  const shaft = g.createLinearGradient(tail, 0, tip, 0);
  shaft.addColorStop(0, 'rgba(255,255,255,0.35)'); shaft.addColorStop(0.6, 'rgba(255,255,255,0.85)'); shaft.addColorStop(1, 'rgba(255,255,255,1)');
  g.strokeStyle = shaft; g.lineWidth = 2.6;
  g.beginPath(); g.moveTo(tail, cy); g.lineTo(neck + 6, cy); g.stroke();
  // The head: a slim leaf.
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(tip, cy); g.quadraticCurveTo(neck + 8, cy - 4, neck, cy - 11); g.lineTo(neck + 9, cy); g.lineTo(neck, cy + 11); g.quadraticCurveTo(neck + 8, cy + 4, tip, cy); g.closePath(); g.fill();
  // The fletchings: two pairs of short swept strokes.
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.8;
  for (const x of [tail + 4, tail + 16]) {
    g.beginPath(); g.moveTo(x + 12, cy); g.lineTo(x, cy - 9); g.stroke();
    g.beginPath(); g.moveTo(x + 12, cy); g.lineTo(x, cy + 9); g.stroke();
  }
  // The three stars it was made of.
  g.shadowBlur = 12;
  for (const [x, r] of [[tail + 2, 3.2], [ARROW_W * 0.46, 2.8], [tip - 4, 4.2]] as const) { g.beginPath(); g.arc(x, cy, r, 0, Math.PI * 2); g.fill(); }
  return k.c;
}

function paintLimb(): HTMLCanvasElement | null {
  const k = canvas(LIMB_W, LIMB_H); if (!k) return null;
  const g = k.g;
  const v = g.createLinearGradient(0, 0, 0, LIMB_H);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.5, 'rgba(255,255,255,1)'); v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v; g.fillRect(0, 0, LIMB_W, LIMB_H);
  g.globalCompositeOperation = 'destination-in';
  const a = g.createLinearGradient(0, 0, LIMB_W, 0);
  a.addColorStop(0, 'rgba(0,0,0,0)'); a.addColorStop(0.18, 'rgba(0,0,0,1)'); a.addColorStop(0.82, 'rgba(0,0,0,1)'); a.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = a; g.fillRect(0, 0, LIMB_W, LIMB_H);
  return k.c;
}

/** The night's vertical fade: full at the top, darker toward the ground (the scene tints it blue-black). */
function paintVeil(): HTMLCanvasElement | null {
  const k = canvas(VEIL_W, VEIL_H); if (!k) return null;
  const g = k.g;
  const v = g.createLinearGradient(0, 0, 0, VEIL_H);
  v.addColorStop(0, 'rgb(255,255,255)'); v.addColorStop(0.55, 'rgb(190,190,205)'); v.addColorStop(1, 'rgb(120,120,140)');
  g.fillStyle = v; g.fillRect(0, 0, VEIL_W, VEIL_H);
  return k.c;
}

/** A thin ring of light (a star's pop, the soft rings of the blow): a hairline in a faint glow. */
function paintHalo(): HTMLCanvasElement | null {
  const k = canvas(HALO_PX, HALO_PX); if (!k) return null;
  const g = k.g;
  const c = HALO_PX / 2;
  g.shadowColor = '#fff'; g.shadowBlur = 7;
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 5;
  g.beginPath(); g.arc(c, c, c - 12, 0, Math.PI * 2); g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.arc(c, c, c - 12, 0, Math.PI * 2); g.stroke();
  return k.c;
}

let cached: HeroStarsTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroStarsTextures(): HeroStarsTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const glint = paintGlint(), dot = paintDot(), line = paintThread(LINE_W, LINE_H, false), trail = paintThread(TRAIL_W, TRAIL_H, true);
  const arrow = paintArrow(), limb = paintLimb(), veil = paintVeil(), halo = paintHalo();
  if (!base || !glint || !dot || !line || !trail || !arrow || !limb || !veil || !halo) return null;
  cached = { ...base, glint: tex(glint), dot: tex(dot), line: tex(line), trail: tex(trail), arrow: tex(arrow), limb: tex(limb), veil: tex(veil), halo: tex(halo) };
  return cached;
}

const portraits = new Map<string, Texture | null>();

/**
 * The striking hero's portrait as a round, soft-edged texture (Tier 4's ghost in the medallion), painted once per image
 * and cached. Null when there is no image, it has not loaded, or the canvas cannot read it back (the medallion then
 * shows its star bust alone).
 */
export function portraitStarTexture(img: HTMLImageElement | null | undefined): Texture | null {
  if (!img || typeof document === 'undefined') return null;
  const src = img.currentSrc || img.src;
  if (!src) return null;
  if (portraits.has(src)) return portraits.get(src) ?? null;
  if (!img.complete || !(img.naturalWidth > 0)) return null; // not loaded yet: try again next attack
  const D = PORTRAIT_PX;
  const k = canvas(D, D);
  let out: Texture | null = null;
  if (k) {
    try {
      const s = Math.max(D / img.naturalWidth, D / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      k.g.drawImage(img, (D - w) / 2, (D - h) / 2, w, h);
      // Round, melting into the sky toward the rim.
      k.g.globalCompositeOperation = 'destination-in';
      const a = k.g.createRadialGradient(D / 2, D / 2, D * 0.2, D / 2, D / 2, D / 2);
      a.addColorStop(0, 'rgba(0,0,0,1)'); a.addColorStop(0.7, 'rgba(0,0,0,0.85)'); a.addColorStop(1, 'rgba(0,0,0,0)');
      k.g.fillStyle = a; k.g.fillRect(0, 0, D, D);
      k.g.getImageData(0, 0, 1, 1); // throws on a tainted canvas (a cross-origin image): WebGL could not upload it
      out = tex(k.c);
    } catch { out = null; }
  }
  portraits.set(src, out);
  return out;
}
