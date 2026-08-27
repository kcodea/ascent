/**
 * DOC BOT 2.0 WP C — the ALWAYS-ON rolling action window (blueprint §8.2, canonical-schemas.md §4.5).
 *
 * A small fixed-size ring of the last N ACCEPTED actions, each with its observational reproduction rails:
 * rng cursor before, state hash before/after (plus, in DEV, the presentation batch for the dev panels).
 * This replaces the DEV-only capture gate for the ROLLING-WINDOW purpose only — in PROD the ring still
 * records (rails are cheap state reads + one FNV-1a hash), so a player bug capsule carries per-action
 * reproduction material; presentation batches stay DEV-gated exactly as before.
 *
 * DISCIPLINE (owner decision 2026-08-26, same as the capsule): memory-only, NEVER in `RunState`, saves,
 * `replayActions`, or replay frames. Copied into the bug capsule at Ctrl+B (`snapshotActionWindow`) exactly
 * like frames are. Recording is PURELY OBSERVATIONAL — it reads the before/after states the commit path
 * already holds, calls no rng, and mutates nothing (the sim-side traceNeutrality lane proves the rails'
 * helpers inert; recording rides AFTER `reduce` resolved, so it cannot perturb resolution by construction).
 *
 * COST: one `hashRunState` per accepted action (the before-hash reuses the previous entry's after-hash via
 * an identity cache), at human click cadence — never per frame. Measured in the WP C PR notes.
 */
import { hashRunState, type Action, type RecordedActionWindow, type RunState } from '@game/sim';
import type { PresentationBatch } from '@game/core';

/** Ring capacity — sized like the capsule's two-wave frame window: comfortably more accepted actions than a
 *  long shop turn produces, small enough that the capsule copy is a few KB. The tuning knob (§18-C). */
export const ACTION_RING_SIZE = 32;

interface RingEntry {
  runId: string;
  window: RecordedActionWindow;
  /** DEV only (null in prod) — the action's presentation batch, for dev panels. Never serialized. */
  batch: PresentationBatch | null;
}

let ring: RingEntry[] = [];

/** Identity cache: the last recorded after-state and its hash, so the next entry's before-hash is free when
 *  nothing else replaced the run between commits (the common case — every ordinary dispatch). */
let lastAfter: RunState | null = null;
let lastAfterHash = '';

export function recordActionEntry(before: RunState, action: Action, after: RunState, batch: PresentationBatch | null): void {
  if (after === before) return; // rejected — the ring mirrors replayActions: accepted actions only
  try {
    const stateHashBefore = before === lastAfter ? lastAfterHash : hashRunState(before);
    const stateHashAfter = hashRunState(after);
    lastAfter = after;
    lastAfterHash = stateHashAfter;
    ring.push({
      runId: `${before.seed}:${before.heroId}`,
      window: {
        action: structuredClone(action),
        rngCursorBefore: before.rngCursor,
        stateHashBefore,
        stateHashAfter,
      },
      batch,
    });
    if (ring.length > ACTION_RING_SIZE) ring.splice(0, ring.length - ACTION_RING_SIZE);
  } catch {
    // Diagnostics must never break the commit path — a failed record simply shortens the window.
  }
}

/** The contiguous tail of entries belonging to `runId` (a previous run's leftovers never leak into another
 *  run's capsule). Returns the SHARED window objects — callers that persist them must clone (the capture
 *  path structuredClones + freezes its copy). */
export function snapshotActionWindow(runId: string): RecordedActionWindow[] {
  const out: RecordedActionWindow[] = [];
  for (let i = ring.length - 1; i >= 0 && ring[i]!.runId === runId; i--) out.unshift(ring[i]!.window);
  return out;
}

/** DEV panels: the batches riding the same tail (null entries in prod). Parallel to `snapshotActionWindow`. */
export function snapshotActionBatches(runId: string): (PresentationBatch | null)[] {
  const out: (PresentationBatch | null)[] = [];
  for (let i = ring.length - 1; i >= 0 && ring[i]!.runId === runId; i--) out.unshift(ring[i]!.batch);
  return out;
}

/** Test hook / hard reset. The ring otherwise self-cleans: capacity + the runId tail filter. */
export function resetActionRing(): void {
  ring = [];
  lastAfter = null;
  lastAfterHash = '';
}
