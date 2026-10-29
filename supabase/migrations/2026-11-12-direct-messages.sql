-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- DIRECT MESSAGES between friends (owner 2026-10-29: "start building in game messaging"; "In game messaging should be
-- direct messages through the friends list, click a friend and a chat overlay pops up"; feat/messaging; R-DM-01..05)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- APPLY AFTER 2026-10-28-friends.sql and 2026-11-04-versus-cf-writer.sql (it reuses `friends__*` helpers and the
-- Worker's writer key table). ADDITIVE ONLY and idempotent (safe to re-run). No Edge Function.
--
-- THE MODEL
--  - direct_messages: one row per message (sender -> recipient, body, created_at, read_at). Written ONLY by the friends
--    hub on Cloudflare through `dm_cf_send` (key-gated, the `versus_cf_persist` pattern: the publishable key plus the
--    Worker's writer secret, never the service role). Delivered live over the hub's socket, so nothing here is on
--    Realtime (egress rule R-NET-REALTIME-01).
--  - dm_reports: "Report message" rows for review, with a copy of the body (the message itself may be pruned).
--
-- RULES (Postgres is the authority; the hub checks the cheap ones first):
--  - Friends only (an accepted friendship), accounts only, and no block either way. A block also HIDES the pair's
--    history and unread counts from both while it stands.
--  - A body is 1..500 characters (the hub cleans it first: no control characters, spaces collapsed, trimmed).
--  - The same (sender, client id) again answers the stored row: a retry after a timeout is stored once.
--  - Backstop rate: 30 messages a minute per sender (the hub's own limit is 5 per 10 s).
--  - Retention: 90 days. `dm_prune()` deletes older messages (and reports older than 180 days); pg_cron runs it daily
--    at 04:17 UTC when the extension is present (it is on the live project: 2026-11-01-ranked-duos-sweep-cron.sql).
--
-- CLIENT CALLS (authenticated accounts; each refuses a guest with 'guest'):
--  - dm_history(p_with, p_before, p_limit): one conversation, newest first, 50 at a time (`p_before` pages older).
--  - dm_unread(): unread counts per friend, plus the newest unread message of each (the badge and the toast on open).
--  - dm_mark_read(p_with): marks every message from that friend read (a write only when there was something unread).
--  - dm_report(p_message, p_reason): reports a message sent TO me (once per message).
--
-- ERRORS (raise exception '<code>'): not_signed_in, guest, bad_key, bad_body, bad_target, not_friends, blocked,
-- rate_limited, not_found, bad_reason.

create extension if not exists pgcrypto with schema extensions;

-- ── 1. Tables ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.direct_messages (
  id         uuid primary key default gen_random_uuid(),
  sender     uuid not null references auth.users(id) on delete cascade,
  recipient  uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  client_id  uuid,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  constraint direct_messages_body check (char_length(body) between 1 and 500),
  constraint direct_messages_not_self check (sender <> recipient)
);
create unique index if not exists direct_messages_client on public.direct_messages (sender, client_id) where client_id is not null;
-- A conversation, newest first, from either side.
create index if not exists direct_messages_pair on public.direct_messages (sender, recipient, created_at desc);
create index if not exists direct_messages_pair_in on public.direct_messages (recipient, sender, created_at desc);
-- Unread counts (small: only unread rows).
create index if not exists direct_messages_unread on public.direct_messages (recipient) where read_at is null;
create index if not exists direct_messages_age on public.direct_messages (created_at);

create table if not exists public.dm_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter    uuid not null references auth.users(id) on delete cascade,
  message_id  uuid not null,
  sender      uuid not null,
  body        text not null,
  sent_at     timestamptz not null,
  reason      text not null default 'other',
  created_at  timestamptz not null default now(),
  status      text not null default 'open',
  constraint dm_reports_reason check (reason in ('abuse', 'spam', 'cheating', 'other')),
  constraint dm_reports_status check (status in ('open', 'reviewed', 'actioned', 'dismissed')),
  constraint dm_reports_once unique (reporter, message_id)
);
create index if not exists dm_reports_open on public.dm_reports (status, created_at);

-- ── 2. Row level security: each player reads only their own conversations; no client writes at all ─────
alter table public.direct_messages enable row level security;
alter table public.dm_reports enable row level security;
revoke all on public.direct_messages, public.dm_reports from anon, authenticated;
grant select on public.direct_messages to authenticated;

drop policy if exists "direct_messages: my conversations" on public.direct_messages;
create policy "direct_messages: my conversations" on public.direct_messages for select to authenticated
  using (auth.uid() = sender or auth.uid() = recipient);
-- dm_reports: no policy at all (review happens in the dashboard / with the service role).

-- ── 3. The hub's writer (key-gated, anon may execute; the key is the only gate) ────────────────────────
create or replace function public.dm__key_ok(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_key is not null and exists (select 1 from public.versus_cf_writer_keys where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex'))
$$;

create or replace function public.dm__row(m public.direct_messages) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', m.id, 'cid', m.client_id, 'from', m.sender, 'to', m.recipient, 'body', m.body,
    'at', m.created_at, 'readAt', m.read_at)
$$;

revoke all on function public.dm__key_ok(text), public.dm__row(public.direct_messages) from public, anon, authenticated;

create or replace function public.dm_cf_send(p_key text, p_from uuid, p_to uuid, p_body text, p_cid uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.direct_messages;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not public.dm__key_ok(p_key) then raise exception 'bad_key'; end if;
  if p_from is null or p_to is null or p_from = p_to then raise exception 'bad_target'; end if;
  -- A retry of a stored send answers the stored row (before any other check: it already passed them).
  if p_cid is not null then
    select * into v_row from public.direct_messages where sender = p_from and client_id = p_cid;
    if found then return public.dm__row(v_row); end if;
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then raise exception 'bad_body'; end if;
  if not public.friends__is_account(p_from) or not public.friends__is_account(p_to) then raise exception 'not_friends'; end if;
  if public.friends__blocked(p_from, p_to) then raise exception 'blocked'; end if;
  if not public.friends__are_friends(p_from, p_to) then raise exception 'not_friends'; end if;
  if (select count(*) from public.direct_messages where sender = p_from and created_at > now() - interval '1 minute') >= 30 then
    raise exception 'rate_limited';
  end if;
  insert into public.direct_messages (sender, recipient, body, client_id) values (p_from, p_to, v_body, p_cid)
  on conflict (sender, client_id) where client_id is not null do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.direct_messages where sender = p_from and client_id = p_cid;
  end if;
  return public.dm__row(v_row);
end;
$$;

-- The account's accepted friends, nobody blocked either way (the hub's presence fan-out list).
create or replace function public.dm_cf_friends(p_key text, p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.dm__key_ok(p_key) then raise exception 'bad_key'; end if;
  return coalesce((
    select jsonb_agg(case when f.user_a = p_user then f.user_b else f.user_a end)
    from public.friendships f
    where f.status = 'accepted' and (f.user_a = p_user or f.user_b = p_user)
      and not public.friends__blocked(f.user_a, f.user_b)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.dm_cf_send(text, uuid, uuid, text, uuid), public.dm_cf_friends(text, uuid) from public;
grant execute on function public.dm_cf_send(text, uuid, uuid, text, uuid), public.dm_cf_friends(text, uuid) to anon, authenticated;

-- ── 4. The client's reads and its one write (read receipts) ──────────────────────────────────────────────
create or replace function public.dm_history(p_with uuid, p_before timestamptz default null, p_limit int default 50)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.friends__me();
begin
  if p_with is null or p_with = v_me then raise exception 'bad_target'; end if;
  if public.friends__blocked(v_me, p_with) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(public.dm__row(m) order by m.created_at desc)
    from (
      select * from public.direct_messages d
      where ((d.sender = v_me and d.recipient = p_with) or (d.sender = p_with and d.recipient = v_me))
        and (p_before is null or d.created_at < p_before)
      order by d.created_at desc
      limit greatest(1, least(coalesce(p_limit, 50), 100))
    ) m
  ), '[]'::jsonb);
end;
$$;

-- Unread messages addressed to me, per sender: { "<sender id>": { "count": n, "last": <newest unread row> } }.
-- Only senders who are still friends and not blocked either way.
create or replace function public.dm_unread()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.friends__me();
begin
  return coalesce((
    select jsonb_object_agg(u.sender, jsonb_build_object('count', u.n, 'last', public.dm__row(u.last_row)))
    from (
      select d.sender, count(*) as n,
        (array_agg(d order by d.created_at desc))[1] as last_row
      from public.direct_messages d
      where d.recipient = v_me and d.read_at is null
        and public.friends__are_friends(v_me, d.sender) and not public.friends__blocked(v_me, d.sender)
      group by d.sender
    ) u
  ), '{}'::jsonb);
end;
$$;

-- Everything from this friend is read now. Answers how many rows it marked.
create or replace function public.dm_mark_read(p_with uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.friends__me(); v_n int;
begin
  update public.direct_messages set read_at = now()
  where recipient = v_me and sender = p_with and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Report a message sent to me. Once per message (a second report answers the first).
create or replace function public.dm_report(p_message uuid, p_reason text default 'other')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.friends__me(); v_m public.direct_messages; v_reason text := coalesce(p_reason, 'other');
begin
  if v_reason not in ('abuse', 'spam', 'cheating', 'other') then raise exception 'bad_reason'; end if;
  select * into v_m from public.direct_messages where id = p_message and recipient = v_me;
  if not found then raise exception 'not_found'; end if;
  insert into public.dm_reports (reporter, message_id, sender, body, sent_at, reason)
  values (v_me, v_m.id, v_m.sender, v_m.body, v_m.created_at, v_reason)
  on conflict (reporter, message_id) do nothing;
  return jsonb_build_object('reported', true);
end;
$$;

revoke all on function public.dm_history(uuid, timestamptz, int), public.dm_unread(), public.dm_mark_read(uuid),
  public.dm_report(uuid, text) from public, anon;
grant execute on function public.dm_history(uuid, timestamptz, int), public.dm_unread(), public.dm_mark_read(uuid),
  public.dm_report(uuid, text) to authenticated;

-- ── 5. Retention: 90 days of messages, 180 days of reports ───────────────────────────────────────────────
create or replace function public.dm_prune()
returns int
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  delete from public.direct_messages where created_at < now() - interval '90 days';
  get diagnostics v_n = row_count;
  delete from public.dm_reports where created_at < now() - interval '180 days';
  return v_n;
end;
$$;
revoke all on function public.dm_prune() from public, anon, authenticated;
grant execute on function public.dm_prune() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dm-prune';
    perform cron.schedule('dm-prune', '17 4 * * *', 'select public.dm_prune()');
  end if;
end;
$$;
