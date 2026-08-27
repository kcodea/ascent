/**
 * DOC BOT 2.0 WP C — the UNIFIED SEMANTIC TRACE over one scenario/report execution.
 *
 * One envelope, two lanes (canonical-schemas.md §4): the recruit side IS the existing presentation envelope
 * (`GamePresentationEvent` — already deterministic, id'd, parent-attributed); the combat side joins through
 * the pure post-hoc adapter (`combatSemanticTrace` in @game/core). Nothing here executes gameplay — callers
 * hand in a `QaScenarioResult` (or the raw pieces) and get a comparable, byte-stable trace.
 */
import { combatSemanticTrace, type CombatSemanticEvent, type GamePresentationEvent } from '@game/core';
import { stableStringify, type QaScenarioResult } from './qaScenario';

export interface SemanticTrace {
  /** The recruit presentation events, verbatim (they already carry deterministic ids/parents/steps). */
  recruit: GamePresentationEvent[];
  /** The combat log adapted into the semantic envelope (empty when the execution resolved no fight). */
  combat: CombatSemanticEvent[];
}

/** Build the unified trace from a runner result. Pure; same result in, byte-identical trace out. */
export function semanticTraceOf(
  result: Pick<QaScenarioResult, 'events' | 'combatLog'>,
  opts?: { actionId?: string },
): SemanticTrace {
  return {
    recruit: [...result.events],
    combat: result.combatLog ? combatSemanticTrace(result.combatLog, opts) : [],
  };
}

/** Byte-stable serialization of a trace — the comparison currency for the twice-traced determinism gate. */
export const serializeTrace = (t: SemanticTrace): string => stableStringify(t);

export interface TraceDivergence {
  lane: 'recruit' | 'combat';
  /** First differing event index in that lane; equal-prefix length when one trace is a prefix of the other. */
  index: number;
  expected?: string;
  observed?: string;
}

/** Locate the FIRST divergent event between two traces (null = byte-identical). Drives the sabotage tests
 *  and the Scene Builder timeline's first-divergence highlight. */
export function firstTraceDivergence(a: SemanticTrace, b: SemanticTrace): TraceDivergence | null {
  for (const lane of ['recruit', 'combat'] as const) {
    const xs = a[lane];
    const ys = b[lane];
    const n = Math.min(xs.length, ys.length);
    for (let i = 0; i < n; i++) {
      const ex = stableStringify(xs[i]);
      const ob = stableStringify(ys[i]);
      if (ex !== ob) return { lane, index: i, expected: ex, observed: ob };
    }
    if (xs.length !== ys.length) return { lane, index: n, expected: `${xs.length} events`, observed: `${ys.length} events` };
  }
  return null;
}
