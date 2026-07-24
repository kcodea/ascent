/**
 * Tunable layout for the three CARD PILLS — the cost coin, the Tier badge, and the Spell/Ruby type pill
 * (owner ask 2026-07-24). Each gets its OWN x/y/scale so they can be seated independently by eye
 * (🏷️ Card Pills in the Dev Tuning Menu).
 *
 * Same architecture as the hero-panel / power-diamond configs: dev-only localStorage persistence, with values
 * reflected as COMPOSED transform strings on `:root` (`--cpl-*-t`) that the CSS reads via
 * `transform: var(--cpl-…-t, <base>)`. Composed in JS rather than as raw numbers because two of the three
 * carry a BASE centering transform (`translateX(-50%)`) that an offset has to stack ONTO — writing plain
 * offsets would silently drop the centering and throw the pill to the card's left edge.
 *
 * Offsets are design-px (× `--u`), so a nudge means the same thing at every card size and zoom level.
 *
 * PRODUCTION runs `applyCardPillVars()` at module load with DEFAULTS, so shipping tuned values means baking
 * them into DEFAULTS here — exactly like the other layout configs.
 */
export interface CardPillsConfig {
  /** Cost coin (the gold price badge overhanging the top-left) — design-px offset (× --u). +x → right. */
  costX: number;
  costY: number;
  /** Cost coin — scale (×). */
  costScale: number;

  /** Tier badge (the coloured "TIER N" tab at the top edge) — design-px offset (× --u). */
  tierX: number;
  tierY: number;
  /** Tier badge — scale (×). */
  tierScale: number;

  /** Spell / Ruby type pill (the "✦ SPELL" capsule) — design-px offset (× --u). */
  spellX: number;
  spellY: number;
  /** Spell / Ruby type pill — scale (×). */
  spellScale: number;
}

/** Shipped layout. `spellY: 19` seats the type pill at the BOTTOM of the art icon (owner ask 2026-07-24 — it
 *  previously sat mid-art, its bottom edge at ~83% of the card; +19 design-px puts it at ~96%, a hair inside
 *  the art's lower edge). It's expressed HERE rather than in the CSS because the compact spell card's `bottom`
 *  is derived from the authored frame's window geometry (`.card.compact.spellframe .ctype.spell`), which would
 *  fight a hand-edited offset — and because `bottom` grows upward, making it the wrong axis to nudge "down".
 *  The rest are identity until dialed. */
const DEFAULTS: CardPillsConfig = {
  costX: 0,
  costY: 0,
  costScale: 1,

  tierX: 0,
  tierY: 0,
  tierScale: 1,

  spellX: 0,
  spellY: 19,
  spellScale: 1,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const CARD_PILLS_RANGES: Record<keyof CardPillsConfig, [number, number, number]> = {
  costX: [-120, 120, 1],
  costY: [-120, 120, 1],
  costScale: [0.3, 2.5, 0.01],
  tierX: [-120, 120, 1],
  tierY: [-120, 120, 1],
  tierScale: [0.3, 2.5, 0.01],
  spellX: [-120, 120, 1],
  spellY: [-120, 160, 1],
  spellScale: [0.3, 2.5, 0.01],
};

/** One-line definitions, shown as a hover tooltip on each control in the DEV tuner. */
export const CARD_PILLS_DESC: Record<keyof CardPillsConfig, string> = {
  costX: 'Cost coin — horizontal nudge (design px). +x → right.',
  costY: 'Cost coin — vertical nudge (design px). +y → down.',
  costScale: 'Cost coin — size multiplier.',
  tierX: 'Tier badge — horizontal nudge (design px). +x → right.',
  tierY: 'Tier badge — vertical nudge (design px). +y → down.',
  tierScale: 'Tier badge — size multiplier.',
  spellX: 'Spell / Ruby pill — horizontal nudge (design px). +x → right.',
  spellY: 'Spell / Ruby pill — vertical nudge (design px). +y → down.',
  spellScale: 'Spell / Ruby pill — size multiplier.',
};

export const CARD_PILLS_KEYS = [
  'costX', 'costY', 'costScale',
  'tierX', 'tierY', 'tierScale',
  'spellX', 'spellY', 'spellScale',
] as const;

const KEY = 'ascent.cardPills';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: CardPillsConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<CardPillsConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getCardPillsConfig(): CardPillsConfig {
  return cfg;
}

/**
 * Push the current values onto `:root` as composed transform strings.
 *
 * `base` is each element's own transform, prepended so the nudge STACKS onto it. The Tier badge and the Spell
 * pill are both centred with `translateX(-50%)`; replacing that instead of composing would slam them to the
 * card's left edge — which is the whole reason these are composed here rather than passed as raw numbers.
 */
export function applyCardPillVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const t = (x: number, y: number, s: number, base = ''): string =>
    `${base}${base ? ' ' : ''}translate(calc(${x} * var(--u)), calc(${y} * var(--u))) scale(${s})`;
  root.setProperty('--cpl-cost-t', t(cfg.costX, cfg.costY, cfg.costScale));
  root.setProperty('--cpl-tier-t', t(cfg.tierX, cfg.tierY, cfg.tierScale, 'translateX(-50%)'));
  root.setProperty('--cpl-spell-t', t(cfg.spellX, cfg.spellY, cfg.spellScale, 'translateX(-50%)'));
}

export function setCardPillsValue(key: keyof CardPillsConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  applyCardPillVars();
}

export function resetCardPillsConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  applyCardPillVars();
}

// Apply at module load so production gets DEFAULTS and a dev reload restores the saved values.
applyCardPillVars();
