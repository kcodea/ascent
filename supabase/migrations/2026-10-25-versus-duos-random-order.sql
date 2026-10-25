-- 2026-10-25 · Versus Duos: who fights first is a seeded 50/50 each round, never a player choice (R-DUOS-ORDER-01).
-- Owner ruling 2026-10-25: "I want the 'who fights first' to be a 50/50, not a player decision for duos teams. Every
-- round it should say who fights first but players cannot decide who it is."
--
-- The order is now a pure function of the match seed + round + team (`duosRandomFirst`, packages/sim/src/versus/duos.ts),
-- computed by every client and by the `versus-resolve` Edge Function (`finalize_duos`), so the database no longer holds
-- or changes it:
--   1. `versus_duos_flip_order` is dropped (no player can set the order).
--   2. `versus_group__open_shop` no longer writes the old alternation into `duos_first`; it clears it on a Duos match.
--      The column stays (nullable, unread) so older rows and replays still load; a committed fight's own result carries
--      the order it fought (`duosFirst`).
-- Idempotent: a DROP IF EXISTS and one CREATE OR REPLACE (same signature, grants kept).

drop function if exists public.versus_duos_flip_order(uuid);

-- Open round p_round's shop (unchanged), and a Duos match's `duos_first` cleared (the order is the seeded pick).
create or replace function public.versus_group__open_shop(m public.versus_group_matches, p_round int)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_first boolean := p_round = 1;
  v_out public.versus_group_matches;
begin
  update public.versus_group_seats set locked = false, ready = false where match_id = m.id;
  update public.versus_group_matches set
    phase = 'shop', round = p_round,
    shop_starts_at = case when v_first then null else v_now end,
    shop_deadline = case when v_first then null else v_now + make_interval(secs => public.versus_turn_seconds(p_round)) end,
    intro_deadline = case when v_first then v_now + interval '45 seconds' else null end,
    combat_deadline = null,
    duos_first = case when public.versus_duos__is(m) then null else duos_first end,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  return v_out;
end;
$$;

revoke all on function public.versus_group__open_shop(public.versus_group_matches, int) from public, anon, authenticated;
