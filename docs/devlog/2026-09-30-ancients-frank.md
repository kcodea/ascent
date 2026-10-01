# 2026-09-30: Ancients × Frantic Frank

Frantic Frank's six Ancient pairings (hero id `frank`, power **Clearance**: "Refresh the Shop. Its minions cost 2 Gold
this turn.", 1 Gold, once per turn), in the owner's words, built on the Ancients proof of concept and mirroring the
Albus pairings ([2026-09-28](2026-09-28-ancients-albus.md)). Still dev-only (the Scene Builder's Set 3 Ancients flag),
so there is no patch note, like the Albus PR.

"Clearance minions" are the minions bought from a Clearance-marked Shop offer. On an Ancients run each offer Clearance
stamps at 2 Gold also carries `ShopCard.clearance`, and the minion bought from one carries `BoardCard.clearanceBuy`
(per instance, so it survives combat, saves and hand/board moves). Non-Ancients runs never get either mark.

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "destroy leftmost minion and makes the first minion you buy from clearance free" (revised the same day; the first draft was "makes the Shop free this turn") | Clearance refreshes, stamps its minions at 0 Gold (`clearanceFree`), then destroys your left-most board minion (a real Shop death). The first Clearance minion bought is free and re-prices the rest to 2 Gold. |
| Fortune | "Clearance minions sell for 2g" | `sellValueOf` returns 2 for a Clearance minion (never less than its normal value). |
| War | "Avenge (3): Gain a Clearance stack. * this lets clearance be used more than once per turn, up to however many stacks they have" | A hero-level Avenge (3) in combat gains a stack mid-fight (a `questTrigger`, Rune of Fury doubles it); the fight's total banks at settle. Once the turn's own Clearance is spent, each further use takes a stack. |
| Genesis | "Clearance costs 3g but refreshes with minions of your most common type." | Cost 3 (`power` override). Clearance's roll is narrowed at the one draw site (`rollShopRow`) to `dominantBoardTribe`, still at 2 Gold. |
| Time | "Clearance becomes 'The first 3 minions you buy each turn cost 2g.'" | Clearance is passive. `offerBuyPrice` caps the first 3 minion buys each turn at 2 Gold. |
| Bonds | "Selling Clearance minions grants the minions stats to a random friendly minion." | `settleMinionSale` → `ancientOnSale`: the sold Clearance minion's current Attack/Health go to a random friendly board minion, with a buff beat. |

## How it is wired

- **Registry** (`packages/sim/src/ancients.ts`): a `frank` block, six new `AncientEffect` variants, and the Frank hooks
  (`ancientClearancePassive`, `ancientClearanceStacks` / `ancientSpendClearanceStack`, `ancientClearanceRefresh` +
  `ancientRollTribe`, `ancientMarkClearanceOffer`, `ancientAfterClearance`, `ancientOnClearanceBuy`,
  `ancientTimePrice` / `ancientNoteMinionBuy` / `ancientTimeBuysLeft`, `ancientClearanceSellValue`, and Bonds inside
  `ancientOnSale`). New `AncientsState` fields: `clearanceStacks`, `timeBuys`, and the transient `rollTribe`.
- **Reducer**: the `heroPower` gate grew `stackUse` (a spent slot-0 Clearance with a banked stack is available, and the
  use spends the stack instead of the charge). The `clearance` branch refuses under Time, wraps its refresh for
  Genesis, marks each stamped offer, then runs Death's destroy. The ordinary buy spends Death's free buy, counts Time's
  buys and stamps `clearanceBuy`; the Starform buy counts for Time too.
- **Combat** (`@game/core`): `QuestCombatMods.ancientClearanceStacks`, an avenge-bus listener in `simulate`, and a
  carry-back `ancientClearanceStacks` → `CombatResult.playerAncientClearanceStacks`, present only when the mod is on.
- **Live text**: `{deathFree}` ("Free buy ready." while the free buy waits), `{stacks}` (banked + gained so far in the
  fight on screen: `CombatQuestDelta.clearanceStacks`, counted from the replay's `questTrigger` events),
  `{genesisTribe}` (the type it would refresh into now), `{timeLeft}` (discounted buys left this turn). Prices ride the
  offers' cost coins (`offerBuyPrice`); Genesis' 3 Gold rides the power's cost coin. The power button is ready while a
  stack is banked (`StatusBar` `canHero`).
- **Oracle**: R-ANCFRANK-01..06 in `packages/rules/src/registry/approved/heroes.ts`.
- **Tests**: `packages/sim/src/ancientsFrank.test.ts`.

## Presentation (owner asks the same day)

- **War's uses badge** (owner on 5173: "when there are multiple stacks of clearance, show the # in Red in the center top
  of the hero power"): the power's `.hpb-tally` slot shows the Clearance uses available right now (the turn's own use +
  banked stacks + stacks gained so far in the fight on screen) in red (`.clearance-uses`) while it is 2 or more
  (`ancientClearanceUsesBadge`). It re-keys on every change, so the one-shot `stepbump` is the tick. The tooltip's
  "once per turn" becomes "N uses left" while stacks are banked.
- **Every visible effect has its beat** (owner: "add tendrils/general effects where necessary"), reusing existing
  channels, no new art, nothing looping:
  - Bonds: a `deathrattle`-kind buff capture keyed on the sold minion, so the tendril streams from the slot it left to
    the recipient, with the stat pop.
  - Death: the destroy walks `destroyMinionInShop`, which stamps its Shop death beat. The free offers' price coins
    read a green 0 (`offerBuyPrice`, `costChanged`), and the power text says "Free buy ready." until it is spent.
  - War: each stack gained mid-fight plays the one-shot `hero-power-spark` on the power as the red count bumps.
  - Fortune: the sell float already reads `sellValueWithBonus` → `sellValueOf`, so it floats the 2. The Clearance
    minion's text also prints a blue note, "Sells for 2 Gold." (owner: "just add sells for 2g if it is a fortune frank
    purchase"), at its CURRENT value (`clearanceSellGoldOf` in `instView.ts`: a minion that would sell for more prints
    that), on the Shop chain (board, hand, hover). A SALE banner was tried and dropped the same day at the owner's call.
  - Genesis: the ordinary refresh beat. Time: the live prices on the offers' coins.
- **War's Avenge countdown** (owner: "show it in the center of the hero power when war is active"): the power's centre
  readout (`.hpb-center.hpb-avenge`, a dark disc with War's crimson rim) shows the friendly deaths still needed for the
  next stack (`ancientClearanceAvengeLeft`): 3 in the Shop, counting down live in a fight (`CombatQuestDelta.friendlyDeaths`,
  the player's non-Rise `death` events), back to 3 after each stack. Measured clear of the red pip and the name plate at
  1920x1080 and 1600x900.
- **No cost coin on a passive power** (owner, Time: "the cost of the hero power should go away because it's not
  activatable anymore"): `heroPowerCostOf` returns 0 for any passive power and the coin also gates on `!isPassive`, so
  Frank's, Albus's and the Auctioneer's Time all render like a natively passive power (no coin, disabled, no ready glow).

## Judgement calls (open for the owner)

- **Death's free buy rides the offers**, like Clearance's own 2 Gold: the set is stamped 0, the first buy re-prices the
  rest to 2, and any later refresh builds un-stamped offers. Death **refreshes first, then destroys**, so a Shop-touching
  Echo lands on the new Clearance offers. With War's stacks each Clearance would get its own free buy, but one Ancient per
  run means Death and War never meet.
- **Fortune is a floor**: a Clearance minion sells for 2, or more if it would sell for more anyway (the Hoarder /
  Bartering `max` precedent). A triple of Clearance minions combines into a new body without the mark.
- **War's stacks persist across turns** until used, and the turn's own Clearance is used before a stack. Each use still
  costs its Gold. Avenge counts combat deaths only (every Avenge in the game is a combat trigger); Rune of Fury doubles it.
- **Genesis with no type on the board** (empty or all neutral) is an ordinary refresh. A type out of stock at your tier
  falls back to the ordinary draw for those slots. Ties follow `dominantBoardTribe` (first seen on the board).
- **Time caps the price at 2** (the Starform's live price included) and every minion buy counts, a free one too. A
  displaced (held) offer's restore price is untouched and does not count.
- **Bonds** gives the sold minion's current stats (a sale from hand too) to a random friendly BOARD minion. The two
  legacy "counts as a sell" spells (Fodder Treatment, Feed the Alpha) do not walk `settleMinionSale`, so Bonds does not
  fire from them (Indy's Fortune has the same scope); they do read Fortune's 2 Gold through `sellValueOf`.
