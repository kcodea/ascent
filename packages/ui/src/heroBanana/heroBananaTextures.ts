/**
 * The Banana Cannon's textures, painted ONCE per session on 2D canvases and kept (about 420 KB of GPU memory on top of
 * the Blast's five and the Arcana strips, which it shares). Almost everything is white or grey so every sprite tints it
 * (the tuner's colours apply live); the one exception is the banana ENDS (the brown tip and the green-brown stem),
 * painted in their own colours so a single yellow tint on the body still reads as a real banana.
 *
 * THE CANNON is King Oona's (the `b2_oona` art): a jungle-green barrel, gold bands and a flared brass BELL muzzle, a
 * spiral emblem, wooden grips and a little gold CROWN on top. It is four textures painted on ONE box (200 x 90, the
 * barrel along the middle, pointing +X) so four sprites on one transform make one cannon, each tinted its own colour:
 * the BARREL (shaded top-lit so a green tint keeps its roundness), the TRIM (bands, bell, emblem, crown), the DARK
 * details (the bore, the grips, rivets, the spiral) and a blurred silhouette for the golden charge glow.
 *
 * Flat 2D (owner 2026-09-29): a side-on cannon, flat shapes with a clean cartoon outline, no perspective. Bold, clean
 * shapes (the Arcana bar: never particle soup): a banana is a crescent, a peel splays into four petals, a chunk is a
 * round slice, the comic impact STAR is a jagged burst, smoke is a lumpy billow with a lit crown.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { seededRng } from '../heroAttack/easing';
import type { HeroBananaTextures } from './heroBananaScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

// ─── the cannon ────────────────────────────────────────────────────────────────────────────────────────────────

/** The cannon box: 200 x 90, the barrel's axis at y 40, pointing +X. The scene anchors it at the PIVOT. */
export const CANNON_W = 200;
export const CANNON_H = 90;
export const CANNON_AXIS_Y = 40;
/** The pivot (where the cannon sits on the hero's rim and turns about): a little behind the grips. */
export const CANNON_PIVOT_X = 70;
/** The muzzle's mouth. The pivot-to-mouth distance is `CANNON_MUZZLE_FRAC` (0.62) of the drawn length. */
export const CANNON_MOUTH_X = 194;
/** The crown on top of the barrel (its centre), for the Tier IV glint. */
export const CROWN_X = 116;
export const CROWN_Y = 16;

const AY = CANNON_AXIS_Y;

function barrelPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(26, AY - 15);
  g.lineTo(150, AY - 15);
  g.lineTo(150, AY + 15);
  g.lineTo(26, AY + 15);
  g.arc(26, AY, 15, Math.PI / 2, (Math.PI * 3) / 2);
  g.closePath();
}
function bellPath(g: CanvasRenderingContext2D): void {
  // The flared brass bell: a short neck, then a trumpet flare out to the mouth.
  g.beginPath();
  g.moveTo(146, AY - 17);
  g.quadraticCurveTo(172, AY - 18, CANNON_MOUTH_X, AY - 30);
  g.lineTo(CANNON_MOUTH_X + 2, AY - 30);
  g.lineTo(CANNON_MOUTH_X + 2, AY + 30);
  g.lineTo(CANNON_MOUTH_X, AY + 30);
  g.quadraticCurveTo(172, AY + 18, 146, AY + 17);
  g.closePath();
}
function crownPath(g: CanvasRenderingContext2D): void {
  const x = CROWN_X, base = AY - 14, top = base - 16;
  g.beginPath();
  g.moveTo(x - 13, base);
  g.lineTo(x - 14, top + 5);
  g.lineTo(x - 7, top + 10);
  g.lineTo(x, top);
  g.lineTo(x + 7, top + 10);
  g.lineTo(x + 14, top + 5);
  g.lineTo(x + 13, base);
  g.closePath();
}
function gripPaths(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(74, AY + 12); g.lineTo(90, AY + 12); g.lineTo(84, AY + 44); g.quadraticCurveTo(76, AY + 47, 70, AY + 42); g.closePath();
  g.moveTo(112, AY + 12); g.lineTo(126, AY + 12); g.lineTo(122, AY + 36); g.quadraticCurveTo(115, AY + 39, 110, AY + 34); g.closePath();
}

/** The barrel: the tube, shaded top-lit (bright top, darker belly) so a green tint keeps its roundness. */
function paintBarrel(): HTMLCanvasElement | null {
  const k = canvas(CANNON_W, CANNON_H); if (!k) return null;
  const g = k.g;
  const shade = g.createLinearGradient(0, AY - 15, 0, AY + 15);
  shade.addColorStop(0, 'rgb(255,255,255)'); shade.addColorStop(0.3, 'rgb(225,225,225)'); shade.addColorStop(0.75, 'rgb(160,160,160)'); shade.addColorStop(1, 'rgb(110,110,110)');
  g.fillStyle = shade;
  barrelPath(g); g.fill();
  // A lit highlight stripe along the top.
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.roundRect(30, AY - 11, 112, 4, 2); g.fill();
  return k.c;
}

/** The trim: gold bands, the flared bell, the round emblem and the crown, shaded so a gold tint reads as metal. */
function paintTrim(): HTMLCanvasElement | null {
  const k = canvas(CANNON_W, CANNON_H); if (!k) return null;
  const g = k.g;
  const metal = g.createLinearGradient(0, AY - 30, 0, AY + 30);
  metal.addColorStop(0, 'rgb(255,255,255)'); metal.addColorStop(0.35, 'rgb(235,235,235)'); metal.addColorStop(0.6, 'rgb(175,175,175)'); metal.addColorStop(1, 'rgb(120,120,120)');
  g.fillStyle = metal;
  // Bands round the barrel (a touch proud of it).
  for (const [x, w] of [[34, 9], [96, 10], [138, 12]] as const) { g.beginPath(); g.roundRect(x, AY - 17, w, 34, 3); g.fill(); }
  // The rear cap.
  g.beginPath(); g.arc(22, AY, 12, 0, Math.PI * 2); g.fill();
  // The bell.
  bellPath(g); g.fill();
  // The emblem disc.
  g.beginPath(); g.arc(64, AY, 11, 0, Math.PI * 2); g.fill();
  // The crown.
  const cg = g.createLinearGradient(0, AY - 30, 0, AY - 14);
  cg.addColorStop(0, 'rgb(255,255,255)'); cg.addColorStop(1, 'rgb(190,190,190)');
  g.fillStyle = cg;
  crownPath(g); g.fill();
  // Crown jewels' settings (small balls on the three points).
  g.fillStyle = 'rgb(255,255,255)';
  for (const [x, y] of [[CROWN_X - 14, AY - 25], [CROWN_X, AY - 30], [CROWN_X + 14, AY - 25]] as const) { g.beginPath(); g.arc(x, y, 2.6, 0, Math.PI * 2); g.fill(); }
  // A lit rim along the top of the bell.
  g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 2; g.lineCap = 'round';
  g.beginPath(); g.moveTo(150, AY - 16); g.quadraticCurveTo(172, AY - 17, CANNON_MOUTH_X - 1, AY - 28); g.stroke();
  return k.c;
}

/** The dark details: the bore at the mouth, the wooden grips, rivets on the bands, the spiral on the emblem, outlines. */
function paintDark(): HTMLCanvasElement | null {
  const k = canvas(CANNON_W, CANNON_H); if (!k) return null;
  const g = k.g;
  // The grips (wood: tinted the dark brown, a lighter grain stripe).
  g.fillStyle = 'rgb(210,210,210)';
  gripPaths(g); g.fill();
  g.strokeStyle = 'rgb(150,150,150)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(80, AY + 16); g.lineTo(78, AY + 40); g.moveTo(118, AY + 16); g.lineTo(116, AY + 32); g.stroke();
  g.fillStyle = 'rgb(40,40,40)';
  // The bore: the dark mouth of the bell.
  g.beginPath(); g.ellipse(CANNON_MOUTH_X - 1, AY, 4, 25, 0, 0, Math.PI * 2); g.fill();
  // Rivets on the bands.
  for (const x of [38.5, 101, 144]) for (const y of [AY - 11, AY, AY + 11]) { g.beginPath(); g.arc(x, y, 1.5, 0, Math.PI * 2); g.fill(); }
  // The spiral on the emblem.
  g.strokeStyle = 'rgb(40,40,40)'; g.lineWidth = 1.8; g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i <= 40; i++) {
    const a = i * 0.42, r = 1 + i * 0.19;
    const x = 64 + Math.cos(a) * r, y = AY + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
  // A clean cartoon outline round the whole silhouette.
  g.lineWidth = 2.2; g.lineJoin = 'round';
  barrelPath(g); g.stroke();
  bellPath(g); g.stroke();
  crownPath(g); g.stroke();
  gripPaths(g); g.stroke();
  g.beginPath(); g.arc(64, AY, 11, 0, Math.PI * 2); g.stroke();
  return k.c;
}

/** The cannon's glow: the whole silhouette, blurred (the golden charge aura). */
function paintCannonGlow(): HTMLCanvasElement | null {
  const k = canvas(CANNON_W, CANNON_H); if (!k) return null;
  const g = k.g;
  g.shadowColor = '#fff'; g.shadowBlur = 10;
  g.fillStyle = 'rgba(255,255,255,0.75)';
  barrelPath(g); g.fill(); bellPath(g); g.fill(); crownPath(g); g.fill();
  g.beginPath(); g.arc(22, AY, 12, 0, Math.PI * 2); g.fill();
  return k.c;
}

// ─── the banana ────────────────────────────────────────────────────────────────────────────────────────────────

/** The banana box: 128 x 64, a crescent lying along X, belly down. The scene anchors it at the centre. */
export const BANANA_W = 128;
export const BANANA_H = 64;

function bananaPath(g: CanvasRenderingContext2D): void {
  // Outer (belly) curve and inner (back) curve, meeting at the stem (left) and the tip (right).
  g.beginPath();
  g.moveTo(8, 20);
  g.quadraticCurveTo(64, 72, 122, 18);
  g.quadraticCurveTo(64, 14, 8, 20);
  g.closePath();
}

/** The banana's body: the crescent, shaded (a bright back ridge, a warmer belly), with two ridge lines. */
function paintBananaBody(): HTMLCanvasElement | null {
  const k = canvas(BANANA_W, BANANA_H); if (!k) return null;
  const g = k.g;
  const gr = g.createLinearGradient(0, 22, 0, 46);
  gr.addColorStop(0, 'rgb(255,255,255)'); gr.addColorStop(0.5, 'rgb(240,240,240)'); gr.addColorStop(1, 'rgb(185,185,185)');
  g.fillStyle = gr;
  bananaPath(g); g.fill();
  g.strokeStyle = 'rgba(150,150,150,0.8)'; g.lineWidth = 1.4;
  g.beginPath(); g.moveTo(20, 30); g.quadraticCurveTo(64, 58, 110, 28); g.stroke();
  // A dark outline (tinted with the body: reads as a deeper yellow edge).
  g.strokeStyle = 'rgb(120,120,120)'; g.lineWidth = 2;
  bananaPath(g); g.stroke();
  return k.c;
}

/** The banana's ends in their OWN colours: the green-brown stem and the dark brown tip (the sprite is not tinted). */
function paintBananaEnds(): HTMLCanvasElement | null {
  const k = canvas(BANANA_W, BANANA_H); if (!k) return null;
  const g = k.g;
  g.save();
  bananaPath(g); g.clip();
  g.fillStyle = '#5b3a17';
  g.beginPath(); g.ellipse(120, 19, 6, 5, -0.5, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#6f7a2a';
  g.fillRect(4, 12, 11, 16);
  g.restore();
  // The stem sticks out past the body.
  g.fillStyle = '#6a6f25';
  g.beginPath(); g.moveTo(12, 21); g.lineTo(2, 15); g.lineTo(1, 20); g.lineTo(10, 25); g.closePath(); g.fill();
  g.fillStyle = '#4a3212';
  g.beginPath(); g.arc(2, 17.5, 2.4, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** The banana's shine: a soft highlight along the back (additive). */
function paintBananaShine(): HTMLCanvasElement | null {
  const k = canvas(BANANA_W, BANANA_H); if (!k) return null;
  const g = k.g;
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(28, 24); g.quadraticCurveTo(64, 30, 100, 23); g.stroke();
  return k.c;
}

/** The banana's glow: the crescent, blurred (the golden aura on the giant). */
function paintBananaGlow(): HTMLCanvasElement | null {
  const k = canvas(BANANA_W, BANANA_H); if (!k) return null;
  const g = k.g;
  g.shadowColor = '#fff'; g.shadowBlur = 9;
  g.fillStyle = 'rgba(255,255,255,0.8)';
  bananaPath(g); g.fill();
  return k.c;
}

// ─── the splat ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A splayed banana PEEL seen flat: four petals from the stem, the pale inside of each showing, a dark outline. */
function paintPeel(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const petals: [number, number][] = [[-2.3, 0.44], [-0.85, 0.42], [0.65, 0.46], [2.1, 0.4]];
  for (const [a, len] of petals) {
    const L = D * len, w = D * 0.11;
    const ex = c + Math.cos(a) * L, ey = c + Math.sin(a) * L;
    const px = -Math.sin(a), py = Math.cos(a);
    const path = (): void => {
      g.beginPath();
      g.moveTo(c + px * w * 0.6, c + py * w * 0.6);
      g.quadraticCurveTo(c + Math.cos(a) * L * 0.55 + px * w * 1.4, c + Math.sin(a) * L * 0.55 + py * w * 1.4, ex, ey);
      g.quadraticCurveTo(c + Math.cos(a) * L * 0.55 - px * w * 1.4, c + Math.sin(a) * L * 0.55 - py * w * 1.4, c - px * w * 0.6, c - py * w * 0.6);
      g.closePath();
    };
    g.fillStyle = 'rgb(225,225,225)'; path(); g.fill();
    // The pale inside, a thinner petal on top.
    g.fillStyle = 'rgb(255,255,255)';
    g.save(); g.translate(c, c); g.scale(0.7, 0.7); g.translate(-c, -c); path(); g.fill(); g.restore();
    g.strokeStyle = 'rgb(120,120,120)'; g.lineWidth = 1.6; path(); g.stroke();
  }
  // The stem nub in the middle.
  g.fillStyle = 'rgb(110,110,110)';
  g.beginPath(); g.arc(c, c, D * 0.05, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** A banana chunk: a round slice, a pale ring and three seed dots. */
function paintChunk(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2, r = D * 0.42;
  g.fillStyle = 'rgb(225,225,225)';
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgb(255,255,255)';
  g.beginPath(); g.arc(c, c, r * 0.72, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgb(120,120,120)';
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.4; g.beginPath(); g.arc(c + Math.cos(a) * r * 0.25, c + Math.sin(a) * r * 0.25, D * 0.035, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = 'rgb(150,150,150)'; g.lineWidth = D * 0.05;
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
  return k.c;
}

/** The comic IMPACT STAR: a jagged burst of uneven spikes (seeded). A bigger copy tinted dark is its outline. */
function paintStar(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const rnd = seededRng(7717);
  const n = 12;
  g.fillStyle = '#fff';
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
    const r = i % 2 === 0 ? D * (0.4 + rnd() * 0.09) : D * (0.2 + rnd() * 0.05);
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath(); g.fill();
  return k.c;
}

/** Banana mush: a soft lumpy splat with a few flecks (the impact's squash on the face). */
function paintMush(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const rnd = seededRng(5150);
  g.fillStyle = 'rgb(240,240,240)';
  g.beginPath();
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = D * (0.2 + rnd() * 0.1);
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath(); g.fill();
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, r = D * (0.28 + rnd() * 0.16);
    g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, D * (0.015 + rnd() * 0.03), 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgb(255,255,255)';
  g.beginPath(); g.arc(c - D * 0.05, c - D * 0.06, D * 0.09, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** A leaf: a pointed jungle leaf along +X with a midrib (greyscale, tinted leaf green). */
function paintLeaf(W: number, H: number): HTMLCanvasElement | null {
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const cy = H / 2;
  g.fillStyle = 'rgb(220,220,220)';
  g.beginPath(); g.moveTo(1, cy); g.quadraticCurveTo(W * 0.45, -H * 0.1, W - 1, cy); g.quadraticCurveTo(W * 0.45, H * 1.1, 1, cy); g.closePath(); g.fill();
  g.strokeStyle = 'rgb(255,255,255)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(2, cy); g.lineTo(W - 3, cy); g.stroke();
  return k.c;
}

/** A smoke billow: overlapping lumps lit from the top left (a thick puff, never a flat disc). */
function paintPuff(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(4411);
  const lumps: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.5, r = D * (0.12 + rnd() * 0.08);
    lumps.push([D / 2 + Math.cos(a) * r, D / 2 + Math.sin(a) * r, D * (0.16 + rnd() * 0.07)]);
  }
  lumps.push([D / 2, D / 2, D * 0.22]);
  lumps.sort((p, q) => p[1] - q[1]).reverse();
  for (const [x, y, rr] of lumps) {
    const gr = g.createRadialGradient(x - rr * 0.35, y - rr * 0.4, rr * 0.05, x, y, rr);
    gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.55, 'rgba(215,215,215,0.9)');
    gr.addColorStop(0.88, 'rgba(160,160,160,0.8)'); gr.addColorStop(1, 'rgba(140,140,140,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

/** A soft-edged solid disc (the flat shadow under the falling giant). */
function paintDisc(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const c = D / 2;
  const gr = k.g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, D, D);
  return k.c;
}

/** A THICK shockwave ring: clear inside, a dense band at 0.8 of the radius, a soft falloff outside. */
function paintShock(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const c = D / 2;
  const gr = k.g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.6, 'rgba(255,255,255,0)');
  gr.addColorStop(0.77, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.84, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  k.g.fillStyle = gr; k.g.fillRect(0, 0, D, D);
  return k.c;
}

let cached: HeroBananaTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroBananaTextures(): HeroBananaTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const barrel = paintBarrel(), trim = paintTrim(), dark = paintDark(), cannonGlow = paintCannonGlow();
  const body = paintBananaBody(), ends = paintBananaEnds(), shine = paintBananaShine(), bananaGlow = paintBananaGlow();
  const peel = paintPeel(96), chunk = paintChunk(32), impactStar = paintStar(160), mush = paintMush(128), leaf = paintLeaf(40, 18);
  const puff = paintPuff(128), disc = paintDisc(128), shock = paintShock(256);
  if (!base || !barrel || !trim || !dark || !cannonGlow || !body || !ends || !shine || !bananaGlow || !peel || !chunk || !impactStar || !mush || !leaf || !puff || !disc || !shock) return null;
  cached = {
    ...base,
    cannonBarrel: tex(barrel), cannonTrim: tex(trim), cannonDark: tex(dark), cannonGlow: tex(cannonGlow),
    bananaBody: tex(body), bananaEnds: tex(ends), bananaShine: tex(shine), bananaGlow: tex(bananaGlow),
    peel: tex(peel), chunk: tex(chunk), impactStar: tex(impactStar), mush: tex(mush), leaf: tex(leaf),
    puff: tex(puff), disc: tex(disc), shock: tex(shock),
  };
  return cached;
}
