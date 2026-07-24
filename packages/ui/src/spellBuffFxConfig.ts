/**
 * Tunable parameters for the SPELL BUFF FX — the "this card in your hand just got stronger" cue (owner ask
 * 2026-07-23): a hand SPELL or Ruby whose printed value goes UP does a quick wiggle + grow/shrink pop while
 * pink / gold / purple sparks burst off it and rise.
 *
 * Unlike the Pixi FX configs (gust / aura / spell power), this cue is **CSS**: `Card.tsx` reads this config at
 * FIRE TIME to build the per-mote jitter (count, size, spawn spread, rise, drift, delay, hue) and pushes the
 * timing/shape dials down as CSS custom properties (`--sb-*`), so an edit applies to the NEXT burst without a
 * reload. Same persistence contract as the others: one mutable, localStorage-backed config dialed via the DEV
 * "✨ Spell Buff" tuner (`SpellBuffFxTuner.tsx`); production always renders the shipped DEFAULTS.
 *
 * Performance: the burst is one-shot (~0.8s) and animates transform/opacity only, so it composites instead of
 * repainting — the sanctioned case for a short animation touching a card (see `docs/performance.md`).
 */
export interface SpellBuffFxConfig {
  /** Sparks — how many motes burst off the card. 0 = no sparks (wiggle only). */
  sparkCount: number;
  /** Sparks — smallest mote diameter (px). */
  sparkSizeMin: number;
  /** Sparks — largest mote diameter (px). */
  sparkSizeMax: number;
  /** Sparks — how wide across the card the motes spawn (% of card width). */
  sparkSpread: number;
  /** Sparks — lowest spawn height, measured up from the card's bottom (%). */
  sparkOriginLo: number;
  /** Sparks — highest spawn height (%). */
  sparkOriginHi: number;
  /** Sparks — shortest climb, in PIXELS. (It used to be a %, but a percentage on `translate` resolves against
   *  the MOTE's own box — ~7px — so even 260% was only ~18px of travel. Pixels are what the dial implies.) */
  sparkRiseMin: number;
  /** Sparks — longest climb (px). */
  sparkRiseMax: number;
  /** Sparks — launch punch (0–1). 0 = eases up evenly; 1 = fires off hard then coasts. Shapes the curve the
   *  climb is played on. */
  sparkSpeed: number;
  /** Sparks — how far a mote sags back down after reaching its peak (px). 0 = hangs at the top while it fades. */
  sparkGravity: number;
  /** Sparks — total sideways wander over the climb (px, split ±). */
  sparkDrift: number;
  /** Sparks — peak opacity (0–1). Raise it to make the burst read louder. */
  sparkAlpha: number;
  /** Sparks — glow halo radius around each mote (px). 0 = flat, no bloom. */
  sparkGlow: number;
  /** Sparks — tail length as a MULTIPLE of the mote's size (0 = no tail). Each mote trails a tapering streak
   *  below it as it climbs, so bigger motes get proportionally longer tails. */
  sparkTail: number;
  /** Sparks — a mote's rise + fade duration (ms). Independent of the card's wiggle. */
  sparkMs: number;
  /** Sparks — largest random launch delay, so motes don't fire in lockstep (ms). */
  sparkStagger: number;
  /** Sparks — the three cycled hues. */
  pinkColor: string;
  goldColor: string;
  purpleColor: string;
  /** Card — peak wiggle rotation (deg). 0 = no wiggle. */
  wiggleDeg: number;
  /** Card — peak grow/shrink scale (1 = no pop). */
  wiggleScale: number;
  /** Card — wiggle + pop duration (ms). */
  wiggleMs: number;
  /** Card — pop softness (0–1). 0 = snappy/linear (jarring); 1 = a slow, cushioned ease in and out. */
  wiggleEase: number;
  /** Card — springiness. Pushes the pop PAST its target and lets it settle back, which is what makes a pop feel
   *  alive rather than instant. 0 = none. */
  wiggleOvershoot: number;
}

/** Shipped starting point (dial in the ✨ tuner, then bake here). Matches the palette the Spell Power FX uses. */
const DEFAULTS: SpellBuffFxConfig = {
  sparkCount: 15,
  sparkSizeMin: 5,
  sparkSizeMax: 11,
  sparkSpread: 78,
  sparkOriginLo: 8,
  sparkOriginHi: 54,
  sparkRiseMin: 80,
  sparkRiseMax: 170,
  sparkSpeed: 0.55,
  sparkGravity: 0,
  sparkDrift: 30,
  sparkAlpha: 1,
  sparkGlow: 7,
  sparkTail: 2.2,
  sparkMs: 900,
  sparkStagger: 160,
  pinkColor: '#ff8ad8',
  goldColor: '#ffce6e',
  purpleColor: '#ba82ff',
  wiggleDeg: 3.4,
  wiggleScale: 1.09,
  wiggleMs: 660,
  wiggleEase: 0.7,
  wiggleOvershoot: 0.28,
};

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key. */
export const SBF_RANGES: Record<Exclude<keyof SpellBuffFxConfig, 'pinkColor' | 'goldColor' | 'purpleColor'>, [number, number, number]> = {
  sparkCount: [0, 40, 1],
  sparkSizeMin: [1, 20, 0.5],
  sparkSizeMax: [1, 30, 0.5],
  sparkSpread: [0, 140, 1],
  sparkOriginLo: [0, 90, 1],
  sparkOriginHi: [0, 100, 1],
  sparkRiseMin: [0, 400, 5],
  sparkRiseMax: [0, 500, 5],
  sparkSpeed: [0, 1, 0.01],
  sparkGravity: [0, 200, 1],
  sparkDrift: [0, 120, 1],
  sparkAlpha: [0, 1, 0.01],
  sparkGlow: [0, 30, 0.5],
  sparkTail: [0, 8, 0.1],
  sparkMs: [150, 2500, 10],
  sparkStagger: [0, 600, 10],
  wiggleDeg: [0, 15, 0.1],
  wiggleScale: [1, 1.4, 0.01],
  wiggleMs: [120, 1600, 10],
  wiggleEase: [0, 1, 0.01],
  wiggleOvershoot: [0, 0.8, 0.01],
};

/** One-line definitions, shown as a hover tooltip on each control's name in the DEV tuner. */
export const SBF_DESC: Record<keyof SpellBuffFxConfig, string> = {
  sparkCount: 'Sparks — how many motes burst off the card. 0 = wiggle only.',
  sparkSizeMin: 'Sparks — smallest mote diameter (px).',
  sparkSizeMax: 'Sparks — largest mote diameter (px).',
  sparkSpread: 'Sparks — how wide across the card the motes spawn (% of card width).',
  sparkOriginLo: 'Sparks — lowest spawn height, up from the card bottom (%).',
  sparkOriginHi: 'Sparks — highest spawn height (%).',
  sparkRiseMin: 'Sparks — shortest climb, in PIXELS.',
  sparkRiseMax: 'Sparks — longest climb (px).',
  sparkSpeed: 'Sparks — launch punch. 0 = eases up evenly; 1 = fires off hard then coasts.',
  sparkGravity: 'Sparks — how far a mote sags back down after its peak (px). 0 = hangs while fading.',
  sparkDrift: 'Sparks — total sideways wander over the climb (px, split ±).',
  sparkAlpha: 'Sparks — peak opacity. Raise it to make the burst read louder.',
  sparkGlow: 'Sparks — glow halo radius around each mote (px). 0 = flat, no bloom.',
  sparkTail: 'Sparks — tail length as a multiple of the mote size (0 = no tail).',
  sparkMs: 'Sparks — a mote’s rise + fade duration (ms). Independent of the card wiggle.',
  sparkStagger: 'Sparks — largest random launch delay, so motes don’t fire in lockstep (ms).',
  pinkColor: 'Sparks — the pink hue.',
  goldColor: 'Sparks — the gold hue.',
  purpleColor: 'Sparks — the purple hue.',
  wiggleDeg: 'Card — peak wiggle rotation (deg). 0 = no wiggle.',
  wiggleScale: 'Card — peak grow/shrink scale (1 = no pop).',
  wiggleMs: 'Card — wiggle + pop duration (ms).',
  wiggleEase: 'Card — pop softness. 0 = snappy/linear (jarring); 1 = slow, cushioned ease.',
  wiggleOvershoot: 'Card — springiness: pushes the pop past its target and settles back. 0 = none.',
};

/** Keys grouped by control type for the tuner UI. */
export const SBF_NUM_KEYS = [
  'sparkCount', 'sparkSizeMin', 'sparkSizeMax', 'sparkSpread',
  'sparkOriginLo', 'sparkOriginHi', 'sparkRiseMin', 'sparkRiseMax', 'sparkSpeed', 'sparkGravity',
  'sparkDrift', 'sparkAlpha', 'sparkGlow', 'sparkTail', 'sparkMs', 'sparkStagger',
  'wiggleDeg', 'wiggleScale', 'wiggleMs', 'wiggleEase', 'wiggleOvershoot',
] as const;
export const SBF_COLOR_KEYS = ['pinkColor', 'goldColor', 'purpleColor'] as const;

const KEY = 'ascent.spellbufffx';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: SpellBuffFxConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<SpellBuffFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getSpellBuffFxConfig(): SpellBuffFxConfig {
  return cfg;
}
export function setSpellBuffFxValue(key: keyof SpellBuffFxConfig, value: number | string): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetSpellBuffFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The climb curve a mote is played on, built from `sparkSpeed`. At 0 it eases up evenly; at 1 it leaves hard
 *  and coasts (the y1 control point carries most of the travel into the first fraction of the life). */
export function sparkEaseCss(c: SpellBuffFxConfig = cfg): string {
  const s = Math.min(1, Math.max(0, c.sparkSpeed));
  const x1 = (0.34 - s * 0.31).toFixed(3);
  const y1 = (0.12 + s * 0.82).toFixed(3);
  return `cubic-bezier(${x1}, ${y1}, 0.36, 1)`;
}

/** The card pop's curve, built from `wiggleEase` (softness) + `wiggleOvershoot` (spring). The overshoot rides
 *  the second control point PAST 1, so each leg of the wiggle sails a little beyond its target and settles —
 *  that is what turns an instant snap into a pop. */
export function wiggleEaseCss(c: SpellBuffFxConfig = cfg): string {
  const e = Math.min(1, Math.max(0, c.wiggleEase));
  const o = Math.max(0, c.wiggleOvershoot);
  const x1 = (0.08 + e * 0.42).toFixed(3);
  const y1 = (0.02 + e * 0.12).toFixed(3);
  const x2 = (0.62 - e * 0.24).toFixed(3);
  const y2 = (1 + o).toFixed(3);
  return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
}

/** One spark's baked jitter — built at FIRE TIME from the live config (so a tuner edit shows on the next burst). */
export interface SpellBuffSpark {
  left: string; bottom: string; delay: string; size: string; rise: string; wx: string; hue: string; tail: string;
}

/** Build a burst's motes from the current config. Math.random is presentation-only jitter (the ban is scoped
 *  to core/content/sim). */
export function makeSpellBuffSparks(c: SpellBuffFxConfig = cfg): SpellBuffSpark[] {
  const hues = [c.pinkColor, c.goldColor, c.purpleColor];
  const lo = Math.min(c.sparkOriginLo, c.sparkOriginHi);
  const hi = Math.max(c.sparkOriginLo, c.sparkOriginHi);
  const sMin = Math.min(c.sparkSizeMin, c.sparkSizeMax);
  const sMax = Math.max(c.sparkSizeMin, c.sparkSizeMax);
  const rMin = Math.min(c.sparkRiseMin, c.sparkRiseMax);
  const rMax = Math.max(c.sparkRiseMin, c.sparkRiseMax);
  return Array.from({ length: Math.max(0, Math.round(c.sparkCount)) }, (_, i) => {
    const size = sMin + Math.random() * (sMax - sMin);
    return {
      left: (50 + (Math.random() - 0.5) * c.sparkSpread).toFixed(1) + '%',
      bottom: (lo + Math.random() * (hi - lo)).toFixed(1) + '%',
      delay: (Math.random() * (c.sparkStagger / 1000)).toFixed(3) + 's',
      size: size.toFixed(1) + 'px',
      rise: (rMin + Math.random() * (rMax - rMin)).toFixed(0) + 'px',
      wx: ((Math.random() - 0.5) * c.sparkDrift).toFixed(0) + 'px',
      hue: hues[i % hues.length]!,
      // Tail scales with the mote, so a bigger spark streaks proportionally longer.
      tail: (size * c.sparkTail).toFixed(1) + 'px',
    };
  });
}
