-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE GAME SESSION ON CLOUDFLARE: the writer and the pool mirror's reads (2026-10-31, feat/ranked-solo-cf;
-- R-SESSION-CF-01, R-POOL-MIRROR-01). Additive, idempotent, safe to re-run. Run it BEFORE the hub deploy that
-- carries the session, and before turning the session on (`SESSION_MODE=on`, docs/versus-cf-cutover.md).
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Owner 2026-10-31: "Is it possible to just have ranked solos run on cloudflare too so that we aren't read writing in
-- real time? Can we offload that to cloudflare" → "Do it". Standing ruling: Cloudflare is the source for all live
-- information and action; Supabase is storage only.
--
-- A lobby / Practice game started with the session on is held by a Durable Object on the friends hub (`GameSession`,
-- workers/versus/src/session.ts). The object buffers the game's cloud save, its end-of-game writes and its rating
-- request, and writes them HERE in one call, through ONE limited, key-gated function, with the hub's writer secret
-- (`HUB_WRITER_SECRET`, whose sha256 is already a row of `versus_cf_writer_keys`, note 'ascent-hub'). Never the service
-- role. The function can do exactly what the player's own client could do, for that player only:
--
--   - insert the player's run-end rows into boards / run_telemetry / run_history / lobby_fights (the client's own
--     insert policy is `user_id = auth.uid()`: here `user_id` is ALWAYS the session's verified owner, and only columns
--     the `authenticated` role may insert are written), each write once (`session_cf_writes` ledger + the tables' own
--     idempotency keys);
--   - put / clear the player's saved run, with `put_saved_run` / `clear_saved_run`'s exact rules (guests refused);
--   - settle the player's rank through `settle_rank` (the same call `submit-rating` makes, after the same checks, which
--     the object runs before calling: workers/versus/src/core/sessionCore.ts).
--
-- The pool mirror (`PoolMirror`, workers/versus/src/poolMirror.ts) reads the pool through three more key-gated
-- functions: a version hash (cheap, every sync), the index of eligible runs, and the boards of given runs, aggregated
-- by `pool_runs_boards` itself, so the mirror holds byte for byte what the client would have been served.
--
-- ROLLBACK (the clients fall back to the Supabase path on their own when these are gone):
--   drop function if exists public.session_cf_flush(text, uuid, boolean, text, jsonb, jsonb, jsonb, jsonb);
--   drop function if exists public.pool_mirror_version(text);
--   drop function if exists public.pool_mirror_index(text);
--   drop function if exists public.pool_mirror_boards(text, bigint[]);
--   drop function if exists public.session_cf__key_ok(text);
--   drop table if exists public.session_cf_writes;

create extension if not exists pgcrypto with schema extensions;

-- ── 1. The key check (the writer secret's sha256 is a row of versus_cf_writer_keys) ─────────────────────────
create or replace function public.session_cf__key_ok(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_key is not null and exists (select 1 from public.versus_cf_writer_keys
    where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex'))
$$;
revoke all on function public.session_cf__key_ok(text) from public, anon, authenticated;

-- ── 2. The write ledger: each session write lands once ─────────────────────────────────────────────────────
create table if not exists public.session_cf_writes (
  user_id    uuid not null,
  write_key  text not null,
  game_id    text not null,
  tbl        text not null,
  status     text not null,
  at         timestamptz not null default now(),
  primary key (user_id, write_key)
);
alter table public.session_cf_writes enable row level security; -- no policies: nothing reads it through the API
revoke all on public.session_cf_writes from anon, authenticated;
create index if not exists session_cf_writes_at on public.session_cf_writes (at);

-- ── 3. The flush ───────────────────────────────────────────────────────────────────────────────────────────
-- p_writes: [{ key, table, conflict?, rows: [...] }]   rows WITHOUT user_id
-- p_save:   { run_key, expected, device, payload }      or null
-- p_clear:  { run_key, expected }                       or null
-- p_rating: { run_id, placement, season, rules_version, seed, seat_keys } or null
-- Answers { writes: [{ key, status }], save: {...} | null, clear: {...} | null, rating: <settle_rank's jsonb> | { error } | null }.
-- One transaction; a write or the rating that fails is answered as failed WITHOUT undoing the rest (each runs in its own
-- sub-block). Writes go first: `settle_rank` stamps the Career row by seed (the client's own order, R-RANK-02).
create or replace function public.session_cf_flush(
  p_key text, p_user uuid, p_guest boolean, p_game text,
  p_writes jsonb default null, p_save jsonb default null, p_clear jsonb default null, p_rating jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w jsonb;
  t text;
  k text;
  conflict text;
  cols text;
  sel text;
  n int;
  out_writes jsonb := '[]'::jsonb;
  out_save jsonb := null;
  out_clear jsonb := null;
  out_rating jsonb := null;
  cur public.saved_runs;
  exp bigint;
  rk text;
  dev text;
  payload jsonb;
  allowed constant jsonb := jsonb_build_object(
    'boards', 'user_id,upload_key', 'run_telemetry', 'user_id,upload_key', 'run_history', 'user_id,upload_key',
    'lobby_fights', 'lobby_seed,round,run_a,run_b');
begin
  if not public.session_cf__key_ok(p_key) then raise exception 'not_authorized'; end if;
  if p_user is null or p_game is null or length(p_game) < 1 or length(p_game) > 80 then raise exception 'bad_arguments'; end if;

  -- ── the run-end writes ──
  for w in select * from jsonb_array_elements(coalesce(p_writes, '[]'::jsonb)) loop
    t := w ->> 'table';
    k := left(coalesce(w ->> 'key', ''), 300);
    begin
      if k = '' or not (allowed ? t) or jsonb_typeof(w -> 'rows') <> 'array' or jsonb_array_length(w -> 'rows') = 0
         or jsonb_array_length(w -> 'rows') > 200 then
        raise exception 'bad_write';
      end if;
      insert into public.session_cf_writes (user_id, write_key, game_id, tbl, status) values (p_user, k, p_game, t, 'applied')
        on conflict (user_id, write_key) do nothing;
      if not found then
        out_writes := out_writes || jsonb_build_object('key', k, 'status', 'duplicate');
        continue;
      end if;
      -- Only the columns the client itself may insert (column grants), never user_id (stamped) or a generated column.
      select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
             string_agg('r.' || quote_ident(c.column_name), ', ' order by c.ordinal_position)
        into cols, sel
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t and c.column_name <> 'user_id'
         and c.is_generated = 'NEVER'
         and has_column_privilege('authenticated', format('public.%I', t), c.column_name, 'INSERT')
         and exists (select 1 from jsonb_array_elements(w -> 'rows') e where e ? c.column_name);
      if cols is null then raise exception 'bad_write'; end if;
      conflict := case when (w ->> 'conflict') = (allowed ->> t) then allowed ->> t else null end;
      execute format('insert into public.%I (user_id, %s) select $1, %s from jsonb_populate_recordset(null::public.%I, $2) r %s',
        t, cols, sel, t, case when conflict is null then '' else format('on conflict (%s) do nothing', conflict) end)
        using p_user, w -> 'rows';
      get diagnostics n = row_count;
      out_writes := out_writes || jsonb_build_object('key', k, 'status', 'applied', 'rows', n);
    exception when others then
      -- Rejected for good (bad data, a constraint): logged like the client's report_write_failure, never retried.
      out_writes := out_writes || jsonb_build_object('key', k, 'status', 'rejected', 'error', left(sqlstate || ' ' || sqlerrm, 300));
      begin
        insert into ops.events (source, kind, key, detail) values ('session', 'write_rejected', k,
          jsonb_build_object('user', p_user, 'game', p_game, 'key', k, 'table', t, 'error', left(sqlstate || ' ' || sqlerrm, 300)));
      exception when others then null; -- the log is best-effort (ops.events may not exist on a fresh project)
      end;
    end;
  end loop;

  -- ── the saved run (put_saved_run's rules, for p_user) ──
  if p_save is not null then
    rk := p_save ->> 'run_key';
    exp := coalesce((p_save ->> 'expected')::bigint, 0);
    dev := left(coalesce(p_save ->> 'device', ''), 128);
    payload := p_save -> 'payload';
    if coalesce(p_guest, false) then
      out_save := jsonb_build_object('status', 'refused');
    elsif rk is null or length(rk) < 1 or length(rk) > 128 or payload is null then
      out_save := jsonb_build_object('status', 'refused');
    else
      select * into cur from public.saved_runs where user_id = p_user for update;
      if not found then
        if exp = 0 then
          insert into public.saved_runs (user_id, run_key, payload, revision, device_id) values (p_user, rk, payload, 1, dev)
            on conflict (user_id) do nothing;
          if found then out_save := jsonb_build_object('status', 'ok', 'revision', 1); end if;
        else
          out_save := jsonb_build_object('status', 'conflict', 'current', null);
        end if;
        if out_save is null then select * into cur from public.saved_runs where user_id = p_user; end if;
      end if;
      if out_save is null then
        if (cur.run_key = rk and cur.revision = exp) or (exp = 0 and cur.run_key <> rk) then
          update public.saved_runs set run_key = rk, payload = p_save -> 'payload', revision = cur.revision + 1,
                 device_id = dev, updated_at = now() where user_id = p_user;
          out_save := jsonb_build_object('status', 'ok', 'revision', cur.revision + 1);
        else
          out_save := jsonb_build_object('status', 'conflict', 'current', jsonb_build_object('run_key', cur.run_key,
            'revision', cur.revision, 'device_id', cur.device_id, 'updated_at', cur.updated_at));
        end if;
      end if;
    end if;
  end if;

  -- ── the run ended: its saved row goes (clear_saved_run's rules) ──
  if p_clear is not null then
    if coalesce(p_guest, false) then
      out_clear := jsonb_build_object('status', 'refused');
    else
      delete from public.saved_runs where user_id = p_user and run_key = (p_clear ->> 'run_key')
        and revision = coalesce((p_clear ->> 'expected')::bigint, -1);
      out_clear := jsonb_build_object('status', case when found then 'ok' else 'conflict' end);
    end if;
  end if;

  -- ── the rating (submit-rating's settle; the checks ran in the object) ──
  if p_rating is not null then
    begin
      out_rating := public.settle_rank(p_user, p_rating ->> 'run_id', (p_rating ->> 'placement')::int,
        (p_rating ->> 'season')::int, (p_rating ->> 'rules_version')::int, (p_rating ->> 'seed')::bigint,
        case when jsonb_typeof(p_rating -> 'seat_keys') = 'array'
             then array(select jsonb_array_elements_text(p_rating -> 'seat_keys')) else null end);
    exception when others then
      out_rating := jsonb_build_object('error', left(sqlerrm, 200));
    end;
  end if;

  return jsonb_build_object('writes', out_writes, 'save', out_save, 'clear', out_clear, 'rating', out_rating);
end $$;
revoke all on function public.session_cf_flush(text, uuid, boolean, text, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.session_cf_flush(text, uuid, boolean, text, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;

-- ── 4. The pool mirror's reads ─────────────────────────────────────────────────────────────────────────────
-- The version: one hash over every eligible run's identity, filter columns, strengths and content rev. Unchanged =
-- the mirror holds exactly what the database would serve; the sync then stops here (a few bytes per sync).
create or replace function public.pool_mirror_version(p_key text) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.session_cf__key_ok(p_key) then raise exception 'not_authorized'; end if;
  return (select md5(coalesce(string_agg(concat_ws('|', r.id, r.set_id, r.patch_prefix, r.pool_id, r.user_id, r.wave_count,
            r.strength, r.strength_early, r.strength_late, public.pool_run__rev(r.author, r.hero_id, r.seed)), ',' order by r.id), ''))
          from public.pool_runs r where r.eligible);
end $$;

-- The index: every eligible run, with what the pick filters on (as text: numerics travel exactly) and its rev.
create or replace function public.pool_mirror_index(p_key text)
returns table (run_id bigint, run_key text, author text, user_id uuid, wave_count int, set_id text, patch_prefix text,
               pool_id text, strength text, strength_early text, strength_late text, rev text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.session_cf__key_ok(p_key) then raise exception 'not_authorized'; end if;
  return query
  select r.id, r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count, r.set_id,
         r.patch_prefix, r.pool_id, r.strength::text, r.strength_early::text, r.strength_late::text,
         public.pool_run__rev(r.author, r.hero_id, r.seed)
  from public.pool_runs r where r.eligible order by r.id;
end $$;

-- The boards: `pool_runs_boards` itself (the same aggregation, the same rev), the boards as their exact text.
create or replace function public.pool_mirror_boards(p_key text, p_ids bigint[])
returns table (run_id bigint, run_key text, rev text, boards text)
language plpgsql stable security definer set search_path = public set work_mem = '16MB' as $$
begin
  if not public.session_cf__key_ok(p_key) then raise exception 'not_authorized'; end if;
  return query select b.run_id, b.run_key, b.rev, b.boards::text from public.pool_runs_boards(p_ids) b;
end $$;

revoke all on function public.pool_mirror_version(text) from public;
revoke all on function public.pool_mirror_index(text) from public;
revoke all on function public.pool_mirror_boards(text, bigint[]) from public;
grant execute on function public.pool_mirror_version(text) to anon, authenticated;
grant execute on function public.pool_mirror_index(text) to anon, authenticated;
grant execute on function public.pool_mirror_boards(text, bigint[]) to anon, authenticated;

notify pgrst, 'reload schema';
