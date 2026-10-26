# 2026-10-26: Kringle repeat chains share one budget; the Versus seat drop lands once

Two owner reports, one branch (`fix/kringle-perf-seat-drop`). Rules: R-REPEAT-05 (new), R-REPEAT-04 (floor wording),
R-VERSUS-SEAT-DROP-01 (new).

## 1. "kringle was triggering super slowly and causing freezes/massive slow downs"

The owner's board: several golden Kringles after an Ale-heavy turn. R-REPEAT-01 gives every tick its own beat and
R-REPEAT-04 caps each chain at 2.5 s, but the cap was PER CHAIN, so four Kringles played about 10.7 s of End of Turn.

What changed (presentation only, the sim and the commit are untouched; `prepared.after` is byte-identical to `reduce`):

- **Long chains share one budget** (`repeatChainCapMs`, `compileTimeline` counts the End of Turn's long chains first).
  A chain of 5+ ticks is long; several long chains split `phaseCapMs` 4 s, each between 1 s and 2.5 s. A lone chain
  and a Chronos double keep their old pace.
- **The lead-in takes at most 62% of a chain's cap** (`leadShare`), so a shortened chain still rolls its tail over
  several updates instead of jumping to the end. At the default cap the lead-in is unchanged.
- **Slot floor 20 ms -> 40 ms**: a batched tail changes the numbers about 25 times a second, not every frame.
- **Sped-up accent ticks draw ribbons at 40% particles** (`repeatTickFxIntensity`, through `fireBuffFx`'s existing
  `intensity`); the first full-pace tick plays as authored.
- **The live player folds a frame's deliveries once** (`applyConsequencesToProjection`). It used to copy the
  delivered-id set once per delivery, which is quadratic in a long chain: at 480 cards played (3,848 deliveries) one
  frame spent 74 ms folding, at 960 it was 238 ms. Now under 2 ms for both. `projectionAt` uses the same batch fold.

The sim side was checked for quadratic loops: `eotRepeatTick` is O(board) per tick and `gainAttackFiredUids` is read
through a Set; prepare time scales linearly (7 ms at 30 cards played, 16 at 120, 50 at 480, 70 at 960 for four
Kringles, headless).

### Measured (prod `VITE_PERF_BENCH=1` build, headless Chrome, uncapped frames, 1920x1080, non-local requests blocked)

Window = End Turn press to the phase flip. Medians of 3, before/after interleaved. Frames over 6.25 ms.

| scene | resolve before -> after | frames over 6.25 ms | worst frame |
|---|---|---|---|
| 4 golden Kringles, 60 played | 10.70 s -> 4.70 s | 277 -> 45 | 33.3 -> 34.6 ms |
| 4 golden Kringles, 120 played | 10.67 s -> 4.74 s | 110 -> 109 | 32.9 -> 48.9 ms |
| 1 golden Kringle, 60 played | 3.18 s -> 3.12 s | 35 -> 29 | 21.2 -> 22.9 ms |
| 3 golden Mother Moss, 30 Spirits | 8.17 s -> 4.71 s | 92 -> 60 | 23.4 -> 24.6 ms |

Main-thread time over the 120-played window (devtools.timeline trace): FunctionCall 5.6 s -> 2.3 s, Layerize
2.0 s -> 0.9 s, style 0.55 -> 0.23 s, paint 0.35 -> 0.20 s. Peak live FX particles 1,831 -> 1,441.

Honest read: the time the chain takes and the total work are cut by more than half, and the long-chain freeze (the
quadratic fold) is gone. The per-frame cost during the chain is the shop's ordinary render + FX cost (the trace shows
the main thread busy at a flat rate across the whole window, not climbing with the tick count), so the 120-played run
packs about the same number of over-budget frames into less than half the time, and the worst frame is noise-bound
(single runs ranged 34 to 187 ms in both builds; the press and the phase flip own most of the worst ones). A follow-up
on the shop's baseline frame (Layerize every frame while the FX overlay runs) would move those.

Shop-phase "Repeat for every" cards (Squirl Scout, the Dragon spell, the Celestial Shout) go through the per-action
buff wave, which was already bounded (`waveMaxCount` 6 waves, 900 ms), so they were left alone.

## 2. "when dragging the player portrait to a lobby slot it kinda does a pop/plop"

Two causes in the Versus room's seat drag:

- A hand card is still hover-popped (`.vsbcard:hover .vsbcard-lift`: one card up, x2) when it is dropped on a seat.
  The class flip to a seat card eased that pop away over the lift's 0.14 s transition ON TOP of the landing glide, so
  the card landed about twice its size from a card higher. `.vsmcard-seat .vsbcard-lift { transform: none;
  transition: none; }`.
- The landing FLIP started at the ghost's HELD size (seat x 1.21) at the pointer, but a quick flick lets go before the
  grab-shrink has grown a hand card, so the landing started bigger than the card let go of. It now starts at the
  ghost's `.dragshrink` box as drawn at the drop (`releaseBoxOf`, one read on the drop only).

Seat-to-seat (no hand pop) and to-the-stands (the sale) keep their behaviour. Pinned at the source by
`versusSeatDrop.test.ts`; not driven live (a room needs the live backend and a signed-in identity), so the motion
itself still wants an eye in the next live Versus test, desktop and phone.
