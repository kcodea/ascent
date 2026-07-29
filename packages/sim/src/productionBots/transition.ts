import { reduce } from '../reducer';
import type { Action, RunState } from '../state';
import { fingerprint, toBotVisibleState } from './visibleState';
import type { BotVisibleState, PlanningStateHandle, PlanningTransition, RevealBoundary } from './types';

/**
 * THE ONLY MODULE THAT MAY CALL `reduce()` DURING SEARCH.
 *
 * `reduce()` is authoritative but hostile to speculation: its wrapper writes to its INPUT before `reduceCore()`
 * clones — it resets `recruitBuffFx` and `auraFx`, stamps `weldFxBaseSeq`, and (the dangerous one) PINS this
 * wave's opponent into `servedBoards`. Calling it on the live run to "just try" an action would therefore
 * decide the player's next fight as a side effect of thinking about it, and calling it on a shared node would
 * corrupt every sibling candidate.
 *
 * So a planning state is never handed out. Callers get an opaque `PlanningStateHandle`; the `RunState` behind it
 * lives only in this module's store, and every expansion clones the parent before touching the reducer.
 *
 * Handles are reference-counted by the caller via `release()`. A search that forgets leaks memory but nothing
 * worse — the store is per-decision and `releaseAll()` drops the lot.
 */

const STORE = new Map<string, RunState>();
let nextId = 0;

/** Deep-clone a planning state. `lastCombat` is large, read-only and irrelevant to a shop decision, so it is
 *  dropped rather than copied — the same trick the reducer uses, for the same reason. */
function clonePlanning(s: RunState): RunState {
  const rest = { ...s };
  delete (rest as { lastCombat?: unknown }).lastCombat;
  return structuredClone(rest) as RunState;
}

/**
 * Take a private snapshot of the live run to plan against. The caller's state is never retained or mutated —
 * the clone happens here, before anything else can touch it.
 */
export function createPlanningRoot(run: RunState): PlanningStateHandle {
  const id = `p${nextId++}`;
  STORE.set(id, clonePlanning(run));
  return { id };
}

/** The redacted view of a handle. The only way to look at a planning state from outside this module. */
export function visibleOf(handle: PlanningStateHandle): BotVisibleState {
  const s = STORE.get(handle.id);
  if (!s) throw new Error(`planning handle ${handle.id} has been released`);
  return toBotVisibleState(s);
}

/**
 * Which actions hand the bot information it does not already hold.
 *
 * This is the fairness rule, and it is not about determinism — the engine being seeded is exactly what makes it
 * necessary. A search could clone, apply `roll`, read the resulting shop, and only then decide whether to
 * refresh. That is reading the future. Search must therefore STOP at these actions and score them with an
 * expectation model over what the bot legally knows (pool composition, tier), never by expanding the result.
 */
export function revealOf(action: Action): RevealBoundary | null {
  switch (action.type) {
    case 'roll':
      return { kind: 'refresh', because: 'a refresh draws a shop the bot has not seen' };
    case 'rerollRuneforge':
      return { kind: 'forge', because: 'a forge reroll draws runes the bot has not seen' };
    case 'buyRune':
      return { kind: 'forge', because: 'forging can grant randomly and re-opens the offer' };
    case 'buyQuest':
      return { kind: 'randomGrant', because: 'a quest reward can generate cards the bot has not seen' };
    default:
      return null;
  }
}

/**
 * Apply one candidate to a PRIVATE clone of the parent and return the child.
 *
 * `changed: false` means the reducer rejected it — `reduce()` signals a no-op by returning its input, so
 * identity is the check. A rejected candidate still yields a handle (pointing at an unchanged clone) so callers
 * can treat every candidate uniformly instead of branching on null.
 */
export function applyCandidate(parent: PlanningStateHandle, action: Action): PlanningTransition {
  const base = STORE.get(parent.id);
  if (!base) throw new Error(`planning handle ${parent.id} has been released`);
  // Clone FIRST. `reduce()` mutates whatever it is handed, so passing `base` would corrupt the parent node and
  // every sibling expanded from it.
  const own = clonePlanning(base);
  const next = reduce(own, action);
  const changed = next !== own;
  const id = `p${nextId++}`;
  STORE.set(id, next);
  const visible = toBotVisibleState(next);
  return {
    changed,
    child: { id },
    visible,
    fingerprint: fingerprint(visible),
    reveal: revealOf(action),
  };
}

/** Drop a handle's state. Safe to call twice. */
export function release(handle: PlanningStateHandle): void {
  STORE.delete(handle.id);
}

/** Drop every handle — call between decisions so planning memory can't accumulate across turns. */
export function releaseAll(): void {
  STORE.clear();
}

/** Live handle count, for the performance gates in Ticket 9. */
export function liveHandleCount(): number {
  return STORE.size;
}

/**
 * TEST ONLY — the raw state behind a handle. Named to make misuse obvious in review.
 *
 * The isolation guarantee cannot be verified through `visibleOf()`: the fields `reduce()` corrupts on its input
 * are `recruitBuffFx`, `auraFx`, `weldFxBaseSeq` and `servedBoards`, and every one of them is deliberately
 * REDACTED from `BotVisibleState`. Checking for the damage through the projection means checking through a lens
 * built to hide it — which is exactly what happened: removing the defensive clone from `applyCandidate` left
 * every isolation test passing.
 *
 * Nothing outside a test may call this. The module-boundary test enforces the rest.
 */
export function __unsafeStateForTests(handle: PlanningStateHandle): RunState | undefined {
  return STORE.get(handle.id);
}
