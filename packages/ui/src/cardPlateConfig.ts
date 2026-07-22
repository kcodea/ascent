/**
 * Tunable geometry + text sizing for the HAND CARD BACKPLATE — the ornate stone/gold card body that frames a
 * hand card's oval portrait and glass info panel, and dissolves when the card is played to the board.
 *
 * The plate is STATIC: always the same size, never stretched. (A nine-sliced plate was prototyped and rejected —
 * the art's greek-key tabs sit at ~51% height, dead centre of the stretch band, so no slice inset protects them
 * from the measured 40% vertical stretch range. See the design spec.) Because the plate can't grow, long rules
 * text SHRINKS to fit instead, via `plateTextBucket()`.
 *
 * Held in one mutable, localStorage-persisted config so it can be dialed by eye via the DEV 🂠 Card Plate tuner
 * (`CardPlateTuner.tsx`). Values reflect to `--plate-*` CSS vars on :root. This module DOES ship in production —
 * `Card.tsx` imports `plateTextBucket` unconditionally, so `applyCardPlateVars()` runs there too and sets
 * `:root` from these DEFAULTS. The CSS fallbacks in styles.css (`var(--plate-scale, …)`) still must mirror
 * DEFAULTS: they're what actually renders whenever a var is absent (e.g. this module fails to load, or a value
 * gets dropped), and staying in sync is what keeps the stylesheet readable on its own. When a value is dialed
 * in, "Copy values" grabs the JSON — update BOTH here and in the CSS fallbacks. Three silent drifts have been
 * caused by missing it.
 */
export interface CardPlateConfig {
  /** Plate WIDTH as a multiple of the compact card width (--ccw). >1 = the border sits outside the card. */
  scale: number;
  /** Plate vertical offset from the top of the card, in px × --u. Negative lifts the plate up. */
  top: number;
  /** Corner radius of the plate's clipping box (px × --u). Cosmetic — the art has its own painted corners. */
  radius: number;
  /** Text bucket thresholds — character counts at which the rules-text font steps DOWN a size. */
  bucketM: number;
  bucketL: number;
  bucketXl: number;
  /** Placeholder dissolve — duration (ms). */
  puffMs: number;
  /** Placeholder dissolve — how much the plate scales up as it fades (1 = no growth). */
  puffScale: number;
  /** Placeholder dissolve — density multiplier passed to pixiFx.dust(). */
  puffDust: number;
}

const DEFAULTS: CardPlateConfig = {
  scale: 1.5,
  top: -37,
  radius: 10,
  // Derived from the measured corpus (median 59 / p90 96 / max 187 static, ~230 with live values folded in).
  // Conservative by design: character count is a proxy for WRAPPED height, and long-word text wraps taller
  // than short-word text at the same length. Dial these in the tuner if a specific card lands wrong.
  bucketM: 89,
  bucketL: 90,
  bucketXl: 150,
  puffMs: 120,
  puffScale: 1.03,
  puffDust: 3.2,
};

/** Font-size buckets, LARGEST first. `id` is appended to a `.plate-txt-` class on the card. */
export const PLATE_BUCKETS = [
  { id: 's', em: 1 },
  { id: 'm', em: 0.92 },
  { id: 'l', em: 0.84 },
  { id: 'xl', em: 0.76 },
] as const;

export type PlateBucketId = (typeof PLATE_BUCKETS)[number]['id'];

export const PLATE_RANGES: Record<keyof CardPlateConfig, [number, number, number]> = {
  scale: [1, 1.6, 0.005],
  top: [-80, 40, 1],
  radius: [0, 40, 1],
  bucketM: [20, 140, 1],
  bucketL: [40, 200, 1],
  bucketXl: [60, 280, 1],
  puffMs: [80, 1200, 10],
  puffScale: [1, 1.5, 0.01],
  puffDust: [0, 4, 0.1],
};

export const PLATE_DESC: Record<keyof CardPlateConfig, string> = {
  scale: 'Plate WIDTH as a multiple of the card width. >1 pushes the ornate border outside the card.',
  top: 'Plate vertical offset from the top of the card. Negative lifts it up.',
  radius: 'Corner radius of the plate box. Cosmetic — the art paints its own corners.',
  bucketM: 'Character count at which rules text steps down to the MEDIUM font size. NOT live on cards already ' +
    'on screen — Card is memoized, so a shown card only picks up the new threshold next time it re-renders ' +
    '(new card drawn, its text changing, etc.).',
  bucketL: 'Character count at which rules text steps down to the SMALL font size. NOT live on cards already ' +
    'on screen — see bucketM.',
  bucketXl: 'Character count at which rules text steps down to the SMALLEST font size. NOT live on cards ' +
    'already on screen — see bucketM.',
  puffMs: 'Placeholder dissolve duration (ms).',
  puffScale: 'How much the plate grows as it fades. 1 = fades in place.',
  puffDust: 'Dust density multiplier for the dissolve puff.',
};

export const PLATE_KEYS = Object.keys(DEFAULTS) as (keyof CardPlateConfig)[];

const KEY = 'ascent.cardplate';
let cfg: CardPlateConfig = (() => {
  // DEV-ONLY localStorage override: a tuner's saved tweaks must never beat the shipped DEFAULTS in a
  // production build (they did, for dragFeel + layoutConfig — owner report 2026-07-21, fixed in #615).
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<CardPlateConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getCardPlateConfig(): CardPlateConfig {
  return cfg;
}

/**
 * Pick a rules-text font bucket from the text's LENGTH — a pure function, deliberately NOT a DOM measurement.
 *
 * The obvious implementation (render, read `scrollHeight`, step down until it fits) is a layout read per card
 * per render on the hand, which re-renders constantly — precisely the `getBoundingClientRect`-per-frame
 * anti-pattern named in docs/performance.md. This is O(1), memoizable and deterministic.
 *
 * Pass the LIVE card text (values already folded in), not the static def text — a card printing "+6/+6
 * (2 more)" is longer than its printed base rate.
 */
export function plateTextBucket(text: string | undefined | null): PlateBucketId {
  const n = text ? text.length : 0;
  if (n < cfg.bucketM) return 's';
  if (n < cfg.bucketL) return 'm';
  if (n < cfg.bucketXl) return 'l';
  return 'xl';
}

/** Reflect the tuned plate values onto :root so the pure-CSS rules pick them up live. */
export function applyCardPlateVars(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--plate-scale', String(cfg.scale));
  root.setProperty('--plate-top', `${cfg.top}px`);
  root.setProperty('--plate-radius', `${cfg.radius}px`);
  root.setProperty('--plate-puff-ms', `${cfg.puffMs}ms`);
  root.setProperty('--plate-puff-scale', String(cfg.puffScale));
}

export function setCardPlateValue(key: keyof CardPlateConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  applyCardPlateVars();
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

export function resetCardPlateConfig(): void {
  cfg = { ...DEFAULTS };
  applyCardPlateVars();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

applyCardPlateVars();
