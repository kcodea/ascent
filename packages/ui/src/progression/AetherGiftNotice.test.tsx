// @vitest-environment jsdom
/**
 * AETHER GIFTS (owner 2026-11-20: "i would like upon them logging in, to recieve a prompt. it should say, you've been
 * gifted XXX Aether from the Ascent team for: ...", R-PROG-GIFT-02). The probe reads the account's unseen Aether gifts;
 * the menus show one pop-up per gift, oldest first, naming the amount and the reason; closing it marks THAT gift seen
 * on the account. Nothing shows for no answer, another account's gifts, or while the cosmetic gift notice is open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import type { AetherGift } from './progressionRemote';

const fetchUnseenAetherGifts = vi.fn<(userId: string) => Promise<AetherGift[] | undefined>>();
const ackAetherGiftRemote = vi.fn<(giftId: string) => Promise<boolean>>();
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  fetchUnseenAetherGifts: (userId: string) => fetchUnseenAetherGifts(userId),
  ackAetherGiftRemote: (giftId: string) => ackAetherGiftRemote(giftId),
}));

import { AetherGiftNotice, aetherGiftText } from './AetherGiftNotice';
import { refreshAetherGifts, resetProgressionForTests, useProgression } from './progressionStore';
import { RANKED_CONFIRM_EXIT_MS } from '../rank/rankedEntry';
import { useGame } from '../store';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; resetProgressionForTests(); vi.useRealTimers(); });
beforeEach(() => {
  resetProgressionForTests();
  fetchUnseenAetherGifts.mockReset();
  ackAetherGiftRemote.mockReset();
  ackAetherGiftRemote.mockResolvedValue(true);
  useGame.setState({ account: { userId: 'u-1', email: 'a@example.com', anonymous: false, discriminator: null } });
});

const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const texts = (sel: string): string[] => [...document.querySelectorAll(sel)].map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim());
const ok = (): HTMLButtonElement => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Continue')!;
const FIRST: AetherGift = { id: 'g-1', amount: 1000, reason: 'being one of our first players' };
const SECOND: AetherGift = { id: 'g-2', amount: 250, reason: 'finding the shop bug' };

describe('the Aether gift pop-up', () => {
  it('names the amount and the reason, in the owner\'s words', async () => {
    fetchUnseenAetherGifts.mockResolvedValue([FIRST]);
    await refreshAetherGifts('u-1');
    ui = mount(<AetherGiftNotice />);
    expect(texts('.rc-title')).toEqual(['A Gift of Aether']);
    expect(texts('.rankedconfirm-text')).toEqual(["You've been gifted 1,000 Aether from the Ascent team for:", 'being one of our first players']);
    expect(document.querySelector('[title]')).toBeNull();
    expect(aetherGiftText(25)).toBe("You've been gifted 25 Aether from the Ascent team for:");
  });

  it('Continue marks that gift seen, then the next gift pops up; the last one leaves nothing', async () => {
    vi.useFakeTimers();
    fetchUnseenAetherGifts.mockResolvedValue([FIRST, SECOND]);
    await refreshAetherGifts('u-1');
    ui = mount(<AetherGiftNotice />);
    act(() => ok().click());
    act(() => { vi.advanceTimersByTime(RANKED_CONFIRM_EXIT_MS); });
    expect(ackAetherGiftRemote).toHaveBeenCalledWith('g-1');
    expect(texts('.rankedconfirm-text')[0]).toBe("You've been gifted 250 Aether from the Ascent team for:");
    expect(texts('.rankedconfirm-text')[1]).toBe('finding the shop bug');
    act(() => ok().click());
    act(() => { vi.advanceTimersByTime(RANKED_CONFIRM_EXIT_MS); });
    expect(ackAetherGiftRemote).toHaveBeenCalledWith('g-2');
    expect(ackAetherGiftRemote).toHaveBeenCalledTimes(2);
    expect($('.rankedconfirm')).toBeNull();
    expect(useProgression.getState().aetherGifts).toBeNull();
  });

  it('Escape closes it the same way', async () => {
    vi.useFakeTimers();
    fetchUnseenAetherGifts.mockResolvedValue([FIRST]);
    await refreshAetherGifts('u-1');
    ui = mount(<AetherGiftNotice />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    act(() => { vi.advanceTimersByTime(RANKED_CONFIRM_EXIT_MS); });
    expect(ackAetherGiftRemote).toHaveBeenCalledWith('g-1');
    expect($('.rankedconfirm')).toBeNull();
  });

  it('shows nothing with no answer, no gifts, another account\'s gifts, or while the cosmetic gift notice is open', async () => {
    fetchUnseenAetherGifts.mockResolvedValue(undefined);
    await refreshAetherGifts('u-1');
    ui = mount(<AetherGiftNotice />);
    expect($('.rankedconfirm')).toBeNull();
    ui.unmount();

    fetchUnseenAetherGifts.mockResolvedValue([]);
    await refreshAetherGifts('u-1');
    ui = mount(<AetherGiftNotice />);
    expect($('.rankedconfirm')).toBeNull();
    ui.unmount();

    act(() => useProgression.setState({ aetherGifts: { userId: 'u-2', gifts: [FIRST] } }));
    ui = mount(<AetherGiftNotice />);
    expect($('.rankedconfirm')).toBeNull();
    ui.unmount();

    act(() => useProgression.setState({ aetherGifts: { userId: 'u-1', gifts: [FIRST] }, gifts: { userId: 'u-1', ids: ['skin_kobabyboldies_3'] } }));
    ui = mount(<AetherGiftNotice />);
    expect($('.rankedconfirm')).toBeNull();
    act(() => useProgression.setState({ gifts: null }));
    expect(texts('.rankedconfirm-text')[1]).toBe('being one of our first players');
    expect(ackAetherGiftRemote).not.toHaveBeenCalled();
  });
});
