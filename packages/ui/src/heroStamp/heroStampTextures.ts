/**
 * Paid in Full's textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast / Arcana set it
 * reuses for the soft glow that makes its dust and its shadow). Flat 2D, clean silhouettes, lit from the top left:
 *  - STAMP: the office rubber stamp, handle up: a turned wooden knob and neck flaring to a shoulder, a brass collar, a
 *    dark lacquered mount and the red rubber die under it. Full colour (never tinted). Its rubber face is the anchor.
 *  - MARK (star) and MARK (skull): the seal it leaves, painted white so the ink colour tints it: a bold ring, a thin
 *    ring, a ring of pips and the emblem, with the specks and the uneven pressure of a real stamped imprint.
 *  - GLOSS (one per mark): the wet shine on fresh ink, a pair of light bands clipped to the mark's own shapes (additive).
 *  - PAD: the ink pad, a shallow tin seen from above and in front, its felt soaked red.
 *  - DROP and SPLAT: a round ink droplet and an irregular splash, white for the ink tint.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { seededRng } from '../heroAttack/easing';
import { STAMP_ASPECT } from './heroStampConfig';
import type { HeroStampTextures } from './heroStampScene';

/** The stamp canvas: its base (the mount) spans `STAMP_BASE_W` of `STAMP_TEX_W`; the rubber face sits at `STAMP_FACE_Y`. */
export const STAMP_BASE_W = 176;
export const STAMP_TEX_W = 200;
export const STAMP_TEX_H = Math.round(STAMP_BASE_W * STAMP_ASPECT) + 16;
export const STAMP_FACE_Y = STAMP_TEX_H - 8;
export const MARK_PX = 256;
/** The mark's inked diameter inside its canvas. */
export const MARK_INK_PX = 236;
export const PAD_W = 256;
export const PAD_H = 168;
export const DROP_PX = 32;
export const SPLAT_PX = 160;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, ro: number, ri: number, pts = 5, rot = 0): void {
  g.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / pts;
    const r = i % 2 ? ri : ro;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

/** The handle's silhouette (knob, neck, shoulder), symmetric about `cx`, from `top` down to `bottom`. */
function handlePath(g: CanvasRenderingContext2D, cx: number, top: number, bottom: number): void {
  const H = bottom - top;
  const y = (f: number): number => top + H * f;
  g.beginPath();
  g.moveTo(cx, y(0));
  g.bezierCurveTo(cx + 50, y(0), cx + 56, y(0.3), cx + 28, y(0.42));
  g.bezierCurveTo(cx + 14, y(0.49), cx + 15, y(0.6), cx + 21, y(0.7));
  g.bezierCurveTo(cx + 30, y(0.84), cx + 60, y(0.9), cx + 66, y(1));
  g.lineTo(cx - 66, y(1));
  g.bezierCurveTo(cx - 60, y(0.9), cx - 30, y(0.84), cx - 21, y(0.7));
  g.bezierCurveTo(cx - 15, y(0.6), cx - 14, y(0.49), cx - 28, y(0.42));
  g.bezierCurveTo(cx - 56, y(0.3), cx - 50, y(0), cx, y(0));
  g.closePath();
}

/** The stamp: a turned wooden handle, a brass collar, a dark mount and the red rubber die. */
function paintStamp(): HTMLCanvasElement | null {
  const k = canvas(STAMP_TEX_W, STAMP_TEX_H); if (!k) return null;
  const g = k.g;
  const cx = STAMP_TEX_W / 2;
  const face = STAMP_FACE_Y;
  const half = STAMP_BASE_W / 2;
  const mountTop = face - 54, mountBot = face - 16;
  const collarTop = mountTop - 16;
  const handleTop = 6, handleBot = collarTop + 2;
  const OUT = '#2a1608';
  g.lineJoin = 'round';

  // The rubber die (drawn first, the mount overlaps its top): dark red, its lower edge a shallow curve.
  g.beginPath();
  g.moveTo(cx - half + 8, mountBot - 4);
  g.lineTo(cx + half - 8, mountBot - 4);
  g.lineTo(cx + half - 10, face - 6);
  g.quadraticCurveTo(cx, face + 6, cx - half + 10, face - 6);
  g.closePath();
  const rub = g.createLinearGradient(cx - half, 0, cx + half, 0);
  rub.addColorStop(0, '#d2223c'); rub.addColorStop(0.35, '#b01730'); rub.addColorStop(1, '#5e0a18');
  g.fillStyle = rub; g.fill();
  g.strokeStyle = OUT; g.lineWidth = 4; g.stroke();
  // Wet ink along the die's lower lip.
  g.strokeStyle = 'rgba(255,150,160,0.75)'; g.lineWidth = 2.5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - half + 22, face - 9); g.quadraticCurveTo(cx - 20, face - 2, cx + 10, face - 3); g.stroke();

  // The mount: a dark lacquered block with a lit top edge.
  rrect(g, cx - half, mountTop, STAMP_BASE_W, mountBot - mountTop, 9);
  const mount = g.createLinearGradient(cx - half, mountTop, cx + half, mountBot);
  mount.addColorStop(0, '#5a4a40'); mount.addColorStop(0.4, '#3a2e28'); mount.addColorStop(1, '#1c1512');
  g.fillStyle = mount; g.fill();
  g.strokeStyle = OUT; g.lineWidth = 4; g.stroke();
  g.strokeStyle = 'rgba(255,225,190,0.5)'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(cx - half + 12, mountTop + 7); g.lineTo(cx + half - 40, mountTop + 7); g.stroke();

  // The handle: turned wood, lit from the left.
  handlePath(g, cx, handleTop, handleBot);
  const wood = g.createLinearGradient(cx - 62, 0, cx + 66, 0);
  wood.addColorStop(0, '#c98d48'); wood.addColorStop(0.22, '#f4cf93'); wood.addColorStop(0.5, '#d99a52'); wood.addColorStop(0.8, '#a4642a'); wood.addColorStop(1, '#6f3f15');
  g.fillStyle = wood; g.fill();
  g.save();
  handlePath(g, cx, handleTop, handleBot); g.clip();
  // The grain: a few long soft lines following the turned shape.
  g.strokeStyle = 'rgba(110,60,20,0.28)'; g.lineWidth = 1.6;
  for (let i = -2; i <= 2; i++) {
    const x = cx + i * 13 + 4;
    g.beginPath(); g.moveTo(x, handleTop); g.bezierCurveTo(x + i * 9, handleTop + 70, x - i * 6, handleBot - 90, x + i * 12, handleBot); g.stroke();
  }
  // The waist is in shadow, and so is everything under the knob's overhang.
  const occ = g.createLinearGradient(0, handleTop, 0, handleBot);
  occ.addColorStop(0, 'rgba(60,25,5,0)'); occ.addColorStop(0.4, 'rgba(60,25,5,0)'); occ.addColorStop(0.5, 'rgba(60,25,5,0.42)');
  occ.addColorStop(0.68, 'rgba(60,25,5,0.12)'); occ.addColorStop(1, 'rgba(60,25,5,0.3)');
  g.fillStyle = occ; g.fillRect(0, handleTop, STAMP_TEX_W, handleBot - handleTop);
  // The polish: a soft highlight on the knob and a thin one down the shoulder.
  const hi = g.createRadialGradient(cx - 18, handleTop + 34, 2, cx - 18, handleTop + 34, 34);
  hi.addColorStop(0, 'rgba(255,255,255,0.85)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hi; g.fillRect(0, handleTop, STAMP_TEX_W, 90);
  g.strokeStyle = 'rgba(255,240,210,0.55)'; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - 14, handleBot - 62); g.quadraticCurveTo(cx - 26, handleBot - 34, cx - 46, handleBot - 16); g.stroke();
  g.restore();
  handlePath(g, cx, handleTop, handleBot);
  g.strokeStyle = OUT; g.lineWidth = 4; g.stroke();

  // The brass collar between the handle and the mount.
  rrect(g, cx - 72, collarTop, 144, 18, 7);
  const brass = g.createLinearGradient(cx - 72, 0, cx + 72, 0);
  brass.addColorStop(0, '#b98a2c'); brass.addColorStop(0.25, '#ffe9a0'); brass.addColorStop(0.55, '#d8a63a'); brass.addColorStop(1, '#6b470f');
  g.fillStyle = brass; g.fill();
  g.strokeStyle = OUT; g.lineWidth = 4; g.stroke();
  return k.c;
}

/** A simple skull, filled, centred on (cx, cy), about `r` tall each way. The eyes, nose and teeth are cut out. */
function paintSkull(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  g.arc(cx, cy - r * 0.18, r * 0.78, Math.PI * 0.92, Math.PI * 0.08);
  g.quadraticCurveTo(cx + r * 0.78, cy + r * 0.42, cx + r * 0.42, cy + r * 0.48);
  g.lineTo(cx + r * 0.4, cy + r * 0.86);
  g.quadraticCurveTo(cx, cy + r * 1.0, cx - r * 0.4, cy + r * 0.86);
  g.lineTo(cx - r * 0.42, cy + r * 0.48);
  g.quadraticCurveTo(cx - r * 0.78, cy + r * 0.42, cx - r * 0.775, cy - r * 0.02);
  g.closePath(); g.fill();
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * r * 0.32, cy - r * 0.08, r * 0.21, r * 0.25, s * 0.25, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.moveTo(cx, cy + r * 0.2); g.lineTo(cx + r * 0.1, cy + r * 0.42); g.lineTo(cx - r * 0.1, cy + r * 0.42); g.closePath(); g.fill();
  g.lineWidth = r * 0.07;
  for (const x of [-0.2, 0, 0.2]) { g.beginPath(); g.moveTo(cx + x * r, cy + r * 0.6); g.lineTo(cx + x * r, cy + r * 0.95); g.stroke(); }
  g.restore();
}

/** The seal the stamp leaves (white, for the ink tint): rings, pips and the emblem, with a stamped imprint's flaws. */
function paintMark(emblem: 'star' | 'skull'): HTMLCanvasElement | null {
  const k = canvas(MARK_PX, MARK_PX); if (!k) return null;
  const g = k.g;
  const c = MARK_PX / 2, R = MARK_INK_PX / 2;
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  g.lineWidth = 20; g.beginPath(); g.arc(c, c, R - 10, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.arc(c, c, R - 32, 0, Math.PI * 2); g.stroke();
  // A ring of pips between the thin ring and the emblem: small diamonds, a little star at the top and the bottom.
  const pipR = R - 49;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const x = c + Math.cos(a) * pipR, y = c + Math.sin(a) * pipR;
    if (i % 6 === 0) { starPath(g, x, y, 12, 5, 5, a + Math.PI / 2); g.fill(); } else { starPath(g, x, y, 8, 4.4, 2, a); g.fill(); }
  }
  if (emblem === 'star') { starPath(g, c, c + 3, R - 64, (R - 64) * 0.44); g.fill(); } else paintSkull(g, c, c - 5, (R - 62) * 0.9);
  // The flaws of a real imprint: specks where the rubber did not take, two dry scratches, and uneven pressure.
  const rnd = seededRng(emblem === 'star' ? 4127 : 9311);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R;
    g.globalAlpha = 0.5 + rnd() * 0.5;
    g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 0.8 + rnd() * 2.2, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 0.55; g.lineWidth = 2.2; g.lineCap = 'round';
  g.beginPath(); g.moveTo(c - R * 0.9, c + R * 0.25); g.lineTo(c - R * 0.2, c + R * 0.62); g.stroke();
  g.beginPath(); g.moveTo(c + R * 0.3, c - R * 0.86); g.lineTo(c + R * 0.8, c - R * 0.4); g.stroke();
  g.globalAlpha = 1;
  const press = g.createLinearGradient(c - R, c - R, c + R, c + R);
  press.addColorStop(0, 'rgba(0,0,0,0)'); press.addColorStop(0.7, 'rgba(0,0,0,0)'); press.addColorStop(1, 'rgba(0,0,0,0.3)');
  g.fillStyle = press; g.fillRect(0, 0, MARK_PX, MARK_PX);
  g.restore();
  return k.c;
}

/** Fresh ink's shine: two soft diagonal bands of light, kept only where the mark itself is inked. */
function paintGloss(mark: HTMLCanvasElement): HTMLCanvasElement | null {
  const k = canvas(MARK_PX, MARK_PX); if (!k) return null;
  const g = k.g;
  g.drawImage(mark, 0, 0);
  g.globalCompositeOperation = 'source-in';
  const band = g.createLinearGradient(0, 0, MARK_PX, MARK_PX);
  band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.2, 'rgba(255,255,255,0)'); band.addColorStop(0.3, 'rgba(255,255,255,0.95)');
  band.addColorStop(0.42, 'rgba(255,255,255,0.1)'); band.addColorStop(0.55, 'rgba(255,255,255,0)'); band.addColorStop(0.63, 'rgba(255,255,255,0.6)');
  band.addColorStop(0.72, 'rgba(255,255,255,0)'); band.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = band; g.fillRect(0, 0, MARK_PX, MARK_PX);
  return k.c;
}

/** The ink pad: a shallow steel tin seen from above and in front, its felt soaked red, wettest in the middle. */
function paintPad(): HTMLCanvasElement | null {
  const k = canvas(PAD_W, PAD_H); if (!k) return null;
  const g = k.g;
  const OUT = '#14181d';
  g.lineJoin = 'round';
  // The front wall (the tin's depth), then the top face over it.
  rrect(g, 8, 30, PAD_W - 16, PAD_H - 38, 22);
  const wall = g.createLinearGradient(0, 30, 0, PAD_H - 8);
  wall.addColorStop(0, '#59626e'); wall.addColorStop(1, '#232931');
  g.fillStyle = wall; g.fill();
  g.strokeStyle = OUT; g.lineWidth = 5; g.stroke();
  rrect(g, 8, 8, PAD_W - 16, PAD_H - 44, 22);
  const top = g.createLinearGradient(8, 8, PAD_W - 8, PAD_H - 36);
  top.addColorStop(0, '#c4ccd6'); top.addColorStop(0.45, '#8a94a1'); top.addColorStop(1, '#5a636f');
  g.fillStyle = top; g.fill();
  g.strokeStyle = OUT; g.lineWidth = 5; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 2.5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(34, 17); g.lineTo(PAD_W - 90, 17); g.stroke();
  // The felt: sunk into the tin, soaked.
  const fx = 28, fy = 26, fw = PAD_W - 56, fh = PAD_H - 80;
  rrect(g, fx, fy, fw, fh, 12);
  const felt = g.createRadialGradient(PAD_W / 2, fy + fh / 2, 6, PAD_W / 2, fy + fh / 2, fw * 0.6);
  felt.addColorStop(0, '#f0304a'); felt.addColorStop(0.55, '#c41832'); felt.addColorStop(1, '#84101f');
  g.fillStyle = felt; g.fill();
  g.strokeStyle = '#3a060f'; g.lineWidth = 4; g.stroke();
  g.save();
  rrect(g, fx, fy, fw, fh, 12); g.clip();
  // The felt's weave (fine dark flecks) and the tin's shadow along its upper edge.
  const rnd = seededRng(2219);
  g.fillStyle = 'rgba(70,5,15,0.35)';
  for (let i = 0; i < 220; i++) g.fillRect(fx + rnd() * fw, fy + rnd() * fh, 1.6, 1.6);
  const sh = g.createLinearGradient(0, fy, 0, fy + 22);
  sh.addColorStop(0, 'rgba(30,0,5,0.6)'); sh.addColorStop(1, 'rgba(30,0,5,0)');
  g.fillStyle = sh; g.fillRect(fx, fy, fw, 22);
  // A wet sheen.
  g.strokeStyle = 'rgba(255,190,200,0.6)'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(fx + 30, fy + fh - 18); g.quadraticCurveTo(PAD_W / 2, fy + fh - 4, fx + fw - 60, fy + fh - 16); g.stroke();
  g.restore();
  return k.c;
}

/** A round ink droplet (white for the tint), a touch lighter at its upper left so it reads as wet. */
function paintDrop(): HTMLCanvasElement | null {
  const k = canvas(DROP_PX, DROP_PX); if (!k) return null;
  const g = k.g;
  const c = DROP_PX / 2;
  g.fillStyle = 'rgb(205,205,205)';
  g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.fill();
  const hi = g.createRadialGradient(c - 4, c - 4, 1, c - 2, c - 2, c - 2);
  hi.addColorStop(0, 'rgba(255,255,255,1)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hi; g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** An ink splash (white for the tint): a blot with uneven lobes and a few flung satellites. */
function paintSplat(): HTMLCanvasElement | null {
  const k = canvas(SPLAT_PX, SPLAT_PX); if (!k) return null;
  const g = k.g;
  const c = SPLAT_PX / 2;
  const rnd = seededRng(613);
  g.fillStyle = '#fff';
  const lobes = 11;
  g.beginPath();
  for (let i = 0; i <= lobes * 2; i++) {
    const a = (i / (lobes * 2)) * Math.PI * 2;
    const r = i % 2 ? c * (0.34 + rnd() * 0.08) : c * (0.52 + rnd() * 0.36);
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else {
      const am = a - Math.PI / (lobes * 2);
      const rm = i % 2 ? r * 1.25 : r * 0.72;
      g.quadraticCurveTo(c + Math.cos(am) * rm, c + Math.sin(am) * rm, x, y);
    }
  }
  g.closePath(); g.fill();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, r = c * (0.74 + rnd() * 0.2);
    g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 1.6 + rnd() * 3.4, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

let cached: HeroStampTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroStampTextures(): HeroStampTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const stamp = paintStamp(), star = paintMark('star'), skull = paintMark('skull'), pad = paintPad(), drop = paintDrop(), splat = paintSplat();
  if (!base || !stamp || !star || !skull || !pad || !drop || !splat) return null;
  const starGloss = paintGloss(star), skullGloss = paintGloss(skull);
  if (!starGloss || !skullGloss) return null;
  cached = {
    ...base, stampBody: tex(stamp), stampMark: tex(star), stampSkull: tex(skull), stampGloss: tex(starGloss), stampSkullGloss: tex(skullGloss),
    stampPad: tex(pad), stampDrop: tex(drop), stampSplat: tex(splat),
  };
  return cached;
}
