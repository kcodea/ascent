import { afterEach, describe, expect, it } from 'vitest';
import {
  COSMETICS, COSMETIC_CATEGORY_DEFS, EMOTE_SLOT_COUNT, EQUIP_SLOTS, GLOBAL_EQUIP_SLOTS, STARTER_EMOTE_IDS, catalogSyncPayload, eligibleCrateCosmetics,
  emoteLoadoutOf, emoteOf, emotePositionOf, emoteSlotsOf, isStarterCosmetic, loadoutFromRows, parseCosmeticSnapshot, setServerCatalogState, snapshotForRun,
  withEmoteAt, withStarterCosmetics,
} from './cosmetics';
import { validateInventoryBody } from './inventory';

/**
 * EMOTES (owner spec 2026-10-13): "Emotes are a new COSMETIC type in Collections ... Players equip up to 4 in
 * Collections." Reworked 2026-10-15: "remove all emotes as 'given' and put them in various loot tiers between rare and
 * legendary. wire all the new ones that i added", and "remove the angry mushy emote".
 */
/** Angry Mushy was a starter until the owner retired it on 2026-10-15. */
const RETIRED = 'emote_angry_mushy';
/** Three crate emotes in catalog order (two Rares, then an Epic). */
const [A, B, C] = ['emote_nervous_jensen', 'emote_zen_brian', 'emote_flirty_midas'];
const ABC = [A, B, C];

afterEach(() => setServerCatalogState(null));

describe('the emote catalog', () => {
  it('a live, account-wide category of thirteen CRATE emotes, 6 Rare / 4 Epic / 3 Legendary (EmoteTemplate is not one)', () => {
    expect(COSMETIC_CATEGORY_DEFS.emote).toEqual({ id: 'emote', label: 'Emotes', weight: 10, enabled: true, target: 'global' });
    const live = COSMETICS.filter((c) => c.category === 'emote' && c.active);
    expect(live.map((c) => [c.id, c.name, c.rarity, c.assets.master])).toEqual([
      [A, 'Nervous Jensen', 'rare', 'NervousJensen.png'],
      [B, 'Zen Brian', 'rare', 'ZenBrian.png'],
      ['emote_depressed_hank', 'Depressed Hank', 'rare', 'DepressedHank.png'],
      ['emote_nervous_voss', 'Nervous Voss', 'rare', 'NervousVoss.png'],
      ['emote_sad_wrangler', 'Sad Wrangler', 'rare', 'SadWrangler.png'],
      ['emote_tara_sad', 'Tara Sad', 'rare', 'TaraSad.png'],
      [C, 'Flirty Midas', 'epic', 'FlirtyMidas.png'],
      ['emote_happy_urchin', 'Happy Urchin', 'epic', 'HappyUrchin.png'],
      ['emote_sly_oona', 'Sly Oona', 'epic', 'SlyOona.png'],
      ['emote_dead_elder', 'Dead Elder', 'epic', 'DeadElder.png'],
      ['emote_rich_pimm', 'Rich Pimm', 'legendary', 'RichPimm.png'],
      ['emote_baby_rubies', 'Baby Rubies', 'legendary', 'BabyRubies.png'],
      ['emote_mad_tormentor', 'Mad Tormentor', 'legendary', 'MadTormentor.png'],
    ]);
    expect(live.every((c) => c.acquisition.type === 'crate' && c.assets.art === c.id)).toBe(true);
    expect(COSMETICS.filter((c) => c.category === 'emote').some((c) => /template/i.test(c.id) || /template/i.test(String(c.assets.master)))).toBe(false);
    expect(STARTER_EMOTE_IDS).toEqual([]); // nothing is given away any more
    expect(isStarterCosmetic('title_wanderer')).toBe(false);
  });

  it('Angry Mushy is RETIRED (owner 2026-10-15), not deleted: the id is still known but never live, owned or shown', () => {
    const def = COSMETICS.find((c) => c.id === RETIRED)!;
    expect([def.name, def.active]).toEqual(['Angry Mushy', false]);
    expect(isStarterCosmetic(RETIRED)).toBe(true); // still known, so an old row or recording resolves to "retired", not "unknown"
    expect(emoteOf(RETIRED)).toBeNull();
    expect(withStarterCosmetics(null)).not.toContain(RETIRED);
    expect(eligibleCrateCosmetics([]).map((c) => c.id)).not.toContain(RETIRED);
    expect(emoteLoadoutOf({ emotes: { 0: RETIRED } }, [RETIRED, ...ABC])).toEqual(ABC);
    expect(emoteLoadoutOf({ emotes: { 0: RETIRED } })).toEqual([]);
    expect(emotePositionOf({ emotes: { 0: RETIRED } }, RETIRED)).toBe(-1);
    // The sync still sends it, marked inactive, so the server's copy retires it too.
    expect(catalogSyncPayload().items.find((i) => i.cosmeticId === RETIRED)).toMatchObject({ acquisitionSource: 'starter', active: false });
  });

  it('every live emote drops from a crate, and only until it is owned', () => {
    const pool = eligibleCrateCosmetics([]).filter((c) => c.category === 'emote').map((c) => c.id);
    expect(pool).toHaveLength(13);
    expect(pool).toEqual(expect.arrayContaining(ABC));
    expect(eligibleCrateCosmetics([A]).map((c) => c.id)).not.toContain(A);
  });

  it('nobody owns an emote by default (no starters left)', () => {
    expect(withStarterCosmetics(null)).toEqual([]);
    expect(withStarterCosmetics(['title_wanderer', B])).toEqual(['title_wanderer', B]);
  });

  it('the catalog sync sends every live emote as a targetless crate item (acquisition source "crate")', () => {
    const items = catalogSyncPayload().items.filter((i) => i.category === 'emote' && i.active);
    expect(items).toHaveLength(13);
    expect(items.every((i) => i.acquisitionSource === 'crate' && i.targetType === null && i.targetId === null)).toBe(true);
  });
});

describe('the four-position menu (loadout default / equip)', () => {
  it('owning nothing = an empty menu, with or without rows', () => {
    expect(EMOTE_SLOT_COUNT).toBe(4);
    expect(emoteLoadoutOf(null)).toEqual([]);
    expect(emoteLoadoutOf({}, [])).toEqual([]);
    expect(emoteSlotsOf(null, [])).toEqual([null, null, null, null]);
    expect(emoteLoadoutOf({ emotes: { 0: A } }, [])).toEqual([]); // a row for an emote not owned never shows
  });

  it('owned emotes fill the menu in catalog order without being placed, four at most', () => {
    expect(emoteLoadoutOf(null, [C, A, B])).toEqual(ABC);
    expect(emoteSlotsOf(null, [C, A, B])).toEqual([A, B, C, null]);
    const all = COSMETICS.filter((c) => c.category === 'emote').map((c) => c.id);
    expect(emoteLoadoutOf(null, all)).toEqual([A, B, 'emote_depressed_hank', 'emote_nervous_voss']);
  });

  it('an explicit position wins; putting an emote elsewhere SWAPS it with the one that was there', () => {
    expect(emoteLoadoutOf({ emotes: { 0: C } }, ABC)).toEqual([C, B, A]);
    expect(emoteSlotsOf({ emotes: { 3: A } }, ABC)).toEqual([B, C, null, A]);
    expect(emotePositionOf({ emotes: { 3: A } }, A, ABC)).toBe(3); // the real position, not the index among shown emotes
    expect(emotePositionOf({ emotes: { 0: C } }, 'emote_unknown', ABC)).toBe(-1);
    expect(emoteLoadoutOf({ emotes: { 0: C } })).toEqual([C]); // ownership unknown: the rows are trusted
  });

  it('a duplicate keeps its lowest position; an unknown, retired or unowned emote is dropped and its position refilled', () => {
    expect(emoteLoadoutOf({ emotes: { 1: C, 2: C } }, ABC)).toEqual([A, C, B]);
    expect(emoteLoadoutOf({ emotes: { 0: 'emote_from_a_newer_client' } }, ABC)).toEqual(ABC);
    expect(emoteLoadoutOf({ emotes: { 0: C } }, [A])).toEqual([A]);
    setServerCatalogState({ retiredIds: [B], disabledCategories: [] });
    expect(emoteLoadoutOf(null, ABC)).toEqual([A, C]);
    setServerCatalogState({ retiredIds: [], disabledCategories: ['emote'] });
    expect(emoteLoadoutOf(null, ABC)).toEqual([]);
    expect(emoteOf(A)).toBeNull();
  });

  it('withEmoteAt moves an emote like the SQL (it leaves its other position); null clears a position', () => {
    const one = withEmoteAt(null, 0, C);
    expect(one.emotes).toEqual({ 0: C });
    const moved = withEmoteAt(one, 2, C);
    expect(moved.emotes).toEqual({ 2: C });
    expect(emoteLoadoutOf(moved, ABC)).toEqual([A, B, C]);
    expect(withEmoteAt(moved, 2, null).emotes).toBeUndefined();
    // other loadout fields ride through untouched
    expect(withEmoteAt({ heroAttack: 'attack_blast' }, 1, C)).toEqual({ heroAttack: 'attack_blast', emotes: { 1: C } });
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
