/**
 * PIXI FIRE: live flame built from particles (owner 2026-09-29: "fix the fire in enrage with pixi style fire so it
 * looks less like a flame image and more like actual fire. same with the new fire animation, it should look like live
 * flame/fires pixi sprites etc"). Shared by the Fire hero attack (`../heroFire/`) and the Enraged Strike's rage aura.
 *
 * WHAT MAKES IT READ AS FIRE, NOT A PICTURE OF FIRE:
 *  - The body is MANY small soft puffs, ADDITIVE, overlapping: where they pile up they blow out to a white-yellow core,
 *    at the thin edges they stay orange and red. Each puff is born small and hot, swells, then shrinks to nothing as it
 *    rises, and ramps its colour over its life (white-yellow core -> yellow -> orange -> deep red -> a dark ember red).
 *  - A share of the particles are TONGUES: a teardrop stretched along its own motion, so the fire licks upward in
 *    strands and flickers as they stretch and snap.
 *  - Hot gas is BUOYANT: every particle accelerates upward, and a cheap curl-like field of travelling sines pushes it
 *    sideways, so the plume sways and curls and never rises in straight lines.
 *  - Every particle FLICKERS (its own phase), and every emitter GUSTS (a slow wobble on its rate and size).
 *  - A deep, NORMAL-blend body layer under the additive flame keeps the fire's colour on a light board.
 *  - EMBERS break off and flutter up; flames that die leave SMOKE (normal blend, dark, growing, drifting) above.
 *
 * API: `emitter(spec)` returns a live `FireEmitter` the host moves every frame (a fireball's head, a portrait's rim, a
 * racing ring) and turns up and down with `intensity`; `burst` / `embers` / `smokePuffs` are one-shots (an explosion
 * billowing up). Positions, sizes and radii are the caller's px; motion values (speed, lift, turbulence, drift) are px
 * at stage scale 1 and are multiplied by `scale` here.
 *
 * PERF (docs/performance.md): the particle records and their sprites are POOLED (a free list of records, a free list
 * of sprites per layer, created lazily up to the hard `cap` and never destroyed until `destroy()`); `update` allocates
 * nothing (a colour LUT, swap-removal, no closures); textures are painted once per session and shared. The host's
 * `update` drives it; `alive` says whether anything still draws. Scatter is seeded, so a replay burns the same fire.
 */
import { CanvasSource, Container, Sprite, Texture } from 'pixi.js';
import { clamp01, mixColor, seededRng } from './easing';

// ─── textures ────────────────────────────────────────────────────────────────────────────────────────────────

export interface FireTextures {
  /** Soft flame puffs: a round one and two lumpy, noisy ones (the body of the fire). */
  puffs: readonly Texture[];
  /** A licking tongue: a teardrop (a wide soft base, a pointed tip at the TOP), streaked with vertical noise. */
  tongue: Texture;
  /** A soft lumpy smoke billow. */
  smoke: Texture;
  /** A tiny hot ember. */
  ember: Texture;
  /** A big soft radial glow (the light a fire casts on what is round it). */
  glow: Texture;
}

/** Texture sizes (px) the sprite scales divide by. */
export const FIRE_PUFF_PX = 64;
export const FIRE_TONGUE_W = 48;
export const FIRE_TONGUE_H = 96;
export const FIRE_SMOKE_PX = 96;
export const FIRE_EMBER_PX = 16;
export const FIRE_GLOW_PX = 128;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  let g: CanvasRenderingContext2D | null = null;
  // A CPU-backed canvas: the painters read their pixels back once (a GPU canvas readback costs far more).
  try { g = c.getContext('2d', { willReadFrequently: true }); } catch { g = null; }
  return g ? { c, g } : null;
}

const tex = (c: HTMLCanvasElement): Texture => new Texture({ source: new CanvasSource({ resource: c }) });

/** Smooth value noise (seeded, bilinear on a smoothstepped lattice), 0..1. */
function valueNoise(seed: number, cells: number): (x: number, y: number) => number {
  const rnd = seededRng(seed);
  const n = cells + 2;
  const v = new Float32Array(n * n);
  for (let i = 0; i < v.length; i++) v[i] = rnd();
  const s = (t: number): number => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.max(0, Math.min(n - 2, Math.floor(x))), yi = Math.max(0, Math.min(n - 2, Math.floor(y)));
    const fx = s(Math.min(1, Math.max(0, x - xi))), fy = s(Math.min(1, Math.max(0, y - yi)));
    const a = v[yi * n + xi]!, b = v[yi * n + xi + 1]!, c = v[(yi + 1) * n + xi]!, d = v[(yi + 1) * n + xi + 1]!;
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Multiply a canvas's alpha by `mask(x, y)` (0..1). Once per texture per session. */
function maskAlpha(k: { c: HTMLCanvasElement; g: CanvasRenderingContext2D }, mask: (x: number, y: number) => number): void {
  try {
    const { width: w, height: h } = k.c;
    const img = k.g.getImageData(0, 0, w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4 + 3; d[i] = Math.round(d[i]! * clamp01(mask(x, y))); }
    k.g.putImageData(img, 0, 0);
  } catch { /* a canvas we cannot read back: keep it smooth */ }
}

function radial(g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: readonly [number, number][]): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [at, a] of stops) gr.addColorStop(at, `rgba(255,255,255,${a})`);
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/**
 * A flame puff, painted per pixel: a soft round falloff (solid in the middle, feathered to nothing at the edge) whose
 * outline is pushed in and out by angular noise (`lumps` = how ragged: 0 a clean soft ball), and whose alpha is eaten
 * by fine noise toward the edge only, so the heart stays solid and the rim goes wispy. Never a hard disc or a ring.
 */
function paintPuff(seed: number, lumps: number): HTMLCanvasElement | null {
  const D = FIRE_PUFF_PX;
  const k = canvas(D, D); if (!k) return null;
  const img = k.g.createImageData(D, D);
  const d = img.data;
  const n1 = valueNoise(seed * 7 + 2, 8), n2 = valueNoise(seed * 13 + 5, 16);
  const rnd = seededRng(seed);
  const ph1 = rnd() * 6.28, ph2 = rnd() * 6.28, ph3 = rnd() * 6.28;
  const m = D / 2;
  for (let y = 0; y < D; y++) {
    for (let x = 0; x < D; x++) {
      const dx = x + 0.5 - m, dy = y + 0.5 - m;
      const th = Math.atan2(dy, dx);
      // A ragged outline: the radius wobbles with the angle (periodic, so there is no seam).
      const wob = 1 - lumps * 0.04 * (1.3 + 0.8 * Math.sin(2 * th + ph1) + 0.5 * Math.sin(3 * th + ph2) + 0.25 * Math.sin(5 * th + ph3));
      const rr = Math.hypot(dx, dy) / (m * Math.max(0.4, wob));
      if (rr >= 1) continue;
      const fall = Math.pow(1 - rr * rr, 1.6);
      const noise = 0.6 * n1(x / 8, y / 8) + 0.4 * n2(x / 4, y / 4);
      const edge = rr * rr;
      const alpha = fall * (1 - edge * (1 - Math.min(1, noise * 1.35)) * (0.55 + 0.08 * lumps));
      const i = (y * D + x) * 4;
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = Math.round(255 * clamp01(alpha));
    }
  }
  k.g.putImageData(img, 0, 0);
  return k.c;
}

/** A tongue: a teardrop, tip at the top, soft all round, streaked with vertical noise (flame strands). */
function paintTongue(): HTMLCanvasElement | null {
  const W = FIRE_TONGUE_W, H = FIRE_TONGUE_H;
  const k = canvas(W, H); if (!k) return null;
  const g = k.g;
  const baseY = H * 0.74, baseR = W * 0.36;
  // Layered from the outside in (each a little narrower and shorter), so the edge is soft and the root is hottest.
  for (let i = 0; i < 12; i++) {
    const f = 1 - i / 12;
    const r = baseR * (0.25 + 0.75 * f);
    const tipY = baseY - (baseY - 3) * (0.35 + 0.65 * f);
    g.beginPath();
    g.moveTo(W / 2, tipY);
    g.bezierCurveTo(W / 2 + r * 0.25, tipY + (baseY - tipY) * 0.35, W / 2 + r * 1.05, baseY - r * 0.7, W / 2 + r, baseY);
    g.arc(W / 2, baseY, r, 0, Math.PI, false);
    g.bezierCurveTo(W / 2 - r * 1.05, baseY - r * 0.7, W / 2 - r * 0.25, tipY + (baseY - tipY) * 0.35, W / 2, tipY);
    g.closePath();
    g.fillStyle = `rgba(255,255,255,${0.1 + 0.06 * (i / 12)})`;
    g.fill();
  }
  const n1 = valueNoise(311, 10), n2 = valueNoise(977, 18);
  maskAlpha(k, (x, y) => {
    // Vertical streaks (noise stretched along the flame), stronger toward the tip; the root stays solid.
    const up = clamp01(1 - y / baseY);
    const streak = 0.6 * n1(x / 5, y / 14) + 0.4 * n2(x / 3, y / 7);
    return (1 - up * 0.75) + up * 0.75 * clamp01(streak * 1.5 - 0.1);
  });
  return k.c;
}

function paintSmoke(): HTMLCanvasElement | null {
  const D = FIRE_SMOKE_PX;
  const k = canvas(D, D); if (!k) return null;
  const rnd = seededRng(5147);
  for (let i = 0; i < 8; i++) {
    const a = rnd() * Math.PI * 2, r = D * (0.04 + rnd() * 0.16);
    radial(k.g, D / 2 + Math.cos(a) * r, D / 2 + Math.sin(a) * r, D * (0.2 + rnd() * 0.15), [[0, 0.55], [0.55, 0.25], [1, 0]]);
  }
  const n1 = valueNoise(88, 8), n2 = valueNoise(123, 16);
  maskAlpha(k, (x, y) => 0.35 + 0.8 * (0.6 * n1(x / 12, y / 12) + 0.4 * n2(x / 6, y / 6)));
  return k.c;
}

function paintRadial(D: number, stops: readonly [number, number][]): HTMLCanvasElement | null {
  const k = canvas(D, D); if (!k) return null;
  radial(k.g, D / 2, D / 2, D / 2, stops);
  return k.c;
}

let cached: FireTextures | null | undefined;

/**
 * The fire textures, painted ONCE per session and kept (about 200 KB of GPU memory). White on transparent: every
 * sprite tints them. Null where there is no 2D canvas (headless tests pass their own).
 */
export function pixiFireTextures(): FireTextures | null {
  if (cached !== undefined) return cached;
  const p0 = paintPuff(17, 0), p1 = paintPuff(29, 3), p2 = paintPuff(43, 4);
  const tongue = paintTongue(), smoke = paintSmoke();
  const ember = paintRadial(FIRE_EMBER_PX, [[0, 1], [0.3, 0.8], [0.6, 0.25], [1, 0]]);
  const glow = paintRadial(FIRE_GLOW_PX, [[0, 1], [0.3, 0.5], [0.65, 0.14], [1, 0]]);
  if (!p0 || !p1 || !p2 || !tongue || !smoke || !ember || !glow) { cached = null; return null; }
  cached = { puffs: [tex(p0), tex(p1), tex(p2)], tongue: tex(tongue), smoke: tex(smoke), ember: tex(ember), glow: tex(glow) };
  return cached;
}

/** Fire textures made of another set's soft glow, smoke and spark (a headless test, or a host with no 2D canvas yet). */
export function fireTexturesFrom(glow: Texture, smoke: Texture, spark: Texture): FireTextures {
  return { puffs: [glow], tongue: glow, smoke, ember: spark, glow };
}

// ─── palette ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A fire's colour ramp, hottest first. */
export interface FirePalette {
  /** The white-hot heart. */
  core: number;
  /** Yellow. */
  hot: number;
  /** Orange. */
  mid: number;
  /** Red. */
  deep: number;
  /** The dark ember red it cools to. */
  dark: number;
  /** Smoke. */
  smoke: number;
}

/** A mage's fire: a bright gold-white heart, orange, a clean red. */
export const FIRE_PALETTE: Readonly<FirePalette> = Object.freeze({ core: 0xfff4de, hot: 0xffa640, mid: 0xff7417, deep: 0xd9230b, dark: 0x5a0a03, smoke: 0x2b1f1b });
/** Rage: hotter reds, less yellow (the Enraged Strike). */
export const RAGE_FIRE_PALETTE: Readonly<FirePalette> = Object.freeze({ core: 0xffe7b0, hot: 0xffa62b, mid: 0xff4d12, deep: 0xc8160a, dark: 0x4a0602, smoke: 0x2b1b16 });

/** Where each ramp stop sits along a particle's cooling (0 = white-hot, 1 = cold). */
const STOPS = [0, 0.16, 0.38, 0.64, 1] as const;
export const FIRE_RAMP_STEPS = 64;

/** The colour at cooling `u` (0 = the white-hot heart, 1 = a dark ember). Pure. */
export function fireRamp(p: FirePalette, u: number): number {
  const cs = [p.core, p.hot, p.mid, p.deep, p.dark];
  const t = clamp01(u);
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i]!) return mixColor(cs[i - 1]!, cs[i]!, (t - STOPS[i - 1]!) / (STOPS[i]! - STOPS[i - 1]!));
  }
  return p.dark;
}

// ─── emitters ────────────────────────────────────────────────────────────────────────────────────────────────

export type FireShape = 'point' | 'ring' | 'disc' | 'line';

/** How a fire emits. Positions and sizes: the caller's px. Motion values: px at stage scale 1 (scaled here). */
export interface FireEmitterSpec {
  shape?: FireShape;
  x: number; y: number;
  /** A line's other end. */
  x2?: number; y2?: number;
  /** A ring's or a disc's radius (a point's jitter). */
  r?: number;
  /** A ring's arc (radians, screen angles: -PI/2 is straight up). Default the whole ring. */
  a0?: number; a1?: number;
  /** Flame particles per second at intensity 1. */
  rate: number;
  /** A flame puff's size (px) at its biggest. */
  size: number;
  /** A flame particle's life (ms). */
  life: number;
  /** Buoyancy (px/s^2 upward). */
  lift?: number;
  /** Random launch speed (px/s). */
  speed?: number;
  /** Outward launch speed off a ring or a disc (px/s). */
  out?: number;
  /** A drift every particle is born with (px/s): a moving source's own velocity, or a wind. */
  vx?: number; vy?: number;
  /** How hot it burns (0..1): 1 starts every particle white-hot, 0.5 starts it orange. */
  heat?: number;
  /** Turbulence strength (px/s^2). */
  turb?: number;
  /** The share of flame particles that are licking tongues (0..1). */
  tongues?: number;
  /** The share that also lay a deep normal-blend body puff under the flame (0..1). */
  body?: number;
  /** The chance a dying flame leaves a smoke billow (0..1). */
  smoke?: number;
  /** Embers per second at intensity 1. */
  embers?: number;
  /** How far an ember is thrown (px/s). */
  emberSpeed?: number;
  /** Drag (per second, 0 = none): a high value makes a burst bloom and hang. */
  drag?: number;
  /**
   * Spread a moving emitter's births along the path it swept since the last frame (default true: a continuous tail).
   * Off for a HEAD that should stay a dense ball at the source (its births ride along with `vx`/`vy`).
   */
  sweep?: boolean;
}

/** A live emitter: move it, turn it up or down (`intensity`), or switch it off. */
export class FireEmitter {
  shape: FireShape;
  x: number; y: number; x2: number; y2: number; r: number; a0: number; a1: number;
  rate: number; size: number; life: number; lift: number; speed: number; out: number; vx: number; vy: number;
  heat: number; turb: number; tongues: number; body: number; smoke: number; embers: number; emberSpeed: number; drag: number;
  sweep: boolean;
  /** 0..1+ (scales the rate, and the size a little). */
  intensity = 1;
  on = true;
  /** A timed emitter (`emitter(spec, { hold, fade })`): burns at `intensity` for `hold` ms, dies down over `fade`. */
  /** @internal */ hold = Number.POSITIVE_INFINITY;
  /** @internal */ fade = 0;
  /** @internal */ age = 0;
  /** @internal */ base = 1;
  /** @internal */ acc = 0;
  /** @internal */ emberAcc = 0;
  /** @internal */ gust: number;
  /** @internal Where it emitted last frame: a MOVING emitter spreads its births along the path it swept since. */
  lx: number; ly: number;

  constructor(o: FireEmitterSpec, gust: number) {
    this.shape = o.shape ?? 'point';
    this.x = o.x; this.y = o.y; this.x2 = o.x2 ?? o.x; this.y2 = o.y2 ?? o.y; this.r = o.r ?? 0;
    this.a0 = o.a0 ?? -Math.PI; this.a1 = o.a1 ?? Math.PI;
    this.rate = o.rate; this.size = o.size; this.life = o.life;
    this.lift = o.lift ?? 520; this.speed = o.speed ?? 50; this.out = o.out ?? 0; this.vx = o.vx ?? 0; this.vy = o.vy ?? 0;
    this.heat = o.heat ?? 1; this.turb = o.turb ?? 260; this.tongues = o.tongues ?? 0.3; this.body = o.body ?? 0.3;
    this.smoke = o.smoke ?? 0.12; this.embers = o.embers ?? 0; this.emberSpeed = o.emberSpeed ?? 90; this.drag = o.drag ?? 0.6;
    this.sweep = o.sweep ?? true;
    this.gust = gust;
    this.lx = this.x; this.ly = this.y;
  }
}

export interface FireBurst {
  /** Flame particles. */
  n: number;
  /** Where they start: a disc this big round the point (px), or ON its rim with `rim`. */
  radius: number;
  rim?: boolean;
  /** How fast they are thrown out (px/s). */
  speed: number;
  /** Puff size (px). */
  size: number;
  /** Life (ms). */
  life: number;
  /** Buoyancy (px/s^2). */
  lift?: number;
  heat?: number;
  /** Throw them along `dir` (radians) within `spread` (default all round). */
  dir?: number; spread?: number;
  tongues?: number;
  body?: number;
  smoke?: number;
  /** Embers thrown with it. */
  embers?: number;
  emberSpeed?: number;
  /** Drag (per second): high = the burst blooms out and hangs, then rises. */
  drag?: number;
  turb?: number;
}

// ─── the particles ───────────────────────────────────────────────────────────────────────────────────────────

const K_FLAME = 0, K_TONGUE = 1, K_BODY = 2, K_SMOKE = 3, K_EMBER = 4;
/** Layer per kind: smoke and body (normal) behind, flame and embers (additive) in front. */
const LAYER_OF = [2, 2, 1, 0, 3] as const;
type LayerIx = 0 | 1 | 2 | 3;

interface FP {
  k: number; s: Sprite | null; layer: LayerIx;
  x: number; y: number; vx: number; vy: number;
  age: number; life: number; size: number; heat: number; ph: number; lift: number; turb: number; drag: number;
  a: number; spin: number; smoke: number;
}

export interface PixiFireOptions {
  /** Hard cap on particles alive at once (every kind). */
  cap: number;
  /** Stage scale: multiplies the motion values. */
  scale?: number;
  seed?: number;
  palette?: FirePalette;
  /** Global multipliers the tuners expose. */
  smoke?: number;
  embers?: number;
  turb?: number;
  lift?: number;
}

export class PixiFire {
  /** Smoke and the deep body (normal blend). The host puts it BELOW whatever should sit over the fire's shadow. */
  readonly back = new Container();
  /** The flame and the embers (additive). */
  readonly front = new Container();
  /** Both, back then front (a host that wants the fire as one layer adds this). */
  readonly root = new Container();
  private readonly layers: Container[];
  private readonly freeSprites: Sprite[][] = [[], [], [], []];
  private readonly live: FP[] = [];
  private readonly freeRecs: FP[] = [];
  private readonly emitters: FireEmitter[] = [];
  private readonly lut = new Uint32Array(FIRE_RAMP_STEPS);
  private readonly bodyLut = new Uint32Array(FIRE_RAMP_STEPS);
  private readonly rnd: () => number;
  private readonly S: number;
  private readonly cap: number;
  private clock = 0;
  private sprites = 0;
  private destroyed = false;
  private readonly smokeK: number;
  private readonly emberK: number;
  private readonly turbK: number;
  private readonly liftK: number;
  readonly palette: FirePalette;

  constructor(private readonly tex: FireTextures, o: PixiFireOptions) {
    this.cap = Math.max(1, Math.floor(o.cap));
    this.S = o.scale ?? 1;
    this.rnd = seededRng(o.seed ?? 1);
    this.palette = o.palette ?? FIRE_PALETTE;
    this.smokeK = o.smoke ?? 1; this.emberK = o.embers ?? 1; this.turbK = o.turb ?? 1; this.liftK = o.lift ?? 1;
    this.root.eventMode = 'none';
    this.root.label = 'pixiFire';
    this.back.label = 'fire-back'; this.front.label = 'fire-front';
    const mk = (label: string, blend: 'normal' | 'add', parent: Container): Container => {
      const c = new Container(); c.label = label; c.blendMode = blend; parent.addChild(c); return c;
    };
    // 0 smoke, 1 body (normal) | 2 flame, 3 embers (additive).
    this.layers = [mk('fire-smoke', 'normal', this.back), mk('fire-body', 'normal', this.back), mk('fire-flame', 'add', this.front), mk('fire-ember', 'add', this.front)];
    this.root.addChild(this.back, this.front);
    for (let i = 0; i < FIRE_RAMP_STEPS; i++) {
      const u = i / (FIRE_RAMP_STEPS - 1);
      this.lut[i] = fireRamp(this.palette, u);
      // The body is the flame's colour pushed deep (a saturated orange-red that holds on a light board).
      this.bodyLut[i] = fireRamp(this.palette, 0.3 + 0.7 * u);
    }
  }

  /** Particles alive (every kind). */
  get count(): number { return this.live.length; }
  /** Sprites made so far (the pool's size: it never exceeds the cap). */
  get pooled(): number { return this.sprites; }
  get emitting(): number { let n = 0; for (const e of this.emitters) if (e.on) n++; return n; }
  /** Anything still burning, smoking or emitting. */
  get alive(): boolean { return this.live.length > 0 || this.emitting > 0; }

  /**
   * Start an emitter. It burns until `stop` (or `on = false`); with `timed` it burns at full for `hold` ms, dies down
   * over `fade` ms and stops itself (the host sets `intensity` once, as the peak).
   */
  emitter(spec: FireEmitterSpec, timed?: { hold: number; fade: number; intensity?: number }): FireEmitter {
    const e = new FireEmitter(spec, this.rnd() * 100);
    if (timed) { e.hold = Math.max(0, timed.hold); e.fade = Math.max(1, timed.fade); e.base = timed.intensity ?? 1; e.intensity = e.base; }
    if (!this.destroyed) this.emitters.push(e);
    else e.on = false;
    return e;
  }

  /** Stop an emitter: nothing new is born; what is burning burns out. */
  stop(e: FireEmitter | null | undefined): void {
    if (!e) return;
    e.on = false;
    const i = this.emitters.indexOf(e);
    if (i >= 0) this.emitters.splice(i, 1);
  }

  // ── pools ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** How many sprites each layer should hold before the first big burst (smoke, body, flame, embers). */
  private reserveLeft = [0, 0, 0, 0];

  /**
   * Plan the pool ahead of the fire: `share` of the cap per layer (smoke, body, flame, embers). `reserveStep` then
   * creates them a few at a time (while the damage formation plays), so a detonation never creates hundreds of sprites
   * (and rebuilds the render structure) in one frame.
   */
  planReserve(share: readonly [number, number, number, number] = [0.2, 0.18, 0.55, 0.07]): void {
    for (let i = 0; i < 4; i++) this.reserveLeft[i] = Math.floor(this.cap * share[i]!);
  }

  /** Create up to `n` of the planned sprites (hidden, in their layers' free lists). Returns whether any are still owed. */
  reserveStep(n: number): boolean {
    let made = 0;
    for (let i = 0; i < 4 && made < n; i++) {
      while (this.reserveLeft[i]! > 0 && made < n && this.sprites < this.cap && !this.destroyed) {
        const s = new Sprite(this.tex.puffs[0]!);
        s.anchor.set(0.5); s.visible = false;
        this.layers[i]!.addChild(s);
        this.freeSprites[i]!.push(s);
        this.sprites++; this.reserveLeft[i]!--; made++;
      }
    }
    return this.reserveLeft.some((v) => v > 0) && this.sprites < this.cap;
  }

  private take(layer: LayerIx, t: Texture): Sprite | null {
    let s = this.freeSprites[layer]!.pop();
    if (!s && this.sprites >= this.cap) {
      // The pool is at its cap: borrow a free sprite from another layer (re-parented), so the pool never passes the cap.
      for (let i = 0; i < 4 && !s; i++) { s = this.freeSprites[i]!.pop(); if (s) this.layers[layer]!.addChild(s); }
      if (!s) return null;
    }
    if (!s) {
      s = new Sprite(t);
      s.anchor.set(0.5);
      this.layers[layer]!.addChild(s);
      this.sprites++;
    } else s.texture = t;
    s.visible = true;
    return s;
  }

  private spawn(k: number, x: number, y: number, vx: number, vy: number, size: number, life: number, heat: number, lift: number, turb: number, drag: number, a: number, smoke = 0): FP | null {
    if (this.destroyed || this.live.length >= this.cap || !(life > 0) || !(size > 0)) return null;
    const layer = LAYER_OF[k] as LayerIx;
    const t = k === K_TONGUE ? this.tex.tongue
      : k === K_SMOKE ? this.tex.smoke
        : k === K_EMBER ? this.tex.ember
          : k === K_BODY ? this.tex.puffs[0]!
            : this.tex.puffs[Math.floor(this.rnd() * this.tex.puffs.length) % this.tex.puffs.length]!;
    const s = this.take(layer, t);
    if (!s) return null;
    const p = this.freeRecs.pop() ?? ({} as FP);
    p.k = k; p.s = s; p.layer = layer; p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.age = 0; p.life = life; p.size = size;
    p.heat = heat; p.ph = this.rnd() * Math.PI * 2; p.lift = lift; p.turb = turb; p.drag = drag; p.a = a; p.smoke = smoke;
    p.spin = k === K_TONGUE ? 0 : (this.rnd() - 0.5) * (k === K_SMOKE ? 0.0012 : 0.004);
    s.rotation = this.rnd() * Math.PI * 2;
    s.alpha = 0;
    s.position.set(x, y);
    s.scale.set(0.001);
    this.live.push(p);
    return p;
  }

  /** A flame particle (a puff or, with chance `tongues`, a tongue), and maybe its body puff. */
  private flame(x: number, y: number, vx: number, vy: number, size: number, life: number, heat: number, lift: number, turb: number, drag: number, tongues: number, body: number, smoke: number): void {
    const r = this.rnd;
    const hot = clamp01(heat * (0.75 + r() * 0.35));
    const sz = size * (0.65 + r() * 0.6) * (1.15 - 0.3 * hot);
    const lf = life * (0.7 + r() * 0.6);
    const tongue = r() < tongues;
    this.spawn(tongue ? K_TONGUE : K_FLAME, x, y, vx, vy, sz, lf * (tongue ? 0.8 : 1), hot, lift, turb, drag, tongue ? 0.62 : 0.55, smoke);
    if (r() < body) this.spawn(K_BODY, x, y, vx * 0.8, vy * 0.8, sz * 1.2, lf * 0.6, hot * 0.6, lift * 0.85, turb, drag, 0.38);
  }

  private ember(x: number, y: number, speed: number, life: number, lift: number): void {
    const S = this.S;
    const a = -Math.PI / 2 + (this.rnd() - 0.5) * 2.4;
    const sp = speed * (0.4 + this.rnd() * 0.9) * S;
    const sz = FIRE_EMBER_PX * (0.35 + this.rnd() * 0.45) * S;
    this.spawn(K_EMBER, x, y, Math.cos(a) * sp, Math.sin(a) * sp, sz, life * (0.6 + this.rnd() * 0.8), 0.9, lift * S, 900 * S * this.turbK, 0.8, 1);
  }

  // ── one-shots ──────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * An explosion of fire: `n` flame particles thrown out of a disc round (x, y), blooming against their drag, then
   * rising as they cool; embers flung up; smoke left behind as they die.
   */
  burst(x: number, y: number, o: FireBurst): void {
    if (this.destroyed) return;
    const S = this.S, r = this.rnd;
    const n = Math.max(0, Math.round(o.n));
    for (let i = 0; i < n; i++) {
      const a = o.dir === undefined ? r() * Math.PI * 2 : o.dir + (r() - 0.5) * (o.spread ?? Math.PI * 2);
      const d = o.rim ? o.radius * (0.92 + r() * 0.12) : o.radius * Math.sqrt(r());
      const sp = o.speed * (0.35 + r() * 0.85) * S;
      this.flame(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.cos(a) * sp, Math.sin(a) * sp, o.size, o.life,
        o.heat ?? 1, (o.lift ?? 420) * S * this.liftK, (o.turb ?? 300) * S * this.turbK, o.drag ?? 3, o.tongues ?? 0.25, o.body ?? 0.35,
        (o.smoke ?? 0.3) * this.smokeK);
    }
    this.embers(x, y, o.embers ?? 0, o.radius, { speed: o.emberSpeed ?? 360 });
  }

  /** Embers: small, hot, fluttering up and out. */
  embers(x: number, y: number, n: number, radius: number, o: { speed?: number; life?: number; lift?: number } = {}): void {
    const k = Math.max(0, Math.round(n * this.emberK));
    for (let i = 0; i < k; i++) {
      const a = this.rnd() * Math.PI * 2, d = radius * Math.sqrt(this.rnd());
      this.ember(x + Math.cos(a) * d, y + Math.sin(a) * d, o.speed ?? 200, o.life ?? 1100, o.lift ?? 160);
    }
  }

  /** Smoke billows rising off (x, y). */
  smokePuffs(x: number, y: number, n: number, o: { radius: number; size: number; life?: number; rise?: number; alpha?: number }): void {
    const S = this.S;
    const k = Math.max(0, Math.round(n * this.smokeK));
    for (let i = 0; i < k; i++) {
      const a = this.rnd() * Math.PI * 2, d = o.radius * Math.sqrt(this.rnd());
      this.spawn(K_SMOKE, x + Math.cos(a) * d, y + Math.sin(a) * d, Math.cos(a) * 30 * S, -(o.rise ?? 60) * (0.6 + this.rnd() * 0.6) * S,
        o.size * (0.7 + this.rnd() * 0.5), (o.life ?? 1300) * (0.75 + this.rnd() * 0.5), 0, 90 * S * this.liftK, 120 * S * this.turbK, 0.9, o.alpha ?? 0.42);
    }
  }

  // ── the frame ──────────────────────────────────────────────────────────────────────────────────────────────

  private emit(e: FireEmitter, dt: number): void {
    const S = this.S, r = this.rnd;
    const g = e.gust + this.clock * 0.001;
    // The gust: a slow wobble on the rate and the size (the fire breathing), never below 60 %.
    const gust = 0.8 + 0.12 * Math.sin(g * 5.3) + 0.08 * Math.sin(g * 13.1 + 1.7);
    const I = Math.max(0, e.intensity);
    e.acc += e.rate * I * gust * (dt / 1000);
    const lift = e.lift * S * this.liftK, turb = e.turb * S * this.turbK;
    const size = e.size * (0.55 + 0.45 * Math.min(1.6, I)) * gust;
    // A fast source (a fireball crossing the board in a third of a second) moves tens of px a frame: spread this frame's
    // births along the path it swept, so its trail is continuous, never beads. A jump (a teleport) is not swept.
    let sx = e.x - e.lx, sy = e.y - e.ly;
    if (!e.sweep || sx * sx + sy * sy > 640000 * S * S) { sx = 0; sy = 0; }
    let guard = 0;
    while (e.acc >= 1 && guard++ < 200) {
      e.acc -= 1;
      const f = r();
      let x = e.x - sx * f, y = e.y - sy * f, ox = 0, oy = 0;
      if (e.shape === 'ring') {
        const a = e.a0 + (e.a1 - e.a0) * r();
        ox = Math.cos(a); oy = Math.sin(a);
        x += ox * e.r; y += oy * e.r;
      } else if (e.shape === 'disc') {
        const a = r() * Math.PI * 2, d = e.r * Math.sqrt(r());
        ox = Math.cos(a); oy = Math.sin(a);
        x += ox * d; y += oy * d;
      } else if (e.shape === 'line') {
        const f = r();
        x += (e.x2 - e.x) * f + (r() - 0.5) * e.r; y += (e.y2 - e.y) * f + (r() - 0.5) * e.r;
      } else if (e.r > 0) {
        const a = r() * Math.PI * 2, d = e.r * Math.sqrt(r());
        x += Math.cos(a) * d; y += Math.sin(a) * d;
      }
      const sa = r() * Math.PI * 2, sp = e.speed * r() * S;
      const vx = (e.vx + e.out * ox) * S + Math.cos(sa) * sp;
      const vy = (e.vy + e.out * oy) * S + Math.sin(sa) * sp * 0.6 - e.speed * 0.4 * S;
      this.flame(x, y, vx, vy, size, e.life, e.heat, lift, turb, e.drag, e.tongues, e.body, e.smoke * this.smokeK);
    }
    if (e.acc > 1) e.acc = 0;
    e.lx = e.x; e.ly = e.y;
    if (e.embers > 0) {
      e.emberAcc += e.embers * I * (dt / 1000) * this.emberK;
      while (e.emberAcc >= 1) {
        e.emberAcc -= 1;
        let x = e.x, y = e.y;
        if (e.shape === 'ring') { const a = e.a0 + (e.a1 - e.a0) * r(); x += Math.cos(a) * e.r; y += Math.sin(a) * e.r; }
        else if (e.shape === 'line') { const f = r(); x += (e.x2 - e.x) * f; y += (e.y2 - e.y) * f; }
        else if (e.r > 0) { const a = r() * Math.PI * 2, d = e.r * Math.sqrt(r()); x += Math.cos(a) * d; y += Math.sin(a) * d; }
        this.ember(x, y, e.emberSpeed, 1000, 140);
      }
    }
  }

  /** Advance by `dt` ms. Returns whether anything still burns (or smokes, or emits). */
  update(dt: number): boolean {
    if (this.destroyed) return false;
    const step = Math.max(0, Math.min(100, Number.isFinite(dt) ? dt : 0));
    this.clock += step;
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i]!;
      if (!e.on) { this.emitters.splice(i, 1); continue; }
      if (Number.isFinite(e.hold)) {
        e.age += step;
        const u = (e.age - e.hold) / e.fade;
        if (u >= 1) { e.on = false; this.emitters.splice(i, 1); continue; }
        e.intensity = e.base * (u <= 0 ? 1 : (1 - u) * (1 - u));
      }
      this.emit(e, step);
    }
    const sec = step / 1000;
    const tc = this.clock;
    const S = this.S;
    const inv = 1 / Math.max(1e-6, S);
    const live = this.live;
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i]!;
      p.age += step;
      if (p.age >= p.life) {
        const dx = p.x, dy = p.y, sz = p.size, k = p.k, sm = p.smoke;
        this.release(i);
        // A dying flame may leave smoke where it burned out.
        if ((k === K_FLAME || k === K_TONGUE) && sm > 0 && this.rnd() < sm) {
          this.spawn(K_SMOKE, dx, dy, (this.rnd() - 0.5) * 30 * S, -(40 + this.rnd() * 40) * S, sz * 1.5, 1100 + this.rnd() * 700, 0, 70 * S * this.liftK, 110 * S * this.turbK, 0.9, 0.3);
        }
        continue;
      }
      const t = p.age / p.life;
      // Buoyancy (hot gas rises harder while it is hot), a travelling-sine curl field, drag.
      const xs = p.x * inv, ys = p.y * inv;
      const ax = p.turb * (0.7 * Math.sin(ys * 0.021 + tc * 0.0042 + p.ph) + 0.3 * Math.sin(ys * 0.047 - tc * 0.0071 + xs * 0.013));
      const ay = -p.lift * (1 - 0.45 * t) + p.turb * 0.3 * Math.cos(xs * 0.019 + tc * 0.0053 + p.ph);
      const damp = Math.exp(-p.drag * sec);
      p.vx = (p.vx + ax * sec) * damp;
      p.vy = (p.vy + ay * sec) * damp;
      p.x += p.vx * sec; p.y += p.vy * sec;
      const s = p.s!;
      s.position.set(p.x, p.y);
      const k = p.k;
      if (k === K_FLAME || k === K_TONGUE) {
        // Cooling: a hot particle starts white and ends deep red; a cooler one starts orange.
        const cool = (1 - p.heat) * 0.5 + t * (k === K_TONGUE ? 0.88 : 0.95);
        s.tint = this.lut[Math.min(FIRE_RAMP_STEPS - 1, Math.floor(clamp01(cool) * (FIRE_RAMP_STEPS - 1)))]!;
        const flick = 0.72 + 0.28 * Math.sin(p.age * 0.045 + p.ph) * Math.sin(p.age * 0.017 + p.ph * 1.7);
        const fadeIn = Math.min(1, t * 9);
        s.alpha = p.a * fadeIn * Math.pow(1 - t, 1.2) * flick;
        // Born small, swell, then shrink to nothing as it rises (the flame tapers to its tips).
        const grow = (0.55 + 0.9 * Math.sqrt(t)) * (1 - t * t);
        if (k === K_TONGUE) {
          // A tongue licks along the flow, but fire RISES: it leans with its motion and always points mostly up (a
          // burst's fast tongues would otherwise read as rays). Stretched a little more the faster it goes, capped.
          const fx = p.vx * 0.6, fy = Math.min(p.vy * 0.6 - 260 * S, -140 * S);
          const v = Math.hypot(p.vx, p.vy) * inv;
          s.rotation = Math.atan2(fy, fx) + Math.PI / 2;
          const wPx = p.size * grow * (0.88 + 0.12 * Math.sin(p.age * 0.06 + p.ph));
          const hPx = wPx * (1.6 + Math.min(0.8, v / 320));
          s.scale.set(wPx / FIRE_TONGUE_W, hPx / FIRE_TONGUE_H);
        } else {
          s.rotation += p.spin * step;
          s.scale.set((p.size * grow) / FIRE_PUFF_PX);
        }
      } else if (k === K_BODY) {
        const cool = (1 - p.heat) * 0.4 + t * 0.8;
        s.tint = this.bodyLut[Math.min(FIRE_RAMP_STEPS - 1, Math.floor(clamp01(cool) * (FIRE_RAMP_STEPS - 1)))]!;
        s.alpha = p.a * Math.min(1, t * 6) * Math.pow(1 - t, 1.5);
        s.rotation += p.spin * step;
        s.scale.set((p.size * (0.6 + 0.7 * Math.sqrt(t)) * (1 - 0.6 * t * t)) / FIRE_PUFF_PX);
      } else if (k === K_SMOKE) {
        s.tint = this.palette.smoke;
        // Smoke thickens as it leaves the flame, then thins as it spreads.
        s.alpha = p.a * Math.min(1, t * 3.5) * (1 - t) * (1 - t * 0.4);
        s.rotation += p.spin * step;
        s.scale.set((p.size * (0.55 + 1.3 * t)) / FIRE_SMOKE_PX);
      } else {
        // An ember: a hot dot that flutters and twinkles, cooling from yellow to red.
        p.vx += Math.sin(p.age * 0.011 + p.ph) * 60 * S * sec;
        s.tint = this.lut[Math.min(FIRE_RAMP_STEPS - 1, Math.floor((0.12 + t * 0.6) * (FIRE_RAMP_STEPS - 1)))]!;
        const tw = 0.6 + 0.4 * Math.sin(p.age * 0.05 + p.ph);
        s.alpha = p.a * tw * (1 - t * t);
        const v = Math.hypot(p.vx, p.vy) * inv;
        s.rotation = Math.atan2(p.vy, p.vx);
        const sc = (p.size * (1 - 0.5 * t)) / FIRE_EMBER_PX;
        s.scale.set(sc * (1 + Math.min(2.5, v / 260)), sc);
      }
    }
    return this.alive;
  }

  private release(i: number): void {
    const live = this.live;
    const p = live[i]!;
    const last = live.pop()!;
    if (last !== p) live[i] = last;
    if (p.s) { p.s.visible = false; this.freeSprites[p.layer]!.push(p.s); p.s = null; }
    this.freeRecs.push(p);
  }

  /** Put out every particle and emitter at once (a cancel). The pools are kept. */
  clear(): void {
    while (this.live.length) this.release(this.live.length - 1);
    for (const e of this.emitters) e.on = false;
    this.emitters.length = 0;
  }

  /** Tear down: every sprite destroyed, the containers destroyed. Textures are the caller's. */
  destroy(): void {
    if (this.destroyed) return;
    this.clear();
    this.destroyed = true;
    for (let i = 0; i < 4; i++) { this.freeSprites[i]!.length = 0; this.layers[i]!.removeChildren().forEach((c) => c.destroy()); }
    this.root.removeChildren();
    this.back.destroy({ children: true });
    this.front.destroy({ children: true });
    this.root.parent?.removeChild(this.root);
    this.root.destroy();
  }
}
