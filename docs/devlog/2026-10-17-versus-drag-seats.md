# Versus room: drag your card to a seat (2026-10-17)

Owner: "for spectator in versus etc, the player should drag their card to a slot to take it, and drag their card from a
slot up to 'sell it' to go to the spectate. optionally, have a join button and spectate button, but make it smooth and
lower the spectator hand so it looks more like the in game location." Rule R-VERSUS-DRAG-SEAT-01.

- **Pure rules** in `versus/seatDrag.ts`: who drags (`canDragSeatCard`: my card, open room), the zone under a point
  (`seatZoneAt`: a seat other than my own, else for a seated card the sell band or the hand), and the drop's outcome
  (`seatDropOf`: take / reject / cancel). `sellLineOf` puts the sell line two fifths of the way down the seat card and
  always a clear pull above the grab point (the seat cards fill the top of the arena, so "above the warband" has no
  room). `roomWithSeatMove` is the optimistic room.
- **The drag** in `versus/useSeatDrag.tsx` reuses the shop's pieces, not its Recruit-bound session: the `.dragcard` /
  `.dragtilt` / `.dragshrink` ghost (`fromhand` grab-shrink, `snap` spring-back with `snapMs`, `willplay` plate glow),
  the drag-cursor veil, `TAP_SLOP` + `dragFeel.threshold`, the `.sellzone` overlay and `sfx.cardTouch` / `play` / `sell`
  / `deny`. One layout pass at pick-up; each move only writes the ghost transform in a rAF; React hears only zone
  changes. The ghost needs `z-index: 485` (`.dragcard.vsdragcard`): the room overlay is z480 and the shop's z115 drew it
  under the room (found live).
- **Optimistic seat moves**: `takeSeat` now sets `seatMove`, the room renders through `roomWithSeatMove`, and a refusal
  clears it, flashes the existing room error (auto-clears after 3.2 s) and re-reads the room. Both buttons ride the same
  path. One move in flight at a time. Start game still reads the SERVER room, so it never enables on a pending move.
- **FLIP** (`useSeatFlip`): on any change to the members' roles, one rect read of the room cards, then a WAAPI
  transform animation from each card's old place (my drop starts from the ghost). Same code for my move, a rollback, and
  Realtime updates from other clients.
- **Buttons renamed** Take seat -> Join, Move to the stands -> Spectate (the owner's words).
- **Hand lowered**: `.vsbench` top 70.5% -> 75.5% (to the painting's foot), `.vsbcard` top 24% -> 31%: the plates now
  run off the bottom like the shop hand at rest, the hover lift is unchanged. There is no "+N" chip in the v2 fan (all 20
  fit), so nothing to keep there.
- Verified with two headless clients (Claudebot1 / Claudebot2) on the live backend: drag to seat, the other client's
  FLIP, drag up to the stands, the refused drop on a taken seat, keyboard Join. No SQL change.
