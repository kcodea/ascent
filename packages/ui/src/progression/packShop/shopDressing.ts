/**
 * THE SHOP'S DRESSING (owner 2026-11-25: "use more visuals where possible ... a cohesive and smooth experience"). What
 * makes the stage a SHOP instead of packs floating in the dark: the counter the packs stand on (its front lip is the
 * line a purchase crosses), the plinth under the featured pack, a contact shadow under every pack, a price placard
 * standing on the counter in front of each pack, and the soft light the hand rests in.
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

function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** The counter's top: dark glass receding from the lip, a bright back edge where the packs stand, faint streaks of light. */
export function paintCounter(): HTMLCanvasElement {
  const W = 1024, H = 160;
  const { c, g } = canvasOf(W, H);
  if (!g) return c;
  const body = g.createLinearGradient(0, 0, 0, H);
  body.addColorStop(0, 'rgba(58,72,128,0.62)');
  body.addColorStop(0.18, 'rgba(30,38,78,0.78)');
  body.addColorStop(1, 'rgba(10,13,30,0.92)');
  g.fillStyle = body;
  g.fillRect(0, 0, W, H);
  // streaks: the stage's light lying across the glass
  for (let i = 0; i < 9; i++) {
    const x = (W * (i + 0.5)) / 9 + ((i * 53) % 37) - 18, w = 26 + ((i * 29) % 40);
    const s = g.createLinearGradient(x - w, 0, x + w, 0);
    s.addColorStop(0, 'rgba(150,180,255,0)');
    s.addColorStop(0.5, `rgba(150,180,255,${0.05 + (i % 3) * 0.025})`);
    s.addColorStop(1, 'rgba(150,180,255,0)');
    g.fillStyle = s;
    g.fillRect(x - w, 0, w * 2, H);
  }
  // the back edge, where the packs stand: a thin bright rule and its soft fall-off
  const edge = g.createLinearGradient(0, 0, 0, 22);
  edge.addColorStop(0, 'rgba(190,210,255,0.55)');
  edge.addColorStop(1, 'rgba(190,210,255,0)');
  g.fillStyle = edge;
  g.fillRect(0, 0, W, 22);
  // the ends fade out, so the counter has no hard corners against the stage
  g.globalCompositeOperation = 'destination-in';
  const ends = g.createLinearGradient(0, 0, W, 0);
  ends.addColorStop(0, 'rgba(0,0,0,0)');
  ends.addColorStop(0.1, 'rgba(0,0,0,1)');
  ends.addColorStop(0.9, 'rgba(0,0,0,1)');
  ends.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = ends;
  g.fillRect(0, 0, W, H);
  return c;
}

/** The plinth under the featured pack: a low step with a gold rim, lit from above. */
export function paintPlinth(): HTMLCanvasElement {
  const W = 512, H = 96;
  const { c, g } = canvasOf(W, H);
  if (!g) return c;
  // the top face (an ellipse seen from the front) and the riser under it
  const top = g.createLinearGradient(0, 0, 0, 44);
  top.addColorStop(0, 'rgba(92,108,170,0.95)');
  top.addColorStop(1, 'rgba(40,50,96,0.95)');
  g.fillStyle = top;
  g.beginPath(); g.ellipse(W / 2, 30, W / 2 - 12, 24, 0, 0, Math.PI * 2); g.fill();
  const riser = g.createLinearGradient(0, 30, 0, H);
  riser.addColorStop(0, 'rgba(34,42,84,0.96)');
  riser.addColorStop(1, 'rgba(12,15,34,0.96)');
  g.fillStyle = riser;
  g.beginPath();
  g.moveTo(12, 30); g.lineTo(12, 62); g.ellipse(W / 2, 62, W / 2 - 12, 24, 0, Math.PI, 0, true); g.lineTo(W - 12, 30);
  g.ellipse(W / 2, 30, W / 2 - 12, 24, 0, 0, Math.PI, false);
  g.closePath(); g.fill();
  // the gold rim on the top face's front edge
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,210,122,0.85)';
  g.beginPath(); g.ellipse(W / 2, 30, W / 2 - 12, 24, 0, 0, Math.PI, false); g.stroke();
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255,236,190,0.4)';
  g.beginPath(); g.ellipse(W / 2, 30, W / 2 - 12, 24, 0, Math.PI, Math.PI * 2, false); g.stroke();
  return c;
}

/** A pack's contact shadow: a soft dark ellipse. */
export function paintShadow(): HTMLCanvasElement {
  const W = 256, H = 64;
  const { c, g } = canvasOf(W, H);
  if (!g) return c;
  const gr = g.createRadialGradient(W / 2, H / 2, 2, W / 2, H / 2, W / 2);
  gr.addColorStop(0, 'rgba(0,0,6,0.85)');
  gr.addColorStop(0.55, 'rgba(0,0,6,0.38)');
  gr.addColorStop(1, 'rgba(0,0,6,0)');
  g.fillStyle = gr;
  g.save(); g.translate(W / 2, H / 2); g.scale(1, H / W); g.translate(-W / 2, -H / 2);
  g.fillRect(0, -W, W, W * 3);
  g.restore();
  return c;
}

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

/** The placard's plate: a small card standing on the counter (dark, gold rim, a foot). Painted at 240 x 72. */
export const PLACARD_W = 240, PLACARD_H = 72;
export function paintPlacard(): HTMLCanvasElement {
  const { c, g } = canvasOf(PLACARD_W, PLACARD_H);
  if (!g) return c;
  rr(g, 3, 3, PLACARD_W - 6, PLACARD_H - 12, 12);
  const body = g.createLinearGradient(0, 0, 0, PLACARD_H);
  body.addColorStop(0, 'rgba(34,40,74,0.97)');
  body.addColorStop(1, 'rgba(14,17,36,0.97)');
  g.fillStyle = body; g.fill();
  g.lineWidth = 2.5; g.strokeStyle = 'rgba(255,210,122,0.8)'; g.stroke();
  // its foot on the counter
  g.fillStyle = 'rgba(255,210,122,0.5)';
  rr(g, PLACARD_W / 2 - 34, PLACARD_H - 9, 68, 6, 3); g.fill();
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

/** The ribbon chip's colours: New is mint, Featured is the shop's gold. */
const CHIP = {
  New: { fill: 0x1f6b57, rim: 0x8dffd8, text: 0xd9fff2 },
  Featured: { fill: 0x6b4a12, rim: 0xffd27a, text: 0xfff1d0 },
} as const;
const CHIP_FONT = 20;
const CHIP_H = 28;

/**
 * A price placard: the plate, the Aether gem and the price (or "Free" / "Sold out"), a box's count beside it ("x10"),
 * and a ribbon chip on its top edge for a new or featured offer. `view`'s origin is its bottom centre. Everything is
 * rewritten only when what it shows changes.
 */
export class Placard {
  readonly view = new Container();
  private readonly icon: Sprite;
  private readonly text: Text;
  private readonly count: Text;
  private readonly chip = new Container();
  private readonly chipPlate = new Graphics();
  private readonly chipText: Text;
  private key = '';

  constructor(plate: Texture, gem: Texture, font: string) {
    const bg = new Sprite(plate);
    bg.anchor.set(0.5, 1);
    this.icon = new Sprite(gem);
    this.icon.anchor.set(0.5);
    this.text = new Text({ text: '', style: { fontFamily: font, fontSize: 34, fontWeight: '800', fill: 0xdcf3ff } });
    this.text.anchor.set(0, 0.5);
    this.count = new Text({ text: '', style: { fontFamily: font, fontSize: 24, fontWeight: '800', fill: 0xffd27a } });
    this.count.anchor.set(0, 0.5);
    this.count.visible = false;
    this.chipText = new Text({ text: '', style: { fontFamily: font, fontSize: CHIP_FONT, fontWeight: '800', fill: 0xffffff, letterSpacing: 0.5 } });
    this.chipText.anchor.set(0.5);
    this.chip.addChild(this.chipPlate, this.chipText);
    this.chip.visible = false;
    this.chip.position.set(0, -PLACARD_H + 4); // centred on the plate's top edge
    this.view.addChild(bg, this.icon, this.text, this.count, this.chip);
    this.view.visible = false;
  }

  /** The gem's texture arrives after the scene is up. */
  setGem(gem: Texture): void { this.icon.texture = gem; this.key = ''; }

  /**
   * Show `label` (the number, or the words) as `kind`, a box's `count` words beside it (`placardCount`; '' for none) and
   * a ribbon chip's words (`placardBadge`; null for none). Lays the gem and the words out centred; no-op when unchanged.
   */
  set(label: string, kind: PlacardKind, count = '', badge: string | null = null): void {
    const key = `${kind}:${label}:${count}:${badge ?? ''}:${this.icon.texture.width}`;
    if (key === this.key) return;
    this.key = key;
    const t = this.text, ic = this.icon, c = this.count;
    t.text = label;
    t.style.fill = kind === 'sold' ? 0xff9c8a : kind === 'free' ? 0xb7ffcf : 0xdcf3ff;
    const cy = -(PLACARD_H - 12) / 2 - 6;
    const gem = kind === 'price' && ic.texture.width > 1;
    ic.visible = gem;
    c.visible = count !== '' && kind !== 'sold';
    if (c.visible) c.text = count;
    const gw = 44, gap = 8, cgap = 10;
    const total = (gem ? gw + gap : 0) + t.width + (c.visible ? cgap + c.width : 0);
    let x = -total / 2;
    if (gem) { ic.width = gw; ic.height = gw; ic.position.set(x + gw / 2, cy); x += gw + gap; }
    t.position.set(x, cy);
    x += t.width + cgap;
    if (c.visible) c.position.set(x, cy + 3); // (smaller words: a touch lower, so their baselines nearly meet)
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
      .roundRect(-w / 2, -h / 2, w, h, h / 2).fill({ color: look.fill, alpha: 0.97 })
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
