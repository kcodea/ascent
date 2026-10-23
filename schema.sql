-- ASCENT board backend — Supabase schema. Paste into the Supabase SQL Editor (New query → Run) once per
-- project. Idempotent (safe to re-run). See docs/board-backend.md for the full setup. The game runs fully
-- offline without this; the backend just adds a live shared opponent pool on top of the committed pool.

create table if not exists public.boards (
  id          uuid primary key default gen_random_uuid(),
  patch       text not null,             -- "<version>+<git sha>", e.g. "0.1.0+82dd78b" — sort/filter/clear key
  wave        int  not null,
  hero_id     text not null,
  power       int  not null,             -- Σ(atk+hp), the strength index
  rating      real,                      -- wave-relative band rating (0..1), if known
  origin      text,                      -- self | friend | synthetic | house
  author      text,                      -- display name on the opponent frame
  tribes      text[],
  captured_at date,
  seed        bigint,
  snapshot    jsonb not null,            -- the full BoardSnapshot, verbatim (this is what's served back)
  created_at  timestamptz default now()
);

-- Serve "current patch by wave/power" fast; also the natural index for patch pruning.
create index if not exists boards_patch_wave_power on public.boards (patch, wave, power);

-- Row Level Security: ON. Friend-scale = allow anon (the publishable key) to read the pool + insert your boards.
-- No update/delete for anon: pruning stale patches is a dev op (dashboard or the SQL below). Hardening later =
-- server-side replay validation (a Worker re-derives boards from the uploaded replay) — see docs/board-pool.md.
alter table public.boards enable row level security;

drop policy if exists "anon read boards"   on public.boards;
drop policy if exists "anon insert boards"  on public.boards;
create policy "anon read boards"   on public.boards for select to anon using (true);
create policy "anon insert boards"  on public.boards for insert to anon with check (true);

-- ── runs — completed-run log for the leaderboard ("Hall of Champions") ─────────────────────────────────────
-- One row per completed VICTORY run (15 wins). `board` holds the final winning warband (shown on hover in the
-- leaderboard). Separate from `boards` (which feeds the opponent pool). The UI inserts only victories today;
-- the `result` column leaves room to log losses later (the tabled dev-tracker).
create table if not exists public.runs (
  id          uuid primary key default gen_random_uuid(),
  patch       text not null,
  hero_id     text not null,
  author      text,
  wave        int  not null,           -- the wave the run won at ("Survived all N waves")
  wins        int,
  result      text not null,           -- 'victory' (future: 'gameover')
  seed        bigint,
  board       jsonb,                   -- the final BoardSnapshot (winning warband) for the hover reveal
  history     text,                    -- per-round result spread: one char per round, 'W'|'L'|'D' (e.g. "LLWLWWW…")
  captured_at date,
  created_at  timestamptz default now()
);
create index if not exists runs_result_created on public.runs (result, created_at desc);

alter table public.runs enable row level security;
drop policy if exists "anon read runs"   on public.runs;
drop policy if exists "anon insert runs"  on public.runs;
create policy "anon read runs"   on public.runs for select to anon using (true);
create policy "anon insert runs"  on public.runs for insert to anon with check (true);

-- ── board_results — per-board fight ledger (win-tracking) ──────────────────────────────────────────────────
-- One row per combat fought AGAINST a served board, reported by the player who fought it (single reporter per
-- fight, since the opponent is a static snapshot). `outcome` is from the SERVED board's perspective — you lose
-- to it → 'win'. `board_id` is the client-stamped `BoardSnapshot.id` (also denormalized onto boards/runs below),
-- so the leaderboard (round-17 slots) and the Career per-round log both aggregate the same ledger. Friend-scale:
-- low write, aggregate-on-read over a bounded fetch. Hardening later = the same server-side replay validation.
-- This is the ONLY object win-tracking needs — a new, isolated table. The board's id travels inside the existing
-- boards/runs `snapshot`/`board` jsonb (BoardSnapshot.id), so NO changes to those tables are required and existing
-- uploads keep working unchanged whether or not you've run this yet.
create table if not exists public.board_results (
  id          bigint generated always as identity primary key,
  board_id    text not null,             -- the served BoardSnapshot.id this result is for
  round       int  not null,             -- the wave the fight happened at (1..17); leaderboard filters to 17
  outcome     text not null,             -- 'win' | 'loss' | 'tie', from the SERVED board's perspective
  patch       text,                      -- build the fight ran under (prune old patches like boards/runs)
  created_at  timestamptz default now()
);
create index if not exists board_results_board_round on public.board_results (board_id, round);

alter table public.board_results enable row level security;
drop policy if exists "anon read board_results"   on public.board_results;
drop policy if exists "anon insert board_results"  on public.board_results;
create policy "anon read board_results"   on public.board_results for select to anon using (true);
create policy "anon insert board_results"  on public.board_results for insert to anon with check (true);

-- ── profiles — the player Leaderboard (top players by rating / "MMR") ──────────────────────────────────────
-- One row per NAMED player, keyed by author (display name), UPSERTED on every finished Ascent run: their skill
-- rating (the "MMR" the leaderboard ranks by), total games played, and favorite hero (most-played, derived from
-- local history). Friend-scale trust model: anon may insert AND update (upsert overwrites your own slot by name).
-- Dormant until this runs — the game + all other uploads work unchanged whether or not you've migrated it.
create table if not exists public.profiles (
  author        text primary key,          -- display name (the leaderboard slot key)
  rating        int  not null default 0,   -- skill rating = the "MMR" the leaderboard ranks by
  games_played  int  not null default 0,   -- total finished Ascent runs (win or loss)
  favorite_hero text,                       -- hero id of the most-played hero
  patch         text,                       -- build of the last run that wrote this row
  updated_at    timestamptz not null default now()
);
create index if not exists profiles_rating on public.profiles (rating desc);

alter table public.profiles enable row level security;
drop policy if exists "anon read profiles"   on public.profiles;
drop policy if exists "anon insert profiles"  on public.profiles;
drop policy if exists "anon update profiles"  on public.profiles;
create policy "anon read profiles"   on public.profiles for select to anon using (true);
create policy "anon insert profiles"  on public.profiles for insert to anon with check (true);
create policy "anon update profiles"  on public.profiles for update to anon using (true) with check (true);

-- ── run_telemetry — the player Balance Report (offer / pick / win / avg) ───────────────────────────────────
-- One row per finished Ascent run: what the player was OFFERED + PICKED (heroes, quests, runes, shop cards) + the
-- outcome, reconstructed from the run's replay at run-end. The in-app Balance Report fetches recent rows and
-- aggregates them client-side. Append-only (insert + read for anon); dormant until this runs. `quest_turns` maps a
-- completed quest id → the wave it finished on (for "avg turns to complete").
create table if not exists public.run_telemetry (
  id             bigint generated always as identity primary key,
  patch          text,
  author         text,
  hero_id        text not null,             -- the hero the player picked
  hero_offer     text[],                    -- the 3 heroes the picker offered
  won            boolean not null default false,
  wins           int not null default 0,    -- scored wins over the course
  offered_quests text[],
  picked_quests  text[],
  quest_turns    jsonb,                      -- { questId: completionWave }
  offered_runes  text[],
  picked_runes   text[],
  offered_cards  text[],                     -- every card seen in the shop this run
  bought_cards   text[],                     -- cards bought from the shop
  discover_offered_cards text[],             -- every card shown as a Discover option this run
  discover_bought_cards  text[],             -- cards picked from a Discover
  tier_by_wave   jsonb,                      -- [wave] = tavern tier reached by that wave (shop-leveling curve)
  created_at     timestamptz not null default now()
);
create index if not exists run_telemetry_created on public.run_telemetry (created_at desc);

-- 2026-07-16: wave-tagged acquisitions — [{ id, wave, src: 'shop'|'discover' }] per buy/pick, powering the
-- per-card buy-turn + win-rate-impact analytics (the Balance Report's CSV export). Idempotent; the client
-- falls back gracefully while this hasn't run yet.
alter table public.run_telemetry add column if not exists buy_events jsonb;

-- 2026-08-02: FINAL LOBBY PLACEMENT (1-8) — powers the Balance Report's placement views ("what do 1st-place
-- boards buy", avg shop curve by placement). Null on every row written before this column existed and on any
-- non-lobby row, so the report FILTERS to non-null rather than guessing. Idempotent; the client sends null
-- until this runs and Postgres ignores the unknown column only if it exists, so run it before expecting data.
alter table public.run_telemetry add column if not exists placement int;

alter table public.run_telemetry enable row level security;
drop policy if exists "anon read run_telemetry"   on public.run_telemetry;
drop policy if exists "anon insert run_telemetry"  on public.run_telemetry;
create policy "anon read run_telemetry"   on public.run_telemetry for select to anon using (true);
create policy "anon insert run_telemetry"  on public.run_telemetry for insert to anon with check (true);

-- ── Maintenance (run by hand in the SQL Editor when needed) ────────────────────────────────────────────────
-- Clear everything EXCEPT the current patch (the "regenerate per balance patch" op):
--   delete from public.boards where patch not like '0.1.0+%';
-- Clear one stale build:
--   delete from public.boards where patch = '0.1.0+oldsha';
-- Remove the connectivity test row created during setup:
--   delete from public.boards where patch = '__conntest__';
-- Migration for an EXISTING project — add the per-round spread column to the leaderboard (safe to re-run;
-- old rows keep a null history and simply show no spread until a fresh victory is logged):
--   alter table public.runs add column if not exists history text;
-- Add the shop-leveling curve column to run_telemetry (safe to re-run; old rows stay null and are skipped by the
-- Balance Report's Shop Curve chart until fresh runs are logged):
--   alter table public.run_telemetry add column if not exists tier_by_wave jsonb;
-- Split the card offer/pick streams by SOURCE — shop vs Discover — for the Balance Report's Minions/Spells tables
-- (safe to re-run; old rows stay null and simply show 0 in the Disc columns until fresh runs are logged). The app
-- degrades gracefully until these exist, so run at your convenience:
--   alter table public.run_telemetry add column if not exists discover_offered_cards text[];
--   alter table public.run_telemetry add column if not exists discover_bought_cards  text[];


-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNTS — C1: real identity, and RLS that actually enforces ownership  (2026-08-03)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- WHAT THIS REPLACES. Identity used to be the display NAME: `profiles.author` was the primary key and the
-- `author` column on every content table was the attribution. Two holes followed from that:
--
--   * `create policy "anon update profiles" ... for update to anon using (true) with check (true);`
--     `using (true)` means ANY client may update ANY row — anyone with devtools could set any player's rating.
--   * Renaming yourself to another player's name inherited their leaderboard slot, on both the read and the
--     write side.
--
-- C1 makes `user_id` (auth.users.id) the identity. `author` survives as a DENORMALIZED display string —
-- nothing joins on it and nothing trusts it.
--
-- PREREQUISITE: enable Anonymous sign-ins (Authentication → Providers → Anonymous). Every install signs in
-- anonymously at boot, so there is no login screen and the board pool keeps growing. C2 upgrades those
-- anonymous users to real accounts IN PLACE, keeping the same `user_id` — so nobody loses their history.
--
-- ORDER OF OPERATIONS: run this whole block, then deploy the matching client. Between the two, an OLD client
-- writes rows with a null `user_id` and the new `to authenticated` policies reject them — uploads pause, play
-- is unaffected. Run it while the tables are near-empty; re-keying is far more expensive once ladder history
-- accumulates.

-- ── 1. Ownership columns on every content table ───────────────────────────────────────────────────────────
alter table public.boards        add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.runs          add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.run_telemetry add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table public.board_results add column if not exists user_id uuid references auth.users(id) on delete set null;

-- ── 2. Profiles re-keyed on the account ───────────────────────────────────────────────────────────────────
-- `author` stops being the primary key and becomes a plain display column (NOT unique — two players may share
-- a display name; C2 adds the `#tag` discriminator that disambiguates them).
alter table public.profiles add column if not exists user_id uuid references auth.users(id) on delete cascade;
-- A pre-C1 project has name-keyed rows with no owner. They cannot be attributed to an account, and leaving
-- them would let a new player inherit a slot by picking the same name — exactly the hole being closed.
delete from public.profiles where user_id is null;
alter table public.profiles drop constraint if exists profiles_pkey;
alter table public.profiles add primary key (user_id);
alter table public.profiles alter column author drop not null;

-- ── 3. RLS: read is public, writes must be YOURS ──────────────────────────────────────────────────────────
-- `to authenticated` + `auth.uid() = user_id` is the whole win: a client may only write rows it owns. The
-- anonymous sign-in above is what keeps every real player `authenticated`.
drop policy if exists "anon insert boards"        on public.boards;
drop policy if exists "anon insert runs"          on public.runs;
drop policy if exists "anon insert board_results" on public.board_results;
drop policy if exists "anon insert run_telemetry" on public.run_telemetry;
drop policy if exists "anon insert profiles"      on public.profiles;
drop policy if exists "anon update profiles"      on public.profiles;

create policy "insert own boards"        on public.boards        for insert to authenticated with check (auth.uid() = user_id);
create policy "insert own runs"          on public.runs          for insert to authenticated with check (auth.uid() = user_id);
create policy "insert own board_results" on public.board_results for insert to authenticated with check (auth.uid() = user_id);
create policy "insert own run_telemetry" on public.run_telemetry for insert to authenticated with check (auth.uid() = user_id);
create policy "insert own profile"       on public.profiles      for insert to authenticated with check (auth.uid() = user_id);

-- Profiles UPDATE is the sharp one. A player may rename themselves and may NOT move their own rating by a
-- single point: the `with check` compares the incoming rating to the row's CURRENT stored value. Rating is
-- therefore write-once from the client (established on the first insert) until C3 moves it behind an Edge
-- Function and the service role becomes its only writer.
--
-- THE CLIENT MUST NOT SEND `rating` ON AN UPDATE. A statement that includes a rating different from the stored
-- one is rejected in FULL — games_played, author and favorite_hero go down with it. `uploadPlayerProfile`
-- originally used one `upsert()`, which sends every column, so as soon as a player's rating moved every later
-- write silently failed and the leaderboard froze at that player's first-run values ("1 game" for a player
-- with four runs — owner report 2026-08-04). It is now an UPDATE of the mutable columns only, with an INSERT
-- fallback for the first write; `playerProfileWrite.test.ts` pins that shape.
create policy "update own profile" on public.profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and rating = (select p.rating from public.profiles p where p.user_id = auth.uid())
  );

-- Reads stay open to everyone, including signed-out clients: the opponent pool, the leaderboard and the
-- Balance Report are all public reads, and a guest must still be able to play against the pool.
drop policy if exists "anon read boards"        on public.boards;
drop policy if exists "anon read runs"          on public.runs;
drop policy if exists "anon read board_results" on public.board_results;
drop policy if exists "anon read run_telemetry" on public.run_telemetry;
drop policy if exists "anon read profiles"      on public.profiles;
create policy "read boards"        on public.boards        for select using (true);
create policy "read runs"          on public.runs          for select using (true);
create policy "read board_results" on public.board_results for select using (true);
create policy "read run_telemetry" on public.run_telemetry for select using (true);
create policy "read profiles"      on public.profiles      for select using (true);

create index if not exists boards_user        on public.boards (user_id);
create index if not exists runs_user          on public.runs (user_id);
create index if not exists run_telemetry_user on public.run_telemetry (user_id);


-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- run_history — the CAREER, server-side  (2026-08-03, owner call: "careers should be from the Supabase layer")
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Career used to be `localStorage['ascent.history']`, which made it device-bound: a different browser, a
-- cleared cache or a new machine meant a blank career. Now every finished run posts one row here and the
-- Career screen reads them back.
--
-- The full `RunHistoryEntry` rides in the `entry` jsonb — the same object the local log stored — so
-- `careerStats()` consumes it unchanged and the shape can grow without a migration. The scalar columns
-- alongside it exist only to sort, filter and index.
--
-- READ IS OWN-ONLY. A career is personal: `using (auth.uid() = user_id)` means nobody can enumerate anyone
-- else's run log. (Public per-player careers, if ever wanted, are a policy widening — not a reshape.)
-- Deliberately NOT back-filled from local history: the owner chose to start fresh (2026-08-03).
create table if not exists public.run_history (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  patch       text,
  hero_id     text,
  wave        int,                        -- round reached
  wins        int,                        -- scored wins
  placement   int,                        -- lobby finish 1-8; null for course/rift runs
  mode        text,
  entry       jsonb not null,             -- the whole RunHistoryEntry
  created_at  timestamptz not null default now()
);
create index if not exists run_history_user on public.run_history (user_id, created_at desc);

alter table public.run_history enable row level security;
drop policy if exists "read own run_history"   on public.run_history;
drop policy if exists "read run_history"       on public.run_history;
drop policy if exists "insert own run_history" on public.run_history;
-- READS ARE PUBLIC (2026-08-04): clicking a player on the leaderboard opens their Career, which means reading
-- run_history rows that are not yours. Writes stay owner-only — a client can still only insert its own runs.
--
-- This is a deliberate privacy decision, not an oversight: a career is a match history the leaderboard already
-- advertises (name, rating, games, favourite hero), and the rows hold nothing beyond how the run went. If that
-- ever stops being true, narrow this policy rather than the client — the client asking politely is not a
-- security boundary.
--
-- ⚠️ UNTIL THIS IS RUN, the feature degrades to an EMPTY career for other players (the select returns no rows
-- rather than erroring). Your own career is unaffected either way.
create policy "read run_history"       on public.run_history for select to authenticated using (true);
create policy "insert own run_history" on public.run_history for insert to authenticated with check (auth.uid() = user_id);

-- ── 2026-08-05: REPLAY PERSISTENCE + derived balance streams ───────────────────────────────────────────────
-- The Codex telemetry spec asked for eight event tables (offers, acquisitions, an economy ledger, upgrades,
-- combat summaries, trigger details, board snapshots). We store ONE thing instead: the replay.
--
-- A run in this game is a pure function of (seed, hero, action log, content) — the reducer and `simulate()`
-- are deterministic — so replaying the log reproduces every one of those streams losslessly (see
-- `packages/sim/src/runDerive.ts`). That buys the property a table-per-event design cannot: a metric nobody
-- thought of yet is a new FUNCTION, computed retroactively over runs already banked, instead of a migration
-- plus a client release plus a fresh collection window. It is also ~1% of the bytes.
--
-- `content_revision` is the load-bearing companion (see `packages/content/src/revisions.ts`): a replay is
-- only faithful against the content it was played on, so a derivation run against a later build must be able
-- to tell that the ground moved. Never pool rows across different content revisions.
--
-- `derived` holds the streams computed AT RUN END (the client already has the log in memory), so the Balance
-- Report can render without replaying hundreds of runs in the browser. It is a CACHE — the replay is the
-- source of truth, and `derived` can be rebuilt from it at any time.
alter table public.run_telemetry add column if not exists replay           jsonb;
alter table public.run_telemetry add column if not exists content_revision text;
alter table public.run_telemetry add column if not exists derived          jsonb;
create index if not exists run_telemetry_content_rev on public.run_telemetry (content_revision);

-- ── 2026-08-06: MMR WRITES — the rating RPC (the leaderboard was frozen) ───────────────────────────────────
-- The C1 policy above makes `rating` write-once from the client: it is set on the profile row's FIRST insert
-- and every later UPDATE must carry it unchanged. The plan was "until C3 moves it behind an Edge Function" —
-- which was never built. Net effect: no path existed that could ever move a stored rating, so the MMR
-- leaderboard froze at first-insert values (owner report 2026-08-06, surfaced by the MMR reset writing every
-- row to 0 — where the policy then pinned them).
--
-- This function is the interim C3: a SECURITY DEFINER RPC that may update exactly ONE thing — the CALLER'S
-- OWN rating. The profiles UPDATE policy stays locked (rating still cannot ride a row update, yours or anyone
-- else's); what the RPC concedes is that the VALUE is client-computed, which was equally true of the first
-- insert the old design trusted. A server-authoritative rating (recomputed from lobby results) remains the
-- real C3 if it is ever wanted — this unblocks the leaderboard without widening any row policy.
create or replace function public.submit_own_rating(new_rating int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set rating = new_rating, updated_at = now() where user_id = auth.uid();
$$;
revoke all on function public.submit_own_rating(int) from public;
grant execute on function public.submit_own_rating(int) to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNTS C2b — handles (`Kevin#4821`) + email + the "unrated" tag  (2026-08-09)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- C2a (client-only) made accounts permanent + portable via a magic link; the email itself lives in
-- `auth.users`, so nothing here was needed for it. C2b adds the two DISPLAY/LEDGER pieces that DO touch the
-- schema:
--
--   * a DISCRIMINATOR — the `#4821` half of a handle. `author` (display name) is mutable and NOT unique, so
--     two players may both be "Kevin"; the discriminator is what tells them apart on the leaderboard. Assigned
--     client-side with retry-on-conflict against the unique index below (server-side assignment can move into
--     the C3 Edge Function later without a reshape). A friend-scale collision is near-zero; the retry makes it
--     correct regardless.
--   * `email` DENORMALISED onto the profile — a convenience for rendering "signed in as …" and, more
--     importantly, the natural JOIN KEY for an eventual cross-platform (Steam, C5) account merge. `auth.users`
--     stays the source of truth; this is a copy the client keeps in step.
--   * an `unrated` flag on the content tables — set on rows a client uploads while it had NO live authenticated
--     session (the C2 offline queue flushing later). Today its only ENFORCED effect is that a queued run does
--     not submit ladder rating (the client skips `submit_own_rating` for it); on the other tables it is a
--     forward-looking tag for the C3 rating recompute / replay audit to honour. Reads ignore it for now.
alter table public.profiles add column if not exists discriminator text;
alter table public.profiles add column if not exists email        text;

-- A (display name, tag) pair is unique, case-insensitively — so "Kevin#4821" identifies exactly one account.
-- Partial: legacy rows with no discriminator yet (pre-C2b, or an anonymous player who never named themselves)
-- don't collide with each other on a null tag.
create unique index if not exists profiles_handle
  on public.profiles (lower(author), discriminator)
  where author is not null and discriminator is not null;

-- The offline-queue tag. Default false, so every existing row and every online upload is rated as before.
alter table public.boards        add column if not exists unrated boolean not null default false;
alter table public.runs          add column if not exists unrated boolean not null default false;
alter table public.run_telemetry add column if not exists unrated boolean not null default false;
alter table public.board_results add column if not exists unrated boolean not null default false;


-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNTS C3 — server-authoritative rating  (2026-08-09)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- THE HOLE C3 CLOSES. Until now the CLIENT computed its own rating and pushed the absolute value through the
-- `submit_own_rating` RPC — which trusts whatever number it is handed. Anyone with devtools could set any
-- rating. That was tolerable at friend-scale; it is the real gate before the ladder is shown to strangers.
--
-- THE FIX. The `submit-rating` EDGE FUNCTION (supabase/functions/submit-rating) becomes the ONLY writer of
-- `profiles.rating`. A client sends `{ runId, placement }` — NOT a rating. The function, running as the service
-- role, reads the player's CURRENT stored rating and computes the delta itself from the same
-- `LOBBY_PLACEMENT_DELTAS` table the client uses (parity is pinned by `lobbyRatingParity.test.ts`), so the
-- number is server-derived and unforgeable. Note the server needs ONLY `rating`: the Line + high-water marks
-- are a LOCAL display concept re-derived from the adopted rating, so there are no line columns here to keep.
--
-- DEDUPE + RATE LIMIT. One rating per (player, run): the function inserts a `rated_runs` ledger row first and
-- treats a unique-violation as "already rated" (idempotent — a retried submit can't double-count). The same
-- ledger backs a simple per-player rate limit (N ratings per window).
--
-- ORDER OF OPERATIONS (owner, done together): 1) `supabase functions deploy submit-rating`; 2) run THIS block.
-- The revoke below removes the client's legacy door, so run it only AFTER the function is deployed and
-- verified — until both are done the client keeps using the `submit_own_rating` fallback and nothing breaks.

-- The dedupe / rate-limit ledger. RLS on with NO policies → only the service role (the Edge Function) can
-- touch it; a client can neither read another player's rating history nor forge a ledger row.
create table if not exists public.rated_runs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  run_id     text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, run_id)
);
alter table public.rated_runs enable row level security;
create index if not exists rated_runs_user_time on public.rated_runs (user_id, created_at desc);

-- Close the client's rating door. After this, ONLY the service-role Edge Function can move a rating — the
-- write-once profiles UPDATE policy already blocks a row update, and this removes the RPC that was the sole
-- sanctioned client path. RUN ONLY ONCE THE FUNCTION IS DEPLOYED (see order of operations above).
revoke execute on function public.submit_own_rating(int) from authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- BUG REPORTS — the in-game Ctrl+B reporter's intake (2026-08-27). One row per submitted report: the player's
-- description plus the deterministic incident capsule (serialized run, action history, combat events) in
-- `report`. Written ONLY through the `submit-bug-report` Edge Function (service role); clients hold no insert
-- policy, so the function's validation/rate-limits can't be bypassed. Players may read their own reports;
-- status/severity/priority/triage are developer-only writes (service role — the in-game Bug Board's dev-server
-- plugin and the bugs:* CLI). Idempotent; paste into the SQL Editor and Run.
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  client_report_id text not null,
  created_at timestamptz not null default now(),
  player_created_at timestamptz not null,
  status text not null default 'new'
    check (status in ('new', 'triaged', 'reproduced', 'needs_info', 'fixed', 'closed', 'duplicate')),
  severity text null
    check (severity is null or severity in ('critical', 'high', 'medium', 'low')),
  -- Owner Bug Board ordering: lower = fix first; null = unranked. Set from the dev Bug Board / bugs:* CLI.
  priority int null,
  issue_type text not null,
  description text not null,
  patch text not null,
  content_revision text not null,
  mode text not null,
  set_id text not null,
  hero_id text not null,
  seed bigint not null,
  wave int not null,
  phase text not null,
  report jsonb not null,
  fingerprint text null,
  duplicate_of uuid references public.bug_reports(id),
  triage jsonb null,
  resolution jsonb null,
  unique(user_id, client_report_id)
);

create index if not exists bug_reports_status_created
  on public.bug_reports(status, created_at desc);

create index if not exists bug_reports_patch
  on public.bug_reports(patch, created_at desc);

create index if not exists bug_reports_fingerprint
  on public.bug_reports(fingerprint) where fingerprint is not null;

alter table public.bug_reports enable row level security;

-- No INSERT policy on purpose: submission goes through the Edge Function (service role bypasses RLS).
drop policy if exists "read own bug reports" on public.bug_reports;
create policy "read own bug reports"
  on public.bug_reports for select to authenticated
  using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────────────────────────────────
-- PERF RUNS (owner ask 2026-08-29: "set it up so that the perf hud runs automatically in dev clients and
-- uploads to supabase and drops it into a performance viewer in game for us")
--
-- A recorded frame-health timeline from a DEV client. Both devs read every row — that is the whole point:
-- "for us" means Kevin can look at a spike Mike recorded on different hardware, which is the one thing a
-- local-only tool could never do.
--
-- ⚠️ UNTIL THIS IS RUN the feature degrades quietly: recording, the HUD and the LOCAL analytics screen all
-- work exactly as they do today, and the Cloud tab shows "not set up yet" instead of erroring. Nothing
-- breaks; the cross-machine half simply is not there.
--
-- NO EDGE FUNCTION, unlike `bug_reports`. A perf log is not user-submitted content that needs server-side
-- validation or rate limiting — it is our own telemetry from our own dev clients, so a plain
-- insert-own/read-all policy pair is the right size. One less thing to deploy.
--
-- SIZE. `buckets` is one row per recorded second, ~200 bytes each, capped at 2400 by the client's ring
-- buffer — so a worst-case row is around half a megabyte of jsonb. The client also refuses to upload a
-- timeline that would exceed PERF_MAX_UPLOAD_BYTES, so this cannot become an accidental blob store.
create table if not exists public.perf_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Who recorded it, denormalised so the viewer's list needs no join to `profiles`.
  author text not null default '',
  -- The build. This is what makes a comparison mean something: "worse since which change?"
  patch text not null,
  -- Free-text label typed at save time ("after the sheen change").
  note text null,
  -- Context, denormalised for the list view so picking a run does not need the timeline loaded.
  mode text null,
  hero_id text null,
  seconds int not null,
  hz int not null,
  worst_frame real not null,
  jank_frames int not null,
  fps_med real not null,
  -- The timeline itself, and the diagnosis summary computed client-side at upload.
  buckets jsonb not null,
  summary jsonb null
);

-- The list view is "newest first, optionally filtered to a build".
create index if not exists perf_runs_created on public.perf_runs(created_at desc);
create index if not exists perf_runs_patch   on public.perf_runs(patch, created_at desc);

alter table public.perf_runs enable row level security;

drop policy if exists "read perf_runs"       on public.perf_runs;
drop policy if exists "insert own perf_runs" on public.perf_runs;
drop policy if exists "delete own perf_runs" on public.perf_runs;

-- READ ALL: the point of uploading is that the other dev can see it.
create policy "read perf_runs"       on public.perf_runs for select to authenticated using (true);
-- INSERT OWN: you can only upload as yourself.
create policy "insert own perf_runs" on public.perf_runs for insert to authenticated with check (auth.uid() = user_id);
-- DELETE OWN: so a noisy recording can be tidied from inside the game, without a console trip.
create policy "delete own perf_runs" on public.perf_runs for delete to authenticated using (auth.uid() = user_id);


-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- MEDAL RANK — season 3  (2026-09-20)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run) EXCEPT the clearly-marked season
-- reset at the very bottom, which is commented out and run ONCE, deliberately, by the owner. The same block
-- is appended to schema.sql (the cumulative paste file) — keep the two identical.
-- Owner runbook: docs/rank-season-runbook.md.
--
-- WHAT THIS IS. The numeric ladder (`profiles.rating` moved by a ±100 placement table) becomes a MEDAL ladder:
-- six medals × three divisions (index 0 = Bronze I … 17 = Ascendant III), 100 points each, promotion GAMES
-- at 100 (top-4 to move a division, 1st to move a medal; a won gate lands at 10/100 in the next division —
-- owner 2026-09-21, was 0/100), NO instant demotions (owner 2026-09-21, widening the 2026-09-20 medal-floor
-- gate to every division): a LOSS that hits 0 in any division above Bronze I clamps there and ARMS a
-- DEMOTION GAME (the STORED `rank_demotion_ready` flag; a bottom-4 in that game then drops ONE division to
-- 100 + award — across a medal boundary, to the previous medal's III — and a top-4 escapes and disarms),
-- Bronze I floored, Ascendant III uncapped. The rules live in THREE places that must agree: `settle_rank` below (the WRITER — the only thing
-- that moves a rank), `supabase/functions/_shared/lobbyRating.ts` (the Edge Function's runtime parity check)
-- and `packages/sim/src/rank.ts` (the client, CI-parity-tested against the shared TS file). Change all three
-- together and bump the rules version in all three when an old client would mis-show or refuse the result
-- (the client never resolves locally; the 2026-09-21 landing change and the same day's demotion widening both
-- shipped without a bump — re-run the `profiles_rank_demotion_ready_where` constraint statements AND the
-- `create or replace function public.settle_rank` block below, then redeploy `submit-rating`, to apply them).
--
-- WHY A DATABASE FUNCTION. The old C3 function inserted the dedupe ledger row, THEN updated the profile in a
-- second statement: a failure between the two consumed the dedupe key without awarding points, two
-- concurrent submissions could read the same profile and overwrite each other, and a duplicate returned
-- today's profile rather than the original game's before/after. `settle_rank` does the whole settlement in
-- ONE transaction under a row lock: lock profile → ledger check (a duplicate returns the ORIGINAL result) →
-- rate limit (raises → nothing committed) → resolve → write profile + revision + immutable result → commit.
--
-- ── 1. profiles: the rank columns ─────────────────────────────────────────────────────────────────────────
-- `rating` STAYS and becomes the derived reporting scalar `100 × rank_division + rank_points`, maintained by
-- `settle_rank`, so every numeric surface (leaderboard order, the title chip) keeps working until it is
-- medal-aware. `rank_season = 0` means "never ranked under medals"; `settle_rank` treats any season other
-- than the live one as a fresh Bronze I start on that account's first settlement.
alter table public.profiles add column if not exists rank_season           int not null default 0;
alter table public.profiles add column if not exists rank_rules_version    int not null default 1;
alter table public.profiles add column if not exists rank_division         int not null default 0;
alter table public.profiles add column if not exists rank_points           int not null default 0;
alter table public.profiles add column if not exists rank_highest_division int not null default 0;
alter table public.profiles add column if not exists rank_highest_points   int not null default 0;
-- The demotion gate, STORED (owner 2026-09-20, widened 2026-09-21): armed only by a loss that lands on 0 in
-- any division above Bronze I; cleared by any non-negative result; never set by a promotion landing.
alter table public.profiles add column if not exists rank_demotion_ready   boolean not null default false;
-- Monotonic per account (+1 per settlement, +1 on a reset). The client adopts a server profile only when its
-- revision is not older than the mirror's — so a late answer never rolls a newer profile back. HAND-EDITS TO
-- A RANK MUST BUMP THIS TOO, or the edited client keeps its mirror.
alter table public.profiles add column if not exists rank_revision         int not null default 0;
-- A snapshot of the season-2 numeric rating, taken by the season reset (bottom) before `rating` is zeroed.
alter table public.profiles add column if not exists season2_rating        int;

alter table public.profiles drop constraint if exists profiles_rank_division_range;
alter table public.profiles add  constraint profiles_rank_division_range
  check (rank_division between 0 and 17);
alter table public.profiles drop constraint if exists profiles_rank_points_range;
alter table public.profiles add  constraint profiles_rank_points_range
  check (rank_points >= 0 and (rank_division = 17 or rank_points <= 100));
-- (2026-09-21: the flag may be armed at 0 in ANY division above Bronze I — the medal-floor `% 3` term is gone.
--  Re-running these two statements is how an existing database picks the widened rule up.)
alter table public.profiles drop constraint if exists profiles_rank_demotion_ready_where;
alter table public.profiles add  constraint profiles_rank_demotion_ready_where
  check (not rank_demotion_ready or (rank_points = 0 and rank_division > 0));
alter table public.profiles drop constraint if exists profiles_rank_highest_range;
alter table public.profiles add  constraint profiles_rank_highest_range
  check (rank_highest_division between 0 and 17 and rank_highest_points >= 0
         and (rank_highest_division = 17 or rank_highest_points <= 100));
-- Leaderboard order: division first, then points (the scalar ties Gold II 100 with Gold III 0 — the promoted
-- player ranks above the one still waiting at the gate).
create index if not exists profiles_rank on public.profiles (rank_division desc, rank_points desc);

-- ── 2. rank_results: the immutable settlement ledger ──────────────────────────────────────────────────────
-- One row per (player, run): the dedupe key AND the durable result the post-game screen animates. Written
-- ONLY by `settle_rank`. A player may read their own rows (the Career can join them by run_id / seed);
-- nobody can insert, update or delete through the API.
create table if not exists public.rank_results (
  user_id                uuid not null references auth.users(id) on delete cascade,
  run_id                 text not null,
  seed                   bigint,
  season                 int not null,
  rules_version          int not null,
  placement              int not null check (placement between 1 and 8),
  revision_before        int not null,
  revision_after         int not null,
  division_before        int not null,
  points_before          int not null,
  demotion_ready_before  boolean not null default false,
  division_after         int not null,
  points_after           int not null,
  demotion_ready_after   boolean not null default false,
  highest_division_after int not null,
  highest_points_after   int not null,
  base_delta             int not null,
  applied_delta          int not null,
  capped_points          int not null,
  was_promotion_game     boolean not null,
  promotion_kind         text check (promotion_kind is null or promotion_kind in ('division', 'medal')),
  required_finish        int,
  promotion_unlocked     boolean not null,
  promoted               boolean not null,
  was_demotion_game      boolean not null default false,
  demotion_unlocked      boolean not null default false,
  demoted                boolean not null,
  created_at             timestamptz not null default now(),
  primary key (user_id, run_id)
);
alter table public.rank_results enable row level security;
drop policy if exists "read own rank_results" on public.rank_results;
create policy "read own rank_results" on public.rank_results for select to authenticated using (auth.uid() = user_id);
create index if not exists rank_results_user_time on public.rank_results (user_id, created_at desc);
-- (idempotent for a table created before the demotion gate landed the same day)
alter table public.rank_results add column if not exists was_demotion_game boolean not null default false;
alter table public.rank_results add column if not exists demotion_unlocked boolean not null default false;
alter table public.rank_results add column if not exists demotion_ready_before boolean not null default false;
alter table public.rank_results add column if not exists demotion_ready_after  boolean not null default false;

-- ── 3. RLS: a client can never write a rank field ─────────────────────────────────────────────────────────
-- INSERT: a brand-new profile row is a PLACEHOLDER only — rating 0, Bronze I, revision 0, no season. The
-- client (`uploadPlayerProfile`) inserts exactly that; anything else is refused.
drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles for insert to authenticated
  with check (
    auth.uid() = user_id
    and rating = 0
    and rank_season = 0 and rank_division = 0 and rank_points = 0 and rank_demotion_ready = false
    and rank_highest_division = 0 and rank_highest_points = 0 and rank_revision = 0
    and season2_rating is null
  );
-- UPDATE: the display columns (author, games_played, favorite_hero, patch, email, discriminator) may change;
-- `rating` and every `rank_*` column must arrive EQUAL to the stored value. (The C1 policy did this for
-- `rating` alone — a client update must not carry these columns at all; `uploadPlayerProfile` sends only the
-- display columns, pinned by playerProfileWrite.test.ts.)
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and rating                = (select p.rating                from public.profiles p where p.user_id = auth.uid())
    and rank_season           = (select p.rank_season           from public.profiles p where p.user_id = auth.uid())
    and rank_rules_version    = (select p.rank_rules_version    from public.profiles p where p.user_id = auth.uid())
    and rank_division         = (select p.rank_division         from public.profiles p where p.user_id = auth.uid())
    and rank_points           = (select p.rank_points           from public.profiles p where p.user_id = auth.uid())
    and rank_demotion_ready   = (select p.rank_demotion_ready   from public.profiles p where p.user_id = auth.uid())
    and rank_highest_division = (select p.rank_highest_division from public.profiles p where p.user_id = auth.uid())
    and rank_highest_points   = (select p.rank_highest_points   from public.profiles p where p.user_id = auth.uid())
    and rank_revision         = (select p.rank_revision         from public.profiles p where p.user_id = auth.uid())
    and season2_rating is not distinct from (select p.season2_rating from public.profiles p where p.user_id = auth.uid())
  );

-- The legacy numeric door is CLOSED for good: C3 revoked it from clients; the medal ladder drops it so no
-- deployment can ever let the old client-computed number write the new ladder.
drop function if exists public.submit_own_rating(int);

-- ── 4. JSON shapes — MUST match `RankResult` / `RankedProfile` in packages/sim/src/rank.ts key-for-key ────
create or replace function public.rank_result_json(r public.rank_results)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'runId', r.run_id, 'seasonId', r.season, 'rulesVersion', r.rules_version,
    'revisionBefore', r.revision_before, 'revisionAfter', r.revision_after,
    'placement', r.placement,
    'before', jsonb_build_object('divisionIndex', r.division_before, 'points', r.points_before, 'demotionReady', r.demotion_ready_before),
    'after',  jsonb_build_object('divisionIndex', r.division_after,  'points', r.points_after,  'demotionReady', r.demotion_ready_after),
    'baseDelta', r.base_delta, 'appliedDelta', r.applied_delta, 'cappedPoints', r.capped_points,
    'wasPromotionGame', r.was_promotion_game, 'promotionKind', r.promotion_kind, 'requiredFinish', r.required_finish,
    'promotionUnlocked', r.promotion_unlocked, 'promoted', r.promoted,
    'wasDemotionGame', r.was_demotion_game, 'demotionUnlocked', r.demotion_unlocked, 'demoted', r.demoted,
    'highestAfter', jsonb_build_object('divisionIndex', r.highest_division_after, 'points', r.highest_points_after)
  );
$$;

create or replace function public.rank_profile_json(p public.profiles)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'seasonId', p.rank_season, 'rulesVersion', p.rank_rules_version, 'revision', p.rank_revision,
    'position', jsonb_build_object('divisionIndex', p.rank_division, 'points', p.rank_points, 'demotionReady', p.rank_demotion_ready),
    'highest',  jsonb_build_object('divisionIndex', p.rank_highest_division, 'points', p.rank_highest_points)
  );
$$;

-- ── 5. settle_rank — THE writer. Service role only. ───────────────────────────────────────────────────────
-- SUPERSEDED (2026-09-22): the FIGHT LEDGER block at the bottom of this file drops this six-argument overload
-- and redefines settle_rank with `p_seat_keys` (the lobby-strength bonus). Running this file top to bottom
-- lands on that definition; this one is kept so the file stays a faithful history of what was applied.
-- Order (blueprint §6): validate → ensure + LOCK the profile row → ledger check under the lock (duplicate →
-- the ORIGINAL result, no second award) → rate limit (raise → nothing committed) → resolve from the locked
-- profile → write profile + revision + immutable result → (best-effort) stamp the career row → return both
-- the result and the current authoritative profile. Any `raise` rolls everything back.
--
-- The resolver branches are the same as `resolveRank` in packages/sim/src/rank.ts, in the same order:
--   at a gate (points = 100 below the top): placement ≤ required (4 for a division gate, 1 for a medal gate)
--     → promote ONE division to c_promo_landing/100 (10 — owner 2026-09-21, was 0); a positive award short of
--     a MEDAL gate (2nd–4th) HOLDS at 100, still promotion-ready; a negative award applies normally from 100.
--   at an ARMED demotion gate (the STORED rank_demotion_ready flag): a bottom-4 (5th–8th) demotes ONE
--     division to the previous division at 100 + award (across a medal boundary: the previous medal's III);
--     a top-4 escapes, applies its positive award normally from 0, and disarms.
--   otherwise add the award: a LOSS landing on 0 (by clamp or exact subtraction) in ANY division above
--     Bronze I CLAMPS at 0 and ARMS the gate — there are NO instant demotions (owner 2026-09-21; until then
--     only a medal's lowest division clamped and the rest demoted to 100 + result); Bronze I floors at 0
--     with no gate; Ascendant III is uncapped upward; elsewhere ≥ 100 → exactly 100, promotion unlocked
--     (overflow discarded). A promotion landing is never armed; any non-negative result disarms.
--   highest = max(highest, after) by division then points; revision + 1; rating = the scalar.
create or replace function public.settle_rank(
  p_user uuid, p_run_id text, p_placement int, p_season int, p_rules_version int, p_seed bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of RANK_RULES / _shared/lobbyRating.ts — change all three together)
  c_season          constant int := 3;
  c_rules           constant int := 1;
  c_cap             constant int := 100;
  c_top             constant int := 17;
  c_per_medal       constant int := 3;
  c_awards          constant int[] := array[40, 28, 16, 6, -6, -16, -28, -40];
  c_division_finish constant int := 4;
  c_medal_finish    constant int := 1;
  c_demotion_finish constant int := 4;   -- worst placement that still ESCAPES a demotion game
  c_promo_landing   constant int := 10;  -- points a WON promotion lands on in the next division (owner 2026-09-21; was 0)
  c_rate_max        constant int := 20;
  c_rate_window     constant interval := interval '10 minutes';

  prof       public.profiles%rowtype;
  prev       public.rank_results%rowtype;
  v_base     int;
  v_pts      int;
  d0 int; p0 int; d1 int; p1 int; hd int; hp int;
  r0 boolean; r1 boolean := false;
  v_gate     boolean := false;
  v_kind     text := null;
  v_required int := null;
  v_unlocked boolean := false;
  v_promoted boolean := false;
  v_dgate    boolean := false;
  v_dunlock  boolean := false;
  v_demoted  boolean := false;
  v_applied  int;
  v_capped   int;
  v_recent   int;
begin
  -- 1. validate
  if p_placement is null or p_placement < 1 or p_placement > 8 then raise exception 'bad_placement'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_season is distinct from c_season then raise exception 'unsupported_season'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. ensure the row exists, then LOCK it (every entry point takes this lock first)
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.rank_results where user_id = p_user and run_id = p_run_id;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.rank_result_json(prev), 'profile', public.rank_profile_json(prof));
  end if;

  -- 4. rate limit — a raise rolls the transaction back, so a refused request leaves no ledger row
  select count(*) into v_recent from public.rank_results
    where user_id = p_user and created_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 5. resolve from the LOCKED profile. A profile from another season (or never ranked) starts fresh.
  if prof.rank_season is distinct from c_season then
    d0 := 0; p0 := 0; r0 := false; hd := 0; hp := 0;
  else
    d0 := prof.rank_division; p0 := prof.rank_points; r0 := coalesce(prof.rank_demotion_ready, false);
    hd := prof.rank_highest_division; hp := prof.rank_highest_points;
  end if;

  v_base := c_awards[p_placement];
  d1 := d0; p1 := p0;

  if d0 < c_top and p0 = c_cap then
    -- promotion game
    v_gate := true;
    if (d0 % c_per_medal) = c_per_medal - 1 then v_kind := 'medal'; v_required := c_medal_finish;
    else v_kind := 'division'; v_required := c_division_finish; end if;
    if p_placement <= v_required then
      v_promoted := true; d1 := d0 + 1; p1 := c_promo_landing; -- a won gate starts the next division at the landing (10)
    elsif v_base >= 0 then
      d1 := d0; p1 := p0;                                     -- medal gate, 2nd–4th: hold at 100
    else
      v_pts := p0 + v_base;                                   -- the normal negative award from 100 (≥ 60 with this table)
      if v_pts <= 0 and d0 > 0 then d1 := d0; p1 := 0; r1 := true; -- (unreachable with this table) a loss to 0 → ARM
      elsif v_pts < 0 then d1 := 0; p1 := 0;                  -- (unreachable with this table) Bronze I floor
      else d1 := d0; p1 := v_pts;
      end if;
    end if;
  elsif r0 then
    -- demotion game (the STORED flag — armed by an earlier loss that clamped at 0 in this division)
    v_dgate := true; v_required := c_demotion_finish;
    if p_placement <= v_required then
      d1 := d0; p1 := p0 + v_base;                            -- escape: the positive award from 0 (< 100 with this table)
      if d0 < c_top and p1 >= c_cap then v_unlocked := true; p1 := c_cap; end if;
    else
      v_demoted := true; d1 := d0 - 1; p1 := c_cap + v_base;  -- ONE division down at 100 + award (across a medal boundary: the previous medal's III)
    end if;
  else
    v_pts := p0 + v_base;
    if v_base < 0 and v_pts <= 0 and d0 > 0 then
      d1 := d0; p1 := 0; r1 := true;                          -- a LOSS lands on 0 in any division above Bronze I → ARMED (no instant demotion)
    elsif v_pts < 0 then
      d1 := 0; p1 := 0;                                       -- Bronze I floor, no gate (the only division that reaches here)
    elsif d0 = c_top then
      d1 := c_top; p1 := v_pts;                               -- Ascendant III: uncapped
    elsif v_pts >= c_cap then
      v_unlocked := true; d1 := d0; p1 := c_cap;              -- gate reached; overflow discarded
    else
      d1 := d0; p1 := v_pts;
    end if;
  end if;
  v_dunlock := r1;                                            -- this game ARMED the gate

  v_applied := (c_cap * d1 + p1) - (c_cap * d0 + p0);
  if v_promoted then v_capped := 0; else v_capped := greatest(0, abs(v_base) - abs(v_applied)); end if;
  if d1 > hd or (d1 = hd and p1 > hp) then hd := d1; hp := p1; end if;

  -- 6. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    rank_season = c_season, rank_rules_version = c_rules,
    rank_division = d1, rank_points = p1, rank_demotion_ready = r1,
    rank_highest_division = hd, rank_highest_points = hp,
    rank_revision = prof.rank_revision + 1,
    rating = c_cap * d1 + p1,
    updated_at = now()
  where user_id = p_user;

  insert into public.rank_results (
    user_id, run_id, seed, season, rules_version, placement,
    revision_before, revision_after,
    division_before, points_before, demotion_ready_before, division_after, points_after, demotion_ready_after,
    highest_division_after, highest_points_after,
    base_delta, applied_delta, capped_points,
    was_promotion_game, promotion_kind, required_finish, promotion_unlocked, promoted,
    was_demotion_game, demotion_unlocked, demoted
  ) values (
    p_user, p_run_id, p_seed, c_season, c_rules, p_placement,
    prof.rank_revision, prof.rank_revision + 1,
    d0, p0, r0, d1, p1, r1,
    hd, hp,
    v_base, v_applied, v_capped,
    v_gate, v_kind, v_required, v_unlocked, v_promoted,
    v_dgate, v_dunlock, v_demoted
  ) returning * into prev;

  -- 7. best-effort: stamp the confirmed result onto the matching career row (it usually exists by now — the
  --    history insert fires at the same moment as this settlement; a miss is harmless, the ledger is the truth)
  if p_seed is not null then
    update public.run_history
      set entry = entry || jsonb_build_object(
        'rank', public.rank_result_json(prev),
        'ratingBefore', c_cap * d0 + p0, 'ratingAfter', c_cap * d1 + p1, 'ratingDelta', v_applied
      )
      where user_id = p_user and mode = 'lobby' and placement = p_placement and entry->>'seed' = p_seed::text
        and not (entry ? 'rank');
  end if;

  select * into prof from public.profiles where user_id = p_user;
  return jsonb_build_object('status', 'ok', 'result', public.rank_result_json(prev), 'profile', public.rank_profile_json(prof));
end;
$$;

-- Service role ONLY. Functions are executable by PUBLIC by default — revoke that, then grant the one caller.
revoke all on function public.settle_rank(uuid, text, int, int, int, bigint) from public, anon, authenticated;
grant execute on function public.settle_rank(uuid, text, int, int, int, bigint) to service_role;
revoke all on function public.rank_result_json(public.rank_results) from public, anon, authenticated;
grant execute on function public.rank_result_json(public.rank_results) to service_role;
revoke all on function public.rank_profile_json(public.profiles) from public, anon, authenticated;
grant execute on function public.rank_profile_json(public.profiles) to service_role;

-- ── 6. SEASON RESET — run ONCE, deliberately (owner decision 2026-09-20: everyone starts Bronze I 0/100) ──
-- Commented out so a re-run of this file can never reset the ladder by accident. `season2_rating` keeps the
-- old number; `rank_revision + 1` makes every client adopt the reset on its next boot (a revision that went
-- DOWN would be ignored as stale). Old `rated_runs` rows and all `run_history` stay untouched.
--
-- update public.profiles set season2_rating = coalesce(season2_rating, rating);
-- update public.profiles set
--   rank_season = 3, rank_rules_version = 1,
--   rank_division = 0, rank_points = 0, rank_demotion_ready = false,
--   rank_highest_division = 0, rank_highest_points = 0,
--   rank_revision = rank_revision + 1,
--   rating = 0, updated_at = now();

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- SEAT LEDGER — the Hall of Champions record  (2026-09-22)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). The same block is appended to
-- schema.sql (the cumulative paste file) — keep the two identical. Owner runbook: the devlog
-- docs/devlog/2026-09-22-hall-of-champions-table-wins.md.
--
-- WHAT THIS IS. The Hall of Champions now ranks WINNING RUNS by the games they have won against other players
-- (owner 2026-09-22: "track the run that beat the player when they were knocked out … if i play a board that
-- wins on turn 14 and it knocks a player out on turn 9, that board should probably get a win. subsequently, if
-- that same board is served to a player and it comes in 3rd against the player on turn 13, my board should get
-- a loss recorded"). A finished run is served into other players' lobbies as a RECORDED SEAT (`run_key` =
-- author|heroId|seed, the key the client groups the opponent pool by). This table is one row per recorded seat
-- with a RESULT against the player it was served to: 'win' when it knocked that player out, 'loss' when it was
-- knocked out while that player still stood. A seat still standing when the player fell decided nothing and
-- writes no row. The Hall sums a run's own victory (its row in `runs`) with its wins here.
--
-- The client writes it at the end of every REAL lobby (never practice, the tutorial or a Scene Builder run),
-- from what the player's own run witnessed — nothing is simulated past the player's knockout. The unique key
-- makes the write idempotent: a run restored and finished twice cannot count a table twice (the client upserts
-- with ignoreDuplicates). Reads are public, like every other ledger; a player may only insert rows they own.
-- Additive and isolated — nothing else in the schema changes, and the game keeps working (every Hall run shows
-- 1–0) until this has been run.
-- ⚠ DROPPED 2026-09-23: this block is retired by the "player key; seat ledger dropped" block at the tail of this
-- file (supabase/migrations/2026-09-23-player-key-drop-seat-results.sql). Kept verbatim so the paste file stays
-- cumulative; the drop below wins when the whole file is run.
create table if not exists public.seat_results (
  id                bigint generated always as identity primary key,
  user_id           uuid references auth.users(id) on delete set null,
  lobby_seed        bigint  not null,           -- the lobby (= the reporting run's seed); with run_key, the row's identity
  run_key           text    not null,           -- author|heroId|seed of the recorded run that drove the seat
  outcome           text    not null,           -- 'win' (knocked the reporting player out) | 'loss' (knocked out while they stood)
  round             int     not null,           -- the round it happened
  player_placement  int     not null,           -- where the reporting player finished (1-8), for context
  seats             int     not null default 8, -- seats at the table
  mode              text    not null default 'lobby',
  patch             text,                       -- build the lobby ran under
  created_at        timestamptz default now(),
  constraint seat_results_outcome check (outcome in ('win', 'loss')),
  constraint seat_results_one_per_table unique (lobby_seed, run_key)
);
create index if not exists seat_results_run_key on public.seat_results (run_key);

alter table public.seat_results enable row level security;
drop policy if exists "read seat_results"       on public.seat_results;
drop policy if exists "insert own seat_results" on public.seat_results;
create policy "read seat_results"       on public.seat_results for select using (true);
create policy "insert own seat_results" on public.seat_results for insert to authenticated with check (auth.uid() = user_id);

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- BALANCE REPORT — the set + source stamps  (2026-09-22)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). The same block is appended to
-- schema.sql (the cumulative paste file) — keep the two identical. Owner runbook: the 2026-09-22 devlog
-- (docs/devlog/2026-09-22-balance-report-active-set.md). RLS is untouched: two nullable text columns and an
-- index on a table whose policies stay exactly as they are.
--
-- WHAT THIS IS (owner ask 2026-09-22: "it should only have data for the active set in it, and nothing from
-- scene builder"). Every finished lobby run uploads one run_telemetry row; the in-game Balance Report reads
-- them. Until now a row did not say which CARD SET the run was played under, so the report could not read one
-- set. From this patch the client stamps two columns on every new row:
--   set_id  — the run's pinned set ('set1' | 'set2' | 'set3'), the value createRun pinned at creation.
--   source  — what produced the row: 'ladder' for a real lobby run, 'sandbox' for a Scene Builder run,
--             or the run's mode for anything else. The run-end gates already let only ladder runs upload;
--             this makes that fact a column, so a sandbox row can never pass for a ladder row.
-- Both values ALSO ride inside the `derived` jsonb (derived->>'setId', derived->>'source'), so a client that
-- runs before this migration still records them there (and the report reads them from there until the
-- columns exist); the client's insert falls back to the pre-migration column set until this has run
-- (nothing is lost either way).
alter table public.run_telemetry add column if not exists set_id text;
alter table public.run_telemetry add column if not exists source text;
create index if not exists run_telemetry_set on public.run_telemetry (set_id);

-- ── BACKFILL the rows written before the column existed ──────────────────────────────────────────────────
-- The report reads a row with NO set stamp as set 1 (the same legacy default as every other pre-sets surface)
-- and never as the live set. Most rows in the table today were played under SET 2 (the report went
-- lobby-only and set 2 went live on the same day, 2026-07-31), but NOT all of them: a read-only probe of the
-- 114 live rows on 2026-09-22 found FOUR whose Shop offered cards that only set 3's pool holds (ids 48, 77,
-- 87 and 89: Celestials, Spirits, set-3 Undead and Kobolds, played on dev or Scene Builder builds), so a
-- blanket 'set2' stamp would have put set-3 runs into the Set 2 report. The backfill therefore CHECKS every
-- row against its shop offers: a row is stamped set2 only when NO card it was offered in the Shop lies
-- outside set 2's pool. The list below is every card in set 3's resolved pool that is in neither set 2's nor
-- set 1's pool: 112 ids, generated from the content registry at revision 3f273677 as
--   poolFor('set3').all minus poolFor('set2').all minus poolFor('set1').all
-- (regenerate it the same way if the registry moves before this is run). A row that fails the check is LEFT
-- UNSTAMPED: it reads as set 1 and stays out of the Set 2 report, and the runbook's step 4 lists it so the
-- owner can decide what it is. Idempotent: it touches only unstamped lobby rows from that date on. Delete
-- the update if you would rather leave every row as set 1 (the report is then empty until new runs bank).
update public.run_telemetry
   set set_id = 'set2'
 where set_id is null
   and 'mode:lobby' = any(hero_offer)
   and created_at >= '2026-07-31'
   and not (coalesce(offered_cards, '{}'::text[]) && array[
         'accretion', 'aspectsblessing', 'blaster', 'ce3_accretionwarden', 'ce3_adept', 'ce3_artificer', 'ce3_conductor', 'ce3_constellationprime',
         'ce3_coronadevotee', 'ce3_courier', 'ce3_dawnsentinel', 'ce3_eclipsewarden', 'ce3_herald', 'ce3_lensgrinder', 'ce3_lodestar', 'ce3_novaherald',
         'ce3_orbitkeeper', 'ce3_peddler', 'ce3_seer', 'ce3_shootingstar', 'ce3_spellcore', 'ce3_starcharter', 'ce3_starform', 'ce3_starseed',
         'ce3_twinstar', 'ce3_vendor', 'ce3_wishingstar', 'ce3_zenith', 'crescendo', 'dw3_hangover', 'dw3_hankpepe', 'dw3_kneel',
         'dw3_pourman', 'dw3_shiftbroker', 'dw3_striker', 'dw3_tankerchief', 'dw3_thymes', 'dw3_tromboneer', 'e3_frank', 'e3_sculptor',
         'graverobbery', 'handsoap', 'k3_blastsurveyor', 'k3_doubletrouble', 'k3_facetbound', 'k3_forkedcrown', 'k3_forksong', 'k3_forkvein',
         'k3_goldvein', 'k3_jeweler', 'k3_kaura', 'k3_korn', 'k3_kurse', 'k3_porkbelly', 'k3_prismpick', 'k3_rubyroach',
         'k3_runespark', 'k3_splitpick', 'k3_veinchant', 'n3_calibration', 'n3_charger', 'n3_defender', 'n3_hustler', 'n3_pell',
         'n3_recruiter', 'n3_rig', 'n3_shredder', 'n3_splitboon', 'n3_yeti', 'rushorder', 'sharedspirit', 'sp3_aspect',
         'sp3_bondweaver', 'sp3_dreamcurrent', 'sp3_dreamingdeep', 'sp3_dreamtide', 'sp3_festivalkeeper', 'sp3_flamebanner', 'sp3_flamereveler', 'sp3_forestcolossus',
         'sp3_gatheringguide', 'sp3_grandprocession', 'sp3_grovereveler', 'sp3_handboundtitan', 'sp3_handyflame', 'sp3_hearthwhisperer', 'sp3_kindled', 'sp3_luminary',
         'sp3_nurturer', 'sp3_paradeartificer', 'sp3_revelator', 'sp3_seedling', 'sp3_slumbering', 'sp3_tidebud', 'sp3_tidereveler', 'sp3_treasurer',
         'splitdecision', 'starcrash', 'stellarchorus', 'u3_adeptus', 'u3_bicyclebob', 'u3_cagebreaker', 'u3_ems', 'u3_hierophant',
         'u3_noggin', 'u3_poochy', 'u3_revenant', 'u3_risingtide', 'u3_robinson', 'u3_rodrick', 'u3_skeleton', 'u3_squatimus'
       ]::text[]);

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- FIGHT LEDGER + LOBBY STRENGTH + the top-4 strength bonus  (2026-09-22)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). The same block is appended to
-- schema.sql (the cumulative paste file) — keep the two identical. Owner runbook: the devlog
-- docs/devlog/2026-09-22-hall-fight-ledger-lobby-strength.md. DEPLOY THE EDGE FUNCTION FIRST (it works against
-- both the old and the new database); then run this.
--
-- WHAT THIS IS (owner 2026-09-22: "we want the hall of champions to answer 'what board has been the best
-- against everything else' … overall win/loss across games. so a 15 round game may mean it was 12-3" … "make an
-- algorithm that can essentially assign a lobby strength value/indicator … make winning really difficult
-- lobbies more rewarding"). Three parts:
--
--   1. `lobby_fights` — ONE ROW PER FIGHT the table resolved, both sides named by their run key
--      (`author|heroId|seed` for a real run — the key the client groups the opponent pool by — or
--      `bot:<kind>:<heroId>` for a generated seat). The client writes every fight of a real lobby at its end:
--      the ones it witnessed (`observed = true`) plus, when its player fell before the table finished, the ones a
--      deterministic play-out of the remaining rounds resolved (`observed = false`). Ghost fights, sit-outs and
--      bot-versus-bot fights are never rows. The unique key makes the write idempotent (a run restored and
--      finished twice cannot count a fight twice).
--   2. `run_fight_records` — the per-run AGGREGATE the client reads (never a row pool): fights, W-L-D, distinct
--      lobbies, win rate, and a Wilson 95% lower bound of the win rate (the Hall's sort key: a 30-2 run ranks
--      above a 3-0 run). Public read through PostgREST like every other ledger.
--   3. `settle_rank` learns `p_seat_keys` — the seven opponent keys of the finished lobby. It recomputes the
--      LOBBY STRENGTH from the view at settle time (the mean over the seven of `(wins + 10) / (fights + 20)`,
--      a bot key a fixed 0.25, `round(100 × mean)`) and, for a TOP-4 finish, adds
--      `round(15 × placementWeight × clamp((strength − 30) / 70, 0, 1))` to the award BEFORE the gate / cap
--      logic, the weights 1.0 / 0.8 / 0.62 / 0.47 for 1st to 4th (owner anchors: 1st at 100 = +15, 1st at 75 =
--      +10, 4th at 100 = +7). Never on 5th–8th, never negative, losses untouched. The result records
--      `strength_bonus` and `lobby_strength`.
--      The old six-argument overload is DROPPED (a second overload would make the PostgREST rpc ambiguous);
--      the deployed Edge Function retries without the keys against a database that has not run this yet.
--
-- Everything is additive. Until this runs: the view 404s (the Hall shows its empty state, Career rows show no
-- strength) and the Edge Function settles without a bonus. Nothing breaks.

-- ── 1. lobby_fights ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.lobby_fights (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete set null, -- the REPORTER (whose lobby it was)
  lobby_seed  bigint  not null,            -- the lobby (= the reporting run's seed)
  round       int     not null,
  run_a       text    not null,            -- run key of side A (author|heroId|seed, or bot:<kind>:<heroId>)
  run_b       text    not null,            -- run key of side B
  outcome     text    not null,            -- 'a' | 'b' | 'draw', from A's side
  observed    boolean not null default true, -- false = resolved by the play-out after the reporter's elimination
  patch       text,
  created_at  timestamptz default now(),
  constraint lobby_fights_outcome        check (outcome in ('a', 'b', 'draw')),
  constraint lobby_fights_distinct_sides check (run_a <> run_b),
  constraint lobby_fights_one_per_pairing unique (lobby_seed, round, run_a, run_b)
);
create index if not exists lobby_fights_run_a on public.lobby_fights (run_a);
create index if not exists lobby_fights_run_b on public.lobby_fights (run_b);

alter table public.lobby_fights enable row level security;
drop policy if exists "read lobby_fights"       on public.lobby_fights;
drop policy if exists "insert own lobby_fights" on public.lobby_fights;
create policy "read lobby_fights"       on public.lobby_fights for select using (true);
create policy "insert own lobby_fights" on public.lobby_fights for insert to authenticated with check (auth.uid() = user_id);

-- ── 2. run_fight_records — the per-run aggregate ─────────────────────────────────────────────────────────
-- One row per run key over BOTH sides of every fight. `win_rate` = wins / fights (a draw is not a win).
-- `wilson_lb` = the Wilson score interval's lower bound at 95% (z = 1.959964), 0 when there are no fights.
create or replace view public.run_fight_records as
with sides as (
  select run_a as run_key, lobby_seed, created_at,
         (outcome = 'a')::int as win, (outcome = 'b')::int as loss, (outcome = 'draw')::int as draw
    from public.lobby_fights
  union all
  select run_b as run_key, lobby_seed, created_at,
         (outcome = 'b')::int as win, (outcome = 'a')::int as loss, (outcome = 'draw')::int as draw
    from public.lobby_fights
), agg as (
  select run_key,
         count(*)::int              as fights,
         sum(win)::int              as wins,
         sum(loss)::int             as losses,
         sum(draw)::int             as draws,
         count(distinct lobby_seed)::int as lobbies,
         max(created_at)            as last_fight_at
    from sides
   group by run_key
)
select run_key, fights, wins, losses, draws, lobbies, last_fight_at,
       case when fights = 0 then 0::float8 else wins::float8 / fights end as win_rate,
       case when fights = 0 then 0::float8 else
         ((wins::float8 / fights) + (1.959964 * 1.959964) / (2 * fights)
           - 1.959964 * sqrt(((wins::float8 / fights) * (1 - wins::float8 / fights) + (1.959964 * 1.959964) / (4 * fights)) / fights))
         / (1 + (1.959964 * 1.959964) / fights)
       end as wilson_lb
  from agg;
grant select on public.run_fight_records to anon, authenticated;

-- ── 3. rank_results learns the strength + the bonus ─────────────────────────────────────────────────────
alter table public.rank_results add column if not exists lobby_strength int;
alter table public.rank_results add column if not exists strength_bonus int not null default 0;

create or replace function public.rank_result_json(r public.rank_results)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'runId', r.run_id, 'seasonId', r.season, 'rulesVersion', r.rules_version,
    'revisionBefore', r.revision_before, 'revisionAfter', r.revision_after,
    'placement', r.placement,
    'before', jsonb_build_object('divisionIndex', r.division_before, 'points', r.points_before, 'demotionReady', r.demotion_ready_before),
    'after',  jsonb_build_object('divisionIndex', r.division_after,  'points', r.points_after,  'demotionReady', r.demotion_ready_after),
    'baseDelta', r.base_delta, 'strengthBonus', coalesce(r.strength_bonus, 0), 'lobbyStrength', r.lobby_strength,
    'appliedDelta', r.applied_delta, 'cappedPoints', r.capped_points,
    'wasPromotionGame', r.was_promotion_game, 'promotionKind', r.promotion_kind, 'requiredFinish', r.required_finish,
    'promotionUnlocked', r.promotion_unlocked, 'promoted', r.promoted,
    'wasDemotionGame', r.was_demotion_game, 'demotionUnlocked', r.demotion_unlocked, 'demoted', r.demoted,
    'highestAfter', jsonb_build_object('divisionIndex', r.highest_division_after, 'points', r.highest_points_after)
  );
$$;

-- ── 4. settle_rank — THE writer, now with the lobby-strength bonus. Service role only. ─────────────────────
-- The six-argument overload is dropped: `create or replace` with a new parameter list would ADD an overload,
-- and PostgREST's named-argument rpc would then see two candidates.
drop function if exists public.settle_rank(uuid, text, int, int, int, bigint);

-- Order (blueprint §6): validate → ensure + LOCK the profile row → ledger check under the lock (duplicate →
-- the ORIGINAL result, no second award) → rate limit (raise → nothing committed) → strength + bonus →
-- resolve from the locked profile → write profile + revision + immutable result → (best-effort) stamp the
-- career row → return both the result and the current authoritative profile. Any `raise` rolls everything back.
--
-- The resolver branches are the same as `resolveRank` in packages/sim/src/rank.ts, in the same order, with
-- v_base = the placement award + the top-4 strength bonus (0 for 5th–8th):
--   at a gate (points = 100 below the top): placement ≤ required (4 for a division gate, 1 for a medal gate)
--     → promote ONE division to c_promo_landing/100 (10 — owner 2026-09-21, was 0); a positive award short of
--     a MEDAL gate (2nd–4th) HOLDS at 100, still promotion-ready; a negative award applies normally from 100.
--   at an ARMED demotion gate (the STORED rank_demotion_ready flag): a bottom-4 (5th–8th) demotes ONE
--     division to the previous division at 100 + award (across a medal boundary: the previous medal's III);
--     a top-4 escapes, applies its positive award normally from 0, and disarms.
--   otherwise add the award: a LOSS landing on 0 (by clamp or exact subtraction) in ANY division above
--     Bronze I CLAMPS at 0 and ARMS the gate — there are NO instant demotions (owner 2026-09-21); Bronze I
--     floors at 0 with no gate; Ascendant III is uncapped upward; elsewhere ≥ 100 → exactly 100, promotion
--     unlocked (overflow discarded — a 1st at 90/100 in a Brutal lobby still lands on 100). A promotion
--     landing is never armed; any non-negative result disarms.
--   highest = max(highest, after) by division then points; revision + 1; rating = the scalar.
create or replace function public.settle_rank(
  p_user uuid, p_run_id text, p_placement int, p_season int, p_rules_version int, p_seed bigint default null,
  p_seat_keys text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of RANK_RULES / _shared/lobbyRating.ts — change all three together)
  c_season          constant int := 3;
  c_rules           constant int := 1;
  c_cap             constant int := 100;
  c_top             constant int := 17;
  c_per_medal       constant int := 3;
  c_awards          constant int[] := array[40, 28, 16, 6, -6, -16, -28, -40];
  c_division_finish constant int := 4;
  c_medal_finish    constant int := 1;
  c_demotion_finish constant int := 4;   -- worst placement that still ESCAPES a demotion game
  c_promo_landing   constant int := 10;  -- points a WON promotion lands on in the next division (owner 2026-09-21; was 0)
  c_rate_max        constant int := 20;
  c_rate_window     constant interval := interval '10 minutes';
  -- LOBBY STRENGTH + the top-4 bonus (mirror of packages/sim/src/lobbyStrength.ts — owner 2026-09-22)
  c_prior_wins      constant int := 10;      -- the smoothing prior: 10 wins in 20 fights (an unserved run reads 50)
  c_prior_fights    constant int := 20;
  c_bot_rate        constant float8 := 0.25; -- a generated seat's fixed win rate
  c_bonus_max       constant int := 15;      -- +15 for a 1st at strength 100
  c_bonus_floor     constant int := 30;      -- the factor is 0 at this strength and below
  c_bonus_span      constant int := 70;      -- 100 - c_bonus_floor: the factor is 1 at 100
  c_bonus_weights   constant float8[] := array[1.0, 0.8, 0.62, 0.47]; -- 1st, 2nd, 3rd, 4th; 5th-8th earn nothing
  c_tier_even       constant int := 35;      -- Easy < 35, Even 35-54, Hard 55-69, Brutal >= 70
  c_tier_hard       constant int := 55;
  c_tier_brutal     constant int := 70;

  prof       public.profiles%rowtype;
  prev       public.rank_results%rowtype;
  v_base     int;
  v_pts      int;
  d0 int; p0 int; d1 int; p1 int; hd int; hp int;
  r0 boolean; r1 boolean := false;
  v_gate     boolean := false;
  v_kind     text := null;
  v_required int := null;
  v_unlocked boolean := false;
  v_promoted boolean := false;
  v_dgate    boolean := false;
  v_dunlock  boolean := false;
  v_demoted  boolean := false;
  v_applied  int;
  v_capped   int;
  v_recent   int;
  v_strength int := null;
  v_bonus    int := 0;
  v_tier     text := null;
begin
  -- 1. validate
  if p_placement is null or p_placement < 1 or p_placement > 8 then raise exception 'bad_placement'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_season is distinct from c_season then raise exception 'unsupported_season'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. ensure the row exists, then LOCK it (every entry point takes this lock first)
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.rank_results where user_id = p_user and run_id = p_run_id;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.rank_result_json(prev), 'profile', public.rank_profile_json(prof));
  end if;

  -- 4. rate limit — a raise rolls the transaction back, so a refused request leaves no ledger row
  select count(*) into v_recent from public.rank_results
    where user_id = p_user and created_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 5. LOBBY STRENGTH from the fight ledger (owner 2026-09-22): the mean over the seven opponent keys of each
  --    run's smoothed win rate; a bot key is a fixed 0.25; a key with no row reads the prior (0.5). Then the
  --    TOP-4 bonus: round(c_bonus_max × c_bonus_weights[placement] × clamp((strength − c_bonus_floor) /
  --    c_bonus_span, 0, 1)), the SAME multiplication order as the two TS copies so the doubles agree before
  --    the round. No keys (an older client) → no strength, no bonus — exactly the pre-bonus ladder.
  if p_seat_keys is not null and cardinality(p_seat_keys) > 0 then
    select round((100 * avg(
             case when k like 'bot:%' then c_bot_rate
                  else (least(coalesce(r.fights, 0), greatest(0, coalesce(r.wins, 0))) + c_prior_wins)::float8
                       / (greatest(0, coalesce(r.fights, 0)) + c_prior_fights)
             end))::numeric)::int
      into v_strength
      from unnest(p_seat_keys) as k
      left join public.run_fight_records r on r.run_key = k;
    v_strength := least(100, greatest(0, v_strength));
    v_tier := case when v_strength >= c_tier_brutal then 'Brutal'
                   when v_strength >= c_tier_hard then 'Hard'
                   when v_strength >= c_tier_even then 'Even'
                   else 'Easy' end;
    if p_placement <= cardinality(c_bonus_weights) then
      v_bonus := round((c_bonus_max * c_bonus_weights[p_placement] * least(1.0::float8, greatest(0.0::float8, (v_strength - c_bonus_floor)::float8 / c_bonus_span)))::numeric)::int;
    end if;
  end if;

  -- 6. resolve from the LOCKED profile. A profile from another season (or never ranked) starts fresh.
  if prof.rank_season is distinct from c_season then
    d0 := 0; p0 := 0; r0 := false; hd := 0; hp := 0;
  else
    d0 := prof.rank_division; p0 := prof.rank_points; r0 := coalesce(prof.rank_demotion_ready, false);
    hd := prof.rank_highest_division; hp := prof.rank_highest_points;
  end if;

  v_base := c_awards[p_placement] + v_bonus;                  -- the award PLUS the top-4 strength bonus
  d1 := d0; p1 := p0;

  if d0 < c_top and p0 = c_cap then
    -- promotion game
    v_gate := true;
    if (d0 % c_per_medal) = c_per_medal - 1 then v_kind := 'medal'; v_required := c_medal_finish;
    else v_kind := 'division'; v_required := c_division_finish; end if;
    if p_placement <= v_required then
      v_promoted := true; d1 := d0 + 1; p1 := c_promo_landing; -- a won gate starts the next division at the landing (10)
    elsif v_base >= 0 then
      d1 := d0; p1 := p0;                                     -- medal gate, 2nd–4th: hold at 100
    else
      v_pts := p0 + v_base;                                   -- the normal negative award from 100 (≥ 60 with this table)
      if v_pts <= 0 and d0 > 0 then d1 := d0; p1 := 0; r1 := true; -- (unreachable with this table) a loss to 0 → ARM
      elsif v_pts < 0 then d1 := 0; p1 := 0;                  -- (unreachable with this table) Bronze I floor
      else d1 := d0; p1 := v_pts;
      end if;
    end if;
  elsif r0 then
    -- demotion game (the STORED flag — armed by an earlier loss that clamped at 0 in this division)
    v_dgate := true; v_required := c_demotion_finish;
    if p_placement <= v_required then
      d1 := d0; p1 := p0 + v_base;                            -- escape: the positive award from 0 (< 100 with this table)
      if d0 < c_top and p1 >= c_cap then v_unlocked := true; p1 := c_cap; end if;
    else
      v_demoted := true; d1 := d0 - 1; p1 := c_cap + v_base;  -- ONE division down at 100 + award (across a medal boundary: the previous medal's III)
    end if;
  else
    v_pts := p0 + v_base;
    if v_base < 0 and v_pts <= 0 and d0 > 0 then
      d1 := d0; p1 := 0; r1 := true;                          -- a LOSS lands on 0 in any division above Bronze I → ARMED (no instant demotion)
    elsif v_pts < 0 then
      d1 := 0; p1 := 0;                                       -- Bronze I floor, no gate (the only division that reaches here)
    elsif d0 = c_top then
      d1 := c_top; p1 := v_pts;                               -- Ascendant III: uncapped
    elsif v_pts >= c_cap then
      v_unlocked := true; d1 := d0; p1 := c_cap;              -- gate reached; overflow discarded
    else
      d1 := d0; p1 := v_pts;
    end if;
  end if;
  v_dunlock := r1;                                            -- this game ARMED the gate

  v_applied := (c_cap * d1 + p1) - (c_cap * d0 + p0);
  if v_promoted then v_capped := 0; else v_capped := greatest(0, abs(v_base) - abs(v_applied)); end if;
  if d1 > hd or (d1 = hd and p1 > hp) then hd := d1; hp := p1; end if;

  -- 7. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    rank_season = c_season, rank_rules_version = c_rules,
    rank_division = d1, rank_points = p1, rank_demotion_ready = r1,
    rank_highest_division = hd, rank_highest_points = hp,
    rank_revision = prof.rank_revision + 1,
    rating = c_cap * d1 + p1,
    updated_at = now()
  where user_id = p_user;

  insert into public.rank_results (
    user_id, run_id, seed, season, rules_version, placement,
    revision_before, revision_after,
    division_before, points_before, demotion_ready_before, division_after, points_after, demotion_ready_after,
    highest_division_after, highest_points_after,
    base_delta, applied_delta, capped_points,
    was_promotion_game, promotion_kind, required_finish, promotion_unlocked, promoted,
    was_demotion_game, demotion_unlocked, demoted,
    lobby_strength, strength_bonus
  ) values (
    p_user, p_run_id, p_seed, c_season, c_rules, p_placement,
    prof.rank_revision, prof.rank_revision + 1,
    d0, p0, r0, d1, p1, r1,
    hd, hp,
    v_base, v_applied, v_capped,
    v_gate, v_kind, v_required, v_unlocked, v_promoted,
    v_dgate, v_dunlock, v_demoted,
    v_strength, v_bonus
  ) returning * into prev;

  -- 8. best-effort: stamp the confirmed result onto the matching career row (it usually exists by now — the
  --    history insert fires at the same moment as this settlement; a miss is harmless, the ledger is the truth).
  --    The lobby strength is stamped too, but only when the client's own stamp is missing (the client's carries
  --    the seven inputs; the server's is the value + tier).
  if p_seed is not null then
    update public.run_history
      set entry = entry || jsonb_build_object(
        'rank', public.rank_result_json(prev),
        'ratingBefore', c_cap * d0 + p0, 'ratingAfter', c_cap * d1 + p1, 'ratingDelta', v_applied
      ) || case when v_strength is not null and not (entry ? 'lobbyStrength')
                then jsonb_build_object('lobbyStrength', jsonb_build_object('value', v_strength, 'tier', v_tier, 'inputs', '[]'::jsonb))
                else '{}'::jsonb end
      where user_id = p_user and mode = 'lobby' and placement = p_placement and entry->>'seed' = p_seed::text
        and not (entry ? 'rank');
  end if;

  select * into prof from public.profiles where user_id = p_user;
  return jsonb_build_object('status', 'ok', 'result', public.rank_result_json(prev), 'profile', public.rank_profile_json(prof));
end;
$$;

-- Service role ONLY. Functions are executable by PUBLIC by default — revoke that, then grant the one caller.
revoke all on function public.settle_rank(uuid, text, int, int, int, bigint, text[]) from public, anon, authenticated;
grant execute on function public.settle_rank(uuid, text, int, int, int, bigint, text[]) to service_role;
revoke all on function public.rank_result_json(public.rank_results) from public, anon, authenticated;
grant execute on function public.rank_result_json(public.rank_results) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- LOBBY STRENGTH IS THE FIELD GOING IN  (2026-09-22, the same day as the fight ledger)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). Requires the fight-ledger block
-- (2026-09-22-fight-ledger.sql) to have run first. The same block is appended to schema.sql — keep the two
-- identical. Owner report: "the lobby difficulty shows 47 in my career and 50 in recent games, why".
--
-- `settle_rank` (same seven-argument signature; `create or replace` swaps the body in place) now computes the
-- lobby strength from `lobby_fights` EXCLUDING the lobby being settled (`lobby_seed <> p_seed`), so the number
-- is the opponents' record BEFORE this game — the same value the client stamps on the telemetry row (it
-- subtracts the rows it is about to upload). Before this, the server settled after the client's fight upload
-- had landed and read the seven opponents WITH this game's results folded in (47), while the client had read
-- them before (50). Everything else in the function is unchanged.

-- ── settle_rank — the lobby strength is the field GOING IN (this lobby's fights excluded). Service role only. ──
-- The six-argument overload is dropped: `create or replace` with a new parameter list would ADD an overload,
-- and PostgREST's named-argument rpc would then see two candidates.

-- Order (blueprint §6): validate → ensure + LOCK the profile row → ledger check under the lock (duplicate →
-- the ORIGINAL result, no second award) → rate limit (raise → nothing committed) → strength + bonus →
-- resolve from the locked profile → write profile + revision + immutable result → (best-effort) stamp the
-- career row → return both the result and the current authoritative profile. Any `raise` rolls everything back.
--
-- The resolver branches are the same as `resolveRank` in packages/sim/src/rank.ts, in the same order, with
-- v_base = the placement award + the top-4 strength bonus (0 for 5th–8th):
--   at a gate (points = 100 below the top): placement ≤ required (4 for a division gate, 1 for a medal gate)
--     → promote ONE division to c_promo_landing/100 (10 — owner 2026-09-21, was 0); a positive award short of
--     a MEDAL gate (2nd–4th) HOLDS at 100, still promotion-ready; a negative award applies normally from 100.
--   at an ARMED demotion gate (the STORED rank_demotion_ready flag): a bottom-4 (5th–8th) demotes ONE
--     division to the previous division at 100 + award (across a medal boundary: the previous medal's III);
--     a top-4 escapes, applies its positive award normally from 0, and disarms.
--   otherwise add the award: a LOSS landing on 0 (by clamp or exact subtraction) in ANY division above
--     Bronze I CLAMPS at 0 and ARMS the gate — there are NO instant demotions (owner 2026-09-21); Bronze I
--     floors at 0 with no gate; Ascendant III is uncapped upward; elsewhere ≥ 100 → exactly 100, promotion
--     unlocked (overflow discarded — a 1st at 90/100 in a Brutal lobby still lands on 100). A promotion
--     landing is never armed; any non-negative result disarms.
--   highest = max(highest, after) by division then points; revision + 1; rating = the scalar.
create or replace function public.settle_rank(
  p_user uuid, p_run_id text, p_placement int, p_season int, p_rules_version int, p_seed bigint default null,
  p_seat_keys text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of RANK_RULES / _shared/lobbyRating.ts — change all three together)
  c_season          constant int := 3;
  c_rules           constant int := 1;
  c_cap             constant int := 100;
  c_top             constant int := 17;
  c_per_medal       constant int := 3;
  c_awards          constant int[] := array[40, 28, 16, 6, -6, -16, -28, -40];
  c_division_finish constant int := 4;
  c_medal_finish    constant int := 1;
  c_demotion_finish constant int := 4;   -- worst placement that still ESCAPES a demotion game
  c_promo_landing   constant int := 10;  -- points a WON promotion lands on in the next division (owner 2026-09-21; was 0)
  c_rate_max        constant int := 20;
  c_rate_window     constant interval := interval '10 minutes';
  -- LOBBY STRENGTH + the top-4 bonus (mirror of packages/sim/src/lobbyStrength.ts — owner 2026-09-22)
  c_prior_wins      constant int := 10;      -- the smoothing prior: 10 wins in 20 fights (an unserved run reads 50)
  c_prior_fights    constant int := 20;
  c_bot_rate        constant float8 := 0.25; -- a generated seat's fixed win rate
  c_bonus_max       constant int := 15;      -- +15 for a 1st at strength 100
  c_bonus_floor     constant int := 30;      -- the factor is 0 at this strength and below
  c_bonus_span      constant int := 70;      -- 100 - c_bonus_floor: the factor is 1 at 100
  c_bonus_weights   constant float8[] := array[1.0, 0.8, 0.62, 0.47]; -- 1st, 2nd, 3rd, 4th; 5th-8th earn nothing
  c_tier_even       constant int := 35;      -- Easy < 35, Even 35-54, Hard 55-69, Brutal >= 70
  c_tier_hard       constant int := 55;
  c_tier_brutal     constant int := 70;

  prof       public.profiles%rowtype;
  prev       public.rank_results%rowtype;
  v_base     int;
  v_pts      int;
  d0 int; p0 int; d1 int; p1 int; hd int; hp int;
  r0 boolean; r1 boolean := false;
  v_gate     boolean := false;
  v_kind     text := null;
  v_required int := null;
  v_unlocked boolean := false;
  v_promoted boolean := false;
  v_dgate    boolean := false;
  v_dunlock  boolean := false;
  v_demoted  boolean := false;
  v_applied  int;
  v_capped   int;
  v_recent   int;
  v_strength int := null;
  v_bonus    int := 0;
  v_tier     text := null;
begin
  -- 1. validate
  if p_placement is null or p_placement < 1 or p_placement > 8 then raise exception 'bad_placement'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_season is distinct from c_season then raise exception 'unsupported_season'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. ensure the row exists, then LOCK it (every entry point takes this lock first)
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.rank_results where user_id = p_user and run_id = p_run_id;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.rank_result_json(prev), 'profile', public.rank_profile_json(prof));
  end if;

  -- 4. rate limit — a raise rolls the transaction back, so a refused request leaves no ledger row
  select count(*) into v_recent from public.rank_results
    where user_id = p_user and created_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 5. LOBBY STRENGTH from the fight ledger (owner 2026-09-22): the mean over the seven opponent keys of each
  --    run's smoothed win rate; a bot key is a fixed 0.25; a key with no row reads the prior (0.5). Then the
  --    TOP-4 bonus: round(c_bonus_max × c_bonus_weights[placement] × clamp((strength − c_bonus_floor) /
  --    c_bonus_span, 0, 1)), the SAME multiplication order as the two TS copies so the doubles agree before
  --    the round. No keys (an older client) → no strength, no bonus — exactly the pre-bonus ladder.
  if p_seat_keys is not null and cardinality(p_seat_keys) > 0 then
    select round((100 * avg(
             case when k like 'bot:%' then c_bot_rate
                  else (least(coalesce(r.fights, 0), greatest(0, coalesce(r.wins, 0))) + c_prior_wins)::float8
                       / (greatest(0, coalesce(r.fights, 0)) + c_prior_fights)
             end))::numeric)::int
      into v_strength
      from unnest(p_seat_keys) as k
      -- THE FIELD GOING IN (owner 2026-09-22): this lobby's own fights are EXCLUDED, so the strength describes
      -- the opponents' records before this game, and the client's stamp (which subtracts the rows it uploads)
      -- agrees with this one. The view is not used here because it cannot exclude by seed.
      left join lateral (
        select count(*)::int as fights,
               coalesce(sum(case when (x.run_a = k and x.outcome = 'a') or (x.run_b = k and x.outcome = 'b') then 1 else 0 end), 0)::int as wins
          from public.lobby_fights x
         where (x.run_a = k or x.run_b = k)
           and (p_seed is null or x.lobby_seed <> p_seed)
      ) r on true;
    v_strength := least(100, greatest(0, v_strength));
    v_tier := case when v_strength >= c_tier_brutal then 'Brutal'
                   when v_strength >= c_tier_hard then 'Hard'
                   when v_strength >= c_tier_even then 'Even'
                   else 'Easy' end;
    if p_placement <= cardinality(c_bonus_weights) then
      v_bonus := round((c_bonus_max * c_bonus_weights[p_placement] * least(1.0::float8, greatest(0.0::float8, (v_strength - c_bonus_floor)::float8 / c_bonus_span)))::numeric)::int;
    end if;
  end if;

  -- 6. resolve from the LOCKED profile. A profile from another season (or never ranked) starts fresh.
  if prof.rank_season is distinct from c_season then
    d0 := 0; p0 := 0; r0 := false; hd := 0; hp := 0;
  else
    d0 := prof.rank_division; p0 := prof.rank_points; r0 := coalesce(prof.rank_demotion_ready, false);
    hd := prof.rank_highest_division; hp := prof.rank_highest_points;
  end if;

  v_base := c_awards[p_placement] + v_bonus;                  -- the award PLUS the top-4 strength bonus
  d1 := d0; p1 := p0;

  if d0 < c_top and p0 = c_cap then
    -- promotion game
    v_gate := true;
    if (d0 % c_per_medal) = c_per_medal - 1 then v_kind := 'medal'; v_required := c_medal_finish;
    else v_kind := 'division'; v_required := c_division_finish; end if;
    if p_placement <= v_required then
      v_promoted := true; d1 := d0 + 1; p1 := c_promo_landing; -- a won gate starts the next division at the landing (10)
    elsif v_base >= 0 then
      d1 := d0; p1 := p0;                                     -- medal gate, 2nd–4th: hold at 100
    else
      v_pts := p0 + v_base;                                   -- the normal negative award from 100 (≥ 60 with this table)
      if v_pts <= 0 and d0 > 0 then d1 := d0; p1 := 0; r1 := true; -- (unreachable with this table) a loss to 0 → ARM
      elsif v_pts < 0 then d1 := 0; p1 := 0;                  -- (unreachable with this table) Bronze I floor
      else d1 := d0; p1 := v_pts;
      end if;
    end if;
  elsif r0 then
    -- demotion game (the STORED flag — armed by an earlier loss that clamped at 0 in this division)
    v_dgate := true; v_required := c_demotion_finish;
    if p_placement <= v_required then
      d1 := d0; p1 := p0 + v_base;                            -- escape: the positive award from 0 (< 100 with this table)
      if d0 < c_top and p1 >= c_cap then v_unlocked := true; p1 := c_cap; end if;
    else
      v_demoted := true; d1 := d0 - 1; p1 := c_cap + v_base;  -- ONE division down at 100 + award (across a medal boundary: the previous medal's III)
    end if;
  else
    v_pts := p0 + v_base;
    if v_base < 0 and v_pts <= 0 and d0 > 0 then
      d1 := d0; p1 := 0; r1 := true;                          -- a LOSS lands on 0 in any division above Bronze I → ARMED (no instant demotion)
    elsif v_pts < 0 then
      d1 := 0; p1 := 0;                                       -- Bronze I floor, no gate (the only division that reaches here)
    elsif d0 = c_top then
      d1 := c_top; p1 := v_pts;                               -- Ascendant III: uncapped
    elsif v_pts >= c_cap then
      v_unlocked := true; d1 := d0; p1 := c_cap;              -- gate reached; overflow discarded
    else
      d1 := d0; p1 := v_pts;
    end if;
  end if;
  v_dunlock := r1;                                            -- this game ARMED the gate

  v_applied := (c_cap * d1 + p1) - (c_cap * d0 + p0);
  if v_promoted then v_capped := 0; else v_capped := greatest(0, abs(v_base) - abs(v_applied)); end if;
  if d1 > hd or (d1 = hd and p1 > hp) then hd := d1; hp := p1; end if;

  -- 7. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    rank_season = c_season, rank_rules_version = c_rules,
    rank_division = d1, rank_points = p1, rank_demotion_ready = r1,
    rank_highest_division = hd, rank_highest_points = hp,
    rank_revision = prof.rank_revision + 1,
    rating = c_cap * d1 + p1,
    updated_at = now()
  where user_id = p_user;

  insert into public.rank_results (
    user_id, run_id, seed, season, rules_version, placement,
    revision_before, revision_after,
    division_before, points_before, demotion_ready_before, division_after, points_after, demotion_ready_after,
    highest_division_after, highest_points_after,
    base_delta, applied_delta, capped_points,
    was_promotion_game, promotion_kind, required_finish, promotion_unlocked, promoted,
    was_demotion_game, demotion_unlocked, demoted,
    lobby_strength, strength_bonus
  ) values (
    p_user, p_run_id, p_seed, c_season, c_rules, p_placement,
    prof.rank_revision, prof.rank_revision + 1,
    d0, p0, r0, d1, p1, r1,
    hd, hp,
    v_base, v_applied, v_capped,
    v_gate, v_kind, v_required, v_unlocked, v_promoted,
    v_dgate, v_dunlock, v_demoted,
    v_strength, v_bonus
  ) returning * into prev;

  -- 8. best-effort: stamp the confirmed result onto the matching career row (it usually exists by now — the
  --    history insert fires at the same moment as this settlement; a miss is harmless, the ledger is the truth).
  --    The lobby strength is stamped too, but only when the client's own stamp is missing (the client's carries
  --    the seven inputs; the server's is the value + tier).
  if p_seed is not null then
    update public.run_history
      set entry = entry || jsonb_build_object(
        'rank', public.rank_result_json(prev),
        'ratingBefore', c_cap * d0 + p0, 'ratingAfter', c_cap * d1 + p1, 'ratingDelta', v_applied
      ) || case when v_strength is not null and not (entry ? 'lobbyStrength')
                then jsonb_build_object('lobbyStrength', jsonb_build_object('value', v_strength, 'tier', v_tier, 'inputs', '[]'::jsonb))
                else '{}'::jsonb end
      where user_id = p_user and mode = 'lobby' and placement = p_placement and entry->>'seed' = p_seed::text
        and not (entry ? 'rank');
  end if;

  select * into prof from public.profiles where user_id = p_user;
  return jsonb_build_object('status', 'ok', 'result', public.rank_result_json(prev), 'profile', public.rank_profile_json(prof));
end;
$$;

-- Service role ONLY. Functions are executable by PUBLIC by default — revoke that, then grant the one caller.
revoke all on function public.settle_rank(uuid, text, int, int, int, bigint, text[]) from public, anon, authenticated;
grant execute on function public.settle_rank(uuid, text, int, int, int, bigint, text[]) to service_role;
revoke all on function public.rank_result_json(public.rank_results) from public, anon, authenticated;
grant execute on function public.rank_result_json(public.rank_results) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE STRENGTH BONUS FLOOR MOVES TO 50  (2026-09-22, late)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). Requires the fight-ledger block and
-- the going-in block to have run first. The same block is appended to schema.sql — keep the two identical.
-- Owner report: "why did i get +3 bonus mmr for winning a 45% lobby? isnt that an extremely even game?"
-- Chosen: floor 50, a straight line to 100. An even or easier lobby pays nothing; a 1st at 75 pays +8 (was
-- +10), a 1st at 100 still +15, a 4th at 100 still +7.
--
-- `settle_rank` (same seven-argument signature; `create or replace` swaps the body in place): c_bonus_floor
-- 30 → 50 and c_bonus_span 70 → 50. Everything else, including the going-in exclusion, is unchanged.

-- ── settle_rank — the bonus floor at 50 (even pays nothing); still the field GOING IN. Service role only. ──
-- The six-argument overload is dropped: `create or replace` with a new parameter list would ADD an overload,
-- and PostgREST's named-argument rpc would then see two candidates.

-- Order (blueprint §6): validate → ensure + LOCK the profile row → ledger check under the lock (duplicate →
-- the ORIGINAL result, no second award) → rate limit (raise → nothing committed) → strength + bonus →
-- resolve from the locked profile → write profile + revision + immutable result → (best-effort) stamp the
-- career row → return both the result and the current authoritative profile. Any `raise` rolls everything back.
--
-- The resolver branches are the same as `resolveRank` in packages/sim/src/rank.ts, in the same order, with
-- v_base = the placement award + the top-4 strength bonus (0 for 5th–8th):
--   at a gate (points = 100 below the top): placement ≤ required (4 for a division gate, 1 for a medal gate)
--     → promote ONE division to c_promo_landing/100 (10 — owner 2026-09-21, was 0); a positive award short of
--     a MEDAL gate (2nd–4th) HOLDS at 100, still promotion-ready; a negative award applies normally from 100.
--   at an ARMED demotion gate (the STORED rank_demotion_ready flag): a bottom-4 (5th–8th) demotes ONE
--     division to the previous division at 100 + award (across a medal boundary: the previous medal's III);
--     a top-4 escapes, applies its positive award normally from 0, and disarms.
--   otherwise add the award: a LOSS landing on 0 (by clamp or exact subtraction) in ANY division above
--     Bronze I CLAMPS at 0 and ARMS the gate — there are NO instant demotions (owner 2026-09-21); Bronze I
--     floors at 0 with no gate; Ascendant III is uncapped upward; elsewhere ≥ 100 → exactly 100, promotion
--     unlocked (overflow discarded — a 1st at 90/100 in a Brutal lobby still lands on 100). A promotion
--     landing is never armed; any non-negative result disarms.
--   highest = max(highest, after) by division then points; revision + 1; rating = the scalar.
create or replace function public.settle_rank(
  p_user uuid, p_run_id text, p_placement int, p_season int, p_rules_version int, p_seed bigint default null,
  p_seat_keys text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of RANK_RULES / _shared/lobbyRating.ts — change all three together)
  c_season          constant int := 3;
  c_rules           constant int := 1;
  c_cap             constant int := 100;
  c_top             constant int := 17;
  c_per_medal       constant int := 3;
  c_awards          constant int[] := array[40, 28, 16, 6, -6, -16, -28, -40];
  c_division_finish constant int := 4;
  c_medal_finish    constant int := 1;
  c_demotion_finish constant int := 4;   -- worst placement that still ESCAPES a demotion game
  c_promo_landing   constant int := 10;  -- points a WON promotion lands on in the next division (owner 2026-09-21; was 0)
  c_rate_max        constant int := 20;
  c_rate_window     constant interval := interval '10 minutes';
  -- LOBBY STRENGTH + the top-4 bonus (mirror of packages/sim/src/lobbyStrength.ts — owner 2026-09-22)
  c_prior_wins      constant int := 10;      -- the smoothing prior: 10 wins in 20 fights (an unserved run reads 50)
  c_prior_fights    constant int := 20;
  c_bot_rate        constant float8 := 0.25; -- a generated seat's fixed win rate
  c_bonus_max       constant int := 15;      -- +15 for a 1st at strength 100
  c_bonus_floor     constant int := 50;      -- the factor is 0 at this strength and below: even pays nothing (owner 2026-09-22, was 30)
  c_bonus_span      constant int := 50;      -- 100 - c_bonus_floor: the factor is 1 at 100
  c_bonus_weights   constant float8[] := array[1.0, 0.8, 0.62, 0.47]; -- 1st, 2nd, 3rd, 4th; 5th-8th earn nothing
  c_tier_even       constant int := 35;      -- Easy < 35, Even 35-54, Hard 55-69, Brutal >= 70
  c_tier_hard       constant int := 55;
  c_tier_brutal     constant int := 70;

  prof       public.profiles%rowtype;
  prev       public.rank_results%rowtype;
  v_base     int;
  v_pts      int;
  d0 int; p0 int; d1 int; p1 int; hd int; hp int;
  r0 boolean; r1 boolean := false;
  v_gate     boolean := false;
  v_kind     text := null;
  v_required int := null;
  v_unlocked boolean := false;
  v_promoted boolean := false;
  v_dgate    boolean := false;
  v_dunlock  boolean := false;
  v_demoted  boolean := false;
  v_applied  int;
  v_capped   int;
  v_recent   int;
  v_strength int := null;
  v_bonus    int := 0;
  v_tier     text := null;
begin
  -- 1. validate
  if p_placement is null or p_placement < 1 or p_placement > 8 then raise exception 'bad_placement'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_season is distinct from c_season then raise exception 'unsupported_season'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. ensure the row exists, then LOCK it (every entry point takes this lock first)
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.rank_results where user_id = p_user and run_id = p_run_id;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.rank_result_json(prev), 'profile', public.rank_profile_json(prof));
  end if;

  -- 4. rate limit — a raise rolls the transaction back, so a refused request leaves no ledger row
  select count(*) into v_recent from public.rank_results
    where user_id = p_user and created_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 5. LOBBY STRENGTH from the fight ledger (owner 2026-09-22): the mean over the seven opponent keys of each
  --    run's smoothed win rate; a bot key is a fixed 0.25; a key with no row reads the prior (0.5). Then the
  --    TOP-4 bonus: round(c_bonus_max × c_bonus_weights[placement] × clamp((strength − c_bonus_floor) /
  --    c_bonus_span, 0, 1)), the SAME multiplication order as the two TS copies so the doubles agree before
  --    the round. No keys (an older client) → no strength, no bonus — exactly the pre-bonus ladder.
  if p_seat_keys is not null and cardinality(p_seat_keys) > 0 then
    select round((100 * avg(
             case when k like 'bot:%' then c_bot_rate
                  else (least(coalesce(r.fights, 0), greatest(0, coalesce(r.wins, 0))) + c_prior_wins)::float8
                       / (greatest(0, coalesce(r.fights, 0)) + c_prior_fights)
             end))::numeric)::int
      into v_strength
      from unnest(p_seat_keys) as k
      -- THE FIELD GOING IN (owner 2026-09-22): this lobby's own fights are EXCLUDED, so the strength describes
      -- the opponents' records before this game, and the client's stamp (which subtracts the rows it uploads)
      -- agrees with this one. The view is not used here because it cannot exclude by seed.
      left join lateral (
        select count(*)::int as fights,
               coalesce(sum(case when (x.run_a = k and x.outcome = 'a') or (x.run_b = k and x.outcome = 'b') then 1 else 0 end), 0)::int as wins
          from public.lobby_fights x
         where (x.run_a = k or x.run_b = k)
           and (p_seed is null or x.lobby_seed <> p_seed)
      ) r on true;
    v_strength := least(100, greatest(0, v_strength));
    v_tier := case when v_strength >= c_tier_brutal then 'Brutal'
                   when v_strength >= c_tier_hard then 'Hard'
                   when v_strength >= c_tier_even then 'Even'
                   else 'Easy' end;
    if p_placement <= cardinality(c_bonus_weights) then
      v_bonus := round((c_bonus_max * c_bonus_weights[p_placement] * least(1.0::float8, greatest(0.0::float8, (v_strength - c_bonus_floor)::float8 / c_bonus_span)))::numeric)::int;
    end if;
  end if;

  -- 6. resolve from the LOCKED profile. A profile from another season (or never ranked) starts fresh.
  if prof.rank_season is distinct from c_season then
    d0 := 0; p0 := 0; r0 := false; hd := 0; hp := 0;
  else
    d0 := prof.rank_division; p0 := prof.rank_points; r0 := coalesce(prof.rank_demotion_ready, false);
    hd := prof.rank_highest_division; hp := prof.rank_highest_points;
  end if;

  v_base := c_awards[p_placement] + v_bonus;                  -- the award PLUS the top-4 strength bonus
  d1 := d0; p1 := p0;

  if d0 < c_top and p0 = c_cap then
    -- promotion game
    v_gate := true;
    if (d0 % c_per_medal) = c_per_medal - 1 then v_kind := 'medal'; v_required := c_medal_finish;
    else v_kind := 'division'; v_required := c_division_finish; end if;
    if p_placement <= v_required then
      v_promoted := true; d1 := d0 + 1; p1 := c_promo_landing; -- a won gate starts the next division at the landing (10)
    elsif v_base >= 0 then
      d1 := d0; p1 := p0;                                     -- medal gate, 2nd–4th: hold at 100
    else
      v_pts := p0 + v_base;                                   -- the normal negative award from 100 (≥ 60 with this table)
      if v_pts <= 0 and d0 > 0 then d1 := d0; p1 := 0; r1 := true; -- (unreachable with this table) a loss to 0 → ARM
      elsif v_pts < 0 then d1 := 0; p1 := 0;                  -- (unreachable with this table) Bronze I floor
      else d1 := d0; p1 := v_pts;
      end if;
    end if;
  elsif r0 then
    -- demotion game (the STORED flag — armed by an earlier loss that clamped at 0 in this division)
    v_dgate := true; v_required := c_demotion_finish;
    if p_placement <= v_required then
      d1 := d0; p1 := p0 + v_base;                            -- escape: the positive award from 0 (< 100 with this table)
      if d0 < c_top and p1 >= c_cap then v_unlocked := true; p1 := c_cap; end if;
    else
      v_demoted := true; d1 := d0 - 1; p1 := c_cap + v_base;  -- ONE division down at 100 + award (across a medal boundary: the previous medal's III)
    end if;
  else
    v_pts := p0 + v_base;
    if v_base < 0 and v_pts <= 0 and d0 > 0 then
      d1 := d0; p1 := 0; r1 := true;                          -- a LOSS lands on 0 in any division above Bronze I → ARMED (no instant demotion)
    elsif v_pts < 0 then
      d1 := 0; p1 := 0;                                       -- Bronze I floor, no gate (the only division that reaches here)
    elsif d0 = c_top then
      d1 := c_top; p1 := v_pts;                               -- Ascendant III: uncapped
    elsif v_pts >= c_cap then
      v_unlocked := true; d1 := d0; p1 := c_cap;              -- gate reached; overflow discarded
    else
      d1 := d0; p1 := v_pts;
    end if;
  end if;
  v_dunlock := r1;                                            -- this game ARMED the gate

  v_applied := (c_cap * d1 + p1) - (c_cap * d0 + p0);
  if v_promoted then v_capped := 0; else v_capped := greatest(0, abs(v_base) - abs(v_applied)); end if;
  if d1 > hd or (d1 = hd and p1 > hp) then hd := d1; hp := p1; end if;

  -- 7. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    rank_season = c_season, rank_rules_version = c_rules,
    rank_division = d1, rank_points = p1, rank_demotion_ready = r1,
    rank_highest_division = hd, rank_highest_points = hp,
    rank_revision = prof.rank_revision + 1,
    rating = c_cap * d1 + p1,
    updated_at = now()
  where user_id = p_user;

  insert into public.rank_results (
    user_id, run_id, seed, season, rules_version, placement,
    revision_before, revision_after,
    division_before, points_before, demotion_ready_before, division_after, points_after, demotion_ready_after,
    highest_division_after, highest_points_after,
    base_delta, applied_delta, capped_points,
    was_promotion_game, promotion_kind, required_finish, promotion_unlocked, promoted,
    was_demotion_game, demotion_unlocked, demoted,
    lobby_strength, strength_bonus
  ) values (
    p_user, p_run_id, p_seed, c_season, c_rules, p_placement,
    prof.rank_revision, prof.rank_revision + 1,
    d0, p0, r0, d1, p1, r1,
    hd, hp,
    v_base, v_applied, v_capped,
    v_gate, v_kind, v_required, v_unlocked, v_promoted,
    v_dgate, v_dunlock, v_demoted,
    v_strength, v_bonus
  ) returning * into prev;

  -- 8. best-effort: stamp the confirmed result onto the matching career row (it usually exists by now — the
  --    history insert fires at the same moment as this settlement; a miss is harmless, the ledger is the truth).
  --    The lobby strength is stamped too, but only when the client's own stamp is missing (the client's carries
  --    the seven inputs; the server's is the value + tier).
  if p_seed is not null then
    update public.run_history
      set entry = entry || jsonb_build_object(
        'rank', public.rank_result_json(prev),
        'ratingBefore', c_cap * d0 + p0, 'ratingAfter', c_cap * d1 + p1, 'ratingDelta', v_applied
      ) || case when v_strength is not null and not (entry ? 'lobbyStrength')
                then jsonb_build_object('lobbyStrength', jsonb_build_object('value', v_strength, 'tier', v_tier, 'inputs', '[]'::jsonb))
                else '{}'::jsonb end
      where user_id = p_user and mode = 'lobby' and placement = p_placement and entry->>'seed' = p_seed::text
        and not (entry ? 'rank');
  end if;

  select * into prof from public.profiles where user_id = p_user;
  return jsonb_build_object('status', 'ok', 'result', public.rank_result_json(prev), 'profile', public.rank_profile_json(prof));
end;
$$;

-- Service role ONLY. Functions are executable by PUBLIC by default — revoke that, then grant the one caller.
revoke all on function public.settle_rank(uuid, text, int, int, int, bigint, text[]) from public, anon, authenticated;
grant execute on function public.settle_rank(uuid, text, int, int, int, bigint, text[]) to service_role;
revoke all on function public.rank_result_json(public.rank_results) from public, anon, authenticated;
grant execute on function public.rank_result_json(public.rank_results) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- BALANCE REPORT — the pseudonymous player key; the seat ledger dropped  (2026-09-23)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). The same block is appended to
-- schema.sql (the cumulative paste file) — keep the two identical. ALREADY RUN on the live backend by the owner
-- on 2026-09-23 (a read-only probe confirmed player_key populated on 120 rows, 8 distinct keys, and
-- seat_results gone); filed here so a fresh backend gets the same shape.
--
-- 1. PLAYER KEY. The Balance Report counts UNIQUE PLAYERS on every evidence label (candidate / supported need
--    enough different players on both sides of a comparison), on the banner and on the sensitivity toggle
--    that leaves out the most prolific player. Until now it counted DISPLAY NAMES, a labelled proxy: a name can
--    change (one player reads as two) and can be shared (two players read as one). `player_key` is a
--    server-side hash of the uploading account id, generated by Postgres and stored, so the client never sees
--    or sends the account id: one key per account, stable across renames, null on a row with no user_id. The
--    report reads it on its own select rung (an un-migrated backend answers from the rung below and the report
--    says it fell back to display names). The raw key is never written into the export: each file carries a
--    per-file "player N" alias derived from it (see packages/sim/src/playerReport.ts playerAliases). RLS is
--    untouched: one generated column and an index on a table whose policies stay exactly as they are.
alter table public.run_telemetry add column if not exists player_key text generated always as (md5(user_id::text)) stored;
create index if not exists run_telemetry_player_key on public.run_telemetry (player_key);

-- 2. SEAT LEDGER DROPPED. `seat_results` (the 2026-09-22 Hall of Champions table-wins ledger, above in
--    schema.sql) is retired: the owner ruled the Hall's "own game" figure a ledger number, not a built table
--    play-out, so nothing reads or writes it. Dropping the table drops its two policies with it.
drop policy if exists "read seat_results"       on public.seat_results;
drop policy if exists "insert own seat_results" on public.seat_results;
drop table if exists public.seat_results;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- PRACTICE GAMES — the Recent Games "Practice" tab  (2026-09-24)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). The same block is appended to
-- schema.sql (the cumulative paste file); keep the two identical. Owner runbook: the devlog
-- docs/devlog/2026-09-24-leaderboard-rank-practice-tab.md.
--
-- WHAT THIS IS. Owner ask 2026-09-24: "can we add a practice tab to recent games, which shows the latest practice
-- mode games played?" Practice runs upload nothing to the ladder tables (run_telemetry, run_history, boards,
-- the fight ledger, ranks) and that stays true, so the Balance Report, the Hall and the Career never see a
-- practice game. This is a separate table: one LIGHT row per finished practice game (who, hero, placement,
-- record, final board, runes, length, the practice options). No replay payload, so a practice row has no Watch.
--
-- Reads are public, like every other ladder table; a player may only insert rows they own. Additive and
-- isolated: nothing else in the schema changes, and the game keeps working (the Practice tab shows its empty
-- state, the client's insert fails quietly) until this has been run.
create table if not exists public.practice_games (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users(id) on delete set null,
  author        text,
  patch         text,
  hero_id       text    not null,
  placement     int,                      -- the placement the practice end screen showed (1-8); null without a lobby
  wins          int     not null default 0,
  record        jsonb,                    -- { wins, losses, draws }
  wave          int,                      -- the round the game ended on
  final_board   jsonb,                    -- the end-state board snapshot (the same shape run_history.entry.board carries)
  picked_runes  text[],
  duration_ms   int,                      -- first to last recorded frame
  config        jsonb,                    -- { opponents: 'players'|'bots', botDifficulty: 1-10, health: 'unlimited'|'normal' }
  created_at    timestamptz default now()
);
create index if not exists practice_games_created on public.practice_games (created_at desc);

alter table public.practice_games enable row level security;
drop policy if exists "read practice_games"       on public.practice_games;
drop policy if exists "insert own practice_games" on public.practice_games;
create policy "read practice_games"       on public.practice_games for select using (true);
create policy "insert own practice_games" on public.practice_games for insert to authenticated with check (auth.uid() = user_id);

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- PRACTICE GAMES REPLAYS — a Watch on the Practice tabs  (2026-09-27)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). The same block is appended to
-- schema.sql (the cumulative paste file); keep the two identical. Owner runbook: the devlog
-- docs/devlog/2026-09-27-career-practice-tab.md.
--
-- WHAT THIS IS. Owner 2026-09-27, "okay go ahead and do it": practice games get replays after all (reversing the
-- 2026-09-24 "no replay payload" call). One nullable jsonb column carrying the SAME `replay` payload a ranked
-- run_telemetry row uploads (the action log + `v2`, the state replay the viewer plays). The Career and Recent
-- Games Practice tabs probe `replay->v2->version` only, and the Watch click fetches that one row's `replay->v2`.
--
-- RLS and policies are unchanged: "read practice_games" (public read) and "insert own practice_games" already
-- cover the new column. Additive: until this is run, the client uploads the result row WITHOUT its replay (it
-- retries on the unknown-column error) and the lists show no Watch. Only games finished after this runs have one.
alter table public.practice_games add column if not exists replay jsonb;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION — Account Level, XP and the Alpha Tester title  (2026-09-27, MVP)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent (safe to re-run). The same block is appended to
-- schema.sql (the cumulative paste file); keep the two identical. Owner runbook: the devlog
-- docs/devlog/2026-09-27-account-progression-mvp.md (run this, deploy `submit-progression`, THEN set the epoch).
--
-- WHAT THIS IS. Owner decisions 2026-09-27: a permanent, earn-only Account Level that grows with every completed
-- game and never touches the ranked ladder. Ranked 100 complete + 40 Top 4 + 60 first + 25 comeback; Practice
-- 60% of that (a flat 60 when the game has no meaningful placement, i.e. Unlimited Health); the first Learn
-- Ascent completion 250 once. Curve: 250 per level 1→11, 400 per level 11→26, 500 after. LIFETIME XP is
-- stored, the level is derived and cached. The MVP's only reward: the "Alpha Tester" title, which EVERY account
-- unlocks at Level 2 (auto-equipped when no title is equipped). No crates, cosmetics or achievements yet; the
-- ledger keeps their columns so they can land without a migration of this table.
--
-- THE RULES LIVE IN THREE PLACES that must agree: `settle_progression` below (the WRITER, the only thing that
-- moves XP), packages/progression/src/rules.ts (the client) and its GENERATED Deno copy
-- supabase/functions/_shared/progressionRules.ts (the Edge Function's runtime parity check). CI reads the
-- constants out of THIS file and compares (packages/progression/src/sqlParity.test.ts). Change all three
-- together; bump c_rules / PROGRESSION_RULES_VERSION when an old client would mis-show the result.
--
-- NO RETROACTIVE XP. Nothing is awarded until the owner sets `progression_config.epoch` (section 8 at the bottom
-- is the switch), and a ranked or practice game finished BEFORE the epoch is refused (`before_epoch`). The
-- client probes the epoch and shows nothing, queues nothing, while it is null, so shipping the client before
-- this runs is safe.
--
-- ANONYMOUS PLAYERS EARN XP (owner 2026-09-27): an anonymous Supabase session is a real `auth.users` id, and the
-- magic-link upgrade keeps that id, so progress carries over automatically. No session at all = no XP.

-- ── 1. The switch: the progression epoch ──────────────────────────────────────────────────────────────────
-- One row. `epoch` null = progression is OFF (the client shows nothing; `settle_progression` refuses with
-- `progression_disabled`). Set it ONCE, after `submit-progression` is deployed (runbook step 7).
create table if not exists public.progression_config (
  id         int primary key default 1 check (id = 1),
  epoch      timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.progression_config (id, epoch) values (1, null) on conflict (id) do nothing;
alter table public.progression_config enable row level security;
drop policy if exists "read progression_config" on public.progression_config;
create policy "read progression_config" on public.progression_config for select using (true);

-- ── 2. profiles: the progression columns ──────────────────────────────────────────────────────────────────
-- `account_xp` is LIFETIME XP and never goes down; `account_level` is a cache of the curve applied to it.
-- `progression_revision` is monotonic per account (+1 per settlement): the client adopts a server profile only
-- when its revision is not older than its mirror's. `equipped_title_id` is public (Career shows it).
alter table public.profiles add column if not exists account_xp                bigint not null default 0;
alter table public.profiles add column if not exists account_level             int    not null default 1;
alter table public.profiles add column if not exists progression_revision      bigint not null default 0;
alter table public.profiles add column if not exists progression_enrolled_at   timestamptz;
alter table public.profiles add column if not exists progression_curve_version int    not null default 1;
alter table public.profiles add column if not exists equipped_title_id         text;
alter table public.profiles drop constraint if exists profiles_account_xp_range;
alter table public.profiles add  constraint profiles_account_xp_range check (account_xp >= 0 and account_level >= 1);

-- A CLIENT can never write a progression column. Rather than re-stating the whole "update own profile" policy
-- (which pins every rank column and is owned by the medal-rank migration), a trigger refuses any insert that
-- carries non-default values and any update that changes them, when the statement runs as a client role. The
-- writer below runs SECURITY DEFINER (as the function owner), so it passes.
create or replace function public.profiles_progression_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.account_xp <> 0 or new.account_level <> 1 or new.progression_revision <> 0
       or new.progression_enrolled_at is not null or new.progression_curve_version <> 1 or new.equipped_title_id is not null then
      raise exception 'progression_columns_are_server_owned';
    end if;
  elsif new.account_xp is distinct from old.account_xp
     or new.account_level is distinct from old.account_level
     or new.progression_revision is distinct from old.progression_revision
     or new.progression_enrolled_at is distinct from old.progression_enrolled_at
     or new.progression_curve_version is distinct from old.progression_curve_version
     or new.equipped_title_id is distinct from old.equipped_title_id then
    raise exception 'progression_columns_are_server_owned';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_progression_guard on public.profiles;
create trigger profiles_progression_guard before insert or update on public.profiles
  for each row execute function public.profiles_progression_guard();

-- ── 3. progression_results: the immutable settlement ledger ───────────────────────────────────────────────
-- One row per (player, run, mode): the dedupe key AND the result the post-game screen animates. Written ONLY by
-- `settle_progression`. A player reads their own rows; nobody writes through the API. `crates_awarded`,
-- `achievement_xp` and `achievement_ids` stay 0 / empty in the MVP (reserved for the crate + achievement phases).
create table if not exists public.progression_results (
  user_id            uuid not null references auth.users(id) on delete cascade,
  run_id             text not null,
  mode               text not null check (mode in ('ranked', 'practice', 'tutorial')),
  source_id          text,
  rules_version      int  not null,
  curve_version      int  not null,
  facts_version      int,
  facts              jsonb,
  placement          int check (placement is null or placement between 1 and 8),
  comeback           boolean not null default false,
  base_xp            int  not null,
  top_four_xp        int  not null default 0,
  first_place_xp     int  not null default 0,
  comeback_xp        int  not null default 0,
  achievement_xp     int  not null default 0,
  total_xp           int  not null,
  xp_before          bigint not null,
  xp_after           bigint not null,
  level_before       int  not null,
  level_after        int  not null,
  revision_before    bigint not null,
  revision_after     bigint not null,
  crates_awarded     int  not null default 0,
  achievement_ids    text[] not null default '{}',
  unlocked_title_ids text[] not null default '{}',
  settled_at         timestamptz not null default now(),
  primary key (user_id, run_id, mode)
);
alter table public.progression_results enable row level security;
drop policy if exists "read own progression_results" on public.progression_results;
create policy "read own progression_results" on public.progression_results for select to authenticated using (auth.uid() = user_id);
create index if not exists progression_results_user_time on public.progression_results (user_id, settled_at desc);

-- Immutable even for the service role: a settled row is history.
create or replace function public.progression_results_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'progression_results_are_immutable';
end;
$$;
drop trigger if exists progression_results_immutable on public.progression_results;
create trigger progression_results_immutable before update on public.progression_results
  for each row execute function public.progression_results_immutable();

-- ── 4. player_titles: owned titles (public) ───────────────────────────────────────────────────────────────
-- The catalog of titles is client content (packages/progression TITLES); this table is ownership. Public read
-- (a Career shows a player's title); written only by `settle_progression`.
create table if not exists public.player_titles (
  user_id     uuid not null references auth.users(id) on delete cascade,
  title_id    text not null,
  unlocked_at timestamptz not null default now(),
  source      text not null,
  source_id   text,
  primary key (user_id, title_id)
);
alter table public.player_titles enable row level security;
drop policy if exists "read player_titles" on public.player_titles;
create policy "read player_titles" on public.player_titles for select using (true);

-- ── 5. tutorial_progression_claims: one Learn Ascent award per account per course version ─────────────────
create table if not exists public.tutorial_progression_claims (
  user_id        uuid not null references auth.users(id) on delete cascade,
  course_id      text not null,
  course_version int  not null,
  xp_awarded     int  not null,
  claimed_at     timestamptz not null default now(),
  primary key (user_id, course_id, course_version)
);
alter table public.tutorial_progression_claims enable row level security;
drop policy if exists "read own tutorial_progression_claims" on public.tutorial_progression_claims;
create policy "read own tutorial_progression_claims" on public.tutorial_progression_claims for select to authenticated using (auth.uid() = user_id);

-- ── 6. The curve, the JSON shapes, and THE writer ─────────────────────────────────────────────────────────
-- The curve, closed form (mirror of `levelOfXp` in packages/progression/src/rules.ts): 250 per level for levels
-- 1 to 10, 400 for 11 to 25, 500 from 26. Level 11 begins at 2500 XP, Level 26 at 8500.
create or replace function public.progression_level_of(p_xp bigint)
returns int
language plpgsql
immutable
set search_path = public
as $$
declare
  c_band1_xp  constant int := 250;
  c_band1_top constant int := 10;
  c_band2_xp  constant int := 400;
  c_band2_top constant int := 25;
  c_band3_xp  constant int := 500;
  v bigint;
begin
  if p_xp is null or p_xp < 0 then return 1; end if;
  if p_xp < c_band1_top * c_band1_xp then return (1 + p_xp / c_band1_xp)::int; end if;
  v := p_xp - c_band1_top * c_band1_xp;
  if v < (c_band2_top - c_band1_top) * c_band2_xp then return (c_band1_top + 1 + v / c_band2_xp)::int; end if;
  v := v - (c_band2_top - c_band1_top) * c_band2_xp;
  return (c_band2_top + 1 + v / c_band3_xp)::int;
end;
$$;

-- MUST match `ProgressionResult` in packages/progression/src/rules.ts key for key.
create or replace function public.progression_result_json(r public.progression_results)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'runId', r.run_id, 'mode', r.mode, 'rulesVersion', r.rules_version,
    'placement', r.placement, 'comeback', r.comeback,
    'xp', jsonb_build_object('base', r.base_xp, 'topFour', r.top_four_xp, 'firstPlace', r.first_place_xp, 'comeback', r.comeback_xp, 'total', r.total_xp),
    'before', jsonb_build_object('lifetimeXp', r.xp_before, 'level', r.level_before),
    'after',  jsonb_build_object('lifetimeXp', r.xp_after,  'level', r.level_after),
    'unlockedTitles', to_jsonb(r.unlocked_title_ids),
    'revisionAfter', r.revision_after,
    'settledAt', r.settled_at
  );
$$;

-- MUST match `ProgressionProfile` in packages/progression/src/rules.ts key for key.
create or replace function public.progression_profile_json(p_user uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'accountXp', p.account_xp, 'accountLevel', p.account_level, 'revision', p.progression_revision,
    'equippedTitleId', p.equipped_title_id,
    'titles', coalesce((select jsonb_agg(t.title_id order by t.unlocked_at) from public.player_titles t where t.user_id = p.user_id), '[]'::jsonb)
  )
  from public.profiles p where p.user_id = p_user;
$$;

-- settle_progression — THE writer. Service role only (called by the `submit-progression` Edge Function).
-- Order (handoff §8.4, MVP): validate → per-user advisory lock + profile row lock → ledger check under the lock
-- (a duplicate returns the ORIGINAL result, no second award) → the epoch switch → rate limit (raise → nothing
-- committed; the client retries later, valid XP is delayed, never reduced) → the SOURCE row (the placement is
-- read from it, never from the request) → XP → levels → title → profile + revision + immutable ledger row.
-- Any `raise` rolls everything back.
--
-- The comeback bonus is a client-derived fact (a win right after 4+ consecutive combat losses, once per run).
-- It is sanity-checked here against the run's recorded record where one exists (4+ losses and 1+ win), and the
-- client's fact document is stored with the row for audit.
create or replace function public.settle_progression(
  p_user uuid, p_mode text, p_run_id text, p_source_id bigint default null, p_comeback boolean default false,
  p_rules_version int default null, p_facts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of XP_RULES / CURVE in packages/progression/src/rules.ts — change all copies together)
  c_rules             constant int := 1;
  c_curve             constant int := 1;
  c_complete          constant int := 100;
  c_top_four          constant int := 40;
  c_first_place       constant int := 60;
  c_comeback          constant int := 25;
  c_comeback_streak   constant int := 4;
  c_practice_percent  constant int := 60;
  c_practice_flat     constant int := 60;
  c_tutorial          constant int := 250;
  c_tutorial_course   constant text := 'learn-ascent';
  c_tutorial_version  constant int := 1;
  c_alpha_title       constant text := 'alpha_tester';
  c_alpha_level       constant int := 2;
  c_rate_max          constant int := 30;
  c_rate_window       constant interval := interval '10 minutes';

  prof        public.profiles%rowtype;
  prev        public.progression_results%rowtype;
  v_epoch     timestamptz;
  v_recent    int;
  v_source_at timestamptz;
  v_source    text := null;
  v_placement int := null;
  v_comeback  boolean := false;
  v_seed      bigint;
  v_cfg       jsonb;
  v_record    jsonb;
  v_wins      int;
  v_losses    int;
  r_top int := 0; r_first int := 0; r_come int := 0; v_ranked_total int;
  v_base int := 0; v_top int := 0; v_first int := 0; v_come int := 0; v_total int;
  v_xp0 bigint; v_xp1 bigint; v_l0 int; v_l1 int;
  v_unlocked  text[] := '{}';
  v_equipped  text;
  v_rows      int;
  v_facts_ver int := null;
begin
  -- 1. validate
  if p_mode is null or p_mode not in ('ranked', 'practice', 'tutorial') then raise exception 'bad_mode'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. serialize per user (every progression entry point takes the advisory lock first), then lock the row
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.progression_results where user_id = p_user and run_id = p_run_id and mode = p_mode;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
  end if;

  -- 4. the switch: nothing is awarded before the owner sets the epoch
  select epoch into v_epoch from public.progression_config where id = 1;
  if v_epoch is null then raise exception 'progression_disabled'; end if;

  -- 5. rate limit (technical only: a refused request is retried later and keeps its XP)
  select count(*) into v_recent from public.progression_results
    where user_id = p_user and settled_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 6. the SOURCE row: the placement comes from here, never from the request
  if p_mode = 'ranked' then
    select rr.placement, rr.seed, rr.created_at into v_placement, v_seed, v_source_at
      from public.rank_results rr where rr.user_id = p_user and rr.run_id = p_run_id;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_run_id;
    v_comeback := coalesce(p_comeback, false);
    if v_comeback and v_seed is not null then
      select h.wins, case when (h.entry->>'losses') ~ '^[0-9]+$' then (h.entry->>'losses')::int end
        into v_wins, v_losses
        from public.run_history h
        where h.user_id = p_user and h.mode = 'lobby' and h.entry->>'seed' = v_seed::text
        order by h.created_at desc limit 1;
      if found and (coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1) then v_comeback := false; end if;
    end if;
  elsif p_mode = 'practice' then
    if p_source_id is null or p_source_id < 1 then raise exception 'bad_source'; end if;
    if p_run_id is distinct from ('practice:' || p_source_id::text) then raise exception 'bad_run_id'; end if;
    select pg.placement, pg.config, pg.record, pg.created_at into v_placement, v_cfg, v_record, v_source_at
      from public.practice_games pg where pg.id = p_source_id and pg.user_id = p_user;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_source_id::text;
    -- No meaningful placement: an Unlimited Health game plays to the curtain and is never eliminated (and a row
    -- with no options recorded is treated the same way). It earns the flat XP, no placement or comeback bonus.
    if v_cfg is null or coalesce(v_cfg->>'health', 'unlimited') <> 'normal'
       or v_placement is null or v_placement < 1 or v_placement > 8 then
      v_placement := null;
    end if;
    v_comeback := coalesce(p_comeback, false) and v_placement is not null;
    if v_comeback and v_record is not null then
      v_wins := case when (v_record->>'wins') ~ '^[0-9]+$' then (v_record->>'wins')::int end;
      v_losses := case when (v_record->>'losses') ~ '^[0-9]+$' then (v_record->>'losses')::int end;
      if coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1 then v_comeback := false; end if;
    end if;
  else
    -- tutorial: one claim per account per course version (the ledger check above already caught a repeat)
    if p_run_id is distinct from (c_tutorial_course || ':v' || c_tutorial_version::text) then raise exception 'bad_run_id'; end if;
    insert into public.tutorial_progression_claims (user_id, course_id, course_version, xp_awarded)
      values (p_user, c_tutorial_course, c_tutorial_version, c_tutorial)
      on conflict (user_id, course_id, course_version) do nothing;
    v_source := c_tutorial_course || ':' || c_tutorial_version::text;
  end if;

  -- 7. XP (mirror of xpForSettlement)
  if p_mode = 'tutorial' then
    v_base := c_tutorial;
  elsif p_mode = 'practice' and v_placement is null then
    v_base := c_practice_flat;
  else
    r_top   := case when v_placement <= 4 then c_top_four else 0 end;
    r_first := case when v_placement = 1 then c_first_place else 0 end;
    r_come  := case when v_comeback then c_comeback else 0 end;
    if p_mode = 'ranked' then
      v_base := c_complete; v_top := r_top; v_first := r_first; v_come := r_come;
    else
      -- Practice: 60% of the equivalent ranked XP, summed then rounded; the remainder lands on the base.
      v_ranked_total := c_complete + r_top + r_first + r_come;
      v_top   := (r_top   * c_practice_percent + 50) / 100;
      v_first := (r_first * c_practice_percent + 50) / 100;
      v_come  := (r_come  * c_practice_percent + 50) / 100;
      v_base  := (v_ranked_total * c_practice_percent + 50) / 100 - v_top - v_first - v_come;
    end if;
  end if;
  v_total := v_base + v_top + v_first + v_come;

  -- 8. levels (lifetime XP; the level is derived)
  v_xp0 := coalesce(prof.account_xp, 0);
  v_xp1 := v_xp0 + v_total;
  v_l0 := public.progression_level_of(v_xp0);
  v_l1 := public.progression_level_of(v_xp1);

  -- 9. titles: Alpha Tester for EVERY account at Level 2 (owner 2026-09-27); equipped when nothing else is
  if v_l1 >= c_alpha_level then
    insert into public.player_titles (user_id, title_id, source, source_id)
      values (p_user, c_alpha_title, 'level', p_mode || ':' || p_run_id)
      on conflict (user_id, title_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_unlocked := array_append(v_unlocked, c_alpha_title); end if;
  end if;
  v_equipped := prof.equipped_title_id;
  if v_equipped is null and exists (select 1 from public.player_titles t where t.user_id = p_user and t.title_id = c_alpha_title) then
    v_equipped := c_alpha_title;
  end if;

  -- 10. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    account_xp = v_xp1, account_level = v_l1,
    progression_revision = prof.progression_revision + 1,
    progression_enrolled_at = coalesce(prof.progression_enrolled_at, now()),
    progression_curve_version = c_curve,
    equipped_title_id = v_equipped,
    updated_at = now()
  where user_id = p_user;

  if p_facts is not null and jsonb_typeof(p_facts) = 'object' and (p_facts->>'version') ~ '^[0-9]+$' then
    v_facts_ver := (p_facts->>'version')::int;
  end if;

  insert into public.progression_results (
    user_id, run_id, mode, source_id, rules_version, curve_version, facts_version, facts,
    placement, comeback, base_xp, top_four_xp, first_place_xp, comeback_xp, achievement_xp, total_xp,
    xp_before, xp_after, level_before, level_after, revision_before, revision_after,
    crates_awarded, achievement_ids, unlocked_title_ids
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, 0, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    0, '{}', v_unlocked
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;

-- Service role ONLY. Functions are executable by PUBLIC by default: revoke that, then grant the one caller.
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;
revoke all on function public.progression_result_json(public.progression_results) from public, anon, authenticated;
grant execute on function public.progression_result_json(public.progression_results) to service_role;
revoke all on function public.progression_profile_json(uuid) from public, anon, authenticated;
grant execute on function public.progression_profile_json(uuid) to service_role;
-- The curve is harmless to expose (it is public in the client), but nothing needs it outside the writer.
revoke all on function public.progression_level_of(bigint) from public, anon, authenticated;
grant execute on function public.progression_level_of(bigint) to service_role;

-- ── 7. Level-based titles for accounts ALREADY at Level 2+ (idempotent) ───────────────────────────────────
-- The title is purely level-based, so the grant path above covers every settlement. This backfill covers any
-- account whose level was raised some other way (a hand-edit, a future curve change): it owns and, with
-- nothing equipped, wears Alpha Tester. A no-op on the first run (every account starts at Level 1).
insert into public.player_titles (user_id, title_id, source)
  select p.user_id, 'alpha_tester', 'level' from public.profiles p where p.account_level >= 2
  on conflict (user_id, title_id) do nothing;
update public.profiles p set equipped_title_id = 'alpha_tester', progression_revision = p.progression_revision + 1
  where p.account_level >= 2 and p.equipped_title_id is null;

-- ── 8. THE SWITCH (run by hand, ONCE, after `submit-progression` is deployed) ─────────────────────────────
-- Commented out so a re-run of this file can never move the epoch. Games finished before this moment never
-- earn XP (no retroactive backfill, owner 2026-09-27).
--
-- update public.progression_config set epoch = now(), updated_at = now() where id = 1 and epoch is null;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: level crates and the cosmetic catalog (15 crate titles)  (2026-09-28)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-27-account-progression.sql (it replaces that file's
-- `settle_progression`, so never re-run the 2026-09-27 file after this one). Idempotent (safe to re-run). The
-- same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-09-28-progression-crates.md.
--
-- WHAT THIS IS (owner 2026-09-27: "let's just do 15 titles to start"; handoff §5, §6.5 to §6.7, §14). Earn only.
--  - EVERY LEVEL GRANTS ONE SEALED CRATE; enrollment (an account's first settlement) grants the Level 1 Welcome
--    Crate. `settle_progression` creates them and records `crates_awarded` / `crate_ids` on the ledger row.
--  - THE REWARD IS CHOSEN WHEN THE CRATE IS OPENED (`open_crate`), weighted over the items still eligible
--    (rarity weight x category weight, normalized across what remains, never a rarity rolled first), NEVER a
--    duplicate. When nothing eligible is left the crate stays sealed (`pool_exhausted`), never converted.
--  - THE CATALOG is data: `cosmetic_categories` (weights + the per-category feature flag) and `cosmetic_catalog`
--    (one row per item), seeded from packages/progression/src/cosmetics.ts. Every handoff category exists; only
--    `title` is enabled. Ownership of every category is `player_cosmetics`; `player_titles` (the MVP table) is kept
--    as a mirror so older clients keep reading it.
--  - EQUIP goes through `equip_title`, which checks ownership. Clients never write ownership, crates or loadout.
--  - BACKFILL: accounts already enrolled get their Welcome Crate plus one crate per level already reached
--    (section 12; idempotent through the unique (user, level) key).
--
-- THE RULES LIVE IN TWO PLACES that must agree: this file and packages/progression/src (cosmetics.ts: catalog,
-- weights, roll; rules.ts: crates per level). CI parses this file and compares (sqlParity.test.ts) and runs it in
-- an embedded Postgres (crates.db.test.ts).

-- ── 1. The crates switch (UI only: crates are always earned and banked) ──────────────────────────────────────
-- The client shows crates and the Collection only while this is true, and `open_crate` refuses while it is false.
alter table public.progression_config add column if not exists crates_enabled boolean not null default true;

-- ── 2. cosmetic_categories: category weights + the per-category feature flag (handoff §5.3 / §5.4) ─────────
create table if not exists public.cosmetic_categories (
  category   text primary key,
  weight     int  not null check (weight >= 0),
  enabled    boolean not null default false,
  target     text not null check (target in ('global', 'hero', 'card')),
  updated_at timestamptz not null default now()
);
alter table public.cosmetic_categories enable row level security;
drop policy if exists "read cosmetic_categories" on public.cosmetic_categories;
create policy "read cosmetic_categories" on public.cosmetic_categories for select using (true);
-- The FIRST seed (titles only). Since 2026-09-28 the code owns this table: `sync_cosmetic_catalog` (the skins file)
-- writes it from packages/progression/src/cosmetics.ts. So a re-run never overwrites an existing row's flag.
insert into public.cosmetic_categories (category, weight, enabled, target) values
  ('announcer', 10, false, 'global'),
  ('hero_skin', 20, false, 'hero'),
  ('minion_skin', 35, false, 'card'),
  ('title', 10, true, 'global'),
  ('hero_attack', 15, false, 'global'),
  ('board', 5, false, 'global'),
  ('music', 5, false, 'global')
on conflict (category) do nothing;

-- ── 3. cosmetic_catalog: one row per item (handoff §6.5) ───────────────────────────────────────────────────
-- Ids are PERMANENT. Retire an item with active = false (never delete a row: ownership references it). Display
-- names and assets live in the client catalog; this table controls eligibility.
create table if not exists public.cosmetic_catalog (
  cosmetic_id        text primary key,
  category           text not null references public.cosmetic_categories(category),
  rarity             text not null check (rarity in ('common', 'rare', 'epic', 'legendary')),
  acquisition_source text not null check (acquisition_source in ('crate', 'level_milestone', 'achievement', 'event')),
  milestone_level    int,
  target_type        text check (target_type is null or target_type in ('hero', 'card')),
  target_id          text,
  achievement_id     text,
  active             boolean not null default true,
  manifest_version   int not null default 1,
  created_at         timestamptz not null default now(),
  check ((acquisition_source = 'level_milestone') = (milestone_level is not null))
);
alter table public.cosmetic_catalog enable row level security;
drop policy if exists "read cosmetic_catalog" on public.cosmetic_catalog;
create policy "read cosmetic_catalog" on public.cosmetic_catalog for select using (true);
-- The FIRST seed (the 16 titles). Since 2026-09-28 the code owns this table (`sync_cosmetic_catalog`), so a re-run
-- never overwrites an existing row.
insert into public.cosmetic_catalog (cosmetic_id, category, rarity, acquisition_source, milestone_level, target_type, target_id, achievement_id, active) values
  ('alpha_tester', 'title', 'rare', 'level_milestone', 2, null, null, null, true),
  ('title_wanderer', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_rune_reader', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_coin_counter', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_lantern_bearer', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_hearthkeeper', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_warband_captain', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_board_builder', 'title', 'common', 'crate', null, null, null, null, true),
  ('title_stormcaller', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_star_chaser', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_grave_whisperer', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_ironbeard', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_spiritbound', 'title', 'rare', 'crate', null, null, null, null, true),
  ('title_kingbreaker', 'title', 'epic', 'crate', null, null, null, null, true),
  ('title_voice_of_the_deep', 'title', 'epic', 'crate', null, null, null, null, true),
  ('title_the_unbroken', 'title', 'legendary', 'crate', null, null, null, null, true)
on conflict (cosmetic_id) do nothing;

-- ── 4. player_cosmetics: ownership of every category (public read, like the MVP's titles) ─────────────────
-- UNIQUE (user, item) is the final no-duplicate guard. Written only by `settle_progression` / `open_crate`.
create table if not exists public.player_cosmetics (
  user_id     uuid not null references auth.users(id) on delete cascade,
  cosmetic_id text not null references public.cosmetic_catalog(cosmetic_id),
  source      text not null,
  source_id   text,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);
alter table public.player_cosmetics enable row level security;
drop policy if exists "read player_cosmetics" on public.player_cosmetics;
create policy "read player_cosmetics" on public.player_cosmetics for select using (true);

-- Keep the MVP's `player_titles` true for older clients: every owned TITLE is mirrored into it.
create or replace function public.player_cosmetics_mirror_titles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.cosmetic_catalog c where c.cosmetic_id = new.cosmetic_id and c.category = 'title') then
    insert into public.player_titles (user_id, title_id, unlocked_at, source, source_id)
      values (new.user_id, new.cosmetic_id, new.unlocked_at, new.source, new.source_id)
      on conflict (user_id, title_id) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists player_cosmetics_mirror_titles on public.player_cosmetics;
create trigger player_cosmetics_mirror_titles after insert on public.player_cosmetics
  for each row execute function public.player_cosmetics_mirror_titles();

-- ── 5. loot_crates: one per (user, level); owner-only read (handoff §6.6) ──────────────────────────────────
create table if not exists public.loot_crates (
  crate_id           uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  earned_level       int  not null check (earned_level >= 1),
  state              text not null default 'sealed' check (state in ('sealed', 'opened')),
  reward_cosmetic_id text references public.cosmetic_catalog(cosmetic_id),
  roll_version       int,
  source_id          text,
  earned_at          timestamptz not null default now(),
  opened_at          timestamptz,
  unique (user_id, earned_level),
  check ((state = 'sealed' and reward_cosmetic_id is null and opened_at is null)
      or (state = 'opened' and reward_cosmetic_id is not null and opened_at is not null))
);
alter table public.loot_crates enable row level security;
drop policy if exists "read own loot_crates" on public.loot_crates;
create policy "read own loot_crates" on public.loot_crates for select to authenticated using (auth.uid() = user_id);
create index if not exists loot_crates_user_state on public.loot_crates (user_id, state, earned_level);
-- A second guard behind ownership's unique key: no two crates of one account ever hold the same reward.
create unique index if not exists loot_crates_one_reward on public.loot_crates (user_id, reward_cosmetic_id) where reward_cosmetic_id is not null;

-- A crate goes sealed -> opened ONCE and is then history (even for the service role).
create or replace function public.loot_crates_transition_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.state = 'opened' then raise exception 'crate_already_opened'; end if;
  if new.crate_id is distinct from old.crate_id or new.user_id is distinct from old.user_id
     or new.earned_level is distinct from old.earned_level or new.earned_at is distinct from old.earned_at then
    raise exception 'crate_identity_is_immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists loot_crates_transition_guard on public.loot_crates;
create trigger loot_crates_transition_guard before update on public.loot_crates
  for each row execute function public.loot_crates_transition_guard();

-- ── 6. cosmetic_loadouts: equipped cosmetics by slot + target (handoff §6.7; schema-ready, empty) ─────────
-- For the categories still switched off (announcer, hero/minion skins, attack, board, music). The TITLE keeps its
-- MVP home, `profiles.equipped_title_id` (public), written only by `equip_title` / the settlement.
create table if not exists public.cosmetic_loadouts (
  user_id     uuid not null references auth.users(id) on delete cascade,
  slot        text not null references public.cosmetic_categories(category),
  target_id   text not null default '',
  cosmetic_id text not null references public.cosmetic_catalog(cosmetic_id),
  updated_at  timestamptz not null default now(),
  primary key (user_id, slot, target_id)
);
alter table public.cosmetic_loadouts enable row level security;
drop policy if exists "read cosmetic_loadouts" on public.cosmetic_loadouts;
create policy "read cosmetic_loadouts" on public.cosmetic_loadouts for select using (true);

-- ── 7. The ledger records the crates each settlement created ──────────────────────────────────────────────
-- `crates_awarded` already exists (reserved by the MVP); `crate_ids` lets a duplicate answer return the same
-- crates. Adding a column rewrites no row, so the immutability trigger is untouched.
alter table public.progression_results add column if not exists crate_ids uuid[] not null default '{}';

-- ── 8. JSON shapes ────────────────────────────────────────────────────────────────────────────────────────
-- MUST match `ProgressionResult` in packages/progression/src/rules.ts key for key.
create or replace function public.progression_result_json(r public.progression_results)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'runId', r.run_id, 'mode', r.mode, 'rulesVersion', r.rules_version,
    'placement', r.placement, 'comeback', r.comeback,
    'xp', jsonb_build_object('base', r.base_xp, 'topFour', r.top_four_xp, 'firstPlace', r.first_place_xp, 'comeback', r.comeback_xp, 'total', r.total_xp),
    'before', jsonb_build_object('lifetimeXp', r.xp_before, 'level', r.level_before),
    'after',  jsonb_build_object('lifetimeXp', r.xp_after,  'level', r.level_after),
    'unlockedTitles', to_jsonb(r.unlocked_title_ids),
    'cratesAwarded', r.crates_awarded,
    'crateIds', to_jsonb(r.crate_ids),
    'revisionAfter', r.revision_after,
    'settledAt', r.settled_at
  );
$$;

-- MUST match `ProgressionProfile` in packages/progression/src/rules.ts key for key. Owned titles now come from
-- `player_cosmetics` (every title, level or crate), oldest first.
create or replace function public.progression_profile_json(p_user uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'accountXp', p.account_xp, 'accountLevel', p.account_level, 'revision', p.progression_revision,
    'equippedTitleId', p.equipped_title_id,
    'titles', coalesce((
      select jsonb_agg(o.cosmetic_id order by o.unlocked_at, o.cosmetic_id)
      from public.player_cosmetics o join public.cosmetic_catalog c on c.cosmetic_id = o.cosmetic_id
      where o.user_id = p.user_id and c.category = 'title'
    ), '[]'::jsonb)
  )
  from public.profiles p where p.user_id = p_user;
$$;

-- MUST match `CrateRow` in packages/progression/src/cosmetics.ts key for key.
create or replace function public.progression_crate_json(c public.loot_crates)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'crateId', c.crate_id, 'earnedLevel', c.earned_level, 'state', c.state,
    'rewardId', c.reward_cosmetic_id, 'earnedAt', c.earned_at, 'openedAt', c.opened_at
  );
$$;

-- ── 9. settle_progression: the MVP writer, now also creating crates ──────────────────────────────────────
-- Unchanged from 2026-09-27 except: the Alpha Tester grant writes `player_cosmetics` (mirrored into
-- `player_titles`), and step 9b creates one sealed crate per newly reached level (plus the Level 1 Welcome Crate
-- when this settlement enrolls the account), recorded on the ledger row. Crates are created even while
-- `crates_enabled` is false (banked).
create or replace function public.settle_progression(
  p_user uuid, p_mode text, p_run_id text, p_source_id bigint default null, p_comeback boolean default false,
  p_rules_version int default null, p_facts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of XP_RULES / CURVE in packages/progression/src/rules.ts — change all copies together)
  c_rules             constant int := 1;
  c_curve             constant int := 1;
  c_complete          constant int := 100;
  c_top_four          constant int := 40;
  c_first_place       constant int := 60;
  c_comeback          constant int := 25;
  c_comeback_streak   constant int := 4;
  c_practice_percent  constant int := 60;
  c_practice_flat     constant int := 60;
  c_tutorial          constant int := 250;
  c_tutorial_course   constant text := 'learn-ascent';
  c_tutorial_version  constant int := 1;
  c_alpha_title       constant text := 'alpha_tester';
  c_alpha_level       constant int := 2;
  c_rate_max          constant int := 30;
  c_rate_window       constant interval := interval '10 minutes';

  prof        public.profiles%rowtype;
  prev        public.progression_results%rowtype;
  v_epoch     timestamptz;
  v_recent    int;
  v_source_at timestamptz;
  v_source    text := null;
  v_placement int := null;
  v_comeback  boolean := false;
  v_seed      bigint;
  v_cfg       jsonb;
  v_record    jsonb;
  v_wins      int;
  v_losses    int;
  r_top int := 0; r_first int := 0; r_come int := 0; v_ranked_total int;
  v_base int := 0; v_top int := 0; v_first int := 0; v_come int := 0; v_total int;
  v_xp0 bigint; v_xp1 bigint; v_l0 int; v_l1 int;
  v_unlocked  text[] := '{}';
  v_equipped  text;
  v_rows      int;
  v_facts_ver int := null;
  v_enrolling boolean;
  v_crate_ids uuid[] := '{}';
begin
  -- 1. validate
  if p_mode is null or p_mode not in ('ranked', 'practice', 'tutorial') then raise exception 'bad_mode'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. serialize per user (every progression entry point takes the advisory lock first), then lock the row
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.progression_results where user_id = p_user and run_id = p_run_id and mode = p_mode;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
  end if;

  -- 4. the switch: nothing is awarded before the owner sets the epoch
  select epoch into v_epoch from public.progression_config where id = 1;
  if v_epoch is null then raise exception 'progression_disabled'; end if;

  -- 5. rate limit (technical only: a refused request is retried later and keeps its XP)
  select count(*) into v_recent from public.progression_results
    where user_id = p_user and settled_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 6. the SOURCE row: the placement comes from here, never from the request
  if p_mode = 'ranked' then
    select rr.placement, rr.seed, rr.created_at into v_placement, v_seed, v_source_at
      from public.rank_results rr where rr.user_id = p_user and rr.run_id = p_run_id;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_run_id;
    v_comeback := coalesce(p_comeback, false);
    if v_comeback and v_seed is not null then
      select h.wins, case when (h.entry->>'losses') ~ '^[0-9]+$' then (h.entry->>'losses')::int end
        into v_wins, v_losses
        from public.run_history h
        where h.user_id = p_user and h.mode = 'lobby' and h.entry->>'seed' = v_seed::text
        order by h.created_at desc limit 1;
      if found and (coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1) then v_comeback := false; end if;
    end if;
  elsif p_mode = 'practice' then
    if p_source_id is null or p_source_id < 1 then raise exception 'bad_source'; end if;
    if p_run_id is distinct from ('practice:' || p_source_id::text) then raise exception 'bad_run_id'; end if;
    select pg.placement, pg.config, pg.record, pg.created_at into v_placement, v_cfg, v_record, v_source_at
      from public.practice_games pg where pg.id = p_source_id and pg.user_id = p_user;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_source_id::text;
    -- No meaningful placement: an Unlimited Health game plays to the curtain and is never eliminated (and a row
    -- with no options recorded is treated the same way). It earns the flat XP, no placement or comeback bonus.
    if v_cfg is null or coalesce(v_cfg->>'health', 'unlimited') <> 'normal'
       or v_placement is null or v_placement < 1 or v_placement > 8 then
      v_placement := null;
    end if;
    v_comeback := coalesce(p_comeback, false) and v_placement is not null;
    if v_comeback and v_record is not null then
      v_wins := case when (v_record->>'wins') ~ '^[0-9]+$' then (v_record->>'wins')::int end;
      v_losses := case when (v_record->>'losses') ~ '^[0-9]+$' then (v_record->>'losses')::int end;
      if coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1 then v_comeback := false; end if;
    end if;
  else
    -- tutorial: one claim per account per course version (the ledger check above already caught a repeat)
    if p_run_id is distinct from (c_tutorial_course || ':v' || c_tutorial_version::text) then raise exception 'bad_run_id'; end if;
    insert into public.tutorial_progression_claims (user_id, course_id, course_version, xp_awarded)
      values (p_user, c_tutorial_course, c_tutorial_version, c_tutorial)
      on conflict (user_id, course_id, course_version) do nothing;
    v_source := c_tutorial_course || ':' || c_tutorial_version::text;
  end if;

  -- 7. XP (mirror of xpForSettlement)
  if p_mode = 'tutorial' then
    v_base := c_tutorial;
  elsif p_mode = 'practice' and v_placement is null then
    v_base := c_practice_flat;
  else
    r_top   := case when v_placement <= 4 then c_top_four else 0 end;
    r_first := case when v_placement = 1 then c_first_place else 0 end;
    r_come  := case when v_comeback then c_comeback else 0 end;
    if p_mode = 'ranked' then
      v_base := c_complete; v_top := r_top; v_first := r_first; v_come := r_come;
    else
      -- Practice: 60% of the equivalent ranked XP, summed then rounded; the remainder lands on the base.
      v_ranked_total := c_complete + r_top + r_first + r_come;
      v_top   := (r_top   * c_practice_percent + 50) / 100;
      v_first := (r_first * c_practice_percent + 50) / 100;
      v_come  := (r_come  * c_practice_percent + 50) / 100;
      v_base  := (v_ranked_total * c_practice_percent + 50) / 100 - v_top - v_first - v_come;
    end if;
  end if;
  v_total := v_base + v_top + v_first + v_come;

  -- 8. levels (lifetime XP; the level is derived)
  v_xp0 := coalesce(prof.account_xp, 0);
  v_xp1 := v_xp0 + v_total;
  v_l0 := public.progression_level_of(v_xp0);
  v_l1 := public.progression_level_of(v_xp1);

  -- 9. titles: Alpha Tester for EVERY account at Level 2 (owner 2026-09-27); equipped when nothing else is
  if v_l1 >= c_alpha_level then
    insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
      values (p_user, c_alpha_title, 'level', p_mode || ':' || p_run_id)
      on conflict (user_id, cosmetic_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_unlocked := array_append(v_unlocked, c_alpha_title); end if;
  end if;
  v_equipped := prof.equipped_title_id;
  if v_equipped is null and exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c_alpha_title) then
    v_equipped := c_alpha_title;
  end if;

  -- 9b. crates: one sealed crate per newly reached level; enrollment (the first settlement) also grants the
  -- Level 1 Welcome Crate. The unique (user, level) key makes this safe against the backfill and any retry.
  v_enrolling := prof.progression_enrolled_at is null;
  with ins as (
    insert into public.loot_crates (user_id, earned_level, source_id)
      select p_user, g.lvl, p_mode || ':' || p_run_id
      from generate_series(case when v_enrolling then 1 else v_l0 + 1 end, v_l1) as g(lvl)
      on conflict (user_id, earned_level) do nothing
      returning crate_id, earned_level
  )
  select coalesce(array_agg(ins.crate_id order by ins.earned_level), '{}') into v_crate_ids from ins;

  -- 10. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    account_xp = v_xp1, account_level = v_l1,
    progression_revision = prof.progression_revision + 1,
    progression_enrolled_at = coalesce(prof.progression_enrolled_at, now()),
    progression_curve_version = c_curve,
    equipped_title_id = v_equipped,
    updated_at = now()
  where user_id = p_user;

  if p_facts is not null and jsonb_typeof(p_facts) = 'object' and (p_facts->>'version') ~ '^[0-9]+$' then
    v_facts_ver := (p_facts->>'version')::int;
  end if;

  insert into public.progression_results (
    user_id, run_id, mode, source_id, rules_version, curve_version, facts_version, facts,
    placement, comeback, base_xp, top_four_xp, first_place_xp, comeback_xp, achievement_xp, total_xp,
    xp_before, xp_after, level_before, level_after, revision_before, revision_after,
    crates_awarded, crate_ids, achievement_ids, unlocked_title_ids
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, 0, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    coalesce(array_length(v_crate_ids, 1), 0), v_crate_ids, '{}', v_unlocked
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 10. The crate roll: what a crate can still give this player, with weights ────────────────────────────
-- Active, crate-sourced items in an ENABLED category that the player does not own. Weight = rarity weight x
-- category weight (mirror of crateWeightOf in packages/progression/src/cosmetics.ts).
create or replace function public.progression_crate_pool(p_user uuid)
returns table (pool_cosmetic_id text, pool_weight int)
language plpgsql
stable
set search_path = public
as $$
declare
  -- THE WEIGHTS (mirror of RARITY_WEIGHTS in packages/progression/src/cosmetics.ts; handoff §5.4)
  c_w_common    constant int := 55;
  c_w_rare      constant int := 30;
  c_w_epic      constant int := 12;
  c_w_legendary constant int := 3;
begin
  return query
    select c.cosmetic_id,
      (case c.rarity when 'common' then c_w_common when 'rare' then c_w_rare when 'epic' then c_w_epic when 'legendary' then c_w_legendary else 0 end) * k.weight
    from public.cosmetic_catalog c
    join public.cosmetic_categories k on k.category = c.category
    where c.active and k.enabled and c.acquisition_source = 'crate' and k.weight > 0
      and not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c.cosmetic_id)
    order by c.cosmetic_id collate "C";
end;
$$;

-- ── 11. open_crate: THE opening transaction (handoff §5.5). Service role only. ───────────────────────────
-- Per-user advisory lock (the same one the settlement takes, so two openings of DIFFERENT crates serialize and
-- can never pick the same item) → the crate row FOR UPDATE (an opened crate returns its committed reward as
-- `already_opened`) → the pool → ONE weighted draw over what remains (never a rarity first) → ownership insert
-- (unique key = the final guard) + the crate marked opened, together. An empty pool answers `pool_exhausted`
-- and writes nothing: the crate stays sealed until the catalog grows.
create or replace function public.open_crate(p_user uuid, p_crate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_roll_version constant int := 1;
  v_crate   public.loot_crates%rowtype;
  v_enabled boolean;
  v_total   bigint;
  v_roll    bigint;
  v_pick    text;
  v_rows    int;
  v_sealed  int;
begin
  if p_user is null or p_crate_id is null then raise exception 'bad_crate_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  select * into v_crate from public.loot_crates where crate_id = p_crate_id and user_id = p_user for update;
  if not found then raise exception 'crate_not_found'; end if;

  if v_crate.state = 'opened' then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'already_opened', 'crate', public.progression_crate_json(v_crate),
      'rewardId', v_crate.reward_cosmetic_id, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
  end if;

  select crates_enabled into v_enabled from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'crates_disabled'; end if;

  select coalesce(sum(pool_weight), 0) into v_total from public.progression_crate_pool(p_user);
  if v_total <= 0 then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'pool_exhausted', 'crate', public.progression_crate_json(v_crate),
      'rewardId', null, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
  end if;

  -- One draw in [0, total), walked over the pool in id order (mirror of pickCrateReward).
  v_roll := least(v_total - 1, floor(random() * v_total)::bigint);
  select p.pool_cosmetic_id into v_pick from (
    select pool_cosmetic_id, sum(pool_weight) over (order by pool_cosmetic_id collate "C" rows unbounded preceding) as acc
    from public.progression_crate_pool(p_user)
  ) p where p.acc > v_roll order by p.acc limit 1;
  if v_pick is null then raise exception 'duplicate_reward'; end if;

  insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
    values (p_user, v_pick, 'crate', p_crate_id::text)
    on conflict (user_id, cosmetic_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'duplicate_reward'; end if;

  update public.loot_crates set state = 'opened', reward_cosmetic_id = v_pick, roll_version = c_roll_version, opened_at = now()
    where crate_id = p_crate_id and state = 'sealed'
    returning * into v_crate;
  if not found then raise exception 'crate_not_found'; end if;

  -- A new title is worn at once only when the player wears none; the revision moves so mirrors adopt the change.
  update public.profiles set
    equipped_title_id = coalesce(equipped_title_id,
      (select c.cosmetic_id from public.cosmetic_catalog c where c.cosmetic_id = v_pick and c.category = 'title')),
    progression_revision = progression_revision + 1,
    updated_at = now()
  where user_id = p_user;

  select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
  return jsonb_build_object('status', 'opened', 'crate', public.progression_crate_json(v_crate),
    'rewardId', v_pick, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 12. equip_title: wear a title you OWN, or none. Service role only. ───────────────────────────────────
create or replace function public.equip_title(p_user uuid, p_title_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then raise exception 'not_owned'; end if;
  if p_title_id is not null and (length(p_title_id) < 1 or length(p_title_id) > 64) then raise exception 'bad_title_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));
  if p_title_id is not null and not exists (
    select 1 from public.player_cosmetics o join public.cosmetic_catalog c on c.cosmetic_id = o.cosmetic_id
    where o.user_id = p_user and o.cosmetic_id = p_title_id and c.category = 'title'
  ) then
    raise exception 'not_owned';
  end if;
  update public.profiles set equipped_title_id = p_title_id, progression_revision = progression_revision + 1, updated_at = now()
    where user_id = p_user;
  if not found then raise exception 'not_owned'; end if;
  return jsonb_build_object('status', 'equipped', 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 13. Grants: every writer is service role ONLY (the Edge Functions call them) ──────────────────────────
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;
revoke all on function public.progression_result_json(public.progression_results) from public, anon, authenticated;
grant execute on function public.progression_result_json(public.progression_results) to service_role;
revoke all on function public.progression_profile_json(uuid) from public, anon, authenticated;
grant execute on function public.progression_profile_json(uuid) to service_role;
revoke all on function public.progression_crate_json(public.loot_crates) from public, anon, authenticated;
grant execute on function public.progression_crate_json(public.loot_crates) to service_role;
revoke all on function public.progression_crate_pool(uuid) from public, anon, authenticated;
grant execute on function public.progression_crate_pool(uuid) to service_role;
revoke all on function public.open_crate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_crate(uuid, uuid) to service_role;
revoke all on function public.equip_title(uuid, text) from public, anon, authenticated;
grant execute on function public.equip_title(uuid, text) to service_role;
revoke all on function public.player_cosmetics_mirror_titles() from public, anon, authenticated;

-- ── 14. BACKFILL (idempotent: every statement is keyed, so a re-run changes nothing) ─────────────────────
-- a) Titles owned before this migration move into `player_cosmetics` (only ids the catalog knows).
insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id, unlocked_at)
  select t.user_id, t.title_id, t.source, t.source_id, t.unlocked_at
  from public.player_titles t join public.cosmetic_catalog c on c.cosmetic_id = t.title_id
  on conflict (user_id, cosmetic_id) do nothing;
-- b) Level-based titles for any account already past their level (Alpha Tester at Level 2).
insert into public.player_cosmetics (user_id, cosmetic_id, source)
  select p.user_id, c.cosmetic_id, 'level'
  from public.profiles p join public.cosmetic_catalog c on c.acquisition_source = 'level_milestone' and p.account_level >= c.milestone_level
  on conflict (user_id, cosmetic_id) do nothing;
-- c) Crates for accounts ALREADY enrolled: the Welcome Crate plus one per level already reached (Levels 1..L).
insert into public.loot_crates (user_id, earned_level, source_id)
  select p.user_id, g.lvl, 'backfill'
  from public.profiles p cross join lateral generate_series(1, p.account_level) as g(lvl)
  where p.progression_enrolled_at is not null
  on conflict (user_id, earned_level) do nothing;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: SKINS, the code-owned CATALOG SYNC, equip_cosmetic, the emergency switch  (2026-09-28)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-progression-crates.sql. Idempotent: re-running it
-- is always safe (it writes no catalog rows and no flags). The same block is appended to schema.sql; keep the two
-- identical. Owner runbook: docs/devlog/2026-09-28-skins-v1.md. This must be the LAST progression file run: if the
-- crates file is ever re-run, run this one again after it (the crates file redefines the pool and profile
-- functions without the switch below).
--
-- WHAT THIS IS (owner 2026-09-28: "let's use these 2 black belt brian skins as our first 2 skin concepts", "let's use
-- these 2 hero skins as our first 2 hero skin concepts", and "yeah let's do option 2 then to make it automated when i
-- add skins"; handoff §5.3, §5.6, §6.5 to §6.7, §13).
--  - CODE IS THE SOURCE OF TRUTH FOR THE CATALOG. `sync_cosmetic_catalog(catalog, hash)` upserts the categories and
--    items from packages/progression/src/cosmetics.ts (`catalogSyncPayload`); the `progression-inventory` Edge
--    Function calls it on the first request of every cold start. An item no longer in code is marked
--    `active = false`, never deleted (ownership references it). An unchanged catalog (same hash) is one read.
--    So adding a cosmetic is: art + a cosmetics.ts entry, `npm run progression:shared`, merge, deploy
--    progression-inventory. No SQL. (The skins arrive the same way: this file seeds none.)
--  - THE EMERGENCY SWITCH is a separate column, `admin_off`, on both tables. The sync NEVER writes it, so the
--    owner's one-line retire always wins over the next deploy. Effective state everywhere (crate pool, equip, the
--    loadout, the catalog clients read): item `active AND NOT admin_off`, category `enabled AND NOT admin_off`.
--  - EQUIP goes through `equip_cosmetic` (service role, called by progression-inventory): a skin the caller OWNS,
--    for the target it was made for, effectively live, into `cosmetic_loadouts` (slot + target_id). Null = Default.
--  - The profile JSON also carries every owned cosmetic (`cosmetics`) and the LIVE loadout (`loadout`).
--
-- THE ONE-LINERS (paste one; ownership and loadout rows are never deleted, so a restore puts everything back):
--   retire one item:     update public.cosmetic_catalog set admin_off = true where cosmetic_id = 'skin_blackbelt_2';
--   retire a category:   update public.cosmetic_categories set admin_off = true, updated_at = now() where category = 'minion_skin';
--   restore an item:     update public.cosmetic_catalog set admin_off = false where cosmetic_id = 'skin_blackbelt_2';
--   restore a category:  update public.cosmetic_categories set admin_off = false, updated_at = now() where category = 'minion_skin';
-- (A PERMANENT retire is `active: false` in cosmetics.ts + a deploy; the one-liners are for right now.)
--
-- THE RULES LIVE IN TWO PLACES that must agree: this file and packages/progression/src/cosmetics.ts. CI parses
-- this file (sqlParity.test.ts) and runs it, with the sync, in an embedded Postgres (skins.db.test.ts).

-- ── 1. The emergency switch + the last synced catalog ──────────────────────────────────────────────────────
alter table public.cosmetic_catalog    add column if not exists admin_off boolean not null default false;
alter table public.cosmetic_categories add column if not exists admin_off boolean not null default false;
alter table public.progression_config  add column if not exists catalog_hash text;
-- A (re-)run of this file forces the next cold start to sync again, whatever an earlier file left behind.
update public.progression_config set catalog_hash = null where id = 1;

-- ── 2. sync_cosmetic_catalog: write the code's catalog. Service role only. ───────────────────────────────
-- p_catalog = catalogSyncPayload() (camelCase keys, see cosmetics.ts); p_hash = catalogHash(p_catalog). One
-- transaction under one global lock. Never touches `admin_off`, never deletes a row.
create or replace function public.sync_cosmetic_catalog(p_catalog jsonb, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_cats    int;
  v_items   int;
  v_off     int;
  v_catoff  int;
begin
  if p_hash is null or length(p_hash) < 8 or length(p_hash) > 128 then raise exception 'bad_catalog'; end if;
  if p_catalog is null or jsonb_typeof(p_catalog->'categories') is distinct from 'array'
     or jsonb_typeof(p_catalog->'items') is distinct from 'array' then
    raise exception 'bad_catalog';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cosmetic_catalog_sync', 0));

  -- Unchanged since the last sync: nothing to do (the common case, one read).
  select catalog_hash into v_current from public.progression_config where id = 1;
  if v_current is not distinct from p_hash then
    return jsonb_build_object('status', 'unchanged', 'hash', p_hash);
  end if;

  -- Categories: weight, enabled, target from code. A category no longer in code is switched off.
  insert into public.cosmetic_categories (category, weight, enabled, target)
    select x->>'category', (x->>'weight')::int, (x->>'enabled')::boolean, x->>'target'
    from jsonb_array_elements(p_catalog->'categories') as x
    on conflict (category) do update set
      weight = excluded.weight, enabled = excluded.enabled, target = excluded.target, updated_at = now()
    where (public.cosmetic_categories.weight, public.cosmetic_categories.enabled, public.cosmetic_categories.target)
          is distinct from (excluded.weight, excluded.enabled, excluded.target);
  get diagnostics v_cats = row_count;
  update public.cosmetic_categories set enabled = false, updated_at = now()
    where enabled and category not in (select x->>'category' from jsonb_array_elements(p_catalog->'categories') as x);
  get diagnostics v_catoff = row_count;

  -- Items: every column from code (including `active`). An item no longer in code is marked inactive, never deleted.
  insert into public.cosmetic_catalog (cosmetic_id, category, rarity, acquisition_source, milestone_level, target_type, target_id, achievement_id, active)
    select x->>'cosmeticId', x->>'category', x->>'rarity', x->>'acquisitionSource', (x->>'milestoneLevel')::int,
           x->>'targetType', x->>'targetId', x->>'achievementId', (x->>'active')::boolean
    from jsonb_array_elements(p_catalog->'items') as x
    on conflict (cosmetic_id) do update set
      category = excluded.category, rarity = excluded.rarity, acquisition_source = excluded.acquisition_source,
      milestone_level = excluded.milestone_level, target_type = excluded.target_type, target_id = excluded.target_id,
      achievement_id = excluded.achievement_id, active = excluded.active
    where (public.cosmetic_catalog.category, public.cosmetic_catalog.rarity, public.cosmetic_catalog.acquisition_source,
           public.cosmetic_catalog.milestone_level, public.cosmetic_catalog.target_type, public.cosmetic_catalog.target_id,
           public.cosmetic_catalog.achievement_id, public.cosmetic_catalog.active)
          is distinct from (excluded.category, excluded.rarity, excluded.acquisition_source, excluded.milestone_level,
           excluded.target_type, excluded.target_id, excluded.achievement_id, excluded.active);
  get diagnostics v_items = row_count;
  update public.cosmetic_catalog set active = false
    where active and cosmetic_id not in (select x->>'cosmeticId' from jsonb_array_elements(p_catalog->'items') as x);
  get diagnostics v_off = row_count;

  update public.progression_config set catalog_hash = p_hash where id = 1;
  return jsonb_build_object('status', 'synced', 'hash', p_hash,
    'categoriesChanged', v_cats, 'categoriesSwitchedOff', v_catoff, 'itemsChanged', v_items, 'itemsDeactivated', v_off);
end;
$$;

-- ── 3. The crate pool honours the switch (mirror of eligibleCrateCosmetics + the server state) ────────────
create or replace function public.progression_crate_pool(p_user uuid)
returns table (pool_cosmetic_id text, pool_weight int)
language plpgsql
stable
set search_path = public
as $$
declare
  -- THE WEIGHTS (mirror of RARITY_WEIGHTS in packages/progression/src/cosmetics.ts; handoff §5.4)
  c_w_common    constant int := 55;
  c_w_rare      constant int := 30;
  c_w_epic      constant int := 12;
  c_w_legendary constant int := 3;
begin
  return query
    select c.cosmetic_id,
      (case c.rarity when 'common' then c_w_common when 'rare' then c_w_rare when 'epic' then c_w_epic when 'legendary' then c_w_legendary else 0 end) * k.weight
    from public.cosmetic_catalog c
    join public.cosmetic_categories k on k.category = c.category
    where c.active and not c.admin_off and k.enabled and not k.admin_off
      and c.acquisition_source = 'crate' and k.weight > 0
      and not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c.cosmetic_id)
    order by c.cosmetic_id collate "C";
end;
$$;

-- ── 4. The profile JSON: every owned cosmetic + the LIVE loadout ─────────────────────────────────────────
-- MUST match `ProgressionProfile` in packages/progression/src/rules.ts key for key. `titles` is unchanged (owned
-- titles, oldest first). `cosmetics` lists every owned item of any category (retired ones too: ownership is
-- never deleted; the client hides what is retired). `loadout` lists only equipped items that are effectively LIVE,
-- so a retired skin disappears from every profile at once and comes back, still equipped, when it is restored.
create or replace function public.progression_profile_json(p_user uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'accountXp', p.account_xp, 'accountLevel', p.account_level, 'revision', p.progression_revision,
    'equippedTitleId', p.equipped_title_id,
    'titles', coalesce((
      select jsonb_agg(o.cosmetic_id order by o.unlocked_at, o.cosmetic_id)
      from public.player_cosmetics o join public.cosmetic_catalog c on c.cosmetic_id = o.cosmetic_id
      where o.user_id = p.user_id and c.category = 'title'
    ), '[]'::jsonb),
    'cosmetics', coalesce((
      select jsonb_agg(o.cosmetic_id order by o.unlocked_at, o.cosmetic_id)
      from public.player_cosmetics o where o.user_id = p.user_id
    ), '[]'::jsonb),
    'loadout', coalesce((
      select jsonb_agg(jsonb_build_object('slot', l.slot, 'targetId', l.target_id, 'cosmeticId', l.cosmetic_id) order by l.slot, l.target_id)
      from public.cosmetic_loadouts l
      join public.cosmetic_catalog c on c.cosmetic_id = l.cosmetic_id
      join public.cosmetic_categories k on k.category = c.category
      where l.user_id = p.user_id and c.active and not c.admin_off and k.enabled and not k.admin_off
    ), '[]'::jsonb)
  )
  from public.profiles p where p.user_id = p_user;
$$;

-- ── 5. equip_cosmetic: wear a skin you OWN on its own target, or Default. Service role only. ─────────────
-- Checks, in order: the slot is a skin slot, the target id is well formed, the item exists in THIS slot's
-- category, is made for THIS target, is effectively live, and is owned. A null cosmetic removes the row
-- (Default; always allowed, even for a retired item). Same per-user advisory lock as every progression writer.
create or replace function public.equip_cosmetic(p_user uuid, p_slot text, p_target_id text, p_cosmetic_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.cosmetic_catalog%rowtype;
  v_live boolean;
begin
  if p_user is null then raise exception 'not_owned'; end if;
  if p_slot is null or p_slot not in ('hero_skin', 'minion_skin') then raise exception 'bad_slot'; end if;
  if p_target_id is null or p_target_id !~ '^[A-Za-z0-9_.:-]{1,64}$' then raise exception 'bad_target'; end if;
  if p_cosmetic_id is not null and p_cosmetic_id !~ '^[a-z0-9_]{1,64}$' then raise exception 'bad_cosmetic_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  if p_cosmetic_id is null then
    delete from public.cosmetic_loadouts where user_id = p_user and slot = p_slot and target_id = p_target_id;
  else
    select * into v_cat from public.cosmetic_catalog where cosmetic_id = p_cosmetic_id;
    if not found then raise exception 'bad_cosmetic_id'; end if;
    if v_cat.category <> p_slot
       or v_cat.target_type is distinct from (case p_slot when 'hero_skin' then 'hero' else 'card' end)
       or v_cat.target_id is distinct from p_target_id then
      raise exception 'wrong_target';
    end if;
    select k.enabled and not k.admin_off into v_live from public.cosmetic_categories k where k.category = v_cat.category;
    if not v_cat.active or v_cat.admin_off or not coalesce(v_live, false) then raise exception 'not_equippable'; end if;
    if not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = p_cosmetic_id) then
      raise exception 'not_owned';
    end if;
    insert into public.cosmetic_loadouts (user_id, slot, target_id, cosmetic_id, updated_at)
      values (p_user, p_slot, p_target_id, p_cosmetic_id, now())
      on conflict (user_id, slot, target_id) do update set cosmetic_id = excluded.cosmetic_id, updated_at = now();
  end if;

  update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = p_user;
  if not found then raise exception 'not_owned'; end if;
  return jsonb_build_object('status', 'equipped', 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 6. Grants: every writer is service role ONLY (the Edge Function calls them) ──────────────────────────
revoke all on function public.sync_cosmetic_catalog(jsonb, text) from public, anon, authenticated;
grant execute on function public.sync_cosmetic_catalog(jsonb, text) to service_role;
revoke all on function public.equip_cosmetic(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.equip_cosmetic(uuid, text, text, text) to service_role;
revoke all on function public.progression_profile_json(uuid) from public, anon, authenticated;
grant execute on function public.progression_profile_json(uuid) to service_role;
revoke all on function public.progression_crate_pool(uuid) from public, anon, authenticated;
grant execute on function public.progression_crate_pool(uuid) to service_role;

-- ── 7. Snapshot side: nothing to migrate ────────────────────────────────────────────────────────────────
-- The skins a run wore travel INSIDE the payloads the client already writes (the board snapshot jsonb, the run
-- history entry, the practice record), as an additive `cosmetics` field. Older rows have none and render default
-- art. No table, column or policy changes here.

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACHIEVEMENTS, batch 1: XP rewards only  (2026-09-28)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-progression-skins.sql. Idempotent (safe to re-run:
-- it seeds no achievement rows, writes no flag and never moves the epoch). The same block is appended to
-- schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-09-28-achievements-b1.md (run this, deploy
-- `submit-progression`, THEN set the achievements epoch). This file REPLACES `settle_progression` and
-- `progression_result_json`: if the crates file is ever re-run, run the skins file and then this one again after it.
--
-- WHAT THIS IS (owner 2026-09-28: "we'll need an achievements tab in career next to practice. most should show,
-- with their reward, but the hidden ones will be blurred or say "Hidden" and we'll come up with fun rewards for
-- them. let's just get the normal xp related achievements in for now though.")
--  - THE CATALOG IS CODE. `achievement_catalog` is written by `sync_achievement_catalog` from
--    packages/progression/src/achievements.ts (`achievementCatalogPayload`); the `submit-progression` Edge Function
--    calls it on the first request of every cold start. A definition no longer in code is marked `active = false`,
--    never deleted. The owner's emergency switch is `admin_off` (the sync never writes it):
--      retire one:  update public.achievement_catalog set admin_off = true where achievement_id = 's2.kobold.golem_40';
--      restore it:  update public.achievement_catalog set admin_off = false where achievement_id = 's2.kobold.golem_40';
--  - EVALUATION IS PART OF THE SETTLEMENT. `settle_progression` evaluates every live catalog row against the game it
--    is settling, inside the same transaction and under the same per-user lock as the match XP: progress rows move,
--    a completion is written at most once per account (its primary key), its XP is added to the SAME ledger row
--    (`achievement_xp`, `achievement_ids`) and to the account. A duplicate settlement returns the original result
--    and evaluates nothing again. The TS mirror is `evaluateAchievements` (achievements.db.test.ts runs both).
--  - TRUST (handoff §7.4). Server metrics (the game, placement, the accepted comeback, the rank result, the Career
--    best, distinct heroes, completions) come from the database's own rows. Run metrics come from the client's
--    fact document (V2 `metrics`, sanitized by the Edge Function): ordinary trust, the facts are stored on the
--    ledger row for audit. A client-sent key that names a server metric is overwritten here. No prestige (replay
--    verified) achievement exists yet; a catalog row with trust 'P' is never evaluated.
--  - WHICH GAMES COUNT (assumed defaults, the owner can flip them): `any` achievements take Ranked and a standard
--    Practice (Normal Health AND a turn timer); `ranked` only Ranked; `tutorial` only the Learn Ascent graduation;
--    `account` every settlement. Set 2 feats need a Set 2 run. Rank achievements read the account's Career-best
--    division (so the first settlement after the switch pays every rank already reached).
--  - NO RETROACTIVE COUNTING. Nothing is evaluated until the owner sets `progression_config.achievements_epoch`
--    (section 9 is the switch), and a game whose source row is older than it is never evaluated (it still earns its
--    match XP). The client probes the epoch: while it is null there is no Achievements tab and the client keeps
--    sending V1 facts.
--
-- THE RULES LIVE IN TWO PLACES that must agree: this file and packages/progression/src/achievements.ts. CI parses
-- this file (sqlParity.test.ts) and runs it in an embedded Postgres (achievements.db.test.ts).

-- ── 1. The switch + the last synced catalog ─────────────────────────────────────────────────────────────────
alter table public.progression_config add column if not exists achievements_epoch timestamptz;
alter table public.progression_config add column if not exists achievements_hash  text;
-- A (re-)run of this file forces the next cold start to sync the catalog again.
update public.progression_config set achievements_hash = null where id = 1;

-- ── 2. achievement_catalog: one row per definition (public read; written only by the sync) ──────────────────
create table if not exists public.achievement_catalog (
  achievement_id text primary key,
  version        int  not null default 1,
  category       text not null,
  mode           text not null check (mode in ('any', 'ranked', 'tutorial', 'account')),
  set_id         text,
  hero_id        text,
  placement_max  int  check (placement_max is null or placement_max between 1 and 8),
  metric         text not null,
  agg            text not null check (agg in ('max', 'sum')),
  target         bigint not null check (target > 0),
  xp             int  not null check (xp >= 0),
  title_id       text,
  hidden         boolean not null default false,
  trust          text not null default 'O' check (trust in ('S', 'O', 'P')),
  active         boolean not null default true,
  admin_off      boolean not null default false,
  updated_at     timestamptz not null default now()
);
alter table public.achievement_catalog enable row level security;
drop policy if exists "read achievement_catalog" on public.achievement_catalog;
create policy "read achievement_catalog" on public.achievement_catalog for select using (true);

-- ── 3. achievement_progress: the account's progress per achievement (OWNER-ONLY read) ───────────────────────
-- In-progress values stay private (handoff §9.2 default); completions below are public.
create table if not exists public.achievement_progress (
  user_id            uuid not null references auth.users(id) on delete cascade,
  achievement_id     text not null,
  definition_version int  not null default 1,
  progress           bigint not null default 0,
  completed_at       timestamptz,
  completion_run_id  text,
  updated_at         timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.achievement_progress enable row level security;
drop policy if exists "read own achievement_progress" on public.achievement_progress;
create policy "read own achievement_progress" on public.achievement_progress for select to authenticated using (auth.uid() = user_id);

-- ── 4. achievement_completions: one row per completed achievement, ever (PUBLIC read) ───────────────────────
create table if not exists public.achievement_completions (
  user_id        uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null,
  run_id         text,
  mode           text,
  xp_awarded     int  not null,
  title_id       text,
  completed_at   timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.achievement_completions enable row level security;
drop policy if exists "read achievement_completions" on public.achievement_completions;
create policy "read achievement_completions" on public.achievement_completions for select using (true);
create index if not exists achievement_completions_user_time on public.achievement_completions (user_id, completed_at desc);

-- ── 5. achievement_hero_stats: counted games per hero, for "N different heroes" (owner-only read) ───────────
create table if not exists public.achievement_hero_stats (
  user_id    uuid not null references auth.users(id) on delete cascade,
  hero_id    text not null,
  games      int  not null default 0,
  firsts     int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, hero_id)
);
alter table public.achievement_hero_stats enable row level security;
drop policy if exists "read own achievement_hero_stats" on public.achievement_hero_stats;
create policy "read own achievement_hero_stats" on public.achievement_hero_stats for select to authenticated using (auth.uid() = user_id);

-- ── 6. sync_achievement_catalog: write the code's catalog. Service role only. ───────────────────────────────
-- p_catalog = achievementCatalogPayload() (camelCase keys); p_hash = achievementCatalogHash(p_catalog). Never
-- touches `admin_off`, never deletes a row.
create or replace function public.sync_achievement_catalog(p_catalog jsonb, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
  v_items   int;
  v_off     int;
begin
  if p_hash is null or length(p_hash) < 8 or length(p_hash) > 128 then raise exception 'bad_catalog'; end if;
  if p_catalog is null or jsonb_typeof(p_catalog->'items') is distinct from 'array' then raise exception 'bad_catalog'; end if;
  perform pg_advisory_xact_lock(hashtextextended('achievement_catalog_sync', 0));

  select achievements_hash into v_current from public.progression_config where id = 1;
  if v_current is not distinct from p_hash then
    return jsonb_build_object('status', 'unchanged', 'hash', p_hash);
  end if;

  insert into public.achievement_catalog (achievement_id, version, category, mode, set_id, hero_id, placement_max, metric, agg, target, xp, title_id, hidden, trust, active)
    select x->>'achievementId', (x->>'version')::int, x->>'category', x->>'mode', x->>'setId', x->>'heroId', (x->>'placementMax')::int,
           x->>'metric', x->>'agg', (x->>'target')::bigint, (x->>'xp')::int, x->>'titleId', (x->>'hidden')::boolean, x->>'trust', (x->>'active')::boolean
    from jsonb_array_elements(p_catalog->'items') as x
    on conflict (achievement_id) do update set
      version = excluded.version, category = excluded.category, mode = excluded.mode, set_id = excluded.set_id, hero_id = excluded.hero_id,
      placement_max = excluded.placement_max, metric = excluded.metric, agg = excluded.agg, target = excluded.target, xp = excluded.xp,
      title_id = excluded.title_id, hidden = excluded.hidden, trust = excluded.trust, active = excluded.active, updated_at = now()
    where (public.achievement_catalog.version, public.achievement_catalog.category, public.achievement_catalog.mode, public.achievement_catalog.set_id,
           public.achievement_catalog.hero_id, public.achievement_catalog.placement_max, public.achievement_catalog.metric, public.achievement_catalog.agg,
           public.achievement_catalog.target, public.achievement_catalog.xp, public.achievement_catalog.title_id, public.achievement_catalog.hidden,
           public.achievement_catalog.trust, public.achievement_catalog.active)
          is distinct from (excluded.version, excluded.category, excluded.mode, excluded.set_id, excluded.hero_id, excluded.placement_max, excluded.metric,
           excluded.agg, excluded.target, excluded.xp, excluded.title_id, excluded.hidden, excluded.trust, excluded.active);
  get diagnostics v_items = row_count;
  update public.achievement_catalog set active = false, updated_at = now()
    where active and achievement_id not in (select x->>'achievementId' from jsonb_array_elements(p_catalog->'items') as x);
  get diagnostics v_off = row_count;

  update public.progression_config set achievements_hash = p_hash where id = 1;
  return jsonb_build_object('status', 'synced', 'hash', p_hash, 'itemsChanged', v_items, 'itemsDeactivated', v_off);
end;
$$;

-- ── 7. The result JSON carries the achievements ─────────────────────────────────────────────────────────────
-- MUST match `ProgressionResult` in packages/progression/src/rules.ts key for key. `achievementXp` is paid ON TOP of
-- `xp.total`: after.lifetimeXp = before.lifetimeXp + xp.total + achievementXp.
create or replace function public.progression_result_json(r public.progression_results)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'runId', r.run_id, 'mode', r.mode, 'rulesVersion', r.rules_version,
    'placement', r.placement, 'comeback', r.comeback,
    'xp', jsonb_build_object('base', r.base_xp, 'topFour', r.top_four_xp, 'firstPlace', r.first_place_xp, 'comeback', r.comeback_xp, 'total', r.total_xp),
    'before', jsonb_build_object('lifetimeXp', r.xp_before, 'level', r.level_before),
    'after',  jsonb_build_object('lifetimeXp', r.xp_after,  'level', r.level_after),
    'unlockedTitles', to_jsonb(r.unlocked_title_ids),
    'cratesAwarded', r.crates_awarded,
    'crateIds', to_jsonb(r.crate_ids),
    'achievements', to_jsonb(r.achievement_ids),
    'achievementXp', r.achievement_xp,
    'revisionAfter', r.revision_after,
    'settledAt', r.settled_at
  );
$$;

-- ── 8. settle_progression: the crates writer, now also evaluating achievements ───────────────────────────────
-- Unchanged from 2026-09-28 (crates) except: the source reads carry the rank result's promotion / demotion /
-- strength and the practice row's hero, and step 7b evaluates the achievement catalog before the levels are
-- crossed, so achievement XP levels the account and earns crates in the same settlement.
create or replace function public.settle_progression(
  p_user uuid, p_mode text, p_run_id text, p_source_id bigint default null, p_comeback boolean default false,
  p_rules_version int default null, p_facts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of XP_RULES / CURVE in packages/progression/src/rules.ts — change all copies together)
  c_rules             constant int := 1;
  c_curve             constant int := 1;
  c_complete          constant int := 100;
  c_top_four          constant int := 40;
  c_first_place       constant int := 60;
  c_comeback          constant int := 25;
  c_comeback_streak   constant int := 4;
  c_practice_percent  constant int := 60;
  c_practice_flat     constant int := 60;
  c_tutorial          constant int := 250;
  c_tutorial_course   constant text := 'learn-ascent';
  c_tutorial_version  constant int := 1;
  c_alpha_title       constant text := 'alpha_tester';
  c_alpha_level       constant int := 2;
  c_rate_max          constant int := 30;
  c_rate_window       constant interval := interval '10 minutes';
  -- ACHIEVEMENTS (mirror of packages/progression/src/achievements.ts)
  c_meta_metric       constant text := 'achievementsCompleted';
  c_brutal_strength   constant int := 70;
  c_ascendant_div     constant int := 15;
  c_metric_max        constant bigint := 1000000000;

  prof        public.profiles%rowtype;
  prev        public.progression_results%rowtype;
  v_epoch     timestamptz;
  v_recent    int;
  v_source_at timestamptz;
  v_source    text := null;
  v_placement int := null;
  v_comeback  boolean := false;
  v_seed      bigint;
  v_cfg       jsonb;
  v_record    jsonb;
  v_wins      int;
  v_losses    int;
  r_top int := 0; r_first int := 0; r_come int := 0; v_ranked_total int;
  v_base int := 0; v_top int := 0; v_first int := 0; v_come int := 0; v_total int;
  v_xp0 bigint; v_xp1 bigint; v_l0 int; v_l1 int;
  v_unlocked  text[] := '{}';
  v_equipped  text;
  v_rows      int;
  v_facts_ver int := null;
  v_enrolling boolean;
  v_crate_ids uuid[] := '{}';
  -- achievements
  v_ach_epoch  timestamptz;
  v_promoted   boolean := false;
  v_div_before int := null;
  v_demo_game  boolean := false;
  v_demoted    boolean := false;
  v_strength   int := null;
  v_hero       text := null;
  v_set        text := null;
  v_run_ok     boolean := false;
  v_metrics    jsonb := '{}';
  v_first_streak int := 0;
  v_top_streak int := 0;
  v_heroes_played int := 0;
  v_heroes_won int := 0;
  v_done_count int := 0;
  d            public.achievement_catalog%rowtype;
  v_val        bigint;
  v_old        bigint;
  v_done       boolean;
  v_new        bigint;
  v_ach_ids    text[] := '{}';
  v_ach_xp     int := 0;
begin
  -- 1. validate
  if p_mode is null or p_mode not in ('ranked', 'practice', 'tutorial') then raise exception 'bad_mode'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. serialize per user (every progression entry point takes the advisory lock first), then lock the row
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.progression_results where user_id = p_user and run_id = p_run_id and mode = p_mode;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
  end if;

  -- 4. the switch: nothing is awarded before the owner sets the epoch
  select epoch, achievements_epoch into v_epoch, v_ach_epoch from public.progression_config where id = 1;
  if v_epoch is null then raise exception 'progression_disabled'; end if;

  -- 5. rate limit (technical only: a refused request is retried later and keeps its XP)
  select count(*) into v_recent from public.progression_results
    where user_id = p_user and settled_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 6. the SOURCE row: the placement comes from here, never from the request
  if p_mode = 'ranked' then
    select rr.placement, rr.seed, rr.created_at, rr.promoted, rr.division_before, rr.was_demotion_game, rr.demoted, rr.lobby_strength
      into v_placement, v_seed, v_source_at, v_promoted, v_div_before, v_demo_game, v_demoted, v_strength
      from public.rank_results rr where rr.user_id = p_user and rr.run_id = p_run_id;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_run_id;
    v_comeback := coalesce(p_comeback, false);
    if v_comeback and v_seed is not null then
      select h.wins, case when (h.entry->>'losses') ~ '^[0-9]+$' then (h.entry->>'losses')::int end
        into v_wins, v_losses
        from public.run_history h
        where h.user_id = p_user and h.mode = 'lobby' and h.entry->>'seed' = v_seed::text
        order by h.created_at desc limit 1;
      if found and (coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1) then v_comeback := false; end if;
    end if;
  elsif p_mode = 'practice' then
    if p_source_id is null or p_source_id < 1 then raise exception 'bad_source'; end if;
    if p_run_id is distinct from ('practice:' || p_source_id::text) then raise exception 'bad_run_id'; end if;
    select pg.placement, pg.config, pg.record, pg.created_at, pg.hero_id into v_placement, v_cfg, v_record, v_source_at, v_hero
      from public.practice_games pg where pg.id = p_source_id and pg.user_id = p_user;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_source_id::text;
    -- No meaningful placement: an Unlimited Health game plays to the curtain and is never eliminated (and a row
    -- with no options recorded is treated the same way). It earns the flat XP, no placement or comeback bonus.
    if v_cfg is null or coalesce(v_cfg->>'health', 'unlimited') <> 'normal'
       or v_placement is null or v_placement < 1 or v_placement > 8 then
      v_placement := null;
    end if;
    v_comeback := coalesce(p_comeback, false) and v_placement is not null;
    if v_comeback and v_record is not null then
      v_wins := case when (v_record->>'wins') ~ '^[0-9]+$' then (v_record->>'wins')::int end;
      v_losses := case when (v_record->>'losses') ~ '^[0-9]+$' then (v_record->>'losses')::int end;
      if coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1 then v_comeback := false; end if;
    end if;
  else
    -- tutorial: one claim per account per course version (the ledger check above already caught a repeat)
    if p_run_id is distinct from (c_tutorial_course || ':v' || c_tutorial_version::text) then raise exception 'bad_run_id'; end if;
    insert into public.tutorial_progression_claims (user_id, course_id, course_version, xp_awarded)
      values (p_user, c_tutorial_course, c_tutorial_version, c_tutorial)
      on conflict (user_id, course_id, course_version) do nothing;
    v_source := c_tutorial_course || ':' || c_tutorial_version::text;
  end if;

  -- 7. XP (mirror of xpForSettlement)
  if p_mode = 'tutorial' then
    v_base := c_tutorial;
  elsif p_mode = 'practice' and v_placement is null then
    v_base := c_practice_flat;
  else
    r_top   := case when v_placement <= 4 then c_top_four else 0 end;
    r_first := case when v_placement = 1 then c_first_place else 0 end;
    r_come  := case when v_comeback then c_comeback else 0 end;
    if p_mode = 'ranked' then
      v_base := c_complete; v_top := r_top; v_first := r_first; v_come := r_come;
    else
      -- Practice: 60% of the equivalent ranked XP, summed then rounded; the remainder lands on the base.
      v_ranked_total := c_complete + r_top + r_first + r_come;
      v_top   := (r_top   * c_practice_percent + 50) / 100;
      v_first := (r_first * c_practice_percent + 50) / 100;
      v_come  := (r_come  * c_practice_percent + 50) / 100;
      v_base  := (v_ranked_total * c_practice_percent + 50) / 100 - v_top - v_first - v_come;
    end if;
  end if;
  v_total := v_base + v_top + v_first + v_come;

  if p_facts is not null and jsonb_typeof(p_facts) = 'object' and (p_facts->>'version') ~ '^[0-9]+$' then
    v_facts_ver := (p_facts->>'version')::int;
  end if;

  -- 7b. ACHIEVEMENTS (mirror of evaluateAchievements in packages/progression/src/achievements.ts). Only once the
  -- owner has set the achievements epoch, and only for a game whose source row is not older than it.
  if v_ach_epoch is not null and coalesce(v_source_at, now()) >= v_ach_epoch then
    -- The `any` gate: Ranked, or a standard Practice (Normal Health, so a real placement, AND a turn timer).
    v_run_ok := p_mode = 'ranked'
      or (p_mode = 'practice' and v_placement is not null and coalesce(v_cfg->>'timeMult', '') ~ '^[1-9][0-9]*$');
    if p_mode = 'ranked' then v_hero := p_facts->>'heroId'; end if;
    if v_hero is not null and v_hero !~ '^[A-Za-z0-9_.-]{1,64}$' then v_hero := null; end if;
    v_set := p_facts->>'setId';
    if v_set is not null and v_set !~ '^[A-Za-z0-9_.-]{1,32}$' then v_set := null; end if;

    -- Distinct heroes: this game counts toward its hero when it is an eligible game.
    if v_run_ok and v_hero is not null then
      insert into public.achievement_hero_stats (user_id, hero_id, games, firsts)
        values (p_user, v_hero, 1, case when p_mode = 'ranked' and v_placement = 1 then 1 else 0 end)
        on conflict (user_id, hero_id) do update set
          games = public.achievement_hero_stats.games + 1,
          firsts = public.achievement_hero_stats.firsts + excluded.firsts,
          updated_at = now();
    end if;
    select count(*) filter (where s.games > 0), count(*) filter (where s.firsts > 0) into v_heroes_played, v_heroes_won
      from public.achievement_hero_stats s where s.user_id = p_user;

    -- Ranked streaks, over Ranked games since the achievements epoch, ending with this one.
    if p_mode = 'ranked' then
      with r as (
        select rr.placement, row_number() over (order by rr.created_at desc, rr.run_id desc) as rn
        from public.rank_results rr
        where rr.user_id = p_user and rr.created_at >= v_ach_epoch and rr.created_at <= v_source_at
      )
      select coalesce((select min(rn) from r where placement <> 1) - 1, (select count(*) from r)),
             coalesce((select min(rn) from r where placement > 4) - 1, (select count(*) from r))
        into v_first_streak, v_top_streak;
    end if;

    -- The metrics: the client's run metrics (V2), overwritten by every server metric (a client can never name one).
    if coalesce(v_facts_ver, 0) >= 2 and jsonb_typeof(p_facts->'metrics') = 'object' then v_metrics := p_facts->'metrics'; end if;
    v_metrics := v_metrics || jsonb_build_object(
      'game', 1,
      'comeback', case when v_comeback then 1 else 0 end,
      'highestDivision', coalesce(prof.rank_highest_division, 0),
      'promoted', case when p_mode = 'ranked' and v_promoted then 1 else 0 end,
      'ascendantFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_div_before, 0) >= c_ascendant_div then 1 else 0 end,
      'demotionEscape', case when p_mode = 'ranked' and v_demo_game and not v_demoted and v_placement <= 4 then 1 else 0 end,
      'brutalFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_strength, 0) >= c_brutal_strength then 1 else 0 end,
      'firstStreak', v_first_streak,
      'topFourStreak', v_top_streak,
      'heroesPlayed', v_heroes_played,
      'heroesWon', v_heroes_won,
      c_meta_metric, 0
    );

    -- Pass 1: every live, non-prestige, non-meta definition, in id order. Pass 2: the meta family, by target.
    select count(*) into v_done_count from public.achievement_completions c where c.user_id = p_user;
    for d in
      select * from public.achievement_catalog c
      where c.active and not c.admin_off and c.trust <> 'P'
      order by (c.metric = c_meta_metric), case when c.metric = c_meta_metric then c.target else 0 end, c.achievement_id collate "C"
    loop
      continue when d.mode = 'ranked' and p_mode <> 'ranked';
      continue when d.mode = 'tutorial' and p_mode <> 'tutorial';
      continue when d.mode = 'any' and not v_run_ok;
      continue when d.set_id is not null and v_set is distinct from d.set_id;
      continue when d.hero_id is not null and v_hero is distinct from d.hero_id;
      continue when d.placement_max is not null and (v_placement is null or v_placement > d.placement_max);
      if d.metric = c_meta_metric then
        v_val := v_done_count;
      elsif jsonb_typeof(v_metrics->d.metric) = 'number' then
        v_val := least(c_metric_max, greatest(0, floor((v_metrics->>d.metric)::numeric)))::bigint;
      else
        v_val := 0;
      end if;
      continue when v_val <= 0;
      select ap.progress, ap.completed_at is not null into v_old, v_done
        from public.achievement_progress ap where ap.user_id = p_user and ap.achievement_id = d.achievement_id;
      if not found then v_old := 0; v_done := false; end if;
      continue when v_done;
      v_new := case when d.agg = 'sum' then v_old + v_val else greatest(v_old, v_val) end;
      continue when v_new = v_old and v_new < d.target;
      insert into public.achievement_progress (user_id, achievement_id, definition_version, progress, completed_at, completion_run_id, updated_at)
        values (p_user, d.achievement_id, d.version, v_new,
                case when v_new >= d.target then now() end, case when v_new >= d.target then p_run_id end, now())
        on conflict (user_id, achievement_id) do update set
          definition_version = excluded.definition_version, progress = excluded.progress,
          completed_at = excluded.completed_at, completion_run_id = excluded.completion_run_id, updated_at = now();
      if v_new >= d.target then
        insert into public.achievement_completions (user_id, achievement_id, run_id, mode, xp_awarded, title_id)
          values (p_user, d.achievement_id, p_run_id, p_mode, d.xp, d.title_id)
          on conflict (user_id, achievement_id) do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          v_ach_ids := array_append(v_ach_ids, d.achievement_id);
          v_ach_xp := v_ach_xp + d.xp;
          v_done_count := v_done_count + 1;
        end if;
      end if;
    end loop;
  end if;

  -- 8. levels (lifetime XP; the level is derived). Achievement XP counts toward the level and its crates.
  v_xp0 := coalesce(prof.account_xp, 0);
  v_xp1 := v_xp0 + v_total + v_ach_xp;
  v_l0 := public.progression_level_of(v_xp0);
  v_l1 := public.progression_level_of(v_xp1);

  -- 9. titles: Alpha Tester for EVERY account at Level 2 (owner 2026-09-27); equipped when nothing else is
  if v_l1 >= c_alpha_level then
    insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
      values (p_user, c_alpha_title, 'level', p_mode || ':' || p_run_id)
      on conflict (user_id, cosmetic_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_unlocked := array_append(v_unlocked, c_alpha_title); end if;
  end if;
  v_equipped := prof.equipped_title_id;
  if v_equipped is null and exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c_alpha_title) then
    v_equipped := c_alpha_title;
  end if;

  -- 9b. crates: one sealed crate per newly reached level; enrollment (the first settlement) also grants the
  -- Level 1 Welcome Crate. The unique (user, level) key makes this safe against the backfill and any retry.
  v_enrolling := prof.progression_enrolled_at is null;
  with ins as (
    insert into public.loot_crates (user_id, earned_level, source_id)
      select p_user, g.lvl, p_mode || ':' || p_run_id
      from generate_series(case when v_enrolling then 1 else v_l0 + 1 end, v_l1) as g(lvl)
      on conflict (user_id, earned_level) do nothing
      returning crate_id, earned_level
  )
  select coalesce(array_agg(ins.crate_id order by ins.earned_level), '{}') into v_crate_ids from ins;

  -- 10. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    account_xp = v_xp1, account_level = v_l1,
    progression_revision = prof.progression_revision + 1,
    progression_enrolled_at = coalesce(prof.progression_enrolled_at, now()),
    progression_curve_version = c_curve,
    equipped_title_id = v_equipped,
    updated_at = now()
  where user_id = p_user;

  insert into public.progression_results (
    user_id, run_id, mode, source_id, rules_version, curve_version, facts_version, facts,
    placement, comeback, base_xp, top_four_xp, first_place_xp, comeback_xp, achievement_xp, total_xp,
    xp_before, xp_after, level_before, level_after, revision_before, revision_after,
    crates_awarded, crate_ids, achievement_ids, unlocked_title_ids
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, v_ach_xp, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    coalesce(array_length(v_crate_ids, 1), 0), v_crate_ids, v_ach_ids, v_unlocked
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 9. Grants: every writer is service role ONLY (the Edge Function calls them) ─────────────────────────────
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;
revoke all on function public.progression_result_json(public.progression_results) from public, anon, authenticated;
grant execute on function public.progression_result_json(public.progression_results) to service_role;
revoke all on function public.sync_achievement_catalog(jsonb, text) from public, anon, authenticated;
grant execute on function public.sync_achievement_catalog(jsonb, text) to service_role;

-- ── 10. THE SWITCH (run by hand, ONCE, after `submit-progression` is deployed) ──────────────────────────────
-- Commented out so a re-run of this file can never move the epoch. Games finished before this moment are never
-- evaluated for achievements (no retroactive counting, owner 2026-09-28); they still earn their match XP.
--
-- update public.progression_config set achievements_epoch = now(), updated_at = now() where id = 1 and achievements_epoch is null;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: HERO ATTACKS, equip_cosmetic accepts the account-wide `hero_attack` slot  (2026-09-28)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-achievements.sql (the last file before it). Idempotent: it only
-- REPLACES `equip_cosmetic` (and re-grants it), so re-running it is always safe; it writes no rows. The same block
-- is appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-09-28-hero-attack-blast.md.
-- If the skins file is ever re-run, run this one again after it (the skins file redefines equip_cosmetic without
-- the hero attack slot).
--
-- WHAT THIS IS (owner 2026-09-28: "the new blast attack is going to be a cosmetic unlock, not a new default").
--  - The `hero_attack` category and its first item (`attack_blast`) arrive through the code-owned catalog sync like
--    every other cosmetic (packages/progression/src/cosmetics.ts, deploy progression-inventory). No catalog SQL.
--  - A hero attack is ACCOUNT-WIDE (category target `global`): one row in `cosmetic_loadouts` with target_id ''.
--    `equip_cosmetic(user, 'hero_attack', '', id)` wears one the caller OWNS; a null id takes it off (Classic).
--    The skin slots behave exactly as before.

create or replace function public.equip_cosmetic(p_user uuid, p_slot text, p_target_id text, p_cosmetic_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.cosmetic_catalog%rowtype;
  v_live boolean;
begin
  if p_user is null then raise exception 'not_owned'; end if;
  if p_slot is null or p_slot not in ('hero_skin', 'minion_skin', 'hero_attack') then raise exception 'bad_slot'; end if;
  -- The global slot has exactly one target, ''. A skin slot names its hero or card.
  if p_slot = 'hero_attack' then
    if p_target_id is distinct from '' then raise exception 'bad_target'; end if;
  elsif p_target_id is null or p_target_id !~ '^[A-Za-z0-9_.:-]{1,64}$' then
    raise exception 'bad_target';
  end if;
  if p_cosmetic_id is not null and p_cosmetic_id !~ '^[a-z0-9_]{1,64}$' then raise exception 'bad_cosmetic_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  if p_cosmetic_id is null then
    delete from public.cosmetic_loadouts where user_id = p_user and slot = p_slot and target_id = p_target_id;
  else
    select * into v_cat from public.cosmetic_catalog where cosmetic_id = p_cosmetic_id;
    if not found then raise exception 'bad_cosmetic_id'; end if;
    if v_cat.category <> p_slot then raise exception 'wrong_target'; end if;
    if p_slot = 'hero_attack' then
      if v_cat.target_type is not null or v_cat.target_id is not null then raise exception 'wrong_target'; end if;
    elsif v_cat.target_type is distinct from (case p_slot when 'hero_skin' then 'hero' else 'card' end)
       or v_cat.target_id is distinct from p_target_id then
      raise exception 'wrong_target';
    end if;
    select k.enabled and not k.admin_off into v_live from public.cosmetic_categories k where k.category = v_cat.category;
    if not v_cat.active or v_cat.admin_off or not coalesce(v_live, false) then raise exception 'not_equippable'; end if;
    if not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = p_cosmetic_id) then
      raise exception 'not_owned';
    end if;
    insert into public.cosmetic_loadouts (user_id, slot, target_id, cosmetic_id, updated_at)
      values (p_user, p_slot, p_target_id, p_cosmetic_id, now())
      on conflict (user_id, slot, target_id) do update set cosmetic_id = excluded.cosmetic_id, updated_at = now();
  end if;

  update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = p_user;
  if not found then raise exception 'not_owned'; end if;
  return jsonb_build_object('status', 'equipped', 'profile', public.progression_profile_json(p_user));
end;
$$;

revoke all on function public.equip_cosmetic(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.equip_cosmetic(uuid, text, text, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: CRATES ROLL AT FIXED RARITY ODDS  (2026-09-29)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-progression-hero-attack.sql (the last file before
-- it). Idempotent: it only REPLACES `progression_crate_pool` + `open_crate`, adds `progression_crate_pick`, and
-- re-grants all three, so re-running it is always safe; it writes no rows. The same block is appended to
-- schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-09-29-crate-fixed-rarity-odds.md.
-- If the crates or skins file is ever re-run, run this one again after it (both redefine the pool / open_crate
-- with the old roll).
--
-- WHAT THIS IS (owner 2026-09-29: "go to C", then "make it 50/30/15/5 though").
--  - A crate first rolls a RARITY at fixed odds, Common 50 / Rare 30 / Epic 15 / Legendary 5 (percent), then picks
--    an item of that rarity the player does not own, weighted by its CATEGORY weight (so skins vs titles still
--    balance inside a rarity). The odds never move as items are added, so they can be published to players.
--  - A rolled rarity with nothing eligible falls to the NEAREST rarity with something left, ties toward the MORE
--    COMMON one (Epic empty goes to Rare before Legendary). Nothing eligible anywhere is `pool_exhausted`, as before:
--    the crate stays sealed.
--  - Still ONE server-side draw per opening: `random()` picks the rarity, and where it landed inside that rarity's
--    band picks the item. Everything else in `open_crate` is unchanged: the per-user lock, the crate row FOR
--    UPDATE, `already_opened`, `crates_disabled`, the unique ownership key, and the `admin_off` kill switch (the
--    pool's filter). Opened crates now record `roll_version = 2`.
--
-- THE TS COPY is packages/progression/src/cosmetics.ts (CRATE_RARITY_ODDS, CRATE_ROLL_VERSION, crateRarityFallback,
-- pickCrateReward). sqlParity.test.ts parses the constants below and fails CI on drift; crateOdds.db.test.ts runs
-- this file on PGlite and checks the SQL pick equals the TS pick draw for draw.

-- ── 1. The pool: what a crate can still give this player, with each item's WITHIN-RARITY weight ──────────
-- Active, crate-sourced items in a live category that the player does not own. Weight = the category weight
-- (mirror of crateWeightOf). The rarity odds are NOT in here any more; they live in progression_crate_pick.
create or replace function public.progression_crate_pool(p_user uuid)
returns table (pool_cosmetic_id text, pool_weight int)
language plpgsql
stable
set search_path = public
as $$
begin
  return query
    select c.cosmetic_id, k.weight
    from public.cosmetic_catalog c
    join public.cosmetic_categories k on k.category = c.category
    where c.active and not c.admin_off and k.enabled and not k.admin_off
      and c.acquisition_source = 'crate' and k.weight > 0
      and not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c.cosmetic_id)
    order by c.cosmetic_id collate "C";
end;
$$;

-- ── 2. The pick: one draw in [0, 1) → a rarity at the fixed odds → an item of it (mirror of pickCrateReward) ─
-- Null only when nothing is eligible anywhere. Pure given (pool, draw), so tests can drive it draw by draw.
create or replace function public.progression_crate_pick(p_user uuid, p_draw double precision)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  -- THE PUBLISHED ODDS, percent (mirror of CRATE_RARITY_ODDS in packages/progression/src/cosmetics.ts)
  c_odds_common    constant int := 50;
  c_odds_rare      constant int := 30;
  c_odds_epic      constant int := 15;
  c_odds_legendary constant int := 5;
  v_rarities text[] := array['common', 'rare', 'epic', 'legendary'];
  v_odds     int[];
  v_x        double precision;
  v_lo       int := 0;
  v_i        int;
  v_rolled   int := 4;
  v_frac     double precision := 1;
  v_r        text;
  v_total    bigint;
  v_roll     bigint;
  v_pick     text;
begin
  v_odds := array[c_odds_common, c_odds_rare, c_odds_epic, c_odds_legendary];
  -- the rarity: the first band (in rarity order) the draw falls under; where it fell inside that band is v_frac
  v_x := least(greatest(coalesce(p_draw, 0), 0), 1) * 100;
  for v_i in 1..4 loop
    if v_x < v_lo + v_odds[v_i] then
      v_rolled := v_i;
      v_frac := (v_x - v_lo) / v_odds[v_i];
      exit;
    end if;
    v_lo := v_lo + v_odds[v_i];
  end loop;
  -- the rolled rarity first, then the nearest rarity with something left (ties toward the more common one)
  for v_r in select v_rarities[g] from generate_series(1, 4) as g order by abs(g - v_rolled), g loop
    select coalesce(sum(p.pool_weight), 0) into v_total
      from public.progression_crate_pool(p_user) p
      join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
      where c.rarity = v_r;
    if v_total > 0 then
      -- one walk over that rarity's items in id order by cumulative category weight
      v_roll := least(v_total - 1, greatest(0, floor(v_frac * v_total)::bigint));
      select q.id into v_pick from (
        select p.pool_cosmetic_id as id,
          sum(p.pool_weight) over (order by p.pool_cosmetic_id collate "C" rows unbounded preceding) as acc
        from public.progression_crate_pool(p_user) p
        join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
        where c.rarity = v_r
      ) q where q.acc > v_roll order by q.acc limit 1;
      return v_pick;
    end if;
  end loop;
  return null;
end;
$$;

-- ── 3. open_crate: THE opening transaction. Service role only. ──────────────────────────────────────────
-- Per-user advisory lock (the same one the settlement takes, so two openings of DIFFERENT crates serialize and
-- can never pick the same item) → the crate row FOR UPDATE (an opened crate returns its committed reward as
-- `already_opened`) → an empty pool answers `pool_exhausted` and writes nothing → ONE draw through
-- progression_crate_pick → ownership insert (unique key = the final guard) + the crate marked opened, together.
create or replace function public.open_crate(p_user uuid, p_crate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_roll_version constant int := 2;
  v_crate   public.loot_crates%rowtype;
  v_enabled boolean;
  v_pick    text;
  v_rows    int;
  v_sealed  int;
begin
  if p_user is null or p_crate_id is null then raise exception 'bad_crate_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  select * into v_crate from public.loot_crates where crate_id = p_crate_id and user_id = p_user for update;
  if not found then raise exception 'crate_not_found'; end if;

  if v_crate.state = 'opened' then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'already_opened', 'crate', public.progression_crate_json(v_crate),
      'rewardId', v_crate.reward_cosmetic_id, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
  end if;

  select crates_enabled into v_enabled from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'crates_disabled'; end if;

  if not exists (select 1 from public.progression_crate_pool(p_user)) then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'pool_exhausted', 'crate', public.progression_crate_json(v_crate),
      'rewardId', null, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
  end if;

  -- ONE draw: the rarity at the fixed odds, then an item of it (mirror of pickCrateReward).
  v_pick := public.progression_crate_pick(p_user, random());
  if v_pick is null then raise exception 'duplicate_reward'; end if;

  insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
    values (p_user, v_pick, 'crate', p_crate_id::text)
    on conflict (user_id, cosmetic_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'duplicate_reward'; end if;

  update public.loot_crates set state = 'opened', reward_cosmetic_id = v_pick, roll_version = c_roll_version, opened_at = now()
    where crate_id = p_crate_id and state = 'sealed'
    returning * into v_crate;
  if not found then raise exception 'crate_not_found'; end if;

  -- A new title is worn at once only when the player wears none; the revision moves so mirrors adopt the change.
  update public.profiles set
    equipped_title_id = coalesce(equipped_title_id,
      (select c.cosmetic_id from public.cosmetic_catalog c where c.cosmetic_id = v_pick and c.category = 'title')),
    progression_revision = progression_revision + 1,
    updated_at = now()
  where user_id = p_user;

  select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
  return jsonb_build_object('status', 'opened', 'crate', public.progression_crate_json(v_crate),
    'rewardId', v_pick, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 4. Grants: service role only ─────────────────────────────────────────────────────────────────────────
revoke all on function public.progression_crate_pool(uuid) from public, anon, authenticated;
grant execute on function public.progression_crate_pool(uuid) to service_role;
revoke all on function public.progression_crate_pick(uuid, double precision) from public, anon, authenticated;
grant execute on function public.progression_crate_pick(uuid, double precision) to service_role;
revoke all on function public.open_crate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_crate(uuid, uuid) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: CRATES, AN EQUAL CHANCE FOR EVERY ITEM OF THE ROLLED RARITY  (2026-09-29)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-29-crate-fixed-rarity-odds.sql (the last file before
-- it). Idempotent: it only REPLACES `progression_crate_pick` + `open_crate` and re-grants them, so re-running it is
-- always safe; it writes no rows. The same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-09-29-crate-uniform-within-rarity.md. If the fixed-odds file (or the crates / skins file) is ever
-- re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-09-29: "yeah equal chance").
--  - The rarity roll is unchanged: fixed odds Common 50 / Rare 30 / Epic 15 / Legendary 5, one `random()` per
--    opening, the nearest-rarity fallback (ties toward the more common one), `pool_exhausted` when nothing is left.
--  - INSIDE the rolled rarity every eligible item is now EQUALLY likely (was: weighted by category weight). So each
--    Legendary item is 5% / (the number of eligible Legendary items), whatever its category.
--  - Category weights stay in `cosmetic_categories` (and `progression_crate_pool` still returns them) but the roll no
--    longer reads them; they are kept for later.
--  - Everything else in `open_crate` is unchanged. Opened crates now record `roll_version = 3`.
--
-- THE TS COPY is packages/progression/src/cosmetics.ts (CRATE_RARITY_ODDS, CRATE_ROLL_VERSION, pickCrateReward).
-- sqlParity.test.ts parses the constants below; crateOdds.db.test.ts runs this file on PGlite and checks the SQL
-- pick equals the TS pick draw for draw.

-- ── 1. The pick: one draw in [0, 1) → a rarity at the fixed odds → an EQUAL-chance item of it ────────────
-- Mirror of pickCrateReward. Null only when nothing is eligible anywhere. Pure given (pool, draw).
create or replace function public.progression_crate_pick(p_user uuid, p_draw double precision)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  -- THE PUBLISHED ODDS, percent (mirror of CRATE_RARITY_ODDS in packages/progression/src/cosmetics.ts)
  c_odds_common    constant int := 50;
  c_odds_rare      constant int := 30;
  c_odds_epic      constant int := 15;
  c_odds_legendary constant int := 5;
  v_rarities text[] := array['common', 'rare', 'epic', 'legendary'];
  v_odds     int[];
  v_x        double precision;
  v_lo       int := 0;
  v_i        int;
  v_rolled   int := 4;
  v_frac     double precision := 1;
  v_r        text;
  v_n        bigint;
  v_idx      bigint;
  v_pick     text;
begin
  v_odds := array[c_odds_common, c_odds_rare, c_odds_epic, c_odds_legendary];
  -- the rarity: the first band (in rarity order) the draw falls under; where it fell inside that band is v_frac
  v_x := least(greatest(coalesce(p_draw, 0), 0), 1) * 100;
  for v_i in 1..4 loop
    if v_x < v_lo + v_odds[v_i] then
      v_rolled := v_i;
      v_frac := (v_x - v_lo) / v_odds[v_i];
      exit;
    end if;
    v_lo := v_lo + v_odds[v_i];
  end loop;
  -- the rolled rarity first, then the nearest rarity with something left (ties toward the more common one)
  for v_r in select v_rarities[g] from generate_series(1, 4) as g order by abs(g - v_rolled), g loop
    select count(*) into v_n
      from public.progression_crate_pool(p_user) p
      join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
      where c.rarity = v_r;
    if v_n > 0 then
      -- every item of the rarity equally likely: the draw's place in the band indexes the items in id order
      v_idx := least(v_n - 1, greatest(0, floor(v_frac * v_n)::bigint));
      select p.pool_cosmetic_id into v_pick
        from public.progression_crate_pool(p_user) p
        join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
        where c.rarity = v_r
        order by p.pool_cosmetic_id collate "C"
        offset v_idx limit 1;
      return v_pick;
    end if;
  end loop;
  return null;
end;
$$;

-- ── 2. open_crate: THE opening transaction. Service role only. ──────────────────────────────────────────
-- Per-user advisory lock (the same one the settlement takes, so two openings of DIFFERENT crates serialize and
-- can never pick the same item) → the crate row FOR UPDATE (an opened crate returns its committed reward as
-- `already_opened`) → an empty pool answers `pool_exhausted` and writes nothing → ONE draw through
-- progression_crate_pick → ownership insert (unique key = the final guard) + the crate marked opened, together.
create or replace function public.open_crate(p_user uuid, p_crate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_roll_version constant int := 3;
  v_crate   public.loot_crates%rowtype;
  v_enabled boolean;
  v_pick    text;
  v_rows    int;
  v_sealed  int;
begin
  if p_user is null or p_crate_id is null then raise exception 'bad_crate_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  select * into v_crate from public.loot_crates where crate_id = p_crate_id and user_id = p_user for update;
  if not found then raise exception 'crate_not_found'; end if;

  if v_crate.state = 'opened' then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'already_opened', 'crate', public.progression_crate_json(v_crate),
      'rewardId', v_crate.reward_cosmetic_id, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
  end if;

  select crates_enabled into v_enabled from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'crates_disabled'; end if;

  if not exists (select 1 from public.progression_crate_pool(p_user)) then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'pool_exhausted', 'crate', public.progression_crate_json(v_crate),
      'rewardId', null, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
  end if;

  -- ONE draw: the rarity at the fixed odds, then an item of it (mirror of pickCrateReward).
  v_pick := public.progression_crate_pick(p_user, random());
  if v_pick is null then raise exception 'duplicate_reward'; end if;

  insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
    values (p_user, v_pick, 'crate', p_crate_id::text)
    on conflict (user_id, cosmetic_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'duplicate_reward'; end if;

  update public.loot_crates set state = 'opened', reward_cosmetic_id = v_pick, roll_version = c_roll_version, opened_at = now()
    where crate_id = p_crate_id and state = 'sealed'
    returning * into v_crate;
  if not found then raise exception 'crate_not_found'; end if;

  -- A new title is worn at once only when the player wears none; the revision moves so mirrors adopt the change.
  update public.profiles set
    equipped_title_id = coalesce(equipped_title_id,
      (select c.cosmetic_id from public.cosmetic_catalog c where c.cosmetic_id = v_pick and c.category = 'title')),
    progression_revision = progression_revision + 1,
    updated_at = now()
  where user_id = p_user;

  select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
  return jsonb_build_object('status', 'opened', 'crate', public.progression_crate_json(v_crate),
    'rewardId', v_pick, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 3. Grants: service role only ─────────────────────────────────────────────────────────────────────────
revoke all on function public.progression_crate_pick(uuid, double precision) from public, anon, authenticated;
grant execute on function public.progression_crate_pick(uuid, double precision) to service_role;
revoke all on function public.open_crate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_crate(uuid, uuid) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- HERO TITLES: a title at 3 Ranked 1sts with a hero, its golden MASTER version at 10  (2026-09-29)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-achievements.sql (and the 2026-09-29 crate files).
-- Idempotent: every insert is keyed, the backfill never repeats, and it never moves a switch. The same block is
-- appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-09-29-hero-titles.md. This file
-- REPLACES `settle_progression`: if the achievements file is ever re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-09-29: "the hero's title is granted at 3 wins with a hero, then the mastery of that
-- title is after 10 wins with that hero. the master title should be a golden plate and embroidered text"):
--  - 84 catalog titles (66 at first; Runesmith + Guardian added 2026-10-01, Rayse 2026-10-02, Pete, Foreman Flint, Emissary, Underdweller, Membrance + Gorun 2026-10-15), two per playable hero: `title_hero_<id>` (from the new `hero.<id>.titled` achievement, 3
--    Ranked 1sts) and `title_hero_<id>_master` (from `hero.<id>.mastery`, 10). Achievement-sourced, so
--    `progression_crate_pool` (crate items only) never offers them. The code owns the catalog
--    (`sync_cosmetic_catalog`, run by `progression-inventory`); this seed only makes sure the rows exist before the
--    first settlement can grant one (ownership references the catalog), and never overwrites a synced row.
--  - `settle_progression` now GRANTS an achievement's title (`achievement_catalog.title_id`) in the same transaction
--    as the completion (step 7c), reports it in `unlockedTitles`, swaps a worn base title for its master when the
--    master is earned, and wears a new hero title when nothing is worn (step 9a). Everything else is unchanged from
--    2026-09-28-achievements.sql (sqlParity.test.ts checks every constant).
--  - BACKFILL (section 4) for accounts that already count Ranked 1sts with a hero: the new Titled tier catches up
--    to the Mastery tier's count (the same predicate), a completed tier grants its title, and a worn base title is
--    upgraded. A backfilled completion pays NO XP (`xp_awarded` 0): XP only ever moves inside a settlement.
--
-- THE RULES LIVE IN TWO PLACES that must agree: this file and packages/progression/src/{achievements,cosmetics}.ts.
-- CI parses this file (sqlParity.test.ts) and runs it in an embedded Postgres (heroTitles.db.test.ts).

-- ── 1. The hero titles in the catalog (the code's sync owns them from here; a re-run never overwrites) ────────
insert into public.cosmetic_catalog (cosmetic_id, category, rarity, acquisition_source, milestone_level, target_type, target_id, achievement_id, active) values
  ('title_hero_warden', 'title', 'epic', 'achievement', null, null, null, 'hero.warden.titled', true),
  ('title_hero_warden_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.warden.mastery', true),
  ('title_hero_indy', 'title', 'epic', 'achievement', null, null, null, 'hero.indy.titled', true),
  ('title_hero_indy_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.indy.mastery', true),
  ('title_hero_myra', 'title', 'epic', 'achievement', null, null, null, 'hero.myra.titled', true),
  ('title_hero_myra_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.myra.mastery', true),
  ('title_hero_soren', 'title', 'epic', 'achievement', null, null, null, 'hero.soren.titled', true),
  ('title_hero_soren_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.soren.mastery', true),
  ('title_hero_nadja', 'title', 'epic', 'achievement', null, null, null, 'hero.nadja.titled', true),
  ('title_hero_nadja_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.nadja.mastery', true),
  ('title_hero_cassen', 'title', 'epic', 'achievement', null, null, null, 'hero.cassen.titled', true),
  ('title_hero_cassen_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.cassen.mastery', true),
  ('title_hero_drakko', 'title', 'epic', 'achievement', null, null, null, 'hero.drakko.titled', true),
  ('title_hero_drakko_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.drakko.mastery', true),
  ('title_hero_robin', 'title', 'epic', 'achievement', null, null, null, 'hero.robin.titled', true),
  ('title_hero_robin_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.robin.mastery', true),
  ('title_hero_darah', 'title', 'epic', 'achievement', null, null, null, 'hero.darah.titled', true),
  ('title_hero_darah_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.darah.mastery', true),
  ('title_hero_risen', 'title', 'epic', 'achievement', null, null, null, 'hero.risen.titled', true),
  ('title_hero_risen_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.risen.mastery', true),
  ('title_hero_gildmaster', 'title', 'epic', 'achievement', null, null, null, 'hero.gildmaster.titled', true),
  ('title_hero_gildmaster_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.gildmaster.mastery', true),
  ('title_hero_discodan', 'title', 'epic', 'achievement', null, null, null, 'hero.discodan.titled', true),
  ('title_hero_discodan_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.discodan.mastery', true),
  ('title_hero_brackus', 'title', 'epic', 'achievement', null, null, null, 'hero.brackus.titled', true),
  ('title_hero_brackus_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.brackus.mastery', true),
  ('title_hero_baggerben', 'title', 'epic', 'achievement', null, null, null, 'hero.baggerben.titled', true),
  ('title_hero_baggerben_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.baggerben.mastery', true),
  ('title_hero_hermithank', 'title', 'epic', 'achievement', null, null, null, 'hero.hermithank.titled', true),
  ('title_hero_hermithank_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.hermithank.mastery', true),
  ('title_hero_runesmith', 'title', 'epic', 'achievement', null, null, null, 'hero.runesmith.titled', true),
  ('title_hero_runesmith_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.runesmith.mastery', true),
  ('title_hero_runeguard', 'title', 'epic', 'achievement', null, null, null, 'hero.runeguard.titled', true),
  ('title_hero_runeguard_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.runeguard.mastery', true),
  ('title_hero_repete', 'title', 'epic', 'achievement', null, null, null, 'hero.repete.titled', true),
  ('title_hero_repete_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.repete.mastery', true),
  ('title_hero_gorr', 'title', 'epic', 'achievement', null, null, null, 'hero.gorr.titled', true),
  ('title_hero_gorr_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.gorr.mastery', true),
  ('title_hero_kindness', 'title', 'epic', 'achievement', null, null, null, 'hero.kindness.titled', true),
  ('title_hero_kindness_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.kindness.mastery', true),
  ('title_hero_merrin', 'title', 'epic', 'achievement', null, null, null, 'hero.merrin.titled', true),
  ('title_hero_merrin_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.merrin.mastery', true),
  ('title_hero_gambler', 'title', 'epic', 'achievement', null, null, null, 'hero.gambler.titled', true),
  ('title_hero_gambler_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.gambler.mastery', true),
  ('title_hero_xerox', 'title', 'epic', 'achievement', null, null, null, 'hero.xerox.titled', true),
  ('title_hero_xerox_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.xerox.mastery', true),
  ('title_hero_frank', 'title', 'epic', 'achievement', null, null, null, 'hero.frank.titled', true),
  ('title_hero_frank_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.frank.mastery', true),
  ('title_hero_pete', 'title', 'epic', 'achievement', null, null, null, 'hero.pete.titled', true),
  ('title_hero_pete_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.pete.mastery', true),
  ('title_hero_flint', 'title', 'epic', 'achievement', null, null, null, 'hero.flint.titled', true),
  ('title_hero_flint_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.flint.mastery', true),
  ('title_hero_vale', 'title', 'epic', 'achievement', null, null, null, 'hero.vale.titled', true),
  ('title_hero_vale_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.vale.mastery', true),
  ('title_hero_quillen', 'title', 'epic', 'achievement', null, null, null, 'hero.quillen.titled', true),
  ('title_hero_quillen_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.quillen.mastery', true),
  ('title_hero_hunch', 'title', 'epic', 'achievement', null, null, null, 'hero.hunch.titled', true),
  ('title_hero_hunch_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.hunch.mastery', true),
  ('title_hero_emeraldwarden', 'title', 'epic', 'achievement', null, null, null, 'hero.emeraldwarden.titled', true),
  ('title_hero_emeraldwarden_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.emeraldwarden.mastery', true),
  ('title_hero_underdweller', 'title', 'epic', 'achievement', null, null, null, 'hero.underdweller.titled', true),
  ('title_hero_underdweller_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.underdweller.mastery', true),
  ('title_hero_albus', 'title', 'epic', 'achievement', null, null, null, 'hero.albus.titled', true),
  ('title_hero_albus_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.albus.mastery', true),
  ('title_hero_flash', 'title', 'epic', 'achievement', null, null, null, 'hero.flash.titled', true),
  ('title_hero_flash_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.flash.mastery', true),
  ('title_hero_midas', 'title', 'epic', 'achievement', null, null, null, 'hero.midas.titled', true),
  ('title_hero_midas_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.midas.mastery', true),
  ('title_hero_juggler', 'title', 'epic', 'achievement', null, null, null, 'hero.juggler.titled', true),
  ('title_hero_juggler_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.juggler.mastery', true),
  ('title_hero_membrance', 'title', 'epic', 'achievement', null, null, null, 'hero.membrance.titled', true),
  ('title_hero_membrance_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.membrance.mastery', true),
  ('title_hero_bram', 'title', 'epic', 'achievement', null, null, null, 'hero.bram.titled', true),
  ('title_hero_bram_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.bram.mastery', true),
  ('title_hero_cia', 'title', 'epic', 'achievement', null, null, null, 'hero.cia.titled', true),
  ('title_hero_cia_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.cia.mastery', true),
  ('title_hero_keshi', 'title', 'epic', 'achievement', null, null, null, 'hero.keshi.titled', true),
  ('title_hero_keshi_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.keshi.mastery', true),
  ('title_hero_rayse', 'title', 'epic', 'achievement', null, null, null, 'hero.rayse.titled', true),
  ('title_hero_rayse_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.rayse.mastery', true),
  ('title_hero_gorun', 'title', 'epic', 'achievement', null, null, null, 'hero.gorun.titled', true),
  ('title_hero_gorun_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.gorun.mastery', true),
  ('title_hero_mimic', 'title', 'epic', 'achievement', null, null, null, 'hero.mimic.titled', true),
  ('title_hero_mimic_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.mimic.mastery', true)
on conflict (cosmetic_id) do nothing;
-- A (re-)run forces the next cold starts to sync both code catalogs (the new tier and the title rewards).
update public.progression_config set catalog_hash = null, achievements_hash = null where id = 1;

-- ── 2. settle_progression: grants achievement titles; a master upgrades the worn base title ─────────────────
create or replace function public.settle_progression(
  p_user uuid, p_mode text, p_run_id text, p_source_id bigint default null, p_comeback boolean default false,
  p_rules_version int default null, p_facts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of XP_RULES / CURVE in packages/progression/src/rules.ts — change all copies together)
  c_rules             constant int := 1;
  c_curve             constant int := 1;
  c_complete          constant int := 100;
  c_top_four          constant int := 40;
  c_first_place       constant int := 60;
  c_comeback          constant int := 25;
  c_comeback_streak   constant int := 4;
  c_practice_percent  constant int := 60;
  c_practice_flat     constant int := 60;
  c_tutorial          constant int := 250;
  c_tutorial_course   constant text := 'learn-ascent';
  c_tutorial_version  constant int := 1;
  c_alpha_title       constant text := 'alpha_tester';
  c_alpha_level       constant int := 2;
  c_rate_max          constant int := 30;
  c_rate_window       constant interval := interval '10 minutes';
  -- ACHIEVEMENTS (mirror of packages/progression/src/achievements.ts)
  c_meta_metric       constant text := 'achievementsCompleted';
  c_brutal_strength   constant int := 70;
  c_ascendant_div     constant int := 15;
  c_metric_max        constant bigint := 1000000000;
  -- HERO TITLES (mirror of heroTitleId / heroMasterTitleId in packages/progression/src/cosmetics.ts)
  c_hero_title_prefix constant text := 'title_hero_';
  c_master_suffix     constant text := '_master';

  prof        public.profiles%rowtype;
  prev        public.progression_results%rowtype;
  v_epoch     timestamptz;
  v_recent    int;
  v_source_at timestamptz;
  v_source    text := null;
  v_placement int := null;
  v_comeback  boolean := false;
  v_seed      bigint;
  v_cfg       jsonb;
  v_record    jsonb;
  v_wins      int;
  v_losses    int;
  r_top int := 0; r_first int := 0; r_come int := 0; v_ranked_total int;
  v_base int := 0; v_top int := 0; v_first int := 0; v_come int := 0; v_total int;
  v_xp0 bigint; v_xp1 bigint; v_l0 int; v_l1 int;
  v_unlocked  text[] := '{}';
  v_equipped  text;
  v_rows      int;
  v_facts_ver int := null;
  v_enrolling boolean;
  v_crate_ids uuid[] := '{}';
  -- achievements
  v_ach_epoch  timestamptz;
  v_promoted   boolean := false;
  v_div_before int := null;
  v_demo_game  boolean := false;
  v_demoted    boolean := false;
  v_strength   int := null;
  v_hero       text := null;
  v_set        text := null;
  v_run_ok     boolean := false;
  v_metrics    jsonb := '{}';
  v_first_streak int := 0;
  v_top_streak int := 0;
  v_heroes_played int := 0;
  v_heroes_won int := 0;
  v_done_count int := 0;
  d            public.achievement_catalog%rowtype;
  v_val        bigint;
  v_old        bigint;
  v_done       boolean;
  v_new        bigint;
  v_ach_ids    text[] := '{}';
  v_ach_xp     int := 0;
  v_hero_title text := null;
begin
  -- 1. validate
  if p_mode is null or p_mode not in ('ranked', 'practice', 'tutorial') then raise exception 'bad_mode'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. serialize per user (every progression entry point takes the advisory lock first), then lock the row
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.progression_results where user_id = p_user and run_id = p_run_id and mode = p_mode;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
  end if;

  -- 4. the switch: nothing is awarded before the owner sets the epoch
  select epoch, achievements_epoch into v_epoch, v_ach_epoch from public.progression_config where id = 1;
  if v_epoch is null then raise exception 'progression_disabled'; end if;

  -- 5. rate limit (technical only: a refused request is retried later and keeps its XP)
  select count(*) into v_recent from public.progression_results
    where user_id = p_user and settled_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 6. the SOURCE row: the placement comes from here, never from the request
  if p_mode = 'ranked' then
    select rr.placement, rr.seed, rr.created_at, rr.promoted, rr.division_before, rr.was_demotion_game, rr.demoted, rr.lobby_strength
      into v_placement, v_seed, v_source_at, v_promoted, v_div_before, v_demo_game, v_demoted, v_strength
      from public.rank_results rr where rr.user_id = p_user and rr.run_id = p_run_id;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_run_id;
    v_comeback := coalesce(p_comeback, false);
    if v_comeback and v_seed is not null then
      select h.wins, case when (h.entry->>'losses') ~ '^[0-9]+$' then (h.entry->>'losses')::int end
        into v_wins, v_losses
        from public.run_history h
        where h.user_id = p_user and h.mode = 'lobby' and h.entry->>'seed' = v_seed::text
        order by h.created_at desc limit 1;
      if found and (coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1) then v_comeback := false; end if;
    end if;
  elsif p_mode = 'practice' then
    if p_source_id is null or p_source_id < 1 then raise exception 'bad_source'; end if;
    if p_run_id is distinct from ('practice:' || p_source_id::text) then raise exception 'bad_run_id'; end if;
    select pg.placement, pg.config, pg.record, pg.created_at, pg.hero_id into v_placement, v_cfg, v_record, v_source_at, v_hero
      from public.practice_games pg where pg.id = p_source_id and pg.user_id = p_user;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_source_id::text;
    -- No meaningful placement: an Unlimited Health game plays to the curtain and is never eliminated (and a row
    -- with no options recorded is treated the same way). It earns the flat XP, no placement or comeback bonus.
    if v_cfg is null or coalesce(v_cfg->>'health', 'unlimited') <> 'normal'
       or v_placement is null or v_placement < 1 or v_placement > 8 then
      v_placement := null;
    end if;
    v_comeback := coalesce(p_comeback, false) and v_placement is not null;
    if v_comeback and v_record is not null then
      v_wins := case when (v_record->>'wins') ~ '^[0-9]+$' then (v_record->>'wins')::int end;
      v_losses := case when (v_record->>'losses') ~ '^[0-9]+$' then (v_record->>'losses')::int end;
      if coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1 then v_comeback := false; end if;
    end if;
  else
    -- tutorial: one claim per account per course version (the ledger check above already caught a repeat)
    if p_run_id is distinct from (c_tutorial_course || ':v' || c_tutorial_version::text) then raise exception 'bad_run_id'; end if;
    insert into public.tutorial_progression_claims (user_id, course_id, course_version, xp_awarded)
      values (p_user, c_tutorial_course, c_tutorial_version, c_tutorial)
      on conflict (user_id, course_id, course_version) do nothing;
    v_source := c_tutorial_course || ':' || c_tutorial_version::text;
  end if;

  -- 7. XP (mirror of xpForSettlement)
  if p_mode = 'tutorial' then
    v_base := c_tutorial;
  elsif p_mode = 'practice' and v_placement is null then
    v_base := c_practice_flat;
  else
    r_top   := case when v_placement <= 4 then c_top_four else 0 end;
    r_first := case when v_placement = 1 then c_first_place else 0 end;
    r_come  := case when v_comeback then c_comeback else 0 end;
    if p_mode = 'ranked' then
      v_base := c_complete; v_top := r_top; v_first := r_first; v_come := r_come;
    else
      -- Practice: 60% of the equivalent ranked XP, summed then rounded; the remainder lands on the base.
      v_ranked_total := c_complete + r_top + r_first + r_come;
      v_top   := (r_top   * c_practice_percent + 50) / 100;
      v_first := (r_first * c_practice_percent + 50) / 100;
      v_come  := (r_come  * c_practice_percent + 50) / 100;
      v_base  := (v_ranked_total * c_practice_percent + 50) / 100 - v_top - v_first - v_come;
    end if;
  end if;
  v_total := v_base + v_top + v_first + v_come;

  if p_facts is not null and jsonb_typeof(p_facts) = 'object' and (p_facts->>'version') ~ '^[0-9]+$' then
    v_facts_ver := (p_facts->>'version')::int;
  end if;

  -- 7b. ACHIEVEMENTS (mirror of evaluateAchievements in packages/progression/src/achievements.ts). Only once the
  -- owner has set the achievements epoch, and only for a game whose source row is not older than it.
  if v_ach_epoch is not null and coalesce(v_source_at, now()) >= v_ach_epoch then
    -- The `any` gate: Ranked, or a standard Practice (Normal Health, so a real placement, AND a turn timer).
    v_run_ok := p_mode = 'ranked'
      or (p_mode = 'practice' and v_placement is not null and coalesce(v_cfg->>'timeMult', '') ~ '^[1-9][0-9]*$');
    if p_mode = 'ranked' then v_hero := p_facts->>'heroId'; end if;
    if v_hero is not null and v_hero !~ '^[A-Za-z0-9_.-]{1,64}$' then v_hero := null; end if;
    v_set := p_facts->>'setId';
    if v_set is not null and v_set !~ '^[A-Za-z0-9_.-]{1,32}$' then v_set := null; end if;

    -- Distinct heroes: this game counts toward its hero when it is an eligible game.
    if v_run_ok and v_hero is not null then
      insert into public.achievement_hero_stats (user_id, hero_id, games, firsts)
        values (p_user, v_hero, 1, case when p_mode = 'ranked' and v_placement = 1 then 1 else 0 end)
        on conflict (user_id, hero_id) do update set
          games = public.achievement_hero_stats.games + 1,
          firsts = public.achievement_hero_stats.firsts + excluded.firsts,
          updated_at = now();
    end if;
    select count(*) filter (where s.games > 0), count(*) filter (where s.firsts > 0) into v_heroes_played, v_heroes_won
      from public.achievement_hero_stats s where s.user_id = p_user;

    -- Ranked streaks, over Ranked games since the achievements epoch, ending with this one.
    if p_mode = 'ranked' then
      with r as (
        select rr.placement, row_number() over (order by rr.created_at desc, rr.run_id desc) as rn
        from public.rank_results rr
        where rr.user_id = p_user and rr.created_at >= v_ach_epoch and rr.created_at <= v_source_at
      )
      select coalesce((select min(rn) from r where placement <> 1) - 1, (select count(*) from r)),
             coalesce((select min(rn) from r where placement > 4) - 1, (select count(*) from r))
        into v_first_streak, v_top_streak;
    end if;

    -- The metrics: the client's run metrics (V2), overwritten by every server metric (a client can never name one).
    if coalesce(v_facts_ver, 0) >= 2 and jsonb_typeof(p_facts->'metrics') = 'object' then v_metrics := p_facts->'metrics'; end if;
    v_metrics := v_metrics || jsonb_build_object(
      'game', 1,
      'comeback', case when v_comeback then 1 else 0 end,
      'highestDivision', coalesce(prof.rank_highest_division, 0),
      'promoted', case when p_mode = 'ranked' and v_promoted then 1 else 0 end,
      'ascendantFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_div_before, 0) >= c_ascendant_div then 1 else 0 end,
      'demotionEscape', case when p_mode = 'ranked' and v_demo_game and not v_demoted and v_placement <= 4 then 1 else 0 end,
      'brutalFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_strength, 0) >= c_brutal_strength then 1 else 0 end,
      'firstStreak', v_first_streak,
      'topFourStreak', v_top_streak,
      'heroesPlayed', v_heroes_played,
      'heroesWon', v_heroes_won,
      c_meta_metric, 0
    );

    -- Pass 1: every live, non-prestige, non-meta definition, in id order. Pass 2: the meta family, by target.
    select count(*) into v_done_count from public.achievement_completions c where c.user_id = p_user;
    for d in
      select * from public.achievement_catalog c
      where c.active and not c.admin_off and c.trust <> 'P'
      order by (c.metric = c_meta_metric), case when c.metric = c_meta_metric then c.target else 0 end, c.achievement_id collate "C"
    loop
      continue when d.mode = 'ranked' and p_mode <> 'ranked';
      continue when d.mode = 'tutorial' and p_mode <> 'tutorial';
      continue when d.mode = 'any' and not v_run_ok;
      continue when d.set_id is not null and v_set is distinct from d.set_id;
      continue when d.hero_id is not null and v_hero is distinct from d.hero_id;
      continue when d.placement_max is not null and (v_placement is null or v_placement > d.placement_max);
      if d.metric = c_meta_metric then
        v_val := v_done_count;
      elsif jsonb_typeof(v_metrics->d.metric) = 'number' then
        v_val := least(c_metric_max, greatest(0, floor((v_metrics->>d.metric)::numeric)))::bigint;
      else
        v_val := 0;
      end if;
      continue when v_val <= 0;
      select ap.progress, ap.completed_at is not null into v_old, v_done
        from public.achievement_progress ap where ap.user_id = p_user and ap.achievement_id = d.achievement_id;
      if not found then v_old := 0; v_done := false; end if;
      continue when v_done;
      v_new := case when d.agg = 'sum' then v_old + v_val else greatest(v_old, v_val) end;
      continue when v_new = v_old and v_new < d.target;
      insert into public.achievement_progress (user_id, achievement_id, definition_version, progress, completed_at, completion_run_id, updated_at)
        values (p_user, d.achievement_id, d.version, v_new,
                case when v_new >= d.target then now() end, case when v_new >= d.target then p_run_id end, now())
        on conflict (user_id, achievement_id) do update set
          definition_version = excluded.definition_version, progress = excluded.progress,
          completed_at = excluded.completed_at, completion_run_id = excluded.completion_run_id, updated_at = now();
      if v_new >= d.target then
        insert into public.achievement_completions (user_id, achievement_id, run_id, mode, xp_awarded, title_id)
          values (p_user, d.achievement_id, p_run_id, p_mode, d.xp, d.title_id)
          on conflict (user_id, achievement_id) do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          v_ach_ids := array_append(v_ach_ids, d.achievement_id);
          v_ach_xp := v_ach_xp + d.xp;
          v_done_count := v_done_count + 1;
          -- 7c. A TITLE reward (hero titles, owner 2026-09-29) is granted in the same transaction. Only a title the
          -- catalog knows (the ownership FK); the grant is keyed, so a retry or the backfill never doubles it.
          if d.title_id is not null and exists (select 1 from public.cosmetic_catalog c where c.cosmetic_id = d.title_id and c.category = 'title') then
            insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
              values (p_user, d.title_id, 'achievement', d.achievement_id)
              on conflict (user_id, cosmetic_id) do nothing;
            get diagnostics v_rows = row_count;
            if v_rows > 0 then
              v_unlocked := array_append(v_unlocked, d.title_id);
              if d.title_id like c_hero_title_prefix || '%' then v_hero_title := d.title_id; end if;
            end if;
          end if;
        end if;
      end if;
    end loop;
  end if;

  -- 8. levels (lifetime XP; the level is derived). Achievement XP counts toward the level and its crates.
  v_xp0 := coalesce(prof.account_xp, 0);
  v_xp1 := v_xp0 + v_total + v_ach_xp;
  v_l0 := public.progression_level_of(v_xp0);
  v_l1 := public.progression_level_of(v_xp1);

  -- 9. titles: Alpha Tester for EVERY account at Level 2 (owner 2026-09-27); equipped when nothing else is
  if v_l1 >= c_alpha_level then
    insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
      values (p_user, c_alpha_title, 'level', p_mode || ':' || p_run_id)
      on conflict (user_id, cosmetic_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_unlocked := array_append(v_unlocked, c_alpha_title); end if;
  end if;
  v_equipped := prof.equipped_title_id;
  -- 9a. HERO TITLES (owner 2026-09-29). The master UPGRADES the title in place: a newly earned master replaces its own
  -- base title when that is the one worn. A new hero title is worn when nothing is (like Alpha Tester).
  if v_equipped is not null and v_equipped like c_hero_title_prefix || '%' and (v_equipped || c_master_suffix) = any(v_unlocked) then
    v_equipped := v_equipped || c_master_suffix;
  end if;
  if v_equipped is null and v_hero_title is not null then
    v_equipped := v_hero_title;
  end if;
  if v_equipped is null and exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c_alpha_title) then
    v_equipped := c_alpha_title;
  end if;

  -- 9b. crates: one sealed crate per newly reached level; enrollment (the first settlement) also grants the
  -- Level 1 Welcome Crate. The unique (user, level) key makes this safe against the backfill and any retry.
  v_enrolling := prof.progression_enrolled_at is null;
  with ins as (
    insert into public.loot_crates (user_id, earned_level, source_id)
      select p_user, g.lvl, p_mode || ':' || p_run_id
      from generate_series(case when v_enrolling then 1 else v_l0 + 1 end, v_l1) as g(lvl)
      on conflict (user_id, earned_level) do nothing
      returning crate_id, earned_level
  )
  select coalesce(array_agg(ins.crate_id order by ins.earned_level), '{}') into v_crate_ids from ins;

  -- 10. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    account_xp = v_xp1, account_level = v_l1,
    progression_revision = prof.progression_revision + 1,
    progression_enrolled_at = coalesce(prof.progression_enrolled_at, now()),
    progression_curve_version = c_curve,
    equipped_title_id = v_equipped,
    updated_at = now()
  where user_id = p_user;

  insert into public.progression_results (
    user_id, run_id, mode, source_id, rules_version, curve_version, facts_version, facts,
    placement, comeback, base_xp, top_four_xp, first_place_xp, comeback_xp, achievement_xp, total_xp,
    xp_before, xp_after, level_before, level_after, revision_before, revision_after,
    crates_awarded, crate_ids, achievement_ids, unlocked_title_ids
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, v_ach_xp, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    coalesce(array_length(v_crate_ids, 1), 0), v_crate_ids, v_ach_ids, v_unlocked
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 3. Grants: the writer is service role ONLY (the Edge Function calls it) ────────────────────────────────
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;

-- ── 4. BACKFILL (idempotent: every statement is keyed or guarded, so a re-run changes nothing) ──────────────
-- a) The Titled tier (3 Ranked 1sts) counts the same games as Mastery (10): an account with Mastery progress
--    starts Titled at that count, capped at the target. Rows already there are left alone.
insert into public.achievement_progress (user_id, achievement_id, definition_version, progress, completed_at, completion_run_id, updated_at)
  select ap.user_id, 'hero.' || split_part(ap.achievement_id, '.', 2) || '.titled', 1, least(ap.progress, 3),
         case when ap.progress >= 3 then now() end, case when ap.progress >= 3 then 'backfill' end, now()
  from public.achievement_progress ap
  where ap.achievement_id like 'hero.%.mastery' and ap.progress > 0
  on conflict (user_id, achievement_id) do nothing;
-- b) Each backfilled Titled completion is recorded once, with no XP (XP only moves inside a settlement).
insert into public.achievement_completions (user_id, achievement_id, run_id, mode, xp_awarded, title_id)
  select ap.user_id, ap.achievement_id, 'backfill', 'ranked', 0, 'title_hero_' || split_part(ap.achievement_id, '.', 2)
  from public.achievement_progress ap
  where ap.achievement_id like 'hero.%.titled' and ap.completed_at is not null and ap.completion_run_id = 'backfill'
  on conflict (user_id, achievement_id) do nothing;
-- c) Every completed hero title tier grants its title (the completion row names it; only catalog titles).
insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
  select c.user_id, case when c.achievement_id like '%.mastery' then 'title_hero_' || split_part(c.achievement_id, '.', 2) || '_master'
                         else 'title_hero_' || split_part(c.achievement_id, '.', 2) end,
         'achievement', c.achievement_id
  from public.achievement_completions c
  where (c.achievement_id like 'hero.%.titled' or c.achievement_id like 'hero.%.mastery')
    and exists (select 1 from public.cosmetic_catalog k where k.cosmetic_id = case when c.achievement_id like '%.mastery'
                  then 'title_hero_' || split_part(c.achievement_id, '.', 2) || '_master' else 'title_hero_' || split_part(c.achievement_id, '.', 2) end)
  on conflict (user_id, cosmetic_id) do nothing;
-- d) The completions carry their title (the pre-titles catalog wrote null).
update public.achievement_completions c set title_id = case when c.achievement_id like '%.mastery'
    then 'title_hero_' || split_part(c.achievement_id, '.', 2) || '_master' else 'title_hero_' || split_part(c.achievement_id, '.', 2) end
  where (c.achievement_id like 'hero.%.titled' or c.achievement_id like 'hero.%.mastery') and c.title_id is null;
-- e) A worn base title whose master is owned is upgraded in place.
update public.profiles p set equipped_title_id = p.equipped_title_id || '_master', progression_revision = p.progression_revision + 1, updated_at = now()
  where p.equipped_title_id like 'title_hero_%' and p.equipped_title_id not like '%\_master'
    and exists (select 1 from public.player_cosmetics o where o.user_id = p.user_id and o.cosmetic_id = p.equipped_title_id || '_master');


-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- HIDE profiles.email FROM THE CLIENT ROLES  (2026-09-29, run by the owner the same day)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- `profiles.email` is a denormalised copy of the auth email (accounts C2). The public "read profiles" policy made
-- every column readable to `anon`, so the anon key could read any player's email (found while investigating
-- the opponent pool). No client query reads it back: the client only WRITES it (uploadPlayerProfile). So the
-- table-wide SELECT becomes a column list without `email`. Writes are unaffected (UPDATE/INSERT grants are
-- untouched, and the RLS update check reads only rating / rank_* columns). The service role (Edge Functions)
-- is unaffected.
--
-- ⚠️ A NEW column added to public.profiles is NOT readable by the client until it is added to this grant.
revoke select on public.profiles from anon, authenticated;
grant select (
  user_id, author, discriminator, rating, season2_rating, games_played, favorite_hero, patch, updated_at,
  account_level, account_xp, equipped_title_id, progression_curve_version, progression_enrolled_at,
  progression_revision, rank_demotion_ready, rank_division, rank_highest_division, rank_highest_points,
  rank_points, rank_revision, rank_rules_version, rank_season
) on public.profiles to anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- THE OPPONENT POOL IS MADE OF WHOLE RUNS, drawn uniformly at random  (2026-09-29, R-LOBBY-08)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Independent of every other migration (it only needs `boards`).
-- Idempotent: safe to re-run; each run rebuilds `pool_runs` from `boards`. The same block is appended to
-- schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-09-29-pool-whole-runs.md.
--
-- WHY (owner 2026-09-29: "isnt it just replaying snapshots from the player's game?", then "make sure this is firmly
-- fixed and will be scalable and a non issue moving forward", then "i want opponent snapshots to be completely
-- random but i want them to be accurate ... i want them random from all snapshots in the pool"):
-- the client used to download the newest 120 boards PER WAVE and glue them back into runs. Early waves hold far
-- more boards than late ones, so an older run kept its late waves and lost its early ones, and a lobby seat
-- served a wave-10 board on round 5. The pool is now selected here, BY RUN:
--
--  - `pool_runs`: one row per run (author, hero, seed), kept current by statement triggers on `boards`. It holds
--    the run's shape (waves, first/last wave, biggest hole, a plausible-tier check) and whether it may take a
--    seat (`eligible`, the same rule as the client's `runCoversItsRounds` + `runTiersPlausible` + 4-wave minimum).
--  - `pool_runs_sample(...)`: a UNIFORM random sample of eligible runs (every run equally likely, no recency, no
--    weighting), returned ONE ROW PER RUN with ALL of that run's boards in one jsonb array. A run is therefore
--    present whole or absent; it can never arrive cut. At most 300 rows, so PostgREST's max-rows cap never
--    truncates it either.
--
-- HOW THE SAMPLE SCALES. `pool_runs.id` is a dense bigserial. A draw picks a uniform integer in [min id, max id]
-- of the eligible runs for the set + build version (two index probes), looks it up by primary key and keeps it
-- if it is eligible, matches, is not the caller's own run and was not already picked; otherwise it draws again.
-- Every accepted id is uniform over the remaining eligible runs (plain rejection sampling), so the sample is
-- exactly uniform without replacement, and each draw costs O(log n) index work whatever the pool size. It never
-- scans or sorts the table (`order by random()` would). A pool smaller than 4x the request is simply shuffled
-- whole. Rejections only cost time, bounded at 64 draws per requested run; ids stay dense because runs are only
-- ever inserted (a whole run in one upload), so real density is close to 1.
--
-- THE RULES LIVE IN TWO PLACES that must agree: this file and packages/sim/src/lobby/snapshotSeats.ts
-- (`runWavesCover`, `maxPlausibleTier`, `MIN_RUN_WAVES`). CI runs this file in an embedded Postgres
-- (packages/sim/src/lobby/poolRuns.db.test.ts) and checks the eligibility and tier bound against the TS.

-- ── 1. Look up a run's boards by its identity ──────────────────────────────────────────────────────────────
create index if not exists boards_run_key on public.boards ((coalesce(author, 'anon')), hero_id, seed, wave);

-- ── 2. One row per run ─────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.pool_runs (
  id           bigserial primary key,
  author       text    not null,           -- coalesce(boards.author, 'anon'): the client's run key uses the same
  hero_id      text    not null,
  seed         bigint  not null,
  user_id      uuid,                        -- the uploading account (seat cap + "not your own runs")
  set_id       text    not null,            -- snapshot.setId, 'set1' for boards from before sets
  patch_prefix text    not null,            -- '<version>+' of the run's boards: what the client filters by
  boards       int     not null,            -- servable board rows (duplicates included)
  wave_count   int     not null,            -- distinct waves: the client checks the run arrived with all of them
  first_wave   int     not null,
  last_wave    int     not null,
  max_gap      int     not null,            -- most waves missing in a row
  tiers_ok     boolean not null,            -- every board within the plausible tier for its wave
  eligible     boolean not null,            -- may take a lobby seat (see pool_run_eligible)
  updated_at   timestamptz not null default now(),
  unique (author, hero_id, seed)
);
create index if not exists pool_runs_sample_idx on public.pool_runs (set_id, patch_prefix, id) where eligible;

alter table public.pool_runs enable row level security;
drop policy if exists "read pool_runs" on public.pool_runs;
create policy "read pool_runs" on public.pool_runs for select using (true);
grant select on public.pool_runs to anon, authenticated;

-- ── 3. The eligibility rule (mirrors snapshotSeats.ts; parity-tested) ─────────────────────────────────────
-- maxPlausibleTier(wave): the all-in tavern-up curve (1,2,2,3,4,4,5,6 from wave 1) + 2 tiers of slack.
create or replace function public.pool_max_plausible_tier(p_wave int) returns int
language sql immutable as $$
  select case when p_wave <= 1 then 3 when p_wave <= 3 then 4 when p_wave = 4 then 5
              when p_wave <= 6 then 6 when p_wave = 7 then 7 else 8 end
$$;
-- At least 4 waves, the first at wave 1 or 2, never more than one wave missing in a row, plausible tiers.
create or replace function public.pool_run_eligible(p_wave_count int, p_first_wave int, p_max_gap int, p_tiers_ok boolean) returns boolean
language sql immutable as $$
  select p_wave_count >= 4 and p_first_wave <= 2 and p_max_gap <= 1 and p_tiers_ok
$$;

-- ── 4. Keep pool_runs current ──────────────────────────────────────────────────────────────────────────────
-- Recompute the rows for these run keys from `boards` (parallel arrays: author, hero, seed). A run whose
-- servable boards are all gone loses its row. Only servable boards count: non-empty minions, not synthetic,
-- which is exactly what the sample returns and the client keeps.
create or replace function public.pool_runs_upsert_from(p_author text[], p_hero text[], p_seed bigint[]) returns void
language plpgsql set search_path = public as $$
begin
  with keys as (
    select distinct k.a as author, k.h as hero_id, k.s as seed
    from unnest(p_author, p_hero, p_seed) as k(a, h, s)
    where k.s is not null and k.h is not null
  ),
  b as (
    select k.author, k.hero_id, k.seed, x.wave, x.user_id, x.patch, x.created_at, x.snapshot
    from keys k
    join public.boards x on coalesce(x.author, 'anon') = k.author and x.hero_id = k.hero_id and x.seed = k.seed
    where jsonb_typeof(x.snapshot -> 'minions') = 'array' and jsonb_array_length(x.snapshot -> 'minions') > 0
      and coalesce(x.origin, 'self') <> 'synthetic'
  ),
  w as (select distinct author, hero_id, seed, wave from b),
  shape as (
    select author, hero_id, seed, count(*)::int as wave_count, min(wave) as first_wave, max(wave) as last_wave,
           coalesce(max(wave - prev - 1), 0)::int as max_gap
    from (select w.*, lag(wave) over (partition by author, hero_id, seed order by wave) as prev from w) t
    group by author, hero_id, seed
  ),
  agg as (
    select author, hero_id, seed, count(*)::int as boards,
           (array_agg(user_id order by created_at) filter (where user_id is not null))[1] as user_id,
           (array_agg(coalesce(snapshot ->> 'setId', 'set1') order by created_at))[1] as set_id,
           (array_agg(split_part(patch, '+', 1) || '+' order by created_at desc))[1] as patch_prefix,
           bool_and(case when jsonb_typeof(snapshot -> 'tier') = 'number'
                         then (snapshot ->> 'tier')::numeric <= public.pool_max_plausible_tier(wave) else true end) as tiers_ok
    from b group by author, hero_id, seed
  )
  insert into public.pool_runs as r (author, hero_id, seed, user_id, set_id, patch_prefix, boards, wave_count, first_wave,
                                      last_wave, max_gap, tiers_ok, eligible, updated_at)
  select a.author, a.hero_id, a.seed, a.user_id, a.set_id, a.patch_prefix, a.boards, s.wave_count, s.first_wave,
         s.last_wave, s.max_gap, a.tiers_ok, public.pool_run_eligible(s.wave_count, s.first_wave, s.max_gap, a.tiers_ok), now()
  from agg a join shape s using (author, hero_id, seed)
  on conflict (author, hero_id, seed) do update set
    user_id = excluded.user_id, set_id = excluded.set_id, patch_prefix = excluded.patch_prefix, boards = excluded.boards,
    wave_count = excluded.wave_count, first_wave = excluded.first_wave, last_wave = excluded.last_wave,
    max_gap = excluded.max_gap, tiers_ok = excluded.tiers_ok, eligible = excluded.eligible, updated_at = now();

  delete from public.pool_runs r
  using (select distinct k.a as author, k.h as hero_id, k.s as seed from unnest(p_author, p_hero, p_seed) as k(a, h, s)) k
  where r.author = k.author and r.hero_id = k.hero_id and r.seed = k.seed
    and not exists (
      select 1 from public.boards x
      where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
        and jsonb_typeof(x.snapshot -> 'minions') = 'array' and jsonb_array_length(x.snapshot -> 'minions') > 0
        and coalesce(x.origin, 'self') <> 'synthetic');
end $$;

-- Statement-level triggers: one recompute per upload (a run's boards arrive in ONE insert), not per row.
-- SECURITY DEFINER because the uploading player may insert `boards` but never write `pool_runs`. A failure here
-- is caught and logged, never raised: the upload must not be lost because the index could not be refreshed.
create or replace function public.pool_runs_after_boards_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text[]; h text[]; s bigint[];
begin
  select array_agg(coalesce(n.author, 'anon')), array_agg(n.hero_id), array_agg(n.seed) into a, h, s from new_rows n;
  if a is not null then perform public.pool_runs_upsert_from(a, h, s); end if;
  return null;
exception when others then
  -- Never lose an upload over the pool index: the boards are kept, and pool_runs_rebuild() repairs the row.
  raise warning 'pool_runs refresh failed: %', sqlerrm;
  return null;
end $$;
create or replace function public.pool_runs_after_boards_delete() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text[]; h text[]; s bigint[];
begin
  select array_agg(coalesce(o.author, 'anon')), array_agg(o.hero_id), array_agg(o.seed) into a, h, s from old_rows o;
  if a is not null then perform public.pool_runs_upsert_from(a, h, s); end if;
  return null;
exception when others then
  -- Never lose an upload over the pool index: the boards are kept, and pool_runs_rebuild() repairs the row.
  raise warning 'pool_runs refresh failed: %', sqlerrm;
  return null;
end $$;
create or replace function public.pool_runs_after_boards_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text[]; h text[]; s bigint[];
begin
  select array_agg(k.author), array_agg(k.hero_id), array_agg(k.seed) into a, h, s from (
    select coalesce(o.author, 'anon') as author, o.hero_id, o.seed from old_rows o
    union select coalesce(n.author, 'anon'), n.hero_id, n.seed from new_rows n) k;
  if a is not null then perform public.pool_runs_upsert_from(a, h, s); end if;
  return null;
exception when others then
  -- Never lose an upload over the pool index: the boards are kept, and pool_runs_rebuild() repairs the row.
  raise warning 'pool_runs refresh failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists pool_runs_boards_insert on public.boards;
drop trigger if exists pool_runs_boards_delete on public.boards;
drop trigger if exists pool_runs_boards_update on public.boards;
create trigger pool_runs_boards_insert after insert on public.boards
  referencing new table as new_rows for each statement execute function public.pool_runs_after_boards_insert();
create trigger pool_runs_boards_delete after delete on public.boards
  referencing old table as old_rows for each statement execute function public.pool_runs_after_boards_delete();
create trigger pool_runs_boards_update after update on public.boards
  referencing old table as old_rows new table as new_rows for each statement execute function public.pool_runs_after_boards_update();

-- Rebuild everything from `boards` (the backfill below; also the repair tool if pool_runs is ever in doubt).
create or replace function public.pool_runs_rebuild() returns int
language plpgsql set search_path = public as $$
declare a text[]; h text[]; s bigint[];
begin
  select array_agg(k.author), array_agg(k.hero_id), array_agg(k.seed) into a, h, s from (
    select distinct coalesce(author, 'anon') as author, hero_id, seed from public.boards where seed is not null
    union select author, hero_id, seed from public.pool_runs) k;
  if a is not null then perform public.pool_runs_upsert_from(a, h, s); end if;
  return (select count(*)::int from public.pool_runs);
end $$;

-- ── 5. The sample ──────────────────────────────────────────────────────────────────────────────────────────
-- A uniform [0, 1) from text, for a reproducible sample when the caller passes p_seed (tests, audits).
create or replace function public.pool_hash01(p text) returns double precision
language sql immutable as $$
  select (('x' || substr(md5(p), 1, 13))::bit(52)::bigint)::double precision / 4503599627370496.0
$$;

create or replace function public.pool_runs_sample(
  p_limit int default 150,
  p_set text default null,
  p_patch_prefix text default null,
  p_exclude_user uuid default null,
  p_seed text default null
) returns table (run_key text, author text, user_id uuid, wave_count int, boards jsonb)
language plpgsql volatile set search_path = public as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 150), 0), 300);
  lo bigint; hi bigint; span bigint;
  picked bigint[] := '{}';
  cand bigint; tries int := 0; u double precision;
begin
  select min(r.id), max(r.id) into lo, hi from public.pool_runs r
  where r.eligible and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix);
  if lo is null or v_limit = 0 then return; end if;
  span := hi - lo + 1;

  if span <= 4 * v_limit then
    -- A small pool: every eligible run, shuffled whole (bounded by the id span, so this stays small).
    select coalesce(array_agg(t.id order by t.k), '{}') into picked from (
      select r.id, case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || r.id) end as k
      from public.pool_runs r
      where r.id between lo and hi and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
      order by 2 limit v_limit) t;
  else
    -- Rejection sampling over the dense id range: exactly uniform, O(log n) per draw, never a scan.
    while coalesce(array_length(picked, 1), 0) < v_limit and tries < v_limit * 64 loop
      tries := tries + 1;
      u := case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || tries) end;
      cand := lo + least(floor(u * span)::bigint, span - 1);
      continue when cand = any(picked);
      perform 1 from public.pool_runs r
      where r.id = cand and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user);
      if found then picked := picked || cand; end if;
    end loop;
  end if;

  return query
  select r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count,
         (select coalesce(jsonb_agg(x.snapshot order by x.wave, x.created_at, x.id), '[]'::jsonb) from public.boards x
          where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
            and jsonb_typeof(x.snapshot -> 'minions') = 'array' and jsonb_array_length(x.snapshot -> 'minions') > 0
            and coalesce(x.origin, 'self') <> 'synthetic')
  from unnest(picked) with ordinality as p(id, ord)
  join public.pool_runs r on r.id = p.id
  order by p.ord;
end $$;

-- ── 6. Who may call what ───────────────────────────────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new public functions to anon/authenticated by default: take it back from every
-- internal function, then grant only the sample.
revoke all on function public.pool_runs_upsert_from(text[], text[], bigint[]) from public, anon, authenticated;
revoke all on function public.pool_runs_rebuild() from public, anon, authenticated;
revoke all on function public.pool_runs_after_boards_insert() from public, anon, authenticated;
revoke all on function public.pool_runs_after_boards_delete() from public, anon, authenticated;
revoke all on function public.pool_runs_after_boards_update() from public, anon, authenticated;
grant execute on function public.pool_runs_sample(int, text, text, uuid, text) to anon, authenticated;

-- ── 7. Backfill (idempotent) ───────────────────────────────────────────────────────────────────────────────
select public.pool_runs_rebuild();

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- BOARD STRENGTH: a 1-100 percentile per board and per run, and matchmaking bands by rank  (2026-09-30, R-LOBBY-09)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-29-pool-whole-runs.sql (it extends `pool_runs` and
-- replaces `pool_runs_sample`). Idempotent: safe to re-run. The same block is appended to schema.sql; keep the two
-- identical. Owner runbook: docs/devlog/2026-09-30-board-strength.md.
--
-- WHY (owner 2026-09-30: "can we build an algorithm for board strength to get as good of an idea of how strong a
-- snapshot's run is, and assign it a 1-100 value? ... serve for example 0-30 for bronze, 10-40 in silver, 20-65 in
-- gold, and then uncap plat?", and "72 would basically mean like... a 72/100 aka 72nd percentile"):
--
--  - `boards.strength_raw`: the board's win rate against a frozen reference set of real boards at its wave
--    (`strength_ref` names the reference version, `strength_wave` the reference wave it was scored against). The
--    client computes it (packages/sim/src/lobby/boardStrength.ts) and uploads it with the board; the backfill file
--    fills the boards from before. Stored permanently; never recomputed here.
--  - A board's PERCENTILE is derived: the share of the boards at the same reference wave (same version) it is
--    stronger than, ties counted half, a whole number 1..100 (`board_strength_pct`, the SQL twin of the TS
--    `percentileOf`, parity-tested in packages/sim/src/lobby/boardStrength.db.test.ts).
--  - `pool_runs.strength_avg`: the average of the run's board percentiles (rounded, 1..100). Averages pull toward
--    50 (a run is rarely the weakest in every round), so they are not themselves a percentile of RUNS.
--  - `pool_runs.strength`: the run's strength, a TRUE percentile among runs (owner-approved 2026-09-30): its
--    `strength_avg` ranked against every other run's of the same set, with the same tie-halving 1..100 rule. 30 means
--    the bottom 30% of runs, so each band holds about its nominal share. Null = not scored yet. Averages are
--    refreshed for the uploaded runs on every upload (and for every run at most every 10 minutes); the ranks of all
--    runs are recomputed on every refresh (a window over pool_runs; only changed rows are written).
--  - `pool_runs_sample` gains an optional band (`p_strength_min`, `p_strength_max`): a run is drawn only if its
--    strength is inside, and an UNSCORED run counts as inside every band, so nothing changes before the backfill.
--    Still uniform within the band, whole runs, never the caller's own. `p_pool` is the hook for a second pool
--    later (`pool_runs.pool_id`, 'main' for every run today).
--  - `board_strength_histogram(p_ref)`: per reference wave, how many boards hold each raw score, and
--    `run_strength_histogram(p_set)`: how many runs hold each average. The client turns its own fresh raw scores into
--    per-round percentiles with the first and ranks their average with the second, so the number a game shows is
--    frozen when it ends.
--
-- The population is every board with a score. Only boards with minions are ever scored (client and backfill),
-- and synthetic boards are never scored, so no snapshot has to be read to count it (an index-only scan).

-- ── 1. Columns ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.boards add column if not exists strength_raw numeric;
alter table public.boards add column if not exists strength_ref text;
alter table public.boards add column if not exists strength_wave smallint;
create index if not exists boards_strength on public.boards (strength_ref, strength_wave, strength_raw) where strength_raw is not null;

alter table public.pool_runs add column if not exists strength numeric;      -- run percentile among runs 1..100; null = unscored
alter table public.pool_runs add column if not exists strength_avg numeric;  -- average of the run's board percentiles
alter table public.pool_runs add column if not exists strength_at timestamptz;
alter table public.pool_runs add column if not exists pool_id text not null default 'main';

-- ── 2. The percentile (mirrors percentileOf in boardStrength.ts) ──────────────────────────────────────────
-- 100 * (below + equal / 2) / n, rounded half up, clamped to 1..100, in exact integer arithmetic so both copies
-- round the same way. `equal` includes the board itself.
create or replace function public.board_strength_pct(p_below bigint, p_equal bigint, p_n bigint) returns int
language sql immutable as $$
  select case when coalesce(p_n, 0) <= 0 then null
              else least(100, greatest(1, ((2 * (200 * p_below + 100 * p_equal) + 2 * p_n) / (4 * p_n))::int)) end
$$;

-- Every scored board's count at its (reference, wave, raw), with the running count below it and the wave total.
create or replace function public.board_strength_cumulative() returns table (strength_ref text, strength_wave smallint, strength_raw numeric, n bigint, below bigint, total bigint)
language sql stable set search_path = public as $$
  with h as (
    select b.strength_ref, b.strength_wave, b.strength_raw, count(*) as n
    from public.boards b
    where b.strength_raw is not null and b.strength_ref is not null and b.strength_wave is not null
    group by 1, 2, 3
  )
  select h.strength_ref, h.strength_wave, h.strength_raw, h.n,
         coalesce(sum(h.n) over (partition by h.strength_ref, h.strength_wave order by h.strength_raw
                                 rows between unbounded preceding and 1 preceding), 0)::bigint,
         sum(h.n) over (partition by h.strength_ref, h.strength_wave)::bigint
  from h
$$;

-- ── 3. Keep pool_runs.strength current ─────────────────────────────────────────────────────────────────────
-- Recompute the board-percentile AVERAGE of these runs (parallel arrays author, hero, seed), or of EVERY run when
-- p_author is null, then re-rank every run's average among the runs of its set (`strength`). Returns the number of
-- runs whose average was recomputed.
create or replace function public.pool_strength_refresh(p_author text[] default null, p_hero text[] default null, p_seed bigint[] default null) returns int
language plpgsql set search_path = public as $$
declare v int;
begin
  with keys as (
    select r.id, r.author, r.hero_id, r.seed from public.pool_runs r
    where p_author is null
       or (r.author, r.hero_id, r.seed) in (select k.a, k.h, k.s from unnest(p_author, p_hero, p_seed) as k(a, h, s))
  ),
  c as (select * from public.board_strength_cumulative()),
  pct as (
    select k.id as run_id, public.board_strength_pct(c.below, c.n, c.total) as p
    from keys k
    join public.boards x on coalesce(x.author, 'anon') = k.author and x.hero_id = k.hero_id and x.seed = k.seed
    join c on c.strength_ref = x.strength_ref and c.strength_wave = x.strength_wave and c.strength_raw = x.strength_raw
    where x.strength_raw is not null
  ),
  agg as (select run_id, least(100, greatest(1, round(avg(p))))::numeric as s from pct group by run_id)
  update public.pool_runs r set strength_avg = (select a.s from agg a where a.run_id = r.id), strength_at = now()
  from keys k where r.id = k.id;
  get diagnostics v = row_count;

  -- Every run's rank among the runs of its set: below = runs with a lower average, equal = runs with the same
  -- average (itself included), n = runs with an average. The same `board_strength_pct` rule as a board.
  with ranked as (
    select r.id, public.board_strength_pct(
      (rank() over w - 1)::bigint,
      count(*) over (partition by r.set_id, r.strength_avg),
      count(*) over (partition by r.set_id))::numeric as s
    from public.pool_runs r
    where r.strength_avg is not null
    window w as (partition by r.set_id order by r.strength_avg)
  )
  update public.pool_runs r set strength = x.s
  from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id) x
  where r.id = x.id and r.strength is distinct from x.s;
  return v;
end $$;

-- After an upload (insert) or an update of boards (the backfill): refresh the runs those boards belong to, and every
-- run when the last full refresh is older than 10 minutes. Fires after the `pool_runs_boards_*` triggers (trigger
-- names sort), so the run row already exists. SECURITY DEFINER for the same reason as those: the uploading player
-- may insert boards but never write pool_runs. A failure is caught and logged: an upload is never lost to it.
create or replace function public.pool_strength_after_boards() returns trigger
language plpgsql security definer set search_path = public as $$
declare a text[]; h text[]; s bigint[]; stale boolean;
begin
  select array_agg(coalesce(n.author, 'anon')), array_agg(n.hero_id), array_agg(n.seed) into a, h, s
  from new_rows n where n.strength_raw is not null and n.seed is not null;
  if a is null then return null; end if; -- nothing scored in this statement
  -- A full refresh stamps every run, so the oldest stamp is the last full refresh.
  select coalesce(min(coalesce(strength_at, '-infinity'::timestamptz)) < now() - interval '10 minutes', false) into stale from public.pool_runs;
  if stale then perform public.pool_strength_refresh(null, null, null);
  else perform public.pool_strength_refresh(a, h, s); end if;
  return null;
exception when others then
  raise warning 'pool strength refresh failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists pool_strength_boards_insert on public.boards;
drop trigger if exists pool_strength_boards_update on public.boards;
create trigger pool_strength_boards_insert after insert on public.boards
  referencing new table as new_rows for each statement execute function public.pool_strength_after_boards();
create trigger pool_strength_boards_update after update on public.boards
  referencing new table as new_rows for each statement execute function public.pool_strength_after_boards();

-- ── 4. The client's histogram ──────────────────────────────────────────────────────────────────────────────
create or replace function public.board_strength_histogram(p_ref text) returns table (wave int, raw numeric, n bigint)
language sql stable set search_path = public as $$
  select b.strength_wave::int, b.strength_raw, count(*)
  from public.boards b
  where b.strength_ref = p_ref and b.strength_raw is not null and b.strength_wave is not null
  group by 1, 2 order by 1, 2
$$;

-- How many runs of a set hold each board-percentile average (the population a run's strength is ranked in).
create or replace function public.run_strength_histogram(p_set text) returns table (avg numeric, n bigint)
language sql stable set search_path = public as $$
  select r.strength_avg, count(*) from public.pool_runs r
  where r.set_id = p_set and r.strength_avg is not null
  group by 1 order by 1
$$;

-- ── 5. The sample, with a strength band and a pool id ──────────────────────────────────────────────────────
-- Replaces the 2026-09-29 signature (a changed return type cannot be `create or replace`d). Callers that pass only
-- the old arguments keep working: every new one defaults to null.
drop function if exists public.pool_runs_sample(int, text, text, uuid, text);
create or replace function public.pool_runs_sample(
  p_limit int default 150,
  p_set text default null,
  p_patch_prefix text default null,
  p_exclude_user uuid default null,
  p_seed text default null,
  p_strength_min numeric default null,
  p_strength_max numeric default null,
  p_pool text default null
) returns table (run_key text, author text, user_id uuid, wave_count int, strength numeric, boards jsonb)
language plpgsql volatile set search_path = public as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 150), 0), 300);
  lo bigint; hi bigint; span bigint;
  picked bigint[] := '{}';
  cand bigint; tries int := 0; u double precision;
begin
  select min(r.id), max(r.id) into lo, hi from public.pool_runs r
  where r.eligible and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix);
  if lo is null or v_limit = 0 then return; end if;
  span := hi - lo + 1;

  if span <= 4 * v_limit then
    -- A small pool: every matching run, shuffled whole (bounded by the id span, so this stays small).
    select coalesce(array_agg(t.id order by t.k), '{}') into picked from (
      select r.id, case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || r.id) end as k
      from public.pool_runs r
      where r.id between lo and hi and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
        and (r.strength is null or ((p_strength_min is null or r.strength >= p_strength_min) and (p_strength_max is null or r.strength <= p_strength_max)))
      order by 2 limit v_limit) t;
  else
    -- Rejection sampling over the dense id range: exactly uniform over the matching runs, O(log n) per draw.
    -- A narrow band rejects more draws; the cap (64 per requested run) bounds the time either way.
    while coalesce(array_length(picked, 1), 0) < v_limit and tries < v_limit * 64 loop
      tries := tries + 1;
      u := case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || tries) end;
      cand := lo + least(floor(u * span)::bigint, span - 1);
      continue when cand = any(picked);
      perform 1 from public.pool_runs r
      where r.id = cand and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
        and (r.strength is null or ((p_strength_min is null or r.strength >= p_strength_min) and (p_strength_max is null or r.strength <= p_strength_max)));
      if found then picked := picked || cand; end if;
    end loop;
  end if;

  return query
  select r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count, r.strength,
         (select coalesce(jsonb_agg(x.snapshot order by x.wave, x.created_at, x.id), '[]'::jsonb) from public.boards x
          where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
            and jsonb_typeof(x.snapshot -> 'minions') = 'array' and jsonb_array_length(x.snapshot -> 'minions') > 0
            and coalesce(x.origin, 'self') <> 'synthetic')
  from unnest(picked) with ordinality as p(id, ord)
  join public.pool_runs r on r.id = p.id
  order by p.ord;
end $$;

-- ── 6. Who may call what ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public.pool_strength_refresh(text[], text[], bigint[]) from public, anon, authenticated;
revoke all on function public.pool_strength_after_boards() from public, anon, authenticated;
revoke all on function public.board_strength_cumulative() from public, anon, authenticated;
grant execute on function public.board_strength_histogram(text) to anon, authenticated;
grant execute on function public.run_strength_histogram(text) to anon, authenticated;
grant execute on function public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text) to anon, authenticated;

-- ── 7. Refresh (idempotent; every run is unscored until the backfill file is run) ─────────────────────────
select public.pool_strength_refresh(null, null, null);

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

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- GAUNTLET PROGRESS: stage clears on the account; the FIRST clear of each stage grants one crate  (2026-09-29)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-progression-crates.sql (it replaces functions from
-- that file); it can run before or after 2026-09-29-hero-titles.sql. Idempotent (safe to re-run). The same block is appended to schema.sql; keep the two identical. This file
-- REPLACES `loot_crates_transition_guard` and `progression_crate_json` (both from 2026-09-28-progression-crates.sql):
-- if the crates file is ever re-run, run this one again after it.
--
-- WHAT THIS IS (Gauntlet: a single-player run of 10 stages; spec docs/superpowers/specs/2026-09-29-gauntlet-design.md):
--  - `gauntlet_progress`: one row per (user, stage) the account has cleared. Stage N is unlocked iff stage N-1 has a
--    row (stage 1 always); there is no separate unlock flag. Owner-only read; clients never write.
--  - A GAUNTLET CRATE is an ordinary `loot_crates` row with NO level (`earned_level` null) and `source` =
--    'gauntlet:<stage>'. Level crates are unchanged: they keep `earned_level`, a null `source`, and the unique
--    (user, level) key the settlement's `on conflict` relies on (NULL levels never collide with it). Every crate has
--    a level OR a source, and an account holds at most one crate per source. `open_crate` opens both kinds alike.
--  - `record_gauntlet_clear(user, stage)` (service role only, called by the gauntlet Edge Function): the FIRST clear
--    of a stage records the row and grants one sealed crate in the same transaction (`first_clear` + the crate);
--    every later clear is a no-op (`already_cleared`, no crate). The server trusts the client's clear (owner
--    2026-09-29) and only validates the stage (an integer 1 to 10). It takes the settlement's per-user advisory lock.
--  - THE CRATES SWITCH (`progression_config.crates_enabled`) only gates OPENING (`open_crate`). A first clear ALWAYS
--    grants its crate, banked sealed while the switch is off, exactly like the settlement's level crates: gating the
--    grant would lose that stage's crate forever, since a replay never grants one.

-- ── 1. loot_crates: a crate may come from a source instead of a level ─────────────────────────────────────
alter table public.loot_crates alter column earned_level drop not null;
alter table public.loot_crates add column if not exists source text;
alter table public.loot_crates drop constraint if exists loot_crates_level_or_source;
alter table public.loot_crates add constraint loot_crates_level_or_source check (earned_level is not null or source is not null);
-- At most one crate per source per account (one per Gauntlet stage), behind `gauntlet_progress`'s own key.
create unique index if not exists loot_crates_one_per_source on public.loot_crates (user_id, source) where source is not null;

-- A crate goes sealed -> opened ONCE and is then history (even for the service role). `source` is identity too.
create or replace function public.loot_crates_transition_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.state = 'opened' then raise exception 'crate_already_opened'; end if;
  if new.crate_id is distinct from old.crate_id or new.user_id is distinct from old.user_id
     or new.earned_level is distinct from old.earned_level or new.earned_at is distinct from old.earned_at
     or new.source is distinct from old.source then
    raise exception 'crate_identity_is_immutable';
  end if;
  return new;
end;
$$;

-- MUST match `CrateRow` in packages/progression/src/cosmetics.ts key for key (`source` is null for a level crate).
create or replace function public.progression_crate_json(c public.loot_crates)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'crateId', c.crate_id, 'earnedLevel', c.earned_level, 'state', c.state,
    'rewardId', c.reward_cosmetic_id, 'earnedAt', c.earned_at, 'openedAt', c.opened_at,
    'source', c.source
  );
$$;

-- ── 2. gauntlet_progress: one row per cleared stage; owner-only read ──────────────────────────────────────
create table if not exists public.gauntlet_progress (
  user_id          uuid not null references auth.users(id) on delete cascade,
  stage            int  not null check (stage between 1 and 10),
  first_cleared_at timestamptz not null default now(),
  crate_granted    boolean not null default false,
  crate_id         uuid references public.loot_crates(crate_id),
  primary key (user_id, stage)
);
alter table public.gauntlet_progress enable row level security;
drop policy if exists "read own gauntlet_progress" on public.gauntlet_progress;
create policy "read own gauntlet_progress" on public.gauntlet_progress for select to authenticated using (auth.uid() = user_id);

-- ── 3. record_gauntlet_clear: THE clear transaction. Service role only. ─────────────────────────────────
-- Validate → the per-user advisory lock (the same one settlement and opening take) → the progress row, keyed
-- (a replay inserts nothing and answers `already_cleared`) → on a first clear, one sealed crate (always, whatever
-- the crates switch) linked from the progress row, all in this transaction.
create or replace function public.record_gauntlet_clear(p_user uuid, p_stage int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows    int;
  v_crate   public.loot_crates%rowtype;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if p_stage is null or p_stage < 1 or p_stage > 10 then raise exception 'bad_stage'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  insert into public.gauntlet_progress (user_id, stage) values (p_user, p_stage)
    on conflict (user_id, stage) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('status', 'already_cleared', 'crate', null);
  end if;

  insert into public.loot_crates (user_id, earned_level, source, source_id)
    values (p_user, null, 'gauntlet:' || p_stage, 'gauntlet:' || p_stage)
    returning * into v_crate;
  update public.gauntlet_progress set crate_granted = true, crate_id = v_crate.crate_id
    where user_id = p_user and stage = p_stage;

  return jsonb_build_object('status', 'first_clear', 'crate', public.progression_crate_json(v_crate));
end;
$$;

-- ── 4. Grants: service role only ─────────────────────────────────────────────────────────────────────────
revoke all on function public.record_gauntlet_clear(uuid, int) from public, anon, authenticated;
grant execute on function public.record_gauntlet_clear(uuid, int) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- WEIGHTED RUN STRENGTH: a run's average weighs its rounds by group  (2026-09-30, R-LOBBY-09)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-30-board-strength.sql. Idempotent: safe to re-run. The
-- same block is appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-09-30-weighted-strength.md.
--
-- WHY (owner 2026-09-30: "i think we need to weigh the rounds a bit. rounds 1-5 matter much less than 6-9 which matter
-- less than 10+. they are all still important but i wonder if weighing would be better. like 20% ish for 1-5, 35% for
-- 6-9 and 45% for 10+?"):
--
--  - `pool_runs.strength_avg` was the PLAIN average of the run's board percentiles. It becomes a WEIGHTED average:
--    rounds 1-5 share 20% of the weight, rounds 6-9 share 35%, rounds 10+ share 45%; inside a group the share is split
--    evenly across the run's scored boards in it (a round with two boards counts twice, as in the plain average). A
--    group the run has no boards in drops out and the rest are renormalised (a run that ended in round 8: 20/55 and
--    35/55). Rounded half up to 1..100 in exact integer arithmetic (`board_strength_weighted_avg`, the SQL twin of the
--    TS `weightedAvgFromGroups` / `runWeightedAverageOf`, parity-tested in boardStrength.db.test.ts).
--  - `pool_runs.strength` (the average ranked among runs) is unchanged in definition; it is re-ranked on the new
--    averages by the refresh at the end of this file.
--  - The round is the board's own wave (`boards.wave`), not its reference wave.
--
-- Locks: the first board-strength migration deadlocked against live pool reads, so everything runs in one transaction
-- that takes both tables first.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. The weighted average of a run's groups (mirrors weightedAvgFromGroups in boardStrength.ts) ─────────────
-- s1/n1 = sum and count of the run's board percentiles in rounds 1-5, s2/n2 rounds 6-9, s3/n3 rounds 10+.
-- value = (20 s1/n1 + 35 s2/n2 + 45 s3/n3) / (sum of the weights of the groups with n > 0), as num / den over the
-- common denominator m1 m2 m3 (m = greatest(n, 1)), rounded half up as floor((2 num + den) / (2 den)).
create or replace function public.board_strength_weighted_avg(s1 bigint, n1 bigint, s2 bigint, n2 bigint, s3 bigint, n3 bigint) returns int
language sql immutable as $$
  with t as (
    select greatest(coalesce(n1, 0), 1) as m1, greatest(coalesce(n2, 0), 1) as m2, greatest(coalesce(n3, 0), 1) as m3,
           case when coalesce(n1, 0) > 0 then coalesce(s1, 0) else 0 end as a1,
           case when coalesce(n2, 0) > 0 then coalesce(s2, 0) else 0 end as a2,
           case when coalesce(n3, 0) > 0 then coalesce(s3, 0) else 0 end as a3,
           (case when coalesce(n1, 0) > 0 then 20 else 0 end
          + case when coalesce(n2, 0) > 0 then 35 else 0 end
          + case when coalesce(n3, 0) > 0 then 45 else 0 end)::bigint as w
  ),
  f as (select 20 * a1 * m2 * m3 + 35 * a2 * m1 * m3 + 45 * a3 * m1 * m2 as num, w * m1 * m2 * m3 as den, w from t)
  select case when w = 0 then null else least(100, greatest(1, ((2 * num + den) / (2 * den))::int)) end from f
$$;

-- ── 2. pool_strength_refresh with the weighted average (same signature, same rank step) ───────────────────
create or replace function public.pool_strength_refresh(p_author text[] default null, p_hero text[] default null, p_seed bigint[] default null) returns int
language plpgsql set search_path = public as $$
declare v int;
begin
  with keys as (
    select r.id, r.author, r.hero_id, r.seed from public.pool_runs r
    where p_author is null
       or (r.author, r.hero_id, r.seed) in (select k.a, k.h, k.s from unnest(p_author, p_hero, p_seed) as k(a, h, s))
  ),
  c as (select * from public.board_strength_cumulative()),
  pct as (
    select k.id as run_id, x.wave, public.board_strength_pct(c.below, c.n, c.total) as p
    from keys k
    join public.boards x on coalesce(x.author, 'anon') = k.author and x.hero_id = k.hero_id and x.seed = k.seed
    join c on c.strength_ref = x.strength_ref and c.strength_wave = x.strength_wave and c.strength_raw = x.strength_raw
    where x.strength_raw is not null
  ),
  grp as (
    select run_id,
           sum(p) filter (where wave <= 5)::bigint as s1, count(p) filter (where wave <= 5) as n1,
           sum(p) filter (where wave between 6 and 9)::bigint as s2, count(p) filter (where wave between 6 and 9) as n2,
           sum(p) filter (where wave >= 10)::bigint as s3, count(p) filter (where wave >= 10) as n3
    from pct where p is not null group by run_id
  ),
  agg as (select run_id, public.board_strength_weighted_avg(s1, n1, s2, n2, s3, n3)::numeric as s from grp)
  update public.pool_runs r set strength_avg = (select a.s from agg a where a.run_id = r.id), strength_at = now()
  from keys k where r.id = k.id;
  get diagnostics v = row_count;

  -- Every run's rank among the runs of its set (unchanged): below = runs with a lower average, equal = runs with the
  -- same average (itself included), n = runs with an average. The same `board_strength_pct` rule as a board.
  with ranked as (
    select r.id, public.board_strength_pct(
      (rank() over w - 1)::bigint,
      count(*) over (partition by r.set_id, r.strength_avg),
      count(*) over (partition by r.set_id))::numeric as s
    from public.pool_runs r
    where r.strength_avg is not null
    window w as (partition by r.set_id order by r.strength_avg)
  )
  update public.pool_runs r set strength = x.s
  from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id) x
  where r.id = x.id and r.strength is distinct from x.s;
  return v;
end $$;

-- ── 3. Who may call what ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public.pool_strength_refresh(text[], text[], bigint[]) from public, anon, authenticated;

-- ── 4. Recompute every run's average and strength on the new weights ───────────────────────────────────────
select public.pool_strength_refresh(null, null, null);

commit;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: PORTRAIT FRAMES, equip_cosmetic accepts the account-wide `portrait_frame` slot  (2026-10-01)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-30-weighted-strength.sql (the last file before it).
-- Idempotent: it only REPLACES `equip_cosmetic` (and re-grants it), so re-running it is always safe; it writes no rows.
-- The same block is appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-10-01-portrait-frames.md.
-- It SUPERSEDES the equip_cosmetic in 2026-09-28-progression-hero-attack.sql (it keeps that file's hero attack slot):
-- if the skins or hero attack file is ever re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-10-01: "we're adding portrait skins ... we want this to replace the default portrait png
-- when a skin is applied").
--  - The `portrait_frame` category and its 31 items arrive through the code-owned catalog sync like every other
--    cosmetic (packages/progression/src/cosmetics.ts, deploy progression-inventory). No catalog SQL: the sync inserts
--    the category row (weight 10, enabled, target global) and the items, so they join the crate pool on that deploy.
--  - A portrait frame is ACCOUNT-WIDE (category target `global`), like the hero attack: one row in
--    `cosmetic_loadouts` with target_id ''. `equip_cosmetic(user, 'portrait_frame', '', id)` wears one the caller
--    OWNS; a null id takes it off (the default ring). The skin and hero attack slots behave exactly as before.

create or replace function public.equip_cosmetic(p_user uuid, p_slot text, p_target_id text, p_cosmetic_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.cosmetic_catalog%rowtype;
  v_live boolean;
begin
  if p_user is null then raise exception 'not_owned'; end if;
  if p_slot is null or p_slot not in ('hero_skin', 'minion_skin', 'hero_attack', 'portrait_frame') then raise exception 'bad_slot'; end if;
  -- A global slot (hero attack, portrait frame) has exactly one target, ''. A skin slot names its hero or card.
  if p_slot in ('hero_attack', 'portrait_frame') then
    if p_target_id is distinct from '' then raise exception 'bad_target'; end if;
  elsif p_target_id is null or p_target_id !~ '^[A-Za-z0-9_.:-]{1,64}$' then
    raise exception 'bad_target';
  end if;
  if p_cosmetic_id is not null and p_cosmetic_id !~ '^[a-z0-9_]{1,64}$' then raise exception 'bad_cosmetic_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  if p_cosmetic_id is null then
    delete from public.cosmetic_loadouts where user_id = p_user and slot = p_slot and target_id = p_target_id;
  else
    select * into v_cat from public.cosmetic_catalog where cosmetic_id = p_cosmetic_id;
    if not found then raise exception 'bad_cosmetic_id'; end if;
    if v_cat.category <> p_slot then raise exception 'wrong_target'; end if;
    if p_slot in ('hero_attack', 'portrait_frame') then
      if v_cat.target_type is not null or v_cat.target_id is not null then raise exception 'wrong_target'; end if;
    elsif v_cat.target_type is distinct from (case p_slot when 'hero_skin' then 'hero' else 'card' end)
       or v_cat.target_id is distinct from p_target_id then
      raise exception 'wrong_target';
    end if;
    select k.enabled and not k.admin_off into v_live from public.cosmetic_categories k where k.category = v_cat.category;
    if not v_cat.active or v_cat.admin_off or not coalesce(v_live, false) then raise exception 'not_equippable'; end if;
    if not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = p_cosmetic_id) then
      raise exception 'not_owned';
    end if;
    insert into public.cosmetic_loadouts (user_id, slot, target_id, cosmetic_id, updated_at)
      values (p_user, p_slot, p_target_id, p_cosmetic_id, now())
      on conflict (user_id, slot, target_id) do update set cosmetic_id = excluded.cosmetic_id, updated_at = now();
  end if;

  update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = p_user;
  if not found then raise exception 'not_owned'; end if;
  return jsonb_build_object('status', 'equipped', 'profile', public.progression_profile_json(p_user));
end;
$$;

revoke all on function public.equip_cosmetic(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.equip_cosmetic(uuid, text, text, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: THE ANCIENT RARITY, and the crate odds 35 / 31 / 22 / 9 / 3  (2026-10-02)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-01-portrait-frames.sql (the last file before it). THEN
-- deploy the `progression-inventory` Edge Function (its catalog sync writes the Ancient items; before this file runs
-- the rarity check below rejects them, so run the SQL FIRST). Idempotent: it re-creates one check constraint and
-- REPLACES `progression_crate_pick` + `open_crate` (re-granted), so re-running it is always safe; it writes no rows
-- and touches neither `boards` nor `pool_runs`. The same block is appended to schema.sql; keep the two identical.
-- Owner runbook: docs/devlog/2026-10-02-ancient-rarity.md. It SUPERSEDES the pick and open_crate in
-- 2026-09-29-crate-uniform-within-rarity.sql: if that file (or the fixed-odds, crates or skins file) is ever re-run,
-- run this one again after it.
--
-- WHAT THIS IS (owner 2026-10-02: "i added a new rarity -> Ancient. can you wire that up so we can have skins that are
-- of ancient rarity? these will be a 3% drop rate").
--  - `cosmetic_catalog.rarity` accepts 'ancient', ranked ABOVE 'legendary'.
--  - The fixed rarity odds move from 50 / 30 / 15 / 5 to Common 35 / Rare 31 / Epic 22 / Legendary 9 / Ancient 3.
--  - Everything else in the roll is unchanged: one `random()` per opening, an equal chance for every eligible item of
--    the rolled rarity (id order), the nearest-rarity fallback with ties toward the more common one (so an empty
--    Ancient falls to Legendary), `pool_exhausted` when nothing is left. Opened crates now record `roll_version = 4`.
--  - Ownership is per id (`player_cosmetics`), with no rarity in it: an item whose rarity moves (four Legendary items
--    became Ancient today) stays owned by everyone who has it.
--
-- THE TS COPY is packages/progression/src/cosmetics.ts (COSMETIC_RARITIES, CRATE_RARITY_ODDS, CRATE_ROLL_VERSION,
-- pickCrateReward). sqlParity.test.ts parses the constants below; crateOdds.db.test.ts runs this file on PGlite and
-- checks the SQL pick equals the TS pick draw for draw.

-- ── 0. The rarity check: every rarity check on cosmetic_catalog is dropped (whatever Postgres named the inline one)
-- and the five-rarity one re-created under a fixed name. Every existing row is one of the old four, so it validates.
do $$
declare v_name text;
begin
  for v_name in
    select con.conname from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public' and rel.relname = 'cosmetic_catalog' and con.contype = 'c'
        and pg_get_constraintdef(con.oid) ilike '%rarity%'
  loop
    execute format('alter table public.cosmetic_catalog drop constraint %I', v_name);
  end loop;
end;
$$;
alter table public.cosmetic_catalog add constraint cosmetic_catalog_rarity_check
  check (rarity in ('common', 'rare', 'epic', 'legendary', 'ancient'));

-- ── 1. The pick: one draw in [0, 1) → a rarity at the fixed odds → an EQUAL-chance item of it ────────────
-- Mirror of pickCrateReward. Null only when nothing is eligible anywhere. Pure given (pool, draw).
create or replace function public.progression_crate_pick(p_user uuid, p_draw double precision)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  -- THE PUBLISHED ODDS, percent (mirror of CRATE_RARITY_ODDS in packages/progression/src/cosmetics.ts)
  c_odds_common    constant int := 35;
  c_odds_rare      constant int := 31;
  c_odds_epic      constant int := 22;
  c_odds_legendary constant int := 9;
  c_odds_ancient   constant int := 3;
  v_rarities text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];
  v_odds     int[];
  v_x        double precision;
  v_lo       int := 0;
  v_i        int;
  v_rolled   int := 5;
  v_frac     double precision := 1;
  v_r        text;
  v_n        bigint;
  v_idx      bigint;
  v_pick     text;
begin
  v_odds := array[c_odds_common, c_odds_rare, c_odds_epic, c_odds_legendary, c_odds_ancient];
  -- the rarity: the first band (in rarity order) the draw falls under; where it fell inside that band is v_frac
  v_x := least(greatest(coalesce(p_draw, 0), 0), 1) * 100;
  for v_i in 1..5 loop
    if v_x < v_lo + v_odds[v_i] then
      v_rolled := v_i;
      v_frac := (v_x - v_lo) / v_odds[v_i];
      exit;
    end if;
    v_lo := v_lo + v_odds[v_i];
  end loop;
  -- the rolled rarity first, then the nearest rarity with something left (ties toward the more common one)
  for v_r in select v_rarities[g] from generate_series(1, 5) as g order by abs(g - v_rolled), g loop
    select count(*) into v_n
      from public.progression_crate_pool(p_user) p
      join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
      where c.rarity = v_r;
    if v_n > 0 then
      -- every item of the rarity equally likely: the draw's place in the band indexes the items in id order
      v_idx := least(v_n - 1, greatest(0, floor(v_frac * v_n)::bigint));
      select p.pool_cosmetic_id into v_pick
        from public.progression_crate_pool(p_user) p
        join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
        where c.rarity = v_r
        order by p.pool_cosmetic_id collate "C"
        offset v_idx limit 1;
      return v_pick;
    end if;
  end loop;
  return null;
end;
$$;

-- ── 2. open_crate: THE opening transaction. Service role only. ──────────────────────────────────────────
-- Per-user advisory lock (the same one the settlement takes, so two openings of DIFFERENT crates serialize and
-- can never pick the same item) → the crate row FOR UPDATE (an opened crate returns its committed reward as
-- `already_opened`) → an empty pool answers `pool_exhausted` and writes nothing → ONE draw through
-- progression_crate_pick → ownership insert (unique key = the final guard) + the crate marked opened, together.
create or replace function public.open_crate(p_user uuid, p_crate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_roll_version constant int := 4;
  v_crate   public.loot_crates%rowtype;
  v_enabled boolean;
  v_pick    text;
  v_rows    int;
  v_sealed  int;
begin
  if p_user is null or p_crate_id is null then raise exception 'bad_crate_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  select * into v_crate from public.loot_crates where crate_id = p_crate_id and user_id = p_user for update;
  if not found then raise exception 'crate_not_found'; end if;

  if v_crate.state = 'opened' then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'already_opened', 'crate', public.progression_crate_json(v_crate),
      'rewardId', v_crate.reward_cosmetic_id, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
  end if;

  select crates_enabled into v_enabled from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'crates_disabled'; end if;

  if not exists (select 1 from public.progression_crate_pool(p_user)) then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'pool_exhausted', 'crate', public.progression_crate_json(v_crate),
      'rewardId', null, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
  end if;

  -- ONE draw: the rarity at the fixed odds, then an item of it (mirror of pickCrateReward).
  v_pick := public.progression_crate_pick(p_user, random());
  if v_pick is null then raise exception 'duplicate_reward'; end if;

  insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
    values (p_user, v_pick, 'crate', p_crate_id::text)
    on conflict (user_id, cosmetic_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'duplicate_reward'; end if;

  update public.loot_crates set state = 'opened', reward_cosmetic_id = v_pick, roll_version = c_roll_version, opened_at = now()
    where crate_id = p_crate_id and state = 'sealed'
    returning * into v_crate;
  if not found then raise exception 'crate_not_found'; end if;

  -- A new title is worn at once only when the player wears none; the revision moves so mirrors adopt the change.
  update public.profiles set
    equipped_title_id = coalesce(equipped_title_id,
      (select c.cosmetic_id from public.cosmetic_catalog c where c.cosmetic_id = v_pick and c.category = 'title')),
    progression_revision = progression_revision + 1,
    updated_at = now()
  where user_id = p_user;

  select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
  return jsonb_build_object('status', 'opened', 'crate', public.progression_crate_json(v_crate),
    'rewardId', v_pick, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 3. Grants: service role only ─────────────────────────────────────────────────────────────────────────
revoke all on function public.progression_crate_pick(uuid, double precision) from public, anon, authenticated;
grant execute on function public.progression_crate_pick(uuid, double precision) to service_role;
revoke all on function public.open_crate(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_crate(uuid, uuid) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- FINAL-BOARD RUN STRENGTH: a run's strength is its last board's percentile  (2026-10-03, R-LOBBY-09 amended)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-30-board-strength.sql and 2026-09-30-weighted-strength.sql.
-- Idempotent: safe to re-run. The same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-10-03-final-board-strength.md.
--
-- WHY (owner 2026-10-03: "i think we basically only care about the final board strength as an indicator for
-- matchmaking. can we try swapping out our algorithm for simply caring about the snapshots final round board
-- strength?"). A run that was dominant in rounds 3-9 and weak at the end (Rooks / Albus, 2026-10-02: a 12th-percentile
-- final board) read as 83 under the round-weighted average ranked among runs.
--
--  - `pool_runs.strength` becomes the percentile of the run's FINAL board: the boards at the run's highest scored
--    `boards.wave`, each board's percentile within its reference wave (`board_strength_pct`, unchanged), averaged and
--    rounded half up when a round has two boards (`board_strength_final`, the SQL twin of the TS `finalFromSum` /
--    `runFinalStrengthOf`, parity-tested in packages/sim/src/lobby/boardStrength.db.test.ts). Used DIRECTLY, not
--    re-ranked among runs: 30 means "the final board beat about 30% of the boards seen at that round".
--  - A run whose last round was never scored falls back to its latest scored round. Unscored runs stay null (inside
--    every band, as before).
--  - `pool_runs.strength_avg` keeps the round-weighted average (2026-09-30) as a diagnostic. `run_strength_histogram`
--    still reads it, so clients deployed before this change keep working (they freeze the old number on their own
--    games until they update); the new client no longer reads it.
--  - The rank-among-runs step is gone: a run's strength now depends only on its own boards and the board population,
--    so a refresh writes the runs it was asked about (and every run on the 10-minute full refresh).
--
-- Locks: the board-strength migration deadlocked against live pool reads, so everything runs in one transaction that
-- takes both tables first.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. The final board's value (mirrors finalFromSum in boardStrength.ts) ─────────────────────────────────────
-- The mean of n whole percentiles summing to s, rounded half up as floor((2 s + n) / (2 n)), clamped to 1..100.
create or replace function public.board_strength_final(p_sum bigint, p_n bigint) returns int
language sql immutable as $$
  select case when coalesce(p_n, 0) <= 0 then null
              else least(100, greatest(1, ((2 * coalesce(p_sum, 0) + p_n) / (2 * p_n))::int)) end
$$;

-- ── 2. pool_strength_refresh: strength = the final board's percentile (same signature) ─────────────────────
create or replace function public.pool_strength_refresh(p_author text[] default null, p_hero text[] default null, p_seed bigint[] default null) returns int
language plpgsql set search_path = public as $$
declare v int;
begin
  with keys as (
    select r.id, r.author, r.hero_id, r.seed from public.pool_runs r
    where p_author is null
       or (r.author, r.hero_id, r.seed) in (select k.a, k.h, k.s from unnest(p_author, p_hero, p_seed) as k(a, h, s))
  ),
  c as (select * from public.board_strength_cumulative()),
  pct as (
    select k.id as run_id, x.wave, public.board_strength_pct(c.below, c.n, c.total) as p
    from keys k
    join public.boards x on coalesce(x.author, 'anon') = k.author and x.hero_id = k.hero_id and x.seed = k.seed
    join c on c.strength_ref = x.strength_ref and c.strength_wave = x.strength_wave and c.strength_raw = x.strength_raw
    where x.strength_raw is not null
  ),
  scored as (select run_id, wave, p, max(wave) over (partition by run_id) as last_wave from pct where p is not null),
  fin as (select run_id, sum(p)::bigint as s, count(*) as n from scored where wave = last_wave group by run_id),
  grp as (
    select run_id,
           sum(p) filter (where wave <= 5)::bigint as s1, count(p) filter (where wave <= 5) as n1,
           sum(p) filter (where wave between 6 and 9)::bigint as s2, count(p) filter (where wave between 6 and 9) as n2,
           sum(p) filter (where wave >= 10)::bigint as s3, count(p) filter (where wave >= 10) as n3
    from scored group by run_id
  ),
  agg as (
    select g.run_id,
           public.board_strength_weighted_avg(g.s1, g.n1, g.s2, g.n2, g.s3, g.n3)::numeric as a,
           public.board_strength_final(f.s, f.n)::numeric as s
    from grp g join fin f on f.run_id = g.run_id
  )
  update public.pool_runs r
     set strength_avg = (select a.a from agg a where a.run_id = r.id),
         strength = (select a.s from agg a where a.run_id = r.id),
         strength_at = now()
  from keys k where r.id = k.id;
  get diagnostics v = row_count;
  return v;
end $$;

-- ── 3. Who may call what ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public.pool_strength_refresh(text[], text[], bigint[]) from public, anon, authenticated;

-- ── 4. One-time: recompute every run's strength as its final board ───────────────────────────────────────────
select public.pool_strength_refresh(null, null, null);

commit;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: +50% PLACEMENT BONUS XP (Top 4 40 -> 60, 1st 60 -> 90)  (2026-10-03)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-29-hero-titles.sql (the last file that defined
-- `settle_progression`). THEN deploy the `submit-progression` Edge Function (its shared rules carry the same
-- numbers and flag `parity: false` on a mismatch, so run the SQL FIRST and deploy straight after). Idempotent: it
-- only REPLACES `settle_progression` (re-granted) and writes no rows, so re-running it is always safe. The same
-- block is appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-10-03-placement-xp.md.
-- It SUPERSEDES the writer in 2026-09-29-hero-titles.sql: if that file (or the achievements, crates or MVP file) is
-- ever re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-10-03: "increase XP for top 4 and for wins per game", choice "+50% bonuses"):
--  - `c_top_four` 40 -> 60 and `c_first_place` 60 -> 90. A Ranked 1st is now 250 (was 200), a Top 4 160 (was 140),
--    5th to 8th unchanged at 100; the comeback stays +25. Practice still earns 60% of the Ranked equivalent through
--    the same integer arithmetic (1st 150, Top 4 96, 5th to 8th 60).
--  - Every other line of the function is byte-for-byte the 2026-09-29 hero titles writer (sqlParity.test.ts checks
--    every constant). `c_rules` stays 1: the client never computes XP, it shows the server's result, so an older
--    client and a queued submission settle normally.
--  - No backfill: games settled before this runs keep the XP they earned.
--
-- THE RULES LIVE IN TWO PLACES that must agree: this file and packages/progression/src/rules.ts (XP_RULES).

-- ── 1. settle_progression: the placement bonuses at +50% ─────────────────────────────────────────────────
create or replace function public.settle_progression(
  p_user uuid, p_mode text, p_run_id text, p_source_id bigint default null, p_comeback boolean default false,
  p_rules_version int default null, p_facts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of XP_RULES / CURVE in packages/progression/src/rules.ts — change all copies together)
  c_rules             constant int := 1;
  c_curve             constant int := 1;
  c_complete          constant int := 100;
  c_top_four          constant int := 60;
  c_first_place       constant int := 90;
  c_comeback          constant int := 25;
  c_comeback_streak   constant int := 4;
  c_practice_percent  constant int := 60;
  c_practice_flat     constant int := 60;
  c_tutorial          constant int := 250;
  c_tutorial_course   constant text := 'learn-ascent';
  c_tutorial_version  constant int := 1;
  c_alpha_title       constant text := 'alpha_tester';
  c_alpha_level       constant int := 2;
  c_rate_max          constant int := 30;
  c_rate_window       constant interval := interval '10 minutes';
  -- ACHIEVEMENTS (mirror of packages/progression/src/achievements.ts)
  c_meta_metric       constant text := 'achievementsCompleted';
  c_brutal_strength   constant int := 70;
  c_ascendant_div     constant int := 15;
  c_metric_max        constant bigint := 1000000000;
  -- HERO TITLES (mirror of heroTitleId / heroMasterTitleId in packages/progression/src/cosmetics.ts)
  c_hero_title_prefix constant text := 'title_hero_';
  c_master_suffix     constant text := '_master';

  prof        public.profiles%rowtype;
  prev        public.progression_results%rowtype;
  v_epoch     timestamptz;
  v_recent    int;
  v_source_at timestamptz;
  v_source    text := null;
  v_placement int := null;
  v_comeback  boolean := false;
  v_seed      bigint;
  v_cfg       jsonb;
  v_record    jsonb;
  v_wins      int;
  v_losses    int;
  r_top int := 0; r_first int := 0; r_come int := 0; v_ranked_total int;
  v_base int := 0; v_top int := 0; v_first int := 0; v_come int := 0; v_total int;
  v_xp0 bigint; v_xp1 bigint; v_l0 int; v_l1 int;
  v_unlocked  text[] := '{}';
  v_equipped  text;
  v_rows      int;
  v_facts_ver int := null;
  v_enrolling boolean;
  v_crate_ids uuid[] := '{}';
  -- achievements
  v_ach_epoch  timestamptz;
  v_promoted   boolean := false;
  v_div_before int := null;
  v_demo_game  boolean := false;
  v_demoted    boolean := false;
  v_strength   int := null;
  v_hero       text := null;
  v_set        text := null;
  v_run_ok     boolean := false;
  v_metrics    jsonb := '{}';
  v_first_streak int := 0;
  v_top_streak int := 0;
  v_heroes_played int := 0;
  v_heroes_won int := 0;
  v_done_count int := 0;
  d            public.achievement_catalog%rowtype;
  v_val        bigint;
  v_old        bigint;
  v_done       boolean;
  v_new        bigint;
  v_ach_ids    text[] := '{}';
  v_ach_xp     int := 0;
  v_hero_title text := null;
begin
  -- 1. validate
  if p_mode is null or p_mode not in ('ranked', 'practice', 'tutorial') then raise exception 'bad_mode'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. serialize per user (every progression entry point takes the advisory lock first), then lock the row
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.progression_results where user_id = p_user and run_id = p_run_id and mode = p_mode;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
  end if;

  -- 4. the switch: nothing is awarded before the owner sets the epoch
  select epoch, achievements_epoch into v_epoch, v_ach_epoch from public.progression_config where id = 1;
  if v_epoch is null then raise exception 'progression_disabled'; end if;

  -- 5. rate limit (technical only: a refused request is retried later and keeps its XP)
  select count(*) into v_recent from public.progression_results
    where user_id = p_user and settled_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 6. the SOURCE row: the placement comes from here, never from the request
  if p_mode = 'ranked' then
    select rr.placement, rr.seed, rr.created_at, rr.promoted, rr.division_before, rr.was_demotion_game, rr.demoted, rr.lobby_strength
      into v_placement, v_seed, v_source_at, v_promoted, v_div_before, v_demo_game, v_demoted, v_strength
      from public.rank_results rr where rr.user_id = p_user and rr.run_id = p_run_id;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_run_id;
    v_comeback := coalesce(p_comeback, false);
    if v_comeback and v_seed is not null then
      select h.wins, case when (h.entry->>'losses') ~ '^[0-9]+$' then (h.entry->>'losses')::int end
        into v_wins, v_losses
        from public.run_history h
        where h.user_id = p_user and h.mode = 'lobby' and h.entry->>'seed' = v_seed::text
        order by h.created_at desc limit 1;
      if found and (coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1) then v_comeback := false; end if;
    end if;
  elsif p_mode = 'practice' then
    if p_source_id is null or p_source_id < 1 then raise exception 'bad_source'; end if;
    if p_run_id is distinct from ('practice:' || p_source_id::text) then raise exception 'bad_run_id'; end if;
    select pg.placement, pg.config, pg.record, pg.created_at, pg.hero_id into v_placement, v_cfg, v_record, v_source_at, v_hero
      from public.practice_games pg where pg.id = p_source_id and pg.user_id = p_user;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_source_id::text;
    -- No meaningful placement: an Unlimited Health game plays to the curtain and is never eliminated (and a row
    -- with no options recorded is treated the same way). It earns the flat XP, no placement or comeback bonus.
    if v_cfg is null or coalesce(v_cfg->>'health', 'unlimited') <> 'normal'
       or v_placement is null or v_placement < 1 or v_placement > 8 then
      v_placement := null;
    end if;
    v_comeback := coalesce(p_comeback, false) and v_placement is not null;
    if v_comeback and v_record is not null then
      v_wins := case when (v_record->>'wins') ~ '^[0-9]+$' then (v_record->>'wins')::int end;
      v_losses := case when (v_record->>'losses') ~ '^[0-9]+$' then (v_record->>'losses')::int end;
      if coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1 then v_comeback := false; end if;
    end if;
  else
    -- tutorial: one claim per account per course version (the ledger check above already caught a repeat)
    if p_run_id is distinct from (c_tutorial_course || ':v' || c_tutorial_version::text) then raise exception 'bad_run_id'; end if;
    insert into public.tutorial_progression_claims (user_id, course_id, course_version, xp_awarded)
      values (p_user, c_tutorial_course, c_tutorial_version, c_tutorial)
      on conflict (user_id, course_id, course_version) do nothing;
    v_source := c_tutorial_course || ':' || c_tutorial_version::text;
  end if;

  -- 7. XP (mirror of xpForSettlement)
  if p_mode = 'tutorial' then
    v_base := c_tutorial;
  elsif p_mode = 'practice' and v_placement is null then
    v_base := c_practice_flat;
  else
    r_top   := case when v_placement <= 4 then c_top_four else 0 end;
    r_first := case when v_placement = 1 then c_first_place else 0 end;
    r_come  := case when v_comeback then c_comeback else 0 end;
    if p_mode = 'ranked' then
      v_base := c_complete; v_top := r_top; v_first := r_first; v_come := r_come;
    else
      -- Practice: 60% of the equivalent ranked XP, summed then rounded; the remainder lands on the base.
      v_ranked_total := c_complete + r_top + r_first + r_come;
      v_top   := (r_top   * c_practice_percent + 50) / 100;
      v_first := (r_first * c_practice_percent + 50) / 100;
      v_come  := (r_come  * c_practice_percent + 50) / 100;
      v_base  := (v_ranked_total * c_practice_percent + 50) / 100 - v_top - v_first - v_come;
    end if;
  end if;
  v_total := v_base + v_top + v_first + v_come;

  if p_facts is not null and jsonb_typeof(p_facts) = 'object' and (p_facts->>'version') ~ '^[0-9]+$' then
    v_facts_ver := (p_facts->>'version')::int;
  end if;

  -- 7b. ACHIEVEMENTS (mirror of evaluateAchievements in packages/progression/src/achievements.ts). Only once the
  -- owner has set the achievements epoch, and only for a game whose source row is not older than it.
  if v_ach_epoch is not null and coalesce(v_source_at, now()) >= v_ach_epoch then
    -- The `any` gate: Ranked, or a standard Practice (Normal Health, so a real placement, AND a turn timer).
    v_run_ok := p_mode = 'ranked'
      or (p_mode = 'practice' and v_placement is not null and coalesce(v_cfg->>'timeMult', '') ~ '^[1-9][0-9]*$');
    if p_mode = 'ranked' then v_hero := p_facts->>'heroId'; end if;
    if v_hero is not null and v_hero !~ '^[A-Za-z0-9_.-]{1,64}$' then v_hero := null; end if;
    v_set := p_facts->>'setId';
    if v_set is not null and v_set !~ '^[A-Za-z0-9_.-]{1,32}$' then v_set := null; end if;

    -- Distinct heroes: this game counts toward its hero when it is an eligible game.
    if v_run_ok and v_hero is not null then
      insert into public.achievement_hero_stats (user_id, hero_id, games, firsts)
        values (p_user, v_hero, 1, case when p_mode = 'ranked' and v_placement = 1 then 1 else 0 end)
        on conflict (user_id, hero_id) do update set
          games = public.achievement_hero_stats.games + 1,
          firsts = public.achievement_hero_stats.firsts + excluded.firsts,
          updated_at = now();
    end if;
    select count(*) filter (where s.games > 0), count(*) filter (where s.firsts > 0) into v_heroes_played, v_heroes_won
      from public.achievement_hero_stats s where s.user_id = p_user;

    -- Ranked streaks, over Ranked games since the achievements epoch, ending with this one.
    if p_mode = 'ranked' then
      with r as (
        select rr.placement, row_number() over (order by rr.created_at desc, rr.run_id desc) as rn
        from public.rank_results rr
        where rr.user_id = p_user and rr.created_at >= v_ach_epoch and rr.created_at <= v_source_at
      )
      select coalesce((select min(rn) from r where placement <> 1) - 1, (select count(*) from r)),
             coalesce((select min(rn) from r where placement > 4) - 1, (select count(*) from r))
        into v_first_streak, v_top_streak;
    end if;

    -- The metrics: the client's run metrics (V2), overwritten by every server metric (a client can never name one).
    if coalesce(v_facts_ver, 0) >= 2 and jsonb_typeof(p_facts->'metrics') = 'object' then v_metrics := p_facts->'metrics'; end if;
    v_metrics := v_metrics || jsonb_build_object(
      'game', 1,
      'comeback', case when v_comeback then 1 else 0 end,
      'highestDivision', coalesce(prof.rank_highest_division, 0),
      'promoted', case when p_mode = 'ranked' and v_promoted then 1 else 0 end,
      'ascendantFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_div_before, 0) >= c_ascendant_div then 1 else 0 end,
      'demotionEscape', case when p_mode = 'ranked' and v_demo_game and not v_demoted and v_placement <= 4 then 1 else 0 end,
      'brutalFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_strength, 0) >= c_brutal_strength then 1 else 0 end,
      'firstStreak', v_first_streak,
      'topFourStreak', v_top_streak,
      'heroesPlayed', v_heroes_played,
      'heroesWon', v_heroes_won,
      c_meta_metric, 0
    );

    -- Pass 1: every live, non-prestige, non-meta definition, in id order. Pass 2: the meta family, by target.
    select count(*) into v_done_count from public.achievement_completions c where c.user_id = p_user;
    for d in
      select * from public.achievement_catalog c
      where c.active and not c.admin_off and c.trust <> 'P'
      order by (c.metric = c_meta_metric), case when c.metric = c_meta_metric then c.target else 0 end, c.achievement_id collate "C"
    loop
      continue when d.mode = 'ranked' and p_mode <> 'ranked';
      continue when d.mode = 'tutorial' and p_mode <> 'tutorial';
      continue when d.mode = 'any' and not v_run_ok;
      continue when d.set_id is not null and v_set is distinct from d.set_id;
      continue when d.hero_id is not null and v_hero is distinct from d.hero_id;
      continue when d.placement_max is not null and (v_placement is null or v_placement > d.placement_max);
      if d.metric = c_meta_metric then
        v_val := v_done_count;
      elsif jsonb_typeof(v_metrics->d.metric) = 'number' then
        v_val := least(c_metric_max, greatest(0, floor((v_metrics->>d.metric)::numeric)))::bigint;
      else
        v_val := 0;
      end if;
      continue when v_val <= 0;
      select ap.progress, ap.completed_at is not null into v_old, v_done
        from public.achievement_progress ap where ap.user_id = p_user and ap.achievement_id = d.achievement_id;
      if not found then v_old := 0; v_done := false; end if;
      continue when v_done;
      v_new := case when d.agg = 'sum' then v_old + v_val else greatest(v_old, v_val) end;
      continue when v_new = v_old and v_new < d.target;
      insert into public.achievement_progress (user_id, achievement_id, definition_version, progress, completed_at, completion_run_id, updated_at)
        values (p_user, d.achievement_id, d.version, v_new,
                case when v_new >= d.target then now() end, case when v_new >= d.target then p_run_id end, now())
        on conflict (user_id, achievement_id) do update set
          definition_version = excluded.definition_version, progress = excluded.progress,
          completed_at = excluded.completed_at, completion_run_id = excluded.completion_run_id, updated_at = now();
      if v_new >= d.target then
        insert into public.achievement_completions (user_id, achievement_id, run_id, mode, xp_awarded, title_id)
          values (p_user, d.achievement_id, p_run_id, p_mode, d.xp, d.title_id)
          on conflict (user_id, achievement_id) do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          v_ach_ids := array_append(v_ach_ids, d.achievement_id);
          v_ach_xp := v_ach_xp + d.xp;
          v_done_count := v_done_count + 1;
          -- 7c. A TITLE reward (hero titles, owner 2026-09-29) is granted in the same transaction. Only a title the
          -- catalog knows (the ownership FK); the grant is keyed, so a retry or the backfill never doubles it.
          if d.title_id is not null and exists (select 1 from public.cosmetic_catalog c where c.cosmetic_id = d.title_id and c.category = 'title') then
            insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
              values (p_user, d.title_id, 'achievement', d.achievement_id)
              on conflict (user_id, cosmetic_id) do nothing;
            get diagnostics v_rows = row_count;
            if v_rows > 0 then
              v_unlocked := array_append(v_unlocked, d.title_id);
              if d.title_id like c_hero_title_prefix || '%' then v_hero_title := d.title_id; end if;
            end if;
          end if;
        end if;
      end if;
    end loop;
  end if;

  -- 8. levels (lifetime XP; the level is derived). Achievement XP counts toward the level and its crates.
  v_xp0 := coalesce(prof.account_xp, 0);
  v_xp1 := v_xp0 + v_total + v_ach_xp;
  v_l0 := public.progression_level_of(v_xp0);
  v_l1 := public.progression_level_of(v_xp1);

  -- 9. titles: Alpha Tester for EVERY account at Level 2 (owner 2026-09-27); equipped when nothing else is
  if v_l1 >= c_alpha_level then
    insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
      values (p_user, c_alpha_title, 'level', p_mode || ':' || p_run_id)
      on conflict (user_id, cosmetic_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_unlocked := array_append(v_unlocked, c_alpha_title); end if;
  end if;
  v_equipped := prof.equipped_title_id;
  -- 9a. HERO TITLES (owner 2026-09-29). The master UPGRADES the title in place: a newly earned master replaces its own
  -- base title when that is the one worn. A new hero title is worn when nothing is (like Alpha Tester).
  if v_equipped is not null and v_equipped like c_hero_title_prefix || '%' and (v_equipped || c_master_suffix) = any(v_unlocked) then
    v_equipped := v_equipped || c_master_suffix;
  end if;
  if v_equipped is null and v_hero_title is not null then
    v_equipped := v_hero_title;
  end if;
  if v_equipped is null and exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c_alpha_title) then
    v_equipped := c_alpha_title;
  end if;

  -- 9b. crates: one sealed crate per newly reached level; enrollment (the first settlement) also grants the
  -- Level 1 Welcome Crate. The unique (user, level) key makes this safe against the backfill and any retry.
  v_enrolling := prof.progression_enrolled_at is null;
  with ins as (
    insert into public.loot_crates (user_id, earned_level, source_id)
      select p_user, g.lvl, p_mode || ':' || p_run_id
      from generate_series(case when v_enrolling then 1 else v_l0 + 1 end, v_l1) as g(lvl)
      on conflict (user_id, earned_level) do nothing
      returning crate_id, earned_level
  )
  select coalesce(array_agg(ins.crate_id order by ins.earned_level), '{}') into v_crate_ids from ins;

  -- 10. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    account_xp = v_xp1, account_level = v_l1,
    progression_revision = prof.progression_revision + 1,
    progression_enrolled_at = coalesce(prof.progression_enrolled_at, now()),
    progression_curve_version = c_curve,
    equipped_title_id = v_equipped,
    updated_at = now()
  where user_id = p_user;

  insert into public.progression_results (
    user_id, run_id, mode, source_id, rules_version, curve_version, facts_version, facts,
    placement, comeback, base_xp, top_four_xp, first_place_xp, comeback_xp, achievement_xp, total_xp,
    xp_before, xp_after, level_before, level_after, revision_before, revision_after,
    crates_awarded, crate_ids, achievement_ids, unlocked_title_ids
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, v_ach_xp, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    coalesce(array_length(v_crate_ids, 1), 0), v_crate_ids, v_ach_ids, v_unlocked
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 2. Grants: the writer is service role ONLY (the Edge Function calls it) ────────────────────────────────
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- WEIGHTED RUN STRENGTH, AGAIN: back to the round-weighted average ranked among runs  (2026-10-06, R-LOBBY-12)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-03-final-board-strength.sql (it is safe on a database
-- that never ran that file too). Idempotent: safe to re-run. The same block is appended to schema.sql; keep the two
-- identical. Owner runbook: docs/devlog/2026-10-06-strength-back-to-weighted.md.
--
-- WHY (owner 2026-10-06: "matchmaking algorithm -> backtrack to the weighted version"). Under the final-board formula
-- (2026-10-03) a run's strength correlated only ~0.03-0.19 with its board percentile in rounds 3-7, against 0.26-0.62
-- for the weighted version, and Bronze lobbies were dealing round-7 boards at the 88th percentile labelled
-- "Game strength 2".
--
--  - `pool_strength_refresh` goes back to EXACTLY the 2026-09-30-weighted-strength.sql definition:
--    `pool_runs.strength_avg` = the round-weighted average of the run's board percentiles (rounds 1-5 share 20%,
--    6-9 share 35%, 10+ share 45%; `board_strength_weighted_avg`, unchanged), and `pool_runs.strength` = that average
--    RANKED among the runs of its set by the same tie-halving rule as a board (`board_strength_pct`). The SQL twins of
--    the TS `runWeightedAverageOf` / `runPercentileOf`, parity-tested in packages/sim/src/lobby/boardStrength.db.test.ts.
--  - `board_strength_final` (2026-10-03) is left in place, unused: dropping it buys nothing and a re-run of the
--    2026-10-03 file would need it.
--  - `run_strength_histogram` (unchanged since 2026-09-30) is what the client ranks its own finished game against.
--  - The closing refresh recomputes every run, so the bands flip the moment this file runs.
--
-- Locks: the board-strength migration deadlocked against live pool reads, so everything runs in one transaction that
-- takes both tables first.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. pool_strength_refresh: the weighted average, ranked among runs (same signature) ──────────────────────
create or replace function public.pool_strength_refresh(p_author text[] default null, p_hero text[] default null, p_seed bigint[] default null) returns int
language plpgsql set search_path = public as $$
declare v int;
begin
  with keys as (
    select r.id, r.author, r.hero_id, r.seed from public.pool_runs r
    where p_author is null
       or (r.author, r.hero_id, r.seed) in (select k.a, k.h, k.s from unnest(p_author, p_hero, p_seed) as k(a, h, s))
  ),
  c as (select * from public.board_strength_cumulative()),
  pct as (
    select k.id as run_id, x.wave, public.board_strength_pct(c.below, c.n, c.total) as p
    from keys k
    join public.boards x on coalesce(x.author, 'anon') = k.author and x.hero_id = k.hero_id and x.seed = k.seed
    join c on c.strength_ref = x.strength_ref and c.strength_wave = x.strength_wave and c.strength_raw = x.strength_raw
    where x.strength_raw is not null
  ),
  grp as (
    select run_id,
           sum(p) filter (where wave <= 5)::bigint as s1, count(p) filter (where wave <= 5) as n1,
           sum(p) filter (where wave between 6 and 9)::bigint as s2, count(p) filter (where wave between 6 and 9) as n2,
           sum(p) filter (where wave >= 10)::bigint as s3, count(p) filter (where wave >= 10) as n3
    from pct where p is not null group by run_id
  ),
  agg as (select run_id, public.board_strength_weighted_avg(s1, n1, s2, n2, s3, n3)::numeric as s from grp)
  update public.pool_runs r set strength_avg = (select a.s from agg a where a.run_id = r.id), strength_at = now()
  from keys k where r.id = k.id;
  get diagnostics v = row_count;

  -- Every run's rank among the runs of its set: below = runs with a lower average, equal = runs with the same average
  -- (itself included), n = runs with an average. The same `board_strength_pct` rule as a board.
  with ranked as (
    select r.id, public.board_strength_pct(
      (rank() over w - 1)::bigint,
      count(*) over (partition by r.set_id, r.strength_avg),
      count(*) over (partition by r.set_id))::numeric as s
    from public.pool_runs r
    where r.strength_avg is not null
    window w as (partition by r.set_id order by r.strength_avg)
  )
  update public.pool_runs r set strength = x.s
  from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id) x
  where r.id = x.id and r.strength is distinct from x.s;
  return v;
end $$;

-- ── 2. Who may call what ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public.pool_strength_refresh(text[], text[], bigint[]) from public, anon, authenticated;

-- ── 3. One-time: recompute every run's average and strength (weighted, ranked among runs) ────────────────────
select public.pool_strength_refresh(null, null, null);

commit;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- EARLY / LATE RUN STRENGTH: two more ratings per run, and rank bands that blend them  (2026-10-06, R-LOBBY-13)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-06-weighted-strength-again.sql. Idempotent: safe to
-- re-run. The same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-10-06-early-late-strength-bands.md.
--
-- WHY (owner 2026-10-06: "perhaps we have multiple ratings like the weighted system / and we lean into those different
-- ratings depending on the rank / and then open it up to anything goes after a certain rank / ... early is 1-9 / late
-- is 10+ / for bronze we should have a near 100% focus on making sure that the early board strength stat is 0-20 or
-- w/e / then silver is like 10-30 with an 80% weight / etc / then gold is 10-50 with 60% weight", then "Blend, then
-- band" and "Open from Platinum"):
--
--  - `pool_runs.strength_early_avg` / `strength_late_avg`: the PLAIN mean of the run's board percentiles in rounds 1-9
--    / rounds 10+ (`boards.wave`), rounded half up to 1..100 (`board_strength_mean`, the same body as
--    `board_strength_final`). Null for a side with no scored board (a run that ended before round 10 has no late).
--  - `pool_runs.strength_early` / `strength_late`: each average RANKED among the runs of its set by the same
--    tie-halving rule as a board (`board_strength_pct`), exactly as `strength` ranks `strength_avg`. The SQL twins of
--    the TS `earlyLateStrengthOf` / `rankAmongRuns`, parity-tested in packages/sim/src/lobby/boardStrength.db.test.ts.
--  - `pool_runs.strength` / `strength_avg` are computed EXACTLY as before (2026-10-06-weighted-strength-again.sql):
--    they stay the "Game strength" a player sees, and what a client from before this change filters on.
--  - `pool_match_score(strength, early, late, weight)`: a run's score for a rank, `weight x early + (1 - weight) x
--    late`; early alone when late is null (late alone when only late exists); the weighted strength when neither is
--    known; the weighted strength itself when the weight is null. The SQL twin of the TS `matchScoreOf`.
--  - `pool_runs_sample` gains `p_early_weight` and returns `strength_early` / `strength_late`. With a weight, the band
--    (`p_strength_min` .. `p_strength_max`) filters the blended score; WITHOUT one it filters `strength`, so a client
--    deployed before this change (it never sends a weight) keeps exactly its 2026-09-30 behaviour. An unscored run
--    (null score) is inside every band, as before. Still uniform inside the band, whole runs.
--  - The closing refresh recomputes every run, so the new bands have their numbers the moment this file runs.
--
-- Locks: the board-strength migration deadlocked against live pool reads, so everything runs in one transaction that
-- takes both tables first.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. Columns ─────────────────────────────────────────────────────────────────────────────────────────────
alter table public.pool_runs add column if not exists strength_early_avg numeric; -- mean board percentile, rounds 1-9
alter table public.pool_runs add column if not exists strength_late_avg numeric;  -- mean board percentile, rounds 10+
alter table public.pool_runs add column if not exists strength_early numeric;     -- early average ranked among runs 1..100
alter table public.pool_runs add column if not exists strength_late numeric;      -- late average ranked among runs 1..100

-- ── 2. The mean (mirrors meanFromSum in boardStrength.ts) ──────────────────────────────────────────────────
-- The mean of n whole percentiles summing to s, rounded half up as floor((2 s + n) / (2 n)), clamped to 1..100.
create or replace function public.board_strength_mean(p_sum bigint, p_n bigint) returns int
language sql immutable as $$
  select case when coalesce(p_n, 0) <= 0 then null
              else least(100, greatest(1, ((2 * coalesce(p_sum, 0) + p_n) / (2 * p_n))::int)) end
$$;

-- ── 3. A run's score for a rank (mirrors matchScoreOf in boardStrength.ts) ─────────────────────────────────
create or replace function public.pool_match_score(p_strength numeric, p_early numeric, p_late numeric, p_weight numeric) returns numeric
language sql immutable as $$
  select case
    when p_weight is null then p_strength
    when p_early is not null and p_late is not null
      then greatest(0, least(1, p_weight)) * p_early + (1 - greatest(0, least(1, p_weight))) * p_late
    when p_early is not null then p_early
    when p_late is not null then p_late
    else p_strength end
$$;

-- ── 4. pool_strength_refresh: the weighted strength exactly as before, plus early / late (same signature) ────
create or replace function public.pool_strength_refresh(p_author text[] default null, p_hero text[] default null, p_seed bigint[] default null) returns int
language plpgsql set search_path = public as $$
declare v int;
begin
  with keys as (
    select r.id, r.author, r.hero_id, r.seed from public.pool_runs r
    where p_author is null
       or (r.author, r.hero_id, r.seed) in (select k.a, k.h, k.s from unnest(p_author, p_hero, p_seed) as k(a, h, s))
  ),
  c as (select * from public.board_strength_cumulative()),
  pct as (
    select k.id as run_id, x.wave, public.board_strength_pct(c.below, c.n, c.total) as p
    from keys k
    join public.boards x on coalesce(x.author, 'anon') = k.author and x.hero_id = k.hero_id and x.seed = k.seed
    join c on c.strength_ref = x.strength_ref and c.strength_wave = x.strength_wave and c.strength_raw = x.strength_raw
    where x.strength_raw is not null
  ),
  grp as (
    select run_id,
           sum(p) filter (where wave <= 5)::bigint as s1, count(p) filter (where wave <= 5) as n1,
           sum(p) filter (where wave between 6 and 9)::bigint as s2, count(p) filter (where wave between 6 and 9) as n2,
           sum(p) filter (where wave >= 10)::bigint as s3, count(p) filter (where wave >= 10) as n3,
           sum(p) filter (where wave <= 9)::bigint as se, count(p) filter (where wave <= 9) as ne,
           sum(p) filter (where wave >= 10)::bigint as sl, count(p) filter (where wave >= 10) as nl
    from pct where p is not null group by run_id
  ),
  agg as (
    select run_id,
           public.board_strength_weighted_avg(s1, n1, s2, n2, s3, n3)::numeric as s,
           public.board_strength_mean(se, ne)::numeric as e,
           public.board_strength_mean(sl, nl)::numeric as l
    from grp
  )
  update public.pool_runs r
     set strength_avg = a.s, strength_early_avg = a.e, strength_late_avg = a.l, strength_at = now()
  from keys k left join agg a on a.run_id = k.id
  where r.id = k.id;
  get diagnostics v = row_count;

  -- Every run's rank among the runs of its set: below = runs with a lower average, equal = runs with the same average
  -- (itself included), n = runs with an average. The same `board_strength_pct` rule as a board. One window per rating.
  with ranked as (
    select r.id, public.board_strength_pct(
      (rank() over w - 1)::bigint,
      count(*) over (partition by r.set_id, r.strength_avg),
      count(*) over (partition by r.set_id))::numeric as s
    from public.pool_runs r
    where r.strength_avg is not null
    window w as (partition by r.set_id order by r.strength_avg)
  )
  update public.pool_runs r set strength = x.s
  from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id) x
  where r.id = x.id and r.strength is distinct from x.s;

  with ranked as (
    select r.id, public.board_strength_pct(
      (rank() over w - 1)::bigint,
      count(*) over (partition by r.set_id, r.strength_early_avg),
      count(*) over (partition by r.set_id))::numeric as s
    from public.pool_runs r
    where r.strength_early_avg is not null
    window w as (partition by r.set_id order by r.strength_early_avg)
  )
  update public.pool_runs r set strength_early = x.s
  from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id) x
  where r.id = x.id and r.strength_early is distinct from x.s;

  with ranked as (
    select r.id, public.board_strength_pct(
      (rank() over w - 1)::bigint,
      count(*) over (partition by r.set_id, r.strength_late_avg),
      count(*) over (partition by r.set_id))::numeric as s
    from public.pool_runs r
    where r.strength_late_avg is not null
    window w as (partition by r.set_id order by r.strength_late_avg)
  )
  update public.pool_runs r set strength_late = x.s
  from (select p.id, rk.s from public.pool_runs p left join ranked rk on rk.id = p.id) x
  where r.id = x.id and r.strength_late is distinct from x.s;
  return v;
end $$;

-- ── 5. The sample, with a blended band ─────────────────────────────────────────────────────────────────────
-- Replaces the 2026-09-30 signature (a changed return type cannot be `create or replace`d). Callers that pass only
-- the old arguments keep working: `p_early_weight` defaults to null, and then the band filters `strength` as before.
drop function if exists public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text);
create or replace function public.pool_runs_sample(
  p_limit int default 150,
  p_set text default null,
  p_patch_prefix text default null,
  p_exclude_user uuid default null,
  p_seed text default null,
  p_strength_min numeric default null,
  p_strength_max numeric default null,
  p_pool text default null,
  p_early_weight numeric default null
) returns table (run_key text, author text, user_id uuid, wave_count int, strength numeric, strength_early numeric, strength_late numeric, boards jsonb)
language plpgsql volatile set search_path = public as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 150), 0), 300);
  lo bigint; hi bigint; span bigint;
  picked bigint[] := '{}';
  cand bigint; tries int := 0; u double precision;
begin
  select min(r.id), max(r.id) into lo, hi from public.pool_runs r
  where r.eligible and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix);
  if lo is null or v_limit = 0 then return; end if;
  span := hi - lo + 1;

  if span <= 4 * v_limit then
    -- A small pool: every matching run, shuffled whole (bounded by the id span, so this stays small).
    select coalesce(array_agg(t.id order by t.k), '{}') into picked from (
      select r.id, case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || r.id) end as k
      from public.pool_runs r
      where r.id between lo and hi and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)))
      order by 2 limit v_limit) t;
  else
    -- Rejection sampling over the dense id range: exactly uniform over the matching runs, O(log n) per draw.
    -- A narrow band rejects more draws; the cap (64 per requested run) bounds the time either way.
    while coalesce(array_length(picked, 1), 0) < v_limit and tries < v_limit * 64 loop
      tries := tries + 1;
      u := case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || tries) end;
      cand := lo + least(floor(u * span)::bigint, span - 1);
      continue when cand = any(picked);
      perform 1 from public.pool_runs r
      where r.id = cand and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)));
      if found then picked := picked || cand; end if;
    end loop;
  end if;

  return query
  select r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count, r.strength,
         r.strength_early, r.strength_late,
         (select coalesce(jsonb_agg(x.snapshot order by x.wave, x.created_at, x.id), '[]'::jsonb) from public.boards x
          where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
            and jsonb_typeof(x.snapshot -> 'minions') = 'array' and jsonb_array_length(x.snapshot -> 'minions') > 0
            and coalesce(x.origin, 'self') <> 'synthetic')
  from unnest(picked) with ordinality as p(id, ord)
  join public.pool_runs r on r.id = p.id
  order by p.ord;
end $$;

-- ── 6. Who may call what ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public.pool_strength_refresh(text[], text[], bigint[]) from public, anon, authenticated;
grant execute on function public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text, numeric) to anon, authenticated;

-- ── 7. One-time: recompute every run (weighted strength unchanged; early / late filled) ──────────────────────
select public.pool_strength_refresh(null, null, null);

commit;

-- GOD MODE (owner 2026-10-08): one random real player board for a chosen round, for the Practice God Mode prompt
-- "What round should your opponent board be on?". Read-only; boards is already world-readable (select using (true)).
--
-- Cost: the candidate set is narrowed through `boards_wave_patch_idx` (round + build-version prefix), and the
-- sample is drawn ID-FIRST: only the candidate ids are collected, one is picked uniformly, and only that row's
-- snapshot is returned. It never sorts snapshots (`order by random()` over whole rows would). VOLATILE because it
-- calls random() (the client calls it as a plain POST RPC).
--
-- Idempotent: safe to re-run. The same block is appended to schema.sql; keep the two identical.

create index if not exists boards_wave_patch_idx on public.boards (wave, patch text_pattern_ops);

create or replace function public.god_board_sample(p_wave int, p_set text, p_patch_prefix text default null)
returns jsonb
language sql volatile set search_path = public as $$
  with c as (
    select array_agg(b.id) as ids
    from public.boards b
    where b.wave = p_wave
      and (p_patch_prefix is null or b.patch like p_patch_prefix || '%')
      and coalesce(b.origin, '') <> 'synthetic'
      and coalesce(b.snapshot->>'setId', 'set1') = p_set
      -- A non-array `minions` must not raise (jsonb_array_length would): the CASE guarantees the type check first.
      and case when jsonb_typeof(b.snapshot->'minions') = 'array'
               then jsonb_array_length(b.snapshot->'minions') > 0
               else false end
  )
  -- The pick is drawn ONCE (an uncorrelated scalar subquery), then looked up by primary key. Null when no candidates.
  select x.snapshot
  from public.boards x
  where x.id = (select c.ids[1 + floor(random() * cardinality(c.ids))::int] from c)
$$;

grant execute on function public.god_board_sample(int, text, text) to anon, authenticated;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- OVERALL STRENGTH CAPS: Bronze 40, Silver 60, Gold 75 on top of the early / late bands  (2026-10-09, R-LOBBY-15)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-06-early-late-strength.sql. Idempotent: safe to re-run.
-- The same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-10-09-strength-overall-caps.md.
--
-- WHY (owner 2026-10-09: "we want to add overall board strength caps on TOP of the existing early rating strength
-- matching. if a boards overall strength is over 40, it should n ever be in bronze. if a boards overall stength is over
-- 60 it should never be in silver. if a boards overall strength is over 75 it should never be in gold. from there,
-- theres no additional cap"):
--
--  - `pool_runs_sample` gains `p_strength_cap numeric default null`. With it, a run whose WEIGHTED `strength` (the
--    "Game strength" number, not the early / late blend) is ABOVE the cap is never drawn; exactly the cap is allowed.
--    A run with no `strength` yet (unscored) is still drawn. The early / late band (`p_strength_min` /
--    `p_strength_max` / `p_early_weight`) is checked exactly as before; a run must pass both. Without a cap (null, or a
--    client from before this change that never sends one) the sample is exactly the 2026-10-06 one.
--  - The client sends Bronze 40, Silver 60, Gold 75 and nothing from Platinum up. The cap never widens: the client's
--    widening steps move only min / max and send the same cap every time (packages/sim/src/lobby/strengthBands.ts).
--  - No column, no recompute: the cap reads `pool_runs.strength`, which 2026-10-06-early-late-strength.sql already
--    keeps current.
--
-- A changed parameter list cannot be `create or replace`d over the old one, so the old signatures are dropped and the
-- new one created inside ONE transaction (a caller never sees the function missing). Locks: the board-strength
-- migration deadlocked against live pool reads, so this takes both pool tables first, like the 2026-10-06 files.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. The sample, with an overall cap ─────────────────────────────────────────────────────────────────────
-- Replaces the 2026-10-06 nine-argument signature (and the 2026-09-30 eight-argument one, should it still exist).
-- Callers that pass only the old arguments keep working: `p_strength_cap` defaults to null = no cap.
drop function if exists public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text);
drop function if exists public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text, numeric);
create or replace function public.pool_runs_sample(
  p_limit int default 150,
  p_set text default null,
  p_patch_prefix text default null,
  p_exclude_user uuid default null,
  p_seed text default null,
  p_strength_min numeric default null,
  p_strength_max numeric default null,
  p_pool text default null,
  p_early_weight numeric default null,
  p_strength_cap numeric default null
) returns table (run_key text, author text, user_id uuid, wave_count int, strength numeric, strength_early numeric, strength_late numeric, boards jsonb)
language plpgsql volatile set search_path = public as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 150), 0), 300);
  lo bigint; hi bigint; span bigint;
  picked bigint[] := '{}';
  cand bigint; tries int := 0; u double precision;
begin
  select min(r.id), max(r.id) into lo, hi from public.pool_runs r
  where r.eligible and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix);
  if lo is null or v_limit = 0 then return; end if;
  span := hi - lo + 1;

  if span <= 4 * v_limit then
    -- A small pool: every matching run, shuffled whole (bounded by the id span, so this stays small).
    select coalesce(array_agg(t.id order by t.k), '{}') into picked from (
      select r.id, case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || r.id) end as k
      from public.pool_runs r
      where r.id between lo and hi and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
        and (p_strength_cap is null or r.strength is null or r.strength <= p_strength_cap)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)))
      order by 2 limit v_limit) t;
  else
    -- Rejection sampling over the dense id range: exactly uniform over the matching runs, O(log n) per draw.
    -- A narrow band rejects more draws; the cap (64 per requested run) bounds the time either way.
    while coalesce(array_length(picked, 1), 0) < v_limit and tries < v_limit * 64 loop
      tries := tries + 1;
      u := case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || tries) end;
      cand := lo + least(floor(u * span)::bigint, span - 1);
      continue when cand = any(picked);
      perform 1 from public.pool_runs r
      where r.id = cand and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
        and (p_strength_cap is null or r.strength is null or r.strength <= p_strength_cap)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)));
      if found then picked := picked || cand; end if;
    end loop;
  end if;

  return query
  select r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count, r.strength,
         r.strength_early, r.strength_late,
         (select coalesce(jsonb_agg(x.snapshot order by x.wave, x.created_at, x.id), '[]'::jsonb) from public.boards x
          where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
            and jsonb_typeof(x.snapshot -> 'minions') = 'array' and jsonb_array_length(x.snapshot -> 'minions') > 0
            and coalesce(x.origin, 'self') <> 'synthetic')
  from unnest(picked) with ordinality as p(id, ord)
  join public.pool_runs r on r.id = p.id
  order by p.ord;
end $$;

-- ── 2. Who may call it ─────────────────────────────────────────────────────────────────────────────────────
grant execute on function public.pool_runs_sample(int, text, text, uuid, text, numeric, numeric, text, numeric, numeric) to anon, authenticated;

commit;


-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- REPLAY FACTS: the small replay facts the Social screens list, precomputed once per row  (2026-10-09, perf)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent: safe to re-run. The same block is appended to schema.sql;
-- keep the two identical. Owner runbook + the measurements: docs/devlog/2026-10-09-menus-social-perf.md.
--
-- WHY (owner 2026-10-09: "our social tab takes forever to load and is also laggy"): the Career page, Recent Games and
-- the Practice tab list a few scalars that live INSIDE the replay jsonb (`replay->>seed`, `replay->v2->>version`, the
-- first and last frame clocks, the final board, the record ...). Each replay is hundreds of KB to a few MB, stored
-- compressed out of line, so EVERY list read decompressed and parsed every listed replay whole to pull a handful of
-- numbers out. Measured on live (anon reads): the Career probe took 0.6 to 3.3 s for one player's 90 runs and
-- sometimes hit the statement timeout (HTTP 500 at ~3.2 s); Recent Games 1 to 3.5 s for 20 rows; the practice list
-- 0.5 to 1.4 s for 20 rows. The same selects over plain columns take ~0.1 to 0.3 s.
--
-- WHAT: STORED generated columns (`tp_*`) holding exactly those facts. Postgres computes them once when a row is
-- written (and once for every existing row when this runs), so a list read never opens the replay again. The
-- expressions are the very JSON paths the client used to send, so the values are identical. Nothing writes them:
-- the client keeps inserting `replay` as before. The client asks for the `tp_*` columns first and, if they are
-- missing (this file not run yet), falls back to the old JSON-path selects for the rest of the session, so the
-- build works before and after.
--
-- COST: one rewrite of each table (run_telemetry ~220 rows, practice_games ~25 at the time of writing; seconds).
-- The ALTER holds a brief exclusive lock, so a run that finishes during it waits a moment to upload.

begin;

-- ── 1. run_telemetry: the Career probe + the Recent Games list ─────────────────────────────────────────────
alter table public.run_telemetry
  add column if not exists tp_seed           text  generated always as (replay ->> 'seed') stored,
  add column if not exists tp_v2_version     text  generated always as (replay -> 'v2' ->> 'version') stored,
  add column if not exists tp_first_t        text  generated always as (replay -> 'v2' -> 'frames' -> 0 ->> 'tMs') stored,
  add column if not exists tp_last_t         text  generated always as (replay -> 'v2' -> 'frames' -> -1 ->> 'tMs') stored,
  add column if not exists tp_active_ms      text  generated always as (replay -> 'v2' ->> 'activeMs') stored,
  add column if not exists tp_final_board    jsonb generated always as (replay -> 'v2' -> 'result' -> 'finalBoard') stored,
  add column if not exists tp_record         jsonb generated always as (replay -> 'v2' -> 'result' -> 'record') stored,
  add column if not exists tp_partial        text  generated always as (replay -> 'v2' ->> 'partial') stored,
  add column if not exists tp_first_wave     text  generated always as (replay -> 'v2' ->> 'firstRecordedWave') stored,
  add column if not exists tp_lobby_strength jsonb generated always as (replay -> 'v2' -> 'result' -> 'lobbyStrength') stored,
  add column if not exists tp_board_strength text  generated always as (replay -> 'v2' -> 'result' ->> 'boardStrength') stored;

-- The Career probe filters by player and sorts newest first (the existing `run_telemetry_user` index is user_id only).
create index if not exists run_telemetry_user_created on public.run_telemetry (user_id, created_at desc);

-- ── 2. practice_games: the Practice lists (Recent Games tab + the Career's Practice tab) ───────────────────
alter table public.practice_games
  add column if not exists tp_v2_version text  generated always as (replay -> 'v2' ->> 'version') stored,
  add column if not exists tp_match      jsonb generated always as (replay -> 'match') stored,
  add column if not exists tp_active_ms  text  generated always as (replay -> 'v2' ->> 'activeMs') stored;

create index if not exists practice_games_user_created on public.practice_games (user_id, created_at desc);

commit;

-- ── 3. Tell the REST API about the new columns ──────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';


-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- COLLECTION "NEW" FOLLOWS THE ACCOUNT  (2026-10-11, R-PROG-COLLECTION-05)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-09-28-progression-crates.sql. Idempotent: safe to re-run.
-- The same block is appended to schema.sql; keep the two identical. Devlog: docs/devlog/2026-10-11-collection-new-baseline.md.
--
-- WHY (owner 2026-10-11: "whenever i load the game, all of my stuff that i already own shows up as 'new'", then
-- "i want to save the 'seen' on the account level, though"): which owned items a player has looked at lived only in
-- the browser's storage, so every device, every address and every fresh install started from nothing and badged the
-- whole collection. It now lives on the ownership row, so it follows the account.
--
-- WHAT
--  - `player_cosmetics.seen_at`: null = owned and not looked at yet (the Collection shows NEW). A new unlock is
--    inserted with it null, by every existing writer, with no change to them.
--  - THE BASELINE: every item owned when this file FIRST runs is marked seen. That step is guarded by the column not
--    existing yet, so a re-run never marks later finds.
--  - `mark_cosmetics_seen(p_ids)`: the signed-in caller marks THEIR OWN items seen (a guest account included: it
--    owns items too). It only ever sets a null `seen_at`; it cannot touch another account, grant an item, or un-see
--    one. Clients have no update grant on the table: this function is the only writer of the column.
--  - A client from before this file ignores the column. A client from after it, talking to a database from before it,
--    gets an "undefined column" answer and keeps the list on the device.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'player_cosmetics' and column_name = 'seen_at'
  ) then
    alter table public.player_cosmetics add column seen_at timestamptz;
    update public.player_cosmetics set seen_at = now();
  end if;
end $$;

create or replace function public.mark_cosmetics_seen(p_ids text[]) returns integer
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n integer;
begin
  if uid is null then return 0; end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_ids, 1) > 2000 then raise exception 'bad_arguments'; end if;
  update public.player_cosmetics
     set seen_at = now()
   where user_id = uid and seen_at is null and cosmetic_id = any(p_ids);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mark_cosmetics_seen(text[]) from public, anon, authenticated;
grant execute on function public.mark_cosmetics_seen(text[]) to authenticated;

commit;

-- Tell the REST API about the new column and function.
notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: ANNOUNCERS, equip_cosmetic accepts the account-wide `announcer` slot  (2026-10-11)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-01-portrait-frames.sql. Then deploy `progression-inventory`.
-- Idempotent: it only REPLACES `equip_cosmetic` (and re-grants it), so re-running it is always safe; it writes no rows.
-- The same block is appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-10-11-announcer-lemon.md.
-- It SUPERSEDES the equip_cosmetic in 2026-10-01-portrait-frames.sql (it keeps that file's hero attack and portrait
-- frame slots): if the skins, hero attack or portrait frames file is ever re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-10-11: "i want to create a new announcer voice - the current one is the default. this will
-- be offered as a reward in collections"; "it will be a Legendary reward players can unlock through opening chests").
--  - The `announcer` category row has existed, switched off, since 2026-09-28-progression-crates.sql. The code-owned
--    catalog sync (packages/progression/src/cosmetics.ts, deploy progression-inventory) switches it on and inserts
--    its first item, `announcer_lemon` (Legendary), which joins the crate pool on that deploy. No catalog SQL.
--  - An announcer is ACCOUNT-WIDE (category target `global`), like the hero attack and the portrait frame: one row in
--    `cosmetic_loadouts` with target_id ''. `equip_cosmetic(user, 'announcer', '', id)` wears one the caller OWNS; a
--    null id takes it off (the default announcer). Every other slot behaves exactly as before.

create or replace function public.equip_cosmetic(p_user uuid, p_slot text, p_target_id text, p_cosmetic_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.cosmetic_catalog%rowtype;
  v_live boolean;
begin
  if p_user is null then raise exception 'not_owned'; end if;
  if p_slot is null or p_slot not in ('hero_skin', 'minion_skin', 'hero_attack', 'portrait_frame', 'announcer') then raise exception 'bad_slot'; end if;
  -- A global slot (hero attack, portrait frame, announcer) has exactly one target, ''. A skin slot names its hero or card.
  if p_slot in ('hero_attack', 'portrait_frame', 'announcer') then
    if p_target_id is distinct from '' then raise exception 'bad_target'; end if;
  elsif p_target_id is null or p_target_id !~ '^[A-Za-z0-9_.:-]{1,64}$' then
    raise exception 'bad_target';
  end if;
  if p_cosmetic_id is not null and p_cosmetic_id !~ '^[a-z0-9_]{1,64}$' then raise exception 'bad_cosmetic_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  if p_cosmetic_id is null then
    delete from public.cosmetic_loadouts where user_id = p_user and slot = p_slot and target_id = p_target_id;
  else
    select * into v_cat from public.cosmetic_catalog where cosmetic_id = p_cosmetic_id;
    if not found then raise exception 'bad_cosmetic_id'; end if;
    if v_cat.category <> p_slot then raise exception 'wrong_target'; end if;
    if p_slot in ('hero_attack', 'portrait_frame', 'announcer') then
      if v_cat.target_type is not null or v_cat.target_id is not null then raise exception 'wrong_target'; end if;
    elsif v_cat.target_type is distinct from (case p_slot when 'hero_skin' then 'hero' else 'card' end)
       or v_cat.target_id is distinct from p_target_id then
      raise exception 'wrong_target';
    end if;
    select k.enabled and not k.admin_off into v_live from public.cosmetic_categories k where k.category = v_cat.category;
    if not v_cat.active or v_cat.admin_off or not coalesce(v_live, false) then raise exception 'not_equippable'; end if;
    if not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = p_cosmetic_id) then
      raise exception 'not_owned';
    end if;
    insert into public.cosmetic_loadouts (user_id, slot, target_id, cosmetic_id, updated_at)
      values (p_user, p_slot, p_target_id, p_cosmetic_id, now())
      on conflict (user_id, slot, target_id) do update set cosmetic_id = excluded.cosmetic_id, updated_at = now();
  end if;

  update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = p_user;
  if not found then raise exception 'not_owned'; end if;
  return jsonb_build_object('status', 'equipped', 'profile', public.progression_profile_json(p_user));
end;
$$;

revoke all on function public.equip_cosmetic(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.equip_cosmetic(uuid, text, text, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- GUIDES ON THE SERVER: Team Ascent guides, player guides, the write functions  (2026-10-12)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent: safe to re-run. Depends on nothing but auth.users.
-- The same block is appended to schema.sql; keep the two identical.
-- Spec: docs/superpowers/specs/2026-10-11-community-guides-design.md. Devlog: docs/devlog/2026-10-12-guides-storage.md.
--
-- WHY (owner 2026-10-11: "i'd like the ability to edit existing guides while in game and save them. The existing
-- [guides] are written by 'Team Ascent' and should only be able to be modified by myself and KC. outside of that,
-- one should be able to create a new guide either from scratch or by duplicating an existing guide"): guides were
-- fixed data in the client. They move here so an edit reaches every player on their next load.
--
-- WHAT
--  - `guide_team`: the accounts that may edit Team Ascent guides. A player can read only their own row.
--  - `guides`: every guide. READ: official, or published and not hidden, or your own, or you are on the team.
--    WRITE: no client policy at all, and the API roles' write privileges are revoked. The three functions below,
--    callable only by the service role (the `guide-write` Edge Function), are the only writers.
--    Official (Team Ascent) guides belong to NO account: `author_id` is null on them (a check constraint pins that
--    shape: official means no author, published, by line "Team Ascent"), so a team member leaving cannot delete
--    them. A player's guides belong to the player and go with the account (`on delete cascade`), and a second
--    check constraint refuses a guide that is neither official nor anyone's (a player guide always has an author).
--  - `guide_bookmarks`, `guide_reports`: created now so later steps add functions, not tables.
--  - `guide_writes`: one row per save, for the 30-per-hour rate limit. A deleted account's rows go with it.
--  - `guide_save`, `guide_delete`, `guide_import_builtins`: the row rules (ownership, official = team only, the
--    20-guide cap, the rate limit, edit conflicts). The text rules (limits, word filter) are the Edge Function's.
--    One account's saves are serialised (an advisory lock), so a parallel burst cannot beat the cap or the limit.
--
-- AFTER RUNNING: add the team, ONCE, with the two real emails typed here and NOT committed anywhere:
--   insert into public.guide_team (user_id) select id from auth.users where email in ('<mike>', '<kc>')
--   on conflict do nothing;
-- A client from before this file ignores these tables. A client from after it, talking to a database from before
-- it, gets "relation does not exist", treats guides as switched off, and shows its built-in guides.

begin;

create table if not exists public.guide_team (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.guide_team enable row level security;
drop policy if exists "read own guide_team" on public.guide_team;
create policy "read own guide_team" on public.guide_team for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.is_guide_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.guide_team where user_id = auth.uid());
$$;
revoke all on function public.is_guide_team() from public;
grant execute on function public.is_guide_team() to anon, authenticated, service_role;

create table if not exists public.guides (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique,                                             -- imported built-ins only
  author_id      uuid references auth.users(id) on delete cascade,        -- null on official (Team Ascent) guides, which belong to no account, so a team member leaving cannot delete them; a deleted player's guides go with the account
  byline         text not null,
  official       boolean not null default false,
  published      boolean not null default false,
  published_at   timestamptz,
  hidden         boolean not null default false,
  hidden_by      uuid,
  hidden_at      timestamptz,
  sets           text[] not null default '{}',
  tribes         text[] not null default '{}',
  pairs_with     text[] not null default '{}',
  icon_card      text not null,
  title          text not null,
  tagline        text not null default '',
  body           text not null,
  core           text[] not null,
  enablers       text[] not null default '{}',
  mentions       text[] not null default '{}',
  aliases        jsonb not null default '{}'::jsonb,
  forked_from    uuid references public.guides(id) on delete set null,
  forked_title   text,
  forked_byline  text,
  bookmark_count int not null default 0,
  sort_order     int not null default 0,
  revision       int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint guides_official_shape check (not official or (author_id is null and published and byline = 'Team Ascent')),
  constraint guides_player_has_author check (official or author_id is not null)
);
create index if not exists guides_sets on public.guides using gin (sets);
create index if not exists guides_author on public.guides (author_id);
create index if not exists guides_official on public.guides (sort_order) where official;

alter table public.guides enable row level security;
drop policy if exists "read guides" on public.guides;
create policy "read guides" on public.guides for select to anon, authenticated
  using (official or (published and not hidden) or author_id = (select auth.uid()) or (select public.is_guide_team()));

create table if not exists public.guide_bookmarks (
  user_id    uuid not null references auth.users(id) on delete cascade,
  guide_id   uuid not null references public.guides(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, guide_id)
);
alter table public.guide_bookmarks enable row level security;
drop policy if exists "read own guide_bookmarks" on public.guide_bookmarks;
create policy "read own guide_bookmarks" on public.guide_bookmarks for select to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.guide_reports (
  id          uuid primary key default gen_random_uuid(),
  guide_id    uuid not null references public.guides(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason      text not null check (reason in ('offensive', 'spam', 'impersonation', 'other')),
  note        text not null default '',
  status      text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (guide_id, reporter_id)
);
alter table public.guide_reports enable row level security;
drop policy if exists "team reads guide_reports" on public.guide_reports;
create policy "team reads guide_reports" on public.guide_reports for select to authenticated using ((select public.is_guide_team()));

create table if not exists public.guide_writes (
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists guide_writes_user_at on public.guide_writes (user_id, at desc);
alter table public.guide_writes enable row level security; -- no policy: the service role only

-- Row level security has no write policy on these tables, but TRUNCATE is not covered by row level security, and
-- Supabase grants the API roles every table privilege by default. Take the write privileges away as well: the
-- functions below are the only writers. (guide_writes is the service role's alone, so it loses select too.)
revoke insert, update, delete, truncate on public.guides, public.guide_team, public.guide_bookmarks, public.guide_reports, public.guide_writes from anon, authenticated;
revoke select on public.guide_writes from anon, authenticated;

-- A jsonb array of strings as text[], order kept. Anything that is not an array is the empty list.
create or replace function public.guide_text_array(j jsonb) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(x order by n), '{}'::text[])
  from jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end) with ordinality as t(x, n);
$$;

create or replace function public.guide_save(p_user uuid, p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team     boolean;
  v_id       uuid := nullif(p_doc->>'id', '')::uuid;
  v_official boolean := coalesce((p_doc->>'official')::boolean, false);
  v_fork     uuid := nullif(p_doc->>'forked_from', '')::uuid;
  v_ftitle   text;
  v_fbyline  text;
  v_row      public.guides;
  v_count    int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  -- The 20-guide cap and the 30-per-hour limit are count-then-insert; this serialises one account's saves so a
  -- parallel burst cannot beat them. (Released at the end of the transaction.)
  perform pg_advisory_xact_lock(hashtextextended('guides:' || p_user::text, 0));
  v_team := exists (select 1 from public.guide_team where user_id = p_user);
  if v_official and not v_team then raise exception 'not_allowed'; end if;

  select count(*) into v_count from public.guide_writes where user_id = p_user and at > now() - interval '1 hour';
  if v_count >= 30 then raise exception 'rate_limited'; end if;

  if v_id is null then
    if not v_official then
      select count(*) into v_count from public.guides where author_id = p_user and not official;
      if v_count >= 20 then raise exception 'too_many_guides'; end if;
    end if;
    if v_fork is not null then
      select title, byline into v_ftitle, v_fbyline from public.guides
       where id = v_fork and (official or (published and not hidden) or author_id = p_user);
      if not found then v_fork := null; v_ftitle := null; v_fbyline := null; end if;
    end if;
    insert into public.guides (author_id, byline, official, published, published_at, sets, tribes, pairs_with, icon_card,
                               title, tagline, body, core, enablers, mentions, aliases,
                               forked_from, forked_title, forked_byline, sort_order, updated_by)
    values (case when v_official then null else p_user end,
            case when v_official then 'Team Ascent' else p_doc->>'byline' end,
            v_official, v_official, case when v_official then now() end,
            public.guide_text_array(p_doc->'sets'), public.guide_text_array(p_doc->'tribes'), public.guide_text_array(p_doc->'pairs_with'),
            p_doc->>'icon_card', p_doc->>'title', coalesce(p_doc->>'tagline', ''), p_doc->>'body',
            public.guide_text_array(p_doc->'core'), public.guide_text_array(p_doc->'enablers'), public.guide_text_array(p_doc->'mentions'),
            coalesce(p_doc->'aliases', '{}'::jsonb),
            v_fork, v_ftitle, v_fbyline,
            case when v_official then (select coalesce(max(sort_order), -1) + 1 from public.guides where official) else 0 end,
            p_user)
    returning * into v_row;
  else
    select * into v_row from public.guides where id = v_id for update;
    if not found then raise exception 'not_found'; end if;
    if v_row.official then
      if not v_team then raise exception 'not_allowed'; end if;
    elsif v_row.author_id is distinct from p_user then
      raise exception 'not_allowed';
    end if;
    if v_official <> v_row.official then raise exception 'not_allowed'; end if; -- a save never flips official
    if (p_doc->>'revision')::int is distinct from v_row.revision then raise exception 'conflict'; end if;
    update public.guides set
      byline     = case when v_row.official then 'Team Ascent' else p_doc->>'byline' end,
      sets       = public.guide_text_array(p_doc->'sets'),
      tribes     = public.guide_text_array(p_doc->'tribes'),
      pairs_with = public.guide_text_array(p_doc->'pairs_with'),
      icon_card  = p_doc->>'icon_card',
      title      = p_doc->>'title',
      tagline    = coalesce(p_doc->>'tagline', ''),
      body       = p_doc->>'body',
      core       = public.guide_text_array(p_doc->'core'),
      enablers   = public.guide_text_array(p_doc->'enablers'),
      mentions   = public.guide_text_array(p_doc->'mentions'),
      aliases    = coalesce(p_doc->'aliases', '{}'::jsonb),
      revision   = v_row.revision + 1,
      updated_at = now(),
      updated_by = p_user
    where id = v_id
    returning * into v_row;
  end if;

  delete from public.guide_writes where user_id = p_user and at < now() - interval '1 day';
  insert into public.guide_writes (user_id) values (p_user);
  return to_jsonb(v_row);
end $$;

create or replace function public.guide_delete(p_user uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team boolean;
  v_row  public.guides;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  v_team := exists (select 1 from public.guide_team where user_id = p_user);
  select * into v_row from public.guides where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if not v_team and (v_row.official or v_row.author_id is distinct from p_user) then raise exception 'not_allowed'; end if;
  delete from public.guides where id = p_id;
  return jsonb_build_object('deleted', p_id);
end $$;

create or replace function public.guide_import_builtins(p_user uuid, p_docs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_doc  jsonb;
  v_n    bigint;
  v_in   int := 0;
  v_skip int := 0;
  v_base int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.guide_team where user_id = p_user) then raise exception 'not_allowed'; end if;
  v_base := (select coalesce(max(sort_order), -1) + 1 from public.guides where official);
  for v_doc, v_n in select value, ordinality from jsonb_array_elements(case when jsonb_typeof(p_docs) = 'array' then p_docs else '[]'::jsonb end) with ordinality loop
    if coalesce(v_doc->>'slug', '') = '' then v_skip := v_skip + 1; continue; end if;
    insert into public.guides (slug, author_id, byline, official, published, published_at, sets, tribes, pairs_with, icon_card,
                               title, tagline, body, core, enablers, mentions, aliases, sort_order, updated_by)
    values (v_doc->>'slug', null, 'Team Ascent', true, true, now(),
            public.guide_text_array(v_doc->'sets'), public.guide_text_array(v_doc->'tribes'), public.guide_text_array(v_doc->'pairs_with'),
            v_doc->>'icon_card', v_doc->>'title', coalesce(v_doc->>'tagline', ''), v_doc->>'body',
            public.guide_text_array(v_doc->'core'), public.guide_text_array(v_doc->'enablers'), public.guide_text_array(v_doc->'mentions'),
            coalesce(v_doc->'aliases', '{}'::jsonb), v_base + (v_n - 1)::int, p_user)
    on conflict (slug) do nothing;
    if found then v_in := v_in + 1; else v_skip := v_skip + 1; end if;
  end loop;
  return jsonb_build_object('inserted', v_in, 'skipped', v_skip);
end $$;

revoke all on function public.guide_text_array(jsonb) from public, anon, authenticated;
revoke all on function public.guide_save(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.guide_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guide_import_builtins(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.guide_text_array(jsonb) to service_role;
grant execute on function public.guide_save(uuid, jsonb) to service_role;
grant execute on function public.guide_delete(uuid, uuid) to service_role;
grant execute on function public.guide_import_builtins(uuid, jsonb) to service_role;

commit;

-- Tell the REST API about the new tables and functions.
notify pgrst, 'reload schema';

-- ========================================================================================================
-- GUIDES, STEP 3: publishing, bookmarks, and a save that can be retried  (2026-10-13)
-- ========================================================================================================
--
-- Paste into the Supabase SQL Editor and Run, AFTER supabase/migrations/2026-10-12-guides.sql. Idempotent: safe to
-- re-run. The same block is appended to schema.sql; keep the two identical.
-- Do not re-run 2026-10-12-guides.sql alone after this file: it puts the old guide_save back and a retried save is no longer recognised. If you did, run this file again.
-- Spec: docs/superpowers/specs/2026-10-11-community-guides-design.md. Devlog: docs/devlog/2026-10-12-guides-community.md.
--
-- WHAT
--  - `guides.last_save_id`: the id the client made for the press of Save that last wrote the row. `guide_save` given
--    the same id again by the same account answers that row and writes nothing, so a save that timed out on the
--    client but landed here is not applied twice when the player presses Save again.
--  - `guide_own_row`: the caller's own player guide, for the Edge Function to re-check its text before publishing.
--  - `guide_set_published`: the author makes a guide public or private. Publishing is refused while the team has it
--    hidden, and when the row is not at the revision whose text was checked. It counts toward the 30 an hour.
--  - `guide_bookmark`: a player bookmarks a published guide that is not theirs and not Team Ascent's (200 at most),
--    or removes a bookmark. A trigger keeps `guides.bookmark_count` true, whichever way a bookmark goes.
--  - Four indexes: the last save id, the Community list by most bookmarked, the Community list by newest, and
--    bookmarks by guide (for the cascade when a guide is deleted).
--
-- A client from before this file never sends a save id or calls these functions. A client from after it, talking to
-- a database from before it: saves still work (the old `guide_save` ignores the id), and publishing and bookmarking
-- answer "something went wrong" until this file is run and `guide-write` is redeployed.

begin;

alter table public.guides add column if not exists last_save_id uuid;
create index if not exists guides_last_save on public.guides (last_save_id) where last_save_id is not null;
create index if not exists guides_community on public.guides (bookmark_count desc, published_at desc nulls last, id) where published and not hidden and not official;
create index if not exists guides_community_new on public.guides (published_at desc nulls last, id) where published and not hidden and not official;
create index if not exists guide_bookmarks_guide on public.guide_bookmarks (guide_id);

create or replace function public.guide_save(p_user uuid, p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team     boolean;
  v_id       uuid := nullif(p_doc->>'id', '')::uuid;
  v_official boolean := coalesce((p_doc->>'official')::boolean, false);
  v_fork     uuid := nullif(p_doc->>'forked_from', '')::uuid;
  v_save     uuid := nullif(p_doc->>'save_id', '')::uuid; -- step 3
  v_ftitle   text;
  v_fbyline  text;
  v_row      public.guides;
  v_count    int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  -- The 20-guide cap and the 30-per-hour limit are count-then-insert; this serialises one account's saves so a
  -- parallel burst cannot beat them. (Released at the end of the transaction.)
  perform pg_advisory_xact_lock(hashtextextended('guides:' || p_user::text, 0));
  -- step 3: this account already made this very save (the client is pressing Save again after a timeout): answer
  -- the row it wrote. Before the rate limit, so a replay is never counted or refused.
  if v_save is not null then
    select * into v_row from public.guides where last_save_id = v_save and updated_by = p_user and (v_id is null or id = v_id); -- step 3
    if found then return to_jsonb(v_row); end if;
  end if;
  v_team := exists (select 1 from public.guide_team where user_id = p_user);
  if v_official and not v_team then raise exception 'not_allowed'; end if;

  select count(*) into v_count from public.guide_writes where user_id = p_user and at > now() - interval '1 hour';
  if v_count >= 30 then raise exception 'rate_limited'; end if;

  if v_id is null then
    if not v_official then
      select count(*) into v_count from public.guides where author_id = p_user and not official;
      if v_count >= 20 then raise exception 'too_many_guides'; end if;
    end if;
    if v_fork is not null then
      select title, byline into v_ftitle, v_fbyline from public.guides
       where id = v_fork and (official or (published and not hidden) or author_id = p_user);
      if not found then v_fork := null; v_ftitle := null; v_fbyline := null; end if;
    end if;
    insert into public.guides (author_id, byline, official, published, published_at, sets, tribes, pairs_with, icon_card,
                               title, tagline, body, core, enablers, mentions, aliases,
                               forked_from, forked_title, forked_byline, sort_order, updated_by, last_save_id) -- step 3: last_save_id
    values (case when v_official then null else p_user end,
            case when v_official then 'Team Ascent' else p_doc->>'byline' end,
            v_official, v_official, case when v_official then now() end,
            public.guide_text_array(p_doc->'sets'), public.guide_text_array(p_doc->'tribes'), public.guide_text_array(p_doc->'pairs_with'),
            p_doc->>'icon_card', p_doc->>'title', coalesce(p_doc->>'tagline', ''), p_doc->>'body',
            public.guide_text_array(p_doc->'core'), public.guide_text_array(p_doc->'enablers'), public.guide_text_array(p_doc->'mentions'),
            coalesce(p_doc->'aliases', '{}'::jsonb),
            v_fork, v_ftitle, v_fbyline,
            case when v_official then (select coalesce(max(sort_order), -1) + 1 from public.guides where official) else 0 end,
            p_user, v_save)
    returning * into v_row;
  else
    select * into v_row from public.guides where id = v_id for update;
    if not found then raise exception 'not_found'; end if;
    if v_row.official then
      if not v_team then raise exception 'not_allowed'; end if;
    elsif v_row.author_id is distinct from p_user then
      raise exception 'not_allowed';
    end if;
    if v_official <> v_row.official then raise exception 'not_allowed'; end if; -- a save never flips official
    if (p_doc->>'revision')::int is distinct from v_row.revision then raise exception 'conflict'; end if;
    update public.guides set
      byline     = case when v_row.official then 'Team Ascent' else p_doc->>'byline' end,
      sets       = public.guide_text_array(p_doc->'sets'),
      tribes     = public.guide_text_array(p_doc->'tribes'),
      pairs_with = public.guide_text_array(p_doc->'pairs_with'),
      icon_card  = p_doc->>'icon_card',
      title      = p_doc->>'title',
      tagline    = coalesce(p_doc->>'tagline', ''),
      body       = p_doc->>'body',
      core       = public.guide_text_array(p_doc->'core'),
      enablers   = public.guide_text_array(p_doc->'enablers'),
      mentions   = public.guide_text_array(p_doc->'mentions'),
      aliases    = coalesce(p_doc->'aliases', '{}'::jsonb),
      revision   = v_row.revision + 1,
      updated_at = now(),
      updated_by = p_user,
      last_save_id = v_save -- step 3
    where id = v_id
    returning * into v_row;
  end if;

  delete from public.guide_writes where user_id = p_user and at < now() - interval '1 day';
  insert into public.guide_writes (user_id) values (p_user);
  return to_jsonb(v_row);
end $$;

create or replace function public.guide_own_row(p_user uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_row public.guides;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  select * into v_row from public.guides where id = p_id;
  if not found then raise exception 'not_found'; end if;
  if v_row.official or v_row.author_id is distinct from p_user then raise exception 'not_allowed'; end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.guide_set_published(p_user uuid, p_id uuid, p_on boolean, p_revision int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_on    boolean := coalesce(p_on, false);
  v_row   public.guides;
  v_count int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('guides:' || p_user::text, 0));
  select * into v_row from public.guides where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_row.official or v_row.author_id is distinct from p_user then raise exception 'not_allowed'; end if;
  if v_on = v_row.published then return to_jsonb(v_row); end if; -- already so: nothing to do, nothing counted
  if v_on then
    if v_row.hidden then raise exception 'guide_hidden'; end if;
    -- The text that was checked is the text that goes public: a save since then is a conflict.
    if p_revision is distinct from v_row.revision then raise exception 'conflict'; end if;
    select count(*) into v_count from public.guide_writes where user_id = p_user and at > now() - interval '1 hour';
    if v_count >= 30 then raise exception 'rate_limited'; end if;
  end if;
  update public.guides
     set published = v_on,
         published_at = case when v_on then coalesce(published_at, now()) else published_at end
   where id = p_id
  returning * into v_row;
  if v_on then insert into public.guide_writes (user_id) values (p_user); end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.guide_bookmark(p_user uuid, p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_on    boolean := coalesce(p_on, false);
  v_row   public.guides;
  v_count int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if v_on then
    perform pg_advisory_xact_lock(hashtextextended('guides:' || p_user::text, 0));
    select * into v_row from public.guides where id = p_id;
    -- A guide the caller could not read is "not found", whether it is private, hidden or was never there.
    if not found or (not v_row.official and (not v_row.published or v_row.hidden) and v_row.author_id is distinct from p_user) then
      raise exception 'not_found';
    end if;
    if v_row.official or v_row.author_id is not distinct from p_user then raise exception 'not_allowed'; end if;
    if not exists (select 1 from public.guide_bookmarks where user_id = p_user and guide_id = p_id) then
      select count(*) into v_count from public.guide_bookmarks where user_id = p_user;
      if v_count >= 200 then raise exception 'too_many_bookmarks'; end if;
      insert into public.guide_bookmarks (user_id, guide_id) values (p_user, p_id) on conflict do nothing;
    end if;
  else
    delete from public.guide_bookmarks where user_id = p_user and guide_id = p_id;
  end if;
  return jsonb_build_object('bookmarked', v_on, 'count', coalesce((select bookmark_count from public.guides where id = p_id and published and not hidden), 0));
end $$;

-- The count follows every way a bookmark can come or go: this function, a deleted guide, a deleted account.
create or replace function public.guide_bookmark_counted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.guides set bookmark_count = bookmark_count + 1 where id = new.guide_id;
    return new;
  end if;
  update public.guides set bookmark_count = greatest(0, bookmark_count - 1) where id = old.guide_id;
  return old;
end $$;
drop trigger if exists guide_bookmarks_count on public.guide_bookmarks;
create trigger guide_bookmarks_count after insert or delete on public.guide_bookmarks
  for each row execute function public.guide_bookmark_counted();

revoke all on function public.guide_own_row(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guide_set_published(uuid, uuid, boolean, int) from public, anon, authenticated;
revoke all on function public.guide_bookmark(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.guide_bookmark_counted() from public, anon, authenticated, service_role;
revoke all on function public.guide_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.guide_own_row(uuid, uuid) to service_role;
grant execute on function public.guide_set_published(uuid, uuid, boolean, int) to service_role;
grant execute on function public.guide_bookmark(uuid, uuid, boolean) to service_role;
grant execute on function public.guide_save(uuid, jsonb) to service_role;

commit;

notify pgrst, 'reload schema';

-- ========================================================================================================
-- GUIDES, STEP 4: reports, hiding, carrying guides over to a new set, a limit on bookmark changes  (2026-10-14)
-- ========================================================================================================
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-12-guides.sql and 2026-10-13-guides-community.sql.
-- Idempotent: safe to re-run. The same block is appended to schema.sql; keep the two identical.
-- Do not re-run an EARLIER guides file alone after this one. If you re-ran 2026-10-12, run 2026-10-13 and then this
-- file; if you re-ran 2026-10-13, run this file (it would otherwise leave the old guide_bookmark, with no limit).
-- Spec: docs/superpowers/specs/2026-10-11-community-guides-design.md. Devlog: docs/devlog/2026-10-12-guides-moderation.md.
--
-- WHAT
--  - `guide_bookmark_log`: one row per bookmark added or removed, for the 120-an-hour limit. The service role's alone.
--  - `guide_bookmark`: as before, plus that limit. A call that changes nothing is not counted.
--  - `guide_report`: a signed-in player reports someone else's published guide, once per guide, ten a day.
--  - `guide_set_hidden`: the team hides or unhides a player's guide. A hidden guide is read only by its author and
--    the team; hiding marks its open reports actioned. A Team Ascent guide cannot be hidden (edit or delete it).
--  - `guide_dismiss_reports`: the team dismisses every open report of a guide.
--  - `guide_retag_set`: the team adds one set to up to 200 named guides (a new set going live). It only ever adds:
--    a card archived mid-set must not untag a guide.
-- Reports are read by the team only (the step 1 policy on `guide_reports`); a reporter cannot read their own.

begin;

create table if not exists public.guide_bookmark_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists guide_bookmark_log_user_at on public.guide_bookmark_log (user_id, at desc);
alter table public.guide_bookmark_log enable row level security; -- no policy: the service role only
revoke all on public.guide_bookmark_log from anon, authenticated;

create index if not exists guide_reports_open on public.guide_reports (guide_id) where status = 'open';
create index if not exists guide_reports_reporter on public.guide_reports (reporter_id, created_at desc);
-- The team's hidden list is read newest first, then by id (guidesRemote.fetchHiddenGuides).
create index if not exists guides_hidden_list on public.guides (hidden_at desc nulls last, id) where hidden;

create or replace function public.guide_bookmark(p_user uuid, p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_on      boolean := coalesce(p_on, false);
  v_row     public.guides;
  v_count   int;
  v_changed boolean := false; -- step 4
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if p_on is null then raise exception 'not_allowed'; end if; -- step 4: a missing direction is not "remove"
  perform pg_advisory_xact_lock(hashtextextended('guides:' || p_user::text, 0)); -- step 4: both paths, for the limit
  -- step 4: at most 120 changes an hour. Checked before anything is read, so it cannot be used to probe.
  select count(*) into v_count from public.guide_bookmark_log where user_id = p_user and at > now() - interval '1 hour';
  if v_count >= 120 then raise exception 'rate_limited'; end if;
  if v_on then
    select * into v_row from public.guides where id = p_id;
    -- A guide the caller could not read is "not found", whether it is private, hidden or was never there.
    if not found or (not v_row.official and (not v_row.published or v_row.hidden) and v_row.author_id is distinct from p_user) then
      raise exception 'not_found';
    end if;
    if v_row.official or v_row.author_id is not distinct from p_user then raise exception 'not_allowed'; end if;
    if not exists (select 1 from public.guide_bookmarks where user_id = p_user and guide_id = p_id) then
      select count(*) into v_count from public.guide_bookmarks where user_id = p_user;
      if v_count >= 200 then raise exception 'too_many_bookmarks'; end if;
      insert into public.guide_bookmarks (user_id, guide_id) values (p_user, p_id) on conflict do nothing;
      v_changed := found; -- step 4
    end if;
  else
    delete from public.guide_bookmarks where user_id = p_user and guide_id = p_id;
    v_changed := found; -- step 4
  end if;
  if v_changed then -- step 4
    delete from public.guide_bookmark_log where user_id = p_user and at < now() - interval '1 day';
    insert into public.guide_bookmark_log (user_id) values (p_user);
  end if;
  return jsonb_build_object('bookmarked', v_on, 'count',
    coalesce((select bookmark_count from public.guides where id = p_id and published and not hidden), 0));
end $$;

create or replace function public.guide_report(p_user uuid, p_id uuid, p_reason text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row   public.guides;
  v_count int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if p_reason is null or p_reason not in ('offensive', 'spam', 'impersonation', 'other') then raise exception 'bad_report'; end if;
  if char_length(coalesce(p_note, '')) > 300 then raise exception 'bad_report'; end if;
  perform pg_advisory_xact_lock(hashtextextended('guides:' || p_user::text, 0));
  select * into v_row from public.guides where id = p_id;
  if not found or (not v_row.official and (not v_row.published or v_row.hidden) and v_row.author_id is distinct from p_user) then
    raise exception 'not_found';
  end if;
  if v_row.official or v_row.author_id is not distinct from p_user then raise exception 'not_allowed'; end if;
  if exists (select 1 from public.guide_reports where guide_id = p_id and reporter_id = p_user) then raise exception 'already_reported'; end if;
  select count(*) into v_count from public.guide_reports where reporter_id = p_user and created_at > now() - interval '1 day';
  if v_count >= 10 then raise exception 'report_limit'; end if;
  insert into public.guide_reports (guide_id, reporter_id, reason, note) values (p_id, p_user, p_reason, coalesce(p_note, ''));
  return jsonb_build_object('reported', true);
end $$;

create or replace function public.guide_set_hidden(p_user uuid, p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_on  boolean := coalesce(p_on, false);
  v_row public.guides;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.guide_team where user_id = p_user) then raise exception 'not_allowed'; end if;
  if p_on is null then raise exception 'not_allowed'; end if; -- a missing direction must not mean "unhide"
  select * into v_row from public.guides where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_row.official then raise exception 'not_allowed'; end if; -- a Team Ascent guide is edited or deleted, not hidden
  update public.guides
     set hidden = v_on,
         -- hiding a guide that is already hidden keeps who hid it first, and when
         hidden_by = case when v_on then (case when v_row.hidden then coalesce(v_row.hidden_by, p_user) else p_user end) end,
         hidden_at = case when v_on then (case when v_row.hidden then coalesce(v_row.hidden_at, now()) else now() end) end
   where id = p_id
  returning * into v_row;
  if v_on then
    update public.guide_reports set status = 'actioned', resolved_by = p_user, resolved_at = now()
     where guide_id = p_id and status = 'open';
  end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.guide_dismiss_reports(p_user uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.guide_team where user_id = p_user) then raise exception 'not_allowed'; end if;
  update public.guide_reports set status = 'dismissed', resolved_by = p_user, resolved_at = now()
   where guide_id = p_id and status = 'open';
  get diagnostics v_n = row_count;
  return jsonb_build_object('dismissed', v_n);
end $$;

create or replace function public.guide_retag_set(p_user uuid, p_set text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.guide_team where user_id = p_user) then raise exception 'not_allowed'; end if;
  if p_set is null or p_set !~ '^set[0-9]{1,3}$' then raise exception 'bad_set'; end if;
  if p_ids is null or coalesce(cardinality(p_ids), 0) < 1 or cardinality(p_ids) > 200 then raise exception 'bad_ids'; end if;
  -- Adds only. The text and the revision are not touched, so an author who is editing is not disturbed.
  update public.guides set sets = array_append(sets, p_set)
   where id = any(p_ids) and not (sets @> array[p_set]); -- null-safe: a NULL element in sets must not hide a row
  get diagnostics v_n = row_count;
  return jsonb_build_object('tagged', v_n);
end $$;

revoke all on function public.guide_bookmark(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.guide_report(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.guide_set_hidden(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.guide_dismiss_reports(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guide_retag_set(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.guide_bookmark(uuid, uuid, boolean) to service_role;
grant execute on function public.guide_report(uuid, uuid, text, text) to service_role;
grant execute on function public.guide_set_hidden(uuid, uuid, boolean) to service_role;
grant execute on function public.guide_dismiss_reports(uuid, uuid) to service_role;
grant execute on function public.guide_retag_set(uuid, text, uuid[]) to service_role;

commit;

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: EMOTES, the `starter` acquisition and the four-position `emote` equip slot  (2026-10-13)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-11-announcer-slot.sql, and BEFORE the next deploy of
-- `progression-inventory` (that deploy syncs the four starter emotes, whose acquisition `starter` the old check on
-- cosmetic_catalog refuses: deployed first, the catalog sync fails and retries every minute until this runs, so no new
-- cosmetic reaches the database in between). Idempotent: it re-creates one check and REPLACES `equip_cosmetic` (and
-- re-grants it); it writes no rows. The same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-10-13-emotes.md. It SUPERSEDES the equip_cosmetic in 2026-10-11-announcer-slot.sql (it keeps every
-- slot that file has): if that file, or any older equip_cosmetic file, is ever re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-10-13: "Emotes are a new COSMETIC type in Collections ... Players equip up to 4 in
-- Collections. Unlock source: crates, plus starter emotes everyone owns").
--  - The `emote` category and its four starter items (Angry Mushy, Flirty Midas, Nervous Jensen, Zen Brian) arrive
--    through the code-owned catalog sync (packages/progression/src/cosmetics.ts, deploy progression-inventory). No
--    catalog SQL. A STARTER item (acquisition_source 'starter') is owned by EVERY player without an ownership row, so
--    it never drops from a crate (the pool only reads 'crate' items) and no backfill is needed. A crate emote, when one
--    is added, drops like any other item: the data path is the existing one.
--  - The `emote` slot holds FOUR emotes, one cosmetic_loadouts row per menu position: target_id '0'..'3'.
--    `equip_cosmetic(user, 'emote', '<position>', id)` puts an owned (or starter) live emote at that position; the same
--    emote leaves any other position it held (a MOVE, so one emote never shows twice). A null id clears the position
--    (the client then shows the starter emote for it). Every other slot behaves exactly as before.
--  - THE RECORDED EMOTES NEED NO SQL. A run's used emotes ride each round's board as `emotes` inside the BoardSnapshot,
--    which `public.boards.snapshot` (jsonb) stores verbatim and `pool_runs_sample` serves verbatim. An older client
--    ignores the key; a board without it has no emotes.

-- ── 1. The starter acquisition ───────────────────────────────────────────────────────────────────────────────
-- The crates file named the check inline, so its name is Postgres's default; drop whichever acquisition check exists
-- and add the widened one under a fixed name (the Ancient rarity file's pattern).
do $$
declare v_name text;
begin
  for v_name in
    select con.conname from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
      where nsp.nspname = 'public' and rel.relname = 'cosmetic_catalog' and con.contype = 'c'
        and pg_get_constraintdef(con.oid) ilike '%acquisition_source = ANY%'
  loop
    execute format('alter table public.cosmetic_catalog drop constraint %I', v_name);
  end loop;
end;
$$;
alter table public.cosmetic_catalog add constraint cosmetic_catalog_acquisition_source_check
  check (acquisition_source in ('crate', 'level_milestone', 'achievement', 'event', 'starter'));

-- ── 2. equip_cosmetic: the emote slot (target = menu position), starters count as owned ─────────────────────
create or replace function public.equip_cosmetic(p_user uuid, p_slot text, p_target_id text, p_cosmetic_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.cosmetic_catalog%rowtype;
  v_live boolean;
begin
  if p_user is null then raise exception 'not_owned'; end if;
  if p_slot is null or p_slot not in ('hero_skin', 'minion_skin', 'hero_attack', 'portrait_frame', 'announcer', 'emote') then raise exception 'bad_slot'; end if;
  -- A global slot (hero attack, portrait frame, announcer) has exactly one target, ''. The emote slot's target is the
  -- menu position '0'..'3'. A skin slot names its hero or card.
  if p_slot in ('hero_attack', 'portrait_frame', 'announcer') then
    if p_target_id is distinct from '' then raise exception 'bad_target'; end if;
  elsif p_slot = 'emote' then
    if p_target_id is null or p_target_id !~ '^[0-3]$' then raise exception 'bad_target'; end if;
  elsif p_target_id is null or p_target_id !~ '^[A-Za-z0-9_.:-]{1,64}$' then
    raise exception 'bad_target';
  end if;
  if p_cosmetic_id is not null and p_cosmetic_id !~ '^[a-z0-9_]{1,64}$' then raise exception 'bad_cosmetic_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  if p_cosmetic_id is null then
    delete from public.cosmetic_loadouts where user_id = p_user and slot = p_slot and target_id = p_target_id;
  else
    select * into v_cat from public.cosmetic_catalog where cosmetic_id = p_cosmetic_id;
    if not found then raise exception 'bad_cosmetic_id'; end if;
    if v_cat.category <> p_slot then raise exception 'wrong_target'; end if;
    if p_slot in ('hero_attack', 'portrait_frame', 'announcer') then
      if v_cat.target_type is not null or v_cat.target_id is not null then raise exception 'wrong_target'; end if;
    elsif p_slot = 'emote' then
      if v_cat.target_type is not null or v_cat.target_id is not null then raise exception 'wrong_target'; end if;
    elsif v_cat.target_type is distinct from (case p_slot when 'hero_skin' then 'hero' else 'card' end)
       or v_cat.target_id is distinct from p_target_id then
      raise exception 'wrong_target';
    end if;
    select k.enabled and not k.admin_off into v_live from public.cosmetic_categories k where k.category = v_cat.category;
    if not v_cat.active or v_cat.admin_off or not coalesce(v_live, false) then raise exception 'not_equippable'; end if;
    -- A starter item is everyone's: no ownership row is needed (or ever written).
    if v_cat.acquisition_source <> 'starter'
       and not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = p_cosmetic_id) then
      raise exception 'not_owned';
    end if;
    -- An emote MOVES: it leaves any other menu position it held, so the menu never shows one emote twice.
    if p_slot = 'emote' then
      delete from public.cosmetic_loadouts
        where user_id = p_user and slot = 'emote' and cosmetic_id = p_cosmetic_id and target_id <> p_target_id;
    end if;
    insert into public.cosmetic_loadouts (user_id, slot, target_id, cosmetic_id, updated_at)
      values (p_user, p_slot, p_target_id, p_cosmetic_id, now())
      on conflict (user_id, slot, target_id) do update set cosmetic_id = excluded.cosmetic_id, updated_at = now();
  end if;

  update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = p_user;
  if not found then raise exception 'not_owned'; end if;
  return jsonb_build_object('status', 'equipped', 'profile', public.progression_profile_json(p_user));
end;
$$;

revoke all on function public.equip_cosmetic(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.equip_cosmetic(uuid, text, text, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS: real-time 1v1 rooms, matches, rounds and spectator frames  (2026-10-13)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. ADDITIVE ONLY: new `versus_*` tables, functions, policies and
-- Realtime publication entries; it touches no existing table or row. Idempotent (safe to re-run). Deploy the
-- `versus-resolve` Edge Function (supabase/README.md) with or after it: the function's `finalize` action calls
-- `versus_commit_round` below as the service role.
--
-- THE MODEL (blueprint docs/superpowers/specs/2026-10-13-versus-mode-design.md, owner rulings 2026-10-13):
--  - A ROOM is a continuous lobby (ruling 10): it outlives its matches. Members hold one of three roles: `p1`,
--    `p2` (the two player seats) or `spectator` (up to 20, ruling 8; every room is watchable). While the room is
--    `open`, members may swap freely between an empty player seat and the stands.
--  - The HOST presses Start: the room goes `sealed` (player seats frozen) and both players must press their gate
--    gem within 30 s (ruling 5), or the room returns to `open`. Both gems → a MATCH row, `in_game`.
--  - A MATCH: Hero Select (20 s; a missing pick is a deterministic random index of the seat's three, ruling 2) →
--    rounds of `shop` (server deadline, `versus_turn_seconds`, no Gold Fuse) → `resolving` (the Edge Function
--    fights the two locked sides ONCE and commits) → `combat` (both players watch; a ready barrier, capped) → the
--    next shop. Each lost round strikes one of the loser's 7 hearts (ruling 1); a draw strikes nobody (ruling 4).
--    0 hearts ends the match, the room goes back to `open` with everyone still in it.
--  - Every transition locks the row and bumps `revision`. No scheduler: any member calls `versus_reconcile` when a
--    known deadline passes, and it applies whatever is due, idempotently.
--  - DISCONNECTS (ruling 6): a player whose heartbeat is older than the lease PAUSES the match (deadlines stop). Back
--    within the 30 s grace, the match resumes with every deadline shifted by the pause. Past the grace the opponent
--    may unpause: the absent seat is then on AUTO (its last locked board fights for it every round), and 3
--    consecutive auto rounds forfeit the match. Returning clears auto.
--  - Rating, rank, medals: never touched (ruling 9). XP, achievements and history are granted client-side through
--    the existing progression path; this file only records the matches.
--  - Writes go through the security-definer RPCs below; the tables have no client write policy. A player's
--    candidate sides and private seeds are owner-only; everything else in a room is public to signed-in players.
--
-- Constants mirrored from packages/sim/src/versus/constants.ts (versusConstants.test.ts pins them):
--   hearts 7 · hero select 20 s · gate 30 s · pause grace 30 s · missed rounds 3 · spectators 20 · lead 3 s ·
--   combat cap 90 s · lease 12 s · side 262144 B · frame 196608 B.

-- ── 0. Clock (a hook so the pglite tests can move time; honoured only for the database owner's session) ────
create or replace function public.versus_clock()
returns timestamptz
language sql
stable
as $$
  select case
    when session_user = 'postgres' and coalesce(current_setting('versus.test_now', true), '') <> ''
      then current_setting('versus.test_now', true)::timestamptz
    else now()
  end;
$$;

-- The round timer, mirrored from packages/ui/src/turnClock.ts `standardTurnSeconds(wave)` (multiplier 1).
-- versusConstants.test.ts compares this function with the TS for rounds 1-80.
create or replace function public.versus_turn_seconds(p_round int)
returns int
language sql
immutable
as $$
  select greatest(21, least(80, 18 + (p_round - 1) * 4 + case when p_round >= 6 then 6 else 0 end)
                     + case when p_round >= 12 then 12 else 0 end);
$$;

-- ── 1. Tables ──────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.versus_rooms (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(name) between 1 and 40),
  host_user_id       uuid not null,
  status             text not null default 'open' check (status in ('open', 'sealed', 'in_game')),
  set_id             text not null check (char_length(set_id) between 1 and 16),
  content_revision   text not null check (char_length(content_revision) between 1 and 32),
  protocol           int  not null,
  revision           bigint not null default 1,
  gate_deadline      timestamptz,
  p1_gate            boolean not null default false,
  p2_gate            boolean not null default false,
  current_match_id   uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.versus_members (
  room_id       uuid not null references public.versus_rooms(id) on delete cascade,
  user_id       uuid not null,
  role          text not null check (role in ('p1', 'p2', 'spectator')),
  display_name  text not null check (char_length(display_name) between 1 and 40),
  profile       jsonb not null default '{}'::jsonb check (octet_length(profile::text) <= 4096),
  joined_at     timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);
-- One room per account at a time; one holder per player seat.
create unique index if not exists versus_members_one_room on public.versus_members (user_id);
create unique index if not exists versus_members_one_seat on public.versus_members (room_id, role) where role in ('p1', 'p2');

create table if not exists public.versus_matches (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid references public.versus_rooms(id) on delete set null,
  seed               bigint not null,
  set_id             text not null,
  content_revision   text not null,
  protocol           int  not null,
  phase              text not null check (phase in ('hero_select', 'shop', 'resolving', 'combat', 'complete')),
  revision           bigint not null default 1,
  round              int  not null default 0,
  p1_user            uuid not null,
  p2_user            uuid not null,
  p1_name            text not null,
  p2_name            text not null,
  p1_hearts          int  not null default 7,
  p2_hearts          int  not null default 7,
  p1_hero            text,
  p2_hero            text,
  heroes_revealed    boolean not null default false,
  hero_deadline      timestamptz,
  shop_starts_at     timestamptz,
  shop_deadline      timestamptz,
  combat_deadline    timestamptz,
  p1_locked          boolean not null default false,
  p2_locked          boolean not null default false,
  p1_ready           boolean not null default false,
  p2_ready           boolean not null default false,
  paused_seat        text check (paused_seat in ('p1', 'p2')),
  paused_at          timestamptz,
  pause_grace_until  timestamptz,
  p1_auto            boolean not null default false,
  p2_auto            boolean not null default false,
  p1_missed          int  not null default 0,
  p2_missed          int  not null default 0,
  winner_seat        text check (winner_seat in ('p1', 'p2')),
  end_reason         text check (end_reason in ('hearts', 'forfeit', 'missed', 'abandoned')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  completed_at       timestamptz
);
create index if not exists versus_matches_room on public.versus_matches (room_id, created_at desc);
create index if not exists versus_matches_p1 on public.versus_matches (p1_user, created_at desc);
create index if not exists versus_matches_p2 on public.versus_matches (p2_user, created_at desc);

-- Per-seat private state: the hidden hero offer (ruling 3) and the seat's own run seed. Owner-only read.
create table if not exists public.versus_seat_private (
  match_id    uuid not null references public.versus_matches(id) on delete cascade,
  seat        text not null check (seat in ('p1', 'p2')),
  user_id     uuid not null,
  hero_seed   bigint not null,
  run_seed    bigint not null,
  hero_offer  text[] check (hero_offer is null or cardinality(hero_offer) = 3),
  hero_index  smallint check (hero_index between 0 and 2),
  hero_auto   boolean not null default false,
  primary key (match_id, seat)
);

-- A seat's turn: the newest candidate (promoted at the deadline) and, once locked, the final side. Owner-only read.
create table if not exists public.versus_submissions (
  match_id       uuid not null references public.versus_matches(id) on delete cascade,
  round          int  not null,
  seat           text not null check (seat in ('p1', 'p2')),
  user_id        uuid not null,
  candidate_seq  int  not null,
  prepared_side  jsonb check (prepared_side is null or octet_length(prepared_side::text) <= 262144),
  final          boolean not null default false,
  source         text not null default 'candidate' check (source in ('candidate', 'lock', 'deadline', 'auto', 'empty')),
  checkpoint     jsonb check (checkpoint is null or octet_length(checkpoint::text) <= 1048576),
  updated_at     timestamptz not null default now(),
  primary key (match_id, round, seat)
);

-- One authoritative fight per round, both perspectives. Public once committed.
create table if not exists public.versus_rounds (
  match_id       uuid not null references public.versus_matches(id) on delete cascade,
  round          int  not null,
  chair          text not null check (chair in ('p1', 'p2')),
  outcome        text not null check (outcome in ('p1', 'p2', 'draw')),
  heart_lost_by  text check (heart_lost_by in ('p1', 'p2')),
  p1_result      jsonb not null,
  p2_result      jsonb not null,
  digest         text not null,
  p1_hearts      int  not null,
  p2_hearts      int  not null,
  committed_at   timestamptz not null default now(),
  primary key (match_id, round)
);

-- The latest spectator KEYFRAME per seat (blueprint 8): deltas ride the Realtime broadcast channel; a late joiner
-- or a subscriber that sees a sequence gap reads this row and resumes after its `seq`.
create table if not exists public.versus_spectator_frames (
  match_id    uuid not null references public.versus_matches(id) on delete cascade,
  seat        text not null check (seat in ('p1', 'p2')),
  seq         bigint not null,
  round       int not null,
  frame       jsonb not null check (octet_length(frame::text) <= 196608),
  updated_at  timestamptz not null default now(),
  primary key (match_id, seat)
);

-- ── 2. Row level security: reads only; every write is an RPC ──────────────────────────────────────────────
alter table public.versus_rooms enable row level security;
alter table public.versus_members enable row level security;
alter table public.versus_matches enable row level security;
alter table public.versus_seat_private enable row level security;
alter table public.versus_submissions enable row level security;
alter table public.versus_rounds enable row level security;
alter table public.versus_spectator_frames enable row level security;

drop policy if exists "versus read rooms" on public.versus_rooms;
create policy "versus read rooms" on public.versus_rooms for select to authenticated using (true);
drop policy if exists "versus read members" on public.versus_members;
create policy "versus read members" on public.versus_members for select to authenticated using (true);
drop policy if exists "versus read matches" on public.versus_matches;
create policy "versus read matches" on public.versus_matches for select to authenticated using (true);
drop policy if exists "versus read own private" on public.versus_seat_private;
create policy "versus read own private" on public.versus_seat_private for select to authenticated using (auth.uid() = user_id);
drop policy if exists "versus read own submissions" on public.versus_submissions;
create policy "versus read own submissions" on public.versus_submissions for select to authenticated using (auth.uid() = user_id);
drop policy if exists "versus read rounds" on public.versus_rounds;
create policy "versus read rounds" on public.versus_rounds for select to authenticated using (true);
drop policy if exists "versus read frames" on public.versus_spectator_frames;
create policy "versus read frames" on public.versus_spectator_frames for select to authenticated using (true);

grant select on public.versus_rooms, public.versus_members, public.versus_matches, public.versus_seat_private,
  public.versus_submissions, public.versus_rounds, public.versus_spectator_frames to authenticated;

-- ── 3. Internal helpers (not callable by clients) ──────────────────────────────────────────────────────────
-- The JSON a client reads back from every RPC: the match's public row.
create or replace function public.versus__match_json(m public.versus_matches)
returns jsonb
language sql
stable
as $$
  select to_jsonb(m) || jsonb_build_object('serverNow', public.versus_clock());
$$;

create or replace function public.versus__room_json(p_room uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(r) || jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object(
        'userId', mm.user_id, 'role', mm.role, 'displayName', mm.display_name, 'profile', mm.profile,
        'lastSeenAt', mm.last_seen_at) order by mm.joined_at)
      from public.versus_members mm where mm.room_id = r.id), '[]'::jsonb),
    'serverNow', public.versus_clock())
  from public.versus_rooms r where r.id = p_room;
$$;

-- The caller's seat in a match, or null.
create or replace function public.versus__seat_of(m public.versus_matches, p_user uuid)
returns text
language sql
immutable
as $$
  select case when p_user = m.p1_user then 'p1' when p_user = m.p2_user then 'p2' else null end;
$$;

-- Deterministic pick in [0, n): the match seed folded with a label (hero timeout, ruling 2).
create or replace function public.versus__pick(p_seed bigint, p_label text, p_n int)
returns int
language sql
immutable
as $$
  select (abs(hashtext(p_seed::text || ':' || p_label)::bigint) % p_n)::int;
$$;

-- Open round p_round's shop, starting `lead` after now (ruling: normal round timer, no Gold Fuse).
create or replace function public.versus__open_shop(m public.versus_matches, p_round int)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_out public.versus_matches;
begin
  update public.versus_matches set
    phase = 'shop', round = p_round,
    shop_starts_at = v_now + interval '3 seconds',
    shop_deadline = v_now + interval '3 seconds' + make_interval(secs => public.versus_turn_seconds(p_round)),
    combat_deadline = null, p1_locked = false, p2_locked = false, p1_ready = false, p2_ready = false,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  return v_out;
end;
$$;

-- Fill an unlocked seat's final side for the round (deadline promotion / auto / empty) and mark it locked.
create or replace function public.versus__finalize_seat(p_match uuid, p_round int, p_seat text, p_user uuid, p_auto boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last jsonb;
begin
  if p_auto then
    -- ruling 6: an absent player's LAST LOCKED board plays for them.
    select prepared_side into v_last from public.versus_submissions
      where match_id = p_match and seat = p_seat and final and round < p_round and prepared_side is not null
      order by round desc limit 1;
    insert into public.versus_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source)
      values (p_match, p_round, p_seat, p_user, 0, v_last, true, case when v_last is null then 'empty' else 'auto' end)
      on conflict (match_id, round, seat) do update set prepared_side = coalesce(excluded.prepared_side, public.versus_submissions.prepared_side),
        final = true, source = case when public.versus_submissions.prepared_side is not null then 'deadline' else excluded.source end,
        updated_at = now();
    return;
  end if;
  -- Deadline: promote the newest candidate. None at all (the client never uploaded): the seat's last locked board,
  -- else an empty board, so two AFK players can never deadlock a round.
  if exists (select 1 from public.versus_submissions where match_id = p_match and round = p_round and seat = p_seat and prepared_side is not null) then
    update public.versus_submissions set final = true, source = 'deadline', updated_at = now()
      where match_id = p_match and round = p_round and seat = p_seat;
  else
    select prepared_side into v_last from public.versus_submissions
      where match_id = p_match and seat = p_seat and final and round < p_round and prepared_side is not null
      order by round desc limit 1;
    insert into public.versus_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source)
      values (p_match, p_round, p_seat, p_user, 0, v_last, true, case when v_last is null then 'empty' else 'auto' end)
      on conflict (match_id, round, seat) do update set prepared_side = excluded.prepared_side, final = true,
        source = excluded.source, updated_at = now();
  end if;
end;
$$;

-- Both seats locked (or on auto) → `resolving`.
create or replace function public.versus__maybe_resolve(m public.versus_matches)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out public.versus_matches := m;
begin
  if m.phase <> 'shop' then return m; end if;
  if not ((m.p1_locked or m.p1_auto) and (m.p2_locked or m.p2_auto)) then return m; end if;
  if m.p1_auto and not m.p1_locked then perform public.versus__finalize_seat(m.id, m.round, 'p1', m.p1_user, true); end if;
  if m.p2_auto and not m.p2_locked then perform public.versus__finalize_seat(m.id, m.round, 'p2', m.p2_user, true); end if;
  update public.versus_matches set phase = 'resolving', p1_locked = true, p2_locked = true,
    revision = revision + 1, updated_at = public.versus_clock()
    where id = m.id returning * into v_out;
  return v_out;
end;
$$;

-- Shift every live deadline by the pause and clear it.
create or replace function public.versus__resume(m public.versus_matches)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_delta interval;
  v_out public.versus_matches;
begin
  if m.paused_at is null then return m; end if;
  v_delta := v_now - m.paused_at;
  update public.versus_matches set
    hero_deadline = hero_deadline + v_delta, shop_starts_at = shop_starts_at + v_delta,
    shop_deadline = shop_deadline + v_delta, combat_deadline = combat_deadline + v_delta,
    paused_seat = null, paused_at = null, pause_grace_until = null,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  return v_out;
end;
$$;

-- End the match; the room goes back to `open` with everyone still seated (ruling 10).
create or replace function public.versus__complete(m public.versus_matches, p_winner text, p_reason text)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_out public.versus_matches;
begin
  update public.versus_matches set phase = 'complete', winner_seat = p_winner, end_reason = p_reason,
    paused_seat = null, paused_at = null, pause_grace_until = null,
    completed_at = v_now, revision = revision + 1, updated_at = v_now
    where id = m.id returning * into v_out;
  update public.versus_rooms set status = 'open', p1_gate = false, p2_gate = false, gate_deadline = null,
    revision = revision + 1, updated_at = v_now
    where id = m.room_id and current_match_id = m.id;
  return v_out;
end;
$$;

-- Hero picks are in (or timed out): reveal and open round 1.
create or replace function public.versus__maybe_start(m public.versus_matches)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_out public.versus_matches := m;
  r record;
begin
  if m.phase <> 'hero_select' then return m; end if;
  if v_now < m.hero_deadline and exists (select 1 from public.versus_seat_private where match_id = m.id and hero_index is null) then
    return m;
  end if;
  -- Timeout: a deterministic random pick from the seat's own three (ruling 2).
  update public.versus_seat_private set hero_index = public.versus__pick(m.seed, 'hero:' || seat, 3), hero_auto = true
    where match_id = m.id and hero_index is null;
  for r in select seat, hero_offer, hero_index from public.versus_seat_private where match_id = m.id loop
    if r.seat = 'p1' then
      update public.versus_matches set p1_hero = case when r.hero_offer is null then null else r.hero_offer[r.hero_index + 1] end where id = m.id;
    else
      update public.versus_matches set p2_hero = case when r.hero_offer is null then null else r.hero_offer[r.hero_index + 1] end where id = m.id;
    end if;
  end loop;
  update public.versus_matches set heroes_revealed = true where id = m.id returning * into v_out;
  return public.versus__open_shop(v_out, 1);
end;
$$;

-- ── 4. Rooms ───────────────────────────────────────────────────────────────────────────────────────────────
-- Create a room and take Player 1. An account in another room must leave it first.
create or replace function public.versus_create_room(p_name text, p_display text, p_profile jsonb, p_set_id text, p_content text, p_protocol int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  if exists (select 1 from public.versus_members where user_id = v_user) then raise exception 'already_in_room'; end if;
  insert into public.versus_rooms (name, host_user_id, set_id, content_revision, protocol)
    values (left(coalesce(nullif(trim(p_name), ''), 'Versus'), 40), v_user, p_set_id, p_content, p_protocol)
    returning id into v_room;
  insert into public.versus_members (room_id, user_id, role, display_name, profile, last_seen_at)
    values (v_room, v_user, 'p1', left(coalesce(nullif(trim(p_display), ''), 'Player'), 40), coalesce(p_profile, '{}'::jsonb), public.versus_clock());
  return public.versus__room_json(v_room);
end;
$$;

-- Join as a player (atomically claims an empty seat of an OPEN room) or as a spectator (any status, cap 20).
create or replace function public.versus_join_room(p_room uuid, p_as text, p_display text, p_profile jsonb, p_content text, p_protocol int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r public.versus_rooms;
  v_role text;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  if r.protocol <> p_protocol or r.content_revision <> p_content then raise exception 'version_mismatch'; end if;
  if exists (select 1 from public.versus_members where user_id = v_user and room_id = p_room) then
    return public.versus__room_json(p_room); -- already here: idempotent re-join
  end if;
  if exists (select 1 from public.versus_members where user_id = v_user) then raise exception 'already_in_room'; end if;
  if p_as = 'player' then
    if r.status <> 'open' then raise exception 'room_not_open'; end if;
    select s into v_role from unnest(array['p1', 'p2']) s
      where not exists (select 1 from public.versus_members where room_id = p_room and role = s) limit 1;
    if v_role is null then raise exception 'seats_full'; end if;
  elsif p_as = 'spectator' then
    if (select count(*) from public.versus_members where room_id = p_room and role = 'spectator') >= 20 then raise exception 'spectators_full'; end if;
    v_role := 'spectator';
  else
    raise exception 'bad_role';
  end if;
  insert into public.versus_members (room_id, user_id, role, display_name, profile, last_seen_at)
    values (p_room, v_user, v_role, left(coalesce(nullif(trim(p_display), ''), 'Player'), 40), coalesce(p_profile, '{}'::jsonb), public.versus_clock());
  update public.versus_rooms set revision = revision + 1, updated_at = public.versus_clock() where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- Swap between an empty player seat and the stands (ruling 10). Only while the room is open.
create or replace function public.versus_take_seat(p_room uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r public.versus_rooms;
  v_cur text;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  select role into v_cur from public.versus_members where room_id = p_room and user_id = v_user;
  if v_cur is null then raise exception 'not_a_member'; end if;
  if r.status <> 'open' then raise exception 'room_not_open'; end if;
  if p_role not in ('p1', 'p2', 'spectator') then raise exception 'bad_role'; end if;
  if v_cur = p_role then return public.versus__room_json(p_room); end if;
  if p_role in ('p1', 'p2') and exists (select 1 from public.versus_members where room_id = p_room and role = p_role) then raise exception 'seat_taken'; end if;
  if p_role = 'spectator' and (select count(*) from public.versus_members where room_id = p_room and role = 'spectator') >= 20 then raise exception 'spectators_full'; end if;
  update public.versus_members set role = p_role where room_id = p_room and user_id = v_user;
  update public.versus_rooms set revision = revision + 1, updated_at = public.versus_clock() where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- Leave. A player leaving a running match forfeits it. The host role passes on (players first); an empty room is removed.
create or replace function public.versus_leave_room(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r public.versus_rooms;
  m public.versus_matches;
  v_role text;
  v_next uuid;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then return jsonb_build_object('left', true); end if;
  select role into v_role from public.versus_members where room_id = p_room and user_id = v_user;
  if v_role is null then return jsonb_build_object('left', true); end if;
  if r.status = 'in_game' and v_role in ('p1', 'p2') and r.current_match_id is not null then
    select * into m from public.versus_matches where id = r.current_match_id for update;
    if found and m.phase <> 'complete' then
      perform public.versus__complete(m, case when v_role = 'p1' then 'p2' else 'p1' end, 'forfeit');
    end if;
  end if;
  delete from public.versus_members where room_id = p_room and user_id = v_user;
  if not exists (select 1 from public.versus_members where room_id = p_room) then
    delete from public.versus_rooms where id = p_room;
    return jsonb_build_object('left', true, 'roomClosed', true);
  end if;
  if r.host_user_id = v_user then
    select user_id into v_next from public.versus_members where room_id = p_room
      order by (role = 'spectator'), joined_at limit 1;
    update public.versus_rooms set host_user_id = v_next where id = p_room;
  end if;
  -- A seat emptied during the gate ceremony reopens the room.
  update public.versus_rooms set status = case when status = 'sealed' then 'open' else status end,
    p1_gate = false, p2_gate = false, gate_deadline = case when status = 'sealed' then null else gate_deadline end,
    revision = revision + 1, updated_at = public.versus_clock() where id = p_room;
  return jsonb_build_object('left', true);
end;
$$;

-- Host: close the player gates. Both seats must be filled.
create or replace function public.versus_start_game(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.versus_rooms;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  if r.host_user_id <> auth.uid() then raise exception 'not_host'; end if;
  if r.status <> 'open' then raise exception 'room_not_open'; end if;
  if (select count(*) from public.versus_members where room_id = p_room and role in ('p1', 'p2')) < 2 then raise exception 'need_two_players'; end if;
  update public.versus_rooms set status = 'sealed', p1_gate = false, p2_gate = false,
    gate_deadline = public.versus_clock() + interval '30 seconds', revision = revision + 1, updated_at = public.versus_clock()
    where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- Room-level deadline: a sealed room whose gems were not both pressed in 30 s returns to Open (ruling 5).
create or replace function public.versus_reconcile_room(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.versus_rooms;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  if r.status = 'sealed' and public.versus_clock() >= r.gate_deadline then
    update public.versus_rooms set status = 'open', p1_gate = false, p2_gate = false, gate_deadline = null,
      revision = revision + 1, updated_at = public.versus_clock() where id = p_room;
  end if;
  return public.versus__room_json(p_room);
end;
$$;

-- A player presses their gate gem. Both pressed in time → the match begins with Hero Select (20 s).
create or replace function public.versus_press_gate(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := public.versus_clock();
  r public.versus_rooms;
  v_role text;
  v_p1 public.versus_members;
  v_p2 public.versus_members;
  v_match uuid;
begin
  select * into r from public.versus_rooms where id = p_room for update;
  if not found then raise exception 'no_room'; end if;
  select role into v_role from public.versus_members where room_id = p_room and user_id = v_user;
  if v_role not in ('p1', 'p2') then raise exception 'not_a_player'; end if;
  if r.status <> 'sealed' then raise exception 'room_not_sealed'; end if;
  if v_now >= r.gate_deadline then
    update public.versus_rooms set status = 'open', p1_gate = false, p2_gate = false, gate_deadline = null,
      revision = revision + 1, updated_at = v_now where id = p_room;
    raise exception 'gate_expired';
  end if;
  if v_role = 'p1' then update public.versus_rooms set p1_gate = true where id = p_room returning * into r;
  else update public.versus_rooms set p2_gate = true where id = p_room returning * into r; end if;
  if r.p1_gate and r.p2_gate then
    select * into v_p1 from public.versus_members where room_id = p_room and role = 'p1';
    select * into v_p2 from public.versus_members where room_id = p_room and role = 'p2';
    insert into public.versus_matches (room_id, seed, set_id, content_revision, protocol, phase, p1_user, p2_user, p1_name, p2_name, hero_deadline)
      values (p_room, floor(random() * 2147483647)::bigint, r.set_id, r.content_revision, r.protocol, 'hero_select',
              v_p1.user_id, v_p2.user_id, v_p1.display_name, v_p2.display_name, v_now + interval '20 seconds')
      returning id into v_match;
    insert into public.versus_seat_private (match_id, seat, user_id, hero_seed, run_seed) values
      (v_match, 'p1', v_p1.user_id, floor(random() * 2147483647)::bigint, floor(random() * 2147483647)::bigint),
      (v_match, 'p2', v_p2.user_id, floor(random() * 2147483647)::bigint, floor(random() * 2147483647)::bigint);
    update public.versus_rooms set status = 'in_game', current_match_id = v_match, gate_deadline = null where id = p_room;
  end if;
  update public.versus_rooms set revision = revision + 1, updated_at = v_now where id = p_room;
  return public.versus__room_json(p_room);
end;
$$;

-- Heartbeat: keeps the lease; a returning player resumes a pause on their seat and leaves auto (ruling 6).
create or replace function public.versus_heartbeat(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := public.versus_clock();
  r public.versus_rooms;
  m public.versus_matches;
  v_seat text;
begin
  update public.versus_members set last_seen_at = v_now where room_id = p_room and user_id = v_user;
  if not found then raise exception 'not_a_member'; end if;
  select * into r from public.versus_rooms where id = p_room;
  if r.current_match_id is not null then
    select * into m from public.versus_matches where id = r.current_match_id for update;
    v_seat := public.versus__seat_of(m, v_user);
    if v_seat is not null and m.phase <> 'complete' then
      if m.paused_seat = v_seat then m := public.versus__resume(m); end if;
      if (v_seat = 'p1' and m.p1_auto) or (v_seat = 'p2' and m.p2_auto) then
        update public.versus_matches set
          p1_auto = case when v_seat = 'p1' then false else p1_auto end, p1_missed = case when v_seat = 'p1' then 0 else p1_missed end,
          p2_auto = case when v_seat = 'p2' then false else p2_auto end, p2_missed = case when v_seat = 'p2' then 0 else p2_missed end,
          revision = revision + 1, updated_at = v_now
          where id = m.id returning * into m;
      end if;
      return jsonb_build_object('serverNow', v_now, 'match', public.versus__match_json(m));
    end if;
  end if;
  return jsonb_build_object('serverNow', v_now);
end;
$$;

-- The lobby browser: every room with its occupancy. Prunes members of OPEN rooms not seen for 2 minutes.
create or replace function public.versus_list_rooms()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
begin
  delete from public.versus_members mm using public.versus_rooms r
    where mm.room_id = r.id and r.status = 'open' and mm.last_seen_at < v_now - interval '2 minutes';
  delete from public.versus_rooms r where not exists (select 1 from public.versus_members mm where mm.room_id = r.id);
  return coalesce((select jsonb_agg(j order by j->>'createdAt' desc) from (
    select jsonb_build_object(
      'id', r.id, 'name', r.name, 'status', r.status, 'setId', r.set_id, 'contentRevision', r.content_revision,
      'protocol', r.protocol, 'createdAt', r.created_at, 'currentMatchId', r.current_match_id,
      'hostName', (select display_name from public.versus_members where room_id = r.id and user_id = r.host_user_id),
      'hostProfile', (select profile from public.versus_members where room_id = r.id and user_id = r.host_user_id),
      'players', (select count(*) from public.versus_members where room_id = r.id and role in ('p1', 'p2')),
      'spectators', (select count(*) from public.versus_members where room_id = r.id and role = 'spectator')
    ) as j from public.versus_rooms r) q), '[]'::jsonb);
end;
$$;

-- ── 5. The match ───────────────────────────────────────────────────────────────────────────────────────────
-- The client registers its hidden three (computed from its private hero seed) so a timeout pick can name the hero.
create or replace function public.versus_register_offer(p_match uuid, p_offer text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_matches;
  v_seat text;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if cardinality(p_offer) <> 3 or exists (select 1 from unnest(p_offer) o where o is null or char_length(o) > 32) then raise exception 'bad_offer'; end if;
  update public.versus_seat_private set hero_offer = p_offer where match_id = p_match and seat = v_seat and hero_offer is null;
  return public.versus__match_json(m);
end;
$$;

-- Lock a hero (index into the seat's three). Hidden until both are in or the deadline passes.
create or replace function public.versus_pick_hero(p_match uuid, p_index int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_matches;
  v_seat text;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'hero_select' then raise exception 'wrong_phase'; end if;
  if p_index not between 0 and 2 then raise exception 'bad_index'; end if;
  if public.versus_clock() >= m.hero_deadline then
    m := public.versus__maybe_start(m);
    raise exception 'hero_deadline_passed';
  end if;
  update public.versus_seat_private set hero_index = p_index where match_id = p_match and seat = v_seat and hero_index is null;
  m := public.versus__maybe_start(m);
  return public.versus__match_json(m);
end;
$$;

-- Upload a turn candidate (`p_final` = End Turn: irreversible). Newer sequence numbers only; refused once locked.
create or replace function public.versus_submit(p_match uuid, p_round int, p_seq int, p_side jsonb, p_final boolean, p_checkpoint jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  m public.versus_matches;
  v_seat text;
  s public.versus_submissions;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, v_user);
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'shop' or m.round <> p_round then raise exception 'stale_round'; end if;
  if m.paused_at is null and public.versus_clock() >= m.shop_deadline then raise exception 'deadline_passed'; end if;
  if p_side is null or octet_length(p_side::text) > 262144 then raise exception 'side_too_large'; end if;
  if p_checkpoint is not null and octet_length(p_checkpoint::text) > 1048576 then raise exception 'checkpoint_too_large'; end if;
  select * into s from public.versus_submissions where match_id = p_match and round = p_round and seat = v_seat;
  if found and s.final then raise exception 'already_locked'; end if;
  if found and p_seq <= s.candidate_seq and not p_final then
    return public.versus__match_json(m); -- an older candidate arriving late: ignore
  end if;
  insert into public.versus_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source, checkpoint)
    values (p_match, p_round, v_seat, v_user, p_seq, p_side, p_final, case when p_final then 'lock' else 'candidate' end, p_checkpoint)
    on conflict (match_id, round, seat) do update set candidate_seq = greatest(excluded.candidate_seq, public.versus_submissions.candidate_seq),
      prepared_side = excluded.prepared_side, final = excluded.final, source = excluded.source,
      checkpoint = coalesce(excluded.checkpoint, public.versus_submissions.checkpoint), updated_at = now();
  if p_final then
    if v_seat = 'p1' then update public.versus_matches set p1_locked = true, revision = revision + 1 where id = p_match returning * into m;
    else update public.versus_matches set p2_locked = true, revision = revision + 1 where id = p_match returning * into m; end if;
    m := public.versus__maybe_resolve(m);
  end if;
  return public.versus__match_json(m);
end;
$$;

-- A player finished (or skipped) watching round p_round's fight. Both ready (auto seats count) → the next shop.
create or replace function public.versus_combat_ready(p_match uuid, p_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_matches;
  v_seat text;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'combat' or m.round <> p_round then return public.versus__match_json(m); end if;
  if v_seat = 'p1' then update public.versus_matches set p1_ready = true where id = p_match returning * into m;
  else update public.versus_matches set p2_ready = true where id = p_match returning * into m; end if;
  if (m.p1_ready or m.p1_auto) and (m.p2_ready or m.p2_auto) and m.paused_at is null then
    m := public.versus__open_shop(m, m.round + 1);
  end if;
  return public.versus__match_json(m);
end;
$$;

-- Concede.
create or replace function public.versus_forfeit(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_matches;
  v_seat text;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'complete' then m := public.versus__complete(m, case when v_seat = 'p1' then 'p2' else 'p1' end, 'forfeit'); end if;
  return public.versus__match_json(m);
end;
$$;

-- Past the 30 s grace, the PRESENT player may unpause: the absent seat goes on auto (ruling 6).
create or replace function public.versus_unpause(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_matches;
  v_seat text;
  v_absent text;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.paused_at is null then return public.versus__match_json(m); end if;
  v_absent := m.paused_seat;
  if v_absent = v_seat then raise exception 'cannot_unpause_own_absence'; end if;
  if public.versus_clock() < m.pause_grace_until then raise exception 'grace_running'; end if;
  update public.versus_matches set p1_auto = p1_auto or v_absent = 'p1', p2_auto = p2_auto or v_absent = 'p2'
    where id = p_match returning * into m;
  m := public.versus__resume(m);
  m := public.versus__maybe_resolve(m);
  if m.phase = 'combat' and (m.p1_ready or m.p1_auto) and (m.p2_ready or m.p2_auto) then m := public.versus__open_shop(m, m.round + 1); end if;
  return public.versus__match_json(m);
end;
$$;

-- Apply whatever is due: pause detection, hero timeout, shop deadline promotion, the combat cap, abandonment.
-- Any member may call it; it is idempotent.
create or replace function public.versus_reconcile(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_matches;
  v_seen1 timestamptz;
  v_seen2 timestamptz;
  v_gone1 boolean;
  v_gone2 boolean;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if m.phase = 'complete' then return public.versus__match_json(m); end if;
  select last_seen_at into v_seen1 from public.versus_members where room_id = m.room_id and user_id = m.p1_user;
  select last_seen_at into v_seen2 from public.versus_members where room_id = m.room_id and user_id = m.p2_user;
  v_gone1 := v_seen1 is null or v_seen1 < v_now - interval '12 seconds';
  v_gone2 := v_seen2 is null or v_seen2 < v_now - interval '12 seconds';

  if m.paused_at is not null then
    -- Back in time: resume. Both players gone for 10 minutes: abandoned, nobody wins.
    if (m.paused_seat = 'p1' and not v_gone1) or (m.paused_seat = 'p2' and not v_gone2) then
      m := public.versus__resume(m);
    elsif v_gone1 and v_gone2 and v_now >= m.paused_at + interval '10 minutes' then
      m := public.versus__complete(m, null, 'abandoned');
      return public.versus__match_json(m);
    else
      return public.versus__match_json(m);
    end if;
  end if;

  -- A newly absent player (not already on auto) pauses the shared clock.
  if (v_gone1 and not m.p1_auto) or (v_gone2 and not m.p2_auto) then
    update public.versus_matches set
      paused_seat = case when v_gone1 and not m.p1_auto then 'p1' else 'p2' end,
      paused_at = v_now, pause_grace_until = v_now + interval '30 seconds',
      revision = revision + 1, updated_at = v_now
      where id = m.id returning * into m;
    return public.versus__match_json(m);
  end if;

  if m.phase = 'hero_select' and v_now >= m.hero_deadline then
    m := public.versus__maybe_start(m);
  elsif m.phase = 'shop' and v_now >= m.shop_deadline then
    if not m.p1_locked then perform public.versus__finalize_seat(m.id, m.round, 'p1', m.p1_user, m.p1_auto); end if;
    if not m.p2_locked then perform public.versus__finalize_seat(m.id, m.round, 'p2', m.p2_user, m.p2_auto); end if;
    update public.versus_matches set p1_locked = true, p2_locked = true where id = m.id returning * into m;
    m := public.versus__maybe_resolve(m);
  elsif m.phase = 'shop' then
    m := public.versus__maybe_resolve(m); -- an auto seat never locks: the present player's lock is enough
  elsif m.phase = 'combat' and v_now >= m.combat_deadline then
    m := public.versus__open_shop(m, m.round + 1);
  end if;
  return public.versus__match_json(m);
end;
$$;

-- THE ROUND COMMIT. Service role only (the `versus-resolve` Edge Function, after its one `simulate()`).
-- Idempotent: a second commit for the same round returns the stored row and changes nothing.
create or replace function public.versus_commit_round(
  p_match uuid, p_round int, p_chair text, p_outcome text, p_heart_lost_by text, p_p1 jsonb, p_p2 jsonb, p_digest text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_matches;
  v_h1 int;
  v_h2 int;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if exists (select 1 from public.versus_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus__match_json(m));
  end if;
  if m.phase <> 'resolving' or m.round <> p_round then raise exception 'not_resolving'; end if;
  if p_outcome not in ('p1', 'p2', 'draw') then raise exception 'bad_outcome'; end if;
  if (p_outcome = 'draw') <> (p_heart_lost_by is null) then raise exception 'bad_outcome'; end if;
  v_h1 := m.p1_hearts - case when p_heart_lost_by = 'p1' then 1 else 0 end;
  v_h2 := m.p2_hearts - case when p_heart_lost_by = 'p2' then 1 else 0 end;
  insert into public.versus_rounds (match_id, round, chair, outcome, heart_lost_by, p1_result, p2_result, digest, p1_hearts, p2_hearts)
    values (p_match, p_round, p_chair, p_outcome, p_heart_lost_by, p_p1, p_p2, p_digest, v_h1, v_h2);
  update public.versus_matches set p1_hearts = v_h1, p2_hearts = v_h2,
    p1_missed = case when p1_auto then p1_missed + 1 else 0 end,
    p2_missed = case when p2_auto then p2_missed + 1 else 0 end,
    phase = 'combat', combat_deadline = v_now + interval '90 seconds', p1_ready = false, p2_ready = false,
    revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  if v_h1 <= 0 or v_h2 <= 0 then
    m := public.versus__complete(m, case when v_h1 <= 0 then 'p2' else 'p1' end, 'hearts');
  elsif m.p1_missed >= 3 then
    m := public.versus__complete(m, 'p2', 'missed');
  elsif m.p2_missed >= 3 then
    m := public.versus__complete(m, 'p1', 'missed');
  end if;
  return jsonb_build_object('alreadyCommitted', false, 'match', public.versus__match_json(m));
end;
$$;

-- A player's latest spectator keyframe (its own seat only; newer sequences only).
create or replace function public.versus_publish_frame(p_match uuid, p_seq bigint, p_round int, p_frame jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.versus_matches;
  v_seat text;
begin
  select * into m from public.versus_matches where id = p_match;
  if not found then raise exception 'no_match'; end if;
  v_seat := public.versus__seat_of(m, auth.uid());
  if v_seat is null then raise exception 'not_a_player'; end if;
  if p_frame is null or octet_length(p_frame::text) > 196608 then raise exception 'frame_too_large'; end if;
  insert into public.versus_spectator_frames (match_id, seat, seq, round, frame) values (p_match, v_seat, p_seq, p_round, p_frame)
    on conflict (match_id, seat) do update set seq = excluded.seq, round = excluded.round, frame = excluded.frame, updated_at = now()
    where public.versus_spectator_frames.seq < excluded.seq;
end;
$$;

-- ── 6. Grants: clients call the public RPCs; helpers and the commit are not theirs ────────────────────────
revoke all on function public.versus__match_json(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus__room_json(uuid) from public, anon, authenticated;
revoke all on function public.versus__seat_of(public.versus_matches, uuid) from public, anon, authenticated;
revoke all on function public.versus__pick(bigint, text, int) from public, anon, authenticated;
revoke all on function public.versus__open_shop(public.versus_matches, int) from public, anon, authenticated;
revoke all on function public.versus__finalize_seat(uuid, int, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.versus__maybe_resolve(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus__resume(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus__complete(public.versus_matches, text, text) from public, anon, authenticated;
revoke all on function public.versus__maybe_start(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus_commit_round(uuid, int, text, text, text, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.versus_commit_round(uuid, int, text, text, text, jsonb, jsonb, text) to service_role;

revoke all on function public.versus_create_room(text, text, jsonb, text, text, int) from public, anon;
revoke all on function public.versus_join_room(uuid, text, text, jsonb, text, int) from public, anon;
revoke all on function public.versus_take_seat(uuid, text) from public, anon;
revoke all on function public.versus_leave_room(uuid) from public, anon;
revoke all on function public.versus_start_game(uuid) from public, anon;
revoke all on function public.versus_reconcile_room(uuid) from public, anon;
revoke all on function public.versus_press_gate(uuid) from public, anon;
revoke all on function public.versus_heartbeat(uuid) from public, anon;
revoke all on function public.versus_list_rooms() from public, anon;
revoke all on function public.versus_register_offer(uuid, text[]) from public, anon;
revoke all on function public.versus_pick_hero(uuid, int) from public, anon;
revoke all on function public.versus_submit(uuid, int, int, jsonb, boolean, jsonb) from public, anon;
revoke all on function public.versus_combat_ready(uuid, int) from public, anon;
revoke all on function public.versus_forfeit(uuid) from public, anon;
revoke all on function public.versus_unpause(uuid) from public, anon;
revoke all on function public.versus_reconcile(uuid) from public, anon;
revoke all on function public.versus_publish_frame(uuid, bigint, int, jsonb) from public, anon;

grant execute on function public.versus_create_room(text, text, jsonb, text, text, int) to authenticated;
grant execute on function public.versus_join_room(uuid, text, text, jsonb, text, int) to authenticated;
grant execute on function public.versus_take_seat(uuid, text) to authenticated;
grant execute on function public.versus_leave_room(uuid) to authenticated;
grant execute on function public.versus_start_game(uuid) to authenticated;
grant execute on function public.versus_reconcile_room(uuid) to authenticated;
grant execute on function public.versus_press_gate(uuid) to authenticated;
grant execute on function public.versus_heartbeat(uuid) to authenticated;
grant execute on function public.versus_list_rooms() to authenticated;
grant execute on function public.versus_register_offer(uuid, text[]) to authenticated;
grant execute on function public.versus_pick_hero(uuid, int) to authenticated;
grant execute on function public.versus_submit(uuid, int, int, jsonb, boolean, jsonb) to authenticated;
grant execute on function public.versus_combat_ready(uuid, int) to authenticated;
grant execute on function public.versus_forfeit(uuid) to authenticated;
grant execute on function public.versus_unpause(uuid) to authenticated;
grant execute on function public.versus_reconcile(uuid) to authenticated;
grant execute on function public.versus_publish_frame(uuid, bigint, int, jsonb) to authenticated;

-- ── 7. Realtime: rooms, members, matches and rounds wake clients (rows stay the truth) ────────────────────
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versus_rooms') then
      alter publication supabase_realtime add table public.versus_rooms;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versus_members') then
      alter publication supabase_realtime add table public.versus_members;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versus_matches') then
      alter publication supabase_realtime add table public.versus_matches;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'versus_rounds') then
      alter publication supabase_realtime add table public.versus_rounds;
    end if;
  end if;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS PROGRESSION: Versus grants XP and achievements, never rank  (2026-10-14)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-03-placement-xp.sql (the last file that defined
-- `settle_progression`) and 2026-10-13-versus.sql (it reads `versus_matches` / `versus_rounds`). THEN deploy the
-- `submit-progression` Edge Function (its shared rules accept mode 'versus'). Idempotent. If 2026-10-03-placement-
-- xp.sql (or an earlier settle_progression file) is ever re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-10-14: "versus can complete achievements and grant XP but no rank progress"):
--  - `progression_results.mode` accepts 'versus' (the column check is replaced; existing rows are unaffected).
--  - `settle_progression` gains a `versus` branch. The SOURCE is the server-owned `versus_matches` row (run id
--    `versus:<match id>`): the caller must have been one of its two players, the match must be complete and must
--    have fought at least one round. XP: 100 for a completed match, +60 for the winner; no comeback. Achievements:
--    Versus passes the `any` gate (like Ranked and standard Practice) with its server-recorded hero, but a 1v1 win is
--    not a lobby placement, so Top 4 / 1st achievements never count it. Ranked-only achievements stay Ranked-only.
--  - NO rank effect: the Versus branch never reads or writes rank_results, profiles.rating, medals or MMR. Only the
--    account XP, level, level crates, titles and achievements move, exactly as for Practice.
--  - Every other line of the function is byte-for-byte the 2026-10-03 writer (diff in the devlog).

-- ── 1. progression_results.mode accepts 'versus' ─────────────────────────────────────────────────────────
-- The column's inline check was created unnamed (Postgres calls it `progression_results_mode_check`); drop whatever
-- CHECK on this table constrains `mode` by its definition, so the swap works whatever the live name is.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.progression_results'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ '\mmode\M'
  loop
    execute format('alter table public.progression_results drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table public.progression_results add constraint progression_results_mode_check
  check (mode in ('ranked', 'practice', 'tutorial', 'versus'));

-- ── 2. settle_progression: the versus branch ──────────────────────────────────────────────────────────────
create or replace function public.settle_progression(
  p_user uuid, p_mode text, p_run_id text, p_source_id bigint default null, p_comeback boolean default false,
  p_rules_version int default null, p_facts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of XP_RULES / CURVE in packages/progression/src/rules.ts — change all copies together)
  c_rules             constant int := 1;
  c_curve             constant int := 1;
  c_complete          constant int := 100;
  c_top_four          constant int := 60;
  c_first_place       constant int := 90;
  c_comeback          constant int := 25;
  c_comeback_streak   constant int := 4;
  c_practice_percent  constant int := 60;
  c_practice_flat     constant int := 60;
  c_tutorial          constant int := 250;
  c_tutorial_course   constant text := 'learn-ascent';
  c_tutorial_version  constant int := 1;
  c_alpha_title       constant text := 'alpha_tester';
  c_alpha_level       constant int := 2;
  c_rate_max          constant int := 30;
  c_rate_window       constant interval := interval '10 minutes';
  -- ACHIEVEMENTS (mirror of packages/progression/src/achievements.ts)
  c_meta_metric       constant text := 'achievementsCompleted';
  c_brutal_strength   constant int := 70;
  c_ascendant_div     constant int := 15;
  c_metric_max        constant bigint := 1000000000;
  -- HERO TITLES (mirror of heroTitleId / heroMasterTitleId in packages/progression/src/cosmetics.ts)
  c_hero_title_prefix constant text := 'title_hero_';
  c_master_suffix     constant text := '_master';
  -- VERSUS (owner 2026-10-14: "versus can complete achievements and grant XP but no rank progress")
  c_versus_win        constant int := 60;
  c_versus_min_rounds constant int := 1;

  prof        public.profiles%rowtype;
  prev        public.progression_results%rowtype;
  v_epoch     timestamptz;
  v_recent    int;
  v_source_at timestamptz;
  v_source    text := null;
  v_placement int := null;
  v_comeback  boolean := false;
  v_seed      bigint;
  v_cfg       jsonb;
  v_record    jsonb;
  v_wins      int;
  v_losses    int;
  r_top int := 0; r_first int := 0; r_come int := 0; v_ranked_total int;
  v_base int := 0; v_top int := 0; v_first int := 0; v_come int := 0; v_total int;
  v_xp0 bigint; v_xp1 bigint; v_l0 int; v_l1 int;
  v_unlocked  text[] := '{}';
  v_equipped  text;
  v_rows      int;
  v_facts_ver int := null;
  v_enrolling boolean;
  v_crate_ids uuid[] := '{}';
  -- achievements
  v_ach_epoch  timestamptz;
  v_promoted   boolean := false;
  v_div_before int := null;
  v_demo_game  boolean := false;
  v_demoted    boolean := false;
  v_strength   int := null;
  v_hero       text := null;
  v_set        text := null;
  v_run_ok     boolean := false;
  v_metrics    jsonb := '{}';
  v_first_streak int := 0;
  v_top_streak int := 0;
  v_heroes_played int := 0;
  v_heroes_won int := 0;
  v_done_count int := 0;
  d            public.achievement_catalog%rowtype;
  v_val        bigint;
  v_old        bigint;
  v_done       boolean;
  v_new        bigint;
  v_ach_ids    text[] := '{}';
  v_ach_xp     int := 0;
  v_hero_title text := null;
  -- versus
  v_match      public.versus_matches%rowtype;
  v_vs_seat    text := null;
  v_ach_place  int := null;
begin
  -- 1. validate
  if p_mode is null or p_mode not in ('ranked', 'practice', 'tutorial', 'versus') then raise exception 'bad_mode'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. serialize per user (every progression entry point takes the advisory lock first), then lock the row
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.progression_results where user_id = p_user and run_id = p_run_id and mode = p_mode;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
  end if;

  -- 4. the switch: nothing is awarded before the owner sets the epoch
  select epoch, achievements_epoch into v_epoch, v_ach_epoch from public.progression_config where id = 1;
  if v_epoch is null then raise exception 'progression_disabled'; end if;

  -- 5. rate limit (technical only: a refused request is retried later and keeps its XP)
  select count(*) into v_recent from public.progression_results
    where user_id = p_user and settled_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 6. the SOURCE row: the placement comes from here, never from the request
  if p_mode = 'ranked' then
    select rr.placement, rr.seed, rr.created_at, rr.promoted, rr.division_before, rr.was_demotion_game, rr.demoted, rr.lobby_strength
      into v_placement, v_seed, v_source_at, v_promoted, v_div_before, v_demo_game, v_demoted, v_strength
      from public.rank_results rr where rr.user_id = p_user and rr.run_id = p_run_id;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_run_id;
    v_comeback := coalesce(p_comeback, false);
    if v_comeback and v_seed is not null then
      select h.wins, case when (h.entry->>'losses') ~ '^[0-9]+$' then (h.entry->>'losses')::int end
        into v_wins, v_losses
        from public.run_history h
        where h.user_id = p_user and h.mode = 'lobby' and h.entry->>'seed' = v_seed::text
        order by h.created_at desc limit 1;
      if found and (coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1) then v_comeback := false; end if;
    end if;
  elsif p_mode = 'practice' then
    if p_source_id is null or p_source_id < 1 then raise exception 'bad_source'; end if;
    if p_run_id is distinct from ('practice:' || p_source_id::text) then raise exception 'bad_run_id'; end if;
    select pg.placement, pg.config, pg.record, pg.created_at, pg.hero_id into v_placement, v_cfg, v_record, v_source_at, v_hero
      from public.practice_games pg where pg.id = p_source_id and pg.user_id = p_user;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_source_id::text;
    -- No meaningful placement: an Unlimited Health game plays to the curtain and is never eliminated (and a row
    -- with no options recorded is treated the same way). It earns the flat XP, no placement or comeback bonus.
    if v_cfg is null or coalesce(v_cfg->>'health', 'unlimited') <> 'normal'
       or v_placement is null or v_placement < 1 or v_placement > 8 then
      v_placement := null;
    end if;
    v_comeback := coalesce(p_comeback, false) and v_placement is not null;
    if v_comeback and v_record is not null then
      v_wins := case when (v_record->>'wins') ~ '^[0-9]+$' then (v_record->>'wins')::int end;
      v_losses := case when (v_record->>'losses') ~ '^[0-9]+$' then (v_record->>'losses')::int end;
      if coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1 then v_comeback := false; end if;
    end if;
  elsif p_mode = 'versus' then
    -- VERSUS: the source is the server-owned match row. The caller must have held a PLAYER seat, the match must be
    -- over and must have fought at least one round. Placement = 1 for the winner, 2 for the loser, null when nobody
    -- won (abandoned). It drives XP only: rank_results, rating and MMR are never read or written here.
    if p_run_id !~ '^versus:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_run_id'; end if;
    select * into v_match from public.versus_matches m where m.id = substring(p_run_id from 8)::uuid;
    if not found then raise exception 'source_not_found'; end if;
    v_vs_seat := case when v_match.p1_user = p_user then 'p1' when v_match.p2_user = p_user then 'p2' end;
    if v_vs_seat is null then raise exception 'source_not_found'; end if;
    if v_match.phase <> 'complete' or v_match.completed_at is null then raise exception 'not_terminal'; end if;
    if not exists (select 1 from public.versus_rounds vr where vr.match_id = v_match.id and vr.round >= c_versus_min_rounds) then raise exception 'not_terminal'; end if;
    v_source_at := v_match.completed_at;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := v_match.id::text;
    v_placement := case when v_match.winner_seat is null then null when v_match.winner_seat = v_vs_seat then 1 else 2 end;
    v_comeback := false;
    v_hero := case when v_vs_seat = 'p1' then v_match.p1_hero else v_match.p2_hero end;
  else
    -- tutorial: one claim per account per course version (the ledger check above already caught a repeat)
    if p_run_id is distinct from (c_tutorial_course || ':v' || c_tutorial_version::text) then raise exception 'bad_run_id'; end if;
    insert into public.tutorial_progression_claims (user_id, course_id, course_version, xp_awarded)
      values (p_user, c_tutorial_course, c_tutorial_version, c_tutorial)
      on conflict (user_id, course_id, course_version) do nothing;
    v_source := c_tutorial_course || ':' || c_tutorial_version::text;
  end if;

  -- 7. XP (mirror of xpForSettlement)
  if p_mode = 'tutorial' then
    v_base := c_tutorial;
  elsif p_mode = 'versus' then
    -- VERSUS: the completion XP, plus the win bonus for the winner (stored in the first-place column).
    v_base := c_complete;
    v_first := case when v_placement = 1 then c_versus_win else 0 end;
  elsif p_mode = 'practice' and v_placement is null then
    v_base := c_practice_flat;
  else
    r_top   := case when v_placement <= 4 then c_top_four else 0 end;
    r_first := case when v_placement = 1 then c_first_place else 0 end;
    r_come  := case when v_comeback then c_comeback else 0 end;
    if p_mode = 'ranked' then
      v_base := c_complete; v_top := r_top; v_first := r_first; v_come := r_come;
    else
      -- Practice: 60% of the equivalent ranked XP, summed then rounded; the remainder lands on the base.
      v_ranked_total := c_complete + r_top + r_first + r_come;
      v_top   := (r_top   * c_practice_percent + 50) / 100;
      v_first := (r_first * c_practice_percent + 50) / 100;
      v_come  := (r_come  * c_practice_percent + 50) / 100;
      v_base  := (v_ranked_total * c_practice_percent + 50) / 100 - v_top - v_first - v_come;
    end if;
  end if;
  v_total := v_base + v_top + v_first + v_come;

  if p_facts is not null and jsonb_typeof(p_facts) = 'object' and (p_facts->>'version') ~ '^[0-9]+$' then
    v_facts_ver := (p_facts->>'version')::int;
  end if;

  -- 7b. ACHIEVEMENTS (mirror of evaluateAchievements in packages/progression/src/achievements.ts). Only once the
  -- owner has set the achievements epoch, and only for a game whose source row is not older than it.
  if v_ach_epoch is not null and coalesce(v_source_at, now()) >= v_ach_epoch then
    -- The `any` gate: Ranked, or a standard Practice (Normal Health, so a real placement, AND a turn timer).
    v_run_ok := p_mode = 'ranked' or p_mode = 'versus'
      or (p_mode = 'practice' and v_placement is not null and coalesce(v_cfg->>'timeMult', '') ~ '^[1-9][0-9]*$');
    if p_mode = 'ranked' then v_hero := p_facts->>'heroId'; end if;
    -- VERSUS: a 1v1 "1st" is not a lobby finish, so placement-gated achievements (Top 4, 1st) never count it.
    v_ach_place := case when p_mode = 'versus' then null else v_placement end;
    if v_hero is not null and v_hero !~ '^[A-Za-z0-9_.-]{1,64}$' then v_hero := null; end if;
    v_set := p_facts->>'setId';
    if v_set is not null and v_set !~ '^[A-Za-z0-9_.-]{1,32}$' then v_set := null; end if;

    -- Distinct heroes: this game counts toward its hero when it is an eligible game.
    if v_run_ok and v_hero is not null then
      insert into public.achievement_hero_stats (user_id, hero_id, games, firsts)
        values (p_user, v_hero, 1, case when p_mode = 'ranked' and v_placement = 1 then 1 else 0 end)
        on conflict (user_id, hero_id) do update set
          games = public.achievement_hero_stats.games + 1,
          firsts = public.achievement_hero_stats.firsts + excluded.firsts,
          updated_at = now();
    end if;
    select count(*) filter (where s.games > 0), count(*) filter (where s.firsts > 0) into v_heroes_played, v_heroes_won
      from public.achievement_hero_stats s where s.user_id = p_user;

    -- Ranked streaks, over Ranked games since the achievements epoch, ending with this one.
    if p_mode = 'ranked' then
      with r as (
        select rr.placement, row_number() over (order by rr.created_at desc, rr.run_id desc) as rn
        from public.rank_results rr
        where rr.user_id = p_user and rr.created_at >= v_ach_epoch and rr.created_at <= v_source_at
      )
      select coalesce((select min(rn) from r where placement <> 1) - 1, (select count(*) from r)),
             coalesce((select min(rn) from r where placement > 4) - 1, (select count(*) from r))
        into v_first_streak, v_top_streak;
    end if;

    -- The metrics: the client's run metrics (V2), overwritten by every server metric (a client can never name one).
    if coalesce(v_facts_ver, 0) >= 2 and jsonb_typeof(p_facts->'metrics') = 'object' then v_metrics := p_facts->'metrics'; end if;
    v_metrics := v_metrics || jsonb_build_object(
      'game', 1,
      'comeback', case when v_comeback then 1 else 0 end,
      'highestDivision', coalesce(prof.rank_highest_division, 0),
      'promoted', case when p_mode = 'ranked' and v_promoted then 1 else 0 end,
      'ascendantFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_div_before, 0) >= c_ascendant_div then 1 else 0 end,
      'demotionEscape', case when p_mode = 'ranked' and v_demo_game and not v_demoted and v_placement <= 4 then 1 else 0 end,
      'brutalFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_strength, 0) >= c_brutal_strength then 1 else 0 end,
      'firstStreak', v_first_streak,
      'topFourStreak', v_top_streak,
      'heroesPlayed', v_heroes_played,
      'heroesWon', v_heroes_won,
      c_meta_metric, 0
    );

    -- Pass 1: every live, non-prestige, non-meta definition, in id order. Pass 2: the meta family, by target.
    select count(*) into v_done_count from public.achievement_completions c where c.user_id = p_user;
    for d in
      select * from public.achievement_catalog c
      where c.active and not c.admin_off and c.trust <> 'P'
      order by (c.metric = c_meta_metric), case when c.metric = c_meta_metric then c.target else 0 end, c.achievement_id collate "C"
    loop
      continue when d.mode = 'ranked' and p_mode <> 'ranked';
      continue when d.mode = 'tutorial' and p_mode <> 'tutorial';
      continue when d.mode = 'any' and not v_run_ok;
      continue when d.set_id is not null and v_set is distinct from d.set_id;
      continue when d.hero_id is not null and v_hero is distinct from d.hero_id;
      continue when d.placement_max is not null and (v_ach_place is null or v_ach_place > d.placement_max);
      if d.metric = c_meta_metric then
        v_val := v_done_count;
      elsif jsonb_typeof(v_metrics->d.metric) = 'number' then
        v_val := least(c_metric_max, greatest(0, floor((v_metrics->>d.metric)::numeric)))::bigint;
      else
        v_val := 0;
      end if;
      continue when v_val <= 0;
      select ap.progress, ap.completed_at is not null into v_old, v_done
        from public.achievement_progress ap where ap.user_id = p_user and ap.achievement_id = d.achievement_id;
      if not found then v_old := 0; v_done := false; end if;
      continue when v_done;
      v_new := case when d.agg = 'sum' then v_old + v_val else greatest(v_old, v_val) end;
      continue when v_new = v_old and v_new < d.target;
      insert into public.achievement_progress (user_id, achievement_id, definition_version, progress, completed_at, completion_run_id, updated_at)
        values (p_user, d.achievement_id, d.version, v_new,
                case when v_new >= d.target then now() end, case when v_new >= d.target then p_run_id end, now())
        on conflict (user_id, achievement_id) do update set
          definition_version = excluded.definition_version, progress = excluded.progress,
          completed_at = excluded.completed_at, completion_run_id = excluded.completion_run_id, updated_at = now();
      if v_new >= d.target then
        insert into public.achievement_completions (user_id, achievement_id, run_id, mode, xp_awarded, title_id)
          values (p_user, d.achievement_id, p_run_id, p_mode, d.xp, d.title_id)
          on conflict (user_id, achievement_id) do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          v_ach_ids := array_append(v_ach_ids, d.achievement_id);
          v_ach_xp := v_ach_xp + d.xp;
          v_done_count := v_done_count + 1;
          -- 7c. A TITLE reward (hero titles, owner 2026-09-29) is granted in the same transaction. Only a title the
          -- catalog knows (the ownership FK); the grant is keyed, so a retry or the backfill never doubles it.
          if d.title_id is not null and exists (select 1 from public.cosmetic_catalog c where c.cosmetic_id = d.title_id and c.category = 'title') then
            insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
              values (p_user, d.title_id, 'achievement', d.achievement_id)
              on conflict (user_id, cosmetic_id) do nothing;
            get diagnostics v_rows = row_count;
            if v_rows > 0 then
              v_unlocked := array_append(v_unlocked, d.title_id);
              if d.title_id like c_hero_title_prefix || '%' then v_hero_title := d.title_id; end if;
            end if;
          end if;
        end if;
      end if;
    end loop;
  end if;

  -- 8. levels (lifetime XP; the level is derived). Achievement XP counts toward the level and its crates.
  v_xp0 := coalesce(prof.account_xp, 0);
  v_xp1 := v_xp0 + v_total + v_ach_xp;
  v_l0 := public.progression_level_of(v_xp0);
  v_l1 := public.progression_level_of(v_xp1);

  -- 9. titles: Alpha Tester for EVERY account at Level 2 (owner 2026-09-27); equipped when nothing else is
  if v_l1 >= c_alpha_level then
    insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
      values (p_user, c_alpha_title, 'level', p_mode || ':' || p_run_id)
      on conflict (user_id, cosmetic_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_unlocked := array_append(v_unlocked, c_alpha_title); end if;
  end if;
  v_equipped := prof.equipped_title_id;
  -- 9a. HERO TITLES (owner 2026-09-29). The master UPGRADES the title in place: a newly earned master replaces its own
  -- base title when that is the one worn. A new hero title is worn when nothing is (like Alpha Tester).
  if v_equipped is not null and v_equipped like c_hero_title_prefix || '%' and (v_equipped || c_master_suffix) = any(v_unlocked) then
    v_equipped := v_equipped || c_master_suffix;
  end if;
  if v_equipped is null and v_hero_title is not null then
    v_equipped := v_hero_title;
  end if;
  if v_equipped is null and exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c_alpha_title) then
    v_equipped := c_alpha_title;
  end if;

  -- 9b. crates: one sealed crate per newly reached level; enrollment (the first settlement) also grants the
  -- Level 1 Welcome Crate. The unique (user, level) key makes this safe against the backfill and any retry.
  v_enrolling := prof.progression_enrolled_at is null;
  with ins as (
    insert into public.loot_crates (user_id, earned_level, source_id)
      select p_user, g.lvl, p_mode || ':' || p_run_id
      from generate_series(case when v_enrolling then 1 else v_l0 + 1 end, v_l1) as g(lvl)
      on conflict (user_id, earned_level) do nothing
      returning crate_id, earned_level
  )
  select coalesce(array_agg(ins.crate_id order by ins.earned_level), '{}') into v_crate_ids from ins;

  -- 10. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    account_xp = v_xp1, account_level = v_l1,
    progression_revision = prof.progression_revision + 1,
    progression_enrolled_at = coalesce(prof.progression_enrolled_at, now()),
    progression_curve_version = c_curve,
    equipped_title_id = v_equipped,
    updated_at = now()
  where user_id = p_user;

  insert into public.progression_results (
    user_id, run_id, mode, source_id, rules_version, curve_version, facts_version, facts,
    placement, comeback, base_xp, top_four_xp, first_place_xp, comeback_xp, achievement_xp, total_xp,
    xp_before, xp_after, level_before, level_after, revision_before, revision_after,
    crates_awarded, crate_ids, achievement_ids, unlocked_title_ids
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, v_ach_xp, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    coalesce(array_length(v_crate_ids, 1), 0), v_crate_ids, v_ach_ids, v_unlocked
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;

-- ── 2. Grants: the writer is service role ONLY (the Edge Function calls it) ────────────────────────────────
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: CARD PLATES, equip_cosmetic accepts the account-wide `card_plate` slot  (2026-10-14)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-13-emotes.sql. Then deploy `progression-inventory`.
-- Idempotent: it only REPLACES `equip_cosmetic` (and re-grants it), so re-running it is always safe; it writes no rows.
-- The same block is appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-10-14-card-plates.md.
-- It SUPERSEDES the equip_cosmetic in 2026-10-13-emotes.sql (it keeps every slot that file has, the emote positions and
-- the starter rule included): if that file, or any older equip_cosmetic file, is ever re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-10-14: "Turn Aquarium Rocks into a real equippable card plate cosmetic, with its own
-- darkening settings, and leave the standard plates untouched"; a crate drop; "replace all plates, but we ALWAYS will
-- have the gilded cards be the existing original card plate hued gold"; "Others see it too").
--  - The `card_plate` category and its first item, `plate_aquarium_rocks` (Legendary), arrive through the code-owned
--    catalog sync (packages/progression/src/cosmetics.ts, deploy progression-inventory); the item joins the crate pool
--    on that deploy. No catalog SQL.
--  - A card plate is ACCOUNT-WIDE (category target `global`), like the portrait frame: one row in
--    `cosmetic_loadouts` with target_id ''. `equip_cosmetic(user, 'card_plate', '', id)` wears one the caller OWNS;
--    a null id takes it off (the standard plates). Every other slot behaves exactly as before.
--  - THE RECORDED PLATE NEEDS NO SQL. It rides the run's cosmetic snapshot (`cardPlate`) inside the BoardSnapshot,
--    stored and served verbatim like the portrait frame. An older client ignores the key.

create or replace function public.equip_cosmetic(p_user uuid, p_slot text, p_target_id text, p_cosmetic_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.cosmetic_catalog%rowtype;
  v_live boolean;
begin
  if p_user is null then raise exception 'not_owned'; end if;
  if p_slot is null or p_slot not in ('hero_skin', 'minion_skin', 'hero_attack', 'portrait_frame', 'announcer', 'emote', 'card_plate') then raise exception 'bad_slot'; end if;
  -- A global slot (hero attack, portrait frame, announcer, card plate) has exactly one target, ''. The emote slot's target is the
  -- menu position '0'..'3'. A skin slot names its hero or card.
  if p_slot in ('hero_attack', 'portrait_frame', 'announcer', 'card_plate') then
    if p_target_id is distinct from '' then raise exception 'bad_target'; end if;
  elsif p_slot = 'emote' then
    if p_target_id is null or p_target_id !~ '^[0-3]$' then raise exception 'bad_target'; end if;
  elsif p_target_id is null or p_target_id !~ '^[A-Za-z0-9_.:-]{1,64}$' then
    raise exception 'bad_target';
  end if;
  if p_cosmetic_id is not null and p_cosmetic_id !~ '^[a-z0-9_]{1,64}$' then raise exception 'bad_cosmetic_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  if p_cosmetic_id is null then
    delete from public.cosmetic_loadouts where user_id = p_user and slot = p_slot and target_id = p_target_id;
  else
    select * into v_cat from public.cosmetic_catalog where cosmetic_id = p_cosmetic_id;
    if not found then raise exception 'bad_cosmetic_id'; end if;
    if v_cat.category <> p_slot then raise exception 'wrong_target'; end if;
    if p_slot in ('hero_attack', 'portrait_frame', 'announcer', 'card_plate') then
      if v_cat.target_type is not null or v_cat.target_id is not null then raise exception 'wrong_target'; end if;
    elsif p_slot = 'emote' then
      if v_cat.target_type is not null or v_cat.target_id is not null then raise exception 'wrong_target'; end if;
    elsif v_cat.target_type is distinct from (case p_slot when 'hero_skin' then 'hero' else 'card' end)
       or v_cat.target_id is distinct from p_target_id then
      raise exception 'wrong_target';
    end if;
    select k.enabled and not k.admin_off into v_live from public.cosmetic_categories k where k.category = v_cat.category;
    if not v_cat.active or v_cat.admin_off or not coalesce(v_live, false) then raise exception 'not_equippable'; end if;
    -- A starter item is everyone's: no ownership row is needed (or ever written).
    if v_cat.acquisition_source <> 'starter'
       and not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = p_cosmetic_id) then
      raise exception 'not_owned';
    end if;
    -- An emote MOVES: it leaves any other menu position it held, so the menu never shows one emote twice.
    if p_slot = 'emote' then
      delete from public.cosmetic_loadouts
        where user_id = p_user and slot = 'emote' and cosmetic_id = p_cosmetic_id and target_id <> p_target_id;
    end if;
    insert into public.cosmetic_loadouts (user_id, slot, target_id, cosmetic_id, updated_at)
      values (p_user, p_slot, p_target_id, p_cosmetic_id, now())
      on conflict (user_id, slot, target_id) do update set cosmetic_id = excluded.cosmetic_id, updated_at = now();
  end if;

  update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = p_user;
  if not found then raise exception 'not_owned'; end if;
  return jsonb_build_object('status', 'equipped', 'profile', public.progression_profile_json(p_user));
end;
$$;

revoke all on function public.equip_cosmetic(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.equip_cosmetic(uuid, text, text, text) to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- EMPTY BOARDS ARE PART OF A RUN: the pool keeps every recorded round, an empty board included  (2026-10-17, R-LOBBY-08)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-09-strength-overall-caps.sql. Idempotent: safe to re-run.
-- The same block is appended to schema.sql; keep the two identical. Owner runbook:
-- docs/devlog/2026-10-17-empty-boards-uploaded.md. No Edge Function needs redeploying.
--
-- WHY (owner 2026-10-17: "i just faced this board on round 1 - how is that possible that he is shop tier 2?", then
-- "empty boards are never uploaded is a problem. this has to be fixed"): the client never uploaded an EMPTY board,
-- and both functions below skipped one anyway. A run whose round 1 was empty (every Disco Dan: his turn 1 is a pure
-- Setlist with nothing on board) therefore looked like it started at round 2, and a lobby seat served its round-2
-- board, at Shop tier 2, in round 1. The client now uploads every round (packages/ui/src/boardLibrary.ts), so:
--
--  - `pool_runs_upsert_from` counts an empty board as one of the run's waves (so such a run now has first_wave 1),
--    and a run with no minions in ANY board is never eligible (`has_minions`);
--  - `pool_runs_sample` returns a run's empty boards with the rest, so the run arrives whole.
--
-- `boards` holds no empty board before this change, so the backfill below changes no existing `pool_runs` row; it
-- only re-derives them under the new rule. Board STRENGTH is untouched: an empty board is never scored (client and
-- backfill), and every strength function reads only scored boards. `god_board_sample` keeps skipping empty boards
-- (a God Mode opponent needs something to fight). ORDER: ship the client first. An older client refuses a sampled
-- run that contains an empty board (its whole-run check rejected one), so it would only lose those new runs.
--
-- A replaced function body keeps its grants; the sample's signature is the 2026-10-09 one, unchanged. Locks: the
-- board-strength migration deadlocked against live pool reads, so this takes both pool tables first.

begin;
lock table public.pool_runs in access exclusive mode;
lock table public.boards in access exclusive mode;

-- ── 1. pool_runs keeps empty boards as waves of the run ────────────────────────────────────────────────────
-- Recompute the rows for these run keys from `boards` (parallel arrays: author, hero, seed). Every non-synthetic
-- board with a `minions` array counts, an empty one included; a run with no minions anywhere is not eligible.
create or replace function public.pool_runs_upsert_from(p_author text[], p_hero text[], p_seed bigint[]) returns void
language plpgsql set search_path = public as $$
begin
  with keys as (
    select distinct k.a as author, k.h as hero_id, k.s as seed
    from unnest(p_author, p_hero, p_seed) as k(a, h, s)
    where k.s is not null and k.h is not null
  ),
  b as (
    select k.author, k.hero_id, k.seed, x.wave, x.user_id, x.patch, x.created_at, x.snapshot
    from keys k
    join public.boards x on coalesce(x.author, 'anon') = k.author and x.hero_id = k.hero_id and x.seed = k.seed
    where jsonb_typeof(x.snapshot -> 'minions') = 'array'
      and coalesce(x.origin, 'self') <> 'synthetic'
  ),
  w as (select distinct author, hero_id, seed, wave from b),
  shape as (
    select author, hero_id, seed, count(*)::int as wave_count, min(wave) as first_wave, max(wave) as last_wave,
           coalesce(max(wave - prev - 1), 0)::int as max_gap
    from (select w.*, lag(wave) over (partition by author, hero_id, seed order by wave) as prev from w) t
    group by author, hero_id, seed
  ),
  agg as (
    select author, hero_id, seed, count(*)::int as boards,
           (array_agg(user_id order by created_at) filter (where user_id is not null))[1] as user_id,
           (array_agg(coalesce(snapshot ->> 'setId', 'set1') order by created_at))[1] as set_id,
           (array_agg(split_part(patch, '+', 1) || '+' order by created_at desc))[1] as patch_prefix,
           bool_and(case when jsonb_typeof(snapshot -> 'tier') = 'number'
                         then (snapshot ->> 'tier')::numeric <= public.pool_max_plausible_tier(wave) else true end) as tiers_ok,
           bool_or(jsonb_array_length(snapshot -> 'minions') > 0) as has_minions
    from b group by author, hero_id, seed
  )
  insert into public.pool_runs as r (author, hero_id, seed, user_id, set_id, patch_prefix, boards, wave_count, first_wave,
                                      last_wave, max_gap, tiers_ok, eligible, updated_at)
  select a.author, a.hero_id, a.seed, a.user_id, a.set_id, a.patch_prefix, a.boards, s.wave_count, s.first_wave,
         s.last_wave, s.max_gap, a.tiers_ok, public.pool_run_eligible(s.wave_count, s.first_wave, s.max_gap, a.tiers_ok) and a.has_minions, now()
  from agg a join shape s using (author, hero_id, seed)
  on conflict (author, hero_id, seed) do update set
    user_id = excluded.user_id, set_id = excluded.set_id, patch_prefix = excluded.patch_prefix, boards = excluded.boards,
    wave_count = excluded.wave_count, first_wave = excluded.first_wave, last_wave = excluded.last_wave,
    max_gap = excluded.max_gap, tiers_ok = excluded.tiers_ok, eligible = excluded.eligible, updated_at = now();

  delete from public.pool_runs r
  using (select distinct k.a as author, k.h as hero_id, k.s as seed from unnest(p_author, p_hero, p_seed) as k(a, h, s)) k
  where r.author = k.author and r.hero_id = k.hero_id and r.seed = k.seed
    and not exists (
      select 1 from public.boards x
      where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
        and jsonb_typeof(x.snapshot -> 'minions') = 'array'
        and coalesce(x.origin, 'self') <> 'synthetic');
end $$;

-- ── 2. The sample returns a run's empty boards with the rest ──────────────────────────────────────────────
create or replace function public.pool_runs_sample(
  p_limit int default 150,
  p_set text default null,
  p_patch_prefix text default null,
  p_exclude_user uuid default null,
  p_seed text default null,
  p_strength_min numeric default null,
  p_strength_max numeric default null,
  p_pool text default null,
  p_early_weight numeric default null,
  p_strength_cap numeric default null
) returns table (run_key text, author text, user_id uuid, wave_count int, strength numeric, strength_early numeric, strength_late numeric, boards jsonb)
language plpgsql volatile set search_path = public as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 150), 0), 300);
  lo bigint; hi bigint; span bigint;
  picked bigint[] := '{}';
  cand bigint; tries int := 0; u double precision;
begin
  select min(r.id), max(r.id) into lo, hi from public.pool_runs r
  where r.eligible and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix);
  if lo is null or v_limit = 0 then return; end if;
  span := hi - lo + 1;

  if span <= 4 * v_limit then
    -- A small pool: every matching run, shuffled whole (bounded by the id span, so this stays small).
    select coalesce(array_agg(t.id order by t.k), '{}') into picked from (
      select r.id, case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || r.id) end as k
      from public.pool_runs r
      where r.id between lo and hi and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
        and (p_strength_cap is null or r.strength is null or r.strength <= p_strength_cap)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)))
      order by 2 limit v_limit) t;
  else
    -- Rejection sampling over the dense id range: exactly uniform over the matching runs, O(log n) per draw.
    -- A narrow band rejects more draws; the cap (64 per requested run) bounds the time either way.
    while coalesce(array_length(picked, 1), 0) < v_limit and tries < v_limit * 64 loop
      tries := tries + 1;
      u := case when p_seed is null then random() else public.pool_hash01(p_seed || ':' || tries) end;
      cand := lo + least(floor(u * span)::bigint, span - 1);
      continue when cand = any(picked);
      perform 1 from public.pool_runs r
      where r.id = cand and r.eligible
        and (p_set is null or r.set_id = p_set) and (p_patch_prefix is null or r.patch_prefix = p_patch_prefix)
        and (p_exclude_user is null or r.user_id is distinct from p_exclude_user)
        and (p_pool is null or r.pool_id = p_pool)
        and (p_strength_cap is null or r.strength is null or r.strength <= p_strength_cap)
        and (public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) is null
             or ((p_strength_min is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) >= p_strength_min)
             and (p_strength_max is null or public.pool_match_score(r.strength, r.strength_early, r.strength_late, p_early_weight) <= p_strength_max)));
      if found then picked := picked || cand; end if;
    end loop;
  end if;

  return query
  select r.author || '|' || r.hero_id || '|' || r.seed::text, r.author, r.user_id, r.wave_count, r.strength,
         r.strength_early, r.strength_late,
         (select coalesce(jsonb_agg(x.snapshot order by x.wave, x.created_at, x.id), '[]'::jsonb) from public.boards x
          where coalesce(x.author, 'anon') = r.author and x.hero_id = r.hero_id and x.seed = r.seed
            and jsonb_typeof(x.snapshot -> 'minions') = 'array'
            and coalesce(x.origin, 'self') <> 'synthetic')
  from unnest(picked) with ordinality as p(id, ord)
  join public.pool_runs r on r.id = p.id
  order by p.ord;
end $$;

-- ── 3. Re-derive every row under the new rule (idempotent; a no-op on a pool with no empty boards yet) ──────────
select public.pool_runs_rebuild();

commit;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- AETHER: the earned currency, the wallet + ledger, and the Crate Shop (tiered, focusable crates)  (2026-10-18)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-17-versus-open-rooms.sql (the last file before it). THEN
-- deploy the `progression-inventory`, `submit-progression` and `gauntlet-clear` Edge Functions (inventory calls
-- `buy_crate` and the focused `open_crate`; before this file runs those calls fail with "function does not exist", so
-- run the SQL FIRST). THE LAUNCH is a separate, owner-run step: `select public.aether_rollout();` (commented out at the
-- very bottom) backdates the milestone crates and flips the switch. Idempotent: every table and column is `if not
-- exists`, the config seed is `on conflict do nothing` (a retuned economy is never overwritten), every constraint is
-- dropped and re-added, and every function is REPLACED and re-granted, so re-running it is always safe (it never runs
-- the rollout). The same block is appended to schema.sql; keep the two identical. Spec:
-- docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md.
--
-- WHAT SECTIONS 11-14 REPLACE, so this file must come after every file that defines them: `settle_progression`
-- (latest 2026-10-14-versus-progression.sql), `record_gauntlet_clear` (2026-09-29-gauntlet-progress.sql),
-- `progression_result_json` (2026-09-28-achievements.sql) and `progression_profile_json`
-- (2026-09-28-progression-skins.sql). IF ANY OF THOSE FILES IS EVER RE-RUN, RUN THIS FILE AGAIN AFTER IT: each would
-- put back a writer that pays no Aether and grants a crate per level (or a profile without the balance).
--
-- WHAT SECTIONS 1-10 REPLACE. `open_crate` (2026-10-02-ancient-rarity.sql): the 2-argument overload is DROPPED and a
-- 4-argument one with defaults takes its place, so the named 2-argument call an older Edge Function sends
-- (`p_user`, `p_crate_id`) resolves to it. `loot_crates_transition_guard` + `progression_crate_json`
-- (2026-09-29-gauntlet-progress.sql). The 2-argument `progression_crate_pick` and `progression_crate_pool` are left
-- exactly as they are (tests and tools still read them). IF 2026-10-02-ancient-rarity.sql (or the gauntlet, crates,
-- fixed-odds or equal-chance file) IS EVER RE-RUN, RUN THIS FILE AGAIN AFTER IT: the ancient file re-creates the
-- 2-argument `open_crate`, which would make every 2-argument call ambiguous next to the one below.
--
-- WHAT THIS IS (owner decisions 2026-10-18: Aether replaces level-up crates; crates are bought in a shop at a rarity
-- FLOOR, optionally FOCUSED on categories for a fee; "make the narrower focus cost more").
--  - THE SWITCH: `progression_config.aether_enabled`, OFF by default. Until the owner flips it nothing can be bought
--    and nothing about the old crate-per-level behaviour changes.
--  - THE ECONOMY is one server-owned row, `aether_config.economy`, the exact JSON of `DEFAULT_AETHER_ECONOMY`
--    (packages/progression/src/aether.ts). The owner retunes a price with an UPDATE, no client release: the client
--    re-reads it, and a purchase at a price the client showed that no longer holds is refused (`price_changed`), never
--    silently re-priced. Public read.
--  - THE WALLET + LEDGER: `aether_wallets` holds the balance (never below 0); `aether_ledger` records EVERY change with
--    its reason and source, unique per (user, reason, source), so a replayed earn or spend changes nothing and a
--    balance can always be explained. Owner-only read; only security-definer functions write (`aether_apply`).
--  - TIERED CRATES: `loot_crates` gains `floor_rarity` (nothing below it drops), `focus_categories` (null = unfocused)
--    and `price_paid`. A floor-Common, unfocused crate (every crate before the shop) rolls exactly the version-4 roll,
--    draw for draw. Opened crates now record `roll_version = 5`.
--  - `buy_crate`: ONE transaction under the per-user progression lock: the server quotes the price itself, refuses a
--    stale one, charges, creates the crate (`source = 'shop:<request id>'`) and opens it. The request id makes a
--    retried or double-clicked buy return the first result, charged once.
--  - A MILESTONE crate (`source = 'milestone:<level>'`, floor Legendary) may be focused AT OPEN for the Legendary focus
--    fee; no other crate takes a focus at open.
--  - EARNING (sections 11-14, all behind the switch): a Ranked or Versus settlement pays Aether (mirror of
--    aetherForSettlement) and, instead of a crate per level, grants the Welcome Crate on enrollment plus a free
--    floor-Legendary milestone crate at every 10th level; a Gauntlet first clear pays 200 Aether instead of its crate;
--    the result and profile JSON carry the Aether; `aether_rollout()` backdates the milestone crates at launch.
--
-- THE TS COPY is packages/progression/src/crateShop.ts (CRATE_TIER_FLOOR, eligibleForCrate, normalizeFocus,
-- focusFeePercent, quoteCrate, pickTieredCrateReward) and aether.ts (DEFAULT_AETHER_ECONOMY). aether.db.test.ts runs
-- this file on PGlite and checks the SQL pick and quote equal the TS ones draw for draw.

-- ── 1. The Aether switch (off until the owner flips it) ─────────────────────────────────────────────────────
alter table public.progression_config add column if not exists aether_enabled boolean not null default false;

-- ── 2. aether_config: the economy, one row, public read ───────────────────────────────────────────────────
create table if not exists public.aether_config (
  id         int primary key check (id = 1),
  economy    jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.aether_config enable row level security;
drop policy if exists "read aether_config" on public.aether_config;
create policy "read aether_config" on public.aether_config for select using (true);
grant select on public.aether_config to anon, authenticated;
-- The FIRST seed: exactly JSON.stringify(DEFAULT_AETHER_ECONOMY). A re-run never overwrites a retuned row.
-- A RETUNE MUST KEEP THIS EXACT SHAPE: 8 `rankedPlacementBonus` entries, 7 `focusFeePercent` rungs, a price for all five
-- tiers, and every number a non-negative integer. `parseAetherEconomy` rejects anything else WHOLE, and a client that
-- cannot parse the row silently falls back to its bundled default prices, so it would quote numbers this server no
-- longer charges (every purchase then answers `price_changed`). The server's own reads (`aether_economy_int`) refuse a
-- bad value per field: a purchase raises `aether_config_missing`, a settlement pays no Aether for that game.
insert into public.aether_config (id, economy) values (1,
  '{"version":1,"rankedBase":50,"rankedPlacementBonus":[140,80,45,35,25,15,10,0],"versusComplete":25,"versusWin":45,"gauntletFirstClear":200,"cratePrice":{"standard":100,"rare":200,"epic":400,"legendary":600,"ancient":900},"focusFeePercent":[100,60,40,25,15,10,5],"milestoneEvery":10}'::jsonb)
on conflict (id) do nothing;

-- ── 3. aether_wallets: one balance per account, never negative; owner-only read ───────────────────────────
create table if not exists public.aether_wallets (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    int not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
alter table public.aether_wallets enable row level security;
drop policy if exists "read own aether_wallets" on public.aether_wallets;
create policy "read own aether_wallets" on public.aether_wallets for select to authenticated using (auth.uid() = user_id);

-- ── 4. aether_ledger: every change, with its reason and source; owner-only read ───────────────────────────
-- UNIQUE (user, reason, source) is the replay guard: a settlement run id, a shop request id or a crate id can move a
-- balance once per reason, ever.
create table if not exists public.aether_ledger (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  delta         int not null,
  balance_after int not null check (balance_after >= 0),
  reason        text not null check (reason in ('ranked', 'versus', 'gauntlet', 'crate_purchase', 'crate_focus', 'grant')),
  source_id     text not null,
  created_at    timestamptz not null default now(),
  unique (user_id, reason, source_id)
);
alter table public.aether_ledger enable row level security;
drop policy if exists "read own aether_ledger" on public.aether_ledger;
create policy "read own aether_ledger" on public.aether_ledger for select to authenticated using (auth.uid() = user_id);

-- ── 5. aether_apply: THE one writer of a balance. Internal (revoked from every API role, service role too). ─
-- Called only from security-definer functions that ALREADY hold the per-user progression lock. A replayed (user,
-- reason, source) changes nothing and returns the current balance; otherwise the ledger row and the wallet move
-- together. A result below 0 raises `insufficient_aether` and writes nothing (the caller's transaction rolls back).
create or replace function public.aether_apply(p_user uuid, p_delta int, p_reason text, p_source text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance int;
  v_rows    int;
begin
  if p_user is null or p_delta is null or p_reason is null or p_source is null then raise exception 'bad_aether_change'; end if;
  insert into public.aether_wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select balance into v_balance from public.aether_wallets where user_id = p_user for update;
  -- a replay: the source already moved this balance for this reason
  if exists (select 1 from public.aether_ledger where user_id = p_user and reason = p_reason and source_id = p_source) then
    return v_balance;
  end if;
  if v_balance + p_delta < 0 then raise exception 'insufficient_aether'; end if;
  insert into public.aether_ledger (user_id, delta, balance_after, reason, source_id)
    values (p_user, p_delta, v_balance + p_delta, p_reason, p_source)
    on conflict (user_id, reason, source_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return v_balance; end if;
  update public.aether_wallets set balance = v_balance + p_delta, updated_at = now() where user_id = p_user;
  return v_balance + p_delta;
end;
$$;

-- ── 6. loot_crates: a rarity floor, an optional focus, the price paid ─────────────────────────────────────
-- Every existing crate becomes floor Common, unfocused, price null: exactly how it already rolls.
alter table public.loot_crates add column if not exists floor_rarity text not null default 'common';
alter table public.loot_crates drop constraint if exists loot_crates_floor_rarity_check;
alter table public.loot_crates add constraint loot_crates_floor_rarity_check
  check (floor_rarity in ('common', 'rare', 'epic', 'legendary', 'ancient'));
alter table public.loot_crates add column if not exists focus_categories text[];
alter table public.loot_crates add column if not exists price_paid int;
alter table public.loot_crates drop constraint if exists loot_crates_price_paid_check;
alter table public.loot_crates add constraint loot_crates_price_paid_check check (price_paid is null or price_paid >= 0);

-- A crate goes sealed -> opened ONCE and is then history (even for the service role). `source`, the FLOOR and the
-- PRICE PAID are identity too. The FOCUS may change only in the sealed -> opened update (a milestone crate is focused
-- as it opens).
create or replace function public.loot_crates_transition_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.state = 'opened' then raise exception 'crate_already_opened'; end if;
  if new.crate_id is distinct from old.crate_id or new.user_id is distinct from old.user_id
     or new.earned_level is distinct from old.earned_level or new.earned_at is distinct from old.earned_at
     or new.source is distinct from old.source or new.floor_rarity is distinct from old.floor_rarity
     or new.price_paid is distinct from old.price_paid then
    raise exception 'crate_identity_is_immutable';
  end if;
  if new.focus_categories is distinct from old.focus_categories and new.state is distinct from 'opened' then
    raise exception 'crate_identity_is_immutable';
  end if;
  return new;
end;
$$;

-- MUST match `CrateRow` in packages/progression/src/cosmetics.ts key for key (`source` is null for a level crate;
-- `focus` is null for an unfocused crate; `parseCrate` drops a null focus and a Common floor reads as Standard).
create or replace function public.progression_crate_json(c public.loot_crates)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'crateId', c.crate_id, 'earnedLevel', c.earned_level, 'state', c.state,
    'rewardId', c.reward_cosmetic_id, 'earnedAt', c.earned_at, 'openedAt', c.opened_at,
    'source', c.source, 'floor', c.floor_rarity, 'focus', to_jsonb(c.focus_categories)
  );
$$;

-- ── 7. The tiered pool: what a crate of this floor (and focus) can still give ─────────────────────────────
-- Today's pool filter (active, not admin_off, live category with weight, crate-sourced, unowned) kept to rarities AT
-- OR ABOVE the floor and, when a focus is named, to those categories. Mirror of eligibleForCrate. A null floor is
-- Common; an unknown floor matches nothing. A null or empty focus is no focus.
create or replace function public.progression_tiered_crate_pool(p_user uuid, p_floor text, p_focus text[])
returns table (pool_cosmetic_id text, pool_rarity text)
language plpgsql
stable
set search_path = public
as $$
declare
  v_rarities constant text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];
begin
  return query
    select c.cosmetic_id, c.rarity
    from public.cosmetic_catalog c
    join public.cosmetic_categories k on k.category = c.category
    where c.active and not c.admin_off and k.enabled and not k.admin_off
      and c.acquisition_source = 'crate' and k.weight > 0
      and not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c.cosmetic_id)
      and array_position(v_rarities, c.rarity) >= array_position(v_rarities, coalesce(p_floor, 'common'))
      and (p_focus is null or cardinality(p_focus) = 0 or c.category = any(p_focus))
    order by c.cosmetic_id collate "C";
end;
$$;

-- ── 8. The tiered pick: one draw in [0, 1] → a rarity at or above the floor → an EQUAL-chance item of it ──
-- Mirror of pickTieredCrateReward. The draw is scaled by the floor's odds total (the published odds restricted to the
-- rarities at or above the floor, renormalized); a rarity with nothing left falls to the nearest one AT OR ABOVE THE
-- FLOOR (ties toward the more common), never below it. Null only when nothing at or above the floor is eligible. With
-- floor Common and no focus it is `progression_crate_pick` draw for draw. Pure given (pool, draw).
create or replace function public.progression_tiered_crate_pick(p_user uuid, p_draw double precision, p_floor text, p_focus text[])
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  -- THE PUBLISHED ODDS, percent (mirror of CRATE_RARITY_ODDS in packages/progression/src/cosmetics.ts)
  c_odds_common    constant int := 35;
  c_odds_rare      constant int := 31;
  c_odds_epic      constant int := 22;
  c_odds_legendary constant int := 9;
  c_odds_ancient   constant int := 3;
  v_rarities text[] := array['common', 'rare', 'epic', 'legendary', 'ancient'];
  v_odds     int[];
  v_floor    int;
  v_sum      int := 0;
  v_x        double precision;
  v_lo       int := 0;
  v_i        int;
  v_rolled   int := 5;
  v_frac     double precision := 1;
  v_r        text;
  v_n        bigint;
  v_idx      bigint;
  v_pick     text;
begin
  v_odds := array[c_odds_common, c_odds_rare, c_odds_epic, c_odds_legendary, c_odds_ancient];
  v_floor := array_position(v_rarities, coalesce(p_floor, 'common'));
  if v_floor is null then return null; end if;
  for v_i in v_floor..5 loop v_sum := v_sum + v_odds[v_i]; end loop;
  -- the rarity: the first band (in rarity order, from the floor up) the scaled draw falls under; where inside it, v_frac
  v_x := least(greatest(coalesce(p_draw, 0), 0), 1) * v_sum;
  for v_i in v_floor..5 loop
    if v_x < v_lo + v_odds[v_i] then
      v_rolled := v_i;
      v_frac := (v_x - v_lo) / v_odds[v_i];
      exit;
    end if;
    v_lo := v_lo + v_odds[v_i];
  end loop;
  -- the rolled rarity first, then the nearest rarity at or above the floor with something left (ties toward the more common)
  for v_r in select v_rarities[g] from generate_series(v_floor, 5) as g order by abs(g - v_rolled), g loop
    select count(*) into v_n from public.progression_tiered_crate_pool(p_user, p_floor, p_focus) p where p.pool_rarity = v_r;
    if v_n > 0 then
      -- every item of the rarity equally likely: the draw's place in the band indexes the items in id order
      v_idx := least(v_n - 1, greatest(0, floor(v_frac * v_n)::bigint));
      select p.pool_cosmetic_id into v_pick
        from public.progression_tiered_crate_pool(p_user, p_floor, p_focus) p
        where p.pool_rarity = v_r
        order by p.pool_cosmetic_id collate "C"
        offset v_idx limit 1;
      return v_pick;
    end if;
  end loop;
  return null;
end;
$$;

-- ── 9. aether_quote: what a crate costs this player right now (mirror of quoteCrate) ──────────────────────
-- {tier, floor, focus, crate, fee, total, remaining}, priced from `aether_config`. A milestone crate is free, its floor
-- Legendary whatever tier is passed, and only the focus fee is charged, at the Legendary price. The focus is made
-- canonical (normalizeFocus): de-duplicated, sorted `collate "C"`, null when it covers every AVAILABLE category (that is
-- no focus, and costs nothing). Raises `bad_tier`, `bad_focus` (it names a category with nothing left at this floor,
-- or an unknown one) or `sold_out` (nothing left to give).
create or replace function public.aether_quote(p_user uuid, p_tier text, p_focus text[], p_milestone boolean)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_milestone boolean := coalesce(p_milestone, false);
  v_tier      text;
  v_floor     text;
  v_eco       jsonb;
  v_price     int;
  v_available text[];
  v_focus     text[];
  v_remaining int;
  v_pct       int := 0;
  v_fee       int := 0;
  v_crate     int;
begin
  v_tier := case when v_milestone then 'legendary' else p_tier end;
  if v_tier is null or v_tier not in ('standard', 'rare', 'epic', 'legendary', 'ancient') then raise exception 'bad_tier'; end if;
  v_floor := case v_tier when 'standard' then 'common' else v_tier end;   -- mirror of CRATE_TIER_FLOOR

  select economy into v_eco from public.aether_config where id = 1;
  -- every economy number through the defensive read (section 11): a missing, fractional or garbled price is a refusal,
  -- never a cast error and never a guess (final review 2026-10-19)
  v_price := public.aether_economy_int(v_eco, array['cratePrice', v_tier]);
  if v_price is null then raise exception 'aether_config_missing'; end if;

  -- the categories a player may focus at this floor: those with something still eligible
  select coalesce(array_agg(distinct c.category), '{}') into v_available
    from public.progression_tiered_crate_pool(p_user, v_floor, null) p
    join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id;

  -- normalizeFocus
  if p_focus is not null and cardinality(p_focus) > 0 then
    if exists (select 1 from unnest(p_focus) f where f is null or not (f = any(v_available))) then raise exception 'bad_focus'; end if;
    select array_agg(f order by f collate "C") into v_focus from (select distinct f from unnest(p_focus) f) d;
    if cardinality(v_focus) >= cardinality(v_available) then v_focus := null; end if;
  end if;

  select count(*) into v_remaining from public.progression_tiered_crate_pool(p_user, v_floor, v_focus);
  if v_remaining = 0 then raise exception 'sold_out'; end if;

  -- focusFeePercent: 1..7 ticked read the ladder, 8 or more (but fewer than all available) the last rung
  -- (an unreadable ladder or rung is `aether_config_missing`: a focused crate is never sold at a guessed fee)
  if v_focus is not null then
    if jsonb_typeof(v_eco -> 'focusFeePercent') is distinct from 'array' or jsonb_array_length(v_eco -> 'focusFeePercent') = 0 then
      raise exception 'aether_config_missing';
    end if;
    v_pct := public.aether_economy_int(v_eco,
      array['focusFeePercent', (least(cardinality(v_focus), jsonb_array_length(v_eco -> 'focusFeePercent')) - 1)::text]);
    if v_pct is null then raise exception 'aether_config_missing'; end if;
    v_fee := (v_price * v_pct) / 100;   -- integer division: Math.floor in the TS
  end if;
  v_crate := case when v_milestone then 0 else v_price end;
  return jsonb_build_object('tier', v_tier, 'floor', v_floor, 'focus', to_jsonb(v_focus), 'crate', v_crate,
    'fee', v_fee, 'total', v_crate + v_fee, 'remaining', v_remaining);
end;
$$;

-- ── 10. open_crate + buy_crate: THE opening and THE purchase. Service role only. ───────────────────────────
-- open_crate is today's transaction (2026-10-02-ancient-rarity.sql) with three additions: the roll uses the crate's
-- floor and focus through the tiered pick (`roll_version = 5`); a MILESTONE crate may be focused at open, charged the
-- Legendary focus fee as `crate_focus` (source = the crate id) after a `price_changed` check against the fee the client
-- showed; and the result carries the Aether balance. Per-user advisory lock (the same one the settlement and buy_crate
-- take, so two openings never pick the same item and a charge never races a credit) → the crate row FOR UPDATE (an
-- opened crate returns its committed reward as `already_opened`, never charged twice) → the floor's pool empty answers
-- `pool_exhausted`, sealed and UNCHARGED → the focus fee → ONE draw → ownership insert (unique key = the final guard)
-- + the crate marked opened, together.
drop function if exists public.open_crate(uuid, uuid);
create or replace function public.open_crate(p_user uuid, p_crate_id uuid, p_focus text[] default null, p_expected_fee int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_roll_version constant int := 5;
  v_crate   public.loot_crates%rowtype;
  v_enabled boolean;
  v_aether  boolean;
  v_quote   jsonb;
  v_focus   text[];
  v_fee     int;
  v_pick    text;
  v_rows    int;
  v_sealed  int;
begin
  if p_user is null or p_crate_id is null then raise exception 'bad_crate_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  select * into v_crate from public.loot_crates where crate_id = p_crate_id and user_id = p_user for update;
  if not found then raise exception 'crate_not_found'; end if;

  if v_crate.state = 'opened' then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'already_opened', 'crate', public.progression_crate_json(v_crate),
      'rewardId', v_crate.reward_cosmetic_id, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user),
      'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p_user), 0));
  end if;

  select crates_enabled, aether_enabled into v_enabled, v_aether from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'crates_disabled'; end if;

  -- a focus at open is a milestone crate's alone, and it spends Aether, so it needs the Aether switch too
  if p_focus is not null then
    if v_crate.source is null or v_crate.source not like 'milestone:%' then raise exception 'focus_not_allowed'; end if;
    if not coalesce(v_aether, false) then raise exception 'aether_disabled'; end if;
    if p_expected_fee is null or p_expected_fee < 0 then raise exception 'bad_price'; end if;
  end if;

  if not exists (select 1 from public.progression_tiered_crate_pool(p_user, v_crate.floor_rarity, v_crate.focus_categories)) then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'pool_exhausted', 'crate', public.progression_crate_json(v_crate),
      'rewardId', null, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user),
      'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p_user), 0));
  end if;

  v_focus := v_crate.focus_categories;
  if p_focus is not null then
    v_quote := public.aether_quote(p_user, 'legendary', p_focus, true);
    v_fee := (v_quote ->> 'total')::int;
    if v_fee <> p_expected_fee then raise exception 'price_changed'; end if;
    v_focus := case when jsonb_typeof(v_quote -> 'focus') = 'array'
      then array(select jsonb_array_elements_text(v_quote -> 'focus')) end;
    if v_fee > 0 then perform public.aether_apply(p_user, -v_fee, 'crate_focus', p_crate_id::text); end if;
  end if;

  -- ONE draw: a rarity at or above the floor at the renormalized odds, then an item of it (mirror of pickTieredCrateReward).
  v_pick := public.progression_tiered_crate_pick(p_user, random(), v_crate.floor_rarity, v_focus);
  if v_pick is null then raise exception 'duplicate_reward'; end if;

  insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
    values (p_user, v_pick, 'crate', p_crate_id::text)
    on conflict (user_id, cosmetic_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'duplicate_reward'; end if;

  update public.loot_crates set state = 'opened', reward_cosmetic_id = v_pick, roll_version = c_roll_version, opened_at = now(),
      focus_categories = v_focus
    where crate_id = p_crate_id and state = 'sealed'
    returning * into v_crate;
  if not found then raise exception 'crate_not_found'; end if;

  -- A new title is worn at once only when the player wears none; the revision moves so mirrors adopt the change.
  update public.profiles set
    equipped_title_id = coalesce(equipped_title_id,
      (select c.cosmetic_id from public.cosmetic_catalog c where c.cosmetic_id = v_pick and c.category = 'title')),
    progression_revision = progression_revision + 1,
    updated_at = now()
  where user_id = p_user;

  select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
  return jsonb_build_object('status', 'opened', 'crate', public.progression_crate_json(v_crate),
    'rewardId', v_pick, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user),
    'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p_user), 0));
end;
$$;

-- buy_crate: validate → the per-user lock → a crate already bought with this request id answers `already_opened` (no
-- charge; `quote` null, the price it was bought at is the crate's `price_paid`) → the switches → the server's own quote,
-- refused as `price_changed` when it is not the total the client showed → the charge (`crate_purchase`, source = the
-- request id) → the crate (no level, `source = 'shop:<request id>'`, its floor, canonical focus and price) → opened
-- through open_crate above (the same lock, re-entrant; the same one draw). All one transaction: a refusal anywhere
-- writes nothing.
create or replace function public.buy_crate(p_user uuid, p_tier text, p_focus text[], p_expected_total int, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source  text;
  v_crate   public.loot_crates%rowtype;
  v_enabled boolean;
  v_aether  boolean;
  v_quote   jsonb;
  v_total   int;
  v_focus   text[];
  v_open    jsonb;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if p_request_id is null then raise exception 'bad_request_id'; end if;
  if p_tier is null or p_tier not in ('standard', 'rare', 'epic', 'legendary', 'ancient') then raise exception 'bad_tier'; end if;
  if p_expected_total is null or p_expected_total < 0 then raise exception 'bad_price'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  v_source := 'shop:' || p_request_id::text;
  select * into v_crate from public.loot_crates where user_id = p_user and source = v_source;
  if found then
    return public.open_crate(p_user, v_crate.crate_id) || jsonb_build_object('status', 'already_opened', 'quote', null);
  end if;

  select crates_enabled, aether_enabled into v_enabled, v_aether from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'crates_disabled'; end if;
  if not coalesce(v_aether, false) then raise exception 'aether_disabled'; end if;

  v_quote := public.aether_quote(p_user, p_tier, p_focus, false);
  v_total := (v_quote ->> 'total')::int;
  if v_total <> p_expected_total then raise exception 'price_changed'; end if;
  v_focus := case when jsonb_typeof(v_quote -> 'focus') = 'array'
    then array(select jsonb_array_elements_text(v_quote -> 'focus')) end;

  perform public.aether_apply(p_user, -v_total, 'crate_purchase', p_request_id::text);

  insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity, focus_categories, price_paid)
    values (p_user, null, v_source, v_source, v_quote ->> 'floor', v_focus, v_total)
    returning * into v_crate;

  v_open := public.open_crate(p_user, v_crate.crate_id);
  -- the quote promised something to give and we hold the lock, so anything but `opened` is a broken invariant: refuse it all
  if v_open ->> 'status' is distinct from 'opened' then raise exception 'duplicate_reward'; end if;
  return v_open || jsonb_build_object('quote', v_quote);
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────────────────
-- The two WRITERS (`buy_crate`, `open_crate`) are the service role's alone: the Edge Function calls only them. Every
-- helper is INTERNAL, revoked from the service role too: Supabase's default privileges grant EXECUTE on each new
-- function in `public` to anon, authenticated AND service_role, so a revoke that leaves service_role out leaves it
-- callable with the service key (precedent: guide_bookmark_counted in 2026-10-13-guides-community.sql). The writers are
-- security definer and reach the helpers as the owner. `aether_apply` above all: callable, it would mint Aether.
-- (The quote is internal too: the client prices from the TS `quoteCrate` and the server re-quotes inside `buy_crate`.)
revoke all on function public.aether_apply(uuid, int, text, text) from public, anon, authenticated, service_role;
revoke all on function public.progression_tiered_crate_pool(uuid, text, text[]) from public, anon, authenticated, service_role;
revoke all on function public.progression_tiered_crate_pick(uuid, double precision, text, text[]) from public, anon, authenticated, service_role;
revoke all on function public.aether_quote(uuid, text, text[], boolean) from public, anon, authenticated, service_role;
revoke all on function public.progression_crate_json(public.loot_crates) from public, anon, authenticated;
grant execute on function public.progression_crate_json(public.loot_crates) to service_role;
revoke all on function public.open_crate(uuid, uuid, text[], int) from public, anon, authenticated;
grant execute on function public.open_crate(uuid, uuid, text[], int) to service_role;
revoke all on function public.buy_crate(uuid, text, text[], int, uuid) from public, anon, authenticated;
grant execute on function public.buy_crate(uuid, text, text[], int, uuid) to service_role;

-- ── END OF SECTIONS 1-10 (switch, config, wallet, ledger, aether_apply, crate columns, tiered pool + pick, quote,
--    open_crate + buy_crate). Sections 11-14 (the settlement's Aether, Gauntlet Aether, milestone crates, the profile
--    JSON and the rollout) follow below. ──────────────────────────────────────────────────────────────────────────

-- ── 11. progression_results remembers the Aether a settlement paid; the result JSON carries it ────────────
-- Four columns, written by `settle_progression` below. `aether_on` records whether the switch was ON when the game
-- settled: OFF (every row before this file, and every row while the switch is off) the result's `aether` is null and the
-- crate-per-level rules applied; ON it is the breakdown (0/0/0 for Practice and Tutorial) and the crates are the
-- Welcome Crate and the milestone crates only.
alter table public.progression_results add column if not exists aether_base      int not null default 0;
alter table public.progression_results add column if not exists aether_placement int not null default 0;
alter table public.progression_results add column if not exists aether_total     int not null default 0;
alter table public.progression_results add column if not exists aether_on        boolean not null default false;

-- MUST match `ProgressionResult` in packages/progression/src/rules.ts key for key. The 2026-09-28-achievements.sql body
-- plus `aether` (null when the switch was off) and `aetherBalance` (the account's balance as this answer is built; null
-- exactly when `aether` is). Reading the wallet makes it STABLE (it was IMMUTABLE): a deduped replay shows today's
-- balance beside today's profile, the same way it already shows today's profile.
create or replace function public.progression_result_json(r public.progression_results)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'runId', r.run_id, 'mode', r.mode, 'rulesVersion', r.rules_version,
    'placement', r.placement, 'comeback', r.comeback,
    'xp', jsonb_build_object('base', r.base_xp, 'topFour', r.top_four_xp, 'firstPlace', r.first_place_xp, 'comeback', r.comeback_xp, 'total', r.total_xp),
    'before', jsonb_build_object('lifetimeXp', r.xp_before, 'level', r.level_before),
    'after',  jsonb_build_object('lifetimeXp', r.xp_after,  'level', r.level_after),
    'unlockedTitles', to_jsonb(r.unlocked_title_ids),
    'cratesAwarded', r.crates_awarded,
    'crateIds', to_jsonb(r.crate_ids),
    'achievements', to_jsonb(r.achievement_ids),
    'achievementXp', r.achievement_xp,
    'aether', case when r.aether_on then jsonb_build_object('base', r.aether_base, 'placement', r.aether_placement, 'total', r.aether_total) end,
    'aetherBalance', case when r.aether_on then coalesce((select w.balance from public.aether_wallets w where w.user_id = r.user_id), 0) end,
    'revisionAfter', r.revision_after,
    'settledAt', r.settled_at
  );
$$;
revoke all on function public.progression_result_json(public.progression_results) from public, anon, authenticated;
grant execute on function public.progression_result_json(public.progression_results) to service_role;

-- THE DEFENSIVE ECONOMY READ, used by every writer below: the integer at `p_path` in the economy document, or NULL when
-- it is unreadable (no row, a missing key, not a JSON number, fractional, below 0 or absurdly large), never an error.
-- `parseAetherEconomy` accepts exactly the same values (non-negative integers). A bad retune must never block a game:
-- the settlement and the Gauntlet treat NULL as "Aether off for this one" (XP and today's crates intact); only the
-- hand-run `aether_rollout` refuses it (`aether_config_invalid`). The nested CASE fixes the evaluation order, so a
-- string is never cast. Internal: revoked from every API role, the service role too (precedent: section 10).
create or replace function public.aether_economy_int(p_eco jsonb, p_path text[])
returns int
language sql
immutable
as $$
  select case when jsonb_typeof(p_eco #> p_path) = 'number' then
    case when (p_eco #>> p_path)::numeric between 0 and 1000000000 and (p_eco #>> p_path)::numeric = trunc((p_eco #>> p_path)::numeric)
      then (p_eco #>> p_path)::numeric::int end
  end;
$$;
revoke all on function public.aether_economy_int(jsonb, text[]) from public, anon, authenticated, service_role;

-- ── 12. settle_progression: Aether for Ranked and Versus; milestone crates replace level crates ──────────────
-- THE FULL 2026-10-14-versus-progression.sql WRITER, RE-CREATED. Every line is byte-for-byte that writer (its comments
-- included, so `sqlParity.test.ts` reads the same constants out of it) EXCEPT these additions, all gated on
-- `progression_config.aether_enabled`; with the switch OFF the function behaves exactly as before, crate for crate:
--  - the `-- aether` declarations (no new constants: every number is the server-owned `aether_config` economy, read
--    once into `v_eco`, each value through `aether_economy_int`);
--  - step 7a: the Aether this game pays (mirror of aetherForSettlement), credited through `aether_apply` with reason
--    = the mode and source = the run id, so the ledger's unique key backs the result-ledger dedupe. An UNREADABLE
--    economy (the row missing, a value this game needs not a valid integer, `milestoneEvery` below 1) settles THIS game
--    exactly as with the switch off (today's level crates, `aether` null, XP intact) and never raises;
--  - step 9b: the Welcome Crate on enrollment (kept, owner 2026-10-18) plus ONE crate per milestone level at or below
--    the new level (`milestoneLevelsThrough`; every one, not just the newly crossed, so a missing one self-heals), and
--    no other level crate. The switch-off branch is the unchanged per-level insert;
--  - step 10: the result row writes the four Aether columns.
-- A MILESTONE CRATE IS ALWAYS FLOOR LEGENDARY: `open_crate` quotes a focus at open at the Legendary fee and rolls the
-- crate's own floor, so a milestone crate on any other floor would be priced and rolled inconsistently. The constraint
-- pins it for every writer (this one, `aether_rollout` below, and anything later).
alter table public.loot_crates drop constraint if exists loot_crates_milestone_is_legendary;
alter table public.loot_crates add constraint loot_crates_milestone_is_legendary
  check (source is null or source not like 'milestone:%' or floor_rarity = 'legendary');
create or replace function public.settle_progression(
  p_user uuid, p_mode text, p_run_id text, p_source_id bigint default null, p_comeback boolean default false,
  p_rules_version int default null, p_facts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of XP_RULES / CURVE in packages/progression/src/rules.ts — change all copies together)
  c_rules             constant int := 1;
  c_curve             constant int := 1;
  c_complete          constant int := 100;
  c_top_four          constant int := 60;
  c_first_place       constant int := 90;
  c_comeback          constant int := 25;
  c_comeback_streak   constant int := 4;
  c_practice_percent  constant int := 60;
  c_practice_flat     constant int := 60;
  c_tutorial          constant int := 250;
  c_tutorial_course   constant text := 'learn-ascent';
  c_tutorial_version  constant int := 1;
  c_alpha_title       constant text := 'alpha_tester';
  c_alpha_level       constant int := 2;
  c_rate_max          constant int := 30;
  c_rate_window       constant interval := interval '10 minutes';
  -- ACHIEVEMENTS (mirror of packages/progression/src/achievements.ts)
  c_meta_metric       constant text := 'achievementsCompleted';
  c_brutal_strength   constant int := 70;
  c_ascendant_div     constant int := 15;
  c_metric_max        constant bigint := 1000000000;
  -- HERO TITLES (mirror of heroTitleId / heroMasterTitleId in packages/progression/src/cosmetics.ts)
  c_hero_title_prefix constant text := 'title_hero_';
  c_master_suffix     constant text := '_master';
  -- VERSUS (owner 2026-10-14: "versus can complete achievements and grant XP but no rank progress")
  c_versus_win        constant int := 60;
  c_versus_min_rounds constant int := 1;

  prof        public.profiles%rowtype;
  prev        public.progression_results%rowtype;
  v_epoch     timestamptz;
  v_recent    int;
  v_source_at timestamptz;
  v_source    text := null;
  v_placement int := null;
  v_comeback  boolean := false;
  v_seed      bigint;
  v_cfg       jsonb;
  v_record    jsonb;
  v_wins      int;
  v_losses    int;
  r_top int := 0; r_first int := 0; r_come int := 0; v_ranked_total int;
  v_base int := 0; v_top int := 0; v_first int := 0; v_come int := 0; v_total int;
  v_xp0 bigint; v_xp1 bigint; v_l0 int; v_l1 int;
  v_unlocked  text[] := '{}';
  v_equipped  text;
  v_rows      int;
  v_facts_ver int := null;
  v_enrolling boolean;
  v_crate_ids uuid[] := '{}';
  -- achievements
  v_ach_epoch  timestamptz;
  v_promoted   boolean := false;
  v_div_before int := null;
  v_demo_game  boolean := false;
  v_demoted    boolean := false;
  v_strength   int := null;
  v_hero       text := null;
  v_set        text := null;
  v_run_ok     boolean := false;
  v_metrics    jsonb := '{}';
  v_first_streak int := 0;
  v_top_streak int := 0;
  v_heroes_played int := 0;
  v_heroes_won int := 0;
  v_done_count int := 0;
  d            public.achievement_catalog%rowtype;
  v_val        bigint;
  v_old        bigint;
  v_done       boolean;
  v_new        bigint;
  v_ach_ids    text[] := '{}';
  v_ach_xp     int := 0;
  v_hero_title text := null;
  -- versus
  v_match      public.versus_matches%rowtype;
  v_vs_seat    text := null;
  v_ach_place  int := null;
  -- aether (2026-10-18): no constants; the numbers are the aether_config economy, read once
  v_aether     boolean := false;
  v_eco        jsonb;
  v_ae_base    int := 0;
  v_ae_place   int := 0;
  v_ae_every   int;
begin
  -- 1. validate
  if p_mode is null or p_mode not in ('ranked', 'practice', 'tutorial', 'versus') then raise exception 'bad_mode'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. serialize per user (every progression entry point takes the advisory lock first), then lock the row
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.progression_results where user_id = p_user and run_id = p_run_id and mode = p_mode;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
  end if;

  -- 4. the switch: nothing is awarded before the owner sets the epoch
  select epoch, achievements_epoch into v_epoch, v_ach_epoch from public.progression_config where id = 1;
  if v_epoch is null then raise exception 'progression_disabled'; end if;

  -- 5. rate limit (technical only: a refused request is retried later and keeps its XP)
  select count(*) into v_recent from public.progression_results
    where user_id = p_user and settled_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 6. the SOURCE row: the placement comes from here, never from the request
  if p_mode = 'ranked' then
    select rr.placement, rr.seed, rr.created_at, rr.promoted, rr.division_before, rr.was_demotion_game, rr.demoted, rr.lobby_strength
      into v_placement, v_seed, v_source_at, v_promoted, v_div_before, v_demo_game, v_demoted, v_strength
      from public.rank_results rr where rr.user_id = p_user and rr.run_id = p_run_id;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_run_id;
    v_comeback := coalesce(p_comeback, false);
    if v_comeback and v_seed is not null then
      select h.wins, case when (h.entry->>'losses') ~ '^[0-9]+$' then (h.entry->>'losses')::int end
        into v_wins, v_losses
        from public.run_history h
        where h.user_id = p_user and h.mode = 'lobby' and h.entry->>'seed' = v_seed::text
        order by h.created_at desc limit 1;
      if found and (coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1) then v_comeback := false; end if;
    end if;
  elsif p_mode = 'practice' then
    if p_source_id is null or p_source_id < 1 then raise exception 'bad_source'; end if;
    if p_run_id is distinct from ('practice:' || p_source_id::text) then raise exception 'bad_run_id'; end if;
    select pg.placement, pg.config, pg.record, pg.created_at, pg.hero_id into v_placement, v_cfg, v_record, v_source_at, v_hero
      from public.practice_games pg where pg.id = p_source_id and pg.user_id = p_user;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_source_id::text;
    -- No meaningful placement: an Unlimited Health game plays to the curtain and is never eliminated (and a row
    -- with no options recorded is treated the same way). It earns the flat XP, no placement or comeback bonus.
    if v_cfg is null or coalesce(v_cfg->>'health', 'unlimited') <> 'normal'
       or v_placement is null or v_placement < 1 or v_placement > 8 then
      v_placement := null;
    end if;
    v_comeback := coalesce(p_comeback, false) and v_placement is not null;
    if v_comeback and v_record is not null then
      v_wins := case when (v_record->>'wins') ~ '^[0-9]+$' then (v_record->>'wins')::int end;
      v_losses := case when (v_record->>'losses') ~ '^[0-9]+$' then (v_record->>'losses')::int end;
      if coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1 then v_comeback := false; end if;
    end if;
  elsif p_mode = 'versus' then
    -- VERSUS: the source is the server-owned match row. The caller must have held a PLAYER seat, the match must be
    -- over and must have fought at least one round. Placement = 1 for the winner, 2 for the loser, null when nobody
    -- won (abandoned). It drives XP only: rank_results, rating and MMR are never read or written here.
    if p_run_id !~ '^versus:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_run_id'; end if;
    select * into v_match from public.versus_matches m where m.id = substring(p_run_id from 8)::uuid;
    if not found then raise exception 'source_not_found'; end if;
    v_vs_seat := case when v_match.p1_user = p_user then 'p1' when v_match.p2_user = p_user then 'p2' end;
    if v_vs_seat is null then raise exception 'source_not_found'; end if;
    if v_match.phase <> 'complete' or v_match.completed_at is null then raise exception 'not_terminal'; end if;
    if not exists (select 1 from public.versus_rounds vr where vr.match_id = v_match.id and vr.round >= c_versus_min_rounds) then raise exception 'not_terminal'; end if;
    v_source_at := v_match.completed_at;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := v_match.id::text;
    v_placement := case when v_match.winner_seat is null then null when v_match.winner_seat = v_vs_seat then 1 else 2 end;
    v_comeback := false;
    v_hero := case when v_vs_seat = 'p1' then v_match.p1_hero else v_match.p2_hero end;
  else
    -- tutorial: one claim per account per course version (the ledger check above already caught a repeat)
    if p_run_id is distinct from (c_tutorial_course || ':v' || c_tutorial_version::text) then raise exception 'bad_run_id'; end if;
    insert into public.tutorial_progression_claims (user_id, course_id, course_version, xp_awarded)
      values (p_user, c_tutorial_course, c_tutorial_version, c_tutorial)
      on conflict (user_id, course_id, course_version) do nothing;
    v_source := c_tutorial_course || ':' || c_tutorial_version::text;
  end if;

  -- 7. XP (mirror of xpForSettlement)
  if p_mode = 'tutorial' then
    v_base := c_tutorial;
  elsif p_mode = 'versus' then
    -- VERSUS: the completion XP, plus the win bonus for the winner (stored in the first-place column).
    v_base := c_complete;
    v_first := case when v_placement = 1 then c_versus_win else 0 end;
  elsif p_mode = 'practice' and v_placement is null then
    v_base := c_practice_flat;
  else
    r_top   := case when v_placement <= 4 then c_top_four else 0 end;
    r_first := case when v_placement = 1 then c_first_place else 0 end;
    r_come  := case when v_comeback then c_comeback else 0 end;
    if p_mode = 'ranked' then
      v_base := c_complete; v_top := r_top; v_first := r_first; v_come := r_come;
    else
      -- Practice: 60% of the equivalent ranked XP, summed then rounded; the remainder lands on the base.
      v_ranked_total := c_complete + r_top + r_first + r_come;
      v_top   := (r_top   * c_practice_percent + 50) / 100;
      v_first := (r_first * c_practice_percent + 50) / 100;
      v_come  := (r_come  * c_practice_percent + 50) / 100;
      v_base  := (v_ranked_total * c_practice_percent + 50) / 100 - v_top - v_first - v_come;
    end if;
  end if;
  v_total := v_base + v_top + v_first + v_come;

  -- 7a. AETHER (owner 2026-10-18: Aether replaces level-up crates; mirror of aetherForSettlement in
  -- packages/progression/src/aether.ts). Only with the switch on. Ranked: the base + the placement bonus, win or lose,
  -- for a VALID placement (none = the ladder never accepted the game: 0). Versus: the completion pay for ANY finished
  -- match (won, lost or abandoned with no winner) + the win bonus at placement 1. Practice and Tutorial: 0; no
  -- comeback bonus. Credited with reason = the mode, source = the run id, only when the total is above 0. An
  -- UNREADABLE economy (no row; a value this game needs, or `milestoneEvery`, not a valid integer; `milestoneEvery`
  -- below 1) turns Aether off FOR THIS SETTLEMENT: today's level crates, `aether` null, the XP untouched. A bad retune
  -- must never block a game (a raise here would fail every settlement until the config is fixed).
  select aether_enabled into v_aether from public.progression_config where id = 1;
  v_aether := coalesce(v_aether, false);
  if v_aether then
    select economy into v_eco from public.aether_config where id = 1;
    v_ae_every := public.aether_economy_int(v_eco, array['milestoneEvery']);
    if p_mode = 'ranked' and v_placement between 1 and 8 then
      v_ae_base  := public.aether_economy_int(v_eco, array['rankedBase']);
      v_ae_place := public.aether_economy_int(v_eco, array['rankedPlacementBonus', (v_placement - 1)::text]);
    elsif p_mode = 'versus' then
      v_ae_base  := public.aether_economy_int(v_eco, array['versusComplete']);
      -- read (and so checked) for both players, paid to the winner only
      v_ae_place := public.aether_economy_int(v_eco, array['versusWin']);
      if v_ae_place is not null and v_placement is distinct from 1 then v_ae_place := 0; end if;
    end if;
    if v_ae_every is null or v_ae_every < 1 or v_ae_base is null or v_ae_place is null then
      v_aether := false; v_ae_base := 0; v_ae_place := 0;
    elsif v_ae_base + v_ae_place > 0 then
      perform public.aether_apply(p_user, v_ae_base + v_ae_place, p_mode, p_run_id);
    end if;
  end if;

  if p_facts is not null and jsonb_typeof(p_facts) = 'object' and (p_facts->>'version') ~ '^[0-9]+$' then
    v_facts_ver := (p_facts->>'version')::int;
  end if;

  -- 7b. ACHIEVEMENTS (mirror of evaluateAchievements in packages/progression/src/achievements.ts). Only once the
  -- owner has set the achievements epoch, and only for a game whose source row is not older than it.
  if v_ach_epoch is not null and coalesce(v_source_at, now()) >= v_ach_epoch then
    -- The `any` gate: Ranked, or a standard Practice (Normal Health, so a real placement, AND a turn timer).
    v_run_ok := p_mode = 'ranked' or p_mode = 'versus'
      or (p_mode = 'practice' and v_placement is not null and coalesce(v_cfg->>'timeMult', '') ~ '^[1-9][0-9]*$');
    if p_mode = 'ranked' then v_hero := p_facts->>'heroId'; end if;
    -- VERSUS: a 1v1 "1st" is not a lobby finish, so placement-gated achievements (Top 4, 1st) never count it.
    v_ach_place := case when p_mode = 'versus' then null else v_placement end;
    if v_hero is not null and v_hero !~ '^[A-Za-z0-9_.-]{1,64}$' then v_hero := null; end if;
    v_set := p_facts->>'setId';
    if v_set is not null and v_set !~ '^[A-Za-z0-9_.-]{1,32}$' then v_set := null; end if;

    -- Distinct heroes: this game counts toward its hero when it is an eligible game.
    if v_run_ok and v_hero is not null then
      insert into public.achievement_hero_stats (user_id, hero_id, games, firsts)
        values (p_user, v_hero, 1, case when p_mode = 'ranked' and v_placement = 1 then 1 else 0 end)
        on conflict (user_id, hero_id) do update set
          games = public.achievement_hero_stats.games + 1,
          firsts = public.achievement_hero_stats.firsts + excluded.firsts,
          updated_at = now();
    end if;
    select count(*) filter (where s.games > 0), count(*) filter (where s.firsts > 0) into v_heroes_played, v_heroes_won
      from public.achievement_hero_stats s where s.user_id = p_user;

    -- Ranked streaks, over Ranked games since the achievements epoch, ending with this one.
    if p_mode = 'ranked' then
      with r as (
        select rr.placement, row_number() over (order by rr.created_at desc, rr.run_id desc) as rn
        from public.rank_results rr
        where rr.user_id = p_user and rr.created_at >= v_ach_epoch and rr.created_at <= v_source_at
      )
      select coalesce((select min(rn) from r where placement <> 1) - 1, (select count(*) from r)),
             coalesce((select min(rn) from r where placement > 4) - 1, (select count(*) from r))
        into v_first_streak, v_top_streak;
    end if;

    -- The metrics: the client's run metrics (V2), overwritten by every server metric (a client can never name one).
    if coalesce(v_facts_ver, 0) >= 2 and jsonb_typeof(p_facts->'metrics') = 'object' then v_metrics := p_facts->'metrics'; end if;
    v_metrics := v_metrics || jsonb_build_object(
      'game', 1,
      'comeback', case when v_comeback then 1 else 0 end,
      'highestDivision', coalesce(prof.rank_highest_division, 0),
      'promoted', case when p_mode = 'ranked' and v_promoted then 1 else 0 end,
      'ascendantFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_div_before, 0) >= c_ascendant_div then 1 else 0 end,
      'demotionEscape', case when p_mode = 'ranked' and v_demo_game and not v_demoted and v_placement <= 4 then 1 else 0 end,
      'brutalFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_strength, 0) >= c_brutal_strength then 1 else 0 end,
      'firstStreak', v_first_streak,
      'topFourStreak', v_top_streak,
      'heroesPlayed', v_heroes_played,
      'heroesWon', v_heroes_won,
      c_meta_metric, 0
    );

    -- Pass 1: every live, non-prestige, non-meta definition, in id order. Pass 2: the meta family, by target.
    select count(*) into v_done_count from public.achievement_completions c where c.user_id = p_user;
    for d in
      select * from public.achievement_catalog c
      where c.active and not c.admin_off and c.trust <> 'P'
      order by (c.metric = c_meta_metric), case when c.metric = c_meta_metric then c.target else 0 end, c.achievement_id collate "C"
    loop
      continue when d.mode = 'ranked' and p_mode <> 'ranked';
      continue when d.mode = 'tutorial' and p_mode <> 'tutorial';
      continue when d.mode = 'any' and not v_run_ok;
      continue when d.set_id is not null and v_set is distinct from d.set_id;
      continue when d.hero_id is not null and v_hero is distinct from d.hero_id;
      continue when d.placement_max is not null and (v_ach_place is null or v_ach_place > d.placement_max);
      if d.metric = c_meta_metric then
        v_val := v_done_count;
      elsif jsonb_typeof(v_metrics->d.metric) = 'number' then
        v_val := least(c_metric_max, greatest(0, floor((v_metrics->>d.metric)::numeric)))::bigint;
      else
        v_val := 0;
      end if;
      continue when v_val <= 0;
      select ap.progress, ap.completed_at is not null into v_old, v_done
        from public.achievement_progress ap where ap.user_id = p_user and ap.achievement_id = d.achievement_id;
      if not found then v_old := 0; v_done := false; end if;
      continue when v_done;
      v_new := case when d.agg = 'sum' then v_old + v_val else greatest(v_old, v_val) end;
      continue when v_new = v_old and v_new < d.target;
      insert into public.achievement_progress (user_id, achievement_id, definition_version, progress, completed_at, completion_run_id, updated_at)
        values (p_user, d.achievement_id, d.version, v_new,
                case when v_new >= d.target then now() end, case when v_new >= d.target then p_run_id end, now())
        on conflict (user_id, achievement_id) do update set
          definition_version = excluded.definition_version, progress = excluded.progress,
          completed_at = excluded.completed_at, completion_run_id = excluded.completion_run_id, updated_at = now();
      if v_new >= d.target then
        insert into public.achievement_completions (user_id, achievement_id, run_id, mode, xp_awarded, title_id)
          values (p_user, d.achievement_id, p_run_id, p_mode, d.xp, d.title_id)
          on conflict (user_id, achievement_id) do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          v_ach_ids := array_append(v_ach_ids, d.achievement_id);
          v_ach_xp := v_ach_xp + d.xp;
          v_done_count := v_done_count + 1;
          -- 7c. A TITLE reward (hero titles, owner 2026-09-29) is granted in the same transaction. Only a title the
          -- catalog knows (the ownership FK); the grant is keyed, so a retry or the backfill never doubles it.
          if d.title_id is not null and exists (select 1 from public.cosmetic_catalog c where c.cosmetic_id = d.title_id and c.category = 'title') then
            insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
              values (p_user, d.title_id, 'achievement', d.achievement_id)
              on conflict (user_id, cosmetic_id) do nothing;
            get diagnostics v_rows = row_count;
            if v_rows > 0 then
              v_unlocked := array_append(v_unlocked, d.title_id);
              if d.title_id like c_hero_title_prefix || '%' then v_hero_title := d.title_id; end if;
            end if;
          end if;
        end if;
      end if;
    end loop;
  end if;

  -- 8. levels (lifetime XP; the level is derived). Achievement XP counts toward the level and its crates.
  v_xp0 := coalesce(prof.account_xp, 0);
  v_xp1 := v_xp0 + v_total + v_ach_xp;
  v_l0 := public.progression_level_of(v_xp0);
  v_l1 := public.progression_level_of(v_xp1);

  -- 9. titles: Alpha Tester for EVERY account at Level 2 (owner 2026-09-27); equipped when nothing else is
  if v_l1 >= c_alpha_level then
    insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
      values (p_user, c_alpha_title, 'level', p_mode || ':' || p_run_id)
      on conflict (user_id, cosmetic_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_unlocked := array_append(v_unlocked, c_alpha_title); end if;
  end if;
  v_equipped := prof.equipped_title_id;
  -- 9a. HERO TITLES (owner 2026-09-29). The master UPGRADES the title in place: a newly earned master replaces its own
  -- base title when that is the one worn. A new hero title is worn when nothing is (like Alpha Tester).
  if v_equipped is not null and v_equipped like c_hero_title_prefix || '%' and (v_equipped || c_master_suffix) = any(v_unlocked) then
    v_equipped := v_equipped || c_master_suffix;
  end if;
  if v_equipped is null and v_hero_title is not null then
    v_equipped := v_hero_title;
  end if;
  if v_equipped is null and exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c_alpha_title) then
    v_equipped := c_alpha_title;
  end if;

  -- 9b. crates: one sealed crate per newly reached level; enrollment (the first settlement) also grants the
  -- Level 1 Welcome Crate. The unique (user, level) key makes this safe against the backfill and any retry.
  -- AETHER ON (owner 2026-10-18): no crate per level. The Welcome Crate (Level 1, floor Common) on enrollment, as
  -- before, and one floor-LEGENDARY crate per milestone level at or below the new level (mirror of
  -- milestoneLevelsThrough), `source = 'milestone:<L>'`, so the one-crate-per-source index makes it once per
  -- milestone and a missing one self-heals. `v_crate_ids` holds only the rows actually created, Welcome first.
  -- AETHER OFF: the unchanged per-level insert below the `else` (kept byte-for-byte, hence its indentation).
  v_enrolling := prof.progression_enrolled_at is null;
  if v_aether then
    with ins as (
      insert into public.loot_crates (user_id, earned_level, source_id)
        select p_user, 1, p_mode || ':' || p_run_id where v_enrolling
        on conflict (user_id, earned_level) do nothing
        returning crate_id
    )
    select coalesce(array_agg(ins.crate_id), '{}') into v_crate_ids from ins;
    if v_ae_every >= 1 then
      with ins as (
        insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity)
          select p_user, null, 'milestone:' || g.lvl, p_mode || ':' || p_run_id, 'legendary'
          from generate_series(v_ae_every, v_l1, v_ae_every) as g(lvl)
          on conflict (user_id, source) where source is not null do nothing
          returning crate_id, source
      )
      select v_crate_ids || coalesce(array_agg(ins.crate_id order by split_part(ins.source, ':', 2)::int), '{}')
        into v_crate_ids from ins;
    end if;
  else
  with ins as (
    insert into public.loot_crates (user_id, earned_level, source_id)
      select p_user, g.lvl, p_mode || ':' || p_run_id
      from generate_series(case when v_enrolling then 1 else v_l0 + 1 end, v_l1) as g(lvl)
      on conflict (user_id, earned_level) do nothing
      returning crate_id, earned_level
  )
  select coalesce(array_agg(ins.crate_id order by ins.earned_level), '{}') into v_crate_ids from ins;
  end if;

  -- 10. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    account_xp = v_xp1, account_level = v_l1,
    progression_revision = prof.progression_revision + 1,
    progression_enrolled_at = coalesce(prof.progression_enrolled_at, now()),
    progression_curve_version = c_curve,
    equipped_title_id = v_equipped,
    updated_at = now()
  where user_id = p_user;

  insert into public.progression_results (
    user_id, run_id, mode, source_id, rules_version, curve_version, facts_version, facts,
    placement, comeback, base_xp, top_four_xp, first_place_xp, comeback_xp, achievement_xp, total_xp,
    xp_before, xp_after, level_before, level_after, revision_before, revision_after,
    crates_awarded, crate_ids, achievement_ids, unlocked_title_ids,
    aether_base, aether_placement, aether_total, aether_on
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, v_ach_xp, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    coalesce(array_length(v_crate_ids, 1), 0), v_crate_ids, v_ach_ids, v_unlocked,
    v_ae_base, v_ae_place, v_ae_base + v_ae_place, v_aether
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;

-- ── 13. record_gauntlet_clear: a first clear pays Aether instead of a crate (switch on) ────────────────────
-- The 2026-09-29-gauntlet-progress.sql transaction (validate → the per-user lock → the keyed progress row, a replay
-- answering `already_cleared`) with one change: once the progress row is new, the Aether switch decides the reward.
--  - ON: `gauntletFirstClear` Aether (200), reason 'gauntlet', source 'gauntlet:<stage>' (so once per stage, ever), and
--    NO crate (`crate_granted` stays false, `crate_id` null). Answers {status 'first_clear', crate null, aether}.
--    Stages cleared before the switch already have their row, so they replay as `already_cleared` and pay nothing
--    (spec 2026-10-18: stages already cleared before rollout "keep the crate they gave and pay no Aether").
--  - OFF, OR AN UNUSABLE AMOUNT (the economy row missing, `gauntletFirstClear` not a valid integer, or retuned to 0):
--    exactly today's sealed crate, plus `aether: 0`. A first clear happens once, so it must always give something.
-- Every answer carries `aether` (0 on a replay). Trust is unchanged: the client's clear is believed (owner 2026-09-29;
-- the Aether is the same accepted risk, spec 2026-10-18).
create or replace function public.record_gauntlet_clear(p_user uuid, p_stage int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows    int;
  v_crate   public.loot_crates%rowtype;
  v_aether  boolean;
  v_amount  int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if p_stage is null or p_stage < 1 or p_stage > 10 then raise exception 'bad_stage'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  insert into public.gauntlet_progress (user_id, stage) values (p_user, p_stage)
    on conflict (user_id, stage) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return jsonb_build_object('status', 'already_cleared', 'crate', null, 'aether', 0);
  end if;

  select aether_enabled into v_aether from public.progression_config where id = 1;
  if coalesce(v_aether, false) then
    v_amount := public.aether_economy_int((select c.economy from public.aether_config c where c.id = 1), array['gauntletFirstClear']);
    if v_amount > 0 then
      perform public.aether_apply(p_user, v_amount, 'gauntlet', 'gauntlet:' || p_stage);
      return jsonb_build_object('status', 'first_clear', 'crate', null, 'aether', v_amount);
    end if;
    -- unreadable or not above 0: the crate below, exactly as with the switch off (a first clear only happens once, so
    -- answering "nothing" here would strand the stage with neither a crate nor Aether, forever)
  end if;

  insert into public.loot_crates (user_id, earned_level, source, source_id)
    values (p_user, null, 'gauntlet:' || p_stage, 'gauntlet:' || p_stage)
    returning * into v_crate;
  update public.gauntlet_progress set crate_granted = true, crate_id = v_crate.crate_id
    where user_id = p_user and stage = p_stage;

  return jsonb_build_object('status', 'first_clear', 'crate', public.progression_crate_json(v_crate), 'aether', 0);
end;
$$;
revoke all on function public.record_gauntlet_clear(uuid, int) from public, anon, authenticated;
grant execute on function public.record_gauntlet_clear(uuid, int) to service_role;

-- ── 13b. The profile JSON carries the Aether balance ─────────────────────────────────────────────────────
-- MUST match `ProgressionProfile` in packages/progression/src/rules.ts key for key. The 2026-09-28-progression-skins.sql
-- body plus `aether`: the wallet balance, 0 for an account that never earned (no wallet row yet). Always present, the
-- switch on or off (a balance cannot move while it is off, so showing it is harmless; the client decides visibility).
create or replace function public.progression_profile_json(p_user uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'accountXp', p.account_xp, 'accountLevel', p.account_level, 'revision', p.progression_revision,
    'equippedTitleId', p.equipped_title_id,
    'titles', coalesce((
      select jsonb_agg(o.cosmetic_id order by o.unlocked_at, o.cosmetic_id)
      from public.player_cosmetics o join public.cosmetic_catalog c on c.cosmetic_id = o.cosmetic_id
      where o.user_id = p.user_id and c.category = 'title'
    ), '[]'::jsonb),
    'cosmetics', coalesce((
      select jsonb_agg(o.cosmetic_id order by o.unlocked_at, o.cosmetic_id)
      from public.player_cosmetics o where o.user_id = p.user_id
    ), '[]'::jsonb),
    'loadout', coalesce((
      select jsonb_agg(jsonb_build_object('slot', l.slot, 'targetId', l.target_id, 'cosmeticId', l.cosmetic_id) order by l.slot, l.target_id)
      from public.cosmetic_loadouts l
      join public.cosmetic_catalog c on c.cosmetic_id = l.cosmetic_id
      join public.cosmetic_categories k on k.category = c.category
      where l.user_id = p.user_id and c.active and not c.admin_off and k.enabled and not k.admin_off
    ), '[]'::jsonb),
    'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p.user_id), 0)
  )
  from public.profiles p where p.user_id = p_user;
$$;
revoke all on function public.progression_profile_json(uuid) from public, anon, authenticated;
grant execute on function public.progression_profile_json(uuid) to service_role;

-- ── 14. aether_rollout: backdate the milestone crates, then flip the switch. Service role only. ─────────────
-- THE OWNER'S ONE-SHOT (run it once from the SQL Editor when Aether launches; the runbook line is at the very bottom
-- of this file, commented out). For every profile at or above the first milestone level (Level 10), one free
-- floor-Legendary, unfocused crate per milestone level at or below its CURRENT level (spec 2026-10-18: "one per multiple
-- of 10 at or below their current level"), `source = 'milestone:<L>'`; each account given a
-- crate gets its progression revision moved so its mirrors adopt the new crates. Then `aether_enabled = true`.
-- Returns {accounts: accounts given at least one NEW crate, crates: crates created}. IDEMPOTENT: the one-crate-per-
-- source index makes a re-run (or a settlement that already granted a milestone) create nothing, so a second run
-- answers {accounts 0, crates 0}. Earned Aether is NOT backdated (accounts start at 0; spec 2026-10-18). Because the
-- owner runs it by hand, an unreadable `milestoneEvery` (or one below 1) REFUSES (`aether_config_invalid`) and changes
-- nothing, rather than flipping the switch with no crates granted.
create or replace function public.aether_rollout()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_every    int;
  v_crates   int := 0;
  v_accounts int := 0;
begin
  v_every := public.aether_economy_int((select c.economy from public.aether_config c where c.id = 1), array['milestoneEvery']);
  if v_every is null or v_every < 1 then raise exception 'aether_config_invalid'; end if;

  with ins as (
    insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity)
      select p.user_id, null, 'milestone:' || g.lvl, 'aether_rollout', 'legendary'
      from public.profiles p
      cross join lateral generate_series(v_every, p.account_level, v_every) as g(lvl)
      where p.account_level >= v_every
      on conflict (user_id, source) where source is not null do nothing
      returning user_id
  ), touched as (
    update public.profiles p set progression_revision = p.progression_revision + 1, updated_at = now()
      where p.user_id in (select distinct ins.user_id from ins)
      returning p.user_id
  )
  select (select count(*) from ins), (select count(*) from touched) into v_crates, v_accounts;

  update public.progression_config set aether_enabled = true where id = 1;
  return jsonb_build_object('accounts', v_accounts, 'crates', v_crates);
end;
$$;
revoke all on function public.aether_rollout() from public, anon, authenticated;
grant execute on function public.aether_rollout() to service_role;

-- ── END OF SECTIONS 11-14. ─────────────────────────────────────────────────────────────────────────────────

-- PostgREST caches the schema: reload it so the new functions and columns are callable at once.
notify pgrst, 'reload schema';

-- THE OWNER'S LAUNCH RUNBOOK (run once, AFTER this file and the Edge Functions are deployed): backdate the milestone
-- crates and turn Aether on.
-- select public.aether_rollout();

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- AETHER LAUNCH GRANT: 1,000 Aether for every account, once  (2026-10-19)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-18-aether.sql (it replaces that file's
-- `aether_rollout`). Before or after the launch both work: the launch step stays `select public.aether_rollout();`,
-- and if Aether is ALREADY on when this file runs, the bottom block pays every existing account at once. Idempotent:
-- every function is REPLACED and re-granted, the trigger is dropped and re-added, and each account's grant is one
-- ledger row (reason 'grant', source 'aether_launch'), so a re-run, a second rollout or a retried insert never pays
-- twice. The same block is appended to schema.sql; keep the two identical.
--
-- WHAT THIS IS (owner 2026-10-19: "lets give everyone 1,000 Aether as part of the announcement of this change"):
--  - `aether_launch_grant(user)`: credits the grant through `aether_apply` (the one balance writer). Internal.
--  - `aether_rollout()`: as before (backdate the milestone crates, flip the switch), and now ALSO pays the grant to
--    every profile, moving the progression revision of each account it pays so its mirrors adopt the balance.
--    Answers {accounts, crates, granted}.
--  - A profile created AFTER the launch (a new account's first game, a guest signing in) is paid by the
--    `profiles_aether_launch_grant` trigger, so "everyone" stays true for players who join later. With the switch
--    off the trigger pays nothing (the rollout pays those accounts instead).
-- THE TS COPY of the amount is `AETHER_LAUNCH_GRANT` (packages/progression/src/aether.ts), which the Collection's
-- "Introducing Aether" announcement names; aetherLaunchGrant.db.test.ts checks the two agree.

-- ── 1. aether_launch_grant: one account's grant (internal) ──────────────────────────────────────────────────
create or replace function public.aether_launch_grant(p_user uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c_grant constant int := 1000;
begin
  return public.aether_apply(p_user, c_grant, 'grant', 'aether_launch');
end;
$$;
revoke all on function public.aether_launch_grant(uuid) from public, anon, authenticated, service_role;

-- ── 2. The trigger: a profile created while Aether is on is paid at once ───────────────────────────────────
create or replace function public.profiles_aether_launch_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select c.aether_enabled from public.progression_config c where c.id = 1), false) then
    perform public.aether_launch_grant(new.user_id);
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_aether_launch_grant() from public, anon, authenticated, service_role;
drop trigger if exists profiles_aether_launch_grant on public.profiles;
create trigger profiles_aether_launch_grant after insert on public.profiles
  for each row execute function public.profiles_aether_launch_grant();

-- ── 3. aether_rollout: the 2026-10-18 body, plus the grant for every existing profile ──────────────────────
-- Unchanged from 2026-10-18-aether.sql except for the grant: the milestone crates are backdated exactly as before,
-- then every profile is paid (`granted` counts the accounts actually paid NOW; a re-run answers 0), each account given
-- a crate or the grant has its progression revision moved once, and the switch flips. An unreadable
-- `milestoneEvery` still REFUSES (`aether_config_invalid`) and changes nothing.
create or replace function public.aether_rollout()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_every    int;
  v_crates   int := 0;
  v_accounts int := 0;
  v_granted  int := 0;
  v_user     uuid;
  v_paid     uuid[] := '{}';
begin
  v_every := public.aether_economy_int((select c.economy from public.aether_config c where c.id = 1), array['milestoneEvery']);
  if v_every is null or v_every < 1 then raise exception 'aether_config_invalid'; end if;

  for v_user in
    select p.user_id from public.profiles p
    where not exists (select 1 from public.aether_ledger l where l.user_id = p.user_id and l.reason = 'grant' and l.source_id = 'aether_launch')
    order by p.user_id
  loop
    perform public.aether_launch_grant(v_user);
    v_paid := v_paid || v_user;
  end loop;
  v_granted := coalesce(array_length(v_paid, 1), 0);

  with ins as (
    insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity)
      select p.user_id, null, 'milestone:' || g.lvl, 'aether_rollout', 'legendary'
      from public.profiles p
      cross join lateral generate_series(v_every, p.account_level, v_every) as g(lvl)
      where p.account_level >= v_every
      on conflict (user_id, source) where source is not null do nothing
      returning user_id
  ), touched as (
    update public.profiles p set progression_revision = p.progression_revision + 1, updated_at = now()
      where p.user_id in (select distinct ins.user_id from ins) or p.user_id = any(v_paid)
      returning p.user_id
  )
  select (select count(distinct ins.user_id) from ins), (select count(*) from ins) into v_accounts, v_crates;

  update public.progression_config set aether_enabled = true where id = 1;
  return jsonb_build_object('accounts', v_accounts, 'crates', v_crates, 'granted', v_granted);
end;
$$;
revoke all on function public.aether_rollout() from public, anon, authenticated;
grant execute on function public.aether_rollout() to service_role;

-- ── 4. Already launched? Pay everyone now ─────────────────────────────────────────────────────────────────
-- Only when this file runs AFTER `aether_rollout()` (the switch is already on): the trigger cannot reach the profiles
-- that exist already, so pay them here. Before the launch this does nothing and the rollout pays them.
do $$
declare
  v_user uuid;
begin
  if coalesce((select c.aether_enabled from public.progression_config c where c.id = 1), false) then
    for v_user in
      select p.user_id from public.profiles p
      where not exists (select 1 from public.aether_ledger l where l.user_id = p.user_id and l.reason = 'grant' and l.source_id = 'aether_launch')
    loop
      perform public.aether_launch_grant(v_user);
      update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = v_user;
    end loop;
  end if;
end;
$$;

-- PostgREST caches the schema: reload it so the replaced rollout is callable at once.
notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- MILESTONE CHESTS ARE EPIC, AND NO CHEST IS FOCUSED AT OPEN  (2026-10-20)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-18-aether.sql and 2026-10-19-aether-launch-grant.sql (it
-- replaces open_crate, settle_progression and aether_rollout). Idempotent: the constraint is dropped and re-added and
-- every function is REPLACED and re-granted, so a re-run changes nothing. The same block is appended to schema.sql;
-- keep the two identical.
--
-- WHAT THIS IS (owner 2026-10-20: "i want the chest quality to reduce down to Epic for the milestone chests (every 10
-- levels) and you cannot focus those ones specifically"; asked about chests already earned: "Keep them Legendary"):
--  - A milestone crate (`source = 'milestone:<level>'`) is created at floor EPIC from now on, by the settlement and by
--    the rollout. Each level's milestone crate is still made once (the one-crate-per-source index), so an account that
--    already holds a floor-Legendary milestone crate keeps it exactly as it is, sealed or opened.
--  - The table now allows a milestone crate at Epic or Legendary (Legendary = the ones granted before this file), and
--    nothing else.
--  - `open_crate` takes no focus for ANY crate: a focus is bought with a crate in the Chest Shop (buy_crate, unchanged).
--    A focused open is refused as `focus_not_allowed` before anything is charged or rolled, so an older client that still
--    offers the milestone focus step leaves the crate sealed and its Aether untouched; its unfocused Open still works.
--  - Unchanged on purpose: `aether_quote` (its `p_milestone` argument is no longer called by anything; kept so the
--    TS mirror quoteCrate stays in parity), buy_crate, the tiered pick, and the roll version (5).
--
-- THE TS COPY: packages/progression/src/aether.ts (MILESTONE_CRATE_FLOOR). milestoneChestsEpic.db.test.ts runs this
-- file on PGlite after the Aether files.

-- ── 1. A milestone crate is floor Epic (new) or Legendary (granted before this file) ──────────────────────
alter table public.loot_crates drop constraint if exists loot_crates_milestone_is_legendary;
alter table public.loot_crates drop constraint if exists loot_crates_milestone_floor;
alter table public.loot_crates add constraint loot_crates_milestone_floor
  check (source is null or source not like 'milestone:%' or floor_rarity in ('epic', 'legendary'));

-- ── 2. open_crate: the 2026-10-18 transaction with the focus at open removed ──────────────────────────────
create or replace function public.open_crate(p_user uuid, p_crate_id uuid, p_focus text[] default null, p_expected_fee int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_roll_version constant int := 5;
  v_crate   public.loot_crates%rowtype;
  v_enabled boolean;
  v_aether  boolean;
  v_quote   jsonb;
  v_focus   text[];
  v_fee     int;
  v_pick    text;
  v_rows    int;
  v_sealed  int;
begin
  if p_user is null or p_crate_id is null then raise exception 'bad_crate_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  select * into v_crate from public.loot_crates where crate_id = p_crate_id and user_id = p_user for update;
  if not found then raise exception 'crate_not_found'; end if;

  if v_crate.state = 'opened' then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'already_opened', 'crate', public.progression_crate_json(v_crate),
      'rewardId', v_crate.reward_cosmetic_id, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user),
      'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p_user), 0));
  end if;

  select crates_enabled, aether_enabled into v_enabled, v_aether from public.progression_config where id = 1;
  if not coalesce(v_enabled, false) then raise exception 'crates_disabled'; end if;

  -- NO crate takes a focus at open (owner 2026-10-20: milestone chests "you cannot focus those ones specifically"); a
  -- focus is bought WITH a crate, in buy_crate. The two parameters stay so an older client's focused call is refused
  -- (`focus_not_allowed`, nothing charged, the crate left sealed), never an unknown-function error.
  if p_focus is not null then raise exception 'focus_not_allowed'; end if;

  if not exists (select 1 from public.progression_tiered_crate_pool(p_user, v_crate.floor_rarity, v_crate.focus_categories)) then
    select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
    return jsonb_build_object('status', 'pool_exhausted', 'crate', public.progression_crate_json(v_crate),
      'rewardId', null, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user),
      'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p_user), 0));
  end if;

  v_focus := v_crate.focus_categories;

  -- ONE draw: a rarity at or above the floor at the renormalized odds, then an item of it (mirror of pickTieredCrateReward).
  v_pick := public.progression_tiered_crate_pick(p_user, random(), v_crate.floor_rarity, v_focus);
  if v_pick is null then raise exception 'duplicate_reward'; end if;

  insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
    values (p_user, v_pick, 'crate', p_crate_id::text)
    on conflict (user_id, cosmetic_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'duplicate_reward'; end if;

  update public.loot_crates set state = 'opened', reward_cosmetic_id = v_pick, roll_version = c_roll_version, opened_at = now(),
      focus_categories = v_focus
    where crate_id = p_crate_id and state = 'sealed'
    returning * into v_crate;
  if not found then raise exception 'crate_not_found'; end if;

  -- A new title is worn at once only when the player wears none; the revision moves so mirrors adopt the change.
  update public.profiles set
    equipped_title_id = coalesce(equipped_title_id,
      (select c.cosmetic_id from public.cosmetic_catalog c where c.cosmetic_id = v_pick and c.category = 'title')),
    progression_revision = progression_revision + 1,
    updated_at = now()
  where user_id = p_user;

  select count(*) into v_sealed from public.loot_crates where user_id = p_user and state = 'sealed';
  return jsonb_build_object('status', 'opened', 'crate', public.progression_crate_json(v_crate),
    'rewardId', v_pick, 'sealedRemaining', v_sealed, 'profile', public.progression_profile_json(p_user),
    'aether', coalesce((select w.balance from public.aether_wallets w where w.user_id = p_user), 0));
end;
$$;
revoke all on function public.open_crate(uuid, uuid, text[], int) from public, anon, authenticated;
grant execute on function public.open_crate(uuid, uuid, text[], int) to service_role;

-- ── 3. settle_progression: the 2026-10-18 body, its milestone crates floor Epic ───────────────────────────
create or replace function public.settle_progression(
  p_user uuid, p_mode text, p_run_id text, p_source_id bigint default null, p_comeback boolean default false,
  p_rules_version int default null, p_facts jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- THE RULES (mirror of XP_RULES / CURVE in packages/progression/src/rules.ts — change all copies together)
  c_rules             constant int := 1;
  c_curve             constant int := 1;
  c_complete          constant int := 100;
  c_top_four          constant int := 60;
  c_first_place       constant int := 90;
  c_comeback          constant int := 25;
  c_comeback_streak   constant int := 4;
  c_practice_percent  constant int := 60;
  c_practice_flat     constant int := 60;
  c_tutorial          constant int := 250;
  c_tutorial_course   constant text := 'learn-ascent';
  c_tutorial_version  constant int := 1;
  c_alpha_title       constant text := 'alpha_tester';
  c_alpha_level       constant int := 2;
  c_rate_max          constant int := 30;
  c_rate_window       constant interval := interval '10 minutes';
  -- ACHIEVEMENTS (mirror of packages/progression/src/achievements.ts)
  c_meta_metric       constant text := 'achievementsCompleted';
  c_brutal_strength   constant int := 70;
  c_ascendant_div     constant int := 15;
  c_metric_max        constant bigint := 1000000000;
  -- HERO TITLES (mirror of heroTitleId / heroMasterTitleId in packages/progression/src/cosmetics.ts)
  c_hero_title_prefix constant text := 'title_hero_';
  c_master_suffix     constant text := '_master';
  -- VERSUS (owner 2026-10-14: "versus can complete achievements and grant XP but no rank progress")
  c_versus_win        constant int := 60;
  c_versus_min_rounds constant int := 1;

  prof        public.profiles%rowtype;
  prev        public.progression_results%rowtype;
  v_epoch     timestamptz;
  v_recent    int;
  v_source_at timestamptz;
  v_source    text := null;
  v_placement int := null;
  v_comeback  boolean := false;
  v_seed      bigint;
  v_cfg       jsonb;
  v_record    jsonb;
  v_wins      int;
  v_losses    int;
  r_top int := 0; r_first int := 0; r_come int := 0; v_ranked_total int;
  v_base int := 0; v_top int := 0; v_first int := 0; v_come int := 0; v_total int;
  v_xp0 bigint; v_xp1 bigint; v_l0 int; v_l1 int;
  v_unlocked  text[] := '{}';
  v_equipped  text;
  v_rows      int;
  v_facts_ver int := null;
  v_enrolling boolean;
  v_crate_ids uuid[] := '{}';
  -- achievements
  v_ach_epoch  timestamptz;
  v_promoted   boolean := false;
  v_div_before int := null;
  v_demo_game  boolean := false;
  v_demoted    boolean := false;
  v_strength   int := null;
  v_hero       text := null;
  v_set        text := null;
  v_run_ok     boolean := false;
  v_metrics    jsonb := '{}';
  v_first_streak int := 0;
  v_top_streak int := 0;
  v_heroes_played int := 0;
  v_heroes_won int := 0;
  v_done_count int := 0;
  d            public.achievement_catalog%rowtype;
  v_val        bigint;
  v_old        bigint;
  v_done       boolean;
  v_new        bigint;
  v_ach_ids    text[] := '{}';
  v_ach_xp     int := 0;
  v_hero_title text := null;
  -- versus
  v_match      public.versus_matches%rowtype;
  v_vs_seat    text := null;
  v_ach_place  int := null;
  -- aether (2026-10-18): no constants; the numbers are the aether_config economy, read once
  v_aether     boolean := false;
  v_eco        jsonb;
  v_ae_base    int := 0;
  v_ae_place   int := 0;
  v_ae_every   int;
begin
  -- 1. validate
  if p_mode is null or p_mode not in ('ranked', 'practice', 'tutorial', 'versus') then raise exception 'bad_mode'; end if;
  if p_run_id is null or length(p_run_id) < 1 or length(p_run_id) > 128 then raise exception 'bad_run_id'; end if;
  if p_rules_version is distinct from c_rules then raise exception 'unsupported_rules'; end if;

  -- 2. serialize per user (every progression entry point takes the advisory lock first), then lock the row
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));
  insert into public.profiles (user_id, rating) values (p_user, 0) on conflict (user_id) do nothing;
  select * into prof from public.profiles where user_id = p_user for update;

  -- 3. ledger check UNDER the lock: a duplicate returns the ORIGINAL result + today's profile, awards nothing
  select * into prev from public.progression_results where user_id = p_user and run_id = p_run_id and mode = p_mode;
  if found then
    return jsonb_build_object('status', 'deduped', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
  end if;

  -- 4. the switch: nothing is awarded before the owner sets the epoch
  select epoch, achievements_epoch into v_epoch, v_ach_epoch from public.progression_config where id = 1;
  if v_epoch is null then raise exception 'progression_disabled'; end if;

  -- 5. rate limit (technical only: a refused request is retried later and keeps its XP)
  select count(*) into v_recent from public.progression_results
    where user_id = p_user and settled_at >= now() - c_rate_window;
  if v_recent >= c_rate_max then raise exception 'rate_limited'; end if;

  -- 6. the SOURCE row: the placement comes from here, never from the request
  if p_mode = 'ranked' then
    select rr.placement, rr.seed, rr.created_at, rr.promoted, rr.division_before, rr.was_demotion_game, rr.demoted, rr.lobby_strength
      into v_placement, v_seed, v_source_at, v_promoted, v_div_before, v_demo_game, v_demoted, v_strength
      from public.rank_results rr where rr.user_id = p_user and rr.run_id = p_run_id;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_run_id;
    v_comeback := coalesce(p_comeback, false);
    if v_comeback and v_seed is not null then
      select h.wins, case when (h.entry->>'losses') ~ '^[0-9]+$' then (h.entry->>'losses')::int end
        into v_wins, v_losses
        from public.run_history h
        where h.user_id = p_user and h.mode = 'lobby' and h.entry->>'seed' = v_seed::text
        order by h.created_at desc limit 1;
      if found and (coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1) then v_comeback := false; end if;
    end if;
  elsif p_mode = 'practice' then
    if p_source_id is null or p_source_id < 1 then raise exception 'bad_source'; end if;
    if p_run_id is distinct from ('practice:' || p_source_id::text) then raise exception 'bad_run_id'; end if;
    select pg.placement, pg.config, pg.record, pg.created_at, pg.hero_id into v_placement, v_cfg, v_record, v_source_at, v_hero
      from public.practice_games pg where pg.id = p_source_id and pg.user_id = p_user;
    if not found then raise exception 'source_not_found'; end if;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := p_source_id::text;
    -- No meaningful placement: an Unlimited Health game plays to the curtain and is never eliminated (and a row
    -- with no options recorded is treated the same way). It earns the flat XP, no placement or comeback bonus.
    if v_cfg is null or coalesce(v_cfg->>'health', 'unlimited') <> 'normal'
       or v_placement is null or v_placement < 1 or v_placement > 8 then
      v_placement := null;
    end if;
    v_comeback := coalesce(p_comeback, false) and v_placement is not null;
    if v_comeback and v_record is not null then
      v_wins := case when (v_record->>'wins') ~ '^[0-9]+$' then (v_record->>'wins')::int end;
      v_losses := case when (v_record->>'losses') ~ '^[0-9]+$' then (v_record->>'losses')::int end;
      if coalesce(v_losses, 0) < c_comeback_streak or coalesce(v_wins, 0) < 1 then v_comeback := false; end if;
    end if;
  elsif p_mode = 'versus' then
    -- VERSUS: the source is the server-owned match row. The caller must have held a PLAYER seat, the match must be
    -- over and must have fought at least one round. Placement = 1 for the winner, 2 for the loser, null when nobody
    -- won (abandoned). It drives XP only: rank_results, rating and MMR are never read or written here.
    if p_run_id !~ '^versus:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'bad_run_id'; end if;
    select * into v_match from public.versus_matches m where m.id = substring(p_run_id from 8)::uuid;
    if not found then raise exception 'source_not_found'; end if;
    v_vs_seat := case when v_match.p1_user = p_user then 'p1' when v_match.p2_user = p_user then 'p2' end;
    if v_vs_seat is null then raise exception 'source_not_found'; end if;
    if v_match.phase <> 'complete' or v_match.completed_at is null then raise exception 'not_terminal'; end if;
    if not exists (select 1 from public.versus_rounds vr where vr.match_id = v_match.id and vr.round >= c_versus_min_rounds) then raise exception 'not_terminal'; end if;
    v_source_at := v_match.completed_at;
    if v_source_at < v_epoch then raise exception 'before_epoch'; end if;
    v_source := v_match.id::text;
    v_placement := case when v_match.winner_seat is null then null when v_match.winner_seat = v_vs_seat then 1 else 2 end;
    v_comeback := false;
    v_hero := case when v_vs_seat = 'p1' then v_match.p1_hero else v_match.p2_hero end;
  else
    -- tutorial: one claim per account per course version (the ledger check above already caught a repeat)
    if p_run_id is distinct from (c_tutorial_course || ':v' || c_tutorial_version::text) then raise exception 'bad_run_id'; end if;
    insert into public.tutorial_progression_claims (user_id, course_id, course_version, xp_awarded)
      values (p_user, c_tutorial_course, c_tutorial_version, c_tutorial)
      on conflict (user_id, course_id, course_version) do nothing;
    v_source := c_tutorial_course || ':' || c_tutorial_version::text;
  end if;

  -- 7. XP (mirror of xpForSettlement)
  if p_mode = 'tutorial' then
    v_base := c_tutorial;
  elsif p_mode = 'versus' then
    -- VERSUS: the completion XP, plus the win bonus for the winner (stored in the first-place column).
    v_base := c_complete;
    v_first := case when v_placement = 1 then c_versus_win else 0 end;
  elsif p_mode = 'practice' and v_placement is null then
    v_base := c_practice_flat;
  else
    r_top   := case when v_placement <= 4 then c_top_four else 0 end;
    r_first := case when v_placement = 1 then c_first_place else 0 end;
    r_come  := case when v_comeback then c_comeback else 0 end;
    if p_mode = 'ranked' then
      v_base := c_complete; v_top := r_top; v_first := r_first; v_come := r_come;
    else
      -- Practice: 60% of the equivalent ranked XP, summed then rounded; the remainder lands on the base.
      v_ranked_total := c_complete + r_top + r_first + r_come;
      v_top   := (r_top   * c_practice_percent + 50) / 100;
      v_first := (r_first * c_practice_percent + 50) / 100;
      v_come  := (r_come  * c_practice_percent + 50) / 100;
      v_base  := (v_ranked_total * c_practice_percent + 50) / 100 - v_top - v_first - v_come;
    end if;
  end if;
  v_total := v_base + v_top + v_first + v_come;

  -- 7a. AETHER (owner 2026-10-18: Aether replaces level-up crates; mirror of aetherForSettlement in
  -- packages/progression/src/aether.ts). Only with the switch on. Ranked: the base + the placement bonus, win or lose,
  -- for a VALID placement (none = the ladder never accepted the game: 0). Versus: the completion pay for ANY finished
  -- match (won, lost or abandoned with no winner) + the win bonus at placement 1. Practice and Tutorial: 0; no
  -- comeback bonus. Credited with reason = the mode, source = the run id, only when the total is above 0. An
  -- UNREADABLE economy (no row; a value this game needs, or `milestoneEvery`, not a valid integer; `milestoneEvery`
  -- below 1) turns Aether off FOR THIS SETTLEMENT: today's level crates, `aether` null, the XP untouched. A bad retune
  -- must never block a game (a raise here would fail every settlement until the config is fixed).
  select aether_enabled into v_aether from public.progression_config where id = 1;
  v_aether := coalesce(v_aether, false);
  if v_aether then
    select economy into v_eco from public.aether_config where id = 1;
    v_ae_every := public.aether_economy_int(v_eco, array['milestoneEvery']);
    if p_mode = 'ranked' and v_placement between 1 and 8 then
      v_ae_base  := public.aether_economy_int(v_eco, array['rankedBase']);
      v_ae_place := public.aether_economy_int(v_eco, array['rankedPlacementBonus', (v_placement - 1)::text]);
    elsif p_mode = 'versus' then
      v_ae_base  := public.aether_economy_int(v_eco, array['versusComplete']);
      -- read (and so checked) for both players, paid to the winner only
      v_ae_place := public.aether_economy_int(v_eco, array['versusWin']);
      if v_ae_place is not null and v_placement is distinct from 1 then v_ae_place := 0; end if;
    end if;
    if v_ae_every is null or v_ae_every < 1 or v_ae_base is null or v_ae_place is null then
      v_aether := false; v_ae_base := 0; v_ae_place := 0;
    elsif v_ae_base + v_ae_place > 0 then
      perform public.aether_apply(p_user, v_ae_base + v_ae_place, p_mode, p_run_id);
    end if;
  end if;

  if p_facts is not null and jsonb_typeof(p_facts) = 'object' and (p_facts->>'version') ~ '^[0-9]+$' then
    v_facts_ver := (p_facts->>'version')::int;
  end if;

  -- 7b. ACHIEVEMENTS (mirror of evaluateAchievements in packages/progression/src/achievements.ts). Only once the
  -- owner has set the achievements epoch, and only for a game whose source row is not older than it.
  if v_ach_epoch is not null and coalesce(v_source_at, now()) >= v_ach_epoch then
    -- The `any` gate: Ranked, or a standard Practice (Normal Health, so a real placement, AND a turn timer).
    v_run_ok := p_mode = 'ranked' or p_mode = 'versus'
      or (p_mode = 'practice' and v_placement is not null and coalesce(v_cfg->>'timeMult', '') ~ '^[1-9][0-9]*$');
    if p_mode = 'ranked' then v_hero := p_facts->>'heroId'; end if;
    -- VERSUS: a 1v1 "1st" is not a lobby finish, so placement-gated achievements (Top 4, 1st) never count it.
    v_ach_place := case when p_mode = 'versus' then null else v_placement end;
    if v_hero is not null and v_hero !~ '^[A-Za-z0-9_.-]{1,64}$' then v_hero := null; end if;
    v_set := p_facts->>'setId';
    if v_set is not null and v_set !~ '^[A-Za-z0-9_.-]{1,32}$' then v_set := null; end if;

    -- Distinct heroes: this game counts toward its hero when it is an eligible game.
    if v_run_ok and v_hero is not null then
      insert into public.achievement_hero_stats (user_id, hero_id, games, firsts)
        values (p_user, v_hero, 1, case when p_mode = 'ranked' and v_placement = 1 then 1 else 0 end)
        on conflict (user_id, hero_id) do update set
          games = public.achievement_hero_stats.games + 1,
          firsts = public.achievement_hero_stats.firsts + excluded.firsts,
          updated_at = now();
    end if;
    select count(*) filter (where s.games > 0), count(*) filter (where s.firsts > 0) into v_heroes_played, v_heroes_won
      from public.achievement_hero_stats s where s.user_id = p_user;

    -- Ranked streaks, over Ranked games since the achievements epoch, ending with this one.
    if p_mode = 'ranked' then
      with r as (
        select rr.placement, row_number() over (order by rr.created_at desc, rr.run_id desc) as rn
        from public.rank_results rr
        where rr.user_id = p_user and rr.created_at >= v_ach_epoch and rr.created_at <= v_source_at
      )
      select coalesce((select min(rn) from r where placement <> 1) - 1, (select count(*) from r)),
             coalesce((select min(rn) from r where placement > 4) - 1, (select count(*) from r))
        into v_first_streak, v_top_streak;
    end if;

    -- The metrics: the client's run metrics (V2), overwritten by every server metric (a client can never name one).
    if coalesce(v_facts_ver, 0) >= 2 and jsonb_typeof(p_facts->'metrics') = 'object' then v_metrics := p_facts->'metrics'; end if;
    v_metrics := v_metrics || jsonb_build_object(
      'game', 1,
      'comeback', case when v_comeback then 1 else 0 end,
      'highestDivision', coalesce(prof.rank_highest_division, 0),
      'promoted', case when p_mode = 'ranked' and v_promoted then 1 else 0 end,
      'ascendantFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_div_before, 0) >= c_ascendant_div then 1 else 0 end,
      'demotionEscape', case when p_mode = 'ranked' and v_demo_game and not v_demoted and v_placement <= 4 then 1 else 0 end,
      'brutalFirst', case when p_mode = 'ranked' and v_placement = 1 and coalesce(v_strength, 0) >= c_brutal_strength then 1 else 0 end,
      'firstStreak', v_first_streak,
      'topFourStreak', v_top_streak,
      'heroesPlayed', v_heroes_played,
      'heroesWon', v_heroes_won,
      c_meta_metric, 0
    );

    -- Pass 1: every live, non-prestige, non-meta definition, in id order. Pass 2: the meta family, by target.
    select count(*) into v_done_count from public.achievement_completions c where c.user_id = p_user;
    for d in
      select * from public.achievement_catalog c
      where c.active and not c.admin_off and c.trust <> 'P'
      order by (c.metric = c_meta_metric), case when c.metric = c_meta_metric then c.target else 0 end, c.achievement_id collate "C"
    loop
      continue when d.mode = 'ranked' and p_mode <> 'ranked';
      continue when d.mode = 'tutorial' and p_mode <> 'tutorial';
      continue when d.mode = 'any' and not v_run_ok;
      continue when d.set_id is not null and v_set is distinct from d.set_id;
      continue when d.hero_id is not null and v_hero is distinct from d.hero_id;
      continue when d.placement_max is not null and (v_ach_place is null or v_ach_place > d.placement_max);
      if d.metric = c_meta_metric then
        v_val := v_done_count;
      elsif jsonb_typeof(v_metrics->d.metric) = 'number' then
        v_val := least(c_metric_max, greatest(0, floor((v_metrics->>d.metric)::numeric)))::bigint;
      else
        v_val := 0;
      end if;
      continue when v_val <= 0;
      select ap.progress, ap.completed_at is not null into v_old, v_done
        from public.achievement_progress ap where ap.user_id = p_user and ap.achievement_id = d.achievement_id;
      if not found then v_old := 0; v_done := false; end if;
      continue when v_done;
      v_new := case when d.agg = 'sum' then v_old + v_val else greatest(v_old, v_val) end;
      continue when v_new = v_old and v_new < d.target;
      insert into public.achievement_progress (user_id, achievement_id, definition_version, progress, completed_at, completion_run_id, updated_at)
        values (p_user, d.achievement_id, d.version, v_new,
                case when v_new >= d.target then now() end, case when v_new >= d.target then p_run_id end, now())
        on conflict (user_id, achievement_id) do update set
          definition_version = excluded.definition_version, progress = excluded.progress,
          completed_at = excluded.completed_at, completion_run_id = excluded.completion_run_id, updated_at = now();
      if v_new >= d.target then
        insert into public.achievement_completions (user_id, achievement_id, run_id, mode, xp_awarded, title_id)
          values (p_user, d.achievement_id, p_run_id, p_mode, d.xp, d.title_id)
          on conflict (user_id, achievement_id) do nothing;
        get diagnostics v_rows = row_count;
        if v_rows > 0 then
          v_ach_ids := array_append(v_ach_ids, d.achievement_id);
          v_ach_xp := v_ach_xp + d.xp;
          v_done_count := v_done_count + 1;
          -- 7c. A TITLE reward (hero titles, owner 2026-09-29) is granted in the same transaction. Only a title the
          -- catalog knows (the ownership FK); the grant is keyed, so a retry or the backfill never doubles it.
          if d.title_id is not null and exists (select 1 from public.cosmetic_catalog c where c.cosmetic_id = d.title_id and c.category = 'title') then
            insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
              values (p_user, d.title_id, 'achievement', d.achievement_id)
              on conflict (user_id, cosmetic_id) do nothing;
            get diagnostics v_rows = row_count;
            if v_rows > 0 then
              v_unlocked := array_append(v_unlocked, d.title_id);
              if d.title_id like c_hero_title_prefix || '%' then v_hero_title := d.title_id; end if;
            end if;
          end if;
        end if;
      end if;
    end loop;
  end if;

  -- 8. levels (lifetime XP; the level is derived). Achievement XP counts toward the level and its crates.
  v_xp0 := coalesce(prof.account_xp, 0);
  v_xp1 := v_xp0 + v_total + v_ach_xp;
  v_l0 := public.progression_level_of(v_xp0);
  v_l1 := public.progression_level_of(v_xp1);

  -- 9. titles: Alpha Tester for EVERY account at Level 2 (owner 2026-09-27); equipped when nothing else is
  if v_l1 >= c_alpha_level then
    insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
      values (p_user, c_alpha_title, 'level', p_mode || ':' || p_run_id)
      on conflict (user_id, cosmetic_id) do nothing;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then v_unlocked := array_append(v_unlocked, c_alpha_title); end if;
  end if;
  v_equipped := prof.equipped_title_id;
  -- 9a. HERO TITLES (owner 2026-09-29). The master UPGRADES the title in place: a newly earned master replaces its own
  -- base title when that is the one worn. A new hero title is worn when nothing is (like Alpha Tester).
  if v_equipped is not null and v_equipped like c_hero_title_prefix || '%' and (v_equipped || c_master_suffix) = any(v_unlocked) then
    v_equipped := v_equipped || c_master_suffix;
  end if;
  if v_equipped is null and v_hero_title is not null then
    v_equipped := v_hero_title;
  end if;
  if v_equipped is null and exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = c_alpha_title) then
    v_equipped := c_alpha_title;
  end if;

  -- 9b. crates: one sealed crate per newly reached level; enrollment (the first settlement) also grants the
  -- Level 1 Welcome Crate. The unique (user, level) key makes this safe against the backfill and any retry.
  -- AETHER ON (owner 2026-10-18): no crate per level. The Welcome Crate (Level 1, floor Common) on enrollment, as
  -- before, and one floor-EPIC crate per milestone level at or below the new level (mirror of
  -- milestoneLevelsThrough), `source = 'milestone:<L>'`, so the one-crate-per-source index makes it once per
  -- milestone and a missing one self-heals. `v_crate_ids` holds only the rows actually created, Welcome first.
  -- AETHER OFF: the unchanged per-level insert below the `else` (kept byte-for-byte, hence its indentation).
  v_enrolling := prof.progression_enrolled_at is null;
  if v_aether then
    with ins as (
      insert into public.loot_crates (user_id, earned_level, source_id)
        select p_user, 1, p_mode || ':' || p_run_id where v_enrolling
        on conflict (user_id, earned_level) do nothing
        returning crate_id
    )
    select coalesce(array_agg(ins.crate_id), '{}') into v_crate_ids from ins;
    if v_ae_every >= 1 then
      with ins as (
        insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity)
          select p_user, null, 'milestone:' || g.lvl, p_mode || ':' || p_run_id, 'epic'
          from generate_series(v_ae_every, v_l1, v_ae_every) as g(lvl)
          on conflict (user_id, source) where source is not null do nothing
          returning crate_id, source
      )
      select v_crate_ids || coalesce(array_agg(ins.crate_id order by split_part(ins.source, ':', 2)::int), '{}')
        into v_crate_ids from ins;
    end if;
  else
  with ins as (
    insert into public.loot_crates (user_id, earned_level, source_id)
      select p_user, g.lvl, p_mode || ':' || p_run_id
      from generate_series(case when v_enrolling then 1 else v_l0 + 1 end, v_l1) as g(lvl)
      on conflict (user_id, earned_level) do nothing
      returning crate_id, earned_level
  )
  select coalesce(array_agg(ins.crate_id order by ins.earned_level), '{}') into v_crate_ids from ins;
  end if;

  -- 10. write profile + revision + the immutable result in this same transaction
  update public.profiles set
    account_xp = v_xp1, account_level = v_l1,
    progression_revision = prof.progression_revision + 1,
    progression_enrolled_at = coalesce(prof.progression_enrolled_at, now()),
    progression_curve_version = c_curve,
    equipped_title_id = v_equipped,
    updated_at = now()
  where user_id = p_user;

  insert into public.progression_results (
    user_id, run_id, mode, source_id, rules_version, curve_version, facts_version, facts,
    placement, comeback, base_xp, top_four_xp, first_place_xp, comeback_xp, achievement_xp, total_xp,
    xp_before, xp_after, level_before, level_after, revision_before, revision_after,
    crates_awarded, crate_ids, achievement_ids, unlocked_title_ids,
    aether_base, aether_placement, aether_total, aether_on
  ) values (
    p_user, p_run_id, p_mode, v_source, c_rules, c_curve, v_facts_ver, case when v_facts_ver is null then null else p_facts end,
    v_placement, v_comeback, v_base, v_top, v_first, v_come, v_ach_xp, v_total,
    v_xp0, v_xp1, v_l0, v_l1, prof.progression_revision, prof.progression_revision + 1,
    coalesce(array_length(v_crate_ids, 1), 0), v_crate_ids, v_ach_ids, v_unlocked,
    v_ae_base, v_ae_place, v_ae_base + v_ae_place, v_aether
  ) returning * into prev;

  return jsonb_build_object('status', 'ok', 'result', public.progression_result_json(prev), 'profile', public.progression_profile_json(p_user));
end;
$$;
revoke all on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) from public, anon, authenticated;
grant execute on function public.settle_progression(uuid, text, text, bigint, boolean, int, jsonb) to service_role;

-- ── 4. aether_rollout: the 2026-10-19 body (the launch grant kept), its backdated milestone crates floor Epic ─
create or replace function public.aether_rollout()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_every    int;
  v_crates   int := 0;
  v_accounts int := 0;
  v_granted  int := 0;
  v_user     uuid;
  v_paid     uuid[] := '{}';
begin
  v_every := public.aether_economy_int((select c.economy from public.aether_config c where c.id = 1), array['milestoneEvery']);
  if v_every is null or v_every < 1 then raise exception 'aether_config_invalid'; end if;

  for v_user in
    select p.user_id from public.profiles p
    where not exists (select 1 from public.aether_ledger l where l.user_id = p.user_id and l.reason = 'grant' and l.source_id = 'aether_launch')
    order by p.user_id
  loop
    perform public.aether_launch_grant(v_user);
    v_paid := v_paid || v_user;
  end loop;
  v_granted := coalesce(array_length(v_paid, 1), 0);

  with ins as (
    insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity)
      select p.user_id, null, 'milestone:' || g.lvl, 'aether_rollout', 'epic'
      from public.profiles p
      cross join lateral generate_series(v_every, p.account_level, v_every) as g(lvl)
      where p.account_level >= v_every
      on conflict (user_id, source) where source is not null do nothing
      returning user_id
  ), touched as (
    update public.profiles p set progression_revision = p.progression_revision + 1, updated_at = now()
      where p.user_id in (select distinct ins.user_id from ins) or p.user_id = any(v_paid)
      returning p.user_id
  )
  select (select count(distinct ins.user_id) from ins), (select count(*) from ins) into v_accounts, v_crates;

  update public.progression_config set aether_enabled = true where id = 1;
  return jsonb_build_object('accounts', v_accounts, 'crates', v_crates, 'granted', v_granted);
end;
$$;
revoke all on function public.aether_rollout() from public, anon, authenticated;
grant execute on function public.aether_rollout() to service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ANNOUNCERS CAN'T BE A CHEST FOCUS  (2026-10-20)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-18-aether.sql and 2026-10-20-milestone-chests-epic.sql (it
-- replaces aether_quote). Idempotent: the function is REPLACED and re-revoked, so a re-run changes nothing. The same
-- block is appended to schema.sql; keep the two identical.
--
-- WHAT THIS IS (owner 2026-10-20: "lets remove announcers from being able to be focused"; asked what a chest does when
-- every focusable category is ticked: "Free, may give an Announcer"; and "yes, announcers can drop from the unfocused
-- chests"):
--  - `aether_quote` no longer counts an Announcer as an AVAILABLE focus category. A focus naming `announcer` is refused as
--    `bad_focus`, and ticking every focusable category is NO focus (null, free), exactly as ticking every available one was
--    before: the pool of that chest still holds the Announcers, so it can give one.
--  - Unchanged on purpose: `progression_tiered_crate_pool` and `progression_tiered_crate_pick` (an Announcer still drops
--    from any unfocused chest), `buy_crate` and `open_crate` (they call the quote), and every number (prices, fees, odds).
--
-- THE TS COPY: NON_FOCUSABLE_CATEGORIES / availableFocusCategories in packages/progression/src/crateShop.ts.
-- announcersNotFocusable.db.test.ts runs this file on PGlite after the Aether files and checks it against quoteCrate.

create or replace function public.aether_quote(p_user uuid, p_tier text, p_focus text[], p_milestone boolean)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_milestone boolean := coalesce(p_milestone, false);
  v_tier      text;
  v_floor     text;
  v_eco       jsonb;
  v_price     int;
  v_available text[];
  v_focus     text[];
  v_remaining int;
  v_pct       int := 0;
  v_fee       int := 0;
  v_crate     int;
begin
  v_tier := case when v_milestone then 'legendary' else p_tier end;
  if v_tier is null or v_tier not in ('standard', 'rare', 'epic', 'legendary', 'ancient') then raise exception 'bad_tier'; end if;
  v_floor := case v_tier when 'standard' then 'common' else v_tier end;   -- mirror of CRATE_TIER_FLOOR

  select economy into v_eco from public.aether_config where id = 1;
  -- every economy number through the defensive read (section 11): a missing, fractional or garbled price is a refusal,
  -- never a cast error and never a guess (final review 2026-10-19)
  v_price := public.aether_economy_int(v_eco, array['cratePrice', v_tier]);
  if v_price is null then raise exception 'aether_config_missing'; end if;

  -- the categories a player may focus at this floor: those with something still eligible, never an Announcer
  -- (NON_FOCUSABLE_CATEGORIES in crateShop.ts). The POOL still holds them, so an unfocused chest, and one whose ticks
  -- cover every focusable category (v_focus := null below), can give one.
  select coalesce(array_agg(distinct c.category), '{}') into v_available
    from public.progression_tiered_crate_pool(p_user, v_floor, null) p
    join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
    where c.category <> 'announcer';

  -- normalizeFocus
  if p_focus is not null and cardinality(p_focus) > 0 then
    if exists (select 1 from unnest(p_focus) f where f is null or not (f = any(v_available))) then raise exception 'bad_focus'; end if;
    select array_agg(f order by f collate "C") into v_focus from (select distinct f from unnest(p_focus) f) d;
    if cardinality(v_focus) >= cardinality(v_available) then v_focus := null; end if;
  end if;

  select count(*) into v_remaining from public.progression_tiered_crate_pool(p_user, v_floor, v_focus);
  if v_remaining = 0 then raise exception 'sold_out'; end if;

  -- focusFeePercent: 1..7 ticked read the ladder, 8 or more (but fewer than all available) the last rung
  -- (an unreadable ladder or rung is `aether_config_missing`: a focused crate is never sold at a guessed fee)
  if v_focus is not null then
    if jsonb_typeof(v_eco -> 'focusFeePercent') is distinct from 'array' or jsonb_array_length(v_eco -> 'focusFeePercent') = 0 then
      raise exception 'aether_config_missing';
    end if;
    v_pct := public.aether_economy_int(v_eco,
      array['focusFeePercent', (least(cardinality(v_focus), jsonb_array_length(v_eco -> 'focusFeePercent')) - 1)::text]);
    if v_pct is null then raise exception 'aether_config_missing'; end if;
    v_fee := (v_price * v_pct) / 100;   -- integer division: Math.floor in the TS
  end if;
  v_crate := case when v_milestone then 0 else v_price end;
  return jsonb_build_object('tier', v_tier, 'floor', v_floor, 'focus', to_jsonb(v_focus), 'crate', v_crate,
    'fee', v_fee, 'total', v_crate + v_fee, 'remaining', v_remaining);
end;
$$;

revoke all on function public.aether_quote(uuid, text, text[], boolean) from public, anon, authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ACCOUNT PROGRESSION: EIGHT EMOTE POSITIONS, equip_cosmetic accepts emote targets '0'..'7'  (2026-10-22)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-14-card-plates.sql (and every file before it). THEN deploy
-- `progression-inventory` (its request check accepts positions 4..7 and its catalog sync adds the five Comms emotes).
-- Run first: an older progression-inventory still refuses positions 4..7 itself, so nothing can reach the old check.
-- Idempotent: it only REPLACES `equip_cosmetic` (and re-grants it), so re-running it is always safe; it writes no rows.
-- The same block is appended to schema.sql; keep the two identical. Owner runbook: docs/devlog/2026-10-22-emote-comms.md.
-- It SUPERSEDES the equip_cosmetic in 2026-10-14-card-plates.sql (it keeps every slot that file has, the card plate
-- included): if that file, or any older equip_cosmetic file, is ever re-run, run this one again after it.
--
-- WHAT THIS IS (owner 2026-10-22: "we'll use emotes for quickchat options, then. let's add 4 more emote slots, and give
-- everyone the communication emotes").
--  - The emote menu holds EIGHT emotes (was four): one cosmetic_loadouts row per menu position, target_id '0'..'7'.
--    The only change from the card plates file is that position check (and its comment). The move rule and the
--    starter rule are unchanged.
--  - The five Comms emotes (Hi, Good Choice, Too Nasty, It's Beasts, Lemon Approved) are STARTER items, owned by every
--    player without an ownership row, like Zen Brian. They arrive through the code-owned catalog sync
--    (packages/progression/src/cosmetics.ts, deploy progression-inventory). No catalog SQL, no backfill.

create or replace function public.equip_cosmetic(p_user uuid, p_slot text, p_target_id text, p_cosmetic_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.cosmetic_catalog%rowtype;
  v_live boolean;
begin
  if p_user is null then raise exception 'not_owned'; end if;
  if p_slot is null or p_slot not in ('hero_skin', 'minion_skin', 'hero_attack', 'portrait_frame', 'announcer', 'emote', 'card_plate') then raise exception 'bad_slot'; end if;
  -- A global slot (hero attack, portrait frame, announcer, card plate) has exactly one target, ''. The emote slot's target is the
  -- menu position '0'..'7'. A skin slot names its hero or card.
  if p_slot in ('hero_attack', 'portrait_frame', 'announcer', 'card_plate') then
    if p_target_id is distinct from '' then raise exception 'bad_target'; end if;
  elsif p_slot = 'emote' then
    if p_target_id is null or p_target_id !~ '^[0-7]$' then raise exception 'bad_target'; end if;
  elsif p_target_id is null or p_target_id !~ '^[A-Za-z0-9_.:-]{1,64}$' then
    raise exception 'bad_target';
  end if;
  if p_cosmetic_id is not null and p_cosmetic_id !~ '^[a-z0-9_]{1,64}$' then raise exception 'bad_cosmetic_id'; end if;
  perform pg_advisory_xact_lock(hashtextextended('progression:' || p_user::text, 0));

  if p_cosmetic_id is null then
    delete from public.cosmetic_loadouts where user_id = p_user and slot = p_slot and target_id = p_target_id;
  else
    select * into v_cat from public.cosmetic_catalog where cosmetic_id = p_cosmetic_id;
    if not found then raise exception 'bad_cosmetic_id'; end if;
    if v_cat.category <> p_slot then raise exception 'wrong_target'; end if;
    if p_slot in ('hero_attack', 'portrait_frame', 'announcer', 'card_plate') then
      if v_cat.target_type is not null or v_cat.target_id is not null then raise exception 'wrong_target'; end if;
    elsif p_slot = 'emote' then
      if v_cat.target_type is not null or v_cat.target_id is not null then raise exception 'wrong_target'; end if;
    elsif v_cat.target_type is distinct from (case p_slot when 'hero_skin' then 'hero' else 'card' end)
       or v_cat.target_id is distinct from p_target_id then
      raise exception 'wrong_target';
    end if;
    select k.enabled and not k.admin_off into v_live from public.cosmetic_categories k where k.category = v_cat.category;
    if not v_cat.active or v_cat.admin_off or not coalesce(v_live, false) then raise exception 'not_equippable'; end if;
    -- A starter item is everyone's: no ownership row is needed (or ever written).
    if v_cat.acquisition_source <> 'starter'
       and not exists (select 1 from public.player_cosmetics o where o.user_id = p_user and o.cosmetic_id = p_cosmetic_id) then
      raise exception 'not_owned';
    end if;
    -- An emote MOVES: it leaves any other menu position it held, so the menu never shows one emote twice.
    if p_slot = 'emote' then
      delete from public.cosmetic_loadouts
        where user_id = p_user and slot = 'emote' and cosmetic_id = p_cosmetic_id and target_id <> p_target_id;
    end if;
    insert into public.cosmetic_loadouts (user_id, slot, target_id, cosmetic_id, updated_at)
      values (p_user, p_slot, p_target_id, p_cosmetic_id, now())
      on conflict (user_id, slot, target_id) do update set cosmetic_id = excluded.cosmetic_id, updated_at = now();
  end if;

  update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = p_user;
  if not found then raise exception 'not_owned'; end if;
  return jsonb_build_object('status', 'equipped', 'profile', public.progression_profile_json(p_user));
end;
$$;

revoke all on function public.equip_cosmetic(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.equip_cosmetic(uuid, text, text, text) to service_role;
