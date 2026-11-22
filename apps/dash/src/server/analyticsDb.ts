// The tables the analytics RPCs read (only the columns they touch), under Supabase's default grants, for PGlite: shared
// by analytics.db.test.ts and scripts/bench-analytics.mts. Not a copy of production; the columns match it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MIGRATION_PATH = fileURLToPath(new URL('../../../../supabase/migrations/2026-11-27-analytics-dashboard.sql', import.meta.url));
export const readMigration = (): string => readFileSync(MIGRATION_PATH, 'utf8');

export const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create table auth.users (id uuid primary key, created_at timestamptz not null default now(), is_anonymous boolean not null default false);
  create table public.profiles (user_id uuid primary key, author text);
  create table public.versus_test_bots (bot_user uuid primary key);
  create table public.run_history (id bigint generated always as identity primary key, user_id uuid not null, patch text, hero_id text,
    placement int, mode text, entry jsonb not null, created_at timestamptz not null default now());
  create table public.practice_games (id bigint generated always as identity primary key, user_id uuid, patch text, hero_id text not null,
    placement int, final_board jsonb, created_at timestamptz default now());
  create table public.versus_matches (id uuid primary key default gen_random_uuid(), phase text not null, p1_user uuid not null, p2_user uuid not null,
    p1_hero text, p2_hero text, winner_seat text, completed_at timestamptz);
  create table public.versus_group_matches (id uuid primary key default gen_random_uuid(), phase text not null, seat_count int not null,
    options jsonb not null default '{}', dev_forced boolean not null default false, completed_at timestamptz);
  create table public.versus_group_seats (match_id uuid not null, seat text not null, user_id uuid not null, hero text, placement int,
    primary key (match_id, seat));
  create table public.progression_results (user_id uuid not null, run_id text not null, mode text not null, placement int,
    settled_at timestamptz not null default now(), primary key (user_id, run_id, mode));
  create table public.rank_results (user_id uuid not null, run_id text not null, seed bigint, division_before int not null,
    created_at timestamptz not null default now(), primary key (user_id, run_id));
  create table public.run_telemetry (id bigint generated always as identity primary key, user_id uuid, patch text, hero_id text not null,
    hero_offer text[], source text, created_at timestamptz not null default now());
`;

/** The extra tables and columns the round-two RPCs read (supabase/migrations/2026-11-29-analytics-v2.sql). */
export const STUB_V2 = `
  alter table public.profiles add column rank_season int, add column rank_division int not null default 0,
    add column account_xp bigint not null default 0, add column account_level int not null default 1, add column equipped_title_id text;
  alter table public.rank_results add column season int not null default 3, add column applied_delta int not null default 0,
    add column promoted boolean not null default false, add column demoted boolean not null default false;
  alter table public.practice_games add column tp_active_ms text;
  create table public.friendships (user_a uuid not null, user_b uuid not null, requester uuid, status text not null,
    created_at timestamptz not null default now(), accepted_at timestamptz, primary key (user_a, user_b));
  create table public.duos_teams (id uuid primary key default gen_random_uuid(), user_lo uuid not null, user_hi uuid not null, name text,
    created_at timestamptz not null default now());
  create table public.friend_invites (id uuid primary key default gen_random_uuid(), from_user uuid not null, to_user uuid not null,
    kind text not null, target text not null default 'x', status text not null default 'pending', created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '1 hour', responded_at timestamptz);
  create table public.direct_messages (id bigint generated always as identity primary key, sender uuid not null, recipient uuid not null,
    body text not null, created_at timestamptz not null default now());
  create table public.player_presence (user_id uuid primary key, status text not null, mode text, updated_at timestamptz not null default now());
  create table public.spectate_presence (user_id uuid primary key, run_id text not null, at timestamptz not null);
  create table public.achievement_catalog (achievement_id text primary key, category text);
  create table public.achievement_completions (user_id uuid not null, achievement_id text not null, completed_at timestamptz not null default now(),
    primary key (user_id, achievement_id));
  create table public.cosmetic_catalog (cosmetic_id text primary key, category text not null);
  create table public.cosmetic_loadouts (user_id uuid not null, slot text not null, target_id text not null default '', cosmetic_id text not null,
    primary key (user_id, slot, target_id));
  create table public.client_crash_reports (id bigint generated always as identity primary key, user_id uuid, session_key text,
    last_step text, build text, payload jsonb, created_at timestamptz not null default now());
  create table public.bug_reports (id bigint generated always as identity primary key, status text, severity text, created_at timestamptz not null default now());
  create schema ops;
  create table ops.health_checks (run_id text, ts timestamptz not null default now(), source text, check_name text, status text, detail jsonb);
  create view ops.health_latest as select * from ops.health_checks;
  create view ops.health_status as select max(ts) as last_cron_at, false as cron_overdue, false as cron_failing, '{}'::text[] as failing_checks from ops.health_checks;
  create table ops.events (id bigserial primary key, at timestamptz not null default now(), source text not null, kind text not null, key text, detail jsonb);
  create table ops.retention_rules (rule text primary key, enabled boolean not null default true, keep_days int not null, batch_limit int not null,
    note text, last_checked_at timestamptz, last_dry_run boolean, last_candidates bigint, last_deleted bigint, last_ms int, last_error text,
    last_deleted_at timestamptz, total_deleted bigint not null default 0);
`;

export const readMigrationV2 = (): string =>
  readFileSync(fileURLToPath(new URL('../../../../supabase/migrations/2026-11-29-analytics-v2.sql', import.meta.url)), 'utf8');
