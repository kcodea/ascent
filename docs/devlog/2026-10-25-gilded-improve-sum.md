# 2026-10-25 · A Gilded improver is the sum of its two best copies (R-GILD-SUM-01)

**Owner ruling (2026-10-25)**, asked what a Gilded Kennelmaster should give after its copies improved: "it should be at
the sum of the 2 highest buff values. so if you had a +16 and a +10 and gilded it, it should be at +26."

## What was wrong

`combineIntoGolden` (`packages/sim/src/reducer.ts`) stored Kennelmaster's accrual as `base + sb1 + sb2` (in steps), and
`scBeastAura` reads `(attack + stepAttack x summonBonus) x golden`, so the golden doubled everything the copies earned
and even a fresh triple read +8 against the printed Gilded +4. The universal-branch improvers whose read also doubles
the accrual (Trophy Stalker, Beardsley, Vicious, Alchemist Brisbane) doubled the summed accruals the same way.

## What changed

- `GOLD_SCALED_ACCRUAL_CARDS` (`packages/sim/src/recruit.ts`, now exported) is the one list of cards that pay
  `(base + step x accrual) x golden`. Trophy Stalker (`trophystalker`) and Alchemist Brisbane (`k_alchemist`) joined it.
- `combineIntoGolden` has a new first branch for those cards (except Pack Leader, which keeps its Mama Bear-family
  merge): the golden stores `(sb1 + sb2) / 2`, so the unchanged x2 read pays copy A + copy B exactly, and every later
  improve adds the golden step. The half can be fractional (the same half-count an in-place gild already leaves).
- Live text needed no change: `summonBuffText`, `summonEscalatingText` and `improvingRubyGrantText` already read
  `(base + accrual) x golden`, so they now print the summed value on every surface; combat reads the same field.
- Side effect: joining the list also means an in-place gild (Indy, Golden Touch) of Trophy Stalker / Alchemist
  Brisbane now halves the accrual instead of doubling earned value (the 2026-08-07 "earned value is EARNED" ruling).

## Left for an owner call

Pack Leader, Den Mother (Mama Bear) and Hunter keep the HIGHEST copy's accrual (an older "picks up the accrual at its
current value" ruling) and read it doubled, so a Gilded one gives twice its best copy, not the sum of the two best.

## Replays / saved runs

Replays are recorded frames and saved runs store the merged `summonBonus`, so nothing already gilded changes. Only new
triples use the new merge. No version gate needed.

Tests: `packages/sim/src/gildedImproveSum1025.test.ts`.
