# 2026-10-24: Versus XP at half a game, spectator XP, and the spectator's end gate

Owner (verbatim): "versus modes should grant account xp. just make it 50% of a 'normal' game for now
also add this for spectating - watching a player's game rewards 50% of the xp at the end of the match.
* with those, make the end-match cleaner for a spectator. when the game ends for the player, have the gates shut for the
spectator and open up at the play menu with the same 'X player came in 1st' or w/e it shows."

Rules: R-PROG-VERSUS-XP-01, R-PROG-SPECTATE-XP-01, R-SPECTATE-END-01, R-PROG-QUEUE-MODES-01 (bug fix);
R-VERSUS-RANK-01 updated. Branch `feat/versus-spectator-xp`.

## What shipped

- **Versus XP = half the equivalent lobby game.** A Versus finish is put on the lobby's scale by the share of the table
  it holds (`versusLobbyPlacement`): winner 1st, any other place p of n is ceil(p x 8 / n). Then 50% of the Ranked XP
  for that placement, summed and rounded like Practice, no comeback. 1v1: 125 / 50. Group of 4: 125 / 80 / 50 / 50.
  Group of 3: 125 / 50 / 50. No winner: 50. Replaces 2026-10-14's flat 100 (+60 winner). The ledger stores the
  lobby-scale placement for new Versus rows. Aether unchanged (versusComplete + versusWin at 1st).
- **Versus Group settles** (`versus:<group match id>`, the same `versus` mode; the SQL looks in `versus_matches` first,
  then `versus_group_matches`). The seat's own placement once final, so a player knocked out early settles at once; it
  must have fought a round (a committed round before it went out, or the round that took its last heart).
- **Spectator XP**, a new progression mode `spectate` (run id `watch:<lobby|versus|group>:<game>`): 50 XP, no Aether,
  no achievements. Evidence is server-side only: `spectate_beat` (called by the open watch screen every 10 s) accrues
  watched time between beats at most 45 s apart on the ONE game the account beat last (`spectate_presence`), into
  `spectate_sessions`. Settle needs: game over (live ranked: a beat saw its listing at `end` AND the player's
  `rank_results` row exists, `not_yet` = 503 retried for 2 hours; Versus: match complete with a round), present at the
  end (last beat no earlier than 45 s before the end), watched >= min(5 min, half the game), and never your own game
  or a match you held a seat in.
- **The spectator's end.** `live/spectatorEnd.ts` `endWatchedGame`: last beat, queue the settlement, then the game's
  end gate (`requestRankedGate(..., 'end')`). Behind the doors the watch screen is left; the doors open on the menu with
  `SpectatorEndNotice` (the end screen numeral, "<name> finished the game.", `ProgressionPostgame` for the watch
  settlement, Continue). Live ranked game: Play menu (`titleView: 'modes'`). Versus: the last fight plays out first
  (the store's `combatReplayDone` + the strike, capped at 60 s), then the room.
- **Bug fixed: the progression queue dropped every Versus settlement.** `isPending` accepted only ranked / practice /
  tutorial, so a queued Versus item vanished on its first read (`pendingProgressions` filters through it). Versus XP
  had therefore never reached the server since 2026-10-14. Now any `PROGRESSION_MODES` mode survives.
- `breakdownLines`: Versus reads "Versus match complete / Top half / Win"; spectate "Watched to the end".

## Readings for the owner (judgement calls)

1. **"Equivalent" result:** the same share of the table (above). Alternatives: 1v1 loser as 2nd (80 XP), or top half =
   Top 4 for 3 players too. Easy to retune in `versusLobbyPlacement` + the SQL mapping line.
2. **Spectator base** = 50% of a game's completion XP (50), not of the watched player's result.
3. **Eligibility:** present at the end + at least half the game, 5 minutes always enough; 45 s continuity; one game at
   a time. No daily cap (the system has none; only the 30 settlements / 10 min technical rate limit applies).
4. **Group spectating ends at the match end**, not at the watched player's elimination (a group spectator can switch
   to another seat; the phase 2 UI calls `endWatchedGame` with kind `group`).
5. **Versus spectators reopen on the room** (the Versus view of the Play menu) rather than the mode home: they are
   still room members, and leaving the room would drop their place in the stands. A live ranked game opens on the
   mode home.
6. The Versus test bot is a real anonymous account: a match against it counts like any other (dev/test builds only).
7. A Versus player still sees no XP panel at the match end (the end gate opens on the room; the XP lands in the
   profile and the level). Not in this change.

## Apply / deploy (lead, in order)

1. SQL: `supabase/migrations/2026-10-24-versus-spectator-xp.sql` (after 2026-10-24-versus-group.sql and the lobby-live
   files; also appended to schema.sql).
2. `npx supabase functions deploy submit-progression` (the `_shared/progressionRules.ts` / `progressionServer.ts`
   copies are regenerated in this PR). Between 1 and 2 the old function refuses `spectate` as `bad_mode` and flags
   Versus parity false (logs only).
3. Netlify / client build whenever (an old client simply never beats or settles spectate).

## For phase 2 (Versus Group UI)

- A group player settles with `beginRunProgression('versus:<id>', facts)` once its seat placement is final.
- A group spectator: `startSpectatorBeat('group', matchId)` while the watch screen is open, `stopSpectatorBeat()` on
  leave, `endWatchedGame({ kind: 'group', ... })` at the match end.
