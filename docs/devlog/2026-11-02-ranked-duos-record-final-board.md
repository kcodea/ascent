# 2026-11-02 — Ranked Duos records its deciding round (R-RANKED-DUOS-RECORD-01)

**Owner ruling (via the lead):** Ranked Duos records must be 1:1 with ranked solo. Solo records a board for every
round it fought; the Cloudflare duo record lacked the last one.

**Cause.** The Cloudflare Ranked room (`workers/versus/src/core/rankedMatch.ts`) kept each round's live boards in
`g.history` through `foldSub`, which only ran when the NEXT shop opened (`GroupEngine.openShop`). The round that placed
the team goes straight from `commitRanked` to `placeTeam` and the `ranked_finish` job, with no next shop, so its two
final submissions never reached `submissions` -> `versus_group_submissions` -> `versus_ranked_duos__record_run`. The
Supabase-hosted build wrote submissions as they resolved, so it never had the gap.

**Live confirmation (read-only).** Every Cloudflare ranked_duos game (4 of 4) recorded `duo_runs.last_round =
match round - 1` and one fewer `duo_run_rounds`; every Supabase-hosted one matched its round. A served duo then fielded
its N-1 board in round N (`memberBoard` serves the last recorded round past the end), and a team out in round 4 counted 3
rounds and was ineligible (`v_count >= 4`).

**Fix.** `commitRanked` now keeps both live seats' final boards the moment a round commits (`keepRoundBoards`, dirtying
`rhist:<round>` so a restored room has them too); `foldSub` dedupes per round + seat, so the later fold is a no-op;
`liveSubmissions` returns committed rounds only, sorted. A round that never resolved (pair left mid-shop) is not
recorded, matching solo. The DEV-only room `/metrics` now summarises each written `ranked_finish` (rounds +
submissions) so the workerd test can see the write with persistence off.

**Compared vs solo / the Supabase build** (live rows + code): per-round boards (the gap, fixed); runes / equipment /
hero state (carried whole in `prepared_side`, same object both builds store: OK); served opponent pins
(`versus_ranked_duos_served` recordings, none trimmed live: OK; `fitFinishRow` may trim them for a >1.5 MB row, which is
archive-only and already documented under R-VERSUS-CF-PERSIST-01); placement / seats / teams (same shape as the Supabase
rows, incl. still-standing teams left unplaced); fight ledger (`versus_ranked_duos_fights`: all fights, every live fight
with its `live_result`: OK); per-round `first` order (every round, incl. the last: OK); duos history record (built from
the in-memory subs, already had the last board: OK).

**Verified.** `rankedCore.test.ts` (played to the end: every round x both seats, the exact boards; mid-shop leave
records only fought rounds) and a workerd test in `test/it/room.it.ts` (a real Ranked Duos party to completion, the
written job carries 1..N). Both fail on main with the final round's two rows missing.

**Ops.** Redeploy the Versus Worker (`npm run versus:cf:deploy`); no hub deploy, no migration, no versus-resolve.
Rooms already playing on the old pack keep the old behaviour. The 3 eligible Cloudflare duo runs recorded before the
fix cannot be completed exactly (the fight logs carry the minions but not the full prepared side); the PR proposes SQL
to mark them ineligible.
