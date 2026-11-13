/**
 * The Train attack's textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast / Arcana
 * set it reuses for glows, rings, sparks and streaks). Flat 2D with a dark outline, a top-lit gradient and one clean
 * highlight per shape. Every vehicle faces RIGHT with its wheels' feet on the bottom edge of its canvas (the scene
 * mirrors it for a train going left); sizes are `UNIT_SHAPES` in `heroTrainConfig.ts`.
 *  - TRACK: one tile of two steel rails on wooden sleepers over a soft bed of ballast; it repeats edge to edge.
 *  - HANDCAR and its see-saw HANDLE; the MINE CART heaped with glowing ore; the steam ENGINE (cab, boiler, brass domes,
 *    funnel, headlamp, cowcatcher) and its TENDER; four freight cars (BOX, TANK, HOPPER, FLAT) painted pale so a tint
 *    gives each its livery; the red CABOOSE.
 *  - WHEEL (spoked, pale, tinted) and the engine's side ROD: the parts that turn.
 *  - SIGNAL (a post with a bell, a crossbuck and two lamp housings) and its striped GATE arm.
 *  - PUFF (a steam cloud), ORE (a faceted chunk) and BONK (a fat cartoon star).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import {
  BONK_PX, GATE_H, GATE_W, HANDLE_W, ORE_PX, PUFF_PX, ROD_H, ROD_W, SIGNAL_H, SIGNAL_W, TRACK_H, TRACK_W, WHEEL_PX, type HeroTrainTextures,
} from './heroTrainScene';
import { UNIT_SHAPES, type UnitKind } from './heroTrainConfig';

type G = CanvasRenderingContext2D;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: G } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

const OUT = 'rgba(24,17,12,0.94)';
const IRON_D = '#2b2d33';
const IRON_M = '#4a4e57';

/** A top-to-bottom gradient. */
function vgrad(g: G, y0: number, y1: number, stops: readonly [number, string][]): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

function rr(g: G, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + k, y); g.lineTo(x + w - k, y); g.quadraticCurveTo(x + w, y, x + w, y + k);
  g.lineTo(x + w, y + h - k); g.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
  g.lineTo(x + k, y + h); g.quadraticCurveTo(x, y + h, x, y + h - k);
  g.lineTo(x, y + k); g.quadraticCurveTo(x, y, x + k, y);
  g.closePath();
}

/** A filled, outlined rounded box. */
function box(g: G, x: number, y: number, w: number, h: number, r: number, fill: string | CanvasGradient, lw = 4): void {
  rr(g, x, y, w, h, r);
  g.fillStyle = fill; g.fill();
  if (lw > 0) { g.strokeStyle = OUT; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke(); }
}

function poly(g: G, pts: readonly [number, number][], fill: string | CanvasGradient, lw = 4): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = fill; g.fill();
  if (lw > 0) { g.strokeStyle = OUT; g.lineWidth = lw; g.lineJoin = 'round'; g.stroke(); }
}

function disc(g: G, x: number, y: number, r: number, fill: string | CanvasGradient, lw = 4): void {
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill; g.fill();
  if (lw > 0) { g.strokeStyle = OUT; g.lineWidth = lw; g.stroke(); }
}

function line(g: G, x0: number, y0: number, x1: number, y1: number, color: string, lw: number): void {
  g.strokeStyle = color; g.lineWidth = lw; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}

/** A painted-on wheel (the freight cars', the tender's): dark iron with a steel tyre and a hub. */
function staticWheel(g: G, x: number, y: number, r: number): void {
  disc(g, x, y, r, IRON_D, 3.5);
  g.strokeStyle = '#8f96a1'; g.lineWidth = Math.max(2, r * 0.16);
  g.beginPath(); g.arc(x, y, r * 0.74, 0, Math.PI * 2); g.stroke();
  disc(g, x, y, r * 0.26, '#a9b0ba', 2);
}

/** A two-axle truck under a freight car, centred on `x`, its wheels' feet on `foot`. */
function truck(g: G, x: number, foot: number, r: number): void {
  const y = foot - r - 1;
  staticWheel(g, x - r * 1.15, y, r); staticWheel(g, x + r * 1.15, y, r);
  box(g, x - r * 1.9, y - r * 0.32, r * 3.8, r * 0.6, r * 0.25, IRON_M, 3);
}

/** A coupler stub at each end of a car, at height `y`. */
function couplers(g: G, W: number, y: number): void {
  box(g, 1, y - 5, 16, 10, 3, IRON_M, 3);
  box(g, W - 17, y - 5, 16, 10, 3, IRON_M, 3);
}

/** A deterministic scatter (the same speckle every session). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// ─── the track ─────────────────────────────────────────────────────────────────────────────────────────────────

function paintTrack(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  // The ballast: a soft bed, fading out above and below so the track sits on any board.
  const bed = vgrad(g, 0, H, [[0, 'rgba(70,60,52,0)'], [0.2, 'rgba(84,73,63,0.62)'], [0.55, 'rgba(70,60,52,0.7)'], [0.86, 'rgba(48,40,36,0.5)'], [1, 'rgba(40,32,30,0)']]);
  g.fillStyle = bed; g.fillRect(0, 0, W, H);
  const rnd = lcg(77);
  for (let i = 0; i < 130; i++) {
    const x = rnd() * W, y = H * (0.2 + rnd() * 0.66), r = 1 + rnd() * 1.8;
    g.fillStyle = rnd() > 0.5 ? 'rgba(150,138,122,0.5)' : 'rgba(30,24,20,0.45)';
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // The sleepers: eight to a tile, each a plank seen a little from above (a lit top, a dark front edge).
  const n = 8, step = W / n;
  for (let i = 0; i < n; i++) {
    const x = step * (i + 0.5) - 11;
    box(g, x, H * 0.2, 22, H * 0.64, 3, vgrad(g, H * 0.2, H * 0.84, [[0, '#8a6444'], [0.7, '#6f4d33'], [1, '#4a3222']]), 3);
    line(g, x + 5, H * 0.26, x + 5, H * 0.74, 'rgba(255,225,180,0.22)', 2);
    g.fillStyle = 'rgba(20,12,8,0.35)'; g.fillRect(x + 1, H * 0.76, 20, H * 0.06);
  }
  // The rails: the far one thinner; each a dark web with a bright worn head, and a shadow thrown on the sleepers.
  const rail = (y: number, t: number): void => {
    g.fillStyle = 'rgba(12,8,6,0.4)'; g.fillRect(0, y + t * 0.5, W, t * 0.7);
    g.fillStyle = OUT; g.fillRect(0, y - t / 2 - 1.5, W, t + 3);
    g.fillStyle = vgrad(g, y - t / 2, y + t / 2, [[0, '#e6ebf2'], [0.38, '#aab2bd'], [0.42, '#5b626c'], [1, '#3b4048']]);
    g.fillRect(0, y - t / 2, W, t);
  };
  rail(H * 0.36, 7);
  rail(H * 0.66, 9);
  return k.c;
}

// ─── the turning parts ─────────────────────────────────────────────────────────────────────────────────────────

function paintWheel(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2, r = D / 2 - 3;
  // Pale (a tint gives it its colour): a steel tyre, a painted rim, eight spokes, a hub with its crank pin.
  disc(g, c, c, r, '#c9ced6', 5);
  disc(g, c, c, r * 0.84, '#ffffff', 3);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    g.beginPath();
    g.moveTo(c + Math.cos(a - 0.26) * r * 0.3, c + Math.sin(a - 0.26) * r * 0.3);
    g.lineTo(c + Math.cos(a - 0.3) * r * 0.7, c + Math.sin(a - 0.3) * r * 0.7);
    g.arc(c, c, r * 0.7, a - 0.3, a + 0.3);
    g.lineTo(c + Math.cos(a + 0.26) * r * 0.3, c + Math.sin(a + 0.26) * r * 0.3);
    g.closePath(); g.fill();
  }
  g.restore();
  // The gaps between the spokes show the dark of the far wheel.
  g.save();
  g.globalCompositeOperation = 'destination-over';
  disc(g, c, c, r * 0.8, '#3a3d44', 0);
  g.restore();
  g.strokeStyle = OUT; g.lineWidth = 2.5;
  g.beginPath(); g.arc(c, c, r * 0.7, 0, Math.PI * 2); g.stroke();
  disc(g, c, c, r * 0.3, '#f2f4f7', 3);
  disc(g, c + r * 0.48, c, r * 0.11, '#e3e6ea', 2.5); // the crank pin (it shows the turn)
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath(); g.arc(c - r * 0.08, c - r * 0.08, r * 0.1, 0, Math.PI * 2); g.fill();
  return k.c;
}

function paintRod(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  box(g, 3, H * 0.22, W - 6, H * 0.56, H * 0.28, vgrad(g, 0, H, [[0, '#f1f3f6'], [0.5, '#b9c0ca'], [1, '#737a86']]), 3);
  for (const x of [H / 2, W / 2, W - H / 2]) disc(g, x, H / 2, H * 0.4, '#d9dde3', 2.5);
  return k.c;
}

function paintHandle(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const y = H / 2;
  // The see-saw beam, thicker at the pivot, with a wooden grip standing off each end.
  poly(g, [[14, y - 5], [W / 2, y - 10], [W - 14, y - 5], [W - 14, y + 5], [W / 2, y + 10], [14, y + 5]], vgrad(g, y - 10, y + 10, [[0, '#7c828c'], [1, '#3d4047']]), 3.5);
  for (const x of [16, W - 16]) box(g, x - 7, y - 24, 14, 48, 6, vgrad(g, y - 24, y + 24, [[0, '#d9a066'], [1, '#8a5a34']]), 3.5);
  disc(g, W / 2, y, 11, '#c9ced6', 3.5);
  disc(g, W / 2, y, 4, IRON_D, 0);
  return k.c;
}

// ─── the vehicles ──────────────────────────────────────────────────────────────────────────────────────────────

function paintHandcar(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const deckY = 104;
  // The iron frame and axle boxes (the wheels are their own sprites, drawn over).
  box(g, 26, deckY + 16, W - 52, 14, 5, IRON_M, 3.5);
  for (const x of [62, 226]) box(g, x - 13, deckY + 22, 26, 22, 5, IRON_D, 3.5);
  // The A-frame the see-saw pivots on.
  poly(g, [[112, deckY + 2], [136, 46], [152, 46], [176, deckY + 2], [160, deckY + 2], [144, 66], [128, deckY + 2]], vgrad(g, 44, deckY, [[0, '#6a707a'], [1, '#3a3d44']]), 3.5);
  disc(g, 144, 44, 9, '#aab1bb', 3.5);
  // The plank deck.
  box(g, 12, deckY, W - 24, 18, 5, vgrad(g, deckY, deckY + 18, [[0, '#d8a56b'], [0.55, '#b07a45'], [1, '#7d5330']]), 4);
  for (let x = 48; x < W - 24; x += 38) line(g, x, deckY + 3, x, deckY + 15, 'rgba(60,34,16,0.55)', 2);
  line(g, 18, deckY + 4, W - 18, deckY + 4, 'rgba(255,236,200,0.5)', 2);
  // A little lantern on a post at the front.
  line(g, W - 30, deckY, W - 30, deckY - 34, OUT, 7);
  line(g, W - 30, deckY, W - 30, deckY - 34, '#6a707a', 3);
  box(g, W - 42, deckY - 58, 24, 26, 5, '#3a3d44', 3.5);
  disc(g, W - 30, deckY - 45, 7, '#ffe08a', 0);
  disc(g, W - 32, deckY - 47, 2.5, '#ffffff', 0);
  return k.c;
}

function paintCart(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  // The ore heap first (the tub's rim overlaps its foot): dark rock with lit faces and glowing chunks.
  const rock = (x: number, y: number, r: number, glow: boolean): void => {
    const pts: [number, number][] = [[x - r, y + r * 0.5], [x - r * 0.6, y - r * 0.7], [x + r * 0.2, y - r], [x + r, y - r * 0.2], [x + r * 0.8, y + r * 0.6]];
    poly(g, pts, glow ? '#ffb347' : '#6b6259', 3.5);
    poly(g, [[x - r * 0.6, y - r * 0.7], [x + r * 0.2, y - r], [x - r * 0.05, y - r * 0.1]], glow ? '#ffe2a0' : '#8d8378', 0);
  };
  rock(78, 62, 26, false); rock(182, 64, 26, false); rock(130, 44, 32, false);
  rock(104, 58, 20, true); rock(160, 52, 18, true); rock(206, 70, 14, true); rock(58, 72, 13, true);
  // The tub: wider at the lip, iron-banded planks, rivets.
  const top = 74, bot = 150;
  poly(g, [[20, top], [W - 20, top], [W - 44, bot], [44, bot]], vgrad(g, top, bot, [[0, '#9b7a57'], [0.5, '#7b5c3f'], [1, '#553c28']]), 4.5);
  for (const x of [84, 128, 172]) line(g, x + (x - 128) * 0.12, top + 6, x - (x - 128) * 0.02, bot - 4, 'rgba(40,24,12,0.5)', 2.5);
  box(g, 14, top - 8, W - 28, 16, 6, vgrad(g, top - 8, top + 8, [[0, '#8c939e'], [1, '#474b53']]), 4);
  poly(g, [[34, 112], [W - 34, 112], [W - 38, 126], [38, 126]], vgrad(g, 112, 126, [[0, '#7c838d'], [1, '#3f4249']]), 3.5);
  g.fillStyle = '#d5dae1';
  for (const x of [34, 70, 110, 146, 186, 222]) { g.beginPath(); g.arc(x, top, 2.6, 0, Math.PI * 2); g.fill(); }
  line(g, 30, top + 14, 90, top + 14, 'rgba(255,230,190,0.35)', 3);
  // The underframe and axle boxes.
  box(g, 50, bot - 2, W - 100, 12, 4, IRON_M, 3.5);
  for (const x of [70, 186]) box(g, x - 12, bot + 2, 24, 16, 4, IRON_D, 3.5);
  // A hook at each end.
  box(g, 26, 134, 22, 8, 3, IRON_M, 3); box(g, W - 48, 134, 22, 8, 3, IRON_M, 3);
  return k.c;
}

const TEAL_T = '#3f8aa0', TEAL_M = '#27617a', TEAL_B = '#163d52';
const BRASS = [[0, '#ffe9a3'], [0.5, '#e8b944'], [1, '#9a6d1c']] as const;

function paintEngine(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const brass = (y0: number, y1: number): CanvasGradient => vgrad(g, y0, y1, BRASS as unknown as [number, string][]);
  const teal = (y0: number, y1: number): CanvasGradient => vgrad(g, y0, y1, [[0, TEAL_T], [0.45, TEAL_M], [1, TEAL_B]]);
  // The frame behind the wheels, the cylinder at the front and the cowcatcher.
  box(g, 60, 176, 396, 44, 6, IRON_D, 4);
  poly(g, [[452, 190], [508, 250], [452, 250]], vgrad(g, 190, 250, [[0, '#e0665a'], [1, '#8f2f28']]), 4.5);
  for (const t of [0.3, 0.55, 0.8]) line(g, 452, 190 + 60 * t, 452 + 56 * t, 250, 'rgba(30,10,8,0.6)', 3);
  box(g, 404, 188, 52, 34, 8, vgrad(g, 188, 222, [[0, '#737a86'], [1, '#33363d']]), 4);
  line(g, 410, 196, 448, 196, 'rgba(255,255,255,0.35)', 3);
  // The funnel: a flared stack with a brass lip.
  poly(g, [[374, 90], [372, 46], [362, 30], [414, 30], [404, 46], [402, 90]], vgrad(g, 30, 90, [[0, '#4a4e57'], [1, '#22242a']]), 4.5);
  box(g, 358, 18, 60, 16, 7, brass(18, 34), 4);
  // The boiler (a long drum, lit along its top) and the dark smokebox at its front.
  box(g, 136, 80, 296, 88, 30, teal(80, 168), 4.5);
  rr(g, 388, 80, 46, 88, 26); g.fillStyle = vgrad(g, 80, 168, [[0, '#565b66'], [0.5, '#34373e'], [1, '#1f2126']]); g.fill(); g.strokeStyle = OUT; g.lineWidth = 4.5; g.stroke();
  line(g, 160, 92, 380, 92, 'rgba(210,245,255,0.42)', 5);
  for (const x of [196, 262, 328]) { g.fillStyle = brass(80, 168); g.fillRect(x, 82, 8, 84); g.strokeStyle = OUT; g.lineWidth = 2; g.strokeRect(x, 82, 8, 84); }
  // The brass steam dome, the smaller sand dome, and the whistle.
  g.beginPath(); g.arc(296, 84, 28, Math.PI, 0); g.closePath(); g.fillStyle = brass(56, 84); g.fill(); g.strokeStyle = OUT; g.lineWidth = 4; g.stroke();
  g.beginPath(); g.arc(230, 84, 18, Math.PI, 0); g.closePath(); g.fillStyle = teal(64, 86); g.fill(); g.stroke();
  line(g, 176, 82, 176, 62, OUT, 8); line(g, 176, 82, 176, 62, '#e8b944', 4);
  box(g, 168, 54, 16, 10, 4, brass(54, 64), 3);
  // The headlamp on the smokebox, looking down the line.
  box(g, 414, 58, 30, 26, 6, '#3a3d44', 4);
  g.beginPath(); g.ellipse(444, 71, 7, 11, 0, 0, Math.PI * 2); g.fillStyle = '#fff1b8'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 3; g.stroke();
  // The cab: a roof with an overhang, a lit window, a gold stripe.
  box(g, 16, 46, 128, 128, 8, teal(46, 174), 4.5);
  box(g, 40, 68, 62, 48, 6, vgrad(g, 68, 116, [[0, '#ffe7a6'], [1, '#f2a93c']]), 4);
  line(g, 71, 70, 71, 114, OUT, 3.5);
  line(g, 46, 76, 62, 76, 'rgba(255,255,255,0.7)', 3);
  g.fillStyle = brass(134, 142); g.fillRect(18, 134, 124, 7);
  box(g, 4, 32, 152, 18, 8, vgrad(g, 32, 50, [[0, '#5d626c'], [1, '#2b2d33']]), 4.5);
  // The red running board along the whole engine, and the splashers over the drivers.
  box(g, 20, 166, 436, 13, 5, vgrad(g, 166, 179, [[0, '#ee7366'], [1, '#a8382f']]), 4);
  // The coupler at the back.
  box(g, 1, 196, 20, 10, 3, IRON_M, 3);
  return k.c;
}

function paintTender(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const foot = H - 1;
  // The coal heap, then the tank over its foot.
  const rnd = lcg(5);
  for (let i = 0; i < 9; i++) {
    const x = 34 + i * 19 + rnd() * 6, y = 44 - Math.sin((i / 8) * Math.PI) * 18 + rnd() * 6, r = 14 + rnd() * 6;
    poly(g, [[x - r, y + r * 0.6], [x - r * 0.5, y - r * 0.7], [x + r * 0.4, y - r], [x + r, y + r * 0.1], [x + r * 0.7, y + r * 0.7]], '#26272c', 3);
    poly(g, [[x - r * 0.5, y - r * 0.7], [x + r * 0.4, y - r], [x, y - r * 0.2]], '#565962', 0);
  }
  box(g, 14, 46, W - 28, 88, 8, vgrad(g, 46, 134, [[0, TEAL_T], [0.45, TEAL_M], [1, TEAL_B]]), 4.5);
  line(g, 26, 58, W - 26, 58, 'rgba(210,245,255,0.4)', 4);
  g.fillStyle = vgrad(g, 96, 104, BRASS as unknown as [number, string][]); g.fillRect(16, 96, W - 32, 7);
  box(g, 8, 38, W - 16, 14, 6, vgrad(g, 38, 52, [[0, '#5d626c'], [1, '#2b2d33']]), 4);
  box(g, 22, 132, W - 44, 14, 4, IRON_D, 3.5);
  truck(g, 64, foot, 19); truck(g, W - 64, foot, 19);
  couplers(g, W, 138);
  return k.c;
}

/** The underframe, trucks and couplers every freight car shares. */
function carBase(g: G, W: number, H: number, deck: number): void {
  box(g, 16, deck, W - 32, 14, 4, IRON_D, 3.5);
  truck(g, 94, H - 1, 20); truck(g, W - 94, H - 1, 20);
  couplers(g, W, deck + 7);
}

function paintBox(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const top = 30, deck = 152;
  carBase(g, W, H, deck);
  // Pale planks (the tint is its livery), a sliding door on a rail, a low arched roof.
  box(g, 16, top, W - 32, deck - top + 2, 6, vgrad(g, top, deck, [[0, '#ffffff'], [0.5, '#e6e2dc'], [1, '#bcb6ad']]), 4.5);
  for (let x = 44; x < W - 30; x += 28) line(g, x, top + 12, x, deck - 6, 'rgba(60,50,40,0.28)', 2);
  box(g, 168, top + 14, 112, deck - top - 16, 4, vgrad(g, top, deck, [[0, '#f6f3ee'], [1, '#aaa399']]), 4);
  line(g, 150, top + 12, 298, top + 12, OUT, 6); line(g, 150, top + 12, 298, top + 12, '#8a8f98', 2.5);
  for (const y of [top + 46, top + 82]) line(g, 176, y, 272, y, 'rgba(60,50,40,0.3)', 2);
  box(g, 262, top + 62, 10, 22, 3, IRON_M, 2.5);
  line(g, 28, top + 12, 140, top + 12, 'rgba(255,255,255,0.55)', 3);
  g.beginPath(); g.moveTo(8, top + 6); g.quadraticCurveTo(W / 2, top - 22, W - 8, top + 6); g.lineTo(W - 8, top + 12); g.lineTo(8, top + 12); g.closePath();
  g.fillStyle = vgrad(g, top - 14, top + 12, [[0, '#8f949d'], [1, '#474a52']]); g.fill(); g.strokeStyle = OUT; g.lineWidth = 4.5; g.lineJoin = 'round'; g.stroke();
  return k.c;
}

function paintTank(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const deck = 152;
  carBase(g, W, H, deck);
  // The saddles, then the drum: pale steel lit along its top, three bands, a dome hatch and a ladder.
  for (const x of [96, W - 96]) poly(g, [[x - 34, deck + 2], [x - 22, deck - 22], [x + 22, deck - 22], [x + 34, deck + 2]], IRON_M, 3.5);
  box(g, 24, 42, W - 48, 104, 50, vgrad(g, 42, 146, [[0, '#ffffff'], [0.3, '#eef1f5'], [0.7, '#bfc6cf'], [1, '#868d98']]), 4.5);
  line(g, 70, 56, W - 70, 56, 'rgba(255,255,255,0.85)', 5);
  for (const x of [120, W / 2, W - 120]) { line(g, x, 44, x, 144, OUT, 7); line(g, x, 45, x, 143, '#9aa1ac', 3); }
  box(g, W / 2 - 26, 24, 52, 24, 8, vgrad(g, 24, 48, [[0, '#f4f6f9'], [1, '#99a0aa']]), 4);
  box(g, W / 2 - 32, 18, 64, 10, 5, IRON_M, 3.5);
  for (const x of [318, 338]) line(g, x, 50, x, deck, IRON_D, 3.5);
  for (let y = 66; y < deck; y += 18) line(g, 318, y, 338, y, IRON_D, 3);
  return k.c;
}

function paintHopper(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const top = 52, deck = 152;
  carBase(g, W, H, deck);
  // The load heaped over the rim (dark ore, a few glowing chunks), then the open-topped body with its ribs.
  const rnd = lcg(11);
  for (let i = 0; i < 15; i++) {
    const x = 46 + i * 25 + rnd() * 8, y = top - 4 - Math.sin((i / 14) * Math.PI) * 20 + rnd() * 6, r = 15 + rnd() * 7;
    const hot = i % 5 === 2;
    poly(g, [[x - r, y + r * 0.6], [x - r * 0.5, y - r * 0.7], [x + r * 0.4, y - r], [x + r, y + r * 0.1], [x + r * 0.7, y + r * 0.7]], hot ? '#ffb347' : '#5a534c', 3);
    poly(g, [[x - r * 0.5, y - r * 0.7], [x + r * 0.4, y - r], [x, y - r * 0.2]], hot ? '#ffe2a0' : '#857b70', 0);
  }
  poly(g, [[14, top], [W - 14, top], [W - 30, deck - 30], [W - 70, deck + 2], [70, deck + 2], [30, deck - 30]], vgrad(g, top, deck, [[0, '#ffffff'], [0.5, '#dfe2e6'], [1, '#a5abb4']]), 4.5);
  for (let x = 62; x < W - 40; x += 46) { line(g, x, top + 8, x, deck - 6, OUT, 6); line(g, x, top + 8, x, deck - 6, '#c3c8cf', 2.5); }
  box(g, 8, top - 8, W - 16, 16, 6, vgrad(g, top - 8, top + 8, [[0, '#f2f4f7'], [1, '#9097a2']]), 4);
  return k.c;
}

function paintFlat(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const deck = 152, bed = 134;
  carBase(g, W, H, deck);
  // The load: two crates and a strapped stack of logs. (Painted in its own colours: this car is not tinted.)
  const crate = (x: number, y: number, w: number, h: number): void => {
    box(g, x, y, w, h, 4, vgrad(g, y, y + h, [[0, '#e0b377'], [1, '#a8763f']]), 4);
    g.save(); rr(g, x + 4, y + 4, w - 8, h - 8, 2); g.clip();
    line(g, x + 4, y + 4, x + w - 4, y + h - 4, 'rgba(70,40,16,0.55)', 5); line(g, x + w - 4, y + 4, x + 4, y + h - 4, 'rgba(70,40,16,0.55)', 5);
    g.restore();
    g.strokeStyle = 'rgba(70,40,16,0.7)'; g.lineWidth = 3; g.strokeRect(x + 6, y + 6, w - 12, h - 12);
  };
  crate(40, bed - 78, 84, 78); crate(132, bed - 58, 62, 58); crate(60, bed - 78 - 46, 50, 46);
  const log = (x: number, y: number): void => {
    box(g, x, y - 15, 178, 30, 14, vgrad(g, y - 15, y + 15, [[0, '#b98a5a'], [1, '#6f4a2a']]), 3.5);
    disc(g, x + 164, y, 13, '#e6c79a', 3); disc(g, x + 164, y, 6, '#c59b68', 0);
  };
  log(222, bed - 15); log(222, bed - 45); log(232, bed - 75);
  for (const x of [262, 352]) { line(g, x, bed - 92, x, bed, OUT, 7); line(g, x, bed - 92, x, bed, '#9aa1ac', 3); }
  // The plank deck with its stake pockets.
  box(g, 14, bed, W - 28, 20, 5, vgrad(g, bed, bed + 20, [[0, '#c79a62'], [1, '#7d5330']]), 4.5);
  line(g, 22, bed + 5, W - 22, bed + 5, 'rgba(255,236,200,0.45)', 2);
  for (let x = 40; x < W - 30; x += 46) box(g, x - 5, bed + 6, 10, 14, 2, IRON_M, 2.5);
  return k.c;
}

function paintCaboose(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const top = 62, deck = 168, foot = H - 1;
  const red = (y0: number, y1: number): CanvasGradient => vgrad(g, y0, y1, [[0, '#f0766a'], [0.5, '#cf463c'], [1, '#8f2a24']]);
  const win = (x: number, y: number, w: number, h: number): void => {
    box(g, x, y, w, h, 5, vgrad(g, y, y + h, [[0, '#ffe7a6'], [1, '#f2a93c']]), 4);
    line(g, x + 5, y + 6, x + w * 0.45, y + 6, 'rgba(255,255,255,0.7)', 2.5);
  };
  box(g, 14, deck, W - 28, 14, 4, IRON_D, 3.5);
  truck(g, 80, foot, 19); truck(g, W - 80, foot, 19);
  couplers(g, W, deck + 7);
  // The end platforms and their railings.
  for (const x of [20, W - 20]) { line(g, x, deck, x, deck - 54, OUT, 6); line(g, x, deck, x, deck - 54, '#d8b25a', 2.5); }
  line(g, 20, deck - 54, 44, deck - 54, OUT, 6); line(g, W - 20, deck - 54, W - 44, deck - 54, OUT, 6);
  // The cupola, then the body, its windows, a gold stripe, and the roofs.
  box(g, 126, 26, 100, 44, 6, red(26, 70), 4.5);
  win(140, 36, 30, 22); win(182, 36, 30, 22);
  box(g, 116, 16, 120, 14, 7, vgrad(g, 16, 30, [[0, '#5d626c'], [1, '#2b2d33']]), 4.5);
  box(g, 40, top, W - 80, deck - top + 2, 6, red(top, deck), 4.5);
  for (let x = 66; x < W - 50; x += 26) line(g, x, top + 10, x, deck - 6, 'rgba(80,16,12,0.3)', 2);
  win(64, top + 24, 44, 38); win(W / 2 - 22, top + 24, 44, 38); win(W - 108, top + 24, 44, 38);
  g.fillStyle = vgrad(g, deck - 28, deck - 20, BRASS as unknown as [number, string][]); g.fillRect(42, deck - 28, W - 84, 7);
  box(g, 28, top - 10, W - 56, 16, 7, vgrad(g, top - 10, top + 6, [[0, '#5d626c'], [1, '#2b2d33']]), 4.5);
  // The tail lamp at the back (the left end).
  disc(g, 34, top + 44, 8, '#ff5a4a', 3.5);
  disc(g, 32, top + 42, 2.5, '#ffd0c8', 0);
  return k.c;
}

// ─── the crossing signal ───────────────────────────────────────────────────────────────────────────────────────

function paintSignal(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const cx = W / 2;
  // The base and the post (hazard stripes at its foot).
  box(g, cx - 30, H - 30, 60, 28, 6, vgrad(g, H - 30, H, [[0, '#b9bec7'], [1, '#6c727c']]), 4);
  box(g, cx - 9, 50, 18, H - 78, 5, vgrad(g, 0, H, [[0, '#f0f2f5'], [1, '#aab0ba']]), 4);
  g.save(); rr(g, cx - 9, H - 130, 18, 100, 4); g.clip();
  for (let y = H - 150; y < H; y += 26) poly(g, [[cx - 12, y + 16], [cx + 12, y], [cx + 12, y + 12], [cx - 12, y + 28]], '#2b2d33', 0);
  g.restore();
  line(g, cx - 4, 60, cx - 4, H - 140, 'rgba(255,255,255,0.7)', 2.5);
  // The box the gate arm pivots on.
  box(g, cx - 22, 276, 44, 50, 7, vgrad(g, 276, 326, [[0, '#5d626c'], [1, '#2b2d33']]), 4);
  disc(g, cx, 300, 9, '#aab1bb', 3);
  // The lamp bar and its two housings: black backboards with hoods, dark red lenses (the glow is its own sprite).
  box(g, cx - 62, 194, 124, 12, 5, IRON_M, 4);
  for (const x of [cx - 52, cx + 52]) {
    disc(g, x, 200, 34, '#1d1e22', 4.5);
    g.beginPath(); g.arc(x, 200, 26, Math.PI * 1.08, Math.PI * 1.92); g.strokeStyle = '#4a4e57'; g.lineWidth = 7; g.lineCap = 'round'; g.stroke();
    disc(g, x, 202, 20, '#6e1712', 3);
    g.fillStyle = 'rgba(255,170,150,0.55)'; g.beginPath(); g.arc(x - 7, 195, 5.5, 0, Math.PI * 2); g.fill();
  }
  // The crossbuck: two white boards crossed, with dark end caps (no lettering).
  for (const a of [-0.56, 0.56]) {
    g.save(); g.translate(cx, 104); g.rotate(a);
    box(g, -86, -15, 172, 30, 5, vgrad(g, -15, 15, [[0, '#ffffff'], [1, '#d9dde3']]), 4.5);
    g.fillStyle = '#2b2d33'; g.fillRect(-82, -11, 14, 22); g.fillRect(68, -11, 14, 22);
    g.restore();
  }
  disc(g, cx, 104, 8, '#aab1bb', 3);
  // The bell on top.
  g.beginPath(); g.arc(cx, 44, 20, Math.PI, 0); g.lineTo(cx + 24, 50); g.lineTo(cx - 24, 50); g.closePath();
  g.fillStyle = vgrad(g, 24, 50, BRASS as unknown as [number, string][]); g.fill(); g.strokeStyle = OUT; g.lineWidth = 4; g.lineJoin = 'round'; g.stroke();
  disc(g, cx, 20, 6, '#e8b944', 3);
  line(g, cx - 10, 34, cx - 4, 30, 'rgba(255,255,255,0.8)', 3);
  return k.c;
}

function paintGate(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const y = H / 2;
  // The arm: a tapering white board with red stripes, a counterweight behind the pivot and a lamp at the tip.
  const arm = (): void => { g.beginPath(); g.moveTo(34, y - 12); g.lineTo(W - 14, y - 7); g.lineTo(W - 14, y + 7); g.lineTo(34, y + 12); g.closePath(); };
  arm(); g.fillStyle = vgrad(g, y - 12, y + 12, [[0, '#ffffff'], [1, '#d5d9df']]); g.fill();
  g.save(); arm(); g.clip();
  g.fillStyle = '#d93a2e';
  for (let x = 60; x < W; x += 64) { g.beginPath(); g.moveTo(x, y - 14); g.lineTo(x + 30, y - 14); g.lineTo(x + 18, y + 14); g.lineTo(x - 12, y + 14); g.closePath(); g.fill(); }
  g.restore();
  arm(); g.strokeStyle = OUT; g.lineWidth = 4; g.lineJoin = 'round'; g.stroke();
  box(g, 3, y - 17, 44, 34, 6, vgrad(g, y - 17, y + 17, [[0, '#5d626c'], [1, '#2b2d33']]), 4);
  disc(g, W - 12, y, 8, '#ff5a4a', 3);
  return k.c;
}

// ─── the small things ──────────────────────────────────────────────────────────────────────────────────────────

function paintPuff(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  // A cloud of overlapping lobes: a cool rim, a white body, a brighter crown. Soft enough to stack.
  const lobes: [number, number, number][] = [[0, 0.04, 0.3], [-0.2, 0.06, 0.2], [0.21, 0.07, 0.2], [-0.1, -0.15, 0.2], [0.11, -0.13, 0.2], [0, 0.17, 0.2]];
  const blob = (grow: number, fill: string): void => {
    g.fillStyle = fill;
    for (const [x, y, r] of lobes) { g.beginPath(); g.arc(c + x * D, c + y * D, r * D + grow, 0, Math.PI * 2); g.fill(); }
  };
  blob(4, 'rgba(120,140,170,0.5)');
  blob(0, '#dfe6f0');
  g.save();
  g.beginPath(); for (const [x, y, r] of lobes) { g.moveTo(c + x * D + r * D, c + y * D); g.arc(c + x * D, c + y * D, r * D, 0, Math.PI * 2); } g.clip();
  const gr = g.createRadialGradient(c - D * 0.08, c - D * 0.14, D * 0.04, c, c, D * 0.5);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, D, D);
  g.restore();
  return k.c;
}

function paintOre(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const p = (x: number, y: number): [number, number] => [x * D, y * D];
  // A faceted chunk, pale (the tint is its glow colour): a bright top face, a mid face, a dark base.
  poly(g, [p(0.14, 0.6), p(0.3, 0.16), p(0.66, 0.1), p(0.9, 0.44), p(0.72, 0.88), p(0.3, 0.9)], '#c8c8c8', 4);
  poly(g, [p(0.3, 0.16), p(0.66, 0.1), p(0.56, 0.46), p(0.34, 0.5)], '#ffffff', 0);
  poly(g, [p(0.66, 0.1), p(0.9, 0.44), p(0.56, 0.46)], '#e6e6e6', 0);
  poly(g, [p(0.34, 0.5), p(0.56, 0.46), p(0.72, 0.88), p(0.3, 0.9)], '#a0a0a0', 0);
  g.strokeStyle = OUT; g.lineWidth = 3.5; g.lineJoin = 'round';
  g.beginPath(); [p(0.14, 0.6), p(0.3, 0.16), p(0.66, 0.1), p(0.9, 0.44), p(0.72, 0.88), p(0.3, 0.9)].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke();
  return k.c;
}

function paintBonk(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const star = (R: number, r: number): void => {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2, q = i % 2 ? r : R;
      if (i) g.lineTo(c + Math.cos(a) * q, c + Math.sin(a) * q); else g.moveTo(c + Math.cos(a) * q, c + Math.sin(a) * q);
    }
    g.closePath();
  };
  // A fat five-pointed star, pale (tinted yellow), rounded by its thick outline.
  star(D * 0.44, D * 0.22);
  g.lineJoin = 'round'; g.strokeStyle = OUT; g.lineWidth = D * 0.09; g.stroke();
  g.fillStyle = vgrad(g, 0, D, [[0, '#ffffff'], [0.6, '#f0f0f0'], [1, '#c4c4c4']]); g.fill();
  star(D * 0.25, D * 0.13);
  g.fillStyle = 'rgba(255,255,255,0.75)'; g.fill();
  return k.c;
}

let cached: HeroTrainTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroTrainTextures(): HeroTrainTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  if (!base) return null;
  const size = (kd: UnitKind): [number, number] => [UNIT_SHAPES[kd].tw, UNIT_SHAPES[kd].th];
  const painted = {
    track: paintTrack(TRACK_W, TRACK_H), handcar: paintHandcar(...size('handcar')), handle: paintHandle(HANDLE_W, 56), cart: paintCart(...size('cart')),
    engine: paintEngine(...size('engine')), tender: paintTender(...size('tender')), box: paintBox(...size('box')), tank: paintTank(...size('tank')),
    hopper: paintHopper(...size('hopper')), flat: paintFlat(...size('flat')), caboose: paintCaboose(...size('caboose')), wheel: paintWheel(WHEEL_PX),
    rod: paintRod(ROD_W, ROD_H), signal: paintSignal(SIGNAL_W, SIGNAL_H), gate: paintGate(GATE_W, GATE_H), puff: paintPuff(PUFF_PX), ore: paintOre(ORE_PX),
    bonk: paintBonk(BONK_PX),
  };
  const out: Record<string, Texture> = {};
  for (const [name, cv] of Object.entries(painted)) {
    if (!cv) return null;
    out[name] = tex(cv);
  }
  cached = { ...base, ...(out as unknown as Omit<HeroTrainTextures, keyof typeof base>) };
  return cached;
}
