-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACHIEVEMENTS, batch 1: XP rewards only  (2026-09-28)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-progression-skins.sql. Idempotent (safe to re-run:
-- it seeds no achievement rows, writes no flag and never moves the epoch). The same block is appended to
-- schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-09-28-achievements-b1.md (run this, deploy
-- `submit-progression`, THEN set the achievements epoch). This file REPLACES `settle_progression` and
-- `progression_result_json`: if the crates file is ever re-run, run the skins file and then this one again after it.
--
-- WHAT THIS IS (owner 2026-09-28: "we'll need an achievements tab in career next to practice. most should show,
-- with their reward, but the hidden ones will be blurred or say "Hidden" and we'll come up with fun rewards for
-- them. let's just get the normal xp related achievements in for now though.")
--  - THE CATALOG IS CODE. `achievement_catalog` is written by `sync_achievement_catalog` from
--    packages/progression/src/achievements.ts (`achievementCatalogPayload`); the `submit-progression` Edge Function
--    calls it on the first request of every cold start. A definition no longer in code is marked `active = false`,
--    never deleted. The owner's emergency switch is `admin_off` (the sync never writes it):
--      retire one:  update public.achievement_catalog set admin_off = true where achievement_id = 's2.kobold.golem_40';
--      restore it:  update public.achievement_catalog set admin_off = false where achievement_id = 's2.kobold.golem_40';
--  - EVALUATION IS PART OF THE SETTLEMENT. `settle_progression` evaluates every live catalog row against the game it
--    is settling, inside the same transaction and under the same per-user lock as the match XP: progress rows move,
--    a completion is written at most once per account (its primary key), its XP is added to the SAME ledger row
--    (`achievement_xp`, `achievement_ids`) and to the account. A duplicate settlement returns the original result
--    and evaluates nothing again. The TS mirror is `evaluateAchievements` (achievements.db.test.ts runs both).
--  - TRUST (handoff §7.4). Server metrics (the game, placement, the accepted comeback, the rank result, the Career
--    best, distinct heroes, completions) come from the database's own rows. Run metrics come from the client's
--    fact document (V2 `metrics`, sanitized by the Edge Function): ordinary trust, the facts are stored on the
--    ledger row for audit. A client-sent key that names a server metric is overwritten here. No prestige (replay
--    verified) achievement exists yet; a catalog row with trust 'P' is never evaluated.
--  - WHICH GAMES COUNT (assumed defaults, the owner can flip them): `any` achievements take Ranked and a standard
--    Practice (Normal Health AND a turn timer); `ranked` only Ranked; `tutorial` only the Learn Ascent graduation;
--    `account` every settlement. Set 2 feats need a Set 2 run. Rank achievements read the account's Career-best
--    division (so the first settlement after the switch pays every rank already reached).
--  - NO RETROACTIVE COUNTING. Nothing is evaluated until the owner sets `progression_config.achievements_epoch`
--    (section 9 is the switch), and a game whose source row is older than it is never evaluated (it still earns its
--    match XP). The client probes the epoch: while it is null there is no Achievements tab and the client keeps
--    sending V1 facts.
--
-- THE RULES LIVE IN TWO PLACES that must agree: this file and packages/progression/src/achievements.ts. CI parses
-- this file (sqlParity.test.ts) and runs it in an embedded Postgres (achievements.db.test.ts).

-- ── 1. The switch + the last synced catalog ─────────────────────────────────────────────────────────────────
alter table public.progression_config add column if not exists achievements_epoch timestamptz;
alter table public.progression_config add column if not exists achievements_hash  text;
-- A (re-)run of this file forces the next cold start to sync the catalog again.
update public.progression_config set achievements_hash = null where id = 1;

-- ── 2. achievement_catalog: one row per definition (public read; written only by the sync) ──────────────────
create table if not exists public.achievement_catalog (
  achievement_id text primary key,
  version        int  not null default 1,
  category       text not null,
  mode           text not null check (mode in ('any', 'ranked', 'tutorial', 'account')),
  set_id         text,
  hero_id        text,
  placement_max  int  check (placement_max is null or placement_max between 1 and 8),
  metric         text not null,
  agg            text not null check (agg in ('max', 'sum')),
  target         bigint not null check (target > 0),
  xp             int  not null check (xp >= 0),
  title_id       text,
  hidden         boolean not null default false,
  trust          text not null default 'O' check (trust in ('S', 'O', 'P')),
  active         boolean not null default true,
  admin_off      boolean not null default false,
  updated_at     timestamptz not null default now()
);
alter table public.achievement_catalog enable row level security;
drop policy if exists "read achievement_catalog" on public.achievement_catalog;
create policy "read achievement_catalog" on public.achievement_catalog for select using (true);

-- ── 3. achievement_progress: the account's progress per achievement (OWNER-ONLY read) ───────────────────────
-- In-progress values stay private (handoff §9.2 default); completions below are public.
create table if not exists public.achievement_progress (
  user_id            uuid not null references auth.users(id) on delete cascade,
  achievement_id     text not null,
  definition_version int  not null default 1,
  progress           bigint not null default 0,
  completed_at       timestamptz,
  completion_run_id  text,
  updated_at         timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.achievement_progress enable row level security;
drop policy if exists "read own achievement_progress" on public.achievement_progress;
create policy "read own achievement_progress" on public.achievement_progress for select to authenticated using (auth.uid() = user_id);

-- ── 4. achievement_completions: one row per completed achievement, ever (PUBLIC read) ───────────────────────
create table if not exists public.achievement_completions (
  user_id        uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null,
  run_id         text,
  mode           text,
  xp_awarded     int  not null,
  title_id       text,
  completed_at   timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.achievement_completions enable row level security;
drop policy if exists "read achievement_completions" on public.achievement_completions;
create policy "read achievement_completions" on public.achievement_completions for select using (true);
create index if not exists achievement_completions_user_time on public.achievement_completions (user_id, completed_at desc);

-- ── 5. achievement_hero_stats: counted games per hero, for "N different heroes" (owner-only read) ───────────
create table if not exists public.achievement_hero_stats (
  user_id    uuid not null references auth.users(id) on delete cascade,
  hero_id    text not null,
  games      int  not null default 0,
  firsts     int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, hero_id)
);
alter table public.achievement_hero_stats enable row level security;
drop policy if exists "read own achievement_hero_stats" on public.achievement_hero_stats;
create policy "read own achievement_hero_stats" on public.achievement_hero_stats for select to authenticated using (auth.uid() = user_id);

-- ── 6. sync_achievement_catalog: write the code's catalog. Service role only. ───────────────────────────────
-- p_catalog = achievementCatalogPayload() (camelCase keys); p_hash = achievementCatalogHash(p_catalog). Never
-- touches `admin_off`, never deletes a row.
create or replace function public.sync_achievement_catalog(p_catalog jsonb, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_items   int;
  v_off     int;
begin
  if p_hash is null or length(p_hash) < 8 or length(p_hash) > 128 then raise exception 'bad_catalog'; end if;
  if p_catalog is null or jsonb_typeof(p_catalog->'items') is distinct from 'array' then raise exception 'bad_catalog'; end if;
  perform pg_advisory_xact_lock(hashtextextended('achievement_catalog_sync', 0));

  select achievements_hash into v_current from public.progression_config where id = 1;
  if v_current is not distinct from p_hash then
    return jsonb_build_object('status', 'unchanged', 'hash', p_hash);
  end if;

  insert into public.achievement_catalog (achievement_id, version, category, mode, set_id, hero_id, placement_max, metric, agg, target, xp, title_id, hidden, trust, active)
    select x->>'achievementId', (x->>'version')::int, x->>'category', x->>'mode', x->>'setId', x->>'heroId', (x->>'placementMax')::int,
           x->>'metric', x->>'agg', (x->>'target')::bigint, (x->>'xp')::int, x->>'titleId', (x->>'hidden')::boolean, x->>'trust', (x->>'active')::boolean
    from jsonb_array_elements(p_catalog->'items') as x
    on conflict (achievement_id) do update set
      version = excluded.version, category = excluded.category, mode = excluded.mode, set_id = excluded.set_id, hero_id = excluded.hero_id,
      placement_max = excluded.placement_max, metric = excluded.metric, agg = excluded.agg, target = excluded.target, xp = excluded.xp,
      title_id = excluded.title_id, hidden = excluded.hidden, trust = excluded.trust, active = excluded.active, updated_at = now()
    where (public.achievement_catalog.version, public.achievement_catalog.category, public.achievement_catalog.mode, public.achievement_catalog.set_id,
           public.achievement_catalog.hero_id, public.achievement_catalog.placement_max, public.achievement_catalog.metric, public.achievement_catalog.agg,
           public.achievement_catalog.target, public.achievement_catalog.xp, public.achievement_catalog.title_id, public.achievement_catalog.hidden,
           public.achievement_catalog.trust, public.achievement_catalog.active)
          is distinct from (excluded.version, excluded.category, excluded.mode, excluded.set_id, excluded.hero_id, excluded.placement_max, excluded.metric,
           excluded.agg, excluded.target, excluded.xp, excluded.title_id, excluded.hidden, excluded.trust, excluded.active);
  get diagnostics v_items = row_count;
  update public.achievement_catalog set active = false, updated_at = now()
    where active and achievement_id not in (select x->>'achievementId' from jsonb_array_elements(p_catalog->'items') as x);
  get diagnostics v_off = row_count;

  update public.progression_config set achievements_hash = p_hash where id = 1;
  return jsonb_build_object('status', 'synced', 'hash', p_hash, 'itemsChanged', v_items, 'itemsDeactivated', v_off);
end;
$$;

-- ── 7. The result JSON carries the achievements ─────────────────────────────────────────────────────────────
-- MUST match `ProgressionResult` in packages/progression/src/rules.ts key for key. `achievementXp` is paid ON TOP of
-- `xp.total`: after.lifetimeXp = before.lifetimeXp + xp.total + achievementXp.
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
    'achievements', to_jsonb(r.achievement_ids),
    'achievementXp', r.achievement_xp,
    'revisionAfter', r.revision_after,
    'settledAt', r.settled_at
  );
$$;

-- ── 8. settle_progression: the crates writer, now also evaluating achievements ───────────────────────────────
-- Unchanged from 2026-09-28 (crates) except: the source reads carry the rank result's promotion / demotion /
-- strength and the practice row's hero, and step 7b evaluates the achievement catalog before the levels are
-- crossed, so achievement XP levels the account and earns crates in the same settlement.
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
  -- ACHIEVEMENTS (mirror of packages/progression/src/achievements.ts)
  c_meta_metric       constant text := 'achievementsCompleted';
  c_brutal_strength   constant int := 70;
  c_ascendant_div     constant int := 15;
  c_metric_max        constant bigint := 1000000000;

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
  -- achievements
  v_ach_epoch  timestamptz;
  v_promoted   boolean := false;
  v_div_before int := null;
  v_demo_game  boolean := false;
  v_demoted    boolean := false;
  v_strength   int := null;
  v_hero       text := null;
  v_set        text := null;
  v_run_ok     boolean := false;
  v_metrics    jsonb := '{}';
  v_first_streak int := 0;
  v_top_streak int := 0;
  v_heroes_played int := 0;
  v_heroes_won int := 0;
  v_done_count int := 0;
  d            public.achievement_catalog%rowtype;
  v_val        bigint;
  v_old        bigint;
  v_done       boolean;
  v_new        bigint;
  v_ach_ids    text[] := '{}';
  v_ach_xp     int := 0;
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
  select epoch, achievements_epoch into v_epoch, v_ach_epoch from public.progression_config where id = 1;
  if v_epoch is null then raise exception 'progression_disabled'; end if;

  -- 5. rate limit (technical only: a refused request is retried later and keeps its XP)
  select count(*) into v_recent from public.progression_results
    where user_id = p_user and settled_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 6. the SOURCE row: the placement comes from here, never from the request
  if p_mode = 'ranked' then
    select rr.placement, rr.seed, rr.created_at, rr.promoted, rr.division_before, rr.was_demotion_game, rr.demoted, rr.lobby_strength
      into v_placement, v_seed, v_source_at, v_promoted, v_div_before, v_demo_game, v_demoted, v_strength
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
    select pg.placement, pg.config, pg.record, pg.created_at, pg.hero_id into v_placement, v_cfg, v_record, v_source_at, v_hero
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

  if p_facts is not null and jsonb_typeof(p_facts) = 'object' and (p_facts->>'version') ~ '^[0-9]+$' then
    v_facts_ver := (p_facts->>'version')::int;
  end if;

  -- 7b. ACHIEVEMENTS (mirror of evaluateAchievements in packages/progression/src/achievements.ts). Only once the
  -- owner has set the achievements epoch, and only for a game whose source row is not older than it.
  if v_ach_epoch is not null and coalesce(v_source_at, now()) >= v_ach_epoch then
    -- The `any` gate: Ranked, or a standard Practice (Normal Health, so a real placement, AND a turn timer).
    v_run_ok := p_mode = 'ranked'
      or (p_mode = 'practice' and v_placement is not null and coalesce(v_cfg->>'timeMult', '') ~ '^[1-9][0-9]*$');
    if p_mode = 'ranked' then v_hero := p_facts->>'heroId'; end if;
    if v_hero is not null and v_hero !~ '^[A-Za-z0-9_.-]{1,64}$' then v_hero := null; end if;
    v_set := p_facts->>'setId';
    if v_set is not null and v_set !~ '^[A-Za-z0-9_.-]{1,32}$' then v_set := null; end if;

    -- Distinct heroes: this game counts toward its hero when it is an eligible game.
    if v_run_ok and v_hero is not null then
      insert into public.achievement_hero_stats (user_id, hero_id, games, firsts)
        values (p_user, v_hero, 1, case when p_mode = 'ranked' and v_placement = 1 then 1 else 0 end)
        on conflict (user_id, hero_id) do update set
          games = public.achievement_hero_stats.games + 1,
          firsts = public.achievement_hero_stats.firsts + excluded.firsts,
          updated_at = now();
    end if;
    select count(*) filter (where s.games > 0), count(*) filter (where s.firsts > 0) into v_heroes_played, v_heroes_won
      from public.achievement_hero_stats s where s.user_id = p_user;

    -- Ranked streaks, over Ranked games since the achievements epoch, ending with this one.
    if p_mode = 'ranked' then
      with r as (
        select rr.placement, row_number() over (order by rr.created_at desc, rr.run_id desc) as rn
        from public.rank_results rr
        where rr.user_id = p_user and rr.created_at >= v_ach_epoch and rr.created_at <= v_source_at
      )
      select coalesce((select min(rn) from r where placement <> 1) - 1, (select count(*) from r)),
             coalesce((select min(rn) from r where placement > 4) - 1, (select count(*) from r))
        into v_first_streak, v_top_streak;
    end if;

    -- The metrics: the client's run metrics (V2), overwritten by every server metric (a client can never name one).
    if coalesce(v_facts_ver, 0) >= 2 and jsonb_typeof(p_facts->'metrics') = 'object' then v_metrics := p_facts->'metrics'; end if;
    v_metrics := v_metrics || jsonb_build_object(
      'game', 1,
      'comeback', case when v_comeback then 1 else 0 end,
      'highestDivision', coalesce(prof.rank_highest_division, 0),
      'promoted', case when p_mode = 'ranked' and v_promoted then 1 else 0 end,
      'ascendantFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_div_before, 0) >= c_ascendant_div then 1 else 0 end,
      'demotionEscape', case when p_mode = 'ranked' and v_demo_game and not v_demoted and v_placement <= 4 then 1 else 0 end,
      'brutalFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_strength, 0) >= c_brutal_strength then 1 else 0 end,
      'firstStreak', v_first_streak,
      'topFourStreak', v_top_streak,
      'heroesPlayed', v_heroes_played,
      'heroesWon', v_heroes_won,
      c_meta_metric, 0
    );

    -- Pass 1: every live, non-prestige, non-meta definition, in id order. Pass 2: the meta family, by target.
    select count(*) into v_done_count from public.achievement_completions c where c.user_id = p_user;
    for d in
      select * from public.achievement_catalog c
      where c.active and not c.admin_off and c.trust <> 'P'
      order by (c.metric = c_meta_metric), case when c.metric = c_meta_metric then c.target else 0 end, c.achievement_id collate "C"
    loop
      continue when d.mode = 'ranked' and p_mode <> 'ranked';
      continue when d.mode = 'tutorial' and p_mode <> 'tutorial';
      continue when d.mode = 'any' and not v_run_ok;
      continue when d.set_id is not null and v_set is distinct from d.set_id;
      continue when d.hero_id is not null and v_hero is distinct from d.hero_id;
      continue when d.placement_max is not null and (v_placement is null or v_placement > d.placement_max);
      if d.metric = c_meta_metric then
        v_val := v_done_count;
      elsif jsonb_typeof(v_metrics->d.metric) = 'number' then
        v_val := least(c_metric_max, greatest(0, floor((v_metrics->>d.metric)::numeric)))::bigint;
      else
        v_val := 0;
      end if;
      continue when v_val <= 0;
      select ap.progress, ap.completed_at is not null into v_old, v_done
        from public.achievement_progress ap where ap.user_id = p_user and ap.achievement_id = d.achievement_id;
      if not found then v_old := 0; v_done := false; end if;
      continue when v_done;
      v_new := case when d.agg = 'sum' then v_old + v_val else greatest(v_old, v_val) end;
      continue when v_new = v_old and v_new < d.target;
      insert into public.achievement_progress (user_id, achievement_id, definition_version, progress, completed_at, completion_run_id, updated_at)
        values (p_user, d.achievement_id, d.version, v_new,
                case when v_new >= d.target then now() end, case when v_new >= d.target then p_run_id end, now())
        on conflict (user_id, achievement_id) do update set
          definition_version = excluded.definition_version, progress = excluded.progress,
          completed_at = excluded.completed_at, completion_run_id = excluded.completion_run_id, updated_at = now();
      if v_new >= d.target then
        insert into public.achievement_completions (user_id, achievement_id, run_id, mode, xp_awarded, title_id)
          values (p_user, d.achievement_id, p_run_id, p_mode, d.xp, d.title_id)
          on conflict (user_id, achievement_id) do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          v_ach_ids := array_append(v_ach_ids, d.achievement_id);
          v_ach_xp := v_ach_xp + d.xp;
          v_done_count := v_done_count + 1;
        end if;
      end if;
    end loop;
  end if;

  -- 8. levels (lifetime XP; the level is derived). Achievement XP counts toward the level and its crates.
  v_xp0 := coalesce(prof.account_xp, 0);
  v_xp1 := v_xp0 + v_total + v_ach_xp;
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

  insert into public.progression_results (
    user_id, run_id, mode, source_id, rules_version, curve_version, facts_version, facts,
    placement, comeback, base_xp, top_four_xp, first_place_xp, comeback_xp, achievement_xp, total_xp,
    xp_before, xp_after, level_before, level_after, revision_before, revision_after,
    crates_awarded, crate_ids, achievement_ids, unlocked_title_ids
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, v_ach_xp, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    coalesce(array_length(v_crate_ids, 1), 0), v_crate_ids, v_ach_ids, v_unlocked
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 9. Grants: every writer is service role ONLY (the Edge Function calls them) ─────────────────────────────
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;
revoke all on function public.progression_result_json(public.progression_results) from public, anon, authenticated;
grant execute on function public.progression_result_json(public.progression_results) to service_role;
revoke all on function public.sync_achievement_catalog(jsonb, text) from public, anon, authenticated;
grant execute on function public.sync_achievement_catalog(jsonb, text) to service_role;

-- ── 10. THE SWITCH (run by hand, ONCE, after `submit-progression` is deployed) ──────────────────────────────
-- Commented out so a re-run of this file can never move the epoch. Games finished before this moment are never
-- evaluated for achievements (no retroactive counting, owner 2026-09-28); they still earn their match XP.
--
-- update public.progression_config set achievements_epoch = now(), updated_at = now() where id = 1 and achievements_epoch is null;
