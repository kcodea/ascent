-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- SECURITY PASS, PART 1 OF 2: close the anonymous `boards` insert and trim client WRITE grants
-- (2026-11-07, fix/supabase-security-p3a; docs/design/2026-10-28-supabase-cleanup.md S1 + S3, Phase 3).
-- Safe to apply at once: it removes nothing a live client does. Idempotent (run it twice, same result).
-- Part 2 (2026-11-09-security-reads-need-session.sql) waits for a client release; see that file.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- 1. `boards` had a policy `anon insert ... with check (true)`: anyone holding the public key, with no session, could
--    write boards for any user_id / author / strength, and the pool triggers fed them into `pool_runs`. Every real
--    client inserts as `authenticated` with its own user_id ("insert own boards"); uploadBoards() queues instead of
--    inserting when there is no session. Measured 2026-10-12..28: zero anon board inserts.
--
-- 2. Client roles held Supabase's default grants on almost every table: SELECT, INSERT, UPDATE, DELETE, TRUNCATE,
--    REFERENCES, TRIGGER (and MAINTAIN on Postgres 17). RLS was the only guard. This revokes, for `anon` and
--    `authenticated`, on every table and view in `public`:
--      - TRUNCATE, REFERENCES, TRIGGER, MAINTAIN everywhere (no client flow uses them; PostgREST cannot even issue them);
--      - INSERT / UPDATE / DELETE wherever NO RLS policy grants that command to that role. With RLS on and no
--        policy, the command was already refused (an insert errors, an update/delete matches 0 rows), so this changes
--        no outcome a client can reach; it only removes the grant a future permissive policy would silently open.
--    Writes a policy DOES allow are left exactly as they are. Measured on 2026-10-28 the kept writes are:
--      boards / board_results / lobby_fights / practice_games / run_history / run_telemetry / runs   INSERT (authenticated)
--      perf_runs                                                                                       INSERT, DELETE (authenticated)
--      profiles                                                                                        INSERT, UPDATE (authenticated)
--      client_crash_reports                                                                            INSERT (anon, authenticated; column grant)
--    SELECT is not touched here (part 2 handles the no-session reads). Tables with RLS OFF are skipped, never
--    revoked blind (there are none on 2026-10-28; the notice names any that appear).
--
-- 3. Default privileges: tables created later by `postgres` no longer hand TRUNCATE / REFERENCES / TRIGGER / MAINTAIN to
--    the client roles. INSERT / UPDATE / DELETE stay in the defaults on purpose: a new table whose migration adds an
--    "insert own" policy keeps working without a separate grant (closing those defaults is an owner call; see the PR).
--
-- Rollback (restores the pre-file state; the dropped policy is re-created verbatim):
--   create policy "anon insert" on public.boards for insert to anon with check (true);
--   grant insert on public.boards to anon;
--   grant insert, update, delete, truncate, references, trigger on all tables in schema public to anon, authenticated;
--   alter default privileges for role postgres in schema public grant truncate, references, trigger on tables to anon, authenticated;
-- (the blanket re-grant is harmless with RLS on: it is exactly the Supabase default this file trims.)
--
-- Verify after applying (each should be false):
--   select has_table_privilege('anon', 'public.boards', 'insert');
--   select has_table_privilege('authenticated', 'public.boards', 'truncate');
--   select has_table_privilege('authenticated', 'public.loot_crates', 'update');
-- and true:
--   select has_table_privilege('authenticated', 'public.boards', 'insert');
--   select has_table_privilege('authenticated', 'public.profiles', 'update');

-- ── 1. The anonymous boards insert ─────────────────────────────────────────────────────────────────────────
drop policy if exists "anon insert" on public.boards;
revoke insert on public.boards from anon;

-- ── 2. Trim the client write grants ────────────────────────────────────────────────────────────────────────
do $$
declare
  rel record;
  rol text;
  cmd record;
  maintain boolean := current_setting('server_version_num')::int >= 170000;
begin
  for rel in
    select c.oid, c.relname, c.relkind, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
  loop
    foreach rol in array array['anon', 'authenticated'] loop
      execute format('revoke truncate, references, trigger on table public.%I from %I', rel.relname, rol);
      if maintain then execute format('revoke maintain on table public.%I from %I', rel.relname, rol); end if;

      if rel.relkind in ('r', 'p') and not rel.relrowsecurity then
        raise notice 'security-writes: % has RLS off, its % writes were left alone', rel.relname, rol;
        continue;
      end if;

      for cmd in select * from (values ('insert', 'a'), ('update', 'w'), ('delete', 'd')) v(priv, code) loop
        if not exists (
          select 1 from pg_policy p
          where p.polrelid = rel.oid
            and p.polcmd in (cmd.code, '*')
            and (0 = any (p.polroles) or (select oid from pg_roles where rolname = rol) = any (p.polroles))
        ) then
          execute format('revoke %s on table public.%I from %I', cmd.priv, rel.relname, rol);
        end if;
      end loop;
    end loop;
  end loop;
end $$;

-- ── 3. Future tables start without the never-used privileges ───────────────────────────────────────────────
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;
do $$ begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'alter default privileges for role postgres in schema public revoke maintain on tables from anon, authenticated';
  end if;
end $$;
