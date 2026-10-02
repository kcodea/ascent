import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * THE UI THEME (owner ask 2026-10-02: "can you make the tooltips match our hud pill designs now, and then add 6
 * different color themes in the tuner for me to try out to see what looks best. this should control all of them at
 * once").
 *
 * ONE set of colour tokens, the `--ui-*` custom properties declared on `:root` in `uiTheme.css`, paints BOTH the
 * shared tooltip panel (`tooltips.css`, through its `--atip-*` aliases) and every Gem plate HUD pill
 * (`healthPills.css`: Health, names, Tier / Freeze, the turn timer, the combat controls). A theme is a full set of
 * those token values; switching one rewrites the tokens on `:root`, so every surface repaints at once with no React
 * re-render (CSS variables only).
 *
 * DEV only: the pick persists in localStorage (`ascent.uiTheme`) and is applied at load by the 🎨 UI Theme tuner's
 * module. Production never loads this module and plays the BAKED `:root` block in uiTheme.css, which MUST equal the
 * `DEFAULT_THEME` entry below (`tooltipStyle.test.ts` checks the pair).
 *
 * TO BAKE A PICK: set `DEFAULT_THEME` to it, then paste the tuner's "Copy values" block over the `:root` token block
 * in uiTheme.css. Colour only: no token here is a size, so a theme can never move or resize anything.
 *
 * Replaces the 2026-08 "UI Theme" glass-surface tuner (#938, ten presets over the old `--gl-*` vars); its storage key
 * `ascent.uitheme` is cleared at load.
 */

/** Every themed colour. Keys map 1:1 to `--ui-<kebab>` custom properties (see `UI_THEME_VARS`). */
export interface UiThemeTokens {
  /** The plate: a three-stop vertical gradient (top, middle at 55%, bottom). */
  plateTop: string; plateMid: string; plateBot: string;
  /** The filigree edge: a four-stop metallic gradient (highlight, main, shadow, return glint). */
  edgeHi: string; edgeMain: string; edgeDeep: string; edgeLo: string;
  /** The faint inner ring just inside the edge. */
  ring: string;
  /** Text on the plate: body, secondary, titles, highlighted keywords and numbers. */
  text: string; muted: string; title: string; hl: string;
  /** Small chip / tag pills inside a tooltip ("once per turn"). */
  chipBg: string; chipEdge: string; chipText: string;
  /** The divider under a tooltip title. */
  divider: string;
  /** Icon tint on the plate (the Skip / Summary icons, the turn clock's hands stay gold-on-plate). */
  icon: string;
  /** Semantic: the Health heart and the steel Armor chip. */
  heart: string; armorTop: string; armorMid: string; armorBot: string; armorEdge: string; armorInk: string; armorIcon: string;
  /** The gold turn clock (Gem timer icon): its rim + centre pin, and its dial face. */
  clockRim: string; clockFace: string;
  /** Semantic: low turn time (the timer's digits, and the clock's rim, outline and hands). */
  warn: string; warnRim: string; warnEdge: string; warnHand: string;
  /** A button's hover plate and edge. */
  hoverTop: string; hoverMid: string; hoverBot: string;
  hoverEdgeHi: string; hoverEdgeMain: string; hoverEdgeDeep: string; hoverEdgeLo: string;
  /** The Skip button's press lip, and the dark outline of the filigree studs. */
  lip: string; studEdge: string;
}

export const UI_THEME_KEYS = [
  'plateTop', 'plateMid', 'plateBot', 'edgeHi', 'edgeMain', 'edgeDeep', 'edgeLo', 'ring',
  'text', 'muted', 'title', 'hl', 'chipBg', 'chipEdge', 'chipText', 'divider', 'icon',
  'heart', 'armorTop', 'armorMid', 'armorBot', 'armorEdge', 'armorInk', 'armorIcon',
  'clockRim', 'clockFace', 'warn', 'warnRim', 'warnEdge', 'warnHand',
  'hoverTop', 'hoverMid', 'hoverBot', 'hoverEdgeHi', 'hoverEdgeMain', 'hoverEdgeDeep', 'hoverEdgeLo',
  'lip', 'studEdge',
] as const satisfies readonly (keyof UiThemeTokens)[];

/** `plateTop` -> `--ui-plate-top`. */
export const uiVar = (k: keyof UiThemeTokens): string => `--ui-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
export const UI_THEME_VARS: Record<keyof UiThemeTokens, string> =
  Object.fromEntries(UI_THEME_KEYS.map((k) => [k, uiVar(k)])) as Record<keyof UiThemeTokens, string>;

/** The steel Armor chip reads the same in every theme (it is a semantic colour); Frost tints it a touch icier. */
const WARN = { warnRim: '#ff6b81', warnEdge: '#7a1f2e', warnHand: '#ffd0d8' };
const STEEL = { armorTop: '#eef2f6', armorMid: '#b3bdca', armorBot: '#7d8999', armorEdge: '#262d39', armorInk: '#18202c', armorIcon: '#3b4758' };

export const UI_THEMES = {
  /** The Gem plate the HUD pills shipped with: deep amethyst, warm gold filigree. */
  gem: {
    plateTop: '#382950', plateMid: '#21173a', plateBot: '#170f29',
    edgeHi: '#ffe9b0', edgeMain: '#c8953f', edgeDeep: '#7a571f', edgeLo: '#e8c27a', ring: 'rgba(255, 217, 138, 0.2)',
    text: '#fff1d6', muted: '#c6b8d8', title: '#ffd98a', hl: '#ffb561',
    chipBg: '#140d24', chipEdge: '#6b5330', chipText: '#f4ecdb', divider: 'rgba(255, 217, 138, 0.2)', icon: '#ffd98a',
    heart: '#ff2f58', ...STEEL, clockRim: '#e3b04f', clockFace: '#1d1430', warn: '#ff9db0', ...WARN,
    hoverTop: '#4a3768', hoverMid: '#2d2050', hoverBot: '#1f1638',
    hoverEdgeHi: '#fff6d6', hoverEdgeMain: '#ffd27a', hoverEdgeDeep: '#b98a3a', hoverEdgeLo: '#ffe3a0',
    lip: '#6a4b19', studEdge: '#4a3410',
  },
  /** Deep navy with a silver-gold edge. */
  sapphire: {
    plateTop: '#24396a', plateMid: '#15244d', plateBot: '#0c1636',
    edgeHi: '#fdf4d6', edgeMain: '#cbb97f', edgeDeep: '#6c6342', edgeLo: '#e6dcb2', ring: 'rgba(230, 220, 178, 0.2)',
    text: '#eef3ff', muted: '#adbbd8', title: '#f3dc9a', hl: '#ffcc6a',
    chipBg: '#0a1230', chipEdge: '#55628a', chipText: '#eef1fa', divider: 'rgba(230, 220, 178, 0.2)', icon: '#f0dc9e',
    heart: '#ff3d63', ...STEEL, clockRim: '#dccb8e', clockFace: '#101c40', warn: '#ffa3b4', ...WARN,
    hoverTop: '#2f4980', hoverMid: '#1c2f62', hoverBot: '#121f45',
    hoverEdgeHi: '#fffaf0', hoverEdgeMain: '#e6d59e', hoverEdgeDeep: '#8a7d52', hoverEdgeLo: '#f6ecc8',
    lip: '#4a4128', studEdge: '#3a3420',
  },
  /** Black glass with a copper edge and ember-orange highlights. */
  ember: {
    plateTop: '#2c2623', plateMid: '#171413', plateBot: '#0c0a09',
    edgeHi: '#ffd6b0', edgeMain: '#cf7a3e', edgeDeep: '#6c3416', edgeLo: '#eea06a', ring: 'rgba(255, 168, 110, 0.18)',
    text: '#f8ece1', muted: '#bba898', title: '#ffb46e', hl: '#ff9147',
    chipBg: '#0b0807', chipEdge: '#6e3c22', chipText: '#f6e6d6', divider: 'rgba(255, 168, 110, 0.18)', icon: '#ffa25c',
    heart: '#ff3b47', ...STEEL, clockRim: '#e08a4a', clockFace: '#141110', warn: '#ff9a9a', ...WARN,
    hoverTop: '#3b332e', hoverMid: '#211c19', hoverBot: '#131110',
    hoverEdgeHi: '#ffe6cc', hoverEdgeMain: '#ef9654', hoverEdgeDeep: '#8a4622', hoverEdgeLo: '#ffbd86',
    lip: '#5a2a10', studEdge: '#3e1c0a',
  },
  /** Deep violet with a rose-gold edge, after the Ancient / violet art. */
  amethyst: {
    plateTop: '#4c2b6a', plateMid: '#2d184a', plateBot: '#1c0d31',
    edgeHi: '#ffe2d8', edgeMain: '#d6967f', edgeDeep: '#7b4a3e', edgeLo: '#efbaa6', ring: 'rgba(240, 186, 166, 0.2)',
    text: '#fbeffa', muted: '#cfb6da', title: '#ffc8b6', hl: '#ffa3c4',
    chipBg: '#180a2a', chipEdge: '#7a4a64', chipText: '#f8e8f2', divider: 'rgba(240, 186, 166, 0.2)', icon: '#f6baa6',
    heart: '#ff3570', ...STEEL, clockRim: '#e8a892', clockFace: '#24113d', warn: '#ffa3bd', ...WARN,
    hoverTop: '#5e3982', hoverMid: '#3b2160', hoverBot: '#271240',
    hoverEdgeHi: '#fff1ec', hoverEdgeMain: '#ebb09a', hoverEdgeDeep: '#985e4e', hoverEdgeLo: '#ffd2c2',
    lip: '#5e3428', studEdge: '#4a2418',
  },
  /** Dark forest teal with a pale gold edge. */
  verdant: {
    plateTop: '#21463f', plateMid: '#13302b', plateBot: '#0a201c',
    edgeHi: '#fbf4d2', edgeMain: '#c8bb7c', edgeDeep: '#696036', edgeLo: '#e5dca6', ring: 'rgba(229, 220, 166, 0.2)',
    text: '#effaf3', muted: '#abc8bc', title: '#efe2a2', hl: '#c4ec86',
    chipBg: '#071a16', chipEdge: '#4b6a54', chipText: '#eaf5ee', divider: 'rgba(229, 220, 166, 0.2)', icon: '#e6d892',
    heart: '#ff4560', ...STEEL, clockRim: '#dccf8c', clockFace: '#0e2723', warn: '#ffa6b2', ...WARN,
    hoverTop: '#2a5850', hoverMid: '#193d36', hoverBot: '#0f2a25',
    hoverEdgeHi: '#fffbe8', hoverEdgeMain: '#e2d392', hoverEdgeDeep: '#847a48', hoverEdgeLo: '#f3eabe',
    lip: '#4a4422', studEdge: '#383216',
  },
  /** Cool slate with an icy silver edge. */
  frost: {
    plateTop: '#3a4757', plateMid: '#232c39', plateBot: '#161c26',
    edgeHi: '#ffffff', edgeMain: '#b7c7d8', edgeDeep: '#5d6c7e', edgeLo: '#dce8f4', ring: 'rgba(200, 225, 255, 0.22)',
    text: '#f2f7fc', muted: '#aab8c8', title: '#d4ecff', hl: '#8fd8ff',
    chipBg: '#10151d', chipEdge: '#57667b', chipText: '#eef4fa', divider: 'rgba(200, 225, 255, 0.2)', icon: '#cfe6ff',
    heart: '#ff4d6d', ...STEEL, armorTop: '#f2f8fd', armorMid: '#bcc9d8', armorBot: '#8293a8', clockRim: '#c9d8e8', clockFace: '#1b222d', warn: '#ffa3b4', ...WARN,
    hoverTop: '#47566a', hoverMid: '#2c3747', hoverBot: '#1c2431',
    hoverEdgeHi: '#ffffff', hoverEdgeMain: '#d3e1f0', hoverEdgeDeep: '#7a8a9c', hoverEdgeLo: '#eef5fb',
    lip: '#3b4656', studEdge: '#2a3442',
  },
} as const satisfies Record<string, UiThemeTokens>;

export type UiThemeId = keyof typeof UI_THEMES;
export const UI_THEME_IDS = Object.keys(UI_THEMES) as UiThemeId[];
export const UI_THEME_LABELS: Record<UiThemeId, string> = {
  gem: '1. Gem Gold',
  sapphire: '2. Royal Sapphire',
  ember: '3. Obsidian Ember',
  amethyst: '4. Amethyst',
  verdant: '5. Verdant',
  frost: '6. Frost Silver',
};

/** The theme production plays: uiTheme.css's `:root` block must equal it. Gem Gold until the owner picks. */
export const DEFAULT_THEME: UiThemeId = 'gem';

export interface UiThemeConfig { theme: UiThemeId }
const DEFAULTS: UiThemeConfig = { theme: DEFAULT_THEME };
export { DEFAULTS as UI_THEME_DEFAULTS };

const KEY = 'ascent.uiTheme';
const OLD_KEY = 'ascent.uitheme'; // the retired glass-surface tuner (#938)
const isTheme = (v: unknown): v is UiThemeId => typeof v === 'string' && v in UI_THEMES;

let cfg: UiThemeConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    localStorage.removeItem(OLD_KEY);
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const theme = saved && typeof saved === 'object' ? (saved as Partial<UiThemeConfig>).theme : undefined;
    return { theme: isTheme(theme) ? theme : DEFAULT_THEME };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getUiThemeConfig(): UiThemeConfig { return cfg; }

/** Push the picked theme's tokens onto `:root`. The default theme writes nothing (the stylesheet already declares
 *  it), so a reset leaves `:root` exactly as uiTheme.css has it. */
export function applyUiTheme(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const t: UiThemeTokens = UI_THEMES[cfg.theme];
  for (const k of UI_THEME_KEYS) {
    if (cfg.theme === DEFAULT_THEME) root.removeProperty(UI_THEME_VARS[k]);
    else root.setProperty(UI_THEME_VARS[k], t[k]);
  }
}

export function setUiTheme(value: string): void {
  if (!isTheme(value)) return;
  cfg = { theme: value };
  applyUiTheme();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetUiTheme(): void {
  cfg = { ...DEFAULTS };
  applyUiTheme();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The bake-ready CSS for a theme: the token lines to paste over uiTheme.css's `:root` block. */
export function uiThemeCss(id: UiThemeId): string {
  const t: UiThemeTokens = UI_THEMES[id];
  return [`/* ${UI_THEME_LABELS[id]} (DEFAULT_THEME = '${id}') */`, ':root {', ...UI_THEME_KEYS.map((k) => `  ${UI_THEME_VARS[k]}: ${t[k]};`), '}'].join('\n');
}

const controls: TunerControl<Extract<keyof UiThemeConfig, string>>[] = [
  {
    key: 'theme', label: 'Theme', kind: 'select', options: UI_THEME_IDS, optionLabels: UI_THEME_LABELS,
    hint: 'Recolours every tooltip and every HUD pill (Health, names, Tier, Freeze, timer, Skip, Summary, End Combat) at once. Live.',
    min: 0, max: 0, step: 0,
  },
];

export const SPEC: TunerSpec<UiThemeConfig> = {
  id: 'uitheme',                    // FROZEN: indexes this panel's dragged position in localStorage
  title: 'UI Theme',
  note: 'dev · live · 6 themes',
  read: getUiThemeConfig,
  write: () => { /* no numeric controls */ },
  writeColor: (_key, value) => setUiTheme(value),
  reset: resetUiTheme,
  defaults: DEFAULTS,
  controls,
  copy: () => uiThemeCss(cfg.theme),
  copyLabel: 'Copy values',
};

// Apply at load (dev: the persisted pick; prod never imports this module and plays uiTheme.css).
applyUiTheme();
