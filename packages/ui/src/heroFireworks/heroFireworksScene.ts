/**
 * THE GRAND FINALE SCENE: everything the fireworks attack draws in Pixi, on the shared pooled scene
 * (`../heroAttack/fxPool.ts`), so it runs (and is tested) headless. `heroFireworks.ts` mounts `root` on the
 * above-portrait overlay and feeds `update(dt)`.
 *
 * Nothing here is a painted object: it is all light and particles (the third pass removed the launchers).
 *
 * WHAT IT DRAWS
 *  - THE SPARK: a point of light that ignites on the rim of the striking hero's portrait, with a FUSE of crackling
 *    sparks crawling round the rim into it. It stays lit while shells leave it, then winks out.
 *  - FLIGHTS: a hot head and a coloured glow on a short streak, dropping a GLITTERING TRAIL of flickering sparks that
 *    droop and wink out. The PINWHEEL spins on the rim first, throwing a catherine wheel of sparks, and keeps spinning
 *    as it flies. The DUD rises, sputters, flops over and fizzles out with a sad puff. The FAKE-OUT hangs at the top
 *    and sputters faster and faster. The COMET (the enormous shell) rises off the top of the screen.
 *  - BURSTS, each with a flash, a halo, a shock ring and smoke that hangs and drifts: PEONY (a sphere of stars thrown out
 *    with real drag and gravity, some changing colour, some trailing glitter), RING (a tilted ring), HEART, SMILEY (a
 *    face that winks and slowly melts), SPIRAL (a spinning pinwheel of streaks), CRACKLE (stars that pop late, or all at
 *    once for the fake-out) and WILLOW (heavy gold stars that hang and fall on glitter trails).
 *  - THE ENORMOUS SHELL: a burst that fills the screen (a core flash, a light across the whole view, two shock rings,
 *    hundreds of stars that change colour, a ring, an inner shape, a willow, crackle), sparks that fall onto the struck
 *    portrait and a crackling GLITTER RAIN over everything.
 *  - THE STRUCK PORTRAIT: lit by every burst on it, SINGED by the ticks (soot, sparkles and wisps of smoke that ride
 *    its knockback) and a final flash.
 *
 * THE CROWD. Every star, spark, puff and twinkle is one sprite in flat typed arrays (`P*`): no object per particle and
 * nothing allocated per frame, hard capped at `MAX_PARTICLES`; dead slots are swapped out. Sprites come from the pool
 * (reused, never destroyed mid attack) and are created ahead of time while the damage formation plays (`prefill`), so
 * a burst frame creates none. Additive layers for light, a normal layer for smoke and soot, no filters.
 *
 * LAYERS (the pool's): under (normal: smoke, soot) | glow (additive: halos, the sky light) | body (unused) | core
 * (additive: stars, sparks, flashes). Contract: sprites are POOLED and bounded by `MAX_FIREWORKS_SPRITES`; textures are
 * the caller's; positions are the overlay's px; `update` returns whether anything still draws; `destroy()` leaves
 * nothing behind. Everything random is seeded (a replay throws the same sparks).
 */
import { Texture, type Sprite } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, mixColor, whiten, type Pt } from '../heroAttack/easing';
import { FxPool, type FxLayer } from '../heroAttack/fxPool';
import { fireworksPathAt, type FireworksPath, type ShellFlight, type ShellKind } from './heroFireworksConfig';

export interface HeroFireworksTextures extends HeroArcanaTextures {
  /** A soft lumpy smoke puff (white, takes any tint). */
  puff: Texture;
}

export interface FireworksColors { core: number; side: number; palette: readonly number[] }

export interface FireworksLook {
  /** How long the enormous shell's stars live. */
  bloomMs: number;
  /** Glitter specks in the rain over everything, and how long it keeps falling. */
  rain: number;
  rainMs: number;
  /** The light the enormous shell throws across the whole view (peak opacity). */
  skyFlash: number;
  flashAlpha: number;
  /** Smoke and soot amounts (0 = none). */
  smoke: number;
  singe: number;
  /** Star count scale for every burst. */
  stars: number;
  /** Sprites to create ahead of the show. */
  prefill: number;
}

/** Hard cap on sprites alive at once. */
export const MAX_FIREWORKS_SPRITES = 2400;
/** Hard cap on particles (stars, sparks, puffs, twinkles) alive at once. */
export const MAX_PARTICLES = 2000;

const GLOW_PX = 128;
const RING_PX = 160;
const STAR_PX = 48;
const SPARK_PX = 32;
const PUFF_PX = 96;
const SMOKE = 0x9aa0bd;
const SOOT = 0x1c120a;
/** A glitter trail drops a spark this often (ms). */
const TRAIL_MS = 70;

// Particle flags.
const F_STREAK = 1;
const F_FLICKER = 2;
const F_CRACKLE = 4;
const F_TRAIL = 8;
const F_RAIN = 16;
const F_SMOKE = 32;
const F_FOLLOW = 64;
const F_CHANGE = 128;
const F_FLASH = 256;
const F_SWIRL = 512;
const F_SOOT = 1024;

const LAYER_OF = (f: number): FxLayer => (f & (F_SMOKE | F_SOOT) ? 'under' : 'core');

interface Flight {
  flight: ShellFlight;
  kind: ShellKind;
  path: FireworksPath;
  at: Pt;
  R: number;
  tint: number;
  tint2: number;
  /** 0 spinning on the rim | 1 flying | 2 hanging (the fake-out) | 3 flopping (the dud) | 4 gone. */
  state: number;
  age: number;
  spinMs: number;
  flyMs: number;
  head: Sprite | null; glow: Sprite | null; tail: Sprite | null;
  acc: number; spitAcc: number;
  x: number; y: number; vx: number; vy: number;
  spin: number;
  big: boolean;
}

interface Spinner { x: number; y: number; age: number; dur: number; arms: number; ang: number; omega: number; acc: number; R: number; tint: number; tint2: number }

interface Ember { glow: Sprite; core: Sprite; at: Pt; fuse: { c: Pt; r: number; a0: number; a1: number }; age: number; fuseMs: number; lit: number; acc: number }

export class HeroFireworksScene extends FxPool {
  private ember: Ember | null = null;
  private flights: (Flight | null)[] = [];
  private spinners: Spinner[] = [];
  private sky: { s: Sprite; age: number; a0: number; dur: number } | null = null;
  private viewW = 1920;
  private viewH = 1080;
  private frame = 0;
  private readonly pt: Pt = { x: 0, y: 0 };
  // The crowd, as flat arrays (index 0..nP-1 alive).
  private nP = 0;
  private readonly pS: (Sprite | null)[] = new Array<Sprite | null>(MAX_PARTICLES).fill(null);
  private readonly pX = new Float32Array(MAX_PARTICLES);
  private readonly pY = new Float32Array(MAX_PARTICLES);
  private readonly pVx = new Float32Array(MAX_PARTICLES);
  private readonly pVy = new Float32Array(MAX_PARTICLES);
  private readonly pLife = new Float32Array(MAX_PARTICLES);
  private readonly pMax = new Float32Array(MAX_PARTICLES);
  private readonly pDelay = new Float32Array(MAX_PARTICLES);
  private readonly pSize = new Float32Array(MAX_PARTICLES);
  private readonly pSize1 = new Float32Array(MAX_PARTICLES);
  private readonly pDrag = new Float32Array(MAX_PARTICLES);
  private readonly pGrav = new Float32Array(MAX_PARTICLES);
  private readonly pA = new Float32Array(MAX_PARTICLES);
  private readonly pSpin = new Float32Array(MAX_PARTICLES);
  private readonly pAcc = new Float32Array(MAX_PARTICLES);
  private readonly pTint2 = new Int32Array(MAX_PARTICLES);
  private readonly pFlags = new Uint16Array(MAX_PARTICLES);
  // Sprites made ahead of the show.
  private prefillLeft: number;
  private held: Sprite[] = [];
  /** The most particles alive at once (for the tests and the perf notes). */
  peakParticles = 0;

  constructor(private readonly tex: HeroFireworksTextures, private readonly colors: FireworksColors, private readonly look: FireworksLook, scale = 1, seed = 1) {
    super('heroFireworks', [tex.glow, tex.spark, tex.streak, tex.ring, tex.star, tex.puff], scale, seed, MAX_FIREWORKS_SPRITES);
    this.prefillLeft = Math.max(0, Math.min(MAX_FIREWORKS_SPRITES - 60, Math.round(look.prefill)));
  }

  get liveParticles(): number { return this.nP; }
  get liveFlights(): number { let n = 0; for (const f of this.flights) if (f && f.state !== 4) n++; return n; }
  get emberLit(): boolean { return this.ember !== null; }
  /** Whether anything at all still draws. */
  get moving(): boolean { return this.liveFx > 0 || this.nP > 0 || !!this.ember || this.liveFlights > 0 || this.spinners.length > 0 || !!this.sky; }

  /** The view (overlay px), measured once by the runner: the sky light and the glitter rain cover it. */
  setView(w: number, h: number): void { if (w > 0 && h > 0) { this.viewW = w; this.viewH = h; } }

  private tintOf(i: number): number { const p = this.colors.palette; return i >= 0 && p.length ? p[i % p.length]! : this.colors.core; }

  // ── the crowd ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Add a particle. `s0`/`s1`: sprite scale at birth and death (a streak: its width scale). Returns false when full. */
  private addP(t: Texture, f: number, x: number, y: number, vx: number, vy: number, life: number, delay: number, s0: number, s1: number, drag: number, grav: number, tint: number, tint2: number, a0: number, spin = 0): boolean {
    if (this.nP >= MAX_PARTICLES) return false;
    const s = this.take(LAYER_OF(f), t, tint);
    if (!s) return false;
    if (f & F_STREAK) s.anchor.set(0.72, 0.5);
    s.position.set(x, y);
    s.scale.set(s0);
    s.alpha = 0;
    const i = this.nP++;
    if (this.nP > this.peakParticles) this.peakParticles = this.nP;
    this.pS[i] = s; this.pX[i] = x; this.pY[i] = y; this.pVx[i] = vx; this.pVy[i] = vy; this.pLife[i] = Math.max(1, life); this.pMax[i] = Math.max(1, life);
    this.pDelay[i] = delay; this.pSize[i] = s0; this.pSize1[i] = s1; this.pDrag[i] = drag; this.pGrav[i] = grav; this.pA[i] = a0; this.pSpin[i] = spin;
    this.pAcc[i] = 0; this.pTint2[i] = tint2; this.pFlags[i] = f;
    return true;
  }

  /** A twinkle: a star that flashes up and out in place. */
  private twinkle(x: number, y: number, px: number, tint: number, delay: number, life = 160, follow = false): void {
    this.addP(this.tex.star, F_FLASH | (follow ? F_FOLLOW : 0), x, y, 0, 0, life, delay, (px * 0.25) / STAR_PX, px / STAR_PX, 0, 0, tint, -1, 1, 0);
  }

  private glitter(x: number, y: number, vx: number, vy: number, tint: number): void {
    const S = this.scale;
    this.addP(this.tex.spark, F_FLICKER, x, y, vx + (this.rnd() - 0.5) * 40 * S, vy + (this.rnd() - 0.5) * 30 * S, 240 + this.rnd() * 240, 0, (11 + this.rnd() * 8) * S / SPARK_PX, 3 * S / SPARK_PX, 1.6, 90 * S, tint, -1, 0.95);
  }

  private puff(x: number, y: number, px: number, a0: number, life: number, delay: number, vx: number, vy: number, tint = SMOKE, follow = false): void {
    if (!(a0 > 0)) return;
    this.addP(this.tex.puff, F_SMOKE | (follow ? F_FOLLOW : 0), x, y, vx, vy, life, delay, px / PUFF_PX, (px * 1.9) / PUFF_PX, 0.25, -6 * this.scale, tint, -1, a0, (this.rnd() - 0.5) * 0.4);
  }

  private killP(i: number): void {
    const f = this.pFlags[i]!;
    const x = this.pX[i]!, y = this.pY[i]!;
    if ((f & F_CRACKLE) && this.pDelay[i]! <= 0) {
      // Crackle: it pops late, a little white snap and a spit of colour.
      const S = this.scale;
      this.twinkle(x, y, 26 * S, this.colors.core, 0, 110);
      this.twinkle(x + (this.rnd() - 0.5) * 14 * S, y + (this.rnd() - 0.5) * 14 * S, 16 * S, this.pS[i]!.tint as number, 30, 120);
    }
    if (f & F_RAIN) {
      // It lands on the struck portrait: a twinkle that rides its knockback.
      this.twinkle(x, y, 30 * this.scale, this.colors.core, 0, 200, true);
    }
    this.give(this.pS[i]!);
    const n = --this.nP;
    if (i < n) {
      this.pS[i] = this.pS[n]!; this.pX[i] = this.pX[n]!; this.pY[i] = this.pY[n]!; this.pVx[i] = this.pVx[n]!; this.pVy[i] = this.pVy[n]!;
      this.pLife[i] = this.pLife[n]!; this.pMax[i] = this.pMax[n]!; this.pDelay[i] = this.pDelay[n]!; this.pSize[i] = this.pSize[n]!; this.pSize1[i] = this.pSize1[n]!;
      this.pDrag[i] = this.pDrag[n]!; this.pGrav[i] = this.pGrav[n]!; this.pA[i] = this.pA[n]!; this.pSpin[i] = this.pSpin[n]!; this.pAcc[i] = this.pAcc[n]!;
      this.pTint2[i] = this.pTint2[n]!; this.pFlags[i] = this.pFlags[n]!;
    }
    this.pS[n] = null;
  }

  private drawP(dt: number): void {
    const sec = dt / 1000;
    const S = this.scale;
    const fr = this.frame;
    for (let i = 0; i < this.nP; i++) {
      const s = this.pS[i]!;
      const wait = this.pDelay[i]!;
      if (wait > 0) {
        this.pDelay[i] = wait - dt;
        if (wait - dt > 0) continue;
      }
      const life = this.pLife[i]! - dt;
      if (life <= 0) { this.killP(i); i--; continue; }
      this.pLife[i] = life;
      let f = this.pFlags[i]!;
      let vx = this.pVx[i]!, vy = this.pVy[i]!;
      const drag = this.pDrag[i]!;
      if (drag > 0) { const k = Math.exp(-drag * sec); vx *= k; vy *= k; }
      if (f & F_SWIRL) {
        const w = this.pSpin[i]! * sec;
        const cs = Math.cos(w), sn = Math.sin(w);
        const nx = vx * cs - vy * sn; vy = vx * sn + vy * cs; vx = nx;
      }
      vy += this.pGrav[i]! * sec;
      const x = this.pX[i]! + vx * sec, y = this.pY[i]! + vy * sec;
      this.pVx[i] = vx; this.pVy[i] = vy; this.pX[i] = x; this.pY[i] = y;
      const t = 1 - life / this.pMax[i]!;
      if ((f & F_CHANGE) && t >= 0.42) { s.tint = this.pTint2[i]!; f &= ~F_CHANGE; this.pFlags[i] = f; }
      if (f & F_TRAIL) {
        let acc = this.pAcc[i]! + dt;
        while (acc >= TRAIL_MS) { acc -= TRAIL_MS; if (t < 0.85) this.glitter(x, y, vx * 0.05, vy * 0.05, whiten(s.tint as number, 0.5)); }
        this.pAcc[i] = acc;
      }
      let a = this.pA[i]!;
      if (f & F_FLASH) a *= t < 0.25 ? t / 0.25 : (1 - t) / 0.75;
      else if (f & F_SMOKE) a *= t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      else if (f & F_SOOT) a *= t < 0.08 ? t / 0.08 : t > 0.78 ? (1 - t) / 0.22 : 1;
      else if (t > 0.6) a *= 1 - (t - 0.6) / 0.4;
      if (f & F_FLICKER) a *= (fr + i * 7) % 5 === 0 ? 0.15 : 0.6 + 0.4 * Math.sin(life * 0.06 + i * 1.3);
      s.alpha = a;
      if (f & F_FOLLOW) s.position.set(x + this.fox, y + this.foy); else s.position.set(x, y);
      const size = this.pSize[i]!;
      if (f & F_STREAK) {
        const v = Math.hypot(vx, vy);
        s.rotation = Math.atan2(vy, vx);
        const d = size * 0.68 * (1 - 0.5 * t);
        s.scale.set(d * (1 + Math.min(3.2, v / (240 * S))), d);
      } else {
        s.scale.set(size + (this.pSize1[i]! - size) * t);
        const spin = this.pSpin[i]!;
        if (spin && !(f & F_SWIRL)) s.rotation += spin * sec;
      }
    }
  }

  // ── the spark and the fuse ────────────────────────────────────────────────────────────────────────────────

  /** The spark ignites on the hero's rim at `at`, and a fuse of crackling sparks crawls round `fuse` into it for `fuseMs`. */
  ignite(at: Pt, fuse: { c: Pt; r: number; a0: number; a1: number }, fuseMs: number): void {
    if (this.ember) return;
    const glow = this.take('glow', this.tex.glow, this.tintOf(0));
    const core = this.take('core', this.tex.star, this.colors.core);
    if (!glow || !core) { this.give(glow); this.give(core); return; }
    glow.alpha = 0; core.alpha = 0;
    this.ember = { glow, core, at, fuse, age: 0, fuseMs: Math.max(1, fuseMs), lit: 260, acc: 0 };
    // The strike: a snap of light.
    const S = this.scale;
    this.spawn('core', this.tex.glow, this.colors.core, at.x, at.y, { dur: 160, from: 30 * S / GLOW_PX / S, to: 140 * S / GLOW_PX / S, a0: 0.9, mode: 'punch', peakAt: 0.15 });
    for (let k = 0; k < 8; k++) this.glitter(at.x, at.y, (this.rnd() - 0.5) * 300 * S, -this.rnd() * 220 * S, k % 2 ? this.colors.core : this.tintOf(0));
  }

  /** Keep the spark lit a little longer (a shell has just left it). */
  private feedEmber(ms: number): void { if (this.ember) this.ember.lit = Math.max(this.ember.lit, ms); }

  private drawEmber(dt: number): void {
    const e = this.ember;
    if (!e) return;
    e.age += dt;
    const S = this.scale;
    const burning = e.age < e.fuseMs;
    if (!burning) e.lit -= dt;
    const fade = burning ? 1 : clamp01(e.lit / 200);
    if (!burning && e.lit <= 0) { this.give(e.glow); this.give(e.core); this.ember = null; return; }
    const u = clamp01(e.age / e.fuseMs);
    const flick = 0.78 + 0.22 * Math.sin(e.age * 0.13) * Math.sin(e.age * 0.051 + 1);
    const grow = burning ? 0.5 + 0.5 * u : 1;
    e.glow.position.set(e.at.x, e.at.y); e.glow.scale.set((190 * S * grow * flick) / GLOW_PX); e.glow.alpha = 0.95 * fade * Math.min(1, e.age / 60);
    e.core.position.set(e.at.x, e.at.y); e.core.scale.set((74 * S * grow * flick) / STAR_PX); e.core.rotation = e.age * 0.01; e.core.alpha = fade * Math.min(1, e.age / 60);
    e.acc += dt;
    while (e.acc >= 16) {
      e.acc -= 16;
      if (burning) {
        // The fuse: a hot point crawling round the rim, spitting crackling sparks outward.
        const a = e.fuse.a0 + (e.fuse.a1 - e.fuse.a0) * u;
        const x = e.fuse.c.x + Math.cos(a) * e.fuse.r, y = e.fuse.c.y + Math.sin(a) * e.fuse.r;
        const out = a + (this.rnd() - 0.5) * 1.4;
        const sp = (120 + this.rnd() * 220) * S;
        for (let k = 0; k < 2; k++) this.addP(this.tex.spark, F_STREAK | (this.rnd() < 0.3 ? F_CRACKLE : F_FLICKER), x, y, Math.cos(out + k * 0.5) * sp, Math.sin(out + k * 0.5) * sp - 60 * S, 180 + this.rnd() * 180, 0, 0.55 * S, 0.55 * S, 2.5, 520 * S, this.rnd() < 0.4 ? this.colors.core : this.tintOf(0), -1, 1);
        this.twinkle(x, y, (34 + this.rnd() * 16) * S, this.colors.core, 0, 70);
        this.addP(this.tex.glow, F_FLASH, x, y, 0, 0, 120, 0, (40 * S) / GLOW_PX, (90 * S) / GLOW_PX, 0, 0, this.tintOf(0), -1, 0.7);
      } else if (this.rnd() < 0.5) {
        // Lit: it fizzes quietly.
        this.glitter(e.at.x, e.at.y, (this.rnd() - 0.5) * 160 * S, -120 * S * this.rnd(), this.tintOf(0));
      }
    }
  }

  // ── flights ───────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Shell `i` appears: from the spark (or the bottom of the view) along `path`, to open at `at` with radius `R`.
   * `late` ms have already passed. The pinwheel spins for `spinMs` before it flies.
   */
  launch(i: number, o: { flight: ShellFlight; kind: ShellKind; path: FireworksPath; at: Pt; R: number; tint: number; tint2: number; flyMs: number; spinMs: number; fromHero: boolean }, late = 0): void {
    while (this.flights.length <= i) this.flights.push(null);
    if (this.flights[i]) return;
    const big = o.flight === 'comet';
    const tint = this.tintOf(o.tint);
    const head = this.take('core', this.tex.spark, this.colors.core);
    const glow = this.take('glow', this.tex.glow, tint);
    const tail = this.take('core', this.tex.streak, whiten(tint, 0.4));
    if (tail) tail.anchor.set(0.94, 0.5);
    const fl: Flight = {
      flight: o.flight, kind: o.kind, path: o.path, at: o.at, R: o.R, tint, tint2: o.tint2 >= 0 ? this.tintOf(o.tint2) : -1, state: o.flight === 'pinwheel' ? 0 : 1,
      age: Math.max(0, late), spinMs: Math.max(1, o.spinMs), flyMs: Math.max(1, o.flyMs), head, glow, tail, acc: 0, spitAcc: 0,
      x: o.path.from.x, y: o.path.from.y, vx: 0, vy: 0, spin: 0, big,
    };
    this.flights[i] = fl;
    const S = this.scale;
    if (o.fromHero) {
      this.feedEmber(o.flight === 'pinwheel' ? o.spinMs + 260 : 300);
      if (fl.state === 1) this.lift(o.path.from, tint, big ? 1.6 : 0.7);
    } else {
      // From the bottom of the screen: a flash of light where it leaves.
      this.spawn('glow', this.tex.glow, tint, o.path.from.x, o.path.from.y - 20 * S, { dur: 260, from: 60 / GLOW_PX, to: 160 / GLOW_PX, a0: 0.6, mode: 'punch', peakAt: 0.15 });
    }
    this.drawFlight(fl, 0);
  }

  /** The kick of light as a shell leaves the spark. */
  private lift(from: Pt, tint: number, k: number): void {
    const S = this.scale;
    this.spawn('core', this.tex.glow, this.colors.core, from.x, from.y, { dur: 170, from: (40 * k) / GLOW_PX, to: (170 * k) / GLOW_PX, a0: 0.95, mode: 'punch', peakAt: 0.12 });
    this.spawn('glow', this.tex.ring, tint, from.x, from.y, { dur: 260, from: (16 * k) / RING_PX, to: (110 * k) / RING_PX, a0: 0.6, ease: 'cubic' });
    for (let j = 0; j < 6 * k; j++) this.glitter(from.x, from.y, (this.rnd() - 0.5) * 260 * S, (40 + this.rnd() * 140) * S, j % 2 ? this.colors.core : tint);
    this.puff(from.x, from.y, 50 * S * k, 0.16 * this.look.smoke, 1300, 40, (this.rnd() - 0.5) * 30 * S, -10 * S);
  }

  /** The pinwheel leaves the rim (still spinning). */
  takeoff(i: number): void {
    const fl = this.flights[i];
    if (!fl || fl.state !== 0) return;
    fl.state = 1; fl.age = 0;
    this.lift(fl.path.from, fl.tint, 0.8);
  }

  /** The dud starts to sputter (and flop); the fake-out starts to hang. Both are timed by the flight itself too. */
  sputter(i: number): void {
    const fl = this.flights[i];
    if (!fl) return;
    if (fl.flight === 'dud' && fl.state === 1) this.flop(fl);
    if (fl.flight === 'sputter' && fl.state === 1) { fl.state = 2; fl.age = 0; fl.x = fl.at.x; fl.y = fl.at.y; }
  }

  private flop(fl: Flight): void {
    const S = this.scale;
    const e = 1;
    const p = fireworksPathAt(fl.path, e, this.pt);
    fl.x = p.x; fl.y = p.y;
    const tx = fl.path.to.x - fl.path.ctrl.x, ty = fl.path.to.y - fl.path.ctrl.y;
    const L = Math.hypot(tx, ty) || 1;
    fl.vx = (tx / L) * 160 * S; fl.vy = (ty / L) * 160 * S - 60 * S;
    fl.state = 3; fl.age = 0;
  }

  private endFlight(i: number): void {
    const fl = this.flights[i];
    if (!fl) return;
    this.give(fl.head); this.give(fl.glow); this.give(fl.tail);
    fl.head = null; fl.glow = null; fl.tail = null;
    fl.state = 4;
  }

  /** A pinwheel's catherine wheel: sparks thrown off a spinning rim. */
  private wheel(fl: Flight, dt: number, x: number, y: number, rate: number): void {
    const S = this.scale;
    fl.spin += (8 + 26 * clamp01(fl.age / fl.spinMs)) * (dt / 1000) * (fl.state === 0 ? 1 : 1.2);
    fl.spitAcc += dt;
    while (fl.spitAcc >= rate) {
      fl.spitAcc -= rate;
      for (let arm = 0; arm < 5; arm++) {
        const a = fl.spin + (arm * Math.PI * 2) / 5;
        const rx = Math.cos(a) * 26 * S, ry = Math.sin(a) * 26 * S;
        const tx = -Math.sin(a), ty = Math.cos(a);
        const sp = (520 + this.rnd() * 220) * S;
        this.addP(this.tex.spark, F_STREAK | (arm % 2 ? F_FLICKER : 0), x + rx, y + ry, tx * sp + Math.cos(a) * 90 * S, ty * sp + Math.sin(a) * 90 * S, 260 + this.rnd() * 160, 0, 0.8 * S, 0.8 * S, 2.4, 380 * S, arm % 2 ? fl.tint : (fl.tint2 >= 0 ? fl.tint2 : this.colors.core), -1, 1);
      }
    }
  }

  private drawFlight(fl: Flight, dt: number): void {
    if (fl.state === 4) return;
    const S = this.scale;
    fl.age += dt;
    let x = fl.x, y = fl.y;
    let hx = 0, hy = -1;
    let headPx = (fl.big ? 54 : 34) * S, glowPx = (fl.big ? 260 : 170) * S, alpha = 1, tailLen = fl.big ? 2.2 : 1.4;
    if (fl.state === 0) {
      // Spinning on the rim, faster and faster.
      x = fl.path.from.x; y = fl.path.from.y;
      this.wheel(fl, dt, x, y, 14);
      tailLen = 0;
      glowPx *= 1 + 0.3 * clamp01(fl.age / fl.spinMs);
    } else if (fl.state === 1) {
      let u = fl.age / fl.flyMs;
      if (fl.flight === 'dud') {
        // It rises for the first 40 % of its life, then flops (the `sputter` cue, or here if it is late).
        u = fl.age / (fl.flyMs * 0.4);
        if (u >= 1) { this.flop(fl); this.drawFlight(fl, 0); return; }
      }
      if (u >= 1) {
        if (fl.flight === 'comet') { this.endFlight(this.flights.indexOf(fl)); return; }
        if (fl.flight === 'sputter') { fl.state = 2; fl.age = 0; fl.x = fl.at.x; fl.y = fl.at.y; this.drawFlight(fl, 0); return; }
        u = 1;
      }
      // A shell slows as it rises to its top; the comet keeps its speed and is gone off the top.
      const e = fl.flight === 'comet' ? u : 1 - Math.pow(1 - u, 1.7);
      const p = fireworksPathAt(fl.path, e, this.pt);
      const dx = p.x - fl.x, dy = p.y - fl.y;
      const L = Math.hypot(dx, dy);
      if (L > 0.01) { hx = dx / L; hy = dy / L; } else if (fl.vx || fl.vy) { const l2 = Math.hypot(fl.vx, fl.vy); hx = fl.vx / l2; hy = fl.vy / l2; }
      fl.vx = hx; fl.vy = hy;
      x = p.x; y = p.y;
      if (fl.flight === 'pinwheel') this.wheel(fl, dt, x, y, 24);
      fl.acc += dt;
      const every = fl.big ? 7 : 12;
      while (fl.acc >= every) {
        fl.acc -= every;
        // The glittering trail: sparks that flicker, droop and wink out.
        this.glitter(x - hx * 6 * S, y - hy * 6 * S, -hx * 40 * S, -hy * 40 * S, this.rnd() < 0.35 ? this.colors.core : whiten(fl.tint, 0.3));
        if (fl.big && this.rnd() < 0.4) this.addP(this.tex.spark, F_CRACKLE, x, y, (this.rnd() - 0.5) * 120 * S, 40 * S, 260 + this.rnd() * 200, 0, 12 * S / SPARK_PX, 4 * S / SPARK_PX, 1.2, 200 * S, this.tintOf(0), -1, 0.9);
      }
      // The fake-out shell wobbles as it nears its top (something is wrong with it).
      if (fl.flight === 'sputter') x += Math.sin(fl.age * 0.05) * 3 * S * u;
    } else if (fl.state === 2) {
      // THE FAKE-OUT: it hangs and sputters, faster and faster, swelling.
      const u = clamp01(fl.age / 500);
      x = fl.at.x + Math.sin(fl.age * (0.06 + 0.12 * u)) * (2 + 6 * u) * S;
      y = fl.at.y + Math.sin(fl.age * 0.031) * 3 * S + fl.age * 0.006 * S;
      headPx *= 1 + 0.7 * u; glowPx *= 1 + 0.9 * u + 0.25 * Math.sin(fl.age * (0.04 + 0.1 * u));
      tailLen = 0;
      fl.spitAcc += dt;
      const rate = 90 - 60 * u;
      while (fl.spitAcc >= rate) {
        fl.spitAcc -= rate;
        for (let k = 0; k < 3; k++) {
          const a = this.rnd() * Math.PI * 2, sp = (80 + this.rnd() * 160) * S;
          this.addP(this.tex.spark, k ? F_FLICKER : F_CRACKLE, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 180 + this.rnd() * 140, 0, 12 * S / SPARK_PX, 3 * S / SPARK_PX, 2, 380 * S, k === 1 ? this.colors.core : fl.tint, -1, 1);
        }
        this.puff(x, y, 26 * S, 0.1 * this.look.smoke, 700, 0, (this.rnd() - 0.5) * 30 * S, -20 * S);
      }
    } else if (fl.state === 3) {
      // THE DUD: it flops over and falls, coughing out a few sad sparks, fading.
      const sec = dt / 1000;
      fl.vy += 620 * S * sec;
      fl.vx *= Math.exp(-1.2 * sec);
      fl.x += fl.vx * sec; fl.y += fl.vy * sec;
      x = fl.x + Math.sin(fl.age * 0.045) * 4 * S; y = fl.y;
      const L = Math.hypot(fl.vx, fl.vy) || 1;
      hx = fl.vx / L; hy = fl.vy / L;
      const u = clamp01(fl.age / (fl.flyMs * 0.6));
      alpha = (1 - 0.4 * u) * (0.55 + 0.45 * Math.abs(Math.sin(fl.age * 0.09)));
      headPx *= 1 - 0.25 * u; glowPx *= 0.9 - 0.4 * u; tailLen = 0.4;
      fl.spitAcc += dt;
      while (fl.spitAcc >= 55) {
        fl.spitAcc -= 55;
        const a = -Math.PI / 2 + (this.rnd() - 0.5) * 1.8, sp = (50 + this.rnd() * 90) * S;
        this.addP(this.tex.spark, F_FLICKER, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 240 + this.rnd() * 160, 0, 13 * S / SPARK_PX, 3 * S / SPARK_PX, 1.6, 380 * S, mixColor(fl.tint, SMOKE, 0.15), -1, 0.95);
        this.puff(x, y, 18 * S, 0.12 * this.look.smoke, 800, 0, 0, -16 * S);
      }
    }
    if (fl.state !== 3) { fl.x = x; fl.y = y; }
    const flick = 0.85 + 0.15 * Math.sin(fl.age * 0.11);
    if (fl.head) { fl.head.position.set(x, y); fl.head.scale.set((headPx * flick) / SPARK_PX); fl.head.alpha = alpha; }
    if (fl.glow) { fl.glow.position.set(x, y); fl.glow.scale.set((glowPx * flick) / GLOW_PX); fl.glow.alpha = 0.9 * alpha; }
    if (fl.tail) {
      fl.tail.visible = tailLen > 0;
      fl.tail.position.set(x, y); fl.tail.rotation = Math.atan2(hy, hx);
      fl.tail.scale.set(tailLen * (fl.big ? 3.2 : 1.6) * S, (fl.big ? 1.2 : 0.7) * S); fl.tail.alpha = 0.75 * alpha;
    }
  }

  // ── bursts ────────────────────────────────────────────────────────────────────────────────────────────────

  /** Shell `i` bursts (or, the dud, fizzles out with a sad puff). `strength` scales its light. */
  burstShell(i: number, strength = 1): void {
    const fl = this.flights[i];
    if (!fl || fl.state === 4) return;
    const S = this.scale;
    if (fl.flight === 'dud') {
      // Pfft.
      const x = fl.x, y = fl.y;
      this.endFlight(i);
      this.puff(x, y, 80 * S, 0.5 * this.look.smoke, 1600, 0, 0, -26 * S, 0xd8dcef);
      this.puff(x + 14 * S, y - 10 * S, 52 * S, 0.4 * this.look.smoke, 1300, 90, 16 * S, -40 * S, 0xd8dcef);
      this.twinkle(x, y, 50 * S, mixColor(fl.tint, 0xffffff, 0.4), 0, 160);
      for (let k = 0; k < 5; k++) this.addP(this.tex.spark, F_FLICKER, x, y, (this.rnd() - 0.5) * 60 * S, -30 * S * this.rnd(), 260, k * 30, 8 * S / SPARK_PX, 2 * S / SPARK_PX, 1, 300 * S, mixColor(fl.tint, SMOKE, 0.5), -1, 0.7);
      return;
    }
    const at = fl.state === 2 ? { x: fl.x, y: fl.y } : fl.at;
    this.endFlight(i);
    this.shell(fl.kind, at, fl.R, fl.tint, fl.tint2, strength, fl.flight === 'sputter');
  }

  /** A shell of `kind` opens at `at` with radius `R`. `sync`: its crackle all pops at once (the fake-out). */
  private shell(kind: ShellKind, at: Pt, R: number, tint: number, tint2: number, strength: number, sync = false): void {
    const S = this.scale;
    const c = this.colors;
    const P = strength;
    this.spawn('core', this.tex.glow, c.core, at.x, at.y, { dur: 190, from: (R * 0.35) / GLOW_PX / S, to: (R * 1.7 * P) / GLOW_PX / S, a0: this.look.flashAlpha * 0.9, mode: 'punch', peakAt: 0.12 });
    this.spawn('glow', this.tex.glow, tint, at.x, at.y, { dur: 760, from: (R * 1.5) / GLOW_PX / S, to: (R * 2.6) / GLOW_PX / S, a0: 0.2 * P, mode: 'punch', peakAt: 0.08, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, whiten(tint, 0.3), at.x, at.y, { dur: 360, from: (R * 0.2) / RING_PX / S, to: (R * 2.1) / RING_PX / S, a0: 0.12, ease: 'cubic' });
    // Smoke that hangs where it burst and drifts off.
    const sm = this.look.smoke;
    for (let k = 0; k < 3; k++) this.puff(at.x + (this.rnd() - 0.5) * R * 0.6, at.y + (this.rnd() - 0.3) * R * 0.5, R * (0.55 + this.rnd() * 0.3), 0.17 * sm, 2400 + this.rnd() * 900, 120 + k * 60, (6 + this.rnd() * 18) * S * (this.rnd() < 0.5 ? -1 : 1), -4 * S);
    const n = (base: number): number => Math.max(3, Math.round(base * this.look.stars));
    switch (kind) {
      case 'ring': this.ringStars(at, R, n(40), tint, 0, 3.4, 130 * S, 1100, 1.05); this.sphere(at, R * 0.3, n(8), c.core, -1, 0, 3.2, 100 * S, 700, 0.8, 0); break;
      case 'heart': this.heart(at, R, n(34), tint); break;
      case 'smiley': this.smiley(at, R, tint, tint2 >= 0 ? tint2 : c.core); break;
      case 'spiral': this.spinners.push({ x: at.x, y: at.y, age: 0, dur: 440, arms: 6, ang: this.rnd() * Math.PI * 2, omega: 9, acc: 0, R, tint, tint2: tint2 >= 0 ? tint2 : c.core }); this.sphere(at, R * 0.35, n(10), c.core, -1, 0, 3, 100 * S, 600, 0.8, 0); break;
      case 'crackle': this.crackle(at, R, n(sync ? 70 : 44), tint, sync); if (sync) this.sphere(at, R * 1.05, n(40), tint, tint2, 0, 3.1, 160 * S, 1100, 1.1, F_FLICKER); break;
      case 'willow': this.sphere(at, R * 0.95, n(34), whiten(c.palette[0] ?? tint, 0.2), -1, 0, 2.2, 300 * S, 2000, 0.9, F_TRAIL); break;
      case 'peony': default: this.sphere(at, R, n(46), tint, tint2, 0, 3.2, 150 * S, 1200, 1.05, 0); this.sphere(at, R * 0.32, n(10), c.core, -1, 0, 3.2, 120 * S, 650, 0.8, 0); break;
    }
  }

  /**
   * A sphere of stars thrown out from `at` (the projection of a sphere: denser at the rim, like a real shell). A star
   * leaves at v0 and slows at `drag` per second, so it travels v0 / drag: `R`. Every 4th trails glitter; every 3rd
   * flickers as it dies; `tint2` >= 0 changes colour part way.
   */
  private sphere(at: Pt, R: number, n: number, tint: number, tint2: number, delay: number, drag: number, grav: number, life: number, size: number, flags: number): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const z = this.rnd() * 2 - 1;
      const r2 = Math.sqrt(1 - z * z) * (0.94 + this.rnd() * 0.1);
      const a = this.rnd() * Math.PI * 2;
      const v = R * drag * r2;
      let f = F_STREAK | flags;
      if (i % 6 === 1 && !(flags & F_TRAIL)) f |= F_TRAIL;
      if ((flags & F_TRAIL) && i % 2) f &= ~F_TRAIL;
      if (i % 3 === 0) f |= F_FLICKER;
      if (tint2 >= 0) f |= F_CHANGE;
      this.addP(this.tex.spark, f, at.x, at.y, Math.cos(a) * v, Math.sin(a) * v, life * (0.82 + this.rnd() * 0.36), delay, size * S, size * S, drag, grav, i % 6 === 5 ? whiten(tint, 0.55) : tint, tint2, 1);
    }
  }

  private ringStars(at: Pt, R: number, n: number, tint: number, delay: number, drag: number, grav: number, life: number, size: number): void {
    const tilt = this.rnd() * Math.PI;
    const flat = 0.45 + this.rnd() * 0.35;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ex = Math.cos(a), ey = Math.sin(a) * flat;
      const vx = (ex * ct - ey * st) * R * drag, vy = (ex * st + ey * ct) * R * drag;
      this.addP(this.tex.spark, F_STREAK | (i % 3 === 0 ? F_FLICKER : 0), at.x, at.y, vx, vy, life * (0.9 + this.rnd() * 0.2), delay, size * this.scale, size * this.scale, drag, grav, tint, -1, 1);
    }
  }

  /** A star placed on a shape: it flies from the centre to `at + (ox, oy)` and stops there (then droops slowly). */
  private shapeStar(at: Pt, ox: number, oy: number, tint: number, life: number, delay: number, px: number, drag: number, grav: number, flags = 0): void {
    this.addP(this.tex.star, flags, at.x, at.y, ox * drag, oy * drag, life, delay, px / STAR_PX, (px * 0.7) / STAR_PX, drag, grav, tint, -1, 1, (this.rnd() - 0.5) * 2);
  }

  private heart(at: Pt, R: number, n: number, tint: number): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      const hx = 16 * Math.sin(t) ** 3;
      const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      this.shapeStar(at, (hx / 17) * R, (hy / 17) * R + R * 0.1, i % 4 === 0 ? whiten(tint, 0.6) : tint, 1300 + this.rnd() * 300, 0, 36 * S, 4.4, 50 * S, i % 4 === 0 ? F_FLICKER : 0);
    }
    for (let k = 0; k < 6; k++) this.twinkle(at.x + (this.rnd() - 0.5) * R, at.y + (this.rnd() - 0.5) * R * 0.8, 30 * S, this.colors.core, 260 + this.rnd() * 500);
  }

  /** THE SMILEY: a face of stars that WINKS and slowly melts. */
  private smiley(at: Pt, R: number, tint: number, feature: number): void {
    const S = this.scale;
    const drag = 4.6, grav = 34 * S, life = 1500;
    const n = Math.max(14, Math.round(28 * this.look.stars));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.shapeStar(at, Math.cos(a) * R, Math.sin(a) * R, i % 3 === 0 ? whiten(tint, 0.6) : tint, life + this.rnd() * 200, 0, 38 * S, drag, grav, i % 5 === 0 ? F_FLICKER : 0);
    }
    // Eyes: the left one stays open, the right one WINKS (out, a shut line, and open again).
    const eye = (ex: number, life0: number, delay: number): void => {
      for (let k = 0; k < 5; k++) this.shapeStar(at, ex * R + (this.rnd() - 0.5) * R * 0.1, -0.28 * R + (this.rnd() - 0.5) * R * 0.12, feature, life0, delay, 42 * S, drag, grav);
    };
    eye(-0.34, life, 0);
    eye(0.34, 560, 0);
    for (let k = -1; k <= 1; k++) this.addP(this.tex.star, F_FLASH, at.x + (0.34 * R + k * 0.07 * R), at.y - 0.25 * R + 16 * S, 0, grav * 0.2, 240, 520, 20 * S / STAR_PX, 26 * S / STAR_PX, 0, grav, feature, -1, 1);
    eye(0.34, life - 760, 760);
    // The grin.
    const m = Math.max(7, Math.round(12 * this.look.stars));
    for (let i = 0; i < m; i++) {
      const a = Math.PI * (0.16 + 0.68 * (i / (m - 1)));
      this.shapeStar(at, Math.cos(a) * R * 0.56, Math.sin(a) * R * 0.56 + R * 0.02, feature, life, 0, 36 * S, drag, grav);
    }
  }

  /** Crackle: stars that drift out and POP late (each at its own moment, or all at once when `sync`). */
  private crackle(at: Pt, R: number, n: number, tint: number, sync: boolean): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const v = R * 2.6 * (0.35 + 0.65 * Math.sqrt(this.rnd()));
      const life = sync ? 360 + this.rnd() * 30 : 420 + this.rnd() * 700;
      this.addP(this.tex.spark, F_CRACKLE | F_FLICKER, at.x, at.y, Math.cos(a) * v, Math.sin(a) * v, life, 0, 14 * S / SPARK_PX, 8 * S / SPARK_PX, 2.6, 90 * S, i % 3 ? tint : this.colors.core, -1, 0.9);
    }
  }

  private drawSpinners(dt: number): void {
    const S = this.scale;
    for (let k = this.spinners.length - 1; k >= 0; k--) {
      const sp = this.spinners[k]!;
      sp.age += dt;
      sp.ang += sp.omega * (dt / 1000);
      sp.acc += dt;
      while (sp.acc >= 18 && sp.age <= sp.dur) {
        sp.acc -= 18;
        for (let arm = 0; arm < sp.arms; arm++) {
          const a = sp.ang + (arm / sp.arms) * Math.PI * 2;
          const drag = 3;
          const v = sp.R * drag * (0.85 + this.rnd() * 0.2);
          this.addP(this.tex.spark, F_STREAK | F_SWIRL | (arm % 3 === 0 ? F_FLICKER : 0), sp.x, sp.y, Math.cos(a) * v, Math.sin(a) * v, 800 + this.rnd() * 300, 0, 0.95 * S, 0.95 * S, drag, 90 * S, arm % 2 ? sp.tint : sp.tint2, -1, 1, 1.6);
        }
      }
      if (sp.age > sp.dur) this.spinners.splice(k, 1);
    }
  }

  // ── the struck portrait ───────────────────────────────────────────────────────────────────────────────────

  /** The struck portrait is LIT: a glow in `tint` and a white flash on it that ride its knockback. */
  light(target: Pt, targetR: number, tint: number, strength: number, dur: number): void {
    const S = this.scale;
    this.spawn('glow', this.tex.glow, tint, target.x, target.y, { dur, from: (targetR * 2.4) / GLOW_PX / S, to: (targetR * 3.4) / GLOW_PX / S, a0: 0.75 * strength, mode: 'punch', peakAt: 0.08, ease: 'cubic', follow: true });
    this.spawn('core', this.tex.glow, this.colors.core, target.x, target.y, { dur: dur * 0.35, from: (targetR * 1.4) / GLOW_PX / S, to: (targetR * 2.4) / GLOW_PX / S, a0: 0.55 * strength, mode: 'punch', peakAt: 0.12, follow: true });
  }

  /**
   * The struck portrait is SINGED: soot smudges that ride its knockback and stay until `holdMs` is up, sparkles that
   * twinkle on it and wisps of smoke that curl up off it.
   */
  singe(target: Pt, targetR: number, k: number, holdMs: number): void {
    const S = this.scale;
    const amt = this.look.singe * k;
    if (!(amt > 0)) return;
    for (let j = 0; j < 3; j++) {
      const a = this.rnd() * Math.PI * 2, r = targetR * 0.45 * Math.sqrt(this.rnd());
      this.addP(this.tex.puff, F_SOOT | F_FOLLOW, target.x + Math.cos(a) * r, target.y + Math.sin(a) * r, 0, 0, Math.max(300, holdMs), 0, (targetR * (0.5 + 0.25 * this.rnd())) / PUFF_PX, (targetR * 0.8) / PUFF_PX, 0, 0, SOOT, -1, Math.min(0.5, 0.26 * amt), (this.rnd() - 0.5) * 0.3);
    }
    for (let j = 0; j < 7; j++) {
      const a = this.rnd() * Math.PI * 2, r = targetR * 0.85 * Math.sqrt(this.rnd());
      this.twinkle(target.x + Math.cos(a) * r, target.y + Math.sin(a) * r, (24 + this.rnd() * 18) * S, j % 2 ? this.colors.core : this.tintOf(0), 80 + this.rnd() * 700, 170, true);
    }
    for (let j = 0; j < 3; j++) this.puff(target.x + (this.rnd() - 0.5) * targetR, target.y - targetR * 0.4, targetR * 0.35, 0.2 * amt, 1500, 120 + j * 160, (this.rnd() - 0.5) * 30 * S, -70 * S);
  }

  /** The final flash on the struck portrait: white light, a ring, and a spray of sparkles off it. */
  finalFlash(target: Pt, targetR: number): void {
    const S = this.scale;
    this.light(target, targetR, this.colors.core, 1.2, 700);
    this.spawn('glow', this.tex.ring, this.tintOf(0), target.x, target.y, { dur: 520, from: (targetR * 0.8) / RING_PX / S, to: (targetR * 4) / RING_PX / S, a0: 0.7, ease: 'cubic', follow: true });
    this.spawn('core', this.tex.star, this.colors.core, target.x, target.y, { dur: 360, from: (targetR * 0.6) / STAR_PX / S, to: (targetR * 2.6) / STAR_PX / S, a0: 0.9, mode: 'punch', peakAt: 0.15, rot: 0.3, follow: true });
    for (let j = 0; j < 36; j++) {
      const a = (j / 36) * Math.PI * 2, v = (360 + this.rnd() * 300) * S;
      this.addP(this.tex.spark, F_STREAK | (j % 2 ? F_FLICKER : F_CRACKLE), target.x + Math.cos(a) * targetR * 0.6, target.y + Math.sin(a) * targetR * 0.6, Math.cos(a) * v, Math.sin(a) * v, 500 + this.rnd() * 300, 0, 0.7 * S, 0.7 * S, 3, 260 * S, j % 3 ? this.tintOf(j % 5) : this.colors.core, -1, 1);
    }
    for (let j = 0; j < 12; j++) {
      const a = this.rnd() * Math.PI * 2, r = targetR * Math.sqrt(this.rnd());
      this.twinkle(target.x + Math.cos(a) * r, target.y + Math.sin(a) * r, 34 * S, this.colors.core, 60 + this.rnd() * 500, 180, true);
    }
  }

  // ── the enormous shell ────────────────────────────────────────────────────────────────────────────────────

  /** A light across the whole view. */
  private skyLight(a0: number, dur: number, tint: number): void {
    if (!(a0 > 0)) return;
    if (this.sky) { this.sky.age = 0; this.sky.a0 = Math.max(a0, this.sky.a0 * 0.5); this.sky.dur = dur; this.sky.s.tint = tint; return; }
    const s = this.take('glow', Texture.WHITE, tint);
    if (s) { s.anchor.set(0); s.alpha = 0; this.sky = { s, age: 0, a0, dur }; }
  }

  /**
   * THE ENORMOUS SHELL (the blow) opens at `at` with radius `R` and fills the screen: a core flash, a light across the
   * view, two shock rings, a peony of `giantStars` stars that turn from gold to white, a ring, an inner shape (the
   * variant's: a smiley, a spiral or a heart), a willow, crackle, sparks that fall onto the struck portrait and a
   * crackling glitter rain over everything.
   */
  giant(i: number, at: Pt, R: number, target: Pt, targetR: number, stars: number, variant: number): void {
    this.endFlight(i);
    const S = this.scale;
    const c = this.colors;
    const gold = this.tintOf(0), magenta = this.tintOf(1), cyan = this.tintOf(2), violet = this.tintOf(4);
    this.spawn('core', this.tex.glow, c.core, at.x, at.y, { dur: 420, from: (R * 0.2) / GLOW_PX / S, to: (R * 1.6) / GLOW_PX / S, a0: this.look.flashAlpha, mode: 'punch', peakAt: 0.08 });
    this.spawn('core', this.tex.star, c.core, at.x, at.y, { dur: 460, from: (R * 0.15) / STAR_PX / S, to: (R * 0.95) / STAR_PX / S, a0: 0.95, mode: 'punch', peakAt: 0.12, rot: 0.35 });
    this.spawn('glow', this.tex.glow, magenta, at.x, at.y, { dur: 1200, from: (R * 0.7) / GLOW_PX / S, to: (R * 1.3) / GLOW_PX / S, a0: 0.18, mode: 'punch', peakAt: 0.1, ease: 'cubic', delay: 80 });
    this.spawn('glow', this.tex.ring, c.core, at.x, at.y, { dur: 480, from: (R * 0.1) / RING_PX / S, to: (R * 1.7) / RING_PX / S, a0: 0.14, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, gold, at.x, at.y, { dur: 760, from: (R * 0.1) / RING_PX / S, to: (R * 2.1) / RING_PX / S, a0: 0.16, ease: 'cubic', delay: 70 });
    this.skyLight(this.look.skyFlash, 900, mixColor(gold, 0xffffff, 0.6));
    this.light(target, targetR, gold, 1, 1200);
    const life = this.look.bloomMs;
    const n = Math.max(20, Math.round(stars * this.look.stars));
    // The peony: hundreds of stars, gold turning white, some trailing glitter.
    this.bigSphere(at, R, n, gold, c.core, life, 2.6, 110 * S, 1.35);
    this.ringStars(at, R * 0.78, Math.round(n * 0.3), magenta, 40, 2.8, 100 * S, life * 0.8, 1.4);
    this.sphere(at, R * 0.45, Math.round(n * 0.22), cyan, violet, 120, 3, 100 * S, life * 0.65, 1.2, 0);
    // The inner shape (the variant's whimsy, now huge).
    if (variant === 1) this.smiley(at, R * 0.3, gold, c.core);
    else if (variant === 2) this.spinners.push({ x: at.x, y: at.y, age: 0, dur: 520, arms: 7, ang: this.rnd() * 6, omega: 8, acc: 0, R: R * 0.36, tint: cyan, tint2: magenta });
    else this.heart(at, R * 0.32, Math.round(30 * this.look.stars), magenta);
    // The willow: heavy gold stars that reach nearly as far, then hang and fall on glitter trails.
    this.sphere(at, R * 0.82, Math.round(n * 0.26), whiten(gold, 0.25), -1, 220, 2.1, 300 * S, life * 1.25, 1.2, F_TRAIL);
    this.crackle(at, R * 0.75, Math.round(n * 0.3), gold, false);
    // Sparks that fall onto the struck portrait and twinkle out where they land.
    const g = 900 * S;
    for (let k = 0; k < 26; k++) {
      const a = this.rnd() * Math.PI * 2, r0 = R * (0.15 + 0.35 * this.rnd());
      const x0 = at.x + Math.cos(a) * r0, y0 = at.y + Math.sin(a) * r0;
      const ta = this.rnd() * Math.PI * 2, tr = targetR * 0.8 * Math.sqrt(this.rnd());
      const tx = target.x + Math.cos(ta) * tr, ty = target.y + Math.sin(ta) * tr;
      const tau = (900 + 700 * this.rnd()) / 1000;
      this.addP(this.tex.spark, F_STREAK | F_RAIN, x0, y0, (tx - x0) / tau, (ty - y0) / tau - (g * tau) / 2, tau * 1000, 160 + this.rnd() * 300, 0.8 * S, 0.8 * S, 0, g, k % 3 ? gold : c.core, -1, 1);
    }
    // THE GLITTER RAIN: crackling specks drifting down over the whole view.
    const z = this.root.scale.x || 1;
    const ox = -this.root.position.x / z, oy = -this.root.position.y / z;
    const W = this.viewW / z, H = this.viewH / z;
    const rain = Math.round(this.look.rain);
    for (let k = 0; k < rain; k++) {
      const delay = 120 + this.rnd() * this.look.rainMs * 0.75;
      const x = ox + this.rnd() * W, y = oy - 20 * S + this.rnd() * H * 0.55;
      const tint = k % 3 === 0 ? c.core : k % 3 === 1 ? gold : this.tintOf(k % 5);
      this.addP(this.tex.star, F_FLICKER | (k % 4 === 0 ? F_CRACKLE : 0), x, y, (this.rnd() - 0.5) * 40 * S, (50 + this.rnd() * 90) * S, 900 + this.rnd() * 900, delay, (10 + this.rnd() * 10) * S / STAR_PX, (6 + this.rnd() * 6) * S / STAR_PX, 0.6, 50 * S, tint, -1, 1, (this.rnd() - 0.5) * 3);
    }
    // Smoke: the sky fills with it.
    for (let k = 0; k < 5; k++) {
      const a = this.rnd() * Math.PI * 2, r = R * (0.2 + 0.5 * this.rnd());
      this.puff(at.x + Math.cos(a) * r, at.y + Math.sin(a) * r * 0.7, R * (0.28 + 0.16 * this.rnd()), 0.1 * this.look.smoke, 2800 + this.rnd() * 900, 200 + k * 50, Math.cos(a) * 30 * S, -6 * S);
    }
  }

  private bigSphere(at: Pt, R: number, n: number, tint: number, tint2: number, life: number, drag: number, grav: number, size: number): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const z = this.rnd() * 2 - 1;
      const r2 = Math.sqrt(1 - z * z) * (0.95 + this.rnd() * 0.08);
      const a = this.rnd() * Math.PI * 2;
      const v = R * drag * r2;
      let f = F_STREAK | F_CHANGE;
      if (i % 8 === 3) f |= F_TRAIL;
      if (i % 3 === 0) f |= F_FLICKER;
      this.addP(this.tex.spark, f, at.x, at.y, Math.cos(a) * v, Math.sin(a) * v, life * (0.8 + this.rnd() * 0.4), 0, size * S, size * S, drag, grav, i % 7 === 6 ? this.tintOf(1) : tint, tint2, 1);
    }
  }

  private drawSky(dt: number): void {
    const k = this.sky;
    if (!k) return;
    k.age += dt;
    const u = clamp01(k.age / k.dur);
    // Undo the root's camera so the light always covers exactly the view.
    const z = this.root.scale.x || 1;
    k.s.position.set(-this.root.position.x / z, -this.root.position.y / z);
    k.s.scale.set(this.viewW / z / (k.s.texture.width || 1), this.viewH / z / (k.s.texture.height || 1));
    k.s.alpha = k.a0 * (u < 0.08 ? u / 0.08 : (1 - (u - 0.08) / 0.92) ** 2);
    if (u >= 1) { this.give(k.s); this.sky = null; }
  }

  /** Create sprites ahead of the show, a batch per frame, hold them unseen, then hand them all back to the pool. */
  private prefill(): void {
    if (this.prefillLeft <= 0) return;
    const n = Math.min(60, this.prefillLeft);
    for (let i = 0; i < n; i++) {
      const s = this.take(i % 12 === 0 ? 'under' : 'core', this.tex.streak, 0xffffff);
      if (!s) { this.prefillLeft = 0; break; }
      s.alpha = 0.004; s.position.set(-60, -60); s.scale.set(0.05);
      this.held.push(s);
      this.prefillLeft--;
    }
    if (this.prefillLeft <= 0) { for (const s of this.held) this.give(s); this.held = []; }
  }

  // ── the frame ─────────────────────────────────────────────────────────────────────────────────────────────

  protected override tick(dt: number): boolean {
    this.frame++;
    this.prefill();
    this.drawEmber(dt);
    for (let i = 0; i < this.flights.length; i++) { const f = this.flights[i]; if (f) this.drawFlight(f, dt); }
    this.drawSpinners(dt);
    this.drawP(dt);
    this.drawSky(dt);
    return !!this.ember || this.liveFlights > 0 || this.spinners.length > 0 || this.nP > 0 || !!this.sky || this.held.length > 0;
  }

  protected override clearOwn(): void {
    if (this.ember) { this.give(this.ember.glow); this.give(this.ember.core); this.ember = null; }
    for (let i = 0; i < this.flights.length; i++) this.endFlight(i);
    this.flights = [];
    this.spinners = [];
    for (let i = 0; i < this.nP; i++) { this.give(this.pS[i]!); this.pS[i] = null; }
    this.nP = 0;
    if (this.sky) { this.give(this.sky.s); this.sky = null; }
    for (const s of this.held) this.give(s);
    this.held = []; this.prefillLeft = 0;
  }
}

export type { Pt };
