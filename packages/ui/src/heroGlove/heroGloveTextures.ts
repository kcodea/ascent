/**
 * The Sucker Punch's textures, painted ONCE per session on 2D canvases and kept (a few small canvases on top of the
 * shared Blast / Arcana set it reuses for glows, rings and glints). Greys and whites, so every sprite tints them:
 *  - GLOVE: a boxing glove seen side on, knuckles to the right: the padded mitt, the thumb lying along the top, the
 *    cuff. Shaded as a round, padded thing (light upper front, dark underside) with a dark outline, so the red tint
 *    gives a lit red glove with deep red shadows and outline.
 *  - GLOVE TRIM: what stays white over the red: the glossy highlights (the leather's shine), the criss-cross laces and
 *    their eyelets, and the piping round the cuff.
 *  - COIL: one stroke of the spring's wire (a round-ended steel bar, lit along its top edge). The scene lays a row of
 *    them end to end as a zig-zag and stretches each to fit.
 *  - HATCH: a riveted ring round a dark hole (the porthole the glove springs from).
 *  - STAR: a chunky five-point cartoon star (the bop's flying stars, and the ones that circle a dizzy head).
 *  - BURST: a crisp comic impact star (the BOP).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroGloveTextures } from './heroGloveScene';

/** The glove canvas: its length runs along x. The scene scales by `glove px / GLOVE_W`. */
export const GLOVE_W = 256;
export const GLOVE_H = 208;
/** One coil stroke: the bar's canvas, and the distance between its two round ends' centres. */
export const COIL_W = 64;
export const COIL_H = 16;
export const COIL_SPAN = COIL_W - COIL_H;
export const HATCH_D = 128;
export const STAR_D = 64;
export const BURST_D = 128;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

const AY = GLOVE_H / 2; // the glove's axis

/** The padded mitt: a fat rounded fist, fullest at the knuckles (right). */
function mittPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(86, AY - 62);
  g.bezierCurveTo(118, AY - 96, 196, AY - 98, 226, AY - 62);
  g.bezierCurveTo(254, AY - 30, 254, AY + 38, 226, AY + 66);
  g.bezierCurveTo(198, AY + 94, 122, AY + 92, 88, AY + 64);
  g.bezierCurveTo(74, AY + 44, 72, AY - 40, 86, AY - 62);
  g.closePath();
}

/** The cuff: a short sleeve behind the mitt, flaring a touch toward the open end (left). */
function cuffPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(20, AY - 50);
  g.quadraticCurveTo(60, AY - 46, 96, AY - 42);
  g.lineTo(96, AY + 42);
  g.quadraticCurveTo(60, AY + 46, 20, AY + 50);
  g.quadraticCurveTo(8, AY, 20, AY - 50);
  g.closePath();
}

/** The thumb: a lobe lying along the top of the fist. */
function thumbPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(94, AY - 34);
  g.bezierCurveTo(96, AY - 66, 150, AY - 74, 182, AY - 62);
  g.bezierCurveTo(204, AY - 52, 200, AY - 26, 176, AY - 22);
  g.bezierCurveTo(150, AY - 18, 120, AY - 16, 94, AY - 34);
  g.closePath();
}

function paintGlove(): HTMLCanvasElement | null {
  const k = canvas(GLOVE_W, GLOVE_H); if (!k) return null;
  const g = k.g;
  const OUT = 'rgb(58,58,58)';
  g.lineJoin = 'round';
  // The cuff, behind the mitt: a sleeve lit along its top.
  const cuff = g.createLinearGradient(0, AY - 50, 0, AY + 50);
  cuff.addColorStop(0, 'rgb(235,235,235)'); cuff.addColorStop(0.45, 'rgb(205,205,205)'); cuff.addColorStop(1, 'rgb(120,120,120)');
  g.fillStyle = cuff; cuffPath(g); g.fill();
  g.strokeStyle = OUT; g.lineWidth = 6; cuffPath(g); g.stroke();
  // The mitt: round and padded, lit from the upper front, deep underneath.
  const mitt = g.createRadialGradient(186, AY - 46, 8, 160, AY - 4, 132);
  mitt.addColorStop(0, 'rgb(255,255,255)'); mitt.addColorStop(0.45, 'rgb(232,232,232)'); mitt.addColorStop(0.8, 'rgb(170,170,170)'); mitt.addColorStop(1, 'rgb(118,118,118)');
  g.fillStyle = mitt; mittPath(g); g.fill();
  // A soft shadow under the fist's belly and where the mitt meets the cuff (inside the shape only).
  g.save(); mittPath(g); g.clip();
  const belly = g.createLinearGradient(0, AY + 20, 0, AY + 96);
  belly.addColorStop(0, 'rgba(60,60,60,0)'); belly.addColorStop(1, 'rgba(60,60,60,0.55)');
  g.fillStyle = belly; g.fillRect(60, AY + 20, 200, 80);
  const wrist = g.createLinearGradient(74, 0, 112, 0);
  wrist.addColorStop(0, 'rgba(60,60,60,0.5)'); wrist.addColorStop(1, 'rgba(60,60,60,0)');
  g.fillStyle = wrist; g.fillRect(70, 0, 44, GLOVE_H);
  // The padding seam: a stitched curve round the knuckle pad.
  g.strokeStyle = 'rgba(70,70,70,0.6)'; g.lineWidth = 2.5; g.setLineDash([7, 5]);
  g.beginPath(); g.moveTo(200, AY - 80); g.bezierCurveTo(176, AY - 30, 178, AY + 40, 206, AY + 82); g.stroke();
  g.setLineDash([]);
  g.restore();
  g.strokeStyle = OUT; g.lineWidth = 6; mittPath(g); g.stroke();
  // The thumb, over the mitt: its own roundness and a crease along its underside.
  const thumb = g.createLinearGradient(0, AY - 72, 0, AY - 18);
  thumb.addColorStop(0, 'rgb(255,255,255)'); thumb.addColorStop(0.55, 'rgb(226,226,226)'); thumb.addColorStop(1, 'rgb(150,150,150)');
  g.fillStyle = thumb; thumbPath(g); g.fill();
  g.strokeStyle = OUT; g.lineWidth = 5; thumbPath(g); g.stroke();
  return k.c;
}

function paintGloveTrim(): HTMLCanvasElement | null {
  const k = canvas(GLOVE_W, GLOVE_H); if (!k) return null;
  const g = k.g;
  g.lineCap = 'round'; g.lineJoin = 'round';
  // The shine: one broad soft highlight on the knuckle pad, a hard little glint beside it, a streak along the thumb.
  const soft = (x: number, y: number, rx: number, ry: number, rot: number, a: number): void => {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(rx, ry);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.6, `rgba(255,255,255,${(a * 0.55).toFixed(3)})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  soft(214, AY - 34, 20, 34, 0.42, 0.85);
  soft(232, AY + 6, 5, 9, 0.2, 0.9);
  soft(140, AY - 56, 34, 6.5, -0.06, 0.8);
  soft(58, AY - 34, 30, 5, 0.06, 0.45);
  // The piping: a white band round the open end of the cuff and a thinner one where the cuff meets the mitt.
  g.save(); cuffPath(g); g.clip();
  g.fillStyle = '#fff'; g.fillRect(0, 0, 30, GLOVE_H);
  g.fillStyle = 'rgba(120,120,120,0.55)'; g.fillRect(0, AY + 22, 30, 40); // the band's own underside shade
  g.restore();
  g.strokeStyle = 'rgb(58,58,58)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(30, AY - 49); g.quadraticCurveTo(34, AY, 30, AY + 49); g.stroke();
  // The laces: three crosses up the cuff, tied off with eyelets at each end.
  const top = AY - 26, bot = AY + 26;
  g.strokeStyle = 'rgba(40,40,40,0.55)'; g.lineWidth = 8.5;
  for (let i = 0; i < 3; i++) {
    const x = 40 + i * 17;
    g.beginPath(); g.moveTo(x, top); g.lineTo(x + 15, bot); g.moveTo(x + 15, top); g.lineTo(x, bot); g.stroke();
  }
  g.strokeStyle = '#fff'; g.lineWidth = 5;
  for (let i = 0; i < 3; i++) {
    const x = 40 + i * 17;
    g.beginPath(); g.moveTo(x, top); g.lineTo(x + 15, bot); g.moveTo(x + 15, top); g.lineTo(x, bot); g.stroke();
  }
  g.fillStyle = '#fff';
  for (let i = 0; i < 4; i++) {
    for (const y of [top, bot]) {
      g.beginPath(); g.arc(40 + i * 17 - (i === 3 ? 2 : 0), y, 4.2, 0, Math.PI * 2); g.fill();
    }
  }
  return k.c;
}

function paintCoil(): HTMLCanvasElement | null {
  const k = canvas(COIL_W, COIL_H); if (!k) return null;
  const g = k.g;
  const r = COIL_H / 2;
  const bar = (inset: number): void => {
    g.beginPath();
    g.moveTo(r, inset); g.lineTo(COIL_W - r, inset);
    g.arc(COIL_W - r, r, r - inset, -Math.PI / 2, Math.PI / 2);
    g.lineTo(r, COIL_H - inset);
    g.arc(r, r, r - inset, Math.PI / 2, -Math.PI / 2);
    g.closePath();
  };
  g.fillStyle = 'rgb(46,46,46)'; bar(0); g.fill(); // the outline
  const steel = g.createLinearGradient(0, 2, 0, COIL_H - 2);
  steel.addColorStop(0, 'rgb(255,255,255)'); steel.addColorStop(0.35, 'rgb(236,236,236)'); steel.addColorStop(0.7, 'rgb(170,170,170)'); steel.addColorStop(1, 'rgb(112,112,112)');
  g.fillStyle = steel; bar(2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(r, 4.4); g.lineTo(COIL_W - r, 4.4); g.stroke();
  return k.c;
}

function paintHatch(): HTMLCanvasElement | null {
  const k = canvas(HATCH_D, HATCH_D); if (!k) return null;
  const g = k.g;
  const C = HATCH_D / 2;
  // The rim: a thick metal ring, lit from the top, with a dark outline inside and out.
  g.fillStyle = 'rgb(44,44,44)'; g.beginPath(); g.arc(C, C, 62, 0, Math.PI * 2); g.fill();
  const rim = g.createLinearGradient(0, C - 58, 0, C + 58);
  rim.addColorStop(0, 'rgb(255,255,255)'); rim.addColorStop(0.5, 'rgb(205,205,205)'); rim.addColorStop(1, 'rgb(120,120,120)');
  g.fillStyle = rim; g.beginPath(); g.arc(C, C, 58, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgb(44,44,44)'; g.beginPath(); g.arc(C, C, 41, 0, Math.PI * 2); g.fill();
  // The hole: near black, a touch lighter low down (the far wall catching light).
  const hole = g.createRadialGradient(C, C + 16, 4, C, C, 38);
  hole.addColorStop(0, 'rgb(52,48,56)'); hole.addColorStop(1, 'rgb(8,8,12)');
  g.fillStyle = hole; g.beginPath(); g.arc(C, C, 37, 0, Math.PI * 2); g.fill();
  // Rivets round the rim.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = C + Math.cos(a) * 49.5, y = C + Math.sin(a) * 49.5;
    g.fillStyle = 'rgb(70,70,70)'; g.beginPath(); g.arc(x, y + 0.8, 4.2, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgb(250,250,250)'; g.beginPath(); g.arc(x, y - 0.6, 3.2, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

function starPath(g: CanvasRenderingContext2D, c: number, outer: number, inner: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 ? inner : outer;
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

function paintStar(): HTMLCanvasElement | null {
  const k = canvas(STAR_D, STAR_D); if (!k) return null;
  const g = k.g;
  const C = STAR_D / 2;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgb(70,70,70)'; g.lineWidth = 7; starPath(g, C, 25, 12); g.stroke();
  const body = g.createLinearGradient(0, 6, 0, STAR_D - 6);
  body.addColorStop(0, 'rgb(255,255,255)'); body.addColorStop(0.55, 'rgb(240,240,240)'); body.addColorStop(1, 'rgb(170,170,170)');
  g.fillStyle = body; starPath(g, C, 25, 12); g.fill();
  return k.c;
}

function paintBurst(): HTMLCanvasElement | null {
  const k = canvas(BURST_D, BURST_D); if (!k) return null;
  const g = k.g;
  const C = BURST_D / 2;
  const pts = 11;
  g.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const a = (i / (pts * 2)) * Math.PI * 2 + 0.2;
    const r = i % 2 ? 22 + (i % 3) * 3 : 56 - (i % 4) * 5;
    const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = '#fff'; g.fill();
  return k.c;
}

let cached: HeroGloveTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroGloveTextures(): HeroGloveTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const glove = paintGlove(), trim = paintGloveTrim(), coil = paintCoil(), hatch = paintHatch(), star5 = paintStar(), burst = paintBurst();
  if (!base || !glove || !trim || !coil || !hatch || !star5 || !burst) return null;
  cached = { ...base, glove: tex(glove), gloveTrim: tex(trim), coil: tex(coil), hatch: tex(hatch), star5: tex(star5), burst: tex(burst) };
  return cached;
}
