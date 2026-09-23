import type { TunerControl, TunerSpec } from './tunerSchema';

/** `#rrggbb` + a 0..1 strength → a `rgba(r,g,b,a)` string, so a colour-picker hex and a strength slider can drive
 *  one glow colour. A malformed hex falls back to black. */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const v = Number.isFinite(n) ? n : 0;
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}

/**
 * DEV tuner for the ✴️ EPIC MEDALLION — the separate badge on "epic" units (Drakko, Sylus, Chronos, Yazzus, …;
 * see epicMedallion.ts). Distinct from the mechanic gem: size + placement, plus a tunable coloured glow, always
 * the same icon (no gild / silver treatment), sharing the medallion drop shadow (`--cgem-shadow-*`). One global
 * setting; ships via DEFAULTS. Offsets are card-relative (× --ccw / --ccw-ref) so the badge holds on every screen.
 * Fallbacks in styles.css MUST mirror DEFAULTS.
 */
export interface EpicMedallionConfig {
  /** Badge scale, × its base box size. */
  size: number;
  /** Horizontal nudge (px at the reference card width), on top of the base seat. */
  dx: number;
  /** Vertical nudge (px at the reference card width). */
  dy: number;
  /** Glow colour behind the badge. */
  glowColor: string;
  /** Glow blur radius (px) — 0 hides it. */
  glowSize: number;
  /** Glow strength (0 = off, 1 = full). */
  glowStrength: number;
}

/** Shipped values — owner-tuned seat + white glow (2026-09-23). CSS fallbacks in styles.css mirror these. */
const DEFAULTS: EpicMedallionConfig = { size: 1.3, dx: 3, dy: 106.5, glowColor: '#ffffff', glowSize: 1.5, glowStrength: 1 };

type ColorKey = 'glowColor';

const RANGES: Record<Exclude<keyof EpicMedallionConfig, ColorKey>, [number, number, number]> = {
  size: [0.3, 3, 0.01],
  dx: [-120, 120, 0.5],
  dy: [-120, 120, 0.5],
  glowSize: [0, 40, 0.5],
  glowStrength: [0, 1, 0.01],
};

export { DEFAULTS as EPIC_MEDALLION_DEFAULTS };

const KEY = 'ascent.epicmedallion';

let cfg: EpicMedallionConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<EpicMedallionConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getEpicMedallionConfig(): EpicMedallionConfig {
  return cfg;
}

/** Push the dials to the CSS custom properties `styles.css` reads. `dx`/`dy`/`glowSize` get a `px` unit; `size`
 *  is a unitless multiplier; the glow colour folds its strength in via `hexToRgba`. */
export function applyEpicMedallionVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--epic-size', String(cfg.size));
  root.setProperty('--epic-dx', `${cfg.dx}px`);
  root.setProperty('--epic-dy', `${cfg.dy}px`);
  root.setProperty('--epic-glow-color', hexToRgba(cfg.glowColor, cfg.glowStrength));
  root.setProperty('--epic-glow-size', `${cfg.glowSize}px`);
}

const COLOR_KEYS: ReadonlySet<string> = new Set<ColorKey>(['glowColor']);

export function setEpicMedallionValue(key: keyof EpicMedallionConfig, value: number | string): void {
  const isColor = COLOR_KEYS.has(key);
  cfg = { ...cfg, [key]: isColor ? String(value) : Number(value) };
  applyEpicMedallionVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetEpicMedallionConfig(): void {
  cfg = { ...DEFAULTS };
  applyEpicMedallionVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const controls: TunerControl<Extract<keyof EpicMedallionConfig, string>>[] = [
  { key: 'size', label: 'Size', unit: '×', hint: 'Epic badge scale, as a multiple of its base size.', group: 'Epic medallion', min: RANGES.size[0], max: RANGES.size[1], step: RANGES.size[2] },
  { key: 'dx', label: 'Offset X', unit: 'px', hint: 'Nudge left/right (card-relative, so it holds on every screen).', group: 'Epic medallion', min: RANGES.dx[0], max: RANGES.dx[1], step: RANGES.dx[2] },
  { key: 'dy', label: 'Offset Y', unit: 'px', hint: 'Nudge up/down.', group: 'Epic medallion', min: RANGES.dy[0], max: RANGES.dy[1], step: RANGES.dy[2] },
  { key: 'glowColor', label: 'Glow colour', hint: 'Colour of the glow behind the badge.', group: 'Glow', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'glowSize', label: 'Glow size', unit: 'px', hint: 'Glow blur radius — 0 hides it.', group: 'Glow', min: RANGES.glowSize[0], max: RANGES.glowSize[1], step: RANGES.glowSize[2] },
  { key: 'glowStrength', label: 'Glow strength', unit: 'opacity', hint: '0 hides the glow, 1 is fully opaque.', group: 'Glow', min: RANGES.glowStrength[0], max: RANGES.glowStrength[1], step: RANGES.glowStrength[2] },
];

export const SPEC: TunerSpec<EpicMedallionConfig> = {
  id: 'epicmedallion',             // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Epic Medallion',
  note: 'dev · live · epic units',
  read: getEpicMedallionConfig,
  write: (key, value) => setEpicMedallionValue(key, value),
  writeColor: (key, value) => setEpicMedallionValue(key, value),
  reset: resetEpicMedallionConfig,
  defaults: DEFAULTS,
  controls,
};

// Apply at load so the badge is live before the first paint (the equipSlotConfig-era pattern).
applyEpicMedallionVars();
