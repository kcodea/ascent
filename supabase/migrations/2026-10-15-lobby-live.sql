-- LIVE RANKED LOBBY GAMES (owner-approved 2026-10-15): anyone may watch a ranked lobby game while it is being played.
-- ADDITIVE ONLY: three new tables and their RPCs; nothing existing is touched.
--
--   lobby_live_games     the LISTING: one row per ranked lobby game in progress (the player's name, hero, cosmetics,
--                        rank and rating, round, phase, watchers). Public read of these columns only, never run state.
--                        Written only by its own player through `lobby_live_heartbeat` (rank and rating are read from
--                        the player's own `profiles` row here, never from the client). Stale after 60 s of silence
--                        (filtered on read, pruned on write); removed on the game's end by `lobby_live_end`.
--   lobby_live_watchers  who is watching which game (cap 20 per game; a watcher heartbeats; stale after 30 s).
--   lobby_live_frames    the latest spectator KEYFRAME per game (the Versus protocol): deltas ride the Realtime
--                        broadcast channel `lobbylive:<game_id>`; a late joiner or a gap reads this row.
--
-- The player's client publishes nothing while its game has no live watcher (the heartbeat returns the count).
-- Ranked only, always on (owner 2026-10-15): the client registers only a rated lobby run. A later "hide my game"
-- setting would add a column here and a filter in `lobby_live_list`.

create table if not exists public.lobby_live_games (
  game_id         text primary key check (char_length(game_id) between 1 and 80),
  user_id         uuid not null unique references auth.users(id) on delete cascade,
  display_name    text not null check (char_length(display_name) between 1 and 40),
  hero_id         text not null check (char_length(hero_id) between 1 and 60),
  cosmetics       jsonb check (cosmetics is null or octet_length(cosmetics::text) <= 4096),
  division_index  int not null default 0,
  rank_points     int not null default 0,
  rating          int not null default 0,
  round           int not null default 1 check (round between 1 and 200),
  phase           text not null default 'shop' check (phase in ('shop', 'combat', 'end')),
  placement       int check (placement is null or placement between 1 and 8),
  spectators      int not null default 0,
  started_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);
create index if not exists lobby_live_games_rank on public.lobby_live_games (division_index desc, rank_points desc, rating desc);

create table if not exists public.lobby_live_watchers (
  game_id       text not null references public.lobby_live_games(game_id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  last_seen_at  timestamptz not null default now(),
  primary key (game_id, user_id)
);

create table if not exists public.lobby_live_frames (
  game_id     text primary key references public.lobby_live_games(game_id) on delete cascade,
  seq         bigint not null,
  round       int not null,
  frame       jsonb not null check (octet_length(frame::text) <= 393216),
  updated_at  timestamptz not null default now()
);

-- ── Row level security: the listing and the keyframes are readable; every write is an RPC ─────────────────────
alter table public.lobby_live_games enable row level security;
alter table public.lobby_live_watchers enable row level security;
alter table public.lobby_live_frames enable row level security;

drop policy if exists "lobby live read games" on public.lobby_live_games;
create policy "lobby live read games" on public.lobby_live_games for select to anon, authenticated
  using (last_seen_at > now() - interval '60 seconds');
drop policy if exists "lobby live read frames" on public.lobby_live_frames;
create policy "lobby live read frames" on public.lobby_live_frames for select to authenticated using (true);
-- (lobby_live_watchers: no read policy; the count rides the games row.)

grant select on public.lobby_live_games to anon, authenticated;
grant select on public.lobby_live_frames to authenticated;

-- ── RPCs ──────────────────────────────────────────────────────────────────────────────────────────────────────

-- The player registers / refreshes its live game. Returns the number of live watchers (the client publishes only
-- while it is above 0). Rank and rating come from the player's own profile row.
create or replace function public.lobby_live_heartbeat(
  p_game text, p_name text, p_hero text, p_cosmetics jsonb, p_round int, p_phase text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  prof public.profiles;
  v_watchers int;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if p_phase not in ('shop', 'combat', 'end') then raise exception 'bad_phase'; end if;
  -- Housekeeping: games silent for 10 minutes and watchers silent for 2 are gone for good.
  delete from public.lobby_live_games where last_seen_at < now() - interval '10 minutes';
  delete from public.lobby_live_watchers where last_seen_at < now() - interval '2 minutes';
  select * into prof from public.profiles where user_id = v_uid;
  -- One live game per player: a new game id replaces the old row (and its watchers and frames, by cascade).
  delete from public.lobby_live_games where user_id = v_uid and game_id <> p_game;
  select count(*) into v_watchers from public.lobby_live_watchers
    where game_id = p_game and last_seen_at > now() - interval '30 seconds';
  insert into public.lobby_live_games (game_id, user_id, display_name, hero_id, cosmetics, division_index, rank_points, rating, round, phase, spectators)
    values (p_game, v_uid, left(coalesce(nullif(trim(p_name), ''), 'Player'), 40), p_hero, p_cosmetics,
            coalesce(prof.rank_division, 0), coalesce(prof.rank_points, 0), coalesce(prof.rating, 0),
            greatest(1, least(200, p_round)), p_phase, v_watchers)
    on conflict (game_id) do update set
      display_name = excluded.display_name, hero_id = excluded.hero_id, cosmetics = excluded.cosmetics,
      division_index = excluded.division_index, rank_points = excluded.rank_points, rating = excluded.rating,
      round = excluded.round, phase = excluded.phase, spectators = excluded.spectators, last_seen_at = now()
    where public.lobby_live_games.user_id = v_uid;
  return v_watchers;
end;
$$;

-- The game ended (placement shown to its watchers for a short while) or was abandoned (no placement: the row goes).
create or replace function public.lobby_live_end(p_game text, p_placement int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_placement is null then
    delete from public.lobby_live_games where game_id = p_game and user_id = auth.uid();
  else
    update public.lobby_live_games set phase = 'end', placement = greatest(1, least(8, p_placement)), last_seen_at = now()
      where game_id = p_game and user_id = auth.uid();
  end if;
end;
$$;

-- A player's latest keyframe (its own game only; newer sequences only).
create or replace function public.lobby_live_publish_frame(p_game text, p_seq bigint, p_round int, p_frame jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.lobby_live_games where game_id = p_game and user_id = auth.uid()) then
    raise exception 'not_your_game';
  end if;
  if p_frame is null or octet_length(p_frame::text) > 393216 then raise exception 'frame_too_large'; end if;
  insert into public.lobby_live_frames (game_id, seq, round, frame) values (p_game, p_seq, p_round, p_frame)
    on conflict (game_id) do update set seq = excluded.seq, round = excluded.round, frame = excluded.frame, updated_at = now()
    where public.lobby_live_frames.seq < excluded.seq;
end;
$$;

-- A watcher joins (or refreshes) a game: cap 20 live watchers; never the player's own game. Returns the listing row.
create or replace function public.lobby_live_watch(p_game text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  g public.lobby_live_games;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  select * into g from public.lobby_live_games where game_id = p_game and last_seen_at > now() - interval '60 seconds';
  if not found then raise exception 'no_game'; end if;
  if g.user_id = v_uid then raise exception 'own_game'; end if;
  if not exists (select 1 from public.lobby_live_watchers where game_id = p_game and user_id = v_uid)
     and (select count(*) from public.lobby_live_watchers where game_id = p_game and last_seen_at > now() - interval '30 seconds') >= 20 then
    raise exception 'spectators_full';
  end if;
  insert into public.lobby_live_watchers (game_id, user_id) values (p_game, v_uid)
    on conflict (game_id, user_id) do update set last_seen_at = now();
  return to_jsonb(g) - 'user_id';
end;
$$;

create or replace function public.lobby_live_unwatch(p_game text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.lobby_live_watchers where game_id = p_game and user_id = auth.uid();
$$;

revoke all on function public.lobby_live_heartbeat(text, text, text, jsonb, int, text) from public, anon;
revoke all on function public.lobby_live_end(text, int) from public, anon;
revoke all on function public.lobby_live_publish_frame(text, bigint, int, jsonb) from public, anon;
revoke all on function public.lobby_live_watch(text) from public, anon;
revoke all on function public.lobby_live_unwatch(text) from public, anon;
grant execute on function public.lobby_live_heartbeat(text, text, text, jsonb, int, text) to authenticated;
grant execute on function public.lobby_live_end(text, int) to authenticated;
grant execute on function public.lobby_live_publish_frame(text, bigint, int, jsonb) to authenticated;
grant execute on function public.lobby_live_watch(text) to authenticated;
grant execute on function public.lobby_live_unwatch(text) to authenticated;
