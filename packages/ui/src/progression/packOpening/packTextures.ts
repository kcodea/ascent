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
  // crumpled facets: soft light and dark patches between fold lines
  for (let n = 0; n < 26; n++) {
    const x = r() * w, y = r() * h, rad = 26 + r() * 60;
    const fg = g.createRadialGradient(x, y, 0, x, y, rad);
    const light = r() < 0.5;
    fg.addColorStop(0, light ? 'rgba(255,255,255,.3)' : 'rgba(70,78,98,.26)');
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fg;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // fold lines: a dark crease with a bright edge beside it
  g.lineCap = 'round';
  for (let n = 0; n < 22; n++) {
    let x = r() * w, y = r() * h;
    const pts = [[x, y]];
    const ang = r() * Math.PI * 2;
    for (let s2 = 0; s2 < 3; s2++) { x += Math.cos(ang + (r() - 0.5) * 1.1) * (22 + r() * 46); y += Math.sin(ang + (r() - 0.5) * 1.1) * (14 + r() * 30); pts.push([x, y]); }
    for (const [dx, col, lw] of [[0, 'rgba(60,66,84,.5)', 1.6], [1.6, 'rgba(255,255,255,.75)', 1.1]] as [number, string, number][]) {
      g.strokeStyle = col; g.lineWidth = lw;
      g.beginPath();
      pts.forEach((pt, i) => (i ? g.lineTo(pt[0]! + dx, pt[1]! + dx) : g.moveTo(pt[0]! + dx, pt[1]! + dx)));
      g.stroke();
    }
  }
  // a bright sheen band across it
  const sg = g.createLinearGradient(0, 0, w, h * 3);
  sg.addColorStop(0.3, 'rgba(255,255,255,0)');
  sg.addColorStop(0.46, 'rgba(255,255,255,.5)');
  sg.addColorStop(0.6, 'rgba(255,255,255,0)');
  g.fillStyle = sg;
  g.fillRect(0, 0, w, h);
  // the heat-sealed crimp along its top edge
  for (let x = 0; x < w; x += 6) { g.fillStyle = x % 12 ? 'rgba(255,255,255,.35)' : 'rgba(70,76,96,.3)'; g.fillRect(x, 0, 3, h * 0.2); }
  return c;
}

/**
 * THE PACK'S INSIDE behind the tear strip (owner 2026-11-24: peeling the top must not leave a see-through band, and not a
 * flat block of colour either): the wrapper's inner foil, shaded as the inside of a pack (darker toward the opening's
 * floor), cut to the STRIP'S OWN SILHOUETTE (`strip`, the painted front: its alpha, crimped teeth included), so sealed it
 * hides exactly behind the strip and peeled it reads as the pack's far wall. `into` repaints in place (the wrapper art
 * arrives after init and changes the silhouette).
 */
export function paintStripInside(strip: HTMLCanvasElement, into?: HTMLCanvasElement): HTMLCanvasElement {
  const c = into ?? canvas(strip.width, strip.height).c;
  const g = c.getContext('2d');
  if (!g) return c;
  const w = c.width, h = c.height;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#8b91a0');
  gr.addColorStop(0.55, '#6c7281');
  gr.addColorStop(1, '#3d414d');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  const r = prng(11);
  for (let n = 0; n < 900; n++) {
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '20,22,30'},${r() * 0.1})`;
    g.fillRect(r() * w, r() * h, 2 + r() * 6, 1);
  }
  // a soft shadow under the top seal and at the sides: the wall curves away from the light
  const side = g.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, 'rgba(0,0,0,.4)');
  side.addColorStop(0.12, 'rgba(0,0,0,0)');
  side.addColorStop(0.88, 'rgba(0,0,0,0)');
  side.addColorStop(1, 'rgba(0,0,0,.4)');
  g.fillStyle = side;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(strip, 0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
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

/** One spark (tinted per particle, drawn additively): a hot core in a soft glow. */
export function paintFleck(): HTMLCanvasElement {
  const { c, g } = canvas(32, 32);
  const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.16, 'rgba(255,255,255,.95)');
  gr.addColorStop(0.4, 'rgba(255,255,255,.3)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 32, 32);
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

/** The logo's width on the card back, as a share of the plate's window. */
export const BACK_LOGO_W = 0.5;
/** The logo on the back in card BASE units: its width, and how far below the card's centre the window's centre sits. */
export const BACK_LOGO = { w: PACK_GEOM.CARD_W * (1 - PLATE_WINDOW.l - PLATE_WINDOW.r) * BACK_LOGO_W, dy: PACK_GEOM.CARD_H * (PLATE_WINDOW.t - PLATE_WINDOW.b) / 2 } as const;

/** The art a back is painted with once it loads (both optional: the fallback paints without them). */
export interface BackArt { plate?: CanvasImageSource; icon?: CanvasImageSource; window?: CanvasImageSource }

const ctxOf = (into: HTMLCanvasElement | undefined): { c: HTMLCanvasElement; g: Ctx } =>
  (into ? { c: into, g: into.getContext('2d')! } : canvas(CW, CH));

/**
 * THE CARD BACK: every card wears it, before and after the result arrives (owner 2026-11-24: the back never tells the
 * rarity; the tease and then the face do). The neutral reveal frame (`art.plate`), and inside its window the Ascent
 * logo (`art.icon`). `into` repaints an existing canvas in place (the plate arrives after init).
 */
export function paintPlainBack(look: PackLook, art: BackArt = {}, into?: HTMLCanvasElement): HTMLCanvasElement {
  const { c, g } = ctxOf(into);
  paintPlate(g, art.plate);
  // The ground fills the plate's REAL window (its raised notch and stepped corners), cut with the window's own mask
  // (owner 2026-11-25: "make this section perfectly matched with the frame border"; a rounded box left the notch bare).
  // No inner line (same ask). Until the mask has loaded, the rounded box stands in.
  if (art.window) {
    const { c: wc, g: wg } = canvas(CW, CH);
    const gr = wg.createLinearGradient(WIN.x, WIN.y, WIN.x + WIN.w, WIN.y + WIN.h);
    gr.addColorStop(0, '#1d2448');
    gr.addColorStop(1, '#0c0f22');
    wg.fillStyle = gr;
    wg.fillRect(0, 0, CW, CH);
    wg.globalCompositeOperation = 'destination-in';
    wg.drawImage(art.window, 0, 0, CW, CH);
    g.drawImage(wc, 0, 0);
    g.save();
  } else openWindow(g, '#1d2448', '#0c0f22');
  // the Ascent logo, alone on the ground (owner 2026-11-25: "remove the icon and the pattern from the card back. use the
  // Ascent Logo instead"); until its image has loaded the window is plain
  const logo = art.icon as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  if (logo) {
    const lw = Number(logo.width) || 1, lh = Number(logo.height) || 1;
    const w = WIN.w * BACK_LOGO_W, h = w * (lh / lw), cx = CW / 2, cy = WIN.y + WIN.h / 2;
    const halo = g.createRadialGradient(cx, cy, 0, cx, cy, w * 1.25);
    halo.addColorStop(0, 'rgba(255,214,120,.09)');
    halo.addColorStop(0.5, 'rgba(255,214,120,.035)');
    halo.addColorStop(1, 'rgba(255,214,120,0)');
    g.fillStyle = halo;
    g.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
    g.drawImage(logo, cx - w / 2, cy - h / 2, w, h);
  }
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
  // the solid source of the halo sits a little INSIDE the pack's box (under the art), so only its soft falloff shows
  // outside the wrapper, never a flat pale border
  const tuck = 7 * TEX_RES;
  rr(g, pad + tuck, pad + tuck, pw - tuck * 2, ph - tuck * 2, 14);
  g.fill();
  // a halo only: the pack's middle is cleared, so no slab of glow shows where the torn strip was. The hole is INSET and
  // SOFT-EDGED (owner 2026-11-24: "why does the card area have a dark hard line shadow around it?"): a hole cut exactly
  // on the pack's box showed the stage through the wrapper's see-through crimps and past its tilted edges, as a dark
  // hard-edged frame. The glow now runs on under the pack's edges and fades out well inside them.
  const inset = 16 * TEX_RES;
  g.shadowColor = '#000';
  g.shadowBlur = 12 * TEX_RES;
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = '#000';
  rr(g, pad + inset, pad + inset, pw - inset * 2, ph - inset * 2, 14);
  g.fill();
  g.shadowColor = 'transparent';
  g.shadowBlur = 0;
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

// ---------------------------------------------------------------- the big-pull burst (bigPull.ts)

/** The burst textures' side (canvas px); the scene scales the sprites to the tier's size. */
export const BURST_TEX = 512;

/** The big-pull burst's soft bloom: a white radial falloff (tinted per rarity), painted once. */
export function paintBurstBloom(): HTMLCanvasElement {
  const { c, g } = canvas(BURST_TEX, BURST_TEX);
  const r = BURST_TEX / 2;
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,.75)');
  gr.addColorStop(0.45, 'rgba(255,255,255,.28)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, BURST_TEX, BURST_TEX);
  return c;
}

/**
 * The big-pull burst's ring of god rays: `n` thin white wedges from the centre, evenly spaced with a fixed alternating
 * length (deterministic, no randomness), faded toward the tips and clear at the very centre (the bloom fills it).
 */
export function paintBurstRays(n: number): HTMLCanvasElement {
  const { c, g } = canvas(BURST_TEX, BURST_TEX);
  const r = BURST_TEX / 2;
  const rays = Math.max(1, Math.round(n));
  const half = (Math.PI / rays) * 0.28;
  g.translate(r, r);
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const len = r * (i % 2 ? 0.78 : 1);
    g.beginPath();
    g.moveTo(0, 0);
    g.arc(0, 0, len, a - half, a + half);
    g.closePath();
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, len);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.12, 'rgba(255,255,255,.9)');
    gr.addColorStop(0.5, 'rgba(255,255,255,.4)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fill();
  }
  return c;
}
