/**
 * The Holy attack's textures, painted ONCE per session on 2D canvases and kept (about 1 MB of GPU memory, most of it the
 * sword), on top of the Blast and Arcana textures it shares (glow, spark, streak, ring, beam, star).
 *
 * Everything but the sword is WHITE, so every sprite tints it. THE SWORD is painted in its real colours (a white-gold
 * blade with a fuller and a bevel, a gold winged crossguard with a sky-blue sun gem, a wrapped grip, a gemmed pommel
 * and a cross finial), with a dark-gold outline so it keeps its shape on the light board. It comes in three aligned
 * layers: a soft glow silhouette (additive, tinted), the body (normal blend, untinted) and the hot highlights (additive:
 * the edge lights, the ridge, the fuller runes, the gem glints). The painted colours follow the tuner's colours, so the
 * sword is repainted only when those change (DEV only; production paints it once).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { seededRng } from '../heroAttack/easing';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroHolyTextures } from './heroHolyScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

// ─── the sword (real colours) ──────────────────────────────────────────────────────────────────────────────────

/** The sword canvas: its size, and where its tip and its top sit (the tip is the anchor; the length is tip - top). */
export const SWORD_W = 200;
export const SWORD_H = 720;
export const SWORD_TIP_Y = 700;
export const SWORD_TOP_Y = 12;
export const SWORD_LEN_PX = SWORD_TIP_Y - SWORD_TOP_Y;
/** Where the crossguard sits along the sword, as a fraction of the length from the tip (for the glint and dissolve). */
export const SWORD_GUARD_FROM_TIP = (SWORD_TIP_Y - 188) / SWORD_LEN_PX;

export interface SwordPalette { gold: string; deep: string; sky: string; core: string }

const CX = SWORD_W / 2;

/** The blade outline (tip at the bottom). */
function bladePath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(CX - 30, 204);
  g.lineTo(CX - 26, 560);
  g.quadraticCurveTo(CX - 22, 640, CX, SWORD_TIP_Y);
  g.quadraticCurveTo(CX + 22, 640, CX + 26, 560);
  g.lineTo(CX + 30, 204);
  g.closePath();
}

/** One half of the winged crossguard (s = 1 right, -1 left), sweeping up into a curled wing tip. */
function wingPath(g: CanvasRenderingContext2D, s: number): void {
  g.beginPath();
  g.moveTo(CX, 174);
  g.bezierCurveTo(CX + s * 30, 170, CX + s * 58, 172, CX + s * 74, 160);
  g.bezierCurveTo(CX + s * 84, 150, CX + s * 88, 138, CX + s * 96, 130);
  g.bezierCurveTo(CX + s * 96, 146, CX + s * 92, 160, CX + s * 84, 172);
  g.bezierCurveTo(CX + s * 76, 186, CX + s * 50, 196, CX + s * 26, 202);
  g.lineTo(CX, 206);
  g.closePath();
}

function langetPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(CX - 20, 200);
  g.lineTo(CX + 20, 200);
  g.lineTo(CX + 13, 228);
  g.lineTo(CX, 250);
  g.lineTo(CX - 13, 228);
  g.closePath();
}

function crossPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.rect(CX - 4, SWORD_TOP_Y, 8, 30);
  g.rect(CX - 11, SWORD_TOP_Y + 8, 22, 7);
}

/** Every shape of the sword, filled plain (for the glow silhouette). */
function silhouette(g: CanvasRenderingContext2D): void {
  bladePath(g); g.fill();
  wingPath(g, 1); g.fill(); wingPath(g, -1); g.fill();
  langetPath(g); g.fill();
  g.beginPath(); g.arc(CX, 188, 19, 0, Math.PI * 2); g.fill();
  g.fillRect(CX - 11, 70, 22, 104);
  g.beginPath(); g.arc(CX, 56, 17, 0, Math.PI * 2); g.fill();
  crossPath(g); g.fill();
}

function paintSwordGlow(): HTMLCanvasElement | null {
  const k = canvas(SWORD_W, SWORD_H); if (!k) return null;
  const g = k.g;
  // The shadow of a shape drawn far off canvas: only the blur lands (a soft silhouette, no hard edge).
  g.fillStyle = '#fff'; g.shadowColor = '#fff';
  g.translate(-4000, 0);
  g.shadowOffsetX = 4000;
  g.shadowBlur = 26; silhouette(g);
  g.shadowBlur = 12; silhouette(g);
  return k.c;
}

function gem(g: CanvasRenderingContext2D, x: number, y: number, r: number, p: SwordPalette): void {
  const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, p.sky); gr.addColorStop(1, '#2f6f9e');
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = p.deep; g.lineWidth = 1.6; g.stroke();
}

function paintSwordBody(p: SwordPalette): HTMLCanvasElement | null {
  const k = canvas(SWORD_W, SWORD_H); if (!k) return null;
  const g = k.g;
  g.lineJoin = 'round'; g.lineCap = 'round';
  const goldV = (y0: number, y1: number): CanvasGradient => {
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, '#fff0b8'); gr.addColorStop(0.35, p.gold); gr.addColorStop(1, p.deep);
    return gr;
  };
  // THE BLADE: a bevelled white-gold blade (a bright left facet, a white ridge, a warm right facet), a fuller down its
  // middle, a dark-gold edge line.
  const bl = g.createLinearGradient(CX - 30, 0, CX + 30, 0);
  bl.addColorStop(0, '#fff3cf'); bl.addColorStop(0.4, '#fffdf5'); bl.addColorStop(0.5, '#ffffff');
  bl.addColorStop(0.53, '#f8e6ae'); bl.addColorStop(1, '#ecc867');
  g.fillStyle = bl; bladePath(g); g.fill();
  // warm toward the tip: the light pools at the point
  const tipWarm = g.createLinearGradient(0, 420, 0, SWORD_TIP_Y);
  tipWarm.addColorStop(0, 'rgba(255,220,120,0)'); tipWarm.addColorStop(1, 'rgba(255,214,110,0.35)');
  g.fillStyle = tipWarm; bladePath(g); g.fill();
  // the fuller: a narrow channel down the middle, shaded, with a lit lip
  g.fillStyle = 'rgba(214,162,52,0.55)';
  g.beginPath(); g.moveTo(CX - 5, 250); g.lineTo(CX - 4, 560); g.lineTo(CX, 590); g.lineTo(CX + 4, 560); g.lineTo(CX + 5, 250); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(CX - 5, 252); g.lineTo(CX - 4, 560); g.stroke();
  g.strokeStyle = p.deep; g.lineWidth = 2.2; bladePath(g); g.stroke();
  // THE LANGET: a gold shield over the blade's base, with a small gem.
  g.fillStyle = goldV(200, 250); langetPath(g); g.fill();
  g.strokeStyle = p.deep; g.lineWidth = 1.8; langetPath(g); g.stroke();
  gem(g, CX, 220, 5, p);
  // THE GRIP: wrapped in dark leather bands, gold ferrules at each end.
  const grip = g.createLinearGradient(CX - 10, 0, CX + 10, 0);
  grip.addColorStop(0, '#6b3f10'); grip.addColorStop(0.45, '#a8692a'); grip.addColorStop(1, '#4e2c08');
  g.fillStyle = grip; g.fillRect(CX - 9, 76, 18, 94);
  g.strokeStyle = 'rgba(40,20,4,0.7)'; g.lineWidth = 2;
  for (let y = 80; y < 168; y += 9) { g.beginPath(); g.moveTo(CX - 9, y + 6); g.lineTo(CX + 9, y); g.stroke(); }
  g.strokeStyle = 'rgba(255,220,150,0.35)'; g.lineWidth = 1;
  for (let y = 83; y < 168; y += 9) { g.beginPath(); g.moveTo(CX - 7, y + 5); g.lineTo(CX + 7, y); g.stroke(); }
  for (const [y0, y1] of [[70, 80], [164, 174]] as const) {
    g.fillStyle = goldV(y0, y1); g.fillRect(CX - 13, y0, 26, y1 - y0);
    g.strokeStyle = p.deep; g.lineWidth = 1.5; g.strokeRect(CX - 13, y0, 26, y1 - y0);
  }
  // THE CROSSGUARD: two gold wings sweeping up into curls, etched with feather lines.
  for (const s of [1, -1]) {
    g.fillStyle = goldV(128, 206); wingPath(g, s); g.fill();
    g.strokeStyle = p.deep; g.lineWidth = 2; wingPath(g, s); g.stroke();
    g.strokeStyle = 'rgba(120,70,8,0.65)'; g.lineWidth = 1.4;
    for (let i = 0; i < 4; i++) {
      const x0 = CX + s * (24 + i * 16), y0 = 182 - i * 4;
      g.beginPath(); g.moveTo(x0, y0 + 10); g.quadraticCurveTo(x0 + s * 6, y0 - 2, x0 + s * 16, y0 - 8 - i * 2); g.stroke();
    }
    g.strokeStyle = 'rgba(255,248,220,0.8)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(CX + s * 8, 176); g.bezierCurveTo(CX + s * 34, 172, CX + s * 60, 172, CX + s * 76, 158); g.stroke();
  }
  // THE BOSS: a gold sun with a sky-blue gem at its heart.
  g.fillStyle = goldV(168, 208);
  g.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? 15 : 22;
    const x = CX + Math.cos(a) * r, y = 188 + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath(); g.fill();
  g.strokeStyle = p.deep; g.lineWidth = 1.6; g.stroke();
  gem(g, CX, 188, 10, p);
  // THE POMMEL: a gold ring round a gem, a cross finial on top.
  g.fillStyle = goldV(38, 74); g.beginPath(); g.arc(CX, 56, 17, 0, Math.PI * 2); g.fill();
  g.strokeStyle = p.deep; g.lineWidth = 1.8; g.stroke();
  gem(g, CX, 56, 9, p);
  g.fillStyle = goldV(SWORD_TOP_Y, SWORD_TOP_Y + 30); crossPath(g); g.fill();
  g.strokeStyle = p.deep; g.lineWidth = 1.4; crossPath(g); g.stroke();
  return k.c;
}

function paintSwordHot(): HTMLCanvasElement | null {
  const k = canvas(SWORD_W, SWORD_H); if (!k) return null;
  const g = k.g;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = 6;
  // The edge lights: just inside each edge, strongest near the guard, fading to the point.
  const edge = g.createLinearGradient(0, 210, 0, SWORD_TIP_Y);
  edge.addColorStop(0, 'rgba(255,255,255,0.95)'); edge.addColorStop(0.75, 'rgba(255,255,255,0.55)'); edge.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.strokeStyle = edge; g.lineWidth = 2.4;
  g.beginPath(); g.moveTo(CX - 26, 212); g.lineTo(CX - 23, 560); g.quadraticCurveTo(CX - 19, 636, CX, SWORD_TIP_Y - 6); g.stroke();
  g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(CX + 26, 212); g.lineTo(CX + 23, 560); g.quadraticCurveTo(CX + 19, 636, CX, SWORD_TIP_Y - 6); g.stroke();
  // The ridge: a white line down the middle.
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(CX + 1, 256); g.lineTo(CX + 1, 600); g.stroke();
  // Runes glowing in the fuller.
  g.lineWidth = 2; g.strokeStyle = '#fff';
  for (let i = 0; i < 6; i++) {
    const y = 280 + i * 48;
    if (i % 2 === 0) { g.beginPath(); g.moveTo(CX, y - 8); g.lineTo(CX, y + 8); g.moveTo(CX - 5, y - 2); g.lineTo(CX + 5, y - 2); g.stroke(); }
    else { g.beginPath(); g.arc(CX, y, 3.2, 0, Math.PI * 2); g.fill(); }
  }
  // Gem glints.
  const glint = (x: number, y: number, r: number): void => {
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.18, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.18, y); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x - r, y); g.lineTo(x, y + r * 0.18); g.lineTo(x + r, y); g.lineTo(x, y - r * 0.18); g.closePath(); g.fill();
  };
  glint(CX - 3, 185, 14); glint(CX - 2, 53, 11); glint(CX, 219, 7);
  // The top edge of the wings catches the light.
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.4;
  for (const s of [1, -1]) { g.beginPath(); g.moveTo(CX + s * 10, 175); g.bezierCurveTo(CX + s * 34, 171, CX + s * 60, 171, CX + s * 78, 156); g.stroke(); }
  return k.c;
}

// ─── the white shapes (tinted per sprite) ──────────────────────────────────────────────────────────────────────

/** The holy rune circle: a double outer ring set with crosses and dots, an inner ring, a radiant cross and a sun. */
function paintSigil(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.02;
  const ring = (r: number, w: number): void => { g.lineWidth = w; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); };
  ring(D * 0.46, D * 0.026);
  ring(D * 0.395, D * 0.011);
  // Between the rings: small crosses at the eight winds, dots between.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = D * 0.428;
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    if (i % 3 === 0) {
      const s = D * 0.018;
      g.lineWidth = D * 0.009;
      const tx = -Math.sin(a), ty = Math.cos(a);
      g.beginPath(); g.moveTo(x - Math.cos(a) * s, y - Math.sin(a) * s); g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s);
      g.moveTo(x - tx * s, y - ty * s); g.lineTo(x + tx * s, y + ty * s); g.stroke();
    } else { g.beginPath(); g.arc(x, y, D * 0.006, 0, Math.PI * 2); g.fill(); }
  }
  ring(D * 0.29, D * 0.012);
  // The radiant cross: four long tapered rays, four short ones between.
  const ray = (a: number, r0: number, r1: number, w: number): void => {
    const tx = -Math.sin(a), ty = Math.cos(a);
    const x0 = c + Math.cos(a) * r0, y0 = c + Math.sin(a) * r0, x1 = c + Math.cos(a) * r1, y1 = c + Math.sin(a) * r1;
    g.beginPath(); g.moveTo(x0 + tx * w, y0 + ty * w); g.lineTo(x1, y1); g.lineTo(x0 - tx * w, y0 - ty * w); g.closePath(); g.fill();
  };
  for (let i = 0; i < 4; i++) ray((i / 4) * Math.PI * 2 - Math.PI / 2, D * 0.07, D * 0.385, D * 0.022);
  for (let i = 0; i < 4; i++) ray((i / 4) * Math.PI * 2 - Math.PI / 4, D * 0.07, D * 0.24, D * 0.014);
  ring(D * 0.1, D * 0.012);
  g.beginPath(); g.arc(c, c, D * 0.045, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** God rays: long and short tapered rays round a clear middle (the face under them stays clean). */
function paintRays(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  g.fillStyle = '#fff';
  const n = 20;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const long = i % 2 === 0;
    const r1 = D * (long ? 0.5 : 0.34);
    const w = long ? 0.07 : 0.05;
    g.beginPath(); g.moveTo(c, c);
    g.lineTo(c + Math.cos(a - w) * r1, c + Math.sin(a - w) * r1);
    g.lineTo(c + Math.cos(a + w) * r1, c + Math.sin(a + w) * r1);
    g.closePath(); g.fill();
  }
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createRadialGradient(c, c, 0, c, c, c);
  fade.addColorStop(0, 'rgba(255,255,255,0)'); fade.addColorStop(0.2, 'rgba(255,255,255,0.15)');
  fade.addColorStop(0.34, 'rgba(255,255,255,1)'); fade.addColorStop(0.7, 'rgba(255,255,255,0.45)'); fade.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = fade; g.fillRect(0, 0, D, D);
  return k.c;
}

/** A pillar of light: a soft column with a bright middle, fading out toward its top (anchor at the bottom). */
function paintPillar(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const h = g.createLinearGradient(0, 0, W, 0);
  h.addColorStop(0, 'rgba(255,255,255,0)'); h.addColorStop(0.22, 'rgba(255,255,255,0.22)'); h.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  h.addColorStop(0.5, 'rgba(255,255,255,1)'); h.addColorStop(0.6, 'rgba(255,255,255,0.8)'); h.addColorStop(0.78, 'rgba(255,255,255,0.22)');
  h.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = h; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-in';
  const v = g.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.35, 'rgba(255,255,255,0.55)'); v.addColorStop(0.9, 'rgba(255,255,255,1)');
  v.addColorStop(1, 'rgba(255,255,255,0.7)');
  g.fillStyle = v; g.fillRect(0, 0, W, H);
  return k.c;
}

/** A tongue of holy flame: round at the root, licking up to a point (anchor near the bottom). */
function paintFlame(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const x = W / 2;
  const v = g.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.25, 'rgba(255,255,255,0.35)'); v.addColorStop(0.7, 'rgba(255,255,255,1)');
  v.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = v; g.shadowColor = '#fff'; g.shadowBlur = W * 0.08;
  g.beginPath();
  g.moveTo(x + W * 0.04, H * 0.02);
  g.bezierCurveTo(x + W * 0.16, H * 0.3, x + W * 0.44, H * 0.52, x + W * 0.36, H * 0.78);
  g.bezierCurveTo(x + W * 0.3, H * 0.97, x - W * 0.3, H * 0.97, x - W * 0.36, H * 0.78);
  g.bezierCurveTo(x - W * 0.42, H * 0.56, x - W * 0.12, H * 0.34, x + W * 0.04, H * 0.02);
  g.closePath(); g.fill();
  return k.c;
}

/** A spear of light pointing +X: a diamond head, a shaft tapering back to nothing. */
function paintSpear(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const y = H / 2;
  g.shadowColor = '#fff'; g.shadowBlur = H * 0.25;
  const sh = g.createLinearGradient(0, 0, W, 0);
  sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.45, 'rgba(255,255,255,0.6)'); sh.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = sh;
  g.beginPath(); g.moveTo(W * 0.02, y); g.lineTo(W * 0.74, y - H * 0.09); g.lineTo(W * 0.74, y + H * 0.09); g.closePath(); g.fill();
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(W * 0.7, y); g.lineTo(W * 0.8, y - H * 0.28); g.lineTo(W * 0.99, y); g.lineTo(W * 0.8, y + H * 0.28); g.closePath(); g.fill();
  // a small crossbar at the head's base
  g.fillRect(W * 0.7, y - H * 0.3, W * 0.025, H * 0.6);
  return k.c;
}

/** Three holy runes (a cross in a ring, a sun, a warded diamond), each on its own square. */
function paintGlyph(D: number, kind: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.06;
  g.lineWidth = D * 0.07;
  if (kind === 0) {
    g.beginPath(); g.arc(c, c, D * 0.33, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(c, c - D * 0.24); g.lineTo(c, c + D * 0.24); g.moveTo(c - D * 0.18, c - D * 0.04); g.lineTo(c + D * 0.18, c - D * 0.04); g.stroke();
  } else if (kind === 1) {
    g.beginPath(); g.arc(c, c, D * 0.13, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const r0 = D * 0.2, r1 = D * (i % 2 ? 0.3 : 0.4);
      g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
    }
  } else {
    g.beginPath(); g.moveTo(c, c - D * 0.38); g.lineTo(c + D * 0.28, c); g.lineTo(c, c + D * 0.38); g.lineTo(c - D * 0.28, c); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(c, c - D * 0.18); g.lineTo(c, c + D * 0.18); g.stroke();
    g.beginPath(); g.arc(c, c - D * 0.02, D * 0.05, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

/** A radiant crack pointing +X from its origin (anchor at the left): a jagged line with two small branches. */
function paintCrack(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(1717);
  const y = H / 2;
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = H * 0.2;
  const pts: [number, number][] = [[2, y]];
  for (let x = 12; x < W - 4; x += 10 + rnd() * 6) pts.push([x, y + (rnd() - 0.5) * H * 0.45]);
  pts.push([W - 3, y]);
  const along = g.createLinearGradient(0, 0, W, 0);
  along.addColorStop(0, 'rgba(255,255,255,1)'); along.addColorStop(1, 'rgba(255,255,255,0.25)');
  g.strokeStyle = along;
  g.lineWidth = H * 0.14;
  g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke();
  g.lineWidth = H * 0.08;
  for (const bi of [3, 6]) {
    const p = pts[Math.min(bi, pts.length - 1)]!;
    const s = bi === 3 ? -1 : 1;
    g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(p[0] + 12, p[1] + s * H * 0.22); g.lineTo(p[0] + 22, p[1] + s * H * 0.36); g.stroke();
  }
  return k.c;
}

/** A soft, lumpy dust puff. */
function paintPuff(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(4242);
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2, r = D * 0.12 * rnd();
    const x = D / 2 + Math.cos(a) * r, y = D / 2 + Math.sin(a) * r;
    const rr = D * (0.22 + rnd() * 0.12);
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, D, D);
  }
  return k.c;
}

/** A light chip (debris): a thin lit diamond. */
function paintChip(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  g.fillStyle = '#fff'; g.shadowColor = '#fff'; g.shadowBlur = 2;
  g.beginPath(); g.moveTo(1, H / 2); g.lineTo(W * 0.45, 1); g.lineTo(W - 1, H / 2); g.lineTo(W * 0.45, H - 1); g.closePath(); g.fill();
  return k.c;
}

let cached: HeroHolyTextures | null = null;
let swordKey = '';

/** The session's textures, painted on first use. Null when no 2D canvas is available (Holy then skips Pixi). */
export function heroHolyTextures(p: SwordPalette): HeroHolyTextures | null {
  const key = `${p.gold}|${p.deep}|${p.sky}|${p.core}`;
  if (cached && key === swordKey) return cached;
  if (cached) {
    // DEV only: a colour moved in the tuner; repaint just the sword. The old texture is kept alive, not destroyed (a
    // scene still playing may hold it; it is a few hundred KB and only a tuner session ever makes more than one).
    const body = paintSwordBody(p);
    if (body) { cached = { ...cached, swordBody: tex(body) }; swordKey = key; }
    return cached;
  }
  const base = heroArcanaTextures();
  const sGlow = paintSwordGlow(), sBody = paintSwordBody(p), sHot = paintSwordHot();
  const sigil = paintSigil(256), rays = paintRays(256), pillar = paintPillar(64, 256), flame = paintFlame(64, 128);
  const spear = paintSpear(192, 40), crack = paintCrack(128, 24), puff = paintPuff(64), chip = paintChip(16, 8);
  const g0 = paintGlyph(48, 0), g1 = paintGlyph(48, 1), g2 = paintGlyph(48, 2);
  if (!base || !sGlow || !sBody || !sHot || !sigil || !rays || !pillar || !flame || !spear || !crack || !puff || !chip || !g0 || !g1 || !g2) return null;
  cached = {
    ...base,
    swordGlow: tex(sGlow), swordBody: tex(sBody), swordHot: tex(sHot),
    hsigil: tex(sigil), rays: tex(rays), pillar: tex(pillar), flame: tex(flame), spear: tex(spear), crack: tex(crack),
    puff: tex(puff), chip: tex(chip), glyphs: [tex(g0), tex(g1), tex(g2)],
  };
  swordKey = key;
  return cached;
}
