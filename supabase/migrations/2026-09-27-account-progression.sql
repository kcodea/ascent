-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION — Account Level, XP and the Alpha Tester title  (2026-09-27, MVP)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). The same block is appended to
-- schema.sql (the cumulative paste file); keep the two identical. Owner runbook: the devlog
-- docs/devlog/2026-09-27-account-progression-mvp.md (run this, deploy `submit-progression`, THEN set the epoch).
--
-- WHAT THIS IS. Owner decisions 2026-09-27: a permanent, earn-only Account Level that grows with every completed
-- game and never touches the ranked ladder. Ranked 100 complete + 40 Top 4 + 60 first + 25 comeback; Practice
-- 60% of that (a flat 60 when the game has no meaningful placement, i.e. Unlimited Health); the first Learn
-- Ascent completion 250 once. Curve: 250 per level 1→11, 400 per level 11→26, 500 after. LIFETIME XP is
-- stored, the level is derived and cached. The MVP's only reward: the "Alpha Tester" title, which EVERY account
-- unlocks at Level 2 (auto-equipped when no title is equipped). No crates, cosmetics or achievements yet; the
-- ledger keeps their columns so they can land without a migration of this table.
--
-- THE RULES LIVE IN THREE PLACES that must agree: `settle_progression` below (the WRITER, the only thing that
-- moves XP), packages/progression/src/rules.ts (the client) and its GENERATED Deno copy
-- supabase/functions/_shared/progressionRules.ts (the Edge Function's runtime parity check). CI reads the
-- constants out of THIS file and compares (packages/progression/src/sqlParity.test.ts). Change all three
-- together; bump c_rules / PROGRESSION_RULES_VERSION when an old client would mis-show the result.
--
-- NO RETROACTIVE XP. Nothing is awarded until the owner sets `progression_config.epoch` (section 8 at the bottom
-- is the switch), and a ranked or practice game finished BEFORE the epoch is refused (`before_epoch`). The
-- client probes the epoch and shows nothing, queues nothing, while it is null, so shipping the client before
-- this runs is safe.
--
-- ANONYMOUS PLAYERS EARN XP (owner 2026-09-27): an anonymous Supabase session is a real `auth.users` id, and the
-- magic-link upgrade keeps that id, so progress carries over automatically. No session at all = no XP.

-- ── 1. The switch: the progression epoch ──────────────────────────────────────────────────────────────────
-- One row. `epoch` null = progression is OFF (the client shows nothing; `settle_progression` refuses with
-- `progression_disabled`). Set it ONCE, after `submit-progression` is deployed (runbook step 7).
create table if not exists public.progression_config (
  id         int primary key default 1 check (id = 1),
  epoch      timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.progression_config (id, epoch) values (1, null) on conflict (id) do nothing;
alter table public.progression_config enable row level security;
drop policy if exists "read progression_config" on public.progression_config;
create policy "read progression_config" on public.progression_config for select using (true);

-- ── 2. profiles: the progression columns ──────────────────────────────────────────────────────────────────
-- `account_xp` is LIFETIME XP and never goes down; `account_level` is a cache of the curve applied to it.
-- `progression_revision` is monotonic per account (+1 per settlement): the client adopts a server profile only
-- when its revision is not older than its mirror's. `equipped_title_id` is public (Career shows it).
alter table public.profiles add column if not exists account_xp                bigint not null default 0;
alter table public.profiles add column if not exists account_level             int    not null default 1;
alter table public.profiles add column if not exists progression_revision      bigint not null default 0;
alter table public.profiles add column if not exists progression_enrolled_at   timestamptz;
alter table public.profiles add column if not exists progression_curve_version int    not null default 1;
alter table public.profiles add column if not exists equipped_title_id         text;
alter table public.profiles drop constraint if exists profiles_account_xp_range;
alter table public.profiles add  constraint profiles_account_xp_range check (account_xp >= 0 and account_level >= 1);

-- A CLIENT can never write a progression column. Rather than re-stating the whole "update own profile" policy
-- (which pins every rank column and is owned by the medal-rank migration), a trigger refuses any insert that
-- carries non-default values and any update that changes them, when the statement runs as a client role. The
-- writer below runs SECURITY DEFINER (as the function owner), so it passes.
create or replace function public.profiles_progression_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.account_xp <> 0 or new.account_level <> 1 or new.progression_revision <> 0
       or new.progression_enrolled_at is not null or new.progression_curve_version <> 1 or new.equipped_title_id is not null then
      raise exception 'progression_columns_are_server_owned';
    end if;
  elsif new.account_xp is distinct from old.account_xp
     or new.account_level is distinct from old.account_level
     or new.progression_revision is distinct from old.progression_revision
     or new.progression_enrolled_at is distinct from old.progression_enrolled_at
     or new.progression_curve_version is distinct from old.progression_curve_version
     or new.equipped_title_id is distinct from old.equipped_title_id then
    raise exception 'progression_columns_are_server_owned';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_progression_guard on public.profiles;
create trigger profiles_progression_guard before insert or update on public.profiles
  for each row execute function public.profiles_progression_guard();

-- ── 3. progression_results: the immutable settlement ledger ───────────────────────────────────────────────
-- One row per (player, run, mode): the dedupe key AND the result the post-game screen animates. Written ONLY by
-- `settle_progression`. A player reads their own rows; nobody writes through the API. `crates_awarded`,
-- `achievement_xp` and `achievement_ids` stay 0 / empty in the MVP (reserved for the crate + achievement phases).
create table if not exists public.progression_results (
  user_id            uuid not null references auth.users(id) on delete cascade,
  run_id             text not null,
  mode               text not null check (mode in ('ranked', 'practice', 'tutorial')),
  source_id          text,
  rules_version      int  not null,
  curve_version      int  not null,
  facts_version      int,
  facts              jsonb,
  placement          int check (placement is null or placement between 1 and 8),
  comeback           boolean not null default false,
  base_xp            int  not null,
  top_four_xp        int  not null default 0,
  first_place_xp     int  not null default 0,
  comeback_xp        int  not null default 0,
  achievement_xp     int  not null default 0,
  total_xp           int  not null,
  xp_before          bigint not null,
  xp_after           bigint not null,
  level_before       int  not null,
  level_after        int  not null,
  revision_before    bigint not null,
  revision_after     bigint not null,
  crates_awarded     int  not null default 0,
  achievement_ids    text[] not null default '{}',
  unlocked_title_ids text[] not null default '{}',
  settled_at         timestamptz not null default now(),
  primary key (user_id, run_id, mode)
);
alter table public.progression_results enable row level security;
drop policy if exists "read own progression_results" on public.progression_results;
create policy "read own progression_results" on public.progression_results for select to authenticated using (auth.uid() = user_id);
create index if not exists progression_results_user_time on public.progression_results (user_id, settled_at desc);

-- Immutable even for the service role: a settled row is history.
create or replace function public.progression_results_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'progression_results_are_immutable';
end;
$$;
drop trigger if exists progression_results_immutable on public.progression_results;
create trigger progression_results_immutable before update on public.progression_results
  for each row execute function public.progression_results_immutable();

-- ── 4. player_titles: owned titles (public) ───────────────────────────────────────────────────────────────
-- The catalog of titles is client content (packages/progression TITLES); this table is ownership. Public read
-- (a Career shows a player's title); written only by `settle_progression`.
create table if not exists public.player_titles (
  user_id     uuid not null references auth.users(id) on delete cascade,
  title_id    text not null,
  unlocked_at timestamptz not null default now(),
  source      text not null,
  source_id   text,
  primary key (user_id, title_id)
);
alter table public.player_titles enable row level security;
drop policy if exists "read player_titles" on public.player_titles;
create policy "read player_titles" on public.player_titles for select using (true);

-- ── 5. tutorial_progression_claims: one Learn Ascent award per account per course version ─────────────────
create table if not exists public.tutorial_progression_claims (
  user_id        uuid not null references auth.users(id) on delete cascade,
  course_id      text not null,
  course_version int  not null,
  xp_awarded     int  not null,
  claimed_at     timestamptz not null default now(),
  primary key (user_id, course_id, course_version)
);
alter table public.tutorial_progression_claims enable row level security;
drop policy if exists "read own tutorial_progression_claims" on public.tutorial_progression_claims;
create policy "read own tutorial_progression_claims" on public.tutorial_progression_claims for select to authenticated using (auth.uid() = user_id);

-- ── 6. The curve, the JSON shapes, and THE writer ─────────────────────────────────────────────────────────
-- The curve, closed form (mirror of `levelOfXp` in packages/progression/src/rules.ts): 250 per level for levels
-- 1 to 10, 400 for 11 to 25, 500 from 26. Level 11 begins at 2500 XP, Level 26 at 8500.
create or replace function public.progression_level_of(p_xp bigint)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  c_band1_xp  constant int := 250;
  c_band1_top constant int := 10;
  c_band2_xp  constant int := 400;
  c_band2_top constant int := 25;
  c_band3_xp  constant int := 500;
  v bigint;
begin
  if p_xp is null or p_xp < 0 then return 1; end if;
  if p_xp < c_band1_top * c_band1_xp then return (1 + p_xp / c_band1_xp)::int; end if;
  v := p_xp - c_band1_top * c_band1_xp;
  if v < (c_band2_top - c_band1_top) * c_band2_xp then return (c_band1_top + 1 + v / c_band2_xp)::int; end if;
  v := v - (c_band2_top - c_band1_top) * c_band2_xp;
  return (c_band2_top + 1 + v / c_band3_xp)::int;
end;
$$;

-- MUST match `ProgressionResult` in packages/progression/src/rules.ts key for key.
create or replace function public.progression_result_json(r public.progression_results)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'runId', r.run_id, 'mode', r.mode, 'rulesVersion', r.rules_version,
    'placement', r.placement, 'comeback', r.comeback,
    'xp', jsonb_build_object('base', r.base_xp, 'topFour', r.top_four_xp, 'firstPlace', r.first_place_xp, 'comeback', r.comeback_xp, 'total', r.total_xp),
    'before', jsonb_build_object('lifetimeXp', r.xp_before, 'level', r.level_before),
    'after',  jsonb_build_object('lifetimeXp', r.xp_after,  'level', r.level_after),
    'unlockedTitles', to_jsonb(r.unlocked_title_ids),
    'revisionAfter', r.revision_after,
    'settledAt', r.settled_at
  );
$$;

-- MUST match `ProgressionProfile` in packages/progression/src/rules.ts key for key.
create or replace function public.progression_profile_json(p_user uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'accountXp', p.account_xp, 'accountLevel', p.account_level, 'revision', p.progression_revision,
    'equippedTitleId', p.equipped_title_id,
    'titles', coalesce((select jsonb_agg(t.title_id order by t.unlocked_at) from public.player_titles t where t.user_id = p.user_id), '[]'::jsonb)
  )
  from public.profiles p where p.user_id = p_user;
$$;

-- settle_progression — THE writer. Service role only (called by the `submit-progression` Edge Function).
-- Order (handoff §8.4, MVP): validate → per-user advisory lock + profile row lock → ledger check under the lock
-- (a duplicate returns the ORIGINAL result, no second award) → the epoch switch → rate limit (raise → nothing
-- committed; the client retries later, valid XP is delayed, never reduced) → the SOURCE row (the placement is
-- read from it, never from the request) → XP → levels → title → profile + revision + immutable ledger row.
-- Any `raise` rolls everything back.
--
-- The comeback bonus is a client-derived fact (a win right after 4+ consecutive combat losses, once per run).
-- It is sanity-checked here against the run's recorded record where one exists (4+ losses and 1+ win), and the
-- client's fact document is stored with the row for audit.
create or replace function public.settle_progression(
  p_user uuid, p_mode text, p_run_id text, p_source_id bigint default null, p_comeback boolean default false,
  p_rules_version int default null, p_facts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of XP_RULES / CURVE in packages/progression/src/rules.ts — change all copies together)
  c_rules             constant int := 1;
  c_curve             constant int := 1;
  c_complete          constant int := 100;
  c_top_four          constant int := 40;
  c_first_place       constant int := 60;
  c_comeback          constant int := 25;
  c_comeback_streak   constant int := 4;
  c_practice_percent  constant int := 60;
  c_practice_flat     constant int := 60;
  c_tutorial          constant int := 250;
  c_tutorial_course   constant text := 'learn-ascent';
  c_tutorial_version  constant int := 1;
  c_alpha_title       constant text := 'alpha_tester';
  c_alpha_level       constant int := 2;
  c_rate_max          constant int := 30;
  c_rate_window       constant interval := interval '10 minutes';

  prof        public.profiles%rowtype;
  prev        public.progression_results%rowtype;
  v_epoch     timestamptz;
  v_recent    int;
  v_source_at timestamptz;
  v_source    text := null;
  v_placement int := null;
  v_comeback  boolean := false;
  v_seed      bigint;
  v_cfg       jsonb;
  v_record    jsonb;
  v_wins      int;
  v_losses    int;
  r_top int := 0; r_first int := 0; r_come int := 0; v_ranked_total int;
  v_base int := 0; v_top int := 0; v_first int := 0; v_come int := 0; v_total int;
  v_xp0 bigint; v_xp1 bigint; v_l0 int; v_l1 int;
  v_unlocked  text[] := '{}';
  v_equipped  text;
  v_rows      int;
  v_facts_ver int := null;
begin
  -- 1. validate
  if p_mode is null or p_mode not in ('ranked', 'practice', 'tutorial') then raise exception 'bad_mode'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. serialize per user (every progression entry point takes the advisory lock first), then lock the row
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.progression_results where user_id = p_user and run_id = p_run_id and mode = p_mode;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
  end if;

  -- 4. the switch: nothing is awarded before the owner sets the epoch
  select epoch into v_epoch from public.progression_config where id = 1;
  if v_epoch is null then raise exception 'progression_disabled'; end if;

  -- 5. rate limit (technical only: a refused request is retried later and keeps its XP)
  select count(*) into v_recent from public.progression_results
    where user_id = p_user and settled_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 6. the SOURCE row: the placement comes from here, never from the request
  if p_mode = 'ranked' then
    select rr.placement, rr.seed, rr.created_at into v_placement, v_seed, v_source_at
      from public.rank_results rr where rr.user_id = p_user and rr.run_id = p_run_id;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_run_id;
    v_comeback := coalesce(p_comeback, false);
    if v_comeback and v_seed is not null then
      select h.wins, case when (h.entry->>'losses') ~ '^[0-9]+$' then (h.entry->>'losses')::int end
        into v_wins, v_losses
        from public.run_history h
        where h.user_id = p_user and h.mode = 'lobby' and h.entry->>'seed' = v_seed::text
        order by h.created_at desc limit 1;
      if found and (coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1) then v_comeback := false; end if;
    end if;
  elsif p_mode = 'practice' then
    if p_source_id is null or p_source_id < 1 then raise exception 'bad_source'; end if;
    if p_run_id is distinct from ('practice:' || p_source_id::text) then raise exception 'bad_run_id'; end if;
    select pg.placement, pg.config, pg.record, pg.created_at into v_placement, v_cfg, v_record, v_source_at
      from public.practice_games pg where pg.id = p_source_id and pg.user_id = p_user;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_source_id::text;
    -- No meaningful placement: an Unlimited Health game plays to the curtain and is never eliminated (and a row
    -- with no options recorded is treated the same way). It earns the flat XP, no placement or comeback bonus.
    if v_cfg is null or coalesce(v_cfg->>'health', 'unlimited') <> 'normal'
       or v_placement is null or v_placement < 1 or v_placement > 8 then
      v_placement := null;
    end if;
    v_comeback := coalesce(p_comeback, false) and v_placement is not null;
    if v_comeback and v_record is not null then
      v_wins := case when (v_record->>'wins') ~ '^[0-9]+$' then (v_record->>'wins')::int end;
      v_losses := case when (v_record->>'losses') ~ '^[0-9]+$' then (v_record->>'losses')::int end;
      if coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1 then v_comeback := false; end if;
    end if;
  else
    -- tutorial: one claim per account per course version (the ledger check above already caught a repeat)
    if p_run_id is distinct from (c_tutorial_course || ':v' || c_tutorial_version::text) then raise exception 'bad_run_id'; end if;
    insert into public.tutorial_progression_claims (user_id, course_id, course_version, xp_awarded)
      values (p_user, c_tutorial_course, c_tutorial_version, c_tutorial)
      on conflict (user_id, course_id, course_version) do nothing;
    v_source := c_tutorial_course || ':' || c_tutorial_version::text;
  end if;

  -- 7. XP (mirror of xpForSettlement)
  if p_mode = 'tutorial' then
    v_base := c_tutorial;
  elsif p_mode = 'practice' and v_placement is null then
    v_base := c_practice_flat;
  else
    r_top   := case when v_placement <= 4 then c_top_four else 0 end;
    r_first := case when v_placement = 1 then c_first_place else 0 end;
    r_come  := case when v_comeback then c_comeback else 0 end;
    if p_mode = 'ranked' then
      v_base := c_complete; v_top := r_top; v_first := r_first; v_come := r_come;
    else
      -- Practice: 60% of the equivalent ranked XP, summed then rounded; the remainder lands on the base.
      v_ranked_total := c_complete + r_top + r_first + r_come;
      v_top   := (r_top   * c_practice_percent + 50) / 100;
      v_first := (r_first * c_practice_percent + 50) / 100;
      v_come  := (r_come  * c_practice_percent + 50) / 100;
      v_base  := (v_ranked_total * c_practice_percent + 50) / 100 - v_top - v_first - v_come;
    end if;
  end if;
  v_total := v_base + v_top + v_first + v_come;

  -- 8. levels (lifetime XP; the level is derived)
  v_xp0 := coalesce(prof.account_xp, 0);
  v_xp1 := v_xp0 + v_total;
  v_l0 := public.progression_level_of(v_xp0);
  v_l1 := public.progression_level_of(v_xp1);

  -- 9. titles: Alpha Tester for EVERY account at Level 2 (owner 2026-09-27); equipped when nothing else is
  if v_l1 >= c_alpha_level then
    insert into public.player_titles (user_id, title_id, source, source_id)
      values (p_user, c_alpha_title, 'level', p_mode || ':' || p_run_id)
      on conflict (user_id, title_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_unlocked := array_append(v_unlocked, c_alpha_title); end if;
  end if;
  v_equipped := prof.equipped_title_id;
  if v_equipped is null and exists (select 1 from public.player_titles t where t.user_id = p_user and t.title_id = c_alpha_title) then
    v_equipped := c_alpha_title;
  end if;

  -- 10. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    account_xp = v_xp1, account_level = v_l1,
    progression_revision = prof.progression_revision + 1,
    progression_enrolled_at = coalesce(prof.progression_enrolled_at, now()),
    progression_curve_version = c_curve,
    equipped_title_id = v_equipped,
    updated_at = now()
  where user_id = p_user;

  if p_facts is not null and jsonb_typeof(p_facts) = 'object' and (p_facts->>'version') ~ '^[0-9]+$' then
    v_facts_ver := (p_facts->>'version')::int;
  end if;

  insert into public.progression_results (
    user_id, run_id, mode, source_id, rules_version, curve_version, facts_version, facts,
    placement, comeback, base_xp, top_four_xp, first_place_xp, comeback_xp, achievement_xp, total_xp,
    xp_before, xp_after, level_before, level_after, revision_before, revision_after,
    crates_awarded, achievement_ids, unlocked_title_ids
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, 0, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    0, '{}', v_unlocked
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;

-- Service role ONLY. Functions are executable by PUBLIC by default: revoke that, then grant the one caller.
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;
revoke all on function public.progression_result_json(public.progression_results) from public, anon, authenticated;
grant execute on function public.progression_result_json(public.progression_results) to service_role;
revoke all on function public.progression_profile_json(uuid) from public, anon, authenticated;
grant execute on function public.progression_profile_json(uuid) to service_role;
-- The curve is harmless to expose (it is public in the client), but nothing needs it outside the writer.
revoke all on function public.progression_level_of(bigint) from public, anon, authenticated;
grant execute on function public.progression_level_of(bigint) to service_role;

-- ── 7. Level-based titles for accounts ALREADY at Level 2+ (idempotent) ───────────────────────────────────
-- The title is purely level-based, so the grant path above covers every settlement. This backfill covers any
-- account whose level was raised some other way (a hand-edit, a future curve change): it owns and, with
-- nothing equipped, wears Alpha Tester. A no-op on the first run (every account starts at Level 1).
insert into public.player_titles (user_id, title_id, source)
  select p.user_id, 'alpha_tester', 'level' from public.profiles p where p.account_level >= 2
  on conflict (user_id, title_id) do nothing;
update public.profiles p set equipped_title_id = 'alpha_tester', progression_revision = p.progression_revision + 1
  where p.account_level >= 2 and p.equipped_title_id is null;

-- ── 8. THE SWITCH (run by hand, ONCE, after `submit-progression` is deployed) ─────────────────────────────
-- Commented out so a re-run of this file can never move the epoch. Games finished before this moment never
-- earn XP (no retroactive backfill, owner 2026-09-27).
--
-- update public.progression_config set epoch = now(), updated_at = now() where id = 1 and epoch is null;
