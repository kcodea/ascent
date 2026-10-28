/**
 * `npm run replays:backfill [-- --dry-run] [-- --max N] [-- --restore]` — see backfill.ts.
 *
 * Needs the SERVICE-ROLE key (it reads every row and writes the copy proof): `SUPABASE_SERVICE_ROLE_KEY` in the process
 * env or the UNTRACKED repo-root `.env` (the same place `npm run bugs` reads it; never commit it). The URL comes from
 * the committed `apps/web/.env`. Run it after supabase/migrations/2026-11-07-replays-storage.sql is applied.
 */
import { resolveSupabaseConfig } from '../bug-inbox.lib';
import { BUCKET, backfill, restore, type Api } from './backfill';

const args = process.argv.slice(2);
const flag = (f: string): boolean => args.includes(f);
const num = (f: string): number | undefined => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : undefined; };

const cfg = resolveSupabaseConfig();
const headers = { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` };

async function rest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method,
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path.slice(0, 80)}: ${res.status} ${await res.text()}`);
  return (method === 'GET' ? await res.json() : null) as T;
}

const api: Api = {
  // The id list never reads the replay column; each replay is then read ALONE (`replay::text`, the exact text the clear
  // step re-hashes): five at once ran past PostgREST's 8 s statement timeout on 2026-10-28.
  pendingIds: (after, limit) => rest('GET', `run_telemetry?select=id,user_id&replay=not.is.null&replay_path=is.null&id=gt.${after}&order=id.asc&limit=${limit}`),
  async replayText(id) {
    const rows = await rest<Array<{ replay_text: string | null }>>('GET', `run_telemetry?select=replay_text:replay::text&id=eq.${id}&replay_path=is.null&limit=1`);
    return rows[0]?.replay_text ?? null;
  },
  storedOnlyRows: (after, limit) => rest('GET', `run_telemetry?select=id,replay_path,replay_sha256&replay=is.null&replay_path=not.is.null&id=gt.${after}&order=id.asc&limit=${limit}`),
  async upload(path, body) {
    const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/gzip', 'x-upsert': 'true' }, body: Buffer.from(body),
    });
    if (!res.ok) throw new Error(`upload ${path}: ${res.status} ${await res.text()}`);
  },
  async download(path) {
    const res = await fetch(`${cfg.url}/storage/v1/object/authenticated/${BUCKET}/${path}`, { headers });
    if (!res.ok) throw new Error(`download ${path}: ${res.status} ${await res.text()}`);
    return new Uint8Array(await res.arrayBuffer());
  },
  markCopied: (id, proof) => rest('PATCH', `run_telemetry?id=eq.${id}&replay_path=is.null`, proof),
  restoreReplay: (id, replay) => rest('PATCH', `run_telemetry?id=eq.${id}&replay=is.null`, { replay }),
};

const log = (s: string): void => console.log(s);
if (flag('--restore')) {
  const r = await restore(api, { log });
  console.log(`restored ${r.restored}, failed ${r.failed.length}`);
  if (r.failed.length) process.exitCode = 1;
} else {
  const max = num('--max');
  const r = await backfill(api, { dryRun: flag('--dry-run'), ...(max != null ? { maxRows: max } : {}), log });
  const mb = (b: number): string => `${(b / 1024 / 1024).toFixed(1)} MB`;
  console.log(flag('--dry-run')
    ? `would copy ${r.copied} rows (a dry run lists ids only and reads no replay)`
    : `copied + verified ${r.copied} rows (${mb(r.bytes)} of replay text, ${mb(r.gzBytes)} stored), failed ${r.failed.length}`);
  if (r.failed.length) { console.log(r.failed); process.exitCode = 1; }
  if (!flag('--dry-run')) console.log('Next (lead): select * from maint.run_telemetry_replay_report(); then maint.run_telemetry_clear_copied_replays(\'CLEAR COPIED REPLAYS\') in batches.');
}
