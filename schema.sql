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
