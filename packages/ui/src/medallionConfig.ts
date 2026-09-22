import type { TunerControl, TunerSpec } from './tunerSchema';

/** `#rrggbb` + a 0..1 strength → a `rgba(r,g,b,a)` string, so a colour-picker hex and a strength slider can drive
 *  one drop-shadow colour. A malformed hex falls back to black. (Same helper the milestone-frame tuner uses.) */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const v = Number.isFinite(n) ? n : 0;
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
}

/**
 * DEV tuner for the 🎖️ MECHANIC MEDALLION — the round gem eclipsing the arch's base centre that shows a card's
 * primary mechanic (Shout, Echo, Rally, Crit, Spend, …), either as the hybrid PNG art (`mechMedallionSrc`, Task
 * 4) or its `<Icon>` SVG glyph fallback for mechanics with no authored art yet.
 *
 * ONE GLOBAL SETTING — unlike the per-tier Milestone Badges, every medallion on every card shares the same
 * dials; there is no per-mechanic override. Beyond the box's size/placement/art-scale, this now also owns the
 * BACKING CIRCLE (its fill, outline and a show/hide toggle — replacing the old per-tribe tint, owner ask
 * 2026-09-22), the ART TINT (desaturate + a colour wash, e.g. grey / gold for a gilded look), and the
 * TRIGGER-PULSE colour (the flash + ring a medallion fires when its effect triggers — also formerly per-tribe;
 * Rally/Watcher/Crit keep their own forced colours). Every dial is a CSS custom property `styles.css` reads (the
 * MEDALLION block); the values ship (prod falls back to DEFAULTS and `applyMedallionVars()` still runs at load).
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

  // ── Backing circle (replaces the old per-tribe tint) ────────────────────────────────────────────────────
  /** 1 shows the round backing (fill + outline + shadow); 0 hides it so the mechanic art floats bare. */
  circleOn: number;
  /** Circle fill colour — a subtle gem gradient is derived from it. Was the per-tribe `--c`. */
  bg: string;
  /** Circle outline (rim) colour. Was a fixed cream. */
  outline: string;
  /** Outline width, × the base ring (0 removes the rim). */
  outlineWidth: number;

  // ── Drop shadow (follows the circle, or the bare art when the circle is off) ─────────────────────────────
  /** Shadow offset (px). */
  shadowX: number; shadowY: number;
  /** Shadow blur radius (px). */
  shadowBlur: number;
  /** Shadow colour and strength (0 = off, 1 = full). */
  shadowColor: string; shadowOpacity: number;

  // ── Art tint (grey / gold / …) ──────────────────────────────────────────────────────────────────────────
  /** Desaturate the art, % — 0 leaves it full-colour, 100 is fully grey. */
  desat: number;
  /** Tint colour blended over the art, masked to the art's own shape (so it colours the glyph, not the box). */
  tint: string;
  /** Tint amount, % — 0 is untinted, 100 is a solid tint silhouette. */
  tintAmt: number;

  // ── Trigger pulse (replaces the old per-tribe glow colour) ──────────────────────────────────────────────
  /** The flash + ring colour a medallion fires when the unit's effect triggers. Rally/Watcher/Crit override
   *  this with their own forced colours. */
  pulse: string;
}

/** Shipped values. Box dials reproduce today's look; the circle drops the per-tribe tint for a fixed neutral +
 *  cream rim (owner ask 2026-09-22); the art tint is inert by default (amount 0, desaturate 0). */
const DEFAULTS: MedallionConfig = {
  size: 1, dx: 0, dy: 0, artScale: 1,
  circleOn: 1, bg: '#2a2430', outline: '#f6e3ad', outlineWidth: 1,
  shadowX: 0, shadowY: 2, shadowBlur: 6, shadowColor: '#000000', shadowOpacity: 0.5,
  desat: 0, tint: '#ffd24a', tintAmt: 0,
  pulse: '#f6e3ad',
};

type ColorKey = 'bg' | 'outline' | 'shadowColor' | 'tint' | 'pulse';

const RANGES: Record<Exclude<keyof MedallionConfig, ColorKey>, [number, number, number]> = {
  size: [0.4, 2.5, 0.01],
  dx: [-40, 40, 0.5],
  dy: [-40, 40, 0.5],
  artScale: [0.4, 2, 0.01],
  circleOn: [0, 1, 1],
  outlineWidth: [0, 4, 0.1],
  shadowX: [-20, 20, 0.5],
  shadowY: [-20, 20, 0.5],
  shadowBlur: [0, 30, 0.5],
  shadowOpacity: [0, 1, 0.01],
  desat: [0, 100, 1],
  tintAmt: [0, 100, 1],
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

/** Push every dial to the CSS custom properties `styles.css` reads. `dx`/`dy` get a `px` unit; `size`/`artScale`/
 *  `outlineWidth` are unitless multipliers; colours go through as-is; `desat` is a `%` for `grayscale()` and
 *  `tintAmt` a 0..1 opacity. `circleOn` toggles the `cgem-nobg` root class the stylesheet keys the hide rule on. */
export function applyMedallionVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--cgem-size', String(cfg.size));
  root.setProperty('--cgem-dx', `${cfg.dx}px`);
  root.setProperty('--cgem-dy', `${cfg.dy}px`);
  root.setProperty('--cgem-art-scale', String(cfg.artScale));
  root.setProperty('--cgem-bg', cfg.bg);
  root.setProperty('--cgem-outline', cfg.outline);
  root.setProperty('--cgem-outline-w', String(cfg.outlineWidth));
  root.setProperty('--cgem-shadow-x', `${cfg.shadowX}px`);
  root.setProperty('--cgem-shadow-y', `${cfg.shadowY}px`);
  root.setProperty('--cgem-shadow-blur', `${cfg.shadowBlur}px`);
  root.setProperty('--cgem-shadow-color', hexToRgba(cfg.shadowColor, cfg.shadowOpacity));
  root.setProperty('--cgem-desat', `${cfg.desat}%`);
  root.setProperty('--cgem-tint', cfg.tint);
  root.setProperty('--cgem-tint-amt', String(cfg.tintAmt / 100));
  root.setProperty('--cgem-pulse', cfg.pulse);
  document.documentElement.classList.toggle('cgem-nobg', cfg.circleOn < 1);
}

const COLOR_KEYS: ReadonlySet<string> = new Set<ColorKey>(['bg', 'outline', 'shadowColor', 'tint', 'pulse']);

export function setMedallionValue(key: keyof MedallionConfig, value: number | string): void {
  const isColor = COLOR_KEYS.has(key);
  cfg = { ...cfg, [key]: isColor ? String(value) : Number(value) };
  applyMedallionVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetMedallionConfig(): void {
  cfg = { ...DEFAULTS };
  applyMedallionVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Declaration order below IS render order. Mixed kinds (range / toggle / colour) grouped by section. */
const controls: TunerControl<Extract<keyof MedallionConfig, string>>[] = [
  // ── Box ──
  { key: 'size', label: 'Size', unit: '×', hint: 'Medallion scale, as a multiple of its current box size.', group: 'Medallion', min: RANGES.size[0], max: RANGES.size[1], step: RANGES.size[2] },
  { key: 'dx', label: 'Offset X', unit: 'px', hint: "Nudge left/right, on top of the medallion's own centering.", group: 'Medallion', min: RANGES.dx[0], max: RANGES.dx[1], step: RANGES.dx[2] },
  { key: 'dy', label: 'Offset Y', unit: 'px', hint: 'Nudge up/down.', group: 'Medallion', min: RANGES.dy[0], max: RANGES.dy[1], step: RANGES.dy[2] },
  { key: 'artScale', label: 'Art inset', unit: '×', hint: 'Scale of the art within the box — inset it smaller or let it overflow, without moving the box itself.', group: 'Medallion', min: RANGES.artScale[0], max: RANGES.artScale[1], step: RANGES.artScale[2] },
  // ── Backing circle ──
  { key: 'circleOn', label: 'Background circle', hint: 'Show the round backing (fill + outline + shadow). Off leaves just the art floating.', group: 'Circle', kind: 'toggle', onValue: 1, offValue: 0, onOffLabels: ['shown', 'hidden'], min: 0, max: 1, step: 1 },
  { key: 'bg', label: 'Background colour', hint: 'Circle fill — a subtle gem gradient is derived from it. Replaces the old per-tribe colour.', group: 'Circle', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'outline', label: 'Outline colour', hint: 'Circle rim colour.', group: 'Circle', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'outlineWidth', label: 'Outline width', unit: '×', hint: 'Rim thickness, × the base ring. 0 removes the rim.', group: 'Circle', min: RANGES.outlineWidth[0], max: RANGES.outlineWidth[1], step: RANGES.outlineWidth[2] },
  // ── Drop shadow ──
  { key: 'shadowX', label: 'Shadow X', unit: 'px', hint: 'Drop-shadow offset left/right. Follows the circle, or the bare art when the circle is off.', group: 'Drop shadow', min: RANGES.shadowX[0], max: RANGES.shadowX[1], step: RANGES.shadowX[2] },
  { key: 'shadowY', label: 'Shadow Y', unit: 'px', hint: 'Drop-shadow offset up/down.', group: 'Drop shadow', min: RANGES.shadowY[0], max: RANGES.shadowY[1], step: RANGES.shadowY[2] },
  { key: 'shadowBlur', label: 'Shadow blur', unit: 'px', hint: 'How soft the shadow is — 0 is a hard edge.', group: 'Drop shadow', min: RANGES.shadowBlur[0], max: RANGES.shadowBlur[1], step: RANGES.shadowBlur[2] },
  { key: 'shadowColor', label: 'Shadow colour', hint: 'Colour of the drop shadow (strength below).', group: 'Drop shadow', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'shadowOpacity', label: 'Shadow strength', unit: 'opacity', hint: '0 hides the shadow, 1 is fully opaque.', group: 'Drop shadow', min: RANGES.shadowOpacity[0], max: RANGES.shadowOpacity[1], step: RANGES.shadowOpacity[2] },
  // ── Art tint ──
  { key: 'desat', label: 'Desaturate', unit: '%', hint: 'Grey the art — 0 full colour, 100 fully grey.', group: 'Art tint', min: RANGES.desat[0], max: RANGES.desat[1], step: RANGES.desat[2] },
  { key: 'tint', label: 'Tint colour', hint: 'Colour blended over the art (e.g. gold for a gilded look). Applies to PNG art; SVG-glyph mechanics are unaffected.', group: 'Art tint', kind: 'color', min: 0, max: 0, step: 0 },
  { key: 'tintAmt', label: 'Tint amount', unit: '%', hint: '0 leaves the art untinted, 100 is a solid tint silhouette.', group: 'Art tint', min: RANGES.tintAmt[0], max: RANGES.tintAmt[1], step: RANGES.tintAmt[2] },
  // ── Pulse ──
  { key: 'pulse', label: 'Trigger-pulse colour', hint: "The flash + ring the medallion fires when the unit's effect triggers. Rally / Watcher / Crit keep their own colours.", group: 'Pulse', kind: 'color', min: 0, max: 0, step: 0 },
];

export const SPEC: TunerSpec<MedallionConfig> = {
  id: 'medallion',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Medallions',
  note: 'dev · live · global, all cards',
  read: getMedallionConfig,
  write: (key, value) => setMedallionValue(key, value),
  writeColor: (key, value) => setMedallionValue(key, value),
  reset: resetMedallionConfig,
  defaults: DEFAULTS,
  controls,
};

// Apply at load so medallions are live before the first paint (the equipSlotConfig-era pattern).
applyMedallionVars();
