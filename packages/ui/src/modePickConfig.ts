/**
 * DEV-only Play-Screen (MODE picker) config — live pan + zoom of the ART inside each mode tile (Play, Practice,
 * Versus, Gauntlet, Learn), driven by CSS custom properties on `:root` (the same trick the Layout Lab uses). The art
 * is clipped to the frame, so it can be panned/zoomed inside it. Every value defaults to the SHIPPED look
 * (mirrored in the `.mcframe[data-mp=…] .mcframe-art` fallbacks in styles.css), so an untouched tuner changes
 * nothing and production (tuner unmounted, vars unset) uses those fallbacks. Persists to localStorage; applied at
 * boot in dev only.
 */
export type ModePickFmt = 'mul' | 'px';
export interface ModePickVarDef {
  key: string;
  cssVar: string;
  label: string;
  group: string;
  min: number;
  max: number;
  step: number;
  def: number;
  fmt: ModePickFmt;
}


// Per-card knob set: the ART inside each tile (pan + zoom; it is clipped to the frame). Since the WS-2 mode
// screen (2026-10-16) the tiles' own size and position are a fixed grid in styles.css (`.mpgrid`), so the old
// Scale / Width / Height / X / Y knobs and the MODE-title knobs are gone. Defaults are neutral (x1 / 0px) and
// mirror the `.mcframe[data-mp=...] .mcframe-art` fallbacks in styles.css.
function cardVars(id: 'play' | 'learn' | 'practice' | 'gauntlet' | 'versus', group: string): ModePickVarDef[] {
  return [
    { key: `${id}ArtS`, cssVar: `--mp-${id}-arts`, label: 'Art scale', group, min: 0.3, max: 3, step: 0.01, def: 1, fmt: 'mul' },
    { key: `${id}ArtX`, cssVar: `--mp-${id}-artx`, label: 'Art X', group, min: -800, max: 800, step: 1, def: 0, fmt: 'px' },
    { key: `${id}ArtY`, cssVar: `--mp-${id}-arty`, label: 'Art Y', group, min: -800, max: 800, step: 1, def: 0, fmt: 'px' },
  ];
}

export const MODEPICK_VARS: ModePickVarDef[] = [
  ...cardVars('play', 'Play'),
  ...cardVars('practice', 'Practice'),
  ...cardVars('versus', 'Versus'),
  ...cardVars('gauntlet', 'Gauntlet'),
  ...cardVars('learn', 'Learn'),
];

export type ModePickConfig = Record<string, number>;
const STORAGE_KEY = 'ascent.modepick';

export function defaultModePick(): ModePickConfig {
  const o: ModePickConfig = {};
  for (const v of MODEPICK_VARS) o[v.key] = v.def;
  return o;
}

export function loadModePick(): ModePickConfig {
  const cfg = defaultModePick();
  if (!import.meta.env.DEV) return cfg; // dev-only tweaks must never beat the shipped CSS fallbacks in prod
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<ModePickConfig>;
    for (const v of MODEPICK_VARS) {
      const n = stored[v.key];
      if (typeof n === 'number' && Number.isFinite(n)) cfg[v.key] = n;
    }
  } catch { /* ignore */ }
  return cfg;
}

function saveModePick(cfg: ModePickConfig): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

/** Push every value onto `:root` as its CSS custom property. Defaults reproduce the shipped look. */
export function applyModePick(cfg: ModePickConfig): void {
  const root = document.documentElement.style;
  for (const v of MODEPICK_VARS) {
    const n = cfg[v.key] ?? v.def;
    root.setProperty(v.cssVar, v.fmt === 'px' ? `${n}px` : String(n));
  }
}

let current: ModePickConfig = loadModePick();
export function getModePick(): ModePickConfig { return current; }
export function setModePickValue(key: string, val: number): void {
  current = { ...current, [key]: val };
  saveModePick(current);
  applyModePick(current);
}
export function resetModePick(): void {
  current = defaultModePick();
  saveModePick(current);
  applyModePick(current);
}

// Apply persisted values at load — dev only, so production keeps the CSS fallbacks (the shipped layout).
if (import.meta.env.DEV) applyModePick(current);
