# 2026-10-31 — The game session on Cloudflare (ranked, casual and Practice)

Owner 2026-10-31: "Is it possible to just have ranked solos run on cloudflare too so that we aren't read writing in real
time? Can we offload that to cloudflare" → "Do it". Then: "This then changes spectating for those games I assume so make
sure that fix is in scope too". Standing ruling: Cloudflare is the source for all live information and action; Supabase is
storage only. Rules R-SESSION-CF-01, R-POOL-MIRROR-01. Branch feat/ranked-solo-cf.

## Phase 1: the audit (before)

`scripts/egress-game-probe.mjs` (new) plays a whole lobby game in a headless measurement build (`VITE_EGRESS_METER=1
VITE_PERF_BENCH=1`) and lists every backend call per phase from the CDP wire. Reads go live. Every Supabase WRITE is
answered locally and counted with its request size, so a bot-played game never reaches the pool, the ladder or history.
I ran two ranked games (8 and 9 rounds, 7 recorded seats, rated) and one Practice game against players (8 rounds).

| Phase | Supabase calls (before) |
|---|---|
| Boot (menus) | 23-27 calls. About 357 KB on a cold cache (pool_runs_boards 172 KB, Recent Games run_telemetry 161 KB), about 31 KB warm. |
| Hero select | Ranked 0. Practice: pool keys + boards x2 (379 KB, a second band sample). |
| **Per round** | **0** for a guest. A signed-in player: **1 put_saved_run per shop start**, carrying the whole save (22 KB at round 1, 87 KB by round 8) plus all 7 seat recordings every time (105-139 KB). That is 130-225 KB a round, about 3 MB a game. |
| End, ranked | 14-16 calls. Writes: submit-rating, submit-progression, boards (10-12 KB), lobby_fights (9 KB), run_history (9 KB), run_telemetry (22-26 KB), the Storage replay (15 KB), profiles, perf_runs (146-205 KB). Reads: run_fight_records, run_history, histograms x3, the pool refresh. |
| End, Practice | practice_games (170 KB, replay inline) + submit-progression. |

The live socket (spectating) was already on Cloudflare: 6-16 frames a round, about 1 KB.

## Phase 2: what was built

**Where:** a new Durable Object class, `GameSession`, on the STABLE friends hub Worker (`ascent-hub`). The Versus Workers
are one per content revision and are deleted once nothing plays on them. A session owes Supabase writes until its flush
lands, so it must live where a pack never retires it. The session needs no engine (the client still seats the table and
plays the game), and the hub carries none. The hub already has the writer key, the origin list, deploy-on-change and the
Live Games directory.

**Spectating (the design choice):** the session object IS the live host. `liveHost.ts` (new) is the old `VersusLiveGame`
body as an engine-free abstract base. `VersusLiveGame` is now a thin subclass and behaves as before; the existing
`live.it.ts` passes unchanged. `GameSession` extends the same base. A session game has ONE socket
(`/session/<game>/ws`) and ONE listing, written straight to the hub's own `LiveDirectory` with `live_host = 'session'`.
Chat, pings and mentor, the keyframe for a late joiner and the spectators' watch record (the hub's writer key) are all
the same code. A watcher reaches it on the hub from any build, and reads the table's seat recordings from the session,
not Supabase. Nothing double-publishes.

**The session** (`core/sessionCore.ts`, pure, fake-clock tested):
- The cloud save is held during play. It is written to `saved_runs` only when the player parks (Save & Quit) or has had
  no live socket for 60 s, or after 10 minutes with no save.
- The table (opponent fight-ledger keys plus seat recordings) is pinned at the start.
- The run-end outbox items are kept once per key.
- The rank request gets `submit-rating`'s checks, plus two more: the run must be THIS game, and the PINNED table is the
  one settled.
- Everything goes to Supabase through ONE key-gated SQL function, `session_cf_flush`. Writes go first, then
  `settle_rank`, in one transaction, as the player only (user_id forced, only columns the client may insert,
  idempotent by a ledger plus the tables' own keys).
- Failed flushes back off and retry from the alarm.

**The pool mirror** (`core/poolPick.ts`, `core/poolMirrorCore.ts`, `poolMirror.ts`): one object holding the eligible pool
as Supabase serves it. It is synced by the hub's cron every 5 minutes (a version hash, then only the runs whose rev
moved). `POST /pool/keys` is `pool_runs__pick` ported line for line (exact decimals, the same md5 for a seeded draw) and
`POST /pool/boards` returns the database's own jsonb text. A cold or unreachable mirror falls back to Supabase.

**Client** (`packages/ui/src/session/`):
- `sessionRemote.ts`: the switch, the per-game decision, calls, the mirror.
- `gameSession.ts`: the lifecycle (table pin, park on Save & Quit).
- `sessionCloudSave.ts`: the save and clear routing.
- Plus hooks in the live publisher and watcher, the outbox sender (each item carries its session; the Storage replay
  upload stays client-side) and `submitRating`.
- Every session call that fails is made the old way at once. Nothing is lost.

**Not moved (flagged):** `submit-progression` and the Storage replay upload (agreed), `practice_games` (its id feeds
progression), the profile PATCH, the end-screen reads (strength, Career refresh, histograms), and `perf_runs` (the
owner's call is pending).

## After

The same ranked game against a local hub (`SESSION_MODE=on`, persistence off, with the mirror loaded from the live pool):

| Phase | After |
|---|---|
| Boot | Pool keys (4.3 KB) + boards (128 KB, cold) come from the hub. **0 Supabase pool reads.** |
| Per round | **0 Supabase calls** for everyone. A signed-in player's save goes to the session. |
| End, ranked | The session took 1 rate and 4 writes and flushed them in **2 Supabase calls**: boards + fights + Career + the settle together, then telemetry about 8 s later. The client still makes submit-progression, the Storage replay, the profile write, perf_runs and the end-screen reads. |

Two-tab check (player Claudebot9 + spectator Claudebot5, a Practice game on the session):
- The directory lists it once with `live_host: 'session'`.
- The watch opens on the player's shop, and the player sees the watcher.
- A watched round stays in sync, and a late re-join lands on the current round.
- The end reaches the spectator with the placement, and the row leaves the directory.

## Verification

- `workers/versus/test/sessionCore.test.ts`: the rules (17).
- `workers/versus/test/sessionCf.db.test.ts` (PGlite):
  - the TS draw equals `pool_runs_sample_keys` on 108 seeded parameter sets, including an exact band edge;
  - md5 matches Postgres;
  - the mirror's boards are byte-identical to `pool_runs_boards`;
  - sync costs one call when unchanged and refetches only the changed run;
  - the flush is idempotent, owner-forced and grant-limited, a rejected write does not undo the others, the save and
    clear rules hold, and the settle runs after the writes.
- `workers/versus/test/it/session.it.ts` (real workerd): spectate + late join + chat + directory + end, the held saves,
  the one flush with the pinned table, a retried rate, the settle flush, and park.
- `packages/ui/src/session/session.test.ts`: the switch and per-game decision, the save routing and its fallback, the
  live socket target for player and watcher, and the outbox item.

## Cutover

See docs/versus-cf-cutover.md "The game session". In short:
1. Apply `supabase/migrations/2026-11-20-game-session-cf.sql`.
2. Run the pack. The hub deploys with the session OFF and keeps whatever it has.
3. Run `npm run hub:deploy -- --persist --session on`.
4. Watch the first games.
Rollback: `--session off`. Sessions already open keep flushing.
