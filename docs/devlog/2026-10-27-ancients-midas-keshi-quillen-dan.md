# 2026-10-27: Ancients × Midas, Keshi, Quillen, Disco Dan

Twenty-four Ancient pairings for four heroes, in the owner's words. Still dev-only (the Scene Builder's Set 3 flag,
`enableAncients`): every hook returns early unless the run has Ancients on. Data in `ANCIENT_PAIRINGS`, hooks in the
"2026-10-27 batch" section at the end of `packages/sim/src/ancients.ts`. Rules R-ANCMIDAS / R-ANCKESHI / R-ANCQUILL /
R-ANCDISCO-01..06; tests `ancientsMidas|Keshi|Quillen|DiscoDan.test.ts`.

| Hero | Ancient | What it does |
| --- | --- | --- |
| Midas | Death | Every Gilded minion (board + hand) carries a grafted "Echo: get a Gold Pouch" (`applyRuneGrafts`, found by its `ancientMidasEcho` marker; `fixed` so a Gilded body gets ONE). Combat summons get it via `QuestCombatMods.ancientGildedEcho`. |
| Midas | Fortune | Gold Pouches give 3 (`goldPouchValue`, set at the pick). Rune of Pillaging now takes the max, so it never lowers it. |
| Midas | War | Start of Turn: a random Gilded board minion without Ward gains Ward (own beat). |
| Midas | Genesis | `grantGoldenDiscover`'s Midas branch pays the Pouch AND falls through to the Triple Reward. |
| Midas | Time | Gildmaster's `sotGildRandom`, reused. |
| Midas | Bonds | A board minion that was already Gilded and gained stats gives every other Gilded minion +2/+2. Shop: `ancientBondsReact` (the stat diff now carries `golden`); combat: `ancientGildedBonds` in `ctx.buff`, guarded (no loop). |
| Keshi | Death | Hero Avenge (4), one running Shop + combat count; each fire adds 4 to `keshiTierPoints`. Combat pulses `ancientAvengePulse` (Cassen's), settle adds. A full Crown pays at the reducer's action boundary (`ancientCrownDueNow` → `keshiCrownPayout`, split out of `keshiCrownBuy`). |
| Keshi | Fortune | A minion of your Shop tier costs 1 less (`offerBuyPrice`, the Shout-discount channel). |
| Keshi | War | A pick from ANY Triple Reward gains one random keyword it lacks from Taunt, Ward, Rise, Flurry, Critical Strike, Execute, Stealth, Engraved. A body with `CR` but no `critChance` now rolls 50% (`instantiate`). |
| Keshi | Genesis | A Crown Triple Reward (`BoardCard.crownReward`) opened at Tier 6+ rolls each option: 25% to become a Tier 7 minion. |
| Keshi | Time | Start of Turn: a Beyond the Summit. |
| Keshi | Bonds | A minion of your Shop tier banks its tier twice (`ancientCrownBuyTimes`). |
| Quillen | Death | An Echo pick from an Archive payout gains Rise. |
| Quillen | Fortune | Each Archive use: +1 max Gold (`maxGoldBonus`). |
| Quillen | War | A Paragon at the pick. |
| Quillen | Genesis | Archive fills at 2 (`ancientArchiveNeed`; StatusBar shows n/2). |
| Quillen | Time | Archive passive; Start of Turn a random minion of your most common type (your tier or lower). |
| Quillen | Bonds | Three different types pay two Discovers (the second queued as a `pool` Discover). |
| Disco Dan | Death | At the pick: Discover an Echo minion (your tier or lower); it gains Rise and is locked until the next tier (none at 6+). |
| Disco Dan | Fortune | Every Shop copy of a Setlist card costs 1. |
| Disco Dan | War | At the pick: Setlist cards held gain Ward + Flurry. |
| Disco Dan | Genesis | At the pick: Discover a Tier 7 locked until Tier 6. |
| Disco Dan | Time | Tradesman's `eotUpgradeDiscount` (3), reused. |
| Disco Dan | Bonds | Setlist cards Gild at 2: `gildCopiesNeeded(run, cardId)` is now per card (checkTriples + the Shop indicator). |

## Plumbing worth knowing

- **Discover origin tag.** `DiscoverSpec.ancientTag` → `AncientsState.discoverTag`, stamped by `openDiscover` (or by
  Archive's direct payout) and consumed by the pick (`ancientOnDiscoverPick` returns it; `ancientOnDiscoverTaken`
  applies the keyword grants). Absent on every non-Ancients run, so their specs and state are byte-identical.
- **The Setlist is recorded by card** (`AncientsState.discoSetlist`) as each Setlist pick is taken while Ancients are on;
  still-locked Setlist cards held also count, as a fallback.

## Judgement calls (flagged to the owner)

Keshi Bonds counts toward Keshi's Crown. Keshi War applies to every Triple Reward, not only the Crown's. Keshi Genesis
draws from the run's Tier 7 pool, only for the Crown's own rewards. Midas Bonds is board-only and needs the gainer to
be Gilded already (a fresh gild is not a "gain"). Quillen Fortune is per Archive use (Wishbone does not double it).
Quillen War / Disco Death / War / Genesis fire once, at the pick. Disco War hits the Setlist cards held at the pick.
