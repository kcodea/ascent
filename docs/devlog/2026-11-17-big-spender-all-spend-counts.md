# 2026-11-17 Big Spender counts for every Gold-spent mechanic

**Owner ruling** (asked whether Big Spender works with Rope Wrangler): "i think all "spend" mechanics should function
in the same way, so yes it should. and we should word it appropriately". Oracle: `R-BIG-SPENDER-ALL-01` (supersedes
the Big Spender half of `R-SET2-EPIC-TRIBAL-1112-01`).

**Before:** `spendGold` doubled the `amount` its triggers heard, but left the run / turn tallies real. Every mechanic
that READ a tally (Rope Wrangler, Baby Gastrid, Patch Job, Rune of Spending, Ancient Wanderer, Nadja x War, Rayse x
Fortune, Brackus x Genesis), Indy's recharge, Summit's 70 Gold lock and the "Spend N Gold" quests ignored Big Spender.

**Now:** one place. `spendGold` adds Big Spender's extra to `goldSpentExtra` / `goldSpentExtraThisTurn`; every counter
reads `countedGoldSpent` / `countedGoldSpentThisTurn` (`packages/sim/src/goldSpent.ts`), including the combat side and
the recorded snapshot (mid-fight Baby Gastrid / Rope Wrangler) and every live text. The real `goldSpent` /
`goldSpentThisTurn` stay real for economy stats, match history, replay round stats, telemetry, achievements, the
announcer and the Gold fuse timer. New mechanics that count Gold spent must read the counted helpers.

Wording: Big Spender reads "Each Gold you spend counts **twice** for everything that counts Gold spent." Baby Gastrid
"per Gold" became "for each Gold"; Dragon Hoard / Gold for Grub bold the whole "**N Gold**"; Bulk Order "Every 10 Gold
you spend" became "Every 10 Gold spent"; Nadja x War / Rayse x Fortune dropped "you" ("for each Gold spent this turn").
