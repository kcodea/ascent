import { describe, it, expect } from 'vitest';
import { CARD_INDEX, QUEST_INDEX, RUNES } from '@game/content';
import { CONFIG } from './config';
import { createRun, runeGrantOverflow, type BoardCard, type RunState } from './state';
import { payDeep, reduce } from './reducer';

/**
 * R-HAND-RUNE-TURN-01 (owner 2026-10-20): "the extending of the hand past 10 cards should only happen on turns where
 * a rune is acquired, not from rune sources on every turn."
 *
 * Every rune grant used to pass `overflow = true` unconditionally, so a per-turn rune faucet (Rune of the Deep, the
 * tribe drips, the threshold meters, ...) grew the hand past 10 on every turn. A rune grant now over-caps only on the
 * turn a rune was acquired (`runeAcquiredWave`); quest rewards keep their never-dropped overflow.
 */

// Hand filler is a SPELL (spells never triple, so a full hand stays exactly full); the board is seven DIFFERENT
// minions so no granted copy can complete a triple and shrink the hand under the test.
const filler = (n: number): BoardCard[] =>
  Array.from({ length: n }, (_, i) => ({ uid: `f${i}`, cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }));
const fullBoard = (): BoardCard[] =>
  Object.values(CARD_INDEX).filter((c) => !c.spell && !c.token && !c.ruby && c.tier === 1).slice(0, CONFIG.boardMax)
    .map((c, i) => ({ uid: `bd${i}`, cardId: c.id, tribe: c.tribe, attack: 1, health: 1, keywords: [], golden: false }));

function deepRun(wave: number, runeAcquiredWave?: number): RunState {
  const base = createRun(7);
  return {
    ...base, wave, phase: 'recruit', board: [], hand: filler(CONFIG.handMax),
    runeDeep: 3, runeStacks: { rune_deep: 1 }, ownedRunes: ['rune_deep'],
    ...(runeAcquiredWave != null ? { runeAcquiredWave } : {}),
  };
}

describe('a rune grant over-caps the hand only on a turn a rune was acquired', () => {
  it('Rune of the Deep on a later turn respects the 10-card cap', () => {
    const s = deepRun(8, 5); // the rune was bought on turn 5; this is turn 8
    expect(runeGrantOverflow(s)).toBe(false);
    payDeep(s);
    expect(s.hand.length).toBe(CONFIG.handMax);
  });

  it('a run that never stamped an acquisition (an older save) also respects the cap', () => {
    const s = deepRun(8);
    payDeep(s);
    expect(s.hand.length).toBe(CONFIG.handMax);
  });

  it('on the turn a rune was acquired the same grant still over-caps (never lose the pickup reward)', () => {
    const s = deepRun(8, 8);
    expect(runeGrantOverflow(s)).toBe(true);
    payDeep(s);
    expect(s.hand.length).toBe(CONFIG.handMax + 1);
  });

  it('buying a rune at the Runeforge stamps the turn, so its card grant lands on a full forge-turn hand', () => {
    const grantRune = RUNES.find((r) => r.reward.kind === 'grant' && (r.reward as { cards?: string[] }).cards?.some((id) => CARD_INDEX[id] && !CARD_INDEX[id]!.spell));
    expect(grantRune, 'a rune whose reward grants a named minion').toBeTruthy();
    const base = createRun(7);
    const s: RunState = {
      ...base, wave: 6, phase: 'recruit', embers: 50, board: fullBoard(),
      hand: filler(CONFIG.handMaxRuneTurn), runeforgeOffer: [grantRune!.id], runeforgeDiscounts: [0],
    };
    const after = reduce(s, { type: 'buyRune', index: 0 });
    expect(after.runeAcquiredWave).toBe(6);
    expect(after.ownedRunes).toContain(grantRune!.id);
    expect(after.hand.length).toBeGreaterThan(CONFIG.handMaxRuneTurn);
  });

  it('a quest reward grant on a turn with no rune still over-caps (quest rewards are untouched)', () => {
    const quest = Object.values(QUEST_INDEX).find((q) => q.reward.kind === 'grant' && (q.reward as { cards?: string[] }).cards?.some((id) => CARD_INDEX[id] && !CARD_INDEX[id]!.spell));
    expect(quest, 'a quest whose reward grants a named minion').toBeTruthy();
    const base = createRun(7);
    const s: RunState = {
      ...base, wave: 9, phase: 'recruit', embers: 50, board: fullBoard(),
      hand: filler(CONFIG.handMax),
    };
    const after = reduce(s, { type: 'devGrant', kind: 'quest', id: quest!.id } as never);
    expect(after.runeAcquiredWave).toBeUndefined();
    expect(after.hand.length).toBeGreaterThan(CONFIG.handMax);
  });
});
