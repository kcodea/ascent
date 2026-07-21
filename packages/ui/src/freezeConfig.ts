/**
 * Tunable placement for the standalone FREEZE button (`FreezeButton.tsx`) — moved out of the shop tray to
 * the board's TOP-RIGHT, opposite the Tavern Up stone. Stage-pinned like the other board buttons.
 *
 * Deliberately MINIMAL for now: position + scale only. The freeze art isn't in yet, so the button still
 * renders the existing tray styling — once the art lands this grows the same glow/sheen/press groups the
 * Refresh crystal has. Adding those dials before there's art to hang them on would just be dead sliders.
 *
 * Config is localStorage-persisted in DEV only; production always renders DEFAULTS (Layout Lab convention).
 * Values reflect to `--frz-*` CSS vars — the styles.css fallbacks MUST mirror DEFAULTS.
 */
export interface FreezeConfig {
  /** Position — px offset from the stage-pinned base point (board's RIGHT-middle), × --scale. +x → right. */
  x: number;
  /** Position — px offset from the base point, × --scale. +y → down. */
  y: number;
  /** Overall button scale (×). */
  scale: number;
}

// Mirrors the Tavern stone's anchor on the opposite side (its x is 8 at 0.155 of the stage; this sits at
// 0.845), so the two read as a matched pair until the real art arrives and it gets tuned properly.
const DEFAULTS: FreezeConfig = {
  x: -8,
  y: -287,
  scale: 1,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const FRZ_RANGES: Record<keyof FreezeConfig, [number, number, number]> = {
  x: [-800, 800, 1],
  y: [-500, 500, 1],
  scale: [0.4, 2.5, 0.01],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const FRZ_DESC: Record<keyof FreezeConfig, string> = {
  x: 'Horizontal offset (px × scale) from the stage-pinned base point on the board’s right.',
  y: 'Vertical offset (px × scale) from the base point. Positive = down.',
  scale: 'Overall button size (×).',
};

export const FRZ_NUM_KEYS = ['x', 'y', 'scale'] as const;

const KEY = 'ascent.freezebtn';
// Dev-only persistence: production always renders the shipped DEFAULTS (Layout Lab convention).
let cfg: FreezeConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<FreezeConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getFreezeConfig(): FreezeConfig {
  return cfg;
}

/** Reflect the placement onto :root as `--frz-*`. */
export function applyFreezeVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--frz-x', `${cfg.x}px`);
  root.setProperty('--frz-y', `${cfg.y}px`);
  root.setProperty('--frz-s', String(cfg.scale));
}

export function setFreezeValue(key: keyof FreezeConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  applyFreezeVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetFreezeConfig(): void {
  cfg = { ...DEFAULTS };
  applyFreezeVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the CSS fallbacks either way).
applyFreezeVars();
