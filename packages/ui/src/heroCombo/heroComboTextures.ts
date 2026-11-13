/**
 * The Combo attack's textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast / Arcana
 * set it reuses for a few glows, rings and streaks). The look is a 2D ARCADE FIGHTER: flat fills, hard dark outlines,
 * no soft shading. Everything is painted in its own colours (the sprites draw them untinted):
 *  - HIT SPARKS: three chunky starbursts in flat layers (a dark outline, a colour, a paler colour, a white core): the
 *    LIGHT one (yellow), the SHARP one (a blue cross flash) and the HEAVY one (red and orange, more points).
 *  - FIST: a flat white cartoon fist (four knuckles, a thumb), one facing each way: the jab's and the heavy blow's spark.
 *  - ARROW and BUTTON: the input glyphs (a chunky yellow arrow, turned to point; a round red attack button).
 *  - BAND: the super cut-in's band (navy, a halftone fade, white and gold rails).
 *  - PUFF: a flat cel dust puff (the launch, the slam).
 *  - DIGITS 0-9, HIT, HITS: the combo counter's heavy italic numerals (white to gold, a dark outline, a flat shadow).
 *  - K.O.: the knockout word (yellow to red, a white inline, a dark outline, a flat shadow).
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

export const SPARK_PX = 256;
export const FIST_PX = 160;
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
export const CUTIN_W = 448;
export const CUTIN_H = 288;
/** How far the cut-in panel's sides lean (px of the texture): the parallelogram's slant. */
export const CUTIN_SLANT = 64;

const INK = '#1a0f1f';
const FONT = 'Impact, "Arial Black", "Helvetica Neue", sans-serif';

/** A starburst outline: `n` points, every other one at `inner`, the long ones a touch uneven (never random). */
function star(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number, inner: number, uneven: number, turn = 0): void {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2 + turn;
    const long = 1 - uneven * (0.5 + 0.5 * Math.sin(i * 2.7 + 1.3));
    const rr = r * (i % 2 ? inner : long);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

/** A flat, layered hit spark: outline, colour, paler colour, white core. */
function paintSpark(D: number, n: number, inner: number, uneven: number, outer: string, mid: string, cross = false): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2, R = D / 2 - 8;
  g.lineJoin = 'miter'; g.miterLimit = 3;
  const layer = (r: number, fill: string, turn: number, outline = 0): void => {
    if (cross) {
      // The sharp one: four long blades and four short, a cross flash.
      g.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + turn;
        const rr = r * (i % 2 ? 0.2 : i % 4 === 0 ? 1 : 0.52);
        const x = c + Math.cos(a) * rr, y = c + Math.sin(a) * rr;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath();
    } else star(g, c, c, r, n, inner, uneven, turn);
    if (outline) { g.strokeStyle = INK; g.lineWidth = outline; g.stroke(); }
    g.fillStyle = fill; g.fill();
  };
  layer(R, outer, 0, 10);
  layer(R * 0.7, mid, cross ? 0 : 0.16);
  layer(R * 0.4, '#ffffff', cross ? 0 : 0.3);
  return k.c;
}

/** A flat cartoon fist punching toward +x (`flip`: toward -x). */
function paintFist(D: number, flip: boolean): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  if (flip) { g.translate(D, 0); g.scale(-1, 1); }
  const s = D / 160;
  g.lineJoin = 'round'; g.lineCap = 'round';
  const body = (): void => {
    // The cuff, the back of the hand, four knuckles down the front.
    g.beginPath();
    g.moveTo(22 * s, 52 * s);
    g.lineTo(84 * s, 40 * s);
    for (let i = 0; i < 4; i++) {
      const y0 = (36 + i * 23) * s, y1 = (36 + (i + 1) * 23) * s;
      g.bezierCurveTo((128 + (i === 1 || i === 2 ? 14 : 4)) * s, y0, (128 + (i === 1 || i === 2 ? 14 : 4)) * s, y1, 96 * s, y1);
      if (i < 3) g.lineTo(100 * s, y1);
    }
    g.lineTo(60 * s, 132 * s);
    g.quadraticCurveTo(26 * s, 128 * s, 22 * s, 104 * s);
    g.closePath();
  };
  body();
  g.strokeStyle = INK; g.lineWidth = 10 * s; g.stroke();
  g.fillStyle = '#ffffff'; g.fill();
  // A flat shade along the bottom, the finger lines and the thumb folded across.
  g.save(); body(); g.clip();
  g.fillStyle = '#c9d3ea'; g.fillRect(0, 108 * s, D, D);
  g.restore();
  g.strokeStyle = INK; g.lineWidth = 5 * s;
  for (let i = 1; i < 4; i++) { const y = (36 + i * 23) * s; g.beginPath(); g.moveTo(74 * s, y); g.lineTo(104 * s, y); g.stroke(); }
  g.beginPath();
  g.moveTo(40 * s, 84 * s); g.quadraticCurveTo(62 * s, 70 * s, 82 * s, 82 * s); g.quadraticCurveTo(88 * s, 98 * s, 70 * s, 104 * s); g.quadraticCurveTo(52 * s, 104 * s, 40 * s, 84 * s);
  g.closePath();
  g.fillStyle = '#eef2fb'; g.fill(); g.stroke();
  // The cuff's band.
  g.lineWidth = 6 * s;
  g.beginPath(); g.moveTo(34 * s, 54 * s); g.lineTo(32 * s, 122 * s); g.stroke();
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

/** A flat cel dust puff: three lobes, a pale top, a dark outline. */
function paintPuff(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const lobes: [number, number, number][] = [[0.36, 0.56, 0.26], [0.62, 0.58, 0.28], [0.5, 0.38, 0.27]];
  const blob = (grow: number): void => { g.beginPath(); for (const [x, y, r] of lobes) { g.moveTo(x * D + r * D + grow, y * D); g.arc(x * D, y * D, r * D + grow, 0, Math.PI * 2); } };
  blob(4); g.fillStyle = INK; g.fill();
  blob(0); g.fillStyle = '#d9d2c4'; g.fill();
  g.save(); blob(0); g.clip();
  g.fillStyle = '#ffffff';
  g.beginPath(); for (const [x, y, r] of lobes) { g.moveTo(x * D - 4 + r * D, y * D - 7); g.arc(x * D - 4, y * D - 7, r * D * 0.92, 0, Math.PI * 2); } g.fill();
  g.restore();
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

let cached: HeroComboTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroComboTextures(): HeroComboTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const parts = {
    hitLight: paintSpark(SPARK_PX, 9, 0.46, 0.3, '#ff8a1f', '#ffe14a'),
    hitSharp: paintSpark(SPARK_PX, 8, 0.3, 0, '#2f8fff', '#bfeaff', true),
    hitHeavy: paintSpark(SPARK_PX, 13, 0.52, 0.34, '#e8321e', '#ffb01f'),
    fistR: paintFist(FIST_PX, false),
    fistL: paintFist(FIST_PX, true),
    arrow: paintArrow(GLYPH_PX),
    button: paintButton(GLYPH_PX),
    band: paintBand(BAND_W, BAND_H),
    dust: paintPuff(PUFF_PX),
    labelHit: paintText('HIT', LABEL_W, LABEL_H, LABEL_STOPS, { align: 'left' }),
    labelHits: paintText('HITS', LABEL_W, LABEL_H, LABEL_STOPS, { align: 'left' }),
    wordKo: paintText('K.O.', KO_W, KO_H, KO_STOPS, { size: 0.8, inline: true }),
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
