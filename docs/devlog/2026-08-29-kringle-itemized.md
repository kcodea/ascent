# Kringle pays out one hit per card, not one lump

*2026-08-29*

Owner ask: *"change kringle to give +1/+2 and repeat for every card played this turn, so the animation
triggers for every card played rapidly. this will be much more exciting than 1 single animation for the
buff."*

**The stat outcome is unchanged.** `n × (+1/+2)` is `+n/+2n` — exactly the number Kringle already gave, and
exactly what its live text already prints. Nothing about the balance moved; only the shape of the payout did.

## It is an existing ruling, not a new pattern

`runRecurringEndOfTurn` has carried this since the owner's **2026-07-17** ruling:

> `"+x/+y per z"` effects apply their buff once PER UNIT OF Z, each unit wrapped in its own nested
> `captureBuffFx`, so the beat replays one descend per step — 10 Attachments read as ten +2/+2 hits landing
> sequentially, not one +20/+20 lump.

Kringle simply predates the conversion. So this is the rule catching up with a card, which is worth saying
plainly: the interesting work was finding that the answer was already written down.

## The nesting is what produces the animations, not the loop

`captureBuffFx` measures the board **before and after** a block and emits one event per target that changed.
Loop inside a single capture and the diff collapses the whole thing back into one event — same lump, same one
animation. Each card played therefore gets its **own** capture.

Both ends are buffed *inside* one capture per card, and the events are tagged with an `fxWave` index. That is
the existing contract the End-of-Turn beat path already reads: it counts distinct `fxWave` values and paces
them with the ✨ Buff FX tuner's wave gap, so the two ends pulse **together** and the waves stagger **between**
each other. No new presentation machinery — the tag was the whole integration.

## The test asserts the FX shape, because the numbers cannot

A test on final stats passes just as well against the old lump, so the assertion that matters is the wave
structure: three cards played → waves `[0, 1, 2]`, each carrying the per-card `+1/+2` rather than the total.
Verified against the old implementation, which fails it.

One trap worth recording: the first version of that test read Kringle's contribution off the **board's final
stats** with a second Dwarf present — and that Dwarf has an End-of-Turn buff of its own, so the assertion was
measuring two cards and calling the sum Kringle's. It reads Kringle's own recorded events now.
