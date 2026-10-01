/**
 * THE FEL SCENE: everything the Fel ("Chaos Bolt") hero attack draws in Pixi, as a plain scene graph with no renderer,
 * so it runs (and is tested) headless. `heroFel.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * The look (owner 2026-09-30: "on par with hearthstone/modern world of warcraft"), Blizzard's VFX rules applied:
 *  - SILHOUETTE FIRST. A chaos bolt is three reads stacked: a white-green HEART, a DARK spiky SHELL round it (normal
 *    blend, so it stays dark on any board: the bright core / dark rim contrast) with a thin green RIM light outside it,
 *    and the live fel fire (`../heroAttack/pixiFire.ts`, a green palette over dark purple smoke) licking off it. Crackles
 *    of chaos lightning flash round the shell and are left hanging along its path.
 *  - ANTICIPATION. A fel SIGIL spins open where each bolt forms, motes stream into it, the bolt swells, then is drawn
 *    back; the sigil collapses in a flash on the release.
 *  - RELEASE + IMPACT. The impact is a white flash, the shell SHATTERING outward as a dark ring, a green shock ring, a
 *    star of crackles and shards, and fel fire rolling up into dark smoke: a big, chunky, readable pop.
 *  - DISSIPATION. Fire burns down to embers and smoke; Tier IV leaves fel flames on the struck rim and ASH drifting.
 *  - TIER IV, THE HAND: a fel RUNE CIRCLE opens flat over the struck hero (two counter-rotating glyph rings, the ground
 *    under it darkened, flames licking up its rim, motes drawn in), a CHAOS METEOR (a giant bolt) falls into it, and it
 *    ERUPTS: a pillar of fel fire and light towering off the target, shockwaves, the circle flaring and breaking.
 *
 * LAYERS, bottom to top: under (normal: the darkened ground, the scorch, the dark pressure ring) | glow (additive: light,
 * sigils, the rune circle, rims, rings) | the fire's back (normal: smoke, the deep body) | body (normal: the dark
 * shells, ash) | the fire's front (additive: flame, embers) | core (additive: hearts, crackles, shards, flashes).
 *
 * Contract: sprites are POOLED per layer (`FxPool`), bounded by `MAX_FEL_SPRITES`; fire particles by
 * `MAX_FEL_PARTICLES`; textures are the caller's and pre-warmed at construction (while the damage formation plays);
 * positions are the overlay's px; `update` returns whether anything still draws; `destroy()` leaves nothing behind.
 * Scatter is seeded (a replay burns the same fire). The scene's clock is the sequence's.
 */
import { Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeInOutSine, easeOutBack, easeOutCubic, mixColor, whiten, type Pt } from '../heroAttack/easing';
import { FxPool, type FxLayer } from '../heroAttack/fxPool';
import { PixiFire, type FireEmitter, type FireTextures } from '../heroAttack/pixiFire';
import { boltPose, felMeteorPose, type BoltMotion, type FelMeteorMotion } from './heroFelConfig';
import { CRACKLE_W, RUNE_R, SHARD_W, SHELL_R } from './heroFelTextures';

export interface HeroFelTextures extends HeroArcanaTextures {
  fire: FireTextures;
  scorch: Texture;
  shock: Texture;
  /** The fel rune circle (its outer ring at `RUNE_R` of 256 px). */
  rune: Texture;
  /** A jagged fork of chaos lightning (`CRACKLE_W` wide, along +x). */
  crackle: Texture;
  /** A ragged dark annulus (its ring at `SHELL_R` of 128 px). */
  shell: Texture;
  /** A sharp sliver along +x (`SHARD_W` long). */
  shard: Texture;
}

export interface FelColors { core: number; hot: number; fel: number; deep: number; ember: number; smoke: number; shell: number; rune: number; side: number }

export interface FelLook {
  kindle: number; sigilSize: number; motes: number;
  boltFlame: number; boltGlow: number; shell: number; crackle: number; trail: number; trailSmoke: number;
  turbulence: number; buoyancy: number; smoke: number; embers: number;
  impactSize: number; shards: number; burnSize: number;
  gateSize: number; eruptMs: number; eruptHeight: number; burnoutMs: number; ash: number; scorch: number;
}

/** Hard cap on the sprites (light, shells, sigils, crackles, shards, ash) alive at once. */
export const MAX_FEL_SPRITES = 320;
/** Hard cap on live fire particles (the eruption peaks near it; the pool never grows past it). */
export const MAX_FEL_PARTICLES = 1100;

/** Radius (px) a sprite of scale 1 covers, per texture. */
const GLOW_R = 64, SHOCK_R = 115, SCORCH_R = 102, PUFF_R = 32, SPARK_R = 16;
const UP = -Math.PI / 2, UP_HALF = Math.PI * 0.62;

/** One glowing orb of chaos: a bolt, or the Tier IV meteor (a giant one). */
interface Orb {
  em: FireEmitter; tail: FireEmitter;
  heart: Sprite; core: Sprite; halo: Sprite; shell: Sprite; rim: Sprite;
  spin: number; crackIn: number; lastX: number; lastY: number;
}

interface Bolt {
  m: BoltMotion; orb: Orb; sigil: Sprite | null;
  state: 'form' | 'fly' | 'gone';
  /** Ms since the sigil collapsed (-1 while it is open). */
  sigilGone: number;
  moteIn: number; formedFx: boolean;
}

interface Charge { em: FireEmitter; light: Sprite; x: number; y: number; r: number; age: number; dur: number; left: number; releasing: number }

interface Meteor { m: FelMeteorMotion; orb: Orb }

/** Tier IV: the rune circle over the target, from its opening to a beat after it erupts. */
interface Gate {
  x: number; y: number; R: number; gr: number;
  outer: Sprite; inner: Sprite; dark: Sprite; light: Sprite; em: FireEmitter;
  age: number; dur: number; erupted: number; moteIn: number;
}

interface Nova { em: FireEmitter; age: number; dur: number; r0: number; r1: number }
interface Debris { em: FireEmitter; core: Sprite; x: number; y: number; vx: number; vy: number; age: number; life: number }
interface Later { at: number; kind: 'billow' | 'ash'; x: number; y: number; R: number }

export class HeroFelScene extends FxPool {
  private readonly fire: PixiFire;
  private readonly S: number;
  private clock = 0;
  private bolts: Bolt[] = [];
  private charge: Charge | null = null;
  private meteor: Meteor | null = null;
  private gate: Gate | null = null;
  private novas: Nova[] = [];
  private debris: Debris[] = [];
  private later: Later[] = [];
  private reserving = true;

  constructor(private readonly tex: HeroFelTextures, private readonly colors: FelColors, private readonly look: FelLook, scale = 1, seed = 1) {
    const f = tex.fire;
    super('heroFel', [tex.glow, tex.spark, tex.shock, tex.scorch, tex.rune, tex.crackle, tex.shell, tex.shard, ...f.puffs, f.tongue, f.smoke, f.ember, f.glow], 1, seed, MAX_FEL_SPRITES);
    this.S = scale;
    this.fire = new PixiFire(f, {
      cap: MAX_FEL_PARTICLES, scale, seed: seed * 31 + 7,
      palette: { core: colors.core, hot: colors.hot, mid: colors.fel, deep: colors.deep, dark: colors.ember, smoke: colors.smoke },
      smoke: look.smoke, embers: look.embers, turb: look.turbulence, lift: look.buoyancy,
    });
    // under | glow | fire back | body | fire front | core
    this.root.addChildAt(this.fire.back, 2);
    this.root.addChildAt(this.fire.front, 4);
    this.fire.planReserve();
  }

  get liveFire(): number { return this.fire.count; }
  get pooledFire(): number { return this.fire.pooled; }
  get emitters(): number { return this.fire.emitting; }
  get liveBolts(): number { return this.bolts.filter((b) => b.state !== 'gone').length; }
  get charging(): boolean { return this.charge !== null; }
  get meteorLive(): boolean { return this.meteor !== null; }
  get gateOpen(): boolean { return this.gate !== null; }
  get liveDebris(): number { return this.debris.length; }
  get time(): number { return this.clock; }
  /** Every live draw: the pooled sprites and the fire particles. */
  get liveAll(): number { return this.liveSprites + this.fire.count; }

  // ── small helpers ──────────────────────────────────────────────────────────────────────────────────────────

  /** A one-shot sprite in px: radius `from` -> `to` on a texture whose scale-1 radius is `unit`. */
  private fxs(layer: FxLayer, t: Texture, tint: number, x: number, y: number, unit: number, o: {
    dur: number; from: number; to: number; a0: number; mode?: 'out' | 'punch' | 'hold'; peakAt?: number; delay?: number;
    rot?: number; spin?: number; sy?: number; vx?: number; vy?: number; drag?: number; grav?: number; align?: boolean; ease?: 'quint' | 'cubic' | 'linear';
  }): Sprite | null {
    return this.spawn(layer, t, tint, x, y, { ...o, from: o.from / unit, to: o.to / unit });
  }

  /** A crackle of chaos lightning at (x, y), `len` px long, pointing along `rot`. */
  private crackleAt(x: number, y: number, len: number, rot: number, tint: number, dur = 90, a0 = 1): void {
    const s = this.fxs('core', this.tex.crackle, tint, x, y, CRACKLE_W / 2, { dur, from: len / 2, to: len / 2 * 1.08, a0, rot, sy: this.rnd() < 0.5 ? 1 : -1, ease: 'linear' });
    if (s) s.anchor.set(0.5);
  }

  /** A star of crackles thrown round (x, y). */
  private crackleStar(x: number, y: number, R: number, n: number, tint: number, dur: number): void {
    const k = Math.round(n * this.look.crackle);
    for (let i = 0; i < k; i++) {
      const a = (i / Math.max(1, k)) * Math.PI * 2 + this.rnd() * 0.5;
      const len = R * (0.9 + this.rnd() * 0.6);
      this.crackleAt(x + Math.cos(a) * len * 0.55, y + Math.sin(a) * len * 0.55, len, a, i % 2 ? tint : this.colors.core, dur);
    }
  }

  /** Shards flung out of (x, y), tip first, slowing hard. */
  private shardBurst(x: number, y: number, R: number, n: number, speed: number, dir?: number, spread = Math.PI * 2): void {
    const k = Math.round(n * this.look.shards);
    const S = this.S;
    for (let i = 0; i < k; i++) {
      const a = dir === undefined ? this.rnd() * Math.PI * 2 : dir + (this.rnd() - 0.5) * spread;
      const sp = speed * S * (0.55 + this.rnd() * 0.7);
      const len = R * (0.35 + this.rnd() * 0.35);
      this.fxs('core', this.tex.shard, i % 3 === 0 ? this.colors.core : this.colors.hot, x, y, SHARD_W / 2, {
        dur: 260 + this.rnd() * 160, from: len, to: len * 0.5, a0: 1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.015, align: true, ease: 'linear', sy: 0.9,
      });
    }
  }

  private makeOrb(x: number, y: number, r: number, o: { rate: number; tail: number; tailK: number; smoke: number }): Orb | null {
    const c = this.colors;
    const heart = this.take('core', this.tex.glow, 0xffffff);
    const core = this.take('core', this.tex.fire.puffs[0]!, c.core);
    const halo = this.take('glow', this.tex.fire.glow, c.fel);
    const rim = this.take('glow', this.tex.shell, c.fel);
    const shell = this.take('body', this.tex.shell, c.shell);
    if (!heart || !core || !halo || !rim || !shell) { for (const s of [heart, core, halo, rim, shell]) this.give(s); return null; }
    for (const s of [heart, core, halo, rim, shell]) { s.alpha = 0; s.position.set(x, y); }
    const em = this.fire.emitter({
      shape: 'point', x, y, r: r * 0.4, rate: o.rate * this.look.boltFlame, size: r * 1.15, life: 300, lift: 520, speed: 50, heat: 1,
      turb: 260, tongues: 0.35, body: 0.3, smoke: 0.04, embers: 6, sweep: false,
    });
    em.intensity = 0;
    const tail = this.fire.emitter({
      shape: 'point', x, y, r: r * 0.4, rate: o.tail * o.tailK * this.look.boltFlame * this.look.trail, size: r * 1.25, life: 420,
      lift: 220, speed: 40, heat: 0.85, turb: 240, tongues: 0.15, body: 0.35, smoke: o.smoke * this.look.trailSmoke, embers: 28,
    });
    tail.intensity = 0;
    return { em, tail, heart, core, halo, shell, rim, spin: this.rnd() * 6.28, crackIn: 0, lastX: x, lastY: y };
  }

  private dropOrb(o: Orb): void {
    this.fire.stop(o.em); this.fire.stop(o.tail);
    for (const s of [o.heart, o.core, o.halo, o.shell, o.rim]) this.give(s);
  }

  /**
   * Draw an orb at (x, y), radius `r` (grown), visibility `vis` (0..1). In flight the head rides with it and the tail
   * streams behind (spread along the swept path); crackles flash round the shell and are left along the path.
   */
  private drawOrb(o: Orb, x: number, y: number, r: number, vis: number, flying: boolean, rot: number, dt: number, crackRate: number): void {
    const L = this.look, c = this.colors, S = this.S;
    const t = this.clock;
    const flick = 0.9 + 0.1 * Math.sin(t * 0.06 + o.spin) + 0.05 * Math.sin(t * 0.17);
    o.spin += dt * (flying ? 0.012 : 0.006);
    o.em.x = x; o.em.y = y; o.em.r = Math.max(1, r * 0.4); o.em.size = Math.max(1, r * 1.15);
    o.em.intensity = vis;
    o.tail.x = x; o.tail.y = y;
    if (flying && dt > 0) {
      const vx = (x - o.lastX) / dt, vy = (y - o.lastY) / dt;
      o.em.vx = (vx * 1000 * 0.85) / S; o.em.vy = (vy * 1000 * 0.85) / S; o.em.life = 150; o.em.lift = 100;
      o.tail.vx = (vx * 1000 * 0.1) / S; o.tail.vy = (vy * 1000 * 0.1) / S;
      o.tail.intensity = 1; o.tail.size = Math.max(1, r * 1.25);
    } else {
      o.tail.lx = x; o.tail.ly = y;
    }
    // The heart: a white-green core (stretched along the flight), a white pin of light inside it.
    const cs = (r * 0.72 * flick) / PUFF_R;
    o.core.position.set(x, y); o.core.rotation = rot;
    o.core.scale.set(cs * (flying ? 1.45 : 1), cs);
    o.core.alpha = 0.95 * vis;
    o.heart.position.set(x, y);
    o.heart.scale.set((r * 0.55) / GLOW_R);
    o.heart.alpha = 0.9 * vis;
    // The dark crackling shell (normal blend: dark on any board) and the thin green rim light just outside it.
    const sh = (r * 1.08) / SHELL_R;
    o.shell.position.set(x, y); o.shell.rotation = o.spin;
    o.shell.scale.set(sh * (flying ? 1.18 : 1), sh);
    o.shell.alpha = Math.min(1, 0.88 * L.shell) * vis;
    o.rim.position.set(x, y); o.rim.rotation = -o.spin * 0.7;
    o.rim.scale.set(sh * 1.16 * (flying ? 1.15 : 1), sh * 1.16);
    o.rim.alpha = 0.55 * vis * flick;
    o.halo.position.set(x, y);
    o.halo.scale.set((r * 3.4) / GLOW_R);
    o.halo.alpha = 0.55 * L.boltGlow * vis * flick;
    // Crackles round the shell (left hanging where the bolt was: a crackling trail in flight).
    o.crackIn -= dt;
    if (vis > 0.5 && crackRate > 0 && o.crackIn <= 0) {
      o.crackIn = (flying ? 34 : 70) / crackRate;
      const a = this.rnd() * Math.PI * 2;
      const len = r * (1.2 + this.rnd() * 0.8);
      this.crackleAt(x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75, len, a + Math.PI / 2 + (this.rnd() - 0.5), this.rnd() < 0.5 ? c.hot : c.core, flying ? 120 : 80, 0.9);
    }
    o.lastX = x; o.lastY = y;
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** The hero gathers fel power: green flames catch round its upper rim and its light spreads under it. */
  startCharge(x: number, y: number, R: number, durMs: number, launches: number): void {
    if (this.destroyed || this.charge) return;
    const light = this.take('glow', this.tex.fire.glow, this.colors.fel);
    if (!light) return;
    light.position.set(x, y); light.alpha = 0; light.scale.set((R * 2.4) / GLOW_R);
    const em = this.fire.emitter({
      shape: 'ring', x, y, r: R * 0.95, a0: UP - UP_HALF, a1: UP + UP_HALF, rate: 320 * this.look.kindle, size: R * 0.5, life: 520,
      lift: 760, speed: 30, out: 40, heat: 0.95, turb: 300, tongues: 0.3, body: 0.35, smoke: 0.1, embers: 8,
    });
    em.intensity = 0;
    this.charge = { em, light, x, y, r: R, age: 0, dur: Math.max(1, durMs), left: Math.max(1, launches), releasing: -1 };
  }

  /** A bolt begins: its sigil spins open at its home, motes stream in, the bolt swells out of it. */
  grow(m: BoltMotion, tailK = 1): void {
    if (this.destroyed) return;
    const orb = this.makeOrb(m.home.x, m.home.y, m.radius, { rate: 300, tail: 560, tailK, smoke: m.great ? 0.22 : 0.16 });
    if (!orb) return;
    const sigil = this.look.sigilSize > 0 ? this.take('glow', this.tex.rune, this.colors.rune) : null;
    if (sigil) { sigil.position.set(m.home.x, m.home.y); sigil.alpha = 0; sigil.scale.set(0.01); }
    this.bolts.push({ m, orb, sigil, state: 'form', sigilGone: -1, moteIn: 0, formedFx: false });
    this.fxs('core', this.tex.glow, this.colors.core, m.home.x, m.home.y, GLOW_R, { dur: 200, from: m.radius * 0.3, to: m.radius * 1.4, a0: 0.75, mode: 'punch', peakAt: 0.3 });
  }

  /** A bolt is RELEASED: its sigil collapses in a flash, a kick of fire and crackle off its back, and it flies. */
  fireBolt(m: BoltMotion): void {
    const ch = this.charge;
    if (ch && ch.releasing < 0 && --ch.left <= 0) ch.releasing = 0;
    const b = this.bolts.find((x) => x.m === m && x.state === 'form');
    if (!b) return;
    b.state = 'fly';
    b.sigilGone = 0;
    const back = Math.atan2(m.from.y - m.to.y, m.from.x - m.to.x);
    const r = m.radius;
    this.fxs('core', this.tex.glow, this.colors.core, m.from.x, m.from.y, GLOW_R, { dur: 140, from: r * 0.9, to: r * 2.2, a0: 0.9 });
    this.fxs('glow', this.tex.shock, this.colors.hot, m.from.x, m.from.y, SHOCK_R, { dur: 200, from: r * 0.6, to: r * 2, a0: 0.55 });
    this.fire.burst(m.from.x, m.from.y, { n: 10, radius: r * 0.4, speed: 300, size: r * 0.85, life: 340, dir: back, spread: 1.5, drag: 4, smoke: 0.25 });
    this.crackleStar(m.from.x, m.from.y, r * 1.1, 3, this.colors.hot, 110);
  }

  /** A bolt lands: it goes out (its tail burns out on its own). */
  land(m: BoltMotion): void {
    const b = this.bolts.find((x) => x.m === m && x.state !== 'gone');
    if (!b) return;
    this.dropOrb(b.orb);
    if (b.sigil) { this.give(b.sigil); b.sigil = null; }
    b.state = 'gone';
  }

  /**
   * A chaos bolt (or the meteor's shell) BURSTS at (x, y): a white flash, the fel light, its dark shell SHATTERING
   * outward as a dark ring, a green shock ring, a star of crackles and shards, fel fire blooming and rolling up into
   * dark smoke, and a spray carried on along the blow. `big` is THE impact.
   */
  impact(x: number, y: number, R: number, o: { size: number; big: boolean; dir: Pt; flashAlpha: number; embers: number }): void {
    if (this.destroyed) return;
    const c = this.colors;
    const sz = o.size * this.look.impactSize;
    const big = o.big;
    this.fxs('core', this.tex.glow, 0xffffff, x, y, GLOW_R, { dur: big ? 110 : 80, from: R * 0.5 * sz, to: R * (big ? 1.25 : 0.85) * sz, a0: o.flashAlpha * (big ? 0.9 : 0.65) });
    this.fxs('core', this.tex.glow, c.core, x, y, GLOW_R, { dur: big ? 200 : 140, from: R * 0.7 * sz, to: R * (big ? 1.7 : 1.1) * sz, a0: o.flashAlpha * 0.6 });
    this.fxs('glow', this.tex.fire.glow, c.fel, x, y, GLOW_R, { dur: big ? 760 : 500, from: R * 1.5 * sz, to: R * 2.7 * sz, a0: big ? 0.75 : 0.5 });
    // The shell shatters outward: a dark ragged ring racing out (normal blend), the contrast that sells the pop.
    if (this.look.shell > 0) {
      this.fxs('body', this.tex.shell, c.shell, x, y, SHELL_R, { dur: big ? 300 : 230, from: R * 0.45 * sz, to: R * (big ? 1.9 : 1.3) * sz, a0: Math.min(1, 0.8 * this.look.shell), rot: this.rnd() * 6.28, ease: 'cubic' });
    }
    this.fxs('glow', this.tex.shock, whiten(c.hot, 0.3), x, y, SHOCK_R, { dur: big ? 300 : 220, from: R * 0.4, to: R * (big ? 2 : 1.35) * sz, a0: big ? 0.8 : 0.55 });
    this.crackleStar(x, y, R * 0.9 * sz, big ? 7 : 4, c.hot, big ? 150 : 110);
    this.shardBurst(x, y, R * sz, big ? 10 : 5, big ? 1100 : 800);
    this.fire.burst(x, y, {
      n: (big ? 46 : 20) * sz, radius: R * 0.28 * sz, speed: (big ? 580 : 420) * sz, size: R * (big ? 0.62 : 0.5) * sz, life: big ? 640 : 480,
      lift: 760, drag: 3.2, heat: 1, tongues: 0.2, body: 0.45, smoke: big ? 0.5 : 0.32, embers: o.embers, emberSpeed: big ? 520 : 380,
    });
    this.fire.burst(x, y, { n: (big ? 14 : 7) * sz, radius: R * 0.2, speed: 780 * sz, size: R * 0.42 * sz, life: 380, dir: Math.atan2(o.dir.y, o.dir.x), spread: 1.2, drag: 4.5, smoke: 0.2 });
    this.fire.smokePuffs(x, y - R * 0.3, big ? 5 : 2, { radius: R * 0.5, size: R * 1.1 * sz, life: 1400, rise: 60, alpha: 0.42 });
  }

  /** The struck portrait's UPPER rim catches fel fire: it burns at `amount` for `holdMs`, then dies down to smoke. */
  burn(x: number, y: number, R: number, amount: number, holdMs: number): void {
    if (this.destroyed || !(amount > 0)) return;
    const k = this.look.burnSize;
    this.fire.emitter({
      shape: 'ring', x, y, r: R * 0.95 * k, a0: UP - UP_HALF * 1.05, a1: UP + UP_HALF * 1.05, rate: 170 * amount, size: R * 0.42 * k,
      life: 540, lift: 860, speed: 40, out: 50, heat: 0.95, turb: 320, tongues: 0.5, body: 0.35, smoke: 0.3, embers: 12 * amount,
    }, { hold: holdMs, fade: 700 });
    this.fxs('glow', this.tex.fire.glow, this.colors.fel, x, y, GLOW_R, { dur: holdMs + 700, from: R * 2, to: R * 2.2, a0: Math.min(0.5, 0.3 * amount), mode: 'hold' });
  }

  /** Tier III's great bolt FLARES the struck hero up: a gout of fel flame roaring off the whole portrait. */
  flareUp(x: number, y: number, R: number, amount: number): void {
    if (this.destroyed || !(amount > 0)) return;
    this.fire.emitter({
      shape: 'disc', x, y, r: R * 0.8, rate: 420 * amount, size: R * 0.8, life: 640, lift: 1500, speed: 50, heat: 1, turb: 320,
      tongues: 0.35, body: 0.4, smoke: 0.3, embers: 24 * amount, emberSpeed: 300,
    }, { hold: 160, fade: 520 });
    this.fire.burst(x, y - R * 0.3, { n: 28 * amount, radius: R * 0.6, speed: 320, size: R * 0.7, life: 620, lift: 1300, dir: UP, spread: 1.6, drag: 2, tongues: 0.25, smoke: 0.3 });
  }

  /**
   * THE HAND (Tier IV): a fel RUNE CIRCLE opens flat over the struck hero for `durMs` (until the eruption): it spins
   * open with an overshoot, two glyph rings counter-rotating, the ground under it darkening, flames licking up its rim,
   * motes drawn in, brightening as the meteor nears.
   */
  openGate(x: number, y: number, R: number, durMs: number): void {
    if (this.destroyed || this.gate) return;
    const c = this.colors;
    const dark = this.take('under', this.tex.fire.glow, c.shell);
    const light = this.take('glow', this.tex.fire.glow, c.fel);
    const outer = this.take('glow', this.tex.rune, c.rune);
    const inner = this.take('glow', this.tex.rune, whiten(c.hot, 0.2));
    if (!dark || !light || !outer || !inner) { for (const s of [dark, light, outer, inner]) this.give(s); return; }
    for (const s of [dark, light, outer, inner]) { s.position.set(x, y); s.alpha = 0; s.scale.set(0.01); }
    const gr = R * this.look.gateSize;
    const em = this.fire.emitter({
      shape: 'ring', x, y, r: gr * 0.92, rate: 300, size: R * 0.38, life: 440, lift: 950, speed: 30, out: 10, heat: 0.95, turb: 320,
      tongues: 0.45, body: 0.3, smoke: 0.12, embers: 14, emberSpeed: 160,
    });
    em.intensity = 0;
    this.gate = { x, y, R, gr, outer, inner, dark, light, em, age: 0, dur: Math.max(1, durMs), erupted: -1, moteIn: 0 };
    this.fxs('core', this.tex.glow, c.core, x, y, GLOW_R, { dur: 220, from: R * 0.4, to: gr * 1.1, a0: 0.55 });
    this.fxs('glow', this.tex.shock, c.hot, x, y, SHOCK_R, { dur: 320, from: R * 0.3, to: gr * 1.05, a0: 0.6 });
  }

  /** The chaos meteor starts its fall: a giant bolt (heart, dark shell, fel fire, a heavy tail of fire and smoke). */
  startMeteor(m: FelMeteorMotion): void {
    if (this.destroyed || this.meteor) return;
    const orb = this.makeOrb(m.from.x, m.from.y, m.radius, { rate: 380, tail: 520, tailK: 1, smoke: 0.3 });
    if (!orb) return;
    this.meteor = { m, orb };
  }

  /**
   * THE ERUPTION (Tier IV, the consequence frame, no freeze): a white core and a screen flash, shockwaves and a dark
   * pressure ring, the meteor's shell shattering, the rune circle flaring and breaking, a towering PILLAR of fel fire
   * and light off the target, a nova racing out, crackles, shards and burning debris, a scorch, and (a beat later) the
   * column billowing up and ASH drifting down.
   */
  erupt(x: number, y: number, R: number, o: { burst: number; flashAlpha: number; embers: number; screen: number }): void {
    if (this.destroyed) return;
    const mt = this.meteor;
    if (mt) { this.dropOrb(mt.orb); this.meteor = null; }
    const g = this.gate;
    if (g && g.erupted < 0) { g.erupted = 0; this.fire.stop(g.em); }
    const c = this.colors, L = this.look;
    const b = Math.max(0.5, o.burst);
    this.fxs('core', this.tex.glow, 0xffffff, x, y, GLOW_R, { dur: 120, from: R * 0.8, to: R * 2, a0: 1 });
    this.fxs('core', this.tex.glow, c.core, x, y, GLOW_R, { dur: 190, from: R * 1.5, to: R * 2.6 * b, a0: o.flashAlpha });
    this.fxs('core', this.tex.glow, whiten(c.fel, 0.5), x, y, GLOW_R, { dur: 150, from: o.screen * 0.5, to: o.screen * 0.7, a0: 0.25 * o.flashAlpha });
    this.fxs('glow', this.tex.fire.glow, c.fel, x, y, GLOW_R, { dur: 1500, from: R * 3, to: R * 5, a0: 0.75 });
    // The pillar of light: a tall soft column off the target (a stretched glow), then the fire roaring up it.
    const hgt = L.eruptHeight;
    this.fxs('glow', this.tex.fire.glow, whiten(c.hot, 0.25), x, y - R * 2 * hgt, GLOW_R, { dur: 520, from: R * 1.1, to: R * 1.35, a0: 0.85, sy: 3.2 * hgt, mode: 'punch', peakAt: 0.15 });
    this.fxs('glow', this.tex.shock, whiten(c.hot, 0.5), x, y, SHOCK_R, { dur: 560, from: R * 0.8, to: R * 6.5, a0: 1 });
    this.fxs('glow', this.tex.shock, c.fel, x, y, SHOCK_R, { dur: 720, delay: 70, from: R * 0.6, to: R * 4.8, a0: 0.75 });
    this.fxs('under', this.tex.shock, mixColor(c.shell, 0x000000, 0.3), x, y, SHOCK_R, { dur: 640, delay: 30, from: R, to: R * 5.8, a0: 0.55 });
    if (L.shell > 0) this.fxs('body', this.tex.shell, c.shell, x, y, SHELL_R, { dur: 360, from: R * 0.8, to: R * 3.2, a0: Math.min(1, 0.85 * L.shell), rot: this.rnd() * 6.28, ease: 'cubic' });
    if (L.scorch > 0) this.fxs('under', this.tex.scorch, mixColor(c.smoke, c.ember, 0.4), x, y, SCORCH_R, { dur: 3000, from: R * 2.1 * L.scorch, to: R * 2.5 * L.scorch, a0: 0.85, mode: 'hold' });
    this.crackleStar(x, y, R * 1.6, 10, c.hot, 200);
    this.shardBurst(x, y, R * 1.3, 16, 1500);
    // THE PILLAR: fel fire roaring straight up off the struck hero, then burning out to embers and smoke.
    this.fire.emitter({
      shape: 'disc', x, y, r: R * 0.85, rate: 560, size: R * 1.0, life: 760, lift: 1500 * hgt, vy: -900 * hgt, speed: 60, heat: 1, turb: 300,
      tongues: 0.45, body: 0.4, smoke: 0.3, embers: 30, emberSpeed: 340,
    }, { hold: L.eruptMs, fade: L.burnoutMs });
    // A ring of fel fire racing out, and the dome.
    const nova = this.fire.emitter({
      shape: 'ring', x, y, r: R * 0.6, rate: 900, size: R * 0.8, life: 460, lift: 500, out: 620, speed: 80, heat: 1, turb: 260,
      tongues: 0.15, body: 0.25, smoke: 0.2, drag: 2.2,
    }, { hold: 360, fade: 160 });
    this.novas.push({ em: nova, age: 0, dur: 360, r0: R * 0.6, r1: R * 3 });
    this.fire.burst(x, y, {
      n: 100, radius: R * 0.5, speed: 880, size: R * 0.8, life: 700, lift: 900, drag: 3.6, heat: 0.9, tongues: 0.25, body: 0.45, smoke: 0.5,
      embers: o.embers, emberSpeed: 700,
    });
    this.fire.smokePuffs(x, y - R * 0.6, 6, { radius: R * 0.8, size: R * 1.8, life: 2200, rise: 90, alpha: 0.45 });
    this.later.push({ at: this.clock + 120, kind: 'billow', x, y: y - R * 0.9, R }, { at: this.clock + 260, kind: 'ash', x, y, R });
    // Burning debris flung out on arcs, each trailing its own fel fire.
    const S = this.S;
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = UP + (i / (n - 1) - 0.5) * 2.7 + Math.sin(i * 12.9898) * 0.15;
      const sp = (620 + (340 * ((i * 7) % 5)) / 4) * S;
      const core = this.take('core', this.tex.fire.ember, c.hot);
      if (!core) break;
      core.scale.set((R * 0.2) / 8);
      const em = this.fire.emitter({
        shape: 'point', x, y, r: R * 0.08, rate: 110, size: R * 0.28, life: 300, lift: 240, speed: 20, heat: 0.95, turb: 200,
        tongues: 0.1, body: 0.2, smoke: 0.35,
      });
      this.debris.push({ em, core, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: 680 + 60 * (i % 5) });
    }
  }

  private layer(q: Later): void {
    const { x, y, R } = q;
    if (q.kind === 'billow') {
      this.fire.burst(x, y, {
        n: 34, radius: R * 0.6, speed: 260, size: R * 1.2, life: 900, lift: 1700, dir: UP, spread: 1.3, drag: 1.4, heat: 0.7,
        tongues: 0.12, body: 0.6, smoke: 0.85,
      });
      this.fire.smokePuffs(x, y - R * 0.8, 6, { radius: R * 1.1, size: R * 2, life: 2400, rise: 110, alpha: 0.45 });
    } else {
      // ASH: dark flakes fluttering down and drifting across, a few still glowing green at the edge.
      const n = Math.round(26 * this.look.ash);
      const ash = mixColor(this.colors.smoke, 0x6a6470, 0.35);
      const S = this.S;
      for (let i = 0; i < n; i++) {
        const a = this.rnd() * Math.PI * 2, d = R * (0.4 + this.rnd() * 2.4);
        const glowing = i % 5 === 0;
        const sz = R * (0.05 + this.rnd() * 0.06);
        this.fxs(glowing ? 'core' : 'body', this.tex.spark, glowing ? this.colors.hot : ash, x + Math.cos(a) * d, y - R * (1.6 + this.rnd() * 1.6) + Math.sin(a) * d * 0.4, SPARK_R, {
          dur: 1500 + this.rnd() * 900, from: sz, to: sz * 0.7, a0: glowing ? 0.9 : 0.85, mode: 'hold',
          vx: (this.rnd() - 0.5) * 70 * S, vy: (25 + this.rnd() * 45) * S, drag: 0.8, grav: 12 * S, spin: (this.rnd() - 0.5) * 0.01, rot: this.rnd() * 6.28, sy: 0.6,
        });
      }
    }
  }

  /** An aftershock: a small fel burst, a ring and a crackle round the eruption. */
  boom(x: number, y: number, R: number, size: number): void {
    if (this.destroyed) return;
    this.fxs('glow', this.tex.shock, this.colors.hot, x, y, SHOCK_R, { dur: 260, from: R * 0.2, to: R * 0.9 * size, a0: 0.6 });
    this.crackleStar(x, y, R * 0.6 * size, 3, this.colors.hot, 120);
    this.fire.burst(x, y, { n: 12 * size, radius: R * 0.2, speed: 380, size: R * 0.42 * size, life: 460, lift: 900, drag: 3.5, smoke: 0.35, embers: 5 });
  }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  private updateCharge(dt: number): void {
    const ch = this.charge;
    if (!ch) return;
    ch.age += dt;
    if (ch.releasing < 0) {
      const u = clamp01(ch.age / ch.dur);
      ch.em.intensity = 0.25 + 0.95 * easeInOutSine(u);
      ch.light.alpha = 0.5 * easeInOutSine(u) * (0.9 + 0.1 * Math.sin(ch.age * 0.03));
    } else {
      ch.releasing += dt;
      const r = clamp01(ch.releasing / 380);
      ch.em.intensity = 1.2 * (1 - r);
      ch.light.alpha = 0.5 * (1 - r);
      if (r >= 1) { this.fire.stop(ch.em); this.give(ch.light); this.charge = null; }
    }
  }

  /** Motes streaming INTO a point from a ring round it (anticipation): `every` ms per mote. */
  private motesInto(x: number, y: number, r0: number, r1: number, every: number, acc: { moteIn: number }, dt: number, tint: number): void {
    if (!(this.look.motes > 0)) return;
    acc.moteIn -= dt;
    const S = this.S;
    while (acc.moteIn <= 0) {
      acc.moteIn += every / this.look.motes;
      const a = this.rnd() * Math.PI * 2, d = r0 + this.rnd() * (r1 - r0);
      const life = 200 + this.rnd() * 80;
      const sec = life / 1000;
      const sz = 3 + this.rnd() * 3;
      this.fxs('core', this.tex.spark, this.rnd() < 0.35 ? this.colors.core : tint, x + Math.cos(a) * d, y + Math.sin(a) * d, SPARK_R / S, {
        dur: life, from: sz, to: sz * 0.5, a0: 0.95, mode: 'punch', peakAt: 0.35, vx: (-Math.cos(a) * d * 0.92) / sec, vy: (-Math.sin(a) * d * 0.92) / sec,
        drag: 1, align: true, ease: 'linear', sy: 0.5,
      });
    }
  }

  private drawBolt(b: Bolt, dt: number): void {
    const { m } = b;
    const p = boltPose(m, this.clock);
    const g = Math.max(0, p.grow);
    const r = m.radius * g;
    const born = clamp01((this.clock - m.formAt) / Math.max(1, m.growMs * 0.5));
    if (b.state === 'form') {
      // Motes stream in while it swells (thicker for the great bolt).
      if (this.clock < m.pullAt) this.motesInto(m.home.x, m.home.y, m.radius * 2.2, m.radius * 3.4, m.great ? 14 : 26, b, dt, this.colors.fel);
    }
    // A wind-up shiver on the shell (it strains before the snap).
    const shiver = p.windup > 0 ? 1 + 0.08 * Math.sin(this.clock * 0.25) * p.windup : 1;
    this.drawOrb(b.orb, p.x, p.y, r * shiver, born, p.flying, p.rot, dt, this.look.crackle * (m.great ? 1.5 : 1));
    if (!b.formedFx && g >= 1 && !m.great) {
      b.formedFx = true;
      this.fire.embers(p.x, p.y, 4, r * 0.5, { speed: 160 });
    }
    // The sigil: spins open with an overshoot behind the forming bolt, pulses, and collapses in a flash on release.
    const sg = b.sigil;
    if (sg) {
      const R = m.radius * 2.3 * this.look.sigilSize;
      if (b.sigilGone < 0) {
        const u = clamp01((this.clock - m.formAt) / 240);
        sg.scale.set(Math.max(0.01, (R * easeOutBack(u, 1.6)) / RUNE_R));
        sg.rotation += dt * 0.003;
        sg.alpha = 0.85 * u * (0.88 + 0.12 * Math.sin(this.clock * 0.02 + m.phase)) * (1 + 0.15 * p.windup);
      } else {
        b.sigilGone += dt;
        const u = clamp01(b.sigilGone / 170);
        sg.scale.set(Math.max(0.01, (R * (1 - 0.65 * easeOutCubic(u))) / RUNE_R));
        sg.rotation += dt * 0.012;
        sg.alpha = 0.95 * (1 - u);
        if (u >= 1) { this.give(sg); b.sigil = null; }
      }
    }
  }

  private updateGate(dt: number): void {
    const g = this.gate;
    if (!g) return;
    g.age += dt;
    const R = g.gr;
    if (g.erupted < 0) {
      const open = clamp01(g.age / 300);
      const u = clamp01(g.age / g.dur);
      const s = Math.max(0.01, easeOutBack(open, 1.5));
      const pulse = 0.9 + 0.1 * Math.sin(g.age * (0.02 + 0.03 * u));
      g.outer.scale.set((R * s) / RUNE_R); g.outer.rotation += dt * 0.0012; g.outer.alpha = (0.75 + 0.25 * u) * open * pulse;
      g.inner.scale.set((R * 0.6 * s) / RUNE_R); g.inner.rotation -= dt * (0.002 + 0.004 * u); g.inner.alpha = (0.45 + 0.5 * u * u) * open;
      g.dark.scale.set((R * 1.35 * s) / GLOW_R); g.dark.alpha = 0.6 * open;
      g.light.scale.set((R * (1.2 + 0.5 * u)) / GLOW_R); g.light.alpha = (0.2 + 0.5 * u * u) * open * pulse;
      g.em.intensity = 0.15 + 1.1 * u * u;
      this.motesInto(g.x, g.y, R * 1.15, R * 1.6, 18 - 8 * u, g, dt, this.colors.fel);
    } else {
      // The circle FLARES and breaks: punched outward and faded, the inner ring flung wider, the ground fading back.
      g.erupted += dt;
      const u = clamp01(g.erupted / 650);
      const e = easeOutCubic(u);
      g.outer.scale.set((R * (1 + 0.35 * e)) / RUNE_R); g.outer.rotation += dt * 0.004; g.outer.alpha = 1.1 * (1 - u) * (1 - u);
      g.inner.scale.set((R * (0.6 + 0.9 * e)) / RUNE_R); g.inner.rotation -= dt * 0.008; g.inner.alpha = Math.max(0, 1 - u * 2.2);
      g.dark.alpha = 0.6 * (1 - u);
      g.light.alpha = 0.7 * (1 - u);
      if (u >= 1) {
        for (const s of [g.outer, g.inner, g.dark, g.light]) this.give(s);
        this.gate = null;
      }
    }
  }

  protected override tick(dt: number): boolean {
    if (this.destroyed) return false;
    const step = Math.max(0, Math.min(100, Number.isFinite(dt) ? dt : 0));
    this.clock += step;
    if (this.reserving) this.reserving = this.fire.reserveStep(120);
    this.updateCharge(step);
    for (const b of this.bolts) if (b.state !== 'gone') this.drawBolt(b, step);
    const mt = this.meteor;
    if (mt) {
      const p = felMeteorPose(mt.m, this.clock);
      const rot = Math.atan2(mt.m.dir.y, mt.m.dir.x);
      this.drawOrb(mt.orb, p.x, p.y, mt.m.radius, 1, true, rot, step, this.look.crackle * 1.6);
    }
    this.updateGate(step);
    for (let i = this.later.length - 1; i >= 0; i--) {
      const q = this.later[i]!;
      if (q.at <= this.clock) { this.later.splice(i, 1); this.layer(q); }
    }
    const sec = step / 1000;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]!;
      d.age += step;
      if (d.age >= d.life) { this.fire.stop(d.em); this.give(d.core); this.debris.splice(i, 1); continue; }
      d.vx *= Math.exp(-0.6 * sec);
      d.vy += 1900 * this.S * sec;
      d.x += d.vx * sec; d.y += d.vy * sec;
      const u = d.age / d.life;
      d.em.x = d.x; d.em.y = d.y; d.em.intensity = 1 - u * u;
      d.core.position.set(d.x, d.y); d.core.alpha = 1 - u * u;
    }
    for (let i = this.novas.length - 1; i >= 0; i--) {
      const n = this.novas[i]!;
      n.age += step;
      n.em.r = n.r0 + (n.r1 - n.r0) * easeOutCubic(n.age / n.dur);
      if (!n.em.on) this.novas.splice(i, 1);
    }
    const burning = this.fire.update(step);
    this.bolts = this.bolts.filter((b) => b.state !== 'gone' || b.sigil !== null);
    return burning || this.charge !== null || this.meteor !== null || this.gate !== null || this.later.length > 0 || this.debris.length > 0
      || this.bolts.length > 0;
  }

  protected override clearOwn(): void {
    for (const b of this.bolts) {
      if (b.state !== 'gone') this.dropOrb(b.orb);
      if (b.sigil) this.give(b.sigil);
    }
    if (this.charge) this.give(this.charge.light);
    if (this.meteor) this.dropOrb(this.meteor.orb);
    if (this.gate) for (const s of [this.gate.outer, this.gate.inner, this.gate.dark, this.gate.light]) this.give(s);
    for (const d of this.debris) this.give(d.core);
    this.fire.clear();
    this.bolts = []; this.novas = []; this.debris = []; this.later = [];
    this.charge = null; this.meteor = null; this.gate = null;
  }

  override destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.root.removeChild(this.fire.back);
    this.root.removeChild(this.fire.front);
    this.fire.destroy();
    super.destroy();
  }
}
