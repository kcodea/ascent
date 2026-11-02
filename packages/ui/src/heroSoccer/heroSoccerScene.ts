/**
 * THE SOCCER SCENE: what the Soccer attack draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so it
 * runs (and is tested) headless. The PORTRAIT is the player (the runner moves it); this draws the ball, the shadows,
 * the goal on the target, II's corner flag, III's defenders and the hits. `heroSoccer.ts` mounts `root` on the
 * above-portrait overlay.
 *
 * OWN OBJECTS (one each, positioned by the runner every frame from the pure path, hidden the moment they are not
 * needed and on every exit): the BALL (spinning, squashing on a strike), its SHADOW on the grass, the PORTRAIT'S SHADOW
 * (only while it is in the air), the GOAL on the target (the net, then the frame drawn over the ball so a shot goes IN;
 * the net BULGES on the impact and the frame shakes), the CORNER FLAG (II) and up to three DEFENDERS (III).
 *
 * FIRE-AND-FORGET (pooled, under a hard cap): the ball's trail (a fire trail on IV's thunderbolt), the grass puffs of a
 * touch, the strike's flash, the speed lines of a sprint, the knee slide's spray, a beaten defender's puff and word, and
 * THE GOAL (net ripples, sparks, the word; IV adds an explosion, a fireball and a confetti storm).
 */
import { Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import type { BallState, DefenderState, GoalLayout } from './heroSoccerConfig';

export interface HeroSoccerTextures extends HeroArcanaTextures {
  ball: Texture;
  shadow: Texture;
  goal: Texture;
  net: Texture;
  flag: Texture;
  defender: Texture;
  confetti: Texture;
  wordGoal: Texture;
  wordGolazo: Texture;
  wordNutmeg: Texture;
  wordOle: Texture;
}

export interface SoccerColors {
  ball: number; post: number; net: number; flag: number; defender: number; flash: number; fire: number; blast: number; confettiA: number; confettiB: number; side: number;
}

export interface SoccerLook {
  /** The ball's diameter in striker radii. */
  ballSize: number;
  /** How far a shadow drops below what casts it, in striker radii at full height. */
  shadowDrop: number;
  goalSize: number;
  wordSize: number;
}

export type SoccerWord = 'goal' | 'golazo' | 'nutmeg' | 'ole';

/** Hard cap on pooled sprites alive at once (a Tier IV peaks near 200). The own objects are outside the pool. */
export const MAX_SOCCER_SPRITES = 340;
const RING_PX = 160;
const GLOW_PX = 128;
const SHADOW_PX = 64;
const BALL_PX = 128;
const GOAL_W = 320;
const FLAG_H = 128;
const DEFENDER_PX = 128;
const WORD_W = 640;
const WORD_H = 176;
const GRASS = 0x7fc46a;
const DUST = 0xd9c7a6;
export const MAX_DEFENDERS = 3;

export class HeroSoccerScene extends FxPool {
  private readonly ball: Sprite;
  private readonly ballShadow: Sprite;
  private readonly heroShadow: Sprite;
  private readonly net: Sprite;
  private readonly goal: Sprite;
  private readonly flag: Sprite;
  private readonly defenders: Sprite[] = [];
  private own = false;

  /** `aR` / `dR`: the striking and struck portraits' radii (screen px). */
  constructor(
    private readonly tex: HeroSoccerTextures, private readonly colors: SoccerColors, private readonly look: SoccerLook,
    private readonly aR: number, private readonly dR: number, scale = 1, seed = 1,
  ) {
    super('heroSoccer', [tex.glow, tex.ring, tex.star, tex.streak, tex.spark, tex.ball, tex.confetti, tex.wordGoal, tex.wordGolazo, tex.wordNutmeg, tex.wordOle], scale, seed, MAX_SOCCER_SPRITES);
    const mk = (layer: 'under' | 'body', t: Texture, tint: number, ax = 0.5, ay = 0.5): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.tint = tint; s.visible = false; s.eventMode = 'none';
      this.layers[layer].addChild(s);
      return s;
    };
    this.heroShadow = mk('under', tex.shadow, 0x000000);
    this.ballShadow = mk('under', tex.shadow, 0x000000);
    this.net = mk('body', tex.net, colors.net);
    for (let i = 0; i < MAX_DEFENDERS; i++) this.defenders.push(mk('body', tex.defender, colors.defender));
    this.ball = mk('body', tex.ball, colors.ball);
    this.goal = mk('body', tex.goal, colors.post);
    // The flag's anchor is the pole's foot (lower left of the texture).
    this.flag = mk('body', tex.flag, colors.flag, 0.3, 0.97);
  }

  /** Whether any own object still draws. */
  get ownVisible(): boolean { return this.own; }

  // ── own objects (the runner writes them every frame) ──────────────────────────────────────────────────────────

  /** The ball and its shadow. */
  setBall(b: BallState): void {
    if (this.destroyed) return;
    const s = this.ball, sh = this.ballShadow;
    if (!b.visible || b.alpha <= 0.002 || b.scale <= 0.002) { s.visible = false; sh.visible = false; this.refresh(); return; }
    const px = this.aR * 2 * this.look.ballSize * b.scale;
    const k = px / BALL_PX;
    s.visible = true;
    s.position.set(b.x, b.y);
    s.rotation = b.rot;
    s.scale.set(k * (1 + b.squash * 0.6), k * (1 - b.squash));
    s.alpha = b.alpha;
    // The shadow on the grass: below the ball, further and smaller and fainter the higher it is.
    const drop = this.aR * this.look.shadowDrop * (0.2 + b.air * 1.2);
    const sk = (this.aR * 2 * this.look.ballSize * (1 - 0.45 * b.air)) / SHADOW_PX;
    sh.visible = true;
    sh.position.set(b.x, b.y + drop);
    sh.scale.set(sk, sk * 0.45);
    sh.alpha = 0.32 * (1 - 0.5 * b.air) * b.alpha;
    this.refresh();
  }

  /** The portrait's shadow while it is off the grass (`at` = its centre, screen px; `air` 0..1). Hidden on the grass. */
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

  /**
   * The goal on the target (ONE assembly from `goalLayout`): its opacity, the NET'S BULGE (pushed out along `dir`, the way
   * the shot went in) and the frame's shake (radians).
   */
  setGoal(gl: GoalLayout, alpha: number, bulge: number, shake: number, dir: Pt): void {
    if (this.destroyed) return;
    const show = alpha > 0.004;
    this.goal.visible = show; this.net.visible = show;
    if (show) {
      const k = gl.w / GOAL_W;
      this.goal.position.set(gl.center.x, gl.center.y); this.goal.scale.set(k); this.goal.rotation = shake; this.goal.alpha = alpha;
      const b = Math.max(0, bulge);
      this.net.position.set(gl.center.x + dir.x * gl.h * 0.3 * b, gl.center.y + dir.y * gl.h * 0.3 * b);
      this.net.scale.set(k * (1 + b * 0.22), k * (1 + b * 0.45));
      this.net.rotation = shake * 0.6;
      this.net.alpha = alpha * (0.62 + 0.3 * Math.min(1, b * 2));
    }
    this.refresh();
  }

  /** II's corner flag (its pole's foot at `at`): opacity and a wave (radians). */
  setFlag(at: Pt, alpha: number, wave: number): void {
    if (this.destroyed) return;
    const s = this.flag;
    s.visible = alpha > 0.004;
    if (s.visible) {
      const k = (this.aR * 1.4) / FLAG_H;
      s.position.set(at.x, at.y); s.scale.set(k * (1 + wave * 0.6), k); s.skew.set(wave * 0.5, 0); s.alpha = alpha;
    }
    this.refresh();
  }

  /** III's defender `i`. */
  setDefender(i: number, d: DefenderState): void {
    if (this.destroyed) return;
    const s = this.defenders[i];
    if (!s) return;
    s.visible = d.visible && d.alpha > 0.004;
    if (s.visible) {
      const k = (this.aR * 2 * d.scale) / DEFENDER_PX;
      s.position.set(d.x, d.y); s.scale.set(k); s.rotation = d.rot; s.alpha = d.alpha * 0.92;
    }
    this.refresh();
  }

  /** Hide every own object (the end, a cancel). */
  hideOwn(): void {
    for (const s of [this.ball, this.ballShadow, this.heroShadow, this.net, this.goal, this.flag, ...this.defenders]) s.visible = false;
    this.own = false;
  }

  private refresh(): void {
    this.own = this.ball.visible || this.ballShadow.visible || this.heroShadow.visible || this.net.visible || this.goal.visible || this.flag.visible
      || this.defenders.some((s) => s.visible);
  }

  protected override tick(): boolean { return this.own; }
  protected override clearOwn(): void { this.hideOwn(); }

  // ── fire-and-forget ───────────────────────────────────────────────────────────────────────────────────────────

  /** A soft ghost of the ball left behind in flight; IV's thunderbolt leaves FIRE (`b.fire`). */
  trail(b: BallState): void {
    if (!b.visible) return;
    const S = this.scale;
    const k = (this.aR * 2 * this.look.ballSize * b.scale) / BALL_PX / S;
    if (b.fire > 0) {
      const c = this.colors;
      this.spawn('glow', this.tex.glow, c.fire, b.x, b.y, { dur: 260, from: (k * BALL_PX * 1.4) / GLOW_PX, to: (k * BALL_PX * 0.5) / GLOW_PX, a0: 0.8 * b.fire, ease: 'linear', vy: -30 });
      this.spawn('core', this.tex.glow, whiten(c.fire, 0.6), b.x, b.y, { dur: 160, from: (k * BALL_PX * 0.9) / GLOW_PX, to: (k * BALL_PX * 0.3) / GLOW_PX, a0: 0.7 * b.fire, ease: 'linear' });
      this.spawn('core', this.tex.spark, c.blast, b.x + (this.rnd() - 0.5) * k * 60, b.y + (this.rnd() - 0.5) * k * 60, { dur: 300, from: 0.5, to: 0.1, a0: 0.9, vx: (this.rnd() - 0.5) * 120, vy: (this.rnd() - 0.5) * 120, drag: 0.3 });
      return;
    }
    this.spawn('body', this.tex.ball, whiten(this.colors.ball, 0.25), b.x, b.y, { dur: 160, from: k * 0.92, to: k * 0.7, a0: 0.22, rot: b.rot, ease: 'linear' });
  }

  /** A touch on the ball (a keepy-uppy, a dribble touch, the corner set down): a little puff of grass. */
  touch(at: Pt, strength: number): void {
    const S = this.scale;
    const r = this.aR * this.look.ballSize;
    this.spawn('glow', this.tex.ring, 0xffffff, at.x, at.y, { dur: 220, from: (r * 0.7) / RING_PX / S, to: (r * 1.8) / RING_PX / S, a0: 0.22 * strength, sy: 0.45, ease: 'cubic' });
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i - 1) * 0.8 + (this.rnd() - 0.5) * 0.4;
      this.spawn('body', this.tex.confetti, i % 2 ? GRASS : whiten(GRASS, 0.3), at.x, at.y + r * 0.3, {
        dur: 360 + this.rnd() * 120, from: 0.7, to: 0.5, a0: 0.9 * strength, mode: 'hold', ease: 'linear', vx: Math.cos(a) * 140, vy: Math.sin(a) * 160, grav: 700, drag: 0.4,
        rot: this.rnd() * Math.PI, spin: (this.rnd() - 0.5) * 0.03,
      });
    }
  }

  /** The strike: a flash and a ring at the boot, `k` scales it. */
  strike(at: Pt, k = 1): void {
    const S = this.scale;
    const r = this.aR * this.look.ballSize * k;
    this.spawn('core', this.tex.star, this.colors.flash, at.x, at.y, { dur: 220, from: 0.4 * k, to: 1.3 * k, a0: 0.95, mode: 'punch', peakAt: 0.2, rot: 0.4 });
    this.spawn('glow', this.tex.ring, this.colors.side, at.x, at.y, { dur: 260, from: (r * 0.8) / RING_PX / S, to: (r * 2.8) / RING_PX / S, a0: 0.55, ease: 'cubic' });
    this.spawn('glow', this.tex.glow, this.colors.side, at.x, at.y, { dur: 240, from: (r * 0.8) / GLOW_PX / S, to: (r * 2.2) / GLOW_PX / S, a0: 0.4, mode: 'punch', peakAt: 0.2 });
  }

  /** A footstep's skid of dust and grass, along `dir` (a sprint, a landing). */
  skid(at: Pt, dir: Pt, k = 1): void {
    const S = this.scale;
    const feet = { x: at.x, y: at.y + this.aR * 0.8 };
    this.spawn('under', this.tex.glow, DUST, feet.x, feet.y, { dur: 320, from: (this.aR * 0.5) / GLOW_PX / S, to: (this.aR * 1.2 * k) / GLOW_PX / S, a0: 0.22, sy: 0.5 });
    for (let i = 0; i < Math.round(3 * k); i++) {
      const a = Math.atan2(-dir.y, -dir.x) + (this.rnd() - 0.5) * 1.2;
      this.spawn('body', this.tex.confetti, i % 2 ? GRASS : whiten(GRASS, 0.25), feet.x, feet.y, {
        dur: 380, from: 0.6, to: 0.4, a0: 0.85, mode: 'hold', ease: 'linear', vx: Math.cos(a) * 220 * k, vy: Math.sin(a) * 120 - 120, grav: 800, drag: 0.4, rot: this.rnd() * 3,
      });
    }
  }

  /** A speed line behind a sprint (or the launch), from where the striker was a moment ago to where it is. */
  speedLine(at: Pt, from: Pt, r: number): void {
    const S = this.scale;
    const dx = at.x - from.x, dy = at.y - from.y;
    const l = Math.hypot(dx, dy);
    if (l < 2) return;
    const head = Math.atan2(dy, dx);
    for (const off of [-0.55, 0, 0.55]) {
      const x = from.x + Math.cos(head + Math.PI / 2) * r * off, y = from.y + Math.sin(head + Math.PI / 2) * r * off;
      this.spawn('glow', this.tex.streak, 0xffffff, x, y, { dur: 200, from: (l * 2.2) / 128 / S, to: (l * 1.2) / 128 / S, a0: 0.35, sy: 0.18, rot: head, ease: 'linear' });
    }
  }

  /** IV's launch out of the crouch: a shock ring of dust and grass at the take-off point, a flash under the feet. */
  launch(at: Pt, k: number): void {
    if (k <= 0) return;
    const S = this.scale, r = this.aR, c = this.colors;
    const feet = { x: at.x, y: at.y + r * 0.6 };
    this.spawn('glow', this.tex.ring, 0xffffff, feet.x, feet.y, { dur: 420, from: (r * 0.6) / RING_PX / S, to: (r * 3.4 * k) / RING_PX / S, a0: 0.7, sy: 0.45, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, c.side, feet.x, feet.y, { dur: 520, from: (r * 0.5) / RING_PX / S, to: (r * 2.6 * k) / RING_PX / S, a0: 0.5, sy: 0.45, ease: 'cubic', delay: 60 });
    this.spawn('core', this.tex.glow, c.flash, feet.x, feet.y, { dur: 220, from: (r * 0.6) / GLOW_PX / S, to: (r * 1.8 * k) / GLOW_PX / S, a0: 0.6, mode: 'punch', peakAt: 0.15 });
    for (let i = 0; i < Math.round(10 * k); i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * Math.PI * 1.4;
      this.spawn('body', this.tex.confetti, i % 2 ? GRASS : whiten(GRASS, 0.3), feet.x, feet.y, {
        dur: 520 + this.rnd() * 200, from: 0.8, to: 0.5, a0: 0.9, mode: 'hold', ease: 'linear', vx: Math.cos(a) * 340 * k, vy: Math.sin(a) * 300 * k, grav: 900, drag: 0.4,
        rot: this.rnd() * 3, spin: (this.rnd() - 0.5) * 0.03,
      });
    }
  }

  /** IV's CONTACT upside down: a white-hot pop on the ball, a shock ring, and streaks flung out along the shot. */
  contact(at: Pt, dir: Pt, k: number): void {
    const S = this.scale, c = this.colors, r = this.aR * this.look.ballSize * k;
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 260, from: (r * 0.8) / GLOW_PX / S, to: (r * 4) / GLOW_PX / S, a0: 1, mode: 'punch', peakAt: 0.1 });
    this.spawn('core', this.tex.star, c.flash, at.x, at.y, { dur: 340, from: 0.6 * k, to: 2.4 * k, a0: 1, mode: 'punch', peakAt: 0.12, rot: 0.3 });
    for (let i = 0; i < 3; i++) this.spawn('glow', this.tex.ring, i % 2 ? c.fire : c.flash, at.x, at.y, { dur: 380 + 80 * i, from: (r * 0.6) / RING_PX / S, to: (r * (3 + 1.4 * i)) / RING_PX / S, a0: 0.75 - 0.15 * i, ease: 'cubic', delay: 40 * i });
    const head = Math.atan2(dir.y, dir.x);
    this.burst('core', this.tex.spark, [c.fire, c.flash, c.blast], at.x, at.y, Math.round(12 * k), { speed: 620 * k, life: 360, size: 0.5, drag: 0.15, align: true });
    for (let i = 0; i < 4; i++) {
      const a = head + (this.rnd() - 0.5) * 0.5;
      this.spawn('glow', this.tex.streak, c.fire, at.x, at.y, { dur: 260, from: 1.6 * k, to: 0.6, a0: 0.6, sy: 0.25, rot: a, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, drag: 0.2 });
    }
  }

  /** III: a defender is beaten (a puff where it stood) and, for the nutmeg / the stepovers, the word. */
  beaten(at: Pt, word: SoccerWord | null): void {
    const S = this.scale;
    this.spawn('under', this.tex.glow, DUST, at.x, at.y + this.aR * 0.4, { dur: 380, from: (this.aR * 0.6) / GLOW_PX / S, to: (this.aR * 1.5) / GLOW_PX / S, a0: 0.25, sy: 0.5 });
    if (word) this.word(word, { x: at.x, y: at.y - this.aR * 0.2 }, 0.8, this.aR * 2.4);
  }

  /** The header: a flash on the ball at the head. */
  header(at: Pt): void {
    const S = this.scale, r = this.aR * this.look.ballSize;
    this.spawn('core', this.tex.star, this.colors.flash, at.x, at.y, { dur: 260, from: 0.5, to: 1.6, a0: 1, mode: 'punch', peakAt: 0.15, rot: 0.6 });
    this.spawn('glow', this.tex.ring, this.colors.side, at.x, at.y, { dur: 300, from: r / RING_PX / S, to: (r * 3.4) / RING_PX / S, a0: 0.6, ease: 'cubic' });
  }

  /** The knee slide: a spray of grass and a skid streak behind it. */
  slide(at: Pt, dir: Pt): void {
    const S = this.scale;
    const feet = { x: at.x, y: at.y + this.aR * 0.75 };
    const head = Math.atan2(dir.y, dir.x);
    this.spawn('under', this.tex.streak, whiten(GRASS, 0.2), feet.x, feet.y, { dur: 700, from: (this.aR * 1.6) / 128 / S, to: (this.aR * 2.2) / 128 / S, a0: 0.35, sy: 0.3, rot: head, mode: 'hold', ease: 'linear' });
    for (let i = 0; i < 4; i++) {
      const a = head + Math.PI + (this.rnd() - 0.5) * 1.4;
      this.spawn('body', this.tex.confetti, i % 2 ? GRASS : whiten(GRASS, 0.3), feet.x, feet.y, {
        dur: 460, from: 0.7, to: 0.4, a0: 0.9, mode: 'hold', ease: 'linear', vx: Math.cos(a) * 200, vy: Math.sin(a) * 120 - 160, grav: 900, drag: 0.4, rot: this.rnd() * 3,
      });
    }
  }

  /**
   * THE GOAL (`at` = the target's centre; `dir` = the way the shot went in): the net ripples (squashed rings pulsing
   * out), sparks, the word. `o.big` (IV): an explosion, a fireball and a confetti storm.
   */
  goalHit(at: Pt, dir: Pt, o: { burst: number; rings: number; confetti: number; big: boolean; blast: number }): void {
    const S = this.scale;
    const c = this.colors;
    const R = this.dR;
    const w = R * 2.5 * this.look.goalSize;
    const b = Math.max(0.3, o.burst);
    this.spawn('core', this.tex.glow, c.flash, at.x, at.y, { dur: 260, from: (R * 0.6 * b) / GLOW_PX / S, to: (R * 2 * b) / GLOW_PX / S, a0: 0.85, mode: 'punch', peakAt: 0.1 });
    this.spawn('glow', this.tex.glow, c.side, at.x, at.y, { dur: 420, from: (R * 1 * b) / GLOW_PX / S, to: (R * 2.8 * b) / GLOW_PX / S, a0: 0.45, mode: 'punch', peakAt: 0.12 });
    // The net's ripples.
    for (let i = 0; i < Math.max(1, Math.min(8, o.rings + 1)); i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? c.side : c.net, at.x + dir.x * w * 0.04 * i, at.y + dir.y * w * 0.04 * i, {
        dur: 380 + 70 * i, from: (w * 0.3) / RING_PX / S, to: (w * (0.9 + 0.35 * i) * Math.min(1.6, b)) / RING_PX / S, a0: 0.7 - 0.08 * i, sy: 0.6, ease: 'cubic', delay: 60 * i,
      });
    }
    this.burst('core', this.tex.star, [c.flash, c.side, c.net], at.x, at.y, Math.round(8 * b), { speed: 360 * b, life: 420, size: 0.35, drag: 0.15, spin: 0.01, lift: 120, grav: 380 });
    if (o.big) this.explosion(at, dir, o.blast);
    if (o.confetti > 0) this.confettiBurst(at, o.confetti);
    this.word(o.big ? 'golazo' : 'goal', at, b, this.dR * 2.2 * (o.big ? 1.2 : 1));
  }

  /** IV's EXPLOSION in the goal: a white-hot core, a fireball rolling up, a shock ring, embers. `k` scales it. */
  private explosion(at: Pt, dir: Pt, k: number): void {
    if (k <= 0) return;
    const S = this.scale;
    const c = this.colors;
    const R = this.dR * k;
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 220, from: (R * 0.6) / GLOW_PX / S, to: (R * 2.2) / GLOW_PX / S, a0: 1, mode: 'punch', peakAt: 0.08 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + this.rnd() * 0.5;
      const d = R * (0.2 + this.rnd() * 0.35);
      this.spawn('glow', this.tex.glow, i % 3 ? c.blast : whiten(c.fire, 0.3), at.x + Math.cos(a) * d + dir.x * R * 0.2, at.y + Math.sin(a) * d + dir.y * R * 0.2, {
        dur: 520 + this.rnd() * 220, from: (R * 0.7) / GLOW_PX / S, to: (R * (1.8 + this.rnd() * 0.8)) / GLOW_PX / S, a0: 0.75, mode: 'punch', peakAt: 0.12,
        ease: 'cubic', vx: Math.cos(a) * 160 + dir.x * 120, vy: Math.sin(a) * 110 - 120 + dir.y * 120, drag: 0.2,
      });
    }
    this.spawn('glow', this.tex.ring, c.blast, at.x, at.y, { dur: 520, from: (R * 0.5) / RING_PX / S, to: (R * 4.2) / RING_PX / S, a0: 0.8, ease: 'cubic', delay: 40 });
    this.burst('core', this.tex.spark, [c.blast, c.flash, c.fire], at.x, at.y, Math.round(18 * k), { speed: 900 * k, life: 520, size: 0.6, drag: 0.15, align: true, grav: 400 });
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

  /** A word popping in above a point and drifting up as it fades. */
  private word(which: SoccerWord, at: Pt, strength: number, width: number): void {
    if (this.look.wordSize <= 0) return;
    const t = which === 'golazo' ? this.tex.wordGolazo : which === 'nutmeg' ? this.tex.wordNutmeg : which === 'ole' ? this.tex.wordOle : this.tex.wordGoal;
    const S = this.scale;
    const w = width * this.look.wordSize * Math.min(1.4, 0.8 + 0.25 * strength);
    const k = w / WORD_W / S;
    // Above the point; when that would leave the top of the screen (a foe tucked against the top), BELOW it instead.
    const hh = w * (WORD_H / WORD_W);
    const above = at.y - this.dR * 1.05;
    const y = above - hh * 0.5 >= 12 ? above : at.y + this.dR * 1.1;
    this.spawn('body', t, 0xffffff, at.x, y, { dur: 760, from: k * 0.55, to: k * 1.08, a0: 1, mode: 'hold', ease: 'quint', rot: -0.08, vy: y === above ? -40 : 30, drag: 0.4 });
    this.spawn('glow', t, this.colors.side, at.x, y, { dur: 540, from: k * 0.6, to: k * 1.25, a0: 0.45, mode: 'punch', peakAt: 0.15, rot: -0.08 });
  }
}
