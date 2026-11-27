import { describe, expect, it } from 'vitest';
import { PACK_LAB_LOOKS } from '../packOpening/packLabSamples';
import { saleOff } from '@game/progression';
import { DEAL_OFF, FEATURED_DEALS, LAB_GUARANTEE_EVERY, SHOP_LAB_OFFERS, SHOP_LAB_SHELVES, featuredOffers, shopLabOffers, labGuaranteeAfter, makeLabBuy, type LabBuyMode, type LabState } from './shopLabData';

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
  it('the guarantee counts down one per pack and restarts at 10 when it reaches 0', () => {
    expect(LAB_GUARANTEE_EVERY).toBe(10);
    expect(labGuaranteeAfter(10, 1)).toBe(9);
    expect(labGuaranteeAfter(3, 2)).toBe(1);
    expect(labGuaranteeAfter(1, 1)).toBe(10);
    expect(labGuaranteeAfter(2, 3)).toBe(9);
    expect(labGuaranteeAfter(4, 0)).toBe(4);
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
      }
    }
  });
  it('is the same all day and rotates between days', () => {
    expect(featuredOffers(days[0]!)).toEqual(featuredOffers(days[0]!));
    const windows = new Set(days.map((d) => featuredOffers(d).slice(1).map((o) => `${o.look.id}@${o.price}`).join(',')));
    expect(windows.size).toBeGreaterThan(20);
  });
});
