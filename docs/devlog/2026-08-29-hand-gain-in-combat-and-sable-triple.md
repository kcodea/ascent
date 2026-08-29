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

## Two Doc Bot lanes, because both bugs were already "covered"

Owner ask, after the fixes: *"add the logic that would catch these bugs in the future to docbot's oracle so
he knows to make similar scans for other cards and mechanics."*

The uncomfortable part is that lane 1 (`factoryPhase`) already exists to catch exactly bug 1's shape, and
`combineIntoGolden` is already the place bug 2's shape gets handled. Neither fired. So the new lanes audit the
*auditing* rather than re-testing the two cards.

### 9. `combatEmitAgreement` — a registry that gates a check must be derivable

`factoryPhase` computes `needCombat` **from `TRIGGER_PHASES`**, and `onGainCard` was written down as
`'recruit'` with the note *"combat has no dispatch site for it"*. False — `ctx.grantToHand` had existed all
along. So `needCombat` was `false`, and the lane whose entire job is finding missing combat factories could
not see one. **One wrong word in a hand-maintained registry switched off a rail, silently.**

The lane now scans `packages/core/src` for `bus.emit('<name>')` and demands every trigger combat actually
emits be `'combat'`/`'both'` or waived with a reason. A source scan rather than a runtime probe, because a
probe only sees what a scenario reaches — "not observed" would mean "the probe didn't get there".

It found three more disagreements on its first run: `battlecryTriggered` and `spellCast` (both legitimate —
combat answers them under different factory ids, now written down as waivers instead of living in a comment)
and `onLoseDivineShield` (engine-internal, never authored as a card trigger).

### 10. `uidSurvivesTriple` — a deep walk, not a field list

The obvious version scans `state.ts` for fields whose name contains "uid". **That version would not have
caught this bug**: the bond's fields are `a` and `b`.

So: record the uids a triple destroys, deep-walk the whole post-triple `RunState`, flag any string equal to
one. No naming convention, no field registry to keep in step, and it sees a new field the day it is added.
Deliberate dangling refs (presentation cues naming the body that just vanished) are allowed by path with
reasons, and one test *forges* a dangling ref to prove the walk can still see one — a detector nobody has
watched fail is not evidence.

**It earned its place immediately** by flagging `firstShoutUid`: written on the turn's first Shout and read by
nothing, with a docstring naming a consumer (Rune of Refrain) that actually uses the just-played `card.uid`.
Harmless today and only today — the moment someone implements "return the turn's *first* Shout" off that
field, they inherit the Sable bug. Recorded as a finding in the allowance rather than filed away as a cue.

Both lanes were verified against the original bugs: reverting `carrySableBond` fails lane 10, and restoring
`onGainCard: 'recruit'` fails lane 9.

## A note on the tooling, not the code

Chasing bug 1, a `git stash push <paths>` was rejected by this git's argument parsing, and the `;` chaining a
paired `git stash pop` let the pop run anyway — restoring an unrelated branch's stashed WIP into the tree as a
conflict, in a file this work never touched. It surfaced as a merge-conflict marker in a `typecheck` run and
read, for a moment, exactly like "main is broken".

Nothing was lost (git keeps the entry when a pop conflicts, and it is still in the list), but the lesson is
cheap to record: **chain stash push/pop with `&&`, never `;`** — a `;` runs the restore even when the save
never happened.

## The Equipment art sheen

Owner ask: the shared sheen (the menu plaques', the hero-damage one) on the Equipment, *"on the card art
itself and not the equipment slot png, so the sheen only passes over the art"*, with dials for timing, speed,
size, direction and the clip.

**Containment is structural, not tuned.** The band is a child of `.hpb-artwrap` — the circular
`overflow: hidden` clip the icon already rides in — so it physically cannot cross onto the frame. Nothing to
maintain, and a test asserts the parentage rather than any measurement.

### The trigger is the PICTURE, not the equip

Owner: *"this sheen should not play if the player already has equipment shown and they play another equip
minion … the first equip / going from 0→1, or when equipment is swapped in the slot."*

So it keys on the Equipment id **currently shown**, and nothing else. Worth noting this is a *different*
question from the equip cue's gate added yesterday: `holdsEquipment` asks "did you acquire something?", the
sheen asks "did the picture change?". They agree on a duplicate Frank and deliberately disagree elsewhere —
swapping the rail to an Equipment you already hold acquires nothing, yet the art changes, so the sheen plays
and the equip burst does not. Two rules, both right, kept separate.

A fresh mount does not sweep either: StatusBar remounts on every return from combat, and a sweep there would
be a flourish nobody asked for.

### Two test bugs worth recording, because both were invisible

1. The "does not sweep on a duplicate" test compared the band's **class string** — identical whether or not a
   new sweep happened, so it passed under a deliberately broken implementation. It compares the DOM node
   identity now (a fresh sweep remounts under a new key). Only the sabotage run exposed it.
2. Three tests mounted straight into a held Equipment and then asserted a sweep — but a mount is not a change,
   so they were asserting against behaviour that correctly never happens. They start from an empty slot and
   transition now, which is also what play does.

Both were caught by sabotaging the implementation and finding the suite still green. A test that passes
against a broken implementation is worse than no test, because it is counted.

### The dials

Timing (negative = earlier), speed, width, direction, and the clip's volume and timing — all in the Equipment
Slot tuner under **Sheen**. Both offsets are anchored to the **slot burst** rather than to the cue, so
"earlier" means something: the cue is time zero and an offset before it could only clamp, while the burst is
the moment the icon lands, which is what the sheen is reacting to.

Direction needed a class rather than a CSS var — there is no way to pick an `animation-name` from a number —
so the trigger stamps `.rev`, and the gradient mirrors with it so the bright edge still leads.

The panel carries a **▶ sheen** button: the real trigger only fires on a genuine art change, and judging a
60ms offset by buying a second Equipment and swapping back and forth is exactly the friction that stops a
tuner being used.

