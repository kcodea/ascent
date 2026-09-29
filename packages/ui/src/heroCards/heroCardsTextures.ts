/**
 * Card Shark's textures, painted ONCE per session on 2D canvases and kept (about 580 KB of GPU memory on top of the
 * Blast and Arcana basics, which it shares). Plain suits and letters only: no card art is copied.
 *
 * A CARD is 96 x 134 (a poker card's 5:7), rounded corners. The FACES are painted near white with their ink baked in
 * (black spades, red hearts and diamonds), so the scene tints them ivory at rest and GOLD for the royal flush: the paper
 * turns gold and the black ink stays black. The BACK is painted in its own colours (an ivory border round a red field
 * with a fine lattice and a ring in the middle), never tinted. The card GLOW is the silhouette blurred; the card FLASH is
 * the silhouette solid (additive, for the snap and the gilding). CONFETTI is a small rounded chip and the four suit pips.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { CardFace } from './heroCardsConfig';
import type { HeroCardsTextures } from './heroCardsScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** The card box. The glow and the flash are painted on a padded box (GLOW_PAD each side) with the card in the middle. */
export const CARD_W = 96;
export const CARD_H = 134;
export const CARD_R = 9;
export const GLOW_PAD = 14;

export type Suit = 'S' | 'H' | 'D' | 'C';
const INK_BLACK = '#1b1620';
const INK_RED = '#c8203a';

function cardPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** A suit pip centred on (x, y), `s` = its height. Pure paths (no font glyphs). */
export function drawPip(g: CanvasRenderingContext2D, suit: Suit, x: number, y: number, s: number): void {
  const h = s / 2;
  g.beginPath();
  if (suit === 'D') {
    g.moveTo(x, y - h); g.lineTo(x + h * 0.72, y); g.lineTo(x, y + h); g.lineTo(x - h * 0.72, y); g.closePath();
  } else if (suit === 'H') {
    g.moveTo(x, y + h);
    g.bezierCurveTo(x - h * 0.3, y + h * 0.55, x - h, y + h * 0.1, x - h, y - h * 0.35);
    g.bezierCurveTo(x - h, y - h * 0.95, x - h * 0.15, y - h * 1.05, x, y - h * 0.5);
    g.bezierCurveTo(x + h * 0.15, y - h * 1.05, x + h, y - h * 0.95, x + h, y - h * 0.35);
    g.bezierCurveTo(x + h, y + h * 0.1, x + h * 0.3, y + h * 0.55, x, y + h);
    g.closePath();
  } else if (suit === 'S') {
    // An upside-down heart with a flared stem.
    const cy = y - h * 0.12;
    g.moveTo(x, cy - h * 0.88);
    g.bezierCurveTo(x - h * 0.3, cy - h * 0.45, x - h, cy - h * 0.05, x - h, cy + h * 0.38);
    g.bezierCurveTo(x - h, cy + h * 0.85, x - h * 0.2, cy + h * 0.95, x, cy + h * 0.45);
    g.bezierCurveTo(x + h * 0.2, cy + h * 0.95, x + h, cy + h * 0.85, x + h, cy + h * 0.38);
    g.bezierCurveTo(x + h, cy - h * 0.05, x + h * 0.3, cy - h * 0.45, x, cy - h * 0.88);
    g.closePath();
    g.moveTo(x - h * 0.09, cy + h * 0.5); g.lineTo(x - h * 0.34, y + h); g.lineTo(x + h * 0.34, y + h); g.lineTo(x + h * 0.09, cy + h * 0.5); g.closePath();
  } else {
    const r = h * 0.42;
    g.moveTo(x + r, y - h * 0.45); g.arc(x, y - h * 0.45, r, 0, Math.PI * 2);
    g.moveTo(x - h * 0.42 + r, y + h * 0.08); g.arc(x - h * 0.42, y + h * 0.08, r, 0, Math.PI * 2);
    g.moveTo(x + h * 0.42 + r, y + h * 0.08); g.arc(x + h * 0.42, y + h * 0.08, r, 0, Math.PI * 2);
    g.moveTo(x - h * 0.1, y); g.lineTo(x - h * 0.34, y + h); g.lineTo(x + h * 0.34, y + h); g.lineTo(x + h * 0.1, y); g.closePath();
  }
  g.fill();
}

const RANK: Record<string, string> = { A: 'A', K: 'K', Q: 'Q', J: 'J', T: '10' };
const SERIF = 'Georgia, "Times New Roman", serif';

/** The rank and the small pip in a corner (painted top left; the bottom right is the same turned round). */
function cornerIndex(g: CanvasRenderingContext2D, rank: string, suit: Suit): void {
  g.font = `bold ${rank.length > 1 ? 17 : 19}px ${SERIF}`;
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.fillText(rank, 13, 23);
  drawPip(g, suit, 13, 33, 11);
}

/** The ten's pips: two columns of four and two in the middle (the lower half turned round, as on a real card). */
const TEN: [number, number][] = [[0.3, 0.2], [0.7, 0.2], [0.5, 0.31], [0.3, 0.4], [0.7, 0.4], [0.3, 0.6], [0.7, 0.6], [0.5, 0.69], [0.3, 0.8], [0.7, 0.8]];

/** A simple crown (K), tiara (Q) or band (J) over the big letter. */
function headpiece(g: CanvasRenderingContext2D, rank: string, x: number, y: number): void {
  g.beginPath();
  if (rank === 'K') {
    g.moveTo(x - 15, y + 7); g.lineTo(x - 15, y - 4); g.lineTo(x - 8, y + 2); g.lineTo(x, y - 8); g.lineTo(x + 8, y + 2); g.lineTo(x + 15, y - 4); g.lineTo(x + 15, y + 7);
    g.closePath(); g.fill();
  } else if (rank === 'Q') {
    g.moveTo(x - 13, y + 6); g.quadraticCurveTo(x, y - 7, x + 13, y + 6); g.lineTo(x + 13, y + 8); g.lineTo(x - 13, y + 8); g.closePath(); g.fill();
    for (const dx of [-8, 0, 8]) { g.beginPath(); g.arc(x + dx, y - (dx === 0 ? 4 : 1), 2.3, 0, Math.PI * 2); g.fill(); }
  } else {
    g.rect(x - 13, y + 1, 26, 5); g.fill();
    g.beginPath(); g.moveTo(x, y - 6); g.lineTo(x + 4, y); g.lineTo(x, y + 1); g.lineTo(x - 4, y); g.closePath(); g.fill();
  }
}

/** A face, near white with its ink baked in (tinted ivory at rest, gold for the flush). */
function paintFace(face: CardFace): HTMLCanvasElement | null {
  const k = canvas(CARD_W, CARD_H); if (!k) return null;
  const g = k.g;
  const rank = RANK[face[0]!]!;
  const suit = face[1] as Suit;
  const ink = suit === 'H' || suit === 'D' ? INK_RED : INK_BLACK;
  // The paper: white, with a faint shade toward the bottom so a tint keeps a little form.
  const paper = g.createLinearGradient(0, 0, 0, CARD_H);
  paper.addColorStop(0, '#ffffff'); paper.addColorStop(1, '#ecebe8');
  g.fillStyle = paper; cardPath(g, 0.5, 0.5, CARD_W - 1, CARD_H - 1, CARD_R); g.fill();
  g.strokeStyle = 'rgba(40,30,30,0.35)'; g.lineWidth = 1; cardPath(g, 0.5, 0.5, CARD_W - 1, CARD_H - 1, CARD_R); g.stroke();
  g.fillStyle = ink;
  cornerIndex(g, rank, suit);
  g.save(); g.translate(CARD_W, CARD_H); g.rotate(Math.PI); cornerIndex(g, rank, suit); g.restore();
  const cx = CARD_W / 2, cy = CARD_H / 2;
  if (rank === 'A') {
    drawPip(g, suit, cx, cy, suit === 'S' ? 50 : 40);
  } else if (rank === '10') {
    for (const [fx, fy] of TEN) {
      const x = CARD_W * fx, y = CARD_H * fy;
      if (fy > 0.5) { g.save(); g.translate(x, y); g.rotate(Math.PI); drawPip(g, suit, 0, 0, 15); g.restore(); } else drawPip(g, suit, x, y, 15);
    }
  } else {
    // A court card, kept graphic: a thin frame, a headpiece, the big letter, a pip under it.
    g.strokeStyle = ink; g.lineWidth = 1.4;
    g.beginPath(); g.roundRect(22, 16, CARD_W - 44, CARD_H - 32, 4); g.stroke();
    headpiece(g, rank, cx, cy - 26);
    g.font = `bold 42px ${SERIF}`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText(rank, cx, cy + 14);
    drawPip(g, suit, cx, cy + 32, 14);
  }
  return k.c;
}

/** The back, in its own colours: an ivory border, a red field with a fine lattice, a ring and a pip in the middle. */
function paintBack(): HTMLCanvasElement | null {
  const k = canvas(CARD_W, CARD_H); if (!k) return null;
  const g = k.g;
  g.fillStyle = '#fff6e3'; cardPath(g, 0.5, 0.5, CARD_W - 1, CARD_H - 1, CARD_R); g.fill();
  g.strokeStyle = 'rgba(40,30,30,0.35)'; g.lineWidth = 1; cardPath(g, 0.5, 0.5, CARD_W - 1, CARD_H - 1, CARD_R); g.stroke();
  const inset = 7;
  g.save();
  cardPath(g, inset, inset, CARD_W - inset * 2, CARD_H - inset * 2, 5); g.clip();
  g.fillStyle = '#b81c34'; g.fillRect(0, 0, CARD_W, CARD_H);
  g.strokeStyle = 'rgba(255,190,190,0.35)'; g.lineWidth = 1;
  for (let i = -CARD_H; i < CARD_W + CARD_H; i += 9) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + CARD_H, CARD_H); g.stroke();
    g.beginPath(); g.moveTo(i, CARD_H); g.lineTo(i + CARD_H, 0); g.stroke();
  }
  g.restore();
  g.strokeStyle = '#fff6e3'; g.lineWidth = 2;
  cardPath(g, inset + 3, inset + 3, CARD_W - (inset + 3) * 2, CARD_H - (inset + 3) * 2, 4); g.stroke();
  g.fillStyle = '#b81c34';
  g.beginPath(); g.arc(CARD_W / 2, CARD_H / 2, 17, 0, Math.PI * 2); g.fill();
  g.lineWidth = 2.5; g.strokeStyle = '#fff6e3'; g.beginPath(); g.arc(CARD_W / 2, CARD_H / 2, 17, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff6e3'; drawPip(g, 'S', CARD_W / 2, CARD_H / 2, 18);
  return k.c;
}

/** The card silhouette on a padded box: blurred (the glow) or solid (the flash). */
function paintSilhouette(blur: boolean): HTMLCanvasElement | null {
  const k = canvas(CARD_W + GLOW_PAD * 2, CARD_H + GLOW_PAD * 2); if (!k) return null;
  const g = k.g;
  if (blur) { g.shadowColor = '#fff'; g.shadowBlur = 10; g.fillStyle = 'rgba(255,255,255,0.8)'; } else g.fillStyle = '#fff';
  cardPath(g, GLOW_PAD, GLOW_PAD, CARD_W, CARD_H, CARD_R); g.fill();
  return k.c;
}

/** A confetti chip: a small rounded rectangle (a scrap of card), shaded so a flutter reads. */
function paintChip(): HTMLCanvasElement | null {
  const k = canvas(14, 20); if (!k) return null;
  const gr = k.g.createLinearGradient(0, 0, 14, 20);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#d4d4d4');
  k.g.fillStyle = gr; k.g.beginPath(); k.g.roundRect(1, 1, 12, 18, 2.5); k.g.fill();
  return k.c;
}

function paintPipTex(suit: Suit): HTMLCanvasElement | null {
  const k = canvas(28, 28); if (!k) return null;
  k.g.fillStyle = '#fff'; drawPip(k.g, suit, 14, 14, 24);
  return k.c;
}

let cached: HeroCardsTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroCardsTextures(): HeroCardsTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const faces: Partial<Record<CardFace, HTMLCanvasElement | null>> = {};
  for (const f of ['AS', 'AH', 'AD', 'TS', 'JS', 'QS', 'KS'] as const) faces[f] = paintFace(f);
  const back = paintBack(), glow = paintSilhouette(true), flash = paintSilhouette(false), chip = paintChip();
  const pips = (['S', 'H', 'D', 'C'] as const).map(paintPipTex);
  if (!base || !back || !glow || !flash || !chip || pips.some((p) => !p) || Object.values(faces).some((f) => !f)) return null;
  cached = {
    ...base,
    cardBack: tex(back),
    cardFaces: Object.fromEntries(Object.entries(faces).map(([k, c]) => [k, tex(c!)])) as Record<CardFace, Texture>,
    cardGlow: tex(glow), cardFlash: tex(flash), chip: tex(chip),
    pips: pips.map((p) => tex(p!)) as [Texture, Texture, Texture, Texture],
  };
  return cached;
}
