-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- FRIENDS: requests, blocks, presence and invites (owner 2026-10-26; feat/friends-list; R-FRIENDS-01..05)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Owner (2026-10-26): yes to a friends list that shows online players, to simplify invites (Versus rooms now, the
-- Ranked Duos party later). ADDITIVE ONLY: new tables, functions, policies and one Realtime publication entry; it
-- touches no existing table or row. Idempotent (safe to re-run). No Edge Function.
--
-- THE MODEL
--  - friendships: ONE row per pair, stored ordered (user_a < user_b), with the requester and a status
--    ('pending' | 'accepted'). A decline, cancel or remove deletes the row (no history kept).
--  - user_blocks: blocker -> blocked. A block deletes the pair's friendship and cancels their open invites, and
--    while it stands neither side can request or invite the other (block wins).
--  - player_presence: one row per account, written ONLY by `friends_beat` (the client's one presence beat: every
--    60 s visible, 120 s hidden, at once on a status change). A row older than 180 s reads as Offline. Readable by
--    the owner and their accepted friends only. Never broadcast over Realtime (egress rule R-NET-REALTIME-01).
--  - friend_invites: a 2-minute invite from a friend to a friend ('versus_room' = join my Versus room;
--    'duos_party' = the Ranked Duos party, whose own feature validates the target). Readable by the two ends only.
--    The ONE Realtime entry: the client subscribes to INSERTs filtered to rows addressed to itself (to_user).
--  - friend_rate: a small ledger for the rate limits (20 requests and 30 invites per hour per account).
--
-- ACCOUNTS ONLY: every RPC refuses a guest (an anonymous auth user) with 'guest', and a guest can never be the
-- target ('not_an_account'). Every write goes through a security-definer RPC; the client roles may only SELECT
-- their own rows (RLS), so nothing here can be forged from the browser.
--
-- ERRORS (raise exception '<code>'; the client maps each to a sentence): not_signed_in, guest, bad_handle,
-- not_found, not_an_account, self, blocked, you_blocked, already_friends, already_requested, too_many_friends,
-- too_many_requests, rate_limited, no_request, not_friends, not_online, bad_kind, bad_target, not_in_room,
-- room_not_open, already_in_room, no_invite, expired, bad_status.

-- ── 1. Tables ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.friendships (
  user_a      uuid not null references auth.users(id) on delete cascade,
  user_b      uuid not null references auth.users(id) on delete cascade,
  requester   uuid not null,
  status      text not null default 'pending',
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  primary key (user_a, user_b),
  constraint friendships_ordered check (user_a < user_b),
  constraint friendships_requester check (requester = user_a or requester = user_b),
  constraint friendships_status check (status in ('pending', 'accepted'))
);
create index if not exists friendships_user_b on public.friendships (user_b);

create table if not exists public.user_blocks (
  blocker    uuid not null references auth.users(id) on delete cascade,
  blocked    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  constraint user_blocks_not_self check (blocker <> blocked)
);
create index if not exists user_blocks_blocked on public.user_blocks (blocked);

create table if not exists public.player_presence (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  status     text not null default 'online',
  mode       text,
  watch_kind text,
  watch_id   text,
  updated_at timestamptz not null default now(),
  constraint player_presence_status check (status in ('online', 'in_game', 'offline')),
  constraint player_presence_mode check (mode is null or mode ~ '^[a-z0-9_]{1,24}$'),
  constraint player_presence_watch check ((watch_kind is null and watch_id is null) or (watch_kind in ('live', 'versus') and char_length(watch_id) between 1 and 64))
);

create table if not exists public.friend_invites (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references auth.users(id) on delete cascade,
  to_user      uuid not null references auth.users(id) on delete cascade,
  kind         text not null,
  target       text not null,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  responded_at timestamptz,
  constraint friend_invites_kind check (kind in ('versus_room', 'duos_party')),
  constraint friend_invites_target check (char_length(target) between 1 and 64),
  constraint friend_invites_status check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  constraint friend_invites_not_self check (from_user <> to_user)
);
create index if not exists friend_invites_to on public.friend_invites (to_user, status);
create index if not exists friend_invites_from on public.friend_invites (from_user, created_at);

create table if not exists public.friend_rate (
  user_id uuid not null,
  kind    text not null,
  at      timestamptz not null default now()
);
create index if not exists friend_rate_user on public.friend_rate (user_id, kind, at);

-- ── 2. Row level security: read your own rows only; no client writes at all ─────────────────────────────
alter table public.friendships enable row level security;
alter table public.user_blocks enable row level security;
alter table public.player_presence enable row level security;
alter table public.friend_invites enable row level security;
alter table public.friend_rate enable row level security;

revoke all on public.friendships, public.user_blocks, public.player_presence, public.friend_invites, public.friend_rate from anon, authenticated;
grant select on public.friendships, public.user_blocks, public.player_presence, public.friend_invites to authenticated;

drop policy if exists "friendships: my pairs" on public.friendships;
create policy "friendships: my pairs" on public.friendships for select to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

drop policy if exists "user_blocks: mine" on public.user_blocks;
create policy "user_blocks: mine" on public.user_blocks for select to authenticated
  using (auth.uid() = blocker);

drop policy if exists "player_presence: me and my friends" on public.player_presence;
create policy "player_presence: me and my friends" on public.player_presence for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.friendships f
      where f.status = 'accepted'
        and f.user_a = least(auth.uid(), player_presence.user_id)
        and f.user_b = greatest(auth.uid(), player_presence.user_id)
    )
  );

drop policy if exists "friend_invites: either end" on public.friend_invites;
create policy "friend_invites: either end" on public.friend_invites for select to authenticated
  using (auth.uid() = from_user or auth.uid() = to_user);

-- ── 3. Helpers (internal: no client role may call them) ─────────────────────────────────────────────────
-- Presence older than this reads as Offline. The client beats every 60 s (120 s in a hidden tab).
create or replace function public.friends__stale() returns interval language sql immutable as $$ select interval '180 seconds' $$;
-- An invite lives this long (owner scope: ~2 minutes).
create or replace function public.friends__invite_ttl() returns interval language sql immutable as $$ select interval '120 seconds' $$;

create or replace function public.friends__is_account(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users u where u.id = p_user and coalesce(u.is_anonymous, false) = false)
$$;

-- The caller, who must be a signed-in ACCOUNT (not a guest).
create or replace function public.friends__me() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'not_signed_in'; end if;
  if not public.friends__is_account(v) then raise exception 'guest'; end if;
  return v;
end;
$$;

create or replace function public.friends__blocked(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_blocks where (blocker = p_a and blocked = p_b) or (blocker = p_b and blocked = p_a))
$$;

create or replace function public.friends__are_friends(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b) and status = 'accepted')
$$;

-- Count one action against the caller's hourly budget, or refuse it.
create or replace function public.friends__rate(p_user uuid, p_kind text, p_max int) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.friend_rate where user_id = p_user and at < now() - interval '1 day';
  if (select count(*) from public.friend_rate where user_id = p_user and kind = p_kind and at > now() - interval '1 hour') >= p_max then
    raise exception 'rate_limited';
  end if;
  insert into public.friend_rate (user_id, kind) values (p_user, p_kind);
end;
$$;

-- Cancel every open invite between two players (a block or a removal).
create or replace function public.friends__cancel_invites(p_a uuid, p_b uuid) returns void
language sql security definer set search_path = public as $$
  update public.friend_invites set status = 'cancelled', responded_at = now()
  where status = 'pending' and ((from_user = p_a and to_user = p_b) or (from_user = p_b and to_user = p_a))
$$;

-- A player's public card: handle, portrait picks and the equipped frame / favourite-hero skin.
create or replace function public.friends__card(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'userId', p_user,
    'author', p.author,
    'discriminator', p.discriminator,
    'avatar', p.avatar,
    'favoriteHero', p.favorite_hero,
    'frame', (select l.cosmetic_id from public.cosmetic_loadouts l where l.user_id = p_user and l.slot = 'portrait_frame' limit 1),
    'skin', (select l.cosmetic_id from public.cosmetic_loadouts l where l.user_id = p_user and l.slot = 'hero_skin' and l.target_id = p.favorite_hero limit 1)
  )
  from (select 1) one
  left join public.profiles p on p.user_id = p_user
$$;

-- What a friend's presence reads as right now (Offline once stale).
create or replace function public.friends__presence(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when pr.user_id is null then jsonb_build_object('status', 'offline', 'lastSeen', null)
    when pr.status = 'offline' or pr.updated_at < now() - public.friends__stale()
      then jsonb_build_object('status', 'offline', 'lastSeen', pr.updated_at)
    else jsonb_build_object('status', pr.status, 'mode', pr.mode, 'watchKind', pr.watch_kind, 'watchId', pr.watch_id, 'lastSeen', pr.updated_at)
  end
  from (select 1) one
  left join public.player_presence pr on pr.user_id = p_user
$$;

create or replace function public.friends__online(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.player_presence where user_id = p_user and status = 'online' and updated_at >= now() - public.friends__stale())
$$;

-- The invites addressed to me that are still open.
create or replace function public.friends__my_invites(p_me uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', i.id, 'kind', i.kind, 'target', i.target, 'expiresAt', i.expires_at, 'createdAt', i.created_at,
      'from', public.friends__card(i.from_user)
    ) order by i.created_at desc), '[]'::jsonb)
  from public.friend_invites i
  where i.to_user = p_me and i.status = 'pending' and i.expires_at > now()
$$;

revoke all on function public.friends__stale(), public.friends__invite_ttl(), public.friends__is_account(uuid), public.friends__me(),
  public.friends__blocked(uuid, uuid), public.friends__are_friends(uuid, uuid), public.friends__rate(uuid, text, int),
  public.friends__cancel_invites(uuid, uuid), public.friends__card(uuid), public.friends__presence(uuid),
  public.friends__online(uuid), public.friends__my_invites(uuid) from public, anon, authenticated;

-- ── 4. Requests ──────────────────────────────────────────────────────────────────────────────────────────
-- Send a request, by user id (a Leaderboard row, a profile, a Versus room) or by handle "Name#1234". When the target
-- already asked me, this ACCEPTS theirs instead (status 'accepted').
create or replace function public.friends_request(p_user uuid default null, p_handle text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.friends__me();
  v_to uuid := p_user;
  v_name text;
  v_tag text;
  f public.friendships;
begin
  if v_to is null then
    -- "Name#1234": the name is everything before the LAST '#', the tag its four digits.
    if p_handle is null or trim(p_handle) !~ '^.{1,40}#[0-9]{4}$' then raise exception 'bad_handle'; end if;
    v_name := trim(substring(trim(p_handle) from '^(.*)#[0-9]{4}$'));
    v_tag := right(trim(p_handle), 4);
    if coalesce(v_name, '') = '' then raise exception 'bad_handle'; end if;
    select p.user_id into v_to from public.profiles p
      where lower(p.author) = lower(v_name) and p.discriminator = v_tag and p.user_id is not null limit 1;
    if v_to is null then raise exception 'not_found'; end if;
  end if;
  if v_to = v_me then raise exception 'self'; end if;
  if not public.friends__is_account(v_to) then raise exception 'not_an_account'; end if;
  if exists (select 1 from public.user_blocks where blocker = v_me and blocked = v_to) then raise exception 'you_blocked'; end if;
  if exists (select 1 from public.user_blocks where blocker = v_to and blocked = v_me) then raise exception 'blocked'; end if;

  select * into f from public.friendships where user_a = least(v_me, v_to) and user_b = greatest(v_me, v_to) for update;
  if found then
    if f.status = 'accepted' then raise exception 'already_friends'; end if;
    if f.requester = v_me then raise exception 'already_requested'; end if;
    -- They asked me first: this is my yes.
    update public.friendships set status = 'accepted', accepted_at = now() where user_a = f.user_a and user_b = f.user_b;
    return jsonb_build_object('status', 'accepted', 'userId', v_to);
  end if;

  if (select count(*) from public.friendships where (user_a = v_me or user_b = v_me) and status = 'accepted') >= 200 then raise exception 'too_many_friends'; end if;
  if (select count(*) from public.friendships where requester = v_me and status = 'pending') >= 50 then raise exception 'too_many_requests'; end if;
  perform public.friends__rate(v_me, 'request', 20);
  insert into public.friendships (user_a, user_b, requester, status) values (least(v_me, v_to), greatest(v_me, v_to), v_me, 'pending');
  return jsonb_build_object('status', 'sent', 'userId', v_to);
end;
$$;

-- Accept or decline a request someone sent me. A decline deletes it (they may ask again later).
create or replace function public.friends_respond(p_user uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.friends__me();
  f public.friendships;
begin
  select * into f from public.friendships where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user) for update;
  if not found or f.status <> 'pending' or f.requester <> p_user then raise exception 'no_request'; end if;
  if not coalesce(p_accept, false) or public.friends__blocked(v_me, p_user) then
    delete from public.friendships where user_a = f.user_a and user_b = f.user_b;
    return jsonb_build_object('status', 'declined', 'userId', p_user);
  end if;
  if (select count(*) from public.friendships where (user_a = v_me or user_b = v_me) and status = 'accepted') >= 200 then raise exception 'too_many_friends'; end if;
  update public.friendships set status = 'accepted', accepted_at = now() where user_a = f.user_a and user_b = f.user_b;
  return jsonb_build_object('status', 'accepted', 'userId', p_user);
end;
$$;

-- Take back a request I sent that is still pending.
create or replace function public.friends_cancel(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.friends__me();
begin
  delete from public.friendships
    where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user) and status = 'pending' and requester = v_me;
  if not found then raise exception 'no_request'; end if;
  return jsonb_build_object('status', 'cancelled', 'userId', p_user);
end;
$$;

-- Remove a friend (either side may).
create or replace function public.friends_remove(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.friends__me();
begin
  delete from public.friendships where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user) and status = 'accepted';
  if not found then raise exception 'not_friends'; end if;
  perform public.friends__cancel_invites(v_me, p_user);
  return jsonb_build_object('status', 'removed', 'userId', p_user);
end;
$$;

-- Block a player: ends any friendship or request between us and cancels open invites both ways.
create or replace function public.friends_block(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.friends__me();
begin
  if p_user is null or p_user = v_me then raise exception 'self'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'not_found'; end if;
  if (select count(*) from public.user_blocks where blocker = v_me) >= 500 then raise exception 'rate_limited'; end if;
  insert into public.user_blocks (blocker, blocked) values (v_me, p_user) on conflict do nothing;
  delete from public.friendships where user_a = least(v_me, p_user) and user_b = greatest(v_me, p_user);
  perform public.friends__cancel_invites(v_me, p_user);
  return jsonb_build_object('status', 'blocked', 'userId', p_user);
end;
$$;

create or replace function public.friends_unblock(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.friends__me();
begin
  delete from public.user_blocks where blocker = v_me and blocked = p_user;
  return jsonb_build_object('status', 'unblocked', 'userId', p_user);
end;
$$;

-- ── 5. Presence + the inbox: the client's ONE periodic call ──────────────────────────────────────────────
-- Writes my presence row and answers what my menus need without another read: how many friends I have and how
-- many are online, how many requests wait for me, and my open invites. ~100 bytes when nothing is waiting.
create or replace function public.friends_beat(p_status text, p_mode text default null, p_watch_kind text default null, p_watch_id text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.friends__me();
  v_mode text := nullif(left(coalesce(p_mode, ''), 24), '');
  v_wk text := case when p_watch_kind in ('live', 'versus') and coalesce(p_watch_id, '') <> '' then p_watch_kind else null end;
  v_wid text := case when p_watch_kind in ('live', 'versus') and coalesce(p_watch_id, '') <> '' then left(p_watch_id, 64) else null end;
begin
  if p_status is null or p_status not in ('online', 'in_game', 'offline') then raise exception 'bad_status'; end if;
  if v_mode is not null and v_mode !~ '^[a-z0-9_]{1,24}$' then v_mode := null; end if;
  insert into public.player_presence (user_id, status, mode, watch_kind, watch_id, updated_at)
    values (v_me, p_status, v_mode, v_wk, v_wid, now())
    on conflict (user_id) do update set status = excluded.status, mode = excluded.mode, watch_kind = excluded.watch_kind,
      watch_id = excluded.watch_id, updated_at = excluded.updated_at;
  return jsonb_build_object(
    'friends', (select count(*) from public.friendships where (user_a = v_me or user_b = v_me) and status = 'accepted'),
    'online', (select count(*) from public.friendships f
                 join public.player_presence pr on pr.user_id = case when f.user_a = v_me then f.user_b else f.user_a end
                where (f.user_a = v_me or f.user_b = v_me) and f.status = 'accepted'
                  and pr.status <> 'offline' and pr.updated_at >= now() - public.friends__stale()),
    'incoming', (select count(*) from public.friendships where (user_a = v_me or user_b = v_me) and status = 'pending' and requester <> v_me),
    'invites', public.friends__my_invites(v_me),
    'serverNow', now()
  );
end;
$$;

-- The friends panel's ONE batched read: friends with their presence, requests both ways, blocks, open invites to
-- me and the invites I sent in the last few minutes (so the inviter sees Accepted / Declined).
create or replace function public.friends_list()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_me uuid := public.friends__me();
begin
  return jsonb_build_object(
    'friends', (select coalesce(jsonb_agg(public.friends__card(o.u) || public.friends__presence(o.u) || jsonb_build_object('since', o.at) order by o.at), '[]'::jsonb)
                  from (select case when user_a = v_me then user_b else user_a end as u, accepted_at as at
                          from public.friendships where (user_a = v_me or user_b = v_me) and status = 'accepted') o),
    'incoming', (select coalesce(jsonb_agg(public.friends__card(f.requester) || jsonb_build_object('since', f.created_at) order by f.created_at desc), '[]'::jsonb)
                   from public.friendships f where (f.user_a = v_me or f.user_b = v_me) and f.status = 'pending' and f.requester <> v_me),
    'outgoing', (select coalesce(jsonb_agg(public.friends__card(case when f.user_a = v_me then f.user_b else f.user_a end) || jsonb_build_object('since', f.created_at) order by f.created_at desc), '[]'::jsonb)
                   from public.friendships f where f.requester = v_me and f.status = 'pending'),
    'blocked', (select coalesce(jsonb_agg(public.friends__card(b.blocked) || jsonb_build_object('since', b.created_at) order by b.created_at desc), '[]'::jsonb)
                  from public.user_blocks b where b.blocker = v_me),
    'invites', public.friends__my_invites(v_me),
    'sent', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'to', i.to_user, 'kind', i.kind, 'target', i.target,
                     'status', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end, 'expiresAt', i.expires_at) order by i.created_at desc), '[]'::jsonb)
               from public.friend_invites i where i.from_user = v_me and i.created_at > now() - interval '5 minutes'),
    'serverNow', now()
  );
end;
$$;

-- ── 6. Invites ───────────────────────────────────────────────────────────────────────────────────────────
-- Invite a friend who is online (on a menu, not in a game). 'versus_room': the target is a room I am in, open, that
-- they are not in yet. 'duos_party': an opaque party id (the Ranked Duos party validates it on accept). A newer
-- invite of the same kind to the same friend replaces my older one.
create or replace function public.friends_invite(p_user uuid, p_kind text, p_target text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.friends__me();
  v_room uuid;
  v_status text;
  i public.friend_invites;
begin
  if p_kind is null or p_kind not in ('versus_room', 'duos_party') then raise exception 'bad_kind'; end if;
  if p_target is null or char_length(p_target) not between 1 and 64 then raise exception 'bad_target'; end if;
  if p_user is null or p_user = v_me then raise exception 'self'; end if;
  if public.friends__blocked(v_me, p_user) then raise exception 'blocked'; end if;
  if not public.friends__are_friends(v_me, p_user) then raise exception 'not_friends'; end if;
  if not public.friends__online(p_user) then raise exception 'not_online'; end if;
  if p_kind = 'versus_room' then
    begin v_room := p_target::uuid; exception when others then raise exception 'bad_target'; end;
    select r.status into v_status from public.versus_rooms r where r.id = v_room;
    if v_status is null then raise exception 'room_not_open'; end if;
    if not exists (select 1 from public.versus_members m where m.room_id = v_room and m.user_id = v_me) then raise exception 'not_in_room'; end if;
    if v_status <> 'open' then raise exception 'room_not_open'; end if;
    if exists (select 1 from public.versus_members m where m.room_id = v_room and m.user_id = p_user) then raise exception 'already_in_room'; end if;
  end if;
  perform public.friends__rate(v_me, 'invite', 30);
  delete from public.friend_invites where from_user = v_me and created_at < now() - interval '1 day';
  update public.friend_invites set status = 'cancelled', responded_at = now()
    where from_user = v_me and to_user = p_user and kind = p_kind and status = 'pending';
  insert into public.friend_invites (from_user, to_user, kind, target, expires_at)
    values (v_me, p_user, p_kind, p_target, now() + public.friends__invite_ttl())
    returning * into i;
  return jsonb_build_object('id', i.id, 'kind', i.kind, 'target', i.target, 'expiresAt', i.expires_at);
end;
$$;

-- Answer an invite sent to me. Accept returns the target so the client joins it (the existing Versus join path).
create or replace function public.friends_invite_respond(p_invite uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.friends__me();
  i public.friend_invites;
begin
  select * into i from public.friend_invites where id = p_invite and to_user = v_me for update;
  if not found or i.status <> 'pending' then raise exception 'no_invite'; end if;
  -- (A raise rolls the call back, so these leave the row as it is: an overdue invite already reads as expired.)
  if i.expires_at <= now() then raise exception 'expired'; end if;
  if coalesce(p_accept, false) and (public.friends__blocked(v_me, i.from_user) or not public.friends__are_friends(v_me, i.from_user)) then
    raise exception 'not_friends';
  end if;
  update public.friend_invites set status = case when coalesce(p_accept, false) then 'accepted' else 'declined' end, responded_at = now()
    where id = i.id;
  return jsonb_build_object('status', case when coalesce(p_accept, false) then 'accepted' else 'declined' end,
    'kind', i.kind, 'target', i.target, 'from', i.from_user);
end;
$$;

-- Withdraw an invite I sent.
create or replace function public.friends_invite_cancel(p_invite uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.friends__me();
begin
  update public.friend_invites set status = 'cancelled', responded_at = now()
    where id = p_invite and from_user = v_me and status = 'pending';
  if not found then raise exception 'no_invite'; end if;
  return jsonb_build_object('status', 'cancelled');
end;
$$;

revoke all on function public.friends_request(uuid, text), public.friends_respond(uuid, boolean), public.friends_cancel(uuid),
  public.friends_remove(uuid), public.friends_block(uuid), public.friends_unblock(uuid), public.friends_beat(text, text, text, text),
  public.friends_list(), public.friends_invite(uuid, text, text), public.friends_invite_respond(uuid, boolean),
  public.friends_invite_cancel(uuid) from public, anon;
grant execute on function public.friends_request(uuid, text), public.friends_respond(uuid, boolean), public.friends_cancel(uuid),
  public.friends_remove(uuid), public.friends_block(uuid), public.friends_unblock(uuid), public.friends_beat(text, text, text, text),
  public.friends_list(), public.friends_invite(uuid, text, text), public.friends_invite_respond(uuid, boolean),
  public.friends_invite_cancel(uuid) to authenticated;

-- ── 7. Realtime: invites only (rows addressed to me, filtered by the client on to_user) ─────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_invites') then
      alter publication supabase_realtime add table public.friend_invites;
    end if;
  end if;
end;
$$;
