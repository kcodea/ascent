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
 * skin, title, hero attack, board, music). Only `title` is enabled today (owner 2026-09-27: "let's just do 15
 * titles to start"); the rest are switched off here AND in the SQL seed, so the owner's art slots in later as new
 * rows plus a flag flip, with no schema change.
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
  hero_skin:   { id: 'hero_skin',   label: 'Heroes',            weight: 20, enabled: false, target: 'hero' },
  minion_skin: { id: 'minion_skin', label: 'Minions',           weight: 35, enabled: false, target: 'card' },
  title:       { id: 'title',       label: 'Titles',            weight: 10, enabled: true,  target: 'global' },
  hero_attack: { id: 'hero_attack', label: 'Attack Animations', weight: 15, enabled: false, target: 'global' },
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
  /** Asset keys → paths (the owner's art slots in here). Titles are text and need none. */
  assets: Readonly<Record<string, string>>;
  /** False = retired: never acquired again, never removed from an owner. */
  active: boolean;
}

/** Owner 2026-09-27: the MVP's Level 2 title. A level milestone, so it is never in the crate pool. */
export const ALPHA_TESTER_TITLE_ID = 'alpha_tester';

const title = (id: string, name: string, rarity: CosmeticRarity): CosmeticDef =>
  ({ id, category: 'title', name, rarity, acquisition: { type: 'crate' }, assets: {}, active: true });

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
