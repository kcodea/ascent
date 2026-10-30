/**
 * VERSUS CHAOS HARNESS: THE RECORDS DATABASE (PGlite + every Versus migration), where a Cloudflare room's results land.
 *
 * The room's only write path into Supabase is the key-gated result writer (`versus_cf_persist`, R-VERSUS-CF-PERSIST-01).
 * `versusCfParity.db.test.ts` runs the jobs a harness room queued through the REAL writer on this database, so a result
 * that the SQL would refuse fails here, not on the live project. The schema is the Versus migrations in the order they
 * were written (the tables the writer fills were created by the original Supabase-hosted Versus, 2026-10-13 onward).
 */
import { PGlite } from '@electric-sql/pglite';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../../../../..');

/** The Versus migrations, in the order they were written (the `rankedDuosParty.db.test.ts` list plus the ready signal
 *  and the test-bots table). */
const BASE_MIGRATIONS = [
  '2026-10-13-versus.sql', '2026-10-14-versus-shop-start.sql', '2026-10-14-versus-scout.sql', '2026-10-14-versus-ready-pause.sql',
  '2026-10-15-versus-hero-reroll.sql', '2026-10-16-versus-clock-grace.sql', '2026-10-17-versus-open-rooms.sql',
  '2026-10-24-versus-group.sql', '2026-10-24-versus-group-knockout-stands.sql',
  '2026-10-25-versus-duos.sql', '2026-10-25-versus-duos-edges.sql', '2026-10-25-versus-duos-random-order.sql',
  '2026-10-25-versus-duos-pass-back.sql', '2026-10-25-versus-test-bots.sql', '2026-10-26-versus-lock-order.sql', '2026-10-27-versus-egress.sql',
  '2026-10-28-versus-health.sql', '2026-10-15-lobby-live.sql', '2026-10-26-lobby-live-hero-select.sql', '2026-10-28-friends.sql',
  '2026-10-29-ranked-duos.sql', '2026-10-30-ranked-duos-client.sql', '2026-10-31-ranked-duos-live-fixes.sql',
  '2026-11-01-ranked-duos-party.sql', '2026-11-01-versus-ready-signal.sql',
];

/**
 * Every migration applied: the base list, then ANY newer Versus / Ranked Duos migration by file order (a fix branch's
 * new migration is picked up with no edit here). Skipped: pg_cron files and the Supabase host's retirement (an extension
 * PGlite lacks), the progression / XP files (other schemas) and the Cloudflare room's result writer (`versus-cf-*`: needs
 * pgcrypto; the caller applies it after a pgcrypto stand-in).
 */
export function versusMigrationFiles(): string[] {
  const dir = join(root, 'supabase/migrations');
  const newest = [...BASE_MIGRATIONS].sort().at(-1)!;
  const later = readdirSync(dir)
    .filter((f) => f.endsWith('.sql') && f > newest && !BASE_MIGRATIONS.includes(f) && /versus|ranked-duos/.test(f) && !/cron|retire|progression|-xp|versus-cf/.test(f))
    .sort();
  return [...BASE_MIGRATIONS, ...later];
}

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
  create table auth.users (id uuid primary key, is_anonymous boolean not null default false);
  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase's own default: every new public table is granted to the API roles, and RLS decides the rows. Without it a
  -- table with a select policy but no explicit grant (versus_group_teams, versus_duos_passes) refused every read here,
  -- so a Ranked Duos client never saw its recorded teams (found by versusCfParity.db.test.ts).
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant select on auth.users to authenticated;
  create table if not exists public.progression_results (user_id uuid not null, run_id text not null, mode text not null, primary key (user_id, run_id, mode));
  create table public.profiles (user_id uuid primary key, author text, discriminator text, avatar text, favorite_hero text);
  grant select on public.profiles to anon, authenticated;
  create table public.cosmetic_loadouts (user_id uuid, slot text, target_id text not null default '', cosmetic_id text, primary key (user_id, slot, target_id));
  grant select on public.cosmetic_loadouts to anon, authenticated;
`;

/** A fresh database with every Versus migration applied (the writer files are the caller's: they need pgcrypto). */
export async function bootVersusRecordsDb(): Promise<PGlite> {
  // The wasm and the filesystem bundle are handed in from disk: under jsdom PGlite would try to fetch() them.
  const dist = join(root, 'node_modules/@electric-sql/pglite/dist');
  const bytes = (f: string): Uint8Array => new Uint8Array(readFileSync(join(dist, f)));
  // Node's Blob / File while PGlite starts (jsdom's have no arrayBuffer(), and initdb hands its data dir over as one).
  const g = globalThis as unknown as { Blob: unknown; File: unknown };
  const saved = { Blob: g.Blob, File: g.File };
  g.Blob = NodeBlob;
  g.File = NodeFile;
  let db: PGlite;
  try {
    db = await PGlite.create({
      pgliteWasmModule: await WebAssembly.compile(bytes('pglite.wasm') as unknown as BufferSource),
      initdbWasmModule: await WebAssembly.compile(bytes('initdb.wasm') as unknown as BufferSource),
      fsBundle: new NodeBlob([bytes('pglite.data')]),
    } as never);
  } finally {
    g.Blob = saved.Blob;
    g.File = saved.File;
  }
  await db.exec("set timezone = 'UTC'");
  await db.exec(STUB);
  for (const f of versusMigrationFiles()) {
    try {
      await db.exec(readFileSync(join(root, 'supabase/migrations', f), 'utf8'));
    } catch (e) {
      throw new Error(`records db: migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return db;
}
