/**
 * DEV-only Play-Screen (MODE picker) config — live scale + size + position for each mode card (Play, Learn,
 * Practice), driven by CSS custom properties on `:root` (the same trick the Layout Lab uses). Every card gets a
 * Scale, Width, Height and X/Y offset. The offsets are a `translate` from the card's flex position, so each card
 * moves independently without reflowing the others — ideal for dialling a layout by eye.
 *
 * Every value defaults to the SHIPPED look (see the `.mcframe[data-mp=…]` fallbacks in styles.css), so an
 * untouched tuner changes nothing and production (where the tuner never mounts, vars unset) uses those same
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

// Per-card knob set. `def`s mirror the shipped `.mcframe[data-mp=…]` values in styles.css — keep the two in
// sync so a Reset (and production) matches what players see. Play/Learn are 21:9 banners (660×283); Practice a
// square tile (306×306).
function cardVars(id: 'play' | 'learn' | 'practice', group: string, w: number, h: number): ModePickVarDef[] {
  return [
    { key: `${id}S`, cssVar: `--mp-${id}-s`, label: 'Scale', group, min: 0.3, max: 2.5, step: 0.01, def: 1, fmt: 'mul' },
    { key: `${id}W`, cssVar: `--mp-${id}-w`, label: 'Width', group, min: 120, max: 1400, step: 2, def: w, fmt: 'px' },
    { key: `${id}H`, cssVar: `--mp-${id}-h`, label: 'Height', group, min: 100, max: 1000, step: 2, def: h, fmt: 'px' },
    { key: `${id}X`, cssVar: `--mp-${id}-x`, label: 'X offset', group, min: -1200, max: 1200, step: 1, def: 0, fmt: 'px' },
    { key: `${id}Y`, cssVar: `--mp-${id}-y`, label: 'Y offset', group, min: -1000, max: 1000, step: 1, def: 0, fmt: 'px' },
  ];
}

export const MODEPICK_VARS: ModePickVarDef[] = [
  ...cardVars('play', 'Play', 660, 283),
  ...cardVars('learn', 'Learn', 660, 283),
  ...cardVars('practice', 'Practice', 306, 306),
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
