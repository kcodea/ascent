# 2026-09-20 — Medal rank: rules, server settlement, submission (season 3)

The rules + server + submission half of the medal ladder (owner blueprint 2026-09-20, sections 1–6, 8–11).
The post-game screen / Title / Rankings / Career presentation is a separate branch that wires against the
store slice documented in `packages/ui/src/rank/README.md`.

## Owner decisions implemented (override the blueprint's defaults)

- Bronze / Silver / Gold / Platinum / Diamond / Ascendant, three divisions each, **III → II → I**, 18 divisions
  of 100 points. Awards 1st +40 … 8th −40 (the blueprint table, no round-wins modifier).
- A **division** promotion game (Gold III → II) needs a **top-4**; a **medal** promotion game (Gold I →
  Platinum III) needs **1st**. A won gate lands at **0/100** in the next division (not the award). A lost
  gate applies the normal negative award from 100. **At a medal gate a 2nd–4th neither promotes nor gains:
  hold at 100, still promotion-ready** (`appliedDelta` 0, the award reported in `cappedPoints`).
- Below 0 inside a medal demotes one division to `100 + result`; Bronze III floors at 0; Ascendant I uncapped.
- **Demotion gate (owner addition, same day; ruling refined the same evening):** a LOSS at a medal's lowest
  division that lands on 0 clamps there and ARMS a **stored** `demotionReady` flag on the position (never
  derived from merely standing at 0 — a fresh medal promotion at 0/100 is NOT armed; its first loss arms, the
  second demotes). While armed, the next rated game is a demotion game: bottom-4 demotes to the previous
  medal's I at **`100 + award`** (the mirror of the promotion landing — 8th → Silver I 60; chosen as the
  owner suggested), top-4 escapes with its award from 0 and disarms. Any non-negative result disarms.
  `RankPosition.demotionReady` (stored; `profiles.rank_demotion_ready`, `rank_results.demotion_ready_before /
  _after`, emitted in the profile + result JSON), `RankResult.wasDemotionGame` + `demotionUnlocked`,
  `isDemotionReady` / `hasDemotionGate` helpers; `isRankPosition` rejects an armed flag anywhere but 0 on a
  medal floor.
- New season: everyone starts Bronze III 0/100 — prepared as migration SQL + `docs/rank-season-runbook.md`;
  **nothing was run against production**.
- A pending result never blocks a new ranked run; results settle in accepted order and a late older answer
  never rolls a newer profile back (revision compare).

## What shipped

**`packages/sim/src/rank.ts`** (new, exported from `@game/sim`) — `RANK_RULES` (one config object),
`RankPosition` / `RankedProfile` / `RankResult` (+ `promotionKind`, `requiredFinish`, `highestAfter`),
`resolveRank` (pure), `settleRank` (adds run/season/revision/highest), `rankLabel`, `medalOf`,
`divisionTierOf`, `compareRank`, `rankScalar`, `isPromotionReady`, parsers. `PlayerProfile.rank` is the
authoritative mirror; `profile.rating` = `100 × division + points` so the numeric surfaces keep working.
`CURRENT_SEASON` → 3 (the local mirror resets on boot, matching the server reset).

**Server** — `supabase/migrations/2026-09-20-medal-rank.sql` (also appended to `schema.sql`): rank columns +
check constraints on `profiles`, the `rank_results` ledger (own-rows readable, no client writes), RLS that
pins `rating` and every `rank_*` column on INSERT (placeholder only) and UPDATE (unchanged), the legacy
`submit_own_rating` dropped, and **`settle_rank`** — a service-role-only plpgsql transaction: lock profile →
ledger check under the lock (duplicate returns the ORIGINAL result) → rate limit (raise = nothing committed)
→ resolve → write profile + revision + result → best-effort stamp of the result onto the matching
`run_history` row (by seed) → return result + profile. `supabase/functions/submit-rating/index.ts` validates
placement 1–8, season, rules version and run id, calls the RPC, re-derives the outcome from
`_shared/lobbyRating.ts` and flags `parity: false` if the SQL ever disagrees.

**Client** — `remoteBoards.submitRating` returns a typed `confirmed | retryable | rejected` (no numeric
fallback; an old function's `{rating, delta}` reply is `rejected · server_outdated`). `fetchRankedProfile`
reads the rank columns (three-way: couldn't-ask / no-row / profile). `packages/ui/src/rank/rankSubmission.ts`
is the durable, **account-bound** pending queue (`ascent.rankqueue`, distinct from the generic upload queue
that marks things unrated): persisted before the send, retried on boot / identity / `online` /
`retryRankSubmission()`, oldest-first, stops at the first retryable failure, never cross-submits another
account's item. Store slice: `rankResult`, `rankSubmission`, `rankSubmissionError`, `rankRunId`,
`retryRankSubmission`, `profile.rank`. Rank settlement is independent of history upload / Career fetch
(`uploadPlayerProfile` writes display columns only). Rated lobbies mint a persisted `runId` UUID at creation
(`RunState.runId`, travels with the save); older saves keep `String(seed)`. Practice / tutorial / sandbox
never reach the path. `lastRating` and the replay's `ratingDelta` are projected from the confirmed result
so the not-yet-medal-aware surfaces show the applied delta; `ReplayV2.result.rank` and
`RunHistoryEntry.rank` carry the immutable result (optional; old recordings unchanged).

## Verification

- `packages/sim/src/rank.test.ts` — every blueprint §3 fixture row under the owner rules (+ the explicit
  medal-gate 2nd–4th rule), every boundary (each division's gate, each demotion, the floor, the uncapped
  top), monotonicity by `compareRank`, no same-game / multi-division promotion, highest never decreases.
- `packages/ui/src/lobbyRatingParity.test.ts` — imports the Edge Function's shared TS module and drives
  ~1,700 transitions through both resolvers; reads the SQL's constants out of the migration text; checks
  `schema.sql` carries the identical `settle_rank` body and that the JSON emits every parsed key.
- `packages/ui/src/rank/rankSubmission.test.ts` — dedupe on retry returns the original once; 409 →
  rejected; transport/5xx/429 → retryable and kept; old-function reply → rejected; account binding.
- `serverProfileSync.test.ts` — adopt / refuse-older / reset-on-null / different-season-adopts.
- `docbot/lobbyProperties.test.ts` — rank monotonicity + gate properties over the real lobby loop.
- Gate: typecheck, lint, test, build:web; `npm run lobby`, `lobby:snapshots`, `replay`.
- **Not validated locally:** the Deno function (no `deno`/`supabase` CLI here) and the plpgsql body against a
  real Postgres. Both are covered by the runbook's step-4 smoke test and the function's runtime parity flag.

## Follow-ups

- Presentation branch: the animated post-game screen, Title chip, Rankings + Career on `profile.rank`.
- `Career.tsx` can join `rank_results` (own rows readable) for entries whose history row was inserted after
  the settlement stamped it (a rare race); the ledger is the truth either way.
- Server-issued ranked-run admission (strict single-active-run) remains a future strengthening.
