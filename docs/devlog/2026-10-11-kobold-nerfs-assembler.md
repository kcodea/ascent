# 2026-10-11 · Kobold nerfs, and Assembler replaces Frenzied Excavator

Owner balance call the day after the 2026-10-10 Kobold / Ruby batch: "kobolds are overtuned. lets make a few
adjustments". Four Ruby-strength gains come down (most of the way back to where they were before 10-10), Gemling
casts one Veinstorm fewer, and Frenzied Excavator is archived for a new card.

## What changed

| Card | Before | After |
|---|---|---|
| Ruby Mender | Shout: Rubies +2 Health (gilded +4) | +1 Health (gilded +2) |
| Cave Cutter | Rubies +2/+2 (gilded +4/+4), or 4 random Rubies | +2/+1 (gilded +4/+2); the Ruby branch is unchanged |
| Crownvein | Rally: Rubies +2/+3 (gilded +4/+6) | +1/+2 (gilded +2/+4) |
| Portsmith | Avenge (3): Rubies +2/+2 and 2 Kobolds | +1/+1 (gilded +2/+2); still 2 Kobolds (gilded 4) |
| Gemling | End of Turn: cast Veinstorm 3 times (gilded 6) | 2 times (gilded 4) |
| Frenzied Excavator | Tier 4 4/3, Shout: a Ruby on all your minions | ARCHIVED (`cards/archive.ts`) |
| Assembler (new, `k_assembler`) | | Tier 4 4/3, End of Turn: cast 2 Rubies on your other Kobolds (gilded 4) |

## How Assembler is built

- No new factory. It rides Alchemist Brisbane's `endOfTurnPlayRuby` with one new param, `excludeSelf: true`, which
  routes the target list through `othersOnBoard` (the R-TARGET-03 helper). Brisbane does not pass it and still
  includes herself.
- Each Ruby is a real Ruby play (base 1/1 plus the run's Ruby strength, `fireOnRubyPlayed` per landing), so Ruby
  watchers hear all of them and the count is N separate Rubies, not one of N times the size.
- It is declared in Frenzied Excavator's slot in `SET2_KOBOLDS`. Declaration order drives seeded pool picks, so a
  swap in place moves no other set-2 card.
- Set 2 only, like the Excavator: set 3 opts set-2 Kobolds in by id (`SET2_KOBOLDS_IN_SET3`) and neither card is on
  that list.

## Owner confirmations (same session)

- Gilded Assembler is 4 Rubies on each other friendly Kobold.
- "Other" is intentional: the Assembler never applies Rubies to itself. Pinned by the new test and declared in the
  Doc Bot `anotherMinionExcludesSelf` lane (`endOfTurnPlayRuby` excludes the source only when the card passes
  `excludeSelf: true`, so the lane now checks that any "other" card on this factory does).
- Art: the owner supplied `assembler.png`; wired as `art/minions/k_assembler.webp`. No crop entry in
  `cardArt.data.json` yet, so it uses the default framing until the owner tunes it.

## Judgement calls (owner to confirm)

- The owner's shorthand was read as the Ruby GAIN on each card, not the body: "mender goes down to 1 HP" = Rubies
  +1 Health, "cave cutter goes down to 2/1" = Rubies +2/+1, "crownvein goes down to 1/2" = Rubies +1/+2. All four
  are the gains the 10-10 batch raised, and a Tier 5 1/2 body would not make sense. Bodies are untouched.
- Assembler's tier and body were not given, so it took the Excavator's (Tier 4, 4/3).
- Printed text uses the house wording ("Cast 2 Rubies on your other Kobolds") for the owner's "Apply 2 rubies to
  all other friendly Kobold".

## Verification

- New `packages/sim/src/koboldBalance1011.test.ts`: every new number through the real reducer / End-of-Turn path,
  Assembler's targeting (other Kobolds only, never itself, never a non-Kobold, two Assemblers feed each other,
  Ruby strength folded), Brisbane unchanged, the archive / set membership.
- Re-pinned the tests whose numbers moved with the cards.
