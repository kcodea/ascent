import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { gunzipText, gzipText, loadStoredReplay, replayHeadOf, storeReplay } from './replayStorage';

/**
 * REPLAYS IN STORAGE, the client half (R-REPLAY-STORAGE-01): the upload lands in the player's own folder as gzipped JSON
 * that round-trips exactly; any failure answers null so the row keeps the replay inline; a stored replay is downloaded
 * once a session; the head keeps every listed fact and drops the bulk.
 */
type Upload = { path: string; body: Blob; opts: unknown };
function fakeClient(o: { failUpload?: boolean; objects?: Map<string, Blob> } = {}): { c: SupabaseClient; uploads: Upload[]; downloads: string[] } {
  const uploads: Upload[] = [];
  const downloads: string[] = [];
  const objects = o.objects ?? new Map<string, Blob>();
  const c = {
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: Blob, opts: unknown) => {
          expect(bucket).toBe('replays');
          uploads.push({ path, body, opts });
          if (o.failUpload) return { data: null, error: { message: 'Bucket not found' } };
          objects.set(path, body);
          return { data: { path }, error: null };
        },
        download: async (path: string) => {
          downloads.push(path);
          const b = objects.get(path);
          return b ? { data: b, error: null } : { data: null, error: { message: 'not found' } };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { c, uploads, downloads };
}

const replay = { seed: 7, heroId: 'h', mode: 'lobby', actions: [{ a: 1 }], v2: {
  version: 2, seed: 7, activeMs: 5, frames: [{ tMs: 10, view: { x: 'é✓' } }, { tMs: 20 }, { tMs: 30 }], stream: { s: 1 }, cursorTrail: [[1]],
  result: { finalBoard: { minions: [1] }, record: { w: 1 }, boardStrength: 50 },
} };

describe('replayStorage', () => {
  it('gzip round-trips text exactly (multi-byte characters included)', async () => {
    const t = JSON.stringify(replay);
    expect(await gunzipText((await gzipText(t))!)).toBe(t);
  });

  it('storeReplay uploads gzipped JSON into the player\'s own folder, never overwriting, and returns the row columns', async () => {
    const { c, uploads } = fakeClient();
    const cols = await storeReplay(c, 'user-1', replay);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.path).toMatch(/^user-1\/[0-9a-z-]+\.json\.gz$/);
    expect(uploads[0]!.opts).toMatchObject({ contentType: 'application/gzip', upsert: false });
    expect(JSON.parse(await gunzipText(await uploads[0]!.body.arrayBuffer()))).toEqual(replay);
    expect(cols).toEqual({ replay_path: uploads[0]!.path, replay_head: replayHeadOf(replay) });
  });

  it('any upload failure answers null (the row then keeps the replay inline)', async () => {
    expect(await storeReplay(fakeClient({ failUpload: true }).c, 'user-1', replay)).toBeNull();
    const g = globalThis as { CompressionStream?: unknown };
    const keep = g.CompressionStream;
    vi.stubGlobal('CompressionStream', undefined);
    try { expect(await storeReplay(fakeClient().c, 'user-1', replay)).toBeNull(); } finally { vi.stubGlobal('CompressionStream', keep); }
  });

  it('loadStoredReplay parses the object, downloads it once a session, and answers null for a missing one', async () => {
    const objects = new Map<string, Blob>();
    const { c, downloads } = fakeClient({ objects });
    const cols = await storeReplay(c, 'user-2', replay);
    expect(await loadStoredReplay(c, cols!.replay_path)).toEqual(replay);
    expect(await loadStoredReplay(c, cols!.replay_path)).toEqual(replay);
    expect(downloads).toHaveLength(1);
    expect(await loadStoredReplay(c, 'user-2/none.json.gz')).toBeNull();
  });

  it('the head keeps every listed fact and drops the bulk', () => {
    expect(replayHeadOf(replay)).toEqual({
      seed: 7, heroId: 'h', mode: 'lobby',
      v2: { version: 2, seed: 7, activeMs: 5, frames: [{ tMs: 10 }, { tMs: 30 }], result: replay.v2.result },
    });
    expect(replayHeadOf(null)).toBeNull();
  });
});
