# 2026-11-15: Set 2 rune balance pass (Grudge, Hazard Pay, Collections, Drunk Shopkeeper)

Owner balance pass, branch `balance/runes-1115`. Four Set 2 runes, all in `packages/content/src/runes.ts`.

| Rune | Before | After |
|---|---|---|
| Grudge (`rune_grudge`, Epic) | cost 3 | cost **0**, **Gain 10 Armor** on pick; the lost-combat Discover is unchanged |
| Hazard Pay (`rune_hazard_pay`, Basic) | lost combat: 3 Gold + 1 free Refresh | **Gain 5 Armor** on pick; lost combat: **4 Gold + 2 free Refreshes** |
| Collections (`rune_collections`, Demon) | Demon sold: Shop +2/+2 permanently | Shop **+3/+2** permanently |
| Drunk Shopkeeper (`rune_drunk_shopkeeper`, Dwarf) | Ale cast: Shop +1/+1 permanently | Shop **+2/+2** permanently (still the lasting run-wide Shop buff from #2701) |

## The new primitive: on-pick Armor

No rune granted Armor when taken, so this adds the smallest data field: `RuneDef.armorOnPick` (core `types.ts`, content
schema whitelist). It is paid in `applyQuestReward` (reducer.ts) when `sourceKind === 'rune'`, the one chokepoint every
rune copy flows through: a bought rune, Rune of Duplication's copy, a `grantRune` reward and God Mode. Banked re-fires
arrive as `'quest'`, so they never pay it twice. `gainRunePickArmor` adds to `armor` and lifts `maxArmor` to fit.

It is ordinary run Armor: in a lobby the seat re-seeds from the run before the round's hit (the Mend fix of 2026-09-10),
so it absorbs before Resolve. Pinned by a lobby test in `set2RunesEpicNeutral.test.ts`. Oracle: **R-RUNE-PICK-ARMOR-01**.

Not an effect factory, so no `EffectFactoryId` / policy-registry entry. No beat: the presentation `resourceChanged` event
has no Armor resource, and the Armor bar updates on its own.

## Readings (flag to the owner)

- **Duplicates pay the Armor again.** Neither rune is in the duplicate sweetener or unique sets, so a second copy re-applies
  its reward, and the Armor comes with it (two Grudge = 20 Armor). Each copy is "taken".
- **Text puts the Armor first**: "Gain **10 Armor**. After you lose a combat, ..." (and the same for Hazard Pay), matching
  how other one-shot-plus-ongoing runes read ("Get a Staff of Guel. Repeat every turn.").

Numbers: `SET2_BASIC_NEUTRAL.hazardPay`, `SET2_TRIBAL_RUNES.collections`, `DRUNK_SHOPKEEPER_GRANT`. Tests updated:
`set2RunesBasicNeutral`, `set2RunesBasicTribal`, `set2RunesEpicNeutral`, `set2ShopRunesGrubQuarterDrunk`.
