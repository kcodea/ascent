import { describe, expect, it } from 'vitest';
import { ACHIEVEMENT_INDEX, COLLECTION_METRIC, UNIQUE_PLATE_REWARD_TEXT } from './achievements';
import {
  ALL_COSMETIC_RARITIES, COSMETICS, COSMETIC_RARITIES, PLUSHIE_BEASTS_COLLECTION_ID, PLUSHIE_BEAST_SKIN_IDS, PLUSHIE_PLATE_ID, RARITY_LABELS,
  catalogSyncPayload, collectionMembers, cosmeticOf, eligibleCrateCosmetics,
} from './cosmetics';
import { atOrAbove } from './crateShop';

/**
 * THE PLUSHIE PLATE (owner 2026-10-27): "i want this to be a secrete unlock that the players are given once they unlock
 * every Plushie Beast cosmetic ... can we create a new achievement and say the reward is a 'Unique Card Plate Only
 * Available From Completing This Achievement'?", then "wont it have its own category as \"Secret\"? we can make it Red,
 * over Ancient. Should ONLY show up once you unlock it". The database side is plushiePlate.db.test.ts.
 */
describe('the Plushie Beast collection', () => {
  it('holds every Plushie minion skin, and only those (a new Plushie Beast must join the list)', () => {
    const plushies = COSMETICS.filter((c) => c.category === 'minion_skin' && c.name.startsWith('Plushie ')).map((c) => c.id).sort();
    expect([...PLUSHIE_BEAST_SKIN_IDS].sort()).toEqual(plushies);
    expect(collectionMembers(PLUSHIE_BEASTS_COLLECTION_ID).map((c) => c.id).sort()).toEqual(plushies);
    expect(plushies).toHaveLength(24);
    expect(COSMETICS.filter((c) => c.collection !== undefined).every((c) => c.collection === PLUSHIE_BEASTS_COLLECTION_ID)).toBe(true);
  });

  it('the sync payload carries the collection on its members only', () => {
    const items = catalogSyncPayload().items;
    expect(items.filter((i) => i.collectionId === PLUSHIE_BEASTS_COLLECTION_ID).map((i) => i.cosmeticId).sort()).toEqual([...PLUSHIE_BEAST_SKIN_IDS].sort());
    expect(items.filter((i) => 'collectionId' in i)).toHaveLength(24);
  });
});

describe('the achievement', () => {
  it('is visible with a progress bar toward the collection size, pays no XP, and names the plate as its reward', () => {
    const a = ACHIEVEMENT_INDEX[PLUSHIE_BEASTS_COLLECTION_ID]!;
    expect(a).toMatchObject({
      name: 'Plushie Collector', requirement: 'Own every Plushie Beast skin.', category: 'collection', mode: 'account', metric: COLLECTION_METRIC,
      target: 24, hidden: false, showProgress: true, rewards: { xp: 0, titleId: null, cosmeticId: PLUSHIE_PLATE_ID },
    });
    expect(UNIQUE_PLATE_REWARD_TEXT).toBe('Unique Card Plate Only Available From Completing This Achievement');
  });
});

describe('the Secret rarity and the plate', () => {
  it('Secret ranks above Ancient, is red-labelled "Secret", and is not on the crate ladder', () => {
    expect(ALL_COSMETIC_RARITIES).toEqual(['common', 'rare', 'epic', 'legendary', 'ancient', 'secret']);
    expect(COSMETIC_RARITIES).not.toContain('secret');
    expect(RARITY_LABELS.secret).toBe('Secret');
    expect(atOrAbove('secret', 'common')).toBe(false);
  });

  it('the plate is the only Secret item: a card plate, achievement-only, never in a crate', () => {
    expect(COSMETICS.filter((c) => c.rarity === 'secret').map((c) => c.id)).toEqual([PLUSHIE_PLATE_ID]);
    expect(cosmeticOf(PLUSHIE_PLATE_ID)).toMatchObject({
      category: 'card_plate', name: 'Plushie', acquisition: { type: 'achievement', id: PLUSHIE_BEASTS_COLLECTION_ID }, assets: { art: PLUSHIE_PLATE_ID, master: 'Plushie Plate.png' },
    });
    expect(eligibleCrateCosmetics([]).map((c) => c.id)).not.toContain(PLUSHIE_PLATE_ID);
  });
});
