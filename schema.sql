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
