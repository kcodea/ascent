/**
 * The Soccer attack's textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast / Arcana
 * set it reuses for glows, rings, stars, sparks and streaks). Flat 2D, clean shapes, the same treatment as the
 * Basketball's hoop; most are light greys so a sprite tints them:
 *  - BALL: a lit white disc with the black pentagon patches of a classic football.
 *  - SHADOW: a soft dark disc (the ball's and the portrait's shadow on the grass).
 *  - GOAL: the frame seen from the front (two posts and a crossbar, with a thin back frame for depth).
 *  - NET: the net behind the frame (a square mesh drawn in a shallow box, fading toward the back).
 *  - FLAG: the corner flag (a pole and a pennant).
 *  - DEFENDER: a defender's token (a round body with a rim, the size of a small portrait), tinted dark.
 *  - CONFETTI: a small strip. WORDS: "GOAL!", "GOLAZO!", "NUTMEG!" and "OLE!", heavy italic letters with a dark outline.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroSoccerTextures } from './heroSoccerScene';
import { GOAL_ASPECT } from './heroSoccerConfig';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

export const BALL_PX = 128;
export const GOAL_W = 320;
export const GOAL_H = Math.round(GOAL_W * GOAL_ASPECT);
export const FLAG_W = 64;
export const FLAG_H = 128;
export const DEFENDER_PX = 128;
export const WORD_W = 640;
export const WORD_H = 176;

/** A regular pentagon path centred on (x, y), radius r, turned by `rot`. */
function pentagon(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number): void {
  g.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = rot + (i / 5) * Math.PI * 2 - Math.PI / 2;
    if (i === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
}

function paintBall(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const r = D / 2 - 2;
  const cx = D / 2, cy = D / 2;
  const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#f0f0f0'); gr.addColorStop(0.92, '#c4c4c4'); gr.addColorStop(1, '#9a9a9a');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  // The patches (clipped to the ball): one in the middle, five round the edge, and the seams joining them.
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#1b1b1f';
  pentagon(g, cx, cy, r * 0.3, 0); g.fill();
  g.strokeStyle = '#2a2a2e'; g.lineWidth = D * 0.018; g.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const ex = cx + Math.cos(a) * r * 0.3, ey = cy + Math.sin(a) * r * 0.3;
    const ox = cx + Math.cos(a) * r * 0.86, oy = cy + Math.sin(a) * r * 0.86;
    g.beginPath(); g.moveTo(ex, ey); g.lineTo(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62); g.stroke();
    pentagon(g, ox + Math.cos(a) * r * 0.1, oy + Math.sin(a) * r * 0.1, r * 0.27, a + Math.PI / 2 + Math.PI / 5); g.fill();
  }
  g.restore();
  // A crisp dark edge.
  g.strokeStyle = 'rgba(30,30,30,0.85)'; g.lineWidth = D * 0.025;
  g.beginPath(); g.arc(cx, cy, r - D * 0.012, 0, Math.PI * 2); g.stroke();
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

/** The inner "back" box of the goal (the net's depth), as a fraction of the frame. */
const BACK = { x: 0.1, top: 0.18, bottom: 0.92 };

function paintGoal(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const p = 10;
  g.lineJoin = 'round'; g.lineCap = 'round';
  // The back frame (thin, grey), joined to the front by the stanchions.
  g.strokeStyle = 'rgba(200,200,200,0.8)'; g.lineWidth = 4;
  const bx0 = W * BACK.x, bx1 = W * (1 - BACK.x), by0 = H * BACK.top, by1 = H * BACK.bottom;
  g.beginPath(); g.moveTo(bx0, by1); g.lineTo(bx0, by0); g.lineTo(bx1, by0); g.lineTo(bx1, by1); g.stroke();
  g.beginPath(); g.moveTo(p, p); g.lineTo(bx0, by0); g.moveTo(W - p, p); g.lineTo(bx1, by0); g.stroke();
  // The posts and the crossbar: thick white, with a dark outline so they read on any board.
  const front = (): void => { g.beginPath(); g.moveTo(p, H - 2); g.lineTo(p, p); g.lineTo(W - p, p); g.lineTo(W - p, H - 2); };
  g.strokeStyle = 'rgba(20,20,24,0.85)'; g.lineWidth = 16; front(); g.stroke();
  g.strokeStyle = '#ffffff'; g.lineWidth = 10; front(); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(p - 2, H - 4); g.lineTo(p - 2, p + 4); g.stroke();
  return k.c;
}

function paintNet(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const p = 10;
  const bx0 = W * BACK.x, bx1 = W * (1 - BACK.x), by0 = H * BACK.top, by1 = H * BACK.bottom;
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.6; g.lineCap = 'round';
  // The back panel: a square mesh.
  const cols = 14, rows = 7;
  for (let i = 0; i <= cols; i++) { const x = bx0 + ((bx1 - bx0) * i) / cols; g.beginPath(); g.moveTo(x, by0); g.lineTo(x, by1); g.stroke(); }
  for (let j = 0; j <= rows; j++) { const y = by0 + ((by1 - by0) * j) / rows; g.beginPath(); g.moveTo(bx0, y); g.lineTo(bx1, y); g.stroke(); }
  // The roof and the side panels: strands from the front frame to the back box.
  for (let i = 0; i <= cols; i++) {
    const v = i / cols;
    g.beginPath(); g.moveTo(p + (W - 2 * p) * v, p); g.lineTo(bx0 + (bx1 - bx0) * v, by0); g.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    const v = j / rows;
    g.beginPath(); g.moveTo(p, p + (H - 2 - p) * v); g.lineTo(bx0, by0 + (by1 - by0) * v); g.stroke();
    g.beginPath(); g.moveTo(W - p, p + (H - 2 - p) * v); g.lineTo(bx1, by0 + (by1 - by0) * v); g.stroke();
  }
  // Fainter toward the bottom so it hangs softly over the portrait.
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, 'rgba(0,0,0,0.95)'); fade.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = fade; g.fillRect(0, 0, W, H);
  return k.c;
}

function paintFlag(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  // The pole (from the bottom centre), and the pennant at its top.
  g.strokeStyle = 'rgba(20,20,24,0.85)'; g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(W * 0.3, H - 4); g.lineTo(W * 0.3, 6); g.stroke();
  g.strokeStyle = '#e8e8e8'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(W * 0.3, H - 4); g.lineTo(W * 0.3, 6); g.stroke();
  g.fillStyle = '#ffffff'; g.strokeStyle = 'rgba(20,20,24,0.85)'; g.lineWidth = 3; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(W * 0.3, 8); g.quadraticCurveTo(W * 0.7, 14, W - 4, 26); g.quadraticCurveTo(W * 0.65, 40, W * 0.3, 50); g.closePath(); g.fill(); g.stroke();
  return k.c;
}

function paintDefender(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const r = D / 2 - 4;
  const cx = D / 2, cy = D / 2;
  const gr = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.7, '#cfcfcf'); gr.addColorStop(1, '#8a8a8a');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 6;
  g.beginPath(); g.arc(cx, cy, r - 3, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(10,10,12,0.9)'; g.lineWidth = 3;
  g.beginPath(); g.arc(cx, cy, r - 0.5, 0, Math.PI * 2); g.stroke();
  return k.c;
}

function paintConfetti(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  k.g.fillStyle = '#ffffff'; k.g.fillRect(0, 0, W, H);
  return k.c;
}

function paintWord(text: string, W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  let size = Math.round(H * 0.62);
  g.font = `italic 900 ${size}px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
  // Shrink a long word to fit the canvas (with room for the outline).
  const wpx = g.measureText(text).width;
  if (wpx > W * 0.88) { size = Math.floor(size * ((W * 0.88) / wpx)); g.font = `italic 900 ${size}px Impact, "Arial Black", "Helvetica Neue", sans-serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const x = W / 2, y = H / 2 + 4;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(20,12,6,0.95)'; g.lineWidth = size * 0.2;
  g.strokeText(text, x, y);
  g.fillStyle = '#ffffff';
  g.fillText(text, x, y);
  return k.c;
}

let cached: HeroSoccerTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroSoccerTextures(): HeroSoccerTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const ball = paintBall(BALL_PX), shadow = paintShadow(64), goal = paintGoal(GOAL_W, GOAL_H), net = paintNet(GOAL_W, GOAL_H);
  const flag = paintFlag(FLAG_W, FLAG_H), defender = paintDefender(DEFENDER_PX), confetti = paintConfetti(16, 8);
  const goalW = paintWord('GOAL!', WORD_W, WORD_H), golazo = paintWord('GOLAZO!', WORD_W, WORD_H);
  const nutmeg = paintWord('NUTMEG!', WORD_W, WORD_H), ole = paintWord('OLE!', WORD_W, WORD_H);
  if (!base || !ball || !shadow || !goal || !net || !flag || !defender || !confetti || !goalW || !golazo || !nutmeg || !ole) return null;
  cached = {
    ...base, ball: tex(ball), shadow: tex(shadow), goal: tex(goal), net: tex(net), flag: tex(flag), defender: tex(defender), confetti: tex(confetti),
    wordGoal: tex(goalW), wordGolazo: tex(golazo), wordNutmeg: tex(nutmeg), wordOle: tex(ole),
  };
  return cached;
}
