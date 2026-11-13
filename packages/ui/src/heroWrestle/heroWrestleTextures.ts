/**
 * The Top Rope (wrestling) attack's textures, painted ONCE per session on 2D canvases and kept (on top of the shared
 * Blast / Arcana set it reuses for glows, rings, stars, sparks and streaks). Flat 2D, clean shapes:
 *  - ROPE: one stretch of ring rope lying along +x (white, so each of the three ropes is tinted its own colour); the
 *    scene stretches and turns it between two points, which is how the ropes bow out and snap back.
 *  - POST: a steel ring post with its three turnbuckle pads, standing up from the bottom of the texture (in colour).
 *  - CONE: the spotlight's cone, its apex at the top centre, fading down its length (white: tinted warm).
 *  - HAND: an open hand print (white: tinted red for the chop's mark on the struck portrait).
 *  - ARC: the chop's wide flat slap arc, a crescent tapered at both ends (white).
 *  - IMPACT: an uneven comic impact star with a dark outline (the elbow's leading star, the clothesline's hit).
 *  - PUFF: a lobed puff of canvas dust, lit from the top left.
 *  - SHADOW: a soft dark disc (what is about to land casts it on the mat).
 *  - BELL: the timekeeper's brass ring bell on its wooden block (in colour).
 *  - NUMBERS and WORDS: the count's 1, 2, 3 and WOO!, SLAM!, WINNER! in heavy gold letters with a dark outline.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroWrestleTextures } from './heroWrestleScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

export const ROPE_W = 128;
export const ROPE_H = 24;
export const POST_W = 72;
export const POST_H = 256;
export const CONE_W = 256;
export const CONE_H = 512;
export const HAND_PX = 128;
export const ARC_W = 256;
export const ARC_H = 128;
export const IMPACT_PX = 256;
export const PUFF_PX = 128;
export const SHADOW_PX = 64;
export const BELL_PX = 128;
export const NUM_PX = 256;
export const WORD_W = 512;
export const WORD_H = 160;

/** Where the three ropes meet a post, as fractions of its height up from its foot (the pads are painted there). */
export const ROPE_HEIGHTS = [0.4, 0.66, 0.92] as const;

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function paintRope(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const y0 = 3, h = H - 6;
  // The rope runs edge to edge (two lengths butt together at the bend), round in section: lit along the top.
  const gr = g.createLinearGradient(0, y0, 0, y0 + h);
  gr.addColorStop(0, '#c9c9c9'); gr.addColorStop(0.25, '#ffffff'); gr.addColorStop(0.6, '#e4e4e4'); gr.addColorStop(1, '#8d8d8d');
  g.fillStyle = gr; g.fillRect(0, y0, W, h);
  // The wrap of the tape, a faint slanted band every so often.
  g.save();
  g.beginPath(); g.rect(0, y0, W, h); g.clip();
  g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 2.5;
  for (let x = -H; x < W + H; x += 16) { g.beginPath(); g.moveTo(x, y0 + h); g.lineTo(x + h * 0.7, y0); g.stroke(); }
  g.restore();
  g.fillStyle = 'rgba(20,12,8,0.75)';
  g.fillRect(0, y0 - 2, W, 2); g.fillRect(0, y0 + h, W, 2);
  return k.c;
}

function paintPost(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const cx = W / 2;
  const pw = W * 0.26;
  // The foot plate.
  g.fillStyle = '#2a2f3a';
  rr(g, cx - W * 0.36, H - 12, W * 0.72, 10, 4); g.fill();
  // The steel post: a cylinder, lit down its left side.
  const steel = g.createLinearGradient(cx - pw / 2, 0, cx + pw / 2, 0);
  steel.addColorStop(0, '#59627a'); steel.addColorStop(0.3, '#dfe6f5'); steel.addColorStop(0.55, '#8d97b0'); steel.addColorStop(1, '#3a4154');
  g.fillStyle = steel;
  rr(g, cx - pw / 2, 6, pw, H - 14, pw * 0.45); g.fill();
  g.strokeStyle = 'rgba(16,18,28,0.9)'; g.lineWidth = 2.5; g.stroke();
  // The three turnbuckle pads, where the ropes tie on.
  for (const f of ROPE_HEIGHTS) {
    const y = H - f * H;
    const ph = H * 0.105, pwid = W * 0.74;
    const pad = g.createLinearGradient(0, y - ph / 2, 0, y + ph / 2);
    pad.addColorStop(0, '#ff6b5c'); pad.addColorStop(0.45, '#d92f2a'); pad.addColorStop(1, '#8c1717');
    g.fillStyle = pad;
    rr(g, cx - pwid / 2, y - ph / 2, pwid, ph, ph * 0.42); g.fill();
    g.strokeStyle = 'rgba(40,6,6,0.9)'; g.lineWidth = 2.5; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.45)';
    rr(g, cx - pwid * 0.36, y - ph * 0.34, pwid * 0.5, ph * 0.2, ph * 0.1); g.fill();
  }
  return k.c;
}

function paintCone(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const cx = W / 2;
  // A soft-edged beam: a narrow mouth at the top widening to the full width, brightest down its middle.
  const down = g.createLinearGradient(0, 0, 0, H);
  down.addColorStop(0, 'rgba(255,255,255,0.95)'); down.addColorStop(0.5, 'rgba(255,255,255,0.6)'); down.addColorStop(1, 'rgba(255,255,255,0.32)');
  for (let i = 0; i < 6; i++) {
    const f = 1 - i * 0.13;
    g.globalAlpha = 0.2;
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

function paintBell(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const cx = D / 2;
  // The wooden block it is bolted to.
  const wood = g.createLinearGradient(0, D * 0.76, 0, D * 0.94);
  wood.addColorStop(0, '#9a6a3c'); wood.addColorStop(1, '#55351a');
  g.fillStyle = wood;
  rr(g, D * 0.12, D * 0.76, D * 0.76, D * 0.17, 6); g.fill();
  g.strokeStyle = 'rgba(30,16,6,0.9)'; g.lineWidth = 3; g.stroke();
  // The brass dome.
  const brass = g.createRadialGradient(cx - D * 0.14, D * 0.4, D * 0.03, cx, D * 0.6, D * 0.42);
  brass.addColorStop(0, '#fff7c9'); brass.addColorStop(0.3, '#ffd95e'); brass.addColorStop(0.75, '#d99a1c'); brass.addColorStop(1, '#8a5a0c');
  g.fillStyle = brass;
  g.beginPath();
  g.moveTo(D * 0.16, D * 0.76);
  g.bezierCurveTo(D * 0.16, D * 0.3, D * 0.84, D * 0.3, D * 0.84, D * 0.76);
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(52,30,4,0.95)'; g.lineWidth = 3.5; g.stroke();
  // The rim, the bolt on top and a glint.
  g.fillStyle = '#b97f14';
  rr(g, D * 0.13, D * 0.71, D * 0.74, D * 0.07, 4); g.fill(); g.stroke();
  g.fillStyle = '#ffe9a0';
  g.beginPath(); g.arc(cx, D * 0.39, D * 0.055, 0, Math.PI * 2); g.fill(); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.arc(cx, D * 0.74, D * 0.27, Math.PI * 1.12, Math.PI * 1.34); g.stroke();
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
  const rope = paintRope(ROPE_W, ROPE_H), post = paintPost(POST_W, POST_H), cone = paintCone(CONE_W, CONE_H), hand = paintHand(HAND_PX);
  const arc = paintArc(ARC_W, ARC_H), impact = paintImpact(IMPACT_PX), puff = paintPuff(PUFF_PX), shadow = paintShadow(SHADOW_PX), bell = paintBell(BELL_PX);
  const words = WRESTLE_WORDS.map((w) => paintText(w, WORD_W, WORD_H));
  const nums = WRESTLE_COUNTS.map((n) => paintText(n, NUM_PX, NUM_PX, 0.8));
  if (!base || !rope || !post || !cone || !hand || !arc || !impact || !puff || !shadow || !bell || words.some((w) => !w) || nums.some((n) => !n)) return null;
  const [woo, slam, winner] = words.map((w) => tex(w!));
  const [one, two, three] = nums.map((n) => tex(n!));
  cached = {
    ...base, rope: tex(rope), post: tex(post), cone: tex(cone), hand: tex(hand), arc: tex(arc), impact: tex(impact), puff: tex(puff), shadow: tex(shadow),
    bell: tex(bell), wordWoo: woo!, wordSlam: slam!, wordWinner: winner!, num1: one!, num2: two!, num3: three!,
  };
  return cached;
}
