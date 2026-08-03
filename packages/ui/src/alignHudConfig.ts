/**
 * Tunable look for the CELESTIAL ALIGNMENT HUD — the Dawn/Dusk horizon strip under the warband (owner ask
 * 2026-08-03: width, length, opacity, colours, vibrance, glow, and the play-spark effect).
 *
 * Same contract as every other config module: one mutable, localStorage-persisted object, dialled live from
 * the DEV tuner (`AlignHudTuner`), reflected onto `--ah-*` CSS vars that the pure-CSS strip reads. The
 * SHIPPED defaults live BOTH here and as the CSS `var(--ah-*, …)` fallbacks in styles.css — dial a look in,
 * "Copy values", then update both.
 */
export interface AlignHudConfig {
  /** Strip LENGTH — how much of the warband row the horizon spans (% of the row width). */
  length: number;
  /** Sky bar THICKNESS (px) — the gradient band itself, labels excluded. */
  width: number;
  /** Whole-strip opacity (0–1). */
  opacity: number;
  /** Dawn-side colour (hex). */
  dawnColor: string;
  /** Dusk-side colour (hex). */
  duskColor: string;
  /** Eclipse seam colour (hex). */
  seamColor: string;
  /** VIBRANCE — saturation multiplier on the sky gradient (1 = as-authored; below mutes, above enriches). */
  vibrance: number;
  /** Seam GLOW radius (px) — the static soft halo around the Eclipse band. */
  glowBlur: number;
  /** Seam GLOW opacity (0–1). */
  glowAlpha: number;
  /** PLAY SPARK — master switch (0/1; numeric so the shared tuner toggle can drive it) for the side-flash
   *  when a minion lands on a side / an aligned effect fires. */
  sparkOn: number;
  /** Spark flash duration (ms). */
  sparkMs: number;
  /** Spark flash peak opacity (0–1). */
  sparkAlpha: number;
}

const DEFAULTS: AlignHudConfig = {
  length: 100,
  width: 12,
  opacity: 1,
  dawnColor: '#ffc45c',
  duskColor: '#4a4ea8',
  seamColor: '#ffffff',
  vibrance: 1,
  glowBlur: 6,
  glowAlpha: 0.55,
  sparkOn: 1,
  sparkMs: 450,
  sparkAlpha: 0.85,
};

export const ALIGNHUD_RANGES: Record<
  'length' | 'width' | 'opacity' | 'vibrance' | 'glowBlur' | 'glowAlpha' | 'sparkMs' | 'sparkAlpha',
  [number, number, number]
> = {
  length: [40, 100, 1],
  width: [4, 32, 1],
  opacity: [0, 1, 0.01],
  vibrance: [0, 2, 0.05],
  glowBlur: [0, 24, 1],
  glowAlpha: [0, 1, 0.01],
  sparkMs: [120, 1500, 10],
  sparkAlpha: [0, 1, 0.01],
};

export const ALIGNHUD_COLOR_KEYS = ['dawnColor', 'duskColor', 'seamColor'] as const;
export { DEFAULTS as ALIGNHUD_DEFAULTS };

const KEY = 'ascent.alignhud';
let cfg: AlignHudConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<AlignHudConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** Saturation-scale a hex colour around its luma — the "vibrance" dial, applied at var-write time so the CSS
 *  stays a plain gradient (no filter on the strip = no extra paint cost). */
function vibrant(hex: string, k: number): string {
  const [r, g, b] = hexToRgb(hex);
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(l + (v - l) * k)));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function getAlignHudConfig(): AlignHudConfig {
  return cfg;
}

/** Reflect the tuned strip onto :root so the pure-CSS HUD picks the current values up live. */
export function applyAlignHudVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--ah-length', `${cfg.length}%`);
  root.setProperty('--ah-width', `${cfg.width}px`);
  root.setProperty('--ah-opacity', String(cfg.opacity));
  root.setProperty('--ah-dawn', vibrant(cfg.dawnColor, cfg.vibrance));
  root.setProperty('--ah-dusk', vibrant(cfg.duskColor, cfg.vibrance));
  root.setProperty('--ah-seam', cfg.seamColor);
  // The seam glow is a STATIC box-shadow (never animated — see docs/performance.md).
  root.setProperty('--ah-seam-glow', `0 0 ${cfg.glowBlur}px 1px ${rgba(cfg.seamColor, cfg.glowAlpha)}`);
  root.setProperty('--ah-spark-ms', `${cfg.sparkMs}ms`);
  root.setProperty('--ah-spark-alpha', String(cfg.sparkAlpha));
}

export function setAlignHudValue(key: keyof AlignHudConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyAlignHudVars();
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch { /* ignore */ }
}
export function resetAlignHudConfig(): void {
  cfg = { ...DEFAULTS };
  applyAlignHudVars();
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
// Reflect persisted/default vars onto :root at load — same pattern as glowConfig: dev applies the tuned
// values; production relies on the CSS fallbacks that mirror DEFAULTS. AlignmentHud also imports this module
// directly (the spark switch), so the vars are live wherever the HUD is.
applyAlignHudVars();
