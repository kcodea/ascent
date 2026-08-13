/**
 * BEAT SYSTEM PR 6 — the pure beat-timeline scheduler.
 *
 * Turns a flat PresentationBatch into an ordered list of scheduled beats (one per source trigger, with its
 * consequences), each assigned a start/hold/end on a simple sequential timeline keyed by presentation policy.
 * Pure + deterministic so it unit-tests cleanly and the RecruitBeatPlayer can read an immutable schedule at
 * play start (blueprint §14). Timings here are restrained defaults — the numeric/drag editor (a later PR) will
 * make them tunable; nothing here touches the live shop animation.
 */
import type { ConsequenceEvent, GamePresentationEvent, PresentationBatch, PresentationPolicy, SourceTriggerEvent } from '@game/core';

export interface BeatTiming { windupMs: number; holdMs: number; recoveryMs: number }

/** Restrained per-policy defaults (ms). ownBeat reads as a deliberate pause; foldedCue barely holds. */
export const DEFAULT_TIMING: Record<PresentationPolicy, BeatTiming> = {
  ownBeat: { windupMs: 120, holdMs: 420, recoveryMs: 170 },
  foldedCue: { windupMs: 0, holdMs: 160, recoveryMs: 60 },
  passive: { windupMs: 0, holdMs: 0, recoveryMs: 0 },
  intentionallySilent: { windupMs: 0, holdMs: 0, recoveryMs: 0 },
};

export interface ScheduledBeat {
  id: string;
  trigger: SourceTriggerEvent;
  consequences: ConsequenceEvent[];
  startMs: number;
  /** When the consequence lands (start + windup). */
  consequenceMs: number;
  /** When the beat stops being the active/highlighted one (start + windup + hold). */
  endMs: number;
  /** endMs + recovery — when the NEXT beat begins. */
  nextMs: number;
}

const isTrigger = (e: GamePresentationEvent): e is SourceTriggerEvent => e.type === 'sourceTrigger';

/**
 * Schedule a batch's triggers sequentially. Consequences attach to their `parentId` trigger; a consequence
 * with no live parent is ignored here (the static viewer lists those separately). Order follows the batch's
 * emission order, which already reflects resolution order (steps non-decreasing).
 */
export function scheduleBeats(
  batch: PresentationBatch,
  timing: Record<PresentationPolicy, BeatTiming> = DEFAULT_TIMING,
): { beats: ScheduledBeat[]; totalMs: number } {
  const consByParent = new Map<string, ConsequenceEvent[]>();
  for (const e of batch.events) {
    if (!isTrigger(e) && e.parentId) {
      (consByParent.get(e.parentId) ?? consByParent.set(e.parentId, []).get(e.parentId)!).push(e);
    }
  }
  const beats: ScheduledBeat[] = [];
  let cursor = 0;
  for (const e of batch.events) {
    if (!isTrigger(e)) continue;
    const t = timing[e.policy] ?? DEFAULT_TIMING.ownBeat;
    const startMs = cursor;
    const consequenceMs = startMs + t.windupMs;
    const endMs = consequenceMs + t.holdMs;
    const nextMs = endMs + t.recoveryMs;
    beats.push({ id: e.id, trigger: e, consequences: consByParent.get(e.id) ?? [], startMs, consequenceMs, endMs, nextMs });
    cursor = nextMs;
  }
  return { beats, totalMs: cursor };
}

/** The beat active at time `ms` (the last beat whose window has started), or -1 before the first. */
export function activeBeatIndex(beats: readonly ScheduledBeat[], ms: number): number {
  let idx = -1;
  for (let i = 0; i < beats.length; i++) {
    if (beats[i]!.startMs <= ms) idx = i;
    else break;
  }
  return idx;
}
