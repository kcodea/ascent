-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS: the one hero re-roll on Hero Select, drawn by the server from the match seed  (2026-10-15)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-13-versus.sql (and the 2026-10-14 Versus files). Idempotent
-- and ADDITIVE: one new column on `versus_seat_private`, one new RPC. No existing function is replaced, and the
-- `versus-resolve` Edge Function is unchanged. A client that runs before this file is applied gets `not_deployed` from
-- the RPC and simply keeps its three heroes.
--
-- WHAT (owner 2026-10-15, R-HERO-REROLL-01: "add a feature to the hero select that allows a player to re-roll a single
-- hero option once to get a new one in its place"; ONE re-roll per hero select, in every mode, Versus included):
--  - `versus_reroll_hero(match, slot, candidates)` swaps exactly ONE slot of the caller's registered three, ONCE per
--    player per match, while Hero Select is open (before the pick and before the 20 s deadline; the clock keeps
--    running). The replacement is `candidates[versus__pick(match seed, 'hero-reroll:' || seat, n)]`: deterministic from
--    the match seed, never chosen by the client. `candidates` is the client's eligible list (the heroes its run's tribes
--    allow, minus its three; `versusHeroRerollCandidates` in packages/sim/src/versus/run.ts). The server refuses a list
--    that overlaps the current three, repeats a hero, or is empty/oversized. It trusts the list's CONTENT exactly as it
--    already trusts the registered three (`versus_register_offer`): the server has no hero roster.
--  - The swap is written to the seat's PRIVATE row (`hero_offer` + the new `hero_reroll` record {slot, from, to}),
--    which only its owner can read, so the opponent never sees it. `versus_matches` is not touched.
--  - A timeout pick (`versus__maybe_start`) reads `hero_offer`, so it picks from the CURRENT three.

-- ── 1. Column ─────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.versus_seat_private add column if not exists hero_reroll jsonb;

-- ── 2. The RPC ────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.versus_reroll_hero(p_match uuid, p_slot int, p_candidates text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_matches;
  v_seat text;
  p public.versus_seat_private;
  v_n int;
  v_to text;
  v_from text;
  v_offer text[];
  v_reroll jsonb;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'hero_select' then raise exception 'wrong_phase'; end if;
  if p_slot is null or p_slot not between 0 and 2 then raise exception 'bad_index'; end if;
  if public.versus_clock() >= m.hero_deadline then raise exception 'hero_deadline_passed'; end if;

  select * into p from public.versus_seat_private where match_id = p_match and seat = v_seat for update;
  if not found or p.hero_offer is null then raise exception 'no_offer'; end if;
  if p.hero_index is not null then raise exception 'already_picked'; end if;
  if p.hero_reroll is not null then raise exception 'reroll_used'; end if;

  v_n := coalesce(cardinality(p_candidates), 0);
  if v_n < 1 or v_n > 128
     or exists (select 1 from unnest(p_candidates) c where c is null or char_length(c) = 0 or char_length(c) > 32)
     or (select count(distinct c) from unnest(p_candidates) c) <> v_n
     or exists (select 1 from unnest(p_candidates) c where c = any (p.hero_offer)) then
    raise exception 'bad_candidates';
  end if;

  v_to := p_candidates[public.versus__pick(m.seed, 'hero-reroll:' || v_seat, v_n) + 1];
  v_from := p.hero_offer[p_slot + 1];
  v_offer := p.hero_offer;
  v_offer[p_slot + 1] := v_to;
  v_reroll := jsonb_build_object('slot', p_slot, 'from', v_from, 'to', v_to);
  update public.versus_seat_private set hero_offer = v_offer, hero_reroll = v_reroll
    where match_id = p_match and seat = v_seat;
  return jsonb_build_object('match', public.versus__match_json(m), 'offer', to_jsonb(v_offer), 'reroll', v_reroll);
end;
$$;

revoke all on function public.versus_reroll_hero(uuid, int, text[]) from public, anon;
grant execute on function public.versus_reroll_hero(uuid, int, text[]) to authenticated;
