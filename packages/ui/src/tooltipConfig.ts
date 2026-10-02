import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * THE TOOLTIP TYPE DIALS (owner ask 2026-10-02: "add a tuner for text size for the tooltips as well so i can adjust
 * text size and dial it in").
 *
 * Every tip in the game wears one shared look (`tooltips.css`), sized by a handful of `--atip-*` custom properties on
 * `:root`. This module owns those sizes: the 💬 Tooltips tuner writes them here, and they are pushed onto `:root`, so
 * a change reaches every tooltip at once with no React re-render (CSS variables only).
 *
 * DEV only: values persist in localStorage (`ascent.tooltips`) and apply at load. Production plays the BAKED
 * DEFAULTS below, which MUST mirror the `:root` block in tooltips.css (`tooltipStyle.test.ts` checks the pair). To
 * ship a dialled look: Copy values in the panel, paste them over DEFAULTS, and update the same numbers in
 * tooltips.css.
 */
export interface TooltipConfig {
  /** Title text size (px): the gold heading of a rich tip ("Aegis"). */
  titleSize: number;
  /** Body text size (px): the rule text under the title. */
  bodySize: number;
  /** Pill / tag text size (px): "once per turn", "Rune · active". */
  pillSize: number;
  /** One-line tip text size (px): "Upgrade Shop to tier 2", the menu bubbles. */
  simpleSize: number;
  /** Line height (×) of the body text. */
  lineHeight: number;
  /** Max width (px) of a content-sized tip before its text wraps. */
  maxWidth: number;
  /** Padding (px) inside the panel; a one-line tip uses half of it vertically. */
  pad: number;
}

const DEFAULTS: TooltipConfig = {
  titleSize: 17,
  bodySize: 15,
  pillSize: 12,
  simpleSize: 14,
  lineHeight: 1.42,
  maxWidth: 320,
  pad: 12,
};
export { DEFAULTS as TOOLTIP_DEFAULTS };

/** [min, max, step] per dial. */
export const TOOLTIP_RANGES: Record<keyof TooltipConfig, [number, number, number]> = {
  titleSize: [10, 30, 0.5],
  bodySize: [9, 26, 0.5],
  pillSize: [8, 20, 0.5],
  simpleSize: [9, 24, 0.5],
  lineHeight: [1, 2, 0.01],
  maxWidth: [180, 560, 1],
  pad: [4, 28, 1],
};

/** The custom property each dial drives, and its unit. Exported for the parity test. */
export const TOOLTIP_VARS: Record<keyof TooltipConfig, [string, string]> = {
  titleSize: ['--atip-title-size', 'px'],
  bodySize: ['--atip-body-size', 'px'],
  pillSize: ['--atip-pill-size', 'px'],
  simpleSize: ['--atip-simple-size', 'px'],
  lineHeight: ['--atip-lh', ''],
  maxWidth: ['--atip-maxw', 'px'],
  pad: ['--atip-pad', 'px'],
};

const KEYS = Object.keys(DEFAULTS) as (keyof TooltipConfig)[];
const KEY = 'ascent.tooltips';

const clamp = (k: keyof TooltipConfig, v: unknown): number => {
  const [lo, hi] = TOOLTIP_RANGES[k];
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULTS[k];
};

/** Anything (stored JSON) into a valid config; unknown or out-of-range values fall back to the defaults. */
export function sanitizeTooltipConfig(raw: unknown): TooltipConfig {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULTS };
  for (const k of KEYS) out[k] = k in o ? clamp(k, o[k]) : DEFAULTS[k];
  return out;
}

// Dev-only persistence: production always renders the shipped DEFAULTS (Layout Lab convention).
let cfg: TooltipConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...DEFAULTS };
  try { return sanitizeTooltipConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...DEFAULTS }; }
})();

export function getTooltipConfig(): TooltipConfig { return cfg; }

/** Push the dials onto :root. Only values that differ from the stylesheet's defaults are written inline, so a
 *  reset leaves `:root` exactly as tooltips.css declares it. */
export function applyTooltipVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  for (const k of KEYS) {
    const [name, unit] = TOOLTIP_VARS[k];
    if (cfg[k] === DEFAULTS[k]) root.removeProperty(name);
    else root.setProperty(name, `${cfg[k]}${unit}`);
  }
}

export function setTooltipValue(key: keyof TooltipConfig, value: number): void {
  cfg = { ...cfg, [key]: clamp(key, value) };
  applyTooltipVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetTooltipConfig(): void {
  cfg = { ...DEFAULTS };
  applyTooltipVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const LABELS: Record<keyof TooltipConfig, [string, string, string]> = {
  titleSize: ['Title size', 'Text', 'The gold title of a rich tip ("Aegis", a rune\'s name, a keyword).'],
  bodySize: ['Body text size', 'Text', 'The rule text under the title.'],
  pillSize: ['Pill / tag size', 'Text', 'Small tags like "once per turn" and "Rune · active".'],
  simpleSize: ['One-line tip size', 'Text', 'Short tips like "Upgrade Shop to tier 2" and the menu bubbles.'],
  lineHeight: ['Line height', 'Text', 'Spacing between wrapped lines of body text.'],
  maxWidth: ['Max width', 'Panel', 'How wide a tip grows before its text wraps.'],
  pad: ['Padding', 'Panel', 'Space inside the panel. A one-line tip uses half of it top and bottom.'],
};

const controls: TunerControl<keyof TooltipConfig>[] = KEYS.map((key) => {
  const [label, group, hint] = LABELS[key];
  const [min, max, step] = TOOLTIP_RANGES[key];
  return { key, label, group, hint, min, max, step, unit: key === 'lineHeight' ? '×' : 'px' };
});

export const SPEC: TunerSpec<TooltipConfig> = {
  id: 'tooltips',                   // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Tooltips',
  note: 'dev · live · drag',
  read: getTooltipConfig,
  write: setTooltipValue,
  reset: resetTooltipConfig,
  defaults: DEFAULTS,
  controls,
};

// Reflect the dev values at load (production: DEFAULTS, which the stylesheet already declares).
applyTooltipVars();
