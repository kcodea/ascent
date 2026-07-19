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
  /** Rise distance (px) the number drifts UP before it fades. 0 = STUCK to the card (the default — it holds
   *  on the struck minion and fades in place); higher = it floats up and off. */
  rise: number;
  /** Entry scale — how small the number starts before it pops in (smaller = snappier punch). */
  inScale: number;
  /** Entry offset (px) — how far BELOW its rest spot the number starts. */
  inY: number;
}

const DEFAULTS: FloatConfig = {
  size: 34,
  dmgSize: 42,
  durMs: 1400,
  pop: 1.18,
  rise: 0, // 0 = the number sticks to the card (holds + fades in place) instead of drifting off
  inScale: 0.5,
  inY: 14,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const FLOAT_RANGES: Record<keyof FloatConfig, [number, number, number]> = {
  size: [16, 64, 1],
  dmgSize: [20, 80, 1],
  durMs: [400, 3000, 50],
  pop: [1, 2, 0.02],
  rise: [0, 120, 2],
  inScale: [0.1, 1, 0.02],
  inY: [0, 40, 1],
};
export const FLOAT_KEYS = Object.keys(DEFAULTS) as (keyof FloatConfig)[];

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
  // Damage-only rise (its own var, so non-damage floats keep drifting up via base `floatup`'s --float-rise).
  s.setProperty('--float-dmg-rise', `${-cfg.rise}px`); // stored positive (drift up); CSS translateY is negative
  s.setProperty('--float-in-scale', `${cfg.inScale}`);
  s.setProperty('--float-in-y', `${cfg.inY}px`);
}

export function getFloatConfig(): FloatConfig {
  return cfg;
}
export function setFloatValue(key: keyof FloatConfig, value: number): void {
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
