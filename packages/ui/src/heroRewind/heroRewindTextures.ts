/**
 * The Rewind's textures, painted ONCE per session on 2D canvases and kept (a few on top of the shared Blast / Arcana
 * set it reuses for glows, rings, stars and the ribbon trail). Greys unless noted, so every sprite tints them:
 *  - GRAIN: one crisp grain of sand (a tiny bright speck with a soft edge). Hundreds of these are the hourglass sand.
 *  - HALO: the broken orbital ring of the reference art, a shattered clock / astrolabe: a bevelled band in three pieces
 *    with ragged gaps, twelve hour ticks round it.
 *  - ORBIT: the thinner inner ring (two pieces, three small orbs riding it), drawn tilted as an orbit.
 *  - HAND: a clock hand, pivoting on its base (anchor at the left end).
 *  - HOURGLASS: Tier IV's hourglass, painted in its own colours (a gold frame, two violet-tinted glass bulbs, gold sand
 *    in the lower bulb and a thin stream through the neck). Drawn untinted.
 *  - SHARD: a sliver of hourglass glass (the shatter).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroRewindTextures } from './heroRewindScene';

export const HALO_PX = 256;
export const HAND_PX = 128;
export const HOURGLASS_W = 176;
export const HOURGLASS_H = 256;
export const GRAIN_PX = 12;
export const SHARD_PX = 32;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

function paintGrain(): HTMLCanvasElement | null {
  const k = canvas(GRAIN_PX, GRAIN_PX); if (!k) return null;
  const g = k.g;
  const c = GRAIN_PX / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, GRAIN_PX, GRAIN_PX);
  return k.c;
}

/** A broken bevelled band: `pieces` arcs between ragged gaps. */
function brokenBand(g: CanvasRenderingContext2D, c: number, r: number, w: number, pieces: readonly [number, number][]): void {
  for (const [a0, a1] of pieces) {
    // The band, lit on the outside edge and shaded on the inner one (a bevel).
    const shade = g.createRadialGradient(c, c, r - w / 2, c, c, r + w / 2);
    shade.addColorStop(0, 'rgb(150,150,150)'); shade.addColorStop(0.55, 'rgb(235,235,235)'); shade.addColorStop(1, 'rgb(255,255,255)');
    g.fillStyle = shade;
    g.beginPath();
    g.arc(c, c, r + w / 2, a0, a1);
    // A ragged broken end: the inner edge stops a little short, so each end reads as snapped.
    g.lineTo(c + Math.cos(a1 - 0.05) * (r - w / 2), c + Math.sin(a1 - 0.05) * (r - w / 2));
    g.arc(c, c, r - w / 2, a1 - 0.05, a0 + 0.07, true);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(70,70,70,0.9)'; g.lineWidth = 1.4; g.stroke();
  }
}

function paintHalo(): HTMLCanvasElement | null {
  const k = canvas(HALO_PX, HALO_PX); if (!k) return null;
  const g = k.g;
  const c = HALO_PX / 2;
  const r = HALO_PX * 0.43;
  brokenBand(g, c, r, 12, [[-1.35, 0.55], [0.85, 2.6], [2.95, 4.62]]);
  // Twelve hour ticks, longer at the quarters (skipped where the band is broken).
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const n = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const inGap = (n > 0.55 && n < 0.85) || (n > 2.6 && n < 2.95) || (n > 4.62 && n < 4.93);
    if (inGap) continue;
    const quarter = i % 3 === 0;
    g.lineWidth = quarter ? 3.2 : 2;
    const r0 = r - 6 - (quarter ? 16 : 9), r1 = r - 7;
    g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
  }
  return k.c;
}

function paintOrbit(): HTMLCanvasElement | null {
  const k = canvas(HALO_PX, HALO_PX); if (!k) return null;
  const g = k.g;
  const c = HALO_PX / 2;
  const r = HALO_PX * 0.45;
  brokenBand(g, c, r, 6, [[0.3, 2.9], [3.35, 5.9]]);
  g.fillStyle = '#fff';
  for (const a of [1.2, 3.9, 5.3]) { g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 6, 0, Math.PI * 2); g.fill(); }
  return k.c;
}

function paintHand(): HTMLCanvasElement | null {
  const k = canvas(HAND_PX, 20); if (!k) return null;
  const g = k.g;
  g.fillStyle = 'rgb(245,245,245)';
  g.beginPath(); g.moveTo(4, 10); g.lineTo(18, 3); g.lineTo(HAND_PX - 6, 9); g.lineTo(HAND_PX - 2, 10); g.lineTo(HAND_PX - 6, 11); g.lineTo(18, 17); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(70,70,70,0.9)'; g.lineWidth = 1.2; g.stroke();
  g.beginPath(); g.arc(10, 10, 6, 0, Math.PI * 2); g.fill(); g.stroke();
  return k.c;
}

function paintHourglass(): HTMLCanvasElement | null {
  const k = canvas(HOURGLASS_W, HOURGLASS_H); if (!k) return null;
  const g = k.g;
  const W = HOURGLASS_W, H = HOURGLASS_H, cx = W / 2;
  const top = 26, bot = H - 26, neck = H / 2, bw = W * 0.38;
  const bulb = (): void => {
    g.beginPath();
    g.moveTo(cx - bw, top);
    g.bezierCurveTo(cx - bw, neck - 40, cx - 8, neck - 18, cx - 6, neck);
    g.bezierCurveTo(cx - 8, neck + 18, cx - bw, neck + 40, cx - bw, bot);
    g.lineTo(cx + bw, bot);
    g.bezierCurveTo(cx + bw, neck + 40, cx + 8, neck + 18, cx + 6, neck);
    g.bezierCurveTo(cx + 8, neck - 18, cx + bw, neck - 40, cx + bw, top);
    g.closePath();
  };
  // The glass: violet-tinted, brighter at the edges.
  const glass = g.createLinearGradient(cx - bw, 0, cx + bw, 0);
  glass.addColorStop(0, 'rgba(196,170,255,0.55)'); glass.addColorStop(0.5, 'rgba(139,92,246,0.18)'); glass.addColorStop(1, 'rgba(196,170,255,0.55)');
  g.fillStyle = glass; bulb(); g.fill();
  // The sand: a heap in the lower bulb and a thin stream through the neck.
  g.save(); bulb(); g.clip();
  const sand = g.createLinearGradient(0, neck + 30, 0, bot);
  sand.addColorStop(0, '#ffe9b0'); sand.addColorStop(1, '#d4a537');
  g.fillStyle = sand;
  g.beginPath(); g.moveTo(cx - bw, bot); g.quadraticCurveTo(cx, neck + 22, cx + bw, bot); g.closePath(); g.fill();
  g.fillRect(cx - 1.8, neck - 6, 3.6, 40);
  g.beginPath(); g.moveTo(cx - bw, top + 6); g.lineTo(cx + bw, top + 6); g.quadraticCurveTo(cx, neck - 30, cx - bw, top + 6); g.fill();
  g.restore();
  g.strokeStyle = 'rgba(255,240,210,0.9)'; g.lineWidth = 2.5; bulb(); g.stroke();
  // A highlight down one side of each bulb.
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx - bw + 10, top + 14); g.quadraticCurveTo(cx - bw + 8, neck - 40, cx - 18, neck - 14); g.stroke();
  g.beginPath(); g.moveTo(cx - 18, neck + 14); g.quadraticCurveTo(cx - bw + 8, neck + 40, cx - bw + 10, bot - 14); g.stroke();
  // The gold frame: a bar top and bottom and two posts.
  const gold = g.createLinearGradient(0, 0, 0, 22);
  gold.addColorStop(0, '#ffe9b0'); gold.addColorStop(0.5, '#d4a537'); gold.addColorStop(1, '#8a6a1f');
  for (const y of [4, H - 26]) {
    g.fillStyle = gold;
    g.save(); g.translate(0, y); g.fillRect(cx - bw - 18, 0, (bw + 18) * 2, 22); g.restore();
    g.strokeStyle = '#5a4512'; g.lineWidth = 2; g.strokeRect(cx - bw - 18, y, (bw + 18) * 2, 22);
  }
  g.fillStyle = '#d4a537';
  for (const x of [cx - bw - 12, cx + bw + 6]) { g.fillRect(x, 26, 6, H - 52); g.strokeStyle = '#5a4512'; g.lineWidth = 1.5; g.strokeRect(x, 26, 6, H - 52); }
  return k.c;
}

function paintShard(): HTMLCanvasElement | null {
  const k = canvas(SHARD_PX, SHARD_PX); if (!k) return null;
  const g = k.g;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath(); g.moveTo(3, 20); g.lineTo(14, 2); g.lineTo(30, 12); g.lineTo(18, 30); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 1.5; g.stroke();
  return k.c;
}

let cached: HeroRewindTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroRewindTextures(): HeroRewindTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const grain = paintGrain(), halo = paintHalo(), orbit = paintOrbit(), hand = paintHand(), hourglass = paintHourglass(), shard = paintShard();
  const god = heroRewindGodExtras();
  if (!base || !grain || !halo || !orbit || !hand || !hourglass || !shard || !god) return null;
  cached = { ...base, ...god, grain: tex(grain), halo: tex(halo), orbit: tex(orbit), clockHand: tex(hand), hourglass: tex(hourglass), shard: tex(shard) };
  return cached;
}

// ── god scale (owner review 2026-10-02: "the attack is an ancient power, literally a god's attack. make it cooler") ──

export const FACE_PX = 512;
export const BIG_SHARD_PX = 128;
export const WASH_PX = 16;

/** The clock face behind the board (Tier IV): an outer and an inner ring, sixty minute ticks, twelve hour bars. Grey. */
function paintClockFace(): HTMLCanvasElement | null {
  const k = canvas(FACE_PX, FACE_PX); if (!k) return null;
  const g = k.g;
  const c = FACE_PX / 2;
  const R = FACE_PX * 0.47;
  const fill = g.createRadialGradient(c, c, R * 0.2, c, c, R);
  fill.addColorStop(0, 'rgba(255,255,255,0)'); fill.addColorStop(0.8, 'rgba(255,255,255,0.06)'); fill.addColorStop(1, 'rgba(255,255,255,0.14)');
  g.fillStyle = fill; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 7; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2.5; g.beginPath(); g.arc(c, c, R * 0.86, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 1.5; g.beginPath(); g.arc(c, c, R * 0.34, 0, Math.PI * 2); g.stroke();
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

/** A big pane of broken glass (the screen shatter): an irregular sliver with a bright edge and a soft fill. */
function paintBigShard(): HTMLCanvasElement | null {
  const k = canvas(BIG_SHARD_PX, BIG_SHARD_PX); if (!k) return null;
  const g = k.g;
  const pts: [number, number][] = [[10, 70], [44, 8], [118, 30], [96, 96], [52, 120]];
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
  const fill = g.createLinearGradient(10, 8, 118, 120);
  fill.addColorStop(0, 'rgba(255,255,255,0.55)'); fill.addColorStop(0.5, 'rgba(255,255,255,0.12)'); fill.addColorStop(1, 'rgba(255,255,255,0.4)');
  g.fillStyle = fill; g.fill();
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 3; g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(44, 8); g.lineTo(70, 70); g.lineTo(52, 120); g.moveTo(70, 70); g.lineTo(118, 30); g.stroke();
  return k.c;
}

function paintWash(): HTMLCanvasElement | null {
  const k = canvas(WASH_PX, WASH_PX); if (!k) return null;
  k.g.fillStyle = '#fff'; k.g.fillRect(0, 0, WASH_PX, WASH_PX);
  return k.c;
}

let godExtras: { clockFace: Texture; bigShard: Texture; wash: Texture } | null = null;

/** The god-scale extras (painted once per session; null with no 2D canvas). */
export function heroRewindGodExtras(): { clockFace: Texture; bigShard: Texture; wash: Texture } | null {
  if (godExtras) return godExtras;
  const face = paintClockFace(), shard = paintBigShard(), wash = paintWash();
  if (!face || !shard || !wash) return null;
  godExtras = { clockFace: tex(face), bigShard: tex(shard), wash: tex(wash) };
  return godExtras;
}

/**
 * THE GOD: the Ancient of Time's own art (`art/ancients/time.webp`, the owner's reference picture), feathered into a
 * bust (an oval fade, so it rises out of the sky with no hard edge). Loaded once per session, asynchronously: null until
 * the image has decoded (the first fight of a session kicks it off during the damage formation; with no image the
 * attack simply plays without the apparition).
 */
let god: Texture | null = null;
let godLoading = false;

/** Where the art's features sit, as a fraction of the 512 px picture (the eyes, the raised pouring hand, the head). */
export const GOD_FEATURES = { goldEye: { x: 0.453, y: 0.2 }, violetEye: { x: 0.566, y: 0.2 }, hand: { x: 0.2, y: 0.33 }, head: { x: 0.5, y: 0.22 } } as const;

function paintGod(img: HTMLImageElement): HTMLCanvasElement | null {
  const k = canvas(FACE_PX, FACE_PX); if (!k) return null;
  const g = k.g;
  g.drawImage(img, 0, 0, FACE_PX, FACE_PX);
  // Feather: keep the mask, the halo and the hands; fade the edges and the bottom into nothing.
  g.globalCompositeOperation = 'destination-in';
  const c = FACE_PX / 2;
  // The face and halo stay strong; the robes below fade out fast, so the god looms over the board without hiding it.
  const fade = g.createRadialGradient(c, FACE_PX * 0.26, FACE_PX * 0.1, c, FACE_PX * 0.32, FACE_PX * 0.46);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.55, 'rgba(0,0,0,0.7)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = fade; g.fillRect(0, 0, FACE_PX, FACE_PX);
  g.globalCompositeOperation = 'source-over';
  return k.c;
}

export function rewindGodTexture(url: string | undefined): Texture | null {
  if (god) return god;
  if (godLoading || !url || typeof Image === 'undefined' || typeof document === 'undefined') return null;
  godLoading = true;
  try {
    const img = new Image();
    img.onload = () => { const c = paintGod(img); if (c) god = tex(c); };
    img.onerror = () => { godLoading = false; };
    img.src = url;
  } catch { godLoading = false; }
  return null;
}
