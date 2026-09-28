-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: level crates and the cosmetic catalog (15 crate titles)  (2026-09-28)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-27-account-progression.sql (it replaces that file's
-- `settle_progression`, so never re-run the 2026-09-27 file after this one). Idempotent (safe to re-run). The
-- same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-09-28-progression-crates.md.
--
-- WHAT THIS IS (owner 2026-09-27: "let's just do 15 titles to start"; handoff §5, §6.5 to §6.7, §14). Earn only.
--  - EVERY LEVEL GRANTS ONE SEALED CRATE; enrollment (an account's first settlement) grants the Level 1 Welcome
--    Crate. `settle_progression` creates them and records `crates_awarded` / `crate_ids` on the ledger row.
--  - THE REWARD IS CHOSEN WHEN THE CRATE IS OPENED (`open_crate`), weighted over the items still eligible
--    (rarity weight x category weight, normalized across what remains, never a rarity rolled first), NEVER a
--    duplicate. When nothing eligible is left the crate stays sealed (`pool_exhausted`), never converted.
--  - THE CATALOG is data: `cosmetic_categories` (weights + the per-category feature flag) and `cosmetic_catalog`
--    (one row per item), seeded from packages/progression/src/cosmetics.ts. Every handoff category exists; only
--    `title` is enabled. Ownership of every category is `player_cosmetics`; `player_titles` (the MVP table) is kept
--    as a mirror so older clients keep reading it.
--  - EQUIP goes through `equip_title`, which checks ownership. Clients never write ownership, crates or loadout.
--  - BACKFILL: accounts already enrolled get their Welcome Crate plus one crate per level already reached
--    (section 12; idempotent through the unique (user, level) key).
--
-- THE RULES LIVE IN TWO PLACES that must agree: this file and packages/progression/src (cosmetics.ts: catalog,
-- weights, roll; rules.ts: crates per level). CI parses this file and compares (sqlParity.test.ts) and runs it in
-- an embedded Postgres (crates.db.test.ts).

-- ── 1. The crates switch (UI only: crates are always earned and banked) ──────────────────────────────────────
-- The client shows crates and the Collection only while this is true, and `open_crate` refuses while it is false.
alter table public.progression_config add column if not exists crates_enabled boolean not null default true;

-- ── 2. cosmetic_categories: category weights + the per-category feature flag (handoff §5.3 / §5.4) ─────────
create table if not exists public.cosmetic_categories (
  category   text primary key,
  weight     int  not null check (weight >= 0),
  enabled    boolean not null default false,
  target     text not null check (target in ('global', 'hero', 'card')),
  updated_at timestamptz not null default now()
);
alter table public.cosmetic_categories enable row level security;
drop policy if exists "read cosmetic_categories" on public.cosmetic_categories;
create policy "read cosmetic_categories" on public.cosmetic_categories for select using (true);
-- MUST match COSMETIC_CATEGORY_DEFS in packages/progression/src/cosmetics.ts (enable a category in BOTH).
insert into public.cosmetic_categories (category, weight, enabled, target) values
  ('announcer', 10, false, 'global'),
  ('hero_skin', 20, false, 'hero'),
  ('minion_skin', 35, false, 'card'),
  ('title', 10, true, 'global'),
  ('hero_attack', 15, false, 'global'),
  ('board', 5, false, 'global'),
  ('music', 5, false, 'global')
on conflict (category) do update set weight = excluded.weight, enabled = excluded.enabled, target = excluded.target, updated_at = now();

-- ── 3. cosmetic_catalog: one row per item (handoff §6.5) ───────────────────────────────────────────────────
-- Ids are PERMANENT. Retire an item with active = false (never delete a row: ownership references it). Display
-- names and assets live in the client catalog; this table controls eligibility.
create table if not exists public.cosmetic_catalog (
  cosmetic_id        text primary key,
  category           text not null references public.cosmetic_categories(category),
  rarity             text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  acquisition_source text not null check (acquisition_source in ('crate', 'level_milestone', 'achievement', 'event')),
  milestone_level    int,
  target_type        text check (target_type is null or target_type in ('hero', 'card')),
  target_id          text,
  achievement_id     text,
  active             boolean not null default true,
  manifest_version   int not null default 1,
  created_at         timestamptz not null default now(),
  check ((acquisition_source = 'level_milestone') = (milestone_level is not null))
);
alter table public.cosmetic_catalog enable row level security;
drop policy if exists "read cosmetic_catalog" on public.cosmetic_catalog;
create policy "read cosmetic_catalog" on public.cosmetic_catalog for select using (true);
-- MUST match COSMETICS in packages/progression/src/cosmetics.ts row for row.
insert into public.cosmetic_catalog (cosmetic_id, category, rarity, acquisition_source, milestone_level, target_type, target_id, achievement_id, active) values
  ('alpha_tester', 'title', 'rare', 'level_milestone', 2, null, null, null, true),
  ('title_wanderer', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_rune_reader', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_coin_counter', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_lantern_bearer', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_hearthkeeper', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_warband_captain', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_board_builder', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_stormcaller', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_star_chaser', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_grave_whisperer', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_ironbeard', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_spiritbound', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_kingbreaker', 'title', 'epic', 'crate', null, null, null, null, true),
  ('title_voice_of_the_deep', 'title', 'epic', 'crate', null, null, null, null, true),
  ('title_the_unbroken', 'title', 'legendary', 'crate', null, null, null, null, true)
on conflict (cosmetic_id) do update set
  category = excluded.category, rarity = excluded.rarity, acquisition_source = excluded.acquisition_source,
  milestone_level = excluded.milestone_level, target_type = excluded.target_type, target_id = excluded.target_id,
  achievement_id = excluded.achievement_id, active = excluded.active;

-- ── 4. player_cosmetics: ownership of every category (public read, like the MVP's titles) ─────────────────
-- UNIQUE (user, item) is the final no-duplicate guard. Written only by `settle_progression` / `open_crate`.
create table if not exists public.player_cosmetics (
  user_id     uuid not null references auth.users(id) on delete cascade,
  cosmetic_id text not null references public.cosmetic_catalog(cosmetic_id),
  source      text not null,
  source_id   text,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);
alter table public.player_cosmetics enable row level security;
drop policy if exists "read player_cosmetics" on public.player_cosmetics;
create policy "read player_cosmetics" on public.player_cosmetics for select using (true);

-- Keep the MVP's `player_titles` true for older clients: every owned TITLE is mirrored into it.
create or replace function public.player_cosmetics_mirror_titles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.cosmetic_catalog c where c.cosmetic_id = new.cosmetic_id and c.category = 'title') then
    insert into public.player_titles (user_id, title_id, unlocked_at, source, source_id)
      values (new.user_id, new.cosmetic_id, new.unlocked_at, new.source, new.source_id)
      on conflict (user_id, title_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists player_cosmetics_mirror_titles on public.player_cosmetics;
create trigger player_cosmetics_mirror_titles after insert on public.player_cosmetics
  for each row execute function public.player_cosmetics_mirror_titles();

-- ── 5. loot_crates: one per (user, level); owner-only read (handoff §6.6) ──────────────────────────────────
create table if not exists public.loot_crates (
  crate_id           uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  earned_level       int  not null check (earned_level >= 1),
  state              text not null default 'sealed' check (state in ('sealed', 'opened')),
  reward_cosmetic_id text references public.cosmetic_catalog(cosmetic_id),
  roll_version       int,
  source_id          text,
  earned_at          timestamptz not null default now(),
  opened_at          timestamptz,
  unique (user_id, earned_level),
  check ((state = 'sealed' and reward_cosmetic_id is null and opened_at is null)
      or (state = 'opened' and reward_cosmetic_id is not null and opened_at is not null))
);
alter table public.loot_crates enable row level security;
drop policy if exists "read own loot_crates" on public.loot_crates;
create policy "read own loot_crates" on public.loot_crates for select to authenticated using (auth.uid() = user_id);
create index if not exists loot_crates_user_state on public.loot_crates (user_id, state, earned_level);
-- A second guard behind ownership's unique key: no two crates of one account ever hold the same reward.
create unique index if not exists loot_crates_one_reward on public.loot_crates (user_id, reward_cosmetic_id) where reward_cosmetic_id is not null;

-- A crate goes sealed -> opened ONCE and is then history (even for the service role).
create or replace function public.loot_crates_transition_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.state = 'opened' then raise exception 'crate_already_opened'; end if;
  if new.crate_id is distinct from old.crate_id or new.user_id is distinct from old.user_id
     or new.earned_level is distinct from old.earned_level or new.earned_at is distinct from old.earned_at then
    raise exception 'crate_identity_is_immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists loot_crates_transition_guard on public.loot_crates;
create trigger loot_crates_transition_guard before update on public.loot_crates
  for each row execute function public.loot_crates_transition_guard();

-- ── 6. cosmetic_loadouts: equipped cosmetics by slot + target (handoff §6.7; schema-ready, empty) ─────────
-- For the categories still switched off (announcer, hero/minion skins, attack, board, music). The TITLE keeps its
-- MVP home, `profiles.equipped_title_id` (public), written only by `equip_title` / the settlement.
create table if not exists public.cosmetic_loadouts (
  user_id     uuid not null references auth.users(id) on delete cascade,
  slot        text not null references public.cosmetic_categories(category),
  target_id   text not null default '',
  cosmetic_id text not null references public.cosmetic_catalog(cosmetic_id),
  updated_at  timestamptz not null default now(),
  primary key (user_id, slot, target_id)
);
alter table public.cosmetic_loadouts enable row level security;
drop policy if exists "read cosmetic_loadouts" on public.cosmetic_loadouts;
create policy "read cosmetic_loadouts" on public.cosmetic_loadouts for select using (true);

-- ── 7. The ledger records the crates each settlement created ──────────────────────────────────────────────
-- `crates_awarded` already exists (reserved by the MVP); `crate_ids` lets a duplicate answer return the same
-- crates. Adding a column rewrites no row, so the immutability trigger is untouched.
alter table public.progression_results add column if not exists crate_ids uuid[] not null default '{}';

-- ── 8. JSON shapes ────────────────────────────────────────────────────────────────────────────────────────
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
    'cratesAwarded', r.crates_awarded,
    'crateIds', to_jsonb(r.crate_ids),
    'revisionAfter', r.revision_after,
    'settledAt', r.settled_at
  );
$$;

-- MUST match `ProgressionProfile` in packages/progression/src/rules.ts key for key. Owned titles now come from
-- `player_cosmetics` (every title, level or crate), oldest first.
create or replace function public.progression_profile_json(p_user uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'accountXp', p.account_xp, 'accountLevel', p.account_level, 'revision', p.progression_revision,
    'equippedTitleId', p.equipped_title_id,
    'titles', coalesce((
      select jsonb_agg(o.cosmetic_id order by o.unlocked_at, o.cosmetic_id)
      from public.player_cosmetics o join public.cosmetic_catalog c on c.cosmetic_id = o.cosmetic_id
      where o.user_id = p.user_id and c.category = 'title'
    ), '[]'::jsonb)
  )
  from public.profiles p where p.user_id = p_user;
$$;

-- MUST match `CrateRow` in packages/progression/src/cosmetics.ts key for key.
create or replace function public.progression_crate_json(c public.loot_crates)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'crateId', c.crate_id, 'earnedLevel', c.earned_level, 'state', c.state,
    'rewardId', c.reward_cosmetic_id, 'earnedAt', c.earned_at, 'openedAt', c.opened_at
  );
$$;

-- ── 9. settle_progression: the MVP writer, now also creating crates ──────────────────────────────────────
-- Unchanged from 2026-09-27 except: the Alpha Tester grant writes `player_cosmetics` (mirrored into
-- `player_titles`), and step 9b creates one sealed crate per newly reached level (plus the Level 1 Welcome Crate
-- when this settlement enrolls the account), recorded on the ledger row. Crates are created even while
-- `crates_enabled` is false (banked).
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
  v_enrolling boolean;
  v_crate_ids uuid[] := '{}';
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
    insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
      values (p_user, c_alpha_title, 'level', p_mode || ':' || p_run_id)
      on conflict (user_id, cosmetic_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_unlocked := array_append(v_unlocked, c_alpha_title); end if;
  end if;
  v_equipped := prof.equipped_title_id;
  if v_equipped is null and exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c_alpha_title) then
    v_equipped := c_alpha_title;
  end if;

  -- 9b. crates: one sealed crate per newly reached level; enrollment (the first settlement) also grants the
  -- Level 1 Welcome Crate. The unique (user, level) key makes this safe against the backfill and any retry.
  v_enrolling := prof.progression_enrolled_at is null;
  with ins as (
    insert into public.loot_crates (user_id, earned_level, source_id)
      select p_user, g.lvl, p_mode || ':' || p_run_id
      from generate_series(case when v_enrolling then 1 else v_l0 + 1 end, v_l1) as g(lvl)
      on conflict (user_id, earned_level) do nothing
      returning crate_id, earned_level
  )
  select coalesce(array_agg(ins.crate_id order by ins.earned_level), '{}') into v_crate_ids from ins;

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
    crates_awarded, crate_ids, achievement_ids, unlocked_title_ids
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, 0, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    coalesce(array_length(v_crate_ids, 1), 0), v_crate_ids, '{}', v_unlocked
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 10. The crate roll: what a crate can still give this player, with weights ────────────────────────────
-- Active, crate-sourced items in an ENABLED category that the player does not own. Weight = rarity weight x
-- category weight (mirror of crateWeightOf in packages/progression/src/cosmetics.ts).
create or replace function public.progression_crate_pool(p_user uuid)
returns table (pool_cosmetic_id text, pool_weight int)
language plpgsql
stable
set search_path = public
as $$
declare
  -- THE WEIGHTS (mirror of RARITY_WEIGHTS in packages/progression/src/cosmetics.ts; handoff §5.4)
  c_w_common    constant int := 55;
  c_w_rare      constant int := 30;
  c_w_epic      constant int := 12;
  c_w_legendary constant int := 3;
begin
  return query
    select c.cosmetic_id,
      (case c.rarity when 'common' then c_w_common when 'rare' then c_w_rare when 'epic' then c_w_epic when 'legendary' then c_w_legendary else 0 end) * k.weight
    from public.cosmetic_catalog c
    join public.cosmetic_categories k on k.category = c.category
    where c.active and k.enabled and c.acquisition_source = 'crate' and k.weight > 0
      and not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c.cosmetic_id)
    order by c.cosmetic_id collate "C";
end;
$$;

-- ── 11. open_crate: THE opening transaction (handoff §5.5). Service role only. ───────────────────────────
-- Per-user advisory lock (the same one the settlement takes, so two openings of DIFFERENT crates serialize and
-- can never pick the same item) → the crate row FOR UPDATE (an opened crate returns its committed reward as
-- `already_opened`) → the pool → ONE weighted draw over what remains (never a rarity first) → ownership insert
-- (unique key = the final guard) + the crate marked opened, together. An empty pool answers `pool_exhausted`
-- and writes nothing: the crate stays sealed until the catalog grows.
create or replace function public.open_crate(p_user uuid, p_crate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_roll_version constant int := 1;
  v_crate   public.loot_crates%rowtype;
  v_enabled boolean;
  v_total   bigint;
  v_roll    bigint;
  v_pick    text;
  v_rows    int;
  v_sealed  int;
begin
  if p_user is null or p_crate_id is null then raise exception 'bad_crate_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  select * into v_crate from public.loot_crates where crate_id = p_crate_id and user_id = p_user for update;
  if not found then raise exception 'crate_not_found'; end if;

  if v_crate.state = 'opened' then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'already_opened', 'crate', public.progression_crate_json(v_crate),
      'rewardId', v_crate.reward_cosmetic_id, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
  end if;

  select crates_enabled into v_enabled from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'crates_disabled'; end if;

  select coalesce(sum(pool_weight), 0) into v_total from public.progression_crate_pool(p_user);
  if v_total <= 0 then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'pool_exhausted', 'crate', public.progression_crate_json(v_crate),
      'rewardId', null, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
  end if;

  -- One draw in [0, total), walked over the pool in id order (mirror of pickCrateReward).
  v_roll := least(v_total - 1, floor(random() * v_total)::bigint);
  select p.pool_cosmetic_id into v_pick from (
    select pool_cosmetic_id, sum(pool_weight) over (order by pool_cosmetic_id collate "C" rows unbounded preceding) as acc
    from public.progression_crate_pool(p_user)
  ) p where p.acc > v_roll order by p.acc limit 1;
  if v_pick is null then raise exception 'duplicate_reward'; end if;

  insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
    values (p_user, v_pick, 'crate', p_crate_id::text)
    on conflict (user_id, cosmetic_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'duplicate_reward'; end if;

  update public.loot_crates set state = 'opened', reward_cosmetic_id = v_pick, roll_version = c_roll_version, opened_at = now()
    where crate_id = p_crate_id and state = 'sealed'
    returning * into v_crate;
  if not found then raise exception 'crate_not_found'; end if;

  -- A new title is worn at once only when the player wears none; the revision moves so mirrors adopt the change.
  update public.profiles set
    equipped_title_id = coalesce(equipped_title_id,
      (select c.cosmetic_id from public.cosmetic_catalog c where c.cosmetic_id = v_pick and c.category = 'title')),
    progression_revision = progression_revision + 1,
    updated_at = now()
  where user_id = p_user;

  select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
  return jsonb_build_object('status', 'opened', 'crate', public.progression_crate_json(v_crate),
    'rewardId', v_pick, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 12. equip_title: wear a title you OWN, or none. Service role only. ───────────────────────────────────
create or replace function public.equip_title(p_user uuid, p_title_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then raise exception 'not_owned'; end if;
  if p_title_id is not null and (length(p_title_id) < 1 or length(p_title_id) > 64) then raise exception 'bad_title_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));
  if p_title_id is not null and not exists (
    select 1 from public.player_cosmetics o join public.cosmetic_catalog c on c.cosmetic_id = o.cosmetic_id
    where o.user_id = p_user and o.cosmetic_id = p_title_id and c.category = 'title'
  ) then
    raise exception 'not_owned';
  end if;
  update public.profiles set equipped_title_id = p_title_id, progression_revision = progression_revision + 1, updated_at = now()
    where user_id = p_user;
  if not found then raise exception 'not_owned'; end if;
  return jsonb_build_object('status', 'equipped', 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 13. Grants: every writer is service role ONLY (the Edge Functions call them) ──────────────────────────
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;
revoke all on function public.progression_result_json(public.progression_results) from public, anon, authenticated;
grant execute on function public.progression_result_json(public.progression_results) to service_role;
revoke all on function public.progression_profile_json(uuid) from public, anon, authenticated;
grant execute on function public.progression_profile_json(uuid) to service_role;
revoke all on function public.progression_crate_json(public.loot_crates) from public, anon, authenticated;
grant execute on function public.progression_crate_json(public.loot_crates) to service_role;
revoke all on function public.progression_crate_pool(uuid) from public, anon, authenticated;
grant execute on function public.progression_crate_pool(uuid) to service_role;
revoke all on function public.open_crate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_crate(uuid, uuid) to service_role;
revoke all on function public.equip_title(uuid, text) from public, anon, authenticated;
grant execute on function public.equip_title(uuid, text) to service_role;
revoke all on function public.player_cosmetics_mirror_titles() from public, anon, authenticated;

-- ── 14. BACKFILL (idempotent: every statement is keyed, so a re-run changes nothing) ─────────────────────
-- a) Titles owned before this migration move into `player_cosmetics` (only ids the catalog knows).
insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id, unlocked_at)
  select t.user_id, t.title_id, t.source, t.source_id, t.unlocked_at
  from public.player_titles t join public.cosmetic_catalog c on c.cosmetic_id = t.title_id
  on conflict (user_id, cosmetic_id) do nothing;
-- b) Level-based titles for any account already past their level (Alpha Tester at Level 2).
insert into public.player_cosmetics (user_id, cosmetic_id, source)
  select p.user_id, c.cosmetic_id, 'level'
  from public.profiles p join public.cosmetic_catalog c on c.acquisition_source = 'level_milestone' and p.account_level >= c.milestone_level
  on conflict (user_id, cosmetic_id) do nothing;
-- c) Crates for accounts ALREADY enrolled: the Welcome Crate plus one per level already reached (Levels 1..L).
insert into public.loot_crates (user_id, earned_level, source_id)
  select p.user_id, g.lvl, 'backfill'
  from public.profiles p cross join lateral generate_series(1, p.account_level) as g(lvl)
  where p.progression_enrolled_at is not null
  on conflict (user_id, earned_level) do nothing;
