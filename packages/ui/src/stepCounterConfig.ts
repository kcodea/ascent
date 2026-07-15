/**
 * Tunable placement + size for the STEP COUNTER — the white "X/N" numbers under a step-scaler card (Guel, Tara,
 * Avenge units, …). CSS-driven (the `.stepcounter` rule in styles.css), so this pushes its values into CSS custom
 * properties on :root via `applyStepCounterConfig()`. Every var has a CSS fallback equal to the shipped value, so
 * with no override the look is unchanged (and production, which never runs the dev tuner, is untouched).
 *
 * Dial by eye via the DEV Step Counter tuner (`StepCounterTuner.tsx`) — changes apply LIVE. "Copy" grabs the JSON;
 * to SHIP a look, paste the values back as the CSS fallbacks in styles.css (`.stepcounter` `font-size` / `left` /
 * `bottom`). "Reset" clears to defaults. Opened from the Dev Tuning Menu; dev-only.
 */
export interface StepCounterConfig {
  /** Number font size (px). Shipped ≈ 11.5 (was 0.72rem). */
  size: number;
  /** Horizontal offset from centre (px) — +right / −left. 0 = centred under the card. */
  x: number;
  /** Vertical placement (px) as the CSS `bottom` value — MORE NEGATIVE = lower/further below the card. */
  y: number;
}

const DEFAULTS: StepCounterConfig = {
  size: 20.5, // shipped .stepcounter font-size
  x: 1, // shipped horizontal nudge from centre
  y: -44, // shipped `bottom` (below the card's bottom edge)
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const SC_RANGES: Record<keyof StepCounterConfig, [number, number, number]> = {
  size: [6, 30, 0.5],
  x: [-60, 60, 1],
  y: [-48, 24, 1],
};
export const SC_KEYS = Object.keys(DEFAULTS) as (keyof StepCounterConfig)[];

const KEY = 'ascent.stepcounter';
let cfg: StepCounterConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<StepCounterConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

/** Push the config into the CSS custom properties on :root that `.stepcounter` reads. Values map 1:1 to the CSS
 *  fallbacks, so applying the defaults is a visual no-op. */
export function applyStepCounterConfig(): void {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  s.setProperty('--sc-size', `${cfg.size}px`);
  s.setProperty('--sc-x', `${cfg.x}px`);
  s.setProperty('--sc-y', `${cfg.y}px`);
}

export function getStepCounterConfig(): StepCounterConfig {
  return cfg;
}
export function setStepCounterValue(key: keyof StepCounterConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
  applyStepCounterConfig();
}
export function resetStepCounterConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  applyStepCounterConfig();
}

// Apply any saved override once at module load so a dialed-in look persists across reloads (pulled in by the
// dev-only tuner chain). With no saved config this just re-sets the CSS fallbacks — a no-op.
applyStepCounterConfig();
