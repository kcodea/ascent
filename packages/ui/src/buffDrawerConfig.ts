/**
 * Tunable look for the run-buffs pop-out (`BuffsFrame.tsx`) — the panel that expands UPWARD out of the hero
 * portrait's top edge when the portrait is clicked, bottom-anchored so it grows up as more buffs accrue.
 *
 * Owner rework 2026-08-14: this used to be a side drawer behind a vertical TAB eclipsing the portrait, and the
 * config carried a whole `tab*` group. The tab is gone — those knobs drove nothing — so the config is now just
 * the panel's own placement/scale + the two type sizes.
 *
 * Config is localStorage-persisted in DEV only; production always renders DEFAULTS (Layout Lab convention).
 * Values reflect to `--bfd-*` CSS vars — the styles.css fallbacks MUST mirror DEFAULTS.
 */
export interface BuffDrawerConfig {
  /** Panel — horizontal offset (design px × --u) from the portrait's left edge. */
  bodyX: number;
  /** Panel — vertical nudge (design px × --u). Negative lifts it further off the portrait. */
  bodyY: number;
  /** Panel — overall scale (×). Grows from the bottom-left so it stays seated above the portrait. */
  bodyS: number;
  /** Panel — row text size (design px × --u). */
  textS: number;
  /** Panel — title text size (design px × --u). */
  titleS: number;
  /** Panel — minimum width (design px × --u), so short values don't collapse it narrow. */
  minW: number;
}

const DEFAULTS: BuffDrawerConfig = {
  bodyX: 2,
  bodyY: 0,
  bodyS: 0.9,
  textS: 11,
  titleS: 11,
  minW: 122,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const BFD_RANGES: Record<keyof BuffDrawerConfig, [number, number, number]> = {
  bodyX: [-80, 120, 1],
  bodyY: [-120, 80, 1],
  bodyS: [0.4, 2.5, 0.01],
  textS: [7, 24, 0.5],
  titleS: [7, 24, 0.5],
  minW: [60, 320, 2],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const BFD_DESC: Record<keyof BuffDrawerConfig, string> = {
  bodyX: 'Panel — how far right of the portrait’s left edge it sits.',
  bodyY: 'Panel — vertical nudge. Negative lifts it further off the portrait.',
  bodyS: 'Panel — overall size (×).',
  textS: 'Panel — buff row text size.',
  titleS: 'Panel — "BUFFS" title text size.',
  minW: 'Panel — minimum width, so short values don’t make it collapse narrow.',
};

/** The shipped values, exported so the tuner can mark which controls you have moved away from them. */
export { DEFAULTS as BFD_DEFAULTS };

const KEY = 'ascent.buffdrawer';
// Dev-only persistence: production always renders the shipped DEFAULTS (Layout Lab convention).
let cfg: BuffDrawerConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<BuffDrawerConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getBuffDrawerConfig(): BuffDrawerConfig {
  return cfg;
}

/** Reflect everything onto :root as `--bfd-*`. */
export function applyBuffDrawerVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--bfd-body-x', String(cfg.bodyX));
  root.setProperty('--bfd-body-y', String(cfg.bodyY));
  root.setProperty('--bfd-body-s', String(cfg.bodyS));
  root.setProperty('--bfd-text-s', String(cfg.textS));
  root.setProperty('--bfd-title-s', String(cfg.titleS));
  root.setProperty('--bfd-min-w', String(cfg.minW));
}

export function setBuffDrawerValue(key: keyof BuffDrawerConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  applyBuffDrawerVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetBuffDrawerConfig(): void {
  cfg = { ...DEFAULTS };
  applyBuffDrawerVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
applyBuffDrawerVars();
