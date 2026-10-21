# 2026-10-20 — Random-minion pickers only hand out legal minions (R-RANDOM-POOL-01)

**Owner reports (2026-10-20):**
- "a player just got elderhorn from a bullseye from funeral on loan - that shouldnt be possible."
- "orivax can be granted from the rune that gives a dragon when you sell 5 minions. that also should not be possible."

**Why they slipped through.** Elderhorn (`b2_elderhorn`) and Orivax (`d2_orivax`) are ordinary Tier 7 minions of
Set 2. They sit in the set's `buyable` pool like any other minion; the Shop never offers them only because it caps at
your Shop tier, and a normal run's Shop tier tops out at 6 (`maxTierFor`, `hasTier7Access`). A random picker with no
tier bound of its own therefore reached Tier 7:
- Funeral on Loan fires a borrowed Echo through the SHOP twin of the factory. The shop `deathrattleSummonRandomTribeSetStats`
  (Bullseye) and `deathrattleSummonRandomTribe` (Menagerie Mammoth) in `packages/sim/src/recruit.ts` filtered
  `poolOf(state).buyable` with only `!token && !spell`, while the combat bodies already capped at the summoner's tier
  (owner fix 2026-08-18). The twins had drifted.
- Rune of the Foundry (`runeFoundry` in `sellCard`, recruit.ts) filtered `poolOf(state).all` for Dragons with no tier bound.
- Same class, found in the sweep: combat Uncle Orc (`rallySummonAndGetRally`) on an unpinned pool (empty `poolIds`)
  could summon the Tier 7 Kobold Alchemist.

**The fix: one helper.**
- `packages/core/src/randomPool.ts`: `isLegalRandomMinion(c, ceiling)` (minion, not Ruby, not token, not henchman,
  tier <= ceiling), `legalRandomMinions`, `isLegalRandomCard` (spells pass, for mixed lists), `combatTierCeiling`
  (6, or the side's Shop tier when it is 7).
- `packages/sim/src/cardPool.ts`: `randomTierCeiling(state)` (7 with Tier-7 access, else the rift ceiling) and
  `legalRandomMinionPool(state, { maxTier? })`, the Shop entry point. Order is the set pool's, so seeded picks replay.
- Routed through it. Shop: Bullseye and Mammoth twins (now also capped at the Shop tier, parity with combat), Rune of
  the Foundry (ceiling only, no Shop-tier cap, unchanged), Uncle Orc's twin, `grantRandomChooseOne`,
  `discoverChooseOne`, the shop arena `grantRandomFromPool`. Combat: `grantRandomFromPool` (Magnetic, Ale, Jouster,
  Summit grants), `rallyGrantChooseOne`, `rallySummonAndGetRally`, `battlecryGrantRandomReveler`, `onKillGrantMagnetic`,
  the Bullseye / Mammoth bodies, Rune of Salvage.
- Pickers that NAME a tier (Rune of the Deep's "random Tier 7 minion", Beyond the Summit, Pete, Strange Revision)
  are authored and untouched.

**Tests.** `packages/sim/src/randomPoolLegal.test.ts`: both reports pinned across 200 seeds, the helper's contents, and
a property sweep over every Set 1/2/3 minion (play it, Funeral-on-Loan it, fight with it at tier 6) asserting no
Tier 7 ever comes out. Verified red without the fix (Bullseye, Mammoth, Foundry, Uncle Orc all leak).

**Open design questions (behaviour kept):**
- Should Rune of the Foundry's Dragon cap at your Shop tier like most "get a random X" grants? Today it can give a
  Tier 6 at Shop tier 1.
- Combat has no Tier-7 access flag, so a side with Open Road access but a Tier 6 Shop gets the standard 6 ceiling in
  combat while the Shop would give it 7.
- `endOfTurnMagnetizeMechs` / `goldSpentMagnetize` read the global `CARD_INDEX` for their Magnetic roll (not set-pinned).
  They weld stats rather than hand out a minion, so they were left alone.
