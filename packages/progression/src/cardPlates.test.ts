import { afterEach, describe, expect, it } from 'vitest';
import {
  COSMETICS, COSMETIC_CATEGORY_DEFS, EQUIP_SLOTS, GLOBAL_EQUIP_SLOTS, cardPlateOf, eligibleCrateCosmetics, loadoutFromRows,
  parseCosmeticSnapshot, setServerCatalogState, snapshotForRun,
} from './cosmetics';
import { validateInventoryBody } from './inventory';

/**
 * CARD PLATES (owner 2026-10-14: "Turn Aquarium Rocks into a real equippable card plate cosmetic, with its own darkening
 * settings, and leave the standard plates untouched"; a crate drop; "Others see it too"). The catalog entry, the
 * account-wide `card_plate` slot, the loadout and the run snapshot carrying it, and the one resolver that drops unknown /
 * retired / wrong-category ids. The plate's pixels and darkening are the UI's (packages/ui/src/cardPlate/).
 */
const PLATES = COSMETICS.filter((c) => c.category === 'card_plate');

afterEach(() => setServerCatalogState(null));

describe('the card plate catalog', () => {
  it('Card Plates is a live, account-wide category', () => {
    expect(COSMETIC_CATEGORY_DEFS.card_plate).toEqual({ id: 'card_plate', label: 'Card Plates', weight: 10, enabled: true, target: 'global' });
  });

  it('forty-three crate plates, Legendary unless the owner says otherwise (Simple Black, Simple White, Simple Glass and Mooncloud are Ancient; Aquarium Rocks, Moonstone, Bamboo, Beach, Magma, Stonevines, Porcelain, the Smooth and Hand Drawn plates and Dark Arcane Epic; the Standard colours Rare), each art key its own id, each naming its master', () => {
    expect(PLATES.map((c) => [c.id, c.name, c.rarity, c.acquisition.type, c.assets.art, c.assets.master, c.target])).toEqual([
      ['plate_aquarium_rocks', 'Aquarium Rocks', 'epic', 'crate', 'plate_aquarium_rocks', 'Aquarium Rocks.png', undefined],
      ['plate_amethyst', 'Amethyst', 'legendary', 'crate', 'plate_amethyst', 'Amethyst.png', undefined],
      ['plate_bamboo', 'Bamboo', 'epic', 'crate', 'plate_bamboo', 'Bamboo.png', undefined],
      ['plate_beach', 'Beach', 'epic', 'crate', 'plate_beach', 'Beach Frame.png', undefined],
      ['plate_magma', 'Magma', 'epic', 'crate', 'plate_magma', 'Magma Frame.png', undefined],
      ['plate_moonstone', 'Moonstone', 'epic', 'crate', 'plate_moonstone', 'Moonstone Frame.png', undefined],
      ['plate_mooncloud', 'Mooncloud', 'ancient', 'crate', 'plate_mooncloud', 'Mooncloud.png', undefined],
      ['plate_galaxy', 'Galaxy', 'legendary', 'crate', 'plate_galaxy', 'Galaxy.png', undefined],
      ['plate_crackling_gemstone', 'Crackling Gemstone', 'legendary', 'crate', 'plate_crackling_gemstone', 'Crackling Gemstone.png', undefined],
      ['plate_hand_drawn', 'Hand Drawn', 'epic', 'crate', 'plate_hand_drawn', 'Hand Drawn.png', undefined],
      ['plate_blue_hand_drawn', 'Blue Hand Drawn', 'epic', 'crate', 'plate_blue_hand_drawn', 'Blue Hand Drawn.png', undefined],
      ['plate_green_hand_drawn', 'Green Hand Drawn', 'epic', 'crate', 'plate_green_hand_drawn', 'Green Hand Drawn.png', undefined],
      ['plate_simple_black', 'Simple Black', 'ancient', 'crate', 'plate_simple_black', 'Simpleblack Frame.png', undefined],
      ['plate_simple_white', 'Simple White', 'ancient', 'crate', 'plate_simple_white', 'Simplewhite.png', undefined],
      ['plate_topaz', 'Topaz', 'legendary', 'crate', 'plate_topaz', 'Topaz.png', undefined],
      ['plate_smooth_aqua', 'Smooth Aqua', 'epic', 'crate', 'plate_smooth_aqua', 'Smooth Aqua.png', undefined],
      ['plate_smooth_blue', 'Smooth Blue', 'epic', 'crate', 'plate_smooth_blue', 'Smooth Blue.png', undefined],
      ['plate_smooth_red', 'Smooth Red', 'epic', 'crate', 'plate_smooth_red', 'Smooth Red.png', undefined],
      ['plate_blossom', 'Blossom', 'legendary', 'crate', 'plate_blossom', 'Test Blossom Frame.png', undefined],
      ['plate_dark_arcane', 'Dark Arcane', 'epic', 'crate', 'plate_dark_arcane', 'Dark Arcane.png', undefined],
      ['plate_simple_glass', 'Simple Glass', 'ancient', 'crate', 'plate_simple_glass', 'Simpleglass.png', undefined],
      ['plate_stonevines', 'Stonevines', 'epic', 'crate', 'plate_stonevines', 'Stonevines.png', undefined],
      ['plate_standard_black', 'Standard Black', 'rare', 'crate', 'plate_standard_black', 'Standard Black.png', undefined],
      ['plate_standard_blue', 'Standard Blue', 'rare', 'crate', 'plate_standard_blue', 'Standard Blue.png', undefined],
      ['plate_standard_pink', 'Standard Pink', 'rare', 'crate', 'plate_standard_pink', 'Standard Pink.png', undefined],
      ['plate_standard_teal', 'Standard Teal', 'rare', 'crate', 'plate_standard_teal', 'Standard Teal.png', undefined],
      ['plate_chrome', 'Chrome', 'legendary', 'crate', 'plate_chrome', 'Chrome.png', undefined],
      ['plate_spirit_carving', 'Spirit Carving', 'legendary', 'crate', 'plate_spirit_carving', 'Ascendant Carving.png', undefined],
      ['plate_iridescent', 'Iridescent', 'legendary', 'crate', 'plate_iridescent', 'Iridescent.png', undefined],
      ['plate_mystic_obsidian', 'Mystic Obsidian', 'legendary', 'crate', 'plate_mystic_obsidian', 'Mystic Obsidian.png', undefined],
      ['plate_porcelain', 'Porcelain', 'epic', 'crate', 'plate_porcelain', 'Porcelain.png', undefined],
      ['plate_smooth_iridescent', 'Smooth Iridescent', 'legendary', 'crate', 'plate_smooth_iridescent', 'Smooth Iridescent.png', undefined],
      ['plate_battletorn', 'Battletorn', 'legendary', 'crate', 'plate_battletorn', 'Battletorn.png', undefined],
      ['plate_ethereal', 'Ethereal', 'legendary', 'crate', 'plate_ethereal', 'Ethereal.png', undefined],
      ['plate_round_magic', 'Round Magic', 'legendary', 'crate', 'plate_round_magic', 'Round Magic.png', undefined],
      ['plate_verdant_magic', 'Verdant Magic', 'legendary', 'crate', 'plate_verdant_magic', 'Silver Magic.png', undefined],
      ['plate_phoenix_plate', 'Phoenix Plate', 'legendary', 'crate', 'plate_phoenix_plate', 'Phoenix Plate.png', undefined],
      ['plate_emerald', 'Emerald', 'legendary', 'crate', 'plate_emerald', 'Emerald.png', undefined],
      ['plate_gilt_etched', 'Gilt Etched', 'legendary', 'crate', 'plate_gilt_etched', 'Gold Etched.png', undefined],
      ['plate_astral_relic', 'Astral Relic', 'legendary', 'crate', 'plate_astral_relic', 'Astral Relic.png', undefined],
      ['plate_blood_omen', 'Blood Omen', 'legendary', 'crate', 'plate_blood_omen', 'Blood Omen.png', undefined],
      ['plate_honey', 'Honey', 'legendary', 'crate', 'plate_honey', 'Honey.png', undefined],
      ['plate_goop', 'Goop', 'legendary', 'crate', 'plate_goop', 'Goop.png', undefined],
    ]);
    expect(eligibleCrateCosmetics([]).map((c) => c.id)).toContain('plate_aquarium_rocks');
    expect(eligibleCrateCosmetics(['plate_aquarium_rocks']).map((c) => c.id)).not.toContain('plate_aquarium_rocks');
  });
});

describe('the equip slot, the loadout and the snapshot', () => {
  it('card_plate is an account-wide slot (target \'\'), accepted by the inventory request parser', () => {
    expect(EQUIP_SLOTS).toContain('card_plate');
    expect(GLOBAL_EQUIP_SLOTS).toContain('card_plate');
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'card_plate', targetId: '', cosmeticId: 'plate_aquarium_rocks' }))
      .toEqual({ ok: true, request: { action: 'equip_cosmetic', slot: 'card_plate', targetId: '', cosmeticId: 'plate_aquarium_rocks' } });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'card_plate', targetId: '', cosmeticId: null })).toMatchObject({ ok: true });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'card_plate', targetId: 'k_pouchpincher', cosmeticId: 'plate_aquarium_rocks' })).toMatchObject({ ok: false, error: 'bad_target' });
  });

  it('the loadout row folds into the snapshot shape; a named target is ignored', () => {
    expect(loadoutFromRows([{ slot: 'card_plate', targetId: '', cosmeticId: 'plate_aquarium_rocks' }])).toEqual({ cardPlate: 'plate_aquarium_rocks' });
    expect(loadoutFromRows([{ slot: 'card_plate', target_id: '', cosmetic_id: 'plate_aquarium_rocks' }])).toEqual({ cardPlate: 'plate_aquarium_rocks' });
    expect(loadoutFromRows([{ slot: 'card_plate', targetId: 'warden', cosmeticId: 'plate_aquarium_rocks' }])).toEqual({});
  });

  it('a run records a LIVE plate (so the players you meet see it); a recorded snapshot keeps any well-formed id', () => {
    expect(snapshotForRun({ cardPlate: 'plate_aquarium_rocks' })).toEqual({ cardPlate: 'plate_aquarium_rocks' });
    expect(snapshotForRun({ cardPlate: 'plate_aquarium_rocks', portraitFrame: 'frame_fire' })).toEqual({ cardPlate: 'plate_aquarium_rocks', portraitFrame: 'frame_fire' });
    expect(snapshotForRun({ cardPlate: 'plate_nope' })).toBeNull();
    expect(snapshotForRun({ cardPlate: 'frame_fire' })).toBeNull();
    expect(parseCosmeticSnapshot({ cardPlate: 'plate_future' })).toEqual({ cardPlate: 'plate_future' });
    expect(parseCosmeticSnapshot({ cardPlate: 'bad id!' })).toBeNull();
  });

  it('cardPlateOf: the plate, or null for none / unknown / another category / retired (item or category)', () => {
    expect(cardPlateOf({ cardPlate: 'plate_aquarium_rocks' })?.id).toBe('plate_aquarium_rocks');
    expect(cardPlateOf(null)).toBeNull();
    expect(cardPlateOf({ cardPlate: 'plate_unknown' })).toBeNull();
    expect(cardPlateOf({ cardPlate: 'frame_water' })).toBeNull();
    setServerCatalogState({ retiredIds: ['plate_aquarium_rocks'], disabledCategories: [] });
    expect(cardPlateOf({ cardPlate: 'plate_aquarium_rocks' })).toBeNull();
    setServerCatalogState({ retiredIds: [], disabledCategories: ['card_plate'] });
    expect(cardPlateOf({ cardPlate: 'plate_aquarium_rocks' })).toBeNull();
  });
});
