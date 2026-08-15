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
  /** Gem overlay — horizontal nudge onto the baked gem, design px (× --u). +x → right. */
  gemX: number;
  /** Gem overlay — vertical nudge onto the baked gem, design px (× --u). +y → down. */
  gemY: number;
  /** Gem overlay — fit (× the default ≈ 50% of the base width). */
  gemS: number;
  /** "Freeze" label pill — horizontal offset from the button centre, design px (× --u). +x → right. */
  pillX: number;
  /** "Freeze" label pill — vertical offset from the button centre, design px (× --u). +y → down. */
  pillY: number;
  /** "Freeze" label pill — size (×). */
  pillS: number;
  /** Gem hover glow — halo blur (px; scales with the button). */
  gemGlowSize: number;
  /** Gem hover glow — intensity: how many drop-shadow passes are stacked. 0 = no halo. */
  gemGlowStrength: number;
  /** Gem — brightness multiplier while the button is hovered (×). */
  gemHoverBright: number;
}

// Mirrors the Tavern stone's anchor on the opposite side (its x is 8 at 0.155 of the stage; this sits at
// 0.845), so the two read as a matched pair until the real art arrives and it gets tuned properly.
const DEFAULTS: FreezeConfig = {
  // Base point is the board's TOP-CENTRE now (see styles.css .frzwrap); x/y fine-tune from there.
  x: 8,
  y: 217,
  scale: 1.36,
  gemX: 0,
  gemY: -4.5,
  gemS: 1.02,
  pillX: 65.5,
  pillY: -26.5,
  pillS: 1.04,
  gemGlowSize: 8,
  gemGlowStrength: 4,
  gemHoverBright: 1.2,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const FRZ_RANGES: Record<keyof FreezeConfig, [number, number, number]> = {
  x: [-800, 800, 1],
  y: [-500, 500, 1],
  scale: [0.4, 2.5, 0.01],
  gemX: [-120, 120, 0.5],
  gemY: [-120, 120, 0.5],
  gemS: [0.3, 2, 0.01],
  pillX: [-200, 200, 0.5],
  pillY: [-200, 200, 0.5],
  pillS: [0.3, 2.5, 0.01],
  gemGlowSize: [0, 40, 0.5],
  gemGlowStrength: [0, 8, 1],
  gemHoverBright: [1, 2.2, 0.01],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const FRZ_DESC: Record<keyof FreezeConfig, string> = {
  x: 'Horizontal offset (px × scale) from the stage-pinned base point on the board’s right.',
  y: 'Vertical offset (px × scale) from the base point. Positive = down.',
  scale: 'Overall button size (×).',
  gemX: 'Nudge the gem overlay horizontally onto the baked gem (design px).',
  gemY: 'Nudge the gem overlay vertically onto the baked gem (design px).',
  gemS: 'Gem overlay fit (× the default seat).',
  pillX: 'Freeze label pill — horizontal offset from the button centre (design px).',
  pillY: 'Freeze label pill — vertical offset from the button centre (design px).',
  pillS: 'Freeze label pill — size (×).',
  gemGlowSize: 'Gem hover glow — halo blur (bigger = softer/wider).',
  gemGlowStrength: 'Gem hover glow — intensity (stacked passes). 0 turns the halo off.',
  gemHoverBright: 'Gem brightness while hovered (×).',
};

export const FRZ_NUM_KEYS = ['x', 'y', 'scale', 'gemX', 'gemY', 'gemS', 'pillX', 'pillY', 'pillS', 'gemGlowSize', 'gemGlowStrength', 'gemHoverBright'] as const;
/** The shipped values, exported so the tuner can mark which controls you have moved away from them. */
export { DEFAULTS as FRZ_DEFAULTS };

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
  root.setProperty('--frz-gem-x', String(cfg.gemX));
  root.setProperty('--frz-gem-y', String(cfg.gemY));
  root.setProperty('--frz-gem-s', String(cfg.gemS));
  root.setProperty('--frz-pill-x', String(cfg.pillX));
  root.setProperty('--frz-pill-y', String(cfg.pillY));
  root.setProperty('--frz-pill-s', String(cfg.pillS));
  // Gem hover glow — a stacked ice-blue drop-shadow (follows the gem's alpha → a halo AROUND the gem), plus a
  // hover brightness. Composed here because CSS can't repeat a filter a variable number of times.
  const frzGlowOne = `drop-shadow(0 0 ${cfg.gemGlowSize}px rgba(120, 200, 255, 0.95))`;
  root.setProperty('--frz-gemglow', cfg.gemGlowStrength > 0
    ? Array(Math.round(cfg.gemGlowStrength)).fill(frzGlowOne).join(' ')
    : 'none');
  root.setProperty('--frz-gem-hover', String(cfg.gemHoverBright));
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
