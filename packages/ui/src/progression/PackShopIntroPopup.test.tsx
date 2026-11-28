// @vitest-environment jsdom
/**
 * INTRODUCING THE PACK SHOP (the pack economy, 2026-12-01): the one-time announcement on the menus.
 *  - it shows only with packs on (the server switch), once the account's profile is loaded;
 *  - a launch-day account (its ledger holds the `pack_launch` grant) reads the 3,000 Aether gift line; an account made
 *    after the launch sees the announcement without it; until the ledger read answers, nothing shows;
 *  - Continue plays the exit, and it never shows again for that account;
 *  - it waits while a gift notice is up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ProgressionProfile } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';

const giftRead = vi.fn<(userId: string) => Promise<boolean | undefined>>();
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  fetchPackLaunchGiftReceived: (id: string) => giftRead(id),
}));

import { PACK_INTRO_GIFT, PACK_INTRO_OK, PACK_INTRO_TITLE, PackShopIntro, packShopIntroSeen, resetPackShopIntroForTests } from './PackShopIntroPopup';
import { RANKED_CONFIRM_EXIT_MS } from '../rank/rankedEntry';
import { resetProgressionForTests, useProgression } from './progressionStore';
import { useGame } from '../store';

const profile = (): ProgressionProfile => ({ accountXp: 0, accountLevel: 12, revision: 1, equippedTitleId: null, titles: [], cosmetics: [], aether: 3000 });
let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
beforeEach(() => {
  resetProgressionForTests();
  resetPackShopIntroForTests();
  localStorage.clear();
  giftRead.mockReset().mockResolvedValue(true);
  useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null } });
});
const settle = async (): Promise<void> => { await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); }); };
async function show(opts: { packs?: boolean; mirror?: boolean } = {}): Promise<void> {
  useProgression.setState({
    capability: 'on', packsCapability: opts.packs === false ? 'off' : 'on',
    mirror: opts.mirror === false ? null : { userId: 'u-1', ...profile() },
  });
  ui = mount(<PackShopIntro />);
  await settle();
}
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>(`[role="dialog"][aria-label="${PACK_INTRO_TITLE}"]`);
const text = (): string => (dialog()?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Introducing the Pack Shop', () => {
  it('a launch-day account reads it once, naming 3,000 Aether; Continue closes it and it never comes back', async () => {
    await show();
    expect(dialog()).not.toBeNull();
    expect(PACK_INTRO_GIFT).toContain('3,000 Aether');
    expect(text()).toContain(PACK_INTRO_GIFT);
    expect(giftRead).toHaveBeenCalledWith('u-1');
    expect(packShopIntroSeen('u-1')).toBe(true);
    act(() => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === PACK_INTRO_OK)!.click());
    await act(async () => { await new Promise((r) => setTimeout(r, RANKED_CONFIRM_EXIT_MS + 60)); });
    expect(dialog()).toBeNull();
    ui!.unmount();
    resetPackShopIntroForTests(); // a reload: only the stored flag remembers
    await show();
    expect(dialog()).toBeNull();
    expect(document.querySelector('[title]')).toBeNull();
  });

  it('an account made after the launch sees the announcement without the gift line', async () => {
    giftRead.mockResolvedValue(false);
    await show();
    expect(dialog()).not.toBeNull();
    expect(text()).not.toContain('Aether. Enjoy');
  });

  it('never with packs off, never before the profile, and not until the ledger read answers', async () => {
    await show({ packs: false });
    expect(dialog()).toBeNull();
    expect(giftRead).not.toHaveBeenCalled();
    ui!.unmount();
    await show({ mirror: false });
    expect(dialog()).toBeNull();
    ui!.unmount();
    giftRead.mockResolvedValue(undefined);
    await show();
    expect(dialog()).toBeNull();
    expect(packShopIntroSeen('u-1')).toBe(false);
  });

  it('waits while a gift notice is up', async () => {
    useProgression.setState({ aetherGifts: { userId: 'u-1', gifts: [{ id: 'g1', amount: 50, reason: 'thanks' }] } } as never);
    await show();
    expect(dialog()).toBeNull();
    act(() => { useProgression.setState({ aetherGifts: null } as never); });
    await settle();
    expect(dialog()).not.toBeNull();
  });
});
