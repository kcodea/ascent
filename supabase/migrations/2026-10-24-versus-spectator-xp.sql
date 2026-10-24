-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS + SPECTATOR XP: Versus at half a normal game, watching a game to the end at half a game  (2026-10-24)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-22-emote-eight-slots.sql (the end of schema.sql),
-- 2026-10-15-lobby-live.sql + 2026-10-15-lobby-live-watcher-identity.sql (the live-game watcher rows) and
-- 2026-10-24-versus-group.sql (the Versus Group tables). It replaces `settle_progression` (the 2026-10-20 milestone
-- body) and the `progression_results.mode` check, and adds two tables and `spectate_beat`. THEN deploy the
-- `submit-progression` Edge Function (`npm run progression:shared` first; its shared rules carry the new mode and the
-- new Versus numbers). Idempotent: the tables are `if not exists`, the check is dropped and re-added, every function is
-- REPLACED and re-granted, so a re-run changes nothing. The same block is appended to schema.sql; keep the two identical.
--
-- OWNER (2026-10-24, verbatim): "versus modes should grant account xp. just make it 50% of a 'normal' game for now
-- also add this for spectating - watching a player's game rewards 50% of the xp at the end of the match."
--
-- WHAT THIS IS:
--  - VERSUS XP is HALF the Ranked XP for the equivalent lobby result (was a flat 100, +60 for the winner). The Versus
--    finish is put on the lobby's scale by the share of the table it beat (`versusLobbyPlacement` in
--    packages/progression/src/rules.ts): the winner is 1st; any other place p of n seats is ceil(p * 8 / n) of 8. So a
--    1v1: winner 125, loser 50. Group of 4: 125, 80 (2nd = 4th = Top 4), 50, 50. Group of 3: 125, 50, 50. No winner
--    (abandoned): 50. Never a comeback. The ledger stores the lobby-scale placement for a Versus row from now on (older
--    Versus rows keep their 1 / 2). Aether is unchanged (the completion pay, plus the win pay at 1st).
--  - VERSUS GROUP matches settle too (run id `versus:<group match id>`): the caller's seat, its final placement (a
--    player knocked out early settles at once), at least one round fought.
--  - SPECTATE is a new progression mode (run id `watch:<lobby|versus|group>:<game>`): half a game's completion XP (50),
--    no Aether, no achievements, never rank. The evidence is the server's own watch record, written by `spectate_beat`
--    while the spectator's watch screen is open: watched time accrues only between beats at most 45 s apart on the ONE
--    game the spectator beat last (watching two games at once accrues nothing). The game must be over (a live ranked
--    game: a beat landed while its listing showed the end, and the player's rank row exists; Versus: the match row is
--    complete), the spectator present at the end (a beat within 45 s of it), and watching for at least half the game,
--    capped at 5 minutes. Never your own game; never a game you played a seat in.
--  - Unchanged: every other line of `settle_progression` (Ranked, Practice, Tutorial, Aether, crates, titles,
--    achievements for players) is byte-for-byte the 2026-10-20 body.

-- ── 1. progression_results.mode accepts 'spectate' ───────────────────────────────────────────────────────
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.progression_results'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ '\mmode\M'
  loop
    execute format('alter table public.progression_results drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.progression_results add constraint progression_results_mode_check
  check (mode in ('ranked', 'practice', 'tutorial', 'versus', 'spectate'));

-- ── 2. The watch record ─────────────────────────────────────────────────────────────────────────────────
-- One row per spectator per watched game. Server-written only (spectate_beat), read only by settle_progression.
create table if not exists public.spectate_sessions (
  user_id          uuid not null references auth.users(id) on delete cascade,
  run_id           text not null check (char_length(run_id) between 1 and 128),
  kind             text not null check (kind in ('lobby', 'versus', 'group')),
  target           text not null check (char_length(target) between 1 and 80),
  -- A live ranked game's player (never the spectator); null for Versus (the match row names its players).
  watched_user     uuid,
  watched_ms       bigint not null default 0 check (watched_ms >= 0),
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  -- A live ranked game: when its listing says it started, and the first beat that saw it ended.
  game_started_at  timestamptz,
  saw_end_at       timestamptz,
  primary key (user_id, run_id)
);
-- The ONE game each spectator beat last: time accrues only on that game, so two watch screens never both earn.
create table if not exists public.spectate_presence (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  run_id   text not null,
  at       timestamptz not null
);
alter table public.spectate_sessions enable row level security;
alter table public.spectate_presence enable row level security;
revoke all on public.spectate_sessions from anon, authenticated;
revoke all on public.spectate_presence from anon, authenticated;

-- ── 3. spectate_beat: the watch screen's heartbeat ───────────────────────────────────────────────────────
-- Called by a spectator's client every few seconds while the watch screen is open, and once at the end. Checks that the
-- caller really is a spectator of that game (a live ranked game: a watcher row from `lobby_live_watch`, not the player;
-- Versus: the room's spectator role, not a player of the match), then accrues the time since the caller's last beat if
-- that beat was on the same game and at most 45 s ago. Returns { runId, watchedMs, ended }.
create or replace function public.spectate_beat(p_kind text, p_target text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_gap     constant interval := interval '45 seconds';
  c_keep    constant interval := interval '7 days';
  v_uid     uuid := auth.uid();
  v_now     timestamptz := now();
  v_run     text;
  v_watched uuid := null;
  v_started timestamptz := null;
  v_ended   boolean := false;
  v_room    uuid;
  v_phase   text;
  v_done    timestamptz;
  v_p1      uuid;
  v_p2      uuid;
  v_pres    public.spectate_presence%rowtype;
  v_add     bigint := 0;
  v_ms      bigint;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_kind is null or p_kind not in ('lobby', 'versus', 'group') or p_target is null then raise exception 'bad_target'; end if;
  if p_kind = 'lobby' then
    if p_target !~ '^[!-~]{1,80}$' then raise exception 'bad_target'; end if;
    select g.user_id, g.started_at, g.phase = 'end' into v_watched, v_started, v_ended
      from public.lobby_live_games g where g.game_id = p_target and g.last_seen_at > v_now - interval '60 seconds';
    if not found then raise exception 'no_game'; end if;
    if v_watched = v_uid then raise exception 'own_game'; end if;
    if not exists (select 1 from public.lobby_live_watchers w where w.game_id = p_target and w.user_id = v_uid) then raise exception 'not_watching'; end if;
  else
    if p_target !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_target'; end if;
    if p_kind = 'versus' then
      select m.room_id, m.phase, m.completed_at, m.p1_user, m.p2_user into v_room, v_phase, v_done, v_p1, v_p2
        from public.versus_matches m where m.id = p_target::uuid;
      if not found then raise exception 'no_game'; end if;
      if v_uid = v_p1 or v_uid = v_p2 then raise exception 'own_game'; end if;
    else
      select g.room_id, g.phase, g.completed_at into v_room, v_phase, v_done
        from public.versus_group_matches g where g.id = p_target::uuid;
      if not found then raise exception 'no_game'; end if;
      if exists (select 1 from public.versus_group_seats s where s.match_id = p_target::uuid and s.user_id = v_uid) then raise exception 'own_game'; end if;
    end if;
    if v_phase = 'complete' and (v_done is null or v_done < v_now - c_gap) then raise exception 'no_game'; end if;
    if not exists (select 1 from public.versus_members vm where vm.room_id = v_room and vm.user_id = v_uid and vm.role = 'spectator') then
      raise exception 'not_watching';
    end if;
    v_ended := v_phase = 'complete';
  end if;
  v_run := 'watch:' || p_kind || ':' || p_target;

  perform pg_advisory_xact_lock(hashtextextended('spectate:' || v_uid::text, 0));
  delete from public.spectate_sessions where user_id = v_uid and last_seen_at < v_now - c_keep;
  select * into v_pres from public.spectate_presence where user_id = v_uid;
  if found and v_pres.run_id = v_run and v_now > v_pres.at and v_now - v_pres.at <= c_gap then
    v_add := floor(extract(epoch from (v_now - v_pres.at)) * 1000)::bigint;
  end if;
  insert into public.spectate_sessions as ss (user_id, run_id, kind, target, watched_user, watched_ms, first_seen_at, last_seen_at, game_started_at, saw_end_at)
    values (v_uid, v_run, p_kind, p_target, v_watched, 0, v_now, v_now, v_started, case when v_ended then v_now end)
    on conflict (user_id, run_id) do update set
      watched_ms = ss.watched_ms + v_add,
      last_seen_at = v_now,
      watched_user = coalesce(ss.watched_user, excluded.watched_user),
      game_started_at = coalesce(ss.game_started_at, excluded.game_started_at),
      saw_end_at = coalesce(ss.saw_end_at, excluded.saw_end_at)
    returning ss.watched_ms into v_ms;
  insert into public.spectate_presence (user_id, run_id, at) values (v_uid, v_run, v_now)
    on conflict (user_id) do update set run_id = excluded.run_id, at = excluded.at;
  return jsonb_build_object('runId', v_run, 'watchedMs', v_ms, 'ended', v_ended);
end;
$$;
revoke all on function public.spectate_beat(text, text) from public, anon;
grant execute on function public.spectate_beat(text, text) to authenticated;

-- ── 4. settle_progression: the 2026-10-20 body, Versus at 50% (1v1 + Group) and the spectate branch ──────────
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
  c_top_four          constant int := 60;
  c_first_place       constant int := 90;
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
  -- VERSUS (owner 2026-10-14: "versus can complete achievements and grant XP but no rank progress"; 2026-10-24: "versus
  -- modes should grant account xp. just make it 50% of a 'normal' game for now")
  c_versus_percent    constant int := 50;
  c_versus_min_rounds constant int := 1;
  c_lobby_seats       constant int := 8;
  -- SPECTATE (owner 2026-10-24: "watching a player's game rewards 50% of the xp at the end of the match"). The watch
  -- record (`spectate_sessions`, written by `spectate_beat`) must show the spectator watching at the end and for at
  -- least half the game, capped at 5 minutes; a lobby game whose rank row has not landed yet is retried for 2 hours.
  c_spectate_percent  constant int := 50;
  c_spectate_cap_ms   constant bigint := 300000;
  c_spectate_end_gap  constant interval := interval '45 seconds';
  c_spectate_wait     constant interval := interval '2 hours';

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
  v_base int := 0; v_top int := 0; v_first int := 0; v_come int := 0; v_total int; v_pct int;
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
  -- versus
  v_match      public.versus_matches%rowtype;
  v_vs_seat    text := null;
  v_ach_place  int := null;
  v_seats      int := 2;
  v_g_id uuid; v_g_phase text; v_g_done timestamptz; v_g_count int; v_g_seat text; v_g_hero text; v_g_place int; v_g_out_round int; v_g_out text;
  -- spectate
  v_spec       public.spectate_sessions%rowtype;
  v_game_start timestamptz;
  v_game_end   timestamptz;
  v_need_ms    bigint;
  -- aether (2026-10-18): no constants; the numbers are the aether_config economy, read once
  v_aether     boolean := false;
  v_eco        jsonb;
  v_ae_base    int := 0;
  v_ae_place   int := 0;
  v_ae_every   int;
begin
  -- 1. validate
  if p_mode is null or p_mode not in ('ranked', 'practice', 'tutorial', 'versus', 'spectate') then raise exception 'bad_mode'; end if;
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
  elsif p_mode = 'versus' then
    -- VERSUS: the source is the server-owned match row, a 1v1 `versus_matches` row or (2026-10-24) a Versus Group
    -- `versus_group_matches` row (the ids are uuids, so one never names the other). The caller must have held a PLAYER
    -- seat and fought at least one round. 1v1: the match must be over; winner = 1st, loser = 2nd, nobody = null. Group: the
    -- seat's own placement once it is final (knocked out, or the match over), so a player knocked out early settles then.
    -- The Versus place is then put on the lobby's scale (`versusLobbyPlacement`: the same share of the table, winner 1st)
    -- and that is what the ledger stores. XP only: rank_results, rating and MMR are never read or written here.
    if p_run_id !~ '^versus:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_run_id'; end if;
    select * into v_match from public.versus_matches m where m.id = substring(p_run_id from 8)::uuid;
    if found then
      v_vs_seat := case when v_match.p1_user = p_user then 'p1' when v_match.p2_user = p_user then 'p2' end;
      if v_vs_seat is null then raise exception 'source_not_found'; end if;
      if v_match.phase <> 'complete' or v_match.completed_at is null then raise exception 'not_terminal'; end if;
      if not exists (select 1 from public.versus_rounds vr where vr.match_id = v_match.id and vr.round >= c_versus_min_rounds) then raise exception 'not_terminal'; end if;
      v_source_at := v_match.completed_at;
      v_source := v_match.id::text;
      v_placement := case when v_match.winner_seat is null then null when v_match.winner_seat = v_vs_seat then 1 else 2 end;
      v_seats := 2;
      v_hero := case when v_vs_seat = 'p1' then v_match.p1_hero else v_match.p2_hero end;
    else
      select g.id, g.phase, g.completed_at, g.seat_count into v_g_id, v_g_phase, v_g_done, v_g_count
        from public.versus_group_matches g where g.id = substring(p_run_id from 8)::uuid;
      if not found then raise exception 'source_not_found'; end if;
      select s.seat, s.hero, s.placement, s.eliminated_round, s.out_reason into v_g_seat, v_g_hero, v_g_place, v_g_out_round, v_g_out
        from public.versus_group_seats s where s.match_id = v_g_id and s.user_id = p_user;
      if not found then raise exception 'source_not_found'; end if;
      if v_g_place is null and (v_g_phase <> 'complete' or v_g_done is null) then raise exception 'not_terminal'; end if;
      -- The seat FOUGHT a round: one committed before it went out, or the round that knocked it out of hearts.
      if not exists (select 1 from public.versus_group_rounds gr where gr.match_id = v_g_id and gr.round >= c_versus_min_rounds
          and (v_g_out_round is null or gr.round < v_g_out_round or (gr.round = v_g_out_round and v_g_out = 'hearts'))) then
        raise exception 'not_terminal';
      end if;
      v_source_at := coalesce(v_g_done, now());
      v_source := v_g_id::text;
      v_placement := case when v_g_place between 1 and 4 then v_g_place end;
      v_seats := greatest(2, coalesce(v_g_count, 4));
      v_hero := v_g_hero;
    end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    -- On the lobby's scale: the winner 1st, any other place p of n seats ceil(p * 8 / n).
    v_placement := case when v_placement is null then null when v_placement = 1 then 1
      else least(c_lobby_seats, (v_placement * c_lobby_seats + v_seats - 1) / v_seats) end;
    v_comeback := false;
  elsif p_mode = 'spectate' then
    -- SPECTATE: the source is the server's own watch record for this spectator and game (`spectate_beat` wrote it while
    -- they watched; the request names only which game). No XP for watching your own game; the game must be over, the
    -- spectator present at its end and watching for at least half of it (at most 5 minutes needed). Never a placement,
    -- a comeback, a hero or an achievement: half a game's completion XP.
    if p_run_id !~ '^watch:(lobby:[!-~]{1,80}|(versus|group):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' then raise exception 'bad_run_id'; end if;
    select * into v_spec from public.spectate_sessions ss where ss.user_id = p_user and ss.run_id = p_run_id;
    if not found then raise exception 'source_not_found'; end if;
    if v_spec.kind = 'lobby' then
      if v_spec.watched_user is null or v_spec.watched_user = p_user then raise exception 'own_game'; end if;
      -- The game's end, seen while watching (a beat landed while its listing showed the end).
      if v_spec.saw_end_at is null then raise exception 'not_terminal'; end if;
      -- A real, accepted ranked game: the player's own rank row for it. It can land a little after the end.
      if not exists (select 1 from public.rank_results rr where rr.user_id = v_spec.watched_user and rr.run_id = v_spec.target) then
        if v_spec.saw_end_at > now() - c_spectate_wait then raise exception 'not_yet'; end if;
        raise exception 'source_not_found';
      end if;
      v_game_start := coalesce(v_spec.game_started_at, v_spec.first_seen_at);
      v_game_end := v_spec.saw_end_at;
    elsif v_spec.kind = 'versus' then
      select * into v_match from public.versus_matches m where m.id = v_spec.target::uuid;
      if not found then raise exception 'source_not_found'; end if;
      if p_user in (v_match.p1_user, v_match.p2_user) then raise exception 'own_game'; end if;
      if v_match.phase <> 'complete' or v_match.completed_at is null then raise exception 'not_terminal'; end if;
      if not exists (select 1 from public.versus_rounds vr where vr.match_id = v_match.id and vr.round >= c_versus_min_rounds) then raise exception 'not_terminal'; end if;
      v_game_start := v_match.created_at;
      v_game_end := v_match.completed_at;
    else
      select g.id, g.phase, g.completed_at, g.created_at into v_g_id, v_g_phase, v_g_done, v_game_start
        from public.versus_group_matches g where g.id = v_spec.target::uuid;
      if not found then raise exception 'source_not_found'; end if;
      if exists (select 1 from public.versus_group_seats s where s.match_id = v_g_id and s.user_id = p_user) then raise exception 'own_game'; end if;
      if v_g_phase <> 'complete' or v_g_done is null then raise exception 'not_terminal'; end if;
      if not exists (select 1 from public.versus_group_rounds gr where gr.match_id = v_g_id and gr.round >= c_versus_min_rounds) then raise exception 'not_terminal'; end if;
      v_game_end := v_g_done;
    end if;
    -- Present at the end, and watched enough of it (beats only accrue time for the ONE game a spectator is watching).
    if v_spec.last_seen_at < v_game_end - c_spectate_end_gap then raise exception 'not_enough'; end if;
    v_need_ms := least(c_spectate_cap_ms, greatest(0, floor(extract(epoch from (v_game_end - v_game_start)) * 1000 / 2))::bigint);
    if v_spec.watched_ms < v_need_ms then raise exception 'not_enough'; end if;
    v_source_at := v_game_end;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_run_id;
    v_placement := null;
    v_comeback := false;
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
  elsif p_mode = 'spectate' then
    v_base := (c_complete * c_spectate_percent + 50) / 100;
  elsif p_mode = 'versus' and v_placement is null then
    -- VERSUS with no winner (abandoned): half the completion XP.
    v_base := (c_complete * c_versus_percent + 50) / 100;
  elsif p_mode = 'practice' and v_placement is null then
    v_base := c_practice_flat;
  else
    r_top   := case when v_placement <= 4 then c_top_four else 0 end;
    r_first := case when v_placement = 1 then c_first_place else 0 end;
    r_come  := case when v_comeback then c_comeback else 0 end;
    if p_mode = 'ranked' then
      v_base := c_complete; v_top := r_top; v_first := r_first; v_come := r_come;
    else
      -- Practice: 60% of the equivalent ranked XP; Versus (2026-10-24): 50%, its placement already on the lobby's scale
      -- and never a comeback. Summed then rounded; the remainder lands on the base.
      v_pct   := case when p_mode = 'versus' then c_versus_percent else c_practice_percent end;
      v_ranked_total := c_complete + r_top + r_first + r_come;
      v_top   := (r_top   * v_pct + 50) / 100;
      v_first := (r_first * v_pct + 50) / 100;
      v_come  := (r_come  * v_pct + 50) / 100;
      v_base  := (v_ranked_total * v_pct + 50) / 100 - v_top - v_first - v_come;
    end if;
  end if;
  v_total := v_base + v_top + v_first + v_come;

  -- 7a. AETHER (owner 2026-10-18: Aether replaces level-up crates; mirror of aetherForSettlement in
  -- packages/progression/src/aether.ts). Only with the switch on. Ranked: the base + the placement bonus, win or lose,
  -- for a VALID placement (none = the ladder never accepted the game: 0). Versus: the completion pay for ANY finished
  -- match (won, lost or abandoned with no winner) + the win bonus at placement 1. Practice and Tutorial: 0; no
  -- comeback bonus. Credited with reason = the mode, source = the run id, only when the total is above 0. An
  -- UNREADABLE economy (no row; a value this game needs, or `milestoneEvery`, not a valid integer; `milestoneEvery`
  -- below 1) turns Aether off FOR THIS SETTLEMENT: today's level crates, `aether` null, the XP untouched. A bad retune
  -- must never block a game (a raise here would fail every settlement until the config is fixed).
  select aether_enabled into v_aether from public.progression_config where id = 1;
  v_aether := coalesce(v_aether, false);
  if v_aether then
    select economy into v_eco from public.aether_config where id = 1;
    v_ae_every := public.aether_economy_int(v_eco, array['milestoneEvery']);
    if p_mode = 'ranked' and v_placement between 1 and 8 then
      v_ae_base  := public.aether_economy_int(v_eco, array['rankedBase']);
      v_ae_place := public.aether_economy_int(v_eco, array['rankedPlacementBonus', (v_placement - 1)::text]);
    elsif p_mode = 'versus' then
      v_ae_base  := public.aether_economy_int(v_eco, array['versusComplete']);
      -- read (and so checked) for both players, paid to the winner only
      v_ae_place := public.aether_economy_int(v_eco, array['versusWin']);
      if v_ae_place is not null and v_placement is distinct from 1 then v_ae_place := 0; end if;
    end if;
    if v_ae_every is null or v_ae_every < 1 or v_ae_base is null or v_ae_place is null then
      v_aether := false; v_ae_base := 0; v_ae_place := 0;
    elsif v_ae_base + v_ae_place > 0 then
      perform public.aether_apply(p_user, v_ae_base + v_ae_place, p_mode, p_run_id);
    end if;
  end if;

  if p_facts is not null and jsonb_typeof(p_facts) = 'object' and (p_facts->>'version') ~ '^[0-9]+$' then
    v_facts_ver := (p_facts->>'version')::int;
  end if;

  -- 7b. ACHIEVEMENTS (mirror of evaluateAchievements in packages/progression/src/achievements.ts). Only once the
  -- owner has set the achievements epoch, and only for a game whose source row is not older than it.
  -- SPECTATE (2026-10-24) never touches achievements: watching is not playing.
  if p_mode <> 'spectate' and v_ach_epoch is not null and coalesce(v_source_at, now()) >= v_ach_epoch then
    -- The `any` gate: Ranked, or a standard Practice (Normal Health, so a real placement, AND a turn timer).
    v_run_ok := p_mode = 'ranked' or p_mode = 'versus'
      or (p_mode = 'practice' and v_placement is not null and coalesce(v_cfg->>'timeMult', '') ~ '^[1-9][0-9]*$');
    if p_mode = 'ranked' then v_hero := p_facts->>'heroId'; end if;
    -- VERSUS: a 1v1 "1st" is not a lobby finish, so placement-gated achievements (Top 4, 1st) never count it.
    v_ach_place := case when p_mode = 'versus' then null else v_placement end;
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
      continue when d.placement_max is not null and (v_ach_place is null or v_ach_place > d.placement_max);
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
  -- AETHER ON (owner 2026-10-18): no crate per level. The Welcome Crate (Level 1, floor Common) on enrollment, as
  -- before, and one floor-EPIC crate per milestone level at or below the new level (mirror of
  -- milestoneLevelsThrough), `source = 'milestone:<L>'`, so the one-crate-per-source index makes it once per
  -- milestone and a missing one self-heals. `v_crate_ids` holds only the rows actually created, Welcome first.
  -- AETHER OFF: the unchanged per-level insert below the `else` (kept byte-for-byte, hence its indentation).
  v_enrolling := prof.progression_enrolled_at is null;
  if v_aether then
    with ins as (
      insert into public.loot_crates (user_id, earned_level, source_id)
        select p_user, 1, p_mode || ':' || p_run_id where v_enrolling
        on conflict (user_id, earned_level) do nothing
        returning crate_id
    )
    select coalesce(array_agg(ins.crate_id), '{}') into v_crate_ids from ins;
    if v_ae_every >= 1 then
      with ins as (
        insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity)
          select p_user, null, 'milestone:' || g.lvl, p_mode || ':' || p_run_id, 'epic'
          from generate_series(v_ae_every, v_l1, v_ae_every) as g(lvl)
          on conflict (user_id, source) where source is not null do nothing
          returning crate_id, source
      )
      select v_crate_ids || coalesce(array_agg(ins.crate_id order by split_part(ins.source, ':', 2)::int), '{}')
        into v_crate_ids from ins;
    end if;
  else
  with ins as (
    insert into public.loot_crates (user_id, earned_level, source_id)
      select p_user, g.lvl, p_mode || ':' || p_run_id
      from generate_series(case when v_enrolling then 1 else v_l0 + 1 end, v_l1) as g(lvl)
      on conflict (user_id, earned_level) do nothing
      returning crate_id, earned_level
  )
  select coalesce(array_agg(ins.crate_id order by ins.earned_level), '{}') into v_crate_ids from ins;
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

  insert into public.progression_results (
    user_id, run_id, mode, source_id, rules_version, curve_version, facts_version, facts,
    placement, comeback, base_xp, top_four_xp, first_place_xp, comeback_xp, achievement_xp, total_xp,
    xp_before, xp_after, level_before, level_after, revision_before, revision_after,
    crates_awarded, crate_ids, achievement_ids, unlocked_title_ids,
    aether_base, aether_placement, aether_total, aether_on
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, v_ach_xp, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    coalesce(array_length(v_crate_ids, 1), 0), v_crate_ids, v_ach_ids, v_unlocked,
    v_ae_base, v_ae_place, v_ae_base + v_ae_place, v_aether
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;
