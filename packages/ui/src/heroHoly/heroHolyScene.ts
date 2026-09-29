/**
 * THE HOLY SCENE: everything the Holy (Consecration) hero attack draws in Pixi, as a plain scene graph with no
 * renderer, so it runs (and is tested) headless. `heroHoly.ts` mounts `root` on the above-portrait overlay and feeds
 * `update(dt)`.
 *
 * Design rule (the Arcana bar: one hero element per beat, drawn as geometry; particles only as seasoning):
 *  - INVOKE: a golden HALO rings the striking hero's head and a slow SUNBURST turns behind the portrait (god rays with
 *    a clear middle, so the face stays clean); light motes are drawn in. The prayer goes up as a beam off the hero.
 *  - THE SIGIL: a crisp holy rune circle flashes onto the struck portrait and spins down onto it (line work).
 *  - THE SMITE: a PILLAR of light drops out of the sky (a normal-blend gold body under an additive white core, so it
 *    reads on the light board AND blooms on dark ground). Its landing is the brightest frame: a short flash, a cross
 *    gleam, god rays, a crisp ring and a ground ring, rising motes. Fills are gone in ~150 ms; the rays and rings linger.
 *  - THE SPEARS (III): lances of light thunk in round the target in rhythm, each planting a glowing SEED rune on the
 *    ground; the final smite makes every seed erupt.
 *  - THE SWORD (IV): one huge ornate sword painted in its own colours (three aligned layers: a soft glow, the body, the
 *    hot highlights) descends out of a beam of light, hangs while a glint runs down its blade, then falls and SLAMS into
 *    the board (a shockwave, dust, light debris, radiant cracks). THE CONSECRATION erupts from it: a runic circle on the
 *    ground (a true ground-plane ellipse: rotation composed with the tilt through the sprite's skew, so it turns ON the
 *    ground, not in the screen), light pillars round its rim, then a band of holy ground racing to the struck hero with
 *    runes stamped as it passes, cracks, small pillars and motes. Under the struck hero it gathers, then HOLY FLAMES and
 *    a pillar ERUPT. The ground lingers and fades; the sword dissolves into light.
 *
 * LAYERS, bottom to top: ground (normal: the gold stains, deep-gold rune lines, cracks) | under (additive: glows behind
 * things, the ground's light) | body (normal: the sword, the pillars' gold bodies, flames, dust) | glow (additive:
 * pillars, rays, flames) | hot (additive: cores, flashes, motes, glints). Every sprite is pooled per layer.
 *
 * Contract: sprites are POOLED per layer (hidden and reused) and bounded by `MAX_HOLY_SPRITES`; textures are the
 * caller's and are pre-warmed at construction (a near-invisible sprite each while the damage formation plays, so no
 * texture uploads on the first smite); positions are the overlay's px; `setCamera` mirrors the DOM camera; `update`
 * returns whether anything still draws; `destroy()` leaves nothing behind. Scatter is seeded (a replay throws the same
 * motes).
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeInOutSine, easeOutBack, easeOutCubic, easeOutQuint, seededRng, whiten, type Pt } from '../heroAttack/easing';
import type { HolyRune } from './heroHolyConfig';
import { SWORD_GUARD_FROM_TIP, SWORD_H, SWORD_LEN_PX, SWORD_TIP_Y } from './heroHolyTextures';

export interface HeroHolyTextures extends HeroArcanaTextures {
  swordGlow: Texture; swordBody: Texture; swordHot: Texture;
  hsigil: Texture; rays: Texture; pillar: Texture; flame: Texture; spear: Texture; crack: Texture; puff: Texture; chip: Texture;
  glyphs: Texture[];
}

export interface HolyColors { core: number; gold: number; deep: number; sky: number; side: number; dust: number }

export interface HolyLook {
  haloSize: number; sunburst: number; prayBeam: number;
  sigilSize: number; sigilSpin: number;
  pillarGlow: number; pillarHeight: number; raysSize: number;
  spearSize: number; seedGlow: number;
  swordGlow: number;
  tilt: number; pathWidth: number; flameHeight: number;
}

/** Hard cap on sprites alive at once (a Tier IV eruption peaks around 450). */
export const MAX_HOLY_SPRITES = 900;

type LayerId = 'ground' | 'under' | 'body' | 'glow' | 'hot';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [
  ['ground', 'normal'], ['under', 'add'], ['body', 'normal'], ['glow', 'add'], ['hot', 'add'],
];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
const SIGIL_PX = 256 * 0.92; // the sigil's outer ring spans 0.92 of its box
const GLOW_PX = 128;
const RING_PX = 160 * 0.8; // the ring texture's circle is 0.8 of its box
const PILLAR_W = 64, PILLAR_H = 256;

type Ease = (u: number) => number;
const lin: Ease = (u) => clamp01(u);
const easeInQuad: Ease = (u) => { const t = clamp01(u); return t * t; };

/**
 * Put a sprite ON THE GROUND: scaled (sx, sy) in its own frame, turned by `th` in the ground plane, then the plane
 * squashed by `tilt` (seen at an angle). Written through Pixi's rotation + skew so the ellipse turns on the ground
 * instead of tipping in the screen. Pure transform (no paint).
 */
export function groundTransform(s: Sprite, th: number, sx: number, sy: number, tilt: number): void {
  const c = Math.cos(th), si = Math.sin(th);
  const rot = Math.atan2(tilt * si, c);
  s.rotation = rot;
  s.skew.set(rot - Math.atan2(si, tilt * c), 0);
  s.scale.set(sx * Math.hypot(c, tilt * si), sy * Math.hypot(si, tilt * c));
}

interface Fx {
  s: Sprite; age: number; delay: number; dur: number;
  sx0: number; sx1: number; sy0: number; sy1: number; ease: Ease;
  a0: number; inMs: number; outFrom: number;
  rot: number; spin: number; tilt: number; flick: number; phase: number;
  x: number; y: number; vx: number; vy: number;
}
type FxOpts = Partial<Omit<Fx, 's' | 'age' | 'x' | 'y'>> & { dur: number; from: number; to: number; ry?: number; a0: number; ax?: number; ay?: number };

interface Held {
  s: Sprite; tag: string; age: number; a: number; inMs: number;
  g0: number; g1: number; gMs: number; back: boolean; ry: number; tilt: number; rot: number; spin: number;
  pulse: number; phase: number; kick: number; kickAge: number;
  fadeT: number; fadeMs: number; flare: number;
  /** A crack: its length (x scale), its width is `ry` (so it thickens only in its own frame). */
  len?: number;
}
type HeldOpts = Partial<Omit<Held, 's' | 'tag' | 'age' | 'fadeT' | 'kick' | 'kickAge'>> & { a: number; g1: number; ax?: number; ay?: number };

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  from: number; to: number; alpha: number; twinkle: number; spin: number; align: boolean;
}

/** A column of light: it DROPS out of the sky onto `foot` (a smite) or RISES off the ground (an eruption). */
interface Pillar {
  parts: { s: Sprite; w: number; a: number }[];
  head: Sprite | null;
  x: number; top: number; foot: number; mode: 'drop' | 'rise'; width: number;
  age: number; move: number; hold: number; fade: number;
}

interface Spear { body: Sprite; glow: Sprite; trail: Sprite; from: Pt; to: Pt; age: number; dur: number; size: number }

interface Sword {
  glow: Sprite; body: Sprite; hot: Sprite; beam: Sprite; trail: Sprite; glint: Sprite;
  x: number; len: number; tip: (ageMs: number) => number; age: number; fallAge: number; slamAge: number;
  dissolveT: number; dissolveMs: number; moteAcc: number;
}

interface Spread {
  a: Pt; ang: number; len: number; dur: number; age: number; width: number; runes: HolyRune[]; stamped: number;
  bandBody: Sprite; bandLight: Sprite; head: Sprite; headStar: Sprite; crackAcc: number; lastD: number; moteAcc: number; fadeT: number; fadeMs: number;
}

export class HeroHolyScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly free: Record<LayerId, Sprite[]>;
  private used = 0;
  private fx: Fx[] = [];
  private held: Held[] = [];
  private particles: Particle[] = [];
  private pillars: Pillar[] = [];
  private spears: Spear[] = [];
  private sword: Sword | null = null;
  private spreadFx: Spread | null = null;
  private gatherAcc: { x: number; y: number; r: number; left: number; acc: number } | null = null;
  private invokeAcc: { x: number; y: number; r: number; left: number; acc: number } | null = null;
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private destroyed = false;
  private readonly rnd: () => number;

  constructor(private readonly tex: HeroHolyTextures, private readonly colors: HolyColors, private readonly look: HolyLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroHoly';
    this.layers = {} as Record<LayerId, Container>;
    this.free = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `holy-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.free[id] = [];
    }
    this.rnd = seededRng(seed);
    // PRE-WARM: one near-invisible sprite per texture for the first few hundred ms (the damage formation is still
    // playing), so every texture is on the GPU long before the first beat needs it (no first-play spike).
    const t = tex;
    for (const w of [t.glow, t.spark, t.streak, t.ring, t.beam, t.star, t.swordGlow, t.swordBody, t.swordHot, t.hsigil, t.rays, t.pillar,
      t.flame, t.spear, t.crack, t.puff, t.chip, ...t.glyphs]) {
      const s = this.take('hot', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
  }

  get liveSprites(): number { return this.used - this.warm.length; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) n += this.layers[id].children.length; return n; }
  get hasSword(): boolean { return this.sword !== null; }
  /** The sword's tip y (null when there is no sword). Exposed for tests and the capture rig. */
  get swordTip(): number | null { return this.sword ? this.sword.body.position.y : null; }
  get spreading(): boolean { return this.spreadFx !== null && this.spreadFx.age < this.spreadFx.dur; }
  get groundHeld(): number { return this.held.filter((h) => h.tag === 'ground' || h.tag === 'foe').length; }
  get seeds(): number { return this.held.filter((h) => h.tag === 'seed').length; }
  get liveSpears(): number { return this.spears.length; }
  get livePillars(): number { return this.pillars.length; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_HOLY_SPRITES) return null;
    let s = this.free[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1); s.skew.set(0, 0);
    this.used++;
    return s;
  }

  private give(s: Sprite): void {
    const layer = (s.parent?.label?.replace('holy-', '') ?? 'hot') as LayerId;
    s.visible = false;
    this.free[layer].push(s);
    this.used--;
  }

  /** A one-shot tween: scale from `from` to `to` (y = x * `ry`, or its own `sy0`/`sy1`), fade in, hold, fade out. */
  private tw(layer: LayerId, t: Texture, tint: number, x: number, y: number, o: FxOpts): Sprite | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    if (o.ax !== undefined || o.ay !== undefined) s.anchor.set(o.ax ?? 0.5, o.ay ?? 0.5);
    const ry = o.ry ?? 1;
    const f: Fx = {
      s, age: 0, delay: o.delay ?? 0, dur: Math.max(1, o.dur), sx0: o.from, sx1: o.to, sy0: o.sy0 ?? o.from * ry, sy1: o.sy1 ?? o.to * ry,
      ease: o.ease ?? easeOutQuint, a0: o.a0, inMs: o.inMs ?? 0, outFrom: o.outFrom ?? 0, rot: o.rot ?? 0, spin: o.spin ?? 0,
      tilt: o.tilt ?? 0, flick: o.flick ?? 0, phase: o.phase ?? this.rnd() * 6.28, x, y, vx: o.vx ?? 0, vy: o.vy ?? 0,
    };
    s.position.set(x, y);
    s.alpha = 0;
    this.paintFx(f);
    if (f.delay > 0) s.alpha = 0;
    this.fx.push(f);
    return s;
  }

  /** A held sprite: grows in, stays (pulsing gently) until its tag is faded. */
  private hold(layer: LayerId, t: Texture, tint: number, x: number, y: number, tag: string, o: HeldOpts): Held | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    if (o.ax !== undefined || o.ay !== undefined) s.anchor.set(o.ax ?? 0.5, o.ay ?? 0.5);
    s.position.set(x, y);
    s.alpha = 0;
    const h: Held = {
      s, tag, age: 0, a: o.a, inMs: o.inMs ?? 120, g0: o.g0 ?? o.g1, g1: o.g1, gMs: o.gMs ?? 1, back: o.back ?? false, ry: o.ry ?? 1,
      tilt: o.tilt ?? 0, rot: o.rot ?? 0, spin: o.spin ?? 0, pulse: o.pulse ?? 0, phase: o.phase ?? this.rnd() * 6.28, kick: 0, kickAge: 0,
      fadeT: -1, fadeMs: 1, flare: 0,
    };
    this.held.push(h);
    this.paintHeld(h);
    return h;
  }

  /** Fade every held sprite with `tag` over `ms`, growing by `flare` as it goes. */
  private fadeTag(tag: string, ms: number, flare = 0): void {
    for (const h of this.held) if (h.tag === tag && h.fadeT < 0) { h.fadeT = 0; h.fadeMs = Math.max(1, ms); h.flare = flare; }
  }

  /** A flare pulse through every held sprite with `tag` (a tick lands on it). */
  private kickTag(tag: string, amount: number): void {
    for (const h of this.held) if (h.tag === tag && h.fadeT < 0) { h.kick = amount; h.kickAge = 0; }
  }

  private particle(layer: LayerId, t: Texture, tint: number, o: Omit<Particle, 's' | 'max' | 'align'> & { align?: boolean }): void {
    const s = this.take(layer, t, tint);
    if (!s) return;
    s.position.set(o.x, o.y);
    s.rotation = this.rnd() * Math.PI;
    s.alpha = 0;
    this.particles.push({ ...o, align: o.align ?? false, s, max: o.life });
  }

  /** Motes of light: rising (grav < 0) or thrown and falling. */
  private motes(x: number, y: number, n: number, o: { speed?: number; spread?: number; lift?: number; life?: number; size?: number; grav?: number; ring?: number; ry?: number } = {}): void {
    const S = this.scale;
    const tints = [this.colors.core, this.colors.gold, whiten(this.colors.gold, 0.5), this.colors.sky];
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const rr = (o.ring ?? 0) * (0.5 + this.rnd() * 0.5);
      const sp = (o.speed ?? 90) * (0.4 + this.rnd() * 0.8) * S;
      const up = (o.lift ?? 60) * (0.6 + this.rnd() * 0.8) * S;
      const sz = (o.size ?? 0.42) * (0.6 + this.rnd() * 0.7);
      this.particle('hot', i % 5 === 4 ? this.tex.spark : this.tex.star, tints[i % 7 === 6 ? 3 : i % 3]!, {
        x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr * (o.ry ?? 1),
        vx: Math.cos(a) * sp * (o.spread ?? 1), vy: Math.sin(a) * sp * 0.5 * (o.spread ?? 1) - up, drag: 0.25, grav: (o.grav ?? -40) * S,
        life: (o.life ?? 900) * (0.7 + this.rnd() * 0.6), from: sz * S, to: sz * 0.25 * S, alpha: 1,
        twinkle: 0.015 + this.rnd() * 0.02, spin: (this.rnd() - 0.5) * 0.01,
      });
    }
  }

  // ── the pillar ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * A column of light. `drop`: its bottom falls from `top` onto `foot` over `move` ms (easing in: it lands hard), holds,
   * then narrows and fades. `rise`: its top shoots up off `foot` to `top`. `w` is its width in px.
   */
  private column(mode: 'drop' | 'rise', x: number, top: number, foot: number, w: number, move: number, hold: number, fade: number, o: { glow?: number; body?: number; head?: boolean } = {}): void {
    const c = this.colors;
    const g = this.look.pillarGlow * (o.glow ?? 1);
    const parts: Pillar['parts'] = [];
    const add = (layer: LayerId, tint: number, wm: number, a: number): void => {
      const s = this.take(layer, this.tex.pillar, tint);
      if (!s) return;
      s.anchor.set(0.5, 1); s.alpha = 0;
      parts.push({ s, w: wm, a });
    };
    add('under', c.gold, 2.2, 0.5 * g);          // a wide soft glow round it
    add('body', c.deep, 1.05, 0.42 * (o.body ?? 1)); // the gold body (normal blend: it reads on the light board)
    add('glow', c.gold, 1, 0.85 * g);             // the gold light
    add('hot', c.core, 0.42, 1);                  // the white core
    let head: Sprite | null = null;
    if (o.head !== false && mode === 'drop') { head = this.take('hot', this.tex.glow, c.core); if (head) head.alpha = 0; }
    this.pillars.push({ parts, head, x, top, foot, mode, width: w, age: 0, move: Math.max(1, move), hold, fade: Math.max(1, fade) });
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * THE INVOKE: a golden halo rings the hero's head (a normal-blend deep-gold ring under an additive light, seen at an
   * angle), a slow sunburst turns behind the portrait, a soft light gathers, motes are drawn in. Held until `pray`.
   */
  startInvoke(x: number, y: number, r: number, durMs: number, k: number): void {
    const c = this.colors, L = this.look, S = this.scale;
    const hy = y - r * 1.02;
    const hs = ((r * 1.25) / RING_PX / S) * L.haloSize;
    if (L.haloSize > 0) {
      this.hold('body', this.tex.ring, c.deep, x, hy, 'invoke', { a: 0.75, g0: hs * 0.4, g1: hs, gMs: durMs * 0.7, back: true, ry: 0.3, inMs: durMs * 0.4 });
      this.hold('hot', this.tex.ring, whiten(c.gold, 0.35), x, hy, 'invoke', { a: 1, g0: hs * 0.4, g1: hs, gMs: durMs * 0.7, back: true, ry: 0.3, inMs: durMs * 0.4, pulse: 0.12 });
      this.hold('under', this.tex.glow, c.gold, x, hy, 'invoke', { a: 0.55, g0: hs * 0.6, g1: hs * 1.25, gMs: durMs, ry: 0.4, inMs: durMs * 0.5 });
    }
    if (L.sunburst > 0) {
      const rs = ((r * 3.1) / 256 / S) * L.sunburst * (1 + 0.15 * k);
      this.hold('ground', this.tex.rays, c.deep, x, y, 'invoke', { a: 0.34, g0: rs * 0.55, g1: rs, gMs: durMs, spin: 0.00045, inMs: durMs * 0.6 });
      this.hold('under', this.tex.rays, c.gold, x, y, 'invoke', { a: 0.75, g0: rs * 0.55, g1: rs, gMs: durMs, spin: 0.00045, inMs: durMs * 0.6, pulse: 0.1 });
    }
    this.hold('under', this.tex.glow, c.gold, x, y, 'invoke', { a: 0.4, g0: ((r * 1.6) / GLOW_PX / S), g1: ((r * 2.6) / GLOW_PX / S), gMs: durMs, inMs: durMs * 0.8 });
    this.invokeAcc = { x, y, r, left: durMs, acc: 0 };
  }

  /** The prayer goes up: a beam of light rises off the hero, the halo flares and the invoke releases. */
  pray(x: number, y: number, r: number, k: number): void {
    const c = this.colors, L = this.look, S = this.scale;
    this.invokeAcc = null;
    this.fadeTag('invoke', 380, 0.25);
    if (L.prayBeam > 0) {
      const top = y - Math.max(900 * S, r * 9);
      this.column('rise', x, top, y - r * 0.2, r * 0.9 * L.prayBeam * (1 + 0.2 * k), 170, 60, 360, { head: false, glow: 0.8, body: 0.6 });
    }
    this.tw('hot', this.tex.glow, c.core, x, y - r * 0.2, { dur: 160, from: (r * 1.4) / GLOW_PX / S, to: (r * 2.2) / GLOW_PX / S, a0: 0.55 });
    this.tw('hot', this.tex.ring, whiten(c.gold, 0.3), x, y, { dur: 300, from: (r * 1.1) / RING_PX / S, to: (r * 1.9) / RING_PX / S, a0: 0.8 });
    this.motes(x, y - r * 0.4, 8, { lift: 180, speed: 60, life: 700, ring: r * 0.6 });
  }

  /** THE SIGIL flashes onto the struck portrait: it spins down from big to its size and lands with a flash. */
  startSigil(x: number, y: number, r: number, durMs: number, tier: number): void {
    const c = this.colors, L = this.look, S = this.scale;
    if (L.sigilSize <= 0) return;
    const sz = ((r * 2.5) / SIGIL_PX / S) * L.sigilSize;
    const spin = 0.0011 * L.sigilSpin;
    this.hold('ground', this.tex.hsigil, c.deep, x, y, 'sigil', { a: 0.62, g0: sz * 1.7, g1: sz, gMs: durMs, inMs: durMs * 0.5, spin, rot: 0.6 });
    this.hold('under', this.tex.hsigil, c.gold, x, y, 'sigil', { a: 0.95, g0: sz * 1.7, g1: sz, gMs: durMs, inMs: durMs * 0.5, spin, rot: 0.6, pulse: 0.08 });
    if (tier >= 2) {
      // A counter-turning outer ring for the bigger tiers (the sigil itself escalates).
      this.hold('under', this.tex.ring, c.gold, x, y, 'sigil', { a: 0.7, g0: ((r * 3.6) / RING_PX / S) * L.sigilSize, g1: ((r * 2.9) / RING_PX / S) * L.sigilSize, gMs: durMs, inMs: durMs * 0.6 });
      this.hold('ground', this.tex.hsigil, c.deep, x, y, 'sigil', { a: 0.3, g0: sz * 1.9, g1: sz * 1.3, gMs: durMs, inMs: durMs * 0.6, spin: -spin * 0.7 });
    }
    // The landing flash: a crisp ring snapping in, and a small quick light.
    this.tw('hot', this.tex.ring, whiten(c.gold, 0.5), x, y, { delay: durMs * 0.85, dur: 240, from: ((r * 2.6) / RING_PX / S), to: ((r * 2.1) / RING_PX / S), a0: 0.9, ease: easeOutCubic });
    this.tw('hot', this.tex.glow, c.core, x, y, { delay: durMs * 0.85, dur: 140, from: (r * 1.2) / GLOW_PX / S, to: (r * 1.8) / GLOW_PX / S, a0: 0.35 });
  }

  /** A pillar of light drops out of the sky onto (x, foot) over `dropMs`. */
  dropPillar(x: number, foot: number, r: number, dropMs: number, width: number, size: number): void {
    const top = foot - Math.max(1100 * this.scale, r * 12) * this.look.pillarHeight;
    this.column('drop', x, top, foot, r * 1.05 * width * size, dropMs, 110, 320);
  }

  /** A smite that is not the last (a tick): line work over a small, quick flash. The sigil flares with it. */
  smiteTick(x: number, y: number, r: number, step: number): void {
    const c = this.colors, S = this.scale;
    this.kickTag('sigil', 0.6);
    this.tw('hot', this.tex.glow, c.core, x, y, { dur: 120, from: (r * 1.1) / GLOW_PX / S, to: (r * 1.7) / GLOW_PX / S, a0: 0.5 });
    this.tw('hot', this.tex.ring, whiten(c.gold, 0.4), x, y, { dur: 300, from: (r * 1.2) / RING_PX / S, to: (r * 2.6) / RING_PX / S, a0: 0.85 });
    this.tw('glow', this.tex.rays, c.gold, x, y, { dur: 380, from: (r * 2) / 256 / S, to: (r * 3.2) / 256 / S, a0: 0.6, rot: step * 0.4, spin: 0.0006 });
    this.tw('under', this.tex.ring, c.gold, x, y + r * 0.5, { dur: 360, from: (r * 1.2) / RING_PX / S, to: (r * 2.8) / RING_PX / S, a0: 0.7, ry: this.look.tilt });
    this.motes(x, y, 8, { lift: 140, speed: 120, life: 700, ring: r * 0.5 });
  }

  /**
   * THE SMITE (I-III): the last pillar lands. The first frame is the brightest: a short flash over the portrait, a
   * holy cross gleam, big god rays turning, a crisp ring and a ground ring, rising motes; the sigil flares out, and any
   * seeds planted by the spears erupt with it.
   */
  smite(x: number, y: number, r: number, o: { tier: number; k: number; burst: number; motes: number; flashAlpha: number }): void {
    const c = this.colors, L = this.look, S = this.scale;
    const fs = o.burst;
    const portrait = (r * 2) / GLOW_PX / S;
    this.fadeTag('sigil', 520, 0.35);
    this.tw('hot', this.tex.glow, c.core, x, y, { dur: 110, from: portrait * 1.05, to: portrait * 1.3, a0: 0.62 * o.flashAlpha });
    this.tw('hot', this.tex.glow, c.core, x, y, { dur: 150, from: 1 * fs, to: Math.min(3.4, 2.3 * fs), a0: o.flashAlpha });
    this.tw('under', this.tex.glow, c.gold, x, y, { dur: 420, from: 1.6 * fs, to: Math.min(5.5, 3.6 * fs), a0: 0.45 * o.flashAlpha });
    // The cross gleam: a four-point star, big and quick (the holy signature).
    this.tw('hot', this.tex.star, c.core, x, y, { dur: 300, from: ((r * 3.2) / 48 / S) * fs * 0.8, to: ((r * 4.6) / 48 / S) * fs * 0.8, a0: 0.95, ease: easeOutCubic });
    this.tw('hot', this.tex.star, c.sky, x, y, { dur: 260, from: ((r * 2) / 48 / S) * fs, to: ((r * 3) / 48 / S) * fs, a0: 0.5, rot: Math.PI / 4 });
    if (L.raysSize > 0) {
      const rs = ((r * 3.6) / 256 / S) * L.raysSize * (0.9 + 0.35 * o.k);
      this.tw('glow', this.tex.rays, c.gold, x, y, { dur: 700, from: rs * 0.7, to: rs * 1.25, a0: 0.9, spin: 0.0007, ease: easeOutCubic, outFrom: 0.25 });
      this.tw('ground', this.tex.rays, c.deep, x, y, { dur: 620, from: rs * 0.7, to: rs * 1.2, a0: 0.3, spin: 0.0007, ease: easeOutCubic, outFrom: 0.2 });
    }
    this.tw('hot', this.tex.ring, c.core, x, y, { dur: 320, from: (r * 1) / RING_PX / S, to: ((r * 3.2) / RING_PX / S) * (0.85 + 0.35 * o.k), a0: 1 });
    this.tw('under', this.tex.ring, c.sky, x, y, { dur: 560, from: (r * 1.2) / RING_PX / S, to: ((r * 4.4) / RING_PX / S) * (0.85 + 0.35 * o.k), a0: 0.55 });
    this.tw('under', this.tex.ring, c.gold, x, y + r * 0.55, { dur: 620, from: (r * 1.2) / RING_PX / S, to: ((r * 4) / RING_PX / S) * (0.9 + 0.3 * o.k), a0: 0.85, ry: L.tilt });
    this.tw('ground', this.tex.ring, c.deep, x, y + r * 0.55, { dur: 560, from: (r * 1.1) / RING_PX / S, to: ((r * 3.4) / RING_PX / S), a0: 0.45, ry: L.tilt });
    this.motes(x, y, Math.round(o.motes * 0.6), { lift: 220, speed: 160, life: 1000, ring: r * 0.7, grav: -30 });
    this.motes(x, y, Math.round(o.motes * 0.4), { lift: 60, speed: 320, life: 700, grav: 260, size: 0.36 });
    // The seeds erupt with it (III): each a small pillar and a flare, then they fade.
    for (const h of this.held) {
      if (h.tag !== 'seed' || h.fadeT >= 0 || h.s.texture === this.tex.glow) continue;
      const sx = h.s.position.x, sy = h.s.position.y;
      this.column('rise', sx, sy - r * 2.2, sy, r * 0.42, 90, 60, 360, { glow: 0.9 });
      this.tw('hot', this.tex.glow, c.core, sx, sy, { dur: 150, from: 0.4, to: 1.1, a0: 0.7 });
    }
    this.fadeTag('seed', 480, 0.4);
    // A soft afterglow that lingers a little (line work carries it; this is faint).
    this.tw('under', this.tex.glow, c.gold, x, y, { dur: 900, from: 2 * fs, to: 2.5 * fs, a0: 0.22 });
  }

  /** A spear of light, from high above into the ground at `to`, over `flightMs`. */
  spear(from: Pt, to: Pt, flightMs: number, size: number): void {
    const c = this.colors, S = this.scale;
    const sz = size * this.look.spearSize;
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const glow = this.take('under', this.tex.spear, c.gold);
    const body = this.take('body', this.tex.spear, c.deep);
    const trail = this.take('glow', this.tex.streak, c.gold);
    if (!glow || !body || !trail) { for (const s of [glow, body, trail]) if (s) this.give(s); return; }
    for (const s of [glow, body]) { s.anchor.set(0.97, 0.5); s.rotation = ang; s.alpha = 0; }
    trail.anchor.set(1, 0.5); trail.rotation = ang; trail.alpha = 0;
    glow.scale.set(1.25 * sz * S, 2.2 * sz * S);
    body.scale.set(1 * sz * S, 1 * sz * S);
    trail.scale.set(5 * sz * S, 0.55 * sz * S);
    // A white core rides the body as a separate tween-free sprite: keep it simple, the body's light comes from the glow.
    this.spears.push({ body, glow, trail, from: { ...from }, to: { ...to }, age: 0, dur: Math.max(1, flightMs), size: sz });
  }

  /** A spear thunks in (a tick): a small burst, a ground ring, chips; it plants a glowing SEED rune on the ground. */
  spearHit(to: Pt, r: number, step: number): void {
    const c = this.colors, L = this.look, S = this.scale;
    this.tw('hot', this.tex.glow, c.core, to.x, to.y, { dur: 110, from: 0.4, to: 1.1, a0: 0.8 });
    this.tw('hot', this.tex.star, c.core, to.x, to.y, { dur: 200, from: 0.9, to: 1.6, a0: 0.9, rot: step * 0.3 });
    this.tw('under', this.tex.ring, c.gold, to.x, to.y, { dur: 300, from: 0.15, to: 0.75, a0: 0.9, ry: L.tilt });
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.4, sp = (120 + this.rnd() * 160) * S;
      this.particle('hot', this.tex.chip, i % 2 ? c.gold : c.core, {
        x: to.x, y: to.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.2, grav: 700 * S, life: 380 + this.rnd() * 160,
        from: 0.8 * S, to: 0.4 * S, alpha: 1, twinkle: 0, spin: 0, align: true,
      });
    }
    // The seed: a rune on the ground, glowing (the consecration beginning), until the final smite makes it erupt.
    if (L.seedGlow > 0) {
      const g = this.tex.glyphs[step % this.tex.glyphs.length]!;
      const gs = ((r * 0.55) / 48 / S);
      this.hold('ground', g, c.deep, to.x, to.y, 'seed', { a: 0.7, g0: gs * 1.8, g1: gs, gMs: 220, back: true, tilt: L.tilt, rot: step * 0.9, inMs: 60 });
      this.hold('under', g, c.gold, to.x, to.y, 'seed', { a: 0.95 * Math.min(1, L.seedGlow), g0: gs * 1.8, g1: gs, gMs: 220, back: true, tilt: L.tilt, rot: step * 0.9, inMs: 60, pulse: 0.2 });
      this.hold('under', this.tex.glow, c.gold, to.x, to.y, 'seed', { a: 0.45 * L.seedGlow, g1: ((r * 0.9) / GLOW_PX / S), ry: L.tilt, inMs: 160, pulse: 0.25 });
    }
    this.kickTag('sigil', 0.3);
  }

  /**
   * TIER IV: the heaven opens over the middle of the board and THE SWORD appears, point down. `tip(age)` is the tip's
   * height `age` ms after this call (pure: `swordTipY`); `fallAge` / `slamAge` are when it starts falling and bites.
   */
  summonSword(x: number, len: number, tip: (ageMs: number) => number, fallAge: number, slamAge: number, top: number): void {
    if (this.sword) return;
    const c = this.colors, L = this.look, S = this.scale;
    const glow = this.take('under', this.tex.swordGlow, c.gold);
    const beam = this.take('under', this.tex.pillar, c.gold);
    const trail = this.take('glow', this.tex.pillar, c.gold);
    const body = this.take('body', this.tex.swordBody, 0xffffff);
    const hot = this.take('hot', this.tex.swordHot, c.core);
    const glint = this.take('hot', this.tex.star, c.core);
    if (!glow || !beam || !trail || !body || !hot || !glint) { for (const s of [glow, beam, trail, body, hot, glint]) if (s) this.give(s); return; }
    const ay = SWORD_TIP_Y / SWORD_H;
    const k = len / SWORD_LEN_PX;
    for (const s of [glow, body, hot]) { s.anchor.set(0.5, ay); s.scale.set(k); s.alpha = 0; }
    beam.anchor.set(0.5, 1); beam.alpha = 0; trail.anchor.set(0.5, 1); trail.alpha = 0; glint.alpha = 0;
    this.sword = { glow, body, hot, beam, trail, glint, x, len, tip, age: 0, fallAge, slamAge, dissolveT: -1, dissolveMs: 1, moteAcc: 0 };
    // The heaven opening above it: god rays and a soft light high over the sword, held until the slam.
    const hy = Math.max(top, tip(0) - len * 1.05);
    const rs = (len * 1.2) / 256 / S;
    this.hold('under', this.tex.rays, c.gold, x, hy, 'heaven', { a: 0.7 * L.swordGlow, g0: rs * 0.4, g1: rs, gMs: fallAge, inMs: 260, spin: 0.0004, ry: 0.55 });
    this.hold('under', this.tex.glow, c.core, x, hy, 'heaven', { a: 0.6, g0: rs * 0.8, g1: rs * 2.2, gMs: fallAge, inMs: 260, ry: 0.5 });
    this.hold('ground', this.tex.rays, c.deep, x, hy, 'heaven', { a: 0.22, g0: rs * 0.4, g1: rs, gMs: fallAge, inMs: 260, spin: 0.0004, ry: 0.55 });
  }

  /**
   * THE SLAM: the sword bites into the board. A short flash at the tip, a shockwave on the ground and a round one, dust
   * rolling out, light debris flung up, radiant cracks drawn out from the tip.
   */
  slam(x: number, y: number, r: number, o: { dust: number; debris: number; shock: number; cracks: number; flashAlpha: number }): void {
    const c = this.colors, L = this.look, S = this.scale;
    this.fadeTag('heaven', 260, 0.2);
    this.tw('hot', this.tex.glow, c.core, x, y, { dur: 130, from: 1.2, to: 2.6, a0: o.flashAlpha });
    this.tw('under', this.tex.glow, c.gold, x, y, { dur: 460, from: 2, to: 4.4, a0: 0.55, ry: 0.6 });
    this.tw('hot', this.tex.star, c.core, x, y, { dur: 260, from: 3, to: 5.2, a0: 0.9 });
    const sw = o.shock;
    if (sw > 0) {
      this.tw('hot', this.tex.ring, c.core, x, y, { dur: 360, from: 0.4, to: 4.2 * sw, a0: 1, ry: L.tilt, ease: easeOutCubic });
      this.tw('under', this.tex.ring, c.gold, x, y, { dur: 620, from: 0.6, to: 6.4 * sw, a0: 0.8, ry: L.tilt, ease: easeOutCubic });
      this.tw('ground', this.tex.ring, c.deep, x, y, { dur: 560, from: 0.5, to: 5.4 * sw, a0: 0.5, ry: L.tilt, ease: easeOutCubic });
      this.tw('under', this.tex.ring, c.sky, x, y - r * 0.2, { dur: 420, from: 0.4, to: 3.2 * sw, a0: 0.45 });
    }
    // Dust rolling out along the ground (normal blend, warm: it reads on the light board).
    for (let i = 0; i < o.dust; i++) {
      const a = (i / Math.max(1, o.dust)) * Math.PI * 2 + (this.rnd() - 0.5) * 0.4;
      const d0 = 18 * S, sp = (170 + this.rnd() * 130) * S;
      const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp * L.tilt - 30 * S;
      this.tw('body', this.tex.puff, c.dust, x + Math.cos(a) * d0, y + Math.sin(a) * d0 * L.tilt, {
        dur: 760 + this.rnd() * 240, from: 0.7, to: 1.9 + this.rnd() * 0.6, a0: 0.62, ease: easeOutCubic, inMs: 40, vx, vy,
      });
    }
    // Light debris: chips flung up, turning, falling back.
    for (let i = 0; i < o.debris; i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.6, sp = (260 + this.rnd() * 420) * S;
      this.particle(i % 3 === 0 ? 'body' : 'hot', this.tex.chip, i % 3 === 0 ? c.deep : i % 2 ? c.gold : c.core, {
        x: x + (this.rnd() - 0.5) * 20 * S, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.3, grav: 900 * S,
        life: 520 + this.rnd() * 360, from: (0.9 + this.rnd() * 0.8) * S, to: 0.5 * S, alpha: 1, twinkle: 0, spin: 0, align: true,
      });
    }
    this.cracksAt(x, y, o.cracks, r * 2.4);
    this.motes(x, y, 16, { lift: 200, speed: 220, life: 900, ring: 30 * S, ry: L.tilt });
  }

  /** Radiant cracks drawn out from a point along the ground (a deep-gold line with a gold light over it). */
  private cracksAt(x: number, y: number, n: number, reach: number): void {
    const c = this.colors, L = this.look, S = this.scale;
    for (let i = 0; i < n; i++) {
      const th = (i / Math.max(1, n)) * Math.PI * 2 + (this.rnd() - 0.5) * 0.5;
      const len = (reach * (0.6 + this.rnd() * 0.5)) / 128 / S;
      const thick = (0.9 + this.rnd() * 0.5);
      for (const [layer, tint, a] of [['ground', c.deep, 0.75], ['under', c.gold, 0.9]] as [LayerId, number, number][]) {
        const h = this.hold(layer, this.tex.crack, tint, x, y, 'ground', { a, g0: 0, g1: 1, gMs: 200, inMs: 40, tilt: L.tilt, rot: th, ax: 0, ay: 0.5 });
        if (h) { h.ry = thick; h.len = len; }
      }
    }
  }

  /** THE CONSECRATION erupts round the sword: a runic circle on the ground, a gold stain, pillars round its rim. */
  erupt(x: number, y: number, R: number): void {
    const c = this.colors, L = this.look, S = this.scale;
    const sz = (R * 2) / SIGIL_PX / S;
    this.hold('ground', this.tex.glow, c.deep, x, y, 'ground', { a: 0.3, g0: ((R * 0.6) / GLOW_PX / S), g1: ((R * 2.6) / GLOW_PX / S), gMs: 380, tilt: L.tilt, inMs: 120 });
    this.hold('ground', this.tex.hsigil, c.deep, x, y, 'ground', { a: 0.7, g0: sz * 0.25, g1: sz, gMs: 380, back: true, tilt: L.tilt, spin: 0.0005, inMs: 80 });
    this.hold('under', this.tex.hsigil, c.gold, x, y, 'ground', { a: 0.95, g0: sz * 0.25, g1: sz, gMs: 380, back: true, tilt: L.tilt, spin: 0.0005, inMs: 80, pulse: 0.1 });
    this.hold('under', this.tex.glow, c.gold, x, y, 'ground', { a: 0.5, g0: ((R * 0.6) / GLOW_PX / S), g1: ((R * 2.2) / GLOW_PX / S), gMs: 380, tilt: L.tilt, inMs: 120, pulse: 0.15 });
    // Glyphs round the rim, stamped in a ripple, and pillars rising off it.
    const n = 8;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      const gx = x + Math.cos(th) * R * 0.82, gy = y + Math.sin(th) * R * 0.82 * L.tilt;
      const g = this.tex.glyphs[i % this.tex.glyphs.length]!;
      const gs = (R * 0.2) / 48 / S;
      const hh = this.hold('under', g, c.gold, gx, gy, 'ground', { a: 0.95, g0: gs * 2, g1: gs, gMs: 240, back: true, tilt: L.tilt, rot: th + Math.PI / 2, inMs: 60, pulse: 0.2 });
      if (hh) hh.age = -60 - i * 30;
      if (i % 2 === 0) {
        const delay = 80 + i * 30;
        this.tw('glow', this.tex.pillar, c.gold, gx, gy, { delay, dur: 520, from: 0, to: 0, sy0: 0.1, sy1: (R * 0.9) / PILLAR_H / S, sx0: (R * 0.3) / PILLAR_W / S, sx1: (R * 0.12) / PILLAR_W / S, a0: 0.85, ay: 1, ease: easeOutCubic, outFrom: 0.3 });
        this.tw('hot', this.tex.pillar, c.core, gx, gy, { delay, dur: 420, from: 0, to: 0, sy0: 0.1, sy1: (R * 0.75) / PILLAR_H / S, sx0: (R * 0.12) / PILLAR_W / S, sx1: (R * 0.05) / PILLAR_W / S, a0: 0.9, ay: 1, ease: easeOutCubic, outFrom: 0.3 });
      }
    }
  }

  /**
   * The consecration RACES to the struck hero: a band of holy ground grows along the path (a gold body under a light),
   * its front a bright head; runes are stamped as it passes (some with a small pillar), cracks branch off it, motes rise.
   */
  spread(a: Pt, b: Pt, runes: readonly HolyRune[], durMs: number, width: number): void {
    const c = this.colors, S = this.scale;
    const bandBody = this.take('ground', this.tex.beam, c.deep);
    const bandLight = this.take('under', this.tex.beam, c.gold);
    const head = this.take('glow', this.tex.glow, c.gold);
    const headStar = this.take('hot', this.tex.star, c.core);
    if (!bandBody || !bandLight || !head || !headStar) { for (const s of [bandBody, bandLight, head, headStar]) if (s) this.give(s); return; }
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    for (const s of [bandBody, bandLight]) { s.anchor.set(0, 0.5); s.rotation = ang; s.position.set(a.x, a.y); s.alpha = 0; s.scale.set(0, (width / 64)); }
    head.alpha = 0; headStar.alpha = 0;
    void S;
    this.spreadFx = {
      a: { ...a }, ang, len: Math.hypot(b.x - a.x, b.y - a.y), dur: Math.max(1, durMs), age: 0, width, runes: [...runes], stamped: 0,
      bandBody, bandLight, head, headStar, crackAcc: 0, lastD: 0, moteAcc: 0, fadeT: -1, fadeMs: 1,
    };
  }

  /** The consecration gathers under the struck hero: its circle snaps in and brightens, light is drawn in. */
  gather(foot: Pt, r: number, durMs: number): void {
    const c = this.colors, L = this.look, S = this.scale;
    const sz = (r * 2.7) / SIGIL_PX / S;
    this.hold('ground', this.tex.hsigil, c.deep, foot.x, foot.y, 'foe', { a: 0.7, g0: sz * 0.45, g1: sz, gMs: durMs, back: true, tilt: L.tilt, spin: -0.0012, inMs: 60 });
    this.hold('under', this.tex.hsigil, c.gold, foot.x, foot.y, 'foe', { a: 1, g0: sz * 0.45, g1: sz, gMs: durMs, back: true, tilt: L.tilt, spin: -0.0012, inMs: 60, pulse: 0.15 });
    this.hold('under', this.tex.glow, c.gold, foot.x, foot.y, 'foe', { a: 0.55, g0: (r * 1.2) / GLOW_PX / S, g1: (r * 3.2) / GLOW_PX / S, gMs: durMs, tilt: L.tilt, inMs: durMs * 0.6 });
    this.tw('hot', this.tex.ring, whiten(c.gold, 0.4), foot.x, foot.y, { dur: durMs, from: (r * 4.2) / RING_PX / S, to: (r * 2.4) / RING_PX / S, a0: 0.8, ry: L.tilt, ease: easeInOutSine, inMs: 40 });
    this.gatherAcc = { x: foot.x, y: foot.y, r, left: durMs, acc: 0 };
  }

  /**
   * THE ERUPTION (IV, THE blow): holy flames and a pillar of light burst up under the struck hero. The first frame is
   * the brightest; fills are short (the big -N reads through them); the flames, rays and rings carry it after.
   */
  eruptFoe(foot: Pt, d: Pt, r: number, o: { flames: number; flameHeight: number; burst: number; motes: number; flashAlpha: number }): void {
    const c = this.colors, L = this.look, S = this.scale;
    this.gatherAcc = null;
    const fs = o.burst;
    const portrait = (r * 2) / GLOW_PX / S;
    // The big column: it shoots up out of the ground past the portrait.
    this.column('rise', foot.x, foot.y - r * 5.5 * L.pillarHeight, foot.y, r * 1.5, 90, 140, 420, { glow: 1.1 });
    this.tw('hot', this.tex.glow, c.core, d.x, d.y, { dur: 130, from: portrait * 1.1, to: portrait * 1.45, a0: 0.7 * o.flashAlpha });
    this.tw('hot', this.tex.glow, c.core, foot.x, foot.y, { dur: 170, from: 1.4 * fs, to: Math.min(5, 3 * fs), a0: o.flashAlpha });
    this.tw('under', this.tex.glow, c.gold, d.x, d.y, { dur: 520, from: 2 * fs, to: Math.min(8, 4.6 * fs), a0: 0.45 * o.flashAlpha });
    this.tw('hot', this.tex.star, c.core, d.x, d.y, { dur: 340, from: ((r * 3.6) / 48 / S), to: ((r * 5.4) / 48 / S), a0: 1, ease: easeOutCubic });
    this.tw('hot', this.tex.star, c.sky, d.x, d.y, { dur: 300, from: ((r * 2.4) / 48 / S), to: ((r * 3.4) / 48 / S), a0: 0.55, rot: Math.PI / 4 });
    const rs = ((r * 4.4) / 256 / S) * L.raysSize;
    if (rs > 0) {
      this.tw('glow', this.tex.rays, c.gold, d.x, d.y, { dur: 900, from: rs * 0.7, to: rs * 1.35, a0: 0.95, spin: 0.0006, ease: easeOutCubic, outFrom: 0.3 });
      this.tw('ground', this.tex.rays, c.deep, d.x, d.y, { dur: 800, from: rs * 0.7, to: rs * 1.3, a0: 0.28, spin: 0.0006, ease: easeOutCubic, outFrom: 0.25 });
    }
    this.tw('hot', this.tex.ring, c.core, foot.x, foot.y, { dur: 380, from: 0.5, to: (r * 5) / RING_PX / S, a0: 1, ry: L.tilt, ease: easeOutCubic });
    this.tw('under', this.tex.ring, c.gold, foot.x, foot.y, { dur: 700, from: 0.6, to: (r * 7.5) / RING_PX / S, a0: 0.8, ry: L.tilt, ease: easeOutCubic });
    this.tw('under', this.tex.ring, c.sky, d.x, d.y, { dur: 560, from: (r * 1.2) / RING_PX / S, to: (r * 5) / RING_PX / S, a0: 0.5 });
    // THE HOLY FLAMES: tongues licking up round the ground ellipse, tallest at the sides (the face stays clear), swaying.
    const n = Math.max(0, Math.round(o.flames));
    const rx = r * 1.3, ry = r * 1.3 * L.tilt;
    for (let i = 0; i < n; i++) {
      const th = (i / Math.max(1, n)) * Math.PI * 2 + 0.2;
      const fx = foot.x + Math.cos(th) * rx, fy = foot.y + Math.sin(th) * ry;
      const side = Math.abs(Math.cos(th));
      const hgt = r * (0.7 + 1.3 * side) * o.flameHeight * L.flameHeight * (0.85 + 0.3 * this.rnd());
      const wid = r * (0.42 + 0.14 * this.rnd());
      const delay = this.rnd() * 110;
      const dur = 700 + this.rnd() * 260;
      const sway = (this.rnd() - 0.5) * 0.25;
      const base = { delay, dur, from: 0, to: 0, ay: 0.95, ease: easeOutBack, outFrom: 0.35, flick: 0.25, spin: 0 } as const;
      this.tw('body', this.tex.flame, c.deep, fx, fy, { ...base, sx0: (wid * 0.6) / 64 / S, sx1: (wid * 1.05) / 64 / S, sy0: 0.05, sy1: (hgt * 1.05) / 128 / S, a0: 0.55, rot: sway });
      this.tw('glow', this.tex.flame, c.gold, fx, fy, { ...base, sx0: (wid * 0.6) / 64 / S, sx1: wid / 64 / S, sy0: 0.05, sy1: hgt / 128 / S, a0: 0.95, rot: sway });
      this.tw('hot', this.tex.flame, c.core, fx, fy, { ...base, sx0: (wid * 0.3) / 64 / S, sx1: (wid * 0.5) / 64 / S, sy0: 0.05, sy1: (hgt * 0.6) / 128 / S, a0: 0.9, rot: sway });
    }
    this.motes(foot.x, foot.y, Math.round(o.motes * 0.6), { lift: 300, speed: 200, life: 1200, ring: r * 1.1, ry: L.tilt, grav: -60 });
    this.motes(d.x, d.y, Math.round(o.motes * 0.4), { lift: 80, speed: 420, life: 800, grav: 320, size: 0.36 });
    this.fadeTag('foe', 900, 0.25);
  }

  /** The consecrated ground fades (after lingering); the path band fades with it. */
  fadeGround(ms: number): void {
    this.fadeTag('ground', ms, 0.08);
    if (this.spreadFx && this.spreadFx.fadeT < 0) { this.spreadFx.fadeT = 0; this.spreadFx.fadeMs = Math.max(1, ms); }
  }

  /** The sword dissolves into light over `ms`. */
  dissolveSword(ms: number): void {
    if (this.sword && this.sword.dissolveT < 0) { this.sword.dissolveT = 0; this.sword.dissolveMs = Math.max(1, ms); }
  }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  private paintFx(q: Fx): void {
    const u = clamp01(q.age / q.dur);
    const e = q.ease(u);
    const S = this.scale;
    const sx = (q.sx0 + (q.sx1 - q.sx0) * e) * S, sy = (q.sy0 + (q.sy1 - q.sy0) * e) * S;
    if (q.tilt > 0) groundTransform(q.s, q.rot, sx, sy, q.tilt);
    else { q.s.scale.set(sx, sy); q.s.rotation = q.rot; }
    let a = q.a0 * (q.inMs > 0 ? clamp01(q.age / q.inMs) : 1);
    if (u > q.outFrom) a *= 1 - (u - q.outFrom) / Math.max(1e-6, 1 - q.outFrom);
    if (q.flick) a *= 1 - q.flick * (0.5 + 0.5 * Math.sin(q.age * 0.045 + q.phase));
    q.s.alpha = Math.max(0, a);
    q.s.position.set(q.x, q.y);
  }

  private paintHeld(h: Held): void {
    const S = this.scale;
    const t = Math.max(0, h.age);
    const u = clamp01(t / h.gMs);
    let g = h.g0 + (h.g1 - h.g0) * (h.back ? easeOutBack(u, 1.6) : easeOutCubic(u));
    let a = h.a * clamp01(t / Math.max(1, h.inMs));
    if (h.pulse) a *= 1 - h.pulse * (0.5 + 0.5 * Math.sin(t * 0.008 + h.phase));
    if (h.kick > 0) { const kk = h.kick * Math.exp(-h.kickAge / 140); a *= 1 + kk; g *= 1 + 0.12 * kk; }
    if (h.fadeT >= 0) { const f = clamp01(h.fadeT / h.fadeMs); a *= 1 - f; g *= 1 + h.flare * easeOutCubic(f); }
    if (h.age < 0) a = 0;
    const len = h.len;
    const sx = (len !== undefined ? len * g : g) * S, sy = (len !== undefined ? h.ry : g * h.ry) * S;
    if (h.tilt > 0) groundTransform(h.s, h.rot, sx, sy, h.tilt);
    else { h.s.scale.set(sx, sy); h.s.rotation = h.rot; }
    h.s.alpha = Math.max(0, Math.min(1, a));
  }

  /** Advance by `dtMs` (sequence ms; the runner applies the speed). */
  update(dtMs: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(100, dtMs));
    const sec = dt / 1000;
    const S = this.scale;
    const c = this.colors;

    if (this.warm.length) {
      this.warmLeft -= Math.max(dt, 16);
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; }
    }

    // The invoke / gather draw light IN.
    for (const acc of [this.invokeAcc, this.gatherAcc]) {
      if (!acc) continue;
      acc.acc += dt * 0.03;
      while (acc.acc >= 1) {
        acc.acc -= 1;
        const a = this.rnd() * Math.PI * 2;
        const rr = acc.r * (1.8 + this.rnd() * 0.8);
        const life = 260 + this.rnd() * 90;
        const sp = rr / (life / 1000);
        this.particle('hot', this.tex.star, this.rnd() < 0.5 ? c.gold : c.core, {
          x: acc.x + Math.cos(a) * rr, y: acc.y + Math.sin(a) * rr, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp,
          drag: 1, grav: 0, life, from: 0.4 * S, to: 0.15 * S, alpha: 1, twinkle: 0, spin: 0.01,
        });
      }
    }

    // Pillars.
    for (let i = this.pillars.length - 1; i >= 0; i--) {
      const p = this.pillars[i]!;
      p.age += dt;
      const u = clamp01(p.age / p.move);
      const after = p.age - p.move;
      let bottom = p.foot, top = p.top;
      if (p.mode === 'drop') bottom = p.top + (p.foot - p.top) * easeInQuad(u);
      else top = p.foot + (p.top - p.foot) * easeOutCubic(u);
      const fadeU = after > p.hold ? clamp01((after - p.hold) / p.fade) : 0;
      if (fadeU >= 1) {
        for (const pt of p.parts) this.give(pt.s);
        if (p.head) this.give(p.head);
        this.pillars.splice(i, 1);
        continue;
      }
      const narrow = 1 - 0.7 * easeOutCubic(fadeU);
      const bright = after >= 0 && after < 120 ? 1 + 0.35 * (1 - after / 120) : 1;
      const H = Math.max(1, bottom - top);
      for (const pt of p.parts) {
        pt.s.position.set(p.x, bottom);
        pt.s.scale.set(((pt.w * p.width) / PILLAR_W) * narrow, H / PILLAR_H);
        pt.s.alpha = Math.min(1, pt.a * clamp01(p.age / 40) * (1 - fadeU) * bright);
      }
      if (p.head) {
        p.head.position.set(p.x, bottom);
        const hs = (p.width * 1.6) / GLOW_PX;
        p.head.scale.set(hs, hs * 0.8);
        p.head.alpha = after < 0 ? 0.9 * clamp01(p.age / 40) : Math.max(0, 0.9 * (1 - after / 90));
      }
    }

    // Spears.
    for (let i = this.spears.length - 1; i >= 0; i--) {
      const sp = this.spears[i]!;
      sp.age += dt;
      const u = clamp01(sp.age / sp.dur);
      const e = 0.35 * u + 0.65 * u * u;
      const bite = sp.age > sp.dur ? Math.min(1, (sp.age - sp.dur) / 50) * 10 * S : 0;
      const ang = sp.body.rotation;
      const x = sp.from.x + (sp.to.x - sp.from.x) * e + Math.cos(ang) * bite;
      const y = sp.from.y + (sp.to.y - sp.from.y) * e + Math.sin(ang) * bite;
      const stuck = sp.age > sp.dur ? clamp01((sp.age - sp.dur) / 260) : 0;
      if (stuck >= 1) { for (const s of [sp.body, sp.glow, sp.trail]) this.give(s); this.spears.splice(i, 1); continue; }
      const inA = clamp01(sp.age / 50);
      for (const s of [sp.body, sp.glow]) s.position.set(x, y);
      sp.body.alpha = 0.95 * inA * (1 - stuck);
      sp.glow.alpha = 0.9 * inA * (1 - stuck);
      sp.trail.position.set(x - Math.cos(ang) * 30 * S * sp.size, y - Math.sin(ang) * 30 * S * sp.size);
      sp.trail.alpha = sp.age < sp.dur ? 0.8 * inA : Math.max(0, 0.8 * (1 - (sp.age - sp.dur) / 80));
    }

    // The sword.
    const sw = this.sword;
    if (sw) {
      sw.age += dt;
      const y = sw.tip(sw.age);
      const k = sw.len / SWORD_LEN_PX;
      const inA = clamp01(sw.age / 220);
      let bodyA = inA, hotA = 0.55 * inA, glowA = 0.85 * inA * this.look.swordGlow, sx = k, sy = k;
      const slammed = sw.age >= sw.slamAge;
      if (slammed) {
        const since = sw.age - sw.slamAge;
        hotA = 0.55 + 0.45 * Math.exp(-since / 160);
        glowA = (0.8 + 0.35 * Math.exp(-since / 200)) * this.look.swordGlow * (1 + 0.08 * Math.sin(sw.age * 0.012));
      }
      if (sw.dissolveT >= 0) {
        sw.dissolveT += dt;
        const f = clamp01(sw.dissolveT / sw.dissolveMs);
        bodyA *= 1 - easeOutCubic(f);
        hotA = (0.6 + 0.4 * Math.sin(Math.PI * Math.min(1, f * 1.6))) * (1 - f);
        glowA *= 1 - f * f;
        sx = k * (1 - 0.18 * f); sy = k * (1 + 0.05 * f);
        // Motes lift off the blade as it goes.
        sw.moteAcc += dt * 0.09 * (1 - f);
        while (sw.moteAcc >= 1) {
          sw.moteAcc -= 1;
          const along = this.rnd() * sw.len * 0.92;
          const hw = (sw.len * 0.05) * (this.rnd() - 0.5);
          this.particle('hot', this.tex.star, this.rnd() < 0.6 ? c.gold : c.core, {
            x: sw.x + hw, y: y - along, vx: (this.rnd() - 0.5) * 30 * S, vy: -(40 + this.rnd() * 60) * S, drag: 0.5, grav: -30 * S,
            life: 600 + this.rnd() * 400, from: (0.35 + this.rnd() * 0.2) * S, to: 0.08 * S, alpha: 1, twinkle: 0.02, spin: 0.004,
          });
        }
        if (f >= 1) { for (const s of [sw.glow, sw.body, sw.hot, sw.beam, sw.trail, sw.glint]) this.give(s); this.sword = null; }
      }
      if (this.sword) {
        for (const s of [sw.glow, sw.body, sw.hot]) { s.position.set(sw.x, y); s.scale.set(sx, sy); }
        sw.glow.scale.set(sx * 1.02, sy * 1.01);
        sw.body.alpha = bodyA; sw.hot.alpha = Math.max(0, Math.min(1, hotA)); sw.glow.alpha = Math.max(0, Math.min(1, glowA));
        // The beam it descends in: a wide soft column from the sky onto it, until it bites.
        const top = y - sw.len * 3;
        sw.beam.position.set(sw.x, y - sw.len * 0.15);
        sw.beam.scale.set((sw.len * 0.55) / PILLAR_W, Math.max(1, (y - sw.len * 0.15) - top) / PILLAR_H);
        sw.beam.alpha = slammed ? Math.max(0, 0.45 * (1 - (sw.age - sw.slamAge) / 240)) : 0.45 * inA;
        // The fall's streak: a column of light trailing up from the pommel, only while it plunges.
        const falling = sw.age >= sw.fallAge && !slammed;
        const fu = falling ? clamp01((sw.age - sw.fallAge) / Math.max(1, sw.slamAge - sw.fallAge)) : 0;
        sw.trail.position.set(sw.x, y - sw.len * 0.7);
        sw.trail.scale.set((sw.len * 0.14) / PILLAR_W, (sw.len * (0.4 + 1.2 * fu)) / PILLAR_H);
        sw.trail.alpha = falling ? 0.75 * fu : Math.max(0, sw.trail.alpha - dt / 120);
        // A glint runs down the blade through the hang (guard to point), then rides the tip as it falls.
        const g0 = 140, g1 = Math.max(g0 + 1, sw.fallAge - 60);
        if (sw.age >= g0 && sw.age < g1) {
          const gu = (sw.age - g0) / (g1 - g0);
          sw.glint.position.set(sw.x, y - sw.len * SWORD_GUARD_FROM_TIP * (1 - easeInOutSine(gu)));
          const gs = (sw.len * 0.14) / 48;
          sw.glint.scale.set(gs * (0.8 + 0.4 * Math.sin(gu * Math.PI)));
          sw.glint.rotation = gu * 1.2;
          sw.glint.alpha = Math.sin(gu * Math.PI);
        } else sw.glint.alpha = 0;
      }
    }

    // The consecration's race.
    const sp = this.spreadFx;
    if (sp) {
      sp.age += dt;
      const x = clamp01(sp.age / sp.dur);
      const u = 0.45 * x + 0.55 * (x * x * (3 - 2 * x));
      const dist = sp.len * u;
      const fade = sp.fadeT >= 0 ? clamp01((sp.fadeT += dt) / sp.fadeMs) : 0;
      sp.bandBody.scale.set(dist / 64, (sp.width * 0.9) / 64); sp.bandBody.alpha = 0.5 * (1 - fade) * clamp01(sp.age / 60);
      sp.bandLight.scale.set(dist / 64, (sp.width * 1.3) / 64); sp.bandLight.alpha = (0.85 + 0.1 * Math.sin(sp.age * 0.01)) * (1 - fade) * clamp01(sp.age / 60);
      const hx = sp.a.x + Math.cos(sp.ang) * dist, hy = sp.a.y + Math.sin(sp.ang) * dist;
      const running = x < 1;
      sp.head.position.set(hx, hy); sp.head.scale.set((sp.width * 3) / GLOW_PX, (sp.width * 1.8) / GLOW_PX);
      sp.head.alpha = running ? 0.9 : Math.max(0, sp.head.alpha - dt / 120);
      sp.headStar.position.set(hx, hy); sp.headStar.scale.set((sp.width * 1.6) / 48); sp.headStar.rotation += dt * 0.01;
      sp.headStar.alpha = running ? 0.85 : Math.max(0, sp.headStar.alpha - dt / 120);
      // Stamp the runes the front has passed.
      while (sp.stamped < sp.runes.length && sp.runes[sp.stamped]!.u <= u + 1e-6) this.stampRune(sp.runes[sp.stamped++]!, sp.width);
      // Cracks branching off the path every ~110 px, and motes rising at the front.
      if (running) {
        sp.crackAcc += dist - sp.lastD;
        while (sp.crackAcc > 110 * S) {
          sp.crackAcc -= 110 * S;
          const side = this.rnd() < 0.5 ? -1 : 1;
          const th = sp.ang + side * (0.7 + this.rnd() * 0.5);
          const len = (sp.width * (1.4 + this.rnd())) / 128 / S;
          for (const [layer, tint, a] of [['ground', c.deep, 0.7], ['under', c.gold, 0.85]] as [LayerId, number, number][]) {
            const h = this.hold(layer, this.tex.crack, tint, hx, hy, 'ground', { a, g0: 0, g1: 1, gMs: 160, inMs: 30, tilt: 1, rot: th, ax: 0, ay: 0.5 });
            if (h) { h.ry = 0.8; h.len = len; }
          }
        }
        sp.moteAcc += dt * 0.12;
        while (sp.moteAcc >= 1) {
          sp.moteAcc -= 1;
          this.particle('hot', this.tex.star, this.rnd() < 0.5 ? c.gold : c.core, {
            x: hx + (this.rnd() - 0.5) * sp.width, y: hy + (this.rnd() - 0.5) * sp.width * 0.5, vx: (this.rnd() - 0.5) * 30 * S, vy: -(90 + this.rnd() * 110) * S,
            drag: 0.4, grav: -30 * S, life: 700 + this.rnd() * 400, from: (0.35 + this.rnd() * 0.25) * S, to: 0.08 * S, alpha: 1, twinkle: 0.02, spin: 0.004,
          });
        }
      }
      sp.lastD = dist;
      if (fade >= 1) { for (const s of [sp.bandBody, sp.bandLight, sp.head, sp.headStar]) this.give(s); this.spreadFx = null; }
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= dt; if (q.delay > 0) { q.s.alpha = 0; continue; } }
      q.age += dt;
      q.rot += q.spin * dt;
      q.x += q.vx * sec; q.y += q.vy * sec;
      q.vx *= Math.pow(0.12, sec); q.vy *= Math.pow(0.12, sec);
      this.paintFx(q);
      if (q.age >= q.dur) { this.give(q.s); this.fx.splice(i, 1); }
    }

    for (let i = this.held.length - 1; i >= 0; i--) {
      const h = this.held[i]!;
      h.age += dt;
      h.rot += h.spin * dt;
      if (h.kick > 0) { h.kickAge += dt; if (h.kickAge > 600) h.kick = 0; }
      if (h.fadeT >= 0) h.fadeT += dt;
      this.paintHeld(h);
      if (h.fadeT >= h.fadeMs && h.fadeT >= 0) { this.give(h.s); this.held.splice(i, 1); }
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
      p.s.position.set(p.x, p.y);
      if (p.align) { p.s.rotation = Math.atan2(p.vy, p.vx); p.s.scale.set(sc * 1.6, sc * 0.7); } else { p.s.scale.set(sc); if (p.spin) p.s.rotation += p.spin * dt; }
      const tw = p.twinkle ? 0.55 + 0.45 * Math.sin((p.max - p.life) * p.twinkle * 6) : 1;
      p.s.alpha = p.alpha * Math.min(1, (p.max - p.life) / 40) * (1 - t * t) * tw;
    }

    return this.used > this.warm.length;
  }

  /** The front passes a rune: it pops onto the ground and stays (some with a small pillar and a flare). */
  private stampRune(rn: HolyRune, width: number): void {
    const c = this.colors, L = this.look, S = this.scale;
    const g = this.tex.glyphs[rn.kind % this.tex.glyphs.length]!;
    const gs = (width * 0.62) / 48 / S;
    this.hold('ground', g, c.deep, rn.at.x, rn.at.y, 'ground', { a: 0.75, g0: gs * 2, g1: gs, gMs: 220, back: true, tilt: L.tilt, rot: rn.rot, inMs: 40 });
    this.hold('under', g, c.gold, rn.at.x, rn.at.y, 'ground', { a: 1, g0: gs * 2, g1: gs, gMs: 220, back: true, tilt: L.tilt, rot: rn.rot, inMs: 40, pulse: 0.2 });
    this.tw('hot', this.tex.glow, c.core, rn.at.x, rn.at.y, { dur: 160, from: (width * 0.4) / GLOW_PX / S, to: (width * 1.2) / GLOW_PX / S, a0: 0.6 });
    if (rn.pillar) this.column('rise', rn.at.x, rn.at.y - width * 2.6, rn.at.y, width * 0.5, 110, 60, 320, { glow: 0.85 });
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const q of this.fx) this.give(q.s);
    for (const h of this.held) this.give(h.s);
    for (const p of this.particles) this.give(p.s);
    for (const p of this.pillars) { for (const pt of p.parts) this.give(pt.s); if (p.head) this.give(p.head); }
    for (const sp of this.spears) for (const s of [sp.body, sp.glow, sp.trail]) this.give(s);
    if (this.sword) for (const s of [this.sword.glow, this.sword.body, this.sword.hot, this.sword.beam, this.sword.trail, this.sword.glint]) this.give(s);
    if (this.spreadFx) for (const s of [this.spreadFx.bandBody, this.spreadFx.bandLight, this.spreadFx.head, this.spreadFx.headStar]) this.give(s);
    for (const s of this.warm) this.give(s);
    this.fx = []; this.held = []; this.particles = []; this.pillars = []; this.spears = []; this.sword = null; this.spreadFx = null;
    this.warm = []; this.invokeAcc = null; this.gatherAcc = null;
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const [id] of LAYERS) {
      this.free[id].length = 0;
      this.layers[id].removeChildren().forEach((ch) => ch.destroy());
    }
    this.root.removeChildren().forEach((ch) => ch.destroy());
    this.root.destroy();
  }
}
