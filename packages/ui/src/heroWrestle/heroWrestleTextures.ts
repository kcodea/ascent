/**
 * The Top Rope (wrestling) attack's textures, painted ONCE per session on 2D canvases and kept (on top of the shared
 * Blast / Arcana set it reuses for glows, rings, stars, sparks and streaks). Flat 2D, clean shapes:
 *  - TUBE: one length of LIGHT lying along +x, solid from edge to edge with a soft falloff above and below (white, so
 *    each of the ring's three ropes is tinted its own colour and the corner pillars gold); the scene stretches and turns
 *    it between two points, which is how the ropes bow out and snap back. The ring is light, not painted props (the
 *    second pass dropped the steel posts, their turnbuckle pads and the brass bell: owner 2026-11-12, no clip art).
 *  - MAT: the lit square of canvas, a floor seen in perspective (a trapezoid, narrower at the back): a faint fill and a
 *    bright edge.
 *  - CONE: the spotlight's cone, its apex at the top centre, fading down its length (white: tinted warm).
 *  - HAND: an open hand print (white: tinted red for the chop's mark on the struck portrait).
 *  - ARC: the chop's wide flat slap arc, a crescent tapered at both ends (white).
 *  - IMPACT: an uneven comic impact star with a dark outline (the elbow's leading star, the clothesline's hit).
 *  - PUFF: a lobed puff of canvas dust, lit from the top left.
 *  - SHADOW: a soft dark disc (what is about to land casts it on the mat).
 *  - NUMBERS and WORDS: the count's 1, 2, 3 and WOO!, SLAM!, WINNER! in heavy gold letters with a dark outline.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { RING_SKEW } from './heroWrestleConfig';
import type { HeroWrestleTextures } from './heroWrestleScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

export const TUBE_W = 64;
export const TUBE_H = 32;
export const MAT_W = 512;
export const MAT_H = 256;
export const CONE_W = 256;
export const CONE_H = 512;
export const HAND_PX = 128;
export const ARC_W = 256;
export const ARC_H = 128;
export const IMPACT_PX = 256;
export const PUFF_PX = 128;
export const SHADOW_PX = 64;
export const NUM_PX = 256;
export const WORD_W = 512;
export const WORD_H = 160;

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** A length of light: solid along x (two lengths butt together at a bend), a bright core and a soft falloff in y. */
function paintTube(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.36, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(0.64, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.22)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  return k.c;
}

/**
 * The lit canvas: a trapezoid whose top edge is `taper` of its bottom edge (the ring's floor in perspective), a faint
 * fill brighter toward the middle and a bright soft edge all round (the apron).
 */
function paintMat(W: number, H: number, taper: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const m = 10;
  const top = (W - 2 * m) * taper;
  const path = (): void => {
    g.beginPath();
    g.moveTo(W / 2 - top / 2, m); g.lineTo(W / 2 + top / 2, m); g.lineTo(W - m, H - m); g.lineTo(m, H - m);
    g.closePath();
  };
  const fill = g.createRadialGradient(W / 2, H * 0.55, H * 0.05, W / 2, H * 0.55, W * 0.55);
  fill.addColorStop(0, 'rgba(255,255,255,0.34)'); fill.addColorStop(0.6, 'rgba(255,255,255,0.2)'); fill.addColorStop(1, 'rgba(255,255,255,0.1)');
  path(); g.fillStyle = fill; g.fill();
  g.lineJoin = 'round';
  g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 8;
  path(); g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 4; g.stroke();
  return k.c;
}

function paintCone(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const cx = W / 2;
  // A soft-edged beam: a narrow mouth at the top widening to the full width, brightest down its middle.
  const down = g.createLinearGradient(0, 0, 0, H);
  down.addColorStop(0, 'rgba(255,255,255,0.95)'); down.addColorStop(0.5, 'rgba(255,255,255,0.6)'); down.addColorStop(1, 'rgba(255,255,255,0.32)');
  // Many thin layers, each a little narrower: a smooth falloff to the edges (six fat ones showed as bands).
  for (let i = 0; i < 24; i++) {
    const f = 1 - i * 0.034;
    g.globalAlpha = 0.055;
    g.fillStyle = down;
    g.beginPath();
    g.moveTo(cx - 9 * f, 0); g.lineTo(cx + 9 * f, 0); g.lineTo(cx + (W / 2 - 4) * f, H); g.lineTo(cx - (W / 2 - 4) * f, H);
    g.closePath(); g.fill();
  }
  g.globalAlpha = 1;
  return k.c;
}

function paintHand(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  g.translate(D / 2, D / 2); g.rotate(-0.18);
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 5;
  // The palm.
  rr(g, -D * 0.2, -D * 0.02, D * 0.4, D * 0.36, D * 0.12); g.fill();
  // Four fingers, pressed together and fanned a little (a flat knife-edge hand).
  const fingers: [number, number, number][] = [[-0.15, 0.3, -0.1], [-0.05, 0.36, -0.03], [0.05, 0.35, 0.04], [0.15, 0.29, 0.11]];
  for (const [fx, len, tilt] of fingers) {
    g.save();
    g.translate(D * fx, D * 0.02); g.rotate(tilt);
    rr(g, -D * 0.043, -D * len, D * 0.086, D * len + D * 0.06, D * 0.043); g.fill();
    g.restore();
  }
  // The thumb.
  g.save();
  g.translate(-D * 0.19, D * 0.16); g.rotate(-0.95);
  rr(g, -D * 0.045, -D * 0.2, D * 0.09, D * 0.24, D * 0.045); g.fill();
  g.restore();
  return k.c;
}

function paintArc(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  // A crescent sweeping left to right, bowed up: fat in the middle, drawn to a point at each end, brighter at the lead.
  const gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.85, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(6, H * 0.8);
  g.quadraticCurveTo(W * 0.5, -H * 0.42, W - 6, H * 0.62);
  g.quadraticCurveTo(W * 0.52, H * 0.22, 6, H * 0.8);
  g.closePath(); g.fill();
  return k.c;
}

function paintImpact(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const cx = D / 2, cy = D / 2;
  const R = D / 2 - 8;
  // Nine uneven points (long, short, medium...), like a comic-book hit.
  const tips = [1, 0.72, 0.92, 0.66, 0.98, 0.7, 0.86, 0.74, 0.94];
  g.beginPath();
  for (let i = 0; i < tips.length * 2; i++) {
    const a = (i / (tips.length * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = (i % 2 ? 0.42 : tips[i / 2]!) * R;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  const gr = g.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#fff6cf'); gr.addColorStop(1, '#ffd98a');
  g.fillStyle = gr; g.fill();
  g.strokeStyle = 'rgba(38,16,6,0.92)'; g.lineWidth = 7; g.lineJoin = 'round'; g.stroke();
  return k.c;
}

function paintPuff(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  // Three lobes of dust, each lit from the top left, with a soft edge.
  const lobes: [number, number, number][] = [[0.36, 0.56, 0.3], [0.62, 0.6, 0.27], [0.5, 0.38, 0.28]];
  for (const [fx, fy, fr] of lobes) {
    const x = D * fx, y = D * fy, r = D * fr;
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.65, '#e9e9e9'); gr.addColorStop(0.9, '#c2c2c2'); gr.addColorStop(1, 'rgba(170,170,170,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

function paintShadow(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const gr = g.createRadialGradient(D / 2, D / 2, 0, D / 2, D / 2, D / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, D, D);
  return k.c;
}

/** Heavy gold letters: a white keyline, a dark outline, a gold face lit from the top. */
function paintText(text: string, W: number, H: number, fill = 0.66): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  let size = Math.round(H * fill);
  const font = (): string => `italic 900 ${size}px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
  g.font = font();
  const w = g.measureText(text).width;
  if (w > W * 0.84) { size = Math.floor(size * ((W * 0.84) / w)); g.font = font(); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const x = W / 2, y = H / 2 + size * 0.04;
  g.lineJoin = 'round';
  g.strokeStyle = '#ffffff'; g.lineWidth = size * 0.3;
  g.strokeText(text, x, y);
  g.strokeStyle = '#2a1206'; g.lineWidth = size * 0.2;
  g.strokeText(text, x, y);
  const gr = g.createLinearGradient(0, y - size * 0.45, 0, y + size * 0.45);
  gr.addColorStop(0, '#fff7c2'); gr.addColorStop(0.5, '#ffd23f'); gr.addColorStop(1, '#f08a1c');
  g.fillStyle = gr;
  g.fillText(text, x, y);
  return k.c;
}

/** Every word and number the attack draws (player-facing: short and plain). */
export const WRESTLE_WORDS = ['WOO!', 'SLAM!', 'WINNER!'] as const;
export const WRESTLE_COUNTS = ['1', '2', '3'] as const;

let cached: HeroWrestleTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroWrestleTextures(): HeroWrestleTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const tube = paintTube(TUBE_W, TUBE_H), mat = paintMat(MAT_W, MAT_H, (1 - RING_SKEW) / (1 + RING_SKEW)), cone = paintCone(CONE_W, CONE_H), hand = paintHand(HAND_PX);
  const arc = paintArc(ARC_W, ARC_H), impact = paintImpact(IMPACT_PX), puff = paintPuff(PUFF_PX), shadow = paintShadow(SHADOW_PX);
  const words = WRESTLE_WORDS.map((w) => paintText(w, WORD_W, WORD_H));
  const nums = WRESTLE_COUNTS.map((n) => paintText(n, NUM_PX, NUM_PX, 0.8));
  if (!base || !tube || !mat || !cone || !hand || !arc || !impact || !puff || !shadow || words.some((w) => !w) || nums.some((n) => !n)) return null;
  const [woo, slam, winner] = words.map((w) => tex(w!));
  const [one, two, three] = nums.map((n) => tex(n!));
  cached = {
    ...base, tube: tex(tube), mat: tex(mat), cone: tex(cone), hand: tex(hand), arc: tex(arc), impact: tex(impact), puff: tex(puff), shadow: tex(shadow),
    wordWoo: woo!, wordSlam: slam!, wordWinner: winner!, num1: one!, num2: two!, num3: three!,
  };
  return cached;
}
