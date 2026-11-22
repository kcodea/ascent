# 2026-11-22 · An ended ranked game came back as "Saved match, Round 14" (the session's unsent clear)

Owner report: "this bug is back". The title showed SAVED MATCH, Ranked, Round 14, CONTINUE for a match that had already
ended. Branch `fix/stale-saved-match`. Rule R-SESSION-CLEAR-02 (approved/persistence.ts). Follows R-SESSION-CLEAR-01
(2026-11-02, `2026-11-02-ended-game-continue-loop.md`).

## Cause

A session game (ranked, casual, Practice: R-SESSION-CF-01) sends its per-shop save to its game session on the hub. The
session holds it and answers with the row's revision as it stands (`sessionCore.save` returns `base`), which it never
bumps. For a game the session never wrote to Supabase that is 0, so the client's lease is revision 0 for the whole game.

At the end, `cloudSave.endRun` returned early on `lease.revision === 0` (meant as "never uploaded, no row to clear"), so
no clear reached the session. The session still held the last shop's save (round 14), dirty. When the game ended the
live publisher stopped, so `publisherGoneAt` was set, and `SESSION_QUIET_MS` (60 s) later the alarm wrote that save to
`saved_runs`: a fresh row, revision 1, for a game that was over. (A `rate` landing after the quiet minute carried it in
the same flush.)

The device that played the game was mostly spared by R-SESSION-CLEAR-01's list of ended games (`ascent.cloudsave.ended`),
which makes its title clear such a row instead of adopting it. Any other device or browser profile (the desktop app
and a browser are separate storage) has no such list, so its title adopted the row: "Saved match, Round 14".

## Fix

- Client (`cloudSave.ts` `endRun`): a run held by a game session (`heldBySession`, wired in `store.ts` to
  `sessionGameForRunKey`) always sends its clear, lease 0 or not. A lease of 0 off the session still sends nothing.
- Hub (`sessionCore.ts`): once a game has ended (`finishedAt`, set by its clear or its rating) the held save is never
  written: `rate` marks it clean, `saveDue` refuses it, and `settled` / `nextAt` no longer count it (no alarm for it).
- Defensive (`store.ts` `isResumableRun`): a lobby save whose own seat is out or placed, or whose table finished, is
  never resumable, so it is dropped at boot and refused on adopt like a `gameover` save.

## Deploy / repair

- The client half stops new rows on its own (exe / build). The hub half needs `npm run hub:deploy` for old clients.
- A row already written for an ended game is still offered once. The trash button removes it, and the rank server
  settles a run id once, so it is not counted twice.
