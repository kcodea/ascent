import { describe, it, expect } from 'vitest';
import { createRun, deserialize, missingCardIds, serialize, type RunState } from '@game/sim';

/**
 * Save durability — the two rules that keep a dev session from destroying a player's run.
 *
 * Both were found the hard way on 2026-07-22: a Scene Builder run holding a set-2 card was autosaved over the
 * real save, the card was then deleted from the set, and the next load crashed in `shopView` reading `.spell`
 * of `undefined` — an unrecoverable white screen with nothing pointing at the cause.
 *
 * The store owns the actual localStorage plumbing (not importable here without a DOM), so these pin the
 * SIM-side contract the store's guards depend on:
 *   1. `missingCardIds` finds a save that references cards this build no longer has, and
 *   2. the `sandbox` flag survives a serialize → deserialize round trip, since `writeSave` / `flushSave` /
 *      the turn-boundary autosave all branch on it.
 */
const run = (): RunState => ({ ...createRun(1, 'warden'), phase: 'recruit' });

describe('a save referencing deleted cards is detectable', () => {
  it('reports every unknown card id across shop, hand and board', () => {
    const s = run();
    s.shop = [{ uid: 'a', cardId: 'ghost_card' }, ...s.shop.slice(1)] as RunState['shop'];
    s.hand = [{ uid: 'b', cardId: 'another_ghost', tribe: 'neutral', attack: 1, health: 1, keywords: [] }] as RunState['hand'];
    const missing = missingCardIds(s);
    expect(missing).toContain('ghost_card');
    expect(missing).toContain('another_ghost');
  });

  it('reports nothing for a clean run — the guard must not refuse valid saves', () => {
    expect(missingCardIds(run())).toEqual([]);
  });

  it('survives the save round trip, which is where the store applies it', () => {
    const s = run();
    s.shop = [{ uid: 'a', cardId: 'ghost_card' }] as RunState['shop'];
    expect(missingCardIds(deserialize(serialize(s)))).toEqual(['ghost_card']);
  });
});

describe('the sandbox flag survives a save round trip', () => {
  it('round-trips true, so the autosave guards can see it', () => {
    // If this ever stopped surviving, the store's `run.sandbox` checks would silently pass and a Scene
    // Builder run would be written over the player's Continue again.
    const s: RunState = { ...run(), sandbox: true };
    expect(deserialize(serialize(s)).sandbox).toBe(true);
  });

  it('is absent (not true) on a normal run', () => {
    expect(deserialize(serialize(run())).sandbox).toBeFalsy();
  });
});
