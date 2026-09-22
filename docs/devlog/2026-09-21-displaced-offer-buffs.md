# 2026-09-21 — A displaced (held) minion keeps the Shop buffs it accrues there

Owner bug report (2026-09-21): "I swapped Chimerus to the Shop (Darah's Swap) and used Veinstorm and it did
not buff it."

## Root cause

Darah's `displace` power (and the Displacement spell) go through `swapWithTavern`, which stashes the board body
INTACT on the new offer as `held: BoardCard`; the offer itself carries no `atk`/`hp`. Veinstorm
(`spellBuffShopByRuby` → `stampVeinstormRubies` → `addOfferBuff`) DID stamp that offer, writing
`offer.atk` / `offer.hp` / `offer.buffs` (source `Ruby`) like any other minion offer. But:

- the UI's held-offer render (`shopView` in `packages/ui/src/Recruit.tsx`) read the held body alone, so the
  stamp never showed;
- the re-buy path (`reducer.ts`, `if (offer.held)`) restored `{ ...offer.held }` verbatim and never folded
  `offer.buffs` (a normal buy does);
- the swap-back path (`swapWithTavern`, `if (offer.held)`) did the same.

The 2026-07-29 fix for "Golden Touch on a displaced minion" patched only `golden` on this path; every other
offer-level buff (Veinstorm Rubies, Fortify, Fried Circuits, a rune's shop enchant) was silently dropped.

## What changed

- **`packages/sim/src/recruit.ts`** — new `restoreHeldOffer(state, offer)`: clones the held body (deep-copying
  `keywords` and the buff ledger's entries), then folds the offer's accrued buffs with the SAME loop the normal
  buy uses (`for (const b of offer.buffs) addBuff(restored, b.source, b.attack, b.health, b.count)`, else the
  generic `'Tavern buff'` fallback for a legacy offer with `atk`/`hp` but no breakdown), folds any offer-level
  `keywords`, then re-gilds a Golden Touched offer (`gildMinion`) so the doubling stays base-only. No
  `applyOnBuy`, no run-wide buy channels: still a restoration, not a purchase. Both restore paths call it —
  the swap-back branch of `swapWithTavern` and the reducer's held re-buy — so they cannot drift.
  `offerBuyStats` (the consume paths' "what is this offer worth") reads a held offer the same way: body +
  accrued `atk`/`hp` + a gild's base doubling.
- **`swapWithTavern`** documents the invariant: the offer it builds carries NO `atk`/`hp`/`buffs` of its own;
  those fields are reserved for what accrues in the Shop, so the fold can never double-count.
- **`packages/ui/src/Recruit.tsx`** — new `heldOfferLedger(offer)`: the body's ledger + the offer's accrued
  buffs (merged by source, a legacy `atk`/`hp` with no breakdown as 'Tavern buff') + a Golden Touch gild as its
  own line, plus the resulting golden flag and gild delta. The held branch of `shopView` reads it and shows
  `held.attack + (offer.atk ?? 0) + gild` / `held.health + (offer.hp ?? 0) + gild`, keeps
  `baseAttack`/`baseHealth` at the printed base (doubled when golden) so the total reads green like any buffed
  offer, shows the golden frame for a Golden Touched held offer, folds offer keywords, and lists the merged
  ledger for the inspect breakdown. The hover popup (`refViewsByUid`, which sizes the Gemheart Golem preview off
  the owner's Rubies) reads the same ledger for a held offer, so it counts the body's Rubies AND the accrued
  ones instead of the offer-level stamp alone.

## Tests

- `packages/sim/src/displacedOfferBuffs.test.ts` — invariants (no seeded `atk`/`hp`; Veinstorm stamps the held
  offer and the shop-gem FX signal carries its uid; `offerBuyStats`), re-buy with Veinstorm at +1/+1 and at the
  live Ruby value (+3/+3 with two Rubies), Golden Touch together with the buffs, a generic Fortify /
  same-source merge, the legacy generic-label fallback, offer keywords + no run-wide channel + flat price,
  swap-back via the power (stats + Ruby ledger + gild), no shared ledger entries, and Ruby Transfer stealing a
  held neighbour's accrued Rubies. 7 of 13 fail without the fold.
- `packages/ui/src/heldOfferView.test.ts` — the held `shopView`: unchanged with nothing accrued, Veinstorm
  stamp folded + green + in the breakdown, same-source merge, Golden Touch preview, offer keywords; and
  `heldOfferLedger` merging the body's Rubies with the accrued ones without mutating the stash.

Patch note prepended (2026-09-21, Balance).
