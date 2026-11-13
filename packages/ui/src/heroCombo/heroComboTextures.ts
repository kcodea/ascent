/**
 * The Combo attack's textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast / Arcana
 * set it reuses for a few glows, rings and streaks). The look is a 2D ARCADE FIGHTER: flat fills, hard dark outlines,
 * no soft shading for the HUD. The HIT EFFECTS are not painted pictures: they are built live from white light shapes
 * (tinted per tier, additive):
 *  - BLADE: a long thin spindle of light with a soft glow (crossing hit blades, radial speed lines, strike trails).
 *  - PUFF: a soft three-lobed dust cloud (no outline), tinted the dust colour.
 *  - DIZZY STAR: a plump five-point star of light with a soft glow (the birds round a dizzy head).
 * And the HUD, painted in its own colours (the sprites draw them untinted):
 *  - ARROW and BUTTON: the input glyphs (a chunky yellow arrow, turned to point; a round red attack button).
 *  - BAND: the super cut-in's band (navy, a halftone fade, white and gold rails).
 *  - DIGITS 0-9, HIT, HITS: the combo counter's heavy italic numerals (white to gold, a dark outline, a flat shadow).
 *  - K.O., COUNTER, PERFECT, BREAKER?: the call-outs (heavy italic lettering, a white inline, a dark outline, a flat
 *    shadow), each in its tier's colours. They are brought to life by the scene (a slam, a shake, afterimages, a glint).
 *  - CUT-IN: the striking hero's own portrait art, cropped into a slanted panel with a white rail (per image, cached).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroComboTextures } from './heroComboScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

export const BLADE_W = 256;
export const BLADE_H = 32;
export const GLYPH_PX = 112;
export const BAND_W = 512;
export const BAND_H = 128;
export const PUFF_PX = 96;
export const DIGIT_W = 96;
export const DIGIT_H = 128;
export const LABEL_W = 256;
export const LABEL_H = 96;
export const KO_W = 512;
export const KO_H = 224;
export const WORD_W = 640;
export const WORD_H = 176;
export const CUTIN_W = 448;
export const CUTIN_H = 288;
/** How far the cut-in panel's sides lean (px of the texture): the parallelogram's slant. */
export const CUTIN_SLANT = 64;

const INK = '#1a0f1f';
const FONT = 'Impact, "Arial Black", "Helvetica Neue", sans-serif';

/** A spindle of light pointing +x: a hot white middle, tapering to points at both ends, a soft glow round it. */
function paintBlade(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const spindle = (half: number): void => {
    g.beginPath();
    g.moveTo(2, H / 2);
    g.quadraticCurveTo(W * 0.4, H / 2 - half, W - 2, H / 2);
    g.quadraticCurveTo(W * 0.4, H / 2 + half, 2, H / 2);
    g.closePath();
  };
  g.fillStyle = 'rgba(255,255,255,0.28)'; spindle(H * 0.48); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.55)'; spindle(H * 0.3); g.fill();
  g.fillStyle = '#ffffff'; spindle(H * 0.16); g.fill();
  return k.c;
}

/** A dizzy star: a plump five-point star of white light with a soft glow round it (tinted by the sprite). */
function paintDizzyStar(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const glow = g.createRadialGradient(c, c, 0, c, c, c);
  glow.addColorStop(0, 'rgba(255,255,255,0.55)'); glow.addColorStop(0.5, 'rgba(255,255,255,0.18)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, D, D);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? D * 0.17 : D * 0.36;
    if (i === 0) g.moveTo(c + Math.cos(a) * r, c + Math.sin(a) * r); else g.lineTo(c + Math.cos(a) * r, c + Math.sin(a) * r);
  }
  g.closePath();
  g.lineJoin = 'round'; g.lineWidth = D * 0.06; g.strokeStyle = '#ffffff'; g.stroke();
  g.fillStyle = '#ffffff'; g.fill();
  return k.c;
}

/** An input arrow pointing +x: flat yellow, a dark outline (the sprite turns it to point). */
function paintArrow(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(c - D * 0.36, c - D * 0.13); g.lineTo(c + D * 0.02, c - D * 0.13); g.lineTo(c + D * 0.02, c - D * 0.33);
  g.lineTo(c + D * 0.38, c); g.lineTo(c + D * 0.02, c + D * 0.33); g.lineTo(c + D * 0.02, c + D * 0.13); g.lineTo(c - D * 0.36, c + D * 0.13);
  g.closePath();
  g.strokeStyle = INK; g.lineWidth = D * 0.12; g.stroke();
  g.strokeStyle = '#ffffff'; g.lineWidth = D * 0.05; g.stroke();
  g.fillStyle = '#ffd21f'; g.fill();
  return k.c;
}

/** The round attack button: flat red, a pale crescent, a dark rim. */
function paintButton(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2, r = D * 0.38;
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2);
  g.fillStyle = '#e8321e'; g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = D * 0.1; g.stroke();
  g.strokeStyle = INK; g.lineWidth = D * 0.04;
  g.beginPath(); g.arc(c, c, r + D * 0.06, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(c, c, r - D * 0.045, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#ff9d8c'; g.lineWidth = D * 0.06; g.lineCap = 'round';
  g.beginPath(); g.arc(c, c, r * 0.58, Math.PI * 1.08, Math.PI * 1.55); g.stroke();
  return k.c;
}

/** The cut-in band: flat navy, a halftone fade rising from the bottom, white and gold rails top and bottom. */
function paintBand(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  g.fillStyle = '#131c3a'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#22336b';
  for (let row = 0; row < 7; row++) {
    const y = H - 14 - row * 12;
    const r = 5.2 - row * 0.7;
    if (r <= 0.6) break;
    for (let x = (row % 2) * 6; x < W; x += 12) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  }
  for (const [y, h, col] of [[0, 4, INK], [4, 7, '#ffffff'], [11, 4, '#ffcf3f'], [H - 15, 4, '#ffcf3f'], [H - 11, 7, '#ffffff'], [H - 4, 4, INK]] as const) {
    g.fillStyle = col; g.fillRect(0, y, W, h);
  }
  return k.c;
}

/** A soft dust cloud: three overlapping soft lobes, white (tinted by the sprite), no outline. */
function paintPuff(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const lobes: [number, number, number][] = [[0.38, 0.56, 0.24], [0.62, 0.58, 0.26], [0.5, 0.4, 0.26]];
  for (const [x, y, r] of lobes) {
    const gr = g.createRadialGradient(x * D, y * D, 0, x * D, y * D, r * D);
    gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, D, D);
  }
  return k.c;
}

/** Heavy italic arcade lettering: a flat shadow, a dark outline, a vertical gradient, an optional white inline. */
function paintText(text: string, W: number, H: number, stops: readonly string[], o: { size?: number; inline?: boolean; align?: 'left' | 'center' } = {}): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  let size = Math.round(H * (o.size ?? 0.78));
  const font = (): string => `italic 900 ${size}px ${FONT}`;
  g.font = font();
  const max = W * 0.86;
  const w = g.measureText(text).width;
  if (w > max) { size = Math.floor(size * (max / w)); g.font = font(); }
  g.textAlign = o.align ?? 'center'; g.textBaseline = 'middle';
  const x = o.align === 'left' ? size * 0.16 : W / 2 - size * 0.03, y = H / 2 + size * 0.03;
  const lw = Math.max(6, size * 0.15);
  g.lineJoin = 'round';
  // The flat shadow (down and right), then the outline.
  g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = lw;
  g.strokeText(text, x + size * 0.06, y + size * 0.07); g.fillText(text, x + size * 0.06, y + size * 0.07);
  g.strokeText(text, x, y);
  if (o.inline) { g.strokeStyle = '#ffffff'; g.lineWidth = lw * 0.42; g.strokeText(text, x, y); }
  const gr = g.createLinearGradient(0, y - size * 0.42, 0, y + size * 0.42);
  stops.forEach((s, i) => gr.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, s));
  g.fillStyle = gr; g.fillText(text, x, y);
  return k.c;
}

const DIGIT_STOPS = ['#ffffff', '#fff3a8', '#ffc21f', '#ff8a1f'] as const;
const LABEL_STOPS = ['#ffffff', '#cfe6ff', '#7fb8ff'] as const;
const KO_STOPS = ['#fff7a0', '#ffd21f', '#ff7a1f', '#e8321e'] as const;
const COUNTER_STOPS = ['#ffffff', '#c9f6ff', '#5fe3ff', '#1f8fff'] as const;
const PERFECT_STOPS = ['#ffffff', '#fff3a8', '#ffd21f', '#ff9a1f'] as const;
const BREAKER_STOPS = ['#ffffff', '#ffe0f6', '#ff8ad8', '#c23fff'] as const;

let cached: HeroComboTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroComboTextures(): HeroComboTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const parts = {
    blade: paintBlade(BLADE_W, BLADE_H),
    dizzyStar: paintDizzyStar(64),
    arrow: paintArrow(GLYPH_PX),
    button: paintButton(GLYPH_PX),
    band: paintBand(BAND_W, BAND_H),
    dust: paintPuff(PUFF_PX),
    labelHit: paintText('HIT', LABEL_W, LABEL_H, LABEL_STOPS, { align: 'left' }),
    labelHits: paintText('HITS', LABEL_W, LABEL_H, LABEL_STOPS, { align: 'left' }),
    wordKo: paintText('K.O.', KO_W, KO_H, KO_STOPS, { size: 0.8, inline: true }),
    wordCounter: paintText('COUNTER', WORD_W, WORD_H, COUNTER_STOPS, { size: 0.74, inline: true }),
    wordPerfect: paintText('PERFECT', WORD_W, WORD_H, PERFECT_STOPS, { size: 0.74, inline: true }),
    wordBreaker: paintText('BREAKER?', WORD_W, WORD_H, BREAKER_STOPS, { size: 0.74, inline: true }),
  };
  const digits = Array.from({ length: 10 }, (_, i) => paintText(String(i), DIGIT_W, DIGIT_H, DIGIT_STOPS, { size: 0.84 }));
  if (!base || Object.values(parts).some((p) => !p) || digits.some((d) => !d)) return null;
  const made = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, tex(v!)])) as { [K in keyof typeof parts]: Texture };
  const [d0, d1, d2, d3, d4, d5, d6, d7, d8, d9] = digits.map((d) => tex(d!));
  cached = { ...base, ...made, d0: d0!, d1: d1!, d2: d2!, d3: d3!, d4: d4!, d5: d5!, d6: d6!, d7: d7!, d8: d8!, d9: d9! };
  return cached;
}

const cutins = new Map<string, Texture | null>();

/**
 * The striking hero's portrait art as the super's CUT-IN PANEL: cover-fitted into a slanted panel (its upper part, where
 * a face is) with a white rail and a dark outline. Painted once per image src and cached. Null when there is no image, it
 * has not loaded, or the canvas cannot read it back (the cut-in then shows the band, the speed lines and the inputs only).
 */
export function comboCutinTexture(img: HTMLImageElement | null | undefined): Texture | null {
  if (!img || typeof document === 'undefined') return null;
  const src = img.currentSrc || img.src;
  if (!src) return null;
  if (cutins.has(src)) return cutins.get(src) ?? null;
  if (!img.complete || !(img.naturalWidth > 0)) return null; // not loaded yet: try again on the next attack
  const k = canvas(CUTIN_W, CUTIN_H);
  let out: Texture | null = null;
  if (k) {
    try {
      const g = k.g;
      const m = 10, W = CUTIN_W, H = CUTIN_H, S = CUTIN_SLANT;
      const panel = (): void => { g.beginPath(); g.moveTo(S + m, m); g.lineTo(W - m, m); g.lineTo(W - S - m, H - m); g.lineTo(m, H - m); g.closePath(); };
      g.save();
      panel(); g.clip();
      g.fillStyle = '#131c3a'; g.fillRect(0, 0, W, H);
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      g.drawImage(img, (W - w) / 2, (H - h) * 0.22, w, h);
      g.restore();
      g.lineJoin = 'miter';
      panel(); g.strokeStyle = INK; g.lineWidth = 16; g.stroke();
      panel(); g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.stroke();
      g.getImageData(0, 0, 1, 1); // throws on a tainted canvas (a cross-origin image): WebGL could not upload it
      out = tex(k.c);
    } catch { out = null; }
  }
  cutins.set(src, out);
  return out;
}
