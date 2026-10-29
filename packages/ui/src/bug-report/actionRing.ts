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
 * COST: recording is a push and an action clone. The hashes (one `hashRunState` per entry still in the ring; the
 * before-hash reuses the previous entry's after-hash via an identity cache) are paid at Ctrl+B only.
 *
 * OFF THE FRAME (perf 2026-09-17): the hash is a JSON round-trip + stable-stringify of the WHOLE run — 5–15 ms
 * late-game, and it ran inside the dispatch's `store:set`, i.e. inside the frame the click dropped. The entry
 * is pushed synchronously (so the ring's ORDER and capacity are exactly as before) with its two states held.
 *
 * ONLY WHEN READ (perf degradation hunt 2026-10-29, R-PERF-RING-LAZY-01): the hashes used to be filled in on idle
 * time, but "idle" still runs on the main thread, and one idle callback drained the whole ring. The whole-run hash
 * grows with the game (the fight's event log rides in `lastCombat`), and a late fight's display-only preview
 * actions (one per friendly death / spell cast) refilled the ring every fight, so a 30-50 ms idle task landed in
 * the middle of late combats, longer every round. Nothing reads a hash before `snapshotActionWindow` (Ctrl+B), so
 * that is now the only place they are computed. An entry that falls off the ring is never hashed at all. Safe
 * because the reducer never mutates a state it has returned (it clones; `lastCombat` / `servedBoards` are only
 * ever replaced), so a hash taken at Ctrl+B equals the one an idle callback would have taken.
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
  /** The states whose hashes are still owed — cleared once `hashPending` has filled the window in. */
  pending: { before: RunState; after: RunState } | null;
}

let ring: RingEntry[] = [];

/** Identity cache: the last recorded after-state and its hash, so the next entry's before-hash is free when
 *  nothing else replaced the run between commits (the common case — every ordinary dispatch). */
let lastAfter: RunState | null = null;
let lastAfterHash = '';

export function recordActionEntry(before: RunState, action: Action, after: RunState, batch: PresentationBatch | null): void {
  if (after === before) return; // rejected — the ring mirrors replayActions: accepted actions only
  try {
    ring.push({
      runId: `${before.seed}:${before.heroId}`,
      window: {
        action: structuredClone(action),
        rngCursorBefore: before.rngCursor,
        stateHashBefore: '',
        stateHashAfter: '',
      },
      batch,
      pending: { before, after },
    });
    if (ring.length > ACTION_RING_SIZE) ring.splice(0, ring.length - ACTION_RING_SIZE);
  } catch {
    // Diagnostics must never break the commit path — a failed record simply shortens the window.
  }
}

/** Fill in every owed hash, oldest first — the identity cache works exactly as it did synchronously, because
 *  the entries are walked in commit order. */
function hashPending(): void {
  for (const e of ring) {
    const p = e.pending;
    if (!p) continue;
    try {
      e.window.stateHashBefore = p.before === lastAfter ? lastAfterHash : hashRunState(p.before);
      e.window.stateHashAfter = hashRunState(p.after);
      lastAfter = p.after;
      lastAfterHash = e.window.stateHashAfter;
    } catch {
      // A failed hash leaves the rails blank for that entry — the capsule still carries the action.
    }
    e.pending = null;
  }
}
/** Compute any hash still owed, synchronously. Every reader below calls this first; tests may call it directly. */
export function flushActionRing(): void { hashPending(); }

/** How many entries still owe their hashes (the regression test: recording must never hash). */
export function owedActionHashes(): number { return ring.reduce((n, e) => n + (e.pending ? 1 : 0), 0); }

/** The contiguous tail of entries belonging to `runId` (a previous run's leftovers never leak into another
 *  run's capsule). Returns the SHARED window objects — callers that persist them must clone (the capture
 *  path structuredClones + freezes its copy). */
export function snapshotActionWindow(runId: string): RecordedActionWindow[] {
  flushActionRing();
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
