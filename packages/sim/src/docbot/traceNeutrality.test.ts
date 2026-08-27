/**
 * DOC BOT 2.0 WP C — THE NEUTRALITY LANE (§7.4/§23; the plan's proof obligation 3).
 *
 * Instrumentation must be PROVABLY INERT. This lane runs identical seeded trajectories with capture ON
 * (`reduceWithPresentation(_, _, true)` — the path the store, the QA runner, and the ring buffer's commit
 * chokepoint all use) vs capture OFF (plain `reduce`) and asserts byte-identical outcomes end to end:
 * the serialized state after EVERY step, the final `rngCursor`, the final `uidSeq`, and every combat's full
 * event log. The rail helpers the ring buffer records (`hashRunState`, cursor reads) are proven pure and
 * deterministic here too, and the combat trace adapter is proven to never touch its input.
 *
 * SABOTAGE (§4.5): a simulated leaky tap — instrumentation that draws ONE extra rng value per action — must
 * be caught by this very comparison within the first affected step, proving the lane can actually fail.
 *
 * Every other WP C change (adapter, ring, exact replay, timeline) sits BEHIND this proof.
 */
import { describe, expect, it } from 'vitest';
import { combatSemanticTrace, makeRng } from '@game/core';
import { createRun, serialize, type Action, type RunState } from '../state';
import { reduce, reduceWithPresentation } from '../reducer';
import { hashRunState, stableStringify } from '../qaScenario';
import { nextFuzzAction, pinCurrentWave } from './trajectory';

const SEEDS = [11, 4242] as const;
const STEPS = 40;

/** Drive one run with capture ON, generating the action list; the OFF side replays the SAME list. */
function driveCaptured(seed: number): { actions: Action[]; states: string[]; combats: string[]; final: RunState } {
  const rng = makeRng(seed * 7 + 1);
  let s = createRun(seed);
  const actions: Action[] = [];
  const states: string[] = [];
  const combats: string[] = [];
  for (let i = 0; i < STEPS && s.phase !== 'gameover'; i++) {
    pinCurrentWave(s);
    const a = nextFuzzAction(s, rng);
    actions.push(a);
    const before = s;
    const { state: next } = reduceWithPresentation(s, a, true);
    if (next.lastCombat && next.lastCombat !== before.lastCombat) combats.push(stableStringify(next.lastCombat.events));
    s = next;
    states.push(serialize(s));
  }
  return { actions, states, combats, final: s };
}

function replayPlain(seed: number, actions: readonly Action[]): { states: string[]; combats: string[]; final: RunState } {
  let s = createRun(seed);
  const states: string[] = [];
  const combats: string[] = [];
  for (const a of actions) {
    pinCurrentWave(s);
    const before = s;
    s = reduce(s, a);
    if (s.lastCombat && s.lastCombat !== before.lastCombat) combats.push(stableStringify(s.lastCombat.events));
    states.push(serialize(s));
  }
  return { states, combats, final: s };
}

describe('WP C neutrality lane — capture ON vs OFF is byte-identical', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: identical serialized state per step, rngCursor, uidSeq, and combat logs`, () => {
      const on = driveCaptured(seed);
      const off = replayPlain(seed, on.actions);
      expect(off.states.length).toBe(on.states.length);
      for (let i = 0; i < on.states.length; i++) {
        expect(off.states[i], `step ${i} (${on.actions[i]!.type}): capture ON diverged from plain reduce`).toBe(on.states[i]);
      }
      expect(off.final.rngCursor, 'final rngCursor differs — instrumentation consumed randomness').toBe(on.final.rngCursor);
      expect(off.final.uidSeq, 'final uidSeq differs — instrumentation generated identities').toBe(on.final.uidSeq);
      expect(off.combats, 'combat event logs differ between capture ON and OFF').toEqual(on.combats);
    });
  }

  it('the ring rails are observational: hashRunState is deterministic and mutates nothing', () => {
    let s = createRun(99);
    pinCurrentWave(s);
    s = reduce(s, { type: 'roll' });
    const before = serialize(s);
    const cursorBefore = s.rngCursor;
    const h1 = hashRunState(s);
    const h2 = hashRunState(s);
    expect(h1).toBe(h2);
    expect(serialize(s), 'hashing the state changed the state').toBe(before);
    expect(s.rngCursor, 'hashing the state moved the rng cursor').toBe(cursorBefore);
  });

  it('the combat trace adapter never touches its input (pure post-hoc)', () => {
    // Drive until a fight lands, then adapt its log twice and prove the log bytes are untouched.
    const rng = makeRng(31337);
    let s = createRun(5150);
    for (let i = 0; i < 80 && !s.lastCombat; i++) {
      pinCurrentWave(s);
      s = reduce(s, nextFuzzAction(s, rng));
    }
    expect(s.lastCombat, 'trajectory never produced a combat — raise the step budget').toBeTruthy();
    const eventsBefore = stableStringify(s.lastCombat!.events);
    const t1 = combatSemanticTrace(s.lastCombat!.events);
    const t2 = combatSemanticTrace(s.lastCombat!.events);
    expect(stableStringify(s.lastCombat!.events), 'the adapter mutated the combat log').toBe(eventsBefore);
    expect(stableStringify(t1), 'the adapter is not deterministic over the same log').toBe(stableStringify(t2));
  });

  it('SABOTAGE: a leaky tap (one extra rng draw per action) is caught by this comparison', () => {
    const seed = SEEDS[0];
    const on = driveCaptured(seed);
    // The doctored pipeline: after each reduce, "instrumentation" draws one value off the run cursor —
    // exactly what a buggy makeRng tap would do. The lane must flag it, proving sensitivity.
    let s = createRun(seed);
    let caught = false;
    for (let i = 0; i < on.actions.length; i++) {
      pinCurrentWave(s);
      s = reduce(s, on.actions[i]!);
      const leak = makeRng(s.rngCursor);
      leak.next(); // the forbidden draw
      s = { ...s, rngCursor: leak.state() };
      if (serialize(s) !== on.states[i]) { caught = true; break; }
    }
    expect(caught, 'the neutrality comparison FAILED to detect a leaky rng tap — the lane is blind').toBe(true);
  });
});
