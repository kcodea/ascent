// @vitest-environment jsdom
/**
 * GIFTS (owner 2026-11-13: "give Ionlime the cosmetic. have an alert next time he loads up the game", R-PROG-GIFT-01).
 * The probe reads the account's unseen gifts; the notice names each one once; closing it marks them seen on the
 * account, so it never comes back. Nothing shows for another account's gifts, an unknown id, or no answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';

const fetchUnseenGiftIds = vi.fn<(userId: string) => Promise<string[] | undefined>>();
const markCosmeticsSeenRemote = vi.fn<(ids: readonly string[]) => Promise<boolean>>();
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  fetchUnseenGiftIds: (userId: string) => fetchUnseenGiftIds(userId),
  fetchSeenCosmeticIds: async () => [] as string[],
  markCosmeticsSeenRemote: (ids: readonly string[]) => markCosmeticsSeenRemote(ids),
}));

import { GiftNotice } from './GiftNotice';
import { dismissGifts, refreshGifts, refreshSeenList, resetProgressionForTests, useProgression } from './progressionStore';
import { useGame } from '../store';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; resetProgressionForTests(); });
beforeEach(() => {
  resetProgressionForTests();
  localStorage.clear();
  fetchUnseenGiftIds.mockReset();
  markCosmeticsSeenRemote.mockReset();
  markCosmeticsSeenRemote.mockResolvedValue(true);
  useGame.setState({ account: { userId: 'u-1', email: 'ion@example.com', anonymous: false, discriminator: null }, showCollection: false, playerName: 'IonLime' });
});

const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const text = (sel: string): string => ($(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const button = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label);

describe('the gift notice', () => {
  it('reads the unseen gifts and names the item, its rarity and its minion', async () => {
    fetchUnseenGiftIds.mockResolvedValue(['skin_kobabyboldies_3']);
    await refreshGifts('u-1');
    expect(useProgression.getState().gifts).toEqual({ userId: 'u-1', ids: ['skin_kobabyboldies_3'] });
    ui = mount(<GiftNotice />);
    expect(text('#gift-title')).toBe('A gift for you');
    expect(text('.gift-name')).toBe('Dad Kobebe');
    expect($('.gift-name')!.className).toContain('r-ancient');
    expect(text('.gift-text .nrw-note')).toBe('An Ancient skin for Kobebes.');
    expect(text('.gift-note')).toBe('It is in your Collection now.');
    expect($('.gift-art')!.getAttribute('decoding')).toBe('sync');
    expect(document.querySelector('[title]')).toBeNull();
  });

  it('Got it closes it and marks the gift seen on the account, once', async () => {
    await refreshSeenList('u-1', null); // the server holds the seen list
    fetchUnseenGiftIds.mockResolvedValue(['skin_kobabyboldies_3']);
    await refreshGifts('u-1');
    ui = mount(<GiftNotice />);
    act(() => button('Got it')!.click());
    expect($('.gift-scrim')).toBeNull();
    expect(useProgression.getState().gifts).toBeNull();
    expect(markCosmeticsSeenRemote).toHaveBeenCalledTimes(1);
    expect(markCosmeticsSeenRemote).toHaveBeenCalledWith(['skin_kobabyboldies_3']);
    act(() => dismissGifts());
    expect(markCosmeticsSeenRemote).toHaveBeenCalledTimes(1);
  });

  it('View in Collection closes it, marks it seen and opens the Collection', async () => {
    await refreshSeenList('u-1', null);
    fetchUnseenGiftIds.mockResolvedValue(['skin_kobabyboldies_3']);
    await refreshGifts('u-1');
    ui = mount(<GiftNotice />);
    act(() => button('View in Collection')!.click());
    expect($('.gift-scrim')).toBeNull();
    expect(useGame.getState().showCollection).toBe(true);
    expect(markCosmeticsSeenRemote).toHaveBeenCalledWith(['skin_kobabyboldies_3']);
  });

  it('shows nothing with no answer, no gifts, an unknown id or another account\'s gifts', async () => {
    ui = mount(<GiftNotice />);
    fetchUnseenGiftIds.mockResolvedValue(undefined);
    await act(async () => { await refreshGifts('u-1'); });
    expect($('.gift-scrim')).toBeNull();
    fetchUnseenGiftIds.mockResolvedValue([]);
    await act(async () => { await refreshGifts('u-1'); });
    expect($('.gift-scrim')).toBeNull();
    act(() => useProgression.setState({ gifts: { userId: 'u-1', ids: ['no_such_item'] } }));
    expect($('.gift-scrim')).toBeNull();
    act(() => useProgression.setState({ gifts: { userId: 'u-2', ids: ['skin_kobabyboldies_3'] } }));
    expect($('.gift-scrim')).toBeNull();
  });
});
