import type { TunerControl, TunerSpec } from './tunerSchema';
import { DEFAULT_THEME, UI_FINISH_DEFAULT, UI_FINISH_VARS, UI_THEMES, UI_THEME_GROUPS, UI_THEME_IDS, UI_THEME_KEYS, UI_THEME_LABELS, UI_THEME_VARS, uiThemeFinish, type UiThemeId, type UiThemeTokens } from './uiThemes';

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
 * 90 themes since 2026-10-03 (owner asks: "add 12 new color themes for the ui in the ui tuner", then "add 12 more
 * themes ... separate them by color scheme", then "add 30 more themes ... some 'basic' ones ... as well as some more
 * unique/in depth ones"), listed in the tuner in `<optgroup>` sections (`UI_THEME_GROUPS`).
 *
 * THE SHORTLIST (2026-10-03, owner: "im also not 100% sold on a best default yet"): a DEV-only star per theme, kept
 * in localStorage (`ascent.uiThemeShortlist`), so the owner can narrow ninety down to a few candidates. Starred
 * themes get a "Shortlisted" optgroup at the top of the dropdown and a filter in the swatch grid. It never changes
 * the default.
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
  // The optional finish dials: written only when they differ from the stylesheet's 1, so a theme without a finish
  // leaves `:root` exactly as uiTheme.css has it.
  const f = uiThemeFinish(cfg.theme);
  for (const k of ['sheen', 'bevel'] as const) {
    if (f[k] === UI_FINISH_DEFAULT[k]) root.removeProperty(UI_FINISH_VARS[k]);
    else root.setProperty(UI_FINISH_VARS[k], String(f[k]));
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
  const f = uiThemeFinish(id);
  return [
    `/* ${UI_THEME_LABELS[id]} (DEFAULT_THEME = '${id}') */`, ':root {', ...UI_THEME_KEYS.map((k) => `  ${UI_THEME_VARS[k]}: ${t[k]};`),
    `  ${UI_FINISH_VARS.sheen}: ${f.sheen};`, `  ${UI_FINISH_VARS.bevel}: ${f.bevel};`, '}',
  ].join('\n');
}

/* ── The shortlist (DEV only) ── */
const SHORTLIST_KEY = 'ascent.uiThemeShortlist';
/** Keep only known theme ids, once each, in registry (dropdown) order. */
export function sanitizeShortlist(v: unknown): UiThemeId[] {
  const set = new Set(Array.isArray(v) ? v.filter(isTheme) : []);
  return UI_THEME_IDS.filter((id) => set.has(id));
}
let shortlist: UiThemeId[] = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return [];
  try { return sanitizeShortlist(JSON.parse(localStorage.getItem(SHORTLIST_KEY) ?? '[]')); } catch { return []; }
})();
export function getUiThemeShortlist(): readonly UiThemeId[] { return shortlist; }
export function isUiThemeShortlisted(id: UiThemeId): boolean { return shortlist.includes(id); }
export function toggleUiThemeShortlist(id: UiThemeId): void {
  shortlist = sanitizeShortlist(isUiThemeShortlisted(id) ? shortlist.filter((x) => x !== id) : [...shortlist, id]);
  try { localStorage.setItem(SHORTLIST_KEY, JSON.stringify(shortlist)); } catch { /* ignore */ }
}
/** The dropdown's sections: a "Shortlisted" group on top when anything is starred (a starred theme then lists twice,
 *  there and in its own family), then the registry groups (Basic first). */
export function uiThemeDropdownGroups(list: readonly UiThemeId[]): readonly { label: string; options: readonly string[] }[] {
  return list.length ? [{ label: '★ Shortlisted', options: list }, ...UI_THEME_GROUPS] : UI_THEME_GROUPS;
}

const controls: TunerControl<Extract<keyof UiThemeConfig, string>>[] = [
  {
    key: 'theme', label: 'Theme', kind: 'select', options: UI_THEME_IDS, optionLabels: UI_THEME_LABELS,
    // a getter, so the Shortlisted group follows the stars without rebuilding the spec
    get optionGroups() { return uiThemeDropdownGroups(shortlist); },
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
