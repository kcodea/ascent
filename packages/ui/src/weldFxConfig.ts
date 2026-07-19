/**
 * Tunable parameters for the WELD FX — the "an Attachment just fused onto a minion" cue (owner ask
 * 2026-07-18). A quick gold **shot-ascension** pulse on the host card: a core bloom, one tight ring
 * snapping outward, a radial spark fizz, and motes shooting UP off the card.
 *
 * Fires on every weld (`weldMagnetic`, the single sim chokepoint):
 * - **hand-played** Attachment — the card's existing slide-in (`magSlideMs`, DragTuner) plays FIRST, then
 *   this pulse lands as it merges (the sim dispatch happens at the end of the slide, so the timing is free);
 * - **auto** welds (Banksly / Beatbot self-weld, Combinator, Cling Drones, Money Bots) — the pulse plays at
 *   whatever moment the weld happens, no slide.
 * `playScale`/`autoScale` let the two read differently (a deliberate hand-play can hit harder than an
 * incidental auto-weld) without maintaining two configs.
 *
 * Same pattern as `auraFxConfig.ts`: one mutable, localStorage-persisted config dialed via the DEV
 * "🔩 Weld FX" tuner (`WeldFxTuner.tsx`); `getWeldFxConfig()` is read at fire time, so edits apply to the
 * NEXT weld. Production always renders the shipped DEFAULTS.
 */
import type { WeldCfg } from './pixiFx';

export interface WeldFxConfig {
  coreSize: number;    // px radius — the gold fuse bloom at the card's centre
  coreMs: number;      // ms — core bloom lifetime (short = "shot")
  coreAlpha: number;   // 0..1 — core peak opacity
  ringSize: number;    // px radius — the tight ring snapping outward (0 = off)
  ringWidth: number;   // px — reserved for the ring texture's visual weight
  ringMs: number;      // ms — ring expand + fade
  ringAlpha: number;   // 0..1 — ring peak opacity
  fizzCount: number;   // radial sparks (the "fizz") — many + small reads better than few + big
  fizzSpeed: number;   // px/s — outward spark speed
  fizzSize: number;    // px — spark size
  fizzLife: number;    // ms — spark lifetime (short = fizzy, long = burst-y)
  riseCount: number;   // motes shot UPWARD off the card (the "ascension" half)
  riseSpeed: number;   // px/s — upward launch speed
  riseSpread: number;  // px/s — horizontal fan of the rising motes (0 = a straight column)
  riseSize: number;    // px — rising mote size
  riseLife: number;    // ms — rising mote lifetime
  riseGravity: number; // px/s² — pull on the rising motes (negative = they keep accelerating up)
  playScale: number;   // × — magnitude multiplier for a HAND-PLAYED attachment (counts + speeds + sizes)
  autoScale: number;   // × — magnitude multiplier for an AUTO weld (Banksly/Combinator/Cling/MoneyBot)
  wiggleMs: number;    // ms — the host card's wobble as the Attachment fuses (0 = no wiggle)
  wigglePx: number;    // px — horizontal shake amplitude
  wiggleDeg: number;   // deg — rotation amplitude
  wiggleScale: number; // × — the bounce (1 = none; 1.06 = a 6% pop at the peak)
}

const DEFAULTS: WeldFxConfig = {
  coreSize: 74, coreMs: 260, coreAlpha: 0.95,
  ringSize: 96, ringWidth: 10, ringMs: 300, ringAlpha: 0.7,
  fizzCount: 26, fizzSpeed: 340, fizzSize: 7, fizzLife: 420,
  riseCount: 14, riseSpeed: 260, riseSpread: 90, riseSize: 8, riseLife: 620, riseGravity: -40,
  playScale: 1, autoScale: 0.8,
  wiggleMs: 420, wigglePx: 3, wiggleDeg: 1.6, wiggleScale: 1.04,
};

export const WELDFX_KEYS = [
  'coreSize', 'coreMs', 'coreAlpha',
  'ringSize', 'ringWidth', 'ringMs', 'ringAlpha',
  'fizzCount', 'fizzSpeed', 'fizzSize', 'fizzLife',
  'riseCount', 'riseSpeed', 'riseSpread', 'riseSize', 'riseLife', 'riseGravity',
  'playScale', 'autoScale',
  'wiggleMs', 'wigglePx', 'wiggleDeg', 'wiggleScale',
] as const satisfies readonly (keyof WeldFxConfig)[];

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const WELDFX_RANGES: Partial<Record<keyof WeldFxConfig, [number, number, number]>> = {
  coreSize: [0, 220, 2], coreMs: [60, 900, 10], coreAlpha: [0, 1, 0.05],
  ringSize: [0, 260, 2], ringWidth: [0, 40, 1], ringMs: [0, 900, 10], ringAlpha: [0, 1, 0.05],
  fizzCount: [0, 80, 1], fizzSpeed: [0, 900, 10], fizzSize: [2, 24, 1], fizzLife: [100, 1400, 10],
  riseCount: [0, 60, 1], riseSpeed: [0, 700, 10], riseSpread: [0, 300, 5], riseSize: [2, 24, 1],
  riseLife: [100, 1800, 10], riseGravity: [-300, 300, 10],
  playScale: [0.2, 2, 0.05], autoScale: [0.2, 2, 0.05],
  wiggleMs: [0, 1200, 10], wigglePx: [0, 20, 0.5], wiggleDeg: [0, 12, 0.2], wiggleScale: [1, 1.3, 0.01],
};

/** The tribe-agnostic gold palette — weld reads as forge-work, not as a tribe buff, so the colors are
 *  fixed rather than pulled from BUFF_PRESETS (owner brief: "yellow/glow/fizz/spark"). */
export const WELD_COLORS = { colorCore: '#ffd766', colorSpark: '#fef962', colorRise: '#fff2b8' };

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

/** Build the renderer cfg for a weld of `kind`, folding in that kind's magnitude scale. Counts scale
 *  (more sparks on a deliberate play), as do speeds + sizes; TIMINGS deliberately don't — a scaled-down
 *  auto weld should be smaller, not slower. */
export function weldCfgFor(kind: 'play' | 'auto'): WeldCfg {
  const c = cfg;
  const k = kind === 'play' ? c.playScale : c.autoScale;
  return {
    coreSize: c.coreSize * k, coreMs: c.coreMs, coreAlpha: c.coreAlpha,
    ringSize: c.ringSize * k, ringWidth: c.ringWidth, ringMs: c.ringMs, ringAlpha: c.ringAlpha,
    fizzCount: Math.round(c.fizzCount * k), fizzSpeed: c.fizzSpeed * k, fizzSize: c.fizzSize, fizzLife: c.fizzLife,
    riseCount: Math.round(c.riseCount * k), riseSpeed: c.riseSpeed * k, riseSpread: c.riseSpread,
    riseSize: c.riseSize, riseLife: c.riseLife, riseGravity: c.riseGravity,
    ...WELD_COLORS,
  };
}

/**
 * WELD WIGGLE — the host card's physical reaction as the Attachment fuses into it: a damped shake
 * (translate + rotate) with an optional bounce (scale). Replaces the generic green buff-burst + "+X/+X"
 * float that used to fire on a weld (owner 2026-07-18: that's the old stat-gain cue, wrong for this).
 *
 * One-shot, TRANSFORM-ONLY via the Web Animations API with `composite: 'add'`, so it stacks on whatever
 * transform the card already carries (drag lean, FLIP, hover) instead of clobbering it — the same
 * technique as `applyAuraLift`, and it honours the perf rule (never animate paint properties).
 */
export function applyWeldWiggle(els: Element[]): void {
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
      ], { duration: c.wiggleMs, easing: 'ease-out', composite: 'add' });
    } catch { /* WAAPI composite unsupported: skip rather than clobber the card transform */ }
  }
}
