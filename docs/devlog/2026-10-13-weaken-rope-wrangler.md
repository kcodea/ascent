# 2026-10-13 · Weaken shows its Health drop; Rope Wrangler gets a Gold-spent counter

Owner (Set 2 fixes): "weaken is simply not working, please fix this. it should SET an enemy minion's health to 1 at
start of combat." and Rope Wrangler "needs a gold spent counter under him in recruit phase."

## Weaken: root cause

The engine was right all along. A Shop cast banks `pendingWeaken`, `questCombatMods` carries it as `weakenTargets`
(on the player's run AND on a served snapshot), and `simulate`'s Start-of-Combat rune pass sets a random living enemy
above 1 Health to `health = 1`. The fight then resolved against 1 Health.

The screen never showed it. The only event the pass emitted was a narration `sc` ("X is Weakened to 1 Health"), and
the replay's board fold (`computeFrame` in `useCombatReplay.ts`) reads Health only from `dmg.remainingHp`, `buff`,
`reborn`, `poison` and `death`. So the weakened card kept its full Health on screen until it was hit, then died to a
blow that "should" not have killed it. To a player, the spell did nothing.

## Fix

- `CombatEvent` `sc` gained an optional `setHealth?: number` (shared type, additive). The Weaken pass stamps
  `setHealth: 1`.
- `computeFrame` folds it like `remainingHp` (absolute), and also resets the Ashen Heir max-Health track for that uid.
- `socBoard` (snapshot.ts, a test/fidelity helper) folds it too, so an enemy's Weaken on your board reads right.
- Beat/FX: unchanged and already present. The `bankedCast` marker shows the Weaken card, then the `sc` (cast: true)
  is its own step, which flashes the target (`sccast`) and rings the cast sound. The Health number now drops on
  that same beat. No `spellId` was added to the `sc` on purpose: that would fire the cast-preview card a second
  time (the `bankedCast` already showed it).
- Gilded/repeat: spells are never golden; each cast banks one more target (`count`), unchanged.
- Edge: when every enemy is already at 1 Health there is no legal target. The cast beat still shows; nothing changes.

Oracle: `R-WEAKEN-01` in `packages/rules/src/registry/approved/combat.ts`. Test: `packages/ui/src/weakenSetsHealth.test.ts`
(Shop cast, End Turn, next fight, replay frame; plus the enemy-cast side).

## Rope Wrangler counter

`stepProgress` (cardText.ts) gained a branch for any End-of-Turn `castSpell` with a `perGold` repeat: the turn's
Gold spent toward the next repeat, cyclic like the other gold meters, labelled `N/10 Gold`. Fed from
`live.goldSpent` (`run.goldSpentThisTurn`) in `instView`, so it renders in the existing `.stepcounter` pill under
the board minion. Combat passes no `goldSpentTurn`, so no counter there. Hidden at 0 like every shop counter. It
reaches 10/10 at exactly 10 Gold, which plays the stock step-proc burst (the repeat was earned). No new CSS,
no animation, memoized path unchanged.

Judgement call: the counter shows progress toward the NEXT repeat (`4/10 Gold`), not the raw total spent. The text's
`(xN)` already prints the earned cast count.
