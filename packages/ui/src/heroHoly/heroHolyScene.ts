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
import { clamp01, easeInOutSine, easeOutBack, easeOutCubic, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';
import { KO_CYAN, KO_LILAC, KO_MAGENTA, KO_PRISM } from '../heroAttack/knockout';
import type { HolyRune } from './heroHolyConfig';
import { SWORD_H, SWORD_LEN_PX, SWORD_TIP_Y, WAVE_EDGE_X } from './heroHolyTextures';

export interface HeroHolyTextures extends HeroArcanaTextures {
  swordGlow: Texture; swordBody: Texture; swordHot: Texture;
  hsigil: Texture; rays: Texture; pillar: Texture; flame: Texture; spear: Texture; crack: Texture; puff: Texture; chip: Texture;
  /** The flat blast: a crescent sheet of light and its leading edge (pointing +X; anchor at WAVE_EDGE_X). */
  waveBody: Texture; waveEdge: Texture;
  glyphs: Texture[];
}

export interface HolyColors { core: number; gold: number; deep: number; sky: number; side: number; dust: number }

export interface HolyLook {
  haloSize: number; sunburst: number; prayBeam: number;
  sigilSize: number; sigilSpin: number;
  pillarGlow: number; pillarHeight: number; raysSize: number;
  spearSize: number; seedGlow: number;
  swordGlow: number;
  pathWidth: number; flameHeight: number;
}

/**
 * TIER V's PINK + GOLD WAVE (owner 2026-10-02: "for consecration -> make the wave that comes out pink + gold instead of
 * just gold"): on a knockout the release, the flat blast, the surge and the eruption interleave hot pink and rose with
 * the gold, so the wave clearly reads pink AND gold. The Huge tier never sets it.
 */
export const HOLY_KO_PINK = 0xff4fa3;
export const HOLY_KO_ROSE = 0xff8fc7;
export const HOLY_KO_GOLD = 0xffd36b;

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
 * Lay a sprite FLAT on the board (owner 2026-09-29: "i want this to be flat and not faux-3d"): scaled (sx, sy) in its own
 * frame and turned by `th` in the screen plane. No perspective squash, no skew: every ring, sigil, rune and crack is a
 * top-down shape on the flat board. Pure transform (no paint).
 */
export function flatTransform(s: Sprite, th: number, sx: number, sy: number): void {
  s.rotation = th;
  s.skew.set(0, 0);
  s.scale.set(sx, sy);
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

/**
 * One sword of the Tier IV barrage: it flies from `from` to `tip` over `flight` ms (accelerating), then stays PLANTED
 * (pointing at the centre) until the implosion pulls it into the centre (`implodeT` counts up over `implodeMs`).
 */
interface Sword {
  glow: Sprite; body: Sprite; hot: Sprite; trail: Sprite; trailCore: Sprite;
  from: Pt; tip: Pt; centre: Pt; rot: number; len: number; age: number; flight: number;
  implodeT: number; implodeMs: number;
}

/** One segment of a radiant crack: a deep-gold line, a gold light over it and a white-hot core, drawn out as the surge passes. */
interface CrackSeg { a: Pt; len: number; u0: number; u1: number; w: number; parts: { s: Sprite; w: number; a: number }[] }

/** THE FLAT BLAST: a crescent sheet of light lying on the ground (four layers), built at the impact, then flown. */
interface Wave {
  parts: { s: Sprite; a: number; depth: number; width: number }[];
  x: number; y: number; th: number; age: number; build: number; flying: boolean; spent: number; size: number;
}

interface Spread {
  a: Pt; ang: number; len: number; dur: number; age: number; width: number; runes: HolyRune[]; stamped: number;
  bandBody: Sprite; bandLight: Sprite; head: Sprite;
  segs: CrackSeg[]; forkAcc: number; lastD: number; moteAcc: number; dustAcc: number; fadeT: number; fadeMs: number;
  /** How far along the path the blast already sat when it was fired (it waits there until the front reaches it). */
  waveD0: number;
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
  private swords: Sword[] = [];
  private hub: { x: number; y: number; r: number; hits: number } | null = null;
  private spreadFx: Spread | null = null;
  private wave: Wave | null = null;
  private gatherAcc: { x: number; y: number; r: number; left: number; acc: number } | null = null;
  private invokeAcc: { x: number; y: number; r: number; left: number; acc: number } | null = null;
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private destroyed = false;
  private readonly rnd: () => number;

  private readonly colors: HolyColors;
  /** Tier V: the wave rolls out pink + gold (`setKoWave`). */
  private koWave = false;

  constructor(private readonly tex: HeroHolyTextures, colors: HolyColors, private readonly look: HolyLook, private readonly scale = 1, seed = 1) {
    // Gold AND white, never lemon (owner 2026-09-28: "less yellow and more gold + white"): the additive light is the
    // gold drawn a third of the way to the warm white, so it blooms pale gold; the normal-blend bodies keep the deep gold.
    this.colors = { ...colors, gold: mixColor(colors.gold, colors.core, 0.3) };
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
      t.flame, t.spear, t.crack, t.puff, t.chip, t.waveBody, t.waveEdge, ...t.glyphs]) {
      const s = this.take('hot', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
  }

  /** Tier V: the release, the flat blast, the surge and the eruption interleave pink with the gold. */
  setKoWave(on: boolean): void { this.koWave = on; }
  /** The wave's gold, or (Tier V) pink and gold alternating by `i` (even = pink, odd = gold). */
  private pg(i: number, gold: number): number { return this.koWave ? (i % 2 === 0 ? HOLY_KO_PINK : HOLY_KO_GOLD) : gold; }

  get liveSprites(): number { return this.used - this.warm.length; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) n += this.layers[id].children.length; return n; }
  get hasSword(): boolean { return this.swords.length > 0; }
  /** How many swords are in play (flying or planted). */
  get liveSwords(): number { return this.swords.length; }
  /** How many swords have landed and stay planted. */
  get plantedSwords(): number { return this.swords.filter((w) => w.age >= w.flight && w.implodeT < 0).length; }
  get spreading(): boolean { return this.spreadFx !== null && this.spreadFx.age < this.spreadFx.dur; }
  /** The flat blast (null = none): where it is and whether it has been fired. Exposed for tests and the capture rig. */
  get blast(): { x: number; y: number; flying: boolean } | null { return this.wave ? { x: this.wave.x, y: this.wave.y, flying: this.wave.flying } : null; }
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
        x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr,
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
    const hy = y;
    const hs = ((r * 2.5) / RING_PX / S) * L.haloSize;
    if (L.haloSize > 0) {
      this.hold('body', this.tex.ring, c.deep, x, hy, 'invoke', { a: 0.75, g0: hs * 0.4, g1: hs, gMs: durMs * 0.7, back: true, inMs: durMs * 0.4 });
      this.hold('hot', this.tex.ring, whiten(c.gold, 0.35), x, hy, 'invoke', { a: 1, g0: hs * 0.4, g1: hs, gMs: durMs * 0.7, back: true, inMs: durMs * 0.4, pulse: 0.12 });
      this.hold('under', this.tex.glow, c.gold, x, hy, 'invoke', { a: 0.3, g0: hs * 0.6, g1: hs * 1.1, gMs: durMs, inMs: durMs * 0.5 });
    }
    if (L.sunburst > 0) {
      const rs = ((r * 3.6) / 256 / S) * L.sunburst * (1 + 0.15 * k);
      this.hold('ground', this.tex.rays, c.deep, x, y, 'invoke', { a: 0.2, g0: rs * 0.55, g1: rs, gMs: durMs, spin: 0.00045, inMs: durMs * 0.6 });
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

  /**
   * A pillar of light drops out of the sky onto (x, foot) over `dropMs`, from just above the top of the frame (`top`),
   * so all of its drop is seen even onto a hero at the top edge.
   */
  dropPillar(x: number, foot: number, r: number, dropMs: number, width: number, size: number, top: number): void {
    const from = Math.min(foot - r * 2.5, top - 30 * this.scale, foot - Math.max(1100 * this.scale, r * 12) * (this.look.pillarHeight - 1));
    this.column('drop', x, from, foot, r * 1.05 * width * size, dropMs, 110, 320);
  }

  /** A smite that is not the last (a tick): line work over a small, quick flash. The sigil flares with it. */
  smiteTick(x: number, y: number, r: number, step: number): void {
    const c = this.colors, S = this.scale;
    this.kickTag('sigil', 0.6);
    this.tw('hot', this.tex.glow, c.core, x, y, { dur: 120, from: (r * 1.1) / GLOW_PX / S, to: (r * 1.7) / GLOW_PX / S, a0: 0.5 });
    this.tw('hot', this.tex.ring, whiten(c.gold, 0.4), x, y, { dur: 300, from: (r * 1.2) / RING_PX / S, to: (r * 2.6) / RING_PX / S, a0: 0.85 });
    this.tw('glow', this.tex.rays, c.gold, x, y, { dur: 380, from: (r * 2) / 256 / S, to: (r * 3.2) / 256 / S, a0: 0.6, rot: step * 0.4, spin: 0.0006 });
    this.tw('under', this.tex.ring, c.gold, x, y, { dur: 360, from: (r * 1.2) / RING_PX / S, to: (r * 2.8) / RING_PX / S, a0: 0.7, ry: 1 });
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
    this.tw('under', this.tex.ring, c.gold, x, y, { dur: 620, from: (r * 1.2) / RING_PX / S, to: ((r * 4) / RING_PX / S) * (0.9 + 0.3 * o.k), a0: 0.85 });
    this.tw('ground', this.tex.ring, c.deep, x, y, { dur: 560, from: (r * 1.1) / RING_PX / S, to: ((r * 3.4) / RING_PX / S), a0: 0.45 });
    this.motes(x, y, Math.round(o.motes * 0.6), { lift: 220, speed: 160, life: 1000, ring: r * 0.7, grav: -30 });
    this.motes(x, y, Math.round(o.motes * 0.4), { lift: 60, speed: 320, life: 700, grav: 260, size: 0.36 });
    // The seeds erupt with it (III): each a small pillar and a flare, then they fade.
    for (const h of this.held) {
      if (h.tag !== 'seed' || h.fadeT >= 0 || h.s.blendMode !== 'add' || !this.tex.glyphs.includes(h.s.texture)) continue;
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
    this.tw('under', this.tex.ring, c.gold, to.x, to.y, { dur: 300, from: 0.15, to: 0.75, a0: 0.9 });
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
      this.hold('ground', g, c.deep, to.x, to.y, 'seed', { a: 0.7, g0: gs * 1.8, g1: gs, gMs: 220, back: true, tilt: 1, rot: step * 0.9, inMs: 60 });
      this.hold('under', g, c.gold, to.x, to.y, 'seed', { a: 0.95 * Math.min(1, L.seedGlow), g0: gs * 1.8, g1: gs, gMs: 220, back: true, tilt: 1, rot: step * 0.9, inMs: 60, pulse: 0.2 });
      this.hold('under', this.tex.glow, c.gold, to.x, to.y, 'seed', { a: 0.45 * L.seedGlow, g1: ((r * 0.9) / GLOW_PX / S), inMs: 160, pulse: 0.25 });
    }
    // Small radiant cracks round the seed: the ground starting to break with holy light (the language of Tier IV).
    for (let i = 0; i < 3; i++) {
      const th = step * 1.3 + (i / 3) * Math.PI * 2 + (this.rnd() - 0.5) * 0.6;
      const len = (r * (0.35 + this.rnd() * 0.25)) / 128 / S;
      for (const [layer, tint, a] of [['ground', c.deep, 0.7], ['under', c.gold, 0.8]] as [LayerId, number, number][]) {
        const h = this.hold(layer, this.tex.crack, tint, to.x, to.y, 'seed', { a, g0: 0, g1: 1, gMs: 160, inMs: 20, tilt: 1, rot: th, ax: 0, ay: 0.5 });
        if (h) { h.ry = 0.55; h.len = len; }
      }
    }
    this.kickTag('sigil', 0.3);
  }

  /**
   * TIER IV (owner 2026-09-29: "have 6 swords fly in from different directions starting with 1, then they ramp up in
   * speed"): one sword flies in from off screen along its own heading, a light trail behind it, and plants its point by
   * the centre. `from` is where it starts (off screen), `tip` where its point stops, `flightMs` how long it takes.
   */
  launchSword(from: Pt, tip: Pt, centre: Pt, len: number, flightMs: number, prism = false): void {
    const c = this.colors;
    // Tier V's knockout sword glows in the Ancient prism (a magenta aura, a cyan trail) round the same holy blade.
    const glow = this.take('under', this.tex.swordGlow, prism ? KO_MAGENTA : c.gold);
    const trail = this.take('glow', this.tex.pillar, prism ? KO_CYAN : c.gold);
    const trailCore = this.take('hot', this.tex.pillar, prism ? KO_LILAC : c.core);
    const body = this.take('body', this.tex.swordBody, 0xffffff);
    const hot = this.take('hot', this.tex.swordHot, c.core);
    if (!glow || !trail || !trailCore || !body || !hot) { for (const x of [glow, trail, trailCore, body, hot]) if (x) this.give(x); return; }
    // The texture points DOWN (its tip at the bottom); turn it so the point leads along the flight.
    const dx = tip.x - from.x, dy = tip.y - from.y;
    const rot = Math.atan2(-dx, dy);
    const k = len / SWORD_LEN_PX;
    for (const x of [glow, body, hot]) { x.anchor.set(0.5, SWORD_TIP_Y / SWORD_H); x.scale.set(k); x.rotation = rot; x.alpha = 0; x.position.set(from.x, from.y); }
    for (const x of [trail, trailCore]) { x.anchor.set(0.5, 1); x.rotation = rot + Math.PI; x.alpha = 0; x.position.set(from.x, from.y); }
    this.swords.push({ glow, body, hot, trail, trailCore, from: { ...from }, tip: { ...tip }, centre: { ...centre }, rot, len, age: 0, flight: Math.max(1, flightMs), implodeT: -1, implodeMs: 1 });
  }

  /**
   * A sword BITES (step 0 = the first). Each impact is bigger than the last (the ramp): a short flash at its point, a
   * cross gleam, a flat ring, chips and motes; the holy ring at the centre forms on the first and brightens with every
   * one after it, and the dust rolls out on the first.
   */
  swordHit(tip: Pt, centre: Pt, r: number, step: number, count: number, o: { dust: number; debris: number; shock: number; flashAlpha: number }): void {
    const c = this.colors, S = this.scale;
    const k = count > 1 ? step / (count - 1) : 1; // 0 .. 1 across the barrage
    const g = 0.8 + 0.6 * k;
    this.tw('hot', this.tex.glow, c.core, tip.x, tip.y, { dur: 100, from: 0.6 * g, to: 1.4 * g, a0: o.flashAlpha });
    this.tw('hot', this.tex.star, c.core, tip.x, tip.y, { dur: 220, from: 1.6 * g, to: 2.8 * g, a0: 0.95, rot: step * 0.5, ease: easeOutCubic });
    this.tw('glow', this.tex.ring, c.gold, tip.x, tip.y, { dur: 320, from: 0.3, to: (r * 1.6 * g) / RING_PX / S, a0: 0.8, ease: easeOutCubic });
    if (o.shock > 0) this.tw('under', this.tex.ring, c.gold, centre.x, centre.y, { dur: 420, from: (r * 1.2) / RING_PX / S, to: (r * (2.6 + 1.6 * k) * o.shock) / RING_PX / S, a0: 0.35 + 0.35 * k, ease: easeOutCubic });
    const chips = Math.round(o.debris * (0.35 + 0.65 * k));
    const away = Math.atan2(tip.y - centre.y, tip.x - centre.x);
    for (let i = 0; i < chips; i++) {
      const a = away + (this.rnd() - 0.5) * 2.2, sp = (220 + this.rnd() * 380) * S * g;
      this.particle(i % 3 === 0 ? 'body' : 'hot', this.tex.chip, i % 3 === 0 ? c.deep : i % 2 ? c.gold : c.core, {
        x: tip.x, y: tip.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.08, grav: 0, life: 360 + this.rnd() * 260,
        from: (0.9 + this.rnd() * 0.7) * S, to: 0.4 * S, alpha: 1, twinkle: 0, spin: 0, align: true,
      });
    }
    if (step === 0) {
      // The first bite: dust rolls out flat round the centre, and the HOLY RING forms there.
      for (let i = 0; i < o.dust; i++) {
        const a = (i / Math.max(1, o.dust)) * Math.PI * 2 + (this.rnd() - 0.5) * 0.4;
        const sp = (150 + this.rnd() * 110) * S;
        this.tw('body', this.tex.puff, c.dust, centre.x + Math.cos(a) * 16 * S, centre.y + Math.sin(a) * 16 * S, {
          dur: 700 + this.rnd() * 200, from: 0.6, to: 1.6 + this.rnd() * 0.5, a0: 0.5, ease: easeOutCubic, inMs: 40, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        });
      }
      const sz = (r * 2.4) / SIGIL_PX / S;
      this.hold('ground', this.tex.hsigil, c.deep, centre.x, centre.y, 'hub', { a: 0.6, g0: sz * 1.6, g1: sz, gMs: 220, spin: 0.0009, inMs: 60 });
      this.hold('under', this.tex.hsigil, c.gold, centre.x, centre.y, 'hub', { a: 1, g0: sz * 1.6, g1: sz, gMs: 220, spin: 0.0009, inMs: 60, pulse: 0.1 });
      this.hold('under', this.tex.glow, c.gold, centre.x, centre.y, 'hub', { a: 0.35, g1: (r * 2.6) / GLOW_PX / S, inMs: 120, pulse: 0.2 });
      this.hold('glow', this.tex.ring, c.gold, centre.x, centre.y, 'hub', { a: 0.7, g0: (r * 3) / RING_PX / S, g1: (r * 1.9) / RING_PX / S, gMs: 260, inMs: 60 });
      this.hub = { x: centre.x, y: centre.y, r, hits: 0 };
    }
    if (this.hub) this.hub.hits++;
    this.kickTag('hub', 0.35 + 0.5 * k);
    this.motes(tip.x, tip.y, 4 + Math.round(6 * k), { lift: 60, speed: 180, life: 600, grav: 0 });
  }

  /**
   * THE IMPLOSION (owner: "the center implodes into that blast towards the enemy"): every planted sword and all the light
   * are sucked into the centre over `ms` (easing in: a sharp inward collapse). The holy ring shrinks to a point, rings
   * close in, motes are pulled in from all round, and a core of white light swells to the release.
   */
  implode(centre: Pt, r: number, ms: number): void {
    const c = this.colors, S = this.scale;
    const m = Math.max(1, ms);
    for (const w of this.swords) if (w.implodeT < 0) { w.implodeT = 0; w.implodeMs = m; }
    this.fadeTag('hub', m, -0.85);
    const inE = (u: number): number => u * u * u;
    this.tw('glow', this.tex.ring, c.gold, centre.x, centre.y, { dur: m, from: (r * 5) / RING_PX / S, to: (r * 0.3) / RING_PX / S, a0: 0.8, ease: inE, inMs: 30 });
    this.tw('hot', this.tex.ring, c.core, centre.x, centre.y, { dur: m, delay: m * 0.25, from: (r * 3.6) / RING_PX / S, to: (r * 0.2) / RING_PX / S, a0: 0.9, ease: inE, inMs: 30 });
    this.tw('hot', this.tex.glow, c.core, centre.x, centre.y, { dur: m, from: (r * 0.4) / GLOW_PX / S, to: (r * 1.6) / GLOW_PX / S, a0: 0.9, ease: inE, inMs: m * 0.5 });
    this.gatherAcc = { x: centre.x, y: centre.y, r: r * 2.2, left: m, acc: 0 };
  }

  /**
   * THE RELEASE: the imploded light bursts out of the centre (a short white flash, a cross gleam, god rays, golden shards,
   * flat rings and radiant cracks), and the flat blast forms facing the target, to be fired by `spread`.
   */
  release(centre: Pt, r: number, toward: Pt, o: { size: number; shards: number; cracks: number; flashAlpha: number }): void {
    const c = this.colors, L = this.look, S = this.scale;
    const z = o.size;
    this.gatherAcc = null;
    this.tw('hot', this.tex.glow, c.core, centre.x, centre.y, { dur: 100, from: (r * 1.2) / GLOW_PX / S, to: (r * 2.6 * z) / GLOW_PX / S, a0: o.flashAlpha });
    this.tw('under', this.tex.glow, this.pg(0, c.gold), centre.x, centre.y, { dur: 360, from: (r * 1.6) / GLOW_PX / S, to: (r * 4 * z) / GLOW_PX / S, a0: 0.25 });
    this.tw('hot', this.tex.star, c.core, centre.x, centre.y, { dur: 300, from: (r * 3.4) / 48 / S, to: (r * 5.6 * z) / 48 / S, a0: 1, ease: easeOutCubic });
    this.tw('hot', this.tex.star, c.sky, centre.x, centre.y, { dur: 260, from: (r * 2.4) / 48 / S, to: (r * 3.6 * z) / 48 / S, a0: 0.5, rot: Math.PI / 4 });
    const rs = ((r * 5 * z) / 256 / S) * L.raysSize;
    if (rs > 0) {
      this.tw('glow', this.tex.rays, c.gold, centre.x, centre.y, { dur: 620, from: rs * 0.5, to: rs * 1.15, a0: 0.9, spin: 0.0009, ease: easeOutCubic, outFrom: 0.2 });
      this.tw('ground', this.tex.rays, c.deep, centre.x, centre.y, { dur: 560, from: rs * 0.5, to: rs * 1.1, a0: 0.28, spin: 0.0009, ease: easeOutCubic, outFrom: 0.2 });
    }
    this.tw('glow', this.tex.ring, c.gold, centre.x, centre.y, { dur: 320, from: 0.4, to: (r * 4.4 * z) / RING_PX / S, a0: 0.8, ease: easeOutCubic });
    this.tw('under', this.tex.ring, this.koWave ? HOLY_KO_PINK : c.sky, centre.x, centre.y, { dur: 480, from: 0.5, to: (r * 6 * z) / RING_PX / S, a0: this.koWave ? 0.7 : 0.25, ease: easeOutCubic });
    if (this.koWave) this.tw('glow', this.tex.ring, HOLY_KO_ROSE, centre.x, centre.y, { dur: 400, delay: 50, from: 0.4, to: (r * 5.2 * z) / RING_PX / S, a0: 0.75, ease: easeOutCubic });
    const n = Math.max(0, Math.round(o.shards));
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * Math.PI * 2 + (this.rnd() - 0.5) * 0.3;
      const sp = (700 + this.rnd() * 700) * S * z;
      this.tw(i % 3 === 0 ? 'hot' : 'glow', this.tex.streak, i % 3 === 0 ? c.core : this.pg(i, c.gold), centre.x + Math.cos(a) * 10 * S, centre.y + Math.sin(a) * 10 * S, {
        dur: 280 + this.rnd() * 140, from: 0, to: 0, sx0: 1.6 + this.rnd() * 1.4, sx1: 0.8, sy0: 0.22, sy1: 0.1, a0: 1, ease: easeOutCubic,
        rot: a, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, outFrom: 0.3, ax: 1, ay: 0.5,
      });
    }
    // Burnt into the board where it burst: a compact rune circle and radiant cracks (the blast's origin), lingering.
    const sz = (r * 2.2 * z) / SIGIL_PX / S;
    this.hold('ground', this.tex.hsigil, c.deep, centre.x, centre.y, 'ground', { a: 0.7, g0: sz * 0.4, g1: sz, gMs: 200, spin: 0.0008, inMs: 30 });
    this.hold('under', this.tex.hsigil, c.gold, centre.x, centre.y, 'ground', { a: 1, g0: sz * 0.4, g1: sz, gMs: 200, spin: 0.0008, inMs: 30, pulse: 0.12 });
    this.cracksAt(centre.x, centre.y, o.cracks, r * 2.4);
    this.motes(centre.x, centre.y, 20, { lift: 60, speed: 300, life: 900, ring: r * 0.4, grav: 0 });
    this.formWave(centre, r, toward, z);
  }

  /** Radiant cracks drawn out from a point on the flat board (a deep-gold line with a gold light over it). */
  private cracksAt(x: number, y: number, n: number, reach: number): void {
    const c = this.colors, L = this.look, S = this.scale;
    for (let i = 0; i < n; i++) {
      const th = (i / Math.max(1, n)) * Math.PI * 2 + (this.rnd() - 0.5) * 0.5;
      const len = (reach * (0.6 + this.rnd() * 0.5)) / 128 / S;
      const thick = (0.9 + this.rnd() * 0.5);
      for (const [layer, tint, a] of [['ground', c.deep, 0.75], ['under', c.gold, 0.9]] as [LayerId, number, number][]) {
        const h = this.hold(layer, this.tex.crack, tint, x, y, 'ground', { a, g0: 0, g1: 1, gMs: 160, inMs: 30, tilt: 1, rot: th, ax: 0, ay: 0.5 });
        if (h) { h.ry = thick; h.len = len; }
      }
    }
  }


  /** One crack of the surge, cut into segments along its points (each knows where along the path it starts and ends). */
  private crackSegs(pts: readonly Pt[], a: Pt, ang: number, len: number, w: number, light = this.colors.gold): CrackSeg[] {
    const c = this.colors;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const out: CrackSeg[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i]!, q = pts[i + 1]!;
      const u0 = ((p.x - a.x) * ux + (p.y - a.y) * uy) / Math.max(1, len);
      const u1 = ((q.x - a.x) * ux + (q.y - a.y) * uy) / Math.max(1, len);
      const parts: CrackSeg['parts'] = [];
      for (const [layer, tint, wm, al] of [['ground', c.deep, 1, 0.9], ['under', light, 3.2, 0.7], ['hot', c.core, 0.42, 1]] as [LayerId, number, number, number][]) {
        const sp = this.take(layer, this.tex.beam, tint);
        if (!sp) continue;
        sp.anchor.set(0, 0.5); sp.position.set(p.x, p.y); sp.rotation = Math.atan2(q.y - p.y, q.x - p.x); sp.alpha = 0; sp.scale.set(0, 0);
        parts.push({ s: sp, w: wm, a: al });
      }
      out.push({ a: { ...p }, len: Math.hypot(q.x - p.x, q.y - p.y), u0, u1, w, parts });
    }
    return out;
  }

  /**
   * THE SURGE: the explosion's light FIRED at the struck hero as consecrated, cracked ground (owner 2026-09-28: "which
   * then shoots the consecrated cracked ground at the opponent"). A bolt of light races down the path trailing a streak;
   * behind it radiant cracks TEAR open (a jagged main crack and two thinner ones beside it, each a deep-gold line under a
   * gold light with a white-hot core), a faint band of holy ground glows between them, runes light up as it passes, small
   * forks split off, motes rise. Fast and purposeful; it lingers after the eruption, then fades.
   */
  spread(a: Pt, b: Pt, cracks: readonly (readonly Pt[])[], runes: readonly HolyRune[], durMs: number, width: number): void {
    const c = this.colors, S = this.scale;
    const bandBody = this.take('ground', this.tex.beam, c.deep);
    const bandLight = this.take('under', this.tex.beam, this.pg(0, c.gold));
    const head = this.take('under', this.tex.glow, this.pg(1, c.gold));
    if (!bandBody || !bandLight || !head) { for (const sp of [bandBody, bandLight, head]) if (sp) this.give(sp); return; }
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (const sp of [bandBody, bandLight]) { sp.anchor.set(0, 0.5); sp.rotation = ang; sp.position.set(a.x, a.y); sp.alpha = 0; sp.scale.set(0, width / 64); }
    head.alpha = 0;
    const segs: CrackSeg[] = [];
    cracks.forEach((pts, i) => segs.push(...this.crackSegs(pts, a, ang, len, (i === 0 ? 7 : 4) * S, this.pg(i + 1, c.gold))));
    let waveD0 = 0;
    if (this.wave) { this.wave.flying = true; waveD0 = Math.max(0, (this.wave.x - a.x) * Math.cos(ang) + (this.wave.y - a.y) * Math.sin(ang)); }
    this.gatherAcc = null;
    this.spreadFx = {
      a: { ...a }, ang, len, dur: Math.max(1, durMs), age: 0, width, runes: [...runes], stamped: 0,
      bandBody, bandLight, head, segs, forkAcc: 0, lastD: 0, moteAcc: 0, dustAcc: 0, fadeT: -1, fadeMs: 1, waveD0,
    };
  }

  /** THE BLAST forms at the centre's near edge, facing the target: a flat crescent sheet of light, fired by `spread`. */
  private formWave(at: Pt, r: number, toward: Pt, size: number): void {
    const c = this.colors;
    const th = Math.atan2(toward.y - at.y, toward.x - at.x);
    const w = r * 3.2 * size, dp = r * 1.5 * size;
    const parts: Wave['parts'] = [];
    for (const [layer, tex, tint, a, dm, wm] of [
      ['ground', this.tex.waveBody, c.deep, 0.55, 1, 1],
      ['under', this.tex.waveBody, this.pg(0, c.gold), 0.8, 1.25, 1.2],
      ['glow', this.tex.waveBody, this.pg(1, c.gold), 0.9, 1, 1],
      ['hot', this.tex.waveEdge, this.koWave ? mixColor(HOLY_KO_ROSE, c.core, 0.35) : c.core, 1, 1, 1],
    ] as [LayerId, Texture, number, number, number, number][]) {
      const sp = this.take(layer, tex, tint);
      if (!sp) continue;
      sp.anchor.set(WAVE_EDGE_X, 0.5); sp.alpha = 0;
      parts.push({ s: sp, a, depth: (dp * dm) / 128, width: (w * wm) / 256 });
    }
    if (this.wave) for (const p of this.wave.parts) this.give(p.s);
    this.wave = { parts, x: at.x + Math.cos(th) * r * 0.6, y: at.y + Math.sin(th) * r * 0.6, th, age: 0, build: 60, flying: false, spent: -1, size };
  }

  /** The consecration gathers under the struck hero: its circle snaps in and brightens, light is drawn in. */
  gather(foot: Pt, r: number, durMs: number): void {
    const c = this.colors, L = this.look, S = this.scale;
    const sz = (r * 2.7) / SIGIL_PX / S;
    this.hold('ground', this.tex.hsigil, c.deep, foot.x, foot.y, 'foe', { a: 0.7, g0: sz * 0.45, g1: sz, gMs: durMs, back: true, tilt: 1, spin: -0.0012, inMs: 60 });
    this.hold('under', this.tex.hsigil, c.gold, foot.x, foot.y, 'foe', { a: 1, g0: sz * 0.45, g1: sz, gMs: durMs, back: true, tilt: 1, spin: -0.0012, inMs: 60, pulse: 0.15 });
    this.hold('under', this.tex.glow, c.gold, foot.x, foot.y, 'foe', { a: 0.55, g0: (r * 1.2) / GLOW_PX / S, g1: (r * 3.2) / GLOW_PX / S, gMs: durMs, tilt: 1, inMs: durMs * 0.6 });
    this.tw('hot', this.tex.ring, whiten(c.gold, 0.4), foot.x, foot.y, { dur: durMs, from: (r * 4.2) / RING_PX / S, to: (r * 2.4) / RING_PX / S, a0: 0.8, ease: easeInOutSine, inMs: 40 });
    this.gatherAcc = { x: foot.x, y: foot.y, r, left: durMs, acc: 0 };
  }

  /**
   * THE ERUPTION (IV, THE blow): holy flames and a pillar of light burst up under the struck hero. The first frame is
   * the brightest; fills are short (the big -N reads through them); the flames, rays and rings carry it after.
   */
  eruptFoe(foot: Pt, d: Pt, r: number, o: { flames: number; flameHeight: number; burst: number; motes: number; flashAlpha: number }): void {
    const c = this.colors, L = this.look, S = this.scale;
    this.gatherAcc = null;
    if (this.wave && this.wave.spent < 0) { this.wave.spent = 0; this.wave.x = foot.x; this.wave.y = foot.y; }
    const fs = o.burst;
    const portrait = (r * 2) / GLOW_PX / S;
    this.tw('hot', this.tex.glow, c.core, d.x, d.y, { dur: 110, from: portrait * 1.05, to: portrait * 1.3, a0: 0.6 * o.flashAlpha });
    this.tw('hot', this.tex.glow, c.core, foot.x, foot.y, { dur: 140, from: 1.2 * fs, to: Math.min(3.6, 2.2 * fs), a0: o.flashAlpha, ry: 1 });
    this.tw('under', this.tex.glow, this.pg(0, c.gold), d.x, d.y, { dur: 420, from: 1.6 * fs, to: Math.min(6, 3.4 * fs), a0: 0.35 * o.flashAlpha });
    this.tw('hot', this.tex.star, c.core, d.x, d.y, { dur: 340, from: ((r * 3.6) / 48 / S), to: ((r * 5.4) / 48 / S), a0: 1, ease: easeOutCubic });
    this.tw('hot', this.tex.star, c.sky, d.x, d.y, { dur: 300, from: ((r * 2.4) / 48 / S), to: ((r * 3.4) / 48 / S), a0: 0.55, rot: Math.PI / 4 });
    const rs = ((r * 4.4) / 256 / S) * L.raysSize;
    if (rs > 0) {
      this.tw('glow', this.tex.rays, c.gold, d.x, d.y, { dur: 900, from: rs * 0.7, to: rs * 1.35, a0: 0.95, spin: 0.0006, ease: easeOutCubic, outFrom: 0.3 });
      this.tw('ground', this.tex.rays, c.deep, d.x, d.y, { dur: 800, from: rs * 0.7, to: rs * 1.3, a0: 0.28, spin: 0.0006, ease: easeOutCubic, outFrom: 0.25 });
    }
    this.tw('glow', this.tex.ring, c.gold, foot.x, foot.y, { dur: 380, from: 0.5, to: (r * 4.2) / RING_PX / S, a0: 0.85, ease: easeOutCubic });
    this.tw('under', this.tex.ring, this.pg(0, c.gold), foot.x, foot.y, { dur: 640, from: 0.6, to: (r * 6.5) / RING_PX / S, a0: this.koWave ? 0.75 : 0.55, ease: easeOutCubic });
    this.tw('under', this.tex.ring, c.sky, d.x, d.y, { dur: 560, from: (r * 1.2) / RING_PX / S, to: (r * 5) / RING_PX / S, a0: 0.5 });
    // THE HOLY FLAMES: a flat corona, tongues of holy fire licking OUTWARD all round the portrait's rim (the face clear).
    const n = Math.max(0, Math.round(o.flames));
    for (let i = 0; i < n; i++) {
      const th = (i / Math.max(1, n)) * Math.PI * 2 + 0.2;
      const fx = foot.x + Math.cos(th) * r * 0.98, fy = foot.y + Math.sin(th) * r * 0.98;
      const hgt = r * (0.8 + 0.5 * this.rnd()) * o.flameHeight * L.flameHeight;
      const wid = r * (0.42 + 0.14 * this.rnd());
      const delay = this.rnd() * 90;
      const dur = 640 + this.rnd() * 240;
      const rot = Math.atan2(Math.cos(th), -Math.sin(th)) + (this.rnd() - 0.5) * 0.2; // the tongue points out from the centre
      const base = { delay, dur, from: 0, to: 0, ay: 0.95, ease: easeOutBack, outFrom: 0.35, flick: 0.25, spin: 0, tilt: 1, rot } as const;
      this.tw('body', this.tex.flame, c.deep, fx, fy, { ...base, sx0: (wid * 0.6) / 64 / S, sx1: (wid * 1.05) / 64 / S, sy0: 0.05, sy1: (hgt * 1.05) / 128 / S, a0: 0.55 });
      this.tw('glow', this.tex.flame, this.pg(i, c.gold), fx, fy, { ...base, sx0: (wid * 0.6) / 64 / S, sx1: wid / 64 / S, sy0: 0.05, sy1: hgt / 128 / S, a0: 0.95 });
      this.tw('hot', this.tex.flame, c.core, fx, fy, { ...base, sx0: (wid * 0.3) / 64 / S, sx1: (wid * 0.5) / 64 / S, sy0: 0.05, sy1: (hgt * 0.6) / 128 / S, a0: 0.9 });
    }
    this.motes(foot.x, foot.y, Math.round(o.motes * 0.6), { lift: 300, speed: 200, life: 1200, ring: r * 1.1, grav: -60 });
    this.motes(d.x, d.y, Math.round(o.motes * 0.4), { lift: 80, speed: 420, life: 800, grav: 320, size: 0.36 });
    this.fadeTag('foe', 900, 0.25);
  }

  /**
   * TIER V: the knockout sword bites DEAD CENTRE: a prismatic flare round the holy ring (a cyan ring and a magenta one a
   * beat behind), a bright cross gleam, the hub kicked hard, and prism motes thrown up. One-shot pooled sprites.
   */
  koSwordHit(centre: Pt, r: number): void {
    const c = this.colors, S = this.scale;
    this.tw('hot', this.tex.glow, c.core, centre.x, centre.y, { dur: 140, from: (r * 0.8) / GLOW_PX / S, to: (r * 2.4) / GLOW_PX / S, a0: 0.9 });
    this.tw('hot', this.tex.star, KO_LILAC, centre.x, centre.y, { dur: 300, from: (r * 2.4) / 48 / S, to: (r * 4.2) / 48 / S, a0: 1, ease: easeOutCubic });
    this.tw('glow', this.tex.ring, KO_CYAN, centre.x, centre.y, { dur: 420, from: (r * 0.8) / RING_PX / S, to: (r * 4.6) / RING_PX / S, a0: 0.95, ease: easeOutCubic });
    this.tw('glow', this.tex.ring, KO_MAGENTA, centre.x, centre.y, { dur: 520, from: (r * 0.8) / RING_PX / S, to: (r * 3.6) / RING_PX / S, a0: 0.8, ease: easeOutCubic, delay: 60 });
    this.kickTag('hub', 1.1);
    this.prismMotes(centre.x, centre.y, 16, { lift: 120, speed: 320, life: 700, grav: 0 });
  }

  /**
   * TIER V's PRISM on the eruption: a WIDER consecration ring in the Ancient palette (`ringScale` x the Huge one's
   * reach: cyan, then magenta a beat behind), a prismatic star gleam over the gold, and prism motes rising. Short fills,
   * so the big -N still reads.
   */
  koFlourish(foot: Pt, d: Pt, r: number, ringScale: number): void {
    const S = this.scale;
    this.tw('hot', this.tex.star, KO_CYAN, d.x, d.y, { dur: 360, from: (r * 3) / 48 / S, to: (r * 5.8) / 48 / S, a0: 0.75, rot: Math.PI / 8, ease: easeOutCubic });
    this.tw('glow', this.tex.ring, KO_CYAN, foot.x, foot.y, { dur: 620, from: 0.6, to: (r * 6.5 * ringScale) / RING_PX / S, a0: 0.9, ease: easeOutCubic });
    this.tw('glow', this.tex.ring, KO_MAGENTA, foot.x, foot.y, { dur: 820, from: 0.6, to: (r * 8 * ringScale) / RING_PX / S, a0: 0.75, ease: easeOutCubic, delay: 70 });
    this.tw('under', this.tex.ring, KO_LILAC, foot.x, foot.y, { dur: 980, from: (r * 1.4) / RING_PX / S, to: (r * 9.5 * ringScale) / RING_PX / S, a0: 0.4, ease: easeOutCubic, delay: 120 });
    this.tw('under', this.tex.glow, KO_MAGENTA, d.x, d.y, { dur: 380, from: (r * 1.4) / GLOW_PX / S, to: (r * 4.4) / GLOW_PX / S, a0: 0.35 });
    this.prismMotes(foot.x, foot.y, 28, { lift: 260, speed: 260, life: 1100, ring: r * 1.2, grav: -50 });
  }

  /** Motes of light in the Ancient prism (Tier V). */
  private prismMotes(x: number, y: number, n: number, o: { speed: number; lift: number; life: number; grav: number; ring?: number }): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const rr = (o.ring ?? 0) * (0.5 + this.rnd() * 0.5);
      const sp = o.speed * (0.4 + this.rnd() * 0.8) * S;
      const up = o.lift * (0.6 + this.rnd() * 0.8) * S;
      const sz = 0.42 * (0.6 + this.rnd() * 0.7);
      this.particle('hot', this.tex.star, KO_PRISM[i % 3]!, {
        x: x + Math.cos(a) * rr, y: y + Math.sin(a) * rr, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - up, drag: 0.25, grav: o.grav * S,
        life: o.life * (0.7 + this.rnd() * 0.6), from: sz * S, to: sz * 0.25 * S, alpha: 1, twinkle: 0.015 + this.rnd() * 0.02, spin: (this.rnd() - 0.5) * 0.01,
      });
    }
  }

  /** The consecrated ground fades (after lingering); the path band fades with it. */
  fadeGround(ms: number): void {
    this.fadeTag('ground', ms, 0.08);
    if (this.spreadFx && this.spreadFx.fadeT < 0) { this.spreadFx.fadeT = 0; this.spreadFx.fadeMs = Math.max(1, ms); }
  }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  private paintFx(q: Fx): void {
    const u = clamp01(q.age / q.dur);
    const e = q.ease(u);
    const S = this.scale;
    const sx = (q.sx0 + (q.sx1 - q.sx0) * e) * S, sy = (q.sy0 + (q.sy1 - q.sy0) * e) * S;
    if (q.tilt > 0) flatTransform(q.s, q.rot, sx, sy);
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
    if (h.tilt > 0) flatTransform(h.s, h.rot, sx, sy);
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

    // The swords: flying in, planted, then sucked into the centre.
    for (let i = this.swords.length - 1; i >= 0; i--) {
      const w = this.swords[i]!;
      w.age += dt;
      const u = clamp01(w.age / w.flight);
      const e = 0.25 * u + 0.75 * u * u; // accelerating into the bite
      let x = w.from.x + (w.tip.x - w.from.x) * e, y = w.from.y + (w.tip.y - w.from.y) * e;
      const k0 = w.len / SWORD_LEN_PX;
      let k = k0, bodyA = clamp01(w.age / 40), hotA = 0.55, glowA = 0.85 * this.look.swordGlow;
      const planted = w.age >= w.flight;
      if (planted) {
        const since = w.age - w.flight;
        const hubGlow = this.hub ? Math.min(1, this.hub.hits / 6) : 0;
        hotA = 0.5 + 0.5 * Math.exp(-since / 140) + 0.25 * hubGlow;
        glowA = (0.8 + 0.3 * Math.exp(-since / 200) + 0.35 * hubGlow) * this.look.swordGlow;
      }
      if (w.implodeT >= 0) {
        w.implodeT += dt;
        const f = clamp01(w.implodeT / w.implodeMs);
        const ef = f * f * f; // a sharp inward collapse
        x = w.tip.x + (w.centre.x - w.tip.x) * ef; y = w.tip.y + (w.centre.y - w.tip.y) * ef;
        k = k0 * (1 - 0.8 * ef);
        hotA = Math.min(1, hotA + f);
        bodyA = 1 - ef;
        if (f >= 1) { for (const q of [w.glow, w.body, w.hot, w.trail, w.trailCore]) this.give(q); this.swords.splice(i, 1); continue; }
      }
      for (const q of [w.glow, w.body, w.hot]) { q.position.set(x, y); q.scale.set(k); }
      w.glow.scale.set(k * 1.03);
      w.body.alpha = bodyA; w.hot.alpha = Math.max(0, Math.min(1, hotA)) * clamp01(w.age / 40); w.glow.alpha = Math.max(0, Math.min(1, glowA)) * clamp01(w.age / 40);
      // The light trail streams behind it in flight, long and hot with its speed; gone as it bites.
      const flying = !planted;
      const tl = w.len * (0.6 + 2.4 * u * u);
      const back = { x: -(w.tip.x - w.from.x), y: -(w.tip.y - w.from.y) };
      const bl = Math.hypot(back.x, back.y) || 1;
      const px = x + (back.x / bl) * w.len * 0.55, py = y + (back.y / bl) * w.len * 0.55;
      w.trail.position.set(px, py); w.trail.scale.set((w.len * 0.3) / PILLAR_W, tl / PILLAR_H);
      w.trailCore.position.set(px, py); w.trailCore.scale.set((w.len * 0.09) / PILLAR_W, (tl * 0.85) / PILLAR_H);
      w.trail.alpha = flying ? 0.8 * Math.min(1, u * 3) : Math.max(0, w.trail.alpha - dt / 90);
      w.trailCore.alpha = flying ? 0.9 * Math.min(1, u * 3) : Math.max(0, w.trailCore.alpha - dt / 70);
    }

    // The surge: the bolt races down the path, the cracks tear open behind it.
    const sp = this.spreadFx;
    if (sp) {
      sp.age += dt;
      const x = clamp01(sp.age / sp.dur);
      // Fired: it leaves fast and barely slows (a shot, not a spreading pool).
      const u = 1 - Math.pow(1 - x, 1.35);
      const dist = sp.len * u;
      const fade = sp.fadeT >= 0 ? clamp01((sp.fadeT += dt) / sp.fadeMs) : 0;
      const live = (1 - fade) * clamp01(sp.age / 50);
      sp.bandBody.scale.set(dist / 64, (sp.width * 0.8) / 64); sp.bandBody.alpha = 0.22 * live;
      sp.bandLight.scale.set(dist / 64, (sp.width * 1.5) / 64); sp.bandLight.alpha = (0.5 + 0.08 * Math.sin(sp.age * 0.012)) * live;
      const hx = sp.a.x + Math.cos(sp.ang) * dist, hy = sp.a.y + Math.sin(sp.ang) * dist;
      const running = x < 1;
      sp.head.position.set(hx, hy); sp.head.scale.set((sp.width * 5) / GLOW_PX, (sp.width * 5) / GLOW_PX);
      sp.head.alpha = running ? 0.6 : Math.max(0, sp.head.alpha - dt / 100);
      // The blast rides the front, skimming the ground.
      const wv = this.wave;
      if (wv && wv.flying && wv.spent < 0) {
        const wd = Math.min(sp.len, Math.max(dist, sp.waveD0));
        wv.x = sp.a.x + Math.cos(sp.ang) * wd; wv.y = sp.a.y + Math.sin(sp.ang) * wd;
      }
      // Tear the cracks open behind the front: each segment draws out from its start as the front passes it.
      for (const sg of sp.segs) {
        const g = sg.u1 > sg.u0 ? clamp01((u - sg.u0) / Math.max(1e-4, sg.u1 - sg.u0)) : (u >= sg.u0 ? 1 : 0);
        const hot = clamp01(1 - (u - sg.u1) * 3); // white-hot just behind the front, cooling to gold
        for (const pt of sg.parts) {
          pt.s.scale.set((sg.len * g) / 64, (sg.w * pt.w) / 64);
          const flick = pt.w > 3 ? 0.85 + 0.15 * Math.sin(sp.age * 0.02 + sg.u0 * 20) : 1;
          pt.s.alpha = g > 0 ? pt.a * live * flick * (pt.w < 1 ? 0.45 + 0.55 * hot : 1) : 0;
        }
      }
      // Stamp the runes the front has passed.
      while (sp.stamped < sp.runes.length && sp.runes[sp.stamped]!.u <= u + 1e-6) this.stampRune(sp.runes[sp.stamped++]!, sp.width);
      if (running) {
        // Small forks split off the main crack every ~90 px.
        sp.forkAcc += dist - sp.lastD;
        while (sp.forkAcc > 90 * S) {
          sp.forkAcc -= 90 * S;
          const side = this.rnd() < 0.5 ? -1 : 1;
          const th = sp.ang + side * (0.6 + this.rnd() * 0.5);
          const flen = (sp.width * (0.9 + this.rnd() * 0.8)) / 128 / S;
          for (const [layer, tint, a] of [['ground', c.deep, 0.8], ['under', this.pg(side > 0 ? 0 : 1, c.gold), 0.85]] as [LayerId, number, number][]) {
            const h = this.hold(layer, this.tex.crack, tint, hx, hy, 'ground', { a, g0: 0, g1: 1, gMs: 140, inMs: 20, tilt: 1, rot: th, ax: 0, ay: 0.5 });
            if (h) { h.ry = 0.7; h.len = flen; }
          }
        }
        // Dust and light kicked up either side of the blast as it skims.
        sp.dustAcc += dt * 0.05;
        while (sp.dustAcc >= 1) {
          sp.dustAcc -= 1;
          const side = this.rnd() < 0.5 ? -1 : 1;
          const nx = -Math.sin(sp.ang), ny = Math.cos(sp.ang);
          const off = sp.width * (0.9 + this.rnd() * 0.8) * side;
          this.tw('body', this.tex.puff, c.dust, hx + nx * off, hy + ny * off * 0.6, {
            dur: 520 + this.rnd() * 200, from: 0.4, to: 1.1 + this.rnd() * 0.4, a0: 0.45, ease: easeOutCubic, inMs: 30,
            vx: nx * side * 60 * S, vy: -40 * S,
          });
        }
        sp.moteAcc += dt * 0.14;
        while (sp.moteAcc >= 1) {
          sp.moteAcc -= 1;
          this.particle('hot', this.tex.star, this.rnd() < 0.5 ? this.pg(Math.floor(sp.age / 60), c.gold) : c.core, {
            x: hx + (this.rnd() - 0.5) * sp.width, y: hy + (this.rnd() - 0.5) * sp.width * 0.5, vx: (this.rnd() - 0.5) * 40 * S, vy: -(90 + this.rnd() * 130) * S,
            drag: 0.4, grav: -30 * S, life: 700 + this.rnd() * 400, from: (0.35 + this.rnd() * 0.25) * S, to: 0.08 * S, alpha: 1, twinkle: 0.02, spin: 0.004,
          });
        }
      }
      sp.lastD = dist;
      if (fade >= 1) {
        for (const s2 of [sp.bandBody, sp.bandLight, sp.head]) this.give(s2);
        for (const sg of sp.segs) for (const pt of sg.parts) this.give(pt.s);
        this.spreadFx = null;
      }
    }

    // The flat blast: it swells and flickers as the wake builds, skims while it flies, and is spent in the eruption.
    const wv = this.wave;
    if (wv) {
      wv.age += dt;
      const bu = clamp01(wv.age / wv.build);
      let grow = wv.flying ? 1 : 0.5 + 0.5 * easeOutCubic(bu);
      let a = wv.flying ? 1 : 0.35 + 0.65 * bu;
      if (wv.spent >= 0) {
        wv.spent += dt;
        const f = clamp01(wv.spent / 160);
        grow = 1 + 0.4 * f; a = 1 - f;
      }
      const flick = 0.88 + 0.12 * Math.sin(wv.age * 0.05);
      for (const p of wv.parts) {
        p.s.position.set(wv.x, wv.y);
        flatTransform(p.s, wv.th, p.depth * grow * (wv.flying ? 1.25 : 1), p.width * grow);
        p.s.alpha = Math.max(0, p.a * a * flick);
      }
      if (wv.spent >= 160) { for (const p of wv.parts) this.give(p.s); this.wave = null; }
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
    this.hold('ground', g, c.deep, rn.at.x, rn.at.y, 'ground', { a: 0.75, g0: gs * 2, g1: gs, gMs: 220, back: true, tilt: 1, rot: rn.rot, inMs: 40 });
    this.hold('under', g, c.gold, rn.at.x, rn.at.y, 'ground', { a: 1, g0: gs * 2, g1: gs, gMs: 220, back: true, tilt: 1, rot: rn.rot, inMs: 40, pulse: 0.2 });
    this.tw('hot', this.tex.glow, c.core, rn.at.x, rn.at.y, { dur: 160, from: (width * 0.4) / GLOW_PX / S, to: (width * 1.2) / GLOW_PX / S, a0: 0.6 });
    // Some runes flare with a LOW burst of light (a flat flash on the ground, never a column: the blast stays flat).
    if (rn.pillar) this.tw('under', this.tex.glow, c.gold, rn.at.x, rn.at.y, { dur: 300, from: (width * 0.8) / GLOW_PX / S, to: (width * 2.2) / GLOW_PX / S, a0: 0.8 });
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const q of this.fx) this.give(q.s);
    for (const h of this.held) this.give(h.s);
    for (const p of this.particles) this.give(p.s);
    for (const p of this.pillars) { for (const pt of p.parts) this.give(pt.s); if (p.head) this.give(p.head); }
    for (const sp of this.spears) for (const s of [sp.body, sp.glow, sp.trail]) this.give(s);
    for (const w of this.swords) for (const q of [w.glow, w.body, w.hot, w.trail, w.trailCore]) this.give(q);
    if (this.spreadFx) {
      for (const s of [this.spreadFx.bandBody, this.spreadFx.bandLight, this.spreadFx.head]) this.give(s);
      for (const sg of this.spreadFx.segs) for (const pt of sg.parts) this.give(pt.s);
    }
    for (const s of this.warm) this.give(s);
    if (this.wave) for (const p of this.wave.parts) this.give(p.s);
    this.fx = []; this.held = []; this.particles = []; this.pillars = []; this.spears = []; this.swords = []; this.hub = null; this.spreadFx = null; this.wave = null;
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
