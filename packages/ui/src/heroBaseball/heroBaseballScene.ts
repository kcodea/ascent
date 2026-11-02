/**
 * THE BASEBALL SCENE: what the Baseball attack draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so
 * it runs (and is tested) headless. The PORTRAITS are the players (the runner moves both); this draws the ball, the bat,
 * the shadows and the hits. `heroBaseball.ts` mounts `root` on the above-portrait overlay.
 *
 * OWN OBJECTS (one each, positioned by the runner every frame from the pure paths, hidden the moment they are not needed
 * and on every exit): the BALL (spinning, lifted off its shadow), its SHADOW on the ground, the BAT (pivoting at the
 * handle), and III's growing TARGET SHADOW on the pitcher.
 *
 * FIRE-AND-FORGET (pooled, under a hard cap): the ball's trail, the glove pop, the pitch's dust kick, the CRACK, every
 * BONK, the hop's dirt, the moonshot's twinkle and its crater, the bean's stars, the fumes, the bat's clatter, the charge's
 * dust and speed lines, the BRAWL (a boiling dust cloud, the benches clearing in from both edges, comic POW / BAM / SMACK
 * bursts) and the KO (the cloud blown apart, rings, stars, YER OUT!).
 */
import { Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import type { BallState, BatState } from './heroBaseballConfig';

export interface HeroBaseballTextures extends HeroArcanaTextures {
  ball: Texture;
  shadow: Texture;
  bat: Texture;
  puff: Texture;
  kapow: Texture;
  wordCrack: Texture;
  wordBonk: Texture;
  wordHomer: Texture;
  wordPow: Texture;
  wordBam: Texture;
  wordSmack: Texture;
  wordOut: Texture;
}

export interface BaseballColors { ball: number; bat: number; dust: number; flash: number; pow: number; side: number }

export interface BaseballLook {
  /** The ball's diameter in striker radii. */
  ballSize: number;
  /** The bat's length, screen px. */
  batLen: number;
  /** How far a shadow drops below what casts it, in striker radii at full height. */
  shadowDrop: number;
  wordSize: number;
}

/** Hard cap on pooled sprites alive at once (a Tier IV brawl peaks near 200). The own objects are outside the pool. */
export const MAX_BASEBALL_SPRITES = 320;
const RING_PX = 160;
const GLOW_PX = 128;
const SHADOW_PX = 64;
const BALL_PX = 96;
const BAT_W = 256;
const PUFF_PX = 128;
const BURST_PX = 256;
const WORD_W = 512;
const WORD_H = 160;
/** The bat sprite's anchor: its grip, a little way up the handle from the knob. */
const BAT_GRIP = 0.12;

export type BaseballWord = 'crack' | 'bonk' | 'homer' | 'pow' | 'bam' | 'smack' | 'out';

export class HeroBaseballScene extends FxPool {
  private readonly ball: Sprite;
  private readonly ballShadow: Sprite;
  private readonly targetShadow: Sprite;
  private readonly bat: Sprite;
  private own = false;

  /** `aR` / `dR`: the striking (batter) and struck (pitcher) portraits' radii (screen px). */
  constructor(
    private readonly tex: HeroBaseballTextures, private readonly colors: BaseballColors, private readonly look: BaseballLook,
    private readonly aR: number, private readonly dR: number, scale = 1, seed = 1,
  ) {
    super('heroBaseball', [tex.glow, tex.ring, tex.star, tex.streak, tex.spark, tex.ball, tex.puff, tex.kapow, tex.wordCrack, tex.wordBonk, tex.wordHomer, tex.wordPow, tex.wordBam, tex.wordSmack, tex.wordOut], scale, seed, MAX_BASEBALL_SPRITES);
    const mk = (layer: 'under' | 'body', t: Texture, tint: number, ax = 0.5, ay = 0.5): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.tint = tint; s.visible = false; s.eventMode = 'none';
      this.layers[layer].addChild(s);
      return s;
    };
    this.targetShadow = mk('under', tex.shadow, 0x000000);
    this.ballShadow = mk('under', tex.shadow, 0x000000);
    this.bat = mk('body', tex.bat, colors.bat, BAT_GRIP, 0.5);
    this.ball = mk('body', tex.ball, colors.ball);
  }

  /** Whether any own object still draws. */
  get ownVisible(): boolean { return this.own; }

  private wordTex(w: BaseballWord): Texture {
    const t = this.tex;
    return { crack: t.wordCrack, bonk: t.wordBonk, homer: t.wordHomer, pow: t.wordPow, bam: t.wordBam, smack: t.wordSmack, out: t.wordOut }[w];
  }

  // ── own objects (the runner writes them every frame) ──────────────────────────────────────────────────────────

  /** The ball (drawn `lift` px above its ground point) and its shadow on the ground. */
  setBall(b: BallState): void {
    if (this.destroyed) return;
    const s = this.ball, sh = this.ballShadow;
    if (!b.visible || b.alpha <= 0.002 || b.scale <= 0.002) { s.visible = false; sh.visible = false; this.refresh(); return; }
    const px = this.aR * 2 * this.look.ballSize * b.scale;
    const k = px / BALL_PX;
    s.visible = true;
    s.position.set(b.x, b.y - b.lift);
    s.rotation = b.rot;
    s.scale.set(k);
    s.alpha = b.alpha;
    const air = Math.min(1, b.lift / Math.max(1, this.aR * 3));
    const sk = (px * (1 - 0.5 * air)) / SHADOW_PX;
    sh.visible = true;
    sh.position.set(b.x, b.y + this.aR * this.look.shadowDrop * 0.3);
    sh.scale.set(sk, sk * 0.45);
    sh.alpha = 0.3 * (1 - 0.6 * air) * b.alpha;
    this.refresh();
  }

  /** The bat (its grip at (x, y), `lift` px up, pointing along `rot`). */
  setBat(b: BatState): void {
    if (this.destroyed) return;
    const s = this.bat;
    if (!b.visible || b.alpha <= 0.002) { s.visible = false; this.refresh(); return; }
    s.visible = true;
    s.position.set(b.x, b.y - b.lift);
    s.rotation = b.rot;
    s.scale.set(this.look.batLen / (BAT_W * (1 - BAT_GRIP)));
    s.alpha = b.alpha;
    this.refresh();
  }

  /** III: the falling ball's shadow growing on the pitcher (`k` 0..1; 0 hides it). */
  setTargetShadow(at: Pt, k: number): void {
    if (this.destroyed) return;
    const s = this.targetShadow;
    if (k <= 0.002) { s.visible = false; this.refresh(); return; }
    const px = this.dR * (0.4 + 2.2 * k);
    s.visible = true;
    s.position.set(at.x, at.y + this.dR * 0.35);
    s.scale.set(px / SHADOW_PX, (px * 0.5) / SHADOW_PX);
    s.alpha = 0.18 + 0.4 * k;
    this.refresh();
  }

  /** Hide every own object (the end, a cancel). */
  hideOwn(): void {
    for (const s of [this.ball, this.ballShadow, this.targetShadow, this.bat]) s.visible = false;
    this.own = false;
  }

  private refresh(): void {
    this.own = this.ball.visible || this.ballShadow.visible || this.targetShadow.visible || this.bat.visible;
  }

  protected override tick(): boolean { return this.own; }
  protected override clearOwn(): void { this.hideOwn(); }

  // ── fire-and-forget ───────────────────────────────────────────────────────────────────────────────────────────

  /** A soft ghost of the ball left behind in flight. */
  trail(b: BallState): void {
    if (!b.visible) return;
    const S = this.scale;
    const k = (this.aR * 2 * this.look.ballSize * b.scale) / BALL_PX / S;
    this.spawn('glow', this.tex.glow, this.colors.side, b.x, b.y - b.lift, { dur: 160, from: (k * BALL_PX * 0.9) / GLOW_PX, to: (k * BALL_PX * 0.4) / GLOW_PX, a0: 0.35, ease: 'linear' });
  }

  /** The ball smacked into the pitcher's mitt to start: a small puff of leather dust. */
  glovePop(at: Pt): void {
    const S = this.scale;
    const r = this.dR * 0.5;
    this.spawn('glow', this.tex.ring, 0xffffff, at.x, at.y, { dur: 220, from: (r * 0.5) / RING_PX / S, to: (r * 1.6) / RING_PX / S, a0: 0.5, ease: 'cubic' });
    this.burst('body', this.tex.puff, [this.colors.dust], at.x, at.y, 3, { speed: 90, life: 280, size: (r * 0.5) / PUFF_PX / S, drag: 0.15 });
  }

  /** The pitch's push-off: dirt kicked up behind the pitcher. */
  kick(at: Pt, dir: Pt): void {
    const S = this.scale;
    const head = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < 4; i++) {
      const a = head + Math.PI + (this.rnd() - 0.5) * 1.6;
      this.spawn('body', this.tex.puff, this.colors.dust, at.x, at.y, {
        dur: 320 + this.rnd() * 120, from: (this.dR * 0.3) / PUFF_PX / S, to: (this.dR * 0.6) / PUFF_PX / S, a0: 0.55, vx: Math.cos(a) * 120, vy: Math.sin(a) * 80, drag: 0.12,
      });
    }
  }

  /** CRACK: the bat meets the ball. A white flash, a ring, speed streaks fanned out the way the ball goes, the word. */
  crack(at: Pt, dir: Pt, k: number, word = true): void {
    const S = this.scale;
    const c = this.colors;
    const r = this.aR * 0.6 * k;
    this.spawn('core', this.tex.star, c.flash, at.x, at.y, { dur: 220, from: 0.5 * k, to: 1.8 * k, a0: 1, mode: 'punch', peakAt: 0.12, rot: 0.3 });
    this.spawn('glow', this.tex.ring, c.flash, at.x, at.y, { dur: 260, from: (r * 0.6) / RING_PX / S, to: (r * 2.6) / RING_PX / S, a0: 0.8, ease: 'cubic' });
    this.spawn('glow', this.tex.glow, c.side, at.x, at.y, { dur: 260, from: (r * 0.8) / GLOW_PX / S, to: (r * 2.4) / GLOW_PX / S, a0: 0.5, mode: 'punch', peakAt: 0.15 });
    const head = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < Math.round(5 * k); i++) {
      const a = head + (this.rnd() - 0.5) * 0.9;
      this.spawn('glow', this.tex.streak, 0xffffff, at.x + Math.cos(a) * r * 0.6, at.y + Math.sin(a) * r * 0.6, {
        dur: 200, from: 0.5 * k, to: 0.9 * k, a0: 0.6, sy: 0.22, rot: a, vx: Math.cos(a) * 500, vy: Math.sin(a) * 500, drag: 0.05, ease: 'linear',
      });
    }
    this.burst('core', this.tex.spark, [c.flash, 0xffffff], at.x, at.y, Math.round(6 * k), { speed: 420 * k, life: 240, size: 0.4, drag: 0.1, align: true });
    if (word) this.word('crack', { x: at.x, y: at.y - this.aR * 0.5 }, 0.55 * k, -0.12);
  }

  /** A hit on a portrait: a flash, stars, rings, dust, a comic burst and the word. `k` scales it. */
  bonk(at: Pt, dir: Pt, k: number, o: { rings?: number; word?: BaseballWord; r?: number } = {}): void {
    const S = this.scale;
    const c = this.colors;
    const R = o.r ?? this.dR;
    const b = Math.max(0.3, k);
    this.spawn('core', this.tex.glow, c.flash, at.x, at.y, { dur: 240, from: (R * 0.7 * b) / GLOW_PX / S, to: (R * 2.2 * b) / GLOW_PX / S, a0: 0.95, mode: 'punch', peakAt: 0.1 });
    this.spawn('core', this.tex.star, c.flash, at.x, at.y, { dur: 280, from: 0.7 * b, to: 2.2 * b, a0: 1, mode: 'punch', peakAt: 0.12, rot: 0.4 });
    for (let i = 0; i < Math.min(8, o.rings ?? 1); i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? c.side : c.flash, at.x, at.y, {
        dur: 400 + 60 * i, from: (R * 0.5) / RING_PX / S, to: (R * (1.8 + 0.8 * i) * b) / RING_PX / S, a0: 0.8 - 0.1 * i, ease: 'cubic', delay: 60 * i,
      });
    }
    this.burst('core', this.tex.star, [c.pow, c.flash, 0xffffff], at.x, at.y, Math.round(7 * b), { speed: 380 * b, life: 460, size: 0.32, drag: 0.15, spin: 0.012, lift: 80, grav: 300 });
    const head = Math.atan2(dir.y, dir.x);
    this.burst('core', this.tex.spark, [c.flash, c.side], at.x, at.y, Math.round(8 * b), { speed: 600 * b, dir: head, spread: 2.2, life: 300, size: 0.45, drag: 0.12, align: true });
    if (o.word) this.word(o.word, at, b, (this.rnd() - 0.5) * 0.3);
  }

  /** II (the grounder): the one hop kicks up a spray of dirt. */
  hopDust(at: Pt): void {
    const S = this.scale;
    const r = this.aR * 0.5;
    this.spawn('glow', this.tex.ring, this.colors.dust, at.x, at.y, { dur: 260, from: (r * 0.5) / RING_PX / S, to: (r * 2) / RING_PX / S, a0: 0.5, sy: 0.45, ease: 'cubic' });
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.2;
      this.spawn('body', this.tex.puff, this.colors.dust, at.x, at.y, {
        dur: 360 + this.rnd() * 120, from: (r * 0.35) / PUFF_PX / S, to: (r * 0.8) / PUFF_PX / S, a0: 0.6, vx: Math.cos(a) * 140, vy: Math.sin(a) * 110, drag: 0.1, grav: 200,
      });
    }
  }

  /** III: the moonshot twinkles off the top of the screen. */
  twinkle(at: Pt): void {
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 420, from: 0.3, to: 1.4, a0: 1, mode: 'punch', peakAt: 0.3, rot: 0.5, spin: 0.004 });
    this.spawn('core', this.tex.star, this.colors.pow, at.x, at.y, { dur: 520, from: 0.2, to: 0.9, a0: 0.7, mode: 'punch', peakAt: 0.4, rot: 0, spin: -0.003 });
  }

  /** III: the moonshot CRATERS the pitcher. A huge hit, a ring of dirt thrown out, fireworks and HOME RUN. */
  crater(at: Pt, dir: Pt, k: number, rings: number): void {
    const S = this.scale;
    const c = this.colors;
    const R = this.dR;
    this.bonk(at, dir, k, { rings, word: 'homer' });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + this.rnd() * 0.3;
      this.spawn('body', this.tex.puff, i % 3 ? c.dust : whiten(c.dust, 0.3), at.x + Math.cos(a) * R * 0.5, at.y + Math.sin(a) * R * 0.3, {
        dur: 520 + this.rnd() * 200, from: (R * 0.45) / PUFF_PX / S, to: (R * 0.9) / PUFF_PX / S, a0: 0.75, vx: Math.cos(a) * 260 * k, vy: Math.sin(a) * 140 * k, drag: 0.08,
      });
    }
    // Fireworks: bursts popping round the target, one after another.
    const tints = [c.pow, c.side, 0x6ad0ff, 0xff6ad0];
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i - 1.5) * 0.8;
      const x = at.x + Math.cos(a) * R * 1.6, y = at.y + Math.sin(a) * R * 1.3;
      const t = tints[i % tints.length]!;
      this.spawn('core', this.tex.glow, t, x, y, { dur: 300, from: (R * 0.2) / GLOW_PX / S, to: (R * 0.9) / GLOW_PX / S, a0: 0.8, mode: 'punch', peakAt: 0.1, delay: 140 + i * 110 });
      for (let j = 0; j < 8; j++) {
        const b = (j / 8) * Math.PI * 2;
        this.spawn('core', this.tex.spark, t, x, y, { dur: 420, from: 0.45, to: 0.15, a0: 1, vx: Math.cos(b) * 320, vy: Math.sin(b) * 320, drag: 0.1, grav: 260, align: true, ease: 'linear', delay: 140 + i * 110 });
      }
    }
  }

  /** IV: the BEAN on the batter. A smaller BONK, a ring of dizzy stars. */
  bean(at: Pt, dir: Pt): void {
    this.bonk(at, dir, 0.9, { rings: 1, word: 'bonk', r: this.aR });
    const S = this.scale;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      this.spawn('core', this.tex.star, this.colors.pow, at.x + Math.cos(a) * this.aR * 0.7, at.y - this.aR * 0.6 + Math.sin(a) * this.aR * 0.22, {
        dur: 700, from: 0.35 / S, to: 0.2 / S, a0: 1, mode: 'hold', vx: -Math.sin(a) * 90, vy: Math.cos(a) * 30, drag: 0.6, spin: 0.01,
      });
    }
  }

  /** IV: the batter FUMES (steam puffs rising off the top of the portrait). */
  fume(at: Pt): void {
    const S = this.scale;
    const r = this.aR;
    for (const sx of [-0.45, 0.45]) {
      this.spawn('body', this.tex.puff, 0xffffff, at.x + r * sx, at.y - r * 0.85, {
        dur: 420 + this.rnd() * 140, from: (r * 0.18) / PUFF_PX / S, to: (r * 0.55) / PUFF_PX / S, a0: 0.75, vx: sx * 120, vy: -160, drag: 0.2,
      });
    }
  }

  /** IV: the bat SLAMMED down clatters (dust). */
  clatter(at: Pt): void {
    const S = this.scale;
    const r = this.aR * 0.6;
    this.spawn('glow', this.tex.ring, this.colors.dust, at.x, at.y, { dur: 260, from: (r * 0.5) / RING_PX / S, to: (r * 2.2) / RING_PX / S, a0: 0.55, sy: 0.45, ease: 'cubic' });
    this.burst('body', this.tex.puff, [this.colors.dust], at.x, at.y, 5, { speed: 160, life: 380, size: (r * 0.4) / PUFF_PX / S, drag: 0.12, to: 1.6 });
  }

  /** IV: the charge's dust at the feet, and speed lines behind it. */
  chargeDust(at: Pt, from: Pt, r: number): void {
    const S = this.scale;
    const dx = at.x - from.x, dy = at.y - from.y;
    const l = Math.hypot(dx, dy);
    const head = Math.atan2(dy, dx);
    this.spawn('body', this.tex.puff, this.colors.dust, from.x, from.y + r * 0.5, { dur: 360, from: (r * 0.35) / PUFF_PX / S, to: (r * 0.8) / PUFF_PX / S, a0: 0.6, vx: -Math.cos(head) * 60, vy: -Math.sin(head) * 60, drag: 0.1 });
    if (l < 2) return;
    for (const off of [-0.6, 0, 0.6]) {
      const x = from.x + Math.cos(head + Math.PI / 2) * r * off, y = from.y + Math.sin(head + Math.PI / 2) * r * off;
      this.spawn('glow', this.tex.streak, 0xffffff, x, y, { dur: 180, from: (l * 2.4) / 128 / S, to: (l * 1.2) / 128 / S, a0: 0.45, sy: 0.18, rot: head, ease: 'linear' });
    }
  }

  /** IV: one puff of the BRAWL CLOUD (the runner keeps it boiling while the brawl lasts). `k` scales it. */
  cloudPuff(at: Pt, k: number): void {
    if (k <= 0) return;
    const S = this.scale;
    const R = (this.aR + this.dR) * 0.5 * k;
    const a = this.rnd() * Math.PI * 2;
    const d = R * (0.35 + this.rnd() * 0.75);
    const tint = this.rnd() < 0.3 ? whiten(this.colors.dust, 0.35) : this.colors.dust;
    this.spawn('body', this.tex.puff, tint, at.x + Math.cos(a) * d, at.y + Math.sin(a) * d * 0.8, {
      dur: 300 + this.rnd() * 160, from: (R * (0.7 + this.rnd() * 0.4)) / PUFF_PX / S, to: (R * (1 + this.rnd() * 0.5)) / PUFF_PX / S, a0: 0.95, mode: 'hold', ease: 'cubic',
      vx: Math.cos(a) * 40, vy: Math.sin(a) * 30 - 20, drag: 0.3,
    });
  }

  /** IV: the brawl cloud BURSTS onto the scene at the collision (a ring of puffs at once). */
  cloudBurst(at: Pt, k: number): void {
    for (let i = 0; i < Math.round(10 * k); i++) this.cloudPuff(at, k);
    const S = this.scale;
    const R = (this.aR + this.dR) * 0.5 * k;
    this.spawn('glow', this.tex.ring, 0xffffff, at.x, at.y, { dur: 300, from: (R * 0.5) / RING_PX / S, to: (R * 2.6) / RING_PX / S, a0: 0.6, ease: 'cubic' });
  }

  /** IV: THE BENCHES CLEAR: streaks of dust rushing in from both edges of the screen at the cloud. */
  benchRush(at: Pt, width: number, k: number): void {
    if (k <= 0) return;
    const S = this.scale;
    for (const side of [-1, 1]) {
      for (let i = 0; i < Math.round(2 * k); i++) {
        const y = at.y + (this.rnd() - 0.5) * this.dR * 2;
        const x = side < 0 ? -40 : width + 40;
        const dx = at.x - x;
        this.spawn('glow', this.tex.streak, 0xffffff, x, y, { dur: 260, from: 1.6, to: 0.6, a0: 0.4, sy: 0.15, rot: dx > 0 ? 0 : Math.PI, vx: dx * 3.2, vy: (at.y - y) * 3, drag: 1, ease: 'linear', delay: this.rnd() * 60 });
        this.spawn('body', this.tex.puff, this.colors.dust, x, y, {
          dur: 300, from: (this.dR * 0.5) / PUFF_PX / S, to: (this.dR * 0.3) / PUFF_PX / S, a0: 0.75, mode: 'hold', vx: dx * 3.1, vy: (at.y - y) * 2.9, drag: 1, delay: this.rnd() * 60,
        });
      }
    }
  }

  /** IV: one comic HIT in the brawl, at a spot on the cloud's edge: a kapow burst, a word, stars and sparks. */
  brawlHit(at: Pt, i: number, k: number): void {
    const S = this.scale;
    const c = this.colors;
    const words: BaseballWord[] = ['pow', 'bam', 'smack'];
    const R = this.dR * 0.9 * k;
    const rot = (this.rnd() - 0.5) * 0.6;
    this.spawn('core', this.tex.kapow, i % 2 ? c.pow : whiten(c.pow, 0.4), at.x, at.y, { dur: 260, from: (R * 0.5) / BURST_PX / S * 2, to: (R * 1.3) / BURST_PX / S * 2, a0: 0.95, mode: 'hold', ease: 'quint', rot });
    this.spawn('core', this.tex.star, c.flash, at.x, at.y, { dur: 200, from: 0.5 * k, to: 1.5 * k, a0: 1, mode: 'punch', peakAt: 0.1, rot: rot + 0.4 });
    this.burst('core', this.tex.star, [c.pow, 0xffffff], at.x, at.y, 3, { speed: 340, life: 360, size: 0.28, drag: 0.15, spin: 0.012 });
    this.burst('core', this.tex.spark, [c.flash, c.side], at.x, at.y, 4, { speed: 520, life: 220, size: 0.4, drag: 0.1, align: true });
    this.word(words[i % words.length]!, at, 0.55 * k, rot, 340);
  }

  /** IV: THE KNOCKOUT. The cloud blown apart, a huge hit, rings, a storm of stars, YER OUT! */
  ko(at: Pt, cloud: Pt, dir: Pt, k: number, rings: number): void {
    const S = this.scale;
    const R = (this.aR + this.dR) * 0.5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + this.rnd() * 0.3;
      this.spawn('body', this.tex.puff, i % 3 ? this.colors.dust : whiten(this.colors.dust, 0.3), cloud.x + Math.cos(a) * R * 0.5, cloud.y + Math.sin(a) * R * 0.4, {
        dur: 460 + this.rnd() * 160, from: (R * 0.8) / PUFF_PX / S, to: (R * 1.1) / PUFF_PX / S, a0: 0.9, vx: Math.cos(a) * 520, vy: Math.sin(a) * 380, drag: 0.04,
      });
    }
    this.bonk(at, dir, k, { rings, word: 'out' });
    this.burst('core', this.tex.kapow, [this.colors.pow], at.x, at.y, 1, { speed: 0, life: 360, size: (this.dR * 2.4) / BURST_PX / S, to: 1.2 });
  }

  /** The ball popping up and away off whatever it hit. */
  popAway(at: Pt, dir: Pt, lift = 0): void {
    const S = this.scale;
    const k = (this.aR * 2 * this.look.ballSize) / BALL_PX / S;
    const sx = dir.x >= 0 ? 1 : -1;
    this.spawn('body', this.tex.ball, this.colors.ball, at.x, at.y - lift, {
      dur: 620, from: k, to: k * 0.9, a0: 1, mode: 'hold', ease: 'linear', vx: sx * 180 + dir.x * 80, vy: -520, grav: 2000, drag: 0.6, spin: sx * 0.02,
    });
  }

  /** A comic word popping in over a point, a little tilted, and drifting up as it fades. */
  private word(w: BaseballWord, at: Pt, strength: number, rot = -0.08, dur = 720): void {
    if (this.look.wordSize <= 0) return;
    const S = this.scale;
    const width = this.dR * 1.8 * this.look.wordSize * Math.min(1.5, 0.75 + 0.3 * strength);
    const k = width / WORD_W / S;
    // Above the point, but never off the top of the screen (a foe tucked in a corner).
    const y = Math.max(at.y - this.dR * 0.9, width * (WORD_H / WORD_W) * 0.75 + 24);
    const t = this.wordTex(w);
    this.spawn('body', t, w === 'out' || w === 'homer' ? this.colors.pow : 0xffffff, at.x, y, { dur, from: k * 0.5, to: k * 1.08, a0: 1, mode: 'hold', ease: 'quint', rot, vy: -40, drag: 0.4 });
    this.spawn('glow', t, this.colors.side, at.x, y, { dur: dur * 0.7, from: k * 0.55, to: k * 1.25, a0: 0.4, mode: 'punch', peakAt: 0.15, rot });
  }
}
