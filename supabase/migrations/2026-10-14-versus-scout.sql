-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS: each committed round records both seats' public state, for the scout card  (2026-10-14)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-13-versus.sql. Idempotent and ADDITIVE: three new
-- columns, one new overload of `versus_submit` (the 6-argument one stays exactly as it is), one trigger function and
-- its trigger. No existing function is replaced, and the `versus-resolve` Edge Function is unchanged.
--
-- WHY (live PvP test 2026-10-14, "your lobby info isnt like real time. shows you as tier 1"; owner: scout info must be
-- accurate): the opponent's scout card read their tier only off fights they won. Now every candidate and every lock
-- carries the seat's public state (`scout`: tier, triples, quest and rune ids), and the moment a round is committed the
-- trigger copies BOTH seats' scouts onto the round row (`p1_scout` / `p2_scout`), with the tier re-read from the locked
-- side itself. A round row is readable by everyone in the room, so a seat's scout is only ever seen once the round it
-- was locked for has been fought: never live.

-- ── 1. Columns ────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.versus_submissions add column if not exists scout jsonb;
alter table public.versus_rounds add column if not exists p1_scout jsonb;
alter table public.versus_rounds add column if not exists p2_scout jsonb;

-- ── 2. versus_submit with the scout (the 6-argument version is untouched; old clients keep calling it) ──────────
create or replace function public.versus_submit(p_match uuid, p_round int, p_seq int, p_side jsonb, p_final boolean, p_checkpoint jsonb, p_scout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
  v_seat text;
  m public.versus_matches;
begin
  if p_scout is not null and (jsonb_typeof(p_scout) <> 'object' or octet_length(p_scout::text) > 8192) then raise exception 'scout_too_large'; end if;
  v_out := public.versus_submit(p_match, p_round, p_seq, p_side, p_final, p_checkpoint);
  if p_scout is not null then
    select * into m from public.versus_matches where id = p_match;
    v_seat := public.versus__seat_of(m, auth.uid());
    -- Only on the submission this call actually wrote (a late, older candidate is ignored by the 6-argument version).
    update public.versus_submissions set scout = p_scout
      where match_id = p_match and round = p_round and seat = v_seat and (candidate_seq = p_seq or (p_final and final));
  end if;
  return v_out;
end;
$$;

-- ── 3. The committed round takes both seats' scouts ──────────────────────────────────────────────────────────────
create or replace function public.versus__round_scouts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s1 public.versus_submissions;
  s2 public.versus_submissions;
begin
  select * into s1 from public.versus_submissions where match_id = new.match_id and round = new.round and seat = 'p1';
  select * into s2 from public.versus_submissions where match_id = new.match_id and round = new.round and seat = 'p2';
  -- The tier is the locked side's own (authoritative); the rest is what the seat's client reported with it.
  new.p1_scout := coalesce(s1.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', s1.prepared_side -> 'state' -> 'tier'));
  new.p2_scout := coalesce(s2.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', s2.prepared_side -> 'state' -> 'tier'));
  return new;
end;
$$;

drop trigger if exists versus_rounds_scouts on public.versus_rounds;
create trigger versus_rounds_scouts before insert on public.versus_rounds
  for each row execute function public.versus__round_scouts();

-- ── 4. Grants ─────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.versus__round_scouts() from public, anon, authenticated;
revoke all on function public.versus_submit(uuid, int, int, jsonb, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.versus_submit(uuid, int, int, jsonb, boolean, jsonb, jsonb) to authenticated;
