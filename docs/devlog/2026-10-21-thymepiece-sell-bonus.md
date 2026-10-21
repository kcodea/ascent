# 2026-10-21 · Thymepiece: cards sell for +1 Gold for the next 8 seconds

**Branch:** `feat/thymepiece-sell-bonus` · **Owner asks:** "change thyme's equipment to be: cards sell for +1 gold
for the next 10 seconds", then the correction "the window is 8 SECONDS (not 10), and 16 seconds when GILDED.
Amplified doubles the duration (confirmed)." · **Oracle:** `R-EQUIP-THYME-SELL-01` (new), `R-EQUIP-01` (updated).

## Old vs new

| | Before (2026-09-12) | Now |
|---|---|---|
| Effect | every Shop card costs 1 less Gold (gilded 2) | every card sold pays +1 Gold |
| Window | 8 s, gilded 8 s | 8 s, gilded 16 s |
| Amplified | doubles the seconds (16) | doubles the seconds (16, gilded 32) |
| Cost / target / charges | 3 Gold, no target | unchanged |

## How

- **One boundary.** The +1 is folded into `sellValueOf` (recruit.ts), the helper every sale path calls: the sell
  action (board and hand), Dissipate via `settleMinionSale`, Parting Gifts, Fodder Treatment, Feed the Alpha and
  Rune of the Altar. It adds after everything else, so it stacks with Keg Runner / Hoard Whelp (`onSellGainGold`,
  which fires separately on the sale), Hoarder, per-instance `sellBonus`, Bartering, Quick Sale, and it sits on
  top of an overridden value (a Bargain Bin minion sells for 1 while the window is open). The sell float reads
  the same helper, so the number shown is the Gold paid. Frank's Fortune "Sells for N Gold" line passes the
  window through `SellTextState`, so it is live too.
- **The clock mechanism is unchanged**, only renamed: `RunState.cardDiscountWindow` became `sellBonusWindow`,
  the expiry action `discountWindowExpired` became `sellWindowExpired`, the factory
  `equipmentCardDiscountWindow` became `equipmentSellBonusWindow`, and `DiscountWindowReadout` became
  `SellWindowReadout` (now "Sell +1 Gold · 6s"). The activation still carries the turn clock's reading, the
  UI tick still dispatches the expiry on the tick that crosses `untilClock`, so the window still pauses with the
  clock, and it is still cleared at combat entry and at the turn flip. A sale counts if it lands before the expiry
  action.
- **Removed:** `OfferBuyPrice.windowOff` and its subtraction in `offerBuyPrice`, and the window line in
  `spellCostReduction`. Nothing discounts a price any more.
- **Old saves:** `deserialize` deletes a saved `cardDiscountWindow` (dropped, not converted: the old discount
  simply ends). Replay v2 is state capture, so an old frame whose cause is `discountWindowExpired` is just a label;
  the reducer ignores an unknown action type.
- `derivations.test.ts`'s price fuzz lost its Thymepiece input, which shifted its RNG stream under the Starform
  floor; it was re-seeded (same 100 states, same floors).

## Tests

`packages/sim/src/thymepiece.test.ts` rewritten: the texts and params, the window anchors (8 s, gilded 16 s),
sales inside and outside the window (board, hand, a sale before vs after the expiry action), stacking with Keg
Runner, Hoarder, a per-instance bonus, Quick Sale and a Bargain Bin override, no price change, the lifecycle, the
old-save drop, and Amplified (16 s, gilded 32 s, an extra trigger keeps 8 s, the printed rule doubles).
