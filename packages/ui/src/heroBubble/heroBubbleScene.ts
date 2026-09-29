/**
 * THE BUBBLE POP SCENE: everything Bubble Pop draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so it
 * runs (and is tested) headless. `heroBubble.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * The BUBBLE is the subject: an iridescent FILM (its colours slowly turning), a SHEEN of reflections that stays upright
 * over it, and a faint pastel glow. It wobbles the whole time (a squash one way, a stretch the other, opacity-free:
 * transform only). It swells at the hand, drifts, swells round the struck face (riding its knockback), strains, and
 * POPS: a quick ring of light, droplets flung from its rim, a fizz of tiny bubbles, and on Big a splash ring.
 */
import type { Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeOutBack, easeOutCubic, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { driftPos, type BubbleDrift } from './heroBubbleConfig';
import { FILM_D } from './heroBubbleTextures';

export interface HeroBubbleTextures extends HeroArcanaTextures {
  film: Texture;
  sheen: Texture;
  drop: Texture;
  tiny: Texture;
}

export interface BubbleColors { film: number; pink: number; mint: number; lilac: number; sky: number; side: number }

export interface BubbleLook {
  filmSpin: number;
  sheen: number;
  dropGravity: number;
  dropSpeed: number;
}

/** Hard cap on sprites alive at once (a big pop peaks well under 120). */
export const MAX_BUBBLE_SPRITES = 240;
const GLOW_PX = 128;
const RING_PX = 160;

type Phase = 'blow' | 'drift' | 'engulf' | 'hold';

interface Bubble {
  film: Sprite; sheen: Sprite; glow: Sprite;
  phase: Phase;
  age: number;
  dur: number;
  /** Radius (px) now, and the radius the phase eases from / to. */
  r: number; r0: number; r1: number;
  x: number; y: number;
  drift: BubbleDrift | null;
  /** The engulf centre (rides the portrait's knockback). */
  cx: number; cy: number;
  wobble: number;
  wob: number;
  /** A little one of the stream (pops by itself on arrival). */
  tiny: boolean;
}

export class HeroBubbleScene extends FxPool {
  private main: Bubble | null = null;
  private stream: (Bubble | null)[] = [];

  constructor(private readonly tex: HeroBubbleTextures, private readonly colors: BubbleColors, private readonly look: BubbleLook, scale = 1, seed = 1) {
    super('heroBubble', [tex.glow, tex.ring, tex.star, tex.film, tex.sheen, tex.drop, tex.tiny], scale, seed, MAX_BUBBLE_SPRITES);
  }

  get hasBubble(): boolean { return this.main !== null; }
  get phase(): Phase | null { return this.main?.phase ?? null; }
  get bubbleRadius(): number { return this.main?.r ?? 0; }
  get streamBubbles(): number { let n = 0; for (const b of this.stream) if (b) n++; return n; }

  private make(x: number, y: number, r: number, wobble: number, tiny: boolean): Bubble | null {
    const glow = this.take('glow', this.tex.glow, this.colors.lilac);
    const film = this.take('body', this.tex.film, this.colors.film);
    const sheen = this.take('core', this.tex.sheen, 0xffffff);
    if (!glow || !film || !sheen) { this.give(glow); this.give(film); this.give(sheen); return null; }
    film.rotation = this.rnd() * Math.PI * 2;
    const b: Bubble = { film, sheen, glow, phase: 'blow', age: 0, dur: 1, r, r0: r, r1: r, x, y, drift: null, cx: x, cy: y, wobble, wob: this.rnd() * 6, tiny };
    this.pose(b);
    return b;
  }

  /** The main bubble starts to swell at the hand, to radius `rPx` over `ms`. */
  blow(hand: Pt, rPx: number, ms: number, wobble: number): void {
    if (this.main) return;
    const b = this.make(hand.x, hand.y, rPx * 0.1, wobble, false);
    if (!b) return;
    b.r1 = rPx; b.dur = Math.max(1, ms);
    this.main = b;
  }

  /** It leaves the hand along `drift`. */
  release(drift: BubbleDrift): void {
    const b = this.main;
    if (!b) return;
    b.phase = 'drift'; b.age = 0; b.dur = Math.max(1, drift.ms); b.drift = drift; b.r0 = b.r1 = b.r;
    this.spawn('core', this.tex.star, 0xffffff, drift.a.x, drift.a.y, { dur: 180, from: 0.25, to: 0.6, a0: 0.7, mode: 'punch', peakAt: 0.3 });
  }

  /** A little stream bubble leaves the hand along `drift` (radius `rPx`); it pops by itself as it arrives. */
  streamOut(drift: BubbleDrift, rPx: number, wobble: number): void {
    const b = this.make(drift.a.x, drift.a.y, rPx, wobble, true);
    if (!b) return;
    b.phase = 'drift'; b.dur = Math.max(1, drift.ms); b.drift = drift;
    this.stream.push(b);
  }

  /** It swells round the face: centre `c`, to radius `rPx` over `ms`, then strains until the pop. */
  engulf(c: Pt, rPx: number, ms: number, holdMs: number): void {
    const b = this.main;
    if (!b) return;
    b.phase = 'engulf'; b.age = 0; b.dur = Math.max(1, ms); b.cx = c.x; b.cy = c.y; b.r0 = b.r; b.r1 = rPx;
    b.drift = null;
    b.x = c.x; b.y = c.y;
    void holdMs;
  }

  /** A stream bubble blips on the face (a tick): a small ring, a few droplets and a tiny bubble. */
  blip(i: number): void {
    const b = this.stream[i];
    if (!b) return;
    const at = { x: b.x, y: b.y };
    const r = b.r;
    this.dropBubble(b);
    this.stream[i] = null;
    this.popFx(at, r, { drops: 5, tinies: 2, splash: 0, strength: 0.6 });
  }

  /** THE pop: a ring of light, droplets flung from the rim, a fizz of tiny bubbles, and (big) a splash ring. */
  pop(o: { drops: number; tinies: number; splash: number }): void {
    const b = this.main;
    if (!b) return;
    const at = { x: b.x + this.fox, y: b.y + this.foy };
    const r = b.r;
    this.dropBubble(b);
    this.main = null;
    this.popFx(at, r, { ...o, strength: 1 });
  }

  private popFx(at: Pt, r: number, o: { drops: number; tinies: number; splash: number; strength: number }): void {
    const c = this.colors;
    const S = this.scale;
    const tints = [c.sky, c.pink, c.mint, c.lilac];
    // The film snapping: a quick bright ring at the bubble's own size, and a soft flash.
    this.spawn('core', this.tex.ring, 0xffffff, at.x, at.y, { dur: 160, from: (r * 2) / RING_PX / S, to: (r * 2.4) / RING_PX / S, a0: 0.5, ease: 'cubic' });
    this.spawn('glow', this.tex.glow, c.lilac, at.x, at.y, { dur: 220, from: (r * 1.6) / GLOW_PX / S, to: (r * 2.4) / GLOW_PX / S, a0: 0.45 * o.strength, mode: 'punch', peakAt: 0.1 });
    // Droplets flung off the rim, outward, with a little lift, falling.
    for (let i = 0; i < o.drops; i++) {
      const a = (i / Math.max(1, o.drops)) * Math.PI * 2 + (this.rnd() - 0.5) * 0.4;
      const x = at.x + Math.cos(a) * r * 0.95, y = at.y + Math.sin(a) * r * 0.95;
      const sp = this.look.dropSpeed * (0.55 + this.rnd() * 0.7) * o.strength;
      const sz = (0.5 + this.rnd() * 0.45) * (0.7 + 0.3 * o.strength);
      this.spawn('body', this.tex.drop, tints[i % 4]!, x, y, {
        dur: 420 + this.rnd() * 260, from: sz, to: sz * 0.5, a0: 1, ease: 'linear',
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120 * o.strength, drag: 0.35, grav: this.look.dropGravity, align: true,
      });
    }
    // The fizz: tiny bubbles drifting out and up, growing a touch, then gone.
    for (let i = 0; i < o.tinies; i++) {
      const a = this.rnd() * Math.PI * 2, d = Math.sqrt(this.rnd()) * r * 0.8;
      const sz = (0.18 + this.rnd() * 0.3) * (0.6 + 0.4 * o.strength);
      this.spawn('body', this.tex.tiny, tints[(i + 1) % 4]!, at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, {
        dur: 520 + this.rnd() * 380, from: sz * 0.5, to: sz, a0: 0.95, mode: 'hold', ease: 'cubic',
        vx: Math.cos(a) * 60, vy: Math.sin(a) * 40 - 70, drag: 0.5, grav: -40, delay: this.rnd() * 90,
      });
    }
    if (o.splash > 0) {
      // The splash ring: a wide soft ring racing out from the rim, and a thinner echo behind it.
      this.spawn('glow', this.tex.ring, c.sky, at.x, at.y, { dur: 480, from: (r * 2.1) / RING_PX / S, to: (r * 3.6 * o.splash) / RING_PX / S, a0: 0.5, ease: 'cubic' });
      this.spawn('glow', this.tex.ring, c.pink, at.x, at.y, { dur: 520, from: (r * 1.9) / RING_PX / S, to: (r * 3 * o.splash) / RING_PX / S, a0: 0.35, ease: 'cubic', delay: 80 });
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        this.spawn('core', this.tex.star, 0xffffff, at.x + Math.cos(a) * r * 1.1, at.y + Math.sin(a) * r * 1.1, { dur: 240, from: 0.15, to: 0.55, a0: 0.9, mode: 'punch', peakAt: 0.3, delay: 60 + i * 50 });
      }
    }
  }

  protected override tick(dt: number): boolean {
    const b = this.main;
    if (b) this.step(b, dt);
    let live = 0;
    for (let i = 0; i < this.stream.length; i++) {
      const s = this.stream[i];
      if (!s) continue;
      live++;
      this.step(s, dt);
    }
    if (!live && this.stream.length) this.stream = [];
    return b !== null || live > 0;
  }

  private step(b: Bubble, dt: number): void {
    b.age += dt;
    b.wob += dt;
    b.film.rotation += this.look.filmSpin * dt;
    const u = clamp01(b.age / b.dur);
    switch (b.phase) {
      case 'blow':
        b.r = b.r0 + (b.r1 - b.r0) * easeOutBack(u, 1.4);
        break;
      case 'drift': {
        const p = b.drift ? driftPos(b.drift, u) : { x: b.x, y: b.y };
        b.x = p.x; b.y = p.y;
        break;
      }
      case 'engulf':
        b.r = b.r0 + (b.r1 - b.r0) * easeOutBack(u, 1.2);
        if (u >= 1) { b.phase = 'hold'; b.age = 0; b.r0 = b.r1; }
        break;
      case 'hold':
        // The film strains: it breathes a little bigger and wobbles faster until it pops.
        b.r = b.r1 * (1 + 0.025 * easeOutCubic(Math.min(1, b.age / 300)));
        break;
    }
    this.pose(b);
  }

  private pose(b: Bubble): void {
    const onFace = b.phase === 'engulf' || b.phase === 'hold';
    const x = b.x + (onFace ? this.fox : 0), y = b.y + (onFace ? this.foy : 0);
    const strain = b.phase === 'hold' ? Math.min(1, b.age / 250) : 0;
    const hz = 0.011 + 0.018 * strain;
    const w = (b.wobble + 0.03 * strain) * Math.sin(b.wob * hz);
    const k = (b.r * 2) / FILM_D;
    b.film.position.set(x, y); b.film.scale.set(k * (1 + w), k * (1 - w));
    b.sheen.position.set(x, y); b.sheen.scale.set(k * (1 + w), k * (1 - w));
    b.sheen.alpha = this.look.sheen;
    b.glow.position.set(x, y); b.glow.scale.set((b.r * 2.4) / GLOW_PX); b.glow.alpha = b.tiny ? 0.12 : 0.22;
  }

  private dropBubble(b: Bubble): void {
    this.give(b.film); this.give(b.sheen); this.give(b.glow);
  }

  protected override clearOwn(): void {
    if (this.main) { this.dropBubble(this.main); this.main = null; }
    for (const s of this.stream) if (s) this.dropBubble(s);
    this.stream = [];
  }
}
