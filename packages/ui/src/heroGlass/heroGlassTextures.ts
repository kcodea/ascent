/**
 * The Fourth Wall's textures, painted ONCE per session on 2D canvases and kept (on top of the shared Blast / Arcana set
 * it reuses for glows, rings, stars and sparks). No image files, and nothing is repainted per blow: every crack is one
 * stretched CRACK sprite, every shard a few triangles of the SHARD lookup.
 *
 *  - CRACK: one fracture line, drawn along +x: a thin bright thread with a darker line just under it (the far face of
 *    the break) and a faint halo, so a stretched sprite reads as a crack IN glass rather than a white stroke.
 *  - CHIP: the star-shaped pit a hard knock leaves: an irregular bright star with a dark underside and conchoidal rings.
 *  - TEAR: Tier 4's bold fracture, drawn along +x: an open dark gap between two bright lips with a wide cold halo, so the
 *    tear reads as the glass parting, three times the weight of a crack.
 *  - SHARD (a lookup, not a picture): u runs from a shard's RIM (bright, nearly opaque: the cut edge catching the light)
 *    to its FACE (a pale, see-through tint); v runs from resting to FLASHING (a shard turning face-on to the light). The
 *    shard mesh gives its rim vertices u = 0, its inner vertices u = 1, and slides v as each shard tumbles.
 *  - SLIVER: a tiny splinter (the dust of glass thrown off a hit).
 *  - GLINT: a thin bright streak (the shimmer sweeping a repaired pane, a refraction glint on a crack).
 *  - WASH: a flat white quad (the flash, the hole, the faint offset tints, the beam's core).
 *  - LINE: a soft line of light along +x, full length, fading across its width (the energy glow under every crack, so
 *    chained pieces read as one glowing fracture).
 *  - GHOST (`ghostTexture`): the striker's own portrait art, cut to a soft-edged disc, for its reflection in the glass.
 *    Painted once per portrait image (cached by its source), never per blow; null when the art is not there or not
 *    loaded (the reflection is then simply skipped).
 */
import { CanvasSource, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import type { HeroGlassTextures } from './heroGlassScene';

export const CRACK_W = 64;
export const CRACK_H = 12;
export const CHIP_PX = 128;
export const TEAR_W = 64;
export const TEAR_H = 28;
export const SHARD_LUT = 64;
export const SLIVER_PX = 24;
export const GLINT_W = 64;
export const WASH_PX = 16;
export const LINE_W = 64;
export const LINE_H = 16;
export const GHOST_PX = 160;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** A fracture line: a faint halo, a dark line a little below centre, a bright thread on top. Full length (pieces chain). */
function paintCrack(): HTMLCanvasElement | null {
  const k = canvas(CRACK_W, CRACK_H); if (!k) return null;
  const g = k.g;
  const cy = CRACK_H / 2;
  const halo = g.createLinearGradient(0, 0, 0, CRACK_H);
  halo.addColorStop(0, 'rgba(210,235,255,0)'); halo.addColorStop(0.42, 'rgba(210,235,255,0.22)'); halo.addColorStop(0.75, 'rgba(210,235,255,0)');
  g.fillStyle = halo; g.fillRect(0, 0, CRACK_W, CRACK_H);
  g.fillStyle = 'rgba(6,14,26,0.78)'; g.fillRect(0, cy + 0.4, CRACK_W, 1.7);
  g.fillStyle = 'rgba(255,255,255,0.98)'; g.fillRect(0, cy - 1.3, CRACK_W, 1.5);
  return k.c;
}

/** The chip: an irregular star pit (bright facets, a dark underside), two broken conchoidal arcs and a white heart. */
function paintChip(): HTMLCanvasElement | null {
  const k = canvas(CHIP_PX, CHIP_PX); if (!k) return null;
  const g = k.g;
  const c = CHIP_PX / 2;
  const pts = 9;
  const lens = [0.92, 0.36, 0.7, 0.3, 1, 0.34, 0.62, 0.28, 0.84, 0.38, 0.74, 0.3, 0.96, 0.33, 0.58, 0.3, 0.8, 0.36];
  const star = (r: number, dx: number, dy: number): void => {
    g.beginPath();
    for (let i = 0; i < pts * 2; i++) {
      const a = (i / (pts * 2)) * Math.PI * 2 + 0.2;
      const rr = r * lens[i]!;
      const x = c + dx + Math.cos(a) * rr, y = c + dy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  };
  // The dark underside, offset down-right (the pit has depth).
  star(c * 0.86, 2.5, 3); g.fillStyle = 'rgba(6,14,26,0.6)'; g.fill();
  const body = g.createRadialGradient(c - 4, c - 5, 2, c, c, c * 0.9);
  body.addColorStop(0, 'rgba(255,255,255,1)'); body.addColorStop(0.35, 'rgba(226,243,255,0.92)'); body.addColorStop(1, 'rgba(170,212,245,0.55)');
  star(c * 0.84, 0, 0); g.fillStyle = body; g.fill();
  g.lineJoin = 'miter'; g.lineWidth = 1.4; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
  // Facet lines from the heart to each long point.
  g.lineWidth = 1; g.strokeStyle = 'rgba(40,70,104,0.5)';
  for (let i = 0; i < pts * 2; i += 2) {
    const a = (i / (pts * 2)) * Math.PI * 2 + 0.2;
    g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(a) * c * 0.8 * lens[i]!, c + Math.sin(a) * c * 0.8 * lens[i]!); g.stroke();
  }
  // Conchoidal rings: two broken arcs.
  g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.2;
  g.beginPath(); g.arc(c, c, c * 0.3, 0.3, 2.4); g.stroke();
  g.beginPath(); g.arc(c, c, c * 0.3, 3.4, 5.6); g.stroke();
  g.strokeStyle = 'rgba(6,14,26,0.4)';
  g.beginPath(); g.arc(c + 1.2, c + 1.4, c * 0.3, 0.3, 2.4); g.stroke();
  const heart = g.createRadialGradient(c, c, 0, c, c, c * 0.2);
  heart.addColorStop(0, 'rgba(255,255,255,1)'); heart.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = heart; g.beginPath(); g.arc(c, c, c * 0.2, 0, Math.PI * 2); g.fill();
  return k.c;
}

/** Tier 4's tear: a wide cold halo, two bright lips and the dark gap between them. Full length (pieces chain). */
function paintTear(): HTMLCanvasElement | null {
  const k = canvas(TEAR_W, TEAR_H); if (!k) return null;
  const g = k.g;
  const cy = TEAR_H / 2;
  const halo = g.createLinearGradient(0, 0, 0, TEAR_H);
  halo.addColorStop(0, 'rgba(200,232,255,0)'); halo.addColorStop(0.36, 'rgba(210,236,255,0.34)'); halo.addColorStop(0.5, 'rgba(235,246,255,0.5)');
  halo.addColorStop(0.64, 'rgba(210,236,255,0.34)'); halo.addColorStop(1, 'rgba(200,232,255,0)');
  g.fillStyle = halo; g.fillRect(0, 0, TEAR_W, TEAR_H);
  g.fillStyle = 'rgba(4,10,20,0.9)'; g.fillRect(0, cy - 1.6, TEAR_W, 3.6);
  g.fillStyle = 'rgba(255,255,255,1)'; g.fillRect(0, cy - 3.6, TEAR_W, 2);
  g.fillStyle = 'rgba(214,238,255,0.92)'; g.fillRect(0, cy + 2, TEAR_W, 1.4);
  return k.c;
}

/** The shard lookup: u = rim (bright, opaque) to face (a pale see-through tint); v = resting to flashing white. */
function paintShardLut(): HTMLCanvasElement | null {
  const k = canvas(SHARD_LUT, SHARD_LUT); if (!k) return null;
  const g = k.g;
  const u = g.createLinearGradient(0, 0, SHARD_LUT, 0);
  u.addColorStop(0, 'rgba(255,255,255,0.98)'); u.addColorStop(0.12, 'rgba(255,255,255,0.9)'); u.addColorStop(0.3, 'rgba(214,236,255,0.42)');
  u.addColorStop(0.6, 'rgba(196,226,255,0.24)'); u.addColorStop(1, 'rgba(186,220,255,0.18)');
  g.fillStyle = u; g.fillRect(0, 0, SHARD_LUT, SHARD_LUT);
  const v = g.createLinearGradient(0, 0, 0, SHARD_LUT);
  v.addColorStop(0, 'rgba(255,255,255,0)'); v.addColorStop(0.45, 'rgba(255,255,255,0.12)'); v.addColorStop(1, 'rgba(255,255,255,0.8)');
  g.fillStyle = v; g.fillRect(0, 0, SHARD_LUT, SHARD_LUT);
  return k.c;
}

/** A splinter: a thin bright triangle with a darker long edge. */
function paintSliver(): HTMLCanvasElement | null {
  const k = canvas(SLIVER_PX, SLIVER_PX); if (!k) return null;
  const g = k.g;
  g.beginPath(); g.moveTo(2, SLIVER_PX - 5); g.lineTo(SLIVER_PX - 2, SLIVER_PX / 2 - 2); g.lineTo(7, 5); g.closePath();
  const gr = g.createLinearGradient(0, 0, SLIVER_PX, SLIVER_PX);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(190,225,255,0.7)');
  g.fillStyle = gr; g.fill();
  g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,1)'; g.stroke();
  return k.c;
}

function paintGlint(): HTMLCanvasElement | null {
  const k = canvas(GLINT_W, 8); if (!k) return null;
  const g = k.g;
  const gr = g.createLinearGradient(0, 0, GLINT_W, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.ellipse(GLINT_W / 2, 4, GLINT_W / 2, 3, 0, 0, Math.PI * 2); g.fill();
  return k.c;
}

function paintWash(): HTMLCanvasElement | null {
  const k = canvas(WASH_PX, WASH_PX); if (!k) return null;
  k.g.fillStyle = '#fff'; k.g.fillRect(0, 0, WASH_PX, WASH_PX);
  return k.c;
}

/** The energy line: a soft band of light, brightest along its middle, full length (pieces chain). */
function paintLine(): HTMLCanvasElement | null {
  const k = canvas(LINE_W, LINE_H); if (!k) return null;
  const g = k.g;
  const gr = g.createLinearGradient(0, 0, 0, LINE_H);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.28)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.28)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, LINE_W, LINE_H);
  return k.c;
}

const ghosts = new Map<string, Texture>();

/**
 * The striker's REFLECTION: its portrait art (the first loaded `img` inside the portrait element) cut to a disc whose
 * edge fades out, painted once per image source and kept. Null when there is no loaded image (headless, or the art is
 * still decoding).
 */
export function ghostTexture(el: HTMLElement | null | undefined): Texture | null {
  try {
    const img = el?.querySelector('img');
    if (!img || !img.complete || !(img.naturalWidth > 0)) return null;
    const src = img.currentSrc || img.src;
    const hit = ghosts.get(src);
    if (hit) return hit;
    const k = canvas(GHOST_PX, GHOST_PX); if (!k) return null;
    const g = k.g;
    const c = GHOST_PX / 2;
    const iw = img.naturalWidth, ih = img.naturalHeight, side = Math.min(iw, ih);
    g.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, GHOST_PX, GHOST_PX);
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createRadialGradient(c, c, c * 0.35, c, c, c);
    fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.7, 'rgba(0,0,0,0.7)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade; g.fillRect(0, 0, GHOST_PX, GHOST_PX);
    const t = tex(k.c);
    ghosts.set(src, t);
    return t;
  } catch { return null; }
}

let cached: HeroGlassTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroGlassTextures(): HeroGlassTextures | null {
  if (cached) return cached;
  const base = heroArcanaTextures();
  const crack = paintCrack(), chip = paintChip(), tear = paintTear(), lut = paintShardLut(), sliver = paintSliver(), glint = paintGlint(), wash = paintWash(), line = paintLine();
  if (!base || !crack || !chip || !tear || !lut || !sliver || !glint || !wash || !line) return null;
  cached = {
    glow: base.glow, ring: base.ring, star: base.star, spark: base.spark, streak: base.streak,
    crack: tex(crack), chip: tex(chip), tear: tex(tear), shard: tex(lut), sliver: tex(sliver), glint: tex(glint), wash: tex(wash), line: tex(line),
  };
  return cached;
}
