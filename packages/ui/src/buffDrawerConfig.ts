/**
 * Tunable look for the run-buffs drawer (`BuffsFrame.tsx`) — the collapsible panel extending right out of
 * the hero portrait, opened by a tab eclipsing the portrait's edge.
 *
 * The tab is VERTICAL (owner 2026-07-21) so it covers as little of the portrait as possible — a horizontal
 * pill ate a visible bite of the art. Position/scale/type-size are all dials here rather than hand-picked
 * numbers, because how much eclipse reads as "attached" vs "covering" is a judgement call.
 *
 * Config is localStorage-persisted in DEV only; production always renders DEFAULTS (Layout Lab convention).
 * Values reflect to `--bfd-*` CSS vars — the styles.css fallbacks MUST mirror DEFAULTS.
 */
export interface BuffDrawerConfig {
  /** Tab — horizontal nudge (design px × --u). Negative pulls it further ONTO the portrait. */
  tabX: number;
  /** Tab — vertical nudge (design px × --u) from the portrait's mid-line. */
  tabY: number;
  /** Tab — overall scale (×). */
  tabS: number;
  /** Tab — height (design px × --u). The vertical tab's long axis. */
  tabH: number;
  /** Tab — width (design px × --u). Keep it narrow: this is what eclipses the portrait. */
  tabW: number;
  /** Drawer — horizontal offset (design px × --u) from the tab. */
  bodyX: number;
  /** Drawer — vertical nudge (design px × --u). */
  bodyY: number;
  /** Drawer — overall scale (×). */
  bodyS: number;
  /** Drawer — row text size (design px × --u). */
  textS: number;
  /** Drawer — title text size (design px × --u). */
  titleS: number;
  /** Drawer — minimum width (design px × --u). */
  minW: number;
}

const DEFAULTS: BuffDrawerConfig = {
  tabX: -6,
  tabY: 0,
  tabS: 1,
  tabH: 35,
  tabW: 18,
  bodyX: -1,
  bodyY: 0,
  bodyS: 0.58,
  textS: 11,
  titleS: 11,
  minW: 122,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const BFD_RANGES: Record<keyof BuffDrawerConfig, [number, number, number]> = {
  tabX: [-40, 40, 0.5],
  tabY: [-80, 80, 1],
  tabS: [0.4, 2.5, 0.01],
  tabH: [16, 140, 1],
  tabW: [8, 60, 1],
  bodyX: [-40, 80, 1],
  bodyY: [-80, 80, 1],
  bodyS: [0.4, 2.5, 0.01],
  textS: [7, 24, 0.5],
  titleS: [7, 24, 0.5],
  minW: [60, 320, 2],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const BFD_DESC: Record<keyof BuffDrawerConfig, string> = {
  tabX: 'Tab — horizontal nudge. More negative pulls it further ONTO the portrait (more eclipse).',
  tabY: 'Tab — vertical nudge from the portrait’s mid-line.',
  tabS: 'Tab — overall size (×).',
  tabH: 'Tab — height. The vertical tab’s long axis.',
  tabW: 'Tab — width. Keep it narrow: this is the part that covers the portrait.',
  bodyX: 'Drawer — how far right of the tab the panel sits.',
  bodyY: 'Drawer — vertical nudge.',
  bodyS: 'Drawer — overall size (×).',
  textS: 'Drawer — buff row text size.',
  titleS: 'Drawer — "BUFFS" title text size.',
  minW: 'Drawer — minimum width, so short values don’t make it collapse narrow.',
};

export const BFD_NUM_KEYS = [
  'tabX', 'tabY', 'tabS', 'tabH', 'tabW',
  'bodyX', 'bodyY', 'bodyS', 'minW', 'textS', 'titleS',
] as const;

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
  root.setProperty('--bfd-tab-x', String(cfg.tabX));
  root.setProperty('--bfd-tab-y', String(cfg.tabY));
  root.setProperty('--bfd-tab-s', String(cfg.tabS));
  root.setProperty('--bfd-tab-h', String(cfg.tabH));
  root.setProperty('--bfd-tab-w', String(cfg.tabW));
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
