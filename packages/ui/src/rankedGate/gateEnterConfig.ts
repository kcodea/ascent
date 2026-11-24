/**
 * DEV tuner config for THE GATE'S WORD: the painted "ENTER" under the armed crystal (RankedGate.tsx, owner
 * 2026-11-24: "make a tuner where i can adjust its x and y position, its scale, its glow amount, glow blur, glow
 * color, and give me ways to adjust the tint and color of the word itself").
 *
 * Same source-of-truth discipline as every other tuner (see `titleVeilConfig`): DEFAULTS here, mirrored as the
 * `var(--rg-enter-*, <fallback>)` fallbacks in rankedGate.css so the look is the same before this module runs.
 * `applyGateEnterVars` writes the values INLINE on `:root` (dev: the persisted tune; prod: DEFAULTS).
 * **Keep the two in sync when baking a tune** (`gateEnterConfig.test.ts` fails when they drift).
 *
 * WHAT EACH KNOB IS, in the stylesheet's terms:
 *  - PLACE. `x` / `y` are ART pixels from the door art's centre (right of the seam, below the centre row), and
 *    `scale` multiplies the word's base width, so the word keeps its place on the painted door at any window shape.
 *  - GLOW. An extra light AROUND the word, on top of the glow painted into the art: `drop-shadow`s in `glowColor`,
 *    `glowBlur` art pixels soft. `glowAmount` is its strength from 0 to 2: up to 1 is one layer's opacity, and past 1
 *    a second layer comes in over it, because one soft layer at full opacity is still faint.
 *  - COLOUR OF THE WORD. `hue` / `saturation` / `brightness` re-colour the painted art as a whole. The TINT washes it
 *    toward one colour instead: `tintColor` replaces the art's hue and saturation and keeps its light and dark (so
 *    the facets survive), mixed in by `tintAmount`. The tint is an SVG filter, linked only while the amount is above
 *    zero, so the shipped look pays nothing for it when it is off.
 *
 * PERF: every one of these lands in a STATIC `filter` / size on the word. Nothing here animates; the loop is still
 * the bob's transform alone.
 */
import type { TunerControl, TunerSpec } from '../tunerSchema';
import { requestRankedGate } from './rankedGateController';

export interface GateEnterConfig {
  /** Art px right of the door's seam (negative = left). */
  x: number;
  /** Art px below the door art's centre row. */
  y: number;
  /** Multiplier of the word's base width (GATE_ENTER_BASE_W art px). */
  scale: number;
  /** Strength of the added glow, 0..2 (see the header). */
  glowAmount: number;
  /** Softness of the added glow, art px. */
  glowBlur: number;
  /** Colour of the added glow (hex). */
  glowColor: string;
  /** Hue rotation of the painted word, degrees. */
  hue: number;
  /** Saturation of the painted word, % (100 = as painted). */
  saturation: number;
  /** Brightness of the painted word, % (100 = as painted). */
  brightness: number;
  /** The colour the tint washes the word toward (hex). */
  tintColor: string;
  /** How much of the tint is mixed in, 0..1. */
  tintAmount: number;
}

/** The word's width at scale 1, in art px. */
export const GATE_ENTER_BASE_W = 330;
/** The id of the tint's SVG filter, rendered by RankedGate beside the word. */
export const GATE_ENTER_TINT_ID = 'rg-enter-tint';

const DEFAULTS: GateEnterConfig = {
  x: 0,
  y: 178,
  scale: 1,
  glowAmount: 0,
  glowBlur: 14,
  glowColor: '#3c96ff',
  hue: 0,
  saturation: 100,
  brightness: 100,
  tintColor: '#2f8fd8',
  tintAmount: 0,
};
export { DEFAULTS as GATE_ENTER_DEFAULTS };

const KEY = 'ascent.gateenter';

// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: GateEnterConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<GateEnterConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

function hexToRgb(hex: string): [number, number, number] {
  const h = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? '000000';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

export function getGateEnterConfig(): GateEnterConfig {
  return cfg;
}

/** The `--rg-enter-*` custom properties for a config: what rankedGate.css reads (exported for the test). */
export function gateEnterCssVars(c: GateEnterConfig = cfg): Record<string, string> {
  const [r, g, b] = hexToRgb(c.glowColor);
  const amount = clamp(c.glowAmount, 0, 2);
  const tint = clamp(c.tintAmount, 0, 1);
  return {
    '--rg-enter-x': String(c.x),
    '--rg-enter-dy': String(c.y),
    '--rg-enter-scale': String(c.scale),
    '--rg-enter-glow-blur': String(Math.max(0, c.glowBlur)),
    // Two layers: the first carries the amount up to 1, the second what is over it.
    '--rg-enter-glow-a': `rgb(${r} ${g} ${b} / ${Math.min(1, amount)})`,
    '--rg-enter-glow-b': `rgb(${r} ${g} ${b} / ${Math.max(0, amount - 1)})`,
    '--rg-enter-hue': `${c.hue}deg`,
    '--rg-enter-sat': `${Math.max(0, c.saturation)}%`,
    '--rg-enter-bri': `${Math.max(0, c.brightness)}%`,
    '--rg-enter-tint-col': c.tintColor,
    '--rg-enter-tint-amt': String(tint),
    // Off = an EMPTY value, so the stylesheet's filter chain simply has no tint step in it.
    '--rg-enter-tint': tint > 0 ? `url(#${GATE_ENTER_TINT_ID})` : ' ',
  };
}

/** Reflect the knobs onto `:root` as `--rg-enter-*`. */
export function applyGateEnterVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(gateEnterCssVars())) root.setProperty(name, value);
}

export function setGateEnterValue(key: keyof GateEnterConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyGateEnterVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetGateEnterConfig(): void {
  cfg = { ...DEFAULTS };
  applyGateEnterVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const PLACE = 'Place';
const GLOW = 'Added glow';
const COLOUR = 'Colour of the word';
const TINT = 'Tint';
const color = { kind: 'color' as const, min: 0, max: 0, step: 0 };
const controls: TunerControl<Extract<keyof GateEnterConfig, string>>[] = [
  { key: 'x', label: 'Left / right', unit: 'px', hint: 'Door-art pixels right of the seam. Negative moves the word left. It scales with the door, so the word stays on the same spot of the painting.', group: PLACE, min: -400, max: 400, step: 1 },
  { key: 'y', label: 'Up / down', unit: 'px', hint: 'Door-art pixels below the middle of the door. Lower numbers move the word up, toward (and over) the crystal.', group: PLACE, min: -420, max: 440, step: 1 },
  { key: 'scale', label: 'Size', unit: '×', hint: 'The size of the whole word. 1 is 330 door-art pixels wide.', group: PLACE, min: 0.3, max: 3, step: 0.01 },
  { key: 'glowAmount', label: 'Glow amount', hint: 'Strength of an extra glow around the word, on top of the one painted into the art. 0 = none. Up to 1 it brightens one soft layer; past 1 a second layer adds to it.', group: GLOW, min: 0, max: 2, step: 0.02 },
  { key: 'glowBlur', label: 'Glow blur', unit: 'px', hint: 'How far the extra glow spreads, in door-art pixels. Small = a tight rim of light; large = a wide soft haze.', group: GLOW, min: 0, max: 80, step: 0.5 },
  { key: 'glowColor', label: 'Glow colour', hint: 'The colour of the extra glow. It does not change the glow painted into the art (use the colour and tint controls for that).', group: GLOW, ...color },
  { key: 'hue', label: 'Hue shift', unit: '°', hint: 'Rotates every colour in the painted word (its own glow included) around the colour wheel. 0 = as painted.', group: COLOUR, min: -180, max: 180, step: 1 },
  { key: 'saturation', label: 'Saturation', unit: '%', hint: 'How vivid the painted word is. 100 = as painted, 0 = grey, above 100 = more intense.', group: COLOUR, min: 0, max: 300, step: 1 },
  { key: 'brightness', label: 'Brightness', unit: '%', hint: 'How light the painted word is. 100 = as painted. Lower darkens it, higher pushes it toward white.', group: COLOUR, min: 0, max: 300, step: 1 },
  { key: 'tintColor', label: 'Tint colour', hint: 'The colour the word is washed toward. The tint replaces the art\'s own colour and keeps its light and dark, so the facets stay.', group: TINT, ...color },
  { key: 'tintAmount', label: 'Tint amount', hint: 'How much of the tint colour is mixed in. 0 = the art as painted, 1 = fully the tint colour.', group: TINT, min: 0, max: 1, step: 0.01 },
];

export const SPEC: TunerSpec<GateEnterConfig> = {
  id: 'gateenter',                 // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Gate: ENTER word',
  note: 'dev · live · the gate\'s word',
  read: getGateEnterConfig,
  write: (key, value) => setGateEnterValue(key, value),
  writeColor: (key, value) => setGateEnterValue(key, value),
  reset: resetGateEnterConfig,
  defaults: DEFAULTS,
  controls,
  buttonsOnTop: true,
  actions: [
    {
      label: '▶ show gate',
      hint: 'Close the gate over the current screen and leave it armed, with the word showing, for as long as you like. Nothing is swapped behind it. Press the crystal to open it again.',
      run: () => { void requestRankedGate(() => undefined); },
    },
  ],
};

// Reflect vars at load (dev: persisted values; prod: DEFAULTS, which the stylesheet's fallbacks mirror).
applyGateEnterVars();
