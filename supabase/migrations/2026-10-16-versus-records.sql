-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS RECORDS: each room player's total Versus wins and losses against REAL players  (2026-10-16)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Owner 2026-10-16 (the Versus room): "we want to make the players actually show as cards ... their versus wins as the
-- attack pill, their versus losses as their health pill". Correction the same day: "4-25 is definitely not correct for
-- my versus wins/losses... im like 2-1 in versus mode" (25 of the 29 were against anonymous / test accounts).
--
-- ADDITIVE ONLY: one read-only function. It touches no table, row, policy or existing function. Idempotent (safe to
-- re-run). Until it runs, the room cards show "-" for the record (the client has no fallback count).
--
-- WHAT COUNTS: a `complete` match where BOTH seats are real accounts: each user id has a `profiles` row AND an
-- `auth.users` row with `is_anonymous` not true. Then:
--   win  = `winner_seat` is the seat this user held (hearts, forfeit or missed rounds).
--   loss = `winner_seat` is the OTHER seat.
--   An `abandoned` match (winner_seat null) is neither; a match still running is neither.
--
-- WHAT IT EXPOSES: for at most TWENTY-TWO user ids (the two seats plus up to twenty spectators, read in one call),
-- the two counts per id: `{ userId, wins, losses }`. Nothing else: no match ids, opponents, dates, heroes, boards, and
-- nothing from auth.users beyond the yes/no used inside the count. SECURITY DEFINER only because the anonymous check
-- reads auth.users, which clients cannot.
--
-- Bounded (R-NET-01): returns ONE jsonb value, an array of at most 22 objects, never a table to cut.
--   select public.versus_records(array['<uuid>', '<uuid>']::uuid[]);
--   → [{"userId": "<uuid>", "wins": 2, "losses": 2}, ...]
-- The per-seat indexes (versus_matches_p1 / versus_matches_p2, on the user column) serve each count.

create or replace function public.versus_records(p_users uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ids as (
    select distinct u from unnest(coalesce(p_users, '{}'::uuid[])) with ordinality as t(u, n)
    where u is not null and n <= 22
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
