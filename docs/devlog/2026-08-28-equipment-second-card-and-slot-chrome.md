# Equipment, round two — a second card, the frame, and a selector you can actually reach

*2026-08-28 · follows [`2026-08-28-equipment-vertical-slice.md`](2026-08-28-equipment-vertical-slice.md)*

The vertical slice shipped with exactly one Equip minion, which meant a third of the system had never run:
the selector, the board-order fallback and last-used restoration were all written against a collection that
could only ever hold one entry. This pass added the second card and then fixed what having two exposed.

## Titan Sculptor → the Titan Hammer

T6 Neutral 10/8. **Equip Titan Hammer (3): set a friendly minion's stats to 50/50** (100/100 Gilded).

Setting rather than buffing needed a new factory, `equipmentSetStats`. It writes the absolute numbers and
records **the delta it applied** as a buff entry, so a hammered body's inspect still itemises to its printed
stats. That makes the Hammer chisel *down* as readily as up — a 90/80 becomes 50/50, not 140/130 — which is
the whole point of a set effect and is now the thing a test names out loud.

The owner renamed it from Titan Chisel to Titan Hammer after the art landed. The id moved with it
(`titan_chisel` → `titan_hammer`), which was safe only because the feature is unmerged and no save in the
wild holds the old string.

### Two cues were throwing away their identity

The equip and re-equip FX stamps both *knew* which Equipment they belonged to and dropped it on the floor.
They carry `equipmentId` now. That is what makes "one cue per Equipment, in board order" assertable at all —
before, the assertion could only count cues, which is exactly the shape of bug that produced the owner's
"my 5th Frank plays the animation 5 times" report in the first place.

## The selector became a hover rail

Owner ask: *"when i mouse over the equipment, can it show the available equipment options slide out to the
right? then i can click on an option to select it as the current equipment."*

The old selector was a permanent row of text buttons under the slot — space spent every turn on a choice made
rarely. It is now a rail that slides out to the right on hover: one row per Equipment with its icon, name and
**live cost**.

Three decisions worth keeping:

- **Reveal is CSS, not React state.** `.equipslot:hover .equiprail`, transform + opacity only. Crossing a
  button costs no render.
- **The rail is a CHILD of the slot.** The pointer never leaves the hover target on its way in.
- **It does not render while ARMED.** An armed Equipment means the player is aiming at the board, and a rail
  hanging off the slot would sit under the cursor on the way out and eat the pick.

### …and then it wouldn't stay open

Owner report: *"it needs more leeway on moving the mouse over to the panel to select an equipment. it fades
before i can mouse over an option every single time."*

**Two causes, and only fixing both worked.**

1. **The gap was dead space.** The rail sat `margin-left: 10px` off the slot, and that strip belonged to
   neither element: the pointer left the slot, hovered nothing, and the rail closed before it arrived. The gap
   is now the rail's own left **padding**, with the visible panel moved to an inner `.equiprail-in`. Same
   separation on screen; the strip is now part of the rail's hover box, so the pointer is never over nothing.
2. **It closed instantly.** It now lingers `--eqr-grace` (default 320ms) on the way out, covering a diagonal
   exit off the slot's corner or an overshoot past the rail. The delay is on the **close only** — opening
   stays immediate, because a menu that hesitates before appearing feels broken.

The first fix is the structural one. The grace period alone would have papered over a rail that still had a
dead strip in front of it.

## The frame, and dials for everything on it

`EquipmentFrame.png` now surrounds the button. It is a **sibling** of the button, not a background on it: the
button is a square box whose art is clipped to a circle, and a frame painted as its background would be
clipped along with it. As a sibling it can also be sent behind the icon or left in front of it — both read
very differently against a round icon, so which one wins is a dial rather than a decision made in the
stylesheet.

The frame arrives with a round boss at its top-left and a plaque along its bottom, which is why the owner
asked for pill dials in the same breath. The **Equipment Slot** tuner now owns the whole block, grouped:
seat, frame, cost pill, name pill, uses tally, selector rail.

One panel and not four on purpose: every dial answers the same question — *where does this sit relative to
the button* — and they are judged against each other. The cost pill's seat only means anything once the frame
is placed, because it is being dropped into the frame's boss.

Each readout keeps the seat it already had and takes a tuned **offset** on top, so switching the frame on
moves nothing until the owner starts dialling.

## Art

`TitanSculptor.png` and `TitanHammer.png` wired; `e3_sculptor` left `ART_PENDING`.

**A trap for next time:** `npm run art:wire -- --apply` re-encodes *every* art file it touches and drops the
PNG masters into the tree alongside them. `git status` looked like 814 modified images, and the PNGs did not
show up there at all because they are gitignored — they only surfaced as an art-gate failure counting 826
redundant masters. Reverting the tree and deleting the PNGs that duplicated a webp restored it. Check the
diff after any `--apply`; the two files you wanted should be the only ones in it.

## The Hammer's own cue

The owner authored a `titan-hammer` FX def and a `titanhammer` clip mid-pass, both now wired through the
Equipment's own `useFxId` / `useSfxId` — no UI change needed, which is the point of those fields.

It reads very differently from Bloodpot: every layer is anchored on **target** and fires at `at: 0`, so it
lands *on* the minion rather than travelling from the slot the way the potion does. That made the FX tuner's
"▶ use" button a problem — it was hardwired to Bloodpot, so half the system had no way to be timed. It now
fires whichever Equipment is **selected**, falling back to Bloodpot when none is held.

That change cost a registry update: the tuner's `playDef` stopped being a literal and became a second
data-resolved call site. Rather than widen the "no dynamic playDef outside the binding resolvers" invariant,
both Equipment exceptions are now named in `DYNAMIC_CALL_SITES` and in the test, with the same fix recorded
against them — moving the Equipment-use moment into `recruitCues.ts` retires both lines at once.

## The equip cue announces ACQUISITION, not the play

Owner ruling: *"we need to add logic to only play the equip animation and sfx if a new equipment is actually
equipped."* A second Alchemist Frank equips nothing — the Bloodpot is already in hand — so it says nothing.

The gate is keyed on the Equipment **id**, not the version, because the owner's own reasoning covers both
directions: *"if i have a gilded alchemist frank and i play a non gilded alchemist frank, that would also NOT
play the sound, because it is not equipping new equipment."* By that logic a plain → Gilded **upgrade** is
also not new Equipment — the same Bloodpot, improved — so it is silent too. That case the owner did not
enumerate; it is decided from the reason they gave, and `holdsEquipment` is the single line that changes if
an upgrade should announce itself after all.

> **SUPERSEDED 2026-08-29.** The owner ruled the other way, which is why that line was flagged: *"if you gild
> an equip card with the basic version of that equipment, then playing the GILDED version … should re-play
> the equip animation and sfx etc … there should be player feedback for the interaction."* The predicate is
> now `equipIsNews`, and the rule is **does what you hold change** rather than **is this id new** — a Gilded
> source over a plain entry announces, a Gilded source over an already-gilded one does not.

Only the announcement is gated. The grant is untouched: duplicate sources still register, still hold the
entry alive, still decide Gilded precedence — a test asserts each of those alongside the silence, because a
cue fix that quietly stopped granting would look identical from the outside.

`holdsEquipment` is a predicate on run state rather than a flag returned from the grant, so any future
granter — a spell, a rune, a hero power — inherits the rule by asking before it grants.

## Two dials baked, one added

The owner's tuned slot values are now the defaults: the seat moved a long way left and up, the uses tally to
1.29×, the rail to 1.18×. The frame, cost pill and name pill were judged correct as authored, so their zeros
mean "measured and left alone" rather than "never looked at".

New `equipmentselect` clip on the rail's pick, with a **Pick volume** dial in the same panel. It multiplies
on top of the category and per-clip gains rather than replacing them, so the UI bus still governs it and the
dial only decides how the pick reads against the slot's other sounds.

## The slot fades instead of vanishing

Owner ask: *"add a brief fade in/fade out for the equipment so it doesn't simply disappear immediately."*

Fading **in** is free — an animation on mount. Fading **out** is not, and the reason is worth writing down:
the slot renders off `run.equipment`, so the frame the last source dies or is sold there is nothing left to
paint. React has already unmounted the thing you want to watch leave.

So the panel **lingers**. A snapshot of the last Equipment that was held — name, art, cost — is kept in a ref
(written during render, never causing one), and when the run stops having an Equipment the panel keeps
rendering from that snapshot for the fade's length, then drops. The lingering copy is inert by construction:
no rail, no arming, a disabled button, `aria-hidden`. It is a picture of something the player no longer has,
and letting them click it would be a lie about state.

The fade duration is one dial read by **both** the CSS animation and the JS timer that keeps the copy alive,
so they cannot drift into a cut-short fade or a ghost that outstays it.

Three tests, because a leaving copy that never unmounted would look perfectly correct in a screenshot: that
it stays and paints the lost Equipment, that it is inert, and that re-equipping mid-fade cancels the leave
instead of leaving a live slot beside a ghost.

While in there: the seat's CSS fallbacks still carried the pre-tuning numbers, so a paint landing before the
config module applied its vars would have put the slot in its old position. They mirror the baked defaults
now, with a note to update both together.

## Debt logged, not paid

The art-file ratchet needed its third +2 bump of the day (→ 1050). There is real slack nobody has spent: the
16 Celestials archived this morning — and ~40 other archived cards — still ship their portraits, unreachable
by any live card. That is a bigger win than any of these bumps and belongs in its own pass, so it is a spawned
task rather than a "while I was in there".

Worth knowing when someone picks it up: the ratchet's stated rationale has drifted. Its message says the
whole-zip count is what itch caps at 1000, but at 1048 files that count was already ~1224. It is a growth
ratchet now, not the cap it names.
