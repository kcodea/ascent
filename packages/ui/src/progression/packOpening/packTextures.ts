/**
 * PACK OPENING: the placeholder pictures (spec §6, §11). Every texture the scene draws is painted ONCE per opening on a
 * 2D canvas, the way the prototype (docs/superpowers/specs/2026-11-23-pack-opening-prototype.html) does, and handed to
 * Pixi; nothing is redrawn per frame. Real pack art replaces these later (the scene only needs a canvas or image per
 * slot). Sizes are in canvas px at 2x the pack's base units (`PACK_GEOM`), so the scene draws them at scale 0.5.
 * Math.random is fine here (presentation only), but a tiny seeded PRNG keeps the grain identical between openings.
 */
import { COSMETIC_RARITIES, type CrateRarity, type PackLook } from '@game/progression';
import { PACK_GEOM } from './packGeom';
import { packRarityLabel } from './packRarity';

/** The pack's geometry in BASE units, derived from the wrapper art template (packGeom.ts). */
export { PACK_GEOM };

/** Canvas px per base unit. */
export const TEX_RES = 2;

type Ctx = CanvasRenderingContext2D;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: Ctx } {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d');
  if (!g) throw new Error('no 2d context');
  return { c, g };
}

/** Seeded mulberry32: the same grain every opening. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rr(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// ---------------------------------------------------------------- colours

/**
 * A rarity's colour (card backs, glow, gems): the game's rarity palette, the `.r-<rarity>` `--rc` tokens in styles.css,
 * so the Pixi backs and glows match the DOM faces. Ancient is its cyan; its glow carries the aurora (`ANCIENT_GLOW_STOPS`).
 */
export const PACK_RARITY_COLORS: Readonly<Record<CrateRarity, string>> = {
  common: '#cfd8e3', rare: '#6fb0ff', epic: '#c98bff', legendary: '#ffbe5c', ancient: '#8af5ff',
};

/** Ancient's aurora (styles.css `.r-ancient --rc-grad`): cyan to lilac to pink, painted into its glow texture. */
export const ANCIENT_GLOW_STOPS = ['#8af5ff', '#c9b8ff', '#ff7ae0'] as const;

/** A rarity's colour as a Pixi tint number. */
export const rarityTint = (r: CrateRarity): number => parseInt(PACK_RARITY_COLORS[r].slice(1), 16);

/** Gems on a rarity's back: Common 1 .. Ancient 5. */
export const rarityGems = (r: CrateRarity): number => COSMETIC_RARITIES.indexOf(r) + 1;

/** The foil: light edge, deep middle, light edge, plus an accent for the printing. */
export interface PackPalette { a: string; b: string; c: string; ink: string; accent: string }

const RARITY_FOIL: Readonly<Record<CrateRarity, PackPalette>> = {
  common: { a: '#41598c', b: '#1f2d50', c: '#5f80bb', ink: '#efe6c6', accent: '#e6c873' },
  rare: { a: '#3a6fb8', b: '#13305e', c: '#6aa4e6', ink: '#eef4ff', accent: '#9fd3ff' },
  epic: { a: '#6a3fa6', b: '#2b1352', c: '#9b6fd6', ink: '#f4eaff', accent: '#e0b8ff' },
  legendary: { a: '#a8701e', b: '#4a2c06', c: '#e0a640', ink: '#fff3d6', accent: '#ffe08a' },
  ancient: { a: '#6f7898', b: '#252a40', c: '#c9cfe6', ink: '#ffffff', accent: '#f4eeff' },
};

/** Which foil a pack wears: rarity packs by their floor, category packs teal, themed packs rose. */
export function packPalette(look: PackLook): PackPalette {
  if (look.kind === 'category') return { a: '#2f7f86', b: '#0f3438', c: '#5cc0c4', ink: '#eafcfa', accent: '#9ff0e6' };
  if (look.kind === 'themed') return { a: '#a8466e', b: '#45142c', c: '#e07aa2', ink: '#fff0f6', accent: '#ffc2da' };
  return RARITY_FOIL[look.guaranteedFloor];
}

const foil = (g: Ctx, w: number, h: number, p: PackPalette): CanvasGradient => {
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, p.a);
  gr.addColorStop(0.5, p.b);
  gr.addColorStop(1, p.c);
  return gr;
};

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = '"Segoe UI", system-ui, sans-serif';

// ---------------------------------------------------------------- the pack

/** The tear strip's printed front (the foil you peel). */
export function paintStrip(look: PackLook): HTMLCanvasElement {
  const p = packPalette(look);
  const { c, g } = canvas(PACK_GEOM.W * TEX_RES, PACK_GEOM.H * TEX_RES);
  const w = c.width, h = c.height;
  g.fillStyle = foil(g, w, h, p);
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,.22)';
  for (let x = 0; x < w; x += 12) g.fillRect(x, 0, 5, 22); // crimp
  const sh = g.createLinearGradient(0, 0, w, 0);
  sh.addColorStop(0.3, 'rgba(255,255,255,0)');
  sh.addColorStop(0.45, 'rgba(255,255,255,.25)');
  sh.addColorStop(0.6, 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.6)';
  g.setLineDash([10, 8]);
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(10, h - 10);
  g.lineTo(w - 10, h - 10);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(255,255,255,.78)';
  g.font = `bold 22px ${SANS}`;
  g.textBaseline = 'alphabetic';
  g.fillText('TEAR HERE  →', 24, 62);
  return c;
}

/** The strip's underside: brushed foil lining. */
export function paintStripBack(): HTMLCanvasElement {
  const { c, g } = canvas(PACK_GEOM.W * TEX_RES, PACK_GEOM.H * TEX_RES);
  const w = c.width, h = c.height;
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#d7dbe3');
  gr.addColorStop(1, '#b9bfcb');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  const r = prng(7);
  for (let n = 0; n < 1400; n++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '90,95,110'},${r() * 0.12})`;
    g.fillRect(r() * w, r() * h, 2 + r() * 6, 1);
  }
  return c;
}

/** Split a pack name into at most two printed lines. */
function nameLines(name: string): string[] {
  const words = name.toUpperCase().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return words.length ? words : ['PACK'];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

/** The sleeve's printed front (the pack body below the strip). */
export function paintBody(look: PackLook, cardCount: number): HTMLCanvasElement {
  const p = packPalette(look);
  const { c, g } = canvas(PACK_GEOM.W * TEX_RES, PACK_GEOM.BODY_H * TEX_RES);
  const w = c.width, h = c.height;
  g.fillStyle = foil(g, w, h, p);
  g.fillRect(0, 0, w, h);
  const sh = g.createLinearGradient(0, 0, w, h);
  sh.addColorStop(0.3, 'rgba(255,255,255,0)');
  sh.addColorStop(0.42, 'rgba(255,255,255,.22)');
  sh.addColorStop(0.55, 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,.22)';
  for (let x = 0; x < w; x += 12) g.fillRect(x, h - 22, 5, 22); // bottom crimp
  // a thin inner frame
  g.strokeStyle = p.accent;
  g.globalAlpha = 0.55;
  g.lineWidth = 3;
  rr(g, 22, 40, w - 44, h - 90, 18);
  g.stroke();
  g.globalAlpha = 1;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = p.ink;
  g.font = `bold 28px ${SERIF}`;
  g.fillText('A S C E N T', w / 2, 150);
  // the emblem: a four-point star in a ring
  g.save();
  g.translate(w / 2, 300);
  g.strokeStyle = p.accent;
  g.lineWidth = 4;
  g.beginPath();
  g.arc(0, 0, 78, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = p.accent;
  g.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2, rad = k % 2 ? 16 : 62;
    g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
  g.restore();
  g.fillStyle = p.ink;
  const lines = nameLines(look.name);
  g.font = `bold ${lines.some((l) => l.length > 9) ? 46 : 60}px ${SERIF}`;
  lines.forEach((l, i) => g.fillText(l, w / 2, 500 + i * 72, w - 60));
  g.font = `22px ${SANS}`;
  const floor = packRarityLabel(look.guaranteedFloor).toUpperCase();
  g.fillText(`${cardCount} CARD${cardCount === 1 ? '' : 'S'} · 1 GUARANTEED ${floor}+`, w / 2, 680, w - 50);
  return c;
}

/** A 1-px-tall gradient strip (the strip's shade and specular lookups). */
function grad1D(stops: readonly (readonly [number, string])[]): HTMLCanvasElement {
  const { c, g } = canvas(256, 2);
  const gr = g.createLinearGradient(0, 0, 256, 0);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 2);
  return c;
}

/** The strip's diffuse shade by surface angle (multiply). */
export const paintShade = (): HTMLCanvasElement => grad1D([
  [0, '#ffffff'], [0.12, '#f4f4f6'], [0.38, '#a0a0ac'], [0.5, '#6c6c78'], [0.62, '#a2a2ae'], [0.85, '#d2d2da'], [1, '#c4c4ce'],
]);

/** The strip's specular glints by surface angle (add). */
export const paintSpec = (): HTMLCanvasElement => grad1D([
  [0, '#000'], [0.17, '#000'], [0.25, '#fff4d6'], [0.33, '#000'], [0.7, '#000'], [0.79, '#5a5a5a'], [0.88, '#000'], [1, '#000'],
]);

/** A soft black blob (contact shadow). */
export function paintBlob(): HTMLCanvasElement {
  const { c, g } = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(0,0,0,.75)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/** One foil fleck (tinted per particle). */
export function paintFleck(): HTMLCanvasElement {
  const { c, g } = canvas(6, 3);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 6, 3);
  return c;
}

/** A soft white sheen band (the sealed pack's idle shimmer; opacity only). */
export function paintSheen(): HTMLCanvasElement {
  const { c, g } = canvas(PACK_GEOM.W * TEX_RES, PACK_GEOM.BODY_H * TEX_RES);
  const w = c.width, h = c.height;
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0.35, 'rgba(255,255,255,0)');
  gr.addColorStop(0.5, 'rgba(255,255,255,.28)');
  gr.addColorStop(0.65, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  return c;
}

/** The "pinch here" ring at the strip's corner (opacity pulse only). */
export function paintPinchRing(): HTMLCanvasElement {
  const { c, g } = canvas(96, 96);
  const gr = g.createRadialGradient(48, 48, 10, 48, 48, 46);
  gr.addColorStop(0, 'rgba(255,240,200,0)');
  gr.addColorStop(0.7, 'rgba(255,240,200,.9)');
  gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 96, 96);
  return c;
}

// ---------------------------------------------------------------- card backs

const CW = PACK_GEOM.CARD_W * TEX_RES, CH = PACK_GEOM.CARD_H * TEX_RES;

/**
 * THE CARD PLATE's geometry (owner 2026-11-23: "the card back and front should use that same gold frame"), as fractions
 * of the plate, measured on the 2048 x 3072 source (`packFaces.tsx` / `packOpening.css` use the same numbers):
 * - `PLATE_WINDOW`: the navy window the back's content (and the face's) sits in: x 130..1918, y 201..2910 at the
 *   shoulders (the notch lifts the centre to y 132); its corners round at about 14% of the plate's width.
 * - `PLATE_OUTER`: the plate's outer edge (x 64..1980, y 131..2975 at the shoulders): the glow and the shimmer's shape.
 */
export const PLATE_WINDOW = { l: 0.064, r: 0.064, t: 0.07, b: 0.053, radius: 0.13 } as const;
export const PLATE_OUTER = { l: 0.031, r: 0.033, t: 0.043, b: 0.032, radius: 0.09 } as const;

interface Box { x: number; y: number; w: number; h: number; r: number }
const box = (k: { l: number; r: number; t: number; b: number; radius: number }, w: number, h: number): Box => ({
  x: w * k.l, y: h * k.t, w: w * (1 - k.l - k.r), h: h * (1 - k.t - k.b), r: w * k.radius,
});
const WIN = box(PLATE_WINDOW, CW, CH);
const OUTER = box(PLATE_OUTER, CW, CH);

/** Diamond lattice over a back. */
function lattice(g: Ctx, w: number, h: number, alpha: number): void {
  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = '#fff';
  for (let y = 0; y < h; y += 36) {
    for (let x = (y / 36) % 2 ? 18 : 0; x < w; x += 36) {
      g.beginPath();
      g.moveTo(x, y - 9); g.lineTo(x + 9, y); g.lineTo(x, y + 9); g.lineTo(x - 9, y);
      g.fill();
    }
  }
  g.restore();
}

function star(g: Ctx, cx: number, cy: number, r: number, inner: number): void {
  g.beginPath();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 - Math.PI / 2, rad = k % 2 ? inner : r;
    g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.closePath();
}

/**
 * The plate behind a back: the owner's card plate once it has loaded (`plate`), or until then a plain gold frame in its
 * outer shape (the fallback, so a back is never blank). The caller then paints its content clipped to the window.
 */
function paintPlate(g: Ctx, plate: CanvasImageSource | undefined): void {
  g.clearRect(0, 0, CW, CH);
  if (plate) { g.drawImage(plate, 0, 0, CW, CH); return; }
  rr(g, OUTER.x, OUTER.y, OUTER.w, OUTER.h, OUTER.r);
  const gr = g.createLinearGradient(0, 0, CW, CH);
  gr.addColorStop(0, '#e6b45a');
  gr.addColorStop(0.5, '#8a5a18');
  gr.addColorStop(1, '#e6b45a');
  g.fillStyle = gr;
  g.fill();
}

/** Clip to the plate's window and fill it with a dark gradient (the back's ground). Pair with `g.restore()`. */
function openWindow(g: Ctx, from: string, to: string): void {
  g.save();
  rr(g, WIN.x, WIN.y, WIN.w, WIN.h, WIN.r);
  g.clip();
  const gr = g.createLinearGradient(WIN.x, WIN.y, WIN.x + WIN.w, WIN.y + WIN.h);
  gr.addColorStop(0, from);
  gr.addColorStop(1, to);
  g.fillStyle = gr;
  g.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
}

/** The art a back is painted with once it loads (both optional: the fallback paints without them). */
export interface BackArt { plate?: CanvasImageSource; icon?: CanvasImageSource }

const ctxOf = (into: HTMLCanvasElement | undefined): { c: HTMLCanvasElement; g: Ctx } =>
  (into ? { c: into, g: into.getContext('2d')! } : canvas(CW, CH));

/**
 * The plain pack-brand back: every card wears it until the result arrives. The card plate's gold frame, and inside its
 * window the pack's lattice and star. `into` repaints an existing canvas in place (the plate arrives after init).
 */
export function paintPlainBack(look: PackLook, art: BackArt = {}, into?: HTMLCanvasElement): HTMLCanvasElement {
  const p = packPalette(look);
  const { c, g } = ctxOf(into);
  paintPlate(g, art.plate);
  openWindow(g, '#1d2448', '#0c0f22');
  lattice(g, CW, CH, 0.07);
  g.lineWidth = 4;
  g.strokeStyle = 'rgba(201,168,90,.55)';
  rr(g, WIN.x + 14, WIN.y + 14, WIN.w - 28, WIN.h - 28, WIN.r - 10);
  g.stroke();
  g.fillStyle = p.accent;
  star(g, CW / 2, WIN.y + WIN.h / 2, 120, 30);
  g.fill();
  g.restore();
  return c;
}

/** The medallion's width on a back, as a fraction of the card width. */
export const BACK_ICON_FRAC = 0.55;

/**
 * A rarity's back, inside the card plate's window: its colour and its gem count (1-5) under the ASCENT star, or, once
 * `art.icon` (the rarity medallion) has loaded, the medallion centred over the tint instead of the star and gems. The
 * frame is the card plate once `art.plate` has loaded (a gold fallback until then). `into` repaints an existing canvas
 * in place (the scene swaps the art in when an image arrives, then re-uploads the texture).
 */
export function paintRarityBack(rarity: CrateRarity, art: BackArt = {}, into?: HTMLCanvasElement): HTMLCanvasElement {
  const col = PACK_RARITY_COLORS[rarity];
  const { c, g } = ctxOf(into);
  const icon = art.icon;
  paintPlate(g, art.plate);
  openWindow(g, '#1a1f3a', '#090b18');
  const cy = WIN.y + WIN.h / 2;
  // the rarity's wash from the middle
  const wash = g.createRadialGradient(CW / 2, cy, 20, CW / 2, cy, CH * 0.6);
  wash.addColorStop(0, col);
  wash.addColorStop(1, 'rgba(0,0,0,0)');
  g.globalAlpha = 0.42;
  g.fillStyle = wash;
  g.fillRect(0, 0, CW, CH);
  g.globalAlpha = 1;
  lattice(g, CW, CH, 0.06);
  // the rarity's own line inside the gold frame
  g.lineWidth = 6;
  g.strokeStyle = col;
  rr(g, WIN.x + 14, WIN.y + 14, WIN.w - 28, WIN.h - 28, WIN.r - 10);
  g.stroke();
  const n = icon ? 0 : rarityGems(rarity), gap = 54, y = cy + 150;
  if (icon) {
    const w = CW * BACK_ICON_FRAC;
    g.drawImage(icon, (CW - w) / 2, cy - w / 2 - 20, w, w);
  } else {
    g.fillStyle = col;
    star(g, CW / 2, cy - 40, 110, 28);
    g.fill();
  }
  // gems: one per rarity step, in a row under the star (the placeholder until the medallion loads)
  for (let k = 0; k < n; k++) {
    const x = CW / 2 + (k - (n - 1) / 2) * gap;
    g.beginPath();
    g.moveTo(x, y - 20); g.lineTo(x + 15, y); g.lineTo(x, y + 20); g.lineTo(x - 15, y);
    g.closePath();
    g.fillStyle = col;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255,255,255,.7)';
    g.stroke();
  }
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = col;
  g.font = `bold 40px ${SERIF}`;
  g.fillText(packRarityLabel(rarity).toUpperCase(), CW / 2, WIN.y + WIN.h - 56);
  g.restore();
  return c;
}

/** The guaranteed card's ribbon: "Guaranteed <floor>+", laid across the lower back. */
export function paintRibbon(floor: CrateRarity): HTMLCanvasElement {
  const w = CW * 0.92, h = 76;
  const { c, g } = canvas(w, h);
  const col = PACK_RARITY_COLORS[floor];
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w - 22, h / 2); g.lineTo(w, h); g.lineTo(0, h); g.lineTo(22, h / 2);
  g.closePath();
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#2a1d08');
  gr.addColorStop(1, '#120c03');
  g.fillStyle = gr;
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = col;
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = col;
  g.font = `bold 30px ${SERIF}`;
  g.fillText(`GUARANTEED ${packRarityLabel(floor).toUpperCase()}+`, w / 2, h / 2 + 2, w - 70);
  return c;
}

/**
 * Recolour a painted white glow with a diagonal gradient, keeping its alpha (source-in): Ancient's two-tone aurora.
 * Painted once; the sprite then wears it untinted.
 */
function recolour(g: Ctx, w: number, h: number, stops: readonly string[] | undefined): void {
  if (!stops || stops.length === 0) return;
  g.save();
  g.globalCompositeOperation = 'source-in';
  const gr = g.createLinearGradient(0, 0, w, h);
  stops.forEach((s, i) => gr.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), s));
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.restore();
}

/**
 * A soft plate-shaped glow at the card plate's outer edge, covering the card + a margin. White by default (tinted per
 * rarity, so one texture serves every rarity), or recoloured with `stops` (Ancient's aurora). The scene breathes only
 * its alpha (packGlow.ts tiers).
 */
export const CARD_GLOW_PAD = 40;
export function paintCardGlow(stops?: readonly string[]): HTMLCanvasElement {
  const pad = CARD_GLOW_PAD * TEX_RES;
  const { c, g } = canvas(CW + pad * 2, CH + pad * 2);
  g.shadowColor = 'rgba(255,255,255,1)';
  g.shadowBlur = pad * 0.9;
  g.fillStyle = 'rgba(255,255,255,.9)';
  rr(g, pad + OUTER.x, pad + OUTER.y, OUTER.w, OUTER.h, OUTER.r);
  g.fill();
  recolour(g, c.width, c.height, stops);
  return c;
}

/**
 * The sealed pack's aura: a soft glow around the whole pack (strip + body, W x (H + BODY_H)), painted ONCE. White
 * (tinted by the pack's rarity) or recoloured with `stops` (Ancient). Drawn at scale 1 / TEX_RES, anchored at its centre.
 */
export const PACK_GLOW_PAD = 56;
export function paintPackGlow(stops?: readonly string[]): HTMLCanvasElement {
  const pad = PACK_GLOW_PAD * TEX_RES;
  const pw = PACK_GEOM.W * TEX_RES, ph = (PACK_GEOM.H + PACK_GEOM.BODY_H) * TEX_RES;
  const { c, g } = canvas(pw + pad * 2, ph + pad * 2);
  g.shadowColor = 'rgba(255,255,255,1)';
  g.shadowBlur = pad * 0.85;
  g.fillStyle = 'rgba(255,255,255,.9)';
  rr(g, pad, pad, pw, ph, 14);
  g.fill();
  // a halo only: the pack's own box is cleared, so nothing shows through where the torn strip was
  g.shadowColor = 'transparent';
  g.shadowBlur = 0;
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  rr(g, pad, pad, pw, ph, 14);
  g.fill();
  g.globalCompositeOperation = 'source-over';
  recolour(g, c.width, c.height, stops);
  return c;
}

/** A flat white plate silhouette (the crossfade shimmer, added over the top card). */
export function paintCardFlash(): HTMLCanvasElement {
  const { c, g } = canvas(CW, CH);
  const gr = g.createLinearGradient(0, 0, CW, CH);
  gr.addColorStop(0, 'rgba(255,255,255,.15)');
  gr.addColorStop(0.5, 'rgba(255,255,255,.9)');
  gr.addColorStop(1, 'rgba(255,255,255,.15)');
  g.fillStyle = gr;
  rr(g, OUTER.x, OUTER.y, OUTER.w, OUTER.h, OUTER.r);
  g.fill();
  return c;
}

// ---------------------------------------------------------------- the wrapper art and the gloss

/**
 * Paint one horizontal slice of the pack's wrapper art into `into` (a strip or body canvas, W x hUnits at TEX_RES),
 * replacing the placeholder in place. The art is the whole pack (strip + body, the `packGeom.ts` template), so the
 * slice from `y0` (base units) down `hUnits` is mapped by the image's own height. The caller re-uploads the texture.
 */
export function paintArtSlice(img: CanvasImageSource & { width: number; height: number }, into: HTMLCanvasElement, y0: number, hUnits: number): void {
  const g = into.getContext('2d');
  if (!g) return;
  const total = PACK_GEOM.H + PACK_GEOM.BODY_H;
  const sy = img.height / total;
  g.clearRect(0, 0, into.width, into.height);
  g.drawImage(img, 0, y0 * sy, img.width, hUnits * sy, 0, 0, into.width, into.height);
}

/**
 * The gloss band (a glossy clear-coat's soft specular streak): a 1-D lookup across the band, u = 0.5 at its centre,
 * fully transparent at both ends (the mesh's u runs past them, so clamp-to-edge shows nothing). Its profile
 * `1 - 3.125 d^2` is what the strip's spec lookup produces under the same band (`glossStripU`, packTilt.ts), so the two
 * line up across the tear. Warm white, like the strip's glint. Painted once; moved and alpha-set only.
 */
export function paintGlossBand(): HTMLCanvasElement {
  const { c, g } = canvas(256, 2);
  const img = g.createImageData(256, 2);
  for (let x = 0; x < 256; x++) {
    const d = (x + 0.5) / 128 - 1;
    const a = Math.max(0, 1 - 3.125 * d * d);
    for (let y = 0; y < 2; y++) {
      const o = (y * 256 + x) * 4;
      img.data[o] = 255; img.data[o + 1] = 244; img.data[o + 2] = 214; img.data[o + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
