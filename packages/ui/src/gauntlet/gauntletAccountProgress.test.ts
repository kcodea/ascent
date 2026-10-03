// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GAUNTLET PROGRESS, ACCOUNT MODE (2026-09-29). A signed-in (non-anonymous) player's cleared stages are the
 * account's (a mirror of `gauntlet_progress`) plus that account's clears still queued; a guest or no-session player
 * keeps the device-local list. Signing in never imports the device's clears. The FIRST confirmed clear of a stage
 * queues its crate in New Rewards exactly once; a replay grants nothing.
 */

type Invoke = { body: Record<string, unknown> };
let invokeImpl: (opts: Invoke) => Promise<{ data: unknown; error: unknown }>;
let progressRows: Array<{ stage: number }> = [];
/** Per-read gates, oldest first: a read snapshots `progressRows` when it is issued, then waits for its gate (if any). */
let progressGates: Array<Promise<void>> = [];
let userId: string | null = 'u-1';
let anonymous = false;

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    functions: { invoke: async (_fn: string, opts: Invoke) => invokeImpl(opts) },
    from: (table: string) => ({
      select: () => {
        const rows = progressRows; // the read is issued now: it sees the rows as they are now
        const gate = table === 'gauntlet_progress' ? progressGates.shift() : undefined;
        const res = async () => {
          if (table !== 'gauntlet_progress') return { data: [], error: null };
          if (gate) await gate;
          return { data: rows, error: null };
        };
        const chain = { eq: () => chain, order: () => chain, range: res, then: (f: (r: unknown) => unknown, r?: (e: unknown) => unknown) => res().then(f, r) };
        return chain;
      },
    }),
  }),
}));
vi.mock('../identity', () => ({
  currentUserId: () => userId,
  currentIdentity: () => (userId ? { userId, displayName: 'Kev', anonymous, email: anonymous ? null : 'k@example.com' } : null),
}));

const {
  GAUNTLET_LOCAL_KEY, clearedStages, flushGauntletAccount: flushWith, gauntletAccountMode, recordClear, refreshGauntletAccount, settleGauntletClear,
} = await import('./gauntletProgress');
const { clearGauntletClearQueue, pendingGauntletClears } = await import('./gauntletClearQueue');
const { resetNewRewardsForTests, useNewRewards, syncNewRewards } = await import('../progression/newRewards');

type Reward = { stage: number; crateId: string };
const flushGauntletAccount = (onReward: (r: Reward) => void) => flushWith((item, outcome) => settleGauntletClear(item, outcome, onReward));
const crate = (stage: number) => ({ crate_id: `g-${stage}`, earned_level: null, state: 'sealed', reward_cosmetic_id: null, earned_at: null, opened_at: null, source: `gauntlet:${stage}` });
/** A server that grants a crate the first time it hears of each stage, then answers replays. */
const serverCleared = new Set<number>();
const realServer = async (o: Invoke) => {
  const stage = Number(o.body.stage);
  if (serverCleared.has(stage)) return { data: { status: 'already_cleared', crate: null }, error: null };
  serverCleared.add(stage);
  progressRows = [...serverCleared].map((s) => ({ stage: s }));
  return { data: { status: 'first_clear', crate: crate(stage) }, error: null };
};

beforeEach(() => {
  clearGauntletClearQueue();
  localStorage.clear();
  resetNewRewardsForTests();
  serverCleared.clear();
  progressRows = [];
  progressGates = [];
  userId = 'u-1';
  anonymous = false;
  invokeImpl = realServer;
});

describe('which store counts', () => {
  it('signed in (non-anonymous) = account; a guest or no session = local', () => {
    expect(gauntletAccountMode()).toBe('account');
    anonymous = true;
    expect(gauntletAccountMode()).toBe('local');
    userId = null;
    expect(gauntletAccountMode()).toBe('local');
  });

  it('a guest clears on the device, exactly as before (nothing queued)', () => {
    anonymous = true;
    expect(recordClear(1)).toEqual({ firstClear: true, queued: false });
    expect(recordClear(1)).toEqual({ firstClear: false, queued: false });
    expect(clearedStages()).toEqual([1]);
    expect(JSON.parse(localStorage.getItem(GAUNTLET_LOCAL_KEY)!)).toEqual([1]);
    expect(pendingGauntletClears()).toHaveLength(0);
  });

  it('signing in does NOT import the device\'s clears: the account\'s own rows take over', async () => {
    localStorage.setItem(GAUNTLET_LOCAL_KEY, JSON.stringify([1, 2, 3]));
    expect(clearedStages()).toEqual([]); // signed in, account empty
    progressRows = [{ stage: 1 }];
    await refreshGauntletAccount();
    expect(clearedStages()).toEqual([1]);
    anonymous = true; // back to a guest: the device's list again, untouched
    expect(clearedStages()).toEqual([1, 2, 3]);
  });

  it('a signed-in clear queues, counts at once (optimistic), and never writes the device list', () => {
    expect(recordClear(2)).toEqual({ firstClear: true, queued: true });
    expect(clearedStages()).toEqual([2]);
    expect(pendingGauntletClears()).toEqual([expect.objectContaining({ userId: 'u-1', stage: 2 })]);
    expect(recordClear(2)).toEqual({ firstClear: false, queued: true });
    expect(localStorage.getItem(GAUNTLET_LOCAL_KEY)).toBeNull();
  });

  it('an older refresh answering after a newer one never overwrites the mirror', async () => {
    let releaseOld!: () => void;
    progressGates = [new Promise<void>((r) => { releaseOld = r; })];
    progressRows = [{ stage: 1 }]; // what the OLD read sees
    const older = refreshGauntletAccount();
    progressRows = [{ stage: 1 }, { stage: 2 }]; // the account moved on; the NEW read sees it
    await refreshGauntletAccount();
    expect(clearedStages()).toEqual([1, 2]);
    releaseOld();
    await older;
    expect(clearedStages()).toEqual([1, 2]);
  });

  it('another account\'s mirror and queued clears never count for this one', () => {
    recordClear(4);
    userId = 'u-2';
    expect(clearedStages()).toEqual([]);
  });
});

describe('the crate', () => {
  it('the first confirmed clear queues its crate once; a replay grants nothing', async () => {
    syncNewRewards('u-1');
    const rewards: Array<{ stage: number; crateId: string }> = [];
    recordClear(1);
    await flushGauntletAccount((r) => rewards.push(r));
    expect(rewards).toEqual([{ stage: 1, crateId: 'g-1' }]);
    expect(useNewRewards.getState().unseen.crates).toEqual([{ crateId: 'g-1', earnedLevel: null, source: 'gauntlet:1' }]);
    expect(pendingGauntletClears()).toHaveLength(0);
    expect(clearedStages()).toEqual([1]); // the mirror is the account's rows now

    expect(recordClear(1)).toEqual({ firstClear: false, queued: true });
    await flushGauntletAccount((r) => rewards.push(r));
    expect(rewards).toHaveLength(1);
    expect(useNewRewards.getState().unseen.crates).toHaveLength(1);
  });

  it('a crate answer delivered twice (a replayed queue item) is still queued once', async () => {
    syncNewRewards('u-1');
    invokeImpl = async () => ({ data: { status: 'first_clear', crate: crate(5) }, error: null });
    recordClear(5);
    await flushGauntletAccount(() => {});
    recordClear(5);
    await flushGauntletAccount(() => {});
    expect(useNewRewards.getState().unseen.crates).toHaveLength(1);
  });

  it('an offline clear stays queued and still counts as cleared', async () => {
    invokeImpl = async () => { throw new Error('offline'); };
    recordClear(3);
    await flushGauntletAccount(() => {});
    expect(pendingGauntletClears()).toHaveLength(1);
    await refreshGauntletAccount(); // the account has no row yet…
    expect(clearedStages()).toEqual([3]); // …but the queued clear still counts
  });
});
