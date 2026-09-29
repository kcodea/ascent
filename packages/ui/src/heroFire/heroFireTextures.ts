/**
 * The Fire attack's textures, painted ONCE per session on 2D canvases and kept. It shares the Blast's and Arcana's set
 * (the glow, the spark, the ring, the glitter star) and the shared live fire's (`../heroAttack/pixiFire.ts`: the flame
 * puffs, the tongue, the smoke, the ember, the fire glow), and paints two of its own: the SCORCH the meteor leaves
 * round the struck hero (a dark, ragged burn ring, clear in the middle so the portrait sits in it) and a THIN shock
 * ring (a crisp line that stays a line however far it is scaled, never a thick band). White or grey,
 * so every sprite tints it. Scatter is seeded, so every session paints the same burn.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { seededRng } from '../heroAttack/easing';
import { pixiFireTextures } from '../heroAttack/pixiFire';
import type { HeroFireTextures } from './heroFireScene';

/** The scorch texture's size (px): its burn band sits between 0.3 and 0.5 of it (radius). */
export const SCORCH_PX = 256;
/** The shock ring texture's size (px) and the radius its thin line sits at (so it stays a line when scaled up). */
export const SHOCK_PX = 256;
export const SHOCK_LINE_R = 115;

function paintShock(D: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = D; c.height = D;
  let g: CanvasRenderingContext2D | null = null;
  try { g = c.getContext('2d'); } catch { g = null; }
  if (!g) return null;
  // A soft halo just inside the line (the heat behind the front), then the crisp thin line itself.
  const halo = g.createRadialGradient(D / 2, D / 2, SHOCK_LINE_R * 0.7, D / 2, D / 2, SHOCK_LINE_R);
  halo.addColorStop(0, 'rgba(255,255,255,0)'); halo.addColorStop(1, 'rgba(255,255,255,0.28)');
  g.fillStyle = halo;
  g.beginPath(); g.arc(D / 2, D / 2, SHOCK_LINE_R, 0, Math.PI * 2); g.fill();
  g.shadowColor = '#fff'; g.shadowBlur = 5;
  g.strokeStyle = '#fff'; g.lineWidth = 3;
  g.beginPath(); g.arc(D / 2, D / 2, SHOCK_LINE_R, 0, Math.PI * 2); g.stroke();
  return c;
}

function paintScorch(D: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = D; c.height = D;
  let g: CanvasRenderingContext2D | null = null;
  try { g = c.getContext('2d'); } catch { g = null; }
  if (!g) return null;
  const rnd = seededRng(6607);
  const m = D / 2;
  // Ragged blotches round a ring (the burn), a soft band under them, clear in the middle.
  const band = g.createRadialGradient(m, m, D * 0.18, m, m, D * 0.5);
  band.addColorStop(0, 'rgba(255,255,255,0)'); band.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  band.addColorStop(0.7, 'rgba(255,255,255,0.3)'); band.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = band; g.fillRect(0, 0, D, D);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, r = D * (0.3 + rnd() * 0.14);
    const x = m + Math.cos(a) * r, y = m + Math.sin(a) * r, rr = D * (0.04 + rnd() * 0.07);
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  return c;
}

let cached: HeroFireTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroFireTextures(): HeroFireTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const fire = pixiFireTextures();
  const scorch = paintScorch(SCORCH_PX), shock = paintShock(SHOCK_PX);
  if (!base || !fire || !scorch || !shock) return null;
  const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });
  cached = { ...base, fire, scorch: tex(scorch), shock: tex(shock) };
  return cached;
}
