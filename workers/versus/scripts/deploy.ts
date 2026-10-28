/**
 * `npm run versus:cf:deploy -- [--dry-run] [--test] [--persist]` — deploy the Versus Worker (owner account; needs
 * CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment; neither is ever printed).
 *
 * VERSIONED: the Worker is named after the engine it carries, `ascent-versus-v<cfProtocol>-<contentRevision>`, so each
 * content revision is its own Worker with its own Durable Objects. Deploying a new pack never changes the code under a
 * room that is already playing: that room finishes on its version (owner ruling 2026-10-28). The game derives the same
 * name from its own content revision (`versusCfLiveUrl` in packages/ui/src/versus/versusCfRemote.ts).
 *
 *   --test     a throwaway TEST Worker (`ascent-versus-test-...`): dev tokens accepted, persistence off. For the live
 *              network measurement only; delete it after (`npx wrangler delete --name <name>`).
 *   --persist  turn the result writer on (only after supabase/migrations/2026-11-04-versus-cf-writer.sql is applied
 *              and scripts/writer-secret.mjs has set VERSUS_WRITER_SECRET on this Worker).
 *   --dry-run  bundle and check only; nothing is uploaded.
 *
 * ORIGINS: `ALLOWED_ORIGINS` defaults to wrangler.toml's list (the Netlify site + local dev). Set
 * `VERSUS_ALLOWED_ORIGINS` (comma-separated, same `*` rules) in the environment to deploy a different list, e.g. to add
 * a custom domain, with no code change. It is validated (https origins, or http on localhost / 127.0.0.1) and echoed.
 *
 * `VERSUS_CF_ENV_FILE` points at another apps/web/.env (the release worktree's); default: this checkout's.
 *
 * Only the deployed URL lines of wrangler's output are echoed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentRevision } from '@game/content';
import { VERSUS_CF_PROTOCOL } from '../src/protocol';
import { validOrigin } from '../src/origins';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '../../..');
const flag = (f: string): boolean => process.argv.includes(`--${f}`);
const test = flag('test');

export function versusWorkerName(rev = contentRevision(), isTest = false): string {
  return `ascent-versus${isTest ? '-test' : ''}-v${VERSUS_CF_PROTOCOL}-${rev}`;
}

function anonKey(): string {
  const env = readFileSync(process.env.VERSUS_CF_ENV_FILE ?? join(root, 'apps/web/.env'), 'utf8');
  const m = /^VITE_SUPABASE_ANON_KEY=(.+)$/m.exec(env);
  if (!m) throw new Error('apps/web/.env has no VITE_SUPABASE_ANON_KEY');
  return m[1].trim();
}

const origins = process.env.VERSUS_ALLOWED_ORIGINS?.trim();
if (origins) {
  const bad = origins.split(',').map((o) => o.trim()).filter((o) => !validOrigin(o));
  if (bad.length) { console.error(`VERSUS_ALLOWED_ORIGINS has invalid entries: ${bad.join(', ')}`); process.exit(1); }
  console.log(`allowed origins (from VERSUS_ALLOWED_ORIGINS): ${origins}`);
}

const name = versusWorkerName(contentRevision(), test);
const args = [
  'wrangler', 'deploy', '--name', name,
  '--var', `SUPABASE_ANON_KEY:${anonKey()}`,
  '--var', `DEV_AUTH:${test ? '1' : '0'}`,
  '--var', `PERSIST:${!test && flag('persist') ? '1' : '0'}`,
  ...(origins ? ['--var', `ALLOWED_ORIGINS:${origins}`] : []),
  ...(flag('dry-run') ? ['--dry-run', '--outdir', 'dist'] : []),
];
console.log(`deploying ${name}${flag('dry-run') ? ' (dry run)' : ''}${test ? ' [TEST: dev tokens, no writes]' : ''}`);
const r = spawnSync('npx', args, { cwd: join(here, '..'), encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
for (const line of out.split('\n')) {
  if (/https:\/\/\S+workers\.dev|Total Upload|Current Version ID|dry-run|ERROR|✘/i.test(line)) console.log(line.trim());
}
process.exit(r.status ?? 1);
