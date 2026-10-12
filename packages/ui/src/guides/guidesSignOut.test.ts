// @vitest-environment jsdom
/**
 * SIGNING OUT CLEARS THE GUIDES, EVEN WHEN NO AUTH EVENT FOLLOWS. The game store's `signOutAccount` is driven for real
 * here, over the real identity module and the real guides store. Only the guides' network seam is a double.
 *
 * Why it matters: the guides store clears an account's private guides when it is told the identity changed. In the app
 * that telling normally comes from the auth provider's `onChange`. A sign-out whose request fails (the device is
 * offline) fires no `onChange` at all, so `signOutAccount` must tell the guides store itself. In this test there is no
 * Supabase client, so the provider's `onChange` is never even subscribed: no auth event can fire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideRecord } from '@game/guides';
import type { OfficialGuidesAnswer } from './guidesRemote';

let official: OfficialGuidesAnswer = { state: 'on', guides: [] };
let mineRows: GuideRecord[] = [];
let asked = 0;
vi.mock('./guidesRemote', () => ({
  GUIDE_COLUMNS: '',
  fetchOfficialGuides: async () => { asked++; return official; },
  fetchTeamFlag: async () => true,
  fetchMyGuides: async () => mineRows,
  fetchBookmarkedGuides: async () => undefined,
  fetchGuideById: async () => undefined,
  saveGuideRemote: async () => ({ ok: false, code: 'offline' }),
  deleteGuideRemote: async () => ({ ok: false, code: 'offline' }),
  importBuiltInsRemote: async () => ({ ok: false, code: 'offline' }),
}));

const { useGame } = await import('../store');
const { supabaseClient } = await import('../remoteBoards');
const { currentIdentity, setIdentity } = await import('../identity');
const { loadGuides, resetGuidesForTests, useGuides } = await import('./guidesStore');

const mineRow: GuideRecord = {
  id: '66666666-6666-4666-8666-666666666666', slug: null, authorId: 'u-1', byline: 'Mike', official: false, published: false, publishedAt: null, hidden: false, sets: ['set2'],
  tribes: [], pairsWith: [], iconCard: 'grim', title: 'Private build', tagline: '', body: 'Words.', core: ['grim'], enablers: [], mentions: [], aliases: {},
  forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0, revision: 1, createdAt: '', updatedAt: '',
};

const prevAccount = useGame.getState().account;
const prevIdentity = currentIdentity();

beforeEach(() => {
  resetGuidesForTests();
  official = { state: 'on', guides: [] };
  mineRows = [mineRow];
  asked = 0;
});
afterEach(() => {
  setIdentity(prevIdentity);
  useGame.setState({ account: prevAccount });
  resetGuidesForTests();
});

describe('signing out', () => {
  it('clears the account\'s own guides and its team flag when no auth event follows, and with the server out of reach', async () => {
    expect(supabaseClient()).toBeNull(); // no client: the auth provider has nothing to fire `onChange` from
    setIdentity({ userId: 'u-1', displayName: 'Mike', anonymous: false, email: 'm@example.test' });
    useGame.setState({ account: { userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null } });
    await loadGuides();
    expect(useGuides.getState()).toMatchObject({ team: true, mineOwner: 'u-1' });
    expect(useGuides.getState().mine.map((g) => g.title)).toEqual(['Private build']);

    official = { state: 'offline' }; // the sign-out happens offline
    const before = asked;
    await useGame.getState().signOutAccount();

    expect(useGame.getState().account.userId).toBeNull();
    // Cleared by the time `signOutAccount` has returned: nothing waits on a read that cannot answer.
    expect(useGuides.getState()).toMatchObject({ team: false, mine: [], mineOwner: null, pendingEdit: null, tab: 'team' });
    expect(asked).toBe(before + 1); // and the guides store was asked to read again as nobody
  });
});
