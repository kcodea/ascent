# 2026-10-20: a newly found hero power arrives ready

**Owner report:** "copy machine came spent - i had used masterwork before this, maybe that's why? it should reset
from finding a new hero power tho"

**Root cause.** The once-per-game latch (`heroPowerSpent`) and the whole-game use count (`heroPowerUses`), plus their
Void slot-1 siblings, are SLOT fields on `RunState`. `seedAdoptedPower` reset them for the arriving power, but inside its
once-per-run guard (`seededPowers`), so only on a hero's FIRST adoption. A Mimic who wore Copy Machine once, later wore
Masterwork and used it, then found Copy Machine again got the slot's spent flag from Masterwork: dead on arrival. The
same leak covered use counts (Jenkins's dig price could read Gildmaster's uses) and native passives that keep running
after a Power Shifter (Drakko's / Chronos' quest completion and Runesmith's forge wrote `heroPowerSpent`, which by then
belonged to the shifted-in power).

**Fix.** Spend state now belongs to the power. `swapPowerLatch` (heroes.ts) runs on every gain path at the moment of the
swap: it files the outgoing power's latch in `RunState.powerLatches[heroId]` and loads the incoming power's own latch,
fresh when absent. Gain paths: Mimic's pick, Void's `void1` / `void2`, Power Shifter, Second Calling (archived, still
wired). The reset was removed from `seedAdoptedPower`. Native passives read and write their own latch through
`powerLatchSpent` / `markPowerLatchSpent` (Runesmith's forge marks the power that holds the forge).

**Kept on purpose.** A power found again keeps what it spent itself: a Mimic re-finding a used Masterwork gets no free
Gild (it also keeps its 75 Gold recharge threshold). This was the intent of the old guard, which in fact leaked the
other way too (re-finding Masterwork after an unused Copy Machine gave a fresh Gild).

Rule: R-HERO-POWER-FRESH-01. Test: `packages/sim/src/heroPowerArrivesReady.test.ts`.
