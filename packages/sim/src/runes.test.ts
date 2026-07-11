import { describe, it, expect } from 'vitest';
import type { CombatResult } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, QUEST_INDEX, RUNES, RUNE_INDEX, validateRunes } from '@game/content';
import { createRun, type RunState } from './state';
import { openEpicRuneforge, reduce } from './reducer';
import { applyEndOfTurn } from './recruit';

/** A 1/1 Beast board card (id 'alley') for board-setup tests. */
const mkAlley = (uid: string): RunState['board'][number] => ({ uid, cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });

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
    expect(RUNES.length).toBe(14);
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
  it('Summoning / Forthcoming arm their flags', () => {
    expect(buyRune('rune_summoning').runeSummoning).toBe(true);
    expect(buyRune('rune_forthcoming').questFlags?.runeForthcoming).toBe(true);
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

describe('Epic Runeforge', () => {
  /** Open the Epic forge with a chosen Epic rune first, then buy it — returns the post-buy run. */
  const buyEpic = (runeId: string, embers = 10, heroId = 'baggerben', over: Partial<RunState> = {}): RunState => {
    const s: RunState = { ...createRun(1, heroId), wave: 6, phase: 'recruit', embers, runeforgeOffer: [runeId], runeforgeEpic: true, ...over };
    return reduce(s, { type: 'buyRune', index: 0 });
  };

  it('every Epic rune validates, is `rune_`-prefixed, marked epic, and resolvable via RUNE_INDEX', () => {
    validateRunes(); // validates BOTH sets by default
    expect(EPIC_RUNES.length).toBeGreaterThanOrEqual(1);
    for (const r of EPIC_RUNES) {
      expect(r.id.startsWith('rune_')).toBe(true);
      expect(r.epic).toBe(true);
      expect(RUNE_INDEX[r.id]).toBeDefined(); // shared id space with the normal set
    }
    expect(EPIC_RUNES.some((r) => r.id === 'rune_copies')).toBe(true); // the one wired Epic rune so far
  });

  it('openEpicRuneforge presents up to 3 distinct Epic runes + flags the forge Epic', () => {
    const s: RunState = { ...createRun(1, 'baggerben'), wave: 6, phase: 'recruit', runeforgeRerolled: true };
    openEpicRuneforge(s);
    expect(s.runeforgeEpic).toBe(true);
    expect(s.runeforgeRerolled).toBeUndefined(); // a fresh visit re-arms the single re-roll
    const n = Math.min(3, EPIC_RUNES.length);
    expect(s.runeforgeOffer!.length).toBe(n);
    expect(new Set(s.runeforgeOffer).size).toBe(n);
    for (const id of s.runeforgeOffer!) expect(EPIC_RUNES.some((r) => r.id === id)).toBe(true);
  });

  it('buying an Epic rune applies its reward, records it, and does NOT spend a hero-power charge', () => {
    const s = buyEpic('rune_copies', 10); // cost 9
    expect(s.embers).toBe(1); // 10 − 9
    expect(s.runeCopies).toBe(true);
    expect(s.ownedRunes).toEqual(['rune_copies']);
    expect(s.runeforgeOffer).toBeUndefined();
    expect(s.runeforgeEpic).toBeUndefined();
    expect(s.heroPowerSpent).toBeFalsy(); // the Epic forge is quest-opened, not the hero power
  });

  it('re-rolling the Epic forge spends 2 Gold once and redraws from the Epic set', () => {
    const s: RunState = { ...createRun(1, 'baggerben'), wave: 6, phase: 'recruit', embers: 10 };
    openEpicRuneforge(s);
    const r = reduce(s, { type: 'rerollRuneforge' });
    expect(r.embers).toBe(8);
    expect(r.runeforgeRerolled).toBe(true);
    expect(r.runeforgeOffer!.length).toBe(Math.min(3, EPIC_RUNES.length));
    for (const id of r.runeforgeOffer!) expect(EPIC_RUNES.some((rn) => rn.id === id)).toBe(true);
    expect(reduce(r, { type: 'rerollRuneforge' })).toBe(r); // once per visit
  });
});

describe('Basic runes — moved-in effects (Empowerment / Rallying / Scale / Action)', () => {
  const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };

  it('Empowerment arms the double-trigger flag AND doubles a value hero power (Bagger Ben)', () => {
    expect(buyRune('rune_empowerment', 10).runeEmpowerment).toBe(true);
    const bag = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1, 'baggerben'), wave: 3, phase: 'recruit', embers: 5, heroReady: true, ...over });
    expect(reduce(bag(), { type: 'heroPower' }).embers).toBe(5 + (1 + 3)); // base: +4
    expect(reduce(bag({ runeEmpowerment: true }), { type: 'heroPower' }).embers).toBe(5 + 2 * (1 + 3)); // doubled: +8
  });

  it('Empowerment is gated OUT of the Runesmith forge (his passive power cannot double)', () => {
    // Across seeds the turn-6 Runesmith forge never offers Empowerment — the double-trigger gate filters it for
    // his passive `runeforge` power. (It would be eligible for a doubleable-power hero, if one could open it.)
    const offered = Array.from({ length: 40 }, (_, i) => {
      const base: RunState = { ...createRun(i + 1, 'runesmith'), wave: 5, phase: 'combat', embers: 10,
        lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } } };
      return reduce(base, { type: 'resolveCombat' }).runeforgeOffer ?? [];
    });
    expect(offered.every((o) => !o.includes('rune_empowerment'))).toBe(true);
  });

  it('Rune of Scale: each Gold-spend buffs 3 random board minions +2/+2', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, freeRolls: 0,
      runeScale: { count: 3, attack: 2, health: 2 }, board: [mkAlley('a'), mkAlley('b'), mkAlley('c')] };
    s = reduce(s, { type: 'roll' }); // one Gold-spend → count(3) = board(3), all get +2/+2
    expect(s.board.map((c) => [c.attack, c.health])).toEqual([[3, 3], [3, 3], [3, 3]]);
  });

  it('Rune of Rallying: buying arms the Start-of-Combat rally flag', () => {
    const s: RunState = buyRune('rune_rallying', 10);
    expect(s.questFlags?.runeRallying).toBe(true);
  });

  it('Rune of Copies: no copy on buy; one copy at the start of each turn', () => {
    // No immediate copy on purchase (start-of-shop only now).
    const bought: RunState = buyRune('rune_copies', 10, { board: [mkAlley('a')], hand: [] });
    expect(bought.runeCopies).toBe(true);
    expect(bought.hand.some((c) => c.cardId === 'alley')).toBe(false);
    // Recurring copy at the next turn's shop open.
    const next: RunState = reduce({ ...createRun(1, 'warden'), wave: 6, phase: 'combat', runeCopies: true, board: [mkAlley('a')], hand: [], lastCombat: win }, { type: 'resolveCombat' });
    expect(next.hand.some((c) => c.cardId === 'alley')).toBe(true);
  });

  it('Rune of Action: End of Turn gives the THREE leftmost minions +1/+1 per card played this turn', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', questRecurringEndOfTurn: ['runeAction'],
      playedThisTurn: ['x', 'y', 'z'], board: [mkAlley('a'), mkAlley('b'), mkAlley('c'), mkAlley('d')] };
    applyEndOfTurn(s);
    expect(s.board.slice(0, 3).map((c) => [c.attack, c.health])).toEqual([[4, 4], [4, 4], [4, 4]]); // +3/+3 each
    expect([s.board[3]!.attack, s.board[3]!.health]).toEqual([1, 1]); // 4th untouched
  });
});

describe('Epic Commission — the greater quest that opens the Epic Runeforge next turn', () => {
  const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };

  it('is a neutral greater quest whose reward opens the Epic Runeforge', () => {
    const q = QUEST_INDEX['q_epic_commission']!;
    expect(q).toBeDefined();
    expect(q.tribe).toBe('neutral');
    expect(q.tier).toBe('greater');
    expect(q.reward).toEqual({ kind: 'openEpicRuneforge' });
  });

  it('completing it ARMS the forge for next turn — it does not open on the completing turn', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 7, phase: 'recruit', embers: 10, freeRolls: 0,
      activeQuests: [{ questId: 'q_epic_commission', progress: 24, completed: false }] };
    s = reduce(s, { type: 'roll' }); // spend ≥1 Gold → objective hits 25 → completes
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.pendingEpicRuneforge).toBe(true); // armed…
    expect(s.runeforgeOffer).toBeUndefined(); // …but NOT opened this turn
  });

  it('the armed forge opens at the start of the next (non-quest) turn, then disarms', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 6, phase: 'combat', pendingEpicRuneforge: true, lastCombat: win };
    const next = reduce(s, { type: 'resolveCombat' }); // → turn 7 (not a quest turn)
    expect(next.wave).toBe(7);
    expect(next.runeforgeOffer!.length).toBe(Math.min(3, EPIC_RUNES.length));
    expect(next.runeforgeEpic).toBe(true);
    for (const id of next.runeforgeOffer!) expect(EPIC_RUNES.some((rn) => rn.id === id)).toBe(true);
    expect(next.pendingEpicRuneforge).toBe(false); // disarmed once opened
  });

  it('holds back a turn rather than stacking on a quest-offer turn', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 7, phase: 'combat', pendingEpicRuneforge: true, lastCombat: win };
    const next = reduce(s, { type: 'resolveCombat' }); // → turn 8, a greater-quest turn
    expect(next.wave).toBe(8);
    expect(next.questOffer?.length).toBeGreaterThan(0); // the quest shop takes the turn…
    expect(next.runeforgeOffer).toBeUndefined(); // …the forge waits…
    expect(next.pendingEpicRuneforge).toBe(true); // …still armed for the next clear turn
  });
});
