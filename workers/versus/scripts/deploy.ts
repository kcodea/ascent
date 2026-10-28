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
 * Only the deployed URL lines of wrangler's output are echoed.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentRevision } from '@game/content';
import { VERSUS_CF_PROTOCOL } from '../src/protocol';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, '../../..');
const flag = (f: string): boolean => process.argv.includes(`--${f}`);
const test = flag('test');

export function versusWorkerName(rev = contentRevision(), isTest = false): string {
  return `ascent-versus${isTest ? '-test' : ''}-v${VERSUS_CF_PROTOCOL}-${rev}`;
}

function anonKey(): string {
  const env = readFileSync(join(root, 'apps/web/.env'), 'utf8');
  const m = /^VITE_SUPABASE_ANON_KEY=(.+)$/m.exec(env);
  if (!m) throw new Error('apps/web/.env has no VITE_SUPABASE_ANON_KEY');
  return m[1].trim();
}

const name = versusWorkerName(contentRevision(), test);
const args = [
  'wrangler', 'deploy', '--name', name,
  '--var', `SUPABASE_ANON_KEY:${anonKey()}`,
  '--var', `DEV_AUTH:${test ? '1' : '0'}`,
  '--var', `PERSIST:${!test && flag('persist') ? '1' : '0'}`,
  ...(flag('dry-run') ? ['--dry-run', '--outdir', 'dist'] : []),
];
console.log(`deploying ${name}${flag('dry-run') ? ' (dry run)' : ''}${test ? ' [TEST: dev tokens, no writes]' : ''}`);
const r = spawnSync('npx', args, { cwd: join(here, '..'), encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
const out = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
for (const line of out.split('\n')) {
  if (/https:\/\/\S+workers\.dev|Total Upload|Current Version ID|dry-run|ERROR|✘/i.test(line)) console.log(line.trim());
}
process.exit(r.status ?? 1);
