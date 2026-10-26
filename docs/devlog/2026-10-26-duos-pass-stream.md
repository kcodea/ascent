# 2026-10-26 — Duos: the pass is a magic stream, the teammate portrait mirrors yours, no "steps in" plate

Owner asks (2026-10-25 / 26), one PR (`feat/duos-pass-9`):

- **"can you make the teammate portrait as large as the player's and make sure it's wired to show their custom frame
  as well if they have one"** (R-DUOS-VIEW-03). `DuosMateDock` measures your own hero disc once (mount + resize,
  `mirrorOfHero`, pure) and takes the same diameter, the same distance in from the right edge and the same height. It
  wears the teammate's equipped frame through `usePortraitFrame('self', frameIdOf(their skins), 'socket')`, read from the
  room members' cosmetics (the source the rail and seat cards already use, never `profiles`), and carries the hero
  panel's own name pill and Hearts box (the team's hearts). `healthPills.css` / `styles.css` give `.duosdock-hp` the same
  rules as `.statusbar .hero .hpbox`.
- **"make it look more like magic/pixi stream and then a coalesce in hand ... when a card is dropped into the teammates
  portrait to pass, have it coalesce and turn into a stream that enters the hero portrait and plays a simple little
  effect over the portrait"** (R-DUOS-PASS-05, R-DUOS-PASS-02). This replaced the flip/arc rework I had first built for
  "it's a 3/10 and we need a 9/10". Send: the card fades in place while its plate dissolves (`plateDissolve`, built on
  the next frame), and the new `duos-pass-send` def (authored from the triple's `gild-trail`, recoloured teal) streams
  into the portrait with a burst and a ripple there; the portrait pops; the coin follows. Arrive: `duos-pass-arrive`
  streams out of the portrait to the hand slot and the card coalesces there (`plateCoalesce`), hidden until then; the
  hand's generic generated-card coalesce stands down for it (`isPassArrival`). Both defs are pre-warmed (one invisible,
  silent play) when the portrait mounts. The ✈ Duos Pass dev tuner has the timings, stream speeds and colours.
- **"for duos - dont show the 'xyz swoops in' ... just have the current portrait of the player side or opponent side
  swap to the player who's board is live"** (R-DUOS-SLOTS-01). `DuosTagInPlate` and its CSS are gone; the hero slots
  already followed the live board, and now key their art by the live player so the new face fades in (`.duosswap`,
  opacity + the `scale` property, one-shot). The board fly-in stays. Spectators use the same screens.
- **`profiles.avatar` refusals.** The live backend grants SELECT on every `profiles` column except `avatar` and `email`,
  so every avatar-first read (Versus seat cards on each room refresh, the leaderboard, a Career, the once-a-session
  backfill) logged a 42501 and fell back, call after call. `remoteBoards.canReadProfileAvatar` / `noteProfileAvatarRead`
  remember the first refusal for the session and the reads skip the column after it. None of this was new on this
  branch; it surfaced in the owner's Postgres log during the capture runs (many test rooms).

## Measured (prod bench build, headless Chrome with the RTX GPU, 240 Hz rAF)

- Send: one frame of 25 ms at the release itself (the pass's commit: the card leaving the hand and the drag ending); a
  normal card PLAY from hand measured 29 ms and 21 ms frames on the same rig, so this is the game's baseline release
  cost, not the stream. The rest of the pass: p95 4.3-8.3 ms, nothing over 8.5 ms.
- Arrive: p95 4.3 ms, max 8.4 ms, no frame over 16.7 ms.
- Strips: real-time screencast frames picked every 16.7 ms (`scratchpad/duos-pass9`). Virtual-time capture was tried and
  dropped: compositor animations and Pixi run on real time there, so the strips were wrong.

## Follow-ups

- The teammate's custom frame was checked by test only: the Claudebot test accounts have no frame equipped.
- The release frame (25-29 ms) is worth its own perf pass across every hand release, not just the pass.
