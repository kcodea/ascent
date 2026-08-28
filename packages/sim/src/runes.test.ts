import { describe, it, expect } from 'vitest';
import type { CombatResult } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, QUEST_INDEX, RUNES, RUNE_INDEX, runeSynergies, validateRunes } from '@game/content';
import { createRun, type RunState } from './state';
import { HEROES } from './heroes';
import { boardSynergyTags, openEpicRuneforge, questCombatMods, reduce } from './reducer';
import { buffFodderRunWide, buffImpsRunWide, dragonTamerCostOf, sellValueOf, spellDisplayText } from './recruit';
import { questBucketFor } from './quests';
import { applyEndOfTurn, noteFodderConsumed, projectEndOfTurnSteps, questEndOfTurnBeats } from './recruit';
import { pinSet1Era } from './testPin';

// This suite predates set 2 going live (2026-07-31) and tests set-1-era content + the quest-era run loop —
// still-shipped mechanics. Pin the era rather than rewrite the fixtures. See `testPin.ts`.
pinSet1Era();

/** A 1/1 Beast board card (id 'alley') for board-setup tests. */
const mkAlley = (uid: string): RunState['board'][number] => ({ uid, cardId: 'alley', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });

/** A Runesmith run parked at wave-4 combat, ready for `resolveCombat` → the turn-5 Runeforge. */
const atForgeCombat = (over: Partial<RunState> = {}): RunState => ({
  ...createRun(1, 'runesmith'), wave: 4, phase: 'combat', embers: 10,
  lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
  ...over,
});

/** Open the Runeforge with a chosen rune first in the offer, then buy it — returns the post-buy run. */
const buyRune = (runeId: string, embers = 10, over: Partial<RunState> = {}): RunState => {
  const s: RunState = { ...createRun(1, 'runesmith'), wave: 7, phase: 'recruit', embers, runeforgeOffer: [runeId], ...over };
  return reduce(s, { type: 'buyRune', index: 0 });
};

describe('Runeforge — synergy offers + pivot discounts (owner ask 2026-07-31)', () => {
  const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };
  const demonBoard = (): RunState['board'] => [
    { uid: 'd1', cardId: 'dm_wrangler', tribe: 'demon', attack: 2, health: 4, keywords: [], golden: false },
    { uid: 'd2', cardId: 'dm_clerk', tribe: 'demon', attack: 2, health: 2, keywords: [], golden: false },
  ];

  it('runeSynergies derives tags from the printed text', () => {
    expect(runeSynergies(RUNE_INDEX['rune_summoning']!)).toContain('demon'); // "improves your Imps"
    expect(runeSynergies(RUNE_INDEX['rune_adventuring']!)).toContain('rally'); // "Rally effects trigger twice"
    expect(runeSynergies(RUNE_INDEX['rune_gemcutting']!)).toContain('ruby');
    expect(runeSynergies(RUNE_INDEX['rune_profit_sharing']!)).toContain('dwarf');
  });

  it('a DEMON board is guaranteed at least one demon-following rune in the offer', () => {
    // 40 seeds: with the guarantee every offer has a follower; without it a uniform draw whiffs often.
    for (let seed = 1; seed <= 40; seed++) {
      const s: RunState = { ...createRun(seed, 'runesmith'), setId: 'set2', wave: 4, phase: 'combat', hand: [],
        board: demonBoard(), lastCombat: win };
      const opened = reduce(s, { type: 'resolveCombat' }); // → turn 5, the Runesmith forge opens
      const offer = opened.runeforgeOffer;
      if (!offer) continue; // (a hero-power edge — not what this test is about)
      const tags = boardSynergyTags(opened);
      expect(offer.some((id) => runeSynergies(RUNE_INDEX[id]!).some((t) => tags.has(t))),
        `seed ${seed}: no offered rune follows the board`).toBe(true);
    }
  });

  // Uses a NON-forge hero on purpose. Guardian and Runesmith now have their whole forge discounted (owner ask
  // 2026-08-17), which is a deliberate second rule on top of this one — testing the pivot rule through them
  // would only prove the two overlap.
  it('pivot discounts land only on non-following runes, within range, and the buy charges the discounted price', () => {
    let found = false;
    for (let seed = 1; seed <= 60 && !found; seed++) {
      // The UNIVERSAL forge (runic rift, wave 6) opens for any hero, so the pivot rule can be observed on its
      // own rather than through a hero who also discounts the whole shop.
      // Warden, not Coran: since the 2026-08-21 rework Coran opens the run holding a hero-quest modal, and a
      // live modal blocks the turn advance this test drives — so the forge never opened and the whole 60-seed
      // sweep silently found nothing. The test only ever needed "a hero with no forge of their own".
      const s: RunState = { ...createRun(seed, 'warden'), setId: 'set2', rift: 'runic', wave: 5, phase: 'combat', hand: [],
        board: demonBoard(), lastCombat: win };
      const opened = reduce(s, { type: 'resolveCombat' });
      const offer = opened.runeforgeOffer;
      const discounts = opened.runeforgeDiscounts;
      if (!offer || !discounts) continue;
      const tags = boardSynergyTags(opened);
      discounts.forEach((d, i) => {
        if (d === undefined) return;
        expect(d, 'basic-forge discounts are 1–2 Gold').toBeGreaterThanOrEqual(1);
        expect(d).toBeLessThanOrEqual(2);
        expect(runeSynergies(RUNE_INDEX[offer[i]!]!).some((t) => tags.has(t)),
          'a discount landed on a rune that FOLLOWS the board').toBe(false);
      });
      const di = discounts.findIndex((d) => d !== undefined);
      if (di < 0) continue;
      found = true;
      const rune = RUNE_INDEX[offer[di]!]!;
      const bought = reduce({ ...opened, embers: 20 }, { type: 'buyRune', index: di });
      expect(20 - bought.embers, 'the buy must charge the discounted price').toBe(Math.max(0, rune.cost - discounts[di]!));
    }
    expect(found, '60 seeds produced no pivot discount at a 40% rate — the roll is broken').toBe(true);
  });
});

describe('Runeforge — framework', () => {
  it('every rune validates + is Runeforge-only (never a card/quest id)', () => {
    validateRunes();
    // A hardcoded count is a tripwire for accidental additions, so it moves deliberately: +1 for Gemcutting
    // (Set 2 rune batch 2026-07-29). The epic list grew by 6 in the same batch — see the sibling assertion.
    // A hardcoded total is a tripwire, not a spec: it fires whenever runes are added so the addition gets a
    // deliberate look. Bump it with the count. +10 (2026-07-30): Recollection, the First Round, six threshold runes, the Stampede, the Hatchery, Resonance, Investment, Last Call, Hunger, Blood and Coin, the Remains, Reinvestment the Hunting Bell, the Brood + the War Chorus. (Epics are counted separately.)
    expect(RUNES.length).toBe(142); // 141 → 142 on 2026-08-26: Happy Birthday (the Basic half of the Gift pair)
    for (const r of RUNES) expect(r.id.startsWith('rune_')).toBe(true);
  });

  it('rejects a DUPLICATE rune id or name (a second Rune of the High King actually shipped, 2026-07-31)', () => {
    // RUNE_INDEX silently collapses duplicate ids, so nothing downstream ever noticed — the Runeforge stocked
    // the rune twice and the Compendium smeared extra copies across its gallery off the duplicate React keys.
    const king = EPIC_RUNES.find((r) => r.id === 'rune_high_king')!;
    expect(() => validateRunes([...RUNES, ...EPIC_RUNES, { ...king }])).toThrow(/duplicate rune id/);
    expect(() => validateRunes([...RUNES, ...EPIC_RUNES, { ...king, id: 'rune_other_king' }])).toThrow(/duplicate rune name/);
    // …but the Menagerie twin pattern stays legal: one name across DISJOINT set scopes is deliberate.
    expect(() => validateRunes()).not.toThrow();
  });

  it('opens on turn 5 for Runesmith with a random 4 distinct runes', () => {
    const s = reduce(atForgeCombat(), { type: 'resolveCombat' });
    expect(s.wave).toBe(5);
    expect(s.runeforgeOffer).toBeDefined();
    expect(s.runeforgeOffer!.length).toBe(4);
    expect(new Set(s.runeforgeOffer).size).toBe(4); // no duplicates
    for (const id of s.runeforgeOffer!) expect(RUNE_INDEX[id]).toBeDefined();
  });

  it('rerollRuneforge is FREE and swaps in a fresh, non-overlapping set of 4 (owner 2026-07-31)', () => {
    const s = reduce(atForgeCombat(), { type: 'resolveCombat' });
    const before = s.runeforgeOffer!;
    const r = reduce(s, { type: 'rerollRuneforge' });
    expect(r.embers).toBe(s.embers); // free now
    expect(r.runeforgeRerolled).toBe(true);
    expect(r.runeforgeOffer!.length).toBe(4);
    expect(new Set(r.runeforgeOffer).size).toBe(4);
    // the fresh set shares no rune with the original offer (drawn from the leftovers — 17 runes, so 4 fresh exist)
    for (const id of r.runeforgeOffer!) expect(before).not.toContain(id);
    // a second re-roll is a no-op (once per visit)
    expect(reduce(r, { type: 'rerollRuneforge' })).toBe(r);
  });

  it('rerollRuneforge works at 0 Gold — the cost is gone (owner 2026-07-31)', () => {
    const s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 0, runeforgeOffer: ['rune_warding', 'rune_fury', 'rune_slaying'] };
    const r = reduce(s, { type: 'rerollRuneforge' });
    expect(r.runeforgeRerolled).toBe(true); // no Gold gate any more
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
    // Derived from the rune's own cost, not a magic number — all 14 mismatched costs moved on 2026-07-29 to
    // match the owner's roster, and a hardcoded total makes every retune look like a regression.
    const cost = RUNES.find((r) => r.id === 'rune_warding')!.cost;
    const s = buyRune('rune_warding', 10);
    expect(s.embers).toBe(10 - cost);
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
  it('Consumption arms the random +1 Attack / +1 Health Fodder-on-Consume improve', () => {
    expect(buyRune('rune_consumption').runeConsume).toEqual({ attack: 1, health: 1 });
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

  it('Slaying: kills BANK across combats — under 6, nothing pays yet (owner change 2026-07-31)', () => {
    const before = createRun(1, 'runesmith').maxEmbers;
    const s = reduce({
      ...createRun(1, 'runesmith'), phase: 'combat', hand: [], questFlags: { runeSlaying: true },
      lastCombat: {
        events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 3, initial: { player: [], enemy: [] },
        playerQuestTally: { attack: 0, summonCombat: 0, slaughter: 3, slaughterKeyword: 0, attackByTribe: {}, summonCombatByTribe: {}, slaughterByTribe: {}, statGainByTribe: {} },
      } as CombatResult,
    }, { type: 'settleCombat' }); // settle WITHOUT advancing, so the bank is observable on this state
    expect(s.runeSlayingKills).toBe(3); // banked, below the 6-kill threshold
    expect(s.hand).toHaveLength(0); // no payout yet
    expect(s.maxEmbers).toBe(before); // the old max-Gold rider is GONE
  });

  it('Summoning: casting a spell improves your Imps by its PRINTED +2/+2 (run-wide)', () => {
    let s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 5, runeSummoning: true,
      hand: [{ uid: 'gp', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'gp' }); // cast one spell
    // The card prints +2/+2. It paid +1/+1 until the 2026-08-28 fix — the drift the text oracle caught, and
    // the owner's duplicate ruling ("a second copy = +4/+4") confirms the printed step is the contract.
    expect(s.impBuff).toEqual({ attack: 2, health: 2 });
  });
});

describe('New heroes — Coran (Pathfinder) + Jenkins (Dynamite Dig)', () => {
  const atCombat = (heroId: string, wave: number): RunState => ({
    ...createRun(1, heroId), wave, phase: 'combat',
    lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } },
  });

  // ARCHIVED 2026-08-28 (owner ruling). Coran had three quest paths — his own turn-1 Pathfinder offer plus the
  // universal turn-5 and turn-11 turns — and all three are now dark. One test replaces the three, because the
  // point is no longer which offer arrives when, but that NONE of them can.
  it('Coran: ARCHIVED — no turn-1 Pathfinder offer, and no universal turn-5 or turn-11 quest either', () => {
    expect(createRun(1, 'coran').questOffer, 'the turn-1 hero offer').toBeUndefined();
    for (const from of [4, 10]) {
      const s = reduce(atCombat('coran', from), { type: 'resolveCombat' });
      expect(s.wave).toBe(from + 1);
      expect(s.questOffer, `advancing into wave ${from + 1} opened a quest`).toBeUndefined();
      expect(s.activeQuests ?? []).toEqual([]);
    }
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
    const cost = EPIC_RUNES.find((r) => r.id === 'rune_copies')!.cost;
    const s = buyEpic('rune_copies', 10);
    expect(s.embers).toBe(10 - cost);
    expect(s.runeCopies).toBe(true);
    expect(s.ownedRunes).toEqual(['rune_copies']);
    expect(s.runeforgeOffer).toBeUndefined();
    expect(s.runeforgeEpic).toBeUndefined();
    expect(s.heroPowerSpent).toBeFalsy(); // the Epic forge is quest-opened, not the hero power
  });

  it('re-rolling the Epic forge is FREE and redraws from the Epic set (owner 2026-07-31)', () => {
    const s: RunState = { ...createRun(1, 'baggerben'), wave: 6, phase: 'recruit', embers: 10 };
    openEpicRuneforge(s);
    const r = reduce(s, { type: 'rerollRuneforge' });
    expect(r.embers).toBe(10); // free
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

  it('Rune of Kindling: casting a spell descends +4/+6 onto the left AND right-most minions (owner balance 2026-08-19)', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, runeKindling: true,
      board: [mkAlley('a'), mkAlley('b')],
      hand: [{ uid: 'sp1', cardId: 'preemptive', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'sp1' }); // casting a spell fires the Kindling buff on both ends
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([5, 7]); // 1/1 + 2/2 (left-most)
    expect([s.board[1]!.attack, s.board[1]!.health]).toEqual([5, 7]); // 1/1 + 2/2 (right-most)
    const fxA = s.recruitBuffFx.filter((e) => e.targetUid === 'a' && e.sourceUid === undefined);
    const fxB = s.recruitBuffFx.filter((e) => e.targetUid === 'b' && e.sourceUid === undefined);
    expect(fxA.length).toBe(1);
    expect([fxA[0]!.attack, fxA[0]!.health]).toEqual([4, 6]);
    expect(fxB.length).toBe(1);
    expect([fxB[0]!.attack, fxB[0]!.health]).toEqual([4, 6]);
  });

  it('Rune of Scales: casting a spell descends +4/+5 onto each board Dragon (Beasts untouched)', () => {
    const mkDragon = (uid: string): RunState['board'][number] => ({ uid, cardId: 'yazzus', tribe: 'dragon', attack: 2, health: 2, keywords: [], golden: false });
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10, runeScales: true,
      board: [mkDragon('d1'), mkAlley('b'), mkDragon('d2')],
      hand: [{ uid: 'sp1', cardId: 'preemptive', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'sp1' });
    const dragonFx = s.recruitBuffFx.filter((e) => e.sourceUid === undefined && e.attack === 4 && e.health === 5 && (e.targetUid === 'd1' || e.targetUid === 'd2'));
    expect(dragonFx.length).toBe(2); // one descend per Dragon (+4/+5, owner 2026-08-11)
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
  it('Blueprint Cache: the projection itemizes one +3/+3 event per Attachment; the commit matches in total', () => {
    const mk = (): RunState => ({ ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['buffMechsPerAttachment'],
      board: [{ uid: 'm', cardId: 'drone', tribe: 'mech', attack: 2, health: 3, keywords: [], golden: false, attachments: 3 }, mkAlley('b')] });
    const { steps, fx } = projectEndOfTurnSteps(mk());
    expect(fx).toHaveLength(1);
    const evs = fx[0]!.buffFx.filter((e) => e.targetUid === 'm');
    expect(evs).toHaveLength(3); // one event per Attachment…
    expect(evs.every((e) => e.sourceUid === undefined && e.attack === 3 && e.health === 3)).toBe(true); // …each +3/+3
    expect(steps[0]!['m']).toEqual({ attack: 11, health: 12 }); // total +9/+9 (3 Attachments × +3/+3)
    const commit = mk();
    applyEndOfTurn(commit);
    const m = commit.board.find((c) => c.uid === 'm')!;
    expect([m.attack, m.health]).toEqual([11, 12]); // commit total identical
    expect(commit.recruitBuffFx).toHaveLength(0); // …and emits NO events (itemizeFx is projection-only)
  });

  it('Rune of Spending: the projection itemizes one +1/+2 event per Gold spent (owner re-tune 2026-07-31)', () => {
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['runeSpending'], goldSpentThisTurn: 4, board: [mkAlley('a')] };
    const { steps, fx } = projectEndOfTurnSteps(s);
    const evs = fx[0]!.buffFx.filter((e) => e.targetUid === 'a');
    expect(evs).toHaveLength(4);
    expect(evs.every((e) => e.sourceUid === undefined && e.attack === 1 && e.health === 2)).toBe(true);
    expect(steps[0]!['a']).toEqual({ attack: 5, health: 9 }); // 1/1 + 4 × +1/+2
  });

  it('Rune of Action: a spell played counts as a card played (playedThisTurn)', () => {
    // Regression (owner 2026-07-11): "each card you played" must include spells / Discover-on-play /
    // welded Magnetics, not just minions that take a board slot — those returned before the tracker.
    // The board minion is REQUIRED as of 2026-08-03: Growth on an empty board is now refused outright (an
    // unusable spell is kept in hand — see `spellFizzle.ts`), which would make this test vacuous. What it
    // actually pins is unchanged: a cast spell counts toward `playedThisTurn`.
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      board: [{ uid: 'm', cardId: 'sandbag', tribe: 'neutral', attack: 2, health: 2, keywords: [], golden: false }],
      hand: [{ uid: 'g1', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    const next = reduce(s, { type: 'play', uid: 'g1' });
    expect(next.playedThisTurn).toContain('growth'); // the spell counted, even though it took no board slot
  });
});

describe('Runes batch 1 — grants / discovers / economy', () => {
  it('Rune of Small Fortune: gives 7 Gold immediately (this shop, not banked)', () => {
    const cost = RUNES.find((r) => r.id === 'rune_small_fortune')!.cost;
    const s = buyRune('rune_small_fortune', 10);
    expect(s.embers).toBe(10 - cost + 7); // spent, then +7 immediately
    expect(s.bonusEmbersNextTurn ?? 0).toBe(0); // nothing banked for next shop
  });

  it('Rune of Quick Study: arms a 2-TURN payout, nothing immediate', () => {
    // Owner rebalance 2026-08-02: the payout is BOUNDED to 2 turns, so it arms the limited list rather than
    // the run-long one (the full lifecycle is pinned in quickStudyTurns.test.ts).
    const s = buyRune('rune_quick_study', 10, { tier: 3, hand: [] });
    expect(s.questRecurringLimited?.[0]).toMatchObject({ effect: 'quickStudy', turnsLeft: 2 });
    expect(s.questRecurringEndOfTurn ?? []).not.toContain('quickStudy');
    expect(s.hand).toHaveLength(0);
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

  it('Rune of the Champion (Epic): a T4, T5 and T6 Discover of the dominant tribe (owner sheet 2026-07-31)', () => {
    // A Beast-heavy board → all three Discovers are Beast-typed, tiers 4 then 5 then 6.
    const beast = Object.values(CARD_INDEX).find((c) => c.tribe === 'beast' && !c.spell && !c.token)!;
    const mkB = (uid: string): RunState['board'][number] => ({ uid, cardId: beast.id, tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });
    let s: RunState = reduce({ ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 10, tier: 3,
      board: [mkB('b1'), mkB('b2')], runeforgeOffer: ['rune_champion'], runeforgeEpic: true }, { type: 'buyRune', index: 0 });
    const tiersSeen: number[] = [];
    for (let hop = 0; hop < 3 && s.discover?.length; hop++) {
      tiersSeen.push(CARD_INDEX[s.discover[0]!]!.tier);
      for (const id of s.discover) {
        const d = CARD_INDEX[id]!;
        expect(d.tribe === 'beast' || d.tribe2 === 'beast' || !!d.universalTribe, `${d.name} is not a Beast`).toBe(true);
      }
      s = reduce(s, { type: 'discover', index: 0 });
    }
    expect(tiersSeen).toEqual([4, 5, 6]);
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

  it('Rune of Kindling: each spell cast gives the left AND right-most minions +4/+6 (owner balance 2026-08-19)', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 5, runeKindling: true,
      board: [mkAlley('lead'), mkAlley('other')],
      hand: [{ uid: 'gp', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'gp' }); // cast a spell
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([5, 7]); // 1/1 + 2/2 (left-most)
    expect([s.board[1]!.attack, s.board[1]!.health]).toEqual([5, 7]); // 1/1 + 2/2 (right-most)
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

  it('The Runeforge quest: buying 9 cards arms a next-turn BASIC forge visit + 4 Gold', () => {
    // Complete via the reward directly (buy-count objective drives it live in play).
    const q = QUEST_INDEX['q_the_runeforge']!;
    expect(q.tribe).toBe('neutral');
    expect(q.tier).toBe('lesser');
    expect(q.objective).toEqual({ event: 'buy', count: 9 });
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

  it('Rune of the Epic Forge: schedules an EARLY epic forge for turn 8 (the systemic turn-9 one still comes)', () => {
    const armed = buyRune('rune_epic_forge', 10);
    expect(armed.epicForgeWave).toBe(8); // one turn ahead of the wave-9 baseline (owner 2026-07-31)
    const next: RunState = reduce({ ...armed, wave: 7, phase: 'combat', lastCombat: win }, { type: 'resolveCombat' });
    expect(next.wave).toBe(8);
    expect(next.runeforgeEpic).toBe(true);
    expect(next.epicForgeWave).toBeUndefined(); // consumed — turn 9's visit comes from the baseline, not this
  });

  it('Rune of Quick Study: EVERY turn pays a Gold Font + 2 random Shop spells (owner clarification 2026-07-31)', () => {
    const armed: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', hand: [],
      questRecurringEndOfTurn: ['quickStudy'] };
    applyEndOfTurn(armed);
    expect(armed.hand.filter((c) => c.cardId === 'manafont')).toHaveLength(1); // the Gold Font
    const spells = armed.hand.filter((c) => c.cardId !== 'manafont' && CARD_INDEX[c.cardId]?.spell);
    expect(spells).toHaveLength(2);
  });

  it('Rune of the Matriarch stays wired after the 2026-08-07 Runebloom rework', () => {
    // The rune used to be measured HERE, in the shop: Runebloom's payout was a recruit-phase per-cast proc, so
    // "triggers twice" doubled a stat gain you could read off the board. The rework moved Runebloom's trigger
    // into combat (Start of Combat: your Shop Spells cast an extra time), so the rune now doubles that grant
    // and is measured in `core/src/combat/combatSpellCast.test.ts`. What remains checkable here is the wiring.
    const s = buyRune('rune_matriarch', 10);
    expect(s.runeMatriarch, 'the rune no longer arms its flag').toBe(true);
    expect(CARD_INDEX['b2_runebloom']!.effects.some((e) => e.do === 'scGrantSpellCastExtra')).toBe(true);
  });

  it('Rune of Slaying: every 6 kills banks a minion of the dominant type (owner change 2026-07-31)', () => {
    const beast = Object.values(CARD_INDEX).find((c) => c.tribe === 'beast' && !c.spell && !c.token)!;
    const mkB = (uid: string): RunState['board'][number] => ({ uid, cardId: beast.id, tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false });
    const armed: RunState = { ...buyRune('rune_slaying', 10), board: [mkB('b1'), mkB('b2')], hand: [], phase: 'combat',
      lastCombat: { ...win, playerQuestTally: { slaughter: 8 } } as unknown as CombatResult };
    const settled = reduce(armed, { type: 'resolveCombat' });
    // 8 kills → one payout (6) + 2 banked for the next combat.
    const granted = settled.hand.filter((c) => { const d = CARD_INDEX[c.cardId]; return d && (d.tribe === 'beast' || d.tribe2 === 'beast' || d.universalTribe); });
    expect(granted.length, 'no dominant-type minion was granted at 6 kills').toBeGreaterThanOrEqual(1);
    expect(settled.runeSlayingKills).toBe(2);
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

  it('Rune of Stormcalling: grants a Karwind (UNGILDED, owner sheet 2026-07-31) + a random Shout minion', () => {
    const s = buyEpic('rune_stormcalling');
    const karwind = s.hand.find((c) => c.cardId === 'karwind');
    expect(karwind, 'no Karwind granted').toBeTruthy();
    expect(karwind?.golden ?? false).toBe(false); // plain — the Gilded grant was the pre-sheet version
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

  it('Rune of Scales: each spell cast gives your Dragons +4/+5 (board + hand)', () => {
    // A Dragon on board + a non-Dragon; cast a spell → only the Dragon grows.
    let s: RunState = { ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 5, runeScales: true,
      board: [mk('d', 'karwind'), mkAlley('b')], hand: [spell()] };
    const dragonBefore = s.board[0]!.attack;
    s = reduce(s, { type: 'play', uid: 'gp' });
    expect(s.board[0]!.attack).toBe(dragonBefore + 4); // Dragon +4/+5 (owner 2026-08-11)
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

  it('Rune of the Second Path: TWO Tier-6 Discovers whose picks land at 20/20 (owner sheet 2026-07-31)', () => {
    let s: RunState = reduce({ ...createRun(1, 'warden'), wave: 6, phase: 'recruit', embers: 10, hand: [], runeforgeOffer: ['rune_second_path'], runeforgeEpic: true }, { type: 'buyRune', index: 0 });
    for (const hop of [1, 2]) {
      expect(s.discover?.length, `Discover ${hop} did not open`).toBeGreaterThan(0);
      for (const id of s.discover!) expect(CARD_INDEX[id]?.tier).toBe(6);
      s = reduce(s, { type: 'discover', index: 0 });
      const picked = s.hand.at(-1)!;
      expect([picked.attack, picked.health], `pick ${hop} was not set to 20/20`).toEqual([20, 20]);
    }
    expect(s.discover).toBeUndefined(); // exactly two
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

  it('Guardian: Runeguard — 10 armor + schedules the Epic Runeforge for turn 8', () => {
    const s = createRun(1, 'runeguard');
    expect(s.armor).toBe(10); // owner balance 2026-08-17
    expect(s.epicForgeWave).toBe(8);
    const next = reduce({ ...s, wave: 7, phase: 'combat', epicForgeWave: 8, lastCombat: win }, { type: 'resolveCombat' });
    expect(next.wave).toBe(8);
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

  it('is a neutral greater quest named "The Epic Runeforge" (cast 15 spells) whose reward opens the Epic Runeforge + gives 8 Gold', () => {
    const q = QUEST_INDEX['q_epic_commission']!;
    expect(q).toBeDefined();
    expect(q.name).toBe('The Epic Runeforge');
    expect(q.tribe).toBe('neutral');
    expect(q.tier).toBe('greater');
    expect(q.objective).toEqual({ event: 'castSpell', count: 15 });
    expect(q.reward).toEqual({ kind: 'multi', rewards: [{ kind: 'openEpicRuneforge' }, { kind: 'gainGold', amount: 8 }] });
  });

  it('completing it (the 15th spell) ARMS the forge for next turn + grants 8 Gold — it does not open on the completing turn', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 7, phase: 'recruit', tier: 6, embers: 5, freeRolls: 0,
      activeQuests: [{ questId: 'q_epic_commission', progress: 14, completed: false }],
      hand: [{ uid: 'sp', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'sp' }); // 15th spell → completes
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
      activeQuests: [{ questId: 'q_the_runeforge', progress: 8, completed: false }] };
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid }); // 9th buy → completes The Runeforge
    expect(s.activeQuests![0]!.completed).toBe(true);
    expect(s.pendingBasicForge?.deferred).toBe(true); // armed, but deferred…
    expect(s.runeforgeOffer).toBeUndefined(); // …so it does NOT open on the completing turn
    // Next turn (after this turn's combat) it opens at the start.
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.runeforgeOffer).toBeDefined(); // opened at the start of next turn
    expect(s.runeforgeEpic).toBeFalsy(); // the BASIC forge
  });

  it('no longer queues behind a quest on turn 11 — the Epic forge opens IMMEDIATELY (quests archived)', () => {
    // Turn 11 used to be a quest turn, and the modal chain gave the Quest priority: the forge waited, armed,
    // until the quest was bought. With quests archived there is nothing in front of it, so the forge must open
    // on arrival. This is the regression that matters here — an armed `pendingEpicRuneforge` waiting behind a
    // modal that can never appear would strand the rune the player was owed.
    const s: RunState = { ...createRun(1, 'soren'), wave: 10, phase: 'combat', pendingEpicRuneforge: true, lastCombat: win };
    const t11 = reduce(s, { type: 'resolveCombat' }); // → turn 11
    expect(t11.wave).toBe(11);
    expect(t11.questOffer, 'turn 11 is an ordinary shop turn now').toBeUndefined();
    expect(t11.runeforgeEpic).toBe(true);
    expect(t11.runeforgeOffer!.length).toBe(Math.min(4, EPIC_RUNES.length));
    expect(t11.pendingEpicRuneforge).toBe(false); // consumed on arrival, not left armed
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
    expect(buyRune('rune_conductor').endOfTurnExtra).toBe(2); // rides the permanent EoT-repeat counter now
    // Capped at 4 Wards a combat since 2026-08-08 (owner), so the flag carries the budget rather than a bare true.
    expect(buyRune('rune_undertow').questFlags?.runeUndertow).toBe(4);
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

  it('Rune of Refrain: a played Shout minion has a ~20% chance to return to hand (seeded, rune-gated)', () => {
    // Probabilistic, so assert the SHAPE across many seeded trials rather than one outcome: it happens, it is
    // not the common case, it never happens without the rune, and a given seed always resolves the same way.
    const trial = (seed: number, rune: boolean): boolean => {
      let s: RunState = { ...createRun(seed, 'warden'), wave: 3, phase: 'recruit', embers: 10,
        ...(rune ? { runeRefrain: true } : {}),
        hand: [mkCard('a1', 'alley', 'beast', 1, 1)] };
      s = reduce(s, { type: 'play', uid: 'a1' });
      return s.hand.some((c) => c.uid === 'a1');
    };
    const N = 60;
    let returned = 0;
    for (let i = 1; i <= N; i++) if (trial(i, true)) returned++;
    expect(returned).toBeGreaterThan(0);   // it does fire…
    expect(returned).toBeLessThan(N / 2);  // …but it's the minority case (20%, not a coin flip)
    for (let i = 1; i <= N; i++) expect(trial(i, false)).toBe(false); // never without the rune
    expect(trial(7, true)).toBe(trial(7, true)); // deterministic for a given seed (replay-safe)
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

  it('Rune of Recurrence: End of Turn recasts the first spell TWICE (owner sheet 2026-07-31)', () => {
    // Untargeted: Growth (+1/+1 board-wide) recast twice at EoT → +2/+2 total.
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['recastFirstSpell'], firstSpellThisTurnId: 'growth',
      board: [mkAlley('m')] };
    applyEndOfTurn(s);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([1 + 2, 1 + 2]);
    // Aimed: Patch Job (+1/+1 baseline at 0 Gold spent) recast twice onto a (seeded-random) board minion.
    const t: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['recastFirstSpell'], firstSpellThisTurnId: 'patchjob', goldSpentThisTurn: 0,
      board: [mkAlley('m')] };
    applyEndOfTurn(t);
    expect(t.board[0]!.attack).toBeGreaterThanOrEqual(1 + 2);
    // No spell cast this turn → a clean no-op.
    const u: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      questRecurringEndOfTurn: ['recastFirstSpell'], board: [mkAlley('m')] };
    applyEndOfTurn(u);
    expect([u.board[0]!.attack, u.board[0]!.health]).toEqual([1, 1]);
  });

  it('Rune of the Conductor: End of Turn effects run 2 EXTRA times (owner sheet 2026-07-31)', () => {
    // Rides `endOfTurnRepeats` (the Parliament-of-Flame counter): with the rune, one End of Turn resolves
    // an EoT effect 1 + 2 times. Skybound's EoT (buff the weakest Dragon by 50% of the strongest) fires
    // thrice — measured against a rune-less control on the identical board.
    const board = (): RunState['board'] => [mkCard('sk', 'skybound', 'dragon', 10, 10), mkCard('d', 'supporter', 'dragon', 2, 2)];
    const withRune: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', endOfTurnExtra: 2, board: board() };
    applyEndOfTurn(withRune);
    const control: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', board: board() };
    applyEndOfTurn(control);
    const grown = withRune.board.find((c) => c.uid === 'd')!;
    const base = control.board.find((c) => c.uid === 'd')!;
    expect(base.attack).toBeGreaterThan(2); // the effect fired at all (fixture sanity)
    expect(grown.attack).toBeGreaterThan(base.attack); // …and the rune made it fire MORE
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

  it('Rune of Consumption stacked with Mastery: each Consume improves future Fodder TWICE', () => {
    // The improve now picks Attack OR Health at random per rep, so the SPLIT is seed-dependent — assert the
    // total instead: 2 reps × +1 = +2 of stats, all of it on the Fodder enchant.
    const s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      runeMastery: true, runeConsume: { attack: 1, health: 1 }, board: [] };
    noteFodderConsumed(s, 1, 1);
    const fred = s.cardBuffs?.['fred'] ?? { attack: 0, health: 0 };
    expect(fred.attack + fred.health).toBe(2); // two independent improves landed
    // …and without Mastery it lands exactly one.
    const one: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit',
      runeConsume: { attack: 1, health: 1 }, board: [] };
    noteFodderConsumed(one, 1, 1);
    const f1 = one.cardBuffs?.['fred'] ?? { attack: 0, health: 0 };
    expect(f1.attack + f1.health).toBe(1);
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

  it('Rune of Summoning stacked with Mastery: the printed step doubles to +4/+4 per spell', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, phase: 'recruit', embers: 10,
      runeMastery: true, runeSummoning: true,
      board: [mk('m', 'stray', 'beast', 1, 1)],
      hand: [mk('g1', 'growth', 'neutral', 0, 1)] };
    s = reduce(s, { type: 'play', uid: 'g1' });
    expect(s.impBuff).toEqual({ attack: 4, health: 4 });
  });

  it('two copies pay the owner-ruled +4/+4 (the duplicate ruling that pinned the printed step)', () => {
    let s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 5, runeSummoning: true,
      runeStacks: { rune_summoning: 2 },
      hand: [{ uid: 'gp', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] };
    s = reduce(s, { type: 'play', uid: 'gp' });
    expect(s.impBuff).toEqual({ attack: 4, health: 4 });
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
    // Totals: +3/+3 per Attachment.
    expect(steps[0]!['a']).toEqual({ attack: 2 + 9, health: 3 + 9 });
    expect(steps[0]!['b']).toEqual({ attack: 2 + 6, health: 3 + 6 });
    expect(steps[0]!['c']).toEqual({ attack: 2 + 3, health: 3 + 3 });
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

  it("re-rolling is FREE but once per GAME — the basic forge spends the epic forge's re-roll (owner 2026-07-31)", () => {
    let s: RunState = { ...createRun(1, 'runesmith'), wave: 6, phase: 'recruit', embers: 0,
      runeforgeOffer: ['rune_fury', 'rune_warding'] };
    const before = s.runeforgeOffer!;
    s = reduce(s, { type: 'rerollRuneforge' }); // at 0 Gold — free now
    expect(s.runeforgeOffer).not.toEqual(before);
    expect(s.runeforgeRerollUsed).toBe(true);
    // A later EPIC forge: the game-wide re-roll is spent, so the action is a no-op.
    const epic: RunState = { ...s, wave: 9, runeforgeOffer: ['rune_broodpit', 'rune_appraisal'], runeforgeEpic: true, runeforgeRerolled: undefined };
    const after = reduce(epic, { type: 'rerollRuneforge' });
    expect(after.runeforgeOffer).toEqual(['rune_broodpit', 'rune_appraisal']);
  });

  it('arms on purchase with a zeroed tick', () => {
    const s = buyRune('rune_summit');
    expect(s.runeSummit).toBe(true);
    expect(s.runeSummitTick ?? 0).toBe(0);
  });

  /**
   * "Was a Tier 7 Discover raised this shop?" — read from EITHER the open offer or the queue.
   *
   * A payout cannot always OPEN: this walk starts at wave 3, so its second shop lands on wave 5, a quest
   * turn, which parks a `questOffer` at shop open. A Discover must QUEUE behind an open modal instead of
   * opening over it — every overlay has an independent render guard, so two at once are drawn stacked
   * (owner report 2026-07-22; pinned in `discoverStacking.test.ts`). This test is about the every-2nd-shop
   * CADENCE, so it reads the payout wherever it landed rather than asserting the old stacking behaviour.
   */
  const raisedT7 = (s: RunState): boolean => {
    if (s.discover?.length) return s.discover.every((id) => CARD_INDEX[id]!.tier === 7); // honoured at Tier 7 with NO rift
    return (s.discoverQueue ?? []).some((q) => q.kind === 'minion' && q.exactTier === 7);
  };

  it('fires on the THIRD shop, then repeats every 3rd (owner sheet 2026-07-31)', () => {
    let s: RunState = { ...buyRune('rune_summit'), wave: 3, hand: [], board: [] };
    s = openShop(s); // shop 1 — nothing yet
    expect(s.runeSummitTick).toBe(1);
    expect(raisedT7(s)).toBe(false);
    s = openShop(s); // shop 2 — still quiet
    expect(raisedT7(s)).toBe(false);
    s = openShop(s); // shop 3 — fires
    expect(s.runeSummitTick).toBe(3);
    expect(raisedT7(s)).toBe(true);
    s = openShop(s); s = openShop(s); // shops 4–5 — quiet
    expect(raisedT7(s)).toBe(false);
    s = openShop(s); // shop 6 — fires again
    expect(raisedT7(s)).toBe(true);
  });

  it('does nothing without the rune', () => {
    let s: RunState = { ...createRun(1, 'warden'), wave: 3, hand: [], board: [] };
    s = openShop(s); s = openShop(s);
    expect(s.discover).toBeFalsy();
  });
});
