/**
 * THE BOOMERANG SCENE: everything the Boomerang draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so
 * it runs (and is tested) headless. `heroBoomerang.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * The BOOMERANG is the subject: a carved wooden body with teal inlay, spinning about its middle, a faint whirl smear (its
 * motion blur, strongest when it is fastest), a soft teal glow, and a teal ribbon trail drawn along its own flight sampled
 * back in time (`RibbonTrail`), so the curve out and the swing home read as one clean loop. A THWACK is a crisp comic
 * impact star, a teal ring, wood chips and a little dust. A CATCH is a small ring and glint at the hand as the boomerang
 * tucks away.
 */
import type { Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, mixColor, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { RibbonTrail } from '../heroAttack/ribbonTrail';
import { boomerangPos, type BoomerangMotion } from './heroBoomerangConfig';
import { BOOM_D } from './heroBoomerangTextures';

export interface HeroBoomerangTextures extends HeroArcanaTextures {
  boomBody: Texture;
  boomInlay: Texture;
  boomWhirl: Texture;
  chip: Texture;
  burst: Texture;
}

export interface BoomerangColors { wood: number; grain: number; teal: number; tealDeep: number; flash: number; side: number }

export interface BoomerangLook {
  /** The boomerang's span, px at stage scale 1. */
  px: number;
  trailMs: number;
  trailWidth: number;
  /** The whirl smear's peak opacity (0 = none). */
  whirl: number;
  thwack: number;
  catchMs: number;
}

/** Hard cap on sprites alive at once (a big double thwack peaks well under 100). */
export const MAX_BOOMERANG_SPRITES = 200;
const GLOW_PX = 128;
const RING_PX = 160;
const STAR_PX = 48;

interface Boom {
  m: BoomerangMotion;
  sample: (ms: number) => Pt;
  age: number;
  k: number;
  hz: number;
  rot: number;
  body: Sprite; inlay: Sprite; whirl: Sprite; glow: Sprite;
  trail: RibbonTrail | null; core: RibbonTrail | null;
  /** Ms since the catch (-1 = still flying). */
  caught: number;
  lastX: number; lastY: number;
  /** A short wobble after the thwack. */
  jolt: number;
}

export class HeroBoomerangScene extends FxPool {
  private booms: Boom[] = [];
  private trails: RibbonTrail[] = [];
  private cores: RibbonTrail[] = [];
  private glint: { s: Sprite; age: number; dur: number } | null = null;

  constructor(private readonly tex: HeroBoomerangTextures, private readonly colors: BoomerangColors, private readonly look: BoomerangLook, scale = 1, seed = 1) {
    super('heroBoomerang', [tex.glow, tex.ring, tex.star, tex.spark, tex.boomBody, tex.boomInlay, tex.boomWhirl, tex.chip, tex.burst, tex.ribbonSoft, tex.ribbonBody], scale, seed, MAX_BOOMERANG_SPRITES);
  }

  get liveBooms(): number { return this.booms.length; }
  get flyingBooms(): number { let n = 0; for (const b of this.booms) if (b.caught < 0) n++; return n; }
  get liveTrails(): number { let n = 0; for (const t of [...this.trails, ...this.cores]) if (t.mesh.visible) n++; return n; }

  /** The hero winds back: a soft teal glint gathers at the throwing hand. */
  startCharge(hand: Pt, durMs: number): void {
    if (this.glint) return;
    const s = this.take('core', this.tex.star, this.colors.teal);
    if (!s) return;
    s.position.set(hand.x, hand.y); s.alpha = 0;
    this.glint = { s, age: 0, dur: Math.max(1, durMs) };
  }

  /** A boomerang leaves the hand along `m`. `age0` = ms already elapsed. */
  throw(m: BoomerangMotion, size: number, spinHz: number, idx: number, age0 = 0): void {
    if (this.glint) { this.give(this.glint.s); this.glint = null; }
    const c = this.colors;
    const S = this.scale;
    this.spawn('glow', this.tex.glow, c.teal, m.rel.x, m.rel.y, { dur: 200, from: 0.3, to: 0.9, a0: 0.55, mode: 'punch', peakAt: 0.15 });
    const ring = this.spawn('glow', this.tex.ring, c.teal, m.rel.x, m.rel.y, { dur: 220, from: 0.12, to: 0.5, a0: 0.7, sy: 0.45 });
    if (ring) ring.rotation = Math.atan2(m.co.y - m.rel.y, m.co.x - m.rel.x) + Math.PI / 2;
    const whirl = this.take('under', this.tex.boomWhirl, c.wood);
    const glow = this.take('glow', this.tex.glow, c.teal);
    const body = this.take('body', this.tex.boomBody, c.wood);
    const inlay = this.take('body', this.tex.boomInlay, c.teal);
    if (!whirl || !glow || !body || !inlay) { for (const s of [whirl, glow, body, inlay]) this.give(s); return; }
    const trail = this.look.trailMs > 0 ? this.trailAt(idx, false) : null;
    const core = this.look.trailMs > 0 ? this.trailAt(idx, true) : null;
    const k = (this.look.px * size * S) / BOOM_D;
    const b: Boom = {
      m, sample: (ms) => boomerangPos(m, ms), age: Math.max(0, age0), k, hz: spinHz, rot: idx * 1.3, body, inlay, whirl, glow, trail, core,
      caught: -1, lastX: m.rel.x, lastY: m.rel.y, jolt: -1,
    };
    this.booms.push(b);
    this.draw(b, 0);
  }

  /** The two trails a boomerang slot owns (made once, reused). */
  private trailAt(idx: number, core: boolean): RibbonTrail {
    const list = core ? this.cores : this.trails;
    let t = list[idx];
    if (!t) {
      t = core
        ? new RibbonTrail(this.layers.glow, this.tex.ribbonBody, whiten(this.colors.teal, 0.45), 'add')
        : new RibbonTrail(this.layers.glow, this.tex.ribbonSoft, mixColor(this.colors.teal, this.colors.tealDeep, 0.45), 'add');
      list[idx] = t;
    }
    return t;
  }

  /** A THWACK on the face (a tick, or the impact's own): an impact star, a teal ring, wood chips, a puff of dust. */
  thwack(idx: number, at: Pt, dir: Pt, strength: number, chips: number): void {
    const c = this.colors;
    const T = this.look.thwack * strength;
    const b = this.booms[idx];
    if (b) b.jolt = 0;
    const rot = Math.atan2(dir.y, dir.x);
    this.spawn('core', this.tex.burst, c.flash, at.x, at.y, { dur: 200, from: (70 * T) / 128, to: (125 * T) / 128, a0: 1, mode: 'punch', peakAt: 0.1, rot });
    this.spawn('body', this.tex.burst, c.teal, at.x, at.y, { dur: 240, from: (55 * T) / 128, to: (100 * T) / 128, a0: 0.55, mode: 'punch', peakAt: 0.12, rot: rot + 0.3 });
    this.spawn('glow', this.tex.glow, c.teal, at.x, at.y, { dur: 260, from: (60 * T) / GLOW_PX, to: (170 * T) / GLOW_PX, a0: 0.6, mode: 'punch', peakAt: 0.1 });
    this.spawn('glow', this.tex.ring, whiten(c.teal, 0.3), at.x, at.y, { dur: 320, from: (24 * T) / RING_PX, to: (130 * T) / RING_PX, a0: 0.85, ease: 'cubic' });
    const back = Math.atan2(-dir.y, -dir.x);
    this.burst('body', this.tex.chip, [c.wood, whiten(c.wood, 0.25), c.grain], at.x, at.y, chips, { speed: 420 * T, dir: back, spread: 2.4, life: 520, size: 0.55 * T, grav: 1300, drag: 0.4, spin: 0.05, to: 0.8, lift: 120 });
    this.burst('under', this.tex.glow, [whiten(c.wood, 0.5)], at.x, at.y, 3, { speed: 70, life: 420, size: 0.35 * T, drag: 0.3, to: 1.4, mode: 'hold' });
  }

  /** The catch: a small ring and glint at the hand; the boomerang tucks away. */
  catchAt(idx: number): void {
    const b = this.booms[idx];
    if (!b || b.caught >= 0) return;
    b.caught = 0;
    const c = this.colors;
    const at = b.m.rel;
    this.spawn('glow', this.tex.ring, c.teal, at.x, at.y, { dur: 260, from: 0.1, to: 0.55, a0: 0.9, ease: 'cubic' });
    this.spawn('core', this.tex.star, c.flash, at.x, at.y, { dur: 220, from: 0.4, to: 1.1, a0: 1, mode: 'punch', peakAt: 0.2, rot: 0.3 });
    this.burst('core', this.tex.star, [c.teal, c.flash], at.x, at.y, 5, { speed: 200, life: 280, size: 0.2 });
  }

  protected override tick(dt: number): boolean {
    const g = this.glint;
    if (g) {
      g.age += dt;
      const u = clamp01(g.age / g.dur);
      g.s.alpha = 0.8 * u;
      g.s.scale.set(((8 + 18 * u) * this.scale) / STAR_PX);
      g.s.rotation = u * 2;
    }
    for (let i = this.booms.length - 1; i >= 0; i--) {
      const b = this.booms[i]!;
      b.age += dt;
      if (b.caught >= 0) b.caught += dt;
      if (b.jolt >= 0) b.jolt += dt;
      if (b.caught >= this.look.catchMs) { this.dropBoom(b); this.booms.splice(i, 1); continue; }
      this.draw(b, dt);
    }
    return this.booms.length > 0 || g !== null;
  }

  private draw(b: Boom, dt: number): void {
    const p = b.sample(b.age);
    const sp = dt > 0 ? Math.hypot(p.x - b.lastX, p.y - b.lastY) / dt : 0; // px per ms
    b.lastX = p.x; b.lastY = p.y;
    // It spins hard; slower as it slows into the hand.
    const speedK = clamp01(0.45 + sp / (1.6 * this.scale));
    b.rot += b.m.spin * 2 * Math.PI * b.hz * (dt / 1000) * speedK;
    const wob = b.jolt >= 0 ? 0.35 * Math.exp(-b.jolt / 70) * Math.sin(b.jolt * 0.09) : 0;
    const tuck = b.caught >= 0 ? clamp01(b.caught / this.look.catchMs) : 0;
    const born = clamp01(b.age / 50);
    const k = b.k * (0.6 + 0.4 * born) * (1 - 0.65 * tuck);
    const a = 1 - tuck * tuck;
    pose(b.body, p, b.rot + wob, k, a);
    pose(b.inlay, p, b.rot + wob, k, a);
    b.whirl.position.set(p.x, p.y); b.whirl.rotation = b.rot; b.whirl.scale.set(k * 1.05);
    b.whirl.alpha = this.look.whirl * a * clamp01(sp / (1.2 * this.scale));
    const gk = (this.look.px * 1.7 * this.scale) / GLOW_PX;
    b.glow.position.set(p.x, p.y); b.glow.scale.set(gk); b.glow.alpha = 0.35 * a;
    if (b.trail || b.core) {
      const end = b.m.outMs + b.m.backMs;
      const ta = (b.caught >= 0 ? 1 - clamp01(b.caught / Math.max(1, this.look.catchMs * 0.8)) : 1) * clamp01(b.age / 40);
      const now = Math.min(b.age, end);
      b.trail?.draw(b.sample, now, this.look.trailMs, this.look.trailWidth * 1.6 * this.scale, 0.42 * ta);
      b.core?.draw(b.sample, now, this.look.trailMs * 0.55, this.look.trailWidth * 0.45 * this.scale, 0.75 * ta);
    }
  }

  private dropBoom(b: Boom): void {
    for (const s of [b.body, b.inlay, b.whirl, b.glow]) this.give(s);
    b.trail?.hide(); b.core?.hide();
  }

  protected override clearOwn(): void {
    for (const b of this.booms) this.dropBoom(b);
    this.booms = [];
    if (this.glint) { this.give(this.glint.s); this.glint = null; }
  }
}

function pose(s: Sprite, p: Pt, rot: number, k: number, a: number): void {
  s.position.set(p.x, p.y); s.rotation = rot; s.scale.set(k); s.alpha = a;
}
