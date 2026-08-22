/**
 * DEV tuner for VOID'S SECOND POWER BUTTON (owner ask 2026-08-22: "adds the second hero to the right of the
 * hero, under the other hero power — please put a tuner in so I can move it around").
 *
 * Two things share the source of truth, like every other tuner config: DEFAULTS here and the `--hp2-*`
 * fallbacks the `.heropanel2` rule reads in styles.css. This module applies its values inline on `:root` at
 * load (dev: the persisted tune; prod: DEFAULTS). When baking a tune, paste the copied JSON into DEFAULTS
 * *and* mirror it into the `.heropanel2` fallbacks.
 *
 * Offsets are reference px at the 1440 stage — the CSS multiplies by `--scale`, so the seat holds its place
 * at every resolution (the ceremony-layout rule).
 */
import type { TunerControl, TunerSpec } from './tunerSchema';

export interface SecondPowerConfig {
  /** Horizontal offset from the hero panel's seat (reference px; positive = right). */
  x: number;
  /** Vertical offset (reference px; positive = down). */
  y: number;
  /** Uniform scale on the whole second-power block. */
  scale: number;
}

const DEFAULTS: SecondPowerConfig = { x: 118, y: 64, scale: 0.9 };

const RANGES: Record<keyof SecondPowerConfig, [number, number, number]> = {
  x: [-300, 500, 1],
  y: [-300, 300, 1],
  scale: [0.4, 1.6, 0.01],
};

export { DEFAULTS as SECOND_POWER_DEFAULTS };

const KEY = 'ascent.secondpower';

let cfg: SecondPowerConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<SecondPowerConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getSecondPowerConfig(): SecondPowerConfig {
  return cfg;
}

export function applySecondPowerVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--hp2-x', String(cfg.x));
  root.setProperty('--hp2-y', String(cfg.y));
  root.setProperty('--hp2-scale', String(cfg.scale));
}

export function setSecondPowerValue(key: keyof SecondPowerConfig, value: number | string): void {
  cfg = { ...cfg, [key]: Number(value) };
  applySecondPowerVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetSecondPowerConfig(): void {
  cfg = { ...DEFAULTS };
  applySecondPowerVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const controls: TunerControl<Extract<keyof SecondPowerConfig, string>>[] = [
  { key: 'x', label: 'Offset X', unit: 'px', hint: 'Right of the hero panel seat. Reference px — scales with the stage.', group: 'Second power', min: RANGES.x[0], max: RANGES.x[1], step: RANGES.x[2] },
  { key: 'y', label: 'Offset Y', unit: 'px', hint: 'Down from the seat (under the main power button).', group: 'Second power', min: RANGES.y[0], max: RANGES.y[1], step: RANGES.y[2] },
  { key: 'scale', label: 'Scale', unit: '×', hint: 'Size of the whole second-power block.', group: 'Second power', min: RANGES.scale[0], max: RANGES.scale[1], step: RANGES.scale[2] },
];

export const SPEC: TunerSpec<SecondPowerConfig> = {
  id: 'secondpower',               // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Second Power',
  note: 'dev · live · Void only',
  read: getSecondPowerConfig,
  write: (key, value) => setSecondPowerValue(key, value),
  reset: resetSecondPowerConfig,
  defaults: DEFAULTS,
  controls,
};

// Apply at load so the seat is live before the first paint (the boardConfig-era pattern).
applySecondPowerVars();
