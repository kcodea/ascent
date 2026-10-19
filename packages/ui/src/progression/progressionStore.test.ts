// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AETHER_ECONOMY, type AetherEconomy, type BuyCrateResult, type CrateRow, type ProgressionProfile, type ProgressionResult, type ProgressionRunFactsV1 } from '@game/progression';
import type { InventoryOutcome } from './progressionRemote';

/**
 * ACCOUNT PROGRESSION: the client slice. The feature flag (capability probe) gates everything; the mirror adopts
 * the server profile by HIGHEST revision; the end screen's run is keyed locally and follows the queue's answers;
 * a run with no session / no source settles to `none` (no XP, nothing shown).
 */
let userId: string | null = 'u-1';
let remote = true;
const enabled = vi.fn<() => Promise<boolean | undefined>>();
const achEnabled = vi.fn<() => Promise<boolean | undefined>>(async () => false);
const own = vi.fn<() => Promise<ProgressionProfile | null | undefined>>();
const seenIds = vi.fn<() => Promise<string[] | 'unsupported' | undefined>>(async () => undefined);
const aetherEnabled = vi.fn<() => Promise<boolean | undefined>>(async () => false);
const aetherEconomy = vi.fn<() => Promise<AetherEconomy | undefined>>(async () => undefined);
const buyRemote = vi.fn<(req: { tier: string; focus: string[] | null; expectedTotal: number; requestId: string }) => Promise<InventoryOutcome<BuyCrateResult>>>();
const openRemote = vi.fn<(crateId: string, focus?: string[] | null, expectedFee?: number) => Promise<InventoryOutcome<BuyCrateResult>>>();
const flush = vi.fn(async () => {});
const enqueue = vi.fn((req: { runId: string }) => (userId && remote ? { ...req, userId, at: '', attempts: 0 } : null));

vi.mock('../identity', () => ({ currentUserId: () => userId }));
vi.mock('../remoteBoards', () => ({ remoteEnabled: () => remote }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  fetchProgressionEnabled: () => enabled(),
  fetchCratesEnabled: () => Promise.resolve(false),
  fetchAchievementsEnabled: () => achEnabled(),
  fetchAetherEnabled: () => aetherEnabled(),
  fetchAetherEconomy: () => aetherEconomy(),
  buyCrateRemote: (req: Parameters<typeof buyRemote>[0]) => buyRemote(req),
  openCrateRemote: (...a: Parameters<typeof openRemote>) => openRemote(...a),
  fetchOwnProgression: () => own(),
  fetchSeenCosmeticIds: () => seenIds(),
}));
vi.mock('./progressionQueue', () => ({
  enqueuePendingProgression: (req: { runId: string }) => enqueue(req),
  flushPendingProgressions: (...a: unknown[]) => flush(...(a as [])),
  installProgressionRetryTriggers: () => {},
}));

const S = await import('./progressionStore');

const profile = (over: Partial<ProgressionProfile> = {}): ProgressionProfile => ({ accountXp: 300, accountLevel: 2, revision: 4, equippedTitleId: 'alpha_tester', titles: ['alpha_tester'], ...over });
const facts = (over: Partial<ProgressionRunFactsV1> = {}): ProgressionRunFactsV1 => ({
  version: 1, runId: 'run-1', mode: 'ranked', setId: 'set2', patch: 'p', heroId: 'indy', placement: 1, waveReached: 12,
  terminal: true, comebackAfterFourLosses: false, combats: { wins: 9, losses: 3, draws: 0 }, ...over,
});
const result = (over: Partial<ProgressionResult> = {}): ProgressionResult => ({
  runId: 'run-1', mode: 'ranked', rulesVersion: 1, placement: 1, comeback: false,
  xp: { base: 100, topFour: 40, firstPlace: 60, comeback: 0, total: 200 },
  before: { lifetimeXp: 100, level: 1 }, after: { lifetimeXp: 300, level: 2 }, unlockedTitles: ['alpha_tester'], cratesAwarded: 0, crateIds: [], revisionAfter: 4, settledAt: null, achievements: [], achievementXp: 0, aether: null, aetherBalance: null, ...over,
});

beforeEach(() => {
  S.resetProgressionForTests();
  userId = 'u-1'; remote = true;
  enabled.mockReset(); own.mockReset(); flush.mockClear(); enqueue.mockClear();
  seenIds.mockReset().mockResolvedValue(undefined);
  aetherEnabled.mockReset().mockResolvedValue(false); aetherEconomy.mockReset().mockResolvedValue(undefined);
  buyRemote.mockReset(); openRemote.mockReset();
  localStorage.clear();
});

describe('the mirror', () => {
  it('adopts by HIGHEST revision: a late, older answer never rolls it back', () => {
    expect(S.adoptProgressionProfile('u-1', profile({ revision: 4 }))).toBe(true);
    expect(S.adoptProgressionProfile('u-1', profile({ revision: 3, accountXp: 50 }))).toBe(false);
    expect(S.useProgression.getState().mirror).toMatchObject({ userId: 'u-1', revision: 4, accountXp: 300 });
    expect(S.adoptProgressionProfile('u-1', profile({ revision: 4, accountXp: 300 }))).toBe(true); // equal revision re-adopts
    // another account's answer replaces a mirror that was not its own (the mirror is per account)
    expect(S.adoptProgressionProfile('u-2', profile({ revision: 1 }))).toBe(true);
    expect(S.mirrorFor('u-1', S.useProgression.getState().mirror)).toBeNull();
    expect(S.mirrorFor('u-2', S.useProgression.getState().mirror)).toMatchObject({ revision: 1 });
  });
});

describe('the capability probe (the feature flag)', () => {
  it('off: nothing adopted, nothing flushed', async () => {
    enabled.mockResolvedValue(false);
    await S.probeProgression();
    expect(S.useProgression.getState().capability).toBe('off');
    expect(own).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });
  it('on: the own profile is adopted and the queue is flushed (forced)', async () => {
    enabled.mockResolvedValue(true);
    own.mockResolvedValue(profile());
    await S.probeProgression();
    expect(S.useProgression.getState().capability).toBe('on');
    expect(S.useProgression.getState().mirror).toMatchObject({ userId: 'u-1', accountLevel: 2 });
    expect(flush).toHaveBeenCalledWith(expect.any(Function), { force: true });
  });
  it('an unanswerable probe (offline) keeps what it had', async () => {
    S.useProgression.setState({ capability: 'on' });
    enabled.mockResolvedValue(undefined);
    await S.probeProgression();
    expect(S.useProgression.getState().capability).toBe('on');
  });
  it('no backend configured is off', async () => {
    remote = false;
    await S.probeProgression();
    expect(S.useProgression.getState().capability).toBe('off');
  });
});

// Owner 2026-10-11: "i want to save the 'seen' on the account level". The Collection's own tests cover the badges.
describe('the Collection seen list rides the probe', () => {
  const stored = (k: string): unknown => JSON.parse(localStorage.getItem(k) ?? 'null');
  it('the account answers: its list is published, copied to this device, and the device is marked as knowing it', async () => {
    enabled.mockResolvedValue(true);
    own.mockResolvedValue(profile({ cosmetics: ['alpha_tester', 'skin_albus_1'] }));
    seenIds.mockResolvedValue(['alpha_tester']);
    await S.probeProgression();
    const known = S.useProgression.getState().seenKnown;
    expect(known?.userId).toBe('u-1');
    expect([...known!.ids]).toEqual(['alpha_tester']); // NOT everything owned: the skin is still to be looked at
    expect(stored('ascent.collection.seen.u-1')).toEqual(['alpha_tester']);
    expect(localStorage.getItem('ascent.collection.baseline.u-1')).toBe('1');
  });
  it('a server from before the migration: the device takes a one-time baseline from the ownership just read', async () => {
    enabled.mockResolvedValue(true);
    own.mockResolvedValue(profile({ cosmetics: ['alpha_tester', 'skin_albus_1'] }));
    seenIds.mockResolvedValue('unsupported');
    await S.probeProgression();
    expect([...S.useProgression.getState().seenKnown!.ids].sort()).toEqual(['alpha_tester', 'skin_albus_1']);
    expect(localStorage.getItem('ascent.collection.baseline.u-1')).toBe('1');
  });
  it('no answer: nothing is published and nothing is written', async () => {
    enabled.mockResolvedValue(true);
    own.mockResolvedValue(profile({ cosmetics: ['alpha_tester'] }));
    await S.probeProgression();
    expect(S.useProgression.getState().seenKnown).toBeNull();
    expect(localStorage.getItem('ascent.collection.seen.u-1')).toBeNull();
    expect(localStorage.getItem('ascent.collection.baseline.u-1')).toBeNull();
  });
  it('an answer for an account that is no longer the live one is dropped', async () => {
    seenIds.mockImplementation(async () => { userId = 'u-2'; return ['alpha_tester']; });
    await S.refreshSeenList('u-1', null);
    expect(S.useProgression.getState().seenKnown).toBeNull();
    expect(localStorage.getItem('ascent.collection.baseline.u-1')).toBeNull();
  });
});

describe('achievements (batch 1, 2026-09-28)', () => {
  it('the probe sets the achievements capability; the run metrics ride along only while it is on', async () => {
    enabled.mockResolvedValue(true);
    own.mockResolvedValue(profile());
    achEnabled.mockResolvedValueOnce(true);
    await S.probeProgression();
    expect(S.useProgression.getState().achievementsCapability).toBe('on');
    expect(S.achievementsVisible(S.useProgression.getState())).toBe(true);
    enqueue.mockClear();
    const v2 = { ...facts(), version: 2 as const, metrics: { rubyPlays: 3 } };
    S.beginRunProgression('7', v2);
    expect((enqueue.mock.calls[0]![0] as unknown as { facts: { version: number } }).facts).toMatchObject({ version: 2, metrics: { rubyPlays: 3 } });
    S.useProgression.setState({ achievementsCapability: 'off' });
    enqueue.mockClear();
    S.beginRunProgression('8', { ...v2, runId: 'run-2' });
    expect((enqueue.mock.calls[0]![0] as unknown as { facts: Record<string, unknown> }).facts).not.toHaveProperty('metrics');
    expect(S.achievementsVisible(S.useProgression.getState())).toBe(false);
  });
});

describe('a finished run', () => {
  it('queues and shows pending; the queue answer lands on the run the end screen shows', () => {
    S.useProgression.setState({ capability: 'on' });
    expect(S.beginRunProgression('42', facts())).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(S.useProgression.getState().current).toMatchObject({ localKey: '42', runId: 'run-1', state: 'pending' });
    S.applyProgressionOutcome({ userId: 'u-1', runId: 'run-1', mode: 'ranked' }, { status: 'confirmed', result: result(), profile: profile(), deduped: false });
    expect(S.useProgression.getState().current).toMatchObject({ state: 'confirmed', result: { xp: { total: 200 } } });
    expect(S.useProgression.getState().mirror).toMatchObject({ accountXp: 300 });
  });
  it('a retryable answer marks the run pending-sync; an answer for ANOTHER run only updates the mirror', () => {
    S.useProgression.setState({ capability: 'on' });
    S.beginRunProgression('42', facts());
    S.applyProgressionOutcome({ userId: 'u-1', runId: 'run-1', mode: 'ranked' }, { status: 'retryable', reason: 'timeout' });
    expect(S.useProgression.getState().current).toMatchObject({ state: 'retryable', error: 'timeout' });
    S.applyProgressionOutcome({ userId: 'u-1', runId: 'older', mode: 'ranked' }, { status: 'confirmed', result: result({ runId: 'older' }), profile: profile({ revision: 9 }), deduped: false });
    expect(S.useProgression.getState().current).toMatchObject({ runId: 'run-1', state: 'retryable' });
    expect(S.useProgression.getState().mirror).toMatchObject({ revision: 9 });
  });
  it('while the probe is still out (unknown) the run is QUEUED durably, not dropped', () => {
    expect(S.beginRunProgression('42', facts())).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it('feature off, no session, or a non-terminal run: nothing queued, nothing to show', () => {
    S.useProgression.setState({ capability: 'off' });
    expect(S.beginRunProgression('1', facts())).toBe(false);
    S.useProgression.setState({ capability: 'on' });
    userId = null;
    expect(S.beginRunProgression('2', facts())).toBe(false);
    userId = 'u-1';
    expect(S.beginRunProgression('3', facts({ terminal: false }))).toBe(false);
    expect(S.useProgression.getState().current).toMatchObject({ localKey: '3', state: 'none' });
    expect(enqueue).toHaveBeenCalledTimes(1); // only the no-session attempt reached the queue (which refused it)
  });
  it('practice: pending while the row uploads, `none` if the row never lands', () => {
    S.useProgression.setState({ capability: 'on' });
    S.expectRunProgression('7', 'practice');
    expect(S.useProgression.getState().current).toMatchObject({ localKey: '7', state: 'pending', runId: null });
    S.markRunProgressionUnavailable('7');
    expect(S.useProgression.getState().current).toMatchObject({ state: 'none' });
  });
});

describe('the presentation marker', () => {
  it('plays the ceremony once per settled run', () => {
    expect(S.wasProgressionPresented('ranked', 'r')).toBe(false);
    S.markProgressionPresented('ranked', 'r');
    expect(S.wasProgressionPresented('ranked', 'r')).toBe(true);
    expect(S.wasProgressionPresented('practice', 'r')).toBe(false);
  });
});

// AETHER + CRATE SHOP (2026-10-18): the second capability flag, the economy document, the balance the mirror holds, and
// `buyCrate` (the server prices and rolls; the client names a tier, a focus, the price it showed, and a request id).
describe('Aether (capability, economy, buyCrate)', () => {
  const crate = (over: Partial<CrateRow> = {}): CrateRow => ({ crateId: 'c-new', earnedLevel: null, state: 'opened', rewardId: 'alpha_tester', earnedAt: null, openedAt: '2026-10-18T00:00:00Z', source: 'shop:00000000-0000-4000-8000-000000000001', floor: 'rare', ...over });
  const bought = (aether: number, over: Partial<BuyCrateResult> = {}): InventoryOutcome<BuyCrateResult> => ({
    status: 'ok',
    value: { status: 'opened', crate: crate(), rewardId: 'alpha_tester', sealedRemaining: 0, aether, quote: null, ...over },
    profile: profile({ revision: 5, aether }),
  });

  it('aetherVisible needs crates visible AND the aether flag on', () => {
    S.useProgression.setState({ capability: 'on', cratesCapability: 'on', aetherCapability: 'unknown' });
    expect(S.aetherVisible(S.useProgression.getState())).toBe(false);
    S.useProgression.setState({ aetherCapability: 'on' });
    expect(S.aetherVisible(S.useProgression.getState())).toBe(true);
    S.useProgression.setState({ cratesCapability: 'off' });
    expect(S.aetherVisible(S.useProgression.getState())).toBe(false);
  });
  it('probeProgression asks the aether flag after crates and reads the economy', async () => {
    enabled.mockResolvedValue(true);
    own.mockResolvedValue(profile());
    aetherEnabled.mockResolvedValue(true);
    aetherEconomy.mockResolvedValue({ ...DEFAULT_AETHER_ECONOMY, version: 2 });
    await S.probeProgression();
    expect(S.useProgression.getState().aetherCapability).toBe('on');
    expect(S.useProgression.getState().economy.version).toBe(2);
  });
  it('an unanswerable aether probe keeps what it had; an unreadable economy keeps the last one', async () => {
    S.useProgression.setState({ aetherCapability: 'on' });
    enabled.mockResolvedValue(true);
    own.mockResolvedValue(profile());
    aetherEnabled.mockResolvedValue(undefined);
    await S.probeProgression();
    expect(S.useProgression.getState().aetherCapability).toBe('on');
    expect(S.useProgression.getState().economy).toBe(DEFAULT_AETHER_ECONOMY);
  });
  it('aetherBalance reads the live account mirror, 0 without one', () => {
    expect(S.aetherBalance(S.useProgression.getState())).toBe(0);
    S.adoptProgressionProfile('u-1', profile({ aether: 340 }));
    expect(S.useProgression.getState().mirror?.aether).toBe(340);
    expect(S.aetherBalance(S.useProgression.getState())).toBe(340);
    S.adoptProgressionProfile('u-2', profile({ aether: 9 }));
    expect(S.aetherBalance(S.useProgression.getState())).toBe(0); // the mirror is another account's
  });
  it('buyCrate adopts the new balance and merges the opened crate', async () => {
    S.adoptProgressionProfile('u-1', profile({ revision: 4, aether: 100 }));
    buyRemote.mockResolvedValue(bought(0));
    const out = await S.buyCrate('rare', null, 200);
    expect(out.status).toBe('ok');
    expect(S.aetherBalance(S.useProgression.getState())).toBe(0);
    expect(S.useProgression.getState().crateList?.map((c) => c.crateId)).toEqual(['c-new']);
    expect(buyRemote).toHaveBeenCalledWith(expect.objectContaining({ tier: 'rare', focus: null, expectedTotal: 200 }));
  });
  it('price_changed refreshes the economy and returns the outcome unchanged', async () => {
    buyRemote.mockResolvedValue({ status: 'error', reason: 'price_changed' });
    const out = await S.buyCrate('epic', ['title'], 500);
    expect(out).toEqual({ status: 'error', reason: 'price_changed' });
    expect(aetherEconomy).toHaveBeenCalledTimes(1);
  });
  it('other errors (aether_config_missing, a throw) come back as error outcomes with no refresh and no retry', async () => {
    buyRemote.mockResolvedValue({ status: 'error', reason: 'aether_config_missing' });
    expect(await S.buyCrate('rare', null, 200)).toEqual({ status: 'error', reason: 'aether_config_missing' });
    buyRemote.mockRejectedValueOnce(new Error('boom'));
    expect(await S.buyCrate('rare', null, 200)).toEqual({ status: 'error', reason: 'boom' });
    expect(buyRemote).toHaveBeenCalledTimes(2);
    expect(aetherEconomy).not.toHaveBeenCalled();
  });
  it('no session refuses without calling the server', async () => {
    userId = null;
    expect(await S.buyCrate('rare', null, 200)).toEqual({ status: 'error', reason: 'no_session' });
    expect(buyRemote).not.toHaveBeenCalled();
  });
  it('one request id per buy: two calls send two different ids (each a v4 UUID)', async () => {
    buyRemote.mockResolvedValue(bought(0));
    await S.buyCrate('rare', null, 200);
    await S.buyCrate('rare', null, 200);
    const ids = buyRemote.mock.calls.map((c) => c[0].requestId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('openCrate forwards the focus and the fee the player was shown, and adopts the balance', async () => {
    openRemote.mockResolvedValue(bought(10));
    const out = await S.openCrate('c-1', ['title', 'hero_skin'], 120);
    expect(out.status).toBe('ok');
    expect(openRemote).toHaveBeenCalledWith('c-1', ['title', 'hero_skin'], 120);
    expect(S.aetherBalance(S.useProgression.getState())).toBe(10);
  });
  it('resetProgressionForTests restores the aether flag and the default economy', () => {
    S.useProgression.setState({ aetherCapability: 'on', economy: { ...DEFAULT_AETHER_ECONOMY, version: 9 } });
    S.resetProgressionForTests();
    expect(S.useProgression.getState().aetherCapability).toBe('unknown');
    expect(S.useProgression.getState().economy).toBe(DEFAULT_AETHER_ECONOMY);
  });
});
