import { PACK_REWARD_RARITY, type BuyPackOutcome, type OwnedPack, type PackLook, type PackOffer, type PackShelf } from '@game/progression';
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
  // (owner 2026-11-27: renamed: "Daily Featured", "Themed Packs", "Rarity Packs")
  { id: 'featured', name: 'Daily Featured' },
  { id: 'category', name: 'Themed Packs' },
  { id: 'rarity', name: 'Rarity Packs' },
];

/**
 * PACK PRICES, in Aether (owner 2026-11-27: "for rarity lets do 100 for common, 175 for rare, 300 for epic, 500 for
 * legendary and 850 for ancient. for themed packs, because they follow the common pack odds, but narrow it down to a
 * category that the player is more interested in, lets have those at a flat 200"). Every non-rarity pack (the Category
 * packs and the style packs) is the flat themed price. The server will own the real prices (the economy project).
 */
export const RARITY_PACK_PRICE: Readonly<Record<string, number>> = { common: 100, rare: 175, epic: 300, legendary: 500, ancient: 850 };
export const THEMED_PACK_PRICE = 200;

const offer = (look: PackLook, shelf: string, extra: Partial<PackOffer> = {}, suffix = ''): PackOffer => ({
  offerId: `lab-${look.id}${suffix}`,
  look,
  price: look.kind === 'rarity' ? RARITY_PACK_PRICE[look.guaranteedFloor] ?? 100 : THEMED_PACK_PRICE,
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

/**
 * THE SHOP REFRESHES EVERY 6 HOURS (owner 2026-11-27: "lets change the shop refresh timer from 24 hours to every 6
 * hours"), anchored to MIDNIGHT EASTERN (his earlier "day rolls over at Midnight Eastern Time"): at 12am, 6am, 12pm and
 * 6pm Eastern wall-clock time, daylight saving included (read from the America/New_York zone, never a fixed offset; a
 * window that spans a clock change is 5 or 7 hours long). The server will own the real boundary; the lab computes the
 * same one.
 */
export const SHOP_REFRESH_HOURS = 6;
export const SHOP_ZONE = 'America/New_York';
const zoneFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: SHOP_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
/** The wall-clock fields in the shop's zone at instant `ms`. */
function zoneParts(ms: number): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const p: Record<string, number> = {};
  for (const part of zoneFmt.formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}
/** How far the shop's zone is ahead of UTC at instant `ms` (negative: Eastern is behind), in ms. */
function zoneOffset(ms: number): number {
  const z = zoneParts(ms);
  return Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s) - Math.floor(ms / 1000) * 1000;
}
/**
 * The current shop window ("YYYY-MM-DDTHH", Eastern, HH = 00 / 06 / 12 / 18): the featured deals rotate when it changes.
 * The free pack and the deals both turn over with it.
 */
export function labShopDay(now: Date = new Date()): string {
  const z = zoneParts(now.getTime());
  const h = Math.floor(z.h / SHOP_REFRESH_HOURS) * SHOP_REFRESH_HOURS;
  return `${z.y}-${String(z.mo).padStart(2, '0')}-${String(z.d).padStart(2, '0')}T${String(h).padStart(2, '0')}`;
}
/** The instant (ms) the shop next refreshes: the coming 12am / 6am / 12pm / 6pm Eastern. */
export function labNextRefresh(now: Date = new Date()): number {
  const z = zoneParts(now.getTime());
  const next = (Math.floor(z.h / SHOP_REFRESH_HOURS) + 1) * SHOP_REFRESH_HOURS; // 24 rolls into tomorrow's midnight
  const wall = Date.UTC(z.y, z.mo - 1, z.d, next, 0, 0); // the boundary, as if Eastern were UTC
  const guess = wall - zoneOffset(now.getTime());
  return wall - zoneOffset(guess); // re-read the offset AT the boundary (a DST change may fall in between)
}

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

/** The featured window's discounted packs: this many, each 20% to 60% off (in 5% steps), each with 2 to 5 in stock. */
export const FEATURED_DEALS = 4;
export const DEAL_STOCK = { min: 2, max: 5 } as const;
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
  // a free pack EVERY REFRESH, like the deals (owner 2026-11-27, asked whether the free Rare stays daily: "Every 6 hours")
  const free: PackOffer = { ...rare, offerId: `lab-daily-free-${day}`, shelf: 'featured', price: 0, badge: 'free' };
  const rnd = dayRng(day);
  const pool = SHELF_OFFERS.filter((o) => o.look.id !== 'rarity-rare' && !o.soldOut);
  const deals: PackOffer[] = [];
  for (let k = 0; k < FEATURED_DEALS && pool.length > 0; k++) {
    const pick = pool.splice(Math.floor(rnd() * pool.length), 1)[0]!;
    const steps = (DEAL_OFF.max - DEAL_OFF.min) / DEAL_OFF.step;
    const off = DEAL_OFF.min + DEAL_OFF.step * Math.floor(rnd() * (steps + 1));
    const price = Math.max(5, Math.round((pick.price * (100 - off)) / 100 / 5) * 5);
    // (owner 2026-11-27: "the discounted packs in the daily feature should also randomly roll which amount of stock they have from 2 to 5")
    const stock = DEAL_STOCK.min + Math.floor(rnd() * (DEAL_STOCK.max - DEAL_STOCK.min + 1));
    deals.push({ ...pick, offerId: `${pick.offerId}-deal-${day}`, shelf: 'featured', price, fullPrice: pick.price, badge: undefined, stock });
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

/** The pack reward's pack: the Rarity Pack of `PACK_REWARD_RARITY`, an Epic Pack (owner 2026-11-27, later: "change the free legendary after 15 purchases to Epic."). First (owner 2026-11-27: "Every 15 packs purchased gives the player one free Legendary Rarity Pack. it should glow and say 'Click to receive your reward' and when the player clicks it, it sparks and a legendary pack is sent to their counter. if it cant fit, send to their backpack"). */
const REWARD_LOOK: PackLook = PACK_LAB_LOOKS.find((l) => l.kind === 'rarity' && l.guaranteedFloor === PACK_REWARD_RARITY)!;
export const labRewardPack = (): OwnedPack => ({ packId: mintLabPackId(), look: REWARD_LOOK });
/** Packs an offer's purchase counts toward the reward: every pack it gives, unless it was free. */
export const labRewardCount = (offer: PackOffer | undefined, packs: number): number => (offer && offer.price > 0 ? packs : 0);
