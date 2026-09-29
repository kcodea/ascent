/**
 * THE STORM CALL SCENE: everything Storm Call draws in Pixi, as a plain scene graph with no renderer, so it runs (and is
 * tested) headless. `heroStorm.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * Design rule (an Epic is one strong idea; the owner's "clean" bar): the BOLT is the subject. A bolt is three strips
 * over one jagged centreline (a wide soft glow in the bolt colour, a narrower body, a white-hot core), all additive, and
 * its jag is REGENERATED every `regenMs` from the seeded generator (a live crackle, never a static zigzag), its endpoints
 * pinned. The leader races out first (the far end of the strip collapsed onto the moving head), then the whole bolt
 * flickers and fades. Short side FORKS crackle off it, re-picked with every regeneration. STATIC is the same trick in
 * miniature: little arcs that crawl over a portrait. The Big CLOUD is a handful of normal-blend billows (so it reads as a
 * dark cloud on any board) lit from inside by additive glows when it rumbles.
 *
 * LAYERS, bottom to top: haze (normal: the cloud) | glow (additive: bolt glows, blooms, rings, the inner cloud light) |
 * core (additive: bolt bodies and cores, sparks, flashes), so the scene batches in three runs. Strips are pooled per
 * layer and per point count; every strip is at most `BOLT_POINTS` x 2 vertices, under Pixi's 100-vertex batch limit.
 *
 * Contract: sprites and strips are POOLED and bounded by `MAX_STORM_SPRITES` / `MAX_STORM_MESHES`; textures are the
 * caller's (pre-warmed on the GPU during the damage formation); positions are the overlay's px; `setCamera` mirrors the
 * DOM camera when the runner asks it to; `update` returns whether anything still draws; `destroy()` leaves nothing
 * behind. Everything random is seeded (a replay crackles the same way).
 */
import { Container, MeshSimple, Sprite, Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeOutCubic, easeOutQuint, mixColor, seededRng, type Pt } from '../heroAttack/easing';
import type { BoltGeo, BoltKind } from './heroStormConfig';

export interface HeroStormTextures extends HeroArcanaTextures {
  /** A bolt strip's glow (a soft bell across V). */
  boltGlow: Texture;
  /** A bolt strip's body and core (solid across the middle). */
  boltCore: Texture;
  /** Two storm-cloud billows. */
  puff: Texture;
  puff2: Texture;
}

export interface StormColors { core: number; bolt: number; violet: number; cloud: number; side: number }

export interface StormLook {
  /** A bolt's body width, px at stage scale 1 (the look's width multiplies it). */
  width: number;
  /** The glow's width as a multiple of the body. */
  glow: number;
  /** How often a bolt's jag is regenerated (ms). */
  regenMs: number;
  /** How long a bolt takes to fade out. */
  fadeMs: number;
}

/** Hard cap on sprites alive at once (a Big strike peaks around 120). */
export const MAX_STORM_SPRITES = 500;
/** Hard cap on strips alive at once. */
export const MAX_STORM_MESHES = 64;
/** Points along a bolt (48 vertices) and along a small arc (fork, static; 20 vertices). */
export const BOLT_POINTS = 24;
export const ARC_POINTS = 10;

type LayerId = 'haze' | 'glow' | 'core';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [['haze', 'normal'], ['glow', 'add'], ['core', 'add']];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;

interface Strip { mesh: MeshSimple; v: Float32Array; layer: LayerId; n: number }

/** A small jagged arc (a fork, a crawl of static, the crackle round the hero, a flicker inside the cloud). */
interface Arc {
  glow: Strip | null; core: Strip | null;
  ax: number; ay: number; bx: number; by: number;
  on: boolean;
  width: number;
  alpha: number;
  /** A fork: the bolt point it leaves from. */
  j: number;
  /** A crawl's flicker for this regeneration. */
  flick: number;
}

interface Bolt {
  kind: BoltKind;
  age: number;
  leaderMs: number; holdMs: number; fadeMs: number;
  width: number; jag: number;
  /** The base curve (x, y per point) and its unit normals. */
  bx: Float32Array; by: Float32Array; nx: Float32Array; ny: Float32Array;
  off: Float32Array;
  len: number;
  regen: number;
  flick: number;
  glow: Strip | null; body: Strip | null; core: Strip | null;
  forks: Arc[];
  tint: number;
}

interface Crawl { x: number; y: number; r: number; age: number; dur: number; arcs: Arc[]; regen: number; follow: boolean; tint: number }

type AlphaMode = 'out' | 'punch';
interface Fx { s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number; follow: boolean; x: number; y: number }

interface Particle { s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number; size: number }

interface Puff { s: Sprite; hx: number; hy: number; ox: number; oy: number; size: number; delay: number; ph: number; dark: boolean }
interface Cloud {
  x: number; y: number; r: number; age: number; gatherMs: number;
  puffs: Puff[]; lights: Sprite[];
  flash: number;
  /** Ms into the break-up after the strike (-1 = not yet). */
  breaking: number;
  arc: Arc | null; arcLife: number;
}

export class HeroStormScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private readonly freeMeshes = new Map<string, MeshSimple[]>();
  private readonly uvs = new Map<number, Float32Array>();
  private readonly idx = new Map<number, Uint32Array>();
  private used = 0;
  private meshes = 0;
  private bolts: Bolt[] = [];
  private crawls: Crawl[] = [];
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private cloud: Cloud | null = null;
  private screen: { s: Sprite; age: number; a0: number } | null = null;
  private heroGlow: { s: Sprite; age: number; dur: number } | null = null;
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private destroyed = false;
  private fox = 0;
  private foy = 0;
  private viewW = 1920;
  private viewH = 1080;
  private readonly rnd: () => number;

  constructor(private readonly tex: HeroStormTextures, private readonly colors: StormColors, private readonly look: StormLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroStorm';
    this.layers = {} as Record<LayerId, Container>;
    this.freeSprites = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `storm-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.freeSprites[id] = [];
    }
    this.rnd = seededRng(seed);
    for (const n of [BOLT_POINTS, ARC_POINTS]) {
      const uv = new Float32Array(n * 4);
      for (let j = 0; j < n; j++) { const u = j / (n - 1); uv.set([u, 0, u, 1], j * 4); }
      this.uvs.set(n, uv);
      const ix = new Uint32Array((n - 1) * 6);
      for (let j = 0; j < n - 1; j++) { const a = j * 2; ix.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], j * 6); }
      this.idx.set(n, ix);
    }
    // PRE-WARM (the damage formation is still playing): every texture on the GPU before the first bolt needs it.
    const t = tex;
    for (const w of [t.glow, t.spark, t.streak, t.ring, t.star, t.boltGlow, t.boltCore, t.puff, t.puff2]) {
      const s = this.take('core', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
  }

  get liveSprites(): number { return this.used; }
  get liveMeshes(): number { return this.meshes; }
  get liveBolts(): number { return this.bolts.length; }
  get staticActive(): boolean { return this.crawls.some((c) => c.follow); }
  get cloudUp(): boolean { return this.cloud !== null; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) for (const ch of this.layers[id].children) if (ch instanceof Sprite) n++; return n; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  /** The struck portrait's knockback and jitter this frame (overlay px): the static on it rides along. */
  setFoeOffset(dx: number, dy: number): void { this.fox = Number.isFinite(dx) ? dx : 0; this.foy = Number.isFinite(dy) ? dy : 0; }

  /** The view (overlay px), measured once by the runner: the screen flash covers it. */
  setView(w: number, h: number): void { if (w > 0 && h > 0) { this.viewW = w; this.viewH = h; } }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_STORM_SPRITES) return null;
    let s = this.freeSprites[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(s: Sprite): void {
    const layer = (s.parent?.label?.replace('storm-', '') ?? 'core') as LayerId;
    s.visible = false; this.freeSprites[layer].push(s); this.used--;
  }

  private strip(layer: LayerId, t: Texture, tint: number, n: number): Strip | null {
    if (this.destroyed || this.meshes >= MAX_STORM_MESHES) return null;
    const key = `${layer}:${n}`;
    let mesh = this.freeMeshes.get(key)?.pop();
    if (!mesh) {
      mesh = new MeshSimple({ texture: t, vertices: new Float32Array(n * 4), uvs: this.uvs.get(n)!, indices: this.idx.get(n)! });
      mesh.blendMode = BLEND[layer];
      mesh.label = key;
      this.layers[layer].addChild(mesh);
    } else mesh.texture = t;
    mesh.tint = tint; mesh.alpha = 0; mesh.visible = true;
    this.meshes++;
    return { mesh, v: mesh.vertices as Float32Array, layer, n };
  }

  private giveStrip(st: Strip | null): void {
    if (!st) return;
    st.mesh.visible = false;
    const key = `${st.layer}:${st.n}`;
    const list = this.freeMeshes.get(key) ?? [];
    list.push(st.mesh);
    this.freeMeshes.set(key, list);
    this.meshes--;
  }

  private fxs(layer: LayerId, t: Texture, tint: number, x: number, y: number, o: Partial<Omit<Fx, 's' | 'age' | 'x' | 'y'>> & { dur: number; from: number; to: number; a0: number }): Fx | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.2, follow: false, x, y, ...o };
    s.position.set(x + (f.follow ? this.fox : 0), y + (f.follow ? this.foy : 0));
    s.scale.set(f.from * this.scale);
    s.alpha = f.mode === 'punch' ? 0 : f.a0;
    this.fx.push(f);
    return f;
  }

  private sparks(x: number, y: number, n: number, speed: number, o: { dir?: number; spread?: number; life?: number; size?: number; ring?: number } = {}): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const s = this.take('core', this.tex.streak, i % 3 === 0 ? this.colors.core : i % 3 === 1 ? this.colors.bolt : this.colors.violet);
      if (!s) return;
      const a = o.ring !== undefined ? (i / n) * Math.PI * 2 + (this.rnd() - 0.5) * 0.2 : o.dir === undefined ? this.rnd() * Math.PI * 2 : o.dir + (this.rnd() - 0.5) * (o.spread ?? 1.4);
      const sp = speed * (o.ring !== undefined ? 0.85 + this.rnd() * 0.3 : 0.45 + this.rnd() * 0.75) * S;
      const life = (o.life ?? 260) * (0.7 + this.rnd() * 0.6);
      const r0 = (o.ring ?? 0) * S;
      const sx = x + Math.cos(a) * r0, sy = y + Math.sin(a) * r0;
      s.position.set(sx, sy);
      this.particles.push({ s, x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.03, grav: 260 * S, life, max: life, size: (o.size ?? 0.34) * S });
    }
  }

  private newArc(width: number, tint: number): Arc {
    return {
      glow: this.strip('glow', this.tex.boltGlow, tint, ARC_POINTS), core: this.strip('core', this.tex.boltCore, this.colors.core, ARC_POINTS),
      ax: 0, ay: 0, bx: 0, by: 0, on: false, width, alpha: 0, j: 0, flick: 1,
    };
  }

  private dropArc(a: Arc): void { this.giveStrip(a.glow); this.giveStrip(a.core); a.glow = null; a.core = null; }

  /** Write a small arc from (ax, ay) to (bx, by), jagged by `jag` of its length, fresh from the generator. */
  private writeArc(a: Arc, alpha: number, jag: number, ox = 0, oy = 0): void {
    const n = ARC_POINTS;
    const dx = a.bx - a.ax, dy = a.by - a.ay;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const w = a.width * this.scale;
    const glowW = w * this.look.glow * 0.8;
    for (let j = 0; j < n; j++) {
      const f = j / (n - 1);
      const env = Math.sin(Math.PI * f);
      const o = (this.rnd() - 0.5) * 2 * jag * L * env;
      const x = a.ax + dx * f + nx * o + ox, y = a.ay + dy * f + ny * o + oy;
      const taper = 1 - 0.6 * f;
      if (a.glow) { const v = a.glow.v; v[j * 4] = x + nx * glowW * taper; v[j * 4 + 1] = y + ny * glowW * taper; v[j * 4 + 2] = x - nx * glowW * taper; v[j * 4 + 3] = y - ny * glowW * taper; }
      if (a.core) { const v = a.core.v; v[j * 4] = x + nx * w * 0.5 * taper; v[j * 4 + 1] = y + ny * w * 0.5 * taper; v[j * 4 + 2] = x - nx * w * 0.5 * taper; v[j * 4 + 3] = y - ny * w * 0.5 * taper; }
    }
    this.setArcAlpha(a, alpha);
  }

  private setArcAlpha(a: Arc, alpha: number): void {
    a.alpha = alpha;
    if (a.glow) a.glow.mesh.alpha = Math.max(0, alpha * 0.55);
    if (a.core) a.core.mesh.alpha = Math.max(0, alpha);
  }

  // ── the beats ─────────────────────────────────────────────────────────────────────────────────────────────

  /** The charge: a glow builds on the hero and static crackles round its rim. */
  startCharge(x: number, y: number, r: number, durMs: number, arcs: number): void {
    const s = this.take('glow', this.tex.glow, this.colors.side);
    if (s) { s.position.set(x, y); s.alpha = 0; this.heroGlow = { s, age: 0, dur: Math.max(60, durMs) }; }
    if (arcs > 0) this.crawl(x, y, r, durMs + 120, arcs, false, this.colors.side);
  }

  /** Static crawling over a portrait for `durMs` (`follow`: it rides the struck portrait's knockback and jitter). */
  crawl(x: number, y: number, r: number, durMs: number, arcs: number, follow = true, tint = this.colors.bolt): void {
    if (arcs <= 0 || durMs <= 0) return;
    const list: Arc[] = [];
    for (let i = 0; i < arcs; i++) list.push(this.newArc(2.2, tint));
    this.crawls.push({ x, y, r, age: 0, dur: durMs, arcs: list, regen: 55, follow, tint });
  }

  /** A bolt leaves `g.from` for `g.to`: its leader races out over `leaderMs`, it flickers for `holdMs`, then fades. */
  bolt(kind: BoltKind, g: BoltGeo, o: { leaderMs: number; holdMs: number; width: number; jag: number; forks: number; late?: number; tint?: number }): void {
    const n = BOLT_POINTS;
    const bx = new Float32Array(n), by = new Float32Array(n), nx = new Float32Array(n), ny = new Float32Array(n);
    const dx = g.to.x - g.from.x, dy = g.to.y - g.from.y;
    const L = Math.hypot(dx, dy) || 1;
    // The base curve: a quadratic bowed sideways by `bow` of the length.
    const cx = (g.from.x + g.to.x) / 2 + (-dy / L) * g.bow * L, cy = (g.from.y + g.to.y) / 2 + (dx / L) * g.bow * L;
    for (let j = 0; j < n; j++) {
      const e = j / (n - 1), m = 1 - e;
      bx[j] = m * m * g.from.x + 2 * m * e * cx + e * e * g.to.x;
      by[j] = m * m * g.from.y + 2 * m * e * cy + e * e * g.to.y;
    }
    for (let j = 0; j < n; j++) {
      const a = Math.max(0, j - 1), b = Math.min(n - 1, j + 1);
      const tx = bx[b]! - bx[a]!, ty = by[b]! - by[a]!;
      const l = Math.hypot(tx, ty) || 1;
      nx[j] = -ty / l; ny[j] = tx / l;
    }
    const tint = o.tint ?? (kind === 'call' ? this.colors.violet : this.colors.bolt);
    const bolt: Bolt = {
      kind, age: Math.max(0, o.late ?? 0), leaderMs: Math.max(1, o.leaderMs), holdMs: Math.max(0, o.holdMs), fadeMs: this.look.fadeMs,
      width: o.width, jag: o.jag, bx, by, nx, ny, off: new Float32Array(n), len: L, regen: 0, flick: 1,
      glow: this.strip('glow', this.tex.boltGlow, tint, n), body: this.strip('core', this.tex.boltCore, tint, n), core: this.strip('core', this.tex.boltCore, this.colors.core, n),
      forks: [], tint,
    };
    for (let i = 0; i < Math.max(0, Math.round(o.forks)); i++) bolt.forks.push(this.newArc(o.width * 2.4, tint));
    this.regenBolt(bolt);
    this.bolts.push(bolt);
  }

  /** A strike that is only a tick (Medium's first branch): a zap flash and a few sparks. FX only. */
  zap(x: number, y: number, radius: number, sparks: number): void {
    const d = (radius * 2) / 128 / this.scale;
    this.fxs('core', this.tex.glow, this.colors.core, x, y, { dur: 170, from: d * 0.25, to: d * 0.55, a0: 0.85, follow: true });
    this.fxs('glow', this.tex.ring, this.colors.bolt, x, y, { dur: 240, from: 0.12, to: 0.45, a0: 0.6, follow: true });
    this.sparks(x, y, Math.round(sparks * 0.5), 560, { life: 220 });
  }

  /** THE impact: a hot flash, a ring and a burst of sparks; Big adds a ring of sparks, a shock ring and a screen flash. */
  strike(x: number, y: number, radius: number, o: { level: number; burst: number; sparks: number; flashAlpha: number; screen: number }): void {
    const d = (radius * 2) / 128 / this.scale;
    this.fxs('core', this.tex.glow, this.colors.core, x, y, { dur: 240, from: d * 0.35, to: d * 0.8 * o.burst, a0: o.flashAlpha, follow: true });
    this.fxs('glow', this.tex.glow, this.colors.bolt, x, y, { dur: 380, from: d * 0.5, to: d * 1.1 * o.burst, a0: 0.5, mode: 'punch', peakAt: 0.12, follow: true });
    this.fxs('glow', this.tex.ring, this.colors.bolt, x, y, { dur: 320, from: 0.15, to: 0.7 * o.burst, a0: 0.8, follow: true });
    this.sparks(x, y, o.sparks, 700, { life: 300 });
    if (o.level >= 2) this.fxs('glow', this.tex.ring, this.colors.violet, x, y, { dur: 440, from: 0.2, to: 1.0 * o.burst, a0: 0.5, follow: true });
    if (o.level >= 3) {
      this.sparks(x, y, Math.round(o.sparks * 0.75), 780, { ring: radius * 0.45 / this.scale, life: 340, size: 0.42 });
      this.fxs('glow', this.tex.ring, this.colors.core, x, y, { dur: 520, from: 0.3, to: 1.9 * o.burst, a0: 0.6 });
      for (let i = 0; i < 5; i++) {
        const a = this.rnd() * Math.PI * 2, rr = radius * (0.4 + this.rnd() * 0.9);
        const f = this.fxs('core', this.tex.star, this.colors.core, x + Math.cos(a) * rr, y + Math.sin(a) * rr, { dur: 260 + this.rnd() * 200, from: 0.05, to: 0.3, a0: 0.9, mode: 'punch', peakAt: 0.3 });
        if (f) f.s.rotation = this.rnd() * Math.PI;
      }
      if (o.screen > 0) {
        const s = this.take('core', Texture.WHITE, 0xdcecff);
        if (s) {
          // The flash covers the whole view in the overlay's own px (the root's camera is undone so it never slides).
          s.anchor.set(0);
          this.screen = { s, age: 0, a0: o.screen };
        }
      }
      const cl = this.cloud;
      if (cl) { cl.flash = 1; cl.breaking = 0; }
    }
  }

  /** Big: the storm cloud gathers over (x, y), its billows sliding in from the sides over `gatherMs`. */
  gather(x: number, y: number, r: number, gatherMs: number): void {
    if (this.cloud) return;
    const puffs: Puff[] = [];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const dark = i % 3 === 1;
      const hx = (f - 0.5) * 2 * r * 0.78 + (this.rnd() - 0.5) * r * 0.12;
      const hy = (dark ? r * 0.16 : -r * 0.1 * Math.sin(Math.PI * f) * 1.4) + (this.rnd() - 0.5) * r * 0.08;
      const s = this.take('haze', i % 2 ? this.tex.puff2 : this.tex.puff, dark ? mixColor(this.colors.cloud, 0x000000, 0.35) : this.colors.cloud);
      if (!s) break;
      s.alpha = 0;
      puffs.push({ s, hx, hy, ox: hx * 1.9, oy: hy * 1.5 - r * 0.25, size: (0.8 + this.rnd() * 0.45) * (1 - 0.35 * Math.abs(f - 0.5)), delay: this.rnd() * gatherMs * 0.3, ph: this.rnd() * 6, dark });
    }
    const lights: Sprite[] = [];
    for (let i = 0; i < 3; i++) { const s = this.take('glow', this.tex.glow, this.colors.bolt); if (s) { s.alpha = 0; lights.push(s); } }
    this.cloud = { x, y, r, age: 0, gatherMs: Math.max(1, gatherMs), puffs, lights, flash: 0, breaking: -1, arc: null, arcLife: 0 };
  }

  /** Big: the cloud rumbles: it lights up from inside and a small arc flickers across it. */
  rumble(): void {
    const cl = this.cloud;
    if (!cl) return;
    cl.flash = 0.85;
    if (!cl.arc) cl.arc = this.newArc(2.4, this.colors.bolt);
    const a = cl.arc;
    a.ax = cl.x - cl.r * (0.2 + this.rnd() * 0.4); a.ay = cl.y + (this.rnd() - 0.2) * cl.r * 0.2;
    a.bx = cl.x + cl.r * (0.2 + this.rnd() * 0.4); a.by = cl.y + (this.rnd() - 0.2) * cl.r * 0.2;
    cl.arcLife = 150;
    this.writeArc(a, 1, 0.3);
  }

  // ── the frame ─────────────────────────────────────────────────────────────────────────────────────────────

  private regenBolt(b: Bolt): void {
    const n = BOLT_POINTS;
    const amp = b.jag * b.len;
    // Two octaves: a coarse wander (every 4th point, eased between) and a fine crackle, pinned at both ends.
    const coarse: number[] = [];
    for (let k = 0; k <= Math.ceil((n - 1) / 4); k++) coarse.push((this.rnd() - 0.5) * 2);
    for (let j = 0; j < n; j++) {
      const f = j / (n - 1);
      const env = Math.pow(Math.sin(Math.PI * f), 0.6);
      const kf = j / 4, k0 = Math.floor(kf), t = kf - k0;
      const c = coarse[k0]! + (coarse[Math.min(coarse.length - 1, k0 + 1)]! - coarse[k0]!) * (t * t * (3 - 2 * t));
      b.off[j] = (c * 0.75 + (this.rnd() - 0.5) * 0.5) * amp * env;
    }
    b.flick = 0.72 + 0.28 * this.rnd();
    // Re-pick the side forks: off the middle of the bolt, angled forward and away from it (drawn once per regeneration).
    for (const a of b.forks) {
      const j = Math.floor((0.2 + this.rnd() * 0.6) * (n - 1));
      const side = this.rnd() < 0.5 ? -1 : 1;
      const nx = b.nx[j]!, ny = b.ny[j]!;
      const ang = 0.45 + this.rnd() * 0.5;
      const L = b.len * (0.08 + this.rnd() * 0.1);
      a.ax = b.bx[j]! + nx * b.off[j]!; a.ay = b.by[j]! + ny * b.off[j]!;
      // Along the bolt is (ny, -nx); the side is the normal.
      a.bx = a.ax + (ny * Math.cos(ang) + nx * side * Math.sin(ang)) * L;
      a.by = a.ay + (-nx * Math.cos(ang) + ny * side * Math.sin(ang)) * L;
      a.on = this.rnd() < 0.8;
      a.j = j;
      this.writeArc(a, 0, 0.2);
    }
  }

  private writeBolt(b: Bolt): void {
    const n = BOLT_POINTS;
    const lead = clamp01(b.age / b.leaderMs);
    const head = lead * (n - 1);
    const hi = Math.floor(head), hf = head - hi;
    const since = b.age - b.leaderMs;
    const fade = since <= b.holdMs ? 1 : 1 - clamp01((since - b.holdMs) / b.fadeMs);
    // Just landed: a hot restrike (brighter, fuller), then the flicker.
    const hot = since >= 0 && since < 70 ? 1.25 : 1;
    const alpha = (lead < 1 ? 1 : since < 70 ? 1 : b.flick) * fade;
    const w = b.width * this.look.width * this.scale;
    const hx = (j: number): number => b.bx[j]! + b.nx[j]! * b.off[j]!;
    const hy = (j: number): number => b.by[j]! + b.ny[j]! * b.off[j]!;
    const headX = hi >= n - 1 ? hx(n - 1) : hx(hi) + (hx(hi + 1) - hx(hi)) * hf;
    const headY = hi >= n - 1 ? hy(n - 1) : hy(hi) + (hy(hi + 1) - hy(hi)) * hf;
    const strips: [Strip | null, number][] = [[b.glow, this.look.glow], [b.body, 1], [b.core, 0.38]];
    for (const [st, mult] of strips) {
      if (!st) continue;
      const v = st.v;
      for (let j = 0; j < n; j++) {
        const f = j / (n - 1);
        const past = j > head;
        const x = past ? headX : hx(j), y = past ? headY : hy(j);
        const taper = (0.65 + 0.35 * Math.sin(Math.PI * Math.min(1, f * 1.1 + 0.05))) * (past ? 0 : 1);
        const h = w * 0.5 * mult * taper * (mult < 1 ? 1 : hot);
        v[j * 4] = x + b.nx[j]! * h; v[j * 4 + 1] = y + b.ny[j]! * h;
        v[j * 4 + 2] = x - b.nx[j]! * h; v[j * 4 + 3] = y - b.ny[j]! * h;
      }
    }
    if (b.glow) b.glow.mesh.alpha = 0.8 * alpha;
    if (b.body) b.body.mesh.alpha = 0.85 * alpha;
    if (b.core) b.core.mesh.alpha = Math.min(1, alpha * hot);
    for (const a of b.forks) this.setArcAlpha(a, a.on && a.j <= head ? alpha * 0.75 : 0);
  }

  /** Advance everything by `dt` ms. Returns whether anything still draws. */
  update(dt: number): boolean {
    if (this.destroyed) return false;
    const S = this.scale;
    const sec = dt / 1000;
    if (this.warmLeft > 0) {
      this.warmLeft -= dt;
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; }
    }

    const hg = this.heroGlow;
    if (hg) {
      hg.age += dt;
      const u = clamp01(hg.age / hg.dur);
      const out = clamp01((hg.age - hg.dur) / 200);
      hg.s.scale.set((0.8 + 0.8 * u) * S * (1 + 0.06 * Math.sin(hg.age * 0.05)));
      hg.s.alpha = 0.45 * u * (1 - out);
      if (out >= 1) { this.give(hg.s); this.heroGlow = null; }
    }

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!;
      b.age += dt;
      b.regen += dt;
      if (b.regen >= this.look.regenMs) { b.regen = 0; this.regenBolt(b); }
      if (b.age >= b.leaderMs + b.holdMs + b.fadeMs) {
        this.giveStrip(b.glow); this.giveStrip(b.body); this.giveStrip(b.core);
        for (const a of b.forks) this.dropArc(a);
        this.bolts.splice(i, 1);
        continue;
      }
      this.writeBolt(b);
    }

    for (let i = this.crawls.length - 1; i >= 0; i--) {
      const c = this.crawls[i]!;
      c.age += dt;
      c.regen += dt;
      if (c.age >= c.dur) { for (const a of c.arcs) this.dropArc(a); this.crawls.splice(i, 1); continue; }
      const env = Math.min(1, c.age / 60) * (1 - clamp01((c.age - c.dur * 0.6) / (c.dur * 0.4)));
      const ox = c.follow ? this.fox : 0, oy = c.follow ? this.foy : 0;
      if (c.regen >= 55) {
        c.regen = 0;
        for (const a of c.arcs) {
          // A crawl across the face: from a point near the rim, inward and across.
          const th = this.rnd() * Math.PI * 2;
          const r0 = c.r * (0.55 + this.rnd() * 0.35);
          a.ax = c.x + Math.cos(th) * r0; a.ay = c.y + Math.sin(th) * r0;
          const th2 = th + Math.PI + (this.rnd() - 0.5) * 1.8;
          const len = c.r * (0.3 + this.rnd() * 0.45);
          a.bx = a.ax + Math.cos(th2) * len; a.by = a.ay + Math.sin(th2) * len;
          a.on = this.rnd() < 0.8;
          a.flick = 0.65 + 0.35 * this.rnd();
          // The geometry is drawn once per regeneration (a crackle, not a per-frame shimmer), where the portrait is now.
          this.writeArc(a, 0, 0.28, ox, oy);
        }
      }
      for (const a of c.arcs) this.setArcAlpha(a, a.on ? env * a.flick : 0);
    }

    const cl = this.cloud;
    if (cl) {
      cl.age += dt;
      cl.flash = Math.max(0, cl.flash - dt / 200);
      const brk = cl.breaking >= 0 ? (cl.breaking += dt) : -1;
      const bu = brk >= 0 ? clamp01(brk / 700) : 0;
      const pscale = (cl.r * 0.95) / 128;
      for (const p of cl.puffs) {
        const u = easeOutCubic(clamp01((cl.age - p.delay) / (cl.gatherMs * 0.7)));
        const bob = Math.sin(cl.age * 0.004 + p.ph) * cl.r * 0.02;
        const x = cl.x + p.ox + (p.hx - p.ox) * u + p.hx * 0.5 * bu;
        const y = cl.y + p.oy + (p.hy - p.oy) * u + bob - cl.r * 0.2 * bu;
        p.s.position.set(x, y);
        p.s.scale.set(pscale * p.size * (0.55 + 0.45 * u) * (1 + 0.25 * bu), pscale * p.size * 0.8 * (0.55 + 0.45 * u) * (1 + 0.25 * bu));
        p.s.alpha = 0.95 * u * (1 - bu);
        const base = p.dark ? mixColor(this.colors.cloud, 0x000000, 0.35) : this.colors.cloud;
        p.s.tint = cl.flash > 0 ? mixColor(base, 0xcfe4ff, 0.55 * cl.flash) : base;
      }
      cl.lights.forEach((s, i) => {
        const p = cl.puffs[(i * 3 + 1) % Math.max(1, cl.puffs.length)];
        if (p) s.position.set(p.s.x, p.s.y);
        s.scale.set((cl.r * 1.1) / 128 * (0.9 + 0.2 * i));
        s.alpha = (0.1 * clamp01(cl.age / cl.gatherMs) + 0.75 * cl.flash) * (1 - bu);
      });
      if (cl.arc) {
        cl.arcLife -= dt;
        this.setArcAlpha(cl.arc, cl.arcLife > 0 ? clamp01(cl.arcLife / 80) : 0);
      }
      if (bu >= 1) {
        for (const p of cl.puffs) this.give(p.s);
        for (const s of cl.lights) this.give(s);
        if (cl.arc) this.dropArc(cl.arc);
        this.cloud = null;
      }
    }

    const sc = this.screen;
    if (sc) {
      sc.age += dt;
      const u = clamp01(sc.age / 220);
      // Undo the root's camera so the flash always covers exactly the view.
      const z = this.root.scale.x || 1;
      sc.s.position.set(-this.root.position.x / z, -this.root.position.y / z);
      sc.s.scale.set(this.viewW / z, this.viewH / z);
      sc.s.alpha = sc.a0 * (1 - u) * (1 - u);
      if (u >= 1) { this.give(sc.s); this.screen = null; }
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      q.s.scale.set((q.from + (q.to - q.from) * easeOutQuint(u)) * S);
      q.s.position.set(q.x + (q.follow ? this.fox : 0), q.y + (q.follow ? this.foy : 0));
      q.s.alpha = q.mode === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.a0 * (1 - u) * (1 - u * 0.3);
      if (u >= 1) { this.give(q.s); this.fx.splice(i, 1); }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) { this.give(p.s); this.particles.splice(i, 1); continue; }
      const damp = Math.pow(p.drag, sec);
      p.vx *= damp; p.vy = p.vy * damp + p.grav * sec;
      p.x += p.vx * sec; p.y += p.vy * sec;
      const t = 1 - p.life / p.max;
      const v = Math.hypot(p.vx, p.vy);
      p.s.position.set(p.x, p.y);
      p.s.rotation = Math.atan2(p.vy, p.vx);
      p.s.scale.set(p.size * (0.6 + Math.min(1.8, v / (700 * S))), p.size * 0.45);
      p.s.alpha = 1 - t;
    }

    return this.used > this.warm.length || this.meshes > 0;
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const b of this.bolts) { this.giveStrip(b.glow); this.giveStrip(b.body); this.giveStrip(b.core); for (const a of b.forks) this.dropArc(a); }
    for (const c of this.crawls) for (const a of c.arcs) this.dropArc(a);
    for (const q of this.fx) this.give(q.s);
    for (const p of this.particles) this.give(p.s);
    for (const s of this.warm) this.give(s);
    if (this.cloud) { for (const p of this.cloud.puffs) this.give(p.s); for (const s of this.cloud.lights) this.give(s); if (this.cloud.arc) this.dropArc(this.cloud.arc); }
    if (this.screen) this.give(this.screen.s);
    if (this.heroGlow) this.give(this.heroGlow.s);
    this.bolts = []; this.crawls = []; this.fx = []; this.particles = []; this.warm = []; this.cloud = null; this.screen = null; this.heroGlow = null;
  }

  /** Tear down: every sprite and strip destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const [id] of LAYERS) {
      this.freeSprites[id].length = 0;
      this.layers[id].removeChildren().forEach((c) => c.destroy());
    }
    this.freeMeshes.clear();
    this.root.removeChildren().forEach((c) => c.destroy());
    this.root.destroy();
  }
}

export type { Pt };
