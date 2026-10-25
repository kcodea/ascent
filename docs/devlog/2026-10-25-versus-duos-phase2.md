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
- **The teammate portrait, bottom right** (owner direction 2026-10-25, replacing the first rail-portrait pass + lob):
  `DuosMateDock`, the mirror of your own hero bottom left in the game's round portrait disc. On your board it is your
  teammate: click to watch them, drag a card onto it to pass. While watching it is YOU: click to come back.
- **Passing.** While a drag hovers the teammate portrait it glows teal (a static shadow whose opacity breathes, the
  `kwglow` pattern) or shows a red ring with the reason ("Their hand is full", "You need 1 Gold", "Just passed to you",
  "Passing is closed"). A pass DROPS into the portrait (`passLob.playDrop`: a small hop, then it sinks into the disc,
  turning face down, your 1 Gold coin following it in; the portrait pops). The receiver's card comes OUT of the sender's
  portrait (bottom right on their screen) and flies into their hand, landing face up (`playEmerge`). Transform /
  opacity only, one-shot. A refused drop snaps back with the deny sound.
- **Pass transport (restore-safe).** `duosPasses.ts`: after each run change the outbox ships through
  `versus_duos_pass` with a stable seq (`reconcile` maps outbox index to the server's seq on the first run after a
  reload, so a pass is never sent twice); the receiver pulls on the room's `versus_duos_passes` change, applies
  `receivePass`, answers `landed` / `refused`; the sender refunds a refusal (`passRefunded`). Your hand room is
  reported so the server refuses a pass to a full hand up front.
- **Teammate view.** Click your teammate's portrait (bottom right, or their rail row, or hold Tab to peek) for a full-screen, real-time view of their
  shop: it reuses the spectate screen fed by their frames and cursor. To tell it apart from your own board: the whole
  stage turns (rotateY toward the rail, 160 ms each half, the content swaps at the hidden midpoint), their portrait
  and name take the hero slot, a team-tint vignette with a static ring frames the screen, your controls go inert, your portrait
  takes the bottom-right slot (click it to come back), and a "Watching <Name>" plate with "Back to your board" sits
  beside the clock. Esc or the button returns. It returns on its own
  when the shop ends or 5 s before the timer runs out. Your own run keeps running underneath
  (`ownRunWhileWatching`); store writers guard against the synthetic run.

- **Lead rulings folded in.** The rail keeps team rows together (`groupDuosRailRows`); both hero slots follow the
  board on their side (`duosCombatAt`, R-DUOS-SLOTS-01: my slot shows my teammate while their board fights for us); a
  knocked-out player never sees their own Spectating chip (R-SPECTATE-WATCHERS-02, group and Duos); the team frame is
  strong enough to read on the purple stage.

## Verification

- `versusDuosView.test.ts` (projection, rail order, seat ids, team won, member views).
- Live on the real backend with Claudebot1-4 in four Chrome windows: room, hero select, 9 rounds to a team win
  (team A 7 hearts, placement 1/1; team B 2/2; XP 125/125/50/50), passes both ways landed and were played, the
  fly-in, the step-in plate and the foe portrait switch, the teammate view (screenshots).
- Swap perf (prod build, ~170 Hz display, 3 swaps): in p95 18-24 ms / p99 29-65 ms, out p95 17-28 / p99 45-61,
  8-12 dropped frames per swap. Long Animation Frames: one ~88 ms frame per swap, ~65 ms of it the whole-screen React
  re-render (spectate render in, restore out) plus ~16 ms style/layout. It lands at the turn's midpoint (8% opacity)
  so it reads as a hitch in the turn, not a visible stall. Re-measured after the stronger frame (240 Hz display, 3
  swaps): p95 4.4-4.7 ms, p99 13-22 ms, 4-6 dropped frames per swap. Not yet under the 160 fps bar; options in the PR.

## Open

- Phase 3: live edge cases (teammate disconnect, concede, double wipe, a full-hand race refund, reload restore of
  passes, spectating a Duos match).
- The swap re-render cost (above).
