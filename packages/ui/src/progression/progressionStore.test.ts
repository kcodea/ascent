// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressionProfile, ProgressionResult, ProgressionRunFactsV1 } from '@game/progression';

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
const flush = vi.fn(async () => {});
const enqueue = vi.fn((req: { runId: string }) => (userId && remote ? { ...req, userId, at: '', attempts: 0 } : null));

vi.mock('../identity', () => ({ currentUserId: () => userId }));
vi.mock('../remoteBoards', () => ({ remoteEnabled: () => remote }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  fetchProgressionEnabled: () => enabled(),
  fetchCratesEnabled: () => Promise.resolve(false),
  fetchAchievementsEnabled: () => achEnabled(),
  fetchOwnProgression: () => own(),
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
  before: { lifetimeXp: 100, level: 1 }, after: { lifetimeXp: 300, level: 2 }, unlockedTitles: ['alpha_tester'], cratesAwarded: 0, crateIds: [], revisionAfter: 4, settledAt: null, achievements: [], achievementXp: 0, ...over,
});

beforeEach(() => {
  S.resetProgressionForTests();
  userId = 'u-1'; remote = true;
  enabled.mockReset(); own.mockReset(); flush.mockClear(); enqueue.mockClear();
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
    expect((enqueue.mock.calls[0]![0] as { facts: { version: number } }).facts).toMatchObject({ version: 2, metrics: { rubyPlays: 3 } });
    S.useProgression.setState({ achievementsCapability: 'off' });
    enqueue.mockClear();
    S.beginRunProgression('8', { ...v2, runId: 'run-2' });
    expect((enqueue.mock.calls[0]![0] as { facts: Record<string, unknown> }).facts).not.toHaveProperty('metrics');
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
