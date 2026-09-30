-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- GAUNTLET PROGRESS: stage clears on the account; the FIRST clear of each stage grants one crate  (2026-09-29)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-progression-crates.sql (it replaces functions from
-- that file); it can run before or after 2026-09-29-hero-titles.sql. Idempotent (safe to re-run). The same block is appended to schema.sql; keep the two identical. This file
-- REPLACES `loot_crates_transition_guard` and `progression_crate_json` (both from 2026-09-28-progression-crates.sql):
-- if the crates file is ever re-run, run this one again after it.
--
-- WHAT THIS IS (Gauntlet: a single-player run of 10 stages; spec docs/superpowers/specs/2026-09-29-gauntlet-design.md):
--  - `gauntlet_progress`: one row per (user, stage) the account has cleared. Stage N is unlocked iff stage N-1 has a
--    row (stage 1 always); there is no separate unlock flag. Owner-only read; clients never write.
--  - A GAUNTLET CRATE is an ordinary `loot_crates` row with NO level (`earned_level` null) and `source` =
--    'gauntlet:<stage>'. Level crates are unchanged: they keep `earned_level`, a null `source`, and the unique
--    (user, level) key the settlement's `on conflict` relies on (NULL levels never collide with it). Every crate has
--    a level OR a source, and an account holds at most one crate per source. `open_crate` opens both kinds alike.
--  - `record_gauntlet_clear(user, stage)` (service role only, called by the gauntlet Edge Function): the FIRST clear
--    of a stage records the row and grants one sealed crate in the same transaction (`first_clear` + the crate);
--    every later clear is a no-op (`already_cleared`, no crate). The server trusts the client's clear (owner
--    2026-09-29) and only validates the stage (an integer 1 to 10). It takes the settlement's per-user advisory lock.
--  - THE CRATES SWITCH (`progression_config.crates_enabled`) only gates OPENING (`open_crate`). A first clear ALWAYS
--    grants its crate, banked sealed while the switch is off, exactly like the settlement's level crates: gating the
--    grant would lose that stage's crate forever, since a replay never grants one.

-- ── 1. loot_crates: a crate may come from a source instead of a level ─────────────────────────────────────
alter table public.loot_crates alter column earned_level drop not null;
alter table public.loot_crates add column if not exists source text;
alter table public.loot_crates drop constraint if exists loot_crates_level_or_source;
alter table public.loot_crates add constraint loot_crates_level_or_source check (earned_level is not null or source is not null);
-- At most one crate per source per account (one per Gauntlet stage), behind `gauntlet_progress`'s own key.
create unique index if not exists loot_crates_one_per_source on public.loot_crates (user_id, source) where source is not null;

-- A crate goes sealed -> opened ONCE and is then history (even for the service role). `source` is identity too.
create or replace function public.loot_crates_transition_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.state = 'opened' then raise exception 'crate_already_opened'; end if;
  if new.crate_id is distinct from old.crate_id or new.user_id is distinct from old.user_id
     or new.earned_level is distinct from old.earned_level or new.earned_at is distinct from old.earned_at
     or new.source is distinct from old.source then
    raise exception 'crate_identity_is_immutable';
  end if;
  return new;
end;
$$;

-- MUST match `CrateRow` in packages/progression/src/cosmetics.ts key for key (`source` is null for a level crate).
create or replace function public.progression_crate_json(c public.loot_crates)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'crateId', c.crate_id, 'earnedLevel', c.earned_level, 'state', c.state,
    'rewardId', c.reward_cosmetic_id, 'earnedAt', c.earned_at, 'openedAt', c.opened_at,
    'source', c.source
  );
$$;

-- ── 2. gauntlet_progress: one row per cleared stage; owner-only read ──────────────────────────────────────
create table if not exists public.gauntlet_progress (
  user_id          uuid not null references auth.users(id) on delete cascade,
  stage            int  not null check (stage between 1 and 10),
  first_cleared_at timestamptz not null default now(),
  crate_granted    boolean not null default false,
  crate_id         uuid references public.loot_crates(crate_id),
  primary key (user_id, stage)
);
alter table public.gauntlet_progress enable row level security;
drop policy if exists "read own gauntlet_progress" on public.gauntlet_progress;
create policy "read own gauntlet_progress" on public.gauntlet_progress for select to authenticated using (auth.uid() = user_id);

-- ── 3. record_gauntlet_clear: THE clear transaction. Service role only. ─────────────────────────────────
-- Validate → the per-user advisory lock (the same one settlement and opening take) → the progress row, keyed
-- (a replay inserts nothing and answers `already_cleared`) → on a first clear, one sealed crate (always, whatever
-- the crates switch) linked from the progress row, all in this transaction.
create or replace function public.record_gauntlet_clear(p_user uuid, p_stage int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows    int;
  v_crate   public.loot_crates%rowtype;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if p_stage is null or p_stage < 1 or p_stage > 10 then raise exception 'bad_stage'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  insert into public.gauntlet_progress (user_id, stage) values (p_user, p_stage)
    on conflict (user_id, stage) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('status', 'already_cleared', 'crate', null);
  end if;

  insert into public.loot_crates (user_id, earned_level, source, source_id)
    values (p_user, null, 'gauntlet:' || p_stage, 'gauntlet:' || p_stage)
    returning * into v_crate;
  update public.gauntlet_progress set crate_granted = true, crate_id = v_crate.crate_id
    where user_id = p_user and stage = p_stage;

  return jsonb_build_object('status', 'first_clear', 'crate', public.progression_crate_json(v_crate));
end;
$$;

-- ── 4. Grants: service role only ─────────────────────────────────────────────────────────────────────────
revoke all on function public.record_gauntlet_clear(uuid, int) from public, anon, authenticated;
grant execute on function public.record_gauntlet_clear(uuid, int) to service_role;
