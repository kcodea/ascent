/**
 * PACK OPENING: the scene's display objects and textures, built ONCE per opening (spec §6, §11). Split out of
 * `packScene.ts`, which owns the state and the frame; this file is only the tree:
 *
 *   root (fits the host)
 *     pack (shakes)
 *       packGlow        the sealed pack's rarity aura (fades out as the sleeve drops; a PerspectiveMesh so it tilts)
 *       sleeveBack      the pack's back wall
 *       cardsC          the stack: cards (bottom first), the top card's glow / crossfade / shimmer / ribbon
 *       sleeveFront     the body MeshPlane, the holo, the idle sheen and the gloss (meshes on the body's grid), the
 *                       torn lip, the contact shadow
 *       strip.view      the tear strip (stripMesh.ts), with the holo over its printed front
 *       particles       the fleck pool
 *       pinch           the "pinch here" cue
 *     flipLayer         the flip's first half: the card and its ribbon as PerspectiveMeshes
 *
 *   burst (root's FIRST child, so under everything) the big-pull light burst (bigPull.ts): an additive bloom and one or
 *                     two god-ray rings, placed at the landing face's centre; only alpha / scale / rotation change
 */
import { CanvasSource, Container, Mesh, MeshGeometry, MeshPlane, PerspectiveMesh, Sprite, Texture } from 'pixi.js';
import type { PackLook } from '@game/progression';
import {
  ANCIENT_GLOW_STOPS, PACK_GEOM, TEX_RES, type BackArt, paintArtSlice, paintBlob, paintBody, paintCardFlash, paintCardGlow,
  paintFleck, paintGlossBand, paintPackGlow, paintPinchRing, paintPlainBack, paintRibbon, paintShade,
  paintSheen, paintSpec, paintStrip, paintStripBack, paintStripInside, rarityTint, paintBurstBloom, paintBurstRays,
} from './packTextures';
import { BURST } from './bigPull';
import { packArtFor, packShineFor } from './packArt';
import { packGlowRarity } from './packGlow';
import { packHoloHue, packHoloStrength } from './packHolo';
import { makeHoloMaterial, makeHoloMesh, type HoloMesh, type HoloUniformValues } from './packHoloMesh';
import { CARD_BACK_LOGO_SRC, CARD_BACK_PLATE_SRC, CARD_WINDOW_MASK_SRC } from './packRarity';
import { StripMesh, TornLip } from './stripMesh';

const { W, H, BODY_H, CARD_W, CARD_H } = PACK_GEOM;

/** The stack's resting centre (inside the sleeve, its top showing at the opening). */
export const CARDS_Y = H * 0.42 + CARD_H / 2;
/** The guaranteed ribbon's centre below the card's centre (the same fraction of the card's height at any CARD_H). */
export const RIBBON_DY = Math.round(CARD_H * (108 / 370));
/** The ribbon's half size on the card (base units). */
export const RIBBON_HW = (CARD_W * 0.92) / 2, RIBBON_HH = 19;
/** The back wall's inset from the pack's sides and bottom (base units). */
const BACK_INSET = 6;
/** Pooled foil flecks. */
const FLECKS = 48;

export interface SceneTextures {
  /** The one card back (the neutral reveal frame): every card wears it. */
  plain: Texture;
  /** The card glow: white (tinted per rarity) and Ancient's pre-coloured aurora. */
  glowWhite: Texture;
  glowAncient: Texture;
  /** The big-pull god-ray rings, one painted per tier's ray count (white; tinted at the burst). */
  burstRays: { legendary: Texture; ancient: Texture };
}

/** Every display object, built once at init. */
export interface Views {
  root: Container;
  pack: Container;
  /** The sealed pack's aura (tinted, or Ancient's aurora); the scene breathes its alpha only. */
  packGlow: PerspectiveMesh;
  /** The aura's half size in base units at tier size 1 (its painted halo included). */
  packGlowHalf: { w: number; h: number };
  /** The back wall: the pack's inside across the strip's band, the dark wall below it. */
  sleeveBack: Container;
  /** The pack's inside behind the strip (packTextures.ts paintStripInside): fades out as the torn strip flies off. */
  lining: Sprite;
  /** The dark wall behind the stack: a mesh on the body's grid, inset (`wallInto`), so it squeezes with the sleeve. */
  wall: Mesh;
  cardsC: Container;
  cards: Sprite[];
  glow: Sprite;
  fade: Sprite;
  flash: Sprite;
  ribbon: Sprite;
  sleeveFront: Container;
  body: MeshPlane;
  bodyBase: Float32Array;
  /** The idle sheen: a mesh on the body's grid (it follows the deform and the tilt). */
  sheen: Mesh;
  /** The clear-coat gloss: the band texture on the body's grid; its uvs place the band (packTilt.ts). */
  gloss: Mesh;
  lip: TornLip;
  shadow: Sprite;
  strip: StripMesh;
  particles: Container;
  flecks: FleckPool;
  /** The logo again, over the top card's sheen (its texture arrives after init: `Texture.EMPTY` until then). */
  backLogo: Sprite;
  pinch: Sprite;
  flipLayer: Container;
  flipper: PerspectiveMesh;
  flipRibbon: PerspectiveMesh;
  /** The big-pull burst (hidden until a Legendary / Ancient flip hands off). */
  burst: Container;
  burstBloom: Sprite;
  burstRays: Sprite;
  /** Ancient's second ray ring (its other tone, spinning the other way). */
  burstRays2: Sprite;
  /** The holo sheen (packHoloMesh.ts), or null (Common / Rare packs, packs without wrapper art). */
  holo: HoloViews | null;
}

/** The pack's holo: one mesh on the body's grid, one over the strip's front, sharing one material. */
export interface HoloViews {
  body: HoloMesh;
  strip: HoloMesh;
  uniforms: HoloUniformValues;
  /** The shine mask has loaded (until then the holo never shows). */
  ready: boolean;
}

const fromCanvas = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/**
 * The back wall's vertices from the body's (`src`, the body's positions before any tilt, texture px): pulled in toward
 * the centre line and up from the bottom by the inset, so the wrapper's see-through crimped edges never show it, and it
 * follows whatever shape the body takes. Writes `out`, returns it.
 */
export function wallInto(out: Float32Array, src: ArrayLike<number>): Float32Array {
  const half = (W * TEX_RES) / 2;
  const sx = (W - BACK_INSET * 2) / W, sy = (BODY_H - BACK_INSET) / BODY_H;
  for (let k = 0; k < out.length; k += 2) {
    out[k] = half + (src[k]! - half) * sx;
    out[k + 1] = src[k + 1]! * sy;
  }
  return out;
}

/** A mesh on the body's grid (the same vertices and triangles) with its own uvs and texture. */
function bodyGridMesh(body: MeshPlane, base: Float32Array, uvs: Float32Array, texture: Texture): Mesh {
  const geometry = new MeshGeometry({
    positions: Float32Array.from(base), uvs, indices: Uint32Array.from(body.geometry.indices),
  });
  const m = new Mesh({ geometry, texture });
  m.scale.set(1 / TEX_RES);
  m.y = PACK_GEOM.H;
  return m;
}

/**
 * The back art that arrives after the scene is up (never blocks init): the gold card plate (the plain back's frame), each
 * rarity's own plate and medallion. Each back paints a fallback first (a gold frame, the gems); when an image decodes, every back that
 * uses it is repainted in place once and its texture re-uploaded. A texture destroyed in the meantime (teardown) is left
 * alone. No image support or a failed load keeps the fallback.
 */
interface BackSlot { canvas: HTMLCanvasElement; tex: Texture; art: BackArt; paint: (art: BackArt, into: HTMLCanvasElement) => void }

function loadImage(src: string, onLoad: (img: HTMLImageElement) => void): void {
  if (typeof Image === 'undefined') return;
  const img = new Image();
  img.onload = () => onLoad(img);
  img.src = src;
}

function repaint(b: BackSlot): void {
  if (b.tex.destroyed) return;
  try {
    b.paint(b.art, b.canvas);
    b.tex.source.update();
  } catch { /* keep what is painted */ }
}

/**
 * Paint every texture and build the tree for a pack of `n` cards. `own` receives every texture made (the caller
 * destroys them on teardown). Not yet added to a stage.
 */
export function buildPackViews(look: PackLook, n: number, own: (t: Texture) => void): { views: Views; tex: SceneTextures } {
  const keep = (c: HTMLCanvasElement): Texture => { const t = fromCanvas(c); own(t); return t; };
  const backs: BackSlot[] = [];
  const back = (paint: BackSlot['paint']): BackSlot => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(PACK_GEOM.CARD_W * TEX_RES);
    canvas.height = Math.round(PACK_GEOM.CARD_H * TEX_RES);
    const art: BackArt = {};
    paint(art, canvas);
    const slot: BackSlot = { canvas, tex: keep(canvas), art, paint };
    backs.push(slot);
    return slot;
  };
  // one back for every card: the neutral reveal frame, so no edge ever tells a rarity (packRarity.ts CARD_BACK_PLATE_SRC)
  const plain = back((art, into) => { paintPlainBack(look, art, into); });
  loadImage(CARD_BACK_PLATE_SRC, (img) => { plain.art.plate = img; repaint(plain); });
  loadImage(CARD_WINDOW_MASK_SRC, (img) => { plain.art.window = img; repaint(plain); });
  // the logo is painted on the back, and also drawn again OVER the top card's sheen and sparkles (owner 2026-11-25:
  // "put the logo over the sheen and sparkles"); the scene poses this copy on the top card
  const backLogo = new Sprite(Texture.EMPTY);
  backLogo.anchor.set(0.5);
  backLogo.visible = false;
  loadImage(CARD_BACK_LOGO_SRC, (img) => {
    plain.art.icon = img; repaint(plain);
    if (plain.tex.destroyed) return;
    try { const t = Texture.from(img); own(t); backLogo.texture = t; } catch { /* the painted logo alone */ }
  });
  const glowWhite = keep(paintCardGlow());
  const glowAncient = keep(paintCardGlow(ANCIENT_GLOW_STOPS));
  const burstRaysTex = { legendary: keep(paintBurstRays(BURST.legendary.rays)), ancient: keep(paintBurstRays(BURST.ancient.rays)) };
  const tex: SceneTextures = { plain: plain.tex, glowWhite, glowAncient, burstRays: burstRaysTex };

  const root = new Container();
  const pack = new Container();
  root.addChild(pack);

  // THE SLEEVE: its back wall and its front (body mesh + torn lip) slide together; the stack sits between them.
  // THE PACK'S AURA: one texture painted for this pack's rarity (white + tint, or Ancient's aurora), centred on the pack.
  const packRarity = packGlowRarity(look);
  const packGlowTex = keep(paintPackGlow(packRarity === 'ancient' ? ANCIENT_GLOW_STOPS : undefined));
  const packGlow = new PerspectiveMesh({ texture: packGlowTex, verticesX: 8, verticesY: 8 });
  const packGlowHalf = { w: packGlowTex.width / TEX_RES / 2, h: packGlowTex.height / TEX_RES / 2 };
  {
    const cx = W / 2, cy = (H + BODY_H) / 2, hw = packGlowHalf.w, hh = packGlowHalf.h;
    packGlow.setCorners(cx - hw, cy - hh, cx + hw, cy - hh, cx + hw, cy + hh, cx - hw, cy + hh);
  }
  packGlow.tint = packRarity === 'ancient' ? 0xffffff : rarityTint(packRarity);
  packGlow.alpha = 0;
  // inset a little: the wrapper art's crimped edges are see-through, and the back wall must not show through them
  const sleeveBack = new Container();
  const cardsC = new Container();
  cardsC.position.set(W / 2, CARDS_Y);
  const cards: Sprite[] = [];
  for (let i = 0; i < n; i++) {
    const s = new Sprite(tex.plain);
    s.anchor.set(0.5);
    s.width = CARD_W; s.height = CARD_H;
    s.x = cardRestX(i); s.y = cardRestY(i);
    cards.push(s);
  }
  for (let i = n - 1; i >= 0; i--) cardsC.addChild(cards[i]!);
  const glow = new Sprite(glowWhite);
  glow.anchor.set(0.5); glow.scale.set(1 / TEX_RES); glow.visible = false;
  const fade = new Sprite(tex.plain);
  fade.anchor.set(0.5); fade.width = CARD_W; fade.height = CARD_H; fade.visible = false;
  const flash = new Sprite(keep(paintCardFlash()));
  flash.anchor.set(0.5); flash.scale.set(1 / TEX_RES); flash.blendMode = 'add'; flash.visible = false;
  const ribbonTex = keep(paintRibbon(look.guaranteedFloor));
  const ribbon = new Sprite(ribbonTex);
  ribbon.anchor.set(0.5); ribbon.scale.set(1 / TEX_RES); ribbon.visible = false;
  cardsC.addChild(glow, fade, flash, ribbon);

  const bodyCanvas = paintBody(look, n);
  const bodyTex = keep(bodyCanvas);
  const body = new MeshPlane({ texture: bodyTex, verticesX: 12, verticesY: 20 });
  body.scale.set(1 / TEX_RES);
  body.y = H;
  const bodyBase = Float32Array.from(body.geometry.positions);
  const sheen = bodyGridMesh(body, bodyBase, Float32Array.from(body.geometry.uvs), keep(paintSheen()));
  sheen.blendMode = 'add';
  // THE GLOSS: one pre-drawn band, placed by its uvs each frame it moves (no filter, no redraw).
  const uv0 = new Float32Array(bodyBase.length);
  for (let k = 0; k < uv0.length; k += 2) { uv0[k] = -1; uv0[k + 1] = 0.5; } // off the band until placed
  const gloss = bodyGridMesh(body, bodyBase, uv0, keep(paintGlossBand()));
  gloss.blendMode = 'add';
  gloss.alpha = 0;
  // the dark wall: the body's own grid, pulled in a little (wallInto), so the sleeve's squeeze and trailing rim never
  // leave a rigid rectangle showing past the wrapper
  const wall = bodyGridMesh(body, wallInto(new Float32Array(bodyBase.length), bodyBase), new Float32Array(bodyBase.length), Texture.WHITE);
  wall.tint = 0x0c0a12;
  sleeveBack.addChild(wall);
  const lip = new TornLip();
  const shadow = new Sprite(keep(paintBlob()));
  shadow.anchor.set(0.5); shadow.alpha = 0;
  const sleeveFront = new Container();
  sleeveFront.addChild(body, sheen, gloss, lip.view, shadow);

  const stripCanvas = paintStrip(look);
  const stripTex = keep(stripCanvas);
  // THE PACK'S INSIDE behind the strip: the strip's own silhouette in shaded inner foil, so the peel never opens a
  // see-through band (and never a flat block: it has the wrapper's exact outline, crimped teeth included)
  const liningCanvas = paintStripInside(stripCanvas);
  const liningTex = keep(liningCanvas);
  const lining = new Sprite(liningTex);
  lining.width = W; lining.height = H;
  sleeveBack.addChildAt(lining, 0);
  const strip = new StripMesh({
    front: stripTex, back: keep(paintStripBack()), shade: keep(paintShade()), spec: keep(paintSpec()),
  });
  // THE WRAPPER ART (packArt.ts): the placeholder shows first, then the art repaints both canvases in place, the strip
  // from the art above its tear line, the body the rest. Never blocks init; a load after teardown touches nothing. The
  // geometry is the same either way, so a swap mid-tear moves nothing.
  const artSrc = packArtFor(look);
  if (artSrc) {
    loadImage(artSrc, (img) => {
      if (stripTex.destroyed || bodyTex.destroyed) return;
      try {
        paintArtSlice(img, stripCanvas, 0, H);
        paintArtSlice(img, bodyCanvas, H, BODY_H);
        stripTex.source.update();
        bodyTex.source.update();
        if (!liningTex.destroyed) { paintStripInside(stripCanvas, liningCanvas); liningTex.source.update(); } // the art's outline
      } catch { /* keep the placeholder */ }
    });
  }
  const holo = buildHolo(look, body, bodyBase, strip, sleeveFront, keep);
  const particles = new Container();
  const flecks = new FleckPool(particles, keep(paintFleck()));
  flecks.setTint(packRarity === 'ancient' ? 0x6ff3e6 : rarityTint(packRarity));
  const pinch = new Sprite(keep(paintPinchRing()));
  pinch.anchor.set(0.5); pinch.scale.set(0.55); pinch.blendMode = 'add';
  pack.addChild(packGlow, sleeveBack, cardsC, sleeveFront, strip.view, particles, pinch);

  const flipLayer = new Container();
  const flipper = new PerspectiveMesh({ texture: tex.plain, verticesX: 12, verticesY: 12 });
  flipper.visible = false;
  const flipRibbon = new PerspectiveMesh({ texture: ribbonTex, verticesX: 6, verticesY: 2 });
  flipRibbon.visible = false;
  flipLayer.addChild(flipper, flipRibbon);
  root.addChild(flipLayer);

  // THE BIG-PULL BURST: under everything (the DOM face lands over the canvas, so it reads as behind the card).
  const burst = new Container();
  burst.visible = false;
  const addSprite = (t: Texture): Sprite => {
    const s = new Sprite(t);
    s.anchor.set(0.5);
    s.blendMode = 'add';
    return s;
  };
  const burstBloom = addSprite(keep(paintBurstBloom()));
  const burstRays = addSprite(burstRaysTex.legendary);
  const burstRays2 = addSprite(burstRaysTex.legendary);
  burst.addChild(burstBloom, burstRays, burstRays2);
  root.addChildAt(burst, 0);

  const views: Views = {
    root, pack, packGlow, packGlowHalf, sleeveBack, lining, wall, cardsC, cards, glow, fade, flash, ribbon, sleeveFront, body, bodyBase, sheen,
    gloss, lip, shadow,
    strip, particles, flecks, backLogo, pinch, flipLayer, flipper, flipRibbon, burst, burstBloom, burstRays, burstRays2, holo,
  };
  return { views, tex };
}

/**
 * THE HOLO (packHolo.ts, packHoloMesh.ts): for a pack whose tier carries one and whose wrapper has a shine mask. The
 * mask paints into a canvas texture when it loads (black, so no holo, until then); `ready` flips then. One mesh on the
 * body's grid (just over the body, under the sheen and the gloss; its uvs map the body onto the mask below the tear
 * line), one over the strip's front. A load after teardown touches nothing.
 */
function buildHolo(
  look: PackLook, body: MeshPlane, bodyBase: Float32Array, strip: StripMesh, sleeveFront: Container,
  keep: (c: HTMLCanvasElement) => Texture,
): HoloViews | null {
  const src = packShineFor(look);
  const tier = packHoloStrength(look, 1);
  if (!src || !(tier > 0) || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H + BODY_H; // the mask's own size (half the wrapper)
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const maskTex = keep(canvas);
  const material = makeHoloMaterial(maskTex, packHoloHue(look));
  const bu = body.geometry.uvs;
  const uv = new Float32Array(bu.length);
  const top = H / (H + BODY_H), span = BODY_H / (H + BODY_H);
  for (let k = 0; k < bu.length; k += 2) { uv[k] = bu[k]!; uv[k + 1] = top + bu[k + 1]! * span; }
  const bodyHolo = makeHoloMesh(material, Float32Array.from(bodyBase), uv, Uint32Array.from(body.geometry.indices));
  bodyHolo.scale.set(1 / TEX_RES);
  bodyHolo.y = H;
  sleeveFront.addChildAt(bodyHolo, 1);
  const stripHolo = strip.attachHolo(material);
  const views: HoloViews = { body: bodyHolo, strip: stripHolo, uniforms: material.uniforms, ready: false };
  loadImage(src, (img) => {
    if (maskTex.destroyed) return;
    try {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      maskTex.source.update();
      views.ready = true;
    } catch { /* no holo */ }
  });
  return views;
}

/** Card `i`'s resting place in the stack (the pile's top card is moved by the pointer and put back here). */
export const cardRestX = (i: number): number => (i % 2 ? 1 : -1) * i * 0.9;
export const cardRestY = (i: number): number => i * 2.4;

/**
 * The tear's SPARKS (owner 2026-11-24: the confetti was "a 3/10 ... glowing sparks emit and float up instead"): a fixed
 * pool of additive glow sprites (no allocation when the tear sheds them). A spark leaves the torn edge, rises on its
 * own heat (it is lighter than air: it slows sideways, speeds up), wanders, twinkles, shrinks and dies. Tinted in the
 * pack's colour or white-hot.
 */
export class FleckPool {
  /** Live sparks. */
  count = 0;
  private readonly sprites: Sprite[] = [];
  private readonly vx = new Float32Array(FLECKS);
  private readonly vy = new Float32Array(FLECKS);
  private readonly ph = new Float32Array(FLECKS);
  private readonly size = new Float32Array(FLECKS);
  private readonly life = new Float32Array(FLECKS);
  private readonly span = new Float32Array(FLECKS);
  private tint = 0xffffff;

  constructor(parent: Container, tex: Texture) {
    for (let k = 0; k < FLECKS; k++) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.blendMode = 'add';
      s.visible = false;
      this.sprites.push(s);
      parent.addChild(s);
    }
  }

  /** The pack's colour (the sparks are this, or white-hot). */
  setTint(tint: number): void { this.tint = tint; }

  /** Shed up to `n` sparks at (x, y); a full pool drops the rest. */
  spawn(n: number, x: number, y: number): void {
    for (let k = 0; k < FLECKS && n > 0; k++) {
      if (this.life[k] > 0) continue;
      const s = this.sprites[k];
      s.visible = true;
      s.tint = Math.random() < 0.6 ? this.tint : 0xffffff;
      s.x = x + (Math.random() - 0.5) * 10;
      s.y = y + (Math.random() - 0.5) * 5;
      s.alpha = 1;
      this.size[k] = 0.22 + Math.random() * 0.5;
      s.scale.set(this.size[k]);
      this.vx[k] = (Math.random() - 0.4) * 2.6;
      this.vy[k] = -Math.random() * 2.2 - 0.5;
      this.ph[k] = Math.random() * 6.28;
      this.span[k] = 60 + Math.random() * 80;
      this.life[k] = this.span[k];
      this.count++;
      n--;
    }
  }

  /** One frame: rise, wander, twinkle, shrink, fade. */
  step(dt: number): void {
    if (this.count === 0) return;
    const drag = Math.pow(0.965, dt);
    for (let k = 0; k < FLECKS; k++) {
      if (this.life[k] <= 0) continue;
      const s = this.sprites[k];
      const life = this.life[k] - dt;
      this.life[k] = life;
      if (life <= 0) { s.visible = false; this.count--; continue; }
      const age = 1 - life / this.span[k];
      this.vx[k] *= drag;
      this.vy[k] = this.vy[k] * drag - 0.028 * dt; // buoyant: it keeps rising
      s.x += (this.vx[k] + Math.sin(life * 0.07 + this.ph[k]) * 0.35) * dt;
      s.y += this.vy[k] * dt;
      s.alpha = Math.min(1, life / 26) * (0.62 + 0.38 * Math.sin(life * 0.42 + this.ph[k]));
      s.scale.set(this.size[k] * (1 - 0.55 * age));
    }
  }

  clear(): void {
    for (let k = 0; k < FLECKS; k++) { this.life[k] = 0; this.sprites[k].visible = false; }
    this.count = 0;
  }
}
