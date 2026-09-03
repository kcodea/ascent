/**
 * Tunable parameters for the combat DAMAGE/heal NUMBER floats — the `.float` pills that pop up over a unit's
 * stat corner the instant a hit lands (rendered in Unit.tsx + the death overlay in Recruit.tsx). Their look is
 * CSS-driven (the `.float` rule + the `floatup` keyframe in styles.css), so unlike the JS-read tuners this one
 * pushes its values into CSS custom properties on :root via `applyFloatConfig()`. Every var has a CSS fallback
 * equal to the shipped value, so with no override the look is unchanged.
 *
 * Dial the size / pop punch / rise / entry by eye via the DEV Float tuner (`FloatTuner.tsx`) — changes apply
 * LIVE to the next float. "Copy" grabs the JSON; to SHIP a new look, paste the values back as the CSS
 * fallbacks in styles.css (`.float`, `.float.dmg`, `@keyframes floatup`) so production (which doesn't run the
 * dev tuner) picks them up. "Reset" clears to defaults.
 */
export interface FloatConfig {
  /** Base float font size (px) — poison/shield/reborn numbers (the damage pill has its own size below). */
  size: number;
  /** Damage-number pill font size (px) — the big −N over the struck unit. */
  dmgSize: number;
  /** Total pop+rise+fade duration (ms). */
  durMs: number;
  /** Pop overshoot — the scale the number punches to at the top of the pop (1 = no overshoot). */
  pop: number;
  /** Length of JUST the pop/bounce (ms) — the spring-in scale, on its own timeline so it is independent of the
   *  total `durMs`. Should stay ≤ `durMs` (a pop longer than the float's life gets cut off). */
  popMs: number;
  /** Rise distance (px) the number drifts UP before it fades. 0 = STUCK to the card (the default — it holds
   *  on the struck minion and fades in place); higher = it floats up and off. */
  rise: number;
  /** Entry scale — how small the number starts before it pops in (smaller = snappier punch). */
  inScale: number;
  /** Entry offset (px) — how far BELOW its rest spot the number starts. */
  inY: number;
  /** Which burst art sits behind the number — `'1'` (rounded, the original) or `'2'` (spikier). Mapped to a
   *  `url()` in `applyFloatConfig`; the two PNGs live in `apps/web/public/fx/`. */
  splashImg: string;
  /** Damage-splash backdrop size, in EM of the number — the golden burst behind the −N (see `.float.dmg::before`). */
  splashEm: number;
  /** Damage-number offset (px) from the struck card's centre. Nudges the number — and its backplate, which is a
   *  `::before` child and rides along. */
  numX: number;
  numY: number;
  /** Damage-splash backplate offset (px) RELATIVE to the number — nudges just the burst behind the digits. */
  splashX: number;
  splashY: number;
  /** Damage-number outline width (px) — a thin stroke round the digits for legibility over the burst. */
  numStroke: number;
  /** Damage-number outline colour (hex). */
  numStrokeColor: string;
  /** Randomly rotate each damage splash (0 = off, 1 = on) — a per-float deterministic angle so hits vary. */
  rotRandom: number;
  /** Max ± rotation (deg) applied to the splash when `rotRandom` is on. */
  rotRange: number;
}

// Owner-locked 2026-08-27 (dev Damage Float tuner): a 1.7× pop over a 400ms bounce, 0.3× entry, 0.9s on screen,
// the SPIKY burst (art 2) at 2.84× nudged 2px left, a thin 1.5px black number outline, and random per-hit
// splash rotation up to ±45°. Mirrored into the styles.css fallbacks (`.float`, `.float.dmg`, the `floatup*` /
// `dmgpop` keyframes).
const DEFAULTS: FloatConfig = {
  size: 42,
  dmgSize: 48,
  durMs: 900,
  pop: 1.7,
  popMs: 400,
  rise: 0, // 0 = the number sticks to the card (holds + fades in place) instead of drifting off
  inScale: 0.3,
  inY: 0,
  splashImg: '2',
  splashEm: 2.84,
  numX: 0,
  numY: 0,
  splashX: -2,
  splashY: 0,
  numStroke: 1.5,
  numStrokeColor: '#000000',
  rotRandom: 1,
  rotRange: 45,
};

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key (`numStrokeColor` is a colour and
 *  `splashImg` is a picker, so neither has a range). */
export const FLOAT_RANGES: Record<Exclude<keyof FloatConfig, 'numStrokeColor' | 'splashImg'>, [number, number, number]> = {
  size: [16, 64, 1],
  dmgSize: [20, 80, 1],
  durMs: [400, 3000, 50],
  pop: [1, 2, 0.02],
  popMs: [80, 1200, 10],
  rise: [0, 120, 2],
  inScale: [0.1, 1, 0.02],
  inY: [0, 40, 1],
  splashEm: [1, 6, 0.02],
  numX: [-60, 60, 1],
  numY: [-60, 60, 1],
  splashX: [-60, 60, 1],
  splashY: [-60, 60, 1],
  numStroke: [0, 4, 0.25],
  rotRandom: [0, 1, 1],
  rotRange: [0, 45, 1],
};

/** A public asset path as an ABSOLUTE `url()` for use inside a CSS custom property.
 *
 *  Two traps stack here. A bare `/fx/…` literal 404s under itch.io's CDN sub-path, so the path must carry
 *  `import.meta.env.BASE_URL` (see `publicAssetPaths.test.ts`). But in a production build that base is `./`,
 *  and Chromium resolves a RELATIVE url() inside a custom property against the stylesheet that reads the
 *  variable — `assets/index-*.css` — not the page. So the burst was requested from `assets/fx/…`, which does
 *  not exist, and every damage number in the itch + desktop builds lost its backdrop (owner report
 *  2026-09-02). Dev never showed it: its base is `/`, already absolute. Resolving against `document.baseURI`
 *  here makes the value absolute in every environment (dev `/`, itch sub-path, the desktop `app://` scheme). */
export function publicAssetCssUrl(relPath: string, baseURI?: string): string {
  // `document` is absent in the node test environment that imports this module for its pure helpers.
  const base = baseURI ?? (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/');
  return `url('${new URL(`${import.meta.env.BASE_URL}${relPath}`, base).href}')`;
}

/** The two burst PNGs the picker chooses between (served from `apps/web/public/fx/`). */
const SPLASH_IMG_URL: Record<string, string> = {
  '1': publicAssetCssUrl('fx/damage-splash.png'),
  '2': publicAssetCssUrl('fx/damage-splash-2.png'),
};
/** The shipped values, exported so the tuner can mark which controls you have moved away from them. */
export { DEFAULTS as FLOAT_DEFAULTS };

const KEY = 'ascent.float';
let cfg: FloatConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<FloatConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

/** The `.deathfloat .float` (killing-blow number) CSS animation length — mirrors `floatstickc`'s shipped
 *  0.9s, kept here so it can be speed-scaled alongside the main float. */
const DEATH_FLOAT_DUR_MS = 900;

/** Live combat speed, so the float ANIMATIONS shrink with it. The React cleanup timers divide by combatSpeed
 *  (`floatMs`/`deathFloatMs` in useCombatReplay) but the CSS durations were FIXED, and `floatup` holds
 *  opacity 1 until 80% — so above ~1.07× the number was removed from the DOM while still fully bright
 *  (at 1.6×: cleanup 937ms vs a 1400ms animation still at opacity 1). It popped out instead of fading. */
let speed = 1;

/** Set the live combat speed and re-push the vars. Call whenever `combatSpeed` changes. */
export function applyFloatSpeed(combatSpeed: number): void {
  speed = combatSpeed > 0 ? combatSpeed : 1;
  applyFloatConfig();
}

/** The speed-scaled CSS animation lengths (ms). Pure, so the "fade finishes before the cleanup timer removes
 *  the node" invariant is testable without a DOM — that invariant is exactly what broke above ~1.07×. */
export function floatDurations(combatSpeed: number): { floatDur: number; deathFloatDur: number } {
  const sp = combatSpeed > 0 ? combatSpeed : 1;
  return { floatDur: Math.round(cfg.durMs / sp), deathFloatDur: Math.round(DEATH_FLOAT_DUR_MS / sp) };
}

/** Push the config into the CSS custom properties on :root that `.float` + the `floatup` keyframe read.
 *  Values map 1:1 to the CSS fallbacks, so applying the defaults at 1× is a no-op visually. Durations are
 *  divided by the live combat speed so the fade always completes before the cleanup timer removes the node. */
export function applyFloatConfig(): void {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  s.setProperty('--float-size', `${cfg.size}px`);
  s.setProperty('--float-dmg-size', `${cfg.dmgSize}px`);
  const { floatDur, deathFloatDur } = floatDurations(speed);
  s.setProperty('--float-dur', `${floatDur}ms`);
  s.setProperty('--death-float-dur', `${deathFloatDur}ms`);
  s.setProperty('--float-pop', `${cfg.pop}`);
  // Pop/bounce length — its own timeline (see `dmgpop` in styles.css), divided by combat speed like the other
  // durations so the bounce stays proportional and finishes inside the (also-divided) float window.
  s.setProperty('--dmg-pop-dur', `${Math.round(cfg.popMs / speed)}ms`);
  // Damage-only rise (its own var, so non-damage floats keep drifting up via base `floatup`'s --float-rise).
  s.setProperty('--float-dmg-rise', `${-cfg.rise}px`); // stored positive (drift up); CSS translateY is negative
  s.setProperty('--float-in-scale', `${cfg.inScale}`);
  s.setProperty('--float-in-y', `${cfg.inY}px`);
  // Damage-splash backdrop + number stroke (the `rotRandom`/`rotRange` knobs are read by the float render in
  // Recruit.tsx, not pushed as vars — the angle is per-float, not global).
  s.setProperty('--dmg-splash-img', SPLASH_IMG_URL[cfg.splashImg] ?? SPLASH_IMG_URL['1']);
  s.setProperty('--dmg-splash-size', `${cfg.splashEm}em`);
  s.setProperty('--dmg-num-stroke', `${cfg.numStroke}px`);
  s.setProperty('--dmg-num-stroke-color', cfg.numStrokeColor);
  // Position nudges: the number offset moves the digits (backplate rides along); the splash offset moves the
  // burst relative to the number.
  s.setProperty('--dmg-num-x', `${cfg.numX}px`);
  s.setProperty('--dmg-num-y', `${cfg.numY}px`);
  s.setProperty('--dmg-splash-x', `${cfg.splashX}px`);
  s.setProperty('--dmg-splash-y', `${cfg.splashY}px`);
}

export function getFloatConfig(): FloatConfig {
  return cfg;
}
export function setFloatValue(key: keyof FloatConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
  applyFloatConfig();
}
export function resetFloatConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  applyFloatConfig();
}

// Apply any saved override once at module load, so a dialed-in look persists across reloads (the module is
// pulled in by the dev-only tuner chain). With no saved config this just re-sets the CSS fallbacks — a no-op.
applyFloatConfig();
