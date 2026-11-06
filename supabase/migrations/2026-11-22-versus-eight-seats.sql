-- ═══════════════════════════════════════
-- VERSUS: EIGHT SEATS (2026-11-06, feat/versus-8-seats; R-VERSUS-EIGHT-01). Additive, idempotent, safe to re-run.
-- ═══════════════════════════════════════
--
-- Owner 2026-11-06: "i want versus modes to be able to host up to 8 players in normal mode and up to 4 teams of 2 for the
-- duo modes."
--
-- Rooms play on the Cloudflare Worker; this file only lets the results it writes through `versus_cf_persist` land:
--
--   1. The Group tables' seat checks widen from p1..p4 to p1..p8, and `seat_count` from 4 to 8.
--   2. `settle_progression` scores places 5 to 8 of a Group match (it dropped any place past 4th to no placement).
--
-- APPLY THIS BEFORE THE NEW WORKER SHIPS: until then a match with a seat past p4 would be refused by these checks. Widening
-- a check changes nothing for any existing row, and the old Worker never writes past p4.

do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass as tbl, conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where contype = 'c'
      and conrelid::regclass::text ~ '^(public\.)?versus_group_'
      and pg_get_constraintdef(oid) ~ '''p4''::text'
      and pg_get_constraintdef(oid) !~ '''p8''::text'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    execute format('alter table %s add constraint %I %s', c.tbl, c.conname,
      replace(c.def, '''p4''::text', '''p4''::text, ''p5''::text, ''p6''::text, ''p7''::text, ''p8''::text'));
  end loop;
end $$;

alter table public.versus_group_matches drop constraint if exists versus_group_matches_seat_count_check;
alter table public.versus_group_matches add constraint versus_group_matches_seat_count_check check (seat_count >= 2 and seat_count <= 8);

-- The function's body is long and unchanged but for this one bound, so it is rewritten from its live definition.
do $$
declare
  fn regprocedure := to_regprocedure('public.settle_progression(uuid,text,text,bigint,boolean,integer,jsonb)');
  body text;
begin
  if fn is null then return; end if; -- (a test database that boots only the Versus files)
  body := pg_get_functiondef(fn);
  if position('v_g_place between 1 and 4' in body) > 0 then
    execute replace(body, 'v_g_place between 1 and 4', 'v_g_place between 1 and 8');
  end if;
end $$;
