-- RANKED DUOS: AT 0:00 THE ROUND WAITS FOR BOTH TEAMMATES (owner 2026-10-27, fix/duos-ready-toggle-and-hang;
-- R-RANKED-DUOS-GATE-02). APPLY AFTER 2026-11-01-versus-ready-signal.sql. Idempotent. No function redeploy needed
-- (versus-resolve only reads the round once it is closed; when it closes is this function's business).
--
-- Owner: "in duos, don't do the 5s timer when a player readies at 0 seconds. make it so both players must ready up to
-- progress it."
--
-- Before: one teammate ready = the round closed 5 s after the later of 0:00 and that first End Turn.
-- Now: the round closes when BOTH live teammates are ready (End Turn), at once, at any time. Past 0:00 with only one (or
-- neither) ready it waits. What still ends the wait, unchanged:
--   * a teammate who disconnects goes on auto after the 12 s lease (`versus_ranked_duos_reconcile`) and an auto or left
--     seat counts as ready, so a dropped teammate never stalls the team;
--   * the 30 s AFK backstop past 0:00 (2026-10-26) now covers this case too: a connected teammate who never presses
--     cannot hold the round for longer than that.
-- Nothing else changes: candidates are still accepted until the close (re-order past 0:00), un-ready is still refused
-- from 0:00 (`versus_group_unready`), and Versus Duos / Group / 1v1 keep closing at 0:00 for everyone (the opponent
-- force-progress).
--
-- Mirror: `rankedDuosCloseAt` in packages/sim/src/versus/rankedDuos.ts (the db test holds them together).

create or replace function public.versus_ranked_duos__close_at(m public.versus_group_matches)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_all boolean;
  v_last timestamptz;
begin
  -- A seat that LEFT counts as ready even if the room heartbeat cleared its auto flag (the leaver may still be in the room).
  select bool_and(locked or auto or left_at is not null),
         max(coalesce(case when locked then locked_at end, case when auto then auto_since end, left_at, locked_at))
    into v_all, v_last
    from public.versus_group_seats where match_id = m.id and eliminated_round is null;
  if coalesce(v_all, false) then return coalesce(v_last, public.versus_clock()); end if;
  if m.shop_deadline is null then return null; end if;
  -- Not both ready: wait for them, up to the AFK backstop past 0:00 (no 5 s window after the first End Turn any more).
  return m.shop_deadline + interval '30 seconds';
end;
$$;
