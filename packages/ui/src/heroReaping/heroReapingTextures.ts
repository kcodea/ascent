/**
 * The Reaping's textures, painted ONCE per session on 2D canvases and kept (eight small canvases on top of the shared
 * Blast set it reuses for soft glows, rings, sparks and streaks). Light only: no drawn props (the second pass removed
 * the hooded shadow, its snath and the candle).
 *
 *  - The BLADE is a long thin crescent of light pointing along +x, its cutting (inner) edge toward +y: a teal halo, a
 *    teal body paling toward the edge, and a bone-white cutting edge. Drawn untinted and additive, so it reads as light.
 *    The same texture tinted black is its soft shade underneath (so it still reads over a bright board).
 *  - The CRESCENT is Tiers 3 and 4's great blade: a WIDE crescent of light, heel at the left, point at the right, the
 *    spine bowed toward -y and the white-hot cutting edge toward +y (the side that leads the sweep). Same palette as
 *    the blade, several times its weight. Tinted teal it is its own afterimage; tinted black, its shade.
 *  - The LINE is a white strip profile (a hot core, a soft falloff, soft ends): the hairline along a cut, the line Tier 4's
 *    cut leaves across the screen, and the bright front of the colour flooding back.
 *  - The MOTE is a white fleck (a hot centre, a short soft halo) that the scene tints with the stolen hues.
 *  - The RAINBOW crescent (Tier 4) is the same great crescent painted in every colour along its length, a white-hot
 *    edge kept: the blade once the stolen colour is wound onto it.
 *  - The SHARD is a long sharp sliver of glass-like light (a bright facet, a paler face) that the scene tints: the orb
 *    of colour shattering (Tier 3).
 *  - The RIBBON is a strip of light faint at its tail and bright at its head, for the ribbons of colour wound out of the
 *    portrait (Tier 4) along a rope mesh.
 *  - The CRACKS are a round web of old-paint craquelure (dark fissures with a pale lip), seeded so every session paints
 *    the same: the loser cracking like old paint (Tier 4).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroBlastTextures } from '../heroBlast/heroBlastTextures';
import type { HeroReapingTextures } from './heroReapingScene';

/** Texture sizes the scene scales by. */
export const BLADE_TEX_W = 512;
export const BLADE_TEX_H = 128;
/** Where the blade's heel and point sit along the texture (0..1). */
export const BLADE_HEEL_U = 40 / 512;
export const BLADE_POINT_U = 500 / 512;
export const LINE_TEX_W = 256;
export const LINE_TEX_H = 32;
export const CRESCENT_TEX_W = 512;
export const CRESCENT_TEX_H = 176;
/** The crescent's heel and point along the texture (0..1), and where the heel-to-point chord sits down it (0..1). */
export const CRESCENT_HEEL_U = 24 / 512;
export const CRESCENT_POINT_U = 492 / 512;
export const CRESCENT_CHORD_V = 124 / 176;
export const MOTE_TEX = 32;
export const SHARD_TEX_W = 64;
export const SHARD_TEX_H = 20;
export const RIBBON_TEX_W = 256;
export const RIBBON_TEX_H = 32;
export const CRACK_TEX = 256;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** The crescent: heel at the left, point at the right, the spine bowed up, the cutting edge the shallower inner curve. */
function bladePath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(40, 70);
  g.quadraticCurveTo(250, -6, 500, 62); // the spine
  g.quadraticCurveTo(270, 44, 40, 70); // the cutting edge
  g.closePath();
}

function paintBlade(): HTMLCanvasElement | null {
  const k = canvas(BLADE_TEX_W, BLADE_TEX_H); if (!k) return null;
  const g = k.g;
  // The halo: two soft passes of teal.
  g.shadowColor = 'rgba(47,224,188,0.9)'; g.shadowBlur = 22;
  bladePath(g); g.fillStyle = 'rgba(47,224,188,0.55)'; g.fill();
  g.shadowBlur = 9;
  bladePath(g);
  // The body: deep teal at the spine, paling to bone at the cutting edge.
  const body = g.createLinearGradient(0, 14, 0, 70);
  body.addColorStop(0, '#0f7f6c'); body.addColorStop(0.55, '#2fe0bc'); body.addColorStop(1, '#eafff8');
  g.fillStyle = body; g.fill();
  g.shadowBlur = 0;
  // The cutting edge: a bone-white hairline that thins to the point.
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,250,0.95)'; g.lineWidth = 3.2;
  g.beginPath(); g.moveTo(52, 69); g.quadraticCurveTo(270, 45, 492, 62.5); g.stroke();
  // A darker line under the spine gives the crescent a second plane.
  g.strokeStyle = 'rgba(6,60,52,0.55)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(70, 61); g.quadraticCurveTo(255, 6, 470, 56); g.stroke();
  // The point: a small white-hot glint.
  const pt = g.createRadialGradient(494, 62, 0, 494, 62, 16);
  pt.addColorStop(0, 'rgba(255,255,255,1)'); pt.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = pt; g.fillRect(474, 42, 38, 40);
  return k.c;
}

/** A strip of light: a hot core and a soft falloff across it, soft ends along it. */
function paintLine(): HTMLCanvasElement | null {
  const k = canvas(LINE_TEX_W, LINE_TEX_H); if (!k) return null;
  const g = k.g;
  const v = g.createLinearGradient(0, 0, 0, LINE_TEX_H);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.3, 'rgba(255,255,255,0.14)'); v.addColorStop(0.44, 'rgba(255,255,255,0.6)');
  v.addColorStop(0.5, 'rgba(255,255,255,1)'); v.addColorStop(0.56, 'rgba(255,255,255,0.6)'); v.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v; g.fillRect(0, 0, LINE_TEX_W, LINE_TEX_H);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, LINE_TEX_W, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.06, 'rgba(0,0,0,1)'); h.addColorStop(0.97, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h; g.fillRect(0, 0, LINE_TEX_W, LINE_TEX_H);
  return k.c;
}

/** The great crescent's outline: heel at the left, point at the right, a deep spine, a shallower cutting edge. */
function crescentPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(24, 128);
  g.quadraticCurveTo(250, -44, 492, 120); // the spine
  g.quadraticCurveTo(262, 92, 24, 128); // the cutting edge
  g.closePath();
}

function paintCrescent(): HTMLCanvasElement | null {
  const k = canvas(CRESCENT_TEX_W, CRESCENT_TEX_H); if (!k) return null;
  const g = k.g;
  // The halo: a wide soft pass of teal, then a tighter one.
  g.shadowColor = 'rgba(47,224,188,0.95)'; g.shadowBlur = 30;
  crescentPath(g); g.fillStyle = 'rgba(47,224,188,0.6)'; g.fill();
  g.shadowBlur = 12;
  crescentPath(g);
  // The body: deep teal at the spine, bright teal through the middle, bone white toward the cutting edge.
  const body = g.createLinearGradient(0, 34, 0, 118);
  body.addColorStop(0, '#0c6f5f'); body.addColorStop(0.45, '#2fe0bc'); body.addColorStop(0.8, '#b9fff0'); body.addColorStop(1, '#ffffff');
  g.fillStyle = body; g.fill();
  g.shadowBlur = 0;
  // Light running along the blade inside the body (two soft arcs), so it is a sheet of light and not a flat shape.
  g.save();
  crescentPath(g); g.clip();
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(234,255,248,0.34)'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(60, 112); g.quadraticCurveTo(256, 30, 460, 108); g.stroke();
  g.strokeStyle = 'rgba(6,60,52,0.5)'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(54, 104); g.quadraticCurveTo(252, -14, 468, 100); g.stroke();
  g.restore();
  // The cutting edge: a white-hot line that thins to the point, inside a tight glow.
  g.lineCap = 'round';
  g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 8;
  g.strokeStyle = 'rgba(255,255,252,1)'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(40, 126.5); g.quadraticCurveTo(262, 93, 480, 120); g.stroke();
  g.shadowBlur = 0;
  // The point: a white-hot glint.
  const pt = g.createRadialGradient(488, 120, 0, 488, 120, 22);
  pt.addColorStop(0, 'rgba(255,255,255,1)'); pt.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = pt; g.fillRect(462, 96, 50, 48);
  return k.c;
}

/** The great crescent in every colour along its length (heel red, through gold and green, to violet at the point). */
function paintRainbow(): HTMLCanvasElement | null {
  const k = canvas(CRESCENT_TEX_W, CRESCENT_TEX_H); if (!k) return null;
  const g = k.g;
  const hues = (a: number): CanvasGradient => {
    const h = g.createLinearGradient(24, 0, 492, 0);
    const stops = ['255,64,96', '255,150,40', '255,226,70', '80,230,110', '50,210,255', '110,120,255', '220,90,255'];
    stops.forEach((c, i) => h.addColorStop(i / (stops.length - 1), `rgba(${c},${a})`));
    return h;
  };
  g.shadowColor = 'rgba(255,255,255,0.7)'; g.shadowBlur = 30;
  crescentPath(g); g.fillStyle = hues(0.6); g.fill();
  g.shadowBlur = 0;
  crescentPath(g); g.fillStyle = hues(1); g.fill();
  // Deeper at the spine, paler toward the cutting edge: a sheet of coloured light, not a flat shape.
  g.save();
  crescentPath(g); g.clip();
  const v = g.createLinearGradient(0, 34, 0, 124);
  v.addColorStop(0, 'rgba(0,0,0,0.35)'); v.addColorStop(0.5, 'rgba(255,255,255,0)'); v.addColorStop(0.85, 'rgba(255,255,255,0.45)'); v.addColorStop(1, 'rgba(255,255,255,0.85)');
  g.fillStyle = v; g.fillRect(0, 0, CRESCENT_TEX_W, CRESCENT_TEX_H);
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 7;
  g.beginPath(); g.moveTo(60, 112); g.quadraticCurveTo(256, 30, 460, 108); g.stroke();
  g.restore();
  g.lineCap = 'round';
  g.shadowColor = 'rgba(255,255,255,0.95)'; g.shadowBlur = 10;
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(40, 126.5); g.quadraticCurveTo(262, 93, 480, 120); g.stroke();
  g.shadowBlur = 0;
  const pt = g.createRadialGradient(488, 120, 0, 488, 120, 22);
  pt.addColorStop(0, 'rgba(255,255,255,1)'); pt.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = pt; g.fillRect(462, 96, 50, 48);
  return k.c;
}

/** A sliver of glass-like light: a long sharp quad, one facet brighter, a bright ridge down it (white; tinted). */
function paintShard(): HTMLCanvasElement | null {
  const k = canvas(SHARD_TEX_W, SHARD_TEX_H); if (!k) return null;
  const g = k.g;
  const W = SHARD_TEX_W, H = SHARD_TEX_H;
  const path = (): void => { g.beginPath(); g.moveTo(1, H * 0.55); g.lineTo(W * 0.3, 2); g.lineTo(W - 1, H * 0.42); g.lineTo(W * 0.42, H - 2); g.closePath(); };
  g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 4;
  path(); g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
  g.shadowBlur = 0;
  g.beginPath(); g.moveTo(1, H * 0.55); g.lineTo(W * 0.3, 2); g.lineTo(W - 1, H * 0.42); g.closePath();
  g.fillStyle = 'rgba(255,255,255,1)'; g.fill();
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(3, H * 0.55); g.lineTo(W - 3, H * 0.42); g.stroke();
  return k.c;
}

/** A ribbon of light along a rope: faint at the tail (u = 0), bright at the head, a hot middle line, soft edges. */
function paintRibbon(): HTMLCanvasElement | null {
  const k = canvas(RIBBON_TEX_W, RIBBON_TEX_H); if (!k) return null;
  const g = k.g;
  const v = g.createLinearGradient(0, 0, 0, RIBBON_TEX_H);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.22, 'rgba(255,255,255,0.35)'); v.addColorStop(0.42, 'rgba(255,255,255,0.85)');
  v.addColorStop(0.5, 'rgba(255,255,255,1)'); v.addColorStop(0.58, 'rgba(255,255,255,0.85)'); v.addColorStop(0.78, 'rgba(255,255,255,0.35)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v; g.fillRect(0, 0, RIBBON_TEX_W, RIBBON_TEX_H);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, RIBBON_TEX_W, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)'); h.addColorStop(0.3, 'rgba(0,0,0,0.6)'); h.addColorStop(0.9, 'rgba(0,0,0,1)'); h.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = h; g.fillRect(0, 0, RIBBON_TEX_W, RIBBON_TEX_H);
  return k.c;
}

/** Old-paint craquelure over a round portrait: fissures branching across it, dark with a pale lip. Seeded. */
function paintCracks(): HTMLCanvasElement | null {
  const k = canvas(CRACK_TEX, CRACK_TEX); if (!k) return null;
  const g = k.g;
  const D = CRACK_TEX, c = D / 2;
  let seed = 0x5eed;
  const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const lines: [number, number, number, number, number][] = [];
  const grow = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
    let px = x, py = y, ang = a;
    const steps = 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < steps; i++) {
      ang += (rnd() - 0.5) * 0.9;
      const l = (len / steps) * (0.6 + rnd() * 0.8);
      const nx = px + Math.cos(ang) * l, ny = py + Math.sin(ang) * l;
      lines.push([px, py, nx, ny, w * (1 - i / (steps + 2))]);
      if (depth > 0 && rnd() < 0.42) grow(nx, ny, ang + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd() * 0.7), len * 0.55, w * 0.7, depth - 1);
      px = nx; py = ny;
    }
  };
  // Fissures out from the middle (where the cut went), and a few from the rim inward: old paint crazes everywhere.
  for (let i = 0; i < 7; i++) grow(c + (rnd() - 0.5) * 30, c + (rnd() - 0.5) * 30, (i / 7) * Math.PI * 2 + rnd() * 0.5, D * 0.5, 3.4, 2);
  for (let i = 0; i < 6; i++) { const a = rnd() * Math.PI * 2; grow(c + Math.cos(a) * (c - 6), c + Math.sin(a) * (c - 6), a + Math.PI + (rnd() - 0.5) * 0.8, D * 0.26, 2.3, 1); }
  g.save();
  g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.clip();
  g.lineCap = 'round'; g.lineJoin = 'round';
  // The pale lip (offset down and right), then the dark fissure on it.
  for (const [x0, y0, x1, y1, w] of lines) { g.strokeStyle = 'rgba(235,228,214,0.6)'; g.lineWidth = w + 1.6; g.beginPath(); g.moveTo(x0 + 1, y0 + 1.2); g.lineTo(x1 + 1, y1 + 1.2); g.stroke(); }
  for (const [x0, y0, x1, y1, w] of lines) { g.strokeStyle = 'rgba(14,12,10,0.95)'; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  g.restore();
  return k.c;
}

/** A fleck of colour: a hot centre and a short halo (white; the scene tints it). */
function paintMote(): HTMLCanvasElement | null {
  const k = canvas(MOTE_TEX, MOTE_TEX); if (!k) return null;
  const g = k.g;
  const c = MOTE_TEX / 2;
  const r = g.createRadialGradient(c, c, 0, c, c, c);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.22, 'rgba(255,255,255,0.95)'); r.addColorStop(0.42, 'rgba(255,255,255,0.4)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, MOTE_TEX, MOTE_TEX);
  return k.c;
}

let cached: HeroReapingTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroReapingTextures(): HeroReapingTextures | null {
  if (cached) return cached;
  const base = heroBlastTextures();
  const blade = paintBlade(), crescent = paintCrescent(), line = paintLine(), mote = paintMote();
  const rainbow = paintRainbow(), shard = paintShard(), ribbon = paintRibbon(), cracks = paintCracks();
  if (!base || !blade || !crescent || !line || !mote || !rainbow || !shard || !ribbon || !cracks) return null;
  cached = {
    ...base, blade: tex(blade), crescent: tex(crescent), line: tex(line), mote: tex(mote),
    rainbow: tex(rainbow), shard: tex(shard), ribbon: tex(ribbon), cracks: tex(cracks),
  };
  return cached;
}
