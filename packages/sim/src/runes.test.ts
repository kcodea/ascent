import { describe, it, expect } from 'vitest';
import type { CombatResult } from '@game/core';
import { CARD_INDEX, QUEST_INDEX, RUNES, RUNE_INDEX, validateRunes } from '@game/content';
import { createRun, type RunState } from './state';
import { reduce } from './reducer';

/** A Runesmith run parked at wave-5 combat, ready for `resolveCombat` → the turn-6 Runeforge. */
const atWave5Combat = (over: Partial<RunState> = {}): RunState => ({
  ...createRun(1, 'runesmith'), wave: 5, phase: 'combat', embers: 10,
  lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
  ...over,
});

/** Open the Runeforge with a chosen rune first in the offer, then buy it — returns the post-buy run. */
const buyRune = (runeId: string, embers = 10, over: Partial<RunState> = {}): RunState => {
  const s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers, runeforgeOffer: [runeId], ...over };
  return reduce(s, { type: 'buyRune', index: 0 });
};

describe('Runeforge — framework', () => {
  it('every rune validates + is Runeforge-only (never a card/quest id)', () => {
    validateRunes();
    expect(RUNES.length).toBe(11);
    for (const r of RUNES) expect(r.id.startsWith('rune_')).toBe(true);
  });

  it('opens on turn 6 for Runesmith with a random 3 distinct runes', () => {
    const s = reduce(atWave5Combat(), { type: 'resolveCombat' });
    expect(s.wave).toBe(6);
    expect(s.runeforgeOffer).toBeDefined();
    expect(s.runeforgeOffer!.length).toBe(3);
    expect(new Set(s.runeforgeOffer).size).toBe(3); // no duplicates
    for (const id of s.runeforgeOffer!) expect(RUNE_INDEX[id]).toBeDefined();
  });

  it('rerollRuneforge spends 2 Gold once and swaps in a fresh, non-overlapping trio', () => {
    const s = reduce(atWave5Combat(), { type: 'resolveCombat' });
    const before = s.runeforgeOffer!;
    const r = reduce(s, { type: 'rerollRuneforge' });
    expect(r.embers).toBe(s.embers - 2);
    expect(r.runeforgeRerolled).toBe(true);
    expect(r.runeforgeOffer!.length).toBe(3);
    expect(new Set(r.runeforgeOffer).size).toBe(3);
    // the fresh trio shares no rune with the original offer (drawn from the leftovers)
    for (const id of r.runeforgeOffer!) expect(before).not.toContain(id);
    // a second re-roll is a no-op (once per visit)
    expect(reduce(r, { type: 'rerollRuneforge' })).toBe(r);
  });

  it("rerollRuneforge you can't afford is a no-op", () => {
    const s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 1, runeforgeOffer: ['rune_warding', 'rune_fury', 'rune_slaying'] };
    expect(reduce(s, { type: 'rerollRuneforge' })).toBe(s);
  });

  it('does NOT open for a non-Runesmith hero', () => {
    const s = reduce({ ...atWave5Combat(), heroId: 'warden' }, { type: 'resolveCombat' });
    expect(s.runeforgeOffer).toBeUndefined();
  });

  it('while the forge is open, non-forge actions are blocked', () => {
    const s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 10, runeforgeOffer: ['rune_warding'] };
    expect(reduce(s, { type: 'roll' })).toBe(s); // blocked (same ref)
    expect(reduce(s, { type: 'faceOmen' })).toBe(s);
  });

  it('buyRune spends the cost, applies the reward, records the rune, and closes the forge (once per game)', () => {
    const s = buyRune('rune_warding', 10); // cost 4
    expect(s.embers).toBe(6);
    expect(s.questFlags?.runeWarding).toBe(true);
    expect(s.ownedRunes).toEqual(['rune_warding']);
    expect(s.runeforgeOffer).toBeUndefined();
    expect(s.heroPowerSpent).toBe(true);
  });

  it("buyRune you can't afford is a no-op (forge stays open)", () => {
    const s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 2, runeforgeOffer: ['rune_pillaging'] }; // cost 8
    const after = reduce(s, { type: 'buyRune', index: 0 });
    expect(after).toBe(s); // unchanged ref
  });

  it('skipRuneforge closes the forge without buying (spends the once-per-game charge)', () => {
    const s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 10, runeforgeOffer: ['rune_warding'] };
    const after = reduce(s, { type: 'skipRuneforge' });
    expect(after.runeforgeOffer).toBeUndefined();
    expect(after.ownedRunes).toBeUndefined();
    expect(after.heroPowerSpent).toBe(true);
  });
});

describe('Runeforge — each rune applies its effect on purchase', () => {
  it('Spellslinging arms the per-5-Gold spell drip', () => {
    expect(buyRune('rune_spellslinging').spellDripPer).toBe(5);
  });
  it('Warding / Slaying / Fury arm their combat flags', () => {
    expect(buyRune('rune_warding').questFlags?.runeWarding).toBe(true);
    expect(buyRune('rune_slaying').questFlags?.runeSlaying).toBe(true);
    expect(buyRune('rune_fury').questFlags?.runeFury).toBe(true);
  });
  it('Structure arms the attachment-spell flag', () => {
    expect(buyRune('rune_structure').runeStructure).toBe(true);
  });
  it('Spending arms the recurring End-of-Turn effect', () => {
    expect(buyRune('rune_spending').questRecurringEndOfTurn).toContain('runeSpending');
  });
  it('Consumption arms the +2/+1 Fodder-on-Consume bump', () => {
    expect(buyRune('rune_consumption').runeConsume).toEqual({ attack: 2, health: 1 });
  });
  it('Pillaging grants a Pillager to hand AND makes Gold Pouches worth 2', () => {
    const s = buyRune('rune_pillaging'); // cost 8
    expect(s.hand.some((c) => c.cardId === 'pillager')).toBe(true);
    expect(s.goldPouchValue).toBe(2);
  });
  it('Summoning / Forthcoming / Empowerment arm their flags', () => {
    expect(buyRune('rune_summoning').runeSummoning).toBe(true);
    expect(buyRune('rune_forthcoming').questFlags?.runeForthcoming).toBe(true);
    expect(buyRune('rune_empowerment').runeEmpowerment).toBe(true);
  });
});

describe('Runeforge — rune effects fire in play', () => {
  it('Spellslinging: spending 5 Gold conjures a spell to hand', () => {
    // Buy a shop minion for 3, roll twice (1 each) → 5 Gold spent → one spell drip.
    let s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 20, spellDripPer: 5, spellDripTick: 0, hand: [] };
    const handBefore = s.hand.length;
    s = reduce(s, { type: 'roll' }); s = reduce(s, { type: 'roll' }); s = reduce(s, { type: 'roll' });
    s = reduce(s, { type: 'roll' }); s = reduce(s, { type: 'roll' }); // 5 rolls × 1 Gold = 5 spent
    expect(s.hand.length).toBe(handBefore + 1);
    expect(CARD_INDEX[s.hand[0]!.cardId]?.spell).toBe(true); // it's a spell
  });

  it('Pillaging: a Gold Pouch cast is worth 2 Gold with the rune', () => {
    let s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 0, goldPouchValue: 2,
      hand: [{ uid: 'gp', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'gp' });
    expect(s.embers).toBe(2); // worth 2, not 1
  });

  it('Slaying: each Slaughter this combat banks +2 Gold for next turn', () => {
    const s = reduce({
      ...createRun(1, 'runesmith'), phase: 'combat', questFlags: { runeSlaying: true },
      lastCombat: {
        events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 3, initial: { player: [], enemy: [] },
        playerQuestTally: { attack: 0, summonCombat: 0, slaughter: 3, slaughterKeyword: 0, attackByTribe: {}, summonCombatByTribe: {}, slaughterByTribe: {} },
      } as CombatResult,
    }, { type: 'settleCombat' }); // settle WITHOUT advancing, so bonusEmbersNextTurn isn't yet spent into next turn
    expect(s.bonusEmbersNextTurn).toBe(6); // 3 slaughters × 2
  });

  it('Summoning: casting a spell improves your Imps +1/+1 (run-wide)', () => {
    let s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 5, runeSummoning: true,
      hand: [{ uid: 'gp', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'gp' }); // cast one spell
    expect(s.impBuff).toEqual({ attack: 1, health: 1 });
  });
});

describe('New heroes — Coran (Pathfinder) + Jenkins (Dynamite Dig)', () => {
  const atCombat = (heroId: string, wave: number): RunState => ({
    ...createRun(1, heroId), wave, phase: 'combat',
    lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
  });

  it('Coran: no Lesser quest on turn 4', () => {
    const s = reduce(atCombat('coran', 3), { type: 'resolveCombat' }); // → turn 4
    expect(s.wave).toBe(4);
    expect(s.questOffer).toBeUndefined();
  });
  it('Coran: the Greater quest shop opens on turn 6', () => {
    const s = reduce(atCombat('coran', 5), { type: 'resolveCombat' }); // → turn 6
    expect(s.wave).toBe(6);
    expect(s.questOffer?.length).toBeGreaterThan(0);
    expect(QUEST_INDEX[s.questOffer![0]!]?.tier).toBe('greater');
  });
  it('Coran: the Capstone quest shop opens on turn 10', () => {
    const s = reduce(atCombat('coran', 9), { type: 'resolveCombat' }); // → turn 10
    expect(s.wave).toBe(10);
    expect(QUEST_INDEX[s.questOffer![0]!]?.tier).toBe('capstone');
  });

  it('Jenkins: Dynamite Dig opens a tier Discover, spends 1 Gold, and the cost climbs each use', () => {
    let s: RunState = { ...createRun(1, 'jenkins'), wave: 3, tier: 2, phase: 'recruit', embers: 10, heroReady: true };
    s = reduce(s, { type: 'heroPower' });
    expect(s.discover).toBeDefined(); // a minion Discover opened
    expect(s.embers).toBe(9); // first use costs 1
    expect(s.heroPowerUses).toBe(1);
    // Resolve the Discover + recharge, then the second use costs 2.
    s = reduce(s, { type: 'discover', index: 0 });
    s = { ...s, heroReady: true, embers: 10 };
    s = reduce(s, { type: 'heroPower' });
    expect(s.embers).toBe(8); // second use costs 2
    expect(s.heroPowerUses).toBe(2);
  });
});
