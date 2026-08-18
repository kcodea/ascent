/**
 * Combat speed AUTO-RAMP (owner ask 2026-08-18). Within a fight the replay eases UP from the player's Speed
 * slider (the base/starting speed) to a ceiling, then eases back DOWN to base for the finish, so long fights
 * stop dragging while the opening and the finishing blows still read at normal speed.
 *
 * Pure math here; the wiring (a rAF loop that samples this per frame) lives in useCombatReplay.ts. The ramp is
 * a MULTIPLIER LAYER — it never mutates the store's combatSpeed. Every number is dev-tunable via the SPEC.
 */
import type { TunerControl, TunerSpec } from './tunerSchema';

export interface CombatRampConfig {
  /** Hold at the starting speed for this long at the top of the fight. */
  graceMs: number;
  /** After the grace window, ease base → ceiling over this long. */
  rampUpMs: number;
  /** Absolute target speed to climb to (clamped ≤ 5× at the call site). */
  ceiling: number;
  /** Begin easing ceiling → base once estimated authored time-left drops below this. */
  tailMs: number;
}

export const COMBAT_RAMP_DEFAULTS: CombatRampConfig = {
  graceMs: 3600,
  rampUpMs: 10000,
  ceiling: 3,
  tailMs: 10000,
};

/** Smooth ease-in-out on [0,1]. */
function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function lerp(base: number, ceiling: number, t: number): number {
  return base + (ceiling - base) * smoothstep(t);
}

/**
 * Effective speed = min(up-curve, down-curve), clamped to [base, ceiling]. Taking the min composes the two
 * with no per-fight-length special-casing: a short fight's down-curve is low from frame one so it never
 * speeds up; a long fight climbs, cruises, then eases back down.
 */
export function rampSpeed(base: number, elapsedMs: number, remainingMs: number, cfg: CombatRampConfig): number {
  const ceiling = cfg.ceiling;
  if (base >= ceiling) return base; // slider already at/above target → nothing to ramp
  // Up-curve: base during grace, then ease to ceiling over rampUpMs.
  const up = elapsedMs <= cfg.graceMs
    ? base
    : lerp(base, ceiling, (elapsedMs - cfg.graceMs) / cfg.rampUpMs);
  // Down-curve: ceiling while there's time to spare, else ease to base as remaining → 0.
  const down = remainingMs >= cfg.tailMs
    ? ceiling
    : lerp(base, ceiling, remainingMs / cfg.tailMs);
  const s = Math.min(up, down);
  return s < base ? base : s > ceiling ? ceiling : s;
}

export interface AuthoredTimeline {
  /** Total authored (base-speed) ms for the whole fight, incl. the final hold. */
  totalMs: number;
  /** Estimated authored ms remaining once beat `beatIdx` is on screen (clamps to the ends). */
  remainingAt(beatIdx: number): number;
}

/**
 * Prefix-sum of the authored (base-speed) duration of every inter-beat gap, so "time remaining" is an O(1)
 * lookup per frame. `holdAt(next, prev)` is the base-speed hold BEFORE `next` shows (in the replay that is
 * `holdMs(next, prev, 1)`). Generic over the beat type so it is trivially testable with plain numbers.
 *
 * Estimate, not a stopwatch: a plain hold sum under-counts an attackExchange/lunge beat's internal timeline,
 * so it errs toward easing to base slightly EARLY — the safe direction. `tailMs` compensates. See the spec.
 */
export function buildAuthoredTimeline<T>(
  beats: T[],
  holdAt: (next: T, prev: T) => number,
  finalHoldMs: number,
): AuthoredTimeline {
  const cumulativeInto: number[] = new Array(beats.length);
  cumulativeInto[0] = 0;
  for (let k = 1; k < beats.length; k++) {
    cumulativeInto[k] = cumulativeInto[k - 1] + holdAt(beats[k]!, beats[k - 1]!);
  }
  const lastCum = beats.length > 0 ? cumulativeInto[beats.length - 1]! : 0;
  const totalMs = lastCum + finalHoldMs;
  return {
    totalMs,
    remainingAt(beatIdx: number): number {
      if (beats.length === 0) return totalMs;
      const i = beatIdx < 0 ? 0 : beatIdx >= beats.length ? beats.length - 1 : beatIdx;
      return totalMs - cumulativeInto[i]!;
    },
  };
}

// ---- Dev tuner plumbing (dev-only persistence; prod always uses DEFAULTS) --------------------------------

const KEY = 'ascent.combatrampcfg';
const RANGES: Record<keyof CombatRampConfig, [number, number, number]> = {
  graceMs: [0, 6000, 100],
  rampUpMs: [500, 10000, 100],
  ceiling: [1, 5, 0.1],
  tailMs: [0, 10000, 100],
};

let cfg: CombatRampConfig = (() => {
  if (!import.meta.env.DEV) return { ...COMBAT_RAMP_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...COMBAT_RAMP_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<CombatRampConfig>) : {}) };
  } catch {
    return { ...COMBAT_RAMP_DEFAULTS };
  }
})();

export function getCombatRampConfig(): CombatRampConfig {
  return cfg;
}

export function setCombatRampValue(key: keyof CombatRampConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetCombatRampConfig(): void {
  cfg = { ...COMBAT_RAMP_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const controls: TunerControl<Extract<keyof CombatRampConfig, string>>[] = [
  { key: 'graceMs', label: 'Grace hold', unit: 'ms', hint: 'How long each fight stays at the starting speed before it begins to accelerate.', group: 'Speed ramp', min: RANGES.graceMs[0], max: RANGES.graceMs[1], step: RANGES.graceMs[2] },
  { key: 'rampUpMs', label: 'Ramp-up', unit: 'ms', hint: 'How long the climb from starting speed up to the ceiling takes, after the grace hold.', group: 'Speed ramp', min: RANGES.rampUpMs[0], max: RANGES.rampUpMs[1], step: RANGES.rampUpMs[2] },
  { key: 'ceiling', label: 'Ceiling', unit: '×', hint: 'The top speed the ramp climbs to. Capped at 5×; ignored if the slider is already above it.', group: 'Speed ramp', min: RANGES.ceiling[0], max: RANGES.ceiling[1], step: RANGES.ceiling[2] },
  { key: 'tailMs', label: 'Ease-down tail', unit: 'ms', hint: 'When estimated time-left in the fight drops below this, ease back to the starting speed for the finish.', group: 'Speed ramp', min: RANGES.tailMs[0], max: RANGES.tailMs[1], step: RANGES.tailMs[2] },
];

export const SPEC: TunerSpec<CombatRampConfig> = {
  id: 'combatramp',                // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Speed Ramp',
  note: 'dev · live · needs auto-ramp ON',
  read: getCombatRampConfig,
  write: (key, value) => setCombatRampValue(key, value as number),
  reset: resetCombatRampConfig,
  defaults: COMBAT_RAMP_DEFAULTS,
  controls,
};
