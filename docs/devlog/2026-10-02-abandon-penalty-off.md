# 2026-10-02 — The abandon penalty is switched off (R-RANK-05)

**Owner report:** "for some reason my mmr stayed flat from this win, not sure why."

## What happened

The owner's Career showed 210 MMR (Bronze III 10/100) on the Seasonal Ranked crest, but 250 at the end of the
MMR trend chart. That was after three Ranked 1sts in a row (Bram, Brackus, Keshi).

His read-only `rank_results` query showed all three wins counted (+40 each, 10 to 50). After each one,
though, a DIFFERENT, freshly started run was settled as an 8th (-40, back to 10). The settled runs were
seeds 936637584, 2083664383 and 821927613.

Each time he had started a new game and left it. The R-RANK-05 abandon penalty (2026-09-29, `settleAbandonedRun`)
settled the left game at the lowest open place, which is 8th with nobody out.

The chart said 250 because an abandon writes no Career row, so the chart's last point is the last stamped win.
The crest reads the live profile. Both numbers were right about what they read.

An earlier theory (a cloud copy of a live run abandoned on another origin, deduping the real win) was wrong. The
data ruled it out.

## Owner ruling

> "oh i didnt know there was an abandon penalty in. can we remove that for now?"

## What changed

- **The switch:** `ABANDON_PENALTY_ENABLED = false` in `packages/ui/src/rank/ratedRun.ts`. `rankedAbandonOf`
  answers null while it is off, so `store.settleAbandonedRun` queues nothing from every door that gives up the
  save: title Clear, `pickHero` (Play, Practice, Gauntlet), `newRun`, `startTutorial`, and `adoptCloudRun`
  replacing a different run. The title tips lose their "counts as finishing Nth" line through the same gate.
- **Kept, not removed:** the callers, `abandonPlacementOf` and the old tests (`quitCostsRating.test.ts` now forces
  the switch on through a mock). Flip the one constant to restore the penalty.
- **The queue:** every rank request is now tagged on the client, `kind: 'finish' | 'abandon'`. The tag is never
  sent. `flushPendingRanks` drops an `abandon` item while the switch is off (`isDroppedAbandon`).
- **Limit:** an UNTAGGED item queued by an older build looks exactly like a finish and is still sent. Abandons
  flush immediately, so one only lingers if it was queued offline. A heuristic, such as "no Career row for the
  seed", would also drop a genuine finish made offline, so none was added.

## Server

There is no server change. `submit-rating` and `settle_rank` have no abandon path: they settle whatever
placement a client sends. The client change fully stops abandon settlements for players on the new build. Old
clients keep charging abandons until the build is deployed (Netlify upload). The three 8ths already settled stay
in the ledger; refunding them would be a manual SQL decision for the owner.

## Follow-up (not done, owner to decide)

The MMR trend chart ends on the last stamped run, so any settlement without a Career row leaves it disagreeing
with the crest. The proposal is to end the chart on the live rating.

Oracle: R-RANK-05 rewritten as the switched-off rule. Tests: `abandonPenaltyOff.test.ts`, `rankSubmission.test.ts`.
