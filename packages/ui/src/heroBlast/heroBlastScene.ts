/**
 * THE BLAST SCENE: everything the Blast hero attack draws in Pixi, as a plain scene graph with no renderer, so it
 * runs (and is tested) headless. `heroBlast.ts` mounts `root` on the shared gameplay overlay and feeds `update(dt)`.
 *
 * What it draws:
 *  - merge sparks where the numbers combine;
 *  - the CHARGE at the attacking hero: a core that swells and throbs, a ring closing in, motes pulled inward;
 *  - the BOLTS: an elongated hot head with a coloured halo, accelerating on a slight arc, shedding a trail of motes
 *    and the odd spark; a muzzle flash and a forward spark cone at the hero on each shot;
 *  - the IMPACT: a white-hot flash, a coloured bloom, two shockwave rings at different speeds, a spray of streak
 *    sparks biased along the bolt's heading, and a few slower embers that fall. Trailing bolts land smaller hits.
 *
 * Contract: sprites are POOLED (hidden and reused, never created per frame once warm) and every list is bounded by
 * `MAX_SPRITES`; textures belong to the caller (built once per session); positions are SCREEN px (the overlay's
 * space); `update` returns whether anything still moves; `destroy()` leaves nothing behind. Math.random is fine
 * here: presentation only, it never feeds the simulation.
 */
import { Container, Sprite, type Texture } from 'pixi.js';

export interface HeroBlastTextures { glow: Texture; spark: Texture; streak: Texture; ring: Texture }

/** Hard cap on sprites alive at once (particles + bolts + flashes). */
export const MAX_SPRITES = 360;

type Pt = { x: number; y: number };

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number;
  life: number; max: number; from: number; to: number; alpha: number; streak: boolean;
}

/** A sprite that just scales and fades in place (flash, bloom, ring, muzzle). */
interface Pulse { s: Sprite; age: number; dur: number; from: number; to: number; a0: number; peakAt: number; ease: 'out' | 'punch' }

interface Bolt {
  head: Sprite; halo: Sprite; from: Pt; to: Pt; ctrl: Pt; age: number; dur: number; size: number;
  lastX: number; lastY: number; trailAcc: number;
}

interface Charge { core: Sprite; ring: Sprite; x: number; y: number; age: number; dur: number; size: number; releasing: number; moteAcc: number; motes: number }

export interface BlastColors { core: number; bolt: number; impact: number }

const clamp01 = (t: number): number => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0);
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
/** The bolt's progress curve: leaves quickly and still ACCELERATES into the target (weight on arrival). */
export const boltEase = (u: number): number => { const t = clamp01(u); return 0.35 * t + 0.65 * t * t; };

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
  private destroyed = false;

  constructor(private readonly tex: HeroBlastTextures, private readonly colors: BlastColors, private readonly scale = 1, private readonly trail = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroBlast';
  }

  /** Sprites currently in use (particles, bolts, flashes). */
  get liveSprites(): number { return this.used; }
  /** Sprites the pool has ever created (bounded by `MAX_SPRITES`). */
  get pooledSprites(): number { return this.root.children.length; }
  get liveBolts(): number { return this.bolts.length; }
  get charging(): boolean { return this.charge !== null; }

  private take(t: Texture, tint: number, blend: 'add' | 'normal' = 'add'): Sprite | null {
    if (this.destroyed || this.used >= MAX_SPRITES) return null;
    let s = this.free.pop();
    if (!s) { s = new Sprite(t); s.anchor.set(0.5); this.root.addChild(s); }
    else s.texture = t;
    s.tint = tint; s.blendMode = blend; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
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

  private pulse(t: Texture, tint: number, x: number, y: number, dur: number, from: number, to: number, a0: number, ease: Pulse['ease'] = 'out', peakAt = 0.25): void {
    const s = this.take(t, tint);
    if (!s) return;
    s.position.set(x, y); s.scale.set(from * this.scale); s.alpha = ease === 'punch' ? 0 : a0;
    this.pulses.push({ s, age: 0, dur, from, to, a0, peakAt, ease });
  }

  /** A small burst where a number lands in the total (`big` for the final merge). */
  mergeBurst(x: number, y: number, big: boolean): void {
    const n = big ? 16 : 5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (big ? 260 : 150) * (0.5 + Math.random()) * this.scale;
      this.particle(this.tex.spark, Math.random() < 0.5 ? this.colors.core : this.colors.bolt, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.02, grav: 0, life: 260 + Math.random() * 200,
        from: (big ? 0.9 : 0.6) * this.scale, to: 0.1 * this.scale, alpha: 1, streak: false,
      });
    }
    this.pulse(this.tex.glow, this.colors.bolt, x, y, big ? 320 : 180, 0.15, big ? 1.1 : 0.55, big ? 0.85 : 0.5, 'punch', 0.2);
    if (big) this.pulse(this.tex.ring, this.colors.core, x, y, 360, 0.15, 0.9, 0.8);
  }

  /** The hero gathers: a swelling core, a closing ring, motes pulled in. Released by `fire`. */
  startCharge(x: number, y: number, durMs: number, size: number, motes: number): void {
    if (this.charge) return;
    const core = this.take(this.tex.glow, this.colors.core);
    const ring = this.take(this.tex.ring, this.colors.bolt);
    if (!core || !ring) { if (core) this.give(core); if (ring) this.give(ring); return; }
    core.position.set(x, y); ring.position.set(x, y); core.alpha = 0; ring.alpha = 0;
    this.charge = { core, ring, x, y, age: 0, dur: Math.max(1, durMs), size, releasing: -1, moteAcc: 0, motes };
  }

  /** One shot leaves the hero: muzzle flash + forward spark cone, and the bolt itself. `age0` = ms already elapsed. */
  fire(from: Pt, to: Pt, travelMs: number, size: number, curve: number, age0 = 0): void {
    const ch = this.charge;
    if (ch && ch.releasing < 0) ch.releasing = 0;
    const dx = to.x - from.x, dy = to.y - from.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    this.pulse(this.tex.glow, this.colors.core, from.x, from.y, 170, 0.2, 1.1 * size, 1, 'punch', 0.18);
    this.pulse(this.tex.glow, this.colors.bolt, from.x, from.y, 240, 0.4, 1.7 * size, 0.7, 'punch', 0.22);
    for (let i = 0; i < 7; i++) {
      const a = Math.atan2(uy, ux) + (Math.random() - 0.5) * 1.1;
      const sp = (500 + Math.random() * 500) * this.scale;
      this.particle(this.tex.streak, i % 2 ? this.colors.core : this.colors.bolt, {
        x: from.x, y: from.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.004, grav: 0,
        life: 150 + Math.random() * 110, from: 0.5 * this.scale, to: 0.15 * this.scale, alpha: 1, streak: true,
      });
    }
    const head = this.take(this.tex.streak, this.colors.core);
    const halo = this.take(this.tex.glow, this.colors.bolt);
    if (!head || !halo) { if (head) this.give(head); if (halo) this.give(halo); return; }
    head.position.set(from.x, from.y); halo.position.set(from.x, from.y);
    this.bolts.push({ head, halo, from, to, ctrl: arcControl(from, to, curve), age: Math.max(0, age0), dur: Math.max(1, travelMs), size, lastX: from.x, lastY: from.y, trailAcc: 0 });
  }

  /** The lead bolt lands. `dir` is the bolt's heading, so the spray carries through the target. */
  impact(x: number, y: number, dir: Pt, k: number, flashScale: number, flashAlpha: number, sparks: number): void {
    const c = this.colors;
    this.pulse(this.tex.glow, c.core, x, y, 260, 0.3, 2.3 * flashScale, flashAlpha, 'punch', 0.12);
    this.pulse(this.tex.glow, c.impact, x, y, 460, 0.5, 3.4 * flashScale, 0.75 * flashAlpha, 'punch', 0.18);
    this.pulse(this.tex.ring, c.core, x, y, 380, 0.25, 2.4 * (0.8 + 0.5 * k), 0.95);
    this.pulse(this.tex.ring, c.impact, x, y, 560, 0.2, 3.3 * (0.8 + 0.5 * k), 0.6);
    this.spray(x, y, dir, sparks, 1);
    const embers = Math.round(4 + 8 * k);
    for (let i = 0; i < embers; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = (120 + Math.random() * 220) * this.scale;
      this.particle(this.tex.spark, Math.random() < 0.5 ? c.bolt : c.impact, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.25, grav: 520 * this.scale, life: 520 + Math.random() * 380,
        from: 0.7 * this.scale, to: 0.2 * this.scale, alpha: 1, streak: false,
      });
    }
  }

  /** A trailing bolt lands: a smaller flash, a ring and a short spray. */
  hit(x: number, y: number, dir: Pt, size: number): void {
    this.pulse(this.tex.glow, this.colors.core, x, y, 200, 0.25, 1.4 * size, 0.85, 'punch', 0.15);
    this.pulse(this.tex.ring, this.colors.bolt, x, y, 300, 0.2, 1.5 * size, 0.75);
    this.spray(x, y, dir, 8, 0.7);
  }

  private spray(x: number, y: number, dir: Pt, n: number, power: number): void {
    const head = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < n; i++) {
      // 60% carry THROUGH the target along the heading, the rest splash all round.
      const a = Math.random() < 0.6 ? head + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2;
      const sp = (520 + Math.random() * 900) * power * this.scale;
      this.particle(this.tex.streak, Math.random() < 0.35 ? this.colors.core : (Math.random() < 0.5 ? this.colors.bolt : this.colors.impact), {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.012, grav: 260 * this.scale, life: 240 + Math.random() * 300,
        from: (0.55 + Math.random() * 0.45) * this.scale, to: 0.1 * this.scale, alpha: 1, streak: true,
      });
    }
  }

  /** Advance by `dtMs` (sequence ms: the runner has already applied the playback speed). True while anything moves. */
  update(dtMs: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(100, dtMs));
    const sec = dt / 1000;

    const ch = this.charge;
    if (ch) {
      ch.age += dt;
      const u = clamp01(ch.age / ch.dur);
      if (ch.releasing < 0) {
        // Swell with a quickening throb; the ring closes in as the core fills.
        const throb = 1 + 0.08 * Math.sin(ch.age * (0.02 + 0.03 * u));
        ch.core.scale.set((0.25 + 0.95 * easeOutCubic(u)) * ch.size * throb * this.scale);
        ch.core.alpha = 0.35 + 0.6 * u;
        ch.ring.scale.set((2.1 - 1.5 * easeOutCubic(u)) * ch.size * this.scale);
        ch.ring.alpha = 0.85 * Math.min(1, u * 2.5);
        ch.moteAcc += (ch.motes / ch.dur) * dt * (0.5 + u);
        while (ch.moteAcc >= 1) {
          ch.moteAcc -= 1;
          const a = Math.random() * Math.PI * 2;
          const r = (70 + Math.random() * 60) * ch.size * this.scale;
          const life = 180 + Math.random() * 120;
          const sp = r / (life / 1000);
          this.particle(this.tex.streak, Math.random() < 0.5 ? this.colors.core : this.colors.bolt, {
            x: ch.x + Math.cos(a) * r, y: ch.y + Math.sin(a) * r, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp,
            drag: 1, grav: 0, life, from: 0.45 * this.scale, to: 0.12 * this.scale, alpha: 0.9, streak: true,
          });
        }
      } else {
        ch.releasing += dt;
        const r = clamp01(ch.releasing / 180);
        ch.core.scale.set((1.2 + 0.6 * r) * ch.size * this.scale);
        ch.core.alpha = 0.95 * (1 - r);
        ch.ring.alpha *= 1 - r;
        if (r >= 1) { this.give(ch.core); this.give(ch.ring); this.charge = null; }
      }
    }

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!;
      b.age += dt;
      const u = clamp01(b.age / b.dur);
      const p = bezier(b.from, b.ctrl, b.to, boltEase(u));
      const vx = p.x - b.lastX, vy = p.y - b.lastY;
      const step = Math.hypot(vx, vy);
      if (step > 0.01) b.head.rotation = Math.atan2(vy, vx);
      // The head stretches with its speed (a streak, not a ball), the halo breathes.
      b.head.scale.set((0.9 + Math.min(1.6, step / (18 * this.scale))) * b.size * this.scale, 0.75 * b.size * this.scale);
      b.head.position.set(p.x, p.y);
      b.halo.position.set(p.x, p.y);
      b.halo.scale.set((0.55 + 0.1 * Math.sin(b.age * 0.09)) * b.size * this.scale);
      b.halo.alpha = 0.85;
      // Trail: motes laid along the segment just travelled (spacing shrinks with density), so it never gaps.
      const spacing = (9 * this.scale) / Math.max(0.05, this.trail);
      b.trailAcc += this.trail > 0 ? step : 0;
      while (b.trailAcc >= spacing) {
        b.trailAcc -= spacing;
        const f = step > 0 ? 1 - b.trailAcc / step : 1;
        const tx = b.lastX + vx * f, ty = b.lastY + vy * f;
        const jit = (Math.random() - 0.5) * 6 * this.scale;
        this.particle(this.tex.glow, Math.random() < 0.3 ? this.colors.core : this.colors.bolt, {
          x: tx + jit, y: ty - jit, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40, drag: 0.1, grav: 0,
          life: 150 + Math.random() * 90, from: 0.26 * b.size * this.scale, to: 0.02 * this.scale, alpha: 0.75, streak: false,
        });
        if (Math.random() < 0.12) {
          const a = Math.random() * Math.PI * 2, sp = (80 + Math.random() * 160) * this.scale;
          this.particle(this.tex.spark, this.colors.core, {
            x: tx, y: ty, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.1, grav: 200 * this.scale,
            life: 220 + Math.random() * 160, from: 0.4 * this.scale, to: 0.05 * this.scale, alpha: 1, streak: false,
          });
        }
      }
      b.lastX = p.x; b.lastY = p.y;
      if (u >= 1) { this.give(b.head); this.give(b.halo); this.bolts.splice(i, 1); }
    }

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const q = this.pulses[i]!;
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      q.s.scale.set((q.from + (q.to - q.from) * easeOutCubic(u)) * this.scale);
      q.s.alpha = q.ease === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.a0 * (1 - u);
      if (u >= 1) { this.give(q.s); this.pulses.splice(i, 1); }
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
      if (p.streak) {
        p.s.rotation = Math.atan2(p.vy, p.vx);
        const spd = Math.hypot(p.vx, p.vy) / Math.max(0.001, this.scale);
        p.s.scale.set(sc * (0.6 + Math.min(1.6, spd / 600)), sc * 0.55);
      } else p.s.scale.set(sc);
      p.s.alpha = p.alpha * (1 - t * t);
    }

    return this.used > 0;
  }

  /** Drop every in-flight effect at once (a cancel). The pool is kept for reuse. */
  clear(): void {
    for (const p of this.particles) this.give(p.s);
    for (const q of this.pulses) this.give(q.s);
    for (const b of this.bolts) { this.give(b.head); this.give(b.halo); }
    if (this.charge) { this.give(this.charge.core); this.give(this.charge.ring); }
    this.particles = []; this.pulses = []; this.bolts = []; this.charge = null;
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
