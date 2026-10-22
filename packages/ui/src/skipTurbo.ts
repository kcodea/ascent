/**
 * SKIP TURBO (owner ask 2026-10-22, R-SKIP-TURBO-01). Skip no longer jumps straight to the resolved board: it
 * fast-forwards the replay (up to `turboCeiling`, 20× by default) and brakes back down to the player's own speed
 * for the hit that DECIDES the fight, so the outcome still reads.
 *
 * Like the auto-ramp (combatRampConfig.ts) the speed is a function of the authored (1×) time left: a smooth climb
 * from the Skip press, then a slowdown aimed at the DECIDING beat. The slowdown is a constant-deceleration BRAKE
 * rather than the ramp's smoothstep tail: a smoothstep over authored time spends almost no REAL time at the high
 * speeds, so at 20× the whole ease-down passed in under half a second and the landing felt sudden (owner
 * 2026-10-22). Braking evenly over `turboBrakeMs` of real time reads as one steady slowdown, and `v² = b² + 2·a·r`
 * makes it land on the base speed exactly as the deciding hit begins, however much fight was left.
 * Pure math here; the wiring (the auto-ramp's rAF loop) lives in useCombatReplay.ts.
 */
import type { CombatEvent } from '@game/core';
import type { AuthoredTimeline, CombatRampConfig } from './combatRampConfig';

interface BeatLike {
  start: number;
  end: number;
  primary: CombatEvent;
}

/**
 * The index of the beat that DECIDES the fight: the beat holding the blow that kills the last body to die (the one
 * that empties a board), backed up to that swing's `attack` wind-up when the blow is a swing's clash, so the whole
 * lunge plays at normal speed. A Rise's first death is not a kill (the body returns) and never counts. A fight
 * with no death at all decides on its last beat.
 */
export function decisiveBeatIndex(beats: readonly BeatLike[], events: readonly CombatEvent[]): number {
  if (beats.length === 0) return 0;
  let deathAt = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'death' && !e.rise) { deathAt = i; break; }
  }
  if (deathAt < 0) return beats.length - 1;
  const victim = (events[deathAt] as Extract<CombatEvent, { type: 'death' }>).target;
  // The killing blow: the last damage that body took before it died (poison, a clash, an AoE), else the death.
  let blowAt = deathAt;
  for (let i = deathAt - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'dmg' && e.target === victim) { blowAt = i; break; }
  }
  let b = beats.findIndex((m) => blowAt >= m.start && blowAt < m.end);
  if (b < 0) b = beats.length - 1;
  // A swing's clash is the beat after its `attack` wind-up (with any wave volleys in between): start at the wind-up.
  let j = b - 1;
  while (j >= 0 && beats[j]!.primary.wave !== undefined) j--;
  if (j >= 0 && beats[j]!.primary.type === 'attack' && beats[b]!.primary.wave === undefined) return j;
  return b;
}

/** Authored (1× speed) ms left before beat `anchor` starts, with beat `beatIdx` about to play. `anchor` may be
 *  `beats.length` (the end of the fight, final hold included). Zero once the anchor is reached. */
export function remainingToAnchor(timeline: AuthoredTimeline, beatIdx: number, anchor: number, beatCount: number): number {
  if (beatIdx >= anchor) return 0;
  const toEnd = timeline.remainingAt(beatIdx);
  const anchorToEnd = anchor >= beatCount ? 0 : timeline.remainingAt(anchor);
  return Math.max(0, toEnd - anchorToEnd);
}

/**
 * The authored time left to the anchor RIGHT NOW, not just at beat boundaries: while the clock waits to show beat
 * `beatIdx`, the replay is somewhere in the hold between the previous beat and it, and `heldMs` (authored ms played
 * since `beatIdx` was armed, i.e. real ms × speed) says where. Clamped to that hold, so a beat that runs longer than
 * its authored hold simply waits at the next beat's value. Without this the speed only moved once per beat, in steps.
 */
export function remainingNow(timeline: AuthoredTimeline, beatIdx: number, heldMs: number, anchor: number, beatCount: number): number {
  const lo = remainingToAnchor(timeline, beatIdx, anchor, beatCount);
  if (lo <= 0 || beatIdx <= 0) return lo;
  const hi = remainingToAnchor(timeline, beatIdx - 1, anchor, beatCount);
  return Math.min(hi, Math.max(lo, hi - heldMs));
}

/** Smooth ease-in-out on [0,1]. */
function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/**
 * The turbo's speed: a smooth climb from `base` to the ceiling over `turboRampUpMs` from the Skip press, capped by
 * the brake. The brake decelerates at a constant `a = (ceiling − base) / turboBrakeMs` per real ms, so with `r`
 * authored ms left the most speed that still stops in time is `√(base² + 2·a·r)`: the full ceiling while there is
 * room, then an even slowdown that is exactly `base` at r = 0. Never below `base`.
 */
export function skipTurboSpeed(base: number, elapsedMs: number, remainingMs: number, cfg: CombatRampConfig): number {
  const ceiling = cfg.turboCeiling;
  if (base >= ceiling) return base;
  const up = base + (ceiling - base) * smoothstep(elapsedMs / Math.max(1, cfg.turboRampUpMs));
  const a = (ceiling - base) / Math.max(1, cfg.turboBrakeMs);
  const brake = Math.sqrt(base * base + 2 * a * Math.max(0, remainingMs));
  const s = Math.min(up, brake, ceiling);
  return s < base ? base : s;
}

/** 0 at the base speed, 1 at the ceiling: how far into the turbo the replay is (drives the whir's pitch + level). */
export function turboAmount(speed: number, base: number, cfg: CombatRampConfig): number {
  const span = cfg.turboCeiling - base;
  if (span <= 0) return 0;
  const t = (speed - base) / span;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
