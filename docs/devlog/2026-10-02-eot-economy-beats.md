# 2026-10-02: End-of-Turn economy beats (Shopkeep, Tradesman x Time, and the rest)

Owner ask (verbatim): "make sure when we have end of turn things that they have beats and modify what they need to.
for example rune of shopkeep and frugal with the ancient of time modifier - nothing plays or shows that that is
happening at all. please make sure these triggers have a beat. use the self buff burst fx on the shop tier button
when this effect triggers"

## Root cause (reproduced by compiling the live End-of-Turn batch)

- **Rune of Shopkeep** compiled a real own-beat (`rune:rune_shopkeep:endOfTurn`) with a `resourceChanged: upgradeCost`
  consequence. But the Recruit presenter for `resourceChanged` was a no-op ("HUD counters read the projection"), and
  the Tier stone read `upgradeCostOf(run)` from the COMMITTED run, not the projection. The price therefore changed
  only at the commit, when the Shop was already leaving for combat. A rune-sourced beat has no unit to pulse, so the
  beat played a trigger sound and nothing else.
- **Tradesman x Ancient of Time** (and Robin x Time, Xerox x Fortune) compiled a beat with **zero consequences**. The
  recurring entry runs inside `withRecruitTrigger`, whose diff covered stats, cards, keywords, shop offers and auras
  but never the Shop economy. Same for cards that bank next-turn Gold at End of Turn (Scrap Vendor, Starbroker Nym).

## Fix

- **Sim** (`recruit.ts`): `withRecruitTrigger` now diffs the Shop economy while End of Turn is resolving
  (`spec.phase === 'endOfTurn'` or inside `applyEndOfTurn`, so a spell cast at End of Turn counts too): the upgrade
  PRICE (`tradesUpgradeCost`, equal to `upgradeCostOf`: Frugal's +2 and every cut folded in), free Refreshes,
  next-turn Gold and max Gold (`maxEmbers + maxGoldBonus`). One `resourceChanged` per moved resource, in a fixed
  order. Rune of Shopkeep's own emit now carries the printed price too. Gameplay untouched: the diff only reads.
- **UI**: `choreographer/resourceFx.ts` maps each resource to its HUD control (upgrade price to the Tier stone
  `.tvbwrap`, free Refresh to `.rfbwrap`, Gold to `.goldpill`) and the authored `self-buff-burst` def, used as-is.
  The `resourceChanged` presenter plays it there on the beat. `onProjection` folds the delivered deltas into
  `eotResources`, which the Tier cost, Refresh cost / free count and next-turn Gold props add, so the price drops
  WITH the burst, not before. The deltas are read only while the End-of-Turn lock holds (`eotAnimating`), which
  is released in the same tick as the commit, so the HUD never counts a cut twice.
- **Tests** that fence direct `playDef` calls: `self-buff-burst` joins `fx/directCalls.ts` and `playDefUids.test.ts`'s
  `UNIT_LESS` (it fires at a HUD control, never a unit).
- **Replays** play the recorded batch through the same presenter, so they get the same bursts (tested on the
  recorded batch).

## Audit (every End-of-Turn trigger that moves a Shop number)

| Trigger | Before | Now |
| --- | --- | --- |
| Rune of Shopkeep (upgrade -3) | beat, no visual, price at commit | burst on Tier, price drops on the beat |
| Tradesman x Time (upgrade -3, eats Frugal's +2) | empty hero beat | same as Shopkeep |
| Robin x Time (+1 max Gold) | empty hero beat | burst on Gold pill |
| Rune of the Coffers (+1 max Gold per copy) | beat, no visual | burst on Gold pill |
| Xerox x Fortune (4 Gold next turn per pair) | empty hero beat | burst on Gold pill, next-turn Gold in the tip |
| Scrap Vendor, Starbroker Nym (Gold next turn) | minion pulse, Gold silent | plus a burst on Gold pill |
| Any future End-of-Turn source of these four numbers | silent | caught by the generic diff |

Not changed, listed for the owner: Tradesman x Bonds (per Refresh, Shop phase: the price updates instantly, no beat);
the turn-start per-wave upgrade discount (Start of Turn, not End of Turn); Rune of Amplification (End of Turn,
amplifies unused Equipment with no beat; not a Shop number, needs an Equipment target ruling); the Ancient-of-Time
hero beats still emit no `policyKey` (a `missingPolicyKey` diagnostic, shared by every Ancient recurring entry).

Oracle **R-EOT-ECON-01** (`packages/rules/src/registry/approved/economy.ts`); test
`packages/ui/src/choreographer/eotEconomyBeats.test.ts`.
