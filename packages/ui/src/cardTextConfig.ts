/**
 * Tunable BOUNDARIES of the card rules-text box — the `.drawer` panel that holds the description (NOT the
 * card title). Dials where the box sits below the art and how much it's inset, plus the line spacing. Lives
 * as `--ctx-*` CSS vars on :root; the styles.css fallbacks MUST mirror DEFAULTS (update both when baking).
 *
 * All the lengths are multiples of the compact card width (`--ccw`), so the box scales with the card at any
 * size — same convention as the plate/frame configs. DEV-only localStorage; production renders DEFAULTS
 * (Layout Lab convention, per the #615 prod-leak fix). Dial in the 🔤 Card Text tuner.
 */
export interface CardTextConfig {
  /** Box TOP — how far below the art the panel starts (× --ccw). Bigger = lower. */
  top: number;
  /** Box side inset — left+right padding (× --ccw). Bigger = a NARROWER text column. */
  padX: number;
  /** Box top padding (× --ccw) — gap above the first line. */
  padTop: number;
  /** Box bottom padding (× --ccw) — gap below the last line. */
  padBottom: number;
  /** Description LINE HEIGHT (unitless). Tightens/opens the line spacing. */
  line: number;
}

const DEFAULTS: CardTextConfig = {
  top: 1.09,
  padX: 0.08,
  padTop: 0.065,
  padBottom: 0.07,
  line: 1.32,
};

export const CTX_RANGES: Record<keyof CardTextConfig, [number, number, number]> = {
  top: [0.8, 1.4, 0.005],
  padX: [0, 0.25, 0.005],
  padTop: [0, 0.2, 0.005],
  padBottom: [0, 0.2, 0.005],
  line: [1, 1.8, 0.01],
};

export const CTX_DESC: Record<keyof CardTextConfig, string> = {
  top: 'Text box TOP — how far below the art the panel starts (× card width). Bigger = lower.',
  padX: 'Side inset — left+right padding (× card width). Bigger = a NARROWER text column.',
  padTop: 'Top padding — gap above the first line (× card width).',
  padBottom: 'Bottom padding — gap below the last line (× card width).',
  line: 'Description line height — line spacing.',
};

export const CTX_KEYS = Object.keys(DEFAULTS) as (keyof CardTextConfig)[];

const KEY = 'ascent.cardtext';
let cfg: CardTextConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<CardTextConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getCardTextConfig(): CardTextConfig {
  return cfg;
}

/** Reflect the tuned values onto :root as `--ctx-*` so the pure-CSS `.drawer`/`.desc` rules pick them up live. */
export function applyCardTextVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--ctx-top', String(cfg.top));
  root.setProperty('--ctx-pad-x', String(cfg.padX));
  root.setProperty('--ctx-pad-top', String(cfg.padTop));
  root.setProperty('--ctx-pad-bottom', String(cfg.padBottom));
  root.setProperty('--ctx-line', String(cfg.line));
}

export function setCardTextValue(key: keyof CardTextConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  applyCardTextVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetCardTextConfig(): void {
  cfg = { ...DEFAULTS };
  applyCardTextVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

applyCardTextVars();
