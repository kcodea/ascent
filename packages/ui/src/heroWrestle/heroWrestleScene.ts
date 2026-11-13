/**
 * THE WRESTLING SCENE: what the Top Rope attack draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so
 * it runs (and is tested) headless. The PORTRAITS are the wrestlers (the runner moves both); this draws the ring, the
 * light and the hits. `heroWrestle.ts` mounts `root` on the above-portrait overlay.
 *
 * OWN OBJECTS (positioned by the runner every frame from the pure state, hidden the moment they are not needed and on
 * every exit): IV's RING OF LIGHT (a lit square of canvas, a pillar of light with a glowing cap at each of the four
 * corners, and three ropes of light on EVERY side, each drawn as two stretchable lengths meeting at a bend: the side
 * ropes are pushed out when someone runs into them, the back and front ropes sag as the ring shudders under a landing),
 * Tier 3's TURNBUCKLE (a pillar of light the striker climbs), its SPOTLIGHT (a cone from the top edge and its pool), the
 * ELBOW STAR leading the dive, Tier 1's CHAIR (a folding chair drawn in seven lengths of neon light, which bursts apart
 * on the hit), the DIZZY STARS circling the struck portrait's head, and the SHADOW of whatever is about to land. No
 * painted props: everything here is light.
 *
 * FIRE-AND-FORGET (pooled, under a hard cap): the walk's dust, the chop's slap arc and red hand print, the hits, the
 * canvas-mat dust rings, the BIG mat shock (a wide ring, dust that hangs, grit, a whole-frame flash), the ropes' twang,
 * the clothesline, the count's numbers and mat slaps, the bell's rings and WINNER, the crowd's CAMERA FLASHES popping
 * along the edges of the screen, the chair's burst, the cutter's streaks.
 */
import { Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import type { ChairState, DizzyState, ElbowState, PostState, RingSide, RingState, SpotState } from './heroWrestleConfig';

export interface HeroWrestleTextures extends HeroArcanaTextures {
  tube: Texture;
  mat: Texture;
  cone: Texture;
  hand: Texture;
  arc: Texture;
  impact: Texture;
  puff: Texture;
  shadow: Texture;
  wordWoo: Texture;
  wordSlam: Texture;
  wordWinner: Texture;
  wordSplash: Texture;
  wordBonk: Texture;
  num1: Texture;
  num2: Texture;
  num3: Texture;
}

export interface WrestleColors { mat: number; flash: number; pow: number; hand: number; spot: number; side: number }

export interface WrestleLook {
  /** The ropes' thickness, as a multiple of the default. */
  ropeSize: number;
  wordSize: number;
  /** The frame (screen px): words and numbers are kept inside it. */
  frameW?: number;
  frameH?: number;
}

/** Hard cap on pooled sprites alive at once (the finisher's landing peaks near 150). The own objects are outside the pool. */
export const MAX_WRESTLE_SPRITES = 300;
const RING_PX = 160;
const GLOW_PX = 128;
const SHADOW_PX = 64;
const TUBE_W = 64;
const TUBE_H = 32;
const MAT_W = 512;
const MAT_H = 256;
const CONE_W = 256;
const CONE_H = 512;
const HAND_PX = 128;
const ARC_W = 256;
const IMPACT_PX = 256;
const PUFF_PX = 128;
const NUM_PX = 256;
const WORD_W = 512;
const WORD_H = 160;
/** Where the ropes tie on to a corner (fractions of its height), and each rope's colour and share of a stretch. */
const ROPE_AT = [0.4, 0.66, 0.92] as const;
const ROPE_TINT = [0x3f7bff, 0xffffff, 0xff3b30] as const;
const ROPE_GIVE = [0.82, 1, 0.9] as const;
const PILLAR_TINT = 0xffe2a0;
const CHAIR_TINT = 0x9fd8ff;
/**
 * The folding chair, front on, in its own units (its height is about 1.8): the backrest's top and bottom bars, the two
 * uprights running down into the legs, the seat, and the crossed braces under it. [x0, y0, x1, y1] each.
 */
export const CHAIR_SEGS: readonly (readonly [number, number, number, number])[] = [
  [-0.38, -0.95, 0.38, -0.95], [-0.38, -0.6, 0.38, -0.6], [-0.38, -0.95, -0.44, 0.85], [0.38, -0.95, 0.44, 0.85],
  [-0.46, 0.02, 0.46, 0.02], [-0.4, 0.3, 0.4, 0.8], [0.4, 0.3, -0.4, 0.8],
];
const DIZZY_N = 5;

export type WrestleWord = 'woo' | 'slam' | 'winner' | 'splash' | 'bonk';

export class HeroWrestleScene extends FxPool {
  private readonly mat: Sprite;
  /** The four corner pillars and their caps: near back, far back, near front, far front. */
  private readonly pillars: Sprite[] = [];
  private readonly caps: Sprite[] = [];
  /** The ropes, two lengths each: [0..12) the near and far sides, [12..18) the back, [18..24) the front. */
  private readonly ropes: Sprite[] = [];
  private readonly cone: Sprite;
  private readonly pool: Sprite;
  private readonly elbow: Sprite;
  private readonly shadow: Sprite;
  private readonly post: Sprite;
  private readonly postCap: Sprite;
  private readonly chair: Sprite[] = [];
  private readonly dizzyStars: Sprite[] = [];
  private own = false;

  /** `aR` / `dR`: the striking and the struck portraits' radii (screen px). */
  constructor(
    private readonly tex: HeroWrestleTextures, private readonly colors: WrestleColors, private readonly look: WrestleLook,
    private readonly aR: number, private readonly dR: number, scale = 1, seed = 1,
  ) {
    super('heroWrestle', [
      tex.glow, tex.ring, tex.star, tex.streak, tex.spark, tex.tube, tex.mat, tex.cone, tex.hand, tex.arc, tex.impact, tex.puff, tex.shadow,
      tex.wordWoo, tex.wordSlam, tex.wordWinner, tex.num1, tex.num2, tex.num3,
    ], scale, seed, MAX_WRESTLE_SPRITES);
    const mk = (layer: 'under' | 'glow' | 'body' | 'core', t: Texture, tint: number, ax = 0.5, ay = 0.5): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.tint = tint; s.visible = false; s.eventMode = 'none';
      if (layer === 'glow' || layer === 'core') s.blendMode = 'add';
      this.layers[layer].addChild(s);
      return s;
    };
    this.shadow = mk('under', tex.shadow, 0x000000);
    this.mat = mk('glow', tex.mat, colors.spot, 0.5, 0);
    this.cone = mk('glow', tex.cone, colors.spot, 0.5, 0);
    this.pool = mk('glow', tex.glow, colors.spot);
    // The ring, back to front: the back pillars, the back ropes, the side ropes, the front pillars, the front ropes.
    const rope = (i: number): Sprite => mk('body', tex.tube, ROPE_TINT[i]!, 0, 0.5);
    const backPillars = [mk('body', tex.tube, PILLAR_TINT, 0, 0.5), mk('body', tex.tube, PILLAR_TINT, 0, 0.5)];
    const back: Sprite[] = [];
    for (let i = 0; i < 3; i++) for (let half = 0; half < 2; half++) back.push(rope(i));
    for (let side = 0; side < 2; side++) for (let i = 0; i < 3; i++) for (let half = 0; half < 2; half++) this.ropes.push(rope(i));
    const frontPillars = [mk('body', tex.tube, PILLAR_TINT, 0, 0.5), mk('body', tex.tube, PILLAR_TINT, 0, 0.5)];
    this.ropes.push(...back);
    for (let i = 0; i < 3; i++) for (let half = 0; half < 2; half++) this.ropes.push(rope(i));
    this.pillars.push(...backPillars, ...frontPillars);
    for (let i = 0; i < 4; i++) this.caps.push(mk('core', tex.glow, PILLAR_TINT));
    this.elbow = mk('body', tex.impact, 0xffffff);
    this.post = mk('body', tex.tube, PILLAR_TINT, 0, 0.5);
    this.postCap = mk('core', tex.glow, PILLAR_TINT);
    for (let i = 0; i < CHAIR_SEGS.length; i++) this.chair.push(mk('body', tex.tube, CHAIR_TINT, 0, 0.5));
    for (let i = 0; i < DIZZY_N; i++) this.dizzyStars.push(mk('core', tex.star, i % 2 ? 0xffffff : colors.pow));
  }

  /** Whether any own object still draws. */
  get ownVisible(): boolean { return this.own; }

  private wordTex(w: WrestleWord): Texture {
    const t = this.tex;
    return { woo: t.wordWoo, slam: t.wordSlam, winner: t.wordWinner, splash: t.wordSplash, bonk: t.wordBonk }[w];
  }

  // ── own objects (the runner writes them every frame) ──────────────────────────────────────────────────────────

  /** One length of light from (x0, y0) to (x1, y1), `thick` px across (its soft halo included). */
  private line(s: Sprite, x0: number, y0: number, x1: number, y1: number, thick: number, alpha: number): void {
    s.visible = true; s.alpha = alpha;
    s.position.set(x0, y0);
    s.rotation = Math.atan2(y1 - y0, x1 - x0);
    s.scale.set(Math.max(0.001, Math.hypot(x1 - x0, y1 - y0)) / TUBE_W, thick / TUBE_H);
  }

  /** A rope: two lengths from `p` to `q` meeting at a bend pushed (`bx`, `by`) off the straight line. Thinner when stretched. */
  private rope(at: number, px: number, py: number, qx: number, qy: number, bx: number, by: number, thick: number, alpha: number): void {
    const mx = (px + qx) / 2 + bx, my = (py + qy) / 2 + by;
    const rest = Math.hypot(qx - px, qy - py) || 1;
    const now = Math.hypot(mx - px, my - py) + Math.hypot(qx - mx, qy - my);
    const th = thick * Math.max(0.62, rest / Math.max(rest, now));
    this.line(this.ropes[at]!, px, py, mx, my, th, alpha);
    this.line(this.ropes[at + 1]!, mx, my, qx, qy, th, alpha);
  }

  /** IV: the ring. `sides` is where its corners stand (near, far); `st` how far it has risen and how its ropes are pushed. */
  setRing(sides: readonly [RingSide, RingSide], st: RingState): void {
    if (this.destroyed) return;
    if (!st.visible) {
      if (this.mat.visible) { this.hideRing(); this.refresh(); }
      return;
    }
    const Rm = (this.aR + this.dR) / 2;
    const thick = Rm * 0.3 * this.look.ropeSize;
    const [near, far] = sides;
    // The lit canvas, corner to corner.
    const m = this.mat;
    m.visible = true; m.alpha = 0.9 * st.alpha;
    m.position.set((near.back.x + far.back.x) / 2, near.back.y);
    m.scale.set((Math.abs(far.front.x - near.front.x) * 1.04) / MAT_W, ((near.front.y - near.back.y) * 1.06) / MAT_H);
    // The corner pillars of light and their caps.
    const corner = (i: number, x: number, y: number, h: number): void => {
      this.line(this.pillars[i]!, x, y, x, y - h * st.rise, Rm * 0.42, st.alpha);
      const c = this.caps[i]!;
      c.visible = true; c.alpha = 0.85 * st.alpha;
      c.position.set(x, y - h * st.rise);
      c.scale.set((Rm * 0.95) / GLOW_PX);
    };
    corner(0, near.back.x, near.back.y, near.backH); corner(1, far.back.x, far.back.y, far.backH);
    corner(2, near.front.x, near.front.y, near.frontH); corner(3, far.front.x, far.front.y, far.frontH);
    for (let i = 0; i < 3; i++) {
      const f = ROPE_AT[i]!, give = ROPE_GIVE[i]!;
      for (let k = 0; k < 2; k++) {
        // A SIDE's rope, back corner to front corner: its bend is pushed OUT of the ring by whoever ran into it.
        const sd = sides[k]!;
        const push = (k === 0 ? st.near : st.far) * give;
        this.rope(k * 6 + i * 2, sd.back.x, sd.back.y - sd.backH * st.rise * f, sd.front.x, sd.front.y - sd.frontH * st.rise * f, sd.out * push, 0, thick * 0.94, st.alpha);
      }
      // The BACK and FRONT ropes, side to side: they sag when the ring shudders. The back ones are further away (thinner).
      this.rope(12 + i * 2, near.back.x, near.back.y - near.backH * st.rise * f, far.back.x, far.back.y - far.backH * st.rise * f, 0, st.drop * give * 0.8, thick * 0.84, st.alpha);
      this.rope(18 + i * 2, near.front.x, near.front.y - near.frontH * st.rise * f, far.front.x, far.front.y - far.frontH * st.rise * f, 0, st.drop * give, thick * 1.06, st.alpha);
    }
    this.own = true;
  }

  private hideRing(): void {
    this.mat.visible = false;
    for (const s of this.pillars) s.visible = false;
    for (const s of this.caps) s.visible = false;
    for (const s of this.ropes) s.visible = false;
  }

  /** III: the spotlight's cone from the top edge to where it points, and its pool there. */
  setSpot(st: SpotState): void {
    if (this.destroyed) return;
    const c = this.cone, p = this.pool;
    if (!st.visible) { if (c.visible || p.visible) { c.visible = false; p.visible = false; this.refresh(); } return; }
    const dx = st.toX - st.fromX, dy = st.toY - st.fromY;
    const len = Math.hypot(dx, dy) + this.dR * 0.6;
    c.visible = true;
    c.position.set(st.fromX, st.fromY);
    c.rotation = Math.atan2(dy, dx) - Math.PI / 2;
    c.scale.set((this.dR * 3.1) / CONE_W, len / CONE_H);
    c.alpha = 0.85 * st.alpha;
    p.visible = true;
    p.position.set(st.toX, st.toY + this.dR * 0.25);
    p.scale.set((this.dR * 4.2) / GLOW_PX, (this.dR * 2.2) / GLOW_PX);
    p.alpha = 0.7 * st.alpha;
    this.own = true;
  }

  /** III: the elbow star leading the dive. */
  setElbow(st: ElbowState): void {
    if (this.destroyed) return;
    const s = this.elbow;
    if (!st.visible) { if (s.visible) { s.visible = false; this.refresh(); } return; }
    s.visible = true;
    s.position.set(st.x, st.y);
    s.rotation = st.rot;
    s.scale.set((this.aR * 1.15 * st.scale) / IMPACT_PX);
    this.own = true;
  }

  /** The shadow of whatever is about to land on the mat (`k` 0..1; 0 hides it). */
  setShadow(at: Pt, k: number): void {
    if (this.destroyed) return;
    const s = this.shadow;
    if (k <= 0.002) { if (s.visible) { s.visible = false; this.refresh(); } return; }
    const px = this.dR * (1.2 + 1.6 * k);
    s.visible = true;
    s.position.set(at.x, at.y + this.dR * 0.55);
    s.scale.set(px / SHADOW_PX, (px * 0.36) / SHADOW_PX);
    s.alpha = 0.16 + 0.34 * k;
    this.own = true;
  }

  /** Tier 3: the turnbuckle, a pillar of light from the floor up to the perch, a glowing cap on top. */
  setPost(st: PostState): void {
    if (this.destroyed) return;
    if (!st.visible) { if (this.post.visible) { this.post.visible = false; this.postCap.visible = false; this.refresh(); } return; }
    const Rm = (this.aR + this.dR) / 2;
    this.line(this.post, st.x, st.foot, st.x, Math.min(st.foot - 1, st.top), Rm * 0.42, st.alpha);
    const c = this.postCap;
    c.visible = true; c.alpha = 0.9 * st.alpha;
    c.position.set(st.x, st.top);
    c.scale.set((Rm * 1.1) / GLOW_PX);
    this.own = true;
  }

  /** Tier 1: the neon folding chair, held, swung, and bursting apart into light (`burst` 0..1). */
  setChair(st: ChairState): void {
    if (this.destroyed) return;
    if (!st.visible || st.alpha <= 0.004) {
      if (this.chair[0]!.visible) { for (const s of this.chair) s.visible = false; this.refresh(); }
      return;
    }
    const u = st.size / 1.8;
    const cs = Math.cos(st.rot), sn = Math.sin(st.rot);
    const thick = Math.max(5, st.size * 0.18);
    for (let i = 0; i < CHAIR_SEGS.length; i++) {
      const [x0, y0, x1, y1] = CHAIR_SEGS[i]!;
      // Bursting: each length flies out from the middle and turns, getting shorter.
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const ml = Math.hypot(mx, my) || 1;
      const out = st.burst * 1.6;
      const ox = (mx / ml) * out + (i % 2 ? 0.25 : -0.25) * st.burst, oy = (my / ml) * out - 0.5 * st.burst;
      const shrink = 1 - 0.55 * st.burst;
      const tw = (i % 2 ? 1 : -1) * st.burst * 1.4;
      const hx = ((x1 - x0) / 2) * shrink, hy = ((y1 - y0) / 2) * shrink;
      const rx = hx * Math.cos(tw) - hy * Math.sin(tw), ry = hx * Math.sin(tw) + hy * Math.cos(tw);
      const ax = mx + ox - rx, ay = my + oy - ry, bx = mx + ox + rx, by = my + oy + ry;
      const px = st.x + (ax * cs - ay * sn) * u, py = st.y + (ax * sn + ay * cs) * u;
      const qx = st.x + (bx * cs - by * sn) * u, qy = st.y + (bx * sn + by * cs) * u;
      this.line(this.chair[i]!, px, py, qx, qy, thick, st.alpha);
    }
    this.own = true;
  }

  /** Stars circling the struck portrait's head (it is seeing stars). */
  setDizzy(st: DizzyState): void {
    if (this.destroyed) return;
    if (!st.visible || st.alpha <= 0.004) {
      if (this.dizzyStars[0]!.visible) { for (const s of this.dizzyStars) s.visible = false; this.refresh(); }
      return;
    }
    for (let i = 0; i < DIZZY_N; i++) {
      const s = this.dizzyStars[i]!;
      const a = st.phase + (i / DIZZY_N) * Math.PI * 2;
      const front = Math.sin(a); // the near half of the ring is bigger and brighter
      s.visible = true;
      s.position.set(st.x + Math.cos(a) * st.r, st.y + front * st.r * 0.28);
      s.rotation = st.phase * 2 + i;
      s.scale.set((this.dR * (0.62 + 0.18 * front)) / 48);
      s.alpha = st.alpha * (0.7 + 0.3 * front);
    }
    this.own = true;
  }

  /** Hide every own object (the end, a cancel). */
  hideOwn(): void {
    this.hideRing();
    this.cone.visible = false; this.pool.visible = false; this.elbow.visible = false; this.shadow.visible = false;
    this.post.visible = false; this.postCap.visible = false;
    for (const s of this.chair) s.visible = false;
    for (const s of this.dizzyStars) s.visible = false;
    this.own = false;
  }

  private refresh(): void {
    this.own = this.mat.visible || this.cone.visible || this.elbow.visible || this.shadow.visible || this.post.visible || this.chair[0]!.visible || this.dizzyStars[0]!.visible;
  }

  protected override tick(): boolean { return this.own; }
  protected override clearOwn(): void { this.hideOwn(); }

  // ── fire-and-forget ───────────────────────────────────────────────────────────────────────────────────────────

  /** A footfall: a little dust kicked back from under a portrait of radius `r`. */
  step(at: Pt, r: number, back: number): void {
    const S = this.scale;
    this.spawn('body', this.tex.puff, this.colors.mat, at.x, at.y + r * 0.8, {
      dur: 320, from: (r * 0.3) / PUFF_PX / S, to: (r * 0.65) / PUFF_PX / S, a0: 0.5, vx: back * 70, vy: -20, drag: 0.15,
    });
  }

  /** The chop's (and the clothesline's) arm: a wide flat arc swept across toward `dir` (+1 = screen right). */
  slapArc(at: Pt, dir: number, r: number, k = 1): void {
    const S = this.scale;
    const w = (r * 2.3 * k) / ARC_W / S;
    // The arc texture sweeps left to right: mirrored for a blow going left (a negative x scale, the y scale kept).
    const m = dir >= 0 ? 1 : -1;
    this.spawn('glow', this.tex.arc, 0xffffff, at.x, at.y - r * 0.15, { dur: 200, from: w * 0.85 * m, to: w * 1.12 * m, sy: 0.62 * m, a0: 0.95, ease: 'cubic', vx: dir * 120 });
    this.spawn('glow', this.tex.arc, this.colors.side, at.x - dir * r * 0.15, at.y - r * 0.15, { dur: 260, from: w * 0.7 * m, to: w * 1.25 * m, sy: 0.8 * m, a0: 0.5, ease: 'cubic' });
  }

  /**
   * I: the smack itself at `at`, and the red HAND PRINT left on the struck portrait at `print` (it rides the stagger).
   * The print is placed by the runner on the side of the portrait AWAY from the shared hit number, and it stays a full
   * second, so it is seen.
   */
  chop(at: Pt, print: Pt, dir: number, k: number, rings: number): void {
    const S = this.scale;
    const c = this.colors;
    const R = this.dR;
    const b = Math.max(0.3, k);
    this.spawn('glow', this.tex.glow, c.hand, print.x, print.y, { dur: 900, from: (R * 1.5) / GLOW_PX / S, to: (R * 1.9) / GLOW_PX / S, a0: 0.4, mode: 'hold', follow: true });
    this.spawn('body', this.tex.hand, c.hand, print.x, print.y, { dur: 1150, from: (R * 1.55) / HAND_PX / S, to: (R * 1.3) / HAND_PX / S, a0: 0.95, mode: 'hold', follow: true, rot: dir * 0.25 });
    this.spawn('glow', this.tex.glow, c.hand, at.x, at.y, { dur: 300, from: (R * 1.2) / GLOW_PX / S, to: (R * 2.4) / GLOW_PX / S, a0: 0.55, mode: 'punch', peakAt: 0.1, follow: true });
    this.spawn('core', this.tex.star, c.flash, at.x, at.y, { dur: 220, from: 0.6 * b, to: 1.9 * b, a0: 1, mode: 'punch', peakAt: 0.12, rot: 0.4 });
    for (let i = 0; i < Math.min(6, rings); i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? c.side : c.flash, at.x, at.y, { dur: 360 + 60 * i, from: (R * 0.5) / RING_PX / S, to: (R * (1.7 + 0.7 * i) * b) / RING_PX / S, a0: 0.75 - 0.1 * i, ease: 'cubic', delay: 60 * i });
    }
    // The sting flies off the way the hand went.
    this.burst('core', this.tex.spark, [c.flash, c.hand], at.x, at.y, Math.round(8 * b), { speed: 560 * b, dir: dir >= 0 ? 0 : Math.PI, spread: 1.5, life: 260, size: 0.42, drag: 0.1, align: true });
    this.burst('core', this.tex.star, [c.pow, 0xffffff], at.x, at.y, Math.round(4 * b), { speed: 300 * b, life: 420, size: 0.28, drag: 0.15, spin: 0.012, lift: 80, grav: 320 });
  }

  /** A body hits the MAT: flat rings of canvas dust racing out along the floor, puffs to both sides, grit thrown up. */
  matRing(at: Pt, r: number, k: number, rings: number): void {
    const S = this.scale;
    const c = this.colors;
    const y = at.y + r * 0.45;
    for (let i = 0; i < Math.max(1, Math.min(6, rings)); i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? c.flash : c.mat, at.x, y, { dur: 420 + 70 * i, from: (r * 0.8) / RING_PX / S, to: (r * (2.6 + 1.1 * i) * k) / RING_PX / S, sy: 0.3, a0: 0.8 - 0.1 * i, ease: 'cubic', delay: 50 * i });
    }
    const n = Math.round(4 + 4 * k);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const sp = (200 + this.rnd() * 240) * k;
      this.spawn('body', this.tex.puff, i % 3 ? c.mat : whiten(c.mat, 0.4), at.x + side * r * (0.5 + this.rnd() * 0.5), y + (this.rnd() - 0.5) * r * 0.2, {
        dur: 420 + this.rnd() * 220, from: (r * 0.4) / PUFF_PX / S, to: (r * (0.75 + this.rnd() * 0.3)) / PUFF_PX / S, a0: 0.7, vx: side * sp, vy: -30 - this.rnd() * 50, drag: 0.06,
      });
    }
    this.burst('core', this.tex.spark, [c.flash, c.mat], at.x, y, Math.round(6 * k), { speed: 380 * k, dir: -Math.PI / 2, spread: 2.4, life: 320, size: 0.35, drag: 0.15, grav: 700, align: true });
  }

  /**
   * A HEAVY body hits the mat (the slam, the elbow, the finisher's landing): on top of `matRing`, a wide thick shock ring
   * racing out along the floor, streaks of grit thrown flat to both sides, canvas dust that HANGS in the air for a
   * second (the aftermath), and grit thrown up that falls back.
   */
  matShock(at: Pt, r: number, k: number, rings: number): void {
    const S = this.scale;
    const c = this.colors;
    const y = at.y + r * 0.45;
    const b = Math.max(0.4, k);
    this.matRing(at, r, b, rings);
    for (let i = 0; i < 2; i++) {
      this.spawn('glow', this.tex.ring, i ? c.mat : c.flash, at.x, y, { dur: 560 + 120 * i, from: (r * 1.2) / RING_PX / S, to: (r * (6.5 + 1.6 * i) * b) / RING_PX / S, sy: 0.28, a0: 0.95 - 0.25 * i, ease: 'cubic', delay: 30 * i });
    }
    this.spawn('core', this.tex.glow, c.flash, at.x, y, { dur: 220, from: (r * 1.6) / GLOW_PX / S, to: (r * 4 * b) / GLOW_PX / S, sy: 0.3, a0: 0.45, mode: 'punch', peakAt: 0.12 });
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        this.spawn('glow', this.tex.streak, i % 2 ? c.mat : 0xffffff, at.x + side * r * 0.8, y + (i - 1) * r * 0.16, { dur: 260 + 40 * i, from: 1.5 * b, to: 0.6, a0: 0.7, sy: 0.16, rot: side > 0 ? 0 : Math.PI, vx: side * (900 + 260 * i) * b, drag: 0.05, ease: 'linear' });
      }
    }
    // The dust that hangs: big slow puffs drifting out and up.
    const n = Math.round(5 + 3 * b);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      this.spawn('body', this.tex.puff, i % 3 ? c.mat : whiten(c.mat, 0.5), at.x + side * r * (0.3 + this.rnd() * 1.5), y + (this.rnd() - 0.6) * r * 0.3, {
        dur: 1000 + this.rnd() * 600, from: (r * 0.7) / PUFF_PX / S, to: (r * (1.4 + this.rnd() * 0.7)) / PUFF_PX / S, a0: 0.42, mode: 'hold', ease: 'cubic',
        vx: side * (70 + this.rnd() * 130) * b, vy: -22 - this.rnd() * 30, drag: 0.35, delay: this.rnd() * 60, spin: (this.rnd() - 0.5) * 0.0006,
      });
    }
    this.burst('core', this.tex.spark, [c.flash, c.mat, 0xffffff], at.x, y, Math.round(12 * b), { speed: 620 * b, dir: -Math.PI / 2, spread: 2.6, life: 520, size: 0.4, drag: 0.2, grav: 1100, align: true });
    this.burst('body', this.tex.puff, [c.mat], at.x, y, Math.round(5 * b), { speed: 420 * b, dir: -Math.PI / 2, spread: 2.2, life: 620, size: (r * 0.16) / PUFF_PX / S, drag: 0.25, grav: 900, mode: 'hold', to: 0.8 });
  }

  /** A whole-frame FLASH on a big hit, brightest at `at` (`k` 0..1; one short additive pulse, no filter). */
  flash(at: Pt, k: number): void {
    if (!(k > 0)) return;
    const S = this.scale;
    const span = Math.max(this.look.frameW ?? 1920, this.look.frameH ?? 1080);
    this.spawn('core', this.tex.glow, this.colors.flash, at.x, at.y, { dur: 190, from: (span * 2.2) / GLOW_PX / S, to: (span * 2.6) / GLOW_PX / S, a0: Math.min(0.75, k), mode: 'punch', peakAt: 0.14 });
  }

  /** A big hit on a portrait (the slam, the elbow, the clothesline): a flash, the comic impact star, stars thrown off. */
  wallop(at: Pt, r: number, k: number): void {
    const S = this.scale;
    const c = this.colors;
    const b = Math.max(0.3, k);
    this.spawn('core', this.tex.glow, c.flash, at.x, at.y, { dur: 240, from: (r * 0.8 * b) / GLOW_PX / S, to: (r * 2.4 * b) / GLOW_PX / S, a0: 0.9, mode: 'punch', peakAt: 0.1 });
    this.spawn('body', this.tex.impact, whiten(c.pow, 0.35), at.x, at.y, { dur: 300, from: (r * 0.9 * Math.sqrt(b)) / IMPACT_PX / S, to: (r * 1.9 * Math.sqrt(b)) / IMPACT_PX / S, a0: 0.95, mode: 'hold', rot: (this.rnd() - 0.5) * 0.8 });
    this.spawn('glow', this.tex.glow, c.side, at.x, at.y, { dur: 340, from: (r * 1.2) / GLOW_PX / S, to: (r * 3 * b) / GLOW_PX / S, a0: 0.45, mode: 'punch', peakAt: 0.15 });
    this.burst('core', this.tex.star, [c.pow, c.flash, 0xffffff], at.x, at.y, Math.round(8 * b), { speed: 520 * b, life: 620, size: 0.38, drag: 0.15, spin: 0.012, lift: 120, grav: 380 });
  }

  /** IV: the far ropes take the weight: a creak of sparks off the bend and speed lines thrown back. */
  ropeTwang(at: Pt, out: number): void {
    const r = this.dR;
    for (const off of [-0.6, 0, 0.6]) {
      this.spawn('glow', this.tex.streak, 0xffffff, at.x + out * r * 0.9, at.y + r * off, { dur: 220, from: 0.9, to: 0.4, a0: 0.55, sy: 0.16, rot: out >= 0 ? Math.PI : 0, vx: -out * 420, drag: 0.1, ease: 'linear' });
    }
    this.burst('core', this.tex.spark, [0xffffff, this.colors.pow], at.x + out * r, at.y, 5, { speed: 300, dir: out >= 0 ? 0 : Math.PI, spread: 2, life: 240, size: 0.32, drag: 0.15, align: true });
  }

  /** Speed lines behind a portrait that has been thrown (the whip, the rebound): `dir` is the way it is going. */
  rush(at: Pt, dir: number, r: number): void {
    for (const off of [-0.5, 0.1, 0.6]) {
      this.spawn('glow', this.tex.streak, 0xffffff, at.x - dir * r * 0.9, at.y + r * off, { dur: 170, from: 1.1, to: 0.5, a0: 0.4, sy: 0.14, rot: dir >= 0 ? 0 : Math.PI, ease: 'linear' });
    }
  }

  /** IV: one number of the COUNT slams down LARGE (`i` 0..2, each bigger than the last), with a flash and a ring as it lands. */
  count(at: Pt, i: number): void {
    const S = this.scale;
    const n = Math.max(0, Math.min(2, i));
    const t = [this.tex.num1, this.tex.num2, this.tex.num3][n]!;
    const px = this.dR * (2.3 + 0.35 * n) * Math.max(0.2, this.look.wordSize);
    const k = px / NUM_PX / S;
    const rot = (n - 1) * 0.1;
    this.spawn('glow', this.tex.glow, this.colors.pow, at.x, at.y, { dur: 320, from: (px * 0.9) / GLOW_PX / S, to: (px * 1.9) / GLOW_PX / S, a0: 0.7, mode: 'punch', peakAt: 0.25 });
    // It arrives from three times the size in about 90 ms (the quint ease does the slam), then sits.
    this.spawn('body', t, 0xffffff, at.x, at.y, { dur: 430, from: k * 3.2, to: k, a0: 1, mode: 'hold', ease: 'quint', rot });
    this.spawn('core', t, 0xffffff, at.x, at.y, { dur: 200, from: k * 1.1, to: k * 1.22, a0: 0.7, mode: 'out', ease: 'cubic', rot, delay: 70 });
    for (let j = 0; j < 2; j++) {
      this.spawn('glow', this.tex.ring, j ? 0xffffff : this.colors.pow, at.x, at.y, { dur: 340 + 80 * j, from: (px * 0.5) / RING_PX / S, to: (px * (1.5 + 0.5 * j)) / RING_PX / S, a0: 0.75 - 0.2 * j, ease: 'cubic', delay: 70 + 40 * j });
    }
    this.burst('core', this.tex.spark, [this.colors.pow, 0xffffff], at.x, at.y, 8 + 2 * n, { speed: 520, life: 300, size: 0.42, drag: 0.12, align: true });
  }

  /** IV: a SLAP OF THE MAT beside the pin (a flat ring racing out, dust to both sides, lines thrown up). */
  matSlap(at: Pt, r: number, k = 1): void {
    const S = this.scale;
    const c = this.colors;
    for (let i = 0; i < 2; i++) {
      this.spawn('glow', this.tex.ring, i ? c.mat : c.flash, at.x, at.y, { dur: 300 + 100 * i, from: (r * 0.4) / RING_PX / S, to: (r * (2.4 + 1.4 * i) * k) / RING_PX / S, sy: 0.3, a0: 0.9 - 0.3 * i, ease: 'cubic', delay: 40 * i });
    }
    this.spawn('core', this.tex.glow, c.flash, at.x, at.y, { dur: 200, from: (r * 0.6) / GLOW_PX / S, to: (r * 1.8 * k) / GLOW_PX / S, sy: 0.4, a0: 0.7, mode: 'punch', peakAt: 0.15 });
    for (const side of [-1, 1]) {
      this.spawn('body', this.tex.puff, c.mat, at.x + side * r * 0.3, at.y, { dur: 420, from: (r * 0.35) / PUFF_PX / S, to: (r * 0.8) / PUFF_PX / S, a0: 0.65, vx: side * 220 * k, vy: -40, drag: 0.1 });
    }
    for (const a of [-2.4, -1.95, -Math.PI / 2, -1.2, -0.75]) {
      this.spawn('glow', this.tex.streak, 0xffffff, at.x + Math.cos(a) * r * 0.45, at.y + Math.sin(a) * r * 0.45, { dur: 200, from: 0.55 * k, to: 0.3, a0: 0.85, sy: 0.2, rot: a, vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, drag: 0.1, ease: 'linear' });
    }
  }

  /** IV: the BELL, as light: three rings of sound go out over the pin, one per ding, each with a star flash and rays. */
  bell(at: Pt, r: number): void {
    const S = this.scale;
    const px = r * 1.5;
    for (let i = 0; i < 3; i++) {
      const delay = 170 * i;
      this.spawn('core', this.tex.star, this.colors.flash, at.x, at.y, { dur: 240, from: 0.9, to: 2.6, a0: 1, mode: 'punch', peakAt: 0.15, rot: 0.3 * i, delay });
      this.spawn('glow', this.tex.ring, this.colors.pow, at.x, at.y, { dur: 460, from: (px * 0.5) / RING_PX / S, to: (px * 3) / RING_PX / S, a0: 0.85, ease: 'cubic', delay });
      this.spawn('glow', this.tex.ring, 0xffffff, at.x, at.y, { dur: 380, from: (px * 0.4) / RING_PX / S, to: (px * 2.2) / RING_PX / S, a0: 0.5, ease: 'cubic', delay: delay + 50 });
    }
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * Math.PI * 2 + 0.2;
      this.spawn('glow', this.tex.streak, this.colors.pow, at.x + Math.cos(a) * px * 0.5, at.y + Math.sin(a) * px * 0.5, { dur: 300, from: 0.8, to: 0.4, a0: 0.8, sy: 0.18, rot: a, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, drag: 0.08, ease: 'linear' });
    }
  }

  /** IV: WINNER: the word over the winner, a glow, a shower of stars. */
  winner(at: Pt, r: number, k: number): void {
    const S = this.scale;
    const c = this.colors;
    this.spawn('glow', this.tex.glow, c.side, at.x, at.y, { dur: 620, from: (r * 1.5) / GLOW_PX / S, to: (r * 3.4) / GLOW_PX / S, a0: 0.5, mode: 'punch', peakAt: 0.2 });
    this.burst('core', this.tex.star, [c.pow, c.side, 0xffffff], at.x, at.y - r * 0.3, Math.round(16 * k), { speed: 560, dir: -Math.PI / 2, spread: 2.8, life: 900, size: 0.4, drag: 0.2, spin: 0.012, grav: 560 });
    this.word('winner', { x: at.x, y: at.y - r * 1.75 }, 2.5, -0.06, 900, 1.5);
  }

  /**
   * THE CROWD'S CAMERA FLASHES: `n` pops of white light along the bottom and top edges of the screen (where the crowd
   * is), spread over `ms`, each a hard flash with a star glint and a soft bloom. Deterministic from the scene's seed.
   */
  crowdFlashes(n: number, ms: number): void {
    const S = this.scale;
    const fw = this.look.frameW ?? 1920, fh = this.look.frameH ?? 1080;
    const R = (this.aR + this.dR) / 2;
    for (let i = 0; i < Math.round(n); i++) {
      const bottom = this.rnd() < 0.7;
      const x = fw * (0.03 + this.rnd() * 0.94);
      const y = bottom ? fh - R * (0.15 + this.rnd() * 0.5) : R * (0.1 + this.rnd() * 0.35);
      const delay = this.rnd() * ms;
      const k = 0.6 + this.rnd() * 0.6;
      this.spawn('core', this.tex.glow, 0xffffff, x, y, { dur: 200, from: (R * 0.9 * k) / GLOW_PX / S, to: (R * 1.6 * k) / GLOW_PX / S, a0: 0.9, mode: 'punch', peakAt: 0.08, delay });
      this.spawn('core', this.tex.star, 0xffffff, x, y, { dur: 160, from: 0.5 * k, to: 1.1 * k, a0: 1, mode: 'punch', peakAt: 0.1, rot: this.rnd() * 3, delay });
    }
  }

  /** The cutter: a streak of light behind the striker flying in from off the screen (`dir` is the way it is going). */
  flyBy(at: Pt, dir: number, r: number): void {
    for (const off of [-0.55, -0.15, 0.25, 0.6]) {
      this.spawn('glow', this.tex.streak, 0xffffff, at.x - dir * r * 1.2, at.y + r * off, { dur: 260, from: 2.2, to: 0.8, a0: 0.6, sy: 0.18, rot: dir >= 0 ? 0 : Math.PI, vx: dir * 300, ease: 'linear' });
    }
    this.spawn('glow', this.tex.glow, this.colors.side, at.x, at.y, { dur: 260, from: (r * 1.5) / GLOW_PX / this.scale, to: (r * 2.6) / GLOW_PX / this.scale, a0: 0.4, mode: 'punch', peakAt: 0.2 });
  }

  /** The chair bursting on the hit: sparks and shards of its light thrown out, and a ring. */
  chairBurst(at: Pt, r: number, k: number): void {
    const S = this.scale;
    this.burst('core', this.tex.spark, [CHAIR_TINT, 0xffffff], at.x, at.y, Math.round(16 * k), { speed: 720 * k, life: 380, size: 0.45, drag: 0.12, align: true, grav: 500 });
    this.burst('glow', this.tex.streak, [CHAIR_TINT], at.x, at.y, 8, { speed: 520 * k, life: 300, size: 0.5, drag: 0.1, align: true });
    this.spawn('glow', this.tex.ring, CHAIR_TINT, at.x, at.y, { dur: 360, from: (r * 0.5) / RING_PX / S, to: (r * 3.4 * k) / RING_PX / S, a0: 0.85, ease: 'cubic' });
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 240, from: 0.8 * k, to: 2.6 * k, a0: 1, mode: 'punch', peakAt: 0.12 });
  }

  /** Dizzy stars turning over the one on the mat. */
  dizzy(at: Pt, r: number): void {
    const S = this.scale;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      this.spawn('core', this.tex.star, this.colors.pow, at.x + Math.cos(a) * r * 0.6, at.y - r * 0.75 + Math.sin(a) * r * 0.18, {
        dur: 1000, from: 0.4 / S, to: 0.24 / S, a0: 1, mode: 'hold', vx: -Math.sin(a) * 90, vy: Math.cos(a) * 26, drag: 0.6, spin: 0.01,
      });
    }
  }

  /** A word popping in over a point, a little tilted, drifting up as it fades; kept inside the frame. */
  word(w: WrestleWord, at: Pt, strength: number, rot = -0.08, dur = 700, size = 1): void {
    if (this.look.wordSize <= 0) return;
    const S = this.scale;
    const width = this.dR * 1.9 * size * this.look.wordSize * Math.min(1.5, 0.75 + 0.3 * strength);
    const k = width / WORD_W / S;
    const hh = width * (WORD_H / WORD_W);
    const fw = this.look.frameW ?? Infinity, fh = this.look.frameH ?? Infinity;
    const x = Math.min(Math.max(at.x, width * 0.55), Math.max(width * 0.55, fw - width * 0.55));
    const y = Math.min(Math.max(at.y, hh * 0.75 + 20), Math.max(hh * 0.75 + 20, fh - hh * 0.75));
    const t = this.wordTex(w);
    this.spawn('body', t, 0xffffff, x, y, { dur, from: k * 0.5, to: k * 1.06, a0: 1, mode: 'hold', ease: 'quint', rot, vy: -36, drag: 0.4 });
    this.spawn('glow', t, this.colors.side, x, y, { dur: dur * 0.6, from: k * 0.55, to: k * 1.22, a0: 0.35, mode: 'punch', peakAt: 0.15, rot });
  }
}
