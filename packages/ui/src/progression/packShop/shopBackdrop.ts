/**
 * THE SHOP'S ROOM, IN LAYERS (owner 2026-11-25: "a shop background, how can we use parallax effects even? ... lets
 * really make this a pinnacle experience", then "Yes, build it"). Three painted layers stacked around the packs:
 *
 *   1. THE BACK WALL    behind the packs: shelves of sealed packs in the wings, lanterns, a clear dark middle.
 *   2. THE COUNTER      below the counter line: its top is where the hand rests; its back edge is the line.
 *   3. THE FOREGROUND   in front of everything: soft dark shapes hugging the edges and the top corners.
 *
 * The packs are the plane the eye rests on, so they never move. As the pointer moves, the wall (behind that plane)
 * drifts a little WITH it and the counter and the foreground (in front) drift AGAINST it, the nearest the most. That
 * difference is the depth.
 *
 * The three paintings here are PLACEHOLDERS, drawn once into canvases at build time, until the owner's art arrives
 * (`docs/art/pack-shop/prompts.md` section 3, framed by `shop-layout-template-16x9.png`). Each layer is painted wider
 * than the canvas by its overscan, exactly as the prompts ask of the real art, so a slid layer never shows an edge.
 * To swap a layer for real art, name its file in `SHOP_ART`.
 *
 * Costs: three sprites; per frame two eased numbers and three position writes, and nothing at all once settled.
 */
import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { loadTexture } from './shopDressing';
import type { ShopLayout } from './shopLayout';

export type BackdropLayer = 'wall' | 'counter' | 'fore';

/** Real art for a layer, once it exists (under the app's public folder, relative to the bundle so a built game finds it). Empty: the placeholder is drawn. */
const BASE = import.meta.env.BASE_URL;
export const SHOP_ART: Partial<Record<BackdropLayer, string>> = {
  wall: `${BASE}packs/shop-wall.webp`, // owner 2026-11-25 (prompts.md 5a): the shop's interior, an arched alcove behind the packs
  // owner 2026-11-25 (prompts.md 5b): the wooden counter, a till and ledger far left, scrolls and a candle far right.
  // Cropped so its back edge sits at COUNTER_HEADROOM of the image, as the placeholder's does.
  counter: `${BASE}packs/shop-counter.webp`,
  // owner 2026-11-25 (prompts.md 5c): soft-focus curtains down both edges, and nothing else: the painting's
  // small lantern and swag were painted out (owner: at that distance they would be huge and blurred, and unwanted).
  // The file is the painting with its edge pixels repeated outward by 3%: less than OVERSCAN.fore, on purpose, so the
  // curtains sit mostly off screen and encroach less (owner 2026-11-25). Rebuild with a larger repeat to bring them in.
  fore: `${BASE}packs/shop-fore.webp`,
};

/** How much wider than the canvas each layer is painted, per side (the prompts ask the art for the same margins). */
export const OVERSCAN: Record<BackdropLayer, number> = { wall: 0.06, counter: 0.02, fore: 0.1 }; // the counter's props sit near its ends: it hides only what its slide needs

/**
 * How far each layer slides at the pointer's furthest reach, in canvas widths (x) and heights (y). Positive moves WITH
 * the pointer (behind the packs), negative AGAINST it (in front). The counter never moves up or down: its back edge is
 * the counter line.
 */
export const DEPTH: Record<BackdropLayer, { x: number; y: number }> = {
  wall: { x: 0.012, y: 0.008 },
  counter: { x: -0.016, y: 0 },
  fore: { x: -0.05, y: -0.03 },
};

/** How quickly the room follows the pointer (per 60 Hz frame), and when it counts as arrived. */
export const LOOK_EASE = 0.07;
const LOOK_SETTLE = 0.0005;

/** The PLACEHOLDER wall's strength: its shelves stay well under the packs in front of them. Real art is shown as painted. */
const WALL_ALPHA = 0.7;

/** The share of the counter painting that stands ABOVE the counter line (room for the tops of the corner props). */
export const COUNTER_HEADROOM = 0.24;

/** Where the pointer looks, each axis -1..1 from the canvas centre (0, 0 when the canvas has no size). */
export function lookInto(out: { x: number; y: number }, px: number, py: number, w: number, h: number): void {
  out.x = w > 0 ? Math.max(-1, Math.min(1, (px / w) * 2 - 1)) : 0;
  out.y = h > 0 ? Math.max(-1, Math.min(1, (py / h) * 2 - 1)) : 0;
}

/** A layer's slide (canvas px) for a look of (lx, ly). */
export function slideInto(out: { x: number; y: number }, layer: BackdropLayer, lx: number, ly: number, w: number, h: number): void {
  const d = DEPTH[layer];
  out.x = d.x * lx * w;
  out.y = d.y * ly * h;
}

// ------------------------------------------------------------------ the placeholder paintings

const canvasOf = (w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D | null } => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d') };
};

/** A small repeatable number stream (the paintings must come out the same every time). */
function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Muted pack colours for the shelves: they must not compete with the real packs. */
const SHELF_PACKS = ['#3d3566', '#5a3a2c', '#2c4a52', '#5b2f45', '#3a4a2e', '#4a3f6e', '#6a4a22'];

/**
 * The back wall: tall shelves of sealed packs in both wings, falling off into shadow toward the middle (which is left
 * clear, so the stage's own pool of light shows behind the packs), two lanterns, a darker band along the top.
 */
export function paintWall(): HTMLCanvasElement {
  const W = 1024, H = 576;
  const { c, g } = canvasOf(W, H);
  if (!g) return c;
  const rnd = stream(7);
  const wing = W * 0.36;
  for (const side of [0, 1]) {
    g.save();
    if (side === 1) { g.translate(W, 0); g.scale(-1, 1); }
    // (clipped to its own wing: the fall-off below erases, and must not reach the other wing)
    g.beginPath(); g.rect(0, 0, wing, H); g.clip();
    // the shelving's back panel
    const panel = g.createLinearGradient(0, 0, wing, 0);
    panel.addColorStop(0, '#171226');
    panel.addColorStop(0.7, '#120f20');
    panel.addColorStop(1, '#0d0b18');
    g.fillStyle = panel;
    g.fillRect(0, 0, wing, H);
    // shelves, and the packs standing on them
    const rows = 6, rowH = H * 0.118, top = H * 0.1;
    for (let r = 0; r < rows; r++) {
      const y = top + r * rowH;
      let x = 6 + rnd() * 10;
      while (x < wing - 10) {
        const pw = rowH * (0.42 + rnd() * 0.1), ph = rowH * (0.66 + rnd() * 0.16);
        if (rnd() > 0.14) {
          const col = SHELF_PACKS[Math.floor(rnd() * SHELF_PACKS.length)]!;
          g.fillStyle = col;
          g.fillRect(x, y + rowH - 7 - ph, pw, ph);
          g.fillStyle = 'rgba(255,255,255,0.07)';
          g.fillRect(x, y + rowH - 7 - ph, pw, ph * 0.13);       // the crimp
          g.fillStyle = 'rgba(0,0,0,0.3)';
          g.fillRect(x + pw - 2, y + rowH - 7 - ph, 2, ph);       // its shaded side
        }
        x += pw + 3 + rnd() * 5;
      }
      // the board
      const board = g.createLinearGradient(0, y + rowH - 7, 0, y + rowH);
      board.addColorStop(0, '#5a4026');
      board.addColorStop(1, '#2a1c10');
      g.fillStyle = board;
      g.fillRect(0, y + rowH - 7, wing, 7);
    }
    // an upright
    g.fillStyle = '#2f2114';
    g.fillRect(wing * 0.52, top, 6, rows * rowH);
    // the wing falls into shadow toward the middle, then clears entirely
    g.globalCompositeOperation = 'destination-in';
    const fall = g.createLinearGradient(0, 0, wing, 0);
    fall.addColorStop(0, 'rgba(0,0,0,1)');
    fall.addColorStop(0.55, 'rgba(0,0,0,0.85)');
    fall.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fall;
    g.fillRect(0, 0, wing, H);
    g.restore();
  }
  // everything dims toward the edges and the floor
  g.globalCompositeOperation = 'source-atop';
  const dim = g.createLinearGradient(0, 0, 0, H);
  dim.addColorStop(0, 'rgba(6,6,16,0.75)');
  dim.addColorStop(0.16, 'rgba(6,6,16,0.2)');
  dim.addColorStop(0.6, 'rgba(6,6,16,0.25)');
  dim.addColorStop(0.78, 'rgba(6,6,16,0.9)');
  dim.addColorStop(1, 'rgba(6,6,16,1)');
  g.fillStyle = dim;
  g.fillRect(0, 0, W, H);
  // the lanterns: a warm glow on each wing, a chain, a small body
  g.globalCompositeOperation = 'source-over';
  for (const lx of [W * 0.2, W * 0.8]) {
    const ly = H * 0.25;
    const glow = g.createRadialGradient(lx, ly, 2, lx, ly, H * 0.3);
    glow.addColorStop(0, 'rgba(255,196,110,0.34)');
    glow.addColorStop(0.35, 'rgba(255,170,80,0.10)');
    glow.addColorStop(1, 'rgba(255,170,80,0)');
    g.fillStyle = glow;
    g.fillRect(lx - H * 0.3, ly - H * 0.3, H * 0.6, H * 0.6);
    g.fillStyle = '#1c1410';
    g.fillRect(lx - 1, 0, 2, ly - 12);
    g.fillStyle = '#2a1e12';
    g.fillRect(lx - 9, ly - 14, 18, 4);
    g.fillStyle = 'rgba(255,214,140,0.85)';
    g.fillRect(lx - 6, ly - 10, 12, 18);
    g.fillStyle = '#2a1e12';
    g.fillRect(lx - 8, ly + 8, 16, 3);
  }
  return c;
}

/**
 * The counter: a dark wooden top filling everything below its back edge, a thin lit lip along that edge, a soft sheen
 * where the hand rests, and a few props in the far corners (ledgers on the left, a candle on the right) whose tops
 * stand above the edge. The top `COUNTER_HEADROOM` of the painting is the room above the edge.
 */
export function paintCounter(): HTMLCanvasElement {
  const W = 1024, H = 320;
  const { c, g } = canvasOf(W, H);
  if (!g) return c;
  const edge = Math.round(H * COUNTER_HEADROOM);
  // the top's wood
  const wood = g.createLinearGradient(0, edge, 0, H);
  wood.addColorStop(0, '#2a1d15');
  wood.addColorStop(0.5, '#1d1410');
  wood.addColorStop(1, '#120c0a');
  g.fillStyle = wood;
  g.fillRect(0, edge, W, H - edge);
  // planks, opening toward the viewer
  g.strokeStyle = 'rgba(0,0,0,0.32)';
  g.lineWidth = 1.5;
  const vx = W / 2, vy = edge - H * 1.5;
  for (let i = -9; i <= 9; i++) {
    const x1 = vx + i * W * 0.085;
    const x0 = vx + (x1 - vx) * ((edge - vy) / (H - vy));
    g.beginPath(); g.moveTo(x0, edge); g.lineTo(x1, H); g.stroke();
  }
  // the sheen where the hand rests
  const sheen = g.createRadialGradient(W / 2, edge + (H - edge) * 0.6, 4, W / 2, edge + (H - edge) * 0.6, W * 0.42);
  sheen.addColorStop(0, 'rgba(150,170,255,0.10)');
  sheen.addColorStop(1, 'rgba(150,170,255,0)');
  g.fillStyle = sheen;
  g.fillRect(0, edge, W, H - edge);
  // the wings of the top fall into shadow
  const sides = g.createLinearGradient(0, 0, W, 0);
  sides.addColorStop(0, 'rgba(5,5,12,0.75)');
  sides.addColorStop(0.22, 'rgba(5,5,12,0)');
  sides.addColorStop(0.78, 'rgba(5,5,12,0)');
  sides.addColorStop(1, 'rgba(5,5,12,0.75)');
  g.fillStyle = sides;
  g.fillRect(0, edge, W, H - edge);
  // the lit lip along the back edge
  const lip = g.createLinearGradient(0, 0, W, 0);
  lip.addColorStop(0, 'rgba(214,170,104,0)');
  lip.addColorStop(0.25, 'rgba(214,170,104,0.55)');
  lip.addColorStop(0.75, 'rgba(214,170,104,0.55)');
  lip.addColorStop(1, 'rgba(214,170,104,0)');
  g.fillStyle = lip;
  g.fillRect(0, edge, W, 2);
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.fillRect(0, edge + 2, W, 3);
  // ledgers, far left
  const books: Array<[number, number, string]> = [[74, 15, '#3a2a4a'], [66, 13, '#4a2c22'], [80, 16, '#23363a']];
  let by = edge + 26;
  for (const [bw, bh, col] of books) {
    by -= bh;
    g.fillStyle = col;
    g.fillRect(W * 0.125 - bw / 2, by, bw, bh);
    g.fillStyle = 'rgba(255,230,180,0.16)';
    g.fillRect(W * 0.125 - bw / 2, by + bh - 3, bw, 2);
  }
  // a candle, far right, and its glow
  const cx = W * 0.875, cb = edge + 22;
  const halo = g.createRadialGradient(cx, cb - 56, 2, cx, cb - 56, 110);
  halo.addColorStop(0, 'rgba(255,200,120,0.30)');
  halo.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = halo;
  g.fillRect(cx - 110, cb - 166, 220, 220);
  g.fillStyle = '#3a2a16';
  g.fillRect(cx - 16, cb - 5, 32, 5);
  g.fillStyle = '#d8ccb0';
  g.fillRect(cx - 6, cb - 46, 12, 41);
  g.fillStyle = 'rgba(255,222,150,0.95)';
  g.beginPath(); g.ellipse(cx, cb - 56, 4, 9, 0, 0, Math.PI * 2); g.fill();
  return c;
}

/**
 * The foreground: soft, dark shapes close to the viewer, hugging the left and right edges and the two top corners (a
 * curtain's edge, a hanging lantern). Painted small on purpose: stretched to the canvas it is out of focus, as
 * something this near would be. The middle is empty.
 */
export function paintFore(): HTMLCanvasElement {
  const W = 384, H = 216;
  const { c, g } = canvasOf(W, H);
  if (!g) return c;
  const dark = (a: number): string => `rgba(5,4,12,${a})`;
  // the two edges
  for (const side of [0, 1]) {
    const band = g.createLinearGradient(side ? W : 0, 0, side ? W * 0.82 : W * 0.18, 0);
    band.addColorStop(0, dark(0.95));
    band.addColorStop(0.55, dark(0.5));
    band.addColorStop(1, dark(0));
    g.fillStyle = band;
    g.fillRect(side ? W * 0.82 : 0, 0, W * 0.18, H);
  }
  // a curtain gathered in the top left corner
  const curtain = g.createRadialGradient(0, 0, 4, 0, 0, H * 0.46);
  curtain.addColorStop(0, dark(0.98));
  curtain.addColorStop(0.6, dark(0.55));
  curtain.addColorStop(1, dark(0));
  g.fillStyle = curtain;
  g.fillRect(0, 0, H * 0.46, H * 0.46);
  // a lantern hanging in the top right corner: a dark body with a breath of warm light round it
  const lx = W * 0.93, ly = H * 0.2;
  const warm = g.createRadialGradient(lx, ly, 2, lx, ly, H * 0.3);
  warm.addColorStop(0, 'rgba(255,190,110,0.16)');
  warm.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = warm;
  g.fillRect(lx - H * 0.3, ly - H * 0.3, H * 0.6, H * 0.6);
  g.fillStyle = dark(0.92);
  g.fillRect(lx - 1.5, 0, 3, ly - 12);
  g.beginPath(); g.ellipse(lx, ly, 11, 15, 0, 0, Math.PI * 2); g.fill();
  const corner = g.createRadialGradient(W, 0, 4, W, 0, H * 0.5);
  corner.addColorStop(0, dark(0.9));
  corner.addColorStop(1, dark(0));
  g.fillStyle = corner;
  g.fillRect(W - H * 0.5, 0, H * 0.5, H * 0.5);
  return c;
}

// ------------------------------------------------------------------ the layers in the scene

/**
 * The three layers as sprites. The scene adds `back` (the wall, then the counter) under its packs and `front` (the
 * foreground) over them, calls `layout` on a resize, `lookAt` when the pointer moves and `step` every frame.
 */
export class ShopBackdrop {
  /** The wall and the counter: under the packs. */
  readonly back = new Container();
  /** The foreground: over the packs. */
  readonly front = new Container();
  private readonly wall: Sprite;
  private readonly counter: Sprite;
  private readonly fore: Sprite;
  private readonly textures: Texture[] = [];
  private readonly look = { x: 0, y: 0 };
  private readonly lookTo = { x: 0, y: 0 };
  private readonly slide = { x: 0, y: 0 };
  private w = 0;
  private h = 0;
  private lineY = 0;
  private alive = true;

  constructor() {
    const tex = (c: HTMLCanvasElement): Texture => { const t = new Texture({ source: new CanvasSource({ resource: c }) }); this.textures.push(t); return t; };
    this.wall = new Sprite(tex(paintWall()));
    this.wall.anchor.set(0.5);
    this.wall.alpha = WALL_ALPHA;
    this.counter = new Sprite(tex(paintCounter()));
    this.counter.anchor.set(0.5, COUNTER_HEADROOM);
    this.fore = new Sprite(tex(paintFore()));
    this.fore.anchor.set(0.5);
    this.back.addChild(this.wall, this.counter);
    this.front.addChild(this.fore);
    this.back.eventMode = 'none';
    this.front.eventMode = 'none';
    const sprites: Record<BackdropLayer, Sprite> = { wall: this.wall, counter: this.counter, fore: this.fore };
    for (const layer of Object.keys(SHOP_ART) as BackdropLayer[]) {
      const src = SHOP_ART[layer];
      if (src) loadTexture(src, () => this.alive, (t) => { this.textures.push(t); sprites[layer].texture = t; sprites[layer].alpha = 1; this.size(); });
    }
  }

  /** Fit the layers to this canvas (on a resize only). */
  layout(L: ShopLayout): void {
    this.w = L.w; this.h = L.h; this.lineY = L.lineY;
    this.size();
    this.place();
  }

  private size(): void {
    const w = this.w, h = this.h;
    this.wall.width = w * (1 + 2 * OVERSCAN.wall); this.wall.height = h * (1 + 2 * OVERSCAN.wall);
    this.fore.width = w * (1 + 2 * OVERSCAN.fore); this.fore.height = h * (1 + 2 * OVERSCAN.fore);
    // the counter's painting runs from its headroom above the line to the canvas's foot
    this.counter.width = w * (1 + 2 * OVERSCAN.counter);
    this.counter.height = Math.max(1, h - this.lineY) / (1 - COUNTER_HEADROOM);
  }

  /** The pointer is at (px, py) in canvas px. */
  lookAt(px: number, py: number): void { lookInto(this.lookTo, px, py, this.w, this.h); }

  /** The pointer left: the room comes back to rest. */
  rest(): void { this.lookTo.x = 0; this.lookTo.y = 0; }

  /** How visible the room is (it leaves with the shelf when a pack is played). */
  setAlpha(a: number): void {
    this.back.alpha = a; this.front.alpha = a;
    this.back.visible = a > 0; this.front.visible = a > 0;
  }

  /** Ease the look toward the pointer and slide the layers. `k` is this frame's easing share. True while still moving. */
  step(k: number): boolean {
    const l = this.look, to = this.lookTo;
    const dx = to.x - l.x, dy = to.y - l.y;
    if (dx === 0 && dy === 0) return false;
    if (Math.abs(dx) < LOOK_SETTLE && Math.abs(dy) < LOOK_SETTLE) { l.x = to.x; l.y = to.y; } else { l.x += dx * k; l.y += dy * k; }
    this.place();
    return true;
  }

  private place(): void {
    const w = this.w, h = this.h, s = this.slide, l = this.look;
    slideInto(s, 'wall', l.x, l.y, w, h);
    this.wall.position.set(w / 2 + s.x, h / 2 + s.y);
    slideInto(s, 'counter', l.x, l.y, w, h);
    this.counter.position.set(w / 2 + s.x, this.lineY);
    slideInto(s, 'fore', l.x, l.y, w, h);
    this.fore.position.set(w / 2 + s.x, h / 2 + s.y);
  }

  destroy(): void {
    this.alive = false;
    this.back.destroy({ children: true });
    this.front.destroy({ children: true });
    for (const t of this.textures) t.destroy(true);
    this.textures.length = 0;
  }
}
