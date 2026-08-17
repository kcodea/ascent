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
  /** Enchanted ring — how many links circle the card (per ring). */
  encLinks: number;
  /** Enchanted ring — angular LENGTH of each link (deg). Small = dots, large = long arcs. */
  encArc: number;
  /** Enchanted ring — link shape: 0 = soft (feathered ends), 1 = hard-edged blocks. */
  encShape: number;
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
  /** Soulbind ring — spiderweb fill: how visible the web inside the ring is (0 = off). */
  sbWeb: number;
  /** Soulbind ring — how many SPOKES the web has. */
  sbWebSpokes: number;
  /** Soulbind ring — how many concentric RINGS the web has. */
  sbWebRings: number;
}

const DEFAULTS: HeroFxConfig = {
  // Owner-tuned 2026-08-16 — these are the shipped values now.
  encInset: -24,
  encH: 5,
  encBlur: 14,
  encHue: 340,
  encDip: 1,
  encPeriod: 3,
  encSkew: 1.35,
  encLinks: 4,
  encArc: 16,
  encShape: 0,
  sbSize: 27,
  sbY: 40,
  sbRing: 3.3,
  sbBlur: 5.5,
  sbHue: 297,
  sbDip: 0.7,
  sbPeriod: 2.4,
  sbWeb: 0.55,
  sbWebSpokes: 8,
  sbWebRings: 3,
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
  encLinks: [1, 12, 1],
  encArc: [2, 80, 1],
  encShape: [0, 1, 0.01],
  // Wide on purpose (owner ask 2026-08-17: "more room to move it around").
  sbSize: [2, 120, 0.5],
  sbY: [-120, 160, 0.5],
  sbRing: [0.2, 6, 0.1],
  sbBlur: [0, 40, 0.5],
  sbHue: [0, 360, 1],
  sbDip: [0, 1, 0.01],
  sbPeriod: [0.5, 10, 0.1],
  sbWeb: [0, 1, 0.01],
  sbWebSpokes: [3, 16, 1],
  sbWebRings: [1, 8, 1],
};

export const HFX_NUM_KEYS = [
  'encInset', 'encH', 'encBlur', 'encHue', 'encDip', 'encPeriod', 'encSkew', 'encLinks', 'encArc', 'encShape',
  'sbSize', 'sbY', 'sbRing', 'sbBlur', 'sbHue', 'sbDip', 'sbPeriod', 'sbWeb', 'sbWebSpokes', 'sbWebRings',
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
  // The links are built as a REPEATING conic gradient, so "how many" and "how long" are just the repeat
  // period and the lit fraction of it — one gradient, any count, no per-link DOM.
  const step = 360 / Math.max(1, Math.round(cfg.encLinks));
  const arc = Math.min(cfg.encArc, step); // a link can never be longer than its own slot
  const feather = arc * (1 - cfg.encShape) * 0.5; // 0 shape = fully feathered ends, 1 = hard edges
  const hue = cfg.encHue;
  root.setProperty('--hfx-enc-links', `repeating-conic-gradient(from 0deg,
    hsl(${hue} 90% 45% / 0) 0deg,
    hsl(${hue} 100% 60% / 1) ${feather}deg,
    hsl(${hue + 40} 100% 80% / 1) ${arc / 2}deg,
    hsl(${hue} 100% 60% / 1) ${arc - feather}deg,
    hsl(${hue} 90% 45% / 0) ${arc}deg,
    hsl(${hue} 90% 45% / 0) ${step}deg)`);
  root.setProperty('--hfx-sb-size', String(cfg.sbSize));
  root.setProperty('--hfx-sb-y', String(cfg.sbY));
  root.setProperty('--hfx-sb-ring', String(cfg.sbRing));
  root.setProperty('--hfx-sb-blur', String(cfg.sbBlur));
  root.setProperty('--hfx-sb-hue', String(cfg.sbHue));
  root.setProperty('--hfx-sb-dip', String(cfg.sbDip));
  root.setProperty('--hfx-sb-period', `${cfg.sbPeriod}s`);
  // SPIDERWEB fill: radial SPOKES (a repeating conic gradient) crossed with concentric RINGS (a repeating
  // radial gradient). Both are static paint on one element — nothing here animates, so the web costs the
  // ring nothing per frame.
  root.setProperty('--hfx-sb-web', String(cfg.sbWeb));
  const spoke = 360 / Math.max(3, Math.round(cfg.sbWebSpokes));
  const webCol = `hsl(${cfg.sbHue} 100% 82% / 1)`;
  root.setProperty('--hfx-sb-web-spokes', `repeating-conic-gradient(from 0deg,
    ${webCol} 0deg, ${webCol} 0.6deg, transparent 0.6deg, transparent ${spoke}deg)`);
  const ringStep = 50 / Math.max(1, Math.round(cfg.sbWebRings)); // % of the radius per ring
  root.setProperty('--hfx-sb-web-rings', `repeating-radial-gradient(circle,
    transparent 0%, transparent ${ringStep - 1.2}%, ${webCol} ${ringStep - 1.2}%, ${webCol} ${ringStep}%)`);
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
