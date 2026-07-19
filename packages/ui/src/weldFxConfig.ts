/**
 * Tunable parameters for the WELD FX — the "an Attachment just fused onto a minion" cue (owner design
 * 2026-07-18): a ring that **eases in and converges** onto the host card and lands with a soft flash.
 * (The spark burst the design started with is dialled to 0 in the shipped defaults — see DEFAULTS — but
 * the dials stay, so it can come back without code.)
 *
 * Fires on every weld (`weldMagnetic`, the single sim chokepoint):
 * - **hand-played** Attachment — the card's existing slide-in (`magSlideMs`, DragTuner) plays FIRST, and
 *   the sim dispatch lands at the end of it, so the ring converges just as the card merges;
 * - **auto** welds (Banksly / Beatbot, Combinator, Cling Drones, Money Bots) — plays at the weld's own
 *   moment, no slide.
 * `playScale`/`autoScale` let the two read differently without maintaining two configs.
 *
 * The generic stat-gain cues (the green buff-burst + the "+X/+Y" float) are SUPPRESSED on a weld — this
 * effect plus the wiggle replace them.
 *
 * Same pattern as `auraFxConfig.ts`: one mutable, localStorage-persisted config dialed via the DEV
 * "🔩 Weld FX" tuner (`WeldFxTuner.tsx`); `getWeldFxConfig()` is read at fire time, so edits apply to the
 * NEXT weld. Production always renders the shipped DEFAULTS.
 */
import type { WeldCfg } from './pixiFx';

export interface WeldFxConfig {
  ringStart: number;     // px radius — where the ring starts (wide, off the card)
  ringEnd: number;       // px radius — where it converges to (≈ the card's own size)
  ringMs: number;        // ms — the convergence (eases IN: hangs wide, then rushes closed)
  ringWidth: number;     // px — ring stroke weight
  ringAlpha: number;     // 0..1 — ring peak opacity (it brightens as it closes)
  ringGlowWidth: number; // px — a softer, wider halo stroke under the ring (0 = off)
  ringSides: number;     // SHAPE: 0-2 = circle/ellipse; 3+ = a regular polygon (4 = diamond, 6 = hex, 8 = octagon)
  ringAspect: number;    // × — width ÷ height (1 = round; < 1 = tall, matching the card; > 1 = wide)
  ringRotation: number;  // deg — the shape's / spokes' starting orientation
  ringSpin: number;      // deg — how far it rotates over the whole convergence (± for direction)
  easeStart: number;     // 0..1 — EASE BAR: how much the departure is slowed (0 = leaves at full speed)
  easeFinish: number;    // 0..1 — EASE BAR: how much the arrival is slowed (0 = slams in at full speed)
  spokeCount: number;    // lines OUTSIDE the ring pointing inward at it, riding it in (0 = off)
  spokeLen: number;      // px — spoke length
  spokeWidth: number;    // px — spoke stroke weight
  spokeAlpha: number;    // 0..1 — spoke opacity (relative to the ring's own fade)
  spokeGap: number;      // px — gap between the ring and a spoke's inner tip
  flashSize: number;     // px radius — the flash when the ring lands (0 = off)
  flashMs: number;       // ms — flash lifetime
  flashAlpha: number;    // 0..1 — flash peak opacity
  sparkCount: number;    // sparks rising off the card AFTER the ring lands (0 = off)
  sparkSpeed: number;    // px/s — upward launch speed
  sparkSpread: number;   // px/s — horizontal fan (0 = a straight column)
  sparkSize: number;     // px — spark size
  sparkLife: number;     // ms — spark lifetime
  sparkGravity: number;  // px/s² — pull on the sparks (negative = they keep accelerating up)
  playScale: number;     // × — magnitude for a HAND-PLAYED attachment (radii + counts + speeds)
  autoScale: number;     // × — magnitude for an AUTO weld (Banksly/Combinator/Cling/MoneyBot)
  wiggleMs: number;      // ms — the host card's wobble as the ring lands (0 = no wiggle)
  wigglePx: number;      // px — horizontal shake amplitude
  wiggleDeg: number;     // deg — rotation amplitude
  wiggleScale: number;   // × — the bounce (1 = none; 1.06 = a 6% pop at the peak)
}

// Owner-tuned 2026-07-19 (v2, final): a spinning PENTAGON (5 sides, oriented 90°, spinning 125° as it
// closes) inside a corona of 24 long inward spokes (51px, 19px gap, full alpha), converging in 290ms all
// the way down onto the card (210 → 42px). Ease bars 0.56 / 0.24.
//
// The landing is now carried by a WIDER, SOFTER flash (112px, α 0.55) with **no sparks at all** — the ring's
// convergence is the whole read, and the spark burst was both noisy over it and the effect's main per-weld
// cost when several Attachments weld at once. The wiggle came down to a nudge to match (350ms / 2px / 1.8°
// / 1.05×) — welds fire in clusters, so a big bounce on every host read as the board shaking.
const DEFAULTS: WeldFxConfig = {
  ringStart: 210, ringEnd: 42, ringMs: 290, ringWidth: 6, ringAlpha: 0.6, ringGlowWidth: 6,
  ringSides: 5, ringAspect: 1, ringRotation: 90, ringSpin: 125,
  easeStart: 0.56, easeFinish: 0.24,
  spokeCount: 24, spokeLen: 51, spokeWidth: 3, spokeAlpha: 1, spokeGap: 19,
  flashSize: 112, flashMs: 480, flashAlpha: 0.55,
  sparkCount: 0, sparkSpeed: 250, sparkSpread: 100, sparkSize: 3, sparkLife: 700, sparkGravity: 180,
  playScale: 1.1, autoScale: 1.05,
  wiggleMs: 350, wigglePx: 2, wiggleDeg: 1.8, wiggleScale: 1.05,
};

export const WELDFX_KEYS = [
  'ringStart', 'ringEnd', 'ringMs', 'ringWidth', 'ringAlpha', 'ringGlowWidth',
  'ringSides', 'ringAspect', 'ringRotation', 'ringSpin',
  'easeStart', 'easeFinish',
  'spokeCount', 'spokeLen', 'spokeWidth', 'spokeAlpha', 'spokeGap',
  'flashSize', 'flashMs', 'flashAlpha',
  'sparkCount', 'sparkSpeed', 'sparkSpread', 'sparkSize', 'sparkLife', 'sparkGravity',
  'playScale', 'autoScale',
  'wiggleMs', 'wigglePx', 'wiggleDeg', 'wiggleScale',
] as const satisfies readonly (keyof WeldFxConfig)[];

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const WELDFX_RANGES: Partial<Record<keyof WeldFxConfig, [number, number, number]>> = {
  ringStart: [40, 500, 5], ringEnd: [0, 200, 2], ringMs: [80, 1200, 10],
  ringWidth: [1, 24, 0.5], ringAlpha: [0, 1, 0.05], ringGlowWidth: [0, 40, 1],
  ringSides: [0, 12, 1], ringAspect: [0.3, 2.5, 0.05], ringRotation: [0, 360, 5], ringSpin: [-360, 360, 5],
  easeStart: [0, 1, 0.02], easeFinish: [0, 1, 0.02],
  spokeCount: [0, 24, 1], spokeLen: [0, 80, 1], spokeWidth: [0.5, 12, 0.5], spokeAlpha: [0, 1, 0.05], spokeGap: [0, 40, 1],
  flashSize: [0, 220, 2], flashMs: [0, 900, 10], flashAlpha: [0, 1, 0.05],
  sparkCount: [0, 60, 1], sparkSpeed: [0, 700, 10], sparkSpread: [0, 300, 5],
  sparkSize: [2, 24, 1], sparkLife: [100, 1800, 10], sparkGravity: [-300, 300, 10],
  playScale: [0.2, 2, 0.05], autoScale: [0.2, 2, 0.05],
  wiggleMs: [0, 1200, 10], wigglePx: [0, 20, 0.5], wiggleDeg: [0, 12, 0.2], wiggleScale: [1, 1.3, 0.01],
};

/** Fixed gold palette — a weld reads as forge-work, not a tribe buff (owner brief: yellow/glow/spark). */
export const WELD_COLORS = { colorRing: '#ffd766', colorFlash: '#fff2b8', colorSpark: '#fef962' };

const KEY = 'ascent.weldfx';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: WeldFxConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<WeldFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getWeldFxConfig(): WeldFxConfig {
  return cfg;
}
export function setWeldFxValue(key: keyof WeldFxConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetWeldFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Build the renderer cfg for a weld of `kind`, folding in that kind's magnitude scale. Radii, counts and
 *  speeds scale; TIMINGS deliberately don't — a scaled-down auto weld should be smaller, not slower. */
export function weldCfgFor(kind: 'play' | 'auto'): WeldCfg {
  const c = cfg;
  const k = kind === 'play' ? c.playScale : c.autoScale;
  return {
    ringStart: c.ringStart * k, ringEnd: c.ringEnd * k, ringMs: c.ringMs,
    ringWidth: c.ringWidth, ringAlpha: c.ringAlpha, ringGlowWidth: c.ringGlowWidth,
    // Shape + easing are IDENTITY across kinds — an auto weld should be a smaller version of the same
    // motion, not a different one. Only sizes/counts take the magnitude scale.
    ringSides: c.ringSides, ringAspect: c.ringAspect, ringRotation: c.ringRotation, ringSpin: c.ringSpin,
    easeStart: c.easeStart, easeFinish: c.easeFinish,
    spokeCount: Math.round(c.spokeCount), spokeLen: c.spokeLen * k, spokeWidth: c.spokeWidth,
    spokeAlpha: c.spokeAlpha, spokeGap: c.spokeGap,
    flashSize: c.flashSize * k, flashMs: c.flashMs, flashAlpha: c.flashAlpha,
    sparkCount: Math.round(c.sparkCount * k), sparkSpeed: c.sparkSpeed * k, sparkSpread: c.sparkSpread,
    sparkSize: c.sparkSize, sparkLife: c.sparkLife, sparkGravity: c.sparkGravity, sparkDelayMs: 0,
    ...WELD_COLORS,
  };
}

/**
 * WELD WIGGLE — the host card's physical reaction as the ring lands: a damped shake (translate + rotate)
 * with an optional bounce (scale). Replaces the generic green buff-burst + "+X/+Y" float on a weld.
 *
 * One-shot, TRANSFORM-ONLY via the Web Animations API with `composite: 'add'`, so it stacks on whatever
 * transform the card already carries (drag lean, FLIP, hover) instead of clobbering it — the same
 * technique as `applyAuraLift`, and it honours the perf rule (never animate paint properties).
 * `delayMs` lets the caller land it WITH the ring rather than at fire time.
 */
export function applyWeldWiggle(els: Element[], delayMs = 0): void {
  const c = cfg;
  if (c.wiggleMs <= 0) return;
  const px = c.wigglePx;
  const dg = c.wiggleDeg;
  const sc = c.wiggleScale;
  for (const el of els) {
    try {
      el.animate([
        { transform: 'translateX(0) rotate(0deg) scale(1)' },
        { transform: `translateX(${px}px) rotate(${dg}deg) scale(${sc})`, offset: 0.18 },
        { transform: `translateX(${-px * 0.7}px) rotate(${-dg * 0.7}deg) scale(${1 + (sc - 1) * 0.6})`, offset: 0.42 },
        { transform: `translateX(${px * 0.35}px) rotate(${dg * 0.35}deg) scale(${1 + (sc - 1) * 0.25})`, offset: 0.68 },
        { transform: 'translateX(0) rotate(0deg) scale(1)' },
      ], { duration: c.wiggleMs, delay: delayMs, easing: 'ease-out', composite: 'add' });
    } catch { /* WAAPI composite unsupported: skip rather than clobber the card transform */ }
  }
}

/** How long after firing the ring actually lands — the caller delays the wiggle by this so the card
 *  reacts to the impact, not to the ring appearing. */
export function weldLandMs(): number {
  return cfg.ringMs;
}
