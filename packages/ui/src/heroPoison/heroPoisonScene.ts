/**
 * THE POISON DARTS SCENE: everything the Poison Darts hero attack draws in Pixi, as a plain scene graph with no
 * renderer, so it runs (and is tested) headless. `heroPoison.ts` mounts `root` on the above-portrait overlay and feeds
 * `update(dt)`.
 *
 * Design rule (the owner's Arcana bar: "clean", one readable hero element, never particle soup): the DART is the
 * subject. It is SIX sprites on ONE transform, every texture painted on the same box with the tip at the same spot:
 * a venom-green glow (additive, blooms on dark ground), a dark purple-black metal SHAFT, acid FLETCHING and the green
 * VENOM in its vial and on its needle (all NORMAL blend, so the colours hold on a light board), a thin lit EDGE and a
 * glowing TIP (additive). Its thin vapour trail is its motion sampled BACK IN TIME (Arcana technique 4): three strips
 * (a dark green shade, a venom glow and a pale core) that trail the arc for free and collapse into the tail when it
 * sticks. Splats, droplets, puffs and bubbles are seasoning, and short.
 *
 * STUCK DARTS ride the struck portrait: the runner reports the portrait's knockback each frame (`setFoeOffset`) and
 * every stuck dart, its puncture and the tint over the face move with it, so a dart never floats off a portrait that
 * was knocked back.
 *
 * LAYERS, bottom to top: haze (normal: puffs, clouds, the tint over the face, punctures, the dark shockwave) | glow
 * (additive: dart glows, trail glows, rings, blooms) | body (NORMAL: the dart, splats, droplets, bubbles) | core
 * (additive: the dart's edge and tip, flashes, glints), so the scene batches in four runs. Trail vertex arrays are
 * rewritten in place; every strip is `TRAIL_POINTS` x 2 vertices, under Pixi's 100-vertex batch limit.
 *
 * Contract: sprites and strips are POOLED per layer (hidden and reused) and bounded by `MAX_POISON_SPRITES` /
 * `MAX_POISON_MESHES`; textures are the caller's (pre-warmed on the GPU during the damage formation, so no first-play
 * spike); positions are the overlay's px; `setCamera` mirrors the DOM camera; `update` returns whether anything still
 * draws; `destroy()` leaves nothing behind. Scatter is seeded (a replay throws the same droplets).
 */
import { Container, MeshSimple, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeInOutSine, easeOutCubic, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';
import { dartPos, type DartMotion } from './heroPoisonConfig';
import { DART_TIP_X, DART_W } from './heroPoisonTextures';

export interface HeroPoisonTextures extends HeroArcanaTextures {
  dartShaft: Texture;
  dartFletch: Texture;
  dartVenom: Texture;
  dartEdge: Texture;
  dartGlow: Texture;
  /** Two venom splats (different splash patterns). */
  splat: Texture;
  splat2: Texture;
  /** A teardrop, +X aligned. */
  drop: Texture;
  /** A toxic billow. */
  puff: Texture;
  bubble: Texture;
  /** A soft-edged solid disc (the tint over the face). */
  disc: Texture;
  /** A thick shockwave ring. */
  shock: Texture;
}

export interface PoisonColors { core: number; venom: number; acid: number; dark: number; side: number }

export interface DartLook {
  /** Dart length, px at stage scale 1. */
  length: number;
  /** The dart's green glow (0 = none). */
  glow: number;
  /** Trail length (ms of flight it spans; 0 = none). */
  trailMs: number;
  trailWidth: number;
  /** Vapour wisps shed along the flight (0 = none). */
  wisps: number;
  /** How far a stuck dart quivers (radians). */
  quiver: number;
  /** Venom splash size. */
  splash: number;
  /** Droplets per tick. */
  tickDrops: number;
  /** The sickly tint over the struck face (peak opacity). */
  tint: number;
  /** Droplet gravity (px/s^2 at stage scale 1). */
  gravity: number;
  hazeAlpha: number;
  hazeMs: number;
  cloudPuffs: number;
  cloudSize: number;
}

/** Hard cap on sprites alive at once (a Tier IV burst peaks around 250). */
export const MAX_POISON_SPRITES = 700;
/** Hard cap on trail strips alive at once (three per dart). */
export const MAX_POISON_MESHES = 48;
/** Points along each trail: 32 vertices per strip, so every strip still batches. */
export const TRAIL_POINTS = 16;

type LayerId = 'haze' | 'glow' | 'body' | 'core';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [['haze', 'normal'], ['glow', 'add'], ['body', 'normal'], ['core', 'add']];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
const GLOW_PX = 128;
const DISC_PX = 128;
const SHOCK_PX = 256;
/** The ring texture's circle radius (of its 160 px box). */
const RING_R = 64;
const TIP_ANCHOR = DART_TIP_X / DART_W;

interface Strip { mesh: MeshSimple; v: Float32Array; layer: LayerId }

interface DartParts { glow: Sprite; shaft: Sprite; fletch: Sprite; venom: Sprite; edge: Sprite; tip: Sprite }

interface Dart {
  /** The plan's index of this dart (the runner's cue index). */
  idx: number;
  m: DartMotion;
  age: number;
  /** Px per texture px (the length, the tier size and the stage scale folded in). */
  k: number;
  parts: DartParts;
  shade: Strip | null; tglow: Strip | null; tcore: Strip | null;
  puncture: Sprite | null;
  /** Ms into the dissolve (-1 = not dissolving). */
  fade: number;
  /** Ms into the implosion's suck (-1 = not yet). */
  suck: number;
  phase: number;
  wispAcc: number;
  lastX: number; lastY: number;
  /** Where the tip is drawn this frame (for the seep's drips and the suck). */
  x: number; y: number; rot: number;
}

type AlphaMode = 'out' | 'punch' | 'hold';
interface Fx {
  s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number;
  /** y scale as a fraction of x (1 = round). */
  sy: number; spin: number; delay: number;
  /** Drift (px/s) and its drag per second (1 = none). */
  vx: number; vy: number; drag: number;
  /** A bubbling wobble of the scale (0 = none). */
  wobble: number;
  /** Rides the struck portrait (its knockback). */
  follow: boolean;
  x: number; y: number;
}

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  from: number; to: number; alpha: number;
  /** Stretched along its velocity (a droplet). */
  align: boolean;
  /** A bubble: wobbles as it rises and pops (a tiny ring) when it ends. */
  bubble: boolean;
  spin: number;
}

interface Charge { ring: Sprite; glint: Sprite; star: Sprite; x: number; y: number; hx: number; hy: number; r: number; age: number; dur: number; left: number; releasing: number; moteAcc: number; motes: number }

interface Swell {
  aura: Sprite; bloom: Sprite; rim: Sprite; core: Sprite;
  x: number; y: number; r: number; age: number; dur: number; suckDur: number; sucking: number; bubbleAcc: number; wispAcc: number;
  shock: Sprite | null;
}

export class HeroPoisonScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private readonly freeMeshes: Record<LayerId, MeshSimple[]>;
  private used = 0;
  private meshes = 0;
  private darts: Dart[] = [];
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private charge: Charge | null = null;
  private swell: Swell | null = null;
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private destroyed = false;
  private fox = 0;
  private foy = 0;
  private readonly rnd: () => number;
  private readonly uvs: Float32Array;
  private readonly idx: Uint32Array;
  /** The sickly tint over a face: the venom pushed a little toward the dark. */
  private readonly sick: number;
  /** A deep venom for the normal-blend bodies (keeps its colour on a light board). */
  private readonly deep: number;
  // scratch (the trail's centreline, normals and half-widths, reused by every dart every frame)
  private readonly px = new Float32Array(TRAIL_POINTS);
  private readonly py = new Float32Array(TRAIL_POINTS);
  private readonly nx = new Float32Array(TRAIL_POINTS);
  private readonly ny = new Float32Array(TRAIL_POINTS);
  private readonly hw = new Float32Array(TRAIL_POINTS);

  constructor(private readonly tex: HeroPoisonTextures, private readonly colors: PoisonColors, private readonly look: DartLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroPoison';
    this.layers = {} as Record<LayerId, Container>;
    this.freeSprites = {} as Record<LayerId, Sprite[]>;
    this.freeMeshes = {} as Record<LayerId, MeshSimple[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `poison-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.freeSprites[id] = [];
      this.freeMeshes[id] = [];
    }
    this.rnd = seededRng(seed);
    this.sick = mixColor(colors.venom, colors.dark, 0.3);
    this.deep = mixColor(colors.venom, colors.dark, 0.18);
    const n = TRAIL_POINTS;
    this.uvs = new Float32Array(n * 4);
    for (let j = 0; j < n; j++) {
      const u = 1 - j / (n - 1); // the head is u = 1 (full), the tail u = 0 (faded in by the texture)
      this.uvs[j * 4] = u; this.uvs[j * 4 + 1] = 0; this.uvs[j * 4 + 2] = u; this.uvs[j * 4 + 3] = 1;
    }
    this.idx = new Uint32Array((n - 1) * 6);
    for (let j = 0; j < n - 1; j++) { const a = j * 2; this.idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], j * 6); }
    // PRE-WARM: one near-invisible sprite per texture for the first few hundred ms (the damage formation is still
    // playing), so every texture is on the GPU long before the first dart or the burst needs it (no first-play spike).
    const t = tex;
    for (const w of [t.glow, t.ring, t.streak, t.star, t.ribbonSoft, t.ribbonBody, t.dartShaft, t.dartFletch, t.dartVenom, t.dartEdge, t.dartGlow, t.splat, t.splat2, t.drop, t.puff, t.bubble, t.disc, t.shock]) {
      const s = this.take('core', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    this.warmLeft = 400;
  }

  get liveSprites(): number { return this.used; }
  get liveMeshes(): number { return this.meshes; }
  get liveDarts(): number { return this.darts.length; }
  get stuckDarts(): number { let n = 0; for (const d of this.darts) if (d.age >= d.m.flightMs) n++; return n; }
  get charging(): boolean { return this.charge !== null; }
  get swelling(): boolean { return this.swell !== null; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) for (const ch of this.layers[id].children) if (ch instanceof Sprite) n++; return n; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  /** The struck portrait's knockback this frame (overlay px): stuck darts and the tint over the face ride it. */
  setFoeOffset(dx: number, dy: number): void { this.fox = Number.isFinite(dx) ? dx : 0; this.foy = Number.isFinite(dy) ? dy : 0; }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_POISON_SPRITES) return null;
    let s = this.freeSprites[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(s: Sprite): void {
    const layer = (s.parent?.label?.replace('poison-', '') ?? 'core') as LayerId;
    s.visible = false; this.freeSprites[layer].push(s); this.used--;
  }

  private strip(layer: LayerId, t: Texture, tint: number): Strip | null {
    if (this.destroyed || this.meshes >= MAX_POISON_MESHES) return null;
    let mesh = this.freeMeshes[layer].pop();
    if (!mesh) {
      mesh = new MeshSimple({ texture: t, vertices: new Float32Array(TRAIL_POINTS * 4), uvs: this.uvs, indices: this.idx });
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

  private fxs(layer: LayerId, t: Texture, tint: number, x: number, y: number, o: Partial<Omit<Fx, 's' | 'age' | 'x' | 'y'>> & { dur: number; from: number; to: number; a0: number }): Fx | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.2, sy: 1, spin: 0, delay: 0, vx: 0, vy: 0, drag: 1, wobble: 0, follow: false, x, y, ...o };
    s.position.set(x + (f.follow ? this.fox : 0), y + (f.follow ? this.foy : 0));
    s.scale.set(f.from * this.scale, f.from * this.scale * f.sy);
    s.alpha = f.mode === 'punch' || f.delay > 0 ? 0 : f.a0;
    this.fx.push(f);
    return f;
  }

  private particle(layer: LayerId, t: Texture, tint: number, o: Omit<Particle, 's' | 'max'>): void {
    const s = this.take(layer, t, tint);
    if (!s) return;
    s.position.set(o.x, o.y);
    s.rotation = o.align ? Math.atan2(o.vy, o.vx) : this.rnd() * Math.PI * 2;
    this.particles.push({ ...o, s, max: o.life });
  }

  /** Venom droplets thrown from a point: teardrops stretched along their flight, falling under gravity. */
  private droplets(x: number, y: number, n: number, speed: number, o: { dir?: number; spread?: number; lift?: number; life?: number; size?: number; grav?: number } = {}): void {
    const S = this.scale;
    const tints = [this.colors.venom, this.colors.acid, this.deep];
    for (let i = 0; i < n; i++) {
      const a = o.dir === undefined ? this.rnd() * Math.PI * 2 : o.dir + (this.rnd() - 0.5) * (o.spread ?? 1.4);
      const sp = speed * (0.4 + this.rnd() * 0.8) * S;
      const sz = (o.size ?? 0.5) * (0.55 + this.rnd() * 0.7);
      this.particle('body', this.tex.drop, tints[i % 3]!, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.lift ?? 0) * S, drag: 0.35, grav: (o.grav ?? this.look.gravity) * S,
        life: (o.life ?? 520) * (0.7 + this.rnd() * 0.6), from: sz * S, to: sz * 0.45 * S, alpha: 1, align: true, bubble: false, spin: 0,
      });
    }
  }

  /** Bubbles rising off the struck face, wobbling, each popping into a tiny ring. */
  private bubbles(x: number, y: number, radius: number, n: number, o: { life?: number; size?: number } = {}): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, r = Math.sqrt(this.rnd()) * radius * 0.75;
      const sz = (o.size ?? 0.45) * (0.5 + this.rnd() * 0.8);
      this.particle('body', this.tex.bubble, i % 2 ? this.colors.acid : this.colors.venom, {
        x: x + Math.cos(a) * r + this.fox, y: y + Math.sin(a) * r + this.foy, vx: (this.rnd() - 0.5) * 30 * S, vy: -(40 + this.rnd() * 70) * S, drag: 0.6, grav: -30 * S,
        life: (o.life ?? 520) * (0.6 + this.rnd() * 0.7), from: sz * 0.5 * S, to: sz * S, alpha: 0.95, align: false, bubble: true, spin: 0,
      });
    }
  }

  /** A toxic puff: a billow that swells and drifts (normal blend, so it reads as thick gas on any board). */
  private puff(x: number, y: number, size: number, o: { vx?: number; vy?: number; dur?: number; a0?: number; tint?: number; follow?: boolean } = {}): void {
    const S = this.scale;
    this.fxs('haze', this.tex.puff, o.tint ?? this.sick, x, y, {
      dur: o.dur ?? 520, from: 0.25 * size, to: 0.62 * size, a0: o.a0 ?? 0.55, mode: 'hold', vx: (o.vx ?? 0) * S, vy: (o.vy ?? -30) * S, drag: 0.25,
      spin: (this.rnd() - 0.5) * 0.002, wobble: 0.04, follow: o.follow ?? false,
    });
    const f = this.fx[this.fx.length - 1];
    if (f) f.s.rotation = this.rnd() * Math.PI * 2;
  }

  /** The sickly tint over the struck face: a green disc over the portrait that pulses in and out (opacity only). */
  private tintPulse(x: number, y: number, radius: number, strength: number, dur: number): void {
    const d = (radius * 2) / DISC_PX / this.scale;
    this.fxs('haze', this.tex.disc, this.sick, x, y, { dur, from: d * 0.98, to: d * 1.02, a0: this.look.tint * strength, mode: 'punch', peakAt: 0.16, follow: true });
    this.fxs('glow', this.tex.ring, this.colors.acid, x, y, { dur: dur * 0.8, from: (radius / RING_R / this.scale) * 0.98, to: (radius / RING_R / this.scale) * 1.08, a0: 0.5 * strength, mode: 'punch', peakAt: 0.12, follow: true });
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The hero readies: venom gathers where the darts will be flicked from (a glint that grows and turns), a thin acid
   * ring closes in on the hero, and droplets are drawn in to the hand. Held through the volley; released as the LAST
   * dart leaves (`throws` counts them down).
   */
  startCharge(x: number, y: number, hand: Pt, radius: number, durMs: number, throws: number, motes: number): void {
    if (this.charge) return;
    const ring = this.take('glow', this.tex.ring, this.colors.acid);
    const glint = this.take('core', this.tex.glow, this.colors.venom);
    const star = this.take('core', this.tex.star, this.colors.core);
    if (!ring || !glint || !star) { for (const s of [ring, glint, star]) if (s) this.give(s); return; }
    ring.position.set(x, y);
    for (const s of [glint, star]) s.position.set(hand.x, hand.y);
    for (const s of [ring, glint, star]) s.alpha = 0;
    this.charge = { ring, glint, star, x, y, hx: hand.x, hy: hand.y, r: radius, age: 0, dur: Math.max(1, durMs), left: Math.max(1, throws), releasing: -1, moteAcc: 0, motes };
    this.puff(hand.x, hand.y, 0.8, { dur: 600, a0: 0.3, vy: -20 });
  }

  /** A dart leaves the hand along `m`: a small venom flash, a snap ring, a flick of droplets. `age0` = ms elapsed. */
  throw(m: DartMotion, size: number, age0 = 0, idx = this.darts.length): void {
    const ch = this.charge;
    if (ch && ch.releasing < 0 && --ch.left <= 0) ch.releasing = 0;
    const S = this.scale;
    const a = m.a;
    const head = Math.atan2(m.c.y - a.y, m.c.x - a.x);
    this.fxs('core', this.tex.glow, this.colors.core, a.x, a.y, { dur: 110, from: 0.25, to: 0.7, a0: 0.8 });
    this.fxs('glow', this.tex.glow, this.colors.venom, a.x, a.y, { dur: 220, from: 0.4, to: 1.2, a0: 0.55, mode: 'punch', peakAt: 0.15 });
    const ring = this.fxs('glow', this.tex.ring, this.colors.acid, a.x, a.y, { dur: 200, from: 0.12, to: 0.55, a0: 0.8, sy: 0.45 });
    if (ring) ring.s.rotation = head + Math.PI / 2;
    this.droplets(a.x, a.y, 3, 260, { dir: head + Math.PI, spread: 2, life: 280, size: 0.3 });
    const k = (this.look.length / DART_W) * size * S;
    const parts = this.dartParts();
    if (!parts) return;
    const shade = this.look.trailMs > 0 ? this.strip('haze', this.tex.ribbonSoft, this.deep) : null;
    const tglow = this.look.trailMs > 0 ? this.strip('glow', this.tex.ribbonSoft, this.colors.venom) : null;
    const tcore = this.look.trailMs > 0 ? this.strip('glow', this.tex.ribbonBody, whiten(this.colors.acid, 0.5)) : null;
    const p0 = dartPos(m, Math.max(0, age0));
    this.darts.push({
      idx, m, age: Math.max(0, age0), k, parts, shade, tglow, tcore, puncture: null, fade: -1, suck: -1,
      phase: this.rnd() * Math.PI * 2, wispAcc: 0, lastX: p0.x, lastY: p0.y, x: p0.x, y: p0.y, rot: p0.rot,
    });
  }

  private dartParts(): DartParts | null {
    const c = this.colors;
    const glow = this.take('glow', this.tex.dartGlow, c.venom);
    const shaft = this.take('body', this.tex.dartShaft, c.dark);
    const fletch = this.take('body', this.tex.dartFletch, mixColor(c.side, c.acid, 0.25));
    const venom = this.take('body', this.tex.dartVenom, c.venom);
    const edge = this.take('core', this.tex.dartEdge, whiten(c.acid, 0.4));
    const tip = this.take('core', this.tex.glow, c.venom);
    const all = [glow, shaft, fletch, venom, edge, tip];
    if (all.some((s) => !s)) { for (const s of all) if (s) this.give(s); return null; }
    for (const s of [glow, shaft, fletch, venom, edge] as Sprite[]) s.anchor.set(TIP_ANCHOR, 0.5);
    for (const s of all as Sprite[]) s.alpha = 0;
    return { glow: glow!, shaft: shaft!, fletch: fletch!, venom: venom!, edge: edge!, tip: tip! };
  }

  /**
   * A dart THUNKS in before the last (a tick): a small venom splat, droplets splashing back off the face, a tiny toxic
   * puff, a pop ring, a puncture under the needle and a brief sickly tint over the portrait. `step` grows each tick.
   */
  hit(i: number, x: number, y: number, radius: number, step: number): void {
    const d = this.dartOf(i);
    const aim = d ? d.m.aim : { x, y };
    const rot = d ? d.m.rot : 0;
    const g = this.look.splash * (1 + 0.06 * step);
    this.puncture(d, aim);
    const sp = this.fxs('body', step % 2 ? this.tex.splat2 : this.tex.splat, this.deep, aim.x, aim.y, { dur: 460, from: 0.12 * g, to: 0.42 * g, a0: 0.95, mode: 'hold', follow: true });
    if (sp) sp.s.rotation = this.rnd() * Math.PI * 2;
    this.fxs('core', this.tex.glow, this.colors.core, aim.x, aim.y, { dur: 90, from: 0.2, to: 0.55 * g, a0: 0.7, follow: true });
    this.fxs('glow', this.tex.ring, this.colors.acid, aim.x, aim.y, { dur: 240, from: 0.1, to: 0.62 * g, a0: 0.85, follow: true });
    // The droplets splash BACK off the face (against the dart), fanned.
    this.droplets(aim.x, aim.y, this.look.tickDrops, 420, { dir: rot + Math.PI, spread: 2.2, life: 460, size: 0.42, lift: 120 });
    this.puff(aim.x, aim.y, 0.55, { dur: 460, a0: 0.4, vx: -Math.cos(rot) * 40, vy: -40, follow: true });
    this.tintPulse(x, y, radius, 0.55, 300);
  }

  /** The dark puncture under a stuck needle (rides the portrait; goes when the dart goes). */
  private puncture(d: Dart | undefined, aim: Pt): void {
    if (!d || d.puncture) return;
    const s = this.take('haze', this.tex.splat2, this.colors.dark);
    if (!s) return;
    s.position.set(aim.x + this.fox, aim.y + this.foy);
    s.scale.set(0.09 * this.scale * this.look.splash);
    s.rotation = this.rnd() * Math.PI * 2;
    s.alpha = 0.75;
    d.puncture = s;
  }

  private dartOf(i: number): Dart | undefined { return this.darts.find((d) => d.idx === i); }

  /**
   * THE impact (I-III): the last dart thunks in. The first frame is the brightest: a short white-green flash over the
   * face, a big crisp splat (two, crossed), two rings, venom spurts, a spray of droplets arcing out and falling, toxic
   * puffs, bubbles, and the strongest tint pulse. The fills are gone in ~150 ms, so the big -N reads.
   */
  impact(i: number, x: number, y: number, radius: number, o: { tier: number; k: number; burst: number; drops: number; flashAlpha: number }): void {
    const c = this.colors;
    const d = this.dartOf(i);
    const aim = d ? d.m.aim : { x, y };
    const rot = d ? d.m.rot : 0;
    const fs = o.burst * this.look.splash;
    const portrait = (radius * 2) / GLOW_PX / this.scale;
    this.puncture(d, aim);
    this.fxs('core', this.tex.glow, c.core, x, y, { dur: 110, from: portrait * 1.0, to: portrait * 1.2, a0: 0.5 * o.flashAlpha, follow: true });
    this.fxs('core', this.tex.glow, c.core, aim.x, aim.y, { dur: 140, from: 0.6 * fs, to: 1.8 * fs, a0: o.flashAlpha, follow: true });
    this.fxs('glow', this.tex.glow, c.venom, aim.x, aim.y, { dur: 360, from: 1.2 * fs, to: 3 * fs, a0: 0.45 * o.flashAlpha, follow: true });
    for (const [t, rr] of [[this.tex.splat, 0], [this.tex.splat2, 1.1]] as const) {
      const f = this.fxs('body', t, rr ? c.venom : this.deep, aim.x, aim.y, { dur: 620, from: 0.2 * fs, to: (rr ? 0.62 : 0.78) * fs, a0: 0.95, mode: 'hold', follow: true });
      if (f) f.s.rotation = this.rnd() * Math.PI * 2 + rr;
    }
    this.fxs('glow', this.tex.ring, c.core, aim.x, aim.y, { dur: 260, from: 0.2, to: 1.4 * (0.9 + 0.3 * o.k), a0: 1, follow: true });
    this.fxs('glow', this.tex.ring, c.acid, aim.x, aim.y, { dur: 480, from: 0.3, to: 2.5 * (0.85 + 0.4 * o.k), a0: 0.7 });
    // Venom SPURTS: short streaks bursting off the hit, weighted back against the dart.
    const spurts = 7;
    for (let s = 0; s < spurts; s++) {
      const a = rot + Math.PI + (s / (spurts - 1) - 0.5) * 3.4 + (this.rnd() - 0.5) * 0.2;
      const len = (0.8 + this.rnd() * 0.5) * fs;
      const f = this.fxs('core', this.tex.streak, s % 2 ? c.acid : c.venom, aim.x + Math.cos(a) * 34 * this.scale * len, aim.y + Math.sin(a) * 34 * this.scale * len,
        { dur: 220, from: 1.4 * len, to: 2.6 * len, a0: 0.9, sy: 0.22 });
      if (f) f.s.rotation = a;
    }
    this.droplets(aim.x, aim.y, Math.round(o.drops * 0.7), 620, { dir: rot + Math.PI, spread: 2.8, life: 720, size: 0.55, lift: 260 });
    this.droplets(aim.x, aim.y, Math.round(o.drops * 0.3), 380, { life: 600, size: 0.4, lift: 120 });
    for (let p = 0; p < 2 + o.tier; p++) {
      const a = this.rnd() * Math.PI * 2;
      this.puff(aim.x + Math.cos(a) * 16 * this.scale, aim.y + Math.sin(a) * 16 * this.scale, 0.75 + 0.2 * o.k, { dur: 700, a0: 0.5, vx: Math.cos(a) * 60, vy: Math.sin(a) * 40 - 40 });
    }
    this.bubbles(x, y, radius, 3 + o.tier, { life: 700 });
    this.tintPulse(x, y, radius, 1, 480);
  }

  /** I-III, a beat after the impact: the poison seeps in. A second tint pulse, bubbles, a drip off each stuck dart. */
  seep(x: number, y: number, radius: number): void {
    this.tintPulse(x, y, radius, 0.7, 560);
    this.bubbles(x, y, radius, 6, { life: 760, size: 0.5 });
    for (const d of this.darts) {
      if (d.age < d.m.flightMs) continue;
      const bx = d.x - Math.cos(d.rot) * d.k * 60, by = d.y - Math.sin(d.rot) * d.k * 60; // the vial
      this.particle('body', this.tex.drop, this.colors.venom, {
        x: bx, y: by, vx: 0, vy: 30 * this.scale, drag: 1, grav: 700 * this.scale, life: 420, from: 0.35 * this.scale, to: 0.3 * this.scale,
        alpha: 1, align: true, bubble: false, spin: 0,
      });
    }
  }

  /** I-III: the stuck darts dissolve (fade, sink a little) with a last wisp each. */
  dissolve(): void {
    for (const d of this.darts) {
      if (d.fade >= 0) continue;
      d.fade = 0;
      this.puff(d.x, d.y, 0.4, { dur: 420, a0: 0.3, vy: -30 });
    }
  }

  /**
   * TIER IV: the stuck darts GLOW and PULSE while the venom SWELLS over the face: a toxic aura rising, a bloom, a rim
   * throbbing faster, bubbles boiling off and wisps curling up. `durMs` is the swell; `suckMs` the collapse.
   */
  startSwell(x: number, y: number, radius: number, durMs: number, suckMs: number): void {
    if (this.swell) return;
    const aura = this.take('haze', this.tex.disc, this.sick);
    const bloom = this.take('glow', this.tex.glow, this.colors.venom);
    const rim = this.take('glow', this.tex.shock, this.colors.acid);
    const core = this.take('core', this.tex.glow, this.colors.core);
    if (!aura || !bloom || !rim || !core) { for (const s of [aura, bloom, rim, core]) if (s) this.give(s); return; }
    for (const s of [aura, bloom, rim, core]) { s.position.set(x, y); s.alpha = 0; }
    this.swell = { aura, bloom, rim, core, x, y, r: radius, age: 0, dur: Math.max(1, durMs), suckDur: Math.max(1, suckMs), sucking: -1, bubbleAcc: 0, wispAcc: 0, shock: null };
  }

  /** The collapse: every stuck dart is pulled into the centre, the aura shrinks to a point, a dark ring contracts. */
  suck(): void {
    const sw = this.swell;
    if (!sw || sw.sucking >= 0) return;
    sw.sucking = 0;
    for (const d of this.darts) if (d.suck < 0) d.suck = 0;
    // The dark ring that CONTRACTS (the implosion read at a glance), and venom pulled in from all round.
    const sh = this.take('haze', this.tex.shock, this.colors.dark);
    if (sh) { sh.position.set(sw.x + this.fox, sw.y + this.foy); sh.alpha = 0; sw.shock = sh; }
    const S = this.scale;
    const n = 22;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rnd() * 0.25;
      const r = sw.r * (1.7 + this.rnd() * 0.8);
      const life = sw.suckDur * (0.8 + this.rnd() * 0.2);
      const sp = r / (life / 1000);
      this.particle('body', this.tex.drop, i % 2 ? this.colors.acid : this.colors.venom, {
        x: sw.x + this.fox + Math.cos(a) * r, y: sw.y + this.foy + Math.sin(a) * r, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, drag: 1, grav: 0,
        life, from: 0.5 * S, to: 0.15 * S, alpha: 1, align: true, bubble: false, spin: 0,
      });
    }
  }

  /**
   * TIER IV's TOXIC BURST: the point bursts. A short flash, a GREEN-BLACK shockwave (a thick dark ring with a venom ring
   * riding inside it and a flat acid ring), big splats, bubbling toxic cloud puffs rolling out, acid droplets arcing
   * out and falling, venom spurts, a lingering poison haze that dissipates, and the strongest tint on the face.
   */
  burst(x: number, y: number, radius: number, o: { burst: number; size: number; drops: number; flashAlpha: number }): void {
    const sw = this.swell;
    if (sw) { for (const s of [sw.aura, sw.bloom, sw.rim, sw.core]) this.give(s); if (sw.shock) this.give(sw.shock); this.swell = null; }
    // The darts were sucked into the point: they ARE the burst now.
    for (const d of this.darts) this.dropDart(d);
    this.darts = [];
    const c = this.colors;
    const S = this.scale;
    const fs = o.burst * o.size;
    const portrait = (radius * 2) / GLOW_PX / S;
    const shock = (radius * 2) / SHOCK_PX / S;
    this.fxs('core', this.tex.glow, c.core, x, y, { dur: 120, from: portrait * 1.1, to: portrait * 1.4, a0: 0.75 * o.flashAlpha, follow: true });
    this.fxs('core', this.tex.glow, c.core, x, y, { dur: 160, from: 1.2 * fs, to: Math.min(4.5, 2.6 * fs), a0: o.flashAlpha });
    this.fxs('glow', this.tex.glow, c.venom, x, y, { dur: 480, from: 1.8 * fs, to: Math.min(7, 4.4 * fs), a0: 0.5 * o.flashAlpha });
    // THE SHOCKWAVE: dark (normal blend: it reads on a light board) with venom light riding just inside it.
    this.fxs('haze', this.tex.shock, c.dark, x, y, { dur: 560, from: shock * 0.5, to: shock * 3.4 * o.size, a0: 0.85 });
    this.fxs('glow', this.tex.shock, c.venom, x, y, { dur: 480, from: shock * 0.45, to: shock * 3.1 * o.size, a0: 0.9 });
    this.fxs('glow', this.tex.ring, c.acid, x, y, { dur: 820, from: 0.5, to: 6.8 * o.size, a0: 0.6, sy: 0.5 });
    for (const [t, rr] of [[this.tex.splat, 0], [this.tex.splat2, 0.9]] as const) {
      const f = this.fxs('body', t, rr ? c.venom : this.deep, x, y, { dur: 800, from: 0.3 * fs, to: (rr ? 0.85 : 1.05) * fs, a0: 0.95, mode: 'hold', follow: true });
      if (f) f.s.rotation = this.rnd() * Math.PI * 2;
    }
    // Venom spurts all round.
    for (let s = 0; s < 12; s++) {
      const a = (s / 12) * Math.PI * 2 + (this.rnd() - 0.5) * 0.3;
      const len = (1 + this.rnd() * 0.6) * o.size;
      const f = this.fxs('core', this.tex.streak, s % 2 ? c.acid : c.venom, x + Math.cos(a) * 70 * S * len, y + Math.sin(a) * 70 * S * len, { dur: 300, from: 3 * len, to: 5.4 * len, a0: 0.9, sy: 0.2 });
      if (f) f.s.rotation = a;
    }
    // BUBBLING TOXIC CLOUDS rolling out (thick, normal blend) and a few dark ones among them.
    const puffs = Math.max(0, Math.round(this.look.cloudPuffs));
    for (let p = 0; p < puffs; p++) {
      const a = (p / Math.max(1, puffs)) * Math.PI * 2 + (this.rnd() - 0.5) * 0.5;
      const sp = (160 + this.rnd() * 220) * o.size;
      const sz = (1 + this.rnd() * 0.6) * this.look.cloudSize * o.size;
      const tint = p % 3 === 2 ? mixColor(c.dark, c.venom, 0.25) : p % 3 === 1 ? mixColor(c.venom, c.acid, 0.35) : this.sick;
      this.fxs('haze', this.tex.puff, tint, x + Math.cos(a) * radius * 0.3, y + Math.sin(a) * radius * 0.3, {
        dur: 900 + this.rnd() * 400, from: 0.35 * sz, to: 1.35 * sz, a0: 0.62, mode: 'hold', vx: Math.cos(a) * sp * S, vy: (Math.sin(a) * sp - 40) * S, drag: 0.08,
        spin: (this.rnd() - 0.5) * 0.002, wobble: 0.06,
      });
    }
    // ACID DROPLETS arcing out and falling.
    this.droplets(x, y, Math.round(o.drops * 0.7), 900, { life: 900, size: 0.6, lift: 420 });
    this.droplets(x, y, Math.round(o.drops * 0.3), 520, { life: 760, size: 0.45, lift: 200 });
    this.bubbles(x, y, radius * 1.4, 12, { life: 900, size: 0.55 });
    // The LINGERING HAZE that dissipates.
    for (let h = 0; h < 2; h++) {
      const f = this.fxs('haze', this.tex.puff, this.sick, x + (h ? 18 : -18) * S, y, {
        dur: this.look.hazeMs, from: 1.6 * o.size, to: 3 * o.size, a0: this.look.hazeAlpha, mode: 'hold', vy: -18 * S, drag: 0.5, spin: (h ? 1 : -1) * 0.0004, wobble: 0.03,
      });
      if (f) f.s.rotation = h * 2.1;
    }
    this.tintPulse(x, y, radius, 1.2, 700);
  }

  /** A bubbling pop round the target after the burst (IV): a small splat, a ring, droplets, bubbles. */
  boom(x: number, y: number, size: number): void {
    const f = this.fxs('body', this.tex.splat2, this.colors.venom, x, y, { dur: 380, from: 0.1 * size, to: 0.34 * size, a0: 0.9, mode: 'hold' });
    if (f) f.s.rotation = this.rnd() * Math.PI * 2;
    this.fxs('core', this.tex.glow, this.colors.core, x, y, { dur: 120, from: 0.3 * size, to: 0.8 * size, a0: 0.7 });
    this.fxs('glow', this.tex.ring, this.colors.acid, x, y, { dur: 300, from: 0.15, to: 0.9 * size, a0: 0.85 });
    this.droplets(x, y, 7, 480, { life: 520, size: 0.4, lift: 200 });
    this.puff(x, y, 0.6 * size, { dur: 560, a0: 0.45 });
  }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  /** Advance by `dtMs` (sequence ms; the runner applies the speed). */
  update(dtMs: number): boolean {
    if (this.destroyed) return false;
    const dt = Math.max(0, Math.min(100, dtMs));
    const sec = dt / 1000;
    const S = this.scale;

    if (this.warm.length) {
      this.warmLeft -= Math.max(dt, 16);
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; }
    }

    const ch = this.charge;
    if (ch) {
      ch.age += dt;
      const u = clamp01(ch.age / ch.dur);
      if (ch.releasing < 0) {
        const e = easeOutCubic(u);
        const rr = (ch.r / RING_R / S) * (2.2 - 1.15 * e);
        ch.ring.scale.set(rr * S); ch.ring.alpha = 0.75 * Math.min(1, u * 3);
        const throb = 1 + 0.12 * Math.sin(ch.age * (0.03 + 0.05 * u));
        ch.glint.scale.set((0.25 + 0.45 * e) * throb * S); ch.glint.alpha = 0.3 + 0.6 * u;
        ch.star.scale.set((0.35 + 0.35 * e) * S); ch.star.rotation += dt * (0.004 + 0.01 * u); ch.star.alpha = 0.8 * u;
        ch.moteAcc += (ch.motes / ch.dur) * dt;
        while (ch.moteAcc >= 1) {
          ch.moteAcc -= 1;
          const a = this.rnd() * Math.PI * 2;
          const r = ch.r * (1.3 + this.rnd() * 0.6);
          const life = 180 + this.rnd() * 60;
          const sp = r / (life / 1000);
          this.particle('body', this.tex.drop, this.rnd() < 0.5 ? this.colors.venom : this.colors.acid, {
            x: ch.hx + Math.cos(a) * r, y: ch.hy + Math.sin(a) * r, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp,
            drag: 1, grav: 0, life, from: 0.38 * S, to: 0.15 * S, alpha: 1, align: true, bubble: false, spin: 0,
          });
        }
      } else {
        ch.releasing += dt;
        const r = clamp01(ch.releasing / 200);
        ch.ring.alpha = 0.75 * (1 - r);
        ch.glint.scale.set((0.7 + 0.5 * r) * S); ch.glint.alpha = 0.9 * (1 - r);
        ch.star.alpha = 0.8 * (1 - r); ch.star.rotation += dt * 0.01;
        if (r >= 1) { for (const s of [ch.ring, ch.glint, ch.star]) this.give(s); this.charge = null; }
      }
    }

    const sw = this.swell;
    let swellU = 0;
    let suckU = 0;
    if (sw) {
      sw.age += dt;
      const u = clamp01(sw.age / sw.dur);
      swellU = u;
      const e = easeInOutSine(u);
      if (sw.sucking >= 0) { sw.sucking += dt; suckU = clamp01(sw.sucking / sw.suckDur); }
      const pull = 1 - 0.85 * suckU * suckU * suckU;
      const cx = sw.x + this.fox, cy = sw.y + this.foy;
      const throb = 1 + (0.03 + 0.06 * u) * Math.sin(sw.age * (0.012 + 0.05 * u));
      const d = (sw.r * 2) / DISC_PX;
      sw.aura.position.set(cx, cy); sw.aura.scale.set(d * (1 + 0.12 * e) * throb * pull); sw.aura.alpha = Math.min(0.85, this.look.tint * (0.4 + 1.3 * e)) * (1 - 0.4 * suckU);
      sw.bloom.position.set(cx, cy); sw.bloom.scale.set((1.4 + 1.8 * e) * throb * pull * S); sw.bloom.alpha = (0.15 + 0.4 * e) * (1 - 0.5 * suckU);
      const rim = ((sw.r * 2) / SHOCK_PX) * 1.2 * (1 + 0.05 * Math.sin(sw.age * (0.02 + 0.06 * u))) * pull;
      sw.rim.position.set(cx, cy); sw.rim.scale.set(rim); sw.rim.alpha = (0.2 + 0.5 * e) * (1 - suckU);
      // The core: nothing much through the swell; it becomes the tight bright point the poison is sucked into.
      sw.core.position.set(cx, cy);
      sw.core.scale.set((0.2 + 0.5 * e) * (1 - 0.55 * suckU) * S); sw.core.alpha = 0.2 + 0.4 * e + 0.4 * suckU;
      if (sw.shock) {
        const sh = ((sw.r * 2) / SHOCK_PX) * (2.3 - 2.05 * suckU * suckU);
        sw.shock.position.set(cx, cy); sw.shock.scale.set(sh); sw.shock.alpha = 0.85 * Math.min(1, suckU * 4);
      }
      if (suckU <= 0) {
        // Bubbles boil off faster and faster; wisps curl up.
        sw.bubbleAcc += dt * (0.012 + 0.05 * u);
        while (sw.bubbleAcc >= 1) { sw.bubbleAcc -= 1; this.bubbles(sw.x, sw.y, sw.r, 1, { life: 520, size: 0.4 + 0.2 * u }); }
        sw.wispAcc += dt * (0.004 + 0.008 * u);
        while (sw.wispAcc >= 1) {
          sw.wispAcc -= 1;
          const a = this.rnd() * Math.PI * 2, r = sw.r * (0.5 + this.rnd() * 0.5);
          this.puff(sw.x + Math.cos(a) * r, sw.y + Math.sin(a) * r, 0.45 + 0.3 * u, { dur: 560, a0: 0.35, vx: Math.cos(a) * 20, vy: -50, follow: true });
        }
      }
    }

    for (let i = this.darts.length - 1; i >= 0; i--) {
      const d = this.darts[i]!;
      d.age += dt;
      if (d.fade >= 0) d.fade += dt;
      if (d.suck >= 0) d.suck += dt;
      if (d.fade >= 260) { this.dropDart(d); this.darts.splice(i, 1); continue; }
      this.drawDart(d, dt, swellU, sw ? sw : null);
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= dt; if (q.delay > 0) continue; }
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      if (q.vx || q.vy) {
        const damp = Math.pow(q.drag, sec);
        q.vx *= damp; q.vy *= damp;
        q.x += q.vx * sec; q.y += q.vy * sec;
      }
      const wob = q.wobble ? 1 + q.wobble * Math.sin(q.age * 0.018 + q.x * 0.05) : 1;
      const sc = (q.from + (q.to - q.from) * easeOutQuint(u)) * S * wob;
      q.s.scale.set(sc, sc * q.sy);
      q.s.position.set(q.x + (q.follow ? this.fox : 0), q.y + (q.follow ? this.foy : 0));
      if (q.spin) q.s.rotation += q.spin * dt * (1 - 0.6 * u);
      q.s.alpha = q.mode === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.mode === 'hold' ? q.a0 * (u < 0.55 ? 1 : 1 - (u - 0.55) / 0.45)
          : q.a0 * (1 - u) * (1 - u * 0.3);
      if (u >= 1) { this.give(q.s); this.fx.splice(i, 1); }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        if (p.bubble) this.fxs('core', this.tex.ring, this.colors.acid, p.x, p.y, { dur: 130, from: (p.to / S) * 0.22, to: (p.to / S) * 0.55, a0: 0.8 });
        this.give(p.s); this.particles.splice(i, 1); continue;
      }
      const damp = Math.pow(p.drag, sec);
      p.vx *= damp; p.vy = p.vy * damp + p.grav * sec;
      p.x += p.vx * sec; p.y += p.vy * sec;
      const t = 1 - p.life / p.max;
      const sc = p.from + (p.to - p.from) * t;
      if (p.bubble) {
        p.s.position.set(p.x + Math.sin((p.max - p.life) * 0.02 + p.from * 40) * 3 * S, p.y);
        p.s.scale.set(sc);
        p.s.alpha = p.alpha * Math.min(1, t * 6);
      } else if (p.align) {
        const v = Math.hypot(p.vx, p.vy);
        p.s.position.set(p.x, p.y);
        p.s.rotation = Math.atan2(p.vy, p.vx);
        p.s.scale.set(sc * (1 + Math.min(1.6, v / (900 * S))), sc);
        p.s.alpha = p.alpha * (1 - t * t);
      } else {
        p.s.position.set(p.x, p.y);
        p.s.scale.set(sc);
        if (p.spin) p.s.rotation += p.spin * dt;
        p.s.alpha = p.alpha * (1 - t * t);
      }
    }

    return this.used > this.warm.length || this.meshes > 0 || this.swell !== null;
  }

  /** Pose one dart: in flight along its arc, or stuck (quivering, riding the portrait), pulsing, sucked in, fading. */
  private drawDart(d: Dart, dt: number, swellU: number, sw: Swell | null): void {
    const m = d.m;
    const L = this.look;
    const S = this.scale;
    const flying = d.age < m.flightMs;
    let x: number, y: number, rot: number;
    if (flying) {
      const p = dartPos(m, d.age);
      x = p.x; y = p.y; rot = p.rot;
    } else {
      const since = d.age - m.flightMs;
      // THUNK: a hard quiver that dies fast (the fletching end whips; the tip stays buried).
      const q = L.quiver * Math.exp(-since / 110) * Math.sin(since * 0.16);
      const shiver = swellU > 0 && d.suck < 0 ? 0.04 * swellU * swellU * Math.sin(d.age * 0.11 + d.phase) : 0;
      x = m.b.x + this.fox; y = m.b.y + this.foy; rot = m.rot + q + shiver;
    }
    let size = 1;
    let alpha = 1;
    if (d.suck >= 0 && sw) {
      // Pulled into the centre: it turns to point at it and slides in, shrinking, faster and faster (ease in).
      const u = clamp01(d.suck / sw.suckDur);
      const e = u * u * u;
      const cx = sw.x + this.fox, cy = sw.y + this.foy;
      const toC = Math.atan2(cy - y, cx - x);
      let da = toC - rot; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      rot += da * easeOutCubic(Math.min(1, u * 2.5));
      x += (cx - x) * e; y += (cy - y) * e;
      size = 1 - 0.7 * e;
      alpha = 1 - clamp01((u - 0.8) / 0.2);
    }
    if (d.fade >= 0) { const f = clamp01(d.fade / 260); alpha *= 1 - f; size *= 1 - 0.12 * f; y += 6 * S * f; }
    const born = clamp01(d.age / 40);
    const k = d.k * size * (0.7 + 0.3 * born);
    d.x = x; d.y = y; d.rot = rot;
    // The swell: every stuck dart GLOWS and PULSES, faster as the venom builds.
    const pulse = swellU > 0 ? 0.5 + 0.5 * Math.sin(d.age * (0.012 + 0.04 * swellU) + d.phase) : 0;
    const hot = swellU * (0.4 + 0.6 * pulse);
    const P = d.parts;
    for (const s of [P.glow, P.shaft, P.fletch, P.venom, P.edge]) { s.position.set(x, y); s.rotation = rot; s.scale.set(k); }
    P.glow.scale.set(k * 1.04, k * (1.4 + 0.8 * hot));
    P.glow.alpha = alpha * L.glow * (0.7 + 0.9 * hot);
    P.shaft.alpha = alpha;
    P.fletch.alpha = alpha;
    P.venom.alpha = alpha;
    P.venom.tint = hot > 0 ? whiten(this.colors.venom, 0.45 * hot) : this.colors.venom;
    P.edge.alpha = alpha * 0.85;
    P.tip.position.set(x - Math.cos(rot) * 3 * k, y - Math.sin(rot) * 3 * k);
    P.tip.scale.set((0.13 + 0.03 * Math.sin(d.age * 0.03 + d.phase) + 0.2 * hot) * (k / 0.525));
    P.tip.alpha = alpha * (0.75 + 0.25 * hot);
    if (d.puncture) { d.puncture.position.set(m.aim.x + this.fox, m.aim.y + this.foy); d.puncture.alpha = 0.75 * alpha * (d.suck >= 0 ? 0 : 1); }

    // The vapour trail: the tail end (the fletching) sampled back in time.
    if (d.tglow) this.drawTrail(d, flying);
    // Vapour wisps shed along the flight, thin and quick.
    if (flying && L.wisps > 0) {
      d.wispAcc += Math.hypot(x - d.lastX, y - d.lastY);
      const every = (90 / L.wisps) * S;
      while (d.wispAcc >= every) {
        d.wispAcc -= every;
        const bx = x - Math.cos(rot) * DART_W * k * 0.9, by = y - Math.sin(rot) * DART_W * k * 0.9;
        this.fxs('haze', this.tex.puff, this.deep, bx, by, { dur: 360, from: 0.08, to: 0.22, a0: 0.28, mode: 'out', vy: -20 * S, drag: 0.4, spin: 0.002 });
      }
    }
    d.lastX = x; d.lastY = y;
    void dt;
  }

  private drawTrail(d: Dart, flying: boolean): void {
    const N = TRAIL_POINTS;
    const L = this.look;
    const S = this.scale;
    const { px, py, nx, ny, hw } = this;
    const step = L.trailMs / (N - 1);
    const back = DART_W * d.k * 0.88;
    for (let j = 0; j < N; j++) {
      const p = dartPos(d.m, Math.max(0, d.age - j * step));
      px[j] = p.x - Math.cos(p.rot) * back; py[j] = p.y - Math.sin(p.rot) * back;
    }
    let lx = 0, ly = 1;
    for (let j = 0; j < N; j++) {
      const a = Math.max(0, j - 1), b = Math.min(N - 1, j + 1);
      const tx = px[a]! - px[b]!, ty = py[a]! - py[b]!;
      const l = Math.hypot(tx, ty);
      if (l > 0.01) { lx = -ty / l; ly = tx / l; }
      nx[j] = lx; ny[j] = ly;
    }
    for (let j = 0; j < N; j++) {
      const f = j / (N - 1);
      hw[j] = L.trailWidth * 0.5 * S * (1 - f) * (0.55 + 0.45 * (1 - f));
    }
    const since = d.age - d.m.flightMs;
    const alpha = (flying ? 1 : 1 - clamp01(since / Math.max(1, L.trailMs))) * clamp01(d.age / 30);
    this.writeStrip(d.shade, 2.6, 0.4 * alpha);
    this.writeStrip(d.tglow, 1.9, 0.75 * alpha);
    this.writeStrip(d.tcore, 0.45, 0.9 * alpha);
  }

  private writeStrip(st: Strip | null, mult: number, alpha: number): void {
    if (!st) return;
    const { px, py, nx, ny, hw } = this;
    const v = st.v;
    for (let j = 0; j < TRAIL_POINTS; j++) {
      const h = hw[j]! * mult;
      v[j * 4] = px[j]! + nx[j]! * h; v[j * 4 + 1] = py[j]! + ny[j]! * h;
      v[j * 4 + 2] = px[j]! - nx[j]! * h; v[j * 4 + 3] = py[j]! - ny[j]! * h;
    }
    st.mesh.alpha = Math.max(0, alpha);
  }

  private dropDart(d: Dart): void {
    const P = d.parts;
    for (const s of [P.glow, P.shaft, P.fletch, P.venom, P.edge, P.tip]) this.give(s);
    if (d.puncture) { this.give(d.puncture); d.puncture = null; }
    for (const st of [d.shade, d.tglow, d.tcore]) this.giveStrip(st);
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const d of this.darts) this.dropDart(d);
    for (const q of this.fx) this.give(q.s);
    for (const p of this.particles) this.give(p.s);
    for (const s of this.warm) this.give(s);
    if (this.charge) for (const s of [this.charge.ring, this.charge.glint, this.charge.star]) this.give(s);
    if (this.swell) { for (const s of [this.swell.aura, this.swell.bloom, this.swell.rim, this.swell.core]) this.give(s); if (this.swell.shock) this.give(this.swell.shock); }
    this.darts = []; this.fx = []; this.particles = []; this.warm = []; this.charge = null; this.swell = null;
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
