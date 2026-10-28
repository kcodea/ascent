-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- REPLAYS TO STORAGE (2026-11-07, feat/replays-to-storage; docs/design/2026-10-28-supabase-cleanup.md 3.5 / Phase 4.1).
-- OWNER RULING 2026-10-28: "move to cheap storage, keep all". Idempotent. Applying it moves and deletes NOTHING.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- run_telemetry is 140 MB of a 254 MB database, 121 MB of it the `replay` jsonb (409 rows, 385 MB as text). Replays
-- are written once and read only when someone presses Watch, so they move to a private Storage bucket:
--
--   1. Bucket `replays` (private). An object is the replay's JSON text, gzipped: `<user_id>/<key>.json.gz`.
--      A session may upload only into its own folder and never overwrite or delete; any session may read
--      (exactly today's visibility: every signed-in player can watch any game; nobody without a session can).
--   2. run_telemetry gains `replay_path` (the object), `replay_head` (the replay minus its bulk: every v2 fact the lists
--      read, with `frames` cut to its first and last clock), and the copy proof `replay_sha256` / `replay_bytes` /
--      `replay_copied_at` (sha256 and length of the exact uncompressed text, set by the backfill).
--   3. The `tp_*` list facts stop being GENERATED columns (values kept, no rewrite) and are filled by a trigger from
--      `replay`, or from `replay_head` when the replay itself lives in Storage. The expressions are the very ones the
--      generated columns used, so every existing value and every list read is unchanged. A client row that carries
--      neither gets null facts (a client can never write its own facts). A client row's `replay_path` must sit in its
--      own folder.
--   4. maint.run_telemetry_replay_report() (counts) and maint.run_telemetry_clear_copied_replays(phrase, limit): the
--      LEAD-RUN clear step. It nulls `replay` only on rows whose object was copied AND whose current replay text still
--      hashes to the recorded sha256, writing `replay_head` in the same statement, so the facts stay identical.
--
-- Order: apply this file -> ship the client (new games then write to Storage; every reader falls back to the column) ->
-- run `npm run replays:backfill` (copies, re-downloads, verifies byte equality, records the proof) -> check
-- `select * from maint.run_telemetry_replay_report()` -> run the clear in batches -> `vacuum full public.run_telemetry`
-- (optional, returns the space now; plain autovacuum reuses it anyway).
--
-- Rollback before the clear: drop the trigger, re-add nothing (the copied objects are extra; `replay` is intact).
-- After the clear: a row's replay is its Storage object; `npm run replays:backfill -- --restore` writes it back.

-- ── 1. The bucket and its policies ─────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('replays', 'replays', false, 52428800, array['application/gzip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "replays: upload into own folder" on storage.objects;
create policy "replays: upload into own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'replays' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "replays: read with a session" on storage.objects;
create policy "replays: read with a session" on storage.objects for select to authenticated
  using (bucket_id = 'replays');

-- ── 2. The pointer, the head and the copy proof ─────────────────────────────────────────────────────────────
alter table public.run_telemetry
  add column if not exists replay_path      text,
  add column if not exists replay_head      jsonb,
  add column if not exists replay_sha256    text,
  add column if not exists replay_bytes     integer,
  add column if not exists replay_copied_at timestamptz;

-- ── 3. The facts: plain columns, filled by a trigger with the generated columns' own expressions ──────────────
do $$
declare
  col text;
begin
  foreach col in array array['tp_seed', 'tp_v2_version', 'tp_first_t', 'tp_last_t', 'tp_active_ms', 'tp_final_board',
    'tp_record', 'tp_partial', 'tp_first_wave', 'tp_lobby_strength', 'tp_board_strength'] loop
    if exists (select 1 from pg_attribute where attrelid = 'public.run_telemetry'::regclass and attname = col and attgenerated = 's') then
      execute format('alter table public.run_telemetry alter column %I drop expression', col);
    end if;
  end loop;
end $$;

create or replace function public.run_telemetry_replay_facts() returns trigger
language plpgsql set search_path = public as $$
declare
  src jsonb := coalesce(new.replay, new.replay_head);
begin
  if tg_op = 'INSERT' and new.replay_path is not null and new.user_id is not null
     and left(new.replay_path, length(new.user_id::text) + 1) <> new.user_id::text || '/' then
    raise exception 'run_telemetry: replay_path must be inside the owner''s folder' using errcode = '42501';
  end if;
  if src is null then
    if tg_op = 'INSERT' then
      new.tp_seed := null; new.tp_v2_version := null; new.tp_first_t := null; new.tp_last_t := null;
      new.tp_active_ms := null; new.tp_final_board := null; new.tp_record := null; new.tp_partial := null;
      new.tp_first_wave := null; new.tp_lobby_strength := null; new.tp_board_strength := null;
    end if;
    return new;
  end if;
  new.tp_seed           := src ->> 'seed';
  new.tp_v2_version     := src -> 'v2' ->> 'version';
  new.tp_first_t        := src -> 'v2' -> 'frames' -> 0 ->> 'tMs';
  new.tp_last_t         := src -> 'v2' -> 'frames' -> -1 ->> 'tMs';
  new.tp_active_ms      := src -> 'v2' ->> 'activeMs';
  new.tp_final_board    := src -> 'v2' -> 'result' -> 'finalBoard';
  new.tp_record         := src -> 'v2' -> 'result' -> 'record';
  new.tp_partial        := src -> 'v2' ->> 'partial';
  new.tp_first_wave     := src -> 'v2' ->> 'firstRecordedWave';
  new.tp_lobby_strength := src -> 'v2' -> 'result' -> 'lobbyStrength';
  new.tp_board_strength := src -> 'v2' -> 'result' ->> 'boardStrength';
  return new;
end $$;
revoke all on function public.run_telemetry_replay_facts() from public, anon, authenticated;

drop trigger if exists run_telemetry_replay_facts on public.run_telemetry;
create trigger run_telemetry_replay_facts before insert or update of replay, replay_head on public.run_telemetry
  for each row execute function public.run_telemetry_replay_facts();

-- A client reads the pointer like any other column (the read policy is the table's).
create index if not exists run_telemetry_tp_seed on public.run_telemetry (tp_seed);

-- ── 4. The lead-run clear step ─────────────────────────────────────────────────────────────────────────────
create schema if not exists maint;
revoke all on schema maint from public, anon, authenticated;

-- The replay without its bulk: top-level arrays (the v1 action log) and v2's frames / trails / stream go; `frames`
-- keeps only its first and last clock, so every tp_* fact reads the same from the head as from the whole replay.
-- packages/ui/src/replayStorage.ts replayHeadOf() is the client twin (same rule).
create or replace function maint.replay_head(r jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select case when r is null or jsonb_typeof(r) <> 'object' then r else
    coalesce((select jsonb_object_agg(k, v) from jsonb_each(r) e(k, v) where k <> 'v2' and jsonb_typeof(v) <> 'array'), '{}'::jsonb)
    || case when jsonb_typeof(r -> 'v2') = 'object' then jsonb_build_object('v2',
         coalesce((select jsonb_object_agg(k, v) from jsonb_each(r -> 'v2') e(k, v) where k <> 'stream' and jsonb_typeof(v) <> 'array'), '{}'::jsonb)
         || case when jsonb_typeof(r -> 'v2' -> 'frames') = 'array' and jsonb_array_length(r -> 'v2' -> 'frames') > 0
              then jsonb_build_object('frames', jsonb_build_array(
                jsonb_build_object('tMs', r -> 'v2' -> 'frames' -> 0 -> 'tMs'),
                jsonb_build_object('tMs', r -> 'v2' -> 'frames' -> -1 -> 'tMs')))
              else '{}'::jsonb end)
       else '{}'::jsonb end
  end $$;

create or replace function maint.run_telemetry_replay_report() returns table (metric text, n bigint)
language sql set search_path = pg_catalog, public as $$
  select 'rows', count(*) from public.run_telemetry
  union all select 'replay inline (in the table)', count(*) from public.run_telemetry where replay is not null
  union all select 'inline AND copied to Storage (ready to clear)', count(*) from public.run_telemetry where replay is not null and replay_path is not null and replay_sha256 is not null
  union all select 'inline, not copied yet', count(*) from public.run_telemetry where replay is not null and replay_path is null
  union all select 'in Storage only', count(*) from public.run_telemetry where replay is null and replay_path is not null
  union all select 'no replay at all', count(*) from public.run_telemetry where replay is null and replay_path is null
  union all select 'inline replay bytes (text)', coalesce(sum(octet_length(replay::text)), 0) from public.run_telemetry where replay is not null
$$;

create or replace function maint.run_telemetry_clear_copied_replays(p_confirm text, p_limit int default 50) returns int
language plpgsql set search_path = pg_catalog, public as $$
declare
  n int;
begin
  if p_confirm is distinct from 'CLEAR COPIED REPLAYS' then
    raise exception 'run_telemetry_clear_copied_replays: pass the phrase ''CLEAR COPIED REPLAYS'' (check maint.run_telemetry_replay_report() first)';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'run_telemetry_clear_copied_replays: batch size 1..500'; end if;
  with pick as (
    select t.id from public.run_telemetry t
    where t.replay is not null and t.replay_path is not null and t.replay_copied_at is not null
      and t.replay_sha256 = encode(sha256(convert_to(t.replay::text, 'UTF8')), 'hex')
      and t.replay_bytes = octet_length(t.replay::text)
    order by t.id limit p_limit
    for update skip locked
  )
  update public.run_telemetry t set replay_head = maint.replay_head(t.replay), replay = null
  from pick where t.id = pick.id;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function maint.replay_head(jsonb) from public, anon, authenticated;
revoke all on function maint.run_telemetry_replay_report() from public, anon, authenticated;
revoke all on function maint.run_telemetry_clear_copied_replays(text, int) from public, anon, authenticated;

notify pgrst, 'reload schema';
