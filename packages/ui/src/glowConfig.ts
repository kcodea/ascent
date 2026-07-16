/**
 * Tunable look for the card HOVER / SELECT glow — the teal halo that appears when the cursor is over a shop /
 * warband / combat card. The glow is a copy of the card's own frame silhouette (`.cglow`) seated BEHIND the
 * portrait (z0, like `.cshadow`), so its two stacked drop-shadows bloom only OUTWARD — any inward bleed is
 * physically covered by the opaque art at z1, and it can never wash over the portrait. The two layers are a
 * bright THIN inner line hugging the silhouette + a milder, LARGER soft bloom around it.
 *
 * Held in one mutable, localStorage-persisted config so it can be dialed by eye via the DEV Glow tuner
 * (`GlowTuner.tsx`, opened from the Dev Tuning Menu). Values reflect to `--hg-*` CSS vars on :root, which the
 * `.cglow` filter reads live. The SHIPPED defaults live BOTH here and as the CSS fallbacks in styles.css
 * (`var(--hg-line-blur, …)`), so production renders correctly without importing this module — when a value is
 * dialed in, "Copy values" grabs the JSON and the CSS fallbacks are updated to match.
 */
export interface GlowConfig {
  /** Bright inner line — blur radius (px). Small = a crisp rim hugging the silhouette. */
  lineBlur: number;
  /** Bright inner line — opacity (0–1). High = a bright, defined line. */
  lineAlpha: number;
  /** Bright inner line — colour (hex). */
  lineColor: string;
  /** Soft outer bloom — blur radius (px). Large = a wide, gentle halo. */
  bloomBlur: number;
  /** Soft outer bloom — opacity (0–1). Lower = milder. */
  bloomAlpha: number;
  /** Soft outer bloom — colour (hex). */
  bloomColor: string;
  /** Soft outer bloom — INTENSITY: how many times the bloom drop-shadow is stacked. A single shadow spreads one
   *  ring's alpha over the whole blur so it reads soft even at opacity 1; stacking compounds it into a hot glow.
   *  1 = soft, 4–5 = intense. */
  bloomStrength: number;
  /** Shape WIDTH scale (×). 1 = exact frame width; >1 pushes the teal rim out past the frame sides. */
  width: number;
  /** Shape HEIGHT scale (×). 1 = exact frame height; >1 pushes the teal rim out past the frame top/bottom. */
  height: number;
}

const DEFAULTS: GlowConfig = {
  lineBlur: 12,
  lineAlpha: 1,
  lineColor: '#00ffd5', // owner-tuned bright line
  bloomBlur: 4,
  bloomAlpha: 0.4,
  bloomColor: '#00fbff', // owner-tuned bloom
  bloomStrength: 6,
  width: 1.03,
  height: 1.015,
};

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key. */
export const GLOW_RANGES: Record<
  'lineBlur' | 'lineAlpha' | 'bloomBlur' | 'bloomAlpha' | 'bloomStrength' | 'width' | 'height',
  [number, number, number]
> = {
  lineBlur: [0, 12, 0.5],
  lineAlpha: [0, 1, 0.01],
  bloomBlur: [0, 70, 1],
  bloomAlpha: [0, 1, 0.01],
  bloomStrength: [1, 8, 1],
  width: [0.85, 1.25, 0.005],
  height: [0.85, 1.25, 0.005],
};

/** One-line definitions, shown as a hover tooltip on each slider's name in the DEV tuner. */
export const GLOW_DESC: Record<keyof GlowConfig, string> = {
  lineBlur: 'Bright inner line softness (px). Small = a crisp rim hugging the card silhouette.',
  lineAlpha: 'Bright inner line opacity. High = a bright, defined line.',
  lineColor: 'Bright inner line colour.',
  bloomBlur: 'Soft outer bloom radius (px). Large = a wide, gentle halo around the line.',
  bloomAlpha: 'Soft outer bloom opacity. Lower = milder.',
  bloomColor: 'Soft outer bloom colour.',
  bloomStrength: 'Bloom INTENSITY — how many times the bloom is stacked. 1 = soft, higher = a hotter, denser glow.',
  width: 'Glow shape WIDTH (× frame). >1 pushes the bright teal rim out past the frame sides.',
  height: 'Glow shape HEIGHT (× frame). >1 pushes the bright teal rim out past the frame top/bottom.',
};

/** Keys grouped by control type for the tuner UI. */
export const GLOW_NUM_KEYS = ['width', 'height', 'lineBlur', 'lineAlpha', 'bloomBlur', 'bloomAlpha', 'bloomStrength'] as const;
export const GLOW_COLOR_KEYS = ['lineColor', 'bloomColor'] as const;

const KEY = 'ascent.glow';
let cfg: GlowConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<GlowConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function getGlowConfig(): GlowConfig {
  return cfg;
}
/** Reflect the tuned glow onto :root so the pure-CSS `.cglow` filter picks up the current value live. */
export function applyGlowVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--hg-line-blur', `${cfg.lineBlur}px`);
  root.setProperty('--hg-line-col', rgba(cfg.lineColor, cfg.lineAlpha));
  root.setProperty('--hg-bloom-blur', `${cfg.bloomBlur}px`);
  root.setProperty('--hg-bloom-col', rgba(cfg.bloomColor, cfg.bloomAlpha));
  // Bloom = the drop-shadow stacked `bloomStrength` times (each pass compounds → a hotter core). Composed here as
  // a full filter string because CSS can't repeat a filter a variable number of times.
  const one = `drop-shadow(0 0 ${cfg.bloomBlur}px ${rgba(cfg.bloomColor, cfg.bloomAlpha)})`;
  const n = Math.max(1, Math.round(cfg.bloomStrength));
  root.setProperty('--hg-bloom-filter', Array(n).fill(one).join(' '));
  root.setProperty('--hg-w', String(cfg.width));
  root.setProperty('--hg-h', String(cfg.height));
}
export function setGlowValue(key: keyof GlowConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  applyGlowVars();
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetGlowConfig(): void {
  cfg = { ...DEFAULTS };
  applyGlowVars();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
// Reflect persisted/default vars onto :root at load (dev only — this module is imported by the tuner via DevMenu,
// which is mounted only in dev; production relies on the CSS fallbacks that mirror DEFAULTS).
applyGlowVars();
