/**
 * Tunable parameters for the CLEAVE FX — the full beat a Cleave attacker plays when it connects.
 *
 * The sequence, in order (owner spec 2026-07-21):
 *   1. the strike lands,
 *   2. the lunge FREEZES at the contact pose for `hitStopMs` (the hit-stop — the blow has weight),
 *   3. a horizontal CLAW SLASH rakes across the whole cleaved area (the struck unit plus every splashed
 *      neighbour), with blood drips running down out of the cut,
 *   4. the attacker holds `returnDelayMs` so the slash reads, then the beat ends and it settles back to its
 *      warband slot.
 *
 * Steps 2 and 4 are holds inside the existing lunge timeline (the same mechanism the wind-up's `rallyPauseMs`
 * uses), so they stay killable, seekable and speed-scaled with the swing. Step 3 rides the ordinary impact
 * channel and REPLACES the standard strike burst, the way Flurry's wind-slash does.
 *
 * Same config pattern as `strikeFxConfig.ts` / `flurrySwingConfig.ts`: one mutable, localStorage-persisted
 * config dialled by eye via the DEV "Cleave Slash FX" tuner (`CleaveFxTuner.tsx`); `getCleaveFxConfig()` is
 * read at spawn time, so edits apply to the NEXT cleave. The saved-config merge is **DEV-only** (see
 * `dragFeel.ts` and PR #615) — production always runs the baked DEFAULTS, so a dialled-in localStorage value
 * can never silently beat what's shipped on main.
 *
 * PERF: the slash strokes are one `Graphics` redrawn per frame while the effect lives (the established
 * `auraWave` pattern); the drips and the flash are pooled particles. One-shot and self-retiring — no looping
 * animation touches a paint property.
 */
export interface CleaveFxConfig {
  // ── timing: the hit-stop and the return ──────────────────────────────────────────────────────────────
  /** How long the lunge freezes at the contact pose before the slash rakes, in ms. 0 disables the hit-stop. */
  hitStopMs: number;
  /** How long the attacker holds out there AFTER the slash fires, before it settles home, in ms. This is what
   *  makes the beat read "hit → freeze → slash → return" instead of the slash chasing a card that has already
   *  left. Drips keep falling on their own after the attacker has gone. */
  returnDelayMs: number;

  // ── placement over the cleaved area ──────────────────────────────────────────────────────────────────
  /** Horizontal nudge of the whole slash, in px. */
  offsetX: number;
  /** Vertical nudge of the whole slash, in px. */
  offsetY: number;
  /** Overall size multiplier (stroke thickness, drips, flash). */
  scale: number;
  /** Slash length in PX, at the reference board scale (the renderer multiplies by the stage scale, so it
   *  shrinks with the cards on a small screen). Deliberately an ABSOLUTE length rather than a multiple of
   *  anything measured: the rake must look identical whatever it hits — and it makes the tuner's Test button
   *  and a real cleave draw the same cut, which a card-relative span did not (owner report 2026-07-21). */
  spanPx: number;

  // ── the claw slash ───────────────────────────────────────────────────────────────────────────────────
  /** How many parallel claw streaks make up the rake. */
  slashCount: number;
  /** Vertical gap between the streaks, in px. */
  slashSpacing: number;
  /** Streak core thickness in px at its fattest (it tapers to a point at both ends). */
  slashWidth: number;
  /** How sharply a streak needles at its ends (0 = a flat bar, 1 = a full needle). */
  slashTaper: number;
  /** Streak tilt off horizontal, in DEGREES (small values keep it reading as a horizontal rake). */
  slashTilt: number;
  /** Random per-streak tilt scatter, in DEGREES. */
  slashJitter: number;
  /** How much a streak bows (sags) at its middle, in px. 0 = dead straight. */
  slashBow: number;
  /** Delay between successive streaks raking, in ms. */
  slashStagger: number;
  /** How long one streak takes to rake across, in ms. */
  sweepMs: number;
  /** How long a fully-raked streak holds, in ms. */
  holdMs: number;
  /** Streak fade-out time, in ms. */
  fadeMs: number;
  /** How the fade reads: 1 = the gash RETRACTS from where it started (the tail eats forward to the tip, like
   *  a tendril withdrawing); 0 = it dissolves in place at uniform alpha. Anything between blends the two. */
  retract: number;
  /** Bright inner core opacity. */
  coreAlpha: number;
  /** Outer glow thickness as a multiple of the core width. */
  glowWidth: number;
  /** Outer glow opacity. */
  glowAlpha: number;

  // ── the claw tips ────────────────────────────────────────────────────────────────────────────────────
  /** How far the claw point juts AHEAD of the cut it is opening, in px. 0 disables the claws. */
  clawLen: number;
  /** Claw base width in px (it tapers to a point at the tip). */
  clawWidth: number;
  /** How far the claw's base sits BEHIND the leading edge, in px — a longer overlap roots it in the wound
   *  instead of floating off the end. */
  clawRoot: number;
  /** Where along the claw its widest point sits, 0..1 from root to tip. Low values put the bulk near the
   *  knuckle and let it taper to a long point; 0.5 is a symmetric leaf. This is what stops it reading as an
   *  arrowhead — the claw swells out of the rake and narrows away, rather than ending in a flat base. */
  clawBulge: number;
  /** Sideways hook at the tip, in px — the talon's curve. 0 = a straight spike; positive hooks one way,
   *  negative the other. */
  clawHook: number;
  /** Claw opacity while it is cutting. */
  clawAlpha: number;
  /** How long a claw lingers after its stroke has finished raking, in ms (it fades out over this). */
  clawFadeMs: number;

  // ── blood drips ──────────────────────────────────────────────────────────────────────────────────────
  /** Drips shed per streak. */
  dripCount: number;
  /** Drip size multiplier. */
  dripSize: number;
  /** How elongated a drip is as it falls (1 = round). */
  dripStretch: number;
  /** Initial downward speed, px/s. */
  dripSpeed: number;
  /** Downward acceleration, px/s² — what makes them run rather than float. */
  dripGravity: number;
  /** Sideways scatter as they leave the cut, px/s. */
  dripDrift: number;
  /** Drip lifetime in ms. */
  dripLife: number;
  /** Drip opacity. */
  dripAlpha: number;

  // ── the contact flash ────────────────────────────────────────────────────────────────────────────────
  /** Hot flash bloomed at the contact point (0 disables). */
  flashSize: number;
  /** Flash opacity. */
  flashAlpha: number;
  /** Flash duration in ms. */
  flashMs: number;

  // ── colours ──────────────────────────────────────────────────────────────────────────────────────────
  /** Bright inner core colour (the hot centre of the cut). */
  colorCore: string;
  /** Claw-tip colour — the point doing the cutting, so it usually wants to be hotter than the wound. */
  colorClaw: string;
  /** Outer glow colour (the red body of the slash). */
  colorGlow: string;
  /** Drip colour. */
  colorDrip: string;
  /** Flash colour at the contact point. */
  colorFlash: string;
}

/** The owner's dialled values (2026-07-21), pasted straight from the tuner's "Copy values". `retract` is the
 *  one number not in that export — it was added with this pass and defaults to a full withdraw. */
const DEFAULTS: CleaveFxConfig = {
  hitStopMs: 85,
  returnDelayMs: 440,

  offsetX: 0,
  offsetY: 0,
  scale: 1.2,
  spanPx: 600,

  slashCount: 3,
  slashSpacing: 33,
  slashWidth: 12,
  slashTaper: 0.92,
  slashTilt: 6,
  slashJitter: 0,
  slashBow: -23,
  slashStagger: 40,
  sweepMs: 65,
  holdMs: 175,
  fadeMs: 510,
  retract: 1,
  coreAlpha: 1,
  glowWidth: 1,
  glowAlpha: 0.6,

  clawLen: 32,
  clawWidth: 8,
  clawRoot: 30,
  clawBulge: 0.3,
  clawHook: 7,
  clawAlpha: 1,
  clawFadeMs: 140,

  dripCount: 6,
  dripSize: 0.75,
  dripStretch: 1,
  dripSpeed: 10,
  dripGravity: 520,
  dripDrift: 18,
  dripLife: 810,
  dripAlpha: 0.8,

  flashSize: 310,
  flashAlpha: 0.7,
  flashMs: 340,

  colorCore: '#940000',
  colorClaw: '#ff6b6b',
  colorGlow: '#c20017',
  colorDrip: '#a30d1c',
  colorFlash: '#ff5c5c',
};

/** Slider bounds for the DEV tuner — [min, max, step] per numeric key. */
export const CLEAVEFX_RANGES: Record<string, [number, number, number]> = {
  hitStopMs: [0, 500, 5],
  returnDelayMs: [0, 900, 10],

  offsetX: [-300, 300, 2],
  offsetY: [-300, 300, 2],
  scale: [0.2, 3, 0.05],
  spanPx: [60, 1200, 10],

  slashCount: [1, 8, 1],
  slashSpacing: [0, 90, 1],
  slashWidth: [1, 40, 0.5],
  slashTaper: [0, 1, 0.02],
  slashTilt: [-45, 45, 1],
  slashJitter: [0, 25, 1],
  slashBow: [-60, 60, 1],
  slashStagger: [0, 200, 5],
  sweepMs: [20, 500, 5],
  holdMs: [0, 400, 5],
  fadeMs: [40, 900, 10],
  retract: [0, 1, 0.05],
  coreAlpha: [0, 1, 0.02],
  glowWidth: [1, 8, 0.1],
  glowAlpha: [0, 1, 0.02],

  clawLen: [0, 120, 1],
  clawWidth: [1, 60, 0.5],
  clawRoot: [0, 120, 1],
  clawBulge: [0.05, 0.95, 0.01],
  clawHook: [-40, 40, 1],
  clawAlpha: [0, 1, 0.02],
  clawFadeMs: [0, 600, 10],

  dripCount: [0, 20, 1],
  dripSize: [0.2, 3, 0.05],
  dripStretch: [1, 6, 0.1],
  dripSpeed: [0, 300, 5],
  dripGravity: [0, 1400, 20],
  dripDrift: [0, 120, 2],
  dripLife: [150, 2000, 20],
  dripAlpha: [0, 1, 0.02],

  flashSize: [0, 400, 5],
  flashAlpha: [0, 1, 0.02],
  flashMs: [40, 600, 10],
};

/** Numeric keys, in tuner order. Colours are dialled separately (swatch inputs). */
export const CLEAVEFX_KEYS = Object.keys(CLEAVEFX_RANGES) as (keyof CleaveFxConfig)[];
/** Colour keys, dialled with swatches rather than sliders. */
export const CLEAVEFX_COLOR_KEYS: (keyof CleaveFxConfig)[] = ['colorCore', 'colorClaw', 'colorGlow', 'colorDrip', 'colorFlash'];

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
