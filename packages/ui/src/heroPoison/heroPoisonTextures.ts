/**
 * The Poison Darts' textures, painted ONCE per session on 2D canvases and kept (about 330 KB of GPU memory on top of
 * the Blast's five and the Arcana ribbon strips, which it shares). Everything is white or grey, so every sprite tints
 * it.
 *
 * THE DART is four textures painted on ONE box (160 x 40) with the TIP at the same spot (x 156, the middle), so four
 * sprites on one transform make one dart, each tinted its own colour: the dark metal SHAFT (a needle, a vial frame and a
 * rear shaft, shaded so a dark tint still shows form), the FLETCHING (two swept vanes seen from the side with a thin
 * edge-on vane between them, feather grooves cut in), the VENOM (the liquid in the vial, the coating on the front of the
 * needle and a bead at the tip), and a thin EDGE light along the top of the needle and vial (additive). A blurred copy
 * of the whole silhouette is the dart's glow.
 *
 * Bold, clean shapes (the owner's bar: "clean", never particle soup): the splat is a crisp splash star with droplet
 * ends, a droplet is a teardrop, a toxic puff is a lumpy billow with a lit rim (never a perfect disc), a bubble is a rim
 * with a highlight.
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { seededRng } from '../heroAttack/easing';
import type { HeroPoisonTextures } from './heroPoisonScene';

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** The dart box: 160 x 40, the tip at (156, 20). The scene anchors every dart sprite at the tip. */
export const DART_W = 160;
export const DART_H = 40;
export const DART_TIP_X = 156;

const CY = DART_H / 2;

/** The dart's parts, as paths on the dart box (shared by the shaft, the glow and the edge so they line up exactly). */
function needlePath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(84, CY - 3.2); g.lineTo(DART_TIP_X, CY - 0.3); g.lineTo(DART_TIP_X + 1.5, CY); g.lineTo(DART_TIP_X, CY + 0.3); g.lineTo(84, CY + 3.2);
  g.closePath();
}
function vialPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.roundRect(50, CY - 7, 36, 14, 6);
}
function shaftPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.roundRect(14, CY - 2.2, 40, 4.4, 2);
}
function vanesPath(g: CanvasRenderingContext2D): void {
  // Two swept vanes (top and bottom), their leading edges curving back from the shaft, trailing edges cut square.
  g.beginPath();
  g.moveTo(46, CY - 2); g.quadraticCurveTo(30, CY - 6, 16, CY - 16); g.lineTo(6, CY - 16); g.quadraticCurveTo(10, CY - 8, 10, CY - 2); g.closePath();
  g.moveTo(46, CY + 2); g.quadraticCurveTo(30, CY + 6, 16, CY + 16); g.lineTo(6, CY + 16); g.quadraticCurveTo(10, CY + 8, 10, CY + 2); g.closePath();
}

/** The shaft: needle, vial frame, rear shaft and collars, shaded top-lit (grey body, lighter top) so a tint keeps form. */
function paintShaft(): HTMLCanvasElement | null {
  const k = canvas(DART_W, DART_H); if (!k) return null;
  const g = k.g;
  const shade = g.createLinearGradient(0, CY - 7, 0, CY + 7);
  shade.addColorStop(0, 'rgb(255,255,255)'); shade.addColorStop(0.45, 'rgb(190,190,190)'); shade.addColorStop(1, 'rgb(95,95,95)');
  g.fillStyle = shade;
  needlePath(g); g.fill();
  shaftPath(g); g.fill();
  // The vial frame: a ring of metal round the glass (the venom shows through the middle), with collars at both ends.
  g.save();
  vialPath(g); g.clip();
  g.fillStyle = shade; g.fillRect(50, CY - 7, 36, 14);
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.roundRect(55, CY - 4.2, 26, 8.4, 4); g.fill();
  g.restore();
  g.fillStyle = shade;
  g.fillRect(48, CY - 5, 4, 10);
  g.fillRect(84, CY - 4.5, 4, 9);
  return k.c;
}

/** The fletching: the two swept vanes with feather grooves, and the edge-on vane between them. */
function paintFletch(): HTMLCanvasElement | null {
  const k = canvas(DART_W, DART_H); if (!k) return null;
  const g = k.g;
  const gr = g.createLinearGradient(6, 0, 46, 0);
  gr.addColorStop(0, 'rgb(200,200,200)'); gr.addColorStop(1, 'rgb(255,255,255)');
  g.fillStyle = gr;
  vanesPath(g); g.fill();
  // Feather grooves: a few thin cuts swept like the barbs.
  g.save();
  vanesPath(g); g.clip();
  g.globalCompositeOperation = 'destination-out';
  g.lineWidth = 1.1;
  for (let i = 0; i < 5; i++) {
    const x = 14 + i * 6.5;
    g.beginPath(); g.moveTo(x + 6, CY - 2); g.lineTo(x - 3, CY - 17); g.stroke();
    g.beginPath(); g.moveTo(x + 6, CY + 2); g.lineTo(x - 3, CY + 17); g.stroke();
  }
  g.restore();
  // The edge-on vane.
  g.fillStyle = 'rgb(235,235,235)';
  g.beginPath(); g.moveTo(44, CY - 1.2); g.lineTo(8, CY - 1.6); g.lineTo(8, CY + 1.6); g.lineTo(44, CY + 1.2); g.closePath(); g.fill();
  return k.c;
}

/** The venom: the liquid in the vial (a meniscus highlight), the coating on the front of the needle and the tip bead. */
function paintVenom(): HTMLCanvasElement | null {
  const k = canvas(DART_W, DART_H); if (!k) return null;
  const g = k.g;
  const liquid = g.createLinearGradient(0, CY - 4, 0, CY + 4);
  liquid.addColorStop(0, 'rgb(255,255,255)'); liquid.addColorStop(0.35, 'rgb(225,225,225)'); liquid.addColorStop(1, 'rgb(170,170,170)');
  g.fillStyle = liquid;
  g.beginPath(); g.roundRect(55, CY - 4.2, 26, 8.4, 4); g.fill();
  // A bubble in the vial.
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(62, CY - 1, 1.6, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
  // The coating: the front third of the needle, wet.
  g.fillStyle = 'rgb(255,255,255)';
  g.beginPath(); g.moveTo(122, CY - 1.9); g.lineTo(DART_TIP_X, CY - 0.6); g.lineTo(DART_TIP_X, CY + 0.6); g.lineTo(122, CY + 1.9); g.closePath(); g.fill();
  // A drip hanging off the coating, and the bead at the tip.
  g.beginPath(); g.ellipse(134, CY + 2.6, 1.4, 2.2, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(DART_TIP_X - 1.5, CY, 2.3, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** The edge light: a thin line along the top of the needle and the vial (additive: the lit edge of dark metal). */
function paintEdge(): HTMLCanvasElement | null {
  const k = canvas(DART_W, DART_H); if (!k) return null;
  const g = k.g;
  g.strokeStyle = 'rgb(255,255,255)'; g.lineCap = 'round'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(88, CY - 2.8); g.lineTo(DART_TIP_X - 2, CY - 0.5); g.stroke();
  g.beginPath(); g.moveTo(54, CY - 6.2); g.lineTo(82, CY - 6.2); g.stroke();
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(16, CY - 1.6); g.lineTo(48, CY - 1.6); g.stroke();
  return k.c;
}

/** The dart's glow: the whole silhouette, blurred (the venom-green aura that reads on a dark board). */
function paintDartGlow(): HTMLCanvasElement | null {
  const k = canvas(DART_W, DART_H); if (!k) return null;
  const g = k.g;
  // shadowBlur (not `ctx.filter`, which older Safari lacks): the shapes plus a soft bloom round them.
  g.shadowColor = '#fff'; g.shadowBlur = 7;
  g.fillStyle = 'rgba(255,255,255,0.7)';
  needlePath(g); g.fill(); vialPath(g); g.fill(); shaftPath(g); g.fill();
  g.globalAlpha = 0.5; vanesPath(g); g.fill();
  g.globalAlpha = 1;
  // The tip glows hardest.
  g.shadowBlur = 6; g.fillStyle = '#fff';
  g.beginPath(); g.arc(DART_TIP_X - 3, CY, 4, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** A venom splat: a crisp blob with splash spikes ending in droplets, and satellite droplets (seeded, irregular). */
function paintSplat(D: number, seed: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2;
  const rnd = seededRng(seed);
  g.fillStyle = '#fff';
  // The body: a lumpy blob.
  g.beginPath();
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = D * (0.17 + rnd() * 0.07);
    const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath(); g.fill();
  // Spikes: tapered splash arms ending in a droplet.
  const arms = 9;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
    const len = D * (0.26 + rnd() * 0.2);
    const w = D * (0.035 + rnd() * 0.025);
    const px = -Math.sin(a), py = Math.cos(a);
    const r0 = D * 0.14;
    const bx = c + Math.cos(a) * r0, by = c + Math.sin(a) * r0;
    const ex = c + Math.cos(a) * len, ey = c + Math.sin(a) * len;
    g.beginPath(); g.moveTo(bx + px * w, by + py * w); g.lineTo(ex, ey); g.lineTo(bx - px * w, by - py * w); g.closePath(); g.fill();
    g.beginPath(); g.arc(ex, ey, w * (0.9 + rnd() * 0.6), 0, Math.PI * 2); g.fill();
  }
  // Satellites.
  for (let i = 0; i < 10; i++) {
    const a = rnd() * Math.PI * 2, r = D * (0.3 + rnd() * 0.17);
    g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, D * (0.008 + rnd() * 0.018), 0, Math.PI * 2); g.fill();
  }
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

/**
 * A toxic puff: overlapping round lumps with soft but DEFINED edges (a billow, not a gradient disc) and a lighter rim
 * on the upper lumps, so a green tint reads as a thick, bubbling cloud.
 */
function paintPuff(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const rnd = seededRng(3301);
  const lumps: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + rnd() * 0.5, r = D * (0.12 + rnd() * 0.08);
    lumps.push([D / 2 + Math.cos(a) * r, D / 2 + Math.sin(a) * r, D * (0.16 + rnd() * 0.07)]);
  }
  lumps.push([D / 2, D / 2, D * 0.22]);
  for (const [x, y, rr] of lumps) {
    const gr = g.createRadialGradient(x, y, 0, x, y, rr);
    gr.addColorStop(0, 'rgba(200,200,200,0.75)'); gr.addColorStop(0.72, 'rgba(215,215,215,0.7)'); gr.addColorStop(0.9, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
  return k.c;
}

/** A bubble: a thin rim over a faint fill, with a highlight up and to the left. */
function paintBubble(D: number): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  const g = k.g;
  const c = D / 2, r = D * 0.4;
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = D * 0.07;
  g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff';
  g.beginPath(); g.ellipse(c - r * 0.38, c - r * 0.4, r * 0.22, r * 0.14, -0.7, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** A soft-edged solid disc (the portrait tint): even across the middle, feathered over the outer tenth. */
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

let cached: HeroPoisonTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroPoisonTextures(): HeroPoisonTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const shaft = paintShaft(), fletch = paintFletch(), venom = paintVenom(), edge = paintEdge(), dartGlow = paintDartGlow();
  const splat = paintSplat(128, 91), splat2 = paintSplat(128, 4242), drop = paintDrop(40, 16), puff = paintPuff(128);
  const bubble = paintBubble(48), disc = paintDisc(128), shock = paintShock(256);
  if (!base || !shaft || !fletch || !venom || !edge || !dartGlow || !splat || !splat2 || !drop || !puff || !bubble || !disc || !shock) return null;
  cached = {
    ...base,
    dartShaft: tex(shaft), dartFletch: tex(fletch), dartVenom: tex(venom), dartEdge: tex(edge), dartGlow: tex(dartGlow),
    splat: tex(splat), splat2: tex(splat2), drop: tex(drop), puff: tex(puff), bubble: tex(bubble), disc: tex(disc), shock: tex(shock),
  };
  return cached;
}
