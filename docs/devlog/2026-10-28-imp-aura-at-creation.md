# 2026-10-28 — Every Imp is born with the Imp Aura (R-IMP-AURA-01)

Owner report: "i discovered an imp from the underdweller hero power but it didnt have my imp's buffs on it. this is a bug".

## Cause

The Imp Aura (`RunState.impBuff`) is BAKED into a held Imp's stored stats. Combat re-adds it only to a from-base body
(summon / Reborn), and `buffImpsRunWide` and the settle carry-back pay the Imps you already hold. So every place that
MAKES an Imp has to bake it once. Only the shop summon (`makeContext().summon`) did, by hand. Every other creation site
calls the shared creation-aura helpers `undeadBuyBonus` (attack) and `buyHealthAura` (health), which knew the Undead /
Beast / Magnetic channels but not Imps. So a Discovered Imp (Underdweller, via `takeDiscoverPick` → `conjuredStats`), a
bought Imp (Membrance restock), a combat hand-grant and a Trophy copy all arrived at the printed 1/1.

## Fix

- The Imp Aura now lives inside `undeadBuyBonus` / `buyHealthAura` (`def.imp`). The two hand-written copies of it
  (`bakedAuraOf` and the shop summon) were removed so it is paid exactly once. Every creation site now gets it.
- Audit of sibling creation paths that skipped the creation helpers altogether (R-AURA-01: "plain copies remain plain
  but receive any independently applicable Aura"): `conjurePlainCopy` (Re-Pete's Second Hand, Gorr's Four Peat),
  Rune of the Golden Splinter's golden minion, and Warband Recruiter's Shop summon body now use `conjuredStats`.
- UI: the Discover window shows a minion option at the stats it will land with (`conjuredStats`, or Second Path's set
  stats), and a Shop Imp offer previews the Imp Aura (under Tribe Bond, like the buy bakes it).

Left alone on purpose: `swapWithTavern` (Displacement / Darah) documents a placement at base + offer buffs; Gildcrafter's
third copy merges at once and only the top two copies count; Ancients' set-stat bodies.
