# The Shop never overflows, and an oracle that says so

**Player report 5c5b50a0 (priority 3):** *"rune of open enrollement overflows the shop. there are too many
minions available. the extra minion doesnt remove a different option from the shop so othere are 7 options
instead of 6."*

**Owner ruling, generalising it:** *"the shop should never overflow beyond its capacity, it should only ever
replace available slots with affected minions or spells etc."*

## The bug

`appendDominantTypeOffer` ended in `s.shop.push(...)`. The row is sized by `tierSlots(tier)` — 6 at Tier 6 —
so a Refresh with the rune held produced a seventh offer, exactly as reported.

The correct shape was already in the file, eleven lines below: Pete's `upgradeRightmostOffer` carries an owner
ruling from **2026-08-14** — *"it upgrades the existing offer rather than adding an eighth"* — and replaces
the right-most minion offer, returning the displaced card to the shared pool.

## The fix

Fill a free slot when the row is short (genuinely additional, grows nothing); **replace** the right-most
*minion* offer when it is full. Never a spell or Ruby offer: those sit in the row but are not minion slots,
and clobbering one would eat a different resource than the rune is about.

The pool bookkeeping came along for free and had been missing: the displaced offer returns to the pool like a
reroll, and the new one is taken from it, so copies stay a contested resource.

## The oracle

`shopCapacity` has two detectors, because one is not enough.

**Behavioural** — drive real runs through random legal actions and assert the row after every one. This is
what catches the bug, and it catches it wherever it comes from; the guilty effect never has to be named.

**Static** — every `shop.push` site is declared with the reason it cannot overflow, so a new unbounded one
fails the day it is written. That half scales; the behavioural half only sees what a driven run reaches.

### The vacuity trap, and why the sabotage check earned its place

The targeted rune test **passed against the original bug** on its first draft. `appendDominantTypeOffer` opens
with `dominantBoardTribe(s)` and returns on null, so the empty board `createRun` gives meant the rune never
fired at all. Only after the test built a real tribal board did re-introducing the `push` trip it — *"tier 1:
4 offers for 3 slots"*. A test that cannot fail is worse than no test, and the only thing that exposed it was
putting the bug back.

## Flagged, not changed: Fodder

A third `shop.push` — queued Fodder brought out for a Demon — is **unbounded**. It is normally consumed in the
same breath, but `holdFodderConsume` defers that behind a start-of-turn modal, which is a window where a
player could see an over-long row. It is declared in the oracle with that reasoning rather than bounded
unasked, because bounding it would change Demon behaviour and that is the owner's call.

## Also here: Coppercoat Spellsword's art

Player report 507425ef (priority 5) said the art was cropped poorly. The owner had already re-cropped it in
the Card Art tuner — but the values sat **uncommitted** in the working tree (`n2_spellsword` in
`cardArt.data.json`), so the fix had never shipped. Committed here, unchanged.
