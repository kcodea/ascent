-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- CROSS-DEVICE SAVES  (2026-09-30, R-PERSIST-CLOUD-01..03)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Owner ask: "if a player is playing on one device and they save/quit, can we allow that to be picked up from
-- another device they are signed in on?"
--
-- ONE row per SIGNED-IN account: the serialized in-progress run (the client's local save string, carried
-- verbatim), a `revision` that every write must name, and the device that wrote it. The client reads its own
-- row through RLS; it WRITES only through the two functions below, which enforce "one device at a time":
--   put_saved_run   — save or claim. Accepted only when `p_expected` is the row's current revision (or 0 for
--                     a brand-new run taking the slot). Anything else is refused and the current row's meta is
--                     returned, so a stale device is told the run moved instead of overwriting newer progress.
--   clear_saved_run — the run ended (or was discarded): delete the row, again only at the expected revision.
-- Guests (anonymous accounts) are refused: their account lives on one device. Idempotent: safe to re-run.

create table if not exists public.saved_runs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  run_key    text        not null,
  payload    jsonb       not null,
  revision   bigint      not null default 1,
  device_id  text        not null,
  updated_at timestamptz not null default now()
);

alter table public.saved_runs enable row level security;

drop policy if exists "read own saved run" on public.saved_runs;
create policy "read own saved run" on public.saved_runs
  for select to authenticated using (auth.uid() = user_id);

-- Reads only, and only for signed-in roles. Writes go through the functions (no insert/update/delete grant).
revoke all on public.saved_runs from public, anon, authenticated;
grant select on public.saved_runs to authenticated;

create or replace function public.put_saved_run(
  p_run_key text, p_expected bigint, p_device text, p_payload jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cur public.saved_runs;
  meta jsonb;
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('status', 'refused');
  end if;
  if p_run_key is null or length(p_run_key) < 1 or length(p_run_key) > 128
     or p_device is null or length(p_device) > 128 then
    raise exception 'bad_arguments';
  end if;

  select * into cur from public.saved_runs where user_id = uid for update;

  if not found then
    -- Nothing saved. A new run (expected 0, with a payload) takes the slot; a claim or a save of a run that
    -- was synced before (expected > 0) finds it GONE: that run ended on another device.
    if p_expected = 0 and p_payload is not null then
      insert into public.saved_runs (user_id, run_key, payload, revision, device_id)
      values (uid, p_run_key, p_payload, 1, p_device)
      on conflict (user_id) do nothing;
      if found then return jsonb_build_object('status', 'ok', 'revision', 1); end if;
      select * into cur from public.saved_runs where user_id = uid;
    else
      return jsonb_build_object('status', 'conflict', 'current', null);
    end if;
  end if;

  if cur.user_id is not null and (
       (cur.run_key = p_run_key and cur.revision = p_expected)
       -- a NEW run replaces a different run in the slot (the player started over on this device)
       or (p_expected = 0 and p_payload is not null and cur.run_key <> p_run_key)
     ) then
    update public.saved_runs
       set run_key = p_run_key, payload = coalesce(p_payload, payload), revision = cur.revision + 1,
           device_id = p_device, updated_at = now()
     where user_id = uid;
    return jsonb_build_object('status', 'ok', 'revision', cur.revision + 1);
  end if;

  meta := jsonb_build_object('run_key', cur.run_key, 'revision', cur.revision, 'device_id', cur.device_id,
                             'updated_at', cur.updated_at);
  return jsonb_build_object('status', 'conflict', 'current', meta);
end $$;

create or replace function public.clear_saved_run(p_run_key text, p_expected bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return jsonb_build_object('status', 'refused');
  end if;
  delete from public.saved_runs where user_id = uid and run_key = p_run_key and revision = p_expected;
  if found then return jsonb_build_object('status', 'ok'); end if;
  return jsonb_build_object('status', 'conflict');
end $$;

revoke all on function public.put_saved_run(text, bigint, text, jsonb) from public, anon, authenticated;
revoke all on function public.clear_saved_run(text, bigint) from public, anon, authenticated;
grant execute on function public.put_saved_run(text, bigint, text, jsonb) to authenticated;
grant execute on function public.clear_saved_run(text, bigint) to authenticated;
