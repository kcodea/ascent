# Two owner bugs: hand-gain watchers in combat, and Sable's bond across a triple

*2026-08-29*

## "Gangplank doesn't trigger when cards are added to hand in combat"

The report was easy to misread as cosmetic, because the stats **did** eventually arrive. The shop half has
fired from a hand uid-diff in `reduce` since 2026-08-26, and combat's carry-back (`playerHandGrants`) lands in
the hand through a normal action — so the diff caught it and paid out at settle. A test written against
`settleCombat` passes today and passed before this change.

The bug is *when*. The payout landed on the recruit board **after** the fight, too late to affect the fight
that earned it. `onGainCard` had no combat factory at all, so `registerEffect` — which skips any effect whose
`do` has no entry in `FACTORIES` — never subscribed a handler and the bus never carried the event.

### The fix, and where it deliberately did not go

Three pieces:

1. **The effect bodies moved to `ARENA_EFFECTS`.** `onGainCardBuffTribe` and `onGainAleBuffSelf` are now one
   implementation each, called by both phases' factories. Writing a combat twin by hand is precisely how the
   shop and combat halves of an effect drift apart — the skill's own list of shipped failures has three of
   them.
2. **Combat emits from `ctx.grantToHand` and `ctx.grantRubies`** — the only two ways a card reaches a hand
   mid-fight. The trigger belongs at the chokepoint, not at the dozen call sites that grant, for the same
   reason the shop uses a uid-diff rather than sprinkling calls.
3. **A side guard.** `onGainCard` is a bus broadcast and the bus reaches **both** sides. Without
   `gainedByOwnSide`, an enemy Gangplank would pay itself every time the player conjured something. A test
   pins it, because that failure would have been invisible in ordinary play — it buffs the board you are
   fighting.

The emit is depth-guarded even though nothing today recurses: no current reactor grants a card. But this is a
broadcast running arbitrary effects, and the first reactor that *does* grant one would otherwise loop with no
symptom until it hung a fight.

**The asymmetry that stays:** a served enemy board has no hand, so `grantToHand` already drops enemy-side
grants. An enemy's watcher therefore never fires — not a decision made here, but a consequence of enemies
having no hand at all. Worth knowing before someone reads it as a bug.

The owner's rule is now written down in [`GAME-RULES.md`](../GAME-RULES.md) — any source, any phase, scoped to
the side whose hand received the card — so the next hand-arrival path has something to be checked against.

## "Sable's hero power breaks if a minion who is soulbound gets tripled"

`sableBond` stores two **run-board uids**. A triple destroys its three copies and mints a golden with a fresh
uid, so a bonded body that tripled left the bond pointing at a uid nothing could resolve. Because the mirror
needs *both* ends, the whole power went dead for the rest of the turn — silently, and in both phases, since
combat matches the bond on the same run-board uid via `sourceUid`.

**The bond now follows the body to the golden**, which is what every other per-instance value in
`combineIntoGolden` already does: buffs, spell progress, ascend progress, the earliest `boughtWave`. A triple
is a merge, not a death.

Two details that are the actual work:

- **Both ends collapsing into one golden ends the bond.** A self-bond is not a bond — `addBuff` would resolve
  the partner to the same body and pay every buff twice, a worse bug than the one being fixed. The Rune of
  Shared Spoils already documents this exact trap ("a single Dwarf on the board is both ends, so it must not
  pay itself"); Sable had no such guard because `board.length >= 2` at bind time made it look unreachable. A
  triple is how it becomes reachable.
- **The bond is re-stamped.** `SABLE` is captured once at the top of `reduceCore`, holding the uids as they
  were then. A triple resolves mid-dispatch — the played body's Battlecry, or anything after it, can still
  buff — so without re-stamping, the rest of that action would keep mirroring against the uid that had just
  stopped existing.

The golden usually lands in **hand**, so the re-pointed bond is inert until it is played. That is correct
rather than a gap: the body is not on the board, so there is nothing to mirror onto.

## A note on the tooling, not the code

Chasing bug 1, a `git stash push <paths>` was rejected by this git's argument parsing, and the `;` chaining a
paired `git stash pop` let the pop run anyway — restoring an unrelated branch's stashed WIP into the tree as a
conflict, in a file this work never touched. It surfaced as a merge-conflict marker in a `typecheck` run and
read, for a moment, exactly like "main is broken".

Nothing was lost (git keeps the entry when a pop conflicts, and it is still in the list), but the lesson is
cheap to record: **chain stash push/pop with `&&`, never `;`** — a `;` runs the restore even when the save
never happened.
