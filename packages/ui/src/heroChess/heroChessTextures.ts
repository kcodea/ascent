/**
 * Checkmate's textures, painted ONCE per session on 2D canvases and kept (about 1 MB of GPU memory on top of the Blast
 * and Arcana basics, which it shares). No image files and no font glyphs for the pieces: every piece is drawn here.
 *
 * A PIECE is painted on a 128 x 192 box, standing on its base at `PIECE_BASE_Y`, in two woods: IVORY and EBONY, each
 * with gold bands (the base rim, the collar, the crown) and a thin gold keyline round the silhouette so it reads on any
 * board. The turned pieces (pawn, queen, king) are painted the way a lathe makes them: one row at a time, each row a
 * strip of the same left-to-right shading (a dark edge, a bright gloss line, a soft rim light), so every bulge and neck
 * is shaded like the round thing it is; rows on an upward-facing slope are lit and rows on an underside are shaded. The
 * knight's head is a drawn profile (facing right; the scene mirrors it) on a turned base.
 *
 * A SQUARE is a white tile with a faint bevel (the scene tints it ivory, ebony or gold and sets its opacity). The
 * SHADOW is a soft dark ellipse. CHECKMATE is the one word this attack draws: gold serif capitals with a dark outline.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { PIECE_BASE_Y, PIECE_H, PIECE_W, type PieceKind } from './heroChessConfig';
import type { HeroChessTextures } from './heroChessScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

export const SQUARE_PX = 64;
export const WORD_W = 640;
export const WORD_H = 128;

export type Wood = 'ivory' | 'ebony';

interface Palette {
  /** The left-to-right shading of a turned row: [stop, colour]. */
  strip: [number, string][];
  outline: string;
  /** The light and the shade a slope adds. */
  lit: string; shade: string;
  /** The knight's head: light, mid and dark. */
  hi: string; mid: string; lo: string;
  detail: string;
}

const WOODS: Record<Wood, Palette> = {
  ivory: {
    strip: [[0, '#8d7655'], [0.09, '#cdb78f'], [0.27, '#fffdf4'], [0.36, '#f6ead0'], [0.66, '#dcc9a2'], [0.88, '#a58c63'], [0.95, '#cdb68c'], [1, '#86704d']],
    outline: '#3a2916', lit: 'rgba(255,255,255,', shade: 'rgba(70,45,15,',
    hi: '#fffdf4', mid: '#ecdcb8', lo: '#a58c63', detail: '#5a4326',
  },
  ebony: {
    strip: [[0, '#08070b'], [0.1, '#1c1823'], [0.25, '#8d86a6'], [0.31, '#3a3447'], [0.6, '#1d1925'], [0.86, '#0d0b11'], [0.95, '#4a4460'], [1, '#121017']],
    outline: '#040306', lit: 'rgba(190,180,230,', shade: 'rgba(0,0,0,',
    hi: '#8d86a6', mid: '#2a2534', lo: '#0d0b11', detail: '#9a93b5',
  },
};

const GOLD_STRIP: [number, string][] = [[0, '#6f4508'], [0.1, '#c2861a'], [0.27, '#fff6c2'], [0.4, '#f6c544'], [0.7, '#cf961f'], [0.9, '#8a5a10'], [0.96, '#d9a63a'], [1, '#6b430a']];
const GOLD_LINE = '#e8b23a';

/** A 256 x 1 strip of a left-to-right shading. */
function strip(stops: [number, string][]): HTMLCanvasElement | null {
  const k = canvas(256, 1); if (!k) return null;
  const gr = k.g.createLinearGradient(0, 0, 256, 0);
  for (const [at, col] of stops) gr.addColorStop(at, col);
  k.g.fillStyle = gr; k.g.fillRect(0, 0, 256, 1);
  return k.c;
}

/** A turned shape: its half width at each row, given as [y, half width] points (straight between them) and balls. */
interface Turned { pts?: [number, number][]; balls?: [number, number][] /* [centre y, radius] */ }

/** The half width of every row of the box (0 where the piece is not). The widest of every part wins, then a light smooth. */
function profile(parts: Turned[]): Float32Array {
  const hw = new Float32Array(PIECE_H);
  for (const part of parts) {
    const pts = part.pts ?? [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [y0, w0] = pts[i]!, [y1, w1] = pts[i + 1]!;
      for (let y = Math.ceil(y0); y <= Math.min(PIECE_H - 1, y1); y++) {
        const k = y1 === y0 ? 1 : (y - y0) / (y1 - y0);
        hw[y] = Math.max(hw[y]!, w0 + (w1 - w0) * k);
      }
    }
    for (const [cy, r] of part.balls ?? []) {
      for (let y = Math.max(0, Math.ceil(cy - r)); y <= Math.min(PIECE_H - 1, cy + r); y++) hw[y] = Math.max(hw[y]!, Math.sqrt(Math.max(0, r * r - (y - cy) * (y - cy))));
    }
  }
  // A light smooth (a turned piece has no knife edges), keeping the ends.
  const out = new Float32Array(PIECE_H);
  for (let y = 0; y < PIECE_H; y++) {
    if (hw[y] === 0) continue;
    const a = hw[y - 1] || hw[y]!, b = hw[y + 1] || hw[y]!;
    out[y] = hw[y]! * 0.5 + a * 0.25 + b * 0.25;
  }
  return out;
}

/** The silhouette of a turned profile as one closed path (down the left side, back up the right). */
function turnedPath(hw: Float32Array, cx: number): Path2D {
  const p = new Path2D();
  let top = 0, bot = PIECE_H - 1;
  while (top < PIECE_H && hw[top] === 0) top++;
  while (bot > 0 && hw[bot] === 0) bot--;
  p.moveTo(cx - hw[top]!, top);
  for (let y = top; y <= bot; y++) p.lineTo(cx - hw[y]!, y + 0.5);
  p.lineTo(cx - hw[bot]! + 3, bot + 1.5); p.lineTo(cx + hw[bot]! - 3, bot + 1.5);
  for (let y = bot; y >= top; y--) p.lineTo(cx + hw[y]!, y + 0.5);
  p.closePath();
  return p;
}

/** Paint a turned profile row by row. `gold` rows ([y0, y1] ranges) use the gold strip. */
function paintTurned(g: CanvasRenderingContext2D, hw: Float32Array, cx: number, wood: HTMLCanvasElement, goldS: HTMLCanvasElement, pal: Palette, gold: [number, number][]): void {
  for (let y = 0; y < PIECE_H; y++) {
    const w = hw[y]!;
    if (w <= 0) continue;
    const isGold = gold.some(([a, b]) => y >= a && y <= b);
    g.drawImage(isGold ? goldS : wood, 0, 0, 256, 1, cx - w, y, w * 2, 1.2);
    // The slope: a row wider than the one above faces up (lit); a row narrower faces down (shaded).
    const slope = w - (hw[y - 1] || w);
    if (slope > 0.15) { g.fillStyle = `${pal.lit}${Math.min(0.3, slope * 0.1).toFixed(3)})`; g.fillRect(cx - w, y, w * 2, 1); }
    else if (slope < -0.15) { g.fillStyle = `${pal.shade}${Math.min(0.42, -slope * 0.14).toFixed(3)})`; g.fillRect(cx - w, y, w * 2, 1); }
  }
  // A thin dark line under each gold band and a bright one on top of it, so the band reads as a separate ring.
  for (const [a, b] of gold) {
    const wa = hw[a]!, wb = hw[b]!;
    if (wa > 0) { g.fillStyle = 'rgba(255,250,210,0.75)'; g.fillRect(cx - wa * 0.9, a, wa * 1.8, 1); }
    if (wb > 0) { g.fillStyle = 'rgba(40,22,0,0.5)'; g.fillRect(cx - wb, b, wb * 2, 1); }
  }
}

/** The keyline behind a shape: a dark outline with a thin gold line outside it. */
function keyline(g: CanvasRenderingContext2D, path: Path2D, pal: Palette): void {
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = GOLD_LINE; g.lineWidth = 6.5; g.stroke(path);
  g.strokeStyle = pal.outline; g.lineWidth = 4; g.stroke(path);
}

/** A turned base (shared by every piece): a low foot, a gold rim and a waist. `top` is where the body meets it. */
const BASE: [number, number][] = [[158, 27], [160, 30], [168, 32], [173, 33], [PIECE_BASE_Y, 33]];
const BASE_GOLD: [number, number] = [169, 175];

const SHAPES: Record<Exclude<PieceKind, 'knight'>, { parts: Turned[]; gold: [number, number][] }> = {
  pawn: {
    parts: [
      { balls: [[88, 18]] },
      { pts: [[103, 9], [105, 16], [109, 16], [111, 9], [114, 9], [136, 12], [150, 18], [157, 25], [158, 27], ...BASE] },
    ],
    gold: [[105, 109], BASE_GOLD],
  },
  queen: {
    parts: [
      { balls: [[19, 5.5]] },
      // The coronet flares up and out to a rim, with a waist under it.
      { pts: [[24, 7], [28, 9], [30, 21], [38, 19], [42, 13], [50, 11], [66, 9]] },
      { pts: [[66, 9], [68, 18], [73, 18], [75, 10], [100, 11], [128, 15], [146, 20], [155, 26], [158, 27], ...BASE] },
    ],
    gold: [[30, 37], [68, 73], BASE_GOLD],
  },
  king: {
    parts: [
      // The crown flares UP (wider at the top), with a domed cap.
      { pts: [[24, 10], [27, 17], [29, 20], [35, 19], [48, 13], [54, 12]] },
      { pts: [[54, 12], [56, 20], [61, 20], [63, 11], [92, 12], [124, 16], [144, 21], [154, 27], [158, 28], ...BASE.map(([y, w]) => [y, w + 1] as [number, number])] },
    ],
    gold: [[27, 34], [56, 61], BASE_GOLD],
  },
};

function paintTurnedPiece(kind: Exclude<PieceKind, 'knight'>, wood: Wood): HTMLCanvasElement | null {
  const k = canvas(PIECE_W, PIECE_H); const ws = strip(WOODS[wood].strip); const gs = strip(GOLD_STRIP);
  if (!k || !ws || !gs) return null;
  const g = k.g, cx = PIECE_W / 2, pal = WOODS[wood];
  const shape = SHAPES[kind];
  const hw = profile(shape.parts);
  const path = turnedPath(hw, cx);
  // The king's cross and the queen's crown beads go behind the body's keyline, in gold.
  const extras = new Path2D();
  if (kind === 'king') {
    extras.roundRect(cx - 3.5, 5, 7, 22, 1.5);
    extras.roundRect(cx - 10, 10, 20, 6.5, 1.5);
  } else if (kind === 'queen') {
    for (const dx of [-17, -8.5, 0, 8.5, 17]) { extras.moveTo(cx + dx + 4, 27 - Math.abs(dx) * 0.06); extras.arc(cx + dx, 27 - Math.abs(dx) * 0.06, 4, 0, Math.PI * 2); }
  }
  keyline(g, path, pal);
  keyline(g, extras, pal);
  paintTurned(g, hw, cx, ws, gs, pal, shape.gold);
  // The gold extras, shaded like small round things.
  const gg = g.createLinearGradient(cx - 18, 0, cx + 18, 0);
  gg.addColorStop(0, '#8a5a10'); gg.addColorStop(0.35, '#fff1a8'); gg.addColorStop(0.6, '#f0bb3a'); gg.addColorStop(1, '#7a4d0c');
  g.fillStyle = gg; g.fill(extras);
  if (kind === 'queen') {
    // The top ball is gold too.
    g.beginPath(); g.arc(cx, 19, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,240,0.8)'; g.beginPath(); g.arc(cx - 1.6, 17.4, 1.5, 0, Math.PI * 2); g.fill();
  }
  // A crisp inner edge.
  g.strokeStyle = pal.outline; g.globalAlpha = 0.55; g.lineWidth = 1; g.stroke(path); g.globalAlpha = 1;
  return k.c;
}

/** The knight's head, facing right: back of the neck, the ears, the long face, the jaw, the chest. */
function knightHead(): Path2D {
  const p = new Path2D();
  p.moveTo(40, 150);
  p.bezierCurveTo(30, 128, 30, 104, 40, 82);       // the back of the neck
  p.bezierCurveTo(44, 68, 50, 58, 56, 50);         // up to the poll
  p.lineTo(57, 34); p.lineTo(66, 45);              // the near ear
  p.lineTo(72, 40); p.lineTo(74, 51);              // the far ear's tip, peeking behind
  p.bezierCurveTo(88, 60, 98, 74, 106, 92);        // down the face to the nose
  p.bezierCurveTo(110, 100, 108, 108, 100, 111);   // the muzzle
  p.bezierCurveTo(94, 113, 88, 110, 84, 104);      // the chin, back along the jaw
  p.bezierCurveTo(80, 102, 76, 104, 75, 110);      // the throat
  p.bezierCurveTo(76, 124, 90, 134, 90, 150);      // the chest, out to the base
  p.closePath();
  return p;
}

function paintKnight(wood: Wood): HTMLCanvasElement | null {
  const k = canvas(PIECE_W, PIECE_H); const ws = strip(WOODS[wood].strip); const gs = strip(GOLD_STRIP);
  if (!k || !ws || !gs) return null;
  const g = k.g, cx = PIECE_W / 2, pal = WOODS[wood];
  const hw = profile([{ pts: [[146, 24], [150, 27], [156, 27], [158, 27], ...BASE] }]);
  const base = turnedPath(hw, cx);
  const head = knightHead();
  keyline(g, base, pal);
  keyline(g, head, pal);
  // The head: lit from the upper left, like the turned pieces.
  const gr = g.createLinearGradient(36, 40, 104, 150);
  gr.addColorStop(0, pal.hi); gr.addColorStop(0.3, pal.mid); gr.addColorStop(1, pal.lo);
  g.fillStyle = gr; g.fill(head);
  g.save();
  g.clip(head);
  // The gloss down the neck and along the face.
  g.lineCap = 'round';
  g.strokeStyle = wood === 'ivory' ? 'rgba(255,255,255,0.85)' : 'rgba(170,160,210,0.6)';
  g.lineWidth = 5; g.beginPath(); g.moveTo(46, 132); g.bezierCurveTo(40, 112, 44, 88, 56, 66); g.stroke();
  g.lineWidth = 3; g.beginPath(); g.moveTo(70, 56); g.bezierCurveTo(82, 64, 92, 76, 98, 90); g.stroke();
  // The shade under the jaw and down the chest.
  const sh = g.createLinearGradient(60, 100, 92, 150);
  sh.addColorStop(0, `${pal.shade}0)`); sh.addColorStop(1, `${pal.shade}0.55)`);
  g.fillStyle = sh; g.fillRect(56, 96, 50, 60);
  // The mane: carved notches down the back of the neck.
  g.strokeStyle = pal.detail; g.globalAlpha = wood === 'ivory' ? 0.6 : 0.5; g.lineWidth = 2.2;
  for (let i = 0; i < 5; i++) {
    const y = 66 + i * 15;
    g.beginPath(); g.moveTo(28 + i * 0.5, y + 8); g.quadraticCurveTo(44, y + 4, 50 - i * 1.5, y - 6); g.stroke();
  }
  g.globalAlpha = 1;
  // The gold bridle: a band over the nose and a strap up the cheek.
  g.strokeStyle = '#f0bb3a'; g.lineWidth = 4.5;
  g.beginPath(); g.moveTo(88, 70); g.quadraticCurveTo(84, 90, 86, 108); g.stroke();
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(86, 86); g.quadraticCurveTo(72, 84, 62, 60); g.stroke();
  g.strokeStyle = 'rgba(255,246,190,0.9)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(87, 72); g.quadraticCurveTo(83, 90, 85, 106); g.stroke();
  g.restore();
  // The eye, the nostril and the mouth.
  g.fillStyle = wood === 'ivory' ? '#2a1c0e' : '#f6e7b0';
  g.beginPath(); g.ellipse(74, 68, 4.2, 3.2, 0.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = wood === 'ivory' ? '#fffdf4' : '#16121c';
  g.beginPath(); g.arc(75.2, 67, 1.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = pal.detail; g.globalAlpha = 0.8;
  g.beginPath(); g.ellipse(101, 98, 2.4, 1.7, 0.4, 0, Math.PI * 2); g.fill();
  g.strokeStyle = pal.detail; g.lineWidth = 1.6; g.lineCap = 'round';
  g.beginPath(); g.moveTo(104, 105); g.quadraticCurveTo(97, 107, 92, 103); g.stroke();
  g.globalAlpha = 1;
  // The base over the bottom of the neck, with a gold collar where they meet.
  paintTurned(g, hw, cx, ws, gs, pal, [[147, 155], BASE_GOLD]);
  g.strokeStyle = pal.outline; g.globalAlpha = 0.55; g.lineWidth = 1; g.stroke(base); g.stroke(head); g.globalAlpha = 1;
  return k.c;
}

/** A board square: a white tile, a touch darker toward its edge, with a hairline bevel. */
function paintSquare(): HTMLCanvasElement | null {
  const k = canvas(SQUARE_PX, SQUARE_PX); if (!k) return null;
  const g = k.g, S = SQUARE_PX;
  const gr = g.createRadialGradient(S / 2, S / 2, S * 0.15, S / 2, S / 2, S * 0.75);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0.78)');
  g.fillStyle = gr; g.beginPath(); g.roundRect(1, 1, S - 2, S - 2, 2.5); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1; g.beginPath(); g.roundRect(2.5, 2.5, S - 5, S - 5, 2); g.stroke();
  return k.c;
}

/** The shadow under a piece: a soft dark ellipse. */
function paintShadow(): HTMLCanvasElement | null {
  const k = canvas(128, 48); if (!k) return null;
  const g = k.g;
  g.translate(64, 24); g.scale(1, 24 / 64);
  const gr = g.createRadialGradient(0, 0, 4, 0, 0, 62);
  gr.addColorStop(0, 'rgba(0,0,0,0.6)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 62, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** THE WORD (player-facing): CHECKMATE, in gold serif capitals with a dark outline. */
export const CHESS_WORD = 'CHECKMATE';

function paintWord(): HTMLCanvasElement | null {
  const k = canvas(WORD_W, WORD_H); if (!k) return null;
  const g = k.g;
  let size = 84;
  const font = (): string => `700 ${size}px Georgia, 'Times New Roman', serif`;
  g.font = font();
  try { (g as unknown as { letterSpacing: string }).letterSpacing = '5px'; } catch { /* an older canvas: no tracking */ }
  const w = g.measureText(CHESS_WORD).width;
  if (w > WORD_W * 0.92) { size = Math.floor(size * ((WORD_W * 0.92) / w)); g.font = font(); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const x = WORD_W / 2, y = WORD_H / 2 + 2;
  g.lineJoin = 'round';
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 10; g.shadowOffsetY = 4;
  g.strokeStyle = '#1a0f05'; g.lineWidth = 12; g.strokeText(CHESS_WORD, x, y);
  g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
  g.strokeStyle = '#8a5a10'; g.lineWidth = 5; g.strokeText(CHESS_WORD, x, y);
  const gr = g.createLinearGradient(0, y - size * 0.42, 0, y + size * 0.42);
  gr.addColorStop(0, '#fffbe0'); gr.addColorStop(0.42, '#ffd95a'); gr.addColorStop(0.55, '#f0b020'); gr.addColorStop(1, '#b97a12');
  g.fillStyle = gr; g.fillText(CHESS_WORD, x, y);
  return k.c;
}

let cached: HeroChessTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroChessTextures(): HeroChessTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  if (!base) return null;
  const made: Record<string, HTMLCanvasElement | null> = {
    pawnIvory: paintTurnedPiece('pawn', 'ivory'), pawnEbony: paintTurnedPiece('pawn', 'ebony'),
    knightIvory: paintKnight('ivory'), knightEbony: paintKnight('ebony'),
    queenIvory: paintTurnedPiece('queen', 'ivory'), queenEbony: paintTurnedPiece('queen', 'ebony'),
    kingIvory: paintTurnedPiece('king', 'ivory'), kingEbony: paintTurnedPiece('king', 'ebony'),
    square: paintSquare(), shadow: paintShadow(), word: paintWord(),
  };
  if (Object.values(made).some((c) => !c)) return null;
  const t = Object.fromEntries(Object.entries(made).map(([k, c]) => [k, tex(c!)])) as Record<string, Texture>;
  cached = {
    glow: base.glow, spark: base.spark, streak: base.streak, ring: base.ring, star: base.star,
    pawnIvory: t.pawnIvory!, pawnEbony: t.pawnEbony!, knightIvory: t.knightIvory!, knightEbony: t.knightEbony!,
    queenIvory: t.queenIvory!, queenEbony: t.queenEbony!, kingIvory: t.kingIvory!, kingEbony: t.kingEbony!,
    square: t.square!, shadow: t.shadow!, word: t.word!,
  };
  return cached;
}
