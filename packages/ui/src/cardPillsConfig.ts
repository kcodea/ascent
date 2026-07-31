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

  /* TIER BADGE — the stars and the plaque behind them, each with an ALL row plus a per-family row that
     COMPOSES on top of it. `tier*` / `plateAll*` move every card; the family rows are deltas (offset added,
     size multiplied), so a family row of 0/0/1 means "same as all". Without composition the family rules,
     being more specific, simply shadowed the ALL row and it did nothing (owner report 2026-07-26). */
  /** Tier stars — ALL cards. Design-px offset (× --u); scale is the base every family multiplies. */
  tierX: number;
  tierY: number;
  /** Tier badge — scale (×). */
  tierScale: number;

  /** SPELL tier stars — DELTA on top of the ALL row. A spell's frame is a square with a different banner seat than the
   *  minion oval, so the two badges can't share one nudge (owner 2026-07-26). Spells + Rubies use these; every
   *  other card keeps `tier*` above. */
  stierX: number;
  stierY: number;
  stierScale: number;

  /** TAUNT tier stars — DELTA on top of the ALL row. The heater shield's banner sits higher and narrower than either
   *  the oval or the spell square, so it needs a third seat (owner 2026-07-26). */
  ttierX: number;
  ttierY: number;
  ttierScale: number;

  /** CIRCLE (oval) tier stars — DELTA on top of the ALL row. Previously the oval fell through to the generic `tier*`
   *  seat; it now has its own so all four families are independently dialable (owner 2026-07-26). */
  otierX: number;
  otierY: number;
  otierScale: number;

  /* TIER PLATE — the plaque behind the stars, with a seat PER FRAME FAMILY exactly like the stars, so the two
     can be aligned independently on each (owner 2026-07-26). Each nudge stacks on top of that family's tier
     seat. Width is × --ccw; height follows the 4.09 art ratio. */
  /** Plate — generic / catch-all family. */
  plateAllX: number; plateAllY: number; plateAllW: number;
  /** Plate — SPELL square. */
  plateSpX: number; plateSpY: number; plateSpW: number;
  /** Plate — TAUNT heater. */
  plateTaX: number; plateTaY: number; plateTaW: number;
  /** Plate — CIRCLE (oval) frame. */
  plateOvX: number; plateOvY: number; plateOvW: number;

  /* TIER 7 GLOW — a pulsing halo behind the stars on top-tier cards only. */
  /** Glow WIDTH (× --ccw). 0 hides it. */
  glowW: number;
  /** Glow HEIGHT (× --ccw) — independent of width, so it can be squashed to a wide, short haze that hugs the
   *  plaque instead of a circle that spills past it. */
  glowH: number;
  /** Glow horizontal offset (design px × --u). */
  glowX: number;
  /** Glow vertical offset (design px × --u). */
  glowY: number;
  /** Glow PEAK opacity; the pulse dips to `glowW`×`glowDip` of it. */
  glowA: number;
  /** Seconds per pulse cycle. */
  glowSpeed: number;
  /** How far the pulse dips (0 = fades right out, 1 = no pulse). */
  glowDip: number;
  /** Glow colour. */
  glowColor: string;

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

  tierX: -0.25,
  tierY: -0.25,
  tierScale: 1.24,

  stierX: 0,
  stierY: 4,
  stierScale: 1,

  ttierX: 0,
  ttierY: 2.75,
  ttierScale: 1,

  otierX: 0,
  otierY: 4,
  otierScale: 1,

  plateAllX: 0, plateAllY: 0, plateAllW: 0.765,
  plateSpX: 0, plateSpY: 0, plateSpW: 1,
  plateTaX: 0, plateTaY: -1.5, plateTaW: 1,
  plateOvX: 0, plateOvY: 0, plateOvW: 1,

  glowW: 0.945, glowH: 0.47, glowX: -1.5, glowY: -21.5, glowA: 1, glowSpeed: 0.7, glowDip: 0.83,
  glowColor: '#ff7ae7',

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
  stierScale: [0, 3, 0.005],
  ttierX: [-120, 120, 0.25],
  ttierY: [-120, 120, 0.25],
  ttierScale: [0, 3, 0.005],
  otierX: [-120, 120, 0.25],
  otierY: [-120, 120, 0.25],
  otierScale: [0, 3, 0.005],
  plateAllX: [-120, 120, 0.25],
  plateAllY: [-120, 120, 0.25],
  plateAllW: [0, 1.5, 0.005],
  plateSpX: [-120, 120, 0.25],
  plateSpY: [-120, 120, 0.25],
  plateSpW: [0, 3, 0.005],
  plateTaX: [-120, 120, 0.25],
  plateTaY: [-120, 120, 0.25],
  plateTaW: [0, 3, 0.005],
  plateOvX: [-120, 120, 0.25],
  plateOvY: [-120, 120, 0.25],
  plateOvW: [0, 3, 0.005],
  glowW: [0, 2, 0.005],
  glowH: [0, 2, 0.005],
  glowX: [-120, 120, 0.25],
  glowY: [-120, 120, 0.25],
  glowA: [0, 1, 0.01],
  glowSpeed: [0.4, 8, 0.1],
  glowDip: [0, 1, 0.01],
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
  otierX: 'CIRCLE-frame tier badge — horizontal nudge (design px). Oval-framed minions only.',
  otierY: 'CIRCLE-frame tier badge — vertical nudge (design px). Oval-framed minions only.',
  otierScale: 'CIRCLE-frame tier badge — size multiplier. Oval-framed minions only.',
  plateAllX: 'Tier plate (generic / catch-all) — horizontal nudge (design px) on top of the tier seat.',
  plateAllY: 'Tier plate (generic / catch-all) — vertical nudge (design px).',
  plateAllW: 'Tier plate (generic / catch-all) — WIDTH (× card width). Height follows the art ratio. 0 hides it.',
  plateSpX: 'Tier plate (SPELL square) — horizontal nudge (design px) on top of the tier seat.',
  plateSpY: 'Tier plate (SPELL square) — vertical nudge (design px).',
  plateSpW: 'Tier plate (SPELL square) — WIDTH (× card width). Height follows the art ratio. 0 hides it.',
  plateTaX: 'Tier plate (TAUNT heater) — horizontal nudge (design px) on top of the tier seat.',
  plateTaY: 'Tier plate (TAUNT heater) — vertical nudge (design px).',
  plateTaW: 'Tier plate (TAUNT heater) — WIDTH (× card width). Height follows the art ratio. 0 hides it.',
  plateOvX: 'Tier plate (CIRCLE (oval) frame) — horizontal nudge (design px) on top of the tier seat.',
  plateOvY: 'Tier plate (CIRCLE (oval) frame) — vertical nudge (design px).',
  plateOvW: 'Tier plate (CIRCLE (oval) frame) — WIDTH (× card width). Height follows the art ratio. 0 hides it.',
  glowW: 'TIER 7 glow — WIDTH (× card width). 0 hides it.',
  glowH: 'TIER 7 glow — HEIGHT (× card width). Independent of width, so it can be squashed flat.',
  glowX: 'TIER 7 glow — horizontal offset (design px).',
  glowY: 'TIER 7 glow — vertical offset (design px).',
  glowA: 'TIER 7 glow — peak opacity.',
  glowSpeed: 'TIER 7 glow — seconds per pulse cycle.',
  glowDip: 'TIER 7 glow — how far the pulse dips (0 = fades right out, 1 = steady, no pulse).',
  glowColor: 'TIER 7 glow — colour.',

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
  'otierX', 'otierY', 'otierScale',
  'plateAllX', 'plateAllY', 'plateAllW',
  'plateOvX', 'plateOvY', 'plateOvW',
  'plateSpX', 'plateSpY', 'plateSpW',
  'plateTaX', 'plateTaY', 'plateTaW',
  'glowW', 'glowH', 'glowX', 'glowY', 'glowA', 'glowSpeed', 'glowDip',
  'spellX', 'spellY', 'spellScale',
  'multX', 'multY', 'multScale',
] as const;
/** The COLOUR keys, rendered as `<input type="color">` in the tuner. */
export const CARD_PILLS_COLOR_KEYS = ['multBadge', 'multFont', 'glowColor'] as const;

export type CardPillsNumKey = (typeof CARD_PILLS_KEYS)[number];
export type CardPillsColorKey = (typeof CARD_PILLS_COLOR_KEYS)[number];

/** The shipped values, exported so the tuner can mark which controls you have moved away from them. */
export { DEFAULTS as PILLS_DEFAULTS };

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
  // ALL row: carries the centring, so every family rule starts from it.
  root.setProperty('--cpl-tier-t', t(cfg.tierX, cfg.tierY, cfg.tierScale, 'translateX(-50%)'));
  // Family rows are bare DELTAS appended after it — translate adds, scale multiplies.
  const delta = (x: number, y: number, sc: number): string =>
    `translate(calc(${x} * var(--u)), calc(${y} * var(--u))) scale(${sc})`;
  root.setProperty('--cpl-stier-n', delta(cfg.stierX, cfg.stierY, cfg.stierScale));
  root.setProperty('--cpl-ttier-n', delta(cfg.ttierX, cfg.ttierY, cfg.ttierScale));
  root.setProperty('--cpl-otier-n', delta(cfg.otierX, cfg.otierY, cfg.otierScale));
  const nudge = (x: number, y: number): string =>
    `translate(calc(${x} * var(--u)), calc(${y} * var(--u)))`;
  root.setProperty('--cpl-plate-all-t', nudge(cfg.plateAllX, cfg.plateAllY));
  root.setProperty('--cpl-plate-all-w', String(cfg.plateAllW));
  root.setProperty('--cpl-plate-sp-t', nudge(cfg.plateSpX, cfg.plateSpY));
  root.setProperty('--cpl-plate-sp-w', String(cfg.plateSpW));   // MULTIPLIER on the all width
  root.setProperty('--cpl-plate-ta-t', nudge(cfg.plateTaX, cfg.plateTaY));
  root.setProperty('--cpl-plate-ta-w', String(cfg.plateTaW));
  root.setProperty('--cpl-plate-ov-t', nudge(cfg.plateOvX, cfg.plateOvY));
  root.setProperty('--cpl-plate-ov-w', String(cfg.plateOvW));
  root.setProperty('--cpl-spell-t', t(cfg.spellX, cfg.spellY, cfg.spellScale, 'translateX(-50%)'));
  root.setProperty('--cpl-mult-t', t(cfg.multX, cfg.multY, cfg.multScale));
  // Colours go across as plain custom props; `.castmult` mixes the gradient stops out of `--cpl-mult-bg`.
  root.setProperty('--cpl-glow-w', String(cfg.glowW));
  root.setProperty('--cpl-glow-h', String(cfg.glowH));
  root.setProperty('--cpl-glow-t', nudge(cfg.glowX, cfg.glowY));
  root.setProperty('--cpl-glow-a', String(cfg.glowA));
  root.setProperty('--cpl-glow-speed', `${cfg.glowSpeed}s`);
  root.setProperty('--cpl-glow-dip', String(cfg.glowDip));
  root.setProperty('--cpl-glow-color', cfg.glowColor);
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
