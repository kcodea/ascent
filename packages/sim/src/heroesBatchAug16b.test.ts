import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { CIA_ENCHANT_CHANCE } from './config';
import { upgradeCostOf } from './reducer';
import type { CiaSuit } from './state';
import { createRun, reduce, getHero, HEROES, heroPowerText, commissionOffer, addBuff, threeDistinctTypes, buyoutCostOf, allInPayoutOf, exhibitionGrantOf, stampSableBond, type RunState, type BoardCard } from './index';

/** Owner hero batch 2026-08-16b — Bram, Croupier Ayse, Odelle, Harlan, Sable + the Rascal rework. */

const at = (over: Partial<RunState>): RunState =>
  ({ ...createRun(3), phase: 'recruit', ...over }) as RunState;

const m = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: 2, health: 2, keywords: [], golden: false }) as BoardCard;

describe('Braum — Investment', () => {
  it('is a 16-armor, 1-Gold untargeted power', () => {
    const h = getHero('bram'); // id kept stable (saves / art); display name is Braum
    expect([h.name, h.armor, h.power.kind, h.power.cost]).toEqual(['Braum', 16, 'investment', 1]);
  });

  it('banks a Gold per use and pays nothing before the 5th', () => {
    let s = at({ heroId: 'bram', embers: 20, heroReady: true, hand: [] });
    for (let i = 1; i <= 4; i++) {
      s = reduce({ ...s, heroReady: true } as RunState, { type: 'heroPower' } as never);
      expect(s.bramInvested, `after ${i} investments`).toBe(i);
      expect(s.hand.length, 'no payout yet').toBe(0);
    }
  });

  it('the 5th investment pays a GILDED minion and resets the bank', () => {
    const s = at({ heroId: 'bram', embers: 20, heroReady: true, hand: [], bramInvested: 4, tier: 3 });
    const after = reduce(s, { type: 'heroPower' } as never);
    expect(after.bramInvested, 'bank reset').toBe(0);
    expect(after.hand.length).toBe(1);
    expect(after.hand[0]!.golden, 'arrives Gilded').toBe(true);
    expect(CARD_INDEX[after.hand[0]!.cardId]!.tier, 'up to Shop tier').toBeLessThanOrEqual(3);
  });

  it('a full hand blocks the payout entirely — the bank is not spent', () => {
    const full = Array.from({ length: 10 }, (_, i) => m(`h${i}`, 'stray'));
    const s = at({ heroId: 'bram', embers: 20, heroReady: true, hand: full, bramInvested: 4 });
    const after = reduce(s, { type: 'heroPower' } as never);
    expect([after.bramInvested, after.embers]).toEqual([4, 20]);
  });
});

describe('Ayse — Lucky Seat', () => {
  it('is a 10-armor passive', () => {
    const h = getHero('cia');
    // Renamed from Cia 2026-08-22. The ID stays `cia` — saves, baked opponent boards and art files key off it.
    expect([h.name, h.armor, h.power.kind, h.power.passive]).toEqual(['Ayse', 10, 'luckySeat', true]);
    expect(getHero('cia').id, 'the id is stable across the rename').toBe('cia');
  });

  /**
   * PER-CARD enchant (owner change 2026-08-22, from "a 50% chance the shop seats exactly ONE"). Every card
   * rolls `CIA_ENCHANT_CHANCE` on its own, so a fill can serve none, one, or SEVERAL — the multi case is the
   * whole point of the change and is what the old "never more than one" assertion forbade.
   *
   * Deliberately statistical over many seeds rather than pinned to specific ones: the rule is a rate, and a
   * fixed-seed expectation would pass while the rate drifted anywhere.
   */
  it('rolls each card independently — the rate lands near CIA_ENCHANT_CHANCE', () => {
    let cards = 0, enchanted = 0, multiShops = 0, anyShops = 0;
    const SEEDS = 400;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = { ...createRun(seed), phase: 'recruit', heroId: 'cia', embers: 20 } as RunState;
      const after = reduce(s, { type: 'roll' } as never);
      const n = after.shop.filter((o) => o.enchanted).length;
      cards += after.shop.length;
      enchanted += n;
      if (n >= 1) anyShops++;
      if (n >= 2) multiShops++;
    }
    const rate = enchanted / cards;
    // Binomial over ~2000 cards at p=0.20: sd ~0.009, so +-0.04 is a very wide net around a real drift.
    // Asserted against the CONSTANT, not a literal, so a retune moves the target with it.
    expect(rate, `per-card rate was ${rate.toFixed(3)}`).toBeGreaterThan(CIA_ENCHANT_CHANCE - 0.04);
    expect(rate, `per-card rate was ${rate.toFixed(3)}`).toBeLessThan(CIA_ENCHANT_CHANCE + 0.04);
    // The behaviour the old shape could not produce.
    expect(multiShops, 'some shops seat two or more').toBeGreaterThan(0);
    expect(anyShops, 'most shops still seat none').toBeLessThan(SEEDS);
  });

  it('the OPENING shop can be Enchanted too', () => {
    // `createRun` fills the first shop directly, not through `refreshTavern` — so before 2026-08-22 the very
    // first shop was the one fill her power could never touch.
    let sawFirstShopEnchant = false;
    for (let seed = 1; seed <= 300 && !sawFirstShopEnchant; seed++) {
      const s = createRun(seed, 'cia');
      if (s.shop.some((o) => o.enchanted) || s.spell?.enchanted) sawFirstShopEnchant = true;
    }
    expect(sawFirstShopEnchant, 'an opening shop comes up Enchanted within 300 seeds').toBe(true);
    // …and still never for another hero.
    expect(createRun(1, 'indy').shop.some((o) => o.enchanted)).toBe(false);
  });

  it('the SPELL SLOT rolls too', () => {
    let sawSpell = false;
    for (let seed = 1; seed <= 400 && !sawSpell; seed++) {
      const s = { ...createRun(seed), phase: 'recruit', heroId: 'cia', embers: 20 } as RunState;
      const a = reduce(s, { type: 'roll' } as never);
      if (a.spell?.enchanted) sawSpell = true;
    }
    expect(sawSpell, 'an Enchanted spell shows up within 400 seeds').toBe(true);
  });

  it('advances the RNG stream by exactly one draw per card, whatever the outcome', () => {
    // The loop must never short-circuit: a stream whose length depended on the results would make the shop
    // that follows it seed-dependent on luck, and replays of the same seed could diverge.
    const s = { ...createRun(3), phase: 'recruit', heroId: 'cia', embers: 20 } as RunState;
    const a = reduce(s, { type: 'roll' } as never);
    const b = reduce({ ...s }, { type: 'roll' } as never);
    expect(a.rngCursor, 'the same input state produces the same cursor').toBe(b.rngCursor);
    expect(a.shop.map((o) => !!o.enchanted)).toEqual(b.shop.map((o) => !!o.enchanted));
  });

  it('never enchants for a different hero', () => {
    const s = { ...createRun(4), phase: 'recruit', heroId: 'indy', embers: 20 } as RunState;
    const after = reduce(s, { type: 'roll' } as never);
    expect(after.shop.some((o) => o.enchanted)).toBe(false);
  });

  const enchantedBuy = (suit: string, over: object = {}): RunState => {
    const s = {
      ...createRun(4), phase: 'recruit', heroId: 'cia', embers: 10, tier: 3, hand: [], board: [],
      ciaEnchantedBought: 2, ciaSuit: suit,
      shop: [{ uid: 'sx', cardId: 'stray', enchanted: true }],
      ...over,
    } as RunState;
    return reduce(s, { type: 'buy', uid: 'sx' } as never);
  };

  it('opens with a suit already queued, so the power button has art from turn 1', () => {
    const s = createRun(7, 'cia') as RunState;
    expect(['hearts', 'spades', 'diamonds', 'clubs']).toContain(s.ciaSuit);
  });

  it('HEARTS — Discover a minion of your CURRENT tier', () => {
    const after = enchantedBuy('hearts');
    expect(after.discover, 'a Discover opened').toBeTruthy();
    for (const id of after.discover!) expect(CARD_INDEX[id]!.tier, 'exactly your tier').toBe(3);
  });

  it('SPADES — Discover a Shop spell', () => {
    // Owner change 2026-08-22: was two random spells conjured straight to hand. A pick beats a handful.
    const after = enchantedBuy('spades');
    expect(after.discover, 'a Discover opened').toBeTruthy();
    expect(after.discover!.length, 'the standard three options').toBeGreaterThan(0);
    for (const id of after.discover!) expect(CARD_INDEX[id]!.spell, 'every option is a spell').toBe(true);
    // Nothing lands in hand until the player picks.
    expect(after.hand.filter((c) => CARD_INDEX[c.cardId]!.spell).length, 'no spell granted outright').toBe(0);
  });

  /**
   * THE ACE (owner addition 2026-08-22): a coin flip between a −4 Gold tier-up discount and a Discover from
   * the tier above. The discount half is offered only at Tier 5 and below — above that the flip collapses to
   * the Discover, because a discount at Tier 6 buys at most one more step and at the ceiling buys nothing.
   */
  describe('ACE', () => {
    const aceAt = (tier: number, seed = 4): RunState[] =>
      Array.from({ length: 40 }, (_, i) => enchantedBuy('ace', { tier, seed: seed + i }));

    it('below Tier 6 it pays BOTH halves across seeds', () => {
      let discounts = 0, discovers = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const a = { ...createRun(seed), phase: 'recruit', heroId: 'cia', embers: 10, tier: 3, hand: [], board: [],
          ciaEnchantedBought: 2, ciaSuit: 'ace', shop: [{ uid: 'sx', cardId: 'stray', enchanted: true }] } as RunState;
        const r = reduce(a, { type: 'buy', uid: 'sx' } as never);
        if (r.aceTierDiscount) discounts++;
        if (r.discover) discovers++;
        // Never both — it is one flip, not two prizes.
        expect(!!r.aceTierDiscount && !!r.discover, 'exactly one half pays').toBe(false);
      }
      expect(discounts, 'the discount half shows up').toBeGreaterThan(0);
      expect(discovers, 'the Discover half shows up').toBeGreaterThan(0);
    });

    it('above Tier 5 the discount half is OFF the table — always the Discover', () => {
      for (const tier of [6, 7]) {
        for (let seed = 1; seed <= 30; seed++) {
          const a = { ...createRun(seed), phase: 'recruit', heroId: 'cia', embers: 10, tier, hand: [], board: [],
            ciaEnchantedBought: 2, ciaSuit: 'ace', shop: [{ uid: 'sx', cardId: 'stray', enchanted: true }] } as RunState;
          const r = reduce(a, { type: 'buy', uid: 'sx' } as never);
          expect(r.aceTierDiscount, `tier ${tier} seed ${seed}: no discount above Tier 5`).toBeFalsy();
        }
      }
    });

    it('the Discover reaches Tier 7 from a Tier-6 shop, without Summit access', () => {
      let sawTier7 = false;
      for (let seed = 1; seed <= 40 && !sawTier7; seed++) {
        const a = { ...createRun(seed), phase: 'recruit', heroId: 'cia', embers: 10, tier: 6, hand: [], board: [],
          ciaEnchantedBought: 2, ciaSuit: 'ace', shop: [{ uid: 'sx', cardId: 'stray', enchanted: true }] } as RunState;
        const r = reduce(a, { type: 'buy', uid: 'sx' } as never);
        if (r.discover?.length) {
          for (const id of r.discover) expect(CARD_INDEX[id]!.tier, 'one tier up, at the Tier-7 cap').toBe(7);
          sawTier7 = true;
        }
      }
      expect(sawTier7, 'a Tier-7 Discover opened').toBe(true);
    });

    it('the discount is banked, applied ONCE, and never pays you to upgrade', () => {
      const base = { ...createRun(2), phase: 'recruit', heroId: 'cia', embers: 99, tier: 2, hand: [], board: [] } as RunState;
      const before = upgradeCostOf(base);
      const banked = { ...base, aceTierDiscount: 4 } as RunState;
      expect(upgradeCostOf(banked), 'four Gold cheaper').toBe(Math.max(0, before - 4));
      // Spent by the upgrade that uses it.
      const after = reduce(banked, { type: 'upgrade' } as never);
      expect(after.tier).toBe(3);
      expect(after.aceTierDiscount, 'the bank is spent').toBeFalsy();
      // Floored: a discount larger than the cost never turns into free Gold.
      expect(upgradeCostOf({ ...base, aceTierDiscount: 999 } as RunState)).toBe(0);
    });
  });

  it('DIAMONDS — a random minion from the tier ABOVE you', () => {
    const after = enchantedBuy('diamonds');
    const got = after.hand.filter((c) => !CARD_INDEX[c.cardId]!.spell && c.cardId !== 'stray');
    expect(got.length).toBe(1);
    expect(CARD_INDEX[got[0]!.cardId]!.tier, 'one tier up').toBe(4);
  });

  it('DIAMONDS clamps at Tier 6 without Tier 7 access', () => {
    const after = enchantedBuy('diamonds', { tier: 6 });
    const got = after.hand.filter((c) => !CARD_INDEX[c.cardId]!.spell && c.cardId !== 'stray');
    for (const c of got) expect(CARD_INDEX[c.cardId]!.tier, 'stays at 6, never 7').toBe(6);
  });

  it('CLUBS — 3 Gold', () => {
    const before = 10 - 3; // the buy itself costs a minion's price
    const after = enchantedBuy('clubs');
    expect(after.embers, '3 Gold on top of what the buy left').toBe(before + 3);
  });

  it('re-rolls the suit after a payout, and NEVER repeats it', () => {
    // Derived from the type's own list rather than a literal, so a suit added later (the Ace was, 2026-08-22)
    // is swept automatically instead of silently skipped.
    const SUITS: CiaSuit[] = ['hearts', 'spades', 'diamonds', 'clubs', 'ace'];
    for (const suit of SUITS) {
      // Vary the seed so the exclusion is tested against many draws, not one lucky one.
      for (let seed = 1; seed <= 12; seed++) {
        const after = enchantedBuy(suit, { ...createRun(seed), phase: 'recruit', heroId: 'cia', embers: 10, tier: 3, hand: [], board: [], ciaEnchantedBought: 2, ciaSuit: suit, shop: [{ uid: 'sx', cardId: 'stray', enchanted: true }] });
        expect(after.ciaSuit, `${suit} must not repeat`).not.toBe(suit);
        expect(SUITS).toContain(after.ciaSuit);
      }
    }
  });

  it('prints ONLY the queued suit reward — not a table of all five', () => {
    const texts: Record<string, string> = {
      hearts: 'Hearts', spades: 'Spades', diamonds: 'Diamonds', clubs: 'Clubs', ace: 'Ace',
    };
    for (const [suit, word] of Object.entries(texts)) {
      const t = heroPowerText({ ...createRun(4, 'cia'), ciaSuit: suit } as RunState);
      expect(t, `${suit} is named`).toContain(word);
      for (const other of Object.values(texts)) {
        if (other !== word) expect(t, `${other} is NOT shown`).not.toContain(other);
      }
    }
  });

  it('resets the counter on payout', () => {
    expect(enchantedBuy('clubs').ciaEnchantedBought).toBe(0);
  });

  it('a plain (un-enchanted) buy does not advance the counter', () => {
    const s = {
      ...createRun(4), phase: 'recruit', heroId: 'cia', embers: 40, hand: [], board: [],
      shop: [{ uid: 'sx', cardId: 'stray' }],
    } as RunState;
    expect(reduce(s, { type: 'buy', uid: 'sx' } as never).ciaEnchantedBought ?? 0).toBe(0);
  });
});

describe('Odelle — Exhibition', () => {
  it('is an 8-armor passive', () => {
    const h = getHero('odelle');
    expect([h.armor, h.power.kind, h.power.passive]).toEqual([10, 'exhibition', true]); // armor 8 -> 10 (2026-08-17)
  });

  describe('the three-different-types rule', () => {
    const c = (cardId: string): BoardCard => m('x', cardId);
    it('accepts three plainly different types', () => {
      // Beast / Dragon / Demon — three real tribes, no neutrals.
      expect(threeDistinctTypes([c('alley'), c('karwind'), c('impoverseer')].map((x, i) => ({ ...x, uid: `u${i}` })))).toBe(true);
    });
    it('REJECTS a neutral — it has no tribe to be different from (owner ruling)', () => {
      expect(threeDistinctTypes([c('alley'), c('sandbag'), c('impoverseer')]), 'sandbag is neutral').toBe(false);
    });
    it('rejects two of the same type', () => {
      expect(threeDistinctTypes([c('alley'), c('pack'), c('impoverseer')])).toBe(false);
    });
    it('an ALL-TYPES body always counts as the odd one out (owner ruling 2026-08-17)', () => {
      // Paragon counts as every tribe, so it can never be the reason an exhibition fails — not even beside two
      // minions that already share a type between them, and not even beside a second all-types body.
      const paragon = Object.values(CARD_INDEX).find((d) => d.universalTribe && !d.spell)!;
      expect(threeDistinctTypes([c('alley'), c(paragon.id), c('impoverseer')]), 'Beast + Paragon + Demon').toBe(true);
      expect(threeDistinctTypes([c('alley'), c(paragon.id), c('pack')]), 'two Beasts flanking Paragon').toBe(false);
      const other = Object.values(CARD_INDEX).find((d) => d.universalTribe && !d.spell && d.id !== paragon.id);
      if (other) expect(threeDistinctTypes([c(paragon.id), c(other.id), c('alley')]), 'two wildcards').toBe(true);
    });
    it('reads a DUAL-type card as whichever type avoids the clash (owner ruling)', () => {
      // Bane is Dragon/Demon. Beside a plain Dragon it must be read as a DEMON, so the pair is 2 types...
      const bane = CARD_INDEX['bane'];
      if (!bane?.tribe2) return; // content guard — skip if Bane ever loses its second type
      const dragon = Object.values(CARD_INDEX).find((d) => d.tribe === 'dragon' && !d.tribe2 && !d.spell)!;
      const beast = Object.values(CARD_INDEX).find((d) => d.tribe === 'beast' && !d.tribe2 && !d.spell)!;
      expect(threeDistinctTypes([c(dragon.id), c(bane.id), c(beast.id)]), 'Dragon + (Bane as Demon) + Beast').toBe(true);
      // …but a third card that is ALSO a Demon leaves Bane nowhere to go.
      const demon = Object.values(CARD_INDEX).find((d) => d.tribe === 'demon' && !d.tribe2 && !d.spell)!;
      expect(threeDistinctTypes([c(dragon.id), c(bane.id), c(demon.id)]), 'no assignment works').toBe(false);
    });
  });

  it('buffs all three when a minion lands between two others of different types', () => {
    const s = at({
      heroId: 'odelle', embers: 20, cardsPlayedTotal: 0,
      board: [m('l', 'alley'), m('r', 'impoverseer')],
      hand: [m('mid', 'karwind')], // Dragon between a Beast and a Demon
    });
    const after = reduce(s, { type: 'play', uid: 'mid', toIndex: 1 } as never);
    for (const uid of ['l', 'mid', 'r']) {
      const c = after.board.find((x) => x.uid === uid)!;
      expect(c.buffs?.some((b) => b.source === 'Exhibition'), `${uid} was exhibited`).toBe(true);
    }
  });

  it('does nothing when played on the END of the row — it must be BETWEEN two others', () => {
    const s = at({
      heroId: 'odelle', embers: 20,
      board: [m('l', 'alley'), m('r', 'impoverseer')],
      hand: [m('mid', 'karwind')],
    });
    const after = reduce(s, { type: 'play', uid: 'mid', toIndex: 2 } as never);
    expect(after.board.every((c) => !c.buffs?.some((b) => b.source === 'Exhibition'))).toBe(true);
  });

  it('the grant improves by +1/+1 every 4 cards played (owner balance 2026-08-17: was +2/+2)', () => {
    expect(exhibitionGrantOf(at({ cardsPlayedTotal: 0 }))).toBe(1);
    expect(exhibitionGrantOf(at({ cardsPlayedTotal: 3 }))).toBe(1);
    expect(exhibitionGrantOf(at({ cardsPlayedTotal: 4 }))).toBe(2);
    expect(exhibitionGrantOf(at({ cardsPlayedTotal: 8 }))).toBe(3);
  });

  it('the printed text matches the live grant — the number the panel shows is the one you get', () => {
    // The hero-power pill reads `exhibitionGrantOf` directly (StatusBar), so the rule text and the pill can
    // only agree if the base and the step in the text are the base and the step in the helper.
    expect(getHero('odelle').power.text).toContain('**+1/+1**');
    expect(exhibitionGrantOf(at({ cardsPlayedTotal: 0 })), 'the base in the text').toBe(1);
  });
});

describe('Harlan — Buyout', () => {
  it('is a 9-armor power priced at 11, falling 1 a turn', () => {
    const h = getHero('harlan');
    expect([h.armor, h.power.kind, h.power.untargeted]).toEqual([9, 'buyout', true]);
    expect(h.power.cost, 'no static cost — the live one is charged in the reducer').toBeUndefined();
    expect(buyoutCostOf(at({ wave: 1 }))).toBe(11);
    expect(buyoutCostOf(at({ wave: 5 }))).toBe(7);
    expect(buyoutCostOf(at({ wave: 5, harlanResetWave: 4 }))).toBe(10);
    expect(buyoutCostOf(at({ wave: 40 })), 'floors at 0').toBe(0);
  });

  it('takes the whole Shop, refreshes it, and re-bases the price', () => {
    const base = createRun(6) as RunState;
    const s = { ...base, phase: 'recruit', heroId: 'harlan', embers: 20, heroReady: true, hand: [], wave: 3 } as RunState;
    const offered = s.shop.length;
    expect(offered, 'the shop had cards').toBeGreaterThan(0);
    const after = reduce(s, { type: 'heroPower' } as never);
    expect(after.hand.length, 'every offer taken').toBe(offered);
    expect(after.shop.length, 'and the shop rerolled').toBeGreaterThan(0);
    expect(after.harlanResetWave, 'price re-based on use').toBe(3);
    expect(after.embers, 'charged 11 − 2 turns waited = 9').toBe(11);
  });

  it('takes what fits and DROPS the rest on a nearly-full hand (owner ruling)', () => {
    const base = createRun(6) as RunState;
    // DISTINCT cardIds on purpose: nine copies of one card would complete THREE triples and collapse to 3.
    const ids = ['stray', 'alley', 'pack', 'kennel', 'trailforager', 'raptor', 'gryphon', 'babycub', 'beetle'];
    const hand = ids.map((id, i) => m(`h${i}`, id));
    const s = { ...base, phase: 'recruit', heroId: 'harlan', embers: 30, heroReady: true, hand, wave: 3 } as RunState;
    const after = reduce(s, { type: 'heroPower' } as never);
    expect(after.hand.length, 'capped, never over').toBe(10);
    expect(after.shop.length, 'the shop still rerolled').toBeGreaterThan(0);
  });

  it('is a no-op it cannot afford — no charge, no take', () => {
    const base = createRun(6) as RunState;
    const s = { ...base, phase: 'recruit', heroId: 'harlan', embers: 2, heroReady: true, hand: [], wave: 1 } as RunState;
    const after = reduce(s, { type: 'heroPower' } as never);
    expect([after.embers, after.hand.length, after.heroReady]).toEqual([2, 0, true]);
  });
});

// Rascal's hero ID is `baggerben` — one hero, the id kept stable for saves/art while the display name is
// "Rascal" (the same convention as `hermithank` → "Tradesman"). There is no separate Bagger Ben.
describe('Rascal — All In (reworked)', () => {
  it('is now 9 armor with two uses', () => {
    const h = getHero('baggerben');
    expect([h.armor, h.power.kind, h.power.maxUses]).toEqual([9, 'allIn', 2]); // armor 6 -> 9 (2026-08-17)
    expect(h.power.oncePerGame ?? false, 'two uses, not one').toBe(false);
  });

  it('pays 1 + 2 per turn waited, and re-bases on use', () => {
    expect(allInPayoutOf(at({ wave: 1 }))).toBe(1);
    expect(allInPayoutOf(at({ wave: 4 }))).toBe(7);
    expect(allInPayoutOf(at({ wave: 4, rascalResetWave: 3 }))).toBe(3);
  });

  it('gains that Gold and re-bases', () => {
    const s = at({ heroId: 'baggerben', embers: 0, heroReady: true, wave: 4 });
    const after = reduce(s, { type: 'heroPower' } as never);
    expect(after.embers, 'wave 4, never used: 1 + 2*3 = 7').toBe(7);
    expect(after.rascalResetWave).toBe(4);
  });

  it("is displayed as Rascal, and no hero owns `scalingGold` any more", () => {
    expect(getHero('baggerben').name).toBe('Rascal');
    // Kept in the union for saved/replayed runs, but nothing in the live roster uses it.
    expect(HEROES.some((h) => h.power.kind === 'scalingGold')).toBe(false);
  });
});

describe('Sable — Soulbind', () => {
  it('is a 10-armor power with three uses', () => {
    const h = getHero('sable');
    expect([h.armor, h.power.kind, h.power.maxUses]).toEqual([10, 'soulbind', 3]);
  });

  it('binds the outermost minions', () => {
    const s = at({ heroId: 'sable', heroReady: true, wave: 2, board: [m('a', 'stray'), m('b', 'alley'), m('c', 'pack')] });
    const after = reduce(s, { type: 'heroPower' } as never);
    expect(after.sableBond).toEqual({ a: 'a', b: 'c', wave: 2 });
  });

  it('is a no-op with fewer than two minions', () => {
    const s = at({ heroId: 'sable', heroReady: true, board: [m('a', 'stray')] });
    const after = reduce(s, { type: 'heroPower' } as never);
    expect([after.sableBond, after.heroReady]).toEqual([undefined, true]);
  });

  it('mirrors a stat gain onto the partner IN FULL', () => {
    const board = [m('a', 'stray'), m('b', 'alley'), m('c', 'pack')];
    stampSableBond({ sableBond: { a: 'a', b: 'c', wave: 2 }, wave: 2, board } as RunState);
    addBuff(board[0]!, 'Test', 5, 6);
    expect([board[2]!.attack - 2, board[2]!.health - 2], 'the far end matched it').toEqual([5, 6]);
    expect([board[1]!.attack, board[1]!.health], 'the middle is untouched').toEqual([2, 2]);
  });

  it('mirrors ONE hop — no echo back (the loop guard)', () => {
    const board = [m('a', 'stray'), m('c', 'pack')];
    stampSableBond({ sableBond: { a: 'a', b: 'c', wave: 2 }, wave: 2, board } as RunState);
    addBuff(board[0]!, 'Test', 3, 3);
    // 2 base + 3 granted on each. If it echoed, both would run away.
    expect([board[0]!.attack, board[1]!.attack]).toEqual([5, 5]);
    expect(board[0]!.buffs?.find((b) => b.source === 'Soulbind'), 'the origin was not re-buffed').toBeUndefined();
  });

  // REGRESSION (owner report 2026-08-16): the bond silently did nothing in real play. The helper-level tests
  // above all passed, because they stamped and buffed the SAME array — the reducer does not. It deep-clones
  // the draft, and the stamp was taken from the pre-clone state, so every mirrored buff landed on a discarded
  // object. This test drives the REAL dispatch path, which is the only thing that would have caught it.
  it('mirrors through a real dispatch — a spell cast on one end reaches the other', () => {
    const board = [m('a', 'stray'), m('b', 'alley'), m('c', 'pack')];
    let s = at({
      heroId: 'sable', heroReady: true, wave: 2, embers: 20, board,
      hand: [{ uid: 'sp', cardId: 'growth', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    });
    s = reduce(s, { type: 'heroPower' } as never);
    expect(s.sableBond, 'the bond was forged').toBeTruthy();
    // Growth buffs the WHOLE board, so use a single-target grant instead: Front to Back on the left end.
    s = { ...s, hand: [{ uid: 'sp2', cardId: 'fronttoback', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] } as RunState;
    const after = reduce(s, { type: 'play', uid: 'sp2', targetUid: 'a' } as never);
    const left = after.board.find((c) => c.uid === 'a')!;
    const right = after.board.find((c) => c.uid === 'c')!;
    const mid = after.board.find((c) => c.uid === 'b')!;
    expect(left.attack, 'the target grew').toBeGreaterThan(2);
    expect([right.attack, right.health], 'and the bound far end matched it').toEqual([left.attack, left.health]);
    expect([mid.attack, mid.health], 'the middle is untouched').toEqual([2, 2]);
  });

  it('an expired bond (a later wave) does not mirror', () => {
    const board = [m('a', 'stray'), m('c', 'pack')];
    stampSableBond({ sableBond: { a: 'a', b: 'c', wave: 2 }, wave: 3, board } as RunState);
    addBuff(board[0]!, 'Test', 4, 4);
    expect(board[1]!.attack, 'the bond lapsed with the turn').toBe(2);
  });
});

describe('Yirin — Reflector', () => {
  it('is an 8-armor passive', () => {
    const h = getHero('rohan'); // id kept stable for saves; display name is Yirin
    expect([h.name, h.armor, h.power.kind, h.power.passive]).toEqual(['Yirin', 8, 'startingReflector', true]);
  });

  it('starts the run holding one Reflector', () => {
    const s = createRun(5, 'rohan') as RunState;
    expect(s.hand.filter((c) => c.cardId === 'n2_reflector').length).toBe(1);
  });

  it('no other hero starts with one', () => {
    expect((createRun(5, 'indy') as RunState).hand.some((c) => c.cardId === 'n2_reflector')).toBe(false);
  });

  it('the Reflector is a TOKEN — never drawable from a shop pool', () => {
    const def = CARD_INDEX['n2_reflector']!;
    expect([def.tier, def.tribe, def.attack, def.health, def.token]).toEqual([1, 'neutral', 1, 1, true]);
  });

  it('a spell cast on it also lands on ONE other friendly — once per turn', () => {
    const s = at({
      heroId: 'rohan', embers: 20,
      board: [m('r', 'n2_reflector'), m('o', 'alley')],
      hand: [{ uid: 'sp', cardId: 'fronttoback', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    });
    const after = reduce(s, { type: 'play', uid: 'sp', targetUid: 'r' } as never);
    expect(after.board.find((c) => c.uid === 'r')!.attack, 'the Reflector took the cast').toBeGreaterThan(2);
    expect(after.board.find((c) => c.uid === 'o')!.attack, 'and it was mirrored on').toBeGreaterThan(2);
  });

  it('does not re-cast on ITSELF when it is the only minion', () => {
    const s = at({
      heroId: 'rohan', embers: 20,
      board: [m('r', 'n2_reflector')],
      hand: [{ uid: 'sp', cardId: 'fronttoback', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    });
    const after = reduce(s, { type: 'play', uid: 'sp', targetUid: 'r' } as never);
    // Front to Back grants +2/+2 (plus spell power). A self re-cast would roughly double it.
    const grown = after.board[0]!.attack - 2;
    expect(grown, 'exactly one cast landed').toBeLessThan(6);
  });

  it('the SECOND spell in a turn does not spread (once per turn)', () => {
    let s = at({
      heroId: 'rohan', embers: 20,
      board: [m('r', 'n2_reflector'), m('o', 'alley')],
      hand: [{ uid: 'sp', cardId: 'fronttoback', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
    });
    s = reduce(s, { type: 'play', uid: 'sp', targetUid: 'r' } as never);
    const afterFirst = s.board.find((c) => c.uid === 'o')!.attack;
    s = { ...s, hand: [{ uid: 'sp2', cardId: 'fronttoback', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] } as RunState;
    const after = reduce(s, { type: 'play', uid: 'sp2', targetUid: 'r' } as never);
    expect(after.board.find((c) => c.uid === 'o')!.attack, 'the bystander was not hit twice').toBe(afterFirst);
  });
});

describe('Cassen — Commission (owner rework 2026-08-16)', () => {
  it('is enabled, free and untargeted', () => {
    const h = getHero('cassen');
    expect([h.power.kind, h.power.untargeted, h.wip ?? false]).toEqual(['commission', true, false]);
    expect(h.power.cost ?? 0, 'free to activate').toBe(0);
  });

  it('offers all three the first time, then never the one taken last', () => {
    expect(commissionOffer({} as RunState).sort()).toEqual(['discover', 'gold', 'spell']);
    expect(commissionOffer({ lastCommission: 'gold' } as RunState)).not.toContain('gold');
    expect(commissionOffer({ lastCommission: 'gold' } as RunState).length).toBe(2);
  });

  it('starts a commission with the right due wave and records it as last-taken', () => {
    const s = at({ heroId: 'cassen', heroReady: true, wave: 4 });
    const after = reduce(s, { type: 'heroPower', commission: 'gold' } as never);
    expect(after.commission, 'gold matures in 2 turns').toEqual({ kind: 'gold', dueWave: 6 });
    expect(after.lastCommission).toBe('gold');
  });

  it('refuses a commission that is not on offer', () => {
    const s = at({ heroId: 'cassen', heroReady: true, wave: 4, lastCommission: 'gold' });
    const after = reduce(s, { type: 'heroPower', commission: 'gold' } as never);
    expect([after.commission, after.heroReady]).toEqual([undefined, true]);
  });

  it('only ONE can run at a time', () => {
    const s = at({ heroId: 'cassen', heroReady: true, wave: 4, commission: { kind: 'spell', dueWave: 5 } });
    const after = reduce(s, { type: 'heroPower', commission: 'discover' } as never);
    expect(after.commission, 'the running one is untouched').toEqual({ kind: 'spell', dueWave: 5 });
  });

  it('the panel prints the running commission, otherwise the options on offer', () => {
    const running = heroPowerText({ ...createRun(3, 'cassen'), commission: { kind: 'gold', dueWave: 6 } } as RunState);
    expect(running).toContain('Working');
    expect(running).toContain('2 Gold');
    const offering = heroPowerText({ ...createRun(3, 'cassen'), lastCommission: 'gold' } as RunState);
    expect(offering).toContain('Choose one');
    expect(offering, 'the last-taken option is not re-offered').not.toContain('2 Gold');
  });
});

describe('Warden — Aegis scales with Tavern Tier', () => {
  it('is enabled', () => {
    expect(getHero('warden').wip ?? false).toBe(false);
  });

  it('grants Ward AND buffs every Warded minion by +Tier/+Tier+1', () => {
    const s = at({
      heroId: 'warden', heroReady: true, embers: 10, tier: 3,
      board: [m('a', 'stray'), { ...m('b', 'alley'), keywords: ['DS'] } as never, m('c', 'pack')],
    });
    const after = reduce(s, { type: 'heroPower', uid: 'a' } as never);
    const a = after.board.find((c) => c.uid === 'a')!;
    const b = after.board.find((c) => c.uid === 'b')!;
    const c = after.board.find((x) => x.uid === 'c')!;
    expect(a.keywords, 'the target gained Ward').toContain('DS');
    expect([a.attack - 2, a.health - 2], 'and the fresh Ward is buffed too').toEqual([3, 4]);
    expect([b.attack - 2, b.health - 2], 'an already-Warded minion is buffed').toEqual([3, 4]);
    expect([c.attack, c.health], 'an unwarded minion is untouched').toEqual([2, 2]);
  });

  it('the printed rule shows the LIVE tier value', () => {
    expect(heroPowerText({ ...createRun(3, 'warden'), tier: 5 } as RunState)).toContain('+5/+6');
  });
});

describe('Auctioneer + Sable renames', () => {
  it('Myra is displayed as Auctioneer and is enabled', () => {
    const h = getHero('myra'); // id kept stable for saves / art
    expect([h.name, h.wip ?? false]).toEqual(['Auctioneer', false]);
  });
  it('Sable dropped her title', () => {
    expect(getHero('sable').name).toBe('Sable');
  });
});
