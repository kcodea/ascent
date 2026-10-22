# 2026-10-22 - Shop damage shows in the buff ledger (R-LEDGER-SHOP-DAMAGE-01)

Owner report: "why did the HP bug out here?" A Gilded Uron showed 1618/16 while its inspect listed
"Rad Rachel x401 +1604/+802". A second board (Hawkus and two others) showed Health about half of the ledger.

**Root cause: not a stat bug, a ledger gap.** The Health was correct. Shop damage to your own minions is
permanent by design (owner ruling 2026-08-04: a Shop-fired Fel Spikes Echo or Gasket Rally sprays YOUR
non-Demons). Each landed hit also makes Rad Rachel give everyone +4/+2 (Gilded). With two Gilded Fel Spikes and four
non-Demons, one Echo deals 8 to each non-Demon and fires Rachel four times, +8 Health: the non-Demons' Health stays
flat while Attack climbs. The headless repro reproduces the owner's numbers exactly (1608/804 x2, 1616/820,
Uron 1614/14). Gasket's two passes of 2 (4 a spray against +8) explain the "about half" board. The damage was
taken off `health` in `shopSprayExceptTribe` (and `damageAll` / `woundAll` in `shopArena`) but never written to
`card.buffs`, so the inspect showed only the gains.

The gold heart with green text vs the purple badge is just the stat milestone frame (`tierOf` in `Card.tsx`): a
~300 Health sits a tier below ~580. Green text = above the printed base. Neither marks damage.

**Fix.** `recordShopDamage` (state.ts) writes a negative `<source> (damage)` row, one count per hit, at all three
Shop damage sites. It bypasses `addBuff` so Soulbind / Xerox / Shared Spoils never mirror a loss. `isShopDamageRow`
keeps the row out of Celestial Crucible's stack count and the build-tag buff tally. `Inspect.tsx` prints signed
amounts (it printed "+-800" for any negative row, Titan Hammer's set-down included).

Test: `packages/sim/src/shopDamageLedger.test.ts` (fails without the fix).

**Open design question for the owner:** whether Shop self-damage should stay permanent. With Rachel out, a
Fel Spikes / Gasket loop slowly kills your own non-Demons; with her in, it nets to zero Health. Behaviour unchanged here.
