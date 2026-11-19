import type { CombatEvent } from '@game/core';

/**
 * A FOLD OVER THE EVENTS PLAYED SO FAR THAT CAN BE CONTINUED (R-PERF-COMBAT-FOLD-01, perf 2026-11-18).
 *
 * The combat replay keeps a handful of running readouts ("enemy deaths so far", "spell power gained so far", the
 * display previews, the quest tally). Each was a loop over `events[0, upto)` re-run from event 0 on every beat, so a
 * fight cost O(events x beats) per readout. They are all the same shape: a small state, one event applied at a time,
 * and a reading taken off the state. This keeps the state between calls and applies only the events past where it
 * stopped.
 *
 * `spec.fold(events, upto)` (the pure, from-scratch form) and the continued form are built from the SAME three
 * functions, so they cannot drift:
 *
 *   init(ctx)        the empty state (`ctx` is whatever the fold is about, e.g. the fight; identity-compared)
 *   step(s, e, i)    one event applied
 *   read(s)          the reading. Must return a FRESH value every call: the state lives on, the reading is handed out.
 *
 * The continued form starts over whenever the log or `ctx` is a different object, or the cursor went BACKWARD (a seek,
 * a rewatch, a spectator resume), so every way of reaching a beat reads the same number. That is the contract the
 * previews were built on ("a fold, never a bump"): Skip, a scrub and a resumed save all land where settle banks.
 */
export interface PrefixFoldSpec<S, O, C = undefined> {
  init: (ctx: C) => S;
  step: (state: S, e: CombatEvent, i: number) => void;
  read: (state: S) => O;
}

/** The from-scratch fold of `events[0, upto)`. */
export function foldPrefix<S, O, C>(spec: PrefixFoldSpec<S, O, C>, events: readonly CombatEvent[], upto: number, ctx: C): O {
  const s = spec.init(ctx);
  const n = Math.min(upto, events.length);
  for (let i = 0; i < n; i++) { const e = events[i]; if (e) spec.step(s, e, i); }
  return spec.read(s);
}

/** The continued fold: same result as `foldPrefix`, paying only for the events past the previous call's cursor. */
export function makePrefixFold<S, O, C = undefined>(spec: PrefixFoldSpec<S, O, C>): (events: readonly CombatEvent[], upto: number, ctx: C) => O {
  let state: S | null = null;
  let kEvents: unknown = null, kCtx: unknown = null;
  let pos = 0;
  return (events, upto, ctx) => {
    const n = Math.max(0, Math.min(upto, events.length));
    if (state === null || events !== kEvents || ctx !== kCtx || n < pos) {
      state = spec.init(ctx);
      kEvents = events; kCtx = ctx; pos = 0;
    }
    for (; pos < n; pos++) { const e = events[pos]; if (e) spec.step(state, e, pos); }
    return spec.read(state);
  };
}

/**
 * PER-FIGHT EVENT LISTS BY TYPE, built once per log (one pass) and kept while the log is alive. For the readouts that
 * are NOT a prefix of the log (they count by engine STEP, and the replay reorders events inside a step) and so cannot
 * be continued: they still only care about a few event types, so they walk those events instead of the whole log.
 */
const byType = new WeakMap<readonly CombatEvent[], Map<string, { i: number; e: CombatEvent }[]>>();
export function eventsOfType<T extends CombatEvent['type']>(events: readonly CombatEvent[], type: T): readonly { i: number; e: Extract<CombatEvent, { type: T }> }[] {
  let m = byType.get(events);
  if (!m) {
    m = new Map();
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!e) continue;
      let a = m.get(e.type);
      if (!a) m.set(e.type, a = []);
      a.push({ i, e });
    }
    byType.set(events, m);
  }
  return (m.get(type) ?? []) as unknown as readonly { i: number; e: Extract<CombatEvent, { type: T }> }[];
}
