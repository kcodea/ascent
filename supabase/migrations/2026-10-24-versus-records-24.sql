-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS RECORDS for a full group room: up to 24 ids per read  (2026-10-24)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-16-versus-records.sql. Idempotent. Replaces
-- `versus_records` with ONE change: it answers up to 24 user ids per call (was 22). A Versus Group room seats four
-- players plus the 20 spectators (R-VERSUS-GROUP-05), so 22 left the last two cards of a full group room on "-".
-- Everything else (what counts, what it exposes) is the 2026-10-16 function byte for byte; it still counts 1v1
-- matches only. No Edge Function redeploy. The client asks for at most 24 (`MAX_RECORD_IDS`); before this runs the
-- server answers the first 22 and the rest show "-".
--
-- Bounded (R-NET-01): returns ONE jsonb value, an array of at most 24 objects, never a table.

create or replace function public.versus_records(p_users uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ids as (
    select distinct u from unnest(coalesce(p_users, '{}'::uuid[])) with ordinality as t(u, n)
    where u is not null and n <= 24
  ),
  real_matches as (
    select m.p1_user, m.p2_user, m.winner_seat
    from public.versus_matches m
    where m.phase = 'complete' and m.winner_seat is not null
      and (m.p1_user in (select u from ids) or m.p2_user in (select u from ids))
      and exists (select 1 from public.profiles p where p.user_id = m.p1_user)
      and exists (select 1 from public.profiles p where p.user_id = m.p2_user)
      and exists (select 1 from auth.users a where a.id = m.p1_user and coalesce(a.is_anonymous, false) = false)
      and exists (select 1 from auth.users a where a.id = m.p2_user and coalesce(a.is_anonymous, false) = false)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', ids.u,
    'wins', (select count(*) from real_matches r where (r.p1_user = ids.u and r.winner_seat = 'p1') or (r.p2_user = ids.u and r.winner_seat = 'p2')),
    'losses', (select count(*) from real_matches r where (r.p1_user = ids.u and r.winner_seat = 'p2') or (r.p2_user = ids.u and r.winner_seat = 'p1'))
  )), '[]'::jsonb)
  from ids;
$$;

revoke all on function public.versus_records(uuid[]) from public;
grant execute on function public.versus_records(uuid[]) to authenticated;
