# 2026-10-25 — Versus Duos (2v2 tag-team): the room and the in-game UI (phase 2 of 3)

Phase 1 (#2290) shipped the engine and the server. This phase makes Duos playable: the room, the in-game rail,
the tag-team hand-off on screen, passing a card with its own animation, and the full-screen teammate view. Owner
asks: "we need the viewing in real time for sure and it needs to be really high quality", "make sure passing a card
gets a bespoke animation that is different from a typical coalesce" (the lob, concept A), and "We need full screen
view for teammates, and there needs to be some animation/change somehow to distinguish viewing the teammates board
vs yours". Rules: GAME-RULES.md "Versus Duos" (On screen); oracle R-DUOS-VIEW-01 (approved/foundation.ts). No new
SQL: phase 1's tables and RPCs carry everything.

## What

- **Room.** The options panel gains "2v2" (exactly 4 seats). The room shows four seats under "Team 1" / "Team 2"
  plates (the existing hudpill name plate, no new chrome).
- **Projection.** `projectGroupView` / `projectGroupRounds` understand a Duos match: one fight per round, team-aware
  `won`, each seat's result is its own `duosMemberView`. The lobby rail puts your teammate first (s1) and reads each
  seat's board from `duosBoards`. `isDuosFight`, `duosLobbySeatId`.
- **Finalize + order.** `finalizeDuos` replaces `finalize_group` for a Duos match. A "You fight first" / "<Name>
  fights first" plate in recruit flips the order (`versus_duos_flip_order`) until the team locks.
- **Combat hand-off.** The `boardFallen` / `tagIn` events have choreo kinds (380 / 640 ms) and score cues. The
  replay folds `tagIn` into the frame (the side's row is replaced, its death and spell tallies reset), the stepping-in
  board flies in from the side (`.unit.tagin`, transform/opacity only, staggered), a "You step in" / "<Name> steps
  in" plate shows, and the enemy portrait follows whichever enemy board is fighting.
- **Passing.** Drag a hand or board card onto your teammate's portrait in the rail. While dragging, the portrait
  rings green (ok) or red with the reason ("Their hand is full", "You need 1 Gold", "Just passed to you", "Passing
  is closed"). A drop that passes plays the LOB (`passLob.ts`, Web Animations: an arc with a flip to the card back,
  your 1 Gold coin peels off the Gold pill and follows, the teammate portrait catches it with a pulse). A refused
  drop snaps back with the deny sound. The receiver sees the card arrive face down and turn over in hand.
- **Pass transport (restore-safe).** `duosPasses.ts`: after each run change the outbox ships through
  `versus_duos_pass` with a stable seq (`reconcile` maps outbox index to the server's seq on the first run after a
  reload, so a pass is never sent twice); the receiver pulls on the room's `versus_duos_passes` change, applies
  `receivePass`, answers `landed` / `refused`; the sender refunds a refusal (`passRefunded`). Your hand room is
  reported so the server refuses a pass to a full hand up front.
- **Teammate view.** Click your teammate's portrait (or hold Tab to peek) for a full-screen, real-time view of their
  shop: it reuses the spectate screen fed by their frames and cursor. To tell it apart from your own board: the whole
  stage turns (rotateY toward the rail, 160 ms each half, the content swaps at the hidden midpoint), their portrait
  and name take the hero slot, a team-tint vignette with a static ring frames the screen, your controls go inert, and
  a "Watching <Name>" plate with "Back to your board" sits on top. Esc or the button returns. It returns on its own
  when the shop ends or 5 s before the timer runs out. Your own run keeps running underneath
  (`ownRunWhileWatching`); store writers guard against the synthetic run.

## Verification

- `versusDuosView.test.ts` (projection, rail order, seat ids, team won, member views).
- Live on the real backend with Claudebot1-4 in four Chrome windows: room, hero select, 9 rounds to a team win
  (team A 7 hearts, placement 1/1; team B 2/2; XP 125/125/50/50), passes both ways landed and were played, the
  fly-in, the step-in plate and the foe portrait switch, the teammate view (screenshots).
- Swap perf (prod build, ~170 Hz display, 3 swaps): in p95 18-24 ms / p99 29-65 ms, out p95 17-28 / p99 45-61,
  8-12 dropped frames per swap. Long Animation Frames: one ~88 ms frame per swap, ~65 ms of it the whole-screen React
  re-render (spectate render in, restore out) plus ~16 ms style/layout. It lands at the turn's midpoint (8% opacity)
  so it reads as a hitch in the turn, not a visible stall. Not yet under the 160 fps bar; options in the PR.

## Open

- Phase 3: live edge cases (teammate disconnect, concede, double wipe, a full-hand race refund, reload restore of
  passes, spectating a Duos match).
- The swap re-render cost (above).
