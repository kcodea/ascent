import { afterEach, describe, expect, it } from 'vitest';
import {
  COMMS_EMOTE_IDS, COSMETICS, COSMETIC_CATEGORY_DEFS, EMOTE_POSITION_RE, EMOTE_SLOT_COUNT, EQUIP_SLOTS, GLOBAL_EQUIP_SLOTS, STARTER_EMOTE_IDS, catalogSyncPayload, eligibleCrateCosmetics,
  emoteLoadoutOf, emoteOf, emotePositionOf, emoteSlotsOf, isStarterCosmetic, loadoutFromRows, parseCosmeticSnapshot, setServerCatalogState, snapshotForRun,
  isCommsEmote, withEmoteAt, withStarterCosmetics,
} from './cosmetics';
import { validateInventoryBody } from './inventory';

/**
 * EMOTES (owner spec 2026-10-13): "Emotes are a new COSMETIC type in Collections ... Players equip up to 4 in
 * Collections." Reworked 2026-10-15: "remove all emotes as 'given' and put them in various loot tiers between rare and
 * legendary. wire all the new ones that i added", "remove the angry mushy emote", then "all emotes are crate only except
 * give all players the zen brian emote and show the empty emote slots", then "remove the sad wrangler". 2026-10-18: "add
 * the emote cosmetics i added" (nine more, crate only). 2026-10-22: "we'll use emotes for quickchat options, then. let's
 * add 4 more emote slots, and give everyone the communication emotes", then "give all players the 5 comms emotes for
 * free, but others im going to continue to add will go into the skins lootboxes" (eight positions, five free Comms).
 */
/** Angry Mushy was a starter until the owner retired it on 2026-10-15. */
const RETIRED = 'emote_angry_mushy';
/** Sad Wrangler was a Rare CRATE emote until the owner retired it on 2026-10-15 ("remove the sad wrangler"). */
const RETIRED_CRATE = 'emote_sad_wrangler';
/** THE starter: every player owns it and has it in the menu. */
const Z = 'emote_zen_brian';
/** Three crate emotes in catalog order (two Rares, then an Epic). */
const [A, B, C] = ['emote_nervous_jensen', 'emote_depressed_hank', 'emote_flirty_midas'];
const ABC = [A, B, C];
/** The five free Comms emotes (2026-10-22), in catalog / menu order. */
const [H, G, T, I, L] = ['emote_hi', 'emote_good_choice', 'emote_too_nasty', 'emote_its_beasts', 'emote_lemon_approved'];
const K = [H, G, T, I, L];

afterEach(() => setServerCatalogState(null));

describe('the emote catalog', () => {
  it('Zen Brian and the five Comms emotes are the STARTERS; twenty CRATE emotes, 8 Rare / 7 Epic / 5 Legendary (EmoteTemplate is not one)', () => {
    expect(COSMETIC_CATEGORY_DEFS.emote).toEqual({ id: 'emote', label: 'Emotes', weight: 10, enabled: true, target: 'global' });
    const live = COSMETICS.filter((c) => c.category === 'emote' && c.active);
    expect(live.map((c) => [c.id, c.name, c.rarity, c.acquisition.type, c.assets.master])).toEqual([
      [Z, 'Zen Brian', 'common', 'starter', 'ZenBrian.png'],
      [H, 'Hi', 'common', 'starter', 'Comms/Hi.png'],
      [G, 'Good Choice', 'common', 'starter', 'Comms/Good Choice.png'],
      [T, 'Too Nasty', 'common', 'starter', 'Comms/TooNasty.png'],
      [I, "It's Beasts", 'common', 'starter', "Comms/it's beasts.png"],
      [L, 'Lemon Approved', 'common', 'starter', 'Comms/lemon approved.png'],
      [A, 'Nervous Jensen', 'rare', 'crate', 'NervousJensen.png'],
      [B, 'Depressed Hank', 'rare', 'crate', 'DepressedHank.png'],
      ['emote_nervous_voss', 'Nervous Voss', 'rare', 'crate', 'NervousVoss.png'],
      ['emote_tara_sad', 'Tara Sad', 'rare', 'crate', 'TaraSad.png'],
      ['emote_chronos_mad', 'Chronos Mad', 'rare', 'crate', 'ChronosMad.png'],
      ['emote_rascal_broke', 'Rascal Broke', 'rare', 'crate', 'RascalBroke.png'],
      ['emote_skeleton_wave', 'Skeleton Wave', 'rare', 'crate', 'SkeletonWave.png'],
      ['emote_pup_pup', 'Pup Pup', 'rare', 'crate', 'PupPup.png'],
      [C, 'Flirty Midas', 'epic', 'crate', 'FlirtyMidas.png'],
      ['emote_happy_urchin', 'Happy Urchin', 'epic', 'crate', 'HappyUrchin.png'],
      ['emote_sly_oona', 'Sly Oona', 'epic', 'crate', 'SlyOona.png'],
      ['emote_dead_elder', 'Dead Elder', 'epic', 'crate', 'DeadElder.png'],
      ['emote_gambler', 'Gambler', 'epic', 'crate', 'GamblerEmote.png'],
      ['emote_sexy_darah', 'Sexy Darah', 'epic', 'crate', 'SexyDarahEmote.png'],
      ['emote_angry_deathswarmer', 'Angry Deathswarmer', 'epic', 'crate', 'AngryDeathswarmer.png'],
      ['emote_rich_pimm', 'Rich Pimm', 'legendary', 'crate', 'RichPimm.png'],
      ['emote_baby_rubies', 'Baby Rubies', 'legendary', 'crate', 'BabyRubies.png'],
      ['emote_mad_tormentor', 'Mad Tormentor', 'legendary', 'crate', 'MadTormentor.png'],
      ['emote_dan_the_man', 'Dan the Man', 'legendary', 'crate', 'DanTheManEmote.png'],
      ['emote_iggy', 'Iggy', 'legendary', 'crate', 'Iggy.png'],
    ]);
    expect(live.every((c) => c.assets.art === c.id)).toBe(true);
    expect(COSMETICS.filter((c) => c.category === 'emote').some((c) => /template/i.test(c.id) || /template/i.test(String(c.assets.master)))).toBe(false);
    expect(STARTER_EMOTE_IDS).toEqual([Z, ...K]);
    expect(COMMS_EMOTE_IDS).toEqual(K);
    expect(K.every((id) => isStarterCosmetic(id) && isCommsEmote(id))).toBe(true);
    expect(isCommsEmote(Z)).toBe(false);
    expect(isStarterCosmetic(Z)).toBe(true);
    expect(isStarterCosmetic(A)).toBe(false);
    expect(isStarterCosmetic('title_wanderer')).toBe(false);
  });

  it('Angry Mushy is RETIRED (owner 2026-10-15), not deleted: the id is still known but never live, owned or shown', () => {
    const def = COSMETICS.find((c) => c.id === RETIRED)!;
    expect([def.name, def.active]).toEqual(['Angry Mushy', false]);
    expect(isStarterCosmetic(RETIRED)).toBe(true); // still known, so an old row or recording resolves to "retired", not "unknown"
    expect(emoteOf(RETIRED)).toBeNull();
    expect(withStarterCosmetics(null)).not.toContain(RETIRED);
    expect(eligibleCrateCosmetics([]).map((c) => c.id)).not.toContain(RETIRED);
    expect(emoteSlotsOf({ emotes: { 0: RETIRED } }, [RETIRED, ...ABC])).toEqual([Z, A, B, C, H, G, T, I]);
    expect(emoteSlotsOf({ emotes: { 0: RETIRED } })).toEqual([Z, ...K, null, null]);
    expect(emotePositionOf({ emotes: { 0: RETIRED } }, RETIRED)).toBe(-1);
    // The sync still sends it, marked inactive, so the server's copy retires it too.
    expect(catalogSyncPayload().items.find((i) => i.cosmeticId === RETIRED)).toMatchObject({ acquisitionSource: 'starter', active: false });
  });

  it('Sad Wrangler is RETIRED (owner 2026-10-15: "remove the sad wrangler"), not deleted; a player who OWNS it keeps it but never sees or plays it', () => {
    const def = COSMETICS.find((c) => c.id === RETIRED_CRATE)!;
    expect([def.name, def.rarity, def.acquisition.type, def.active]).toEqual(['Sad Wrangler', 'rare', 'crate', false]);
    expect(emoteOf(RETIRED_CRATE)).toBeNull(); // so sayEmote / a recorded board naming it plays nothing
    expect(eligibleCrateCosmetics([]).map((c) => c.id)).not.toContain(RETIRED_CRATE);
    // Owned (its ownership row stays) and even placed in a slot: the menu skips it and refills the position.
    expect(emoteSlotsOf({ emotes: { 0: RETIRED_CRATE } }, [RETIRED_CRATE, A])).toEqual([Z, A, ...K, null]);
    expect(emoteLoadoutOf(null, [RETIRED_CRATE, ...ABC])).toEqual([Z, A, B, C, H, G, T, I]);
    expect(emotePositionOf({ emotes: { 1: RETIRED_CRATE } }, RETIRED_CRATE, [RETIRED_CRATE])).toBe(-1);
    // The sync still sends it, marked inactive, so the server's copy retires it too.
    expect(catalogSyncPayload().items.find((i) => i.cosmeticId === RETIRED_CRATE)).toMatchObject({ acquisitionSource: 'crate', active: false });
  });

  it('every live emote but the free ones (Zen Brian + the five Comms) drops from a crate, and only until it is owned', () => {
    const pool = eligibleCrateCosmetics([]).filter((c) => c.category === 'emote').map((c) => c.id);
    expect(pool).toHaveLength(20);
    expect(pool).toEqual(expect.arrayContaining(ABC));
    expect(pool).not.toContain(Z);
    // Owner 2026-10-22: "give all players the 5 comms emotes for free": no one ever ROLLS a free emote.
    for (const id of K) expect(pool, id).not.toContain(id);
    expect(eligibleCrateCosmetics([A]).map((c) => c.id)).not.toContain(A);
  });

  it('free is a PER-EMOTE flag, never a blanket rule: exactly Zen Brian and the five Comms are starters, every other live emote is a crate drop', () => {
    // Owner 2026-10-22: "others im going to continue to add will go into the skins lootboxes". The free set is named row
    // by row; a new emote row with no flag gets the `emote` helper's default, a crate drop (pinned by this list: adding a
    // free emote means adding it here on purpose).
    const live = COSMETICS.filter((c) => c.category === 'emote' && c.active);
    expect(live.filter((c) => c.acquisition.type === 'starter').map((c) => c.id)).toEqual([Z, ...K]);
    expect(live.filter((c) => c.acquisition.type !== 'starter').every((c) => c.acquisition.type === 'crate')).toBe(true);
  });

  it('everyone owns Zen Brian and the five Comms emotes, a guest included; nothing is duplicated', () => {
    expect(withStarterCosmetics(null)).toEqual([Z, ...K]);
    expect(withStarterCosmetics(['title_wanderer', Z, B])).toEqual(['title_wanderer', Z, B, ...K]);
  });

  it('the catalog sync sends Zen Brian and the Comms emotes as starters and every other live emote as a targetless crate item', () => {
    const items = catalogSyncPayload().items.filter((i) => i.category === 'emote' && i.active);
    expect(items).toHaveLength(26);
    for (const id of [Z, ...K]) expect(items.find((i) => i.cosmeticId === id), id).toMatchObject({ acquisitionSource: 'starter', targetType: null, targetId: null });
    expect(items.filter((i) => i.cosmeticId !== Z && !K.includes(i.cosmeticId)).every((i) => i.acquisitionSource === 'crate' && i.targetType === null && i.targetId === null)).toBe(true);
  });
});

describe('the eight-position menu (loadout default / equip)', () => {
  it('a fresh account (owning nothing, or no profile at all) has Zen Brian, the five Comms emotes and two EMPTY slots', () => {
    expect(EMOTE_SLOT_COUNT).toBe(8);
    expect(emoteSlotsOf(null)).toEqual([Z, ...K, null, null]);
    expect(emoteSlotsOf({}, [])).toEqual([Z, ...K, null, null]);
    expect(emoteLoadoutOf(null, [])).toEqual([Z, ...K]);
    expect(emoteLoadoutOf({ emotes: { 1: A } }, [])).toEqual([Z, ...K]); // a row for an emote not owned never shows
  });

  it('owned emotes fill the menu without being placed, eight at most; slots 1-4 stay what the four-slot menu showed, the Comms come next', () => {
    expect(emoteSlotsOf(null, [C, A])).toEqual([Z, A, C, ...K]);
    expect(emoteSlotsOf(null, [C, A, B])).toEqual([Z, A, B, C, H, G, T, I]);
    const all = COSMETICS.filter((c) => c.category === 'emote').map((c) => c.id);
    expect(emoteLoadoutOf(null, all)).toEqual([Z, A, B, 'emote_nervous_voss', H, G, T, I]);
  });

  it('an explicit position wins; putting an emote elsewhere SWAPS it with the one that was there', () => {
    expect(emoteLoadoutOf({ emotes: { 0: C } }, ABC)).toEqual([C, A, B, Z, H, G, T, I]);
    expect(emoteSlotsOf({ emotes: { 3: Z } }, [A])).toEqual([G, A, H, Z, T, I, L, null]);
    expect(emoteSlotsOf({ emotes: { 7: C } }, ABC)).toEqual([Z, A, B, I, H, G, T, C]); // a new position takes an explicit emote (It's Beasts swaps to its old place)
    expect(emotePositionOf({ emotes: { 3: Z } }, Z, [A])).toBe(3); // the real position, not the index among shown emotes
    expect(emotePositionOf({ emotes: { 0: C } }, 'emote_unknown', ABC)).toBe(-1);
    expect(emoteLoadoutOf({ emotes: { 1: C } })).toEqual([Z, C, G, T, I, L, H]); // ownership unknown: the rows are trusted
  });

  it('a duplicate keeps its lowest position; an unknown, retired or unowned emote is dropped and its position refilled', () => {
    expect(emoteLoadoutOf({ emotes: { 1: C, 2: C } }, ABC)).toEqual([Z, C, B, A, H, G, T, I]);
    expect(emoteLoadoutOf({ emotes: { 0: 'emote_from_a_newer_client' } }, ABC)).toEqual([Z, A, B, C, H, G, T, I]);
    expect(emoteSlotsOf({ emotes: { 1: C } }, [A])).toEqual([Z, A, ...K, null]);
    setServerCatalogState({ retiredIds: [B], disabledCategories: [] });
    expect(emoteLoadoutOf(null, ABC)).toEqual([Z, A, C, ...K]);
    setServerCatalogState({ retiredIds: [], disabledCategories: ['emote'] });
    expect(emoteLoadoutOf(null, ABC)).toEqual([]);
    expect(emoteOf(A)).toBeNull();
  });

  it('withEmoteAt moves an emote like the SQL (it leaves its other position); null clears a position', () => {
    const one = withEmoteAt(null, 0, C);
    expect(one.emotes).toEqual({ 0: C });
    const moved = withEmoteAt(one, 2, C);
    expect(moved.emotes).toEqual({ 2: C });
    expect(emoteLoadoutOf(moved, ABC)).toEqual([Z, A, C, B, H, G, T, I]);
    expect(withEmoteAt(moved, 2, null).emotes).toBeUndefined();
    // other loadout fields ride through untouched
    expect(withEmoteAt({ heroAttack: 'attack_blast' }, 1, C)).toEqual({ heroAttack: 'attack_blast', emotes: { 1: C } });
  });

  it('loadout rows: the emote slot keys by position 0 to 7; anything else is dropped', () => {
    expect(loadoutFromRows([
      { slot: 'emote', targetId: '0', cosmeticId: C }, { slot: 'emote', target_id: '7', cosmetic_id: A },
      { slot: 'emote', targetId: '8', cosmeticId: B }, { slot: 'emote', targetId: '', cosmeticId: B },
    ])).toEqual({ emotes: { 0: C, 7: A } });
  });

  it('the menu is LIVE LOADOUT ONLY: never recorded on a run snapshot (a run records the emotes USED, per board)', () => {
    expect(snapshotForRun({ emotes: { 0: C }, heroAttack: 'attack_blast' })).toEqual({ heroAttack: 'attack_blast' });
    expect(parseCosmeticSnapshot({ emotes: { 0: C } })).toBeNull();
  });
});

describe('the inventory request: the emote slot', () => {
  it('is an equip slot, not a global one; its target is the position "0" to "7"', () => {
    expect(EQUIP_SLOTS).toContain('emote');
    expect(GLOBAL_EQUIP_SLOTS).not.toContain('emote');
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'emote', targetId: '2', cosmeticId: C }))
      .toEqual({ ok: true, request: { action: 'equip_cosmetic', slot: 'emote', targetId: '2', cosmeticId: C } });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'emote', targetId: '0', cosmeticId: null })).toMatchObject({ ok: true });
    for (const targetId of ['4', '7']) expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'emote', targetId, cosmeticId: H }), targetId).toMatchObject({ ok: true });
    expect(EMOTE_POSITION_RE.source).toBe('^[0-7]$');
    for (const targetId of ['', '8', '-1', 'albus', '01', '07']) {
      expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'emote', targetId, cosmeticId: C }), targetId).toEqual({ ok: false, status: 400, error: 'bad_target' });
    }
  });
});
