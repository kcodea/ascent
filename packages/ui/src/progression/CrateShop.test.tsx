// @vitest-environment jsdom
/**
 * THE CRATE SHOP PICKER (Aether, 2026-10-18; spec docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md),
 * rendered under jsdom with the store's purchase seams mocked (`buyCrate`, `openCrate`, `refreshEconomy`), so no
 * network runs:
 *  - step 1 picks a tier (a rarity floor), step 2 ticks focus chips; the price follows the picks;
 *  - a category with nothing left at this floor is a disabled chip;
 *  - a short balance and a sold-out crate disable Buy with their reason;
 *  - a GUEST never spends (owner 2026-10-18, R-PROG-AETHER-02): Buy and a milestone crate's Open call `onGuest`, never
 *    the store;
 *  - a purchase completes before the theatre opens: `onOpen` gets the bought crate and an `open` that answers with it;
 *  - milestone mode: no tier row, a free unfocused Open, the Legendary focus fee once a chip is ticked;
 *  - the server's refusals read as plain sentences.
 * No native tooltips, no em dashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { eligibleForCrate, type BuyCrateResult, type CosmeticCategory, type CrateRow, type CrateTier, type ProgressionProfile } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';
import type { BuyCrateOutcome, CrateOpenOutcome } from './progressionStore';

const buyCrate = vi.fn(async (_tier: CrateTier, _focus: CosmeticCategory[] | null, _total: number): Promise<BuyCrateOutcome> => ({ status: 'error', reason: 'unset' }));
const openCrate = vi.fn(async (_id: string, _focus?: CosmeticCategory[] | null, _fee?: number): Promise<CrateOpenOutcome> => ({ status: 'error', reason: 'unset' }));
const refreshEconomy = vi.fn(async () => undefined);
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('./progressionStore', async (orig) => ({
  ...(await orig<typeof import('./progressionStore')>()),
  buyCrate: (tier: CrateTier, focus: CosmeticCategory[] | null, total: number) => buyCrate(tier, focus, total),
  // Forwards exactly the arguments it got, so a test can pin that an unfocused open passes the id ALONE.
  openCrate: (...args: [string, (CosmeticCategory[] | null)?, number?]) => openCrate(...args),
  refreshEconomy: () => refreshEconomy(),
}));

import { CrateShop, type CrateShopMode } from './CrateShop';
import { resetProgressionForTests, useProgression } from './progressionStore';
import { useGame } from '../store';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
beforeEach(() => {
  resetProgressionForTests();
  buyCrate.mockClear();
  openCrate.mockClear();
  refreshEconomy.mockClear();
});

const profile = (aether: number, over: Partial<ProgressionProfile> = {}): ProgressionProfile =>
  ({ accountXp: 0, accountLevel: 10, revision: 1, equippedTitleId: null, titles: [], cosmetics: [], aether, ...over });
function seed(aether: number): void {
  useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null } });
  useProgression.setState({ capability: 'on', cratesCapability: 'on', aetherCapability: 'on', mirror: { userId: 'u-1', ...profile(aether) } });
}
const milestoneCrate: CrateRow = { crateId: 'c-m10', earnedLevel: null, state: 'sealed', rewardId: null, earnedAt: 't0', openedAt: null, source: 'milestone:10', floor: 'legendary' };

const onGuest = vi.fn();
const onOpen = vi.fn();
const onBusy = vi.fn();
function render(mode: CrateShopMode = { kind: 'shop' }, guest = false): void {
  onGuest.mockReset();
  onOpen.mockReset();
  onBusy.mockReset();
  ui = mount(<CrateShop mode={mode} guest={guest} onGuest={onGuest} onOpen={onOpen} onBusy={onBusy} />);
}

const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const buyBtn = (): HTMLButtonElement => $('.colls-shop-buy') as HTMLButtonElement;
const tier = (label: string): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>('.colls-shop-tier')].find((b) => norm(b.querySelector('.colls-shop-tier-name')?.textContent) === label)!;
const chip = (label: string): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>('.colls-shop-chip')].find((b) => norm(b.textContent) === label)!;
const click = (b: HTMLElement): void => { act(() => { b.click(); }); };
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const noDashes = (): void => { expect(document.body.textContent).not.toMatch(/[—–]/); expect(document.querySelector('[title]')).toBeNull(); };

const bought = (crateId: string): BuyCrateResult => ({
  status: 'opened', rewardId: 'title_stormcaller', sealedRemaining: 0, aether: 1200,
  crate: { crateId, earnedLevel: null, state: 'opened', rewardId: 'title_stormcaller', earnedAt: 't0', openedAt: 't1', source: `shop:${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, floor: 'epic' },
  quote: { tier: 'epic', floor: 'epic', focus: null, crate: 400, fee: 0, total: 400, remaining: 50 },
});

describe('the Crate Shop picker (owner 2026-10-18: "you purchase a crate of various rarity floors, but then you can pay additional ammounts to focus it")', () => {
  it('prices follow the picks', () => {
    seed(2000);
    render();
    expect(refreshEconomy).toHaveBeenCalledTimes(1); // fresh prices on mount
    // Five tiers, each with its label and price, one pressed.
    const tiers = [...document.querySelectorAll<HTMLButtonElement>('.colls-shop-tier')];
    expect(tiers.map((b) => [...b.children].map((s) => norm(s.textContent)).join(' '))).toEqual(['Standard ◆ 100', 'Rare ◆ 200', 'Epic ◆ 400', 'Legendary ◆ 600', 'Ancient ◆ 900']);
    click(tier('Epic'));
    expect(tier('Epic').getAttribute('aria-pressed')).toBe('true');
    expect(tier('Standard').getAttribute('aria-pressed')).toBe('false');
    expect(norm(buyBtn().textContent)).toBe('◆ 400');
    expect(norm($('.colls-shop-name')?.textContent)).toBe('Epic Crate');
    expect(norm($('.colls-shop-odds')?.textContent)).toBe('Epic 64.7% · Legendary 26.5% · Ancient 8.8%');
    expect(norm($('.colls-shop-left')?.textContent)).toMatch(/^\d+ left to find$/);
    click(chip('Card Plates'));
    expect(chip('Card Plates').getAttribute('aria-pressed')).toBe('true');
    expect(norm(buyBtn().textContent)).toBe('◆ 800');
    expect(norm($('.colls-shop-name')?.textContent)).toBe('Epic Crate · Card Plates');
    click(chip('Heroes'));
    expect(norm(buyBtn().textContent)).toBe('◆ 640');
    expect(norm($('.colls-shop-name')?.textContent)).toBe('Epic Crate · Heroes, Card Plates');
    expect(buyBtn().disabled).toBe(false);
    noDashes();
  });

  it('sold-out chip is disabled', () => {
    seed(2000);
    render();
    click(tier('Ancient'));
    const titles = chip('Titles');
    expect(titles.disabled).toBe(true);
    expect(titles.getAttribute('aria-description')).toBe('Nothing left to find here');
    click(titles);
    expect(titles.getAttribute('aria-pressed')).toBe('false');
    expect(norm(buyBtn().textContent)).toBe('◆ 900');
  });

  it('short balance disables Buy', () => {
    seed(300);
    render();
    click(tier('Epic'));
    expect(buyBtn().disabled).toBe(true);
    expect(norm(buyBtn().textContent)).toBe('Need 100 more Aether');
    click(buyBtn());
    expect(buyCrate).not.toHaveBeenCalled();
  });

  it('guest is gated', async () => {
    seed(2000);
    render({ kind: 'shop' }, true);
    click(tier('Epic'));
    click(buyBtn());
    await settle();
    expect(onGuest).toHaveBeenCalledTimes(1);
    expect(buyCrate).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('a guest with no Aether still reaches the sign-in gate: Buy stays enabled at the price (ruling 2026-10-19)', async () => {
    seed(0);
    render({ kind: 'shop' }, true);
    click(tier('Epic'));
    expect(buyBtn().disabled).toBe(false);
    expect(norm(buyBtn().textContent)).toBe('◆ 400');
    click(buyBtn());
    await settle();
    expect(onGuest).toHaveBeenCalledTimes(1);
    expect(buyCrate).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('two clicks inside ONE act buy once (the busy ref, not the re-render, stops the second)', async () => {
    seed(2000);
    buyCrate.mockImplementationOnce(() => new Promise<BuyCrateOutcome>(() => {}));
    render();
    const b = buyBtn();
    act(() => { b.click(); b.click(); });
    expect(buyCrate).toHaveBeenCalledTimes(1);
  });

  it('reports a purchase in flight through onBusy, and clears it after', async () => {
    seed(2000);
    let answer!: (o: BuyCrateOutcome) => void;
    buyCrate.mockImplementationOnce(() => new Promise<BuyCrateOutcome>((r) => { answer = r; }));
    render();
    click(buyBtn());
    expect(onBusy.mock.calls).toEqual([[true]]);
    await act(async () => { answer({ status: 'error', reason: 'price_changed' }); await Promise.resolve(); });
    await settle();
    expect(onBusy.mock.calls).toEqual([[true], [false]]);
  });

  it('a purchase that succeeds after the shop unmounted still hands the theatre its crate (a charged player always gets the reveal)', async () => {
    seed(2000);
    let answer!: (o: BuyCrateOutcome) => void;
    buyCrate.mockImplementationOnce(() => new Promise<BuyCrateOutcome>((r) => { answer = r; }));
    render();
    click(tier('Epic'));
    click(buyBtn());
    ui!.unmount();
    ui = null;
    const result = bought('c-late');
    await act(async () => { answer({ status: 'ok', result }); await Promise.resolve(); });
    await settle();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect((onOpen.mock.calls[0]![0] as { crateId: string }).crateId).toBe('c-late');
    expect(onBusy.mock.calls).toEqual([[true], [false]]);
  });

  it('buy then open', async () => {
    seed(2000);
    let answer!: (o: BuyCrateOutcome) => void;
    buyCrate.mockImplementationOnce(() => new Promise<BuyCrateOutcome>((r) => { answer = r; }));
    render();
    click(tier('Epic'));
    click(chip('Card Plates'));
    click(buyBtn());
    expect(buyCrate).toHaveBeenCalledWith('epic', ['card_plate'], 800);
    // The purchase is in flight: the button holds a pressed "Buying" state and the theatre has not opened.
    expect(norm(buyBtn().textContent)).toBe('Buying…');
    expect(buyBtn().getAttribute('aria-busy')).toBe('true');
    click(buyBtn());
    expect(buyCrate).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    const result = bought('c-new');
    await act(async () => { answer({ status: 'ok', result }); await Promise.resolve(); });
    await settle();
    expect(onOpen).toHaveBeenCalledTimes(1);
    const [item, open] = onOpen.mock.calls[0]! as [{ crateId: string; earnedLevel: number | null; source?: string }, (id: string) => Promise<CrateOpenOutcome>];
    expect(item).toEqual({ crateId: 'c-new', earnedLevel: null, source: result.crate.source });
    await expect(open('c-new')).resolves.toEqual({ status: 'ok', result });
    expect(openCrate).not.toHaveBeenCalled();
  });

  it('milestone mode', async () => {
    seed(2000);
    render({ kind: 'milestone', crate: milestoneCrate });
    expect($('.colls-shop-tiers')).toBeNull();
    expect(norm($('.colls-shop-name')?.textContent)).toBe('Level 10 Legendary Crate');
    expect(norm(buyBtn().textContent)).toBe('Open');
    click(chip('Card Plates'));
    expect(norm(buyBtn().textContent)).toBe('◆ 600');
    click(buyBtn());
    await settle();
    expect(buyCrate).not.toHaveBeenCalled();
    expect(onOpen).toHaveBeenCalledTimes(1);
    const [item, open] = onOpen.mock.calls[0]! as [{ crateId: string; earnedLevel: number | null; source?: string }, (id: string) => Promise<CrateOpenOutcome>];
    expect(item).toEqual({ crateId: 'c-m10', earnedLevel: null, source: 'milestone:10' });
    expect(openCrate).not.toHaveBeenCalled(); // the theatre asks when it plays
    void open('c-m10');
    expect(openCrate).toHaveBeenCalledWith('c-m10', ['card_plate'], 600);
  });

  it('milestone mode: an unfocused Open asks the server with the crate id ALONE (no focus, no fee)', async () => {
    seed(2000);
    render({ kind: 'milestone', crate: milestoneCrate });
    click(buyBtn());
    await settle();
    expect(onOpen).toHaveBeenCalledTimes(1);
    const open = onOpen.mock.calls[0]![1] as (id: string) => Promise<CrateOpenOutcome>;
    void open('c-m10');
    expect(openCrate.mock.calls).toHaveLength(1);
    expect(openCrate.mock.calls[0]).toStrictEqual(['c-m10']);
  });

  it('milestone mode: two clicks inside ONE act hand the theatre the crate once', async () => {
    seed(2000);
    render({ kind: 'milestone', crate: milestoneCrate });
    const b = buyBtn();
    act(() => { b.click(); b.click(); });
    await settle();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(openCrate).not.toHaveBeenCalled();
  });

  it('milestone mode: nothing left at Legendary reads Sold out and is disabled', async () => {
    useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null } });
    const all = eligibleForCrate([], 'legendary', null).map((c) => c.id);
    useProgression.setState({ capability: 'on', cratesCapability: 'on', aetherCapability: 'on', mirror: { userId: 'u-1', ...profile(2000, { cosmetics: all }) } });
    render({ kind: 'milestone', crate: milestoneCrate });
    expect(norm(buyBtn().textContent)).toBe('Sold out');
    expect(buyBtn().disabled).toBe(true);
    click(buyBtn());
    await settle();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('milestone mode: Back is offered when the caller passes one; Back and Open are held while the caller says so', () => {
    seed(2000);
    const onBack = vi.fn();
    ui = mount(<CrateShop mode={{ kind: 'milestone', crate: milestoneCrate }} guest={false} onGuest={onGuest} onOpen={onOpen} onBack={onBack} held />);
    const back = [...document.querySelectorAll<HTMLButtonElement>('.colls-shop button')].find((x) => norm(x.textContent) === 'Back')!;
    expect(back.disabled).toBe(true);
    click(back);
    expect(onBack).not.toHaveBeenCalled();
    expect(buyBtn().disabled).toBe(true);
    click(buyBtn());
    expect(onOpen).not.toHaveBeenCalled();
    ui.render(<CrateShop mode={{ kind: 'milestone', crate: milestoneCrate }} guest={false} onGuest={onGuest} onOpen={onOpen} onBack={onBack} held={false} />);
    click([...document.querySelectorAll<HTMLButtonElement>('.colls-shop button')].find((x) => norm(x.textContent) === 'Back')!);
    expect(onBack).toHaveBeenCalledTimes(1);
    noDashes();
  });

  it('milestone mode: a guest cannot open it, focused or not', async () => {
    seed(2000);
    render({ kind: 'milestone', crate: milestoneCrate }, true);
    click(buyBtn());
    click(chip('Card Plates'));
    click(buyBtn());
    await settle();
    expect(onGuest).toHaveBeenCalledTimes(2);
    expect(onOpen).not.toHaveBeenCalled();
    expect(openCrate).not.toHaveBeenCalled();
  });

  it('price_changed shows the message', async () => {
    seed(2000);
    buyCrate.mockResolvedValueOnce({ status: 'error', reason: 'price_changed' });
    render();
    click(tier('Epic'));
    click(buyBtn());
    await settle();
    expect(norm($('.colls-shop-err')?.textContent)).toBe('Prices just changed. Check the new price.');
    expect(onOpen).not.toHaveBeenCalled();
    // The button comes back for another try at the new price.
    expect(norm(buyBtn().textContent)).toBe('◆ 400');
    expect(buyBtn().disabled).toBe(false);
  });

  it('the other refusals read as plain sentences', async () => {
    seed(2000);
    render();
    const cases: [string, string][] = [
      ['insufficient_aether', 'Not enough Aether.'],
      ['sold_out', 'Nothing left to find in this crate.'],
      ['aether_disabled', "Couldn't buy that crate. Try again."],
    ];
    for (const [reason, copy] of cases) {
      buyCrate.mockResolvedValueOnce({ status: 'error', reason });
      click(buyBtn());
      await settle();
      expect(norm($('.colls-shop-err')?.textContent)).toBe(copy);
    }
    noDashes();
  });
});
