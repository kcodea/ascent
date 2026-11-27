/**
 * THE SHOP'S DRESSING (owner 2026-11-25: "use more visuals where possible ... a cohesive and smooth experience"). What
 * makes the stage a SHOP instead of packs floating in the dark: a paper price tag tied to every pack, and the soft
 * light the hand rests in. (A counter slab, a plinth, contact shadows and placards stood here for earlier passes; the
 * owner removed them on 2026-11-25.)
 *
 * Everything here is painted once into a canvas (no per-frame drawing); the scene only moves, scales and fades the
 * sprites. No Pixi ticker, no DOM beyond off-screen canvases.
 */
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';

const canvasOf = (w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D | null } => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d') };
};


/** The light the hand rests in: a wide, soft pool. */
export function paintTray(): HTMLCanvasElement {
  const W = 512, H = 192;
  const { c, g } = canvasOf(W, H);
  if (!g) return c;
  const gr = g.createRadialGradient(W / 2, H * 0.62, 6, W / 2, H * 0.62, W / 2);
  gr.addColorStop(0, 'rgba(120,150,255,0.26)');
  gr.addColorStop(0.5, 'rgba(90,110,220,0.10)');
  gr.addColorStop(1, 'rgba(90,110,220,0)');
  g.fillStyle = gr;
  g.save(); g.translate(W / 2, H * 0.62); g.scale(1, 0.42); g.translate(-W / 2, -H * 0.62);
  g.fillRect(0, -H * 2, W, H * 5);
  g.restore();
  return c;
}

/** The shadow a pack lying on the counter casts: a soft dark slab, stretched under each pack. */
export function paintPackShadow(): HTMLCanvasElement {
  const W = 128, H = 128;
  const { c, g } = canvasOf(W, H);
  if (!g) return c;
  g.filter = 'blur(3.5px)'; // owner 2026-11-27: "make the shadow much tighter now" (it was 8px, and 12px before the realism pass)
  g.fillStyle = 'rgba(20,9,3,0.95)';
  g.beginPath(); g.roundRect(26, 26, W - 52, H - 52, 8); g.fill();
  return c;
}

/** A pack's GLOW: a white slab with a wide soft edge (the same layout as the contact shadow's), tinted and added by the scene. */
export function paintPackGlow(): HTMLCanvasElement {
  const W = 128, H = 128;
  const { c, g } = canvasOf(W, H);
  if (!g) return c;
  g.filter = 'blur(9px)';
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath(); g.roundRect(22, 22, W - 44, H - 44, 6); g.fill();
  return c;
}

/** A pack's CONTACT shadow: a dark slab with a tight soft edge (the middle 76 of 128 px: `shelfPack.ts SHADOW_SLAB`). */
export function paintContactShadow(): HTMLCanvasElement {
  const W = 128, H = 128;
  const { c, g } = canvasOf(W, H);
  if (!g) return c;
  g.filter = 'blur(2px)';
  g.fillStyle = 'rgba(16,7,3,1)';
  g.beginPath(); g.roundRect(26, 26, W - 52, H - 52, 3); g.fill();
  return c;
}

export type PlacardKind = 'price' | 'free' | 'sold';

/** The ribbon chip's words for an offer's badge (null: no chip). "Free" has none: the placard already says it. */
export function placardBadge(badge: 'new' | 'free' | 'featured' | undefined): string | null {
  return badge === 'new' ? 'New' : badge === 'featured' ? 'Featured' : null;
}

/** A box's count beside its price ("x10"); empty for a single pack. */
export function placardCount(contains: number): string {
  return contains > 1 ? `x${contains}` : '';
}

/** The label's colours on the tag: New is mint, Featured is the shop's gold. */
const CHIP = {
  New: { fill: 0x1f6b57, rim: 0x8dffd8, text: 0xd9fff2 },
  Featured: { fill: 0x6b4a12, rim: 0xffd27a, text: 0xfff1d0 },
} as const;
const CHIP_FONT = 19;
const CHIP_H = 26;

/** The tag's paper, edge, inks, twine and the hole's brass ring. */
const PAPER = 0xf4e6c2, EDGE = 0x8a6a36, INK = 0x3a2412, INK_FREE = 0x1f6b3a, INK_SOLD = 0xa12a1a, INK_COUNT = 0x7a5a1c;
const TWINE = 0xd8c08a, RING = 0xc79a45;
/** The tag's own units (the scene scales the whole view): the twine's length, the price's size, the gem's. */
const TAG_CORD = 40;
const TAG_FONT_PX = 34, TAG_GEM = 40, TAG_H = 74, TAG_CUT = 20, TAG_HOLE = 6.5;

/**
 * THE PAINTED TAG (owner 2026-11-25: "use this for the tag"): a parchment tag with a gold rim, a brass eyelet and a
 * loop of rope, levelled and trimmed from the owner's art. The numbers are the art's own px: the rope's knot (the
 * view's origin), the tag body's height, the parchment's centre (where the price is centred, both ways: owner
 * 2026-11-25, "the numbers aren't centered horizontally or vertically on the tag") and how wide the parchment inside
 * the rim is.
 */
export const SHOP_TAG_SRC = `${import.meta.env.BASE_URL}packs/shop-tag.webp`;
export const TAG_ART = { w: 512, h: 349, knotX: 265.5, bodyH: 228, textX: 256, textY: 236, innerW: 420 } as const;
/**
 * THE GROMMET (owner 2026-11-25: "the grommet to place where the string meets the card pack"): a brass eyelet set in
 * the pack where the rope is tied, under the rope's knot. `size` is its diameter and `y` its centre below the knot's
 * top, in the tag's own units; `hole` is the hole's share of that diameter (dark: the pack is punched through).
 */
export const SHOP_GROMMET_SRC = `${import.meta.env.BASE_URL}packs/shop-grommet.webp`;
const GROMMET = { size: 27, y: 6, hole: 0.47 } as const;
/** The painted tag's body height in the tag's own units (the drawn tag's is TAG_H), and the room left beside the price. */
const TAG_ART_H = 88, TAG_ART_PAD = 18;

/** The painted tag's scale for a price `content` units wide: its resting size, larger only when the price needs the room. */
export function tagArtScale(content: number): number {
  const s0 = TAG_ART_H / TAG_ART.bodyH;
  return s0 * Math.max(1, (content + TAG_ART_PAD) / (TAG_ART.innerW * s0));
}

/**
 * A PRICE TAG ON A STRING (owner 2026-11-25: "can we make it look more like a price tag? like a tag attached with
 * string?", then "have the tag persistent and incorporate these pills in it ... hanging off the top left of the pack").
 * A paper tag with clipped shoulders and a punched, ringed hole, hanging from a loop of twine. It carries the price with
 * the Aether gem (or "Free" / "Sold out"), a box's count beside it ("x10"), and a New / Featured label on its foot.
 *
 * `view`'s origin is the KNOT (where the twine is tied to the pack): rotate the view to swing the tag. Everything is
 * redrawn only when what it shows changes. Until the painted tag (`setArt`) has loaded, a drawn paper tag stands in.
 */
export class Placard {
  readonly view = new Container();
  private readonly paper = new Graphics();
  private readonly art = new Sprite(Texture.EMPTY);
  private readonly grommet = new Sprite(Texture.EMPTY);
  private readonly grommetHole = new Graphics();
  private readonly icon: Sprite;
  private readonly text: Text;
  private readonly count: Text;
  private readonly chip = new Container();
  private readonly chipPlate = new Graphics();
  private readonly chipText: Text;
  private key = '';

  constructor(gem: Texture, font: string) {
    this.icon = new Sprite(gem);
    this.icon.anchor.set(0.5);
    this.text = new Text({ text: '', style: { fontFamily: font, fontSize: TAG_FONT_PX, fontWeight: '800', fill: INK } });
    this.text.anchor.set(0, 0.5);
    this.count = new Text({ text: '', style: { fontFamily: font, fontSize: 24, fontWeight: '800', fill: INK_COUNT } });
    this.count.anchor.set(0, 0.5);
    this.count.visible = false;
    this.chipText = new Text({ text: '', style: { fontFamily: font, fontSize: CHIP_FONT, fontWeight: '800', fill: 0xffffff, letterSpacing: 0.5 } });
    this.chipText.anchor.set(0.5);
    this.chip.addChild(this.chipPlate, this.chipText);
    this.chip.visible = false;
    this.art.anchor.set(TAG_ART.knotX / TAG_ART.w, 0);
    this.art.visible = false;
    // the grommet sits in the pack, under the rope: the hole first, then the ring, then the tag and its rope over them
    this.grommetHole.circle(0, GROMMET.y, (GROMMET.size * GROMMET.hole) / 2 + 0.5).fill({ color: 0x0b0806, alpha: 1 });
    this.grommet.anchor.set(0.5);
    this.grommet.position.set(0, GROMMET.y);
    this.grommet.width = GROMMET.size; this.grommet.height = GROMMET.size;
    this.grommet.visible = false; this.grommetHole.visible = false;
    this.view.addChild(this.grommetHole, this.grommet, this.paper, this.art, this.icon, this.text, this.count, this.chip);
    this.view.visible = false;
  }

  /** The gem's texture arrives after the scene is up. */
  setGem(gem: Texture): void { this.icon.texture = gem; this.key = ''; }

  /** The painted tag's texture arrives after the scene is up: it replaces the drawn paper. */
  setArt(tag: Texture): void { this.art.texture = tag; this.key = ''; }

  /** The grommet's texture arrives after the scene is up. */
  setGrommet(ring: Texture): void {
    this.grommet.texture = ring;
    this.grommet.width = GROMMET.size; this.grommet.height = GROMMET.size;
    this.grommet.visible = true; this.grommetHole.visible = true;
  }

  /**
   * Show `label` (the number, or the words) as `kind`, a box's `count` words beside it (`placardCount`; '' for none) and
   * a label's words (`placardBadge`; null for none). Sizes the paper to what it holds; no-op when unchanged.
   */
  set(label: string, kind: PlacardKind, count = '', badge: string | null = null): void {
    const key = `${kind}:${label}:${count}:${badge ?? ''}:${this.icon.texture.width}:${this.art.texture.width}`;
    if (key === this.key) return;
    this.key = key;
    const t = this.text, ic = this.icon, c = this.count;
    t.text = label;
    t.style.fill = kind === 'sold' ? INK_SOLD : kind === 'free' ? INK_FREE : INK;
    const gem = kind === 'price' && ic.texture.width > 1;
    ic.visible = gem;
    c.visible = count !== '' && kind !== 'sold';
    if (c.visible) c.text = count;
    const gap = 6, cgap = 8;
    const content = (gem ? TAG_GEM + gap : 0) + t.width + (c.visible ? cgap + c.width : 0);
    const painted = this.art.texture.width > 1;
    const k = painted ? tagArtScale(content) : 1;
    const w = Math.max(96, content + 34), top = TAG_CORD - TAG_CUT * 0.5, h = TAG_H;
    const cy = painted ? TAG_ART.textY * k : top + TAG_CUT + (h - TAG_CUT) / 2 + 1;
    // centred on the parchment (the painted tag's rope is tied a little right of its middle)
    let x = -content / 2 + (painted ? (TAG_ART.textX - TAG_ART.knotX) * k : 0);
    if (gem) { ic.width = TAG_GEM; ic.height = TAG_GEM; ic.position.set(x + TAG_GEM / 2, cy); x += TAG_GEM + gap; }
    t.position.set(x, cy);
    x += t.width + cgap;
    if (c.visible) c.position.set(x, cy + 3);
    this.art.visible = painted;
    this.paper.visible = !painted;
    if (painted) {
      this.art.scale.set(k);
      this.chip.position.set(0, TAG_ART.h * k); // its label straddles the tag's foot
      this.dressChip(badge);
      return;
    }
    this.paper.clear()
      // the twine: a loop (two strands) from the knot down through the hole, and the knot itself
      .moveTo(0, 0).quadraticCurveTo(-TAG_CORD * 0.3, TAG_CORD * 0.55, -TAG_HOLE * 0.5, TAG_CORD).stroke({ width: 2.4, color: TWINE, alpha: 0.95 })
      .moveTo(0, 0).quadraticCurveTo(TAG_CORD * 0.26, TAG_CORD * 0.5, TAG_HOLE * 0.5, TAG_CORD).stroke({ width: 2.4, color: TWINE, alpha: 0.95 })
      .circle(0, 0, 3.6).fill({ color: TWINE, alpha: 1 })
      // the paper, shoulders clipped
      .poly([-w / 2 + TAG_CUT, top, w / 2 - TAG_CUT, top, w / 2, top + TAG_CUT, w / 2, top + h, -w / 2, top + h, -w / 2, top + TAG_CUT])
      .fill({ color: PAPER, alpha: 1 }).stroke({ width: 3, color: EDGE, alpha: 1 })
      // a printed rule inside the edge
      .poly([-w / 2 + TAG_CUT + 3, top + 7, w / 2 - TAG_CUT - 3, top + 7, w / 2 - 7, top + TAG_CUT + 3, w / 2 - 7, top + h - 7, -w / 2 + 7, top + h - 7, -w / 2 + 7, top + TAG_CUT + 3])
      .stroke({ width: 1.2, color: EDGE, alpha: 0.4 })
      // the punched hole and its brass ring
      .circle(0, TAG_CORD, TAG_HOLE * 1.55).fill({ color: RING, alpha: 1 })
      .circle(0, TAG_CORD, TAG_HOLE).fill({ color: 0x0b0d1c, alpha: 1 });
    this.chip.position.set(0, top + h + 2); // its label straddles the tag's foot
    this.dressChip(badge);
  }

  private dressChip(words: string | null): void {
    const chip = this.chip;
    chip.visible = words !== null;
    if (words === null) return;
    const look = words === 'New' ? CHIP.New : CHIP.Featured;
    const tx = this.chipText;
    tx.text = words;
    tx.style.fill = look.text;
    const w = tx.width + CHIP_H, h = CHIP_H;
    this.chipPlate.clear()
      .roundRect(-w / 2, -h / 2, w, h, h / 2).fill({ color: look.fill, alpha: 0.98 })
      .stroke({ width: 2, color: look.rim, alpha: 0.95 });
  }

  destroy(): void { this.view.destroy({ children: true }); }
}

/** Load an image as a texture (never blocks; `done` is not called on failure or after `alive` turns false). */
export function loadTexture(src: string, alive: () => boolean, done: (t: Texture) => void): void {
  if (typeof Image === 'undefined') return;
  const img = new Image();
  img.onload = () => { if (alive()) { try { done(Texture.from(img)); } catch { /* keep the plain plate */ } } };
  img.src = src;
}
