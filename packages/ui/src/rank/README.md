# Medal rank — the store slice the post-game screen reads

Branch `feat/rank-rules-server` owns the **rules + server + submission** half of the medal ladder. This file is
the contract the presentation half (post-game screen, Title, Rankings, Career) wires against. Nothing here
computes a rank locally: the server's `settle_rank` transaction is the only authority and the client mirrors it.

## Rules + types (`@game/sim`, `packages/sim/src/rank.ts`)

```ts
import {
  RANK_RULES, RANK_SEASON, RANK_MEDALS,           // config: awards [40,28,16,6,-6,-16,-28,-40], gates 4 / 1, 100 pts
  rankLabel, medalOf, divisionTierOf, rankScalar, // "Gold II", 'Gold', 2 (II), 100*division+points
  compareRank, isPromotionReady, promotionKindAt, requiredFinishFor,
  resolveRank, settleRank,                        // the pure resolver (for previews / fixtures — never as authority)
  type RankPosition, type RankedProfile, type RankResult, type PromotionKind,
} from '@game/sim';
```

- 18 divisions, index `0` = Bronze III … `17` = Ascendant I; order within a medal is **III → II → I**.
- `RankResult` (blueprint §4 plus `promotionKind: 'division' | 'medal' | null`, `requiredFinish: 4 | 1 | null`,
  `highestAfter`) is what the screen animates. `appliedDelta` is **the number to show** — it is `0` on a won
  promotion (0/100 in the new division) and on a held medal gate (2nd–4th at Gold I 100 stays at 100).
  `cappedPoints` is what the base award lost to the cap / floor / hold.
- `rankLabel` is the ONE index→label mapping; do not hand-roll medal names anywhere else.

## Store slice (`useGame`)

```ts
profile.rank: RankedProfile            // authoritative mirror: seasonId, rulesVersion, revision, position, highest
profile.rating: number                 // = rankScalar(profile.rank.position) — legacy numeric surfaces keep reading it
rankRunId: string | null               // the ranked identity of the run the slice describes (null before any finish)
rankResult: RankResult | null          // the SERVER-confirmed result of that run; null until 'confirmed'
rankSubmission: 'pending' | 'confirmed' | 'retryable' | 'unrated' | 'rejected'
rankSubmissionError: string | null     // short code behind retryable / rejected / unrated (e.g. 'timeout', 'unsupported_rules', 'no_account')
retryRankSubmission(): void            // re-send a 'retryable' (or still 'pending') result now
lastRating: RatingChange | null        // LEGACY projection of rankResult (scalar before/after + appliedDelta) — the old EndScreen still reads it
```

State machine for the run that just finished (`rankRunId` set):

| `rankSubmission` | when                                                                 | screen shows (blueprint §7)                    |
| ---------------- | -------------------------------------------------------------------- | ---------------------------------------------- |
| `pending`        | request persisted + in flight                                        | placement + current crest, "Updating rank…"    |
| `confirmed`      | server answered; `rankResult` set; `profile.rank` adopted            | animate `rankResult` once per `rankRunId`      |
| `retryable`      | offline / timeout / 5xx / 429 / no session yet; request kept on disk | "Rank update pending", Retry + Continue        |
| `unrated`        | practice / tutorial / sandbox / no backend / no account at finish    | "Unrated", no movement                         |
| `rejected`       | server refused permanently (bad input, unsupported season/rules)     | truthful error + `rankSubmissionError`         |

Rules of the road for the screen:

- Key your "celebration consumed" marker on `rankRunId` (persist it yourself if you need it across reload).
  Remounting, Rewatch, a reload, or a duplicate server answer must not replay the animation.
- Never call the resolver as a mutation. `resolveRank` / `settleRank` are for fixture previews only.
- `profile.rank` may update WITHOUT `rankResult` changing (a late older result from the queue; a boot sync).
  Read `rankResult` for the animation, `profile.rank` for the current standing.
- Reload with a pending result: the queue resubmits on boot; `rankSubmission` starts `'unrated'` with
  `rankRunId` null on a fresh boot, so a screen that needs to resume "pending" across reload should persist
  the run id and read `pendingRankFor(runId)` from `packages/ui/src/rank/rankSubmission.ts`.

## Leaderboard rows (`fetchTopPlayers`)

`PlayerRow.rank?: RankedProfile` is present when the backend has the rank columns (post-migration); rows are
already ordered division-desc, points-desc, games-desc. Fall back to the scalar `rating` when `rank` is absent.

## What never submits

Practice, tutorial, sandbox, and non-lobby modes: the run-end block in `store.ts` only calls
`beginRankSubmission` for `mode === 'lobby'` runs that carry a placement.
