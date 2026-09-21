-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- MEDAL RANK — season 3  (2026-09-20)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run) EXCEPT the clearly-marked season
-- reset at the very bottom, which is commented out and run ONCE, deliberately, by the owner. The same block
-- is appended to schema.sql (the cumulative paste file) — keep the two identical.
-- Owner runbook: docs/rank-season-runbook.md.
--
-- WHAT THIS IS. The numeric ladder (`profiles.rating` moved by a ±100 placement table) becomes a MEDAL ladder:
-- six medals × three divisions (index 0 = Bronze III … 17 = Ascendant I), 100 points each, promotion GAMES
-- at 100 (top-4 to move a division, 1st to move a medal), demotion below 0 within a medal, a DEMOTION GAME
-- at 0 on a medal's lowest division (bottom-4 drops to the previous medal's I at 100 + award, top-4 escapes),
-- Bronze III floored, Ascendant I uncapped. The rules live in THREE places that must agree: `settle_rank` below (the WRITER — the only thing
-- that moves a rank), `supabase/functions/_shared/lobbyRating.ts` (the Edge Function's runtime parity check)
-- and `packages/sim/src/rank.ts` (the client, CI-parity-tested against the shared TS file). Change all three
-- together and bump the rules version in all three.
--
-- WHY A DATABASE FUNCTION. The old C3 function inserted the dedupe ledger row, THEN updated the profile in a
-- second statement: a failure between the two consumed the dedupe key without awarding points, two
-- concurrent submissions could read the same profile and overwrite each other, and a duplicate returned
-- today's profile rather than the original game's before/after. `settle_rank` does the whole settlement in
-- ONE transaction under a row lock: lock profile → ledger check (a duplicate returns the ORIGINAL result) →
-- rate limit (raises → nothing committed) → resolve → write profile + revision + immutable result → commit.
--
-- ── 1. profiles: the rank columns ─────────────────────────────────────────────────────────────────────────
-- `rating` STAYS and becomes the derived reporting scalar `100 × rank_division + rank_points`, maintained by
-- `settle_rank`, so every numeric surface (leaderboard order, the title chip) keeps working until it is
-- medal-aware. `rank_season = 0` means "never ranked under medals"; `settle_rank` treats any season other
-- than the live one as a fresh Bronze III start on that account's first settlement.
alter table public.profiles add column if not exists rank_season           int not null default 0;
alter table public.profiles add column if not exists rank_rules_version    int not null default 1;
alter table public.profiles add column if not exists rank_division         int not null default 0;
alter table public.profiles add column if not exists rank_points           int not null default 0;
alter table public.profiles add column if not exists rank_highest_division int not null default 0;
alter table public.profiles add column if not exists rank_highest_points   int not null default 0;
-- Monotonic per account (+1 per settlement, +1 on a reset). The client adopts a server profile only when its
-- revision is not older than the mirror's — so a late answer never rolls a newer profile back. HAND-EDITS TO
-- A RANK MUST BUMP THIS TOO, or the edited client keeps its mirror.
alter table public.profiles add column if not exists rank_revision         int not null default 0;
-- A snapshot of the season-2 numeric rating, taken by the season reset (bottom) before `rating` is zeroed.
alter table public.profiles add column if not exists season2_rating        int;

alter table public.profiles drop constraint if exists profiles_rank_division_range;
alter table public.profiles add  constraint profiles_rank_division_range
  check (rank_division between 0 and 17);
alter table public.profiles drop constraint if exists profiles_rank_points_range;
alter table public.profiles add  constraint profiles_rank_points_range
  check (rank_points >= 0 and (rank_division = 17 or rank_points <= 100));
alter table public.profiles drop constraint if exists profiles_rank_highest_range;
alter table public.profiles add  constraint profiles_rank_highest_range
  check (rank_highest_division between 0 and 17 and rank_highest_points >= 0
         and (rank_highest_division = 17 or rank_highest_points <= 100));
-- Leaderboard order: division first, then points (the scalar ties Gold II 100 with Gold I 0 — the promoted
-- player ranks above the one still waiting at the gate).
create index if not exists profiles_rank on public.profiles (rank_division desc, rank_points desc);

-- ── 2. rank_results: the immutable settlement ledger ──────────────────────────────────────────────────────
-- One row per (player, run): the dedupe key AND the durable result the post-game screen animates. Written
-- ONLY by `settle_rank`. A player may read their own rows (the Career can join them by run_id / seed);
-- nobody can insert, update or delete through the API.
create table if not exists public.rank_results (
  user_id                uuid not null references auth.users(id) on delete cascade,
  run_id                 text not null,
  seed                   bigint,
  season                 int not null,
  rules_version          int not null,
  placement              int not null check (placement between 1 and 8),
  revision_before        int not null,
  revision_after         int not null,
  division_before        int not null,
  points_before          int not null,
  division_after         int not null,
  points_after           int not null,
  highest_division_after int not null,
  highest_points_after   int not null,
  base_delta             int not null,
  applied_delta          int not null,
  capped_points          int not null,
  was_promotion_game     boolean not null,
  promotion_kind         text check (promotion_kind is null or promotion_kind in ('division', 'medal')),
  required_finish        int,
  promotion_unlocked     boolean not null,
  promoted               boolean not null,
  was_demotion_game      boolean not null default false,
  demotion_unlocked      boolean not null default false,
  demoted                boolean not null,
  created_at             timestamptz not null default now(),
  primary key (user_id, run_id)
);
alter table public.rank_results enable row level security;
drop policy if exists "read own rank_results" on public.rank_results;
create policy "read own rank_results" on public.rank_results for select to authenticated using (auth.uid() = user_id);
create index if not exists rank_results_user_time on public.rank_results (user_id, created_at desc);
-- (idempotent for a table created before the demotion gate landed the same day)
alter table public.rank_results add column if not exists was_demotion_game boolean not null default false;
alter table public.rank_results add column if not exists demotion_unlocked boolean not null default false;

-- ── 3. RLS: a client can never write a rank field ─────────────────────────────────────────────────────────
-- INSERT: a brand-new profile row is a PLACEHOLDER only — rating 0, Bronze III, revision 0, no season. The
-- client (`uploadPlayerProfile`) inserts exactly that; anything else is refused.
drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles for insert to authenticated
  with check (
    auth.uid() = user_id
    and rating = 0
    and rank_season = 0 and rank_division = 0 and rank_points = 0
    and rank_highest_division = 0 and rank_highest_points = 0 and rank_revision = 0
    and season2_rating is null
  );
-- UPDATE: the display columns (author, games_played, favorite_hero, patch, email, discriminator) may change;
-- `rating` and every `rank_*` column must arrive EQUAL to the stored value. (The C1 policy did this for
-- `rating` alone — a client update must not carry these columns at all; `uploadPlayerProfile` sends only the
-- display columns, pinned by playerProfileWrite.test.ts.)
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and rating                = (select p.rating                from public.profiles p where p.user_id = auth.uid())
    and rank_season           = (select p.rank_season           from public.profiles p where p.user_id = auth.uid())
    and rank_rules_version    = (select p.rank_rules_version    from public.profiles p where p.user_id = auth.uid())
    and rank_division         = (select p.rank_division         from public.profiles p where p.user_id = auth.uid())
    and rank_points           = (select p.rank_points           from public.profiles p where p.user_id = auth.uid())
    and rank_highest_division = (select p.rank_highest_division from public.profiles p where p.user_id = auth.uid())
    and rank_highest_points   = (select p.rank_highest_points   from public.profiles p where p.user_id = auth.uid())
    and rank_revision         = (select p.rank_revision         from public.profiles p where p.user_id = auth.uid())
    and season2_rating is not distinct from (select p.season2_rating from public.profiles p where p.user_id = auth.uid())
  );

-- The legacy numeric door is CLOSED for good: C3 revoked it from clients; the medal ladder drops it so no
-- deployment can ever let the old client-computed number write the new ladder.
drop function if exists public.submit_own_rating(int);

-- ── 4. JSON shapes — MUST match `RankResult` / `RankedProfile` in packages/sim/src/rank.ts key-for-key ────
create or replace function public.rank_result_json(r public.rank_results)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'runId', r.run_id, 'seasonId', r.season, 'rulesVersion', r.rules_version,
    'revisionBefore', r.revision_before, 'revisionAfter', r.revision_after,
    'placement', r.placement,
    'before', jsonb_build_object('divisionIndex', r.division_before, 'points', r.points_before),
    'after',  jsonb_build_object('divisionIndex', r.division_after,  'points', r.points_after),
    'baseDelta', r.base_delta, 'appliedDelta', r.applied_delta, 'cappedPoints', r.capped_points,
    'wasPromotionGame', r.was_promotion_game, 'promotionKind', r.promotion_kind, 'requiredFinish', r.required_finish,
    'promotionUnlocked', r.promotion_unlocked, 'promoted', r.promoted,
    'wasDemotionGame', r.was_demotion_game, 'demotionUnlocked', r.demotion_unlocked, 'demoted', r.demoted,
    'highestAfter', jsonb_build_object('divisionIndex', r.highest_division_after, 'points', r.highest_points_after)
  );
$$;

create or replace function public.rank_profile_json(p public.profiles)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'seasonId', p.rank_season, 'rulesVersion', p.rank_rules_version, 'revision', p.rank_revision,
    'position', jsonb_build_object('divisionIndex', p.rank_division, 'points', p.rank_points),
    'highest',  jsonb_build_object('divisionIndex', p.rank_highest_division, 'points', p.rank_highest_points)
  );
$$;

-- ── 5. settle_rank — THE writer. Service role only. ───────────────────────────────────────────────────────
-- Order (blueprint §6): validate → ensure + LOCK the profile row → ledger check under the lock (duplicate →
-- the ORIGINAL result, no second award) → rate limit (raise → nothing committed) → resolve from the locked
-- profile → write profile + revision + immutable result → (best-effort) stamp the career row → return both
-- the result and the current authoritative profile. Any `raise` rolls everything back.
--
-- The resolver branches are the same as `resolveRank` in packages/sim/src/rank.ts, in the same order:
--   top division: add the award uncapped; below 0 → demote to 100 + result.
--   at a gate (points = 100 below the top): placement ≤ required (4 for a division gate, 1 for a medal gate)
--     → promote ONE division to 0/100; a positive award short of a MEDAL gate (2nd–4th) HOLDS at 100, still
--     promotion-ready; a negative award applies normally from 100.
--   at a demotion gate (points = 0 on a medal's lowest division above Bronze — DERIVED, never stored): a
--     bottom-4 (5th–8th) demotes ONE division to the previous medal's I at 100 + award; a top-4 escapes and
--     applies its positive award normally from 0.
--   otherwise add the award: ≥ 100 → exactly 100, promotion unlocked (overflow discarded); < 0 → demote one
--     division to 100 + result within a medal, CLAMP at 0 on a medal's lowest division (demotion-ready),
--     Bronze III floors at 0 with no gate; exactly 0 stays.
--   highest = max(highest, after) by division then points; revision + 1; rating = the scalar.
create or replace function public.settle_rank(
  p_user uuid, p_run_id text, p_placement int, p_season int, p_rules_version int, p_seed bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of RANK_RULES / _shared/lobbyRating.ts — change all three together)
  c_season          constant int := 3;
  c_rules           constant int := 1;
  c_cap             constant int := 100;
  c_top             constant int := 17;
  c_per_medal       constant int := 3;
  c_awards          constant int[] := array[40, 28, 16, 6, -6, -16, -28, -40];
  c_division_finish constant int := 4;
  c_medal_finish    constant int := 1;
  c_demotion_finish constant int := 4;   -- worst placement that still ESCAPES a demotion game
  c_rate_max        constant int := 20;
  c_rate_window     constant interval := interval '10 minutes';

  prof       public.profiles%rowtype;
  prev       public.rank_results%rowtype;
  v_base     int;
  v_pts      int;
  d0 int; p0 int; d1 int; p1 int; hd int; hp int;
  v_gate     boolean := false;
  v_kind     text := null;
  v_required int := null;
  v_unlocked boolean := false;
  v_promoted boolean := false;
  v_dgate    boolean := false;
  v_dunlock  boolean := false;
  v_demoted  boolean := false;
  v_applied  int;
  v_capped   int;
  v_recent   int;
begin
  -- 1. validate
  if p_placement is null or p_placement < 1 or p_placement > 8 then raise exception 'bad_placement'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_season is distinct from c_season then raise exception 'unsupported_season'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. ensure the row exists, then LOCK it (every entry point takes this lock first)
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.rank_results where user_id = p_user and run_id = p_run_id;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.rank_result_json(prev), 'profile', public.rank_profile_json(prof));
  end if;

  -- 4. rate limit — a raise rolls the transaction back, so a refused request leaves no ledger row
  select count(*) into v_recent from public.rank_results
    where user_id = p_user and created_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 5. resolve from the LOCKED profile. A profile from another season (or never ranked) starts fresh.
  if prof.rank_season is distinct from c_season then
    d0 := 0; p0 := 0; hd := 0; hp := 0;
  else
    d0 := prof.rank_division; p0 := prof.rank_points;
    hd := prof.rank_highest_division; hp := prof.rank_highest_points;
  end if;

  v_base := c_awards[p_placement];
  d1 := d0; p1 := p0;

  if d0 < c_top and p0 = c_cap then
    -- promotion game
    v_gate := true;
    if (d0 % c_per_medal) = c_per_medal - 1 then v_kind := 'medal'; v_required := c_medal_finish;
    else v_kind := 'division'; v_required := c_division_finish; end if;
    if p_placement <= v_required then
      v_promoted := true; d1 := d0 + 1; p1 := 0;              -- a won gate starts the next division at 0
    elsif v_base >= 0 then
      d1 := d0; p1 := p0;                                     -- medal gate, 2nd–4th: hold at 100
    else
      v_pts := p0 + v_base;                                   -- the normal negative award from 100 (≥ 60 with this table)
      if v_pts < 0 then
        if d0 = 0 then d1 := 0; p1 := 0;
        elsif (d0 % c_per_medal) = 0 then d1 := d0; p1 := 0;  -- medal floor: clamp → demotion-ready
        else v_demoted := true; d1 := d0 - 1; p1 := c_cap + v_pts; end if;
      else
        d1 := d0; p1 := v_pts;
      end if;
    end if;
  elsif d0 > 0 and (d0 % c_per_medal) = 0 and p0 = 0 then
    -- demotion game (derived: 0 points on a medal's lowest division above Bronze)
    v_dgate := true; v_required := c_demotion_finish;
    if p_placement <= v_required then
      d1 := d0; p1 := p0 + v_base;                            -- escape: the positive award from 0 (< 100 with this table)
      if p1 >= c_cap then v_unlocked := true; p1 := c_cap; end if;
    else
      v_demoted := true; d1 := d0 - 1; p1 := c_cap + v_base;  -- to the previous medal's I at 100 + award
    end if;
  else
    v_pts := p0 + v_base;
    if d0 = c_top then
      if v_pts >= 0 then d1 := c_top; p1 := v_pts;            -- Ascendant I: uncapped
      else v_demoted := true; d1 := c_top - 1; p1 := c_cap + v_pts; end if;
    elsif v_pts >= c_cap then
      v_unlocked := true; d1 := d0; p1 := c_cap;              -- gate reached; overflow discarded
    elsif v_pts < 0 then
      if d0 = 0 then d1 := 0; p1 := 0;                        -- Bronze III floor, no gate
      elsif (d0 % c_per_medal) = 0 then d1 := d0; p1 := 0;    -- medal floor: clamp → demotion-ready
      else v_demoted := true; d1 := d0 - 1; p1 := c_cap + v_pts; end if;
    else
      d1 := d0; p1 := v_pts;
    end if;
  end if;
  v_dunlock := (d1 > 0 and (d1 % c_per_medal) = 0 and p1 = 0);  -- ends demotion-ready

  v_applied := (c_cap * d1 + p1) - (c_cap * d0 + p0);
  if v_promoted then v_capped := 0; else v_capped := greatest(0, abs(v_base) - abs(v_applied)); end if;
  if d1 > hd or (d1 = hd and p1 > hp) then hd := d1; hp := p1; end if;

  -- 6. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    rank_season = c_season, rank_rules_version = c_rules,
    rank_division = d1, rank_points = p1,
    rank_highest_division = hd, rank_highest_points = hp,
    rank_revision = prof.rank_revision + 1,
    rating = c_cap * d1 + p1,
    updated_at = now()
  where user_id = p_user;

  insert into public.rank_results (
    user_id, run_id, seed, season, rules_version, placement,
    revision_before, revision_after,
    division_before, points_before, division_after, points_after,
    highest_division_after, highest_points_after,
    base_delta, applied_delta, capped_points,
    was_promotion_game, promotion_kind, required_finish, promotion_unlocked, promoted,
    was_demotion_game, demotion_unlocked, demoted
  ) values (
    p_user, p_run_id, p_seed, c_season, c_rules, p_placement,
    prof.rank_revision, prof.rank_revision + 1,
    d0, p0, d1, p1,
    hd, hp,
    v_base, v_applied, v_capped,
    v_gate, v_kind, v_required, v_unlocked, v_promoted,
    v_dgate, v_dunlock, v_demoted
  ) returning * into prev;

  -- 7. best-effort: stamp the confirmed result onto the matching career row (it usually exists by now — the
  --    history insert fires at the same moment as this settlement; a miss is harmless, the ledger is the truth)
  if p_seed is not null then
    update public.run_history
      set entry = entry || jsonb_build_object(
        'rank', public.rank_result_json(prev),
        'ratingBefore', c_cap * d0 + p0, 'ratingAfter', c_cap * d1 + p1, 'ratingDelta', v_applied
      )
      where user_id = p_user and mode = 'lobby' and placement = p_placement and entry->>'seed' = p_seed::text
        and not (entry ? 'rank');
  end if;

  select * into prof from public.profiles where user_id = p_user;
  return jsonb_build_object('status', 'ok', 'result', public.rank_result_json(prev), 'profile', public.rank_profile_json(prof));
end;
$$;

-- Service role ONLY. Functions are executable by PUBLIC by default — revoke that, then grant the one caller.
revoke all on function public.settle_rank(uuid, text, int, int, int, bigint) from public, anon, authenticated;
grant execute on function public.settle_rank(uuid, text, int, int, int, bigint) to service_role;
revoke all on function public.rank_result_json(public.rank_results) from public, anon, authenticated;
grant execute on function public.rank_result_json(public.rank_results) to service_role;
revoke all on function public.rank_profile_json(public.profiles) from public, anon, authenticated;
grant execute on function public.rank_profile_json(public.profiles) to service_role;

-- ── 6. SEASON RESET — run ONCE, deliberately (owner decision 2026-09-20: everyone starts Bronze III 0/100) ──
-- Commented out so a re-run of this file can never reset the ladder by accident. `season2_rating` keeps the
-- old number; `rank_revision + 1` makes every client adopt the reset on its next boot (a revision that went
-- DOWN would be ignored as stale). Old `rated_runs` rows and all `run_history` stay untouched.
--
-- update public.profiles set season2_rating = coalesce(season2_rating, rating);
-- update public.profiles set
--   rank_season = 3, rank_rules_version = 1,
--   rank_division = 0, rank_points = 0, rank_highest_division = 0, rank_highest_points = 0,
--   rank_revision = rank_revision + 1,
--   rating = 0, updated_at = now();
