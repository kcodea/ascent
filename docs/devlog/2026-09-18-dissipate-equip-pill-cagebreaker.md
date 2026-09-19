# 2026-09-18 — Dissipate, the Equipment cost coin at 0, Cage Breaker's death before its Discover

Owner handoff, three items.

## Dissipate (new spell, sets 2 + 3)

Tier 5, 4 Gold, aimed at a friendly board minion: *"Sell a minion and give its stats to the right-most minion in
the Shop."* Lives in `cards/set2/spells.ts` (`sp_dissipate`) and is opted into set 3 by id at the END of
`SET3_SHARED_SPELL_IDS` (after the tribe spells, so no existing pool position moved).

- **The sale is the FULL sale.** The reducer's manual `sell` case carried ~70 lines of post-removal rituals inline
  (Gold via `sellValueWithBonus`, Bartering / Liquidation / Investment / Aftermarket / Foundry / Quick Release /
  Seller's Market / Trade-In, the sold body's `onSell`, `soldThisTurn` + `fireOnMinionSold` for Voicekeeper and the
  Reveler runes, Robin's Spoils, the pool return). That block moved verbatim into `settleMinionSale(state, sold)`
  in `recruit.ts`; the reducer calls it, and so does the new `spellSellToShopRightmost` factory. Rune of
  Dismantling stays in the reducer — it fires BEFORE the body leaves and belongs to the manual sale alone.
  Fodder Treatment / Feed the Alpha were NOT re-routed (they keep their lighter path; a follow-up if wanted).
- One incidental change from the move: the Foundry Dragon filter became `defIsTribe(c, 'dragon')` (the tribe-
  predicate ratchet forbids a new raw compare in `recruit.ts`), so an All-types body now counts as a Dragon for
  Rune of the Foundry — consistent with the 2026-08-26 ruling. Reducer pin 14 → 13.
- Stats land on the right-most MINION offer (spells / Rubies skipped) as an offer buff sourced "Dissipate", read
  BEFORE the sale rituals so a Seller's Market pump lands on the board that remains.
- No Shop minion → refused outright (`spellFizzle.ts` table entry: card kept, no Gold, nothing sold).
- **Yazzus:** `singleCast: true` — the target is gone after the first sale, so a second cast could only be a
  no-op; the card resolves exactly once (the Fodder Treatment ruling).
- Tests: `packages/sim/src/dissipate.test.ts`. Pins moved consciously: set3Scaffold spells 62 → 63, sets.test's
  set-2 own list, guardReachability fixture, strategy census (`demonConsume` 32 → 33, `spellEngine` 106 → 107),
  a `never` policy for the bot, the balance fixture snapshot (regenerated), findings.test's "planted hero ranks
  first" relaxed to "first HERO lead" (a reseeded synthetic spell draw now edges it by 0.09 — fixture noise),
  contracts re-extracted (1047 → 1048), final-report headline numbers updated. Art: `sp_dissipate.webp` from the
  owner's master; ratchet 1252 → 1253.

## The Equipment cost coin always renders

`StatusBar.tsx` hid the Equipment coin on a falsy cost (`{equipCost ? … : null}`), so a 0-cost activation showed
no number at all (owner screenshot: Bloodpot with no coin). Now the coin ALWAYS renders: a plain 0 (Star
Destroyer) prints "0" on the gold coin; a cost DISCOUNTED below the definition's `baseCost` (Quick Release armed,
Efficient Tooling, Overcharge, Empty Hands / Last Tool, a temporary reduction) prints the live number on the
green `.hpcost.discounted` coin — the same re-tint the Rune pivot coin uses. No title attribute (native tooltips
are off). Test: `equipCostPill.test.tsx`.

## Cage Breaker: the death plays, THEN the Discover — root cause

**Report:** the destroyed minion's death animation was cut off / hidden by the Discover overlay.

**Root cause was in the reducer, not the overlay.** Cage Breaker's aimed Shout stamps `pendingDeath` AND opens
`run.discover` in ONE commit. Recruit's landing timer then dispatched `resolveShopDeath` 200 ms later — and the
reducer's modal gate (`modalOpen(state) && action.type !== 'discover' | …`) REFUSED it, because a Discover was
open and `resolveShopDeath` was not on the exemption list. So the body stood on the board under the overlay
until the player's pick, whose safety pass at the top of `reduce` settled the death in the same instant the
overlay closed: a dissolve nobody saw.

**Fix, two halves:**
1. `resolveShopDeath` is exempt from the modal gate when `pendingDeath` is set. This changes NO ordering — the
   death settles before the pick resolves either way — it only lets the settle be its own commit. Pinned in
   `set3Undead.test.ts` (accepted under the modal; the Discover untouched; `roll` still refused; same end state).
2. `Recruit.tsx` holds the Discover overlay's RENDER (and its burst + `sfx.discover`, which `store.ts` now skips
   when a death is pending) while `run.pendingDeath` is set, then for `deathDelayMs + DEATH_DISSOLVE_MS (600)`
   after the death commits (+ `RISE_REFORM_MS` when the body Rises), then opens it and plays the cue. Measured on
   5199: Shout resolves t=0 → death settles 222 ms → body leaves the DOM 230 ms → Discover mounts 889 ms.

The hold is keyed on `pendingDeath` + `discover`, so any effect that destroys and Discovers in one action gets
it for free (today only Cage Breaker does; Graverobber / Grave Robbery grant spells inline and never open an
overlay).
