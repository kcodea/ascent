/**
 * THE COIN FLICK SCENE: everything the Coin Flick draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`),
 * so it runs (and is tested) headless. `heroCoin.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * The COIN is the subject: four sprites on one transform (a warm glow behind it, the gold FACE, an additive GLEAM that
 * flares as the face turns square to the view, and a glint star at the peak), plus a short trail of afterimages sampled
 * BACK IN TIME along its path (no mesh). Its spin is a flat in-plane turn plus an edge-on flip: the face's width closes
 * and opens (scale.x = |cos|) and shades toward the deep bronze as it goes edge-on. Flat 2D.
 *
 * A ping is a four-point sparkle, a gold ring and a spray of glitter. After the last ping the coin either CAROMS off the
 * face (small: a tumbling bounce up and away under gravity, fading) or BURSTS into a small shower of coins (big).
 */
import type { Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, mixColor, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { coinPathMs, coinPos, type CoinPath } from './heroCoinConfig';
import { COIN_TEX_D } from './heroCoinTextures';

export interface HeroCoinTextures extends HeroArcanaTextures {
  coinFace: Texture;
  coinShine: Texture;
}

export interface CoinColors { gold: number; amber: number; shine: number; deep: number; side: number }

export interface CoinLook {
  /** The coin's diameter, px at stage scale 1. */
  px: number;
  /** Afterimages behind the flying coin, and their spacing back in time. */
  ghosts: number;
  ghostMs: number;
  /** The glint star's peak opacity. */
  glint: number;
  /** Scale of the ping sparkle. */
  ping: number;
  caromMs: number;
  showerSpeed: number;
  showerGravity: number;
}

/** Hard cap on sprites alive at once (a big impact peaks well under 100). */
export const MAX_COIN_SPRITES = 220;
const GLOW_PX = 128;
const RING_PX = 160;
const STAR_PX = 48;

interface Coin {
  path: CoinPath;
  age: number;
  /** Diameter px / texture px (the size, the tier size and the stage scale folded in). */
  k: number;
  flipHz: number;
  face: Sprite; glow: Sprite; shine: Sprite; glint: Sprite;
  ghosts: Sprite[];
  /** After the last ping: the carom (-1 = still on its path). */
  carom: number;
  x: number; y: number; vx: number; vy: number;
  spin: number;
  gone: boolean;
}

export class HeroCoinScene extends FxPool {
  private coin: Coin | null = null;
  private charge: { glint: Sprite; ring: Sprite; x: number; y: number; age: number; dur: number } | null = null;

  constructor(private readonly tex: HeroCoinTextures, private readonly colors: CoinColors, private readonly look: CoinLook, scale = 1, seed = 1) {
    super('heroCoin', [tex.glow, tex.ring, tex.star, tex.spark, tex.coinFace, tex.coinShine], scale, seed, MAX_COIN_SPRITES);
  }

  get flying(): boolean { return !!this.coin && this.coin.carom < 0 && !this.coin.gone; }
  get hasCoin(): boolean { return !!this.coin && !this.coin.gone; }
  get charging(): boolean { return this.charge !== null; }

  /** The hero readies: a glint gathers at the flicking hand and a thin gold ring closes in on it. */
  startCharge(hand: Pt, durMs: number): void {
    if (this.charge) return;
    const glint = this.take('core', this.tex.star, this.colors.shine);
    const ring = this.take('glow', this.tex.ring, this.colors.gold);
    if (!glint || !ring) { this.give(glint); this.give(ring); return; }
    glint.position.set(hand.x, hand.y); ring.position.set(hand.x, hand.y);
    glint.alpha = 0; ring.alpha = 0;
    this.charge = { glint, ring, x: hand.x, y: hand.y, age: 0, dur: Math.max(1, durMs) };
  }

  /** The coin leaves the hand along `path`. `age0` = ms already elapsed (a late frame). */
  flick(path: CoinPath, size: number, flipHz: number, age0 = 0): void {
    if (this.charge) { this.give(this.charge.glint); this.give(this.charge.ring); this.charge = null; }
    const a = path.legs[0]?.a;
    if (!a) return;
    const S = this.scale;
    // The snap: a small flash and a flick of glitter at the hand.
    this.spawn('core', this.tex.glow, this.colors.shine, a.x, a.y, { dur: 140, from: 0.2, to: 0.55, a0: 0.8 });
    this.burst('core', this.tex.star, [this.colors.shine, this.colors.gold], a.x, a.y, 4, { speed: 220, life: 260, size: 0.22 });
    const glow = this.take('glow', this.tex.glow, this.colors.amber);
    const face = this.take('body', this.tex.coinFace, this.colors.gold);
    const shine = this.take('core', this.tex.coinShine, this.colors.shine);
    const glint = this.take('core', this.tex.star, this.colors.shine);
    if (!glow || !face || !shine || !glint) { for (const s of [glow, face, shine, glint]) this.give(s); return; }
    const ghosts: Sprite[] = [];
    for (let i = 0; i < Math.max(0, Math.round(this.look.ghosts)); i++) {
      const g = this.take('glow', this.tex.coinFace, this.colors.amber);
      if (g) ghosts.push(g);
    }
    const k = (this.look.px * size * S) / COIN_TEX_D;
    this.coin = { path, age: Math.max(0, age0), k, flipHz, face, glow, shine, glint, ghosts, carom: -1, x: a.x, y: a.y, vx: 0, vy: 0, spin: 0, gone: false };
    this.drawCoin(0);
  }

  /** A ping on the face (a tick, or the impact's own sparkle): a four-point sparkle, a ring and a spray of glitter. */
  ping(at: Pt, dir: Pt, strength: number, sparkles: number): void {
    const P = this.look.ping * strength;
    const c = this.colors;
    this.spawn('core', this.tex.star, c.shine, at.x, at.y, { dur: 260, from: (0.9 * P * 64) / STAR_PX, to: (2.1 * P * 64) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.12, rot: 0.2 });
    this.spawn('core', this.tex.star, c.gold, at.x, at.y, { dur: 300, from: (0.6 * P * 64) / STAR_PX, to: (1.5 * P * 64) / STAR_PX, a0: 0.8, mode: 'punch', peakAt: 0.15, rot: Math.PI / 4 });
    this.spawn('glow', this.tex.glow, c.amber, at.x, at.y, { dur: 240, from: (60 * P) / GLOW_PX, to: (150 * P) / GLOW_PX, a0: 0.7, mode: 'punch', peakAt: 0.1 });
    this.spawn('glow', this.tex.ring, c.gold, at.x, at.y, { dur: 300, from: (24 * P) / RING_PX, to: (120 * P) / RING_PX, a0: 0.9, ease: 'cubic' });
    // Glitter sprays back off the face (against the coin's travel), with a little lift.
    const back = Math.atan2(-dir.y, -dir.x);
    this.burst('core', this.tex.star, [c.shine, c.gold, whiten(c.amber, 0.3)], at.x, at.y, sparkles, { speed: 380 * P, dir: back, spread: 2.6, life: 420, size: 0.26 * P, drag: 0.08, grav: 500 });
  }

  /** THE last ping. Small: the coin caroms off, tumbling away. Big: it bursts into `shower` coins that spill and fall. */
  impact(at: Pt, dir: Pt, o: { big: boolean; shower: number; sparkles: number }): void {
    const cn = this.coin;
    this.ping(at, dir, o.big ? 1.45 : 1.1, o.sparkles);
    const c = this.colors;
    const S = this.scale;
    if (o.big) {
      // A bright bloom and a second, wider ring: the payout.
      this.spawn('glow', this.tex.glow, c.gold, at.x, at.y, { dur: 380, from: 0.6, to: 2.4, a0: 0.75, mode: 'punch', peakAt: 0.1 });
      this.spawn('glow', this.tex.ring, c.amber, at.x, at.y, { dur: 440, from: 0.2, to: 1.3, a0: 0.8, ease: 'cubic', delay: 50 });
      if (cn) { this.dropCoin(cn); this.coin = null; }
      const k = cn ? cn.k : (this.look.px * S) / COIN_TEX_D;
      for (let i = 0; i < o.shower; i++) {
        // A fan up and out, the first few straight up (so the spill reads as a payout, not a spray).
        const a = -Math.PI / 2 + (i / Math.max(1, o.shower - 1) - 0.5) * 2.6 + (this.rnd() - 0.5) * 0.3;
        const sp = this.look.showerSpeed * (0.6 + this.rnd() * 0.55);
        const sz = (k / S) * (0.5 + this.rnd() * 0.25);
        this.spawn('body', this.tex.coinFace, c.gold, at.x, at.y, {
          dur: 900 + this.rnd() * 300, from: sz, to: sz * 0.9, a0: 1, mode: 'hold', ease: 'linear',
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.6, grav: this.look.showerGravity,
          flip: 0.012 + this.rnd() * 0.012, spin: (this.rnd() - 0.5) * 0.02, rot: this.rnd() * Math.PI, edgeTint: c.deep,
        });
      }
      // A few glints wink on the falling coins' way down (late sparkles, not a second burst).
      for (let i = 0; i < 4; i++) {
        this.spawn('core', this.tex.star, c.shine, at.x + (this.rnd() - 0.5) * 140 * S, at.y - (20 + this.rnd() * 90) * S, {
          dur: 220, from: 0.1, to: 0.5, a0: 0.9, mode: 'punch', peakAt: 0.3, delay: 120 + i * 90,
        });
      }
    } else if (cn) {
      // The carom: it bounces up and back off the face, tumbling faster, and falls away.
      const bx = -dir.x * 0.55, by = -dir.y * 0.55 - 0.85;
      const bl = Math.hypot(bx, by) || 1;
      cn.carom = 0;
      cn.x = at.x; cn.y = at.y;
      cn.vx = (bx / bl) * 440 * S; cn.vy = (by / bl) * 440 * S;
      cn.spin = (dir.x >= 0 ? -1 : 1) * 0.012;
      cn.flipHz *= 1.6;
    }
  }

  protected override tick(dt: number): boolean {
    const ch = this.charge;
    if (ch) {
      ch.age += dt;
      const u = clamp01(ch.age / ch.dur);
      ch.glint.alpha = this.look.glint * (0.35 + 0.65 * u);
      ch.glint.scale.set(((10 + 22 * u) * this.scale) / STAR_PX);
      ch.glint.rotation = u * 1.2;
      ch.ring.alpha = 0.7 * Math.sin(Math.PI * u);
      ch.ring.scale.set(((90 - 70 * u) * this.scale) / RING_PX);
    }
    const cn = this.coin;
    if (!cn) return ch !== null;
    cn.age += dt;
    if (cn.carom >= 0) {
      cn.carom += dt;
      const sec = dt / 1000;
      cn.vy += 1500 * this.scale * sec;
      cn.x += cn.vx * sec; cn.y += cn.vy * sec;
      if (cn.carom >= this.look.caromMs) { this.dropCoin(cn); this.coin = null; return ch !== null; }
    }
    this.drawCoin(dt);
    return true;
  }

  private drawCoin(dt: number): void {
    const cn = this.coin;
    if (!cn) return;
    void dt;
    const flying = cn.carom < 0;
    const p = flying ? coinPos(cn.path, cn.age) : { x: cn.x, y: cn.y, dx: cn.vx, dy: cn.vy };
    const turn = 2 * Math.PI * cn.flipHz * (cn.age / 1000);
    const w = Math.cos(turn);
    const open = Math.max(0.1, Math.abs(w));
    const rot = flying ? 0.35 * Math.sin(cn.age * 0.006) : (cn.carom * cn.spin);
    const fade = flying ? 1 : 1 - clamp01((cn.carom - this.look.caromMs * 0.55) / (this.look.caromMs * 0.45));
    const born = clamp01(cn.age / 60);
    const k = cn.k * (0.6 + 0.4 * born);
    cn.face.position.set(p.x, p.y); cn.face.rotation = rot; cn.face.scale.set(k * open, k);
    // Edge-on, the face shades toward deep bronze (the rim catches less light).
    cn.face.tint = mixColor(this.colors.deep, this.colors.gold, open);
    cn.face.alpha = fade;
    cn.shine.position.set(p.x, p.y); cn.shine.rotation = rot; cn.shine.scale.set(k * open, k);
    cn.shine.alpha = fade * Math.pow(open, 6) * 0.9;
    const gk = (this.look.px * 2.2 * this.scale) / GLOW_PX;
    cn.glow.position.set(p.x, p.y); cn.glow.scale.set(gk * (0.8 + 0.2 * open)); cn.glow.alpha = fade * 0.45;
    // The glint winks when the face turns square to the view.
    const peak = Math.pow(open, 14);
    cn.glint.position.set(p.x - 0.18 * k * COIN_TEX_D, p.y - 0.2 * k * COIN_TEX_D);
    cn.glint.scale.set((k * COIN_TEX_D * 0.9 * (0.4 + 0.6 * peak)) / STAR_PX);
    cn.glint.rotation = cn.age * 0.004;
    cn.glint.alpha = fade * this.look.glint * peak;
    // The afterimages: the coin's own shape, sampled back along its path, fading.
    const ghostOn = flying && cn.age < coinPathMs(cn.path) + 30;
    for (let i = 0; i < cn.ghosts.length; i++) {
      const g = cn.ghosts[i]!;
      const back = cn.age - (i + 1) * this.look.ghostMs;
      if (!ghostOn || back <= 0) { g.alpha = 0; continue; }
      const q = coinPos(cn.path, back);
      g.position.set(q.x, q.y);
      g.scale.set(k * 0.92 * open, k * 0.92);
      g.rotation = rot;
      g.alpha = 0.34 * (1 - i / (cn.ghosts.length + 0.5));
    }
  }

  private dropCoin(cn: Coin): void {
    cn.gone = true;
    for (const s of [cn.face, cn.glow, cn.shine, cn.glint, ...cn.ghosts]) this.give(s);
  }

  protected override clearOwn(): void {
    if (this.coin) { this.dropCoin(this.coin); this.coin = null; }
    if (this.charge) { this.give(this.charge.glint); this.give(this.charge.ring); this.charge = null; }
  }
}

