/**
 * Tunable look for the WARD (Divine Shield) — the light-blue hexagonal ENERGY SHELL encasing a DS card.
 *
 * The shell is `.wardglass` (styles.css "WARD GLASS"): a layer painted OVER the frame (z4 vs the frame's z3)
 * and shaped to the frame, so the whole card — gold included — sits inside the glass. The old inner `.ward`
 * dome (trimmed to the art window) was removed 2026-07-21; with the frame-wide shell it stacked into a
 * doubled honeycomb and two competing blues.
 *
 * DEFAULTS below are the owner's dialled values from `fx/ward-bubble-preview.html` (2026-07-21), a rig built
 * to match a concept render. The layers, in paint order: fill → hex shell → sheen → rim, with the halo cast
 * by the container itself.
 *
 * Same pattern as `glowConfig.ts`: one mutable, localStorage-persisted config dialled by eye via the DEV Ward
 * tuner, reflected to `--wg-*` CSS vars on `:root`. **The shipped values live BOTH here and as the CSS
 * fallbacks in styles.css**, so production renders correctly without importing this module (it's dev-only,
 * imported via DevMenu) — when a value is dialled in, "Copy values" grabs the JSON and the CSS fallbacks are
 * updated to match. Colours are baked in the CSS rather than dialled here.
 */
export interface WardConfig {
  // ---- bubble box: × the measured frame box, + a px nudge. Centre-anchored, so size grows symmetrically. ----
  /** Shell WIDTH × the frame box. Independent of height so the oval can be stretched to the frame. */
  domeW: number;
  /** Shell HEIGHT × the frame box. */
  domeH: number;
  /** Shell X nudge (px) from the frame centre. */
  domeX: number;
  /** Shell Y nudge (px) from the frame centre. */
  domeY: number;

  // ---- rim: the crisp white-hot edge. The layer that makes it read as a SHELL rather than a soft glow. ----
  /** Rim thickness (px). */
  rimW: number;
  /** Rim brightness (0–1). */
  rimA: number;
  /** Rim INNER glow blur (px) — energy bleeding inward from the edge. */
  rimIn: number;
  /** Rim inner-glow opacity (0–1). */
  rimInA: number;
  /** Rim OUTER glow blur (px) — the tight hot line just outside the edge. */
  rimOut: number;
  /** Rim outer-glow opacity (0–1). */
  rimOutA: number;

  // ---- halo: the wide soft bleed cast by the shell itself. ----
  /** Halo blur (px). */
  halo: number;
  /** Halo spread (px). */
  haloSpread: number;
  /** Halo opacity (0–1). */
  haloA: number;

  // ---- hex shell: the honeycomb. Size/position independent so the sphere can be stretched + seated. ----
  /** Facet sphere WIDTH (% of the shell box). */
  facetW: number;
  /** Facet sphere HEIGHT (% of the shell box). */
  facetH: number;
  /** Facet sphere X position (%). */
  facetX: number;
  /** Facet sphere Y position (%). */
  facetY: number;
  /** Facet opacity (0–1). */
  facetAlpha: number;
  /** How much of the CENTRE stays clearer (%) before the facets densen toward the rim — this is what makes
   *  the honeycomb read as a curved surface instead of a flat texture. */
  facetEdge: number;

  // ---- fill + sheen ----
  /** Tint at the CORE (0–1). Low keeps the art readable through the glass. */
  fillCore: number;
  /** Tint at the RIM (0–1). */
  fillEdge: number;
  /** Where the core→rim falloff begins (%). */
  fillStop: number;
  /** Glass reflection (upper-left) opacity (0–1). */
  sheen: number;

  // ---- breath ----
  /** Shell opacity at the pulse trough (0–1); the peak is always 1. */
  pulseMin: number;
  /** Breath period (seconds). */
  pulseSec: number;

  // ---- colours. Stored as hex and reflected as `r, g, b` triplets, so each layer's ALPHA stays its own
  // numeric dial (`rgba(var(--wg-rim-rgb), var(--wg-rim-a))`). The hex shell is the exception: it's painted
  // as a solid colour through an SVG mask, so it takes the hex string directly. ----
  /** Rim edge colour (the white-hot line). */
  rimColor: string;
  /** Rim INNER glow colour — the energy bleeding inward. */
  rimInColor: string;
  /** Rim OUTER glow colour — the hot line just outside the edge. */
  rimOutColor: string;
  /** Halo colour — the wide soft bleed. */
  haloColor: string;
  /** Fill colour at the CORE. */
  fillCoreColor: string;
  /** Fill colour at the RIM. */
  fillEdgeColor: string;
  /** Glass sheen colour. */
  sheenColor: string;
  /** Honeycomb colour. */
  hexColor: string;
}

/** Owner-dialled on `fx/ward-bubble-preview.html`, 2026-07-21. */
const DEFAULTS: WardConfig = {
  domeW: 1.05,
  domeH: 1,
  domeX: 0,
  domeY: 3,
  rimW: 1.7,
  rimA: 1,
  rimIn: 56,
  rimInA: 0.84,
  rimOut: 4,
  rimOutA: 0.97,
  halo: 0,
  haloSpread: -10,
  haloA: 0,
  facetW: 101,
  facetH: 102,
  facetX: 7,
  facetY: 50,
  facetAlpha: 1,
  facetEdge: 47,
  fillCore: 0,
  fillEdge: 0.86,
  fillStop: 74,
  sheen: 1,
  pulseMin: 0.75,
  pulseSec: 2.6,
  rimColor: '#e5f1ff',
  rimInColor: '#aa9ffe',
  rimOutColor: '#bdf2ff',
  haloColor: '#4d9afe',
  fillCoreColor: '#4da3fe',
  fillEdgeColor: '#3ddfff',
  sheenColor: '#ffffff',
  hexColor: '#e0f2ff',
};

/** Colour keys — rendered as swatches by the tuner, and excluded from the numeric slider ranges. */
export const WARD_COLOR_KEYS = ['rimColor', 'rimInColor', 'rimOutColor', 'haloColor', 'fillCoreColor', 'fillEdgeColor', 'sheenColor', 'hexColor'] as const;

/** '#rrggbb' -> 'r, g, b' so CSS can pair it with a separate alpha var. */
function rgbTriplet(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Slider bounds for the DEV tuner — [min, max, step] per key. Mirrors the preview rig's ranges. */
export const WARD_RANGES: Record<WardNumKey, [number, number, number]> = {
  domeW: [0.8, 1.5, 0.01],
  domeH: [0.8, 1.5, 0.01],
  domeX: [-40, 40, 1],
  domeY: [-40, 40, 1],
  rimW: [0, 8, 0.1],
  rimA: [0, 1, 0.01],
  rimIn: [0, 90, 1],
  rimInA: [0, 1, 0.01],
  rimOut: [0, 60, 1],
  rimOutA: [0, 1, 0.01],
  halo: [0, 90, 1],
  haloSpread: [-10, 30, 1],
  haloA: [0, 1, 0.01],
  facetW: [20, 260, 1],
  facetH: [20, 260, 1],
  facetX: [-50, 150, 1],
  facetY: [-50, 150, 1],
  facetAlpha: [0, 1, 0.01],
  facetEdge: [0, 100, 1],
  fillCore: [0, 1, 0.01],
  fillEdge: [0, 1, 0.01],
  fillStop: [0, 100, 1],
  sheen: [0, 1, 0.01],
  pulseMin: [0, 1, 0.01],
  pulseSec: [0.5, 10, 0.1],
};

/** Every numeric (slider) key. */
export type WardNumKey = Exclude<keyof WardConfig, (typeof WARD_COLOR_KEYS)[number]>;
export const WARD_KEYS = Object.keys(DEFAULTS).filter((k) => !(WARD_COLOR_KEYS as readonly string[]).includes(k)) as WardNumKey[];

/** Tuner grouping — every key must appear in exactly one group (enforced by test), so a new dial can't be
 *  silently unreachable in the panel. Mirrors the preview rig's groups. */
export const WARD_GROUPS: { title: string; keys: WardNumKey[] }[] = [
  { title: 'Bubble box', keys: ['domeW', 'domeH', 'domeX', 'domeY'] },
  { title: 'Rim · white-hot edge', keys: ['rimW', 'rimA', 'rimIn', 'rimInA', 'rimOut', 'rimOutA'] },
  { title: 'Halo · outer bleed', keys: ['halo', 'haloSpread', 'haloA'] },
  { title: 'Hex shell', keys: ['facetW', 'facetH', 'facetX', 'facetY', 'facetAlpha', 'facetEdge'] },
  { title: 'Fill & sheen', keys: ['fillCore', 'fillEdge', 'fillStop', 'sheen'] },
  { title: 'Breath', keys: ['pulseMin', 'pulseSec'] },
];

/** Colour swatches, grouped for the panel. */
export const WARD_COLOR_GROUPS: { title: string; keys: (typeof WARD_COLOR_KEYS)[number][] }[] = [
  { title: 'Colours', keys: ['rimColor', 'rimOutColor', 'rimInColor', 'haloColor', 'hexColor', 'fillCoreColor', 'fillEdgeColor', 'sheenColor'] },
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

/** Keys currently differing from the shipped DEFAULTS — drives the tuner's "modified" banner so a dialled-in
 *  override is never silent. */
export function wardOverrides(): (keyof WardConfig)[] {
  return (Object.keys(DEFAULTS) as (keyof WardConfig)[]).filter((k) => cfg[k] !== DEFAULTS[k]);
}

/** Reflect the config to the `--wg-*` CSS vars the shell reads. */
export function applyWardVars(): void {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  s.setProperty('--wg-w', String(cfg.domeW));
  s.setProperty('--wg-h', String(cfg.domeH));
  s.setProperty('--wg-x', `${cfg.domeX}px`);
  s.setProperty('--wg-y', `${cfg.domeY}px`);
  s.setProperty('--wg-rim-w', `${cfg.rimW}px`);
  s.setProperty('--wg-rim-a', String(cfg.rimA));
  s.setProperty('--wg-rim-in', `${cfg.rimIn}px`);
  s.setProperty('--wg-rim-in-a', String(cfg.rimInA));
  s.setProperty('--wg-rim-out', `${cfg.rimOut}px`);
  s.setProperty('--wg-rim-out-a', String(cfg.rimOutA));
  s.setProperty('--wg-halo', `${cfg.halo}px`);
  s.setProperty('--wg-halo-spread', `${cfg.haloSpread}px`);
  s.setProperty('--wg-halo-a', String(cfg.haloA));
  s.setProperty('--wg-hex-w', `${cfg.facetW}%`);
  s.setProperty('--wg-hex-h', `${cfg.facetH}%`);
  s.setProperty('--wg-hex-x', `${cfg.facetX}%`);
  s.setProperty('--wg-hex-y', `${cfg.facetY}%`);
  s.setProperty('--wg-hex-a', String(cfg.facetAlpha));
  s.setProperty('--wg-hex-edge', `${cfg.facetEdge}%`);
  s.setProperty('--wg-fill-core', String(cfg.fillCore));
  s.setProperty('--wg-fill-edge', String(cfg.fillEdge));
  s.setProperty('--wg-fill-stop', `${cfg.fillStop}%`);
  s.setProperty('--wg-sheen-a', String(cfg.sheen));
  s.setProperty('--wg-pulse-min', String(cfg.pulseMin));
  s.setProperty('--wg-pulse-s', `${cfg.pulseSec}s`);
  s.setProperty('--wg-rim-rgb', rgbTriplet(cfg.rimColor));
  s.setProperty('--wg-rim-in-rgb', rgbTriplet(cfg.rimInColor));
  s.setProperty('--wg-rim-out-rgb', rgbTriplet(cfg.rimOutColor));
  s.setProperty('--wg-halo-rgb', rgbTriplet(cfg.haloColor));
  s.setProperty('--wg-fill-core-rgb', rgbTriplet(cfg.fillCoreColor));
  s.setProperty('--wg-fill-edge-rgb', rgbTriplet(cfg.fillEdgeColor));
  s.setProperty('--wg-sheen-rgb', rgbTriplet(cfg.sheenColor));
  s.setProperty('--wg-hex-color', cfg.hexColor);
}

export function setWardValue(key: keyof WardConfig, value: number | string): void {
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
