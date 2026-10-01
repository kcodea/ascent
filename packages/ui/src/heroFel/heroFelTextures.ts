/**
 * The Eye of the Legion's textures, painted ONCE per session on 2D canvases and kept. Painted in VALUES (white to grey,
 * with soft alpha) so every layer tints them, and layered like a hand-painted eye:
 *  - SCLERA: the almond, shaded like a ball (a bright middle, darker toward the corners, a shadow under the upper lid);
 *  - VEINS: thin, forking, wavering veins creeping in from the corners (tinted blood red over the sclera);
 *  - IRIS: a disc with radial fibres, a darker limbal ring at its edge and a lighter collar round the pupil;
 *  - PUPIL: a soft-edged vertical ellipse (squeezed in x to a slit);
 *  - LID / LID GLOW: the almond's rim as a thick band (the dark lids) and a soft band just inside it (the fel inner
 *    glow). Scaled in y with the lids, they shrink to a glowing SEAM when the eye is shut;
 *  - RIFT / RIFT RIM: a ragged tear round the eye (its dark inside, its glowing torn edge);
 *  - GAZE: a beam's cross-section (soft across, uniform along);
 *  - STARBURST: twelve tapered rays (the implosion's release); VEIL: a vignette (clear in the middle, dark at the edges);
 *  - CRACKLE and SHARD: a fork of fel lightning, a sharp sliver.
 * Scatter is seeded, so every session paints the same eye.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { seededRng, type Pt } from '../heroAttack/easing';
import { heroFireTextures } from '../heroFire/heroFireTextures';
import { almondPoints, EYE_HH, EYE_HW } from './heroFelConfig';
import type { HeroFelTextures } from './heroFelScene';

/** Texture sizes (px) the scene's sprite scales divide by. */
export const EYE_W = 2 * EYE_HW + 16;
export const EYE_H = 2 * EYE_HH + 16;
export const IRIS_PX = 128;
export const PUPIL_W = 32;
export const PUPIL_H = 96;
export const RIFT_W = 400;
export const RIFT_H = 240;
export const GAZE_W = 64;
export const GAZE_H = 32;
export const BURST_PX = 256;
export const VEIL_PX = 256;
export const CRACKLE_W = 128;
export const CRACKLE_H = 48;
export const SHARD_W = 72;
export const SHARD_H = 16;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  let g: CanvasRenderingContext2D | null = null;
  try { g = c.getContext('2d'); } catch { g = null; }
  return g ? { c, g } : null;
}

function almondPath(g: CanvasRenderingContext2D, cx: number, cy: number, sx = 1, sy = 1): void {
  const pts = almondPoints();
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(cx + p.x * sx, cy + p.y * sy) : g.moveTo(cx + p.x * sx, cy + p.y * sy)));
  g.closePath();
}

function paintSclera(): HTMLCanvasElement | null {
  const k = canvas(EYE_W, EYE_H); if (!k) return null;
  const { g } = k;
  const cx = EYE_W / 2, cy = EYE_H / 2;
  almondPath(g, cx, cy);
  g.save();
  g.clip();
  // A ball: bright in the middle, falling to grey at the corners.
  const ball = g.createRadialGradient(cx, cy + 6, 4, cx, cy, EYE_HW);
  ball.addColorStop(0, '#ffffff'); ball.addColorStop(0.4, '#e6e6e6'); ball.addColorStop(0.75, '#8e8e8e'); ball.addColorStop(1, '#4a4a4a');
  g.fillStyle = ball; g.fillRect(0, 0, EYE_W, EYE_H);
  // The upper lid's shadow on the ball.
  const sh = g.createLinearGradient(0, cy - EYE_HH, 0, cy - EYE_HH * 0.2);
  sh.addColorStop(0, 'rgba(0,0,0,0.55)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh; g.fillRect(0, 0, EYE_W, EYE_H);
  g.restore();
  return k.c;
}

function paintVeins(): HTMLCanvasElement | null {
  const k = canvas(EYE_W, EYE_H); if (!k) return null;
  const { g } = k;
  const cx = EYE_W / 2, cy = EYE_H / 2;
  const rnd = seededRng(3301);
  almondPath(g, cx, cy);
  g.save();
  g.clip();
  g.strokeStyle = '#fff'; g.lineCap = 'round';
  const vein = (x: number, y: number, ang: number, len: number, w: number, depth: number): void => {
    let px = x, py = y, a = ang;
    g.lineWidth = w;
    g.beginPath(); g.moveTo(px, py);
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      a += (rnd() - 0.5) * 0.7;
      px += Math.cos(a) * (len / steps); py += Math.sin(a) * (len / steps);
      g.lineTo(px, py);
      if (depth > 0 && rnd() < 0.35) { g.stroke(); vein(px, py, a + (rnd() < 0.5 ? -0.7 : 0.7), len * 0.45, w * 0.6, depth - 1); g.lineWidth = w; g.beginPath(); g.moveTo(px, py); }
    }
    g.stroke();
  };
  // From the two corners inward, and a few off the lids.
  for (let i = 0; i < 6; i++) vein(cx - EYE_HW + 4, cy + (rnd() - 0.5) * 20, (rnd() - 0.5) * 0.9, 50 + rnd() * 30, 2.2, 2);
  for (let i = 0; i < 6; i++) vein(cx + EYE_HW - 4, cy + (rnd() - 0.5) * 20, Math.PI + (rnd() - 0.5) * 0.9, 50 + rnd() * 30, 2.2, 2);
  for (let i = 0; i < 5; i++) {
    const x = cx + (rnd() - 0.5) * EYE_HW * 1.4;
    vein(x, cy + EYE_HH * 0.85, -Math.PI / 2 + (rnd() - 0.5) * 0.8, 22 + rnd() * 16, 1.4, 1);
  }
  g.restore();
  return k.c;
}

function paintIris(): HTMLCanvasElement | null {
  const k = canvas(IRIS_PX, IRIS_PX); if (!k) return null;
  const { g } = k;
  const m = IRIS_PX / 2, R = m - 2;
  const rnd = seededRng(5521);
  const base = g.createRadialGradient(m, m, 0, m, m, R);
  base.addColorStop(0, '#ffffff'); base.addColorStop(0.3, '#f4f4f4'); base.addColorStop(0.72, '#bdbdbd'); base.addColorStop(0.9, '#6e6e6e'); base.addColorStop(1, '#2a2a2a');
  g.fillStyle = base;
  g.beginPath(); g.arc(m, m, R, 0, Math.PI * 2); g.fill();
  // Radial fibres: light and dark strokes from the collar to the limbal ring.
  g.save();
  g.beginPath(); g.arc(m, m, R, 0, Math.PI * 2); g.clip();
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2;
    const r0 = R * (0.22 + rnd() * 0.12), r1 = R * (0.7 + rnd() * 0.28);
    const light = rnd() < 0.55;
    g.strokeStyle = light ? `rgba(255,255,255,${0.25 + rnd() * 0.35})` : `rgba(0,0,0,${0.15 + rnd() * 0.25})`;
    g.lineWidth = 0.8 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(m + Math.cos(a) * r0, m + Math.sin(a) * r0);
    const bend = (rnd() - 0.5) * 0.18;
    g.quadraticCurveTo(m + Math.cos(a + bend) * (r0 + r1) / 2, m + Math.sin(a + bend) * (r0 + r1) / 2, m + Math.cos(a) * r1, m + Math.sin(a) * r1);
    g.stroke();
  }
  g.restore();
  // The limbal ring: a crisp dark edge.
  g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = 4;
  g.beginPath(); g.arc(m, m, R - 2, 0, Math.PI * 2); g.stroke();
  return k.c;
}

function paintPupil(): HTMLCanvasElement | null {
  const k = canvas(PUPIL_W, PUPIL_H); if (!k) return null;
  const { g } = k;
  g.save();
  g.translate(PUPIL_W / 2, PUPIL_H / 2);
  g.scale(1, PUPIL_H / PUPIL_W);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, PUPIL_W / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.78, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(0, 0, PUPIL_W / 2, 0, Math.PI * 2); g.fill();
  g.restore();
  return k.c;
}

/** The lid band (thick, along the almond edge) or the inner glow (soft, just inside it). */
function paintLid(glow: boolean): HTMLCanvasElement | null {
  const k = canvas(EYE_W, EYE_H); if (!k) return null;
  const { g } = k;
  const cx = EYE_W / 2, cy = EYE_H / 2;
  g.lineJoin = 'round';
  if (glow) {
    // A smooth band just inside the rim: the almond filled, its inside cut away through a blur.
    almondPath(g, cx, cy);
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill();
    g.globalCompositeOperation = 'destination-out';
    g.filter = 'blur(7px)';
    almondPath(g, cx, cy, 0.93, 0.74);
    g.fillStyle = '#000'; g.fill();
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';
  } else {
    almondPath(g, cx, cy, 1.02, 1.06);
    g.strokeStyle = '#fff'; g.lineWidth = 16; g.stroke();
    almondPath(g, cx, cy, 1.05, 1.12);
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 6; g.stroke();
  }
  return k.c;
}

/** A ragged tear: its outline (shared by the dark inside and the rim). */
function riftOutline(): Pt[] {
  const rnd = seededRng(9091);
  const pts: Pt[] = [];
  const n = 40;
  const hw = RIFT_W / 2 - 10, hh = 86;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // A torn almond: pointed, ragged ends (the tear runs on past the eye) and an irregular, notched edge.
    const end = Math.pow(Math.abs(Math.cos(a)), 6);
    const almond = Math.pow(Math.abs(Math.sin(a)), 0.75);
    let r = 0.86 + rnd() * 0.12;
    if (i % 5 === 2) r *= 0.82 + rnd() * 0.06;
    if (i % 7 === 4) r *= 1.08;
    pts.push({ x: Math.cos(a) * hw * (0.88 + 0.12 * end) * r, y: Math.sin(a) * hh * almond * r });
  }
  return pts;
}

function paintRift(rim: boolean): HTMLCanvasElement | null {
  const k = canvas(RIFT_W, RIFT_H); if (!k) return null;
  const { g } = k;
  const cx = RIFT_W / 2, cy = RIFT_H / 2;
  const pts = riftOutline();
  const path = (): void => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(cx + p.x, cy + p.y) : g.moveTo(cx + p.x, cy + p.y))); g.closePath(); };
  if (rim) {
    g.lineJoin = 'miter';
    path(); g.shadowColor = '#fff'; g.shadowBlur = 8; g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 4; g.stroke();
    g.shadowBlur = 0; path(); g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.stroke();
  } else {
    path();
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, RIFT_W / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.8, 'rgba(255,255,255,0.96)'); gr.addColorStop(1, 'rgba(255,255,255,0.85)');
    g.fillStyle = gr; g.fill();
  }
  return k.c;
}

function paintGaze(): HTMLCanvasElement | null {
  const k = canvas(GAZE_W, GAZE_H); if (!k) return null;
  const { g } = k;
  const gr = g.createLinearGradient(0, 0, 0, GAZE_H);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.45)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, GAZE_W, GAZE_H);
  return k.c;
}

function paintBurst(): HTMLCanvasElement | null {
  const k = canvas(BURST_PX, BURST_PX); if (!k) return null;
  const { g } = k;
  const m = BURST_PX / 2;
  const rnd = seededRng(1213);
  g.shadowColor = '#fff'; g.shadowBlur = 8;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
    const len = m * (i % 2 === 0 ? 0.96 : 0.62) * (0.85 + rnd() * 0.15);
    const w = i % 2 === 0 ? 0.11 : 0.08;
    const gr = g.createLinearGradient(m, m, m + Math.cos(a) * len, m + Math.sin(a) * len);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(m + Math.cos(a - w) * 10, m + Math.sin(a - w) * 10);
    g.lineTo(m + Math.cos(a) * len, m + Math.sin(a) * len);
    g.lineTo(m + Math.cos(a + w) * 10, m + Math.sin(a + w) * 10);
    g.closePath(); g.fill();
  }
  const core = g.createRadialGradient(m, m, 0, m, m, 26);
  core.addColorStop(0, 'rgba(255,255,255,1)'); core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core; g.fillRect(m - 26, m - 26, 52, 52);
  return k.c;
}

function paintVeil(): HTMLCanvasElement | null {
  const k = canvas(VEIL_PX, VEIL_PX); if (!k) return null;
  const { g } = k;
  const m = VEIL_PX / 2;
  const gr = g.createRadialGradient(m, m, m * 0.25, m, m, m);
  gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = gr; g.fillRect(0, 0, VEIL_PX, VEIL_PX);
  return k.c;
}

function paintCrackle(): HTMLCanvasElement | null {
  const k = canvas(CRACKLE_W, CRACKLE_H); if (!k) return null;
  const { g } = k;
  const rnd = seededRng(4421);
  const mid = CRACKLE_H / 2;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 9; i++) pts.push([4 + ((CRACKLE_W - 8) * i) / 9, mid + (rnd() - 0.5) * CRACKLE_H * 0.7 * Math.sin((i / 9) * Math.PI)]);
  const line = (): void => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); };
  g.lineJoin = 'round'; g.lineCap = 'round';
  line(); g.shadowColor = '#fff'; g.shadowBlur = 8; g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 6; g.stroke();
  g.shadowBlur = 0; line(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
  return k.c;
}

function paintShard(): HTMLCanvasElement | null {
  const k = canvas(SHARD_W, SHARD_H); if (!k) return null;
  const { g } = k;
  const grad = g.createLinearGradient(SHARD_W, 0, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.85)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(SHARD_W, SHARD_H / 2); g.lineTo(SHARD_W * 0.68, 2); g.lineTo(0, SHARD_H / 2); g.lineTo(SHARD_W * 0.68, SHARD_H - 2);
  g.closePath(); g.fill();
  return k.c;
}

let cached: HeroFelTextures | null | undefined;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroFelTextures(): HeroFelTextures | null {
  if (cached) return cached;
  const base = heroFireTextures();
  const parts = {
    sclera: paintSclera(), veins: paintVeins(), iris: paintIris(), pupil: paintPupil(), lid: paintLid(false), lidGlow: paintLid(true),
    rift: paintRift(false), riftRim: paintRift(true), gaze: paintGaze(), burst: paintBurst(), veil: paintVeil(),
    crackle: paintCrackle(), shard: paintShard(),
  };
  if (!base || Object.values(parts).some((p) => !p)) return null;
  const tex = (c: HTMLCanvasElement | null): Texture => new Texture({ source: new CanvasSource({ resource: c! }) });
  cached = {
    ...base,
    sclera: tex(parts.sclera), veins: tex(parts.veins), iris: tex(parts.iris), pupil: tex(parts.pupil), lid: tex(parts.lid),
    lidGlow: tex(parts.lidGlow), rift: tex(parts.rift), riftRim: tex(parts.riftRim), gaze: tex(parts.gaze), burst: tex(parts.burst),
    veil: tex(parts.veil), crackle: tex(parts.crackle), shard: tex(parts.shard),
  };
  return cached;
}
