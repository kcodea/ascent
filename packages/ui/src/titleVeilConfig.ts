/**
 * DEV tuner config for the TITLE-SCREEN VEIL (owner ask 2026-08-21). A dark navy gradient that hugs the edges
 * and fades to nothing over the centre, so the floating-city art stays bright while the logo + menu read
 * clearly against a calmer ground. It is an elliptical radial — the transparent core is an ellipse, so the
 * dark→clear boundary BOWS (curves) rather than running straight, matching the owner's sketch.
 *
 * It paints on `.titlescreen::before` (z-index 1 — above the background art, below the menu/account/version at
 * z-index 2), replacing the old static left-legibility gradient. This module makes its knobs live-tunable.
 *
 * Same source-of-truth discipline as every other tuner (see `boardEdgeConfig`): DEFAULTS here, mirrored into
 * the `--tv-*` block in the styles.css `:root` so the pre-JS / no-JS paint matches. `applyTitleVeilVars`
 * applies the values INLINE on `:root` (dev: the persisted tune; prod: DEFAULTS), which overrides the
 * stylesheet declaration so a tune shows live. **Keep the two in sync when baking a tune.**
 *
 * `col` (hex) and `intensity` (0..1 alpha) are the two knobs the owner asked for; they are folded together into
 * `--tv-col` (the colour at `intensity` alpha) and its 0-alpha twin `--tv-col-0` (the transparent inner stop,
 * so the fade never interpolates through transparent-black and leaves a grey fringe). The remaining knobs shape
 * the bow: where the bright core sits (`cx`/`cy`), how wide/tall the clear ellipse is (`rx`/`ry`), and the two
 * gradient stops (`clear` = where the core is still fully bright, `edge` = where the veil reaches full colour).
 */
import type { TunerControl, TunerSpec } from './tunerSchema';

export interface TitleVeilConfig {
  /** The veil colour — a dark navy that hugs the edges. */
  col: string;
  /** Peak opacity (0..1) at the veil's darkest — the "intensity". */
  intensity: number;
  /** Centre of the bright core, % of the screen (the floating city sits centre-right). */
  cx: number;
  cy: number;
  /** Radius of the clear ellipse, % (× width for rx, × height for ry) — controls the bow's width/height. */
  rx: number;
  ry: number;
  /** Gradient stops along the ray, %: `clear` = core stays fully bright out to here; `edge` = full colour by
   *  here (may exceed 100 so the darkest sits past the ellipse rim, deepening the corners). */
  clear: number;
  edge: number;
}

const DEFAULTS: TitleVeilConfig = {
  col: '#0a1730',
  intensity: 1,
  cx: 57,
  cy: 45,
  rx: 26,
  ry: 130,
  clear: 35,
  edge: 160,
};

/** `[min, max, step]` for the numeric knobs. */
const TV_RANGES: Record<Exclude<keyof TitleVeilConfig, 'col'>, [number, number, number]> = {
  intensity: [0, 1, 0.02],
  cx: [0, 100, 1],
  cy: [0, 100, 1],
  rx: [10, 130, 1],
  ry: [10, 130, 1],
  clear: [0, 100, 1],
  edge: [20, 160, 1],
};

/** The shipped values, exported so the tuner can mark which controls you've moved. */
export { DEFAULTS as TITLE_VEIL_DEFAULTS };

const KEY = 'ascent.titleveil';

// Dev-only persistence: production always renders the shipped DEFAULTS (which the styles.css :root mirrors).
let cfg: TitleVeilConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<TitleVeilConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function getTitleVeilConfig(): TitleVeilConfig {
  return cfg;
}

/** Reflect the knobs (and the derived colours) onto `:root` as `--tv-*`. */
export function applyTitleVeilVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const [r, g, b] = hexToRgb(cfg.col);
  const a = Math.max(0, Math.min(1, cfg.intensity));
  root.setProperty('--tv-col', `rgb(${r} ${g} ${b} / ${a})`);
  root.setProperty('--tv-col-0', `rgb(${r} ${g} ${b} / 0)`);
  root.setProperty('--tv-cx', `${cfg.cx}%`);
  root.setProperty('--tv-cy', `${cfg.cy}%`);
  root.setProperty('--tv-rx', `${cfg.rx}%`);
  root.setProperty('--tv-ry', `${cfg.ry}%`);
  root.setProperty('--tv-clear', `${cfg.clear}%`);
  root.setProperty('--tv-edge', `${cfg.edge}%`);
}

export function setTitleVeilValue(key: keyof TitleVeilConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyTitleVeilVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetTitleVeilConfig(): void {
  cfg = { ...DEFAULTS };
  applyTitleVeilVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const G = 'Title veil';
const controls: TunerControl<Extract<keyof TitleVeilConfig, string>>[] = [
  { key: 'col', label: 'Veil colour', hint: 'The dark colour the edges fill with. A deep navy keeps the sky reading as night-edged rather than muddy.', group: G, kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'intensity', label: 'Intensity', hint: 'Peak opacity at the veil\'s darkest (the edges). 0 = invisible; 1 = the colour at full strength.', group: G, min: TV_RANGES.intensity[0], max: TV_RANGES.intensity[1], step: TV_RANGES.intensity[2] },
  { key: 'cx', label: 'Core centre X', unit: '%', hint: 'Horizontal centre of the bright (clear) zone. Push right to keep the floating city — centre-right — bright.', group: G, min: TV_RANGES.cx[0], max: TV_RANGES.cx[1], step: TV_RANGES.cx[2] },
  { key: 'cy', label: 'Core centre Y', unit: '%', hint: 'Vertical centre of the bright zone.', group: G, min: TV_RANGES.cy[0], max: TV_RANGES.cy[1], step: TV_RANGES.cy[2] },
  { key: 'rx', label: 'Core width', unit: '%', hint: 'Half-width of the clear ellipse (× screen width). Wider = a broader bright band and a gentler side bow.', group: G, min: TV_RANGES.rx[0], max: TV_RANGES.rx[1], step: TV_RANGES.rx[2] },
  { key: 'ry', label: 'Core height', unit: '%', hint: 'Half-height of the clear ellipse (× screen height). Taller = a broader bright band and a gentler top/bottom bow.', group: G, min: TV_RANGES.ry[0], max: TV_RANGES.ry[1], step: TV_RANGES.ry[2] },
  { key: 'clear', label: 'Bright hold', unit: '%', hint: 'How far out the core stays FULLY bright before the veil starts. Low = the fade begins near centre; high = a hard bright disc then a quick ramp.', group: G, min: TV_RANGES.clear[0], max: TV_RANGES.clear[1], step: TV_RANGES.clear[2] },
  { key: 'edge', label: 'Full-dark reach', unit: '%', hint: 'Where the veil hits full colour. 100 = at the ellipse rim; above 100 pushes the darkest past the rim so the corners deepen.', group: G, min: TV_RANGES.edge[0], max: TV_RANGES.edge[1], step: TV_RANGES.edge[2] },
];

export const SPEC: TunerSpec<TitleVeilConfig> = {
  id: 'titleveil',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Title Veil',
  note: 'dev · live · main menu only',
  read: getTitleVeilConfig,
  write: (key, value) => setTitleVeilValue(key, value),
  writeColor: (key, value) => setTitleVeilValue(key, value),
  reset: resetTitleVeilConfig,
  defaults: DEFAULTS,
  controls,
};

// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the styles.css :root either way).
applyTitleVeilVars();
