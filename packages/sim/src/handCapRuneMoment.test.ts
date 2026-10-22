import { describe, it, expect } from 'vitest';
import { CARD_INDEX, QUEST_INDEX, RUNES } from '@game/content';
import { CONFIG } from './config';
import { createRun, runeGrantOverflow, withRuneAcquisition, type BoardCard, type RunState } from './state';
import { payDeep, reduce } from './reducer';

/**
 * R-HAND-RUNE-TURN-01, narrowed by the owner 2026-10-21 (the 2026-10-20 "whole turn" window is gone): "seems fine, but
 * whole turn shouldnt count, only the moment when rune is selected/rewards granted i think".
 *
 * A rune-sourced card may push the hand past 10 ONLY while a rune is being acquired: the Runeforge pick (or a rune
 * granted by a reward) and that rune's own on-acquire reward resolution. A later rune grant on the same turn (an End
 * of Turn drip, a trigger, combat) respects the normal cap. Quest rewards still overflow, and cards already past the
 * cap are kept.
 */

// Hand filler is a SPELL (spells never triple, so a full hand stays exactly full); the board is seven DIFFERENT
// minions so no granted copy can complete a triple and shrink the hand under the test.
const filler = (n: number): BoardCard[] =>
  Array.from({ length: n }, (_, i) => ({ uid: `f${i}`, cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }));
const fullBoard = (): BoardCard[] =>
  Object.values(CARD_INDEX).filter((c) => !c.spell && !c.token && !c.ruby && c.tier === 1).slice(0, CONFIG.boardMax)
    .map((c, i) => ({ uid: `bd${i}`, cardId: c.id, tribe: c.tribe, attack: 1, health: 1, keywords: [], golden: false }));
const grantRune = RUNES.find((r) => r.reward.kind === 'grant' && (r.reward as { cards?: string[] }).cards?.some((id) => CARD_INDEX[id] && !CARD_INDEX[id]!.spell));

function deepRun(wave: number, extra: Record<string, unknown> = {}): RunState {
  const base = createRun(7);
  return {
    ...base, wave, phase: 'recruit', board: [], hand: filler(CONFIG.handMax),
    runeDeep: 3, runeStacks: { rune_deep: 1 }, ownedRunes: ['rune_deep'],
    ...extra,
  } as RunState;
}

/** Buy `grantRune` at a Runeforge on `wave` with a hand already at the forge's raised cap. */
function buyGrantRune(wave: number): RunState {
  const base = createRun(7);
  const s: RunState = {
    ...base, wave, phase: 'recruit', embers: 50, board: fullBoard(),
    hand: filler(CONFIG.handMaxRuneTurn), runeforgeOffer: [grantRune!.id], runeforgeDiscounts: [0],
    runeDeep: 3, runeStacks: { rune_deep: 1 }, ownedRunes: ['rune_deep'],
  };
  return reduce(s, { type: 'buyRune', index: 0 }) as RunState;
}

describe('the over-cap window is the acquisition itself', () => {
  it('runeGrantOverflow is false outside an acquisition and true inside one (nested, exception-safe)', () => {
    expect(runeGrantOverflow()).toBe(false);
    withRuneAcquisition(() => {
      expect(runeGrantOverflow()).toBe(true);
      withRuneAcquisition(() => expect(runeGrantOverflow()).toBe(true));
      expect(runeGrantOverflow()).toBe(true);
    });
    expect(runeGrantOverflow()).toBe(false);
    expect(() => withRuneAcquisition(() => { throw new Error('boom'); })).toThrow('boom');
    expect(runeGrantOverflow(), 'a throw inside the window still closes it').toBe(false);
  });

  it('buying a rune at the Runeforge: its own card grant lands on a full forge hand', () => {
    expect(grantRune, 'a rune whose reward grants a named minion').toBeTruthy();
    const after = buyGrantRune(6);
    expect(after.ownedRunes).toContain(grantRune!.id);
    expect(after.hand.length).toBeGreaterThan(CONFIG.handMaxRuneTurn);
  });

  it('a later rune grant on the SAME turn respects the cap (the whole turn no longer counts)', () => {
    const s = deepRun(8, { runeforgeOffer: [grantRune!.id], runeforgeDiscounts: [0], embers: 50, board: fullBoard() });
    const after = reduce(s, { type: 'buyRune', index: 0 }) as RunState;
    expect(after.runeforgeOffer, 'the forge closed').toBeFalsy();
    const before = after.hand.length;
    payDeep(after); // a rune faucet paying later in the same turn
    expect(after.hand.length, 'Deep over-capped after the pick had resolved').toBe(Math.max(before, CONFIG.handMax));
  });

  it('cards already past the cap are kept', () => {
    const after = buyGrantRune(6);
    const n = after.hand.length;
    expect(n).toBeGreaterThan(CONFIG.handMax);
    payDeep(after);
    expect(after.hand.length, 'nothing was trimmed, and nothing more was added').toBe(n);
  });

  it('a rune faucet on a later turn respects the 10-card cap', () => {
    const s = deepRun(8);
    payDeep(s);
    expect(s.hand.length).toBe(CONFIG.handMax);
  });

  it("an old save's retired runeAcquiredWave stamp for this turn grants no over-cap", () => {
    const s = deepRun(8, { runeAcquiredWave: 8 });
    payDeep(s);
    expect(s.hand.length).toBe(CONFIG.handMax);
  });

  it('a rune dropped in by the DEV grant over-caps for its own pickup grant only', () => {
    const base = createRun(7);
    const s: RunState = { ...base, wave: 9, phase: 'recruit', embers: 50, board: fullBoard(), hand: filler(CONFIG.handMax) };
    const after = reduce(s, { type: 'devGrant', kind: 'rune', id: grantRune!.id } as never) as RunState;
    expect(after.hand.length).toBeGreaterThan(CONFIG.handMax);
  });

  it('a quest reward grant still over-caps (quest rewards are untouched)', () => {
    const quest = Object.values(QUEST_INDEX).find((q) => q.reward.kind === 'grant' && (q.reward as { cards?: string[] }).cards?.some((id) => CARD_INDEX[id] && !CARD_INDEX[id]!.spell));
    expect(quest, 'a quest whose reward grants a named minion').toBeTruthy();
    const base = createRun(7);
    const s: RunState = { ...base, wave: 9, phase: 'recruit', embers: 50, board: fullBoard(), hand: filler(CONFIG.handMax) };
    const after = reduce(s, { type: 'devGrant', kind: 'quest', id: quest!.id } as never) as RunState;
    expect(after.hand.length).toBeGreaterThan(CONFIG.handMax);
  });
});
