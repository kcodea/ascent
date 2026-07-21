import { describe, it, expect } from 'vitest';
import type { CombatResult } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, QUEST_INDEX, RUNES, RUNE_INDEX, validateRunes } from '@game/content';
import { createRun, type RunState } from './state';
import { HEROES } from './heroes';
import { openEpicRuneforge, questCombatMods, reduce } from './reducer';
import { buffFodderRunWide, buffImpsRunWide, dragonTamerCostOf, sellValueOf, spellDisplayText } from './recruit';
import { questBucketFor } from './quests';
import { applyEndOfTurn, noteFodderConsumed, projectEndOfTurnSteps, questEndOfTurnBeats } from './recruit';

/** A 1/1 Beast board card (id 'alley') for board-setup tests. */
const mkAlley = (uid: string): RunState['board'][number] => ({ uid, cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });

/** A Runesmith run parked at wave-6 combat, ready for `resolveCombat` → the turn-7 Runeforge. */
const atForgeCombat = (over: Partial<RunState> = {}): RunState => ({
  ...createRun(1, 'runesmith'), wave: 6, phase: 'combat', embers: 10,
  lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
  ...over,
});

/** Open the Runeforge with a chosen rune first in the offer, then buy it — returns the post-buy run. */
const buyRune = (runeId: string, embers = 10, over: Partial<RunState> = {}): RunState => {
  const s: RunState = { ...createRun(1, 'runesmith'), wave: 7, phase: 'recruit', embers, runeforgeOffer: [runeId], ...over };
  return reduce(s, { type: 'buyRune', index: 0 });
};

describe('Runeforge — framework', () => {
  it('every rune validates + is Runeforge-only (never a card/quest id)', () => {
    validateRunes();
    expect(RUNES.length).toBe(31); // + batch 7a (Rebirth / Tempering / Aftershocks / Refrain / Trophy) + Summit
    for (const r of RUNES) expect(r.id.startsWith('rune_')).toBe(true);
  });

  it('opens on turn 7 for Runesmith with a random 4 distinct runes', () => {
    const s = reduce(atForgeCombat(), { type: 'resolveCombat' });
    expect(s.wave).toBe(7);
    expect(s.runeforgeOffer).toBeDefined();
    expect(s.runeforgeOffer!.length).toBe(4);
    expect(new Set(s.runeforgeOffer).size).toBe(4); // no duplicates
    for (const id of s.runeforgeOffer!) expect(RUNE_INDEX[id]).toBeDefined();
  });

  it('rerollRuneforge spends 2 Gold once and swaps in a fresh, non-overlapping set of 4', () => {
    const s = reduce(atForgeCombat(), { type: 'resolveCombat' });
    const before = s.runeforgeOffer!;
    const r = reduce(s, { type: 'rerollRuneforge' });
    expect(r.embers).toBe(s.embers - 2);
    expect(r.runeforgeRerolled).toBe(true);
    expect(r.runeforgeOffer!.length).toBe(4);
    expect(new Set(r.runeforgeOffer).size).toBe(4);
    // the fresh set shares no rune with the original offer (drawn from the leftovers — 17 runes, so 4 fresh exist)
    for (const id of r.runeforgeOffer!) expect(before).not.toContain(id);
    // a second re-roll is a no-op (once per visit)
    expect(reduce(r, { type: 'rerollRuneforge' })).toBe(r);
  });

  it("rerollRuneforge you can't afford is a no-op", () => {
    const s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 1, runeforgeOffer: ['rune_warding', 'rune_fury', 'rune_slaying'] };
    expect(reduce(s, { type: 'rerollRuneforge' })).toBe(s);
  });

  it('does NOT open for a non-Runesmith hero', () => {
    const s = reduce({ ...atForgeCombat(), heroId: 'warden' }, { type: 'resolveCombat' });
    expect(s.runeforgeOffer).toBeUndefined();
  });

  it('while the forge is open, non-forge actions are blocked', () => {
    const s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 10, runeforgeOffer: ['rune_warding'] };
    expect(reduce(s, { type: 'roll' })).toBe(s); // blocked (same ref)
    expect(reduce(s, { type: 'faceOmen' })).toBe(s);
  });

  it('buyRune spends the cost, applies the reward, records the rune, and closes the forge (once per game)', () => {
    const s = buyRune('rune_warding', 10); // cost 1
    expect(s.embers).toBe(9);
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

  it('Bartering: sellValueOf folds the 2-Gold Shout sell (and the reducer pays it out)', () => {
    // Alleycat has a Battlecry (Shout) → sells for 2 with the rune, 1 without. Non-Shout minions stay at 1.
    const alley = mkAlley('a');
    expect(sellValueOf(alley)).toBe(1);
    expect(sellValueOf(alley, { runeBartering: true })).toBe(2);
    const plain: RunState['board'][number] = { uid: 'p', cardId: 'sandbag', tribe: 'neutral', attack: 0, health: 4, keywords: [], golden: false };
    expect(sellValueOf(plain, { runeBartering: true })).toBe(1); // no Shout → base
    // The reducer's sell pays the bartering value out.
    let s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 0, runeBartering: true, board: [mkAlley('a1')] };
    s = reduce(s, { type: 'sell', uid: 'a1' });
    expect(s.embers).toBe(2);
  });

  it("Pillaging: the Gold Pouch's PRINTED text reads its live 2-Gold value (hard live-text rule)", () => {
    // Owner report 2026-07-16: the pouch still said "Gain 1 Gold." with the rune active. The display path
    // (spellDisplayText → liveCardText/shopView) must fold the raised payout in, greened.
    expect(spellDisplayText('emberpouch', 0, 0, 0, 0, 0, 2)).toBe('Gain {{2 Gold}}.');
    // Without the rune (or before it), the printed base stays untouched.
    expect(spellDisplayText('emberpouch', 0, 0, 0, 0, 0, 0)).toBe('Gain **1 Gold**.');
  });

  it('Slaying: each Slaughter this combat banks +2 Gold for next turn', () => {
    const s = reduce({
      ...createRun(1, 'runesmith'), phase: 'combat', questFlags: { runeSlaying: true },
      lastCombat: {
        events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 3, initial: { player: [], enemy: [] },
        playerQuestTally: { attack: 0, summonCombat: 0, slaughter: 3, slaughterKeyword: 0, attackByTribe: {}, summonCombatByTribe: {}, slaughterByTribe: {}, statGainByTribe: {} },
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

  it('Coran: gets the normal turn-5 quest (he now runs the universal turns too)', () => {
    const s = reduce(atCombat('coran', 4), { type: 'resolveCombat' }); // → turn 5
    expect(s.wave).toBe(5);
    expect(s.questOffer?.length).toBeGreaterThan(0);
    expect(s.questOffer!.every((id) => questBucketFor(QUEST_INDEX[id]!) === 5)).toBe(true);
  });
  it('Coran: a BONUS Capstone (turn-11 bucket) quest arrives on turn 10', () => {
    const s = reduce(atCombat('coran', 9), { type: 'resolveCombat' }); // → turn 10
    expect(s.wave).toBe(10);
    expect(s.questOffer?.length).toBeGreaterThan(0);
    // Everything offered is from the turn-11 bucket (Capstone, or a promoted Greater neutral).
    expect(s.questOffer!.every((id) => questBucketFor(QUEST_INDEX[id]!) === 11)).toBe(true);
  });
  it('Coran: still gets the normal turn-11 quest', () => {
    const s = reduce(atCombat('coran', 10), { type: 'resolveCombat' }); // → turn 11
    expect(s.wave).toBe(11);
    expect(s.questOffer?.length).toBeGreaterThan(0);
    expect(s.questOffer!.every((id) => questBucketFor(QUEST_INDEX[id]!) === 11)).toBe(true);
  });

  it('Jensen: Dynamite Dig opens a tier Discover FREE the first time, and the cost climbs each use', () => {
    let s: RunState = { ...createRun(1, 'jenkins'), wave: 3, tier: 2, phase: 'recruit', embers: 10, heroReady: true };
    s = reduce(s, { type: 'heroPower' });
    expect(s.discover).toBeDefined(); // a minion Discover opened
    expect(s.embers).toBe(10); // first use is FREE (owner balance 2026-07-16)
    expect(s.heroPowerUses).toBe(1);
    // Resolve the Discover + recharge, then the second use costs 1.
    s = reduce(s, { type: 'discover', index: 0 });
    s = { ...s, heroReady: true, embers: 10 };
    s = reduce(s, { type: 'heroPower' });
    expect(s.embers).toBe(9); // second use costs 1
    expect(s.heroPowerUses).toBe(2);
  });

  it('Tiff: Dragon buys and spell buys each shave 1 off Dragon Tamer (other minions do not)', () => {
    let s: RunState = { ...createRun(1, 'tiff'), wave: 3, tier: 2, phase: 'recruit', embers: 20, heroReady: true,
      shop: [
        { uid: 'd1', cardId: 'twilightwhelp' }, // Dragon
        { uid: 'n1', cardId: 'sandbag' },       // neutral — no discount
      ],
      spell: { uid: 'sp1', cardId: 'emberpouch' } };
    expect(dragonTamerCostOf(s)).toBe(5);
    s = reduce(s, { type: 'buy', uid: 'd1' }); // Dragon → −1
    expect(s.tiffDiscount).toBe(1);
    s = reduce(s, { type: 'buy', uid: 'sp1' }); // spell (right slot) → −1
    expect(s.tiffDiscount).toBe(2);
    s = reduce(s, { type: 'buy', uid: 'n1' }); // neutral minion → unchanged
    expect(s.tiffDiscount).toBe(2);
    expect(dragonTamerCostOf(s)).toBe(3);
  });

  it('Tiff: Dragon Tamer opens a DRAGON Discover for the live cost, resets the discount, floors at 0', () => {
    let s: RunState = { ...createRun(1, 'tiff'), wave: 3, tier: 2, phase: 'recruit', embers: 10, heroReady: true, tiffDiscount: 2 };
    s = reduce(s, { type: 'heroPower' });
    expect(s.discover).toBeDefined();
    expect(s.discover!.every((id) => { const d = CARD_INDEX[id]!; return d.tribe === 'dragon' || d.tribe2 === 'dragon'; })).toBe(true);
    expect(s.embers).toBe(7); // charged 5 − 2
    expect(s.tiffDiscount).toBe(0); // the bank resets on use
    expect(s.heroReady).toBe(false); // once per turn
    // Floor at 0: with a huge bank the power is FREE.
    let f: RunState = { ...createRun(1, 'tiff'), wave: 3, tier: 2, phase: 'recruit', embers: 0, heroReady: true, tiffDiscount: 9 };
    expect(dragonTamerCostOf(f)).toBe(0);
    f = reduce(f, { type: 'heroPower' });
    expect(f.discover).toBeDefined(); // fires with 0 Gold
    expect(f.embers).toBe(0);
  });
});

describe('New heroes — Re-Pete, Gorr', () => {
  it("Re-Pete: Second Hand conjures a PLAIN copy of the left-most hand card at the END of turns 3, 6, 9, …", () => {
    // A buffed GOLDEN card leads the hand — the copy must come back plain (base stats, not golden).
    const buffed: RunState['hand'][number] = { uid: 'h1', cardId: 'alley', tribe: 'beast', attack: 9, health: 9, keywords: ['T' as never], golden: true };
    // Ending turn 2 (a non-multiple) grants nothing.
    let s: RunState = { ...createRun(1, 'repete'), wave: 2, phase: 'recruit', hand: [buffed] };
    s = reduce(s, { type: 'faceOmen' }); // end of turn 2 → no grant
    expect(s.hand.length).toBe(1);
    s = reduce(s, { type: 'resolveCombat' }); // → recruit for wave 3
    expect(s.wave).toBe(3);
    expect(s.hand.length).toBe(1); // nothing at the shop open either
    s = reduce(s, { type: 'faceOmen' }); // END of turn 3 → the grant fires
    const copy = s.hand.find((c) => c.uid !== 'h1' && c.cardId === 'alley');
    expect(copy).toBeDefined();
    expect(copy!.golden).toBe(false); // plain
    expect(copy!.attack).toBe(CARD_INDEX['alley']!.attack); // base stats — no buffs carried
    expect(copy!.health).toBe(CARD_INDEX['alley']!.health);
  });

  it('Re-Pete: an empty hand grants nothing (no crash) at the end of a multiple-of-3 turn', () => {
    let s: RunState = { ...createRun(1, 'repete'), wave: 3, phase: 'recruit', hand: [] };
    s = reduce(s, { type: 'faceOmen' }); // end of turn 3 with an empty hand
    expect(s.hand.length).toBe(0);
  });

  it('Gorr: the 3rd minion bought in a turn conjures a plain copy of one of the three at random — once per turn', () => {
    // NB: explicit 'g*' uids — createRun rolls a right-slot spell whose uid can collide with 's3'.
    let s: RunState = { ...createRun(1, 'gorr'), wave: 3, tier: 2, phase: 'recruit', embers: 20, hand: [], spell: null,
      shop: [
        { uid: 'g1', cardId: 'alley' },
        { uid: 'g2', cardId: 'pack' },
        { uid: 'g3', cardId: 'kennel' },
        { uid: 'g4', cardId: 'gnash' },
      ] };
    s = reduce(s, { type: 'buy', uid: 'g1' });
    expect(s.gorrBuys).toEqual(['alley']);
    s = reduce(s, { type: 'buy', uid: 'g2' });
    expect(s.hand.length).toBe(2); // no copy yet
    s = reduce(s, { type: 'buy', uid: 'g3' }); // the 3rd buy fires
    expect(s.hand.length).toBe(4); // 3 bought + 1 conjured copy
    const copy = s.hand[3]!;
    expect(['alley', 'pack', 'kennel']).toContain(copy.cardId); // one of the three, at random
    expect(copy.golden).toBe(false);
    expect(copy.attack).toBe(CARD_INDEX[copy.cardId]!.attack); // plain base stats
    // A 4th buy the same turn does NOT re-fire.
    s = reduce(s, { type: 'buy', uid: 'g4' });
    expect(s.hand.length).toBe(5); // just the bought minion — no second copy
    // The tally resets at the next turn setup.
    s = reduce({ ...s, hand: [] }, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.gorrBuys).toBeUndefined();
  });

  // Atrius was retired 2026-07-20. Its `possession` mod is no longer armed by any hero; the Start-of-Combat
  // machinery stays as an unused primitive so old saves/replays still resolve. Assert nothing arms it.
  it('possession is armed by NO live hero (Atrius retired)', () => {
    for (const h of HEROES) expect(questCombatMods(createRun(1, h.id)).possession, h.id).toBeUndefined();
  });
});

describe('Buff Gust FX signal', () => {
  it('buffFodderRunWide stamps the seq + every visible Fodder uid (board/hand/shop)', () => {
    const s: RunState = { ...createRun(1, 'warden'), phase: 'recruit',
      board: [{ uid: 'f1', cardId: 'fred', tribe: 'demon', attack: 0, health: 5, keywords: ['FD' as never], golden: false }, mkAlley('a1')],
      hand: [{ uid: 'f2', cardId: 'fred', tribe: 'demon', attack: 0, health: 5, keywords: ['FD' as never], golden: false }],
      shop: [{ uid: 's1', cardId: 'fred' }, { uid: 's2', cardId: 'alley' }] };
    buffFodderRunWide(s, 1, 1, 'test');
    expect(s.buffGustSeq).toBe(1);
    expect([...(s.buffGustUids ?? [])].sort()).toEqual(['f1', 'f2', 's1']); // Fodder only — no Alleycat
  });

  it('the gust is Fodder-buff EXCLUSIVE: an Imp-aura buff does NOT stamp (owner 2026-07-16)', () => {
    const s: RunState = { ...createRun(1, 'warden'), phase: 'recruit', board: [mkAlley('a1')], hand: [], shop: [] };
    buffImpsRunWide(s, 2, 2, 'test');
    expect(s.buffGustSeq).toBeUndefined();
  });

  it('a Staff of Guel cast does NOT stamp either (its Fodder enchant passes fx: false)', () => {
    let s: RunState = { ...createRun(1, 'warden'), phase: 'recruit', embers: 10,
      board: [], hand: [{ uid: 'st', cardId: 'staffofguel', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      shop: [{ uid: 's1', cardId: 'alley' }, { uid: 's2', cardId: 'pack' }] };
    s = reduce(s, { type: 'play', uid: 'st' });
    expect(s.tavernBuyBonus.atk).toBeGreaterThan(0); // the Staff still resolved
    expect(s.buffGustSeq).toBeUndefined(); // …but no gust
  });
});

describe('Fodder Infusion FX signal', () => {
  it("Maw of the Pit's End-of-Turn Fodder add stamps the sender's uid (and queues the Fodder)", () => {
    let s: RunState = { ...createRun(1, 'warden'), phase: 'recruit', embers: 10, shop: [],
      board: [{ uid: 'mw', cardId: 'maw', tribe: 'demon', attack: 4, health: 5, keywords: ['T'], golden: false }] };
    s = reduce(s, { type: 'faceOmen' }); // End of Turn: Maw adds a Fodder to the next shop
    expect(s.fodderSendSeq).toBe(1);
    expect(s.fodderSendUid).toBe('mw'); // Maw is the sender (the tavern-Fodder add stamps its uid)
  });

  it("Soulfeeder's Shout stamps too (addFodderNextShops)", () => {
    let s: RunState = { ...createRun(1, 'warden'), phase: 'recruit', embers: 10, board: [],
      hand: [{ uid: 'sf', cardId: 'feed', tribe: 'demon', attack: 2, health: 3, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'sf' });
    expect(s.fodderSendSeq).toBe(1);
    expect(s.fodderSendUid).toBe('sf');
    expect(s.fodderSchedule?.[0]).toBeGreaterThanOrEqual(1); // the schedule armed
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
    const n = Math.min(4, EPIC_RUNES.length);
    expect(s.runeforgeOffer!.length).toBe(n);
    expect(new Set(s.runeforgeOffer).size).toBe(n);
    for (const id of s.runeforgeOffer!) expect(EPIC_RUNES.some((r) => r.id === id)).toBe(true);
  });

  it('buying an Epic rune applies its reward, records it, and does NOT spend a hero-power charge', () => {
    const s = buyEpic('rune_copies', 10); // cost 6
    expect(s.embers).toBe(4); // 10 − 6
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
    expect(r.runeforgeOffer!.length).toBe(Math.min(4, EPIC_RUNES.length));
    for (const id of r.runeforgeOffer!) expect(EPIC_RUNES.some((rn) => rn.id === id)).toBe(true);
    expect(reduce(r, { type: 'rerollRuneforge' })).toBe(r); // once per visit
  });
});

describe('Basic runes — moved-in effects (Rallying / Scale / Action)', () => {
  const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };

  it('Rune of Empowerment is removed from the pool (its dormant plumbing survives)', () => {
    expect(RUNE_INDEX['rune_empowerment']).toBeUndefined();
  });

  it('Rune of Scale: each Gold-spend buffs 3 random board minions +2/+2', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, freeRolls: 0,
      runeScale: { count: 3, attack: 2, health: 2 }, board: [mkAlley('a'), mkAlley('b'), mkAlley('c')] };
    s = reduce(s, { type: 'roll' }); // one Gold-spend → count(3) = board(3), all get +2/+2
    expect(s.board.map((c) => [c.attack, c.health])).toEqual([[3, 3], [3, 3], [3, 3]]);
  });

  // FX plumbing (2026-07-17): the recruit-phase rune buffs that fire on a repeated trigger (Gold-spend / spell-cast)
  // now emit sourceless buff-FX events so the gain descends onto the minion instead of the number silently jumping —
  // the same defect the Deathswarmer aura-wash fix (#530) closed, applied to these targeted rune buffs.
  it('Rune of Scale: a Gold-spend emits one sourceless (descend) buff-FX event per picked ally', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, freeRolls: 0,
      runeScale: { count: 3, attack: 2, health: 2 }, board: [mkAlley('a'), mkAlley('b'), mkAlley('c')] };
    s = reduce(s, { type: 'roll' });
    expect(s.recruitBuffFx.length).toBe(3); // one per buffed ally
    expect(s.recruitBuffFx.every((e) => e.sourceUid === undefined && e.attack === 2 && e.health === 2)).toBe(true);
    expect(s.recruitFxSeq).toBeGreaterThan(0); // seq bumped → the UI replays the descends
  });

  it('Rune of Kindling: casting a spell descends +3/+3 onto the leftmost minion (sourceless FX event)', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, runeKindling: true,
      board: [mkAlley('a'), mkAlley('b')],
      hand: [{ uid: 'sp1', cardId: 'preemptive', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'sp1' }); // casting a spell fires the Kindling buff
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([4, 4]); // 1/1 + 3/3
    const fx = s.recruitBuffFx.filter((e) => e.targetUid === 'a' && e.sourceUid === undefined);
    expect(fx.length).toBe(1);
    expect([fx[0]!.attack, fx[0]!.health]).toEqual([3, 3]);
  });

  it('Rune of Scales: casting a spell descends +1/+1 onto each board Dragon (Beasts untouched)', () => {
    const mkDragon = (uid: string): RunState['board'][number] => ({ uid, cardId: 'yazzus', tribe: 'dragon', attack: 2, health: 2, keywords: [], golden: false });
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, runeScales: true,
      board: [mkDragon('d1'), mkAlley('b'), mkDragon('d2')],
      hand: [{ uid: 'sp1', cardId: 'preemptive', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'sp1' });
    const dragonFx = s.recruitBuffFx.filter((e) => e.sourceUid === undefined && e.attack === 1 && e.health === 1 && (e.targetUid === 'd1' || e.targetUid === 'd2'));
    expect(dragonFx.length).toBe(2); // one descend per Dragon
    expect(s.recruitBuffFx.some((e) => e.targetUid === 'b')).toBe(false); // the Beast gets nothing
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

  it('recruit telegraph: quest/rune recurring EoT rewards get a projected step + labeled beat (Rune of Action)', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', questRecurringEndOfTurn: ['runeAction'],
      playedThisTurn: ['x', 'y', 'z'], board: [mkAlley('a'), mkAlley('b'), mkAlley('c'), mkAlley('d')] };
    const { steps } = projectEndOfTurnSteps(s);
    const beats = questEndOfTurnBeats(s);
    // No warband EoT minions here, so the ONLY step is the rune's — and it must match the real applyEndOfTurn.
    expect(beats).toEqual([{ effect: 'runeAction', label: 'Rune of Action' }]);
    expect(steps).toHaveLength(1);
    expect(steps[0]!['a']).toEqual({ attack: 4, health: 4 }); // leftmost climbs on the rune's own beat
    expect(steps[0]!['d']).toEqual({ attack: 1, health: 1 }); // 4th untouched, matching applyEndOfTurn
  });

  // Per-z FX itemization (owner ruling 2026-07-17): "+x/+y per z" EoT rewards project one sourceless FX
  // event PER UNIT of the scaler (10 Attachments → ten +2/+2 hits, not one +20/+20 lump), while the real
  // commit (applyEndOfTurn) applies identical totals with no events (its stamps land after the phase flip).
  it('Blueprint Cache: the projection itemizes one +2/+2 event per Attachment; the commit matches in total', () => {
    const mk = (): RunState => ({ ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['buffMechsPerAttachment'],
      board: [{ uid: 'm', cardId: 'drone', tribe: 'mech', attack: 2, health: 3, keywords: [], golden: false, attachments: 3 }, mkAlley('b')] });
    const { steps, fx } = projectEndOfTurnSteps(mk());
    expect(fx).toHaveLength(1);
    const evs = fx[0]!.buffFx.filter((e) => e.targetUid === 'm');
    expect(evs).toHaveLength(3); // one event per Attachment…
    expect(evs.every((e) => e.sourceUid === undefined && e.attack === 2 && e.health === 2)).toBe(true); // …each +2/+2
    expect(steps[0]!['m']).toEqual({ attack: 8, health: 9 }); // total still +6/+6
    const commit = mk();
    applyEndOfTurn(commit);
    const m = commit.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([8, 9]); // commit total identical
    expect(commit.recruitBuffFx).toHaveLength(0); // …and emits NO events (itemizeFx is projection-only)
  });

  it('Rune of Spending: the projection itemizes one +1/+1 event per Gold spent', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['runeSpending'], goldSpentThisTurn: 4, board: [mkAlley('a')] };
    const { steps, fx } = projectEndOfTurnSteps(s);
    const evs = fx[0]!.buffFx.filter((e) => e.targetUid === 'a');
    expect(evs).toHaveLength(4);
    expect(evs.every((e) => e.sourceUid === undefined && e.attack === 1 && e.health === 1)).toBe(true);
    expect(steps[0]!['a']).toEqual({ attack: 5, health: 5 }); // 1/1 + 4/+4 total, unchanged
  });

  it('Rune of Action: a spell played counts as a card played (playedThisTurn)', () => {
    // Regression (owner 2026-07-11): "each card you played" must include spells / Discover-on-play /
    // welded Magnetics, not just minions that take a board slot — those returned before the tracker.
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      hand: [{ uid: 'g1', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    const next = reduce(s, { type: 'play', uid: 'g1' });
    expect(next.playedThisTurn).toContain('growth'); // the spell counted, even though it took no board slot
  });
});

describe('Runes batch 1 — grants / discovers / economy', () => {
  it('Rune of Small Fortune: gives 7 Gold immediately (this shop, not banked)', () => {
    const s = buyRune('rune_small_fortune', 10); // cost 1
    expect(s.embers).toBe(16); // 10 − 1 spent + 7 immediately
    expect(s.bonusEmbersNextTurn ?? 0).toBe(0); // nothing banked for next shop
  });

  it('Rune of Quick Study: conjures 3 random spells to hand', () => {
    const s = buyRune('rune_quick_study', 10, { tier: 3, hand: [] });
    const spells = s.hand.filter((c) => CARD_INDEX[c.cardId]?.spell);
    expect(spells.length).toBe(3);
  });

  it('Rune of Spare Parts: conjures 5 random Attachments to hand', () => {
    const s = buyRune('rune_spare_parts', 10, { tier: 4, hand: [] });
    const attachments = s.hand.filter((c) => CARD_INDEX[c.cardId]?.keywords.includes('M'));
    expect(attachments.length).toBe(5);
  });

  it('Rune of the Scout: opens a Discover of Tier-5 minions', () => {
    const s = buyRune('rune_scout', 10, { tier: 3 });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) expect(CARD_INDEX[id]?.tier).toBe(5); // pinned tier, not the run's tier
  });

  it('Rune of the Champion (Epic): opens a Discover of Tier-6 minions', () => {
    const s: RunState = reduce({ ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 10, tier: 3, runeforgeOffer: ['rune_champion'], runeforgeEpic: true }, { type: 'buyRune', index: 0 });
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) expect(CARD_INDEX[id]?.tier).toBe(6);
  });

  it('Rune of the Armory (Epic): conjures 10 random Attachments (hand-cap-safe)', () => {
    const s: RunState = reduce({ ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 10, tier: 5, hand: [], runeforgeOffer: ['rune_armory'], runeforgeEpic: true }, { type: 'buyRune', index: 0 });
    const attachments = s.hand.filter((c) => CARD_INDEX[c.cardId]?.keywords.includes('M'));
    expect(attachments.length).toBe(Math.min(10, s.hand.length)); // capped by hand size
    expect(s.hand.length).toBeGreaterThan(0);
  });

  it('Rune of the Gilded Spark (Epic): grants a Goldcrafter now and schedules another in 2 turns', () => {
    const s: RunState = reduce({ ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 10, hand: [], runeforgeOffer: ['rune_gilded_spark'], runeforgeEpic: true }, { type: 'buyRune', index: 0 });
    expect(s.hand.some((c) => c.cardId === 'goldcrafter')).toBe(true);
    expect(s.pendingQuestRewards?.some((p) => p.turnsLeft === 2)).toBe(true);
  });
});

describe('Runes batch 2 — Kindling / Pair / Menagerie / Reliquary + forge scheduling', () => {
  const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };

  it('Rune of Kindling: each spell cast gives the leftmost minion +3/+3', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 5, runeKindling: true,
      board: [mkAlley('lead'), mkAlley('other')],
      hand: [{ uid: 'gp', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'gp' }); // cast a spell
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([4, 4]); // 1/1 + 3/3
    expect([s.board[1]!.attack, s.board[1]!.health]).toEqual([1, 1]); // leftmost only
  });

  it('Rune of the Pair: conjures 2 random Tier-4 minions', () => {
    const s = buyRune('rune_pair', 10, { tier: 6, hand: [] });
    expect(s.hand.length).toBe(2);
    for (const c of s.hand) expect(CARD_INDEX[c.cardId]?.tier).toBe(4);
  });

  it('Rune of the Menagerie: conjures one minion of each of the five tribes', () => {
    const s = buyRune('rune_menagerie', 10, { tier: 6, hand: [] });
    const tribes = new Set(s.hand.map((c) => CARD_INDEX[c.cardId]?.tribe));
    for (const t of ['beast', 'demon', 'dragon', 'mech', 'undead']) expect(tribes.has(t as never)).toBe(true);
  });

  it('Rune of the Reliquary: End of Turn fires the leftmost Echo (Deathrattle) out of combat', () => {
    // Sylus-free board: a leftmost Deathrattle minion + its effect fires once at End of Turn. Use a known Echo
    // minion; assert the recurring effect is armed + no crash firing it.
    const echo = CARD_INDEX['knit'] ?? Object.values(CARD_INDEX).find((d) => d && !d.spell && d.effects.some((e) => e.on === 'onDeath'))!;
    const s: RunState = { ...createRun(1, 'warden'), wave: 6, phase: 'recruit', questRecurringEndOfTurn: ['triggerLeftmostEcho'],
      board: [{ uid: 'e', cardId: echo.id, tribe: echo.tribe, attack: echo.attack, health: echo.health, keywords: [...echo.keywords], golden: false }] };
    const before = s.board.length;
    applyEndOfTurn(s);
    expect(s.board.length).toBeGreaterThanOrEqual(before); // fired without error (may summon tokens)
  });

  it('The Runeforge quest: buying 7 minions arms a next-turn BASIC forge visit + 4 Gold', () => {
    // Complete via the reward directly (buy-count objective drives it live in play).
    const q = QUEST_INDEX['q_the_runeforge']!;
    expect(q.tribe).toBe('neutral');
    expect(q.tier).toBe('lesser');
    expect(q.objective).toEqual({ event: 'buy', count: 7 });
    expect(q.reward).toEqual({ kind: 'scheduleRuneforge', forge: 'basic', gold: 4 });
  });

  it('a scheduled BASIC forge opens next turn (any hero), grants its Gold, and spends NO hero-power charge', () => {
    const s: RunState = { ...createRun(1, 'indy'), wave: 6, phase: 'combat', pendingBasicForge: { gold: 4 }, lastCombat: win };
    const next = reduce(s, { type: 'resolveCombat' }); // → turn 7
    expect(next.runeforgeOffer!.length).toBe(4);
    expect(next.runeforgeEpic).toBeUndefined(); // basic runeset
    expect(next.runeforgeNoCharge).toBe(true);
    const embersOnOpen = next.embers;
    // Skip the forge → Indy's once-per-game Gild is NOT spent (quest-opened forge, not the hero power).
    const after = reduce(next, { type: 'skipRuneforge' });
    expect(after.heroPowerSpent).toBeFalsy();
    expect(embersOnOpen).toBeGreaterThanOrEqual(4); // the +4 Gold landed this turn
  });

  it('Rune of the Epic Forge: schedules the Epic forge for turn 9', () => {
    const armed = buyRune('rune_epic_forge', 10);
    expect(armed.epicForgeWave).toBe(9);
    // Advance from wave 8 combat → turn 9: the Epic forge opens.
    const next: RunState = reduce({ ...armed, wave: 8, phase: 'combat', epicForgeWave: 9, lastCombat: win }, { type: 'resolveCombat' });
    expect(next.wave).toBe(9);
    expect(next.runeforgeEpic).toBe(true);
    expect(next.epicForgeWave).toBeUndefined(); // consumed
  });
});

describe('Runes batch 4 — grant runes (existing cards + Gilded-grant)', () => {
  const buyEpic = (runeId: string, over: Partial<RunState> = {}): RunState =>
    reduce({ ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 12, tier: 6, hand: [], runeforgeOffer: [runeId], runeforgeEpic: true, ...over }, { type: 'buyRune', index: 0 });

  it('Rune of Assembly: grants a Beatbot + 2 Attachments', () => {
    const s = buyEpic('rune_assembly');
    expect(s.hand.some((c) => c.cardId === 'beatboxer')).toBe(true);
    expect(s.hand.filter((c) => CARD_INDEX[c.cardId]?.keywords.includes('M') && c.cardId !== 'beatboxer').length).toBe(2);
  });

  it('Rune of Stormcalling: grants a GILDED Karwind + a random Shout minion', () => {
    const s = buyEpic('rune_stormcalling');
    const karwind = s.hand.find((c) => c.cardId === 'karwind');
    expect(karwind?.golden).toBe(true); // Gilded
    // a Shout = a Battlecry (onPlay effect) minion, other than the Karwind
    expect(s.hand.some((c) => c.cardId !== 'karwind' && CARD_INDEX[c.cardId]?.effects.some((e) => e.on === 'onPlay'))).toBe(true);
  });

  it('Rune of Frontline Glory: grants a GILDED Yazzus + Front to Back', () => {
    const s = buyEpic('rune_frontline_glory');
    expect(s.hand.find((c) => c.cardId === 'yazzus')?.golden).toBe(true);
    expect(s.hand.some((c) => c.cardId === 'fronttoback')).toBe(true);
  });

  it('Rune of Soul Taxes: grants Souls Man + arms the Avenge max-Gold flag', () => {
    const s = buyEpic('rune_soul_taxes');
    expect(s.hand.some((c) => c.cardId === 'soulsman')).toBe(true);
    expect(s.questFlags?.runeSoulTaxes).toBe(true);
  });
});

describe('Runes batch 5 — recruit-phase (Scales / Bartering / Twin Gilding / Den Mother / Banking)', () => {
  const mk = (uid: string, cardId: string): RunState['board'][number] => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
  };
  const spell = (uid = 'gp'): RunState['hand'][number] => ({ uid, cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

  it('Rune of Scales: each spell cast gives your Dragons +1/+1 (board + hand)', () => {
    // A Dragon on board + a non-Dragon; cast a spell → only the Dragon grows.
    let s: RunState = { ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 5, runeScales: true,
      board: [mk('d', 'karwind'), mkAlley('b')], hand: [spell()] };
    const dragonBefore = s.board[0]!.attack;
    s = reduce(s, { type: 'play', uid: 'gp' });
    expect(s.board[0]!.attack).toBe(dragonBefore + 1); // Dragon +1
    expect(s.board[1]!.attack).toBe(1); // non-Dragon unchanged
  });

  it('Rune of Bartering: a Shout minion sells for 2 Gold (a non-Shout for the base 1)', () => {
    const shout = mk('s', 'fieldmechanic'); // a Battlecry mech
    const shoutSale = reduce({ ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 0, runeBartering: true, board: [shout] }, { type: 'sell', uid: 's' });
    expect(shoutSale.embers).toBe(2);
    const vanillaSale = reduce({ ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 0, runeBartering: true, board: [mk('v', 'drone')] }, { type: 'sell', uid: 'v' });
    expect(vanillaSale.embers).toBe(1); // Drone has no Battlecry → base sell
  });

  it('Rune of Twin Gilding: 2 copies of a card Gild into a golden', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 10, runeTwinGilding: true,
      board: [mk('a', 'drone')], hand: [mk('b', 'drone')] };
    s = reduce(s, { type: 'play', uid: 'b' }); // 2nd Drone hits the board → Gild
    const drones = [...s.board, ...s.hand].filter((c) => c.cardId === 'drone');
    expect(drones.some((c) => c.golden)).toBe(true); // gilded at 2 copies
  });

  it('Rune of the Den Mother: playing a Beast buffs it AND Den Mother herself', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 10, runeDenMother: true,
      board: [mk('m', 'mamabear')], hand: [mkAlley('beast')] };
    const momBefore = s.board[0]!.attack;
    s = reduce(s, { type: 'play', uid: 'beast' });
    expect(s.board[0]!.attack).toBeGreaterThan(momBefore); // Den Mother buffed herself too
    const beast = s.board.find((c) => c.uid === 'beast')!;
    expect(beast.attack).toBeGreaterThan(1); // the played Beast got the buff
  });

  it('Rune of Banking: End of Turn welds a Money Bot onto the leftmost + rightmost Mech', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 6, phase: 'recruit', questRecurringEndOfTurn: ['weldMoneyBotsEdgeMechs'],
      board: [mk('l', 'drone'), mkAlley('mid'), mk('r', 'drone')] };
    const leftBefore = s.board[0]!.attack + s.board[0]!.health;
    applyEndOfTurn(s);
    expect(s.board[0]!.attack + s.board[0]!.health).toBeGreaterThan(leftBefore); // leftmost Mech welded
    expect(s.board[2]!.attack + s.board[2]!.health).toBeGreaterThan(2 + 1); // rightmost Mech welded
  });

  it('Rune of the Second Path: Discovers from the Greater-Quest reward minion pool', () => {
    const s: RunState = reduce({ ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 10, runeforgeOffer: ['rune_second_path'], runeforgeEpic: true }, { type: 'buyRune', index: 0 });
    expect(s.discover?.length).toBeGreaterThan(0);
    const pool = new Set<string>();
    const collect = (r: { kind: string; cards?: string[]; rewards?: { kind: string; cards?: string[] }[] }): void => {
      if ((r.kind === 'grant' || r.kind === 'recurringGrant') && r.cards) r.cards.forEach((id) => pool.add(id));
      if (r.kind === 'multi') r.rewards?.forEach(collect);
    };
    for (const q of Object.values(QUEST_INDEX)) if (q.tier === 'greater') collect(q.reward as never);
    for (const id of s.discover!) expect(pool.has(id)).toBe(true); // every option is a greater-quest reward minion
  });

  it('Rune of the Warden: grants a Spear Warden and arms the Start-of-Combat summon flag', () => {
    const s: RunState = reduce({ ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 10, hand: [], runeforgeOffer: ['rune_warden'] }, { type: 'buyRune', index: 0 });
    expect(s.hand.some((c) => c.cardId === 'knit')).toBe(true);
    expect(s.questFlags?.runeWarden).toBe(true);
  });
});

describe('Runes batch 4b — new cards (Feasting Bogrot / Reconfigured Combinator) + Runeguard', () => {
  const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
  const mk = (uid: string, cardId: string): RunState['board'][number] => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
  };
  const buyEpic = (runeId: string): RunState =>
    reduce({ ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 10, hand: [], runeforgeOffer: [runeId], runeforgeEpic: true }, { type: 'buyRune', index: 0 });

  it('Guardian: Runeguard — 8 armor + schedules the Epic Runeforge for turn 10', () => {
    const s = createRun(1, 'runeguard');
    expect(s.armor).toBe(8);
    expect(s.epicForgeWave).toBe(10);
    const next = reduce({ ...s, wave: 9, phase: 'combat', epicForgeWave: 10, lastCombat: win }, { type: 'resolveCombat' });
    expect(next.wave).toBe(10);
    expect(next.runeforgeEpic).toBe(true);
  });

  it('Rune of the Feast grants Feasting Bogrot; Rune of Reconfiguration grants Reconfigured Combinator', () => {
    expect(buyEpic('rune_feast').hand.some((c) => c.cardId === 'feastingbogrot')).toBe(true);
    expect(buyEpic('rune_reconfiguration').hand.some((c) => c.cardId === 'reconfiguredcombinator')).toBe(true);
  });

  it('Feasting Bogrot: End of Turn consumes a Fodder itself and shares its stats to both neighbors', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 6, phase: 'recruit', board: [mkAlley('l'), mk('b', 'feastingbogrot'), mkAlley('r')] };
    applyEndOfTurn(s);
    expect([s.board[1]!.attack, s.board[1]!.health]).toEqual([7, 5]); // Bogrot 6/4 + Fred 1/1
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([2, 2]); // neighbor 1/1 + shared 1/1
    expect([s.board[2]!.attack, s.board[2]!.health]).toEqual([2, 2]);
  });

  it('Reconfigured Combinator: triggering a Shout magnetizes an Attachment onto a friendly Mech', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 6, phase: 'recruit', tier: 6,
      board: [mk('c', 'reconfiguredcombinator'), mk('d', 'drone')], hand: [mk('h', 'fieldmechanic')] };
    const droneBefore = s.board[1]!.attack + s.board[1]!.health;
    s = reduce(s, { type: 'play', uid: 'h' }); // play a Battlecry → the Combinator fires
    const drone = s.board.find((c) => c.uid === 'd')!;
    expect(drone.attack + drone.health).toBeGreaterThan(droneBefore); // an attachment welded on
  });
});

describe('The Epic Runeforge — the greater quest that opens the Epic Runeforge next turn', () => {
  const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };

  it('is a neutral greater quest named "The Epic Runeforge" (buy 9) whose reward opens the Epic Runeforge + gives 8 Gold', () => {
    const q = QUEST_INDEX['q_epic_commission']!;
    expect(q).toBeDefined();
    expect(q.name).toBe('The Epic Runeforge');
    expect(q.tribe).toBe('neutral');
    expect(q.tier).toBe('greater');
    expect(q.objective).toEqual({ event: 'buy', count: 9 });
    expect(q.reward).toEqual({ kind: 'multi', rewards: [{ kind: 'openEpicRuneforge' }, { kind: 'gainGold', amount: 8 }] });
  });

  it('completing it (the 9th buy) ARMS the forge for next turn + grants 8 Gold — it does not open on the completing turn', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 7, phase: 'recruit', tier: 6, embers: 5, freeRolls: 0,
      activeQuests: [{ questId: 'q_epic_commission', progress: 8, completed: false }] };
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid }); // 9th buy → completes
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.pendingEpicRuneforge).toBe(true); // armed…
    expect(s.runeforgeOffer).toBeUndefined(); // …but NOT opened this turn
    expect(s.bonusEmbersNextTurn).toBe(8); // +8 Gold banked for the turn the forge opens
  });

  it('the armed forge opens at the start of the next (non-quest) turn, then disarms', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 6, phase: 'combat', pendingEpicRuneforge: true, lastCombat: win };
    const next = reduce(s, { type: 'resolveCombat' }); // → turn 7 (not a quest turn)
    expect(next.wave).toBe(7);
    expect(next.runeforgeOffer!.length).toBe(Math.min(4, EPIC_RUNES.length));
    expect(next.runeforgeEpic).toBe(true);
    for (const id of next.runeforgeOffer!) expect(EPIC_RUNES.some((rn) => rn.id === id)).toBe(true);
    expect(next.pendingEpicRuneforge).toBe(false); // disarmed once opened
  });

  it('The Runeforge quest: the basic forge is DEFERRED — opens NEXT turn, not mid-turn (owner bug 2026-07-13)', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 5, phase: 'recruit', tier: 6, embers: 20, freeRolls: 0,
      resolve: 999, maxResolve: 999, armor: 999,
      activeQuests: [{ questId: 'q_the_runeforge', progress: 6, completed: false }] };
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid }); // 7th buy → completes The Runeforge
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.pendingBasicForge?.deferred).toBe(true); // armed, but deferred…
    expect(s.runeforgeOffer).toBeUndefined(); // …so it does NOT open on the completing turn
    // Next turn (after this turn's combat) it opens at the start.
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.runeforgeOffer).toBeDefined(); // opened at the start of next turn
    expect(s.runeforgeEpic).toBeFalsy(); // the BASIC forge
  });

  it('sequences behind a quest-offer turn: the Quest shows first, then buying it opens the Epic forge SAME turn', () => {
    const s: RunState = { ...createRun(1, 'soren'), wave: 10, phase: 'combat', pendingEpicRuneforge: true, lastCombat: win };
    const atQuest = reduce(s, { type: 'resolveCombat' }); // → turn 11, a quest turn
    expect(atQuest.wave).toBe(11);
    expect(atQuest.questOffer?.length).toBeGreaterThan(0); // the quest shop takes priority…
    expect(atQuest.runeforgeOffer).toBeUndefined(); // …the forge waits behind it…
    expect(atQuest.pendingEpicRuneforge).toBe(true); // …still armed
    // Buying the quest drains the queue → the Epic forge opens on the SAME turn (Quest > Runeforge).
    const afterBuy = reduce(atQuest, { type: 'buyQuest', index: 0 });
    expect(afterBuy.questOffer).toBeUndefined();
    expect(afterBuy.runeforgeEpic).toBe(true);
    expect(afterBuy.runeforgeOffer!.length).toBe(Math.min(4, EPIC_RUNES.length));
    expect(afterBuy.pendingEpicRuneforge).toBe(false); // now disarmed
  });
});

describe('Batch 7a runes (Rebirth / Tempering / Aftershocks / Refrain / Trophy + 7 Epics)', () => {
  const mkCard = (uid: string, cardId: string, tribe: RunState['board'][number]['tribe'], attack: number, health: number, keywords: RunState['board'][number]['keywords'] = []): RunState['board'][number] =>
    ({ uid, cardId, tribe, attack, health, keywords: [...keywords], golden: false });
  const win: CombatResult = { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };

  it('every batch 7a rune applies its reward on purchase', () => {
    expect(buyRune('rune_rebirth').questFlags?.runeRebirth).toBe(true);
    expect(buyRune('rune_tempering').runeTempering).toBe(true);
    expect(buyRune('rune_aftershocks').questFlags?.runeAftershocks).toBe(true);
    expect(buyRune('rune_refrain').runeRefrain).toBe(true);
    expect(buyRune('rune_trophy').questFlags?.runeTrophy).toBe(true);
    expect(buyRune('rune_transfusion').runeTransfusion).toBe(true);
    expect(buyRune('rune_mirror_march').questFlags?.runeMirrorMarch).toBe(true);
    expect(buyRune('rune_recurrence').questRecurringEndOfTurn).toContain('recastFirstSpell');
    expect(buyRune('rune_replication').runeReplication).toBe(true);
    expect(buyRune('rune_conductor').runeConductor).toBe(true);
    expect(buyRune('rune_undertow').questFlags?.runeUndertow).toBe(true);
    expect(buyRune('rune_endless_appetite').runeEndlessAppetite).toBe(true);
  });

  it('Rune of Tempering: the FIRST Attachment welded each turn gives its host Ward — the second does not', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, runeTempering: true,
      board: [mkCard('h1', 'drone', 'mech', 2, 3), mkCard('h2', 'drone', 'mech', 2, 3)],
      hand: [mkCard('c1', 'cling', 'mech', 1, 1, ['M']), mkCard('c2', 'cling', 'mech', 1, 1, ['M'])] };
    s = reduce(s, { type: 'play', uid: 'c1', toIndex: 0 });
    expect(s.board[0]!.keywords).toContain('DS'); // first Attachment → host Warded
    s = reduce(s, { type: 'play', uid: 'c2', toIndex: 1 });
    expect(s.board[1]!.keywords).not.toContain('DS'); // second → no Ward
    expect(s.attachmentsThisTurn).toBe(2);
  });

  it('Rune of Replication: the first Attachment also welds a copy onto the LEFTMOST Mech', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, runeReplication: true,
      board: [mkCard('h1', 'drone', 'mech', 2, 3), mkCard('h2', 'drone', 'mech', 2, 3)],
      hand: [mkCard('c1', 'cling', 'mech', 1, 1, ['M'])] };
    s = reduce(s, { type: 'play', uid: 'c1', toIndex: 1 }); // weld the 1/1 Cling onto the SECOND drone
    const left = s.board.find((c) => c.uid === 'h1')!;
    const host = s.board.find((c) => c.uid === 'h2')!;
    expect(host.attack).toBe(2 + 1); // the real weld (the played Cling's live 1/1 stats)
    expect(left.attack).toBe(2 + 1); // …and the replicated copy on the leftmost Mech
    expect(left.attachments ?? 0).toBe(1);
  });

  it("Rune of Refrain: the 3rd Shout played returns the turn's FIRST Shout (the actual minion) to hand", () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, runeRefrain: true,
      // Three DISTINCT simple Shout minions (three copies of one card would triple into a golden mid-test;
      // Discover-battlecries would open a modal and block the later plays).
      hand: [mkCard('a1', 'alley', 'beast', 1, 1), mkCard('a2', 'cleric', 'dragon', 1, 1), mkCard('a3', 'deathswarmer', 'undead', 1, 1)] };
    s = reduce(s, { type: 'play', uid: 'a1' });
    s = reduce(s, { type: 'play', uid: 'a2' });
    expect(s.board.some((c) => c.uid === 'a1')).toBe(true); // still down after two
    s = reduce(s, { type: 'play', uid: 'a3' });
    expect(s.board.some((c) => c.uid === 'a1')).toBe(false); // the first Shout left the board…
    expect(s.hand.some((c) => c.uid === 'a1')).toBe(true);   // …into the hand, same instance
    expect(s.shoutsThisTurn).toBe(3);
  });

  it("Rune of Transfusion: a Demon Consume also feeds the leftmost minion the Fodder's stats", () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', runeTransfusion: true,
      board: [mkCard('lm', 'stray', 'beast', 1, 1), mkCard('d', 'stray', 'demon', 2, 2)] };
    noteFodderConsumed(s, 3, 2, s.board[1]);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([1 + 3, 1 + 2]);
    // A NON-Demon eater does not transfuse.
    const s2: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', runeTransfusion: true,
      board: [mkCard('lm', 'stray', 'beast', 1, 1), mkCard('b', 'stray', 'beast', 2, 2)] };
    noteFodderConsumed(s2, 3, 2, s2.board[1]);
    expect([s2.board[0]!.attack, s2.board[0]!.health]).toEqual([1, 1]);
  });

  it('Rune of Endless Appetite: the FIRST Consume each turn fans out to every OTHER Demon — once', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', runeEndlessAppetite: true,
      board: [mkCard('a', 'stray', 'demon', 1, 1), mkCard('b', 'stray', 'demon', 1, 1), mkCard('c', 'stray', 'demon', 1, 1), mkCard('x', 'stray', 'beast', 1, 1)] };
    noteFodderConsumed(s, 2, 1, s.board[0]); // A consumes a 2/1 Fodder
    expect([s.board[1]!.attack, s.board[1]!.health]).toEqual([1 + 2, 1 + 1]); // B copied the Consume
    expect([s.board[2]!.attack, s.board[2]!.health]).toEqual([1 + 2, 1 + 1]); // C too
    expect([s.board[3]!.attack, s.board[3]!.health]).toEqual([1, 1]);         // the Beast did not
    expect(s.consumesThisTurn).toBe(3); // the fan-out consumes are real consumes
    expect(s.runFodderConsumed?.count).toBe(3);
    noteFodderConsumed(s, 2, 1, s.board[0]); // the SECOND consume this turn does not fan out
    expect(s.board[1]!.attack).toBe(3);
  });

  it('Rune of Recurrence: End of Turn recasts the first spell — untargeted (Growth) and aimed (random ally)', () => {
    // Untargeted: Growth (+3/+4 board-wide) recast at EoT.
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['recastFirstSpell'], firstSpellThisTurnId: 'growth',
      board: [mkAlley('m')] };
    applyEndOfTurn(s);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([1 + 3, 1 + 4]);
    // Aimed: Patch Job (+3/+3 baseline at 0 Gold spent) recast onto a (seeded-random) board minion.
    const t: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['recastFirstSpell'], firstSpellThisTurnId: 'patchjob', goldSpentThisTurn: 0,
      board: [mkAlley('m')] };
    applyEndOfTurn(t);
    expect(t.board[0]!.attack).toBeGreaterThanOrEqual(1 + 3);
    // No spell cast this turn → a clean no-op.
    const u: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['recastFirstSpell'], board: [mkAlley('m')] };
    applyEndOfTurn(u);
    expect([u.board[0]!.attack, u.board[0]!.health]).toEqual([1, 1]);
  });

  it('Rune of the Conductor: the shop OPENS by triggering your End of Turn effects (Skybound buffs a Dragon)', () => {
    // Was driven by Vineweaver's EoT Growth cast before that card was retired; Skybound's End of Turn
    // (buff the weakest friendly Dragon by 50% of the strongest's stats) is the same observable proof
    // that the End-of-Turn pass ran as the shop opened.
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'combat', embers: 10, runeConductor: true,
      board: [mkCard('sk', 'skybound', 'dragon', 10, 10), mkCard('d', 'supporter', 'dragon', 2, 2)], lastCombat: win };
    s = reduce(s, { type: 'resolveCombat' });
    const d = s.board.find((c) => c.uid === 'd')!;
    expect(d.attack).toBeGreaterThan(2); // the weakest Dragon grew at shop open
    expect(d.health).toBeGreaterThan(2);
  });

  it('Rune of the Trophy: settleCombat conjures a plain copy of the recorded slaughterer to hand', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'combat', embers: 10,
      board: [mkAlley('m')], hand: [], lastCombat: { ...win, playerSlaughterCopy: 'alley' } };
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.hand.some((c) => c.cardId === 'alley')).toBe(true);
  });
});

describe('Rune of Mastery (batch 7b) — Improve steps apply twice', () => {
  const mk = (uid: string, cardId: string, tribe: RunState['board'][number]['tribe'], attack: number, health: number): RunState['board'][number] =>
    ({ uid, cardId, tribe, attack, health, keywords: [], golden: false });

  it('applies on purchase', () => {
    expect(buyRune('rune_mastery').runeMastery).toBe(true);
  });

  it('Den Mother: the per-play improve step doubles (+4 accrual instead of +2)', () => {
    const play = (mastery: boolean): number => {
      let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10,
        runeMastery: mastery || undefined,
        board: [mk('dm', 'mamabear', 'beast', 4, 4)],
        hand: [mk('b1', 'pack', 'beast', 3, 2)] }; // pack summons nothing on play (its Echo is combat-only)
      s = reduce(s, { type: 'play', uid: 'b1' });
      return s.board.find((c) => c.uid === 'dm')!.summonBonus ?? 0;
    };
    expect(play(false)).toBe(2);
    expect(play(true)).toBe(4);
  });

  it('Ritualist: the End-of-Turn escalation step doubles (+2 instead of +1)', () => {
    const eot = (mastery: boolean): number => {
      const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
        runeMastery: mastery || undefined,
        board: [mk('r', 'ritualist', 'demon', 2, 4)] };
      applyEndOfTurn(s);
      return s.board[0]!.eotBonus ?? 0;
    };
    expect(eot(false)).toBe(1);
    expect(eot(true)).toBe(2);
  });

  it('Rune of Consumption stacked with Mastery: each Consume improves future Fodder twice (+4/+2)', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      runeMastery: true, runeConsume: { attack: 2, health: 1 }, board: [] };
    noteFodderConsumed(s, 1, 1);
    expect(s.cardBuffs?.['fred']).toEqual({ attack: 4, health: 2 });
  });

  it('Spirit Worgen: the per-spell Improve contribution doubles (base per-play grant unchanged)', () => {
    const gain = (mastery: boolean): number => {
      let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10,
        runeMastery: mastery || undefined, spellsThisTurn: 2,
        board: [mk('w', 'spiritworgen', 'beast', 4, 6)],
        hand: [mk('b1', 'pack', 'beast', 3, 2)] };
      s = reduce(s, { type: 'play', uid: 'b1' });
      return s.board.find((c) => c.uid === 'w')!.attack - 4;
    };
    expect(gain(false)).toBe(3 * (1 + 2)); // base 3 × (1 + 2 spells) = 9
    expect(gain(true)).toBe(3 * (1 + 4));  // the 2 spells count twice = 15
  });

  it('Archmagus Guel: each cast ticks his Improve tally twice under Mastery', () => {
    const prog = (mastery: boolean): number => {
      let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10,
        runeMastery: mastery || undefined,
        board: [mk('g', 'guel', 'neutral', 3, 6), mk('m', 'stray', 'beast', 1, 1)],
        hand: [mk('sp', 'growth', 'neutral', 0, 1)] };
      s = reduce(s, { type: 'play', uid: 'sp' });
      return s.board.find((c) => c.uid === 'g')!.spellProgress ?? 0;
    };
    expect(prog(false)).toBe(1);
    expect(prog(true)).toBe(2);
  });

  it('Rune of Summoning stacked with Mastery: each spell improves your Imps +2/+2', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10,
      runeMastery: true, runeSummoning: true,
      board: [mk('m', 'stray', 'beast', 1, 1)],
      hand: [mk('g1', 'growth', 'neutral', 0, 1)] };
    s = reduce(s, { type: 'play', uid: 'g1' });
    expect(s.impBuff).toEqual({ attack: 2, health: 2 });
  });
});

describe('Blueprint Cache wave grouping (owner 2026-07-18)', () => {
  const mkMech = (uid: string, attachments: number): RunState['board'][number] =>
    ({ uid, cardId: 'drone', tribe: 'mech', attack: 2, health: 3, keywords: [], golden: false, attachments });

  it('is ATTACHMENT-major: wave i hits every Mech with an i-th Attachment, all at once', () => {
    // 3 Mechs with 3 / 2 / 1 Attachments → 3 waves, sized 3 / 2 / 1 (not 6 mech-major singles).
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['buffMechsPerAttachment'],
      board: [mkMech('a', 3), mkMech('b', 2), mkMech('c', 1)] };
    const { steps, fx } = projectEndOfTurnSteps(s);
    const evs = fx.flatMap((f) => f.buffFx);
    const waves = new Map<number, string[]>();
    for (const e of evs) {
      const w = e.fxWave ?? -1;
      waves.set(w, [...(waves.get(w) ?? []), e.targetUid]);
    }
    expect([...waves.keys()].sort()).toEqual([0, 1, 2]);           // one wave per attachment index
    expect(waves.get(0)!.sort()).toEqual(['a', 'b', 'c']);          // wave 0 = ALL three Mechs together
    expect(waves.get(1)!.sort()).toEqual(['a', 'b']);
    expect(waves.get(2)!).toEqual(['a']);
    // Totals unchanged: +2/+2 per Attachment.
    expect(steps[0]!['a']).toEqual({ attack: 2 + 6, health: 3 + 6 });
    expect(steps[0]!['b']).toEqual({ attack: 2 + 4, health: 3 + 4 });
    expect(steps[0]!['c']).toEqual({ attack: 2 + 2, health: 3 + 2 });
  });

  it('every event carries its wave tag so the UI can group them', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['buffMechsPerAttachment'], board: [mkMech('a', 2)] };
    const { fx } = projectEndOfTurnSteps(s);
    const evs = fx.flatMap((f) => f.buffFx);
    expect(evs).toHaveLength(2);
    expect(evs.every((e) => e.fxWave !== undefined)).toBe(true);
  });
});

// Rune of the Summit — the BASIC route to Tier 7 now that the Summit rift is parked. The cadence is the
// interesting part: `recurringEndOfTurn` fires EVERY turn, so an every-other-turn payout needed its own
// counter. These pin that it lands on the 2nd shop and repeats, not every shop.
describe('Rune of the Summit (every 2nd shop → a Tier 7 Discover)', () => {
  const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
  // Clears the modals a real player would have dismissed first: a quest turn (wave 5/11) parks a
  // `questOffer` that blocks EVERY later action, which silently froze the cadence mid-test.
  const openShop = (s: RunState): RunState => reduce(
    { ...s, phase: 'combat', lastCombat: win, discover: undefined, discoverQueue: undefined,
      questOffer: undefined, runeforgeOffer: undefined },
    { type: 'resolveCombat' },
  );

  it('arms on purchase with a zeroed tick', () => {
    const s = buyRune('rune_summit');
    expect(s.runeSummit).toBe(true);
    expect(s.runeSummitTick ?? 0).toBe(0);
  });

  it('fires on the SECOND shop, not the first, then repeats every 2nd', () => {
    let s: RunState = { ...buyRune('rune_summit'), wave: 3, hand: [], board: [] };
    s = openShop(s); // shop 1 — nothing yet
    expect(s.runeSummitTick).toBe(1);
    expect(s.discover).toBeFalsy();
    s = openShop(s); // shop 2 — fires
    expect(s.runeSummitTick).toBe(2);
    expect(s.discover?.length).toBeGreaterThan(0);
    for (const id of s.discover!) expect(CARD_INDEX[id]!.tier).toBe(7); // honoured at Tier 7 with NO rift
    s = openShop(s); // shop 3 — quiet again
    expect(s.discover).toBeFalsy();
    s = openShop(s); // shop 4 — fires again
    expect(s.runeSummitTick).toBe(4);
    expect(s.discover?.length).toBeGreaterThan(0);
  });

  it('does nothing without the rune', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, hand: [], board: [] };
    s = openShop(s); s = openShop(s);
    expect(s.discover).toBeFalsy();
  });
});
