/**
 * HERO SELECT CEREMONY — the dedicated Pixi FX controller (hero-select-ceremony-blueprint.md §11-§12, §18).
 *
 * This owns its OWN `Application` — a transparent, pointer-events:none canvas mounted inside the ceremony
 * component — and never touches the gameplay `pixiFx` singleton (§3.5, §11). It draws the five ceremony
 * effects (arrival burst, tagline ambience, frame dissipation + materialization finish, launch pull) as
 * pooled sprites on one ticker that stops the moment nothing is animating.
 *
 * Contract highlights (§11, §18 + repo perf rules):
 *  - No per-frame DOM reads: geometry arrives ONLY through `setGeometry()`; the host width (mobile budget
 *    switch) is read once per mount/setGeometry, both event-driven.
 *  - `destroy()` is safe at ANY moment — mid-effect, or before the async `init()` resolves (the late
 *    Application is destroyed immediately on arrival; mirror of pixiFx's "only attach if still wanted").
 *  - Init failure is caught with ONE console.error and the controller becomes an inert no-op — the ceremony
 *    continues on DOM animation alone (§19).
 *  - Particle textures are generated ONCE per mount (`renderer.generateTexture`) and reused; sprites are
 *    pooled; every array is bounded; total stage children stay well under ~200.
 *  - Math.random is fine here (presentation-only; the engine RNG ban covers core/content/sim).
 *
 * The PURE math (perimeter spawn positions, budget scaling, eases, ring radius) is exported below and
 * unit-tested in `heroCeremonyFx.test.ts` — Pixi itself can't run under node, the math can.
 */
import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { RectSnapshot } from './heroCeremonyMachine';

// ─── pure math (exported for tests) ───────────────────────────────────────────────────────────────────────

const clamp01 = (t: number): number => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0);
const finite = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/** Standard eases, all clamped + monotone 0→1 (tested). */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeOutQuint = (t: number): number => 1 - Math.pow(1 - clamp01(t), 5);
export const easeInQuad = (t: number): number => { const c = clamp01(t); return c * c; };
export const easeInOutSine = (t: number): number => 0.5 - 0.5 * Math.cos(Math.PI * clamp01(t));

/** Hosts narrower than this use the mobile particle budgets (§17, §18). */
export const MOBILE_HOST_WIDTH = 720;

/** The §18 budget table, one concrete value per effect chosen inside each recommended range. */
export const CEREMONY_BUDGETS = {
  arrivalSparks: { desktop: 50, mobile: 25 },   // range 40-60 / 20-30
  runeFragments: { desktop: 11, mobile: 5 },    // range 8-14 / 4-7
  ambientMotes: { desktop: 22, mobile: 11 },    // range 18-28 / 8-14
  dissipationDust: { desktop: 64, mobile: 32 }, // range 50-80 / 25-40
  launchPull: { desktop: 32, mobile: 16 },      // range 25-40 / 12-20
} as const;

export type CeremonyBudgetKey = keyof typeof CEREMONY_BUDGETS;

/**
 * The particle budget for one effect given the host width. A non-finite or non-positive width (host not
 * measured yet) falls back to desktop — the ceremony host is the full viewport, so an unmeasured host is
 * overwhelmingly a desktop test/jsdom environment, and the desktop counts are still tiny.
 */
export function budgetFor(key: CeremonyBudgetKey, hostWidth: number): number {
  const b = CEREMONY_BUDGETS[key];
  return Number.isFinite(hostWidth) && hostWidth > 0 && hostWidth < MOBILE_HOST_WIDTH ? b.mobile : b.desktop;
}

/** A point on a rect's perimeter plus its outward unit normal. */
export interface PerimeterPoint { x: number; y: number; nx: number; ny: number; }

/**
 * The point a fraction `t` (wrapping; any finite number) clockwise around `rect`'s perimeter from the
 * top-left corner, with the outward normal of the edge it sits on. Degenerate rects (zero/negative/NaN
 * dimensions) return the rect's origin-ish center with an upward normal — never NaN (tested).
 */
export function rectPerimeterPoint(rect: RectSnapshot, t: number): PerimeterPoint {
  const left = finite(rect.left, 0);
  const top = finite(rect.top, 0);
  const w = Math.max(0, finite(rect.width, 0));
  const h = Math.max(0, finite(rect.height, 0));
  const per = 2 * (w + h);
  if (per <= 0) return { x: left + w / 2, y: top + h / 2, nx: 0, ny: -1 };
  let d = clampWrap01(t) * per;
  if (d < w) return { x: left + d, y: top, nx: 0, ny: -1 };            // top edge, left→right
  d -= w;
  if (d < h) return { x: left + w, y: top + d, nx: 1, ny: 0 };         // right edge, top→bottom
  d -= h;
  if (d < w) return { x: left + w - d, y: top + h, nx: 0, ny: 1 };     // bottom edge, right→left
  d -= w;
  return { x: left, y: top + h - Math.min(d, h), nx: -1, ny: 0 };      // left edge, bottom→top
}

/** Wrap any finite t into [0, 1); non-finite → 0. */
function clampWrap01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  const f = t - Math.floor(t);
  return f >= 1 ? 0 : f; // guards float edge (e.g. t = -1e-17)
}

/**
 * `count` spawn points spread evenly around a rect's perimeter, each offset by up to `jitter` fraction of
 * one slot (so bursts read organic, not fence-post regular). `random` defaults to Math.random and is
 * injectable so the test can prove every point sits ON the perimeter deterministically.
 */
export function perimeterSpawnPoints(
  rect: RectSnapshot, count: number, jitter = 0.35, random: () => number = Math.random,
): PerimeterPoint[] {
  const n = Math.max(0, Math.floor(finite(count, 0)));
  const pts: PerimeterPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5 + (random() - 0.5) * clamp01(jitter)) / n;
    pts.push(rectPerimeterPoint(rect, t));
  }
  return pts;
}

/**
 * Ring radius at progress `t` (0→1, clamped): eased interpolation `fromR`→`toR`. Works for expanding
 * (from < to) and contracting rings; monotone whenever the ease is (tested).
 */
export function ringRadiusAt(t: number, fromR: number, toR: number, ease: (t: number) => number = easeOutCubic): number {
  const f = finite(fromR, 0);
  const g = finite(toR, 0);
  return f + (g - f) * clamp01(ease(clamp01(t)));
}

// ─── public API (§11, adjusted to the repo's RectSnapshot) ────────────────────────────────────────────────

export interface HeroCeremonyFxConfig {
  heroId: string;
  accentColor: number;
  center: { x: number; y: number };
  cardBounds: RectSnapshot;
  portraitBounds: RectSnapshot;
}

export interface HeroCeremonyFxController {
  mount(host: HTMLElement): Promise<void>;
  setGeometry(config: HeroCeremonyFxConfig): void;
  /** RING BURST 1 — the arrival: soft bloom + one thin expanding ring + the small edge-weighted flash. */
  playRingBurst1(durMs: number): void;
  /** SPARKS — accent sparks + rune fragments bursting off the card perimeter. */
  playSparks(durMs: number): void;
  /** MOTES — the ambient hold (slow motes + wisps + the behind-portrait pulse). Runs until stopped. */
  beginAmbient(): void;
  /** LINE SWEEP — the light sweep gliding lower-left → upper-right across the artwork. */
  playSweep(durMs: number): void;
  /** DUST — frame-boundary dissipation dust + fragments + brief inward wisps. */
  playDust(durMs: number): void;
  /** RING BURST 2 — the finish: a thin ring contracting onto the hero; ambient density drops after it. */
  playRingBurst2(durMs: number): void;
  stopAmbient(): void;
  playLaunch(): Promise<void>;
  destroy(): void;
}

// ─── internals ────────────────────────────────────────────────────────────────────────────────────────────

/** One pooled particle. Position in CSS pixels (1:1 with the stage — autoDensity). */
interface Particle {
  sprite: Sprite;
  kind: 'burst' | 'ambient' | 'wisp' | 'dust' | 'pull';
  x: number; y: number;
  vx: number; vy: number;     // px/sec
  drag: number;               // velocity multiplier per second (<1 decelerates)
  life: number;               // ms remaining
  maxLife: number;
  fromScale: number; toScale: number;
  peakAlpha: number;
  spin: number;               // rad/sec
  gravity: number;            // px/sec² downward (negative = buoyant wisps)
  fadeIn: boolean;            // ambient/wisp: sin-profile alpha (in AND out); bursts fade out only
}

/** One live ring — the ring texture scaled from `fromR` to `toR` over `dur`. */
interface RingFx { sprite: Sprite; age: number; dur: number; fromR: number; toR: number; peakAlpha: number; }

/** The materialize light sweep — one elongated wisp gliding lower-left → upper-right (§12.3). */
interface SweepFx { sprite: Sprite; age: number; dur: number; x0: number; y0: number; x1: number; y1: number; }

/** One flash/glow envelope: quick alpha up, eased fall. Drives the arrival flash, rim brighten, ambient pulse. */
interface FlashFx { sprite: Sprite; age: number; dur: number; peakAlpha: number; fromScale: number; toScale: number; }

/** A ticker-driven timer (no setTimeout chains — §11): fires `fn` after `left` ms of ticker time. */
interface TimerFx { left: number; fn: () => void; }

/** Natural radius the ring texture is drawn at; sprites scale from here to hit an exact on-screen radius. */
const RING_TEX_R = 60;
/** Hard cap on simultaneously-live particles — the "< ~200 children" bound with room for rings/flashes. */
const MAX_PARTICLES = 170;
/** Launch resolves after this many ms of ticker time (§12.5: ~250-300ms). */
const LAUNCH_MS = 280;

class HeroCeremonyFx implements HeroCeremonyFxController {
  private app: Application | null = null;
  private root: Container | null = null;
  private destroyed = false;
  private disabled = false; // init failed → every call is an inert no-op
  private mounting: Promise<void> | null = null;
  private hostWidth = 0;

  private config: HeroCeremonyFxConfig | null = null;

  // textures, built once per mount
  private sparkTex: Texture | null = null;
  private glowTex: Texture | null = null;
  private fragTex: Texture | null = null;
  private ringTex: Texture | null = null;
  private wispTex: Texture | null = null;

  // live effect state — all bounded
  private particles: Particle[] = [];
  private rings: RingFx[] = [];
  private sweeps: SweepFx[] = [];
  private flashes: FlashFx[] = [];
  private timers: TimerFx[] = [];
  private pool: Sprite[] = [];

  // ambient hold state (§12.2)
  private ambientOn = false;
  private ambientDensity = 1;      // materialization finish drops this (§12.4)
  private ambientCount = 0;        // live 'ambient' particles (motes)
  private ambientSpawnAcc = 0;     // accumulated ms toward the next mote
  private wispSpawnAcc = 0;
  private pulseAcc = 0;            // accumulated ms toward the next behind-portrait pulse

  // launch state (§12.5)
  private launching = false;
  private launchResolvers: (() => void)[] = [];

  async mount(host: HTMLElement): Promise<void> {
    if (this.destroyed || this.disabled || this.app || this.mounting) return this.mounting ?? undefined;
    this.hostWidth = host.clientWidth || 0;
    this.mounting = this.init(host).catch((e) => {
      // One error, then the controller is a permanent no-op — the ceremony continues on DOM alone (§19).
      console.error('[heroCeremonyFx] pixi init failed — ceremony particles disabled:', e);
      this.disabled = true;
    });
    return this.mounting;
  }

  private async init(host: HTMLElement): Promise<void> {
    const res = Math.min(window.devicePixelRatio || 1, 2); // same DPR cap as the gameplay overlay
    const app = new Application();
    await app.init({
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: res,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    // The ceremony may have unmounted before init resolved; only attach if still wanted (mirrors pixiFx).
    if (this.destroyed) {
      app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
      return;
    }
    const canvas = app.canvas;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.display = 'block';
    host.appendChild(canvas);

    const root = new Container();
    app.stage.addChild(root);
    this.app = app;
    this.root = root;
    this.sparkTex = makeSparkTexture(app);
    this.glowTex = makeGlowTexture(app);
    this.fragTex = makeFragTexture(app);
    this.ringTex = makeRingTexture(app);
    this.wispTex = makeWispTexture(app);
    app.ticker.add(this.update);
    app.ticker.stop(); // idle until an effect wakes it
  }

  setGeometry(config: HeroCeremonyFxConfig): void {
    this.config = config;
    // Event-driven (selection / debounced resize), never per-frame: refresh the mobile-budget switch here.
    const w = this.app?.canvas.parentElement?.clientWidth;
    if (w) this.hostWidth = w;
  }

  // ─── §12.1 arrival burst, split into the 🎭 tuner's named effects (owner ask 2026-08-21). Every hardcoded
  //     lifetime became a fraction of the effect's tunable duration, so the sliders stretch the whole thing
  //     rather than truncating its tail. ──────────────────────────────────────────────────────────────────

  playRingBurst1(durMs: number): void {
    const cfg = this.config;
    if (!this.ready() || !cfg) return;
    const dur = Math.max(80, durMs);
    const accent = cfg.accentColor;
    const card = cfg.cardBounds;
    const { x: cx, y: cy } = cfg.center;
    const cardSpan = Math.max(card.width, card.height, 120);
    // soft bloom behind the card — a broad, dim glow that swells and fades
    this.spawnFlash(this.glowTex, cx, cy, accent, 0.32, cardSpan / 40, cardSpan / 26, dur * 1.08);
    // one thin expanding ring — the effect's namesake, exactly `dur` long
    this.spawnRing(cx, cy, cardSpan * 0.30, cardSpan * 0.85, dur, accent, 0.8);
    // small center flash — edge-weighted: kept small + dim so it never obscures the face (§12.1)
    this.spawnFlash(this.glowTex, cx, cy - card.height * 0.32, 0xfff2d8, 0.28, 0.6, 1.5, dur * 0.58);
    this.wake();
  }

  playSparks(durMs: number): void {
    const cfg = this.config;
    if (!this.ready() || !cfg) return;
    const dur = Math.max(80, durMs);
    const accent = cfg.accentColor;
    const card = cfg.cardBounds;
    // accent sparks around the card perimeter
    for (const p of perimeterSpawnPoints(card, budgetFor('arrivalSparks', this.hostWidth))) {
      const speed = 90 + Math.random() * 170;
      this.spawnParticle('burst', this.sparkTex, p.x, p.y, accent, {
        vx: p.nx * speed + (Math.random() - 0.5) * 40,
        vy: p.ny * speed + (Math.random() - 0.5) * 40,
        drag: 0.12, life: dur * (0.66 + Math.random() * 0.34),
        fromScale: 0.7 + Math.random() * 0.5, toScale: 0.1, peakAlpha: 0.9,
      });
    }
    // a few rune fragments rotating outward
    for (const p of perimeterSpawnPoints(card, budgetFor('runeFragments', this.hostWidth))) {
      const speed = 60 + Math.random() * 90;
      this.spawnParticle('burst', this.fragTex, p.x, p.y, accent, {
        vx: p.nx * speed, vy: p.ny * speed - 20,
        drag: 0.25, life: dur * (0.76 + Math.random() * 0.24), gravity: 60,
        fromScale: 0.8 + Math.random() * 0.4, toScale: 0.4, peakAlpha: 0.85,
        spin: (Math.random() - 0.5) * 6,
      });
    }
    this.wake();
  }

  // ─── §12.2 tagline ambience ─────────────────────────────────────────────────────────────────────────────

  beginAmbient(): void {
    if (!this.ready()) return;
    this.ambientOn = true;
    this.ambientDensity = 1;
    this.ambientSpawnAcc = 1e9; // spawn the first few motes immediately (capped per frame in update)
    this.pulseAcc = 0;
    this.wake();
  }

  stopAmbient(): void {
    this.ambientOn = false;
    // Existing motes/wisps wind down naturally: cap their remaining life so the hold state clears fast.
    for (const p of this.particles) {
      if (p.kind === 'ambient' || p.kind === 'wisp') p.life = Math.min(p.life, 350);
    }
  }

  // ─── §12.3 + §12.4, split into the 🎭 tuner's named effects: LINE SWEEP, DUST, RING BURST 2 — each
  //     scheduled independently by the ceremony's runner instead of one composite with baked offsets. ─────

  playSweep(durMs: number): void {
    const cfg = this.config;
    if (!this.ready() || !cfg) return;
    // light sweep, lower-left → upper-right across the artwork (§12.3)
    this.spawnSweep(cfg.portraitBounds, Math.max(80, durMs));
    this.wake();
  }

  playDust(durMs: number): void {
    const cfg = this.config;
    if (!this.ready() || !cfg) return;
    const dur = Math.max(120, durMs);
    const accent = cfg.accentColor;
    const card = cfg.cardBounds;
    // frame-boundary dust + fragments, outward (§12.3)
    const dust = budgetFor('dissipationDust', this.hostWidth);
    for (const p of perimeterSpawnPoints(card, dust)) {
      const speed = 40 + Math.random() * 120;
      this.spawnParticle('dust', this.sparkTex, p.x, p.y, Math.random() < 0.5 ? accent : 0xd8d2c4, {
        vx: p.nx * speed + (Math.random() - 0.5) * 30,
        vy: p.ny * speed - 20 - Math.random() * 30, // slight lift — dissipating, not falling
        drag: 0.3, life: dur * (0.6 + Math.random() * 0.4),
        fromScale: 0.35 + Math.random() * 0.4, toScale: 0.05, peakAlpha: 0.7,
      });
    }
    for (const p of perimeterSpawnPoints(card, Math.max(3, Math.floor(budgetFor('runeFragments', this.hostWidth) / 2)))) {
      this.spawnParticle('dust', this.fragTex, p.x, p.y, accent, {
        vx: p.nx * (50 + Math.random() * 60), vy: p.ny * 50 - 30,
        drag: 0.3, life: dur * (0.65 + Math.random() * 0.25), gravity: 40,
        fromScale: 0.7, toScale: 0.3, peakAlpha: 0.7, spin: (Math.random() - 0.5) * 4,
      });
    }
    // brief inward wisps masking the portrait transition (§12.3)
    const wisps = Math.max(4, Math.floor(budgetFor('ambientMotes', this.hostWidth) / 3));
    for (const p of perimeterSpawnPoints(card, wisps)) {
      const ox = p.x + p.nx * 30;
      const oy = p.y + p.ny * 30;
      this.spawnParticle('wisp', this.wispTex, ox, oy, 0xe8e2d4, {
        vx: -p.nx * 80, vy: -p.ny * 80,
        drag: 0.5, life: dur * (0.5 + Math.random() * 0.2),
        fromScale: 0.9, toScale: 0.5, peakAlpha: 0.35, fadeIn: true,
        spin: 0,
      }, Math.atan2(-p.ny, -p.nx));
    }
    this.wake();
  }

  playRingBurst2(durMs: number): void {
    const cfg = this.config;
    if (!this.ready() || !cfg) return;
    const card = cfg.cardBounds;
    const art = cfg.portraitBounds;
    const { x: cx, y: cy } = cfg.center;
    // the §12.4 finish: a thin ring contracting onto the hero, then a restrained idle — ambient density
    // drops rather than stopping outright.
    this.spawnRing(cx, cy, Math.max(card.width, card.height) * 0.75, Math.min(art.width, art.height) * 0.35, Math.max(80, durMs), cfg.accentColor, 0.6);
    this.ambientDensity = 0.5;
    this.wake();
  }

  // ─── §12.5 launch confirmation ──────────────────────────────────────────────────────────────────────────

  playLaunch(): Promise<void> {
    const cfg = this.config;
    if (!this.ready() || !cfg) return Promise.resolve(); // inert controller: resolve immediately, never block
    const accent = cfg.accentColor;
    const { x: cx, y: cy } = cfg.center;
    this.launching = true; // existing ambient particles get pulled toward center in update()

    // fresh pull particles converging on the portrait
    const n = budgetFor('launchPull', this.hostWidth);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 110 + Math.random() * 130;
      const speed = r / (LAUNCH_MS / 1000) * (0.8 + Math.random() * 0.4);
      this.spawnParticle('pull', this.sparkTex, cx + Math.cos(a) * r, cy + Math.sin(a) * r, accent, {
        vx: -Math.cos(a) * speed, vy: -Math.sin(a) * speed,
        drag: 1, life: LAUNCH_MS, fromScale: 0.5, toScale: 0.9, peakAlpha: 0.85,
      });
    }
    // short outward pulse + rim brighten
    this.spawnRing(cx, cy, 40, 200, LAUNCH_MS, accent, 0.7);
    this.spawnFlash(this.glowTex, cx, cy, accent, 0.3, 3.2, 4.2, LAUNCH_MS);
    this.wake();

    return new Promise<void>((resolve) => {
      this.launchResolvers.push(resolve);
      this.timers.push({ left: LAUNCH_MS, fn: () => this.resolveLaunches() });
    });
  }

  private resolveLaunches(): void {
    const rs = this.launchResolvers;
    this.launchResolvers = [];
    for (const r of rs) r();
  }

  // ─── teardown ───────────────────────────────────────────────────────────────────────────────────────────

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.disabled = true;
    this.ambientOn = false;
    this.launching = false;
    this.resolveLaunches(); // never leave a caller awaiting playLaunch()
    this.particles.length = 0;
    this.rings.length = 0;
    this.sweeps.length = 0;
    this.flashes.length = 0;
    this.timers.length = 0;
    this.pool.length = 0;
    const app = this.app;
    if (!app) return; // pre-init destroy: init()'s "still wanted?" check handles the late Application
    app.ticker.remove(this.update);
    app.ticker.stop();
    for (const t of [this.sparkTex, this.glowTex, this.fragTex, this.ringTex, this.wispTex]) t?.destroy(true);
    this.sparkTex = this.glowTex = this.fragTex = this.ringTex = this.wispTex = null;
    // removeView pulls the canvas out of the DOM; children:true destroys every sprite/container left mounted.
    app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
    this.app = null;
    this.root = null;
  }

  // ─── the ticker ─────────────────────────────────────────────────────────────────────────────────────────

  private ready(): boolean {
    return !this.destroyed && !this.disabled && this.app !== null && this.root !== null;
  }

  private wake(): void {
    if (this.ready()) this.app!.ticker.start();
  }

  private hasLiveWork(): boolean {
    return (
      this.particles.length > 0 || this.rings.length > 0 || this.sweeps.length > 0 ||
      this.flashes.length > 0 || this.timers.length > 0 || this.ambientOn
    );
  }

  private update = (): void => {
    const app = this.app;
    if (!app) return;
    const dt = Math.min(app.ticker.deltaMS, 64); // clamp a background-tab catch-up frame
    const dtSec = dt / 1000;
    const cfg = this.config;

    // ambient respawn (§12.2) — accumulated-time cadence, at most 2 spawns per frame
    if (this.ambientOn && cfg) {
      const target = Math.round(budgetFor('ambientMotes', this.hostWidth) * this.ambientDensity);
      this.ambientSpawnAcc += dt;
      let spawnedThisFrame = 0;
      while (this.ambientCount < target && this.ambientSpawnAcc >= 70 && spawnedThisFrame < 2) {
        this.ambientSpawnAcc = Math.min(this.ambientSpawnAcc - 70, 140);
        this.spawnAmbientMote(cfg);
        spawnedThisFrame++;
      }
      if (this.ambientCount >= target) this.ambientSpawnAcc = 0;
      // faint upward wisps, one every ~600ms
      this.wispSpawnAcc += dt;
      if (this.wispSpawnAcc >= 600) {
        this.wispSpawnAcc -= 600;
        this.spawnAmbientWisp(cfg);
      }
      // the behind-portrait pulse, every ~1000ms of accumulated time
      this.pulseAcc += dt;
      if (this.pulseAcc >= 1000) {
        this.pulseAcc -= 1000;
        const span = Math.max(cfg.portraitBounds.width, cfg.portraitBounds.height, 160);
        this.spawnFlash(this.glowTex, cfg.center.x, cfg.center.y, cfg.accentColor, 0.14, span / 46, span / 38, 620);
      }
    }

    // particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        if (p.kind === 'ambient') this.ambientCount--;
        this.release(p.sprite);
        this.particles.splice(i, 1);
        continue;
      }
      if (this.launching && cfg && (p.kind === 'ambient' || p.kind === 'wisp')) {
        // §12.5: pull the hold-state particles toward the portrait center
        const dx = cfg.center.x - p.x;
        const dy = cfg.center.y - p.y;
        const d = Math.max(30, Math.hypot(dx, dy));
        p.vx += (dx / d) * 1400 * dtSec;
        p.vy += (dy / d) * 1400 * dtSec;
      }
      const dragK = Math.pow(p.drag, dtSec);
      p.vx *= dragK;
      p.vy = p.vy * dragK + p.gravity * dtSec;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      const lived = 1 - p.life / p.maxLife;
      const s = p.sprite;
      s.position.set(p.x, p.y);
      s.scale.set(p.fromScale + (p.toScale - p.fromScale) * lived);
      s.rotation += p.spin * dtSec;
      s.alpha = p.peakAlpha * (p.fadeIn ? Math.sin(Math.PI * lived) : 1 - easeInQuad(lived));
    }

    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      const t = r.age / r.dur;
      if (t >= 1) {
        this.release(r.sprite);
        this.rings.splice(i, 1);
        continue;
      }
      r.sprite.scale.set(ringRadiusAt(t, r.fromR, r.toR) / RING_TEX_R);
      r.sprite.alpha = r.peakAlpha * (1 - easeInQuad(t));
    }

    // the light sweep
    for (let i = this.sweeps.length - 1; i >= 0; i--) {
      const sw = this.sweeps[i];
      sw.age += dt;
      const t = sw.age / sw.dur;
      if (t >= 1) {
        this.release(sw.sprite);
        this.sweeps.splice(i, 1);
        continue;
      }
      const e = easeInOutSine(t);
      sw.sprite.position.set(sw.x0 + (sw.x1 - sw.x0) * e, sw.y0 + (sw.y1 - sw.y0) * e);
      sw.sprite.alpha = 0.5 * Math.sin(Math.PI * t);
    }

    // flashes (arrival flash, rim brighten, ambient pulse)
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      const t = f.age / f.dur;
      if (t >= 1) {
        this.release(f.sprite);
        this.flashes.splice(i, 1);
        continue;
      }
      f.sprite.scale.set(f.fromScale + (f.toScale - f.fromScale) * easeOutCubic(t));
      f.sprite.alpha = f.peakAlpha * Math.sin(Math.PI * Math.min(1, t)) ** 0.7;
    }

    // ticker-driven timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.left -= dt;
      if (tm.left <= 0) {
        this.timers.splice(i, 1);
        tm.fn();
      }
    }

    // the launch pull ends with the timer; clear the flag once its particles are gone
    if (this.launching && this.timers.length === 0 && this.launchResolvers.length === 0) this.launching = false;

    if (!this.hasLiveWork()) app.ticker.stop(); // idle: never render an empty stage
  };

  // ─── spawn helpers (pooled — §18) ───────────────────────────────────────────────────────────────────────

  private acquire(tex: Texture | null): Sprite | null {
    const root = this.root;
    if (!root || !tex) return null;
    if (root.children.length >= MAX_PARTICLES + 20) return null; // hard child bound
    const s = this.pool.pop() ?? new Sprite();
    s.texture = tex;
    s.anchor.set(0.5);
    s.rotation = 0;
    s.blendMode = 'add';
    s.visible = true;
    root.addChild(s);
    return s;
  }

  private release(s: Sprite): void {
    this.root?.removeChild(s);
    s.visible = false;
    if (this.pool.length < MAX_PARTICLES) this.pool.push(s);
    else s.destroy();
  }

  private spawnParticle(
    kind: Particle['kind'], tex: Texture | null, x: number, y: number, tint: number,
    opts: Partial<Omit<Particle, 'sprite' | 'kind' | 'x' | 'y' | 'maxLife'>> & { life: number },
    rotation = Math.random() * Math.PI * 2,
  ): void {
    if (this.particles.length >= MAX_PARTICLES) return; // bounded (§18)
    const sprite = this.acquire(tex);
    if (!sprite) return;
    sprite.tint = tint;
    sprite.rotation = rotation;
    const p: Particle = {
      sprite, kind, x, y,
      vx: opts.vx ?? 0, vy: opts.vy ?? 0,
      drag: opts.drag ?? 1,
      life: opts.life, maxLife: opts.life,
      fromScale: opts.fromScale ?? 1, toScale: opts.toScale ?? 1,
      peakAlpha: opts.peakAlpha ?? 1,
      spin: opts.spin ?? 0,
      gravity: opts.gravity ?? 0,
      fadeIn: opts.fadeIn ?? false,
    };
    sprite.position.set(x, y);
    sprite.scale.set(p.fromScale);
    sprite.alpha = p.fadeIn ? 0 : p.peakAlpha;
    if (kind === 'ambient') this.ambientCount++;
    this.particles.push(p);
  }

  private spawnAmbientMote(cfg: HeroCeremonyFxConfig): void {
    const b = cfg.portraitBounds;
    const x = b.left + Math.random() * Math.max(1, b.width);
    const y = b.top + b.height * (0.3 + Math.random() * 0.8);
    this.spawnParticle('ambient', this.sparkTex, x, y, cfg.accentColor, {
      vx: (Math.random() - 0.5) * 14, vy: -8 - Math.random() * 14,
      drag: 1, life: 2600 + Math.random() * 1400,
      fromScale: 0.25 + Math.random() * 0.3, toScale: 0.15, peakAlpha: 0.5, fadeIn: true,
    });
  }

  private spawnAmbientWisp(cfg: HeroCeremonyFxConfig): void {
    const b = cfg.portraitBounds;
    const x = b.left + Math.random() * Math.max(1, b.width);
    this.spawnParticle('wisp', this.wispTex, x, b.top + b.height * (0.75 + Math.random() * 0.25), cfg.accentColor, {
      vx: (Math.random() - 0.5) * 8, vy: -26 - Math.random() * 18,
      drag: 1, life: 1800 + Math.random() * 800,
      fromScale: 0.5, toScale: 0.8, peakAlpha: 0.16, fadeIn: true,
    }, -Math.PI / 2); // pointing up
  }

  private spawnRing(cx: number, cy: number, fromR: number, toR: number, dur: number, tint: number, peakAlpha: number): void {
    const sprite = this.acquire(this.ringTex);
    if (!sprite) return;
    sprite.tint = tint;
    sprite.position.set(cx, cy);
    sprite.scale.set(fromR / RING_TEX_R);
    sprite.alpha = peakAlpha;
    this.rings.push({ sprite, age: 0, dur, fromR, toR, peakAlpha });
  }

  private spawnFlash(tex: Texture | null, cx: number, cy: number, tint: number, peakAlpha: number, fromScale: number, toScale: number, dur: number): void {
    const sprite = this.acquire(tex);
    if (!sprite) return;
    sprite.tint = tint;
    sprite.position.set(cx, cy);
    sprite.scale.set(fromScale);
    sprite.alpha = 0;
    this.flashes.push({ sprite, age: 0, dur, peakAlpha, fromScale, toScale });
  }

  private spawnSweep(art: RectSnapshot, dur: number): void {
    const sprite = this.acquire(this.wispTex);
    if (!sprite) return;
    sprite.tint = 0xfff4dc;
    const x0 = art.left - art.width * 0.15;
    const y0 = art.top + art.height * 1.1;
    const x1 = art.left + art.width * 1.15;
    const y1 = art.top - art.height * 0.1;
    sprite.rotation = Math.atan2(y1 - y0, x1 - x0);
    sprite.scale.set(Math.max(2, art.height / 22), 2.4);
    sprite.position.set(x0, y0);
    sprite.alpha = 0;
    this.sweeps.push({ sprite, age: 0, dur, x0, y0, x1, y1 });
  }
}

// ─── texture builders (module-level; each runs ONCE per mount) ────────────────────────────────────────────

/** A small bright dot with a soft radial falloff — sparks, dust, motes. Tinted per sprite. */
function makeSparkTexture(app: Application): Texture {
  const g = new Graphics();
  for (let r = 8; r >= 1; r--) g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.18 });
  const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return tex;
}

/** A large soft glow — the bloom, flash, rim-brighten, and ambient pulse. */
function makeGlowTexture(app: Application): Texture {
  const g = new Graphics();
  for (let r = 40; r >= 2; r -= 2) g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.05 });
  const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return tex;
}

/** A thin rune-fragment sliver (bright core in a faint halo), drawn along +X so rotation orients it. */
function makeFragTexture(app: Application): Texture {
  const g = new Graphics();
  g.rect(-10, -2.6, 20, 5.2).fill({ color: 0xffffff, alpha: 0.16 });
  g.rect(-8, -1.4, 16, 2.8).fill({ color: 0xffffff, alpha: 0.9 });
  const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return tex;
}

/** A thin bright ring with a soft feather; natural radius RING_TEX_R, scaled to any on-screen radius. */
function makeRingTexture(app: Application): Texture {
  const g = new Graphics();
  g.circle(0, 0, RING_TEX_R).stroke({ width: 9, color: 0xffffff, alpha: 0.16 });
  g.circle(0, 0, RING_TEX_R).stroke({ width: 3, color: 0xffffff, alpha: 0.95 });
  const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return tex;
}

/** A soft feathered streak (layered ellipses), +X aligned — wisps and the materialize light sweep. */
function makeWispTexture(app: Application): Texture {
  const g = new Graphics();
  g.ellipse(0, 0, 26, 5).fill({ color: 0xffffff, alpha: 0.10 });
  g.ellipse(0, 0, 22, 3.2).fill({ color: 0xffffff, alpha: 0.18 });
  g.ellipse(-2, 0, 16, 1.8).fill({ color: 0xffffff, alpha: 0.30 });
  const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return tex;
}

/** The factory the ceremony component calls — one controller per ceremony, destroyed on unmount. */
export function createHeroCeremonyFx(): HeroCeremonyFxController {
  return new HeroCeremonyFx();
}
