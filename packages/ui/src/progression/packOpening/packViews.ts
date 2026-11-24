/**
 * PACK OPENING: the scene's display objects and textures, built ONCE per opening (spec §6, §11). Split out of
 * `packScene.ts`, which owns the state and the frame; this file is only the tree:
 *
 *   root (fits the host)
 *     pack (shakes)
 *       sleeveBack      the pack's back wall
 *       cardsC          the stack: cards (bottom first), the top card's glow / crossfade / shimmer / ribbon
 *       sleeveFront     the body MeshPlane, the idle sheen, the torn lip, the contact shadow
 *       strip.view      the tear strip (stripMesh.ts)
 *       particles       the fleck pool
 *       pinch           the "pinch here" cue
 *     flipLayer         the flip's first half: the card and its ribbon as PerspectiveMeshes
 */
import { CanvasSource, Container, Graphics, MeshPlane, PerspectiveMesh, Sprite, Texture } from 'pixi.js';
import { COSMETIC_RARITIES, type CrateRarity, type PackLook } from '@game/progression';
import {
  PACK_GEOM, TEX_RES, type BackArt, paintBlob, paintBody, paintCardFlash, paintCardGlow, paintFleck, paintPinchRing,
  paintPlainBack, paintRarityBack, paintRibbon, paintShade, paintSheen, paintSpec, paintStrip, paintStripBack,
} from './packTextures';
import { CARD_PLATE_SRC, rarityIconSrc } from './packRarity';
import { StripMesh, TornLip } from './stripMesh';

const { W, H, BODY_H, CARD_W, CARD_H } = PACK_GEOM;

/** The stack's resting centre (inside the sleeve, its top showing at the opening). */
export const CARDS_Y = H * 0.42 + CARD_H / 2;
/** The guaranteed ribbon's centre below the card's centre (the same fraction of the card's height at any CARD_H). */
export const RIBBON_DY = Math.round(CARD_H * (108 / 370));
/** The ribbon's half size on the card (base units). */
export const RIBBON_HW = (CARD_W * 0.92) / 2, RIBBON_HH = 19;
/** Pooled foil flecks. */
const FLECKS = 48;

export interface SceneTextures {
  plain: Texture;
  rarity: Record<CrateRarity, Texture>;
}

/** Every display object, built once at init. */
export interface Views {
  root: Container;
  pack: Container;
  sleeveBack: Graphics;
  cardsC: Container;
  cards: Sprite[];
  glow: Sprite;
  fade: Sprite;
  flash: Sprite;
  ribbon: Sprite;
  sleeveFront: Container;
  body: MeshPlane;
  bodyBase: Float32Array;
  sheen: Sprite;
  lip: TornLip;
  shadow: Sprite;
  strip: StripMesh;
  particles: Container;
  flecks: FleckPool;
  pinch: Sprite;
  flipLayer: Container;
  flipper: PerspectiveMesh;
  flipRibbon: PerspectiveMesh;
}

const fromCanvas = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/**
 * The back art that arrives after the scene is up (never blocks init): the card plate (every back's frame) and each
 * rarity's medallion. Each back paints a fallback first (a gold frame, the gems); when an image decodes, every back that
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
  const rarity = {} as Record<CrateRarity, Texture>;
  for (const r of COSMETIC_RARITIES) {
    const slot = back((art, into) => { paintRarityBack(r, art, into); });
    rarity[r] = slot.tex;
    loadImage(rarityIconSrc(r), (img) => { slot.art.icon = img; repaint(slot); });
  }
  const plain = back((art, into) => { paintPlainBack(look, art, into); });
  loadImage(CARD_PLATE_SRC, (img) => { for (const b of backs) { b.art.plate = img; repaint(b); } });
  const tex: SceneTextures = { plain: plain.tex, rarity };

  const root = new Container();
  const pack = new Container();
  root.addChild(pack);

  // THE SLEEVE: its back wall and its front (body mesh + torn lip) slide together; the stack sits between them.
  const sleeveBack = new Graphics().rect(0, H * 0.3, W, BODY_H + H * 0.7).fill('#0c0a12');
  const cardsC = new Container();
  cardsC.position.set(W / 2, CARDS_Y);
  const cards: Sprite[] = [];
  for (let i = 0; i < n; i++) {
    const s = new Sprite(tex.plain);
    s.anchor.set(0.5);
    s.width = CARD_W; s.height = CARD_H;
    s.x = (i % 2 ? 1 : -1) * i * 0.9; s.y = i * 2.4;
    cards.push(s);
  }
  for (let i = n - 1; i >= 0; i--) cardsC.addChild(cards[i]!);
  const glow = new Sprite(keep(paintCardGlow()));
  glow.anchor.set(0.5); glow.scale.set(1 / TEX_RES); glow.visible = false;
  const fade = new Sprite(tex.plain);
  fade.anchor.set(0.5); fade.width = CARD_W; fade.height = CARD_H; fade.visible = false;
  const flash = new Sprite(keep(paintCardFlash()));
  flash.anchor.set(0.5); flash.scale.set(1 / TEX_RES); flash.blendMode = 'add'; flash.visible = false;
  const ribbonTex = keep(paintRibbon(look.guaranteedFloor));
  const ribbon = new Sprite(ribbonTex);
  ribbon.anchor.set(0.5); ribbon.scale.set(1 / TEX_RES); ribbon.visible = false;
  cardsC.addChild(glow, fade, flash, ribbon);

  const body = new MeshPlane({ texture: keep(paintBody(look, n)), verticesX: 12, verticesY: 20 });
  body.scale.set(1 / TEX_RES);
  body.y = H;
  const bodyBase = Float32Array.from(body.geometry.positions);
  const sheen = new Sprite(keep(paintSheen()));
  sheen.scale.set(1 / TEX_RES); sheen.y = H; sheen.blendMode = 'add';
  const lip = new TornLip();
  const shadow = new Sprite(keep(paintBlob()));
  shadow.anchor.set(0.5); shadow.alpha = 0;
  const sleeveFront = new Container();
  sleeveFront.addChild(body, sheen, lip.view, shadow);

  const strip = new StripMesh({
    front: keep(paintStrip(look)), back: keep(paintStripBack()), shade: keep(paintShade()), spec: keep(paintSpec()),
  });
  const particles = new Container();
  const flecks = new FleckPool(particles, keep(paintFleck()));
  const pinch = new Sprite(keep(paintPinchRing()));
  pinch.anchor.set(0.5); pinch.scale.set(0.55); pinch.blendMode = 'add';
  pack.addChild(sleeveBack, cardsC, sleeveFront, strip.view, particles, pinch);

  const flipLayer = new Container();
  const flipper = new PerspectiveMesh({ texture: tex.plain, verticesX: 12, verticesY: 12 });
  flipper.visible = false;
  const flipRibbon = new PerspectiveMesh({ texture: ribbonTex, verticesX: 6, verticesY: 2 });
  flipRibbon.visible = false;
  flipLayer.addChild(flipper, flipRibbon);
  root.addChild(flipLayer);

  const views: Views = {
    root, pack, sleeveBack, cardsC, cards, glow, fade, flash, ribbon, sleeveFront, body, bodyBase, sheen, lip, shadow,
    strip, particles, flecks, pinch, flipLayer, flipper, flipRibbon,
  };
  return { views, tex };
}

/** The torn foil's flecks: a fixed pool of sprites (no allocation when the tear sheds them). */
export class FleckPool {
  /** Live flecks. */
  count = 0;
  private readonly sprites: Sprite[] = [];
  private readonly vx = new Float32Array(FLECKS);
  private readonly vy = new Float32Array(FLECKS);
  private readonly vr = new Float32Array(FLECKS);
  private readonly life = new Float32Array(FLECKS);

  constructor(parent: Container, tex: Texture) {
    for (let k = 0; k < FLECKS; k++) {
      const s = new Sprite(tex);
      s.anchor.set(0.5);
      s.visible = false;
      this.sprites.push(s);
      parent.addChild(s);
    }
  }

  /** Shed up to `n` flecks at (x, y); a full pool drops the rest. */
  spawn(n: number, x: number, y: number): void {
    for (let k = 0; k < FLECKS && n > 0; k++) {
      if (this.life[k] > 0) continue;
      const s = this.sprites[k];
      s.visible = true;
      s.tint = Math.random() < 0.5 ? 0xdfe6f5 : 0x6f8cc4;
      s.x = x + (Math.random() - 0.5) * 6;
      s.y = y + (Math.random() - 0.5) * 4;
      s.rotation = 0;
      s.alpha = 1;
      s.scale.set(0.5 + Math.random() * 0.9);
      this.vx[k] = (Math.random() - 0.3) * 2.4;
      this.vy[k] = -Math.random() * 2.6 - 0.4;
      this.vr[k] = (Math.random() - 0.5) * 0.4;
      this.life[k] = 40 + Math.random() * 30;
      this.count++;
      n--;
    }
  }

  /** One frame: drift, fall, spin, fade. */
  step(dt: number): void {
    if (this.count === 0) return;
    for (let k = 0; k < FLECKS; k++) {
      if (this.life[k] <= 0) continue;
      const s = this.sprites[k];
      s.x += this.vx[k] * dt; s.y += this.vy[k] * dt;
      this.vy[k] += 0.14 * dt;
      s.rotation += this.vr[k] * dt;
      const life = this.life[k] - dt;
      this.life[k] = life;
      s.alpha = Math.min(1, life / 20);
      if (life <= 0) { s.visible = false; this.count--; }
    }
  }

  clear(): void {
    for (let k = 0; k < FLECKS; k++) { this.life[k] = 0; this.sprites[k].visible = false; }
    this.count = 0;
  }
}
