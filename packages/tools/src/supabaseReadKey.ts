/**
 * The key a READ-ONLY dev tool sends to Supabase (security pass 2026-11-07, docs/design/2026-10-28-supabase-cleanup.md
 * S2). Since `supabase/migrations/2026-11-07-security-reads-need-session.sql` the large shared tables (boards,
 * run_telemetry, pool_runs, ...) answer only a session, so the bare public key no longer reads them. The tools use the
 * service-role key from the UNTRACKED repo-root `.env` (`SUPABASE_SERVICE_ROLE_KEY`, the same file `npm run bugs`
 * reads; never commit it) or the process env, and fall back to the public key (which still reads everything until that
 * migration is applied). Never signs in: a tool run must not mint an anonymous account.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function rootEnv(repoRoot: string): Record<string, string> {
  const path = join(repoRoot, '.env');
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8').split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
  );
}

/** The service-role key when one is configured, else `publicKey`. */
export function toolReadKey(publicKey: string, repoRoot = '.'): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || rootEnv(repoRoot).SUPABASE_SERVICE_ROLE_KEY || publicKey;
}
