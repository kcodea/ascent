# 2026-09-26 — "Attacks immediately" cuts the line (R-ORD-05)

Owner bug: *"the rune of living echoes revealed some ordering issues - when there would be space, the sunmane
would get summoned, but then would wait for an attack to go off before the sunmane attacked ... a "attacks
immediately" mechanic cuts the line. this doesn't interrupt a flurry attack, but it does interrupt other attack
orderings if something is summoned to attack immediately."*

**Layer: the simulator** (`packages/core/src/combat/simulate.ts`). The event log itself had the wrong order; the
UI replays the log in order and has no attack-on-summon special-casing, so the choreography was faithful to a
wrong log.

## Root cause

Every "attacks immediately" summon DEFERS onto `pendingAttackOnSummon` and lands at the next
`flushImmediateAttacks`. The main loop ran, after each attack:

    flushImmediateAttacks() → flushResummons() → fillFreeSlots()

Rune of Living Echoes summons inside `fillFreeSlots`, i.e. **after** the queue had already been drained. Its
Sunmane sat queued until the next flush, which was the NEXT attacker's wind-up flush inside `performAttack`,
and that runs after the `attack` event. Repro (7-wide board, the 1/1 dies to retaliation):

    before: death m0 · rune fires · attack enemy m7 · summon Sunmane · Sunmane attacks · m7's hit lands
    after:  death m0 · rune fires · summon Sunmane · Sunmane attacks · attack enemy m7 · ...

A second, latent instance of the same rule: the wind-up flush drained **every** deferred summon, including one
queued by swing 1 of a Flurry (e.g. killing a Violet Whelp), so the Whelp landed between the Flurry's lunge and
its second hit.

## Fix

- `settleBetweenAttacks()`: flush → resummons → fill, **repeated while anything is still queued** (the Sunmane's
  own strike can free another slot). Used after every main-loop attack and once before the rotation. Bounded by
  the per-combat rune counters and `IMMEDIATE_ATTACK_GUARD`.
- Deferred summons carry a `seq` stamp; the wind-up flush (`flushImmediateAttacks(true, windupSeq)`) drains only
  summons stamped during THIS swing's wind-up. Earlier-swing summons wait for the exchange to end and land at the
  settle. The 2026-09-01 Echohorn ruling (wind-up summons strike before the swing lands) is unchanged.
- Normal order: the immediate strike never touches `lastAttacker`, so the rotation resumes where it was. The
  body is appended at the right and takes its regular rotation turn too (existing `attackOnSummon` contract:
  "then joins the normal rotation"). Reported to the owner as a decision point, not changed.

## Sources audited

Deferred-summon lane (all fixed by the settle): Living Echoes' Sunmane (the only one summoned AFTER the flush),
Kurse's Golem (`charge`), Heart of the Mountain Gemheart Golems, Violet Whelp / Cindara's Hoard / Tamer's whelp
(`attackOnSummon` tokens), Spear Warden (Steadfast Champion, Rune of the Spearline), Charging Soldier, Trooper,
the 4/1 Beast token. Existing-body strikes (`ctx.attackNow`: Solaris Fang, Warpath, Stolen Initiative,
Forthcoming, Bloodlust, Feeding Line, Arena Heckler) share the queue and now also drain before the next attacker
when queued by a fill-time summon.

## Replays / goldens

Full `npm test` after the fix: the only failure was a Doc Bot source tripwire
(`docbot/onAttackStatTiming.test.ts`) matching the literal `flushImmediateAttacks(true)`; relaxed to accept the
new `fromSeq` argument. **No golden, replay or snapshot fixture changed.** Outcomes differ only in fights with
Living Echoes mid-combat, an immediate summon made from a fill, or a Flurry swing 1 that spawns an immediate
attacker. Recorded opponent boards are stored data and are unaffected; an old replay re-simulated under these
conditions would play out differently.

Tests: `packages/sim/src/attackImmediatelyOrder.test.ts` (4 of 7 fail without the fix; the Whelp/Kurse/rotation
guards pass both ways). Oracle: `R-ORD-05` in `packages/rules/src/registry/approved/ordering.ts`. Patch note:
Systems.
