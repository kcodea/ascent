/**
 * BEAT SYSTEM PR 2 — the deterministic presentation collector (blueprint §8.3–8.5).
 *
 * A mutation site opens a trigger scope, mutates gameplay, and emits consequences; the collector stamps
 * deterministic ids, the current step, and the active parent id, and returns an ordered PresentationBatch.
 * Two shapes:
 *   - `makeCollector(actionId, phase)` — the real recorder.
 *   - `NOOP_COLLECTOR` — a zero-allocation stand-in for headless bots / balance sims / gameplay-only reducer
 *     calls, so instrumented mutation helpers cost nothing when nobody is watching (blueprint §23).
 *
 * The collector NEVER touches gameplay state — it only records. Determinism is structural: ids come from a
 * batch-local counter, so the same resolution always produces byte-identical events (no time/random).
 */
import type {
  BeginTriggerSpec,
  ConsequenceDraft,
  ConsequenceEvent,
  GamePresentationEvent,
  PresentationBatch,
  PresentationPhase,
  SourceTriggerEvent,
  TriggerSourceRef,
} from './events';

export interface TriggerHandle {
  id: string;
  step: number;
  source: TriggerSourceRef;
}

export interface PresentationCollector {
  /** Open a trigger scope; consequences emitted until it closes inherit its id. */
  beginTrigger(spec: BeginTriggerSpec): TriggerHandle;
  /** Close the most recently opened trigger scope. */
  endTrigger(handle: TriggerHandle): void;
  /** Run `fn` inside a trigger scope (auto-closes even if `fn` throws). */
  withTrigger<T>(spec: BeginTriggerSpec, fn: () => T): T;
  /** Emit a consequence, attributed to the active trigger scope. */
  emit(draft: ConsequenceDraft): void;
  /** Advance the resolution step manually (for boundaries not tied to a trigger). */
  nextStep(): number;
  /** The active step (for callers that need to tag their own data). */
  currentStep(): number;
  /** Finish and return the batch (null if nothing was recorded). */
  finish(): PresentationBatch | null;
  /** True for the no-op collector, so hot paths can skip building drafts entirely. */
  readonly enabled: boolean;
}

/** The do-nothing collector. Every method is a cheap no-op; `enabled` is false so callers can short-circuit. */
export const NOOP_COLLECTOR: PresentationCollector = {
  enabled: false,
  beginTrigger: (spec) => ({ id: '', step: 0, source: spec.source }),
  endTrigger: () => {},
  withTrigger: (_spec, fn) => fn(),
  emit: () => {},
  nextStep: () => 0,
  currentStep: () => 0,
  finish: () => null,
};

export function makeCollector(actionId: string, phase: PresentationPhase): PresentationCollector {
  const events: GamePresentationEvent[] = [];
  const triggerStack: TriggerHandle[] = [];
  let seq = 0;
  let step = 0;

  const id = (kind: 'trigger' | 'event'): string => `${kind}:${actionId}:${seq}`;
  const activeParent = (): string | undefined => triggerStack[triggerStack.length - 1]?.id;

  const beginTrigger = (spec: BeginTriggerSpec): TriggerHandle => {
    if (spec.boundary !== 'currentStep') step += 1;
    const parentId = activeParent();
    const ev: SourceTriggerEvent = {
      type: 'sourceTrigger',
      id: id('trigger'),
      sequence: seq,
      step,
      phase: spec.phase,
      source: spec.source,
      trigger: spec.trigger,
      policy: spec.policy,
      // CHOREOGRAPHER (§7.2): identity fields ride through VERBATIM. The collector never infers them — if
      // gameplay didn't supply a policyKey, the event says so honestly and the normalizer raises a
      // diagnostic, rather than presentation guessing an identity and silently mistiming the beat.
      ...(spec.policyKey ? { policyKey: spec.policyKey } : {}),
      ...(spec.family ? { family: spec.family } : {}),
      ...(spec.occurrenceKey ? { occurrenceKey: spec.occurrenceKey } : {}),
      ...(spec.dependencyIds?.length ? { dependencyIds: [...spec.dependencyIds] } : {}),
      ...(parentId ? { parentId } : {}),
      ...(spec.simultaneousGroupId ? { simultaneousGroupId: spec.simultaneousGroupId } : {}),
      ...(spec.repeatIndex !== undefined ? { repeatIndex: spec.repeatIndex } : {}),
      ...(spec.repeatCount !== undefined ? { repeatCount: spec.repeatCount } : {}),
    };
    seq += 1;
    events.push(ev);
    const handle: TriggerHandle = { id: ev.id, step, source: spec.source };
    triggerStack.push(handle);
    return handle;
  };

  const endTrigger = (handle: TriggerHandle): void => {
    // Tolerate imbalance defensively: pop until we've removed the given handle (or the stack empties), so a
    // missing endTrigger in one branch can't corrupt every later scope's parent attribution.
    while (triggerStack.length) {
      const top = triggerStack.pop();
      if (top === handle || top?.id === handle.id) break;
    }
  };

  const withTrigger = <T>(spec: BeginTriggerSpec, fn: () => T): T => {
    const handle = beginTrigger(spec);
    try {
      return fn();
    } finally {
      endTrigger(handle);
    }
  };

  const emit = (draft: ConsequenceDraft): void => {
    const parentId = activeParent();
    const ev = {
      ...draft,
      id: id('event'),
      sequence: seq,
      step,
      ...(parentId ? { parentId } : {}),
    } as ConsequenceEvent;
    seq += 1;
    events.push(ev);
  };

  return {
    enabled: true,
    beginTrigger,
    endTrigger,
    withTrigger,
    emit,
    nextStep: () => (step += 1),
    currentStep: () => step,
    finish: () => (events.length ? { id: `batch:${actionId}`, actionId, phase, events } : null),
  };
}
