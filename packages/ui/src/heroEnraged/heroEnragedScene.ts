/**
 * THE ENRAGED STRIKE SCENE: everything the Enraged Strike draws in Pixi, as a plain scene graph with no renderer, so it
 * runs (and is tested) headless. `heroEnraged.ts` mounts `root` on the above-portrait overlay, calls `follow(t)` from
 * the sequence clock's paint (the hero's pose drives the aura, the afterimages and the wake) and feeds `update(dt)`.
 *
 * Design rule (owner review 2026-09-28: "enraged needs way more polish ... cleaning it up"; the bar is Arcana): the HERO
 * PORTRAIT's own lunge is the star (it is DOM, Classic's swing, amplified). Every beat here has ONE lead element and a
 * few quiet supports, all line work and tapered strokes with white-hot cores, never particle soup:
 *  - WINDUP: the RAGE AURA. A crisp hot ring hugging the rim and a crown of swaying flame tongues licking UP off the
 *    upper rim (strips: a deep NORMAL-blend body that keeps its colour on a light board, an additive glow, a white-hot
 *    core), charge rings closing in, streak motes pulled inward, rising embers; it peaks in the RAGE BURST.
 *  - LUNGE: CRISP AFTERIMAGES. Copies of the portrait are STAMPED at even spacing along the dash (not sampled by time,
 *    so an ease that hangs then blurs still leaves 2 to 4 evenly spaced ghosts, never a smear) and fade fast; a slim
 *    tapered rage streak (Arcana's three-strip ribbon on the motion sampled back in time); a few speed lines.
 *  - STRIKE: the IMPACT. A short white flash (fills are short), a crisp hot ring and a slower red one (line work
 *    lingers), CLAW RIPS drawn as clean curved tapered strokes with white cores (drawn on in 70 ms, then fading),
 *    chunky sparks thrown along the blow with gravity. The aura drops away on the last contact so the impact reads.
 *  - COMBO: every hit before the last is its own full impact (`tick`), scaled by its power up the combo; a `coil` ring
 *    tightens before each drive back in; each dash leaves a scorch skid.
 *  - HAYMAKER (IV): the `rear` maxes the rage (towering flames, a flare, a dark pressure ring), and the knockout adds a
 *    giant flaming crescent, a screen-filling rage shockwave, molten cracks round the struck portrait, rubble and an
 *    ember storm.
 * No hit-stop anywhere (owner 2026-09-28: "remove the freezeing frame from all of the animations. it looks like lag").
 *
 * LAYERS, bottom to top: shade (normal: scorch, smoke, rock) | ghost (normal: the afterimage portraits) | glow (add) |
 * body (normal) | core (add) | air (add), so the scene batches in a handful of runs. Strip meshes (the streak and the
 * claw strokes) are pooled per layer with fixed 28-vertex buffers (under Pixi's batching limit).
 *
 * Contract: sprites and meshes are POOLED per layer (hidden and reused), bounded by `MAX_ENRAGED_SPRITES` /
 * `MAX_ENRAGED_MESHES`; textures are the caller's; positions are the overlay's px; `setCamera` mirrors the DOM camera;
 * `update` returns whether anything still draws; `destroy()` leaves nothing behind. Scatter is seeded (a replay
 * throws the same sparks).
 */
import { Container, MeshSimple, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeOutCubic, easeOutQuint, mixColor, seededRng, whiten, type Pt } from '../heroAttack/easing';

export interface HeroEnragedTextures extends HeroArcanaTextures {
  smoke: Texture;
  rock: Texture;
  /** The crater's scorch ring (tinted dark; clear in the middle) and its glowing cracks. */
  scorch: Texture;
  cracks: Texture;
  /** The afterimage when there is no portrait art. */
  disc: Texture;
  /** A thin crisp ring (the aura's rim and each afterimage's outline). */
  rim: Texture;
  /** A soft annulus: clear in the middle, glowing just outside the rim (the aura's halo, never over the face). */
  halo: Texture;
  /** Short fissures radiating off a ring at 0.62 of the half-width (the struck portrait's rim). */
  rimCracks: Texture;
}

export interface EnragedColors { core: number; hot: number; side: number; shade: number; smoke: number }

export interface EnragedLook {
  auraSize: number;
  flames: number;
  flameLength: number;
  ghosts: number;
  ghostSpacing: number;
  ghostAlpha: number;
  ghostFadeMs: number;
  wakeWidth: number;
  wakeMs: number;
  ringSize: number;
  ring2Size: number;
  slashLength: number;
  slashWidth: number;
  sparkSpeed: number;
  emberLife: number;
  craterSize: number;
  crescentSize: number;
  shockSize: number;
  debris: number;
  /** The rage burst's size (the flare, the heat rings). */
  burstSize: number;
  /** How much of each impact's spark spray bounces back toward the middle of the screen (0..1). */
  sparkInward: number;
  /** The glowing rage cracks left on the struck portrait's rim. */
  rimCracks: number;
  /** The ground scorch a dash leaves, and how long it lasts. */
  scorch: number;
  scorchMs: number;
  /** Tier IV: embers the haymaker's cracked ground throws up over the next second. */
  emberStorm: number;
}

/** The hero at a moment (screen px): centre, scale and rage. */
export interface HeroAt { x: number; y: number; s: number; heat: number }

/** Hard cap on sprites alive at once (a Tier IV haymaker peaks around 400). */
export const MAX_ENRAGED_SPRITES = 900;
/** Hard cap on strip meshes alive at once (the flames: three each; the streak: three; an X of claws: eighteen). */
export const MAX_ENRAGED_MESHES = 128;
/** Points along every strip: 28 vertices, so every strip still batches. */
export const STRIP_POINTS = 14;
/** Afterimages alive at once, at most. */
export const MAX_GHOSTS = 6;

type LayerId = 'shade' | 'ghost' | 'glow' | 'body' | 'core' | 'air';
const LAYERS: readonly [LayerId, 'normal' | 'add'][] = [
  ['shade', 'normal'], ['ghost', 'normal'], ['glow', 'add'], ['body', 'normal'], ['core', 'add'], ['air', 'add'],
];
const BLEND: Record<LayerId, 'normal' | 'add'> = Object.fromEntries(LAYERS) as Record<LayerId, 'normal' | 'add'>;
/** Texture sizes (px) the sprite scales divide by. */
const GLOW_PX = 128, RING_R = 64, RIM_R = 118, GHOST_PX = 128, SCORCH_PX = 192, SMOKE_PX = 96;

type AlphaMode = 'out' | 'punch' | 'hold';
interface Fx { s: Sprite; age: number; dur: number; from: number; to: number; a0: number; mode: AlphaMode; peakAt: number; sy: number; delay: number }

interface Particle {
  s: Sprite; x: number; y: number; vx: number; vy: number; drag: number; grav: number; life: number; max: number;
  from: number; to: number; alpha: number; twinkle: number; spin: number;
  /** Stretched along its flight (a spark streak, a speed line, a pulled mote): extra length per 1000 px/s (0 = round). */
  streak: number;
  /** Fades out as it nears the hero (a pulled mote). */
  toHero: boolean;
}

interface Strip { mesh: MeshSimple; v: Float32Array; layer: LayerId }

/** A claw stroke: a curved, tapered stroke drawn on from one end, held, then faded (three strips on one spine). */
interface Stroke {
  glow: Strip | null; body: Strip | null; core: Strip | null;
  ax: number; ay: number; bx: number; by: number; bend: number; width: number;
  age: number; delay: number; draw: number; hold: number; fade: number;
}

/** A flame tongue: three strips (glow, body, core) on one swaying spine rooted on the portrait's rim. */
interface Flame { glow: Strip | null; body: Strip | null; core: Strip | null; ang: number; phase: number; len: number; speed: number }
interface Aura { flames: Flame[]; ring: Sprite; halo: Sprite; shade: Sprite; heat: number; age: number; emberAcc: number; moteLeft: number; moteAcc: number; moteRate: number; comet: number }
interface Ghost { art: Sprite; rim: Sprite; age: number; fade: number; a0: number }
interface Wake { glow: Strip; body: Strip; core: Strip }
interface Smoulder { x: number; y: number; r: number; left: number; acc: number; smokeAcc: number; storm: number; stormAcc: number }
/** A dash's ground scorch: a dark burn along the dash with a hot core that cools, growing with the hero until it lands. */
interface Scorch { burn: Strip | null; heat: Strip | null; ax: number; ay: number; bx: number; by: number; w: number; age: number; life: number; open: boolean }

export class HeroEnragedScene {
  readonly root = new Container();
  private readonly layers: Record<LayerId, Container>;
  private readonly freeSprites: Record<LayerId, Sprite[]>;
  private readonly freeMeshes: Record<LayerId, MeshSimple[]>;
  private used = 0;
  private meshes = 0;
  private fx: Fx[] = [];
  private particles: Particle[] = [];
  private strokes: Stroke[] = [];
  private ghosts: Ghost[] = [];
  private aura: Aura | null = null;
  private wake: Wake | null = null;
  private smoulders: Smoulder[] = [];
  private scorches: Scorch[] = [];
  /** The rage burst's flame surge (1 at the burst, decaying): the flames roar out. */
  private surge = 0;
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
  /** Distance travelled since the last afterimage was stamped (only counted while dashing). */
  private ghostAcc = 0;
  private dashing = false;
  private recovering = false;
  private trailAcc = 0;
  // scratch (a strip's spine and its normals, reused by every strip every frame)
  private readonly px = new Float32Array(STRIP_POINTS);
  private readonly py = new Float32Array(STRIP_POINTS);
  private readonly nx = new Float32Array(STRIP_POINTS);
  private readonly ny = new Float32Array(STRIP_POINTS);
  private readonly hw = new Float32Array(STRIP_POINTS);

  constructor(private readonly tex: HeroEnragedTextures, private readonly colors: EnragedColors, private readonly look: EnragedLook, private readonly scale = 1, seed = 1) {
    this.root.eventMode = 'none';
    this.root.label = 'heroEnraged';
    this.layers = {} as Record<LayerId, Container>;
    this.freeSprites = {} as Record<LayerId, Sprite[]>;
    this.freeMeshes = {} as Record<LayerId, MeshSimple[]>;
    for (const [id] of LAYERS) {
      const c = new Container();
      c.label = `enraged-${id}`;
      this.root.addChild(c);
      this.layers[id] = c;
      this.freeSprites[id] = [];
      this.freeMeshes[id] = [];
    }
    this.rnd = seededRng(seed);
    this.ghostTex = tex.disc;
    // Deep: the side colour pushed toward the shade, so a normal-blend body stays saturated on a light board.
    this.deep = mixColor(colors.side, colors.shade, 0.35);
    this.glowC = whiten(colors.side, 0.12);
    const n = STRIP_POINTS;
    this.uvs = new Float32Array(n * 4);
    for (let j = 0; j < n; j++) {
      const u = 1 - j / (n - 1); // the head is u = 1 (full), the tail u = 0 (faded in by the texture)
      this.uvs[j * 4] = u; this.uvs[j * 4 + 1] = 0; this.uvs[j * 4 + 2] = u; this.uvs[j * 4 + 3] = 1;
    }
    this.idx = new Uint32Array((n - 1) * 6);
    for (let j = 0; j < n - 1; j++) { const a = j * 2; this.idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], j * 6); }
    // PRE-WARM: one near-invisible sprite per texture for the first few hundred ms (the damage formation is still
    // playing), so every texture is on the GPU long before the aura or the first claw needs it (no first-play spike).
    const warmTex = [tex.glow, tex.spark, tex.streak, tex.ring, tex.smoke, tex.rock, tex.scorch, tex.cracks, tex.disc, tex.rim, tex.halo, tex.rimCracks, tex.ribbonSoft, tex.ribbonBody];
    for (const t of warmTex) { const s = this.take('air', t, 0xffffff); if (s) { s.alpha = 0.004; s.position.set(-40, -40); s.scale.set(0.05); this.warm.push(s); } }
    this.warmLeft = 400;
  }

  get liveSprites(): number { return this.used; }
  get liveMeshes(): number { return this.meshes; }
  get burning(): boolean { return this.aura !== null; }
  get smouldering(): boolean { return this.smoulders.length > 0; }
  get liveGhosts(): number { return this.ghosts.length; }
  get liveStrokes(): number { return this.strokes.length; }
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

  private strip(layer: LayerId, t: Texture, tint: number): Strip | null {
    if (this.destroyed || this.meshes >= MAX_ENRAGED_MESHES) return null;
    let mesh = this.freeMeshes[layer].pop();
    if (!mesh) {
      mesh = new MeshSimple({ texture: t, vertices: new Float32Array(STRIP_POINTS * 4), uvs: this.uvs, indices: this.idx });
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
    const f: Fx = { s, age: 0, mode: 'out', peakAt: 0.25, sy: 1, delay: 0, ...o };
    s.position.set(x, y);
    s.scale.set(f.from, f.from * f.sy);
    s.alpha = f.mode === 'punch' || f.delay > 0 ? 0 : f.a0;
    this.fx.push(f);
    return s;
  }

  private particle(layer: LayerId, t: Texture, tint: number, o: Omit<Particle, 's' | 'max' | 'twinkle' | 'spin' | 'streak' | 'toHero'> & Partial<Pick<Particle, 'twinkle' | 'spin' | 'streak' | 'toHero'>>): Particle | null {
    const s = this.take(layer, t, tint);
    if (!s) return null;
    s.position.set(o.x, o.y);
    s.rotation = this.rnd() * Math.PI * 2;
    const p: Particle = { twinkle: 0, spin: 0, streak: 0, toHero: false, ...o, s, max: o.life };
    this.particles.push(p);
    return p;
  }

  /** Chunky sparks: hot streaks thrown mostly along `dir` (some sprayed back), falling with gravity. */
  private sparks(x: number, y: number, n: number, dir: Pt, o: { speed?: number; spread?: number; back?: number; size?: number; life?: number } = {}): void {
    const S = this.scale;
    const base = Math.atan2(dir.y, dir.x);
    const tints = [this.colors.core, this.colors.hot, this.colors.hot, this.glowC];
    for (let i = 0; i < n; i++) {
      const wide = this.rnd() < (o.back ?? 0.22);
      const a = wide ? base + Math.PI + (this.rnd() - 0.5) * 2.2 : base + (this.rnd() - 0.5) * (o.spread ?? 1.3);
      const sp = (o.speed ?? 950) * this.look.sparkSpeed * (0.45 + this.rnd() * 0.75) * S;
      const sz = (o.size ?? 0.75) * (0.6 + this.rnd() * 0.6) * S;
      this.particle('air', this.tex.spark, tints[i % tints.length]!, {
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 160 * S, drag: 0.05, grav: 1700 * S,
        life: (o.life ?? 520) * (0.6 + this.rnd() * 0.7), from: sz, to: sz * 0.4, alpha: 1, streak: 1.6,
      });
    }
  }

  /** Embers: small, slow, flickering, drifting down (or up, `lift`). */
  private embers(x: number, y: number, n: number, spreadR: number, o: { speed?: number; lift?: number; grav?: number; life?: number } = {}): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const r = spreadR * Math.sqrt(this.rnd());
      const sp = (o.speed ?? 240) * (0.3 + this.rnd() * 0.9) * S;
      const sz = (0.2 + this.rnd() * 0.22) * S;
      this.particle('air', this.tex.spark, this.rnd() < 0.6 ? this.colors.hot : this.glowC, {
        x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.lift ?? 140) * S,
        drag: 0.2, grav: (o.grav ?? 260) * S, life: (o.life ?? 1000) * this.look.emberLife * (0.6 + this.rnd() * 0.6),
        from: sz, to: sz * 0.3, alpha: 1, twinkle: 0.03 + this.rnd() * 0.03,
      });
    }
  }

  /** A few small dark puffs (contrast under the hot light). */
  private smoke(x: number, y: number, n: number, r: number, o: { rise?: number; size?: number; life?: number; alpha?: number } = {}): void {
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2;
      const sz = ((o.size ?? 1) * r * (0.9 + this.rnd() * 0.5)) / SMOKE_PX;
      this.particle('shade', this.tex.smoke, this.colors.smoke, {
        x: x + Math.cos(a) * r * 0.5, y: y + Math.sin(a) * r * 0.4, vx: Math.cos(a) * 50 * S, vy: Math.sin(a) * 30 * S - (o.rise ?? 50) * S,
        drag: 0.35, grav: -20 * S, life: (o.life ?? 900) * (0.75 + this.rnd() * 0.4), from: sz * 0.7, to: sz * 1.4, alpha: o.alpha ?? 0.4,
        spin: (this.rnd() - 0.5) * 0.0015,
      });
    }
  }

  // ── beats ──────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * The rage ignites: the aura (the hot rim ring, the flame tongues off the top of the portrait, a soft halo) rides the
   * hero from now on, sized by its heat; three charge rings close in over `windupMs`; `motes` streaks are pulled in.
   */
  startWindup(aura: number, motes: number, windupMs: number): void {
    if (this.destroyed || this.aura || !(aura > 0)) return;
    const L = this.look;
    const n = Math.max(0, Math.min(16, Math.round(L.flames)));
    const flames: Flame[] = [];
    for (let i = 0; i < n; i++) {
      // A CROWN of fire: rooted round the UPPER rim (from about 8 o'clock over the top to 4 o'clock), overlapping, the
      // tallest licks rising off the top (fire rises). Never a sunburst of spikes round the whole face.
      const ang = -Math.PI / 2 + ((i + 0.5) / n - 0.5) * Math.PI * 1.35 + (this.rnd() - 0.5) * (Math.PI / n) * 0.6;
      const up = 0.5 - 0.5 * Math.sin(ang); // 1 at the top of the rim, 0 at the bottom
      flames.push({
        glow: this.strip('glow', this.tex.ribbonSoft, this.glowC),
        body: this.strip('body', this.tex.ribbonBody, this.deep),
        core: this.strip('core', this.tex.ribbonBody, this.colors.hot),
        ang, phase: this.rnd() * Math.PI * 2, len: (0.28 + 0.9 * Math.pow(up, 1.3)) * (0.75 + this.rnd() * 0.5), speed: 0.8 + this.rnd() * 0.5,
      });
    }
    const ring = this.take('glow', this.tex.rim, this.colors.hot);
    const halo = this.take('glow', this.tex.halo, this.glowC);
    const shade = this.take('shade', this.tex.halo, this.colors.shade);
    if (!ring || !halo || !shade) {
      for (const f of flames) this.dropFlame(f);
      for (const s of [ring, halo, shade]) if (s) this.give(s);
      return;
    }
    ring.alpha = 0; halo.alpha = 0; shade.alpha = 0;
    this.aura = { flames, ring, halo, shade, heat: 0, age: 0, emberAcc: 0, moteLeft: windupMs * 0.85, moteAcc: 0, moteRate: motes > 0 ? (windupMs * 0.85) / motes : 0, comet: 0 };
    this.auraMul = aura;
    // Three charge rings closing in on the hero through the windup (anticipation: line work, no fill).
    const h = this.lastHero;
    const R = this.radius;
    for (let i = 0; i < 3; i++) {
      this.fxs('glow', this.tex.ring, this.colors.hot, h.x, h.y, {
        dur: 300, delay: windupMs * (0.08 + 0.28 * i), from: (R * 3) / RING_R, to: (R * 1.05) / RING_R, a0: 0.55 + 0.15 * i, mode: 'punch', peakAt: 0.6,
      });
    }
    this.chargeRings = this.fx.slice(-3);
  }

  private auraMul = 1;

  private dropFlame(f: Flame): void { this.giveStrip(f.glow); this.giveStrip(f.body); this.giveStrip(f.core); }

  /**
   * One flame tongue: a spine rooted on the rim, rising along `(dx, dy)` for `len` px, bending more toward its tip and
   * swaying with a wave that travels up it (so it licks, never a rigid petal); wide at the root, a point at the tip.
   */
  private drawFlame(f: Flame, bx: number, by: number, dx: number, dy: number, len: number, wid: number, age: number, heat: number, flick: number): void {
    const N = STRIP_POINTS;
    const { px, py, hw } = this;
    const nx0 = -dy, ny0 = dx;
    const t = age * 0.012 * f.speed;
    for (let j = 0; j < N; j++) {
      const u = j / (N - 1); // 0 = the root (the texture's bright end), 1 = the tip
      const sway = len * 0.22 * Math.pow(u, 1.4) * Math.sin(f.phase + t - u * 3.2);
      px[j] = bx + dx * len * u + nx0 * sway;
      py[j] = by + dy * len * u + ny0 * sway;
      hw[j] = wid * 0.5 * (u < 0.12 ? 0.75 + 0.25 * (u / 0.12) : Math.pow(1 - (u - 0.12) / 0.88, 0.9));
    }
    this.normals();
    const a = clamp01(heat * 1.3);
    this.writeStrip(f.glow, 2.1, 0.45 * a, 0);
    this.writeStrip(f.body, 1, 0.9 * a, 0);
    this.writeStrip(f.core, 0.42, a * flick, 1.1);
  }
  /** The charge rings follow the hero (they close in on it wherever the coil takes it). */
  private chargeRings: Fx[] = [];

  /**
   * A combo hit's COIL (the anticipation before it flies back in): the flames surge a little, a heat ring tightens onto
   * the rim, a few hot streaks are pulled in. Line work only.
   */
  coil(x: number, y: number, R: number, power: number): void {
    if (this.destroyed) return;
    this.surge = Math.max(this.surge, 0.45 + 0.35 * power);
    this.fxs('glow', this.tex.rim, this.colors.hot, x, y, { dur: 200, from: (R * 1.9) / RIM_R, to: (R * 1.05) / RIM_R, a0: 0.5 + 0.3 * power, mode: 'punch', peakAt: 0.6 });
  }

  /**
   * THE HAYMAKER'S REAR-BACK (Tier IV's build): the rage goes to its maximum. The flames tower and stream, the halo blazes,
   * a big flare and three heat rings tear off the rim, and a dark ring of pressure closes in on the hero.
   */
  rear(): void {
    if (this.destroyed) return;
    if (this.aura) this.aura.comet = 1;
    const h = this.lastHero;
    const R = this.radius * h.s;
    this.burst(h.x, h.y, R, 1.5);
    this.fxs('shade', this.tex.rim, mixColor(this.colors.shade, 0x000000, 0.3), h.x, h.y, { dur: 520, from: (R * 3.6) / RIM_R, to: (R * 1.1) / RIM_R, a0: 0.7, mode: 'punch', peakAt: 0.5 });
  }

  /** A dash leaves: afterimages start stamping; a few speed lines rush past along its line. */
  drive(from: Pt, u: Pt, dist: number, lines: number, big: boolean): void {
    if (this.destroyed) return;
    this.dashing = true;
    this.ghostAcc = 0;
    const S = this.scale;
    const R = this.radius;
    // THE GROUND SCORCH: a burn that follows the hero along the dash (it grows in `follow`), then cools and fades.
    if (this.look.scorch > 0) {
      const burn = this.strip('shade', this.tex.ribbonBody, mixColor(this.colors.smoke, 0x000000, 0.35));
      const heat = this.strip('glow', this.tex.ribbonSoft, this.colors.hot);
      if (burn || heat) {
        this.scorches.push({ burn, heat, ax: from.x, ay: from.y, bx: from.x, by: from.y, w: R * 1.1 * this.look.scorch * (big ? 1.4 : 1), age: 0, life: this.look.scorchMs * (big ? 1.4 : 1), open: true });
      }
    }
    for (let i = 0; i < lines; i++) {
      // Near the back half of the dash and close to its line, so they read as the hero's speed, not rain.
      const along = (0.35 + this.rnd() * 0.6) * dist;
      const off = (this.rnd() - 0.5) * R * (big ? 2.6 : 1.8);
      const x = from.x + u.x * along - u.y * off, y = from.y + u.y * along + u.x * off;
      const sp = (1500 + this.rnd() * 900) * S;
      this.particle('air', this.tex.streak, this.rnd() < 0.6 ? this.colors.core : this.colors.hot, {
        x, y, vx: -u.x * sp, vy: -u.y * sp, drag: 0.02, grav: 0, life: 150 + this.rnd() * 90, from: 0.55 * S, to: 0.4 * S,
        alpha: 0.75, streak: 2.2,
      });
    }
  }

  /** The dash has landed: stamp its last stretch into the foe, then stop (the stamped ones fade on their own). */
  land(): void {
    if (this.dashing) this.lastStretch = true;
    this.dashing = false;
    for (const sc of this.scorches) {
      if (!sc.open) continue;
      sc.open = false;
      // Embers kicked up along the burn as the dash lands.
      const n = 6;
      for (let i = 0; i < n; i++) {
        const f = this.rnd();
        this.embers(sc.ax + (sc.bx - sc.ax) * f, sc.ay + (sc.by - sc.ay) * f, 1, sc.w * 0.4, { speed: 120, lift: 160, life: 700 });
      }
    }
  }

  /**
   * THE RAGE BURST (the windup's peak, just before the drive): the portrait flares white-hot, the flames roar out, three
   * heat-shimmer rings tear off the rim and a ring of sparks bursts outward. Line work and a 140 ms flare: no blob.
   */
  burst(x: number, y: number, R: number, size: number): void {
    if (this.destroyed || !(size > 0)) return;
    const S = this.scale;
    const g = (r: number): number => (r / GLOW_PX) * 2;
    this.surge = 1;
    this.fxs('core', this.tex.glow, whiten(this.colors.hot, 0.4), x, y, { dur: 140, from: g(R * 1.2 * size), to: g(R * 1.7 * size), a0: 0.7 });
    this.fxs('glow', this.tex.halo, this.glowC, x, y, { dur: 320, from: g(R * 1.5), to: g(R * 2.4 * size), a0: 0.9 });
    for (let i = 0; i < 3; i++) {
      this.fxs('glow', this.tex.rim, i === 0 ? this.colors.core : this.colors.hot, x, y, {
        dur: 380 + 60 * i, delay: 55 * i, from: (R * 1.02) / RIM_R, to: (R * (2.1 + 0.55 * i) * size) / RIM_R, a0: 0.85 - 0.18 * i,
      });
    }
    const n = Math.round(18 * size);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rnd() * 0.3;
      const sp = (520 + this.rnd() * 380) * S;
      this.particle('air', this.tex.spark, i % 3 ? this.colors.hot : this.colors.core, {
        x: x + Math.cos(a) * R, y: y + Math.sin(a) * R, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.02, grav: 300 * S,
        life: 300 + this.rnd() * 160, from: 0.6 * S, to: 0.25 * S, alpha: 1, streak: 1.8,
      });
    }
  }
  private lastStretch = false;
  private cometAcc = 0;

  /** A strike before the last lands (FX only): a small flash, one crisp ring, one claw set, a spray of sparks. */
  /** Where the claws rake: the struck portrait's centre shifted away from the big `-N` (set by the runner). */
  private clawOff: Pt = { x: 0, y: 0 };
  setClawOffset(off: Pt): void { this.clawOff = off; }

  /**
   * A combo hit before the last (FX only): its OWN full impact, scaled by `power` (0..1 up the combo, so every hit lands
   * harder than the one before): a short flash, a crisp shock rim, a claw set, rim cracks and a spark burst.
   */
  tick(x: number, y: number, u: Pt, R: number, i: number, power: number, into: Pt = u): void {
    if (this.destroyed) return;
    this.land();
    const pw = 0.55 + 0.45 * power;
    this.rimFlare(x, y, R, 0.45 + 0.35 * power, 520);
    const g = (r: number): number => (r / GLOW_PX) * 2;
    this.fxs('core', this.tex.glow, this.colors.core, x, y, { dur: 90, from: g(R * 1.1 * pw), to: g(R * 1.6 * pw), a0: 0.75 });
    this.fxs('glow', this.tex.rim, whiten(this.colors.hot, 0.3), x, y, { dur: 320, from: (R * 0.8) / RIM_R, to: (R * (1.7 + 0.7 * power) * this.look.ringSize) / RIM_R, a0: 0.95 });
    // One claw set raked across the blow, leaning the other way each strike. Short-lived (the next strike is ~0.4 s
    // away), so a combo never stacks into a hatch.
    this.claws(x + this.clawOff.x, y + this.clawOff.y, u, R * (1.8 + 0.5 * power), i % 2 ? -1 : 1, 0.8 + 0.3 * power, 0, 0.55);
    const n = Math.round(10 + 16 * power);
    const inN = Math.round(n * this.look.sparkInward);
    this.sparks(x, y, inN, into, { speed: 800, size: 0.65, spread: 1.6, back: 0 });
    this.sparks(x, y, n - inN, u, { speed: 850, size: 0.65, spread: 1.8, back: 0.2 });
  }

  /**
   * GLOWING RAGE CRACKS on the struck portrait's RIM (never over the face): jagged glowing fissures radiating off the rim
   * and a hot ring hugging it, cooling over `ms`.
   */
  private rimFlare(x: number, y: number, R: number, amt: number, ms: number): void {
    const L = this.look;
    if (!(L.rimCracks > 0)) return;
    // The rim-crack ring sits at 0.62 of the texture's half-width: sized so it lands on the portrait's rim.
    const cs = (R * 0.98) / 0.62 / 128;
    const rot = this.rnd() * Math.PI * 2;
    const dark = this.fxs('shade', this.tex.rimCracks, mixColor(this.colors.shade, 0x000000, 0.4), x, y, { dur: ms * 1.3, from: cs, to: cs * 1.02, a0: Math.min(1, 0.7 * amt * L.rimCracks), mode: 'hold' });
    const hot = this.fxs('glow', this.tex.rimCracks, this.glowC, x, y, { dur: ms, from: cs, to: cs * 1.02, a0: Math.min(1, amt * L.rimCracks), mode: 'hold' });
    const core = this.fxs('core', this.tex.rimCracks, whiten(this.colors.hot, 0.35), x, y, { dur: ms * 0.5, from: cs, to: cs * 1.02, a0: Math.min(1, amt * L.rimCracks), mode: 'hold' });
    for (const s of [dark, hot, core]) if (s) s.rotation = rot;
    this.fxs('glow', this.tex.rim, this.colors.hot, x, y, { dur: ms * 0.8, from: (R * 1.0) / RIM_R, to: (R * 1.06) / RIM_R, a0: Math.min(1, amt * 1.4), mode: 'hold' });
  }

  /**
   * A claw set: three parallel curved strokes raked across (x, y), angled off the blow by `lean` (+1 / -1). Each is drawn
   * on from one end in 70 ms (staggered), held, then faded.
   */
  private claws(x: number, y: number, u: Pt, len: number, lean: number, width: number, delay: number, life = 1): void {
    const L = this.look;
    const ang = Math.atan2(u.y, u.x) + Math.PI / 2 + lean * 0.62;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const l = len * L.slashLength;
    const gap = l * 0.17;
    for (let j = 0; j < 3; j++) {
      const off = (j - 1) * gap;
      const cx = x - sa * off + u.x * off * 0.25, cy = y + ca * off + u.y * off * 0.25;
      const lj = l * (j === 1 ? 1 : 0.84);
      this.stroke(cx - ca * lj / 2, cy - sa * lj / 2, cx + ca * lj / 2, cy + sa * lj / 2, lj * 0.12 * lean, lj * 0.1 * width * L.slashWidth * (j === 1 ? 1 : 0.8), delay + j * 26, life);
    }
  }

  /**
   * THE HAYMAKER'S CRESCENT: one GIANT flaming crescent cleaved down across the struck portrait along the blow (a deep
   * body, a blazing glow, a white-hot core), with a thinner echo either side. Bold line work, drawn on in 60 ms.
   */
  private crescent(x: number, y: number, u: Pt, R: number): void {
    const L = this.look;
    const len = R * 4.4 * L.crescentSize;
    const nx = -u.y, ny = u.x;
    const cx = x + this.clawOff.x * 0.5, cy = y + this.clawOff.y * 0.5;
    const main = (off: number, lenK: number, w: number, delay: number, bendK: number): void => {
      const ox = nx * off, oy = ny * off;
      const l = len * lenK;
      this.stroke(cx + ox - u.x * l / 2, cy + oy - u.y * l / 2, cx + ox + u.x * l / 2, cy + oy + u.y * l / 2, l * bendK, w, delay, 1.5);
    };
    main(0, 1, R * 0.62 * L.crescentSize, 0, 0.22);
    main(R * 0.55, 0.78, R * 0.26 * L.crescentSize, 40, 0.2);
    main(-R * 0.55, 0.78, R * 0.26 * L.crescentSize, 70, 0.2);
  }

  private stroke(ax: number, ay: number, bx: number, by: number, bend: number, width: number, delay: number, life = 1): void {
    const glow = this.strip('glow', this.tex.ribbonSoft, this.glowC);
    const body = this.strip('body', this.tex.ribbonBody, this.deep);
    const core = this.strip('core', this.tex.ribbonBody, this.colors.core);
    if (!glow && !body && !core) return;
    this.strokes.push({ glow, body, core, ax, ay, bx, by, bend, width, age: 0, delay, draw: 60, hold: 220 * life, fade: 300 * life });
  }

  /**
   * THE IMPACT (the consequence frame, no freeze): a short white flash and a hot core that are gone within ~200 ms (fills
   * are short), a crisp hot ring and a slower red one, the claw rips (a big set; III and IV cross a second set over it),
   * chunky sparks thrown along the blow, a few embers and two dark puffs; the foe smoulders after. The haymaker adds a
   * short screen flash, a giant flaming crescent, a screen-filling rage shockwave, molten cracks, rubble and an ember storm.
   */
  impact(x: number, y: number, u: Pt, R: number, o: { k: number; burst: number; sparks: number; embers: number; slashes: number; flashAlpha: number; haymaker: boolean; smoulderMs: number; screen: number; into?: Pt }): void {
    if (this.destroyed) return;
    this.land();
    this.rimFlare(x, y, R, 0.85 + 0.15 * o.k, 900 + 500 * o.k);
    const L = this.look;
    const b = o.burst;
    const g = (r: number): number => (r / GLOW_PX) * 2;
    // Fills: short.
    this.fxs('core', this.tex.glow, this.colors.core, x, y, { dur: 110, from: g(R * 1.3 * b), to: g(R * 2 * b), a0: o.flashAlpha });
    this.fxs('core', this.tex.glow, this.colors.hot, x, y, { dur: 190, from: g(R * 0.9 * b), to: g(R * 1.4 * b), a0: 0.85 });
    this.fxs('glow', this.tex.glow, this.glowC, x, y, { dur: 260, from: g(R * 1.8 * b), to: g(R * 2.8 * b), a0: 0.6 });
    if (o.haymaker) this.fxs('core', this.tex.glow, whiten(this.colors.hot, 0.6), x, y, { dur: 120, from: g(o.screen * 0.8), to: g(o.screen), a0: 0.4 * o.flashAlpha });
    // Line work: lingers.
    // The shockwave: a crisp thin hot rim (never a thick band that washes the frame), a small thick ring for the punch.
    this.fxs('glow', this.tex.rim, whiten(this.colors.hot, 0.3), x, y, { dur: 380, from: (R * 0.8) / RIM_R, to: (R * (2.4 + 0.4 * o.k) * L.ringSize * Math.min(1.3, b)) / RIM_R, a0: 1 });
    this.fxs('glow', this.tex.ring, this.colors.hot, x, y, { dur: 220, from: (R * 0.6) / RING_R, to: (R * 1.5) / RING_R, a0: 0.7 });
    this.fxs('glow', this.tex.rim, this.glowC, x, y, { dur: 560, delay: 60, from: (R * 0.5) / RIM_R, to: (R * (3.2 + 0.6 * o.k) * L.ring2Size * b) / RIM_R, a0: 0.8 });
    if (o.haymaker) {
      // THE KNOCKOUT (Tier IV): a SCREEN-FILLING RAGE SHOCKWAVE (a thin white-hot rim racing out, a dark pressure ring
      // behind it for contrast, a late second rim) and a GIANT FLAMING CRESCENT slashed down across the foe along the blow.
      const shock = (R * 7.5 * L.shockSize) / RIM_R;
      this.fxs('glow', this.tex.rim, whiten(this.colors.hot, 0.5), x, y, { dur: 620, from: (R * 1) / RIM_R, to: shock, a0: 1 });
      this.fxs('shade', this.tex.rim, mixColor(this.colors.shade, 0x000000, 0.2), x, y, { dur: 700, delay: 40, from: (R * 1) / RIM_R, to: shock * 0.92, a0: 0.55 });
      this.fxs('glow', this.tex.rim, this.colors.hot, x, y, { dur: 820, delay: 150, from: (R * 0.8) / RIM_R, to: (R * 5.2 * L.ring2Size) / RIM_R, a0: 0.7 });
      this.crescent(x, y, u, R);
    }
    // The claws: one big set; a second set crossing it (an X) from Tier III; the slashes dial adds more crossing sets.
    const sets = Math.max(0, Math.min(3, Math.round(o.slashes)));
    for (let i = 0; i < sets; i++) this.claws(x + this.clawOff.x, y + this.clawOff.y, u, R * (2.6 + 0.35 * o.k), i % 2 ? -1 : 1, 1.15 + 0.25 * o.k, i * 90);
    // Sparks and embers along the blow; a couple of dark puffs for contrast.
    // A wide fan (and a good share sprayed back toward the striker), so they read even when the foe sits at an edge.
    // Sparks bounce back off the struck hero toward the middle of the screen (a hero in a corner keeps its spray in view),
    // and the rest carry on through along the blow.
    const nS = Math.round(o.sparks * b);
    const inS = Math.round(nS * this.look.sparkInward);
    this.sparks(x, y, inS, o.into ?? u, { speed: 1050 + 250 * o.k, size: 0.9 + 0.25 * o.k, life: 650, spread: 1.7, back: 0 });
    this.sparks(x, y, nS - inS, u, { speed: 1050 + 250 * o.k, size: 0.85 + 0.25 * o.k, life: 600, spread: 1.9, back: 0.2 });
    this.embers(x, y, o.embers, R * 0.6, { speed: 320 + 120 * o.k, lift: 220, life: 1100 });
    this.smoke(x, y, o.haymaker ? 5 : 2, R * (o.haymaker ? 1.2 : 0.8), { rise: 55, size: o.haymaker ? 1.3 : 0.9, life: o.haymaker ? 1400 : 900, alpha: 0.38 });
    if (o.haymaker) {
      const S = this.scale;
      // The crater round the struck portrait (clear in the middle: the portrait sits IN it) and its glowing cracks.
      const dark = mixColor(this.colors.smoke, 0x000000, 0.45);
      this.fxs('shade', this.tex.scorch, dark, x, y, { dur: 2000, from: ((R * 3.3 * L.craterSize) / SCORCH_PX) * 2 * 0.85, to: ((R * 3.3 * L.craterSize) / SCORCH_PX) * 2, a0: 0.85, mode: 'hold' });
      // The cracks: dark fissures in the ground, with molten light in them that cools first.
      // MOLTEN CRACKS round the crater's rim: dark fissures with molten light in them that cools first (two rings of the
      // short rim cracks, so it reads as broken ground, never as lightning).
      for (const [rr, rot] of [[1.35, this.rnd() * 6.3], [1.75, this.rnd() * 6.3]] as const) {
        const cs = (R * rr * L.craterSize) / 0.62 / 128;
        const crD = this.fxs('shade', this.tex.rimCracks, dark, x, y, { dur: 2000, from: cs * 0.92, to: cs, a0: 0.85, mode: 'hold' });
        const crH = this.fxs('glow', this.tex.rimCracks, this.glowC, x, y, { dur: 1100, from: cs * 0.92, to: cs, a0: 0.75, mode: 'hold' });
        const crC = this.fxs('core', this.tex.rimCracks, this.colors.hot, x, y, { dur: 300, from: cs * 0.92, to: cs, a0: 0.55, mode: 'hold' });
        for (const cr of [crD, crH, crC]) if (cr) cr.rotation = rot;
      }
      // Rock chunks (solid: normal blend), flung up and out, falling with spin.
      const nd = Math.max(0, Math.round(L.debris));
      for (let i = 0; i < nd; i++) {
        const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.6;
        const sp = (550 + this.rnd() * 800) * S;
        const sz = (0.45 + this.rnd() * 0.6) * S;
        this.particle('shade', this.tex.rock, mixColor(this.colors.smoke, this.colors.shade, 0.3), {
          x: x + (this.rnd() - 0.5) * R * 1.2, y: y + (this.rnd() - 0.5) * R * 0.6, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.35, grav: 2100 * S,
          life: 750 + this.rnd() * 450, from: sz, to: sz * 0.85, alpha: 1, spin: (this.rnd() - 0.5) * 0.03,
        });
      }
      // The ember fountain: up and out.
      this.sparks(x, y, Math.round(o.sparks * 0.5), { x: 0, y: -1 }, { speed: 1250, spread: 2.2, size: 0.95, life: 760, back: 0 });
      this.embers(x, y, Math.round(o.embers * 0.7), R * 1.1, { speed: 560, lift: 420, life: 1500 });
    }
    if (o.smoulderMs > 0 || o.haymaker) {
      // IV: the crater throws up an EMBER STORM over its first second, on top of the smoulder.
      this.smoulders.push({ x, y, r: R, left: Math.max(o.smoulderMs, o.haymaker ? 1100 : 0), acc: 0, smokeAcc: 0, storm: o.haymaker ? this.look.emberStorm : 0, stormAcc: 0 });
    }
  }

  /** A haymaker aftershock: rubble landing round the cracked ground (a small ring, a puff, a few sparks). */
  boom(x: number, y: number, size: number): void {
    if (this.destroyed) return;
    const R = this.radius;
    this.fxs('glow', this.tex.ring, this.colors.hot, x, y, { dur: 280, from: (R * 0.25) / RING_R, to: (R * 1 * size) / RING_R, a0: 0.55, sy: 0.6 });
    this.smoke(x, y, 1, R * 0.5, { rise: 40, size: 0.7, life: 700, alpha: 0.3 });
    this.sparks(x, y, 7, { x: 0, y: -1 }, { speed: 600, spread: 2.2, size: 0.55, life: 420, back: 0 });
  }

  /** The hero springs home: from now on it trails a few embers and wisps as it moves. */
  recover(): void { this.recovering = true; this.dashing = false; }

  /**
   * Follow the hero to sequence time `t` (called from the clock's paint): the aura rides the portrait at its current
   * heat, the pulled motes close in, afterimages are stamped along the dash, and the streak is resampled from its motion.
   */
  follow(t: number): void {
    if (this.destroyed || !this.path) return;
    const dt = Number.isFinite(this.lastT) ? Math.max(0, Math.min(100, t - this.lastT)) : 0;
    this.lastT = t;
    const prev = this.lastHero;
    const h = this.path(t);
    this.lastHero = h;
    const S = this.scale;
    const R = this.radius * h.s;
    const vx = h.x - prev.x, vy = h.y - prev.y;
    const moved = dt > 0 ? Math.hypot(vx, vy) : 0;
    const L = this.look;
    if ((this.dashing || this.lastStretch) && moved > 0) this.stampGhosts(prev, h, moved);
    for (const sc of this.scorches) if (sc.open) { sc.bx = h.x; sc.by = h.y; }
    // THE COMET (IV): the slam sheds fire along its path.
    if (this.dashing && (this.aura?.comet ?? 0) > 0 && moved > 0) {
      this.cometAcc += moved;
      while (this.cometAcc > 12 * S) {
        this.cometAcc -= 12 * S;
        const a = Math.atan2(-vy, -vx) + (this.rnd() - 0.5) * 1.2;
        const sp = (200 + this.rnd() * 300) * S;
        this.particle('air', this.tex.spark, this.rnd() < 0.5 ? this.colors.hot : this.glowC, {
          x: h.x + (this.rnd() - 0.5) * R * 0.8, y: h.y + (this.rnd() - 0.5) * R * 0.8, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.1, grav: 240 * S,
          life: 380 + this.rnd() * 300, from: (0.35 + this.rnd() * 0.3) * S, to: 0.08 * S, alpha: 1, streak: 1.2,
        });
      }
    }
    this.lastStretch = false;
    for (const q of this.chargeRings) q.s.position.set(h.x, h.y);
    // How fast it is going over the streak's span (0 = still, 1 = a full dash): the streak follows it.
    const back = this.path(t - L.wakeMs);
    const speed = clamp01(Math.hypot(h.x - back.x, h.y - back.y) / (this.radius * 1.6));
    this.wakeDt = dt;
    this.drawWake(t, speed);
    const a = this.aura;
    if (a) {
      a.heat = h.heat;
      a.age += dt;
      const heat = clamp01(h.heat) * this.auraMul;
      const comet = a.comet * clamp01(h.heat);
      // Lean: a DASH streams the flames back; otherwise they lick upward (fire rises). Measured over 50 ms of the smooth
      // motion, so the windup's tremble never flails them.
      const was = this.path(t - 50);
      const mvx = h.x - was.x, mvy = h.y - was.y;
      const mv = Math.hypot(mvx, mvy);
      const fast = clamp01((mv / 50 - 0.9 * S) / (3 * S));
      const lx = mv > 0.01 ? -mvx / mv : 0, ly = mv > 0.01 ? -mvy / mv : -1;
      const flick = 0.88 + 0.12 * Math.sin(a.age * 0.057) + 0.06 * Math.sin(a.age * 0.131);
      a.ring.position.set(h.x, h.y); a.ring.scale.set((R * 1.02) / RIM_R); a.ring.alpha = Math.min(1, 0.85 * heat) * flick;
      // The halo annulus: its bright band sits at 0.64 of the texture's half-width, so it maps onto 1.04 radii at 1.6R.
      a.halo.position.set(h.x, h.y); a.halo.scale.set(((R * 1.62 * (1 + 0.12 * comet)) / GLOW_PX) * 2 * L.auraSize); a.halo.alpha = (0.5 + 0.12 * comet) * heat * flick;
      a.shade.position.set(h.x, h.y); a.shade.scale.set(((R * 1.75) / GLOW_PX) * 2 * L.auraSize); a.shade.alpha = 0.35 * heat;
      for (const f of a.flames) {
        const rx = Math.cos(f.ang), ry = Math.sin(f.ang);
        // Streaming back when fast: the flames on the leading side of the rim shrink (they would cross the face).
        const facing = fast > 0.05 ? clamp01(0.45 + 0.9 * (rx * lx + ry * ly)) : 1;
        // Mostly UP (fire rises) with a little outward lean, or streaming back when fast.
        let dx = rx * 0.4 + (fast > 0.05 ? lx * (0.8 + 1.6 * fast) : 0);
        let dy = ry * 0.4 + (fast > 0.05 ? ly * (0.8 + 1.6 * fast) : -1.1);
        const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
        const wob = 0.8 + 0.14 * Math.sin(f.phase + a.age * 0.017 * f.speed) + 0.1 * Math.sin(f.phase * 2.7 + a.age * 0.041);
        const len = R * 0.95 * L.flameLength * f.len * wob * heat * (1 + 0.3 * comet + 0.7 * fast + 0.6 * this.surge) * (0.2 + 0.8 * facing);
        const wid = R * 0.6 * (0.7 + 0.3 * heat) * (0.75 + 0.35 * f.len) * (1 + 0.15 * comet);
        this.drawFlame(f, h.x + rx * R * 0.9, h.y + ry * R * 0.9, dx, dy, Math.max(1, len), wid, a.age, heat, flick);
      }
      // Embers off the flame tips, rising.
      a.emberAcc += dt * heat * (1 + comet);
      while (a.emberAcc > 55) {
        a.emberAcc -= 55;
        const ea = -Math.PI / 2 + (this.rnd() - 0.5) * 2.2;
        this.particle('air', this.tex.spark, this.rnd() < 0.5 ? this.colors.hot : this.glowC, {
          x: h.x + Math.cos(ea) * R * 1.1, y: h.y + Math.sin(ea) * R * 1.1, vx: (this.rnd() - 0.5) * 70 * S, vy: -(140 + this.rnd() * 140) * S,
          drag: 0.3, grav: -30 * S, life: 450 + this.rnd() * 400, from: (0.2 + this.rnd() * 0.16) * S, to: 0.05 * S, alpha: 1, twinkle: 0.04,
        });
      }
      // Hot motes pulled in from round the hero: thin streaks racing to the rim (line work, not blobs).
      if (a.moteLeft > 0 && a.moteRate > 0) {
        a.moteLeft -= dt;
        a.moteAcc += dt;
        while (a.moteAcc > a.moteRate) {
          a.moteAcc -= a.moteRate;
          const da = this.rnd() * Math.PI * 2, dr = this.radius * (2.4 + this.rnd() * 1.1);
          const sp = (dr - this.radius) / 0.26;
          this.particle('air', this.tex.streak, this.rnd() < 0.5 ? this.colors.hot : this.colors.core, {
            x: h.x + Math.cos(da) * dr, y: h.y + Math.sin(da) * dr, vx: -Math.cos(da) * sp, vy: -Math.sin(da) * sp,
            drag: 1, grav: 0, life: 300, from: 0.5 * S, to: 0.4 * S, alpha: 0.85, streak: 1.4, toHero: true,
          });
        }
      }
    }
    // Recovering: a few embers and wisps stream off the hero as it springs home.
    if (this.recovering && h.heat > 0.05) {
      this.trailAcc += moved;
      while (this.trailAcc > 26 * S) {
        this.trailAcc -= 26 * S;
        this.embers(h.x, h.y, 1, R * 0.5, { speed: 90, lift: 110, life: 650 });
        if (this.rnd() < 0.35) this.smoke(h.x, h.y, 1, R * 0.45, { rise: 70, size: 0.5, life: 600, alpha: 0.22 * h.heat });
      }
    }
  }

  /**
   * CRISP AFTERIMAGES: a copy of the portrait is stamped every `spacing` px of travel along this frame's straight
   * segment (so an ease that hangs then blurs still leaves evenly spaced ghosts, never a smear), each fading fast. The
   * ones stamped further back along the segment start fainter, as if stamped earlier in the frame.
   */
  private stampGhosts(a: HeroAt, b: HeroAt, moved: number): void {
    const L = this.look;
    const n = Math.max(0, Math.min(MAX_GHOSTS, Math.round(L.ghosts)));
    if (!n || L.ghostAlpha <= 0) return;
    const gap = Math.max(this.radius * L.ghostSpacing, 8);
    // Only real dashes stamp (a coil or a tremble never does).
    if (moved < this.radius * 0.12) { this.ghostAcc = 0; return; }
    let dist = gap - this.ghostAcc;
    const stamps: number[] = [];
    while (dist <= moved) { stamps.push(dist); dist += gap; }
    this.ghostAcc = moved - (dist - gap);
    // Keep the newest `n`: those nearest the head.
    for (const d of stamps.slice(-n)) {
      const f = d / moved; // 0 = the previous frame's position, 1 = now
      const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, s = a.s + (b.s - a.s) * f;
      while (this.ghosts.length >= n) { const old = this.ghosts.shift()!; this.give(old.art); this.give(old.rim); }
      const art = this.take('ghost', this.ghostTex, mixColor(0xffffff, this.colors.side, 0.55));
      const rim = this.take('glow', this.tex.rim, this.colors.hot);
      if (!art || !rim) { if (art) this.give(art); if (rim) this.give(rim); return; }
      art.position.set(x, y); art.scale.set((this.radius * 2 * s * 0.98) / GHOST_PX);
      rim.position.set(x, y); rim.scale.set((this.radius * s * 1.0) / RIM_R);
      const g: Ghost = { art, rim, age: (1 - f) * 40, fade: L.ghostFadeMs, a0: L.ghostAlpha };
      this.ghosts.push(g);
    }
    // The newest is the strongest, each older one fainter (a crisp stepped trail, never a smear of equals).
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[this.ghosts.length - 1 - i]!;
      g.a0 = Math.min(g.a0, L.ghostAlpha * Math.pow(0.62, i));
      this.paintGhost(g);
    }
  }

  private paintGhost(g: Ghost): void {
    const u = clamp01(g.age / Math.max(1, g.fade));
    const a = g.a0 * (1 - u) * (1 - u);
    g.art.alpha = a;
    g.rim.alpha = Math.min(1, a * 1.1);
  }

  /** The rage streak: three strips on the hero's centreline sampled back in time (Arcana's trail), while it moves. */
  private wakeOn = 0;
  private wakeDt = 0;

  private drawWake(t: number, speed: number): void {
    const L = this.look;
    if (!this.path || L.wakeWidth <= 0) return;
    if (!this.wake) {
      if (speed < 0.1 || !(this.dashing || this.lastStretch)) return;
      const glow = this.strip('glow', this.tex.ribbonSoft, this.glowC);
      const body = this.strip('body', this.tex.ribbonBody, this.deep);
      const core = this.strip('core', this.tex.ribbonBody, this.colors.core);
      if (!glow || !body || !core) { this.giveStrip(glow); this.giveStrip(body); this.giveStrip(core); return; }
      this.wake = { glow, body, core };
    }
    const N = STRIP_POINTS;
    const { px, py, hw } = this;
    const step = L.wakeMs / (N - 1);
    const head = this.lastHero;
    // Bounded in LENGTH (a comet tail hugging the hero), however far the dash covered in `wakeMs`: never a laser line.
    const maxLen = this.radius * head.s * 2.6 * (1 + 0.5 * (this.aura?.comet ?? 0));
    // It starts at the portrait's BACK rim (Pixi draws over the portrait, so a streak through its face would hide it).
    const tail0 = this.path(t - L.wakeMs);
    const bd = Math.hypot(tail0.x - head.x, tail0.y - head.y) || 1;
    const hx = head.x + ((tail0.x - head.x) / bd) * this.radius * head.s * 0.8, hy = head.y + ((tail0.y - head.y) / bd) * this.radius * head.s * 0.8;
    for (let j = 0; j < N; j++) {
      const p = this.path(t - j * step);
      const dx = p.x - hx, dy = p.y - hy;
      const d = Math.hypot(dx, dy);
      const k = d > maxLen ? maxLen / d : 1;
      px[j] = hx + dx * k; py[j] = hy + dy * k;
      // Nothing of it inside the portrait: a point still in front of the back rim is pulled onto it.
      if ((px[j]! - head.x) * (tail0.x - head.x) + (py[j]! - head.y) * (tail0.y - head.y) < this.radius * head.s * 0.8 * bd) { px[j] = hx; py[j] = hy; }
    }
    this.normals();
    const w0 = this.radius * head.s * 0.5 * L.wakeWidth * (0.8 + 0.6 * (this.aura?.comet ?? 0));
    // Pointed at BOTH ends (it swells out of the portrait's back rim and thins to a point): a streak, never a baton.
    for (let j = 0; j < N; j++) { const f = j / (N - 1); hw[j] = w0 * (f < 0.2 ? 0.35 + 0.65 * Math.sin((f / 0.2) * Math.PI * 0.5) : Math.pow(1 - (f - 0.2) / 0.8, 1.2)); }
    // Only a DASH trails a streak (never the spring home): it fades in with the dash and out in ~80 ms after it lands.
    this.wakeOn = this.dashing || this.lastStretch ? 1 : Math.max(0, this.wakeOn - this.wakeDt / 80);
    const a = clamp01((speed - 0.1) * 1.6) * this.wakeOn;
    this.writeStrip(this.wake.glow, 1.7, 0.5 * a, 0);
    this.writeStrip(this.wake.body, 0.8, 0.6 * a, 0);
    this.writeStrip(this.wake.core, 0.18, 0.55 * a, 1.6);
    if (a <= 0 && this.lastHero.heat <= 0.01) this.dropWake();
  }

  /** Normals of the spine in px/py by central difference (the last good one carries over a degenerate point). */
  private normals(): void {
    const N = STRIP_POINTS;
    const { px, py, nx, ny } = this;
    let lx = 0, ly = 1;
    for (let j = 0; j < N; j++) {
      const a = Math.max(0, j - 1), b = Math.min(N - 1, j + 1);
      const tx = px[a]! - px[b]!, ty = py[a]! - py[b]!;
      const l = Math.hypot(tx, ty);
      if (l > 0.01) { lx = -ty / l; ly = tx / l; }
      nx[j] = lx; ny[j] = ly;
    }
  }

  private writeStrip(st: Strip | null, mult: number, alpha: number, sharpen: number): void {
    if (!st) return;
    const { px, py, nx, ny, hw } = this;
    const v = st.v;
    for (let j = 0; j < STRIP_POINTS; j++) {
      const h = hw[j]! * mult * (sharpen ? Math.pow(1 - j / (STRIP_POINTS - 1), sharpen) : 1);
      v[j * 4] = px[j]! + nx[j]! * h; v[j * 4 + 1] = py[j]! + ny[j]! * h;
      v[j * 4 + 2] = px[j]! - nx[j]! * h; v[j * 4 + 3] = py[j]! - ny[j]! * h;
    }
    st.mesh.alpha = Math.max(0, alpha);
  }

  /** Draw a claw stroke at its age: the spine from a (the tail) to its drawn-on head, tapered at both ends. */
  private drawStroke(k: Stroke): void {
    const N = STRIP_POINTS;
    const { px, py, hw } = this;
    const drawn = easeOutCubic(clamp01(k.age / k.draw));
    const fadeU = clamp01((k.age - k.draw - k.hold) / k.fade);
    // The tail catches up as it fades, so the rip shortens toward its end instead of just dimming.
    const tail = 0.55 * fadeU * fadeU;
    const dx = k.bx - k.ax, dy = k.by - k.ay;
    const len = Math.hypot(dx, dy) || 1;
    const nX = -dy / len, nY = dx / len;
    for (let j = 0; j < N; j++) {
      // The head is j = 0 (the texture's full end), the tail j = N - 1.
      const f = tail + (drawn - tail) * (1 - j / (N - 1));
      const bow = k.bend * Math.sin(Math.PI * f);
      px[j] = k.ax + dx * f + nX * bow;
      py[j] = k.ay + dy * f + nY * bow;
      const w = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, f))), 0.65);
      hw[j] = k.width * 0.5 * Math.max(0.08, w) * (1 + 0.25 * fadeU);
    }
    this.normals();
    const a = 1 - fadeU;
    // A deep red rip with a thin white-hot core down its middle (the body carries the colour; the core is a hairline).
    this.writeStrip(k.glow, 3, 0.45 * a, 0);
    this.writeStrip(k.body, 1.5, 0.95 * a, 0);
    this.writeStrip(k.core, 0.42, a, 0);
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

    // The aura goes once the rage has cooled (the hero is home, or the clock stopped following it).
    const a = this.aura;
    if (a && a.heat <= 0.01 && a.age > 200) {
      for (const f of a.flames) this.dropFlame(f);
      this.give(a.ring); this.give(a.halo); this.give(a.shade);
      this.aura = null;
    }
    if (this.wake && this.lastHero.heat <= 0.01) this.dropWake();

    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i]!;
      g.age += dt;
      if (g.age >= g.fade) { this.give(g.art); this.give(g.rim); this.ghosts.splice(i, 1); continue; }
      this.paintGhost(g);
    }

    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const k = this.strokes[i]!;
      if (k.delay > 0) { k.delay -= dt; if (k.delay > 0) { for (const st of [k.glow, k.body, k.core]) if (st) st.mesh.alpha = 0; continue; } }
      k.age += dt;
      if (k.age >= k.draw + k.hold + k.fade) { this.giveStrip(k.glow); this.giveStrip(k.body); this.giveStrip(k.core); this.strokes.splice(i, 1); continue; }
      this.drawStroke(k);
    }

    this.surge = Math.max(0, this.surge - dt / 320);

    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const sc = this.scorches[i]!;
      if (!sc.open) sc.age += dt;
      if (sc.age >= sc.life) { this.giveStrip(sc.burn); this.giveStrip(sc.heat); this.scorches.splice(i, 1); continue; }
      this.drawScorch(sc);
    }

    for (let i = this.smoulders.length - 1; i >= 0; i--) {
      const m = this.smoulders[i]!;
      m.left -= dt;
      if (m.left <= 0) { this.smoulders.splice(i, 1); continue; }
      m.acc += dt; m.smokeAcc += dt;
      while (m.acc > 90) { m.acc -= 90; this.embers(m.x, m.y + m.r * 0.3, 1, m.r * 0.75, { speed: 50, lift: 120, grav: -40, life: 900 }); }
      while (m.smokeAcc > 320) { m.smokeAcc -= 320; this.smoke(m.x + (this.rnd() - 0.5) * m.r, m.y, 1, m.r * 0.45, { rise: 70, size: 0.65, life: 1000, alpha: 0.22 }); }
      if (m.storm > 0) {
        m.stormAcc += dt;
        const every = 1000 / Math.max(1, m.storm);
        while (m.stormAcc > every && m.storm > 0) {
          m.stormAcc -= every; m.storm--;
          this.embers(m.x, m.y, 1, m.r * 1.3, { speed: 380, lift: 420, grav: 160, life: 1300 });
        }
      }
    }

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const q = this.fx[i]!;
      if (q.delay > 0) { q.delay -= dt; if (q.delay > 0) continue; }
      q.age += dt;
      const u = clamp01(q.age / q.dur);
      const sc = q.from + (q.to - q.from) * easeOutQuint(u);
      q.s.scale.set(sc, sc * q.sy);
      q.s.alpha = q.mode === 'punch'
        ? (u < q.peakAt ? q.a0 * (u / q.peakAt) : q.a0 * (1 - (u - q.peakAt) / (1 - q.peakAt)))
        : q.mode === 'hold' ? q.a0 * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4)
          : q.a0 * (1 - u) * (1 - u * 0.3);
      if (u >= 1) {
        const ci = this.chargeRings.indexOf(q);
        if (ci >= 0) this.chargeRings.splice(ci, 1);
        this.give(q.s); this.fx.splice(i, 1);
      }
    }

    const h = this.lastHero;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) { this.give(p.s); this.particles.splice(i, 1); continue; }
      const damp = Math.pow(p.drag, sec);
      p.vx *= damp; p.vy = p.vy * damp + p.grav * sec;
      p.x += p.vx * sec; p.y += p.vy * sec;
      const t = 1 - p.life / p.max;
      p.s.position.set(p.x, p.y);
      let fade = 1;
      if (p.toHero) {
        // A pulled mote: gone as it reaches the rim.
        const d = Math.hypot(h.x - p.x, h.y - p.y);
        fade = clamp01((d - this.radius * h.s) / (this.radius * 0.8));
        if (fade <= 0) { this.give(p.s); this.particles.splice(i, 1); continue; }
      }
      const sc = p.from + (p.to - p.from) * t;
      if (p.streak > 0) {
        // Stretched along its flight: a chunky spark reads as a hot streak, a speed line as a line.
        const v = Math.hypot(p.vx, p.vy);
        p.s.rotation = Math.atan2(p.vy, p.vx);
        p.s.scale.set(sc * (1 + (v / Math.max(1e-6, S) / 1000) * p.streak), sc);
      } else {
        p.s.scale.set(sc);
        if (p.spin) p.s.rotation += p.spin * dt;
      }
      const tw = p.twinkle ? 0.6 + 0.4 * Math.sin((p.max - p.life) * p.twinkle * 6) : 1;
      p.s.alpha = p.alpha * (1 - t * t) * tw * fade;
    }

    return this.used > this.warm.length || this.meshes > 0 || this.aura !== null || this.smoulders.length > 0 || this.scorches.length > 0;
  }

  private dropWake(): void {
    if (!this.wake) return;
    this.giveStrip(this.wake.glow); this.giveStrip(this.wake.body); this.giveStrip(this.wake.core);
    this.wake = null;
  }

  /** Drop every in-flight effect at once (a cancel). The pools are kept for reuse. */
  /** A scorch: the burn tapers in at its start and out at the hero, the hot core cools fast, the burn slowly. */
  private drawScorch(sc: Scorch): void {
    const N = STRIP_POINTS;
    const { px, py, hw } = this;
    const dx = sc.bx - sc.ax, dy = sc.by - sc.ay;
    const len = Math.hypot(dx, dy);
    if (len < 2) { for (const st of [sc.burn, sc.heat]) if (st) st.mesh.alpha = 0; return; }
    // Only the last stretch behind the hero (a skid of scorched ground, never a line across the board), stopping short of
    // the hero so the burn is BEHIND it, never under its face.
    const end = Math.max(0, len - this.radius * 0.8) / len;
    const start = Math.max(0, end - (this.radius * 3.2) / len);
    for (let j = 0; j < N; j++) {
      const f = end - (end - start) * (j / (N - 1)); // head (texture's full end) nearest the hero
      px[j] = sc.ax + dx * f; py[j] = sc.ay + dy * f;
      const e = j / (N - 1);
      hw[j] = sc.w * 0.5 * Math.min(1, e / 0.2) * Math.min(1, (1 - e) / 0.25 + 0.3);
    }
    this.normals();
    const u = clamp01(sc.age / sc.life);
    this.writeStrip(sc.burn, 1, 0.5 * (1 - u * u), 0);
    const hotA = clamp01(1 - sc.age / Math.max(1, sc.life * 0.35));
    this.writeStrip(sc.heat, 0.8, 0.55 * hotA, 0.4);
  }

  clear(): void {
    for (const q of this.fx) this.give(q.s);
    for (const p of this.particles) this.give(p.s);
    for (const g of this.ghosts) { this.give(g.art); this.give(g.rim); }
    for (const k of this.strokes) { this.giveStrip(k.glow); this.giveStrip(k.body); this.giveStrip(k.core); }
    if (this.aura) { for (const f of this.aura.flames) this.dropFlame(f); this.give(this.aura.ring); this.give(this.aura.halo); this.give(this.aura.shade); }
    for (const s of this.warm) this.give(s);
    this.dropWake();
    for (const sc of this.scorches) { this.giveStrip(sc.burn); this.giveStrip(sc.heat); }
    this.fx = []; this.particles = []; this.ghosts = []; this.strokes = []; this.aura = null; this.smoulders = []; this.warm = []; this.chargeRings = []; this.scorches = [];
  }

  /** Tear down: every sprite and mesh destroyed, the root emptied and destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    this.path = null;
    for (const [id] of LAYERS) {
      this.freeSprites[id].length = 0;
      this.freeMeshes[id].length = 0;
      this.layers[id].removeChildren().forEach((c) => c.destroy());
    }
    this.root.removeChildren().forEach((c) => c.destroy());
    this.root.destroy();
  }
}
