/**
 * The Boomerang's textures, painted ONCE per session on 2D canvases and kept (a few small squares on top of the shared
 * Blast / Arcana set it reuses for glows, rings, stars and the ribbon). Greys, so every sprite tints them:
 *  - BODY: a classic carved boomerang (two broad arms meeting at a rounded elbow), shaded top-lit with a few wood-grain
 *    lines following the arms, and a dark outline so it holds on a bright board. Centred on its middle, so it spins
 *    about it.
 *  - INLAY: the carved bands (chevrons across each arm near the elbow and a dot at each tip), tinted teal.
 *  - WHIRL: a faint smeared annulus the size of its sweep (the spin's motion blur).
 *  - CHIP: a splinter sliver (the thwack's wood chips).
 *  - BURST: a crisp comic impact star (the THWACK).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroBoomerangTextures } from './heroBoomerangScene';

export const BOOM_D = 128;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

const C = BOOM_D / 2;

/** The boomerang's outline: a wide chevron, elbow up, arms sweeping down and out, rounded tips (centred on the box). */
function boomPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  // Outer edge: left tip, up over the elbow, down to the right tip.
  g.moveTo(C - 54, C + 26);
  g.quadraticCurveTo(C - 48, C - 30, C, C - 30);
  g.quadraticCurveTo(C + 48, C - 30, C + 54, C + 26);
  // The right tip, rounded.
  g.quadraticCurveTo(C + 55, C + 38, C + 42, C + 34);
  // Inner edge back to the left tip (a deeper curve: the arms are broad at the elbow, slimmer at the tips).
  g.quadraticCurveTo(C + 30, C - 8, C, C - 8);
  g.quadraticCurveTo(C - 30, C - 8, C - 42, C + 34);
  g.quadraticCurveTo(C - 55, C + 38, C - 54, C + 26);
  g.closePath();
}

function paintBody(): HTMLCanvasElement | null {
  const k = canvas(BOOM_D, BOOM_D); if (!k) return null;
  const g = k.g;
  const shade = g.createLinearGradient(0, C - 30, 0, C + 36);
  shade.addColorStop(0, 'rgb(255,255,255)'); shade.addColorStop(0.5, 'rgb(215,215,215)'); shade.addColorStop(1, 'rgb(140,140,140)');
  g.fillStyle = shade; boomPath(g); g.fill();
  // Wood grain: thin darker lines following each arm.
  g.save(); boomPath(g); g.clip();
  g.strokeStyle = 'rgba(95,95,95,0.45)'; g.lineWidth = 1.1;
  for (let i = 0; i < 4; i++) {
    const o = -22 + i * 5;
    g.beginPath(); g.moveTo(C - 50, C + 28 + i * 1.5); g.quadraticCurveTo(C - 40, C + o, C, C + o - 1); g.quadraticCurveTo(C + 40, C + o, C + 50, C + 28 + i * 1.5); g.stroke();
  }
  // A lit top edge (a carved bevel).
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(C - 50, C + 20); g.quadraticCurveTo(C - 45, C - 26, C, C - 27); g.quadraticCurveTo(C + 45, C - 26, C + 50, C + 20); g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(55,55,55,0.95)'; g.lineWidth = 2; boomPath(g); g.stroke();
  return k.c;
}

function paintInlay(): HTMLCanvasElement | null {
  const k = canvas(BOOM_D, BOOM_D); if (!k) return null;
  const g = k.g;
  g.save(); boomPath(g); g.clip();
  g.strokeStyle = '#fff'; g.lineCap = 'round';
  // Chevron bands across each arm near the elbow.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const x = C + sx * (12 + i * 7);
      g.lineWidth = 2.6 - i * 0.4;
      g.beginPath(); g.moveTo(x - sx * 4, C - 30); g.lineTo(x + sx * 3, C - 6); g.stroke();
    }
  }
  g.restore();
  // A dot at each tip, and one at the elbow.
  g.fillStyle = '#fff';
  for (const [x, y, r] of [[C - 45, C + 27, 3.2], [C + 45, C + 27, 3.2], [C, C - 19, 3]] as const) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  return k.c;
}

function paintWhirl(): HTMLCanvasElement | null {
  const k = canvas(BOOM_D, BOOM_D); if (!k) return null;
  const g = k.g;
  // A smeared ring: a few thin arcs of falling opacity (the arms' sweep), not a solid disc.
  for (let i = 0; i < 3; i++) {
    const a0 = i * ((Math.PI * 2) / 3);
    for (let j = 0; j < 12; j++) {
      g.strokeStyle = `rgba(255,255,255,${(0.5 * (1 - j / 12)).toFixed(3)})`;
      g.lineWidth = 9;
      g.beginPath(); g.arc(C, C, 50, a0 - j * 0.12, a0 - (j + 1) * 0.12, true); g.stroke();
    }
  }
  return k.c;
}

function paintChip(): HTMLCanvasElement | null {
  const k = canvas(32, 12); if (!k) return null;
  const g = k.g;
  g.fillStyle = 'rgb(230,230,230)';
  g.beginPath(); g.moveTo(1, 6); g.lineTo(12, 2); g.lineTo(31, 5); g.lineTo(14, 10); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(80,80,80,0.8)'; g.lineWidth = 1; g.stroke();
  return k.c;
}

function paintBurst(): HTMLCanvasElement | null {
  const k = canvas(BOOM_D, BOOM_D); if (!k) return null;
  const g = k.g;
  const pts = 11;
  g.beginPath();
  for (let i = 0; i < pts * 2; i++) {
    const a = (i / (pts * 2)) * Math.PI * 2 + 0.2;
    const r = i % 2 ? 22 + (i % 3) * 3 : 56 - (i % 4) * 5;
    const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = '#fff'; g.fill();
  return k.c;
}

let cached: HeroBoomerangTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroBoomerangTextures(): HeroBoomerangTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const body = paintBody(), inlay = paintInlay(), whirl = paintWhirl(), chip = paintChip(), burst = paintBurst();
  if (!base || !body || !inlay || !whirl || !chip || !burst) return null;
  cached = { ...base, boomBody: tex(body), boomInlay: tex(inlay), boomWhirl: tex(whirl), chip: tex(chip), burst: tex(burst) };
  return cached;
}
