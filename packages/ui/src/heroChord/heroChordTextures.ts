/**
 * Power Chord's textures, painted ONCE per session on 2D canvases and kept (about 700 KB of its own on top of the Blast
 * and Arcana basics it shares).
 *
 * The STAFF LINES are strips whose U runs along the line and V across it, so their two textures only vary ACROSS (down
 * the canvas): a soft bell for the glow (also the dark band laid under the whole staff), and a white-hot core with a
 * soft shoulder for the string itself. Both strings are drawn ADDITIVE: a string is light, not ink.
 *
 * The NOTES (an eighth note and a beamed pair) are painted in WHITE with a dark ink outline, a soft top-left to
 * bottom-right shade and a gloss spot on each head, so a sprite's tint colours the body while the outline stays dark and
 * the note reads on any board. `NOTE_HEAD` / `BEAM_HEAD` are each texture's anchor: the middle of its (first) head, the
 * point that sits ON a staff line.
 *
 * The BASS WAVE is one THICK crescent: a slice of a big circle's rim, a wide bright front with a bloom and a broad wake
 * behind it, fading toward both tips. `WAVE_ANCHOR_X` puts a sprite's anchor on that circle's CENTRE (far outside the texture), so
 * scaling the sprite grows the arc outward from the speaker like a real wavefront.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroChordTextures } from './heroChordScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

const INK = 'rgba(24,14,44,1)';

// ── the staff ────────────────────────────────────────────────────────────────────────────────────────────────

/** A staff line's glow: a soft bell across (V), constant along (U). */
function paintLineGlow(): HTMLCanvasElement | null {
  const k = canvas(8, 64); if (!k) return null;
  const gr = k.g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, 8, 64);
  return k.c;
}

/** The string itself: a white-hot middle with a soft shoulder either side (drawn additive: light, not ink). */
function paintLineCore(): HTMLCanvasElement | null {
  const k = canvas(8, 32); if (!k) return null;
  const gr = k.g.createLinearGradient(0, 0, 0, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.22, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.4, 'rgba(255,255,255,1)');
  gr.addColorStop(0.6, 'rgba(255,255,255,1)'); gr.addColorStop(0.78, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, 8, 32);
  return k.c;
}

// ── the notes ────────────────────────────────────────────────────────────────────────────────────────────────

export const NOTE_W = 160, NOTE_H = 224;
/** The eighth note's anchor: the middle of its head. */
export const NOTE_HEAD = { x: 60 / NOTE_W, y: 176 / NOTE_H } as const;
export const BEAM_W = 232, BEAM_H = 224;
/** The beamed pair's anchor: the middle of its first (lower) head. */
export const BEAM_HEAD = { x: 58 / BEAM_W, y: 182 / BEAM_H } as const;

function headPath(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  g.beginPath();
  g.ellipse(x, y, rx, ry, -0.38, 0, Math.PI * 2);
}

/** Fill the current path with the note's body shade (white at the top left, a cool grey at the bottom right). */
function bodyFill(g: CanvasRenderingContext2D, w: number, h: number): void {
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#f1eef7'); gr.addColorStop(1, '#b4aecb');
  g.fillStyle = gr;
  g.fill();
}

function headGloss(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  // A darker underside, then a white gloss spot up and to the left.
  g.save();
  headPath(g, x, y, rx, ry); g.clip();
  const sh = g.createRadialGradient(x - rx * 0.3, y - ry * 0.5, ry * 0.3, x, y, rx * 1.15);
  sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.7, 'rgba(120,108,160,0.12)'); sh.addColorStop(1, 'rgba(70,58,110,0.5)');
  g.fillStyle = sh; g.fillRect(x - rx * 1.4, y - ry * 1.6, rx * 2.8, ry * 3.2);
  g.restore();
  g.save();
  g.translate(x - rx * 0.34, y - ry * 0.42); g.rotate(-0.5);
  const gl = g.createRadialGradient(0, 0, 0, 0, 0, rx * 0.42);
  gl.addColorStop(0, 'rgba(255,255,255,1)'); gl.addColorStop(0.55, 'rgba(255,255,255,0.75)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gl;
  g.beginPath(); g.ellipse(0, 0, rx * 0.42, ry * 0.26, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}

/** An eighth note: a tilted glossy head, a stem and a curling flag. */
function paintNote(): HTMLCanvasElement | null {
  const k = canvas(NOTE_W, NOTE_H); if (!k) return null;
  const g = k.g;
  const hx = 60, hy = 176, rx = 40, ry = 29;
  const stemX = 91, stemTop = 26;
  const shapes = (): void => {
    headPath(g, hx, hy, rx, ry);
    g.moveTo(stemX - 6, hy - 8); g.lineTo(stemX - 6, stemTop); g.lineTo(stemX + 6, stemTop); g.lineTo(stemX + 6, hy - 8); g.closePath();
    // The flag: leaves the stem top, bellies out to the right and curls back in.
    g.moveTo(stemX + 2, stemTop);
    g.bezierCurveTo(stemX + 10, stemTop + 44, stemX + 62, stemTop + 52, stemX + 40, stemTop + 112);
    g.bezierCurveTo(stemX + 48, stemTop + 72, stemX + 22, stemTop + 62, stemX + 2, stemTop + 50);
    g.closePath();
  };
  g.lineJoin = 'round'; g.lineCap = 'round';
  // The ink outline (a soft drop of the same ink under it lifts the note off the board).
  g.save();
  g.shadowColor = 'rgba(10,6,24,0.55)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
  g.strokeStyle = INK; g.lineWidth = 12;
  shapes(); g.stroke();
  g.restore();
  shapes(); bodyFill(g, NOTE_W, NOTE_H);
  headGloss(g, hx, hy, rx, ry);
  // A thin light down the stem's left edge.
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(stemX - 3, stemTop + 8); g.lineTo(stemX - 3, hy - 34); g.stroke();
  return k.c;
}

/** A beamed pair: two glossy heads, two stems, one thick slanted beam across the top. */
function paintBeam(): HTMLCanvasElement | null {
  const k = canvas(BEAM_W, BEAM_H); if (!k) return null;
  const g = k.g;
  const rx = 36, ry = 26;
  const h1 = { x: 58, y: 182 }, h2 = { x: 162, y: 160 };
  const s1 = h1.x + 28, s2 = h2.x + 28;
  const t1 = 48, t2 = 26;
  const shapes = (): void => {
    headPath(g, h1.x, h1.y, rx, ry);
    g.moveTo(h2.x + rx, h2.y); g.ellipse(h2.x, h2.y, rx, ry, -0.38, 0, Math.PI * 2);
    g.moveTo(s1 - 5.5, h1.y - 8); g.lineTo(s1 - 5.5, t1); g.lineTo(s1 + 5.5, t1); g.lineTo(s1 + 5.5, h1.y - 8); g.closePath();
    g.moveTo(s2 - 5.5, h2.y - 8); g.lineTo(s2 - 5.5, t2); g.lineTo(s2 + 5.5, t2); g.lineTo(s2 + 5.5, h2.y - 8); g.closePath();
    g.moveTo(s1 - 5.5, t1 - 2); g.lineTo(s2 + 5.5, t2 - 2); g.lineTo(s2 + 5.5, t2 + 24); g.lineTo(s1 - 5.5, t1 + 24); g.closePath();
  };
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.save();
  g.shadowColor = 'rgba(10,6,24,0.55)'; g.shadowBlur = 8; g.shadowOffsetY = 3;
  g.strokeStyle = INK; g.lineWidth = 12;
  shapes(); g.stroke();
  g.restore();
  shapes(); bodyFill(g, BEAM_W, BEAM_H);
  headGloss(g, h1.x, h1.y, rx, ry);
  headGloss(g, h2.x, h2.y, rx, ry);
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(s1 - 2.5, t1 + 30); g.lineTo(s1 - 2.5, h1.y - 32); g.moveTo(s2 - 2.5, t2 + 30); g.lineTo(s2 - 2.5, h2.y - 32);
  g.moveTo(s1 + 2, t1 + 3); g.lineTo(s2 + 1, t2 + 3); g.stroke();
  return k.c;
}

// ── the bass wave ────────────────────────────────────────────────────────────────────────────────────────────

export const WAVE_W = 176, WAVE_H = 512;
/** The radius (texture px) of the circle the crescent is a slice of: a sprite at scale `s` draws a front `WAVE_R x s` out. */
export const WAVE_R = 380;
const WAVE_CX = -232;
/** A wave sprite's x anchor: the circle's centre, far to the left of the texture. Its y anchor is 0.5. */
export const WAVE_ANCHOR_X = WAVE_CX / WAVE_W;

/** The crescent: a wide bright front with a bloom, a broad wake behind it, both fading toward the tips. */
function paintWave(): HTMLCanvasElement | null {
  const k = canvas(WAVE_W, WAVE_H); if (!k) return null;
  const g = k.g;
  const cy = WAVE_H / 2;
  const half = Math.asin((WAVE_H / 2 - 10) / WAVE_R);
  g.lineCap = 'butt';
  // The wake: broad and faint, trailing well behind the front.
  g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 120;
  g.beginPath(); g.arc(WAVE_CX, cy, WAVE_R - 70, -half, half); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 70;
  g.beginPath(); g.arc(WAVE_CX, cy, WAVE_R - 42, -half, half); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.26)'; g.lineWidth = 38;
  g.beginPath(); g.arc(WAVE_CX, cy, WAVE_R - 24, -half, half); g.stroke();
  // The front: a thick bright rim with a bloom.
  g.save();
  g.shadowColor = 'rgba(255,255,255,0.95)'; g.shadowBlur = 18;
  g.strokeStyle = 'rgba(255,255,255,0.98)'; g.lineWidth = 17;
  g.beginPath(); g.arc(WAVE_CX, cy, WAVE_R - 11, -half, half); g.stroke();
  g.restore();
  // Fade toward both tips.
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, 0, WAVE_H);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.28, 'rgba(0,0,0,1)'); fade.addColorStop(0.72, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade; g.fillRect(0, 0, WAVE_W, WAVE_H);
  g.globalCompositeOperation = 'source-over';
  return k.c;
}

let cached: HeroChordTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroChordTextures(): HeroChordTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const lineGlow = paintLineGlow(), lineCore = paintLineCore(), note = paintNote(), beam = paintBeam();
  const wave = paintWave();
  if (!base || !lineGlow || !lineCore || !note || !beam || !wave) return null;
  cached = { ...base, lineGlow: tex(lineGlow), lineCore: tex(lineCore), note: tex(note), pair: tex(beam), wave: tex(wave) };
  return cached;
}
