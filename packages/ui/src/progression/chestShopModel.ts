/**
 * THE CHEST SHOP'S PURE MODEL (docs/superpowers/specs/2026-10-20-chest-shop-screen-design.md): no React, no store. The
 * shop's category order, the receipt rows (the focus cost, then each extra category's discount), the odds-bar slices and
 * the per-category "left to find" counts. Every price here goes through `focusFeePercent` with the same floor division as
 * `quoteCrate`, so the receipt always adds up to exactly what the server charges.
 */
import {
  COSMETIC_RARITIES, eligibleForCrate, focusFeePercent, isCategoryLive, isFocusableCategory, tieredCrateChances,
  type AetherEconomy, type CosmeticCategory, type CosmeticRarity,
} from '@game/progression';

/** The order the shop lists focus categories in (owner's design; Announcers are not focusable and are not listed). */
export const SHOP_FOCUS_ORDER: readonly CosmeticCategory[] = Object.freeze([
  'hero_skin', 'minion_skin', 'card_plate', 'portrait_frame', 'hero_attack', 'emote', 'title',
] as CosmeticCategory[]);

/** The shop's focus categories: the shop order, kept to those the server has live and that can be a focus. */
export function shopFocusCategories(): CosmeticCategory[] {
  return SHOP_FOCUS_ORDER.filter((c) => isCategoryLive(c) && isFocusableCategory(c));
}

/** How many items each category still has in the UNFOCUSED pool at this floor (Announcers included; the UI just
 *  doesn't show that row). Sums to `eligibleForCrate(owned, floor, null).length`. */
export function leftByCategory(owned: Iterable<string>, floor: CosmeticRarity): Map<CosmeticCategory, number> {
  const out = new Map<CosmeticCategory, number>();
  for (const c of eligibleForCrate(owned, floor, null)) out.set(c.category, (out.get(c.category) ?? 0) + 1);
  return out;
}

export interface ReceiptRow { category: CosmeticCategory; amount: number }
export interface FocusReceipt {
  /** Row 0 is the cost of focusing the first category (positive); each later row is that category's discount (<= 0). */
  rows: ReceiptRow[];
  /** Every available category is ticked: that is no focus, and costs nothing. */
  noFocus: boolean;
}

/**
 * The focus receipt for `ticked` (already in shop order and limited to available categories). Null when nothing is
 * ticked. With fee(k) = floor(price * focusFeePercent(k, available) / 100): row 0 = fee(1), row k = -(fee(k) - fee(k+1)),
 * so the rows sum to fee(ticked.length), the fee `quoteCrate` charges.
 */
export function focusReceipt(i: {
  price: number; ticked: readonly CosmeticCategory[]; available: number; economy?: AetherEconomy;
}): FocusReceipt | null {
  if (i.ticked.length === 0) return null;
  const fee = (k: number) => Math.floor((i.price * focusFeePercent(k, i.available, i.economy)) / 100);
  const rows = i.ticked.map((category, k): ReceiptRow => ({ category, amount: k === 0 ? fee(1) : -(fee(k) - fee(k + 1)) }));
  return { rows, noFocus: i.ticked.length >= i.available };
}

export interface OddsSlice {
  rarity: CosmeticRarity;
  /** Share of the chest, in percent, to one decimal (same rounding as the old odds line). */
  percent: number;
  /** Items of this rarity still in the pool. */
  count: number;
  byCategory: { category: CosmeticCategory; count: number }[];
}

/** The odds bar's slices for this exact chest (floor + focus + what the player doesn't own): rarities with a share,
 *  lowest first; each lists its per-category counts in shop order, then any other category (Announcers) last. */
export function oddsSlices(owned: Iterable<string>, floor: CosmeticRarity, focus: readonly CosmeticCategory[] | null): OddsSlice[] {
  const eligible = eligibleForCrate(owned, floor, focus);
  const rarityOf = new Map(eligible.map((c) => [c.id, c.rarity] as const));
  const share = new Map<CosmeticRarity, number>();
  for (const [id, p] of tieredCrateChances(eligible, floor)) {
    const r = rarityOf.get(id)!;
    share.set(r, (share.get(r) ?? 0) + p);
  }
  const rank = (c: CosmeticCategory) => { const n = SHOP_FOCUS_ORDER.indexOf(c); return n < 0 ? SHOP_FOCUS_ORDER.length : n; };
  return COSMETIC_RARITIES.filter((r) => (share.get(r) ?? 0) > 0).map((rarity) => {
    const counts = new Map<CosmeticCategory, number>();
    for (const c of eligible) if (c.rarity === rarity) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
    const byCategory = [...counts].map(([category, count]) => ({ category, count }))
      .sort((a, b) => rank(a.category) - rank(b.category));
    return { rarity, percent: Math.round(share.get(rarity)! * 1000) / 10, count: byCategory.reduce((n, c) => n + c.count, 0), byCategory };
  });
}
