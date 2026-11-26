import { aetherShort, canAfford, type OwnedPack, type PackLook, type PackOffer } from '@game/progression';
import { packRarityLabel } from '../packOpening/packRarity';
import { startScroll } from './shopLayout';

/**
 * THE PACK SHOP'S TEXT AND ORDER (pure; spec docs/superpowers/specs/2026-11-25-pack-shop-design.md). The tag under each
 * pack, the screen-reader line for it, the order packs stand in on a shelf, and which packs the balance covers.
 */
export interface PackTag {
  price: string;
  floor: string;
  /** Aether missing to buy it; 0 when the balance covers it. */
  short: number;
  soldOut: boolean;
}

export function packTag(offer: PackOffer, aether: number): PackTag {
  const floor = offer.look.guaranteedFloor;
  return {
    price: offer.price === 0 ? 'Free' : `${offer.price} Aether`,
    floor: floor === 'ancient' ? 'Guaranteed Ancient' : `Guaranteed ${packRarityLabel(floor)} or better`,
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

/** One comma-separated line a screen reader speaks for a pack. */
export function srLine(offer: PackOffer, aether: number): string {
  const t = packTag(offer, aether);
  const parts = [offer.look.name];
  if (offer.contains > 1) parts.push(`${offer.contains} packs`);
  parts.push(t.price, t.floor);
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
