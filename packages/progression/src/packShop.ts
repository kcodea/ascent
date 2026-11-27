/**
 * THE PACK SHOP CONTRACT (spec docs/superpowers/specs/2026-11-25-pack-shop-design.md, section 6).
 *
 * What the pack shop is handed and what a purchase answers with: the offers on the shelves, the packs a purchase puts in
 * the player's hand, and the outcome of a buy. The SERVER decides every price and charges the player; every number the
 * shop shows is a quote, and the helpers here only read a quote, they never decide one.
 *
 * DEPENDENCY-FREE ON PURPOSE, like the other progression files: sibling relative imports only. Not yet a shared
 * artifact (the economy project adds it to `SHARED_ARTIFACTS` once the server answers in this shape).
 */

import type { PackLook } from './packs';

/** One pack (or box of packs) standing on a shelf. */
export interface PackOffer {
  offerId: string;
  /** What it shows (art / name / colour). */
  look: PackLook;
  /** Aether; 0 = free. */
  price: number;
  /** On sale: the price before the discount (more than `price`). The shop shows the cut, never decides it. */
  fullPrice?: number;
  /** Which shelf (tab) it stands on: a `PackShelf.id`. */
  shelf: string;
  /** 1 for a pack; more for a box. */
  contains: number;
  newToYou?: { unowned: number; total: number };
  /** A limited offer: how many are left to buy (0 = sold out). Absent = unlimited. */
  stock?: number;
  badge?: 'new' | 'free' | 'featured';
  soldOut?: boolean;
}

export interface PackShelf {
  id: string;
  name: string;
}

/** A pack the player owns and has not opened yet. */
export interface OwnedPack {
  packId: string;
  look: PackLook;
}

/**
 * THE PACK REWARD (owner 2026-11-27: "Every 15 packs purchased gives the player one free Legendary Rarity Pack. it should glow and say 'Click to receive your reward' and when the player clicks it, it sparks and a legendary pack is sent to their counter. if it cant fit, send to their backpack"). Every `PACK_REWARD_EVERY` packs PURCHASED (a box counts each pack in it; a free pack is not
 * a purchase, and neither is the reward itself) earns one free Legendary Rarity Pack. Earned rewards wait (`ready`) until
 * the player claims them, one per claim; the count toward the next keeps going meanwhile.
 */
export const PACK_REWARD_EVERY = 15;
export interface PackRewardState {
  /** Packs purchased toward the next reward: 0 to PACK_REWARD_EVERY - 1. */
  progress: number;
  /** Rewards earned and not yet claimed. */
  ready: number;
}
/** The reward state after `bought` more purchased packs. */
export function packRewardAfter(state: PackRewardState, bought: number, every: number = PACK_REWARD_EVERY): PackRewardState {
  const total = Math.max(0, Math.floor(state.progress)) + Math.max(0, Math.floor(bought) || 0);
  return { progress: total % every, ready: Math.max(0, state.ready) + Math.floor(total / every) };
}
/** Why a claim did not go through: none waiting, a guest, or no answer. */
export type ClaimRewardError = 'none' | 'guest' | 'failed';
export type ClaimRewardOutcome =
  | { status: 'ok'; packs: readonly OwnedPack[] }
  | { status: 'error'; reason: ClaimRewardError };

/** Why a purchase did not go through. */
export type BuyPackError = 'insufficient' | 'price_changed' | 'sold_out' | 'guest' | 'failed';

export type BuyPackOutcome =
  | { status: 'ok'; packs: readonly OwnedPack[]; aether: number }
  | { status: 'error'; reason: BuyPackError; aether?: number };

/**
 * Whether the player already owns every cosmetic a CATEGORY pack can give (owner 2026-11-27: its guaranteed card is never
 * one they own, so once they own them all it can only be a duplicate). Rarity packs may always duplicate: never true.
 */
export function ownsEveryCosmetic(offer: PackOffer): boolean {
  return offer.look.kind !== 'rarity' && offer.newToYou?.unowned === 0;
}

/** The notice over a pack whose every cosmetic the player owns (owner 2026-11-27, his words, spelling fixed). */
export const ownedEveryNotice = (offer: PackOffer): string =>
  `You own every cosmetic from this pack. You may continue purchasing more of the "${offer.look.name}" at your own discretion.`;

/** A sale's discount as a whole percent (40 for 40% off), or 0 when the offer is not on sale. */
export function saleOff(offer: PackOffer): number {
  const full = offer.fullPrice ?? 0;
  if (full <= 0 || offer.price >= full) return 0;
  return Math.round(((full - offer.price) / full) * 100);
}

/** Whether the quote can be bought with this balance: never when sold out, always when free. */
export function canAfford(offer: PackOffer, aether: number): boolean {
  return !offer.soldOut && aether >= offer.price;
}

/** How much Aether is missing to buy the quote; 0 when the balance covers it. */
export function aetherShort(offer: PackOffer, aether: number): number {
  return Math.max(0, offer.price - aether);
}
