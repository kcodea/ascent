// GENERATED from packages/progression/src/packShop.ts by `npm run progression:shared`. DO NOT EDIT.
// Edit the source, re-run the script, and commit both; sharedArtifact.test.ts fails CI when they drift.
// Deno module (the submit-progression Edge Function imports it); the repo's tsc/eslint skip supabase/**.
/**
 * THE PACK SHOP CONTRACT (spec docs/superpowers/specs/2026-11-25-pack-shop-design.md, section 6).
 *
 * What the pack shop is handed and what a purchase answers with: the offers on the shelves, the packs a purchase puts in
 * the player's hand, and the outcome of a buy. The SERVER decides every price and charges the player; every number the
 * shop shows is a quote, and the helpers here only read a quote, they never decide one.
 *
 * DEPENDENCY-FREE ON PURPOSE, like the other progression files: sibling relative imports only. A shared artifact
 * (the Edge Functions import the generated copy), so it also owns the shop window maths the server and the lab share.
 */

import { COSMETICS, COSMETIC_CATEGORIES, COSMETIC_RARITIES, RARITY_LABELS, type CosmeticDef, type CrateRarity } from './progressionCosmetics.ts';
import { STYLE_PACK_IDS, STYLE_PACK_NAMES, type PackLook } from './progressionPacks.ts';

export { STYLE_PACK_IDS, STYLE_PACK_NAMES };
import { DEFAULT_PACK_ECONOMY, rarityPackOdds, type PackEconomy } from './progressionPackEconomy.ts';
import { packPool } from './progressionPackRoll.ts';

/** The odds a Rarity Pack displays (`rarityPackOdds`): every card's Standard roll, and the guaranteed last card's. */
export type PackOdds = ReturnType<typeof rarityPackOdds>;

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
  /** Rarity Packs only: the odds to display. */
  odds?: PackOdds;
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
 * a purchase, and neither is the reward itself) earns one free Rarity Pack of `PACK_REWARD_RARITY`, an Epic
 * Pack since his later ruling (owner 2026-11-27: "change the free legendary after 15 purchases to Epic."). Earned rewards wait (`ready`) until
 * the player claims them, one per claim; the count toward the next keeps going meanwhile.
 */
export const PACK_REWARD_EVERY = DEFAULT_PACK_ECONOMY.rewardEvery;
/** The reward pack's rarity (owner 2026-11-27, later: "change the free legendary after 15 purchases to Epic."). */
export const PACK_REWARD_RARITY: CrateRarity = DEFAULT_PACK_ECONOMY.rewardRarity;
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
export type BuyPackError = 'insufficient' | 'price_changed' | 'sold_out' | 'no_room' | 'expired' | 'guest' | 'failed';

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

// ── The shop window ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * THE SHOP REFRESHES every `refreshHours` (6) hours (owner 2026-11-27: "lets change the shop refresh timer from 24 hours
 * to every 6 hours"), anchored to midnight in `refreshZone` (Eastern): at 12am, 6am, 12pm and 6pm wall-clock time,
 * daylight saving included (read from the zone, never a fixed offset; a window that spans a clock change is 5 or 7 hours
 * long). The server computes the same boundary in SQL.
 */
const zoneFormats = new Map<string, Intl.DateTimeFormat>();
function zoneFormat(zone: string): Intl.DateTimeFormat {
  let f = zoneFormats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    zoneFormats.set(zone, f);
  }
  return f;
}
/** The wall-clock fields in `zone` at instant `ms`. */
function zoneParts(ms: number, zone: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const p: Record<string, number> = {};
  for (const part of zoneFormat(zone).formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}
/** How far `zone` is ahead of UTC at instant `ms` (negative: Eastern is behind), in ms. */
function zoneOffset(ms: number, zone: string): number {
  const z = zoneParts(ms, zone);
  return Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s) - Math.floor(ms / 1000) * 1000;
}
/** The current shop window ("YYYY-MM-DDTHH", Eastern, HH = 00 / 06 / 12 / 18): the free pack and the deals turn over with it. */
export function shopWindowId(now: Date = new Date(), eco: PackEconomy = DEFAULT_PACK_ECONOMY): string {
  const z = zoneParts(now.getTime(), eco.refreshZone);
  const h = Math.floor(z.h / eco.refreshHours) * eco.refreshHours;
  return `${z.y}-${String(z.mo).padStart(2, '0')}-${String(z.d).padStart(2, '0')}T${String(h).padStart(2, '0')}`;
}
/** The instant (ms) the shop next refreshes: the coming 12am / 6am / 12pm / 6pm Eastern. */
export function nextShopRefresh(now: Date = new Date(), eco: PackEconomy = DEFAULT_PACK_ECONOMY): number {
  const z = zoneParts(now.getTime(), eco.refreshZone);
  const next = (Math.floor(z.h / eco.refreshHours) + 1) * eco.refreshHours; // 24 rolls into tomorrow's midnight
  const wall = Date.UTC(z.y, z.mo - 1, z.d, next, 0, 0); // the boundary, as if the zone were UTC
  const guess = wall - zoneOffset(now.getTime(), eco.refreshZone);
  return wall - zoneOffset(guess, eco.refreshZone); // re-read the offset AT the boundary (a DST change may fall in between)
}

// ── The window's offers ─────────────────────────────────────────────────────────────────────────────────────

const titleCase = (id: string): string => id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/**
 * THE SHELVES of a shop window, in shelf order: the Rarity Packs (common to ancient, shelf 'rarity'), then a pack per
 * Category in COSMETIC_CATEGORIES order, then a pack per style in STYLE_PACK_IDS order (both shelf 'category', the Themed
 * Packs tab). A pack is offered only when it can be opened (R-PROG-PACK-01; `packPool`: enabled categories only): a
 * Rarity pack while the pool holds an item AT OR ABOVE its rarity, a themed pack while its own pool is not empty. Each
 * is at its price and its offerId is `<windowId>:<look id>`; only Rarity offers carry `odds`.
 */
export function shelfOffers(windowId: string, catalog: readonly CosmeticDef[] = COSMETICS, eco: PackEconomy = DEFAULT_PACK_ECONOMY): PackOffer[] {
  const make = (look: PackLook, shelf: string, price: number): PackOffer => ({
    offerId: `${windowId}:${look.id}`, look, price, shelf, contains: 1,
    ...(look.kind === 'rarity' ? { odds: rarityPackOdds(look.guaranteedFloor, eco) } : null),
  });
  const out: PackOffer[] = [];
  const rank = (r: string): number => (COSMETIC_RARITIES as readonly string[]).indexOf(r);
  const all = packPool(catalog, 'all');
  for (const r of COSMETIC_RARITIES) {
    if (!all.some((c) => rank(c.rarity) >= rank(r))) continue; // nothing at or above its rarity: it could never open
    out.push(make({ kind: 'rarity', id: `rarity-${r}`, name: `${RARITY_LABELS[r]} Pack`, guaranteedFloor: r }, 'rarity', eco.rarityPackPrice[r]));
  }
  for (const c of COSMETIC_CATEGORIES) {
    if (packPool(catalog, { category: c }).length === 0) continue;
    out.push(make({ kind: 'category', id: `category-${c}`, name: `${titleCase(c)} Pack`, guaranteedFloor: 'common' }, 'category', eco.themedPackPrice));
  }
  for (const id of STYLE_PACK_IDS) {
    if (packPool(catalog, { style: id }).length === 0) continue;
    out.push(make({ kind: 'themed', id, name: STYLE_PACK_NAMES[id] ?? id, guaranteedFloor: 'common' }, 'category', eco.themedPackPrice));
  }
  return out;
}

/**
 * A deal's price: `full` less `off` percent, rounded to the NEAREST 5 with a .5 tie going UP, and at least 5. In integers:
 * `floor((full * (100 - off) + 250) / 500) * 5` (so 850 at 25% off is 63750 / 500 = 127.5, a tie, and costs 640). The SQL
 * twin must use that integer form (or `round()` on a numeric, which also rounds a positive tie up), never a banker's round.
 */
export const dealPrice = (full: number, off: number): number => Math.max(5, Math.floor((full * (100 - off) + 250) / 500) * 5);

/**
 * THE SHOP WINDOW'S OFFERS from the window's draws: the free pack (`eco.freePackRarity`, offerId `<windowId>:free`, price 0,
 * badge 'free'), then `eco.featuredDeals` deals (offerId `<windowId>:deal:<k>`, k from 0), then `shelfOffers`. The deals
 * come from the shelf offers except the free pack's look, each picked without repeats; deal k reads `draws[3k]` (the pick:
 * `floor(u * left)` of the pool still left, in shelf order), `draws[3k + 1]` (the discount: `min + step * floor(u * steps)`
 * over `(max - min) / step + 1` values) and `draws[3k + 2]` (the stock: `smin + floor(u * (smax - smin + 1))`). Exactly
 * `3 * eco.featuredDeals` draws, each finite in [0, 1), or it throws. The same for every player; stock is per player.
 */
export function windowOffers(
  windowId: string, draws: readonly number[], catalog: readonly CosmeticDef[] = COSMETICS, eco: PackEconomy = DEFAULT_PACK_ECONOMY,
): PackOffer[] {
  if (draws.length !== 3 * eco.featuredDeals) throw new Error(`windowOffers: needs ${3 * eco.featuredDeals} draws, got ${draws.length}`);
  for (const u of draws) if (typeof u !== 'number' || !Number.isFinite(u) || u < 0 || u >= 1) throw new Error('windowOffers: a draw is outside [0, 1)');
  const shelf = shelfOffers(windowId, catalog, eco);
  const freeId = `rarity-${eco.freePackRarity}`;
  const out: PackOffer[] = [];
  const freeSource = shelf.find((o) => o.look.id === freeId);
  if (freeSource) out.push({ ...freeSource, offerId: `${windowId}:free`, shelf: 'featured', price: 0, badge: 'free' });
  const pool = shelf.filter((o) => o.look.id !== freeId);
  const steps = (eco.dealOff.max - eco.dealOff.min) / eco.dealOff.step + 1;
  for (let k = 0; k < eco.featuredDeals && pool.length > 0; k++) {
    const src = pool.splice(Math.floor(draws[3 * k]! * pool.length), 1)[0]!;
    const off = eco.dealOff.min + eco.dealOff.step * Math.floor(draws[3 * k + 1]! * steps);
    const stock = eco.dealStock.min + Math.floor(draws[3 * k + 2]! * (eco.dealStock.max - eco.dealStock.min + 1));
    out.push({ ...src, offerId: `${windowId}:deal:${k}`, shelf: 'featured', price: dealPrice(src.price, off), fullPrice: src.price, stock });
  }
  return [...out, ...shelf];
}

// ── The counter ─────────────────────────────────────────────────────────────────────────────────────────────

// The counter holds `eco.counterTypes` pack types, `eco.stackMax` of each (owner 2026-11-26: "they should stack once per
// purchase, up to a max of 8", "cap the max pack types at 5"); packs that do not fit wait beside it (counterSplit).

/** A pack's type: packs of one type lie in one stack. */
export const lookKey = (look: PackLook): string => `${look.kind}:${look.id}`;
/** Packs of one type waiting for room on the counter. */
export interface WaitingPacks { key: string; look: PackLook; count: number }

/**
 * The hand, split: the packs on the counter (the first `eco.counterTypes` types owned, in the order given, up to
 * `eco.stackMax` of each) and the rest, counted by type.
 */
export function counterSplit(hand: readonly OwnedPack[], eco: PackEconomy = DEFAULT_PACK_ECONOMY): { counter: OwnedPack[]; waiting: WaitingPacks[] } {
  const stacks = new Map<string, number>();
  const wait = new Map<string, WaitingPacks>();
  const counter: OwnedPack[] = [];
  for (const p of hand) {
    const key = lookKey(p.look), n = stacks.get(key);
    if (n === undefined ? stacks.size < eco.counterTypes : n < eco.stackMax) { stacks.set(key, (n ?? 0) + 1); counter.push(p); continue; }
    const w = wait.get(key);
    if (w) w.count += 1; else wait.set(key, { key, look: p.look, count: 1 });
  }
  return { counter, waiting: [...wait.values()] };
}

/**
 * A bought pack of this type would have a place on the counter: its stack there is not full, or a place is free (owner
 * 2026-11-26: "theres a legendary pack on the counter. i should be able to stack these", also while other packs wait).
 */
export function counterHasRoom(hand: readonly OwnedPack[], look: PackLook, eco: PackEconomy = DEFAULT_PACK_ECONOMY): boolean {
  const key = lookKey(look);
  const stacks = new Map<string, number>(); // the stacks ON the counter (the first `counterTypes` types owned)
  for (const p of hand) {
    const k = lookKey(p.look), c = stacks.get(k);
    if (c !== undefined) stacks.set(k, c + 1); else if (stacks.size < eco.counterTypes) stacks.set(k, 1);
  }
  const n = stacks.get(key);
  return n === undefined ? stacks.size < eco.counterTypes : n < eco.stackMax;
}
