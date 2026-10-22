# 2026-10-21: "When you have space" summons wait for a real slot (R-SPACE-PENDING-01)

**Owner bug:** *"rune of the mirror march is bugged, and probably most 'when you have space' things - mirror march only
works if you have room at start of combat, but a 'when you have space' mechanic should fire whenever the player truly
has a slot for the minion to summon."*

## What was found

Every text that says "when you have room / space" (content, runes, heroes, Ancients), and how each behaved:

| Mechanic | Before | After |
|---|---|---|
| Rune of the Mirror March | checked room once at Start of Combat, gave up on a full board | pending, shared queue |
| Rune of the Warden ("when you have room in combat") | same: Start of Combat only | pending, shared queue |
| Rune of the Waking Reserve | same: Start of Combat only | pending, shared queue |
| Soren's Reclaim + its Ancient forms | already waited (own `pendingResummons` queue) | same behaviour, now on the shared queue |
| Brackus x Ancient of War ("as soon as you have room") | already waited (own `pendingSummitCopies` queue) | same behaviour, now on the shared queue |
| Rune of the Brood, Rune of Living Echoes, Decoy (Training Dummy) spell | already real-time (`fillFreeSlots`, every settle) | unchanged |
| Soren x Ancient of Fortune (Shop Reclaim, "right away, if there is room") | one-moment check; owner: "if no room then it is lost" | unchanged |
| The Burning Legion Imp copy | one-moment check as the Imp attacks | unchanged |

Shop side: the only shop copies are the Start-of-Combat replays at End of Turn (Combat Prowess / Lasting Cadence).
End of Turn closes the Shop, so a pending summon made there would expire on the spot; nothing queues in the Shop.

## The fix

`packages/core/src/combat/simulate.ts`: one `spaceQueue` for the fight (both sides), `queueSpaceSummon` (enqueue +
flush) and `flushSpaceQueue`. Each entry is `{ side, land }`; the flush lands every entry whose side has a free slot
(`occupied < 7`, living bodies, so a Rise return is not room), first queued first landed, skipping a full side
without losing its place. `settleBetweenAttacks` flushes it after every attack's death cascade and once before round
1 (it replaced `flushResummons`). Each landing calls `nextStep()` and emits its own trigger and `summon`.

- The summon reads the board when it LANDS (real-time by default): Mirror March copies the left-most living minion
  then and places the copy to its right; the Waking Reserve picks the best unlocked hand minion then. Nothing to copy
  at that moment: the entry is spent with no event.
- One entry per rune copy held, so two copies need two slots and land as two beats (they used to share one trigger).
- Rune of Twilight's extra Start-of-Combat passes still add Mirror March / Waking Reserve entries (pass > 0), and the
  Twilight pulse fires on the first landing.
- Lifetime: combat-only. No current text carries a pending summon over, so leftovers are dropped when the fight ends.
- The Reclaimer and Brackus queues were folded in with their bodies unchanged (`landResummon`, `landSummitCopy`), and
  the enqueue order at Start of Combat is the same as before, so their event logs are byte-identical.

Two existing tests encoded the bug ("a full board: no copy", "one slot: one copy") with enemies that do kill a body
later; they now assert nothing at Start of Combat and the late landing.

## Tests

`packages/core/src/combat/whenYouHaveSpace.test.ts`: full board then a death (lands at that settle, before the next
swing); full all fight (never fires); room at Start of Combat (unchanged); Warden + Mirror March (FIFO, second needs a
second slot); two Mirror March copies with one slot; Rise holds its slot; Waking Reserve waits; enemy side symmetric;
same-seed determinism. Six of nine fail on the old engine.

Engine change: Versus `versus-resolve` must be redeployed with the next Netlify pack.
