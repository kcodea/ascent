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
--  - 66 catalog titles, two per playable hero: `title_hero_<id>` (from the new `hero.<id>.titled` achievement, 3
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
  ('title_hero_quillen', 'title', 'epic', 'achievement', null, null, null, 'hero.quillen.titled', true),
  ('title_hero_quillen_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.quillen.mastery', true),
  ('title_hero_hunch', 'title', 'epic', 'achievement', null, null, null, 'hero.hunch.titled', true),
  ('title_hero_hunch_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.hunch.mastery', true),
  ('title_hero_emeraldwarden', 'title', 'epic', 'achievement', null, null, null, 'hero.emeraldwarden.titled', true),
  ('title_hero_emeraldwarden_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.emeraldwarden.mastery', true),
  ('title_hero_albus', 'title', 'epic', 'achievement', null, null, null, 'hero.albus.titled', true),
  ('title_hero_albus_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.albus.mastery', true),
  ('title_hero_flash', 'title', 'epic', 'achievement', null, null, null, 'hero.flash.titled', true),
  ('title_hero_flash_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.flash.mastery', true),
  ('title_hero_midas', 'title', 'epic', 'achievement', null, null, null, 'hero.midas.titled', true),
  ('title_hero_midas_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.midas.mastery', true),
  ('title_hero_juggler', 'title', 'epic', 'achievement', null, null, null, 'hero.juggler.titled', true),
  ('title_hero_juggler_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.juggler.mastery', true),
  ('title_hero_bram', 'title', 'epic', 'achievement', null, null, null, 'hero.bram.titled', true),
  ('title_hero_bram_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.bram.mastery', true),
  ('title_hero_cia', 'title', 'epic', 'achievement', null, null, null, 'hero.cia.titled', true),
  ('title_hero_cia_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.cia.mastery', true),
  ('title_hero_keshi', 'title', 'epic', 'achievement', null, null, null, 'hero.keshi.titled', true),
  ('title_hero_keshi_master', 'title', 'legendary', 'achievement', null, null, null, 'hero.keshi.mastery', true),
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
