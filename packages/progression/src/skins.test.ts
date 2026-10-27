import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COSMETICS, COSMETIC_CATEGORY_DEFS, catalogHash, catalogStateEpoch, catalogSyncPayload, cosmeticOf, heroSkinOf, isCosmeticLive, liveCosmetics, loadoutFromRows, minionSkinOf,
  parseCosmeticSnapshot, parseServerCatalogState, setServerCatalogState, skinsForTarget, snapshotForRun, type CosmeticDef,
} from './cosmetics';
import { parseProgressionProfile } from './rules';
import { CATALOG_SYNC_RETRY_MS, handleInventory, resetCatalogSyncForTests, syncCatalogOnce, validateInventoryBody } from './inventory';
import type { RpcCall } from './server';

/**
 * THE FIRST SKINS (owner 2026-09-28) at the catalog layer: the four items, the one resolver every renderer uses
 * (`heroSkinOf` / `minionSkinOf`), the recorded per-run snapshot, the kill switch (TS and server copies), and the
 * `equip_cosmetic` inventory action. The SQL side is proven in skins.db.test.ts; rendering in @game/ui.
 */

afterEach(() => setServerCatalogState(null));

const skins = COSMETICS.filter((c) => c.category === 'hero_skin' || c.category === 'minion_skin');

describe('the one hundred and thirty skins', () => {
  // 2026-09-28: a third Black Belt Brian (Legendary) joined; owner: "i added a legendary black belt brian skin and
  // renaemd skins to match their rarity" (masters renamed SkinRare / SkinEpic / SkinLegendary; ids unchanged); then
  // "put the bellringer voss skin in too" (an Epic for Bellringer Voss). Then skins batch 2: "i added some skins here:
  // can you wire those up now?" (13 minion skins; rarity from the owner's filenames). Then skins batch 3 (2026-09-29):
  // "added a few more hero and minion skins - i want to name them appropriately and then decide rarities" (4 minion
  // skins + the first Frantic Frank hero skin; rarities are the owner's). Then skins batch 4 (2026-09-30): "can you
  // wire all the new skins that i added to the folder" (16 minion + 16 hero skins; rarity from the filename suffix, the
  // ten with none took the owner's random draw between Common and Epic; Black Friday Frank's master is a JPEG). Then skins batch 5 (2026-09-30): "i added more skins"
  // (11 minion skins + Influencer Indy; rarities are the owner's random draw between Common and Epic).
  // Then skins batch 6 (2026-10-01): "i added a bunch of art/portrait arts etc, can you make sure all get added" (9
  // minion skins; rarity is the art folder each master sits in, R-PROG-SKINS-11). Then skins batch 7 (2026-10-01, same
  // ask): three hero skins, Goth Merrin, Iron Guardian (the Guardian hero, runeguard) and Robin Hood; rarity = folder.
  // Then skins batch 8 (2026-10-03): "ive also added many skins to the game's collections. can you add those all in"
  // (11 hero skins at their folder rarity; Leg Day Darah and Dance Night Hunch moved to Ancient with their masters).
  // Then skins batch 9 (2026-10-07): "yes add the new art to the catalog" (2 Rare minion skins for Chorus Drake,
  // Canyon Drake and Thunderchorus Drake; matched to d2_chorus by the art).
  // Then skins batch 10 (2026-10-21): "i added various skins/collections items. can you find them and wire them up?"
  // (7 hero + 7 minion skins at their folder rarity: four Midas, Runesmith, Robin, Membrance; Anvilshade, Bellringer
  // Voss, Rad Rachel, two Mushy, Kennelmaster, Jensen & Fi).
  // Then skins batch 11 (2026-10-26): "i just added a ton of new images to the art folder ... IMPORT them into
  // collections" (22 minion skins at their folder rarity, nearly all Set 2 Beasts: the Plushie line, Frostclaw,
  // Stoneclaw, Pinata Claw, Stormhorn, Snowyhorn, Solar Spots, Voidworks, Cyborg Roomworks).
  it('four Black Belt Brian minion skins (Rare, Epic, Legendary, Common), Bellringer Voss, batches 2 to 11, and the hero skins; crate items with art keys and attributed masters', () => {
    expect(skins.map((c) => [c.id, c.category, c.target, c.rarity])).toEqual([
      ['skin_blackbelt_1', 'minion_skin', { type: 'card', id: 'blackbelt' }, 'common'],
      ['skin_blackbelt_2', 'minion_skin', { type: 'card', id: 'blackbelt' }, 'epic'],
      ['skin_blackbelt_3', 'minion_skin', { type: 'card', id: 'blackbelt' }, 'legendary'],
      ['skin_bellringer_1', 'minion_skin', { type: 'card', id: 'n2_bellringer' }, 'epic'],
      ['skin_blackbelt_4', 'minion_skin', { type: 'card', id: 'blackbelt' }, 'rare'],
      ['skin_drummer_1', 'minion_skin', { type: 'card', id: 'drummer' }, 'epic'],
      ['skin_drummer_2', 'minion_skin', { type: 'card', id: 'drummer' }, 'rare'],
      ['skin_drummer_3', 'minion_skin', { type: 'card', id: 'drummer' }, 'legendary'],
      ['skin_jenkins_1', 'minion_skin', { type: 'card', id: 'jenkins' }, 'common'],
      ['skin_joker_1', 'minion_skin', { type: 'card', id: 'joker' }, 'rare'],
      ['skin_nimbus_1', 'minion_skin', { type: 'card', id: 'nimbus' }, 'rare'],
      ['skin_paragon_1', 'minion_skin', { type: 'card', id: 'n2_paragon' }, 'rare'],
      ['skin_stewardofspells_1', 'minion_skin', { type: 'card', id: 'stewardofspells' }, 'common'],
      ['skin_sylus_1', 'minion_skin', { type: 'card', id: 'sylus' }, 'epic'],
      ['skin_sylus_2', 'minion_skin', { type: 'card', id: 'sylus' }, 'ancient'], // moved Legendary -> Ancient (owner 2026-10-02)
      ['skin_venom_1', 'minion_skin', { type: 'card', id: 'venom' }, 'legendary'],
      ['skin_zyff_1', 'minion_skin', { type: 'card', id: 'zyff' }, 'common'],
      ['skin_oona_1', 'minion_skin', { type: 'card', id: 'b2_oona' }, 'epic'],
      ['skin_sylus_3', 'minion_skin', { type: 'card', id: 'sylus' }, 'rare'],
      ['skin_seaurchin_1', 'minion_skin', { type: 'card', id: 'seaurchin' }, 'epic'],
      ['skin_buddy_1', 'minion_skin', { type: 'card', id: 'buddy' }, 'legendary'],
      ['skin_arnold_1', 'minion_skin', { type: 'card', id: 'dw_arnold' }, 'common'],
      ['skin_recaller_1', 'minion_skin', { type: 'card', id: 'd2_recaller' }, 'rare'],
      ['skin_recaller_2', 'minion_skin', { type: 'card', id: 'd2_recaller' }, 'epic'],
      ['skin_recaller_3', 'minion_skin', { type: 'card', id: 'd2_recaller' }, 'common'],
      ['skin_pimm_1', 'minion_skin', { type: 'card', id: 'dw_pimm' }, 'common'],
      ['skin_pimm_2', 'minion_skin', { type: 'card', id: 'dw_pimm' }, 'legendary'],
      ['skin_chimerus_1', 'minion_skin', { type: 'card', id: 'chimerus' }, 'rare'],
      ['skin_chronicler_1', 'minion_skin', { type: 'card', id: 'd2_chronicler' }, 'legendary'],
      ['skin_chronicler_2', 'minion_skin', { type: 'card', id: 'd2_chronicler' }, 'common'],
      ['skin_edward_1', 'minion_skin', { type: 'card', id: 'dw_edward' }, 'ancient'], // moved Legendary -> Ancient (owner 2026-10-02)
      ['skin_baal_1', 'minion_skin', { type: 'card', id: 'dw_baal' }, 'rare'],
      ['skin_pouchpincher_1', 'minion_skin', { type: 'card', id: 'k_pouchpincher' }, 'common'],
      ['skin_buddy_2', 'minion_skin', { type: 'card', id: 'buddy' }, 'legendary'],
      ['skin_buddy_3', 'minion_skin', { type: 'card', id: 'buddy' }, 'epic'],
      ['skin_drummer_4', 'minion_skin', { type: 'card', id: 'drummer' }, 'epic'],
      ['skin_orin_1', 'minion_skin', { type: 'card', id: 'dw_orin' }, 'epic'],
      ['skin_nimbus_2', 'minion_skin', { type: 'card', id: 'nimbus' }, 'legendary'],
      ['skin_nimbus_3', 'minion_skin', { type: 'card', id: 'nimbus' }, 'epic'],
      ['skin_nimbus_4', 'minion_skin', { type: 'card', id: 'nimbus' }, 'rare'],
      ['skin_spellsword_1', 'minion_skin', { type: 'card', id: 'n2_spellsword' }, 'rare'],
      ['skin_chronicler_3', 'minion_skin', { type: 'card', id: 'd2_chronicler' }, 'rare'],
      ['skin_joker_2', 'minion_skin', { type: 'card', id: 'joker' }, 'rare'],
      ['skin_butcher_1', 'minion_skin', { type: 'card', id: 'dm_butcher' }, 'epic'],
      ['skin_chorus_1', 'minion_skin', { type: 'card', id: 'd2_chorus' }, 'rare'],
      ['skin_wayfinder_1', 'minion_skin', { type: 'card', id: 'wayfinder' }, 'common'],
      ['skin_seaurchin_2', 'minion_skin', { type: 'card', id: 'seaurchin' }, 'rare'],
      ['skin_wardkeeper_1', 'minion_skin', { type: 'card', id: 'dw_wardkeeper' }, 'common'],
      ['skin_deepvein_1', 'minion_skin', { type: 'card', id: 'k_deepvein' }, 'common'],
      ['skin_deepvein_2', 'minion_skin', { type: 'card', id: 'k_deepvein' }, 'common'],
      ['skin_wardkeeper_2', 'minion_skin', { type: 'card', id: 'dw_wardkeeper' }, 'common'],
      ['skin_wayfinder_2', 'minion_skin', { type: 'card', id: 'wayfinder' }, 'common'],
      ['skin_wayfinder_3', 'minion_skin', { type: 'card', id: 'wayfinder' }, 'rare'],
      ['skin_spellsword_2', 'minion_skin', { type: 'card', id: 'n2_spellsword' }, 'rare'],
      ['skin_blazingkeeper_1', 'minion_skin', { type: 'card', id: 'd2_blazingkeeper' }, 'rare'],
      ['skin_blazingkeeper_2', 'minion_skin', { type: 'card', id: 'd2_blazingkeeper' }, 'epic'],
      ['skin_blazingkeeper_3', 'minion_skin', { type: 'card', id: 'd2_blazingkeeper' }, 'legendary'],
      ['skin_albus_1', 'hero_skin', { type: 'hero', id: 'albus' }, 'epic'],
      ['skin_warden_1', 'hero_skin', { type: 'hero', id: 'warden' }, 'epic'],
      ['skin_frank_1', 'hero_skin', { type: 'hero', id: 'frank' }, 'common'],
      ['skin_cia_1', 'hero_skin', { type: 'hero', id: 'cia' }, 'common'],
      ['skin_cia_2', 'hero_skin', { type: 'hero', id: 'cia' }, 'common'],
      ['skin_frank_2', 'hero_skin', { type: 'hero', id: 'frank' }, 'epic'],
      ['skin_frank_3', 'hero_skin', { type: 'hero', id: 'frank' }, 'common'],
      ['skin_bram_1', 'hero_skin', { type: 'hero', id: 'bram' }, 'rare'],
      ['skin_darah_1', 'hero_skin', { type: 'hero', id: 'darah' }, 'ancient'],
      ['skin_darah_2', 'hero_skin', { type: 'hero', id: 'darah' }, 'rare'],
      ['skin_emeraldwarden_1', 'hero_skin', { type: 'hero', id: 'emeraldwarden' }, 'epic'],
      ['skin_hunch_1', 'hero_skin', { type: 'hero', id: 'hunch' }, 'ancient'],
      ['skin_keshi_1', 'hero_skin', { type: 'hero', id: 'keshi' }, 'common'],
      ['skin_keshi_2', 'hero_skin', { type: 'hero', id: 'keshi' }, 'epic'],
      ['skin_soren_1', 'hero_skin', { type: 'hero', id: 'soren' }, 'epic'],
      ['skin_soren_2', 'hero_skin', { type: 'hero', id: 'soren' }, 'legendary'],
      ['skin_brackus_1', 'hero_skin', { type: 'hero', id: 'brackus' }, 'legendary'],
      ['skin_brackus_2', 'hero_skin', { type: 'hero', id: 'brackus' }, 'common'],
      ['skin_robin_1', 'hero_skin', { type: 'hero', id: 'robin' }, 'rare'],
      ['skin_indy_1', 'hero_skin', { type: 'hero', id: 'indy' }, 'epic'],
      ['skin_merrin_1', 'hero_skin', { type: 'hero', id: 'merrin' }, 'epic'],
      ['skin_runeguard_1', 'hero_skin', { type: 'hero', id: 'runeguard' }, 'epic'],
      ['skin_robin_2', 'hero_skin', { type: 'hero', id: 'robin' }, 'rare'],
      ['skin_hermithank_1', 'hero_skin', { type: 'hero', id: 'hermithank' }, 'rare'],
      ['skin_quillen_1', 'hero_skin', { type: 'hero', id: 'quillen' }, 'legendary'],
      ['skin_rayse_1', 'hero_skin', { type: 'hero', id: 'rayse' }, 'legendary'],
      ['skin_risen_1', 'hero_skin', { type: 'hero', id: 'risen' }, 'legendary'],
      ['skin_midas_1', 'hero_skin', { type: 'hero', id: 'midas' }, 'legendary'],
      ['skin_myra_1', 'hero_skin', { type: 'hero', id: 'myra' }, 'ancient'],
      ['skin_nadja_1', 'hero_skin', { type: 'hero', id: 'nadja' }, 'ancient'],
      ['skin_risen_2', 'hero_skin', { type: 'hero', id: 'risen' }, 'ancient'],
      ['skin_merrin_2', 'hero_skin', { type: 'hero', id: 'merrin' }, 'ancient'],
      ['skin_nadja_2', 'hero_skin', { type: 'hero', id: 'nadja' }, 'ancient'],
      ['skin_rayse_2', 'hero_skin', { type: 'hero', id: 'rayse' }, 'ancient'],
      ['skin_chorus_2', 'minion_skin', { type: 'card', id: 'd2_chorus' }, 'rare'],
      ['skin_chorus_3', 'minion_skin', { type: 'card', id: 'd2_chorus' }, 'rare'],
      ['skin_fatecarver_1', 'minion_skin', { type: 'card', id: 'n2_fatecarver' }, 'rare'], // 2026-10-10: Fatecarver's retired alt art, kept as a skin (owner)
      // skins batch 10 (2026-10-21)
      ['skin_midas_2', 'hero_skin', { type: 'hero', id: 'midas' }, 'rare'],
      ['skin_midas_3', 'hero_skin', { type: 'hero', id: 'midas' }, 'rare'],
      ['skin_midas_4', 'hero_skin', { type: 'hero', id: 'midas' }, 'epic'],
      ['skin_midas_5', 'hero_skin', { type: 'hero', id: 'midas' }, 'epic'],
      ['skin_runesmith_1', 'hero_skin', { type: 'hero', id: 'runesmith' }, 'epic'],
      ['skin_robin_3', 'hero_skin', { type: 'hero', id: 'robin' }, 'epic'],
      ['skin_membrance_1', 'hero_skin', { type: 'hero', id: 'membrance' }, 'epic'],
      ['skin_anvilshade_1', 'minion_skin', { type: 'card', id: 'dw_anvilshade' }, 'rare'],
      ['skin_bellringer_2', 'minion_skin', { type: 'card', id: 'n2_bellringer' }, 'rare'],
      ['skin_radrachel_1', 'minion_skin', { type: 'card', id: 'dm_radrachel' }, 'rare'],
      ['skin_scalefeather_1', 'minion_skin', { type: 'card', id: 'd2_scalefeather' }, 'rare'],
      ['skin_scalefeather_2', 'minion_skin', { type: 'card', id: 'd2_scalefeather' }, 'epic'],
      ['skin_kennel_1', 'minion_skin', { type: 'card', id: 'kennel' }, 'epic'],
      ['skin_jenkins_2', 'minion_skin', { type: 'card', id: 'jenkins' }, 'epic'],
      ['skin_hawkus_1', 'minion_skin', { type: 'card', id: 'b2_hawkus' }, 'common'],
      ['skin_oona_2', 'minion_skin', { type: 'card', id: 'b2_oona' }, 'common'],
      ['skin_manasaber_1', 'minion_skin', { type: 'card', id: 'manasaber' }, 'common'],
      ['skin_tort_1', 'minion_skin', { type: 'card', id: 'b2_tort' }, 'common'],
      ['skin_roomworks_1', 'minion_skin', { type: 'card', id: 'd2_roomworks' }, 'rare'],
      ['skin_roomworks_2', 'minion_skin', { type: 'card', id: 'd2_roomworks' }, 'rare'],
      ['skin_dawnclaw_1', 'minion_skin', { type: 'card', id: 'b2_dawnclaw' }, 'rare'],
      ['skin_dawnclaw_2', 'minion_skin', { type: 'card', id: 'b2_dawnclaw' }, 'rare'],
      ['skin_trex_1', 'minion_skin', { type: 'card', id: 'b2_trex' }, 'rare'],
      ['skin_florida_1', 'minion_skin', { type: 'card', id: 'b2_florida' }, 'rare'],
      ['skin_mammoth_1', 'minion_skin', { type: 'card', id: 'b2_mammoth' }, 'rare'],
      ['skin_spots_1', 'minion_skin', { type: 'card', id: 'b2_spots' }, 'rare'],
      ['skin_echohorn_1', 'minion_skin', { type: 'card', id: 'b2_echohorn' }, 'rare'],
      ['skin_dawnclaw_3', 'minion_skin', { type: 'card', id: 'b2_dawnclaw' }, 'epic'],
      ['skin_dawnclaw_4', 'minion_skin', { type: 'card', id: 'b2_dawnclaw' }, 'epic'],
      ['skin_echohorn_2', 'minion_skin', { type: 'card', id: 'b2_echohorn' }, 'epic'],
      ['skin_echohorn_3', 'minion_skin', { type: 'card', id: 'b2_echohorn' }, 'epic'],
      ['skin_solaris_1', 'minion_skin', { type: 'card', id: 'b2_solaris' }, 'epic'],
      ['skin_beetle_1', 'minion_skin', { type: 'card', id: 'beetle' }, 'legendary'],
      ['skin_elderhorn_1', 'minion_skin', { type: 'card', id: 'b2_elderhorn' }, 'legendary'],
      ['skin_grim_1', 'minion_skin', { type: 'card', id: 'grim' }, 'legendary'],
      ['skin_spots_2', 'minion_skin', { type: 'card', id: 'b2_spots' }, 'legendary'],
    ]);
    for (const c of skins) {
      expect(c.acquisition).toEqual({ type: 'crate' });
      expect(c.assets.art, c.id).toBe(c.id);
      expect(c.assets.master, c.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9 -]*\.(png|jpg)$/); // batch 11: 'Plushie T-Rex.png' has a hyphen. // JPEG masters: BlackFridayFrank.jpg (batch 4), DarkNimbus.jpg and QuartetChorusdrake.jpg (batch 5); one master has spaces, 'Midas and Melon.png' (batch 8; art:wire ignores them)
      expect(c.active).toBe(true);
    }
    expect(skinsForTarget('minion_skin', 'blackbelt').map((c) => c.id)).toEqual(['skin_blackbelt_1', 'skin_blackbelt_2', 'skin_blackbelt_3', 'skin_blackbelt_4']);
    expect(skins.map((c) => c.assets.master).filter((m) => m!.startsWith('BlackBeltBrian'))).toEqual([
      'BlackBeltBrianSkinRare.png', 'BlackBeltBrianSkinEpic.png', 'BlackBeltBrianSkinLegendary.png', 'BlackBeltBrianCommonSkin.png',
    ]);
    expect(skinsForTarget('minion_skin', 'n2_bellringer').map((c) => c.id)).toEqual(['skin_bellringer_1', 'skin_bellringer_2']); // batch 10
    expect(skinsForTarget('hero_skin', 'midas').map((c) => c.id)).toEqual(['skin_midas_1', 'skin_midas_2', 'skin_midas_3', 'skin_midas_4', 'skin_midas_5']); // batch 10
    expect(skinsForTarget('minion_skin', 'd2_scalefeather').map((c) => c.id)).toEqual(['skin_scalefeather_1', 'skin_scalefeather_2']); // batch 10 (Mushy)
    expect(skinsForTarget('minion_skin', 'jenkins').map((c) => c.id)).toEqual(['skin_jenkins_1', 'skin_jenkins_2']); // batch 10
    expect(skinsForTarget('minion_skin', 'b2_dawnclaw').map((c) => c.id)).toEqual(['skin_dawnclaw_1', 'skin_dawnclaw_2', 'skin_dawnclaw_3', 'skin_dawnclaw_4']); // batch 11
    expect(skinsForTarget('minion_skin', 'b2_echohorn').map((c) => c.id)).toEqual(['skin_echohorn_1', 'skin_echohorn_2', 'skin_echohorn_3']); // batch 11
    expect(skinsForTarget('minion_skin', 'b2_oona').map((c) => c.id)).toEqual(['skin_oona_1', 'skin_oona_2']); // batch 11
    expect(skinsForTarget('minion_skin', 'drummer').map((c) => c.id)).toEqual(['skin_drummer_1', 'skin_drummer_2', 'skin_drummer_3', 'skin_drummer_4']);
    expect(skinsForTarget('minion_skin', 'buddy').map((c) => c.id)).toEqual(['skin_buddy_1', 'skin_buddy_2', 'skin_buddy_3']);
    expect(skinsForTarget('minion_skin', 'd2_recaller').map((c) => c.id)).toEqual(['skin_recaller_1', 'skin_recaller_2', 'skin_recaller_3']);
    expect(skinsForTarget('minion_skin', 'nimbus').map((c) => c.id)).toEqual(['skin_nimbus_1', 'skin_nimbus_2', 'skin_nimbus_3', 'skin_nimbus_4']);
    expect(skinsForTarget('minion_skin', 'd2_chronicler').map((c) => c.id)).toEqual(['skin_chronicler_1', 'skin_chronicler_2', 'skin_chronicler_3']);
    expect(skinsForTarget('minion_skin', 'wayfinder').map((c) => c.id)).toEqual(['skin_wayfinder_1', 'skin_wayfinder_2', 'skin_wayfinder_3']);
    expect(skinsForTarget('minion_skin', 'd2_blazingkeeper').map((c) => c.id)).toEqual(['skin_blazingkeeper_1', 'skin_blazingkeeper_2', 'skin_blazingkeeper_3']);
    expect(skinsForTarget('minion_skin', 'k_deepvein').map((c) => c.id)).toEqual(['skin_deepvein_1', 'skin_deepvein_2']);
    expect(skinsForTarget('minion_skin', 'sylus').map((c) => c.id)).toEqual(['skin_sylus_1', 'skin_sylus_2', 'skin_sylus_3']);
    expect(skinsForTarget('minion_skin', 'd2_chorus').map((c) => c.id)).toEqual(['skin_chorus_1', 'skin_chorus_2', 'skin_chorus_3']); // batch 9
    expect(skinsForTarget('hero_skin', 'warden').map((c) => c.id)).toEqual(['skin_warden_1']);
    expect(skinsForTarget('hero_skin', 'frank').map((c) => c.id)).toEqual(['skin_frank_1', 'skin_frank_2', 'skin_frank_3']);
    expect(skinsForTarget('hero_skin', 'keshi').map((c) => c.id)).toEqual(['skin_keshi_1', 'skin_keshi_2']);
    expect(skinsForTarget('hero_skin', 'robin').map((c) => c.id)).toEqual(['skin_robin_1', 'skin_robin_2', 'skin_robin_3']);
    expect(skinsForTarget('hero_skin', 'risen').map((c) => c.id)).toEqual(['skin_risen_1', 'skin_risen_2']);
    expect(skinsForTarget('hero_skin', 'nadja').map((c) => c.id)).toEqual(['skin_nadja_1', 'skin_nadja_2']);
    expect(skinsForTarget('hero_skin', 'rayse').map((c) => c.id)).toEqual(['skin_rayse_1', 'skin_rayse_2']);
    expect(skinsForTarget('hero_skin', 'merrin').map((c) => c.id)).toEqual(['skin_merrin_1', 'skin_merrin_2']);
  });
});

describe('the resolver (default art unless the named skin is live AND made for this target)', () => {
  const snap = { heroSkinByHeroId: { albus: 'skin_albus_1', warden: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_2', whelp: 'skin_blackbelt_1' } };
  it('resolves the right skin for its own target', () => {
    expect(heroSkinOf(snap, 'albus')?.id).toBe('skin_albus_1');
    expect(minionSkinOf(snap, 'blackbelt')?.id).toBe('skin_blackbelt_2');
  });
  it('never puts a skin on another target (a forged / mismatched snapshot), a token, or across slots', () => {
    expect(heroSkinOf(snap, 'warden')).toBeNull(); // Albus's skin named for Warden
    expect(minionSkinOf(snap, 'whelp')).toBeNull(); // a Brian skin named for another card (e.g. a token)
    expect(minionSkinOf({ minionSkinByCardId: { albus: 'skin_albus_1' } }, 'albus')).toBeNull();
    expect(heroSkinOf({ heroSkinByHeroId: { blackbelt: 'skin_blackbelt_1' } }, 'blackbelt')).toBeNull();
  });
  it('an unknown / removed id, no snapshot, or no target: default art, never a throw', () => {
    expect(heroSkinOf({ heroSkinByHeroId: { albus: 'skin_from_the_future' } }, 'albus')).toBeNull();
    expect(minionSkinOf(null, 'blackbelt')).toBeNull();
    expect(minionSkinOf(undefined, 'blackbelt')).toBeNull();
    expect(minionSkinOf(snap, undefined)).toBeNull();
    expect(minionSkinOf({}, 'blackbelt')).toBeNull();
  });
});

describe('the kill switch', () => {
  it('a TS-retired item (active: false) is not live and never resolves, even when equipped / recorded', () => {
    const def = cosmeticOf('skin_blackbelt_2')! as { active: boolean };
    def.active = false;
    try {
      expect(isCosmeticLive('skin_blackbelt_2')).toBe(false);
      expect(minionSkinOf({ minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } }, 'blackbelt')).toBeNull();
      expect(liveCosmetics().map((c) => c.id)).not.toContain('skin_blackbelt_2');
      expect(snapshotForRun({ minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } })).toBeNull();
    } finally { def.active = true; }
  });

  it('a TS-disabled CATEGORY retires every item in it', () => {
    const cat = COSMETIC_CATEGORY_DEFS.hero_skin as { enabled: boolean };
    cat.enabled = false;
    try {
      expect(isCosmeticLive('skin_albus_1')).toBe(false);
      expect(heroSkinOf({ heroSkinByHeroId: { albus: 'skin_albus_1' } }, 'albus')).toBeNull();
      expect(isCosmeticLive('skin_blackbelt_1')).toBe(true); // other category untouched
    } finally { cat.enabled = true; }
  });

  it('the SERVER switch (read from the public tables) retires an item or a category on a client that still ships it', () => {
    const epoch = catalogStateEpoch();
    setServerCatalogState(parseServerCatalogState(
      [{ cosmetic_id: 'skin_warden_1', active: false }, { cosmetic_id: 'skin_albus_1', active: true }, null, { junk: 1 }],
      [{ category: 'minion_skin', enabled: false }, { category: 'title', enabled: true }],
    ));
    expect(catalogStateEpoch()).toBe(epoch + 1);
    expect(isCosmeticLive('skin_warden_1')).toBe(false);
    expect(isCosmeticLive('skin_albus_1')).toBe(true);
    expect(isCosmeticLive('skin_blackbelt_1')).toBe(false);
    expect(isCosmeticLive('title_wanderer')).toBe(true);
    // restore = the server says so (or the state clears)
    setServerCatalogState(parseServerCatalogState([], []));
    expect(isCosmeticLive('skin_warden_1')).toBe(true);
    expect(isCosmeticLive('skin_blackbelt_1')).toBe(true);
  });

  it('the server can only REMOVE: an unknown server row never makes an unknown id live', () => {
    setServerCatalogState(parseServerCatalogState([{ cosmetic_id: 'skin_new', active: true }], 'garbage'));
    expect(isCosmeticLive('skin_new')).toBe(false);
    expect(parseServerCatalogState(undefined, null)).toEqual({ retiredIds: [], disabledCategories: [] });
  });
});

describe('the recorded snapshot', () => {
  it('parses tolerantly: old payloads have none; junk is dropped; unknown ids are KEPT (a newer client\'s item)', () => {
    expect(parseCosmeticSnapshot(undefined)).toBeNull();
    expect(parseCosmeticSnapshot('x')).toBeNull();
    expect(parseCosmeticSnapshot({})).toBeNull();
    expect(parseCosmeticSnapshot({ heroSkinByHeroId: [], minionSkinByCardId: 5 })).toBeNull();
    expect(parseCosmeticSnapshot({ heroSkinByHeroId: { albus: 'skin_albus_1', 'bad key!': 'x', warden: 7 }, minionSkinByCardId: { blackbelt: 'skin_future_9' } }))
      .toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_future_9' } });
  });
  it('caps a hostile payload', () => {
    const big = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`c${i}`, 'skin_blackbelt_1']));
    expect(Object.keys(parseCosmeticSnapshot({ minionSkinByCardId: big })!.minionSkinByCardId!)).toHaveLength(64);
  });
  it('a run records only what it can show (its hero, its cards) and only live items', () => {
    const loadout = { heroSkinByHeroId: { albus: 'skin_albus_1', warden: 'skin_warden_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } };
    expect(snapshotForRun(loadout, { heroIds: ['albus'], cardIds: ['blackbelt', 'whelp'] })).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } });
    expect(snapshotForRun(loadout, { heroIds: ['cia'], cardIds: [] })).toBeNull();
    expect(snapshotForRun(loadout)).toEqual(loadout);
    expect(snapshotForRun(null)).toBeNull();
  });
  it('loadout rows from the SQL JSON or a table read', () => {
    expect(loadoutFromRows([
      { slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' },
      { slot: 'minion_skin', target_id: 'blackbelt', cosmetic_id: 'skin_blackbelt_2' },
      { slot: 'board', targetId: '', cosmeticId: 'x' }, null, 'junk', // a slot this client does not know is dropped
    ])).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } });
    expect(loadoutFromRows(undefined)).toEqual({});
  });
  it('the profile parser: a pre-skins server sends neither field; a skins server sends both', () => {
    const base = { accountXp: 10, accountLevel: 1, revision: 1, equippedTitleId: null, titles: [] };
    expect(parseProgressionProfile(base)).toEqual(base);
    expect(parseProgressionProfile({ ...base, cosmetics: ['skin_albus_1', 3], loadout: [{ slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' }] }))
      .toEqual({ ...base, cosmetics: ['skin_albus_1'], loadout: { heroSkinByHeroId: { albus: 'skin_albus_1' } } });
  });
});

describe('equip_cosmetic (the inventory Edge Function)', () => {
  const USER = '00000000-0000-0000-0000-000000000001';
  const profile = { accountXp: 300, accountLevel: 2, revision: 6, equippedTitleId: null, titles: [], cosmetics: ['skin_albus_1'], loadout: [{ slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' }] };
  const rpc = (data: unknown, error: { message?: string } | null = null): RpcCall => vi.fn(async () => ({ data, error }));

  it('validates slot, target and id; null is Default', () => {
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' }))
      .toEqual({ ok: true, request: { action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' } });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'minion_skin', targetId: 'blackbelt', cosmeticId: null }))
      .toMatchObject({ ok: true, request: { cosmeticId: null } });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'title', targetId: 'x', cosmeticId: 'title_wanderer' })).toMatchObject({ ok: false, error: 'bad_slot' });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'hero_skin', targetId: '', cosmeticId: null })).toMatchObject({ ok: false, error: 'bad_target' });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'a b', cosmeticId: null })).toMatchObject({ ok: false, error: 'bad_target' });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'albus' })).toMatchObject({ ok: false, error: 'bad_cosmetic_id' });
    expect(validateInventoryBody({ action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'albus', cosmeticId: 'Skin!' })).toMatchObject({ ok: false, error: 'bad_cosmetic_id' });
  });

  it('calls the SQL with the caller + request only and returns the new profile; SQL refusals map to 4xx', async () => {
    const ok = rpc({ status: 'equipped', profile });
    const res = await handleInventory(USER, { action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' }, ok);
    expect(ok).toHaveBeenCalledWith('equip_cosmetic', { p_user: USER, p_slot: 'hero_skin', p_target_id: 'albus', p_cosmetic_id: 'skin_albus_1' });
    expect(res).toEqual({ status: 200, body: { status: 'equipped', profile } });
    for (const [msg, status] of [['not_owned', 409], ['wrong_target', 409], ['not_equippable', 409], ['bad_slot', 400]] as const) {
      expect(await handleInventory(USER, { action: 'equip_cosmetic', slot: 'hero_skin', targetId: 'albus', cosmeticId: 'skin_albus_1' }, rpc(null, { message: msg })))
        .toEqual({ status, body: { error: msg } });
    }
  });
});

// Type-level guard: a CosmeticDef literal with a target keeps compiling (the catalog shape is shared with Deno).
const _typed: CosmeticDef = skins[0]!;
void _typed;

describe('the catalog sync payload (code is the source of truth, owner 2026-09-28)', () => {
  it('carries every category and every item, sorted by id, with the columns the SQL writes', () => {
    const p = catalogSyncPayload();
    expect(p.version).toBe(1);
    expect(p.categories.map((c) => c.category)).toEqual([...Object.keys(COSMETIC_CATEGORY_DEFS)].sort());
    expect(p.items.map((i) => i.cosmeticId)).toEqual(COSMETICS.map((c) => c.id).sort());
    expect(p.items.find((i) => i.cosmeticId === 'skin_albus_1')).toEqual({
      cosmeticId: 'skin_albus_1', category: 'hero_skin', rarity: 'epic', acquisitionSource: 'crate', milestoneLevel: null,
      targetType: 'hero', targetId: 'albus', achievementId: null, active: true,
    });
    expect(p.items.find((i) => i.cosmeticId === 'alpha_tester')).toMatchObject({ acquisitionSource: 'level_milestone', milestoneLevel: 2 });
  });

  it('the hash depends only on content: stable, order-independent, and moves with any change', () => {
    const h = catalogHash(catalogSyncPayload());
    expect(h).toMatch(/^v1-[0-9a-f]{16}$/);
    expect(catalogHash(catalogSyncPayload([...COSMETICS].reverse()))).toBe(h);
    const renamedOnly = COSMETICS.map((c) => (c.id === 'skin_albus_1' ? { ...c, name: 'Anything' } : c));
    expect(catalogHash(catalogSyncPayload(renamedOnly))).toBe(h); // a display name is client-only: no resync
    const rarer = COSMETICS.map((c) => (c.id === 'skin_albus_1' ? { ...c, rarity: 'legendary' as const } : c));
    expect(catalogHash(catalogSyncPayload(rarer))).not.toBe(h);
    const retired = COSMETICS.map((c) => (c.id === 'skin_albus_1' ? { ...c, active: false } : c));
    expect(catalogHash(catalogSyncPayload(retired))).not.toBe(h);
  });
});

describe('syncCatalogOnce (the Edge Function, once per cold start)', () => {
  afterEach(() => resetCatalogSyncForTests());

  it('calls the SQL once with the payload and its hash; later requests reuse the answer', async () => {
    const rpc = vi.fn(async () => ({ data: { status: 'synced' }, error: null })) as unknown as RpcCall;
    const a = await syncCatalogOnce(rpc);
    const b = await syncCatalogOnce(rpc);
    expect(a.status).toBe('synced');
    expect(b).toBe(a);
    expect(rpc).toHaveBeenCalledTimes(1);
    const payload = catalogSyncPayload();
    expect(rpc).toHaveBeenCalledWith('sync_cosmetic_catalog', { p_catalog: payload, p_hash: catalogHash(payload) });
  });

  it('reports unchanged when the database already holds this catalog', async () => {
    const rpc = vi.fn(async () => ({ data: { status: 'unchanged' }, error: null })) as unknown as RpcCall;
    expect((await syncCatalogOnce(rpc)).status).toBe('unchanged');
  });

  it('a failure never throws, is logged, and is retried only after the back-off', async () => {
    let t = 1_000;
    const log = vi.fn();
    const failing = vi.fn(async () => ({ data: null, error: { message: 'function sync_cosmetic_catalog does not exist' } })) as unknown as RpcCall;
    expect((await syncCatalogOnce(failing, log, () => t)).status).toBe('failed');
    expect(log).toHaveBeenCalled();
    t += 5_000;
    await syncCatalogOnce(failing, log, () => t);
    expect(failing).toHaveBeenCalledTimes(1); // inside the back-off: no second round trip
    t += CATALOG_SYNC_RETRY_MS;
    const ok = vi.fn(async () => ({ data: { status: 'synced' }, error: null })) as unknown as RpcCall;
    expect((await syncCatalogOnce(ok, log, () => t)).status).toBe('synced');
    const thrower = vi.fn(async () => { throw new Error('boom'); }) as unknown as RpcCall;
    resetCatalogSyncForTests();
    expect((await syncCatalogOnce(thrower, log)).status).toBe('failed');
  });
});

describe('the server state reads the emergency switch (admin_off)', () => {
  it('an item or category with admin_off is retired even though its code flag is on', () => {
    setServerCatalogState(parseServerCatalogState(
      [{ cosmetic_id: 'skin_albus_1', active: true, admin_off: true }, { cosmetic_id: 'skin_warden_1', active: true, admin_off: false }],
      [{ category: 'minion_skin', enabled: true, admin_off: true }],
    ));
    expect(isCosmeticLive('skin_albus_1')).toBe(false);
    expect(isCosmeticLive('skin_warden_1')).toBe(true);
    expect(isCosmeticLive('skin_blackbelt_1')).toBe(false);
    expect(heroSkinOf({ heroSkinByHeroId: { albus: 'skin_albus_1' } }, 'albus')).toBeNull();
  });
});
