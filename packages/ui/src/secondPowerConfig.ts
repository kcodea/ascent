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
  /** FRAME (frames/secondheropower.webp, owner art 2026-08-22) — the housing BEHIND the button. Its own
   *  offset/scale/opacity, relative to the button's centre, so the art can be seated around the circle
   *  without moving the clickable button itself. */
  frameX: number;
  frameY: number;
  frameScale: number;
  frameOpacity: number;
}

const DEFAULTS: SecondPowerConfig = { x: 118, y: 64, scale: 0.9, frameX: 0, frameY: 0, frameScale: 1.6, frameOpacity: 1 };

const RANGES: Record<keyof SecondPowerConfig, [number, number, number]> = {
  x: [-300, 500, 1],
  y: [-300, 300, 1],
  scale: [0.4, 1.6, 0.01],
  frameX: [-120, 120, 1],
  frameY: [-120, 120, 1],
  frameScale: [0.5, 3, 0.01],
  frameOpacity: [0, 1, 0.01],
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
  root.setProperty('--hp2-frame-x', String(cfg.frameX));
  root.setProperty('--hp2-frame-y', String(cfg.frameY));
  root.setProperty('--hp2-frame-s', String(cfg.frameScale));
  root.setProperty('--hp2-frame-a', String(cfg.frameOpacity));
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
  { key: 'frameX', label: 'Frame X', unit: 'px', hint: 'Nudge the housing art right/left of the button centre.', group: 'Frame', min: RANGES.frameX[0], max: RANGES.frameX[1], step: RANGES.frameX[2] },
  { key: 'frameY', label: 'Frame Y', unit: 'px', hint: 'Nudge the housing art down/up of the button centre.', group: 'Frame', min: RANGES.frameY[0], max: RANGES.frameY[1], step: RANGES.frameY[2] },
  { key: 'frameScale', label: 'Frame scale', unit: '×', hint: 'Size of the housing relative to the button (1 = the button circle exactly).', group: 'Frame', min: RANGES.frameScale[0], max: RANGES.frameScale[1], step: RANGES.frameScale[2] },
  { key: 'frameOpacity', label: 'Frame opacity', hint: '0 hides the housing entirely.', group: 'Frame', min: RANGES.frameOpacity[0], max: RANGES.frameOpacity[1], step: RANGES.frameOpacity[2] },
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
