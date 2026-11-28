// @vitest-environment jsdom
/**
 * THE PACK SHOP ON THE SERVER (the pack economy, 2026-12-01). Which shop the nav's Shop tab opens comes from the server's
 * `packs_enabled` alone; with it on, the shop behind the door runs on the store's server calls (the props `PackShop`
 * gets are the server's), a guest's spend shows the sign-in gate and never reaches the server, and a read that does
 * not answer is the generic failed state. `PackShop` itself is faked here (its own tests cover it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { PackShopProps } from './PackShop';
import { mount, type Mounted } from '../../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

let shopProps: PackShopProps | null = null;
vi.mock('./PackShop', () => ({
  PackShop: (p: PackShopProps) => { shopProps = p; return <div data-testid="fake-shop" />; },
}));
const buyPackRemote = vi.fn();
const fetchPackShop = vi.fn();
const openPackRemote = vi.fn();
const claimPackRewardRemote = vi.fn();
vi.mock('../../identity', async (orig) => ({ ...(await orig<typeof import('../../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('../progressionRemote', async (orig) => ({
  ...(await orig<typeof import('../progressionRemote')>()),
  fetchPackShop: () => fetchPackShop(),
  buyPackRemote: (r: unknown) => buyPackRemote(r),
  openPackRemote: (id: string) => openPackRemote(id),
  claimPackRewardRemote: (id: string) => claimPackRewardRemote(id),
}));

import PackShopEntry, { ServerPackShop } from './PackShopEntry';
import { shopTabTarget } from './shopTabTarget';
import { resetProgressionForTests, useProgression } from '../progressionStore';
import { openPackShopDoor, usePhShell } from '../../partyHome/shell/shellStore';
import { PhTopNav } from '../../partyHome/shell/PhTopNav';
import { useGame } from '../../store';

const rare = { kind: 'rarity', id: 'rarity-rare', name: 'Rare Pack', guaranteedFloor: 'rare' } as const;
const shopJson = {
  windowId: 'w1', nextRefreshAt: 2_000_000_000_000, shelves: [{ id: 'rarity', name: 'Rarity Packs' }],
  offers: [{ offerId: 'w1:rarity-rare', look: rare, price: 175, shelf: 'rarity', contains: 1 }],
  packs: [{ packId: 'p-1', look: rare }], packMeter: { progress: 3, ready: 1 }, aether: 900,
};

let ui: Mounted | null = null;
const flush = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); }); };
const asGuest = (anonymous: boolean): void => {
  useGame.setState((s) => ({ account: { ...s.account, userId: 'u-1', email: anonymous ? null : 'k@example.com', anonymous } }));
};
beforeEach(() => {
  resetProgressionForTests();
  shopProps = null; buyPackRemote.mockReset(); fetchPackShop.mockReset(); openPackRemote.mockReset(); claimPackRewardRemote.mockReset();
  useProgression.setState({ capability: 'on', cratesCapability: 'on', aetherCapability: 'on', packsCapability: 'on' });
  asGuest(false);
});
afterEach(() => { ui?.unmount(); ui = null; });

describe('which shop the Shop tab opens', () => {
  it('comes from the server switch alone: off, the Chest Shop (a production build); on, the Pack Shop (every build)', () => {
    expect(shopTabTarget(false, false)).toBe('chests');
    expect(shopTabTarget(true, false)).toBe('packs');
    expect(shopTabTarget(true, true)).toBe('packs');
    expect(shopTabTarget(false, true)).toBe('pack_lab'); // a DEV build keeps the lab behind the door
  });

  it('with packs on the Shop tab shows even with the crate switch off (packs_enabled alone)', () => {
    useProgression.setState({ cratesCapability: 'off' });
    ui = mount(<PhTopNav current="home" />);
    const labels = [...ui.container.querySelectorAll<HTMLButtonElement>('button')].map((b) => b.textContent ?? '');
    expect(labels.some((l) => l.includes('Shop'))).toBe(true);
  });

  it('with packs on, the nav\'s Shop tab plays the trip into the Pack Shop, never the Chest Shop', () => {
    const door = usePhShell.getState().packShopDoor;
    ui = mount(<PhTopNav current="home" />);
    const shop = [...ui.container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Shop'));
    act(() => { shop!.click(); });
    expect(usePhShell.getState().packShopDoor).toBe(door + 1);
    expect(usePhShell.getState().crates).toBe(false);
  });
});

describe('behind the door', () => {
  const trip = async (): Promise<void> => {
    ui = mount(<PackShopEntry />);
    act(() => { openPackShopDoor(); });
    // the shop mounts as the trip's land settles (ARRIVAL_MS)
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    await flush();
  };
  it("packs on: the server's shop (its read, its offers)", async () => {
    fetchPackShop.mockResolvedValue({ status: 'ok', shop: shopJson });
    await trip();
    expect(fetchPackShop).toHaveBeenCalled();
    expect(shopProps?.offers).toEqual(shopJson.offers);
  });
  it("packs off (a DEV build): the lab's fake shop, and the server is never asked", async () => {
    useProgression.setState({ packsCapability: 'off' });
    await trip();
    expect(fetchPackShop).not.toHaveBeenCalled();
    expect(shopProps).not.toBeNull();
    expect(shopProps!.offers).not.toEqual(shopJson.offers);
  });
});

describe('ServerPackShop', () => {
  it('opens on the server read: its shelves, offers, hand, balance, countdown and reward meter', async () => {
    fetchPackShop.mockResolvedValue({ status: 'ok', shop: shopJson });
    ui = mount(<ServerPackShop onClose={() => {}} />);
    await flush();
    expect(fetchPackShop).toHaveBeenCalledTimes(1);
    expect(shopProps).toMatchObject({ offers: shopJson.offers, hand: shopJson.packs, aether: 900, refreshesAt: shopJson.nextRefreshAt });
    expect(shopProps!.reward).toMatchObject({ rarity: 'epic', every: 15, progress: 3, ready: 1 });
  });

  it('a buy reaches the server with the shown price and the shop\'s request id', async () => {
    fetchPackShop.mockResolvedValue({ status: 'ok', shop: shopJson });
    buyPackRemote.mockResolvedValue({ status: 'ok', packs: [{ packId: 'p-2', look: rare }], aether: 725, meter: null });
    ui = mount(<ServerPackShop onClose={() => {}} />);
    await flush();
    let out: unknown;
    await act(async () => { out = await shopProps!.buy('w1:rarity-rare', 'req-1'); });
    expect(buyPackRemote).toHaveBeenCalledWith({ offerId: 'w1:rarity-rare', expectedPrice: 175, requestId: 'req-1' });
    expect(out).toEqual({ status: 'ok', packs: [{ packId: 'p-2', look: rare }], aether: 725 });
  });

  it('a guest buy shows the sign-in gate and never reaches the server; a server guest answer shows it too', async () => {
    asGuest(true);
    fetchPackShop.mockResolvedValue({ status: 'ok', shop: shopJson });
    ui = mount(<ServerPackShop onClose={() => {}} />);
    await flush();
    expect(document.querySelector('.crgate-panel')).toBeNull();
    let out: unknown;
    await act(async () => { out = await shopProps!.buy('w1:rarity-rare', 'req-1'); });
    expect(out).toEqual({ status: 'error', reason: 'guest' });
    expect(buyPackRemote).not.toHaveBeenCalled();
    expect(document.querySelector('.pks-gatehost .crgate-panel')).not.toBeNull();
    let opened: unknown;
    await act(async () => { opened = await shopProps!.open('p-1'); });
    expect(opened).toEqual({ status: 'error', reason: 'guest' });
  });

  it("a guest's opening and reward claim show the sign-in gate and never reach the server (R-PROG-PACK-10)", async () => {
    asGuest(true);
    fetchPackShop.mockResolvedValue({ status: 'ok', shop: shopJson });
    ui = mount(<ServerPackShop onClose={() => {}} />);
    await flush();
    const gate = (): Element | null => document.querySelector('.pks-gatehost .crgate-panel');
    const closeGate = (): void => { act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); }); };
    let out: unknown;
    await act(async () => { out = await shopProps!.open('p-1'); });
    expect(out).toEqual({ status: 'error', reason: 'guest' });
    expect(openPackRemote).not.toHaveBeenCalled();
    expect(gate()).not.toBeNull();
    closeGate();
    expect(gate()).toBeNull();
    await act(async () => { out = await shopProps!.claimReward!('req-c'); });
    expect(out).toEqual({ status: 'error', reason: 'guest' });
    expect(claimPackRewardRemote).not.toHaveBeenCalled();
    expect(gate()).not.toBeNull();
  });

  it("an opening or claim the server refuses as `guest` is passed back unchanged and changes nothing (R-PROG-PACK-10)", async () => {
    // the server's own refusal (it charges, opens and grants nothing); the gate only ever stands for a guest account
    fetchPackShop.mockResolvedValue({ status: 'ok', shop: shopJson });
    openPackRemote.mockResolvedValue({ status: 'error', reason: 'guest' });
    claimPackRewardRemote.mockResolvedValue({ status: 'error', reason: 'guest' });
    ui = mount(<ServerPackShop onClose={() => {}} />);
    await flush();
    let out: unknown;
    await act(async () => { out = await shopProps!.open('p-1'); });
    expect(openPackRemote).toHaveBeenCalledWith('p-1');
    expect(out).toEqual({ status: 'error', reason: 'guest' });
    await act(async () => { out = await shopProps!.claimReward!('req-c'); });
    expect(claimPackRewardRemote).toHaveBeenCalledWith('req-c');
    expect(out).toEqual({ status: 'error', reason: 'guest' });
    await flush();
    // the sealed pack is still in the hand, the meter still has its reward waiting, and the balance is unchanged
    expect(shopProps!.hand).toEqual(shopJson.packs);
    expect(shopProps!.reward).toMatchObject({ ready: 1, progress: 3 });
    expect(shopProps!.aether).toBe(900);
  });

  it("the reward label uses the server's size and rarity (pack_config), the constants only without them", async () => {
    fetchPackShop.mockResolvedValue({ status: 'ok', shop: { ...shopJson, packMeter: { progress: 3, ready: 1, every: 10, rarity: 'legendary' } } });
    ui = mount(<ServerPackShop onClose={() => {}} />);
    await flush();
    expect(shopProps!.reward).toMatchObject({ rarity: 'legendary', every: 10, progress: 3, ready: 1 });
  });

  it('while the sign-in gate is up the shop ignores Esc (modalAbove), and the gate is on the stage above the shop', async () => {
    asGuest(true);
    fetchPackShop.mockResolvedValue({ status: 'ok', shop: shopJson });
    ui = mount(<ServerPackShop onClose={() => {}} />);
    await flush();
    expect(shopProps!.modalAbove).toBe(false);
    await act(async () => { await shopProps!.buy('w1:rarity-rare', 'req-1'); });
    expect(shopProps!.modalAbove).toBe(true);
    const host = document.querySelector('.pks-gatehost')!;
    expect(ui!.container.contains(host)).toBe(false); // portalled, not inline under the shop's parent
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(document.querySelector('.crgate-panel')).toBeNull();
    expect(shopProps!.modalAbove).toBe(false);
  });

  it('the failed panel is on the stage, takes focus on Try again, and Esc closes it', async () => {
    fetchPackShop.mockResolvedValue({ status: 'error', reason: 'timeout' });
    const onClose = vi.fn();
    ui = mount(<ServerPackShop onClose={onClose} />);
    await flush();
    const panel = document.querySelector('.pks-failed')!;
    expect(ui!.container.contains(panel)).toBe(false);
    expect(document.activeElement?.textContent).toBe('Try again');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a read that does not answer (the switch off) is the generic failed state, with Try again and Close', async () => {
    fetchPackShop.mockResolvedValue({ status: 'error', reason: 'packs_disabled' });
    const onClose = vi.fn();
    ui = mount(<ServerPackShop onClose={onClose} />);
    await flush();
    expect(shopProps).toBeNull();
    expect(document.querySelector('.pks-failed [role="alert"]')?.textContent).toBe('The Pack Shop could not be reached. Try again in a moment.');
    fetchPackShop.mockResolvedValue({ status: 'ok', shop: shopJson });
    const tryAgain = [...document.querySelectorAll<HTMLButtonElement>('.pks-failed button')].find((b) => b.textContent === 'Try again')!;
    act(() => { tryAgain.click(); });
    await flush();
    expect(shopProps).not.toBeNull();
    expect(document.querySelector('[title]')).toBeNull();
  });
});
