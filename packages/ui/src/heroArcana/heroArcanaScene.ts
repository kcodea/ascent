/**
 * THE ARCANA SCENE: everything the Arcana hero attack draws in Pixi, as a plain scene graph with no renderer, so it
 * runs (and is tested) headless. `heroArcana.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * Design rule (owner bar 2026-09-28: "clean", "thicker and cleaner", Blizzard polish): the RIBBON is the whole show,
 * so it is one bold, smooth, readable stroke, never particle soup. Each ribbon is FIVE triangle-strip meshes sharing
 * one centreline: a soft violet halo (normal blend: the arcane glow still reads on a LIGHT board, where additive light
 * vanishes), a wide additive glow (it blooms on dark ground), a
 * violet body, a white-hot core, and one thin cyan strand winding round it. It tapers from a rounded head to a point,
 * and TWISTS as it flies (its width breathes along its length, like a flat ribbon turning to show its edge). An orb, a
 * spinning sigil and a star flare ride its head; a few glitter motes fall off it.
 *
 * THE TRAIL IS TIME, NOT HISTORY. A ribbon's centreline is its motion (`ribbonPos`, pure) sampled BACK IN TIME at
 * fixed steps, so it is perfectly smooth at any frame rate, identical in a replay, and needs no per-frame buffer: the
 * lob, the vortex and the converge all trail correctly for free, and a faster ribbon draws a longer streak.
 *
 * LAYERS, bottom to top: shade (normal) | ground sigils, glow strips (additive) | body strips (NORMAL: a solid, vivid
 * violet that keeps its colour on a light board, where additive light would wash to white) | core strips, air
 * (additive), so the whole scene batches in four runs. The vertex arrays are rewritten in place (no allocation per strip per frame);
 * every mesh is `RIBBON_POINTS` x 2 = 48 vertices, under Pixi's 100-vertex batching limit.
 *
 * Contract: sprites and strip meshes are POOLED per layer (hidden and reused) and bounded by `MAX_ARCANA_SPRITES` /
 * `MAX_ARCANA_MESHES`; textures are the caller's; positions are the overlay's px; `setCamera` mirrors the DOM camera;
 * `update` returns whether anything still draws; `destroy()` leaves nothing behind. Scatter is seeded (a replay throws
 * the same sparks).
 */
import { Container, MeshSimple, Sprite, type Texture } from 'pixi.js';
import type { HeroBlastTextures } from '../heroBlast/heroBlastScene';
import { clamp01, easeInOutSine, easeOutCubic, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';
import { ribbonPos, type RibbonMotion } from './heroArcanaConfig';

export interface HeroArcanaTextures extends HeroBlastTextures {
  /** A ribbon's glow (a wide soft bell across it; the tail fades in along U). */
  ribbonSoft: Texture;
  /** A ribbon's body and core (solid across the middle, feathered edges; the tail fades in along U). */
  ribbonBody: Texture;
  /** The arcane circle. */
  sigil: Texture;
  /** A four-point glitter star. */
  star: Texture;
}

export interface ArcanaColors { core: number; accent: number; side: number; shade: number }

export interface RibbonLook {
  /** Trail length (ms of flight it spans). */
  lengthMs: number;
  /** Glow width as a multiple of the body. */
  glow: number;
  /** Core width as a fraction of the body. */
  core: number;
  /** The soft violet halo's opacity (0 = none). */
  shade: number;
  /** How far the width breathes as it twists (0 = a plain taper). */
  twist: number;
  /** The winding cyan strand's reach, as a fraction of the width (0 = none). */
  strand: number;
  headSize: number;
  sigilSize: number;
}

/** Hard cap on sprites alive at once (a Tier IV explosion peaks around 400). */
export const MAX_ARCANA_SPRITES = 900;
/** Hard cap on strip meshes alive at once (five per ribbon, three per blast streak). */
export const MAX_ARCANA_MESHES = 140;
/** Points along each ribbon: 48 vertices per strip, so every strip still batches. */
export const RIBBON_POINTS = 24;

type LayerId = 'shade' | 'under' | 'glow' | 'body' | 'core' | 'air';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [
  ['shade', 'normal'], ['under', 'add'], ['glow', 'add'], ['body', 'normal'], ['core', 'add'], ['air', 'add'],
];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
const SIGIL_PX = 160;
const GLOW_PX = 128;

interface Strip { mesh: MeshSimple; v: Float32Array; layer: LayerId }

type Path = (t: number) => Pt;

interface Ribbon {
  at: Path;
  /** Ms after launch: the lob ends (-1 = never: a blast streak) and the ribbon starts fading or joins the vortex. */
  landAt: number;
  /** Ms after launch at which the ribbon is gone. */
  endAt: number;
  /** Fade window before `endAt`. */
  fadeMs: number;
  age: number;
  width: number;
  trailMs: number;
  /** Tier IV: the vortex it rides (for the depth dim and the trail length); null = a lob or a blast streak. */
  ring: { cx: number; cy: number; r: number; tilt: number; start: number; end: number; w0: number; w1: number } | null;
  shade: Strip | null; glow: Strip; body: Strip; core: Strip; strand: Strip | null;
  head: { halo: Sprite; orb: Sprite; sigil: Sprite; flare: Sprite } | null;
  phase: number;
  alpha: number;
  lastX: number; lastY: number; moteAcc: number;
  /** A blast streak's width thins to this fraction at its end. */
  thin: number;
}

type AlphaMode = 'out' | 'punch' | 'hold';
interface Fx {
  s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number;
  /** y scale as a fraction of x (1 = round). */
  sy: number; spin: number; delay: number;
}

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  from: number; to: number; alpha: number; twinkle: number; spin: number; streak: boolean;
}

interface Charge { sigil: Sprite; ring: Sprite; core: Sprite; bloom: Sprite; x: number; y: number; r: number; age: number; dur: number; k: number; left: number; releasing: number; moteAcc: number; motes: number }

interface VortexFx {
  sigil: Sprite; inner: Sprite; track: Sprite; core: Sprite; bloom: Sprite;
  x: number; y: number; r0: number; r1: number; tilt: number; age: number; dur: number; conv: number; dir: number; converging: number; moteAcc: number;
}

export class HeroArcanaScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private readonly freeMeshes: Record<LayerId, MeshSimple[]>;
  private used = 0;
  private meshes = 0;
  private ribbons: Ribbon[] = [];
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private charge: Charge | null = null;
  private vortex: VortexFx | null = null;
  private destroyed = false;
  private readonly hot: number;
  private readonly body: number;
  private readonly rnd: () => number;
  private readonly uvs: Float32Array;
  private readonly idx: Uint32Array;
  // scratch (the centreline and its normals, reused by every ribbon every frame)
  private readonly px = new Float32Array(RIBBON_POINTS);
  private readonly py = new Float32Array(RIBBON_POINTS);
  private readonly nx = new Float32Array(RIBBON_POINTS);
  private readonly ny = new Float32Array(RIBBON_POINTS);
  private readonly hw = new Float32Array(RIBBON_POINTS);

  constructor(private readonly tex: HeroArcanaTextures, private readonly colors: ArcanaColors, private readonly look: RibbonLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroArcana';
    this.layers = {} as Record<LayerId, Container>;
    this.freeSprites = {} as Record<LayerId, Sprite[]>;
    this.freeMeshes = {} as Record<LayerId, MeshSimple[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `arcana-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.freeSprites[id] = [];
      this.freeMeshes[id] = [];
    }
    this.hot = whiten(colors.side, 0.5);
    this.body = mixColor(whiten(colors.side, 0.1), colors.accent, 0.06);
    this.rnd = seededRng(seed);
    const n = RIBBON_POINTS;
    this.uvs = new Float32Array(n * 4);
    for (let j = 0; j < n; j++) {
      const u = 1 - j / (n - 1); // the head is u = 1 (full), the tail u = 0 (faded in by the texture)
      this.uvs[j * 4] = u; this.uvs[j * 4 + 1] = 0; this.uvs[j * 4 + 2] = u; this.uvs[j * 4 + 3] = 1;
    }
    this.idx = new Uint32Array((n - 1) * 6);
    for (let j = 0; j < n - 1; j++) { const a = j * 2; this.idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], j * 6); }
  }

  get liveSprites(): number { return this.used; }
  get liveMeshes(): number { return this.meshes; }
  get liveRibbons(): number { return this.ribbons.length; }
  get charging(): boolean { return this.charge !== null; }
  get swirling(): boolean { return this.vortex !== null; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) for (const ch of this.layers[id].children) if (ch instanceof Sprite) n++; return n; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_ARCANA_SPRITES) return null;
    let s = this.freeSprites[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(layer: LayerId, s: Sprite): void { s.visible = false; this.freeSprites[layer].push(s); this.used--; }
  private layerOf(s: Sprite): LayerId { return (s.parent?.label?.replace('arcana-', '') ?? 'air') as LayerId; }
  private giveS(s: Sprite): void { this.give(this.layerOf(s), s); }

  private strip(layer: LayerId, t: Texture, tint: number): Strip | null {
    if (this.destroyed || this.meshes >= MAX_ARCANA_MESHES) return null;
    let mesh = this.freeMeshes[layer].pop();
    if (!mesh) {
      mesh = new MeshSimple({ texture: t, vertices: new Float32Array(RIBBON_POINTS * 4), uvs: this.uvs, indices: this.idx });
      mesh.blendMode = BLEND[layer];
      this.layers[layer].addChild(mesh);
    } else mesh.texture = t;
    mesh.tint = tint; mesh.alpha = 0; mesh.visible = true;
    this.meshes++;
    return { mesh, v: mesh.vertices as Float32Array, layer };
  }

  private giveStrip(st: Strip | null): void {
    if (!st) return;
    st.mesh.visible = false;
    this.freeMeshes[st.layer].push(st.mesh);
    this.meshes--;
  }

  private fxs(layer: LayerId, t: Texture, tint: number, x: number, y: number, o: Partial<Omit<Fx, 's' | 'age'>> & { dur: number; from: number; to: number; a0: number }): Sprite | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.2, sy: 1, spin: 0, delay: 0, ...o };
    s.position.set(x, y); s.rotation = this.rnd() * Math.PI * 2 * (t === this.tex.sigil ? 1 : 0);
    s.scale.set(f.from * this.scale, f.from * this.scale * f.sy);
    s.alpha = f.mode === 'punch' || f.delay > 0 ? 0 : f.a0;
    this.fx.push(f);
    return s;
  }

  private particle(t: Texture, tint: number, o: Omit<Particle, 's' | 'max'>): void {
    const s = this.take('air', t, tint);
    if (!s) return;
    s.position.set(o.x, o.y);
    s.rotation = this.rnd() * Math.PI;
    this.particles.push({ ...o, s, max: o.life });
  }

  /** A burst of glitter stars from a point. */
  private glitter(x: number, y: number, n: number, speed: number, o: { dir?: number; spread?: number; lift?: number; life?: number; size?: number; grav?: number } = {}): void {
    const S = this.scale;
    const tints = [this.colors.core, this.colors.accent, this.hot];
    for (let i = 0; i < n; i++) {
      const a = o.dir === undefined ? this.rnd() * Math.PI * 2 : o.dir + (this.rnd() - 0.5) * (o.spread ?? 1.4);
      const sp = speed * (0.45 + this.rnd() * 0.75) * S;
      const sz = (o.size ?? 0.5) * (0.6 + this.rnd() * 0.7);
      this.particle(this.tex.star, tints[i % 3]!, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.lift ?? 0) * S, drag: 0.03, grav: (o.grav ?? 120) * S,
        life: (o.life ?? 520) * (0.7 + this.rnd() * 0.6), from: sz * S, to: sz * 0.2 * S, alpha: 1,
        twinkle: 0.02 + this.rnd() * 0.02, spin: (this.rnd() - 0.5) * 0.01, streak: false,
      });
    }
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The hero gathers: an arcane circle opens under the portrait and spins up, a ring closes in, the core swells, motes
   * spiral in. Held through the volley; released as the LAST ribbon leaves (`launches` counts them down).
   */
  startCharge(x: number, y: number, radius: number, durMs: number, k: number, launches: number, motes: number): void {
    if (this.charge) return;
    const sigil = this.take('under', this.tex.sigil, whiten(this.colors.side, 0.2));
    const ring = this.take('air', this.tex.ring, this.colors.accent);
    const bloom = this.take('air', this.tex.glow, this.colors.side);
    const core = this.take('air', this.tex.glow, this.colors.core);
    if (!sigil || !ring || !bloom || !core) { for (const s of [sigil, ring, bloom, core]) if (s) this.giveS(s); return; }
    for (const s of [sigil, ring, bloom, core]) { s.position.set(x, y); s.alpha = 0; }
    this.charge = { sigil, ring, core, bloom, x, y, r: radius, age: 0, dur: Math.max(1, durMs), k, left: Math.max(1, launches), releasing: -1, moteAcc: 0, motes };
  }

  /** A ribbon leaves the hero along `motion`, with a flare, a snap ring and a spray of glitter. `age0` = ms elapsed. */
  fire(motion: RibbonMotion, width: number, size: number, age0 = 0, ring: Ribbon['ring'] = null): void {
    const ch = this.charge;
    if (ch && ch.releasing < 0 && --ch.left <= 0) ch.releasing = 0;
    const a = motion.lob.a;
    const S = this.scale;
    const dir = Math.atan2(motion.lob.c1.y - a.y, motion.lob.c1.x - a.x);
    this.fxs('air', this.tex.glow, this.colors.core, a.x, a.y, { dur: 170, from: 0.6, to: 1.7 * size, a0: 0.9 });
    this.fxs('air', this.tex.glow, this.colors.side, a.x, a.y, { dur: 300, from: 0.8, to: 2.6 * size, a0: 0.6, mode: 'punch', peakAt: 0.12 });
    this.fxs('air', this.tex.ring, this.colors.accent, a.x, a.y, { dur: 260, from: 0.35, to: 1.6 * size, a0: 0.9 });
    this.glitter(a.x + Math.cos(dir) * 30 * S, a.y + Math.sin(dir) * 30 * S, 6, 520, { dir, spread: 1.1, life: 320, size: 0.45, grav: 0 });
    this.addRibbon((t) => ribbonPos(motion, t), motion.flightMs, width * size, this.look.lengthMs, age0, ring, true, 1);
  }

  private addRibbon(at: Path, landAt: number, width: number, trailMs: number, age0: number, ring: Ribbon['ring'], head: boolean, thin: number, endAt?: number, fadeMs?: number): void {
    const L = this.look;
    const S = this.scale;
    const shade = L.shade > 0 ? this.strip('shade', this.tex.ribbonSoft, this.colors.shade) : null;
    const glow = this.strip('glow', this.tex.ribbonSoft, this.colors.side);
    const body = this.strip('body', this.tex.ribbonBody, this.body);
    const core = this.strip('core', this.tex.ribbonBody, this.colors.core);
    const strand = L.strand > 0 && head ? this.strip('core', this.tex.ribbonBody, this.colors.accent) : null;
    if (!glow || !body || !core) { for (const s of [shade, glow, body, core, strand]) this.giveStrip(s); return; }
    let hd: Ribbon['head'] = null;
    if (head) {
      const halo = this.take('air', this.tex.glow, this.colors.side);
      const orb = this.take('air', this.tex.glow, this.colors.core);
      const sigil = this.take('air', this.tex.sigil, whiten(this.colors.accent, 0.35));
      const flare = this.take('air', this.tex.star, this.colors.core);
      if (halo && orb && sigil && flare) { hd = { halo, orb, sigil, flare }; for (const s of [halo, orb, sigil, flare]) s.alpha = 0; } else for (const s of [halo, orb, sigil, flare]) if (s) this.giveS(s);
    }
    const p0 = at(Math.max(0, age0));
    this.ribbons.push({
      at, landAt, endAt: endAt ?? (ring ? Number.POSITIVE_INFINITY : landAt + trailMs), fadeMs: fadeMs ?? trailMs, age: Math.max(0, age0),
      width: width * S, trailMs, ring, shade, glow, body, core, strand, head: hd, phase: this.rnd() * Math.PI * 2, alpha: 1,
      lastX: p0.x, lastY: p0.y, moteAcc: 0, thin,
    });
  }

  /** A barrage ribbon (not the last) lands: a sigil flash, a crisp ring, a flash, glitter. `step` grows each tick. */
  hit(x: number, y: number, dir: Pt, size: number, step: number): void {
    const g = size * (1 + 0.1 * step);
    const head = Math.atan2(dir.y, dir.x);
    // A tick is LINE WORK (a sigil flash and a ring) over a small, quick flash: several stack in a few hundred ms, and
    // the big fill is saved for the impact.
    this.fxs('air', this.tex.glow, this.colors.core, x, y, { dur: 120, from: 0.8, to: 1.6 * g, a0: 0.55 });
    this.fxs('air', this.tex.glow, this.colors.side, x, y, { dur: 300, from: 1, to: 2.4 * g, a0: 0.28 });
    this.fxs('air', this.tex.sigil, whiten(this.colors.accent, 0.3), x, y, { dur: 340, from: 0.4 * g, to: 1.05 * g, a0: 0.85, spin: 0.008 * (step % 2 ? -1 : 1) });
    this.fxs('air', this.tex.ring, this.colors.accent, x, y, { dur: 280, from: 0.4, to: 1.8 * g, a0: 0.8 });
    this.glitter(x, y, 8, 560, { dir: head, spread: 2.4, life: 420, size: 0.5 });
  }

  /**
   * THE impact (I-III): the last ribbon lands. Everything starts AT its peak so the first frame is the brightest
   * frame: a flash over the portrait, a white burst, a side bloom, a big sigil flaring out and a counter-spinning one,
   * two rings, spikes along the ribbon's heading, glitter carried through, an afterglow (and rising motes on III).
   */
  impact(x: number, y: number, dir: Pt, radius: number, o: { tier: number; k: number; burst: number; flashAlpha: number; motes: number }): void {
    const c = this.colors;
    const fs = o.burst;
    const portrait = (radius * 2) / GLOW_PX / this.scale;
    const sig = (radius * 2) / SIGIL_PX / this.scale;
    // Short and bright, then GONE by the time the big -N has popped (it pops over ~140 ms): the number is never washed
    // out. What lingers is line work (the sigils and rings), not fill.
    this.fxs('air', this.tex.glow, c.core, x, y, { dur: 110, from: portrait * 1.05, to: portrait * 1.25, a0: 0.6 * o.flashAlpha });
    this.fxs('air', this.tex.glow, c.core, x, y, { dur: 150, from: 1 * fs, to: Math.min(3.2, 2.2 * fs), a0: o.flashAlpha });
    this.fxs('air', this.tex.glow, c.side, x, y, { dur: 420, from: 1.6 * fs, to: Math.min(5.5, 3.8 * fs), a0: 0.4 * o.flashAlpha });
    this.fxs('air', this.tex.glow, c.accent, x, y, { dur: 180, from: 0.8 * fs, to: 2.2 * fs, a0: 0.22 });
    this.fxs('air', this.tex.sigil, whiten(c.accent, 0.35), x, y, { dur: 620, from: sig * 0.7, to: sig * (1.7 + 0.5 * o.k), a0: 1, spin: 0.009 });
    this.fxs('under', this.tex.sigil, c.side, x, y, { dur: 820, from: sig * 1.1, to: sig * (1.5 + 0.4 * o.k), a0: 0.75, spin: -0.004 });
    this.fxs('air', this.tex.ring, c.core, x, y, { dur: 320, from: 0.5, to: 3 * (0.85 + 0.45 * o.k), a0: 1 });
    this.fxs('air', this.tex.ring, c.accent, x, y, { dur: 560, from: 0.5, to: 4.4 * (0.85 + 0.45 * o.k), a0: 0.65 });
    const head = Math.atan2(dir.y, dir.x);
    const spikes = 8;
    for (let i = 0; i < spikes; i++) {
      const a = head + (i / spikes) * Math.PI * 2 + (this.rnd() - 0.5) * 0.2;
      const len = (i === 0 ? 1.45 : 1) * (1 + 0.5 * o.k);
      this.fxs('air', this.tex.streak, i % 2 ? c.accent : c.core, x + Math.cos(a) * 58 * this.scale * len, y + Math.sin(a) * 58 * this.scale * len,
        { dur: 260, from: 3 * len, to: 4.8 * len, a0: 0.95, sy: 0.18 });
      this.fx[this.fx.length - 1]!.s.rotation = a;
    }
    this.glitter(x, y, Math.round(o.motes * 0.6), 900, { dir: head, spread: 1.8, life: 620, size: 0.6, grav: 380 });
    this.glitter(x, y, Math.round(o.motes * 0.4), 620, { life: 700, size: 0.5, grav: 60 });
    this.fxs('air', this.tex.glow, c.side, x, y, { dur: o.tier >= 3 ? 1100 : 800, from: 2.2 * fs, to: 2.7 * fs, a0: o.tier >= 3 ? 0.32 : 0.26 });
    if (o.tier >= 3) this.embers(x, y, radius, 12);
  }

  private embers(x: number, y: number, radius: number, n: number): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.2, sp = (50 + this.rnd() * 120) * S;
      const r = this.rnd() * radius * 0.8, b = this.rnd() * Math.PI * 2;
      this.particle(this.tex.star, i % 2 ? this.colors.accent : this.hot, {
        x: x + Math.cos(b) * r, y: y + Math.sin(b) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.4, grav: -50 * S,
        life: 900 + this.rnd() * 700, from: (0.35 + this.rnd() * 0.3) * S, to: 0.08 * S, alpha: 0.9, twinkle: 0.015 + this.rnd() * 0.02, spin: 0.004, streak: false,
      });
    }
  }

  /**
   * TIER IV: the vortex forms over the struck hero: a big sigil under the portrait and a counter-spinning inner one,
   * the orbit's own faint track, and a core of light that BUILDS (throbbing faster) until it collapses. `durMs` is the
   * swirl; `convMs` the collapse.
   */
  startVortex(x: number, y: number, r0: number, r1: number, tilt: number, durMs: number, convMs: number, dir: number): void {
    if (this.vortex) return;
    const sigil = this.take('under', this.tex.sigil, this.colors.side);
    const inner = this.take('under', this.tex.sigil, whiten(this.colors.accent, 0.2));
    const track = this.take('under', this.tex.ring, this.colors.accent);
    const bloom = this.take('air', this.tex.glow, this.colors.side);
    const core = this.take('air', this.tex.glow, this.colors.core);
    if (!sigil || !inner || !track || !bloom || !core) { for (const s of [sigil, inner, track, bloom, core]) if (s) this.giveS(s); return; }
    for (const s of [sigil, inner, track, bloom, core]) { s.position.set(x, y); s.alpha = 0; }
    this.vortex = { sigil, inner, track, core, bloom, x, y, r0, r1, tilt, age: 0, dur: Math.max(1, durMs), conv: Math.max(1, convMs), dir, converging: -1, moteAcc: 0 };
  }

  /** The vortex collapses inward (the ribbons converge on their own paths): its sigils pull in and flare. */
  converge(): void { if (this.vortex && this.vortex.converging < 0) this.vortex.converging = 0; }

  /**
   * TIER IV's EXPLOSION: the vortex bursts. A flash over the portrait, a huge white burst, side and accent blooms, three
   * rings (the last a wide slow arcane shockwave), the sigil flaring out, RIBBONS flung outward on curling paths, spikes,
   * a storm of glitter and rising motes, and a lingering afterglow.
   */
  explode(x: number, y: number, radius: number, o: { burst: number; size: number; ribbons: number; motes: number; flashAlpha: number; tilt: number; dir: number; width: number }): void {
    const v = this.vortex;
    if (v) { for (const s of [v.sigil, v.inner, v.track, v.core, v.bloom]) this.giveS(s); this.vortex = null; }
    // The converged ribbons ARE the explosion now: they go, and the blast streaks carry them outward.
    for (let i = this.ribbons.length - 1; i >= 0; i--) {
      const rb = this.ribbons[i]!;
      if (rb.ring) { this.dropRibbon(rb); this.ribbons.splice(i, 1); }
    }
    const c = this.colors;
    const S = this.scale;
    const fs = o.burst * o.size;
    const portrait = (radius * 2) / GLOW_PX / S;
    const sig = (radius * 2) / SIGIL_PX / S;
    // The fills are SHORT (the ribbons and the rings carry the explosion, and the big -N must read through it).
    this.fxs('air', this.tex.glow, c.core, x, y, { dur: 130, from: portrait * 1.2, to: portrait * 1.5, a0: 0.8 * o.flashAlpha });
    this.fxs('air', this.tex.glow, c.core, x, y, { dur: 170, from: 1.4 * fs, to: Math.min(5, 3 * fs), a0: o.flashAlpha });
    this.fxs('air', this.tex.glow, c.side, x, y, { dur: 520, from: 2 * fs, to: Math.min(8, 5 * fs), a0: 0.42 * o.flashAlpha });
    this.fxs('air', this.tex.glow, c.accent, x, y, { dur: 240, from: 1.2 * fs, to: 3.2 * fs, a0: 0.22 });
    this.fxs('air', this.tex.ring, c.core, x, y, { dur: 320, from: 0.4, to: 3.4 * o.size, a0: 1 });
    this.fxs('air', this.tex.ring, c.side, x, y, { dur: 560, from: 0.5, to: 5.2 * o.size, a0: 0.9 });
    this.fxs('air', this.tex.ring, c.accent, x, y, { dur: 860, from: 0.6, to: 7.5 * o.size, a0: 0.7, sy: 0.55 + 0.45 * o.tilt });
    this.fxs('air', this.tex.sigil, whiten(c.accent, 0.35), x, y, { dur: 760, from: sig * 1.2, to: sig * 3.1 * o.size, a0: 1, spin: 0.01 * o.dir });
    this.fxs('under', this.tex.sigil, c.side, x, y, { dur: 1000, from: sig * 1.6, to: sig * 2.4 * o.size, a0: 0.85, spin: -0.005 * o.dir });
    // The ribbons blasting OUTWARD: curling away with the vortex's spin, fastest first, thinning as they go.
    const n = Math.max(0, Math.round(o.ribbons));
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + (this.rnd() - 0.5) * 0.35;
      const L = radius * (3 + this.rnd() * 1.8) * o.size;
      const D = 560 + this.rnd() * 220;
      const curl = (0.7 + this.rnd() * 0.5) * o.dir;
      const r0 = radius * 0.15;
      // Out fast, easing off (a cubic, not harder: the trail is sampled back in time, so a ribbon that stops dead
      // would shrink to a stub), curling away with the vortex's spin.
      const at: Path = (t) => {
        const u = clamp01(t / D);
        const e = easeOutCubic(u);
        const th = a0 + curl * e;
        const r = r0 + L * e;
        return { x: x + Math.cos(th) * r, y: y + Math.sin(th) * r * (0.65 + 0.35 * o.tilt) };
      };
      this.addStreak(at, D, o.width * (1.1 + this.rnd() * 0.5), i % 2 ? c.accent : c.side);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + (this.rnd() - 0.5) * 0.25;
      const len = (1 + this.rnd() * 0.6) * o.size;
      this.fxs('air', this.tex.streak, i % 2 ? c.accent : c.core, x + Math.cos(a) * 80 * S * len, y + Math.sin(a) * 80 * S * len,
        { dur: 320, from: 3.6 * len, to: 6.2 * len, a0: 0.95, sy: 0.18 });
      this.fx[this.fx.length - 1]!.s.rotation = a;
    }
    this.glitter(x, y, Math.round(o.motes * 0.65), 1250, { life: 760, size: 0.7, grav: 260 });
    this.glitter(x, y, Math.round(o.motes * 0.35), 700, { life: 1000, size: 0.5, grav: -40, lift: 120 });
    this.embers(x, y, radius, 22);
    this.fxs('air', this.tex.glow, c.side, x, y, { dur: 1500, from: 2.6 * fs, to: 3.2 * fs, a0: 0.55 });
  }

  /** A blast streak: a ribbon without a head, on its own path, fading and thinning over its flight. */
  private addStreak(at: Path, durMs: number, width: number, tint: number): void {
    const S = this.scale;
    const glow = this.strip('glow', this.tex.ribbonSoft, tint);
    const body = this.strip('body', this.tex.ribbonBody, whiten(tint, 0.3));
    const core = this.strip('core', this.tex.ribbonBody, this.colors.core);
    if (!glow || !body || !core) { for (const s of [glow, body, core]) this.giveStrip(s); return; }
    const p0 = at(0);
    this.ribbons.push({
      at, landAt: -1, endAt: durMs, fadeMs: durMs * 0.45, age: 0, width: width * S, trailMs: 190, ring: null,
      shade: null, glow, body, core, strand: null, head: null, phase: this.rnd() * Math.PI * 2, alpha: 1,
      lastX: p0.x, lastY: p0.y, moteAcc: 0, thin: 0.5,
    });
  }

  /** An aftershock around the target (IV): a small flash, a ring and glitter. */
  boom(x: number, y: number, size: number): void {
    this.fxs('air', this.tex.glow, this.colors.core, x, y, { dur: 200, from: 0.8 * size, to: 2 * size, a0: 0.9 });
    this.fxs('air', this.tex.glow, this.colors.side, x, y, { dur: 420, from: 1.2 * size, to: 3 * size, a0: 0.6 });
    this.fxs('air', this.tex.ring, this.colors.accent, x, y, { dur: 360, from: 0.3, to: 2.2 * size, a0: 0.9 });
    this.glitter(x, y, 10, 620, { life: 480, size: 0.5 });
  }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Advance by `dtMs` (sequence ms; the runner applies the speed). */
  update(dtMs: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(100, dtMs));
    const sec = dt / 1000;
    const S = this.scale;

    const ch = this.charge;
    if (ch) {
      ch.age += dt;
      const u = clamp01(ch.age / ch.dur);
      const sig = (ch.r * 2.4) / SIGIL_PX;
      if (ch.releasing < 0) {
        const e = easeOutCubic(u);
        ch.sigil.scale.set(sig * (0.55 + 0.45 * e)); ch.sigil.alpha = 0.85 * Math.min(1, u * 2.5);
        ch.sigil.rotation += dt * (0.0015 + 0.006 * u);
        const throb = 1 + 0.1 * Math.sin(ch.age * (0.03 + 0.05 * u));
        ch.core.scale.set((0.35 + 0.8 * e) * (1 + 0.4 * ch.k) * throb * S); ch.core.alpha = 0.35 + 0.6 * u;
        ch.bloom.scale.set((1 + 1.4 * u) * (1 + 0.3 * ch.k) * S); ch.bloom.alpha = 0.5 * u;
        ch.ring.scale.set((2.6 - 2 * e) * (1 + 0.3 * ch.k) * S); ch.ring.alpha = Math.min(0.9, u * 3);
        ch.moteAcc += (ch.motes / ch.dur) * dt;
        while (ch.moteAcc >= 1) {
          ch.moteAcc -= 1;
          const a = this.rnd() * Math.PI * 2;
          const r = (110 + this.rnd() * 60) * (1 + 0.3 * ch.k) * S;
          const life = 190 + this.rnd() * 70;
          const sp = r / (life / 1000);
          // Inward with a twist: the motes spiral in.
          this.particle(this.tex.star, this.rnd() < 0.5 ? this.colors.accent : this.colors.core, {
            x: ch.x + Math.cos(a) * r, y: ch.y + Math.sin(a) * r,
            vx: -Math.cos(a) * sp - Math.sin(a) * sp * 0.45, vy: -Math.sin(a) * sp + Math.cos(a) * sp * 0.45,
            drag: 1, grav: 0, life, from: 0.5 * S, to: 0.2 * S, alpha: 1, twinkle: 0, spin: 0.01, streak: false,
          });
        }
      } else {
        // Held while the volley leaves, then released with the last ribbon: the circle flares and fades.
        ch.releasing += dt;
        const r = clamp01(ch.releasing / 260);
        ch.sigil.scale.set(sig * (1 + 0.35 * easeOutCubic(r))); ch.sigil.alpha = 0.85 * (1 - r); ch.sigil.rotation += dt * 0.008;
        ch.core.scale.set((1.2 + 0.8 * r) * S); ch.core.alpha = 1 - r;
        ch.bloom.alpha = 0.5 * (1 - r);
        ch.ring.alpha = 0.9 * (1 - r);
        if (r >= 1) { for (const s of [ch.sigil, ch.ring, ch.core, ch.bloom]) this.giveS(s); this.charge = null; }
      }
    }

    const v = this.vortex;
    if (v) {
      v.age += dt;
      const u = clamp01(v.age / v.dur);
      const e = easeInOutSine(u);
      const r = v.r0 + (v.r1 - v.r0) * e;
      const c = v.converging >= 0 ? clamp01((v.converging += dt) / v.conv) : 0;
      const pull = 1 - 0.55 * c * c;
      const sig = ((r * 2.3) / SIGIL_PX) * pull;
      v.sigil.scale.set(sig, sig * (0.55 + 0.45 * v.tilt)); v.sigil.alpha = Math.min(0.85, u * 2.2) * (1 - 0.3 * c);
      v.sigil.rotation += dt * v.dir * (0.001 + 0.004 * u + 0.02 * c);
      v.inner.scale.set(sig * 0.55, sig * 0.55 * (0.55 + 0.45 * v.tilt)); v.inner.alpha = Math.min(0.9, u * 1.8);
      v.inner.rotation -= dt * v.dir * (0.002 + 0.008 * u + 0.03 * c);
      const tr = ((r * 2) / GLOW_PX) * 1.25 * pull; // the ring texture's circle is 0.8 of its box
      v.track.scale.set(tr, tr * v.tilt); v.track.alpha = 0.3 * Math.min(1, u * 3) * (1 - c);
      const throb = 1 + (0.06 + 0.1 * u) * Math.sin(v.age * (0.02 + 0.07 * u));
      v.core.scale.set((0.25 + 1.1 * e + 0.8 * c) * throb * S); v.core.alpha = 0.3 + 0.55 * u + 0.15 * c;
      v.bloom.scale.set((1 + 2.2 * e + 1.2 * c) * S); v.bloom.alpha = 0.25 + 0.4 * u;
      // Motes pulled into the eye of the vortex.
      v.moteAcc += dt * (0.02 + 0.05 * u);
      while (v.moteAcc >= 1 && c < 1) {
        v.moteAcc -= 1;
        const a = this.rnd() * Math.PI * 2;
        const rr = r * (1.1 + this.rnd() * 0.5);
        const life = 260 + this.rnd() * 80;
        const sp = rr / (life / 1000);
        this.particle(this.tex.star, this.rnd() < 0.5 ? this.colors.accent : this.colors.core, {
          x: v.x + Math.cos(a) * rr, y: v.y + Math.sin(a) * rr * v.tilt,
          vx: -Math.cos(a) * sp - Math.sin(a) * sp * 0.6 * v.dir, vy: (-Math.sin(a) * sp + Math.cos(a) * sp * 0.6 * v.dir) * v.tilt,
          drag: 1, grav: 0, life, from: 0.45 * S, to: 0.15 * S, alpha: 1, twinkle: 0, spin: 0.01, streak: false,
        });
      }
    }

    for (let i = this.ribbons.length - 1; i >= 0; i--) {
      const rb = this.ribbons[i]!;
      rb.age += dt;
      if (rb.age >= rb.endAt) { this.dropRibbon(rb); this.ribbons.splice(i, 1); continue; }
      this.drawRibbon(rb, dt);
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= dt; if (q.delay > 0) continue; }
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      const sc = (q.from + (q.to - q.from) * easeOutQuint(u)) * S;
      q.s.scale.set(sc, sc * q.sy);
      if (q.spin) q.s.rotation += q.spin * dt * (1 - 0.6 * u);
      q.s.alpha = q.mode === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.mode === 'hold' ? q.a0 * (u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3)
          : q.a0 * (1 - u) * (1 - u * 0.3);
      if (u >= 1) { this.giveS(q.s); this.fx.splice(i, 1); }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) { this.giveS(p.s); this.particles.splice(i, 1); continue; }
      const damp = Math.pow(p.drag, sec);
      p.vx *= damp; p.vy = p.vy * damp + p.grav * sec;
      p.x += p.vx * sec; p.y += p.vy * sec;
      const t = 1 - p.life / p.max;
      const sc = p.from + (p.to - p.from) * t;
      p.s.position.set(p.x, p.y);
      p.s.scale.set(sc);
      if (p.spin) p.s.rotation += p.spin * dt;
      const tw = p.twinkle ? 0.55 + 0.45 * Math.sin((p.max - p.life) * p.twinkle * 6) : 1;
      p.s.alpha = p.alpha * (1 - t * t) * tw;
    }

    return this.used > 0 || this.meshes > 0;
  }

  /** Sample the ribbon's centreline back in time, then write every strip's vertices in place. */
  private drawRibbon(rb: Ribbon, dt: number): void {
    const N = RIBBON_POINTS;
    const L = this.look;
    const S = this.scale;
    const { px, py, nx, ny, hw } = this;
    // In the vortex the trail spans a shorter time as the spin speeds up (so a streak is an arc, never a full ring).
    let span = rb.trailMs;
    let depth = 1;
    const ring = rb.ring;
    if (ring && rb.age > rb.landAt) {
      const tau = Math.min(rb.age, ring.end) - ring.start;
      const w = ring.w0 + (ring.w1 - ring.w0) * clamp01(tau / Math.max(1, ring.end - ring.start));
      span = rb.trailMs * 1.5 * Math.pow(ring.w0 / Math.max(1e-6, w), 0.8);
    }
    const step = span / (N - 1);
    for (let j = 0; j < N; j++) {
      const p = rb.at(Math.max(0, rb.age - j * step));
      px[j] = p.x; py[j] = p.y;
    }
    if (ring && rb.age > rb.landAt) {
      // The back of the tilted ring (above its centre) sits "behind": a touch dimmer. Depth without a depth buffer.
      const sy = (py[0]! - ring.cy) / Math.max(1, ring.r * ring.tilt);
      depth = 0.68 + 0.32 * clamp01(0.5 + 0.5 * sy);
    }
    // Normals by central difference (the last good one carries over a degenerate point, e.g. still at the hero).
    let lx = 0, ly = 1;
    for (let j = 0; j < N; j++) {
      const a = Math.max(0, j - 1), b = Math.min(N - 1, j + 1);
      const tx = px[a]! - px[b]!, ty = py[a]! - py[b]!;
      const l = Math.hypot(tx, ty);
      if (l > 0.01) { lx = -ty / l; ly = tx / l; }
      nx[j] = lx; ny[j] = ly;
    }
    // Fade: a lob fades as its tail catches up with the target; a streak fades over its flight.
    let alpha = 1;
    if (rb.landAt >= 0 && !ring && rb.age > rb.landAt) alpha = 1 - clamp01((rb.age - rb.landAt) / Math.max(1, rb.fadeMs));
    if (rb.landAt < 0) alpha = 1 - Math.pow(clamp01((rb.age - (rb.endAt - rb.fadeMs)) / Math.max(1, rb.fadeMs)), 1.5);
    const grow = rb.landAt < 0 ? 1 - (1 - rb.thin) * clamp01(rb.age / rb.endAt) : 1;
    const born = clamp01(rb.age / 60); // grows out of the hero over the first frames
    rb.phase += dt * 0.011;
    for (let j = 0; j < N; j++) {
      const f = j / (N - 1);
      const taper = f < 0.07 ? 0.72 + 0.28 * (f / 0.07) : Math.pow(1 - (f - 0.07) / 0.93, 0.6);
      const twist = 1 - L.twist * Math.pow(Math.sin(rb.phase + f * 3.4), 2);
      hw[j] = rb.width * 0.5 * taper * twist * grow * (0.4 + 0.6 * born);
    }
    const a = alpha * depth * rb.alpha;
    this.writeStrip(rb.shade, L.glow * 0.8, L.shade * a, 0);
    this.writeStrip(rb.glow, L.glow, 0.75 * a, 0);
    this.writeStrip(rb.body, 1, 0.96 * a, 0);
    // The core tapers faster than the body: white-hot at the head, the tail left violet.
    this.writeStrip(rb.core, L.core, a, 0.9);
    if (rb.strand) {
      // One thin strand winding round the ribbon: offset along the normal by a sine that travels down the ribbon.
      const v = rb.strand.v;
      for (let j = 0; j < N; j++) {
        const f = j / (N - 1);
        const off = hw[j]! * 2 * L.strand * Math.sin(rb.phase * 2.2 + f * 9);
        const x = px[j]! + nx[j]! * off, y = py[j]! + ny[j]! * off;
        const h = Math.max(0.6 * S, hw[j]! * 0.2);
        v[j * 4] = x + nx[j]! * h; v[j * 4 + 1] = y + ny[j]! * h;
        v[j * 4 + 2] = x - nx[j]! * h; v[j * 4 + 3] = y - ny[j]! * h;
      }
      rb.strand.mesh.alpha = 0.85 * a;
    }
    // The head: an orb in a halo, a spinning sigil and a star flare, riding the front.
    const hd = rb.head;
    const hx = px[0]!, hy = py[0]!;
    if (hd) {
      const onLob = ring ? true : rb.age <= rb.landAt;
      const conv = ring ? clamp01((rb.age - ring.end) / 120) : 0;
      const ha = onLob ? (1 - conv) * clamp01(rb.age / 40) * depth : 0;
      const W = rb.width / S;
      const hs = L.headSize * (ring && rb.age > rb.landAt ? 0.8 : 1);
      hd.halo.position.set(hx, hy); hd.halo.scale.set((W / 34) * 1.5 * hs * S); hd.halo.alpha = 0.85 * ha;
      hd.orb.position.set(hx, hy); hd.orb.scale.set((W / 34) * 0.72 * hs * (1 + 0.08 * Math.sin(rb.age * 0.05)) * S); hd.orb.alpha = ha;
      hd.sigil.position.set(hx, hy); hd.sigil.scale.set(((W * 1.9) / SIGIL_PX) * L.sigilSize * hs * S); hd.sigil.rotation += dt * 0.012; hd.sigil.alpha = 0.9 * ha * (L.sigilSize > 0 ? 1 : 0);
      hd.flare.position.set(hx, hy); hd.flare.scale.set((W / 26) * hs * (0.9 + 0.25 * Math.sin(rb.age * 0.031)) * S); hd.flare.rotation += dt * 0.002; hd.flare.alpha = 0.9 * ha;
      // Glitter shed off the head as it travels (a few, bounded by the pool).
      rb.moteAcc += Math.hypot(hx - rb.lastX, hy - rb.lastY);
      if (ha > 0.2 && rb.moteAcc > 44 * S) {
        rb.moteAcc = 0;
        const ang = this.rnd() * Math.PI * 2, sp = (40 + this.rnd() * 80) * S;
        this.particle(this.tex.star, this.rnd() < 0.5 ? this.colors.accent : this.hot, {
          x: hx, y: hy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, drag: 0.15, grav: 90 * S,
          life: 380 + this.rnd() * 240, from: (0.28 + this.rnd() * 0.2) * S, to: 0.05 * S, alpha: 1, twinkle: 0.025, spin: 0.006, streak: false,
        });
      }
    }
    rb.lastX = hx; rb.lastY = hy;
  }

  private writeStrip(st: Strip | null, mult: number, alpha: number, sharpen: number): void {
    if (!st) return;
    const { px, py, nx, ny, hw } = this;
    const v = st.v;
    for (let j = 0; j < RIBBON_POINTS; j++) {
      const h = hw[j]! * mult * (sharpen ? Math.pow(1 - j / (RIBBON_POINTS - 1), sharpen) : 1);
      v[j * 4] = px[j]! + nx[j]! * h; v[j * 4 + 1] = py[j]! + ny[j]! * h;
      v[j * 4 + 2] = px[j]! - nx[j]! * h; v[j * 4 + 3] = py[j]! - ny[j]! * h;
    }
    st.mesh.alpha = Math.max(0, alpha);
  }

  private dropRibbon(rb: Ribbon): void {
    for (const st of [rb.shade, rb.glow, rb.body, rb.core, rb.strand]) this.giveStrip(st);
    if (rb.head) for (const s of [rb.head.halo, rb.head.orb, rb.head.sigil, rb.head.flare]) this.giveS(s);
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const rb of this.ribbons) this.dropRibbon(rb);
    for (const q of this.fx) this.giveS(q.s);
    for (const p of this.particles) this.giveS(p.s);
    if (this.charge) for (const s of [this.charge.sigil, this.charge.ring, this.charge.core, this.charge.bloom]) this.giveS(s);
    if (this.vortex) for (const s of [this.vortex.sigil, this.vortex.inner, this.vortex.track, this.vortex.core, this.vortex.bloom]) this.giveS(s);
    this.ribbons = []; this.fx = []; this.particles = []; this.charge = null; this.vortex = null;
  }

  /** Tear down: every sprite and mesh destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const [id] of LAYERS) {
      this.freeSprites[id].length = 0;
      this.freeMeshes[id].length = 0;
      this.layers[id].removeChildren().forEach((c) => c.destroy());
    }
    this.root.removeChildren().forEach((c) => c.destroy());
    this.root.destroy();
  }
}
