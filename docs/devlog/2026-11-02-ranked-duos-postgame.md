# 2026-11-02 — Ranked Duos post-game: the solo ranked end screen, then back to the party

Owner (2026-11-02): "add a post game screen just like ranked solo's that shows your team's ranked progress/xp etc same
flow as solos"; "the continue then returns you to your duos party". Rule R-RANKED-DUOS-POSTGAME-01.

## What was there

A `DuosResultOverlay` (the solo `RankScreen` at z 500 over the party) already existed, opened from `returnToRoom` once
the team was placed. But:

- `returnToRoom` also set `statsOpen` for a finished group match, so the Versus **match stats** (`.mdd-scrim`, z 560)
  opened over it: what a player actually saw was the stats panel, not a results screen.
- An **unrated** table (any generated team) showed no result screen at all.
- The overlay had no **Account XP** panel: solo hands `RankScreen` an `extra` (`ProgressionPostgame`), Duos did not.
- XP for a Worker-hosted game races the Worker's result writer: the Ranked Duos match is written to Supabase once,
  whole, by the `ranked_finish` job, while the client submits `versus:<match>` progression the moment it hears the match
  is complete. A request that wins the race is refused `source_not_found` (409), which the queue treated as permanent.

## What changed (client only, no deploy)

- `returnToRoom` (ranked duos, my team placed): `statsOpen: false`, and `loadDuosResult(..., { unrated, team })` for
  rated AND unrated games. `duosResultTeam` builds the two live seats (p1/p2), me first, with my run's cosmetics and my
  teammate's room-profile cosmetics.
- `DuosResultOverlay`: team name + both portraits (`LbHeroFrame` big, in each owner's frame/skins through "Show opponent
  cosmetics") + names, then `RankScreen` (out of `RANKED_DUOS_TEAM_COUNT`, `unrated` → "Unrated · No recorded teams"),
  `extra` = `ProgressionPostgame localKey="versus:<match>"` (waits for the rank to settle, as solo), Match details →
  `setVersusStatsOpen(true)`, Continue → `closeDuosResult()` (the party room stays under it).
- `progressionQueue.versusResultLanding`: a `versus` item refused `source_not_found` / `not_terminal` within
  `VERSUS_SOURCE_GRACE_MS` (3 min) of finishing is retried with the usual backoff; the server dedupes by run id, so it
  still settles once. Past the window the refusal is final as before (bots, forced matches).

Game-over signal used: `returnToRoom()` with the match `complete` and my seat placed (reached through the end gate,
`playVersusEndGate` / `finishVersusMatch`). Nothing new is needed from `fix/ranked-duos-final-freeze` beyond reaching it.

## Verified

`rankedDuosPostgame.test.tsx` (screen + store), `progressionQueue.test.ts` (landing grace),
`versusCfParity.db.test.ts` (ranked_duos now ends `stats:0 … duosResult:shown`). Headless screenshots (rated, unrated,
phone landscape) in the builder's scratchpad.

## Open (not done here, needs an owner call)

- **Ranked Duos XP scale.** `settle_progression` (2026-10-25-versus-duos-xp.sql) counts TEAMS only for
  `options.mode = 'duos'`; a `ranked_duos` match has `seat_count` 2, so team 2nd / 3rd / 4th all map to lobby place 8
  (no Top half XP for 2nd), at the Versus 50%. Design Q10 said "XP per player by the matching solo places averaged".
  A one-line SQL fix (`in ('duos', 'ranked_duos')`) gives 2nd the Top half; the full Q10 rule is a bigger change.
- The XP breakdown says "Versus match complete" for a Ranked Duos game (the label is per progression mode).
