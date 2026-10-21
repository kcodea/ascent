// @vitest-environment jsdom
/**
 * THE CHEST SHOP SCREEN (2026-10-20, docs/superpowers/specs/2026-10-20-chest-shop-screen-design.md; the purchase rules
 * from the Aether design, 2026-10-18), rendered under jsdom with the store's purchase seams mocked (`buyCrate`,
 * `openCrate`, `refreshEconomy`), so no network runs:
 *  - the five painted chest cards pick a tier (a rarity floor); the focus rows tick categories in the shop's order; the
 *    receipt, the odds bar and the big button follow the picks;
 *  - a category with nothing left at this floor keeps its row, reads 0 and "None left", and is not priced;
 *  - a short balance and a sold-out chest disable the button with their reason;
 *  - a GUEST never spends (owner 2026-10-18, R-PROG-AETHER-02): the button calls `onGuest`, never the store;
 *  - a purchase completes before the theatre opens: `onOpen` gets the bought chest and an `open` that answers with it;
 *  - the purchase-safety rules (busy ref, kept request id, definite failures) carry over from the sidebar shop;
 *  - the server's refusals read as plain sentences.
 * No native tooltips, no em dashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import {
  COSMETIC_CATEGORY_DEFS, DEFAULT_AETHER_ECONOMY, RARITY_LABELS, eligibleForCrate,
  type BuyCrateResult, type CosmeticCategory, type CrateTier, type ProgressionProfile,
} from '@game/progression';
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
import { oddsSlices } from './chestShopModel';
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
const onBack = vi.fn();
function render(guest = false): void {
  onGuest.mockReset();
  onOpen.mockReset();
  onBusy.mockReset();
  onBack.mockReset();
  ui = mount(<CrateShop guest={guest} onGuest={onGuest} onOpen={onOpen} onBusy={onBusy} onBack={onBack} />);
}

const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const buyBtn = (): HTMLButtonElement => $('.cshop-buy') as HTMLButtonElement;
/** The big button's lines, joined: "Open Chest 400", "Buying…", "Need 100 more Aether", "Sold out". */
const buyText = (): string => [...buyBtn().children].map((c) => norm(c.textContent)).join(' ');
const tier = (label: string): HTMLButtonElement => $$('.cshop-chest').find((b) => norm(b.querySelector('.cshop-chest-name')?.textContent) === label) as HTMLButtonElement;
const row = (label: string): HTMLElement | undefined => $$('.cshop-cat[data-cat]').find((r) => norm(r.querySelector('.cshop-cat-name')?.textContent) === label);
const toggle = (label: string): HTMLButtonElement => row(label)!.querySelector('.cshop-toggle') as HTMLButtonElement;
const click = (b: HTMLElement): void => { act(() => { b.click(); }); };
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const noDashes = (): void => { expect(document.body.textContent).not.toMatch(/[—–]/); expect(document.querySelector('[title]')).toBeNull(); };
const err = (): string => norm($('.cshop-err')?.textContent);
/** The receipt as [what, amount] pairs, top to bottom (the chest line, each focus row, the total). */
const receipt = (): [string, string][] => $$('.cshop-receipt .cshop-line, .cshop-receipt .cshop-sub')
  .map((l) => [norm(l.querySelector('.cshop-what')?.textContent), norm(l.querySelector('.cshop-amt')?.textContent)]);
const esc = (): void => { act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); };

const bought = (crateId: string): BuyCrateResult => ({
  status: 'opened', rewardId: 'title_stormcaller', sealedRemaining: 0, aether: 1200,
  crate: { crateId, earnedLevel: null, state: 'opened', rewardId: 'title_stormcaller', earnedAt: 't0', openedAt: 't1', source: `shop:${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, floor: 'epic' },
  quote: { tier: 'epic', floor: 'epic', focus: null, crate: 400, fee: 0, total: 400, remaining: 50 },
});

describe('the Chest Shop screen (owner 2026-10-20: "a dedicated full screen experience for selecting the chest and focusing it")', () => {
  it('has a title, a Back button (and Esc) to the Collection, and five chest cards at the live prices; Standard is picked', () => {
    seed(2000);
    useProgression.setState({ economy: { ...DEFAULT_AETHER_ECONOMY, cratePrice: { ...DEFAULT_AETHER_ECONOMY.cratePrice, epic: 450 } } });
    render();
    expect(refreshEconomy).toHaveBeenCalledTimes(1); // fresh prices on mount
    expect($('.cshop[aria-label="Chest Shop"]')).not.toBeNull();
    expect(norm($('.cshop-title')?.textContent)).toBe('Chest Shop');
    const back = $('.cshop-back') as HTMLButtonElement;
    expect(norm(back.textContent)).toBe('◀ Collection');
    click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    esc();
    expect(onBack).toHaveBeenCalledTimes(2);
    const cards = $$('.cshop-chest');
    expect(cards.map((b) => `${norm(b.querySelector('.cshop-chest-name')?.textContent)} ${norm(b.querySelector('.cshop-chest-price')?.textContent)}`))
      .toEqual(['Standard 100', 'Rare 200', 'Epic 450', 'Legendary 600', 'Ancient 900']);
    expect(cards.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    // Each card draws its painted chest.
    expect(cards.every((b) => b.querySelectorAll('.chestpic img').length >= 2)).toBe(true);
    noDashes();
  });

  it('each chest card has a hover tip with its guarantee and its published odds', () => {
    seed(2000);
    render();
    const tipOf = (label: string): HTMLElement => tier(label).querySelector('.atip') as HTMLElement;
    expect(norm(tipOf('Standard').querySelector('.atip-title')?.textContent)).toBe('Standard Chest');
    expect(norm(tipOf('Standard').querySelector('.cshop-guar')?.textContent)).toBe('Any rarity can drop');
    expect(norm(tipOf('Epic').querySelector('.cshop-guar')?.textContent)).toBe('Guarantees Epic or better');
    expect([...tipOf('Epic').querySelectorAll('.cshop-orow')].map((r) => norm(r.textContent))).toEqual(['Epic64.7%', 'Legendary26.5%', 'Ancient8.8%']);
    expect(tipOf('Standard').querySelectorAll('.cshop-orow')).toHaveLength(5);
  });

  it('prices follow the picks', () => {
    seed(2000);
    render();
    click(tier('Epic'));
    expect(tier('Epic').getAttribute('aria-pressed')).toBe('true');
    expect(tier('Standard').getAttribute('aria-pressed')).toBe('false');
    expect(buyText()).toBe('Open Chest 400');
    // The price wears the Aether crystal (owner art 2026-10-19), decorative and hidden from readers.
    const gem = buyBtn().querySelector<HTMLImageElement>('img.aether-icon');
    expect(gem?.getAttribute('src')).toMatch(/currency\/aether\.webp$/);
    expect(gem?.getAttribute('aria-hidden')).toBe('true');
    expect(receipt()).toEqual([['Epic Chest', '400'], ['Total', '400']]);
    click(toggle('Card Plates'));
    expect(toggle('Card Plates').getAttribute('aria-pressed')).toBe('true');
    expect(buyText()).toBe('Open Chest 800');
    click(toggle('Heroes'));
    expect(buyText()).toBe('Open Chest 640');
    expect(buyBtn().getAttribute('aria-label')).toBe('Buy Epic Chest · Heroes, Card Plates for 640 Aether');
    expect(buyBtn().disabled).toBe(false);
    noDashes();
  });

  it('the focus rows are in the shop order, with no Announcers row, each with its count left to find', () => {
    seed(2000);
    render();
    click(tier('Epic'));
    const names = $$('.cshop-cat[data-cat]').map((r) => norm(r.querySelector('.cshop-cat-name')?.textContent));
    expect(names).toEqual(['Heroes', 'Minions', 'Card Plates', 'Portrait Frames', 'Attack Animations', 'Emotes', 'Titles']);
    for (const r of $$('.cshop-cat[data-cat]')) {
      const cat = r.dataset.cat as CosmeticCategory;
      expect(norm(r.querySelector('.cshop-cat-left')?.textContent), cat).toBe(String(eligibleForCrate([], 'epic', [cat]).length));
    }
    expect([...$('.cshop-cat-head')!.children].map((c) => norm(c.textContent))).toEqual(['CATEGORY', 'LEFT TO FIND']);
    // The toggles read Off until ticked, then "✓ On".
    expect(norm(toggle('Heroes').textContent)).toBe('Off');
    click(toggle('Heroes'));
    expect(norm(toggle('Heroes').textContent)).toBe('✓ On');
    expect(row('Heroes')!.classList.contains('on')).toBe(true);
    for (const name of ['Standard', 'Legendary', 'Ancient']) {
      click(tier(name));
      expect(row('Announcers'), name).toBeUndefined();
    }
  });

  it('the receipt: the first focus carries the cost, each later one its discount, in row order (Epic: +400, −160, −80 = 560)', () => {
    seed(2000);
    render();
    click(tier('Epic'));
    // Clicked out of row order: the receipt still lists (and discounts) in row order.
    click(toggle('Emotes'));
    click(toggle('Heroes'));
    click(toggle('Minions'));
    expect(receipt()).toEqual([
      ['Epic Chest', '400'], ['Focusing', ''], ['Heroes', '+400'], ['Minions', '−160'], ['Emotes', '−80'], ['Total', '560'],
    ]);
    expect(buyText()).toBe('Open Chest 560');
    expect($('.cshop-allnote')).toBeNull();
    // With no focus there is no Focusing block at all.
    for (const n of ['Emotes', 'Heroes', 'Minions']) click(toggle(n));
    expect(receipt()).toEqual([['Epic Chest', '400'], ['Total', '400']]);
  });

  it('ticking every focusable category is no focus: free, and the screen says any category (Announcers too) can drop', () => {
    seed(2000);
    render();
    click(tier('Epic'));
    for (const r of $$('.cshop-cat[data-cat]')) {
      const t = r.querySelector('.cshop-toggle') as HTMLButtonElement;
      if (!t.disabled) click(t);
    }
    const lines = receipt();
    expect(lines[lines.length - 1]).toEqual(['Total', '400']);
    expect(norm($('.cshop-allnote')?.textContent)).toBe('Everything ticked: no focus, so any category can drop, Announcers too.');
    expect(buyText()).toBe('Open Chest 400');
    // The odds come from the unfocused pool, so a tip can name Announcers.
    const tips = $$('.cshop-seg .atip').map((t) => norm(t.textContent)).join(' ');
    expect(tips).toMatch(/Announcers/);
  });

  it('a category with nothing left at this tier: kept row, 0, "None left", disabled; a tick from a lower tier is kept, not priced', () => {
    seed(2000);
    render();
    click(toggle('Titles')); // Standard: Titles has items left
    expect(buyText()).toBe('Open Chest 200');
    click(tier('Ancient'));
    const titles = toggle('Titles');
    expect(titles.disabled).toBe(true);
    expect(norm(titles.textContent)).toBe('None left');
    expect(norm(row('Titles')!.querySelector('.cshop-cat-left')?.textContent)).toBe('0');
    expect(titles.getAttribute('aria-pressed')).toBe('false');
    click(titles);
    expect(buyText()).toBe('Open Chest 900');
    expect(receipt()).toEqual([['Ancient Chest', '900'], ['Total', '900']]);
    // Back to Standard: the tick is still there, and priced again.
    click(tier('Standard'));
    expect(toggle('Titles').getAttribute('aria-pressed')).toBe('true');
    expect(buyText()).toBe('Open Chest 200');
  });

  it('the odds bar: one slice per rarity, only its percent inside; each tip names its categories with real counts', () => {
    seed(2000);
    render();
    click(tier('Epic'));
    const segs = $$('.cshop-seg');
    expect(segs.map((s) => norm(s.querySelector('.cshop-seg-pct')?.textContent))).toEqual(['64.7%', '26.5%', '8.8%']);
    const slices = oddsSlices([], 'epic', null);
    segs.forEach((s, i) => {
      const sl = slices[i]!;
      const name = RARITY_LABELS[sl.rarity];
      const tip = s.querySelector('.atip')!;
      expect(norm(tip.querySelector('.atip-title')?.textContent)).toBe(`${name} · ${sl.percent}%`);
      expect(norm(tip.querySelector('.cshop-oddsline')?.textContent)).toMatch(new RegExp(`^${sl.percent}% chance this chest gives an? ${name}\\. ${sl.count} ${name} items left to find:$`));
      expect([...tip.querySelectorAll('.cshop-orow')].map((r) => norm(r.textContent)))
        .toEqual(sl.byCategory.map((c) => `${COSMETIC_CATEGORY_DEFS[c.category].label}${c.count}`));
    });
    // A focus narrows the pool: Standard + Card Plates shows no Common.
    click(tier('Standard'));
    click(toggle('Card Plates'));
    const pcts = $$('.cshop-seg .atip-title').map((t) => norm(t.textContent));
    expect(pcts.some((t) => t.startsWith('Common'))).toBe(false);
    expect(pcts.length).toBeGreaterThan(0);
  });

  it('picking a chest warms every chest\x27s art on mount (Standard needs none)', () => {
    const urls: string[] = [];
    setChestArtLoaderForTests(async (url) => { urls.push(url); return {} as HTMLImageElement; });
    seed(2000);
    render();
    for (const t of ['rare', 'epic', 'legendary', 'ancient']) expect(urls.filter((u) => u.includes(`chest_${t}`)), t).toHaveLength(2);
    expect(urls.some((u) => u.includes('crate_'))).toBe(false); // the theatre bakes Standard itself
  });
});

describe('the Chest Shop: buying', () => {
  it('short balance disables the button', () => {
    seed(300);
    render();
    click(tier('Epic'));
    expect(buyBtn().disabled).toBe(true);
    expect(buyText()).toBe('Need 100 more Aether');
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

  it('a guest with no Aether still reaches the sign-in gate: the button stays enabled at the price (ruling 2026-10-19)', async () => {
    seed(0);
    render(true);
    click(tier('Epic'));
    expect(buyBtn().disabled).toBe(false);
    expect(buyText()).toBe('Open Chest 400');
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

  it('while buying, Back is disabled and Esc does nothing', async () => {
    seed(2000);
    let answer!: (o: BuyCrateOutcome) => void;
    buyCrate.mockImplementationOnce(() => new Promise<BuyCrateOutcome>((r) => { answer = r; }));
    render();
    click(buyBtn());
    const back = $('.cshop-back') as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    click(back);
    esc();
    expect(onBack).not.toHaveBeenCalled();
    await act(async () => { answer({ status: 'error', reason: 'price_changed' }); await Promise.resolve(); });
    await settle();
    expect(back.disabled).toBe(false);
    esc();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Esc that a capturing overlay already handled does not leave the shop', () => {
    seed(2000);
    render();
    const capture = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); } };
    window.addEventListener('keydown', capture, true);
    try { esc(); } finally { window.removeEventListener('keydown', capture, true); }
    expect(onBack).not.toHaveBeenCalled();
  });

  it('a purchase that succeeds after the shop unmounted still hands the theatre its chest (a charged player always gets the reveal)', async () => {
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

  it('buy then open; afterwards the focus is cleared and the tier stays', async () => {
    seed(2000);
    let answer!: (o: BuyCrateOutcome) => void;
    buyCrate.mockImplementationOnce(() => new Promise<BuyCrateOutcome>((r) => { answer = r; }));
    render();
    click(tier('Epic'));
    click(toggle('Card Plates'));
    click(buyBtn());
    expect(buyCrate).toHaveBeenCalledWith('epic', ['card_plate'], 800, expect.stringMatching(/^[0-9a-f-]{36}$/));
    // The purchase is in flight: the button holds a pressed "Buying" state and the theatre has not opened.
    expect(buyText()).toBe('Buying…');
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
    expect(tier('Epic').getAttribute('aria-pressed')).toBe('true');
    expect(toggle('Card Plates').getAttribute('aria-pressed')).toBe('false');
    expect(buyText()).toBe('Open Chest 400');
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

  // Owner 2026-10-20: milestone chests are Epic and "you cannot focus those ones specifically": the shop has no mode that
  // opens an earned crate, so it only ever buys.
  it('only buys: no milestone mode', async () => {
    seed(2000);
    render();
    expect($('.cshop.milestone')).toBeNull();
    expect(buyText()).toBe('Open Chest 100');
    expect(openCrate).not.toHaveBeenCalled();
  });

  it('price_changed shows the message', async () => {
    seed(2000);
    buyCrate.mockResolvedValueOnce({ status: 'error', reason: 'price_changed' });
    render();
    click(tier('Epic'));
    click(buyBtn());
    await settle();
    expect(err()).toBe('Prices just changed. Check the new price.');
    expect(onOpen).not.toHaveBeenCalled();
    // The button comes back for another try at the new price.
    expect(buyText()).toBe('Open Chest 400');
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
      expect(err()).toBe(copy);
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
    expect(err()).toBe("Couldn't confirm that purchase. Try again: you won't be charged twice.");
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
      expect(err(), reason).toBe("Couldn't confirm that purchase. Try again: you won't be charged twice.");
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
    // Ticking a focus is a change of picks as well.
    click(toggle('Card Plates'));
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
    expect(err()).toBe('Nothing left to find in this chest.');
    buyCrate.mockResolvedValueOnce({ status: 'error', reason: 'timeout' });
    click(buyBtn());
    await settle();
    expect(ids()[1]).toBe(ids()[0]);
    expect(ids()[2]).not.toBe(ids()[1]);
  });
});

// The server's kill switch (admin_off): the catalog epoch moves, and the shop's pool re-derives.
describe('the Chest Shop: the server catalog switch', () => {
  it('a category the server switches off leaves the focus list and the odds counts; switching it back restores both', () => {
    seed(2000);
    render();
    click(tier('Epic'));
    const left = (): number => $$('.cshop-seg .cshop-oddsline')
      .reduce((n, l) => n + Number(/(\d+) \w+ items left to find/.exec(norm(l.textContent))![1]), 0);
    const before = left();
    const plates = eligibleForCrate([], 'epic', ['card_plate']).length;
    expect(row('Card Plates')).toBeDefined();
    act(() => { applyServerCatalogState({ retiredIds: [], disabledCategories: ['card_plate'] }, false); });
    expect(row('Card Plates')).toBeUndefined();
    expect(left()).toBe(before - plates);
    act(() => { applyServerCatalogState(null, false); });
    expect(row('Card Plates')).toBeDefined();
    expect(left()).toBe(before);
  });
});
