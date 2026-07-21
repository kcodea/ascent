/**
 * Tunable geometry + look for the WARD (Divine Shield) dome — the glassy energy shell over a DS card.
 *
 * The dome is pure CSS (`.card.compact.dscard .ward-*` in styles.css), a stack of layers rendered by
 * `Card.tsx` INSIDE `.art` — the per-frame rules seat an oversized round dome and rely on `.art`'s ellipse /
 * `--heater` clip to trim it to the window, so it must stay there (moving it out was tried 2026-07-21 and
 * reverted: the untrimmed dome rendered as a blob).
 *
 * SCOPE — this owns the dome's LOOK only. Its GEOMETRY (size + vertical seat) is per-frame and already
 * live-tunable as `--wardsize` / `--wardy` in the **Card Frames** tuner: `.card.compact.stdframe.dscard .ward`
 * and `.taunt.dscard .ward` seat an oversized round dome and let `.art`'s ellipse / `--heater` clip trim it to
 * the window. Those rules set their own `inset`/`transform`, so any geometry dial here would be silently
 * overridden — which is why this config deliberately has none.
 *
 * Same pattern as `glowConfig.ts` / `flurryConfig.ts`: one mutable, localStorage-persisted config dialed by
 * eye via the DEV Ward tuner, reflected to `--wd-*` CSS vars on `:root`. **The shipped defaults live BOTH
 * here and as the CSS fallbacks in styles.css** (`var(--wd-inset, 0px)` …), so production renders correctly
 * without importing this module — when a value is dialed in, "Copy values" grabs the JSON and the CSS
 * fallbacks are updated to match.
 */
export interface WardConfig {
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
