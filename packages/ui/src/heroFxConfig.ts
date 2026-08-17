/**
 * Tunable dials for the two hero-driven card treatments:
 *   • Cia's ENCHANTED shop card — two counter-rotating red/gold rings tracing the card.
 *   • Sable's SOULBIND mark — a ring sitting UNDER each bound minion.
 *
 * Both LOOP, so every dial here is deliberately restricted to things that stay compositor-only: size,
 * position, colour and the rotation/breathe PERIOD. There is no dial that animates a shadow, blur or filter —
 * those repaint every frame, which is the one thing docs/performance.md forbids in a looping animation.
 *
 * Config is localStorage-persisted in DEV only; production always renders DEFAULTS (Layout Lab convention).
 * Values reflect to `--hfx-*` CSS vars — the styles.css fallbacks MUST mirror DEFAULTS.
 */
export interface HeroFxConfig {
  /** Enchanted ring — inset from the card's edges, design px (× --u). NEGATIVE pushes the ring outwards. */
  encInset: number;
  /** Enchanted ring — stroke thickness, design px (× --u). */
  encH: number;
  /** Enchanted ring — softness of the links, design px (× --u). 0 = crisp. */
  encBlur: number;
  /** Enchanted ring — hue of the links (deg; ~2 ≈ red, and the hot core sits +40 toward gold). */
  encHue: number;
  /** Enchanted ring — opacity of the SECOND (counter-rotating) ring. */
  encDip: number;
  /** Enchanted ring — seconds per full rotation of the first ring. Bigger = slower. */
  encPeriod: number;
  /** Enchanted ring — how much SLOWER the counter-rotating ring is (× the period). 1 = same speed. */
  encSkew: number;
  /** Soulbind ring — diameter, design px (× --u). */
  sbSize: number;
  /** Soulbind ring — how far BELOW the card's bottom edge it sits, design px (× --u). */
  sbY: number;
  /** Soulbind ring — stroke thickness, design px (× --u). */
  sbRing: number;
  /** Soulbind ring — halo blur, design px (× --u). */
  sbBlur: number;
  /** Soulbind ring — hue (deg; ~275 ≈ purple). */
  sbHue: number;
  /** Soulbind ring — breathe dip (0–1). */
  sbDip: number;
  /** Soulbind ring — breathe period, seconds. */
  sbPeriod: number;
}

const DEFAULTS: HeroFxConfig = {
  encInset: -4,
  encH: 4,
  encBlur: 1,
  encHue: 2,
  encDip: 0.75,
  encPeriod: 4,
  encSkew: 1.6,
  sbSize: 7,
  sbY: 7,
  sbRing: 1.2,
  sbBlur: 10,
  sbHue: 275,
  sbDip: 0.7,
  sbPeriod: 2.4,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const HFX_RANGES: Record<keyof HeroFxConfig, [number, number, number]> = {
  encInset: [-24, 12, 0.5],
  encH: [0.5, 20, 0.5],
  encBlur: [0, 12, 0.25],
  encHue: [0, 360, 1],
  encDip: [0, 1, 0.01],
  encPeriod: [1, 20, 0.25],
  encSkew: [0.5, 4, 0.05],
  sbSize: [2, 30, 0.5],
  sbY: [-10, 40, 0.5],
  sbRing: [0.2, 6, 0.1],
  sbBlur: [0, 40, 0.5],
  sbHue: [0, 360, 1],
  sbDip: [0, 1, 0.01],
  sbPeriod: [0.5, 10, 0.1],
};

export const HFX_NUM_KEYS = [
  'encInset', 'encH', 'encBlur', 'encHue', 'encDip', 'encPeriod', 'encSkew',
  'sbSize', 'sbY', 'sbRing', 'sbBlur', 'sbHue', 'sbDip', 'sbPeriod',
] as const;
/** The shipped values, exported so the tuner can mark which controls you have moved away from them. */
export { DEFAULTS as HFX_DEFAULTS };

const KEY = 'ascent.herofx';
let cfg: HeroFxConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<HeroFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getHeroFxConfig(): HeroFxConfig {
  return cfg;
}

/** Reflect the dials onto :root as `--hfx-*`. */
export function applyHeroFxVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--hfx-enc-inset', String(cfg.encInset));
  root.setProperty('--hfx-enc-h', String(cfg.encH));
  root.setProperty('--hfx-enc-blur', String(cfg.encBlur));
  root.setProperty('--hfx-enc-hue', String(cfg.encHue));
  root.setProperty('--hfx-enc-dip', String(cfg.encDip));
  root.setProperty('--hfx-enc-period', `${cfg.encPeriod}s`);
  root.setProperty('--hfx-enc-skew', String(cfg.encSkew));
  root.setProperty('--hfx-sb-size', String(cfg.sbSize));
  root.setProperty('--hfx-sb-y', String(cfg.sbY));
  root.setProperty('--hfx-sb-ring', String(cfg.sbRing));
  root.setProperty('--hfx-sb-blur', String(cfg.sbBlur));
  root.setProperty('--hfx-sb-hue', String(cfg.sbHue));
  root.setProperty('--hfx-sb-dip', String(cfg.sbDip));
  root.setProperty('--hfx-sb-period', `${cfg.sbPeriod}s`);
}

export function setHeroFxValue(key: keyof HeroFxConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  applyHeroFxVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetHeroFxConfig(): void {
  cfg = { ...DEFAULTS };
  applyHeroFxVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
// Reflect vars at load (dev: persisted values; prod: DEFAULTS — matches the CSS fallbacks either way).
applyHeroFxVars();
