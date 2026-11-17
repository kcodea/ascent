# 2026-11-16 — Cassen's Commission rework (Shed / House / Bridge / Castle, Zeppelin at Tier 6)

Owner design (2026-11-16): four commissions, Shed (Discover a Shop spell, 1 turn), House (gain 4 Gold, 2 turns),
Bridge (Discover a minion from your Tier, 3 turns), Castle (reduce the cost of upgrading your Shop by 3, 3 turns); at
Tier 6 the Castle becomes the Zeppelin (Discover a minion from Tier 7, 2 turns). Still 3 offered every turn, "cassen
cannot repeat the same commission in a row", and "every commission finished also grants cassen +1 max gold."
Rule R-CASSEN-02 (supersedes R-CASSEN-01).

**Ids kept.** `CommissionKind` keeps its historical ids: `spell` = Shed, `gold` = House, `discover` = Bridge,
`citadel` = Castle, `fortress` = Zeppelin. The display names and the power art (`cassen-<kind>.webp`, wired by
`wire-art.ts` from the owner's `cassenshed` ... `cassenzeppelin` files) already used those names, so no art or
migration was needed. A save working an old Citadel / Fortress now pays the new Castle / Zeppelin.

**The offer** (`commissionOffer`, recruit.ts, pure): the slot list is Shed / House / Bridge / Castle, with the Zeppelin
in the Castle's slot from Shop Tier 6. The kind STARTED last (`lastCommission`) is never offered, and the Zeppelin
counts as the Castle for that, so after any pick the offer is exactly the other three. Before the first pick all four
are legal and one is dropped, seeded by `mixSeed(seed, wave, tag)`: stable for the turn, identical on a replay. With
Cassen × Time's two slots "last" is the most recently started one (the reducer writes `lastCommission` on every start).

**Payout** (`payCommissionOnce`, reducer.ts): Shed `queueDiscover({ kind: 'spell' })`, House `gainGold(4)`, Bridge the
exact-tier minion Discover, Castle `upgradeCost - 3` (floored, nothing at the top tier), Zeppelin the fixed Tier 7
Discover (`exactTier: 7`). Every payout then adds `maxGoldBonus + 1` and `gainGold(1)` (the Shop License rule, so the
raised max is spendable that turn). It sits inside the per-rep payout, so Bonds doubles it. A Castle running when you
reach Tier 6 stays a Castle (it is what you commissioned).

**Text** (`heroPowerText`, `commissionRewardOf`): the options print `**Name** (N turns): reward`, then "Each one also
gives N max Gold."; a running one prints "**House** pays out in 2 turns. Gain 4 Gold. Gain 1 max Gold." Live values:
the Bridge's current Tier, Time's delay, Bonds' doubled numbers, and the turns left (Cassen × Death's live combat
rewrite now matches "pays out next turn / in N turns" instead of the old "(due turn N)"). The picker tiles print
`commissionRewardOf` too.

Bots: `productionBots/legalActions.ts` still proposes all five kinds and `transition.ts` keeps the legal ones; the
reducer refuses anything not offered.
