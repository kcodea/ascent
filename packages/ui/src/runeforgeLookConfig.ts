/**
 * DEV tuner config for the RUNEFORGE OVERLAY's LOOK (owner ask 2026-08-29, rebuilt for the 2026-10-07 redesign):
 * the placement and size of every element of the forge — the Gem plate title, the current-Gold pill, the rune-tablet
 * row (name size, cost coin), the Re-roll footer and the "Inspect the board" toggle.
 *
 * GEOMETRY ONLY since the 2026-10-07 redesign. Every forge and rune COLOUR now comes from the shared `--ui-*` UI
 * theme tokens (uiTheme.css), so the forge reskins with the selected theme like the HUD pills and tooltips; the old
 * colour knobs (plaque, title, Gold pill, rune name / kicker / rules box, the Epic tints) were retired with the
 * stone look they coloured. The storage key moved to `.v2` for the same reason: a tune saved against the old framed
 * layout (a banner lifted 143u into the illustrated frame, a 1.67x plaque) would wreck the new column layout.
 *
 * Same architecture as `boardEdgeConfig` / `lobbyRailLookConfig`: DEV-only localStorage, values pushed onto `:root`
 * as `--rfl-*` custom properties, read by the forge rules (runeforgeEntrance/runeforgeLook.css) and `.runecard*`
 * (styles.css) WITH the shipped value as their fallback, so PRODUCTION, which never runs the tuner, paints
 * identically with no JS. Shipping a tune means pasting the copied JSON into DEFAULTS here AND mirroring it into
 * those fallbacks.
 *
 * GEOMETRY IS DESIGN PX × `--u` for the forge chrome, EXCEPT the `.runecard-cost` offsets, which stay RAW px
 * because the rule they extend (`.runecard`) is itself written in raw px. Scales are unitless ×.
 */
import type { TunerControl, TunerSpec } from './tunerSchema';

export interface RuneforgeLookConfig {
  // Title
  banX: number;         // u — title horizontal nudge
  banY: number;         // u — title vertical nudge
  banScale: number;     // × — the title plate
  titleScale: number;   // × — the title's font size

  // Gold pill
  goldX: number;        // u
  goldY: number;        // u
  goldScale: number;    // ×

  // Cards row
  rowY: number;         // u — the row's extra vertical offset
  cardGap: number;      // u — gap between rune tablets
  cardScale: number;    // × — the row's card-height multiplier
  nameScale: number;    // × — rune name font size
  costScale: number;    // × — the gold cost coin
  costX: number;        // px — cost coin nudge (raw px)
  costY: number;        // px

  // Footer (Re-roll)
  footerY: number;      // u
  footerScale: number;  // ×

  // Minimize toggle ("Inspect the board")
  toggleY: number;      // u
  toggleScale: number;  // ×
}

/** Owner-tunable; these mirror the CSS fallbacks in runeforgeLook.css / the `.runecard*` rules, so production paints
 *  them with no JS. Bake a tune by pasting Copy values here AND updating those fallbacks. */
const DEFAULTS: RuneforgeLookConfig = {
  banX: 0,
  banY: 0,
  banScale: 1,
  titleScale: 1,

  goldX: 0,
  goldY: 0,
  goldScale: 1,

  rowY: 0,
  cardGap: 26,
  cardScale: 1.29,
  nameScale: 1.34, // x1.2 (owner 2026-10-07: rune text +20%), was 1.12
  costScale: 1,
  costX: 6,
  costY: 4,

  footerY: 0,
  footerScale: 1,

  toggleY: 160,
  toggleScale: 1,
};

export { DEFAULTS as RUNEFORGE_LOOK_DEFAULTS };

/** `[min, max, step]` for every knob. */
const RANGES: Record<keyof RuneforgeLookConfig, [number, number, number]> = {
  banX: [-200, 200, 1],
  banY: [-200, 200, 1],
  banScale: [0.5, 2, 0.01],
  titleScale: [0.5, 2, 0.01],

  goldX: [-200, 200, 1],
  goldY: [-200, 200, 1],
  goldScale: [0.5, 2, 0.01],

  rowY: [-200, 200, 1],
  cardGap: [0, 60, 1],
  cardScale: [0.8, 2, 0.01],
  nameScale: [0.5, 2, 0.01],
  costScale: [0.5, 2, 0.01],
  costX: [-40, 40, 1],
  costY: [-40, 40, 1],

  footerY: [-200, 200, 1],
  footerScale: [0.5, 2, 0.01],

  toggleY: [-200, 200, 1],
  toggleScale: [0.5, 2, 0.01],
};

const KEY = 'ascent.runeforgeLook.v2';

let cfg: RuneforgeLookConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<RuneforgeLookConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getRuneforgeLookConfig(): RuneforgeLookConfig {
  return cfg;
}

/** Reflect every value onto `:root` as `--rfl-*`. Each forge / `.runecard*` rule reads these WITH a fallback, so a
 *  missing var (production, or a stale save) renders the shipped look rather than a broken one. */
export function applyRuneforgeLookVars(): void {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  s.setProperty('--rfl-ban-x', String(cfg.banX));
  s.setProperty('--rfl-ban-y', String(cfg.banY));
  s.setProperty('--rfl-ban-scale', String(cfg.banScale));
  s.setProperty('--rfl-title-scale', String(cfg.titleScale));

  s.setProperty('--rfl-gold-x', String(cfg.goldX));
  s.setProperty('--rfl-gold-y', String(cfg.goldY));
  s.setProperty('--rfl-gold-scale', String(cfg.goldScale));

  s.setProperty('--rfl-row-y', String(cfg.rowY));
  s.setProperty('--rfl-card-gap', String(cfg.cardGap));
  s.setProperty('--rfl-card-scale', String(cfg.cardScale));
  s.setProperty('--rfl-name-scale', String(cfg.nameScale));
  s.setProperty('--rfl-cost-scale', String(cfg.costScale));
  s.setProperty('--rfl-cost-x', String(cfg.costX));
  s.setProperty('--rfl-cost-y', String(cfg.costY));

  s.setProperty('--rfl-footer-y', String(cfg.footerY));
  s.setProperty('--rfl-footer-scale', String(cfg.footerScale));
  s.setProperty('--rfl-toggle-y', String(cfg.toggleY));
  s.setProperty('--rfl-toggle-scale', String(cfg.toggleScale));
}

export function setRuneforgeLookValue(key: keyof RuneforgeLookConfig, value: number | string): void {
  cfg = { ...cfg, [key]: Number(value) };
  applyRuneforgeLookVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetRuneforgeLookConfig(): void {
  cfg = { ...DEFAULTS };
  applyRuneforgeLookVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const r = (
  key: keyof RuneforgeLookConfig, label: string, group: string,
  unit: TunerControl['unit'], hint: string,
): TunerControl<Extract<keyof RuneforgeLookConfig, string>> => {
  const [min, max, step] = RANGES[key];
  return { key, label, group, unit, hint, min, max, step };
};

const controls: TunerControl<Extract<keyof RuneforgeLookConfig, string>>[] = [
  r('banX', 'Title X', 'Title', 'px', 'Nudge the RUNEFORGE title plate left/right of centre.'),
  r('banY', 'Title Y', 'Title', 'px', 'Nudge the title plate up/down.'),
  r('banScale', 'Title plate scale', 'Title', '×', 'Scales the whole title plate.'),
  r('titleScale', 'Title text size', 'Title', '×', 'Font size of the "RUNEFORGE" title.'),

  r('goldX', 'Gold pill X', 'Gold Pill', 'px', 'Nudge the current-Gold pill left/right of centre.'),
  r('goldY', 'Gold pill Y', 'Gold Pill', 'px', 'Nudge the Gold pill up/down.'),
  r('goldScale', 'Gold pill scale', 'Gold Pill', '×', 'Scales the whole Gold pill.'),

  r('rowY', 'Row Y offset', 'Cards Row', 'px', 'Extra vertical offset of the rune-tablet row (and its ledge).'),
  r('cardGap', 'Card gap', 'Cards Row', 'px', 'Horizontal gap between rune tablets.'),
  r('cardScale', 'Card scale', 'Cards Row', '×', 'Size of the rune tablets themselves.'),
  r('nameScale', 'Name size', 'Cards Row', '×', 'Font size of the rune name.'),
  r('costScale', 'Cost coin scale', 'Cards Row', '×', 'Size of the Gold cost coin overhanging the top-left corner.'),
  r('costX', 'Cost coin X', 'Cards Row', 'px', 'Nudge the cost coin left/right.'),
  r('costY', 'Cost coin Y', 'Cards Row', 'px', 'Nudge the cost coin up/down.'),

  r('footerY', 'Footer Y offset', 'Footer Buttons', 'px', 'Vertical offset of the Re-roll button.'),
  r('footerScale', 'Footer scale', 'Footer Buttons', '×', 'Scales the Re-roll button.'),

  r('toggleY', 'Toggle Y offset', 'Minimize Toggle', 'px', 'Vertical offset of the "Inspect the board" toggle.'),
  r('toggleScale', 'Toggle scale', 'Minimize Toggle', '×', 'Scales the minimize toggle button.'),
];

export const SPEC: TunerSpec<RuneforgeLookConfig> = {
  id: 'runeforgelook',             // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Runeforge Look',
  note: 'dev · live · persists',
  read: getRuneforgeLookConfig,
  write: (key, value) => setRuneforgeLookValue(key, value),
  reset: resetRuneforgeLookConfig,
  defaults: DEFAULTS,
  controls,
};

// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the CSS fallbacks either way).
applyRuneforgeLookVars();
