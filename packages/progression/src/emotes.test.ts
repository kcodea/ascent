import { afterEach, describe, expect, it } from 'vitest';
import {
  COSMETICS, COSMETIC_CATEGORY_DEFS, EMOTE_SLOT_COUNT, EQUIP_SLOTS, GLOBAL_EQUIP_SLOTS, STARTER_EMOTE_IDS, catalogSyncPayload, eligibleCrateCosmetics,
  emoteLoadoutOf, emoteOf, emotePositionOf, isStarterCosmetic, loadoutFromRows, parseCosmeticSnapshot, setServerCatalogState, snapshotForRun,
  withEmoteAt, withStarterCosmetics, type CosmeticDef,
} from './cosmetics';
import { validateInventoryBody } from './inventory';

/**
 * EMOTES (owner spec 2026-10-13): "Emotes are a new COSMETIC type in Collections ... Players equip up to 4 in
 * Collections. Unlock source: crates, plus starter emotes everyone owns." and the four painted bubbles are the
 * starters, "owned and equipped by default for everyone".
 */
const [A, B, C, D] = ['emote_angry_mushy', 'emote_flirty_midas', 'emote_nervous_jensen', 'emote_zen_brian'];

afterEach(() => setServerCatalogState(null));

describe('the emote catalog', () => {
  it('a live, account-wide category with the four starters (EmoteTemplate is not one)', () => {
    expect(COSMETIC_CATEGORY_DEFS.emote).toEqual({ id: 'emote', label: 'Emotes', weight: 10, enabled: true, target: 'global' });
    const emotes = COSMETICS.filter((c) => c.category === 'emote');
    expect(emotes.map((c) => [c.id, c.name, c.acquisition.type, c.assets.master])).toEqual([
      [A, 'Angry Mushy', 'starter', 'AngryMushy.png'], [B, 'Flirty Midas', 'starter', 'FlirtyMidas.png'],
      [C, 'Nervous Jensen', 'starter', 'NervousJensen.png'], [D, 'Zen Brian', 'starter', 'ZenBrian.png'],
    ]);
    expect(emotes.some((c) => /template/i.test(c.id) || /template/i.test(String(c.assets.master)))).toBe(false);
    expect(STARTER_EMOTE_IDS).toEqual([A, B, C, D]);
    expect(STARTER_EMOTE_IDS.every(isStarterCosmetic)).toBe(true);
    expect(isStarterCosmetic('title_wanderer')).toBe(false);
  });

  it('starters never drop from a crate; a CRATE emote would (the data path is the ordinary one)', () => {
    expect(eligibleCrateCosmetics([]).some((c) => c.category === 'emote')).toBe(false);
    const crateEmote: CosmeticDef = { id: 'emote_test_crate', category: 'emote', name: 'Test', rarity: 'rare', acquisition: { type: 'crate' }, assets: { art: 'emote_test_crate' }, active: true };
    expect(eligibleCrateCosmetics([], [...COSMETICS, crateEmote]).map((c) => c.id)).toContain('emote_test_crate');
  });

  it('everyone owns the starters, a guest included; nothing is duplicated', () => {
    expect(withStarterCosmetics(null)).toEqual([A, B, C, D]);
    expect(withStarterCosmetics(['title_wanderer', B])).toEqual(['title_wanderer', B, A, C, D]);
  });

  it('the catalog sync sends the starters with acquisition source "starter" (the 2026-10-13 SQL widens the check)', () => {
    const items = catalogSyncPayload().items.filter((i) => i.category === 'emote');
    expect(items.map((i) => [i.cosmeticId, i.acquisitionSource, i.targetType, i.targetId])).toEqual([[A, 'starter', null, null], [B, 'starter', null, null], [C, 'starter', null, null], [D, 'starter', null, null]]);
  });
});

describe('the four-position menu (loadout default / equip)', () => {
  it('a fresh account (no rows, or no profile at all) shows the four starters in catalog order', () => {
    expect(EMOTE_SLOT_COUNT).toBe(4);
    expect(emoteLoadoutOf(null)).toEqual([A, B, C, D]);
    expect(emoteLoadoutOf({})).toEqual([A, B, C, D]);
  });

  it('an explicit position wins; putting a starter elsewhere SWAPS it with the one that was there', () => {
    expect(emoteLoadoutOf({ emotes: { 0: C } })).toEqual([C, B, A, D]);
    expect(emoteLoadoutOf({ emotes: { 3: A } })).toEqual([D, B, C, A]);
    expect(emotePositionOf({ emotes: { 0: C } }, C)).toBe(0);
    expect(emotePositionOf({ emotes: { 0: C } }, 'emote_unknown')).toBe(-1);
  });

  it('a duplicate keeps its lowest position; an unknown or retired emote is dropped and its position refilled', () => {
    expect(emoteLoadoutOf({ emotes: { 1: D, 2: D } })).toEqual([A, D, C, B]);
    expect(emoteLoadoutOf({ emotes: { 0: 'emote_from_a_newer_client' } })).toEqual([A, B, C, D]);
    setServerCatalogState({ retiredIds: [B], disabledCategories: [] });
    expect(emoteLoadoutOf(null)).toEqual([A, C, D]); // nothing can fill the fourth position
    setServerCatalogState({ retiredIds: [], disabledCategories: ['emote'] });
    expect(emoteLoadoutOf(null)).toEqual([]);
    expect(emoteOf(A)).toBeNull();
  });

  it('withEmoteAt moves an emote like the SQL (it leaves its other position); null clears a position', () => {
    const one = withEmoteAt(null, 0, C);
    expect(one.emotes).toEqual({ 0: C });
    const moved = withEmoteAt(one, 2, C);
    expect(moved.emotes).toEqual({ 2: C });
    expect(emoteLoadoutOf(moved)).toEqual([A, B, C, D]);
    expect(withEmoteAt(moved, 2, null).emotes).toBeUndefined();
    // other loadout fields ride through untouched
    expect(withEmoteAt({ heroAttack: 'attack_blast' }, 1, D)).toEqual({ heroAttack: 'attack_blast', emotes: { 1: D } });
  });

  it('loadout rows: the emote slot keys by position 0 to 3; anything else is dropped', () => {
    expect(loadoutFromRows([
      { slot: 'emote', targetId: '0', cosmeticId: C }, { slot: 'emote', target_id: '3', cosmetic_id: A },
      { slot: 'emote', targetId: '4', cosmeticId: B }, { slot: 'emote', targetId: '', cosmeticId: B },
    ])).toEqual({ emotes: { 0: C, 3: A } });
  });

  it('the menu is LIVE LOADOUT ONLY: never recorded on a run snapshot (a run records the emotes USED, per board)', () => {
    expect(snapshotForRun({ emotes: { 0: C }, heroAttack: 'attack_blast' })).toEqual({ heroAttack: 'attack_blast' });
    expect(parseCosmeticSnapshot({ emotes: { 0: C } })).toBeNull();
  });
});

describe('the inventory request: the emote slot', () => {
  it('is an equip slot, not a global one; its target is the position "0" to "3"', () => {
    expect(EQUIP_SLOTS).toContain('emote');
    expect(GLOBAL_EQUIP_SLOTS).not.toContain('emote');
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'emote', targetId: '2', cosmeticId: C }))
      .toEqual({ ok: true, request: { action: 'equip_cosmetic', slot: 'emote', targetId: '2', cosmeticId: C } });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'emote', targetId: '0', cosmeticId: null })).toMatchObject({ ok: true });
    for (const targetId of ['', '4', '-1', 'albus', '01']) {
      expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'emote', targetId, cosmeticId: C }), targetId).toEqual({ ok: false, status: 400, error: 'bad_target' });
    }
  });
});
