# A replay is for watching, and the entry pop stops dragging art sideways

Two owner reports from 2026-08-30, both UI, both verified in the live client.

## 1. The board is inert while you watch a replay

> *"the buttons in game like end turn, freeze, and refresh etc should not be clickable as a viewer in a
> replay. please make sure they arent cause it looks weird and causes bugs it seems."*

The **reducer was already safe**: `dispatch` returns early while `replaying`, so nothing a viewer clicked ever
changed the run. What still happened was everything *around* the click — the button depressed and played its
sound, a card began a drag, the hero power armed and then waited for a target that could never resolve. A
control that responds and does nothing reads as broken, and an armed hero power with no way to fire it is the
"bug" in the report.

So the board goes inert **as a whole** — one `viewing` class on `.app`, driven by `replaySession` — rather
than `disabled` threaded through two dozen controls. One gate cannot be forgotten by the next control someone
adds.

Three deliberate carve-outs:

- **Cards keep their pointer events**, because reading a card mid-replay is most of why anyone watches. They
  are excluded from the `pointer-events: none` rule, and *dragging* is refused in `onCardPointerDown`
  instead — a JS guard, since `pointer-events: none` cannot block a drag while allowing hover.
- **The transport and round rail keep working** — they are mounted outside `.app`.
- `onBoardPointerDown` returns early, so there is no card-touch cue and no click thock either.

**Verified live** against a real replay: `.app` carries `viewing`; every board button computes
`pointer-events: none` while `.card` stays `auto` and the transport stays `auto`. Real mouse clicks on End
Turn, Freeze and Refresh land on the `.zone` behind them — `closest('button')` is null for all three — and no
state moves.

## 2. Card art no longer drifts left when the shop rolls

> *"when i roll, the card art is weirdly shifting to the left sometimes immediately when the card loads in."*

Measured, per animation frame, on the painted art box (object-fit maths, not the element rect): every card's
art drifted **left by 2.8–3.9 px** after mount.

It was not an art-loading bug at all. `.card.popin` runs `cardpop`, which opened at
`translateY(8px) scale(0.96)`. Scaling the CARD scales everything inside it — including each card's authored
art offset (`--ca-tx`, measured across one shop row at `+2.3`, `0`, `-13.8` px) and the art's own `--artZoom`
(≈1.0–1.5×). So growing the card 4% dragged the art's visual centre sideways by an amount **proportional to
how far off-centre that card's art is tuned**.

That proportionality is the "sometimes": a centred art barely moved, a heavily-offset one visibly slid. An art
image that finished decoding a frame or two late made it plainer still — it appeared already mid-slide instead
of popping in with its frame.

Dropping the scale (keeping the rise and the fade) took the drift to **exactly 0.0 px on all four cards**,
with the pop intact: `translateY` still runs 8 → 0, opacity still runs 0 → 1, and horizontal scale is pinned
at 1 for every sampled frame.

Any scale on this keyframe re-introduces the slide, so it should stay off.
