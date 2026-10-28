/**
 * `node workers/versus/scripts/writer-secret.mjs <worker-name>` — create the result writer's secret and give it to ONE
 * Worker, without the secret ever being printed or written to disk:
 *
 *   1. 32 random bytes (hex) are generated in memory;
 *   2. they are piped to `wrangler secret put VERSUS_WRITER_SECRET --name <worker-name>` on stdin;
 *   3. only their sha256 is printed, as the SQL line the lead runs once
 *      (`insert into public.versus_cf_writer_keys ...`, supabase/migrations/2026-11-04-versus-cf-writer.sql).
 *
 * Re-running rotates the key: insert the new hash, then delete the old row.
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const name = process.argv[2];
if (!name || !/^ascent-versus(-test)?-v\d+-[0-9a-f]+$/.test(name)) {
  console.error('usage: node writer-secret.mjs ascent-versus-v<cf>-<contentRevision>');
  process.exit(2);
}
const secret = randomBytes(32).toString('hex');
const r = spawnSync('npx', ['wrangler', 'secret', 'put', 'VERSUS_WRITER_SECRET', '--name', name], {
  cwd: fileURLToPath(new URL('..', import.meta.url)), input: `${secret}\n`, encoding: 'utf8', shell: process.platform === 'win32',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
if (r.status !== 0) {
  console.error('wrangler secret put failed');
  process.exit(r.status ?? 1);
}
const hash = createHash('sha256').update(secret).digest('hex');
console.log(`VERSUS_WRITER_SECRET set on ${name}. Run once on Supabase:`);
console.log(`insert into public.versus_cf_writer_keys (key_hash, note) values ('${hash}', '${name}');`);
