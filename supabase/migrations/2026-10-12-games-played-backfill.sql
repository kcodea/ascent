-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LEADERBOARD GAMES PLAYED: BACKFILL THE TRUE TOTAL  (2026-10-12, R-LADDER-GAMES-01)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. DATA ONLY (no schema change, nothing for schema.sql). Idempotent:
-- safe to re-run; it only touches rows whose stored numbers differ from the truth.
-- Devlog: docs/devlog/2026-10-12-leaderboard-skins-rank-frames.md.
--
-- WHY (owner 2026-10-12: "is this page broken and only showing 50 games max?"): the client wrote
-- `profiles.games_played` as the length of `fetchRunHistory()`, whose default page is the newest 50 rows, so every
-- player with more than 50 finished games was stored as exactly 50 (and `favorite_hero` was the most-played hero
-- of those 50 only). The client fix counts every `run_history` row from now on, but a player's row only heals the
-- next time THEY finish a game. This one-off sets every profile to the real total right away.
--
-- WHAT
--  - `games_played` = the number of `run_history` rows the account has (the same definition the client uses).
--  - `favorite_hero` = the account's most-played hero over ALL its rows; a tie goes to the hero played most
--    recently (the client's rule). Profiles without any `run_history` row are left alone.

with totals as (
  select user_id, count(*)::int as n
  from public.run_history
  group by user_id
),
per_hero as (
  select user_id, hero_id, count(*) as n, max(created_at) as last_at
  from public.run_history
  where hero_id is not null and hero_id <> ''
  group by user_id, hero_id
),
fav as (
  select distinct on (user_id) user_id, hero_id
  from per_hero
  order by user_id, n desc, last_at desc
)
update public.profiles p
set games_played  = t.n,
    favorite_hero = coalesce(f.hero_id, p.favorite_hero)
from totals t
left join fav f on f.user_id = t.user_id
where p.user_id = t.user_id
  and (p.games_played is distinct from t.n or p.favorite_hero is distinct from coalesce(f.hero_id, p.favorite_hero));

-- Check (optional): the leaderboard's top rows, with the stored total beside the real one. Both columns must match.
-- select p.author, p.games_played, (select count(*) from public.run_history h where h.user_id = p.user_id) as real_total
-- from public.profiles p where p.games_played > 0 order by p.rank_division desc, p.rank_points desc limit 10;
