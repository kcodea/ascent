-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- FIGHT LEDGER + LOBBY STRENGTH + the top-4 strength bonus  (2026-09-22)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). The same block is appended to
-- schema.sql (the cumulative paste file) — keep the two identical. Owner runbook: the devlog
-- docs/devlog/2026-09-22-hall-fight-ledger-lobby-strength.md. DEPLOY THE EDGE FUNCTION FIRST (it works against
-- both the old and the new database); then run this.
--
-- WHAT THIS IS (owner 2026-09-22: "we want the hall of champions to answer 'what board has been the best
-- against everything else' … overall win/loss across games. so a 15 round game may mean it was 12-3" … "make an
-- algorithm that can essentially assign a lobby strength value/indicator … make winning really difficult
-- lobbies more rewarding"). Three parts:
--
--   1. `lobby_fights` — ONE ROW PER FIGHT the table resolved, both sides named by their run key
--      (`author|heroId|seed` for a real run — the key the client groups the opponent pool by — or
--      `bot:<kind>:<heroId>` for a generated seat). The client writes every fight of a real lobby at its end:
--      the ones it witnessed (`observed = true`) plus, when its player fell before the table finished, the ones a
--      deterministic play-out of the remaining rounds resolved (`observed = false`). Ghost fights, sit-outs and
--      bot-versus-bot fights are never rows. The unique key makes the write idempotent (a run restored and
--      finished twice cannot count a fight twice).
--   2. `run_fight_records` — the per-run AGGREGATE the client reads (never a row pool): fights, W-L-D, distinct
--      lobbies, win rate, and a Wilson 95% lower bound of the win rate (the Hall's sort key: a 30-2 run ranks
--      above a 3-0 run). Public read through PostgREST like every other ledger.
--   3. `settle_rank` learns `p_seat_keys` — the seven opponent keys of the finished lobby. It recomputes the
--      LOBBY STRENGTH from the view at settle time (the mean over the seven of `(wins + 10) / (fights + 20)`,
--      a bot key a fixed 0.25, `round(100 × mean)`) and, for a TOP-4 finish, adds
--      `round(15 × placementWeight × clamp((strength − 30) / 70, 0, 1))` to the award BEFORE the gate / cap
--      logic, the weights 1.0 / 0.8 / 0.62 / 0.47 for 1st to 4th (owner anchors: 1st at 100 = +15, 1st at 75 =
--      +10, 4th at 100 = +7). Never on 5th–8th, never negative, losses untouched. The result records
--      `strength_bonus` and `lobby_strength`.
--      The old six-argument overload is DROPPED (a second overload would make the PostgREST rpc ambiguous);
--      the deployed Edge Function retries without the keys against a database that has not run this yet.
--
-- Everything is additive. Until this runs: the view 404s (the Hall shows its empty state, Career rows show no
-- strength) and the Edge Function settles without a bonus. Nothing breaks.

-- ── 1. lobby_fights ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.lobby_fights (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete set null, -- the REPORTER (whose lobby it was)
  lobby_seed  bigint  not null,            -- the lobby (= the reporting run's seed)
  round       int     not null,
  run_a       text    not null,            -- run key of side A (author|heroId|seed, or bot:<kind>:<heroId>)
  run_b       text    not null,            -- run key of side B
  outcome     text    not null,            -- 'a' | 'b' | 'draw', from A's side
  observed    boolean not null default true, -- false = resolved by the play-out after the reporter's elimination
  patch       text,
  created_at  timestamptz default now(),
  constraint lobby_fights_outcome        check (outcome in ('a', 'b', 'draw')),
  constraint lobby_fights_distinct_sides check (run_a <> run_b),
  constraint lobby_fights_one_per_pairing unique (lobby_seed, round, run_a, run_b)
);
create index if not exists lobby_fights_run_a on public.lobby_fights (run_a);
create index if not exists lobby_fights_run_b on public.lobby_fights (run_b);

alter table public.lobby_fights enable row level security;
drop policy if exists "read lobby_fights"       on public.lobby_fights;
drop policy if exists "insert own lobby_fights" on public.lobby_fights;
create policy "read lobby_fights"       on public.lobby_fights for select using (true);
create policy "insert own lobby_fights" on public.lobby_fights for insert to authenticated with check (auth.uid() = user_id);

-- ── 2. run_fight_records — the per-run aggregate ─────────────────────────────────────────────────────────
-- One row per run key over BOTH sides of every fight. `win_rate` = wins / fights (a draw is not a win).
-- `wilson_lb` = the Wilson score interval's lower bound at 95% (z = 1.959964), 0 when there are no fights.
create or replace view public.run_fight_records as
with sides as (
  select run_a as run_key, lobby_seed, created_at,
         (outcome = 'a')::int as win, (outcome = 'b')::int as loss, (outcome = 'draw')::int as draw
    from public.lobby_fights
  union all
  select run_b as run_key, lobby_seed, created_at,
         (outcome = 'b')::int as win, (outcome = 'a')::int as loss, (outcome = 'draw')::int as draw
    from public.lobby_fights
), agg as (
  select run_key,
         count(*)::int              as fights,
         sum(win)::int              as wins,
         sum(loss)::int             as losses,
         sum(draw)::int             as draws,
         count(distinct lobby_seed)::int as lobbies,
         max(created_at)            as last_fight_at
    from sides
   group by run_key
)
select run_key, fights, wins, losses, draws, lobbies, last_fight_at,
       case when fights = 0 then 0::float8 else wins::float8 / fights end as win_rate,
       case when fights = 0 then 0::float8 else
         ((wins::float8 / fights) + (1.959964 * 1.959964) / (2 * fights)
           - 1.959964 * sqrt(((wins::float8 / fights) * (1 - wins::float8 / fights) + (1.959964 * 1.959964) / (4 * fights)) / fights))
         / (1 + (1.959964 * 1.959964) / fights)
       end as wilson_lb
  from agg;
grant select on public.run_fight_records to anon, authenticated;

-- ── 3. rank_results learns the strength + the bonus ─────────────────────────────────────────────────────
alter table public.rank_results add column if not exists lobby_strength int;
alter table public.rank_results add column if not exists strength_bonus int not null default 0;

create or replace function public.rank_result_json(r public.rank_results)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'runId', r.run_id, 'seasonId', r.season, 'rulesVersion', r.rules_version,
    'revisionBefore', r.revision_before, 'revisionAfter', r.revision_after,
    'placement', r.placement,
    'before', jsonb_build_object('divisionIndex', r.division_before, 'points', r.points_before, 'demotionReady', r.demotion_ready_before),
    'after',  jsonb_build_object('divisionIndex', r.division_after,  'points', r.points_after,  'demotionReady', r.demotion_ready_after),
    'baseDelta', r.base_delta, 'strengthBonus', coalesce(r.strength_bonus, 0), 'lobbyStrength', r.lobby_strength,
    'appliedDelta', r.applied_delta, 'cappedPoints', r.capped_points,
    'wasPromotionGame', r.was_promotion_game, 'promotionKind', r.promotion_kind, 'requiredFinish', r.required_finish,
    'promotionUnlocked', r.promotion_unlocked, 'promoted', r.promoted,
    'wasDemotionGame', r.was_demotion_game, 'demotionUnlocked', r.demotion_unlocked, 'demoted', r.demoted,
    'highestAfter', jsonb_build_object('divisionIndex', r.highest_division_after, 'points', r.highest_points_after)
  );
$$;

-- ── 4. settle_rank — THE writer, now with the lobby-strength bonus. Service role only. ─────────────────────
-- The six-argument overload is dropped: `create or replace` with a new parameter list would ADD an overload,
-- and PostgREST's named-argument rpc would then see two candidates.
drop function if exists public.settle_rank(uuid, text, int, int, int, bigint);

-- Order (blueprint §6): validate → ensure + LOCK the profile row → ledger check under the lock (duplicate →
-- the ORIGINAL result, no second award) → rate limit (raise → nothing committed) → strength + bonus →
-- resolve from the locked profile → write profile + revision + immutable result → (best-effort) stamp the
-- career row → return both the result and the current authoritative profile. Any `raise` rolls everything back.
--
-- The resolver branches are the same as `resolveRank` in packages/sim/src/rank.ts, in the same order, with
-- v_base = the placement award + the top-4 strength bonus (0 for 5th–8th):
--   at a gate (points = 100 below the top): placement ≤ required (4 for a division gate, 1 for a medal gate)
--     → promote ONE division to c_promo_landing/100 (10 — owner 2026-09-21, was 0); a positive award short of
--     a MEDAL gate (2nd–4th) HOLDS at 100, still promotion-ready; a negative award applies normally from 100.
--   at an ARMED demotion gate (the STORED rank_demotion_ready flag): a bottom-4 (5th–8th) demotes ONE
--     division to the previous division at 100 + award (across a medal boundary: the previous medal's III);
--     a top-4 escapes, applies its positive award normally from 0, and disarms.
--   otherwise add the award: a LOSS landing on 0 (by clamp or exact subtraction) in ANY division above
--     Bronze I CLAMPS at 0 and ARMS the gate — there are NO instant demotions (owner 2026-09-21); Bronze I
--     floors at 0 with no gate; Ascendant III is uncapped upward; elsewhere ≥ 100 → exactly 100, promotion
--     unlocked (overflow discarded — a 1st at 90/100 in a Brutal lobby still lands on 100). A promotion
--     landing is never armed; any non-negative result disarms.
--   highest = max(highest, after) by division then points; revision + 1; rating = the scalar.
create or replace function public.settle_rank(
  p_user uuid, p_run_id text, p_placement int, p_season int, p_rules_version int, p_seed bigint default null,
  p_seat_keys text[] default null
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
  c_promo_landing   constant int := 10;  -- points a WON promotion lands on in the next division (owner 2026-09-21; was 0)
  c_rate_max        constant int := 20;
  c_rate_window     constant interval := interval '10 minutes';
  -- LOBBY STRENGTH + the top-4 bonus (mirror of packages/sim/src/lobbyStrength.ts — owner 2026-09-22)
  c_prior_wins      constant int := 10;      -- the smoothing prior: 10 wins in 20 fights (an unserved run reads 50)
  c_prior_fights    constant int := 20;
  c_bot_rate        constant float8 := 0.25; -- a generated seat's fixed win rate
  c_bonus_max       constant int := 15;      -- +15 for a 1st at strength 100
  c_bonus_floor     constant int := 30;      -- the factor is 0 at this strength and below
  c_bonus_span      constant int := 70;      -- 100 - c_bonus_floor: the factor is 1 at 100
  c_bonus_weights   constant float8[] := array[1.0, 0.8, 0.62, 0.47]; -- 1st, 2nd, 3rd, 4th; 5th-8th earn nothing
  c_tier_even       constant int := 35;      -- Easy < 35, Even 35-54, Hard 55-69, Brutal >= 70
  c_tier_hard       constant int := 55;
  c_tier_brutal     constant int := 70;

  prof       public.profiles%rowtype;
  prev       public.rank_results%rowtype;
  v_base     int;
  v_pts      int;
  d0 int; p0 int; d1 int; p1 int; hd int; hp int;
  r0 boolean; r1 boolean := false;
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
  v_strength int := null;
  v_bonus    int := 0;
  v_tier     text := null;
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

  -- 5. LOBBY STRENGTH from the fight ledger (owner 2026-09-22): the mean over the seven opponent keys of each
  --    run's smoothed win rate; a bot key is a fixed 0.25; a key with no row reads the prior (0.5). Then the
  --    TOP-4 bonus: round(c_bonus_max × c_bonus_weights[placement] × clamp((strength − c_bonus_floor) /
  --    c_bonus_span, 0, 1)), the SAME multiplication order as the two TS copies so the doubles agree before
  --    the round. No keys (an older client) → no strength, no bonus — exactly the pre-bonus ladder.
  if p_seat_keys is not null and cardinality(p_seat_keys) > 0 then
    select round((100 * avg(
             case when k like 'bot:%' then c_bot_rate
                  else (least(coalesce(r.fights, 0), greatest(0, coalesce(r.wins, 0))) + c_prior_wins)::float8
                       / (greatest(0, coalesce(r.fights, 0)) + c_prior_fights)
             end))::numeric)::int
      into v_strength
      from unnest(p_seat_keys) as k
      left join public.run_fight_records r on r.run_key = k;
    v_strength := least(100, greatest(0, v_strength));
    v_tier := case when v_strength >= c_tier_brutal then 'Brutal'
                   when v_strength >= c_tier_hard then 'Hard'
                   when v_strength >= c_tier_even then 'Even'
                   else 'Easy' end;
    if p_placement <= cardinality(c_bonus_weights) then
      v_bonus := round((c_bonus_max * c_bonus_weights[p_placement] * least(1.0::float8, greatest(0.0::float8, (v_strength - c_bonus_floor)::float8 / c_bonus_span)))::numeric)::int;
    end if;
  end if;

  -- 6. resolve from the LOCKED profile. A profile from another season (or never ranked) starts fresh.
  if prof.rank_season is distinct from c_season then
    d0 := 0; p0 := 0; r0 := false; hd := 0; hp := 0;
  else
    d0 := prof.rank_division; p0 := prof.rank_points; r0 := coalesce(prof.rank_demotion_ready, false);
    hd := prof.rank_highest_division; hp := prof.rank_highest_points;
  end if;

  v_base := c_awards[p_placement] + v_bonus;                  -- the award PLUS the top-4 strength bonus
  d1 := d0; p1 := p0;

  if d0 < c_top and p0 = c_cap then
    -- promotion game
    v_gate := true;
    if (d0 % c_per_medal) = c_per_medal - 1 then v_kind := 'medal'; v_required := c_medal_finish;
    else v_kind := 'division'; v_required := c_division_finish; end if;
    if p_placement <= v_required then
      v_promoted := true; d1 := d0 + 1; p1 := c_promo_landing; -- a won gate starts the next division at the landing (10)
    elsif v_base >= 0 then
      d1 := d0; p1 := p0;                                     -- medal gate, 2nd–4th: hold at 100
    else
      v_pts := p0 + v_base;                                   -- the normal negative award from 100 (≥ 60 with this table)
      if v_pts <= 0 and d0 > 0 then d1 := d0; p1 := 0; r1 := true; -- (unreachable with this table) a loss to 0 → ARM
      elsif v_pts < 0 then d1 := 0; p1 := 0;                  -- (unreachable with this table) Bronze I floor
      else d1 := d0; p1 := v_pts;
      end if;
    end if;
  elsif r0 then
    -- demotion game (the STORED flag — armed by an earlier loss that clamped at 0 in this division)
    v_dgate := true; v_required := c_demotion_finish;
    if p_placement <= v_required then
      d1 := d0; p1 := p0 + v_base;                            -- escape: the positive award from 0 (< 100 with this table)
      if d0 < c_top and p1 >= c_cap then v_unlocked := true; p1 := c_cap; end if;
    else
      v_demoted := true; d1 := d0 - 1; p1 := c_cap + v_base;  -- ONE division down at 100 + award (across a medal boundary: the previous medal's III)
    end if;
  else
    v_pts := p0 + v_base;
    if v_base < 0 and v_pts <= 0 and d0 > 0 then
      d1 := d0; p1 := 0; r1 := true;                          -- a LOSS lands on 0 in any division above Bronze I → ARMED (no instant demotion)
    elsif v_pts < 0 then
      d1 := 0; p1 := 0;                                       -- Bronze I floor, no gate (the only division that reaches here)
    elsif d0 = c_top then
      d1 := c_top; p1 := v_pts;                               -- Ascendant III: uncapped
    elsif v_pts >= c_cap then
      v_unlocked := true; d1 := d0; p1 := c_cap;              -- gate reached; overflow discarded
    else
      d1 := d0; p1 := v_pts;
    end if;
  end if;
  v_dunlock := r1;                                            -- this game ARMED the gate

  v_applied := (c_cap * d1 + p1) - (c_cap * d0 + p0);
  if v_promoted then v_capped := 0; else v_capped := greatest(0, abs(v_base) - abs(v_applied)); end if;
  if d1 > hd or (d1 = hd and p1 > hp) then hd := d1; hp := p1; end if;

  -- 7. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    rank_season = c_season, rank_rules_version = c_rules,
    rank_division = d1, rank_points = p1, rank_demotion_ready = r1,
    rank_highest_division = hd, rank_highest_points = hp,
    rank_revision = prof.rank_revision + 1,
    rating = c_cap * d1 + p1,
    updated_at = now()
  where user_id = p_user;

  insert into public.rank_results (
    user_id, run_id, seed, season, rules_version, placement,
    revision_before, revision_after,
    division_before, points_before, demotion_ready_before, division_after, points_after, demotion_ready_after,
    highest_division_after, highest_points_after,
    base_delta, applied_delta, capped_points,
    was_promotion_game, promotion_kind, required_finish, promotion_unlocked, promoted,
    was_demotion_game, demotion_unlocked, demoted,
    lobby_strength, strength_bonus
  ) values (
    p_user, p_run_id, p_seed, c_season, c_rules, p_placement,
    prof.rank_revision, prof.rank_revision + 1,
    d0, p0, r0, d1, p1, r1,
    hd, hp,
    v_base, v_applied, v_capped,
    v_gate, v_kind, v_required, v_unlocked, v_promoted,
    v_dgate, v_dunlock, v_demoted,
    v_strength, v_bonus
  ) returning * into prev;

  -- 8. best-effort: stamp the confirmed result onto the matching career row (it usually exists by now — the
  --    history insert fires at the same moment as this settlement; a miss is harmless, the ledger is the truth).
  --    The lobby strength is stamped too, but only when the client's own stamp is missing (the client's carries
  --    the seven inputs; the server's is the value + tier).
  if p_seed is not null then
    update public.run_history
      set entry = entry || jsonb_build_object(
        'rank', public.rank_result_json(prev),
        'ratingBefore', c_cap * d0 + p0, 'ratingAfter', c_cap * d1 + p1, 'ratingDelta', v_applied
      ) || case when v_strength is not null and not (entry ? 'lobbyStrength')
                then jsonb_build_object('lobbyStrength', jsonb_build_object('value', v_strength, 'tier', v_tier, 'inputs', '[]'::jsonb))
                else '{}'::jsonb end
      where user_id = p_user and mode = 'lobby' and placement = p_placement and entry->>'seed' = p_seed::text
        and not (entry ? 'rank');
  end if;

  select * into prof from public.profiles where user_id = p_user;
  return jsonb_build_object('status', 'ok', 'result', public.rank_result_json(prev), 'profile', public.rank_profile_json(prof));
end;
$$;

-- Service role ONLY. Functions are executable by PUBLIC by default — revoke that, then grant the one caller.
revoke all on function public.settle_rank(uuid, text, int, int, int, bigint, text[]) from public, anon, authenticated;
grant execute on function public.settle_rank(uuid, text, int, int, int, bigint, text[]) to service_role;
revoke all on function public.rank_result_json(public.rank_results) from public, anon, authenticated;
grant execute on function public.rank_result_json(public.rank_results) to service_role;
