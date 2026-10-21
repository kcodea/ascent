# 2026-10-21 — Random picks reach Tier 7 only from a Tier 7 Shop

Owner rulings, following #2185 (R-RANDOM-POOL-01):

- "yes": Rune of the Foundry's random Dragon (sell 5) caps at your Shop tier.
- On "combat ignores Tier 7 access": "cant be getting t7s in combat either". Read as: a random minion pick never gives a
  Tier 7 minion in either phase unless that player's Shop actually stands at Tier 7. Tier-7 access alone (Open Road,
  Summit Passage, the Summit rift) with a Tier 6 Shop no longer opens Tier 7 to a random picker.

Rule R-RANDOM-TIER7-01 (`packages/rules/src/registry/approved/randomness.ts`); R-RANDOM-POOL-01 and R-ANCALBUS-05
updated to match.

## What changed

- `combatTierCeiling(sideTier)` (`packages/core/src/randomPool.ts`) is THE rule: `sideTier >= 7 ? 7 : 6`. Behaviour
  in combat is unchanged (it already read the Shop tier); it is now written as the explicit rule.
- `randomTierCeiling(state)` (`packages/sim/src/cardPool.ts`) now calls `combatTierCeiling(state.tier)` instead of
  `hasTier7Access ? 7 : maxTierFor(rift)`, so the Shop and combat cannot drift. Every caller follows: the shop arena's
  `grantRandomFromPool`, `grantRandomChooseOne`, `discoverChooseOne`, `rallySummonAndGetRally`, `legalRandomMinionPool`.
- Rune of the Foundry: `legalRandomMinionPool(state, { maxTier: state.tier })`.
- The "tier above" random picks that read `hasTier7Access` directly now read `randomTierCeiling`: Clockwork Assistant's
  `tierOffset` Discover, Albus's Empowerment, the Ancient of Time Discover (`albusTimeTier`), Lucky Seat's prize cap.

## Left alone

- Authored Tier 7 sources named in the text: Rune of the Deep, Beyond the Summit, Pete (Contrabanana), Strange
  Revision, Skybound Ascendant, Golden Monkey, Rune of the Summit, Brackus's Summit.
- The Shop ladder (upgrade ceiling, Summit Passage's free upgrade): access still opens the Tier 7 upgrade.
- `offerDiscover`'s default clamp (`maxTierFor(rift)`, Summit rift only, the rift is disabled) and Elevation Ritual's
  cap (`maxTierFor(rift)`): both only reach Tier 7 on a Summit rift run. Flagged for the owner rather than changed.

## Verification

`packages/sim/src/randomTier7Ceiling.test.ts` (7 tests, 5 fail on the old code) and the updated
`randomPoolLegal.test.ts` access test (fails on the old code).
