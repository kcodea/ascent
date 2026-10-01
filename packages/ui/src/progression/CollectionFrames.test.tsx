// @vitest-environment jsdom
/**
 * THE COLLECTION'S PORTRAIT FRAMES TAB (owner 2026-10-01: "we're adding portrait skins ... we want this to replace the
 * default portrait png when a skin is applied"). The tab is live with its count; every frame has a tile showing its
 * ring (blurred + locked until owned); an OWNED frame previews around your hero portrait, an unowned one never does
 * ("do not allow preview if you do not own the art"); Equip sends slot `portrait_frame`, target ''; "Use default frame"
 * sends null and previews the default ring at once; the kill switch hides it. No native tooltips, no em dashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { COSMETICS, type ProgressionProfile } from '@game/progression';
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
import { applyServerCatalogState, devGrantPortraitFrame, equipCosmetic, resetProgressionForTests, useProgression } from './progressionStore';
import { setCrateFxFactoryForTests } from './crateFx/crateFxPixi';
import { useGame } from '../store';

const noopFx = (): CrateFx => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : k === 'mount' ? async () => true : () => {}) }) as CrateFx;
const FRAMES = COSMETICS.filter((c) => c.category === 'portrait_frame');

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; setCrateFxFactoryForTests(null); applyServerCatalogState(null, false); resetProgressionForTests(); });
beforeEach(() => {
  resetProgressionForTests();
  localStorage.clear();
  equipCosmeticRemote.mockReset();
  setCrateFxFactoryForTests(noopFx);
  useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null }, showCollection: false, playerName: 'Kevin' });
});

const base: ProgressionProfile = {
  accountXp: 325, accountLevel: 2, revision: 9, equippedTitleId: 'alpha_tester', titles: ['alpha_tester'],
  cosmetics: ['alpha_tester', 'frame_fire', 'frame_gold'], loadout: {},
};
function open(over: Partial<ProgressionProfile> = {}): void {
  localStorage.setItem('ascent.collection.seen.u-1', JSON.stringify(['alpha_tester', 'frame_fire', 'frame_gold']));
  useProgression.setState({ capability: 'on', cratesCapability: 'on', crateList: [], mirror: { userId: 'u-1', ...base, ...over } });
  ui = mount(<CollectionPage reducedMotion />);
}
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const $$ = (sel: string): HTMLElement[] => [...document.querySelectorAll<HTMLElement>(sel)];
const text = (sel: string): string => ($(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const tab = (label: string): HTMLButtonElement | undefined => $$('.colls-tab').find((t) => t.querySelector('.colls-tab-name')?.textContent === label) as HTMLButtonElement | undefined;
const tile = (name: string): HTMLButtonElement => $$('.colls-tile').find((t) => t.querySelector('.colls-tile-name')?.textContent === name) as HTMLButtonElement;
const button = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const clean = (): void => { expect(document.body.textContent).not.toMatch(/[—–]/); expect(document.querySelector('[title]')).toBeNull(); };

describe('the Portrait Frames tab', () => {
  it('is live with its count, and every frame has a ring tile, rarest first; unowned ones are locked', () => {
    open();
    act(() => tab('Portrait Frames')!.click());
    expect(tab('Portrait Frames')!.className).not.toMatch(/\blocked\b/);
    expect(tab('Portrait Frames')!.querySelector('.colls-tab-count')?.textContent).toBe(`2/${FRAMES.length}`);
    const tiles = $$('.colls-grid .colls-tile');
    expect(tiles).toHaveLength(26);
    expect(tiles.every((t) => t.className.includes('ring') && !!t.querySelector('img.colls-tile-art'))).toBe(true);
    // rarest first: the five Legendary frames lead
    expect(tiles.slice(0, 5).map((t) => t.querySelector('.colls-tile-name')?.textContent)).toEqual(['Fire Frame', 'Reaper Frame', 'Water Frame', 'Stained Glass Frame', 'Wind Frame']);
    expect(tile('Reaper Frame').className).toMatch(/\bmissing\b/);
    expect(tile('Reaper Frame').querySelector('.colls-tile-lock')).not.toBeNull();
    expect(tile('Fire Frame').className).toMatch(/\bowned\b/);
    clean();
  });

  it('an OWNED frame previews around your hero portrait; an unowned one only as the blurred ring, never around a portrait', () => {
    open();
    act(() => tab('Portrait Frames')!.click());
    act(() => tile('Fire Frame').click());
    expect(text('.colls-detail .colls-kicker')).toBe('Portrait frame');
    const ring = $('.colls-detail .colls-heroring');
    expect(ring).not.toBeNull();
    expect(ring!.className).toMatch(/\bpf-on\b/);
    expect(ring!.querySelector('.pframe-box')?.getAttribute('data-frame')).toBe('frame_fire');
    act(() => tile('Reaper Frame').click());
    expect($('.colls-detail')!.className).toMatch(/\bmissing\b/);
    expect($('.colls-detail .colls-heroring')).toBeNull();
    expect($('.colls-detail .pframe')).toBeNull();
    expect($('.colls-detail .colls-framelocked img')).not.toBeNull();
    expect(button('Equip')).toBeUndefined();
    clean();
  });

  it('Equip sends portrait_frame with target \'\'; "Use default frame" sends null and previews the default ring at once', async () => {
    open();
    act(() => tab('Portrait Frames')!.click());
    act(() => tile('Fire Frame').click());
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, revision: 10, loadout: { portraitFrame: 'frame_fire' } } });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenCalledWith('portrait_frame', '', 'frame_fire');
    expect(tile('Fire Frame').className).toMatch(/\bworn\b/);
    expect(tile('Gilded Frame').className).not.toMatch(/\bworn\b/);
    equipCosmeticRemote.mockResolvedValue({ status: 'ok', value: null, profile: { ...base, revision: 11, loadout: {} } });
    await act(async () => { button('Use default frame')!.click(); });
    await settle();
    expect(equipCosmeticRemote).toHaveBeenLastCalledWith('portrait_frame', '', null);
    expect(tile('Fire Frame').className).not.toMatch(/\bworn\b/);
    expect(text('.colls-detail .colls-default-tag')).toBe('Default frame');
    expect($('.colls-detail .pframe-box')?.getAttribute('data-frame') ?? null).not.toBe('frame_fire');
    clean();
  });

  it('a failed equip (the SQL not run yet) shows an error and changes nothing', async () => {
    open();
    act(() => tab('Portrait Frames')!.click());
    act(() => tile('Fire Frame').click());
    equipCosmeticRemote.mockResolvedValue({ status: 'error', reason: 'bad_slot' });
    await act(async () => { button('Equip')!.click(); });
    await settle();
    expect(text('.coll-error')).toBe('Could not change your portrait frame. Try again.');
    expect(tile('Fire Frame').className).not.toMatch(/\bworn\b/);
  });

  it('the kill switch: a retired frame leaves the album; the category switched off locks the tab', () => {
    applyServerCatalogState({ retiredIds: ['frame_fire'], disabledCategories: [] }, false);
    open();
    act(() => tab('Portrait Frames')!.click());
    expect($$('.colls-grid .colls-tile')).toHaveLength(FRAMES.length - 1);
    ui?.unmount(); ui = null;
    applyServerCatalogState({ retiredIds: [], disabledCategories: ['portrait_frame'] }, false);
    open();
    expect(tab('Portrait Frames')!.className).toMatch(/\blocked\b/);
  });
});

describe('the DEV local frame grant (owner 2026-10-01: "put a test frame in the collections, and set it to the gold one")', () => {
  it('grants Gilded on this client; Equip and Use default frame work locally and never call the server; clear undoes it', async () => {
    useProgression.setState({ mirror: { userId: 'u-1', ...base, cosmetics: ['alpha_tester'] } });
    devGrantPortraitFrame('frame_gold');
    expect(useProgression.getState().mirror?.cosmetics).toContain('frame_gold');
    expect(await equipCosmetic('portrait_frame', '', 'frame_gold')).toBe(true);
    expect(useProgression.getState().mirror?.loadout?.portraitFrame).toBe('frame_gold');
    // a fresh server read (no frame on it) keeps the local grant laid over it
    useProgression.setState({ mirror: { userId: 'u-1', ...base, cosmetics: ['alpha_tester'], revision: 12 } });
    expect(useProgression.getState().mirror?.loadout?.portraitFrame).toBe('frame_gold');
    expect(await equipCosmetic('portrait_frame', '', null)).toBe(true);
    expect(useProgression.getState().mirror?.loadout?.portraitFrame).toBeUndefined();
    expect(equipCosmeticRemote).not.toHaveBeenCalled();
    devGrantPortraitFrame('clear');
    expect(localStorage.getItem('ascent.dev.portraitFrames')).toBeNull();
  });
});
