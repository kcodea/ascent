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
