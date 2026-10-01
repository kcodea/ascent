// @vitest-environment jsdom
/**
 * SKINS v1 (owner 2026-09-28) on screen:
 *  - every live skin ships its art and targets a real, non-token card / a real hero (the "removing an active
 *    cosmetic from assets must fail CI" rule, handoff §13);
 *  - a Card inside a skin scope paints the skin; Gilded keeps its frame and effects over the skin; any other card
 *    (a token, another minion) keeps its own art; no scope = default art;
 *  - "Show opponent skins" off blanks OPPONENT scopes only, never your own, and persists like the other settings;
 *  - the kill switch: a retired item (TS catalog or the server's one-line switch) falls back to default art on the
 *    next render even while equipped / recorded, and a restore brings it back; unknown ids never throw;
 *  - hero portraits resolve the same way; the per-snapshot map is referentially stable (the perf contract);
 *  - a NEW run records the player's live loadout (`run.cosmetics`), which is what history and replays show.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX } from '@game/content';
import { HEROES } from '@game/sim';
import { COSMETICS, cosmeticOf, heroSkinOf, minionSkinOf, type RunCosmeticSnapshot } from '@game/progression';

vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));

import { Card, type CardView } from '../Card';
import { mount } from '../renderedText.mount';
import { artFor, heroArt, skinArtKeys } from '../art';
import { useGame } from '../store';
import { applyServerCatalogState, resetProgressionForTests, useProgression } from '../progression/progressionStore';
import { MinionSkins, heroPortrait, internSnapshot, minionSkinMap, skinArtOf, useOpponentSkins, useRunSkins } from './skins';

const m = mount(<div />);
beforeEach(() => { resetProgressionForTests(); localStorage.clear(); useGame.setState({ showOpponentSkins: true }); });
afterEach(() => { m.render(<div />); resetProgressionForTests(); });

const brian = (golden = false): CardView => {
  const d = CARD_INDEX.blackbelt!;
  return { name: d.name, cardId: d.id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [], golden, text: d.text ?? '', tier: d.tier };
};
const other = (): CardView => {
  const d = CARD_INDEX.pack!;
  return { name: d.name, cardId: d.id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [], golden: false, text: d.text ?? '', tier: d.tier };
};
const artSrc = (): string | null => m.container.querySelector<HTMLImageElement>('img.artimg')?.getAttribute('src') ?? null;
const SKIN2: RunCosmeticSnapshot = { minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } };
const skins = COSMETICS.filter((c) => c.category === 'hero_skin' || c.category === 'minion_skin');

describe('the catalog <-> the bundle', () => {
  it('every live skin ships its art file (removing one fails CI)', () => {
    const keys = new Set(skinArtKeys());
    for (const c of skins.filter((s) => s.active)) {
      expect(keys.has(c.assets.art!), `${c.id} has no art/skins/${c.assets.art}.webp`).toBe(true);
      expect(skinArtOf(c), c.id).toBeTruthy();
    }
  });
  it('the Legendary Black Belt Brian (owner 2026-09-28: "i added a legendary black belt brian skin") exists, targets blackbelt, and ships its art', () => {
    const c = cosmeticOf('skin_blackbelt_3')!;
    expect(c).toBeTruthy();
    expect([c.category, c.rarity, c.target, c.assets.master]).toEqual(['minion_skin', 'legendary', { type: 'card', id: 'blackbelt' }, 'BlackBeltBrianSkinLegendary.png']);
    expect(skinArtKeys()).toContain('skin_blackbelt_3');
    expect(skinArtOf(c)).toBeTruthy();
    expect(minionSkinOf({ minionSkinByCardId: { blackbelt: 'skin_blackbelt_3' } }, 'blackbelt')?.id).toBe('skin_blackbelt_3');
  });
  it('the Bellringer Voss skin (owner 2026-09-28: "put the bellringer voss skin in too") exists, targets n2_bellringer, and ships its art', () => {
    const c = cosmeticOf('skin_bellringer_1')!;
    expect(c).toBeTruthy();
    expect([c.category, c.rarity, c.target, c.assets.master]).toEqual(['minion_skin', 'epic', { type: 'card', id: 'n2_bellringer' }, 'BellringerVossSkinEpic.png']);
    expect(CARD_INDEX['n2_bellringer']?.name).toBe('Bellringer Voss');
    expect(skinArtKeys()).toContain('skin_bellringer_1');
    expect(skinArtOf(c)).toBeTruthy();
    expect(minionSkinOf({ minionSkinByCardId: { n2_bellringer: 'skin_bellringer_1' } }, 'n2_bellringer')?.id).toBe('skin_bellringer_1');
  });
  // Skins batch 2 (owner 2026-09-28: "i added some skins here: can you wire those up now?"). Each exists, targets its
  // card (checked by name too, so a wrong id cannot hide), is attributed to the owner's master, and ships its art.
  const BATCH2: [id: string, rarity: string, cardId: string, cardName: string, master: string][] = [
    ['skin_blackbelt_4', 'common', 'blackbelt', 'Black Belt Brian', 'BlackBeltBrianCommonSkin.png'],
    ['skin_drummer_1', 'rare', 'drummer', 'Drakko', 'DrakkoSkinRare.png'],
    ['skin_drummer_2', 'epic', 'drummer', 'Drakko', 'DrakkoSkinEpic.png'],
    ['skin_drummer_3', 'epic', 'drummer', 'Drakko', 'DrakkoSkinEpic2.png'],
    ['skin_jenkins_1', 'rare', 'jenkins', 'Jensen & Fi', 'JensenAndFiSkinRare.png'],
    ['skin_joker_1', 'rare', 'joker', 'Mysterious Joker', 'MysteriousJokerSkinRare.png'],
    ['skin_nimbus_1', 'rare', 'nimbus', 'Nimbus', 'NimbusSkinRare.png'],
    ['skin_paragon_1', 'rare', 'n2_paragon', 'Paragon', 'ParagonSkinRare.png'],
    ['skin_stewardofspells_1', 'epic', 'stewardofspells', 'Steward of Spells', 'SpellStewardSkinEpic.png'],
    ['skin_sylus_1', 'rare', 'sylus', 'Sylus', 'SylusSkinRare.png'],
    ['skin_sylus_2', 'legendary', 'sylus', 'Sylus', 'SylusSkinLegendary.png'],
    ['skin_venom_1', 'epic', 'venom', 'Venom', 'VenomSkinEpic.png'],
    ['skin_zyff_1', 'rare', 'zyff', 'Zyff, the Betrayer', 'ZyffSkinRare.png'],
  ];
  it.each(BATCH2)('batch 2: %s (%s) exists, targets %s, and ships its art', (id, rarity, cardId, cardName, master) => {
    const c = cosmeticOf(id)!;
    expect(c).toBeTruthy();
    expect([c.category, c.rarity, c.target, c.assets.master, c.active]).toEqual(['minion_skin', rarity, { type: 'card', id: cardId }, master, true]);
    expect(CARD_INDEX[cardId]?.name).toBe(cardName);
    expect(skinArtKeys()).toContain(id);
    expect(skinArtOf(c)).toBeTruthy();
    expect(minionSkinOf({ minionSkinByCardId: { [cardId]: id } }, cardId)?.id).toBe(id);
  });
  // Skins batch 3 (owner 2026-09-29: "added a few more hero and minion skins - i want to name them appropriately and
  // then decide rarities"). Rarities are the owner's; names match the art. Same checks as batch 2.
  const BATCH3: [id: string, rarity: string, cardId: string, cardName: string, master: string][] = [
    ['skin_oona_1', 'epic', 'b2_oona', 'King Oona', 'RooksOona.png'],
    ['skin_sylus_3', 'rare', 'sylus', 'Sylus', 'StencilSylus.png'],
    ['skin_seaurchin_1', 'rare', 'seaurchin', 'Sea Urchin', 'MaceUrchin.png'],
    ['skin_buddy_1', 'epic', 'buddy', 'Buddy Buddy', 'MagicianBuddyBuddyEpic.png'],
  ];
  it.each(BATCH3)('batch 3: %s (%s) exists, targets %s, and ships its art', (id, rarity, cardId, cardName, master) => {
    const c = cosmeticOf(id)!;
    expect(c).toBeTruthy();
    expect([c.category, c.rarity, c.target, c.assets.master, c.active]).toEqual(['minion_skin', rarity, { type: 'card', id: cardId }, master, true]);
    expect(CARD_INDEX[cardId]?.name).toBe(cardName);
    expect(skinArtKeys()).toContain(id);
    expect(skinArtOf(c)).toBeTruthy();
    expect(minionSkinOf({ minionSkinByCardId: { [cardId]: id } }, cardId)?.id).toBe(id);
  });
  it('batch 3: the Frantic Frank hero skin (Common) exists, targets the hero frank, and ships its art', () => {
    const c = cosmeticOf('skin_frank_1')!;
    expect(c).toBeTruthy();
    expect([c.category, c.rarity, c.target, c.assets.master, c.active]).toEqual(['hero_skin', 'common', { type: 'hero', id: 'frank' }, 'ArmourerFrank.png', true]);
    expect(HEROES.find((h) => h.id === 'frank')!.name).toBe('Frantic Frank');
    expect(skinArtKeys()).toContain('skin_frank_1');
    expect(skinArtOf(c)).toBeTruthy();
    expect(heroSkinOf({ heroSkinByHeroId: { frank: 'skin_frank_1' } }, 'frank')?.id).toBe('skin_frank_1');
  });
  // Skins batch 4 (owner 2026-09-30: "can you wire all the new skins that i added to the folder"). Rarity from the
  // filename suffix; the ten masters with none took the owner's random draw between Common and Epic. Same checks.
  const BATCH4: [id: string, rarity: string, cardId: string, cardName: string, master: string][] = [
    ['skin_arnold_1', 'common', 'dw_arnold', 'Arnold', 'BeefyArnoldCommon.png'],
    ['skin_recaller_1', 'epic', 'd2_recaller', 'Recaller', 'BlownGlassRecallerEpic.png'],
    ['skin_recaller_2', 'rare', 'd2_recaller', 'Recaller', 'MagmaRecallerRare.png'],
    ['skin_recaller_3', 'rare', 'd2_recaller', 'Recaller', 'StarformRecallerRare.png'],
    ['skin_pimm_1', 'rare', 'dw_pimm', 'Paymaster Pimm', 'BouncerPimmRare.png'],
    ['skin_pimm_2', 'epic', 'dw_pimm', 'Paymaster Pimm', 'ProphetPimm.png'],
    ['skin_chimerus_1', 'rare', 'chimerus', 'Chimerus', 'ChimerusSkinRare.png'],
    ['skin_chronicler_1', 'rare', 'd2_chronicler', 'Scalefeather', 'ChromeScalefeatherRare.png'],
    ['skin_chronicler_2', 'epic', 'd2_chronicler', 'Scalefeather', 'MechaScalefeatherEpic.png'],
    ['skin_edward_1', 'legendary', 'dw_edward', 'Edward Keg-hands', 'EdwardColadaHandsLegendary.png'],
    ['skin_baal_1', 'rare', 'dw_baal', 'Baal', 'EpicBaalRare.png'],
    ['skin_pouchpincher_1', 'epic', 'k_pouchpincher', 'Cheap Date', 'LavishDateEpic.png'],
    ['skin_buddy_2', 'legendary', 'buddy', 'Buddy Buddy', 'PortalBuddyLegendary.png'],
    ['skin_buddy_3', 'legendary', 'buddy', 'Buddy Buddy', 'SketchBuddyLegendary.png'],
    ['skin_drummer_4', 'rare', 'drummer', 'Drakko', 'SketchDrakko.png'],
    ['skin_orin_1', 'epic', 'dw_orin', 'Oathshield Orin', 'ThorOrinEpic.png'],
  ];
  it.each(BATCH4)('batch 4: %s (%s) exists, targets %s, and ships its art', (id, rarity, cardId, cardName, master) => {
    const c = cosmeticOf(id)!;
    expect(c).toBeTruthy();
    expect([c.category, c.rarity, c.target, c.assets.master, c.active]).toEqual(['minion_skin', rarity, { type: 'card', id: cardId }, master, true]);
    expect(CARD_INDEX[cardId]?.name).toBe(cardName);
    expect(skinArtKeys()).toContain(id);
    expect(skinArtOf(c)).toBeTruthy();
    expect(minionSkinOf({ minionSkinByCardId: { [cardId]: id } }, cardId)?.id).toBe(id);
  });
  const BATCH4_HEROES: [id: string, rarity: string, heroId: string, heroName: string, master: string][] = [
    ['skin_cia_1', 'common', 'cia', 'Ayse', 'AyseSkinCommon.png'],
    ['skin_cia_2', 'rare', 'cia', 'Ayse', 'AyseSkinRare.png'],
    ['skin_frank_2', 'epic', 'frank', 'Frantic Frank', 'BlackFridayFrank.jpg'],
    ['skin_frank_3', 'rare', 'frank', 'Frantic Frank', 'CoasterFrank.png'],
    ['skin_bram_1', 'rare', 'bram', 'Braum', 'BraumSkinRare.png'],
    ['skin_darah_1', 'epic', 'darah', 'Darah', 'DarahSkinEpic.png'],
    ['skin_darah_2', 'rare', 'darah', 'Darah', 'DarahSkinRare.png'],
    ['skin_emeraldwarden_1', 'rare', 'emeraldwarden', 'Emerald Warden', 'EmeraldWardenSkinRare.png'],
    ['skin_hunch_1', 'rare', 'hunch', 'Hunch', 'HunchSkinRare.png'],
    ['skin_keshi_1', 'epic', 'keshi', 'Keshi the Protector', 'KeshiTheCityguard.png'],
    ['skin_keshi_2', 'epic', 'keshi', 'Keshi the Protector', 'PopStarKeshi.png'],
    ['skin_soren_1', 'epic', 'soren', 'Soren', 'KingSorenEpic.png'],
    ['skin_soren_2', 'common', 'soren', 'Soren', 'MasteredSoren.png'],
    ['skin_brackus_1', 'epic', 'brackus', 'Brackus', 'MasterBrakkus.png'],
    ['skin_brackus_2', 'common', 'brackus', 'Brackus', 'YoungBrakkus.png'],
    ['skin_robin_1', 'common', 'robin', 'Robin', 'NinjaRobin.png'],
  ];
  it.each(BATCH4_HEROES)('batch 4: %s (%s) exists, targets the hero %s, and ships its art', (id, rarity, heroId, heroName, master) => {
    const c = cosmeticOf(id)!;
    expect(c).toBeTruthy();
    expect([c.category, c.rarity, c.target, c.assets.master, c.active]).toEqual(['hero_skin', rarity, { type: 'hero', id: heroId }, master, true]);
    expect(HEROES.find((h) => h.id === heroId)!.name).toBe(heroName);
    expect(skinArtKeys()).toContain(id);
    expect(skinArtOf(c)).toBeTruthy();
    expect(heroSkinOf({ heroSkinByHeroId: { [heroId]: id } }, heroId)?.id).toBe(id);
  });
  const EARNED_TOKEN_TARGETS = new Set(['chimerus', 'dw_baal']);
  // Skins batch 5 (owner 2026-09-30: "i added more skins"). Rarities are the owner's random draw between Common and
  // Epic; three names were shortened to fit the 20-character cap. Same checks as batch 4.
  const BATCH5: [id: string, rarity: string, cardId: string, cardName: string, master: string][] = [
    ['skin_nimbus_2', 'common', 'nimbus', 'Nimbus', 'CottonCandyNimbus.png'],
    ['skin_nimbus_3', 'rare', 'nimbus', 'Nimbus', 'DarkNimbus.jpg'],
    ['skin_nimbus_4', 'common', 'nimbus', 'Nimbus', 'SmogNimbus.png'],
    ['skin_spellsword_1', 'rare', 'n2_spellsword', 'Coppercoat Spellsword', 'LightbladeSpellsword.png'],
    ['skin_chronicler_3', 'rare', 'd2_chronicler', 'Scalefeather', 'MascotScalefeather.png'],
    ['skin_joker_2', 'common', 'joker', 'Mysterious Joker', 'MimeJoker.png'],
    ['skin_butcher_1', 'rare', 'dm_butcher', 'Contract Butcher', 'PastryChefButcher.png'],
    ['skin_chorus_1', 'rare', 'd2_chorus', 'Chorus Drake', 'QuartetChorusdrake.jpg'],
    ['skin_wayfinder_1', 'rare', 'wayfinder', 'Wayfinder', 'SoulSurferWayfinder.png'],
    ['skin_seaurchin_2', 'epic', 'seaurchin', 'Sea Urchin', 'StarUrchin.png'],
    ['skin_wardkeeper_1', 'rare', 'dw_wardkeeper', 'Wardkeeper', 'WitchHunterWardkeeper.png'],
  ];
  it.each(BATCH5)('batch 5: %s (%s) exists, targets %s, and ships its art', (id, rarity, cardId, cardName, master) => {
    const c = cosmeticOf(id)!;
    expect(c).toBeTruthy();
    expect([c.category, c.rarity, c.target, c.assets.master, c.active]).toEqual(['minion_skin', rarity, { type: 'card', id: cardId }, master, true]);
    expect(CARD_INDEX[cardId]?.name).toBe(cardName);
    expect(skinArtKeys()).toContain(id);
    expect(skinArtOf(c)).toBeTruthy();
    expect(minionSkinOf({ minionSkinByCardId: { [cardId]: id } }, cardId)?.id).toBe(id);
  });
  it('batch 5: Influencer Indy (Rare) exists, targets the hero indy, and ships its art', () => {
    const c = cosmeticOf('skin_indy_1')!;
    expect([c.category, c.rarity, c.target, c.assets.master, c.active]).toEqual(['hero_skin', 'rare', { type: 'hero', id: 'indy' }, 'InfluencerIndy.png', true]);
    expect(HEROES.find((h) => h.id === 'indy')).toBeTruthy();
    expect(skinArtKeys()).toContain('skin_indy_1');
    expect(skinArtOf(c)).toBeTruthy();
    expect(heroSkinOf({ heroSkinByHeroId: { indy: 'skin_indy_1' } }, 'indy')?.id).toBe('skin_indy_1');
  });

  it('every skin targets a REAL collectible card (never a token, except the two earned ones) or a REAL hero, by stable id', () => {
    for (const c of skins) {
      if (c.category === 'minion_skin') {
        const def = CARD_INDEX[c.target!.id];
        expect(def, `${c.id} -> ${c.target!.id}`).toBeTruthy();
        // Chimerus (the Dragon quest reward) and Baal (forged by the Rune of Baal) are token-flagged only because the
        // Shop never offers them; they are real minions a player puts on the board, and the owner drew skins for them
        // (batch 4, 2026-09-30). Every other token stays unskinnable.
        if (EARNED_TOKEN_TARGETS.has(c.target!.id)) continue;
        expect(def!.token, `${c.id} targets a token`).toBeFalsy();
      } else {
        expect(HEROES.some((h) => h.id === c.target!.id), `${c.id} -> ${c.target!.id}`).toBe(true);
      }
    }
    expect(CARD_INDEX.blackbelt!.name).toBe('Black Belt Brian');
    expect(HEROES.find((h) => h.id === 'albus')!.name).toBe('Albus');
    expect(HEROES.find((h) => h.id === 'warden')!.name).toBe('Warden');
  });
});

describe('a Card inside a skin scope', () => {
  it('paints the skin for its target card; default art with no scope', () => {
    m.render(<Card card={brian()} />);
    expect(artSrc()).toBe(artFor('blackbelt'));
    m.render(<MinionSkins snapshot={SKIN2}><Card card={brian()} /></MinionSkins>);
    expect(artSrc()).toBe(skinArtOf(cosmeticOf('skin_blackbelt_2')));
    expect(artSrc()).not.toBe(artFor('blackbelt'));
  });

  it('GILDED: the skin with the normal Gilded frame on top (no separate unlock)', () => {
    m.render(<MinionSkins snapshot={SKIN2}><Card card={brian(true)} /></MinionSkins>);
    expect(artSrc()).toBe(skinArtOf(cosmeticOf('skin_blackbelt_2')));
    expect(m.container.querySelector('.card')!.className).toMatch(/\bgolden\b/);
  });

  it('any other card (a token, another minion) keeps its own art, even when a snapshot names it (forged / mismatched)', () => {
    m.render(<MinionSkins snapshot={{ minionSkinByCardId: { blackbelt: 'skin_blackbelt_1', pack: 'skin_blackbelt_1' } }}><Card card={other()} /></MinionSkins>);
    expect(artSrc()).toBe(artFor('pack'));
  });

  it('an unknown id (a newer client, a removed item, an old replay) is default art, never a throw', () => {
    m.render(<MinionSkins snapshot={{ minionSkinByCardId: { blackbelt: 'skin_from_the_future' } }}><Card card={brian()} /></MinionSkins>);
    expect(artSrc()).toBe(artFor('blackbelt'));
    m.render(<MinionSkins snapshot={{ garbage: 1 } as unknown as RunCosmeticSnapshot}><Card card={brian()} /></MinionSkins>);
    expect(artSrc()).toBe(artFor('blackbelt'));
  });
});

describe('Show opponent skins (opponent-only)', () => {
  function Opp({ snap }: { snap: RunCosmeticSnapshot }): JSX.Element {
    return <div className="opp"><MinionSkins snapshot={useOpponentSkins(snap)}><Card card={brian()} /></MinionSkins></div>;
  }
  const tree = (): JSX.Element => (
    <>
      <div className="own"><MinionSkins snapshot={SKIN2}><Card card={brian()} /></MinionSkins></div>
      <Opp snap={{ minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } }} />
    </>
  );
  const src = (sel: string): string | null => m.container.querySelector<HTMLImageElement>(`${sel} img.artimg`)?.getAttribute('src') ?? null;

  it('on (default): both sides wear their owner\'s skin; off: the opponent reverts, yours never does', () => {
    m.render(tree());
    expect(src('.own')).toBe(skinArtOf(cosmeticOf('skin_blackbelt_2')));
    expect(src('.opp')).toBe(skinArtOf(cosmeticOf('skin_blackbelt_1')));
    act(() => useGame.getState().setShowOpponentSkins(false));
    expect(src('.own')).toBe(skinArtOf(cosmeticOf('skin_blackbelt_2')));
    expect(src('.opp')).toBe(artFor('blackbelt'));
    act(() => useGame.getState().setShowOpponentSkins(true));
    expect(src('.opp')).toBe(skinArtOf(cosmeticOf('skin_blackbelt_1')));
  });

  it('is stored like the other client settings, on by default', () => {
    expect(localStorage.getItem('ascent.showopponentskins')).toBeNull();
    act(() => useGame.getState().setShowOpponentSkins(false));
    expect(localStorage.getItem('ascent.showopponentskins')).toBe('false');
  });
});

describe('the kill switch on screen', () => {
  it('the SERVER retires an item: every scope falls back on the next render; restoring brings it back', () => {
    m.render(<MinionSkins snapshot={SKIN2}><Card card={brian()} /></MinionSkins>);
    expect(artSrc()).toBe(skinArtOf(cosmeticOf('skin_blackbelt_2')));
    act(() => applyServerCatalogState({ retiredIds: ['skin_blackbelt_2'], disabledCategories: [] }));
    expect(artSrc()).toBe(artFor('blackbelt'));
    expect(localStorage.getItem('ascent.cosmetics.server')).toContain('skin_blackbelt_2'); // an offline client keeps honouring it
    act(() => applyServerCatalogState({ retiredIds: [], disabledCategories: [] }));
    expect(artSrc()).toBe(skinArtOf(cosmeticOf('skin_blackbelt_2')));
  });

  it('the server disables the CATEGORY: minion skins fall back, hero skins stay', () => {
    act(() => applyServerCatalogState({ retiredIds: [], disabledCategories: ['minion_skin'] }));
    m.render(<MinionSkins snapshot={SKIN2}><Card card={brian()} /></MinionSkins>);
    expect(artSrc()).toBe(artFor('blackbelt'));
    expect(heroPortrait('albus', { heroSkinByHeroId: { albus: 'skin_albus_1' } })).toBe(skinArtOf(cosmeticOf('skin_albus_1')));
  });

  it('a TS-retired item (removed from the bundled catalog\'s active set) falls back too', () => {
    const def = cosmeticOf('skin_warden_1') as { active: boolean };
    def.active = false;
    try {
      expect(heroPortrait('warden', { heroSkinByHeroId: { warden: 'skin_warden_1' } })).toBe(heroArt('warden'));
    } finally { def.active = true; }
    expect(heroPortrait('warden', { heroSkinByHeroId: { warden: 'skin_warden_1' } })).toBe(skinArtOf(cosmeticOf('skin_warden_1')));
  });
});

describe('hero portraits', () => {
  it('the skin for its own hero; default for another hero, no snapshot, an unknown id or no hero', () => {
    const snap = { heroSkinByHeroId: { albus: 'skin_albus_1', cia: 'skin_albus_1', warden: 'nope' } };
    expect(heroPortrait('albus', snap)).toBe(skinArtOf(cosmeticOf('skin_albus_1')));
    expect(heroPortrait('cia', snap)).toBe(heroArt('cia'));
    expect(heroPortrait('warden', snap)).toBe(heroArt('warden'));
    expect(heroPortrait('albus', null)).toBe(heroArt('albus'));
    expect(heroPortrait(undefined, snap)).toBeUndefined();
  });
});

describe('performance: resolve once per snapshot', () => {
  it('the same snapshot object maps to the SAME map (a stable context value); no snapshot is one shared empty map', () => {
    const snap = { minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } };
    expect(minionSkinMap(snap)).toBe(minionSkinMap(snap));
    expect(minionSkinMap(null)).toBe(minionSkinMap(undefined));
    expect(minionSkinMap({})).toBe(minionSkinMap(null));
    const before = minionSkinMap(snap);
    act(() => applyServerCatalogState({ retiredIds: ['skin_blackbelt_1'], disabledCategories: [] }));
    expect(minionSkinMap(snap)).not.toBe(before); // the kill switch re-resolves
    expect(minionSkinMap(snap).size).toBe(0);
  });

  it('a structuredClone (what every reducer dispatch produces) resolves to the SAME map and the SAME interned object', () => {
    const snap = { heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } };
    const clone = structuredClone(snap);
    expect(minionSkinMap(clone)).toBe(minionSkinMap(snap));
    expect(internSnapshot(clone)).toBe(internSnapshot(snap));
    expect(internSnapshot(null)).toBeNull();
  });

  it('the store selector is stable across dispatch clones: a shop click does not re-render a skin scope', () => {
    useGame.setState({ run: { ...useGame.getState().run, cosmetics: { minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } } } });
    let renders = 0;
    function Probe(): JSX.Element { renders++; useRunSkins(); return <div />; }
    m.render(<Probe />);
    const before = renders;
    act(() => useGame.setState({ run: structuredClone(useGame.getState().run) }));
    act(() => useGame.setState({ run: structuredClone(useGame.getState().run) }));
    expect(renders).toBe(before);
  });
});

describe('a new run records the live loadout', () => {
  it('newRun stamps run.cosmetics from the account\'s loadout; nothing when wearing nothing', () => {
    useProgression.setState({ mirror: { userId: 'u-1', accountXp: 0, accountLevel: 1, revision: 1, equippedTitleId: null, titles: [], loadout: { heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } } } });
    act(() => useGame.getState().newRun(4242, 'albus'));
    expect(useGame.getState().run.cosmetics).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } });
    useProgression.setState({ mirror: { userId: 'u-1', accountXp: 0, accountLevel: 1, revision: 1, equippedTitleId: null, titles: [] } });
    act(() => useGame.getState().newRun(4243, 'albus'));
    expect('cosmetics' in useGame.getState().run).toBe(false);
  });
});
