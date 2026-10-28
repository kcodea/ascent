import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { backfill, objectPathFor, restore, sha256Hex, withRetry, type Api } from './backfill';

/** The replay backfill against an in-memory backend (R-REPLAY-STORAGE-01): copy, re-download, verify, then mark. */
interface Row { id: number; user_id: string | null; replay: string | null; replay_path: string | null; replay_sha256: string | null; replay_bytes: number | null }

const noSleep = async (): Promise<void> => {};
function fakeApi(rows: Row[], opts: { corrupt?: Set<string>; flaky?: Map<number, number> } = {}): Api & { objects: Map<string, Uint8Array>; textReads: number[] } {
  const objects = new Map<string, Uint8Array>();
  const textReads: number[] = [];
  return {
    objects,
    textReads,
    async pendingIds(after, limit) {
      return rows.filter((r) => r.replay != null && r.replay_path == null && r.id > after).sort((a, b) => a.id - b.id).slice(0, limit)
        .map((r) => ({ id: r.id, user_id: r.user_id }));
    },
    async replayText(id) {
      textReads.push(id);
      const left = opts.flaky?.get(id) ?? 0;
      if (left > 0) { opts.flaky!.set(id, left - 1); throw new Error(`GET run_telemetry: 500 {"code":"57014","message":"canceling statement due to statement timeout"}`); }
      return rows.find((r) => r.id === id)?.replay ?? null;
    },
    async storedOnlyRows(after, limit) {
      return rows.filter((r) => r.replay == null && r.replay_path != null && r.id > after).sort((a, b) => a.id - b.id).slice(0, limit)
        .map((r) => ({ id: r.id, replay_path: r.replay_path!, replay_sha256: r.replay_sha256 }));
    },
    async upload(path, body) { objects.set(path, new Uint8Array(body)); },
    async download(path) {
      const o = objects.get(path);
      if (!o) throw new Error('404');
      if (opts.corrupt?.has(path)) { const c = new Uint8Array(o); c[c.length - 1] ^= 1; return c; }
      return o;
    },
    async markCopied(id, p) { const r = rows.find((x) => x.id === id)!; if (r.replay_path == null) Object.assign(r, { replay_path: p.replay_path, replay_sha256: p.replay_sha256, replay_bytes: p.replay_bytes }); },
    async restoreReplay(id, replay) { rows.find((x) => x.id === id)!.replay = JSON.stringify(replay); },
  };
}

const replayText = (n: number): string => JSON.stringify({ seed: n, heroId: 'h', mode: 'lobby', actions: [1, 2, 3], v2: { version: 2, frames: Array.from({ length: 50 }, (_, i) => ({ tMs: i * 10, note: 'é✓' })) } });

describe('replays backfill', () => {
  it('copies every inline replay, byte-verified, records the proof, and never touches the replay column', async () => {
    const rows: Row[] = [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, user_id: id === 7 ? null : `u${id % 2}`, replay: replayText(id), replay_path: null, replay_sha256: null, replay_bytes: null }));
    rows.push({ id: 8, user_id: 'u1', replay: null, replay_path: null, replay_sha256: null, replay_bytes: null }); // no replay: skipped
    const api = fakeApi(rows);
    const r = await backfill(api, { pageSize: 3, sleep: noSleep });
    expect(r.copied).toBe(7);
    expect(r.failed).toEqual([]);
    for (const row of rows.slice(0, 7)) {
      expect(row.replay_path).toBe(objectPathFor(row.id, row.user_id));
      const text = Buffer.from(row.replay!, 'utf8');
      expect(row.replay_sha256).toBe(sha256Hex(text));
      expect(row.replay_bytes).toBe(text.length); // bytes, not characters (the text holds multi-byte characters)
      expect(gunzipSync(api.objects.get(row.replay_path!)!).equals(text)).toBe(true);
      expect(row.replay).toBe(replayText(row.id)); // untouched
    }
    expect(rows[6]!.replay_path).toBe('no-owner/rt-7.json.gz');
    // a second run finds nothing to do
    expect((await backfill(api, { sleep: noSleep })).copied).toBe(0);
    // each replay was read alone, once
    expect(api.textReads).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('a ~6 MB replay is read alone, retried through statement timeouts, and still verified byte for byte', async () => {
    const big = JSON.stringify({ seed: 1, v2: { version: 2, frames: Array.from({ length: 40_000 }, (_, i) => ({ tMs: i, view: { s: 'é✓'.repeat(60) } })) } });
    expect(Buffer.byteLength(big)).toBeGreaterThan(5_000_000);
    const rows: Row[] = [{ id: 1, user_id: 'u', replay: big, replay_path: null, replay_sha256: null, replay_bytes: null },
      { id: 2, user_id: 'u', replay: replayText(2), replay_path: null, replay_sha256: null, replay_bytes: null }];
    const sleeps: number[] = [];
    const api = fakeApi(rows, { flaky: new Map([[1, 2]]) });
    const r = await backfill(api, { sleep: async (ms) => { sleeps.push(ms); } });
    expect(r.failed).toEqual([]);
    expect(r.copied).toBe(2);
    expect(sleeps).toEqual([1000, 2000]); // two timeouts, exponential backoff, then it landed
    expect(rows[0]!.replay_sha256).toBe(sha256Hex(Buffer.from(big, 'utf8')));
    expect(gunzipSync(api.objects.get('u/rt-1.json.gz')!).toString('utf8')).toBe(big);
  });

  it('a row that keeps timing out is left inline and reported; the run goes on', async () => {
    const rows: Row[] = [1, 2].map((id) => ({ id, user_id: 'u', replay: replayText(id), replay_path: null, replay_sha256: null, replay_bytes: null }));
    const r = await backfill(fakeApi(rows, { flaky: new Map([[1, 99]]) }), { sleep: noSleep });
    expect(r.failed.map((f) => f.id)).toEqual([1]);
    expect(r.failed[0]!.error).toMatch(/57014/);
    expect(rows[0]!.replay_path).toBeNull();
    expect(rows[1]!.replay_path).not.toBeNull();
  });

  it('withRetry: transient errors retry with backoff, a definite 4xx refusal does not', async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new Error('PATCH run_telemetry: 400 bad'); }, { sleep: noSleep })).rejects.toThrow(/400/);
    expect(n).toBe(1);
    n = 0;
    await expect(withRetry(async () => { n++; throw new Error('fetch failed'); }, { sleep: noSleep })).rejects.toThrow(/fetch failed/);
    expect(n).toBe(4);
    n = 0;
    expect(await withRetry(async () => { if (++n < 3) throw new Error('GET x: 503 busy'); return 'ok'; }, { sleep: noSleep })).toBe('ok');
  });

  it('a dry run writes nothing', async () => {
    const rows: Row[] = [{ id: 1, user_id: 'u', replay: replayText(1), replay_path: null, replay_sha256: null, replay_bytes: null }];
    const api = fakeApi(rows);
    const r = await backfill(api, { dryRun: true });
    expect(r.copied).toBe(1);
    expect(api.objects.size).toBe(0);
    expect(api.textReads).toEqual([]); // a dry run reads no replay at all
    expect(rows[0]!.replay_path).toBeNull();
  });

  it('an object that does not come back byte-identical is NOT marked (the row stays inline) and the run goes on', async () => {
    const rows: Row[] = [1, 2].map((id) => ({ id, user_id: 'u', replay: replayText(id), replay_path: null, replay_sha256: null, replay_bytes: null }));
    const api = fakeApi(rows, { corrupt: new Set([objectPathFor(1, 'u')]) });
    const r = await backfill(api, { sleep: noSleep });
    expect(r.failed.map((f) => f.id)).toEqual([1]);
    expect(rows[0]!.replay_path).toBeNull();
    expect(rows[1]!.replay_path).not.toBeNull();
  });

  it('restore writes a Storage-only replay back, checked against its sha256', async () => {
    const rows: Row[] = [1, 2].map((id) => ({ id, user_id: 'u', replay: replayText(id), replay_path: null, replay_sha256: null, replay_bytes: null }));
    const api = fakeApi(rows);
    await backfill(api, { sleep: noSleep });
    for (const r of rows) r.replay = null; // the lead's clear step ran
    rows[1]!.replay_sha256 = 'f'.repeat(64); // a proof that no longer matches
    const r = await restore(api, { sleep: noSleep });
    expect(r.restored).toBe(1);
    expect(r.failed.map((f) => f.id)).toEqual([2]);
    expect(JSON.parse(rows[0]!.replay!)).toEqual(JSON.parse(replayText(1)));
    expect(rows[1]!.replay).toBeNull();
  });
});
