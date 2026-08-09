/**
 * UI SURFACE THEME (owner ask 2026-08-08: "a tuner for the aesthetic of the ui elements so I can change the
 * colour schemes, like that tune overlay"). One palette drives the game's floating GLASS SURFACES — the
 * quest/rune hover tooltip and the rift-pill tooltip today, and anything else that opts in by reading these
 * vars.
 *
 * HOW IT WORKS. Values are pushed onto `:root` as CSS custom properties, and every rule that uses one carries
 * a CSS fallback equal to the shipped value — so with no override the look is byte-identical and production
 * (which never runs the dev menu) is untouched. Same contract as `stepCounterConfig`.
 *
 * TO SHIP A LOOK: dial it in the DEV "UI Theme" tuner, hit Copy, and paste the values into `DEFAULTS` below —
 * or, if you picked a stock preset wholesale, set `DEFAULTS` to that preset's entry. The tuner writes
 * localStorage, which is per-browser and invisible to the other dev and to the packaged exe; editing
 * `DEFAULTS` is what makes a look real for everyone.
 */
export interface UiThemeConfig {
  /** Stock scheme name — selecting one rewrites every field below. `custom` = you have hand-edited since. */
  preset: string;
  /** Surface tint (the glass body colour, before alpha). */
  surface: string;
  /** Accent — bold values inside a tooltip. */
  accent: string;
  /** Body text. */
  text: string;
  /** Highlight used for the "state" line, and any value that should read as gold/important. */
  value: string;
  /** Surface opacity, 0–100. Lower = more of the board shows through. */
  alpha: number;
  /** Backdrop blur in px. 0 disables the blur entirely (cheapest). */
  blur: number;
  /** Border brightness, 0–100 — how visible the rim and its lit top edge are. */
  border: number;
  /** Corner radius in px. */
  radius: number;
}

/** A stock scheme = every field except `preset`. */
export type ThemePreset = Omit<UiThemeConfig, 'preset'>;

/**
 * TEN STOCK SCHEMES. `Glass Slate` is what ships today, so picking it is a no-op — the rest are alternatives.
 * `Emberforge` is deliberately the OLD brown/orange look, kept as a one-click way back rather than something
 * you would have to reconstruct by hand.
 */
export const THEME_PRESETS: Record<string, ThemePreset> = {
  'Glass Slate':  { surface: '#2e3848', accent: '#a8d8ef', text: '#eef4fb', value: '#e6b45a', alpha: 88, blur: 10, border: 22, radius: 12 },
  'Obsidian':     { surface: '#14161a', accent: '#c9d3e0', text: '#f2f5f9', value: '#d8c48a', alpha: 92, blur: 8,  border: 18, radius: 10 },
  'Frostbite':    { surface: '#22384a', accent: '#9fe8ff', text: '#eaf8ff', value: '#bfe9ff', alpha: 84, blur: 14, border: 30, radius: 14 },
  'Emberforge':   { surface: '#2a2017', accent: '#f0902e', text: '#f6efe2', value: '#e6b45a', alpha: 95, blur: 0,  border: 14, radius: 12 },
  'Verdant':      { surface: '#1e3327', accent: '#8fe3a4', text: '#eefaf1', value: '#d9e88a', alpha: 88, blur: 10, border: 24, radius: 13 },
  'Amethyst':     { surface: '#2b2340', accent: '#c6a0ff', text: '#f3eeff', value: '#e6b45a', alpha: 88, blur: 12, border: 26, radius: 14 },
  'Bloodmoon':    { surface: '#331a1e', accent: '#ff9aa6', text: '#fceef0', value: '#ffc98a', alpha: 90, blur: 8,  border: 22, radius: 11 },
  'Sunspire':     { surface: '#3a2f18', accent: '#ffd98a', text: '#fbf4e4', value: '#ffe9b0', alpha: 90, blur: 9,  border: 24, radius: 12 },
  'Abyss':        { surface: '#0f2b2e', accent: '#7fe3d4', text: '#e8fbf7', value: '#bfe9d8', alpha: 90, blur: 12, border: 20, radius: 14 },
  'Parchment':    { surface: '#e8dcc4', accent: '#7a4a1c', text: '#2a2017', value: '#9a5f18', alpha: 96, blur: 6,  border: 40, radius: 10 },
};
export const THEME_PRESET_NAMES = ['custom', ...Object.keys(THEME_PRESETS)] as const;

/** The SHIPPED look — equals the `Glass Slate` preset, and equals the CSS fallbacks in styles.css. */
const DEFAULTS: UiThemeConfig = { preset: 'Glass Slate', ...THEME_PRESETS['Glass Slate']! };
export { DEFAULTS as UI_THEME_DEFAULTS };

/** Slider bounds for the DEV tuner — [min, max, step] per numeric key. */
export const UI_THEME_RANGES: Record<'alpha' | 'blur' | 'border' | 'radius', [number, number, number]> = {
  alpha: [30, 100, 1],
  blur: [0, 24, 1],
  border: [0, 100, 1],
  radius: [0, 24, 1],
};

const KEY = 'ascent.uitheme';
let cfg: UiThemeConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<UiThemeConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

/** `#rrggbb` → `r, g, b` so a colour can be composed with a tunable alpha inside `rgba()`. Falls back to the
 *  shipped slate on anything unparseable, so a half-typed hex can never blank a surface out. */
function rgbTriplet(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '46, 56, 72';
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Push the palette onto :root. Each var maps 1:1 to a CSS fallback, so applying the defaults is a no-op. */
export function applyUiThemeConfig(): void {
  if (typeof document === 'undefined') return;
  const s = document.documentElement.style;
  const rgb = rgbTriplet(cfg.surface);
  const a = cfg.alpha / 100;
  // Two stops: the surface is a subtle vertical gradient, lighter at the top, which is what reads as "glass"
  // rather than as a flat panel. The lower stop is the tint at full configured alpha.
  s.setProperty('--gl-top', `rgba(${rgb}, ${Math.min(1, a * 0.96).toFixed(3)})`);
  s.setProperty('--gl-bot', `rgba(${rgb}, ${Math.min(1, a).toFixed(3)})`);
  s.setProperty('--gl-blur', cfg.blur > 0 ? `blur(${cfg.blur}px) saturate(1.15)` : 'none');
  s.setProperty('--gl-border', `rgba(190, 214, 240, ${(cfg.border / 100).toFixed(3)})`);
  s.setProperty('--gl-border-top', `rgba(226, 240, 255, ${Math.min(1, (cfg.border / 100) * 1.9).toFixed(3)})`);
  s.setProperty('--gl-text', cfg.text);
  s.setProperty('--gl-accent', cfg.accent);
  s.setProperty('--gl-value', cfg.value);
  s.setProperty('--gl-radius', `${cfg.radius}px`);
}

export function getUiThemeConfig(): UiThemeConfig {
  return cfg;
}

/** Numeric fields. Any hand-edit drops `preset` to `custom`, so the dropdown never claims a stock scheme is
 *  still intact after you have moved a slider away from it. */
export function setUiThemeValue(key: keyof UiThemeConfig, value: number): void {
  cfg = { ...cfg, [key]: value, preset: 'custom' };
  persist();
}

/** String fields — colours AND the preset dropdown. Selecting a stock scheme applies the WHOLE palette. */
export function setUiThemeString(key: keyof UiThemeConfig, value: string): void {
  if (key === 'preset') {
    const p = THEME_PRESETS[value];
    cfg = p ? { ...cfg, ...p, preset: value } : { ...cfg, preset: value };
  } else {
    cfg = { ...cfg, [key]: value, preset: 'custom' };
  }
  persist();
}

export function resetUiThemeConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  applyUiThemeConfig();
}

function persist(): void {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  applyUiThemeConfig();
}

applyUiThemeConfig();
