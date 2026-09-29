/**
 * THE FIRE SCENE: everything the Fire hero attack draws in Pixi, as a plain scene graph with no renderer, so it runs
 * (and is tested) headless. `heroFire.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * Design rule (owner 2026-09-29: fire "should look like live flame/fires pixi sprites"): EVERY flame is the shared live
 * particle fire (`../heroAttack/pixiFire.ts`), never a flame picture. Sprites here are only the light the fire casts
 * and the line work round it:
 *  - A FIREBALL is a fire emitter riding its pure motion (a roiling ball of flame puffs and tongues rising off it) over
 *    a white-hot heart and the soft orange light it throws. In flight its births are spread along the path it swept, so
 *    its comet tail of flame, smoke and embers is continuous and cools from yellow to red behind it.
 *  - A BURST is an explosion of fire particles thrown out against their drag (so the ball blooms, hangs, then rolls up
 *    and cools into smoke), a short white flash, a crisp shock ring and embers.
 *  - ABLAZE is a ring emitter on the struck portrait's UPPER rim (fire rises: never burning across the face) that burns
 *    for a beat and dies down, leaving smoke.
 *  - THE METEOR (IV) is a big emitter falling from above the screen onto a MARKED target (the ground under it glowing
 *    hotter, heat rings closing in, flames licking up round it); the DETONATION is layered: a white-hot core and flash,
 *    shockwaves, a FIRE NOVA (a ring emitter racing outward), a dome of fire, a fireball ROLLING UP into a mushroom of
 *    smoke a beat later, BURNING DEBRIS (ballistic embers each trailing its own fire), a pillar of fire ENGULFING the
 *    struck hero (a disc emitter with hard buoyancy) that burns out to embers, and a scorch left round it.
 *  - Tier III's last fireball FLARES the struck hero up (a gout of flame off the portrait) over its burning rim.
 *
 * LAYERS, bottom to top: ground (normal: the scorch, a dark pressure ring) | under (additive: the light fire casts) |
 * the fire's back (normal: smoke, the deep body) | fx (additive: rings, flashes) | the fire's front (additive: flame,
 * embers) | hot (additive: the fireballs' white-hot hearts).
 *
 * Contract: sprites are POOLED per layer (hidden and reused), bounded by `MAX_FIRE_SPRITES`; fire particles by
 * `MAX_FIRE_PARTICLES`; textures are the caller's and are pre-warmed at construction (a near-invisible sprite each,
 * while the damage formation plays, so no texture uploads on the first fireball); positions are the overlay's px;
 * `setCamera` mirrors the DOM camera; `update` returns whether anything still draws; `destroy()` leaves nothing behind.
 * Scatter is seeded (a replay burns the same fire). The scene's clock is the sequence's: it advances by every `update`.
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeInOutSine, easeOutCubic, easeOutQuint, mixColor, whiten, type Pt } from '../heroAttack/easing';
import { PixiFire, type FireEmitter, type FireTextures } from '../heroAttack/pixiFire';
import { fireballPose, meteorPose, type FireballMotion, type MeteorMotion } from './heroFireConfig';

export interface HeroFireTextures extends HeroArcanaTextures {
  fire: FireTextures;
  /** The meteor's scorch: a dark ragged burn ring, clear in the middle. */
  scorch: Texture;
  /** A thin shock ring (its line at `SHOCK_LINE_R` of 256 px): stays a line when scaled far up. */
  shock: Texture;
}

export interface FireColors { core: number; hot: number; flame: number; deep: number; ember: number; smoke: number; side: number }

export interface FireLook {
  /** How much fire catches round the caster's rim while it kindles. */
  kindle: number;
  /** Flame density of a fireball, and how bright its light is. */
  ballFlame: number; ballGlow: number;
  /** A fireball's comet tail: its flame density and its smoke. */
  trail: number; trailSmoke: number;
  /** The live fire's global dials. */
  turbulence: number; buoyancy: number; smoke: number; embers: number;
  explodeSize: number;
  blazeSize: number;
  novaSize: number; novaMs: number;
  engulfMs: number; burnoutMs: number;
  scorch: number;
}

/** Hard cap on the sprites (light, rings, flashes, hearts) alive at once. */
export const MAX_FIRE_SPRITES = 260;
/** Hard cap on live fire particles (a Tier IV detonation peaks near it; the pool never grows past it). */
export const MAX_FIRE_PARTICLES = 1100;

type LayerId = 'ground' | 'under' | 'fx' | 'hot';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [['ground', 'normal'], ['under', 'add'], ['fx', 'add'], ['hot', 'add']];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
/** Radius (px) a sprite of scale 1 covers: the soft glows and the fire glow (128 px), the ring (its line at 64 px). */
const GLOW_R = 64, RING_R = 115, SCORCH_R = 102, PUFF_R = 32;
/** The upper arc a burning rim burns on (fire rises: from about 8 o'clock over the top to 4 o'clock). */
const UP = -Math.PI / 2, UP_HALF = Math.PI * 0.62;

type AlphaMode = 'out' | 'punch' | 'hold';
interface Fx { s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number; delay: number }

interface Ball {
  m: FireballMotion;
  /** The ball itself (a dense head riding with it) and its comet tail (spread along the path it sweeps). */
  em: FireEmitter; tail: FireEmitter; core: Sprite; halo: Sprite;
  state: 'form' | 'fly' | 'gone';
  lastX: number; lastY: number; formedFx: boolean;
}

interface Charge { em: FireEmitter; light: Sprite; x: number; y: number; r: number; age: number; dur: number; left: number; releasing: number }

interface Meteor { m: MeteorMotion; em: FireEmitter; core: Sprite; halo: Sprite; ground: Sprite; R: number; lastX: number; lastY: number }

interface Nova { em: FireEmitter; age: number; dur: number; r0: number; r1: number }

/** A piece of burning debris flung out of the detonation: a ballistic ember trailing its own small fire. */
interface Debris { em: FireEmitter; core: Sprite; x: number; y: number; vx: number; vy: number; age: number; life: number }

/** A layer of the detonation that lands a beat later (the fireball rolling up, the mushroom cap), in scene ms. */
interface Later { at: number; kind: 'billow' | 'cap'; x: number; y: number; R: number }

/** Tier IV: the struck hero MARKED while the meteor comes (the ground heating, flames licking up round it). */
interface Mark { em: FireEmitter; glow: Sprite; R: number; age: number; dur: number }

export class HeroFireScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private readonly fire: PixiFire;
  private used = 0;
  private clock = 0;
  private balls: Ball[] = [];
  private fx: Fx[] = [];
  private charge: Charge | null = null;
  private meteor: Meteor | null = null;
  private novas: Nova[] = [];
  private debris: Debris[] = [];
  private later: Later[] = [];
  private mark: Mark | null = null;
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private destroyed = false;
  private readonly S: number;

  constructor(private readonly tex: HeroFireTextures, private readonly colors: FireColors, private readonly look: FireLook, scale = 1, seed = 1) {
    this.S = scale;
    this.root.eventMode = 'none';
    this.root.label = 'heroFire';
    this.layers = {} as Record<LayerId, Container>;
    this.freeSprites = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `fire-${id}`;
      this.layers[id] = c;
      this.freeSprites[id] = [];
    }
    this.fire = new PixiFire(tex.fire, {
      cap: MAX_FIRE_PARTICLES, scale, seed: seed * 17 + 3,
      palette: { core: colors.core, hot: colors.hot, mid: colors.flame, deep: colors.deep, dark: colors.ember, smoke: colors.smoke },
      smoke: look.smoke, embers: look.embers, turb: look.turbulence, lift: look.buoyancy,
    });
    const L = this.layers;
    this.root.addChild(L.ground, L.under, this.fire.back, L.fx, this.fire.front, L.hot);
    // PRE-WARM: one near-invisible sprite per texture for the first few hundred ms (the damage formation is still
    // playing), so every texture is on the GPU long before the first fireball needs it (no first-play spike).
    const f = tex.fire;
    for (const w of [tex.glow, tex.spark, tex.shock, tex.star, tex.scorch, ...f.puffs, f.tongue, f.smoke, f.ember, f.glow]) {
      const s = this.take('hot', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
    // The fire's sprite pool is built a slice a frame while the formation plays (no burst of creation at the detonation).
    this.fire.planReserve();
    this.reserving = true;
  }

  private reserving = false;

  get liveSprites(): number { return this.used - this.warm.length + this.fire.count; }
  get liveFire(): number { return this.fire.count; }
  get liveBalls(): number { return this.balls.filter((b) => b.state !== 'gone').length; }
  get charging(): boolean { return this.charge !== null; }
  get meteorLive(): boolean { return this.meteor !== null; }
  get marked(): boolean { return this.mark !== null; }
  get liveDebris(): number { return this.debris.length; }
  /** Fire emitters burning right now (the kindling, the fireballs, the blaze, the meteor, the nova, the engulf). */
  get emitters(): number { return this.fire.emitting; }
  get time(): number { return this.clock; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) for (const ch of this.layers[id].children) if (ch instanceof Sprite) n++; return n; }
  get pooledFire(): number { return this.fire.pooled; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_FIRE_SPRITES) return null;
    let s = this.freeSprites[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(s: Sprite | null): void {
    if (!s) return;
    const layer = (s.parent?.label?.replace('fire-', '') ?? 'hot') as LayerId;
    s.visible = false;
    (this.freeSprites[layer] ?? this.freeSprites.hot).push(s);
    this.used--;
  }

  /** A one-shot sprite: scale `from` -> `to` (radii in px, converted by `unit`), fading by `mode`. */
  private fxs(layer: LayerId, t: Texture, tint: number, x: number, y: number, unit: number, o: Partial<Omit<Fx, 's' | 'age'>> & { dur: number; from: number; to: number; a0: number }): Sprite | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.25, delay: 0, ...o, from: o.from / unit, to: o.to / unit };
    s.position.set(x, y);
    s.scale.set(f.from);
    s.alpha = f.mode === 'punch' || f.delay > 0 ? 0 : f.a0;
    this.fx.push(f);
    return s;
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The hero kindles: fire catches round its upper rim and grows over `durMs` while the fireballs ignite, and its light
   * spreads under it. Released as the LAST fireball leaves.
   */
  startCharge(x: number, y: number, R: number, durMs: number, launches: number): void {
    if (this.destroyed || this.charge) return;
    const light = this.take('under', this.tex.fire.glow, this.colors.flame);
    if (!light) return;
    light.position.set(x, y); light.alpha = 0; light.scale.set((R * 2.4) / GLOW_R);
    const em = this.fire.emitter({
      shape: 'ring', x, y, r: R * 0.95, a0: UP - UP_HALF, a1: UP + UP_HALF, rate: 380 * this.look.kindle, size: R * 0.55, life: 540,
      lift: 820, speed: 30, out: 45, heat: 0.95, turb: 280, tongues: 0.22, body: 0.35, smoke: 0.06, embers: 8,
    });
    em.intensity = 0;
    this.charge = { em, light, x, y, r: R, age: 0, dur: Math.max(1, durMs), left: Math.max(1, launches), releasing: -1 };
  }

  /**
   * A fireball ignites (it burns along its pure motion from here on). `tailK` thins the comet tail when many fly at once
   * (a volley shares the particle cap).
   */
  grow(m: FireballMotion, tailK = 1): void {
    if (this.destroyed) return;
    const core = this.take('hot', this.tex.fire.puffs[0]!, this.colors.core);
    const halo = this.take('under', this.tex.fire.glow, this.colors.flame);
    if (!core || !halo) { this.give(core); this.give(halo); return; }
    core.alpha = 0; halo.alpha = 0;
    const em = this.fire.emitter({
      shape: 'point', x: m.home.x, y: m.home.y, r: m.radius * 0.45, rate: 260 * this.look.ballFlame, size: m.radius * 1.5, life: 340,
      lift: 620, speed: 50, heat: 1, turb: 240, tongues: 0.25, body: 0.35, smoke: 0.05, embers: 8, sweep: false,
    });
    em.intensity = 0;
    const tail = this.fire.emitter({
      shape: 'point', x: m.home.x, y: m.home.y, r: m.radius * 0.4, rate: 620 * tailK * this.look.ballFlame * this.look.trail, size: m.radius * 1.45,
      life: 400, lift: 260, speed: 40, heat: 0.9, turb: 220, tongues: 0.12, body: 0.3, smoke: 0.16 * this.look.trailSmoke, embers: 30,
    });
    tail.intensity = 0;
    this.balls.push({ m, em, tail, core, halo, state: 'form', lastX: m.home.x, lastY: m.home.y, formedFx: false });
    // A spark where it catches.
    this.fxs('hot', this.tex.glow, this.colors.core, m.home.x, m.home.y, GLOW_R, { dur: 200, from: m.radius * 0.3, to: m.radius * 1.2, a0: 0.8, mode: 'punch', peakAt: 0.3 });
  }

  /** A fireball is hurled: a puff of fire kicked back off it, a ring, and it flies. */
  fireBall(m: FireballMotion): void {
    const ch = this.charge;
    if (ch && ch.releasing < 0 && --ch.left <= 0) ch.releasing = 0;
    const b = this.balls.find((x) => x.m === m && x.state === 'form');
    if (!b) return;
    b.state = 'fly';
    const back = Math.atan2(m.from.y - m.to.y, m.from.x - m.to.x);
    this.fire.burst(m.from.x, m.from.y, { n: 8, radius: m.radius * 0.4, speed: 260, size: m.radius * 0.9, life: 360, dir: back, spread: 1.6, drag: 4, smoke: 0.2 });
    this.fxs('fx', this.tex.shock, this.colors.hot, m.from.x, m.from.y, RING_R, { dur: 180, from: m.radius * 0.4, to: m.radius * 1.3, a0: 0.3 });
  }

  /**
   * A fireball (or anything of fire) EXPLODES at (x, y): a short flash, the light it throws, a crisp shock ring, a ball
   * of fire blooming out against its drag and rolling up into smoke, a spray carried on along the blow, embers.
   * `big` is THE impact (bigger, a second ring).
   */
  explode(x: number, y: number, R: number, o: { size: number; big: boolean; dir: Pt; flashAlpha: number; embers: number }): void {
    if (this.destroyed) return;
    const L = this.look;
    const sz = o.size * L.explodeSize;
    const big = o.big;
    this.fxs('hot', this.tex.glow, this.colors.core, x, y, GLOW_R, { dur: big ? 130 : 90, from: R * 0.5 * sz, to: R * (big ? 1.3 : 0.9) * sz, a0: o.flashAlpha * (big ? 0.85 : 0.6) });
    this.fxs('under', this.tex.fire.glow, this.colors.flame, x, y, GLOW_R, { dur: big ? 700 : 480, from: R * 1.4 * sz, to: R * 2.6 * sz, a0: big ? 0.7 : 0.5 });
    // A faint, quick heat ring on the big one only (the fire is the star; a ring scaled far up turns into a thick band).
    if (big) this.fxs('fx', this.tex.shock, this.colors.hot, x, y, RING_R, { dur: 220, from: R * 0.4, to: R * 1.2, a0: 0.22 });
    this.fire.burst(x, y, {
      n: (big ? 44 : 18) * sz, radius: R * 0.28 * sz, speed: (big ? 560 : 400) * sz, size: R * (big ? 0.64 : 0.5) * sz, life: big ? 640 : 480,
      lift: 820, drag: 3.2, heat: 1, tongues: 0.12, body: 0.45, smoke: big ? 0.45 : 0.3, embers: o.embers, emberSpeed: big ? 520 : 380,
    });
    // Flame carried on through along the blow.
    this.fire.burst(x, y, { n: (big ? 14 : 7) * sz, radius: R * 0.2, speed: 760 * sz, size: R * 0.42 * sz, life: 380, dir: Math.atan2(o.dir.y, o.dir.x), spread: 1.3, drag: 4.5, smoke: 0.15 });
    this.fire.smokePuffs(x, y - R * 0.3, big ? 4 : 2, { radius: R * 0.5, size: R * 1.1 * sz, life: 1400, rise: 60, alpha: 0.32 });
  }

  /** The struck portrait's UPPER rim catches fire: it burns at `amount` for `holdMs`, then dies down to smoke. */
  ablaze(x: number, y: number, R: number, amount: number, holdMs: number): void {
    if (this.destroyed || !(amount > 0)) return;
    const k = this.look.blazeSize;
    this.fire.emitter({
      shape: 'ring', x, y, r: R * 0.95 * k, a0: UP - UP_HALF * 1.05, a1: UP + UP_HALF * 1.05, rate: 170 * amount, size: R * 0.42 * k,
      life: 540, lift: 860, speed: 40, out: 50, heat: 0.95, turb: 300, tongues: 0.45, body: 0.35, smoke: 0.25, embers: 12 * amount,
    }, { hold: holdMs, fade: 700 });
    this.fxs('under', this.tex.fire.glow, this.colors.flame, x, y, GLOW_R, { dur: holdMs + 700, from: R * 2, to: R * 2.2, a0: Math.min(0.5, 0.3 * amount), mode: 'hold' });
  }

  /**
   * THE SUMMON (Tier IV): the hero hurls a column of fire into the sky, a jet of flame roaring up off the top of the
   * portrait for `durMs`, a flare and a ring.
   */
  summon(x: number, y: number, R: number, durMs: number): void {
    if (this.destroyed) return;
    const ch = this.charge;
    if (ch && ch.releasing < 0) ch.releasing = 0;
    this.fire.emitter({
      shape: 'point', x, y: y - R * 0.9, r: R * 0.4, rate: 600, size: R * 1.0, life: 480, lift: 400, vy: -1500, speed: 120,
      drag: 0.4, heat: 0.85, turb: 180, tongues: 0.18, body: 0.3, smoke: 0.12, embers: 30, emberSpeed: 500,
    }, { hold: durMs * 0.6, fade: durMs * 0.4 });
    this.fire.burst(x, y - R * 0.5, { n: 26, radius: R * 0.9, rim: true, speed: 420, size: R * 0.5, life: 460, lift: 900, drag: 3.5, dir: UP, spread: 2.4, smoke: 0.15 });
    this.fxs('hot', this.tex.glow, this.colors.core, x, y - R * 0.6, GLOW_R, { dur: 180, from: R * 0.8, to: R * 1.8, a0: 0.7 });
    this.fxs('fx', this.tex.shock, this.colors.hot, x, y, RING_R, { dur: 360, from: R * 1.05, to: R * 2.4, a0: 0.5 });
    this.fxs('under', this.tex.fire.glow, this.colors.flame, x, y, GLOW_R, { dur: durMs + 300, from: R * 2.2, to: R * 2.8, a0: 0.55, mode: 'hold' });
  }

  /**
   * The struck hero FLARES UP (Tier III's last fireball, owner 2026-09-29: "make the 3rd fire tier a bit better"): a gout
   * of flame roars up off the whole portrait for a moment, over the blaze on its rim.
   */
  flareUp(x: number, y: number, R: number, amount: number): void {
    if (this.destroyed || !(amount > 0)) return;
    this.fire.emitter({
      shape: 'disc', x, y, r: R * 0.8, rate: 420 * amount, size: R * 0.8, life: 640, lift: 1500, speed: 50, heat: 1, turb: 320,
      tongues: 0.3, body: 0.4, smoke: 0.3, embers: 24 * amount, emberSpeed: 300,
    }, { hold: 160, fade: 520 });
    this.fire.burst(x, y - R * 0.3, { n: 28 * amount, radius: R * 0.6, speed: 320, size: R * 0.7, life: 620, lift: 1300, dir: UP, spread: 1.6, drag: 2, tongues: 0.2, smoke: 0.3 });
  }

  /**
   * Tier IV: the struck hero is MARKED for `durMs` while the meteor comes (owner 2026-09-29: "slightly slower build up"):
   * the ground under it glows hotter and hotter, heat rings close in on it, and flames lick up round it, growing as the
   * meteor nears.
   */
  markTarget(x: number, y: number, R: number, durMs: number): void {
    if (this.destroyed || this.mark) return;
    const glow = this.take('under', this.tex.fire.glow, this.colors.flame);
    if (!glow) return;
    glow.position.set(x, y); glow.alpha = 0;
    const em = this.fire.emitter({
      shape: 'ring', x, y, r: R * 1.12, rate: 260, size: R * 0.42, life: 440, lift: 950, speed: 30, out: 20, heat: 0.9, turb: 300,
      tongues: 0.25, body: 0.3, smoke: 0.15, embers: 16, emberSpeed: 160,
    });
    em.intensity = 0.1;
    this.mark = { em, glow, R, age: 0, dur: Math.max(1, durMs) };
    for (let i = 0; i < 3; i++) {
      this.fxs('fx', this.tex.shock, this.colors.hot, x, y, RING_R, {
        dur: 420, delay: durMs * (0.2 + 0.25 * i), from: R * 3.4, to: R * 1.15, a0: 0.45 + 0.15 * i, mode: 'punch', peakAt: 0.55,
      });
    }
  }

  /** The meteor starts its fall: a huge emitter with a white-hot heart and its light, and the ground under the target. */
  startMeteor(m: MeteorMotion, R: number): void {
    if (this.destroyed || this.meteor) return;
    const core = this.take('hot', this.tex.fire.puffs[0]!, mixColor(this.colors.core, this.colors.hot, 0.3));
    const halo = this.take('under', this.tex.fire.glow, this.colors.flame);
    const ground = this.take('under', this.tex.fire.glow, this.colors.flame);
    if (!core || !halo || !ground) { this.give(core); this.give(halo); this.give(ground); return; }
    core.alpha = 0; halo.alpha = 0; ground.alpha = 0;
    ground.position.set(m.to.x, m.to.y);
    const em = this.fire.emitter({
      shape: 'point', x: m.from.x, y: m.from.y, r: m.radius * 0.45, rate: 420 * this.look.trail, size: m.radius * 1.3, life: 420, lift: 300,
      speed: 60, heat: 0.9, turb: 200, tongues: 0.35, body: 0.3, smoke: 0.3 * this.look.trailSmoke, embers: 50, emberSpeed: 260,
    });
    this.meteor = { m, em, core, halo, ground, R, lastX: m.from.x, lastY: m.from.y };
  }

  /**
   * THE DETONATION (Tier IV, the consequence frame, no freeze): a white flash, shockwaves (and a dark pressure ring for
   * contrast), a FIRE NOVA racing outward, a dome of fire, a pillar of fire ENGULFING the struck hero that burns out to
   * embers and smoke, and a scorch left round it.
   */
  detonate(x: number, y: number, R: number, o: { burst: number; flashAlpha: number; embers: number; screen: number }): void {
    if (this.destroyed) return;
    const mt = this.meteor;
    if (mt) {
      this.fire.stop(mt.em);
      this.give(mt.core); this.give(mt.halo); this.give(mt.ground);
      this.meteor = null;
    }
    const mk = this.mark;
    if (mk) { this.fire.stop(mk.em); this.give(mk.glow); this.mark = null; }
    const L = this.look;
    const b = Math.max(0.5, o.burst);
    // THE WHITE-HOT CORE: a hard white heart, then the hot flash round it.
    this.fxs('hot', this.tex.glow, 0xffffff, x, y, GLOW_R, { dur: 110, from: R * 0.8, to: R * 1.9, a0: 1 });
    this.fxs('hot', this.tex.glow, this.colors.core, x, y, GLOW_R, { dur: 170, from: R * 1.6, to: R * 2.6 * b, a0: o.flashAlpha });
    this.fxs('hot', this.tex.glow, whiten(this.colors.hot, 0.5), x, y, GLOW_R, { dur: 140, from: o.screen * 0.5, to: o.screen * 0.7, a0: 0.28 * o.flashAlpha });
    this.fxs('under', this.tex.fire.glow, this.colors.flame, x, y, GLOW_R, { dur: 1400, from: R * 3, to: R * 5, a0: 0.75 });
    this.fxs('fx', this.tex.shock, whiten(this.colors.hot, 0.5), x, y, RING_R, { dur: 560, from: R * 0.8, to: R * 6.5, a0: 1 });
    this.fxs('fx', this.tex.shock, this.colors.flame, x, y, RING_R, { dur: 720, delay: 70, from: R * 0.6, to: R * 4.8, a0: 0.75 });
    this.fxs('ground', this.tex.shock, mixColor(this.colors.ember, 0x000000, 0.4), x, y, RING_R, { dur: 640, delay: 30, from: R, to: R * 5.8, a0: 0.5 });
    if (L.scorch > 0) {
      this.fxs('ground', this.tex.scorch, mixColor(this.colors.smoke, 0x000000, 0.45), x, y, SCORCH_R, { dur: 2800, from: R * 2.2 * L.scorch, to: R * 2.6 * L.scorch, a0: 0.85, mode: 'hold' });
    }
    // THE FIRE NOVA: a ring of fire thrown outward, its birth ring racing out with it.
    const nova = this.fire.emitter({
      shape: 'ring', x, y, r: R * 0.6, rate: 1000, size: R * 0.9, life: 480, lift: 500, out: 650, speed: 80, heat: 1, turb: 260,
      tongues: 0.1, body: 0.25, smoke: 0.18, drag: 2.2,
    }, { hold: L.novaMs, fade: 160 });
    this.novas.push({ em: nova, age: 0, dur: Math.max(1, L.novaMs), r0: R * 0.6, r1: R * L.novaSize });
    // The dome: a ball of fire blooming out of the blast and rolling up.
    this.fire.burst(x, y, {
      n: 110, radius: R * 0.5, speed: 900, size: R * 0.8, life: 720, lift: 900, drag: 3.6, heat: 0.9, tongues: 0.2, body: 0.45, smoke: 0.45,
      embers: o.embers, emberSpeed: 720,
    });
    // ENGULFED: a pillar of fire on the struck hero, burning, then dying down to embers and smoke.
    this.fire.emitter({
      shape: 'disc', x, y, r: R * 0.95, rate: 440, size: R * 0.95, life: 820, lift: 1400, speed: 60, heat: 1, turb: 340,
      tongues: 0.35, body: 0.4, smoke: 0.35, embers: 30, emberSpeed: 320,
    }, { hold: L.engulfMs, fade: L.burnoutMs });
    this.fire.smokePuffs(x, y - R * 0.6, 6, { radius: R * 0.8, size: R * 1.8, life: 2200, rise: 90, alpha: 0.4 });
    // A beat later the fireball ROLLS UP off the blast, then billows into a mushroom of smoke.
    this.later.push({ at: this.clock + 110, kind: 'billow', x, y: y - R * 0.7, R }, { at: this.clock + 300, kind: 'cap', x, y: y - R * 2.1, R });
    // BURNING DEBRIS flung out on arcs, each trailing its own fire, falling back.
    const S = this.S;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = UP + (i / (n - 1) - 0.5) * 2.7 + Math.sin(i * 12.9898) * 0.15;
      const sp = (650 + (350 * ((i * 7) % 5)) / 4) * S;
      const core = this.take('hot', this.tex.fire.ember, this.colors.hot);
      if (!core) break;
      core.scale.set((R * 0.2) / 8);
      const em = this.fire.emitter({
        shape: 'point', x, y, r: R * 0.08, rate: 120, size: R * 0.3, life: 320, lift: 240, speed: 20, heat: 0.95, turb: 200,
        tongues: 0.1, body: 0.2, smoke: 0.3,
      });
      this.debris.push({ em, core, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, life: 700 + 60 * (i % 5) });
    }
  }

  /** The detonation's later layers. */
  private layer(q: Later): void {
    const { x, y, R } = q;
    if (q.kind === 'billow') {
      // The fireball rolling up out of the blast: big, slow, buoyant, turning to smoke as it climbs.
      this.fire.burst(x, y, {
        n: 36, radius: R * 0.6, speed: 260, size: R * 1.3, life: 900, lift: 1700, dir: UP, spread: 1.4, drag: 1.4, heat: 0.65,
        tongues: 0.08, body: 0.6, smoke: 0.85,
      });
    } else {
      // The mushroom cap: spreading wide as it tops out, cooler, mostly smoke by the end.
      this.fire.burst(x, y, {
        n: 30, radius: R * 0.9, speed: 380, size: R * 1.15, life: 800, lift: 900, dir: UP, spread: 3, drag: 2.4, heat: 0.55,
        tongues: 0.05, body: 0.45, smoke: 0.95,
      });
      this.fire.smokePuffs(x, y - R * 0.2, 8, { radius: R * 1.2, size: R * 2.2, life: 2600, rise: 110, alpha: 0.45 });
    }
  }

  /** An aftershock: a small fire burst round the blast. */
  boom(x: number, y: number, R: number, size: number): void {
    if (this.destroyed) return;
    this.fxs('fx', this.tex.shock, this.colors.hot, x, y, RING_R, { dur: 260, from: R * 0.2, to: R * 0.9 * size, a0: 0.6 });
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
      ch.light.alpha = 0.45 * easeInOutSine(u) * (0.9 + 0.1 * Math.sin(ch.age * 0.03));
    } else {
      ch.releasing += dt;
      const r = clamp01(ch.releasing / 380);
      ch.em.intensity = 1.2 * (1 - r);
      ch.light.alpha = 0.45 * (1 - r);
      if (r >= 1) { this.fire.stop(ch.em); this.give(ch.light); this.charge = null; }
    }
  }

  /** A fireball: its emitter, heart and light on the pure pose; in flight the tail is spread along the swept path. */
  private drawBall(b: Ball, dt: number): void {
    const { m, em, tail } = b;
    const L = this.look;
    const S = this.S;
    const p = fireballPose(m, this.clock);
    const g = Math.max(0, p.grow);
    const r = m.radius * g;
    const born = clamp01((this.clock - m.formAt) / Math.max(1, m.growMs * 0.6));
    em.x = p.x; em.y = p.y; em.r = Math.max(1, r * 0.45); em.size = Math.max(1, r * 1.5);
    em.intensity = born * Math.min(1.1, g);
    tail.x = p.x; tail.y = p.y;
    if (p.flying) {
      // In flight the HEAD rides with the ball (born at 90 % of its speed, short-lived: a dense roiling ball at the
      // front), and the comet TAIL streams behind it (spread along the path it swept, less buoyant, smoky).
      const vx = dt > 0 ? (p.x - b.lastX) / dt : 0, vy = dt > 0 ? (p.y - b.lastY) / dt : 0; // px per ms
      em.vx = (vx * 1000 * 0.9) / S; em.vy = (vy * 1000 * 0.9) / S; em.life = 170; em.lift = 120; em.rate = 420 * L.ballFlame; em.smoke = 0;
      tail.vx = (vx * 1000 * 0.12) / S; tail.vy = (vy * 1000 * 0.12) / S;
      tail.intensity = 1;
      tail.size = Math.max(1, r * 1.45);
    } else {
      tail.lx = p.x; tail.ly = p.y;
    }
    const flick = 0.9 + 0.1 * Math.sin(this.clock * 0.05 + m.phase) + 0.05 * Math.sin(this.clock * 0.13);
    b.core.position.set(p.x, p.y);
    b.core.rotation = p.rot;
    const cs = (r * 0.7 * flick) / PUFF_R;
    b.core.scale.set(cs * (p.flying ? 1.4 : 1), cs);
    b.core.alpha = 0.95 * born;
    b.halo.position.set(p.x, p.y);
    b.halo.scale.set((r * 3.4) / GLOW_R);
    b.halo.alpha = 0.5 * L.ballGlow * born * flick;
    if (!b.formedFx && g >= 1) {
      b.formedFx = true;
      this.fire.embers(p.x, p.y, 4, r * 0.5, { speed: 160 });
    }
    b.lastX = p.x; b.lastY = p.y;
  }

  /** Put a fireball out (it has landed): its tail burns out on its own. */
  land(m: FireballMotion): void {
    const b = this.balls.find((x) => x.m === m && x.state !== 'gone');
    if (!b) return;
    this.fire.stop(b.em); this.fire.stop(b.tail);
    this.give(b.core); this.give(b.halo);
    b.state = 'gone';
  }

  private drawMeteor(dt: number): void {
    const mt = this.meteor;
    if (!mt) return;
    const { m, em } = mt;
    const p = meteorPose(m, this.clock);
    const vx = dt > 0 ? (p.x - mt.lastX) / dt : 0, vy = dt > 0 ? (p.y - mt.lastY) / dt : 0;
    em.x = p.x; em.y = p.y;
    em.vx = (vx * 1000 * 0.18) / this.S; em.vy = (vy * 1000 * 0.18) / this.S;
    const flick = 0.9 + 0.1 * Math.sin(this.clock * 0.06);
    const r = m.radius;
    mt.core.position.set(p.x, p.y);
    mt.core.rotation = Math.atan2(m.dir.y, m.dir.x);
    mt.core.scale.set((r * 1.15 * flick) / PUFF_R, (r * 0.85 * flick) / PUFF_R);
    mt.core.alpha = 0.8;
    mt.halo.position.set(p.x, p.y);
    mt.halo.scale.set((r * 3.6) / GLOW_R);
    mt.halo.alpha = 0.6 * flick;
    // The ground under the target glows hotter as it nears (anticipation).
    mt.ground.scale.set((mt.R * (2.2 + 1.2 * p.u)) / GLOW_R);
    mt.ground.alpha = 0.7 * p.u * p.u * flick;
    mt.lastX = p.x; mt.lastY = p.y;
  }

  /** Advance everything by `dt` ms. Returns whether anything still draws. */
  update(dt: number): boolean {
    if (this.destroyed) return false;
    const step = Math.max(0, Math.min(100, Number.isFinite(dt) ? dt : 0));
    this.clock += step;
    if (this.warm.length) {
      this.warmLeft -= Math.max(step, 16);
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; }
    }
    if (this.reserving) this.reserving = this.fire.reserveStep(120);
    this.updateCharge(step);
    for (const b of this.balls) if (b.state !== 'gone') this.drawBall(b, step);
    this.drawMeteor(step);
    const mk = this.mark;
    if (mk) {
      mk.age += step;
      const u = clamp01(mk.age / mk.dur);
      mk.em.intensity = 0.1 + 1.1 * u * u;
      mk.glow.alpha = (0.12 + 0.6 * u * u) * (0.92 + 0.08 * Math.sin(mk.age * 0.04));
      mk.glow.scale.set((mk.R * (1.8 + 1.6 * u)) / GLOW_R);
    }
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
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= step; if (q.delay > 0) continue; }
      q.age += step;
      const u = clamp01(q.age / q.dur);
      q.s.scale.set(q.from + (q.to - q.from) * easeOutQuint(u));
      q.s.alpha = q.mode === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.mode === 'hold' ? q.a0 * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4)
          : q.a0 * (1 - u) * (1 - u * 0.3);
      if (u >= 1) { this.give(q.s); this.fx.splice(i, 1); }
    }
    const burning = this.fire.update(step);
    this.balls = this.balls.filter((b) => b.state !== 'gone');
    return burning || this.used > this.warm.length || this.charge !== null || this.meteor !== null || this.later.length > 0 || this.debris.length > 0;
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const b of this.balls) if (b.state !== 'gone') { this.give(b.core); this.give(b.halo); b.state = 'gone'; }
    for (const q of this.fx) this.give(q.s);
    for (const s of this.warm) this.give(s);
    if (this.charge) this.give(this.charge.light);
    if (this.meteor) { this.give(this.meteor.core); this.give(this.meteor.halo); this.give(this.meteor.ground); }
    if (this.mark) this.give(this.mark.glow);
    for (const d of this.debris) this.give(d.core);
    this.fire.clear();
    this.balls = []; this.fx = []; this.warm = []; this.novas = []; this.debris = []; this.later = []; this.mark = null;
    this.charge = null; this.meteor = null;
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.fire.destroy();
    for (const [id] of LAYERS) {
      this.freeSprites[id].length = 0;
      this.layers[id].removeChildren().forEach((ch) => ch.destroy());
    }
    this.root.removeChildren().forEach((ch) => ch.destroy());
    this.root.destroy();
  }
}
