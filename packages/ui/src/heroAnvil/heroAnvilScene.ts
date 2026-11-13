/**
 * LOOK OUT BELOW'S SCENE: everything the drop draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so
 * it runs (and is tested) headless. `heroAnvil.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * Three things are the scene's own (the rest are fire-and-forget pool effects):
 *  - the SHADOW on the struck portrait: a soft dark disc that grows and darkens for the whole fall, gone at the landing;
 *  - the OBJECT (the anvil or the piano): it FALLS from above the screen (stretched a little by its speed), RESTS on the
 *    flattened portrait (it rides the portrait's top edge, which the runner feeds in every frame, so the two can never
 *    drift apart), then TIPS off on the pop: tossed up, turning, falling away and fading;
 *  - the piano's loose KEYS (big only): thrown up and out on the landing, they fall, bounce twice on the ground line
 *    and fade.
 * The landing itself is a ring of dust puffs rolling out along the ground, a flat shock ring and a few stars.
 */
import type { Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { anvilRestOffset } from './heroAnvilConfig';
import { ANVIL_BASE, ANVIL_FOOT_X, ANVIL_H, ANVIL_W, KEY_H, PIANO_BASE, PIANO_H, PIANO_W, PUFF_PX, SHADOW_PX } from './heroAnvilTextures';

export interface HeroAnvilTextures extends HeroArcanaTextures {
  anvil: Texture;
  piano: Texture;
  keyWhite: Texture;
  keyBlack: Texture;
  puff: Texture;
  shadow: Texture;
}

export interface AnvilColors { dust: number; spark: number; shadow: number; side: number }

export interface AnvilLook {
  /** The shadow's darkest opacity (just before the landing). */
  shadowAlpha: number;
  /** The tipped object: how long it is drawn, how hard it is tossed (px/s) and how fast it falls (px/s^2), at stage scale 1. */
  tipMs: number;
  tipSpeed: number;
  tipGravity: number;
  /** The piano's loose keys: how hard they are thrown (px/s) and how fast they fall (px/s^2), at stage scale 1. */
  keySpeed: number;
  keyGravity: number;
}

/** Hard cap on sprites alive at once (a piano landing peaks near 60). */
export const MAX_ANVIL_SPRITES = 160;
const RING_PX = 160;
const STAR_PX = 48;
/** A falling or resting object (or a growing shadow) whose next beat never came is dropped after this long. */
const STRAY_MS = 3000;

export type AnvilObjectKind = 'anvil' | 'piano';
export type AnvilObjectState = 'fall' | 'rest' | 'tip';

interface Obj {
  s: Sprite;
  kind: AnvilObjectKind;
  state: AnvilObjectState;
  /** Texture px -> screen px. */
  k: number;
  /** Ms in the current state. */
  age: number;
  dur: number;
  x: number; y0: number; y1: number;
  /** Tipping: the centre's position and velocity, and the turn. */
  cx: number; cy: number; vx: number; vy: number; spin: number;
}

interface Shadow { s: Sprite; age: number; dur: number; r0: number; r1: number; fade: number }

interface Key { s: Sprite; x: number; y: number; vx: number; vy: number; spin: number; floor: number; bounces: number; age: number; life: number; k: number }

export class HeroAnvilScene extends FxPool {
  private obj: Obj | null = null;
  private shadow: Shadow | null = null;
  private keys: Key[] = [];
  /** The struck portrait: its centre, its radius, and its squashed height this frame (1 = at rest). */
  private d: Pt = { x: 0, y: 0 };
  private r = 0;
  private sy = 1;
  /** The struck portrait is this far (px, 0 or negative) above where it will be flattened: it is still ducking, or coming back up. */
  private lift = 0;
  /** The screen's left and right edges (the object is kept inside them when the portrait sits in a corner). */
  private minX = Number.NEGATIVE_INFINITY;
  private maxX = Number.POSITIVE_INFINITY;

  constructor(private readonly tex: HeroAnvilTextures, private readonly colors: AnvilColors, private readonly look: AnvilLook, scale = 1, seed = 1) {
    super('heroAnvil', [tex.ring, tex.star, tex.spark, tex.shadow, tex.puff, tex.anvil, tex.piano, tex.keyWhite, tex.keyBlack], scale, seed, MAX_ANVIL_SPRITES);
  }

  /** Speeds and gravities are tuned for a portrait 110 px in radius: everything the scene throws scales with the real one. */
  private get unit(): number { return this.r / 110; }

  /** What the object is doing (null = none on screen). */
  get objectState(): AnvilObjectState | null { return this.obj ? this.obj.state : null; }
  get objectKind(): AnvilObjectKind | null { return this.obj ? this.obj.kind : null; }
  /** Where the object's foot is (falling, resting), or its centre (tipping). Null with none on screen. */
  get objectAt(): Pt | null { const o = this.obj; return o ? { x: o.s.position.x, y: o.s.position.y } : null; }
  get shadowOn(): boolean { return this.shadow !== null; }
  /** The shadow's radius right now, in px (0 with none). */
  get shadowRadius(): number { const sh = this.shadow; return sh ? (sh.s.scale.x * SHADOW_PX) / 2 : 0; }
  get liveKeys(): number { return this.keys.length; }

  /** The struck portrait (measured once by the runner). */
  setTarget(d: Pt, radius: number, minX = Number.NEGATIVE_INFINITY, maxX = Number.POSITIVE_INFINITY): void {
    this.d = { x: d.x, y: d.y }; this.r = radius; this.minX = minX; this.maxX = maxX;
  }

  /** Where the ducking portrait is this frame, as an offset from its struck position (0 = fully down, negative = higher). */
  setPull(dy: number): void { this.lift = Number.isFinite(dy) ? Math.min(0, dy) : 0; }

  /** The struck portrait's squashed height this frame: the resting object rides its top edge. */
  setSquash(sy: number): void { this.sy = Number.isFinite(sy) ? sy : 1; }

  /** The striking hero's cue: a small spark shoots straight up off the top of its portrait (it is calling something down). */
  cue(a: Pt, aRadius: number): void {
    const c = this.colors;
    const y = a.y - aRadius;
    const R = aRadius / this.scale; // the pool multiplies sizes and speeds by the stage scale
    const k = R / 110;
    // A flash on the top of the rim, then a bright star with a short tail going straight up and fading.
    this.spawn('core', this.tex.star, c.spark, a.x, y, { dur: 300, from: 0.7 * k, to: 2.2 * k, a0: 1, mode: 'punch', peakAt: 0.2, rot: 0.3 });
    this.spawn('core', this.tex.spark, c.spark, a.x, y, { dur: 420, from: 1.6 * k, to: 0.7 * k, a0: 1, vy: -1000 * k, drag: 0.3, align: true, sy: 0.45 });
    this.spawn('core', this.tex.star, 0xffffff, a.x, y, { dur: 440, from: 1.25 * k, to: 0.5 * k, a0: 1, mode: 'hold', vy: -1000 * k, drag: 0.3, spin: 0.014 });
    this.spawn('core', this.tex.star, c.side, a.x, y, { dur: 440, from: 1.7 * k, to: 0.7 * k, a0: 0.7, mode: 'hold', vy: -1000 * k, drag: 0.3, spin: -0.01 });
  }

  /** The shadow appears on the struck portrait and grows over `fallMs` to `radii` portrait radii. */
  startShadow(radii: number, fallMs: number, age0 = 0): void {
    if (this.shadow) return;
    const s = this.take('under', this.tex.shadow, this.colors.shadow);
    if (!s) return;
    s.position.set(this.d.x, this.d.y);
    s.alpha = 0;
    this.shadow = { s, age: Math.max(0, age0), dur: Math.max(1, fallMs), r0: this.r * radii * 0.34, r1: this.r * radii, fade: -1 };
    this.drawShadow();
  }

  /**
   * The object comes into view: its foot falls from `startY` (above the top of the screen) to the top of the struck
   * portrait over `dropMs`. `size` = its width in portrait radii. `age0` = ms already elapsed (a late frame).
   */
  drop(kind: AnvilObjectKind, size: number, dropMs: number, startY: number, age0 = 0): void {
    if (this.obj) return;
    const piano = kind === 'piano';
    const s = this.take('body', piano ? this.tex.piano : this.tex.anvil, 0xffffff);
    if (!s) return;
    s.anchor.set(piano ? 0.5 : ANVIL_FOOT_X, piano ? PIANO_BASE : ANVIL_BASE);
    const k = (this.r * size) / (piano ? PIANO_W : ANVIL_W);
    // Centred on the portrait, nudged in from a screen edge when the portrait sits in a corner (never past the portrait).
    const half = (this.r * size) / 2 + 6 * this.scale;
    const x = Math.min(this.d.x + this.r * 0.5, Math.max(this.d.x - this.r * 0.5, Math.min(this.maxX - half, Math.max(this.minX + half, this.d.x))));
    this.obj = {
      s, kind, state: 'fall', k, age: Math.max(0, age0), dur: Math.max(1, dropMs), x, y0: startY, y1: this.d.y + this.r * anvilRestOffset(1),
      cx: 0, cy: 0, vx: 0, vy: 0, spin: 0,
    };
    this.drawObject();
  }

  /** THE landing: the object comes to rest on the portrait, the shadow goes, and the dust (and the keys) fly. */
  land(o: { dust: number; keys: number; big: boolean }): void {
    const ob = this.obj;
    if (ob && ob.state === 'fall') { ob.state = 'rest'; ob.age = 0; }
    if (this.shadow && this.shadow.fade < 0) this.shadow.fade = 0;
    const c = this.colors;
    const S = this.scale;
    const R = this.r / S; // the pool multiplies sizes and speeds by the stage scale
    const x = this.d.x, floor = this.d.y + this.r * 0.82, top = this.d.y - this.r * 0.2;
    const big = o.big ? 1.45 : 1;
    // A flat shock ring along the ground line, and a smaller one where the weight met the portrait.
    this.spawn('glow', this.tex.ring, c.dust, x, floor, { dur: 420, from: (R * 0.8) / RING_PX, to: (R * 5.2 * big) / RING_PX, sy: 0.26, a0: 0.8, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, c.spark, x, top, { dur: 260, from: (R * 0.6) / RING_PX, to: (R * 3 * big) / RING_PX, sy: 0.32, a0: 0.55, ease: 'cubic' });
    // The piano: a second, slower, wider ring along the ground.
    if (o.big) this.spawn('glow', this.tex.ring, c.dust, x, floor, { dur: 640, from: (R * 1.4) / RING_PX, to: (R * 8.4) / RING_PX, sy: 0.22, a0: 0.6, ease: 'cubic', delay: 60 });
    // The dust: puffs rolling out left and right along the ground, swelling as they thin.
    for (let i = 0; i < o.dust; i++) {
      const dir = i % 2 ? 1 : -1;
      const sp = (300 + this.rnd() * 520) * big * (R / 110);
      const sz = ((R * (0.34 + this.rnd() * 0.3) * big) / PUFF_PX);
      this.spawn('body', this.tex.puff, c.dust, x + dir * this.r * (0.35 + this.rnd() * 0.5), floor + (this.rnd() - 0.5) * this.r * 0.16, {
        dur: 460 + this.rnd() * 260, from: sz, to: sz * 2.1, a0: 0.78, ease: 'cubic',
        vx: dir * sp, vy: -(30 + this.rnd() * 150) * (R / 110), drag: 0.02, rot: this.rnd() * Math.PI * 2, spin: (this.rnd() - 0.5) * 0.004,
      });
    }
    // A few stars knocked out of the blow.
    this.burst('core', this.tex.star, [c.spark, 0xffffff, c.side], x, top, o.big ? 7 : 5, {
      speed: 560 * big * (R / 110), dir: -Math.PI / 2, spread: 3.4, life: 420, size: (R * 0.34 * big) / STAR_PX, grav: 900, drag: 0.2, spin: 0.02,
    });
    // The piano's keys: thrown up and out in a fan, to fall and bounce.
    const n = Math.max(0, Math.round(o.keys));
    for (let i = 0; i < n; i++) {
      const black = i % 3 === 2;
      const s = this.take('body', black ? this.tex.keyBlack : this.tex.keyWhite, 0xffffff);
      if (!s) break;
      const a = -Math.PI / 2 + ((i + 0.5) / n - 0.5) * 2.5 + (this.rnd() - 0.5) * 0.25;
      const sp = this.look.keySpeed * this.unit * (0.6 + this.rnd() * 0.6);
      s.rotation = this.rnd() * Math.PI * 2;
      this.keys.push({
        s, x: x + Math.cos(a) * this.r * 0.7, y: this.d.y - this.r * 0.1, vx: Math.cos(a) * sp * 1.15, vy: Math.sin(a) * sp, spin: (this.rnd() - 0.5) * 0.03,
        floor: this.d.y + this.r * (0.95 + this.rnd() * 0.3), bounces: 0, age: 0, life: 820 + this.rnd() * 320, k: (this.r * (black ? 0.42 : 0.5)) / KEY_H,
      });
    }
    this.drawObject();
  }

  /** The pop: the object is tossed off the portrait toward `dirX` (-1 left, +1 right), turning as it falls away. */
  pop(dirX: number): void {
    const ob = this.obj;
    if (!ob || ob.state === 'tip') return;
    const piano = ob.kind === 'piano';
    const w = (piano ? PIANO_W : ANVIL_W) * ob.k, h = (piano ? PIANO_H : ANVIL_H) * ob.k;
    // Turn about its middle from here on (it rested on its foot): re-anchor without moving it.
    const footX = piano ? 0.5 : ANVIL_FOOT_X, base = piano ? PIANO_BASE : ANVIL_BASE;
    ob.cx = ob.s.position.x + (0.5 - footX) * w;
    ob.cy = ob.s.position.y + (0.5 - base) * h;
    ob.s.anchor.set(0.5);
    const dir = dirX < 0 ? -1 : 1;
    const heavy = piano ? 0.78 : 1;
    ob.vx = dir * this.look.tipSpeed * 0.5 * heavy * this.unit;
    ob.vy = -this.look.tipSpeed * heavy * this.unit;
    ob.spin = dir * (piano ? 0.0022 : 0.0036);
    ob.state = 'tip'; ob.age = 0;
    this.drawObject();
  }

  protected override tick(dt: number): boolean {
    const sh = this.shadow;
    if (sh) {
      sh.age += dt;
      if (sh.fade >= 0) sh.fade += dt;
      else if (sh.age > sh.dur + STRAY_MS) sh.fade = 0; // never left on screen if the landing was skipped
      if (sh.fade >= 90) { this.give(sh.s); this.shadow = null; } else this.drawShadow();
    }
    const ob = this.obj;
    if (ob) {
      ob.age += dt;
      if (ob.state === 'tip') {
        const sec = dt / 1000;
        ob.vy += this.look.tipGravity * this.unit * sec;
        ob.cx += ob.vx * sec; ob.cy += ob.vy * sec;
        if (ob.age >= this.look.tipMs) { this.give(ob.s); this.obj = null; }
      } else if (ob.age > ob.dur + STRAY_MS) { this.give(ob.s); this.obj = null; } // never left on screen if the pop was skipped
      if (this.obj) this.drawObject();
    }
    const keys = this.keys;
    if (keys.length) {
      const sec = dt / 1000;
      const g = this.look.keyGravity * this.unit;
      for (let i = keys.length - 1; i >= 0; i--) {
        const q = keys[i]!;
        q.age += dt;
        if (q.age >= q.life) { this.give(q.s); keys.splice(i, 1); continue; }
        q.vy += g * sec;
        q.x += q.vx * sec; q.y += q.vy * sec;
        if (q.y > q.floor && q.vy > 0) {
          q.y = q.floor;
          if (q.bounces < 2) { q.vy *= -0.46; q.vx *= 0.7; q.spin *= 0.6; q.bounces++; } else { q.vy = 0; q.vx *= 0.8; q.spin = 0; }
        }
        q.s.position.set(q.x, q.y);
        q.s.rotation += q.spin * dt;
        q.s.scale.set(q.k);
        q.s.alpha = 1 - clamp01((q.age - q.life * 0.7) / (q.life * 0.3));
      }
    }
    return this.shadow !== null || this.obj !== null || keys.length > 0;
  }

  private drawShadow(): void {
    const sh = this.shadow;
    if (!sh) return;
    const u = clamp01(sh.age / sh.dur);
    // It swells faster as the thing nears (the object is accelerating), and darkens with it.
    const e = 0.35 * u + 0.65 * u * u;
    const rad = sh.r0 + (sh.r1 - sh.r0) * e;
    sh.s.position.set(this.d.x, this.d.y + this.lift); // it stays on the portrait as it ducks
    sh.s.scale.set((rad * 2) / SHADOW_PX, (rad * 2 * 0.86) / SHADOW_PX);
    const out = sh.fade >= 0 ? 1 - clamp01(sh.fade / 90) : 1;
    sh.s.alpha = this.look.shadowAlpha * (0.62 + 0.38 * u) * clamp01(sh.age / 90) * out;
  }

  private drawObject(): void {
    const ob = this.obj;
    if (!ob) return;
    const s = ob.s;
    if (ob.state === 'fall') {
      const u = clamp01(ob.age / ob.dur);
      const e = 0.3 * u + 0.7 * u * u; // already moving when it enters, faster all the way down
      s.position.set(ob.x, ob.y0 + (ob.y1 - ob.y0) * e);
      s.scale.set(ob.k * 0.94, ob.k * 1.1); // stretched by its speed
      s.rotation = 0; s.alpha = 1;
    } else if (ob.state === 'rest') {
      // It rides the top of the flattened portrait, and gives a little under its own weight as it lands.
      const give = 0.14 * Math.exp(-ob.age / 55) * Math.cos(2 * Math.PI * 7 * (ob.age / 1000));
      s.position.set(ob.x, this.d.y + this.r * anvilRestOffset(this.sy));
      s.scale.set(ob.k * (1 + give * 0.6), ob.k * (1 - give));
      s.rotation = 0; s.alpha = 1;
    } else {
      s.position.set(ob.cx, ob.cy);
      s.scale.set(ob.k);
      s.rotation = ob.spin * ob.age;
      s.alpha = 1 - clamp01((ob.age - this.look.tipMs * 0.55) / (this.look.tipMs * 0.45));
    }
  }

  protected override clearOwn(): void {
    if (this.obj) { this.give(this.obj.s); this.obj = null; }
    if (this.shadow) { this.give(this.shadow.s); this.shadow = null; }
    for (const q of this.keys) this.give(q.s);
    this.keys = [];
  }
}
