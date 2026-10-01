// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COSMETICS, type ProgressionProfile } from '@game/progression';

/**
 * DEV "Unlock everything" (owner 2026-10-01): ON owns every catalog item on this client and keeps equips local; OFF
 * puts the real account (ownership + loadout) back exactly; nothing reaches the server while ON; a production build
 * ignores it entirely.
 */
let userId: string | null = 'u-1';
const equipCosmeticRemote = vi.fn(async () => ({ status: 'ok' as const, value: null, profile: profile({ revision: 9 }) }));
const equipTitleRemote = vi.fn(async () => ({ status: 'ok' as const, value: null, profile: profile({ revision: 9 }) }));
const openCrateRemote = vi.fn(async () => ({ status: 'error' as const, reason: 'nope' }));

vi.mock('../identity', () => ({ currentUserId: () => userId }));
vi.mock('../remoteBoards', () => ({ remoteEnabled: () => true }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  equipCosmeticRemote: (...a: unknown[]) => equipCosmeticRemote(...(a as [])),
  equipTitleRemote: (...a: unknown[]) => equipTitleRemote(...(a as [])),
  openCrateRemote: (...a: unknown[]) => openCrateRemote(...(a as [])),
}));
vi.mock('./progressionQueue', () => ({
  enqueuePendingProgression: () => null,
  flushPendingProgressions: async () => {},
  installProgressionRetryTriggers: () => {},
}));

const S = await import('./progressionStore');

function profile(over: Partial<ProgressionProfile> = {}): ProgressionProfile {
  return {
    accountXp: 300, accountLevel: 2, revision: 4, equippedTitleId: 'alpha_tester', titles: ['alpha_tester'],
    cosmetics: ['alpha_tester'], loadout: { heroAttack: 'real_attack' }, ...over,
  };
}
const mirror = () => S.useProgression.getState().mirror;
const notOwnedSkin = COSMETICS.find((c) => c.category === 'hero_skin')!;
const notOwnedTitle = COSMETICS.find((c) => c.category === 'title' && c.id !== 'alpha_tester')!;

beforeEach(() => {
  S.resetDevUnlockAllForTests();
  S.resetProgressionForTests();
  userId = 'u-1';
  equipCosmeticRemote.mockClear(); equipTitleRemote.mockClear(); openCrateRemote.mockClear();
  S.adoptProgressionProfile('u-1', profile());
});
afterEach(() => {
  vi.unstubAllEnvs();
  S.resetDevUnlockAllForTests();
});

describe('Unlock everything (dev)', () => {
  it('ON: every catalog item counts as owned, and what you wore is still worn', () => {
    S.setDevUnlockAll(true);
    expect(S.devUnlockAllOn()).toBe(true);
    const m = mirror()!;
    expect(new Set(m.cosmetics)).toEqual(new Set(COSMETICS.map((c) => c.id)));
    expect(m.titles).toEqual(expect.arrayContaining(COSMETICS.filter((c) => c.category === 'title').map((c) => c.id)));
    expect(m).toMatchObject({ userId: 'u-1', revision: 4, accountXp: 300, equippedTitleId: 'alpha_tester', loadout: { heroAttack: 'real_attack' } });
    // the saved (real) mirror is never overwritten by the overlay
    expect(JSON.parse(localStorage.getItem('ascent.progression')!)).toMatchObject({ cosmetics: ['alpha_tester'] });
  });

  it('ON: equips are local, and nothing is sent to the server (equip, title, crate)', async () => {
    S.setDevUnlockAll(true);
    expect(await S.equipCosmetic('hero_skin', notOwnedSkin.target!.id, notOwnedSkin.id)).toBe(true);
    expect(await S.equipCosmetic('hero_attack', '', null)).toBe(true);
    expect(await S.equipTitle(notOwnedTitle.id)).toBe(true);
    expect(await S.openCrate('c-1')).toEqual({ status: 'error', reason: 'dev_unlock_all' });
    expect(equipCosmeticRemote).not.toHaveBeenCalled();
    expect(equipTitleRemote).not.toHaveBeenCalled();
    expect(openCrateRemote).not.toHaveBeenCalled();
    expect(mirror()).toMatchObject({ equippedTitleId: notOwnedTitle.id, loadout: { heroSkinByHeroId: { [notOwnedSkin.target!.id]: notOwnedSkin.id } } });
    expect(mirror()!.loadout).not.toHaveProperty('heroAttack');
  });

  it('OFF: the real account and loadout come back exactly, local equips dropped', async () => {
    const before = mirror();
    S.setDevUnlockAll(true);
    await S.equipCosmetic('hero_skin', notOwnedSkin.target!.id, notOwnedSkin.id);
    await S.equipTitle(notOwnedTitle.id);
    S.setDevUnlockAll(false);
    expect(S.devUnlockAllOn()).toBe(false);
    expect(mirror()).toBe(before);
    expect(mirror()).toMatchObject({ cosmetics: ['alpha_tester'], equippedTitleId: 'alpha_tester', loadout: { heroAttack: 'real_attack' } });
    // and the server path is back
    await S.equipTitle(null);
    expect(equipTitleRemote).toHaveBeenCalledTimes(1);
  });

  it('a real server answer while ON updates the account underneath; OFF restores THAT one', () => {
    S.setDevUnlockAll(true);
    S.adoptProgressionProfile('u-1', profile({ revision: 7, accountXp: 900 }));
    expect(mirror()).toMatchObject({ revision: 7, accountXp: 900 });
    expect(mirror()!.cosmetics!.length).toBe(new Set(COSMETICS.map((c) => c.id)).size);
    S.setDevUnlockAll(false);
    expect(mirror()).toMatchObject({ revision: 7, accountXp: 900, cosmetics: ['alpha_tester'] });
  });

  it('is inert in a production build: cannot be switched on, a stored flag is ignored, equips go to the server', async () => {
    vi.stubEnv('DEV', false);
    const before = mirror();
    S.setDevUnlockAll(true);
    expect(S.devUnlockAllOn()).toBe(false);
    expect(mirror()).toBe(before);
    localStorage.setItem('ascent.dev.unlockAll', JSON.stringify({ equippedTitleId: null, loadout: {} }));
    expect(S.devUnlockAllOn()).toBe(false);
    await S.equipCosmetic('hero_skin', notOwnedSkin.target!.id, notOwnedSkin.id);
    expect(equipCosmeticRemote).toHaveBeenCalledTimes(1);
  });
});
