// The tables the moderation migration touches (only the columns it reads or writes), under Supabase's default grants,
// for PGlite: moderation.db.test.ts. Not a copy of production; the columns and the constraints it relies on match it
// (profiles_handle from schema.sql, dm_reports from 2026-11-12-direct-messages.sql, duos_teams from
// 2026-10-29-ranked-duos.sql, versus_cf_writer_keys from 2026-11-04-versus-cf-writer.sql).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MODERATION_MIGRATION = fileURLToPath(new URL('../../../../supabase/migrations/2026-11-28-moderation.sql', import.meta.url));
export const readModerationMigration = (): string => readFileSync(MODERATION_MIGRATION, 'utf8');

export const MODERATION_STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create table auth.users (id uuid primary key);
  create table public.profiles (user_id uuid primary key, author text, discriminator text, games_played int not null default 0,
    updated_at timestamptz);
  create unique index profiles_handle on public.profiles (lower(author), discriminator) where author is not null and discriminator is not null;
  create table public.duos_teams (id uuid primary key default gen_random_uuid(), user_lo uuid not null, user_hi uuid not null,
    name text check (name is null or char_length(name) between 2 and 16), created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(), unique (user_lo, user_hi));
  create table public.direct_messages (id uuid primary key default gen_random_uuid(), sender uuid not null, recipient uuid not null,
    body text not null, client_id uuid, created_at timestamptz not null default now(), read_at timestamptz, reply_to uuid);
  create table public.dm_reports (id uuid primary key default gen_random_uuid(), reporter uuid not null, message_id uuid not null,
    sender uuid not null, body text not null, sent_at timestamptz not null, reason text not null default 'other',
    created_at timestamptz not null default now(), status text not null default 'open',
    constraint dm_reports_status check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
    constraint dm_reports_once unique (reporter, message_id));
  create table public.versus_cf_writer_keys (key_hash text primary key);
  -- The caller (friends__me in production reads auth.uid()); tests set it per transaction.
  create function public.friends__me() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
`;
