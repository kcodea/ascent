# 2026-11-10: Scrollz discounts only the first Shop spell bought each turn

**Owner ask:** "change scrollz -> the first spell you buy each turn is 1 less instead of every spell"

## What changed

- **Scrollz** (`d3_scrolldrake`): the price half of its aura now applies to the FIRST Shop spell you buy each turn
  only. Plain 1 less, Gilded 2 less, copies still stack on that one spell, floor 0. The extra spell in each Shop is
  unchanged.
- New text: "The first **Shop spell** you buy each turn costs **1** less. Each Shop has an extra spell in place of a
  minion." (Gilded: **2**). On every Shop-phase surface (board, hand, Shop offer, Discover) the card adds
  "Ready this turn." or "Used this turn." In combat it prints the plain text: there is no Shop, and the next turn
  starts ready.

## How

- `RunState.shopSpellBuys = { wave, n }` is the run's count of Shop spells bought this turn, read through
  `shopSpellsBoughtThisTurn(state)`. It is keyed on the wave, so there is no reset to forget, a frozen Shop carried
  into the next turn reads 0 again, and a save from before the field existed reads 0.
- `applySpellBought` ticks it. Both buy paths (the spell slot and a spell in the minion row) already reach that
  function, and it runs after the price is charged. A Ruby is not a Shop spell and never counts.
- `spellCostReduction` adds the Scrollz copies only while the count is 0. That is still the one function every spell
  price reads (both buy paths, the Shop price pill, both bot views), so no call site changed.

## One counter, not two

Ancients batch B (merged the same day) had added `ancients.valeSpellBuys` for Emissary x Fortune ("Your first Shop
spell each turn is free"). It had the right shape but lived on the Ancients state and only ticked while Ancients were
on, so Scrollz could not read it in a normal run. Rather than keep two parallel counters, the count moved to the run
(`shopSpellBuys`) and Fortune now reads `shopSpellsBoughtThisTurn` too. `valeSpellBuys` is gone.

How they compose: the turn's first Shop spell is THE first spell for both. With Fortune it is free (Scrollz cannot
take it below 0) and that buy uses up Scrollz for the turn as well. The second spell pays full price.

## Rulings built as assumptions (owner to confirm)

- "First" is counted for the turn, not per Scrollz. A spell bought before Scrollz was played has used it up.
- A first spell that was free for another reason (Fortune, Festival Wages, a floor of 0) still counts as the first.
- "Shop spell" is what the old discount covered: the spell slot and spells in the minion row. A Ruby never counts.
- Combat shows no Ready/Used note.

Oracle: `R-SCROLL-DRAKE-02` (economy); `R-SCROLL-DRAKE-01` keeps the offers half and the old price rule as history;
`R-ANCVALE-02` now names the shared count. Tests: `packages/sim/src/scrollDrake.test.ts`,
`packages/ui/src/scrollzText.test.ts`.
