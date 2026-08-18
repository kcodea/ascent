/**
 * DEV-only Play-Screen (MODE picker) config — live scale + size + position for each mode card (Play, Learn,
 * Practice) AND the art inside each card AND the "MODE" title, driven by CSS custom properties on `:root` (the
 * same trick the Layout Lab uses). Per card: Scale, Width, Height, X/Y offset, plus Art scale + Art X/Y (the art
 * is clipped to the frame, so it can be panned/zoomed inside it). The MODE title gets Scale + X/Y.
 *
 * The card X/Y offsets are a `translate` on each frame, so a card moves independently without reflowing the
 * others. Every value defaults to the SHIPPED look (mirrored in the `.mcframe[data-mp=…]` / `.mptitle` fallbacks
 * in styles.css), so an untouched tuner changes nothing and production (tuner unmounted, vars unset) uses those
 * fallbacks. Persists to localStorage; applied at boot in dev only.
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

interface CardDefaults { s: number; w: number; h: number; x: number; y: number; artS: number; artX: number; artY: number; }

// Per-card knob set. `def`s mirror the shipped `.mcframe[data-mp=…]` values in styles.css — keep the two in
// sync so a Reset (and production) matches what players see. Art defaults are neutral (×1 / 0px).
function cardVars(id: 'play' | 'learn' | 'practice', group: string, d: CardDefaults): ModePickVarDef[] {
  return [
    { key: `${id}S`, cssVar: `--mp-${id}-s`, label: 'Scale', group, min: 0.3, max: 2.5, step: 0.01, def: d.s, fmt: 'mul' },
    { key: `${id}W`, cssVar: `--mp-${id}-w`, label: 'Width', group, min: 120, max: 1400, step: 2, def: d.w, fmt: 'px' },
    { key: `${id}H`, cssVar: `--mp-${id}-h`, label: 'Height', group, min: 80, max: 1000, step: 2, def: d.h, fmt: 'px' },
    { key: `${id}X`, cssVar: `--mp-${id}-x`, label: 'X offset', group, min: -1200, max: 1200, step: 1, def: d.x, fmt: 'px' },
    { key: `${id}Y`, cssVar: `--mp-${id}-y`, label: 'Y offset', group, min: -1000, max: 1000, step: 1, def: d.y, fmt: 'px' },
    { key: `${id}ArtS`, cssVar: `--mp-${id}-arts`, label: 'Art scale', group, min: 0.3, max: 3, step: 0.01, def: d.artS, fmt: 'mul' },
    { key: `${id}ArtX`, cssVar: `--mp-${id}-artx`, label: 'Art X', group, min: -800, max: 800, step: 1, def: d.artX, fmt: 'px' },
    { key: `${id}ArtY`, cssVar: `--mp-${id}-arty`, label: 'Art Y', group, min: -800, max: 800, step: 1, def: d.artY, fmt: 'px' },
  ];
}

export const MODEPICK_VARS: ModePickVarDef[] = [
  ...cardVars('play', 'Play', { s: 0.84, w: 660, h: 284, x: -160, y: 115, artS: 1, artX: 0, artY: 0 }),
  ...cardVars('learn', 'Learn', { s: 1, w: 880, h: 128, x: 177, y: 187, artS: 1.02, artX: 0, artY: 3 }),
  ...cardVars('practice', 'Practice', { s: 0.84, w: 306, h: 284, x: -160, y: -170, artS: 1, artX: 0, artY: 0 }),
  { key: 'titleS', cssVar: '--mp-title-s', label: 'Scale', group: 'MODE title', min: 0.3, max: 2.5, step: 0.01, def: 1, fmt: 'mul' },
  { key: 'titleX', cssVar: '--mp-title-x', label: 'X offset', group: 'MODE title', min: -1200, max: 1200, step: 1, def: 0, fmt: 'px' },
  { key: 'titleY', cssVar: '--mp-title-y', label: 'Y offset', group: 'MODE title', min: -1000, max: 1000, step: 1, def: 59, fmt: 'px' },
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
