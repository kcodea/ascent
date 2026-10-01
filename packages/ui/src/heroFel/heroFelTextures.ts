/**
 * The Fel attack's textures, painted ONCE per session on 2D canvases and kept. It shares the Fire attack's set (the
 * glow, the spark, the ring, the star, the live fire's puffs / tongue / smoke / ember / glow, the scorch and the thin
 * shock ring) and paints four of its own, all white or grey so every sprite tints them:
 *  - the RUNE CIRCLE: a fel summoning circle (a double outer ring, a band of jagged runes, a hexagram, spikes, an inner
 *    ring), its lines thick and chunky with a soft glow round each so it reads as hand-painted light at game size;
 *  - the CRACKLE: a jagged fork of chaos lightning (a crisp core line in a soft halo), flashed round a bolt's shell;
 *  - the SHELL: a ragged, spiky annulus, clear in the middle, tinted dark: the dark crackling rim round a bolt's bright
 *    heart (the Blizzard read: a bright core, a darker rim);
 *  - the SHARD: a long sharp sliver, thrown out of an impact.
 * Scatter is seeded, so every session paints the same runes.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { seededRng } from '../heroAttack/easing';
import { heroFireTextures } from '../heroFire/heroFireTextures';
import type { HeroFelTextures } from './heroFelScene';

/** Texture sizes (px) the scene's sprite scales divide by. */
export const RUNE_PX = 256;
/** The rune circle's outer ring radius in its texture. */
export const RUNE_R = 120;
export const CRACKLE_W = 128;
export const CRACKLE_H = 48;
export const SHELL_PX = 128;
/** The shell's ring sits at about this radius of its texture. */
export const SHELL_R = 52;
/** The shard lies along +x (its tip at the right), so a sprite aligned to its velocity flies tip first. */
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

/** Stroke a path twice: a wide soft glow, then the crisp line (a painted, glowing line, not a hairline). */
function glowStroke(g: CanvasRenderingContext2D, draw: () => void, width: number, glow: number): void {
  g.save();
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.lineWidth = width + glow;
  g.shadowColor = '#fff'; g.shadowBlur = glow;
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); draw(); g.stroke();
  g.restore();
  g.save();
  g.strokeStyle = '#fff';
  g.lineWidth = width;
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath(); draw(); g.stroke();
  g.restore();
}

function paintRune(): HTMLCanvasElement | null {
  const k = canvas(RUNE_PX, RUNE_PX); if (!k) return null;
  const { g } = k;
  const m = RUNE_PX / 2;
  const rnd = seededRng(6661);
  // A faint luminous body inside the circle (the circle reads as a disc of light, not just lines).
  const body = g.createRadialGradient(m, m, 0, m, m, RUNE_R);
  body.addColorStop(0, 'rgba(255,255,255,0.10)'); body.addColorStop(0.7, 'rgba(255,255,255,0.05)'); body.addColorStop(1, 'rgba(255,255,255,0.16)');
  g.fillStyle = body;
  g.beginPath(); g.arc(m, m, RUNE_R, 0, Math.PI * 2); g.fill();
  const circle = (r: number): (() => void) => () => { g.moveTo(m + r, m); g.arc(m, m, r, 0, Math.PI * 2); };
  glowStroke(g, circle(RUNE_R - 3), 5, 10);
  glowStroke(g, circle(RUNE_R - 22), 2.5, 6);
  // The rune band: 14 jagged glyphs between the two outer rings.
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r0 = RUNE_R - 19, r1 = RUNE_R - 7;
    const pt = (r: number, da: number): [number, number] => [m + Math.cos(a + da) * r, m + Math.sin(a + da) * r];
    const strokes: [number, number, number, number][] = [];
    const w = 0.07;
    // A spine, then one or two barbs (seeded): reads as an alien script.
    strokes.push([r0, 0, r1, 0]);
    const barbs = 1 + Math.floor(rnd() * 2);
    for (let b = 0; b < barbs; b++) {
      const rr = r0 + (r1 - r0) * (0.3 + rnd() * 0.5);
      const s = rnd() < 0.5 ? -1 : 1;
      strokes.push([rr, 0, rr + (rnd() - 0.3) * 6, s * w]);
    }
    if (rnd() < 0.5) strokes.push([r1, -w * 0.6, r1, w * 0.6]);
    glowStroke(g, () => {
      for (const [ra, da, rb, db] of strokes) { const p0 = pt(ra, da), p1 = pt(rb, db); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); }
    }, 2.5, 5);
  }
  // A hexagram inscribed in the inner ring (two triangles), and the inner ring itself.
  const ri = RUNE_R - 30;
  const tri = (rot: number): (() => void) => () => {
    for (let j = 0; j <= 3; j++) {
      const a = rot + (j / 3) * Math.PI * 2;
      const x = m + Math.cos(a) * ri, y = m + Math.sin(a) * ri;
      if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
  };
  glowStroke(g, tri(-Math.PI / 2), 3, 7);
  glowStroke(g, tri(Math.PI / 2), 3, 7);
  glowStroke(g, circle(ri), 3, 7);
  // Spikes out of the hexagram's points to the rune band.
  glowStroke(g, () => {
    for (let j = 0; j < 6; j++) {
      const a = -Math.PI / 2 + (j / 6) * Math.PI * 2;
      g.moveTo(m + Math.cos(a) * ri, m + Math.sin(a) * ri);
      g.lineTo(m + Math.cos(a) * (RUNE_R - 22), m + Math.sin(a) * (RUNE_R - 22));
    }
  }, 2, 5);
  glowStroke(g, circle(26), 3, 8);
  // A hot eye in the middle.
  const eye = g.createRadialGradient(m, m, 0, m, m, 22);
  eye.addColorStop(0, 'rgba(255,255,255,0.7)'); eye.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = eye; g.fillRect(m - 22, m - 22, 44, 44);
  return k.c;
}

function paintCrackle(): HTMLCanvasElement | null {
  const k = canvas(CRACKLE_W, CRACKLE_H); if (!k) return null;
  const { g } = k;
  const rnd = seededRng(4421);
  const mid = CRACKLE_H / 2;
  const main: [number, number][] = [];
  const steps = 9;
  for (let i = 0; i <= steps; i++) {
    const x = 4 + ((CRACKLE_W - 8) * i) / steps;
    const env = Math.sin((i / steps) * Math.PI);
    main.push([x, mid + (rnd() - 0.5) * CRACKLE_H * 0.7 * env]);
  }
  const branch: [number, number][] = [main[4]!];
  for (let i = 1; i <= 3; i++) branch.push([main[4]![0] + i * 9, main[4]![1] + (rnd() < 0.5 ? -1 : 1) * i * 5 + (rnd() - 0.5) * 4]);
  const line = (pts: [number, number][]): (() => void) => () => { pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); };
  glowStroke(g, () => { line(main)(); line(branch)(); }, 2.2, 8);
  return k.c;
}

function paintShell(): HTMLCanvasElement | null {
  const k = canvas(SHELL_PX, SHELL_PX); if (!k) return null;
  const { g } = k;
  const rnd = seededRng(8123);
  const m = SHELL_PX / 2;
  // A ragged spiky outline (the shell's crackling edge), filled, then the middle cut out with a soft edge.
  const n = 22;
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const spike = i % 2 === 0 ? 1 : 0.8;
    const r = SHELL_R * (spike + (rnd() - 0.5) * 0.14) + 6 * (i % 2 === 0 ? rnd() : 0);
    const x = m + Math.cos(a) * r, y = m + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fill();
  g.globalCompositeOperation = 'destination-out';
  const hole = g.createRadialGradient(m, m, 0, m, m, SHELL_R * 0.86);
  hole.addColorStop(0, 'rgba(0,0,0,1)'); hole.addColorStop(0.62, 'rgba(0,0,0,0.92)'); hole.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hole;
  g.fillRect(0, 0, SHELL_PX, SHELL_PX);
  // A few cracks through the band (bright lines show through it as the core light).
  g.globalCompositeOperation = 'destination-out';
  g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const a = rnd() * Math.PI * 2;
    g.beginPath();
    g.moveTo(m + Math.cos(a) * SHELL_R * 0.7, m + Math.sin(a) * SHELL_R * 0.7);
    g.lineTo(m + Math.cos(a + 0.12) * SHELL_R * 0.9, m + Math.sin(a + 0.12) * SHELL_R * 0.9);
    g.lineTo(m + Math.cos(a + 0.05) * SHELL_R * 1.1, m + Math.sin(a + 0.05) * SHELL_R * 1.1);
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';
  return k.c;
}

function paintShard(): HTMLCanvasElement | null {
  const k = canvas(SHARD_W, SHARD_H); if (!k) return null;
  const { g } = k;
  const grad = g.createLinearGradient(SHARD_W, 0, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.5, 'rgba(255,255,255,0.85)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(SHARD_W, SHARD_H / 2);
  g.lineTo(SHARD_W * 0.68, 2);
  g.lineTo(0, SHARD_H / 2);
  g.lineTo(SHARD_W * 0.68, SHARD_H - 2);
  g.closePath();
  g.fill();
  return k.c;
}

let cached: HeroFelTextures | null | undefined;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroFelTextures(): HeroFelTextures | null {
  if (cached !== undefined) return cached;
  const base = heroFireTextures();
  const rune = paintRune(), crackle = paintCrackle(), shell = paintShell(), shard = paintShard();
  if (!base || !rune || !crackle || !shell || !shard) { cached = null; return null; }
  const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });
  cached = { ...base, rune: tex(rune), crackle: tex(crackle), shell: tex(shell), shard: tex(shard) };
  return cached;
}
