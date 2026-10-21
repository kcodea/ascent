// @vitest-environment jsdom
/**
 * THE CRATE SHOP PICKER (Aether, 2026-10-18; spec docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md),
 * rendered under jsdom with the store's purchase seams mocked (`buyCrate`, `openCrate`, `refreshEconomy`), so no
 * network runs:
 *  - step 1 picks a tier (a rarity floor), step 2 ticks focus chips; the price follows the picks;
 *  - a category with nothing left at this floor is a disabled chip;
 *  - a short balance and a sold-out crate disable Buy with their reason;
 *  - a GUEST never spends (owner 2026-10-18, R-PROG-AETHER-02): Buy calls `onGuest`, never the store;
 *  - a purchase completes before the theatre opens: `onOpen` gets the bought crate and an `open` that answers with it;
 *  - there is no milestone mode any more (owner 2026-10-20: milestone chests "you cannot focus those ones"): the panel
 *    is the shop alone, and it never opens an earned crate;
 *  - the server's refusals read as plain sentences.
 * No native tooltips, no em dashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { eligibleForCrate, type BuyCrateResult, type CosmeticCategory, type CrateTier, type ProgressionProfile } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';
import type { BuyCrateOutcome, CrateOpenOutcome } from './progressionStore';

const buyCrate = vi.fn(async (_tier: CrateTier, _focus: CosmeticCategory[] | null, _total: number, _requestId?: string): Promise<BuyCrateOutcome> => ({ status: 'error', reason: 'unset' }));
const openCrate = vi.fn(async (_id: string, _focus?: CosmeticCategory[] | null, _fee?: number): Promise<CrateOpenOutcome> => ({ status: 'error', reason: 'unset' }));
const refreshEconomy = vi.fn(async () => undefined);
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('./progressionStore', async (orig) => ({
  ...(await orig<typeof import('./progressionStore')>()),
  buyCrate: (tier: CrateTier, focus: CosmeticCategory[] | null, total: number, requestId?: string) => buyCrate(tier, focus, total, requestId),
  // Forwards exactly the arguments it got, so a test can pin that an unfocused open passes the id ALONE.
  openCrate: (...args: [string, (CosmeticCategory[] | null)?, number?]) => openCrate(...args),
  refreshEconomy: () => refreshEconomy(),
}));

import { CrateShop } from './CrateShop';
import { setChestArtLoaderForTests } from './crateFx/chestArt';
import { applyServerCatalogState, resetProgressionForTests, useProgression } from './progressionStore';
import { useGame } from '../store';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; setChestArtLoaderForTests(null); });
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

const onGuest = vi.fn();
const onOpen = vi.fn();
const onBusy = vi.fn();
function render(guest = false): void {
  onGuest.mockReset();
  onOpen.mockReset();
  onBusy.mockReset();
  ui = mount(<CrateShop guest={guest} onGuest={onGuest} onOpen={onOpen} onBusy={onBusy} />);
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

describe('the Chest Shop picker (owner 2026-10-18: "you purchase a crate of various rarity floors, but then you can pay additional ammounts to focus it")', () => {
  it('prices follow the picks', () => {
    seed(2000);
    render();
    expect(refreshEconomy).toHaveBeenCalledTimes(1); // fresh prices on mount
    // Five tiers, each with its label and price, one pressed.
    const tiers = [...document.querySelectorAll<HTMLButtonElement>('.colls-shop-tier')];
    expect(tiers.map((b) => [...b.children].map((s) => norm(s.textContent)).join(' '))).toEqual(['Standard 100', 'Rare 200', 'Epic 400', 'Legendary 600', 'Ancient 900']);
    click(tier('Epic'));
    expect(tier('Epic').getAttribute('aria-pressed')).toBe('true');
    expect(tier('Standard').getAttribute('aria-pressed')).toBe('false');
    expect(norm(buyBtn().textContent)).toBe('400');
    // The price wears the Aether crystal (owner art 2026-10-19), decorative and hidden from readers.
    const gem = buyBtn().querySelector<HTMLImageElement>('img.aether-icon');
    expect(gem?.getAttribute('src')).toMatch(/currency\/aether\.webp$/);
    expect(gem?.getAttribute('aria-hidden')).toBe('true');
    expect(norm($('.colls-shop-name')?.textContent)).toBe('Epic Chest');
    expect(norm($('.colls-shop-odds')?.textContent)).toBe('Epic 64.7% · Legendary 26.5% · Ancient 8.8%');
    expect(norm($('.colls-shop-left')?.textContent)).toMatch(/^\d+ left to find$/);
    click(chip('Card Plates'));
    expect(chip('Card Plates').getAttribute('aria-pressed')).toBe('true');
    expect(norm(buyBtn().textContent)).toBe('800');
    expect(norm($('.colls-shop-name')?.textContent)).toBe('Epic Chest · Card Plates');
    click(chip('Heroes'));
    expect(norm(buyBtn().textContent)).toBe('640');
    expect(norm($('.colls-shop-name')?.textContent)).toBe('Epic Chest · Heroes, Card Plates');
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
    expect(norm(buyBtn().textContent)).toBe('900');
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
    render(true);
    click(tier('Epic'));
    click(buyBtn());
    await settle();
    expect(onGuest).toHaveBeenCalledTimes(1);
    expect(buyCrate).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('a guest with no Aether still reaches the sign-in gate: Buy stays enabled at the price (ruling 2026-10-19)', async () => {
    seed(0);
    render(true);
    click(tier('Epic'));
    expect(buyBtn().disabled).toBe(false);
    expect(norm(buyBtn().textContent)).toBe('400');
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
    expect(buyCrate).toHaveBeenCalledWith('epic', ['card_plate'], 800, expect.stringMatching(/^[0-9a-f-]{36}$/));
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
    expect(item).toEqual({ crateId: 'c-new', earnedLevel: null, source: result.crate.source, tier: 'epic' });
    await expect(open('c-new')).resolves.toEqual({ status: 'ok', result });
    expect(openCrate).not.toHaveBeenCalled();
  });

  // TIERED CHEST OPENINGS (2026-10-19): the bought tier's floor is the chest the theatre opens.
  it('a bought chest carries its tier: Epic opens the Epic chest, Standard the Standard one', async () => {
    seed(2000);
    render();
    buyCrate.mockResolvedValueOnce({ status: 'ok', result: bought('c-epic') });
    click(tier('Epic'));
    click(buyBtn());
    await settle();
    expect(buyCrate).toHaveBeenCalledWith('epic', null, expect.any(Number), expect.any(String));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect((onOpen.mock.calls[0]![0] as { tier?: string }).tier).toBe('epic');
    ui!.unmount();
    render();
    const std = bought('c-std');
    buyCrate.mockResolvedValueOnce({ status: 'ok', result: { ...std, quote: { ...std.quote!, tier: 'standard', floor: 'common' } } });
    click(tier('Standard'));
    click(buyBtn());
    await settle();
    expect((onOpen.mock.calls[0]![0] as { tier?: string }).tier).toBe('standard');
  });

  // Final review (2026-10-19): the chest's art loads while the player is still choosing, never cold at the click.
  it('picking a tier preloads that chest\x27s art (Standard needs none)', () => {
    const urls: string[] = [];
    setChestArtLoaderForTests(async (url) => { urls.push(url); return {} as HTMLImageElement; });
    seed(2000);
    render();
    expect(urls).toEqual([]); // Standard is picked: the theatre bakes it itself
    click(tier('Epic'));
    expect(urls.filter((u) => u.includes('chest_epic'))).toHaveLength(2);
    click(tier('Ancient'));
    expect(urls.filter((u) => u.includes('chest_ancient'))).toHaveLength(2);
  });

  // Owner 2026-10-20: milestone chests are Epic and "you cannot focus those ones specifically": the shop has no mode that
  // opens an earned crate, so it is always the shop (its head, its tier row) and only ever buys.
  it('is the Chest Shop alone: no milestone mode, no Back, and its button only buys', async () => {
    seed(2000);
    render();
    expect(norm($('.colls-shop-head')?.textContent)).toBe('Chest Shop');
    expect($('.colls-shop.milestone')).toBeNull();
    expect($('.colls-shop-tiers')).not.toBeNull();
    expect([...document.querySelectorAll<HTMLButtonElement>('.colls-shop button')].some((x) => norm(x.textContent) === 'Back')).toBe(false);
    expect(norm(buyBtn().textContent)).toBe('100');
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
    expect(norm(buyBtn().textContent)).toBe('400');
    expect(buyBtn().disabled).toBe(false);
  });

  it('the other refusals read as plain sentences', async () => {
    seed(2000);
    render();
    const cases: [string, string][] = [
      ['insufficient_aether', 'Not enough Aether.'],
      ['sold_out', 'Nothing left to find in this chest.'],
      ['aether_disabled', "Couldn't buy that chest. Try again."],
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

// FINAL REVIEW 2026-10-19: a purchase whose answer never came may have landed. The retry must reuse its request id (a
// replay answers already_opened with the reward), never mint a second purchase.
describe('the Chest Shop: never charged twice', () => {
  const ids = (): (string | undefined)[] => buyCrate.mock.calls.map((c) => c[3]);

  it('a timeout then a retry sends the SAME request id, and the replay plays the reveal', async () => {
    seed(2000);
    render();
    click(tier('Epic'));
    buyCrate.mockResolvedValueOnce({ status: 'error', reason: 'timeout' });
    click(buyBtn());
    await settle();
    expect(norm($('.colls-shop-err')?.textContent)).toBe("Couldn't confirm that purchase. Try again: you won't be charged twice.");
    expect(onOpen).not.toHaveBeenCalled();
    const replay: BuyCrateResult = { ...bought('c-landed'), status: 'already_opened', quote: null };
    buyCrate.mockResolvedValueOnce({ status: 'ok', result: replay });
    click(buyBtn());
    await settle();
    expect(ids()).toHaveLength(2);
    expect(ids()[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids()[1]).toBe(ids()[0]);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect((onOpen.mock.calls[0]![0] as { crateId: string }).crateId).toBe('c-landed');
    // Answered: the next purchase is a new one.
    buyCrate.mockResolvedValueOnce({ status: 'ok', result: bought('c-next') });
    click(buyBtn());
    await settle();
    expect(ids()[2]).not.toBe(ids()[0]);
    noDashes();
  });

  it('a network error or a 5xx keeps the id too', async () => {
    seed(2000);
    render();
    for (const reason of ['network:Failed to fetch', 'http_502', 'aether_config_missing']) {
      buyCrate.mockResolvedValueOnce({ status: 'error', reason });
      click(buyBtn());
      await settle();
      expect(norm($('.colls-shop-err')?.textContent), reason).toBe("Couldn't confirm that purchase. Try again: you won't be charged twice.");
    }
    expect(new Set(ids()).size).toBe(1);
  });

  it('changing the tier between attempts sends a NEW id', async () => {
    seed(2000);
    render();
    click(tier('Epic'));
    buyCrate.mockResolvedValueOnce({ status: 'error', reason: 'timeout' });
    click(buyBtn());
    await settle();
    click(tier('Rare'));
    click(tier('Epic')); // back to the same picks: the change already dropped the kept id
    buyCrate.mockResolvedValueOnce({ status: 'error', reason: 'timeout' });
    click(buyBtn());
    await settle();
    expect(ids()).toHaveLength(2);
    expect(ids()[1]).not.toBe(ids()[0]);
    // Ticking a chip is a change of picks as well.
    click(chip('Card Plates'));
    buyCrate.mockResolvedValueOnce({ status: 'error', reason: 'timeout' });
    click(buyBtn());
    await settle();
    expect(buyCrate.mock.calls[2]!.slice(0, 3)).toEqual(['epic', ['card_plate'], 800]);
    expect(ids()[2]).not.toBe(ids()[1]);
  });

  it('a definite refusal (sold_out) clears the id', async () => {
    seed(2000);
    render();
    buyCrate.mockResolvedValueOnce({ status: 'error', reason: 'timeout' });
    click(buyBtn());
    await settle();
    buyCrate.mockResolvedValueOnce({ status: 'error', reason: 'sold_out' });
    click(buyBtn());
    await settle();
    expect(norm($('.colls-shop-err')?.textContent)).toBe('Nothing left to find in this chest.');
    buyCrate.mockResolvedValueOnce({ status: 'error', reason: 'timeout' });
    click(buyBtn());
    await settle();
    expect(ids()[1]).toBe(ids()[0]);
    expect(ids()[2]).not.toBe(ids()[1]);
  });
});

// The spec: "the live odds for that exact crate". A rarity a crate cannot give shows nowhere; its odds show where they fall.
describe('the Chest Shop: live odds', () => {
  it('Standard + Card Plates shows no Common', () => {
    seed(2000);
    render();
    click(chip('Card Plates'));
    const line = norm($('.colls-shop-odds')?.textContent);
    expect(line).not.toMatch(/Common/);
    expect(line.length).toBeGreaterThan(0);
  });

  it('Standard + Announcers shows only Legendary 100%', () => {
    seed(2000);
    render();
    click(chip('Announcers'));
    expect(norm($('.colls-shop-odds')?.textContent)).toBe('Legendary 100%');
  });

  it('an unfocused Epic crate with a fresh collection shows 64.7 / 26.5 / 8.8', () => {
    seed(2000);
    render();
    click(tier('Epic'));
    expect(norm($('.colls-shop-odds')?.textContent)).toBe('Epic 64.7% · Legendary 26.5% · Ancient 8.8%');
  });
});

// The server's kill switch (admin_off): the catalog epoch moves, and the shop's pool re-derives.
describe('the Chest Shop: the server catalog switch', () => {
  it('a category the server switches off leaves the chip row and the count; switching it back restores both', () => {
    seed(2000);
    render();
    click(tier('Epic'));
    const left = (): number => Number(/^(\d+) left/.exec(norm($('.colls-shop-left')?.textContent))![1]);
    const before = left();
    const plates = eligibleForCrate([], 'epic', ['card_plate']).length;
    expect(chip('Card Plates')).toBeDefined();
    act(() => { applyServerCatalogState({ retiredIds: [], disabledCategories: ['card_plate'] }, false); });
    expect(chip('Card Plates')).toBeUndefined();
    expect(left()).toBe(before - plates);
    act(() => { applyServerCatalogState(null, false); });
    expect(chip('Card Plates')).toBeDefined();
    expect(left()).toBe(before);
  });
});
