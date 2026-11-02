# 2026-11-02 · A finished game came back as Continue (the session's held clear)

Player report relayed by the owner (2026-11-02 ~09:27 local): "my game finished but then I didn't see my MMR go up in my
profile so I refreshed and now I'm on round 13 again" ... "it keeps looping. the game ended again and now it shows
CONTINUE Round 13". The owner has also seen "a game ends and the continue option is there". Branch
`fix/ranked-end-continue-loop`. Rule R-SESSION-CLEAR-01 (approved/persistence.ts).

## Evidence (live, read-only)

- Game `da4baf36-…` ended at round 13 (its board write key is `boards:…:13`), placement 1. `rank_results` has ONE row at
  14:25:56 UTC (+10): the rating settled once, through the session.
- `session_cf_writes` holds the run-end writes TWICE for that game: 14:26:05 (fights, boards, history, telemetry) and
  14:29:33 (boards under a new upload key, history, telemetry; the fight ledger deduped). The game was played to its end
  a second time, 3.5 minutes later, from the round-13 save.
- `saved_runs` had no row for the player afterwards (the row was removed in the end, after it had been adopted).

## Cause

A session game (ranked, casual or Practice since the hub session went on, R-SESSION-CF-01) sends the end's cloud-save
clear to its session, which answered 200 at once and HELD the clear for the end's 8 s settle. On the client the title's
reconcile (`checkAtTitle`) is queued on the same chain right behind that clear, so it ran inside the 8 s window, read the
row that was still there (written earlier by a Save & Quit / the session's quiet write, holding round 13) and, with the
local slot already cleared, decided `adopt`: Continue Round 13. Continue claimed the row (a new revision), the last fight
ended the game again, the clear was held again, and the title adopted it again. Off the session (the old path) the clear
was a direct Supabase call awaited before the reconcile, so this is new with the session and covers every session mode.

## Fix

- Hub (`workers/versus/src/session.ts`): the `clear` op flushes the clear alone (`flushClearNow`) BEFORE it answers. A
  failed flush answers 503, so the client clears the row the old way at once (the held clear also retries; a second
  revision-checked delete is a no-op). The writes keep their settle and still ride the rate.
- Client (`packages/ui/src/cloudSave.ts`): each device remembers the run keys that ended or were discarded on it
  (`ascent.cloudsave.ended`, last 20, kept apart from the lease the local clear drops). The title never adopts one of
  them: it clears that row instead and answers `none`. This also covers a row the client never learned the revision of
  (an end with lease revision 0 sends no clear). The run end passes its run key (`endRun(runKeyOf(next))`).

## Deploy / repair

- The client half fixes the loop on its own (Netlify pack). The hub half needs an `ascent-hub` deploy
  (`npm run hub:deploy -w @game/versus-cf`, session protocol unchanged) for the cross-device window.
- No data repair: the affected game's rating settled once and its row is gone. A device that still holds the adopted
  copy drops it at its next title (the cloud says the run ended: `discard-local`).
