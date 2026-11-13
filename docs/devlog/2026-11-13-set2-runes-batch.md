# 2026-11-13: Set 2 rune batch, combined (42 runes: 24 Basic, 18 Epic)

The owner's 40-rune Set 2 batch (design: `docs/design/2026-11-12-set2-rune-batch.md`, primary checkout only),
built as four parallel slices off the same `origin/main` and merged here into one branch (`feat/set2-runes`).
Every rune is `sets: ['set2']`, glyph art only.

## The four slices

| Slice | Runes | Devlog |
|---|---|---|
| Basic neutral (9) | Piggy Bank, Hazard Pay, Second Opinion, Shield Wall, Shatterproof, Warm-Up, Golden Handshake, Late Bloomer, Loyal Customer | `2026-11-13-set2-runes-basic-neutral.md` |
| Basic tribal (14) | Deep Pockets, Rowdy Crowd, Bloodscent, Last Howl, Trophy Hunter, Pitchforks, Imp Legion, Guel's Apprentice, Collections, Flamekeeper, Hatchling Roost, Dragon Hoard, Ruby Dust, Rough Cut | `2026-11-13-set2-runes-basic-tribal.md` |
| Epic neutral (7) | Top Shelf, Double Bill (was "Opening Act"), Bulwark Line, Wholesale, Grudge, Bastion, Mirror Sheen | `2026-11-13-set2-runes-epic-neutral.md` |
| Epic tribal (10) | Big Spender, Royal Treasury, Feral Return, Pack Tactics, Blood Frenzy, Hellfire, Wildfire, Elder's Voice, Vein Finder, Gem Rain | `2026-11-13-set2-runes-epic-tribal.md` |

Merged in that order, one `--no-ff` merge per slice. Then two owner additions, built here:

- **Iggy Iggy** (Epic Dragon, 3): "Get an **Immune Iggy** with **Ward**." Pure data, the Badger shape
  (`{ kind: 'grant', cards: ['d3_iggy'], grantKeywords: ['DS'] }`): one Immune Iggy (the Set 3 card; `CARD_INDEX` is
  global) on pickup, Ward stamped on that copy only. A full hand follows every grant rune: the rune turn allows 20 in
  hand, then the board, then the hand over-caps. Rule R-SET2-RUNE-IGGY-01.
- **Shop Madness** (Basic neutral, 1): "Minions in your Shop have **+3/+3**. Your Shop always has **6** minions."
  Owner rulings: the +3/+3 is ongoing (it is the permanent run-wide Shop buff, `applyRunShopBuff`, added on pickup), and
  the Shop refills whenever a minion leaves it for any reason. Engine: `refillShopMadness` in `shop.ts` draws from the
  seeded pool (Tier ceiling, run tribes, copy limits) into the vacated slot; `rollShopRow` and `topUpTavern` build the row
  to 6 minions at every Tier; the consume chokepoint (`consumeShopOffer`) and the steal chokepoint refill mid-action, and
  `settleAction` refills everything else at the action boundary by diffing the row. Row spells, Rubies, the spell slot
  and the Starform are not counted. A refill never removes an offer, so it cannot recurse; a dry pool leaves the row
  short. Hydraskus + 6 Demons at a Tier 1 Shop: all 7 eat and the row ends at 6 (3 eat without the rune). Shop-only:
  combat and snapshots never read it. Tests: `set2ShopMadness.test.ts`. Rule R-SET2-RUNE-SHOPMADNESS-01.

## Conflicts resolved

Every conflict was two builders appending to the same list; each was resolved by keeping both sides in slice order.

- **Appended lists:** `RUNES` / `EPIC_RUNES` and `RUNE_DUP_SWEETENER` (runes.ts), the `QuestCombatFlagSchema` whitelist
  and the `recurringEndOfTurn` effect enum (schema.ts), the `QuestCombatFlag` union, the `recurringEndOfTurn` effect
  union and the `QuestCombatMods` fields (types.ts), `questFlags` + `questRecurringEndOfTurn` + the run-state fields
  (state.ts), the `questCombatMods` builder (reducer.ts), the EoT label map + `socRuneReplaysOf` Shop replays
  (recruit.ts), `PRESENTATION_POLICIES`, the fuzz boolean-mod list (a missing trailing space would have glued two
  flag names together), the `@game/core` / `@game/sim` index exports, the rules registry, `runeTally` imports,
  `tallyCoverage` and `tribeGate` test tables.
- **Text seams:** where both slices appended at the very end of a list, git cut the shared closing lines (`sets: [...]`
  and `},`, or a rule's `},`, or the `}` `}` closing a Start-of-Combat rune block). Restored each by hand.
- **One real overlap, folded together:** `offerBuyPrice` (reducer.ts). Loyal Customer (Basic neutral) added a
  `noDiscount` override; Wholesale (Epic neutral) added `wholesaleOff` gated on `!freeBuy`. Combined: Wholesale is now
  gated on `!noDiscount`, and the return carries `loyalFree`. A Loyal Customer free buy stays 0.
- **Ward-loss listeners:** Shatterproof (`registerShatterproof`) and Bastion + Mirror Sheen (`registerWardRunes`)
  each register their own `onLoseDivineShield` listener; both are kept, registered in that order at combat start and
  on a stepped-in Duos board. No duplicate helper or meter reset was found: the per-turn resets (Deep Pockets /
  Rowdy Crowd windows, Elder's Voice) touch different fields.
- **Generated files** regenerated, not hand-merged: `npm run contracts:extract`, `docbot:text`, `rules:seed`
  (`extracted.generated.ts`, `pendingWording.generated.ts`, `pending.generated.ts`, `docs/rulebook/TRIAGE.md`).
  `docs/docbot2/final-report.md`'s contract total set to 1225 (1183 + 42) so `docbot:report -- --check` agrees.

## Pinned counts set to the combined values

| Pin | Value |
|---|---|
| `RUNES.length` (runes.test.ts) | 231 (207 + 9 + 14 + Shop Madness) |
| Set 2 pool Basic / Epic (set3RuneRoster.test.ts) | [151, 132] (+24 Basic, +18 Epic) |
| Combat-mod inert queue (combatModLane.test.ts) | 140 (125 + 3 + 5 + 2 + 5) |
| Gold-runes outside the economy grammar (textOracleEconomy.test.ts) | 12 (8 + 3 + 1) |
| Unresolved text-parse cap (textParse.test.ts) | 218 (measured: 217 for the forty, the slice pins summed to 209; +1 Shop Madness) |
| Strategy package census (packages.test.ts) | ale 37, demonConsume 20, economy 31, tempo 42 affine runes (measured) |
| Doc Bot contract total (final-report.md) | 1225 (1183 + 42) |

## Interactions the slices could not test alone

New file `packages/sim/src/set2RunesCombined.test.ts`, seeded:

- **Bastion x Shatterproof:** Bastion's returned Ward breaks again and Shatterproof pays both losses: +10/+10
  permanent on one minion (+5/+5 alone).
- **Mirror Sheen x Shatterproof:** Shatterproof hears the loss first, so the reflected hit carries the new Attack.
  A 7-Attack Warded minion with Bastion reflects 12, then 17 (7 and 7 without Shatterproof).
- **Hellfire x Pitchforks:** a dying Demon's Echo resolves first (its Imp arrives and Pitchforks throws 3 at 2
  enemies), then Hellfire's death volley. Knocked Imp's death, the Imp's swing and the Imp's death make 3 volleys.
- **Wildfire x Pitchforks:** an enemy killed by Pitchforks died to non-attack damage, so Wildfire fires.
- **Wildfire x Imp Legion:** the grafted Echo's kill also counts as non-attack damage and fires Wildfire.
- **Hellfire x Imp Legion:** the Imp is a Demon, so its death fires both its Echo (a 3 to the lowest-Health enemy,
  first) and Hellfire's volley.
- **Big Spender x Deep Pockets:** the per-turn 8-Gold window hears each Gold twice, so 4 Gold of Refreshes pays the
  random Dwarf (nothing alone).
- **Second Opinion x Grudge:** the lost-combat Discover from the Tier above offers 4 options (3 without).

## Open behaviour calls (the owner can overrule)

- Top Shelf fires only on a pressed Refresh.
- Grudge and Hazard Pay pay out at the start of the next turn, and a draw is not a loss.
- Double Bill fires once with a single Shout minion.
- Pitchforks and Imp Legion work in combat only (the Shop has no enemies).
- Bloodscent, Trophy Hunter and Blood Frenzy count only kills made by attacking.
- "Your Dwarves/Dragons" means the board, not the hand.
- Golden Handshake fires on any Gilded card gained.
- Second Opinion's extra option applies to every Discover.
- Piggy Bank's End of Turn stats go to a random minion per repeat.
- Loyal Customer counts the Starform but not re-buying a displaced minion.
- Feral Return skips Beasts that already have Rise.
- Hellfire's attack half fires at wind-up.
- Elder's Voice is not repeated by Twilight.
- Wildfire has no live "x/3" counter yet.
- Shop Madness: the Starform takes a +3/+3 like every Shop minion (it follows the run-wide Shop buff), and a refill made
  inside a frozen Shop is part of that frozen Shop.
- Shop Madness: a second copy adds another +3/+3; the row size stays 6.
