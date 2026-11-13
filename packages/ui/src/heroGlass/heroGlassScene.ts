/**
 * THE FOURTH WALL SCENE: everything the attack draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so
 * it runs (and is tested) headless. `heroGlass.ts` mounts `root` on the above-portrait overlay (a fixed full-screen
 * canvas over the whole game view), hands it the blow's cracks and shards once, and each frame tells it how far the
 * cracks have grown (`growCracks`) and where the pebbles are (`setStone`).
 *
 * THE SCREEN IS THE GLASS. Three things sell it:
 *  - THE CRACKS: one stretched sprite per crack piece (a bright thread over a dark line), made once per blow, hidden, and
 *    grown from its near end by scaling along its length. Nothing is repainted; a grown crack costs nothing per frame.
 *  - THE CHIPS: the star-shaped pit at each tap.
 *  - THE SHARDS: the cracked cells themselves, as a few small meshes (sixteen shards each, so they batch with the
 *    sprites and need no shader of their own). A shard is its triangle plus an inset copy: the band between them is its
 *    bright cut RIM, the middle its pale see-through FACE (the `shard` lookup texture). On the break each one bursts a
 *    little, tumbles (a spin, an edge-on flip, a slow swell or shrink for depth), flashes as it turns face-on, and falls
 *    under gravity. The vertex and UV arrays are rewritten in place every frame: no allocation.
 * Behind the shards there is nothing of ours: the game is simply there.
 *
 * Perf: at most `GLASS_CAPS.cracks` crack sprites and `GLASS_CAPS.shards` shards, all built during the damage formation
 * (never on a hot beat); pooled fire-and-forget sprites under a hard cap; no filters, no per-frame painting.
 */
import { Container, MeshSimple, Sprite, type Texture } from 'pixi.js';
import { mixColor, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { KO_CYAN, KO_LILAC, KO_MAGENTA } from '../heroAttack/knockout';
import { GLASS_CAPS, type Box, type CrackSeg, type ShardTri } from './heroGlassConfig';
import { CHIP_PX, CRACK_W, GLINT_W, STONE_PX, WASH_PX } from './heroGlassTextures';

export interface HeroGlassTextures {
  glow: Texture; ring: Texture; star: Texture; spark: Texture; streak: Texture;
  /** One fracture line, along +x (a bright thread over a dark line). */
  crack: Texture;
  /** The star-shaped pit a pebble leaves. */
  chip: Texture;
  stone: Texture;
  /** The shard lookup: u = rim to face, v = resting to flashing. */
  shard: Texture;
  sliver: Texture;
  glint: Texture;
  wash: Texture;
}

export interface GlassColors { glass: number; edge: number; shade: number; flash: number; stone: number; side: number }

export interface GlassLook {
  /** Shard gravity (px/s^2), outward burst (px/s), tumble (radians/s) and rim width (px), all at stage scale 1. */
  gravity: number;
  burst: number;
  spin: number;
  rim: number;
  stonePx: number;
  impactSize: number;
  splitAlpha: number;
}

/** Hard cap on pooled fire-and-forget sprites alive at once (the cracks, chips and shards are counted separately). */
export const MAX_GLASS_SPRITES = 520;
/** Shards per mesh: 16 x 6 vertices = 96, under Pixi's 100-vertex batch limit, so every mesh batches. */
export const SHARDS_PER_MESH = 16;
const GLOW_PX = 128;
const RING_PX = 160;
const STAR_PX = 48;
const VERTS = 6;
/** A shard still on screen this long after the break is dropped (it never happens with the default gravity). */
const SHARD_MAX_MS = 2400;

type ShardMode = 'pane' | 'shatter';

interface Shard {
  cx: number; cy: number;
  /** Outer and inner corners, relative to the centre (x0, y0, ... x5, y5). */
  lx: Float32Array;
  delay: number; vx: number; vy: number; spin: number; flip: number; phase: number; cosA: number; sinA: number; grow: number; base: number; reach: number;
  mesh: MeshSimple; at: number; uv: Float32Array;
  gone: boolean;
}

export class HeroGlassScene extends FxPool {
  /** Our own layer, between the pool's `body` and `core` layers: the offset tints, the hole, the cracks, the chips, the shards. */
  private pane: Container | null;
  private readonly marks: Container;
  private readonly crackLayer: Container;
  private readonly shardLayer: Container;
  private cracks: Sprite[] = [];
  private segs: readonly CrackSeg[] = [];
  private grown: Uint8Array = new Uint8Array(0);
  private firstOpen = 0;
  private chips: Sprite[] = [];
  private stones: (Sprite | null)[] = [];
  private shards: Shard[] = [];
  private meshes: MeshSimple[] = [];
  private hole: MeshSimple | null = null;
  private split: [Sprite, Sprite] | null = null;
  private shardT = -1;
  private shardsLeft = 0;
  private warmMs = 400;
  private area: Box = { x: 0, y: 0, w: 1920, h: 1080 };

  constructor(private readonly tex: HeroGlassTextures, private readonly colors: GlassColors, private readonly look: GlassLook, scale = 1, seed = 1) {
    super('heroGlass', [tex.glow, tex.ring, tex.star, tex.spark, tex.streak, tex.crack, tex.chip, tex.stone, tex.shard, tex.sliver, tex.glint, tex.wash], scale, seed, MAX_GLASS_SPRITES);
    this.pane = new Container();
    this.pane.label = 'heroGlass-pane';
    this.shardLayer = new Container();
    this.marks = new Container();
    this.crackLayer = new Container();
    this.marks.addChild(this.crackLayer);
    this.pane.addChild(this.shardLayer, this.marks);
    // Above the pool's under / glow / body layers, below its additive `core` (the glints sparkle over the glass).
    this.root.addChildAt(this.pane, 3);
  }

  get liveCracks(): number { let n = 0; for (const s of this.cracks) if (s.visible) n++; return n; }
  get crackCount(): number { return this.cracks.length; }
  get chipCount(): number { let n = 0; for (const s of this.chips) if (s.visible) n++; return n; }
  get shardCount(): number { return this.shards.length; }
  /** Shards still falling (0 before the break and once the last has left the screen). */
  get shardsFalling(): number { return this.shardT >= 0 ? this.shardsLeft : 0; }
  get marksAlpha(): number { return this.marks.alpha; }
  get holeAlpha(): number { return this.hole && this.hole.visible ? this.hole.alpha : 0; }
  get stonesFlying(): number { let n = 0; for (const s of this.stones) if (s && s.visible) n++; return n; }

  /** The screen (the flash, the split tints and the shards' fall are measured against it). */
  setArea(area: Box): void { this.area = area; }

  // ── the cracks ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Hand over the blow's cracks (sorted by start time): one hidden sprite each, made now, during the formation. */
  setCracks(segs: readonly CrackSeg[]): void {
    if (this.destroyed || !this.pane) return;
    const n = Math.min(segs.length, GLASS_CAPS.cracks);
    this.segs = segs;
    this.grown = new Uint8Array(n);
    this.firstOpen = 0;
    for (let i = 0; i < n; i++) {
      const g = segs[i]!;
      const s = new Sprite(this.tex.crack);
      s.anchor.set(0, 0.5);
      s.position.set(g.ax, g.ay);
      s.rotation = g.ang;
      s.scale.set(0, g.w * this.scale * 1.3);
      s.tint = this.colors.edge;
      s.visible = false;
      this.crackLayer.addChild(s);
      this.cracks.push(s);
    }
  }

  /**
   * Grow the cracks to sequence time `t` (each from its near end, over its own window). Once a crack is whole it is
   * never touched again, and the loop starts past the whole ones: a finished web costs nothing per frame.
   */
  growCracks(t: number): void {
    const n = this.cracks.length;
    let i = this.firstOpen;
    while (i < n && this.grown[i]) i++;
    this.firstOpen = i;
    for (; i < n; i++) {
      if (this.grown[i]) continue;
      const g = this.segs[i]!;
      if (t < g.t0) break; // sorted by start: nothing later has started either
      const u = g.t1 > g.t0 ? Math.min(1, (t - g.t0) / (g.t1 - g.t0)) : 1;
      const s = this.cracks[i]!;
      s.visible = true;
      s.scale.x = (g.len * u) / CRACK_W;
      if (u >= 1) {
        this.grown[i] = 1;
        // A refraction glint where every few cracks stop (picked by index, so a replay glints the same).
        if ((i * 7919) % 6 === 0) this.spawn('core', this.tex.star, 0xffffff, g.bx, g.by, { dur: 260, from: 0.12, to: 0.4, a0: 0.9, mode: 'punch', peakAt: 0.25, rot: 0.4 });
      }
    }
  }

  /** The cracks and chips fade together (the glass heals); 0 hides them. */
  setMarksAlpha(a: number): void {
    if (this.destroyed || !this.pane) return;
    const on = a > 0.004;
    this.marks.visible = on;
    this.marks.alpha = on ? Math.min(1, a) : 0;
  }

  /** The star-shaped pit at a tap (`px`: its width on screen), with its little burst. */
  chip(at: Pt, px: number): void {
    if (this.destroyed || !this.pane) return;
    const s = new Sprite(this.tex.chip);
    s.anchor.set(0.5);
    s.position.set(at.x, at.y);
    s.scale.set(px / CHIP_PX);
    s.rotation = this.rnd() * Math.PI * 2;
    s.tint = whiten(this.colors.glass, 0.6);
    this.marks.addChild(s);
    this.chips.push(s);
  }

  // ── the pebbles ────────────────────────────────────────────────────────────────────────────────────────────

  /** Pebble `i` this frame: at `p`, `u` (0..1) through its flight (it swells as it flies at the glass). */
  setStone(i: number, p: Pt, u: number, on: boolean, size = 1): void {
    let s = this.stones[i] ?? null;
    if (!s) {
      if (!on) return;
      s = this.take('body', this.tex.stone, this.colors.stone);
      if (!s) return;
      this.stones[i] = s;
    }
    s.visible = on;
    if (!on) return;
    const k = (this.look.stonePx * size * this.scale * (0.62 + 0.5 * u)) / STONE_PX;
    s.position.set(p.x, p.y);
    s.scale.set(k);
    s.rotation = u * 7 + i * 1.7;
  }

  /** The pebble glances off the glass and drops back into the scene, small and spinning. */
  bounce(at: Pt, dir: Pt, size = 1): void {
    const k = (this.look.stonePx * size * 1.1) / STONE_PX;
    this.spawn('body', this.tex.stone, this.colors.stone, at.x, at.y, {
      dur: 520, from: k, to: k * 0.35, a0: 1, mode: 'hold', ease: 'linear', vx: -dir.x * 260 + (this.rnd() - 0.5) * 120, vy: -dir.y * 120 - 260, grav: 2400, drag: 0.6, spin: 0.02 * (this.rnd() < 0.5 ? -1 : 1),
    });
  }

  /** A tap on the glass: a white tick of light, a ring on the surface, splinters dropping, a glint. */
  tap(at: Pt, strength: number): void {
    const c = this.colors;
    const T = strength * this.look.impactSize;
    this.spawn('core', this.tex.glow, whiten(c.flash, 0.5), at.x, at.y, { dur: 140, from: (40 * T) / GLOW_PX, to: (130 * T) / GLOW_PX, a0: 0.9, mode: 'punch', peakAt: 0.12 });
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 220, from: (36 * T) / STAR_PX, to: (120 * T) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.18, rot: 0.3 });
    this.spawn('glow', this.tex.ring, c.glass, at.x, at.y, { dur: 300, from: (18 * T) / RING_PX, to: (150 * T) / RING_PX, a0: 0.7, ease: 'cubic' });
    this.burst('body', this.tex.sliver, [whiten(c.glass, 0.5), 0xffffff, c.glass], at.x, at.y, Math.round(4 + 5 * T), { speed: 260 * T, life: 520, size: 0.42 * T, grav: 1900, drag: 0.5, spin: 0.03, lift: 120, flip: 0.012, to: 0.7 });
    this.burst('core', this.tex.spark, [0xffffff, c.glass], at.x, at.y, Math.round(3 + 3 * T), { speed: 300 * T, life: 260, size: 0.4 * T, drag: 0.2, to: 0.2 });
  }

  /** One creak: a hairline flash and a splinter or two somewhere on the web (`at`), nothing loud. */
  creak(at: Pt, k = 1): void {
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 200, from: 0.15 * k, to: 0.55 * k, a0: 0.9, mode: 'punch', peakAt: 0.2, rot: this.rnd() * 3 });
    this.burst('body', this.tex.sliver, [whiten(this.colors.glass, 0.5), 0xffffff], at.x, at.y, 2, { speed: 120, life: 480, size: 0.3 * k, grav: 1800, drag: 0.5, spin: 0.03, flip: 0.012, to: 0.7 });
  }

  // ── the shards ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Hand over the blow's shards (III: the pane's; IV: the whole screen's), bursting from `origin`. Built now, hidden;
   * `breakOut()` lets them go. `pane`: also a dark HOLE where they were, shown by `setHole`.
   */
  setShards(tris: readonly ShardTri[], origin: Pt, mode: ShardMode): void {
    if (this.destroyed || !this.pane) return;
    const n = Math.min(tris.length, GLASS_CAPS.shards);
    if (n <= 0) return;
    const S = this.scale;
    const far = Math.max(1, ...tris.map((t) => t.dist));
    const rim = this.look.rim * S;
    for (let m = 0; m * SHARDS_PER_MESH < n; m++) {
      const count = Math.min(SHARDS_PER_MESH, n - m * SHARDS_PER_MESH);
      const verts = new Float32Array(count * VERTS * 2);
      const uvs = new Float32Array(count * VERTS * 2);
      const idx = new Uint32Array(count * 21);
      for (let j = 0; j < count; j++) {
        const b = j * VERTS;
        // The rim band (three quads between the outer and the inner triangle), then the face.
        const q = [0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4, 2, 0, 5, 0, 3, 5, 3, 4, 5];
        for (let e = 0; e < 21; e++) idx[j * 21 + e] = b + q[e]!;
        for (let v = 0; v < VERTS; v++) { uvs[(b + v) * 2] = v < 3 ? 0.03 : 0.97; uvs[(b + v) * 2 + 1] = 0.1; }
      }
      const mesh = new MeshSimple({ texture: this.tex.shard, vertices: verts, uvs, indices: idx });
      mesh.tint = whiten(this.colors.glass, 0.25);
      // Pre-warm: drawn all but invisible for the first few hundred ms so nothing about it is new on the break.
      mesh.alpha = 0.004;
      this.shardLayer.addChild(mesh);
      this.meshes.push(mesh);
      for (let j = 0; j < count; j++) {
        const t = tris[m * SHARDS_PER_MESH + j]!;
        const lx = new Float32Array(12);
        let reach = 0;
        for (let v = 0; v < 3; v++) {
          const dx = t.x[v]! - t.cx, dy = t.y[v]! - t.cy;
          const d = Math.hypot(dx, dy) || 1;
          const inset = Math.max(0.35, 1 - (rim * 2.2) / d);
          lx[v * 2] = dx; lx[v * 2 + 1] = dy;
          lx[(v + 3) * 2] = dx * inset; lx[(v + 3) * 2 + 1] = dy * inset;
          reach = Math.max(reach, d);
        }
        const near = 1 - Math.min(1, t.dist / far);
        const ox = t.cx - origin.x, oy = t.cy - origin.y;
        const ol = Math.hypot(ox, oy) || 1;
        const axis = mode === 'pane' ? (this.rnd() - 0.5) * 0.5 : this.rnd() * Math.PI;
        const push = this.look.burst * S * (mode === 'pane' ? 0.35 : 0.5 + 0.9 * near) * (0.5 + this.rnd() * 0.8);
        this.shards.push({
          cx: t.cx, cy: t.cy, lx,
          delay: mode === 'pane' ? j * 22 + this.rnd() * 30 : (1 - near) * 110 + this.rnd() * 40,
          vx: (ox / ol) * push + (this.rnd() - 0.5) * 60 * S,
          vy: (oy / ol) * push * 0.6 - (20 + this.rnd() * 90) * S + (mode === 'pane' ? 0 : reach * 0.5),
          spin: (this.rnd() - 0.5) * 2 * this.look.spin * (mode === 'pane' ? 0.5 : 1),
          flip: (mode === 'pane' ? 3 + this.rnd() * 2.5 : 1.6 + this.rnd() * 4.2) * (this.rnd() < 0.5 ? -1 : 1),
          phase: this.rnd() * Math.PI * 2, cosA: Math.cos(axis), sinA: Math.sin(axis),
          grow: mode === 'pane' ? 0.35 + this.rnd() * 0.3 : -0.16 + this.rnd() * 0.62,
          base: 0.04 + this.rnd() * 0.3, reach,
          mesh, at: j * VERTS * 2, uv: uvs, gone: false,
        });
      }
    }
    if (mode === 'pane') {
      // The hole: the same cells, flat and dark, under the cracks.
      const hv = new Float32Array(n * 6), hu = new Float32Array(n * 6).fill(0.5), hi = new Uint32Array(n * 3);
      for (let j = 0; j < n; j++) { const t = tris[j]!; for (let v = 0; v < 3; v++) { hv[j * 6 + v * 2] = t.x[v]!; hv[j * 6 + v * 2 + 1] = t.y[v]!; hi[j * 3 + v] = j * 3 + v; } }
      this.hole = new MeshSimple({ texture: this.tex.wash, vertices: hv, uvs: hu, indices: hi });
      this.hole.tint = this.colors.shade;
      this.hole.alpha = 0; this.hole.visible = false;
      this.pane.addChildAt(this.hole, 0);
    }
    this.placeShards(0);
  }

  /** THE BREAK: the shards let go. */
  breakOut(): void {
    if (!this.shards.length || this.shardT >= 0) return;
    this.shardT = 0;
    this.shardsLeft = this.shards.length;
    this.warmMs = 0;
    for (const m of this.meshes) { m.alpha = 1; m.visible = true; }
  }

  /** The hole the pane left (0 hides it). */
  setHole(a: number): void {
    if (this.destroyed || !this.hole) return;
    const on = a > 0.004;
    this.hole.visible = on;
    this.hole.alpha = on ? a : 0;
  }

  /** Every shard's six vertices and its flash, `ms` after the break. Rewrites the meshes' arrays in place. */
  private placeShards(ms: number): void {
    const g = this.look.gravity * this.scale;
    const bottom = this.area.y + this.area.h, left = this.area.x, right = this.area.x + this.area.w;
    for (const sh of this.shards) {
      if (sh.gone) continue;
      const tau = Math.max(0, ms - sh.delay) / 1000;
      const px = sh.cx + sh.vx * tau, py = sh.cy + sh.vy * tau + 0.5 * g * tau * tau;
      const depth = Math.max(0.3, 1 + sh.grow * tau);
      const v = sh.mesh.vertices as Float32Array;
      if (tau > 0 && (py - sh.reach * depth > bottom + 8 || px + sh.reach * depth < left - 8 || px - sh.reach * depth > right + 8)) {
        // Off the screen: collapse it to a point and never touch it again.
        for (let i = 0; i < VERTS * 2; i++) v[sh.at + i] = i % 2 ? bottom + 64 : px;
        sh.gone = true; this.shardsLeft--;
        continue;
      }
      const rot = sh.spin * tau, fa = sh.flip * tau;
      const cr = Math.cos(rot) * depth, sr = Math.sin(rot) * depth, cf = Math.cos(fa);
      for (let i = 0; i < VERTS; i++) {
        const x = sh.lx[i * 2]!, y = sh.lx[i * 2 + 1]!;
        // The edge-on flip about the shard's own axis, then the spin, the depth and the fall.
        const along = x * sh.cosA + y * sh.sinA, perp = (-x * sh.sinA + y * sh.cosA) * cf;
        const fx = along * sh.cosA - perp * sh.sinA, fy = along * sh.sinA + perp * sh.cosA;
        v[sh.at + i * 2] = px + fx * cr - fy * sr;
        v[sh.at + i * 2 + 1] = py + fx * sr + fy * cr;
      }
      // It flashes as it lets go, and again each time it turns face-on to the light.
      const glint = Math.pow(Math.max(0, Math.cos(fa * 0.5 + sh.phase)), 8);
      const bright = Math.min(0.97, sh.base + (ms > 0 ? 0.38 * Math.exp(-(ms - Math.min(ms, sh.delay)) / 80) : 0) + 0.6 * glint * Math.min(1, tau * 6));
      for (let i = 0; i < VERTS; i++) sh.uv[sh.at + i * 2 + 1] = bright;
    }
    for (const m of this.meshes) { try { m.geometry.getBuffer('aUV').update(); m.geometry.getBuffer('aPosition').update(); } catch { /* headless */ } }
  }

  // ── the big beats ──────────────────────────────────────────────────────────────────────────────────────────

  /** A flash of white-blue over the whole view. */
  flash(a0: number, dur: number): void {
    const b = this.area;
    this.spawn('glow', this.tex.wash, this.colors.flash, b.x + b.w / 2, b.y + b.h / 2, {
      dur, from: (b.w * 1.1) / WASH_PX / this.scale, to: (b.w * 1.1) / WASH_PX / this.scale, sy: (b.h * 1.1) / (b.w * 1.1), a0, mode: 'punch', peakAt: 0.08, ease: 'linear',
    });
  }

  /** III: the pane breaks out of the web at `at` (the hole's centre, `r` its radius): a surface ring and splinters. */
  paneBreak(at: Pt, r: number): void {
    const c = this.colors;
    this.spawn('core', this.tex.glow, whiten(c.flash, 0.4), at.x, at.y, { dur: 200, from: (r * 1.2) / GLOW_PX / this.scale, to: (r * 2.8) / GLOW_PX / this.scale, a0: 0.55, mode: 'punch', peakAt: 0.1 });
    this.spawn('glow', this.tex.ring, c.glass, at.x, at.y, { dur: 380, from: (r * 0.9) / RING_PX / this.scale, to: (r * 3.2) / RING_PX / this.scale, a0: 0.7, ease: 'cubic' });
    this.burst('body', this.tex.sliver, [whiten(c.glass, 0.5), 0xffffff, c.glass], at.x, at.y, 16, { speed: 420, life: 760, size: 0.55, grav: 2200, drag: 0.5, spin: 0.03, lift: 160, flip: 0.012, to: 0.7 });
    this.burst('core', this.tex.spark, [0xffffff, c.glass], at.x, at.y, 8, { speed: 520, life: 300, size: 0.5, drag: 0.2, to: 0.2 });
  }

  /** III: the pane repairs: a shimmer sweeps the hole, a soft ring closes on it, a few stars. */
  repair(at: Pt, r: number): void {
    const c = this.colors;
    const S = this.scale;
    const len = (r * 2.6) / GLINT_W / S;
    for (let i = 0; i < 2; i++) {
      this.spawn('core', this.tex.glint, i ? c.glass : 0xffffff, at.x - r * 1.1, at.y + r * (0.3 - 0.5 * i), {
        dur: 300, from: len, to: len, sy: 0.9 - 0.4 * i, a0: 0.85 - 0.25 * i, mode: 'punch', peakAt: 0.4, ease: 'linear', rot: -0.9, vx: (r * 2.2) / 0.3 / S, drag: 1, delay: i * 70,
      });
    }
    this.spawn('glow', this.tex.ring, whiten(c.glass, 0.4), at.x, at.y, { dur: 320, from: (r * 2.8) / RING_PX / S, to: (r * 0.9) / RING_PX / S, a0: 0.6, mode: 'punch', peakAt: 0.5, ease: 'cubic' });
    this.spawn('glow', this.tex.glow, c.glass, at.x, at.y, { dur: 360, from: (r * 1.6) / GLOW_PX / S, to: (r * 2.6) / GLOW_PX / S, a0: 0.4, mode: 'punch', peakAt: 0.3 });
    for (let i = 0; i < 5; i++) {
      const a = this.rnd() * Math.PI * 2, d = r * (0.3 + this.rnd() * 0.8);
      this.spawn('core', this.tex.star, 0xffffff, at.x + Math.cos(a) * d, at.y + Math.sin(a) * d, { dur: 300, from: 0.15, to: 0.6, a0: 1, mode: 'punch', peakAt: 0.3, delay: 60 + this.rnd() * 160, rot: 0.4 });
    }
  }

  /**
   * IV: the faint offset either side of the main crack (the picture seems to sit a hair apart across it): a cool tint on
   * one side and a shade on the other, sliding a few px along the crack as it creaks. `a` 0 hides both.
   */
  setSplit(from: Pt, to: Pt, a: number, slide: number): void {
    if (this.destroyed || !this.pane) return;
    if (!this.split) {
      if (a <= 0.002) return;
      const mk = (tint: number, ay: number): Sprite => { const s = new Sprite(this.tex.wash); s.anchor.set(0.5, ay); s.tint = tint; this.pane!.addChildAt(s, 0); return s; };
      this.split = [mk(whiten(this.colors.glass, 0.3), 1), mk(this.colors.shade, 0)];
    }
    const on = a > 0.002;
    const [p, q] = this.split;
    p.visible = q.visible = on;
    if (!on) return;
    const dx = to.x - from.x, dy = to.y - from.y;
    const L = Math.hypot(dx, dy) || 1;
    const rot = Math.atan2(dy, dx);
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const big = Math.hypot(this.area.w, this.area.h);
    const ux = (dx / L) * slide, uy = (dy / L) * slide;
    p.rotation = q.rotation = rot;
    p.scale.set((big * 1.3) / WASH_PX, big / WASH_PX); q.scale.set((big * 1.3) / WASH_PX, big / WASH_PX);
    p.position.set(mx + ux, my + uy); q.position.set(mx - ux, my - uy);
    p.alpha = a; q.alpha = a * 0.8;
  }

  /** IV: THE WHOLE SCREEN SHATTERS (the shards are `breakOut`'s): the flash, a faint ripple, a rain of splinters, glints. */
  shatterFx(at: Pt, ko: boolean): void {
    const c = this.colors;
    const S = this.scale;
    const b = this.area;
    const far = Math.hypot(b.w, b.h);
    this.flash(0.3, 220);
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 300, from: 1.4 * this.look.impactSize, to: 5 * this.look.impactSize, a0: 0.9, mode: 'punch', peakAt: 0.08 });
    // One faint ripple across the surface (the glass, not an explosion: no shock rings).
    this.spawn('glow', this.tex.ring, whiten(c.glass, 0.4), at.x, at.y, { dur: 460, from: 0.6, to: (far * 0.9) / RING_PX / S, a0: 0.22, ease: 'cubic' });
    // Splinters from all over the pane (not only the impact): the small stuff between the big shards.
    for (let i = 0; i < 46; i++) {
      const x = b.x + this.rnd() * b.w, y = b.y + this.rnd() * b.h * 0.9;
      const dx = x - at.x, dy = y - at.y, d = Math.hypot(dx, dy) || 1;
      const sz = 0.4 + this.rnd() * 0.9;
      this.spawn('body', this.tex.sliver, i % 3 ? whiten(c.glass, 0.4) : 0xffffff, x, y, {
        dur: 900 + this.rnd() * 500, from: sz, to: sz * 0.8, a0: 1, mode: 'hold', ease: 'linear', vx: (dx / d) * (120 + this.rnd() * 260), vy: (dy / d) * 160 - 60 - this.rnd() * 200,
        grav: 2600, drag: 0.7, spin: (this.rnd() - 0.5) * 0.03, flip: 0.008 + this.rnd() * 0.01, delay: (d / far) * 140, rot: this.rnd() * 6,
      });
    }
    // A glint riding roughly with every few shards as they let go.
    for (let i = 0; i < this.shards.length; i += 3) {
      const sh = this.shards[i]!;
      this.spawn('core', this.tex.star, 0xffffff, sh.cx, sh.cy, {
        dur: 420, from: 0.3, to: 1.1, a0: 1, mode: 'punch', peakAt: 0.2, delay: sh.delay, vx: sh.vx / S, vy: sh.vy / S, grav: this.look.gravity, drag: 1, rot: 0.3 + this.rnd(),
      });
    }
    this.burst('core', this.tex.spark, [0xffffff, c.glass, whiten(c.glass, 0.5)], at.x, at.y, 30, { speed: 1100, life: 420, size: 0.8, drag: 0.25, to: 0.2 });
    if (ko) {
      // THE KNOCKOUT: the Ancient prism runs through the break.
      [KO_CYAN, KO_LILAC, KO_MAGENTA].forEach((tint, i) => this.spawn('glow', this.tex.ring, tint, at.x, at.y, { dur: 700 + i * 120, from: 0.5, to: (far * (0.6 + 0.2 * i)) / RING_PX / S, a0: 0.8, ease: 'cubic', delay: 40 + i * 70 }));
      this.burst('glow', this.tex.streak, [KO_CYAN, KO_LILAC, KO_MAGENTA], at.x, at.y, 20, { speed: 2000, life: 420, size: 2.2, drag: 0.2, align: true, to: 0.6 });
      for (const m of this.meshes) m.tint = mixColor(whiten(c.glass, 0.25), KO_LILAC, 0.35);
    }
  }

  // ── the pool's hooks ───────────────────────────────────────────────────────────────────────────────────────

  protected override tick(dt: number): boolean {
    if (this.warmMs > 0) {
      this.warmMs -= dt;
      if (this.warmMs <= 0 && this.shardT < 0) for (const m of this.meshes) { m.visible = false; m.alpha = 1; }
    }
    if (this.shardT >= 0 && this.shardsLeft > 0) {
      this.shardT += dt;
      this.placeShards(this.shardT);
      if (this.shardT > SHARD_MAX_MS) this.shardsLeft = 0;
      if (this.shardsLeft <= 0) for (const m of this.meshes) m.visible = false;
    }
    let own = this.shardT >= 0 && this.shardsLeft > 0;
    for (const s of this.stones) if (s && s.visible) { own = true; break; }
    return own;
  }

  protected override clearOwn(): void {
    for (const s of this.stones) if (s) { s.visible = true; this.give(s); }
    this.stones = [];
    for (const s of this.cracks) s.visible = false;
    for (const s of this.chips) s.visible = false;
    for (const m of this.meshes) m.visible = false;
    if (this.hole) this.hole.visible = false;
    if (this.split) { this.split[0].visible = false; this.split[1].visible = false; }
    this.shardsLeft = 0;
  }

  /** Tear down: our own layer (the cracks, chips, tints and the shard meshes with their buffers), then the pool. */
  override destroy(): void {
    if (this.destroyed) return;
    this.clear();
    const geos = [...this.meshes, ...(this.hole ? [this.hole] : [])].map((m) => m.geometry);
    this.pane?.destroy({ children: true });
    for (const g of geos) { try { g.destroy(); } catch { /* already gone */ } }
    this.pane = null;
    this.cracks = []; this.chips = []; this.meshes = []; this.shards = []; this.hole = null; this.split = null;
    super.destroy();
  }
}
