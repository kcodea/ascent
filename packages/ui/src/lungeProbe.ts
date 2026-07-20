import type { StrikeBand } from './lungeConfig';

/**
 * A DEV ring buffer of the DERIVED numbers behind recent lunges, so the Lunge tuner can show what the
 * distance→duration and angle→tilt functions actually produced — across the vectors combat served, not a
 * synthetic preview.
 *
 * Why this exists instead of a per-pairing preview grid: there is no stable pairing key. The board `.row` is
 * centre-justified, so a 6-card side seats differently from a 7-card side, and both rows re-centre mid-combat
 * as units die — the same nominal "slot 3 → slot 5" is a different vector before and after a death. The only
 * thing worth inspecting is the function's OUTPUT over the vectors that really occur, which is exactly what
 * this records.
 *
 * Off by default: `recordLunge` early-returns unless the tuner has enabled it, so the shipped path costs one
 * boolean test per swing and keeps no memory.
 */
export interface LungeSample {
  /** Monotonic sequence — the tuner keys rows off this. */
  seq: number;
  /** Centre-to-centre distance (px). */
  dist: number;
  /** Surface-to-surface travel (px) — what the duration derives from. */
  travel: number;
  /** Resolved strike duration (s), after clamping. */
  strikeDur: number;
  /** Which duration clamp this vector hit, if any. */
  clamped: 'min' | 'max' | null;
  /** Signed approach angle off horizontal (deg). */
  approachDeg: number;
  /** Resolved lead tilt (deg). */
  leadTilt: number;
  /** Which ease band the travel fell in. */
  band: StrikeBand;
  /** The GSAP ease string that band resolved to. */
  ease: string;
}

const MAX = 60;
let enabled = false;
let seq = 0;
let samples: LungeSample[] = [];
const listeners = new Set<() => void>();

/** The tuner turns recording on while it is mounted, and off when it closes. */
export function setLungeProbeEnabled(on: boolean): void {
  enabled = on;
  if (!on) return;
  emit();
}

export function recordLunge(s: Omit<LungeSample, 'seq'>): void {
  if (!enabled) return;
  seq += 1;
  samples = [{ ...s, seq }, ...samples].slice(0, MAX);
  emit();
}

export function getLungeSamples(): LungeSample[] {
  return samples;
}

export function clearLungeSamples(): void {
  samples = [];
  seq = 0;
  emit();
}

export function subscribeLungeProbe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tally of how often each duration clamp bound was hit across the buffer. A high `max` count is the signal
 *  that `maxStrikeDur` is flattening the long strikes to one speed. */
export function lungeClampTally(): { min: number; max: number; total: number } {
  let min = 0;
  let max = 0;
  for (const s of samples) {
    if (s.clamped === 'min') min += 1;
    else if (s.clamped === 'max') max += 1;
  }
  return { min, max, total: samples.length };
}

function emit(): void {
  for (const fn of listeners) fn();
}
