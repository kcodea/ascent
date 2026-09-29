/**
 * THE BANANA CANNON SCENE: everything the Banana Cannon hero attack draws in Pixi, as a plain scene graph with no
 * renderer, so it runs (and is tested) headless. `heroBanana.ts` mounts `root` on the above-portrait overlay and feeds
 * `update(dt)`.
 *
 * Design rule (the owner's Arcana bar: "clean", one readable hero element, never particle soup): the CANNON and the
 * BANANA are the subjects. The cannon is FOUR sprites on ONE transform (a golden glow, the green barrel, the gold trim,
 * the dark details), so it recoils, pumps, swells and turns as one solid object; a banana is four (a glow, the tinted
 * body, its brown ends in their own colours, an additive shine) plus a short motion streak. Smoke, leaves, chunks and
 * sparkles are seasoning, and short. The comic impact STAR is two sprites (a dark outline behind a bright fill), so it
 * reads on any board.
 *
 * STUCK PEELS ride the struck portrait: the runner reports the portrait's knockback each frame (`setFoeOffset`) and
 * every peel, the mush, the star and the target ring move with it, so nothing floats off a portrait that was knocked
 * back.
 *
 * LAYERS, bottom to top: haze (normal: smoke, mush, the golden shockwave band, the flat shadow under the giant) | glow
 * (additive: glows, rings, rays, streaks) | body (NORMAL: the barrel, bananas, peels, chunks, leaves) | trim (NORMAL: the
 * cannon's gold trim, the star's outline) | ink (NORMAL: the cannon's dark details, the banana ends, the star's fill) |
 * core (additive: flashes, shines, sparkles, the crown glint). Sprites are pooled per layer, so a reused sprite can sit
 * anywhere in its layer's draw order: every multi-sprite object puts each part on its OWN layer, which fixes the order
 * (the trim always over the barrel, the star's fill always over its outline). Six batched runs.
 *
 * Contract: sprites are POOLED per layer (hidden and reused) and bounded by `MAX_BANANA_SPRITES`; textures are the
 * caller's (pre-warmed on the GPU during the damage formation, so no first-play spike); positions are the overlay's px;
 * `setCamera` mirrors the DOM camera; `update` returns whether anything still draws; `destroy()` leaves nothing behind.
 * Scatter is seeded (a replay throws the same chunks).
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeInBack, easeInOutSine, easeOutBack, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';
import { bananaPos, type BananaMotion } from './heroBananaConfig';
import { BANANA_W, CANNON_AXIS_Y, CANNON_H, CANNON_MOUTH_X, CANNON_PIVOT_X, CANNON_W, CROWN_X, CROWN_Y } from './heroBananaTextures';

export interface HeroBananaTextures extends HeroArcanaTextures {
  cannonBarrel: Texture;
  cannonTrim: Texture;
  cannonDark: Texture;
  cannonGlow: Texture;
  bananaBody: Texture;
  bananaEnds: Texture;
  bananaShine: Texture;
  bananaGlow: Texture;
  /** A splayed peel. */
  peel: Texture;
  /** A banana slice. */
  chunk: Texture;
  /** The comic impact star. */
  impactStar: Texture;
  /** A banana mush splat. */
  mush: Texture;
  /** A jungle leaf, +X aligned. */
  leaf: Texture;
  /** A smoke billow. */
  puff: Texture;
  /** A soft-edged solid disc. */
  disc: Texture;
  /** A thick shockwave ring. */
  shock: Texture;
}

export interface BananaColors { banana: number; gold: number; barrel: number; dark: number; cream: number; smoke: number; leaf: number; side: number }

export interface BananaLook {
  /** Cannon length, px at stage scale 1. */
  cannonLength: number;
  /** The cannon popping in (ms). */
  popMs: number;
  /** How far the cannon kicks back on a shot (px at stage scale 1). */
  recoil: number;
  /** Smoke puffs per muzzle blast. */
  puffs: number;
  /** Leaves per muzzle blast. */
  leaves: number;
  /** Banana length, px at stage scale 1. */
  bananaLength: number;
  /** The motion streak behind a flying banana (peak opacity). */
  trailAlpha: number;
  /** Chunks per tick. */
  tickChunks: number;
  /** The comic star's size. */
  starSize: number;
  /** How long a stuck peel hangs on the face before it slides off (ms). */
  peelHoldMs: number;
  /** Chunk gravity (px/s^2 at stage scale 1). */
  gravity: number;
  /** Tier IV: whole bananas in the shower. */
  showerBananas: number;
  /** Tier IV: the golden shockwave's size. */
  shockSize: number;
  /** Tier IV: golden rays out of the slam. */
  goldRays: number;
}

/** Hard cap on sprites alive at once (a Tier IV slam peaks around 230). */
export const MAX_BANANA_SPRITES = 600;

type LayerId = 'haze' | 'glow' | 'body' | 'trim' | 'ink' | 'core';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [['haze', 'normal'], ['glow', 'add'], ['body', 'normal'], ['trim', 'normal'], ['ink', 'normal'], ['core', 'add']];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
const GLOW_PX = 128;
const RING_PX = 128;
const SHOCK_PX = 256;
const DISC_PX = 128;
const STAR_PX = 160;
const PEEL_PX = 96;

interface CannonParts { glow: Sprite; barrel: Sprite; trim: Sprite; dark: Sprite }

interface Cannon {
  parts: CannonParts;
  x: number; y: number;
  rot: number; target: number;
  age: number; popMs: number;
  /** Recoils: age and strength. */
  kicks: { age: number; amp: number }[];
  /** Pumps: age and strength. */
  pumps: { age: number; amp: number }[];
  /** Tier IV's golden charge (null = none). */
  glint: { age: number; dur: number; star: Sprite; ring: Sprite; halo: Sprite; moteAcc: number } | null;
  /** Ms into the stow (-1 = not stowing). */
  stow: number;
  /** Where the crown and the mouth are this frame (for the glint and the smoke). */
  crown: Pt; mouth: Pt;
}

interface BananaParts { glow: Sprite; body: Sprite; ends: Sprite; shine: Sprite; streak: Sprite }

interface Banana {
  idx: number;
  m: BananaMotion;
  age: number;
  /** Px per texture px (the length, the tier size and the stage scale folded in). */
  k: number;
  parts: BananaParts;
  sparkAcc: number;
  x: number; y: number;
}

type AlphaMode = 'out' | 'punch' | 'hold';
interface Fx {
  s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number;
  /** y scale as a fraction of x (1 = round). */
  sy: number; spin: number; delay: number;
  /** Drift (px/s) and its drag per second (1 = none). */
  vx: number; vy: number; drag: number;
  /** Scale ease: `quint` (a fast bloom) or `back` (a cartoon pop with overshoot). */
  ease: 'quint' | 'back';
  /** Rides the struck portrait (its knockback). */
  follow: boolean;
  /** A peel stuck on the face (counted for tests). */
  peel: boolean;
  x: number; y: number;
}

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  from: number; to: number; alpha: number;
  /** Stretched along its velocity (a spark). */
  align: boolean;
  /** A leaf: flutters side to side as it falls. */
  flutter: boolean;
  spin: number;
}

interface Mark { rings: [Sprite, Sprite]; shadow: Sprite; x: number; y: number; r: number; age: number; dur: number }

export class HeroBananaScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private used = 0;
  private cannon: Cannon | null = null;
  private bananas: Banana[] = [];
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private mark: Mark | null = null;
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private destroyed = false;
  private fox = 0;
  private foy = 0;
  private readonly rnd: () => number;
  /** A deeper banana for the chunks' shading and the star fill on light boards. */
  private readonly ripe: number;
  /** The giant's gold: the banana pushed toward the gold. */
  private readonly golden: number;

  constructor(private readonly tex: HeroBananaTextures, private readonly colors: BananaColors, private readonly look: BananaLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroBanana';
    this.layers = {} as Record<LayerId, Container>;
    this.freeSprites = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `banana-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.freeSprites[id] = [];
    }
    this.rnd = seededRng(seed);
    this.ripe = mixColor(colors.banana, colors.gold, 0.35);
    this.golden = mixColor(colors.banana, colors.gold, 0.7);
    // PRE-WARM: one near-invisible sprite per texture for the first few hundred ms (the damage formation is still
    // playing), so every texture is on the GPU long before the cannon or the slam needs it (no first-play spike).
    const t = tex;
    for (const w of [t.glow, t.ring, t.streak, t.star, t.spark, t.cannonBarrel, t.cannonTrim, t.cannonDark, t.cannonGlow, t.bananaBody, t.bananaEnds,
      t.bananaShine, t.bananaGlow, t.peel, t.chunk, t.impactStar, t.mush, t.leaf, t.puff, t.disc, t.shock]) {
      const s = this.take('core', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
  }

  get liveSprites(): number { return this.used; }
  get liveBananas(): number { return this.bananas.length; }
  get cannonUp(): boolean { return this.cannon !== null; }
  get glinting(): boolean { return this.cannon?.glint != null; }
  get marking(): boolean { return this.mark !== null; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) n += this.layers[id].children.length; return n; }
  /** The cannon's heading this frame (radians), or null with no cannon. For tests and the capture rig. */
  get cannonRot(): number | null { return this.cannon ? this.cannon.rot : null; }
  /** Peels stuck on the struck face right now. */
  get stuckPeels(): number { let n = 0; for (const f of this.fx) if (f.peel) n++; return n; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  /** The struck portrait's knockback this frame (overlay px): stuck peels, the star and the target ring ride it. */
  setFoeOffset(dx: number, dy: number): void { this.fox = Number.isFinite(dx) ? dx : 0; this.foy = Number.isFinite(dy) ? dy : 0; }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_BANANA_SPRITES) return null;
    let s = this.freeSprites[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(s: Sprite): void {
    const layer = (s.parent?.label?.replace('banana-', '') ?? 'core') as LayerId;
    s.visible = false; this.freeSprites[layer].push(s); this.used--;
  }

  private fxs(layer: LayerId, t: Texture, tint: number, x: number, y: number, o: Partial<Omit<Fx, 's' | 'age' | 'x' | 'y'>> & { dur: number; from: number; to: number; a0: number }): Fx | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.2, sy: 1, spin: 0, delay: 0, vx: 0, vy: 0, drag: 1, ease: 'quint', follow: false, peel: false, x, y, ...o };
    s.position.set(x + (f.follow ? this.fox : 0), y + (f.follow ? this.foy : 0));
    s.scale.set(f.from * this.scale, f.from * this.scale * f.sy);
    s.alpha = f.mode === 'punch' || f.delay > 0 ? 0 : f.a0;
    this.fx.push(f);
    return f;
  }

  private particle(layer: LayerId, t: Texture, tint: number, o: Omit<Particle, 's' | 'max'>): void {
    const s = this.take(layer, t, tint);
    if (!s) return;
    s.position.set(o.x, o.y);
    s.rotation = o.align ? Math.atan2(o.vy, o.vx) : this.rnd() * Math.PI * 2;
    this.particles.push({ ...o, s, max: o.life });
  }

  /** Banana chunks flung from a point: slices tumbling out and falling under gravity. */
  private chunks(x: number, y: number, n: number, speed: number, o: { dir?: number; spread?: number; lift?: number; life?: number; size?: number } = {}): void {
    const S = this.scale;
    const tints = [this.colors.cream, this.colors.banana, this.colors.cream, this.ripe];
    for (let i = 0; i < n; i++) {
      const a = o.dir === undefined ? this.rnd() * Math.PI * 2 : o.dir + (this.rnd() - 0.5) * (o.spread ?? 1.6);
      const sp = speed * (0.45 + this.rnd() * 0.8) * S;
      const sz = (o.size ?? 0.55) * (0.6 + this.rnd() * 0.7);
      this.particle('body', this.tex.chunk, tints[i % 4]!, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.lift ?? 0) * S, drag: 0.4, grav: this.look.gravity * S,
        life: (o.life ?? 600) * (0.7 + this.rnd() * 0.6), from: sz * S, to: sz * 0.8 * S, alpha: 1, align: false, flutter: false,
        spin: (this.rnd() - 0.5) * 0.03,
      });
    }
  }

  /** Gold sparkles: little glitter stars thrown out (or drawn in when `speed` is negative). */
  private sparkles(x: number, y: number, n: number, speed: number, o: { life?: number; size?: number; tint?: number } = {}): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const sp = speed * (0.4 + this.rnd() * 0.8) * S;
      this.particle('core', this.tex.star, o.tint ?? (i % 2 ? this.colors.gold : whiten(this.colors.gold, 0.5)), {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.2, grav: 0,
        life: (o.life ?? 480) * (0.7 + this.rnd() * 0.6), from: (o.size ?? 0.35) * S, to: 0.05 * S, alpha: 1, align: false, flutter: false,
        spin: (this.rnd() - 0.5) * 0.02,
      });
    }
  }

  /** Jungle leaves: flung out, then fluttering down. */
  private leaves(x: number, y: number, n: number, dir: number, speed: number): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = dir + (this.rnd() - 0.5) * 1.8;
      const sp = speed * (0.5 + this.rnd() * 0.7) * S;
      this.particle('body', this.tex.leaf, i % 2 ? this.colors.leaf : mixColor(this.colors.leaf, this.colors.barrel, 0.5), {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60 * S, drag: 0.08, grav: 380 * S,
        life: 700 + this.rnd() * 400, from: 0.8 * S, to: 0.7 * S, alpha: 1, align: false, flutter: true, spin: (this.rnd() - 0.5) * 0.02,
      });
    }
  }

  /** A smoke puff: a billow that swells and drifts (normal blend, so it reads as thick smoke on any board). */
  private puff(x: number, y: number, size: number, o: { vx?: number; vy?: number; dur?: number; a0?: number; tint?: number; follow?: boolean } = {}): void {
    const S = this.scale;
    const f = this.fxs('haze', this.tex.puff, o.tint ?? this.colors.smoke, x, y, {
      dur: o.dur ?? 560, from: 0.25 * size, to: 0.7 * size, a0: o.a0 ?? 0.75, mode: 'hold', vx: (o.vx ?? 0) * S, vy: (o.vy ?? -20) * S, drag: 0.12,
      spin: (this.rnd() - 0.5) * 0.002, follow: o.follow ?? false,
    });
    if (f) f.s.rotation = this.rnd() * Math.PI * 2;
  }

  /** The comic impact STAR: a dark outline behind a bright fill, popping out with a cartoon overshoot and a twist. */
  private comicStar(x: number, y: number, size: number, dur: number, tint: number): void {
    const s = size * this.look.starSize;
    const rot = this.rnd() * Math.PI;
    const spin = (this.rnd() < 0.5 ? -1 : 1) * 0.0012;
    const o = { dur, a0: 1, mode: 'hold' as const, ease: 'back' as const, follow: true, spin };
    const out = this.fxs('trim', this.tex.impactStar, this.colors.dark, x, y, { ...o, from: 0.2 * s, to: 1.08 * s });
    const fill = this.fxs('ink', this.tex.impactStar, tint, x, y, { ...o, from: 0.18 * s, to: s });
    const hot = this.fxs('core', this.tex.impactStar, 0xffffff, x, y, { ...o, from: 0.08 * s, to: 0.38 * s, a0: 0.4, mode: 'out' });
    for (const f of [out, fill, hot]) if (f) f.s.rotation = rot;
  }

  /** A banana peel bursting open and STICKING on the face: it pops, hangs, then slides off and fades. */
  private stickPeel(x: number, y: number, size: number, rot: number, hold = this.look.peelHoldMs): void {
    const f = this.fxs('body', this.tex.peel, this.colors.banana, x, y, {
      dur: hold, from: 0.25 * size, to: size, a0: 1, mode: 'hold', ease: 'back', follow: true, peel: true, vy: 26 * this.scale, drag: 1.4, spin: (this.rnd() - 0.5) * 0.0008,
    });
    if (f) f.s.rotation = rot;
  }

  // ── the cannon ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The ROYAL BANANA CANNON pops in on the hero's rim (a cartoon overshoot, a puff of leaves and gold sparkle), resting
   * at `rest`, and swings round to `aim`.
   */
  summon(pivot: Pt, rest: number, aim: number, popMs = this.look.popMs): void {
    if (this.cannon) return;
    const c = this.colors;
    const glow = this.take('glow', this.tex.cannonGlow, c.gold);
    const barrel = this.take('body', this.tex.cannonBarrel, c.barrel);
    const trim = this.take('trim', this.tex.cannonTrim, c.gold);
    const dark = this.take('ink', this.tex.cannonDark, c.dark);
    const all = [glow, barrel, trim, dark];
    if (all.some((s) => !s)) { for (const s of all) if (s) this.give(s); return; }
    for (const s of all as Sprite[]) { s.anchor.set(CANNON_PIVOT_X / CANNON_W, CANNON_AXIS_Y / CANNON_H); s.alpha = 0; s.position.set(pivot.x, pivot.y); }
    this.cannon = {
      parts: { glow: glow!, barrel: barrel!, trim: trim!, dark: dark! }, x: pivot.x, y: pivot.y, rot: rest, target: aim,
      age: 0, popMs: Math.max(1, popMs), kicks: [], pumps: [], glint: null, stow: -1, crown: { ...pivot }, mouth: { ...pivot },
    };
    // The pop: a smoke ring, leaves and gold sparkle.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      this.puff(pivot.x + Math.cos(a) * 20 * this.scale, pivot.y + Math.sin(a) * 14 * this.scale, 0.55, { dur: 520, a0: 0.55, vx: Math.cos(a) * 60, vy: Math.sin(a) * 40 - 20 });
    }
    this.leaves(pivot.x, pivot.y, 4, -Math.PI / 2, 220);
    this.sparkles(pivot.x, pivot.y, 8, 260, { life: 520 });
    this.fxs('core', this.tex.glow, whiten(c.gold, 0.4), pivot.x, pivot.y, { dur: 220, from: 0.4, to: 1.3, a0: 0.6 });
  }

  /** Swing the cannon toward a heading (eased over a few frames). */
  aim(dir: number): void { if (this.cannon && Number.isFinite(dir)) this.cannon.target = dir; }

  /** The cannon PUMPS before a shot: a quick bulge (the "chk"). */
  pump(amp = 1): void { this.cannon?.pumps.push({ age: 0, amp }); }

  /**
   * FIRE: the cannon recoils hard, a big muzzle blast (a flash, a ring, smoke billowing forward, leaves and sparks),
   * and a banana spins out along `m`. `age0` = ms already elapsed; `size` the tier's banana size.
   */
  fire(m: BananaMotion, size: number, age0 = 0, idx = this.bananas.length): void {
    const ch = this.cannon;
    const S = this.scale;
    const c = this.colors;
    const big = m.giant ? 2.2 : 1;
    if (ch) {
      ch.target = m.dir; ch.rot = m.dir; ch.kicks.push({ age: 0, amp: big });
      // The giant's shot releases the golden charge.
      if (m.giant && ch.glint) { this.give(ch.glint.star); this.give(ch.glint.ring); this.give(ch.glint.halo); ch.glint = null; }
    }
    const a = m.a;
    const d = m.dir;
    // The muzzle blast.
    this.fxs('core', this.tex.glow, whiten(c.banana, 0.6), a.x, a.y, { dur: 120, from: 0.4 * big, to: 1.1 * big, a0: 0.95 });
    this.fxs('glow', this.tex.glow, c.gold, a.x, a.y, { dur: 260, from: 0.6 * big, to: 1.8 * big, a0: 0.6, mode: 'punch', peakAt: 0.12 });
    const ring = this.fxs('glow', this.tex.ring, whiten(c.gold, 0.3), a.x, a.y, { dur: 260, from: 0.15 * big, to: 0.8 * big, a0: 0.9, sy: 0.5 });
    if (ring) ring.s.rotation = d + Math.PI / 2;
    const puffs = Math.max(0, Math.round(this.look.puffs * (m.giant ? 1.8 : 1)));
    for (let i = 0; i < puffs; i++) {
      const aa = d + (this.rnd() - 0.5) * 1.1;
      const sp = (90 + this.rnd() * 200) * (m.giant ? 1.4 : 1);
      this.puff(a.x + Math.cos(aa) * 10 * S, a.y + Math.sin(aa) * 10 * S, (0.8 + this.rnd() * 0.5) * (m.giant ? 1.5 : 1), {
        dur: 560 + this.rnd() * 280, a0: 0.88, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp - 30,
      });
    }
    this.leaves(a.x, a.y, Math.round(this.look.leaves * (m.giant ? 2 : 1)), d, 320 * big);
    for (let i = 0; i < 5 * big; i++) {
      const aa = d + (this.rnd() - 0.5) * 1.3;
      const sp = (500 + this.rnd() * 400) * S;
      this.particle('core', this.tex.spark, i % 2 ? c.gold : whiten(c.banana, 0.5), {
        x: a.x, y: a.y, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, drag: 0.02, grav: 300 * S, life: 220 + this.rnd() * 120,
        from: 0.5 * S, to: 0.15 * S, alpha: 1, align: true, flutter: false, spin: 0,
      });
    }
    if (m.giant) this.sparkles(a.x, a.y, 14, 380, { life: 600, size: 0.45 });
    // The banana.
    const k = (this.look.bananaLength / BANANA_W) * size * S;
    const parts = this.bananaParts(m.giant);
    if (!parts) return;
    const p0 = bananaPos(m, Math.max(0, age0));
    this.bananas.push({ idx, m, age: Math.max(0, age0), k, parts, sparkAcc: 0, x: p0.x, y: p0.y });
  }

  private bananaParts(giant: boolean): BananaParts | null {
    const c = this.colors;
    const glow = this.take('glow', this.tex.bananaGlow, giant ? c.gold : c.banana);
    const body = this.take('body', this.tex.bananaBody, giant ? this.golden : c.banana);
    const ends = this.take('ink', this.tex.bananaEnds, 0xffffff);
    const shine = this.take('core', this.tex.bananaShine, giant ? whiten(c.gold, 0.6) : 0xffffff);
    const streak = this.take('glow', this.tex.streak, giant ? c.gold : whiten(c.banana, 0.5));
    const all = [glow, body, ends, shine, streak];
    if (all.some((s) => !s)) { for (const s of all) if (s) this.give(s); return null; }
    for (const s of all as Sprite[]) s.alpha = 0;
    return { glow: glow!, body: body!, ends: ends!, shine: shine!, streak: streak! };
  }

  private bananaOf(i: number): Banana | undefined { return this.bananas.find((b) => b.idx === i); }

  private dropBanana(b: Banana): void {
    const P = b.parts;
    for (const s of [P.glow, P.body, P.ends, P.shine, P.streak]) this.give(s);
  }

  private takeBanana(i: number): Banana | undefined {
    const b = this.bananaOf(i);
    if (b) { this.dropBanana(b); this.bananas.splice(this.bananas.indexOf(b), 1); }
    return b;
  }

  /**
   * TIER IV's golden charge: the cannon glows gold, swells and trembles, its CROWN GLINTS (a star that flashes twice),
   * and gold motes are drawn into the muzzle. Released by the giant's shot.
   */
  glint(durMs: number): void {
    const ch = this.cannon;
    if (!ch || ch.glint) return;
    const star = this.take('core', this.tex.star, 0xffffff);
    const ring = this.take('glow', this.tex.ring, this.colors.gold);
    const halo = this.take('glow', this.tex.glow, this.colors.gold);
    if (!star || !ring || !halo) { for (const s of [star, ring, halo]) if (s) this.give(s); return; }
    star.alpha = 0; ring.alpha = 0; halo.alpha = 0;
    ch.glint = { age: 0, dur: Math.max(1, durMs), star, ring, halo, moteAcc: 0 };
  }

  /** The cannon pops away (a shrink with a little back-pull, a puff). */
  stow(): void {
    const ch = this.cannon;
    if (!ch || ch.stow >= 0) return;
    ch.stow = 0;
  }

  // ── the splats ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * A banana SPLATS in before the last (a tick): the peel bursts open and sticks, chunks fly back off the face, a small
   * comic star pops, a flash and a ring. `step` grows each tick.
   */
  hit(i: number, x: number, y: number, radius: number, step: number): void {
    const b = this.takeBanana(i);
    const at = b ? b.m.b : { x, y };
    const head = b ? bananaPos(b.m, b.m.flightMs).heading : 0;
    const g = 1 + 0.05 * step;
    const S = this.scale;
    const peelSize = (radius * 0.9) / PEEL_PX / S * g;
    this.stickPeel(at.x, at.y, peelSize, head + (this.rnd() - 0.5) * 1.2);
    this.comicStar(at.x, at.y, (radius * 0.75) / STAR_PX / S * g, 260, whiten(this.colors.banana, 0.1));
    this.fxs('core', this.tex.glow, whiten(this.colors.banana, 0.7), at.x, at.y, { dur: 100, from: 0.3, to: 0.8 * g, a0: 0.75, follow: true });
    this.fxs('glow', this.tex.ring, this.colors.banana, at.x, at.y, { dur: 240, from: 0.15, to: 0.7 * g, a0: 0.85, follow: true });
    this.chunks(at.x, at.y, this.look.tickChunks, 460, { dir: head + Math.PI, spread: 2.4, life: 560, size: 0.5, lift: 160 });
    void y; void x;
  }

  /**
   * THE impact (I-III): the last banana splats. The first frame is the brightest: a short warm flash over the face, a
   * mush splat, the big comic STAR, peels scattered over the face, two rings, a spray of chunks arcing out and falling,
   * a puff of banana mist. The fills are gone in ~150 ms, so the big -N reads.
   */
  impact(i: number, x: number, y: number, radius: number, o: { tier: number; k: number; burst: number; chunks: number; peels: number; flashAlpha: number }): void {
    const c = this.colors;
    const b = this.takeBanana(i);
    const at = b ? b.m.b : { x, y };
    const head = b ? bananaPos(b.m, b.m.flightMs).heading : -Math.PI / 2;
    const fs = o.burst;
    const S = this.scale;
    const portrait = (radius * 2) / GLOW_PX / S;
    this.fxs('core', this.tex.glow, whiten(c.banana, 0.7), x, y, { dur: 110, from: portrait, to: portrait * 1.2, a0: 0.45 * o.flashAlpha, follow: true });
    this.fxs('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 140, from: 0.6 * fs, to: 1.8 * fs, a0: o.flashAlpha, follow: true });
    this.fxs('glow', this.tex.glow, c.gold, at.x, at.y, { dur: 340, from: 1.1 * fs, to: 2.8 * fs, a0: 0.4 * o.flashAlpha, follow: true });
    const mush = this.fxs('haze', this.tex.mush, c.cream, at.x, at.y, { dur: 560, from: 0.2 * fs, to: 0.7 * fs, a0: 0.95, mode: 'hold', follow: true });
    if (mush) mush.s.rotation = this.rnd() * Math.PI * 2;
    this.comicStar(at.x, at.y, (radius * (1.25 + 0.2 * o.k)) / STAR_PX / S * fs, 380, c.banana);
    const peels = Math.max(1, o.peels);
    for (let p = 0; p < peels; p++) {
      const a = p === 0 ? 0 : (p / peels) * Math.PI * 2 + this.rnd() * 0.6;
      const rr = p === 0 ? 0 : radius * (0.35 + this.rnd() * 0.25);
      this.stickPeel(at.x + Math.cos(a) * rr, at.y + Math.sin(a) * rr, ((radius * (p === 0 ? 1.15 : 0.7)) / PEEL_PX / S) * (0.9 + 0.2 * o.k), this.rnd() * Math.PI * 2,
        this.look.peelHoldMs * (1 + 0.1 * p));
    }
    this.fxs('glow', this.tex.ring, whiten(c.banana, 0.5), at.x, at.y, { dur: 260, from: 0.2, to: 1.4 * (0.9 + 0.3 * o.k), a0: 1, follow: true });
    this.fxs('glow', this.tex.ring, c.gold, at.x, at.y, { dur: 480, from: 0.3, to: 2.4 * (0.85 + 0.4 * o.k), a0: 0.65 });
    this.chunks(at.x, at.y, Math.round(o.chunks * 0.7), 640, { dir: head + Math.PI, spread: 3, life: 760, size: 0.6, lift: 280 });
    this.chunks(at.x, at.y, Math.round(o.chunks * 0.3), 380, { life: 620, size: 0.45, lift: 120 });
    for (let p = 0; p < 1 + o.tier; p++) {
      const a = this.rnd() * Math.PI * 2;
      this.puff(at.x + Math.cos(a) * 14 * S, at.y + Math.sin(a) * 14 * S, 0.6 + 0.2 * o.k, { dur: 620, a0: 0.45, tint: c.cream, vx: Math.cos(a) * 70, vy: Math.sin(a) * 50 - 30 });
    }
    if (o.tier >= 3) this.sparkles(at.x, at.y, 8, 300, { life: 500 });
  }

  /**
   * TIER IV: the golden target ring locks on to the struck hero while the giant is up out of frame: two flat gold rings
   * closing in and a flat shadow growing under it (full circles, never a perspective ellipse). Removed by the slam.
   */
  startMark(x: number, y: number, radius: number, durMs: number): void {
    if (this.mark) return;
    const r1 = this.take('glow', this.tex.ring, this.colors.gold);
    const r2 = this.take('glow', this.tex.ring, whiten(this.colors.gold, 0.4));
    const shadow = this.take('haze', this.tex.disc, this.colors.dark);
    if (!r1 || !r2 || !shadow) { for (const s of [r1, r2, shadow]) if (s) this.give(s); return; }
    for (const s of [r1, r2, shadow]) { s.alpha = 0; s.position.set(x, y); }
    this.mark = { rings: [r1, r2], shadow, x, y, r: radius, age: 0, dur: Math.max(1, durMs) };
  }

  private endMark(): void {
    const mk = this.mark;
    if (!mk) return;
    for (const s of [mk.rings[0], mk.rings[1], mk.shadow]) this.give(s);
    this.mark = null;
  }

  /**
   * TIER IV's SLAM: the giant golden banana lands. A golden flash, a golden SHOCKWAVE (a thick ring with a bright ring
   * riding inside it), gold rays, the biggest comic star, a mush splat, a BANANA-BUNCH SHOWER (whole bananas bursting out
   * and tumbling down), peels scattered all over the face, chunks, sparkles and a warm puff of banana mist.
   */
  slam(i: number, x: number, y: number, radius: number, o: { burst: number; chunks: number; peels: number; flashAlpha: number }): void {
    this.endMark();
    const b = this.takeBanana(i);
    const at = b ? b.m.b : { x, y };
    const c = this.colors;
    const S = this.scale;
    const fs = o.burst;
    const L = this.look;
    const portrait = (radius * 2) / GLOW_PX / S;
    const shock = (radius * 2) / SHOCK_PX / S;
    this.fxs('core', this.tex.glow, whiten(c.gold, 0.6), x, y, { dur: 130, from: portrait * 1.1, to: portrait * 1.45, a0: 0.8 * o.flashAlpha, follow: true });
    // Short and not too wide: the rays, the ring and the shower carry the slam; a big held glow reads as milky glare.
    this.fxs('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 140, from: 1.1 * fs, to: Math.min(3.6, 2.2 * fs), a0: o.flashAlpha });
    this.fxs('glow', this.tex.glow, c.gold, at.x, at.y, { dur: 260, from: 1.3 * fs, to: Math.min(3.6, 2.4 * fs), a0: 0.3 * o.flashAlpha });
    // THE GOLDEN SHOCKWAVE: a gold band (normal blend: it reads on a light board) with bright light riding inside it.
    this.fxs('haze', this.tex.shock, c.gold, at.x, at.y, { dur: 620, from: shock * 0.6, to: shock * 4 * L.shockSize, a0: 0.8 });
    this.fxs('glow', this.tex.shock, whiten(c.gold, 0.5), at.x, at.y, { dur: 460, from: shock * 0.5, to: shock * 3.1 * L.shockSize, a0: 0.8 });
    this.fxs('glow', this.tex.ring, c.banana, at.x, at.y, { dur: 700, from: 0.5, to: 4.6 * L.shockSize * ((radius * 2) / RING_PX / S) * 0.55, a0: 0.45 });
    // Gold rays.
    const rays = Math.max(0, Math.round(L.goldRays));
    for (let r = 0; r < rays; r++) {
      const a = (r / Math.max(1, rays)) * Math.PI * 2 + (this.rnd() - 0.5) * 0.3;
      const len = 1 + this.rnd() * 0.6;
      const f = this.fxs('glow', this.tex.streak, r % 2 ? c.gold : whiten(c.gold, 0.5), at.x + Math.cos(a) * radius * 0.9, at.y + Math.sin(a) * radius * 0.9,
        { dur: 360, from: 2.4 * len, to: 4.4 * len, a0: 0.75, sy: 0.3 });
      if (f) f.s.rotation = a;
    }
    const mush = this.fxs('haze', this.tex.mush, c.cream, at.x, at.y, { dur: 620, from: 0.3 * fs, to: 0.95 * fs, a0: 0.95, mode: 'hold', follow: true });
    if (mush) mush.s.rotation = this.rnd() * Math.PI * 2;
    this.comicStar(at.x, at.y, (radius * 1.9) / STAR_PX / S, 460, whiten(c.gold, 0.35));
    // THE BANANA-BUNCH SHOWER: whole bananas bursting out, tumbling and falling.
    const shower = Math.max(0, Math.round(L.showerBananas));
    for (let s = 0; s < shower; s++) {
      const a = -Math.PI / 2 + ((s / Math.max(1, shower - 1)) - 0.5) * 2.9 + (this.rnd() - 0.5) * 0.25;
      const sp = (420 + this.rnd() * 380) * S;
      const sz = (L.bananaLength / BANANA_W) * (0.7 + this.rnd() * 0.35) * S;
      this.particle('body', this.tex.bananaBody, s % 4 === 0 ? this.golden : c.banana, {
        x: at.x, y: at.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.5, grav: L.gravity * 0.9 * S,
        life: 900 + this.rnd() * 350, from: sz, to: sz * 0.9, alpha: 1, align: false, flutter: false, spin: (this.rnd() < 0.5 ? -1 : 1) * (0.012 + this.rnd() * 0.012),
      });
    }
    // Peels scattered round the face (one big one in the middle, the rest out toward the rim, so the face still reads).
    const peels = Math.max(1, o.peels);
    for (let p = 0; p < peels; p++) {
      const a = (p / peels) * Math.PI * 2 + this.rnd() * 0.5;
      const rr = p === 0 ? 0 : radius * (0.55 + this.rnd() * 0.3);
      this.stickPeel(at.x + Math.cos(a) * rr, at.y + Math.sin(a) * rr, ((radius * (p === 0 ? 1.2 : 0.6)) / PEEL_PX / S), this.rnd() * Math.PI * 2, L.peelHoldMs * (1.2 + 0.08 * p));
    }
    this.chunks(at.x, at.y, Math.round(o.chunks * 0.7), 900, { life: 900, size: 0.65, lift: 380 });
    this.chunks(at.x, at.y, Math.round(o.chunks * 0.3), 520, { life: 760, size: 0.5, lift: 180 });
    this.sparkles(at.x, at.y, 18, 520, { life: 700, size: 0.5 });
    for (let p = 0; p < 6; p++) {
      const a = (p / 6) * Math.PI * 2 + (this.rnd() - 0.5) * 0.5;
      this.puff(at.x + Math.cos(a) * radius * 0.3, at.y + Math.sin(a) * radius * 0.3, 1.1, { dur: 820, a0: 0.5, tint: c.cream, vx: Math.cos(a) * 190, vy: Math.sin(a) * 140 - 40 });
    }
  }

  /** A banana pop round the target after the slam (IV): a small star, a ring, chunks, a peel flick. */
  boom(x: number, y: number, size: number): void {
    const S = this.scale;
    this.comicStar(x, y, 0.42 * size, 240, whiten(this.colors.banana, 0.3));
    this.fxs('core', this.tex.glow, whiten(this.colors.gold, 0.5), x, y, { dur: 120, from: 0.3 * size, to: 0.8 * size, a0: 0.7 });
    this.fxs('glow', this.tex.ring, this.colors.gold, x, y, { dur: 300, from: 0.15, to: 0.9 * size, a0: 0.85 });
    this.chunks(x, y, 7, 480, { life: 560, size: 0.45, lift: 220 });
    this.sparkles(x, y, 4, 200, { life: 380 });
    void S;
  }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Advance by `dtMs` (sequence ms; the runner applies the speed). */
  update(dtMs: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(100, dtMs));
    const sec = dt / 1000;
    const S = this.scale;

    if (this.warm.length) {
      this.warmLeft -= Math.max(dt, 16);
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; }
    }

    if (this.cannon) this.drawCannon(this.cannon, dt);

    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const b = this.bananas[i]!;
      b.age += dt;
      // A banana with no splat cue (a cancelled tick) clears itself shortly after it lands.
      if (b.age > b.m.flightMs + 400) { this.dropBanana(b); this.bananas.splice(i, 1); continue; }
      this.drawBanana(b);
    }

    const mk = this.mark;
    if (mk) {
      mk.age += dt;
      const u = clamp01(mk.age / mk.dur);
      const cx = mk.x + this.fox, cy = mk.y + this.foy;
      const base = (mk.r * 2) / RING_PX;
      mk.rings.forEach((s, j) => {
        const ph = (mk.age * 0.004 + j * 0.5) % 1;
        s.position.set(cx, cy);
        s.scale.set(base * (1.9 - 0.75 * ph) * (1 - 0.25 * u));
        s.alpha = Math.min(1, u * 4) * (1 - ph) * (0.7 + 0.3 * u);
      });
      const sd = (mk.r * 2) / DISC_PX;
      mk.shadow.position.set(cx, cy);
      mk.shadow.scale.set(sd * (0.35 + 0.65 * easeInOutSine(u)));
      mk.shadow.alpha = 0.32 * u;
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= dt; if (q.delay > 0) continue; }
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      if (q.vx || q.vy) {
        const damp = Math.pow(q.drag, sec);
        q.vx *= damp; q.vy *= damp;
        q.x += q.vx * sec; q.y += q.vy * sec;
      }
      const e = q.ease === 'back' ? easeOutBack(Math.min(1, u * 4), 2.4) : easeOutQuint(u);
      const sc = (q.from + (q.to - q.from) * e) * S;
      q.s.scale.set(sc, sc * q.sy);
      q.s.position.set(q.x + (q.follow ? this.fox : 0), q.y + (q.follow ? this.foy : 0));
      if (q.spin) q.s.rotation += q.spin * dt * (1 - 0.6 * u);
      q.s.alpha = q.mode === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.mode === 'hold' ? q.a0 * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4)
          : q.a0 * (1 - u) * (1 - u * 0.3);
      if (u >= 1) { this.give(q.s); this.fx.splice(i, 1); }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) { this.give(p.s); this.particles.splice(i, 1); continue; }
      const damp = Math.pow(p.drag, sec);
      p.vx *= damp; p.vy = p.vy * damp + p.grav * sec;
      p.x += p.vx * sec; p.y += p.vy * sec;
      const t = 1 - p.life / p.max;
      const sc = p.from + (p.to - p.from) * t;
      if (p.align) {
        const v = Math.hypot(p.vx, p.vy);
        p.s.position.set(p.x, p.y);
        p.s.rotation = Math.atan2(p.vy, p.vx);
        p.s.scale.set(sc * (1 + Math.min(1.6, v / (900 * S))), sc);
        p.s.alpha = p.alpha * (1 - t * t);
      } else if (p.flutter) {
        const age = p.max - p.life;
        // A leaf: rocks side to side as it falls, its fall slowed by the drag of the air.
        if (p.vy > 140 * S) p.vy = 140 * S;
        p.s.position.set(p.x + Math.sin(age * 0.012 + p.from * 30) * 12 * S, p.y);
        p.s.rotation = Math.sin(age * 0.012 + p.from * 30) * 0.8 + p.spin * age;
        p.s.scale.set(sc, sc * (0.6 + 0.4 * Math.abs(Math.cos(age * 0.01))));
        p.s.alpha = p.alpha * (1 - t * t * t);
      } else {
        p.s.position.set(p.x, p.y);
        p.s.scale.set(sc);
        if (p.spin) p.s.rotation += p.spin * dt;
        p.s.alpha = p.alpha * (1 - t * t * t);
      }
    }

    return this.used > this.warm.length || this.cannon !== null || this.mark !== null;
  }

  /** Pose the cannon: pop in, swing to its aim, pump, recoil, the golden charge, the stow. */
  private drawCannon(ch: Cannon, dt: number): void {
    const S = this.scale;
    const L = this.look;
    ch.age += dt;
    // Swing toward the aim (eased, never snapping; a shot sets the heading exactly).
    let da = ch.target - ch.rot; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
    ch.rot += da * (1 - Math.exp(-dt / 55));
    const pop = ch.age < ch.popMs ? easeOutBack(ch.age / ch.popMs, 2.6) : 1;
    let rec = 0;
    for (let i = ch.kicks.length - 1; i >= 0; i--) {
      const k = ch.kicks[i]!;
      k.age += dt;
      if (k.age > 1000) { ch.kicks.splice(i, 1); continue; }
      rec += k.amp * (k.age < 35 ? k.age / 35 : Math.exp(-(k.age - 35) / 130));
    }
    let bulge = 0;
    for (let i = ch.pumps.length - 1; i >= 0; i--) {
      const q = ch.pumps[i]!;
      q.age += dt;
      if (q.age > 120) { ch.pumps.splice(i, 1); continue; }
      bulge += q.amp * Math.sin(Math.PI * (q.age / 120));
    }
    let swell = 1, glow = 0, tx = 0, ty = 0, trimTint = this.colors.gold;
    const gl = ch.glint;
    if (gl) {
      gl.age += dt;
      const u = clamp01(gl.age / gl.dur);
      const e = easeInOutSine(u);
      swell = 1 + 0.22 * e;
      glow = 0.2 + 0.8 * e;
      const tr = 2.6 * S * u * u;
      tx = tr * Math.sin(gl.age * 0.21); ty = tr * Math.sin(gl.age * 0.27 + 1.1);
      trimTint = whiten(this.colors.gold, 0.35 * e);
      // Gold motes drawn into the mouth, faster as it charges.
      gl.moteAcc += dt * (0.02 + 0.06 * u);
      while (gl.moteAcc >= 1) {
        gl.moteAcc -= 1;
        const a = this.rnd() * Math.PI * 2, r = (70 + this.rnd() * 60) * S;
        const life = 200 + this.rnd() * 80;
        const sp = r / (life / 1000);
        this.particle('core', this.tex.spark, this.rnd() < 0.5 ? this.colors.gold : whiten(this.colors.gold, 0.5), {
          x: ch.mouth.x + Math.cos(a) * r, y: ch.mouth.y + Math.sin(a) * r, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, drag: 1, grav: 0,
          life, from: 0.45 * S, to: 0.15 * S, alpha: 1, align: true, flutter: false, spin: 0,
        });
      }
      // The crown glint: a star that flashes at a third of the way in and again, big, just before the shot.
      const flash = Math.max(Math.exp(-(((u - 0.33) / 0.07) ** 2)), 1.4 * Math.exp(-(((u - 0.86) / 0.08) ** 2)));
      gl.star.position.set(ch.crown.x, ch.crown.y);
      gl.star.rotation += dt * 0.006;
      gl.star.scale.set((0.35 + 0.9 * flash) * S);
      gl.star.alpha = Math.min(1, 0.25 * e + flash);
      gl.ring.position.set(ch.crown.x, ch.crown.y);
      gl.ring.scale.set((0.1 + 0.35 * flash) * S);
      gl.ring.alpha = 0.8 * Math.min(1, flash);
      // A golden halo swelling round the whole cannon, throbbing faster as it charges.
      gl.halo.position.set((ch.x + ch.mouth.x) / 2, (ch.y + ch.mouth.y) / 2);
      gl.halo.scale.set((1.2 + 1.3 * e) * (1 + 0.06 * Math.sin(gl.age * (0.02 + 0.05 * u))) * S * (L.cannonLength / 210));
      gl.halo.alpha = 0.55 * e;
    }
    let stowK = 1;
    if (ch.stow >= 0) {
      ch.stow += dt;
      const u = clamp01(ch.stow / 240);
      stowK = 1 - easeInBack(u, 1.8);
      if (u >= 1) {
        this.puff(ch.x, ch.y, 0.7, { dur: 420, a0: 0.55, vy: -30 });
        this.sparkles(ch.x, ch.y, 5, 160, { life: 360 });
        for (const s of [ch.parts.glow, ch.parts.barrel, ch.parts.trim, ch.parts.dark]) this.give(s);
        if (ch.glint) { this.give(ch.glint.star); this.give(ch.glint.ring); this.give(ch.glint.halo); }
        this.cannon = null;
        return;
      }
    }
    const flip = Math.cos(ch.rot) < 0 ? -1 : 1;
    const recN = Math.min(2.4, rec);
    const kc = (L.cannonLength * S) / CANNON_W;
    const size = kc * pop * swell * Math.max(0, stowK);
    const sx = size * (1 - 0.1 * recN + 0.07 * bulge);
    const sy = size * (1 + 0.08 * recN + 0.12 * bulge) * flip;
    const rot = ch.rot - flip * 0.16 * recN;
    const back = L.recoil * S * recN;
    const px = ch.x - Math.cos(ch.rot) * back + tx, py = ch.y - Math.sin(ch.rot) * back + ty;
    const P = ch.parts;
    for (const s of [P.glow, P.barrel, P.trim, P.dark]) { s.position.set(px, py); s.rotation = rot; s.scale.set(sx, sy); s.alpha = 1; }
    P.glow.alpha = Math.min(1, glow * 1.2) * (0.85 + 0.15 * Math.sin(ch.age * 0.03));
    P.glow.scale.set(sx * 1.12, sy * 1.4);
    P.trim.tint = trimTint;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const at = (lx: number, ly: number): Pt => ({ x: px + (lx * sx) * cs - (ly * sy) * sn, y: py + (lx * sx) * sn + (ly * sy) * cs });
    ch.crown = at(CROWN_X - CANNON_PIVOT_X, CROWN_Y - CANNON_AXIS_Y);
    ch.mouth = at(CANNON_MOUTH_X - CANNON_PIVOT_X, 0);
  }

  /** Pose one banana: tumbling along its arc, with its streak behind it; the giant glows and sheds gold. */
  private drawBanana(b: Banana): void {
    const m = b.m;
    const S = this.scale;
    const p = bananaPos(m, b.age);
    const born = clamp01(b.age / 60);
    const k = b.k * (0.55 + 0.45 * easeOutBack(born, 2));
    const P = b.parts;
    const vis = b.age <= m.flightMs ? 1 : 0;
    for (const s of [P.glow, P.body, P.ends, P.shine]) { s.position.set(p.x, p.y); s.rotation = p.rot; s.scale.set(k); s.alpha = vis; }
    P.glow.scale.set(k * 1.12);
    P.glow.alpha = vis * (m.giant ? 0.85 + 0.15 * Math.sin(b.age * 0.03) : 0.22);
    P.shine.alpha = vis * (m.giant ? 1 : 0.75);
    // The streak: a short motion blur behind it, along its heading.
    const len = BANANA_W * k;
    P.streak.position.set(p.x - Math.cos(p.heading) * len * 0.55, p.y - Math.sin(p.heading) * len * 0.55);
    P.streak.rotation = p.heading;
    P.streak.scale.set((len / 64) * (m.giant ? 1.6 : 1.3), (m.giant ? 0.9 : 0.45) * (len / 64));
    P.streak.alpha = vis * this.look.trailAlpha * born;
    if (m.giant && vis) {
      // The giant sheds gold sparkles along its climb and fall.
      b.sparkAcc += Math.hypot(p.x - b.x, p.y - b.y);
      const every = 26 * S;
      while (b.sparkAcc >= every) {
        b.sparkAcc -= every;
        this.particle('core', this.tex.star, this.rnd() < 0.5 ? this.colors.gold : whiten(this.colors.gold, 0.6), {
          x: p.x + (this.rnd() - 0.5) * len * 0.6, y: p.y + (this.rnd() - 0.5) * len * 0.3, vx: (this.rnd() - 0.5) * 60 * S, vy: (this.rnd() - 0.5) * 60 * S,
          drag: 0.3, grav: 120 * S, life: 380 + this.rnd() * 200, from: 0.4 * S, to: 0.05 * S, alpha: 1, align: false, flutter: false, spin: 0.01,
        });
      }
    }
    b.x = p.x; b.y = p.y;
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const b of this.bananas) this.dropBanana(b);
    for (const q of this.fx) this.give(q.s);
    for (const p of this.particles) this.give(p.s);
    for (const s of this.warm) this.give(s);
    const ch = this.cannon;
    if (ch) {
      for (const s of [ch.parts.glow, ch.parts.barrel, ch.parts.trim, ch.parts.dark]) this.give(s);
      if (ch.glint) { this.give(ch.glint.star); this.give(ch.glint.ring); this.give(ch.glint.halo); }
    }
    this.endMark();
    this.bananas = []; this.fx = []; this.particles = []; this.warm = []; this.cannon = null;
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const [id] of LAYERS) {
      this.freeSprites[id].length = 0;
      this.layers[id].removeChildren().forEach((c) => c.destroy());
    }
    this.root.removeChildren().forEach((c) => c.destroy());
    this.root.destroy();
  }
}
