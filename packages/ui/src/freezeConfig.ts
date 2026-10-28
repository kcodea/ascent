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
  /** Shop ice ring (the art over each frozen shop card) — width, % of the card's frame box. */
  iceW: number;
  /** Shop ice ring — height, % of the card's frame box. */
  iceH: number;
  /** Shop ice ring on SPELL cards — width, % of the spell frame box (the arch is squarer than the ring). */
  iceSpellW: number;
  /** Shop ice ring on SPELL cards — height, % of the spell frame box. */
  iceSpellH: number;
  /** Shop ice ring — horizontal shift, % of the card's frame box. +x → right. */
  iceX: number;
  /** Shop ice ring — vertical shift, % of the card's frame box. +y → down. */
  iceY: number;
  /** Shop ice ring — resting opacity once it has formed (0–1). */
  iceOpacity: number;
  /** Shop ice ring — resting cold glow around the ice: blur (px). 0 = none. */
  iceGlowSize: number;
  /** Shop ice ring — resting glow strength (0–1 alpha of the glow colour). */
  iceGlowAlpha: number;
  /** Shop ice ring — how long the top-to-bottom grow takes (s). */
  iceDur: number;
  /** Shop ice ring — height of the feathered leading edge (% of the sweep; bigger = softer). */
  iceFeather: number;
  /** SPELL ice (its own art, `freeze-ice-spell.webp`) — horizontal shift, % of the spell frame box. */
  iceSpellX: number;
  /** SPELL ice — vertical shift, % of the spell frame box. +y → down. */
  iceSpellY: number;
  /** SPELL ice — resting opacity once formed (0–1). */
  iceSpellOpacity: number;
  /** SPELL ice — resting cold glow blur (px). 0 = none. */
  iceSpellGlowSize: number;
  /** SPELL ice — resting glow strength (0–1). */
  iceSpellGlowAlpha: number;
  /** SPELL ice — grow-in time (s). */
  iceSpellDur: number;
  /** SPELL ice — softness of the growing edge (%). */
  iceSpellFeather: number;
}

// Mirrors the Tavern stone's anchor on the opposite side (its x is 8 at 0.155 of the stage; this sits at
// 0.845), so the two read as a matched pair until the real art arrives and it gets tuned properly.
const DEFAULTS: FreezeConfig = {
  // Base point is the board's TOP-CENTRE now (see styles.css .frzwrap); x/y fine-tune from there.
  x: 8,
  y: 272,
  scale: 1.33,
  gemX: 0,
  gemY: -4.5,
  gemS: 1.02,
  pillX: 65.5,
  pillY: -26.5,
  pillS: 1.04,
  gemGlowSize: 8,
  gemGlowStrength: 4,
  gemHoverBright: 1.2,
  // Shop ice — owner-tuned 2026-10-27.
  iceW: 116,
  iceH: 109.5,
  iceSpellW: 116.5,
  iceSpellH: 116.5,
  iceX: 0.25,
  iceY: 6.75,
  iceOpacity: 0.88,
  iceGlowSize: 5,
  iceGlowAlpha: 0.58,
  iceDur: 1.05,
  iceFeather: 13,
  // Spell ice — owner-tuned 2026-10-27.
  iceSpellX: 0.75,
  iceSpellY: 6.75,
  iceSpellOpacity: 0.86,
  iceSpellGlowSize: 3,
  iceSpellGlowAlpha: 0,
  iceSpellDur: 1.05,
  iceSpellFeather: 13,
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
  iceW: [60, 160, 0.5],
  iceH: [60, 160, 0.5],
  iceSpellW: [60, 160, 0.5],
  iceSpellH: [60, 160, 0.5],
  iceX: [-30, 30, 0.25],
  iceY: [-30, 30, 0.25],
  iceOpacity: [0, 1, 0.01],
  iceGlowSize: [0, 30, 0.5],
  iceGlowAlpha: [0, 1, 0.01],
  iceDur: [0.1, 1.5, 0.01],
  iceFeather: [0, 60, 1],
  iceSpellX: [-30, 30, 0.25],
  iceSpellY: [-30, 30, 0.25],
  iceSpellOpacity: [0, 1, 0.01],
  iceSpellGlowSize: [0, 30, 0.5],
  iceSpellGlowAlpha: [0, 1, 0.01],
  iceSpellDur: [0.1, 1.5, 0.01],
  iceSpellFeather: [0, 60, 1],
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
  iceW: 'Shop ice ring — width (% of the card frame).',
  iceH: 'Shop ice ring — height (% of the card frame).',
  iceSpellW: 'Shop ice ring on spells — width (% of the spell frame).',
  iceSpellH: 'Shop ice ring on spells — height (% of the spell frame).',
  iceX: 'Shop ice ring — horizontal shift (% of the card frame).',
  iceY: 'Shop ice ring — vertical shift (% of the card frame). Positive = down.',
  iceOpacity: 'Shop ice ring — opacity once formed.',
  iceGlowSize: 'Shop ice ring — resting cold glow blur. 0 = off.',
  iceGlowAlpha: 'Shop ice ring — resting glow strength.',
  iceDur: 'Shop ice ring — how long the top-to-bottom grow takes (s).',
  iceFeather: 'Shop ice ring — softness of the growing edge.',
  iceSpellX: 'Spell ice — horizontal shift (% of the spell frame).',
  iceSpellY: 'Spell ice — vertical shift (% of the spell frame). Positive = down.',
  iceSpellOpacity: 'Spell ice — opacity once formed.',
  iceSpellGlowSize: 'Spell ice — resting cold glow blur. 0 = off.',
  iceSpellGlowAlpha: 'Spell ice — resting glow strength.',
  iceSpellDur: 'Spell ice — how long the top-to-bottom grow takes (s).',
  iceSpellFeather: 'Spell ice — softness of the growing edge.',
};

export const FRZ_NUM_KEYS = ['x', 'y', 'scale', 'gemX', 'gemY', 'gemS', 'pillX', 'pillY', 'pillS', 'gemGlowSize', 'gemGlowStrength', 'gemHoverBright',
  'iceW', 'iceH', 'iceSpellW', 'iceSpellH', 'iceX', 'iceY', 'iceOpacity', 'iceGlowSize', 'iceGlowAlpha', 'iceDur', 'iceFeather',
  'iceSpellX', 'iceSpellY', 'iceSpellOpacity', 'iceSpellGlowSize', 'iceSpellGlowAlpha', 'iceSpellDur', 'iceSpellFeather'] as const;
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
  // Shop ice ring over each frozen shop card (styles.css "Frozen tavern"). The fallbacks there mirror DEFAULTS.
  root.setProperty('--frz-ice-w', String(cfg.iceW / 100)); // a scale factor on the box
  root.setProperty('--frz-ice-h', String(cfg.iceH / 100)); // a scale factor on the box
  root.setProperty('--frz-ice-sw', String(cfg.iceSpellW / 100)); // a scale factor on the box
  root.setProperty('--frz-ice-sh', String(cfg.iceSpellH / 100)); // a scale factor on the box
  root.setProperty('--frz-ice-x', `${cfg.iceX}%`);
  root.setProperty('--frz-ice-y', `${cfg.iceY}%`);
  root.setProperty('--frz-ice-op', String(cfg.iceOpacity));
  root.setProperty('--frz-ice-glow', cfg.iceGlowSize > 0 && cfg.iceGlowAlpha > 0
    ? `drop-shadow(0 0 ${cfg.iceGlowSize}px rgba(150, 215, 255, ${cfg.iceGlowAlpha}))`
    : 'none');
  root.setProperty('--frz-ice-dur', `${cfg.iceDur}s`);
  // The reveal mask is 300% tall, so the solid→clear band is centred at 50% and spans the feather each side.
  root.setProperty('--frz-ice-f0', `${50 - cfg.iceFeather / 2}%`);
  root.setProperty('--frz-ice-f1', `${50 + cfg.iceFeather / 2}%`);
  // Spell ice — its own set; the spellframe rule in styles.css re-points the --frz-ice-* vars at these.
  root.setProperty('--frz-ice-s-x', `${cfg.iceSpellX}%`);
  root.setProperty('--frz-ice-s-y', `${cfg.iceSpellY}%`);
  root.setProperty('--frz-ice-s-op', String(cfg.iceSpellOpacity));
  root.setProperty('--frz-ice-s-glow', cfg.iceSpellGlowSize > 0 && cfg.iceSpellGlowAlpha > 0
    ? `drop-shadow(0 0 ${cfg.iceSpellGlowSize}px rgba(150, 215, 255, ${cfg.iceSpellGlowAlpha}))`
    : 'none');
  root.setProperty('--frz-ice-s-dur', `${cfg.iceSpellDur}s`);
  root.setProperty('--frz-ice-s-f0', `${50 - cfg.iceSpellFeather / 2}%`);
  root.setProperty('--frz-ice-s-f1', `${50 + cfg.iceSpellFeather / 2}%`);
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
