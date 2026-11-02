/**
 * The Baseball attack's textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast / Arcana
 * set it reuses for glows, rings, stars, sparks and streaks). Flat 2D, clean shapes; most are light so a sprite tints
 * them:
 *  - BALL: a white baseball with its two red stitched seams (painted in colour: the ball is drawn untinted).
 *  - SHADOW: a soft dark disc (the ball's shadow on the ground, and III's growing shadow on the pitcher).
 *  - BAT: a wooden bat lying along +x, the knob at the left (the handle end is the sprite's anchor).
 *  - PUFF: a round cartoon dust puff, lit top left (the brawl cloud is many of them, tinted dust).
 *  - BURST: a comic "kapow" starburst behind each brawl word.
 *  - WORDS: CRACK!, BONK!, HOME RUN!, POW!, BAM!, SMACK!, YER OUT! in heavy italic letters with a dark outline.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroBaseballTextures } from './heroBaseballScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

export const BALL_PX = 96;
export const BAT_W = 256;
export const BAT_H = 44;
export const PUFF_PX = 128;
export const BURST_PX = 256;
export const WORD_W = 512;
export const WORD_H = 160;

function paintBall(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const r = D / 2 - 2, cx = D / 2, cy = D / 2;
  const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#f3efe6'); gr.addColorStop(1, '#bdb5a6');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  // The two seams: arcs bowing in from the left and the right, with the red stitches across them.
  for (const s of [-1, 1]) {
    const ax = cx + s * r * 1.25;
    const rr = r * 0.95;
    g.strokeStyle = '#c81e1e'; g.lineWidth = D * 0.03;
    g.beginPath(); g.arc(ax, cy, rr, s < 0 ? -0.95 : Math.PI - 0.95, s < 0 ? 0.95 : Math.PI + 0.95); g.stroke();
    g.lineWidth = D * 0.022; g.lineCap = 'round';
    for (let i = -4; i <= 4; i++) {
      const a = (s < 0 ? 0 : Math.PI) + i * 0.21;
      const px = ax + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      const tx = -Math.sin(a), ty = Math.cos(a);
      const nx = Math.cos(a), ny = Math.sin(a);
      g.beginPath();
      g.moveTo(px - nx * D * 0.045 - tx * D * 0.015, py - ny * D * 0.045 - ty * D * 0.015);
      g.lineTo(px + nx * D * 0.045 + tx * D * 0.015, py + ny * D * 0.045 + ty * D * 0.015);
      g.stroke();
    }
  }
  g.restore();
  g.strokeStyle = 'rgba(60,50,40,0.6)'; g.lineWidth = D * 0.02;
  g.beginPath(); g.arc(cx, cy, r - D * 0.01, 0, Math.PI * 2); g.stroke();
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

function paintBat(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const cy = H / 2;
  // The outline: the knob, the thin handle, the taper, the fat barrel with a rounded end.
  const knobX = 10, handleEnd = W * 0.42, barrelStart = W * 0.7, endX = W - 6;
  const hw = H * 0.12, bw = H * 0.42;
  g.beginPath();
  g.moveTo(knobX + 6, cy - hw);
  g.lineTo(handleEnd, cy - hw * 1.05);
  g.bezierCurveTo(W * 0.55, cy - hw * 1.2, W * 0.6, cy - bw, barrelStart, cy - bw);
  g.lineTo(endX - bw, cy - bw);
  g.arc(endX - bw, cy, bw, -Math.PI / 2, Math.PI / 2);
  g.lineTo(barrelStart, cy + bw);
  g.bezierCurveTo(W * 0.6, cy + bw, W * 0.55, cy + hw * 1.2, handleEnd, cy + hw * 1.05);
  g.lineTo(knobX + 6, cy + hw);
  g.closePath();
  const gr = g.createLinearGradient(0, cy - bw, 0, cy + bw);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, '#e9e2d6'); gr.addColorStop(1, '#9f9584');
  g.fillStyle = gr; g.fill();
  g.strokeStyle = 'rgba(40,26,14,0.85)'; g.lineWidth = 2.5; g.stroke();
  // The knob.
  g.fillStyle = '#d9d2c4';
  g.beginPath(); g.ellipse(knobX + 4, cy, 5, hw * 2.1, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  // Grip tape on the handle, a little grain on the barrel.
  g.strokeStyle = 'rgba(30,30,30,0.55)'; g.lineWidth = 2;
  for (let x = knobX + 14; x < W * 0.3; x += 7) { g.beginPath(); g.moveTo(x, cy - hw); g.lineTo(x + 4, cy + hw); g.stroke(); }
  g.strokeStyle = 'rgba(90,60,30,0.25)'; g.lineWidth = 1.5;
  for (const f of [-0.45, 0.1, 0.5]) { g.beginPath(); g.moveTo(barrelStart - 20, cy + bw * f); g.lineTo(endX - bw * 0.5, cy + bw * f * 0.9); g.stroke(); }
  return k.c;
}

function paintPuff(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const r = D / 2 - 3, cx = D / 2, cy = D / 2;
  const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.7, '#e2e2e2'); gr.addColorStop(0.92, '#b8b8b8'); gr.addColorStop(1, 'rgba(160,160,160,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  return k.c;
}

function paintBurst(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const cx = D / 2, cy = D / 2;
  const spikes = 12;
  g.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = (i % 2 ? 0.58 : 0.97 - 0.12 * ((i / 2) % 3 === 1 ? 1 : 0)) * (D / 2 - 6);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = '#ffffff'; g.fill();
  g.strokeStyle = 'rgba(30,14,6,0.9)'; g.lineWidth = 7; g.lineJoin = 'round'; g.stroke();
  return k.c;
}

function paintWord(text: string, W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  let size = Math.round(H * 0.66);
  g.font = `italic 900 ${size}px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
  const w = g.measureText(text).width;
  if (w > W * 0.9) { size = Math.floor(size * ((W * 0.9) / w)); g.font = `italic 900 ${size}px Impact, "Arial Black", "Helvetica Neue", sans-serif`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const x = W / 2, y = H / 2 + 4;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(20,12,6,0.95)'; g.lineWidth = size * 0.2;
  g.strokeText(text, x, y);
  g.fillStyle = '#ffffff';
  g.fillText(text, x, y);
  return k.c;
}

export const BASEBALL_WORDS = ['CRACK!', 'BONK!', 'HOME RUN!', 'POW!', 'BAM!', 'SMACK!', 'YER OUT!'] as const;

let cached: HeroBaseballTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroBaseballTextures(): HeroBaseballTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const ball = paintBall(BALL_PX), shadow = paintShadow(64), bat = paintBat(BAT_W, BAT_H), puff = paintPuff(PUFF_PX), burst = paintBurst(BURST_PX);
  const words = BASEBALL_WORDS.map((w) => paintWord(w, WORD_W, WORD_H));
  if (!base || !ball || !shadow || !bat || !puff || !burst || words.some((w) => !w)) return null;
  const [crack, bonk, homer, pow, bam, smack, out] = words.map((w) => tex(w!));
  cached = {
    ...base, ball: tex(ball), shadow: tex(shadow), bat: tex(bat), puff: tex(puff), kapow: tex(burst),
    wordCrack: crack!, wordBonk: bonk!, wordHomer: homer!, wordPow: pow!, wordBam: bam!, wordSmack: smack!, wordOut: out!,
  };
  return cached;
}
