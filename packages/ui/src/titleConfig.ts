/**
 * Tunable look + placement for the main-menu TITLE LOGO — the peak mark (`TitleMark` in Title.tsx) + the ASCENT
 * wordmark, laid out as a flex row in `.titlelogo`. Owner-tuned live via the 🏔️ Title Logo dev tuner:
 * placement, the wordmark FONT (a curated quick-pick set of Google Fonts OR any family typed into the custom
 * field, lazy-loaded on pick), separate GLOWS for the text and the mark, and a FLOAT that can bob the whole
 * logo as one (synced) or the mark and text independently (separate).
 *
 * Config is localStorage-persisted in DEV only; PRODUCTION always renders DEFAULTS (Layout Lab convention).
 * Values reflect to `--title-*` CSS vars — the styles.css fallbacks MUST mirror DEFAULTS.
 */
export interface TitleConfig {
  /** Peak mark size (px) — the `font-size` the `.crest`-sized SVG reads (1em square). */
  markSize: number;
  /** Gap (px) between the mark and the wordmark — bump it to nudge the text right of the logo. */
  gap: number;
  /** Whole-logo horizontal offset (px). Positive = right. */
  x: number;
  /** Whole-logo vertical offset (px). Negative = up. */
  y: number;
  /** Wordmark font family — a quick-pick from TITLE_FONTS. Lazy-loaded from Google Fonts when selected. */
  font: string;
  /** Free-text override: type ANY Google Font family name and it's loaded live. Wins over `font` when non-empty. */
  fontCustom: string;
  /** Text glow — blur radius (px) of each pass. */
  textGlowSize: number;
  /** Text glow — how many passes are stacked. 0 = off (only the base legibility shadow shows). */
  textGlowStrength: number;
  /** Text glow — colour (hex). */
  textGlowColor: string;
  /** Mark glow — blur radius (px) of each drop-shadow pass. */
  logoGlowSize: number;
  /** Mark glow — how many drop-shadow passes are stacked. 0 = off. */
  logoGlowStrength: number;
  /** Mark glow — colour (hex). */
  logoGlowColor: string;
  /** Float sync: 1 = the whole logo bobs as one; 0 = the mark and text bob independently. */
  floatSync: number;
  /** Float — how far the LOGO bobs up (px). Drives the whole group when synced, the mark alone when separate. */
  floatAmp: number;
  /** Float — seconds per LOGO bob cycle. Drives the whole group when synced, the mark alone when separate. */
  floatSpeed: number;
  /** Float — how far the TEXT bobs up (px). Only active when separate (floatSync = 0). */
  textFloatAmp: number;
  /** Float — seconds per TEXT bob cycle. Only active when separate (floatSync = 0). */
  textFloatSpeed: number;
}

// Owner-tuned in the 🏔️ Title Logo tuner and baked as the shipped look (2026-08-21): a slightly smaller mark
// with a wider text gap, the mark carrying a soft gold glow, no text glow, and a SEPARATE float — the mark
// bobs small + quick, the wordmark larger + slower.
const DEFAULTS: TitleConfig = {
  markSize: 108,
  gap: 42,
  x: 1,
  y: -18,
  font: 'Outfit',
  fontCustom: '',
  textGlowSize: 0,
  textGlowStrength: 0,
  textGlowColor: '#bc9749',
  logoGlowSize: 4,
  logoGlowStrength: 1,
  logoGlowColor: '#bc9749',
  floatSync: 0,
  floatAmp: 2,
  floatSpeed: 2.6,
  textFloatAmp: 4,
  textFloatSpeed: 4.5,
};

/**
 * Curated title-appropriate Google Fonts for the quick-pick dropdown. `load` is the `family=` query for the
 * css2 API (with the weights the face actually ships, so the request never 400s); `null` means it is already
 * `<link>`ed from index.html. ANY other Google Font can still be used via the custom text field.
 */
const FONTS: { value: string; load: string | null }[] = [
  { value: 'Outfit', load: null },
  { value: 'Sora', load: null },
  { value: 'Cinzel', load: 'Cinzel:wght@400;700;900' },
  { value: 'Cinzel Decorative', load: 'Cinzel+Decorative:wght@400;700;900' },
  { value: 'Cormorant Garamond', load: 'Cormorant+Garamond:wght@400;600;700' },
  { value: 'Marcellus', load: 'Marcellus' },
  { value: 'Philosopher', load: 'Philosopher:wght@400;700' },
  { value: 'Uncial Antiqua', load: 'Uncial+Antiqua' },
  { value: 'MedievalSharp', load: 'MedievalSharp' },
  { value: 'Metamorphous', load: 'Metamorphous' },
  { value: 'Grenze Gotisch', load: 'Grenze+Gotisch:wght@400;700;900' },
  { value: 'Pirata One', load: 'Pirata+One' },
  { value: 'Eczar', load: 'Eczar:wght@400;600;800' },
];
/** The font names offered by the tuner's quick-pick select. */
export const TITLE_FONTS = FONTS.map((f) => f.value);

const loadedFonts = new Set<string>();
/**
 * Inject the Google-Fonts stylesheet for `family` once. A curated font uses its known-good weight query;
 * anything else (a name typed into the custom field) is requested by family alone — no weight axis, so the
 * request can't 400 on a face that lacks a weight (the wordmark's own font-weight then applies/synthesises).
 */
function ensureFontLoaded(family: string): void {
  if (typeof document === 'undefined') return;
  const fam = family.trim();
  if (!fam || loadedFonts.has(fam)) return;
  const curated = FONTS.find((x) => x.value.toLowerCase() === fam.toLowerCase());
  loadedFonts.add(fam);
  if (curated && curated.load === null) return; // already linked from index.html
  const query = curated?.load ?? fam.replace(/\s+/g, '+');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${query}&display=swap`;
  document.head.appendChild(link);
}

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key. */
export const TITLE_RANGES: Record<Exclude<keyof TitleConfig, 'font' | 'fontCustom' | 'textGlowColor' | 'logoGlowColor'>, [number, number, number]> = {
  markSize: [40, 320, 1],
  gap: [0, 160, 1],
  x: [-300, 300, 1],
  y: [-300, 300, 1],
  textGlowSize: [0, 80, 1],
  textGlowStrength: [0, 8, 1],
  logoGlowSize: [0, 80, 1],
  logoGlowStrength: [0, 8, 1],
  floatSync: [0, 1, 1], // rendered as a toggle in the tuner, not a slider
  floatAmp: [0, 40, 0.5],
  floatSpeed: [1, 12, 0.1],
  textFloatAmp: [0, 40, 0.5],
  textFloatSpeed: [1, 12, 0.1],
};

/** One-line definitions, shown as a hover tooltip on each control's name in the DEV tuner. */
export const TITLE_DESC: Record<keyof TitleConfig, string> = {
  markSize: 'Size of the peak mark beside the ASCENT wordmark.',
  gap: 'Space between the mark and the wordmark — raise it to push the text right of the logo.',
  x: 'Move the whole logo (mark + text) horizontally. Positive = right.',
  y: 'Move the whole logo (mark + text) vertically. Negative = up.',
  font: 'Wordmark typeface — a curated quick-pick of Google Fonts, loaded on pick.',
  fontCustom: 'Type ANY Google Font family name (e.g. "Cinzel Decorative"). Overrides the quick-pick when filled.',
  textGlowSize: 'Wordmark glow — blur radius of each pass.',
  textGlowStrength: 'Wordmark glow — stacked passes. 0 turns it off (base shadow stays).',
  textGlowColor: 'Wordmark glow colour.',
  logoGlowSize: 'Mark glow — blur radius of each drop-shadow pass.',
  logoGlowStrength: 'Mark glow — stacked passes. 0 turns it off.',
  logoGlowColor: 'Mark glow colour.',
  floatSync: 'ON = the whole logo bobs together. OFF = the mark and text bob on their own settings.',
  floatAmp: 'Bob height of the mark (and the whole logo when synced). 0 = no float.',
  floatSpeed: 'Seconds per bob cycle for the mark (and the whole logo when synced).',
  textFloatAmp: 'Bob height of the text. Only used when the bob is NOT synced.',
  textFloatSpeed: 'Seconds per bob cycle for the text. Only used when the bob is NOT synced.',
};

export const TITLE_NUM_KEYS = ['markSize', 'gap', 'x', 'y', 'textGlowSize', 'textGlowStrength', 'logoGlowSize', 'logoGlowStrength', 'floatSync', 'floatAmp', 'floatSpeed', 'textFloatAmp', 'textFloatSpeed'] as const;
export const TITLE_COLOR_KEYS = ['textGlowColor', 'logoGlowColor'] as const;
/** The shipped values, exported so the tuner can mark which controls you have moved away from them. */
export { DEFAULTS as TITLE_DEFAULTS };

const KEY = 'ascent.titlelogo';
// Dev-only persistence: production always renders the shipped DEFAULTS (Layout Lab convention).
let cfg: TitleConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<TitleConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getTitleConfig(): TitleConfig {
  return cfg;
}

/** Reflect the placement, font, glows and float onto :root as `--title-*`. */
export function applyTitleVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--title-mark-size', `${cfg.markSize}px`);
  root.setProperty('--title-gap', `${cfg.gap}px`);
  root.setProperty('--title-x', `${cfg.x}px`);
  root.setProperty('--title-y', `${cfg.y}px`);
  // Font — a typed custom name wins over the quick-pick; load it (once) then point the wordmark at it with the
  // shipped stack as the fallback.
  const family = (cfg.fontCustom || '').trim() || cfg.font;
  ensureFontLoaded(family);
  root.setProperty('--title-font', `'${family}', 'Outfit', sans-serif`);
  // Text glow — an EXTRA text-shadow appended after the base shadows; a transparent no-op when off (a list can't
  // hold `none`). Composed here because CSS can't repeat a shadow a variable number of times.
  const txtOne = `0 0 ${cfg.textGlowSize}px ${cfg.textGlowColor}`;
  root.setProperty('--title-text-glow', cfg.textGlowStrength > 0
    ? Array(Math.round(cfg.textGlowStrength)).fill(txtOne).join(', ')
    : '0 0 0 transparent');
  // Mark glow — extra drop-shadow filters after the base; transparent no-op when off.
  const logoOne = `drop-shadow(0 0 ${cfg.logoGlowSize}px ${cfg.logoGlowColor})`;
  root.setProperty('--title-logo-glow', cfg.logoGlowStrength > 0
    ? Array(Math.round(cfg.logoGlowStrength)).fill(logoOne).join(' ')
    : 'drop-shadow(0 0 0 transparent)');
  // Float — SYNCED bobs the whole group with one animation (perfectly in phase); SEPARATE bobs the mark and the
  // text with their own animations. A name of `none` (amp 0, or the inactive mode) leaves that element static.
  const synced = cfg.floatSync !== 0;
  root.setProperty('--title-float-amp', `${cfg.floatAmp}px`);
  root.setProperty('--title-float-speed', `${Math.max(0.1, cfg.floatSpeed)}s`);
  root.setProperty('--title-group-float-name', synced && cfg.floatAmp > 0 ? 'titlefloat' : 'none');
  root.setProperty('--title-logo-float-amp', `${cfg.floatAmp}px`);
  root.setProperty('--title-logo-float-speed', `${Math.max(0.1, cfg.floatSpeed)}s`);
  root.setProperty('--title-logo-float-name', !synced && cfg.floatAmp > 0 ? 'titlebob' : 'none');
  root.setProperty('--title-text-float-amp', `${cfg.textFloatAmp}px`);
  root.setProperty('--title-text-float-speed', `${Math.max(0.1, cfg.textFloatSpeed)}s`);
  root.setProperty('--title-text-float-name', !synced && cfg.textFloatAmp > 0 ? 'titlebob' : 'none');
}

export function setTitleValue(key: keyof TitleConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyTitleVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetTitleConfig(): void {
  cfg = { ...DEFAULTS };
  applyTitleVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the CSS fallbacks either way).
applyTitleVars();
