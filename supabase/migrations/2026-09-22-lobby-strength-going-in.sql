-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LOBBY STRENGTH IS THE FIELD GOING IN  (2026-09-22, the same day as the fight ledger)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). Requires the fight-ledger block
-- (2026-09-22-fight-ledger.sql) to have run first. The same block is appended to schema.sql — keep the two
-- identical. Owner report: "the lobby difficulty shows 47 in my career and 50 in recent games, why".
--
-- `settle_rank` (same seven-argument signature; `create or replace` swaps the body in place) now computes the
-- lobby strength from `lobby_fights` EXCLUDING the lobby being settled (`lobby_seed <> p_seed`), so the number
-- is the opponents' record BEFORE this game — the same value the client stamps on the telemetry row (it
-- subtracts the rows it is about to upload). Before this, the server settled after the client's fight upload
-- had landed and read the seven opponents WITH this game's results folded in (47), while the client had read
-- them before (50). Everything else in the function is unchanged.

-- ── settle_rank — the lobby strength is the field GOING IN (this lobby's fights excluded). Service role only. ──
-- The six-argument overload is dropped: `create or replace` with a new parameter list would ADD an overload,
-- and PostgREST's named-argument rpc would then see two candidates.

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
      -- THE FIELD GOING IN (owner 2026-09-22): this lobby's own fights are EXCLUDED, so the strength describes
      -- the opponents' records before this game, and the client's stamp (which subtracts the rows it uploads)
      -- agrees with this one. The view is not used here because it cannot exclude by seed.
      left join lateral (
        select count(*)::int as fights,
               coalesce(sum(case when (x.run_a = k and x.outcome = 'a') or (x.run_b = k and x.outcome = 'b') then 1 else 0 end), 0)::int as wins
          from public.lobby_fights x
         where (x.run_a = k or x.run_b = k)
           and (p_seed is null or x.lobby_seed <> p_seed)
      ) r on true;
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
