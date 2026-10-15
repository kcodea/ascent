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

  it('six Legendary crate plates (owner: "every other one should be a legendary reward"), each art key its own id, each naming its master', () => {
    expect(PLATES.map((c) => [c.id, c.name, c.rarity, c.acquisition.type, c.assets.art, c.assets.master, c.target])).toEqual([
      ['plate_aquarium_rocks', 'Aquarium Rocks', 'legendary', 'crate', 'plate_aquarium_rocks', 'Aquarium Rocks.png', undefined],
      ['plate_amethyst', 'Amethyst', 'legendary', 'crate', 'plate_amethyst', 'Amethyst.png', undefined],
      ['plate_bamboo', 'Bamboo', 'legendary', 'crate', 'plate_bamboo', 'Bamboo.png', undefined],
      ['plate_beach', 'Beach', 'legendary', 'crate', 'plate_beach', 'Beach.png', undefined],
      ['plate_magma', 'Magma', 'legendary', 'crate', 'plate_magma', 'Magma.png', undefined],
      ['plate_moonstone', 'Moonstone', 'legendary', 'crate', 'plate_moonstone', 'Moonstone.png', undefined],
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
