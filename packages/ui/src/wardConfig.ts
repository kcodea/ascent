/**
 * Tunable geometry + look for the WARD (Divine Shield) dome — the glassy energy shell over a DS card.
 *
 * The shell is `.wardglass` (styles.css "WARD GLASS") — a layer painted OVER the frame and clipped to its
 * silhouette. The OLD inner dome (a `.ward` stack inside the art window) was removed 2026-07-21: with the
 * frame-wide shell it stacked into a doubled honeycomb and two competing blues (owner). Dials that drove only
 * that dome went with it; `bodyAlpha`/`pulseMin`/`pulseSec` stay because the glass body shares its keyframes.
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
  /** Outer blue aura BLUR (px) — the halo bleeding off the card. */
  auraBlur: number;
  /** Outer blue aura SPREAD (px). */
  auraSpread: number;
  /** Outer blue aura opacity (0–1). */
  auraAlpha: number;
  /** Breathing gold bloom opacity (0–1) — the slow `kwglow` pulse behind the card. */
  breathAlpha: number;

  // ---- WARD GLASS: the layer painted OVER the frame (approach B). These geometry dials are genuinely live —
  // unlike the inner dome, nothing else styles this element, so nothing can override them. ----
  /** Whole-glass opacity (0–1). 0 = frame untouched (inner dome only). */
  glassAlpha: number;
  /** Glass WIDTH × the frame box. 1 = exactly the frame; independent of height so the oval can be stretched. */
  domeW: number;
  /** Glass HEIGHT × the frame box. */
  domeH: number;
  /** Glass X nudge (px) from the frame centre. */
  domeX: number;
  /** Glass Y nudge (px) from the frame centre. */
  domeY: number;
  /** Facet sphere WIDTH (% of the glass box). */
  facetW: number;
  /** Facet sphere HEIGHT (% of the glass box) — independent, so it can be stretched to the oval. */
  facetH: number;
  /** Facet sphere X position (%). 50 = centred. */
  facetX: number;
  /** Facet sphere Y position (%). 50 = centred. */
  facetY: number;
  /** Facet opacity (0–1). */
  facetAlpha: number;
  /** Glass reflection (upper-left shine) opacity (0–1). */
  glassSpot: number;
}

const DEFAULTS: WardConfig = {
  bodyAlpha: 1,
  pulseMin: 0.78,
  pulseSec: 3.8,
  auraBlur: 16,
  auraSpread: 4,
  auraAlpha: 1,
  breathAlpha: 0.9,
  glassAlpha: 0.55,
  domeW: 1,
  domeH: 1,
  domeX: 0,
  domeY: 0,
  facetW: 118,
  facetH: 118,
  facetX: 50,
  facetY: 50,
  facetAlpha: 0.6,
  glassSpot: 1,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const WARD_RANGES: Record<keyof WardConfig, [number, number, number]> = {
  bodyAlpha: [0, 1, 0.01],
  pulseMin: [0, 1, 0.01],
  pulseSec: [0.5, 10, 0.1],
  auraBlur: [0, 60, 1],
  auraSpread: [0, 30, 1],
  auraAlpha: [0, 1, 0.01],
  breathAlpha: [0, 1, 0.01],
  glassAlpha: [0, 1, 0.01],
  domeW: [0.5, 2, 0.01],
  domeH: [0.5, 2, 0.01],
  domeX: [-80, 80, 1],
  domeY: [-80, 80, 1],
  facetW: [20, 260, 1],
  facetH: [20, 260, 1],
  facetX: [-50, 150, 1],
  facetY: [-50, 150, 1],
  facetAlpha: [0, 1, 0.01],
  glassSpot: [0, 1, 0.01],
};

export const WARD_KEYS = Object.keys(DEFAULTS) as (keyof WardConfig)[];

/** Tuner grouping — every key must appear in exactly one group (enforced by test) so a new dial can't be
 *  silently unreachable in the panel. */
export const WARD_GROUPS: { title: string; keys: (keyof WardConfig)[] }[] = [
  { title: 'Energy pulse', keys: ['bodyAlpha', 'pulseMin', 'pulseSec'] },
  { title: 'Glass over the frame', keys: ['glassAlpha', 'domeW', 'domeH', 'domeX', 'domeY', 'glassSpot'] },
  { title: 'Glass facets', keys: ['facetW', 'facetH', 'facetX', 'facetY', 'facetAlpha'] },
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
  s.setProperty('--wd-aura-blur', `${cfg.auraBlur}px`);
  s.setProperty('--wd-aura-spread', `${cfg.auraSpread}px`);
  s.setProperty('--wd-aura-alpha', String(cfg.auraAlpha));
  s.setProperty('--wd-breath-alpha', String(cfg.breathAlpha));
  // ---- ward glass (over the frame) ----
  s.setProperty('--wg-alpha', String(cfg.glassAlpha));
  s.setProperty('--wg-w', String(cfg.domeW));
  s.setProperty('--wg-h', String(cfg.domeH));
  s.setProperty('--wg-x', `${cfg.domeX}px`);
  s.setProperty('--wg-y', `${cfg.domeY}px`);
  s.setProperty('--wg-hex-w', `${cfg.facetW}%`);
  s.setProperty('--wg-hex-h', `${cfg.facetH}%`);
  s.setProperty('--wg-hex-x', `${cfg.facetX}%`);
  s.setProperty('--wg-hex-y', `${cfg.facetY}%`);
  s.setProperty('--wg-hex-a', String(cfg.facetAlpha));
  s.setProperty('--wg-spot-a', String(cfg.glassSpot));
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
