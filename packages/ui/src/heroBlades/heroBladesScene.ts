/**
 * THE PHANTOM BLADES SCENE: everything the Blades hero attack draws in Pixi, as a plain scene graph with no renderer,
 * so it runs (and is tested) headless. `heroBlades.ts` mounts `root` on the above-portrait overlay and feeds
 * `update(dt)`.
 *
 * Design rule (the owner's bar, set by Arcana: "clean", "thicker and cleaner", Blizzard polish): the SWORD is the
 * whole show, so it is one bold, crisp silhouette, never particle soup. Each sword is five sprites sharing ONE
 * transform (every sword texture is painted on the same box with the guard at the same spot): a dark outline (normal
 * blend, so it holds on a LIGHT board), a soft glow (additive, it blooms on dark ground), the blade (normal: a solid
 * spectral steel that keeps its colour on a light board), the gold hilt, and the white cutting edges (additive).
 *
 * THE POSE IS TIME, NOT STATE. A sword's position and angle come from `bladePose` (pure) at its age, so the unfurl,
 * the swing to aim, the kick back, the thrust and the quiver once it sticks are identical at any frame rate and in a
 * replay; its GHOSTS (the afterimages in flight) are the same pose sampled a few ms back, and its CUT (the thin line
 * of light behind the point) spans the tip's path over the last 120 ms.
 *
 * LAYERS, bottom to top: shade (normal) | under, glow (additive) | body (normal) | edge, air (additive): the whole
 * scene batches in a handful of runs.
 *
 * Contract: sprites are POOLED per layer (hidden and reused) and bounded by `MAX_BLADES_SPRITES`; textures are the
 * caller's; positions are the overlay's px; `setCamera` mirrors the DOM camera; `update` returns whether anything
 * still draws; `destroy()` leaves nothing behind. Scatter is seeded (a replay throws the same sparks).
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import type { HeroBlastTextures } from '../heroBlast/heroBlastScene';
import { clamp01, easeOutCubic, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';
import { SWORD_TEX, bladePose, tipOf, type BladeMotion } from './heroBladesConfig';

export interface HeroBladesTextures extends HeroBlastTextures {
  /** A sword's soft glow (its whole silhouette, blurred). */
  swordGlow: Texture;
  /** The blade (grey, bevelled, a darker fuller). */
  swordBlade: Texture;
  /** Guard, grip and pommel. */
  swordHilt: Texture;
  /** The cutting edges, the spine highlight and the gleam at the point (additive white). */
  swordEdge: Texture;
  /** A sliver of a shattered blade. */
  shard: Texture;
  /** A thin lens of light (a cut, a glint). */
  slash: Texture;
  /** The judgement reticle (Tier IV's lock-on). */
  reticle: Texture;
}

export interface BladesColors { core: number; edge: number; side: number; hilt: number; shade: number }

export interface BladeLook {
  /** Glow strength (0 = none). */
  glow: number;
  /** Cutting edge strength. */
  edge: number;
  /** The dark outline's opacity (it holds the silhouette on a light board). */
  outline: number;
  /** Afterimages in flight (0 = none). */
  ghosts: number;
  /** Sequence ms between afterimages. */
  ghostGapMs: number;
  /** The cut of light behind the point in flight (0 = none). */
  cutLine: number;
}

/** Hard cap on sprites alive at once (a Tier IV shatter peaks around 350). */
export const MAX_BLADES_SPRITES = 800;
/** Most afterimages a sword draws. */
export const MAX_GHOSTS = 5;

type LayerId = 'shade' | 'under' | 'glow' | 'body' | 'edge' | 'air';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [
  ['shade', 'normal'], ['under', 'add'], ['glow', 'add'], ['body', 'normal'], ['edge', 'add'], ['air', 'add'],
];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
const GLOW_PX = 128;
const RING_PX = 160;
const RETICLE_PX = 192;
const SWORD_LEN_PX = SWORD_TEX.tip - SWORD_TEX.pommel;

interface Blade {
  m: BladeMotion;
  age: number;
  shade: Sprite; glow: Sprite; body: Sprite; hilt: Sprite; edge: Sprite;
  ghosts: Sprite[];
  /** The cut behind the point: a white core (additive) over a side-coloured body (normal, so it shows on a light board). */
  cut: Sprite;
  cutBody: Sprite;
  /** Extra glow (a flash on the unfurl, the lock glint, the binding): decays. */
  flare: number;
  /** Tier IV: the stuck blades are bound to the judgement (a steady pulse). */
  bound: boolean;
}

type AlphaMode = 'out' | 'punch' | 'hold';
interface Fx {
  s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number;
  /** y scale as a fraction of x (1 = round). */
  sy: number; spin: number; delay: number;
}

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  from: number; to: number; alpha: number; spin: number;
  /** Stretched along its velocity (a spark). */
  streak: boolean;
}

interface Charge { ring: Sprite; glow: Sprite; x: number; y: number; r: number; age: number; left: number; releasing: number; k: number }

interface Reticle { outer: Sprite; inner: Sprite; x: number; y: number; r: number; age: number; dur: number; spokes: Sprite[]; spokeTo: Pt[] }

export class HeroBladesScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly free: Record<LayerId, Sprite[]>;
  private used = 0;
  private blades: Blade[] = [];
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private charge: Charge | null = null;
  private reticle: Reticle | null = null;
  private destroyed = false;
  private readonly steel: number;
  private readonly hot: number;
  private readonly rnd: () => number;

  constructor(private readonly tex: HeroBladesTextures, private readonly colors: BladesColors, private readonly look: BladeLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroBlades';
    this.layers = {} as Record<LayerId, Container>;
    this.free = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `blades-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.free[id] = [];
    }
    // The blade's steel: the side colour lifted toward white (spectral, but it reads as metal, not as a flat decal).
    this.steel = mixColor(whiten(colors.side, 0.42), colors.edge, 0.2);
    this.hot = whiten(colors.side, 0.55);
    this.rnd = seededRng(seed);
  }

  get liveSprites(): number { return this.used; }
  get liveBlades(): number { return this.blades.length; }
  get stuckBlades(): number { return this.blades.filter((b) => b.age >= b.m.arrive).length; }
  get charging(): boolean { return this.charge !== null; }
  get locking(): boolean { return this.reticle !== null; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) n += this.layers[id].children.length; return n; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_BLADES_SPRITES) return null;
    let s = this.free[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(s: Sprite): void {
    const layer = (s.parent?.label?.replace('blades-', '') ?? 'air') as LayerId;
    s.visible = false; this.free[layer].push(s); this.used--;
  }

  private fxs(layer: LayerId, t: Texture, tint: number, x: number, y: number, o: Partial<Omit<Fx, 's' | 'age'>> & { dur: number; from: number; to: number; a0: number }, rot = 0): Sprite | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.2, sy: 1, spin: 0, delay: 0, ...o };
    s.position.set(x, y); s.rotation = rot;
    s.scale.set(f.from * this.scale, f.from * this.scale * f.sy);
    s.alpha = f.mode === 'punch' || f.delay > 0 ? 0 : f.a0;
    this.fx.push(f);
    return s;
  }

  private particle(layer: LayerId, t: Texture, tint: number, o: Omit<Particle, 's' | 'max'>): void {
    const s = this.take(layer, t, tint);
    if (!s) return;
    s.position.set(o.x, o.y);
    s.rotation = this.rnd() * Math.PI * 2;
    this.particles.push({ ...o, s, max: o.life });
  }

  /** Metal sparks: bright streaks flung off a point along `dir` (radians) with gravity. */
  private sparks(x: number, y: number, n: number, speed: number, dir: number, spread: number, life = 380): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = dir + (this.rnd() - 0.5) * spread;
      const sp = speed * (0.45 + this.rnd() * 0.8) * S;
      this.particle('air', this.tex.spark, i % 3 === 0 ? this.colors.core : i % 3 === 1 ? this.hot : this.colors.hilt, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.02, grav: 900 * S, life: life * (0.6 + this.rnd() * 0.6),
        from: (0.5 + this.rnd() * 0.35) * S, to: 0.15 * S, alpha: 1, spin: 0, streak: true,
      });
    }
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** A four-point glint: two thin lenses crossed (a sharp gleam off steel). */
  private glint(x: number, y: number, size: number, dur: number, rot = 0): void {
    this.fxs('air', this.tex.slash, this.colors.core, x, y, { dur, from: 0.3 * size, to: 1.1 * size, a0: 1, mode: 'punch', peakAt: 0.25, sy: 0.9 }, rot);
    this.fxs('air', this.tex.slash, this.colors.edge, x, y, { dur, from: 0.2 * size, to: 0.75 * size, a0: 0.9, mode: 'punch', peakAt: 0.25, sy: 0.9 }, rot + Math.PI / 2);
  }

  /** The hero gathers: a flat summoning ring round the portrait and a soft glow, held until the last blade looses. */
  startCharge(x: number, y: number, radius: number, blades: number, k: number): void {
    if (this.charge) return;
    const ring = this.take('under', this.tex.ring, this.colors.edge);
    const glow = this.take('under', this.tex.glow, this.colors.side);
    if (!ring || !glow) { for (const s of [ring, glow]) if (s) this.give(s); return; }
    for (const s of [ring, glow]) { s.position.set(x, y); s.alpha = 0; }
    this.charge = { ring, glow, x, y, r: radius, age: 0, left: Math.max(1, blades), releasing: -1, k };
  }

  /**
   * A sword is summoned along `m` (`age0` = ms since it started to unfurl): a line of light is drawn from the hero to
   * its hover point, and a flash and a vertical gleam mark where it forms.
   */
  summon(m: BladeMotion, from: Pt, age0 = 0): void {
    const shade = this.take('shade', this.tex.swordGlow, this.colors.shade);
    const glow = this.take('glow', this.tex.swordGlow, this.colors.side);
    const body = this.take('body', this.tex.swordBlade, this.steel);
    const hilt = this.take('body', this.tex.swordHilt, this.colors.hilt);
    const edge = this.take('edge', this.tex.swordEdge, this.colors.core);
    const cut = this.take('air', this.tex.streak, this.colors.edge);
    const cutBody = this.take('shade', this.tex.streak, this.colors.side);
    const ghosts: Sprite[] = [];
    const nG = Math.min(MAX_GHOSTS, Math.max(0, Math.round(this.look.ghosts)));
    for (let i = 0; i < nG; i++) { const g = this.take('shade', this.tex.swordBlade, this.colors.side); if (g) ghosts.push(g); }
    if (!shade || !glow || !body || !hilt || !edge || !cut || !cutBody) {
      for (const s of [shade, glow, body, hilt, edge, cut, cutBody, ...ghosts]) if (s) this.give(s);
      return;
    }
    const ax = SWORD_TEX.guard / SWORD_TEX.w;
    for (const s of [shade, glow, body, hilt, edge, ...ghosts]) { s.anchor.set(ax, 0.5); s.alpha = 0; }
    for (const s of [cut, cutBody]) { s.anchor.set(1, 0.5); s.alpha = 0; }
    this.blades.push({ m, age: Math.max(0, age0), shade, glow, body, hilt, edge, ghosts, cut, cutBody, flare: 1, bound: false });
    const S = this.scale;
    const size = Math.min(1.5, m.length / (190 * S));
    // The call: a quick line of light from the hero to where the sword forms.
    const dx = m.home.x - from.x, dy = m.home.y - from.y;
    const L = Math.hypot(dx, dy);
    if (L > 4) {
      this.fxs('air', this.tex.streak, this.colors.edge, (from.x + m.home.x) / 2, (from.y + m.home.y) / 2,
        { dur: 200, from: L / 64 / S, to: L / 64 / S, a0: 0.8, sy: (6 * S) / (L / 64) / 18 }, Math.atan2(dy, dx));
    }
    this.fxs('air', this.tex.glow, this.colors.core, m.home.x, m.home.y, { dur: 200, from: 0.4 * size, to: 1.2 * size, a0: 0.8, mode: 'punch', peakAt: 0.2 });
    this.fxs('air', this.tex.ring, this.colors.edge, m.home.x, m.home.y, { dur: 200, from: 0.25 * size, to: 0.8 * size, a0: 0.55 });
    // It ASSEMBLES: slivers of steel fly in from round it and meet along its length (the shatter, played backwards).
    const shards = m.great ? 14 : 7;
    const up = { x: Math.cos(m.ang0), y: Math.sin(m.ang0) };
    for (let j = 0; j < shards; j++) {
      const f = (j + 0.5) / shards;
      const tx = m.home.x + up.x * m.tipLen * (f * 1.1 - 0.1), ty = m.home.y + up.y * m.tipLen * (f * 1.1 - 0.1);
      const a = this.rnd() * Math.PI * 2;
      const r = (60 + this.rnd() * 50) * S * Math.min(1.6, size);
      const life = m.manifestMs * (0.55 + 0.3 * this.rnd());
      const sp = r / (life / 1000);
      this.particle('air', this.tex.shard, j % 2 ? this.colors.core : this.colors.edge, {
        x: tx + Math.cos(a) * r, y: ty + Math.sin(a) * r, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, drag: 1, grav: 0,
        life, from: 0.9 * S * Math.min(1.5, size), to: 0.45 * S, alpha: 1, spin: 0.02, streak: false,
      });
    }
    // A gleam down the length of the sword as it forms.
    this.fxs('air', this.tex.slash, this.colors.core, m.home.x, m.home.y - m.tipLen * 0.35, { dur: 240, from: (m.length / 128 / S) * 0.5, to: (m.length / 128 / S) * 1.05, a0: 0.9, mode: 'punch', peakAt: 0.3, sy: 0.35 }, m.ang0);
  }

  /** Every blade locks on: a glint off each point. */
  lock(): void {
    for (const b of this.blades) {
      if (b.m.great || b.age >= b.m.arrive) continue;
      const p = bladePose(b.m, b.age);
      const tip = tipOf(p, b.m.tipLen);
      this.glint(tip.x, tip.y, 0.8 * (b.m.length / (190 * this.scale)), 260, p.ang);
      b.flare = Math.max(b.flare, 0.8);
    }
  }

  /** A blade (by motion index) is loosed: a flash at its guard and a snap ring; the summoning ring counts it down. */
  loose(m: BladeMotion): void {
    const ch = this.charge;
    if (!m.great && ch && ch.releasing < 0 && --ch.left <= 0) ch.releasing = 0;
    const b = this.blades.find((x) => x.m === m);
    const size = m.length / (190 * this.scale);
    const p = b ? bladePose(m, b.age) : { x: m.home.x, y: m.home.y, ang: m.aim };
    if (b) b.flare = 1;
    this.fxs('air', this.tex.glow, this.colors.core, p.x, p.y, { dur: 150, from: 0.5 * size, to: 1.4 * size, a0: 0.8 });
    this.fxs('air', this.tex.ring, this.colors.edge, p.x, p.y, { dur: 220, from: 0.3 * size, to: 1.3 * size, a0: 0.8, sy: 0.5 }, p.ang);
    if (m.great) {
      // The greatsword breaks the air as it goes: a pair of flattened rings punched out along its line.
      const d = { x: Math.cos(m.aim), y: Math.sin(m.aim) };
      const at = { x: p.x + d.x * m.tipLen * 0.5, y: p.y + d.y * m.tipLen * 0.5 };
      this.fxs('air', this.tex.ring, this.colors.core, at.x, at.y, { dur: 260, from: 0.4, to: 2.4, a0: 0.9, sy: 0.38 }, m.aim + Math.PI / 2);
      this.fxs('air', this.tex.ring, this.colors.side, at.x + d.x * 40 * this.scale, at.y + d.y * 40 * this.scale, { dur: 320, from: 0.3, to: 1.8, a0: 0.7, sy: 0.38, delay: 50 }, m.aim + Math.PI / 2);
    }
  }

  /**
   * A blade goes in (a tick): a cut of light across its line, a flash, a crisp ring and a spray of metal sparks thrown
   * back off the point. `step` grows each tick.
   */
  hit(m: BladeMotion, step: number): void {
    const x = m.tipTo.x, y = m.tipTo.y;
    const g = (m.length / (190 * this.scale)) * (1 + 0.08 * step);
    this.fxs('air', this.tex.glow, this.colors.core, x, y, { dur: 110, from: 0.6 * g, to: 1.5 * g, a0: 0.7 });
    this.fxs('air', this.tex.glow, this.colors.side, x, y, { dur: 280, from: 0.9 * g, to: 2.2 * g, a0: 0.3 });
    this.fxs('air', this.tex.slash, this.colors.core, x, y, { dur: 200, from: 0.6 * g, to: 1.5 * g, a0: 1, mode: 'punch', peakAt: 0.15, sy: 0.7 }, m.aim + Math.PI / 2);
    this.fxs('air', this.tex.ring, this.colors.edge, x, y, { dur: 260, from: 0.3, to: 1.4 * g, a0: 0.8 });
    this.sparks(x, y, 9, 700, m.aim + Math.PI, 1.6, 360);
    const b = this.blades.find((q) => q.m === m);
    if (b) b.flare = 1;
  }

  /**
   * THE impact (I-III, and Tier IV's greatsword): everything starts AT its peak so the first frame is the brightest
   * frame: a short flash over the portrait, a white burst, a side bloom, a big CROSS CUT (two lenses at +-45 degrees to
   * the blow), two rings, a spray of sparks carried through, and an afterglow. Fills are short (the big -N must read).
   */
  impact(x: number, y: number, dir: Pt, radius: number, o: { tier: number; k: number; burst: number; great: boolean }): void {
    const c = this.colors;
    const fs = o.burst;
    const S = this.scale;
    const portrait = (radius * 2) / GLOW_PX / S;
    const head = Math.atan2(dir.y, dir.x);
    this.fxs('air', this.tex.glow, c.core, x, y, { dur: 110, from: portrait * 1.05, to: portrait * 1.25, a0: 0.6 });
    this.fxs('air', this.tex.glow, c.core, x, y, { dur: 150, from: 1 * fs, to: Math.min(3.4, 2.2 * fs), a0: 1 });
    this.fxs('air', this.tex.glow, c.side, x, y, { dur: 360, from: 1.4 * fs, to: Math.min(4.5, 3 * fs), a0: 0.35 });
    // THE CROSS CUT: two long lenses crossing on the target, reaching well past the big -N (so it reads round it).
    const cutLen = (radius * 3.6 * (1 + 0.3 * o.k)) / 128 / S;
    for (const s of [-1, 1]) {
      this.fxs('shade', this.tex.slash, c.shade, x, y, { dur: 340, from: cutLen * 0.75, to: cutLen * 1.12, a0: 0.5, sy: 2.4 }, head + s * Math.PI / 4);
      this.fxs('air', this.tex.slash, c.side, x, y, { dur: 380, from: cutLen * 0.8, to: cutLen * 1.18, a0: 0.8, sy: 1.8 }, head + s * Math.PI / 4);
      this.fxs('air', this.tex.slash, c.core, x, y, { dur: 300, from: cutLen * 0.72, to: cutLen * 1.1, a0: 1, sy: 0.9 }, head + s * Math.PI / 4);
    }
    this.fxs('air', this.tex.ring, c.core, x, y, { dur: 320, from: 0.5, to: 3 * (0.85 + 0.45 * o.k), a0: 1 });
    this.fxs('air', this.tex.ring, c.edge, x, y, { dur: 560, from: 0.5, to: 4.4 * (0.85 + 0.45 * o.k), a0: 0.6 });
    this.sparks(x, y, Math.round(14 + 12 * o.k), 1000, head + Math.PI, 2.2, 480);
    this.sparks(x, y, Math.round(8 + 8 * o.k), 800, head, 1.2, 420);
    if (o.great) {
      // Judgement: a pillar of light straight up through the target, and a flat shockwave along the ground.
      this.fxs('air', this.tex.glow, c.core, x, y - radius * 1.2, { dur: 520, from: 1.2, to: 1.6, a0: 0.9, sy: 5.5, mode: 'punch', peakAt: 0.05 });
      this.fxs('air', this.tex.glow, c.side, x, y - radius * 1.4, { dur: 900, from: 2.2, to: 2.8, a0: 0.55, sy: 4.5 });
      this.fxs('air', this.tex.ring, c.core, x, y, { dur: 340, from: 0.6, to: 4.6, a0: 0.8, sy: 0.5 });
      // The judgement's seal: the reticle stamped out from the target and gone.
      this.fxs('air', this.tex.reticle, whiten(c.edge, 0.3), x, y, { dur: 520, from: (radius * 2.2) / RETICLE_PX / S, to: (radius * 4.2) / RETICLE_PX / S, a0: 1, spin: 0.004 });
    }
    this.fxs('air', this.tex.glow, c.side, x, y, { dur: o.tier >= 3 ? 800 : 650, from: 1.6 * Math.min(1.4, fs), to: 2 * Math.min(1.4, fs), a0: o.tier >= 3 ? 0.26 : 0.2 });
  }

  /**
   * Every blade stuck in the target SHATTERS: each one bursts into slivers of steel (spinning, flung out away from the
   * target's centre, falling), with a flash along its length. `shards` per blade.
   */
  shatter(cx: number, cy: number, shards: number): number {
    let n = 0;
    for (let i = this.blades.length - 1; i >= 0; i--) {
      const b = this.blades[i]!;
      if (b.age < b.m.arrive) continue;
      if (b.m.great) this.lastGreat = true;
      const p = bladePose(b.m, b.age);
      const tip = tipOf(p, b.m.tipLen);
      const size = b.m.length / (190 * this.scale);
      const k = Math.round(shards * (b.m.great ? 2.2 : 1));
      for (let j = 0; j < k; j++) {
        const f = this.rnd();
        // Along the blade, from just behind the guard to the point.
        const x = p.x + (tip.x - p.x) * (f * 1.05 - 0.05), y = p.y + (tip.y - p.y) * (f * 1.05 - 0.05);
        const out = Math.atan2(y - cy, x - cx) + (this.rnd() - 0.5) * 1.2;
        const sp = (260 + this.rnd() * 420) * (b.m.great ? 1.35 : 1) * this.scale;
        this.particle('body', this.tex.shard, j % 3 === 0 ? this.colors.core : this.steel, {
          x, y, vx: Math.cos(out) * sp, vy: Math.sin(out) * sp - 120 * this.scale, drag: 0.08, grav: 1100 * this.scale,
          life: 480 + this.rnd() * 360, from: (0.7 + this.rnd() * 0.7) * size * this.scale, to: 0.3 * size * this.scale, alpha: 1,
          spin: (this.rnd() - 0.5) * 0.05, streak: false,
        });
      }
      const mid = { x: (p.x + tip.x) / 2, y: (p.y + tip.y) / 2 };
      this.fxs('air', this.tex.slash, this.colors.core, mid.x, mid.y, { dur: 180, from: (b.m.length / 128 / this.scale) * 0.8, to: (b.m.length / 128 / this.scale) * 1.1, a0: 1, sy: 1.6 }, p.ang);
      this.fxs('air', this.tex.glow, this.colors.side, mid.x, mid.y, { dur: 260, from: 0.8 * size, to: 1.8 * size, a0: 0.5 });
      this.dropBlade(b); this.blades.splice(i, 1); n++;
    }
    if (this.reticle) this.dropReticle();
    if (n > 0) {
      // A STARBURST of light blades flung out of the target (bold, few, crisp: the shatter's silhouette reads round the
      // big -N). More, longer rays when the greatsword went in.
      const great = this.lastGreat;
      const rays = great ? 10 : 4 + Math.min(4, n);
      const S = this.scale;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2 + this.rnd() * 0.3;
        const len = (great ? 150 : 95) * (0.8 + this.rnd() * 0.5) * S;
        const x = cx + Math.cos(a) * len * 0.9, y = cy + Math.sin(a) * len * 0.9;
        this.fxs('air', this.tex.slash, i % 2 ? this.colors.core : this.colors.edge, x, y, { dur: great ? 360 : 280, from: (len / 128 / S) * 0.8, to: (len / 128 / S) * 1.5, a0: 1, sy: 0.9 }, a);
        this.fxs('shade', this.tex.slash, this.colors.side, x, y, { dur: great ? 380 : 300, from: (len / 128 / S) * 0.9, to: (len / 128 / S) * 1.6, a0: 0.55, sy: 1.8 }, a);
      }
    }
    this.lastGreat = false;
    return n;
  }

  /**
   * TIER IV: the judgement locks on. A reticle closes and spins onto the target, and the stuck blades are BOUND: a spoke
   * of light from each one's guard into the centre, and a steady pulse, until the greatsword goes in. `durMs` is the
   * hang (the lock tightens over it).
   */
  lockOn(x: number, y: number, radius: number, durMs: number, beams: number): void {
    if (this.reticle) return;
    const outer = this.take('under', this.tex.reticle, this.colors.side);
    const inner = this.take('air', this.tex.reticle, whiten(this.colors.edge, 0.2));
    if (!outer || !inner) { for (const s of [outer, inner]) if (s) this.give(s); return; }
    for (const s of [outer, inner]) { s.position.set(x, y); s.alpha = 0; }
    const spokes: Sprite[] = [];
    const spokeTo: Pt[] = [];
    if (beams > 0) {
      for (const b of this.blades) {
        if (b.m.great || b.age < b.m.arrive) continue;
        b.bound = true;
        const s = this.take('air', this.tex.slash, this.colors.edge);
        if (!s) continue;
        s.alpha = 0; spokes.push(s);
        const p = bladePose(b.m, b.age);
        spokeTo.push({ x: p.x, y: p.y });
      }
    }
    this.reticle = { outer, inner, x, y, r: radius, age: 0, dur: Math.max(1, durMs), spokes, spokeTo };
    this.spokeAlpha = beams;
  }

  private spokeAlpha = 0;
  private lastGreat = false;

  /** An aftershock round the target (IV): a small flash, a ring and a few sparks. */
  boom(x: number, y: number, size: number): void {
    this.fxs('air', this.tex.glow, this.colors.core, x, y, { dur: 200, from: 0.8 * size, to: 2 * size, a0: 0.9 });
    this.fxs('air', this.tex.glow, this.colors.side, x, y, { dur: 420, from: 1.2 * size, to: 3 * size, a0: 0.55 });
    this.fxs('air', this.tex.ring, this.colors.edge, x, y, { dur: 360, from: 0.3, to: 2.2 * size, a0: 0.9 });
    this.glint(x, y, 1.1 * size, 260, this.rnd() * Math.PI);
    this.sparks(x, y, 8, 620, -Math.PI / 2, Math.PI * 2, 400);
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
      const u = clamp01(ch.age / 260);
      const rs = (ch.r * 2.45) / RING_PX; // the ring texture's circle is 0.8 of its box: this sits just outside the rim
      if (ch.releasing < 0) {
        const e = easeOutCubic(u);
        const throb = 1 + 0.04 * Math.sin(ch.age * 0.02);
        // A ring of light closing onto the portrait's rim (the hero is the one gathering the blades).
        ch.ring.scale.set(rs * (1.35 - 0.35 * e) * throb);
        ch.ring.rotation += dt * 0.002;
        ch.ring.alpha = 0.8 * u;
        ch.glow.scale.set((ch.r * 3.2) / GLOW_PX * (1 + 0.2 * ch.k));
        ch.glow.alpha = 0.18 * u;
      } else {
        ch.releasing += dt;
        const r = clamp01(ch.releasing / 220);
        ch.ring.scale.set(rs * (1 + 0.35 * r));
        ch.ring.alpha = 0.85 * (1 - r);
        ch.glow.alpha = 0.18 * (1 - r);
        if (r >= 1) { this.give(ch.ring); this.give(ch.glow); this.charge = null; }
      }
    }

    const rt = this.reticle;
    if (rt) {
      rt.age += dt;
      const u = clamp01(rt.age / rt.dur);
      const e = easeOutCubic(clamp01(rt.age / 200));
      const size = (rt.r * 2.4) / RETICLE_PX;
      rt.outer.scale.set(size * (1.9 - 0.9 * e - 0.08 * u)); rt.outer.alpha = 0.9 * e;
      rt.outer.rotation += dt * (0.0015 + 0.004 * u);
      rt.inner.scale.set(size * 0.62 * (1.6 - 0.6 * e)); rt.inner.alpha = (0.6 + 0.4 * u) * e;
      rt.inner.rotation -= dt * (0.003 + 0.01 * u);
      for (let i = 0; i < rt.spokes.length; i++) {
        const s = rt.spokes[i]!, from = rt.spokeTo[i]!;
        const dx = rt.x - from.x, dy = rt.y - from.y;
        const L = Math.hypot(dx, dy);
        s.position.set((from.x + rt.x) / 2, (from.y + rt.y) / 2);
        s.rotation = Math.atan2(dy, dx);
        s.scale.set(L / 128, (0.45 + 0.35 * u) * S);
        s.alpha = this.spokeAlpha * e * (0.55 + 0.45 * Math.sin(rt.age * 0.04) ** 2);
      }
    }

    for (let i = this.blades.length - 1; i >= 0; i--) this.drawBlade(this.blades[i]!, dt);

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
      if (p.streak) {
        // A spark: stretched along its velocity (a hot streak, not a dot).
        const v = Math.hypot(p.vx, p.vy);
        p.s.rotation = Math.atan2(p.vy, p.vx);
        p.s.scale.set(sc * (1 + Math.min(3.5, v / (260 * S))), sc * 0.55);
      } else {
        p.s.scale.set(sc);
        if (p.spin) p.s.rotation += p.spin * dt;
      }
      p.s.alpha = p.alpha * (1 - t * t);
    }

    return this.used > 0;
  }

  /** One sword, from its pose at its age: five layers on one transform, its ghosts and its cut. */
  private drawBlade(b: Blade, dt: number): void {
    b.age += dt;
    const m = b.m;
    const L = this.look;
    const S = this.scale;
    const p = bladePose(m, b.age);
    const all = [b.shade, b.glow, b.body, b.hilt, b.edge];
    if (p.phase === 'hidden') { for (const s of all) s.alpha = 0; return; }
    b.flare = Math.max(0, b.flare - dt / 260);
    const k = m.length / SWORD_LEN_PX;
    const sx = k * p.unfurl, sy = k;
    // The greatsword trembles while it hangs (held back, straining), harder toward the loose.
    let jx = 0, jy = 0;
    if (m.great && p.phase === 'lock') {
      const u = clamp01((b.age - m.aimEnd) / Math.max(1, m.pullStart - m.aimEnd));
      const a = (0.6 + 2.4 * u * u) * S;
      jx = a * Math.sin(b.age * 0.31); jy = a * Math.sin(b.age * 0.43 + 1.1);
    }
    const x = p.x + jx, y = p.y + jy;
    const fadeIn = p.phase === 'manifest' ? clamp01((b.age / Math.max(1, m.manifestMs)) * 2.2) : 1;
    const stuck = p.phase === 'stuck';
    const pulse = b.bound ? 0.3 + 0.3 * Math.sin(b.age * 0.035) ** 2 : 0;
    const hangGlow = m.great && p.phase === 'lock' ? 0.35 * clamp01((b.age - m.aimEnd) / Math.max(1, m.pullStart - m.aimEnd)) : 0;
    const glowA = L.glow * (m.great ? 0.7 : 1) * ((stuck ? 0.42 : p.phase === 'flight' ? 0.95 : 0.62) + 0.6 * b.flare + pulse + hangGlow) * fadeIn;
    for (const s of all) { s.position.set(x, y); s.rotation = p.ang; s.scale.set(sx, sy); }
    b.shade.scale.set(sx * 1.03, sy * 1.25);
    b.glow.scale.set(sx * 1.02, sy * (p.phase === 'flight' ? 1.7 : 1.35));
    b.shade.alpha = L.outline * 0.6 * fadeIn;
    b.glow.alpha = Math.min(1, glowA);
    b.body.alpha = 0.97 * fadeIn;
    b.hilt.alpha = fadeIn;
    b.edge.alpha = Math.min(1, L.edge * (0.75 + 0.5 * b.flare + pulse) * fadeIn);

    // Ghosts: the same sword a few ms back, only while it is thrusting.
    const inFlight = p.phase === 'flight' || p.phase === 'pull';
    for (let i = 0; i < b.ghosts.length; i++) {
      const g = b.ghosts[i]!;
      const q = bladePose(m, b.age - (i + 1) * L.ghostGapMs);
      if (!inFlight && !(stuck && b.age - m.arrive < (i + 1) * L.ghostGapMs) || (q.phase !== 'flight' && q.phase !== 'pull')) { g.alpha = 0; continue; }
      g.position.set(q.x, q.y); g.rotation = q.ang; g.scale.set(k, k);
      g.alpha = 0.55 * Math.pow(0.6, i) * Math.min(1, L.glow + 0.3);
    }

    // The cut: a thin line of light over the tip's path in the last 120 ms (it lingers a beat after the stab).
    const sinceIn = b.age - m.arrive;
    if (L.cutLine > 0 && b.age > m.flightStart && sinceIn < 160) {
      const tipNow = tipOf(p, m.tipLen);
      const back = bladePose(m, Math.max(m.flightStart, Math.min(b.age, m.arrive) - 120));
      const tipBack = tipOf(back, m.tipLen);
      const len = Math.hypot(tipNow.x - tipBack.x, tipNow.y - tipBack.y);
      const end = stuck ? tipOf(bladePose(m, m.arrive), m.tipLen) : tipNow;
      const fade = L.cutLine * (stuck ? 1 - sinceIn / 160 : 1);
      const th = (m.great ? 7 : 4) * S;
      for (const [sp, w, a] of [[b.cut, th, fade], [b.cutBody, th * 2.4, fade * 0.55]] as const) {
        sp.position.set(end.x, end.y);
        sp.rotation = m.aim;
        sp.scale.set(Math.max(0.01, len / 64), w / 18);
        sp.alpha = a;
      }
    } else { b.cut.alpha = 0; b.cutBody.alpha = 0; }
  }

  private dropBlade(b: Blade): void {
    for (const s of [b.shade, b.glow, b.body, b.hilt, b.edge, b.cut, b.cutBody, ...b.ghosts]) this.give(s);
  }

  private dropReticle(): void {
    const rt = this.reticle;
    if (!rt) return;
    for (const s of [rt.outer, rt.inner, ...rt.spokes]) this.give(s);
    this.reticle = null;
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const b of this.blades) this.dropBlade(b);
    for (const q of this.fx) this.give(q.s);
    for (const p of this.particles) this.give(p.s);
    if (this.charge) { this.give(this.charge.ring); this.give(this.charge.glow); }
    this.dropReticle();
    this.blades = []; this.fx = []; this.particles = []; this.charge = null;
  }

  /** Tear down: every sprite destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (const [id] of LAYERS) {
      this.free[id].length = 0;
      this.layers[id].removeChildren().forEach((c) => c.destroy());
    }
    this.root.removeChildren().forEach((c) => c.destroy());
    this.root.destroy();
  }
}
