import { aetherShort, canAfford, type PackOffer } from '@game/progression';
import { packRarityLabel } from '../packOpening/packRarity';

/**
 * THE PACK SHOP'S TEXT AND ORDER (pure; spec docs/superpowers/specs/2026-11-25-pack-shop-design.md). The tag under each
 * pack, the screen-reader line for it, the order packs stand in on a shelf, and which packs the balance covers.
 */
export interface PackTag {
  price: string;
  floor: string;
  /** How many of the pack's items the player does not own yet; null when the offer does not say. */
  fresh: string | null;
  /** Aether missing to buy it; 0 when the balance covers it. */
  short: number;
  soldOut: boolean;
}

const freshLine = (offer: PackOffer): string | null => {
  const n = offer.newToYou;
  if (!n) return null;
  return n.unowned === 0 ? 'Nothing new to you' : `${n.unowned} of ${n.total} new to you`;
};

export function packTag(offer: PackOffer, aether: number): PackTag {
  const floor = offer.look.guaranteedFloor;
  return {
    price: offer.price === 0 ? 'Free' : `${offer.price} Aether`,
    floor: floor === 'ancient' ? 'Guaranteed Ancient' : `Guaranteed ${packRarityLabel(floor)} or better`,
    fresh: freshLine(offer),
    short: aetherShort(offer, aether),
    soldOut: !!offer.soldOut,
  };
}

/** The offers on one shelf: `featured` first, every other keeping the given order (the sort is stable). */
export function shelfOffers(offers: readonly PackOffer[], shelfId: string): PackOffer[] {
  const on = offers.filter((o) => o.shelf === shelfId);
  return [...on.filter((o) => o.badge === 'featured'), ...on.filter((o) => o.badge !== 'featured')];
}

/** One comma-separated line a screen reader speaks for a pack. */
export function srLine(offer: PackOffer, aether: number): string {
  const t = packTag(offer, aether);
  const parts = [offer.look.name];
  if (offer.contains > 1) parts.push(`${offer.contains} packs`);
  parts.push(t.price, t.floor);
  if (t.fresh) parts.push(t.fresh);
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
