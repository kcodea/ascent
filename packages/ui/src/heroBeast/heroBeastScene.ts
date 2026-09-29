/**
 * THE STAMPEDE SCENE: everything the beast chomp rush hero attack draws in Pixi, as a plain scene graph with no
 * renderer, so it runs (and is tested) headless. `heroBeast.ts` mounts `root` on the above-portrait overlay and feeds
 * `update(dt)`.
 *
 * Design rule (the owner's Arcana bar: "clean", one readable hero element, never particle soup): the subjects are the
 * BEAST and the JAWS. A beast is seven sprites on ONE head transform (upper glow, body and edge anchored at the mouth;
 * lower glow, body and edge anchored at the hinge, swung open; an eye glint), its streaming mane three strips sampled
 * back in time along its leap (Arcana technique 4). The CHOMP is two fang rows (a front view: the upper jaw and the
 * same texture flipped for the lower) that fade in wide and SLAM shut over the struck portrait on the arrival beat,
 * interlocking; the bite marks they leave ride the portrait. Sparks, embers and dust are seasoning, and short.
 *
 * THE COLOSSUS (Tier IV) is the same jaws, huge: they fade in far above and below the target (the screen framed by
 * fangs) over a darkening backdrop, with burning eyes and a flaring mane of light, creep in breathing, SLAM, then spring
 * open on the roar and dissolve.
 *
 * LAYERS, bottom to top: haze (normal: dust, the backdrop, the tint over the face, bite marks) | glow (additive: glows,
 * mane glows, rings, blooms) | body (NORMAL: the beast and jaw bodies, so the amber holds on a light board) | core
 * (additive: the lit edges and fangs, eyes, flashes, sparks), so the scene batches in four runs. Mane vertex arrays are
 * rewritten in place; every strip is `MANE_POINTS` x 2 vertices, under Pixi's 100-vertex batch limit.
 *
 * Contract: sprites and strips are POOLED per layer (hidden and reused) and bounded by `MAX_BEAST_SPRITES` /
 * `MAX_BEAST_MESHES`; textures are the caller's (pre-warmed on the GPU during the damage formation, so no first-play
 * spike); positions are the overlay's px; `setCamera` mirrors the DOM camera; `update` returns whether anything still
 * draws; `destroy()` leaves nothing behind. Scatter is seeded (a replay kicks up the same dust).
 */
import { Container, MeshSimple, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeInOutSine, easeOutCubic, easeOutQuint, mixColor, seededRng, whiten } from '../heroAttack/easing';
import { beastPos, clampAlpha, clampGap, colossalGap, type BeastMotion } from './heroBeastConfig';
import { BITE_D, HEAD_ANCHOR, HEAD_EYE, HEAD_H, HEAD_HINGE, HEAD_MANE, HEAD_W, JAW_H, JAW_TIP_Y, JAW_W } from './heroBeastTextures';

export interface HeroBeastTextures extends HeroArcanaTextures {
  headUpper: Texture; headLower: Texture;
  headUpperEdge: Texture; headLowerEdge: Texture;
  headUpperGlow: Texture; headLowerGlow: Texture;
  /** The front-view upper jaw (the lower is it flipped). */
  jaw: Texture; jawEdge: Texture; jawGlow: Texture;
  /** The punctures the fang rows leave. */
  bite: Texture;
  /** A kicked-up dust billow. */
  dust: Texture;
  /** A soft-edged solid disc. */
  disc: Texture;
  /** A thick shockwave ring. */
  shock: Texture;
}

export interface BeastColors { core: number; amber: number; feral: number; fang: number; dark: number; dust: number; side: number }

export interface BeastLook {
  /** Head length, px at stage scale 1. */
  length: number;
  /** The beast's feral glow (0 = none). */
  glow: number;
  /** Mane length (ms of leap it spans; 0 = none). */
  maneMs: number;
  maneWidth: number;
  /** Embers shed along the leap (0 = none). */
  embers: number;
  /** How wide the beast's jaw swings open (radians). */
  jawOpen: number;
  /** The chomp: how long the jaws take to fade in and slam, how big, how long they clamp. */
  clampLead: number;
  clampSize: number;
  biteHold: number;
  /** How long the bite marks stay. */
  biteMarkMs: number;
  /** The feral tint over the struck face (peak opacity). */
  tint: number;
  dustSize: number;
  colossalSize: number;
  roarRings: number;
  roarSize: number;
}

/** Hard cap on sprites alive at once (a Tier IV peaks around 400). */
export const MAX_BEAST_SPRITES = 800;
/** Hard cap on mane strips alive at once (three per beast). */
export const MAX_BEAST_MESHES = 48;
/** Points along each mane: 32 vertices per strip, so every strip still batches. */
export const MANE_POINTS = 16;
/** The full chomp spans this many portrait radii across (a touch wider than the portrait). */
export const CLAMP_SPAN = 2.3;
/** The colossal jaws span this many portrait radii across. */
export const COLOSSAL_SPAN = 5.8;

type LayerId = 'haze' | 'glow' | 'body' | 'core';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [['haze', 'normal'], ['glow', 'add'], ['body', 'normal'], ['core', 'add']];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
const GLOW_PX = 128;
const DISC_PX = 128;
const SHOCK_PX = 256;
const UPPER_ANCHOR = { x: HEAD_ANCHOR.x / HEAD_W, y: HEAD_ANCHOR.y / HEAD_H };
const HINGE_ANCHOR = { x: HEAD_HINGE.x / HEAD_W, y: HEAD_HINGE.y / HEAD_H };
const JAW_ANCHOR = { x: 0.5, y: JAW_TIP_Y / JAW_H };
/** The lower row sits half a tooth over, so the fangs interlock rather than collide. */
const INTERLOCK_PX = 13;

interface Strip { mesh: MeshSimple; v: Float32Array; layer: LayerId }

interface Jaws { ug: Sprite; ub: Sprite; ue: Sprite; lg: Sprite; lb: Sprite; le: Sprite }

interface HeadParts { ug: Sprite; ub: Sprite; ue: Sprite; lg: Sprite; lb: Sprite; le: Sprite; eye: Sprite }

interface Beast {
  /** The plan's index of this beast (the runner's cue index). */
  idx: number;
  m: BeastMotion;
  age: number;
  /** Px per texture px (the length, the tier size and the stage scale folded in). */
  k: number;
  /** 1 = facing right; -1 = mirrored (facing left, still upright). */
  flip: 1 | -1;
  head: HeadParts | null;
  jaws: Jaws | null;
  /** The chomp's half-span (px): its gap unit. */
  rc: number;
  /** How long its jaws clamp (a tick lets go sooner, so each chomp in a pack reads on its own). */
  hold: number;
  shade: Strip | null; mglow: Strip | null; mcore: Strip | null;
  dust: boolean;
  phase: number;
  emberAcc: number; dustAcc: number;
  lastX: number; lastY: number;
  x: number; y: number; rot: number;
}

type AlphaMode = 'out' | 'punch' | 'hold';
interface Fx {
  s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number;
  /** y scale as a fraction of x (1 = round). */
  sy: number; spin: number; delay: number;
  /** Drift (px/s) and its drag per second (1 = none). */
  vx: number; vy: number; drag: number;
  /** Rides the struck portrait (its knockback). */
  follow: boolean;
  x: number; y: number;
}

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  from: number; to: number; alpha: number;
  /** Stretched along its velocity (a spark). */
  align: boolean;
}

interface Charge { ring: Sprite; bloom: Sprite; x: number; y: number; r: number; age: number; dur: number; left: number; releasing: number; moteAcc: number; motes: number }

interface Colossus {
  x: number; y: number; r: number; age: number;
  riseMs: number; slamMs: number; roarAt: number; releaseAt: number;
  jaws: Jaws; back: Sprite; bloom: Sprite;
  eyes: Sprite[]; mane: Sprite[];
  roared: boolean;
  /** Px of room above / below the target: an open jaw on a cramped side waits just off that edge. */
  room: { up: number; down: number; shift: number };
}

export class HeroBeastScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private readonly freeMeshes: Record<LayerId, MeshSimple[]>;
  private used = 0;
  private meshes = 0;
  private beasts: Beast[] = [];
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private charge: Charge | null = null;
  private colossus: Colossus | null = null;
  private warm: Sprite[] = [];
  /** A near-invisible mane strip per layer, so the mesh pipeline is compiled during the formation too. */
  private warmStrips: Strip[] = [];
  private warmLeft = 0;
  private destroyed = false;
  private fox = 0;
  private foy = 0;
  private readonly rnd: () => number;
  private readonly uvs: Float32Array;
  private readonly idx: Uint32Array;
  /** Deep amber for the normal-blend rings and waves (keeps its colour on a light board). */
  private readonly deep: number;
  /** The beasts' pelt: a deep feral green for the normal-blend bodies, jaws and manes (reads on any board). */
  private readonly pelt: number;
  /** The colossus: a near-black feral maw, so its gleaming fangs and burning rim carry it on any board. */
  private readonly maw: number;
  // scratch (the mane's centreline, normals and half-widths, reused by every beast every frame)
  private readonly px = new Float32Array(MANE_POINTS);
  private readonly py = new Float32Array(MANE_POINTS);
  private readonly nx = new Float32Array(MANE_POINTS);
  private readonly ny = new Float32Array(MANE_POINTS);
  private readonly hw = new Float32Array(MANE_POINTS);

  constructor(private readonly tex: HeroBeastTextures, private readonly colors: BeastColors, private readonly look: BeastLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroBeast';
    this.layers = {} as Record<LayerId, Container>;
    this.freeSprites = {} as Record<LayerId, Sprite[]>;
    this.freeMeshes = {} as Record<LayerId, MeshSimple[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `beast-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.freeSprites[id] = [];
      this.freeMeshes[id] = [];
    }
    this.rnd = seededRng(seed);
    this.deep = mixColor(colors.amber, colors.dark, 0.22);
    this.pelt = mixColor(colors.feral, colors.dark, 0.6);
    this.maw = mixColor(mixColor(colors.dark, 0x000000, 0.45), colors.feral, 0.12);
    const n = MANE_POINTS;
    this.uvs = new Float32Array(n * 4);
    for (let j = 0; j < n; j++) {
      const u = 1 - j / (n - 1); // the head is u = 1 (full), the tail u = 0 (faded in by the texture)
      this.uvs[j * 4] = u; this.uvs[j * 4 + 1] = 0; this.uvs[j * 4 + 2] = u; this.uvs[j * 4 + 3] = 1;
    }
    this.idx = new Uint32Array((n - 1) * 6);
    for (let j = 0; j < n - 1; j++) { const a = j * 2; this.idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], j * 6); }
    // PRE-WARM: one near-invisible sprite per texture for the first few hundred ms (the damage formation is still
    // playing), so every texture is on the GPU long before the first beast or the colossus needs it (no first-play spike).
    const t = tex;
    for (const w of [t.glow, t.spark, t.ring, t.streak, t.star, t.ribbonSoft, t.ribbonBody, t.headUpper, t.headLower, t.headUpperEdge, t.headLowerEdge,
      t.headUpperGlow, t.headLowerGlow, t.jaw, t.jawEdge, t.jawGlow, t.bite, t.dust, t.disc, t.shock]) {
      const s = this.take('core', w, 0xffffff);
      if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); }
    }
    // The manes are meshes: one near-invisible strip per strip layer warms the mesh pipeline as well.
    for (const [layer, t] of [['haze', tex.ribbonBody], ['glow', tex.ribbonSoft]] as const) {
      const st = this.strip(layer, t, 0xffffff);
      if (st) { st.v.fill(-40); st.v[2] = -38; st.v[5] = -38; st.mesh.alpha = 0.004; this.warmStrips.push(st); }
    }
    this.warmLeft = 400;
  }

  get liveSprites(): number { return this.used; }
  get liveMeshes(): number { return this.meshes; }
  get liveBeasts(): number { return this.beasts.length; }
  /** Beasts whose leap has landed (their jaws are on the portrait). */
  get landedBeasts(): number { let n = 0; for (const b of this.beasts) if (b.age >= b.m.flightMs) n++; return n; }
  get charging(): boolean { return this.charge !== null; }
  get colossusUp(): boolean { return this.colossus !== null; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) for (const ch of this.layers[id].children) if (ch instanceof Sprite) n++; return n; }
  /** A beast's chomp right now: the fang gap (in clamp radii; below 0 = interlocked) and its opacity. Tests + capture. */
  clampOf(i: number): { gap: number; alpha: number } | null {
    const b = this.beasts.find((x) => x.idx === i);
    if (!b) return null;
    const ms = b.age - b.m.flightMs;
    return { gap: clampGap(ms, this.look.clampLead, b.hold), alpha: clampAlpha(ms, this.look.clampLead, b.hold) };
  }
  /** The colossal jaws' gap right now (portrait radii), or null. */
  get colossusGap(): number | null {
    const c = this.colossus;
    return c ? colossalGap(c.age, c.riseMs, c.slamMs, c.roarAt, c.releaseAt) : null;
  }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  /** The struck portrait's knockback this frame (overlay px): the jaws, the marks and the tint ride it. */
  setFoeOffset(dx: number, dy: number): void { this.fox = Number.isFinite(dx) ? dx : 0; this.foy = Number.isFinite(dy) ? dy : 0; }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_BEAST_SPRITES) return null;
    let s = this.freeSprites[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(s: Sprite): void {
    const layer = (s.parent?.label?.replace('beast-', '') ?? 'core') as LayerId;
    s.visible = false; this.freeSprites[layer].push(s); this.used--;
  }

  private takeAll(specs: [LayerId, Texture, number][]): Sprite[] | null {
    const out: Sprite[] = [];
    for (const [l, t, c] of specs) {
      const s = this.take(l, t, c);
      if (!s) { for (const x of out) this.give(x); return null; }
      s.alpha = 0;
      out.push(s);
    }
    return out;
  }

  private strip(layer: LayerId, t: Texture, tint: number): Strip | null {
    if (this.destroyed || this.meshes >= MAX_BEAST_MESHES) return null;
    let mesh = this.freeMeshes[layer].pop();
    if (!mesh) {
      mesh = new MeshSimple({ texture: t, vertices: new Float32Array(MANE_POINTS * 4), uvs: this.uvs, indices: this.idx });
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
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.2, sy: 1, spin: 0, delay: 0, vx: 0, vy: 0, drag: 1, follow: false, x, y, ...o };
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

  /** Sparks thrown from a point: sharp streaks along their flight (the bite's spray), slowing fast. */
  private sparks(x: number, y: number, n: number, speed: number, o: { dir?: number; spread?: number; life?: number; size?: number } = {}): void {
    const S = this.scale;
    const tints = [this.colors.amber, this.colors.feral, whiten(this.colors.amber, 0.5)];
    for (let i = 0; i < n; i++) {
      const a = o.dir === undefined ? this.rnd() * Math.PI * 2 : o.dir + (this.rnd() - 0.5) * (o.spread ?? 1.4);
      const sp = speed * (0.45 + this.rnd() * 0.8) * S;
      const sz = (o.size ?? 0.6) * (0.55 + this.rnd() * 0.7);
      this.particle('core', this.tex.streak, tints[i % 3]!, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.08, grav: 260 * S,
        life: (o.life ?? 360) * (0.7 + this.rnd() * 0.6), from: sz * S, to: sz * 0.3 * S, alpha: 1, align: true,
      });
    }
  }

  /** Embers: soft motes drifting up and fading. */
  private embers(x: number, y: number, n: number, o: { vx?: number; vy?: number; spread?: number; life?: number } = {}): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const sp = (o.spread ?? 60) * S;
      this.particle('core', this.tex.spark, i % 2 ? this.colors.feral : this.colors.amber, {
        x, y, vx: (o.vx ?? 0) * S + (this.rnd() - 0.5) * sp, vy: (o.vy ?? -40) * S + (this.rnd() - 0.5) * sp, drag: 0.4, grav: -40 * S,
        life: (o.life ?? 520) * (0.6 + this.rnd() * 0.7), from: (0.5 + this.rnd() * 0.4) * S, to: 0.15 * S, alpha: 0.95, align: false,
      });
    }
  }

  /** A dust billow kicked up (normal blend, so it reads as earth on any board). */
  private dust(x: number, y: number, size: number, o: { vx?: number; vy?: number; dur?: number; a0?: number; follow?: boolean } = {}): void {
    const S = this.scale;
    const sz = size * this.look.dustSize;
    const f = this.fxs('haze', this.tex.dust, this.colors.dust, x, y, {
      dur: o.dur ?? 560, from: 0.3 * sz, to: 0.85 * sz, a0: o.a0 ?? 0.5, mode: 'hold', vx: (o.vx ?? 0) * S, vy: (o.vy ?? -24) * S, drag: 0.2,
      spin: (this.rnd() - 0.5) * 0.0016, follow: o.follow ?? false,
    });
    if (f) f.s.rotation = this.rnd() * Math.PI * 2;
  }

  /** The feral tint over the struck face: an amber-green disc inside the frame that pulses (opacity only). */
  private tintPulse(x: number, y: number, radius: number, strength: number, dur: number): void {
    const d = (radius * 1.8) / DISC_PX / this.scale;
    this.fxs('haze', this.tex.disc, mixColor(this.colors.amber, this.colors.feral, 0.4), x, y, { dur, from: d * 0.97, to: d, a0: this.look.tint * strength, mode: 'punch', peakAt: 0.14, follow: true });
    const sh = (radius * 2.1) / SHOCK_PX / this.scale;
    this.fxs('glow', this.tex.shock, this.colors.feral, x, y, { dur: dur * 0.9, from: sh * 0.96, to: sh * 1.05, a0: 0.3 * strength, mode: 'punch', peakAt: 0.12, follow: true });
  }

  /** Bite marks on the face (the punctures, dark, with an amber glow in them), riding the portrait. */
  private marks(x: number, y: number, rc: number, tilt: number, strength: number): void {
    const k = (CLAMP_SPAN * rc) / BITE_D / this.scale;
    const dark = this.fxs('haze', this.tex.bite, this.colors.dark, x, y, { dur: this.look.biteMarkMs, from: k, to: k, a0: 0.85 * strength, mode: 'hold', follow: true });
    if (dark) dark.s.rotation = tilt;
    const lit = this.fxs('glow', this.tex.bite, this.colors.amber, x, y, { dur: this.look.biteMarkMs * 0.6, from: k * 1.04, to: k * 1.06, a0: 0.7 * strength, mode: 'hold', follow: true });
    if (lit) lit.s.rotation = tilt;
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The growl: feral energy gathers round the hero (an amber ring closing in, a green bloom swelling, embers drawn in).
   * Held through the pack; released as the LAST beast leaps (`launches` counts them down).
   */
  startCharge(x: number, y: number, radius: number, durMs: number, launches: number, motes: number): void {
    if (this.charge) return;
    const ring = this.take('glow', this.tex.shock, this.colors.amber);
    const bloom = this.take('glow', this.tex.glow, this.colors.feral);
    if (!ring || !bloom) { for (const s of [ring, bloom]) if (s) this.give(s); return; }
    for (const s of [ring, bloom]) { s.position.set(x, y); s.alpha = 0; }
    this.charge = { ring, bloom, x, y, r: radius, age: 0, dur: Math.max(1, durMs), left: Math.max(1, launches), releasing: -1, moteAcc: 0, motes };
  }

  /**
   * A beast bursts off the hero along `m`: a flash, a ring, embers flung back (and dust at III and up), and the beast
   * itself with its mane and the jaws that will clamp at `m.bite`. `radius` is the struck portrait's. `age0` = ms elapsed.
   */
  launch(m: BeastMotion, size: number, radius: number, age0 = 0, idx = this.beasts.length, dust = false): void {
    const ch = this.charge;
    if (ch && ch.releasing < 0 && --ch.left <= 0) ch.releasing = 0;
    const S = this.scale;
    const c = this.colors;
    const a = m.a;
    const head = Math.atan2(m.c.y - a.y, m.c.x - a.x);
    this.fxs('core', this.tex.glow, c.core, a.x, a.y, { dur: 120, from: 0.3, to: 0.9, a0: 0.8 });
    this.fxs('glow', this.tex.glow, c.feral, a.x, a.y, { dur: 260, from: 0.5, to: 1.5, a0: 0.5, mode: 'punch', peakAt: 0.15 });
    const ring = this.fxs('glow', this.tex.ring, c.amber, a.x, a.y, { dur: 240, from: 0.2, to: 0.8, a0: 0.85, sy: 0.5 });
    if (ring) ring.s.rotation = head + Math.PI / 2;
    this.embers(a.x, a.y, 5, { vx: -Math.cos(head) * 120, vy: -Math.sin(head) * 120 - 30, spread: 120, life: 420 });
    if (dust) for (let i = 0; i < 2; i++) this.dust(a.x - Math.cos(head) * 20 * S, a.y + 26 * S, 0.8, { vx: -Math.cos(head) * 80 + (i ? 40 : -40), vy: -30, a0: 0.45 });
    const k = (this.look.length / HEAD_W) * size * S;
    const flip: 1 | -1 = Math.cos(Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x)) < 0 ? -1 : 1;
    const hp = this.takeAll([
      ['glow', this.tex.headUpperGlow, c.feral], ['body', this.tex.headUpper, this.pelt], ['core', this.tex.headUpperEdge, whiten(c.amber, 0.55)],
      ['glow', this.tex.headLowerGlow, c.feral], ['body', this.tex.headLower, this.pelt], ['core', this.tex.headLowerEdge, whiten(c.amber, 0.55)],
      ['core', this.tex.glow, c.amber],
    ]);
    const head2: HeadParts | null = hp ? { ug: hp[0]!, ub: hp[1]!, ue: hp[2]!, lg: hp[3]!, lb: hp[4]!, le: hp[5]!, eye: hp[6]! } : null;
    if (head2) {
      for (const s of [head2.ug, head2.ub, head2.ue]) s.anchor.set(UPPER_ANCHOR.x, UPPER_ANCHOR.y);
      for (const s of [head2.lg, head2.lb, head2.le]) s.anchor.set(HINGE_ANCHOR.x, HINGE_ANCHOR.y);
    }
    const jaws = this.jaws();
    const shade = this.look.maneMs > 0 ? this.strip('haze', this.tex.ribbonBody, this.pelt) : null;
    const mglow = this.look.maneMs > 0 ? this.strip('glow', this.tex.ribbonSoft, c.feral) : null;
    const mcore = this.look.maneMs > 0 ? this.strip('glow', this.tex.ribbonBody, whiten(c.amber, 0.35)) : null;
    const p0 = beastPos(m, Math.max(0, age0));
    this.beasts.push({
      idx, m, age: Math.max(0, age0), k, flip, head: head2, jaws, rc: radius * this.look.clampSize * m.bite.scale, hold: m.bite.scale < 1 ? this.look.biteHold * 0.5 : this.look.biteHold,
      shade, mglow, mcore, dust, phase: this.rnd() * Math.PI * 2, emberAcc: 0, dustAcc: 0,
      lastX: p0.x, lastY: p0.y, x: p0.x, y: p0.y, rot: p0.rot,
    });
  }

  /** A pair of front-view jaws (upper + the flipped lower), glow, body and edge each. */
  private jaws(): Jaws | null {
    const c = this.colors;
    const js = this.takeAll([
      ['glow', this.tex.jawGlow, c.feral], ['body', this.tex.jaw, this.pelt], ['core', this.tex.jawEdge, c.fang],
      ['glow', this.tex.jawGlow, c.feral], ['body', this.tex.jaw, this.pelt], ['core', this.tex.jawEdge, c.fang],
    ]);
    if (!js) return null;
    for (const s of js) s.anchor.set(JAW_ANCHOR.x, JAW_ANCHOR.y);
    return { ug: js[0]!, ub: js[1]!, ue: js[2]!, lg: js[3]!, lb: js[4]!, le: js[5]! };
  }

  private beastOf(i: number): Beast | undefined { return this.beasts.find((b) => b.idx === i); }

  /**
   * A chomp lands before the last (a tick): a flash where the fangs meet, a ring, a spray of sparks, bite marks left in
   * the face, a feral tint pulse and (III and up) a puff of dust. `step` grows each tick.
   */
  chomp(i: number, x: number, y: number, radius: number, step: number): void {
    const b = this.beastOf(i);
    const bx = b ? b.m.bite.x : x, by = b ? b.m.bite.y : y;
    const rc = b ? b.rc : radius * 0.74;
    const tilt = b ? b.m.bite.tilt : 0;
    const g = 1 + 0.06 * step;
    const c = this.colors;
    this.fxs('core', this.tex.glow, c.core, bx, by, { dur: 110, from: 0.4 * g, to: 1.1 * g, a0: 0.85, follow: true });
    this.fxs('glow', this.tex.glow, c.amber, bx, by, { dur: 260, from: 0.8 * g, to: 1.8 * g, a0: 0.45, follow: true });
    const ring = this.fxs('glow', this.tex.ring, c.amber, bx, by, { dur: 260, from: 0.2, to: 0.9 * g, a0: 0.85, sy: 0.6, follow: true });
    if (ring) ring.s.rotation = tilt;
    // Sparks burst out of the bite line, sideways (the jaws closed top and bottom), and up.
    this.sparks(bx, by, 5, 420, { dir: tilt, spread: 0.9, life: 300, size: 0.5 });
    this.sparks(bx, by, 5, 420, { dir: tilt + Math.PI, spread: 0.9, life: 300, size: 0.5 });
    this.marks(bx, by, rc, tilt, 0.85);
    this.tintPulse(x, y, radius, 0.5, 300);
    if (b?.dust) this.dust(bx, by + rc * 0.5, 0.7, { vy: -40, a0: 0.4, follow: true });
  }

  /**
   * THE impact (I-III): the last chomp, full size, dead centre. The first frame is the brightest: a white-hot flash
   * over the face, a flash where the fangs meet, two rings, a burst of sparks sideways off the bite line, embers, deep
   * bite marks, the strongest tint pulse and (III) a ring of dust. The fills are gone in ~150 ms, so the big -N reads.
   */
  impact(i: number, x: number, y: number, radius: number, o: { tier: number; k: number; burst: number; sparks: number; flashAlpha: number }): void {
    const c = this.colors;
    const b = this.beastOf(i);
    const bx = b ? b.m.bite.x : x, by = b ? b.m.bite.y : y;
    const rc = b ? b.rc : radius;
    const tilt = b ? b.m.bite.tilt : 0;
    const fs = o.burst;
    const portrait = (radius * 2) / GLOW_PX / this.scale;
    this.fxs('core', this.tex.glow, c.core, x, y, { dur: 110, from: portrait, to: portrait * 1.2, a0: 0.5 * o.flashAlpha, follow: true });
    this.fxs('core', this.tex.glow, c.core, bx, by, { dur: 150, from: 0.8 * fs, to: 2 * fs, a0: o.flashAlpha, follow: true });
    this.fxs('glow', this.tex.glow, c.amber, bx, by, { dur: 360, from: 1.4 * fs, to: 3 * fs, a0: 0.45 * o.flashAlpha, follow: true });
    // A white streak along the bite line: the fangs meeting, read at a glance.
    const line = this.fxs('core', this.tex.streak, c.core, bx, by, { dur: 160, from: 2.4 * fs, to: 4.2 * fs, a0: 0.9, sy: 0.35, follow: true });
    if (line) line.s.rotation = tilt;
    const r1 = this.fxs('glow', this.tex.ring, c.core, bx, by, { dur: 280, from: 0.25, to: 1.5 * (0.9 + 0.3 * o.k), a0: 1, follow: true });
    if (r1) r1.s.rotation = tilt;
    this.fxs('glow', this.tex.ring, c.feral, bx, by, { dur: 500, from: 0.3, to: 2.6 * (0.85 + 0.4 * o.k), a0: 0.7 });
    const n = Math.max(0, o.sparks);
    this.sparks(bx, by, Math.round(n * 0.4), 620, { dir: tilt, spread: 1.2, life: 420, size: 0.7 });
    this.sparks(bx, by, Math.round(n * 0.4), 620, { dir: tilt + Math.PI, spread: 1.2, life: 420, size: 0.7 });
    this.sparks(bx, by, Math.round(n * 0.2), 420, { life: 380, size: 0.5 });
    this.embers(bx, by, 4 + o.tier * 2, { vy: -70, spread: 140, life: 700 });
    this.marks(bx, by, rc, tilt, 1);
    this.tintPulse(x, y, radius, 1, 460);
    if (b?.dust) {
      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * Math.PI * 2 + this.rnd() * 0.4;
        this.dust(x + Math.cos(a) * radius * 0.7, y + Math.sin(a) * radius * 0.7, 0.9, { vx: Math.cos(a) * 90, vy: Math.sin(a) * 60 - 30, a0: 0.45, dur: 700 });
      }
    }
  }

  /**
   * TIER IV: the colossus rises behind the target. Its jaws fade in far above and below (the screen framed by fangs)
   * over a darkening backdrop; its eyes ignite; a mane of light flares round it. The jaws creep in (`riseMs`), SLAM
   * (`slamMs`), spring open on the roar (`roarAfter` ms after the rise starts) and dissolve (`releaseAfter`).
   */
  startRise(x: number, y: number, radius: number, riseMs: number, slamMs: number, roarAfter: number, releaseAfter: number, room: { up: number; down: number; shift?: number } = { up: Infinity, down: Infinity }): void {
    if (this.colossus) return;
    const c = this.colors;
    const jaws = this.jaws();
    if (jaws) { jaws.ub.tint = this.maw; jaws.lb.tint = this.maw; jaws.ue.tint = whiten(c.amber, 0.7); jaws.le.tint = whiten(c.amber, 0.7); }
    const back = this.take('haze', this.tex.disc, c.dark);
    const bloom = this.take('glow', this.tex.glow, c.feral);
    if (!jaws || !back || !bloom) {
      if (jaws) for (const s of Object.values(jaws)) this.give(s);
      for (const s of [back, bloom]) if (s) this.give(s);
      return;
    }
    for (const s of [back, bloom]) { s.position.set(x, y); s.alpha = 0; }
    const eyes: Sprite[] = [];
    for (let e = 0; e < 2; e++) {
      const g = this.take('core', this.tex.glow, c.amber);
      const slit = this.take('core', this.tex.streak, whiten(c.amber, 0.6));
      for (const s of [g, slit]) if (s) { s.alpha = 0; eyes.push(s); }
    }
    const mane: Sprite[] = [];
    for (let m = 0; m < 14; m++) {
      const s = this.take('glow', this.tex.streak, m % 2 ? c.feral : c.amber);
      if (s) { s.alpha = 0; s.anchor.set(0, 0.5); mane.push(s); }
    }
    this.colossus = {
      x, y, r: radius, age: 0, riseMs: Math.max(1, riseMs), slamMs: Math.max(1, slamMs), roarAt: Math.max(riseMs + slamMs, roarAfter),
      releaseAt: Math.max(roarAfter, releaseAfter), jaws, back, bloom, eyes, mane, roared: false,
      room: { up: room.up, down: room.down, shift: Number.isFinite(room.shift) ? room.shift! : 0 },
    };
    this.dust(x, y + radius * 1.2, 1.4, { vy: -20, a0: 0.3, dur: 900 });
  }

  /**
   * TIER IV's SLAM (THE impact): the colossal jaws are shut over the whole portrait. A white flash over the face, a
   * shockwave, a thick amber ring, a flash along the bite line, a storm of sparks off both sides, embers, huge bite
   * marks, dust thrown out all round and the strongest tint.
   */
  slam(x: number, y: number, radius: number, o: { burst: number; sparks: number; flashAlpha: number }): void {
    const c = this.colors;
    const S = this.scale;
    const fs = o.burst;
    const portrait = (radius * 2) / GLOW_PX / S;
    const shock = (radius * 2) / SHOCK_PX / S;
    this.fxs('core', this.tex.glow, c.core, x, y, { dur: 130, from: portrait * 1.1, to: portrait * 1.5, a0: 0.8 * o.flashAlpha, follow: true });
    this.fxs('core', this.tex.glow, c.core, x, y, { dur: 170, from: 1.2 * fs, to: Math.min(4.5, 2.6 * fs), a0: o.flashAlpha });
    this.fxs('glow', this.tex.glow, c.amber, x, y, { dur: 260, from: 1.6 * fs, to: Math.min(5, 3.2 * fs), a0: 0.4 * o.flashAlpha });
    const span = (COLOSSAL_SPAN * radius * this.look.colossalSize) / 64 / S;
    this.fxs('core', this.tex.streak, c.core, x, y, { dur: 200, from: span * 0.5, to: span * 0.85, a0: 0.95, sy: 0.3 });
    this.fxs('body', this.tex.shock, this.deep, x, y, { dur: 560, from: shock * 0.6, to: shock * 3.6, a0: 0.55 });
    this.fxs('glow', this.tex.shock, c.amber, x, y, { dur: 460, from: shock * 0.5, to: shock * 3, a0: 0.8 });
    this.fxs('glow', this.tex.ring, c.feral, x, y, { dur: 700, from: 0.5, to: 4.4, a0: 0.45, sy: 0.55 });
    const n = Math.max(0, o.sparks);
    this.sparks(x, y, Math.round(n * 0.4), 900, { dir: 0, spread: 1.1, life: 520, size: 0.85 });
    this.sparks(x, y, Math.round(n * 0.4), 900, { dir: Math.PI, spread: 1.1, life: 520, size: 0.85 });
    this.sparks(x, y, Math.round(n * 0.2), 600, { life: 460, size: 0.6 });
    this.embers(x, y, 12, { vy: -80, spread: 220, life: 900 });
    this.marks(x, y, radius * 1.15, 0, 1);
    for (let p = 0; p < 10; p++) {
      const a = (p / 10) * Math.PI * 2 + this.rnd() * 0.4;
      this.dust(x + Math.cos(a) * radius * 0.8, y + Math.sin(a) * radius * 0.8, 1.2, { vx: Math.cos(a) * 160, vy: Math.sin(a) * 110 - 30, a0: 0.5, dur: 900 });
    }
    this.tintPulse(x, y, radius, 1.2, 620);
  }

  /**
   * TIER IV's ROAR (FX only, after the blow): the jaws spring open; shockwave rings tear outward one after another;
   * speed lines streak away all round; the mane blasts outward and dust is thrown off.
   */
  roar(x: number, y: number, radius: number): void {
    const cz = this.colossus;
    if (cz) cz.roared = true;
    const c = this.colors;
    const S = this.scale;
    const L = this.look;
    const shock = (radius * 2) / SHOCK_PX / S;
    const rings = Math.max(0, Math.min(6, Math.round(L.roarRings)));
    for (let r = 0; r < rings; r++) {
      this.fxs('glow', this.tex.shock, r % 2 ? c.feral : c.amber, x, y, { dur: 620, from: shock * 0.8, to: shock * (4.2 + r * 0.8) * L.roarSize, a0: 0.65 - 0.1 * r, delay: r * 95 });
    }
    this.fxs('body', this.tex.shock, this.deep, x, y, { dur: 700, from: shock, to: shock * 5 * L.roarSize, a0: 0.35 });
    this.fxs('glow', this.tex.glow, c.feral, x, y, { dur: 420, from: 2, to: 4.5 * L.roarSize, a0: 0.35, mode: 'punch', peakAt: 0.2 });
    // Speed lines: the roar's blast, read at a glance.
    const lines = 18;
    for (let i = 0; i < lines; i++) {
      const a = (i / lines) * Math.PI * 2 + (this.rnd() - 0.5) * 0.2;
      const r0 = radius * (1.3 + this.rnd() * 0.4);
      const f = this.fxs('core', this.tex.streak, i % 2 ? c.amber : whiten(c.feral, 0.3), x + Math.cos(a) * r0, y + Math.sin(a) * r0, {
        dur: 360, from: 3 * L.roarSize, to: 5.5 * L.roarSize, a0: 0.75, sy: 0.22, vx: Math.cos(a) * 1500 * L.roarSize, vy: Math.sin(a) * 1500 * L.roarSize, drag: 0.02, delay: (i % 3) * 30,
      });
      if (f) f.s.rotation = a;
    }
    for (let p = 0; p < 8; p++) {
      const a = (p / 8) * Math.PI * 2 + this.rnd() * 0.5;
      this.dust(x + Math.cos(a) * radius * 1.1, y + Math.sin(a) * radius * 1.1, 1.1, { vx: Math.cos(a) * 240, vy: Math.sin(a) * 160, a0: 0.4, dur: 800 });
    }
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
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; for (const st of this.warmStrips) this.giveStrip(st); this.warmStrips = []; }
    }

    const ch = this.charge;
    if (ch) {
      ch.age += dt;
      const u = clamp01(ch.age / ch.dur);
      if (ch.releasing < 0) {
        const e = easeOutCubic(u);
        const rr = ((ch.r * 2) / SHOCK_PX) * (1.9 - 0.75 * e);
        ch.ring.scale.set(rr); ch.ring.alpha = 0.4 * Math.min(1, u * 3) * (0.85 + 0.15 * Math.sin(ch.age * 0.04));
        const throb = 1 + 0.1 * Math.sin(ch.age * (0.03 + 0.05 * u));
        ch.bloom.scale.set(((ch.r * 2.2) / GLOW_PX) * (0.7 + 0.4 * e) * throb); ch.bloom.alpha = 0.12 + 0.3 * u;
        ch.moteAcc += (ch.motes / ch.dur) * dt;
        while (ch.moteAcc >= 1) {
          ch.moteAcc -= 1;
          const a = this.rnd() * Math.PI * 2;
          const r = ch.r * (1.4 + this.rnd() * 0.6);
          const life = 200 + this.rnd() * 60;
          const sp = r / (life / 1000);
          this.particle('core', this.tex.streak, this.rnd() < 0.5 ? this.colors.feral : this.colors.amber, {
            x: ch.x + Math.cos(a) * r, y: ch.y + Math.sin(a) * r, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp,
            drag: 1, grav: 0, life, from: 0.45 * S, to: 0.2 * S, alpha: 1, align: true,
          });
        }
      } else {
        ch.releasing += dt;
        const r = clamp01(ch.releasing / 200);
        ch.ring.alpha = 0.4 * (1 - r);
        ch.bloom.alpha = (0.42) * (1 - r);
        if (r >= 1) { for (const s of [ch.ring, ch.bloom]) this.give(s); this.charge = null; }
      }
    }

    for (let i = this.beasts.length - 1; i >= 0; i--) {
      const b = this.beasts[i]!;
      b.age += dt;
      if (this.drawBeast(b)) continue;
      this.dropBeast(b);
      this.beasts.splice(i, 1);
    }

    if (this.colossus && !this.drawColossus(this.colossus, dt)) {
      this.dropColossus(this.colossus);
      this.colossus = null;
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
      const sc = (q.from + (q.to - q.from) * easeOutQuint(u)) * S;
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
      if (p.life <= 0) { this.give(p.s); this.particles.splice(i, 1); continue; }
      const damp = Math.pow(p.drag, sec);
      p.vx *= damp; p.vy = p.vy * damp + p.grav * sec;
      p.x += p.vx * sec; p.y += p.vy * sec;
      const t = 1 - p.life / p.max;
      const sc = p.from + (p.to - p.from) * t;
      p.s.position.set(p.x, p.y);
      if (p.align) {
        const v = Math.hypot(p.vx, p.vy);
        p.s.rotation = Math.atan2(p.vy, p.vx);
        p.s.scale.set(sc * (1 + Math.min(1.8, v / (700 * S))), sc * 0.5);
      } else p.s.scale.set(sc);
      p.s.alpha = p.alpha * (1 - t * t);
    }

    return this.used > this.warm.length || this.meshes > this.warmStrips.length || this.colossus !== null || this.beasts.length > 0;
  }

  /** Pose one beast (the head in its leap, pouncing, dissolving) and its chomp. False when it has nothing left to draw. */
  private drawBeast(b: Beast): boolean {
    const m = b.m;
    const L = this.look;
    const S = this.scale;
    const since = b.age - m.flightMs;
    const flying = since < 0;
    const p = beastPos(m, b.age);
    let x = p.x, y = p.y;
    const rot = flying ? p.rot : m.rot;
    const u = clamp01(b.age / Math.max(1, m.flightMs));
    // The head: materialises off the hero, POUNCES (swells) over the last stretch, snaps its jaw shut on arrival and
    // dissolves into the bite as the front jaws take it.
    let alpha = clamp01(b.age / 90);
    let size = (0.62 + 0.38 * easeOutCubic(clamp01(b.age / 140))) * (1 + 0.24 * easeInOutSine(clamp01((u - 0.62) / 0.38)));
    let open = L.jawOpen * easeInOutSine(clamp01((u - 0.35) / 0.5));
    if (!flying) {
      const v = clamp01(since / 60);
      open = L.jawOpen * (1 - v) * (1 - v);
      const f = clamp01((since - 20) / 150);
      alpha *= 1 - f;
      size *= 1 + 0.18 * f;
      x += Math.cos(rot) * 18 * S * f; y += Math.sin(rot) * 18 * S * f;
    }
    // A stride: the head bobs as it runs (a gallop, not a glide), fading out into the pounce.
    const bob = flying ? Math.sin(b.age * 0.034 + b.phase) * 4 * S * (1 - u) : 0;
    y += bob;
    b.x = x; b.y = y; b.rot = rot;
    const hd = b.head;
    const headAlive = flying || since < 180;
    if (hd) {
      const k = b.k * size;
      const f = b.flip;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      for (const s of [hd.ug, hd.ub, hd.ue]) { s.position.set(x, y); s.rotation = rot; s.scale.set(k, k * f); }
      // The hinge, from the mouth anchor, in the head's frame (mirrored with it).
      const hx = (HEAD_HINGE.x - HEAD_ANCHOR.x) * k, hy = (HEAD_HINGE.y - HEAD_ANCHOR.y) * k * f;
      const jx = x + hx * cr - hy * sr, jy = y + hx * sr + hy * cr;
      for (const s of [hd.lg, hd.lb, hd.le]) { s.position.set(jx, jy); s.rotation = rot + open * f; s.scale.set(k, k * f); }
      const glowA = alpha * L.glow * (0.75 + 0.25 * Math.sin(b.age * 0.05 + b.phase));
      hd.ug.alpha = glowA; hd.lg.alpha = glowA;
      hd.ub.alpha = alpha * 0.85; hd.lb.alpha = alpha * 0.85;
      hd.ue.alpha = alpha; hd.le.alpha = alpha;
      const ex = (HEAD_EYE.x - HEAD_ANCHOR.x) * k, ey = (HEAD_EYE.y - HEAD_ANCHOR.y) * k * f;
      hd.eye.position.set(x + ex * cr - ey * sr, y + ex * sr + ey * cr);
      hd.eye.scale.set((0.28 + 0.06 * Math.sin(b.age * 0.07 + b.phase)) * (k / 0.74));
      hd.eye.alpha = alpha * 0.95;
      if (!headAlive) { for (const s of Object.values(hd)) this.give(s); b.head = null; }
    }

    // The streaming mane, from the back of the skull, sampled back in time.
    const maneAlive = b.mglow !== null && (flying || since < L.maneMs + 40);
    if (b.mglow) {
      if (maneAlive) this.drawMane(b, flying, since);
      else { this.giveStrip(b.shade); this.giveStrip(b.mglow); this.giveStrip(b.mcore); b.shade = b.mglow = b.mcore = null; }
    }

    // Embers and (III and up) dust shed along the leap.
    if (flying) {
      const moved = Math.hypot(x - b.lastX, y - b.lastY);
      if (L.embers > 0) {
        b.emberAcc += moved;
        const every = (70 / L.embers) * S;
        while (b.emberAcc >= every) {
          b.emberAcc -= every;
          const back = (HEAD_MANE.x - HEAD_ANCHOR.x) * b.k * size;
          this.embers(x + Math.cos(rot) * back, y + Math.sin(rot) * back, 1, { vx: -Math.cos(rot) * 60, vy: -50, spread: 50, life: 420 });
        }
      }
      if (b.dust) {
        b.dustAcc += moved;
        const every = 58 * S;
        while (b.dustAcc >= every) {
          b.dustAcc -= every * (0.7 + 0.6 * this.rnd());
          // Kicked up under the beast (screen down from its jaw), thrown back against its run, scattered (never a row of beads).
          const j = (this.rnd() - 0.5) * 26 * S;
          this.dust(x - Math.cos(rot) * (30 + this.rnd() * 30) * S + j, y + HEAD_H * b.k * (0.34 + 0.2 * this.rnd()), 0.6 + 0.5 * this.rnd(), {
            vx: -Math.cos(rot) * (60 + 80 * this.rnd()) + (this.rnd() - 0.5) * 60, vy: -20 - 40 * this.rnd(), a0: 0.34, dur: 460 + 200 * this.rnd(),
          });
        }
      }
    }
    b.lastX = x; b.lastY = y;

    // The chomp: the front jaws fade in wide as it pounces and SLAM shut on the arrival beat.
    const jw = b.jaws;
    let jawsAlive = false;
    if (jw) {
      const lead = L.clampLead, hold = b.hold;
      const a = clampAlpha(since, lead, hold);
      jawsAlive = since < hold + 240;
      if (!jawsAlive) { for (const s of Object.values(jw)) this.give(s); b.jaws = null; }
      else this.poseJaws(jw, m.bite.x + this.fox, m.bite.y + this.foy, b.rc, m.bite.tilt, clampGap(since, lead, hold), a, since, 1);
    }
    return b.head !== null || b.mglow !== null || jawsAlive;
  }

  /**
   * Pose a pair of front jaws: centre `(x, y)`, half-span `rc` (px; also the gap unit), tilt, the gap between the fang
   * tips (in `rc`; below 0 = interlocked), opacity. A grind while they clamp (a small side-to-side worry).
   */
  private poseJaws(j: Jaws, x: number, y: number, rc: number, tilt: number, gap: number, alpha: number, since: number, grind: number, gapLow = gap): void {
    const k = (CLAMP_SPAN * rc) / JAW_W;
    const cr = Math.cos(tilt), sr = Math.sin(tilt);
    const worry = since > 0 ? Math.sin(since * 0.09) * Math.exp(-since / 220) * 2.2 * this.scale * grind : 0;
    const d = gap * rc, dl = gapLow * rc;
    const ux = x + (worry) * cr - (-d) * sr, uy = y + (worry) * sr + (-d) * cr;
    const lx = x + (INTERLOCK_PX * k - worry) * cr - dl * sr, ly = y + (INTERLOCK_PX * k - worry) * sr + dl * cr;
    for (const s of [j.ug, j.ub, j.ue]) { s.position.set(ux, uy); s.rotation = tilt; s.scale.set(k, k); }
    for (const s of [j.lg, j.lb, j.le]) { s.position.set(lx, ly); s.rotation = tilt; s.scale.set(k, -k); }
    const glow = alpha * 0.3 * this.look.glow;
    j.ug.alpha = glow; j.lg.alpha = glow;
    j.ub.alpha = alpha * 0.9; j.lb.alpha = alpha * 0.9;
    j.ue.alpha = alpha; j.le.alpha = alpha;
  }

  private drawColossus(cz: Colossus, dt: number): boolean {
    cz.age += dt;
    const t = cz.age;
    const end = cz.releaseAt + 380;
    if (t >= end) return false;
    const rise = clamp01(t / cz.riseMs);
    const fadeIn = easeOutCubic(clamp01(t / (cz.riseMs * 0.55)));
    const gone = clamp01((t - cz.releaseAt) / 360);
    const alpha = fadeIn * (1 - gone);
    const R = cz.r;
    const size = this.look.colossalSize;
    // The maw is centred a little toward the middle of the screen (the target stays inside it); the jaws still close on
    // the target's line.
    const x = cz.x + cz.room.shift + this.fox, y = cz.y + this.foy;
    const rcz = (COLOSSAL_SPAN / CLAMP_SPAN) * R * size;
    const gap = colossalGap(t, cz.riseMs, cz.slamMs, cz.roarAt, cz.releaseAt);
    // Breathing: a slow swell while it looms; grown a touch as it dissolves.
    const breathe = 1 + (t < cz.riseMs ? 0.03 * Math.sin(t * 0.012) : 0) + 0.1 * gone;
    // The gap is in PORTRAIT radii: convert to the jaw's own unit. A jaw on a side with little room waits with its
    // fang tips just inside that edge (never far off screen), then slams in with the other.
    const fit = (room: number): number => (gap > 0 ? Math.min(gap, Math.max(0.55, (room - 28 * this.scale) / R)) : gap);
    const gu = fit(cz.room.up), gl = fit(cz.room.down);
    this.poseJaws(cz.jaws, x, y, rcz * breathe, 0, (gu * R) / (rcz * breathe), alpha, t - cz.riseMs - cz.slamMs, 2.2, (gl * R) / (rcz * breathe));
    // The backdrop: the looming beast's shadow behind the target, and its feral bloom.
    const bd = (R * 7 * size) / DISC_PX;
    cz.back.position.set(x, y); cz.back.scale.set(bd * (0.92 + 0.08 * rise)); cz.back.alpha = 0.34 * alpha * (cz.roared ? 0.7 : 1);
    cz.bloom.position.set(x, y); cz.bloom.scale.set(((R * 6 * size) / GLOW_PX) * (1 + 0.05 * Math.sin(t * 0.02))); cz.bloom.alpha = (0.1 + 0.14 * rise) * alpha;
    // The eyes: above the upper jaw, igniting late in the rise and burning.
    const kj = (CLAMP_SPAN * rcz * breathe) / JAW_W;
    const topY = y - fit(cz.room.up) * R - (JAW_TIP_Y - 8) * kj;
    const eyeA = clamp01((t - cz.riseMs * 0.3) / (cz.riseMs * 0.35)) * (1 - gone) * (0.85 + 0.15 * Math.sin(t * 0.05));
    for (let e = 0; e < cz.eyes.length; e++) {
      const s = cz.eyes[e]!;
      const sgn = e < 2 ? -1 : 1;
      s.position.set(x + sgn * 62 * kj, topY - 8 * kj);
      if (e % 2 === 0) { s.scale.set(((R * 0.7 * size) / GLOW_PX) * (1 + 0.1 * Math.sin(t * 0.04))); s.alpha = eyeA * 0.8; } else {
        s.rotation = sgn * -0.28; s.scale.set((R * 0.75 * size) / 64, (R * 0.2 * size) / 18); s.alpha = eyeA;
      }
    }
    // The mane of light: flame streaks round the colossus, flickering; they blast outward on the roar.
    const n = cz.mane.length;
    const roarU = cz.roared ? clamp01((t - cz.roarAt) / 420) : 0;
    for (let i = 0; i < n; i++) {
      const s = cz.mane[i]!;
      const a = (i / n) * Math.PI * 2 + t * 0.00025 * (i % 2 ? 1 : -1);
      const r0 = R * (2.2 + 0.25 * Math.sin(t * 0.01 + i)) * size + roarU * R * 3;
      s.position.set(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      s.rotation = a;
      const len = R * 1.6 * size * (1 + 0.3 * Math.sin(t * 0.03 + i * 1.7)) * (1 + roarU);
      s.scale.set(len / 64, (R * 0.16 * size) / 18);
      s.alpha = alpha * (0.22 + 0.18 * Math.sin(t * 0.04 + i * 2.3)) * clamp01((t - cz.riseMs * 0.2) / (cz.riseMs * 0.4)) * (1 - roarU);
    }
    return true;
  }

  private drawMane(b: Beast, flying: boolean, since: number): void {
    const N = MANE_POINTS;
    const L = this.look;
    const S = this.scale;
    const { px, py, nx, ny, hw } = this;
    const step = L.maneMs / (N - 1);
    const back = (HEAD_MANE.x - HEAD_ANCHOR.x) * b.k;
    const up = (HEAD_MANE.y - HEAD_ANCHOR.y) * b.k * b.flip;
    for (let j = 0; j < N; j++) {
      const p = beastPos(b.m, Math.max(0, b.age - j * step));
      const cr = Math.cos(p.rot), sr = Math.sin(p.rot);
      px[j] = p.x + back * cr - up * sr; py[j] = p.y + back * sr + up * cr;
    }
    let lx = 0, ly = 1;
    for (let j = 0; j < N; j++) {
      const a = Math.max(0, j - 1), c = Math.min(N - 1, j + 1);
      const tx = px[a]! - px[c]!, ty = py[a]! - py[c]!;
      const l = Math.hypot(tx, ty);
      if (l > 0.01) { lx = -ty / l; ly = tx / l; }
      nx[j] = lx; ny[j] = ly;
    }
    for (let j = 0; j < N; j++) {
      const f = j / (N - 1);
      // A flame, not a tube: full at the skull, licking in and out as it streams back.
      hw[j] = L.maneWidth * 0.5 * S * (1 - f * 0.7) * (1 + 0.24 * Math.sin(j * 0.9 - b.age * 0.035 + b.phase));
    }
    const alpha = (flying ? 1 : 1 - clamp01(since / Math.max(1, L.maneMs))) * clamp01(b.age / 60);
    // A body you can see on the light board (normal blend, deep feral), a green glow round it, a hot amber core.
    this.writeStrip(b.shade, 0.85, 0.7 * alpha);
    this.writeStrip(b.mglow, 1.35, 0.85 * alpha);
    this.writeStrip(b.mcore, 0.3, 0.8 * alpha, 0.6);
  }

  /** Write one strip over the centreline; `reach` (0..1] ends it that far down the mane (tapering to nothing). */
  private writeStrip(st: Strip | null, mult: number, alpha: number, reach = 1): void {
    if (!st) return;
    const { px, py, nx, ny, hw } = this;
    const v = st.v;
    for (let j = 0; j < MANE_POINTS; j++) {
      const f = j / (MANE_POINTS - 1);
      const h = hw[j]! * mult * (reach >= 1 ? 1 : Math.max(0, 1 - f / reach));
      v[j * 4] = px[j]! + nx[j]! * h; v[j * 4 + 1] = py[j]! + ny[j]! * h;
      v[j * 4 + 2] = px[j]! - nx[j]! * h; v[j * 4 + 3] = py[j]! - ny[j]! * h;
    }
    st.mesh.alpha = Math.max(0, alpha);
  }

  private dropBeast(b: Beast): void {
    if (b.head) for (const s of Object.values(b.head)) this.give(s);
    if (b.jaws) for (const s of Object.values(b.jaws)) this.give(s);
    for (const st of [b.shade, b.mglow, b.mcore]) this.giveStrip(st);
    b.head = null; b.jaws = null; b.shade = b.mglow = b.mcore = null;
  }

  private dropColossus(cz: Colossus): void {
    for (const s of Object.values(cz.jaws)) this.give(s);
    for (const s of [cz.back, cz.bloom, ...cz.eyes, ...cz.mane]) this.give(s);
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const b of this.beasts) this.dropBeast(b);
    if (this.colossus) this.dropColossus(this.colossus);
    for (const q of this.fx) this.give(q.s);
    for (const p of this.particles) this.give(p.s);
    for (const s of this.warm) this.give(s);
    for (const st of this.warmStrips) this.giveStrip(st);
    if (this.charge) for (const s of [this.charge.ring, this.charge.bloom]) this.give(s);
    this.beasts = []; this.fx = []; this.particles = []; this.warm = []; this.warmStrips = []; this.charge = null; this.colossus = null;
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

