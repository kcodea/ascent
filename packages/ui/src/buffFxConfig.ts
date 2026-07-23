import type { DescendPresetCfg } from './descendPresets';
import { DESCEND_PRESETS } from './descendPresets';

/**
 * Tunable parameters for the BUFF FX — the animation that plays on a minion when something buffs it: the
 * **descend** (a ribbon dropping onto the card) and its **landing pulse**, plus the **wave pacing** used by
 * itemized per-z rewards (Blueprint Cache's "+2/+2 per Attachment", Rune of Spending / Action, Forsaken
 * Speed) on their End-of-Turn beat.
 *
 * Wave pacing (owner ask 2026-07-18): an itemized reward fires one WAVE per unit of its scaler, and every
 * eligible minion is hit inside the same wave (so all the Mechs pulse together). `waveGapMs` is the MINIMUM
 * gap between waves — the old formula divided the beat by the event count, so a big board compressed the
 * steps into an unreadable smear. Waves now hold their spacing; `waveMaxTotalMs` caps the whole run so a
 * huge board still finishes inside its beat (past the cap, the remaining waves land together).
 *
 * Same pattern as the other FX configs: localStorage-persisted, dialed via the DEV "✨ Buff FX" tuner
 * (`BuffFxTuner.tsx`); read at fire time, so edits apply to the NEXT buff. Production ships the DEFAULTS.
 */
export interface BuffFxConfig {
  waveGapMs: number;       // ms — MINIMUM gap between itemized waves (the readability floor)
  waveMaxTotalMs: number;  // ms — cap on the whole wave run; past this, the rest land together
  waveMaxCount: number;    // MAX distinct waves; beyond this they coalesce (see coalesceWaves)
  startHeight: number;     // px — how far above the card the descend ribbon starts
  dropMs: number;          // ms — the fall
  retractMs: number;       // ms — the ribbon withdrawing after it lands
  baseWidth: number;       // px — ribbon width at the top
  tipWidth: number;        // px — ribbon width at the tip
  coreAlpha: number;       // 0..1 — ribbon opacity (the read is mostly carried by the landing pulse)
  ringCount: number;       // landing pulse: shockwave rings
  ringSize: number;        // px radius
  ringWidth: number;       // px stroke
  ringMs: number;          // ms — ring expand + fade
  coreFlashSize: number;   // px radius — the landing core flash
  coreFlashMs: number;     // ms — core flash lifetime
  sparkCount: number;      // landing sparks
  sparkSpeed: number;      // px/s — spark speed
  sparkSize: number;       // px — spark size
  sparkLife: number;       // ms — spark lifetime
}

const D = DESCEND_PRESETS.default!;

const DEFAULTS: BuffFxConfig = {
  waveGapMs: 150, waveMaxTotalMs: 900, waveMaxCount: 6,
  startHeight: D.startHeight, dropMs: D.dropMs, retractMs: D.retractMs,
  baseWidth: D.baseWidth, tipWidth: D.tipWidth, coreAlpha: D.coreAlpha,
  ringCount: D.pulse.ringCount, ringSize: D.pulse.ringSize, ringWidth: D.pulse.ringWidth, ringMs: D.pulse.ringMs,
  coreFlashSize: D.pulse.coreFlashSize, coreFlashMs: D.pulse.coreFlashMs,
  // Owner-tuned 2026-07-19: a denser but much FINER spark burst than the descend preset's (46 x 3px, vs
  // 60 x 7px) - the big sparks read as debris at wave scale, where three waves can overlap.
  sparkCount: 46, sparkSpeed: D.pulse.sparkSpeed, sparkSize: 3, sparkLife: D.pulse.sparkLife,
};

export const BUFFFX_KEYS = [
  'waveGapMs', 'waveMaxTotalMs', 'waveMaxCount',
  'startHeight', 'dropMs', 'retractMs', 'baseWidth', 'tipWidth', 'coreAlpha',
  'ringCount', 'ringSize', 'ringWidth', 'ringMs',
  'coreFlashSize', 'coreFlashMs',
  'sparkCount', 'sparkSpeed', 'sparkSize', 'sparkLife',
] as const satisfies readonly (keyof BuffFxConfig)[];

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const BUFFFX_RANGES: Partial<Record<keyof BuffFxConfig, [number, number, number]>> = {
  waveGapMs: [0, 600, 10], waveMaxTotalMs: [200, 3000, 50], waveMaxCount: [1, 20, 1],
  startHeight: [0, 300, 5], dropMs: [40, 1200, 10], retractMs: [0, 800, 10],
  baseWidth: [0, 200, 1], tipWidth: [0, 200, 1], coreAlpha: [0, 1, 0.01],
  ringCount: [0, 6, 1], ringSize: [0, 300, 5], ringWidth: [0, 30, 1], ringMs: [0, 1200, 10],
  coreFlashSize: [0, 300, 5], coreFlashMs: [0, 1200, 10],
  sparkCount: [0, 120, 1], sparkSpeed: [0, 900, 10], sparkSize: [1, 24, 1], sparkLife: [100, 2000, 10],
};

const KEY = 'ascent.bufffx';
// Dev-only persistence: production always renders the shipped DEFAULTS.
let cfg: BuffFxConfig = (() => {
  if (!import.meta.env.DEV) return { ...DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<BuffFxConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getBuffFxConfig(): BuffFxConfig {
  return cfg;
}
export function setBuffFxValue(key: keyof BuffFxConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetBuffFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The descend preset with the live tuner values folded over it — colors/blend stay with the preset so a
 *  future per-tribe look still works; only the dialed geometry/timing is overridden. */
export function tunedDescend(base: DescendPresetCfg): DescendPresetCfg {
  const c = cfg;
  return {
    ...base,
    startHeight: c.startHeight, dropMs: c.dropMs, retractMs: c.retractMs,
    baseWidth: c.baseWidth, tipWidth: c.tipWidth, coreAlpha: c.coreAlpha,
    pulse: {
      ...base.pulse,
      ringCount: c.ringCount, ringSize: c.ringSize, ringWidth: c.ringWidth, ringMs: c.ringMs,
      coreFlashSize: c.coreFlashSize, coreFlashMs: c.coreFlashMs,
      sparkCount: c.sparkCount, sparkSpeed: c.sparkSpeed, sparkSize: c.sparkSize, sparkLife: c.sparkLife,
    },
  };
}

/** The per-wave gap for an itemized reward with `waveCount` waves: the tuned minimum, squeezed only if the
 *  whole run would exceed `waveMaxTotalMs`. Returns 0 for a single wave (nothing to stagger). */
export function waveGapFor(waveCount: number): number {
  if (waveCount <= 1) return 0;
  const c = cfg;
  return Math.min(c.waveGapMs, Math.floor(c.waveMaxTotalMs / (waveCount - 1)));
}

/**
 * Collapse a wave list down to at most `waveMaxCount` groups.
 *
 * Capping the total DURATION was not enough. `waveGapFor` divides the budget by the wave count, so the gap
 * collapses as the count climbs — and an Attachment build reaches counts nobody designed for: a Beatbot
 * mirrors every weld onto itself, so it can carry ~28 attachments while its neighbours have 4, and
 * "+2/+2 per Attachment" then emits one wave per attachment level:
 *
 * ```
 * waves=4  -> gap 150ms   (designed for)
 * waves=30 -> gap  31ms   (a strobe — the exact smear the pacing was added to fix)
 * ```
 *
 * So the COUNT is capped too: beyond `waveMaxCount` the remaining waves are merged into the last group and
 * land together. The totals are identical (this is presentation only) — you just stop seeing 30 separate
 * pulses on one card. Returns groups of the original wave indices, in order.
 */
export function coalesceWaves<T>(waves: T[][]): T[][] {
  const max = Math.max(1, Math.round(cfg.waveMaxCount));
  if (waves.length <= max) return waves;
  const out = waves.slice(0, max - 1);
  out.push(waves.slice(max - 1).flat()); // everything past the cap pulses as one final wave
  return out;
}

/**
 * Collapse buff-FX events to ONE per (wave, target). K Brightwing Brokers each capture a source→target tendril
 * to every OTHER minion, so a single buy emits K×(M−1) events — each a per-frame-retessellated ribbon that
 * janks the shop with several Brokers up (owner report). A target's stats jump ONCE (the K buffs are summed in
 * the sim, and the +X/+Y float shows the total), so one tendril per target is the correct read AND cuts the FX
 * K-fold. Keyed by `(fxWave, target)`: untagged buffs (Brightwing — `fxWave` undefined, all share the 'u'
 * bucket) collapse to one tendril per target; tagged itemized-reward events dedupe only within their own wave,
 * so the between-wave stagger survives. First event per key wins. Pure + presentation-only — the sim's
 * `recruitBuffFx` is never mutated.
 */
export function coalesceBuffFxByTarget<T extends { targetUid: string; fxWave?: number }>(events: readonly T[]): T[] {
  const seen = new Set<string>();
  return events.filter((ev) => {
    const k = `${ev.fxWave ?? 'u'}:${ev.targetUid}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
