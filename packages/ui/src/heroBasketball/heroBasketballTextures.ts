/**
 * The Basketball attack's textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast /
 * Arcana set it reuses for glows, rings, stars, sparks and streaks). Flat 2D, clean shapes; most are light greys so a
 * sprite tints them (the ball's orange, the rim's orange, the glass, the confetti):
 *  - BALL: a lit disc (a soft highlight top left, a darker rim) with the four black seams of a basketball.
 *  - SHADOW: a soft dark disc (the ball's and the portrait's shadow on the floor).
 *  - RIM: a flat hoop seen from the front and a little above (an ellipse ring, thicker at the front).
 *  - NET: the net hanging under the rim (a tapering diamond mesh).
 *  - BOARD: the backboard (a glass panel with a frame and the shooter's square).
 *  - SHARD: a sliver of glass. CONFETTI: a small strip.
 *  - WORDS: "SWISH" and "SLAM", heavy italic letters with a dark outline.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroBasketballTextures } from './heroBasketballScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

export const BALL_PX = 128;
export const RIM_W = 192;
export const RIM_H = 64;
export const NET_W = 160;
export const NET_H = 128;
export const BOARD_W = 256;
export const BOARD_H = 168;
export const WORD_W = 512;
export const WORD_H = 176;

function paintBall(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const r = D / 2 - 2;
  const cx = D / 2, cy = D / 2;
  const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#e4e4e4'); gr.addColorStop(0.9, '#b4b4b4'); gr.addColorStop(1, '#8c8c8c');
  g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  // The seams (clipped to the ball).
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.strokeStyle = '#1a1a1a'; g.lineWidth = D * 0.035; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.stroke();
  g.beginPath(); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy); g.stroke();
  g.beginPath(); g.arc(cx - r * 1.35, cy, r * 1.05, -0.9, 0.9); g.stroke();
  g.beginPath(); g.arc(cx + r * 1.35, cy, r * 1.05, Math.PI - 0.9, Math.PI + 0.9); g.stroke();
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

function paintRim(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const cx = W / 2, cy = H / 2, rx = W / 2 - 8, ry = H / 2 - 10;
  // The back of the ring (thin), then the front (thick), so it reads as a hoop seen from a little above.
  g.strokeStyle = '#bdbdbd'; g.lineWidth = 6;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, Math.PI, Math.PI * 2); g.stroke();
  g.strokeStyle = '#ffffff'; g.lineWidth = 11;
  g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI); g.stroke();
  g.strokeStyle = 'rgba(40,40,40,0.55)'; g.lineWidth = 2;
  g.beginPath(); g.ellipse(cx, cy + 4, rx, ry, 0, 0.15, Math.PI - 0.15); g.stroke();
  return k.c;
}

function paintNet(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const top = 4, bot = H - 6;
  const halfTop = W / 2 - 6, halfBot = W * 0.22;
  const cols = 8, rows = 5;
  const edge = (side: number, v: number): number => W / 2 + side * lerp(halfTop, halfBot, v);
  g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.lineCap = 'round';
  // The diamond mesh: strands crossing from the rim down to the bottom ring.
  for (let i = 0; i <= cols; i++) {
    const s = i / cols;
    for (const dir of [1, -1]) {
      g.beginPath();
      for (let j = 0; j <= rows; j++) {
        const v = j / rows;
        const w = lerp(halfTop, halfBot, v);
        const x = W / 2 - w + 2 * w * clamp01(s + (dir * j) / (cols * 1.2));
        const y = lerp(top, bot, v) + Math.sin(v * Math.PI) * 3;
        if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  g.lineWidth = 4;
  g.beginPath(); g.moveTo(edge(-1, 0), top); g.lineTo(edge(-1, 1), bot); g.stroke();
  g.beginPath(); g.moveTo(edge(1, 0), top); g.lineTo(edge(1, 1), bot); g.stroke();
  g.beginPath(); g.moveTo(edge(-1, 1), bot); g.lineTo(edge(1, 1), bot); g.stroke();
  // Fade toward the bottom so it hangs softly.
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.75, 'rgba(0,0,0,0.85)'); fade.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = fade; g.fillRect(0, 0, W, H);
  return k.c;
}

function paintBoard(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 8; g.lineJoin = 'round';
  g.beginPath(); g.rect(6, 6, W - 12, H - 12); g.fill(); g.stroke();
  // A glint across the glass.
  g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 10;
  g.beginPath(); g.moveTo(W * 0.14, H * 0.8); g.lineTo(W * 0.34, H * 0.2); g.stroke();
  // The shooter's square above the rim.
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 6;
  g.strokeRect(W / 2 - W * 0.14, H * 0.46, W * 0.28, H * 0.4);
  return k.c;
}

function paintShard(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const gr = g.createLinearGradient(0, 0, W, H);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0.45)');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(W * 0.5, 1); g.lineTo(W - 2, H * 0.62); g.lineTo(W * 0.18, H - 1); g.closePath(); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.stroke();
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
  const size = Math.round(H * 0.62);
  g.font = `italic 900 ${size}px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const x = W / 2, y = H / 2 + 4;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(20,12,6,0.95)'; g.lineWidth = size * 0.2;
  g.strokeText(text, x, y);
  g.fillStyle = '#ffffff';
  g.fillText(text, x, y);
  return k.c;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (t: number): number => Math.min(1, Math.max(0, t));

let cached: HeroBasketballTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroBasketballTextures(): HeroBasketballTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const ball = paintBall(BALL_PX), shadow = paintShadow(64), rim = paintRim(RIM_W, RIM_H), net = paintNet(NET_W, NET_H);
  const board = paintBoard(BOARD_W, BOARD_H), shard = paintShard(36, 48), confetti = paintConfetti(16, 8);
  const swish = paintWord('SWISH', WORD_W, WORD_H), slam = paintWord('SLAM', WORD_W, WORD_H);
  if (!base || !ball || !shadow || !rim || !net || !board || !shard || !confetti || !swish || !slam) return null;
  cached = {
    ...base, ball: tex(ball), shadow: tex(shadow), rim: tex(rim), net: tex(net), board: tex(board), shard: tex(shard), confetti: tex(confetti),
    wordSwish: tex(swish), wordSlam: tex(slam),
  };
  return cached;
}
