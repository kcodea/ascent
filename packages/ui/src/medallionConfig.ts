import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV tuner for the 🎖️ MECHANIC MEDALLION — the round gem eclipsing the arch's base centre that shows a card's
 * primary mechanic (Shout, Echo, Rally, Crit, Spend, …), either as the hybrid PNG art (`mechMedallionSrc`, Task
 * 4) or its `<Icon>` SVG glyph fallback for mechanics with no authored art yet.
 *
 * ONE GLOBAL SETTING — unlike the per-tier Milestone Badges, every medallion on every card shares the same
 * size/placement/art-scale; there is no per-mechanic override. `.cgem`'s box (`--ccw`-relative width/height) and
 * its centering (`left: 50%; transform: translateX(-50%)`) are untouched — this tuner only layers a further
 * scale + px nudge on TOP of that existing transform, and a separate scale on the art image inside the box, so
 * the medallion can be seated without fighting the box's own centering math.
 */
export interface MedallionConfig {
  /** Medallion scale, as a multiple of its current box size. */
  size: number;
  /** Horizontal nudge (px), applied on top of the box's own centering. */
  dx: number;
  /** Vertical nudge (px). */
  dy: number;
  /** Scale of the PNG art within the medallion box (× of 100% — the art can be inset smaller than the box, or
   *  overflow it, without moving the box itself). */
  artScale: number;
}

/** Shipped values — reproduce today's look exactly (no offset, no extra scale). */
const DEFAULTS: MedallionConfig = { size: 1, dx: 0, dy: 0, artScale: 1 };

const RANGES: Record<keyof MedallionConfig, [number, number, number]> = {
  size: [0.4, 2.5, 0.01],
  dx: [-40, 40, 0.5],
  dy: [-40, 40, 0.5],
  artScale: [0.4, 2, 0.01],
};

export { DEFAULTS as MEDALLION_DEFAULTS };

const KEY = 'ascent.medallion';

let cfg: MedallionConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<MedallionConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getMedallionConfig(): MedallionConfig {
  return cfg;
}

/** CSS var name per dial — one map, so `applyMedallionVars` cannot drift from the stylesheet. */
const VARS: Record<keyof MedallionConfig, string> = {
  size: '--cgem-size', dx: '--cgem-dx', dy: '--cgem-dy', artScale: '--cgem-art-scale',
};

/** Push every dial to the CSS custom properties `styles.css` reads. `dx`/`dy` get a `px` unit; `size`/`artScale`
 *  are unitless multipliers. */
export function applyMedallionVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty(VARS.size, String(cfg.size));
  root.setProperty(VARS.dx, `${cfg.dx}px`);
  root.setProperty(VARS.dy, `${cfg.dy}px`);
  root.setProperty(VARS.artScale, String(cfg.artScale));
}

export function setMedallionValue(key: keyof MedallionConfig, value: number | string): void {
  cfg = { ...cfg, [key]: Number(value) };
  applyMedallionVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetMedallionConfig(): void {
  cfg = { ...DEFAULTS };
  applyMedallionVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** [label, unit, hint] per dial. Declaration order below IS render order. All in one "Medallion" group. */
const SPECS: Record<keyof MedallionConfig, [string, TunerControl['unit'], string]> = {
  size: ['Size', '×', 'Medallion scale, as a multiple of its current box size.'],
  dx: ['Offset X', 'px', "Nudge left/right, on top of the medallion's own centering."],
  dy: ['Offset Y', 'px', 'Nudge up/down.'],
  artScale: ['Art inset', '×', "Scale of the PNG art within the medallion box — inset it smaller or let it overflow, without moving the box itself."],
};

const controls: TunerControl<Extract<keyof MedallionConfig, string>>[] =
  (Object.keys(SPECS) as (keyof MedallionConfig)[]).map((key) => {
    const [label, unit, hint] = SPECS[key];
    const [min, max, step] = RANGES[key];
    return { key, label, unit, hint, group: 'Medallion', min, max, step } as TunerControl<Extract<keyof MedallionConfig, string>>;
  });

export const SPEC: TunerSpec<MedallionConfig> = {
  id: 'medallion',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Medallions',
  note: 'dev · live · global, all cards',
  read: getMedallionConfig,
  write: (key, value) => setMedallionValue(key, value),
  reset: resetMedallionConfig,
  defaults: DEFAULTS,
  controls,
};

// Apply at load so medallions are live before the first paint (the equipSlotConfig-era pattern).
applyMedallionVars();
