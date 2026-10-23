# 2026-10-23 - Set 3 Dwarf runes (Last Call, Return Customers) + five minion changes

Owner Set 3 changes ask 2026-10-23, applied as direct instructions. Bare rune names (R-RUNE-NAME-01), Dwarf-gated,
`sets: ['set3']`, cost 3 each. No rune art wired (not asked).

| Rune | Pool | Text | Built from |
| --- | --- | --- | --- |
| Last Call (`rune_last_call_set3`) | Basic, 3 | After you **Sell 3 minions**, your next **Dwarven Ale** casts twice. | `runeThreshold` on the `sell` meter + new `armAleRepeat` payload; `lastCallArmed` read in `spellCastsWithout` / `runeExtraCasts`, spent by `spendLastCall` at the four hand-cast sites (beside Shared Pour) |
| Return Customers (`rune_return_customers`) | Epic, 3 | The first **2 Dwarves** you **Sell** each turn return a plain copy to your hand. | combat flag `runeReturnCustomers` (Shop-only hook `runeReturnCustomers` in `fireOnMinionSold`); per-turn `returnCustomersThisTurn`, reset at the turn flip |

| Minion | Change |
| --- | --- |
| Mariet (`dw3_marketing`) | every 4 Sells now get a random Dwarven Ale (`minionSoldGrantSpell` + new `ale` param; Gilded 2). Meter unchanged. |
| Adeptus (`u3_adeptus`) | T3 -> T2; Echo: Shop spells +1 Attack (was +1/+1; Gilded +2). Stats 4/1 unchanged. |
| Gravus (`d3_gravus`) | T5 8/3 -> T6 10/3, gains Taunt. Echo and Dragon/Undead tribes unchanged. |
| Shardluck (`k3_facetbound`) | T6 8/5 -> T5 8/4; Choose One 2 Rubies / 2 Veinstorms (Gilded 4 / 4). Text "Play" -> "Cast". |
| Thymes (`dw3_thymes`) | T6 8/10 -> T5 5/7. Thymepiece unchanged. |

Oracle: R-DWARF-RUNES-1023-01..02 and R-SET3-CHANGES-1023-01 (`packages/rules/src/registry/approved/runes.ts`); the
Gravus (gifts.ts) and Mariet (triggers.ts) rules updated. Tests: `packages/sim/src/set3DwarfChanges1023.test.ts` plus the
existing card suites.

## Interpretations (flag to the owner)

- **"Gravis" is Gravus** (`d3_gravus`): no card is named Gravis; Gravus is the only card with that Echo. Its Dragon and
  Undead tribes stay.
- **Last Call name clash.** The archived Set 2 Avenge rune `rune_last_call` is also "Last Call". The validator allows it
  (the archived one is in no set), so the new one is `rune_last_call_set3` (the Menagerie twin convention).
- **Last Call repeats** every 3 Sells (a running meter, like Ruby Sales), but **at most one charge waits** (the Opened
  Vault shape): selling 6 before casting an Ale still gives one doubled Ale. The charge waits across turns.
- **Only an Ale cast from hand** spends it (the cast multipliers apply only to hand casts, R-MULT-06): Pourman's Keg,
  a rune or a minion casting an Ale neither doubles nor spends it. A second copy of the rune adds one more cast.
- **Return Customers**: a "plain copy" is a fresh, non-gilded body at printed stats (plus the run-wide card buffs every
  fresh copy gets). A full hand gets nothing and the sale still uses one of the two. One copy per rune copy held. The
  live remaining count is the rune's N/2 badge (counting up), not prose in the text (the integer-counter convention).
- **Shardluck "2 Rubies" = 2 in total**, each on a random other friendly Kobold, the same reading the old "3 Rubies"
  had. "Cast" replaces "Play" in the text per the owner's wording; the mechanic is the same Ruby cast.
- **Adeptus keeps 4/1** at Tier 2 (the ask named no stats).
- **Mariet's Ale** comes from the run's Ale pool with no tier gate (the Gold-spent Ale recipe), not the Shop-spell pool.

## Not done / follow-ups

- Content change: **versus-resolve needs a redeploy after merge** (parity).
- The `sell` meter ticks in `settleMinionSale`; Parting Gifts and the Altar sell without it (pre-existing, shared with
  Ruby Sales). Return Customers hears them (it rides `fireOnMinionSold`).
