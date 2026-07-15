# Board backend — the live shared opponent pool (Supabase)

Finished-run boards sync to a hosted Postgres table (Supabase) and load back into the opponent pool at
startup, so you and a friend automatically face each other's builds — **no manual export / `npm run pool`**.
This is the live realization of the async-PvP track; the committed `OPPONENT_POOL_DATA` stays the **offline
floor** (the game is fully playable with no network / no backend configured).

## How it works

```
APP BOOT  ──fetchAndRegisterPool(`<version>+`)──►  GET boards (current patch) ──►  registerOpponents()   [static for the session]
RUN ENDS  ──uploadBoards(saveRunBoards(...))────►  INSERT this run's boards (fire-and-forget, never blocks)
```

- **Read** is once at startup and kept static for the session. The remote pool can differ across sessions, so
  faithful replay no longer relies on it: the exact opponent served each wave is **pinned into run state**
  (`servedBoards[wave]`) at `faceOmen`, so a saved run re-serves its real opponents on Continue even if the
  shared pool has since changed (see [board-pool.md](board-pool.md)).
- **Write** is fire-and-forget on run end; offline → silently skipped.
- Both sit behind one file, `packages/ui/src/remoteBoards.ts`, and **no-op when the env vars are unset**.
- Boards are served by **version prefix** (`<version>+%`), so per-commit SHA churn doesn't hide your boards;
  the full `patch` (`<version>+<sha>`) is still stored for fine-grained pruning.

## One-time setup

1. **Create the project** at [supabase.com](https://supabase.com) (Free tier). Keep *Enable Data API* on.
2. **Run the schema:** SQL Editor → New query → paste [`schema.sql`](../schema.sql) → Run.
3. **Get credentials:** Project Settings → **Data API** → *Project URL* (drop the trailing `/rest/v1/`); Project
   Settings → **API Keys** → the **publishable** (anon/public) key — **not** the secret key.
4. **Configure the app:** copy `apps/web/.env.example` → `apps/web/.env.local` and fill in:
   ```
   VITE_SUPABASE_URL=https://<ref>.supabase.co
   VITE_SUPABASE_ANON_KEY=sb_publishable_…
   ```
   `.env.local` is gitignored. The publishable key is **public by design** (it ships in the client bundle; RLS
   is what protects the data) — so it's safe there, but the vars must be present at `npm run build:web` time for
   the itch build to include the backend.

## Operating it

- **Sort / inspect:** Supabase **Table Editor** → the `boards` table → sort the `patch` column.
- **Clear stale boards:** SQL Editor (snippets live at the bottom of `schema.sql`), e.g.
  `delete from public.boards where patch not like '0.1.0+%';` — the dashboard equivalent of `npm run pool:prune`.
- **Per balance patch:** bump `package.json` `version` (the served patch prefix changes), then clear the old
  version's rows when you want them gone.

## Win-tracking (leaderboard records + the Career per-round log)

Each served board carries a stable id (`BoardSnapshot.id`, a UUID stamped at capture). When you fight a served
board, the client logs the outcome **from that board's perspective** (you lose to it → it gets a win) to a new
**`board_results`** table (`board_id`, `round`, `outcome`). The leaderboard reads each slot's **round-17** record
(wins + win-rate, sortable by Most wins / Most recent); the Career per-round log reads your own boards' records at
every round.

- **One-time migration:** re-run [`schema.sql`](../schema.sql) (idempotent) — it adds only the isolated
  `board_results` table + its RLS policies. **No change to `boards` / `runs`** (the id lives inside their existing
  jsonb), so board/victory uploads keep working whether or not you've run it. Until you do, records just read
  "No fights yet".
- **Only newly-captured boards** (post-this-release) carry an id, so tracking starts fresh from here.
- **Client-reported** (trust-based, like the uploads) — fine at friend scale; the same server-side replay
  validation on the roadmap hardens it later.

## Limits + the hardening path

- **No anti-cheat yet (by design).** At friend scale, anyone with the publishable key + RLS insert policy can
  POST boards. The upgrade — already in the roadmap — is **server-side replay validation**: clients upload the
  `{seed, heroId, actions}` replay and a Supabase Edge Function / Cloudflare Worker runs `@game/sim` to
  re-derive the boards, so fabricated boards aren't reproducible. The sim is pure + portable, so this is cheap.
- **Scale.** This workload (low write, read-once-per-patch-and-identical-for-everyone, no realtime) is trivially
  cacheable — front the read path with a CDN/static pool blob before public launch and the DB is never the wall.
  See the roadmap's "Auto-persist boards" item for the full scaling rationale + when Supabase would graduate to
  Cloudflare/self-host (a cost optimization, bounded because it's standard Postgres behind a one-file seam).

## Key files

- `packages/ui/src/remoteBoards.ts` — `uploadBoards` / `fetchAndRegisterPool` / `remoteEnabled` (the seam).
- `packages/ui/src/store.ts` — the two hooks: startup `fetchAndRegisterPool`, run-end `uploadBoards`.
- `packages/ui/src/boardLibrary.ts` — `saveRunBoards` (now returns the captured boards so they can be uploaded).
- `schema.sql` — the table + index + RLS policies + maintenance snippets.
- `apps/web/.env.example` — the env var template.
