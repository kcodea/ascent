/**
 * BEAT CHOREOGRAPHER PR 4 — the timeline player (blueprint §12).
 *
 * ONE clock drives the whole phase. The old End-of-Turn animation used a chain of `setTimeout`s per UI
 * feature, which is why its pacing lived in two hardcoded constants and could not be tuned, sought, or
 * previewed. Here the timeline is the schedule and the player just crosses markers on it.
 *
 * The invariant that actually prevents dropped effects:
 *
 *   > Deliver every marker in the half-open window `(previousMs, currentMs]`.
 *
 * Never "the marker nearest this frame". Frames are not guaranteed — a background tab, a GC pause or a slow
 * frame can skip 300ms, and a per-frame equality check would silently drop every consequence inside it. The
 * window makes playback correct at any frame rate, which also means playback speed cannot change WHAT
 * happens, only how fast (§18.1).
 *
 * Pure and injectable: the clock source is a parameter, so the tests drive it deterministically with no
 * timers, no `requestAnimationFrame`, and no wall-clock flakiness.
 */
import type { ConsequenceEvent } from '@game/core';
import { EMPTY_PROJECTION, applyConsequenceToProjection, projectionAt, type PresentationProjection } from './projection';
import type { CompiledBeat, CompiledConsequenceDelivery, CompiledTimeline } from './timelineTypes';

export interface TimelinePlayerCallbacks {
  /** A source beat became visible — fire its source cue (medallion pulse, rune tendril…). */
  onBeatActivate?: (beat: CompiledBeat) => void;
  /** A consequence landed — update visuals. NEVER dispatch gameplay from here (§25). */
  onConsequence?: (delivery: CompiledConsequenceDelivery, projection: PresentationProjection) => void;
  /** A beat finished being readable. */
  onBeatComplete?: (beat: CompiledBeat) => void;
  /** The projection changed — re-render. Called once per advance, not once per delivery. */
  onProjection?: (projection: PresentationProjection) => void;
  /** Playback reached the end. The caller COMMITS the prepared action here. */
  onComplete?: () => void;
}

export interface TimelinePlayer {
  /** Advance to an absolute timeline position. Idempotent for a position already passed. */
  advanceTo: (ms: number) => void;
  /** Jump anywhere, rebuilding the projection by folding from zero (backward-safe). */
  seek: (ms: number) => void;
  /** Deliver everything remaining and fire `onComplete` — the skip button, and the unmount safety net. */
  finish: () => void;
  /** Current projection. */
  projection: () => PresentationProjection;
  playheadMs: () => number;
  isComplete: () => boolean;
}

export function createTimelinePlayer(timeline: CompiledTimeline, callbacks: TimelinePlayerCallbacks = {}): TimelinePlayer {
  let playheadMs = -1; // -1 so a marker at exactly 0 is inside the first window
  let projection: PresentationProjection = EMPTY_PROJECTION;
  let complete = false;
  const activated = new Set<string>();
  const completed = new Set<string>();

  const beats = timeline.beats;
  const deliveries = timeline.consequenceDeliveries;

  const crossForward = (fromMs: number, toMs: number): void => {
    let changed = false;
    // Beat activations. A silent beat still activates (its consequences must land) but a presenter can
    // choose to draw nothing for it.
    for (const b of beats) {
      if (b.startMs > fromMs && b.startMs <= toMs && !activated.has(b.id)) {
        activated.add(b.id);
        callbacks.onBeatActivate?.(b);
      }
    }
    for (const d of deliveries) {
      if (d.atMs > fromMs && d.atMs <= toMs) {
        projection = applyConsequenceToProjection(projection, d.consequence.payload as ConsequenceEvent);
        changed = true;
        callbacks.onConsequence?.(d, projection);
      }
    }
    for (const b of beats) {
      if (b.completionMs > fromMs && b.completionMs <= toMs && !completed.has(b.id)) {
        completed.add(b.id);
        callbacks.onBeatComplete?.(b);
      }
    }
    if (changed) callbacks.onProjection?.(projection);
  };

  const finishOnce = (): void => {
    if (complete) return;
    complete = true;
    callbacks.onComplete?.();
  };

  return {
    advanceTo: (ms) => {
      if (ms <= playheadMs) return;
      const from = playheadMs;
      playheadMs = ms;
      crossForward(from, ms);
      if (ms >= timeline.durationMs) finishOnce();
    },
    seek: (ms) => {
      // Backward seek rebuilds rather than undoing — there is no partial state to get wrong that way.
      if (ms < playheadMs) {
        activated.clear();
        completed.clear();
        projection = projectionAt(timeline, ms);
        for (const b of beats) {
          if (b.startMs <= ms) activated.add(b.id);
          if (b.completionMs <= ms) completed.add(b.id);
        }
        playheadMs = ms;
        complete = false;
        callbacks.onProjection?.(projection);
        return;
      }
      const from = playheadMs;
      playheadMs = ms;
      crossForward(from, ms);
      if (ms >= timeline.durationMs) finishOnce();
    },
    finish: () => {
      // Deliver EVERYTHING still pending, then complete. This is the skip path and the unmount safety net:
      // the blueprint's hard rule is that a skip must produce the same state as watching (§5.6), and it does
      // because the state was already resolved — only its presentation is being fast-forwarded.
      const from = playheadMs;
      playheadMs = Math.max(playheadMs, timeline.durationMs);
      crossForward(from, Number.POSITIVE_INFINITY);
      finishOnce();
    },
    projection: () => projection,
    playheadMs: () => playheadMs,
    isComplete: () => complete,
  };
}

/**
 * Drive a player from `requestAnimationFrame`, scaled by `speed`. Returns a cancel function that MUST be
 * called on unmount — an orphaned rAF loop holding a prepared transaction is how End Turn would softlock.
 *
 * `speed` scales the outer beat timing only. It never rewrites authored FX timing (§12.6).
 */
export function runTimeline(
  player: TimelinePlayer,
  options: { speed?: number; now?: () => number; raf?: (cb: () => void) => number; cancel?: (h: number) => void } = {},
): () => void {
  const speed = Math.max(0.1, options.speed ?? 1);
  const now = options.now ?? (() => performance.now());
  const raf = options.raf ?? ((cb) => requestAnimationFrame(() => cb()));
  const cancel = options.cancel ?? ((h) => cancelAnimationFrame(h));

  const startedAt = now();
  let handle = 0;
  let stopped = false;

  const tick = (): void => {
    if (stopped) return;
    player.advanceTo((now() - startedAt) * speed);
    if (player.isComplete()) return;
    handle = raf(tick);
  };
  handle = raf(tick);

  return () => {
    if (stopped) return;
    stopped = true;
    cancel(handle);
  };
}
