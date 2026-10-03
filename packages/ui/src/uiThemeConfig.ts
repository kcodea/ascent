import type { TunerControl, TunerSpec } from './tunerSchema';
import { DEFAULT_THEME, UI_THEMES, UI_THEME_GROUPS, UI_THEME_IDS, UI_THEME_KEYS, UI_THEME_LABELS, UI_THEME_VARS, type UiThemeId, type UiThemeTokens } from './uiThemes';

// The registry (tokens, themes, groups, labels) lives in uiThemes.ts; re-exported so existing imports keep working.
export * from './uiThemes';

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
 * 60 themes since 2026-10-03 (owner asks: "add 12 new color themes for the ui in the ui tuner", then "add 12 more
 * themes ... separate them by color scheme"), listed in the tuner in `<optgroup>` sections (`UI_THEME_GROUPS`).
 *
 * DEV only: the pick persists in localStorage (`ascent.uiTheme`) and is applied at load by the 🎨 UI Theme tuner's
 * module. Production never loads this module and plays the BAKED `:root` block in uiTheme.css, which MUST equal the
 * `DEFAULT_THEME` entry in uiThemes.ts (`tooltipStyle.test.ts` checks the pair).
 *
 * TO BAKE A PICK: set `DEFAULT_THEME` to it, then paste the tuner's "Copy values" block over the `:root` token block
 * in uiTheme.css. Colour only: no token here is a size, so a theme can never move or resize anything.
 *
 * Replaces the 2026-08 "UI Theme" glass-surface tuner (#938, ten presets over the old `--gl-*` vars); its storage key
 * `ascent.uitheme` is cleared at load.
 */

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
    optionGroups: UI_THEME_GROUPS,
    hint: 'Recolours every tooltip and every HUD pill (Health, names, Tier, Freeze, timer, Skip, Summary, End Combat) at once. Live.',
    min: 0, max: 0, step: 0,
  },
];

export const SPEC: TunerSpec<UiThemeConfig> = {
  id: 'uitheme',                    // FROZEN: indexes this panel's dragged position in localStorage
  title: 'UI Theme',
  note: `dev · live · ${UI_THEME_IDS.length} themes`,
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
