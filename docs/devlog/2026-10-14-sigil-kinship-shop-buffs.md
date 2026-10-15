# 2026-10-14 — One shared stamp for every new Shop offer (Sigil of Kinship shop buffs)

Owner bug: "sigil of kinship refreshes dont have minions with shop buffs - this must be fixed as well".

## Cause

The per-offer Shop stamps lived inline in `rollShopRow` (the ordinary roll): Veinstorm's banked Rubies and the
Attachment Issues price. The right-most / left-most slot enchants (Market Tormentor, Picnic, Display Case) only
re-landed in `applyShopRefreshed`, which only the reducer's refresh paths called. Every other path that put
offers in the Shop served them bare.

| Path | Missing before |
| --- | --- |
| Sigil of Kinship (`refillShopFiltered`) | Veinstorm, Attachment price, slot enchants, Embers / Endless Inventory / refresh watchers, Enchanted roll, Starform Veinstorm; it also threw away Layaway-kept offers |
| Elevation Ritual (`elevateShop`) | Veinstorm, Attachment price, slot enchant on an upgraded right-/left-most, Enchanted roll |
| Spell Cart (`rollSpellShop`) | refresh tail (no minions, so no stat stamps apply) |
| Grand Larceny (`rollShop` only) | Enchanted roll, slot enchants, refresh watchers |
| Frozen top-up (`topUpTavern`) | Veinstorm, Attachment price, Enchanted roll on the gap-fillers |
| Rune of the Muster, Membrance | Veinstorm, Attachment price, Enchanted roll |
| Bargain Bin | Veinstorm and Enchanted roll on the binned offers (they replace stamped ones) |
| Open Enrollment, Pete, Albus, Indy's Golden Monkey (`addCardToShop`) | Veinstorm, Attachment price; a replaced right-most lost its slot enchant |
| Rune of Restocking, God Mode print | Veinstorm, Attachment price |

Run-wide buffs (`tavernBuyBonus`, the this-turn layer, card-type buffs, auras) were never affected: `offerBuyStats`
reads them live for every offer.

## Fix

`stampNewShopOffers(state, offers, { cia, inPlace, onRefresh })` in `packages/sim/src/shop.ts` is the one
function every Shop-populating path calls on its new offers. It applies the Attachment price and Veinstorm Rubies,
re-lands the slot enchant when a new offer REPLACED the enchanted right-/left-most (`inPlace`), and rolls Croupier
Ayse's Enchanted mark (`cia`; off only for the ordinary roll, whose row-wide roll runs later in the reducer and
whose rng order is pinned). The slot re-land was extracted into `landRightmostSlotBuff` / `landLeftmostSlotBuff`,
shared with `applyShopRefreshed`.

Judgement calls (flag to the owner if wrong):
- Spells whose text says "Refresh" (Sigil of Kinship, Spell Cart, Grand Larceny) now run the full refresh tail
  (`applyShopRefreshed`, not a player roll): slot enchants, Rune of the Embers, Endless Inventory, and refresh
  watchers such as Hellrider. Same as Clearance and Membrance already did. They do NOT tick the Ancients meter or
  the Starform price (those stay on the reducer's paid/free refresh).
- Sigil of Kinship keeps Layaway offers, like every other refresh.
- Elevation Ritual is an upgrade, not a refresh: it gets the per-offer stamps and the slot enchant on an upgraded
  slot, but no refresh triggers.
- A frozen top-up is not a refresh: no slot re-land (unchanged).

## Verification

`packages/sim/src/shopOfferStamp.test.ts`: Sigil rows carry Veinstorm + both slot enchants + the live Staff bonus,
its row has the identical buff signature to an ordinary refresh, Layaway survives it, and a parametrized sweep of 11
Shop-populating paths asserts the same stamps. 13 of 15 fail on main (the two ordinary-roll baselines pass).
Oracle rule `R-SHOP-04` (economy). Sim-only change; no content or combat code touched.
