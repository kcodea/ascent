# 2026-10-31 · Right-click inspects again; holding right-click pings

Owner ask 2026-10-31 (Mike): "can we also change the ping logic? i want right click to be inspect (currently its double
right click) and a held right click to be ping. is that doable?" Branch `feat/hold-right-click-ping`. Rule R-PING-09
(approved/foundation.ts); R-PING-04 / 07 / 08 amended to match.

## What

- **`installRightHold`** (`packages/ui/src/pings/PingLayer.tsx`, installed by `PingLayer` before its own listener): a
  mouse right-press arms ONE `setTimeout` of `PING_HOLD_MS` (170 ms, owner-tuned from 300 after a playtest), and only where a hold could act (`pingContext()`,
  or a ping of mine on screen). Released early, nothing happens and the `contextmenu` reaches the target's own handler
  (a card's Inspect, a spot's scout pin / emotes). Held, `pingHold` opens the fan (or clears my own ping, R-PING-07) and
  the release's `contextmenu` is swallowed.
- **Inspect on release, not "inspect on press then swap"**: Windows already fires `contextmenu` on release, so a quick
  Inspect opens exactly when it always did, and a ping never flashes an Inspect view first. Where the browser fires it
  on the press (macOS, Linux) it is held back while the press is undecided and replayed once on a quick release.
- **`openCardPingMenu`** now answers false for any mouse right-click (it is a quick one by the time it reaches the card),
  so Card.tsx inspects. The phone long-press path (and its double long-press to inspect) is unchanged.
- The fan sets `body.ping-open`, which hides the card's hover reveal (`.cardref`): a held press never reaches the card's
  own handler, which used to hide it.
- A quick right-click on a shop button now does nothing (a button has no right-click of its own); hold it to ping.

## Tests

`pings/rightHold.test.tsx` (Windows and macOS event orders, no-ping screens, touch ignored); the fan / clear tests in
`pings.test.tsx` and `pingSpots.test.tsx` moved onto the hold (`pingHold`).
