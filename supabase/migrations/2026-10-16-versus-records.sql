-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS RECORDS: each room player's total Versus wins and losses  (2026-10-16)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Owner 2026-10-16 (the Versus room): "we want to make the players actually show as cards ... their versus wins as the
-- attack pill, their versus losses as their health pill".
--
-- ADDITIVE ONLY: one read-only function. It touches no table, row, policy or existing function. Idempotent (safe to
-- re-run). Until it runs, the client counts the same rows itself with two `head: true` count reads per player (the
-- `versus_matches` table is already readable by every signed-in player), so applying it changes no number on screen.
--
-- WHAT IT EXPOSES: for at most TWO user ids (the room's two seats), a count of finished matches each one WON and LOST.
-- Nothing else: no match ids, opponents, dates, heroes or boards. It runs as the caller (security invoker), so it can
-- see exactly what the existing "versus read matches" policy already lets a signed-in player read; it widens nothing.
--
--   win  = a `complete` match whose `winner_seat` is the seat this user held (hearts, forfeit or missed rounds).
--   loss = a `complete` match whose `winner_seat` is the OTHER seat.
--   An `abandoned` match (winner_seat null) is neither.
--
-- Bounded (R-NET-01): returns ONE jsonb value, an array of at most two objects, never a table to cut.
--   select public.versus_records(array['<uuid>', '<uuid>']::uuid[]);
--   → [{"userId": "<uuid>", "wins": 12, "losses": 7}, {"userId": "<uuid>", "wins": 3, "losses": 9}]
-- The per-seat indexes (versus_matches_p1 / versus_matches_p2, on the user column) serve each count.

create or replace function public.versus_records(p_users uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with ids as (
    select distinct u from unnest(coalesce(p_users, '{}'::uuid[])) with ordinality as t(u, n)
    where u is not null and n <= 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', ids.u,
    'wins', (
      (select count(*) from public.versus_matches m where m.phase = 'complete' and m.p1_user = ids.u and m.winner_seat = 'p1')
      + (select count(*) from public.versus_matches m where m.phase = 'complete' and m.p2_user = ids.u and m.winner_seat = 'p2')
    ),
    'losses', (
      (select count(*) from public.versus_matches m where m.phase = 'complete' and m.p1_user = ids.u and m.winner_seat = 'p2')
      + (select count(*) from public.versus_matches m where m.phase = 'complete' and m.p2_user = ids.u and m.winner_seat = 'p1')
    )
  )), '[]'::jsonb)
  from ids;
$$;

revoke all on function public.versus_records(uuid[]) from public;
grant execute on function public.versus_records(uuid[]) to authenticated;
