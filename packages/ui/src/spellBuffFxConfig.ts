/**
 * Tunable parameters for the SPELL BUFF FX — the "this card in your hand just got stronger" cue (owner ask
 * 2026-07-23): a hand SPELL or Ruby whose printed value goes UP GROWS then SHRINKS back in place while pink /
 * gold / purple sparks blast outward off it.
 *
 * Two structural choices, both learned the hard way and load-bearing — don't undo them casually:
 *
 * 1. The card animates the standalone **`scale`** property, NOT `transform`. A hand card carries its own inline
 *    `transform` (the fan's slide/tuck); animating `transform` clobbers it for the animation's duration — and,
 *    with a forwards fill, for as long as the class is on. `scale` composes with `transform` instead, so the fan
 *    is never disturbed and there's nothing to restore afterwards.
 * 2. Grow and shrink are TWO animations, the shrink simply delayed by the grow's duration, so each owns its own
 *    duration AND its own easing. One keyframe animation can't do that: keyframe offsets can't be `var()`, and
 *    `animation-timing-function` declared inside a `@keyframes` block silently ignores `var()` (verified live —
 *    every keyframe reported `ease`).
 *
 * `Card.tsx` reads this config at FIRE TIME to bake the per-mote jitter and pushes the shape/timing dials down
 * as `--sb-*` custom properties, so an edit applies to the NEXT burst without a reload. Same persistence
 * contract as the other FX configs: localStorage-backed, dialed via the DEV "✨ Spell Buff" tuner
 * (`SpellBuffFxTuner.tsx`); production always renders the shipped DEFAULTS.
 *
 * Performance: one-shot (~1s), animating scale/transform/opacity only, so the burst composites rather than
 * repainting — the sanctioned case for a short animation on a card (see `docs/performance.md`).
 */
export interface SpellBuffFxConfig {
  // ── The card: grow, then shrink back. Each phase has its own speed and easing. ──
  /** Card — peak scale at the top of the grow. 1 = no growth at all (the true "off"). */
  growScale: number;
  /** Card — how long the GROW takes (ms). */
  growMs: number;
  /** Card — grow easing (0–1). 0 = snaps to size instantly; 1 = a long, gentle swell. */
  growEase: number;
  /** Card — how long the SHRINK back takes (ms). Fully independent of the grow. */
  shrinkMs: number;
  /** Card — shrink easing (0–1). 0 = drops back instantly; 1 = a long, gentle settle. */
  shrinkEase: number;

  // ── The sparks: an outward blast off the card. ──
  /** Sparks — how many motes explode off the card. 0 = none (card animation only). */
  sparkCount: number;
  /** Sparks — smallest mote diameter (px). */
  sparkSizeMin: number;
  /** Sparks — largest mote diameter (px). */
  sparkSizeMax: number;
  /** Sparks — shortest flight out from the card's centre (px). */
  blastDistMin: number;
  /** Sparks — longest flight out (px). */
  blastDistMax: number;
  /** Sparks — the arc the blast covers, in degrees. 360 = explodes evenly in every direction; smaller values
   *  focus it into a cone aimed straight up. */
  blastSpread: number;
  /** Sparks — launch punch (0–1). 0 = drifts out evenly; 1 = fires out hard then coasts. */
  sparkSpeed: number;
  /** Sparks — how far a mote is dragged back DOWN over its flight (px), so the blast arcs instead of flying
   *  dead straight. 0 = pure radial. */
  sparkGravity: number;
  /** Sparks — peak opacity (0–1). */
  sparkAlpha: number;
  /** Sparks — glow halo radius around each mote (px). 0 = flat, no bloom. */
  sparkGlow: number;
  /** Sparks — tail length as a MULTIPLE of the mote's size (0 = no tail). The tail streams back toward the
   *  card, so it always reads as a trail behind the flying mote whatever direction it took. */
  sparkTail: number;
  /** Sparks — a mote's flight + fade duration (ms). Independent of the card animation. */
  sparkMs: number;
  /** Sparks — largest random launch delay, so motes don't fire in lockstep (ms). */
  sparkStagger: number;
  /** Sparks — the three cycled hues. */
  pinkColor: string;
  goldColor: string;
  purpleColor: string;
}

/** Shipped starting point (dial in the ✨ tuner, then bake here). */
const DEFAULTS: SpellBuffFxConfig = {
  growScale: 1.12,
  growMs: 160,
  growEase: 0.5,
  shrinkMs: 380,
  shrinkEase: 0.8,

  sparkCount: 18,
  sparkSizeMin: 5,
  sparkSizeMax: 11,
  blastDistMin: 70,
  blastDistMax: 165,
  blastSpread: 360,
  sparkSpeed: 0.7,
  sparkGravity: 0,
  sparkAlpha: 1,
  sparkGlow: 7,
  sparkTail: 2.4,
  sparkMs: 760,
  sparkStagger: 90,
  pinkColor: '#ff8ad8',
  goldColor: '#ffce6e',
  purpleColor: '#ba82ff',
};

/** Slider bounds for the DEV tuner — [min, max, step] per NUMERIC key. */
export const SBF_RANGES: Record<Exclude<keyof SpellBuffFxConfig, 'pinkColor' | 'goldColor' | 'purpleColor'>, [number, number, number]> = {
  growScale: [1, 2.5, 0.01],
  growMs: [20, 1500, 10],
  growEase: [0, 1, 0.01],
  shrinkMs: [20, 2000, 10],
  shrinkEase: [0, 1, 0.01],

  sparkCount: [0, 80, 1],
  sparkSizeMin: [0.5, 30, 0.5],
  sparkSizeMax: [0.5, 48, 0.5],
  blastDistMin: [0, 600, 5],
  blastDistMax: [0, 900, 5],
  blastSpread: [0, 360, 5],
  sparkSpeed: [0, 1, 0.01],
  sparkGravity: [0, 600, 5],
  sparkAlpha: [0, 1, 0.01],
  sparkGlow: [0, 60, 0.5],
  sparkTail: [0, 20, 0.1],
  sparkMs: [80, 3000, 10],
  sparkStagger: [0, 1200, 10],
};

/** One-line definitions, shown as a hover tooltip on each control's name in the DEV tuner. */
export const SBF_DESC: Record<keyof SpellBuffFxConfig, string> = {
  growScale: 'Card — peak scale at the top of the grow. 1 = no growth at all.',
  growMs: 'Card — how long the GROW takes (ms).',
  growEase: 'Card — grow easing. 0 = snaps to size instantly; 1 = a long, gentle swell.',
  shrinkMs: 'Card — how long the SHRINK back takes (ms). Independent of the grow.',
  shrinkEase: 'Card — shrink easing. 0 = drops back instantly; 1 = a long, gentle settle.',
  sparkCount: 'Sparks — how many motes explode off the card. 0 = none.',
  sparkSizeMin: 'Sparks — smallest mote diameter (px).',
  sparkSizeMax: 'Sparks — largest mote diameter (px).',
  blastDistMin: 'Sparks — shortest flight out from the card centre (px).',
  blastDistMax: 'Sparks — longest flight out (px).',
  blastSpread: 'Sparks — arc the blast covers (deg). 360 = every direction; smaller focuses it upward.',
  sparkSpeed: 'Sparks — launch punch. 0 = drifts out evenly; 1 = fires out hard then coasts.',
  sparkGravity: 'Sparks — how far motes are dragged back down over the flight (px). 0 = pure radial.',
  sparkAlpha: 'Sparks — peak opacity.',
  sparkGlow: 'Sparks — glow halo radius around each mote (px). 0 = flat, no bloom.',
  sparkTail: 'Sparks — tail length as a multiple of the mote size (0 = no tail).',
  sparkMs: 'Sparks — a mote’s flight + fade duration (ms). Independent of the card animation.',
  sparkStagger: 'Sparks — largest random launch delay, so motes don’t fire in lockstep (ms).',
  pinkColor: 'Sparks — the pink hue.',
  goldColor: 'Sparks — the gold hue.',
  purpleColor: 'Sparks — the purple hue.',
};

/** Keys grouped by control type for the tuner UI. */
export const SBF_NUM_KEYS = [
  'growScale', 'growMs', 'growEase', 'shrinkMs', 'shrinkEase',
  'sparkCount', 'sparkSizeMin', 'sparkSizeMax',
  'blastDistMin', 'blastDistMax', 'blastSpread',
  'sparkSpeed', 'sparkGravity', 'sparkAlpha', 'sparkGlow', 'sparkTail', 'sparkMs', 'sparkStagger',
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

/** Turn a 0–1 softness into a cubic-bezier, swinging the control points across their FULL range so the dial
 *  actually bites: at 0 the value leaves rest almost vertically and slams into the target (an instant snap); at
 *  1 it crawls out flat and glides the last stretch in (a long cushioned move). */
function softnessCurve(v: number): string {
  const e = Math.min(1, Math.max(0, v));
  const x1 = (0.01 + e * 0.88).toFixed(3);
  const y1 = (0.92 - e * 0.91).toFixed(3);
  const x2 = (0.95 - e * 0.9).toFixed(3);
  return `cubic-bezier(${x1}, ${y1}, ${x2}, 1)`;
}
/** The GROW phase's curve. */
export const growEaseCss = (c: SpellBuffFxConfig = cfg): string => softnessCurve(c.growEase);
/** The SHRINK phase's curve — independent of the grow's, per the owner's ask. */
export const shrinkEaseCss = (c: SpellBuffFxConfig = cfg): string => softnessCurve(c.shrinkEase);

/** The curve a mote's outward flight is played on, from `sparkSpeed`. At 0 it drifts out evenly; at 1 nearly
 *  all the travel is spent in the first instant and it coasts the rest. */
export function sparkEaseCss(c: SpellBuffFxConfig = cfg): string {
  const s = Math.min(1, Math.max(0, c.sparkSpeed));
  const x1 = (0.55 - s * 0.54).toFixed(3);
  const y1 = (0.04 + s * 0.94).toFixed(3);
  return `cubic-bezier(${x1}, ${y1}, 0.36, 1)`;
}

/** How long the card's two-phase animation runs — the class has to stay on at least this long. */
export const cardBurstMs = (c: SpellBuffFxConfig = cfg): number => c.growMs + c.shrinkMs;
/** How long the spark burst runs (the last mote's launch delay plus its flight). */
export const sparkBurstMs = (c: SpellBuffFxConfig = cfg): number => c.sparkStagger + c.sparkMs;

/** One mote's baked jitter — built at FIRE TIME from the live config (so a tuner edit shows on the next burst). */
export interface SpellBuffSpark {
  angle: string; dist: string; delay: string; size: string; hue: string; tail: string;
}

/** Build a burst's motes from the current config. Each mote gets an ANGLE around the card's centre and a
 *  DISTANCE to fly, so the burst reads as an explosion outward rather than a rise. Angles are distributed
 *  evenly across `blastSpread` and then jittered within their slice, so the ring is even without ever looking
 *  banded. The arc is centred on straight-up, so narrowing the spread focuses the blast upward.
 *  Math.random is presentation-only jitter (the ban is scoped to core/content/sim). */
export function makeSpellBuffSparks(c: SpellBuffFxConfig = cfg): SpellBuffSpark[] {
  const hues = [c.pinkColor, c.goldColor, c.purpleColor];
  const n = Math.max(0, Math.round(c.sparkCount));
  const sMin = Math.min(c.sparkSizeMin, c.sparkSizeMax);
  const sMax = Math.max(c.sparkSizeMin, c.sparkSizeMax);
  const dMin = Math.min(c.blastDistMin, c.blastDistMax);
  const dMax = Math.max(c.blastDistMin, c.blastDistMax);
  const spread = Math.min(360, Math.max(0, c.blastSpread));
  const step = n > 0 ? spread / n : 0;
  return Array.from({ length: n }, (_, i) => {
    const size = sMin + Math.random() * (sMax - sMin);
    return {
      angle: (-spread / 2 + step * (i + Math.random())).toFixed(1) + 'deg',
      dist: (dMin + Math.random() * (dMax - dMin)).toFixed(0) + 'px',
      delay: (Math.random() * (c.sparkStagger / 1000)).toFixed(3) + 's',
      size: size.toFixed(1) + 'px',
      hue: hues[i % hues.length]!,
      // Tail scales with the mote, so a bigger spark streaks proportionally longer.
      tail: (size * c.sparkTail).toFixed(1) + 'px',
    };
  });
}
