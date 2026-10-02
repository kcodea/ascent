/**
 * Bullet Time's textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast / Arcana set it
 * reuses for glows, rings, stars, the beam and the ribbon trail). Greys unless noted, so every sprite tints them:
 *  - DART: a gold clock-hand dart (a slim tapered blade with a ring at its base), pointing right, tip at the right edge.
 *  - GLINT: a thin bright streak that runs along a hung dart's edge.
 *  - MOTE: a soft speck of drifting dust.
 *  - CLOCK FACE: an outer and an inner ring, sixty minute ticks, twelve hour bars.
 *  - HAND: a clock hand pivoting on its base (anchor at the left end).
 *  - DIGITS: the 3, 2 and 1 of IV's countdown (bold, with a dark edge so they hold on any board).
 *  - WASH: a flat white quad (the restart flash).
 * No hero or Ancient art is used (owner 2026-10-02: "i dont like using the art for the attack").
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroBulletTimeTextures } from './heroBulletTimeScene';

export const DART_W = 128;
export const DART_H = 24;
export const FACE_PX = 512;
export const HAND_PX = 128;
export const DIGIT_PX = 160;
export const WASH_PX = 16;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

function paintDart(): HTMLCanvasElement | null {
  const k = canvas(DART_W, DART_H); if (!k) return null;
  const g = k.g;
  const cy = DART_H / 2;
  // The blade: a long taper from the base ring to a needle tip, lit along its top edge.
  const shade = g.createLinearGradient(0, cy - 6, 0, cy + 6);
  shade.addColorStop(0, 'rgb(255,255,255)'); shade.addColorStop(0.5, 'rgb(225,225,225)'); shade.addColorStop(1, 'rgb(150,150,150)');
  g.fillStyle = shade;
  g.beginPath(); g.moveTo(18, cy - 5); g.lineTo(60, cy - 4); g.lineTo(DART_W - 2, cy); g.lineTo(60, cy + 4); g.lineTo(18, cy + 5); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(60,60,60,0.9)'; g.lineWidth = 1.2; g.stroke();
  // The base ring (a clock hand's pivot) and a little counterweight tail.
  g.beginPath(); g.arc(14, cy, 7, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = 'rgba(70,70,70,0.9)'; g.beginPath(); g.arc(14, cy, 3, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgb(220,220,220)'; g.beginPath(); g.moveTo(7, cy); g.lineTo(1, cy - 4); g.lineTo(1, cy + 4); g.closePath(); g.fill();
  return k.c;
}

function paintGlint(): HTMLCanvasElement | null {
  const k = canvas(64, 8); if (!k) return null;
  const g = k.g;
  const gr = g.createLinearGradient(0, 0, 64, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.ellipse(32, 4, 32, 3, 0, 0, Math.PI * 2); g.fill();
  return k.c;
}

function paintMote(): HTMLCanvasElement | null {
  const k = canvas(16, 16); if (!k) return null;
  const g = k.g;
  const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 16, 16);
  return k.c;
}

function paintClockFace(): HTMLCanvasElement | null {
  const k = canvas(FACE_PX, FACE_PX); if (!k) return null;
  const g = k.g;
  const c = FACE_PX / 2;
  const R = FACE_PX * 0.47;
  const fill = g.createRadialGradient(c, c, R * 0.2, c, c, R);
  fill.addColorStop(0, 'rgba(255,255,255,0)'); fill.addColorStop(0.8, 'rgba(255,255,255,0.06)'); fill.addColorStop(1, 'rgba(255,255,255,0.16)');
  g.fillStyle = fill; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 7; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2.5; g.beginPath(); g.arc(c, c, R * 0.86, 0, Math.PI * 2); g.stroke();
  g.lineCap = 'round';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const hour = i % 5 === 0;
    g.lineWidth = hour ? 9 : 2.5;
    const r0 = hour ? R * 0.72 : R * 0.88, r1 = R * 0.95;
    g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
  }
  return k.c;
}

function paintHand(): HTMLCanvasElement | null {
  const k = canvas(HAND_PX, 20); if (!k) return null;
  const g = k.g;
  g.fillStyle = 'rgb(245,245,245)';
  g.beginPath(); g.moveTo(4, 10); g.lineTo(18, 4); g.lineTo(HAND_PX - 6, 9); g.lineTo(HAND_PX - 2, 10); g.lineTo(HAND_PX - 6, 11); g.lineTo(18, 16); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(70,70,70,0.9)'; g.lineWidth = 1.2; g.stroke();
  g.beginPath(); g.arc(10, 10, 6, 0, Math.PI * 2); g.fill(); g.stroke();
  return k.c;
}

function paintDigit(d: string): HTMLCanvasElement | null {
  const k = canvas(DIGIT_PX, DIGIT_PX); if (!k) return null;
  const g = k.g;
  g.font = `900 ${Math.round(DIGIT_PX * 0.82)}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(30,27,75,0.95)'; g.lineWidth = 12; g.strokeText(d, DIGIT_PX / 2, DIGIT_PX * 0.54);
  g.fillStyle = '#fff'; g.fillText(d, DIGIT_PX / 2, DIGIT_PX * 0.54);
  return k.c;
}

function paintWash(): HTMLCanvasElement | null {
  const k = canvas(WASH_PX, WASH_PX); if (!k) return null;
  k.g.fillStyle = '#fff'; k.g.fillRect(0, 0, WASH_PX, WASH_PX);
  return k.c;
}

let cached: HeroBulletTimeTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroBulletTimeTextures(): HeroBulletTimeTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const dart = paintDart(), glint = paintGlint(), mote = paintMote(), face = paintClockFace(), hand = paintHand(), wash = paintWash();
  const d3 = paintDigit('3'), d2 = paintDigit('2'), d1 = paintDigit('1');
  if (!base || !dart || !glint || !mote || !face || !hand || !wash || !d3 || !d2 || !d1) return null;
  cached = {
    ...base, dart: tex(dart), glint: tex(glint), mote: tex(mote), clockFace: tex(face), clockHand: tex(hand), wash: tex(wash),
    digit3: tex(d3), digit2: tex(d2), digit1: tex(d1),
  };
  return cached;
}
