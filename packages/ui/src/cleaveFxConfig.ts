/**
 * Tunable parameters for the CLEAVE FX — the raking claw-slash volley thrown across every unit a Cleave
 * attacker strikes in one clash (the main target plus both splashed neighbours).
 *
 * Same pattern as `strikeFxConfig.ts` / `flurrySwingConfig.ts`: one mutable, localStorage-persisted config
 * dialled by eye via the DEV "Cleave Slash FX" tuner (`CleaveFxTuner.tsx`); `getCleaveFxConfig()` is read at
 * spawn time, so edits apply to the NEXT cleave. The saved-config merge is **DEV-only** (see `dragFeel.ts`
 * and PR #615) — production always runs the baked DEFAULTS, so a dialled-in localStorage value can never
 * silently beat what's shipped on main.
 *
 * The volley is ONE package across the struck group, not a per-card burst (owner call 2026-07-21): the
 * slashes are laid out across the bounding box of every unit hit, so a three-wide Cleave reads as a single
 * rake rather than three separate hits. It REPLACES the generic `damageBurst` + `impactPulse` on those
 * victims — the same way Flurry's wind-slash replaces the standard strike VFX.
 *
 * PERF: the slash strokes are one `Graphics` redrawn per frame while the volley lives (the established
 * `auraWave` pattern) and the embers are pooled particles. Nothing loops — the whole thing is one-shot and
 * self-retiring, so no paint property is animated on a repeating timeline.
 */
export interface CleaveFxConfig {
  /** Horizontal nudge of the whole volley, in px. */
  offsetX: number;
  /** Vertical nudge of the whole volley, in px. */
  offsetY: number;
  /** Overall size multiplier for streak thickness + ember size (the span is set by `slashLen`). */
  scale: number;
  /** How many claw streaks in the volley. */
  slashCount: number;
  /** Streak length as a multiple of the struck group's width (1 = exactly spans it). */
  slashLen: number;
  /** Streak core thickness in px (before taper). */
  slashWidth: number;
  /** Volley angle in DEGREES (0 = horizontal; positive rakes down-right, matching the concept). */
  slashAngle: number;
  /** How far the streaks fan apart from each other, in px of perpendicular offset. */
  slashSpread: number;
  /** Random jitter applied per streak to its angle, in DEGREES (0 = a perfectly parallel rake). */
  slashJitter: number;
  /** Delay between successive streaks landing, in ms (the rake reads as a sequence, not a stamp). */
  slashStagger: number;
  /** How long one streak takes to draw itself on, in ms. */
  drawMs: number;
  /** How long a fully-drawn streak holds at full alpha, in ms. */
  holdMs: number;
  /** Fade-out time once the hold ends, in ms. */
  fadeMs: number;
  /** Bright inner core opacity. */
  coreAlpha: number;
  /** Outer glow thickness as a multiple of the core width. */
  glowWidth: number;
  /** Outer glow opacity. */
  glowAlpha: number;
  /** How sharply each streak tapers to a point at its ends (0 = a flat bar, 1 = a full needle). */
  taper: number;
  /** Ember shards flung off each streak. */
  emberCount: number;
  /** Ember launch speed multiplier. */
  emberSpeed: number;
  /** Ember lifetime in ms. */
  emberLife: number;
  /** Ember size multiplier. */
  emberSize: number;
  /** Hot flash bloomed at each struck unit as its streak lands (0 disables). */
  flashSize: number;
  /** Flash opacity. */
  flashAlpha: number;
  /** Flash duration in ms. */
  flashMs: number;
  /** Padding in px added around the struck group's bounding box before the volley is laid out. */
  pad: number;
  /** Bright inner core colour. */
  colorCore: string;
  /** Outer glow colour. */
  colorGlow: string;
  /** Ember shard colour. */
  colorEmber: string;
}

/** The shipped look: a hot orange-red rake, three long streaks sweeping down-right, embers trailing off. */
const DEFAULTS: CleaveFxConfig = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  slashCount: 3,
  slashLen: 1.35,
  slashWidth: 7,
  slashAngle: 24,
  slashSpread: 54,
  slashJitter: 5,
  slashStagger: 55,
  drawMs: 130,
  holdMs: 90,
  fadeMs: 240,
  coreAlpha: 1,
  glowWidth: 3.4,
  glowAlpha: 0.5,
  taper: 0.8,
  emberCount: 14,
  emberSpeed: 1,
  emberLife: 520,
  emberSize: 1,
  flashSize: 120,
  flashAlpha: 0.75,
  flashMs: 210,
  pad: 26,
  colorCore: '#fff2d0',
  colorGlow: '#ff3b12',
  colorEmber: '#ff8a2b',
};

/** Slider bounds for the DEV tuner — [min, max, step] per numeric key. */
export const CLEAVEFX_RANGES: Record<string, [number, number, number]> = {
  offsetX: [-400, 400, 2],
  offsetY: [-400, 400, 2],
  scale: [0.2, 3, 0.05],
  slashCount: [1, 8, 1],
  slashLen: [0.5, 2.5, 0.05],
  slashWidth: [1, 24, 0.5],
  slashAngle: [-80, 80, 1],
  slashSpread: [0, 160, 2],
  slashJitter: [0, 30, 1],
  slashStagger: [0, 200, 5],
  drawMs: [40, 500, 10],
  holdMs: [0, 400, 10],
  fadeMs: [40, 900, 10],
  coreAlpha: [0, 1, 0.02],
  glowWidth: [1, 8, 0.1],
  glowAlpha: [0, 1, 0.02],
  taper: [0, 1, 0.02],
  emberCount: [0, 40, 1],
  emberSpeed: [0, 3, 0.05],
  emberLife: [100, 1400, 20],
  emberSize: [0.2, 3, 0.05],
  flashSize: [0, 300, 5],
  flashAlpha: [0, 1, 0.02],
  flashMs: [40, 600, 10],
  pad: [0, 120, 2],
};

/** Numeric keys, in tuner order. Colours are dialled separately (swatch inputs). */
export const CLEAVEFX_KEYS = Object.keys(CLEAVEFX_RANGES) as (keyof CleaveFxConfig)[];
/** Colour keys, dialled with swatches rather than sliders. */
export const CLEAVEFX_COLOR_KEYS: (keyof CleaveFxConfig)[] = ['colorCore', 'colorGlow', 'colorEmber'];

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
