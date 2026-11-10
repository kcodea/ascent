# 2026-11-10: Ancients × Kindness, Merrin, Emissary, Emerald Warden (batch B)

Twenty-four Ancient pairings for four heroes, in the owner's words. Still dev-only (the Scene Builder's Set 3 flag,
`enableAncients`): every hook returns early unless the run has Ancients on. Data in `ANCIENT_PAIRINGS`, hooks in the
"2026-11-10 batch B" section at the end of `packages/sim/src/ancients.ts`. Rules R-ANCKIND / R-ANCMERRIN / R-ANCVALE /
R-ANCEMERALD-01..06; tests `ancientsKindness|Merrin|Emissary|EmeraldWarden.test.ts`. Batches A and C (other heroes)
were written the same day in sibling worktrees; this one merges second.

| Hero | Ancient | What it does |
| --- | --- | --- |
| Kindness | Death | Every Great Presence also puts a Grave Invitation in hand, on the same Start-of-Turn beat (`greatPresenceGrantsCard`). |
| Kindness | Fortune | 2 Royal Allowances at the pick, once (`pickGetCard` gained a `count`; a spell goes to hand and may over-cap). |
| Kindness | War | Every Great Presence also puts a Champion's Regalia in hand. |
| Kindness | Genesis | Great Presence's Discover is tagged `kindnessGenesis`; after the first pick the reducer's `discover` case reopens the offer with the Gifts not taken (`ancientDiscoverPicksAgain` / `ancientReopenDiscover`). |
| Kindness | Time | End of Turn: 2 random Shop spells (Pocket Magic's pool: your Shop tier or lower). Great Presence unchanged. |
| Kindness | Bonds | A Gift cast from hand on a board minion is also cast on one neighbour (seeded when it has two), chosen before the cast, in the reducer's Gift play branch. One spell cast, not two. |
| Merrin | Death | Hero Avenge (3), one running Shop + combat count: a random Shop spell. Combat rides Gorr's `ancientGorrAvenge` over the pool's ids (a live `toHand`). |
| Merrin | Fortune | The `power` override alone: `cost: 0`, `usesPerTurn: 2`. StatusBar shows the uses left. |
| Merrin | War | The spells Pocket Magic makes are stamped `castMult: 2` (Hunch × Time's channel). |
| Merrin | Genesis | Pocket Magic queues a spell Discover instead. |
| Merrin | Time | Every 3rd spell cast (a running count, `batchBSpells`) sets `heroReady`. Combat casts count at settle. |
| Merrin | Bonds | Every spell cast: one minion of each type +3/+4. Shop: `bannerRecipientsOf`, permanent; combat: `QuestCombatMods.ancientSpellBanners` in `ctx.castSpell`. |
| Emissary | Death | Hero Avenge (4): United Front. Shop: `fireShopUnitedFront` (permanent); combat: `ancientUnitedFront.avenge` at the live spell count. |
| Emissary | Fortune | The first Shop spell bought each turn costs 0, through `ancientEnchantedSpellCut` (so both buy paths, the coins and the bots agree). Counted by `ancientOnBuy`. |
| Emissary | War | United Front fires twice (two triggers), both phases. |
| Emissary | Genesis | Every 5th spell cast: a random Shop spell. Combat pays live (`ancientSpellCountGrant`). |
| Emissary | Time | No Start of Combat fire; the End-of-Turn entry runs `fireShopUnitedFront`, so the stats are permanent. |
| Emissary | Bonds | Every living friendly minion collects. |
| Emerald Warden | Death | Hero Avenge (6): a random minion of exactly your Shop tier (Vanguard's pool). Combat rides `ancientGorrAvenge`. |
| Emerald Warden | Fortune | A minion of your Shop tier costs at most 2 Gold (`ancientTierPrice`, one more cap in `offerBuyPrice`). |
| Emerald Warden | War | From Shop tier 6 Vanguard is also a button: 1 Gold, once per turn, casts Waking Rift (`sparkplug`) through `castSpell`. |
| Emerald Warden | Genesis | The same button at 4 Gold: a Discover of Tier 7 minions. |
| Emerald Warden | Time | End of Turn: a random minion of your Shop tier. |
| Emerald Warden | Bonds | The same button at 1 Gold: a random minion of your most common board type (Quillen × Time's pick). |

## Plumbing worth knowing

- **United Front has one entry point per phase.** Combat: `fireUnitedFront(side, n, all)` in `simulate.ts` (the Start of
  Combat block and Death's Avenge both call it; `unitedFrontRecipients` is the selection, also used by Merrin × Bonds).
  Shop: `fireShopUnitedFront(st)` in `recruit.ts` (the Start-of-Combat replay list, Death's Shop Avenge, Time's End of
  Turn). Both read the Ancient shape (`ancientUnitedFront` mod / `ancientUnitedFrontShape`). Anything else that wants
  to trigger United Front (batch C's Mimic) should call these.
- **One End-of-Turn entry for three pairings**: `ancientBatchBEot` (`ancientRunBatchBEot`), the usual virtual recurring
  entry, so Chronos repeats and the End-of-Turn replays treat it like every other recurrence.
- **One hero Avenge count for three pairings**: `AncientsState.batchBDeaths`, folded into `heroAvengeOf`, so the power
  button's Avenge disc and the live text work with no UI change.
- **Vanguard's button is a synced shape, not a static override.** `ancientSyncVanguard` stamps
  `powerOverride = { passive: false, untargeted: true, cost }` only while the Shop is at tier 6+, at the pick and at
  the reducer's every-action boundary. Below tier 6 the power is the plain passive, so the button, the coin and the
  reducer's gates stay honest by construction.
- Three new `QuestCombatMods` fields (`ancientUnitedFront`, `ancientSpellBanners`, `ancientSpellCountGrant`), each in
  the combat fuzz table.

## Judgement calls the owner should confirm

1. **Kindness × Fortune is paid ONCE, at the pick** (2 Royal Allowances), the reading Quillen × War's "Get a Paragon."
   took for the same bare wording. Paying it on every Great Presence instead is a one-line data change
   (`greatPresenceGrantsCard`, count 2).
2. **Emissary × Time makes United Front permanent.** An End-of-Turn buff is a Shop buff, so it compounds every turn.
3. **Kindness × Bonds reaches Parting Gifts**, which then sells the neighbour too. Built as written.
4. **Emerald Warden's three buttons are once per turn and keep the tier-up minion.** "At tier 6" is read as Shop tier 6
   or higher.
5. **Merrin × Time adds a recharge**; it does not replace the recharge each turn.
6. **Cast multipliers (R-MULT-06).** Merrin × War is a from-hand multiplier on the card, so it multiplies with Yazzus
   and the rest. Kindness × Bonds' neighbour cast is part of the same cast: it follows each cast of the Gift and counts
   no second spell.

## Verification

`ancientsKindness|Merrin|Emissary|EmeraldWarden.test.ts` drive every pairing through the real reducer and simulator,
each with a control that proves it does nothing without the pairing, a JSON round trip and a same-seed determinism
check.
