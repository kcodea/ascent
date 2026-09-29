/**
 * THE BLAST SCENE: everything the Blast hero attack draws in Pixi, as a plain scene graph with no renderer, so it
 * runs (and is tested) headless. `heroBlast.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * Design rule (owner 2026-09-28: "thicker and cleaner animations"): FEW, BOLD elements with a consistent colour
 * language, never particle soup. White-hot cores, the attacker's side colour for glows and rings, additive light.
 *  - COMBINE: a small ring + a pinch of sparks per number landing; the slam gets a bright ring and a bloom.
 *  - CHARGE: a side-coloured ring closing in on the hero, a core that swells and throbs, a few motes spiralling in.
 *  - BOLTS: a white-hot spear head inside a big side-coloured halo, and a TAPERING TRAIL resampled along the flight
 *    path at fixed arc steps (so it is one continuous thick comet at any frame rate, not dots), plus a rare spark.
 *  - MUZZLE: a white flash, a coloured bloom and a snap ring at the hero, sparks thrown forward.
 *  - IMPACT: starts AT its brightest (the first frame is the peak): a white core burst, a white flash
 *    over the whole portrait, a coloured bloom, a crisp ring and a slower wide one, 8 long spikes, chunky sparks with
 *    gravity carried through the target, and an afterglow that lingers. Trailing bolts land smaller hits.
 *  - SUPERNOVA (Tier IV, owner 2026-09-29 "add a tier to the blast attack so they all have 4"): the colossal beam lands
 *    (a tick), holds, then POURS into the struck hero (its tail races after its front) while a wide ring and motes
 *    implode onto it; then it detonates: rays, three shockwaves (the last sweeps most of the screen), a corona.
 *
 * Contract: sprites POOLED (hidden and reused), every list bounded by `MAX_SPRITES`; textures are the caller's; the
 * positions are the overlay's px; `setCamera` mirrors the DOM camera so FX and portraits zoom together; `update`
 * returns whether anything still moves; `destroy()` leaves nothing behind. Math.random is presentation only.
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import { clamp01, easeOutCubic, easeOutQuint, whiten, type Pt } from '../heroAttack/easing';

export { easeOutCubic, easeOutQuint, whiten };

export interface HeroBlastTextures { glow: Texture; spark: Texture; streak: Texture; ring: Texture; beam: Texture }

/** Hard cap on sprites alive at once. */
export const MAX_SPRITES = 420;
/** Trail samples per bolt (the comet tail). */
export const TRAIL_SAMPLES = 16;

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number;
  life: number; max: number; from: number; to: number; alpha: number; streak: boolean;
}

/** A sprite that scales and fades in place. `punch` ramps up to `peakAt` then fades; `out` starts at full. */
interface Pulse { s: Sprite; age: number; dur: number; from: number; to: number; a0: number; peakAt: number; ease: 'out' | 'punch' }

interface Bolt {
  head: Sprite; spear: Sprite; halo: Sprite; trail: Sprite[]; from: Pt; to: Pt; ctrl: Pt; age: number; dur: number; size: number;
  lastX: number; lastY: number; sparkAcc: number;
}

/** The top tier's colossal beam: its front races to the target, it holds thick and alive, then thins out. */
/**
 * The top tier's colossal beam: its front races to the target, it holds thick and alive, then thins out, or (the
 * supernova, `drain > 0`) its TAIL races after the front, so the whole beam pours into the target over `drain` ms.
 */
interface Beam { outer: Sprite; core: Sprite; head: Sprite; from: Pt; len: number; ang: number; age: number; travel: number; hold: number; width: number; streamAcc: number; drain: number }

/** Light gathering on a point: the hero's charge, or (`reach` > 1, wider) the struck hero imploding before a supernova. */
interface Charge { core: Sprite; bloom: Sprite; ring: Sprite; x: number; y: number; age: number; dur: number; size: number; releasing: number; moteAcc: number; motes: number; reach: number }

export interface BlastColors { core: number; side: number }

/** The bolt's progress curve: leaves fast and still ACCELERATES into the target (weight on arrival). */
export const boltEase = (u: number): number => { const t = clamp01(u); return 0.3 * t + 0.7 * t * t; };

/** A point on the quadratic Bezier a -> c -> b. */
export function bezier(a: Pt, c: Pt, b: Pt, t: number): Pt {
  const m = 1 - t;
  return { x: m * m * a.x + 2 * m * t * c.x + t * t * b.x, y: m * m * a.y + 2 * m * t * c.y + t * t * b.y };
}

/** The arc control point: the midpoint pushed sideways by `curve` x the distance. */
export function arcControl(a: Pt, b: Pt, curve: number): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: (a.x + b.x) / 2 + (-dy / d) * curve * d, y: (a.y + b.y) / 2 + (dx / d) * curve * d };
}

export class HeroBlastScene {
  readonly root = new Container();
  private readonly free: Sprite[] = [];
  private used = 0;
  private particles: Particle[] = [];
  private pulses: Pulse[] = [];
  private bolts: Bolt[] = [];
  private charge: Charge | null = null;
  /** The supernova's implosion on the struck hero (a second charge slot, released by `nova`). */
  private implode: Charge | null = null;
  private beams: Beam[] = [];
  private destroyed = false;
  private readonly hot: number;

  constructor(private readonly tex: HeroBlastTextures, private readonly colors: BlastColors, private readonly scale = 1, private readonly trail = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroBlast';
    this.hot = whiten(colors.side, 0.45);
  }

  get liveSprites(): number { return this.used; }
  get pooledSprites(): number { return this.root.children.length; }
  get liveBolts(): number { return this.bolts.length + this.beams.length; }
  get charging(): boolean { return this.charge !== null || this.implode !== null; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in (see heroBlast.ts). */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  private take(t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_SPRITES) return null;
    let s = this.free.pop();
    if (!s) { s = new Sprite(t); s.blendMode = 'add'; this.root.addChild(s); }
    else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(s: Sprite): void { s.visible = false; this.free.push(s); this.used--; }

  private particle(t: Texture, tint: number, o: Omit<Particle, 's' | 'max'>): void {
    const s = this.take(t, tint);
    if (!s) return;
    s.position.set(o.x, o.y);
    this.particles.push({ ...o, s, max: o.life });
  }

  private pulse(t: Texture, tint: number, x: number, y: number, dur: number, from: number, to: number, a0: number, ease: Pulse['ease'] = 'out', peakAt = 0.25, rotation = 0): void {
    const s = this.take(t, tint);
    if (!s) return;
    s.position.set(x, y); s.rotation = rotation; s.scale.set(from * this.scale); s.alpha = ease === 'punch' ? 0 : a0;
    this.pulses.push({ s, age: 0, dur, from, to, a0, peakAt, ease });
  }

  /** The hero gathers: a ring closing in, a core swelling, motes spiralling in. Released by `fire`. */
  startCharge(x: number, y: number, durMs: number, size: number, motes: number): void {
    if (this.charge) return;
    this.charge = this.gather(x, y, durMs, size, motes, 1);
  }

  private gather(x: number, y: number, durMs: number, size: number, motes: number, reach: number): Charge | null {
    const bloom = this.take(this.tex.glow, this.colors.side);
    const core = this.take(this.tex.glow, this.colors.core);
    const ring = this.take(this.tex.ring, this.colors.side);
    if (!core || !ring || !bloom) { for (const s of [core, ring, bloom]) if (s) this.give(s); return null; }
    for (const s of [core, ring, bloom]) { s.position.set(x, y); s.alpha = 0; }
    return { core, bloom, ring, x, y, age: 0, dur: Math.max(1, durMs), size, releasing: -1, moteAcc: 0, motes, reach };
  }

  /**
   * THE SUPERNOVA'S INHALE (Tier IV): the beam pours into the struck hero while a wide ring closes in on it, light is
   * sucked in from all round and a core swells and throbs faster. Released (and replaced) by `nova`.
   */
  collapse(x: number, y: number, durMs: number, size: number, motes: number): void {
    if (this.implode) return;
    this.implode = this.gather(x, y, durMs, size, motes, 1.9);
    // A dark-bright pinch: a crisp ring snapping in from wide, so the inhale reads at a glance.
    this.pulse(this.tex.ring, this.colors.core, x, y, Math.max(1, durMs), 7 * size, 0.6 * size, 0.7, 'punch', 0.35);
  }

  /** The beam lands at a nova tier: a heavy hit that is only the opening (a tick; the blow waits for the supernova). */
  beamHit(x: number, y: number, dir: Pt, size: number): void {
    this.pulse(this.tex.glow, this.colors.core, x, y, 200, 1.4 * size, 2.6 * size, 0.95, 'out');
    this.pulse(this.tex.glow, this.colors.side, x, y, 380, 1.8 * size, 3.4 * size, 0.55, 'out');
    this.pulse(this.tex.ring, this.colors.core, x, y, 300, 0.5, 2.6 * size, 0.9);
    this.hit(x, y, dir, size);
  }

  /**
   * THE SUPERNOVA (Tier IV, on the consequence beat, layered over `impact`): the imploded light detonates. A white
   * core flash, a huge side bloom, long RAYS bursting out all round, three shockwaves (crisp, wide, and one that
   * sweeps most of the screen), a ring of fast streaks and a lingering corona. Few, bold elements; all pooled.
   */
  nova(x: number, y: number, dir: Pt, size: number, rays: number): void {
    const im = this.implode;
    if (im && im.releasing < 0) im.releasing = 0;
    const c = this.colors;
    const z = size;
    this.pulse(this.tex.glow, c.core, x, y, 260, 2 * z, 4.2 * z, 1, 'out');
    this.pulse(this.tex.glow, c.side, x, y, 820, 3 * z, 7.5 * z, 0.75, 'punch', 0.08);
    this.pulse(this.tex.ring, c.core, x, y, 380, 0.6, 5.5 * z, 1);
    this.pulse(this.tex.ring, this.hot, x, y, 640, 0.6, 9 * z, 0.85);
    this.pulse(this.tex.ring, c.side, x, y, 980, 1, 16 * z, 0.55);
    const head = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < rays; i++) {
      const a = head + (i / Math.max(1, rays)) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
      const len = (i % 2 ? 0.75 : 1.15) * z;
      const r = 150 * this.scale * len;
      this.pulse(this.tex.streak, i % 3 === 0 ? c.core : this.hot, x + Math.cos(a) * r, y + Math.sin(a) * r,
        420 + (i % 3) * 60, 4 * len, 10 * len, 0.95, 'punch', 0.12, a);
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + Math.random() * 0.3, sp = (1300 + Math.random() * 900) * this.scale;
      this.particle(this.tex.streak, i % 2 ? c.core : this.hot, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.02, grav: 0,
        life: 260 + Math.random() * 160, from: 1.4 * this.scale, to: 0.4 * this.scale, alpha: 1, streak: true,
      });
    }
    // The corona: a slow side-coloured glow that lingers after the blast, so the finale breathes out, not cuts off.
    this.pulse(this.tex.glow, c.side, x, y, 2000, 3.4 * z, 4.4 * z, 0.5, 'out');
  }

  /** One shot leaves the hero: muzzle flash + bloom + snap ring + forward sparks, and the bolt. `age0` = ms elapsed. */
  fire(from: Pt, to: Pt, travelMs: number, size: number, curve: number, age0 = 0): void {
    const ch = this.charge;
    if (ch && ch.releasing < 0) ch.releasing = 0;
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const head = Math.atan2(uy, ux);
    this.pulse(this.tex.glow, this.colors.core, from.x, from.y, 180, 0.6, 1.9 * size, 1, 'out');
    this.pulse(this.tex.glow, this.colors.side, from.x, from.y, 300, 0.8, 3 * size, 0.8, 'punch', 0.12);
    this.pulse(this.tex.ring, this.colors.core, from.x, from.y, 240, 0.4, 1.8 * size, 0.95);
    this.pulse(this.tex.streak, this.colors.core, from.x + ux * 40 * this.scale, from.y + uy * 40 * this.scale, 160, 2.2 * size, 3.6 * size, 0.9, 'out', 0, head);
    for (let i = 0; i < 8; i++) {
      const a = head + (Math.random() - 0.5) * 1.2;
      const sp = (700 + Math.random() * 600) * this.scale;
      this.particle(this.tex.streak, i % 2 ? this.colors.core : this.hot, {
        x: from.x, y: from.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.003, grav: 0,
        life: 140 + Math.random() * 100, from: 0.8 * this.scale, to: 0.2 * this.scale, alpha: 1, streak: true,
      });
    }
    const halo = this.take(this.tex.glow, this.colors.side);
    const spear = this.take(this.tex.streak, this.hot);
    const core = this.take(this.tex.glow, this.colors.core);
    const trail: Sprite[] = [];
    const n = Math.round(TRAIL_SAMPLES * Math.min(1.5, Math.max(0, this.trail)));
    for (let j = 0; j < n; j++) { const s = this.take(this.tex.glow, j < 3 ? this.hot : this.colors.side); if (s) { s.alpha = 0; trail.push(s); } }
    if (!halo || !spear || !core) { for (const s of [halo, spear, core, ...trail]) if (s) this.give(s); return; }
    for (const s of [halo, spear, core]) s.position.set(from.x, from.y);
    this.bolts.push({
      head: core, spear, halo, trail, from, to, ctrl: arcControl(from, to, curve), age: Math.max(0, age0), dur: Math.max(1, travelMs), size,
      lastX: from.x, lastY: from.y, sparkAcc: 0,
    });
  }

  /** THE TOP TIER: one colossal beam from the hero to the target (front travels in `travelMs`, holds, thins out). */
  beam(from: Pt, to: Pt, travelMs: number, holdMs: number, width: number, age0 = 0, drainMs = 0): void {
    const ch = this.charge;
    if (ch && ch.releasing < 0) ch.releasing = 0;
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    this.pulse(this.tex.glow, this.colors.core, from.x, from.y, 260, 1.2 * width, 3.2 * width, 1, 'out');
    this.pulse(this.tex.glow, this.colors.side, from.x, from.y, 420, 1.6 * width, 4.6 * width, 0.8, 'punch', 0.1);
    this.pulse(this.tex.ring, this.colors.core, from.x, from.y, 320, 0.4, 2.8 * width, 1);
    const outer = this.take(this.tex.beam, this.colors.side);
    const core = this.take(this.tex.beam, this.colors.core);
    const head = this.take(this.tex.glow, this.colors.core);
    if (!outer || !core || !head) { for (const s of [outer, core, head]) if (s) this.give(s); return; }
    for (const s of [outer, core]) { s.anchor.set(0, 0.5); s.position.set(from.x, from.y); s.rotation = ang; s.scale.set(0, 0); }
    head.position.set(from.x, from.y);
    this.beams.push({ outer, core, head, from, len, ang, age: Math.max(0, age0), travel: Math.max(1, travelMs), hold: holdMs, width, streamAcc: 0, drain: Math.max(0, drainMs) });
  }

  /** A secondary explosion around the target (the big tiers): a flash, a ring, a burst of sparks. */
  boom(x: number, y: number, size: number): void {
    this.pulse(this.tex.glow, this.colors.core, x, y, 200, 0.8 * size, 2 * size, 0.95, 'out');
    this.pulse(this.tex.glow, this.colors.side, x, y, 420, 1.2 * size, 3 * size, 0.7, 'out');
    this.pulse(this.tex.ring, this.hot, x, y, 360, 0.3, 2.2 * size, 0.9);
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * Math.PI * 2, sp = (380 + Math.random() * 520) * this.scale;
      this.particle(this.tex.spark, i % 2 ? this.colors.core : this.hot, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 180 * this.scale, drag: 0.08, grav: 1300 * this.scale,
        life: 380 + Math.random() * 260, from: 1.2 * this.scale, to: 0.25 * this.scale, alpha: 1, streak: false,
      });
    }
  }

  /**
   * The lead bolt lands. Every element starts AT its peak, so the first frame is the brightest. `dir` is the
   * bolt's heading (the spray carries through the target); `radius` is the struck portrait's radius (the white flash
   * covers it).
   */
  impact(x: number, y: number, dir: Pt, k: number, flashScale: number, flashAlpha: number, sparks: number, radius = 120, tier = 1): void {
    const c = this.colors;
    const fs = flashScale;
    const portrait = (radius * 2) / 128; // the glow texture is 128 px across
    // Short and bright, then GONE by the time the red damage number has popped (it pops over ~140 ms), so the
    // number is never washed out by the flash.
    this.pulse(this.tex.glow, c.core, x, y, 120, portrait * 1.05, portrait * 1.3, 0.75 * flashAlpha, 'out');
    this.pulse(this.tex.glow, c.core, x, y, 170, 1 * fs, Math.min(3, 2.2 * fs), flashAlpha, 'out');
    this.pulse(this.tex.glow, c.side, x, y, 460, 1.6 * fs, Math.min(5, 3.8 * fs), 0.5 * flashAlpha, 'out');
    this.pulse(this.tex.ring, c.core, x, y, 340, 0.5, 3 * (0.85 + 0.45 * k), 1);
    this.pulse(this.tex.ring, c.side, x, y, 560, 0.5, 4.6 * (0.85 + 0.45 * k), 0.85);
    // Spikes: 8 long streaks shooting straight out (the "star" read of a heavy hit), biased along the heading.
    const head = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < 8; i++) {
      const a = head + (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const len = (i === 0 ? 1.5 : 1) * (1 + 0.6 * k);
      this.pulse(this.tex.streak, i % 2 ? this.hot : c.core, x + Math.cos(a) * 60 * this.scale * len, y + Math.sin(a) * 60 * this.scale * len,
        240, 3.2 * len, 5 * len, 0.95, 'out', 0, a);
    }
    // Chunky sparks with gravity, 65% carried THROUGH the target along the heading.
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() < 0.65 ? head + (Math.random() - 0.5) * 1.5 : Math.random() * Math.PI * 2;
      const sp = (500 + Math.random() * 900) * this.scale;
      this.particle(this.tex.spark, Math.random() < 0.35 ? c.core : this.hot, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 200 * this.scale, drag: 0.08, grav: 1500 * this.scale,
        life: 420 + Math.random() * 360, from: (1.3 + Math.random() * 0.7) * this.scale, to: 0.3 * this.scale, alpha: 1, streak: false,
      });
    }
    // The afterglow: a dim side-coloured scorch that lingers after everything else has gone (longer on the big tiers).
    this.pulse(this.tex.glow, c.side, x, y, tier >= 4 ? 1600 : tier >= 3 ? 1150 : 850, 2.4 * fs, 2.9 * fs, tier >= 4 ? 0.6 : 0.45, 'out');
    // Lingering embers on the big tiers: slow motes drifting up off the struck hero.
    const embers = tier >= 4 ? 22 : tier >= 3 ? 12 : 0;
    for (let i = 0; i < embers; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = (60 + Math.random() * 150) * this.scale;
      const r = Math.random() * radius * 0.8;
      const b = Math.random() * Math.PI * 2;
      this.particle(this.tex.spark, Math.random() < 0.4 ? c.core : this.hot, {
        x: x + Math.cos(b) * r, y: y + Math.sin(b) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.4, grav: -60 * this.scale,
        life: 900 + Math.random() * 700, from: (0.5 + Math.random() * 0.5) * this.scale, to: 0.1 * this.scale, alpha: 0.9, streak: false,
      });
    }
  }

  /** A trailing bolt lands: a smaller flash, a ring and a short spray. */
  hit(x: number, y: number, dir: Pt, size: number): void {
    this.pulse(this.tex.glow, this.colors.core, x, y, 200, 1.2 * size, 2.2 * size, 0.9, 'out');
    this.pulse(this.tex.ring, this.colors.side, x, y, 320, 0.4, 2.2 * size, 0.85);
    const head = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < 6; i++) {
      const a = head + (Math.random() - 0.5) * 1.6, sp = (500 + Math.random() * 600) * this.scale;
      this.particle(this.tex.spark, i % 2 ? this.colors.core : this.hot, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 150 * this.scale, drag: 0.08, grav: 1400 * this.scale,
        life: 320 + Math.random() * 200, from: 1.1 * this.scale, to: 0.25 * this.scale, alpha: 1, streak: false,
      });
    }
  }

  /** Advance by `dtMs` (sequence ms; the runner applies the speed). */
  update(dtMs: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(100, dtMs));
    const sec = dt / 1000;

    if (this.charge && this.stepGather(this.charge, dt)) this.charge = null;
    if (this.implode && this.stepGather(this.implode, dt)) this.implode = null;

    this.stepBolts(dt);
    this.stepBeams(dt);
    this.stepPulses(dt);
    this.stepParticles(dt, sec);

    return this.used > 0;
  }

  /** One gathering (the hero's charge or the implosion) for `dt`; true once it has released and given its sprites back. */
  private stepGather(ch: Charge, dt: number): boolean {
    const S = this.scale;
    ch.age += dt;
    const u = clamp01(ch.age / ch.dur);
    if (ch.releasing < 0) {
      const throb = 1 + 0.1 * Math.sin(ch.age * (0.03 + 0.05 * u));
      ch.core.scale.set((0.3 + 0.9 * easeOutCubic(u)) * ch.size * throb * S);
      ch.core.alpha = 0.4 + 0.6 * u;
      ch.bloom.scale.set((1 + 1.4 * u) * ch.size * S);
      ch.bloom.alpha = 0.55 * u;
      ch.ring.scale.set((2.8 - 2.1 * easeOutCubic(u)) * ch.size * ch.reach * S);
      ch.ring.alpha = Math.min(1, u * 3);
      ch.moteAcc += (ch.motes / ch.dur) * dt;
      while (ch.moteAcc >= 1) {
        ch.moteAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = (110 + Math.random() * 60) * ch.size * ch.reach * S;
        const life = 170 + Math.random() * 60;
        const sp = r / (life / 1000);
        // Inward with a tangential twist: the motes spiral in rather than falling straight.
        this.particle(this.tex.streak, Math.random() < 0.5 ? this.colors.core : this.hot, {
          x: ch.x + Math.cos(a) * r, y: ch.y + Math.sin(a) * r,
          vx: -Math.cos(a) * sp - Math.sin(a) * sp * 0.35, vy: -Math.sin(a) * sp + Math.cos(a) * sp * 0.35,
          drag: 1, grav: 0, life, from: 0.9 * S, to: 0.25 * S, alpha: 1, streak: true,
        });
      }
    } else {
      ch.releasing += dt;
      const r = clamp01(ch.releasing / 160);
      ch.core.scale.set((1.3 + 0.8 * r) * ch.size * S);
      ch.core.alpha = 1 - r;
      ch.bloom.alpha = 0.55 * (1 - r);
      ch.ring.alpha = 1 - r;
      if (r >= 1) { this.give(ch.core); this.give(ch.ring); this.give(ch.bloom); return true; }
    }
    return false;
  }

  private stepBolts(dt: number): void {
    const S = this.scale;

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!;
      b.age += dt;
      const u = clamp01(b.age / b.dur);
      const e = boltEase(u);
      const p = bezier(b.from, b.ctrl, b.to, e);
      const ahead = bezier(b.from, b.ctrl, b.to, Math.min(1, e + 0.01));
      const ang = Math.atan2(ahead.y - p.y, ahead.x - p.x) || Math.atan2(b.to.y - b.from.y, b.to.x - b.from.x);
      const step = Math.hypot(p.x - b.lastX, p.y - b.lastY);
      b.head.position.set(p.x, p.y); b.head.scale.set(0.62 * b.size * S); b.head.alpha = 1;
      b.halo.position.set(p.x, p.y); b.halo.scale.set((1.35 + 0.08 * Math.sin(b.age * 0.08)) * b.size * S); b.halo.alpha = 0.85;
      b.spear.position.set(p.x, p.y); b.spear.rotation = ang;
      b.spear.scale.set((2 + Math.min(2.2, step / (14 * S))) * b.size * S, 0.9 * b.size * S);
      // The comet tail: samples at fixed steps BACK along the path, tapering. Continuous at any frame rate.
      const n = b.trail.length;
      const span = 0.22 * this.trail;
      for (let j = 0; j < n; j++) {
        const f = (j + 1) / n;
        const back = e - span * f * Math.min(1, e / span + 0.001);
        const q = bezier(b.from, b.ctrl, b.to, Math.max(0, back));
        const s = b.trail[j]!;
        s.position.set(q.x, q.y);
        s.scale.set((1 - f) ** 0.7 * 0.95 * b.size * S);
        s.alpha = (1 - f) * 0.9 * Math.min(1, e * 6);
      }
      b.sparkAcc += step;
      if (b.sparkAcc > 70 * S) {
        b.sparkAcc = 0;
        const a = ang + Math.PI + (Math.random() - 0.5) * 1.4, sp = (120 + Math.random() * 200) * S;
        this.particle(this.tex.spark, this.hot, {
          x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.1, grav: 600 * S,
          life: 240 + Math.random() * 120, from: 0.8 * S, to: 0.1 * S, alpha: 1, streak: false,
        });
      }
      b.lastX = p.x; b.lastY = p.y;
      if (u >= 1) { for (const s of [b.head, b.spear, b.halo, ...b.trail]) this.give(s); this.bolts.splice(i, 1); }
    }
  }

  private stepBeams(dt: number): void {
    const S = this.scale;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const bm = this.beams[i]!;
      bm.age += dt;
      const front = clamp01(bm.age / bm.travel);
      const f = 0.25 * front + 0.75 * front * front;
      const after = bm.age - bm.travel;
      // The supernova's pour: after the hold the TAIL chases the front into the target (accelerating), instead of a fade.
      const g = bm.drain > 0 && after > bm.hold ? clamp01((after - bm.hold) / bm.drain) : 0;
      const tail = g * g;
      const fade = bm.drain > 0 ? (g >= 1 ? 0 : 1) : after <= bm.hold ? 1 : 1 - clamp01((after - bm.hold) / 200);
      const flick = 1 + 0.08 * Math.sin(bm.age * 0.12) + 0.05 * Math.sin(bm.age * 0.31);
      const w = bm.width * S * (front < 1 ? 0.7 + 0.3 * front : flick) * (0.25 + 0.75 * fade) * (1 + 0.35 * g);
      const texW = this.tex.beam.width || 64, texH = this.tex.beam.height || 64;
      const cos = Math.cos(bm.ang), sin = Math.sin(bm.ang);
      const tx = bm.from.x + cos * bm.len * tail, ty = bm.from.y + sin * bm.len * tail;
      const span = Math.max(0, f - tail);
      bm.outer.position.set(tx, ty); bm.core.position.set(tx, ty);
      // The wide glow thins as the beam pours in, so the moving tail never shows a hard cut across it.
      bm.outer.scale.set((bm.len * span) / texW, (150 * w * (1 - 0.35 * g)) / texH); bm.outer.alpha = 0.85 * fade * (1 - 0.55 * g);
      bm.core.scale.set((bm.len * span) / texW, (46 * w) / texH); bm.core.alpha = fade;
      const hx = bm.from.x + cos * bm.len * f, hy = bm.from.y + sin * bm.len * f;
      bm.head.position.set(hx, hy); bm.head.scale.set(1.5 * bm.width * S * (front < 1 ? 1 : 0.8 * flick) * (1 + 0.8 * g)); bm.head.alpha = fade;
      // Energy streaming down the beam while it holds (a few streaks a frame, bounded by the pool).
      if (front >= 1 && fade > 0.5) {
        bm.streamAcc += dt;
        while (bm.streamAcc > 22) {
          bm.streamAcc -= 22;
          const at = tail + Math.random() * (1 - tail) * 0.9;
          const off = (Math.random() - 0.5) * 40 * bm.width * S;
          const px = bm.from.x + cos * bm.len * at - sin * off;
          const py = bm.from.y + sin * bm.len * at + cos * off;
          const sp = 1600 * S;
          this.particle(this.tex.streak, Math.random() < 0.5 ? this.colors.core : this.hot, {
            x: px, y: py, vx: cos * sp, vy: sin * sp, drag: 1, grav: 0,
            life: 120 + Math.random() * 80, from: 1.1 * S, to: 0.4 * S, alpha: 0.9, streak: true,
          });
        }
      }
      if (fade <= 0) { this.give(bm.outer); this.give(bm.core); this.give(bm.head); this.beams.splice(i, 1); }
    }
  }

  private stepPulses(dt: number): void {
    const S = this.scale;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const q = this.pulses[i]!;
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      const sc = (q.from + (q.to - q.from) * easeOutQuint(u)) * S;
      if (q.s.texture === this.tex.streak) q.s.scale.set(sc, sc * 0.18);
      else q.s.scale.set(sc);
      q.s.alpha = q.ease === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.a0 * (1 - u) * (1 - u * 0.3);
      if (u >= 1) { this.give(q.s); this.pulses.splice(i, 1); }
    }
  }

  private stepParticles(dt: number, sec: number): void {
    const S = this.scale;
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
      if (p.streak) {
        p.s.rotation = Math.atan2(p.vy, p.vx);
        const spd = Math.hypot(p.vx, p.vy) / Math.max(0.001, S);
        p.s.scale.set(sc * (0.8 + Math.min(1.8, spd / 500)), sc * 0.5);
      } else p.s.scale.set(sc);
      p.s.alpha = p.alpha * (1 - t * t);
    }

  }

  /** Drop every in-flight effect at once (a cancel). The pool is kept for reuse. */
  clear(): void {
    for (const p of this.particles) this.give(p.s);
    for (const q of this.pulses) this.give(q.s);
    for (const b of this.bolts) for (const s of [b.head, b.spear, b.halo, ...b.trail]) this.give(s);
    for (const bm of this.beams) { this.give(bm.outer); this.give(bm.core); this.give(bm.head); }
    this.beams = [];
    for (const ch of [this.charge, this.implode]) if (ch) { this.give(ch.core); this.give(ch.ring); this.give(ch.bloom); }
    this.particles = []; this.pulses = []; this.bolts = []; this.charge = null; this.implode = null;
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.free.length = 0;
    this.root.removeChildren().forEach((c) => c.destroy());
    this.root.destroy();
  }
}
