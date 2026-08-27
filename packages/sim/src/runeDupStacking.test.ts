import { describe, it, expect } from 'vitest';
import { simulate, makeRng, combatSide, type BoardMinion, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, type RunState } from './state';
import { reduce, questCombatMods, wishboneReps } from './reducer';
import { noteSpellCast, spellCostReduction } from './recruit';
import { RUNE_DUP_SWEETENER, RUNE_DUP_UNIQUE, forgeFilteredDuplicate, runeStacksOf } from './runeDup';

/**
 * RUNE DUPLICATE STACKING — the owner's 2026-08-27 rulings (decisions q-runedup-*), tested per family
 * through the REAL `buyRune` reducer path: buy the rune twice, assert the doubled behaviour. The Doc Bot
 * runeSwallowScan (ratchet 80 → 0) proves no purchase is swallowed; these tests prove the consumers
 * actually READ the copy count.
 */
const buy = (s: RunState, runeId: string): RunState =>
  reduce({ ...s, runeforgeOffer: [runeId], runeforgeDiscounts: undefined, embers: 30 } as RunState, { type: 'buyRune', index: 0 });

const fresh = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1, 'runesmith'), wave: 7, phase: 'recruit', embers: 30, setId: 'set2', ...over } as RunState);

const buyTwice = (runeId: string, over: Partial<RunState> = {}): RunState => buy(buy(fresh(over), runeId), runeId);

const dwarf = (uid: string): RunState['board'][number] =>
  ({ uid, cardId: 'dw_edward', tribe: 'dwarf', attack: 2, health: 3, keywords: [], buffs: [] } as unknown as RunState['board'][number]);

describe('the counted mechanism (runeStacks)', () => {
  it('every application ticks the count; a single copy reads 1 (legacy saves included)', () => {
    const once = buy(fresh(), 'rune_flagship');
    expect(runeStacksOf(once, 'rune_flagship')).toBe(1);
    const twice = buy(once, 'rune_flagship');
    expect(runeStacksOf(twice, 'rune_flagship')).toBe(2);
    // A state with no runeStacks map at all (a pre-counter save) reads 1, never 0.
    expect(runeStacksOf({} as RunState, 'rune_flagship')).toBe(1);
  });
});

describe('family 1 — recurring runes: the effect fires once per copy', () => {
  it('two Rune of the Flagship give Dwarves +4/+4 per Shop spell (the owner\'s own example)', () => {
    const spell = Object.values(CARD_INDEX).find((c) => c && c.spell && !c.token && !c.gift && !c.ruby)!;
    const one = buy(fresh({ board: [dwarf('d0')] }), 'rune_flagship');
    noteSpellCast(one, spell);
    const singleGain = one.board[0]!.attack - 2;
    const two = buyTwice('rune_flagship', { board: [dwarf('d0')] });
    noteSpellCast(two, spell);
    expect(singleGain, 'one copy pays the printed +2').toBe(2);
    expect(two.board[0]!.attack - 2, 'two copies pay +4 per cast').toBe(4);
  });
});

describe('family 2 — threshold runes: same meter, doubled payoff', () => {
  it('two Rune of the Vault pay 20 Gold at the single Tier-5 trip', () => {
    const base = fresh({ tier: 4, upgradeCost: 0 });
    const one = reduce({ ...buy(base, 'rune_vault'), embers: 5, upgradeCost: 0 } as RunState, { type: 'upgrade' });
    const two = reduce({ ...buyTwice('rune_vault', { tier: 4, upgradeCost: 0 }), embers: 5, upgradeCost: 0 } as RunState, { type: 'upgrade' });
    expect(one.embers, 'one copy pays the printed 10').toBe(15);
    expect(two.embers, 'two copies pay 20 at the same trip').toBe(25);
    expect(two.runeVault, 'still once per run — spent at the trip').toBeUndefined();
  });

  it('two Rune of the Returning Pack pay 2 Beasts per 6 combat summons (owner wording)', () => {
    const s = buyTwice('rune_returning_pack');
    expect(s.questFlags?.runeReturningPack, 'the threshold does NOT accumulate (12 would be strictly worse)').toBe(6);
    expect(s.flagCopies?.runeReturningPack, 'the copy count is the payout multiplier').toBe(2);
  });
});

describe('family 3 — repeat runes: +1 repetition per copy', () => {
  it('two Rune of the Wishbone make the hero power fire 3 times', () => {
    expect(wishboneReps(buy(fresh(), 'rune_wishbone'))).toBe(2);
    expect(wishboneReps(buyTwice('rune_wishbone'))).toBe(3);
  });
});

describe('family 4 — one-shot runes: the reward simply fires again', () => {
  it('a second Rune of Small Fortune pays another 7 Gold', () => {
    const cost = RUNE_INDEX['rune_small_fortune']!.cost;
    const one = buy(fresh(), 'rune_small_fortune');
    const two = buy({ ...one, embers: 30 } as RunState, 'rune_small_fortune');
    expect(one.embers).toBe(30 - cost + 7);
    expect(two.embers, 'the duplicate re-grants — never a dead buy').toBe(30 - cost + 7);
  });

  it('a second Treasure Map schedules its OWN payout instead of resetting the first', () => {
    const s = buyTwice('rune_treasure_map');
    expect(s.runeTreasureMaps).toEqual([{ turns: 2, gold: 10 }, { turns: 2, gold: 10 }]);
  });

  it('a second Rune of the Muster arms a second muster refresh (owner: "the first 2 refreshes this turn")', () => {
    expect(buyTwice('rune_muster').runeMuster).toBe(2);
  });

  it('a duplicate whose immediate value is impossible BANKS to next turn (owner: the Armory / an empty-board Altar)', () => {
    // Altar with an empty board: nothing to sell now — the re-fire is scheduled for the next shop instead.
    const s = buyTwice('rune_altar', { board: [] });
    expect(s.pendingQuestRewards).toEqual([{ questId: 'rune_altar', turnsLeft: 1 }]);
  });
});

describe('family 5 — boolean combat flags fire once per copy', () => {
  const bannerBuff = (mods: QuestCombatMods): number => {
    const player: BoardMinion[] = [{ cardId: 'pack', attack: 3, health: 400 }];
    const r = simulate(player, [{ cardId: 'sandbag', attack: 0, health: 50 }], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, questMods: mods }), combatSide({ tier: 6 }));
    return r.events
      .filter((e): e is Extract<typeof e, { type: 'buff' }> => e.type === 'buff' && (e as { source?: string }).source === 'Rune of the Five Banners')
      .reduce((n, e) => n + (e as { attack: number }).attack, 0);
  };

  it('two Rune of the Five Banners grant +12/+12 (the owner\'s "+6/+6 twice")', () => {
    const one = bannerBuff(questCombatMods(buy(fresh(), 'rune_five_banners')));
    const two = bannerBuff(questCombatMods(buyTwice('rune_five_banners')));
    expect(one).toBe(6);
    expect(two).toBe(12);
  });
});

describe('family 6 — the universal sweetener floor', () => {
  it('a duplicate Rune of Twin Gilding pays half its cost (rounded up) in Gold plus a free refresh', () => {
    const cost = RUNE_INDEX['rune_twin_gilding']!.cost; // 7
    const one = buy(fresh(), 'rune_twin_gilding');
    const rollsBefore = one.freeRolls;
    const two = buy({ ...one, embers: 30 } as RunState, 'rune_twin_gilding');
    expect(two.embers, 'Gold = ceil(cost/2) net of the price paid').toBe(30 - cost + Math.ceil(cost / 2));
    expect(two.freeRolls, 'plus one free refresh').toBe(rollsBefore + 1);
    expect(two.runeTwinGilding, 'the original effect is untouched').toBe(true);
    expect(two.runeStacks?.['rune_twin_gilding'], 'the sweetener never ticks the stack').toBe(1);
  });

  it('Rune of Duplication landing on a non-stacking Epic pays the sweetener too', () => {
    const cost = RUNE_INDEX['rune_twin_gilding']!.cost;
    const s = reduce(
      { ...fresh({ runeDuplication: true, runeforgeEpic: true }), runeforgeOffer: ['rune_twin_gilding'], embers: 30 } as RunState,
      { type: 'buyRune', index: 0 },
    );
    // First application is the real reward; the Duplication copy is a duplicate → sweetener.
    expect(s.runeTwinGilding).toBe(true);
    expect(s.embers).toBe(30 - cost + Math.ceil(cost / 2));
    expect(s.freeRolls).toBeGreaterThanOrEqual(1);
    expect(s.ownedRunes?.filter((id) => id === 'rune_twin_gilding').length, 'the copy is still a badge you hold').toBe(2);
  });
});

describe('family 7 — the forge filter', () => {
  it('an owned sweetener-only (or unique) rune is filtered; stacking runes stay offerable', () => {
    const owned = fresh({ ownedRunes: ['rune_twin_gilding', 'rune_ornate_clock', 'rune_flagship'] });
    expect(forgeFilteredDuplicate(owned, 'rune_twin_gilding'), 'sweetener-only + owned → filtered').toBe(true);
    expect(forgeFilteredDuplicate(owned, 'rune_ornate_clock'), 'unique + owned → filtered').toBe(true);
    expect(forgeFilteredDuplicate(owned, 'rune_flagship'), 'a stacking rune is a real purchase').toBe(false);
    expect(forgeFilteredDuplicate(fresh(), 'rune_twin_gilding'), 'unowned → offerable').toBe(false);
  });

  it('every classified rune id actually exists', () => {
    for (const id of [...RUNE_DUP_SWEETENER, ...RUNE_DUP_UNIQUE]) expect(RUNE_INDEX[id], id).toBeTruthy();
  });
});

describe('the unique rune — Rune of the Ornate Clock', () => {
  it('a duplicate does nothing at all (owner: "that one is unique")', () => {
    const one = buy(fresh(), 'rune_ornate_clock');
    const cost = RUNE_INDEX['rune_ornate_clock']!.cost;
    const two = buy({ ...one, embers: 30 } as RunState, 'rune_ornate_clock');
    expect(two.embers, 'only the price moved — no re-grant, no sweetener').toBe(30 - cost);
    expect(two.freeRolls).toBe(one.freeRolls);
  });
});

describe('Rune of Held Strength — the owner\'s embedded rework (Start of Combat grant)', () => {
  const minionInHand = { uid: 'h0', cardId: 'pack', tribe: 'beast', attack: 5, health: 6, keywords: [] } as unknown as RunState['hand'][number];

  it('buying it no longer buffs immediately — it arms a Start-of-Combat grant read live off the hand', () => {
    const s = buy(fresh({ board: [dwarf('d0')], hand: [minionInHand] }), 'rune_held_strength');
    expect(s.board[0]!.attack, 'no immediate one-shot buff any more').toBe(2);
    expect(s.runeHeldStrength).toBe(true);
    expect(questCombatMods(s).runeHeldStrength).toEqual({ attack: 5, health: 6, copies: 1 });
  });

  it('at Start of Combat the left and right-most minions gain the held stats — once per copy', () => {
    const run = (copies: number): number => {
      const mods: QuestCombatMods = { runeHeldStrength: { attack: 5, health: 6, copies } };
      const player: BoardMinion[] = [
        { cardId: 'pack', attack: 3, health: 300 },
        { cardId: 'stray', attack: 1, health: 300 },
      ];
      const r = simulate(player, [{ cardId: 'sandbag', attack: 0, health: 50 }], makeRng(9), CARD_INDEX,
        combatSide({ tier: 6, questMods: mods }), combatSide({ tier: 6 }));
      return r.events
        .filter((e) => e.type === 'buff' && (e as { source?: string }).source === 'Rune of Held Strength')
        .reduce((n, e) => n + (e as { attack: number }).attack, 0);
    };
    expect(run(1), 'both ends gain the held Attack').toBe(10);
    expect(run(2), 'a duplicate fires the grant twice').toBe(20);
  });

  it('an empty (or spell-leading) hand grants nothing this fight', () => {
    const s = buy(fresh({ board: [dwarf('d0')], hand: [] }), 'rune_held_strength');
    expect(questCombatMods(s).runeHeldStrength).toBeUndefined();
  });
});

describe('family 8 — unique engines double where a sensible doubling exists', () => {
  it('two Rune of Thrift make stat spells cost 4 less', () => {
    const statSpell = Object.values(CARD_INDEX).find((c) => c && c.spell && c.effects.some((e) => e.on === 'cast' && e.do.startsWith('spellBuff')))!;
    const one = buy(fresh(), 'rune_thrift');
    const two = buy(one, 'rune_thrift');
    expect(spellCostReduction(two, statSpell) - spellCostReduction(one, statSpell)).toBe(2);
    expect(spellCostReduction(two, statSpell)).toBe(4);
  });
});
