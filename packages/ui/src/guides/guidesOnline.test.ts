// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficialGuidesAnswer } from './guidesRemote';

/** Back online: a game that loaded with no connection re-reads its guides without the Guides tab being reopened. */
let answer: OfficialGuidesAnswer = { state: 'offline' };
let calls = 0;
vi.mock('./guidesRemote', () => ({
  fetchOfficialGuides: async () => { calls++; return answer; },
  fetchTeamFlag: async () => undefined,
  fetchMyGuides: async () => undefined,
  fetchBookmarkedGuides: async () => undefined,
}));
vi.mock('../identity', () => ({ currentIdentity: () => null }));

const { loadGuides, resetGuidesForTests, useGuides } = await import('./guidesStore');
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { resetGuidesForTests(); calls = 0; answer = { state: 'offline' }; });

describe('the online event', () => {
  it('re-reads when the game was offline', async () => {
    await loadGuides();
    expect(useGuides.getState().capability).toBe('offline');
    answer = { state: 'on', guides: [] };
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(calls).toBe(2);
    expect(useGuides.getState().capability).toBe('on');
  });
  it('does nothing when guides are already on', async () => {
    answer = { state: 'on', guides: [] };
    await loadGuides();
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(calls).toBe(1);
  });
});
