/**
 * THE SHOP'S DRESSING (owner 2026-11-25: "use more visuals where possible ... a cohesive and smooth experience"). What
 * makes the stage a SHOP instead of packs floating in the dark: the counter the packs stand on (its front lip is the
 * line a purchase crosses), a paper price tag tied to every pack, and the soft light the hand rests in. (A counter
 * slab, a plinth and contact shadows stood here for one pass; the owner removed that "stage" on 2026-11-25.)
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
export const TAG_CORD = 40;
const TAG_FONT_PX = 34, TAG_GEM = 40, TAG_H = 74, TAG_CUT = 20, TAG_HOLE = 6.5;

/**
 * A PRICE TAG ON A STRING (owner 2026-11-25: "can we make it look more like a price tag? like a tag attached with
 * string?", then "have the tag persistent and incorporate these pills in it ... hanging off the top left of the pack").
 * A paper tag with clipped shoulders and a punched, ringed hole, hanging from a loop of twine. It carries the price with
 * the Aether gem (or "Free" / "Sold out"), a box's count beside it ("x10"), and a New / Featured label on its foot.
 *
 * `view`'s origin is the KNOT (where the twine is tied to the pack): rotate the view to swing the tag. Everything is
 * redrawn only when what it shows changes.
 */
export class Placard {
  readonly view = new Container();
  private readonly paper = new Graphics();
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
    this.view.addChild(this.paper, this.icon, this.text, this.count, this.chip);
    this.view.visible = false;
  }

  /** The gem's texture arrives after the scene is up. */
  setGem(gem: Texture): void { this.icon.texture = gem; this.key = ''; }

  /**
   * Show `label` (the number, or the words) as `kind`, a box's `count` words beside it (`placardCount`; '' for none) and
   * a label's words (`placardBadge`; null for none). Sizes the paper to what it holds; no-op when unchanged.
   */
  set(label: string, kind: PlacardKind, count = '', badge: string | null = null): void {
    const key = `${kind}:${label}:${count}:${badge ?? ''}:${this.icon.texture.width}`;
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
    const w = Math.max(96, content + 34), top = TAG_CORD - TAG_CUT * 0.5, h = TAG_H;
    const cy = top + TAG_CUT + (h - TAG_CUT) / 2 + 1;
    let x = -content / 2;
    if (gem) { ic.width = TAG_GEM; ic.height = TAG_GEM; ic.position.set(x + TAG_GEM / 2, cy); x += TAG_GEM + gap; }
    t.position.set(x, cy);
    x += t.width + cgap;
    if (c.visible) c.position.set(x, cy + 3);
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
