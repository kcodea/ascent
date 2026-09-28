// @vitest-environment jsdom
/**
 * THE COLLECTION'S ATTACK ANIMATIONS TAB (owner 2026-09-28: "the new blast attack is going to be a cosmetic unlock,
 * not a new default"). The tab is live; Arcane Barrage (`attack_blast`) has a tile, a detail panel with a sandbox
 * preview, Equip (slot `hero_attack`, target '') and "Use Classic" (null) when worn; the kill switch hides it and
 * locks the tab. No native tooltips, no em dashes.
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
  cosmetics: ['alpha_tester', 'attack_blast'], loadout: {},
};
function open(over: Partial<ProgressionProfile> = {}): void {
  localStorage.setItem('ascent.collection.seen.u-1', JSON.stringify(['alpha_tester', 'attack_blast']));
  useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList: [], mirror: { userId: 'u-1', ...base, ...over } });
  ui = mount(<CollectionPage reducedMotion />);
}
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string): string => ($(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const tab = (label: string): HTMLButtonElement => $$('.colls-tab').find((t) => t.querySelector('.colls-tab-name')?.textContent === label) as HTMLButtonElement;
const tile = (name: string): HTMLButtonElement => $$('.colls-tile').find((t) => t.querySelector('.colls-tile-name')?.textContent === name) as HTMLButtonElement;
const button = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const clean = (): void => { expect(document.body.textContent).not.toMatch(/[—–]/); expect(document.querySelector('[title]')).toBeNull(); };

describe('the Attack Animations tab', () => {
  it('is live with its count; Arcane Barrage has a tile and a detail panel with an in-place preview', () => {
    open();
    const t = tab('Attack Animations');
    expect(t.className).not.toMatch(/\blocked\b/);
    expect(t.querySelector('.colls-tab-count')?.textContent).toBe('1/1');
    act(() => t.click());
    expect(tile('Arcane Barrage').getAttribute('aria-label')).toBe('Arcane Barrage, Legendary, owned');
    expect(text('.colls-detail .colls-kicker')).toBe('Hero attack');
    expect($('.colls-detail .hapv-box')).not.toBeNull();
    expect(button('▶ Preview')).toBeTruthy();
    expect(button('Equip')).toBeTruthy();
    clean();
  });

  it('Equip sends the hero_attack slot with the global target; "Use Classic" sends null', async () => {
    open();
    act(() => tab('Attack Animations').click());
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, revision: 10, loadout: { heroAttack: 'attack_blast' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('hero_attack', '', 'attack_blast');
    expect(tile('Arcane Barrage').className).toMatch(/\bworn\b/);
    expect(useProgression.getState().mirror!.loadout).toEqual({ heroAttack: 'attack_blast' });
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, revision: 11, loadout: {} } });
    await act(async () => { button('Use Classic')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenLastCalledWith('hero_attack', '', null);
    expect(tile('Arcane Barrage').className).not.toMatch(/\bworn\b/);
  });

  it('a refusal keeps it as it was and says so', async () => {
    open({ loadout: { heroAttack: 'attack_blast' } });
    act(() => tab('Attack Animations').click());
    equipCosmeticRemote.mockResolvedValue({ status: 'error', reason: 'not_equippable' });
    await act(async () => { button('Use Classic')!.click(); });
    await settle();
    expect(tile('Arcane Barrage').className).toMatch(/\bworn\b/);
    expect(text('.coll-error')).toBe('Could not change your hero attack. Try again.');
  });

  it('unowned: no Equip, the preview still plays; the kill switch locks the tab', () => {
    open({ cosmetics: ['alpha_tester'] });
    act(() => tab('Attack Animations').click());
    expect(button('Equip')).toBeUndefined();
    expect(button('▶ Preview')).toBeTruthy();
    act(() => applyServerCatalogState({ retiredIds: [], disabledCategories: ['hero_attack'] }));
    expect(tab('Attack Animations').className).toMatch(/\blocked\b/);
    clean();
  });
});
