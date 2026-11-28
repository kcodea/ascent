import { DEFAULT_PACK_ECONOMY, nextShopRefresh, PACK_REWARD_RARITY, shopWindowId, windowOffers, type BuyPackOutcome, type OwnedPack, type PackLook, type PackOffer, type PackShelf } from '@game/progression';
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
 * THE SHOP WINDOW now lives in `@game/progression` (`shopWindowId` / `nextShopRefresh`, one copy for the server and the
 * lab; every 6 hours at 12am / 6am / 12pm / 6pm Eastern, owner 2026-11-27). The lab keeps its old names for them.
 */
export const SHOP_REFRESH_HOURS = DEFAULT_PACK_ECONOMY.refreshHours;
export const SHOP_ZONE = DEFAULT_PACK_ECONOMY.refreshZone;
export const labShopDay = shopWindowId;
export const labNextRefresh = nextShopRefresh;

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

/** The featured window's rules live in `@game/progression` (`windowOffers`); the lab reads them from the same economy document. */
export const FEATURED_DEALS = DEFAULT_PACK_ECONOMY.featuredDeals;
export const DEAL_STOCK = DEFAULT_PACK_ECONOMY.dealStock;
export const DEAL_OFF = DEFAULT_PACK_ECONOMY.dealOff;

/**
 * THE FEATURED WINDOW for a shop day (owner 2026-11-27: "it has a daily free card pack, and let's make that daily free
 * card pack a rare card pack. And then in featured should also have 4 other discounted, randomly discounted between 20
 * and 60% off card packs of any other type, whether it is rarity or category. And those should rotate out of the shop
 * every day"): the free Rare first, then four different packs, each at its own discount. The rule is the server's
 * (`windowOffers`); the lab only supplies the window's draws, from its seeded generator.
 */
export function featuredOffers(day: string): PackOffer[] {
  const rnd = dayRng(day);
  const draws = Array.from({ length: 3 * DEFAULT_PACK_ECONOMY.featuredDeals }, () => rnd());
  return windowOffers(day, draws).filter((o) => o.shelf === 'featured');
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
