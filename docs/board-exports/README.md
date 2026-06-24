# Board exports → committed opponent pool

Drop board files here, then run `npm run pool` to bake them into the committed opponent pool
(`packages/sim/src/opponentPool.data.ts`), which the game loads at startup. This is how **your** boards and
**friends'** boards get shipped as real opponents (alongside the house bot boards the tool generates).

## How to share boards

**In-game (easiest):** Settings → **Shared Boards** → **Export my boards** downloads a `{author, exportedAt,
boards}` file. Send it to a friend; they hit **Import a friend's boards** and start facing your builds
immediately (tagged `origin:'friend'`). Boards are captured automatically when a run **ends** (win or lose),
stamped with your name (set at run start or in Settings) and the date.

**To bake boards into the committed pool:** drop an exported file here (e.g. `docs/board-exports/sam.json`) and
run `npm run pool`. The in-game export is the same shape this tool reads. You can also grab boards straight
from the console: `copy(localStorage.getItem('ascent.boards'))`.

## File format

Either a raw array of `BoardSnapshot` (what `localStorage` gives you), or — better, so attribution is
explicit — a wrapped object:

```json
{
  "author": "Sam",
  "origin": "friend",
  "boards": [ /* BoardSnapshot[] from localStorage 'ascent.boards' */ ]
}
```

- `author` — the display name shown on the opponent frame ("by Sam"). Per-board `author` wins if present.
- `origin` — `"self"` (yours) or `"friend"`. Per-board `origin` wins if present. Omit for `"self"`.
- The tool stamps a `capturedAt` date if a board doesn't already carry one.

## Curation (automatic)

`npm run pool` merges all files here with the house bot boards, then: drops empty / unservable boards
(every `cardId` must still exist in the current card set), dedupes identical boards, and caps per wave with
an even spread across the power range. Re-run it whenever you add files here or change the card set.

> Note: snapshots are bound to the card set. If a card is renamed/removed, boards referencing it are dropped
> at load (`isServableBoard`) — so regenerate the pool after card changes to keep coverage healthy.
