/**
 * THE ENRAGED STRIKE SCENE: everything the Enraged Strike draws in Pixi, as a plain scene graph with no renderer, so it
 * runs (and is tested) headless. `heroEnraged.ts` mounts `root` on the above-portrait overlay, calls `follow(t)` from
 * the sequence clock's paint (the hero's pose drives the aura, the afterimages and the wake) and feeds `update(dt)`.
 *
 * Design rule (the owner's bar, Arcana's techniques): the HERO is the subject (the DOM portrait itself lunges), and
 * everything here is drawn off its pure motion, so it is clean at any frame rate and identical in a replay:
 *  - THE AURA rides the portrait: flame tongues licking off the rim (a deep NORMAL-blend body that keeps its colour on
 *    a light board, an ADDITIVE hot core that blooms on a dark one), leaning upward (fire rises) and streaming back
 *    when the hero moves fast; a hot rim glow and a heat ring; embers shed upward. Its size follows the rage (`heat`).
 *  - THE AFTERIMAGES are the hero's own portrait, sampled BACK IN TIME along its motion (Arcana's trail technique), so a
 *    fast dash leaves a spread of fading red ghosts and a still hero leaves none.
 *  - THE WAKE is three strip meshes (glow / body / core, Arcana's ribbon textures) on the same sampled centreline.
 *  - THE STRIKE starts at its brightest (the hit-stop freezes the peak frame): a white-hot flash and a hot core that are
 *    gone within ~200 ms (fills are short), then line work that lingers (rings, claw rips), chunky sparks with gravity,
 *    embers, smoke. Ticks are line work only (one claw set, one ring, a small flash).
 *  - THE METEOR adds a screen-filling flash, a scorched crater round the struck portrait with glowing cracks, rock
 *    debris (normal blend: it reads as solid) and an ember explosion.
 *
 * LAYERS, bottom to top: shade (normal: smoke, scorch, debris, dust) | under (add: cracks) | ghost (add) | glow (add) |
 * body (normal) | core (add) | air (add), so the scene batches in a handful of runs.
 *
 * Contract: sprites and strip meshes are POOLED per layer (hidden and reused), bounded by `MAX_ENRAGED_SPRITES` /
 * `MAX_ENRAGED_MESHES`; textures are the caller's; positions are the overlay's px; `setCamera` mirrors the DOM camera;
 * `update` returns whether anything still draws; `destroy()` leaves nothing behind. Scatter is seeded.
 */
import { Container, MeshSimple, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeOutCubic, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';

export interface HeroEnragedTextures extends HeroArcanaTextures {
  /** A flame tongue pointing up. */
  flame: Texture;
  /** A claw rip, +X aligned. */
  slash: Texture;
  smoke: Texture;
  rock: Texture;
  /** The crater's scorch (tinted dark) and its glowing cracks. */
  scorch: Texture;
  cracks: Texture;
  /** The afterimage when there is no portrait art. */
  disc: Texture;
}

export interface EnragedColors { core: number; hot: number; side: number; shade: number; smoke: number }

export interface EnragedLook {
  auraSize: number;
  flames: number;
  flameLength: number;
  ghosts: number;
  ghostStepMs: number;
  ghostAlpha: number;
  wakeWidth: number;
  wakeMs: number;
  ringSize: number;
  ring2Size: number;
  slashLength: number;
  slashWidth: number;
  sparkSpeed: number;
  emberLife: number;
  craterSize: number;
  debris: number;
}

/** The hero at a moment (screen px): centre, scale and rage. */
export interface HeroAt { x: number; y: number; s: number; heat: number }

/** Hard cap on sprites alive at once (a Tier IV meteor peaks around 450). */
export const MAX_ENRAGED_SPRITES = 1100;
/** Hard cap on strip meshes (the wake: three). */
export const MAX_ENRAGED_MESHES = 6;
/** Points along the wake: 48 vertices per strip, so every strip still batches. */
export const WAKE_POINTS = 24;
/** Ghost sprites kept for the afterimages. */
export const MAX_GHOSTS = 10;

type LayerId = 'shade' | 'under' | 'ghost' | 'glow' | 'body' | 'core' | 'air';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [
  ['shade', 'normal'], ['under', 'add'], ['ghost', 'add'], ['glow', 'add'], ['body', 'normal'], ['core', 'add'], ['air', 'add'],
];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
/** Texture sizes (px) the sprite scales divide by. */
const GLOW_PX = 128, RING_R = 64, SLASH_PX = 256, GHOST_PX = 128, SCORCH_PX = 192, CRACK_PX = 256;

type AlphaMode = 'out' | 'punch' | 'hold' | 'rip';
interface Fx {
  s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number;
  sy: number; spin: number; delay: number;
  /** A rip: its length grows from 0 over `grow` ms (anchored at its start), its width fixed. */
  grow: number; len: number; width: number;
}

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  from: number; to: number; alpha: number; twinkle: number; spin: number; streak: number;
  /** Pulled into the hero (the windup's dust): the pull strength per second, 0 = a free particle. */
  pull: number;
}

interface Flame { body: Sprite; core: Sprite; ang: number; phase: number; len: number }
interface Aura { flames: Flame[]; rim: Sprite; ring: Sprite; ball: Sprite; heat: number; age: number; emberAcc: number; dustLeft: number; dustAcc: number; dustRate: number }
interface Wake { glow: MeshSimple; body: MeshSimple; core: MeshSimple }
interface Smoulder { x: number; y: number; r: number; left: number; acc: number; smokeAcc: number }

export class HeroEnragedScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private used = 0;
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private aura: Aura | null = null;
  private ghosts: Sprite[] = [];
  private wake: Wake | null = null;
  private smoulders: Smoulder[] = [];
  private warm: Sprite[] = [];
  private warmLeft = 0;
  private destroyed = false;
  private readonly rnd: () => number;
  private readonly deep: number;
  private readonly glowC: number;
  private readonly uvs: Float32Array;
  private readonly idx: Uint32Array;
  private path: ((t: number) => HeroAt) | null = null;
  private radius = 60;
  private ghostTex: Texture;
  private lastT = Number.NaN;
  private lastHero: HeroAt = { x: 0, y: 0, s: 1, heat: 0 };
  private recovering = false;
  private trailAcc = 0;
  // scratch (the wake's centreline and its normals, reused every frame)
  private readonly px = new Float32Array(WAKE_POINTS);
  private readonly py = new Float32Array(WAKE_POINTS);
  private readonly nx = new Float32Array(WAKE_POINTS);
  private readonly ny = new Float32Array(WAKE_POINTS);
  private readonly hw = new Float32Array(WAKE_POINTS);

  constructor(private readonly tex: HeroEnragedTextures, private readonly colors: EnragedColors, private readonly look: EnragedLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroEnraged';
    this.layers = {} as Record<LayerId, Container>;
    this.freeSprites = {} as Record<LayerId, Sprite[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `enraged-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.freeSprites[id] = [];
    }
    this.rnd = seededRng(seed);
    this.ghostTex = tex.disc;
    // The flame body: the side colour pushed deep toward the shade, so it stays saturated on a light board.
    this.deep = mixColor(colors.side, colors.shade, 0.3);
    this.glowC = whiten(colors.side, 0.15);
    const n = WAKE_POINTS;
    this.uvs = new Float32Array(n * 4);
    for (let j = 0; j < n; j++) {
      const u = 1 - j / (n - 1);
      this.uvs[j * 4] = u; this.uvs[j * 4 + 1] = 0; this.uvs[j * 4 + 2] = u; this.uvs[j * 4 + 3] = 1;
    }
    this.idx = new Uint32Array((n - 1) * 6);
    for (let j = 0; j < n - 1; j++) { const a = j * 2; this.idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], j * 6); }
    // PRE-WARM: one near-invisible sprite per texture for the first few hundred ms (the formation is still playing), so
    // every texture is uploaded to the GPU long before the first flame or rip needs it (no first-play spike).
    const warmTex = [tex.glow, tex.spark, tex.streak, tex.ring, tex.flame, tex.slash, tex.smoke, tex.rock, tex.scorch, tex.cracks, tex.disc, tex.ribbonSoft, tex.ribbonBody];
    for (const t of warmTex) { const s = this.take('air', t, 0xffffff); if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); } }
    this.warmLeft = 400;
  }

  get liveSprites(): number { return this.used; }
  get liveMeshes(): number { return this.wake ? 3 : 0; }
  get burning(): boolean { return this.aura !== null; }
  get smouldering(): boolean { return this.smoulders.length > 0; }
  get visibleGhosts(): number { return this.ghosts.filter((g) => g.visible && g.alpha > 0.02).length; }
  get pooledSprites(): number { let n = 0; for (const [id] of LAYERS) for (const ch of this.layers[id].children) if (ch instanceof Sprite) n++; return n; }

  /** Mirror the DOM camera: zoom `z` about the origin with offset `(ax, ay)` already folded in. */
  setCamera(ax: number, ay: number, z: number): void {
    if (this.destroyed) return;
    this.root.position.set(ax, ay);
    this.root.scale.set(z);
  }

  /**
   * The striking hero: its motion (pure: the scene samples it back in time), its radius (screen px) and its portrait
   * art for the afterimages (null = the silhouette).
   */
  setHero(path: (t: number) => HeroAt, radius: number, ghost: Texture | null): void {
    this.path = path;
    this.radius = Math.max(8, radius);
    this.ghostTex = ghost ?? this.tex.disc;
  }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  private take(layer: LayerId, t: Texture, tint: number): Sprite | null {
    if (this.destroyed || this.used >= MAX_ENRAGED_SPRITES) return null;
    let s = this.freeSprites[layer].pop();
    if (!s) { s = new Sprite(t); s.blendMode = BLEND[layer]; this.layers[layer].addChild(s); } else s.texture = t;
    s.anchor.set(0.5);
    s.tint = tint; s.visible = true; s.alpha = 1; s.rotation = 0; s.scale.set(1);
    this.used++;
    return s;
  }

  private give(s: Sprite): void {
    const layer = (s.parent?.label?.replace('enraged-', '') ?? 'air') as LayerId;
    s.visible = false;
    this.freeSprites[layer].push(s);
    this.used--;
  }

  private fxs(layer: LayerId, t: Texture, tint: number, x: number, y: number, o: Partial<Omit<Fx, 's' | 'age'>> & { dur: number; from: number; to: number; a0: number }): Sprite | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.2, sy: 1, spin: 0, delay: 0, grow: 0, len: 0, width: 0, ...o };
    s.position.set(x, y);
    if (f.mode === 'rip') { s.anchor.set(0, 0.5); s.scale.set(0.001, f.width); } else s.scale.set(f.from, f.from * f.sy);
    s.alpha = f.mode === 'punch' || f.delay > 0 ? 0 : f.a0;
    this.fx.push(f);
    return s;
  }

  private particle(layer: LayerId, t: Texture, tint: number, o: Omit<Particle, 's' | 'max' | 'pull' | 'streak' | 'twinkle' | 'spin'> & Partial<Pick<Particle, 'pull' | 'streak' | 'twinkle' | 'spin'>>): void {
    const s = this.take(layer, t, tint);
    if (!s) return;
    s.position.set(o.x, o.y);
    s.rotation = this.rnd() * Math.PI * 2;
    this.particles.push({ pull: 0, streak: 0, twinkle: 0, spin: 0, ...o, s, max: o.life });
  }

  /** A burst of sparks (chunky, streaked along their flight, with gravity) from a point, mostly along `dir`. */
  private sparks(x: number, y: number, n: number, dir: Pt, o: { speed?: number; spread?: number; back?: number; size?: number; life?: number; grav?: number } = {}): void {
    const S = this.scale;
    const base = Math.atan2(dir.y, dir.x);
    const tints = [this.colors.core, this.colors.hot, this.colors.hot, this.glowC];
    for (let i = 0; i < n; i++) {
      const wide = this.rnd() < (o.back ?? 0.3);
      const a = wide ? this.rnd() * Math.PI * 2 : base + (this.rnd() - 0.5) * (o.spread ?? 1.5);
      const sp = (o.speed ?? 900) * this.look.sparkSpeed * (0.4 + this.rnd() * 0.8) * S;
      const sz = (o.size ?? 0.8) * (0.55 + this.rnd() * 0.7) * S;
      this.particle('air', this.tex.spark, tints[i % tints.length]!, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120 * S, drag: 0.06, grav: (o.grav ?? 1500) * S,
        life: (o.life ?? 560) * (0.6 + this.rnd() * 0.7), from: sz, to: sz * 0.35, alpha: 1, streak: 0.022,
      });
    }
  }

  /** Embers: small, slow, flickering, drifting, long-lived. */
  private embers(x: number, y: number, n: number, spreadR: number, o: { speed?: number; lift?: number; grav?: number; life?: number } = {}): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = spreadR * Math.sqrt(this.rnd());
      const sp = (o.speed ?? 260) * (0.3 + this.rnd() * 0.9) * S;
      const sz = (0.22 + this.rnd() * 0.3) * S;
      this.particle('air', this.tex.spark, this.rnd() < 0.55 ? this.colors.hot : this.glowC, {
        x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.lift ?? 160) * S,
        drag: 0.25, grav: (o.grav ?? 240) * S, life: (o.life ?? 1000) * this.look.emberLife * (0.6 + this.rnd() * 0.7),
        from: sz, to: sz * 0.3, alpha: 1, twinkle: 0.03 + this.rnd() * 0.03,
      });
    }
  }

  private smoke(x: number, y: number, n: number, r: number, o: { rise?: number; size?: number; life?: number; alpha?: number } = {}): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const sz = ((o.size ?? 1) * r * (0.9 + this.rnd() * 0.6)) / 96;
      this.particle('shade', this.tex.smoke, this.colors.smoke, {
        x: x + Math.cos(a) * r * 0.4, y: y + Math.sin(a) * r * 0.4, vx: Math.cos(a) * 40 * S, vy: Math.sin(a) * 30 * S - (o.rise ?? 50) * S,
        drag: 0.4, grav: -20 * S, life: (o.life ?? 1000) * (0.7 + this.rnd() * 0.5), from: sz * 0.6, to: sz * 1.5, alpha: o.alpha ?? 0.5,
        spin: (this.rnd() - 0.5) * 0.002,
      });
    }
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The rage ignites: the aura (flames round the rim, a rim glow, a heat ring, a fireball behind it for the meteor)
   * rides the hero from now on, sized by its heat; `dust` motes are sucked in over `windupMs`.
   */
  startWindup(aura: number, dust: number, windupMs: number): void {
    if (this.destroyed || this.aura || !(aura > 0)) return;
    const L = this.look;
    const n = Math.max(0, Math.min(32, Math.round(L.flames)));
    const flames: Flame[] = [];
    for (let i = 0; i < n; i++) {
      const body = this.take('body', this.tex.flame, this.deep);
      const core = this.take('core', this.tex.flame, this.colors.hot);
      if (!body || !core) { if (body) this.give(body); if (core) this.give(core); break; }
      body.anchor.set(0.5, 0.85); core.anchor.set(0.5, 0.85);
      body.alpha = 0; core.alpha = 0;
      flames.push({ body, core, ang: (i / n) * Math.PI * 2 + this.rnd() * 0.2, phase: this.rnd() * Math.PI * 2, len: 0.75 + this.rnd() * 0.5 });
    }
    const rim = this.take('glow', this.tex.glow, this.glowC);
    const ring = this.take('glow', this.tex.ring, this.colors.hot);
    const ball = this.take('glow', this.tex.glow, this.colors.hot);
    if (!rim || !ring || !ball) { for (const f of flames) { this.give(f.body); this.give(f.core); } if (rim) this.give(rim); if (ring) this.give(ring); if (ball) this.give(ball); return; }
    rim.alpha = 0; ring.alpha = 0; ball.alpha = 0;
    this.aura = { flames, rim, ring, ball, heat: 0, age: 0, emberAcc: 0, dustLeft: windupMs, dustAcc: 0, dustRate: dust > 0 ? windupMs / dust : 0 };
    this.auraMul = aura;
  }

  private auraMul = 1;

  /** The meteor's rise: the aura swells into a fireball (bigger flames, a hot ball of light behind the portrait). */
  private fireball = 0;
  rise(): void { this.fireball = 1; }

  /** A drive leaves: speed lines along the line of the dash, a push-off puff of dust behind the hero. */
  drive(from: Pt, u: Pt, dist: number, lines: number, meteor: boolean): void {
    if (this.destroyed) return;
    const S = this.scale;
    const R = this.radius;
    const ang = Math.atan2(u.y, u.x);
    for (let i = 0; i < lines; i++) {
      const along = this.rnd() * dist * 0.9;
      const off = (this.rnd() - 0.5) * R * (meteor ? 3.2 : 2.4);
      const x = from.x + u.x * along - u.y * off, y = from.y + u.y * along + u.x * off;
      const sp = (1300 + this.rnd() * 900) * S;
      const s = this.take('air', this.tex.streak, this.rnd() < 0.5 ? this.colors.core : this.colors.hot);
      if (!s) break;
      s.position.set(x, y);
      this.particles.push({
        s, x, y, vx: -u.x * sp, vy: -u.y * sp, drag: 0.02, grav: 0, life: 190 + this.rnd() * 120, max: 0, from: 0, to: 0,
        alpha: 0.8, twinkle: 0, spin: 0, streak: 0.012 + this.rnd() * 0.01, pull: 0,
      });
      this.particles[this.particles.length - 1]!.max = this.particles[this.particles.length - 1]!.life;
      s.rotation = ang;
    }
    this.smoke(from.x - u.x * R * 0.6, from.y - u.y * R * 0.6, meteor ? 4 : 2, R * 0.8, { rise: 30, size: 0.9, life: 600, alpha: 0.35 });
    this.fxs('glow', this.tex.ring, this.colors.hot, from.x, from.y, { dur: 240, from: (R * 0.9) / RING_R, to: (R * 1.8) / RING_R, a0: 0.55, sy: 0.6 });
    const last = this.fx[this.fx.length - 1];
    if (last) last.s.rotation = ang + Math.PI / 2;
  }

  /** A strike before the last lands: line work only (one claw set of three rips, a ring, a small hot flash, sparks). */
  tick(x: number, y: number, u: Pt, R: number, i: number, k: number): void {
    if (this.destroyed) return;
    this.fxs('core', this.tex.glow, this.colors.core, x, y, { dur: 110, from: (R * 1.3) / GLOW_PX * 2, to: (R * 1.7) / GLOW_PX * 2, a0: 0.8 });
    this.fxs('glow', this.tex.glow, this.glowC, x, y, { dur: 200, from: (R * 1.8) / GLOW_PX * 2, to: (R * 2.4) / GLOW_PX * 2, a0: 0.55 });
    this.fxs('glow', this.tex.ring, this.colors.hot, x, y, { dur: 320, from: (R * 0.5) / RING_R, to: (R * (1.9 + 0.2 * k) * this.look.ringSize) / RING_R, a0: 0.9 });
    // One claw set, raked across the blow, alternating which way it leans.
    const ang = Math.atan2(u.y, u.x) + Math.PI / 2 + (i % 2 ? -0.55 : 0.55);
    this.claw(x, y, ang, R * 2.1, 3, 0.85, 420);
    this.sparks(x, y, 14 + 4 * i, u, { speed: 800, size: 0.7 });
    this.embers(x, y, 6, R * 0.5, { speed: 220 });
  }

  /** A claw set: `n` parallel rips across (x, y) at `ang`, each drawn out from one end fast, then lingering. */
  private claw(x: number, y: number, ang: number, len: number, n: number, width: number, dur: number): void {
    const L = this.look;
    const S = this.scale;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const gap = len * 0.16;
    const w = width * L.slashWidth * S;
    const l = len * L.slashLength;
    for (let j = 0; j < n; j++) {
      const off = (j - (n - 1) / 2) * gap;
      const cx = x - sa * off, cy = y + ca * off;
      const lj = l * (j === (n - 1) / 2 ? 1 : 0.86);
      const sx = cx - ca * lj / 2, sy = cy - sa * lj / 2;
      const delay = j * 18;
      const make = (layer: LayerId, tint: number, wmul: number, a0: number): void => {
        const s = this.fxs(layer, this.tex.slash, tint, sx, sy, { dur, from: 0, to: 0, a0, mode: 'rip', grow: 70, len: lj / SLASH_PX, width: w * wmul, delay });
        if (s) s.rotation = ang;
      };
      make('glow', this.glowC, 2.4, 0.7);
      make('body', this.deep, 1.3, 0.95);
      make('core', this.colors.core, 0.7, 1);
    }
  }

  /**
   * THE IMPACT (the consequence frame). Starts at its brightest: the white-hot flash, the hot core and a bloom that are
   * gone within ~220 ms; then the shockwave ring and a second ring, the claw rips (`slashes` torn radially across the
   * portrait), chunky sparks thrown along the blow, embers, smoke; the foe smoulders after. The meteor adds a
   * screen-filling flash, the crater, rock debris and an ember explosion.
   */
  impact(x: number, y: number, u: Pt, R: number, o: { k: number; burst: number; sparks: number; embers: number; slashes: number; flashAlpha: number; meteor: boolean; smoulderMs: number; screen: number }): void {
    if (this.destroyed) return;
    const L = this.look;
    const b = o.burst;
    const px = (r: number): number => (r / GLOW_PX) * 2;
    // Fills: short.
    this.fxs('core', this.tex.glow, this.colors.core, x, y, { dur: 150, from: px(R * 1.5 * b), to: px(R * 2.3 * b), a0: o.flashAlpha });
    this.fxs('core', this.tex.glow, this.colors.hot, x, y, { dur: 220, from: px(R * 1.1 * b), to: px(R * 1.6 * b), a0: 0.9 });
    this.fxs('glow', this.tex.glow, this.glowC, x, y, { dur: 300, from: px(R * 2.2 * b), to: px(R * 3.4 * b), a0: 0.85 });
    if (o.meteor) this.fxs('core', this.tex.glow, whiten(this.colors.hot, 0.5), x, y, { dur: 170, from: px(o.screen * 0.9), to: px(o.screen * 1.2), a0: 0.75 * o.flashAlpha });
    // Line work: lingers.
    const ang = Math.atan2(u.y, u.x);
    this.fxs('glow', this.tex.ring, this.colors.hot, x, y, { dur: 420, from: (R * 0.5) / RING_R, to: (R * (2.6 + 0.4 * o.k) * L.ringSize * b) / RING_R, a0: 0.95 });
    this.fxs('glow', this.tex.ring, this.glowC, x, y, { dur: 600, delay: 70, from: (R * 0.4) / RING_R, to: (R * (3.6 + 0.6 * o.k) * L.ring2Size * b) / RING_R, a0: 0.6 });
    const bow = this.fxs('glow', this.tex.ring, this.colors.core, x, y, { dur: 360, from: (R * 0.6) / RING_R, to: (R * 2.9 * b) / RING_R, a0: 0.7, sy: 0.42 });
    if (bow) bow.rotation = ang + Math.PI / 2;
    if (o.meteor) this.fxs('glow', this.tex.ring, this.colors.hot, x, y, { dur: 820, delay: 140, from: (R * 0.8) / RING_R, to: (R * 5.4 * L.ring2Size) / RING_R, a0: 0.5 });
    // The claw rips: `slashes` long rips through the centre, fanned across the blow (a raking star), plus a claw set.
    const m = Math.max(0, o.slashes);
    for (let i = 0; i < m; i++) {
      const a = ang + Math.PI / 2 + ((i - (m - 1) / 2) / Math.max(1, m)) * 2.2 + (this.rnd() - 0.5) * 0.15;
      this.claw(x, y, a, R * (2.5 + 0.3 * o.k), 1, 1.2 + 0.2 * o.k, 620 + 120 * o.k);
    }
    if (m > 0) this.claw(x, y, ang + Math.PI / 2 + 0.5, R * 2.2, 3, 0.9, 560);
    // Sparks and embers: thrown along the blow, falling.
    this.sparks(x, y, Math.round(o.sparks * b), u, { speed: 1000 + 200 * o.k, size: 0.95 + 0.2 * o.k, life: 620, back: 0.35 });
    this.embers(x, y, o.embers, R * 0.7, { speed: 360 + 120 * o.k, lift: 240, life: 1200 });
    this.smoke(x, y, o.meteor ? 8 : 3, R * (o.meteor ? 1.4 : 1), { rise: 60, size: o.meteor ? 1.4 : 1, life: o.meteor ? 1500 : 1000, alpha: 0.45 });
    if (o.meteor) {
      const S = this.scale;
      // The crater round the struck portrait (its centre is clear: the portrait sits IN it) and its glowing cracks.
      this.fxs('shade', this.tex.scorch, this.colors.smoke, x, y, { dur: 2100, from: (R * 3.4 * L.craterSize) / SCORCH_PX * 2 * 0.85, to: (R * 3.4 * L.craterSize) / SCORCH_PX * 2, a0: 0.85, mode: 'hold' });
      const cr = this.fxs('under', this.tex.cracks, this.colors.hot, x, y, { dur: 1500, from: (R * 3.2 * L.craterSize) / CRACK_PX * 2 * 0.7, to: (R * 3.2 * L.craterSize) / CRACK_PX * 2, a0: 1, mode: 'hold' });
      if (cr) cr.rotation = this.rnd() * Math.PI * 2;
      const cr2 = this.fxs('under', this.tex.cracks, this.glowC, x, y, { dur: 1100, from: (R * 3.4 * L.craterSize) / CRACK_PX * 2 * 0.75, to: (R * 3.4 * L.craterSize) / CRACK_PX * 2, a0: 0.7, mode: 'hold' });
      if (cr2) cr2.rotation = this.rnd() * Math.PI * 2;
      // Rock debris (solid: normal blend), flung up and out, falling with spin.
      const nd = Math.max(0, Math.round(L.debris));
      for (let i = 0; i < nd; i++) {
        const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.8;
        const sp = (500 + this.rnd() * 900) * S;
        const sz = (0.5 + this.rnd() * 0.8) * S;
        this.particle('shade', this.tex.rock, mixColor(this.colors.smoke, this.colors.shade, 0.35), {
          x: x + (this.rnd() - 0.5) * R, y: y + (this.rnd() - 0.5) * R * 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.35, grav: 2000 * S,
          life: 750 + this.rnd() * 500, from: sz, to: sz * 0.8, alpha: 1, spin: (this.rnd() - 0.5) * 0.03,
        });
      }
      this.sparks(x, y, Math.round(o.sparks * 0.6), { x: 0, y: -1 }, { speed: 1300, spread: 2.6, size: 1.1, life: 800, back: 0.5 });
      this.embers(x, y, Math.round(o.embers * 0.8), R * 1.2, { speed: 620, lift: 380, life: 1600 });
    }
    // The foe smoulders.
    if (o.smoulderMs > 0) this.smoulders.push({ x, y, r: R, left: o.smoulderMs, acc: 0, smokeAcc: 0 });
  }

  /** A meteor aftershock: debris landing round the crater (a small ring, a puff, a few sparks). */
  boom(x: number, y: number, size: number): void {
    if (this.destroyed) return;
    const R = this.radius;
    this.fxs('glow', this.tex.ring, this.colors.hot, x, y, { dur: 300, from: (R * 0.3) / RING_R, to: (R * 1.2 * size) / RING_R, a0: 0.6, sy: 0.55 });
    this.fxs('core', this.tex.glow, this.colors.hot, x, y, { dur: 140, from: (R * 0.6 * size) / GLOW_PX * 2, to: (R * 0.9 * size) / GLOW_PX * 2, a0: 0.7 });
    this.smoke(x, y, 2, R * 0.6, { rise: 40, size: 0.8, life: 700, alpha: 0.35 });
    this.sparks(x, y, 8, { x: 0, y: -1 }, { speed: 600, spread: 2.4, size: 0.6, life: 420 });
  }

  /** The hero springs home: from now on it trails embers and steam as it moves. */
  recover(): void { this.recovering = true; }

  /**
   * Follow the hero to sequence time `t` (called from the clock's paint, so a hit-stop freezes it): the aura rides the
   * portrait at its current heat, the dust is pulled in, the afterimages and the wake are resampled from its motion.
   */
  follow(t: number): void {
    if (this.destroyed || !this.path) return;
    const dt = Number.isFinite(this.lastT) ? Math.max(0, Math.min(100, t - this.lastT)) : 0;
    this.lastT = t;
    const h = this.path(t);
    const S = this.scale;
    const R = this.radius * h.s;
    const vx = h.x - this.lastHero.x, vy = h.y - this.lastHero.y;
    const moved = Math.hypot(vx, vy);
    this.lastHero = h;
    // How fast it is going, over the afterimage span (0 = still, 1 = a full dash): the ghosts and the wake follow it.
    const L = this.look;
    const span = Math.max(1, L.ghostStepMs * Math.max(1, L.ghosts));
    const back = this.path(t - span);
    const speed = clamp01(Math.hypot(h.x - back.x, h.y - back.y) / (this.radius * 0.9));
    this.drawGhosts(t, speed);
    this.drawWake(t, speed);
    const a = this.aura;
    if (a) {
      a.heat = h.heat;
      a.age += dt;
      const heat = h.heat * this.auraMul;
      const fb = this.fireball * clamp01(h.heat);
      // Lean: flames stream away from the motion when it is fast, else lick upward (fire rises).
      const lean = clamp01(moved / Math.max(1, dt) / (1.2 * S));
      const lx = moved > 0.01 ? -vx / moved : 0, ly = moved > 0.01 ? -vy / moved : -1;
      const flick = 0.85 + 0.15 * Math.sin(a.age * 0.061) + 0.08 * Math.sin(a.age * 0.137);
      a.rim.position.set(h.x, h.y); a.rim.scale.set(((R * (1.35 + 0.35 * fb)) / GLOW_PX) * 2 * L.auraSize); a.rim.alpha = 0.6 * heat * flick;
      a.ring.position.set(h.x, h.y); a.ring.scale.set((R * 1.02) / RING_R); a.ring.alpha = 0.55 * heat * (0.8 + 0.2 * Math.sin(a.age * 0.05));
      a.ball.position.set(h.x, h.y); a.ball.scale.set(((R * 1.9) / GLOW_PX) * 2 * L.auraSize); a.ball.alpha = 0.55 * fb;
      for (const f of a.flames) {
        const ang = f.ang + a.age * 0.0006;
        // Point outward, bent toward up (or away from the motion), the ones underneath shorter.
        let dx = Math.cos(ang), dy = Math.sin(ang);
        const bend = 0.35 + 0.55 * lean;
        const tx = lean > 0.05 ? lx : 0, ty = lean > 0.05 ? ly : -1;
        dx = dx * (1 - bend) + tx * bend; dy = dy * (1 - bend) + ty * bend;
        const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        const under = 0.55 + 0.45 * clamp01(0.5 - 0.5 * Math.sin(ang));
        const wob = 0.7 + 0.22 * Math.sin(f.phase + a.age * 0.021) + 0.15 * Math.sin(f.phase * 2.3 + a.age * 0.049);
        const len = R * 0.62 * L.flameLength * f.len * under * wob * heat * (1 + 0.6 * fb + 0.5 * lean);
        const wid = R * 0.42 * (0.8 + 0.2 * heat);
        const bx = h.x + Math.cos(ang) * R * 0.82, by = h.y + Math.sin(ang) * R * 0.82;
        const rot = Math.atan2(dy, dx) + Math.PI / 2;
        f.body.position.set(bx, by); f.body.rotation = rot; f.body.scale.set(wid / 48, Math.max(0.001, len / 112)); f.body.alpha = 0.9 * clamp01(heat * 1.4);
        f.core.position.set(bx, by); f.core.rotation = rot; f.core.scale.set((wid * 0.55) / 48, Math.max(0.001, (len * 0.7) / 112)); f.core.alpha = clamp01(heat * 1.2) * flick;
      }
      // Embers shed off the aura, rising.
      a.emberAcc += dt * heat * (1 + fb);
      while (a.emberAcc > 34) {
        a.emberAcc -= 34;
        const ea = this.rnd() * Math.PI * 2;
        this.particle('air', this.tex.spark, this.rnd() < 0.5 ? this.colors.hot : this.glowC, {
          x: h.x + Math.cos(ea) * R * 0.9, y: h.y + Math.sin(ea) * R * 0.9, vx: (this.rnd() - 0.5) * 80 * S, vy: -(120 + this.rnd() * 160) * S,
          drag: 0.3, grav: -40 * S, life: 500 + this.rnd() * 500, from: (0.22 + this.rnd() * 0.2) * S, to: 0.05 * S, alpha: 1, twinkle: 0.04,
        });
      }
      // The windup's dust, sucked in from round the hero.
      if (a.dustLeft > 0 && a.dustRate > 0) {
        a.dustLeft -= dt;
        a.dustAcc += dt;
        while (a.dustAcc > a.dustRate) {
          a.dustAcc -= a.dustRate;
          const da = this.rnd() * Math.PI * 2, dr = this.radius * (2.4 + this.rnd() * 1.4);
          const hot = this.rnd() < 0.35;
          this.particle(hot ? 'air' : 'shade', hot ? this.tex.spark : this.tex.smoke, hot ? this.colors.hot : this.colors.smoke, {
            x: h.x + Math.cos(da) * dr, y: h.y + Math.sin(da) * dr * 0.8, vx: -Math.sin(da) * 60 * S, vy: Math.cos(da) * 60 * S,
            drag: 1, grav: 0, life: 520 + this.rnd() * 200, from: hot ? 0.35 * S : (this.radius * 0.35) / 96, to: hot ? 0.1 * S : (this.radius * 0.15) / 96,
            alpha: hot ? 1 : 0.45, pull: 5.5,
          });
        }
      }
    }
    // Recovering: steam and embers stream off the hero as it springs home.
    if (this.recovering && h.heat > 0.02) {
      this.trailAcc += moved;
      while (this.trailAcc > 16 * S) {
        this.trailAcc -= 16 * S;
        this.smoke(h.x, h.y, 1, R * 0.6, { rise: 70, size: 0.55, life: 650, alpha: 0.3 * h.heat });
        this.embers(h.x, h.y, 1, R * 0.5, { speed: 120, lift: 120, life: 700 });
      }
    }
  }

  /** The afterimages: the portrait sampled back in time, fading and reddening with age, only while it moves fast. */
  private drawGhosts(t: number, speed: number): void {
    const L = this.look;
    const n = Math.max(0, Math.min(MAX_GHOSTS, Math.round(L.ghosts)));
    while (this.ghosts.length < n) {
      const s = this.take('ghost', this.ghostTex, whiten(this.colors.side, 0.2));
      if (!s) break;
      s.alpha = 0;
      this.ghosts.push(s);
    }
    if (!this.path) return;
    for (let j = 0; j < this.ghosts.length; j++) {
      const g = this.ghosts[j]!;
      if (j >= n || speed < 0.02) { g.alpha = 0; continue; }
      const p = this.path(t - (j + 1) * L.ghostStepMs);
      const f = j / Math.max(1, n);
      g.texture = this.ghostTex;
      g.position.set(p.x, p.y);
      g.scale.set(((this.radius * 2 * p.s) / GHOST_PX) * (1 + 0.05 * j));
      g.tint = mixColor(whiten(this.colors.side, 0.35), this.colors.side, f);
      g.alpha = L.ghostAlpha * speed * Math.pow(1 - f, 1.3);
    }
  }

  /** The wake: three strips on the hero's centreline, sampled back in time (Arcana's trail), only while it moves. */
  private drawWake(t: number, speed: number): void {
    const L = this.look;
    if (!this.path || L.wakeWidth <= 0) return;
    if (!this.wake) {
      if (speed < 0.05) return;
      const mk = (layer: LayerId, texture: Texture, tint: number): MeshSimple => {
        const mesh = new MeshSimple({ texture, vertices: new Float32Array(WAKE_POINTS * 4), uvs: this.uvs, indices: this.idx });
        mesh.blendMode = BLEND[layer]; mesh.tint = tint; mesh.alpha = 0;
        this.layers[layer].addChildAt(mesh, 0);
        return mesh;
      };
      this.wake = { glow: mk('glow', this.tex.ribbonSoft, this.glowC), body: mk('body', this.tex.ribbonBody, this.deep), core: mk('core', this.tex.ribbonBody, this.colors.hot) };
    }
    const N = WAKE_POINTS;
    const { px, py, nx, ny, hw } = this;
    const step = L.wakeMs / (N - 1);
    for (let j = 0; j < N; j++) { const p = this.path(t - j * step); px[j] = p.x; py[j] = p.y; }
    let lx = 0, ly = 1;
    for (let j = 0; j < N; j++) {
      const a = Math.max(0, j - 1), b = Math.min(N - 1, j + 1);
      const tx = px[a]! - px[b]!, ty = py[a]! - py[b]!;
      const l = Math.hypot(tx, ty);
      if (l > 0.01) { lx = -ty / l; ly = tx / l; }
      nx[j] = lx; ny[j] = ly;
    }
    const head = this.path(t);
    for (let j = 0; j < N; j++) {
      const f = j / (N - 1);
      hw[j] = this.radius * head.s * 0.9 * L.wakeWidth * Math.pow(1 - f, 0.7);
    }
    const a = clamp01(speed * 1.3);
    this.writeStrip(this.wake.glow, 1.5, 0.7 * a, 0);
    this.writeStrip(this.wake.body, 0.8, 0.85 * a, 0);
    this.writeStrip(this.wake.core, 0.4, a, 0.8);
  }

  private writeStrip(mesh: MeshSimple, mult: number, alpha: number, sharpen: number): void {
    const { px, py, nx, ny, hw } = this;
    const v = mesh.vertices as Float32Array;
    for (let j = 0; j < WAKE_POINTS; j++) {
      const h = hw[j]! * mult * (sharpen ? Math.pow(1 - j / (WAKE_POINTS - 1), sharpen) : 1);
      v[j * 4] = px[j]! + nx[j]! * h; v[j * 4 + 1] = py[j]! + ny[j]! * h;
      v[j * 4 + 2] = px[j]! - nx[j]! * h; v[j * 4 + 3] = py[j]! - ny[j]! * h;
    }
    mesh.alpha = Math.max(0, alpha);
  }

  /** Advance everything by `dt` ms. Returns whether anything still draws. */
  update(dt: number): boolean {
    if (this.destroyed) return false;
    const S = this.scale;
    const sec = dt / 1000;

    if (this.warm.length) {
      this.warmLeft -= Math.max(dt, 16);
      if (this.warmLeft <= 0) { for (const s of this.warm) this.give(s); this.warm = []; }
    }

    // The aura dies once the rage has cooled (after the hero is home, or if the clock stopped following it).
    const a = this.aura;
    if (a && a.heat <= 0.01 && a.age > 200) {
      for (const f of a.flames) { this.give(f.body); this.give(f.core); }
      this.give(a.rim); this.give(a.ring); this.give(a.ball);
      this.aura = null;
    }
    if (!this.aura && this.ghosts.length && this.lastHero.heat <= 0.01) {
      for (const g of this.ghosts) this.give(g);
      this.ghosts = [];
    }
    if (this.wake && this.lastHero.heat <= 0.01) this.dropWake();

    for (let i = this.smoulders.length - 1; i >= 0; i--) {
      const m = this.smoulders[i]!;
      m.left -= dt;
      if (m.left <= 0) { this.smoulders.splice(i, 1); continue; }
      m.acc += dt; m.smokeAcc += dt;
      while (m.acc > 55) { m.acc -= 55; this.embers(m.x, m.y + m.r * 0.2, 1, m.r * 0.8, { speed: 60, lift: 140, grav: -30, life: 900 }); }
      while (m.smokeAcc > 220) { m.smokeAcc -= 220; this.smoke(m.x + (this.rnd() - 0.5) * m.r, m.y, 1, m.r * 0.5, { rise: 70, size: 0.7, life: 1100, alpha: 0.28 }); }
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= dt; if (q.delay > 0) continue; }
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      if (q.mode === 'rip') {
        const g = easeOutCubic(clamp01(q.age / Math.max(1, q.grow)));
        q.s.scale.set(Math.max(0.001, q.len * g), (q.width / 40) * (1 - 0.35 * u));
        q.s.alpha = q.a0 * (u < 0.45 ? 1 : 1 - (u - 0.45) / 0.55);
      } else {
        const sc = q.from + (q.to - q.from) * easeOutQuint(u);
        q.s.scale.set(sc, sc * q.sy);
        if (q.spin) q.s.rotation += q.spin * dt;
        q.s.alpha = q.mode === 'punch'
          ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
          : q.mode === 'hold' ? q.a0 * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4)
            : q.a0 * (1 - u) * (1 - u * 0.3);
      }
      if (u >= 1) { this.give(q.s); this.fx.splice(i, 1); }
    }

    const h = this.lastHero;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) { this.give(p.s); this.particles.splice(i, 1); continue; }
      if (p.pull > 0) {
        // Sucked into the hero: accelerate toward its current centre; gone once it reaches the rim.
        const dx = h.x - p.x, dy = h.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < this.radius * 0.8) { this.give(p.s); this.particles.splice(i, 1); continue; }
        const acc = p.pull * p.pull * 120 * S;
        p.vx += (dx / d) * acc * sec; p.vy += (dy / d) * acc * sec;
      }
      const damp = Math.pow(p.drag, sec);
      p.vx *= damp; p.vy = p.vy * damp + p.grav * sec;
      p.x += p.vx * sec; p.y += p.vy * sec;
      const t = 1 - p.life / p.max;
      p.s.position.set(p.x, p.y);
      if (p.streak > 0) {
        // Stretched along its flight: a chunky spark reads as a hot streak, a speed line as a line.
        const v = Math.hypot(p.vx, p.vy);
        p.s.rotation = Math.atan2(p.vy, p.vx);
        if (p.from > 0) { const sc = p.from + (p.to - p.from) * t; p.s.scale.set(sc * (1 + v * p.streak * 0.02 / S), sc); } else p.s.scale.set(Math.max(0.2, v * p.streak * 0.05 / S), 0.35 * S);
      } else {
        p.s.scale.set(p.from + (p.to - p.from) * t);
        if (p.spin) p.s.rotation += p.spin * dt;
      }
      const tw = p.twinkle ? 0.55 + 0.45 * Math.sin((p.max - p.life) * p.twinkle * 6) : 1;
      p.s.alpha = p.alpha * (1 - t * t) * tw;
    }

    return this.used > this.warm.length || this.aura !== null || this.smoulders.length > 0 || this.wake !== null;
  }

  private dropWake(): void {
    if (!this.wake) return;
    for (const m of [this.wake.glow, this.wake.body, this.wake.core]) { m.parent?.removeChild(m); m.destroy(); }
    this.wake = null;
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  clear(): void {
    for (const q of this.fx) this.give(q.s);
    for (const p of this.particles) this.give(p.s);
    if (this.aura) { for (const f of this.aura.flames) { this.give(f.body); this.give(f.core); } this.give(this.aura.rim); this.give(this.aura.ring); this.give(this.aura.ball); }
    for (const g of this.ghosts) this.give(g);
    for (const s of this.warm) this.give(s);
    this.dropWake();
    this.fx = []; this.particles = []; this.aura = null; this.ghosts = []; this.smoulders = []; this.warm = [];
  }

  /** Tear down: every sprite and mesh destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.path = null;
    for (const [id] of LAYERS) {
      this.freeSprites[id].length = 0;
      this.layers[id].removeChildren().forEach((c) => c.destroy());
    }
    this.root.removeChildren().forEach((c) => c.destroy());
    this.root.destroy();
  }
}
