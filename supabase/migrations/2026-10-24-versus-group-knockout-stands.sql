-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS GROUP: a player knocked out of a group match goes to the stands of their room  (2026-10-24)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-24-versus-group.sql. Idempotent and ADDITIVE: one trigger
-- function and its trigger on `versus_group_seats`. No table, column, policy or existing function changes, and the
-- `versus-resolve` Edge Function is unchanged (no redeploy). R-VERSUS-GROUP-06.
--
-- Owner 2026-10-24: "when a player loses/is knocked out in this mode they go into a spectator seat so they can watch the
-- rest of the game".
--
-- The moment a group seat goes out (its `eliminated_round` is first set: out of hearts at a round commit, three missed
-- rounds, a concede; also a player leaving the room, whose member row is then deleted anyway), that player's
-- `versus_members` row in the match's room becomes a SPECTATOR. The 20-spectator cap is NOT applied (it only gates joins
-- and seat moves), so a full stand never strands a knocked-out player. The group seat row itself is untouched: the
-- match still knows the seat, its placement and hearts, and every group RPC already refuses an eliminated seat's
-- locks and inputs (`versus_group_submit` raises `eliminated`). When the match ends the player is simply in the stands
-- of the open room, and takes a seat for the next game like anyone else.

create or replace function public.versus_group__seat_out_to_stands()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.eliminated_round is null and new.eliminated_round is not null then
    update public.versus_members mm set role = 'spectator'
      from public.versus_group_matches g
      where g.id = new.match_id and mm.room_id = g.room_id and mm.user_id = new.user_id and mm.role <> 'spectator';
    if found then
      update public.versus_rooms r set revision = r.revision + 1, updated_at = public.versus_clock()
        from public.versus_group_matches g where g.id = new.match_id and r.id = g.room_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists versus_group_seat_out_to_stands on public.versus_group_seats;
create trigger versus_group_seat_out_to_stands after update of eliminated_round on public.versus_group_seats
  for each row execute function public.versus_group__seat_out_to_stands();

revoke all on function public.versus_group__seat_out_to_stands() from public, anon, authenticated;
