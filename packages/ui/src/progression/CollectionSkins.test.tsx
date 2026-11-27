// @vitest-environment jsdom
/**
 * THE COLLECTION'S SKIN TABS (owner 2026-09-28). Heroes and Minions are live:
 *  - tiles show the skin's art and its hero / minion; unowned tiles are dimmed and blurred, locked;
 *  - the detail panel shows the art large, what it is for, Equip, and "Use default art" when worn (Default is
 *    always selectable); Equip goes through the server with the slot + target + id and adopts the answer;
 *    a refusal (not owned, wrong target, retired) leaves the loadout as it was and says so;
 *  - the kill switch: a retired item (the server's switch) is HIDDEN from the album and the counts, owned or not,
 *    and comes back when restored; a disabled category becomes a locked "Soon" tab.
 * No native tooltips, no em dashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ProgressionProfile } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';
import type { CrateFx } from './crateFx/crateFxPixi';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const equipCosmeticRemote = vi.fn();
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  equipCosmeticRemote: (slot: string, target: string, id: string | null) => equipCosmeticRemote(slot, target, id),
  fetchOwnCrates: async () => undefined,
}));

import { CollectionPage } from './CollectionScreen';
import { applyServerCatalogState, resetProgressionForTests, useProgression } from './progressionStore';
import { setCrateFxFactoryForTests } from './crateFx/crateFxPixi';
import { useGame } from '../store';

const noopFx = (): CrateFx => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : k === 'mount' ? async () => true : () => {}) }) as CrateFx;

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; setCrateFxFactoryForTests(null); resetProgressionForTests(); });
beforeEach(() => {
  resetProgressionForTests();
  localStorage.clear();
  equipCosmeticRemote.mockReset();
  setCrateFxFactoryForTests(noopFx);
  useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null }, showCollection: false, playerName: 'Kevin' });
});

const base: ProgressionProfile = {
  accountXp: 325, accountLevel: 2, revision: 9, equippedTitleId: 'alpha_tester', titles: ['alpha_tester'],
  cosmetics: ['alpha_tester', 'skin_blackbelt_1', 'skin_albus_1'],
  loadout: { heroSkinByHeroId: { albus: 'skin_albus_1' } },
};
function open(over: Partial<ProgressionProfile> = {}): void {
  localStorage.setItem('ascent.collection.seen.u-1', JSON.stringify(['alpha_tester', 'skin_blackbelt_1', 'skin_albus_1']));
  useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList: [], mirror: { userId: 'u-1', ...base, ...over } });
  ui = mount(<CollectionPage reducedMotion />);
}
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string): string => ($(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const tab = (label: string): HTMLButtonElement => $$('.colls-tab').find((t) => t.querySelector('.colls-tab-name')?.textContent === label) as HTMLButtonElement;
const tile = (name: string): HTMLButtonElement => $$('.colls-tile').find((t) => t.querySelector('.colls-tile-name')?.textContent === name) as HTMLButtonElement;
const tileNames = (): string[] => $$('.colls-tile .colls-tile-name').map((n) => n.textContent ?? '');
const button = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const clean = (): void => { expect(document.body.textContent).not.toMatch(/[—–]/); expect(document.querySelector('[title]')).toBeNull(); };

describe('the Heroes and Minions tabs', () => {
  it('are live (not locked), with counts; the header total includes the skins', () => {
    open();
    expect(tab('Heroes').className).not.toMatch(/\blocked\b/);
    expect(tab('Heroes').querySelector('.colls-tab-count')?.textContent).toBe('1/44'); // skins batch 20 (2026-11-12): three Priestess hero skins (was 1/41); skins batch 10 (2026-10-21): seven hero skins (was 1/34); skins batch 8 (2026-10-03): eleven hero skins (was 1/23); skins batch 7 (2026-10-01): Goth Merrin, Iron Guardian, Robin Hood (was 1/20)
    // 2026-09-28: three Black Belt Brian skins and one Bellringer Voss skin, so Minions is 1/4 and the album 22 items (30 with the eight hero attacks, 2026-09-28); skins batch 2 (2026-09-28) adds 13 minion skins: Minions 1/17, the album 43; the 33 hero titles (2026-09-29) make it 76; the ninth hero attack, Inferno (2026-09-29), 77; Grave Call (2026-09-29), 78; the Stampede (2026-09-29), 79; Oona's Banana Cannon (2026-09-29), 80; Hemorrhage (2026-09-29), 81; skins batch 3 (2026-09-29) adds 4 minion skins (Minions 1/21) and a Frantic Frank hero skin (Heroes 1/3), +5; skins batch 4 (2026-09-30) adds 16 minion skins (Minions 1/37) and 16 hero skins (Heroes 1/19), +32; skins batch 5 (2026-09-30) adds 11 minion skins (Minions 1/48) and Influencer Indy (Heroes 1/20), +12; skins batch 6 (2026-10-01) adds 9 minion skins (Minions 1/57), +9; skins batch 9 (2026-10-07) adds Canyon Drake and Thunderchorus Drake (Minions 1/59), +2; frames batch 9 (2026-10-07) adds 5 portrait frames, +5
    expect(tab('Minions').querySelector('.colls-tab-count')?.textContent).toBe('1/484'); // + 220 skins in six style sets, skins batches 22-27 (2026-11-27); + Dad Kobebe, skins batch 21 (2026-11-13); + 8 Bit Wrangler, skins batch 19 (2026-11-12); + nine skins batch 18 (2026-11-12); + five skins batch 17 (2026-11-12); + fifty-five skins batch 16 (2026-11-11); + fifty-eight skins batch 15 (2026-11-11); + eight skins batch 14 (2026-11-02); + twenty-nine skins batch 13 (2026-10-27); + nine Plushie skins batch 12 (2026-10-27); + twenty-two skins batch 11 (2026-10-26); + seven skins batch 10 (2026-10-21); + Astral Fatecarver (2026-10-10)
    expect(text('.colls-meter-num')).toBe('9 / 806'); // 2026-11-27: skins batches 22-27, six style sets (+220). 2026-11-20: Ascenteerianologist (+1). // 2026-11-13: Dad Kobebe (+1). 2026-11-13: the batch of eight hero attacks (+8). 2026-11-12: skins batch 20 (+3). 2026-11-12: frames batch 10 (+6), skins batch 19 (+1). 2026-11-12: skins batch 18 (+9), card plates batch 8 (+7). 2026-11-12: skins batch 17 (+5). 2026-11-11: skins batch 16 (+55). 2026-11-11: skins batch 15 (+58). 2026-11-11: titles batch 2 (+8). 2026-11-02: skins batch 14 (+8). 2026-11-02: Golazo (+1). 2026-11-02: Charge the Mound (+1).  2026-10-26: skins batch 11 (+22). 2026-10-22: the five Comms emotes, owned by all (+5 / +5). 2026-10-18: nine more crate emotes (+9). 2026-10-17: Phoenix removed (-1), Goop (+1), three more card plates (+3), after thirteen (+13). 2026-10-16: the Chrome card plate (+1). 2026-10-16: seven more card plates (+7). 2026-10-15: Sad Wrangler retired (-1). 2026-10-15: Zen Brian, the one starter emote, owned by all (+1). 2026-10-15: no starter emotes (owned -4), thirteen crate emotes in the total (+10 net, Angry Mushy retired). + the six card plates (2026-10-14/15), + the four starter emotes (2026-10-13), + six hero titles (2026-10-15)
  });

  it('tiles show the art and the target; unowned are dimmed + blurred (missing) with a lock', () => {
    open();
    act(() => tab('Minions').click());
    expect(tileNames().sort()).toEqual([
      'Beefy Arnold', 'Blown Glass Recaller', 'Bouncer Pimm', 'Candy Cane Venom', 'Cashier Drakko', 'Chrome Scalefeather',
      'Clocktower Voss', 'Crimson Chimerus', 'Crowd Surf Drakko', 'Double Agent Zyff', 'Edward Colada Hands', 'Epic Baal',
      'Glitch Brian', 'Grandmaster Brian', 'Joyride Jensen & Fi', 'Lavish Date', 'Lounge Act Joker', 'Mace Urchin',
      'Magician Buddy Buddy', 'Magma Recaller', 'Mecha Scalefeather', 'Portal Buddy', 'Potion Stand Steward',
      'Prophet Pimm', 'Rock Star Drakko', 'Rooks Oona', 'Sheriff Brian', 'Sketch Buddy', 'Sketch Drakko',
      'Sketchbook Brian', 'Slam Dunk Sylus', 'Starform Recaller', 'Stencil Sylus', 'Storm Front Nimbus',
      'Superfan Paragon', 'Tee Time Sylus', 'Thor Orin',
      // skins batch 5 (2026-09-30)
      'Cotton Candy Nimbus', 'Dark Nimbus', 'Hexhunter Wardkeeper', 'Lightblade Sword', 'Mascot Scalefeather', 'Mime Joker',
      'Pastry Chef Butcher', 'Quartet Chorusdrake', 'Smog Nimbus', 'Soul Surf Wayfinder', 'Star Urchin',
      // skins batch 6 (2026-10-01)
      'Amber Deepvein', 'Cybernetic Warpath', 'Frost Commander', 'Frost Wardkeeper', 'Infernal Wayfinder', 'Nature Commander',
      'Sea Dragon Wayfinder', 'Static Deepvein', 'Timeworn Spellsword',
      // skins batch 9 (2026-10-07)
      'Canyon Drake', 'Thunderchorus Drake',
      // the Fatecarver skin (2026-10-10)
      'Astral Fatecarver',
      // skins batch 10 (2026-10-21)
      'Anvilshade', 'Liberty Voss', 'Metal Rachel', 'Mushy River', 'Cosmic Mushy', 'Gilded Kennelmaster', 'Jensen & Fi Sky',
      // skins batch 11 (2026-10-26)
      'Plushie Hawkus', 'Plushie Oona', 'Plushie Panther', 'Plushie Tort', 'Cyborg Roomworks', 'Voidworks', 'Frostclaw', 'Stoneclaw', 'Plushie T-Rex', 'Plushie Vicious', 'Plushie Wooly', 'Solar Spots', 'Stormhorn',
      'Pinata Claw', 'Plushie Dawnclaw', 'Plushie Echohorn', 'Snowyhorn', 'Plushie Solaris', 'Plushie Beetle', 'Plushie Elderhorn', 'Plushie Grim', 'Plushie Spots',
      // skins batch 12 (2026-10-27)
      'Plushie Beardsley', 'Plushie Beev', 'Plushie Sunmane', 'Plushie Bullseye', 'Plushie Packstrider', 'Plushie Wolvie', 'Plushie Kennelmaster', 'Plushie Raven', 'Plushie Sea Urchin',
      // skins batch 13 (2026-10-27)
      'Frontier Prospector', 'Star Prospector', 'Anime Lastlight', 'Cuckoo Chronos', 'Tiki Tapkeeper', 'Puppet Tormentor', 'Jello Blart', 'Blocky Prospector', 'Plushie Armadiyo', 'Low Poly Blazer', 'Low Poly Grimoire', 'Low Poly Lastlight', 'Glass Guardian', 'Shadow Tormentor', 'Mall Bob', 'Cathedral Lastlight', 'Poly Flutterbutter', 'Blox Hank', 'Ghillie Sharpshooter', 'Low Poly Chronos', 'Clay Cave Cutter', 'Bedazzled Jewel', 'Scribble Warden', 'Deja Vu Chronos', 'Pet Rock Guardian', 'Scribble Tapkeeper', 'Scribbled Bob', 'Blueprint Chronos', 'Brick Tapkeeper',
      // skins batch 14 (2026-11-02)
      'Scribble Kobebes', 'Treasure Kobebes', 'Gargoyle Todd', 'Scribble Big Huggies', 'Scribble Humphry', 'Serverchef', 'Toast Gary Toast', 'Scribble Daniel',
      // skins batch 15 (2026-11-11)
      '60s Candy Assembler', 'Voxel Tunneller', 'Runegate Portsmith', 'Vintage Brisbane', 'Galaxy Brain Billy', 'Chalkboard Billy', 'Itamae Striker', 'Arcade Coinfire', 'Woodland Warhorn', 'Lightdisk Thrower', 'Pizza Thrower', 'Voxel Brakka', 'Impslayer Brakka', 'Lighthouse Kringle', 'Kristmas Kringle', 'Safe Thane', 'Carved Mountainbond', 'Bonsai Earthbreaker', 'Weather Storm Chaser', 'Marble Gemcarver', 'Precious Delvey', 'Glowstick Crasher', 'Pinata Party Crasher', 'Hazmat Brisbane', 'Superfan Warhorn', 'Dealer Coinfire', 'Bathtime Gangplank', 'Metalhead Gastrid', 'Timber Brakka', 'Charcoal Kringle', 'Chesspiece Thane', 'Molten Mountainbond', 'Low Poly Vaultkeeper', 'Dozer Earthbreaker', 'Mecha Boulderdash', 'Toonstar Kobe', 'Aurora Gemling', 'Origami Gemling', 'Scribble Crownvein', 'Samurai Striker', 'Poolside Brunni', 'Stained Glass Brunni', 'Don Brunni', 'Solar Gangplank', 'Tattoo Gangplank', 'Frostborn Brakka', 'Beach Babe Brewer', 'Ronin Thane', 'Recordkeeper', 'Ice Whelp', 'Lavalamp Broodfire', 'Floaty Riverback', 'Plushie Gastrid', 'Boxing Brewer', 'Excel-ent Billings', 'Cyber Mountainbond', 'Bubble Mirrorwing', 'Dunebreaker',
      // skins batches 22-27 (2026-11-27), the six style sets: Voxel, Sketchbook, Crayon, Encore, 8 Bit, Low Poly
      'Voxel Beggy', 'Voxel Buddy Buddy', 'Voxel Cheap Date', 'Voxel Ember Whelp', 'Voxel Geode Guardian', 'Voxel Knocked', 'Voxel Mirrorwing', 'Voxel Overseer', 'Voxel Paymaster Pimm', 'Voxel Striker', 'Voxel T-Rex', 'Voxel Void Panther', 'Voxel Brood Matron', 'Voxel Brunni', 'Voxel Dawnclaw', 'Voxel Earthbreaker', 'Voxel Gemling', 'Voxel Grobbus', 'Voxel Lastlight', 'Voxel Recaller', 'Voxel Runic Beetle', 'Voxel Sharpshooter', 'Voxel Storm Chaser', 'Voxel Wayfinder', 'Voxel Anvilshade', 'Voxel Captain Flamus', 'Voxel Chipper', 'Voxel Chronos', 'Voxel Crownvein', 'Voxel Flamebeat', 'Voxel Grimoire', 'Voxel Joker', 'Voxel King Oona', 'Voxel Todd', 'Voxel Vaultkeeper', 'Voxel Vicious', 'Voxel Brisbane', 'Voxel Elderhorn', 'Voxel Malphas', 'Voxel Yazzus', 'Sketch Beggy', 'Sketch Broodfire', 'Sketch Cheap Date', 'Sketch Cinderchef', 'Sketch Hank', 'Sketch Knocked', 'Sketch Pimm', 'Sketch Spellsword', 'Sketch Striker', 'Sketch T-Rex', 'Sketch Void Panther', 'Sketch Brewer', 'Sketch Bullseye', 'Sketch Butcher', 'Sketch Coinfire', 'Sketch Echohorn', 'Sketch Gasket', 'Sketch Gem Carver', 'Sketch Scalefeather', 'Sketch Tunneller Rik', 'Sketch Venom', 'Sketch Voicekeeper', 'Sketch Voss', 'Sketch Fatecarver', 'Sketch Fel Spikes', 'Sketch Grevlin & Co', 'Sketch Grimoire', 'Sketch Jensen & Fi', 'Sketch Kringle', 'Sketch Mountainbond', 'Sketch Party Crasher', 'Sketch Portsmith', 'Sketch Spots', 'Sketch Warpath', 'Sketch Wooly', 'Sketch Brisbane', 'Sketch Elderhorn', 'Sketch Malphas', 'Sketch Orivax', 'Sketch Runemaster', 'Crayon Brain Billy', 'Crayon Cheap Date', 'Crayon Packstrider', 'Crayon Prospector', 'Crayon Spellsword', 'Crayon Wolvie', 'Crayon Axeman', 'Crayon Brunni', 'Crayon Kobe', 'Crayon Lastlight', 'Crayon Runic Beetle', 'Crayon Transcendant', 'Crayon Delvey', 'Crayon Enigma', 'Crayon Flamus', 'Crayon Karwind', 'Crayon Rad Rachel', 'Crayon Orivax', 'Crayon Runemaster', 'Crayon Zyff', 'Encore Agent', 'Encore Cheap Date', 'Encore Ember Whelp', 'Encore Guardian', 'Encore Knocked', 'Encore Mirrorwing', 'Encore Orin', 'Encore Packstrider', 'Encore Prospector', 'Encore Spellsword', 'Encore Striker', 'Encore Wolvie', 'Encore Bearer', 'Encore Beev', 'Encore Brakka', 'Encore Chorus Drake', 'Encore Gem Carver', 'Encore Mushy', 'Encore Raven', 'Encore Rope Wrangler', 'Encore Storm Chaser', 'Encore Tormentor', 'Encore Wardkeeper', 'Encore Billings', 'Encore Brian', 'Encore Delvey', 'Encore Drunk Daniel', 'Encore Flamebeat', 'Encore Flamus', 'Encore Hawkus', 'Encore Joker', 'Encore Kobebes', 'Encore Solaris', 'Encore Soul Defiler', 'Encore Todd', 'Encore Brisbane', 'Encore Elderhorn', 'Encore Malphas', 'Encore Orivax', 'Encore Uron', '8 Bit Appetite Agent', '8 Bit Brain Billy', '8 Bit Cheap Date', '8 Bit Cinderchef', '8 Bit Leech', '8 Bit Mirrorwing', '8 Bit Packstrider', '8 Bit Paymaster Pimm', '8 Bit Prospector', '8 Bit Ruby Mender', '8 Bit Spellsword', '8 Bit Wolvie', '8 Bit Arena Heckler', '8 Bit Beardsley', '8 Bit Blazer', '8 Bit Brewer', '8 Bit Bullseye', '8 Bit Butcher', '8 Bit Conductor', '8 Bit Flutterbutter', '8 Bit Gangplank', '8 Bit Gasket', '8 Bit Jewel', '8 Bit Scalefeather', '8 Bit Captain Flamus', '8 Bit Delvey', '8 Bit Gary Toast', '8 Bit Grim', '8 Bit Hydraskus', '8 Bit Karwind', '8 Bit Keg-hands', '8 Bit Kobebes', '8 Bit Nimbus', '8 Bit Solaris', '8 Bit Brisbane', '8 Bit Elderhorn', '8 Bit Malphas', '8 Bit Orivax', '8 Bit Runemaster', '8 Bit Yazzus', 'Low Poly Broodfire', 'Low Poly Buddy Buddy', 'Low Poly Cheap Date', 'Low Poly Ember Whelp', 'Low Poly Knocked', 'Low Poly Prospector', 'Low Poly Scrapper', 'Poly Kennelmaster', 'Poly Oathshield Orin', 'Poly Right Hand Hank', 'Poly Void Panther', 'Poly Warhorn Captain', 'Low Poly Beev', 'Low Poly Cave Cutter', 'Low Poly Coinfire', 'Low Poly Demon Horse', 'Low Poly Raven', 'Low Poly Steward', 'Low Poly Tormentor', 'Low Poly Venom', 'Poly Baby Gastrid', 'Poly Chorus Drake', 'Poly Transcendant', 'Poly Tunneller Rik', 'Low Poly Billings', 'Low Poly Boulderdash', 'Low Poly Fatecarver', 'Low Poly Rad Rachel', 'Low Poly Shrieker', 'Low Poly Spots', 'Low Poly Tort', 'Poly Mountainbond', 'Poly Party Crasher', 'Poly Soul Defiler', 'Low Poly Brisbane', 'Low Poly Elderhorn', 'Low Poly Malphas', 'Low Poly McKlusky', 'Low Poly Orivax', 'Low Poly Runemaster',
      // skins batch 21 (2026-11-13)
      'Dad Kobebe',
      // skins batch 19 (2026-11-12)
      '8 Bit Wrangler',
      // skins batch 18 (2026-11-12)
      'Storybook Beggy', 'Graffiti Scrapper', '8 Bit Beggy', '8 Bit Dawnclaw', '8 Bit Orin', 'Blown Glass Yazzus', 'Retro Boulderdash', '8 Bit Echohorn', '8 Bit Sylus',
      // skins batch 17 (2026-11-12)
      'Mystic Arts Yazzus', 'Mystic Yazzus', 'Celestial Yazzus', 'Hunter Salvatore', 'Captain Uron',
      // skins batch 16 (2026-11-11)
      'Action Transcendant', 'Bonaparte Flamus', 'Boxer Knocked', 'Bug Collector', 'Carnival Demon Horse', 'Ceremonial Bearer', 'Here is Axeman', 'Holo Grobbus', 'Home Alone Shrieker', 'Infomercial Grevlin', 'Jungle Leech', 'Poly Malphas', 'Puffer Spike', 'Queen Bee Matron', 'Salesman Grevlin', 'Steamworks Gasket', 'Taiko Flamebeat', 'Whack-a-Mole Breaker', 'Alien Queen Matron', 'Bebop Wrangler', 'Cactus Spike', 'Chrome Grobbus', 'Colossal Hydraskus', 'Double O Agent', 'Fire Eater Defiler', 'Foam Finger Heckler', 'Hammock Knocked', 'Ink Transcendant', 'Jelly Enigma', 'Kaiju Chomper', 'Lifeguard Overseer', 'Mech Overseer', 'Origami Karwind', 'Pastoral Shepherd', 'Proton Gasket', 'Retro Game Chipper', 'Rider Demonhorse', 'Sea Witch Defiler', "Sorcerer's Conductor", 'Cookie Chomper', 'DJ Conductor', 'Friendship Horse', 'Keyboard Warrior', 'Knit Tauntbreaker', 'Lich Grobbus', 'Pop Star Defiler', 'Powerup Karwind', 'Powerup Transcendant', 'Purple Reign Orivax', 'Scribble Legion', 'Timber Axeman', 'Comic Wrangler', 'Voxel Orivax', 'Wraith Shrieker', 'Baby Voicekeeper',
    ].sort());
    const owned = tile('Sheriff Brian');
    expect(owned.className).toMatch(/\bskin\b/);
    expect(owned.className).toMatch(/\bowned\b/);
    expect(owned.querySelector('img.colls-tile-art')?.getAttribute('src')).toContain('skin_blackbelt_1');
    expect(owned.querySelector('.colls-tile-for')?.textContent).toBe('Black Belt Brian');
    const missing = tile('Glitch Brian');
    expect(missing.className).toMatch(/\bmissing\b/);
    expect(missing.querySelector('.colls-tile-lock')).not.toBeNull();
    expect(missing.getAttribute('aria-label')).toBe('Glitch Brian, for Black Belt Brian, Epic, not owned');
    clean();
  });

  it('the worn hero skin is ribboned and selected; the detail panel shows it large with "Use default art"', () => {
    open();
    act(() => tab('Heroes').click());
    expect(tile('Surf Day Albus').className).toMatch(/\bworn\b/);
    expect(text('.colls-detail .colls-kicker')).toBe('Hero skin');
    expect($('.colls-heroring .hero .f img.heroimg')?.getAttribute('src')).toContain('skin_albus_1');
    expect(text('.colls-detail')).toContain('Albus');
    expect(button('Use default art')).toBeTruthy();
    clean();
  });
});

describe('equipping a skin', () => {
  it('Equip sends slot + target + id; the returned profile moves the ribbon', async () => {
    open();
    act(() => tab('Minions').click());
    act(() => tile('Sheriff Brian').click());
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, revision: 10, loadout: { ...base.loadout, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('minion_skin', 'blackbelt', 'skin_blackbelt_1');
    expect(tile('Sheriff Brian').className).toMatch(/\bworn\b/);
    expect(useProgression.getState().mirror!.loadout).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } });
  });

  it('Use default art sends null (Default); a refusal keeps the skin on and says so', async () => {
    open();
    act(() => tab('Heroes').click());
    equipCosmeticRemote.mockResolvedValue({ status: 'error', reason: 'not_owned' });
    await act(async () => { button('Use default art')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_skin', 'albus', null);
    expect(tile('Surf Day Albus').className).toMatch(/\bworn\b/);
    expect(text('.coll-error')).toBe('Could not change your skin. Try again.');
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, revision: 11, loadout: {} } });
    await act(async () => { button('Use default art')!.click(); });
    await settle();
    expect(tile('Surf Day Albus').className).not.toMatch(/\bworn\b/);
  });

  it('an unowned skin has no Equip, only how to find it', () => {
    open();
    act(() => tab('Heroes').click());
    act(() => tile('Bath Day Warden').click());
    expect(button('Equip')).toBeUndefined();
    expect(text('.colls-hint')).toBe('Open chests to find it.');
  });
});

describe('the kill switch in the Collection (retired = hidden, owned or not; restored = back)', () => {
  it('a retired OWNED skin leaves the album and the counts; restoring brings it back owned', () => {
    open();
    act(() => tab('Minions').click());
    expect(tileNames()).toContain('Sheriff Brian');
    act(() => applyServerCatalogState({ retiredIds: ['skin_blackbelt_1'], disabledCategories: [] }));
    expect(tileNames()).toEqual([ // rarest first, then catalog order
      'Tee Time Sylus', 'Edward Colada Hands', 'Blueprint Chronos', 'Brick Tapkeeper', 'Baby Voicekeeper', 'Dad Kobebe', // Ancient (2026-10-02; batch 13 2026-10-27)
      'Grandmaster Brian', 'Cashier Drakko', 'Candy Cane Venom', 'Magician Buddy Buddy', 'Prophet Pimm', 'Chrome Scalefeather',
      'Portal Buddy', 'Cotton Candy Nimbus', 'Cybernetic Warpath', 'Plushie Beetle', 'Plushie Elderhorn', 'Plushie Grim', 'Plushie Spots', 'Plushie Raven', 'Plushie Sea Urchin', 'Deja Vu Chronos', 'Pet Rock Guardian', 'Scribble Tapkeeper', 'Scribbled Bob', 'Plushie Gastrid', 'Boxing Brewer', 'Excel-ent Billings', 'Cyber Mountainbond', 'Bubble Mirrorwing', 'Dunebreaker', 'Captain Uron', '8 Bit Echohorn', '8 Bit Sylus', '8 Bit Wrangler', 'Voxel Brisbane', 'Voxel Elderhorn', 'Voxel Malphas', 'Voxel Yazzus', 'Sketch Brisbane', 'Sketch Elderhorn', 'Sketch Malphas', 'Sketch Orivax', 'Sketch Runemaster', 'Crayon Orivax', 'Crayon Runemaster', 'Crayon Zyff', 'Encore Brisbane', 'Encore Elderhorn', 'Encore Malphas', 'Encore Orivax', 'Encore Uron', '8 Bit Brisbane', '8 Bit Elderhorn', '8 Bit Malphas', '8 Bit Orivax', '8 Bit Runemaster', '8 Bit Yazzus', 'Low Poly Brisbane', 'Low Poly Elderhorn', 'Low Poly Malphas', 'Low Poly McKlusky', 'Low Poly Orivax', 'Low Poly Runemaster',
      'Glitch Brian', 'Clocktower Voss', 'Rock Star Drakko', 'Slam Dunk Sylus', 'Rooks Oona', 'Mace Urchin', 'Magma Recaller', 'Sketch Buddy',
      'Sketch Drakko', 'Thor Orin', 'Dark Nimbus', 'Pastry Chef Butcher', 'Nature Commander', 'Cosmic Mushy', 'Gilded Kennelmaster', 'Jensen & Fi Sky', 'Pinata Claw', 'Plushie Dawnclaw', 'Plushie Echohorn', 'Snowyhorn', 'Plushie Solaris', 'Plushie Kennelmaster', 'Cathedral Lastlight', 'Poly Flutterbutter', 'Blox Hank', 'Ghillie Sharpshooter', 'Low Poly Chronos', 'Clay Cave Cutter', 'Bedazzled Jewel', 'Scribble Warden', 'Scribble Daniel', 'Mecha Boulderdash', 'Toonstar Kobe', 'Aurora Gemling', 'Origami Gemling', 'Scribble Crownvein', 'Samurai Striker', 'Poolside Brunni', 'Stained Glass Brunni', 'Don Brunni', 'Solar Gangplank', 'Tattoo Gangplank', 'Frostborn Brakka', 'Beach Babe Brewer', 'Ronin Thane', 'Recordkeeper', 'Ice Whelp', 'Lavalamp Broodfire', 'Floaty Riverback', 'Cookie Chomper', 'DJ Conductor', 'Friendship Horse', 'Keyboard Warrior', 'Knit Tauntbreaker', 'Lich Grobbus', 'Pop Star Defiler', 'Powerup Karwind', 'Powerup Transcendant', 'Purple Reign Orivax', 'Scribble Legion', 'Timber Axeman', 'Comic Wrangler', 'Voxel Orivax', 'Wraith Shrieker', 'Celestial Yazzus', 'Hunter Salvatore', '8 Bit Beggy', '8 Bit Dawnclaw', '8 Bit Orin', 'Blown Glass Yazzus', 'Retro Boulderdash', 'Voxel Anvilshade', 'Voxel Captain Flamus', 'Voxel Chipper', 'Voxel Chronos', 'Voxel Crownvein', 'Voxel Flamebeat', 'Voxel Grimoire', 'Voxel Joker', 'Voxel King Oona', 'Voxel Todd', 'Voxel Vaultkeeper', 'Voxel Vicious', 'Sketch Fatecarver', 'Sketch Fel Spikes', 'Sketch Grevlin & Co', 'Sketch Grimoire', 'Sketch Jensen & Fi', 'Sketch Kringle', 'Sketch Mountainbond', 'Sketch Party Crasher', 'Sketch Portsmith', 'Sketch Spots', 'Sketch Warpath', 'Sketch Wooly', 'Crayon Delvey', 'Crayon Enigma', 'Crayon Flamus', 'Crayon Karwind', 'Crayon Rad Rachel', 'Encore Billings', 'Encore Brian', 'Encore Delvey', 'Encore Drunk Daniel', 'Encore Flamebeat', 'Encore Flamus', 'Encore Hawkus', 'Encore Joker', 'Encore Kobebes', 'Encore Solaris', 'Encore Soul Defiler', 'Encore Todd', '8 Bit Captain Flamus', '8 Bit Delvey', '8 Bit Gary Toast', '8 Bit Grim', '8 Bit Hydraskus', '8 Bit Karwind', '8 Bit Keg-hands', '8 Bit Kobebes', '8 Bit Nimbus', '8 Bit Solaris', 'Low Poly Billings', 'Low Poly Boulderdash', 'Low Poly Fatecarver', 'Low Poly Rad Rachel', 'Low Poly Shrieker', 'Low Poly Spots', 'Low Poly Tort', 'Poly Mountainbond', 'Poly Party Crasher', 'Poly Soul Defiler',
      'Sketchbook Brian', 'Crowd Surf Drakko', 'Lounge Act Joker', 'Storm Front Nimbus', 'Superfan Paragon', 'Stencil Sylus', 'Blown Glass Recaller', 'Crimson Chimerus',
      'Epic Baal', 'Smog Nimbus', 'Lightblade Sword', 'Mascot Scalefeather', 'Mime Joker', 'Quartet Chorusdrake', 'Star Urchin',
      'Sea Dragon Wayfinder', 'Timeworn Spellsword', 'Frost Commander', 'Canyon Drake', 'Thunderchorus Drake', 'Astral Fatecarver',
      'Anvilshade', 'Liberty Voss', 'Metal Rachel', 'Mushy River', 'Cyborg Roomworks', 'Voidworks', 'Frostclaw', 'Stoneclaw', 'Plushie T-Rex', 'Plushie Vicious', 'Plushie Wooly', 'Solar Spots', 'Stormhorn', 'Plushie Bullseye', 'Plushie Packstrider', 'Plushie Wolvie', 'Blocky Prospector', 'Plushie Armadiyo', 'Low Poly Blazer', 'Low Poly Grimoire', 'Low Poly Lastlight', 'Glass Guardian', 'Shadow Tormentor', 'Mall Bob', 'Treasure Kobebes', 'Gargoyle Todd', 'Scribble Big Huggies', 'Scribble Humphry', 'Serverchef', 'Toast Gary Toast', 'Weather Storm Chaser', 'Marble Gemcarver', 'Precious Delvey', 'Glowstick Crasher', 'Pinata Party Crasher', 'Hazmat Brisbane', 'Superfan Warhorn', 'Dealer Coinfire', 'Bathtime Gangplank', 'Metalhead Gastrid', 'Timber Brakka', 'Charcoal Kringle', 'Chesspiece Thane', 'Molten Mountainbond', 'Low Poly Vaultkeeper', 'Dozer Earthbreaker', 'Alien Queen Matron', 'Bebop Wrangler', 'Cactus Spike', 'Chrome Grobbus', 'Colossal Hydraskus', 'Double O Agent', 'Fire Eater Defiler', 'Foam Finger Heckler', 'Hammock Knocked', 'Ink Transcendant', 'Jelly Enigma', 'Kaiju Chomper', 'Lifeguard Overseer', 'Mech Overseer', 'Origami Karwind', 'Pastoral Shepherd', 'Proton Gasket', 'Retro Game Chipper', 'Rider Demonhorse', 'Sea Witch Defiler', "Sorcerer's Conductor", 'Mystic Yazzus', 'Graffiti Scrapper', 'Voxel Brood Matron', 'Voxel Brunni', 'Voxel Dawnclaw', 'Voxel Earthbreaker', 'Voxel Gemling', 'Voxel Grobbus', 'Voxel Lastlight', 'Voxel Recaller', 'Voxel Runic Beetle', 'Voxel Sharpshooter', 'Voxel Storm Chaser', 'Voxel Wayfinder', 'Sketch Brewer', 'Sketch Bullseye', 'Sketch Butcher', 'Sketch Coinfire', 'Sketch Echohorn', 'Sketch Gasket', 'Sketch Gem Carver', 'Sketch Scalefeather', 'Sketch Tunneller Rik', 'Sketch Venom', 'Sketch Voicekeeper', 'Sketch Voss', 'Crayon Axeman', 'Crayon Brunni', 'Crayon Kobe', 'Crayon Lastlight', 'Crayon Runic Beetle', 'Crayon Transcendant', 'Encore Bearer', 'Encore Beev', 'Encore Brakka', 'Encore Chorus Drake', 'Encore Gem Carver', 'Encore Mushy', 'Encore Raven', 'Encore Rope Wrangler', 'Encore Storm Chaser', 'Encore Tormentor', 'Encore Wardkeeper', '8 Bit Arena Heckler', '8 Bit Beardsley', '8 Bit Blazer', '8 Bit Brewer', '8 Bit Bullseye', '8 Bit Butcher', '8 Bit Conductor', '8 Bit Flutterbutter', '8 Bit Gangplank', '8 Bit Gasket', '8 Bit Jewel', '8 Bit Scalefeather', 'Low Poly Beev', 'Low Poly Cave Cutter', 'Low Poly Coinfire', 'Low Poly Demon Horse', 'Low Poly Raven', 'Low Poly Steward', 'Low Poly Tormentor', 'Low Poly Venom', 'Poly Baby Gastrid', 'Poly Chorus Drake', 'Poly Transcendant', 'Poly Tunneller Rik',
      'Joyride Jensen & Fi', 'Potion Stand Steward', 'Double Agent Zyff', 'Beefy Arnold', 'Starform Recaller', 'Bouncer Pimm', 'Mecha Scalefeather', 'Lavish Date',
      'Soul Surf Wayfinder', 'Hexhunter Wardkeeper', 'Amber Deepvein', 'Static Deepvein', 'Frost Wardkeeper', 'Infernal Wayfinder', 'Plushie Hawkus', 'Plushie Oona', 'Plushie Panther', 'Plushie Tort', 'Plushie Beardsley', 'Plushie Beev', 'Plushie Sunmane', 'Frontier Prospector', 'Star Prospector', 'Anime Lastlight', 'Cuckoo Chronos', 'Tiki Tapkeeper', 'Puppet Tormentor', 'Jello Blart', 'Scribble Kobebes', '60s Candy Assembler', 'Voxel Tunneller', 'Runegate Portsmith', 'Vintage Brisbane', 'Galaxy Brain Billy', 'Chalkboard Billy', 'Itamae Striker', 'Arcade Coinfire', 'Woodland Warhorn', 'Lightdisk Thrower', 'Pizza Thrower', 'Voxel Brakka', 'Impslayer Brakka', 'Lighthouse Kringle', 'Kristmas Kringle', 'Safe Thane', 'Carved Mountainbond', 'Bonsai Earthbreaker', 'Action Transcendant', 'Bonaparte Flamus', 'Boxer Knocked', 'Bug Collector', 'Carnival Demon Horse', 'Ceremonial Bearer', 'Here is Axeman', 'Holo Grobbus', 'Home Alone Shrieker', 'Infomercial Grevlin', 'Jungle Leech', 'Poly Malphas', 'Puffer Spike', 'Queen Bee Matron', 'Salesman Grevlin', 'Steamworks Gasket', 'Taiko Flamebeat', 'Whack-a-Mole Breaker', 'Mystic Arts Yazzus', 'Storybook Beggy', 'Voxel Beggy', 'Voxel Buddy Buddy', 'Voxel Cheap Date', 'Voxel Ember Whelp', 'Voxel Geode Guardian', 'Voxel Knocked', 'Voxel Mirrorwing', 'Voxel Overseer', 'Voxel Paymaster Pimm', 'Voxel Striker', 'Voxel T-Rex', 'Voxel Void Panther', 'Sketch Beggy', 'Sketch Broodfire', 'Sketch Cheap Date', 'Sketch Cinderchef', 'Sketch Hank', 'Sketch Knocked', 'Sketch Pimm', 'Sketch Spellsword', 'Sketch Striker', 'Sketch T-Rex', 'Sketch Void Panther', 'Crayon Brain Billy', 'Crayon Cheap Date', 'Crayon Packstrider', 'Crayon Prospector', 'Crayon Spellsword', 'Crayon Wolvie', 'Encore Agent', 'Encore Cheap Date', 'Encore Ember Whelp', 'Encore Guardian', 'Encore Knocked', 'Encore Mirrorwing', 'Encore Orin', 'Encore Packstrider', 'Encore Prospector', 'Encore Spellsword', 'Encore Striker', 'Encore Wolvie', '8 Bit Appetite Agent', '8 Bit Brain Billy', '8 Bit Cheap Date', '8 Bit Cinderchef', '8 Bit Leech', '8 Bit Mirrorwing', '8 Bit Packstrider', '8 Bit Paymaster Pimm', '8 Bit Prospector', '8 Bit Ruby Mender', '8 Bit Spellsword', '8 Bit Wolvie', 'Low Poly Broodfire', 'Low Poly Buddy Buddy', 'Low Poly Cheap Date', 'Low Poly Ember Whelp', 'Low Poly Knocked', 'Low Poly Prospector', 'Low Poly Scrapper', 'Poly Kennelmaster', 'Poly Oathshield Orin', 'Poly Right Hand Hank', 'Poly Void Panther', 'Poly Warhorn Captain',
    ]);
    expect(tab('Minions').querySelector('.colls-tab-count')?.textContent).toBe('0/483');
    expect(text('.colls-meter-num')).toBe('8 / 805'); // 2026-11-27: skins batches 22-27 (+220). 2026-11-20: Ascenteerianologist (+1). // 2026-11-13: the batch of eight hero attacks (+8)
    act(() => applyServerCatalogState({ retiredIds: [], disabledCategories: [] }));
    expect(tile('Sheriff Brian').className).toMatch(/\bowned\b/);
    expect(text('.colls-meter-num')).toBe('9 / 806'); // 2026-11-27: skins batches 22-27, six style sets (+220). 2026-11-20: Ascenteerianologist (+1). // 2026-11-13: Dad Kobebe (+1). 2026-11-13: the batch of eight hero attacks (+8). 2026-11-12: skins batch 20 (+3). 2026-11-12: frames batch 10 (+6), skins batch 19 (+1). 2026-11-12: skins batch 18 (+9), card plates batch 8 (+7). 2026-11-12: skins batch 17 (+5). 2026-11-11: skins batch 16 (+55). 2026-11-11: skins batch 15 (+58). 2026-11-11: titles batch 2 (+8). 2026-11-02: skins batch 14 (+8). 2026-11-02: Golazo (+1). 2026-11-02: Charge the Mound (+1).  2026-10-26: skins batch 11 (+22). 2026-10-22: the five Comms emotes (+5 / +5). 2026-10-17: Phoenix removed (-1), Goop (+1), three more card plates (+3), after thirteen (+13). 2026-10-16: the Chrome card plate (+1). 2026-10-16: seven more card plates (+7). 2026-10-15: Sad Wrangler retired (-1). 2026-10-15: Zen Brian, the one starter emote, owned by all (+1). 2026-10-15: no starter emotes (owned -4), thirteen crate emotes in the total (+10 net, Angry Mushy retired). + the six card plates (2026-10-14/15), + the four starter emotes (2026-10-13), + six hero titles (2026-10-15)
  });

  it('a disabled CATEGORY becomes a locked Soon tab', () => {
    open();
    act(() => applyServerCatalogState({ retiredIds: [], disabledCategories: ['hero_skin'] }));
    expect(tab('Heroes').className).toMatch(/\blocked\b/);
    expect(tab('Heroes').textContent).toContain('Soon');
    expect(text('.colls-meter-num')).toBe('8 / 762'); // 2026-11-27 skins batches 22-27 (+220 minion skins). 2026-11-20: Ascenteerianologist (+1). // 2026-11-13 Dad Kobebe (+1). 2026-11-13: the batch of eight hero attacks (+8). 2026-11-12 skins batch 20 (+3 hero skins, all hidden with the category, so no change). 2026-11-12 frames batch 10 (+6), skins batch 19 (+1). 2026-11-12 skins batch 18 (+9), card plates batch 8 (+7). 2026-11-12 skins batch 17 (+5). 2026-11-11 skins batch 16 (+55). 2026-11-11 skins batch 15 (+58). 2026-11-11 titles batch 2 (+8). 2026-11-02 skins batch 14 (+8)
  });
});
