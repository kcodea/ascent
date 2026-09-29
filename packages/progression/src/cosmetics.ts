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
 * seeded from this file by the 2026-09-28 migration, and `open_crate` carries the rarity weights as constants.
 * `sqlParity.test.ts` parses the seed and the constants back out of the migration and fails CI on any drift.
 * Display names live only here (ids are permanent; a rename is a one-line client change).
 *
 * DEPENDENCY-FREE: generated verbatim into supabase/functions/_shared/progressionCosmetics.ts for the Deno Edge
 * Functions (`npm run progression:shared`).
 */

// ── Categories, rarities, weights ─────────────────────────────────────────────────────────────────────────

export const COSMETIC_CATEGORIES = ['announcer', 'hero_skin', 'minion_skin', 'title', 'hero_attack', 'board', 'music'] as const;
export type CosmeticCategory = typeof COSMETIC_CATEGORIES[number];

export const COSMETIC_RARITIES = ['common', 'rare', 'epic', 'legendary'] as const;
export type CosmeticRarity = typeof COSMETIC_RARITIES[number];

/** Handoff §5.4 base weights. Rarity is presentation and pacing, never power. */
export const RARITY_WEIGHTS: Readonly<Record<CosmeticRarity, number>> = Object.freeze({ common: 55, rare: 30, epic: 12, legendary: 3 });

/** Player-facing rarity labels. */
export const RARITY_LABELS: Readonly<Record<CosmeticRarity, string>> = Object.freeze({ common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' });

export interface CosmeticCategoryDef {
  id: CosmeticCategory;
  /** Player-facing section name (Collection). */
  label: string;
  /** Handoff §5.4 category weight among eligible items. */
  weight: number;
  /** The feature flag: a disabled category never drops from a crate and is hidden in the Collection. */
  enabled: boolean;
  /** What an item of this category targets: nothing (one global slot), a hero id, or a card id. */
  target: 'global' | 'hero' | 'card';
}

export const COSMETIC_CATEGORY_DEFS: Readonly<Record<CosmeticCategory, CosmeticCategoryDef>> = Object.freeze({
  announcer:   { id: 'announcer',   label: 'Announcers',        weight: 10, enabled: false, target: 'global' },
  hero_skin:   { id: 'hero_skin',   label: 'Heroes',            weight: 20, enabled: true,  target: 'hero' },
  minion_skin: { id: 'minion_skin', label: 'Minions',           weight: 35, enabled: true,  target: 'card' },
  title:       { id: 'title',       label: 'Titles',            weight: 10, enabled: true,  target: 'global' },
  // Owner 2026-09-28: "the new blast attack is going to be a cosmetic unlock, not a new default". Live since then.
  hero_attack: { id: 'hero_attack', label: 'Attack Animations', weight: 15, enabled: true,  target: 'global' },
  board:       { id: 'board',       label: 'Boards',            weight: 5,  enabled: false, target: 'global' },
  music:       { id: 'music',       label: 'Music',             weight: 5,  enabled: false, target: 'global' },
});

/** Bump when the roll changes (weights, normalization). Stored on every opened crate. */
export const CRATE_ROLL_VERSION = 1;

// ── The catalog ───────────────────────────────────────────────────────────────────────────────────────────

/** How an item is acquired. Exactly one source per item (handoff §5.2); only `crate` items ever drop. */
export type CosmeticAcquisition =
  | { type: 'crate' }
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
  // SKINS (owner 2026-09-28: "let's use these 2 black belt brian skins as our first 2 skin concepts" and "these 2
  // hero skins as our first 2 hero skin concepts"). Names and rarities are placeholders for the owner to rename.
  // Owner 2026-09-28 renamed the masters by rarity (Skin1 -> SkinRare, Skin2 -> SkinEpic; same art) and added a
  // Legendary: "i added a legendary black belt brian skin and renaemd skins to match their rarity". The name is a
  // placeholder for the owner to rename.
  skin('skin_blackbelt_1', 'minion_skin', 'Sheriff Brian', 'rare', 'blackbelt', 'BlackBeltBrianSkinRare.png'),
  skin('skin_blackbelt_2', 'minion_skin', 'Glitch Brian', 'epic', 'blackbelt', 'BlackBeltBrianSkinEpic.png'),
  skin('skin_blackbelt_3', 'minion_skin', 'Grandmaster Brian', 'legendary', 'blackbelt', 'BlackBeltBrianSkinLegendary.png'),
  // Owner 2026-09-28: "put the bellringer voss skin in too". Epic per the owner's filename; the name is a placeholder.
  skin('skin_bellringer_1', 'minion_skin', 'Clocktower Voss', 'epic', 'n2_bellringer', 'BellringerVossSkinEpic.png'),
  skin('skin_albus_1', 'hero_skin', 'Surf Day Albus', 'epic', 'albus', 'Albus1.png'),
  skin('skin_warden_1', 'hero_skin', 'Bath Day Warden', 'epic', 'warden', 'Warden1.png'),
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
  heroAttack('attack_arcana', 'Arcana', 'legendary', 'arcana'),
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
  heroAttack('attack_holy', 'Consecration', 'legendary', 'holy'),
]);

export const COSMETIC_INDEX: Readonly<Record<string, CosmeticDef>> = Object.freeze(
  Object.fromEntries(COSMETICS.map((c) => [c.id, c])),
);

export const cosmeticOf = (id: string | null | undefined): CosmeticDef | null => (id && COSMETIC_INDEX[id] ? COSMETIC_INDEX[id]! : null);

/** The level a level-milestone item is granted at, else null. */
export const milestoneLevelOf = (c: CosmeticDef): number | null => (c.acquisition.type === 'level_milestone' ? c.acquisition.level : null);

// ── The roll (handoff §5.4) ───────────────────────────────────────────────────────────────────────────────

/** An item's weight in the crate roll: rarity weight × category weight. */
export const crateWeightOf = (c: Pick<CosmeticDef, 'rarity' | 'category'>): number =>
  RARITY_WEIGHTS[c.rarity] * COSMETIC_CATEGORY_DEFS[c.category].weight;

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

export const crateTotalWeight = (eligible: readonly CosmeticDef[]): number => eligible.reduce((s, c) => s + crateWeightOf(c), 0);

/**
 * Pick ONE item from what actually remains, weighted, never rolling a rarity first (so a crate always produces an
 * item while any item remains). `roll` is an integer in [0, total weight); the SQL draws it as
 * `floor(random() * total)`. Null only when nothing is eligible.
 */
export function pickCrateReward(eligible: readonly CosmeticDef[], roll: number): CosmeticDef | null {
  const total = crateTotalWeight(eligible);
  if (total <= 0) return null;
  const r = Math.min(total - 1, Math.max(0, Math.floor(roll)));
  let acc = 0;
  for (const c of eligible) {
    acc += crateWeightOf(c);
    if (r < acc) return c;
  }
  return eligible[eligible.length - 1] ?? null;
}

// ── Crates: the shapes the server returns ─────────────────────────────────────────────────────────────────

export type CrateState = 'sealed' | 'opened';

export interface CrateRow {
  crateId: string;
  /** The level that earned it (1 = the Welcome Crate). */
  earnedLevel: number;
  state: CrateState;
  rewardId: string | null;
  earnedAt: string | null;
  openedAt: string | null;
}

/** A crate's player-facing name. */
export const crateName = (earnedLevel: number): string => (earnedLevel <= 1 ? 'Welcome Crate' : `Level ${earnedLevel} Crate`);

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
  if (!crateId || earnedLevel === null || earnedLevel < 1 || (state !== 'sealed' && state !== 'opened')) return null;
  return {
    crateId, earnedLevel, state,
    rewardId: str(o.rewardId ?? o.reward_cosmetic_id),
    earnedAt: str(o.earnedAt ?? o.earned_at),
    openedAt: str(o.openedAt ?? o.opened_at),
  };
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
/** Every slot `equip_cosmetic` accepts: the two per-target skin slots and the account-wide hero attack (target ''). */
export type EquipSlot = SkinSlot | 'hero_attack';
export const EQUIP_SLOTS: readonly EquipSlot[] = ['hero_skin', 'minion_skin', 'hero_attack'];

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
  if (!heroSkinByHeroId && !minionSkinByCardId && !heroAttack && !title) return null;
  return {
    ...(heroSkinByHeroId ? { heroSkinByHeroId } : {}), ...(minionSkinByCardId ? { minionSkinByCardId } : {}),
    ...(heroAttack ? { heroAttack } : {}), ...(title ? { title } : {}),
  };
}

/** A loadout row as the SQL returns it (`progression_profile_json.loadout`). */
export interface LoadoutRow { slot: string; targetId: string; cosmeticId: string }

/** Fold loadout rows (camelCase from the SQL JSON, or snake_case from a table read) into the snapshot shape. */
export function loadoutFromRows(rows: unknown): RunCosmeticSnapshot {
  const hero: Record<string, string> = {};
  const minion: Record<string, string> = {};
  let attack: string | undefined;
  if (Array.isArray(rows)) {
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const slot = o.slot; const target = o.targetId ?? o.target_id; const id = o.cosmeticId ?? o.cosmetic_id;
      if (typeof id !== 'string' || !ID_RE.test(id)) continue;
      // The hero attack is account-wide: its row's target is '' (the global slot).
      if (slot === 'hero_attack') { if (target === '' || target === undefined) attack = id; continue; }
      if (typeof target !== 'string' || !ID_RE.test(target)) continue;
      if (slot === 'hero_skin') hero[target] = id;
      else if (slot === 'minion_skin') minion[target] = id;
    }
  }
  return {
    ...(Object.keys(hero).length ? { heroSkinByHeroId: hero } : {}),
    ...(Object.keys(minion).length ? { minionSkinByCardId: minion } : {}),
    ...(attack ? { heroAttack: attack } : {}),
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
  if (!Object.keys(hero).length && !Object.keys(minion).length && !attack && !title) return null;
  return {
    ...(Object.keys(hero).length ? { heroSkinByHeroId: hero } : {}),
    ...(Object.keys(minion).length ? { minionSkinByCardId: minion } : {}),
    ...(attack ? { heroAttack: attack } : {}),
    ...(title ? { title } : {}),
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
