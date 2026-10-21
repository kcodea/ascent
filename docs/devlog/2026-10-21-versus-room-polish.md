# 2026-10-21 — Versus room polish (the room, the room list, the Versus tile)

Owner: "this is a 1.5/10, i need an 8/10 minimum here", plus "make them uniform size" (the stat pills), the hand
pop tweak ("50% lower ... and 10% smaller"), "this looks like a 1999 menu" (the room list) and "make the Versus pill
red if there's a room open". Rules R-VERSUS-ROOM-PILLS-01, -HAND-01, -SELL-01, -PLAY-01, -ENTER-01, -POLISH-01,
R-VERSUS-BROWSER-01 and R-VERSUS-OPEN-PLATE-01 (`packages/rules/src/registry/approved/foundation.ts`), pinned by
`packages/ui/src/versus/versusRoomPolish.test.tsx`.

## The room (`VersusRoom.tsx`, `versus.css`)

- **Backdrop**: `art/versus/arena-blur.webp` is a pre-blurred 1280x543 copy of `arena.webp` (sharp, blur 7, 21 KB),
  shown at cover size with no CSS filter. The old `.vsarena-ext` ran `filter: blur(18u)` on a full-screen layer and is
  gone, as is the crisp anchored image. A static gradient grade (`.vsvignette`) dims the edges and seats the hand.
- **Layout** (all % of the painting box, `versusRoomGeometry.test.ts` still holds): seats 14% wide at 32.4% / 53.6%,
  plates 16% to 64% down, card x1.6 (was x1.78, 8% to 61%, 36% apart). VS mark between them; Start game and one
  status line between the seat rows; the heading names the room, its host and the watchers.
- **Pills**: the room no longer sizes pills per state (`--vspcard-badge: 1.45` on the seat, x1 in the hand). Every room
  card scales the in-game badge with its own `--vspcard-k` about the card corner (`transform-origin` 8px 48px / 52px
  48px of the 60px badge), so the proportion is the in-game one everywhere.
- **Removed**: the Host / Player 1 / Player 2 / Open seat pills (now only a gold Host name pill on the host's seat),
  the SPECTATORS plate, the floating Join / Add bot over the art (now under the open seat, whose card text reads "Drag
  your card here to fight"), the pale empty art window (dark socket).
- **Hand pop**: one card width up at x2 (was two widths at x2.3). The grab pad `.vsbcard-hitup` re-derived to -255%
  (measured: covers the popped plate's crest; the popped plate's bottom stays above the screen edge).

## Round 2 (owner: "still looks unfinished and cluttered/gross", R-VERSUS-ROOM-POLISH-02)

- One action area under the VS (`.vsactions`): Start game only when two fighters sit (gold-edged primary), else the
  state on a name pill; Spectate / Last match beside it. The per-seat Host / Join rows and the bottom-left Spectate
  are gone.
- Header plate (Gem plate) top centre at `--edge-t`, level with Back: room name + "Hosted by".
- Host: the crown icon in the card's top slot (`.vshostmark`, seat and hand).
- Open seat: the standard plate masked by `frames/cardplate-wire.webp` (via `publicAssetCssUrl`, an absolute URL in
  `--vs-wire`), dim; for a spectator the whole seat is a `<button class="vsslot">` Join; Add bot (test tools) inside.
- VS 112u with a static dark pool behind; re-keyed on the second fighter (`useFullBeat`) for a one-shot slam and
  `ground-slam`.
- The "No one is watching yet." caption is gone (the header carries the count).
- `arena.webp` deleted (only the blurred copy is used; the art tree sits at the itch file cap,
  `artNoRedundantMasters.test.ts`).

## Round 3 (owner: drag-only seats, Start on two fighters, a bench; R-VERSUS-ROOM-POLISH-03, R-VERSUS-ROOM-STANDS-01)

- Removed the open-room pills, the Join slot button and Spectate: seats are drag-only both ways. The empty seat's own
  text is the cue. "Previous match stats" went back to the bottom-left controls.
- `.vsactions` is empty until both seats fill; `useStartPresence` keeps Start game mounted for its 220 ms exit.
  Keyframes are `vsinstart` / `vsinstartout` (the `vsin` prefix: the entrance skip finishes them, and the CSS
  contract test keeps them transform / opacity).
- Add bot: host only, on an empty seat, `top: calc(100% + 10u)` of the seat box, no hover translate. Every `.vsplate`
  lost its hover / press nudge (nothing moves under the cursor); the browser's room cards lost their 2 px lift.
- The bench: `.vsstands`, a navy panel band (top fades in from transparent, side edges via a fading border-image),
  with the "Spectators n / 20" pill inside the fan's box at z45 (over resting cards, under a lifted one). A softer
  "floor" redo was built and reverted the same hour on the owner's correction. Then polished: the band became
  `.vsbench::before` (it reads the fan's `--n` / `--vsb-step` to size itself to the fan, masks its ends, inner shadow)
  and the label moved centred above the cards. A "You" pill was added and removed on the owner's ask.
- The open seat no longer snaps: `VersusEmptySeatCard` stays mounted under a seated card with `.gone` (opacity +
  scale 0.97, one 250 ms transition), so it fades out as a card lands and back in as the seat empties.

## Moves (`useSeatDrag.tsx`, `useSeatFlip`)

The FLIP already saw every seating change on every client; it now presents them like the shop:
- seat to hand: the `coin` def where the card left (my drop: the release point) + `sfx.sell`, then
  `playPlateCoalesce` forms the hand card;
- hand to seat: the glide, then `landing-dust` (scale to card, intensity 1.5) + `sfx.play`;
- newcomer: coalesce in place; leaver: `playPlateDissolve` at its last plate rect;
- a refused optimistic move (seatMove dropped with no new room) is a rollback: plain glide, nothing else.

Gotcha: the room lives inside `.titlescreen` (z450), above the board's FX canvas (`.pixifx` z110). The room sets
`body.vsroom-on`, which lifts `.pixifx` to z470 (under the drag ghost at z485). `landing-dust` and `ground-slam` are
authored on the `under` slot, whose canvas sits inside `.app` under the title, so the room passes `slot: 'over'`.
`playPlateCoalesce` / `playPlateDissolve` gained an optional `z` (default 114, unchanged for the game). On phones the
FX canvas is torn down on menus (R-TOUCH-GPU-MEMORY-01), so the coins / dust / slam do not draw there; the coalesce and
dissolve are DOM canvases and still play.

## Arrival

`createRoom` steps the creator down to the stands with the existing take-seat RPC (the server still seats the creator
as p1; no SQL change). `joinRoom` always joins as a spectator, falling back to a player join only on
`spectators_full`. The entrance (`useRoomEntrance` + `.vsenter` keyframes, all named `vsin*`, transform / opacity
only): veil fade, backdrop push-in, seats stride in, VS slam with `ground-slam` and `sfx.gate('open')`, hand rises,
chrome fades; 1.25 s, any click (the veil takes it) or key finishes it.

## The room list (`VersusTitle.tsx`) and the Versus tile

Room rows are now cards (portrait ring, name over host, two seat sockets, status pill, eye + count, Join / Watch).
Create room has the name built in, prefilled "<name>'s room". Refresh is gone (the list already polls every 5 s). The
Mode screen's Versus tile keeps its "N open" chip and now turns its name plate red while a room is open. A bigger
"<host> is waiting · Join" call-out was built and rejected by the owner the same day.

## Perf

See the PR for the prod-build frame numbers (idle, hover, drag, sell, play, entrance).
