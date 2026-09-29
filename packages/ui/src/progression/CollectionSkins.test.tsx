// @vitest-environment jsdom
/**
 * THE COLLECTION'S SKIN TABS (owner 2026-09-28). Heroes and Minions are live:
 *  - tiles show the skin's art and its hero / minion; unowned tiles are dimmed and blurred, locked;
 *  - the detail panel shows the art large, what it is for, Equip, and "Use default art" when worn (Default is
 *    always selectable); Equip goes through the server with the slot + target + id and adopts the answer;
 *    a refusal (not owned, wrong target, retired) leaves the loadout as it was and says so;
 *  - the kill switch: a retired item (the server's switch) is HIDDEN from the album and the counts, owned or not,
 *    and comes back when restored; a disabled category becomes a locked "Soon" tab.
 * No native tooltips, no em dashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ProgressionProfile } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';
import type { CrateFx } from './crateFx/crateFxPixi';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const equipCosmeticRemote = vi.fn();
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  equipCosmeticRemote: (slot: string, target: string, id: string | null) => equipCosmeticRemote(slot, target, id),
  fetchOwnCrates: async () => undefined,
}));

import { CollectionPage } from './CollectionScreen';
import { applyServerCatalogState, resetProgressionForTests, useProgression } from './progressionStore';
import { setCrateFxFactoryForTests } from './crateFx/crateFxPixi';
import { useGame } from '../store';

const noopFx = (): CrateFx => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : k === 'mount' ? async () => true : () => {}) }) as CrateFx;

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; setCrateFxFactoryForTests(null); resetProgressionForTests(); });
beforeEach(() => {
  resetProgressionForTests();
  localStorage.clear();
  equipCosmeticRemote.mockReset();
  setCrateFxFactoryForTests(noopFx);
  useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null }, showCollection: false, playerName: 'Kevin' });
});

const base: ProgressionProfile = {
  accountXp: 325, accountLevel: 2, revision: 9, equippedTitleId: 'alpha_tester', titles: ['alpha_tester'],
  cosmetics: ['alpha_tester', 'skin_blackbelt_1', 'skin_albus_1'],
  loadout: { heroSkinByHeroId: { albus: 'skin_albus_1' } },
};
function open(over: Partial<ProgressionProfile> = {}): void {
  localStorage.setItem('ascent.collection.seen.u-1', JSON.stringify(['alpha_tester', 'skin_blackbelt_1', 'skin_albus_1']));
  useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList: [], mirror: { userId: 'u-1', ...base, ...over } });
  ui = mount(<CollectionPage reducedMotion />);
}
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string): string => ($(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const tab = (label: string): HTMLButtonElement => $$('.colls-tab').find((t) => t.querySelector('.colls-tab-name')?.textContent === label) as HTMLButtonElement;
const tile = (name: string): HTMLButtonElement => $$('.colls-tile').find((t) => t.querySelector('.colls-tile-name')?.textContent === name) as HTMLButtonElement;
const tileNames = (): string[] => $$('.colls-tile .colls-tile-name').map((n) => n.textContent ?? '');
const button = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const clean = (): void => { expect(document.body.textContent).not.toMatch(/[—–]/); expect(document.querySelector('[title]')).toBeNull(); };

describe('the Heroes and Minions tabs', () => {
  it('are live (not locked), with counts; the header total includes the skins', () => {
    open();
    expect(tab('Heroes').className).not.toMatch(/\blocked\b/);
    expect(tab('Heroes').querySelector('.colls-tab-count')?.textContent).toBe('1/2');
    // 2026-09-28: three Black Belt Brian skins and one Bellringer Voss skin, so Minions is 1/4 and the album 22 items (29 with the seven hero attacks, 2026-09-28)
    expect(tab('Minions').querySelector('.colls-tab-count')?.textContent).toBe('1/4');
    expect(text('.colls-meter-num')).toBe('3 / 29');
  });

  it('tiles show the art and the target; unowned are dimmed + blurred (missing) with a lock', () => {
    open();
    act(() => tab('Minions').click());
    expect(tileNames().sort()).toEqual(['Clocktower Voss', 'Glitch Brian', 'Grandmaster Brian', 'Sheriff Brian']);
    const owned = tile('Sheriff Brian');
    expect(owned.className).toMatch(/\bskin\b/);
    expect(owned.className).toMatch(/\bowned\b/);
    expect(owned.querySelector('img.colls-tile-art')?.getAttribute('src')).toContain('skin_blackbelt_1');
    expect(owned.querySelector('.colls-tile-for')?.textContent).toBe('Black Belt Brian');
    const missing = tile('Glitch Brian');
    expect(missing.className).toMatch(/\bmissing\b/);
    expect(missing.querySelector('.colls-tile-lock')).not.toBeNull();
    expect(missing.getAttribute('aria-label')).toBe('Glitch Brian, for Black Belt Brian, Epic, not owned');
    clean();
  });

  it('the worn hero skin is ribboned and selected; the detail panel shows it large with "Use default art"', () => {
    open();
    act(() => tab('Heroes').click());
    expect(tile('Surf Day Albus').className).toMatch(/\bworn\b/);
    expect(text('.colls-detail .colls-kicker')).toBe('Hero skin');
    expect($('.colls-skinart.hero img')?.getAttribute('src')).toContain('skin_albus_1');
    expect(text('.colls-detail')).toContain('Albus');
    expect(button('Use default art')).toBeTruthy();
    clean();
  });
});

describe('equipping a skin', () => {
  it('Equip sends slot + target + id; the returned profile moves the ribbon', async () => {
    open();
    act(() => tab('Minions').click());
    act(() => tile('Sheriff Brian').click());
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, revision: 10, loadout: { ...base.loadout, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('minion_skin', 'blackbelt', 'skin_blackbelt_1');
    expect(tile('Sheriff Brian').className).toMatch(/\bworn\b/);
    expect(useProgression.getState().mirror!.loadout).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } });
  });

  it('Use default art sends null (Default); a refusal keeps the skin on and says so', async () => {
    open();
    act(() => tab('Heroes').click());
    equipCosmeticRemote.mockResolvedValue({ status: 'error', reason: 'not_owned' });
    await act(async () => { button('Use default art')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_skin', 'albus', null);
    expect(tile('Surf Day Albus').className).toMatch(/\bworn\b/);
    expect(text('.coll-error')).toBe('Could not change your skin. Try again.');
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, revision: 11, loadout: {} } });
    await act(async () => { button('Use default art')!.click(); });
    await settle();
    expect(tile('Surf Day Albus').className).not.toMatch(/\bworn\b/);
  });

  it('an unowned skin has no Equip, only how to find it', () => {
    open();
    act(() => tab('Heroes').click());
    act(() => tile('Bath Day Warden').click());
    expect(button('Equip')).toBeUndefined();
    expect(text('.colls-hint')).toBe('Open crates to find it.');
  });
});

describe('the kill switch in the Collection (retired = hidden, owned or not; restored = back)', () => {
  it('a retired OWNED skin leaves the album and the counts; restoring brings it back owned', () => {
    open();
    act(() => tab('Minions').click());
    expect(tileNames()).toContain('Sheriff Brian');
    act(() => applyServerCatalogState({ retiredIds: ['skin_blackbelt_1'], disabledCategories: [] }));
    expect(tileNames()).toEqual(['Grandmaster Brian', 'Glitch Brian', 'Clocktower Voss']); // rarest first, then catalog order
    expect(tab('Minions').querySelector('.colls-tab-count')?.textContent).toBe('0/3');
    expect(text('.colls-meter-num')).toBe('2 / 28');
    act(() => applyServerCatalogState({ retiredIds: [], disabledCategories: [] }));
    expect(tile('Sheriff Brian').className).toMatch(/\bowned\b/);
    expect(text('.colls-meter-num')).toBe('3 / 29');
  });

  it('a disabled CATEGORY becomes a locked Soon tab', () => {
    open();
    act(() => applyServerCatalogState({ retiredIds: [], disabledCategories: ['hero_skin'] }));
    expect(tab('Heroes').className).toMatch(/\blocked\b/);
    expect(tab('Heroes').textContent).toContain('Soon');
    expect(text('.colls-meter-num')).toBe('2 / 27');
  });
});
