/**
 * The Phantom Blades' textures, painted ONCE per session on 2D canvases and kept (about 650 KB of GPU memory on top of
 * the Blast's five, which it shares: glow, spark, streak, ring, beam). Everything is white or grey, so every sprite
 * tints it.
 *
 * A sword is FOUR layers painted on the same 384 x 96 box, pointing along +x with the guard at `SWORD_TEX.guard`, so one
 * transform places all four: a soft GLOW (the whole silhouette, blurred), the BLADE (grey, bevelled, with a darker
 * fuller: it takes the side colour), the HILT (guard, grip and pommel: it takes the gold), and the EDGE (the two
 * cutting edges, the fuller's highlight and a gleam at the tip: additive white). Bold, clean silhouettes (the owner's
 * bar: "clean", "thicker and cleaner"), never noise.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroBlastTextures } from '../heroBlast/heroBlastTextures';
import { SWORD_TEX } from './heroBladesConfig';
import type { HeroBladesTextures } from './heroBladesScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

const { w: W, h: H, pommel: PX, guard: GX, tip: TX } = SWORD_TEX;
const CY = H / 2;
/** The blade: full width at the guard, a long gentle taper, then a sharp point. */
const BLADE_BASE = 21, BLADE_MID = 17, BLADE_SHOULDER = TX - 84;

function bladePath(g: CanvasRenderingContext2D, grow = 0): void {
  g.beginPath();
  g.moveTo(GX + 6, CY - BLADE_BASE - grow);
  g.lineTo(BLADE_SHOULDER, CY - BLADE_MID - grow);
  g.lineTo(TX + grow, CY);
  g.lineTo(BLADE_SHOULDER, CY + BLADE_MID + grow);
  g.lineTo(GX + 6, CY + BLADE_BASE + grow);
  g.closePath();
}

/** Guard (swept quillons), grip and pommel, as one path. */
function hiltPath(g: CanvasRenderingContext2D, grow = 0): void {
  g.beginPath();
  // The crossguard: a bar with quillons sweeping toward the blade, and a diamond boss in the middle.
  g.moveTo(GX - 7 - grow, CY - 6 - grow);
  g.quadraticCurveTo(GX - 4, CY - 30, GX + 8 + grow, CY - 40 - grow);
  g.lineTo(GX + 12 + grow, CY - 34);
  g.quadraticCurveTo(GX + 6 + grow, CY - 22, GX + 7 + grow, CY - 6);
  g.lineTo(GX + 7 + grow, CY + 6);
  g.quadraticCurveTo(GX + 6 + grow, CY + 22, GX + 12 + grow, CY + 34);
  g.lineTo(GX + 8 + grow, CY + 40 + grow);
  g.quadraticCurveTo(GX - 4, CY + 30, GX - 7 - grow, CY + 6 + grow);
  g.closePath();
  // The grip.
  g.rect(PX + 16 - grow, CY - 6.5 - grow, GX - 7 - (PX + 16) + grow * 2, 13 + grow * 2);
  // The pommel.
  g.moveTo(PX + 12 + 11 + grow, CY);
  g.arc(PX + 12, CY, 11 + grow, 0, Math.PI * 2);
}

function paintGlow(): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  g.fillStyle = '#fff'; g.shadowColor = '#fff';
  // Draw the silhouette far off the canvas and keep only its SHADOW, so the glow is a pure soft bell (no hard core).
  const OFF = 2000;
  g.save(); g.translate(-OFF, 0); g.shadowOffsetX = OFF;
  g.shadowBlur = 16; bladePath(g, 5); g.fill(); hiltPath(g, 3); g.fill();
  g.shadowBlur = 6; bladePath(g, 1); g.fill(); hiltPath(g, 0); g.fill();
  g.restore();
  return k.c;
}

function paintBlade(): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  // A bevel: bright at both edges, a touch darker toward the spine, the upper face lit a little more than the lower.
  const v = g.createLinearGradient(0, CY - BLADE_BASE, 0, CY + BLADE_BASE);
  v.addColorStop(0, '#ffffff'); v.addColorStop(0.18, '#f1f1f1'); v.addColorStop(0.46, '#c9c9c9');
  v.addColorStop(0.54, '#b3b3b3'); v.addColorStop(0.82, '#dadada'); v.addColorStop(1, '#f4f4f4');
  g.fillStyle = v; bladePath(g); g.fill();
  // The fuller: a darker groove down the middle of the blade, with a soft end.
  const f = g.createLinearGradient(GX + 14, 0, BLADE_SHOULDER + 10, 0);
  f.addColorStop(0, 'rgba(70,70,70,0.75)'); f.addColorStop(0.8, 'rgba(70,70,70,0.6)'); f.addColorStop(1, 'rgba(70,70,70,0)');
  g.fillStyle = f;
  g.beginPath(); g.moveTo(GX + 14, CY - 3.2); g.lineTo(BLADE_SHOULDER + 10, CY - 1.4); g.lineTo(BLADE_SHOULDER + 10, CY + 1.4); g.lineTo(GX + 14, CY + 3.2); g.closePath(); g.fill();
  // A crisp dark outline so the silhouette holds on a bright board.
  g.strokeStyle = 'rgba(40,40,40,0.9)'; g.lineWidth = 1.6; g.lineJoin = 'miter';
  bladePath(g); g.stroke();
  return k.c;
}

function paintHilt(): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const v = g.createLinearGradient(0, CY - 40, 0, CY + 40);
  v.addColorStop(0, '#ffffff'); v.addColorStop(0.45, '#e6e6e6'); v.addColorStop(0.55, '#a8a8a8'); v.addColorStop(1, '#d0d0d0');
  g.fillStyle = v; hiltPath(g); g.fill('nonzero');
  // Grip wraps.
  g.strokeStyle = 'rgba(60,60,60,0.8)'; g.lineWidth = 2;
  for (let x = PX + 22; x < GX - 10; x += 9) { g.beginPath(); g.moveTo(x, CY - 6.5); g.lineTo(x + 5, CY + 6.5); g.stroke(); }
  g.strokeStyle = 'rgba(40,40,40,0.9)'; g.lineWidth = 1.6;
  hiltPath(g); g.stroke();
  // The pommel gem.
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(PX + 12, CY, 4.5, 0, Math.PI * 2); g.fill();
  return k.c;
}

function paintEdge(): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = 4;
  // The two cutting edges, just inside the silhouette, brightening toward the point.
  const edge = (s: 1 | -1): void => {
    const gr = g.createLinearGradient(GX, 0, TX, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.strokeStyle = gr; g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(GX + 8, CY + s * (BLADE_BASE - 2)); g.lineTo(BLADE_SHOULDER, CY + s * (BLADE_MID - 1.8)); g.lineTo(TX - 3, CY); g.stroke();
  };
  edge(-1); edge(1);
  // The fuller's highlight: a thin bright line along the spine.
  const sp = g.createLinearGradient(GX + 14, 0, TX, 0);
  sp.addColorStop(0, 'rgba(255,255,255,0.15)'); sp.addColorStop(0.6, 'rgba(255,255,255,0.55)'); sp.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.strokeStyle = sp; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(GX + 16, CY - 4.6); g.lineTo(TX - 18, CY - 0.8); g.stroke();
  // A gleam at the point.
  const gl = g.createRadialGradient(TX - 10, CY, 0, TX - 10, CY, 22);
  gl.addColorStop(0, 'rgba(255,255,255,0.95)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  g.shadowBlur = 0; g.fillStyle = gl; g.fillRect(TX - 34, CY - 22, 44, 44);
  return k.c;
}

/** A shard: a sharp sliver of a blade (a long thin triangle) with one bright edge. */
function paintShard(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  g.fillStyle = '#e6e6e6';
  g.beginPath(); g.moveTo(D * 0.06, D * 0.56); g.lineTo(D * 0.94, D * 0.32); g.lineTo(D * 0.62, D * 0.72); g.closePath(); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = D * 0.06; g.lineCap = 'round';
  g.beginPath(); g.moveTo(D * 0.1, D * 0.54); g.lineTo(D * 0.9, D * 0.34); g.stroke();
  return k.c;
}

/** A cut: a thin lens of light, bright in the middle and needle-thin at both ends. */
function paintSlash(L: number, T: number): HTMLCanvasElement | null {
  const k = canvas(L, T); if (!k) return null;
  const g = k.g;
  const gr = g.createLinearGradient(0, 0, L, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)');
  gr.addColorStop(0.65, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(0, T / 2); g.quadraticCurveTo(L / 2, -T * 0.35, L, T / 2); g.quadraticCurveTo(L / 2, T * 1.35, 0, T / 2); g.fill();
  return k.c;
}

/** The judgement reticle: a thick outer ring, four chevrons pointing in, a thin inner ring and tick marks. */
function paintReticle(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'miter';
  g.shadowColor = '#fff'; g.shadowBlur = D * 0.02;
  g.lineWidth = D * 0.03; g.beginPath(); g.arc(c, c, D * 0.43, 0, Math.PI * 2); g.stroke();
  g.lineWidth = D * 0.012; g.beginPath(); g.arc(c, c, D * 0.2, 0, Math.PI * 2); g.stroke();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + Math.PI / 16;
    const r0 = D * 0.35, r1 = D * (i % 2 ? 0.38 : 0.395);
    g.lineWidth = D * 0.012;
    g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
    const ux = Math.cos(a), uy = Math.sin(a), px = -uy, py = ux;
    const tip = D * 0.27, base = D * 0.4, half = D * 0.06;
    g.beginPath();
    g.moveTo(c + ux * tip, c + uy * tip);
    g.lineTo(c + ux * base + px * half, c + uy * base + py * half);
    g.lineTo(c + ux * (base - D * 0.035), c + uy * (base - D * 0.035));
    g.lineTo(c + ux * base - px * half, c + uy * base - py * half);
    g.closePath(); g.fill();
  }
  return k.c;
}

let cached: HeroBladesTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the Blades then skip Pixi). */
export function heroBladesTextures(): HeroBladesTextures | null {
  if (cached) return cached;
  const base = heroBlastTextures();
  const glow = paintGlow(), blade = paintBlade(), hilt = paintHilt(), edge = paintEdge();
  const shard = paintShard(32), slash = paintSlash(128, 16), reticle = paintReticle(192);
  if (!base || !glow || !blade || !hilt || !edge || !shard || !slash || !reticle) return null;
  cached = {
    ...base, swordGlow: tex(glow), swordBlade: tex(blade), swordHilt: tex(hilt), swordEdge: tex(edge),
    shard: tex(shard), slash: tex(slash), reticle: tex(reticle),
  };
  return cached;
}
