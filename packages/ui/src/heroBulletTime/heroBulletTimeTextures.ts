/**
 * Timebreak's textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast / Arcana set it
 * reuses for glows, rings, stars, streaks, the beam and the ribbon trail). Greys unless noted, so every sprite tints them.
 *
 * ARCANE, NOT BALLISTIC (owner review 2026-10-02: "remove the bullet aesthetic. make it more magic inspired"): nothing
 * here is brass, metal or mechanical.
 *  - LANCE: a crystalline lance of light (a faceted shard, bright along its spine), pointing right, tip at the right edge.
 *  - GLYPH: a spinning time rune (an hourglass sigil in a ring): rides each lance's head, orbits the rune circle, drifts
 *    off the rifts.
 *  - GLINT: a thin bright streak that runs along a lance.
 *  - MOTE: a soft speck of drifting light.
 *  - RUNE CIRCLE (`clockFace`): the time motif as a MAGIC CIRCLE: two luminous rings with twelve time runes between them
 *    (hourglass, crescent, eye, diamond), a ring of sixty points, a small inner ring. Not a dial: no tick bars.
 *  - DIGITS: the 3, 2 and 1 of IV's countdown as glowing runes (a soft halo, no hard outline).
 *  - WASH: a flat white quad (the snap's flash).
 * No hero or Ancient art is used (owner 2026-10-02: "i dont like using the art for the attack").
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroBulletTimeTextures } from './heroBulletTimeScene';

export const DART_W = 128;
export const DART_H = 32;
export const FACE_PX = 512;
export const GLYPH_PX = 64;
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

/** A crystalline lance: a long faceted shard of light, widest two thirds along, a needle tip and a fading tail. */
function paintLance(): HTMLCanvasElement | null {
  const k = canvas(DART_W, DART_H); if (!k) return null;
  const g = k.g;
  const cy = DART_H / 2;
  const tail = 4, wide = 84, tip = DART_W - 3, hw = 9;
  g.shadowColor = '#fff'; g.shadowBlur = 6;
  const body = g.createLinearGradient(tail, 0, tip, 0);
  body.addColorStop(0, 'rgba(255,255,255,0)'); body.addColorStop(0.45, 'rgba(255,255,255,0.55)'); body.addColorStop(0.85, 'rgba(255,255,255,0.9)'); body.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = body;
  g.beginPath(); g.moveTo(tail, cy); g.lineTo(wide, cy - hw); g.lineTo(tip, cy); g.lineTo(wide, cy + hw); g.closePath(); g.fill();
  // The facets: a bright spine and two faint edges, so it reads as cut crystal, not a solid.
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(tail + 20, cy); g.lineTo(tip, cy); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(wide - 30, cy - hw * 0.65); g.lineTo(tip - 4, cy); g.lineTo(wide - 30, cy + hw * 0.65); g.stroke();
  return k.c;
}

/** A time rune: an hourglass sigil in a thin ring, with a dot top and bottom. */
function paintGlyph(): HTMLCanvasElement | null {
  const k = canvas(GLYPH_PX, GLYPH_PX); if (!k) return null;
  const g = k.g;
  const c = GLYPH_PX / 2;
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = 5;
  g.beginPath(); g.arc(c, c, 26, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.moveTo(c - 11, c - 15); g.lineTo(c + 11, c - 15); g.lineTo(c - 11, c + 15); g.lineTo(c + 11, c + 15); g.closePath(); g.stroke();
  for (const y of [c - 21, c + 21]) { g.beginPath(); g.arc(c, y, 2.6, 0, Math.PI * 2); g.fill(); }
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

/** The time rune circle: two rings, twelve runes between them, a ring of sixty points, a small inner ring. */
function paintRuneCircle(): HTMLCanvasElement | null {
  const k = canvas(FACE_PX, FACE_PX); if (!k) return null;
  const g = k.g;
  const c = FACE_PX / 2;
  const R = FACE_PX * 0.46;
  const fill = g.createRadialGradient(c, c, R * 0.3, c, c, R);
  fill.addColorStop(0, 'rgba(255,255,255,0)'); fill.addColorStop(0.85, 'rgba(255,255,255,0.05)'); fill.addColorStop(1, 'rgba(255,255,255,0.12)');
  g.fillStyle = fill; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round';
  g.shadowColor = '#fff'; g.shadowBlur = 10;
  const ring = (r: number, w: number): void => { g.lineWidth = w; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); };
  ring(R, 5); ring(R * 0.8, 2.5); ring(R * 0.42, 2);
  // Twelve time runes between the two outer rings.
  const rr = R * 0.9, s = R * 0.055;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    g.save(); g.translate(c + Math.cos(a) * rr, c + Math.sin(a) * rr); g.rotate(a + Math.PI / 2);
    g.lineWidth = 3;
    const kind = i % 4;
    if (kind === 0) { g.beginPath(); g.moveTo(-s, -s); g.lineTo(s, -s); g.lineTo(-s, s); g.lineTo(s, s); g.closePath(); g.stroke(); }
    else if (kind === 1) { g.beginPath(); g.arc(0, 0, s, Math.PI * 0.2, Math.PI * 1.8); g.stroke(); g.beginPath(); g.arc(s * 0.35, 0, s * 0.25, 0, Math.PI * 2); g.fill(); }
    else if (kind === 2) { g.beginPath(); g.ellipse(0, 0, s * 1.1, s * 0.55, 0, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(0, 0, s * 0.25, 0, Math.PI * 2); g.fill(); }
    else { g.beginPath(); g.moveTo(0, -s * 1.1); g.lineTo(s * 0.7, 0); g.lineTo(0, s * 1.1); g.lineTo(-s * 0.7, 0); g.closePath(); g.stroke(); }
    g.restore();
  }
  // Sixty points of light on the inner ring.
  g.shadowBlur = 4;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const big = i % 5 === 0;
    g.beginPath(); g.arc(c + Math.cos(a) * R * 0.72, c + Math.sin(a) * R * 0.72, big ? 4 : 1.8, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

/** A countdown rune: the digit drawn as glowing light (a soft halo, a bright core), no hard outline. */
function paintDigit(d: string): HTMLCanvasElement | null {
  const k = canvas(DIGIT_PX, DIGIT_PX); if (!k) return null;
  const g = k.g;
  g.font = `700 ${Math.round(DIGIT_PX * 0.74)}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#fff'; g.shadowBlur = 22;
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillText(d, DIGIT_PX / 2, DIGIT_PX * 0.54);
  g.shadowBlur = 8;
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
  const lance = paintLance(), glyph = paintGlyph(), glint = paintGlint(), mote = paintMote(), face = paintRuneCircle(), wash = paintWash();
  const d3 = paintDigit('3'), d2 = paintDigit('2'), d1 = paintDigit('1');
  if (!base || !lance || !glyph || !glint || !mote || !face || !wash || !d3 || !d2 || !d1) return null;
  cached = {
    ...base, lance: tex(lance), glyph: tex(glyph), glint: tex(glint), mote: tex(mote), clockFace: tex(face), wash: tex(wash),
    digit3: tex(d3), digit2: tex(d2), digit1: tex(d1),
  };
  return cached;
}
