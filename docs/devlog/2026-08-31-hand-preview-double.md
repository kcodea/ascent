# The End-of-Turn hand stops briefly showing twice the cards

**Player report bb5195d5 (priority 4):** *"when rope wrangler triggers end of turn. it briefly displays 2x the
amount of cards given to hand, before correcting and displaying the correct amount."*

## The mechanism

End of Turn animates beat by beat, and each beat that grants a card shows a **preview** in the hand row, so
the card materialises on its own pulse rather than the whole batch appearing at once (owner ask 2026-07-27).
The real cards arrive later, together, in one `faceOmen` commit.

The previews were cleared in the same callback as that commit — and the code says outright that this is
required:

> *"Dropped in the SAME commit that puts the real cards in hand, or both lists render for a frame."*
> *"`faceOmen` puts the real cards in hand (the two lists would otherwise both render for a frame and the hand
> would visibly double)."*

The authors knew the hazard. What defeats the ordering is that the two lists live in **different stores**: the
previews are React state, the run is Zustand, and the store notifies its subscribers synchronously. So the
new hand can paint while the queued `setEotGrants([])` has not flushed, and the row draws the real cards *and*
their previews.

Rope Wrangler makes it obvious because it casts Lasso up to five times, so the doubling is five cards rather
than one.

## Why the fix is derived rather than better-ordered

Any fix that sequences two stores leaves a frame where one has moved and the other has not — inverting the
order just moves the flicker (previews vanish before the real cards land) instead of removing it.

`visibleHandPreviews` computes the preview count from what has already **arrived**: previews are measured
against the hand size End of Turn began with, and each card the commit adds drops exactly one preview. The
visible total cannot change across the commit, whatever order the two stores update in.

The tests are written as that invariant rather than as "the previews are cleared at the right moment" — for
every number of arrived cards, real + previews must equal the batch size. Also pinned: measuring against the
starting hand rather than zero, the hand cap, and a hand that *shrinks* mid-animation not resurrecting a
preview (the clamp that stops a negative slicing from the end).

Combat grants are deliberately left on the old path: they commit one at a time as the replay plays, so there
is no batch commit to race.

## Verification gap, stated

This one was **not** reproduced live. Driving it needs Rope Wrangler on the board with Gold spent, and the
hand-built run states I tried crashed inside `reduceWithPresentation` before End of Turn resolved — the path
wants lobby scaffolding a synthetic run does not have. The mechanism is inferred from the code and strongly
corroborated by the two comments above, which describe this exact failure and try to prevent it by ordering.
The fix removes the ordering dependency altogether, and the invariant is unit-tested; but it has not been seen
on screen, and the honest next step is a look during real play.
