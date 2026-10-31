/**
 * `npm run hub:deploy -- [--dry-run] [--force] [--persist]` — deploy THE FRIENDS HUB Worker (`ascent-hub`, one stable
 * Worker for every build; owner 2026-10-29). Needs CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (never printed).
 *
 * ONLY WHEN ITS CODE CHANGED: the hub's source hash (`hubCodeHash`: `src/hubWorker.ts` and every file it imports,
 * relatively and transitively, plus `hub.wrangler.toml`) is stamped on the Worker as `HUB_CODE` and answered by
 * `/health`. When the live hub already carries this hash, nothing is deployed (`--force` deploys anyway). A content
 * change never touches the hub; a hub change never touches the Versus Workers.
 *
 *   --persist  store messages (only after supabase/migrations/2026-11-12-direct-messages.sql is applied and
 *              `node scripts/writer-secret.mjs ascent-hub` has set HUB_WRITER_SECRET and its key row is inserted).
 *   --dry-run  bundle and check only; nothing is uploaded.
 *   --session on|off  THE GAME SESSION SWITCH (R-SESSION-CF-01): new lobby / Practice games use the session (on) or the
 *              old path (off). Without it the live hub's current setting is KEPT (read from `/session/config`), so a
 *              routine pack never flips it; a hub that does not answer counts as off. Changing it deploys even when the
 *              code is unchanged.
 *
 * Prints `hub: deployed <url> <hash>` or `hub: unchanged <url> <hash>` (the release script reads it), plus wrangler's URL
 * and version lines only. `VERSUS_CF_ENV_FILE` points at another apps/web/.env (the release worktree's).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRIENDS_HUB_LIVE_URL, HUB_HEALTH_PATH } from '../src/hubProtocol';

const here = fileURLToPath(new URL('.', import.meta.url));
const workerDir = join(here, '..');
const root = join(workerDir, '../..');

/** The hub's sources: the entry, everything it imports relatively (transitively), and its wrangler config. */
export function hubSources(entry = join(workerDir, 'src/hubWorker.ts')): string[] {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bfrom\s+'(\.{1,2}\/[^']+)'/g)) {
      const base = resolve(dirname(file), m[1]!);
      const next = [`${base}.ts`, join(base, 'index.ts')].find((f) => existsSync(f));
      if (next) walk(next);
    }
  };
  walk(entry);
  return [...seen, join(workerDir, 'hub.wrangler.toml')].sort();
}

/** sha256 over the hub's sources (paths relative to the worker folder, then contents; line endings normalised). */
export function hubCodeHash(files: string[] = hubSources()): string {
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f.slice(workerDir.length).replace(/\\/g, '/'));
    h.update('\0');
    h.update(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
    h.update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

/** The live hub's session switch ('on' / 'off'), or null when it does not answer (an older hub: off). */
async function liveSession(): Promise<'on' | 'off' | null> {
  try {
    const res = await fetch(`${FRIENDS_HUB_LIVE_URL}/session/config`);
    if (!res.ok) return null;
    return ((await res.json()) as { enabled?: unknown }).enabled === true ? 'on' : 'off';
  } catch {
    return null;
  }
}

async function liveHash(): Promise<string | null> {
  try {
    const res = await fetch(`${FRIENDS_HUB_LIVE_URL}${HUB_HEALTH_PATH}`);
    if (!res.ok) return null;
    return String(((await res.json()) as { code?: unknown }).code ?? '') || null;
  } catch {
    return null;
  }
}

function anonKey(): string {
  const env = readFileSync(process.env.VERSUS_CF_ENV_FILE ?? join(root, 'apps/web/.env'), 'utf8');
  const m = /^VITE_SUPABASE_ANON_KEY=(.+)$/m.exec(env);
  if (!m) throw new Error('apps/web/.env has no VITE_SUPABASE_ANON_KEY');
  return m[1]!.trim();
}

async function main(): Promise<void> {
  const flag = (f: string): boolean => process.argv.includes(`--${f}`);
  const hash = hubCodeHash();
  const dry = flag('dry-run');
  const at = process.argv.indexOf('--session');
  const asked = at >= 0 ? process.argv[at + 1] : undefined;
  if (asked !== undefined && asked !== 'on' && asked !== 'off') { console.error('--session takes on or off'); process.exit(2); }
  const current = await liveSession();
  const session = asked ?? current ?? 'off';
  if (!dry && !flag('force') && session === (current ?? 'off') && (await liveHash()) === hash) {
    console.log(`hub: unchanged ${FRIENDS_HUB_LIVE_URL} ${hash} (session ${session})`);
    return;
  }
  const origins = process.env.VERSUS_ALLOWED_ORIGINS?.trim();
  const args = [
    'wrangler', 'deploy', '--config', 'hub.wrangler.toml',
    '--var', `SUPABASE_ANON_KEY:${anonKey()}`,
    '--var', 'DEV_AUTH:0',
    '--var', `PERSIST:${flag('persist') ? '1' : '0'}`,
    '--var', `HUB_CODE:${hash}`,
    '--var', `SESSION_MODE:${session}`,
    ...(origins ? ['--var', `ALLOWED_ORIGINS:${origins}`] : []),
    ...(dry ? ['--dry-run', '--outdir', 'dist-hub'] : []),
  ];
  console.log(`deploying ascent-hub ${hash} (session ${session})${dry ? ' (dry run)' : ''}`);
  const r = spawnSync('npx', args, { cwd: workerDir, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
  const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  for (const line of out.split('\n')) {
    if (/https:\/\/\S+workers\.dev|Total Upload|Current Version ID|dry-run|ERROR|✘/i.test(line)) console.log(line.trim());
  }
  if (r.status !== 0) process.exit(r.status ?? 1);
  if (!dry) console.log(`hub: deployed ${FRIENDS_HUB_LIVE_URL} ${hash}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) void main();
