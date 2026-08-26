/**
 * GIFTS (owner design 2026-08-26) — the class contract, not the individual payouts.
 *
 * A Gift is a spell that COUNTS AS A CAST but is never a SHOP spell: absent from every pool, uncopyable, and
 * never multiplied. These are the properties that make it a distinct class; if any regress, a Gift has
 * quietly become an ordinary spell.
 */
import { describe, expect, it } from 'vitest';
import { ALL_CARDS, CARD_INDEX, GIFTS, GIFT_IDS, SETS } from '@game/content';
import { createRun, reduce, type Action, type RunState } from './index';
import { HEROES } from './heroes';

describe('the Gift class', () => {
  it('every Gift is a free, single-cast spell flagged as a Gift', () => {
    expect(GIFTS.length).toBe(15);
    for (const g of GIFTS) {
      expect([g.id, g.spell], `${g.id} must be a spell`).toEqual([g.id, true]);
      expect(g.gift, `${g.id} must carry the gift flag`).toBe(true);
      expect(g.cost, `${g.id} is free`).toBe(0);
      expect(g.singleCast, `${g.id} can never be multiplied`).toBe(true);
      expect(g.token, `${g.id} is NOT a reward token — it counts as a cast`).toBeFalsy();
      expect(g.rewardSpell, `${g.id} is NOT a reward spell — it counts as a cast`).toBeFalsy();
    }
  });

  it('resolves by id globally but belongs to NO set — so no shop or pool Discover can offer one', () => {
    for (const id of GIFT_IDS) expect(CARD_INDEX[id], `${id} must resolve`).toBeTruthy();
    for (const set of Object.values(SETS)) {
      const leaked = set.own.filter((c) => c.gift).map((c) => c.id);
      expect(leaked, `set ${set.id} must not contain Gifts`).toEqual([]);
    }
  });

  it('is registered in ALL_CARDS exactly once each', () => {
    for (const id of GIFT_IDS) {
      expect(ALL_CARDS.filter((c) => c.id === id).length, id).toBe(1);
    }
  });

  it('COUNTS AS A SPELL CAST, but never becomes copy-food (the whole class contract)', () => {
    let st = createRun(7, 'aster');
    st = { ...st, hand: [{ uid: 'g1', cardId: 'gift_premium_stock', tribe: 'neutral', attack: 0, health: 1, keywords: [] }] as never };
    const castsBefore = st.spellsCast;
    const next = reduce(st, { type: 'play', uid: 'g1' } as Action);
    // Counted as a cast…
    expect(next.spellsCast, 'a Gift counts as a spell cast').toBe(castsBefore + 1);
    expect(next.spellsThisTurn, 'and toward the per-turn tally').toBe(1);
    // …and the effect landed (Premium Stock is the run-wide shop channel).
    expect(next.tavernBuyBonus.atk, 'Premium Stock buffed the shop').toBeGreaterThanOrEqual(4);
    // …but it is NOT copy-food: none of the copy memories learned it.
    expect(next.lastSpellCastId, 'Steward must not copy a Gift').not.toBe('gift_premium_stock');
    expect(next.firstSpellThisTurnId, 'Recurrence must not recast a Gift').not.toBe('gift_premium_stock');
  });
});

describe('the Gift sources', () => {
  const giftsInHand = (s: RunState): string[] => s.hand.map((c) => c.cardId).filter((id) => GIFT_IDS.includes(id));

  // Drive the real forge path: a rune is bought by INDEX out of `runeforgeOffer`, so the offer is staged first.
  const buyRune = (id: string): RunState => {
    let s = createRun(11, 'aster');
    s = { ...s, runeforgeOffer: [id], embers: 20 } as RunState;
    return reduce(s, { type: 'buyRune', index: 0 } as Action);
  };

  it('Happy Birthday (Basic) hands over a random Gift on purchase', () => {
    const s = buyRune('rune_happy_birthday');
    expect(s.runeHappyBirthday, 'the rune armed').toBe(true);
    expect(giftsInHand(s).length, 'and paid out immediately').toBe(1);
  });

  it('Merry Christmas (Epic) opens a Gift Discover on purchase', () => {
    const s = buyRune('rune_merry_christmas');
    expect(s.runeMerryChristmas).toBe(true);
    // `queueDiscover` opens immediately when no modal is up, so the offer lands on `discover` itself.
    const offered: string[] = (s.discover ?? []) as string[];
    expect(offered.length, 'a Discover opened').toBeGreaterThan(0);
    expect(offered.every((id) => GIFT_IDS.includes(id)), 'and every option is a Gift').toBe(true);
  });

  it('Kindness carries 15 Armor and a passive Gift schedule', () => {
    const h = HEROES.find((x) => x.id === 'kindness')!;
    expect(h.armor).toBe(15);
    expect([h.power.kind, h.power.passive]).toEqual(['greatPresence', true]);
  });
});

describe('Grave Invitation actually grants its keywords', () => {
  it("arms Rise + Taunt on the pick (the field used to parse but never be read)", () => {
    let s = createRun(11, 'aster');
    s = { ...s, tier: 3, hand: [{ uid: 'g1', cardId: 'gift_grave_invitation', tribe: 'neutral', attack: 0, health: 1, keywords: [] }] as never };
    s = reduce(s, { type: 'play', uid: 'g1' } as Action);
    expect(s.discoverKeywords, 'the pick must gain Rise + Taunt').toEqual(['R', 'T']);
  });
});
