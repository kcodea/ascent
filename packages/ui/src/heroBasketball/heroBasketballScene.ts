/**
 * THE BASKETBALL SCENE: what the Basketball attack draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`),
 * so it runs (and is tested) headless. The PORTRAIT is the player (the runner moves it); this draws the ball, the
 * shadows, the hoop on the target and the hits. `heroBasketball.ts` mounts `root` on the above-portrait overlay.
 *
 * OWN OBJECTS (one each, positioned by the runner every frame from the pure path, hidden the moment they are not
 * needed and on every exit): the BALL (tinted orange, spinning, squashing on a bounce), its SHADOW on the floor, the
 * PORTRAIT'S SHADOW (only while it is in the air: it drops away and shrinks as it rises), and the HOOP on the target
 * (the backboard, the net and the rim; the rim is drawn over the ball so a shot goes THROUGH it, and it rattles).
 *
 * FIRE-AND-FORGET (pooled, under a hard cap): the ball's soft trail, the dribble's dust, the sneakers' skid marks, the
 * release glint, the SWISH (a net ring, sparkles, the word), IV's clang off the backboard, the catch flashes, and the SLAM
 * (a flash, shockwave rings, sparks, dust, the word; IV adds an explosion: a fireball, debris,
 * the backboard's glass shards).
 */
import { Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import type { BallState } from './heroBasketballConfig';

export interface HeroBasketballTextures extends HeroArcanaTextures {
  ball: Texture;
  shadow: Texture;
  rim: Texture;
  net: Texture;
  board: Texture;
  shard: Texture;
  confetti: Texture;
  wordSwish: Texture;
  wordSlam: Texture;
}

export interface BasketballColors { ball: number; rim: number; net: number; glass: number; flash: number; blast: number; confettiA: number; confettiB: number; side: number }

export interface BasketballLook {
  /** The ball's diameter in striker radii. */
  ballSize: number;
  /** How far a shadow drops below what casts it, in striker radii at full height. */
  shadowDrop: number;
  hoopSize: number;
  wordSize: number;
}

/** Hard cap on pooled sprites alive at once (a Tier IV peaks near 150). The six own objects are outside the pool. */
export const MAX_BASKETBALL_SPRITES = 320;
const RING_PX = 160;
const GLOW_PX = 128;
const SHADOW_PX = 64;
const BALL_PX = 128;
const RIM_W = 192;
const NET_W = 160;
const BOARD_W = 256;
const WORD_W = 512;
const WORD_H = 176;

export class HeroBasketballScene extends FxPool {
  private readonly ball: Sprite;
  private readonly ballShadow: Sprite;
  private readonly heroShadow: Sprite;
  private readonly board: Sprite;
  private readonly net: Sprite;
  private readonly rim: Sprite;
  private own = false;

  /** `aR` / `dR`: the striking and struck portraits' radii (screen px). */
  constructor(
    private readonly tex: HeroBasketballTextures, private readonly colors: BasketballColors, private readonly look: BasketballLook,
    private readonly aR: number, private readonly dR: number, scale = 1, seed = 1,
  ) {
    super('heroBasketball', [tex.glow, tex.ring, tex.star, tex.streak, tex.spark, tex.ball, tex.shard, tex.confetti, tex.wordSwish, tex.wordSlam], scale, seed, MAX_BASKETBALL_SPRITES);
    const mk = (layer: 'under' | 'body', t: Texture, tint: number, ax = 0.5, ay = 0.5): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.tint = tint; s.visible = false; s.eventMode = 'none';
      this.layers[layer].addChild(s);
      return s;
    };
    this.heroShadow = mk('under', tex.shadow, 0x000000);
    this.ballShadow = mk('under', tex.shadow, 0x000000);
    this.board = mk('body', tex.board, colors.glass, 0.5, 1);
    this.net = mk('body', tex.net, colors.net, 0.5, 0);
    this.ball = mk('body', tex.ball, colors.ball);
    this.rim = mk('body', tex.rim, colors.rim);
  }

  /** Whether any own object still draws (the ball, a shadow, the hoop). */
  get ownVisible(): boolean { return this.own; }

  // ── own objects (the runner writes them every frame) ──────────────────────────────────────────────────────────

  /** The ball and its shadow. */
  setBall(b: BallState): void {
    if (this.destroyed) return;
    const s = this.ball, sh = this.ballShadow;
    if (!b.visible || b.alpha <= 0.002 || b.scale <= 0.002) { s.visible = false; sh.visible = false; return; }
    const px = this.aR * 2 * this.look.ballSize * b.scale;
    const k = px / BALL_PX;
    s.visible = true;
    s.position.set(b.x, b.y);
    s.rotation = b.rot;
    s.scale.set(k * (1 + b.squash * 0.6), k * (1 - b.squash));
    s.alpha = b.alpha;
    // The shadow on the floor: below the ball, further and smaller and fainter the higher it is.
    const drop = this.aR * this.look.shadowDrop * (0.25 + b.air);
    const sk = (px * (1 - 0.45 * b.air)) / SHADOW_PX;
    sh.visible = true;
    sh.position.set(b.x, b.y + drop);
    sh.scale.set(sk, sk * 0.45);
    sh.alpha = 0.32 * (1 - 0.55 * b.air) * b.alpha;
    this.refresh();
  }

  /** The portrait's shadow while it is off the floor (`at` = its centre, screen px; `air` 0..1). Hidden on the floor. */
  setHeroShadow(at: Pt | null, air: number, scale: number): void {
    if (this.destroyed) return;
    const s = this.heroShadow;
    if (!at || air <= 0.02) { s.visible = false; this.refresh(); return; }
    const px = this.aR * 1.9 * scale * (1 - 0.4 * air);
    s.visible = true;
    s.position.set(at.x, at.y + this.aR * (0.35 + this.look.shadowDrop * air));
    s.scale.set(px / SHADOW_PX, (px * 0.42) / SHADOW_PX);
    s.alpha = 0.38 * Math.min(1, air * 4) * (1 - 0.45 * air);
    this.refresh();
  }

  /** The hoop on the target (`at` = its centre): opacity, the rim's rattle (radians), whether the backboard stands. */
  setHoop(at: Pt, alpha: number, rattle: number, board: boolean, boardAt: Pt | null = null): void {
    if (this.destroyed) return;
    const show = alpha > 0.004;
    const w = this.dR * 1.35 * this.look.hoopSize;
    this.rim.visible = show; this.net.visible = show; this.board.visible = show && board;
    if (show) {
      const rk = w / RIM_W;
      this.rim.position.set(at.x, at.y); this.rim.scale.set(rk); this.rim.rotation = rattle; this.rim.alpha = alpha;
      const nk = (w * 0.84) / NET_W;
      this.net.position.set(at.x, at.y + w * 0.06); this.net.scale.set(nk, nk * (1 + Math.abs(rattle) * 0.8)); this.net.rotation = rattle * 0.5; this.net.alpha = alpha * 0.78;
      const bk = (w * 1.45) / BOARD_W;
      // IV stands its backboard where the throw clangs (beside the portrait, never over the face); I-III above the rim.
      if (boardAt) { this.board.anchor.set(0.5, 0.5); this.board.position.set(boardAt.x, boardAt.y); } else { this.board.anchor.set(0.5, 1); this.board.position.set(at.x, at.y - w * 0.08); }
      this.board.scale.set(bk); this.board.rotation = rattle * 0.15; this.board.alpha = alpha * 0.55;
    }
    this.refresh();
  }

  /** Hide every own object (the end, a cancel). */
  hideOwn(): void {
    for (const s of [this.ball, this.ballShadow, this.heroShadow, this.board, this.net, this.rim]) s.visible = false;
    this.own = false;
  }

  private refresh(): void {
    this.own = this.ball.visible || this.ballShadow.visible || this.heroShadow.visible || this.rim.visible || this.net.visible || this.board.visible;
  }

  protected override tick(): boolean { return this.own; }
  protected override clearOwn(): void { this.hideOwn(); }

  // ── fire-and-forget ───────────────────────────────────────────────────────────────────────────────────────────

  /** A soft ghost of the ball left behind in flight. */
  trail(b: BallState): void {
    if (!b.visible) return;
    const S = this.scale;
    const k = (this.aR * 2 * this.look.ballSize * b.scale) / BALL_PX / S;
    this.spawn('body', this.tex.ball, whiten(this.colors.ball, 0.25), b.x, b.y, { dur: 170, from: k * 0.92, to: k * 0.7, a0: 0.26, rot: b.rot, ease: 'linear' });
  }

  /** The ball meets the floor on a dribble: a puff of dust and a faint ring. */
  dribble(at: Pt, strength: number): void {
    const S = this.scale;
    const r = this.aR * this.look.ballSize;
    this.spawn('glow', this.tex.ring, 0xffffff, at.x, at.y, { dur: 240, from: (r * 0.8) / RING_PX / S, to: (r * 2.1) / RING_PX / S, a0: 0.28 * strength, sy: 0.45, ease: 'cubic' });
    for (let i = 0; i < 3; i++) {
      const a = Math.PI + (i - 1) * 0.9 + (this.rnd() - 0.5) * 0.3;
      this.spawn('under', this.tex.glow, 0xd9c7a6, at.x, at.y + r * 0.2, {
        dur: 260 + this.rnd() * 80, from: (r * 0.5) / GLOW_PX / S, to: (r * 1.1) / GLOW_PX / S, a0: 0.28 * strength, vx: Math.cos(a) * 90, vy: -20, drag: 0.1,
      });
    }
  }

  /** A sneaker squeak: two short skid marks under the portrait and a small puff. `dir` = the way it is moving. */
  squeak(at: Pt, dir: Pt): void {
    const S = this.scale;
    const head = Math.atan2(dir.y, dir.x);
    const feet = { x: at.x, y: at.y + this.aR * 0.8 };
    for (const off of [-0.28, 0.28]) {
      const x = feet.x + Math.cos(head + Math.PI / 2) * this.aR * off, y = feet.y + Math.sin(head + Math.PI / 2) * this.aR * off;
      this.spawn('glow', this.tex.streak, 0xffffff, x, y, { dur: 220, from: 0.35, to: 0.55, a0: 0.45, sy: 0.25, rot: head, ease: 'cubic' });
    }
    this.spawn('under', this.tex.glow, 0xd9c7a6, feet.x, feet.y, { dur: 300, from: (this.aR * 0.5) / GLOW_PX / S, to: (this.aR * 1.1) / GLOW_PX / S, a0: 0.22, sy: 0.5 });
  }

  /** The shot leaves the hands: a small glint. */
  release(at: Pt): void {
    const S = this.scale;
    this.spawn('core', this.tex.star, this.colors.flash, at.x, at.y, { dur: 200, from: 0.3, to: 0.9, a0: 0.8, mode: 'punch', peakAt: 0.25, rot: 0.4 });
    this.spawn('glow', this.tex.glow, this.colors.side, at.x, at.y, { dur: 220, from: (this.aR * 0.4) / GLOW_PX / S, to: (this.aR * 1.1) / GLOW_PX / S, a0: 0.35, mode: 'punch', peakAt: 0.2 });
  }

  /**
   * SWISH: the net snaps (a white ring down through it), sparkles, the word pops over the target. `extra` (III's three):
   * more rings rippling out and a pop of confetti.
   */
  swish(at: Pt, burst: number, extra?: { rings: number; confetti: number }): void {
    const S = this.scale;
    const w = this.dR * 1.35 * this.look.hoopSize;
    const c = this.colors;
    this.spawn('glow', this.tex.ring, c.net, at.x, at.y + w * 0.1, { dur: 360, from: (w * 0.5) / RING_PX / S, to: (w * 1.25) / RING_PX / S, a0: 0.75, sy: 0.42, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, c.side, at.x, at.y + w * 0.3, { dur: 420, from: (w * 0.3) / RING_PX / S, to: (w * 1.0) / RING_PX / S, a0: 0.45, sy: 0.42, ease: 'cubic', delay: 60 });
    this.spawn('glow', this.tex.glow, c.side, at.x, at.y, { dur: 320, from: (w * 0.4) / GLOW_PX / S, to: (w * 1.2) / GLOW_PX / S, a0: 0.4 * burst, mode: 'punch', peakAt: 0.15 });
    this.burst('core', this.tex.star, [c.flash, c.side, c.net], at.x, at.y, Math.round(8 * burst), { speed: 360, life: 420, size: 0.35, drag: 0.15, spin: 0.01, lift: 120, grav: 380 });
    if (extra) {
      for (let i = 0; i < Math.min(6, extra.rings); i++) {
        this.spawn('glow', this.tex.ring, i % 2 ? c.side : c.net, at.x, at.y, { dur: 420 + 60 * i, from: (w * 0.4) / RING_PX / S, to: (w * (1.3 + 0.5 * i)) / RING_PX / S, a0: 0.6 - 0.1 * i, ease: 'cubic', delay: 90 + 70 * i });
      }
      this.confettiBurst(at, extra.confetti);
    }
    this.word(this.tex.wordSwish, at, 0.85 * burst);
  }

  /**
   * IV's EXPLOSION under the slam: a white-hot core, a fireball blooming out and rolling up, a second shock ring, a
   * ring of debris chunks thrown out and falling, and embers. `k` scales it.
   */
  private explosion(at: Pt, k: number): void {
    const S = this.scale;
    const c = this.colors;
    const R = this.dR * k;
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 220, from: (R * 0.6) / GLOW_PX / S, to: (R * 2.2) / GLOW_PX / S, a0: 1, mode: 'punch', peakAt: 0.08 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + this.rnd() * 0.5;
      const d = R * (0.2 + this.rnd() * 0.35);
      this.spawn('glow', this.tex.glow, i % 3 ? c.blast : whiten(c.blast, 0.45), at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, {
        dur: 520 + this.rnd() * 220, from: (R * 0.7) / GLOW_PX / S, to: (R * (1.8 + this.rnd() * 0.8)) / GLOW_PX / S, a0: 0.75, mode: 'punch', peakAt: 0.12,
        ease: 'cubic', vx: Math.cos(a) * 160, vy: Math.sin(a) * 110 - 120, drag: 0.2,
      });
    }
    this.spawn('glow', this.tex.ring, c.blast, at.x, at.y, { dur: 520, from: (R * 0.5) / RING_PX / S, to: (R * 4.2) / RING_PX / S, a0: 0.8, ease: 'cubic', delay: 40 });
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 3.6;
      const sp = 420 + this.rnd() * 620;
      this.spawn('body', this.tex.confetti, i % 2 ? 0x3a2a1c : 0x5c4630, at.x, at.y, {
        dur: 700 + this.rnd() * 300, from: 1.2 + this.rnd() * 1.2, to: 1, a0: 1, mode: 'hold', ease: 'linear',
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150, drag: 0.4, grav: 1600, rot: this.rnd() * Math.PI, spin: (this.rnd() - 0.5) * 0.03,
      });
    }
    this.burst('core', this.tex.spark, [c.blast, c.flash, whiten(c.blast, 0.5)], at.x, at.y, Math.round(18 * k), { speed: 900 * k, life: 520, size: 0.6, drag: 0.15, align: true, grav: 400 });
  }

  /** Confetti thrown up from a point, fluttering down. */
  private confettiBurst(at: Pt, count: number): void {
    const c = this.colors;
    const tints = [c.confettiA, c.confettiB, c.side, 0xffffff];
    for (let i = 0; i < Math.min(80, count); i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.8;
      const sp = 300 + this.rnd() * 500;
      this.spawn('body', this.tex.confetti, tints[i % tints.length]!, at.x, at.y - this.dR * 0.2, {
        dur: 1000 + this.rnd() * 500, from: 1.1 + this.rnd() * 0.8, to: 1, a0: 1, mode: 'hold', ease: 'linear',
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200, drag: 0.25, grav: 520, rot: this.rnd() * Math.PI, spin: (this.rnd() - 0.5) * 0.02, flip: 0.02,
        delay: this.rnd() * 60,
      });
    }
  }

  /** IV: the throw CLANGS off the backboard (`at` = the clang point, off the portrait): a small metal ring and sparks. */
  bounce(at: Pt): void {
    const S = this.scale;
    const r = this.aR * this.look.ballSize;
    const c = this.colors;
    this.spawn('glow', this.tex.ring, c.glass, at.x, at.y, { dur: 240, from: (r * 0.7) / RING_PX / S, to: (r * 2.2) / RING_PX / S, a0: 0.55, ease: 'cubic' });
    this.burst('core', this.tex.spark, [c.flash, c.rim], at.x, at.y, 6, { speed: 420, life: 240, size: 0.4, drag: 0.1, align: true });
  }

  /** A catch (III: the pass; IV: at the top of the leap): a bright flash on the ball. `k` scales it. */
  catchFlash(at: Pt, k = 1): void {
    const S = this.scale;
    const r = this.aR * this.look.ballSize * k;
    this.spawn('core', this.tex.star, this.colors.flash, at.x, at.y, { dur: 280, from: 0.5 * k, to: 1.8 * k, a0: 1, mode: 'punch', peakAt: 0.15, rot: 0.6 });
    this.spawn('glow', this.tex.glow, this.colors.side, at.x, at.y, { dur: 320, from: (r * 1) / GLOW_PX / S, to: (r * 3.4) / GLOW_PX / S, a0: 0.55, mode: 'punch', peakAt: 0.12 });
    this.spawn('glow', this.tex.ring, this.colors.side, at.x, at.y, { dur: 300, from: (r * 1) / RING_PX / S, to: (r * 3.6) / RING_PX / S, a0: 0.6, ease: 'cubic' });
  }

  /**
   * THE SLAM on the target (`at` = its centre; `dir` = the way the slam drives). A flash, shockwave rings, sparks and
   * dust thrown out, the word; IV's backboard bursts into glass shards and confetti rains.
   */
  slam(at: Pt, dir: Pt, o: { burst: number; rings: number; shards: number; confetti: number; blast?: number; boardAt?: Pt }): void {
    const S = this.scale;
    const c = this.colors;
    const R = this.dR;
    const b = Math.max(0.3, o.burst);
    this.spawn('core', this.tex.glow, c.flash, at.x, at.y, { dur: 260, from: (R * 0.8 * b) / GLOW_PX / S, to: (R * 2.6 * b) / GLOW_PX / S, a0: 0.95, mode: 'punch', peakAt: 0.1 });
    this.spawn('core', this.tex.star, c.flash, at.x, at.y, { dur: 300, from: 0.8 * b, to: 2.6 * b, a0: 1, mode: 'punch', peakAt: 0.12, rot: 0.3 });
    this.spawn('glow', this.tex.glow, c.side, at.x, at.y, { dur: 420, from: (R * 1.2 * b) / GLOW_PX / S, to: (R * 3.4 * b) / GLOW_PX / S, a0: 0.5, mode: 'punch', peakAt: 0.1 });
    for (let i = 0; i < Math.min(8, o.rings); i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? c.side : c.flash, at.x, at.y, {
        dur: 420 + 60 * i, from: (R * 0.6) / RING_PX / S, to: (R * (2.2 + 0.9 * i) * b) / RING_PX / S, a0: 0.8 - 0.1 * i, ease: 'cubic', delay: 70 * i,
      });
    }
    const head = Math.atan2(dir.y, dir.x);
    this.burst('core', this.tex.spark, [c.flash, c.ball, c.side], at.x, at.y, Math.round(14 * b), { speed: 700 * b, life: 380, size: 0.55, drag: 0.12, align: true });
    for (let i = 0; i < Math.round(5 * b); i++) {
      const a = head + Math.PI + (this.rnd() - 0.5) * 2.6;
      this.spawn('under', this.tex.glow, 0xd9c7a6, at.x, at.y, {
        dur: 420 + this.rnd() * 160, from: (R * 0.5) / GLOW_PX / S, to: (R * 1.3) / GLOW_PX / S, a0: 0.3, vx: Math.cos(a) * 180, vy: Math.sin(a) * 120, drag: 0.12,
      });
    }
    if ((o.blast ?? 0) > 0) this.explosion(at, o.blast!);
    if (o.shards > 0) {
      // The backboard bursts: glass slivers thrown up and out, spinning, falling.
      const w = this.dR * 1.35 * this.look.hoopSize;
      const bx = o.boardAt ? o.boardAt.x : at.x, by = o.boardAt ? o.boardAt.y : at.y - w * 0.55;
      for (let i = 0; i < Math.min(40, o.shards); i++) {
        const a = -Math.PI / 2 + (this.rnd() - 0.5) * 3.4;
        const sp = 380 + this.rnd() * 520;
        const sz = (0.45 + this.rnd() * 0.7) * (w / 180);
        this.spawn('body', this.tex.shard, i % 3 ? c.glass : 0xffffff, bx + (this.rnd() - 0.5) * w, by + (this.rnd() - 0.5) * w * 0.4, {
          dur: 700 + this.rnd() * 400, from: sz / S, to: sz * 0.8 / S, a0: 0.95, mode: 'hold', ease: 'linear',
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, drag: 0.5, grav: 1500, spin: (this.rnd() - 0.5) * 0.03, flip: 0.012,
        });
      }
    }
    if (o.confetti > 0) this.confettiBurst(at, o.confetti);
    this.word(this.tex.wordSlam, at, b);
  }

  /** A word popping in above the target and drifting up as it fades. */
  private word(t: Texture, at: Pt, strength: number): void {
    if (this.look.wordSize <= 0) return;
    const S = this.scale;
    const w = this.dR * 1.7 * this.look.wordSize * Math.min(1.4, 0.8 + 0.25 * strength);
    const k = w / WORD_W / S;
    // Above the target, but never off the top of the screen (a foe tucked in a corner): at least its own height down.
    const y = Math.max(at.y - this.dR * 1.05, w * (WORD_H / WORD_W) * 0.75 + 24);
    this.spawn('body', t, 0xffffff, at.x, y, { dur: 720, from: k * 0.55, to: k * 1.08, a0: 1, mode: 'hold', ease: 'quint', rot: -0.08, vy: y > at.y - this.dR * 1.05 + 1 ? 0 : -40, drag: 0.4 });
    this.spawn('glow', t, this.colors.side, at.x, y, { dur: 520, from: k * 0.6, to: k * 1.25, a0: 0.45, mode: 'punch', peakAt: 0.15, rot: -0.08 });
  }
}
