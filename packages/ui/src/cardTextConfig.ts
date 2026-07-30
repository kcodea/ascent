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

  /* BACKBOX — an authored dark shape seated BEHIND the text panel to darken the plate under it so the rules
     text reads cleanly (owner 2026-07-26). Sized by WIDTH (× --ccw); height follows the art ratio. The art is
     a full card-BODY silhouette (676×1228, ratio 0.55 — arched top, notched bottom), so it renders ~1.8×
     taller than wide and has to be pulled well ABOVE the text panel it is anchored inside: the offsets range
     over whole card-widths, not the fractions the old wide strip needed. */
  /** Backbox width (× --ccw). 0 hides it. */
  boxW: number;
  /** Backbox horizontal offset from the panel centre (× --ccw; + = right). */
  boxX: number;
  /** Backbox vertical offset from the panel top (× --ccw; + = down). */
  boxY: number;
  /** Backbox opacity (0–1). */
  boxA: number;
  /** Backbox blend mode against the plate beneath it. */
  boxBlend: BoxBlend;
}

/** Blend modes offered for the backbox — the four the owner asked for. */
export const CTX_BLENDS = ['normal', 'overlay', 'multiply', 'soft-light'] as const;
export type BoxBlend = (typeof CTX_BLENDS)[number];

const DEFAULTS: CardTextConfig = {
  top: 1.085,
  padX: 0,
  padTop: 0.075,
  padBottom: 0.07,
  line: 1.43,
  boxW: 1.08,
  boxX: 0,
  boxY: -1.235,
  boxA: 0.47,
  boxBlend: 'overlay',
};

export const CTX_RANGES: Record<CardTextNumKey, [number, number, number]> = {
  top: [0.8, 1.4, 0.005],
  padX: [0, 0.25, 0.005],
  padTop: [0, 0.2, 0.005],
  padBottom: [0, 0.2, 0.005],
  line: [1, 1.8, 0.01],
  boxW: [0, 2.5, 0.005],
  boxX: [-1.5, 1.5, 0.005],
  boxY: [-2.5, 1.5, 0.005],
  boxA: [0, 1, 0.01],
};

export const CTX_DESC: Record<keyof CardTextConfig, string> = {
  top: 'Text box TOP — how far below the art the panel starts (× card width). Bigger = lower.',
  padX: 'Side inset — left+right padding (× card width). Bigger = a NARROWER text column.',
  padTop: 'Top padding — gap above the first line (× card width).',
  padBottom: 'Bottom padding — gap below the last line (× card width).',
  line: 'Description line height — line spacing.',
  boxW: 'Backbox WIDTH (× card width). Height follows the art ratio. 0 hides it.',
  boxX: 'Backbox horizontal offset from centre (× card width; + = right).',
  boxY: 'Backbox vertical offset (× card width; + = down).',
  boxA: 'Backbox opacity. 0 = invisible.',
  boxBlend: 'How the backbox blends with the plate beneath: normal / overlay / multiply / soft-light.',
};

/** Numeric keys (sliders). `boxBlend` is a select, handled separately in the tuner. */
export type CardTextNumKey = Exclude<keyof CardTextConfig, 'boxBlend'>;

/** The shipped values, exported so the tuner can mark which controls you have moved away from them. */
export { DEFAULTS as CTX_DEFAULTS };

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
  root.setProperty('--ctx-box-w', String(cfg.boxW));
  root.setProperty('--ctx-box-x', String(cfg.boxX));
  root.setProperty('--ctx-box-y', String(cfg.boxY));
  root.setProperty('--ctx-box-a', String(cfg.boxA));
  root.setProperty('--ctx-box-blend', cfg.boxBlend);
}

export function setCardTextValue(key: keyof CardTextConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value } as CardTextConfig;
  applyCardTextVars();
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetCardTextConfig(): void {
  cfg = { ...DEFAULTS };
  applyCardTextVars();
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

applyCardTextVars();
