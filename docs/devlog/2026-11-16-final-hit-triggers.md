# 2026-11-16: the final hit finishes its triggers (R-FINAL-HIT-01)

Owner ruling: "The final kill or death etc still needs to finish all triggers."

## What we found

The combat end is already judged in one place, the attack loop head in `simulate.ts`, and only after
`performAttack` and `settleBetweenAttacks` have drained everything the last swing set off (deaths, Echoes, Avenges,
Slaughters, immediate attacks, space fills). No trigger family is cut short by the fight ending. A probe matrix
(`packages/core/src/combat/finalHitTriggers.test.ts`) runs each decisive event twice, once ending the fight and once
with an untargetable 0/1 Stealth bystander that keeps it going, and compares the payouts: Pummel (Ancient and
keyword), Slaughter (plain and mutual kill), Avenge (gold and summon on a mutual kill), rune Avenge (Blood and Coin
on the last friendly death), Echo summons (last enemy, last friendly), Rune of the Trophy, First/Last kill records
and damage watchers. All matched except one.

## The bug

Flash x Ancient of War ("Pummel (400): get a copy of a random enemy minion. Twice per combat."). The crossing is
noted at damage time (`noteAncientPummel`, from `applyDamage`), when the struck body is already at 0 Health and out
of the living pool. When that hit felled the LAST enemy, the pool was empty, no copy was given, and a payout was
still counted.

## The fix (judgement call)

The pool stays the living enemies, so mid-fight picks and RNG draws are unchanged. When none remain, the copy is of
the body the crossing hit just struck (it was an enemy minion when 400 was crossed; Flash's own Last claim copies
killed bodies the same way). The payout is counted only when a copy is given. Symmetric for the enemy side.

## Not changed

The Avenge report could not be reproduced in the engine: every Avenge row (minion, rune, hero) pays on the final
death. If it was seen on screen, the likely cause is presentation: the final hold (`choreo/finalHold.ts`, 900 ms
divided by speed) has a floor only for Pummel, so FX on the last beat can be cut by the end-of-combat handoff at
high speed. That is Mike's area and is left as a follow-up.
