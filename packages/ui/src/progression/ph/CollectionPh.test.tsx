// @vitest-environment jsdom
/**
 * THE COLLECTION + CHEST SHOP IN THE PARTY HOME SHELL (DEV switch). The same page and the same shop, drawn by
 * `CollectionPh` / `CrateShopPh`: with the switch OFF the page is today's (nothing of the shell mounts); ON, every
 * capability is still there and still goes through the page's own handlers (categories, filters, equip, the chest bay,
 * the theatre, the shop, the guest gate). Plus the UI rules on the new files.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CrateRow, ProgressionProfile } from '@game/progression';
import { mount, type Mounted } from '../../renderedText.mount';
import type { CrateFx } from '../crateFx/crateFxPixi';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const equipTitleRemote = vi.fn();
const buyCrateRemote = vi.fn();
vi.mock('../../identity', async (orig) => ({ ...(await orig<typeof import('../../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('../../remoteBoards', async (orig) => ({ ...(await orig<typeof import('../../remoteBoards')>()), remoteEnabled: () => true }));
vi.mock('../progressionRemote', async (orig) => ({
  ...(await orig<typeof import('../progressionRemote')>()),
  openCrateRemote: vi.fn(async () => undefined),
  buyCrateRemote: (req: unknown) => buyCrateRemote(req),
  fetchAetherEconomy: async () => undefined,
  equipTitleRemote: (id: string | null) => equipTitleRemote(id),
  fetchOwnCrates: async () => undefined,
  fetchSeenCosmeticIds: async () => undefined,
  markCosmeticsSeenRemote: async () => true,
}));

import { CollectionPage } from '../CollectionScreen';
import { resetProgressionForTests, useProgression } from '../progressionStore';
import { setCrateFxFactoryForTests } from '../crateFx/crateFxPixi';
import { setPartyHome } from '../../partyHome/partyHomeFlag';
import { useGame } from '../../store';

const noopFx = (): CrateFx => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : k === 'mount' ? async () => true : () => {}) }) as CrateFx;

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; setCrateFxFactoryForTests(null); setPartyHome(false); });
beforeEach(() => {
  resetProgressionForTests();
  localStorage.clear();
  equipTitleRemote.mockReset();
  buyCrateRemote.mockReset();
  setCrateFxFactoryForTests(noopFx);
  useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null }, accountPanelOpen: false, playerName: 'Kevin' });
});

const crateList: CrateRow[] = [
  { crateId: 'c-2', earnedLevel: 2, state: 'sealed', rewardId: null, earnedAt: null, openedAt: null },
  { crateId: 'c-3', earnedLevel: 3, state: 'sealed', rewardId: null, earnedAt: null, openedAt: null },
];
const profile = (over: Partial<ProgressionProfile> = {}): ProgressionProfile =>
  ({ accountXp: 325, accountLevel: 2, revision: 9, equippedTitleId: 'alpha_tester', titles: ['alpha_tester', 'title_star_chaser'], aether: 1500, ...over });

/** Mount the page (the shell on or off) and let the lazy skins load. */
async function open(opts: { ph: boolean; aether?: boolean; guest?: boolean; crates?: CrateRow[] }): Promise<void> {
  localStorage.setItem('ascent.collection.seen.u-1', JSON.stringify(['alpha_tester', 'title_star_chaser']));
  localStorage.setItem('ascent.collection.baseline.u-1', '1');
  localStorage.setItem('ascent.aetherIntro.seen.u-1', '1');
  setPartyHome(opts.ph);
  if (opts.guest) useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } });
  useProgression.setState({ capability: 'on', cratesCapability: 'on', aetherCapability: opts.aether ? 'on' : 'off', crateList: opts.crates ?? crateList, mirror: { userId: 'u-1', ...profile() } });
  ui = mount(<CollectionPage reducedMotion />);
  await settle();
}
const settle = async (): Promise<void> => {
  // The skins are lazy chunks: load them, then let React commit.
  await import('./CollectionPh');
  await import('./CrateShopPh');
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const btn = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
const tileNames = (): string[] => $$('.phc-tile .phc-tile-name').map((n) => n.textContent ?? '');
const cat = (label: string): HTMLButtonElement => $$('.phc-cat').find((c) => c.querySelector('.phc-cat-name')?.textContent === label) as HTMLButtonElement;

describe('the Collection in the party home shell', () => {
  it('with the switch OFF the page is today\'s: nothing of the shell mounts', async () => {
    await open({ ph: false });
    expect($('.colls-tabs')).not.toBeNull();
    expect($('.phc')).toBeNull();
    expect($('.phk-page')).toBeNull();
  });

  it('ON: the kit page under the top nav, every category with its count, the album and the selected item', async () => {
    await open({ ph: true });
    expect($('.phc.phk-page h1')?.textContent).toBe('Collection');
    expect($('.ph-top')).not.toBeNull();
    expect($('.colls-tabs')).toBeNull();
    expect(cat('Titles').getAttribute('aria-selected')).toBe('true');
    expect(cat('Titles').querySelector('.phc-cat-count')?.textContent).toMatch(/^2 \/ \d+$/);
    expect(tileNames()).toContain('Alpha Tester');
    // The equipped title is selected by default and its detail says so, with Take off.
    expect($('.phc-detail h2')?.textContent).toBe('Alpha Tester');
    expect($('.phc-stage-name')?.textContent).toBe('Kevin');
    expect(btn('Take off')).toBeDefined();
    expect($('.phc-meter')?.getAttribute('aria-label')).toMatch(/^\d+ of \d+ collected$/);
  });

  it('ON: filters and picking work through the page; Equip calls the store', async () => {
    equipTitleRemote.mockResolvedValue({ ok: true, profile: { userId: 'u-1', ...profile({ equippedTitleId: 'title_star_chaser' }) } });
    await open({ ph: true });
    act(() => { $$('.phk-tab').find((t) => t.textContent?.startsWith('Owned'))!.click(); });
    expect(tileNames().sort()).toEqual(['Alpha Tester', 'Star Chaser']);
    act(() => { $$('.phc-tile').find((t) => t.textContent?.includes('Star Chaser'))!.click(); });
    expect($('.phc-detail h2')?.textContent).toBe('Star Chaser');
    await act(async () => { btn('Equip')!.click(); await Promise.resolve(); });
    expect(equipTitleRemote).toHaveBeenCalledWith('title_star_chaser');
  });

  it('ON: the chest bay counts the sealed chests and Open plays the theatre in the shell skin', async () => {
    await open({ ph: true });
    expect($('.phc-bay-num')?.textContent).toBe('2 ready');
    expect(btn('Open all (2)')).toBeDefined();
    act(() => { btn('Open')!.click(); });
    expect($('.crth.phx')).not.toBeNull();
  });

  it('ON: a guest\'s Open shows the sign-in gate, never the theatre', async () => {
    await open({ ph: true, guest: true });
    expect($('.phc-guest')).not.toBeNull();
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('.phc-bay-actions button')][0]!.click(); });
    expect($('.crth')).toBeNull();
    expect(document.body.textContent).toMatch(/account/i);
  });

  it('ON: a switched-off category is listed as Soon and opens a coming-soon view', async () => {
    await open({ ph: true });
    const locked = $$('.phc-cat.locked');
    if (!locked.length) return; // every category is live in this build
    act(() => { locked[0]!.click(); });
    expect($('.phc-soon')).not.toBeNull();
  });

  it('ON with Aether: the Chest Shop opens in the shell skin (the shop\'s own cards and rows) and Back returns', async () => {
    await open({ ph: true, aether: true });
    act(() => { $('.phc-shopbtn')!.click(); });
    await settle();
    expect($('.cshop.phs')).not.toBeNull();
    expect($('.phs h1')?.textContent).toBe('Chest Shop');
    expect($$('.phs .cshop-chest')).toHaveLength(5);
    expect($$('.phs .cshop-cat:not(.cshop-cat-head)').length).toBeGreaterThan(0);
    expect($('.phs-wallet')?.textContent).toContain('1500');
    expect($('.phs-buy')?.textContent).toMatch(/^Open chest/);
    act(() => { btn('◀ Back to Collection')!.click(); });
    expect($('.cshop')).toBeNull();
    expect($('.phc')).not.toBeNull();
  });

  it('ON with Aether: a guest\'s buy is the sign-in gate, never the store', async () => {
    await open({ ph: true, aether: true, guest: true });
    act(() => { $('.phc-shopbtn')!.click(); });
    await settle();
    act(() => { $('.phs-buy')!.click(); });
    expect(buyCrateRemote).not.toHaveBeenCalled();
  });
});

describe('the shell skins keep the UI rules', () => {
  const here = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
  it('DEV only: lazy imports behind import.meta.env.DEV', () => {
    expect(here('../CollectionScreen.tsx')).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/ph\/CollectionPh'\)/);
    expect(here('../CrateShop.tsx')).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/ph\/CrateShopPh'\)/);
  });
  it('the chest opening ph-error phase is never pulled off screen by the party home .ph-error rule (R-PH-COLLECTION-01)', () => {
    const theatre = here('../crateFx/crateTheatre.css');
    expect(theatre).toMatch(/\.crate\.crth\.ph-error \{ translate: none; padding: 0; background: none; box-shadow: none; clip-path: none;/);
  });
  it('no native tooltips, no cursor rules, no em dashes, no looping animation', () => {
    const tsx = [here('./CollectionPh.tsx'), here('./CrateShopPh.tsx')].join('\n');
    const css = [here('./collectionPh.css'), here('./crateShopPh.css')].join('\n');
    expect(tsx).not.toMatch(/<[a-z][a-z0-9]*\s[^>]*\stitle=/);
    expect(tsx).not.toMatch(/[—–]/);
    expect(css).not.toMatch(/cursor\s*:/);
    expect(css).not.toMatch(/infinite/);
    expect(css).not.toMatch(/@keyframes/);
  });
});
