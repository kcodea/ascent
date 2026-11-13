/**
 * Power Chord's textures, painted ONCE per session on 2D canvases and kept (about 700 KB of its own on top of the Blast
 * and Arcana basics it shares).
 *
 * The STAFF LINES are strips whose U runs along the line and V across it, so their two textures only vary ACROSS (down
 * the canvas): a soft bell for the glow, a solid middle with a thin feather for the string itself.
 *
 * The NOTES (an eighth note and a beamed pair) are painted in WHITE with a dark ink outline, a soft top-left to
 * bottom-right shade and a gloss spot on each head, so a sprite's tint colours the body while the outline stays dark and
 * the note reads on any board. `NOTE_HEAD` / `BEAM_HEAD` are each texture's anchor: the middle of its (first) head, the
 * point that sits ON a staff line.
 *
 * The SPEAKERS are painted in their own colours (black tolex, silver corners, grille cloth): a cabinet with two round
 * recesses, the amp head that sits on top of the stack, and one CONE (surround, ribbed paper, glossy dust cap) that is
 * drawn over each recess as its own sprite so it can pump.
 *
 * The BASS WAVE is one crescent: a slice of a big circle's rim, bright at its leading edge with a soft wake behind and
 * fading toward both tips. `WAVE_ANCHOR_X` puts a sprite's anchor on that circle's CENTRE (far outside the texture), so
 * scaling the sprite grows the arc outward from the speakers like a real wavefront.
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

/** The string itself: a dark ink edge either side of a bright solid middle, so it reads on light and dark boards alike. */
function paintLineCore(): HTMLCanvasElement | null {
  const k = canvas(8, 32); if (!k) return null;
  const gr = k.g.createLinearGradient(0, 0, 0, 32);
  gr.addColorStop(0, 'rgba(24,14,44,0)'); gr.addColorStop(0.14, 'rgba(24,14,44,0.9)'); gr.addColorStop(0.3, 'rgba(24,14,44,0.95)'); gr.addColorStop(0.36, 'rgba(255,255,255,1)');
  gr.addColorStop(0.64, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(24,14,44,0.95)'); gr.addColorStop(0.86, 'rgba(24,14,44,0.9)'); gr.addColorStop(1, 'rgba(24,14,44,0)');
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

// ── the speakers ─────────────────────────────────────────────────────────────────────────────────────────────

export const CAB_W = 256, CAB_H = 176;
/** The two cone recesses in a cabinet (texture px) and their radius. */
export const CAB_CONES = [{ x: 74, y: 90 }, { x: 182, y: 90 }] as const;
export const CAB_CONE_R = 50;
export const AMP_W = 232, AMP_H = 76;
export const CONE_D = 128;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** The black tolex box every piece of the stack is built from: lit from the top, an ink edge, four silver corners. */
function paintBox(g: CanvasRenderingContext2D, w: number, h: number): void {
  roundRect(g, 3, 3, w - 6, h - 6, 12);
  const body = g.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, '#4a4658'); body.addColorStop(0.12, '#2d2a38'); body.addColorStop(1, '#17151f');
  g.fillStyle = body; g.fill();
  g.strokeStyle = '#0b0912'; g.lineWidth = 5; g.stroke();
  // A soft light along the top edge (the tolex catching it).
  g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(16, 8.5); g.lineTo(w - 16, 8.5); g.stroke();
  // Silver corner caps.
  for (const [cx, cy, fx, fy] of [[3, 3, 1, 1], [w - 3, 3, -1, 1], [3, h - 3, 1, -1], [w - 3, h - 3, -1, -1]] as const) {
    g.save();
    g.translate(cx, cy); g.scale(fx, fy);
    g.beginPath(); g.moveTo(0, 10); g.quadraticCurveTo(0, 0, 10, 0); g.lineTo(24, 0); g.quadraticCurveTo(20, 20, 0, 24); g.closePath();
    const m = g.createLinearGradient(0, 0, 20, 20);
    m.addColorStop(0, '#f4f6fb'); m.addColorStop(0.5, '#a9afbf'); m.addColorStop(1, '#5d6274');
    g.fillStyle = m; g.fill();
    g.strokeStyle = '#0b0912'; g.lineWidth = 2; g.stroke();
    g.restore();
  }
}

/** A speaker cabinet: the box, a grille-cloth panel and two dark round recesses (the cones are their own sprites). */
function paintCab(): HTMLCanvasElement | null {
  const k = canvas(CAB_W, CAB_H); if (!k) return null;
  const g = k.g;
  paintBox(g, CAB_W, CAB_H);
  // The grille cloth: a warm dark weave inside a thin piping line.
  roundRect(g, 14, 16, CAB_W - 28, CAB_H - 32, 9);
  const cloth = g.createLinearGradient(0, 16, 0, CAB_H - 16);
  cloth.addColorStop(0, '#34303f'); cloth.addColorStop(1, '#201d2a');
  g.fillStyle = cloth; g.fill();
  g.save();
  g.clip();
  g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1;
  for (let i = -CAB_H; i < CAB_W + CAB_H; i += 6) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + CAB_H, CAB_H); g.stroke();
    g.beginPath(); g.moveTo(i + CAB_H, 0); g.lineTo(i, CAB_H); g.stroke();
  }
  g.restore();
  roundRect(g, 14, 16, CAB_W - 28, CAB_H - 32, 9);
  g.strokeStyle = '#d9c48a'; g.lineWidth = 1.6; g.stroke();
  // The recesses: a dark well with a lit lower lip.
  for (const p of CAB_CONES) {
    const well = g.createRadialGradient(p.x, p.y - 6, CAB_CONE_R * 0.4, p.x, p.y, CAB_CONE_R + 5);
    well.addColorStop(0, '#07060b'); well.addColorStop(0.85, '#0c0a12'); well.addColorStop(1, '#3b374a');
    g.fillStyle = well;
    g.beginPath(); g.arc(p.x, p.y, CAB_CONE_R + 5, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

/** The amp head on top of the stack: the box, a brushed metal face plate, a row of knobs and a red jewel lamp. */
function paintAmp(): HTMLCanvasElement | null {
  const k = canvas(AMP_W, AMP_H); if (!k) return null;
  const g = k.g;
  paintBox(g, AMP_W, AMP_H);
  roundRect(g, 18, 26, AMP_W - 36, 30, 5);
  const plate = g.createLinearGradient(0, 26, 0, 56);
  plate.addColorStop(0, '#f1dfa6'); plate.addColorStop(0.45, '#c9a95a'); plate.addColorStop(1, '#8a6d2c');
  g.fillStyle = plate; g.fill();
  g.strokeStyle = '#0b0912'; g.lineWidth = 2; g.stroke();
  for (let i = 0; i < 5; i++) {
    const x = 44 + i * 27, y = 41;
    const kn = g.createRadialGradient(x - 3, y - 3, 1, x, y, 9);
    kn.addColorStop(0, '#6c687c'); kn.addColorStop(1, '#15131c');
    g.fillStyle = kn; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#f6f2e4'; g.lineWidth = 2;
    const a = -2.2 + i * 0.75;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7); g.stroke();
  }
  // The lamp: lit.
  const lx = AMP_W - 40, ly = 41;
  const halo = g.createRadialGradient(lx, ly, 1, lx, ly, 16);
  halo.addColorStop(0, 'rgba(255,120,90,0.9)'); halo.addColorStop(1, 'rgba(255,60,40,0)');
  g.fillStyle = halo; g.beginPath(); g.arc(lx, ly, 16, 0, Math.PI * 2); g.fill();
  const lamp = g.createRadialGradient(lx - 2, ly - 2, 0.5, lx, ly, 7);
  lamp.addColorStop(0, '#fff3ea'); lamp.addColorStop(0.4, '#ff6a4a'); lamp.addColorStop(1, '#8e1d12');
  g.fillStyle = lamp; g.beginPath(); g.arc(lx, ly, 7, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** One speaker cone, face on: a rubber surround, ribbed paper falling away to the middle, a glossy dust cap. */
function paintCone(): HTMLCanvasElement | null {
  const D = CONE_D;
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  // The steel basket rim and its screws.
  const rim = g.createLinearGradient(0, 0, D, D);
  rim.addColorStop(0, '#c9cedb'); rim.addColorStop(0.5, '#6f7486'); rim.addColorStop(1, '#3a3d4b');
  g.fillStyle = rim; g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#0b0912'; g.lineWidth = 2.5; g.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.26;
    g.fillStyle = '#1a1822'; g.beginPath(); g.arc(c + Math.cos(a) * (c - 7.5), c + Math.sin(a) * (c - 7.5), 2.4, 0, Math.PI * 2); g.fill();
  }
  // The rubber surround: a rolled ring, lit on its upper left.
  const sur = g.createRadialGradient(c - 10, c - 12, c * 0.55, c, c, c - 11);
  sur.addColorStop(0, '#4f4b5e'); sur.addColorStop(0.8, '#24212d'); sur.addColorStop(1, '#0e0c14');
  g.fillStyle = sur; g.beginPath(); g.arc(c, c, c - 12, 0, Math.PI * 2); g.fill();
  // The paper cone: darker toward the middle (it falls away), with faint ribs.
  const paper = g.createRadialGradient(c, c, c * 0.2, c, c, c - 21);
  paper.addColorStop(0, '#16141d'); paper.addColorStop(0.55, '#2b2836'); paper.addColorStop(1, '#4b4759');
  g.fillStyle = paper; g.beginPath(); g.arc(c, c, c - 21, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 1.2;
  for (const r of [c - 27, c - 33, c - 39]) { g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); }
  // A sweep of light across the upper left of the paper.
  g.save();
  g.beginPath(); g.arc(c, c, c - 21, 0, Math.PI * 2); g.clip();
  const sheen = g.createLinearGradient(c - 40, c - 44, c + 10, c + 6);
  sheen.addColorStop(0, 'rgba(255,255,255,0.3)'); sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen; g.fillRect(0, 0, D, D);
  g.restore();
  // The dust cap: a glossy dome.
  const cap = g.createRadialGradient(c - 7, c - 8, 1.5, c, c, c * 0.34);
  cap.addColorStop(0, '#eceaf4'); cap.addColorStop(0.3, '#7f7b90'); cap.addColorStop(1, '#1f1c29');
  g.fillStyle = cap; g.beginPath(); g.arc(c, c, c * 0.33, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(8,6,14,0.8)'; g.lineWidth = 1.5; g.stroke();
  return k.c;
}

// ── the bass wave ────────────────────────────────────────────────────────────────────────────────────────────

export const WAVE_W = 176, WAVE_H = 512;
/** The radius (texture px) of the circle the crescent is a slice of: a sprite at scale `s` draws a front `WAVE_R x s` out. */
export const WAVE_R = 380;
const WAVE_CX = -232;
/** A wave sprite's x anchor: the circle's centre, far to the left of the texture. Its y anchor is 0.5. */
export const WAVE_ANCHOR_X = WAVE_CX / WAVE_W;

/** The crescent: a bright leading edge, a soft wake behind it, both fading toward the tips. */
function paintWave(): HTMLCanvasElement | null {
  const k = canvas(WAVE_W, WAVE_H); if (!k) return null;
  const g = k.g;
  const cy = WAVE_H / 2;
  const half = Math.asin((WAVE_H / 2 - 10) / WAVE_R);
  g.lineCap = 'butt';
  // The wake: wide and faint, trailing behind the front.
  g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 58;
  g.beginPath(); g.arc(WAVE_CX, cy, WAVE_R - 34, -half, half); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 30;
  g.beginPath(); g.arc(WAVE_CX, cy, WAVE_R - 18, -half, half); g.stroke();
  // The front: a crisp bright rim with a soft bloom.
  g.save();
  g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 12;
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 9;
  g.beginPath(); g.arc(WAVE_CX, cy, WAVE_R - 6, -half, half); g.stroke();
  g.restore();
  // Fade toward both tips.
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, 0, WAVE_H);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(0.3, 'rgba(0,0,0,1)'); fade.addColorStop(0.7, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
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
  const cab = paintCab(), amp = paintAmp(), cone = paintCone(), wave = paintWave();
  if (!base || !lineGlow || !lineCore || !note || !beam || !cab || !amp || !cone || !wave) return null;
  cached = {
    ...base, lineGlow: tex(lineGlow), lineCore: tex(lineCore), note: tex(note), pair: tex(beam),
    cab: tex(cab), amp: tex(amp), cone: tex(cone), wave: tex(wave),
  };
  return cached;
}
