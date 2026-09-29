/**
 * The Undead attack's textures, painted ONCE per session on 2D canvases and kept (about 1 MB of GPU memory, most of it
 * the skull), on top of the Blast and Arcana textures it shares (glow, spark, streak, ring, beam, star).
 *
 * Everything is WHITE (grey where it is shaded), so every sprite tints it: the same skull is a purple-black body under
 * a sickly green glow and a bone-white edge. THE SKULL is two pieces that line up on one hinge point: the cranium (dome,
 * slanted eye sockets, the nasal cavity and the upper teeth, cut out as real holes) and the jaw (the lower teeth), so the
 * scene can drop the jaw to SHRIEK and snap it shut to BITE. Each piece has a fill and a line-work "edge" layer, and a
 * soft silhouette (the glow and the afterimages) is painted at half size.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { seededRng } from '../heroAttack/easing';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroUndeadTextures } from './heroUndeadScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

// ─── the skull ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The cranium canvas, and where the hinge sits in it (the jaw's top edge lines up here when the jaw is shut). */
export const SKULL_W = 320;
export const CRANIUM_H = 256;
export const JAW_H = 128;
export const HINGE_Y = 200;
/** The skull's visible width in its own px (x 38..282), for sizing it to a portrait. */
export const SKULL_SPAN = 244;
/** From the hinge UP to the skull's visual centre (the eyes), in its own px: place the hinge this far below a centre. */
export const SKULL_CENTRE_ABOVE_HINGE = 50;
/** How far the jaw drops when it is fully open, in its own px. */
export const JAW_DROP = 58;
/** The eyes' centres, relative to the hinge, in its own px (left, right). */
export const EYE_OFFSETS: readonly [number, number][] = [[-47, -64], [47, -64]];
/** The half-size silhouette's canvas and its hinge. */
export const GLOW_W = 170;
export const GLOW_H = 200;
export const GLOW_HINGE_Y = 106;

const CX = SKULL_W / 2;

function craniumPath(g: CanvasRenderingContext2D, ox = CX, oy = 0, k = 1): void {
  const X = (x: number): number => ox + (x - CX) * k;
  const Y = (y: number): number => oy + y * k;
  g.beginPath();
  g.moveTo(X(160), Y(6));
  g.bezierCurveTo(X(250), Y(6), X(290), Y(70), X(282), Y(128));
  g.bezierCurveTo(X(279), Y(156), X(268), Y(168), X(262), Y(184));
  g.bezierCurveTo(X(258), Y(200), X(238), Y(206), X(222), Y(212));
  g.lineTo(X(216), Y(246));
  g.lineTo(X(104), Y(246));
  g.lineTo(X(98), Y(212));
  g.bezierCurveTo(X(82), Y(206), X(62), Y(200), X(58), Y(184));
  g.bezierCurveTo(X(52), Y(168), X(41), Y(156), X(38), Y(128));
  g.bezierCurveTo(X(30), Y(70), X(70), Y(6), X(160), Y(6));
  g.closePath();
}

/** One eye socket (s = -1 left, 1 right): slanted down toward the nose, a hard brow on top. */
function socketPath(g: CanvasRenderingContext2D, s: number): void {
  const X = (x: number): number => CX + s * x;
  g.beginPath();
  g.moveTo(X(80), 112);
  g.quadraticCurveTo(X(52), 102, X(20), 122);
  g.quadraticCurveTo(X(10), 150, X(32), 162);
  g.quadraticCurveTo(X(64), 170, X(78), 150);
  g.quadraticCurveTo(X(88), 130, X(80), 112);
  g.closePath();
}

function nosePath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(CX, 160);
  g.quadraticCurveTo(CX - 8, 176, CX - 15, 194);
  g.quadraticCurveTo(CX, 202, CX + 15, 194);
  g.quadraticCurveTo(CX + 8, 176, CX, 160);
  g.closePath();
}

/** The jaw, in the JAW canvas (its y 0 is the hinge line, cranium y 200). */
function jawPath(g: CanvasRenderingContext2D, ox = CX, oy = 0, k = 1): void {
  const X = (x: number): number => ox + (x - CX) * k;
  const Y = (y: number): number => oy + y * k;
  g.beginPath();
  g.moveTo(X(62), Y(0));
  g.lineTo(X(70), Y(50));
  g.quadraticCurveTo(X(86), Y(108), X(160), Y(116));
  g.quadraticCurveTo(X(234), Y(108), X(250), Y(50));
  g.lineTo(X(258), Y(0));
  g.lineTo(X(240), Y(0));
  g.lineTo(X(232), Y(38));
  g.quadraticCurveTo(X(226), Y(50), X(214), Y(46));
  g.lineTo(X(106), Y(46));
  g.quadraticCurveTo(X(94), Y(50), X(88), Y(38));
  g.lineTo(X(80), Y(0));
  g.closePath();
}

function paintCranium(edge: boolean): HTMLCanvasElement | null {
  const k = canvas(SKULL_W, CRANIUM_H); if (!k) return null;
  const g = k.g;
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (!edge) {
    // The bone: lit from the upper left, shadowed at the temples and cheeks (grey = darker once tinted).
    const lit = g.createRadialGradient(130, 70, 20, 160, 120, 190);
    lit.addColorStop(0, '#ffffff'); lit.addColorStop(0.55, '#e4e4e4'); lit.addColorStop(1, '#9a9a9a');
    g.fillStyle = lit; craniumPath(g); g.fill();
    // Shadow pooling round the sockets and under the cheekbones.
    g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 16;
    for (const s of [-1, 1]) { socketPath(g, s); g.stroke(); }
    g.lineWidth = 10; nosePath(g); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath(); g.ellipse(CX, 222, 60, 12, 0, 0, Math.PI * 2); g.fill();
    // The holes: sockets, the nasal cavity and the gaps between the upper teeth.
    g.globalCompositeOperation = 'destination-out';
    for (const s of [-1, 1]) { socketPath(g, s); g.fill(); }
    nosePath(g); g.fill();
    for (let i = 0; i <= 7; i++) {
      const x = 106 + i * 15.4;
      g.fillRect(x - 1.6, 224, 3.2, 24);
    }
    g.globalCompositeOperation = 'source-over';
    return k.c;
  }
  // THE EDGE: line work only (the outline, the socket and nose rims, the tooth lines, a crack across the dome).
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 5;
  g.lineWidth = 4; craniumPath(g); g.stroke();
  g.lineWidth = 3.4;
  for (const s of [-1, 1]) { socketPath(g, s); g.stroke(); }
  g.lineWidth = 2.6; nosePath(g); g.stroke();
  g.lineWidth = 2;
  for (let i = 0; i <= 7; i++) { const x = 106 + i * 15.4; g.beginPath(); g.moveTo(x, 222); g.lineTo(x, 246); g.stroke(); }
  g.beginPath(); g.moveTo(104, 220); g.lineTo(216, 220); g.stroke();
  // The crack: down from the crown, forking.
  g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(186, 10); g.lineTo(180, 32); g.lineTo(192, 50); g.lineTo(184, 74); g.lineTo(196, 92); g.stroke();
  g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(192, 50); g.lineTo(212, 58); g.lineTo(220, 76); g.stroke();
  // Brow ridges catch the light.
  g.lineWidth = 2.2;
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(CX + s * 84, 104); g.quadraticCurveTo(CX + s * 52, 92, CX + s * 18, 112); g.stroke(); }
  return k.c;
}

function paintJaw(edge: boolean): HTMLCanvasElement | null {
  const k = canvas(SKULL_W, JAW_H); if (!k) return null;
  const g = k.g;
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (!edge) {
    const lit = g.createLinearGradient(0, 0, 0, JAW_H);
    lit.addColorStop(0, '#f2f2f2'); lit.addColorStop(1, '#a4a4a4');
    g.fillStyle = lit; jawPath(g); g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i <= 7; i++) { const x = 106 + i * 15.4; g.fillRect(x - 1.6, 44, 3.2, 26); }
    g.globalCompositeOperation = 'source-over';
    return k.c;
  }
  g.strokeStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 5;
  g.lineWidth = 4; jawPath(g); g.stroke();
  g.lineWidth = 2;
  for (let i = 0; i <= 7; i++) { const x = 106 + i * 15.4; g.beginPath(); g.moveTo(x, 46); g.lineTo(x, 70); g.stroke(); }
  g.beginPath(); g.moveTo(106, 72); g.lineTo(214, 72); g.stroke();
  return k.c;
}

/** The soft silhouette of the whole skull (jaw shut), at half size: the glow behind it and every afterimage. */
function paintSkullGlow(): HTMLCanvasElement | null {
  const k = canvas(GLOW_W, GLOW_H); if (!k) return null;
  const g = k.g;
  const s = 0.5;
  const ox = GLOW_W / 2, oy = GLOW_HINGE_Y - HINGE_Y * s;
  g.fillStyle = '#fff'; g.shadowColor = '#fff';
  // The shadow of shapes drawn far off canvas: only the blur lands (a soft silhouette, no hard edge).
  g.translate(-4000, 0);
  g.shadowOffsetX = 4000;
  for (const blur of [12, 5]) {
    g.shadowBlur = blur;
    craniumPath(g, ox, oy, s); g.fill();
    jawPath(g, ox, oy + HINGE_Y * s, s); g.fill();
  }
  return k.c;
}

// ─── the white shapes (tinted per sprite) ──────────────────────────────────────────────────────────────────────

/** A ghost wisp pointing +X: a bright round head, a tail tapering and feathering back to nothing (anchor at the head). */
export const WISP_HEAD_X = 0.78;
function paintWisp(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const hx = W * WISP_HEAD_X, y = H / 2;
  const body = g.createLinearGradient(0, 0, hx, 0);
  body.addColorStop(0, 'rgba(255,255,255,0)'); body.addColorStop(0.55, 'rgba(255,255,255,0.35)'); body.addColorStop(1, 'rgba(255,255,255,0.95)');
  g.fillStyle = body; g.shadowColor = '#fff'; g.shadowBlur = H * 0.18;
  g.beginPath();
  g.moveTo(2, y);
  g.quadraticCurveTo(hx * 0.5, y - H * 0.26, hx, y - H * 0.3);
  g.arc(hx, y, H * 0.3, -Math.PI / 2, Math.PI / 2);
  g.quadraticCurveTo(hx * 0.5, y + H * 0.26, 2, y);
  g.closePath(); g.fill();
  const head = g.createRadialGradient(hx, y, 0, hx, y, H * 0.36);
  head.addColorStop(0, 'rgba(255,255,255,1)'); head.addColorStop(1, 'rgba(255,255,255,0)');
  g.shadowBlur = 0; g.fillStyle = head; g.fillRect(hx - H * 0.4, 0, H * 0.8, H);
  return k.c;
}

/** A skeletal hand reaching UP (its wrist at the bottom, the anchor): forearm bones, carpals, clawed fingers. */
export const HAND_W = 128, HAND_H = 192, HAND_WRIST_Y = 184;
function paintHand(): HTMLCanvasElement | null {
  const k = canvas(HAND_W, HAND_H); if (!k) return null;
  const g = k.g;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = 2;
  const bone = (x0: number, y0: number, x1: number, y1: number, w: number): void => {
    g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.beginPath(); g.arc(x0, y0, w * 0.62, 0, Math.PI * 2); g.arc(x1, y1, w * 0.62, 0, Math.PI * 2); g.fill();
  };
  // forearm (radius + ulna) and the carpals
  bone(56, HAND_WRIST_Y, 58, 150, 8);
  bone(72, HAND_WRIST_Y, 70, 150, 7);
  g.beginPath(); g.ellipse(64, 140, 20, 12, 0, 0, Math.PI * 2); g.fill();
  // four fingers: metacarpal, then three phalanges curling inward at the tips (a claw)
  const fingers: [number, number, number][] = [[44, -0.32, 0.85], [57, -0.1, 1], [71, 0.1, 0.96], [84, 0.3, 0.8]];
  for (const [bx, lean, len] of fingers) {
    let x = bx, y = 132, a = -Math.PI / 2 + lean;
    const segs = [30 * len, 22 * len, 16 * len, 12 * len];
    const curl = [0, 0.08, 0.22, 0.5];
    const w = [6.5, 5.5, 4.8, 3.8];
    for (let i = 0; i < 4; i++) {
      a += curl[i]! * (bx < 64 ? 1 : -1) * 0.9;
      const nx = x + Math.cos(a) * segs[i]!, ny = y + Math.sin(a) * segs[i]!;
      bone(x, y, nx, ny, w[i]!);
      x = nx; y = ny;
    }
    // the claw tip
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a + 0.5) * 7, y + Math.sin(a + 0.5) * 7); g.lineWidth = 3; g.stroke();
  }
  // the thumb, off to the side
  let x = 42, y = 146, a = -Math.PI * 0.85;
  for (const [ln, w, cu] of [[22, 6, 0], [16, 5, 0.35], [11, 4, 0.45]] as const) {
    a += cu;
    const nx = x + Math.cos(a) * ln, ny = y + Math.sin(a) * ln;
    bone(x, y, nx, ny, w);
    x = nx; y = ny;
  }
  return k.c;
}

/** The necrotic grave circle: a thick outer ring, angular runes, an inner ring with thorns pointing in, a clear middle. */
function paintNecro(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.018;
  const ring = (r: number, w: number): void => { g.lineWidth = w; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); };
  ring(D * 0.465, D * 0.024);
  ring(D * 0.405, D * 0.01);
  // Angular runes between the rings (each a little bind-rune of straight strokes, seeded so they never change).
  const rnd = seededRng(6166);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = D * 0.435;
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    const tx = -Math.sin(a), ty = Math.cos(a), rx = Math.cos(a), ry = Math.sin(a);
    const s = D * 0.02;
    g.lineWidth = D * 0.008;
    g.beginPath();
    g.moveTo(x - rx * s, y - ry * s); g.lineTo(x + rx * s, y + ry * s); // the stave
    const kind = Math.floor(rnd() * 4);
    if (kind === 0) { g.moveTo(x + rx * s, y + ry * s); g.lineTo(x + tx * s, y + ty * s); g.moveTo(x + rx * s, y + ry * s); g.lineTo(x - tx * s, y - ty * s); }
    else if (kind === 1) { g.moveTo(x, y); g.lineTo(x + tx * s + rx * s * 0.5, y + ty * s + ry * s * 0.5); g.lineTo(x - rx * s * 0.6, y - ry * s * 0.6); }
    else if (kind === 2) { g.moveTo(x - tx * s, y - ty * s); g.lineTo(x + tx * s, y + ty * s); g.moveTo(x - tx * s * 0.6 + rx * s * 0.6, y - ty * s * 0.6 + ry * s * 0.6); g.lineTo(x + tx * s * 0.6 - rx * s * 0.6, y + ty * s * 0.6 - ry * s * 0.6); }
    else { g.moveTo(x - rx * s, y - ry * s); g.lineTo(x + tx * s, y + ty * s); g.lineTo(x + rx * s, y + ry * s); }
    g.stroke();
  }
  ring(D * 0.31, D * 0.013);
  // Thorns pointing inward off the inner ring.
  const nt = 18;
  for (let i = 0; i < nt; i++) {
    const a = (i / nt) * Math.PI * 2 + Math.PI / nt;
    const w = 0.07;
    const r0 = D * 0.31, r1 = D * (i % 2 ? 0.25 : 0.225);
    g.beginPath();
    g.moveTo(c + Math.cos(a - w) * r0, c + Math.sin(a - w) * r0);
    g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    g.lineTo(c + Math.cos(a + w) * r0, c + Math.sin(a + w) * r0);
    g.closePath(); g.fill();
  }
  // Small crescents at the four quarters, between the outer rings and the thorns.
  g.lineWidth = D * 0.009;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = c + Math.cos(a) * D * 0.36, y = c + Math.sin(a) * D * 0.36;
    g.beginPath(); g.arc(x, y, D * 0.022, a + 0.9, a + Math.PI * 2 - 0.9); g.stroke();
  }
  return k.c;
}

/** The rift: a jagged tear pointing along +X (a lens with broken edges). `edge` paints only its lit rim. */
function paintRift(W: number, H: number, edge: boolean): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(1313);
  const y = H / 2;
  const top: [number, number][] = [], bot: [number, number][] = [];
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const x = 4 + ((W - 8) * i) / n;
    const h = Math.pow(Math.sin((Math.PI * i) / n), 0.85) * H * 0.42;
    top.push([x + (rnd() - 0.5) * 5, y - h * (0.62 + rnd() * 0.38)]);
    bot.push([x + (rnd() - 0.5) * 5, y + h * (0.62 + rnd() * 0.38)]);
  }
  g.beginPath();
  top.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
  for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i]![0], bot[i]![1]);
  g.closePath();
  if (edge) {
    g.strokeStyle = '#fff'; g.lineJoin = 'round'; g.shadowColor = '#fff'; g.shadowBlur = 7; g.lineWidth = 3.2; g.stroke();
  } else {
    g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 4; g.fill();
  }
  return k.c;
}

/** A crack pointing +X from its origin (anchor at the left): a jagged line with two small branches. */
function paintCrack(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(2929);
  const y = H / 2;
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = H * 0.2;
  const pts: [number, number][] = [[2, y]];
  for (let x = 12; x < W - 4; x += 10 + rnd() * 6) pts.push([x, y + (rnd() - 0.5) * H * 0.5]);
  pts.push([W - 3, y]);
  const along = g.createLinearGradient(0, 0, W, 0);
  along.addColorStop(0, 'rgba(255,255,255,1)'); along.addColorStop(1, 'rgba(255,255,255,0.2)');
  g.strokeStyle = along;
  g.lineWidth = H * 0.16;
  g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke();
  g.lineWidth = H * 0.08;
  for (const bi of [3, 6]) {
    const p = pts[Math.min(bi, pts.length - 1)]!;
    const s = bi === 3 ? -1 : 1;
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + 12, p[1] + s * H * 0.24); g.lineTo(p[0] + 22, p[1] + s * H * 0.38); g.stroke();
  }
  return k.c;
}

/** A soft, lumpy puff of grave mist. */
function paintMist(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(7373);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2, r = D * 0.14 * rnd();
    const x = D / 2 + Math.cos(a) * r, y = D / 2 + Math.sin(a) * r;
    const rr = D * (0.2 + rnd() * 0.14);
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, D, D);
  }
  return k.c;
}

/** A bone shard: a thin, broken sliver. */
function paintShard(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(1, H * 0.55); g.lineTo(W * 0.3, 1); g.lineTo(W * 0.62, H * 0.3); g.lineTo(W - 1, H * 0.45); g.lineTo(W * 0.7, H - 1); g.lineTo(W * 0.25, H * 0.8); g.closePath(); g.fill();
  return k.c;
}

let cached: HeroUndeadTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (Undead then skips Pixi). */
export function heroUndeadTextures(): HeroUndeadTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const cranium = paintCranium(false), craniumEdge = paintCranium(true), jaw = paintJaw(false), jawEdge = paintJaw(true);
  const skullGlow = paintSkullGlow(), wisp = paintWisp(64, 32), hand = paintHand(), necro = paintNecro(256);
  const rift = paintRift(256, 96, false), riftEdge = paintRift(256, 96, true), crack = paintCrack(128, 24), mist = paintMist(64), shard = paintShard(16, 8);
  if (!base || !cranium || !craniumEdge || !jaw || !jawEdge || !skullGlow || !wisp || !hand || !necro || !rift || !riftEdge || !crack || !mist || !shard) return null;
  cached = {
    ...base,
    cranium: tex(cranium), craniumEdge: tex(craniumEdge), jaw: tex(jaw), jawEdge: tex(jawEdge), skullGlow: tex(skullGlow),
    wisp: tex(wisp), hand: tex(hand), necro: tex(necro), rift: tex(rift), riftEdge: tex(riftEdge), crack: tex(crack), mist: tex(mist), shard: tex(shard),
  };
  return cached;
}
