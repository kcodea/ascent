/**
 * THE EYE OF THE LEGION SCENE: everything the attack draws in Pixi, as a plain scene graph with no renderer, so it
 * runs (and is tested) headless. `heroFel.ts` mounts `root` on the above-portrait overlay and feeds `update(dt)`.
 *
 * THE EYE is a small rig of layered, painted sprites (owner bar 2026-09-30: "extremely unique", Hearthstone / WoW
 * craft), driven every frame by the PURE pose in `heroFelConfig.ts`:
 *   a soft fel light | the RIFT (a dark ragged tear, its torn rim glowing) | inside the LIDS (a mask, the almond scaled in
 *   y): the shaded SCLERA, its VEINS, the IRIS (fibres, a dark limbal ring, a burning ring and a hot collar, darting
 *   with the look), the slit PUPIL, a fixed specular GLINT | the LID rim (dark, thick) and its fel inner glow.
 * Shut, the lid band collapses to a glowing SEAM in the tear; the lids crack, then snap open.
 *
 * THE GAZE is a beam of two stretched sprites (a wide fel glow, a white-hot core) with a flare at the pupil and at its
 * head, sparks spraying where it burns. IV: the iris IGNITES (live fel fire round its ring), the target is DRAWN IN (a
 * dark core, collapsing rings, motes streaming in), then IMPLODES into a STARBURST.
 *
 * LAYERS, bottom to top: veil (normal: IV's fel-negative vignette) | under (normal) | glow (additive) | the eyes | the
 * fire's back (normal) | body (normal) | the fire's front (additive) | core (additive: the gaze, flashes, sparks).
 *
 * Contract: one-shots are POOLED (`FxPool`, `MAX_FEL_SPRITES`); fire particles capped (`MAX_FEL_PARTICLES`); the eye rigs
 * are built once at construction (while the damage formation plays) and only their transforms / alpha change; textures
 * are the caller's and pre-warmed; `update` returns whether anything still draws; `destroy()` leaves nothing behind.
 */
import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeInOutSine, easeOutCubic, whiten, type Pt } from '../heroAttack/easing';
import { FxPool, type FxLayer } from '../heroAttack/fxPool';
import { PixiFire, type FireEmitter, type FireTextures } from '../heroAttack/pixiFire';
import {
  almondPoints, beamPose, eyePose, EYE_HW, IRIS_R, LOOK_X, LOOK_Y, pupilPoint, type EyeMotion, type HeroFelConfig,
} from './heroFelConfig';
import { BURST_PX, CRACKLE_W, EYE_W, GAZE_H, GAZE_W, IRIS_PX, PUPIL_W, RIFT_W, SHARD_W, VEIL_PX } from './heroFelTextures';

export interface HeroFelTextures extends HeroArcanaTextures {
  fire: FireTextures;
  scorch: Texture;
  shock: Texture;
  sclera: Texture; veins: Texture; iris: Texture; pupil: Texture; lid: Texture; lidGlow: Texture;
  rift: Texture; riftRim: Texture; gaze: Texture; burst: Texture; veil: Texture; crackle: Texture; shard: Texture;
}

export interface FelColors {
  sclera: number; vein: number; iris: number; fel: number; hot: number; core: number; pupil: number; lid: number; rift: number; veil: number;
}

export const MAX_FEL_SPRITES = 420;
export const MAX_FEL_PARTICLES = 1000;

const GLOW_R = 64, SHOCK_R = 115, SPARK_R = 16;

interface Rig {
  m: EyeMotion;
  root: Container;
  light: Sprite; riftDark: Sprite; riftRim: Sprite;
  content: Container; mask: Graphics;
  sclera: Sprite; veins: Sprite; iris: Container; irisBody: Sprite; irisRing: Sprite; irisHot: Sprite; pupil: Sprite; glint: Sprite;
  lid: Sprite; lidGlow: Sprite;
  ignite: FireEmitter | null;
  crackIn: number; sparkIn: number;
  beam: { glow: Sprite; core: Sprite; head: Sprite; src: Sprite } | null;
  beamWasOn: boolean;
  /** The beam's head is on the target this frame. */
  beamHit: boolean;
}

interface Pull { x: number; y: number; R: number; at: number; until: number; dark: Sprite; light: Sprite; moteIn: number }

export class HeroFelScene extends FxPool {
  private readonly fire: PixiFire;
  private readonly S: number;
  private readonly eyesLayer = new Container();
  private readonly veilLayer = new Container();
  private readonly rigs: Rig[] = [];
  private veil: Sprite | null = null;
  private veilPlan: { inAt: number; fullAt: number; outAt: number; goneAt: number; alpha: number } | null = null;
  private pull: Pull | null = null;
  private clock = 0;
  private reserving = true;
  /** After a clear (a cancel) the eyes are spent: nothing redraws them. */
  private spent = false;

  constructor(
    private readonly tex: HeroFelTextures, private readonly colors: FelColors, private readonly cfg: HeroFelConfig,
    eyes: readonly EyeMotion[], scale = 1, seed = 1, screen: { w: number; h: number } = { w: 1920, h: 1080 },
  ) {
    const f = tex.fire;
    super('heroFel', [tex.glow, tex.spark, tex.shock, tex.gaze, tex.burst, tex.crackle, tex.shard, f.puffs[0]!, f.tongue, f.smoke, f.ember, f.glow], 1, seed, MAX_FEL_SPRITES);
    this.S = scale;
    this.fire = new PixiFire(f, {
      cap: MAX_FEL_PARTICLES, scale, seed: seed * 31 + 7,
      palette: { core: colors.core, hot: colors.hot, mid: colors.fel, deep: 0x1c9e2a, dark: 0x0b3a14, smoke: 0x1d1028 },
      smoke: 0.7, embers: cfg.embers, turb: 1, lift: 1,
    });
    this.eyesLayer.label = 'heroFel-eyes';
    this.veilLayer.label = 'heroFel-veil';
    // veil | under | glow | eyes | fire back | body | fire front | core
    this.root.addChildAt(this.veilLayer, 0);
    this.root.addChildAt(this.eyesLayer, 3);
    this.root.addChildAt(this.fire.back, 4);
    this.root.addChildAt(this.fire.front, 6);
    // The rigs are built a couple a frame while the formation plays (the first one now), never in one burst.
    this.pending = [...eyes];
    this.buildNext(1);
    this.fire.planReserve();
    this.screen = screen;
  }

  private readonly screen: { w: number; h: number };
  private pending: EyeMotion[] = [];
  private knot: { x: number; y: number; R: number; core: Sprite | null; light: Sprite | null } | null = null;

  /** Build up to `n` more eye rigs (in order). */
  private buildNext(n: number): void {
    for (let k = 0; k < n && this.pending.length; k++) this.rigs.push(this.buildRig(this.pending.shift()!));
  }

  /** Eye `i`'s rig, built now if the frame budget has not reached it yet. */
  private rig(i: number): Rig | undefined {
    if (this.destroyed || this.spent) return undefined;
    while (this.rigs.length <= i && this.pending.length) this.buildNext(1);
    return this.rigs[i];
  }

  /** Where the gazes converge (the struck portrait): the KNOT of light there grows with every beam burning on it. */
  setTarget(x: number, y: number, R: number): void { this.dropKnot(); this.knot = { x, y, R, core: null, light: null }; }

  get liveFire(): number { return this.fire.count; }
  get pooledFire(): number { return this.fire.pooled; }
  get emitters(): number { return this.fire.emitting; }
  get time(): number { return this.clock; }
  /** Eyes showing anything (the rift or the lids). */
  get eyesShowing(): number { return this.rigs.filter((r) => r.root.visible).length; }
  get beamsOn(): number { return this.rigs.filter((r) => r.beam !== null).length; }
  get pulling(): boolean { return this.pull !== null; }
  get veilAlpha(): number { return this.veil?.visible ? this.veil.alpha : 0; }
  /** The eye rigs (exposed for tests and the capture rig). */
  get eyeRigs(): readonly { root: Container; content: Container; mask: Graphics; pupil: Sprite; iris: Container }[] { return this.rigs; }

  // ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────

  private fxs(layer: FxLayer, t: Texture, tint: number, x: number, y: number, unit: number, o: {
    dur: number; from: number; to: number; a0: number; mode?: 'out' | 'punch' | 'hold'; peakAt?: number; delay?: number;
    rot?: number; spin?: number; sy?: number; vx?: number; vy?: number; drag?: number; grav?: number; align?: boolean; ease?: 'quint' | 'cubic' | 'linear';
  }): Sprite | null {
    return this.spawn(layer, t, tint, x, y, { ...o, from: o.from / unit, to: o.to / unit });
  }

  private crackleAt(x: number, y: number, len: number, rot: number, tint: number, dur = 100): void {
    this.fxs('core', this.tex.crackle, tint, x, y, CRACKLE_W / 2, { dur, from: len / 2, to: len / 2 * 1.08, a0: 1, rot, sy: this.rnd() < 0.5 ? 1 : -1, ease: 'linear' });
  }

  private shardBurst(x: number, y: number, R: number, n: number, speed: number): void {
    const k = Math.round(n * this.cfg.shards);
    for (let i = 0; i < k; i++) {
      const a = this.rnd() * Math.PI * 2;
      const sp = speed * this.S * (0.55 + this.rnd() * 0.7);
      const len = R * (0.35 + this.rnd() * 0.35);
      this.fxs('core', this.tex.shard, i % 3 === 0 ? this.colors.core : this.colors.hot, x, y, SHARD_W / 2, {
        dur: 260 + this.rnd() * 180, from: len, to: len * 0.5, a0: 1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.015, align: true, ease: 'linear', sy: 0.9,
      });
    }
  }

  private buildRig(m: EyeMotion): Rig {
    const c = this.colors, T = this.tex;
    const root = new Container();
    root.label = `fel-eye-${m.i}`;
    root.position.set(m.c.x, m.c.y);
    root.scale.set(m.a / EYE_HW);
    root.visible = false;
    const spr = (t: Texture, tint: number, blend: 'normal' | 'add', parent: Container = root): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(0.5); s.tint = tint; s.blendMode = blend;
      parent.addChild(s);
      return s;
    };
    const light = spr(T.fire.glow, c.fel, 'add');
    light.scale.set((EYE_HW * 2.6) / GLOW_R);
    const riftDark = spr(T.rift, c.rift, 'normal');
    const riftRim = spr(T.riftRim, c.fel, 'add');
    const content = new Container();
    root.addChild(content);
    const mask = new Graphics();
    mask.poly(almondPoints().flatMap((p) => [p.x, p.y])).fill(0xffffff);
    root.addChild(mask);
    content.mask = mask;
    const sclera = spr(T.sclera, c.sclera, 'normal', content);
    sclera.scale.set((2 * EYE_HW + 16) / EYE_W);
    const veins = spr(T.veins, c.vein, 'normal', content);
    veins.alpha = this.cfg.veins;
    const iris = new Container();
    content.addChild(iris);
    const irisBody = spr(T.iris, c.iris, 'normal', iris);
    irisBody.scale.set((IRIS_R * 2) / IRIS_PX);
    const irisHot = spr(T.glow, c.hot, 'add', iris);
    irisHot.scale.set((IRIS_R * 0.9) / GLOW_R);
    const irisRing = spr(T.shock, c.fel, 'add', iris);
    irisRing.scale.set((IRIS_R * 1.02) / SHOCK_R);
    const pupil = spr(T.pupil, c.pupil, 'normal', iris);
    const glint = spr(T.glow, 0xffffff, 'add', content);
    glint.position.set(-IRIS_R * 0.55, -IRIS_R * 0.45);
    glint.scale.set(9 / GLOW_R, 6 / GLOW_R);
    glint.alpha = 0.85;
    const lid = spr(T.lid, c.lid, 'normal');
    const lidGlow = spr(T.lidGlow, c.fel, 'add');
    this.eyesLayer.addChild(root);
    return {
      m, root, light, riftDark, riftRim, content, mask, sclera, veins, iris, irisBody, irisRing, irisHot, pupil, glint, lid, lidGlow,
      ignite: null, crackIn: 0, sparkIn: 0, beam: null, beamWasOn: false, beamHit: false,
    };
  }

  /** Draw one eye at the scene clock. */
  private drawRig(r: Rig, dt: number): void {
    const { m } = r;
    const p = eyePose(m, this.clock, this.cfg);
    const show = p.rift > 0.001 || p.open > 0.001;
    r.root.visible = show;
    if (!show) return;
    const t = this.clock;
    const flick = 0.92 + 0.08 * Math.sin(t * 0.03 + m.i * 2);
    // The rift tears open along its length (x leads, y follows) and seals the same way.
    const rx = 0.55 + 0.45 * p.rift, ry = Math.max(0.001, p.rift);
    r.riftDark.scale.set(rx, ry);
    r.riftDark.alpha = 0.94 * Math.min(1, p.rift * 1.5);
    r.riftRim.scale.set(rx, ry);
    // A thin torn line, however big the eye (a big rift's rim is scaled up with it, so it is faded back).
    r.riftRim.alpha = (0.8 / Math.max(1, m.a / EYE_HW)) * Math.min(1, p.rift * 1.4) * flick;
    r.light.alpha = (0.25 + 0.35 * p.glow) * p.rift;
    // The lids: the mask and the lid bands scaled in y together; shut, they are a glowing seam.
    const o = Math.max(0.0001, Math.min(1.15, p.open));
    r.mask.scale.set(1, o);
    r.content.visible = p.open > 0.002;
    const band = Math.max(0.05, o);
    r.lid.scale.set(1, band);
    r.lid.alpha = Math.min(1, p.rift * 2);
    r.lidGlow.scale.set(1, band);
    r.lidGlow.alpha = Math.min(1, (0.5 + 0.5 * p.glow) * Math.min(1, p.rift * 2) + p.seam * 0.8) * flick;
    // The iris darts with the look; the pupil slits; the ring burns brighter as it locks and fires.
    r.iris.position.set(p.look.x * LOOK_X, p.look.y * LOOK_Y);
    r.pupil.scale.set((IRIS_R * 1.6 * p.pupil) / PUPIL_W, (IRIS_R * 1.5) / 96);
    r.irisRing.alpha = Math.min(1, 0.3 + 0.6 * p.glow) * flick;
    r.irisHot.alpha = Math.min(1, 0.25 + 0.55 * p.glow);
    r.irisHot.scale.set((IRIS_R * (0.7 + 0.35 * p.glow)) / GLOW_R);
    r.irisBody.tint = p.glow > 1 ? whiten(this.colors.iris, Math.min(0.5, (p.glow - 1) * 0.6)) : this.colors.iris;
    // The ignition (IV): live fel fire round the iris ring, burning with the glow.
    const k = m.a / EYE_HW;
    const pc = pupilPoint(m, p.look);
    if (r.ignite) {
      r.ignite.x = pc.x; r.ignite.y = pc.y; r.ignite.r = IRIS_R * k * 0.98;
      r.ignite.intensity = Math.max(0, Math.min(1.3, p.glow - 0.5)) * Math.min(1, p.open * 1.5);
      if (t >= m.closeAt) { this.fire.stop(r.ignite); r.ignite = null; }
    }
    // Fel crackles flicker round the torn rim while it is open.
    r.crackIn -= dt;
    if (p.rift > 0.6 && r.crackIn <= 0 && t < m.closeAt) {
      r.crackIn = 110 + this.rnd() * 120;
      const a = this.rnd() * Math.PI * 2;
      const ex = Math.cos(a) * (RIFT_W / 2 - 18) * rx * k, ey = Math.sin(a) * 95 * ry * k;
      this.crackleAt(m.c.x + ex, m.c.y + ey, m.a * 0.35, a + Math.PI / 2, this.rnd() < 0.5 ? this.colors.hot : this.colors.fel, 110);
    }
    this.drawBeam(r, dt);
  }

  private drawBeam(r: Rig, dt: number): void {
    const b = beamPose(r.m, this.clock, this.cfg);
    r.beamHit = b.on && b.head >= 1 && b.tail < 0.5;
    if (!b.on) {
      if (r.beam) { for (const s of [r.beam.glow, r.beam.core, r.beam.head, r.beam.src]) this.give(s); r.beam = null; }
      return;
    }
    if (!r.beam) {
      const glow = this.take('core', this.tex.gaze, this.colors.fel);
      const core = this.take('core', this.tex.gaze, this.colors.core);
      const head = this.take('core', this.tex.glow, this.colors.hot);
      const src = this.take('core', this.tex.glow, this.colors.core);
      if (!glow || !core || !head || !src) { for (const s of [glow, core, head, src]) this.give(s); return; }
      glow.anchor.set(0, 0.5); core.anchor.set(0, 0.5);
      r.beam = { glow, core, head, src };
      r.beamWasOn = true;
    }
    const dx = b.to.x - b.from.x, dy = b.to.y - b.from.y;
    const L = Math.hypot(dx, dy) || 1;
    const rot = Math.atan2(dy, dx);
    const x0 = b.from.x + dx * b.tail, y0 = b.from.y + dy * b.tail;
    const len = Math.max(0.5, L * (b.head - b.tail));
    const flick = 0.9 + 0.1 * Math.sin(this.clock * 0.08) + 0.06 * Math.sin(this.clock * 0.23);
    const w = r.m.beamR * 0.42 * this.cfg.beamWidth * b.width * flick;
    const { glow, core, head, src } = r.beam;
    glow.position.set(x0, y0); glow.rotation = rot; glow.scale.set(len / GAZE_W, (w * 2.4) / GAZE_H); glow.alpha = Math.min(1, 0.95 * this.cfg.beamGlow);
    core.position.set(x0, y0); core.rotation = rot; core.scale.set(len / GAZE_W, (w * 0.6) / GAZE_H); core.alpha = 1;
    const hx = b.from.x + dx * b.head, hy = b.from.y + dy * b.head;
    head.position.set(hx, hy); head.scale.set((w * (b.head >= 1 ? 2.2 : 1.4)) / GLOW_R); head.alpha = b.tail >= 0.98 ? 0 : b.head >= 1 ? 0.55 : 0.95;
    src.position.set(b.from.x, b.from.y); src.scale.set((w * 1.8) / GLOW_R); src.alpha = b.tail > 0 ? 0.5 * (1 - b.tail) : 0.9;
    // Where it burns: sparks sprayed back along the beam and off to the sides.
    if (b.head >= 1 && b.tail < 0.9) {
      r.sparkIn -= dt;
      while (r.sparkIn <= 0) {
        r.sparkIn += 22 / Math.max(0.1, this.cfg.sparks);
        const a = rot + Math.PI + (this.rnd() - 0.5) * 2.2;
        const sp = (300 + this.rnd() * 500) * this.S;
        const sz = (3 + this.rnd() * 4) * this.S;
        this.fxs('core', this.tex.spark, this.rnd() < 0.4 ? this.colors.core : this.colors.hot, hx, hy, SPARK_R, {
          dur: 220 + this.rnd() * 160, from: sz, to: sz * 0.3, a0: 1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.05, grav: 600 * this.S, align: true, ease: 'linear', sy: 0.5,
        });
      }
    }
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** IV's fel-negative veil: a vignette over the whole screen (one sprite), faded in and out on the plan's times. */
  setVeil(v: { inAt: number; fullAt: number; outAt: number; goneAt: number; alpha: number } | null): void {
    this.veilPlan = v;
    if (!v || this.veil) return;
    const s = new Sprite(this.tex.veil);
    s.anchor.set(0.5); s.tint = this.colors.veil; s.alpha = 0; s.visible = false;
    const W = this.screen.w * 1.5, H = this.screen.h * 1.5;
    s.position.set(this.screen.w / 2, this.screen.h / 2);
    s.scale.set(W / VEIL_PX, H / VEIL_PX);
    this.veilLayer.addChild(s);
    this.veil = s;
  }

  /** The rift tears open: a flash along the tear and a few crackles off its ends. */
  rift(i: number): void {
    const r = this.rig(i); if (!r) return;
    const { c, a } = r.m;
    this.fxs('core', this.tex.glow, this.colors.core, c.x, c.y, GLOW_R, { dur: 220, from: a * 0.2, to: a * 0.9, a0: 0.7, sy: 0.25, mode: 'punch', peakAt: 0.3 });
    this.crackleAt(c.x - a * 0.9, c.y, a * 0.5, Math.PI, this.colors.hot, 140);
    this.crackleAt(c.x + a * 0.9, c.y, a * 0.5, 0, this.colors.hot, 140);
  }

  /** The lids snap open: a ring and a puff of embers. */
  opened(i: number): void {
    const r = this.rig(i); if (!r) return;
    const { c, a } = r.m;
    this.fxs('glow', this.tex.shock, this.colors.fel, c.x, c.y, SHOCK_R, { dur: 320, from: a * 0.6, to: a * 1.5, a0: 0.5, sy: 0.55 });
    this.fire.embers(c.x, c.y, 6, a * 0.5, { speed: 160 });
  }

  /** It finds the target: the pupil slams to a slit (a flash on the iris, a ring closing on it). */
  locked(i: number): void {
    const r = this.rig(i); if (!r) return;
    const k = r.m.a / EYE_HW;
    const pc = pupilPoint(r.m, r.m.lock);
    this.fxs('core', this.tex.glow, this.colors.hot, pc.x, pc.y, GLOW_R, { dur: 180, from: IRIS_R * k * 0.4, to: IRIS_R * k * 1.4, a0: 0.8 });
    this.fxs('glow', this.tex.shock, this.colors.hot, pc.x, pc.y, SHOCK_R, { dur: 220, from: IRIS_R * k * 2.2, to: IRIS_R * k * 1.05, a0: 0.8, mode: 'punch', peakAt: 0.4 });
  }

  /** The gaze leaves the pupil: a flash off the eye. */
  fired(i: number): void {
    const r = this.rig(i); if (!r) return;
    const k = r.m.a / EYE_HW;
    const pc = pupilPoint(r.m, r.m.lock);
    this.fxs('core', this.tex.glow, 0xffffff, pc.x, pc.y, GLOW_R, { dur: 130, from: IRIS_R * k * 0.8, to: IRIS_R * k * 2.4, a0: 0.9 });
  }

  /** A gaze lands (a tick, or THE impact below Tier IV): a flash, a ring, crackles, shards, fel fire on the portrait. */
  impact(x: number, y: number, R: number, o: { size: number; big: boolean; dir: Pt; flashAlpha: number }): void {
    if (this.destroyed) return;
    const c = this.colors;
    const sz = o.size * this.cfg.burstSize;
    const big = o.big;
    this.fxs('core', this.tex.glow, 0xffffff, x, y, GLOW_R, { dur: big ? 120 : 80, from: R * 0.5 * sz, to: R * (big ? 1.3 : 0.85) * sz, a0: o.flashAlpha * (big ? 0.9 : 0.6) });
    this.fxs('glow', this.tex.fire.glow, c.fel, x, y, GLOW_R, { dur: big ? 700 : 450, from: R * 1.4 * sz, to: R * 2.6 * sz, a0: big ? 0.75 : 0.5 });
    this.fxs('glow', this.tex.shock, whiten(c.hot, 0.3), x, y, SHOCK_R, { dur: big ? 300 : 220, from: R * 0.4, to: R * (big ? 2 : 1.3) * sz, a0: big ? 0.85 : 0.55 });
    if (big) this.fxs('core', this.tex.burst, c.hot, x, y, BURST_PX / 2, { dur: 260, from: R * 0.6 * sz, to: R * 1.7 * sz, a0: 0.8, rot: this.rnd() * 6.28, spin: 0.002 });
    const n = big ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rnd() * 0.6;
      this.crackleAt(x + Math.cos(a) * R * 0.5, y + Math.sin(a) * R * 0.5, R * 0.9 * sz, a, i % 2 ? c.hot : c.core, big ? 160 : 110);
    }
    this.shardBurst(x, y, R * sz, big ? 9 : 4, big ? 1000 : 750);
    this.fire.burst(x, y, {
      n: (big ? 30 : 12) * sz, radius: R * 0.3 * sz, speed: (big ? 520 : 380) * sz, size: R * (big ? 0.5 : 0.4) * sz, life: big ? 560 : 420,
      lift: 700, drag: 3.4, heat: 1, tongues: 0.25, body: 0.35, smoke: 0.3, embers: big ? 14 : 5, emberSpeed: 420,
    });
    this.fire.burst(x, y, { n: (big ? 10 : 5) * sz, radius: R * 0.2, speed: 760 * sz, size: R * 0.36 * sz, life: 340, dir: Math.atan2(o.dir.y, o.dir.x), spread: 1.2, drag: 4.5, smoke: 0.15 });
  }

  /** III / IV: every gaze is on the target; the barrage BUILDS until `untilMs` from now (closing rings, motes drawn in). */
  drawIn(x: number, y: number, R: number, untilMs: number): void {
    if (this.destroyed || this.pull) return;
    const dark = this.take('body', this.tex.fire.glow, this.colors.rift);
    const light = this.take('glow', this.tex.fire.glow, this.colors.fel);
    if (!dark || !light) { this.give(dark); this.give(light); return; }
    dark.position.set(x, y); light.position.set(x, y); dark.alpha = 0; light.alpha = 0;
    this.pull = { x, y, R, at: this.clock, until: this.clock + Math.max(1, untilMs), dark, light, moteIn: 0 };
    for (let i = 0; i < 3; i++) {
      this.fxs('glow', this.tex.shock, this.colors.hot, x, y, SHOCK_R, {
        dur: 300, delay: (untilMs * i) / 3, from: R * 3.2, to: R * 0.35, a0: 0.75, mode: 'punch', peakAt: 0.5, ease: 'cubic',
      });
    }
  }

  /**
   * IV, THE IMPACT: the MASSIVE FEL EXPLOSION on the struck hero. Layered: a white-green flash core and a screen flash;
   * two counter-rotating starbursts; three shockwave rings and a dark pressure ring; a towering fireball (a column of
   * fel fire roaring up when there is room above the target, a rolling ball of fire when it sits at the top of the
   * screen); a dome of fire; burning debris and embers flung out; smoke; a scorch left round it.
   */
  explosion(x: number, y: number, R: number, o: { burst: number; flashAlpha: number; screen: number; roomAbove: boolean }): void {
    if (this.destroyed) return;
    const pl = this.pull;
    if (pl) { this.give(pl.dark); this.give(pl.light); this.pull = null; }
    this.dropKnot();
    const c = this.colors;
    const b = Math.max(0.5, o.burst) * this.cfg.burstSize;
    this.fxs('core', this.tex.glow, 0xffffff, x, y, GLOW_R, { dur: 150, from: R * 0.6, to: R * 2.6, a0: 1 });
    this.fxs('core', this.tex.glow, c.core, x, y, GLOW_R, { dur: 220, from: R * 1.4, to: R * 3.2, a0: o.flashAlpha });
    this.fxs('core', this.tex.glow, whiten(c.fel, 0.5), x, y, GLOW_R, { dur: 190, from: o.screen * 0.45, to: o.screen * 0.7, a0: 0.32 * o.flashAlpha });
    this.fxs('core', this.tex.burst, c.core, x, y, BURST_PX / 2, { dur: 560, from: R * 0.4, to: R * 2.4 * b * 0.55, a0: 1, rot: this.rnd() * 6.28, spin: 0.0012, ease: 'cubic' });
    this.fxs('core', this.tex.burst, c.fel, x, y, BURST_PX / 2, { dur: 760, from: R * 0.6, to: R * 3.3 * b * 0.55, a0: 0.85, rot: this.rnd() * 6.28, spin: -0.0008, ease: 'cubic' });
    this.fxs('glow', this.tex.fire.glow, c.fel, x, y, GLOW_R, { dur: 1600, from: R * 2.8, to: R * 5, a0: 0.8 });
    this.fxs('glow', this.tex.shock, whiten(c.hot, 0.5), x, y, SHOCK_R, { dur: 520, from: R * 0.5, to: R * 6.5, a0: 1 });
    this.fxs('glow', this.tex.shock, c.fel, x, y, SHOCK_R, { dur: 700, delay: 80, from: R * 0.4, to: R * 5, a0: 0.8 });
    this.fxs('glow', this.tex.shock, c.hot, x, y, SHOCK_R, { dur: 820, delay: 170, from: R * 0.3, to: R * 3.6, a0: 0.6 });
    this.fxs('under', this.tex.shock, c.rift, x, y, SHOCK_R, { dur: 640, delay: 30, from: R, to: R * 5.6, a0: 0.6 });
    this.fxs('under', this.tex.scorch, c.rift, x, y, 102, { dur: 2800, from: R * 2, to: R * 2.4, a0: 0.75, mode: 'hold' });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + this.rnd() * 0.4;
      this.crackleAt(x + Math.cos(a) * R, y + Math.sin(a) * R, R * 1.6, a, i % 2 ? c.hot : c.core, 220);
    }
    this.shardBurst(x, y, R * 1.4, 18, 1600);
    // The dome, and the towering fireball.
    this.fire.burst(x, y, {
      n: 110 * this.cfg.fireball, radius: R * 0.45, speed: 880, size: R * 0.85, life: 700, lift: 900, drag: 3.6, heat: 1, tongues: 0.3, body: 0.3, smoke: 0.4,
      embers: 36, emberSpeed: 760,
    });
    if (o.roomAbove) {
      this.fire.emitter({
        shape: 'disc', x, y, r: R * 0.8, rate: 520 * this.cfg.fireball, size: R * 1.0, life: 760, lift: 1600, vy: -950, speed: 60, heat: 1, turb: 300,
        tongues: 0.45, body: 0.3, smoke: 0.3, embers: 30, emberSpeed: 340,
      }, { hold: 420, fade: 700 });
    } else {
      this.fire.emitter({
        shape: 'ring', x, y, r: R * 0.7, rate: 700 * this.cfg.fireball, size: R * 0.9, life: 520, lift: 500, out: 560, speed: 80, heat: 1, turb: 260,
        tongues: 0.2, body: 0.25, smoke: 0.25, drag: 2.2,
      }, { hold: 360, fade: 400 });
    }
    // Burning debris flung out on arcs (fire bursts thrown hard along a few directions).
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI / 2 + (i / 6 - 0.5) * 2.8;
      this.fire.burst(x, y, { n: 7, radius: R * 0.15, speed: 1100, size: R * 0.32, life: 520, dir: a, spread: 0.25, drag: 2.6, lift: 300, smoke: 0.35, embers: 3, emberSpeed: 600 });
    }
    this.fire.smokePuffs(x, y - R * 0.5, 7, { radius: R * 0.9, size: R * 1.8, life: 2200, rise: 90, alpha: 0.45 });
  }

  private dropKnot(): void {
    const k = this.knot;
    if (!k) return;
    this.give(k.core); this.give(k.light); k.core = null; k.light = null;
  }

  /** The knot of light where the gazes converge: bigger and brighter with every beam burning on the target. */
  private drawKnot(): void {
    const k = this.knot;
    if (!k || this.spent) return;
    let n = 0;
    for (const r of this.rigs) if (r.beam && r.beamHit) n++;
    if (n === 0) { this.dropKnot(); return; }
    if (!k.core) { k.core = this.take('core', this.tex.glow, this.colors.core); k.core?.position.set(k.x, k.y); }
    if (!k.light) { k.light = this.take('glow', this.tex.fire.glow, this.colors.fel); k.light?.position.set(k.x, k.y); }
    const f = Math.min(1, n / 10);
    const flick = 0.9 + 0.1 * Math.sin(this.clock * 0.09);
    if (k.core) { k.core.scale.set((k.R * (0.45 + 0.75 * f) * flick) / GLOW_R); k.core.alpha = Math.min(1, 0.55 + 0.45 * f); }
    if (k.light) { k.light.scale.set((k.R * (1.6 + 1.8 * f)) / GLOW_R); k.light.alpha = 0.3 + 0.45 * f; }
  }

  /** The eye blinks shut: a small flash along the seam. */
  closed(i: number): void {
    const r = this.rig(i); if (!r) return;
    const { c, a } = r.m;
    this.fxs('core', this.tex.glow, this.colors.hot, c.x, c.y, GLOW_R, { dur: 160, from: a * 0.3, to: a * 0.9, a0: 0.6, sy: 0.18 });
  }

  /** The rift seals: embers shed along the seam. */
  sealed(i: number): void {
    const r = this.rig(i); if (!r) return;
    const { c, a } = r.m;
    for (let j = -3; j <= 3; j++) this.fire.embers(c.x + (j / 3) * a * 0.9, c.y, 2, a * 0.06, { speed: 120, life: 900 });
  }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  protected override tick(dt: number): boolean {
    if (this.destroyed) return false;
    const step = Math.max(0, Math.min(100, Number.isFinite(dt) ? dt : 0));
    this.clock += step;
    if (this.reserving) this.reserving = this.fire.reserveStep(100);
    if (!this.spent) this.buildNext(2);
    let eyes = this.pending.length > 0 && !this.spent;
    for (const r of this.rigs) {
      if (this.spent) break;
      this.drawRig(r, step);
      if (r.root.visible || r.beam) eyes = true;
      if (this.clock < r.m.goneAt) eyes = true;
    }
    const v = this.veilPlan, vs = this.veil;
    let veil = false;
    if (v && vs) {
      const t = this.clock;
      const a = t < v.inAt ? 0 : t < v.outAt ? easeInOutSine((t - v.inAt) / Math.max(1, v.fullAt - v.inAt)) : 1 - easeInOutSine((t - v.outAt) / Math.max(1, v.goneAt - v.outAt));
      vs.alpha = v.alpha * a;
      vs.visible = vs.alpha > 0.002;
      veil = t < v.goneAt;
    }
    const pl = this.pull;
    if (pl) {
      const u = clamp01((this.clock - pl.at) / Math.max(1, pl.until - pl.at));
      // A dark core swells on the target, then collapses to a point as the implosion nears.
      const grow = easeOutCubic(Math.min(1, u * 5));
      const shrink = 1 - u * u;
      pl.dark.scale.set((pl.R * 1.2 * grow * Math.max(0.05, shrink)) / GLOW_R);
      pl.dark.alpha = 0.25 * grow;
      pl.light.scale.set((pl.R * (2.6 - 1.4 * u)) / GLOW_R);
      pl.light.alpha = 0.2 + 0.25 * u;
      pl.moteIn -= step;
      const every = 14 / Math.max(0.1, this.cfg.drawIn);
      while (pl.moteIn <= 0) {
        pl.moteIn += every;
        const a = this.rnd() * Math.PI * 2, d = pl.R * (1.8 + this.rnd() * 1.6);
        const life = 220 + this.rnd() * 100, sec = life / 1000;
        const sz = (3 + this.rnd() * 4) * this.S;
        this.fxs('core', this.tex.spark, this.rnd() < 0.35 ? this.colors.core : this.colors.fel, pl.x + Math.cos(a) * d, pl.y + Math.sin(a) * d, SPARK_R, {
          dur: life, from: sz, to: sz * 0.4, a0: 1, mode: 'punch', peakAt: 0.3, vx: (-Math.cos(a) * d * 0.95) / sec, vy: (-Math.sin(a) * d * 0.95) / sec,
          drag: 1, align: true, ease: 'linear', sy: 0.5,
        });
      }
    }
    this.drawKnot();
    const burning = this.fire.update(step);
    return burning || eyes || veil || this.pull !== null || (this.knot?.core ?? null) !== null;
  }

  protected override clearOwn(): void {
    for (const r of this.rigs) {
      if (r.beam) { for (const s of [r.beam.glow, r.beam.core, r.beam.head, r.beam.src]) this.give(s); r.beam = null; }
      if (r.ignite) { this.fire.stop(r.ignite); r.ignite = null; }
      r.root.visible = false;
    }
    if (this.pull) { this.give(this.pull.dark); this.give(this.pull.light); this.pull = null; }
    this.dropKnot();
    this.pending = [];
    if (this.veil) { this.veil.visible = false; this.veil.alpha = 0; }
    this.veilPlan = null;
    this.fire.clear();
    this.spent = true;
  }

  override destroy(): void {
    if (this.destroyed) return;
    this.clear();
    for (const c of [this.fire.back, this.fire.front]) this.root.removeChild(c);
    this.fire.destroy();
    for (const r of this.rigs) r.root.destroy({ children: true });
    this.rigs.length = 0;
    for (const c of [this.eyesLayer, this.veilLayer]) { this.root.removeChild(c); c.destroy({ children: true }); }
    super.destroy();
  }
}
