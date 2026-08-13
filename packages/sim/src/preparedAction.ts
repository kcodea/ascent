/**
 * BEAT CHOREOGRAPHER PR 3 — the prepared presentation transaction (blueprint §5).
 *
 * THE problem this solves: `faceOmen` resolves End of Turn, builds the combat, simulates it and flips the
 * phase — all in one action. So the moment it is dispatched the recruit screen is gone and every End-of-Turn
 * number has already changed. The old UI worked around that by PROJECTING the End of Turn (a second,
 * hand-maintained model of what the reducer was about to do), animating the projection, and only then
 * dispatching for real. That is the duplicate-truth this whole pivot exists to delete.
 *
 * The fix is not to split `faceOmen` into prepare/commit GAMEPLAY actions — the blueprint is explicit that
 * doing so would change the replay format, RNG consumption, opponent pinning and telemetry (§5.1). Instead the
 * action resolves ONCE, right now, and the UI holds the result in an ephemeral transaction while it animates
 * the emitted batch, then commits the already-resolved state.
 *
 *   dispatch(faceOmen)            resolve → commit immediately            (every other action)
 *   prepare(faceOmen) → animate → commit the SAME resolved state          (End of Turn)
 *
 * `before` stays renderable the whole time, so the recruit scene never unmounts mid-animation.
 *
 * This object is EPHEMERAL and must never be serialized into a save (§5.7): a run autosaves only committed
 * state, so a reload mid-animation simply replays the deterministic action.
 */
import type { PresentationBatch } from '@game/core';
import { reduceWithPresentation } from './reducer';
import type { Action, RunState } from './state';

export interface PreparedPresentationAction {
  /**
   * Deterministic identity — NEVER time or a uuid, so the same resolution is recognisable across a reload and
   * two prepares of the same action can't be confused for different transactions.
   */
  id: string;
  action: Action;
  /** The state still on screen while the timeline plays. */
  before: RunState;
  /** The already-resolved result, committed when playback finishes. */
  after: RunState;
  batch: PresentationBatch | null;
}

/**
 * Resolve an action once and hold the result. The ONLY gameplay call here is the same
 * `reduceWithPresentation` an ordinary dispatch makes — so a prepared action's `after` is byte-identical to
 * dispatching it directly (asserted in `preparedAction.test.ts`).
 */
export function prepareActionWithPresentation(state: RunState, action: Action): PreparedPresentationAction {
  const { state: after, batch } = reduceWithPresentation(state, action, true);
  return {
    // wave + the action type identify the transaction within a run; both are deterministic.
    id: `${action.type}:w${state.wave}`,
    action,
    before: state,
    after,
    batch,
  };
}
