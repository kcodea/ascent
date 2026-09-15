# Balance bot: the pinned lobby vs real set-2 player recordings (2026-09-15)

Owner: "we need it to run against real player snapshots to actually learn and improve. bot seats are terrible
and the data won't matter. use set 2 for now."

**Shipped** (branch `feat/balance-pinned` → `feat/balance-bot`):

- `npm run balance:corpus -- --set set2 --out set2-players-v1 [--patch 0.1.0+]` — every real (non-synthetic,
  non-empty, one-set) board from the shared Supabase `boards` table, paged with `Range` headers so nothing is
  truncated, into `packages/tools/src/balance/out/corpus/<name>.json` with an order-independent digest, a
  per-patch census and the run/author counts `playerRunsFrom` sees. Never committed.
- `ExperimentManifest.corpus { name, digest }` (additive) — a `pinnedLobby` job must name it; `balance:run`
  registers it first (a digest mismatch refuses), so it is both the seat fill and the pilot's `fightScore` panel.
- `packages/sim/src/balance/pinnedLobby.ts` — `runPinnedLobby`: the pilot in seat 0 of the SHIPPED eight-seat
  lobby (`createLobbyRun` → `createRunLobby`: seeded shuffle of the recorded runs, unique heroes), every round the
  shipped `faceOmen` (the paired recording's served board through `sideFromSnapshot`) → `resolveCombat` →
  `settleRunLobbyRound`. `playRecruitTurn` grew a `deferFight: false` option for that. The table is played out
  after the pilot falls so the population carries placements; a corpus that cannot fill seven distinct-hero
  seats censors the lobby rather than padding with bots.
- Report: tables + "likely problems" over pilot seats only; a "Recorded population" section (runs, authors,
  patches, heroes, recordings' vs pilot's placement).

**First measurement** (`set2-pinned-smoke`, 20 lobbies, generalist smoke budget): corpus 796 boards / 70 runs /
8 authors; 0 failures; the pilot placed **6.95 [6.55, 7.35]** — knocked out rounds 8–12 every lobby despite
winning 82 of 188 fights. The smoke-budget generalist is well below the recorded field. A pilot-competence
finding (B3/B4), not a balance signal; the trust-ledger row in `docs/balance-bot.md` says what a pinned
placement does and does not mean (recordings never adapt to a patch).
