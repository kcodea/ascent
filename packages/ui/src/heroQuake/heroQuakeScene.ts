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
 * CRACKS are triangle-strip meshes (one per layer: lip, chasm, magma glow, magma seam) along a jagged, angular
 * polyline with mitred joints, REVEALED by a front: every point behind it sits on the path, every point ahead is
 * collapsed onto it, so a crack is one continuous stroke with a sharp tip at any frame rate. It OPENS behind the tip
 * (its width grows over `openPx`), the tip glows hottest, the seams cool after the impact, and everything fades on
 * `fade()`. The vertex arrays are rewritten in place (no allocation per frame); each mesh stays under 100 vertices so
 * Pixi batches it. Paths come from a seeded generator, so the same fight draws the same cracks (a replay looks identical).
 *
 * Contract: sprites POOLED per layer (hidden and reused), bounded by `MAX_QUAKE_SPRITES`; crack meshes bounded by
 * `MAX_QUAKE_MESHES`, built per quake and destroyed as they fade; textures are the
 * caller's; the positions are the overlay's px; `setCamera` mirrors the DOM camera; `update` returns whether anything
 * still draws; `destroy()` leaves nothing behind.
 */
import { Container, MeshSimple, Sprite, type Texture } from 'pixi.js';
import type { HeroBlastTextures } from '../heroBlast/heroBlastScene';
import { clamp01, easeOutCubic, easeOutQuint, mixColor, whiten, type Pt } from '../heroAttack/easing';
import { quakeEase } from './heroQuakeConfig';

export interface HeroQuakeTextures extends HeroBlastTextures {
  /** A crisp bar (feathered 1-2 px across its width): the chasm and its lip. */
  crack: Texture;
  /** A soft bar (feathered across its width): the magma seam and its glow. */
  seamGlow: Texture;
  rocks: Texture[]; dust: Texture; dustRing: Texture; scorch: Texture;
  /** The hurled boulder (tiers I-III) and the rock shard variants (every eruption's spikes). */
  boulder: Texture; shards: Texture[];
}

export interface QuakeColors { core: number; side: number; chasm: number; lip: number; dust: number; rock: number }

/** Hard cap on sprites alive at once (a Tier IV quake peaks around 1100). */
export const MAX_QUAKE_SPRITES = 1600;
/** Hard cap on crack meshes (four per crack). */
export const MAX_QUAKE_MESHES = 320;

type LayerId = 'scorch' | 'lips' | 'chasms' | 'glow' | 'seams' | 'shadows' | 'dust' | 'rocks' | 'air';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [
  ['scorch', 'normal'], ['lips', 'normal'], ['chasms', 'normal'], ['glow', 'add'], ['seams', 'add'],
  ['shadows', 'normal'], ['dust', 'normal'], ['rocks', 'normal'], ['air', 'add'],
];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
/** A rock's drawn size per unit of `size` (the rock texture is 48 px across). */
const ROCK_PX = 50 / 48;
/** A size-1 boulder's drawn diameter (px at stage scale 1). */
const BOULDER_PX = 96;
/** Points per crack are capped so each mesh stays small enough for Pixi to batch (<= 100 vertices). */
const MAX_CRACK_POINTS = 50;

/** One crack layer: a triangle strip along the path, two vertices per point, rewritten in place each frame. */
interface Strip { mesh: MeshSimple; v: Float32Array; half: (w: number) => number }

type Drive =
  | { kind: 'main'; t0: number; dur: number }
  | { kind: 'child'; parent: Crack; rootD: number; ratio: number }
  | { kind: 'timed'; t0: number; dur: number };

interface Crack {
  pts: Pt[];
  /** Distance along the path at each point, and each point's base width (px, stage scale folded in). */
  cum: number[]; w: number[];
  /** Per-point miter normal (unit, scaled by the miter length, clamped). */
  nx: number[]; ny: number[];
  L: number; f: number; drive: Drive; magma: number; openPx: number;
  lip: Strip; chasm: Strip; seam: Strip; glow: Strip | null;
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

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number; from: number; to: number; alpha: number;
  /** Drawn as a streak along its velocity (the magma spray), not a dot. */
  streak?: boolean;
}

/** A hurled boulder (tiers I-III): flies a lob that rises toward screen-up and comes DOWN onto the target. */
interface Boulder {
  s: Sprite; sh: Sprite; glow: Sprite | null; from: Pt; to: Pt; ctrl: Pt; age: number; dur: number; size: number; rot: number; vr: number;
  hot: number; lastX: number; lastY: number; trail: number;
}

/** A stone spike bursting out of the ground: grows fast with an overshoot, holds, then sinks back. */
interface Spike {
  s: Sprite; scorch: Sprite | null; age: number; delay: number; w: number; h: number; hold: number; sink: number;
  /** Its resting lean, a wobble phase (the settle), the x-flip, and whether it has crumbled yet. */
  rot: number; wob: number; flip: number; crumbled: boolean; x: number; y: number;
}

/**
 * THE GEYSER (Tier IV; replaced the solid pillar column, owner 2026-09-28: "i dont like the cylinder/cones"): not a
 * shape but an EMITTER. While it runs it throws molten streaks up in a tight fan, billows dust, and spits tumbling rock,
 * over a flickering hot core at the ground. Irregular by construction.
 */
interface Geyser { core: Sprite; x: number; y: number; r: number; age: number; dur: number; power: number; magmaAcc: number; dustAcc: number; rockAcc: number }


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
  const n = Math.min(MAX_CRACK_POINTS - 1, Math.max(2, Math.round(L / Math.max(4, segPx))));
  const step = L / n;
  const pts: Pt[] = [{ x: a.x, y: a.y }];
  let off = 0, kink = rnd() < 0.5 ? 1 : -1;
  for (let i = 1; i < n; i++) {
    // A drifting walk plus a sharp alternating kink: rock splits in angular zigzags, not smooth curves.
    off += (rnd() - 0.5) * 2 * jag * step * 0.5;
    off = Math.max(-maxDevPx, Math.min(maxDevPx, off));
    if (rnd() < 0.7) kink = -kink;
    const k = kink * jag * step * (0.12 + 0.28 * rnd());
    const env = Math.sin((Math.PI * i) / n);
    const along = step * i + (rnd() - 0.5) * step * 0.3;
    const o = Math.max(-maxDevPx * 1.2, Math.min(maxDevPx * 1.2, (off + k) * env));
    pts.push({ x: a.x + ux * along - uy * o, y: a.y + uy * along + ux * o });
  }
  pts.push({ x: b.x, y: b.y });
  return pts;
}

export class HeroQuakeScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly free: Record<LayerId, Sprite[]>;
  private used = 0;
  private meshes = 0;
  private age = 0;
  private cracks: Crack[] = [];
  private rocks: Rock[] = [];
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private boulders: Boulder[] = [];
  private spikeList: Spike[] = [];
  private geysers: Geyser[] = [];
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
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) for (const ch of this.layers[id].children) if (ch instanceof Sprite) n++; return n; }
  get liveMeshes(): number { return this.meshes; }
  get liveCracks(): number { return this.cracks.length; }
  get liveRocks(): number { return this.rocks.length; }
  get liveBoulders(): number { return this.boulders.length; }
  get liveSpikes(): number { return this.spikeList.length; }
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

  /** A strip mesh for one crack layer (`n` points). */
  private strip(layer: LayerId, n: number, tex: Texture, tint: number, half: (w: number) => number): Strip {
    const v = new Float32Array(n * 4);
    const uvs = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { uvs[i * 4] = 0.5; uvs[i * 4 + 1] = 0; uvs[i * 4 + 2] = 0.5; uvs[i * 4 + 3] = 1; }
    const idx = new Uint32Array(Math.max(0, n - 1) * 6);
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    const mesh = new MeshSimple({ texture: tex, vertices: v, uvs, indices: idx });
    mesh.tint = tint;
    mesh.blendMode = BLEND[layer];
    mesh.alpha = 0;
    this.layers[layer].addChild(mesh);
    this.meshes++;
    return { mesh, v: mesh.vertices as Float32Array, half };
  }

  private dropStrip(st: Strip | null): void {
    if (!st) return;
    st.mesh.parent?.removeChild(st.mesh);
    st.mesh.destroy();
    this.meshes--;
  }

  private dropCrack(c: Crack): void { this.dropStrip(c.lip); this.dropStrip(c.chasm); this.dropStrip(c.seam); this.dropStrip(c.glow); }

  private buildCrack(pts: Pt[], width: number, magma: number, drive: Drive, profile: (u: number) => number, openPx: number, kick = 0, linger = 0, withGlow = true): Crack | null {
    const S = this.scale;
    const n = pts.length;
    if (n < 2 || this.meshes + 4 > MAX_QUAKE_MESHES) return null;
    const cum: number[] = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
    const L = cum[n - 1]!;
    if (L < 1) return null;
    // Miter normals: the average of the two neighbouring segment normals, lengthened so the width holds at a kink.
    const nx: number[] = [], ny: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)]!, b = pts[i]!, c = pts[Math.min(n - 1, i + 1)]!;
      let t1x = b.x - a.x, t1y = b.y - a.y, t2x = c.x - b.x, t2y = c.y - b.y;
      const l1 = Math.hypot(t1x, t1y) || 1, l2 = Math.hypot(t2x, t2y) || 1;
      t1x /= l1; t1y /= l1; t2x /= l2; t2y /= l2;
      if (i === 0) { t1x = t2x; t1y = t2y; }
      if (i === n - 1) { t2x = t1x; t2y = t1y; }
      let mx = -(t1y + t2y), my = t1x + t2x;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml; my /= ml;
      const dot = mx * -t1y + my * t1x;
      const k = Math.min(2, 1 / Math.max(0.35, dot));
      nx.push(mx * k); ny.push(my * k);
    }
    const w = cum.map((d) => width * S * profile(d / L) * (0.75 + 0.5 * this.rnd()));
    const seamOn = magma > 0.01;
    const c: Crack = {
      pts, cum, w, nx, ny, L, f: 0, drive, magma, openPx: openPx * S, doneAt: -1, linger, kick, lastKick: 0,
      lip: this.strip('lips', n, this.tex.crack, this.colors.lip, (x) => x * 0.5 + 1.3 * S),
      chasm: this.strip('chasms', n, this.tex.crack, this.colors.chasm, (x) => x * 0.5),
      seam: this.strip('seams', n, this.tex.seamGlow, this.hot, (x) => x * (0.18 + 0.1 * magma) + 0.5 * S),
      glow: withGlow && seamOn ? this.strip('glow', n, this.tex.seamGlow, this.colors.side, (x) => x * 0.8 + 4 * S) : null,
    };
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
      const bp = crackPath(root, end, seg * 0.7, o.jag * 1.5, this.rnd, bl * 0.14);
      this.buildCrack(bp, o.width * 0.38, o.magma * 0.8, { kind: 'child', parent: main, rootD, ratio: 0.85 }, (u) => 1 - 0.7 * u, o.openPx * 0.6, 0, 0, false);
    }
    // FISSURES (Tier III+): long cracks peeling off the main one at a shallow angle, so the ground reads as a torn
    // NETWORK rather than one line (never parallel rails).
    for (let i = 0; i < o.fissures; i++) {
      const side = i % 2 ? 1 : -1;
      const rootD = main.L * (0.08 + 0.3 * ((i + this.rnd()) / Math.max(1, o.fissures)));
      const root = this.pointOn(main, rootD);
      const ang = Math.atan2(uy, ux) + side * (0.16 + this.rnd() * 0.16);
      const fl = main.L * (0.24 + 0.16 * this.rnd());
      const end = { x: root.x + Math.cos(ang) * fl, y: root.y + Math.sin(ang) * fl };
      const fp = crackPath(root, end, seg * 1.2, o.jag, this.rnd, fl * 0.07);
      this.buildCrack(fp, o.width * 0.42, o.magma * 0.75, { kind: 'child', parent: main, rootD, ratio: 0.95 }, (u) => 0.9 - 0.75 * u, o.openPx * 0.5, 0, 0, false);
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
      const pts = crackPath(a, b, Math.max(14 * S, l / 9), 0.6, this.rnd, l * 0.08);
      this.buildCrack(pts, width, magma, { kind: 'timed', t0: this.age + i * 12, dur: durMs * (0.8 + 0.4 * this.rnd()) }, (u) => 1 - 0.75 * u, 40, 0, linger);
    }
  }

  private pointOn(c: Crack, d: number): Pt {
    const dd = Math.max(0, Math.min(c.L, d));
    for (let i = 1; i < c.pts.length; i++) {
      if (dd <= c.cum[i]!) {
        const a = c.pts[i - 1]!, b = c.pts[i]!;
        const u = (dd - c.cum[i - 1]!) / Math.max(1e-6, c.cum[i]! - c.cum[i - 1]!);
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
      }
    }
    return { ...c.pts[c.pts.length - 1]! };
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
  private puff(x: number, y: number, size: number, vx: number, vy: number, dur: number, delay = 0, a0 = 0.6, light = 0): void {
    const S = this.scale;
    this.addFx('dust', this.tex.dust, light > 0 ? whiten(this.colors.dust, light) : this.colors.dust, x, y, {
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
    /** A true quake cracks the ground round the hero; a boulder throw only shakes it (no crack lines). */
    cracks?: boolean;
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
    const ringTo = (r * (2.1 + 1.1 * o.k) * Math.max(0.5, o.dust)) / 96;
    this.addFx('dust', this.tex.dustRing, this.colors.dust, x, y, { dur: 560, from: (r * 1.3) / 96, to: ringTo * 1.25, a0: 0.55 });
    this.addFx('dust', this.tex.dustRing, whiten(this.colors.dust, 0.25), x, y, { dur: 420, from: (r * 1.25) / 96, to: ringTo, a0: 0.3, delay: 40 });
    if (o.tier >= 2) this.addFx('air', this.tex.ring, this.colors.side, x, y, { dur: 300, from: 0.5 * size, to: (1.8 + 0.8 * o.k) * size, a0: 0.8 });
    // A starburst of short cracks around the hero.
    if (o.cracks !== false) this.radial(x, y, [2, 3, 5, 6][o.tier - 1] ?? 3, r * 0.9, [r * 0.45, r * (0.9 + 0.5 * o.k)], Math.max(3, o.width * 0.7), o.magma, 130, o.heading);
    // Tier IV: the slam cracks the WHOLE BOARD.
    if (o.boardCracks > 0) this.radial(x, y, o.boardCracks, r * 1.05, [o.reach * 0.2, o.reach * 0.42], o.width * 0.7, o.magma * 0.85, 360, o.heading);
    // Dust puffs around the rim, staggered so they roll out as one wave.
    const puffs = Math.round((4 + 6 * o.k) * Math.max(0.3, o.dust));
    for (let i = 0; i < puffs; i++) {
      const a = (i / puffs) * Math.PI * 2 + this.rnd() * 0.4;
      const rr = r * (0.9 + this.rnd() * 0.3);
      this.puff(x + Math.cos(a) * rr * 1.15, y + Math.sin(a) * rr, (r / 60) * (0.8 + 0.5 * o.dust) * (0.8 + 0.4 * this.rnd()), Math.cos(a) * 150, Math.sin(a) * 120, 650 + 300 * o.k, i * 8, 0.45);
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
    this.spray(x, y, 18 * S, 8, 0.6);
    this.addFx('dust', this.tex.dustRing, this.colors.dust, x, y, { dur: 420, from: 0.25 * size, to: 1.3 * size, a0: 0.6 });
    for (let i = 0; i < 3; i++) this.puff(x + (this.rnd() - 0.5) * 30 * S, y + (this.rnd() - 0.5) * 20 * S, 1.1 * size, (this.rnd() - 0.5) * 120, -40 - this.rnd() * 60, 700, i * 30, 0.5);
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.4;
      this.rock(x, y, a, 60 + this.rnd() * 160, 420 + this.rnd() * 380, 0.4 + this.rnd() * 0.3, magma > 0.4 ? 0.9 : 0);
    }
    return p;
  }

  /**
   * HURL A BOULDER (tiers I-III; owner 2026-09-28: "the line animation is over used"): it leaves the attacker's rim and
   * lands on the target's in exactly `durMs` (the plan's beat). The lob lifts toward the TOP of the screen (so it comes
   * down onto the target), each boulder of a volley bowed a little to its own side so they arrive from different angles,
   * with a ceiling so the apex stays in frame. A shadow slides along the ground under it, dust streams behind, and a
   * hot boulder (III) glows and sheds embers. `age0` = ms already elapsed.
   */
  boulder(a: Pt, d: Pt, rA: number, rD: number, o: { durMs: number; size: number; lift: number; side: number; hot: number; age0?: number }): void {
    const S = this.scale;
    const dx = d.x - a.x, dy = d.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const from = { x: a.x + ux * rA * 0.6, y: a.y + uy * rA * 0.6 };
    const to = { x: d.x - ux * rD * 0.15, y: d.y - uy * rD * 0.15 };
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const lift = o.lift * dist;
    const ceiling = 90 * S; // the apex (0.25 from + 0.5 ctrl + 0.25 to) never above this
    const cy = Math.max(Math.min(from.y, to.y) - lift, (ceiling - 0.25 * (from.y + to.y)) / 0.5);
    const ctrl = { x: mid.x - uy * o.side * dist * 0.12, y: cy + ux * o.side * dist * 0.05 };
    const tx = this.tex.boulder;
    const sh = this.take('shadows', this.tex.glow, this.colors.chasm);
    const s = this.take('rocks', tx, o.hot > 0 ? mixColor(whiten(this.colors.rock, 0.35), this.hot, 0.35 * o.hot) : whiten(this.colors.rock, 0.45));
    if (!s || !sh) { if (s) this.give(s, 'rocks'); if (sh) this.give(sh, 'shadows'); return; }
    const glow = o.hot > 0 ? this.take('air', this.tex.glow, this.colors.side) : null;
    s.position.set(from.x, from.y); sh.position.set(from.x, from.y); sh.alpha = 0; s.scale.set(0);
    if (glow) glow.alpha = 0;
    this.boulders.push({
      s, sh, glow, from, to, ctrl, age: Math.max(0, o.age0 ?? 0), dur: Math.max(1, o.durMs), size: BOULDER_PX * o.size * S, rot: this.rnd() * Math.PI * 2,
      vr: (o.side >= 0 ? 1 : -1) * (7 + this.rnd() * 3), hot: o.hot, lastX: from.x, lastY: from.y, trail: 0,
    });
    // It rips out of the ground: a burst of grit and dust at the launch.
    for (let i = 0; i < 4; i++) {
      const ang = this.rnd() * Math.PI * 2;
      this.rock(from.x, from.y, ang, 60 + this.rnd() * 120, 260 + this.rnd() * 240, 0.25 + 0.15 * this.rnd(), 0, 600);
    }
    this.puff(from.x, from.y, 1.2 * o.size, ux * 60, -40, 520, 0, 0.5);
  }

  /** The position of a boulder at progress `e` (0..1), and its height above the ground line. */
  private boulderAt(b: Boulder, e: number): { x: number; y: number; gx: number; gy: number } {
    const m = 1 - e;
    return {
      x: m * m * b.from.x + 2 * m * e * b.ctrl.x + e * e * b.to.x,
      y: m * m * b.from.y + 2 * m * e * b.ctrl.y + e * e * b.to.y,
      gx: b.from.x + (b.to.x - b.from.x) * e, gy: b.from.y + (b.to.y - b.from.y) * e,
    };
  }

  /**
   * STONE SPIKES burst out of the ground in a crown round the struck portrait (every tier's eruption): each grows in
   * ~110 ms with an overshoot, staggered round the ring, holds, then sinks back. Longer at the bottom and the sides (the
   * ground), shorter over the top, always pointing outward so the face is never covered.
   */
  spikes(x: number, y: number, r: number, n: number, height: number, holdMs: number, hot: number): void {
    const off = -Math.PI / 2 + (this.rnd() - 0.5) * 0.9;
    let idx = 0;
    for (let i = 0; i < n; i++) {
      // Uneven spacing: nothing symmetric.
      const a = off + ((i + 0.5 + (this.rnd() - 0.5) * 0.7) / n) * Math.PI * 2;
      const low = 0.5 + 0.5 * Math.sin(a); // 1 at the bottom, 0 at the top
      const main = r * 0.5 * height * (0.6 + 0.4 * low) * (0.75 + 0.5 * this.rnd());
      // A CLUSTER, not a cone: one main shard and one or two smaller ones leaning off it at their own angles.
      const count = 1 + (this.rnd() < 0.75 ? 1 : 0) + (this.rnd() < 0.35 ? 1 : 0);
      for (let c = 0; c < count; c++) {
        const h = main * (c === 0 ? 1 : 0.42 + 0.3 * this.rnd());
        const w = h * (0.5 + 0.25 * this.rnd());
        const tx = this.tex.shards[Math.floor(this.rnd() * this.tex.shards.length)] ?? this.tex.shards[0]!;
        const tint = hot > 0 && this.rnd() < 0.5 * hot ? mixColor(whiten(this.colors.rock, 0.3), this.hot, 0.25) : whiten(this.colors.rock, 0.3 + 0.2 * this.rnd());
        const sp = this.take('rocks', tx, tint);
        if (!sp) return;
        const side = c === 0 ? 0 : (c === 1 ? 1 : -1) * (0.16 + 0.1 * this.rnd());
        const base = r * (0.8 + 0.08 * this.rnd() + (c ? 0.04 : 0));
        const px = x + Math.cos(a + side) * base, py = y + Math.sin(a + side) * base;
        sp.anchor.set(0.5, 1);
        sp.position.set(px, py);
        const rot = a + Math.PI / 2 + side * 2.2 + (this.rnd() - 0.5) * 0.35;
        sp.rotation = rot;
        sp.scale.set(0, 0);
        // A contact scorch under the main shard's foot (grounds it in the dirt).
        const sc = c === 0 ? this.take('scorch', this.tex.glow, this.colors.chasm) : null;
        if (sc) { sc.position.set(px, py); sc.rotation = rot; sc.scale.set((w * 2) / 128, (w * 0.8) / 128); sc.alpha = 0; }
        this.spikeList.push({
          s: sp, scorch: sc, age: 0, delay: idx++ * (8 + 10 * this.rnd()) + c * 25, w, h, hold: holdMs * (0.8 + 0.4 * this.rnd()), sink: 260,
          rot, wob: this.rnd() * 6, flip: this.rnd() < 0.5 ? -1 : 1, crumbled: false, x: px, y: py,
        });
      }
    }
  }

  /** TIER IV's GEYSER at the eruption: an emitter of molten streaks, billowing dust and tumbling rock for `holdMs`. */
  pillar(x: number, y: number, r: number, holdMs: number, eruption: number, rocks: number): void {
    const core = this.take('air', this.tex.glow, this.hot);
    if (!core) return;
    core.position.set(x, y + r * 0.2); core.alpha = 0;
    this.geysers.push({ core, x, y: y + r * 0.2, r, age: 0, dur: Math.max(120, holdMs), power: eruption, magmaAcc: 0, dustAcc: 0, rockAcc: 0 });
    // Rocks shot HIGH at the start (tumbling debris; a hot few glow).
    for (let i = 0; i < rocks; i++) {
      const a = this.rnd() * Math.PI * 2;
      this.rock(x + (this.rnd() - 0.5) * r * 0.6, y, a, 40 + this.rnd() * 180, 900 + this.rnd() * 800, (0.5 + this.rnd() * 0.7) * 1.1, this.rnd() < 0.5 ? 1 : 0, 1400 + this.rnd() * 500);
    }
  }

  /**
   * THE ERUPTION SPRAY (owner 2026-09-28: "have pixi burst out of it almost like an eruption"): a violent fountain of
   * molten streaks thrown UP out of the ground, fanned, falling back under gravity. Additive (they are light). `n` of
   * them, their speed scaled by `power`.
   */
  spray(x: number, y: number, r: number, n: number, power: number): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * (1.1 + 0.5 * this.rnd());
      const sp = (650 + this.rnd() * 900) * power * S;
      const b = this.rnd() * Math.PI * 2, rr = this.rnd() * r * 0.55;
      this.particle('air', this.tex.streak, i % 3 === 0 ? this.colors.core : i % 3 === 1 ? this.hot : this.colors.side, {
        x: x + Math.cos(b) * rr, y: y + Math.sin(b) * rr * 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.5, grav: 2200 * S,
        life: 520 + this.rnd() * 420, from: (1.3 + this.rnd() * 0.9) * S, to: 0.35 * S, alpha: 1, streak: true,
      });
    }
  }

  /** A boulder that is NOT the last lands (a tick): line work only, never a fill (Arcana's rule), and a few chips. */
  landTick(x: number, y: number, r: number, size: number): void {
    const S = this.scale;
    this.addFx('dust', this.tex.dustRing, this.colors.dust, x, y, { dur: 420, from: (r * 0.9) / 96, to: (r * 1.8 * size) / 96, a0: 0.55 });
    this.addFx('air', this.tex.ring, this.hot, x, y, { dur: 260, from: (r * 0.6) / 64, to: (r * 1.3) / 64, a0: 0.7 });
    this.spikes(x, y, r, 3, 0.6 * size, 120, 0);
    for (let i = 0; i < 5; i++) {
      const a = this.rnd() * Math.PI * 2;
      this.rock(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.4, a, 80 + this.rnd() * 160, 300 + this.rnd() * 300, 0.3 + 0.2 * this.rnd(), 0, 700);
    }
    void S;
  }

  /**
   * THE ERUPTION under the struck hero. Every light element starts AT its peak, so the first frame is the brightest
   * frame. `r` is the struck portrait's radius (the flash covers it; the cracks and the crater ring it, never covering
   * the face).
   */
  erupt(x: number, y: number, r: number, o: {
    tier: number; k: number; flashAlpha: number; width: number; magma: number; rocks: number; dust: number; eruption: number;
    crater: number; craterMs: number; heading: number; rockSize: number;
    /** A true quake (Tier IV): the ground cracks round the target. Otherwise the boulder bursts spikes out of it. */
    quake: boolean; spikes: number; spikeHeight: number; spray: number;
  }): void {
    const S = this.scale;
    const E = o.eruption;
    const portrait = (r * 2) / 128; // the glow texture is 128 px across
    const c = this.colors;
    // Short and bright, then gone by the time the damage number has popped.
    this.addFx('air', this.tex.glow, c.core, x, y, { dur: 130, from: portrait * 1.05, to: portrait * 1.35, a0: 0.8 * o.flashAlpha });
    this.addFx('air', this.tex.glow, c.side, x, y, { dur: 340, from: portrait * 1.2, to: portrait * (1.8 + 0.5 * o.k) * E, a0: 0.42 * o.flashAlpha });
    // Rings: the dust shockwave on the ground and (II+) a hot ring of light.
    this.addFx('dust', this.tex.dustRing, c.dust, x, y, { dur: 600 + 200 * o.k, from: (r * 1.3) / 96, to: (r * (2.8 + 1.4 * o.k) * E) / 96, a0: 0.7 });
    if (o.tier >= 2) this.addFx('air', this.tex.ring, c.side, x, y, { dur: 340, from: (r * 0.9) / 64, to: (r * (1.7 + 0.7 * o.k) * E) / 64, a0: 0.85 });
    // STONE SPIKES burst out round the portrait (every tier), then the magma SPRAY fountains up out of the ground.
    this.spikes(x, y, r, o.spikes, o.spikeHeight, 380 + 260 * o.k, o.magma);
    this.spray(x, y, r, o.spray, 0.75 + 0.35 * o.k + (o.quake ? 0.25 : 0));
    if (o.quake) {
      // The cataclysm's LIGHT BURST (a short, huge fill that is gone before the -N settles) and a wide SHOCK RING.
      this.addFx('air', this.tex.glow, c.core, x, y, { dur: 140, from: portrait * 1.4, to: portrait * 2.2, a0: 0.85 * o.flashAlpha });
      this.addFx('air', this.tex.ring, c.core, x, y, { dur: 380, from: (r * 1.1) / 64, to: (r * 3.4) / 64, a0: 0.85 });
      this.addFx('air', this.tex.ring, c.side, x, y, { dur: 520, from: (r * 1.2) / 64, to: (r * 4.4) / 64, a0: 0.6, delay: 50 });
    }
    // The cracks burst open around the portrait, magma glowing from them (a quake only: the boulders use spikes).
    if (o.quake) this.radial(x, y, [2, 4, 7, 10][o.tier - 1] ?? 4, r * 0.92, [r * 0.5 * E, r * (0.9 + 0.8 * o.k) * E], Math.max(4, o.width * 0.8), Math.max(o.magma, o.tier >= 2 ? 0.35 : 0.15), 150, o.heading + Math.PI, 700 * o.crater);
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
      this.puff(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.85, sz, Math.cos(a) * (120 + 80 * o.k), Math.sin(a) * 90 - 30, 900 + 500 * o.k, 20 + i * 10, 0.7, i % 2 ? 0.25 : 0.08);
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

  /** Advance by `dtMs` (sequence ms; the runner applies the speed). */
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
      const n = c.pts.length;
      // The front: where the crack has got to (a point between two path points), drawn as a sharp tip.
      let fx = c.pts[0]!.x, fy = c.pts[0]!.y;
      if (c.f > 0) { const p = this.pointOn(c, c.f); fx = p.x; fy = p.y; }
      let heatSum = 0;
      for (let k = 0; k < n; k++) {
        const d = c.cum[k]!;
        let x: number, y: number, wpx: number;
        if (d <= c.f) {
          x = c.pts[k]!.x; y = c.pts[k]!.y;
          const behind = c.f - d + extra;
          const open = 0.35 + 0.65 * easeOutCubic(c.openPx > 0 ? behind / c.openPx : 1);
          const tip = clamp01(behind / (46 * S)); // the tip tapers to a point
          wpx = c.w[k]! * open * Math.sqrt(tip);
          if (k === 0 && c.drive.kind !== 'main') wpx *= 0.6;
          heatSum += Math.max(0.7, 1 - behind / (170 * S));
        } else { x = fx; y = fy; wpx = 0; }
        const ex = c.nx[k]!, ey = c.ny[k]!;
        for (const st of [c.lip, c.chasm, c.seam, c.glow]) {
          if (!st) continue;
          const h = wpx > 0 ? st.half(wpx) : 0;
          st.v[k * 4] = x + ex * h; st.v[k * 4 + 1] = y + ey * h;
          st.v[k * 4 + 2] = x - ex * h; st.v[k * 4 + 3] = y - ey * h;
        }
      }
      const seen = c.f > 0 ? 1 : 0;
      const heat = (heatSum > 0 ? Math.min(1, heatSum / Math.max(1, n * 0.5)) : 1) * cool;
      c.lip.mesh.alpha = 0.38 * fade * seen;
      c.chasm.mesh.alpha = fade * seen;
      // Magma seams cool to a dull ember (never fully dark while the crack shows); dry cracks show a hint of light.
      const ember = Math.max(cool, 0.3 * c.magma);
      c.seam.mesh.alpha = (0.16 + 0.84 * c.magma) * Math.max(0.75, heat) * ember * flick * fade * seen;
      // Cooling magma sinks from white-hot through the side colour to a deep ember red.
      c.seam.mesh.tint = cool >= 1 ? this.hot : mixColor(mixColor(this.colors.side, 0x3a0600, 0.55), this.hot, cool);
      if (c.glow) c.glow.mesh.alpha = 0.3 * c.magma * Math.max(0.6, heat) * cool * flick * fade * seen;
      // The main crack kicks dust and grit up at its front as it runs.
      if (c.kick > 0 && c.f > 0 && !done && c.f - c.lastKick > 70 * S) {
        c.lastKick = c.f;
        this.puff(fx, fy, 0.8 + 0.4 * c.kick, (this.rnd() - 0.5) * 80, -30 - this.rnd() * 40, 520 + 200 * c.kick, 0, 0.42);
        if (c.kick >= 1) {
          const a = this.rnd() * Math.PI * 2;
          this.rock(fx, fy, a, 40 + this.rnd() * 90, 260 + this.rnd() * 280, 0.3 + 0.15 * this.rnd(), c.magma > 0.5 && this.rnd() < 0.4 ? 0.9 : 0, 650);
        }
      }
      if (fade <= 0) {
        this.dropCrack(c);
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
      const sc = p.from + (p.to - p.from) * t;
      if (p.streak) {
        // A streak along its velocity, longer the faster it moves (the spray reads as liquid fire, not dots).
        p.s.rotation = Math.atan2(p.vy, p.vx);
        const spd = Math.hypot(p.vx, p.vy) / Math.max(0.001, S);
        p.s.scale.set(sc * (0.7 + Math.min(2.2, spd / 450)), sc * 0.42);
      } else p.s.scale.set(sc);
      p.s.alpha = p.alpha * (1 - t * t);
    }

    for (let i = this.boulders.length - 1; i >= 0; i--) {
      const b = this.boulders[i]!;
      b.age += dt;
      const u = clamp01(b.age / b.dur);
      const e = 0.88 * u + 0.12 * u * u; // a touch of weight on the way down
      const p = this.boulderAt(b, e);
      const h = Math.hypot(p.x - p.gx, p.y - p.gy);
      const pop = easeOutCubic(Math.min(1, b.age / 90)); // ripped out of the ground: grows in fast
      const sz = (b.size / 128) * 1.2 * pop * (1 + 0.22 * Math.sin(Math.PI * e));
      b.rot += b.vr * sec;
      b.s.position.set(p.x, p.y); b.s.rotation = b.rot; b.s.scale.set(sz);
      const lift = Math.min(0.7, h / (320 * S));
      b.sh.position.set(p.gx, p.gy + b.size * 0.35);
      b.sh.scale.set((b.size / 128) * 1.5 * (1 - lift), (b.size / 128) * 0.6 * (1 - lift));
      b.sh.alpha = 0.45 * (1 - lift) * pop;
      if (b.glow) { b.glow.position.set(p.x, p.y); b.glow.scale.set((b.size / 128) * 2.4 * pop); b.glow.alpha = 0.55 * b.hot * pop; }
      // Dust streams off it (and embers off a hot one), every ~60 px of flight.
      b.trail += Math.hypot(p.x - b.lastX, p.y - b.lastY);
      if (b.trail > 60 * S && u < 0.95) {
        b.trail = 0;
        this.puff(p.x, p.y, 0.5 + 0.35 * (b.size / (BOULDER_PX * S)), (b.lastX - p.x) * 2, (b.lastY - p.y) * 2 - 20, 420, 0, 0.35);
        if (b.hot > 0) {
          const a = Math.atan2(b.lastY - p.y, b.lastX - p.x) + (this.rnd() - 0.5) * 0.8;
          this.particle('air', this.tex.spark, this.hot, {
            x: p.x, y: p.y, vx: Math.cos(a) * 160 * S, vy: Math.sin(a) * 160 * S, drag: 0.3, grav: 300 * S, life: 380, from: 0.9 * S, to: 0.1 * S, alpha: 1,
          });
        }
      }
      b.lastX = p.x; b.lastY = p.y;
      if (u >= 1) { this.give(b.s, 'rocks'); this.give(b.sh, 'shadows'); if (b.glow) this.give(b.glow, 'air'); this.boulders.splice(i, 1); }
    }

    for (let i = this.spikeList.length - 1; i >= 0; i--) {
      const k = this.spikeList[i]!;
      if (k.delay > 0) { k.delay -= dt; if (k.delay > 0) continue; }
      k.age += dt;
      const grow = 95;
      let hy: number, a = 1;
      if (k.age < grow) {
        const x = k.age / grow - 1; // back-out: punches up past full height, then settles
        hy = 1 + 3.4 * x * x * x + 2.4 * x * x;
      } else if (k.age < grow + k.hold) hy = 1;
      else {
        // It CRUMBLES: chips break off once, then it slumps a little and fades (never shrinks like a cone).
        if (!k.crumbled) {
          k.crumbled = true;
          for (let j = 0; j < 2; j++) {
            const ang = k.rot - Math.PI / 2 + (this.rnd() - 0.5) * 1.2;
            this.rock(k.x + Math.cos(k.rot - Math.PI / 2) * k.h * 0.4, k.y + Math.sin(k.rot - Math.PI / 2) * k.h * 0.4, ang, 60 + this.rnd() * 100, 120 + this.rnd() * 160, 0.25 + 0.15 * this.rnd(), 0, 500);
          }
        }
        const u = clamp01((k.age - grow - k.hold) / k.sink);
        hy = 1 - 0.18 * easeOutCubic(u);
        a = 1 - u * u;
      }
      // Secondary motion: a quick lean wobble as it lands, dying out.
      const since = k.age - grow;
      const wob = since > 0 ? 0.07 * Math.exp(-since / 90) * Math.sin(since * 0.045 + k.wob) : 0;
      k.s.rotation = k.rot + wob;
      k.s.scale.set((k.w / 96) * k.flip * (0.9 + 0.1 * Math.min(1, hy)), (k.h / 192) * Math.max(0, hy));
      k.s.alpha = a;
      if (k.scorch) k.scorch.alpha = 0.55 * Math.min(1, k.age / 80) * a;
      if (k.age >= grow + k.hold + k.sink) { this.give(k.s, 'rocks'); if (k.scorch) this.give(k.scorch, 'scorch'); this.spikeList.splice(i, 1); }
    }

    for (let i = this.geysers.length - 1; i >= 0; i--) {
      const gy = this.geysers[i]!;
      gy.age += dt;
      const u = gy.age / gy.dur;
      const live = u < 1;
      // The hot core at the ground: flickers, swells, then dies (additive light only).
      const fl = 0.85 + 0.15 * Math.sin(gy.age * 0.09) + 0.1 * Math.sin(gy.age * 0.23);
      gy.core.scale.set(((gy.r * 1.5) / 128) * (0.8 + 0.4 * Math.min(1, gy.age / 90)) * fl, ((gy.r * 0.9) / 128) * fl);
      gy.core.alpha = live ? 0.5 * Math.min(1, gy.age / 60) : Math.max(0, 0.5 * (1 - (gy.age - gy.dur) / 220));
      if (live) {
        const fade = 1 - u * 0.6;
        gy.magmaAcc += dt;
        while (gy.magmaAcc >= 14) {
          gy.magmaAcc -= 14;
          // A tight fan of molten streaks thrown straight up (it reads as a column made of fire, not a solid shape).
          const a = -Math.PI / 2 + (this.rnd() - 0.5) * 0.55;
          const sp = (900 + this.rnd() * 900) * gy.power * fade * S;
          this.particle('air', this.tex.streak, this.rnd() < 0.35 ? this.colors.core : this.rnd() < 0.5 ? this.hot : this.colors.side, {
            x: gy.x + (this.rnd() - 0.5) * gy.r * 0.5, y: gy.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.55, grav: 2400 * S,
            life: 480 + this.rnd() * 380, from: (1.4 + this.rnd()) * S, to: 0.4 * S, alpha: 1, streak: true,
          });
        }
        gy.dustAcc += dt;
        if (gy.dustAcc >= 70) {
          gy.dustAcc -= 70;
          this.puff(gy.x + (this.rnd() - 0.5) * gy.r, gy.y - this.rnd() * gy.r * 0.4, (gy.r / 36) * (0.8 + 0.5 * this.rnd()), (this.rnd() - 0.5) * 140, -120 - this.rnd() * 120, 1000, 0, 0.55, 0.05 + 0.15 * this.rnd());
        }
        gy.rockAcc += dt;
        if (gy.rockAcc >= 85) {
          gy.rockAcc -= 85;
          const a = this.rnd() * Math.PI * 2;
          this.rock(gy.x, gy.y, a, 50 + this.rnd() * 160, 700 + this.rnd() * 600, 0.35 + 0.35 * this.rnd(), this.rnd() < 0.4 ? 1 : 0, 1100);
        }
      } else if (gy.age > gy.dur + 220) { this.give(gy.core, 'air'); this.geysers.splice(i, 1); }
    }

    return this.used > 0 || this.cracks.length > 0;
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const c of this.cracks) this.dropCrack(c);
    for (const r of this.rocks) { this.give(r.s, 'rocks'); this.give(r.sh, 'shadows'); if (r.glow) this.give(r.glow, 'air'); }
    for (const q of this.fx) this.giveAny(q.s);
    for (const p of this.particles) this.giveAny(p.s);
    for (const b of this.boulders) { this.give(b.s, 'rocks'); this.give(b.sh, 'shadows'); if (b.glow) this.give(b.glow, 'air'); }
    for (const k of this.spikeList) { this.give(k.s, 'rocks'); if (k.scorch) this.give(k.scorch, 'scorch'); }
    for (const gy of this.geysers) this.give(gy.core, 'air');
    this.boulders = []; this.spikeList = []; this.geysers = [];
    if (this.windupFx) { this.give(this.windupFx.ring, 'air'); this.give(this.windupFx.pool, 'glow'); }
    this.cracks = []; this.rocks = []; this.fx = []; this.particles = []; this.windupFx = null; this.main = null;
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
