# The replay transport scopes to one round

**Owner ask (2026-08-30):** *"for the replay controller, make this section thicker and make the 1x-5x a button
with a menu that opens instead of a dragable setting. also, have the timer only show that round's time, not
the full game. so the player clicks a round and can then easily scrub through that round."*

## Round-scoped, and why that is the real change

The bar spanned the whole run. On the 18-minute replay used to test this, a single round occupied about **40
pixels** — so finding the moment a fight turned meant nudging one pixel at a time and overshooting by half a
round. The clock said `9:45 / 18:21`, which tells you where you are in the *game* and nothing at all about
where you are in the *round* you are actually watching.

The bar now spans the **current round only**, and the clock reads within it. On that same replay:

| round | round length |
|---|---|
| R9 | 0:14 |
| R13 | 0:09 |
| R17 | 1:00 |

The same drag that used to cross the entire game now crosses one round — roughly a **25× finer target**.

Nothing is lost, because round SELECTION was already the round rail's job: it is mounted beside the transport
and seeks by round. The two controls now split coarse and fine between them instead of one control trying to
be both. Clicking R9 in the rail re-scopes the bar to R9's fourteen seconds, which is exactly the "clicks a
round and can then easily scrub through that round" flow.

`Home` / `End` follow the same rule — they land on the edges of *this round*, matching what the bar spans.

### Implementation

`replayRoundSpan(index)` returns the `[from, to]` frame range of the round containing a frame. Frames are
appended in wall-clock order and a run never returns to an earlier wave, so a round's frames are contiguous
and a linear walk outward finds the edges without a search structure. The per-frame wave list is cached once
per `startReplay`, alongside the existing `frameTimes` / `effTimes` caches and for the same reason: the
transport re-renders on the playback clock, and an O(n) pass per render is not acceptable there.

The scrub's binary search is bounded to `[from, to]`, so a drag **cannot leave the round** — verified by
dragging 600px past the end of the track with playback paused, which lands exactly on `1:03 / 1:03` and stays
put. (Dragging while *playing* does move on to the next round shortly afterwards, because playback keeps
going — that is correct, and it is what an earlier version of this test mistook for a clamp failure.)

## Speed: a menu, not a slider

The 0.5-step range input meant dragging a 90px track to land on one of ten values; picking 3× exactly was
luck. It is now a button showing the current speed, opening a six-item menu — `0.5×, 1×, 1.5×, 2×, 3×, 5×`.
Halves below 1 to study a beat, whole numbers above to clear a slow turn.

The menu opens **upward**, because the bar sits at the bottom of the viewport and a downward menu would fall
off-screen. It closes on an outside click or Escape — a menu you can only dismiss by choosing from it is a
trap, and this one floats over the board.

## Thicker

Padding 8→14px, radius 14→18, buttons 34→42px tall, the scrub track 8→14px with a 20px handle. The bar reads
as a piece of the game's furniture rather than a thin strip floating over it, and the track is now an easy
drag target rather than a precise one.
