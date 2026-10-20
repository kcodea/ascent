// @vitest-environment jsdom
/**
 * INTRODUCING AETHER (owner 2026-10-19, R-PROG-AETHER-05), rendered in the Collection under jsdom:
 *  - the first visit with Aether live opens with the announcement, in the owner's words, naming the server's grant;
 *  - it IS the Ranked confirmation's window (the same `.rankedconfirm*` frame, title, text and Gem button classes), so
 *    it pops in and out exactly like it;
 *  - Continue plays the exit, then it is gone; it never shows again for that account (a reload included);
 *  - it waits for the account's profile, never shows with Aether off, and holds the New Rewards summary until closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AETHER_LAUNCH_GRANT, type CrateRow, type ProgressionProfile } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  fetchAetherEconomy: async () => undefined,
  fetchOwnCrates: async () => undefined,
  fetchSeenCosmeticIds: async () => undefined,
  markCosmeticsSeenRemote: async () => true,
}));

import { CollectionPage } from './CollectionScreen';
import { AETHER_INTRO_GIFT, AETHER_INTRO_OK, AETHER_INTRO_SIGN, AETHER_INTRO_TEXT, AETHER_INTRO_TITLE, resetAetherIntroForTests } from './AetherIntroPopup';
import { RANKED_CONFIRM_EXIT_MS } from '../rank/rankedEntry';
import { resetProgressionForTests, useProgression } from './progressionStore';
import { queueNewCrate, resetNewRewardsForTests } from './newRewards';
import { useGame } from '../store';

const profile = (over: Partial<ProgressionProfile> = {}): ProgressionProfile =>
  ({ accountXp: 0, accountLevel: 12, revision: 1, equippedTitleId: null, titles: [], cosmetics: [], aether: AETHER_LAUNCH_GRANT, ...over });
const milestone: CrateRow = { crateId: 'c-m10', earnedLevel: null, state: 'sealed', rewardId: null, earnedAt: 't0', openedAt: null, source: 'milestone:10', floor: 'legendary' };

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; resetNewRewardsForTests(); });
beforeEach(() => {
  resetProgressionForTests();
  resetAetherIntroForTests();
  resetNewRewardsForTests();
  localStorage.clear();
  localStorage.setItem('ascent.collection.baseline.u-1', '1');
  useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null }, showCollection: false });
});
function open(opts: { aether?: boolean; mirror?: boolean; crates?: CrateRow[] } = {}): void {
  useProgression.setState({
    capability: 'on', cratesCapability: 'on', aetherCapability: opts.aether === false ? 'off' : 'on', crateList: opts.crates ?? [],
    mirror: opts.mirror === false ? null : { userId: 'u-1', ...profile() },
  });
  ui = mount(<CollectionPage reducedMotion />);
}
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const dialog = (): HTMLElement | null => $(`[role="dialog"][aria-label="${AETHER_INTRO_TITLE}"]`);
const pressContinue = async (): Promise<void> => {
  act(() => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === AETHER_INTRO_OK)!.click());
  await act(async () => { await new Promise((r) => setTimeout(r, RANKED_CONFIRM_EXIT_MS + 60)); });
};

describe('Introducing Aether', () => {
  it("is the owner's announcement, naming the server's 1,000", () => {
    expect(AETHER_INTRO_TITLE).toBe('Introducing Aether');
    expect(AETHER_INTRO_TEXT).toBe('Aether is a currency that you earn by playing Ascent. Earn even more by placing higher in ranked matches. Aether is used to unlock chests of various rarities that contain hundreds of different cosmetic items.');
    expect(AETHER_INTRO_GIFT).toBe('Enjoy the first 1,000 Aether on us!');
    expect(AETHER_INTRO_SIGN).toBe('- The Ascent Team');
    open();
    const d = dialog()!;
    expect(d).not.toBeNull();
    expect(text(d.querySelector('.rc-title'))).toBe(AETHER_INTRO_TITLE);
    expect([...d.querySelectorAll('p')].map(text)).toEqual([AETHER_INTRO_TEXT, AETHER_INTRO_GIFT, AETHER_INTRO_SIGN]);
  });

  it("wears the Ranked confirmation's window, so it pops in and out exactly like it", () => {
    open();
    const d = dialog()!;
    expect(d.classList.contains('rankedconfirm-ov')).toBe(true);
    expect(d.querySelector('.rankedconfirm-veil')).not.toBeNull();
    const win = d.querySelector('.rankedconfirm')!;
    expect(win.querySelectorAll('.rc-crest')).toHaveLength(2);
    expect(win.querySelector('.rankedconfirm-actions .rc-btn.rc-btn-yes')!.textContent).toBe(AETHER_INTRO_OK);
    // it lifts over the Collection page (.lbpage z-index 470) and changes none of the window's motion
    const css = readFileSync(join(__dirname, 'collection.css'), 'utf8');
    expect(css).toContain('.rankedconfirm-ov.aetherintro-ov { z-index: 560; }');
    expect(css).not.toMatch(/aetherintro[^{]*\{[^}]*animation/);
  });

  it('Continue plays the exit, then it is gone, and it never shows again for that account', async () => {
    open();
    await pressContinue();
    expect(dialog()).toBeNull();
    ui!.unmount(); ui = null;
    resetAetherIntroForTests(); // a reload: only the device's flag remains
    open();
    expect(dialog()).toBeNull();
    expect(localStorage.getItem('ascent.aetherIntro.seen.u-1')).toBe('1');
  });

  it('waits for the profile, and never shows with Aether off', () => {
    open({ mirror: false });
    expect(dialog()).toBeNull();
    act(() => useProgression.setState({ mirror: { userId: 'u-1', ...profile() } }));
    expect(dialog()).not.toBeNull();
    ui!.unmount(); ui = null;
    resetAetherIntroForTests();
    localStorage.removeItem('ascent.aetherIntro.seen.u-1');
    open({ aether: false });
    expect(dialog()).toBeNull();
  });

  it('holds the New Rewards summary until it is closed', async () => {
    queueNewCrate('u-1', milestone);
    open({ crates: [milestone] });
    expect(dialog()).not.toBeNull();
    expect($('.nrw-panel')).toBeNull();
    await pressContinue();
    expect($('.nrw-panel')).not.toBeNull();
  });
});
