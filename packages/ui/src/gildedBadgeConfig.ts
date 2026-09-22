import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV tuner for the 👑 GILDED BADGE — the golden/tripled corner marker (authored `frames/gilded.webp`) shown
 * top-left on a golden card. Size + placement only, layered on TOP of the badge's base top-left seat via
 * `--gcrown-*` CSS vars (`.card.compact .goldcrown` in styles.css). One global setting; the values ship (prod
 * falls back to DEFAULTS and `applyGildedBadgeVars()` runs at load). Fallbacks in styles.css MUST mirror DEFAULTS.
 */
export interface GildedBadgeConfig {
  /** Badge scale, × its base box size. */
  size: number;
  /** Horizontal nudge (px), on top of the base corner seat. */
  dx: number;
  /** Vertical nudge (px). */
  dy: number;
}

/** Shipped values — reproduce the current corner seat (no offset, no extra scale). */
const DEFAULTS: GildedBadgeConfig = { size: 1, dx: 0, dy: 0 };

const RANGES: Record<keyof GildedBadgeConfig, [number, number, number]> = {
  size: [0.3, 3, 0.01],
  dx: [-80, 80, 0.5],
  dy: [-80, 80, 0.5],
};

export { DEFAULTS as GILDED_BADGE_DEFAULTS };

const KEY = 'ascent.gildedbadge';

let cfg: GildedBadgeConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<GildedBadgeConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getGildedBadgeConfig(): GildedBadgeConfig {
  return cfg;
}

/** Push the dials to the CSS custom properties `styles.css` reads. `dx`/`dy` get a `px` unit; `size` is a
 *  unitless multiplier. */
export function applyGildedBadgeVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--gcrown-size', String(cfg.size));
  root.setProperty('--gcrown-dx', `${cfg.dx}px`);
  root.setProperty('--gcrown-dy', `${cfg.dy}px`);
}

export function setGildedBadgeValue(key: keyof GildedBadgeConfig, value: number | string): void {
  cfg = { ...cfg, [key]: Number(value) };
  applyGildedBadgeVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetGildedBadgeConfig(): void {
  cfg = { ...DEFAULTS };
  applyGildedBadgeVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const controls: TunerControl<Extract<keyof GildedBadgeConfig, string>>[] = [
  { key: 'size', label: 'Size', unit: '×', hint: 'Badge scale, as a multiple of its base corner size.', group: 'Gilded badge', min: RANGES.size[0], max: RANGES.size[1], step: RANGES.size[2] },
  { key: 'dx', label: 'Offset X', unit: 'px', hint: 'Nudge left/right from the top-left corner seat.', group: 'Gilded badge', min: RANGES.dx[0], max: RANGES.dx[1], step: RANGES.dx[2] },
  { key: 'dy', label: 'Offset Y', unit: 'px', hint: 'Nudge up/down.', group: 'Gilded badge', min: RANGES.dy[0], max: RANGES.dy[1], step: RANGES.dy[2] },
];

export const SPEC: TunerSpec<GildedBadgeConfig> = {
  id: 'gildedbadge',               // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Gilded Badge',
  note: 'dev · live · golden cards',
  read: getGildedBadgeConfig,
  write: (key, value) => setGildedBadgeValue(key, value),
  reset: resetGildedBadgeConfig,
  defaults: DEFAULTS,
  controls,
};

// Apply at load so the badge is live before the first paint (the equipSlotConfig-era pattern).
applyGildedBadgeVars();
