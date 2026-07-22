/**
 * Tunable parameters for the CLEAVE FX — the **hit-stop + red gash** a Cleave attacker plays when it connects.
 *
 * The beat, in order: the strike lands → the lunge FREEZES at the contact pose for `hitStopMs` (the hit-stop,
 * so the blow has weight) → the gash erupts: sweeping crescent arcs with a white-hot core and a deep red
 * glow, a hot flash at the contact point, and red shards flung along the cut.
 *
 * It rides the ordinary impact channel and REPLACES the standard strike burst, exactly the way Flurry's
 * wind-slash does (`playContactImpact`) — so it fires on the Cleave attacker's own swing, anchored on the
 * unit it struck, rather than being laid out across the splashed group.
 *
 * Same config pattern as `strikeFxConfig.ts` / `flurrySwingConfig.ts`: one mutable, localStorage-persisted
 * config dialled by eye via the DEV "Cleave Gash FX" tuner (`CleaveFxTuner.tsx`); `getCleaveFxConfig()` is
 * read at spawn time, so edits apply to the NEXT cleave. The saved-config merge is **DEV-only** (see
 * `dragFeel.ts` and PR #615) — production always runs the baked DEFAULTS, so a dialled-in localStorage value
 * can never silently beat what's shipped on main.
 *
 * PERF: the arcs are one `Graphics` redrawn per frame while the gash lives (the established `auraWave`
 * pattern) and the shards are pooled particles. One-shot and self-retiring — no looping animation touches a
 * paint property. The hit-stop is a GSAP hold inside the existing lunge timeline (the `rallyPauseMs`
 * mechanism), so it scales with combat speed and stays killable/seekable with the rest of the swing.
 */
export interface CleaveFxConfig {
  // ── the hit-stop ─────────────────────────────────────────────────────────────────────────────────────
  /** How long the lunge freezes at the contact pose before the gash erupts, in ms. 0 disables the hit-stop. */
  hitStopMs: number;

  // ── placement ────────────────────────────────────────────────────────────────────────────────────────
  /** Horizontal nudge of the whole gash, in px (along the screen, not the blow). */
  offsetX: number;
  /** Vertical nudge of the whole gash, in px. */
  offsetY: number;
  /** Overall size multiplier for the arcs, flash and shards. */
  scale: number;

  // ── the crescent arcs ────────────────────────────────────────────────────────────────────────────────
  /** How many crescent arcs make up the gash. */
  arcCount: number;
  /** Arc radius in px (the sweep's curvature — larger = flatter, wider slash). */
  arcRadius: number;
  /** How much of the circle each arc spans, in DEGREES. */
  arcSweep: number;
  /** Arc core thickness in px at its fattest (it tapers to a point at both ends). */
  arcWidth: number;
  /** How sharply an arc needles at its ends (0 = a flat band, 1 = a full needle). */
  arcTaper: number;
  /** Rotation of the gash relative to the blow direction, in DEGREES. */
  arcAngle: number;
  /** Random per-arc angle scatter, in DEGREES. */
  arcJitter: number;
  /** How far successive arcs sit apart along the blow, in px. */
  arcSpacing: number;
  /** Delay between successive arcs erupting, in ms. */
  arcStagger: number;
  /** How long an arc takes to sweep itself on, in ms. */
  sweepMs: number;
  /** How long a fully-swept arc holds, in ms. */
  holdMs: number;
  /** Arc fade-out time, in ms. */
  fadeMs: number;
  /** How much an arc grows as it fades (1 = no growth — the cut opening up). */
  arcGrow: number;
  /** Bright inner core opacity. */
  coreAlpha: number;
  /** Outer glow thickness as a multiple of the core width. */
  glowWidth: number;
  /** Outer glow opacity. */
  glowAlpha: number;

  // ── the flash + shards ───────────────────────────────────────────────────────────────────────────────
  /** Hot flash bloomed at the contact point (0 disables). */
  flashSize: number;
  /** Flash opacity. */
  flashAlpha: number;
  /** Flash duration in ms. */
  flashMs: number;
  /** Red shards flung along the cut. */
  shardCount: number;
  /** Shard launch-speed multiplier. */
  shardSpeed: number;
  /** How wide the shards fan around the cut line, in DEGREES. */
  shardSpread: number;
  /** Shard lifetime in ms. */
  shardLife: number;
  /** Shard size multiplier. */
  shardSize: number;
  /** Downward pull on the shards (px/s²) — 0 = they fly straight. */
  shardGravity: number;

  // ── colours ──────────────────────────────────────────────────────────────────────────────────────────
  /** Bright inner core colour (the white-hot centre of the cut). */
  colorCore: string;
  /** Outer glow colour (the red body of the gash). */
  colorGlow: string;
  /** Flash colour at the contact point. */
  colorFlash: string;
  /** Shard colour. */
  colorShard: string;
}

/** The shipped look: a short freeze, then two hot-cored crimson crescents tearing across with red shards. */
const DEFAULTS: CleaveFxConfig = {
  hitStopMs: 110,

  offsetX: 0,
  offsetY: 0,
  scale: 1,

  arcCount: 3,
  arcRadius: 250,
  arcSweep: 40,
  arcWidth: 11,
  arcTaper: 0.96,
  arcAngle: -26,
  arcJitter: 8,
  arcSpacing: 26,
  arcStagger: 45,
  sweepMs: 110,
  holdMs: 60,
  fadeMs: 260,
  arcGrow: 1.18,
  coreAlpha: 1,
  glowWidth: 2.6,
  glowAlpha: 0.62,

  flashSize: 150,
  flashAlpha: 0.85,
  flashMs: 190,
  shardCount: 16,
  shardSpeed: 1,
  shardSpread: 60,
  shardLife: 560,
  shardSize: 1,
  shardGravity: 140,

  colorCore: '#fff3d6',
  colorGlow: '#e01414',
  colorFlash: '#ff5a2b',
  colorShard: '#d81a1a',
};

/** Slider bounds for the DEV tuner — [min, max, step] per numeric key. */
export const CLEAVEFX_RANGES: Record<string, [number, number, number]> = {
  hitStopMs: [0, 500, 5],

  offsetX: [-300, 300, 2],
  offsetY: [-300, 300, 2],
  scale: [0.2, 3, 0.05],

  arcCount: [1, 6, 1],
  arcRadius: [40, 500, 5],
  arcSweep: [10, 220, 2],
  arcWidth: [1, 50, 0.5],
  arcTaper: [0, 1, 0.02],
  arcAngle: [-180, 180, 2],
  arcJitter: [0, 40, 1],
  arcSpacing: [0, 160, 2],
  arcStagger: [0, 250, 5],
  sweepMs: [20, 600, 5],
  holdMs: [0, 400, 5],
  fadeMs: [40, 900, 10],
  arcGrow: [1, 2.5, 0.02],
  coreAlpha: [0, 1, 0.02],
  glowWidth: [1, 8, 0.1],
  glowAlpha: [0, 1, 0.02],

  flashSize: [0, 400, 5],
  flashAlpha: [0, 1, 0.02],
  flashMs: [40, 600, 10],
  shardCount: [0, 50, 1],
  shardSpeed: [0, 3, 0.05],
  shardSpread: [0, 360, 5],
  shardLife: [100, 1400, 20],
  shardSize: [0.2, 3, 0.05],
  shardGravity: [0, 600, 10],
};

/** Numeric keys, in tuner order. Colours are dialled separately (swatch inputs). */
export const CLEAVEFX_KEYS = Object.keys(CLEAVEFX_RANGES) as (keyof CleaveFxConfig)[];
/** Colour keys, dialled with swatches rather than sliders. */
export const CLEAVEFX_COLOR_KEYS: (keyof CleaveFxConfig)[] = ['colorCore', 'colorGlow', 'colorFlash', 'colorShard'];

const KEY = 'ascent.cleavefx';
let cfg: CleaveFxConfig = (() => {
  // DEV-only merge: production always runs the baked DEFAULTS so a saved tuner value can't beat main.
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<CleaveFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getCleaveFxConfig(): CleaveFxConfig {
  return cfg;
}

export function setCleaveFxValue(key: keyof CleaveFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

export function resetCleaveFxConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
