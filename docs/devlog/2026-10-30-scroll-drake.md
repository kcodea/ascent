# 2026-10-30 — Set 3 Dragon/Spirit: Scroll Drake (placeholder name + stats)

Owner design: "Set 3: Add a t3 ... spirit minion that reduces the cost of spells in the shop by 1 and adds a second
spell to every shop. (This will replace a minion at highest shop tiers so that the shop doesn't have more total
offers)". Follow-up: "Actually make it a dragon spirit. Golden is 2 less".

**Scroll Drake** (`d3_scrolldrake`, T3 3/4 Dragon/Spirit, R-SCROLL-DRAKE-01), appended to `cards/set3/dragons.ts` (the
carried Set 2 Dragons shift one pool slot, as they did for Vellum and Nitrogen). A board aura with no effect
subscription (the Lazarus shape):

- **Price**: `spellCostReduction` adds 1 per copy on the board (2 Gilded). Every spell price reads that one function
  (both buy paths, the Shop's printed price, the production bots' visible state, and now the legacy `bots/policy.ts`
  spell lane too, which used to read the printed cost). Stacks with every other discount; buys floor at 0.
- **Offers**: `extraRowSpells` (shop.ts). `rollShopRow` (turn start + every refresh) draws one fewer minion and serves a
  spell at the right end of the row, after the slot spell (so a Drake-less run keeps its exact rng stream), tier-gated
  and different from the slot spell when possible. `topUpTavern` (a frozen shop) puts the spell in a gap. A kept/frozen
  spell already in the row counts. Capped at one extra spell for any copies. The Starform keeps its pinned slot.
- Interpretation: "at highest shop tiers" read as "the total never grows", so the spell takes a minion slot at EVERY
  tier. Roll-time only: playing it does not rewrite the row already on the table. Not applied to the narrowed
  minion-only refills (Sigil of Kinship, Elevation, Spell Cart, Muster, Membrance), which keep their own rules.

Tests: `packages/sim/src/scrollDrake.test.ts`. Content + sim change: redeploy versus-resolve with the next pack.
