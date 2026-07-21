/**
 * Tunable geometry + look for the WARD (Divine Shield) dome — the glassy energy shell over a DS card.
 *
 * The dome is pure CSS (`.card.compact.dscard .ward-*` in styles.css), a stack of layers rendered by
 * `Card.tsx`. It lives in the **archbox**, not `.art`: `.art` is `overflow: hidden` and only ~60% of the
 * card, so while the dome lived there it was hard-clipped to the portrait window and no CSS value could
 * make it reach the frame (owner 2026-07-21 — "I want the ward effect to engulf the card's frame as well").
 * Seated in the archbox at z3 it covers the whole frame, with the corner badges (z6) and keyword medallion
 * (z9) still painting on top so the numbers stay readable.
 *
 * Same pattern as `glowConfig.ts` / `flurryConfig.ts`: one mutable, localStorage-persisted config dialed by
 * eye via the DEV Ward tuner, reflected to `--wd-*` CSS vars on `:root`. **The shipped defaults live BOTH
 * here and as the CSS fallbacks in styles.css** (`var(--wd-inset, 0px)` …), so production renders correctly
 * without importing this module — when a value is dialed in, "Copy values" grabs the JSON and the CSS
 * fallbacks are updated to match.
 */
export interface WardConfig {
  /** Dome INSET from the card frame (px). 0 = exactly the arched frame box. NEGATIVE bleeds the dome OUT
   *  past the frame edge (nothing above it clips), positive pulls it in toward the portrait. */
  inset: number;
  /** Overall dome SCALE (×), applied after the inset — a cheap way to swell the glass without re-insetting. */
  scale: number;
  /** Corner rounding as a multiple of the card's `--arch-radius`. 1 = follow the frame exactly; higher
   *  rounds the dome toward an oval, lower squares it off. */
  radius: number;
  /** Energy-ring body opacity at the pulse PEAK (0–1). */
  bodyAlpha: number;
  /** Energy-ring opacity at the pulse TROUGH (0–1) — the low point of the slow breath. */
  pulseMin: number;
  /** Pulse period (seconds) — one full breath of the energy ring. */
  pulseSec: number;
  /** Hex-facet layer opacity (0–1) — the blue-white sphere facets. */
  hexAlpha: number;
  /** Hex-facet sphere SIZE (% of the dome box). ~100 fills it; lower shrinks the facet ball inside the dome. */
  hexSize: number;
  /** Inner vignette strength (0–1) — the deep-blue shading that gives the glass depth. */
  shadowAlpha: number;
  /** Glass reflection (upper-left shine) opacity (0–1). */
  spotAlpha: number;
  /** Outer blue aura BLUR (px) — the halo bleeding off the card. */
  auraBlur: number;
  /** Outer blue aura SPREAD (px). */
  auraSpread: number;
  /** Outer blue aura opacity (0–1). */
  auraAlpha: number;
  /** Breathing gold bloom opacity (0–1) — the slow `kwglow` pulse behind the card. */
  breathAlpha: number;
}

const DEFAULTS: WardConfig = {
  inset: 0,
  scale: 1,
  radius: 1,
  bodyAlpha: 1,
  pulseMin: 0.78,
  pulseSec: 3.8,
  hexAlpha: 0.79,
  hexSize: 99,
  shadowAlpha: 0.8,
  spotAlpha: 1,
  auraBlur: 16,
  auraSpread: 4,
  auraAlpha: 1,
  breathAlpha: 0.9,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const WARD_RANGES: Record<keyof WardConfig, [number, number, number]> = {
  inset: [-60, 40, 1],
  scale: [0.6, 1.6, 0.01],
  radius: [0, 3, 0.05],
  bodyAlpha: [0, 1, 0.01],
  pulseMin: [0, 1, 0.01],
  pulseSec: [0.5, 10, 0.1],
  hexAlpha: [0, 1, 0.01],
  hexSize: [40, 160, 1],
  shadowAlpha: [0, 1, 0.01],
  spotAlpha: [0, 1, 0.01],
  auraBlur: [0, 60, 1],
  auraSpread: [0, 30, 1],
  auraAlpha: [0, 1, 0.01],
  breathAlpha: [0, 1, 0.01],
};

export const WARD_KEYS = Object.keys(DEFAULTS) as (keyof WardConfig)[];

/** Tuner grouping — every key must appear in exactly one group (enforced by test) so a new dial can't be
 *  silently unreachable in the panel. */
export const WARD_GROUPS: { title: string; keys: (keyof WardConfig)[] }[] = [
  { title: 'Geometry · reach over the frame', keys: ['inset', 'scale', 'radius'] },
  { title: 'Energy ring', keys: ['bodyAlpha', 'pulseMin', 'pulseSec'] },
  { title: 'Glass', keys: ['hexAlpha', 'hexSize', 'shadowAlpha', 'spotAlpha'] },
  { title: 'Outer glow', keys: ['auraBlur', 'auraSpread', 'auraAlpha', 'breathAlpha'] },
];

const KEY = 'ascent.ward';
let cfg: WardConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<WardConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getWardConfig(): WardConfig {
  return cfg;
}

/** Keys currently differing from the shipped DEFAULTS — drives the tuner's "modified" banner so a dialed-in
 *  override is never silent. */
export function wardOverrides(): (keyof WardConfig)[] {
  return (Object.keys(DEFAULTS) as (keyof WardConfig)[]).filter((k) => cfg[k] !== DEFAULTS[k]);
}

/** Reflect the config to the `--wd-*` CSS vars the dome reads. Called on change + once at mount. */
export function applyWardVars(): void {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  s.setProperty('--wd-inset', `${cfg.inset}px`);
  s.setProperty('--wd-scale', String(cfg.scale));
  s.setProperty('--wd-radius', String(cfg.radius));
  s.setProperty('--wd-body-alpha', String(cfg.bodyAlpha));
  s.setProperty('--wd-pulse-min', String(cfg.pulseMin));
  s.setProperty('--wd-pulse-sec', `${cfg.pulseSec}s`);
  s.setProperty('--wd-hex-alpha', String(cfg.hexAlpha));
  s.setProperty('--wd-hex-size', `${cfg.hexSize}%`);
  s.setProperty('--wd-shadow-alpha', String(cfg.shadowAlpha));
  s.setProperty('--wd-spot-alpha', String(cfg.spotAlpha));
  s.setProperty('--wd-aura-blur', `${cfg.auraBlur}px`);
  s.setProperty('--wd-aura-spread', `${cfg.auraSpread}px`);
  s.setProperty('--wd-aura-alpha', String(cfg.auraAlpha));
  s.setProperty('--wd-breath-alpha', String(cfg.breathAlpha));
}

export function setWardValue(key: keyof WardConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
  applyWardVars();
}

export function resetWardConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  applyWardVars();
}
// Reflect persisted/default vars onto :root at load (dev only — this module is imported by the tuner via
// DevMenu, which is mounted only in dev; production relies on the CSS fallbacks that mirror DEFAULTS).
applyWardVars();
