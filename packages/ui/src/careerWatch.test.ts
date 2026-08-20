/**
 * CAREER WATCH (owner ask 2026-08-19) — watching back your OWN past runs from the Career's match history.
 *
 * run_history (the career rows) and run_telemetry (which carries the v2 replay) are separate tables written
 * from the same run-end flow with no shared id — the run's SEED is the only honest join (`RunHistoryEntry.seed`
 * ↔ `replay.seed` / `replay.v2.seed`). These tests pin the three load-bearing pieces:
 *
 *  1. `historyEntryWatchable` — the NO-BUTTON predicate. A row that cannot map (no seed, not a lobby run —
 *     only lobbies upload telemetry — or finished before v2 capture shipped) gets no Watch affordance at all,
 *     because a button that usually answers "No replay" is noise.
 *  2. `pickReplayForSeed` — the client-side verification over fetched rows: the right seed wins, a v1-only or
 *     malformed payload is skipped (never thrown on), a wrong-seed payload can never play as your run.
 *  3. `fetchReplayForSeed` — the server-side filter shape: by `replay->>seed`, gated on `replay->v2->>version`,
 *     and scoped to the career owner's `user_id` when known (seed collisions across players are unlikely, but
 *     the column exists and the filter is free).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { V2_CAPTURE_START_MS } from './remoteBoards';

interface Query { table: string; select?: string; eqs: [string, unknown][] }

const queries: Query[] = [];
let rows: unknown[] = [];
let userId: string | null = 'me-1';

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Query = { table, eqs: [] };
      queries.push(q);
      const chain = {
        select: (sel: string) => { q.select = sel; return chain; },
        eq: (col: string, val: unknown) => { q.eqs.push([col, val]); return chain; },
        order: () => chain,
        limit: () => Promise.resolve({ data: rows, error: null }),
        then: (res: (v: unknown) => unknown) => res({ data: rows, error: null }),
      };
      return chain;
    },
  }),
}));

vi.mock('./identity', () => ({
  currentUserId: () => userId,
  currentIdentity: () => (userId ? { userId, displayName: '', anonymous: true } : null),
  setIdentity: () => {},
}));

const load = async () => await import('./remoteBoards');

beforeEach(() => { queries.length = 0; rows = []; userId = 'me-1'; vi.resetModules(); });

/** A minimal structurally-valid v2 payload with a seed (the gate checks version + non-empty frames). */
const v2Of = (seed: number) => ({
  version: 2, seed, heroId: 'brackus', mode: 'lobby', author: 'kev', patch: '0.1.0',
  frames: [{ kind: 'shop', wave: 1, tMs: 0, cause: 'turnStart', view: {} }],
  result: { placement: 1, record: { wins: 5, losses: 0, draws: 0 }, finalBoard: null },
});

/** An ISO timestamp N hours after v2 capture shipped (negative = before). */
const atMs = (hoursAfterV2: number) => new Date(V2_CAPTURE_START_MS + hoursAfterV2 * 3_600_000).toISOString();

describe('historyEntryWatchable — which match rows get a Watch button at all', () => {
  const good = { seed: 12345, at: atMs(2), mode: 'lobby', placement: 3 };

  it('offers a lobby run with a seed that post-dates v2 capture', async () => {
    expect((await load()).historyEntryWatchable(good)).toBe(true);
  });

  it('a recorded placement alone marks the run a lobby (older rows may lack `mode`)', async () => {
    expect((await load()).historyEntryWatchable({ ...good, mode: undefined })).toBe(true);
  });

  it('no seed → no button (a seed-less row cannot map to its replay)', async () => {
    const w = (await load()).historyEntryWatchable;
    expect(w({ ...good, seed: undefined })).toBe(false);
    expect(w({ ...good, seed: 'not-a-number' })).toBe(false);
    expect(w({ ...good, seed: NaN })).toBe(false);
  });

  it('non-lobby runs → no button (only lobby runs upload telemetry, so nothing exists to fetch)', async () => {
    expect((await load()).historyEntryWatchable({ ...good, mode: 'rift', placement: undefined })).toBe(false);
  });

  it('pre-v2-capture rows → no button (nothing was recorded before Phase A shipped)', async () => {
    const w = (await load()).historyEntryWatchable;
    expect(w({ ...good, at: atMs(-2) })).toBe(false);
    expect(w({ ...good, at: undefined })).toBe(false); // entries without `at` predate v2 by a wide margin
    expect(w({ ...good, at: 'garbage' })).toBe(false);
  });
});

describe('pickReplayForSeed — client-side verification over fetched rows', () => {
  it('the right seed wins, newest first', async () => {
    const pick = (await load()).pickReplayForSeed;
    const right = v2Of(777);
    expect(pick([{ v2: right }, { v2: v2Of(777) }], 777)).toBe(right);
  });

  it('a wrong-seed payload can never play as this run', async () => {
    expect((await load()).pickReplayForSeed([{ v2: v2Of(778) }], 777)).toBeNull();
  });

  it('skips a malformed newest payload and plays the next matching one', async () => {
    const pick = (await load()).pickReplayForSeed;
    const right = v2Of(777);
    expect(pick([{ v2: { version: 2, seed: 777 } }, { v2: right }], 777)).toBe(right); // no frames → skipped
    expect(pick([{ v2: null }, { v2: right }], 777)).toBe(right);
  });

  it('a v1-only row is rejected (the payload under `v2` is what plays, never the action log)', async () => {
    const v1Only = { seed: 777, heroId: 'brackus', actions: [{ type: 'buy' }] };
    expect((await load()).pickReplayForSeed([{ v2: v1Only }], 777)).toBeNull();
  });

  it('no rows → null', async () => {
    expect((await load()).pickReplayForSeed([], 777)).toBeNull();
  });
});

describe('fetchReplayForSeed — the server-side filter shape', () => {
  it('filters by seed + v2 version + the owner user_id, and returns the matching payload', async () => {
    rows = [{ v2: v2Of(424242) }];
    const rep = await (await load()).fetchReplayForSeed(424242, { userId: 'me-1' });
    expect(rep).toMatchObject({ version: 2, seed: 424242 });
    const q = queries.find((x) => x.table === 'run_telemetry');
    expect(q?.select).toBe('v2:replay->v2'); // the v2 payload alone — dormant v1 fields never cross the wire
    expect(q?.eqs).toContainEqual(['replay->>seed', '424242']);
    expect(q?.eqs).toContainEqual(['replay->v2->>version', '2']);
    expect(q?.eqs).toContainEqual(['user_id', 'me-1']);
  });

  it('omits the user filter when the owner is unknown (a signed-out client can still watch)', async () => {
    rows = [{ v2: v2Of(424242) }];
    await (await load()).fetchReplayForSeed(424242, { userId: null });
    const q = queries.find((x) => x.table === 'run_telemetry');
    expect(q?.eqs.some(([col]) => col === 'user_id')).toBe(false);
  });

  it('returns null on a seed that fetched nothing (the caller shows "No replay")', async () => {
    rows = [];
    await expect((await load()).fetchReplayForSeed(999)).resolves.toBeNull();
  });

  it('never throws on a malformed payload — null instead', async () => {
    rows = [{ v2: 'garbage' }];
    await expect((await load()).fetchReplayForSeed(424242)).resolves.toBeNull();
  });
});
