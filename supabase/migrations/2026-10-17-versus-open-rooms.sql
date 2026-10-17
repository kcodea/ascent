-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS OPEN ROOMS: how many Versus rooms someone could join right now  (2026-10-17)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Owner 2026-10-17: "can we add a way to show if a lobby is up in versus mode so players know to look". The menus
-- (the Mode screen's Versus tile, the title's Play button, the side menu's Play) show a small "2 open" indicator
-- while this answers more than zero. R-VERSUS-OPEN-ROOMS-01.
--
-- ADDITIVE ONLY: one read-only function. It touches no table, row, policy or existing function. Idempotent (safe to
-- re-run). Until it runs, the menus show no indicator (the client has no fallback count).
--
-- WHAT COUNTS as an open room, all of:
--   - status `open` (not `sealed`, the 30 s start gate, and not `in_game`, a match being played);
--   - the caller's own protocol and content revision (a room the caller could not join, `version_mismatch`, is left out);
--   - at least one member seen in the last 2 minutes: the same freshness rule `versus_list_rooms` prunes by, so a room
--     the browser would delete as stale is never counted;
--   - the caller is NOT a member of it (your own room is never "someone waiting").
-- `seatOpen` is how many of those also have a player seat free (fewer than two fresh players in p1 / p2).
--
-- WHAT IT EXPOSES: two integers, `{ "open": n, "seatOpen": m }`. No room ids, names, members or anything else.
-- SECURITY INVOKER: it reads through the existing "versus read rooms / members" policies (any signed-in player can
-- already read those rows in full), so it can only ever see less than the caller already could. Signed-in players
-- only (the same grant as versus_list_rooms); anon gets nothing.
--
-- Bounded (R-NET-01): returns ONE jsonb value, never a table.
--   select public.versus_open_rooms(1, '<content revision>');
--   → {"open": 2, "seatOpen": 1}

create or replace function public.versus_open_rooms(p_protocol int, p_content text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with fresh as (
    select r.id,
      (select count(*) from public.versus_members m
        where m.room_id = r.id and m.role in ('p1', 'p2') and m.last_seen_at >= public.versus_clock() - interval '2 minutes') as players
    from public.versus_rooms r
    where r.status = 'open'
      and r.protocol = p_protocol
      and r.content_revision = p_content
      and exists (select 1 from public.versus_members m
        where m.room_id = r.id and m.last_seen_at >= public.versus_clock() - interval '2 minutes')
      and not exists (select 1 from public.versus_members m
        where m.room_id = r.id and m.user_id = auth.uid())
  )
  select jsonb_build_object(
    'open', count(*),
    'seatOpen', count(*) filter (where players < 2)
  ) from fresh;
$$;

revoke all on function public.versus_open_rooms(int, text) from public, anon;
grant execute on function public.versus_open_rooms(int, text) to authenticated;
