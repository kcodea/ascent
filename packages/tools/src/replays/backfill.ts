/**
 * `npm run replays:backfill` — copy every inline `run_telemetry` replay into the private Storage bucket `replays`
 * (owner ruling 2026-10-28: "move to cheap storage, keep all"; supabase/migrations/2026-11-07-replays-storage.sql).
 *
 * Per row, oldest first, a few rows a page (a replay is up to ~5 MB of text):
 *  1. read the replay AS POSTGRES PRINTS IT (`replay::text`), the exact bytes the clear step re-hashes later;
 *  2. gzip it and upload to `<user_id>/rt-<id>.json.gz` (overwrite allowed, so a re-run after a crash is safe);
 *  3. download the object again and require it byte-identical to what was sent AND to gunzip back to the exact text;
 *  4. only then record the proof on the row: `replay_path`, `replay_sha256` (of the text), `replay_bytes`,
 *     `replay_copied_at`. The replay column itself is untouched: clearing it is the lead's separate SQL step
 *     (`maint.run_telemetry_clear_copied_replays`), which re-hashes the column and clears only on a match.
 * `restore` is the way back: for rows whose replay lives only in Storage, download, check the recorded sha256 and
 * write the replay back into the column.
 *
 * Pure over an injected `Api` (tests run it against an in-memory fake); cli.ts wires the real REST + Storage calls.
 */
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export const BUCKET = 'replays';

export interface Api {
  /** Rows with an inline replay and no copy yet, id > afterId, ascending, at most `limit`. */
  pendingRows(afterId: number, limit: number): Promise<Array<{ id: number; user_id: string | null; replay_text: string }>>;
  /** Rows whose replay lives only in Storage, id > afterId, ascending. */
  storedOnlyRows(afterId: number, limit: number): Promise<Array<{ id: number; replay_path: string; replay_sha256: string | null }>>;
  upload(path: string, body: Uint8Array): Promise<void>;
  download(path: string): Promise<Uint8Array>;
  /** Record the copy proof; must only touch a row still uncopied. */
  markCopied(id: number, proof: { replay_path: string; replay_sha256: string; replay_bytes: number; replay_copied_at: string }): Promise<void>;
  /** Write a replay back into the column (restore). */
  restoreReplay(id: number, replay: unknown): Promise<void>;
}

export const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');
export const objectPathFor = (id: number, userId: string | null): string => `${userId ?? 'no-owner'}/rt-${id}.json.gz`;

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

export interface BackfillReport { copied: number; failed: Array<{ id: number; error: string }>; bytes: number; gzBytes: number }

/** Copy (or, with `dryRun`, only count) every pending row. Never touches the `replay` column. */
export async function backfill(api: Api, opts: { pageSize?: number; maxRows?: number; dryRun?: boolean; log?: (s: string) => void } = {}): Promise<BackfillReport> {
  const page = opts.pageSize ?? 5;
  const log = opts.log ?? (() => {});
  const out: BackfillReport = { copied: 0, failed: [], bytes: 0, gzBytes: 0 };
  let after = 0;
  for (;;) {
    const rows = await api.pendingRows(after, page);
    if (rows.length === 0) break;
    for (const row of rows) {
      after = Math.max(after, row.id);
      if (opts.maxRows != null && out.copied + out.failed.length >= opts.maxRows) return out;
      const text = Buffer.from(row.replay_text, 'utf8');
      out.bytes += text.length;
      if (opts.dryRun) { out.copied++; continue; }
      try {
        const gz = gzipSync(text, { level: 9 });
        const path = objectPathFor(row.id, row.user_id);
        await api.upload(path, gz);
        const back = await api.download(path);
        if (!sameBytes(back, gz)) throw new Error('downloaded object differs from the upload');
        if (!sameBytes(gunzipSync(back), text)) throw new Error('object does not gunzip to the replay text');
        await api.markCopied(row.id, { replay_path: path, replay_sha256: sha256Hex(text), replay_bytes: text.length, replay_copied_at: new Date().toISOString() });
        out.copied++;
        out.gzBytes += gz.length;
        log(`row ${row.id}: ${text.length} B -> ${gz.length} B gz, verified, ${path}`);
      } catch (e) {
        out.failed.push({ id: row.id, error: (e as Error).message });
        log(`row ${row.id}: FAILED ${(e as Error).message} (left inline, retried on the next run)`);
      }
    }
  }
  return out;
}

/** The way back: write each Storage-only replay into its column again, after checking the recorded sha256. */
export async function restore(api: Api, opts: { pageSize?: number; log?: (s: string) => void } = {}): Promise<{ restored: number; failed: Array<{ id: number; error: string }> }> {
  const page = opts.pageSize ?? 5;
  const log = opts.log ?? (() => {});
  const out = { restored: 0, failed: [] as Array<{ id: number; error: string }> };
  let after = 0;
  for (;;) {
    const rows = await api.storedOnlyRows(after, page);
    if (rows.length === 0) break;
    for (const row of rows) {
      after = Math.max(after, row.id);
      try {
        const text = gunzipSync(await api.download(row.replay_path));
        if (row.replay_sha256 && sha256Hex(text) !== row.replay_sha256) throw new Error('object does not match the recorded sha256');
        await api.restoreReplay(row.id, JSON.parse(text.toString('utf8')));
        out.restored++;
        log(`row ${row.id}: restored from ${row.replay_path}`);
      } catch (e) {
        out.failed.push({ id: row.id, error: (e as Error).message });
        log(`row ${row.id}: FAILED ${(e as Error).message}`);
      }
    }
  }
  return out;
}
