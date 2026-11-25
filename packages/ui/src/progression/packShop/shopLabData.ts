import type { BuyPackOutcome, OwnedPack, PackLook, PackOffer, PackShelf } from '@game/progression';
import { PACK_LAB_LOOKS, type LabTimers } from '../packOpening/packLabSamples';

/**
 * THE SHOP LAB'S FAKE CATALOG AND FAKE SERVER (dev only). Offers, a wallet and a hand the Pack Shop lab hands to the real
 * `PackShop`, plus `makeLabBuy`, a purchase that answers the way the server will: after a delay, charging the wallet,
 * refusing when it cannot cover the price, and never charging twice for the same request id.
 */

export const SHOP_LAB_SHELVES: readonly PackShelf[] = [
  { id: 'featured', name: 'Featured' },
  { id: 'rarity', name: 'Rarity' },
  { id: 'category', name: 'Category' },
  { id: 'season', name: 'Season' },
  { id: 'boxes', name: 'Boxes' },
  { id: 'chests', name: 'Chests' }, // empty on purpose: the shop must handle a shelf with nothing on it
];

const PRICE: Readonly<Record<string, number>> = { common: 100, rare: 200, epic: 450, legendary: 900, ancient: 1800 };

const lookOf = (id: string): PackLook => {
  const l = PACK_LAB_LOOKS.find((x) => x.id === id);
  if (!l) throw new Error(`shop lab: unknown look ${id}`);
  return l;
};

const offer = (look: PackLook, shelf: string, extra: Partial<PackOffer> = {}, suffix = ''): PackOffer => ({
  offerId: `lab-${look.id}${suffix}`,
  look,
  price: PRICE[look.guaranteedFloor] ?? 100,
  shelf,
  contains: 1,
  ...extra,
});

const shelfOfLook = (look: PackLook): string => (look.kind === 'rarity' ? 'rarity' : look.kind === 'category' ? 'category' : 'season');

/** Every look in the Pack Lab stands on a shelf; a few carry the states the shop has to draw. */
export const SHOP_LAB_OFFERS: readonly PackOffer[] = [
  ...PACK_LAB_LOOKS.map((look, i): PackOffer => {
    const base = offer(look, shelfOfLook(look), { newToYou: { unowned: 3 + ((i * 7) % 30), total: 40 } });
    if (look.id === 'rarity-common') return { ...base, price: 0, badge: 'free', newToYou: { unowned: 12, total: 40 } };
    if (look.id === 'rarity-ancient') return { ...base, soldOut: true };
    if (look.id === 'category-emote') return { ...base, newToYou: { unowned: 0, total: 40 } };
    if (look.id === 'themed-launch') return { ...base, badge: 'new' };
    if (look.id === 'themed-season') return { ...base, badge: 'featured' };
    return base;
  }),
  // featured shelf: packs that also stand elsewhere
  offer(lookOf('themed-launch'), 'featured', { badge: 'new', newToYou: { unowned: 9, total: 40 } }, '-f'),
  offer(lookOf('rarity-legendary'), 'featured', { badge: 'featured', newToYou: { unowned: 6, total: 40 } }, '-f'),
  offer(lookOf('rarity-rare'), 'featured', { newToYou: { unowned: 21, total: 40 } }, '-f'),
  // boxes shelf
  offer(lookOf('rarity-rare'), 'boxes', { contains: 10, price: 1800, newToYou: { unowned: 21, total: 40 } }, '-box'),
  offer(lookOf('rarity-epic'), 'boxes', { contains: 10, price: 4000, newToYou: { unowned: 14, total: 40 } }, '-box'),
];

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
  const count = Math.max(0, Math.min(30, Math.floor(n) || 0));
  return Array.from({ length: count }, (_, i) => ({ packId: mintLabPackId(), look: PACK_LAB_LOOKS[i % PACK_LAB_LOOKS.length]! }));
}
