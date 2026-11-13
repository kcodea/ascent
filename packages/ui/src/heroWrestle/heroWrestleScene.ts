/**
 * THE WRESTLING SCENE: what the Top Rope attack draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so
 * it runs (and is tested) headless. The PORTRAITS are the wrestlers (the runner moves both); this draws the ring, the
 * light and the hits. `heroWrestle.ts` mounts `root` on the above-portrait overlay.
 *
 * OWN OBJECTS (positioned by the runner every frame from the pure state, hidden the moment they are not needed and on
 * every exit): IV's RING (four posts and, at each side, three ropes drawn as two stretchable lengths meeting at a bend,
 * which is pushed out when someone runs into them), III's SPOTLIGHT (a cone from the top edge and its pool on the mat),
 * III's ELBOW STAR leading the dive, and the SHADOW of whatever is about to land.
 *
 * FIRE-AND-FORGET (pooled, under a hard cap): the walk's dust, the chop's slap arc and red hand print, the hits, the
 * canvas-mat dust rings, the ropes' twang, the clothesline, the count's numbers and mat slaps, the bell and WINNER.
 */
import { Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import type { ElbowState, RingSide, RingState, SpotState } from './heroWrestleConfig';

export interface HeroWrestleTextures extends HeroArcanaTextures {
  rope: Texture;
  post: Texture;
  cone: Texture;
  hand: Texture;
  arc: Texture;
  impact: Texture;
  puff: Texture;
  shadow: Texture;
  bell: Texture;
  wordWoo: Texture;
  wordSlam: Texture;
  wordWinner: Texture;
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

/** Hard cap on pooled sprites alive at once (the finisher's count peaks near 120). The own objects are outside the pool. */
export const MAX_WRESTLE_SPRITES = 260;
const RING_PX = 160;
const GLOW_PX = 128;
const SHADOW_PX = 64;
const ROPE_W = 128;
const ROPE_H = 24;
const POST_H = 256;
const CONE_W = 256;
const CONE_H = 512;
const HAND_PX = 128;
const ARC_W = 256;
const IMPACT_PX = 256;
const PUFF_PX = 128;
const BELL_PX = 128;
const NUM_PX = 256;
const WORD_W = 512;
const WORD_H = 160;
/** Where the ropes tie on to a post (fractions of its height), and each rope's colour and share of a stretch. */
const ROPE_AT = [0.4, 0.66, 0.92] as const;
const ROPE_TINT = [0x4a7df0, 0xf6f6f6, 0xe8413c] as const;
const ROPE_GIVE = [0.82, 1, 0.9] as const;

export type WrestleWord = 'woo' | 'slam' | 'winner';

export class HeroWrestleScene extends FxPool {
  private readonly posts: Sprite[] = [];
  private readonly ropes: Sprite[] = [];
  private readonly cone: Sprite;
  private readonly pool: Sprite;
  private readonly elbow: Sprite;
  private readonly shadow: Sprite;
  private own = false;

  /** `aR` / `dR`: the striking and the struck portraits' radii (screen px). */
  constructor(
    private readonly tex: HeroWrestleTextures, private readonly colors: WrestleColors, private readonly look: WrestleLook,
    private readonly aR: number, private readonly dR: number, scale = 1, seed = 1,
  ) {
    super('heroWrestle', [
      tex.glow, tex.ring, tex.star, tex.streak, tex.spark, tex.rope, tex.post, tex.cone, tex.hand, tex.arc, tex.impact, tex.puff, tex.shadow, tex.bell,
      tex.wordWoo, tex.wordSlam, tex.wordWinner, tex.num1, tex.num2, tex.num3,
    ], scale, seed, MAX_WRESTLE_SPRITES);
    const mk = (layer: 'under' | 'glow' | 'body', t: Texture, tint: number, ax = 0.5, ay = 0.5): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.tint = tint; s.visible = false; s.eventMode = 'none';
      if (layer === 'glow') s.blendMode = 'add';
      this.layers[layer].addChild(s);
      return s;
    };
    this.shadow = mk('under', tex.shadow, 0x000000);
    this.cone = mk('glow', tex.cone, colors.spot, 0.5, 0);
    this.pool = mk('glow', tex.glow, colors.spot);
    // The ring, back to front: the two back posts, the ropes, the two front posts.
    this.posts.push(mk('body', tex.post, 0xdfe4f2, 0.5, 1), mk('body', tex.post, 0xdfe4f2, 0.5, 1));
    for (let side = 0; side < 2; side++) for (let i = 0; i < 3; i++) for (let half = 0; half < 2; half++) this.ropes.push(mk('body', tex.rope, ROPE_TINT[i]!, 0, 0.5));
    this.posts.push(mk('body', tex.post, 0xffffff, 0.5, 1), mk('body', tex.post, 0xffffff, 0.5, 1));
    this.elbow = mk('body', tex.impact, 0xffffff);
  }

  /** Whether any own object still draws. */
  get ownVisible(): boolean { return this.own; }

  private wordTex(w: WrestleWord): Texture {
    const t = this.tex;
    return { woo: t.wordWoo, slam: t.wordSlam, winner: t.wordWinner }[w];
  }

  // ── own objects (the runner writes them every frame) ──────────────────────────────────────────────────────────

  /** IV: the ring. `sides` is where its posts stand (near, far); `st` how far it has risen and each side's stretch. */
  setRing(sides: readonly [RingSide, RingSide], st: RingState): void {
    if (this.destroyed) return;
    if (!st.visible) {
      if (this.posts[0]!.visible) { for (const s of this.posts) s.visible = false; for (const s of this.ropes) s.visible = false; this.refresh(); }
      return;
    }
    const thick = ((this.aR + this.dR) / 2) * 0.11 * this.look.ropeSize;
    for (let k = 0; k < 2; k++) {
      const sd = sides[k]!;
      const push = k === 0 ? st.near : st.far;
      const bH = sd.backH * st.rise, fH = sd.frontH * st.rise;
      const back = this.posts[k]!, front = this.posts[2 + k]!;
      back.visible = true; back.alpha = st.alpha;
      back.position.set(sd.back.x, sd.back.y);
      back.scale.set(sd.backH / POST_H, bH / POST_H);
      front.visible = true; front.alpha = st.alpha;
      front.position.set(sd.front.x, sd.front.y);
      front.scale.set(sd.frontH / POST_H, fH / POST_H);
      for (let i = 0; i < 3; i++) {
        const f = ROPE_AT[i]!;
        const px = sd.back.x, py = sd.back.y - bH * f;
        const qx = sd.front.x, qy = sd.front.y - fH * f;
        // The bend: the middle of the rope, pushed OUT of the ring by whoever ran into it.
        const mx = (px + qx) / 2 + sd.out * push * ROPE_GIVE[i]!, my = (py + qy) / 2;
        const rest = Math.hypot(qx - px, qy - py) / 2 || 1;
        for (let half = 0; half < 2; half++) {
          const s = this.ropes[k * 6 + i * 2 + half]!;
          const x0 = half === 0 ? px : mx, y0 = half === 0 ? py : my;
          const x1 = half === 0 ? mx : qx, y1 = half === 0 ? my : qy;
          const len = Math.hypot(x1 - x0, y1 - y0);
          s.visible = true; s.alpha = st.alpha;
          s.position.set(x0, y0);
          s.rotation = Math.atan2(y1 - y0, x1 - x0);
          // A stretched rope is a thinner rope. The back end is further away, so a touch thinner too.
          s.scale.set(len / ROPE_W, (thick * (half === 0 ? 0.88 : 1) * Math.max(0.6, rest / Math.max(rest, len))) / ROPE_H);
        }
      }
    }
    this.own = true;
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

  /** Hide every own object (the end, a cancel). */
  hideOwn(): void {
    for (const s of this.posts) s.visible = false;
    for (const s of this.ropes) s.visible = false;
    this.cone.visible = false; this.pool.visible = false; this.elbow.visible = false; this.shadow.visible = false;
    this.own = false;
  }

  private refresh(): void {
    this.own = this.posts[0]!.visible || this.cone.visible || this.elbow.visible || this.shadow.visible;
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

  /** I: the red HAND PRINT left on the struck portrait (it rides the stagger), and the smack itself. */
  chop(at: Pt, dir: number, k: number, rings: number): void {
    const S = this.scale;
    const c = this.colors;
    const R = this.dR;
    const b = Math.max(0.3, k);
    this.spawn('body', this.tex.hand, c.hand, at.x - dir * R * 0.3, at.y + R * 0.3, { dur: 760, from: (R * 1.25) / HAND_PX / S, to: (R * 1.1) / HAND_PX / S, a0: 0.9, mode: 'hold', follow: true, rot: dir * 0.25 });
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

  /** A big hit on a portrait (the slam, the elbow, the clothesline): a flash, the comic impact star, stars thrown off. */
  wallop(at: Pt, r: number, k: number): void {
    const S = this.scale;
    const c = this.colors;
    const b = Math.max(0.3, k);
    this.spawn('core', this.tex.glow, c.flash, at.x, at.y, { dur: 240, from: (r * 0.8 * b) / GLOW_PX / S, to: (r * 2.4 * b) / GLOW_PX / S, a0: 0.9, mode: 'punch', peakAt: 0.1 });
    this.spawn('body', this.tex.impact, whiten(c.pow, 0.35), at.x, at.y, { dur: 220, from: (r * 0.75 * Math.sqrt(b)) / IMPACT_PX / S, to: (r * 1.4 * Math.sqrt(b)) / IMPACT_PX / S, a0: 0.95, mode: 'out', rot: (this.rnd() - 0.5) * 0.8 });
    this.spawn('glow', this.tex.glow, c.side, at.x, at.y, { dur: 340, from: (r * 1.2) / GLOW_PX / S, to: (r * 3 * b) / GLOW_PX / S, a0: 0.45, mode: 'punch', peakAt: 0.15 });
    this.burst('core', this.tex.star, [c.pow, c.flash, 0xffffff], at.x, at.y, Math.round(6 * b), { speed: 400 * b, life: 480, size: 0.32, drag: 0.15, spin: 0.012, lift: 120, grav: 380 });
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

  /** IV: one number of the COUNT slams down (`i` 0..2), with a flash behind it. */
  count(at: Pt, i: number): void {
    const S = this.scale;
    const t = [this.tex.num1, this.tex.num2, this.tex.num3][Math.max(0, Math.min(2, i))]!;
    const px = this.dR * (1.5 + 0.22 * i) * Math.max(0.2, this.look.wordSize);
    const k = px / NUM_PX / S;
    this.spawn('glow', this.tex.glow, this.colors.pow, at.x, at.y, { dur: 260, from: (px * 0.9) / GLOW_PX / S, to: (px * 1.7) / GLOW_PX / S, a0: 0.6, mode: 'punch', peakAt: 0.2 });
    this.spawn('body', t, 0xffffff, at.x, at.y, { dur: 400, from: k * 2.3, to: k, a0: 1, mode: 'hold', ease: 'quint', rot: (i - 1) * 0.1 });
    this.spawn('glow', this.tex.ring, this.colors.pow, at.x, at.y, { dur: 300, from: (px * 0.5) / RING_PX / S, to: (px * 1.3) / RING_PX / S, a0: 0.6, ease: 'cubic', delay: 60 });
  }

  /** IV: a SLAP OF THE MAT beside the pin (a small flat ring, a puff of dust, three little lines). */
  matSlap(at: Pt, r: number): void {
    const S = this.scale;
    const c = this.colors;
    this.spawn('glow', this.tex.ring, c.flash, at.x, at.y, { dur: 260, from: (r * 0.3) / RING_PX / S, to: (r * 1.5) / RING_PX / S, sy: 0.32, a0: 0.8, ease: 'cubic' });
    this.spawn('body', this.tex.puff, c.mat, at.x, at.y, { dur: 300, from: (r * 0.3) / PUFF_PX / S, to: (r * 0.6) / PUFF_PX / S, a0: 0.6, vy: -40, drag: 0.2 });
    for (const a of [-2.2, -Math.PI / 2, -0.95]) {
      this.spawn('glow', this.tex.streak, 0xffffff, at.x + Math.cos(a) * r * 0.45, at.y + Math.sin(a) * r * 0.45, { dur: 180, from: 0.4, to: 0.25, a0: 0.8, sy: 0.2, rot: a, vx: Math.cos(a) * 200, vy: Math.sin(a) * 200, drag: 0.1, ease: 'linear' });
    }
  }

  /** IV: the BELL: it pops in, and three rings of sound go out, one per ding. */
  bell(at: Pt, r: number): void {
    const S = this.scale;
    const px = r * 1.3;
    this.spawn('body', this.tex.bell, 0xffffff, at.x, at.y, { dur: 820, from: (px * 0.5) / BELL_PX / S, to: px / BELL_PX / S, a0: 1, mode: 'hold', ease: 'quint', rot: -0.12, spin: 0.0003 });
    for (let i = 0; i < 3; i++) {
      this.spawn('glow', this.tex.ring, this.colors.pow, at.x, at.y, { dur: 380, from: (px * 0.6) / RING_PX / S, to: (px * 2.2) / RING_PX / S, a0: 0.7, ease: 'cubic', delay: 170 * i });
    }
  }

  /** IV: WINNER: the word over the winner, a glow, a shower of stars. */
  winner(at: Pt, r: number, k: number): void {
    const S = this.scale;
    const c = this.colors;
    this.spawn('glow', this.tex.glow, c.side, at.x, at.y, { dur: 620, from: (r * 1.5) / GLOW_PX / S, to: (r * 3.4) / GLOW_PX / S, a0: 0.5, mode: 'punch', peakAt: 0.2 });
    this.burst('core', this.tex.star, [c.pow, c.side, 0xffffff], at.x, at.y - r * 0.3, Math.round(10 * k), { speed: 420, dir: -Math.PI / 2, spread: 2.6, life: 700, size: 0.34, drag: 0.2, spin: 0.012, grav: 520 });
    this.word('winner', { x: at.x, y: at.y - r * 1.6 }, 2.5, -0.06, 640);
  }

  /** Dizzy stars turning over the one on the mat. */
  dizzy(at: Pt, r: number): void {
    const S = this.scale;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      this.spawn('core', this.tex.star, this.colors.pow, at.x + Math.cos(a) * r * 0.6, at.y - r * 0.75 + Math.sin(a) * r * 0.18, {
        dur: 760, from: 0.32 / S, to: 0.2 / S, a0: 1, mode: 'hold', vx: -Math.sin(a) * 90, vy: Math.cos(a) * 26, drag: 0.6, spin: 0.01,
      });
    }
  }

  /** A word popping in over a point, a little tilted, drifting up as it fades; kept inside the frame. */
  word(w: WrestleWord, at: Pt, strength: number, rot = -0.08, dur = 700): void {
    if (this.look.wordSize <= 0) return;
    const S = this.scale;
    const width = this.dR * 1.9 * this.look.wordSize * Math.min(1.5, 0.75 + 0.3 * strength);
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
