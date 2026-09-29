/**
 * The Bleed attack's textures, painted ONCE per session on 2D canvases and kept (about 420 KB of GPU memory on top of
 * the Blast's five and the Arcana strips, which it shares). Everything is white or grey, so every sprite tints it.
 *
 * Stylised, never gory: bold clean shapes the owner's Arcana bar asks for. The CRESCENT is the flying cut (a sharp
 * crescent with the bulge leading, tapering to needle tips); the SEAM is the white-hot line a cut draws (even along its
 * length, so it can be revealed by stretching); the GASH is the wound it leaves (a long lens, thick where the blade bit,
 * tapering to a fine tail, with a ragged edge) and the LIP its bright inner flesh; the DRIP is blood running down (a
 * thin run ending in a bead); the SPRAY a directional spatter fan; the splats are crisp splash stars.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { seededRng } from '../heroAttack/easing';
import type { HeroBleedTextures } from './heroBleedScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** The crescent box (square). Its leading edge (the bulge) is at x = CRESCENT_LEAD; the scene anchors there. */
export const CRESCENT_PX = 192;
export const CRESCENT_LEAD = 166;
/** The seam: an even line SEAM_W long. The gash box is the same length, so a cut and its wound line up. */
export const SEAM_W = 256;
export const SEAM_H = 32;
export const GASH_W = 256;
export const GASH_H = 48;
/** The drip: a run from the top edge to a bead at the bottom. The scene anchors it at the top. */
export const DRIP_W = 24;
export const DRIP_H = 96;

/** The crescent: an outer disc with an offset disc cut out, so it tapers to needle tips (bulge toward +X). */
function crescentPath(g: CanvasRenderingContext2D, grow = 0): void {
  const c = CRESCENT_PX / 2;
  g.beginPath(); g.arc(c - 16, c, 86 + grow, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(c - 44 - grow * 0.5, c, 84, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
}

function paintCrescent(): HTMLCanvasElement | null {
  const k = canvas(CRESCENT_PX, CRESCENT_PX); if (!k) return null;
  const g = k.g;
  // Shaded across the blade: bright along the leading edge, softer toward the inner curve (a tint keeps its form).
  const gr = g.createLinearGradient(CRESCENT_PX / 2, 0, CRESCENT_PX, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(235,235,235,0.9)'); gr.addColorStop(1, 'rgb(255,255,255)');
  g.fillStyle = gr;
  crescentPath(g);
  return k.c;
}

function paintCrescentGlow(): HTMLCanvasElement | null {
  const k = canvas(CRESCENT_PX, CRESCENT_PX); if (!k) return null;
  const g = k.g;
  g.shadowColor = '#fff'; g.shadowBlur = 16;
  g.fillStyle = 'rgba(255,255,255,0.75)';
  crescentPath(g, 4);
  return k.c;
}

/** The seam: even along X (a line), a hot narrow core across Y with a soft falloff; the first few px fade in. */
function paintSeam(soft: boolean): HTMLCanvasElement | null {
  const k = canvas(SEAM_W, SEAM_H); if (!k) return null;
  const g = k.g;
  const gr = g.createLinearGradient(0, 0, 0, SEAM_H);
  if (soft) {
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.38, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.5, 'rgb(255,255,255)');
    gr.addColorStop(0.62, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  }
  g.fillStyle = gr; g.fillRect(0, 0, SEAM_W, SEAM_H);
  g.globalCompositeOperation = 'destination-out';
  const fade = g.createLinearGradient(0, 0, 14, 0);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade; g.fillRect(0, 0, 14, SEAM_H);
  return k.c;
}

/**
 * The wound: a long lens, thickest at 35% (where the blade bit), tapering to a fine tail, with a ragged outline. `inner`
 * paints the lip: the same lens thinner and smoother (the bright flesh inside the dark edge).
 */
function paintGash(inner: boolean, seed: number): HTMLCanvasElement | null {
  const k = canvas(GASH_W, GASH_H); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(seed);
  const cy = GASH_H / 2;
  const half = (inner ? 0.42 : 1) * (GASH_H / 2 - 3);
  const n = 28;
  const top: [number, number][] = [], bot: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = 4 + u * (GASH_W - 8);
    // Thick where the blade bit, a long tail after: a skewed lens.
    const w = u < 0.35 ? Math.sin((u / 0.35) * Math.PI / 2) : Math.cos(((u - 0.35) / 0.65) * Math.PI / 2);
    const rag = inner ? 1 : 0.8 + 0.35 * rnd();
    top.push([x, cy - half * Math.pow(Math.max(0, w), 0.8) * rag]);
    bot.push([x, cy + half * Math.pow(Math.max(0, w), 0.8) * (inner ? 1 : 0.8 + 0.35 * rnd())]);
  }
  g.fillStyle = inner ? 'rgb(255,255,255)' : 'rgb(235,235,235)';
  g.beginPath();
  g.moveTo(top[0]![0], top[0]![1]);
  for (const [x, y] of top) g.lineTo(x, y);
  for (let i = bot.length - 1; i >= 0; i--) g.lineTo(bot[i]![0], bot[i]![1]);
  g.closePath(); g.fill();
  if (!inner) {
    // A few nicks off the edge (a torn cut, not a clean ellipse).
    for (let i = 0; i < 6; i++) {
      const u = 0.12 + rnd() * 0.6;
      const x = 4 + u * (GASH_W - 8);
      const up = rnd() < 0.5 ? -1 : 1;
      const w = u < 0.35 ? Math.sin((u / 0.35) * Math.PI / 2) : Math.cos(((u - 0.35) / 0.65) * Math.PI / 2);
      const y0 = cy + up * half * w * 0.8;
      g.beginPath(); g.moveTo(x - 3, y0); g.lineTo(x + 1 + rnd() * 4, y0 + up * (4 + rnd() * 5)); g.lineTo(x + 5, y0); g.closePath(); g.fill();
    }
  } else {
    // A highlight along the upper lip (wet), cut out so a tint shows two tones.
    g.globalCompositeOperation = 'destination-out';
    g.globalAlpha = 0.45;
    g.beginPath();
    g.moveTo(GASH_W * 0.12, cy + 1);
    g.quadraticCurveTo(GASH_W * 0.36, cy + half * 0.5, GASH_W * 0.75, cy + 1);
    g.lineTo(GASH_W * 0.75, cy + half); g.lineTo(GASH_W * 0.12, cy + half); g.closePath(); g.fill();
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  return k.c;
}

/** A drip: a thin run from the top that thickens into a round bead at the bottom, with a glint on the bead. */
function paintDrip(): HTMLCanvasElement | null {
  const k = canvas(DRIP_W, DRIP_H); if (!k) return null;
  const g = k.g;
  const c = DRIP_W / 2;
  const r = 7;
  const by = DRIP_H - r - 2;
  g.fillStyle = 'rgb(230,230,230)';
  g.beginPath();
  g.moveTo(c - 2, 0); g.lineTo(c + 2, 0);
  g.quadraticCurveTo(c + 2.5, by - r * 1.6, c + r, by);
  g.arc(c, by, r, 0, Math.PI);
  g.quadraticCurveTo(c - 2.5, by - r * 1.6, c - 2, 0);
  g.closePath(); g.fill();
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(c + 2.2, by - 2.4, 2, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** A droplet: a teardrop, +X aligned (round head on the right, tail tapering to a point on the left), with a glint. */
function paintDrop(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const r = H * 0.42, cx = W - r - 1, cy = H / 2;
  g.fillStyle = 'rgb(225,225,225)';
  g.beginPath();
  g.moveTo(1, cy);
  g.quadraticCurveTo(cx - r * 0.2, cy - r * 1.05, cx, cy - r);
  g.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2);
  g.quadraticCurveTo(cx - r * 0.2, cy + r * 1.05, 1, cy);
  g.closePath(); g.fill();
  g.fillStyle = 'rgb(255,255,255)';
  g.beginPath(); g.arc(cx + r * 0.25, cy - r * 0.35, r * 0.28, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** A blood splat: a crisp blob with long splash arms ending in beads, and satellites (seeded, irregular). */
function paintSplat(D: number, seed: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const rnd = seededRng(seed);
  g.fillStyle = '#fff';
  g.beginPath();
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = D * (0.15 + rnd() * 0.07);
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath(); g.fill();
  const arms = 11;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const len = D * (0.24 + rnd() * 0.23);
    const w = D * (0.025 + rnd() * 0.025);
    const px = -Math.sin(a), py = Math.cos(a);
    const r0 = D * 0.12;
    const bx = c + Math.cos(a) * r0, by = c + Math.sin(a) * r0;
    const ex = c + Math.cos(a) * len, ey = c + Math.sin(a) * len;
    g.beginPath(); g.moveTo(bx + px * w, by + py * w); g.lineTo(ex, ey); g.lineTo(bx - px * w, by - py * w); g.closePath(); g.fill();
    g.beginPath(); g.arc(ex, ey, w * (0.9 + rnd() * 0.7), 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 12; i++) {
    const a = rnd() * Math.PI * 2, r = D * (0.3 + rnd() * 0.17);
    g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, D * (0.007 + rnd() * 0.016), 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

/** A directional spray: a fan of beads and short streaks flung toward +X, densest at the left (where it left the cut). */
function paintSpray(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(707);
  const cy = H / 2;
  g.fillStyle = '#fff';
  for (let i = 0; i < 70; i++) {
    const u = Math.pow(rnd(), 0.7);
    const x = 6 + u * (W - 14);
    const spread = (0.12 + 0.36 * u) * H;
    const y = cy + (rnd() - 0.5) * spread;
    const r = (1 - u) * 3.4 + 0.8 + rnd() * 1.2;
    if (rnd() < 0.35) {
      // a streak, drawn out along the flight
      g.beginPath(); g.ellipse(x, y, r * 2.6, r * 0.7, 0, 0, Math.PI * 2); g.fill();
    } else {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  return k.c;
}

/** A soft-edged solid disc (the tint over the face): even across the middle, feathered over the outer tenth. */
function paintDisc(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const c = D / 2;
  const gr = k.g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0.85)'); gr.addColorStop(0.82, 'rgba(255,255,255,1)'); gr.addColorStop(0.92, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, D, D);
  return k.c;
}

/** A THICK shockwave ring: clear inside, a dense band at 0.8 of the radius, a soft falloff outside. */
function paintShock(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const c = D / 2;
  const gr = k.g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.58, 'rgba(255,255,255,0)');
  gr.addColorStop(0.76, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.84, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, D, D);
  return k.c;
}

let cached: HeroBleedTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroBleedTextures(): HeroBleedTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const crescent = paintCrescent(), crescentGlow = paintCrescentGlow(), seam = paintSeam(false), seamSoft = paintSeam(true);
  const gash = paintGash(false, 1301), gashLip = paintGash(true, 1301), drip = paintDrip(), drop = paintDrop(40, 16);
  const splat = paintSplat(128, 612), splat2 = paintSplat(128, 9090), spray = paintSpray(160, 72), disc = paintDisc(128), shock = paintShock(256);
  if (!base || !crescent || !crescentGlow || !seam || !seamSoft || !gash || !gashLip || !drip || !drop || !splat || !splat2 || !spray || !disc || !shock) return null;
  cached = {
    ...base,
    crescent: tex(crescent), crescentGlow: tex(crescentGlow), seam: tex(seam), seamSoft: tex(seamSoft), gash: tex(gash), gashLip: tex(gashLip),
    drip: tex(drip), drop: tex(drop), splat: tex(splat), splat2: tex(splat2), spray: tex(spray), disc: tex(disc), shock: tex(shock),
  };
  return cached;
}
