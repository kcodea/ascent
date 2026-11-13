/**
 * THE TRAIN SCENE: what the Train attack ("Right on Schedule") draws in Pixi, on the shared pooled scene
 * (`../heroAttack/fxPool.ts`), so it runs (and is tested) headless. `heroTrain.ts` mounts `root` on the above-portrait
 * overlay and writes the own objects every frame from the pure plan.
 *
 * OWN OBJECTS (made once, positioned by the runner every frame, hidden the moment they are not needed and on every
 * exit):
 *  - THE TRACK: one painted tile (two rails on sleepers) repeated from edge to edge under the struck portrait.
 *  - THE CONSIST: one sprite per vehicle (the handcar, the mine cart, the engine and its tender, the freight cars, the
 *    caboose). A long train is the same few car textures repeated; a unit off screen is hidden.
 *  - THE TURNING PARTS: the wheels drawn as their own sprites (the handcar's, the cart's, the engine's drivers), the
 *    engine's side ROD riding their cranks, and the handcar's see-saw HANDLE.
 *  - IV: the CROSSING SIGNAL (a post with a crossbuck and two lamps), its striped GATE ARM, the two lamp glows, and
 *    the HEADLIGHT glow at the edge of the screen.
 *
 * FIRE-AND-FORGET (pooled, under a hard cap): the funnel's steam puffs, the wind streaks, the handcar's bonk star, the
 * mine cart's spilled ore, the wheel sparks and the hit itself.
 */
import { Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { FUNNEL_MOUTH, HANDLE_PIVOT, ROD_CRANK, UNIT_SHAPES, type SignalState, type TrainGeo, type TrainKind, type TrainUnit, type UnitKind } from './heroTrainConfig';

export interface HeroTrainTextures extends HeroArcanaTextures {
  track: Texture;
  handcar: Texture;
  handle: Texture;
  cart: Texture;
  engine: Texture;
  tender: Texture;
  box: Texture;
  tank: Texture;
  hopper: Texture;
  flat: Texture;
  caboose: Texture;
  wheel: Texture;
  rod: Texture;
  signal: Texture;
  gate: Texture;
  puff: Texture;
  ore: Texture;
  bonk: Texture;
}

export interface TrainColors { steam: number; ore: number; lamp: number; headlight: number; spark: number; star: number; flash: number; side: number }

export interface TrainLook {
  /** The track's height, in struck portrait radii. */
  trackSize: number;
  /** How far the see-saw handle rocks (radians) and how high the cart bounces (radii). */
  handleSwing: number;
  bounce: number;
}

/** Hard cap on pooled sprites alive at once (a Tier IV peaks near 120). The own objects are outside the pool. */
export const MAX_TRAIN_SPRITES = 260;
/** The most track tiles, vehicles and turning wheels ever made. */
export const MAX_TRACK_TILES = 26;
export const MAX_UNITS = 12;
export const MAX_WHEELS = 4;

// Painted sizes (px): the scene scales from these, never from a texture's own size (so it is the same headless).
export const TRACK_W = 384;
export const TRACK_H = 96;
export const WHEEL_PX = 128;
export const ROD_W = 256;
export const ROD_H = 24;
export const HANDLE_W = 240;
export const SIGNAL_W = 192;
export const SIGNAL_H = 448;
export const GATE_W = 416;
export const GATE_H = 44;
export const PUFF_PX = 128;
export const ORE_PX = 64;
export const BONK_PX = 128;
const RING_PX = 160;
const GLOW_PX = 128;
/** Where on the painted signal its lamps and its gate arm's pivot are (fractions: x from its centre in widths, y up from its foot in heights). */
const LAMP_Y = 1 - 200 / SIGNAL_H;
const LAMP_DX = 52 / SIGNAL_W;
const ARM_Y = 1 - 300 / SIGNAL_H;
/** The gate arm's pivot along its texture, and how far up it stands when open (radians from level). */
const ARM_PIVOT = 34 / GATE_W;
const ARM_UP = 1.42;
const IRON = 0x8d949e;
const DRIVER_RED = 0xd4564a;
const DUST = 0xd9c7a6;

export class HeroTrainScene extends FxPool {
  private readonly tiles: Sprite[] = [];
  private readonly cars: Sprite[] = [];
  private readonly wheels: Sprite[] = [];
  private readonly rod: Sprite;
  private readonly handle: Sprite;
  private readonly post: Sprite;
  private readonly arm: Sprite;
  private readonly lampA: Sprite;
  private readonly lampB: Sprite;
  private readonly headlight: Sprite;
  private readonly all: Sprite[] = [];
  private readonly tileW: number;
  private own = false;
  private trainOn = false;

  /** `dR`: the struck portrait's radius (screen px); `units`: the consist, front to back. */
  constructor(
    private readonly tex: HeroTrainTextures, private readonly colors: TrainColors, private readonly look: TrainLook,
    private readonly g: TrainGeo, private readonly units: readonly TrainUnit[], private readonly kind: TrainKind,
    private readonly dR: number, scale = 1, seed = 1,
  ) {
    super('heroTrain', [
      tex.glow, tex.ring, tex.star, tex.streak, tex.spark, tex.track, tex.handcar, tex.handle, tex.cart, tex.engine, tex.tender, tex.box, tex.tank, tex.hopper,
      tex.flat, tex.caboose, tex.wheel, tex.rod, tex.signal, tex.gate, tex.puff, tex.ore, tex.bonk,
    ], scale, seed, MAX_TRAIN_SPRITES);
    const mk = (layer: 'under' | 'glow' | 'body' | 'core', t: Texture, tint: number, ax = 0.5, ay = 0.5): Sprite => {
      const s = new Sprite(t);
      s.anchor.set(ax, ay); s.tint = tint; s.visible = false; s.eventMode = 'none';
      if (layer === 'glow' || layer === 'core') s.blendMode = 'add';
      this.layers[layer].addChild(s);
      this.all.push(s);
      return s;
    };
    // THE TRACK: enough tiles to run from edge to edge (a very wide screen stretches them rather than making more).
    const th = dR * look.trackSize;
    const span = g.x1 - g.x0;
    const n = Math.max(1, Math.min(MAX_TRACK_TILES, Math.ceil(span / ((th * TRACK_W) / TRACK_H))));
    this.tileW = span / n;
    for (let i = 0; i < n; i++) {
      const s = mk('under', tex.track, 0xffffff, 0, 0.5);
      s.position.set(g.x0 + i * this.tileW, g.railY);
      // A hair of overlap so no seam shows between tiles.
      s.scale.set((this.tileW + 1) / TRACK_W, th / TRACK_H);
      this.tiles.push(s);
    }
    this.headlight = mk('glow', tex.glow, colors.headlight);
    // THE CONSIST, front to back (anchored at the wheels' feet), then its turning parts over it.
    for (const u of units.slice(0, MAX_UNITS)) {
      const s = mk('body', this.unitTexture(u.kind), u.tint, 0.5, 1);
      s.scale.set((g.dir * u.w) / UNIT_SHAPES[u.kind].tw, u.h / UNIT_SHAPES[u.kind].th);
      this.cars.push(s);
    }
    const lead = units[0];
    const slots = lead ? UNIT_SHAPES[lead.kind].wheels : [];
    for (const w of slots.slice(0, MAX_WHEELS)) {
      const s = mk('body', tex.wheel, lead!.kind === 'engine' && !w.small ? DRIVER_RED : IRON);
      s.scale.set((lead!.h * w.r * 2) / WHEEL_PX);
      this.wheels.push(s);
    }
    this.rod = mk('body', tex.rod, 0xffffff);
    this.handle = mk('body', tex.handle, 0xffffff);
    if (lead?.kind === 'engine') {
      // The rod spans the three drivers (their first and last centres, plus a pin's width each end).
      const span3 = lead.w * (slots[2]!.fx - slots[0]!.fx) * 1.12;
      this.rod.scale.set(span3 / ROD_W, (lead.h * 0.07) / ROD_H);
    }
    if (lead?.kind === 'handcar') this.handle.scale.set((lead.w * 0.78) / HANDLE_W);
    // IV's crossing signal stands in FRONT of the train (the near side of the track): the post, the arm, the lamps.
    const sk = g.signal.h / SIGNAL_H;
    this.arm = mk('body', tex.gate, 0xffffff, ARM_PIVOT, 0.5);
    this.arm.scale.set(g.signal.arm * sk * 1.05, sk * 1.05);
    this.post = mk('body', tex.signal, 0xffffff, 0.5, 1);
    this.lampA = mk('core', tex.glow, colors.lamp);
    this.lampB = mk('core', tex.glow, colors.lamp);
  }

  private unitTexture(k: UnitKind): Texture { return this.tex[k]; }

  /** Whether any own object still draws. */
  get ownVisible(): boolean { return this.own; }
  /** The own sprites (the tests count and inspect them). */
  get ownSprites(): readonly Sprite[] { return this.all; }

  // ── own objects (the runner writes them every frame) ──────────────────────────────────────────────────────────

  /** The track's opacity. */
  setTrack(alpha: number): void {
    if (this.destroyed) return;
    const show = alpha > 0.004;
    for (const s of this.tiles) { s.visible = show; s.alpha = alpha; }
    this.refresh();
  }

  /**
   * The whole train: `noseX` = its nose (screen px), `travel` = how far it has rolled (px; turns the wheels, rocks the
   * handle, bounces the cart). A unit wholly off the track is hidden.
   */
  setTrain(noseX: number, travel: number, show: boolean): void {
    if (this.destroyed) return;
    const g = this.g, dir = g.dir;
    let any = false;
    for (let i = 0; i < this.cars.length; i++) {
      const u = this.units[i]!, s = this.cars[i]!;
      const cx = noseX - dir * (u.off + u.w / 2);
      const on = show && cx + u.w / 2 > g.x0 && cx - u.w / 2 < g.x1;
      s.visible = on;
      if (!on) continue;
      any = true;
      let y = g.wheelY, rot = 0;
      if (u.kind === 'cart') {
        // It rattles: a hop off the rails at every joint and a little rock.
        y -= Math.abs(Math.sin(travel / (this.dR * 0.9))) * this.dR * this.look.bounce;
        rot = 0.05 * Math.sin(travel / (this.dR * 0.37));
      } else if (u.kind !== 'handcar' && u.kind !== 'engine') {
        // Each car sways on its springs, out of step with its neighbours.
        rot = 0.008 * Math.sin(travel / (this.dR * 1.3) + i * 1.7);
      }
      s.position.set(cx, y);
      s.rotation = rot;
    }
    const lead = this.units[0];
    const leadOn = !!lead && !!this.cars[0]?.visible;
    const slots = lead ? UNIT_SHAPES[lead.kind].wheels : [];
    const leadY = this.cars[0]?.y ?? g.wheelY;
    for (let i = 0; i < this.wheels.length; i++) {
      const s = this.wheels[i]!, w = slots[i]!;
      s.visible = leadOn;
      if (!leadOn) continue;
      const r = lead!.h * w.r;
      s.position.set(noseX - dir * lead!.w * w.fx, leadY - r);
      s.rotation = (dir * travel) / r;
    }
    const engine = leadOn && lead!.kind === 'engine';
    this.rod.visible = engine;
    if (engine) {
      // The side rod stays level and rides the drivers' crank pins round.
      const r = lead!.h * slots[0]!.r, a = (dir * travel) / r, crank = lead!.h * ROD_CRANK;
      this.rod.position.set(noseX - dir * lead!.w * slots[1]!.fx + Math.cos(a) * crank, leadY - r + Math.sin(a) * crank);
    }
    const handcar = leadOn && lead!.kind === 'handcar';
    this.handle.visible = handcar;
    if (handcar) {
      this.handle.position.set(noseX - dir * lead!.w * HANDLE_PIVOT.fx, leadY - lead!.h * HANDLE_PIVOT.fy);
      this.handle.rotation = this.look.handleSwing * Math.sin(travel / (this.dR * 0.42));
    }
    this.trainOn = any;
    this.refresh();
  }

  /** Where the engine's funnel mouth is for a nose position (screen px), or null when this consist has no engine. */
  funnelAt(noseX: number, out: Pt): Pt | null {
    const lead = this.units[0];
    if (!lead || lead.kind !== 'engine') return null;
    out.x = noseX - this.g.dir * lead.w * FUNNEL_MOUTH.fx;
    out.y = this.g.wheelY - lead.h * FUNNEL_MOUTH.fy;
    return out;
  }

  /** IV's crossing signal. */
  setSignal(st: SignalState): void {
    if (this.destroyed) return;
    const g = this.g.signal;
    const show = st.alpha > 0.004 && st.rise > 0.004;
    this.post.visible = show; this.arm.visible = show;
    this.lampA.visible = show && st.lampA > 0.01; this.lampB.visible = show && st.lampB > 0.01;
    if (show) {
      const k = g.h / SIGNAL_H;
      const h = g.h * st.rise;
      this.post.position.set(g.x, g.footY);
      this.post.scale.set(k * (0.6 + 0.4 * Math.min(1, st.rise)), k * st.rise);
      this.post.alpha = st.alpha;
      this.arm.position.set(g.x, g.footY - h * ARM_Y);
      // Up: standing nearly straight; down: level across the road. (Mirrored with the arm's side.)
      this.arm.rotation = -g.arm * ARM_UP * (1 - st.arm);
      this.arm.alpha = st.alpha * Math.min(1, st.rise);
      const lr = (g.h * 0.2) / GLOW_PX;
      const ly = g.footY - h * LAMP_Y;
      const dx = g.h * (SIGNAL_W / SIGNAL_H) * LAMP_DX;
      this.lampA.position.set(g.x - dx, ly); this.lampA.scale.set(lr * (0.8 + 0.3 * st.lampA)); this.lampA.alpha = st.alpha * st.lampA;
      this.lampB.position.set(g.x + dx, ly); this.lampB.scale.set(lr * (0.8 + 0.3 * st.lampB)); this.lampB.alpha = st.alpha * st.lampB;
    }
    this.refresh();
  }

  /** IV's headlight glow at the entry edge (0..1). */
  setHeadlight(k: number): void {
    if (this.destroyed) return;
    const s = this.headlight;
    s.visible = k > 0.004;
    if (s.visible) {
      const g = this.g;
      const px = this.dR * (1.2 + 3.4 * k);
      s.position.set(g.enterX, g.wheelY - this.dR * 0.55);
      s.scale.set((px * 1.5) / GLOW_PX, px / GLOW_PX);
      s.alpha = 0.85 * k;
    }
    this.refresh();
  }

  /** Hide every own object (the end, a cancel). */
  hideOwn(): void {
    for (const s of this.all) s.visible = false;
    this.own = false; this.trainOn = false;
  }

  private refresh(): void {
    this.own = this.trainOn || !!this.tiles[0]?.visible || this.post.visible || this.headlight.visible;
  }

  protected override tick(): boolean { return this.own; }
  protected override clearOwn(): void { this.hideOwn(); }

  // ── fire-and-forget ───────────────────────────────────────────────────────────────────────────────────────────

  /** A puff of steam from the funnel: it rolls up and back the way the train came, growing as it thins. `k` scales it. */
  puff(at: Pt, k = 1, life = 1): void {
    const S = this.scale, r = this.dR * 0.5 * k;
    const back = -this.g.dir;
    this.spawn('body', this.tex.puff, this.colors.steam, at.x + (this.rnd() - 0.5) * r * 0.3, at.y, {
      dur: (620 + this.rnd() * 260) * life, from: (r * 0.7) / PUFF_PX / S, to: (r * (2 + this.rnd() * 0.8)) / PUFF_PX / S, a0: 0.85, ease: 'cubic',
      vx: back * (90 + this.rnd() * 120), vy: -(130 + this.rnd() * 90), drag: 0.25, rot: this.rnd() * Math.PI * 2, spin: (this.rnd() - 0.5) * 0.002,
    });
  }

  /** A gust of wind streaks along the train's flank near the portrait (IV, while the cars go by). */
  wind(): void {
    const S = this.scale, g = this.g, R = this.dR;
    const x = g.hit.x + (this.rnd() - 0.5) * R * 7;
    const y = g.wheelY - R * (0.1 + this.rnd() * 1.5);
    const len = R * (1.6 + this.rnd() * 1.8);
    this.spawn('glow', this.tex.streak, 0xffffff, x, y, {
      dur: 200 + this.rnd() * 80, from: len / 128 / S, to: (len * 1.5) / 128 / S, a0: 0.3, sy: 0.07, rot: g.dir > 0 ? 0 : Math.PI, ease: 'linear',
      vx: g.dir * 1500, drag: 0.5,
    });
  }

  /** Sparks thrown back off a wheel on the rail at `x`. */
  sparks(x: number, n: number): void {
    const g = this.g;
    this.burst('core', this.tex.spark, [this.colors.spark, whiten(this.colors.spark, 0.5)], x, g.wheelY, n, {
      speed: 420, dir: g.dir > 0 ? Math.PI * 1.12 : -Math.PI * 0.12, spread: 0.7, life: 260, size: 0.34, drag: 0.2, grav: 900, align: true,
    });
  }

  /** A little dust kicked up off the sleepers (the track arriving, a landing). */
  dust(at: Pt, k = 1): void {
    const S = this.scale;
    this.spawn('under', this.tex.glow, DUST, at.x, at.y, { dur: 360, from: (this.dR * 0.5) / GLOW_PX / S, to: (this.dR * 1.5 * k) / GLOW_PX / S, a0: 0.22, sy: 0.45 });
  }

  /**
   * THE HIT (`at` = the contact point, the portrait's near edge), by look.
   *  - the handcar BONKS it: one fat star spinning up off the bump and two small ones;
   *  - the mine cart spills its ORE: glowing chunks tumbling out the way it was going;
   *  - the engine and the freight: a burst of steam, a flash, rings and sparks.
   */
  hit(at: Pt, burst: number): void {
    const S = this.scale, c = this.colors, R = this.dR, dir = this.g.dir;
    const b = Math.max(0.3, burst);
    this.spawn('core', this.tex.glow, c.flash, at.x, at.y, { dur: 240, from: (R * 0.5 * b) / GLOW_PX / S, to: (R * 1.7 * b) / GLOW_PX / S, a0: 0.8, mode: 'punch', peakAt: 0.12 });
    this.spawn('glow', this.tex.ring, c.side, at.x, at.y, { dur: 360, from: (R * 0.4) / RING_PX / S, to: (R * 1.9 * b) / RING_PX / S, a0: 0.55, ease: 'cubic' });
    if (this.kind === 'handcar') {
      const top = { x: at.x + dir * R * 0.2, y: at.y - R * 0.75 };
      this.spawn('body', this.tex.bonk, c.star, top.x, top.y, {
        dur: 720, from: (R * 0.25) / BONK_PX / S, to: (R * 0.95) / BONK_PX / S, a0: 1, mode: 'hold', ease: 'quint', vx: dir * 60, vy: -150, drag: 0.2, spin: dir * 0.012,
      });
      for (let i = 0; i < 2; i++) {
        this.spawn('body', this.tex.bonk, whiten(c.star, 0.35), top.x, top.y, {
          dur: 560, from: (R * 0.3) / BONK_PX / S, to: (R * 0.36) / BONK_PX / S, a0: 1, mode: 'hold', ease: 'linear', vx: (i ? 1 : -1) * 190 + dir * 40, vy: -260, grav: 700, drag: 0.4,
          spin: (i ? 1 : -1) * 0.014, delay: 40 * i,
        });
      }
      return;
    }
    if (this.kind === 'minecart') {
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + dir * (0.25 + this.rnd() * 0.9);
        const sp = 360 + this.rnd() * 420;
        const x = at.x - dir * R * 0.3 + (this.rnd() - 0.5) * R * 0.5, y = at.y - R * 0.45;
        const size = (R * (0.2 + this.rnd() * 0.16)) / ORE_PX / S;
        const o = { dur: 760 + this.rnd() * 240, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, grav: 1500, drag: 0.6, delay: i * 14 };
        this.spawn('body', this.tex.ore, i % 3 === 2 ? whiten(c.ore, 0.45) : c.ore, x, y, { ...o, from: size, to: size * 0.9, a0: 1, mode: 'hold', ease: 'linear', rot: this.rnd() * 6, spin: (this.rnd() - 0.5) * 0.03 });
        this.spawn('glow', this.tex.glow, c.ore, x, y, { ...o, from: size * 1.4, to: size * 0.9, a0: 0.55, mode: 'hold', ease: 'linear' });
      }
      this.sparks(at.x, 6);
      return;
    }
    const big = this.kind === 'freight';
    // Steam blown out and UP off the buffers (kept small and quick, so the portrait's reaction is never hidden).
    for (let i = 0; i < (big ? 6 : 4); i++) {
      const a = -Math.PI / 2 + (this.rnd() - 0.5) * 1.8;
      const sp = 260 + this.rnd() * 260;
      this.spawn('body', this.tex.puff, c.steam, at.x, at.y - R * 0.5, {
        dur: 380 + this.rnd() * 160, from: (R * 0.3) / PUFF_PX / S, to: (R * (0.7 + this.rnd() * 0.4) * b * 0.8) / PUFF_PX / S, a0: 0.85, ease: 'cubic',
        vx: Math.cos(a) * sp - dir * 160, vy: Math.sin(a) * sp, drag: 0.15, rot: this.rnd() * 6,
      });
    }
    this.spawn('glow', this.tex.ring, c.flash, at.x, at.y, { dur: 460, from: (R * 0.5) / RING_PX / S, to: (R * 3 * b) / RING_PX / S, a0: 0.6, ease: 'cubic', delay: 50 });
    this.burst('core', this.tex.spark, [c.spark, c.flash, c.side], at.x, at.y, Math.round(9 * b), { speed: 700 * b, dir: dir > 0 ? 0 : Math.PI, spread: 2.2, life: 380, size: 0.5, drag: 0.15, align: true, grav: 500 });
    this.sparks(at.x, big ? 10 : 6);
  }

  /** IV: a car slams past the portrait: a small flash and a few sparks off the rail. */
  buffet(at: Pt): void {
    const S = this.scale, R = this.dR;
    this.spawn('glow', this.tex.glow, this.colors.side, at.x, at.y, { dur: 200, from: (R * 0.8) / GLOW_PX / S, to: (R * 1.6) / GLOW_PX / S, a0: 0.3, mode: 'punch', peakAt: 0.2 });
    this.sparks(at.x, 3);
  }

  /** The last puff as the tail clears the portrait (a soft cloud left where the train was) and dust off the sleepers. */
  lastPuff(at: Pt): void {
    for (let i = 0; i < 4; i++) this.puff({ x: at.x + (this.rnd() - 0.5) * this.dR * 1.6, y: this.g.wheelY - this.dR * (0.5 + this.rnd() * 0.5) }, 1, 0.7);
    this.dust({ x: at.x, y: this.g.wheelY }, 1.4);
  }
}
