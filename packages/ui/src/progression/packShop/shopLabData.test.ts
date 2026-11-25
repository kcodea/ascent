import { describe, expect, it } from 'vitest';
import { PACK_LAB_LOOKS } from '../packOpening/packLabSamples';
import { LAB_GUARANTEE_EVERY, SHOP_LAB_OFFERS, SHOP_LAB_SHELVES, labGuaranteeAfter, makeLabBuy, type LabBuyMode, type LabState } from './shopLabData';

const setup = (aether: number, mode: LabBuyMode = 'ok') => {
  let state: LabState = { aether, hand: [] };
  const buy = makeLabBuy(() => state, (s) => { state = s; }, { delayMs: 0, mode });
  return { buy, get: () => state };
};
const byId = (id: string) => SHOP_LAB_OFFERS.find((o) => o.offerId === id)!;

describe('shop lab data', () => {
  it('has six shelves and every offer stands on a listed one', () => {
    expect(SHOP_LAB_SHELVES).toHaveLength(6);
    const ids = new Set(SHOP_LAB_SHELVES.map((s) => s.id));
    for (const o of SHOP_LAB_OFFERS) expect(ids.has(o.shelf)).toBe(true);
    expect(SHOP_LAB_OFFERS.filter((o) => o.shelf === 'chests')).toHaveLength(0);
  });
  it('has unique offer ids and every Pack Lab look on a shelf', () => {
    const ids = SHOP_LAB_OFFERS.map((o) => o.offerId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of PACK_LAB_LOOKS) expect(SHOP_LAB_OFFERS.some((o) => o.look.id === l.id)).toBe(true);
  });
  it('carries the states the shop draws', () => {
    expect(SHOP_LAB_OFFERS.some((o) => o.price === 0 && o.badge === 'free')).toBe(true);
    expect(SHOP_LAB_OFFERS.some((o) => o.shelf === 'boxes' && o.contains === 10)).toBe(true);
    expect(SHOP_LAB_OFFERS.some((o) => o.soldOut)).toBe(true);
    expect(SHOP_LAB_OFFERS.some((o) => o.newToYou?.unowned === 0)).toBe(true);
  });
});

describe('makeLabBuy', () => {
  it('deducts the price and returns unique packs in the offer look', async () => {
    const { buy, get } = setup(5000);
    const box = SHOP_LAB_OFFERS.find((o) => o.contains === 10)!;
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
