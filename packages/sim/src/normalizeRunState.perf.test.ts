import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, type RunState } from './index';
import { normalizeRunState, stableStringify } from './qaScenario';

/**
 * `normalizeRunState` was rewritten for cost on 2026-09-01 (it runs on EVERY accepted action in production —
 * see the comment on it). The contract is that its output is BYTE-IDENTICAL to the original formula, because
 * it is the WP C exact-reproduction rail: a changed byte would make recorded hashes disagree with re-verified
 * ones and read as a divergence that never happened.
 *
 * So the original formula is kept here, verbatim, as the oracle.
 */
const VOLATILE_KEYS = ['recruitBuffFx', 'aleGranted', 'auraFx', 'veinstormStamped', 'weldFxBaseSeq', 'presentation', 'fx', 'beats', 'log'];
function original(s: RunState): string {
  const o = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  for (const k of VOLATILE_KEYS) delete o[k];
  return stableStringify(o);
}

const bm = (cardId: string, uid: string, attack: number, health: number): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [] } as unknown as BoardMinion);

describe('normalizeRunState — byte-identical to the original formula', () => {
  const states: RunState[] = [];
  let s = { ...createRun(7), phase: 'recruit' } as RunState;
  states.push(s);
  s = reduce(s, { type: 'roll' } as never) as RunState; states.push(s);
  if (s.shop[0]) { s = reduce(s, { type: 'buy', uid: s.shop[0].uid } as never) as RunState; states.push(s); }
  // A real fight's result attached as the shared sub-tree the reducer normally hands across dispatches by
  // reference — then a SECOND state that shares it, which is the memo hit the rewrite exists for.
  const fight = simulate(
    [bm('d2_ashscribe', 'a', 3, 30), bm('b2_echohorn', 'b', 5, 20)],
    [bm('d2_ashscribe', 'x', 2, 20)],
    makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
  const withFight = { ...s, lastCombat: fight, servedBoards: { 3: { minions: [] } } } as unknown as RunState;
  const sharesFight = { ...withFight, embers: (withFight.embers ?? 0) + 1 } as RunState; // same lastCombat reference
  states.push(withFight, sharesFight);

  it('the fixture carries the shared sub-trees (or the memo path went untested)', () => {
    expect(withFight.lastCombat).toBeTruthy();
    expect(sharesFight.lastCombat).toBe(withFight.lastCombat);
  });

  it.each(states.map((_, i) => [i] as const))('state %s normalizes identically', (i) => {
    expect(normalizeRunState(states[i]!)).toBe(original(states[i]!));
  });

  it('is identical on a state carrying undefined-valued keys and nested undefineds', () => {
    const st = { ...sharesFight, runeforgeOffer: undefined, weird: { a: undefined, b: [undefined, 1], c: null } } as unknown as RunState;
    expect(normalizeRunState(st)).toBe(original(st));
  });

  it('is identical when a volatile key is present and must be stripped', () => {
    const st = { ...sharesFight, recruitBuffFx: [{ targetUid: 'q', attack: 1, health: 1 }], log: ['x'] } as unknown as RunState;
    expect(normalizeRunState(st)).toBe(original(st));
    expect(normalizeRunState(st)).not.toContain('recruitBuffFx');
  });

  it('the memo never serves a stale string once the shared sub-tree is REPLACED', () => {
    const replaced = { ...sharesFight, lastCombat: { ...fight, events: [...fight.events, { type: 'sc', source: 'x', text: 'probe' }] } } as unknown as RunState;
    expect(normalizeRunState(replaced)).not.toBe(normalizeRunState(sharesFight));
    expect(normalizeRunState(replaced)).toBe(original(replaced));
  });
});
