import { describe, expect, it } from 'vitest';
import { PACK_LAB_LOOKS } from '../packOpening/packLabSamples';
import { saleOff } from '@game/progression';
import { DEAL_OFF, DEAL_STOCK, FEATURED_DEALS, labNextRefresh, labShopDay, SHOP_LAB_OFFERS, SHOP_LAB_SHELVES, featuredOffers, shopLabOffers, labRewardCount, labRewardPack, makeLabBuy, type LabBuyMode, type LabState } from './shopLabData';

const setup = (aether: number, mode: LabBuyMode = 'ok') => {
  let state: LabState = { aether, hand: [] };
  const buy = makeLabBuy(() => state, (s) => { state = s; }, { delayMs: 0, mode });
  return { buy, get: () => state };
};
const byId = (id: string) => SHOP_LAB_OFFERS.find((o) => o.offerId === id)!;

describe('shop lab data', () => {
  // owner 2026-11-27: "remove the season, boxes, and chests categories ... featured ... then category, and then rarity"
  it('has Featured, Category, Rarity in that order and every offer stands on a listed one', () => {
    expect(SHOP_LAB_SHELVES.map((s) => s.id)).toEqual(['featured', 'category', 'rarity']);
    const ids = new Set(SHOP_LAB_SHELVES.map((s) => s.id));
    for (const o of SHOP_LAB_OFFERS) expect(ids.has(o.shelf)).toBe(true);
  });
  it('has unique offer ids and every rarity / category look on its shelf', () => {
    const ids = SHOP_LAB_OFFERS.map((o) => o.offerId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of PACK_LAB_LOOKS.filter((x) => x.kind !== 'themed')) expect(SHOP_LAB_OFFERS.some((o) => o.look.id === l.id && o.shelf !== 'featured')).toBe(true);
  });
  it('carries the states the shop draws', () => {
    expect(SHOP_LAB_OFFERS.some((o) => o.soldOut)).toBe(true);
    expect(SHOP_LAB_OFFERS.some((o) => o.newToYou?.unowned === 0)).toBe(true);
  });
});

describe('makeLabBuy', () => {
  it('deducts the price and returns unique packs in the offer look', async () => {
    // the shop has no boxes now, but a box offer still buys its whole count
    const box = { ...byId('lab-rarity-rare'), offerId: 'lab-box', contains: 10, price: 1800 };
    let state: LabState = { aether: 5000, hand: [] };
    const buy = makeLabBuy(() => state, (n) => { state = n; }, { delayMs: 0, mode: 'ok' }, new Set(), [box]);
    const get = () => state;
    const out = await buy(box.offerId, 'r1');
    expect(out.status).toBe('ok');
    if (out.status !== 'ok') return;
    expect(out.packs).toHaveLength(10);
    expect(new Set(out.packs.map((p) => p.packId)).size).toBe(10);
    expect(out.packs.every((p) => p.look.id === box.look.id)).toBe(true);
    expect(out.aether).toBe(5000 - box.price);
    expect(get().aether).toBe(out.aether);
    expect(get().hand).toHaveLength(10);
  });
  it('answers insufficient and changes nothing when the wallet is short', async () => {
    const o = byId('lab-rarity-epic');
    const { buy, get } = setup(o.price - 1);
    expect(await buy(o.offerId, 'r1')).toEqual({ status: 'error', reason: 'insufficient', aether: o.price - 1 });
    expect(get()).toEqual({ aether: o.price - 1, hand: [] });
  });
  it('never charges twice for a repeated request id', async () => {
    const o = byId('lab-rarity-rare');
    const { buy, get } = setup(1000);
    const a = await buy(o.offerId, 'same');
    const b = await buy(o.offerId, 'same');
    expect(b).toEqual(a);
    expect(get().aether).toBe(1000 - o.price);
    expect(get().hand).toHaveLength(1);
  });
  it('answers the chosen error mode and charges nothing', async () => {
    const { buy, get } = setup(1000, 'guest');
    expect(await buy('lab-rarity-rare', 'r')).toMatchObject({ status: 'error', reason: 'guest' });
    expect(get().aether).toBe(1000);
  });
  it('never settles in never mode', async () => {
    const { buy } = setup(1000, 'never');
    let settled = false;
    void buy('lab-rarity-rare', 'r').then(() => { settled = true; });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
  });
  it('the reward pack is a Legendary Rarity Pack, and only paid packs count toward it', () => {
    const p = labRewardPack();
    expect(p.look.kind).toBe('rarity');
    expect(p.look.guaranteedFloor).toBe('legendary');
    const paid = SHOP_LAB_OFFERS.find((o) => o.price > 0)!;
    expect(labRewardCount(paid, 3)).toBe(3);
    expect(labRewardCount({ ...paid, price: 0 }, 1)).toBe(0);
    expect(labRewardCount(undefined, 2)).toBe(0);
  });
});

// owner 2026-11-27: "a daily free card pack ... a rare card pack ... 4 other discounted, randomly discounted between 20 and 60%
// off card packs of any other type, whether it is rarity or category. And those should rotate out of the shop every day"
describe('the featured window', () => {
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10));
  it('opens with a free Rare pack, then four different discounted rarity / category packs', () => {
    for (const day of days) {
      const [free, ...deals] = featuredOffers(day);
      expect(free!.look.id).toBe('rarity-rare');
      expect(free!.price).toBe(0);
      expect(free!.badge).toBe('free');
      expect(deals).toHaveLength(FEATURED_DEALS);
      expect(new Set(deals.map((d) => d.look.id)).size).toBe(FEATURED_DEALS);
      for (const d of deals) {
        expect(d.shelf).toBe('featured');
        expect(d.look.id).not.toBe('rarity-rare');
        expect(d.soldOut).toBeFalsy();
        expect(d.look.kind === 'rarity' || shopLabOffers(day).some((o) => o.shelf === 'category' && o.look.id === d.look.id)).toBe(true);
        const off = saleOff(d);
        expect(off).toBeGreaterThanOrEqual(DEAL_OFF.min - 3);
        expect(off).toBeLessThanOrEqual(DEAL_OFF.max + 3);
        expect(d.price).toBeLessThan(d.fullPrice!);
        expect(d.stock).toBeGreaterThanOrEqual(DEAL_STOCK.min);
        expect(d.stock).toBeLessThanOrEqual(DEAL_STOCK.max);
        expect(Number.isInteger(d.stock)).toBe(true);
      }
    }
  });
  it('is the same all day and rotates between days', () => {
    expect(featuredOffers(days[0]!)).toEqual(featuredOffers(days[0]!));
    const windows = new Set(days.map((d) => featuredOffers(d).slice(1).map((o) => `${o.look.id}@${o.price}`).join(',')));
    expect(windows.size).toBeGreaterThan(20);
  });
});

// owner 2026-11-27: "lets change the shop refresh timer from 24 hours to every 6 hours", anchored to midnight Eastern
// ("day rolls over at Midnight Eastern Time"): 12am, 6am, 12pm and 6pm Eastern, daylight saving included
describe('the shop window', () => {
  it('is the Eastern date and its 6-hour block', () => {
    expect(labShopDay(new Date('2026-01-16T04:59:00Z'))).toBe('2026-01-15T18'); // 23:59 EST
    expect(labShopDay(new Date('2026-01-16T05:00:00Z'))).toBe('2026-01-16T00'); // 00:00 EST
    expect(labShopDay(new Date('2026-01-16T10:59:00Z'))).toBe('2026-01-16T00'); // 05:59 EST
    expect(labShopDay(new Date('2026-01-16T11:00:00Z'))).toBe('2026-01-16T06'); // 06:00 EST
    expect(labShopDay(new Date('2026-01-16T17:00:00Z'))).toBe('2026-01-16T12'); // 12:00 EST
    expect(labShopDay(new Date('2026-07-16T03:59:00Z'))).toBe('2026-07-15T18'); // 23:59 EDT
    expect(labShopDay(new Date('2026-07-16T04:00:00Z'))).toBe('2026-07-16T00'); // 00:00 EDT
  });
  it('refreshes at the coming 12am / 6am / 12pm / 6pm Eastern, winter and summer, across a clock change', () => {
    const at = (iso: string) => new Date(labNextRefresh(new Date(iso))).toISOString();
    expect(at('2026-01-15T12:00:00Z')).toBe('2026-01-15T17:00:00.000Z'); // 07:00 EST -> 12pm
    expect(at('2026-01-15T17:00:00Z')).toBe('2026-01-15T23:00:00.000Z'); // 12:00 EST exactly -> 6pm
    expect(at('2026-01-15T23:30:00Z')).toBe('2026-01-16T05:00:00.000Z'); // 18:30 EST -> midnight
    expect(at('2026-07-15T12:00:00Z')).toBe('2026-07-15T16:00:00.000Z'); // 08:00 EDT -> 12pm
    // the spring change (Mar 8 2026, 2am): the 12am-6am window is 5 hours; 6am is already EDT
    expect(at('2026-03-08T05:30:00Z')).toBe('2026-03-08T10:00:00.000Z');
    // the autumn change (Nov 1 2026, 2am): the 12am-6am window is 7 hours; 6am is EST
    expect(at('2026-11-01T04:30:00Z')).toBe('2026-11-01T11:00:00.000Z');
  });
  it('gives one free pack a day but new deals every window', () => {
    const [free0, ...deals0] = featuredOffers('2026-11-05T00');
    const [free6, ...deals6] = featuredOffers('2026-11-05T06');
    expect(free0!.offerId).toBe(free6!.offerId);
    expect(featuredOffers('2026-11-06T00')[0]!.offerId).not.toBe(free0!.offerId);
    const key = (ds: typeof deals0) => ds.map((d) => d.offerId).join(',');
    expect(key(deals0)).not.toBe(key(deals6));
  });
});
