# 2026-09-23 — Hall of Champions: the own-game line reads the fight ledger

**Owner ruling (2026-09-22).** Asked why a Hall row read `12–2–1` on its RECORD line and `13–2–1` on its
"Own game" line ("why is the record 12-2-1 but also 13-2-1? what's right?"), the owner answered: "ledger number
probably i think." The two lines had two definitions: the record read the `run_fight_records` view (every fight
against a live opponent; ghost fights are never ledger rows), the own game read the run's career row
(`run_history.entry.wins/losses/draws`), which counts the player's ghost fights (the odd seat paired against an
eliminated seat's leftover board). The extra win was a ghost win.

**The fix.** The own game is now the ledger too: the `lobby_fights` rows of the run's OWN lobby (`lobby_seed` =
the run's seed) that name the run as `run_a` or `run_b`, counted from the run's side (`ownGameRecordsOf` in
`leaderboardData.ts`, pure). ONE batched read for the ten rows (`fetchHallOwnGames` in `remoteBoards.ts`:
`lobby_fights?select=lobby_seed,run_a,run_b,outcome&lobby_seed=in.(...)`, capped at `FETCH_LIMIT`), filtered
by key client-side, fired beside the `run_history` read. No new SQL for the owner: the Hall is now the one
place the client reads ledger ROWS instead of the view, because the view has no per-lobby cut and ten lobbies
are a few hundred small rows at most.

**Fallback, labelled.** A lobby the ledger has no rows for (a game from before the ledger existed) still reads
its career tally, and the row carries `ownSource: 'tally'`; the `.lb-hallown` aria-label then ends with
"from the game's own tally", so the two definitions are never mixed silently. The record line, the sorts and
the layout are untouched.

**Known limit.** A run served as a snapshot inside another lobby that happens to share its seed would count
those rows as its own game too (the rows are cut by lobby seed + key only). Rare, and the same rows count in
the record line, so the two lines still agree.

**Oracle.** `R-HALL-02` (approved, evidence the two owner quotes; scenario `packages/ui/src/hallOwnGame.test.ts`
+ `fightLedgerFetch.test.ts`); `R-HALL-01`'s own-game clause now points at it. Rule counts in
`docs/docbot2/final-report.md`: 180 rules, 94 approved. Patch note (Systems, 2026-09-23) prepended.
