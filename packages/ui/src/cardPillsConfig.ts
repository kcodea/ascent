/**
 * Tunable layout for the four CARD PILLS — the cost coin, the Tier badge, the Spell/Ruby type pill, and the ×N
 * multicast badge (owner ask 2026-07-24). Each gets its OWN x/y/scale so they can be seated independently by eye
 * (🏷️ Card Pills in the Dev Tuning Menu). The multicast badge additionally carries two COLOURS (badge + font),
 * because it's the one pill whose hue is a live design question rather than fixed by the card's tribe or tier.
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

  /** SPELL tier badge — its own offset/scale. A spell's frame is a square with a different banner seat than the
   *  minion oval, so the two badges can't share one nudge (owner 2026-07-26). Spells + Rubies use these; every
   *  other card keeps `tier*` above. */
  stierX: number;
  stierY: number;
  stierScale: number;

  /** TAUNT tier badge — its own offset/scale. The heater shield's banner sits higher and narrower than either
   *  the oval or the spell square, so it needs a third seat (owner 2026-07-26). */
  ttierX: number;
  ttierY: number;
  ttierScale: number;

  /** TIER PLATE — the plaque behind the stars. Its own nudge/size on TOP of whichever tier seat applies, so one
   *  set of knobs serves minions, spells and Taunts alike. Width is × --ccw; height follows the 4.09 art ratio. */
  tplateX: number;
  tplateY: number;
  tplateW: number;

  /** Spell / Ruby type pill (the "✦ SPELL" capsule) — design-px offset (× --u). */
  spellX: number;
  spellY: number;
  /** Spell / Ruby type pill — scale (×). */
  spellScale: number;

  /** ×N multicast badge (Nimbus / Yazzus / a Prismcaster'd Ruby) — design-px offset (× --u). */
  multX: number;
  multY: number;
  /** ×N multicast badge — scale (×). */
  multScale: number;
  /** ×N badge FILL. One colour, not three: the CSS derives the minted highlight/shade from it with
   *  `color-mix`, so picking a hue keeps the coin's shading rather than flattening it to a solid disc. */
  multBadge: string;
  /** ×N badge NUMERAL colour. */
  multFont: string;
}

/** Shipped layout — owner's tuned pass (2026-07-24, from the 🏷️ Card Pills tuner). The cost coin is nudged up
 *  and in toward the corner and shrunk a touch (`costX/Y/Scale`); the type pill is seated at the BOTTOM of the
 *  art icon and slightly smaller (`spellY: 34`, `spellScale: 0.91`). These live HERE rather than in the CSS
 *  because the compact spell card's `bottom` is derived from the authored frame's window geometry
 *  (`.card.compact.spellframe .ctype.spell`), which would fight a hand-edited offset — and because `bottom`
 *  grows upward, making it the wrong axis to nudge "down". */
const DEFAULTS: CardPillsConfig = {
  costX: -9,
  costY: -13,
  costScale: 0.81,

  tierX: 0,
  tierY: 2,
  tierScale: 0.74,

  stierX: 0,
  stierY: 3.25,
  stierScale: 0.74,

  ttierX: 0,
  ttierY: 0,
  ttierScale: 0.74,

  tplateX: 0,
  tplateY: 0,
  tplateW: 0.66,

  spellX: -2,
  spellY: 34,
  spellScale: 0.91,

  // Owner's tuned pass: the exact MIRROR of the cost coin (`costX: -9` → `multX: 9`, same y and scale), so the
  // two badges sit symmetrically in the card's top corners.
  multX: 9,
  multY: -13,
  multScale: 0.81,
  // The shipped orange minted coin (owner ask 2026-07-24: the hero-power cost skin, but orange) and its dark
  // numeral. Both are BASE colours — the CSS mixes the gradient's highlight and shade out of `multBadge`.
  multBadge: '#f08a2c',
  multFont: '#4a2708',
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const CARD_PILLS_RANGES: Record<CardPillsNumKey, [number, number, number]> = {
  costX: [-120, 120, 0.25],
  costY: [-120, 120, 0.25],
  costScale: [0.3, 2.5, 0.005],
  tierX: [-120, 120, 0.25],
  tierY: [-120, 120, 0.25],
  tierScale: [0.3, 2.5, 0.005],
  stierX: [-120, 120, 0.25],
  stierY: [-120, 120, 0.25],
  stierScale: [0.3, 2.5, 0.005],
  ttierX: [-120, 120, 0.25],
  ttierY: [-120, 120, 0.25],
  ttierScale: [0.3, 2.5, 0.005],
  tplateX: [-120, 120, 0.25],
  tplateY: [-120, 120, 0.25],
  tplateW: [0, 1.5, 0.005],
  spellX: [-120, 120, 0.25],
  spellY: [-120, 160, 0.25],
  spellScale: [0.3, 2.5, 0.005],
  multX: [-120, 120, 0.25],
  multY: [-120, 120, 0.25],
  multScale: [0.3, 2.5, 0.005],
};

/** One-line definitions, shown as a hover tooltip on each control in the DEV tuner. */
export const CARD_PILLS_DESC: Record<keyof CardPillsConfig, string> = {
  costX: 'Cost coin — horizontal nudge (design px). +x → right.',
  costY: 'Cost coin — vertical nudge (design px). +y → down.',
  costScale: 'Cost coin — size multiplier.',
  tierX: 'Tier badge — horizontal nudge (design px). +x → right.',
  tierY: 'Tier badge — vertical nudge (design px). +y → down.',
  tierScale: 'Tier badge — size multiplier.',
  stierX: 'SPELL tier badge — horizontal nudge (design px). +x → right. Spells/Rubies only.',
  stierY: 'SPELL tier badge — vertical nudge (design px). +y → down. Spells/Rubies only.',
  stierScale: 'SPELL tier badge — size multiplier. Spells/Rubies only.',
  ttierX: 'TAUNT tier badge — horizontal nudge (design px). +x → right. Taunt minions only.',
  ttierY: 'TAUNT tier badge — vertical nudge (design px). +y → down. Taunt minions only.',
  ttierScale: 'TAUNT tier badge — size multiplier. Taunt minions only.',
  tplateX: 'Tier PLATE — horizontal nudge (design px) on top of the tier seat. +x → right.',
  tplateY: 'Tier PLATE — vertical nudge (design px). +y → down.',
  tplateW: 'Tier PLATE — WIDTH (× card width). Height follows the art ratio. 0 hides it.',
  spellX: 'Spell / Ruby pill — horizontal nudge (design px). +x → right.',
  spellY: 'Spell / Ruby pill — vertical nudge (design px). +y → down.',
  spellScale: 'Spell / Ruby pill — size multiplier.',
  multX: '×N multicast badge — horizontal nudge (design px). +x → right.',
  multY: '×N multicast badge — vertical nudge (design px). +y → down.',
  multScale: '×N multicast badge — size multiplier.',
  multBadge: '×N badge fill — the coin colour (its highlight + shade are mixed from this).',
  multFont: '×N badge numeral colour.',
};

/** The SLIDER keys (numeric). Colours are handled separately — they need a picker, not a range. */
export const CARD_PILLS_KEYS = [
  'costX', 'costY', 'costScale',
  'tierX', 'tierY', 'tierScale',
  'stierX', 'stierY', 'stierScale',
  'ttierX', 'ttierY', 'ttierScale',
  'tplateX', 'tplateY', 'tplateW',
  'spellX', 'spellY', 'spellScale',
  'multX', 'multY', 'multScale',
] as const;
/** The COLOUR keys, rendered as `<input type="color">` in the tuner. */
export const CARD_PILLS_COLOR_KEYS = ['multBadge', 'multFont'] as const;

export type CardPillsNumKey = (typeof CARD_PILLS_KEYS)[number];
export type CardPillsColorKey = (typeof CARD_PILLS_COLOR_KEYS)[number];

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
  root.setProperty('--cpl-tplate-t',
    `translate(calc(${cfg.tplateX} * var(--u)), calc(${cfg.tplateY} * var(--u)))`);
  root.setProperty('--cpl-tplate-w', String(cfg.tplateW));
  root.setProperty('--cpl-ttier-t', t(cfg.ttierX, cfg.ttierY, cfg.ttierScale, 'translateX(-50%)'));
  root.setProperty('--cpl-stier-t', t(cfg.stierX, cfg.stierY, cfg.stierScale, 'translateX(-50%)'));
  root.setProperty('--cpl-spell-t', t(cfg.spellX, cfg.spellY, cfg.spellScale, 'translateX(-50%)'));
  root.setProperty('--cpl-mult-t', t(cfg.multX, cfg.multY, cfg.multScale));
  // Colours go across as plain custom props; `.castmult` mixes the gradient stops out of `--cpl-mult-bg`.
  root.setProperty('--cpl-mult-bg', cfg.multBadge);
  root.setProperty('--cpl-mult-fg', cfg.multFont);
}

export function setCardPillsValue(key: CardPillsNumKey, value: number): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
  applyCardPillVars();
}

export function setCardPillsColor(key: CardPillsColorKey, value: string): void {
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
