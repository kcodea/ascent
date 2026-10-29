# 2026-10-29 — Duos match history (Recent Games > Duos)

Owner ask: "we're going to want to start capturing duo's match history as well". Rule: R-DUOS-HISTORY-01.

**What.** Every finished Ranked Duos and Versus Duos game is recorded once, at the source, in `duos_match_history` (one
row per match: `players uuid[]`, `mode`, `rank` (the live team's `duos_rank_results` change), and a compact `record`).
Recent Games gets a third tab, DUOS, listing YOUR Duos games (RLS: a player reads only games they were in, so the tab is
personal, not the global feed): team placement banded by the team table, team name or mode, your hero with your
teammate, rank + points for a rated game. The detail card (shared `GameCard` in its detail layout) shows your board and
your teammate's, and the lobby grouped by team (place, name, Out R# / Still in / Winner) with the lobby picker's tiles;
picking a player shows their board until Back to yours.

**How.** The record shape (`DuosHistoryRecord`, `packages/sim/src/versus/duosHistory.ts`, a pure module the Worker imports
through the new `@game/sim/versus/duosHistory` subpath) holds per team: placement, outRound, name, kind
(live / duo / pair / generated), and per member: seat, userId (live players only), name, heroId, and the board it last
fought with (card-render fields only, no text, no buffs; capped at 24 KB, recorded boards emptied first). The Cloudflare
room builds it from memory at the end: Versus Duos in `GroupEngine.complete()` (rides the final `group_match` row as
`history`), Ranked Duos in `RankedEngine.finishRow()` (`ranked_finish.history`, built BEFORE `fitFinishRow` so a trimmed
recording never empties it). `versus_cf_persist` stores it through `duos_history__store` (after the rating settle; any
failure is caught so it can never roll back the result). The migration also backfills from the Supabase-hosted tables
(`duos_history__build`: last final submission per live seat, recordings via a SQL port of `memberBoard`), re-runnable.

**Data size.** ~4-6 KB per game (8 boards); the 114 games on the live DB at build time are well under 1 MB.

**Noticed, not fixed.** `RankedEngine.finishRow`'s `liveSubmissions()` reads only folded rounds, so the round that
placed the live team (still in `g.subs`) is missing from the duo run's recorded rounds. The history record reads the
current sub directly, so it is unaffected.
