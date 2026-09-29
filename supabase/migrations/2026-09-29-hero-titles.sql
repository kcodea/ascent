-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- HERO TITLES: a title at 3 Ranked 1sts with a hero, its golden MASTER version at 10  (2026-09-29)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-achievements.sql (and the 2026-09-29 crate files).
-- Idempotent: every insert is keyed, the backfill never repeats, and it never moves a switch. The same block is
-- appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-09-29-hero-titles.md. This file
-- REPLACES `settle_progression`: if the achievements file is ever re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-09-29: "the hero's title is granted at 3 wins with a hero, then the mastery of that
-- title is after 10 wins with that hero. the master title should be a golden plate and embroidered text"):
--  - 66 catalog titles, two per playable hero: `title_hero_<id>` (from the new `hero.<id>.titled` achievement, 3
--    Ranked 1sts) and `title_hero_<id>_master` (from `hero.<id>.mastery`, 10). Achievement-sourced, so
--    `progression_crate_pool` (crate items only) never offers them. The code owns the catalog
--    (`sync_cosmetic_catalog`, run by `progression-inventory`); this seed only makes sure the rows exist before the
--    first settlement can grant one (ownership references the catalog), and never overwrites a synced row.
--  - `settle_progression` now GRANTS an achievement's title (`achievement_catalog.title_id`) in the same transaction
--    as the completion (step 7c), reports it in `unlockedTitles`, swaps a worn base title for its master when the
--    master is earned, and wears a new hero title when nothing is worn (step 9a). Everything else is unchanged from
--    2026-09-28-achievements.sql (sqlParity.test.ts checks every constant).
--  - BACKFILL (section 4) for accounts that already count Ranked 1sts with a hero: the new Titled tier catches up
--    to the Mastery tier's count (the same predicate), a completed tier grants its title, and a worn base title is
--    upgraded. A backfilled completion pays NO XP (`xp_awarded` 0): XP only ever moves inside a settlement.
--
-- THE RULES LIVE IN TWO PLACES that must agree: this file and packages/progression/src/{achievements,cosmetics}.ts.
-- CI parses this file (sqlParity.test.ts) and runs it in an embedded Postgres (heroTitles.db.test.ts).

-- ── 1. The hero titles in the catalog (the code's sync owns them from here; a re-run never overwrites) ────────
insert into public.cosmetic_catalog (cosmetic_id, category, rarity, acquisition_source, milestone_level, target_type, target_id, achievement_id, active) values
  ('title_hero_warden', 'title', 'epic', 'achievement', null, null, null, 'hero.warden.titled', true),
  ('title_hero_warden_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.warden.mastery', true),
  ('title_hero_indy', 'title', 'epic', 'achievement', null, null, null, 'hero.indy.titled', true),
  ('title_hero_indy_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.indy.mastery', true),
  ('title_hero_myra', 'title', 'epic', 'achievement', null, null, null, 'hero.myra.titled', true),
  ('title_hero_myra_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.myra.mastery', true),
  ('title_hero_soren', 'title', 'epic', 'achievement', null, null, null, 'hero.soren.titled', true),
  ('title_hero_soren_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.soren.mastery', true),
  ('title_hero_nadja', 'title', 'epic', 'achievement', null, null, null, 'hero.nadja.titled', true),
  ('title_hero_nadja_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.nadja.mastery', true),
  ('title_hero_cassen', 'title', 'epic', 'achievement', null, null, null, 'hero.cassen.titled', true),
  ('title_hero_cassen_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.cassen.mastery', true),
  ('title_hero_drakko', 'title', 'epic', 'achievement', null, null, null, 'hero.drakko.titled', true),
  ('title_hero_drakko_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.drakko.mastery', true),
  ('title_hero_robin', 'title', 'epic', 'achievement', null, null, null, 'hero.robin.titled', true),
  ('title_hero_robin_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.robin.mastery', true),
  ('title_hero_darah', 'title', 'epic', 'achievement', null, null, null, 'hero.darah.titled', true),
  ('title_hero_darah_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.darah.mastery', true),
  ('title_hero_risen', 'title', 'epic', 'achievement', null, null, null, 'hero.risen.titled', true),
  ('title_hero_risen_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.risen.mastery', true),
  ('title_hero_gildmaster', 'title', 'epic', 'achievement', null, null, null, 'hero.gildmaster.titled', true),
  ('title_hero_gildmaster_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.gildmaster.mastery', true),
  ('title_hero_discodan', 'title', 'epic', 'achievement', null, null, null, 'hero.discodan.titled', true),
  ('title_hero_discodan_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.discodan.mastery', true),
  ('title_hero_brackus', 'title', 'epic', 'achievement', null, null, null, 'hero.brackus.titled', true),
  ('title_hero_brackus_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.brackus.mastery', true),
  ('title_hero_baggerben', 'title', 'epic', 'achievement', null, null, null, 'hero.baggerben.titled', true),
  ('title_hero_baggerben_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.baggerben.mastery', true),
  ('title_hero_hermithank', 'title', 'epic', 'achievement', null, null, null, 'hero.hermithank.titled', true),
  ('title_hero_hermithank_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.hermithank.mastery', true),
  ('title_hero_repete', 'title', 'epic', 'achievement', null, null, null, 'hero.repete.titled', true),
  ('title_hero_repete_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.repete.mastery', true),
  ('title_hero_gorr', 'title', 'epic', 'achievement', null, null, null, 'hero.gorr.titled', true),
  ('title_hero_gorr_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.gorr.mastery', true),
  ('title_hero_kindness', 'title', 'epic', 'achievement', null, null, null, 'hero.kindness.titled', true),
  ('title_hero_kindness_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.kindness.mastery', true),
  ('title_hero_merrin', 'title', 'epic', 'achievement', null, null, null, 'hero.merrin.titled', true),
  ('title_hero_merrin_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.merrin.mastery', true),
  ('title_hero_gambler', 'title', 'epic', 'achievement', null, null, null, 'hero.gambler.titled', true),
  ('title_hero_gambler_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.gambler.mastery', true),
  ('title_hero_xerox', 'title', 'epic', 'achievement', null, null, null, 'hero.xerox.titled', true),
  ('title_hero_xerox_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.xerox.mastery', true),
  ('title_hero_frank', 'title', 'epic', 'achievement', null, null, null, 'hero.frank.titled', true),
  ('title_hero_frank_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.frank.mastery', true),
  ('title_hero_quillen', 'title', 'epic', 'achievement', null, null, null, 'hero.quillen.titled', true),
  ('title_hero_quillen_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.quillen.mastery', true),
  ('title_hero_hunch', 'title', 'epic', 'achievement', null, null, null, 'hero.hunch.titled', true),
  ('title_hero_hunch_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.hunch.mastery', true),
  ('title_hero_emeraldwarden', 'title', 'epic', 'achievement', null, null, null, 'hero.emeraldwarden.titled', true),
  ('title_hero_emeraldwarden_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.emeraldwarden.mastery', true),
  ('title_hero_albus', 'title', 'epic', 'achievement', null, null, null, 'hero.albus.titled', true),
  ('title_hero_albus_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.albus.mastery', true),
  ('title_hero_flash', 'title', 'epic', 'achievement', null, null, null, 'hero.flash.titled', true),
  ('title_hero_flash_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.flash.mastery', true),
  ('title_hero_midas', 'title', 'epic', 'achievement', null, null, null, 'hero.midas.titled', true),
  ('title_hero_midas_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.midas.mastery', true),
  ('title_hero_juggler', 'title', 'epic', 'achievement', null, null, null, 'hero.juggler.titled', true),
  ('title_hero_juggler_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.juggler.mastery', true),
  ('title_hero_bram', 'title', 'epic', 'achievement', null, null, null, 'hero.bram.titled', true),
  ('title_hero_bram_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.bram.mastery', true),
  ('title_hero_cia', 'title', 'epic', 'achievement', null, null, null, 'hero.cia.titled', true),
  ('title_hero_cia_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.cia.mastery', true),
  ('title_hero_keshi', 'title', 'epic', 'achievement', null, null, null, 'hero.keshi.titled', true),
  ('title_hero_keshi_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.keshi.mastery', true),
  ('title_hero_mimic', 'title', 'epic', 'achievement', null, null, null, 'hero.mimic.titled', true),
  ('title_hero_mimic_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.mimic.mastery', true)
on conflict (cosmetic_id) do nothing;
-- A (re-)run forces the next cold starts to sync both code catalogs (the new tier and the title rewards).
update public.progression_config set catalog_hash = null, achievements_hash = null where id = 1;

-- ── 2. settle_progression: grants achievement titles; a master upgrades the worn base title ─────────────────
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
  -- HERO TITLES (mirror of heroTitleId / heroMasterTitleId in packages/progression/src/cosmetics.ts)
  c_hero_title_prefix constant text := 'title_hero_';
  c_master_suffix     constant text := '_master';

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
  v_hero_title text := null;
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
          -- 7c. A TITLE reward (hero titles, owner 2026-09-29) is granted in the same transaction. Only a title the
          -- catalog knows (the ownership FK); the grant is keyed, so a retry or the backfill never doubles it.
          if d.title_id is not null and exists (select 1 from public.cosmetic_catalog c where c.cosmetic_id = d.title_id and c.category = 'title') then
            insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
              values (p_user, d.title_id, 'achievement', d.achievement_id)
              on conflict (user_id, cosmetic_id) do nothing;
            get diagnostics v_rows = row_count;
            if v_rows > 0 then
              v_unlocked := array_append(v_unlocked, d.title_id);
              if d.title_id like c_hero_title_prefix || '%' then v_hero_title := d.title_id; end if;
            end if;
          end if;
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
  -- 9a. HERO TITLES (owner 2026-09-29). The master UPGRADES the title in place: a newly earned master replaces its own
  -- base title when that is the one worn. A new hero title is worn when nothing is (like Alpha Tester).
  if v_equipped is not null and v_equipped like c_hero_title_prefix || '%' and (v_equipped || c_master_suffix) = any(v_unlocked) then
    v_equipped := v_equipped || c_master_suffix;
  end if;
  if v_equipped is null and v_hero_title is not null then
    v_equipped := v_hero_title;
  end if;
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

-- ── 3. Grants: the writer is service role ONLY (the Edge Function calls it) ────────────────────────────────
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;

-- ── 4. BACKFILL (idempotent: every statement is keyed or guarded, so a re-run changes nothing) ──────────────
-- a) The Titled tier (3 Ranked 1sts) counts the same games as Mastery (10): an account with Mastery progress
--    starts Titled at that count, capped at the target. Rows already there are left alone.
insert into public.achievement_progress (user_id, achievement_id, definition_version, progress, completed_at, completion_run_id, updated_at)
  select ap.user_id, 'hero.' || split_part(ap.achievement_id, '.', 2) || '.titled', 1, least(ap.progress, 3),
         case when ap.progress >= 3 then now() end, case when ap.progress >= 3 then 'backfill' end, now()
  from public.achievement_progress ap
  where ap.achievement_id like 'hero.%.mastery' and ap.progress > 0
  on conflict (user_id, achievement_id) do nothing;
-- b) Each backfilled Titled completion is recorded once, with no XP (XP only moves inside a settlement).
insert into public.achievement_completions (user_id, achievement_id, run_id, mode, xp_awarded, title_id)
  select ap.user_id, ap.achievement_id, 'backfill', 'ranked', 0, 'title_hero_' || split_part(ap.achievement_id, '.', 2)
  from public.achievement_progress ap
  where ap.achievement_id like 'hero.%.titled' and ap.completed_at is not null and ap.completion_run_id = 'backfill'
  on conflict (user_id, achievement_id) do nothing;
-- c) Every completed hero title tier grants its title (the completion row names it; only catalog titles).
insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
  select c.user_id, case when c.achievement_id like '%.mastery' then 'title_hero_' || split_part(c.achievement_id, '.', 2) || '_master'
                         else 'title_hero_' || split_part(c.achievement_id, '.', 2) end,
         'achievement', c.achievement_id
  from public.achievement_completions c
  where (c.achievement_id like 'hero.%.titled' or c.achievement_id like 'hero.%.mastery')
    and exists (select 1 from public.cosmetic_catalog k where k.cosmetic_id = case when c.achievement_id like '%.mastery'
                  then 'title_hero_' || split_part(c.achievement_id, '.', 2) || '_master' else 'title_hero_' || split_part(c.achievement_id, '.', 2) end)
  on conflict (user_id, cosmetic_id) do nothing;
-- d) The completions carry their title (the pre-titles catalog wrote null).
update public.achievement_completions c set title_id = case when c.achievement_id like '%.mastery'
    then 'title_hero_' || split_part(c.achievement_id, '.', 2) || '_master' else 'title_hero_' || split_part(c.achievement_id, '.', 2) end
  where (c.achievement_id like 'hero.%.titled' or c.achievement_id like 'hero.%.mastery') and c.title_id is null;
-- e) A worn base title whose master is owned is upgraded in place.
update public.profiles p set equipped_title_id = p.equipped_title_id || '_master', progression_revision = p.progression_revision + 1, updated_at = now()
  where p.equipped_title_id like 'title_hero_%' and p.equipped_title_id not like '%\_master'
    and exists (select 1 from public.player_cosmetics o where o.user_id = p.user_id and o.cosmetic_id = p.equipped_title_id || '_master');
