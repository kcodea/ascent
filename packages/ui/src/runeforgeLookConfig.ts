/**
 * DEV tuner config for the RUNEFORGE OVERLAY's LOOK (owner ask 2026-08-29) — every element of the Runesmith's
 * turn-6 shop (and its higher-power EPIC variant) placed, sized and coloured: the stone banner/title plaque, the
 * current-Gold pill, the rune-tablet row (name, kicker, rules box, cost coin, sigil medallion), the Re-roll/Leave
 * footer, and the "Inspect the board" minimize toggle. Its sibling 🪨 Runeforge Backdrop tuner owns the
 * illustrated art BEHIND the panel; this one owns everything painted ON it.
 *
 * Same architecture as `boardEdgeConfig` / `lobbyRailLookConfig`: DEV-only localStorage, values pushed onto
 * `:root` as `--rfl-*` custom properties, read by the `.forge-*` / `.runecard*` rules in styles.css WITH the
 * shipped value as their fallback — so PRODUCTION, which never runs the tuner, paints identically with no JS.
 * Shipping a tune means pasting the copied JSON into DEFAULTS here AND mirroring it into those fallbacks.
 *
 * SCOPING: every selector this module drives — `.forge-banner`, `.forge-gold`, `.forge-cards`, `.forge-toggle`,
 * `.forge-actions`, `.runecard*` — is exclusive to the Runeforge; none of them are the shared `.disc-*` base
 * classes the Discover / Quest overlays also wear (those are left untouched), so nothing here can leak onto
 * those overlays. Verified by grepping each class name's usage before writing its rule.
 *
 * GEOMETRY IS DESIGN PX × `--u`, matching the surrounding `.forge-*` rules (which are already written as
 * `calc(N * var(--u))`), so a tune stays pinned across screen sizes — EXCEPT the `.runecard-cost` / rune-emblem
 * offsets, which stay RAW px because the rule they extend (`.runecard`) is itself written in raw px, not `--u`
 * (a pre-existing inconsistency in that component — new offsets match the rule they sit in, not the file as a
 * whole). Scales are unitless ×.
 *
 * TWO COLOUR PAIRS ARE DERIVED, not stored per-stop: the banner plaque and the Gold pill are each a 2–3-stop
 * vertical gradient in the shipped CSS. Rather than expose every stop (which the picker can't blend sanely),
 * one base tone is stored and `shade()` reproduces the other stop(s) by the SAME fixed RGB offset the shipped
 * gradient already uses — so the DEFAULT base tone regenerates the exact shipped stops (see the comments beside
 * each `shade()` call), and tuning the base slides the whole gradient together.
 *
 * THE RUNE "KICKER" LABEL (the "Rune"/"Epic Rune" caption) is normally tinted from the CARD'S OWN accent colour
 * (`--c`, grey for a basic rune, violet for an epic one — see `.runecard-epic` in styles.css) via a
 * `color-mix()` this module does NOT touch. Giving it a flat override knob while keeping that automatic tint
 * for the untuned case is why there are TWO separate knobs (`kickerCol`, `kickerEpicCol`) rather than one: each
 * DEFAULT is the literal colour that formula already produces for that state (computed once, below), so an
 * untouched panel reproduces the exact shipped pixels while still giving the owner independent control.
 */
import type { TunerControl, TunerSpec } from './tunerSchema';

export interface RuneforgeLookConfig {
  // Banner / title plaque
  banX: number;         // px — banner horizontal nudge (added to its centered position)
  banY: number;         // px — banner vertical nudge
  banScale: number;     // × — banner scale (plaque + icon + title together)
  plaqueCol: string;    // the plaque's base/mid tone — the light/dark gradient stops derive from this
  titleCol: string;     // "RUNEFORGE" text colour (basic)
  titleScale: number;   // × — title font size

  // Gold pill
  goldX: number;        // px
  goldY: number;        // px
  goldScale: number;    // ×
  goldBgCol: string;    // pill's base/dark gradient tone
  goldTextCol: string;  // the "N Gold" text

  // Cards row
  rowY: number;         // px — the row's vertical offset (added to its margin-top)
  cardGap: number;      // px — gap between rune tablets
  cardScale: number;    // × — the row's own card-height multiplier (replaces the shipped 1.3 literal)
  nameScale: number;    // × — rune name font size
  nameCol: string;      // rune name text colour
  kickerCol: string;    // the "Rune" kicker label colour on a BASIC tablet
  rulesBgCol: string;   // the rules-text box background (painted at ~84% via color-mix, matching the shipped rgba)
  rulesTxtCol: string;  // the rules-text colour
  costScale: number;    // × — the gold cost coin
  costX: number;        // px — cost coin nudge (raw px — the rule it extends is itself raw px, not --u)
  costY: number;        // px
  emblemScale: number;  // × — the rune sigil medallion

  // Footer (Re-roll + Leave)
  footerY: number;      // px
  footerScale: number;  // ×

  // Minimize toggle ("Inspect the board")
  toggleY: number;      // px
  toggleScale: number;  // ×

  // Epic variant — colours that already differ from the basic forge
  epicTitleCol: string;    // "Epic Runeforge" title colour
  epicIconCol: string;     // the banner's anvil icon colour in the Epic forge
  kickerEpicCol: string;   // the "Epic Rune" kicker label colour on an EPIC tablet
}

/** Owner-tunable; these mirror the CSS fallbacks in the `.forge-*` / `.runecard*` rules in styles.css, so
 *  production paints them with no JS. Bake a tune by pasting Copy values here AND updating those fallbacks. */
const DEFAULTS: RuneforgeLookConfig = {
  banX: 0,
  banY: 0,
  banScale: 1,
  plaqueCol: '#4a4e57',
  titleCol: '#e9e6dc',
  titleScale: 1,

  goldX: 0,
  goldY: 0,
  goldScale: 1,
  goldBgCol: '#2b2015',
  goldTextCol: '#f4ecdb',

  rowY: 0,
  cardGap: 18,
  cardScale: 1.3,
  nameScale: 1,
  nameCol: '#ffffff',
  kickerCol: '#b7bbc4',       // color-mix(in srgb, #7c8493 55%, #fff) baked to a literal
  rulesBgCol: '#090a0d',
  rulesTxtCol: '#f1ece3',
  costScale: 1,
  costX: 0,
  costY: 0,
  emblemScale: 1,

  footerY: 0,
  footerScale: 1,

  toggleY: 0,
  toggleScale: 1,

  epicTitleCol: '#efe0ff',
  epicIconCol: '#cda6f2',
  kickerEpicCol: '#d4b5f1',   // color-mix(in srgb, #b078e6 55%, #fff) baked to a literal
};

export { DEFAULTS as RUNEFORGE_LOOK_DEFAULTS };

/** `[min, max, step]` for the numeric knobs. */
const RANGES: Record<
  'banX' | 'banY' | 'banScale' | 'titleScale'
  | 'goldX' | 'goldY' | 'goldScale'
  | 'rowY' | 'cardGap' | 'cardScale' | 'nameScale' | 'costScale' | 'costX' | 'costY' | 'emblemScale'
  | 'footerY' | 'footerScale' | 'toggleY' | 'toggleScale',
  [number, number, number]
> = {
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
  emblemScale: [0.5, 2, 0.01],

  footerY: [-200, 200, 1],
  footerScale: [0.5, 2, 0.01],
  toggleY: [-200, 200, 1],
  toggleScale: [0.5, 2, 0.01],
};

const KEY = 'ascent.runeforgeLook';

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

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHexByte(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/** Shift a hex colour by a FIXED per-channel RGB offset — reproduces a shipped gradient's other stop(s) from a
 *  single tunable base tone. Clamped to a valid byte per channel. */
function shade(hex: string, dr: number, dg: number, db: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `#${toHexByte(r + dr)}${toHexByte(g + dg)}${toHexByte(b + db)}`;
}

/** Reflect every value onto `:root` as `--rfl-*`. Each `.forge-*` / `.runecard*` rule reads these WITH a
 *  fallback, so a missing var (production, or a stale save) renders the shipped look rather than a broken one. */
export function applyRuneforgeLookVars(): void {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;

  s.setProperty('--rfl-ban-x', String(cfg.banX));
  s.setProperty('--rfl-ban-y', String(cfg.banY));
  s.setProperty('--rfl-ban-scale', String(cfg.banScale));
  s.setProperty('--rfl-plaque', cfg.plaqueCol);
  // The shipped plaque gradient is #6a6f7a 0% / #4a4e57 55% / #363a42 100% — light is base+(32,33,35),
  // dark is base-(20,20,21). At the default base (#4a4e57) these reproduce those two stops exactly.
  s.setProperty('--rfl-plaque-lt', shade(cfg.plaqueCol, 32, 33, 35));
  s.setProperty('--rfl-plaque-dk', shade(cfg.plaqueCol, -20, -20, -21));
  s.setProperty('--rfl-title-col', cfg.titleCol);
  s.setProperty('--rfl-title-scale', String(cfg.titleScale));

  s.setProperty('--rfl-gold-x', String(cfg.goldX));
  s.setProperty('--rfl-gold-y', String(cfg.goldY));
  s.setProperty('--rfl-gold-scale', String(cfg.goldScale));
  s.setProperty('--rfl-gold-bg', cfg.goldBgCol);
  // The shipped pill gradient is #2b2015 0% / #1a130c 100% — dark is base-(17,13,9), exact at the default base.
  s.setProperty('--rfl-gold-bg-dk', shade(cfg.goldBgCol, -17, -13, -9));
  s.setProperty('--rfl-gold-text', cfg.goldTextCol);

  s.setProperty('--rfl-row-y', String(cfg.rowY));
  s.setProperty('--rfl-card-gap', String(cfg.cardGap));
  s.setProperty('--rfl-card-scale', String(cfg.cardScale));
  s.setProperty('--rfl-name-scale', String(cfg.nameScale));
  s.setProperty('--rfl-name-col', cfg.nameCol);
  s.setProperty('--rfl-kicker-col', cfg.kickerCol);
  s.setProperty('--rfl-rules-bg', cfg.rulesBgCol);
  s.setProperty('--rfl-rules-txt', cfg.rulesTxtCol);
  s.setProperty('--rfl-cost-scale', String(cfg.costScale));
  s.setProperty('--rfl-cost-x', String(cfg.costX));
  s.setProperty('--rfl-cost-y', String(cfg.costY));
  s.setProperty('--rfl-emblem-scale', String(cfg.emblemScale));

  s.setProperty('--rfl-footer-y', String(cfg.footerY));
  s.setProperty('--rfl-footer-scale', String(cfg.footerScale));
  s.setProperty('--rfl-toggle-y', String(cfg.toggleY));
  s.setProperty('--rfl-toggle-scale', String(cfg.toggleScale));

  s.setProperty('--rfl-epic-title-col', cfg.epicTitleCol);
  s.setProperty('--rfl-epic-icon-col', cfg.epicIconCol);
  s.setProperty('--rfl-kicker-epic-col', cfg.kickerEpicCol);
}

export function setRuneforgeLookValue(key: keyof RuneforgeLookConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyRuneforgeLookVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetRuneforgeLookConfig(): void {
  cfg = { ...DEFAULTS };
  applyRuneforgeLookVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const r = (
  key: keyof typeof RANGES, label: string, group: string,
  unit: TunerControl['unit'], hint: string,
): TunerControl<Extract<keyof RuneforgeLookConfig, string>> => {
  const [min, max, step] = RANGES[key];
  return { key, label, group, unit, hint, min, max, step };
};
const col = (
  key: Extract<keyof RuneforgeLookConfig, string>, label: string, group: string, hint: string,
): TunerControl<Extract<keyof RuneforgeLookConfig, string>> =>
  ({ key, label, group, hint, kind: 'color', min: 0, max: 0, step: 0 });

const controls: TunerControl<Extract<keyof RuneforgeLookConfig, string>>[] = [
  r('banX', 'Banner X', 'Banner / Title', 'px', 'Nudge the title plaque left/right of centre.'),
  r('banY', 'Banner Y', 'Banner / Title', 'px', 'Nudge the title plaque up/down.'),
  r('banScale', 'Banner scale', 'Banner / Title', '×', 'Scales the whole plaque — icon and title together.'),
  col('plaqueCol', 'Plaque colour', 'Banner / Title', "The plaque's base tone — its light/dark gradient stops shift with it."),
  col('titleCol', 'Title colour', 'Banner / Title', '"RUNEFORGE" text colour on the basic forge.'),
  r('titleScale', 'Title size', 'Banner / Title', '×', 'Font size of the "RUNEFORGE" title.'),

  r('goldX', 'Gold pill X', 'Gold Pill', 'px', 'Nudge the current-Gold pill left/right of centre.'),
  r('goldY', 'Gold pill Y', 'Gold Pill', 'px', 'Nudge the Gold pill up/down.'),
  r('goldScale', 'Gold pill scale', 'Gold Pill', '×', 'Scales the whole Gold pill.'),
  col('goldBgCol', 'Pill background', 'Gold Pill', "The pill's base tone — its darker gradient stop shifts with it."),
  col('goldTextCol', 'Pill text colour', 'Gold Pill', 'The "N Gold" text colour.'),

  r('rowY', 'Row Y offset', 'Cards Row', 'px', 'Vertical offset of the whole rune-tablet row.'),
  r('cardGap', 'Card gap', 'Cards Row', 'px', 'Horizontal gap between rune tablets.'),
  r('cardScale', 'Card scale', 'Cards Row', '×', 'Size of the rune tablets themselves.'),
  r('nameScale', 'Name size', 'Cards Row', '×', 'Font size of the rune name.'),
  col('nameCol', 'Name colour', 'Cards Row', 'The rune name text colour.'),
  col('kickerCol', 'Kicker colour (basic)', 'Cards Row', 'The "Rune" kicker label colour on a basic tablet.'),
  col('rulesBgCol', 'Rules box background', 'Cards Row', "The rules-text box's background (painted at ~84% opacity)."),
  col('rulesTxtCol', 'Rules text colour', 'Cards Row', "The rune's rules text colour."),
  r('costScale', 'Cost coin scale', 'Cards Row', '×', 'Size of the Gold cost coin overhanging the top-left corner.'),
  r('costX', 'Cost coin X', 'Cards Row', 'px', 'Nudge the cost coin left/right.'),
  r('costY', 'Cost coin Y', 'Cards Row', 'px', 'Nudge the cost coin up/down.'),
  r('emblemScale', 'Medallion scale', 'Cards Row', '×', 'Size of the rune sigil medallion at the top of the tablet.'),

  r('footerY', 'Footer Y offset', 'Footer Buttons', 'px', 'Vertical offset of the Re-roll / Leave button row.'),
  r('footerScale', 'Footer scale', 'Footer Buttons', '×', 'Scales the Re-roll / Leave button row.'),

  r('toggleY', 'Toggle Y offset', 'Minimize Toggle', 'px', 'Vertical offset of the "Inspect the board" toggle.'),
  r('toggleScale', 'Toggle scale', 'Minimize Toggle', '×', 'Scales the minimize toggle button.'),

  col('epicTitleCol', 'Epic title colour', 'Epic Variant', '"Epic Runeforge" title colour.'),
  col('epicIconCol', 'Epic banner icon colour', 'Epic Variant', "The banner's anvil icon colour on the Epic forge."),
  col('kickerEpicCol', 'Kicker colour (epic)', 'Epic Variant', 'The "Epic Rune" kicker label colour on an epic tablet.'),
];

export const SPEC: TunerSpec<RuneforgeLookConfig> = {
  id: 'runeforgelook',             // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Runeforge Look',
  note: 'dev · live · persists',
  read: getRuneforgeLookConfig,
  write: (key, value) => setRuneforgeLookValue(key, value),
  writeColor: (key, value) => setRuneforgeLookValue(key, value),
  reset: resetRuneforgeLookConfig,
  defaults: DEFAULTS,
  controls,
};

// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the styles.css fallbacks either way).
applyRuneforgeLookVars();
