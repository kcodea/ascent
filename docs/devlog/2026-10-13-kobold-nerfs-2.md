# 2026-10-13 · Kobold nerfs, second pass

Owner: "i have some additional balance adjustments to kobolds. they are still a bit overtuned". Follows the
2026-10-11 batch (`2026-10-11-kobold-nerfs-assembler.md`).

## What changed

| Card | Before | After |
|---|---|---|
| Veinstorm | Casts a Ruby on your minions AND the Shop | The Shop only (the pre-10-10 card, text included) |
| Drunk Daniel | End of Turn: Shop spells +2/+2 (gilded +4/+4) | +1/+1 (gilded +2/+2). Body unchanged (T6 6/6) |
| Gemling | End of Turn: cast Veinstorm 2 times (gilded 4) | Cast Veinstorm once and get a Ruby Transfer (gilded: twice, 2 Transfers) |
| Party Crasher | Avenge (2): 3 Rubies on your Kobolds, gone after the fight | The same Rubies, permanent (gilded 6) |

## How each is built

- **Veinstorm** drops its `minions: true` param. Nothing else changed: `spellBuffShopByRuby` still honours the param
  and so does the combat split in `battlecryCastNamedSpell`, so the minion half is a one-param switch if it returns.
  A probe spell in the new test keeps that dormant path pinned.
- **Everything that casts Veinstorm follows it**, because they all cast the real spell: a played Storm Chaser,
  Shrieker's End of Turn re-fire and Gemling gem the Shop only. Storm Chaser's COMBAT re-fire still casts on its
  own beat and banks its Shop half for settle, but no live Ruby lands on the fighting minions any more.
  R-STORMCHASER-01 is amended to say so (same rule, narrower today).
- **Gemling** keeps `castSpell { times: 1 }`, so a Gilded Gemling's two casts are still one beat each, and adds
  `battlecryGrantSpell { spellId: 'rubytransfer' }` at End of Turn, the trigger-agnostic grant this card used before
  2026-10-10. Its `factory:battlecryGrantSpell:endOfTurn` presentation policy row is back.
- **Party Crasher** passes `permanent: true` to `avengePlayRubies`, which now threads it to `playRubyOn`, the
  carry-back flag Boulderdash uses. The card's comments had said "permanent" all along, but combat Rubies became
  temporary on 2026-07-31 and this Avenge never opted back in, so its Rubies had been ending with the fight.
- **Drunk Daniel** is a number change on `battlecryGrantSpellPowerRun`.

## Judgement calls (owner to confirm)

- "drunk daniel should go from 2/2 to 1/1" was read as the +2/+2 he gives Shop spells, not his 6/6 body.
- Gilded Gemling doubles both halves (two casts, two Ruby Transfers).
- Storm Chaser was not named, but it casts the real Veinstorm, so it lost the minion Rubies too, in the Shop and
  in combat. Keeping them on Storm Chaser alone would have meant a second, different Veinstorm.
- Party Crasher's text now reads "3 permanent Rubies", Boulderdash's wording.

## Verification

- New `packages/sim/src/koboldBalance1013.test.ts` (22 tests): each change through the reducer, End of Turn and
  `simulate`, plus a counter-probe showing the same Avenge WITHOUT `permanent` carries nothing back.
- Re-pinned the tests whose numbers moved, and regenerated the Doc Bot contract files (`npm run docbot:sync`).
