/**
 * The Grabby Claw's textures, painted ONCE per session on 2D canvases and kept (about 0.6 MB of GPU memory on top of the
 * Blast and Arcana basics, which it shares). No image files.
 *
 * Everything is painted for a struck portrait of radius `CLAW_REF_R` (100 px): the scene scales by `R / 100`.
 *  - CABLE: a short strip of steel cable (dark edges, a light core), stretched from the top of the view to the hub.
 *  - HUB: the chrome motor housing (a cable collar, a barrel, a skirt with bolts) with a red lamp in the middle.
 *  - PRONG: one SIDE prong in its CLOSED pose (an upper arm out to an elbow, a finger curving down and in to a rubber
 *    pad), pivot at `PRONG_PIVOT`. The scene draws it twice (mirrored) and rotates each about its pivot to open.
 *  - FINGER: the FRONT prong, seen end on (a short bar straight down with a pad), pivot at `FINGER_PIVOT`. The scene
 *    shortens it to open.
 *  - CHUTE: the prize chute, front on: a chrome mouth across the top of a hazard striped hopper, and under it a navy
 *    cabinet with a "PRIZE" plate between two lamps, two chevrons and a collection flap. It is opaque on purpose: the portrait (DOM, under the overlay) drops BEHIND it.
 *  - WINNER: the sign that flashes over the chute (a marquee plate, bulbs round the edge).
 *  - COIN: a small gold coin (what falls out on a shake).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroClawTextures } from './heroClawScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** The portrait radius every texture is painted for. */
export const CLAW_REF_R = 100;
export const CABLE_W = 12;
export const CABLE_H = 32;
export const HUB_W = 112;
export const HUB_H = 100;
/** The side prongs hinge on the hub this far out from, and this far below, its centre. */
export const HUB_LUG = { x: 24, y: 26 };
export const PRONG_W = 150;
export const PRONG_H = 216;
export const PRONG_PIVOT = { x: 26, y: 22 };
export const FINGER_W = 48;
export const FINGER_H = 118;
export const FINGER_PIVOT = { x: 24, y: 14 };
export const CHUTE_W = 270;
export const CHUTE_H = 250;
/** The two lamp sockets on the chute (texture px from its top left). */
export const CHUTE_LAMPS = [{ x: 50, y: 115 }, { x: 220, y: 115 }] as const;
export const WINNER_W = 320;
export const WINNER_H = 104;
export const COIN_D = 30;

const OUTLINE = '#1c222b';

/** A chrome bar along a path: a dark outline, the steel, a light band and a thin highlight on the lit (upper left) side. */
function chromeStroke(g: CanvasRenderingContext2D, path: () => void, w: number): void {
  g.lineCap = 'round'; g.lineJoin = 'round';
  const pass = (style: string, width: number, dx: number, dy: number, alpha = 1): void => {
    g.save(); g.translate(dx, dy); g.globalAlpha = alpha; g.strokeStyle = style; g.lineWidth = width; g.beginPath(); path(); g.stroke(); g.restore();
  };
  pass(OUTLINE, w + 5, 0, 0);
  pass('#7d8896', w, 0, 0);
  pass('#4e5865', w * 0.42, w * 0.2, w * 0.2);
  pass('#dfe6ee', w * 0.5, -w * 0.12, -w * 0.12);
  pass('#ffffff', Math.max(1.5, w * 0.14), -w * 0.24, -w * 0.24, 0.95);
}

/** A domed bolt head. */
function bolt(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.fillStyle = OUTLINE; g.beginPath(); g.arc(x, y, r + 2.5, 0, Math.PI * 2); g.fill();
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#b9c3cf'); gr.addColorStop(1, '#58626f');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(28,34,43,0.7)'; g.beginPath(); g.arc(x, y, r * 0.28, 0, Math.PI * 2); g.fill();
}

/** A horizontal chrome barrel: lit from the upper left, a hard white band, a dark core line, a bounce light at the far edge. */
function barrel(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.fillStyle = OUTLINE; g.beginPath(); g.roundRect(x - 2.5, y - 2.5, w + 5, h + 5, r + 2); g.fill();
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, '#5a6471'); gr.addColorStop(0.14, '#c9d2dc'); gr.addColorStop(0.26, '#ffffff'); gr.addColorStop(0.36, '#aab4c0');
  gr.addColorStop(0.62, '#6c7683'); gr.addColorStop(0.86, '#454e5a'); gr.addColorStop(0.95, '#8a94a1'); gr.addColorStop(1, '#4a535f');
  g.fillStyle = gr; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
  // A soft shade toward the bottom gives the barrel its roundness top to bottom as well.
  const sh = g.createLinearGradient(0, y, 0, y + h);
  sh.addColorStop(0, 'rgba(255,255,255,0.18)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(10,14,22,0.32)');
  g.fillStyle = sh; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
}

function paintCable(): HTMLCanvasElement | null {
  const k = canvas(CABLE_W, CABLE_H); if (!k) return null;
  const g = k.g;
  const gr = g.createLinearGradient(0, 0, CABLE_W, 0);
  gr.addColorStop(0, 'rgba(20,24,32,0)'); gr.addColorStop(0.18, '#1c222b'); gr.addColorStop(0.42, '#9aa5b2'); gr.addColorStop(0.5, '#e6ecf3');
  gr.addColorStop(0.62, '#6f7986'); gr.addColorStop(0.82, '#1c222b'); gr.addColorStop(1, 'rgba(20,24,32,0)');
  g.fillStyle = gr; g.fillRect(0, 0, CABLE_W, CABLE_H);
  return k.c;
}

function paintHub(): HTMLCanvasElement | null {
  const k = canvas(HUB_W, HUB_H); if (!k) return null;
  const g = k.g;
  const cx = HUB_W / 2;
  // The cable collar, the barrel, the skirt.
  barrel(g, cx - 11, 3, 22, 26, 5);
  barrel(g, cx - 36, 24, 72, 44, 12);
  barrel(g, cx - 48, 60, 96, 20, 8);
  // A dark seam under the barrel and two bolts on the skirt.
  g.fillStyle = 'rgba(16,20,28,0.55)'; g.fillRect(cx - 36, 60, 72, 3);
  bolt(g, cx - 34, 70, 5); bolt(g, cx + 34, 70, 5);
  // The hinge lugs the side prongs hang from.
  bolt(g, cx - HUB_LUG.x, HUB_H / 2 + HUB_LUG.y, 8); bolt(g, cx + HUB_LUG.x, HUB_H / 2 + HUB_LUG.y, 8);
  // The lamp: a red dome in a chrome bezel.
  bolt(g, cx, 45, 13);
  const lamp = g.createRadialGradient(cx - 3, 41, 1, cx, 45, 10);
  lamp.addColorStop(0, '#ffd9dc'); lamp.addColorStop(0.35, '#ff4a5c'); lamp.addColorStop(1, '#8c1224');
  g.fillStyle = lamp; g.beginPath(); g.arc(cx, 45, 9.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(cx - 3.5, 41, 3, 2, -0.6, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** One side prong, CLOSED (the right-hand one; the left is this mirrored). */
function paintProng(): HTMLCanvasElement | null {
  const k = canvas(PRONG_W, PRONG_H); if (!k) return null;
  const g = k.g;
  const px = PRONG_PIVOT.x, py = PRONG_PIVOT.y;
  const elbow = { x: px + 88, y: py + 60 };
  const tip = { x: px + 66, y: py + 170 };
  // The finger first (it tucks under the elbow joint), then the upper arm.
  chromeStroke(g, () => { g.moveTo(elbow.x, elbow.y); g.bezierCurveTo(elbow.x + 22, elbow.y + 50, tip.x + 26, tip.y - 26, tip.x, tip.y); }, 12);
  chromeStroke(g, () => { g.moveTo(px, py); g.lineTo(elbow.x, elbow.y); }, 15);
  // The rubber pad at the tip, hooked inward.
  g.save();
  g.translate(tip.x - 4, tip.y + 3); g.rotate(-0.5);
  g.fillStyle = OUTLINE; g.beginPath(); g.roundRect(-19, -10.5, 32, 21, 9); g.fill();
  const pad = g.createLinearGradient(0, -8, 0, 8);
  pad.addColorStop(0, '#ff6b78'); pad.addColorStop(0.5, '#d42b40'); pad.addColorStop(1, '#8c1224');
  g.fillStyle = pad; g.beginPath(); g.roundRect(-16.5, -8, 27, 16, 7); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.roundRect(-12, -6, 14, 3.5, 2); g.fill();
  g.restore();
  bolt(g, elbow.x, elbow.y, 9);
  bolt(g, px, py, 10);
  return k.c;
}

/** The front prong, end on: a short bar straight down to a pad. */
function paintFinger(): HTMLCanvasElement | null {
  const k = canvas(FINGER_W, FINGER_H); if (!k) return null;
  const g = k.g;
  const px = FINGER_PIVOT.x, py = FINGER_PIVOT.y;
  chromeStroke(g, () => { g.moveTo(px, py); g.lineTo(px, py + 74); }, 15);
  g.fillStyle = OUTLINE; g.beginPath(); g.roundRect(px - 17, py + 66, 34, 30, 10); g.fill();
  const pad = g.createLinearGradient(0, py + 68, 0, py + 94);
  pad.addColorStop(0, '#ff6b78'); pad.addColorStop(0.5, '#d42b40'); pad.addColorStop(1, '#8c1224');
  g.fillStyle = pad; g.beginPath(); g.roundRect(px - 14.5, py + 68.5, 29, 25, 8); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.roundRect(px - 10, py + 71.5, 14, 4, 2); g.fill();
  bolt(g, px, py, 9);
  return k.c;
}

function paintChute(): HTMLCanvasElement | null {
  const k = canvas(CHUTE_W, CHUTE_H); if (!k) return null;
  const g = k.g;
  const W = CHUTE_W, H = CHUTE_H;
  // THE HOPPER: a funnel flaring out to the full width at the mouth, hazard striped, over a narrower cabinet.
  const hop = (inset: number): void => {
    g.beginPath(); g.moveTo(inset, 12); g.lineTo(W - inset, 12); g.lineTo(W - 34 - inset * 0.4, 70); g.lineTo(34 + inset * 0.4, 70); g.closePath();
  };
  // The cabinet: deep navy, a lighter face, gold trim.
  g.fillStyle = '#0c1326'; g.beginPath(); g.roundRect(26, 58, W - 52, H - 58, 14); g.fill();
  const body = g.createLinearGradient(0, 62, 0, H);
  body.addColorStop(0, '#2f52a0'); body.addColorStop(0.5, '#1f3a78'); body.addColorStop(1, '#132654');
  g.fillStyle = body; g.beginPath(); g.roundRect(30, 60, W - 60, H - 64, 11); g.fill();
  const side = g.createLinearGradient(30, 0, W - 30, 0);
  side.addColorStop(0, 'rgba(255,255,255,0.18)'); side.addColorStop(0.14, 'rgba(255,255,255,0)'); side.addColorStop(0.82, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,0.32)');
  g.fillStyle = side; g.beginPath(); g.roundRect(30, 60, W - 60, H - 64, 11); g.fill();
  g.strokeStyle = '#ffc83a'; g.lineWidth = 2.5; g.beginPath(); g.roundRect(38, 80, W - 76, H - 92, 8); g.stroke();
  // The hopper face.
  g.fillStyle = '#0c1326'; hop(2); g.fill();
  g.save();
  hop(6); g.clip();
  g.fillStyle = '#ffc83a'; g.fillRect(0, 0, W, 80);
  g.fillStyle = '#1c222b';
  for (let x = -60; x < W + 60; x += 34) { g.beginPath(); g.moveTo(x, 72); g.lineTo(x + 17, 72); g.lineTo(x + 63, 10); g.lineTo(x + 46, 10); g.closePath(); g.fill(); }
  const hs = g.createLinearGradient(0, 12, 0, 70);
  hs.addColorStop(0, 'rgba(255,255,255,0.25)'); hs.addColorStop(0.3, 'rgba(255,255,255,0)'); hs.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.fillStyle = hs; g.fillRect(0, 0, W, 80);
  g.restore();
  // The mouth: a chrome rim across the top with the dark of the drop showing in it.
  barrel(g, 2.5, 2.5, W - 5, 22, 10);
  g.fillStyle = '#05070d'; g.beginPath(); g.roundRect(15, 7.5, W - 30, 12, 6); g.fill();
  g.fillStyle = 'rgba(120,140,180,0.3)'; g.beginPath(); g.roundRect(20, 15.5, W - 40, 3, 1.5); g.fill();
  // The PRIZE plate between the two lamps.
  g.fillStyle = '#0a1020'; g.beginPath(); g.roundRect(68, 90, W - 136, 50, 9); g.fill();
  g.strokeStyle = '#ffc83a'; g.lineWidth = 2; g.beginPath(); g.roundRect(68, 90, W - 136, 50, 9); g.stroke();
  g.font = '900 36px Impact, "Arial Black", "Helvetica Neue", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#7a4a00'; g.fillText('PRIZE', W / 2 + 1.5, 118);
  const gold = g.createLinearGradient(0, 98, 0, 136);
  gold.addColorStop(0, '#fff3c2'); gold.addColorStop(0.5, '#ffc83a'); gold.addColorStop(1, '#e08a12');
  g.fillStyle = gold; g.fillText('PRIZE', W / 2, 116.5);
  for (const l of CHUTE_LAMPS) {
    bolt(g, l.x, l.y, 12);
    const lamp = g.createRadialGradient(l.x - 3, l.y - 4, 1, l.x, l.y, 10);
    lamp.addColorStop(0, '#ffb9bf'); lamp.addColorStop(0.4, '#c22a3c'); lamp.addColorStop(1, '#5e0c18');
    g.fillStyle = lamp; g.beginPath(); g.arc(l.x, l.y, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(l.x - 3.5, l.y - 4, 3, 2, -0.6, 0, Math.PI * 2); g.fill();
  }
  // Two gold chevrons pointing down at the flap.
  g.strokeStyle = '#ffc83a'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
  for (const y of [152, 166]) { g.globalAlpha = y === 152 ? 0.6 : 1; g.beginPath(); g.moveTo(W / 2 - 20, y); g.lineTo(W / 2, y + 12); g.lineTo(W / 2 + 20, y); g.stroke(); }
  g.globalAlpha = 1;
  // The collection flap: a low chrome framed door that swings in, with a finger slot.
  barrel(g, 62, 190, W - 124, 50, 10);
  const door = g.createLinearGradient(0, 196, 0, 234);
  door.addColorStop(0, '#0a0f1c'); door.addColorStop(1, '#1b2848');
  g.fillStyle = door; g.beginPath(); g.roundRect(69, 197, W - 138, 36, 6); g.fill();
  g.save();
  g.beginPath(); g.roundRect(69, 197, W - 138, 36, 6); g.clip();
  g.fillStyle = 'rgba(255,255,255,0.1)';
  g.beginPath(); g.moveTo(84, 233); g.lineTo(106, 197); g.lineTo(126, 197); g.lineTo(104, 233); g.closePath(); g.fill();
  g.restore();
  g.fillStyle = '#05070d'; g.beginPath(); g.roundRect(W / 2 - 24, 222, 48, 7, 3.5); g.fill();
  return k.c;
}

function paintWinner(): HTMLCanvasElement | null {
  const k = canvas(WINNER_W, WINNER_H); if (!k) return null;
  const g = k.g;
  const W = WINNER_W, H = WINNER_H;
  g.fillStyle = '#1c222b'; g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, 20); g.fill();
  const plate = g.createLinearGradient(0, 6, 0, H - 6);
  plate.addColorStop(0, '#d8243c'); plate.addColorStop(1, '#8a0f24');
  g.fillStyle = plate; g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 16); g.fill();
  g.strokeStyle = '#ffc83a'; g.lineWidth = 3; g.beginPath(); g.roundRect(7.5, 7.5, W - 15, H - 15, 15); g.stroke();
  // Bulbs round the edge.
  const bulb = (x: number, y: number): void => {
    const b = g.createRadialGradient(x - 1, y - 1, 0.5, x, y, 5);
    b.addColorStop(0, '#ffffff'); b.addColorStop(0.5, '#fff0a8'); b.addColorStop(1, '#f0a020');
    g.fillStyle = b; g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill();
  };
  for (let i = 0; i < 12; i++) { const x = 26 + (i * (W - 52)) / 11; bulb(x, 17); bulb(x, H - 17); }
  for (let i = 1; i < 3; i++) { const y = 17 + (i * (H - 34)) / 3; bulb(19, y); bulb(W - 19, y); }
  g.font = 'italic 900 50px Impact, "Arial Black", "Helvetica Neue", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = '#3a0612'; g.lineWidth = 8; g.strokeText('WINNER', W / 2, H / 2 + 3);
  const gold = g.createLinearGradient(0, H / 2 - 24, 0, H / 2 + 26);
  gold.addColorStop(0, '#ffffff'); gold.addColorStop(0.45, '#ffe680'); gold.addColorStop(1, '#ffb020');
  g.fillStyle = gold; g.fillText('WINNER', W / 2, H / 2 + 2);
  return k.c;
}

function paintCoin(): HTMLCanvasElement | null {
  const k = canvas(COIN_D, COIN_D); if (!k) return null;
  const g = k.g;
  const r = COIN_D / 2;
  g.fillStyle = '#7a4a00'; g.beginPath(); g.arc(r, r, r - 0.5, 0, Math.PI * 2); g.fill();
  const face = g.createRadialGradient(r - 4, r - 5, 1, r, r, r - 2);
  face.addColorStop(0, '#fff6c8'); face.addColorStop(0.5, '#ffcf45'); face.addColorStop(1, '#d88a10');
  g.fillStyle = face; g.beginPath(); g.arc(r, r, r - 2.5, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(122,74,0,0.7)'; g.lineWidth = 1.5; g.beginPath(); g.arc(r, r, r - 6.5, 0, Math.PI * 2); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.ellipse(r - 4, r - 5, 3.5, 2, -0.7, 0, Math.PI * 2); g.fill();
  return k.c;
}

let cached: HeroClawTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroClawTextures(): HeroClawTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const cable = paintCable(), hub = paintHub(), prong = paintProng(), finger = paintFinger(), chute = paintChute(), winner = paintWinner(), coin = paintCoin();
  if (!base || !cable || !hub || !prong || !finger || !chute || !winner || !coin) return null;
  cached = { ...base, cable: tex(cable), hub: tex(hub), prong: tex(prong), finger: tex(finger), chute: tex(chute), winner: tex(winner), coin: tex(coin) };
  return cached;
}
