-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS TEST BOTS + THE DEV FORCING RPCs  (2026-10-25, the Duos dev tuner)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Owner 2026-10-25: "id like the ability to test the various mechanics with bots ... a dev tuner ... so i can just force
-- the various mechanics". The host's browser now runs up to THREE test bots (one anonymous account each, so every bot
-- holds its own seat), and a dev tuner forces the Duos mechanics. Paste into the Supabase SQL Editor and Run, AFTER
-- 2026-10-25-versus-duos.sql and 2026-10-25-versus-duos-xp.sql. Idempotent. No Edge Function redeploy.
--
-- 1. `versus_test_bots`: a bot account names the host whose browser drives it (`versus_test_bot_register`, called by
--    the bot's own session; only an ANONYMOUS account can be a bot). Bots seat themselves through the ordinary room
--    RPCs, exactly as before; nothing here changes how a person joins or plays.
-- 2. The dev forcing RPCs `versus_dev_set_hearts` and `versus_dev_skip_shop`: only the room's HOST, and only in a group
--    or Duos match where EVERY other seat is one of that host's registered bots (a solo test table). Using one marks the
--    match `dev_forced`.
-- 3. No XP from a test: a trigger on `progression_results` refuses a row for a registered bot account, and any row
--    whose source is a `dev_forced` match (the player's `versus:<id>` and a spectator's `watch:group:<id>`). It raises
--    `source_not_found`, which the progression function already answers as a permanent 409, so the client's queue
--    drops it (no retry loop). Bots never call progression anyway; this is the server's guarantee.
--
-- Records: `versus_records` already counts only 1v1 matches between two non-anonymous accounts, so a bot (anonymous)
-- never gives or gets a record. Unchanged.

-- ── 1. The bot registry ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.versus_test_bots (
  bot_user       uuid primary key,
  host_user      uuid not null,
  slot           int  not null check (slot between 1 and 3),
  registered_at  timestamptz not null default now()
);
alter table public.versus_test_bots enable row level security;
-- No policies: only the security definer functions below read or write it.

alter table public.versus_group_matches add column if not exists dev_forced boolean not null default false;

-- The calling bot account names the host whose browser drives it. Only an anonymous account can be a bot.
create or replace function public.versus_test_bot_register(p_host uuid, p_slot int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if p_host is null or p_host = v_user then raise exception 'bad_host'; end if;
  if p_slot is null or p_slot < 1 or p_slot > 3 then raise exception 'bad_slot'; end if;
  if not exists (select 1 from auth.users a where a.id = v_user and coalesce(a.is_anonymous, false)) then
    raise exception 'not_anonymous';
  end if;
  insert into public.versus_test_bots (bot_user, host_user, slot) values (v_user, p_host, p_slot)
    on conflict (bot_user) do update set host_user = excluded.host_user, slot = excluded.slot, registered_at = now();
  return jsonb_build_object('bot', v_user, 'host', p_host, 'slot', p_slot);
end;
$$;

-- ── 2. The dev gate + forcing RPCs ──────────────────────────────────────────────────────────────────────────────
-- The match, locked, if the caller may force it: the room's host, every OTHER seat one of the host's own bots. Marks it.
create or replace function public.versus_dev__gate(p_match uuid)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  m public.versus_group_matches;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if not exists (select 1 from public.versus_rooms r where r.id = m.room_id and r.host_user_id = v_user) then
    raise exception 'not_host';
  end if;
  if exists (select 1 from public.versus_group_seats s where s.match_id = m.id and s.user_id <> v_user
      and not exists (select 1 from public.versus_test_bots b where b.bot_user = s.user_id and b.host_user = v_user)) then
    raise exception 'not_a_test_table';
  end if;
  if not m.dev_forced then
    update public.versus_group_matches set dev_forced = true where id = m.id returning * into m;
  end if;
  return m;
end;
$$;

-- Set a living seat's hearts (Duos: its TEAM's hearts, both seats mirror the team as every commit does).
create or replace function public.versus_dev_set_hearts(p_match uuid, p_seat text, p_hearts int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  v_now timestamptz := public.versus_clock();
begin
  m := public.versus_dev__gate(p_match);
  if m.phase = 'complete' then raise exception 'match_over'; end if;
  if p_hearts is null or p_hearts < 1 or p_hearts > 30 then raise exception 'bad_hearts'; end if;
  if not exists (select 1 from public.versus_group_seats where match_id = m.id and seat = p_seat and eliminated_round is null) then
    raise exception 'bad_seat';
  end if;
  if public.versus_duos__is(m) then
    update public.versus_group_teams set hearts = p_hearts where match_id = m.id and team = public.versus_duos__team(p_seat);
    update public.versus_group_seats set hearts = p_hearts where match_id = m.id and team = public.versus_duos__team(p_seat);
  else
    update public.versus_group_seats set hearts = p_hearts where match_id = m.id and seat = p_seat;
  end if;
  update public.versus_group_matches set revision = revision + 1, updated_at = v_now where id = m.id returning * into m;
  return public.versus_group__match_json(m);
end;
$$;

-- End the shop soon: the clock jumps to 5 seconds (or stays, if less is left). Every client locks at 0:00 as usual.
create or replace function public.versus_dev_skip_shop(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_group_matches;
  v_now timestamptz := public.versus_clock();
begin
  m := public.versus_dev__gate(p_match);
  if m.phase <> 'shop' or m.shop_deadline is null then raise exception 'not_shop'; end if;
  if m.paused_at is not null then raise exception 'paused'; end if;
  update public.versus_group_matches set shop_deadline = least(shop_deadline, v_now + interval '5 seconds'),
    revision = revision + 1, updated_at = v_now
    where id = m.id returning * into m;
  return public.versus_group__match_json(m);
end;
$$;

-- ── 3. No XP from a test ────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.versus_dev__no_xp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  if exists (select 1 from public.versus_test_bots b where b.bot_user = new.user_id) then raise exception 'source_not_found'; end if;
  v_id := substring(new.run_id from '^(?:versus|watch:group):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
  if v_id is not null and exists (select 1 from public.versus_group_matches g where g.id = v_id::uuid and g.dev_forced) then
    raise exception 'source_not_found';
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.progression_results') is not null then
    drop trigger if exists versus_dev_no_xp on public.progression_results;
    create trigger versus_dev_no_xp before insert on public.progression_results
      for each row execute function public.versus_dev__no_xp();
  end if;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.versus_dev__gate(uuid) from public, anon, authenticated;
revoke all on function public.versus_dev__no_xp() from public, anon, authenticated;
revoke all on function public.versus_test_bot_register(uuid, int) from public;
revoke all on function public.versus_dev_set_hearts(uuid, text, int) from public;
revoke all on function public.versus_dev_skip_shop(uuid) from public;
grant execute on function public.versus_test_bot_register(uuid, int) to authenticated;
grant execute on function public.versus_dev_set_hearts(uuid, text, int) to authenticated;
grant execute on function public.versus_dev_skip_shop(uuid) to authenticated;
