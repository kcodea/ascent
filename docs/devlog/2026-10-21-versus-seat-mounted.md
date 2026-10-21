# 2026-10-21: Versus room: one card element per member (R-VERSUS-ROOM-MOUNTED-01)

Owner-approved follow-up to #2196 / #2197: the frame where a card moves between a seat and the hand cost 15-16 ms
(once 63 ms on a watcher). React unmounted the card in one container, mounted a new one in the other, and the browser
laid it out. Bar: 160 fps, 6.25 ms a frame.

## What changed (`packages/ui/src/versus/`)

- **`.vscards`, one card per member** (`VersusRoom.tsx` `RoomCards` / `RoomCard`): every member's card lives in one
  layer for as long as they are in the room, in arrival order (a keyed reorder is a DOM move, which the browser treats
  as a remount). A card is always drawn at the seat size; a hand card is the same card scaled by `--vsb-s`
  (0.72 / 1.6) through its transform.
- **Slots, not containers**: the seats keep their open-seat card (its box is the seated card's slot) and the bench
  keeps only its label and one still anchor per hand slot (`.vsbslot`). `useRoomCards` (`useSeatDrag.tsx`) reads them
  once per seating change and once per resize (`readRoomGeo`, computed styles: sub-pixel and blind to the entrance's
  transforms), writes one `transform` per card, reads the written places (style only), then starts the glides.
- **The FLIP became a placement pass** (`placeRoomCards`): the glide animates the card element between two places
  (`translate + scale`, origin top-left), from my drop point, from a card's mid-glide matrix, or from its last slot.
  The sale's coins + coalesce, the landing dust + play sound, arrivals' coalesce, leavers' dissolve and the silent
  rollback are unchanged.
- **The hand's hover** (R-VERSUS-HAND-HOVER-01) keeps its still pads inside each card, in the card's own units: the
  fan's pitch arrives as `--vsb-stepl` on the pads (written per card only when it changes), lengths are `/ --vsb-s`.
- **The drag ghost stays mounted** (idle: transparent, off screen, no layer or shadow; `vsghost-off`). Unmounting its
  Card was the largest single piece of the drop frame.
- **Nothing inherited flips on a card on a move**: a seated card takes no pointer itself; the open-seat card under it
  (same box, a real `.card`, so the same gauntlet cursor) takes the hover and the press. The hidden open-seat card's
  text no longer changes while its seat is filled.
- **Stable inputs**: card faces (name + profile) and the seat numbers (`fetchSeatData` keeps an unchanged answer's
  object), so a room update or the post-move re-read re-renders no card.

## Gotcha: a scaled card is not a card laid out smaller

The stat pills' box scales with the card, but the pill scales about a fixed px origin (8px / 52px, 48px) and its art
is fixed px. A seat card scaled to hand size put each pill about 8 x 14 hand px off. `.vsbcard ... .badge.atk/.hp`
puts it back with `translate: (1 - s) / s * (origin - k * 50%)`. Measured part by part on both builds (the visible
frame is a child of `.badge`; the badge box itself was misleading): every pill part, the plate and the crown match to
0.001 of a card width, every card box to 0.1 px, in the hand, popped, seated, both seated and back.

## Numbers (prod build, live backend, hidden headless Chrome x3, vsync off, Claudebot1-3)

The frame the card moves in (ms, median of 3; before / after): take a seat, mover 15.8 / 10.7, watcher 10.4 / 4.8;
leave a seat, mover 10.6 / 7.5, watcher 8.6 / 6.1; the hand reordering (someone leaves and rejoins), watchers
7.5 / 5.7 and 9.3 / 5.6. Watchers no longer pay a forced layout (move task about 7-10 ms before, under 4 ms after).

Not closed: the mover's drop frame is still over budget. What is left in it is shared with the old build: React
reconciling the room as the drag ends, the restyle of the card the released pointer now hovers, the commit's own small
restyle (my card's classes, its pads, the seats, the ghost), and the raster of the card as it starts to glide.
Pre-promoting the cards (`will-change: transform`) was tried and measured within noise, so it was not kept (GPU memory
on phones).
