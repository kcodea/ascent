# Lobby rail accuracy audit (2026-10-16)

Owner: "can you have an agent look at the lobby rail info and make sure that it is accurate? the tier pill being wrong
has me wondering if the rest of it is wrong too" (after #2110 / R-LOBBY-SCOUT-01).

## Result

Every field the rail prints was traced to its source and checked against the round the viewer is in. The table's
own numbers were already right: seat order, Resolve / Armor, "N left", max damage, knockouts and shared placements,
next-opponent and ghost marks, and the round history (which foe, WON / LOST / DREW from the seat's own side, Dmg
attributed to the right seat, capped by the round). Two gaps were fixed:

- **A watcher's next-opponent card.** A live-game watcher whose own pool lacks the watched game's recordings drives
  those seats with generated stand-ins. Every other row then shows the seat's recorded read (`seatScoutIntel`), but
  the next opponent's card printed the STAND-IN's board: a tier, build and runes that player never had. It now follows
  the same rule (`railSeatIntel`).
- **Negative health.** The wipeout guard revives its best seat at or below zero; that row could print a negative
  Resolve. Rows clamp at 0.

## How

- `packages/sim/src/lobby/railView.ts`: `lobbyRailView` (round, loss cap, "N left", ordered rows with health,
  placement, next / ghost) and `railSeatIntel`. `LobbyPanel` renders exactly these; it no longer sorts or picks health
  itself.
- `packages/sim/src/lobby/railAccuracy.test.ts`: plays three real 8-seat lobbies (seven registered recorded runs,
  the player by `DEFAULT_BOT`) for 12-16 rounds and checks every field of every row every round against a ledger it
  keeps itself: the player's fight from `run.lastCombat`, every other pairing re-simulated from the recordings,
  health charged Armor first, placements derived, scout intel read off the recordings. Mutation-checked: swapping
  dealt / taken, or an off-by-one placement, fails it.
- Oracle: R-LOBBY-RAIL-01 (foundation).

## Open (asked the owner)

- A fallen seat's card lists its GHOST's later fights as its own (seed 4: Ravenz out round 11, card shows R13 vs You
  LOST, R14 DREW, R15 LOST).
- Practice with unlimited health: your row floats "-15" and your card lists it, but your health never moves.
- "Gilded units" is triples made this run, not Gilded units on the board now.
- The scout cards show each seat's board for THIS round (what it will fight with), i.e. its end-of-shop state.
- A live-game watcher never receives the watched game's recordings, so recorded seats are scouted from the last
  settle (a round behind) on the watcher's screen. Fixing it means shipping the recordings to the watcher.
