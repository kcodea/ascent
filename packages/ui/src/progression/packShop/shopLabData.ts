import type { BuyPackOutcome, OwnedPack, PackLook, PackOffer, PackShelf } from '@game/progression';
import { SCRIBBLE_PACK_LOOK_ID, STYLE_PACKS } from '../packOpening/packArt';
import { PACK_LAB_LOOKS, type LabTimers } from '../packOpening/packLabSamples';

/**
 * THE SHOP LAB'S FAKE CATALOG AND FAKE SERVER (dev only). Offers, a wallet and a hand the Pack Shop lab hands to the real
 * `PackShop`, plus `makeLabBuy`, a purchase that answers the way the server will: after a delay, charging the wallet,
 * refusing when it cannot cover the price, and never charging twice for the same request id.
 */

// (owner 2026-11-27: "remove the season, boxes, and chests categories. Let's have featured as the first window, then
// let's have category, and then let's have rarity")
export const SHOP_LAB_SHELVES: readonly PackShelf[] = [
  { id: 'featured', name: 'Featured' },
  { id: 'category', name: 'Category' },
  { id: 'rarity', name: 'Rarity' },
];

const PRICE: Readonly<Record<string, number>> = { common: 100, rare: 200, epic: 450, legendary: 900, ancient: 1800 };

const offer = (look: PackLook, shelf: string, extra: Partial<PackOffer> = {}, suffix = ''): PackOffer => ({
  offerId: `lab-${look.id}${suffix}`,
  look,
  price: PRICE[look.guaranteedFloor] ?? 100,
  shelf,
  contains: 1,
  ...extra,
});

// (owner 2026-11-26: the style packs, Scribble and its kin, stand with the category packs: "in the by category shop, could they all be there?")
const STYLE_IDS = new Set<string>([SCRIBBLE_PACK_LOOK_ID, ...STYLE_PACKS.map((p) => p.id)]);
/** A look's shelf, or null: themed packs other than the style packs (Launch, Season, Secret) stand on no shelf for now. */
const shelfOfLook = (look: PackLook): string | null =>
  look.kind === 'rarity' ? 'rarity' : look.kind === 'category' || STYLE_IDS.has(look.id) ? 'category' : null;

/** The Category and Rarity shelves: every look that has a shelf, a few carrying the states the shop has to draw. */
const SHELF_OFFERS: readonly PackOffer[] = PACK_LAB_LOOKS.flatMap((look, i): PackOffer[] => {
  const shelf = shelfOfLook(look);
  if (!shelf) return [];
  const base = offer(look, shelf, { newToYou: { unowned: 3 + ((i * 7) % 30), total: 40 } });
  if (look.id === 'rarity-ancient') return [{ ...base, soldOut: true }];
  if (look.id === 'category-emote') return [{ ...base, newToYou: { unowned: 0, total: 40 } }];
  return [base];
});

/** Today's shop day (UTC): the featured window rotates when it changes. */
export const labShopDay = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** A small seeded generator for the day's picks (the same day always draws the same window). */
function dayRng(day: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) { h ^= day.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The featured window's discounted packs: this many, each 20% to 60% off (in 5% steps). */
export const FEATURED_DEALS = 4;
export const DEAL_OFF = { min: 20, max: 60, step: 5 } as const;

/**
 * THE FEATURED WINDOW for a shop day (owner 2026-11-27: "it has a daily free card pack, and let's make that daily free
 * card pack a rare card pack. And then in featured should also have 4 other discounted, randomly discounted between 20
 * and 60% off card packs of any other type, whether it is rarity or category. And those should rotate out of the shop
 * every day"): the free Rare first, then four different packs off the Category and Rarity shelves (never the Rare, never
 * a sold-out one), each at its own discount. A sale's `fullPrice` is the price it was before.
 */
export function featuredOffers(day: string): PackOffer[] {
  const rare = SHELF_OFFERS.find((o) => o.look.id === 'rarity-rare')!;
  const free: PackOffer = { ...rare, offerId: `lab-daily-free-${day}`, shelf: 'featured', price: 0, badge: 'free' };
  const rnd = dayRng(day);
  const pool = SHELF_OFFERS.filter((o) => o.look.id !== 'rarity-rare' && !o.soldOut);
  const deals: PackOffer[] = [];
  for (let k = 0; k < FEATURED_DEALS && pool.length > 0; k++) {
    const pick = pool.splice(Math.floor(rnd() * pool.length), 1)[0]!;
    const steps = (DEAL_OFF.max - DEAL_OFF.min) / DEAL_OFF.step;
    const off = DEAL_OFF.min + DEAL_OFF.step * Math.floor(rnd() * (steps + 1));
    const price = Math.max(5, Math.round((pick.price * (100 - off)) / 100 / 5) * 5);
    deals.push({ ...pick, offerId: `${pick.offerId}-deal-${day}`, shelf: 'featured', price, fullPrice: pick.price, badge: undefined });
  }
  return [free, ...deals];
}

/** Every offer in the shop on a shop day: the featured window, then the Category and Rarity shelves. */
export const shopLabOffers = (day: string = labShopDay()): PackOffer[] => [...featuredOffers(day), ...SHELF_OFFERS];

/** Today's offers, as of when the module loaded (the lab panel; the shop itself asks `shopLabOffers` each time it opens). */
export const SHOP_LAB_OFFERS: readonly PackOffer[] = shopLabOffers();

export type LabBuyMode = 'ok' | 'insufficient' | 'price_changed' | 'guest' | 'failed' | 'never';
export interface LabBuyOpts { delayMs: number; mode: LabBuyMode }
export interface LabState { aether: number; hand: OwnedPack[] }

let packSeq = 0;
/** A fresh pack id, unique across the session. */
export const mintLabPackId = (): string => `lab-pack-${++packSeq}`;

/**
 * The lab's `buy`. `getState` / `setState` are the panel's wallet and hand; `opts` is read at call time (a value or a getter)
 * so the knobs apply to the next purchase. Pending answers sit on `timers` so closing the lab cancels them.
 */
export function makeLabBuy(
  getState: () => LabState,
  setState: (next: LabState) => void,
  opts: LabBuyOpts | (() => LabBuyOpts),
  timers: LabTimers = new Set(),
  offers: readonly PackOffer[] = SHOP_LAB_OFFERS,
): (offerId: string, requestId: string) => Promise<BuyPackOutcome> {
  const done = new Map<string, BuyPackOutcome>();
  return (offerId, requestId) => {
    const { delayMs, mode } = typeof opts === 'function' ? opts() : opts;
    if (mode === 'never') return new Promise<BuyPackOutcome>(() => { /* never settles */ });
    return new Promise<BuyPackOutcome>((resolve) => {
      const answer = (): void => {
        const prior = done.get(requestId);
        if (prior) { resolve(prior); return; }
        const { aether, hand } = getState();
        const found = offers.find((o) => o.offerId === offerId);
        let outcome: BuyPackOutcome;
        if (mode !== 'ok') {
          outcome = { status: 'error', reason: mode, aether };
        } else if (!found || found.soldOut) {
          outcome = { status: 'error', reason: found ? 'sold_out' : 'failed', aether };
        } else if (aether < found.price) {
          outcome = { status: 'error', reason: 'insufficient', aether };
        } else {
          const packs: OwnedPack[] = Array.from({ length: found.contains }, () => ({ packId: mintLabPackId(), look: found.look }));
          const left = aether - found.price;
          setState({ aether: left, hand: [...hand, ...packs] });
          outcome = { status: 'ok', packs, aether: left };
          done.set(requestId, outcome);
        }
        resolve(outcome);
      };
      if (delayMs <= 0) { answer(); return; }
      const t = setTimeout(() => { timers.delete(t); answer(); }, delayMs);
      timers.add(t);
    });
  };
}

/** A starting hand of `n` packs (0 to 30), cycling through the looks. */
export function labHand(n: number): OwnedPack[] {
  const count = Math.max(0, Math.min(80, Math.floor(n) || 0));
  return Array.from({ length: count }, (_, i) => ({ packId: mintLabPackId(), look: PACK_LAB_LOOKS[i % PACK_LAB_LOOKS.length]! }));
}

/** The lab's guarantee counter: how many packs until the guaranteed rarity, starting (and restarting) at this. */
export const LAB_GUARANTEE_EVERY = 10;

/** The guarantee after `bought` more packs: one step down per pack, back to `LAB_GUARANTEE_EVERY` each time it reaches 0. */
export function labGuaranteeAfter(within: number, bought: number): number {
  let w = within;
  for (let i = 0; i < bought; i++) { w -= 1; if (w <= 0) w = LAB_GUARANTEE_EVERY; }
  return w;
}
