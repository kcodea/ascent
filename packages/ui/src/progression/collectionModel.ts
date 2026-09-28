import {
  COSMETICS, COSMETIC_CATEGORIES, COSMETIC_CATEGORY_DEFS, COSMETIC_RARITIES,
  type CosmeticCategory, type CosmeticDef, type CosmeticRarity,
} from '@game/progression';

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
 */

export type ShowFilter = 'all' | 'owned' | 'missing';
export type RarityFilter = 'all' | CosmeticRarity;

/** Rarest first: the showcase row leads the album. */
const RARITY_RANK: Readonly<Record<CosmeticRarity, number>> = { legendary: 0, epic: 1, rare: 2, common: 3 };
const CATALOG_INDEX = new Map(COSMETICS.map((c, i) => [c.id, i]));

/** The categories in rail order: the live ones first, then the ones still switched off. */
export const COLLECTION_CATEGORIES: readonly CosmeticCategory[] = [
  ...COSMETIC_CATEGORIES.filter((c) => COSMETIC_CATEGORY_DEFS[c].enabled),
  ...COSMETIC_CATEGORIES.filter((c) => !COSMETIC_CATEGORY_DEFS[c].enabled),
];

export const categoryLive = (c: CosmeticCategory): boolean => COSMETIC_CATEGORY_DEFS[c].enabled;

/** Every active item of a live category, in album order. A switched-off category shows none. */
export function albumOf(category: CosmeticCategory, catalog: readonly CosmeticDef[] = COSMETICS): CosmeticDef[] {
  if (!categoryLive(category)) return [];
  return catalog
    .filter((c) => c.category === category && c.active)
    .sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || (CATALOG_INDEX.get(a.id) ?? 0) - (CATALOG_INDEX.get(b.id) ?? 0));
}

/** Every item the collection can show today (all live categories): the header's "N / M collected". */
export function collectibleItems(catalog: readonly CosmeticDef[] = COSMETICS): CosmeticDef[] {
  return COLLECTION_CATEGORIES.flatMap((c) => albumOf(c, catalog));
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
  switch (c.acquisition.type) {
    case 'crate': return 'Found in crates.';
    case 'level_milestone': return `Reach Level ${c.acquisition.level}.`;
    case 'achievement': return 'Earned from an achievement.';
    case 'event': return 'Earned in an event.';
  }
}

/** The short "how to get it" line on a missing item. */
export function missingHint(c: CosmeticDef): string {
  return c.acquisition.type === 'level_milestone' ? `Reach Level ${c.acquisition.level} to earn it.` : c.acquisition.type === 'crate' ? 'Open crates to find it.' : 'Not found yet.';
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
