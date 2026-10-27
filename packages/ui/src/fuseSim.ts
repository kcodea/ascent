/**
 * The crystal fuse's debris SIMULATION (end-of-turn charge, owner 2026-10-26). Renderer-free: it owns the particles
 * and the forces; `fuseRender.ts` draws them. Modelled on the FX workbench's particle physics (`burst.ts`
 * `pointGravity`, `motion.ts` turbulence, `emitter.ts` pooling): every particle is moved by forces each step —
 * pull to the gem, a vortex around it, layered-sine turbulence, drag, mass — never by a keyframed path, so orbits
 * come out of the forces and every turn's build-up differs (fresh seed per light).
 *
 * Space is stage px. Clock lock: spawning follows the CHARGE delta (fuse progress), not frame time, so a frame
 * hitch or a short window never leaves a gap or a clump; the caller simply does not step while the clock is held
 * (and `step(0, …)` is an exact no-op), so nothing moves or catches up across a hold (R-TIMER-SYNC-01).
 *
 * Modes: 'charging' (spawn at the burning front) → `collapse()` at 0:00 → 'collapsing' (strong pull, no spawning)
 * → 'idle' (≤ idleOrbiters survivors circle the gem calmly, forever, at a flat cost: no spawning, no absorbing).
 */
import { forceRamp, type FuseCfg } from './fuseTune';
import { makeRng, type FxRandom } from './fx/rng';
import { fieldPhaseOffset, turbulenceX, turbulenceY } from './fx/motion';

export type FuseKind = 'shard' | 'mote';
export interface FuseParticle {
  kind: FuseKind;
  x: number; y: number; vx: number; vy: number;
  mass: number; size: number; rot: number; spin: number;
  age: number; life: number;
  /** 1 → 0 after spawning: drives the white-hot colour. */
  heat: number;
  /** Idle orbit radius (px), rolled once per particle. */
  orbit: number;
}
export interface FuseGeom {
  fuseX0: number; fuseX1: number; fuseY: number;
  /** Spawn y spread (px). */
  fuseThick: number;
  gemX: number; gemY: number;
}
export type FuseMode = 'charging' | 'collapsing' | 'idle';

/** Seconds the white-hot heat lasts after a particle breaks off. */
const HEAT_SEC = 0.7;
/** A collapse that has not emptied by now absorbs whatever is left. */
const COLLAPSE_MAX_SEC = 2.5;
/** Idle orbit spring stiffness and radial damping. */
const IDLE_STIFF = 6;
const IDLE_DAMP = 4;
/** How hard an idle orbiter is steered to the calm orbit speed (1/s). */
const IDLE_SPEED_GAIN = 2;
/** Idle turbulence share (a little life in the calm orbit). */
const IDLE_TURB = 0.12;

export class FuseSim {
  private cfg: FuseCfg;
  private rng: FxRandom;
  private seed: number;
  private ps: FuseParticle[] = [];
  private pool: FuseParticle[] = [];
  private lastCharge = -1;
  private carry = 0;
  private t = 0;
  private collapseT = 0;
  private _mode: FuseMode = 'charging';
  private _absorbPulse = 0;
  private _collapseDone = false;
  /** How many steps the last `prewarm` ran (tests + perf). */
  lastPrewarmSteps = 0;

  constructor(cfg: FuseCfg, seed: number) {
    this.cfg = cfg;
    this.seed = seed;
    this.rng = makeRng(seed);
    this.t = fieldPhaseOffset(seed, 1);
  }

  get particles(): readonly FuseParticle[] { return this.ps; }
  get mode(): FuseMode { return this._mode; }
  get absorbPulse(): number { return this._absorbPulse; }
  get collapseDone(): boolean { return this._collapseDone; }

  reset(seed: number): void {
    for (const p of this.ps) this.pool.push(p);
    this.ps.length = 0;
    this.seed = seed;
    this.rng = makeRng(seed);
    this.t = fieldPhaseOffset(seed, 1);
    this.lastCharge = -1;
    this.carry = 0;
    this.collapseT = 0;
    this._mode = 'charging';
    this._absorbPulse = 0;
    this._collapseDone = false;
  }

  setCfg(cfg: FuseCfg): void { this.cfg = cfg; }

  /** 0:00 — stop spawning and drive everything into the gem. */
  collapse(): void {
    if (this._mode !== 'charging') return;
    this._mode = 'collapsing';
    this.collapseT = 0;
  }

  /** The APPEAR burst (owner 2026-10-27): `n` short-lived sparkles thrown off the unburnt fuse (from the burning
   *  front at `charge` to the right tip) in every direction. They live under ~1.1 s, so they flash and fade. */
  sparkle(n: number, charge: number, g: FuseGeom): void {
    const c = this.cfg;
    const r = this.rng;
    const x0 = g.fuseX0 + Math.min(1, Math.max(0, charge)) * (g.fuseX1 - g.fuseX0);
    for (let i = 0; i < n && this.ps.length < c.maxLive; i++) {
      const a = r() * Math.PI * 2;
      const sp = c.spawnSpeed * (1.5 + r() * 1.5);
      const p = this.alloc();
      p.kind = 'mote';
      p.x = x0 + r() * (g.fuseX1 - x0);
      p.y = g.fuseY + (r() - 0.5) * g.fuseThick;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.mass = c.moteMass;
      p.size = c.moteSize * (0.8 + r() * 0.8);
      p.rot = 0; p.spin = 0; p.age = 0;
      p.life = 0.5 + r() * 0.6;
      p.heat = 1;
      p.orbit = c.vortexR;
      this.ps.push(p);
    }
  }

  /** Test/tuner hook: add one particle (defaults: a still mote). */
  addParticle(init: Partial<FuseParticle>): FuseParticle {
    const kind = init.kind ?? 'mote';
    const p = this.alloc();
    p.kind = kind; p.x = 0; p.y = 0; p.vx = 0; p.vy = 0;
    p.mass = kind === 'shard' ? this.cfg.shardMass : this.cfg.moteMass;
    p.size = kind === 'shard' ? this.cfg.shardSize : this.cfg.moteSize;
    p.rot = 0; p.spin = 0; p.age = 0; p.life = 1e9; p.heat = 0; p.orbit = this.cfg.vortexR * 0.8;
    Object.assign(p, init);
    this.ps.push(p);
    return p;
  }

  /** Pre-warm a light that starts mid-window: run the recent stretch of fuse fast, off-screen, within a step cap. */
  prewarm(charge: number, g: FuseGeom, maxSteps = 90): void {
    const steps = Math.max(1, Math.floor(maxSteps));
    const dt = 1 / 60;
    // ~1 charge unit = the 20 s window; replay at most `steps` frames' worth of it.
    const span = Math.min(charge, (steps * dt) / 20);
    this.lastCharge = charge - span;
    let n = 0;
    for (let i = 1; i <= steps; i++) {
      this.step(dt, charge - span + (span * i) / steps, g);
      n++;
    }
    this.lastPrewarmSteps = n;
  }

  step(dt: number, charge: number, g: FuseGeom): void {
    if (!(dt > 0)) return;
    const c = this.cfg;
    this.t += dt;
    this._absorbPulse *= Math.exp(-4 * dt);

    if (this._mode === 'charging') this.spawn(charge, g);
    else if (this._mode === 'collapsing') this.collapseT += dt;

    const idle = this._mode === 'idle';
    const collapsing = this._mode === 'collapsing';
    const ramp = forceRamp(c, collapsing ? 1 : charge);
    const pull = collapsing ? c.collapsePull : c.pull * ramp;
    const vortex = collapsing ? c.vortex * ramp * 0.25 : c.vortex * ramp;
    const turb = idle ? c.turbulence * IDLE_TURB : c.turbulence * ramp;
    const absorbR = collapsing ? c.absorbR * (1 + this.collapseT * 8) : c.absorbR;
    const dragK = idle ? 1 : Math.pow(Math.min(1, Math.max(0.0001, c.drag)), dt);

    let w = 0;
    for (let i = 0; i < this.ps.length; i++) {
      const p = this.ps[i];
      const dx = g.gemX - p.x;
      const dy = g.gemY - p.y;
      const d = Math.hypot(dx, dy);
      let ax: number; let ay: number;
      if (idle) {
        const dd = Math.max(1, d);
        const nx = -dx / dd; const ny = -dy / dd; // outward
        const tx = -ny; const ty = nx;            // clockwise on screen
        const vr = p.vx * nx + p.vy * ny;
        const vt = p.vx * tx + p.vy * ty;
        const radial = -IDLE_STIFF * (dd - p.orbit) - IDLE_DAMP * vr - (vt * vt) / Math.max(dd, p.orbit * 0.5);
        const tangential = IDLE_SPEED_GAIN * (c.idleVortex - vt);
        ax = nx * radial + tx * tangential;
        ay = ny * radial + ty * tangential;
      } else {
        if (d < absorbR) { this.absorb(p); continue; }
        p.age += dt;
        if (p.age >= p.life) { this.pool.push(p); continue; }
        const inv = d > 0.01 ? 1 / d : 0;
        // Pull: constant magnitude toward the gem (burst.ts pointGravity).
        ax = dx * inv * pull;
        ay = dy * inv * pull;
        // Vortex: perpendicular to the outward radius, clockwise on screen, falling off past vortexR.
        const fall = Math.min(1, c.vortexR / Math.max(d, c.vortexR * 0.25));
        ax += dy * inv * vortex * fall;
        ay += -dx * inv * vortex * fall;
      }
      ax += turbulenceX(p.x, p.y, this.t, c.turbScale) * turb;
      ay += turbulenceY(p.x, p.y, this.t, c.turbScale) * turb;
      // The calm wait orbit is mass-free (a steady hum); everything else is force / mass.
      const im = idle ? 1 : 1 / Math.max(0.05, p.mass);
      p.vx = (p.vx + ax * im * dt) * dragK;
      p.vy = (p.vy + ay * im * dt) * dragK;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      if (p.heat > 0) p.heat = Math.max(0, p.heat - dt / HEAT_SEC);
      this.ps[w++] = p;
    }
    this.ps.length = w;

    if (collapsing && (this.ps.length <= c.idleOrbiters || this.collapseT >= COLLAPSE_MAX_SEC)) this.enterIdle(g);
  }

  private enterIdle(g: FuseGeom): void {
    const c = this.cfg;
    const keepR = c.vortexR * 2;
    const vt = c.idleVortex;
    let w = 0;
    for (let i = 0; i < this.ps.length; i++) {
      const p = this.ps[i];
      const dx = p.x - g.gemX; const dy = p.y - g.gemY;
      const d = Math.hypot(dx, dy);
      if (w >= c.idleOrbiters || d > keepR || d < 1) { this.absorb(p); continue; }
      // Settle a survivor out of collapse speed onto the calm clockwise orbit (no radial fling past the gem).
      p.vx = (-dy / d) * vt;
      p.vy = (dx / d) * vt;
      p.life = Infinity;
      this.ps[w++] = p;
    }
    this.ps.length = w;
    // Top up to a few calm orbiters (a light that starts at 0:00 has none in flight).
    while (this.ps.length < c.idleOrbiters) {
      const r = this.rng;
      const kind: FuseKind = r() < c.shardShare ? 'shard' : 'mote';
      const orbit = c.vortexR * (0.55 + r() * 0.55);
      const a = r() * Math.PI * 2;
      const nx = Math.cos(a); const ny = Math.sin(a);
      this.addParticle({
        kind, orbit,
        x: g.gemX + nx * orbit, y: g.gemY + ny * orbit,
        vx: -ny * vt, vy: nx * vt,
        size: (kind === 'shard' ? c.shardSize : c.moteSize) * (1 + (r() * 2 - 1) * c.sizeVar),
        rot: r() * Math.PI * 2, spin: kind === 'shard' ? (r() * 2 - 1) * 3 : 0,
        life: Infinity,
      });
    }
    this._mode = 'idle';
    this._collapseDone = true;
  }

  private absorb(p: FuseParticle): void {
    this._absorbPulse = Math.min(1, this._absorbPulse + 0.06);
    this.pool.push(p);
  }

  private alloc(): FuseParticle {
    return this.pool.pop() ?? {
      kind: 'mote', x: 0, y: 0, vx: 0, vy: 0, mass: 1, size: 1, rot: 0, spin: 0, age: 0, life: 1, heat: 0, orbit: 0,
    };
  }

  /** Spawn along the stretch of fuse that burnt since the last step (charge delta, not dt). */
  private spawn(charge: number, g: FuseGeom): void {
    const c = this.cfg;
    if (this.lastCharge < 0 || charge < this.lastCharge) { this.lastCharge = charge; this.carry = 0; return; }
    const from = this.lastCharge;
    const want = c.spawnPerFuse * (charge - from) + this.carry;
    const n = Math.floor(want);
    this.carry = want - n;
    this.lastCharge = charge;
    const r = this.rng;
    const span = g.fuseX1 - g.fuseX0;
    for (let i = 0; i < n; i++) {
      if (this.ps.length >= c.maxLive) { this.carry = 0; break; }
      const kind: FuseKind = r() < c.shardShare ? 'shard' : 'mote';
      const at = from + (charge - from) * ((i + r()) / n);
      // Up (or down, half the time) off the fuse, fanned ±65°, drifting back a touch.
      const ang = (r() * 2 - 1) * 1.13;
      const up = r() < 0.5 ? -1 : 1;
      const sp = c.spawnSpeed * (1 + (r() * 2 - 1) * c.spawnSpeedVar);
      const p = this.alloc();
      p.kind = kind;
      p.x = g.fuseX0 + at * span;
      p.y = g.fuseY + (r() - 0.5) * g.fuseThick;
      p.vx = Math.sin(ang) * sp - sp * 0.25;
      p.vy = Math.cos(ang) * sp * up;
      p.mass = (kind === 'shard' ? c.shardMass : c.moteMass) * (0.8 + r() * 0.4);
      p.size = (kind === 'shard' ? c.shardSize : c.moteSize) * (1 + (r() * 2 - 1) * c.sizeVar);
      p.rot = r() * Math.PI * 2;
      p.spin = kind === 'shard' ? (r() * 2 - 1) * 6 : 0;
      p.age = 0;
      p.life = c.life * (1 + (r() * 2 - 1) * c.lifeVar);
      p.heat = 1;
      p.orbit = c.vortexR * (0.55 + r() * 0.55);
      this.ps.push(p);
    }
  }
}
