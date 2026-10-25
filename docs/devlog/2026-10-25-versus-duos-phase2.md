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
  shop: it reuses the spectate screen fed by their frames and cursor. To tell it apart from your own board: a team-colour
  panel sweeps across (170 ms in, the screens swap behind it, it waits for six calm frames, 200 ms out), their portrait
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
- Swap perf. The first build turned the whole stage root in 3D: 8-12 dropped frames per swap, worst 29-65 ms (a ~40 ms
  frame at each end of the turn just for the 3D layer, then the ~45 ms screen build at the midpoint). Now the swap is a
  pre-made full-screen panel moved by transform only (compositor-run), and the panel holds, covering, until the new
  screen has settled (six frames under 8 ms, capped at 700 ms). Measured on the prod bench build, ~170 Hz display
  (5.9 ms frames), 5 swaps in + out, every frame labelled by what the panel was doing:
  - panel moving in: p95 6.2 / p99 6.6 / worst 6.6 ms (the same as the idle shop: p95 6.2 / p99 6.6);
  - panel moving out: p95 6.3 / p99 8.7-10.1 / worst 11.5-11.9 ms;
  - panel holding still over the screen while it builds (69-177 ms per swap): p95 24-25 / worst 33-50 ms. These are the
    screen build itself (React mount of the other player's rows + their layout reads), done under a still, opaque cover.
  Frames over 6.25 ms during the moving parts are vsync jitter at this refresh (the idle shop shows the same rate).
  Zero over-budget frames for the build itself would need the other screen kept mounted (a second store instance per
  screen), a bigger change than this phase.

## Open

- Phase 3: live edge cases (teammate disconnect, concede, double wipe, a full-hand race refund, reload restore of
  passes, spectating a Duos match).
- The swap re-render cost (above).
