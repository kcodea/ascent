-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- COLLECTION "NEW" FOLLOWS THE ACCOUNT  (2026-10-11, R-PROG-COLLECTION-05)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-progression-crates.sql. Idempotent: safe to re-run.
-- The same block is appended to schema.sql; keep the two identical. Devlog: docs/devlog/2026-10-11-collection-new-baseline.md.
--
-- WHY (owner 2026-10-11: "whenever i load the game, all of my stuff that i already own shows up as 'new'", then
-- "i want to save the 'seen' on the account level, though"): which owned items a player has looked at lived only in
-- the browser's storage, so every device, every address and every fresh install started from nothing and badged the
-- whole collection. It now lives on the ownership row, so it follows the account.
--
-- WHAT
--  - `player_cosmetics.seen_at`: null = owned and not looked at yet (the Collection shows NEW). A new unlock is
--    inserted with it null, by every existing writer, with no change to them.
--  - THE BASELINE: every item owned when this file FIRST runs is marked seen. That step is guarded by the column not
--    existing yet, so a re-run never marks later finds.
--  - `mark_cosmetics_seen(p_ids)`: the signed-in caller marks THEIR OWN items seen (a guest account included: it
--    owns items too). It only ever sets a null `seen_at`; it cannot touch another account, grant an item, or un-see
--    one. Clients have no update grant on the table: this function is the only writer of the column.
--  - A client from before this file ignores the column. A client from after it, talking to a database from before it,
--    gets an "undefined column" answer and keeps the list on the device.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'player_cosmetics' and column_name = 'seen_at'
  ) then
    alter table public.player_cosmetics add column seen_at timestamptz;
    update public.player_cosmetics set seen_at = now();
  end if;
end $$;

create or replace function public.mark_cosmetics_seen(p_ids text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then return 0; end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_ids, 1) > 2000 then raise exception 'bad_arguments'; end if;
  update public.player_cosmetics
     set seen_at = now()
   where user_id = uid and seen_at is null and cosmetic_id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mark_cosmetics_seen(text[]) from public, anon, authenticated;
grant execute on function public.mark_cosmetics_seen(text[]) to authenticated;

commit;

-- Tell the REST API about the new column and function.
notify pgrst, 'reload schema';
