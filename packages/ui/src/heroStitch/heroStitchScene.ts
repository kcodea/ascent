/**
 * THE SOUL STITCH SCENE: everything Soul Stitch draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`),
 * so it runs (and is tested) headless. `heroStitch.ts` mounts `root` on the above-portrait overlay, calls `draw(t)` from
 * the one clock's paint, fires the beats (`pierce`, `tug`, `knotted`, `impact` ...) and feeds `update(dt)`.
 *
 * THE THREAD is the subject. Each needle carries one: a strip mesh (a violet glow under a lilac core) rebuilt every
 * frame from a polyline in fixed buffers: the TETHER (from the needle's spot on the striker's rim along the very path
 * the needle flew, so the thread is drawn along the needle's arc), then the STITCH (the path the needle has sewn so
 * far). Every point rides the portrait it is sewn into (the striker, or the target through its own stretch or crush),
 * so the thread stays tied to both heroes whatever they do. Once the needle pierces, the tether relaxes from its flight
 * arc into a hanging line (a little sag), twangs, and on the tug goes dead straight while a bead of light runs down it.
 *
 *  I-II  on the impact every thread SNAPS: the striker's half whips back, the rest is pulled out through the face.
 *  III   five pins hold the stretching portrait; on the impact all five rip out and every thread snaps.
 *  IV    the laces bind the portraits; the target is dragged into a gold HEART-KNOT (three gold thread loops drawn on
 *        and cinched round it, a violet crystal at the clasp); the strike sends beads down every lace; the knot bursts
 *        (its loops fly out and fade) in gold and violet soul ribbons (strip meshes sampled back along a curling flight).
 *
 * The NEEDLE is a painted crystal spike (point first, its thread out of the back) with a soft glow; it crystallises on
 * the striker's rim through the ready, flies, pierces, sews, and shatters on the impact (IV's tie off once laced).
 *
 * Perf: a thread mesh is 32 x 2 vertices (under Pixi's 100-vertex batch limit), its vertex arrays rewritten in place,
 * its UVs and indices shared; every polyline lives in preallocated typed arrays (no allocation per frame); sprites are
 * pooled under a hard cap; nothing loops a paint property.
 */
import { Container, MeshSimple, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, mixColor, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { KO_CYAN, KO_LILAC, KO_MAGENTA, KO_PRISM } from '../heroAttack/knockout';
import { RibbonTrail } from '../heroAttack/ribbonTrail';
import { flightProgress, knotAt, needleAt, sewProgress, tugAt, type StitchGeo, type StitchPlan } from './heroStitchConfig';
import { NEEDLE_TEX_W, SHARD_TEX } from './heroStitchTextures';

export interface HeroStitchTextures extends HeroArcanaTextures {
  needle: Texture;
  thread: Texture;
  shard: Texture;
}

export interface StitchColors { thread: number; lilac: number; deep: number; gold: number; bone: number; side: number }

export interface StitchLook {
  needleSize: number;
  needleGlow: number;
  threadWidth: number;
  threadGlow: number;
  sag: number;
  tautMs: number;
  twangPx: number;
  knotSize: number;
  ripRibbons: number;
  rainShards: number;
}

/** Hard cap on pooled sprites alive at once (IV's burst peaks well under it). */
export const MAX_STITCH_SPRITES = 520;
/** Points a thread strand is drawn with (x 2 vertices: under Pixi's 100-vertex batch limit). */
export const THREAD_PTS = 32;
/** The most points a thread's polyline holds (the tether, plus the longest sewn path). */
const SRC_CAP = 96;
/** The tether's samples along the flight arc. */
const TETHER_PTS = 16;
/** The heart-knot's samples per loop. */
const HEART_PTS = 64;
/** How many gold loops tie the heart-knot. */
export const KNOT_LOOPS = 3;
/** How long the snap (the halves whipping back, the rest fading) takes. */
export const SNAP_MS = 280;
/** Tier V: the latch needles (fast, re-stitching onto the flung target before the second yank). */
export const KO_LATCH_NEEDLES = 3;
/** Tier V: the latch threads part this fast on the slam. */
export const LATCH_SNAP_MS = 170;
/** A needle's length, px at stage scale 1 (x the size dial). */
const NEEDLE_PX = 104;
const GLOW_PX = 128;
const RING_PX = 160;
const STAR_PX = 48;

let sharedUvs: Float32Array | null = null;
let sharedIdx: Uint32Array | null = null;
function uvs(): Float32Array {
  if (sharedUvs) return sharedUvs;
  const u = new Float32Array(THREAD_PTS * 4);
  for (let j = 0; j < THREAD_PTS; j++) { const x = j / (THREAD_PTS - 1); u[j * 4] = x; u[j * 4 + 1] = 0; u[j * 4 + 2] = x; u[j * 4 + 3] = 1; }
  sharedUvs = u;
  return u;
}
function indices(): Uint32Array {
  if (sharedIdx) return sharedIdx;
  const idx = new Uint32Array((THREAD_PTS - 1) * 6);
  for (let j = 0; j < THREAD_PTS - 1; j++) { const a = j * 2; idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], j * 6); }
  sharedIdx = idx;
  return idx;
}

/** One drawn run of a thread: a glow mesh and a core mesh over the same resampled range. */
class Strand {
  readonly glow: MeshSimple;
  readonly core: MeshSimple;
  constructor(glowParent: Container, coreParent: Container, t: Texture) {
    this.glow = new MeshSimple({ texture: t, vertices: new Float32Array(THREAD_PTS * 4), uvs: uvs(), indices: indices() });
    this.core = new MeshSimple({ texture: t, vertices: new Float32Array(THREAD_PTS * 4), uvs: uvs(), indices: indices() });
    this.glow.blendMode = 'add';
    this.glow.visible = false; this.core.visible = false;
    glowParent.addChild(this.glow); coreParent.addChild(this.core);
  }
  hide(): void { this.glow.visible = false; this.core.visible = false; }
}

const rx = new Float32Array(THREAD_PTS);
const ry = new Float32Array(THREAD_PTS);

/** A thread: its polyline (fixed buffers) and two strands (one before the snap; both halves after). */
class Thread {
  readonly px: Float32Array;
  readonly py: Float32Array;
  readonly cum: Float32Array;
  n = 0;
  /** How many of the points are the tether (the rest is the stitch). */
  tetherN = 0;
  readonly a: Strand;
  readonly b: Strand;
  readonly bead: Sprite;
  constructor(glowParent: Container, coreParent: Container, beadParent: Container, t: Texture, beadTex: Texture, cap = SRC_CAP) {
    this.px = new Float32Array(cap); this.py = new Float32Array(cap); this.cum = new Float32Array(cap);
    this.a = new Strand(glowParent, coreParent, t);
    this.b = new Strand(glowParent, coreParent, t);
    this.bead = new Sprite(beadTex);
    this.bead.anchor.set(0.5); this.bead.blendMode = 'add'; this.bead.visible = false;
    beadParent.addChild(this.bead);
  }
  begin(): void { this.n = 0; }
  add(x: number, y: number): void {
    if (this.n >= this.px.length) return;
    const i = this.n;
    this.px[i] = x; this.py[i] = y;
    this.cum[i] = i === 0 ? 0 : this.cum[i - 1]! + Math.hypot(x - this.px[i - 1]!, y - this.py[i - 1]!);
    this.n++;
  }
  get length(): number { return this.n ? this.cum[this.n - 1]! : 0; }
  get tetherLength(): number { return this.tetherN ? this.cum[Math.min(this.n, this.tetherN) - 1]! : 0; }
  /** The point `s` px along the polyline. */
  at(s: number, out: Pt): Pt {
    const n = this.n;
    if (n === 0) { out.x = 0; out.y = 0; return out; }
    if (n === 1 || s <= 0) { out.x = this.px[0]!; out.y = this.py[0]!; return out; }
    let i = 1;
    while (i < n - 1 && this.cum[i]! < s) i++;
    const seg = Math.max(1e-6, this.cum[i]! - this.cum[i - 1]!);
    const f = Math.min(1, Math.max(0, (s - this.cum[i - 1]!) / seg));
    out.x = this.px[i - 1]! + (this.px[i]! - this.px[i - 1]!) * f;
    out.y = this.py[i - 1]! + (this.py[i]! - this.py[i - 1]!) * f;
    return out;
  }
  hide(): void { this.a.hide(); this.b.hide(); this.bead.visible = false; }
}

const tmp: Pt = { x: 0, y: 0 };
const tmpFoe: Pt = { x: 0, y: 0 };

/** A thread's twang: a standing wave set off at `at`, dying away (px x amp). */
function twangAt(t: number, at: number, amp: number): number {
  return t < at ? 0 : amp * Math.exp(-(t - at) / 170) * Math.sin(((t - at) / 1000) * Math.PI * 2 * 9);
}

/** The heart curve (unit size, point down, centred on its body: y spans about -0.85..0.85): x = 16 sin^3, y = -(13 cos - 5 cos 2 - 2 cos 3 - cos 4). */
function heartPt(th: number, out: Pt): Pt {
  const s = Math.sin(th);
  out.x = (16 * s * s * s) / 17;
  out.y = -(13 * Math.cos(th) - 5 * Math.cos(2 * th) - 2 * Math.cos(3 * th) - Math.cos(4 * th)) / 17 - 0.27;
  return out;
}

/** Draw a strand over [s0, s1] of `th`'s polyline: width `w` (core) and `gw` (glow), a whip wave of `wave` px. */
function drawStrand(st: Strand, th: Thread, s0: number, s1: number, w: number, gw: number, coreA: number, glowA: number, coreTint: number, glowTint: number, wave = 0, phase = 0): void {
  if (th.n < 2 || s1 - s0 < 0.5 || (coreA <= 0.002 && glowA <= 0.002)) { st.hide(); return; }
  for (let j = 0; j < THREAD_PTS; j++) {
    th.at(s0 + ((s1 - s0) * j) / (THREAD_PTS - 1), tmp);
    rx[j] = tmp.x; ry[j] = tmp.y;
  }
  const vg = st.glow.vertices as Float32Array;
  const vc = st.core.vertices as Float32Array;
  let lx = 0, ly = 1;
  for (let j = 0; j < THREAD_PTS; j++) {
    const a = Math.max(0, j - 1), b = Math.min(THREAD_PTS - 1, j + 1);
    const tx = rx[b]! - rx[a]!, ty = ry[b]! - ry[a]!;
    const l = Math.hypot(tx, ty);
    if (l > 0.01) { lx = -ty / l; ly = tx / l; }
    const f = j / (THREAD_PTS - 1);
    // The whip: a wave that grows toward the free end (f = 1 is the end being whipped).
    const off = wave ? wave * f * f * Math.sin(phase + f * 9) : 0;
    const x = rx[j]! + lx * off, y = ry[j]! + ly * off;
    // Thread ends taper a touch so a cut end reads as a frayed end, not a square.
    const taper = Math.min(1, 0.45 + 2.2 * Math.min(f, 1 - f) + 0.4);
    const hc = (w * 0.5) * taper, hg = (gw * 0.5) * taper;
    vc[j * 4] = x + lx * hc; vc[j * 4 + 1] = y + ly * hc; vc[j * 4 + 2] = x - lx * hc; vc[j * 4 + 3] = y - ly * hc;
    vg[j * 4] = x + lx * hg; vg[j * 4 + 1] = y + ly * hg; vg[j * 4 + 2] = x - lx * hg; vg[j * 4 + 3] = y - ly * hg;
  }
  st.core.alpha = coreA; st.core.tint = coreTint; st.core.visible = coreA > 0.002;
  st.glow.alpha = glowA; st.glow.tint = glowTint; st.glow.visible = glowA > 0.002;
}

interface NeedleSprites { body: Sprite; glow: Sprite }

/** Tier V: one latch: a fast needle and its thread, from the striker's rim to the flung target's (`fan` round its face). */
interface Latch { th: Thread; needle: NeedleSprites; fan: number }

interface Ribbon { trail: RibbonTrail; age: number; life: number; cx: number; cy: number; dx: number; dy: number; reach: number; curl: number; w: number; phase: number; width: number }

/**
 * What the runner hands `draw` each frame: the two portraits' offsets (overlay px) and, optionally, the struck
 * portrait's own linear transform about its centre (III's stretch, IV's crush), [a, b, c, d] for x' = a x + b y,
 * y' = c x + d y. Everything sewn into the target goes through it, so the pins and laces stay ON the portrait.
 */
export interface StitchFrame { heroX: number; heroY: number; foeX: number; foeY: number; foeM?: readonly [number, number, number, number] }

const IDENTITY: readonly [number, number, number, number] = [1, 0, 0, 1];

export class HeroStitchScene extends FxPool {
  private readonly threadGlowC = new Container();
  private readonly threadCoreC = new Container();
  private readonly needleC = new Container();
  private readonly threads: Thread[] = [];
  private readonly needles: NeedleSprites[] = [];
  /** IV: the heart-knot's gold loops and its violet crystal clasp. */
  private readonly knot: Thread[] = [];
  private gem: Sprite | null = null;
  private gemGlow: Sprite | null = null;
  /** IV: the gold glow pulsing under the knot as it cinches (alpha and scale only: no paint property). */
  private knotGlow: Sprite | null = null;
  /** IV: where the knot burst (the target's offset at the burst): the bursting loops stay there as it is flung home. */
  private burstOff: Pt | null = null;
  private ribbons: Ribbon[] = [];
  private readonly ribbonPool: RibbonTrail[] = [];
  /** Tier V: the latch needles and their threads (empty on every other tier). */
  private readonly latch: Latch[] = [];
  private ownOn = true;
  /** The last frame drawn (the impact bursts where things were last drawn). */
  private last: StitchFrame = { heroX: 0, heroY: 0, foeX: 0, foeY: 0 };

  constructor(
    private readonly tex: HeroStitchTextures,
    private readonly colors: StitchColors,
    private readonly look: StitchLook,
    private readonly plan: StitchPlan,
    private readonly geo: StitchGeo,
    /** The struck portrait's centre and radius (the knot is tied round it). */
    private readonly foe: { x: number; y: number; r: number } = { x: 0, y: 0, r: 80 },
    scale = 1,
    seed = 1,
  ) {
    super('heroStitch', [tex.glow, tex.ring, tex.star, tex.spark, tex.streak, tex.shard, tex.needle, tex.thread, tex.ribbonBody], scale, seed, MAX_STITCH_SPRITES);
    // Threads draw over the struck portrait's FX but under the needles and the brightest flashes.
    this.threadGlowC.label = 'heroStitch-threadGlow';
    this.threadCoreC.label = 'heroStitch-threadCore';
    this.needleC.label = 'heroStitch-needles';
    this.root.addChildAt(this.threadGlowC, 3);
    this.root.addChildAt(this.threadCoreC, 4);
    this.root.addChildAt(this.needleC, 5);
    for (let i = 0; i < plan.needles.length; i++) {
      this.threads.push(new Thread(this.threadGlowC, this.threadCoreC, this.needleC, tex.thread, tex.glow));
      const glow = new Sprite(tex.glow);
      glow.anchor.set(0.5); glow.blendMode = 'add'; glow.tint = colors.thread; glow.visible = false;
      const body = new Sprite(tex.needle);
      // Anchored near the point: the needle's position IS its tip (what pierces), the thread trails out of its back.
      body.anchor.set(0.93, 0.5); body.visible = false;
      this.needleC.addChild(glow, body);
      this.needles.push({ body, glow });
    }
    if (plan.kind === 'bound') {
      for (let k = 0; k < KNOT_LOOPS; k++) this.knot.push(new Thread(this.threadGlowC, this.threadCoreC, this.needleC, tex.thread, tex.glow, HEART_PTS + 1));
      this.gemGlow = new Sprite(tex.glow);
      this.gemGlow.anchor.set(0.5); this.gemGlow.blendMode = 'add'; this.gemGlow.tint = colors.thread; this.gemGlow.visible = false;
      this.gem = new Sprite(tex.shard);
      this.gem.anchor.set(0.5); this.gem.tint = colors.thread; this.gem.visible = false;
      this.needleC.addChild(this.gemGlow, this.gem);
      this.knotGlow = new Sprite(tex.glow);
      this.knotGlow.anchor.set(0.5); this.knotGlow.blendMode = 'add'; this.knotGlow.tint = colors.gold; this.knotGlow.visible = false;
      this.threadGlowC.addChildAt(this.knotGlow, 0);
    }
    if (plan.ko) {
      for (let i = 0; i < KO_LATCH_NEEDLES; i++) {
        const th = new Thread(this.threadGlowC, this.threadCoreC, this.needleC, tex.thread, tex.glow, TETHER_PTS + 2);
        const glow = new Sprite(tex.glow);
        glow.anchor.set(0.5); glow.blendMode = 'add'; glow.tint = colors.gold; glow.visible = false;
        const body = new Sprite(tex.needle);
        body.anchor.set(0.93, 0.5); body.visible = false;
        this.needleC.addChild(glow, body);
        this.latch.push({ th, needle: { body, glow }, fan: KO_LATCH_NEEDLES <= 1 ? 0 : -0.55 + (1.1 * i) / (KO_LATCH_NEEDLES - 1) });
      }
    }
  }

  /** Thread meshes alive (two strands x glow + core per thread, the knot's loops included). Exposed for tests. */
  get threadMeshes(): number { return (this.threads.length + this.knot.length + this.latch.length) * 4; }
  /** Tier V: the latch threads drawing this frame. */
  get visibleLatches(): number { let n = 0; for (const l of this.latch) n += l.th.a.core.visible ? 1 : 0; return n; }
  /** Strand meshes drawing this frame (the needles' threads). */
  get visibleStrands(): number { let n = 0; for (const th of this.threads) n += (th.a.core.visible ? 1 : 0) + (th.b.core.visible ? 1 : 0); return n; }
  /** The heart-knot's loops drawing this frame. */
  get visibleKnotLoops(): number { let n = 0; for (const th of this.knot) n += th.a.core.visible || th.b.core.visible ? 1 : 0; return n; }
  get liveRibbons(): number { return this.ribbons.length; }
  /** A thread's current polyline length (px), for tests. */
  threadLength(i: number): number { return this.threads[i]?.length ?? 0; }
  /** A thread's first and last points, for tests. */
  threadEnds(i: number): { a: Pt; b: Pt } | null {
    const th = this.threads[i];
    if (!th || th.n < 1) return null;
    return { a: { x: th.px[0]!, y: th.py[0]! }, b: { x: th.px[th.n - 1]!, y: th.py[th.n - 1]! } };
  }
  /** A thread's i-th polyline point (tests). */
  threadPoint(i: number, j: number): Pt | null { const th = this.threads[i]; return th && j < th.n ? { x: th.px[j]!, y: th.py[j]! } : null; }
  /** Where a point sewn into the target is drawn this frame (its offset and its own stretch / crush applied). */
  foePoint(x: number, y: number, f: StitchFrame = this.last, out: Pt = { x: 0, y: 0 }): Pt {
    const m = f.foeM ?? IDENTITY, cx = this.foe.x, cy = this.foe.y;
    const dx = x - cx, dy = y - cy;
    out.x = cx + m[0] * dx + m[1] * dy + f.foeX;
    out.y = cy + m[2] * dx + m[3] * dy + f.foeY;
    return out;
  }
  /** Where needle i is drawn (its tip), or null when hidden. */
  needleTip(i: number): Pt | null { const n = this.needles[i]; return n && n.body.visible ? { x: n.body.position.x, y: n.body.position.y } : null; }

  // ── the frame (called from the clock's paint, so it is a pure function of the time) ─────────────────────────────

  draw(t: number, f: StitchFrame): void {
    if (this.destroyed || !this.ownOn) return;
    this.setFoeOffset(f.foeX, f.foeY);
    this.last = f;
    const p = this.plan, g = this.geo, L = this.look, c = this.colors, S = this.scale;
    const tug = tugAt(p, t);
    const snapK = t >= p.burstAt ? clamp01((t - p.burstAt) / SNAP_MS) : 0;
    const fp = tmpFoe;
    // IV: the strike sends beads down every lace (0..1 from the strike to the burst).
    const strike = p.strikeAt !== null && t >= p.strikeAt && t < p.burstAt ? (t - p.strikeAt) / Math.max(1, p.burstAt - p.strikeAt) : -1;
    const hx = f.heroX, hy = f.heroY;
    for (let i = 0; i < p.needles.length; i++) {
      const q = p.needles[i]!, n = g.needles[i]!, th = this.threads[i]!, ns = this.needles[i]!;
      // ── the needle ──
      const st = needleAt(p, g, i, t);
      const e = flightProgress(q, t);
      if (st.visible) {
        // Crystallising on the rim through the ready: grows in, brightening.
        const grow = t < q.launchAt ? clamp01((t - p.chargeAt) / Math.max(1, (q.launchAt - p.chargeAt) * 0.7)) : 1;
        const k = (NEEDLE_PX * L.needleSize * S) / NEEDLE_TEX_W;
        const sc = k * (0.25 + 0.75 * grow);
        // It rides what it is sewn into (the striker before it flies, the target once in, a blend in between).
        let x = st.x + hx + (f.foeX - hx) * st.on, y = st.y + hy + (f.foeY - hy) * st.on;
        if (st.on >= 1 && f.foeM) { this.foePoint(st.x, st.y, f, fp); x = fp.x; y = fp.y; }
        ns.body.visible = true; ns.body.position.set(x, y); ns.body.rotation = st.rot;
        ns.body.scale.set(sc * (st.flying ? 1.12 : 1), sc * (st.flying ? 0.85 : 1)); // a stretch in flight
        ns.body.alpha = grow * (p.kind === 'bound' && t > q.sewEnd ? 1 - clamp01((t - q.sewEnd) / 120) : 1);
        ns.glow.visible = true; ns.glow.position.set(x - Math.cos(st.rot) * sc * NEEDLE_TEX_W * 0.4, y - Math.sin(st.rot) * sc * NEEDLE_TEX_W * 0.4);
        ns.glow.scale.set((NEEDLE_PX * 1.2 * L.needleSize * S) / GLOW_PX, (NEEDLE_PX * 0.5 * L.needleSize * S) / GLOW_PX);
        ns.glow.rotation = st.rot;
        ns.glow.alpha = L.needleGlow * (t < q.launchAt ? 0.5 + 0.5 * Math.sin(Math.PI * grow) : 0.75 + 0.25 * tug) * ns.body.alpha;
      } else { ns.body.visible = false; ns.glow.visible = false; }
      // ── the thread ──
      if (t < q.launchAt || t >= p.burstAt + SNAP_MS) { th.hide(); continue; }
      th.begin();
      const arrived = t >= q.arriveAt;
      const taut = arrived ? clamp01((t - q.arriveAt) / Math.max(1, L.tautMs)) : 0;
      const sx = n.spot.x, sy = n.spot.y, ex = n.entry.x, ey = n.entry.y;
      const len = Math.hypot(ex - sx, ey - sy) || 1;
      const nx = -(ey - sy) / len, ny = (ex - sx) / len;
      const sag = len * L.sag * (1 - tug) * (arrived ? 1 : 0);
      // The twang on piercing and again on the tug: a standing wave that dies away.
      const twang = L.twangPx * S * (twangAt(t, q.arriveAt, 1) + twangAt(t, p.tugAt, 1.3));
      const on0 = n.sewAt[0]!;
      // The target's own stretch / crush moves the end sewn into it: spread that along the tether toward the striker.
      let ddx = 0, ddy = 0;
      if (arrived && on0 >= 1 && f.foeM) { this.foePoint(ex, ey, f, fp); ddx = fp.x - f.foeX - ex; ddy = fp.y - f.foeY - ey; }
      for (let j = 0; j < TETHER_PTS; j++) {
        const fj = j / (TETHER_PTS - 1);
        // Before it arrives the thread is the needle's own path so far; then it relaxes from that arc into a line.
        const ee = arrived ? fj : e * fj, me = 1 - ee;
        const cx = me * me * sx + 2 * me * ee * n.ctrl.x + ee * ee * ex, cy = me * me * sy + 2 * me * ee * n.ctrl.y + ee * ee * ey;
        let x = cx, y = cy;
        if (arrived) {
          const lx2 = sx + (ex - sx) * fj, ly2 = sy + (ey - sy) * fj;
          const hang = 4 * fj * (1 - fj);
          x = cx + (lx2 - cx) * taut;
          y = cy + (ly2 - cy) * taut + sag * hang * taut;
          const wv = twang * Math.sin(Math.PI * fj);
          x += nx * wv; y += ny * wv;
        }
        // The ends ride their portraits (the striker's rim, and whatever the needle went into).
        const fo = (arrived ? fj : fj * e) * on0;
        th.add(x + hx + (f.foeX - hx) * fo + ddx * fj, y + hy + (f.foeY - hy) * fo + ddy * fj);
      }
      th.tetherN = th.n;
      // The stitch: what the needle has sewn so far, each point riding what it is sewn into.
      if (arrived && n.sew.length > 1) {
        const total = n.sewLen[n.sewLen.length - 1]!;
        const sNow = sewProgress(q, t) * total;
        let j = 1;
        for (; j < n.sew.length && n.sewLen[j]! <= sNow; j++) {
          const w = n.sewAt[j]!;
          if (w >= 1 && f.foeM) { this.foePoint(n.sew[j]!.x, n.sew[j]!.y, f, fp); th.add(fp.x, fp.y); continue; }
          th.add(n.sew[j]!.x + hx + (f.foeX - hx) * w, n.sew[j]!.y + hy + (f.foeY - hy) * w);
        }
        if (j < n.sew.length) {
          const a0 = n.sew[j - 1]!, b0 = n.sew[j]!;
          const fr = (sNow - n.sewLen[j - 1]!) / Math.max(1e-6, n.sewLen[j]! - n.sewLen[j - 1]!);
          const w = n.sewAt[j - 1]! + (n.sewAt[j]! - n.sewAt[j - 1]!) * fr;
          th.add(a0.x + (b0.x - a0.x) * fr + hx + (f.foeX - hx) * w, a0.y + (b0.y - a0.y) * fr + hy + (f.foeY - hy) * w);
        }
      }
      // ── draw it ──
      const w = L.threadWidth * S * (1 + 0.6 * tug);
      const gw = w * 3.4;
      const coreTint = whiten(c.lilac, 0.6 * tug);
      const glowTint = mixColor(c.thread, c.lilac, 0.35 * tug);
      const glowA = L.threadGlow * (0.55 + 0.45 * tug);
      const total = th.length, tl = th.tetherLength;
      if (snapK <= 0) {        drawStrand(th.a, th, 0, total, w, gw, 1, glowA, coreTint, glowTint);
        th.b.hide();
        // The tug: a bead of light runs down the tether from the striker to the target. IV: the strike sends one down
        // every lace (tether and legs) at once.
        if (strike >= 0 && total > 1) {
          th.at(total * strike, tmp);
          th.bead.visible = true; th.bead.position.set(tmp.x, tmp.y);
          th.bead.scale.set(((28 + 22 * strike) * S) / GLOW_PX);
          th.bead.tint = mixColor(c.lilac, c.gold, 0.5); th.bead.alpha = 0.95;
        } else if (tug > 0 && tug < 1 && tl > 1) {
          const u = tug % 1;
          th.at(tl * u, tmp);
          th.bead.visible = true; th.bead.position.set(tmp.x, tmp.y);
          th.bead.scale.set(((22 + 18 * tug) * S) / GLOW_PX);
          th.bead.tint = c.lilac; th.bead.alpha = 0.9 * Math.sin(Math.PI * u);
        } else th.bead.visible = false;
      } else {
        // THE SNAP: it parts halfway along the tether; the striker's half whips back home, the rest is pulled through
        // (II) or fades (I, IV), all inside SNAP_MS.
        const mid = tl * 0.5;
        const ease = 1 - (1 - snapK) * (1 - snapK);
        const fade = 1 - snapK;
        drawStrand(th.a, th, 0, Math.max(0, mid * (1 - ease)), w, gw, fade, glowA * fade, c.lilac, c.thread, 26 * S * snapK, t * 0.05);
        const from = p.kind === 'cross' ? mid + (total - mid) * ease : mid + (tl - mid) * ease;
        drawStrand(th.b, th, from, total, w * (1 + 0.5 * snapK), gw, fade, glowA * fade * (1 + snapK), whiten(c.lilac, 0.5 * fade), c.thread);
        th.bead.visible = false;
      }
    }
    if (p.kind === 'bound') this.drawKnot(t, f, snapK);
    if (this.latch.length) this.drawLatch(t, f);
  }

  /**
   * TIER V: THE LATCH. As the burst flings the target home, fast gold-cored needles fly off the striker's rim and bite
   * into the target's face (a fan facing the striker); their threads go taut and a bead of light races down each on the
   * second yank, the two portraits hauled together; on the slam every thread snaps and whips away. Both ends ride their
   * portraits every frame (the offsets the runner hands `draw`).
   */
  private drawLatch(t: number, f: StitchFrame): void {
    const p = this.plan, g = this.geo, L = this.look, c = this.colors, S = this.scale;
    const la = p.koLatchAt, ld = p.koLatchedAt;
    const hide = (l: Latch): void => { l.th.hide(); l.needle.body.visible = false; l.needle.glow.visible = false; };
    if (la === null || ld === null || t < la || t >= p.impactAt + LATCH_SNAP_MS) { for (const l of this.latch) hide(l); return; }
    const u = g.u, nrm = g.nrm;
    const face = Math.atan2(u.y, u.x), back = face + Math.PI;
    const fr = this.foe.r;
    const e = clamp01((t - la) / Math.max(1, ld - la));
    const fly = 1 - (1 - e) * (1 - e);
    const yank = t >= ld && t < p.impactAt ? (t - ld) / Math.max(1, p.impactAt - ld) : t >= p.impactAt ? 1 : 0;
    const snapK = t >= p.impactAt ? clamp01((t - p.impactAt) / LATCH_SNAP_MS) : 0;
    const k = (NEEDLE_PX * L.needleSize * S * 0.85) / NEEDLE_TEX_W;
    for (let i = 0; i < this.latch.length; i++) {
      const l = this.latch[i]!;
      const spot = g.needles[Math.min(g.needles.length - 1, Math.round((i / Math.max(1, this.latch.length - 1)) * (g.needles.length - 1)))]?.spot;
      if (!spot) { hide(l); continue; }
      // The striker's end rides the striker; the target's end is a point on its rim facing the striker, riding it.
      const ax = spot.x + f.heroX, ay = spot.y + f.heroY;
      const bx = this.foe.x + Math.cos(back + l.fan) * fr * 0.9 + f.foeX, by = this.foe.y + Math.sin(back + l.fan) * fr * 0.9 + f.foeY;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      // In flight: the needle runs a shallow arc to the bite; the thread trails it, slack, then snaps taut.
      const bow = len * 0.12 * (i - (this.latch.length - 1) / 2) * Math.sin(Math.PI * fly);
      const tipX = ax + (bx - ax) * fly + nrm.x * bow, tipY = ay + (by - ay) * fly + nrm.y * bow;
      const rot = Math.atan2(by - ay, bx - ax);
      const nb = l.needle;
      const on = snapK <= 0;
      nb.body.visible = on; nb.glow.visible = on;
      if (on) {
        nb.body.position.set(tipX, tipY); nb.body.rotation = rot;
        nb.body.scale.set(k * (e < 1 ? 1.15 : 1), k * (e < 1 ? 0.82 : 1)); nb.body.alpha = 1;
        nb.glow.position.set(tipX - Math.cos(rot) * k * NEEDLE_TEX_W * 0.4, tipY - Math.sin(rot) * k * NEEDLE_TEX_W * 0.4);
        nb.glow.scale.set((NEEDLE_PX * 1.3 * L.needleSize * S) / GLOW_PX, (NEEDLE_PX * 0.55 * L.needleSize * S) / GLOW_PX);
        nb.glow.rotation = rot; nb.glow.alpha = L.needleGlow * (0.8 + 0.2 * yank);
      }
      // The thread: from the striker's rim to the needle (taut and humming on the yank).
      const th = l.th;
      th.begin();
      const ex = on ? tipX : bx, ey = on ? tipY : by;
      const tl = Math.hypot(ex - ax, ey - ay) || 1;
      const nx = -(ey - ay) / tl, ny = (ex - ax) / tl;
      const slack = e < 1 ? 0.1 * tl * (1 - e) : 0;
      const hum = yank > 0 && yank < 1 ? 3 * S * Math.sin(t * 0.09 + i) : 0;
      for (let j = 0; j < TETHER_PTS; j++) {
        const fj = j / (TETHER_PTS - 1), hang = 4 * fj * (1 - fj);
        th.add(ax + (ex - ax) * fj + nx * (slack + hum) * hang, ay + (ey - ay) * fj + ny * (slack + hum) * hang + slack * hang * 0.5);
      }
      th.tetherN = th.n;
      const w = L.threadWidth * S * (1.2 + 0.6 * yank);
      const total = th.length;
      if (snapK <= 0) {
        drawStrand(th.a, th, 0, total, w, w * 3.4, 1, L.threadGlow * (0.6 + 0.4 * yank), whiten(c.gold, 0.4 + 0.4 * yank), mixColor(c.thread, c.gold, 0.45));
        th.b.hide();
        if (yank > 0 && yank < 1 && total > 1) {
          th.at(total * yank, tmp);
          th.bead.visible = true; th.bead.position.set(tmp.x, tmp.y);
          th.bead.scale.set(((26 + 20 * yank) * S) / GLOW_PX);
          th.bead.tint = mixColor(c.lilac, c.gold, 0.6); th.bead.alpha = 0.95;
        } else th.bead.visible = false;
      } else {
        // THE SNAP: parted at the middle, both halves whip back to their ends and fade.
        const ease = 1 - (1 - snapK) * (1 - snapK), fade = 1 - snapK, mid = total * 0.5;
        drawStrand(th.a, th, 0, Math.max(0, mid * (1 - ease)), w, w * 3.4, fade, L.threadGlow * fade, c.gold, c.thread, 24 * S * snapK, t * 0.05);
        drawStrand(th.b, th, mid + (total - mid) * ease, total, w, w * 3.4, fade, L.threadGlow * fade, c.gold, c.thread);
        th.bead.visible = false;
      }
    }
  }

  /**
   * IV: the HEART-KNOT. From the knot beat, three gold loops are drawn on round the dragged portrait (one after the
   * other), each cinching in from wide to snug (and the struck portrait is crushed small with them, in the runner); a
   * violet crystal clasp flashes in where the lobes meet once it is tied. On the burst the loops fly outward and fade.
   */
  private drawKnot(t: number, f: StitchFrame, snapK: number): void {
    const p = this.plan, c = this.colors, L = this.look, S = this.scale;
    if (p.knotAt === null || t < p.knotAt || t >= p.burstAt + SNAP_MS) {
      for (const k of this.knot) k.hide();
      if (this.gem) this.gem.visible = false;
      if (this.gemGlow) this.gemGlow.visible = false;
      if (this.knotGlow) this.knotGlow.visible = false;
      return;
    }
    const tie = knotAt(p, t);
    const ox = snapK > 0 && this.burstOff ? this.burstOff.x : f.foeX, oy = snapK > 0 && this.burstOff ? this.burstOff.y : f.foeY;
    const cx = this.foe.x + ox, cy = this.foe.y + oy;
    const base = this.foe.r * L.knotSize;
    const draw = p.strikeAt !== null ? clamp01((t - p.knotAt) / Math.max(1, (p.strikeAt - p.knotAt) * 0.75)) : 1;
    const burst = snapK > 0 ? 1 + 0.9 * (1 - (1 - snapK) * (1 - snapK)) : 1;
    const fade = 1 - snapK;
    const strain = p.strikeAt !== null && t >= p.strikeAt && t < p.burstAt ? (t - p.strikeAt) / Math.max(1, p.burstAt - p.strikeAt) : 0;
    for (let k = 0; k < this.knot.length; k++) {
      const th = this.knot[k]!;
      // Each loop is drawn on after the one before, wide, then cinches snug as the knot ties.
      const prog = snapK > 0 ? 1 : clamp01(draw * 1.6 - k * 0.3);
      const wide = 1.55 - 0.55 * tie - 0.08 * k + 0.06 * strain * Math.sin(t * 0.09 + k);
      const r = base * wide * (0.94 + 0.06 * k) * burst * (1 - 0.04 * k);
      const rot = (k - 1) * 0.11;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      th.begin();
      for (let j = 0; j <= HEART_PTS; j++) {
        heartPt((j / HEART_PTS) * Math.PI * 2, tmp);
        const x = tmp.x * r, y = tmp.y * r;
        th.add(cx + x * cr - y * sr, cy + x * sr + y * cr);
      }
      if (prog <= 0) { th.hide(); continue; }
      const w = L.threadWidth * S * (1.9 + 0.5 * tie);
      drawStrand(th.a, th, 0, th.length * prog, w, w * 3.6, fade, L.threadGlow * (0.7 + 0.3 * tie) * fade, whiten(c.gold, 0.25 + 0.4 * strain), mixColor(c.gold, c.thread, 0.35));
      th.b.hide();
      th.bead.visible = false;
    }
    // A gold glow pulses under the knot as it cinches, quickening and swelling into the strike.
    if (this.knotGlow) {
      const on = snapK <= 0 && t < p.burstAt;
      this.knotGlow.visible = on;
      if (on) {
        const since = t - p.knotAt;
        const beat = 0.5 + 0.5 * Math.sin(since * (0.012 + 0.02 * strain + 0.006 * tie));
        this.knotGlow.position.set(cx, cy);
        this.knotGlow.scale.set((base * (2.6 + 0.5 * beat + 0.8 * strain)) / GLOW_PX);
        this.knotGlow.alpha = Math.min(1, 0.18 + 0.32 * tie + 0.25 * beat * tie + 0.3 * strain);
      }
    }
    // The clasp: a violet crystal where the lobes meet, once the knot is tied.
    if (this.gem && this.gemGlow) {
      const on = p.strikeAt !== null && t >= p.strikeAt - 1 && snapK <= 0;
      this.gem.visible = on; this.gemGlow.visible = on;
      if (on) {
        const r = base * (1.55 - 0.55 * tie);
        const gx = cx, gy = cy - 0.564 * r; // the cusp where the two lobes meet
        const pop = clamp01((t - (p.strikeAt! - 1)) / 120);
        this.gem.position.set(gx, gy); this.gem.rotation = Math.PI / 4;
        this.gem.scale.set(((this.foe.r * 0.55 * (0.6 + 0.4 * pop)) / SHARD_TEX) * (1 + 0.12 * strain));
        this.gem.alpha = pop;
        this.gemGlow.position.set(gx, gy);
        this.gemGlow.scale.set((this.foe.r * (0.9 + 0.6 * strain)) / GLOW_PX);
        this.gemGlow.alpha = 0.7 * pop;
      }
    }
  }

  // ── the beats ────────────────────────────────────────────────────────────────────────────────────────────────

  /** The ready: a soft violet bloom on the striker's rim where the needles crystallise. */
  summon(at: Pt, radius: number): void {
    const c = this.colors, S = this.scale;
    this.spawn('glow', this.tex.ring, c.thread, at.x, at.y, { dur: 520, from: (radius * 2.6) / RING_PX, to: (radius * 1.9) / RING_PX, a0: 0.55, mode: 'punch', peakAt: 0.4 });
    for (const n of this.geo.needles) {
      this.spawn('core', this.tex.star, c.lilac, n.spot.x, n.spot.y, { dur: 420, from: 0.1, to: (34 * S) / STAR_PX, a0: 0.9, mode: 'punch', peakAt: 0.55 });
      this.burst('core', this.tex.spark, [c.lilac, c.thread], n.spot.x, n.spot.y, 3, { speed: -90, life: 380, size: 0.25 });
    }
  }

  /** A needle leaves: a snap of light at its spot. */
  launch(i: number): void {
    const n = this.geo.needles[i];
    if (!n) return;
    const c = this.colors;
    this.spawn('core', this.tex.glow, c.lilac, n.spot.x, n.spot.y, { dur: 160, from: 0.15, to: 0.5, a0: 0.8 });
  }

  /** A needle pierces the face (a tick): a crystal flash, a ring, a few chips. `follow`: it rides the target. */
  pierce(at: Pt, dir: Pt, strength: number, follow = true): void {
    const c = this.colors, S = this.scale, k = strength;
    this.spawn('core', this.tex.star, c.lilac, at.x, at.y, { dur: 260, from: (20 * k * S) / STAR_PX, to: (78 * k * S) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.12, rot: Math.atan2(dir.y, dir.x), follow });
    this.spawn('glow', this.tex.ring, c.thread, at.x, at.y, { dur: 300, from: (18 * k * S) / RING_PX, to: (110 * k * S) / RING_PX, a0: 0.85, ease: 'cubic', follow });
    this.burst('body', this.tex.shard, [c.thread, c.lilac], at.x, at.y, Math.round(4 * k), { speed: 300 * k, dir: Math.atan2(-dir.y, -dir.x), spread: 2.2, life: 380, size: (12 * S) / SHARD_TEX, grav: 700, spin: 0.03 });
  }

  /** A needle finishes sewing (II's diagonals, IV's laces): a tie-off glint. */
  sewn(at: Pt, follow = true): void {
    const c = this.colors, S = this.scale;
    this.spawn('core', this.tex.star, c.bone, at.x, at.y, { dur: 240, from: (8 * S) / STAR_PX, to: (34 * S) / STAR_PX, a0: 0.9, mode: 'punch', peakAt: 0.3, rot: 0.6, follow });
  }

  /** The tug (I-III) or the yank (IV): the hero takes the thread: a flash at the striker's rim. */
  tug(at: Pt, radius: number, big: boolean): void {
    const c = this.colors;
    this.spawn('glow', this.tex.ring, c.gold, at.x, at.y, { dur: big ? 520 : 320, from: (radius * 1.2) / RING_PX, to: (radius * (big ? 3.2 : 2.4)) / RING_PX, a0: 0.75, ease: 'cubic' });
    this.spawn('core', this.tex.glow, c.lilac, at.x, at.y, { dur: 220, from: (radius * 0.6) / GLOW_PX, to: (radius * 1.6) / GLOW_PX, a0: 0.6, mode: 'punch', peakAt: 0.2 });
  }

  /** IV: the target arrives in the knot: a gold ring snaps in round it (it rides the dragged portrait). */
  knotted(at: Pt): void {
    const c = this.colors, r = this.foe.r;
    this.spawn('glow', this.tex.ring, c.gold, at.x, at.y, { dur: 420, from: (r * 4) / RING_PX, to: (r * 2.4) / RING_PX, a0: 0.9, mode: 'punch', peakAt: 0.2, follow: true });
    this.spawn('glow', this.tex.glow, c.gold, at.x, at.y, { dur: 360, from: (r * 1.4) / GLOW_PX, to: (r * 2.8) / GLOW_PX, a0: 0.45, mode: 'punch', peakAt: 0.2, follow: true });
  }

  /** IV: a cinch of the knot (a tick): a gold pulse ring tightening in and sparks thrown off the heart. */
  cinch(at: Pt, k: number): void {
    const c = this.colors, r = this.foe.r * this.look.knotSize, S = this.scale;
    this.spawn('glow', this.tex.ring, c.gold, at.x, at.y, { dur: 300, from: (r * 3.4) / RING_PX, to: (r * 2) / RING_PX, a0: 0.7 + 0.1 * k, mode: 'punch', peakAt: 0.25, follow: true });
    this.burst('core', this.tex.spark, [c.gold, c.bone, c.lilac], at.x, at.y - r * 0.2, 6 + 2 * k, { speed: (260 + 60 * k) * S, life: 380, size: 0.3, drag: 0.2, lift: 120 * S });
    this.burst('core', this.tex.star, [c.gold, c.bone], at.x, at.y, 2 + k, { speed: 200 * S, life: 300, size: (22 * S) / STAR_PX });
  }

  /**
   * TIER V: the DOUBLE-CINCH. The knot squeezes once more, hard: a prismatic pulse ring snapping in round it (cyan, then
   * magenta), a white-hot flash, and a spray of prism sparks off the heart. It rides the dragged portrait.
   */
  koCinch(at: Pt): void {
    const c = this.colors, r = this.foe.r * this.look.knotSize, S = this.scale;
    this.spawn('core', this.tex.glow, c.bone, at.x, at.y, { dur: 200, from: (r * 1.2) / GLOW_PX, to: (r * 3) / GLOW_PX, a0: 0.75, mode: 'punch', peakAt: 0.15, follow: true });
    this.spawn('glow', this.tex.ring, KO_CYAN, at.x, at.y, { dur: 320, from: (r * 4.4) / RING_PX, to: (r * 1.8) / RING_PX, a0: 1, mode: 'punch', peakAt: 0.2, follow: true });
    this.spawn('glow', this.tex.ring, KO_MAGENTA, at.x, at.y, { dur: 380, from: (r * 5.2) / RING_PX, to: (r * 2.1) / RING_PX, a0: 0.85, mode: 'punch', peakAt: 0.25, delay: 50, follow: true });
    this.burst('core', this.tex.spark, KO_PRISM, at.x, at.y - r * 0.2, 14, { speed: 420 * S, life: 420, size: 0.32, drag: 0.2, lift: 140 * S });
    this.burst('core', this.tex.star, [KO_CYAN, KO_MAGENTA, c.bone], at.x, at.y, 5, { speed: 260 * S, life: 320, size: (26 * S) / STAR_PX });
  }

  /**
   * TIER V's PRISM over the heart-knot's burst: the Ancient palette (cyan to magenta) layered on the gold and violet.
   * Two wider prismatic shockwaves, a prism nova, prism soul ribbons curling out through the gold ones, prism light
   * streaks. Short fills, so the big -N still reads.
   */
  koFlourish(d: Pt, dR: number, B: number): void {
    this.spawn('glow', this.tex.glow, KO_LILAC, d.x, d.y, { dur: 300, from: (dR * 1.6) / GLOW_PX, to: (dR * 6) / GLOW_PX, a0: 0.55, mode: 'punch', peakAt: 0.1 });
    this.spawn('glow', this.tex.ring, KO_CYAN, d.x, d.y, { dur: 700, from: (dR * 0.8) / RING_PX, to: (dR * 7.5 * Math.max(1, B / 2)) / RING_PX, a0: 0.95, ease: 'cubic', delay: 20 });
    this.spawn('glow', this.tex.ring, KO_MAGENTA, d.x, d.y, { dur: 900, from: (dR * 0.8) / RING_PX, to: (dR * 9.5 * Math.max(1, B / 2)) / RING_PX, a0: 0.8, ease: 'cubic', delay: 90 });
    this.burst('core', this.tex.streak, KO_PRISM, d.x, d.y, 14, { speed: 1400 * B / 2, life: 380, size: 0.6, align: true, drag: 0.12 });
    this.burst('core', this.tex.spark, KO_PRISM, d.x, d.y, 18, { speed: 950 * B / 2, life: 560, size: 0.4, drag: 0.25, grav: 380 });
    this.rip(d, dR, KO_PRISM, 8);
  }

  /** TIER V: a latch needle bites into the flung target (a tick): a gold-white flash and a few chips, riding it. */
  koLatched(): void {
    const c = this.colors, S = this.scale, g = this.geo;
    const back = Math.atan2(-g.u.y, -g.u.x);
    for (const l of this.latch) {
      const x = this.foe.x + Math.cos(back + l.fan) * this.foe.r * 0.9, y = this.foe.y + Math.sin(back + l.fan) * this.foe.r * 0.9;
      this.spawn('core', this.tex.star, c.bone, x, y, { dur: 220, from: (16 * S) / STAR_PX, to: (64 * S) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.12, rot: back, follow: true });
      this.spawn('glow', this.tex.ring, c.gold, x, y, { dur: 260, from: (14 * S) / RING_PX, to: (90 * S) / RING_PX, a0: 0.85, ease: 'cubic', follow: true });
      this.burst('body', this.tex.shard, [c.thread, c.gold], x, y, 3, { speed: 280, dir: back, spread: 1.8, life: 340, size: (11 * S) / SHARD_TEX, grav: 700, spin: 0.03 });
    }
  }

  /**
   * TIER V: THE SLAM, where the consequence lands: the striker crashes into the target in the middle of the board. A
   * white-gold flash, a nova, a gold shockwave and a violet one behind it, crystal shards and light streaks sprayed out
   * SIDEWAYS (the two hit along the line between them), the latch needles shattering, soul ribbons bursting out. `at`
   * is the contact point (screen px), `dR` the target's radius, `B` the tier's burst.
   */
  koSlam(at: Pt, dR: number, B: number): void {
    const c = this.colors, S = this.scale, g = this.geo;
    for (const l of this.latch) {
      const nb = l.needle.body;
      if (!nb.visible) continue;
      this.burst('body', this.tex.shard, [c.thread, c.lilac, c.gold], nb.position.x, nb.position.y, 3, { speed: 360 * B, life: 460, size: (13 * S) / SHARD_TEX, grav: 900, spin: 0.04 });
    }
    this.spawn('core', this.tex.glow, c.bone, at.x, at.y, { dur: 200, from: (dR * 1.2) / GLOW_PX, to: (dR * 4.6) / GLOW_PX, a0: 1, mode: 'punch', peakAt: 0.06 });
    this.spawn('glow', this.tex.glow, c.gold, at.x, at.y, { dur: 460, from: (dR * 1.4) / GLOW_PX, to: (dR * 5.6) / GLOW_PX, a0: 0.65, mode: 'punch', peakAt: 0.1 });
    this.spawn('core', this.tex.star, c.bone, at.x, at.y, { dur: 300, from: (dR * 1.6) / STAR_PX, to: (dR * 5.4) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.1, rot: Math.atan2(g.u.y, g.u.x) });
    this.spawn('glow', this.tex.ring, c.gold, at.x, at.y, { dur: 560, from: (dR * 0.6) / RING_PX, to: (dR * 7 * Math.max(1, B / 2)) / RING_PX, a0: 0.95, ease: 'cubic' });
    this.spawn('glow', this.tex.ring, c.thread, at.x, at.y, { dur: 720, from: (dR * 0.6) / RING_PX, to: (dR * 9 * Math.max(1, B / 2)) / RING_PX, a0: 0.8, ease: 'cubic', delay: 60 });
    // The two hit along the line between them: the debris sprays out to either side of it.
    const side = Math.atan2(g.nrm.y, g.nrm.x);
    for (const dir of [side, side + Math.PI]) {
      this.burst('core', this.tex.streak, [c.gold, c.lilac, c.bone], at.x, at.y, 8, { speed: 1500 * B / 2, dir, spread: 1.5, life: 340, size: 0.6, align: true, drag: 0.12 });
      this.burst('body', this.tex.shard, [c.thread, c.lilac, c.gold, c.bone], at.x, at.y, 10, { speed: 760 * B, dir, spread: 2, life: 700, size: (17 * S) / SHARD_TEX, grav: 900, drag: 0.4, spin: 0.06 });
    }
    this.burst('core', this.tex.spark, [c.gold, c.bone, c.lilac], at.x, at.y, 14, { speed: 900 * B / 2, life: 500, size: 0.4, drag: 0.25, grav: 400 });
    this.rip(at, dR, [c.gold, c.thread, c.lilac], 10);
  }

  /** IV: the knot is tied: the clasp flashes. */
  tied(at: Pt): void {
    const c = this.colors, r = this.foe.r, S = this.scale;
    this.spawn('core', this.tex.star, c.bone, at.x, at.y, { dur: 300, from: (r * 0.3) / STAR_PX, to: (r * 1.6) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.15, follow: true });
    this.burst('core', this.tex.spark, [c.gold, c.lilac], at.x, at.y, 8, { speed: 320 * S, life: 360, size: 0.3 });
  }

  /**
   * THE IMPACT. The needles burst into shards and every thread snaps (a flash where each parts). Then:
   *  I   a crystal burst back along the thread;
   *  II  shards spray out along both stitches, an X flash;
   *  III all five PINS rip out at once: a snap flash and a fan of crystal splinters torn out of each pin toward the
   *      striker, and a flash on the face as the portrait snaps back;
   *  IV  the HEART-KNOT BURSTS: gold and violet soul ribbons, a gold and violet nova, shockwaves, crystal shards.
   * `d` is where the struck portrait is now (IV: in the knot); `o.foe` the frame's target offset.
   */
  impact(d: Pt, dR: number, dir: Pt, o: { shards: number; burst: number; t: number; foe: Pt; hero: Pt }): void {
    const p = this.plan, g = this.geo, c = this.colors, S = this.scale, B = o.burst;
    // The needles shatter where they stand (the frame's own positions, so they burst exactly where they were drawn).
    for (let i = 0; i < this.needles.length; i++) {
      const at = needleAt(p, g, i, p.burstAt - 1);
      if (!at.visible) continue;
      let x = at.x + o.hero.x + (o.foe.x - o.hero.x) * at.on, y = at.y + o.hero.y + (o.foe.y - o.hero.y) * at.on;
      if (at.on >= 1 && this.last.foeM) { this.foePoint(at.x, at.y, this.last, tmp); x = tmp.x; y = tmp.y; }
      this.burst('body', this.tex.shard, [c.thread, c.lilac, c.deep], x, y, 5, { speed: 380 * B, life: 520, size: (14 * S) / SHARD_TEX, grav: 900, spin: 0.04 });
      this.spawn('core', this.tex.star, c.bone, x, y, { dur: 220, from: (12 * S) / STAR_PX, to: (60 * S) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.15 });
    }
    // Where every thread parts (halfway along its tether): a snap flash.
    for (const th of this.threads) {
      if (th.tetherN < 2) continue;
      th.at(th.tetherLength * 0.5, tmp);
      this.spawn('core', this.tex.star, c.lilac, tmp.x, tmp.y, { dur: 200, from: (10 * S) / STAR_PX, to: (52 * S) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.12, rot: 0.4 });
      this.burst('core', this.tex.spark, [c.lilac, c.thread], tmp.x, tmp.y, 4, { speed: 260, life: 300, size: 0.3 });
    }
    // The hit flash on the face.
    this.spawn('glow', this.tex.glow, c.thread, d.x, d.y, { dur: 340, from: (dR * 0.8) / GLOW_PX, to: (dR * (2.6 + 0.4 * B)) / GLOW_PX, a0: 0.75, mode: 'punch', peakAt: 0.1, follow: p.kind !== 'bound' });
    this.spawn('glow', this.tex.ring, c.lilac, d.x, d.y, { dur: 380, from: (dR * 0.5) / RING_PX, to: (dR * (2.2 + 0.6 * B)) / RING_PX, a0: 0.9, ease: 'cubic', follow: p.kind !== 'bound' });
    this.spawn('core', this.tex.glow, c.bone, d.x, d.y, { dur: 180, from: (dR * 0.4) / GLOW_PX, to: (dR * 1.4) / GLOW_PX, a0: 0.7, mode: 'punch', peakAt: 0.1, follow: p.kind !== 'bound' });
    const n = o.shards;
    if (p.kind === 'needle') {
      const back = Math.atan2(-dir.y, -dir.x);
      this.burst('body', this.tex.shard, [c.thread, c.lilac, c.deep], d.x, d.y, n, { speed: 520 * B, dir: back, spread: 2.4, life: 620, size: (16 * S) / SHARD_TEX, grav: 1100, spin: 0.05 });
    } else if (p.kind === 'cross') {
      // Along both stitches: shards fly out to either side of each diagonal.
      for (let s = 0; s < 2; s++) {
        const nd = g.needles[s];
        if (!nd || nd.sew.length < 2) continue;
        const a = nd.sew[0]!, b = nd.sew[nd.sew.length - 1]!;
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        const mx = (a.x + b.x) / 2 + o.foe.x, my = (a.y + b.y) / 2 + o.foe.y;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        this.spawn('core', this.tex.streak, c.lilac, mx, my, { dur: 260, from: len / 128, to: (len * 1.3) / 128, sy: 0.35, a0: 0.95, mode: 'punch', peakAt: 0.12, rot: ang });
        for (let j = 0; j < Math.ceil(n / 2); j++) {
          const f = (j + 0.5) / Math.ceil(n / 2);
          const x = a.x + (b.x - a.x) * f + o.foe.x, y = a.y + (b.y - a.y) * f + o.foe.y;
          const side = j % 2 ? 1 : -1;
          const dd = ang + side * Math.PI / 2 + (this.rnd() - 0.5) * 0.6;
          const sp = (260 + this.rnd() * 220) * B;
          this.spawn('body', this.tex.shard, j % 3 ? c.thread : c.lilac, x, y, {
            dur: 560, from: (15 * S) / SHARD_TEX, to: (8 * S) / SHARD_TEX, a0: 1, ease: 'linear', vx: Math.cos(dd) * sp, vy: Math.sin(dd) * sp, drag: 0.3, grav: 900, rot: this.rnd() * 6, spin: (this.rnd() - 0.5) * 0.05,
          });
        }
      }
    } else if (p.kind === 'pinned') {
      // All five pins rip out: at each pin a snap flash, a ring, and crystal splinters torn out toward the striker.
      const back = Math.atan2(-dir.y, -dir.x);
      const per = Math.max(2, Math.round(n / Math.max(1, this.needles.length)));
      for (let i = 0; i < g.needles.length; i++) {
        const pin = g.needles[i]!.entry;
        this.foePoint(pin.x, pin.y, this.last, tmp);
        const x = tmp.x, y = tmp.y;
        this.spawn('core', this.tex.star, c.bone, x, y, { dur: 240, from: (14 * S) / STAR_PX, to: (84 * S) / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.1, rot: i * 0.7, delay: i * 18 });
        this.spawn('glow', this.tex.ring, c.thread, x, y, { dur: 300, from: (12 * S) / RING_PX, to: (90 * S) / RING_PX, a0: 0.9, ease: 'cubic', delay: i * 18 });
        this.burst('body', this.tex.shard, [c.thread, c.lilac, c.deep], x, y, per, { speed: 480 * B, dir: back, spread: 1.6, life: 560, size: (14 * S) / SHARD_TEX, grav: 1000, spin: 0.05 });
        this.burst('core', this.tex.spark, [c.lilac, c.bone], x, y, 3, { speed: 420 * B, dir: back, spread: 1.2, life: 280, size: 0.3, align: true });
        // A violet / lilac burst at each pin as it tears out.
        this.spawn('glow', this.tex.glow, i % 2 ? c.lilac : c.thread, x, y, { dur: 260, from: (20 * S) / GLOW_PX, to: (130 * S * B) / GLOW_PX, a0: 0.85, mode: 'punch', peakAt: 0.12, delay: i * 18 });
        this.burst('core', this.tex.star, [c.lilac, c.bone], x, y, 3, { speed: 300 * B, life: 340, size: (20 * S) / STAR_PX });
      }
      // The snap-back: a brief additive flash, a big shockwave ring (gold inside violet) and a radial crystal spray.
      this.spawn('core', this.tex.glow, c.bone, d.x, d.y, { dur: 160, from: (dR * 1.2) / GLOW_PX, to: (dR * 3.6) / GLOW_PX, a0: 0.85, mode: 'punch', peakAt: 0.08, follow: true });
      this.spawn('glow', this.tex.ring, c.thread, d.x, d.y, { dur: 520, from: (dR * 0.8) / RING_PX, to: (dR * 5.2 * B) / RING_PX, a0: 0.95, ease: 'cubic', follow: true });
      this.spawn('glow', this.tex.ring, c.gold, d.x, d.y, { dur: 440, from: (dR * 0.6) / RING_PX, to: (dR * 3.8 * B) / RING_PX, a0: 0.8, ease: 'cubic', delay: 50, follow: true });
      this.burst('body', this.tex.shard, [c.thread, c.lilac, c.bone, c.deep], d.x, d.y, n, { speed: 640 * B, life: 680, size: (16 * S) / SHARD_TEX, grav: 900, drag: 0.4, spin: 0.06 });
      this.burst('core', this.tex.streak, [c.lilac, c.bone], d.x, d.y, 10, { speed: 900 * B, life: 260, size: 0.45, align: true, drag: 0.15 });
    } else {
      this.burstOff = { x: o.foe.x, y: o.foe.y };
      // THE HEART-KNOT BURSTS: a nova, gold and violet shockwaves, soul ribbons, crystal shards.
      this.spawn('core', this.tex.glow, c.bone, d.x, d.y, { dur: 260, from: (dR * 0.6) / GLOW_PX, to: (dR * 3.2) / GLOW_PX, a0: 0.9, mode: 'punch', peakAt: 0.08 });
      this.spawn('glow', this.tex.glow, c.gold, d.x, d.y, { dur: 420, from: (dR * 1) / GLOW_PX, to: (dR * 4.2) / GLOW_PX, a0: 0.6, mode: 'punch', peakAt: 0.12 });
      for (let r = 0; r < 3; r++) {
        this.spawn('glow', this.tex.ring, r === 1 ? c.thread : c.gold, d.x, d.y, { dur: 520 + r * 120, from: (dR * 0.6) / RING_PX, to: (dR * (4.4 + 1.4 * r)) / RING_PX, a0: 0.85, ease: 'cubic', delay: r * 80 });
      }
      this.burst('body', this.tex.shard, [c.thread, c.lilac, c.gold, c.bone], d.x, d.y, n, { speed: 720 * B, life: 760, size: (18 * S) / SHARD_TEX, grav: 900, drag: 0.4, spin: 0.06 });
      this.burst('core', this.tex.star, [c.gold, c.lilac, c.bone], d.x, d.y, 16, { speed: 560 * B, life: 560, size: (26 * S) / STAR_PX, drag: 0.2 });
      // Layered on top (owner 2026-10-02: "more oomph"): a white-gold core, a violet nova, a giant shockwave, radial
      // light streaks, then crystal rain over the board.
      this.spawn('core', this.tex.glow, c.bone, d.x, d.y, { dur: 200, from: (dR * 2) / GLOW_PX, to: (dR * 6) / GLOW_PX, a0: 1, mode: 'punch', peakAt: 0.06 });
      this.spawn('glow', this.tex.glow, c.thread, d.x, d.y, { dur: 620, from: (dR * 1.5) / GLOW_PX, to: (dR * 7.5) / GLOW_PX, a0: 0.6, mode: 'punch', peakAt: 0.15, delay: 40 });
      this.spawn('glow', this.tex.ring, c.lilac, d.x, d.y, { dur: 760, from: (dR * 1) / RING_PX, to: (dR * 11 * B / 2) / RING_PX, a0: 0.9, ease: 'cubic', delay: 30 });
      this.burst('core', this.tex.streak, [c.gold, c.lilac, c.bone], d.x, d.y, 22, { speed: 1300 * B / 2, life: 360, size: 0.6, align: true, drag: 0.12 });
      this.burst('core', this.tex.spark, [c.gold, c.bone], d.x, d.y, 20, { speed: 900 * B / 2, life: 520, size: 0.4, drag: 0.25, grav: 400 });
      this.rain(d, dR);
      this.rip(d, dR);
    }
  }

  /** IV: gold and violet soul ribbons burst out of the knot and curl away (own strip meshes, sampled back along their flight). */
  private rip(d: Pt, dR: number, tints: readonly number[] | null = null, count?: number): void {
    const c = this.colors, S = this.scale;
    const n = Math.max(0, Math.min(24, Math.round(count ?? this.look.ripRibbons)));
    const tt = tints ?? [c.gold, c.thread, c.lilac];
    for (let i = 0; i < n; i++) {
      const trail = this.ribbonPool.pop() ?? new RibbonTrail(this.layers.glow, this.tex.ribbonBody, c.thread, 'add');
      trail.mesh.tint = tt[i % tt.length]!;
      const a = (i / n) * Math.PI * 2 + this.rnd() * 0.3;
      this.ribbons.push({
        trail, age: 0, life: 760 + this.rnd() * 320, cx: d.x, cy: d.y, dx: Math.cos(a), dy: Math.sin(a),
        reach: dR * (2.6 + this.rnd() * 1.8), curl: dR * (0.35 + this.rnd() * 0.4) * (i % 2 ? 1 : -1), w: 0.006 + this.rnd() * 0.004,
        phase: this.rnd() * 6, width: (16 + this.rnd() * 12) * S,
      });
    }
  }

  /** IV: crystal rain: shards fall over the board around the burst, staggered, glinting as they go. */
  private rain(d: Pt, dR: number): void {
    const c = this.colors, S = this.scale;
    const n = Math.max(0, Math.min(60, Math.round(this.look.rainShards)));
    for (let i = 0; i < n; i++) {
      const x = d.x + (this.rnd() - 0.5) * dR * 10;
      const y = d.y - dR * (2 + this.rnd() * 2.4);
      const sz = ((12 + this.rnd() * 12) * S) / SHARD_TEX;
      const delay = 140 + (i / Math.max(1, n)) * 700;
      this.spawn('body', this.tex.shard, i % 3 === 0 ? c.gold : i % 2 ? c.thread : c.lilac, x, y, {
        dur: 950 + this.rnd() * 300, from: sz, to: sz * 0.8, a0: 0.95, mode: 'hold', ease: 'linear', delay,
        vx: (this.rnd() - 0.5) * 80, vy: 260 + this.rnd() * 200, grav: 1300, rot: this.rnd() * 6, spin: (this.rnd() - 0.5) * 0.02,
      });
      if (i % 3 === 0) this.spawn('core', this.tex.star, c.bone, x, y + dR * 1.3, { dur: 240, from: 0.1, to: (30 * S) / STAR_PX, a0: 0.85, mode: 'punch', peakAt: 0.3, delay: delay + 200 });
    }
  }

  protected override tick(dt: number): boolean {
    const rp: Pt = tmp;
    for (let i = this.ribbons.length - 1; i >= 0; i--) {
      const r = this.ribbons[i]!;
      r.age += dt;
      const u = r.age / r.life;
      if (u >= 1) { r.trail.hide(); this.ribbonPool.push(r.trail); this.ribbons.splice(i, 1); continue; }
      const sample = (ms: number): Pt => {
        const k = 1 - Math.exp(-ms / 260);
        const out = r.reach * k;
        const cl = r.curl * Math.sin(ms * r.w + r.phase) * k;
        rp.x = r.cx + r.dx * out - r.dy * cl;
        rp.y = r.cy + r.dy * out + r.dx * cl + 120 * this.scale * (ms / 1000) * (ms / 1000);
        return rp;
      };
      r.trail.draw(sample, r.age, 200, r.width * (1 - 0.5 * u), 0.9 * (1 - u * u));
    }
    return this.ribbons.length > 0;
  }

  /** Hide every thread, needle and the knot (the end; the pooled FX and the ribbons drain on their own). */
  hideOwn(): void {
    this.ownOn = false;
    for (const th of this.threads) th.hide();
    for (const k of this.knot) k.hide();
    for (const n of this.needles) { n.body.visible = false; n.glow.visible = false; }
    for (const l of this.latch) { l.th.hide(); l.needle.body.visible = false; l.needle.glow.visible = false; }
    if (this.gem) this.gem.visible = false;
    if (this.gemGlow) this.gemGlow.visible = false;
    if (this.knotGlow) this.knotGlow.visible = false;
  }

  override destroy(): void {
    if (this.destroyed) return;
    this.clearOwn();
    for (const ct of [this.threadGlowC, this.threadCoreC, this.needleC]) ct.removeChildren().forEach((ch) => ch.destroy());
    this.ribbonPool.length = 0;
    super.destroy();
  }

  protected override clearOwn(): void {
    this.hideOwn();
    for (const r of this.ribbons) { r.trail.hide(); this.ribbonPool.push(r.trail); }
    this.ribbons = [];
  }
}
