-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- SECURITY PASS, PART 2 OF 2: the large shared tables answer only a session (2026-11-07, fix/supabase-security-p3a;
-- docs/design/2026-10-28-supabase-cleanup.md S2, Phase 3.2). Idempotent.
--
-- APPLY ORDER: after 2026-11-07-security-writes.sql AND 2026-11-08-pool-runs-delta.sql (whose grants it narrows), and only once the web build carrying the session-first reads
-- (remoteBoards.ts `sessionReady`, same PR) has been live for a release, the Netlify pack and the desktop exe
-- included. A build without it still works afterwards: its first boot-time reads (before its anonymous sign-in
-- lands) are refused and the pool / histogram / records retry or refresh once the session exists.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Before: `anon` (the bare public key, NO session) could read run_telemetry (140 MB, every replay), boards, practice_games,
-- runs, lobby_fights, board_results, pool_runs, and call pool_runs_sample (3.45 MB an answer) and the strength
-- histograms. Not secret, but a script with the public key could pull them in a loop and bill the egress.
-- After: the same reads need a session. Every player has one: the game signs in anonymously at boot, and an anonymous
-- guest is the `authenticated` role. Nothing a signed-in client can read changes: the policies keep `using (true)`.
--
-- Unchanged on purpose: profiles, cosmetics, catalogs, guides, Live Games and the other small public reads (a few kB,
-- read by the title screen before the session); Edge Functions (service_role) and the Versus Worker (its own
-- SECURITY DEFINER RPC). Dev tools in packages/tools read with the service-role key from the untracked root .env.
--
-- Rollback:
--   for each table T below: drop policy "read T" on public.T; create policy "read T" on public.T for select using (true);
--   grant select on <the seven tables>, public.run_fight_records to anon;
--   create policy "anon read" on public.boards for select to anon using (true);
--   grant execute on function public.pool_runs_sample(...), public.pool_runs_sample_keys(...), public.pool_runs_boards(bigint[]),
--     public.pool_runs__pick(...), public.pool_run__rev(text, text, bigint), public.board_strength_histogram(text),
--     public.run_strength_histogram(text) to anon;
--
-- Verify after applying (false, false, true):
--   select has_table_privilege('anon', 'public.run_telemetry', 'select');
--   select has_function_privilege('anon', 'public.board_strength_histogram(text)', 'execute');
--   select has_table_privilege('authenticated', 'public.run_telemetry', 'select');

do $$
declare
  t text;
begin
  foreach t in array array['run_telemetry', 'boards', 'practice_games', 'runs', 'lobby_fights', 'board_results', 'pool_runs'] loop
    if to_regclass('public.' || t) is null then
      raise notice 'security-reads: public.% does not exist here, skipped', t;
      continue;
    end if;
    -- The one read policy, now for a session only (same rows: using (true)).
    execute format('drop policy if exists %I on public.%I', 'read ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', 'read ' || t, t);
    execute format('revoke select on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- boards also had its own anon-only read policy.
drop policy if exists "anon read" on public.boards;

-- The Hall / lobby-strength view reads lobby_fights as the caller (security_invoker): a session only, like its table.
do $$ begin
  if to_regclass('public.run_fight_records') is not null then
    revoke select on public.run_fight_records from anon;
    grant select on public.run_fight_records to authenticated;
  end if;
end $$;

-- The pool and strength RPCs read those tables as the caller (SECURITY INVOKER); they would already fail for anon,
-- this makes the refusal explicit (permission denied on the call, not a confusing table error). Every overload,
-- including the delta-cache pair and its helpers from 2026-11-08-pool-runs-delta.sql (skipped where not applied).
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('pool_runs_sample', 'pool_runs_sample_keys', 'pool_runs_boards', 'pool_runs__pick', 'pool_run__rev',
      'board_strength_histogram', 'run_strength_histogram')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
