# 2026-09-10 — Shop-stat provenance: a per-source ledger, one buff line per source, the Reinvestment counter (R-PROV-01)

**Owner ask (2026-09-10):** Rune of Reinvestment should show how much it has buffed the Shop in a counter on its
badge during combat, and appear as a SEPARATE buff on shop minions ("Rune of Reinvestment: +x/+y"). And: "this
should also be part of docbot's oracle — we should be extremely specific from where stats and buffs came from,
referencing individual runes if necessary. It'll help to parse out bugs."

## Before

The run-wide shop channel `tavernBuyBonus` was one anonymous `{atk,hp}` pair. Every contributor — Staff of Guel,
Contract Butcher, Enigma, Demonic Anomaly, a quest reward, Rune of Remains, Rune of Reinvestment — collapsed into
it, and the buy path relabelled the whole channel **"Staff of Guel"** on the bought minion; the shop offer's
breakdown printed one **"Tavern"** line; the Buffs panel one "Shop Stats" row. The Reinvestment badge had no
counter at all (its text trips none of the tally-coverage regexes).

## Now

- **The ledger.** `RunState.tavernBuyBonusSources: Record<source, {atk,hp}>`. Every writer of the channel credits
  it through `creditShopBuffSource` (`applyRunShopBuff`, the arena `gainShopBuff` verb, the Staff spell, the
  combat carry-back). Combat tracks its own `tavernBuyGainSources` (the rune name, or the body's name off its
  uid) and emits `CombatResult.playerTavernBuyGainSources`; the reducer credits each on settle.
- **One buff line per source.** The buy path bakes one `addBuff` per ledger entry (remainder → "Shop Stats", so a
  legacy save still sums); the shop offer's inspect breakdown prints the same lines; the Buffs panel itemizes
  beneath its total.
- **The Reinvestment badge.** Shop: what the rune alone has given (`runeTally` off the ledger). Combat: the buff
  this fight has earned so far, `+N/+N` per friendly summon per copy held (`runeCombatTally`, fed by the replay's
  summon delta); the combat meter now wins over the shop meter during a replay.
- **Doc Bot LAW 4** (`conservationLaws.test.ts`): after every fuzzed action the ledger sums to the channel exactly
  and carries no catch-all label; sabotage-tested. **R-PROV-01** in the oracle states the rule.

## Not covered (deliberately)

The per-turn `tavernBuyBonusTurn` layer (Merchant's Chorus, Night Market Horror) still bakes as "Shop Enchant" —
it is a this-turn offer enchant with two writers, not the permanent channel. Extend the ledger there if it ever
grows a third writer.
