import { aetherShort, canAfford, COSMETIC_CATEGORIES, ownsEveryCosmetic, type CosmeticCategory, type CrateRarity, type OwnedPack, type PackLook, type PackOffer } from '@game/progression';
import { SCRIBBLE_PACK_LOOK_ID, STYLE_PACKS } from '../packOpening/packArt';
import { packRarityLabel } from '../packOpening/packRarity';
import { startScroll } from './shopLayout';

/**
 * THE PACK SHOP'S TEXT AND ORDER (pure; spec docs/superpowers/specs/2026-11-25-pack-shop-design.md). The tag under each
 * pack, the screen-reader line for it, the order packs stand in on a shelf, and which packs the balance covers.
 */
export interface PackTag {
  price: string;
  /** What the pack promises, as its roll gives it (`packGuarantee`): a Rarity pack's floor, or a Category / style pack's guaranteed fifth card. */
  floor: string;
  /** Aether missing to buy it; 0 when the balance covers it. */
  short: number;
  soldOut: boolean;
}

/**
 * WHAT A PACK GUARANTEES, by the owner's roll rulings (2026-11-27, docs/superpowers/specs/2026-11-23-pack-opening-design.md
 * §12): a RARITY pack guarantees only its fifth card, at its rarity or higher (cards 1-4 at Common-pack odds; owner
 * 2026-11-27: "no they are just guaranteeing that the final pull is of that tier or higher"); a CATEGORY pack's fifth card is from its
 * own category and never a duplicate, and the STYLE packs (Scribble and its kin) count as category packs, their fifth card
 * from their style. Themed looks with no ruling yet (Launch, Season, Secret: on no shelf) keep their rarity floor. The
 * economy project's roll must follow the same rulings; this is the shop's one reading of them (owner 2026-11-27: "we need
 * to be more accurate with the thumbnails, now that we have new logic in place for themed packs").
 */
export type PackGuarantee =
  | { kind: 'rarity'; rarity: CrateRarity }
  | { kind: 'category'; category: CosmeticCategory; label: string }
  | { kind: 'style'; label: string };

const STYLE_IDS = new Set<string>([SCRIBBLE_PACK_LOOK_ID, ...STYLE_PACKS.map((p) => p.id)]);
/** "hero_skin" -> "Hero Skin". */
const categoryName = (c: CosmeticCategory): string => c.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export function packGuarantee(look: PackLook): PackGuarantee {
  if (look.kind === 'category') {
    const c = look.id.replace(/^category-/, '');
    if ((COSMETIC_CATEGORIES as readonly string[]).includes(c)) return { kind: 'category', category: c as CosmeticCategory, label: categoryName(c as CosmeticCategory) };
  }
  if (look.kind === 'themed' && STYLE_IDS.has(look.id)) return { kind: 'style', label: look.name.replace(/\s+Pack$/i, '') };
  return { kind: 'rarity', rarity: look.guaranteedFloor };
}

/** The tag's promise line for `offer`. Once the player owns every cosmetic a category pack can give, its fifth card can only be a duplicate. */
function guaranteeLine(offer: PackOffer): string {
  const g = packGuarantee(offer.look);
  if (g.kind === 'rarity') return g.rarity === 'ancient' ? '4 random cards + 1 Ancient' : `4 random cards + 1 ${packRarityLabel(g.rarity)} or better`;
  const what = g.kind === 'category' ? g.label : `${g.label} cosmetic`;
  return ownsEveryCosmetic(offer) ? `4 random cards + 1 ${what} (you own them all)` : `4 random cards + 1 guaranteed new ${what}`;
}

export function packTag(offer: PackOffer, aether: number): PackTag {
  return {
    price: offer.price === 0 ? 'Free' : `${offer.price} Aether`,
    floor: guaranteeLine(offer),
    short: aetherShort(offer, aether),
    soldOut: !!offer.soldOut,
  };
}

/**
 * The offers on one shelf, in the given order. (No featured-first sort: the rack opens on `startIndex`, so a featured
 * pack already stands on the pedestal with its neighbours on both sides.)
 */
export function shelfOffers(offers: readonly PackOffer[], shelfId: string): PackOffer[] {
  return offers.filter((o) => o.shelf === shelfId);
}

/**
 * The offer a rack opens on (the pedestal), for a new rack and on every tab change: the first `featured` offer, else the
 * first `new` one, else the middle (`startScroll`), so both sides of the shelf are filled.
 */
export function startIndex(offers: readonly PackOffer[]): number {
  const featured = offers.findIndex((o) => o.badge === 'featured');
  if (featured >= 0) return featured;
  const fresh = offers.findIndex((o) => o.badge === 'new');
  return fresh >= 0 ? fresh : startScroll(offers.length);
}

/**
 * A themed pack's COLLECTION COUNT, "owned/total" (owner 2026-11-27: "we need to add a counter to each of the themed packs that shows how many of the themed cards they have unlocked of the amount available. show it here, have it in the hover tooltip as well as a N/N value. keep it white and the same size as the card packs in stock numbers"): how many of the cosmetics its guaranteed card can give the
 * player already owns. Null for a Rarity pack, or when the quote carries no count.
 */
export function ownedCount(offer: PackOffer): { owned: number; total: number; text: string } | null {
  const n = offer.newToYou;
  if (offer.look.kind === 'rarity' || !n || n.total <= 0) return null;
  const owned = Math.max(0, Math.min(n.total, n.total - n.unowned));
  return { owned, total: n.total, text: `${owned}/${n.total}` };
}

/** One comma-separated line a screen reader speaks for a pack. */
export function srLine(offer: PackOffer, aether: number): string {
  const t = packTag(offer, aether);
  const parts = [offer.look.name];
  if (offer.contains > 1) parts.push(`${offer.contains} packs`);
  parts.push(t.price, t.floor);
  const own = ownedCount(offer);
  if (own) parts.push(`${own.owned} of ${own.total} collected`);
  if (t.soldOut) parts.push('Sold out');
  else if (t.short > 0) parts.push(`Need ${t.short} more Aether`);
  return parts.join(', ');
}

/** What a purchase is keyed on: the offer AND the quote, so a changed price is a different buy. */
export const buyKey = (offer: PackOffer): string => `${offer.offerId}|${offer.price}`;

export function affordableIds(offers: readonly PackOffer[], aether: number): Set<string> {
  const ids = new Set<string>();
  for (const o of offers) if (canAfford(o, aether)) ids.add(o.offerId);
  return ids;
}

/**
 * THE COUNTER HOLDS 7 PACK TYPES, 8 PACKS OF EACH (owner 2026-11-26: "they should stack once per purchase, up to a max of
 * 8. lets cap it at 7 different pack types that can be on the store counter at a time. the player cannot purchase any more
 * packs until a slot opens up"). Packs that do not fit (rewards given while the counter is full) WAIT beside it and take a
 * place as packs are opened.
 */
export const COUNTER_TYPES_MAX = 5; // owner 2026-11-26: "cap the max pack types at 5" (was 7)
export const STACK_MAX = 8;
export const NO_ROOM_NOTE = 'No room on the counter. Open packs to clear space';
/** A pack's type: packs of one type lie in one stack. */
export const lookKey = (look: PackLook): string => `${look.kind}:${look.id}`;
/** Packs of one type waiting for room on the counter. */
export interface WaitingPacks { key: string; look: PackLook; count: number }

/**
 * The hand, split: the packs on the counter (the first `COUNTER_TYPES_MAX` types owned, in the order given, up to
 * `STACK_MAX` of each) and the rest, counted by type.
 */
export function counterSplit(hand: readonly OwnedPack[]): { counter: OwnedPack[]; waiting: WaitingPacks[] } {
  const stacks = new Map<string, number>();
  const wait = new Map<string, WaitingPacks>();
  const counter: OwnedPack[] = [];
  for (const p of hand) {
    const key = lookKey(p.look), n = stacks.get(key);
    if (n === undefined ? stacks.size < COUNTER_TYPES_MAX : n < STACK_MAX) { stacks.set(key, (n ?? 0) + 1); counter.push(p); continue; }
    const w = wait.get(key);
    if (w) w.count += 1; else wait.set(key, { key, look: p.look, count: 1 });
  }
  return { counter, waiting: [...wait.values()] };
}

/**
 * A bought pack of this type would have a place on the counter: its stack there is not full, or a place is free (owner
 * 2026-11-26: "theres a legendary pack on the counter. i should be able to stack these", also while other packs wait).
 */
export function counterHasRoom(hand: readonly OwnedPack[], look: PackLook): boolean {
  const key = lookKey(look);
  const stacks = new Map<string, number>(); // the stacks ON the counter (the first `COUNTER_TYPES_MAX` types owned)
  for (const p of hand) {
    const k = lookKey(p.look), c = stacks.get(k);
    if (c !== undefined) stacks.set(k, c + 1); else if (stacks.size < COUNTER_TYPES_MAX) stacks.set(k, 1);
  }
  const n = stacks.get(key);
  return n === undefined ? stacks.size < COUNTER_TYPES_MAX : n < STACK_MAX;
}

/** The offers that can be bought right now: the balance covers them and the counter has room. */
export function buyableIds(offers: readonly PackOffer[], aether: number, hand: readonly OwnedPack[]): Set<string> {
  const ids = affordableIds(offers, aether);
  for (const o of offers) if (ids.has(o.offerId) && !counterHasRoom(hand, o.look)) ids.delete(o.offerId);
  return ids;
}
