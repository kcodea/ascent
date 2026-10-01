import {
  COSMETICS, COSMETIC_CATEGORIES, COSMETIC_RARITIES, achievementOf, heroTitleInfo, isCategoryLive, isCosmeticLive, titleShelf,
  type CosmeticCategory, type CosmeticDef, type CosmeticRarity, type ProgressionProfile,
} from '@game/progression';
import { CARD_INDEX } from '@game/content';
import { HEROES } from '@game/sim';

/**
 * THE COLLECTION SCREEN'S MODEL (2026-09-28, owner ask: "i think the layout is horrible. research best in class
 * collection screens and mimic them"). Pure helpers, so the page stays a thin view and the rules are testable:
 *
 *   the album    every catalog item of a category, owned or not (Hearthstone / Marvel Snap show the whole set), in
 *                a STABLE order (rarest first, then catalog order) so an item never moves when you find it;
 *   filters      Show (All / Owned / Missing) x Rarity (All / one rarity);
 *   counts       owned / total, per category, per rarity, and overall;
 *   NEW          an owned item you have not looked at yet. A LOCAL flag per account (localStorage), never written
 *                to the server: it clears when you select the item (Fortnite's "clears on view").
 *
 * RETIRED ITEMS ARE HIDDEN (the kill switch, owner 2026-09-28: "we need to have the ability to remove any rewards
 * from the game"). An item that is not LIVE (`isCosmeticLive`: retired in the TS catalog or by the server's one-line
 * switch, or in a category switched off) is left out of the album, the counts and the tabs, owned or not. The
 * choice (over "owned but retired"): a removal is usually made because the item must not be SEEN any more (its art,
 * its name), and showing it in the owner's album keeps exactly that on screen; ownership is untouched on the server,
 * so a restore brings it back, still owned (and still equipped). The "N / M collected" total moves with it.
 */

export type ShowFilter = 'all' | 'owned' | 'missing';
export type RarityFilter = 'all' | CosmeticRarity;

/** Rarest first: the showcase row leads the album. */
const RARITY_RANK: Readonly<Record<CosmeticRarity, number>> = { legendary: 0, epic: 1, rare: 2, common: 3 };
const CATALOG_INDEX = new Map(COSMETICS.map((c, i) => [c.id, i]));

/** Categories kept OUT of the Collection rail while they are switched off (owner 2026-09-29: "hide music and boards
 *  from collections for now"). A hidden category still appears the moment the server switches it on. */
export const HIDDEN_WHEN_OFF: ReadonlySet<CosmeticCategory> = new Set<CosmeticCategory>(['board', 'music']);

/** The categories in rail order: the live ones first, then the ones switched off (a function: the server's switch
 *  can change which are live while the game runs). */
export const collectionCategories = (): CosmeticCategory[] => [
  ...COSMETIC_CATEGORIES.filter((c) => isCategoryLive(c)),
  ...COSMETIC_CATEGORIES.filter((c) => !isCategoryLive(c) && !HIDDEN_WHEN_OFF.has(c)),
];
/** The rail order at load (the bundled flags only). Prefer `collectionCategories()`. */
export const COLLECTION_CATEGORIES: readonly CosmeticCategory[] = collectionCategories();

export const categoryLive = (c: CosmeticCategory): boolean => isCategoryLive(c);

/**
 * Every LIVE item of a live category, in album order. A switched-off category shows none; a retired item never.
 * With `owned`, the Titles album shows each hero title ONCE (owner 2026-09-29, the master upgrades the title in
 * place): the golden master once you own it, else the base title (owned or not), never both.
 */
export function albumOf(category: CosmeticCategory, catalog: readonly CosmeticDef[] = COSMETICS, owned?: ReadonlySet<string>): CosmeticDef[] {
  if (!categoryLive(category)) return [];
  const items = catalog
    .filter((c) => c.category === category && c.active && isCosmeticLive(c.id))
    .sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || (CATALOG_INDEX.get(a.id) ?? 0) - (CATALOG_INDEX.get(b.id) ?? 0));
  if (category !== 'title') return items;
  const keep = new Set(titleShelf(items.map((c) => c.id), owned ?? new Set()));
  return items.filter((c) => keep.has(c.id));
}

/** Every item the collection can show today (all live categories): the header's "N / M collected". */
export function collectibleItems(catalog: readonly CosmeticDef[] = COSMETICS, owned?: ReadonlySet<string>): CosmeticDef[] {
  return collectionCategories().flatMap((c) => albumOf(c, catalog, owned));
}

// ── Ownership + what is worn (titles AND skins) ───────────────────────────────────────────────────────────

/** Every owned id: the profile's `cosmetics` (every category, since skins), else its titles (a pre-skins server). */
export const ownedIds = (p: Pick<ProgressionProfile, 'titles' | 'cosmetics'> | null | undefined): readonly string[] => p?.cosmetics ?? p?.titles ?? [];

/** Whether this item is the one worn: the title slot, the skin slot of the item's own hero / card, or the
 *  account-wide hero attack / portrait frame slot. */
export function isEquipped(item: CosmeticDef, p: Pick<ProgressionProfile, 'equippedTitleId' | 'loadout'> | null | undefined): boolean {
  if (!p) return false;
  if (item.category === 'title') return p.equippedTitleId === item.id;
  if (item.category === 'hero_attack') return p.loadout?.heroAttack === item.id;
  if (item.category === 'portrait_frame') return p.loadout?.portraitFrame === item.id;
  const target = item.target?.id;
  if (!target) return false;
  if (item.category === 'hero_skin') return p.loadout?.heroSkinByHeroId?.[target] === item.id;
  if (item.category === 'minion_skin') return p.loadout?.minionSkinByCardId?.[target] === item.id;
  return false;
}

/** A skin's target, by display name ("Black Belt Brian", "Albus"); null for anything else. */
export function skinTargetName(item: CosmeticDef): string | null {
  if (!item.target) return null;
  if (item.target.type === 'card') return CARD_INDEX[item.target.id]?.name ?? null;
  return HEROES.find((h) => h.id === item.target!.id)?.name ?? null;
}

export interface Count { owned: number; total: number }

export function countOf(items: readonly CosmeticDef[], owned: ReadonlySet<string>): Count {
  return { owned: items.filter((c) => owned.has(c.id)).length, total: items.length };
}

export function rarityCounts(items: readonly CosmeticDef[], owned: ReadonlySet<string>): Record<CosmeticRarity, Count> {
  const out = Object.fromEntries(COSMETIC_RARITIES.map((r) => [r, { owned: 0, total: 0 }])) as Record<CosmeticRarity, Count>;
  for (const c of items) {
    out[c.rarity].total++;
    if (owned.has(c.id)) out[c.rarity].owned++;
  }
  return out;
}

export function filterAlbum(items: readonly CosmeticDef[], owned: ReadonlySet<string>, show: ShowFilter, rarity: RarityFilter): CosmeticDef[] {
  return items.filter((c) => (rarity === 'all' || c.rarity === rarity) && (show === 'all' || (show === 'owned') === owned.has(c.id)));
}

/** How an item is found, in plain words for the detail panel. */
export function acquisitionText(c: CosmeticDef): string {
  // (Titles and skins share the sources; a skin's target is its own line in the detail panel.)
  switch (c.acquisition.type) {
    case 'crate': return 'Found in crates.';
    case 'level_milestone': return `Reach Level ${c.acquisition.level}.`;
    case 'achievement': return achievementOf(c.acquisition.id)?.requirement ?? 'Earned from an achievement.';
    case 'event': return 'Earned in an event.';
  }
}

/** The short "how to get it" line on a missing item. */
export function missingHint(c: CosmeticDef): string {
  if (c.acquisition.type === 'achievement') return achievementOf(c.acquisition.id)?.requirement ?? 'Not found yet.';
  return c.acquisition.type === 'level_milestone' ? `Reach Level ${c.acquisition.level} to earn it.` : c.acquisition.type === 'crate' ? 'Open crates to find it.' : 'Not found yet.';
}

/** A hero title's mastery line for the detail panel (owner 2026-09-29), or null for any other item. */
export function masteryText(c: CosmeticDef): string | null {
  const h = heroTitleInfo(c.id);
  if (!h) return null;
  if (h.master) return 'Mastered. Shown as a golden plate.';
  const req = achievementOf(`hero.${h.heroId}.mastery`)?.requirement;
  return req ? `${req.replace(/\.$/, '')} to make it a golden plate.` : null;
}

/** What a switched-off category will hold, for its "coming soon" view. */
export const COMING_BLURB: Readonly<Record<CosmeticCategory, string>> = {
  title: 'Titles to wear under your name.',
  announcer: 'New voices to call your games.',
  hero_skin: 'New looks for your heroes.',
  minion_skin: 'New looks for your minions.',
  hero_attack: 'New ways for your hero to strike.',
  board: 'New boards to fight on.',
  music: 'New music for your games.',
  portrait_frame: 'New rings for your hero portrait.',
};

// ── NEW: the local "seen" list ────────────────────────────────────────────────────────────────────────────

const SEEN_KEY = (userId: string): string => `ascent.collection.seen.${userId}`;

/** The item ids this account has looked at on this device. Empty when unreadable. */
export function loadSeen(userId: string | null | undefined): Set<string> {
  if (!userId) return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_KEY(userId)) ?? '[]') as unknown;
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Remember that `ids` were seen. Best-effort; local only (never sent anywhere). */
export function saveSeen(userId: string | null | undefined, seen: ReadonlySet<string>): void {
  if (!userId) return;
  try { localStorage.setItem(SEEN_KEY(userId), JSON.stringify([...seen])); } catch { /* best-effort */ }
}

/** An owned item not seen yet wears NEW. */
export const isNew = (id: string, owned: ReadonlySet<string>, seen: ReadonlySet<string>): boolean => owned.has(id) && !seen.has(id);
