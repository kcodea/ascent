/**
 * A SMALL POOLED PIXI SCENE for a hero attack (added 2026-09-29 with the three Rare attacks: Coin Flick, Boomerang and
 * Bubble Pop share it; the Legendary styles keep their own bespoke scenes). A plain scene graph with no renderer, so it
 * runs (and is tested) headless.
 *
 * LAYERS, bottom to top: `under` (normal) | `glow` (additive) | `body` (normal) | `core` (additive), so a scene batches
 * in four runs whatever it draws. Every sprite is POOLED per layer (hidden and reused) and bounded by `maxSprites`;
 * textures are the caller's and are PRE-WARMED at construction (one near-invisible sprite each for the first few hundred
 * ms, while the damage formation is still playing), so no texture's first use is on a hot beat.
 *
 * An `Fx` is a fire-and-forget sprite with a tiny life of its own: a scale tween, an alpha envelope, drift with drag and
 * gravity, spin, an edge-on FLIP (scale.x = cos of a turning angle: a coin or a leaf tumbling, flat 2D), stretch along
 * its velocity (a droplet), and it can ride the struck portrait's knockback (`follow`). A subclass draws its own hero
 * objects in `tick()` and reports whether they still draw.
 *
 * Contract: positions are the overlay's px; `setCamera` is the camera mirror (only used when the canvas is NOT already
 * inside the camera element; see `stageCamera.ts`); `update` returns whether anything still draws; `destroy()` leaves
 * nothing behind. Scatter is seeded (a replay throws the same sparks).
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import { clamp01, easeOutCubic, easeOutQuint, seededRng } from './easing';

export type FxLayer = 'under' | 'glow' | 'body' | 'core';
const LAYERS: readonly [FxLayer, 'normal' | 'add'][] = [['under', 'normal'], ['glow', 'add'], ['body', 'normal'], ['core', 'add']];
const BLEND: Record<FxLayer, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<FxLayer, 'normal' | 'add'>;

/** How an Fx's opacity moves over its life: fade out; rise to a peak then fade (`punch`); hold then fade (`hold`). */
export type FxAlpha = 'out' | 'punch' | 'hold';

export interface FxOpts {
  dur: number;
  /** Scale at birth and at the end (texture px -> the stage scale is folded in by the pool). */
  from: number;
  to: number;
  /** Peak opacity. */
  a0: number;
  mode?: FxAlpha;
  /** Where the punch peaks (0..1 of the life). */
  peakAt?: number;
  /** The scale tween: `quint` (fast then settle, the default), `cubic`, or `linear`. */
  ease?: 'quint' | 'cubic' | 'linear';
  /** y scale as a fraction of x (1 = round). */
  sy?: number;
  rot?: number;
  /** Radians per ms. */
  spin?: number;
  /** An edge-on flip: radians per ms of the turning angle (scale.x = |cos|; 0 = none). */
  flip?: number;
  /** Ms before it appears. */
  delay?: number;
  /** Drift (px/s at stage scale 1), its drag per second (1 = none) and gravity (px/s^2 at stage scale 1). */
  vx?: number; vy?: number; drag?: number; grav?: number;
  /** Stretch along the velocity (a droplet or a streak): rotation follows the heading. */
  align?: boolean;
  /** Rides the struck portrait's knockback. */
  follow?: boolean;
  /** A tint to shade toward as the flip turns edge-on (a coin's rim is darker). */
  edgeTint?: number;
}

interface Fx {
  s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: FxAlpha; peakAt: number;
  ease: 'quint' | 'cubic' | 'linear'; sy: number; spin: number; flip: number; phase: number; delay: number;
  vx: number; vy: number; drag: number; grav: number; align: boolean; follow: boolean; x: number; y: number;
  tint: number; edgeTint: number;
}

/** Blend two 0xRRGGBB colours (`t` = 0 is `a`). Local and allocation-free. */
function mix(a: number, b: number, t: number): number {
  const k = clamp01(t);
  const ch = (s: number): number => { const va = (a >> s) & 0xff, vb = (b >> s) & 0xff; return Math.round(va + (vb - va) * k) & 0xff; };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export class FxPool {
  readonly root = new Container();
  protected readonly layers: Record<FxLayer, Container>;
  private readonly free: Record<FxLayer, Sprite[]>;
  private readonly layerOf = new Map<Container, FxLayer>();
  private used = 0;
  private fx: Fx[] = [];
  private warm: Sprite[] = [];
  private warmLeft = 0;
  protected destroyed = false;
  protected fox = 0;
  protected foy = 0;
  protected readonly rnd: () => number;

  constructor(label: string, warmTextures: readonly Texture[], protected readonly scale = 1, seed = 1, readonly maxSprites = 400) {
    this.root.eventMode = 'none';
    this.root.label = label;
    this.layers = {} as Record<FxLayer, Container>;
    this.free = {} as Record<FxLayer, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `${label}-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.layerOf.set(c, id);
      this.free[id] = [];
    }
    this.rnd = seededRng(seed);
    // PRE-WARM: every texture on the GPU while the damage formation still plays (no first-play spike on a hot beat).
    for (const t of warmTextures) {
      const s = this.take('core', t, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
  }

  /** Sprites alive (including the pre-warm). */
  get liveSprites(): number { return this.used; }
  /** Fire-and-forget effects alive. */
  get liveFx(): number { return this.fx.length; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) for (const ch of this.layers[id].children) if (ch instanceof Sprite) n++; return n; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  /** The struck portrait's knockback this frame (overlay px): `follow` effects ride it. */
  setFoeOffset(dx: number, dy: number): void { this.fox = Number.isFinite(dx) ? dx : 0; this.foy = Number.isFinite(dy) ? dy : 0; }

  // ── the pool ───────────────────────────────────────────────────────────────────────────────────────────────

  protected take(layer: FxLayer, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= this.maxSprites) return null;
    let s = this.free[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  protected give(s: Sprite | null): void {
    if (!s || !s.visible) return;
    const layer = (s.parent && this.layerOf.get(s.parent)) || 'core';
    s.visible = false; this.free[layer].push(s); this.used--;
  }

  /** Spawn a fire-and-forget effect at (x, y). Null when the pool is full (the effect is simply skipped). */
  protected spawn(layer: FxLayer, t: Texture, tint: number, x: number, y: number, o: FxOpts): Sprite | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    const S = this.scale;
    const f: Fx = {
      s, age: 0, dur: Math.max(1, o.dur), from: o.from, to: o.to, a0: o.a0, mode: o.mode ?? 'out', peakAt: o.peakAt ?? 0.2,
      ease: o.ease ?? 'quint', sy: o.sy ?? 1, spin: o.spin ?? 0, flip: o.flip ?? 0, phase: this.rnd() * Math.PI, delay: o.delay ?? 0,
      vx: (o.vx ?? 0) * S, vy: (o.vy ?? 0) * S, drag: o.drag ?? 1, grav: (o.grav ?? 0) * S, align: o.align ?? false, follow: o.follow ?? false,
      x, y, tint, edgeTint: o.edgeTint ?? tint,
    };
    s.rotation = o.rot ?? 0;
    s.position.set(x + (f.follow ? this.fox : 0), y + (f.follow ? this.foy : 0));
    s.scale.set(f.from * S, f.from * S * f.sy);
    s.alpha = f.mode === 'punch' || f.delay > 0 ? 0 : f.a0;
    this.fx.push(f);
    return s;
  }

  /** A burst of small particles thrown from a point (sparkles, droplets, chips). `dir` undefined = every way. */
  protected burst(layer: FxLayer, t: Texture, tints: readonly number[], x: number, y: number, n: number, o: {
    speed: number; dir?: number; spread?: number; life: number; size: number; grav?: number; drag?: number; align?: boolean; spin?: number; flip?: number; lift?: number; edgeTint?: number; mode?: FxAlpha; to?: number;
  }): void {
    for (let i = 0; i < n; i++) {
      const a = o.dir === undefined ? this.rnd() * Math.PI * 2 : o.dir + (this.rnd() - 0.5) * (o.spread ?? 1.4);
      const sp = o.speed * (0.45 + this.rnd() * 0.75);
      const sz = o.size * (0.6 + this.rnd() * 0.7);
      this.spawn(layer, t, tints[i % tints.length]!, x, y, {
        dur: o.life * (0.7 + this.rnd() * 0.6), from: sz, to: sz * (o.to ?? 0.4), a0: 1, mode: o.mode ?? 'out', ease: 'linear',
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.lift ?? 0), drag: o.drag ?? 0.3, grav: o.grav ?? 0, align: o.align ?? false,
        rot: this.rnd() * Math.PI * 2, spin: o.spin ? (this.rnd() - 0.5) * o.spin : 0, flip: o.flip ? o.flip * (0.6 + this.rnd() * 0.8) : 0,
        edgeTint: o.edgeTint,
      });
    }
  }

  /** The subclass's own objects, advanced by `dt` ms. Returns whether any still draw. */
  protected tick(dt: number): boolean { void dt; return false; }

  /** Drop the subclass's own objects (a cancel). */
  protected clearOwn(): void { /* the subclass's */ }

  /** Advance everything by `dt` ms (the sequence clock's time, already at speed). Returns whether anything still draws. */
  update(dt: number): boolean {
    if (this.destroyed) return false;
    const S = this.scale;
    const sec = dt / 1000;
    if (this.warmLeft > 0) {
      this.warmLeft -= dt;
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; }
    }
    const own = this.tick(dt);
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= dt; if (q.delay > 0) continue; }
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      if (q.vx || q.vy || q.grav) {
        const damp = q.drag === 1 ? 1 : Math.pow(q.drag, sec);
        q.vx *= damp; q.vy = q.vy * damp + q.grav * sec;
        q.x += q.vx * sec; q.y += q.vy * sec;
      }
      const e = q.ease === 'linear' ? u : q.ease === 'cubic' ? easeOutCubic(u) : easeOutQuint(u);
      const sc = (q.from + (q.to - q.from) * e) * S;
      let sx = sc;
      if (q.flip) {
        const c = Math.cos(q.phase + q.age * q.flip);
        sx = sc * Math.max(0.1, Math.abs(c));
        if (q.edgeTint !== q.tint) q.s.tint = mix(q.edgeTint, q.tint, Math.abs(c));
      }
      if (q.align) {
        const v = Math.hypot(q.vx, q.vy);
        q.s.rotation = Math.atan2(q.vy, q.vx);
        q.s.scale.set(sc * (1 + Math.min(1.4, v / (900 * S))), sc * q.sy);
      } else {
        q.s.scale.set(sx, sc * q.sy);
        if (q.spin) q.s.rotation += q.spin * dt;
      }
      q.s.position.set(q.x + (q.follow ? this.fox : 0), q.y + (q.follow ? this.foy : 0));
      q.s.alpha = q.mode === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.mode === 'hold' ? q.a0 * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4)
          : q.a0 * (1 - u * u);
      if (u >= 1) { this.give(q.s); this.fx.splice(i, 1); }
    }
    return own || this.fx.length > 0;
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    this.clearOwn();
    for (const q of this.fx) this.give(q.s);
    for (const s of this.warm) this.give(s);
    this.fx = []; this.warm = [];
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const [id] of LAYERS) {
      this.free[id].length = 0;
      this.layers[id].removeChildren().forEach((c) => c.destroy());
    }
    this.root.removeChildren().forEach((c) => c.destroy());
    this.root.destroy();
  }
}
