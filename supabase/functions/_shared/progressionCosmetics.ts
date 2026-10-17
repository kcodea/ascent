// GENERATED from packages/progression/src/cosmetics.ts by `npm run progression:shared`. DO NOT EDIT.
// Edit the source, re-run the script, and commit both; sharedArtifact.test.ts fails CI when they drift.
// Deno module (the submit-progression Edge Function imports it); the repo's tsc/eslint skip supabase/**.
/**
 * ACCOUNT PROGRESSION: the COSMETIC CATALOG and the crate roll (2026-09-28, handoff §5 / §6.5 / §13).
 *
 * Every level grants one sealed crate (Level 1: the Welcome Crate on enrollment). The reward is chosen when the
 * crate is OPENED, never when it is earned, so a banked crate benefits from later catalog additions. A crate never
 * gives an item the player already owns; when nothing eligible is left the crate stays sealed (`pool_exhausted`),
 * never converted to anything. Earn only: no purchases, keys, currency or rerolls.
 *
 * THIS FILE IS THE CATALOG AS DATA. It is shaped for every category in handoff §5.3 (announcer, hero skin, minion
 * skin, title, hero attack, board, music). `title` shipped first (owner 2026-09-27: "let's just do 15 titles to
 * start"); `hero_skin` and `minion_skin` joined on 2026-09-28 (the first two of each). The rest are switched off
 * here AND in the SQL seed, so the owner's art slots in later as new rows plus a flag flip, with no schema change.
 *
 * CODE IS THE SOURCE OF TRUTH (owner 2026-09-28: "yeah let's do option 2 then to make it automated when i add
 * skins"). The database copy is written by `sync_cosmetic_catalog` from `catalogSyncPayload()` (below), which the
 * `progression-inventory` Edge Function runs on its first request per cold start. Add an item here, or set
 * `active: false`, then `npm run progression:shared`, merge and deploy that one function: no SQL. An item REMOVED
 * from this file is marked inactive in the database, never deleted.
 *
 * THE KILL SWITCH (owner 2026-09-28: "we need to have the ability to remove any rewards from the game if we want
 * to"). An item with `active: false`, or any item of a category with `enabled: false`, is RETIRED: it leaves the
 * crate pool, the Collection hides it, and every renderer falls back to default art even when a player has it
 * equipped or an old snapshot names it (`isCosmeticLive`). The owner's EMERGENCY switch is the database's
 * `admin_off` column (one SQL line; the sync never touches it), which the client reads as part of the server's
 * catalog state (`setServerCatalogState`). Ownership is never deleted, so flipping either back restores the item
 * exactly as it was. The one-liners are in docs/devlog/2026-09-28-skins-v1.md.
 *
 * THE SQL COPY. The database controls eligibility and ownership: `cosmetic_categories` + `cosmetic_catalog` are
 * seeded from this file by the 2026-09-28 migration, and `progression_crate_pick` (2026-09-29) carries the rarity odds as
 * constants.
 * `sqlParity.test.ts` parses the seed and the constants back out of the migration and fails CI on any drift.
 * Display names live only here (ids are permanent; a rename is a one-line client change).
 *
 * DEPENDENCY-FREE: generated verbatim into supabase/functions/_shared/progressionCosmetics.ts for the Deno Edge
 * Functions (`npm run progression:shared`).
 */

// ── Categories, rarities, weights ─────────────────────────────────────────────────────────────────────────

export const COSMETIC_CATEGORIES = ['announcer', 'hero_skin', 'minion_skin', 'title', 'hero_attack', 'board', 'music', 'portrait_frame', 'emote', 'card_plate'] as const;
export type CosmeticCategory = typeof COSMETIC_CATEGORIES[number];

export const COSMETIC_RARITIES = ['common', 'rare', 'epic', 'legendary', 'ancient'] as const;
export type CosmeticRarity = typeof COSMETIC_RARITIES[number];

/**
 * THE PUBLISHED CRATE ODDS, in percent (sum 100). A crate first rolls a rarity at these fixed odds, then picks an
 * unowned item of that rarity (owner 2026-09-29: "go to C", then "make it 50/30/15/5 though"). They never move as
 * items are added, so they are safe to show players. The ONE copy in TS; `progression_crate_pick` in
 * supabase/migrations/2026-10-02-ancient-rarity.sql carries them as constants, and sqlParity.test.ts
 * fails CI on any drift. Rarity is presentation and pacing, never power.
 * ANCIENT (owner 2026-10-02: "i added a new rarity -> Ancient. can you wire that up so we can have skins that are of
 * ancient rarity? these will be a 3% drop rate") ranks ABOVE Legendary; the odds moved 50/30/15/5 -> 35/31/22/9/3.
 */
export const CRATE_RARITY_ODDS: Readonly<Record<CosmeticRarity, number>> = Object.freeze({ common: 35, rare: 31, epic: 22, legendary: 9, ancient: 3 });

/** Player-facing rarity labels. */
export const RARITY_LABELS: Readonly<Record<CosmeticRarity, string>> = Object.freeze({ common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', ancient: 'Ancient' });

export interface CosmeticCategoryDef {
  id: CosmeticCategory;
  /** Player-facing section name (Collection). */
  label: string;
  /** Handoff §5.4 category weight. KEPT FOR LATER, UNUSED BY THE ROLL since 2026-09-29 (owner: "yeah equal chance": every
   *  item inside a rolled rarity is equally likely). Still synced to the database with the catalog. */
  weight: number;
  /** The feature flag: a disabled category never drops from a crate and is hidden in the Collection. */
  enabled: boolean;
  /** What an item of this category targets: nothing (one global slot), a hero id, or a card id. */
  target: 'global' | 'hero' | 'card';
}

export const COSMETIC_CATEGORY_DEFS: Readonly<Record<CosmeticCategory, CosmeticCategoryDef>> = Object.freeze({
  announcer:   { id: 'announcer',   label: 'Announcers',        weight: 10, enabled: true,  target: 'global' },
  hero_skin:   { id: 'hero_skin',   label: 'Heroes',            weight: 20, enabled: true,  target: 'hero' },
  minion_skin: { id: 'minion_skin', label: 'Minions',           weight: 35, enabled: true,  target: 'card' },
  title:       { id: 'title',       label: 'Titles',            weight: 10, enabled: true,  target: 'global' },
  // Owner 2026-09-28: "the new blast attack is going to be a cosmetic unlock, not a new default". Live since then.
  hero_attack: { id: 'hero_attack', label: 'Attack Animations', weight: 15, enabled: true,  target: 'global' },
  board:       { id: 'board',       label: 'Boards',            weight: 5,  enabled: false, target: 'global' },
  music:       { id: 'music',       label: 'Music',             weight: 5,  enabled: false, target: 'global' },
  // Owner 2026-10-01: "we're adding portrait skins ... we want this to replace the default portrait png when a skin is
  // applied." The ring around YOUR hero portrait, account-wide (any hero). Weight 10 like titles (kept for later: the
  // roll has ignored category weights since roll version 3).
  portrait_frame: { id: 'portrait_frame', label: 'Portrait Frames', weight: 10, enabled: true, target: 'global' },
  // Owner 2026-10-13: "Emotes are a new COSMETIC type in Collections". A painted speech bubble your hero says in a game,
  // seen by you and by the players who meet your recorded run. Account-wide (no hero or card target); the loadout
  // holds FOUR of them, one row per menu position (`EMOTE_SLOT_COUNT`). Weight 10 like titles (kept for later).
  emote:       { id: 'emote',       label: 'Emotes',            weight: 10, enabled: true,  target: 'global' },
  // Owner 2026-10-14: "i want to test a new cosmetic: card plates", then "Turn Aquarium Rocks into a real equippable card
  // plate cosmetic". The plate behind YOUR minion cards, account-wide, seen by the players you meet. Weight 10 like
  // titles (kept for later).
  card_plate:  { id: 'card_plate',  label: 'Card Plates',       weight: 10, enabled: true,  target: 'global' },
});

/**
 * Bump when the roll changes (odds, weights, fallback). Stored on every opened crate.
 * 1 = one weighted draw over every eligible item (rarity weight x category weight), 2026-09-28.
 * 2 = FIXED rarity odds first, then an item within that rarity (category weights), 2026-09-29.
 * 3 = FIXED rarity odds first, then an EQUAL chance for every eligible item of that rarity, 2026-09-29.
 * 4 = version 3 with FIVE rarities (Ancient above Legendary) at 35/31/22/9/3, 2026-10-02.
 */
export const CRATE_ROLL_VERSION = 4;

// ── The catalog ───────────────────────────────────────────────────────────────────────────────────────────

/** How an item is acquired. Exactly one source per item (handoff §5.2); only `crate` items ever drop. A `starter`
 *  item (owner 2026-10-13, the first four emotes) is owned by EVERY player from the start, signed in or not: it is
 *  never stored as an ownership row, never drops, and the equip SQL treats it as owned (`isStarterCosmetic`). */
export type CosmeticAcquisition =
  | { type: 'crate' }
  | { type: 'starter' }
  | { type: 'level_milestone'; level: number }
  | { type: 'achievement'; id: string }
  | { type: 'event'; id: string };

export interface CosmeticDef {
  /** PERMANENT. Never reuse or rename an id; rename the `name` instead. */
  id: string;
  category: CosmeticCategory;
  /** Player-facing. */
  name: string;
  rarity: CosmeticRarity;
  /** Hero / minion skins: the stable hero id or card id (never a display name). */
  target?: { type: 'hero' | 'card'; id: string };
  acquisition: CosmeticAcquisition;
  /** Asset keys → paths (the owner's art slots in here). Titles are text and need none. A hero attack names the
   *  animation it plays in `style` (a style this client does not know plays Classic). */
  assets: Readonly<Record<string, string>>;
  /** False = retired: never acquired again, never removed from an owner. */
  active: boolean;
}

/** Owner 2026-09-27: the MVP's Level 2 title. A level milestone, so it is never in the crate pool. */
export const ALPHA_TESTER_TITLE_ID = 'alpha_tester';

const title = (id: string, name: string, rarity: CosmeticRarity): CosmeticDef =>
  ({ id, category: 'title', name, rarity, acquisition: { type: 'crate' }, assets: {}, active: true });

/**
 * A SKIN: one item that replaces the art of ONE hero (`hero_skin`) or ONE card (`minion_skin`), by stable id.
 * `assets.art` is the key of the in-repo art (`packages/ui/src/art/skins/<key>.webp`); `assets.master` is the
 * owner's master filename under `C:/Game Assets/Ascent Art/Skins/`, which is how `npm run art:wire` attributes
 * the file (strict, never guessed).
 */
const skin = (id: string, category: 'hero_skin' | 'minion_skin', name: string, rarity: CosmeticRarity, targetId: string, master: string): CosmeticDef =>
  ({ id, category, name, rarity, target: { type: category === 'hero_skin' ? 'hero' : 'card', id: targetId }, acquisition: { type: 'crate' }, assets: { art: id, master }, active: true });

/**
 * A HERO ATTACK: one account-wide item (target `global`, no hero or card) that changes how YOUR hero lands the
 * post-combat blow, seen by you and by the player you hit. `assets.style` is the animation id the client plays.
 */
const heroAttack = (id: string, name: string, rarity: CosmeticRarity, style: string): CosmeticDef =>
  ({ id, category: 'hero_attack', name, rarity, acquisition: { type: 'crate' }, assets: { style }, active: true });

/**
 * A PORTRAIT FRAME (owner 2026-10-01: "we're adding portrait skins ... we want this to replace the default portrait png
 * when a skin is applied"). One account-wide item (target `global`) that replaces the ring around YOUR hero portrait on
 * every surface, seen by you and, through "Show opponent cosmetics", by the players you meet. `assets.art` is the key
 * of the in-repo ring (`packages/ui/src/art/frames/skins/<key>.webp`, measured + written by `npm run art:frames`);
 * `assets.master` is the owner's master under `C:/Game Assets/Ascent Art/Skins/Portraits/`.
 */
const portraitFrame = (id: string, name: string, rarity: CosmeticRarity, master: string): CosmeticDef =>
  ({ id, category: 'portrait_frame', name, rarity, acquisition: { type: 'crate' }, assets: { art: id, master }, active: true });

/**
 * AN ANNOUNCER (owner 2026-10-11: "i want to create a new announcer voice - the current one is the default. this will
 * be offered as a reward in collections"). One account-wide item (target `global`) that swaps the voice calling YOUR
 * games; only you hear it, so it never rides a run snapshot. `assets.pack` is the folder its clips live in
 * (`apps/web/public/announcer/<pack>/<line>.mp3`): one file per default line, same file names. No item equipped = the
 * default announcer.
 */
const announcer = (id: string, name: string, rarity: CosmeticRarity, pack: string): CosmeticDef =>
  ({ id, category: 'announcer', name, rarity, acquisition: { type: 'crate' }, assets: { pack }, active: true });

/**
 * AN EMOTE (owner 2026-10-13: "Emotes are a new COSMETIC type in Collections ... Unlock source: crates, plus starter
 * emotes everyone owns"). One account-wide item: a painted speech bubble that pops beside your hero portrait when you
 * use it in a game (right-click your portrait). `assets.art` is the key of the in-repo bubble
 * (`packages/ui/src/art/emotes/<key>.webp`); `assets.master` is the owner's master under
 * `C:/Game Assets/Ascent Art/Emotes/`. Since 2026-10-15 every emote is a CRATE drop (owner: "remove all emotes as
 * 'given' and put them in various loot tiers between rare and legendary") except ONE starter, Zen Brian (owner, the
 * same day: "give all players the zen brian emote"), which every player owns from the start.
 */
const emote = (id: string, name: string, rarity: CosmeticRarity, master: string, acquisition: CosmeticAcquisition = { type: 'crate' }): CosmeticDef =>
  ({ id, category: 'emote', name, rarity, acquisition, assets: { art: id, master }, active: true });

/**
 * A CARD PLATE (owner 2026-10-14: "Turn Aquarium Rocks into a real equippable card plate cosmetic, with its own
 * darkening settings, and leave the standard plates untouched"). One account-wide item (target `global`) that replaces
 * the plate behind every one of YOUR minion cards, whatever its tribe ("replace all plates"), seen by you and, through
 * "Show opponent cosmetics", by the players you meet. Never on a GILDED card ("nothing should ever changed for gilded
 * cards"). `assets.art` is the key of the in-repo plate (`apps/web/public/frames/plates/<key>.webp`, same 800x1244
 * body as the standard plates); its text-panel darkening lives beside the art in `packages/ui/src/cardPlate/`.
 * `assets.master` is the owner's master in `Reference Art/Card Backplates/` (owner 2026-10-15: "in this folder will be
 * where I provide all the custom backplates that you can unlock from opening chests ... every other one should be a
 * legendary reward unless explicitly specified"; Standard.png and Gilded.png there are the base plates, not rewards).
 */
const cardPlate = (id: string, name: string, rarity: CosmeticRarity, master: string): CosmeticDef =>
  ({ id, category: 'card_plate', name, rarity, acquisition: { type: 'crate' }, assets: { art: id, master }, active: true });

/**
 * HERO TITLES (owner 2026-09-29: "the hero's title is granted at 3 wins with a hero, then the mastery of that title is
 * after 10 wins with that hero. the master title should be a golden plate and embroidered text"). Two items per
 * playable hero, both ACHIEVEMENT-sourced (never in a crate):
 *   `title_hero_<id>`         the hero's title, from `hero.<id>.titled` (3 Ranked 1sts). Epic; the normal title look.
 *   `title_hero_<id>_master`  the SAME name as a golden plate with embroidered text, from `hero.<id>.mastery` (10).
 * The master UPGRADES the title in place: it supersedes the base one everywhere a player picks or sees their titles
 * (`titleShelf`), the settlement swaps a worn base title for its master the moment it is earned, and every renderer
 * paints a master title as the plate (`isMasterTitle`).
 *
 * Names follow the owner's pattern (Warden "Warded", Gambler "Gambling Addict", Albus "Albus Student"); the rest come
 * from the 2026-09-28 achievements design pass. One per playable hero, in `ACHIEVEMENT_HEROES` order (achievements.ts;
 * cosmetics.test.ts fails CI when they drift). This file stays the dependency-free leaf, so the list lives here.
 */
export const HERO_TITLE_NAMES: ReadonlyArray<readonly [heroId: string, title: string]> = Object.freeze([
  ['warden', 'Warded'], ['indy', 'Masterworker'], ['myra', 'Going Once'], ['soren', 'Reclaimed'], ['nadja', 'Wishing Well'],
  ['cassen', 'On Commission'], ['drakko', 'Drum Major'], ['robin', 'Merry Outlaw'], ['darah', 'Switcheroo'], ['risen', 'Risen Again'],
  ['gildmaster', 'Gildwright'], ['discodan', 'Groovy'], ['brackus', 'Summit Seeker'], ['baggerben', 'All In'], ['hermithank', 'Penny Pincher'],
  ['runesmith', 'Runecarver'], ['runeguard', 'Runebound'], // re-activated 2026-10-01; placeholder names for the owner
  ['repete', 'Deja Vu'], ['gorr', 'Four Peater'], ['kindness', 'Kind Soul'], ['merrin', 'Pocket Mage'], ['gambler', 'Gambling Addict'],
  ['xerox', 'Paper Jam'], ['frank', 'Bargain Hunter'],
  ['pete', 'Top Banana'], ['flint', 'Company Man'], ['vale', 'Ambassador'], // re-enabled 2026-10-15; placeholder names for the owner
  ['quillen', 'Archivist'], ['hunch', 'Bookworm'], ['emeraldwarden', 'Vanguard'],
  ['underdweller', 'Soulkeeper'], ['albus', 'Albus Student'], ['flash', 'Speedrunner'], ['midas', 'Midas Touched'], ['juggler', 'Juggling Act'], ['membrance', 'Total Recall'], ['bram', 'Compound Interest'],
  ['cia', 'High Roller'], ['keshi', 'Crownbearer'], ['rayse', 'Thornbound'], ['gorun', 'Bladesworn'], ['mimic', 'Not a Mimic'],
] as const);

/** The catalog id of a hero's title, and of its master (golden plate) version. Permanent. */
export const heroTitleId = (heroId: string): string => `title_hero_${heroId}`;
export const heroMasterTitleId = (heroId: string): string => `title_hero_${heroId}_master`;

export const HERO_TITLE_COSMETICS: readonly CosmeticDef[] = Object.freeze(HERO_TITLE_NAMES.flatMap(([heroId, name]): CosmeticDef[] => [
  { id: heroTitleId(heroId), category: 'title', name, rarity: 'epic', acquisition: { type: 'achievement', id: `hero.${heroId}.titled` }, assets: {}, active: true },
  { id: heroMasterTitleId(heroId), category: 'title', name, rarity: 'legendary', acquisition: { type: 'achievement', id: `hero.${heroId}.mastery` }, assets: {}, active: true },
]));

/**
 * THE LAUNCH CATALOG. Owner 2026-09-27: "let's just do 15 titles to start." 7 Common, 5 Rare, 2 Epic,
 * 1 Legendary. Names are placeholders for the owner to rename (ids stay).
 */
export const COSMETICS: readonly CosmeticDef[] = Object.freeze([
  { id: ALPHA_TESTER_TITLE_ID, category: 'title', name: 'Alpha Tester', rarity: 'rare', acquisition: { type: 'level_milestone', level: 2 }, assets: {}, active: true },
  title('title_wanderer', 'Wanderer', 'common'),
  title('title_rune_reader', 'Rune Reader', 'common'),
  title('title_coin_counter', 'Coin Counter', 'common'),
  title('title_lantern_bearer', 'Lantern Bearer', 'common'),
  title('title_hearthkeeper', 'Hearthkeeper', 'common'),
  title('title_warband_captain', 'Warband Captain', 'common'),
  title('title_board_builder', 'Board Builder', 'common'),
  title('title_stormcaller', 'Stormcaller', 'rare'),
  title('title_star_chaser', 'Star Chaser', 'rare'),
  title('title_grave_whisperer', 'Grave Whisperer', 'rare'),
  title('title_ironbeard', 'Ironbeard', 'rare'),
  title('title_spiritbound', 'Spiritbound', 'rare'),
  title('title_kingbreaker', 'Kingbreaker', 'epic'),
  title('title_voice_of_the_deep', 'Voice of the Deep', 'epic'),
  title('title_the_unbroken', 'The Unbroken', 'legendary'),
  // SKIN RARITY COMES FROM THE ART FOLDER (owner 2026-10-01: "i also put all these skins into rarity folders which is
  // how i'll do it from now on"). Each master sits in C:/Game Assets/Ascent Art/Skins/<Minion|Hero> Skins/<Rarity>/,
  // and that folder is the rarity; a suffix in the filename ("SkinRare") is stale and ignored. skinRarityFolders.test.ts
  // checks every entry against the folder when the art is on disk. The per-batch rarity notes below are history.
  // SKINS (owner 2026-09-28: "let's use these 2 black belt brian skins as our first 2 skin concepts" and "these 2
  // hero skins as our first 2 hero skin concepts"). Names and rarities are placeholders for the owner to rename.
  // Owner 2026-09-28 renamed the masters by rarity (Skin1 -> SkinRare, Skin2 -> SkinEpic; same art) and added a
  // Legendary: "i added a legendary black belt brian skin and renaemd skins to match their rarity". The name is a
  // placeholder for the owner to rename.
  skin('skin_blackbelt_1', 'minion_skin', 'Sheriff Brian', 'common', 'blackbelt', 'BlackBeltBrianSkinRare.png'),
  skin('skin_blackbelt_2', 'minion_skin', 'Glitch Brian', 'epic', 'blackbelt', 'BlackBeltBrianSkinEpic.png'),
  skin('skin_blackbelt_3', 'minion_skin', 'Grandmaster Brian', 'legendary', 'blackbelt', 'BlackBeltBrianSkinLegendary.png'),
  // Owner 2026-09-28: "put the bellringer voss skin in too". Epic per the owner's filename; the name is a placeholder.
  skin('skin_bellringer_1', 'minion_skin', 'Clocktower Voss', 'epic', 'n2_bellringer', 'BellringerVossSkinEpic.png'),
  // Batch 2. Owner 2026-09-28: "i added some skins here: can you wire those up now?" (Skins/Minion Skins). Rarity per
  // the owner's filenames; every name is a placeholder for the owner to rename (the ids stay). Drakko is the MINION
  // (card id drummer), not the hero. The Steward of Spells master is named "SpellSteward".
  skin('skin_blackbelt_4', 'minion_skin', 'Sketchbook Brian', 'rare', 'blackbelt', 'BlackBeltBrianCommonSkin.png'),
  skin('skin_drummer_1', 'minion_skin', 'Rock Star Drakko', 'epic', 'drummer', 'DrakkoSkinRare.png'),
  skin('skin_drummer_2', 'minion_skin', 'Crowd Surf Drakko', 'rare', 'drummer', 'DrakkoSkinEpic.png'),
  skin('skin_drummer_3', 'minion_skin', 'Cashier Drakko', 'legendary', 'drummer', 'DrakkoSkinEpic2.png'),
  skin('skin_jenkins_1', 'minion_skin', 'Joyride Jensen & Fi', 'common', 'jenkins', 'JensenAndFiSkinRare.png'),
  skin('skin_joker_1', 'minion_skin', 'Lounge Act Joker', 'rare', 'joker', 'MysteriousJokerSkinRare.png'),
  skin('skin_nimbus_1', 'minion_skin', 'Storm Front Nimbus', 'rare', 'nimbus', 'NimbusSkinRare.png'),
  skin('skin_paragon_1', 'minion_skin', 'Superfan Paragon', 'rare', 'n2_paragon', 'ParagonSkinRare.png'),
  skin('skin_stewardofspells_1', 'minion_skin', 'Potion Stand Steward', 'common', 'stewardofspells', 'SpellStewardSkinEpic.png'),
  skin('skin_sylus_1', 'minion_skin', 'Slam Dunk Sylus', 'epic', 'sylus', 'SylusSkinRare.png'),
  // ANCIENT (owner 2026-10-02 moved this one from Legendary to the new Ancient rarity; owned copies stay owned).
  skin('skin_sylus_2', 'minion_skin', 'Tee Time Sylus', 'ancient', 'sylus', 'SylusSkinLegendary.png'),
  skin('skin_venom_1', 'minion_skin', 'Candy Cane Venom', 'legendary', 'venom', 'VenomSkinEpic.png'),
  skin('skin_zyff_1', 'minion_skin', 'Double Agent Zyff', 'common', 'zyff', 'ZyffSkinRare.png'),
  // Batch 3. Owner 2026-09-29: "added a few more hero and minion skins - i want to name them appropriately and then
  // decide rarities". Rarities are the owner's; names are matched to the art. King Oona is the Set 2 card (b2_oona).
  skin('skin_oona_1', 'minion_skin', 'Rooks Oona', 'epic', 'b2_oona', 'RooksOona.png'),
  skin('skin_sylus_3', 'minion_skin', 'Stencil Sylus', 'rare', 'sylus', 'StencilSylus.png'),
  skin('skin_seaurchin_1', 'minion_skin', 'Mace Urchin', 'epic', 'seaurchin', 'MaceUrchin.png'),
  skin('skin_buddy_1', 'minion_skin', 'Magician Buddy Buddy', 'legendary', 'buddy', 'MagicianBuddyBuddyEpic.png'),
  // Batch 4. Owner 2026-09-30: "can you wire all the new skins that i added to the folder". Rarity from the filename
  // suffix; the two minion masters with none (Prophet Pimm, Sketch Drakko) took the owner's random draw between Common
  // and Epic. Names come from the filenames; the "<Character>Skin<Rarity>" masters were named from the art. Scalefeather
  // is the card d2_chronicler (d2_scalefeather is Mushy); Lavish Date is Cheap Date (k_pouchpincher); Edward is Edward
  // Keg-hands; Orin is Oathshield Orin. Chimerus (the Dragon quest reward) and Baal (forged by the Rune of Baal) are
  // token-flagged because the Shop never offers them, but they are real minions a player puts on the board.
  skin('skin_arnold_1', 'minion_skin', 'Beefy Arnold', 'common', 'dw_arnold', 'BeefyArnoldCommon.png'),
  skin('skin_recaller_1', 'minion_skin', 'Blown Glass Recaller', 'rare', 'd2_recaller', 'BlownGlassRecallerEpic.png'),
  skin('skin_recaller_2', 'minion_skin', 'Magma Recaller', 'epic', 'd2_recaller', 'MagmaRecallerRare.png'),
  skin('skin_recaller_3', 'minion_skin', 'Starform Recaller', 'common', 'd2_recaller', 'StarformRecallerRare.png'),
  skin('skin_pimm_1', 'minion_skin', 'Bouncer Pimm', 'common', 'dw_pimm', 'BouncerPimmRare.png'),
  skin('skin_pimm_2', 'minion_skin', 'Prophet Pimm', 'legendary', 'dw_pimm', 'ProphetPimm.png'),
  skin('skin_chimerus_1', 'minion_skin', 'Crimson Chimerus', 'rare', 'chimerus', 'ChimerusSkinRare.png'),
  skin('skin_chronicler_1', 'minion_skin', 'Chrome Scalefeather', 'legendary', 'd2_chronicler', 'ChromeScalefeatherRare.png'),
  skin('skin_chronicler_2', 'minion_skin', 'Mecha Scalefeather', 'common', 'd2_chronicler', 'MechaScalefeatherEpic.png'),
  // ANCIENT (owner 2026-10-02 moved this one from Legendary to the new Ancient rarity; owned copies stay owned).
  skin('skin_edward_1', 'minion_skin', 'Edward Colada Hands', 'ancient', 'dw_edward', 'EdwardColadaHandsLegendary.png'),
  skin('skin_baal_1', 'minion_skin', 'Epic Baal', 'rare', 'dw_baal', 'EpicBaalRare.png'),
  skin('skin_pouchpincher_1', 'minion_skin', 'Lavish Date', 'common', 'k_pouchpincher', 'LavishDateEpic.png'),
  skin('skin_buddy_2', 'minion_skin', 'Portal Buddy', 'legendary', 'buddy', 'PortalBuddyLegendary.png'),
  skin('skin_buddy_3', 'minion_skin', 'Sketch Buddy', 'epic', 'buddy', 'SketchBuddyLegendary.png'),
  skin('skin_drummer_4', 'minion_skin', 'Sketch Drakko', 'epic', 'drummer', 'SketchDrakko.png'),
  skin('skin_orin_1', 'minion_skin', 'Thor Orin', 'epic', 'dw_orin', 'ThorOrinEpic.png'),
  // Batch 5. Owner 2026-09-30: "i added more skins". Names come from the filenames; three over the 20-character cap
  // were shortened (Lightblade Sword, Soul Surf Wayfinder, Hexhunter Wardkeeper). Rarities are the owner's random draw
  // between Common and Epic. Spellsword is Coppercoat Spellsword (n2_spellsword), Butcher is Contract Butcher
  // (dm_butcher), Chorusdrake is Chorus Drake (d2_chorus), Scalefeather is d2_chronicler.
  skin('skin_nimbus_2', 'minion_skin', 'Cotton Candy Nimbus', 'legendary', 'nimbus', 'CottonCandyNimbus.png'),
  skin('skin_nimbus_3', 'minion_skin', 'Dark Nimbus', 'epic', 'nimbus', 'DarkNimbus.jpg'),
  skin('skin_nimbus_4', 'minion_skin', 'Smog Nimbus', 'rare', 'nimbus', 'SmogNimbus.png'),
  skin('skin_spellsword_1', 'minion_skin', 'Lightblade Sword', 'rare', 'n2_spellsword', 'LightbladeSpellsword.png'),
  skin('skin_chronicler_3', 'minion_skin', 'Mascot Scalefeather', 'rare', 'd2_chronicler', 'MascotScalefeather.png'),
  skin('skin_joker_2', 'minion_skin', 'Mime Joker', 'rare', 'joker', 'MimeJoker.png'),
  skin('skin_butcher_1', 'minion_skin', 'Pastry Chef Butcher', 'epic', 'dm_butcher', 'PastryChefButcher.png'),
  skin('skin_chorus_1', 'minion_skin', 'Quartet Chorusdrake', 'rare', 'd2_chorus', 'QuartetChorusdrake.jpg'),
  skin('skin_wayfinder_1', 'minion_skin', 'Soul Surf Wayfinder', 'common', 'wayfinder', 'SoulSurferWayfinder.png'),
  skin('skin_seaurchin_2', 'minion_skin', 'Star Urchin', 'rare', 'seaurchin', 'StarUrchin.png'),
  skin('skin_wardkeeper_1', 'minion_skin', 'Hexhunter Wardkeeper', 'common', 'dw_wardkeeper', 'WitchHunterWardkeeper.png'),
  // Batch 6. Owner 2026-10-01: "i added a bunch of art/portrait arts etc, can you make sure all get added". Rarity is
  // the folder each master sits in. Names come from the filenames; two over the 20-character cap were shortened
  // (Amber/Static Deepvein, Sea Dragon Wayfinder). Deepvein Tender is k_deepvein. The three "Commander" masters are
  // Commander Warpath (d2_blazingkeeper): CyberneticWarpath names it, and Frost/Nature Commander are recolours of
  // Warpath's own art (the winged dragon with the sun staff), not Commander Impala (the Set 1 imp).
  skin('skin_deepvein_1', 'minion_skin', 'Amber Deepvein', 'common', 'k_deepvein', 'AmberDeepveinTender.png'),
  skin('skin_deepvein_2', 'minion_skin', 'Static Deepvein', 'common', 'k_deepvein', 'StaticDeepveinTender.png'),
  skin('skin_wardkeeper_2', 'minion_skin', 'Frost Wardkeeper', 'common', 'dw_wardkeeper', 'FrostWardkeeper.png'),
  skin('skin_wayfinder_2', 'minion_skin', 'Infernal Wayfinder', 'common', 'wayfinder', 'InfernalWayfinder.png'),
  skin('skin_wayfinder_3', 'minion_skin', 'Sea Dragon Wayfinder', 'rare', 'wayfinder', 'WaterdragonWayfinder.png'),
  skin('skin_spellsword_2', 'minion_skin', 'Timeworn Spellsword', 'rare', 'n2_spellsword', 'TimewornSpellsword.png'),
  skin('skin_blazingkeeper_1', 'minion_skin', 'Frost Commander', 'rare', 'd2_blazingkeeper', 'FrostCommander.png'),
  skin('skin_blazingkeeper_2', 'minion_skin', 'Nature Commander', 'epic', 'd2_blazingkeeper', 'NatureCommander.png'),
  skin('skin_blazingkeeper_3', 'minion_skin', 'Cybernetic Warpath', 'legendary', 'd2_blazingkeeper', 'CyberneticWarpath.png'),
  skin('skin_albus_1', 'hero_skin', 'Surf Day Albus', 'epic', 'albus', 'Albus1.png'),
  skin('skin_warden_1', 'hero_skin', 'Bath Day Warden', 'epic', 'warden', 'Warden1.png'),
  skin('skin_frank_1', 'hero_skin', 'Armourer Frank', 'common', 'frank', 'ArmourerFrank.png'),
  // Batch 4 hero skins (owner 2026-09-30). Ayse is the hero cia, Braum is bram. The eight masters with no rarity in
  // the name took the owner's random draw between Common and Epic.
  skin('skin_cia_1', 'hero_skin', 'Waitress Ayse', 'common', 'cia', 'AyseSkinCommon.png'),
  skin('skin_cia_2', 'hero_skin', 'Raptor Rider Ayse', 'common', 'cia', 'AyseSkinRare.png'),
  skin('skin_frank_2', 'hero_skin', 'Black Friday Frank', 'epic', 'frank', 'BlackFridayFrank.jpg'),
  skin('skin_frank_3', 'hero_skin', 'Coaster Frank', 'common', 'frank', 'CoasterFrank.png'),
  skin('skin_bram_1', 'hero_skin', 'Treasure Hoard Braum', 'rare', 'bram', 'BraumSkinRare.png'),
  // Skins batch 8 (owner 2026-10-03): the owner moved DarahSkinEpic and HunchSkinRare into Hero Skins/Ancient/; the
  // folder is the rarity, so both are Ancient now (owned copies stay owned, R-PROG-SKINS-11).
  skin('skin_darah_1', 'hero_skin', 'Leg Day Darah', 'ancient', 'darah', 'DarahSkinEpic.png'),
  skin('skin_darah_2', 'hero_skin', 'Rose Vortex Darah', 'rare', 'darah', 'DarahSkinRare.png'),
  skin('skin_emeraldwarden_1', 'hero_skin', 'Birdsong Emerald', 'epic', 'emeraldwarden', 'EmeraldWardenSkinRare.png'),
  skin('skin_hunch_1', 'hero_skin', 'Dance Night Hunch', 'ancient', 'hunch', 'HunchSkinRare.png'),
  skin('skin_keshi_1', 'hero_skin', 'Keshi the Cityguard', 'common', 'keshi', 'KeshiTheCityguard.png'),
  skin('skin_keshi_2', 'hero_skin', 'Pop Star Keshi', 'epic', 'keshi', 'PopStarKeshi.png'),
  skin('skin_soren_1', 'hero_skin', 'King Soren', 'epic', 'soren', 'KingSorenEpic.png'),
  skin('skin_soren_2', 'hero_skin', 'Mastered Soren', 'legendary', 'soren', 'MasteredSoren.png'),
  skin('skin_brackus_1', 'hero_skin', 'Master Brakkus', 'legendary', 'brackus', 'MasterBrakkus.png'),
  skin('skin_brackus_2', 'hero_skin', 'Young Brakkus', 'common', 'brackus', 'YoungBrakkus.png'),
  skin('skin_robin_1', 'hero_skin', 'Ninja Robin', 'rare', 'robin', 'NinjaRobin.png'),
  // Batch 5 hero skin (owner 2026-09-30: "i added more skins"). Rare by the owner's random draw.
  skin('skin_indy_1', 'hero_skin', 'Influencer Indy', 'epic', 'indy', 'InfluencerIndy.png'),
  // Batch 7 hero skins (owner 2026-10-01: "i added a bunch of art/portrait arts etc, can you make sure all get added").
  // Rarity = the Hero Skins rarity folder. IronGuardian is the Guardian hero (id runeguard, re-activated 2026-10-01).
  skin('skin_merrin_1', 'hero_skin', 'Goth Merrin', 'epic', 'merrin', 'GothMerrin.png'),
  skin('skin_runeguard_1', 'hero_skin', 'Iron Guardian', 'epic', 'runeguard', 'IronGuardian.png'),
  skin('skin_robin_2', 'hero_skin', 'Robin Hood', 'rare', 'robin', 'RobinHood.png'),
  // Skins batch 8 (owner 2026-10-03: "ive also added many skins to the game's collections. can you add those all in").
  // Rarity = the Hero Skins rarity folder. Names come from the filenames. LordOfDeath and LordCallen are Lord of the
  // Risen (id risen): both wear his crown, his purple-and-gold armour and his blue-flame sword (checked against the
  // hero art). Young Tradesman is the Tradesman (id hermithank); Auctioneer Sweeney is the Auctioneer (id myra).
  skin('skin_hermithank_1', 'hero_skin', 'Young Tradesman', 'rare', 'hermithank', 'YoungTradesman.png'),
  skin('skin_quillen_1', 'hero_skin', 'Author Quillen', 'legendary', 'quillen', 'AuthorQuillen.png'),
  skin('skin_rayse_1', 'hero_skin', 'Goth Rayse', 'legendary', 'rayse', 'GothRayse.png'),
  skin('skin_risen_1', 'hero_skin', 'Lord of Death', 'legendary', 'risen', 'LordOfDeath.png'),
  skin('skin_midas_1', 'hero_skin', 'Midas and Melon', 'legendary', 'midas', 'Midas and Melon.png'),
  skin('skin_myra_1', 'hero_skin', 'Auctioneer Sweeney', 'ancient', 'myra', 'AuctioneerSweeney.png'),
  skin('skin_nadja_1', 'hero_skin', 'Goth Nadja', 'ancient', 'nadja', 'GothNadja.png'),
  skin('skin_risen_2', 'hero_skin', 'Lord Callen', 'ancient', 'risen', 'LordCallen.png'),
  skin('skin_merrin_2', 'hero_skin', 'Merrin Sweeney', 'ancient', 'merrin', 'MerrinSweeney.png'),
  skin('skin_nadja_2', 'hero_skin', 'Nadja Sweeney', 'ancient', 'nadja', 'NadjaSweeney.png'),
  skin('skin_rayse_2', 'hero_skin', 'Rayse Sweeney', 'ancient', 'rayse', 'RayseSweeney.png'),
  // Skins batch 9 (owner 2026-10-07: "yes add the new art to the catalog"). Rarity = the Minion Skins rarity folder
  // (both in Rare/). Names come from the filenames. Both are Chorus Drake (d2_chorus), matched by the art: the same
  // three stacked singing heads, ring of music notes, chest gem and pose as the card's own art, repainted (a sandstone
  // canyon dragon; a storm-blue lightning dragon). Chorus Drake's third and fourth skins after Quartet Chorusdrake.
  skin('skin_chorus_2', 'minion_skin', 'Canyon Drake', 'rare', 'd2_chorus', 'Canyon Drake.png'),
  skin('skin_chorus_3', 'minion_skin', 'Thunderchorus Drake', 'rare', 'd2_chorus', 'Thunderchorus Drake.png'),
  // Owner balance batch 2026-10-10: Fatecarver's Choose One is gone, so its second-branch ALT ART ("keep as a skin") became
  // a Fatecarver skin. The art was already in the repo (`art/minions/n2_fatecarver2.webp`, moved to `art/skins/`); the
  // master is the alt in the Set 2 Neutral folder, NOT a Skins rarity folder, so the rarity is a builder's pick (Rare)
  // for the owner to confirm, and the name is a placeholder for the owner to rename (the id stays).
  skin('skin_fatecarver_1', 'minion_skin', 'Astral Fatecarver', 'rare', 'n2_fatecarver', 'FatecarverAlt.png'),
  // HERO ATTACKS. Owner 2026-09-28: "the new blast attack is going to be a cosmetic unlock, not a new default". The
  // numbers combine, the hero charges, the view shakes and pushes in, bolts carry the blow. Then, on seeing it: "those
  // are good thresholds, this blast animation looks good! make it a legendary reward" (Epic -> Legendary). The name is
  // a placeholder for the owner to rename (the id stays).
  heroAttack('attack_blast', 'Arcane Barrage', 'legendary', 'blast'),
  // Owner 2026-09-28: "branch off and make a new attack animation called quake. same attack dmg threshold logic as
  // blast. the concept being an earthquake attack essentially with varying degrees of strength/cracks/explosions".
  // The hero slams the ground, a quake cracks across the board, the ground erupts under the target. Legendary like
  // Blast (a matching showpiece); the name is a placeholder for the owner to rename (the id stays).
  heroAttack('attack_quake', 'Tectonic Slam', 'legendary', 'quake'),
  // Owner 2026-09-28: "let's branch out and make one more attack animation, same setup as the last 2, but let's make
  // like a magic one called arcana". Clean magic ribbons lobbed from the hero (one, two, a barrage of five), and the
  // top tier swirls them into a vortex over the target that explodes outward. Named by the owner ("Arcana"; note the
  // Blast cosmetic's placeholder name "Arcane Barrage" is close). Legendary like the other two (the owner's call).
  // ANCIENT (owner 2026-10-02 moved this one from Legendary to the new Ancient rarity; owned copies stay owned).
  heroAttack('attack_arcana', 'Arcana', 'ancient', 'arcana'),
  // Owner 2026-09-28: "branch off and make a new style animation and surprise me with it. arcana is top tier good. use
  // that as your benchmark for quality. make it unique". Spectral swords summoned round the hero, swung round to aim
  // and loosed in straight thrusts that stick in the target and shatter; the top tier brings down a greatsword. The
  // name is the builder's pick for the owner to rename (the id stays). Legendary like the other three.
  heroAttack('attack_blades', 'Phantom Blades', 'legendary', 'blades'),
  // Owner 2026-09-28: "branch off and make one more animation, which is just a legendary version of this strike. it
  // should be a 10x more exciting and oomphier more impactful and pixi animation dense attack animation, but basically a
  // legendary version of this attack, just amplified or enraged." Classic's lunge, ENRAGED: a burning rage aura, a brutal
  // dash with afterimages, white-hot impacts with claw rips; II a double strike, III a flurry of three, IV a meteor slam.
  // The name is the builder's placeholder for the owner to rename (the id stays). Legendary like the other four.
  heroAttack('attack_enraged', 'Enraged Strike', 'legendary', 'enraged'),
  // Owner 2026-09-28: "branch off and make a poison dart animation. the final one should throw multiple poison darts
  // that implode with poison". Small, sleek poison darts flicked on a slight arc that thunk in and stick with venom
  // splashes; II two, III a fan of five, IV six that swell, implode into a point and burst in a toxic cloud. The name is
  // the builder's placeholder for the owner to rename (the id stays). Legendary like the other five.
  heroAttack('attack_poison', 'Venom Volley', 'legendary', 'poison'),
  // Owner 2026-09-28: "branch off and create an ice/freeze blast one. icicles and then a frost nova blast that blasts
  // across the screen from the attacker to the target". Icicles crystallise round the hero and fire (I one, II two, III
  // a volley of five), shattering and leaving frost creeping over the portrait; IV adds a frost nova that rolls across
  // the screen, encases the target in ice and shatters it. The name is the builder's placeholder for the owner to
  // rename (the id stays). Legendary like the other six.
  heroAttack('attack_frost', 'Frost Nova', 'legendary', 'frost'),
  // Owner 2026-09-28: "branch off and create a holy weapon + consecration attack. first tier is a holy aoe blast on the
  // opponent, final blast a large holy sword slams into the middle of the board and a consecration erupts from it
  // damaging the opponent. fill in the middle tiers". A golden sigil and a pillar of light smite the target; II a double
  // smite, III a rain of light spears planting consecration seeds, IV a holy sword that drops, explodes into light and
  // fires a flat consecrated blast at the target. The name is the builder's placeholder for the owner to rename (the id
  // stays). Legendary like the other seven.
  // ANCIENT (owner 2026-10-02 moved this one from Legendary to the new Ancient rarity; owned copies stay owned).
  heroAttack('attack_holy', 'Consecration', 'ancient', 'holy'),
  // Owner 2026-09-29: "make some more attack types - we need a fire animation ... it should look like live flame/fires
  // pixi sprites". Fireballs of live particle fire are hurled (I one, II two, III a volley of five that sets the target
  // ablaze); IV calls down a meteor that detonates into a fire nova and engulfs the target. The name is the builder's
  // placeholder for the owner to rename (the id stays). Legendary like the other eight.
  heroAttack('attack_fire', 'Inferno', 'legendary', 'fire'),
  // Owner 2026-09-29: "branch off and make some more attack types - we need a fire animation, a bleed/gash animation,
  // some sort of an undead animation, ...". The undead one (the design left to the builder): a spectral skull shrieks
  // out of the hero and bites the target; II two skulls, III skeletal hands claw up and drag at the target while a wisp
  // swarm strikes and a skull finishes it, IV a grave rift tears open and a giant skull maw rises, shrieks, lunges and
  // chomps, then necrotic mist washes out. The name is the builder's placeholder for the owner to rename (the id stays).
  // Legendary like the other eight.
  heroAttack('attack_undead', 'Grave Call', 'legendary', 'undead'),
  // Owner 2026-09-29: "make some more attack types ... a beast chomp rush animation ... use the same 4 tier strategy we
  // have been". Spirit beasts leap from the hero and front jaws chomp shut on the target: I one wolf, II a staggered
  // pair, III a pack of five kicking up dust, IV a colossal beast whose jaws slam over the whole portrait, then it roars.
  // The name is the builder's placeholder for the owner to rename (the id stays). Legendary like the other eight.
  heroAttack('attack_beast', 'Stampede', 'legendary', 'beast'),
  // Owner 2026-09-29: "make some more attack types ... i would love a king oona banana cannon animation. use the same 4
  // tier strategy we have been." King Oona's gold-trimmed jungle cannon pops in by the hero and lobs bananas that splat
  // into the target (I one, II a double shot, III a rapid barrage); IV fires a giant golden banana that arcs out of the
  // top of the screen and slams down into a banana-bunch shower and a golden shockwave. The name is the builder's
  // placeholder for the owner to rename (the id stays). Legendary like the other eight.
  heroAttack('attack_banana', "Oona's Banana Cannon", 'legendary', 'banana'),
  // Owner 2026-09-29: "branch off and make some more attack types - we need ... a bleed/gash animation ... use the same 4
  // tier strategy we have been". Crimson crescents fly in and cut gashes that open and bleed: I one diagonal gash, II a
  // cross, III a flurry ending in a claw rake, IV three rakes, a heartbeat, a mega-slash that splits the screen and a
  // blood nova. The name is the builder's placeholder for the owner to rename (the id stays). Legendary like the others.
  heroAttack('attack_bleed', 'Hemorrhage', 'legendary', 'bleed'),
  // Owner 2026-09-29: "build 5 animations that range from rare -> epic. all of the animations we have done so far are
  // legendary. rare and epics should only have 2 or 3 tiers to them and generally be less exciting, but still extremely
  // clean and fun". The first EPIC attacks, three looks each. Card Shark: the hero deals playing cards (one Ace, three
  // Aces, a royal flush that turns gold and bursts into confetti). Storm Call: a crackling bolt, a forked double strike,
  // a storm cloud that drops a thick lightning strike. The names are the builder's placeholders (the ids stay).
  heroAttack('attack_cards', 'Card Shark', 'epic', 'cards'),
  heroAttack('attack_storm', 'Storm Call', 'epic', 'storm'),
  // THE RARES (owner 2026-09-29: "build 5 animations that range from rare -> epic ... rare and epics should only have 2
  // or 3 tiers to them and generally be less exciting, but still extremely clean and fun"). Two visual tiers each
  // (shared I-II Small, III-IV Big). Names are the builder's placeholders for the owner to rename (the ids stay).
  heroAttack('attack_coin', 'Pocket Change', 'rare', 'coin'),
  heroAttack('attack_boomerang', 'Come Back Around', 'rare', 'boomerang'),
  heroAttack('attack_bubble', 'Bubble Trouble', 'rare', 'bubble'),
  // Owner 2026-09-29: "add a stealth backstab attack to the rare branch. portrait fades and attacks from behind the
  // target back towards the player portrait and settles".
  heroAttack('attack_backstab', 'Shadow Step', 'rare', 'backstab'),
  // Owner 2026-09-29: "branch off and make a basketball attack animation. tier 1 = basketball shot from place / tier 2 = a
  // fadeaway ... / tier 4 = a self alley oop" (reviewed: III a pull-up three, IV a throw that bounces high, a leap, a slam). The
  // striking portrait plays ball: a jump shot, a fadeaway, a pull-up three, and a self alley-oop slammed into an explosion. Four tiers, so
  // Legendary like the others. The name is the builder's placeholder for the owner to rename (the id stays).
  heroAttack('attack_basketball', 'Nothing But Net', 'legendary', 'basketball'),
  // Owner 2026-10-02: an "ancient" attack for the ANCIENT OF BONDS style: "this ancient binds things together and using
  // soulbindings". The owner picked the concept SOUL STITCH (stitching the target to you): crystal needles on violet soul
  // thread. I a needle pierces, the thread hangs taut, a tug and the snap; II three needles cross-stitch an X and the
  // threads snap through; III (the owner's pick "Pinned") five pins stab in at the points of a star and the target is
  // stretched toward the hero until they rip out; IV (the owner's pick "Bound Together") the heroes laced together, the target dragged halfway
  // across the board into a gold heart-knot that ties shut, a strike, the knot bursts and the target is flung home. The
  // first attack BUILT at the ANCIENT rarity (Arcana and Consecration were moved up to it).
  heroAttack('attack_soul_stitch', 'Soul Stitch', 'ancient', 'stitch'),
  // Owner 2026-10-02: "build a new ancient animation for this ancient, the ancient of time". After three builds of a
  // rewind concept (3.5, 4 and 5 out of 10; "i dont like using the art for the attack. try again") the owner picked
  // TIMEBREAK (placeholder name "Bullet Time" until 2026-10-03): stopped time, the shots hang in the air, then time restarts and they all land (IV: a dome of blades and
  // a 3-2-1). Built at the Ancient rarity.
  heroAttack('attack_bullet_time', 'Timebreak', 'ancient', 'bullettime'),
  // PORTRAIT FRAMES (owner 2026-10-01: "we're adding portrait skins: C:\Game Assets\Ascent Art\Skins\Portraits"). Every
  // one drops from crates at its folder's rarity, the rank-named masters included (owner decision 2026-10-01). The NAMES
  // avoid the ranked medal words (the player-text rule below), so a crate frame never reads as a Ranked reward: the
  // ids keep the masters' names (permanent, never shown). The masters sit in one sub-folder per RARITY and the folder IS
  // the rarity (owner 2026-10-01, R-PROG-FRAME-04; portraitFrameRarityFolders.test.ts checks it).
  portraitFrame('frame_honey', 'Honey', 'common', 'Common/Honey.png'),
  // Portrait frames batch 3 (owner 2026-10-01): rarity = the Portraits rarity folder.
  portraitFrame('frame_ale', 'Ale', 'common', 'Common/Ale.png'),
  portraitFrame('frame_ruby', 'Ruby', 'common', 'Common/Ruby.png'),
  portraitFrame('frame_steel', 'Steel', 'common', 'Common/Steel.png'),
  portraitFrame('frame_wood', 'Wood', 'common', 'Common/Wood.png'),
  // Owner 2026-10-01: "added more portrait skins etc". The 20-character name cap and the medal-word rule (Golden) mean
  // the two Dragonscale rings are named by look: Dark Scale, Gilt Scale (ids keep the master names).
  portraitFrame('frame_dark_dragonscale', 'Dark Scale', 'common', 'Common/DarkDragonscale.png'),
  portraitFrame('frame_golden_dragonscale', 'Gilt Scale', 'legendary', 'Legendary/GoldenDragonscale.png'),
  // Frames batch 6 (Kevin 2026-10-02: "i added more frames"): the owner moved the four metal rings from Rare/ to Common/; the
  // folder is the rarity, so they are Common now. Owned copies stay owned (a rarity change only moves crate odds).
  portraitFrame('frame_bronze', 'Burnished', 'common', 'Common/BronzeFrame.png'),
  portraitFrame('frame_silver', 'Sterling', 'common', 'Common/SilverFrame.png'),
  portraitFrame('frame_gold', 'Gilded', 'common', 'Common/GoldFrame.png'),
  portraitFrame('frame_platinum', 'Seaglass', 'common', 'Common/PlatinumFrame.png'),
  portraitFrame('frame_glass_shard', 'Glass Shard', 'rare', 'Rare/GlassShard.png'),
  portraitFrame('frame_paragon', 'Paragon', 'rare', 'Rare/Paragon.png'),
  portraitFrame('frame_vines', 'Vine', 'rare', 'Rare/Vines.png'),
  portraitFrame('frame_magic', 'Magic', 'rare', 'Rare/Magic.png'),
  // Portrait frames batch 5 (Kevin 2026-10-02: "added more skins"): rarity = the Portraits rarity folder.
  portraitFrame('frame_simple_ring', 'Simple Ring', 'rare', 'Rare/SimpleRing.png'),
  portraitFrame('frame_void', 'Void', 'rare', 'Rare/Void.png'),
  // Portrait frames batch 4 (owner 2026-10-01: Epic, "the other ones should be Epic"). Mike's masters are loose files with spaces in
  // their names ("Blue Energy Frame.png"); `npm run art:frames -- --src <dir> --apply` matches them ignoring spaces and case.
  // Batch 5 (2026-10-02): the masters now point at Kevin's copies in Epic/ (pixel-identical to the shipped webps; Mike's
  // rarities win, owner 2026-10-02). Re-wiring from Mike's loose files would need them renamed to these names.
  portraitFrame('frame_multichrome_energy', 'Multichrome Energy', 'epic', 'Epic/Multichrome.png'),
  // Frames batch 6 (2026-10-02): Kevin's folder had Blue Energy in Rare/, but Mike set it Epic in #1898 and the owner
  // ruled "use mike's setting if he has any frame rarities set", so it stays Epic and the master moved back to Epic/.
  portraitFrame('frame_blue_energy', 'Blue Energy', 'epic', 'Epic/BlueEnergy.png'),
  portraitFrame('frame_crackling_ruby', 'Crackling Ruby', 'epic', 'Epic/CracklingRuby.png'),
  portraitFrame('frame_topaz', 'Topaz', 'epic', 'Epic/Topaz.png'),
  portraitFrame('frame_jade', 'Jade', 'epic', 'Epic/Jade.png'),
  portraitFrame('frame_aura', 'Aura', 'epic', 'Epic/Aura.png'),
  portraitFrame('frame_ascendant', 'Amethyst', 'epic', 'Epic/Ascendant.png'),
  // Frames batch 6 (2026-10-02): the owner moved Shard and Prism from Epic/ to Rare/, so they are Rare now.
  portraitFrame('frame_dark_diamond', 'Shard', 'rare', 'Rare/DarkDiamond.png'),
  portraitFrame('frame_diamond', 'Prism', 'rare', 'Rare/DiamondFrame.png'),
  portraitFrame('frame_ice', 'Frost', 'epic', 'Epic/Ice.png'),
  portraitFrame('frame_pearlescent', 'Pearlescent', 'epic', 'Epic/Pearlescent.png'),
  portraitFrame('frame_rank1', 'Crimson', 'epic', 'Epic/Rank1Frame.png'),
  portraitFrame('frame_nimbus', 'Nimbus', 'epic', 'Epic/Nimbus.png'),
  portraitFrame('frame_dark_cloud', 'Dark Cloud', 'legendary', 'Legendary/DarkCloudPortrait.png'),
  portraitFrame('frame_venom', 'Venom', 'legendary', 'Legendary/VenomPortrait.png'),
  portraitFrame('frame_wedding', 'Wedding', 'epic', 'Epic/WeddingPortrait.png'),
  portraitFrame('frame_fire', 'Fire', 'legendary', 'Legendary/Fire.png'),
  portraitFrame('frame_reaper', 'Reaper', 'legendary', 'Legendary/Reaper.png'),
  portraitFrame('frame_water', 'Water', 'legendary', 'Legendary/Water.png'),
  portraitFrame('frame_stained_glass', 'Stained Glass', 'legendary', 'Legendary/StainedGlass.png'),
  portraitFrame('frame_wind', 'Wind', 'legendary', 'Legendary/WindPortrait.png'),
  // Portrait frames batch 6 (Kevin 2026-10-02: "i added more frames"): rarity = the Portraits rarity folder.
  portraitFrame('frame_cherry_blossom', 'Cherry Blossom', 'epic', 'Epic/CherryBlossom.png'),
  // Portrait frames batch 7 (owner 2026-10-03: "ive also added many skins"): rarity = the Portraits rarity folder.
  // Epic/DragonGem.png and Epic/ElectricBlue.png are still byte-identical to CracklingRuby.png and BlueEnergy.png, so
  // they stay unwired (the disk check's "every master is wired" case still lists those two and nothing else).
  portraitFrame('frame_cream', 'Cream', 'epic', 'Epic/Cream.png'),
  portraitFrame('frame_crystal', 'Crystal', 'epic', 'Epic/Crystal.png'),
  portraitFrame('frame_disco', 'Disco', 'epic', 'Epic/Disco.png'),
  portraitFrame('frame_econ', 'Econ', 'epic', 'Epic/Econ.png'),
  portraitFrame('frame_snare', 'Snare', 'epic', 'Epic/Snare.png'),
  // Portrait frames batch 8 (Mike 2026-10-06: "i added a skin just to test to make sure this process works. lets wire
  // it up"): the first frame Mike wired from his own art folder. Rarity = the Portraits rarity folder.
  portraitFrame('frame_cosmic_glass', 'Cosmic Glass', 'epic', 'Epic/Cosmic Glass Frame.png'),
  // Portrait frames batch 9 (Mike 2026-10-06: "wire them up"): rarity = the Portraits rarity folder. Names come from the
  // filenames. Blossom (a wreath of branches and pink blossoms) is a different ring from Cherry Blossom (Mike kept the name).
  portraitFrame('frame_blossom', 'Blossom', 'epic', 'Epic/Blossom Frame.png'),
  portraitFrame('frame_neonpunk', 'Neonpunk', 'epic', 'Epic/Neonpunk Frame.png'),
  portraitFrame('frame_solar_flare', 'Solar Flare', 'epic', 'Epic/Solar Flare Frame.png'),
  portraitFrame('frame_color_doodle', 'Color Doodle', 'rare', 'Rare/Color Doodle Frame.png'),
  portraitFrame('frame_neon_ring', 'Neon Ring', 'rare', 'Rare/Neon Ring.png'),
  portraitFrame('frame_chromatic_dragonscale', 'Chromatic Scale', 'legendary', 'Legendary/ChromaticDragonscale.png'),
  // The first ANCIENT frames (owner 2026-10-02: "i added a new rarity -> Ancient"): rarity = the Portraits/Ancient folder.
  portraitFrame('frame_bonds', 'Bonds', 'ancient', 'Ancient/Bonds.png'),
  portraitFrame('frame_death', 'Death', 'ancient', 'Ancient/Death.png'),
  portraitFrame('frame_fortune', 'Fortune', 'ancient', 'Ancient/Fortune.png'),
  portraitFrame('frame_genesis', 'Genesis', 'ancient', 'Ancient/Genesis.png'),
  portraitFrame('frame_time', 'Time', 'ancient', 'Ancient/Time.png'),
  portraitFrame('frame_war', 'War', 'ancient', 'Ancient/War.png'),
  portraitFrame('frame_reflective', 'Reflective', 'ancient', 'Ancient/Reflective.png'),
  // ANNOUNCERS (owner 2026-10-11: "call the announcer: Lemon"; "it will be a Legendary reward players can unlock
  // through opening chests").
  announcer('announcer_lemon', 'Lemon', 'legendary', 'lemon'),
  // Owner 2026-10-11: "i want to create an underdweller announcer" (the hero Underdweller's voice) and "we will
  // call her Little Inu"; "legendary for both".
  announcer('announcer_underdweller', 'Underdweller', 'legendary', 'underdweller'),
  announcer('announcer_little_inu', 'Little Inu', 'legendary', 'little-inu'),
  // EMOTES (owner 2026-10-13; reworked 2026-10-15). The painted bubbles in C:/Game Assets/Ascent Art/Emotes/
  // (EmoteTemplate.png there is the blank template, not an emote). Names come from the filenames. Owner 2026-10-15:
  // "remove all emotes as 'given' and put them in various loot tiers between rare and legendary. wire all the new ones
  // that i added": every emote is a CRATE drop, spread by how expressive each is (a proposal the owner may re-tier: a
  // one-word change per line), EXCEPT Zen Brian, the one starter (below). 4 Rare / 4 Epic / 3 Legendary in crates
  // (Sad Wrangler, a Rare, retired 2026-10-15).
  // RETIRED 2026-10-15 (owner: "remove the angry mushy emote"). Kept as an inactive row, never deleted: the id stays known
  // so an equipped slot or an old recorded board naming it degrades quietly (it is not live, so the menu skips that
  // position, a recording of it plays nothing, the Collection hides it). Its in-repo bubble art was removed with it.
  { ...emote('emote_angry_mushy', 'Angry Mushy', 'common', 'AngryMushy.png', { type: 'starter' }), active: false },
  // THE STARTER (owner 2026-10-15, after the crate move: "all emotes are crate only except give all players the zen brian
  // emote"). Owned and in the menu for every account, guests included; never in a crate. Common, like the old starters.
  emote('emote_zen_brian', 'Zen Brian', 'common', 'ZenBrian.png', { type: 'starter' }),
  // Rare: one face, one feeling.
  emote('emote_nervous_jensen', 'Nervous Jensen', 'rare', 'NervousJensen.png'),
  emote('emote_depressed_hank', 'Depressed Hank', 'rare', 'DepressedHank.png'),
  emote('emote_nervous_voss', 'Nervous Voss', 'rare', 'NervousVoss.png'),
  // RETIRED 2026-10-15 (owner: "remove the sad wrangler"), exactly like Angry Mushy above: an inactive row, never deleted,
  // so the id stays known. A player who already OWNS it keeps the ownership row, but it is never shown (the Collection
  // hides it), never in the menu, never equippable, never in a crate, and a recording of it plays nothing. Its in-repo
  // bubble art was removed with it (the master stays in the Game Assets folder).
  { ...emote('emote_sad_wrangler', 'Sad Wrangler', 'rare', 'SadWrangler.png'), active: false },
  emote('emote_tara_sad', 'Tara Sad', 'rare', 'TaraSad.png'),
  // Epic: a bigger gesture or a little scene.
  emote('emote_flirty_midas', 'Flirty Midas', 'epic', 'FlirtyMidas.png'),
  emote('emote_happy_urchin', 'Happy Urchin', 'epic', 'HappyUrchin.png'),
  emote('emote_sly_oona', 'Sly Oona', 'epic', 'SlyOona.png'),
  emote('emote_dead_elder', 'Dead Elder', 'epic', 'DeadElder.png'),
  // Legendary: the busiest, loudest bubbles.
  emote('emote_rich_pimm', 'Rich Pimm', 'legendary', 'RichPimm.png'),
  emote('emote_baby_rubies', 'Baby Rubies', 'legendary', 'BabyRubies.png'),
  emote('emote_mad_tormentor', 'Mad Tormentor', 'legendary', 'MadTormentor.png'),
  // CARD PLATES (owner 2026-10-14): "This card plate is called Aquarium Rocks"; "aquariam rocks should be a legendary drop".
  cardPlate('plate_aquarium_rocks', 'Aquarium Rocks', 'legendary', 'Aquarium Rocks.png'),
  // Owner 2026-10-15: the rest of the Card Backplates folder, "every other one should be a legendary reward".
  cardPlate('plate_amethyst', 'Amethyst', 'legendary', 'Amethyst.png'), // shares its name with the Amethyst portrait frame (owner 2026-10-15)
  cardPlate('plate_bamboo', 'Bamboo', 'epic', 'Bamboo.png'), // owner 2026-10-15: Epic
  cardPlate('plate_beach', 'Beach', 'legendary', 'Beach Frame.png'), // layered on the Water interior (2026-10-15)
  cardPlate('plate_magma', 'Magma', 'legendary', 'Magma Frame.png'), // layered on the Magma interior (2026-10-15)
  cardPlate('plate_moonstone', 'Moonstone', 'epic', 'Moonstone Frame.png'), // owner 2026-10-15: Epic; // layered on the Dark interior (2026-10-15)
  // Owner 2026-10-15: "create a new plate using the dark interior and mooncloud plate" (Legendary by the folder rule).
  cardPlate('plate_mooncloud', 'Mooncloud', 'ancient', 'Mooncloud.png'), // owner 2026-10-15: Ancient ("make mooncloud ascendant rarity", meaning Ancient)
  // Owner 2026-10-15: "create a new one with dark interior and galaxy frame".
  cardPlate('plate_galaxy', 'Galaxy', 'legendary', 'Galaxy.png'),
  // Owner 2026-10-15: "i added more frames to the folder, can you add them all in with the dark interior".
  cardPlate('plate_crackling_gemstone', 'Crackling Gemstone', 'legendary', 'Crackling Gemstone.png'),
  cardPlate('plate_hand_drawn', 'Hand Drawn', 'epic', 'Hand Drawn.png'), // owner 2026-10-17: Epic
  cardPlate('plate_blue_hand_drawn', 'Blue Hand Drawn', 'epic', 'Blue Hand Drawn.png'), // owner 2026-10-17: Epic
  cardPlate('plate_green_hand_drawn', 'Green Hand Drawn', 'epic', 'Green Hand Drawn.png'), // owner 2026-10-17: Epic
  // Owner 2026-10-15: "the simpleblack and simplewhite should go on top of the new simpleblack interior"; Topaz came in
  // the same drop with no interior named, so it takes the default (Brown).
  // Owner 2026-10-15: "make simple black and simple white Ascendant tier rewards" -> "i meant ancient rarity".
  cardPlate('plate_simple_black', 'Simple Black', 'ancient', 'Simpleblack Frame.png'),
  cardPlate('plate_simple_white', 'Simple White', 'ancient', 'Simplewhite.png'),
  cardPlate('plate_topaz', 'Topaz', 'legendary', 'Topaz.png'),
  // Owner 2026-10-15: "i added three new \"smooth\" frames - pair them with the dark interior"; then "make moonstone,
  // bamboo, and the smooth frames all epic rarity".
  cardPlate('plate_smooth_aqua', 'Smooth Aqua', 'epic', 'Smooth Aqua.png'),
  cardPlate('plate_smooth_blue', 'Smooth Blue', 'epic', 'Smooth Blue.png'),
  cardPlate('plate_smooth_red', 'Smooth Red', 'epic', 'Smooth Red.png'),
  // Owner 2026-10-15: the first LAYERED plate (built as "Test Blossom"), then "rename the existing Test blossom in game to
  // Blossom". Legendary by the folder rule.
  cardPlate('plate_blossom', 'Blossom', 'legendary', 'Test Blossom Frame.png'),
  // Owner 2026-10-16: "i added a bunch of new frames to the folder" (Legendary by the folder rule). Interiors by the
  // owner's pick of the suggested pairing: Dark Arcane on Dark, Stonevines on the new Grey, the four Standard colours on
  // the new Dark Brown. Simple Glass started on Grey; owner 2026-10-17: "the glass frame needs the simpleblack interior".
  cardPlate('plate_dark_arcane', 'Dark Arcane', 'epic', 'Dark Arcane.png'), // owner 2026-10-17: Epic
  cardPlate('plate_simple_glass', 'Simple Glass', 'ancient', 'Simpleglass.png'), // owner 2026-10-17: Ancient
  cardPlate('plate_stonevines', 'Stonevines', 'legendary', 'Stonevines.png'),
  cardPlate('plate_standard_black', 'Standard Black', 'rare', 'Standard Black.png'), // owner 2026-10-17: Rare
  cardPlate('plate_standard_blue', 'Standard Blue', 'rare', 'Standard Blue.png'), // owner 2026-10-17: Rare
  cardPlate('plate_standard_pink', 'Standard Pink', 'rare', 'Standard Pink.png'), // owner 2026-10-17: Rare
  cardPlate('plate_standard_teal', 'Standard Teal', 'rare', 'Standard Teal.png'), // owner 2026-10-17: Rare
  // Owner 2026-10-16: "add chrome from the folder with the grey interior" (Legendary by the folder rule).
  cardPlate('plate_chrome', 'Chrome', 'legendary', 'Chrome.png'),
  // Owner 2026-10-17: "ive added a lot of new card frames to the folder". No interior or rarity named, so the defaults:
  // Legendary (the folder rule) on the Brown interior.
  // Owner 2026-10-17: "Spirit Carving" (the art is "Ascendant Carving.png"; names can't use ranked medal words).
  cardPlate('plate_spirit_carving', 'Spirit Carving', 'legendary', 'Ascendant Carving.png'),
  cardPlate('plate_iridescent', 'Iridescent', 'legendary', 'Iridescent.png'),
  cardPlate('plate_mystic_obsidian', 'Mystic Obsidian', 'legendary', 'Mystic Obsidian.png'),
  cardPlate('plate_porcelain', 'Porcelain', 'legendary', 'Porcelain.png'),
  cardPlate('plate_smooth_iridescent', 'Smooth Iridescent', 'legendary', 'Smooth Iridescent.png'),
  // Owner 2026-10-17: "ive added another round of frames and interiors. match them based on the names". Legendary by the
  // folder rule. Silver Magic ships as Verdant Magic (no medal words in names); "Ascendant Rank" is held back as a
  // future ranked reward (owner 2026-10-17), not a crate plate.
  cardPlate('plate_battletorn', 'Battletorn', 'legendary', 'Battletorn.png'),
  cardPlate('plate_ethereal', 'Ethereal', 'legendary', 'Ethereal.png'),
  cardPlate('plate_phoenix', 'Phoenix', 'legendary', 'Phoenix.png'),
  cardPlate('plate_round_magic', 'Round Magic', 'legendary', 'Round Magic.png'),
  cardPlate('plate_verdant_magic', 'Verdant Magic', 'legendary', 'Silver Magic.png'),
  cardPlate('plate_phoenix_plate', 'Phoenix Plate', 'legendary', 'Phoenix Plate.png'),
  // HERO TITLES (owner 2026-09-29), 33 heroes x (title + golden master). Achievement rewards, never in a crate.
  ...HERO_TITLE_COSMETICS,
]);

export const COSMETIC_INDEX: Readonly<Record<string, CosmeticDef>> = Object.freeze(
  Object.fromEntries(COSMETICS.map((c) => [c.id, c])),
);

export const cosmeticOf = (id: string | null | undefined): CosmeticDef | null => (id && COSMETIC_INDEX[id] ? COSMETIC_INDEX[id]! : null);

/** A hero title's hero and tier, keyed by title id (both tiers). */
export interface HeroTitleInfo { heroId: string; master: boolean; baseId: string; masterId: string }
export const HERO_TITLE_INFO: Readonly<Record<string, HeroTitleInfo>> = Object.freeze(Object.fromEntries(HERO_TITLE_NAMES.flatMap(([heroId]) => {
  const info = { heroId, baseId: heroTitleId(heroId), masterId: heroMasterTitleId(heroId) };
  return [[info.baseId, { ...info, master: false }], [info.masterId, { ...info, master: true }]] as const;
})));
export const heroTitleInfo = (id: string | null | undefined): HeroTitleInfo | null => (id ? HERO_TITLE_INFO[id] ?? null : null);
/** A MASTER hero title (10 Ranked 1sts): every renderer paints it as the golden embroidered plate. */
export const isMasterTitle = (id: string | null | undefined): boolean => heroTitleInfo(id)?.master === true;

/**
 * THE MASTER SUPERSEDES THE BASE ("upgraded in place"): the title ids a player's lists show, given what they own.
 * A base hero title is left out once its master is owned; an UNOWNED master is left out (its base stands for both
 * tiers until then). Everything else passes through. `catalogIds` = the candidates (the album, owned or not).
 */
export function titleShelf(catalogIds: readonly string[], owned: ReadonlySet<string>): string[] {
  return catalogIds.filter((id) => {
    const h = heroTitleInfo(id);
    if (!h) return true;
    return h.master ? owned.has(id) : !owned.has(h.masterId);
  });
}

/** The level a level-milestone item is granted at, else null. */
export const milestoneLevelOf = (c: CosmeticDef): number | null => (c.acquisition.type === 'level_milestone' ? c.acquisition.level : null);

// ── The roll (fixed rarity odds, then an equal chance within the rarity; 2026-09-29) ─────────────────────

/**
 * The items a crate can still give this player: active, crate-sourced, in an ENABLED category, not owned.
 * Sorted by id (the SQL walks the same order), so a roll maps to the same item in both copies.
 */
export function eligibleCrateCosmetics(owned: Iterable<string>, catalog: readonly CosmeticDef[] = COSMETICS): CosmeticDef[] {
  const have = new Set(owned);
  return catalog
    .filter((c) => c.active && c.acquisition.type === 'crate' && COSMETIC_CATEGORY_DEFS[c.category].enabled && !have.has(c.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Where a rolled rarity with nothing left falls: the NEAREST rarity with something eligible, ties toward the MORE
 * COMMON one (Epic empty tries Rare before Legendary). The rolled rarity itself comes first.
 */
export function crateRarityFallback(rolled: CosmeticRarity): CosmeticRarity[] {
  const i = COSMETIC_RARITIES.indexOf(rolled);
  return COSMETIC_RARITIES.map((r, j) => ({ r, d: Math.abs(j - i), j }))
    .sort((a, b) => a.d - b.d || a.j - b.j)
    .map((x) => x.r);
}

/** Which rarity a draw `u` in [0, 1) rolls, and where inside that rarity's odds band it landed (`frac`, [0, 1)). */
export function rollCrateRarity(u: number): { rarity: CosmeticRarity; frac: number } {
  const x = Math.min(Math.max(u, 0), 1) * 100;
  let lo = 0;
  for (const r of COSMETIC_RARITIES) {
    const hi = lo + CRATE_RARITY_ODDS[r];
    if (x < hi) return { rarity: r, frac: (x - lo) / CRATE_RARITY_ODDS[r] };
    lo = hi;
  }
  const last = COSMETIC_RARITIES[COSMETIC_RARITIES.length - 1]!;
  return { rarity: last, frac: 1 };
}

/**
 * Open a crate: ONE server draw `u` in [0, 1) (the SQL's `random()`) rolls a rarity at the fixed CRATE_RARITY_ODDS;
 * where `u` landed inside that rarity's band then picks an item of it, EVERY item of the rarity equally likely
 * (owner 2026-09-29: "yeah equal chance"), indexed in id order. A rarity with nothing left falls to the nearest one
 * that has something (`crateRarityFallback`), so a crate always produces an item while any item remains. Null only when nothing is eligible anywhere
 * (`pool_exhausted`). Mirror of `progression_crate_pick` in 2026-10-02-ancient-rarity.sql (5 rarities; the shape is
 * 2026-09-29-crate-uniform-within-rarity.sql's).
 */
export function pickCrateReward(eligible: readonly CosmeticDef[], u: number): CosmeticDef | null {
  const { rarity, frac } = rollCrateRarity(u);
  for (const r of crateRarityFallback(rarity)) {
    const bucket = eligible.filter((c) => c.rarity === r);
    if (bucket.length === 0) continue;
    return bucket[Math.min(bucket.length - 1, Math.max(0, Math.floor(frac * bucket.length)))]!;
  }
  return null;
}

/**
 * The exact chance of each eligible item from ONE crate (for tests, reports and any odds display): each rarity's
 * published odds go to it, or to its fallback when it is empty, then split EQUALLY among its eligible items. Sums to 1 while
 * anything is eligible.
 */
export function crateChances(eligible: readonly CosmeticDef[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const rolled of COSMETIC_RARITIES) {
    for (const r of crateRarityFallback(rolled)) {
      const bucket = eligible.filter((c) => c.rarity === r);
      if (bucket.length === 0) continue;
      for (const c of bucket) out.set(c.id, (out.get(c.id) ?? 0) + CRATE_RARITY_ODDS[rolled] / 100 / bucket.length);
      break;
    }
  }
  return out;
}

/** The published odds as one player-facing line, e.g. "Common 35%, Rare 31%, Epic 22%, Legendary 9%, Ancient 3%". */
export const crateOddsLine = (): string => COSMETIC_RARITIES.map((r) => `${RARITY_LABELS[r]} ${CRATE_RARITY_ODDS[r]}%`).join(', ');

// ── Crates: the shapes the server returns ─────────────────────────────────────────────────────────────────

export type CrateState = 'sealed' | 'opened';

export interface CrateRow {
  crateId: string;
  /** The level that earned it (1 = the Welcome Crate). Null for a crate that came from a `source` instead. */
  earnedLevel: number | null;
  state: CrateState;
  rewardId: string | null;
  earnedAt: string | null;
  openedAt: string | null;
  /** Where a non-level crate came from (2026-09-29): `gauntlet:<stage>` for a first Gauntlet clear. Absent on a
   *  level crate (the SQL sends null; `parseCrate` drops it so level crates keep their exact shape). */
  source?: string;
}

/** A level crate's player-facing name. */
export const crateName = (earnedLevel: number): string => (earnedLevel <= 1 ? 'Welcome Crate' : `Level ${earnedLevel} Crate`);

const GAUNTLET_SOURCE = /^gauntlet:(10|[1-9])$/;

/** The Gauntlet stage a crate `source` names (`gauntlet:<n>`), or null. */
export function gauntletStageOfSource(source: string | null | undefined): number | null {
  const m = typeof source === 'string' ? GAUNTLET_SOURCE.exec(source) : null;
  return m ? Number(m[1]) : null;
}

/** Any crate's player-facing name: a level crate keeps its `crateName`, a Gauntlet crate names its stage. */
export function crateLabel(crate: { earnedLevel: number | null; source?: string | null }): string {
  const stage = gauntletStageOfSource(crate.source);
  if (crate.earnedLevel === null && stage !== null) return `Gauntlet Crate · Stage ${stage}`;
  return crateName(crate.earnedLevel ?? 1);
}

export type OpenCrateStatus = 'opened' | 'already_opened' | 'pool_exhausted';

export interface OpenCrateResult {
  status: OpenCrateStatus;
  crate: CrateRow;
  /** The item this crate gave (null while the pool is exhausted and the crate stays sealed). */
  rewardId: string | null;
  /** Sealed crates this account still holds after the call. */
  sealedRemaining: number;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : null);

/** Parse one crate (camelCase from the SQL JSON, or snake_case from a table read). Null for anything else. */
export function parseCrate(v: unknown): CrateRow | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const crateId = str(o.crateId ?? o.crate_id);
  const earnedLevel = int(o.earnedLevel ?? o.earned_level);
  const state = o.state;
  const source = str(o.source);
  // A level crate needs a level >= 1; a crate without one must name a known source (a Gauntlet stage).
  const levelOk = earnedLevel === null ? gauntletStageOfSource(source) !== null : earnedLevel >= 1;
  if (!crateId || !levelOk || (state !== 'sealed' && state !== 'opened')) return null;
  const row: CrateRow = {
    crateId, earnedLevel, state,
    rewardId: str(o.rewardId ?? o.reward_cosmetic_id),
    earnedAt: str(o.earnedAt ?? o.earned_at),
    openedAt: str(o.openedAt ?? o.opened_at),
  };
  if (source) row.source = source;
  return row;
}

export function parseOpenCrateResult(v: unknown): OpenCrateResult | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const status = o.status;
  if (status !== 'opened' && status !== 'already_opened' && status !== 'pool_exhausted') return null;
  const crate = parseCrate(o.crate);
  const sealedRemaining = int(o.sealedRemaining);
  if (!crate || sealedRemaining === null || sealedRemaining < 0) return null;
  const rewardId = str(o.rewardId);
  if (status !== 'pool_exhausted' && !rewardId) return null;
  return { status, crate, rewardId: status === 'pool_exhausted' ? null : rewardId, sealedRemaining };
}

// ── The kill switch: is an item still part of the game? ───────────────────────────────────────────────────

/**
 * The SERVER's copy of the switch, as last read from the public `cosmetic_catalog` / `cosmetic_categories` tables.
 * The owner retires an item with one SQL line (`admin_off`); a client that only consulted its own bundled catalog
 * would keep rendering it until the next build. So the client reads the two tables on boot and records what the
 * server has switched OFF here: the EFFECTIVE state, `active AND NOT admin_off` (items) and `enabled AND NOT
 * admin_off` (categories). It can only ever REMOVE: an item the TS catalog retires stays retired whatever the server
 * says, and an unreadable server leaves the bundled catalog in charge.
 */
export interface ServerCatalogState {
  /** Item ids the server has `active = false`. */
  retiredIds: readonly string[];
  /** Categories the server has `enabled = false`. */
  disabledCategories: readonly string[];
}
let serverRetired: ReadonlySet<string> = new Set();
let serverDisabled: ReadonlySet<string> = new Set();
let catalogEpoch = 0;

/** Record the server's catalog switches (null clears them). Bumps `catalogStateEpoch` so memoized lookups refresh. */
export function setServerCatalogState(state: ServerCatalogState | null): void {
  serverRetired = new Set(state?.retiredIds ?? []);
  serverDisabled = new Set(state?.disabledCategories ?? []);
  catalogEpoch++;
}
/** Changes whenever the server catalog state does: a memo key for anything that caches `isCosmeticLive`. */
export const catalogStateEpoch = (): number => catalogEpoch;

/** Parse the two public table reads into a state. Tolerant: bad rows are skipped, never thrown on. */
export function parseServerCatalogState(catalogRows: unknown, categoryRows: unknown): ServerCatalogState {
  const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : []);
  return {
    // Effective state: the code's flag AND the owner's emergency switch (`admin_off`, absent on a pre-sync server).
    retiredIds: rows(catalogRows).filter((r) => typeof r.cosmetic_id === 'string' && (r.active === false || r.admin_off === true)).map((r) => r.cosmetic_id as string),
    disabledCategories: rows(categoryRows).filter((r) => typeof r.category === 'string' && (r.enabled === false || r.admin_off === true)).map((r) => r.category as string),
  };
}

/**
 * LIVE = known to this client's catalog, `active`, in an ENABLED category, and not switched off by the server.
 * Everything a player can see or use goes through this: the Collection, equip, and every skin renderer. An
 * unknown id (a newer server's item, a removed one, garbage from an old replay) is simply not live.
 */
export function isCosmeticLive(id: string | null | undefined): boolean {
  const c = cosmeticOf(id);
  return !!c && c.active && COSMETIC_CATEGORY_DEFS[c.category].enabled && !serverRetired.has(c.id) && !serverDisabled.has(c.category);
}

/** A category is LIVE when enabled in the TS catalog AND not switched off by the server. */
export const isCategoryLive = (category: CosmeticCategory): boolean => COSMETIC_CATEGORY_DEFS[category].enabled && !serverDisabled.has(category);

/** The catalog items the player can see at all (the Collection's universe). */
export const liveCosmetics = (catalog: readonly CosmeticDef[] = COSMETICS): CosmeticDef[] => catalog.filter((c) => isCosmeticLive(c.id));

// ── Skins: loadouts, the per-run snapshot, and the one resolver every renderer uses ───────────────────────

export type SkinSlot = 'hero_skin' | 'minion_skin';
export const SKIN_SLOTS: readonly SkinSlot[] = ['hero_skin', 'minion_skin'];
/** Every slot `equip_cosmetic` accepts: the two per-target skin slots, the account-wide hero attack, portrait
 *  frame, announcer and card plate (target ''), and the EMOTE slot (2026-10-13), whose target is the menu position
 *  '0'..'3'. */
export type EquipSlot = SkinSlot | 'hero_attack' | 'portrait_frame' | 'announcer' | 'emote' | 'card_plate';
export const EQUIP_SLOTS: readonly EquipSlot[] = ['hero_skin', 'minion_skin', 'hero_attack', 'portrait_frame', 'announcer', 'emote', 'card_plate'];
/** The account-wide slots: one row each, target ''. */
export const GLOBAL_EQUIP_SLOTS: readonly EquipSlot[] = ['hero_attack', 'portrait_frame', 'announcer', 'card_plate'];

/**
 * Who wears what, keyed by the TARGET (handoff §6.7 `cosmetic_loadouts` / §13 `RunCosmeticSnapshot`). The same
 * shape serves the live loadout and the snapshot a run records, so a renderer never cares which it was given.
 */
export interface RunCosmeticSnapshot {
  heroSkinByHeroId?: Readonly<Record<string, string>>;
  minionSkinByCardId?: Readonly<Record<string, string>>;
  /** The equipped `hero_attack` item (account-wide). Absent = Classic. */
  heroAttack?: string;
  /** The equipped TITLE (account-wide, owner ask 2026-09-28: "show them where possible ... as a way of showing off
   *  their flair"). Recorded at run start from `profiles.equipped_title_id`, so opponents, replays and history
   *  show the title worn in THAT run. Absent = no title shown. The live loadout never carries it (the profile
   *  holds it); `withEquippedTitle` folds it in before `snapshotForRun`. */
  title?: string;
  /** The equipped PORTRAIT FRAME (account-wide, owner 2026-10-01: "we want this to replace the default portrait png
   *  when a skin is applied"). Absent = the default ring. */
  portraitFrame?: string;
  /** The equipped CARD PLATE (account-wide, owner 2026-10-14). Recorded on every run like the portrait frame, so the
   *  players you meet see it on your cards. Absent = the standard plates. */
  cardPlate?: string;
  /** The equipped ANNOUNCER (account-wide, owner 2026-10-11). LIVE LOADOUT ONLY: only the wearer hears it, so
   *  `snapshotForRun` and `parseCosmeticSnapshot` never carry it. Absent = the default announcer. */
  announcer?: string;
  /** The EMOTES placed in the menu (owner 2026-10-13), keyed by menu position '0'..'3' (`EMOTE_SLOT_COUNT`). LIVE
   *  LOADOUT ONLY: a run records the emotes its player actually USED, on each round's board (`BoardSnapshot.emotes`),
   *  never this menu, so `snapshotForRun` and `parseCosmeticSnapshot` never carry it. Absent or partial =
   *  the player's owned emotes fill the empty positions (`emoteSlotsOf`). */
  emotes?: Readonly<Record<string, string>>;
}

/** Hard caps on what a snapshot may carry, so a hostile or corrupt payload stays tiny. */
const SNAPSHOT_MAX_ENTRIES = 64;
const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

function parseSkinMap(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, id] of Object.entries(v as Record<string, unknown>)) {
    if (n >= SNAPSHOT_MAX_ENTRIES) break;
    if (!ID_RE.test(k) || typeof id !== 'string' || !ID_RE.test(id)) continue;
    out[k] = id;
    n++;
  }
  return n > 0 ? out : undefined;
}

/**
 * Parse a recorded snapshot (from a board, a seat, a replay frame or a Career entry). Tolerant by design: an old
 * payload has none (null = default art), junk is dropped, and ids this client does not know are KEPT (a newer
 * client's item simply resolves to nothing here) so a snapshot never loses information by passing through.
 */
export function parseCosmeticSnapshot(v: unknown): RunCosmeticSnapshot | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const heroSkinByHeroId = parseSkinMap(o.heroSkinByHeroId);
  const minionSkinByCardId = parseSkinMap(o.minionSkinByCardId);
  const heroAttack = typeof o.heroAttack === 'string' && ID_RE.test(o.heroAttack) ? o.heroAttack : undefined;
  const title = typeof o.title === 'string' && ID_RE.test(o.title) ? o.title : undefined;
  const portraitFrame = typeof o.portraitFrame === 'string' && ID_RE.test(o.portraitFrame) ? o.portraitFrame : undefined;
  const cardPlate = typeof o.cardPlate === 'string' && ID_RE.test(o.cardPlate) ? o.cardPlate : undefined;
  if (!heroSkinByHeroId && !minionSkinByCardId && !heroAttack && !title && !portraitFrame && !cardPlate) return null;
  return {
    ...(heroSkinByHeroId ? { heroSkinByHeroId } : {}), ...(minionSkinByCardId ? { minionSkinByCardId } : {}),
    ...(heroAttack ? { heroAttack } : {}), ...(title ? { title } : {}), ...(portraitFrame ? { portraitFrame } : {}),
    ...(cardPlate ? { cardPlate } : {}),
  };
}

/** A loadout row as the SQL returns it (`progression_profile_json.loadout`). */
export interface LoadoutRow { slot: string; targetId: string; cosmeticId: string }

/** Fold loadout rows (camelCase from the SQL JSON, or snake_case from a table read) into the snapshot shape. */
export function loadoutFromRows(rows: unknown): RunCosmeticSnapshot {
  const hero: Record<string, string> = {};
  const minion: Record<string, string> = {};
  let attack: string | undefined;
  let frame: string | undefined;
  let voice: string | undefined;
  let plate: string | undefined;
  const emotes: Record<string, string> = {};
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const slot = o.slot; const target = o.targetId ?? o.target_id; const id = o.cosmeticId ?? o.cosmetic_id;
      if (typeof id !== 'string' || !ID_RE.test(id)) continue;
      // The hero attack is account-wide: its row's target is '' (the global slot).
      if (slot === 'hero_attack') { if (target === '' || target === undefined) attack = id; continue; }
      // So is the portrait frame (2026-10-01).
      if (slot === 'portrait_frame') { if (target === '' || target === undefined) frame = id; continue; }
      // And the announcer (2026-10-11).
      if (slot === 'announcer') { if (target === '' || target === undefined) voice = id; continue; }
      // And the card plate (2026-10-14).
      if (slot === 'card_plate') { if (target === '' || target === undefined) plate = id; continue; }
      // The emote slot (2026-10-13) keys by menu position.
      if (slot === 'emote') { if (typeof target === 'string' && EMOTE_POSITION_RE.test(target)) emotes[target] = id; continue; }
      if (typeof target !== 'string' || !ID_RE.test(target)) continue;
      if (slot === 'hero_skin') hero[target] = id;
      else if (slot === 'minion_skin') minion[target] = id;
    }
  }
  return {
    ...(Object.keys(hero).length ? { heroSkinByHeroId: hero } : {}),
    ...(Object.keys(minion).length ? { minionSkinByCardId: minion } : {}),
    ...(attack ? { heroAttack: attack } : {}),
    ...(frame ? { portraitFrame: frame } : {}),
    ...(voice ? { announcer: voice } : {}),
    ...(plate ? { cardPlate: plate } : {}),
    ...(Object.keys(emotes).length ? { emotes } : {}),
  };
}

/**
 * The skin a HERO renders with under this snapshot, or null for default art. Null whenever the named item is
 * unknown, retired (item or category, TS or server), the wrong category, or made for a DIFFERENT hero, so a
 * stale, forged or removed id can never put the wrong art on screen.
 */
export function heroSkinOf(snapshot: RunCosmeticSnapshot | null | undefined, heroId: string | null | undefined): CosmeticDef | null {
  if (!snapshot || !heroId) return null;
  const c = cosmeticOf(snapshot.heroSkinByHeroId?.[heroId]);
  return c && c.category === 'hero_skin' && c.target?.type === 'hero' && c.target.id === heroId && isCosmeticLive(c.id) ? c : null;
}

/** The skin a CARD renders with under this snapshot, or null. Same guarantees as `heroSkinOf`; a token has its
 *  own card id, so a parent's skin never reaches its tokens (handoff §5.6). */
export function minionSkinOf(snapshot: RunCosmeticSnapshot | null | undefined, cardId: string | null | undefined): CosmeticDef | null {
  if (!snapshot || !cardId) return null;
  const c = cosmeticOf(snapshot.minionSkinByCardId?.[cardId]);
  return c && c.category === 'minion_skin' && c.target?.type === 'card' && c.target.id === cardId && isCosmeticLive(c.id) ? c : null;
}

/**
 * The hero attack this snapshot plays, or null for Classic. Null whenever the item is unknown, retired (item or
 * category, TS or server) or not a hero attack, so a stale or forged id always falls back to Classic.
 */
export function heroAttackOf(snapshot: RunCosmeticSnapshot | null | undefined): CosmeticDef | null {
  const c = cosmeticOf(snapshot?.heroAttack);
  return c && c.category === 'hero_attack' && isCosmeticLive(c.id) ? c : null;
}

/**
 * The TITLE this snapshot shows, or null for none. Null whenever the id is unknown (a newer server's title, garbage
 * from an old replay), retired (item or category, TS or server) or not a title, so a stale or forged id never puts
 * a name on screen.
 */
export function titleOf(snapshot: RunCosmeticSnapshot | null | undefined): CosmeticDef | null {
  const c = cosmeticOf(snapshot?.title);
  return c && c.category === 'title' && isCosmeticLive(c.id) ? c : null;
}

/**
 * The PORTRAIT FRAME this snapshot wears, or null for the default ring. Null whenever the id is unknown, retired (item
 * or category, TS or server) or not a portrait frame, so a stale or forged id always falls back to the default ring.
 */
export function portraitFrameOf(snapshot: RunCosmeticSnapshot | null | undefined): CosmeticDef | null {
  const c = cosmeticOf(snapshot?.portraitFrame);
  return c && c.category === 'portrait_frame' && isCosmeticLive(c.id) ? c : null;
}

/**
 * The CARD PLATE this snapshot wears, or null for the standard plates. Null whenever the id is unknown, retired (item or
 * category, TS or server) or not a card plate, so a stale or forged id always falls back to the standard plates.
 */
export function cardPlateOf(snapshot: RunCosmeticSnapshot | null | undefined): CosmeticDef | null {
  const c = cosmeticOf(snapshot?.cardPlate);
  return c && c.category === 'card_plate' && isCosmeticLive(c.id) ? c : null;
}

/**
 * The ANNOUNCER this loadout speaks with, or null for the default voice. Null whenever the id is unknown, retired (item
 * or category, TS or server) or not an announcer, so a stale or forged id always falls back to the default announcer.
 */
export function announcerOf(loadout: RunCosmeticSnapshot | null | undefined): CosmeticDef | null {
  const c = cosmeticOf(loadout?.announcer);
  return c && c.category === 'announcer' && isCosmeticLive(c.id) ? c : null;
}

// ── Emotes: the four-position menu (owner 2026-10-13) ─────────────────────────────────────────────────────

/** How many emotes the in-game menu holds (owner 2026-10-13: "showing their 4 equipped emotes"). */
export const EMOTE_SLOT_COUNT = 4;
/** A menu position, as the loadout row's target: '0'..'3'. */
export const EMOTE_POSITION_RE = /^[0-3]$/;

/** Is this item a STARTER (every player owns it from the start, no ownership row)? */
export const isStarterCosmetic = (id: string | null | undefined): boolean => cosmeticOf(id)?.acquisition.type === 'starter';

/** The ACTIVE starter emotes in catalog order: since 2026-10-15 just Zen Brian (Angry Mushy, the other starter row, is
 *  retired), so a fresh account's menu is Zen Brian and three empty slots. */
export const STARTER_EMOTE_IDS: readonly string[] = Object.freeze(COSMETICS.filter((c) => c.category === 'emote' && c.acquisition.type === 'starter' && c.active).map((c) => c.id));

/** Every owned id, plus the ACTIVE starter items everyone owns (a guest and an offline player included). A retired
 *  starter is no longer handed out (it was never an ownership row, so there is nothing to keep). */
export function withStarterCosmetics(owned: readonly string[] | null | undefined): string[] {
  const out = [...(owned ?? [])];
  for (const c of COSMETICS) if (c.acquisition.type === 'starter' && c.active && !out.includes(c.id)) out.push(c.id);
  return out;
}

/** A LIVE emote item, or null (unknown, retired, another category). */
export function emoteOf(id: string | null | undefined): CosmeticDef | null {
  const c = cosmeticOf(id);
  return c && c.category === 'emote' && isCosmeticLive(c.id) ? c : null;
}

/**
 * THE MENU A LOADOUT SHOWS, by position: `EMOTE_SLOT_COUNT` entries, an emote id or null (an empty position).
 * `owned` = the player's owned ids (the profile's `cosmetics`); given, only an emote they OWN (or a starter) can show,
 * so an old row naming an emote they no longer own, or a device-local row, never puts it in the menu. Absent = trust
 * the rows (ownership unknown).
 * An explicit row wins its position (a duplicate keeps only its lowest position; a retired, unknown or unowned id is
 * dropped). Every empty position then takes, from the player's DEFAULT emotes (every usable owned emote and starter,
 * in catalog order): its own default when that is not already shown, else one pushed out of its own position, else
 * the first not shown yet. So owned emotes appear in the menu without being placed (up to four), putting one in another
 * position SWAPS it with the one that was there, and a fresh account shows the one starter, Zen Brian, then empty
 * positions (2026-10-15).
 */
export function emoteSlotsOf(loadout: RunCosmeticSnapshot | null | undefined, owned?: readonly string[] | null): (string | null)[] {
  const have = owned == null ? null : new Set(owned);
  const usable = (id: string): boolean => !!emoteOf(id) && (!have || have.has(id) || isStarterCosmetic(id));
  const slots: (string | null)[] = Array.from({ length: EMOTE_SLOT_COUNT }, () => null);
  const used = new Set<string>();
  for (let i = 0; i < EMOTE_SLOT_COUNT; i++) {
    const id = loadout?.emotes?.[String(i)];
    if (id && !used.has(id) && usable(id)) { slots[i] = id; used.add(id); }
  }
  const defaults = COSMETICS
    .filter((c) => c.category === 'emote' && usable(c.id) && (c.acquisition.type === 'starter' || (have?.has(c.id) ?? false)))
    .map((c) => c.id);
  // The defaults pushed out of their own position by an explicit emote go first into the gaps (the swap).
  const displaced = defaults.filter((id, k) => !used.has(id) && k < EMOTE_SLOT_COUNT && slots[k] !== null);
  for (let i = 0; i < EMOTE_SLOT_COUNT; i++) {
    if (slots[i]) continue;
    const own = defaults[i];
    const pick = own && !used.has(own) ? own : displaced.find((id) => !used.has(id)) ?? defaults.find((id) => !used.has(id));
    if (pick) { slots[i] = pick; used.add(pick); }
  }
  return slots;
}

/** The emotes the menu shows, in position order, empty positions left out (see `emoteSlotsOf`). */
export function emoteLoadoutOf(loadout: RunCosmeticSnapshot | null | undefined, owned?: readonly string[] | null): string[] {
  return emoteSlotsOf(loadout, owned).filter((x): x is string => !!x);
}

/** The menu position (0..3) an emote sits in under this loadout, or -1. */
export const emotePositionOf = (loadout: RunCosmeticSnapshot | null | undefined, id: string, owned?: readonly string[] | null): number => emoteSlotsOf(loadout, owned).indexOf(id);

/** A loadout with one emote put in `position` (the SQL's move: the same emote leaves any other position). Pure. */
export function withEmoteAt(loadout: RunCosmeticSnapshot | null | undefined, position: number, id: string | null): RunCosmeticSnapshot {
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries(loadout?.emotes ?? {})) if (v !== id) map[k] = v;
  if (id) map[String(position)] = id; else delete map[String(position)];
  const out: RunCosmeticSnapshot = { ...(loadout ?? {}) };
  if (Object.keys(map).length) (out as { emotes?: Record<string, string> }).emotes = map;
  else delete (out as { emotes?: Record<string, string> }).emotes;
  return out;
}

/** A loadout with the profile's equipped title folded in (the loadout rows never carry it; the profile does). */
export function withEquippedTitle(loadout: RunCosmeticSnapshot | null | undefined, titleId: string | null | undefined): RunCosmeticSnapshot | null {
  if (!titleId) return loadout ?? null;
  return { ...(loadout ?? {}), title: titleId };
}

/** The skins that target one hero or card (the Collection's per-target list). */
export const skinsForTarget = (slot: SkinSlot, targetId: string, catalog: readonly CosmeticDef[] = COSMETICS): CosmeticDef[] =>
  catalog.filter((c) => c.category === slot && c.target?.id === targetId);

/**
 * The snapshot a run RECORDS: the live loadout narrowed to what this run can show (handoff §13: "only include
 * cosmetics actually relevant to the participants"), and to LIVE items only (a retired skin is not recorded).
 * `heroIds` / `cardIds` absent = keep every entry of that kind. Null when nothing is left, so old and new
 * payloads without skins look identical.
 */
export function snapshotForRun(
  loadout: RunCosmeticSnapshot | null | undefined,
  scope: { heroIds?: Iterable<string>; cardIds?: Iterable<string> } = {},
): RunCosmeticSnapshot | null {
  if (!loadout) return null;
  const heroes = scope.heroIds ? new Set(scope.heroIds) : null;
  const cards = scope.cardIds ? new Set(scope.cardIds) : null;
  const hero: Record<string, string> = {};
  const minion: Record<string, string> = {};
  for (const [h, id] of Object.entries(loadout.heroSkinByHeroId ?? {})) if ((!heroes || heroes.has(h)) && heroSkinOf(loadout, h)) hero[h] = id;
  for (const [k, id] of Object.entries(loadout.minionSkinByCardId ?? {})) if ((!cards || cards.has(k)) && minionSkinOf(loadout, k)) minion[k] = id;
  // The hero attack is account-wide, so every run records it (the hero it strikes with is always in the run).
  const attack = heroAttackOf(loadout)?.id;
  // The title is account-wide too, and only a LIVE one is recorded (a retired title is never written down).
  const title = titleOf(loadout)?.id;
  // The portrait frame is account-wide too (2026-10-01): every run records a LIVE one.
  const frame = portraitFrameOf(loadout)?.id;
  // And so is the card plate (2026-10-14): every run records a LIVE one.
  const plate = cardPlateOf(loadout)?.id;
  if (!Object.keys(hero).length && !Object.keys(minion).length && !attack && !title && !frame && !plate) return null;
  return {
    ...(Object.keys(hero).length ? { heroSkinByHeroId: hero } : {}),
    ...(Object.keys(minion).length ? { minionSkinByCardId: minion } : {}),
    ...(attack ? { heroAttack: attack } : {}),
    ...(title ? { title } : {}),
    ...(frame ? { portraitFrame: frame } : {}),
    ...(plate ? { cardPlate: plate } : {}),
  };
}

// ── The catalog sync: code is the source of truth (owner 2026-09-28) ─────────────────────────────────────

/**
 * THE CATALOG AS THE DATABASE RECEIVES IT (owner 2026-09-28: "yeah let's do option 2 then to make it automated when
 * i add skins"). The `progression-inventory` Edge Function bundles a generated copy of this file and, on the first
 * request of every cold start, hands this payload to `sync_cosmetic_catalog`, which upserts the categories and items
 * and marks any item no longer in code `active = false` (never deleted: ownership references it). So adding or
 * retiring a cosmetic is: art + an entry here, `npm run progression:shared`, merge, deploy `progression-inventory`.
 * No SQL.
 *
 * The owner's EMERGENCY switch is a different column (`admin_off`) that the sync never writes, so a one-line SQL
 * retire always wins over the next deploy.
 *
 * Sorted by id, so the payload (and its hash) depends only on the catalog's content, never on array order.
 */
export interface CatalogSyncCategory { category: string; weight: number; enabled: boolean; target: string }
export interface CatalogSyncItem {
  cosmeticId: string;
  category: string;
  rarity: string;
  acquisitionSource: string;
  milestoneLevel: number | null;
  targetType: string | null;
  targetId: string | null;
  achievementId: string | null;
  active: boolean;
}
export interface CatalogSyncPayload { version: 1; categories: CatalogSyncCategory[]; items: CatalogSyncItem[] }

const byKey = <T>(key: (x: T) => string) => (a: T, b: T): number => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);

export function catalogSyncPayload(
  catalog: readonly CosmeticDef[] = COSMETICS,
  defs: Readonly<Record<CosmeticCategory, CosmeticCategoryDef>> = COSMETIC_CATEGORY_DEFS,
): CatalogSyncPayload {
  return {
    version: 1,
    categories: Object.values(defs)
      .map((d) => ({ category: d.id, weight: d.weight, enabled: d.enabled, target: d.target }))
      .sort(byKey((c) => c.category)),
    items: catalog
      .map((c) => ({
        cosmeticId: c.id,
        category: c.category,
        rarity: c.rarity,
        acquisitionSource: c.acquisition.type,
        milestoneLevel: c.acquisition.type === 'level_milestone' ? c.acquisition.level : null,
        targetType: c.target?.type ?? null,
        targetId: c.target?.id ?? null,
        achievementId: c.acquisition.type === 'achievement' ? c.acquisition.id : null,
        active: c.active,
      }))
      .sort(byKey((i) => i.cosmeticId)),
  };
}

/**
 * A short, stable content hash of the payload (a 53-bit-strength string hash, no dependencies so the Deno copy
 * computes the same value). The database stores the last synced hash; an unchanged catalog is one cheap read.
 */
export function catalogHash(payload: CatalogSyncPayload): string {
  const s = JSON.stringify(payload);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `v1-${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}
