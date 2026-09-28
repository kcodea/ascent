/**
 * THE QUAKE SCENE: everything the Quake hero attack draws in Pixi, as a plain scene graph with no renderer, so it runs
 * (and is tested) headless. `heroQuake.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * Design rule (owner bar 2026-09-28: "blizzard quality pristine", "thicker and cleaner"): FEW, BOLD elements with one
 * colour language. The GROUND is solid (normal blend): cracks are a dark chasm inside a light broken lip, rocks are
 * faceted chunks with a thick outline and a shadow on the ground, dust is soft heavy cloud. LIGHT is additive and only
 * light: the magma seams inside the cracks, the flashes, the pillar, the embers. The attacker's side colour is the
 * magma (yours amber, theirs red).
 *
 * LAYERS, bottom to top (each one blend mode, so the whole scene batches in four runs): scorch, crack lips, chasms |
 * magma glow, magma seams | rock shadows, dust, rocks | air light (flashes, rings, pillar, embers).
 *
 * CRACKS are pooled capsule sprites laid along a jagged polyline and REVEALED by a front (each segment grows from its
 * start as the front passes), so a crack is one continuous stroke at any frame rate. A segment OPENS behind the tip
 * (its width grows over `openPx`), the tip glows hottest, the seams cool after the impact, and everything fades on
 * `fade()`. Paths come from a seeded generator, so the same fight draws the same cracks (a replay looks identical).
 *
 * Contract: sprites POOLED per layer (hidden and reused), every list bounded by `MAX_QUAKE_SPRITES`; textures are the
 * caller's; the positions are the overlay's px; `setCamera` mirrors the DOM camera; `update` returns whether anything
 * still draws; `destroy()` leaves nothing behind.
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import type { HeroBlastTextures } from '../heroBlast/heroBlastScene';
import { clamp01, easeOutCubic, easeOutQuint, mixColor, whiten, type Pt } from '../heroAttack/easing';
import { quakeEase } from './heroQuakeConfig';

export interface HeroQuakeTextures extends HeroBlastTextures {
  crack: Texture; seamGlow: Texture; rocks: Texture[]; dust: Texture; dustRing: Texture; scorch: Texture;
}

export interface QuakeColors { core: number; side: number; chasm: number; lip: number; dust: number; rock: number }

/** Hard cap on sprites alive at once (a Tier IV quake peaks around 900). */
export const MAX_QUAKE_SPRITES = 1500;

type LayerId = 'scorch' | 'lips' | 'chasms' | 'glow' | 'seams' | 'shadows' | 'dust' | 'rocks' | 'air';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [
  ['scorch', 'normal'], ['lips', 'normal'], ['chasms', 'normal'], ['glow', 'add'], ['seams', 'add'],
  ['shadows', 'normal'], ['dust', 'normal'], ['rocks', 'normal'], ['air', 'add'],
];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
/** A rock's drawn size per unit of `size` (the rock texture is 48 px across). */
const ROCK_PX = 34 / 48;

interface Seg { x: number; y: number; len: number; ang: number; d0: number; w: number; lip: Sprite; chasm: Sprite; seam: Sprite | null; glow: Sprite | null }

type Drive =
  | { kind: 'main'; t0: number; dur: number }
  | { kind: 'child'; parent: Crack; rootD: number; ratio: number }
  | { kind: 'timed'; t0: number; dur: number };

interface Crack {
  segs: Seg[]; L: number; f: number; drive: Drive; magma: number; openPx: number;
  /** When the front reached the end (scene ms; -1 = still running): the crack keeps opening after. */
  doneAt: number;
  /** Seams on this crack stay warm this long after the cool starts (the crater's own cracks linger). */
  linger: number;
  /** Emits dust and grit at its front (the main crack). */
  kick: number; lastKick: number;
}

interface Rock {
  s: Sprite; sh: Sprite; glow: Sprite | null; gx: number; gy: number; vx: number; vy: number; z: number; vz: number;
  rot: number; vr: number; life: number; max: number; bounced: boolean; hot: number; size: number;
  /** While held (the wind-up), the rock hovers at this height; -1 = free. */
  hold: number; seed: number;
}

type Alpha = 'out' | 'punch' | 'puff' | 'hold';
interface Fx {
  s: Sprite; age: number; dur: number; from: number; to: number; a0: number; alpha: Alpha; peakAt: number;
  /** y scale as a fraction of x (1 = round; a streak is thin). */
  sy: number; vx: number; vy: number; drag: number; rise: number; spin: number; delay: number;
}

interface Particle { s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number; from: number; to: number; alpha: number }

interface Pillar { outer: Sprite; core: Sprite; cap: Sprite; x: number; y: number; age: number; rise: number; hold: number; width: number; height: number }

interface Windup { ring: Sprite; pool: Sprite; x: number; y: number; age: number; dur: number; size: number }

/** A tiny seeded generator (mulberry32): the same fight draws the same cracks. Presentation only. */
export function quakeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A jagged crack path from `a` to `b`: a bounded random walk off the straight line, pinned to both ends, one point per
 * `segPx`. `jag` is how far each step may wander (a fraction of a segment). Pure given the generator.
 */
export function crackPath(a: Pt, b: Pt, segPx: number, jag: number, rnd: () => number, maxDevPx: number): Pt[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const n = Math.max(2, Math.round(L / Math.max(4, segPx)));
  const pts: Pt[] = [{ x: a.x, y: a.y }];
  let off = 0;
  for (let i = 1; i < n; i++) {
    off += (rnd() - 0.5) * 2 * jag * segPx * 0.6;
    off = Math.max(-maxDevPx, Math.min(maxDevPx, off));
    const env = Math.sin((Math.PI * i) / n);
    const along = (L * i) / n + (rnd() - 0.5) * segPx * 0.25;
    pts.push({ x: a.x + ux * along - uy * off * env, y: a.y + uy * along + ux * off * env });
  }
  pts.push({ x: b.x, y: b.y });
  return pts;
}

export class HeroQuakeScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly free: Record<LayerId, Sprite[]>;
  private used = 0;
  private age = 0;
  private cracks: Crack[] = [];
  private rocks: Rock[] = [];
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private pillars: Pillar[] = [];
  private windupFx: Windup | null = null;
  private main: Crack | null = null;
  private coolAt = Infinity;
  private coolMs = 900;
  private fadeAt = Infinity;
  private fadeMs = 420;
  private gravity = 2600;
  private destroyed = false;
  private readonly hot: number;
  private readonly rnd: () => number;

  constructor(private readonly tex: HeroQuakeTextures, private readonly colors: QuakeColors, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroQuake';
    this.layers = {} as Record<LayerId, Container>;
    this.free = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `quake-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.free[id] = [];
    }
    this.hot = whiten(colors.side, 0.55);
    this.rnd = quakeRng(seed);
  }

  get liveSprites(): number { return this.used; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) n += this.layers[id].children.length; return n; }
  get liveCracks(): number { return this.cracks.length; }
  get liveRocks(): number { return this.rocks.length; }
  /** The main crack's front, 0..1 of its length (-1 = none). */
  get front(): number { return this.main ? this.main.f / Math.max(1, this.main.L) : -1; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_QUAKE_SPRITES) return null;
    let s = this.free[layer].pop();
    if (!s) {
      s = new Sprite(t);
      s.blendMode = BLEND[layer];
      this.layers[layer].addChild(s);
    } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(s: Sprite, layer: LayerId): void { s.visible = false; this.free[layer].push(s); this.used--; }

  /** Where a sprite lives, from its parent (so a give never needs the caller to remember). */
  private giveAny(s: Sprite): void {
    for (const [id] of LAYERS) if (s.parent === this.layers[id]) { this.give(s, id); return; }
  }

  private addFx(layer: LayerId, t: Texture, tint: number, x: number, y: number, o: Partial<Omit<Fx, 's'>> & { dur: number; from: number; to: number; a0: number }): void {
    const s = this.take(layer, t, tint);
    if (!s) return;
    s.position.set(x, y);
    s.rotation = o.spin ? this.rnd() * Math.PI * 2 : 0;
    s.alpha = 0;
    this.fx.push({ s, age: 0, alpha: 'out', peakAt: 0.2, sy: 1, vx: 0, vy: 0, drag: 1, rise: 0, spin: 0, delay: 0, ...o });
  }

  private particle(layer: LayerId, t: Texture, tint: number, o: Omit<Particle, 's' | 'max'>): void {
    const s = this.take(layer, t, tint);
    if (!s) return;
    s.position.set(o.x, o.y);
    this.particles.push({ ...o, s, max: o.life });
  }

  // ─── cracks ────────────────────────────────────────────────────────────────────────────────────────────────

  private buildCrack(pts: Pt[], width: number, magma: number, drive: Drive, profile: (u: number) => number, openPx: number, kick = 0, linger = 0): Crack | null {
    const S = this.scale;
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    const segs: Seg[] = [];
    let d = 0;
    const seamOn = magma > 0.01;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 0.5) continue;
      const lip = this.take('lips', this.tex.crack, this.colors.lip);
      const chasm = this.take('chasms', this.tex.crack, this.colors.chasm);
      const glow = seamOn ? this.take('glow', this.tex.seamGlow, this.colors.side) : null;
      const seam = this.take('seams', this.tex.crack, this.hot);
      if (!lip || !chasm || !seam) { for (const s of [lip, chasm, glow, seam]) if (s) this.giveAny(s); break; }
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const w = width * S * profile((d + len / 2) / Math.max(1, L)) * (0.85 + 0.3 * this.rnd());
      for (const s of [lip, chasm, seam, glow]) {
        if (!s) continue;
        s.anchor.set(0, 0.5); s.position.set(a.x, a.y); s.rotation = ang; s.scale.set(0, 0); s.alpha = 0;
      }
      segs.push({ x: a.x, y: a.y, len, ang, d0: d, w, lip, chasm, seam, glow });
      d += len;
    }
    if (!segs.length) return null;
    const c: Crack = { segs, L: d, f: 0, drive, magma, openPx: openPx * S, doneAt: -1, linger, kick, lastKick: 0 };
    this.cracks.push(c);
    return c;
  }

  /**
   * THE QUAKE: the main crack from the attacker's rim to the defender's, its branches and (Tier III+) parallel
   * fissures. The front runs on `quakeEase` over `travelMs`, starting `age0` ms ago.
   */
  quake(a: Pt, d: Pt, rA: number, rD: number, o: {
    travelMs: number; width: number; branches: number; fissures: number; magma: number; segPx: number; jag: number; openPx: number;
    branchLength: number; grit: number; age0?: number;
  }): void {
    const S = this.scale;
    const dx = d.x - a.x, dy = d.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const from = { x: a.x + ux * rA * 0.85, y: a.y + uy * rA * 0.85 };
    const to = { x: d.x - ux * rD * 0.9, y: d.y - uy * rD * 0.9 };
    const len = Math.hypot(to.x - from.x, to.y - from.y);
    const seg = o.segPx * S;
    const pts = crackPath(from, to, seg, o.jag, this.rnd, Math.min(len * 0.06, 46 * S));
    // Wider toward the target: the ground opens up where it is about to erupt.
    const main = this.buildCrack(pts, o.width, o.magma, { kind: 'main', t0: this.age - (o.age0 ?? 0), dur: Math.max(1, o.travelMs) },
      (u) => 0.72 + 0.45 * u, o.openPx, o.grit);
    if (!main) return;
    this.main = main;
    // BRANCHES split off the main crack, alternating sides, angled forward, tapering to a point.
    for (let i = 0; i < o.branches; i++) {
      const rootD = main.L * (0.14 + 0.72 * ((i + 0.3 + this.rnd() * 0.4) / Math.max(1, o.branches)));
      const root = this.pointOn(main, rootD);
      const side = i % 2 ? 1 : -1;
      const ang = Math.atan2(uy, ux) + side * (0.45 + this.rnd() * 0.5);
      const bl = main.L * o.branchLength * (0.6 + this.rnd() * 0.6);
      const end = { x: root.x + Math.cos(ang) * bl, y: root.y + Math.sin(ang) * bl };
      const bp = crackPath(root, end, seg * 0.75, o.jag * 1.2, this.rnd, bl * 0.12);
      this.buildCrack(bp, o.width * 0.55, o.magma * 0.8, { kind: 'child', parent: main, rootD, ratio: 0.85 }, (u) => 1 - 0.7 * u, o.openPx * 0.6);
    }
    // FISSURES: parallel cracks running beside the main one (a wide fissure network, Tier III+).
    for (let i = 0; i < o.fissures; i++) {
      const side = i % 2 ? 1 : -1;
      const gap = (o.width * 1.6 + 16 + 10 * Math.floor(i / 2)) * S * side;
      const s0 = main.L * (0.1 + 0.18 * this.rnd()), s1 = main.L * (0.78 + 0.16 * this.rnd());
      const p0 = this.pointOn(main, s0), p1 = this.pointOn(main, s1);
      const fp = crackPath({ x: p0.x - uy * gap, y: p0.y + ux * gap }, { x: p1.x - uy * gap, y: p1.y + ux * gap }, seg * 1.1, o.jag, this.rnd, 18 * S);
      this.buildCrack(fp, o.width * 0.45, o.magma * 0.7, { kind: 'child', parent: main, rootD: s0, ratio: 1 }, (u) => 0.5 + 0.5 * Math.sin(Math.PI * u), o.openPx * 0.5);
    }
  }

  /** A starburst of short cracks around a point (the slam, the eruption, the board-splitting slam at Tier IV). */
  private radial(x: number, y: number, n: number, r0: number, len: [number, number], width: number, magma: number, durMs: number, avoid?: number, linger = 0): void {
    const S = this.scale;
    const off = this.rnd() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      let ang = off + (i / n) * Math.PI * 2 + (this.rnd() - 0.5) * (Math.PI / n);
      if (avoid !== undefined) {
        // Keep clear of the main crack's heading (it has its own crack there).
        const dAng = Math.atan2(Math.sin(ang - avoid), Math.cos(ang - avoid));
        if (Math.abs(dAng) < 0.35) ang += Math.sign(dAng || 1) * 0.45;
      }
      const l = len[0] + (len[1] - len[0]) * this.rnd();
      const a = { x: x + Math.cos(ang) * r0, y: y + Math.sin(ang) * r0 };
      const b = { x: a.x + Math.cos(ang) * l, y: a.y + Math.sin(ang) * l };
      const pts = crackPath(a, b, Math.max(14 * S, l / 6), 0.5, this.rnd, l * 0.1);
      this.buildCrack(pts, width, magma, { kind: 'timed', t0: this.age + i * 12, dur: durMs * (0.8 + 0.4 * this.rnd()) }, (u) => 1 - 0.75 * u, 40, 0, linger);
    }
  }

  private pointOn(c: Crack, d: number): Pt {
    const dd = Math.max(0, Math.min(c.L, d));
    for (const s of c.segs) {
      if (dd <= s.d0 + s.len) { const u = (dd - s.d0) / Math.max(1e-6, s.len); return { x: s.x + Math.cos(s.ang) * s.len * u, y: s.y + Math.sin(s.ang) * s.len * u }; }
    }
    const last = c.segs[c.segs.length - 1]!;
    return { x: last.x + Math.cos(last.ang) * last.len, y: last.y + Math.sin(last.ang) * last.len };
  }

  /** The point `frac` (0..1) of the way along the main crack (null before the quake). */
  pointAlong(frac: number): Pt | null { return this.main ? this.pointOn(this.main, this.main.L * frac) : null; }

  // ─── rocks, dust, light ────────────────────────────────────────────────────────────────────────────────────

  /** Throw a rock from ground point (x, y): outward at `v` px/s, up at `vz` px/s. `hot` 0..1 glows like magma. */
  private rock(x: number, y: number, ang: number, v: number, vz: number, size: number, hot: number, life = 1100): void {
    const S = this.scale;
    const tx = this.tex.rocks[Math.floor(this.rnd() * this.tex.rocks.length)] ?? this.tex.rocks[0]!;
    const sh = this.take('shadows', this.tex.glow, this.colors.chasm);
    const s = this.take('rocks', tx, hot > 0 ? mixColor(this.colors.rock, this.hot, hot) : this.colors.rock);
    if (!s || !sh) { if (s) this.give(s, 'rocks'); if (sh) this.give(sh, 'shadows'); return; }
    const glow = hot > 0.3 ? this.take('air', this.tex.glow, this.colors.side) : null;
    s.position.set(x, y); sh.position.set(x, y); sh.alpha = 0;
    this.rocks.push({
      s, sh, glow, gx: x, gy: y, vx: Math.cos(ang) * v * S, vy: Math.sin(ang) * v * S * 0.7, z: 0, vz: vz * S,
      rot: this.rnd() * Math.PI * 2, vr: (this.rnd() - 0.5) * 14, life, max: life, bounced: false, hot, size: size * S, hold: -1, seed: this.rnd() * 100,
    });
  }

  /** A soft dust puff rolling out and rising. */
  private puff(x: number, y: number, size: number, vx: number, vy: number, dur: number, delay = 0, a0 = 0.6): void {
    const S = this.scale;
    this.addFx('dust', this.tex.dust, this.colors.dust, x, y, {
      dur, from: 0.45 * size * S, to: 1.35 * size * S, a0, alpha: 'puff', vx: vx * S, vy: vy * S, drag: 0.25, rise: -26 * S, spin: 0.4, delay,
    });
  }

  /** The wind-up: a ring closing in on the hero, a faint pool of light under them, pebbles lifting off the ground. */
  windup(x: number, y: number, r: number, durMs: number, tier: number, pebbles: number): void {
    const S = this.scale;
    if (!this.windupFx) {
      const ring = this.take('air', this.tex.ring, this.colors.side);
      const pool = this.take('glow', this.tex.glow, this.colors.side);
      if (ring && pool) { ring.position.set(x, y); pool.position.set(x, y); ring.alpha = 0; pool.alpha = 0; this.windupFx = { ring, pool, x, y, age: 0, dur: Math.max(1, durMs), size: (r / 64) * (1 + 0.15 * tier) }; }
      else { if (ring) this.give(ring, 'air'); if (pool) this.give(pool, 'glow'); }
    }
    for (let i = 0; i < pebbles; i++) {
      const a = (i / Math.max(1, pebbles)) * Math.PI * 2 + this.rnd() * 0.6;
      const rr = r * (1.05 + this.rnd() * 0.6);
      this.rock(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8, a, 0, 0, 0.35 + this.rnd() * 0.25 + 0.05 * tier, 0, 99999);
      const rk = this.rocks[this.rocks.length - 1];
      if (rk) rk.hold = (14 + this.rnd() * 22 + 4 * tier) * S;
    }
  }

  /** THE SLAM: the hero hits the ground. Dust shockwave, a starburst of cracks, held pebbles slammed down, a flash. */
  slam(x: number, y: number, r: number, o: {
    tier: number; k: number; width: number; magma: number; rocks: number; dust: number; boardCracks: number; reach: number; heading: number;
  }): void {
    const S = this.scale;
    const w = this.windupFx;
    if (w) { this.give(w.ring, 'air'); this.give(w.pool, 'glow'); this.windupFx = null; }
    // The held pebbles are driven into the ground.
    for (const rk of this.rocks) if (rk.hold >= 0) { rk.hold = -1; rk.vz = -900 * S; rk.life = 700 + this.rnd() * 300; rk.max = rk.life; }
    const size = r / 64;
    this.addFx('air', this.tex.glow, this.colors.core, x, y, { dur: 150, from: 1.2 * size, to: 2 * size, a0: 0.85 });
    this.addFx('air', this.tex.glow, this.colors.side, x, y, { dur: 380, from: 1.6 * size, to: (2.8 + o.k) * size, a0: 0.55, alpha: 'punch', peakAt: 0.1 });
    // The dust shockwave: a thick ring rolling out, then a lighter one behind it.
    const ringTo = (r * (2.6 + 1.6 * o.k) * Math.max(0.5, o.dust)) / 96;
    this.addFx('dust', this.tex.dustRing, this.colors.dust, x, y, { dur: 560, from: (r * 0.9) / 96, to: ringTo, a0: 0.75 });
    this.addFx('dust', this.tex.dustRing, whiten(this.colors.dust, 0.35), x, y, { dur: 420, from: (r * 0.7) / 96, to: ringTo * 0.7, a0: 0.45, delay: 40 });
    if (o.tier >= 2) this.addFx('air', this.tex.ring, this.colors.side, x, y, { dur: 300, from: 0.5 * size, to: (1.8 + 0.8 * o.k) * size, a0: 0.8 });
    // A starburst of short cracks around the hero.
    this.radial(x, y, [2, 3, 5, 6][o.tier - 1] ?? 3, r * 0.9, [r * 0.45, r * (0.9 + 0.5 * o.k)], Math.max(3, o.width * 0.7), o.magma, 130, o.heading);
    // Tier IV: the slam cracks the WHOLE BOARD.
    if (o.boardCracks > 0) this.radial(x, y, o.boardCracks, r * 1.1, [o.reach * 0.3, o.reach * 0.62], o.width * 0.6, o.magma * 0.8, 380, o.heading);
    // Dust puffs around the rim, staggered so they roll out as one wave.
    const puffs = Math.round((4 + 6 * o.k) * Math.max(0.3, o.dust));
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2 + this.rnd() * 0.4;
      const rr = r * (0.9 + this.rnd() * 0.3);
      this.puff(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.85, (r / 40) * (0.8 + 0.5 * o.dust) * (0.8 + 0.4 * this.rnd()), Math.cos(a) * 140, Math.sin(a) * 110, 650 + 300 * o.k, i * 8, 0.55);
    }
    for (let i = 0; i < o.rocks; i++) {
      const a = this.rnd() * Math.PI * 2;
      this.rock(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.7, a, 120 + this.rnd() * 220, 380 + this.rnd() * 420, 0.45 + this.rnd() * 0.35, o.magma > 0.5 && this.rnd() < 0.3 ? 0.8 : 0);
    }
  }

  /** A secondary eruption along the crack (Tier III+): a magma flash, a spurt, a ring, dust and a few hot rocks. */
  burst(frac: number, size: number, magma: number): Pt | null {
    const p = this.pointAlong(frac);
    if (!p) return null;
    const S = this.scale;
    const { x, y } = p;
    this.addFx('air', this.tex.glow, this.colors.core, x, y, { dur: 130, from: 0.7 * size, to: 1.3 * size, a0: 0.9 });
    this.addFx('air', this.tex.glow, this.colors.side, x, y, { dur: 420, from: 1 * size, to: 2.4 * size, a0: 0.6, alpha: 'punch', peakAt: 0.12 });
    this.addFx('air', this.tex.beam, this.hot, x, y, { dur: 260, from: 0.2 * size, to: 1.6 * size, a0: 0.8, sy: 0.35 });
    const beam = this.fx[this.fx.length - 1];
    if (beam) { beam.s.anchor.set(0, 0.5); beam.s.rotation = -Math.PI / 2; }
    this.addFx('dust', this.tex.dustRing, this.colors.dust, x, y, { dur: 420, from: 0.25 * size, to: 1.3 * size, a0: 0.6 });
    for (let i = 0; i < 3; i++) this.puff(x + (this.rnd() - 0.5) * 30 * S, y + (this.rnd() - 0.5) * 20 * S, 1.1 * size, (this.rnd() - 0.5) * 120, -40 - this.rnd() * 60, 700, i * 30, 0.5);
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.4;
      this.rock(x, y, a, 60 + this.rnd() * 160, 420 + this.rnd() * 380, 0.4 + this.rnd() * 0.3, magma > 0.4 ? 0.9 : 0);
    }
    return p;
  }

  /**
   * THE ERUPTION under the struck hero. Every light element starts AT its peak, so the hit-stop freezes the brightest
   * frame. `r` is the struck portrait's radius (the flash covers it; the cracks and the crater ring it, never covering
   * the face).
   */
  erupt(x: number, y: number, r: number, o: {
    tier: number; k: number; flashAlpha: number; width: number; magma: number; rocks: number; dust: number; eruption: number;
    crater: number; craterMs: number; heading: number; rockSize: number;
  }): void {
    const S = this.scale;
    const E = o.eruption;
    const portrait = (r * 2) / 128; // the glow texture is 128 px across
    const c = this.colors;
    // Short and bright, then gone by the time the damage number has popped.
    this.addFx('air', this.tex.glow, c.core, x, y, { dur: 130, from: portrait * 1.05, to: portrait * 1.35, a0: 0.8 * o.flashAlpha });
    this.addFx('air', this.tex.glow, c.side, x, y, { dur: 520, from: portrait * 1.3 * E, to: portrait * (2.4 + 0.8 * o.k) * E, a0: 0.55 * o.flashAlpha });
    // The spurt: a column of light punching UP out of the ground (the Tier IV pillar is its own, bigger thing).
    if (o.tier >= 2) {
      this.addFx('air', this.tex.beam, this.hot, x, y + r * 0.2, { dur: 240 + 80 * o.k, from: (r * 0.6) / 64, to: (r * (1.6 + 1.2 * o.k) * E) / 64, a0: 0.85, sy: 0.5 + 0.3 * o.k });
      const sp = this.fx[this.fx.length - 1];
      if (sp) { sp.s.anchor.set(0, 0.5); sp.s.rotation = -Math.PI / 2; }
    }
    // Rings: the dust shockwave on the ground and (II+) a hot ring of light.
    this.addFx('dust', this.tex.dustRing, c.dust, x, y, { dur: 600 + 200 * o.k, from: (r * 0.9) / 96, to: (r * (2.5 + 1.4 * o.k) * E) / 96, a0: 0.8 });
    if (o.tier >= 2) this.addFx('air', this.tex.ring, c.side, x, y, { dur: 380, from: (r * 0.7) / 64, to: (r * (2.2 + 1.2 * o.k) * E) / 64, a0: 0.9 });
    // The cracks burst open around the portrait, magma glowing from them.
    this.radial(x, y, [2, 4, 7, 10][o.tier - 1] ?? 4, r * 0.92, [r * 0.5 * E, r * (0.9 + 0.8 * o.k) * E], Math.max(4, o.width * 0.8), Math.max(o.magma, o.tier >= 2 ? 0.35 : 0.15), 150, o.heading + Math.PI, 700 * o.crater);
    // Rock chunks thrown up and out under gravity (a shadow each, one bounce).
    for (let i = 0; i < o.rocks; i++) {
      const a = this.rnd() * Math.PI * 2;
      const rr = r * this.rnd() * 0.7;
      const up = (520 + this.rnd() * 620) * (0.8 + 0.35 * E);
      this.rock(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8, a, 90 + this.rnd() * 300 * E, up, (0.5 + this.rnd() * 0.6) * (0.85 + 0.35 * o.k) * o.rockSize,
        o.magma > 0.3 && this.rnd() < 0.45 * o.magma ? 1 : 0, 1100 + this.rnd() * 500);
    }
    // The dust cloud: big, soft, rolling out from the rim and rising, staggered.
    const puffs = Math.round((5 + 9 * o.k) * Math.max(0.3, o.dust));
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2 + this.rnd() * 0.5;
      const rr = r * (0.8 + this.rnd() * 0.5);
      const sz = (r / 38) * (0.85 + 0.5 * o.dust) * (0.8 + 0.4 * this.rnd());
      this.puff(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.85, sz, Math.cos(a) * (120 + 80 * o.k), Math.sin(a) * 90 - 30, 900 + 500 * o.k, 20 + i * 10, 0.6);
    }
    // Embers rising off the eruption (III+).
    const embers = o.tier >= 4 ? 22 : o.tier >= 3 ? 12 : 0;
    for (let i = 0; i < embers; i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2;
      const sp = (160 + this.rnd() * 340) * S;
      const b = this.rnd() * Math.PI * 2, rr = this.rnd() * r * 0.8;
      this.particle('air', this.tex.spark, this.rnd() < 0.4 ? c.core : this.hot, {
        x: x + Math.cos(b) * rr, y: y + Math.sin(b) * rr, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.35, grav: -40 * S,
        life: 900 + this.rnd() * 800, from: (0.7 + this.rnd() * 0.6) * S, to: 0.1 * S, alpha: 0.95,
      });
    }
    // The crater (III+): a scorched ring around the portrait and a magma glow ring that lingers, then cools.
    if (o.crater > 0) {
      const sc = (r * (2.4 + 0.6 * o.k)) / 192;
      this.addFx('scorch', this.tex.scorch, c.chasm, x, y, { dur: o.craterMs, from: sc * 0.8, to: sc, a0: 0.7 * o.crater, alpha: 'hold' });
      this.addFx('glow', this.tex.ring, c.side, x, y, { dur: o.craterMs * 0.9, from: (r * 1.1) / 64, to: (r * 1.3) / 64, a0: 0.75 * o.crater, alpha: 'hold' });
      this.addFx('glow', this.tex.glow, c.side, x, y, { dur: o.craterMs * 0.7, from: portrait * 1.5, to: portrait * 1.9, a0: 0.3 * o.crater, alpha: 'hold' });
    }
    // The seams start cooling now (the crater's own cracks linger longer).
    this.coolAt = this.age;
  }

  /** TIER IV: a pillar of magma and rock erupting under the target, holding, then collapsing. */
  pillar(x: number, y: number, r: number, holdMs: number, eruption: number, rocks: number): void {
    const outer = this.take('air', this.tex.beam, this.colors.side);
    const core = this.take('air', this.tex.beam, this.colors.core);
    const cap = this.take('air', this.tex.glow, this.hot);
    if (!outer || !core || !cap) { for (const s of [outer, core, cap]) if (s) this.give(s, 'air'); return; }
    for (const s of [outer, core]) { s.anchor.set(0, 0.5); s.rotation = -Math.PI / 2; s.position.set(x, y + r * 0.35); s.scale.set(0, 0); }
    cap.alpha = 0;
    this.pillars.push({ outer, core, cap, x, y: y + r * 0.35, age: 0, rise: 150, hold: holdMs, width: r * 1.35 * eruption, height: r * 4.2 * eruption });
    // Rocks shot HIGH out of the pillar.
    for (let i = 0; i < rocks; i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 1.6;
      this.rock(x + (this.rnd() - 0.5) * r * 0.6, y, a, 40 + this.rnd() * 160, 1100 + this.rnd() * 700, (0.6 + this.rnd() * 0.6) * 1.1, this.rnd() < 0.6 ? 1 : 0.4, 1500 + this.rnd() * 400);
    }
    this.addFx('air', this.tex.glow, this.colors.side, x, y, { dur: holdMs + 400, from: (r * 3) / 128, to: (r * 4) / 128, a0: 0.55, alpha: 'hold' });
  }

  /** A follow-up explosion around the target (Tier III+). */
  boom(x: number, y: number, size: number, magma: number): void {
    this.addFx('air', this.tex.glow, this.colors.core, x, y, { dur: 180, from: 0.7 * size, to: 1.6 * size, a0: 0.9 });
    this.addFx('air', this.tex.glow, this.colors.side, x, y, { dur: 440, from: 1 * size, to: 2.6 * size, a0: 0.65, alpha: 'punch', peakAt: 0.1 });
    this.addFx('air', this.tex.ring, this.hot, x, y, { dur: 340, from: 0.3, to: 1.8 * size, a0: 0.85 });
    for (let i = 0; i < 2; i++) this.puff(x, y, 1.2 * size, (this.rnd() - 0.5) * 160, -60, 700, i * 40, 0.5);
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.6;
      this.rock(x, y, a, 80 + this.rnd() * 180, 450 + this.rnd() * 350, 0.4 + this.rnd() * 0.3, magma > 0.4 ? 0.9 : 0);
    }
  }

  /** The cracks fade out over `ms` (the settle). */
  fade(ms: number): void { this.fadeAt = Math.min(this.fadeAt, this.age); this.fadeMs = Math.max(1, ms); }
  /** How fast thrown rocks fall (px/s^2 at stage scale 1). */
  setGravity(g: number): void { this.gravity = Math.max(100, g); }
  /** How long the seams take to cool once the eruption has gone off. */
  setCoolMs(ms: number): void { this.coolMs = Math.max(1, ms); }

  // ─── the frame ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Advance by `dtMs` (sequence ms; the runner applies the speed and holds 0 through a hit-stop). */
  update(dtMs: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(100, dtMs));
    const sec = dt / 1000;
    const S = this.scale;
    this.age += dt;
    const age = this.age;

    const w = this.windupFx;
    if (w) {
      w.age += dt;
      const u = clamp01(w.age / w.dur);
      w.ring.scale.set((2.6 - 1.7 * easeOutCubic(u)) * w.size);
      w.ring.alpha = 0.7 * Math.min(1, u * 3);
      w.pool.scale.set((1.4 + 0.6 * u) * w.size);
      w.pool.alpha = 0.35 * u;
    }

    const fade = age < this.fadeAt ? 1 : 1 - clamp01((age - this.fadeAt) / this.fadeMs);
    const flick = 0.9 + 0.1 * Math.sin(age * 0.05);
    for (let i = this.cracks.length - 1; i >= 0; i--) {
      const c = this.cracks[i]!;
      const dr = c.drive;
      if (dr.kind === 'main') c.f = c.L * quakeEase((age - dr.t0) / dr.dur);
      else if (dr.kind === 'timed') c.f = c.L * easeOutCubic((age - dr.t0) / dr.dur);
      else c.f = Math.max(0, Math.min(c.L, (dr.parent.f - dr.rootD) * dr.ratio));
      const done = c.f >= c.L - 0.01;
      if (done && c.doneAt < 0) c.doneAt = age;
      // Past the end, the crack keeps opening with time (so the target end, reached last, opens widest too).
      const extra = done ? (age - c.doneAt) * 1.1 * S : 0;
      const coolFor = this.coolMs + c.linger;
      const cool = age < this.coolAt ? 1 : 1 - clamp01((age - this.coolAt) / coolFor);
      for (const s of c.segs) {
        const prog = clamp01((c.f - s.d0) / s.len);
        if (prog <= 0) { s.lip.visible = false; s.chasm.visible = false; if (s.seam) s.seam.visible = false; if (s.glow) s.glow.visible = false; continue; }
        const behind = c.f - (s.d0 + s.len * 0.5) + extra;
        const open = 0.3 + 0.7 * easeOutCubic(c.openPx > 0 ? behind / c.openPx : 1);
        const wpx = Math.max(1.2 * S, s.w * open);
        const tip = clamp01(1 - behind / (150 * S));
        const heat = Math.max(0.7, tip) * cool;
        const sx = (s.len * prog + wpx * 0.5) / 64;
        s.lip.visible = true; s.chasm.visible = true;
        s.lip.scale.set(sx, (wpx * 1.7 + 2.5 * S) / 16); s.lip.alpha = 0.5 * fade;
        s.chasm.scale.set(sx, wpx / 16); s.chasm.alpha = 0.95 * fade;
        if (s.seam) {
          s.seam.visible = true;
          s.seam.scale.set(sx, (wpx * (0.32 + 0.18 * c.magma)) / 16);
          s.seam.alpha = (0.14 + 0.86 * c.magma) * heat * flick * fade;
        }
        if (s.glow) {
          s.glow.visible = true;
          s.glow.scale.set(sx, (wpx * 3.4 + 10 * S) / 32);
          s.glow.alpha = 0.5 * c.magma * heat * flick * fade;
        }
      }
      // The main crack kicks dust and grit up at its front as it runs.
      if (c.kick > 0 && c.f > 0 && !done && c.f - c.lastKick > 64 * S) {
        c.lastKick = c.f;
        const p = this.pointOn(c, c.f);
        this.puff(p.x, p.y, 0.9 + 0.5 * c.kick, (this.rnd() - 0.5) * 80, -30 - this.rnd() * 40, 520 + 200 * c.kick, 0, 0.5);
        if (c.kick >= 1) {
          const a = this.rnd() * Math.PI * 2;
          this.rock(p.x, p.y, a, 40 + this.rnd() * 90, 240 + this.rnd() * 260, 0.28 + 0.12 * this.rnd(), c.magma > 0.5 && this.rnd() < 0.4 ? 0.9 : 0, 600);
        }
      }
      if (fade <= 0) {
        for (const s of c.segs) { this.give(s.lip, 'lips'); this.give(s.chasm, 'chasms'); if (s.seam) this.give(s.seam, 'seams'); if (s.glow) this.give(s.glow, 'glow'); }
        if (this.main === c) this.main = null;
        this.cracks.splice(i, 1);
      }
    }

    const g = this.gravity * S;
    for (let i = this.rocks.length - 1; i >= 0; i--) {
      const r = this.rocks[i]!;
      if (r.hold >= 0) {
        // Held in the air through the wind-up: rising to its height and trembling.
        r.z += (r.hold - r.z) * Math.min(1, sec * 6);
        const j = 1.5 * S * Math.sin(age * 0.06 + r.seed);
        r.s.position.set(r.gx + j * 0.4, r.gy - r.z + j);
        r.s.rotation = r.rot + 0.15 * Math.sin(age * 0.01 + r.seed);
        r.s.scale.set(r.size * ROCK_PX);
        const hl = Math.min(0.5, r.z / (200 * S));
        r.sh.position.set(r.gx, r.gy + r.size * 8); r.sh.scale.set(r.size * 0.32 * (1 - hl), r.size * 0.13 * (1 - hl)); r.sh.alpha = 0.35;
        continue;
      }
      r.life -= dt;
      if (r.life <= 0) { this.give(r.s, 'rocks'); this.give(r.sh, 'shadows'); if (r.glow) this.give(r.glow, 'air'); this.rocks.splice(i, 1); continue; }
      const damp = Math.pow(0.3, sec);
      r.vx *= damp; r.vy *= damp;
      r.gx += r.vx * sec; r.gy += r.vy * sec;
      r.vz -= g * sec;
      r.z += r.vz * sec;
      if (r.z <= 0) {
        r.z = 0;
        if (!r.bounced && r.vz < -160 * S) { r.vz = -r.vz * 0.3; r.vx *= 0.5; r.vy *= 0.5; r.vr *= 0.5; r.bounced = true; }
        else { r.vz = 0; r.vx *= 0.6; r.vy *= 0.6; r.vr *= 0.7; }
      }
      if (r.z > 0) r.rot += r.vr * sec;
      const u = 1 - r.life / r.max;
      const out = clamp01((u - 0.72) / 0.28);
      const sz = r.size * ROCK_PX;
      r.s.position.set(r.gx, r.gy - r.z);
      r.s.rotation = r.rot;
      r.s.scale.set(sz);
      r.s.alpha = 1 - out;
      if (r.hot > 0) r.s.tint = mixColor(mixColor(this.colors.rock, this.hot, r.hot), this.colors.rock, clamp01((r.max - r.life) / 900));
      r.sh.position.set(r.gx, r.gy + r.size * 8);
      const lift = Math.min(0.6, r.z / (260 * S));
      r.sh.scale.set(r.size * 0.34 * (1 - lift), r.size * 0.14 * (1 - lift));
      r.sh.alpha = 0.4 * (1 - lift) * (1 - out);
      if (r.glow) {
        r.glow.position.set(r.gx, r.gy - r.z);
        r.glow.scale.set(r.size * 0.55);
        r.glow.alpha = 0.55 * r.hot * (1 - clamp01((r.max - r.life) / 800)) * (1 - out);
      }
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= dt; q.s.alpha = 0; if (q.delay > 0) continue; }
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      const e = q.alpha === 'puff' ? easeOutCubic(u) : easeOutQuint(u);
      const sc = q.from + (q.to - q.from) * e;
      q.s.scale.set(sc, sc * q.sy);
      if (q.vx || q.vy || q.rise) {
        const damp = Math.pow(q.drag, sec);
        q.vx *= damp; q.vy = q.vy * damp + q.rise * sec;
        q.s.position.set(q.s.position.x + q.vx * sec, q.s.position.y + q.vy * sec);
      }
      q.s.alpha = q.alpha === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.alpha === 'puff'
          ? q.a0 * Math.min(1, u / 0.08) * (1 - Math.pow(clamp01((u - 0.08) / 0.92), 1.4))
          : q.alpha === 'hold'
            ? q.a0 * (u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45) * (0.9 + 0.1 * Math.sin(q.age * 0.012))
            : q.a0 * (1 - u) * (1 - u * 0.3);
      if (u >= 1) { this.giveAny(q.s); this.fx.splice(i, 1); }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) { this.giveAny(p.s); this.particles.splice(i, 1); continue; }
      const damp = Math.pow(p.drag, sec);
      p.vx *= damp; p.vy = p.vy * damp + p.grav * sec;
      p.x += p.vx * sec; p.y += p.vy * sec;
      const t = 1 - p.life / p.max;
      p.s.position.set(p.x, p.y);
      p.s.scale.set(p.from + (p.to - p.from) * t);
      p.s.alpha = p.alpha * (1 - t * t);
    }

    for (let i = this.pillars.length - 1; i >= 0; i--) {
      const pl = this.pillars[i]!;
      pl.age += dt;
      const up = easeOutQuint(pl.age / pl.rise);
      const after = pl.age - pl.rise - pl.hold;
      const out = clamp01(after / 320);
      const fl = 1 + 0.07 * Math.sin(pl.age * 0.09) + 0.04 * Math.sin(pl.age * 0.23);
      const h = pl.height * up * (1 - 0.35 * out);
      const wd = pl.width * (pl.age < pl.rise ? 0.6 + 0.4 * up : fl) * (1 - 0.8 * out);
      pl.outer.scale.set(h / 64, (wd * 1.6) / 64); pl.outer.alpha = 0.9 * (1 - out);
      pl.core.scale.set((h * 0.92) / 64, (wd * 0.55) / 64); pl.core.alpha = 1 - out;
      pl.cap.position.set(pl.x, pl.y - h * 0.9); pl.cap.scale.set((wd * 2.2) / 128); pl.cap.alpha = 0.8 * up * (1 - out);
      if (out >= 1) { this.give(pl.outer, 'air'); this.give(pl.core, 'air'); this.give(pl.cap, 'air'); this.pillars.splice(i, 1); }
    }

    return this.used > 0;
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const c of this.cracks) for (const s of c.segs) { this.give(s.lip, 'lips'); this.give(s.chasm, 'chasms'); if (s.seam) this.give(s.seam, 'seams'); if (s.glow) this.give(s.glow, 'glow'); }
    for (const r of this.rocks) { this.give(r.s, 'rocks'); this.give(r.sh, 'shadows'); if (r.glow) this.give(r.glow, 'air'); }
    for (const q of this.fx) this.giveAny(q.s);
    for (const p of this.particles) this.giveAny(p.s);
    for (const pl of this.pillars) { this.give(pl.outer, 'air'); this.give(pl.core, 'air'); this.give(pl.cap, 'air'); }
    if (this.windupFx) { this.give(this.windupFx.ring, 'air'); this.give(this.windupFx.pool, 'glow'); }
    this.cracks = []; this.rocks = []; this.fx = []; this.particles = []; this.pillars = []; this.windupFx = null; this.main = null;
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const [id] of LAYERS) this.free[id].length = 0;
    this.root.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.root.destroy();
  }
}
