/**
 * The Grand Finale's textures, painted ONCE per session on 2D canvases and kept (three small props, about 250 KB of GPU
 * memory on top of the Blast and Arcana basics it shares: glow, spark, streak, ring and the four-point star).
 *
 * The three fireworks are painted in full colour, upright, with their fuse on the LEFT (the scene mirrors one whose
 * hero stands to its right). The numbers here match `PROP_METRICS` in the config (the anchor, the mouth, the fuse):
 *  - the BOTTLE ROCKET: a paper tube in magenta with gold stripes and bands, a cyan nose cone, a long wooden stick
 *    taped down its side and a curl of fuse out of its tail;
 *  - the ROMAN CANDLE: a tall teal tube with gold stars, magenta bands top and bottom, an open mouth, a wooden foot and
 *    a fuse off its top rim;
 *  - the MORTAR: a fat navy tube with gold bands and a gold star, a dark open mouth, a wooden plank under it and a fuse
 *    trailing out over the plank.
 * Each has cylinder shading (a soft highlight down the left third, a shaded right edge), a dark navy outline so the
 * silhouette stays clean on any board, and no flame anywhere.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { PROP_METRICS } from './heroFireworksConfig';
import type { HeroFireworksTextures } from './heroFireworksScene';

type G = CanvasRenderingContext2D;

/** Painted at 2x so a prop stays crisp when the stage is scaled up. */
const SS = 2;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: G } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w * SS; c.height = h * SS;
  const g = c.getContext('2d');
  if (!g) return null;
  g.scale(SS, SS);
  g.lineJoin = 'round'; g.lineCap = 'round';
  return { c, g };
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

const INK = '#141a33';
const GOLD = '#f7c948';
const GOLD_DEEP = '#c98f1e';
const MAGENTA = '#e23a92';
const TEAL = '#1f9fb0';
const CYAN = '#49d6ee';
const NAVY = '#27305c';

function rr(g: G, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** Cylinder shading over whatever is already painted in the box: a highlight down the left third, shade on the right. */
function shadeTube(g: G, x: number, y: number, w: number, h: number): void {
  const gr = g.createLinearGradient(x, 0, x + w, 0);
  gr.addColorStop(0, 'rgba(10,14,40,0.38)'); gr.addColorStop(0.16, 'rgba(255,255,255,0.06)');
  gr.addColorStop(0.3, 'rgba(255,255,255,0.42)'); gr.addColorStop(0.44, 'rgba(255,255,255,0.04)');
  gr.addColorStop(0.72, 'rgba(10,14,40,0.14)'); gr.addColorStop(1, 'rgba(10,14,40,0.5)');
  g.fillStyle = gr; g.fillRect(x, y, w, h);
}

/** A five-point star, filled. */
function star5(g: G, cx: number, cy: number, r: number, rot = -Math.PI / 2): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i / 10) * Math.PI * 2, rad = i % 2 ? r * 0.44 : r;
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath(); g.fill();
}

/** A fuse: a pale cord with a dark outline through the points given, ending in a frayed tip. */
function fuse(g: G, pts: readonly [number, number][], w: number): void {
  const draw = (): void => {
    g.beginPath(); g.moveTo(pts[0]![0], pts[0]![1]);
    if (pts.length === 3) g.quadraticCurveTo(pts[1]![0], pts[1]![1], pts[2]![0], pts[2]![1]);
    else g.bezierCurveTo(pts[1]![0], pts[1]![1], pts[2]![0], pts[2]![1], pts[3]![0], pts[3]![1]);
    g.stroke();
  };
  g.strokeStyle = INK; g.lineWidth = w + 2.4; draw();
  g.strokeStyle = '#e9e2cf'; g.lineWidth = w; draw();
  g.strokeStyle = 'rgba(120,96,60,0.7)'; g.lineWidth = w * 0.35; g.setLineDash([1.5, 3]); draw(); g.setLineDash([]);
}

/** A wooden bar (the rocket's stick, a foot, the mortar's plank): a warm gradient, grain lines and an outline. */
function wood(g: G, x: number, y: number, w: number, h: number, r: number, vertical: boolean): void {
  const gr = vertical ? g.createLinearGradient(x, 0, x + w, 0) : g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#e2b877'); gr.addColorStop(0.45, '#c08a4a'); gr.addColorStop(1, '#7d5127');
  rr(g, x, y, w, h, r); g.fillStyle = gr; g.fill();
  g.save(); rr(g, x, y, w, h, r); g.clip();
  g.strokeStyle = 'rgba(86,52,20,0.45)'; g.lineWidth = 0.8;
  if (vertical) { g.beginPath(); g.moveTo(x + w * 0.62, y); g.lineTo(x + w * 0.62, y + h); g.stroke(); } else {
    for (const f of [0.36, 0.68]) { g.beginPath(); g.moveTo(x, y + h * f); g.bezierCurveTo(x + w * 0.3, y + h * (f - 0.12), x + w * 0.6, y + h * (f + 0.14), x + w, y + h * f); g.stroke(); }
  }
  g.restore();
  rr(g, x, y, w, h, r); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
}

/** The open mouth of a tube: a dark ellipse with a lit near rim. */
function mouth(g: G, cx: number, cy: number, rx: number, ry: number, rim: string): void {
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  const gr = g.createLinearGradient(0, cy - ry, 0, cy + ry);
  gr.addColorStop(0, '#05060f'); gr.addColorStop(1, '#2a2f55');
  g.fillStyle = gr; g.fill();
  g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
  g.beginPath(); g.ellipse(cx, cy, rx - 1.6, ry - 1.2, 0, 0.1 * Math.PI, 0.9 * Math.PI);
  g.strokeStyle = rim; g.lineWidth = 1.6; g.stroke();
}

function paintRocket(): HTMLCanvasElement | null {
  const M = PROP_METRICS.rocket;
  const k = canvas(M.w, M.h); if (!k) return null;
  const g = k.g;
  // The stick, taped down the right side of the body and running to the foot.
  wood(g, 37, 40, 5, 138, 2, true);
  // The fuse, out of the tail: its lit end is (11, 122), its root (22, 94).
  fuse(g, [[22, 94], [24, 112], [11, 108], [11, 122]], 2.2);
  // The paper tube.
  const bx = 12, by = 30, bw = 24, bh = 60;
  g.save();
  rr(g, bx, by, bw, bh, 3); g.clip();
  g.fillStyle = MAGENTA; g.fillRect(bx, by, bw, bh);
  g.strokeStyle = GOLD; g.lineWidth = 4.5;
  for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(bx - 4, by + 18 + i * 13); g.lineTo(bx + bw + 4, by + 4 + i * 13); g.stroke(); }
  g.fillStyle = GOLD; g.fillRect(bx, by, bw, 7); g.fillRect(bx, by + bh - 8, bw, 8);
  g.fillStyle = GOLD_DEEP; g.fillRect(bx, by + 6, bw, 1.4); g.fillRect(bx, by + bh - 9, bw, 1.4);
  shadeTube(g, bx, by, bw, bh);
  g.restore();
  rr(g, bx, by, bw, bh, 3); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
  // Two turns of tape holding the stick.
  g.fillStyle = '#f3ecd8'; g.strokeStyle = INK; g.lineWidth = 1.4;
  for (const y of [46, 72]) { rr(g, 30, y, 13, 6, 1.5); g.fill(); g.stroke(); }
  // The nose cone: its tip is the "mouth" (8).
  g.beginPath(); g.moveTo(24, 8); g.quadraticCurveTo(37, 20, 38, 31); g.lineTo(10, 31); g.quadraticCurveTo(11, 20, 24, 8); g.closePath();
  const ng = g.createLinearGradient(10, 0, 38, 0);
  ng.addColorStop(0, '#1c8ea6'); ng.addColorStop(0.32, '#a8f1ff'); ng.addColorStop(0.5, CYAN); ng.addColorStop(1, '#14718a');
  g.fillStyle = ng; g.fill(); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
  // The nozzle.
  rr(g, 18, 89, 12, 5, 1.5); g.fillStyle = '#3a3f66'; g.fill(); g.strokeStyle = INK; g.lineWidth = 1.6; g.stroke();
  return k.c;
}

function paintCandle(): HTMLCanvasElement | null {
  const M = PROP_METRICS.candle;
  const k = canvas(M.w, M.h); if (!k) return null;
  const g = k.g;
  // The fuse off the top rim: lit end (6, 28), root (21, 19).
  fuse(g, [[21, 19], [12, 14], [6, 28]], 2.4);
  // The wooden foot.
  wood(g, 10, 164, 52, 14, 3, false);
  // The tube.
  const bx = 20, by = 16, bw = 32, bh = 152;
  g.save();
  rr(g, bx, by, bw, bh, 3); g.clip();
  g.fillStyle = TEAL; g.fillRect(bx, by, bw, bh);
  g.fillStyle = MAGENTA; g.fillRect(bx, by, bw, 22); g.fillRect(bx, by + bh - 26, bw, 26);
  g.fillStyle = GOLD; g.fillRect(bx, by + 22, bw, 4); g.fillRect(bx, by + bh - 30, bw, 4);
  g.fillStyle = GOLD;
  [[36, 60, 7.5], [29, 86, 5], [43, 104, 6], [33, 126, 5]].forEach(([x, y, r], i) => star5(g, x!, y!, r!, -Math.PI / 2 + i * 0.3));
  shadeTube(g, bx, by, bw, bh);
  g.restore();
  rr(g, bx, by, bw, bh, 3); g.strokeStyle = INK; g.lineWidth = 2; g.stroke();
  mouth(g, 36, 17, 15, 5, '#ffd9ec');
  return k.c;
}

function paintMortar(): HTMLCanvasElement | null {
  const M = PROP_METRICS.mortar;
  const k = canvas(M.w, M.h); if (!k) return null;
  const g = k.g;
  // The plank.
  wood(g, 6, 126, 120, 24, 4, false);
  // The fuse, out of the tube's side and over the plank: lit end (8, 112), root (35, 94).
  fuse(g, [[35, 94], [22, 92], [20, 112], [8, 112]], 2.8);
  // The tube.
  const bx = 34, by = 20, bw = 64, bh = 112;
  g.save();
  rr(g, bx, by, bw, bh, 5); g.clip();
  g.fillStyle = NAVY; g.fillRect(bx, by, bw, bh);
  g.fillStyle = GOLD; g.fillRect(bx, by + 12, bw, 8); g.fillRect(bx, by + bh - 22, bw, 8);
  g.fillStyle = GOLD_DEEP; g.fillRect(bx, by + 19, bw, 1.6); g.fillRect(bx, by + bh - 15, bw, 1.6);
  g.fillStyle = GOLD; star5(g, 66, 78, 17);
  g.fillStyle = MAGENTA; star5(g, 66, 78, 7.5);
  shadeTube(g, bx, by, bw, bh);
  g.restore();
  rr(g, bx, by, bw, bh, 5); g.strokeStyle = INK; g.lineWidth = 2.4; g.stroke();
  mouth(g, 66, 22, 30, 8, '#ffe9a6');
  // Two brackets holding the tube to the plank.
  g.fillStyle = '#4a5080'; g.strokeStyle = INK; g.lineWidth = 1.8;
  for (const x of [26, 94]) { rr(g, x, 118, 12, 12, 2); g.fill(); g.stroke(); }
  return k.c;
}

let cached: HeroFireworksTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroFireworksTextures(): HeroFireworksTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const rocket = paintRocket(), candle = paintCandle(), mortar = paintMortar();
  if (!base || !rocket || !candle || !mortar) return null;
  cached = { ...base, rocket: tex(rocket), candle: tex(candle), mortar: tex(mortar) };
  return cached;
}
