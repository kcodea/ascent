/**
 * The Pinball attack's textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast / Arcana
 * set it reuses for glows, rings, stars and sparks). Flat 2D with baked shading; nothing here is tinted except the
 * trail, so the colours are a real table's:
 *  - BALL: a chrome steel ball (a dark rim, a bright sky half over a dark ground band, a hard highlight). It never
 *    spins: the highlight stays where the light is. SHADOW: a soft dark disc under it. TRAIL: a soft comet tail.
 *  - FLIPPER: a white tapered bat with a red rubber band round it and a steel pivot bolt, drawn pointing right from
 *    its pivot.
 *  - BUMPER (unlit / lit): a pop bumper from above: a steel skirt, a red body ring, a cream cap with a red star. Lit,
 *    the cap glows warm and the star burns.
 *  - LAMPS (unlit / lit): the ring of twelve lamps round the target. ARROW (unlit / lit): a lane insert.
 *  - RAIL: one tie of the wire ramp (two steel rails and a cross wire), laid end to end along the ramp's curve.
 *  - PANEL: the dot-matrix display (a dark glass with a faint dot grid in a steel bezel). WORDS and DIGITS: amber dots
 *    from a 5 x 7 dot font ("MULTIBALL", "TILT", "JACKPOT", 0 to 9). "+10" / "+50": the small score pops.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroPinballTextures } from './heroPinballScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

export const BALL_PX = 128;
export const SHADOW_PX = 64;
export const TRAIL_W = 128;
export const FLIPPER_W = 304;
export const FLIPPER_H = 112;
/** The pivot's place in the flipper texture (the sprite's anchor), and the bat's length in texture px from it. */
export const FLIPPER_PIVOT = 56 / FLIPPER_W;
export const FLIPPER_LEN = 228;
export const BUMPER_PX = 192;
/** The bumper's body radius in its texture (the rest is room for the lit halo). */
export const BUMPER_BODY = 76;
export const LAMPS_PX = 320;
/** The lamp circle's radius in its texture, and how many lamps it has. */
export const LAMPS_R = 136;
export const LAMPS_N = 12;
export const ARROW_PX = 96;
export const RAIL_W = 48;
export const RAIL_H = 96;
export const PANEL_W = 512;
export const PANEL_H = 184;
/** One dot of the dot-matrix font, in texture px. A glyph is 5 x 7 dots; a word puts one empty column between glyphs. */
export const DOT_PX = 10;
export const SCORE_W = 128;
export const SCORE_H = 72;

function paintBall(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const r = D / 2 - 3, cx = D / 2, cy = D / 2;
  g.save();
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  // The steel: a bright sky above, a dark ground band below the horizon, a pale bounce at the very bottom.
  const sky = g.createLinearGradient(0, cy - r, 0, cy + r);
  sky.addColorStop(0, '#f6fbff'); sky.addColorStop(0.3, '#c9d6e4'); sky.addColorStop(0.5, '#8d9cb0');
  sky.addColorStop(0.54, '#2c3442'); sky.addColorStop(0.74, '#55627a'); sky.addColorStop(0.9, '#aab6c8'); sky.addColorStop(1, '#dfe7f0');
  g.fillStyle = sky; g.fillRect(0, 0, D, D);
  // The horizon bends with the ball: a darker lens over the lower half.
  g.fillStyle = 'rgba(16,20,30,0.42)';
  g.beginPath(); g.ellipse(cx, cy + r * 0.52, r * 1.05, r * 0.5, 0, 0, Math.PI * 2); g.fill();
  // The rim falls away into shade.
  const rim = g.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
  rim.addColorStop(0, 'rgba(10,14,22,0)'); rim.addColorStop(0.82, 'rgba(10,14,22,0.16)'); rim.addColorStop(1, 'rgba(10,14,22,0.78)');
  g.fillStyle = rim; g.fillRect(0, 0, D, D);
  // The hard highlight (upper left) and its soft bloom.
  const hl = g.createRadialGradient(cx - r * 0.36, cy - r * 0.42, 0, cx - r * 0.36, cy - r * 0.42, r * 0.5);
  hl.addColorStop(0, 'rgba(255,255,255,1)'); hl.addColorStop(0.22, 'rgba(255,255,255,0.95)'); hl.addColorStop(0.5, 'rgba(255,255,255,0.3)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl; g.fillRect(0, 0, D, D);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath(); g.ellipse(cx + r * 0.42, cy + r * 0.62, r * 0.2, r * 0.07, -0.5, 0, Math.PI * 2); g.fill();
  g.restore();
  g.strokeStyle = 'rgba(14,16,24,0.9)'; g.lineWidth = D * 0.022;
  g.beginPath(); g.arc(cx, cy, r - D * 0.008, 0, Math.PI * 2); g.stroke();
  return k.c;
}

function paintShadow(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const gr = g.createRadialGradient(D / 2, D / 2, 0, D / 2, D / 2, D / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, D, D);
  return k.c;
}

/** The ball's tail: white, full at the head (the right edge), fading to nothing at the left and across. */
function paintTrail(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const along = g.createLinearGradient(0, 0, W, 0);
  along.addColorStop(0, 'rgba(255,255,255,0)'); along.addColorStop(0.6, 'rgba(255,255,255,0.35)'); along.addColorStop(1, 'rgba(255,255,255,0.95)');
  g.fillStyle = along; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-in';
  const across = g.createLinearGradient(0, 0, 0, H);
  across.addColorStop(0, 'rgba(0,0,0,0)'); across.addColorStop(0.5, 'rgba(0,0,0,1)'); across.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = across; g.fillRect(0, 0, W, H);
  return k.c;
}

function paintFlipper(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const cy = H / 2, px = W * FLIPPER_PIVOT, tx = px + FLIPPER_LEN - 24;
  const R0 = 40, R1 = 22;
  // The bat's outline: a big round end at the pivot, a small one at the tip, joined by straight sides.
  const body = (grow: number): void => {
    const a = Math.asin((R0 - R1) / (tx - px));
    g.beginPath();
    g.arc(px, cy, R0 + grow, Math.PI / 2 - a, Math.PI * 1.5 + a);
    g.arc(tx, cy, R1 + grow, Math.PI * 1.5 + a, Math.PI / 2 - a);
    g.closePath();
  };
  // A soft drop shadow under it.
  g.save(); g.translate(4, 7); g.fillStyle = 'rgba(0,0,0,0.3)'; body(8); g.fill(); g.restore();
  // The red rubber band: a dark edge, the rubber, a highlight along the top.
  g.fillStyle = '#3a0508'; body(11); g.fill();
  const rub = g.createLinearGradient(0, cy - R0 - 10, 0, cy + R0 + 10);
  rub.addColorStop(0, '#ff5a52'); rub.addColorStop(0.35, '#e0202a'); rub.addColorStop(1, '#8e0f18');
  g.fillStyle = rub; body(8); g.fill();
  g.save(); body(8); g.clip();
  g.strokeStyle = 'rgba(255,200,190,0.7)'; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(px + 6, cy - R0 - 4); g.lineTo(tx, cy - R1 - 5); g.stroke();
  g.restore();
  // The white plastic bat inside the band.
  const wh = g.createLinearGradient(0, cy - R0, 0, cy + R0);
  wh.addColorStop(0, '#ffffff'); wh.addColorStop(0.55, '#f1f1ee'); wh.addColorStop(1, '#bdbdb6');
  g.fillStyle = wh; body(0); g.fill();
  g.strokeStyle = 'rgba(60,20,20,0.55)'; g.lineWidth = 2; body(0); g.stroke();
  // A moulded ridge down the bat.
  g.strokeStyle = 'rgba(120,120,112,0.5)'; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(px + R0 * 0.9, cy); g.lineTo(tx + 4, cy); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(px + R0 * 0.9, cy - 3); g.lineTo(tx + 4, cy - 3); g.stroke();
  // The steel pivot bolt.
  const bolt = g.createRadialGradient(px - 6, cy - 7, 1, px, cy, 19);
  bolt.addColorStop(0, '#ffffff'); bolt.addColorStop(0.45, '#aeb8c6'); bolt.addColorStop(1, '#3d4654');
  g.fillStyle = bolt; g.beginPath(); g.arc(px, cy, 18, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(20,22,30,0.9)'; g.lineWidth = 2.5; g.beginPath(); g.arc(px, cy, 18, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(20,22,30,0.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(px - 9, cy); g.lineTo(px + 9, cy); g.stroke();
  return k.c;
}

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r : R;
    if (i === 0) g.moveTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q); else g.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q);
  }
  g.closePath();
}

function paintBumper(D: number, lit: boolean): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2, R = BUMPER_BODY;
  const disc = (r: number): void => { g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); };
  if (lit) {
    const halo = g.createRadialGradient(c, c, R * 0.7, c, c, D / 2);
    halo.addColorStop(0, 'rgba(255,214,110,0.75)'); halo.addColorStop(0.5, 'rgba(255,170,60,0.3)'); halo.addColorStop(1, 'rgba(255,150,40,0)');
    g.fillStyle = halo; g.fillRect(0, 0, D, D);
  } else {
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(c + 3, c + 6, R + 3, 0, Math.PI * 2); g.fill();
  }
  // The steel skirt.
  const steel = g.createLinearGradient(0, c - R, 0, c + R);
  steel.addColorStop(0, '#f4f7fb'); steel.addColorStop(0.5, '#9aa6b6'); steel.addColorStop(1, '#4a5362');
  g.fillStyle = '#14161e'; disc(R); g.fill();
  g.fillStyle = steel; disc(R - 3); g.fill();
  // The red body ring.
  const red = g.createLinearGradient(0, c - R, 0, c + R);
  red.addColorStop(0, lit ? '#ff8a5c' : '#f0403c'); red.addColorStop(1, lit ? '#e2301c' : '#8c1218');
  g.fillStyle = '#3a0508'; disc(R * 0.84); g.fill();
  g.fillStyle = red; disc(R * 0.8); g.fill();
  // The cap: cream, domed; lit, it glows from inside.
  const cap = g.createRadialGradient(c - R * 0.18, c - R * 0.22, R * 0.05, c, c, R * 0.62);
  if (lit) { cap.addColorStop(0, '#ffffff'); cap.addColorStop(0.5, '#fff2b0'); cap.addColorStop(1, '#ffc24a'); }
  else { cap.addColorStop(0, '#fffaf0'); cap.addColorStop(0.6, '#eadfc6'); cap.addColorStop(1, '#b3a488'); }
  g.fillStyle = '#3a2a18'; disc(R * 0.64); g.fill();
  g.fillStyle = cap; disc(R * 0.6); g.fill();
  // Scallops round the cap's edge.
  g.fillStyle = lit ? '#ff7a2a' : '#c8322e';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath(); g.arc(c + Math.cos(a) * R * 0.5, c + Math.sin(a) * R * 0.5, R * 0.045, 0, Math.PI * 2); g.fill();
  }
  // The star.
  g.lineJoin = 'round';
  starPath(g, c, c + R * 0.02, R * 0.36, R * 0.15);
  g.fillStyle = lit ? '#ff4a1e' : '#c8322e'; g.fill();
  g.strokeStyle = lit ? '#fff6c8' : '#7a1418'; g.lineWidth = 2.5; g.stroke();
  // A glint on the dome.
  g.fillStyle = `rgba(255,255,255,${lit ? 0.85 : 0.6})`;
  g.beginPath(); g.ellipse(c - R * 0.26, c - R * 0.34, R * 0.16, R * 0.07, -0.6, 0, Math.PI * 2); g.fill();
  return k.c;
}

function paintLamps(D: number, lit: boolean): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  for (let i = 0; i < LAMPS_N; i++) {
    const a = (i / LAMPS_N) * Math.PI * 2 - Math.PI / 2;
    const x = c + Math.cos(a) * LAMPS_R, y = c + Math.sin(a) * LAMPS_R;
    // Every other lamp is the bright one, so turning the ring by one lamp reads as a marquee.
    const on = lit && i % 2 === 0;
    if (lit) {
      const halo = g.createRadialGradient(x, y, 2, x, y, on ? 24 : 16);
      halo.addColorStop(0, on ? 'rgba(255,224,130,0.9)' : 'rgba(255,170,60,0.45)'); halo.addColorStop(1, 'rgba(255,170,60,0)');
      g.fillStyle = halo; g.beginPath(); g.arc(x, y, 24, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#14161e'; g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
    const b = g.createRadialGradient(x - 3, y - 3, 1, x, y, 9);
    if (on) { b.addColorStop(0, '#ffffff'); b.addColorStop(0.5, '#ffe9a0'); b.addColorStop(1, '#ffb030'); }
    else if (lit) { b.addColorStop(0, '#ffd890'); b.addColorStop(1, '#d87a18'); }
    else { b.addColorStop(0, '#c9a060'); b.addColorStop(0.6, '#7a5a2a'); b.addColorStop(1, '#3e2c14'); }
    g.fillStyle = b; g.beginPath(); g.arc(x, y, 8.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(255,255,255,${on ? 0.9 : 0.4})`; g.beginPath(); g.arc(x - 3, y - 3, 2.2, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

/** A lane insert: an arrow pointing right, set in a dark bezel. */
function paintArrow(D: number, lit: boolean): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const shape = (grow: number): void => {
    const s = D * 0.3 + grow;
    g.beginPath(); g.moveTo(c + s, c); g.lineTo(c - s * 0.8, c - s * 0.92); g.lineTo(c - s * 0.42, c); g.lineTo(c - s * 0.8, c + s * 0.92); g.closePath();
  };
  g.lineJoin = 'round';
  if (lit) {
    const halo = g.createRadialGradient(c, c, 4, c, c, D / 2);
    halo.addColorStop(0, 'rgba(255,200,90,0.7)'); halo.addColorStop(1, 'rgba(255,160,40,0)');
    g.fillStyle = halo; g.fillRect(0, 0, D, D);
  }
  g.fillStyle = '#14161e'; g.strokeStyle = '#14161e'; g.lineWidth = 9; shape(0); g.stroke(); g.fill();
  const f = g.createLinearGradient(0, c - D * 0.3, 0, c + D * 0.3);
  if (lit) { f.addColorStop(0, '#fff6c0'); f.addColorStop(0.5, '#ffd24a'); f.addColorStop(1, '#ff9a1e'); }
  else { f.addColorStop(0, '#8a5a1c'); f.addColorStop(1, '#4a2e10'); }
  g.fillStyle = f; shape(-1); g.fill();
  g.strokeStyle = lit ? 'rgba(255,255,255,0.8)' : 'rgba(255,210,140,0.35)'; g.lineWidth = 2; shape(-5); g.stroke();
  return k.c;
}

/** One tie of the wire ramp, running left to right: two steel rails and a cross wire between them. */
function paintRail(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  g.lineCap = 'butt';
  const wire = (y: number): void => {
    g.strokeStyle = 'rgba(12,14,22,0.85)'; g.lineWidth = 9; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    g.strokeStyle = '#8f9bad'; g.lineWidth = 6; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    g.strokeStyle = '#f2f6fb'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, y - 1.5); g.lineTo(W, y - 1.5); g.stroke();
  };
  // The cross wire first (under the rails), bowed like a cradle.
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(12,14,22,0.8)'; g.lineWidth = 7; g.beginPath(); g.moveTo(W / 2, 10); g.lineTo(W / 2, H - 10); g.stroke();
  g.strokeStyle = '#77839a'; g.lineWidth = 4; g.beginPath(); g.moveTo(W / 2, 10); g.lineTo(W / 2, H - 10); g.stroke();
  g.strokeStyle = 'rgba(240,246,252,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(W / 2 - 1.5, 12); g.lineTo(W / 2 - 1.5, H - 12); g.stroke();
  wire(10); wire(H - 10);
  return k.c;
}

function paintPanel(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const rr = (x: number, y: number, w: number, h: number, r: number): void => {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  // The steel bezel.
  const bz = g.createLinearGradient(0, 0, 0, H);
  bz.addColorStop(0, '#e9eef5'); bz.addColorStop(0.5, '#8794a8'); bz.addColorStop(1, '#3c4554');
  g.fillStyle = '#0c0d12'; rr(0, 0, W, H, 22); g.fill();
  g.fillStyle = bz; rr(3, 3, W - 6, H - 6, 20); g.fill();
  // The dark glass.
  g.fillStyle = '#0c0a08'; rr(13, 13, W - 26, H - 26, 12); g.fill();
  const glass = g.createLinearGradient(0, 13, 0, H - 13);
  glass.addColorStop(0, '#2a1608'); glass.addColorStop(1, '#120a04');
  g.fillStyle = glass; rr(16, 16, W - 32, H - 32, 10); g.fill();
  // The unlit dot grid.
  g.fillStyle = 'rgba(255,140,40,0.1)';
  for (let y = 26; y < H - 22; y += 8) for (let x = 26; x < W - 22; x += 8) { g.beginPath(); g.arc(x, y, 2.2, 0, Math.PI * 2); g.fill(); }
  // A glint across the glass.
  g.save(); rr(16, 16, W - 32, H - 32, 10); g.clip();
  g.fillStyle = 'rgba(255,255,255,0.05)';
  g.beginPath(); g.moveTo(16, 16); g.lineTo(W * 0.5, 16); g.lineTo(W * 0.3, H - 16); g.lineTo(16, H - 16); g.closePath(); g.fill();
  g.restore();
  return k.c;
}

/** The 5 x 7 dot font (rows top to bottom, a '1' is a lit dot). */
const FONT: Record<string, readonly string[]> = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
};

/** A word (or one digit) in lit amber dots on a clear ground. */
function paintDots(text: string, P: number): HTMLCanvasElement | null {
  const cols = text.length * 6 - 1;
  const k = canvas(cols * P, 7 * P); if (!k) return null;
  const g = k.g;
  const dots: [number, number][] = [];
  [...text].forEach((ch, ci) => {
    const rows = FONT[ch];
    if (!rows) return;
    rows.forEach((row, ry) => { for (let rx = 0; rx < 5; rx++) if (row[rx] === '1') dots.push([(ci * 6 + rx + 0.5) * P, (ry + 0.5) * P]); });
  });
  // The glow under the dots, then the dots (a hot centre in an amber disc).
  for (const [x, y] of dots) {
    const halo = g.createRadialGradient(x, y, 0, x, y, P * 0.95);
    halo.addColorStop(0, 'rgba(255,130,20,0.55)'); halo.addColorStop(1, 'rgba(255,110,10,0)');
    g.fillStyle = halo; g.fillRect(x - P, y - P, P * 2, P * 2);
  }
  for (const [x, y] of dots) {
    g.fillStyle = '#ff9a1e'; g.beginPath(); g.arc(x, y, P * 0.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffe2a0'; g.beginPath(); g.arc(x - P * 0.06, y - P * 0.06, P * 0.2, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

/** A small score pop ("+10"): heavy italic numerals, warm yellow with a dark outline. */
function paintScore(text: string, W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const size = Math.round(H * 0.72);
  g.font = `italic 900 ${size}px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(30,14,4,0.95)'; g.lineWidth = size * 0.22;
  g.strokeText(text, W / 2, H / 2 + 2);
  const f = g.createLinearGradient(0, H * 0.2, 0, H * 0.85);
  f.addColorStop(0, '#fff8c8'); f.addColorStop(1, '#ffb42a');
  g.fillStyle = f; g.fillText(text, W / 2, H / 2 + 2);
  return k.c;
}

let cached: HeroPinballTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroPinballTextures(): HeroPinballTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const made = {
    ball: paintBall(BALL_PX), shadow: paintShadow(SHADOW_PX), trail: paintTrail(TRAIL_W, 32), flipper: paintFlipper(FLIPPER_W, FLIPPER_H),
    bumper: paintBumper(BUMPER_PX, false), bumperLit: paintBumper(BUMPER_PX, true), lamps: paintLamps(LAMPS_PX, false), lampsLit: paintLamps(LAMPS_PX, true),
    arrow: paintArrow(ARROW_PX, false), arrowLit: paintArrow(ARROW_PX, true), rail: paintRail(RAIL_W, RAIL_H), panel: paintPanel(PANEL_W, PANEL_H),
    wordMultiball: paintDots('MULTIBALL', DOT_PX), wordTilt: paintDots('TILT', DOT_PX), wordJackpot: paintDots('JACKPOT', DOT_PX),
    digit0: paintDots('0', DOT_PX), digit1: paintDots('1', DOT_PX), digit2: paintDots('2', DOT_PX), digit3: paintDots('3', DOT_PX), digit4: paintDots('4', DOT_PX),
    digit5: paintDots('5', DOT_PX), digit6: paintDots('6', DOT_PX), digit7: paintDots('7', DOT_PX), digit8: paintDots('8', DOT_PX), digit9: paintDots('9', DOT_PX),
    plus10: paintScore('+10', SCORE_W, SCORE_H), plus50: paintScore('+50', SCORE_W, SCORE_H),
  };
  if (!base) return null;
  const out: Record<string, Texture> = {};
  for (const [name, c] of Object.entries(made)) { if (!c) return null; out[name] = tex(c); }
  cached = { ...base, ...(out as unknown as Omit<HeroPinballTextures, keyof typeof base>) };
  return cached;
}
