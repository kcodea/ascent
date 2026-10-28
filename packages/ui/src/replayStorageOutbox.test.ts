import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * REPLAYS IN STORAGE through the run-end outbox (R-REPLAY-STORAGE-01 + R-NET-OUTBOX-01). The telemetry row's replay
 * goes to the `replays` bucket in the player's folder and the row carries `replay: null` + the pointer + the head; if
 * the upload fails, or the server refuses the stored row (e.g. no `replay_path` column yet), the SAME send falls back
 * to the inline row, so a replay is never dropped.
 */
interface Call { table: string; op: string; payload: unknown }
const calls: Call[] = [];
const uploads: string[] = [];
let failUpload = false;
let refuseStored = false;

vi.stubEnv('VITE_SUPABASE_URL', 'http://test.local');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploads.push(path);
          return failUpload ? { data: null, error: { message: 'Bucket not found' } } : { data: { path }, error: null };
        },
      }),
    },
    from: (table: string) => {
      const write = (op: string) => async (payload: unknown) => {
        calls.push({ table, op, payload });
        const stored = Array.isArray(payload) && payload.some((r) => (r as { replay_path?: unknown }).replay_path);
        return refuseStored && stored
          ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'replay_path' column of 'run_telemetry' in the schema cache" } }
          : { data: null, error: null };
      };
      return { insert: write('insert'), upsert: write('upsert') };
    },
  }),
}));

vi.mock('./identity', () => ({
  currentUserId: () => 'u-1',
  currentIdentity: () => ({ userId: 'u-1', displayName: 'Kev', anonymous: true, email: null }),
  setIdentity: () => {},
  identitySettled: () => null,
}));

beforeEach(() => { calls.length = 0; uploads.length = 0; failUpload = false; refuseStored = false; vi.resetModules(); });

const replay = { seed: 5, heroId: 'h', mode: 'lobby', actions: [{ a: 1 }], v2: { version: 2, seed: 5, frames: [{ tMs: 1 }, { tMs: 9 }], result: { record: { w: 1 } } } };
const telemetry = { heroId: 'h', heroOffer: ['h'], won: false, wins: 3, offeredQuests: [], pickedQuests: [], questTurns: {}, offeredRunes: [], pickedRunes: [], offeredCards: [], boughtCards: [], tierByWave: [], discoverOfferedCards: [], discoverBoughtCards: [] } as never;
const derived = { contentRevision: 'r' } as never;
const sentRows = (): Array<Record<string, unknown>> => calls.filter((c) => c.table === 'run_telemetry').map((c) => (c.payload as Array<Record<string, unknown>>)[0]!);

describe('telemetry replays through the outbox', { timeout: 60_000 }, () => {
  it('stores the replay in the player\'s folder and sends the row with the pointer and head, not the replay', async () => {
    const { uploadRunTelemetry, replayHeadOf } = { ...(await import('./remoteBoards')), ...(await import('./replayStorage')) };
    await uploadRunTelemetry(telemetry, { patch: 'p', derived, replay, uploadKey: 'k1' });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatch(/^u-1\/.+\.json\.gz$/);
    const rows = sentRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ replay: null, replay_path: uploads[0], user_id: 'u-1' });
    expect(rows[0]!.replay_head).toEqual(replayHeadOf(replay));
  });

  it('an upload failure sends the replay inline, as before', async () => {
    failUpload = true;
    const { uploadRunTelemetry } = await import('./remoteBoards');
    await uploadRunTelemetry(telemetry, { patch: 'p', derived, replay, uploadKey: 'k2' });
    const rows = sentRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.replay).toEqual(replay);
    expect(rows[0]).not.toHaveProperty('replay_path');
  });

  it('a refused stored row (no replay_path column yet) is re-sent inline in the same send: the replay is never lost', async () => {
    refuseStored = true;
    const { uploadRunTelemetry, pendingRunWrites } = await import('./remoteBoards');
    await uploadRunTelemetry(telemetry, { patch: 'p', derived, replay, uploadKey: 'k3' });
    const rows = sentRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.replay_path).toBeTruthy();
    expect(rows[1]!.replay).toEqual(replay);
    expect(rows[1]).not.toHaveProperty('replay_path');
    expect(await pendingRunWrites()).toEqual([]); // it landed: nothing left to retry
  });
});
