# 2026-09-24: Rubies in the Compendium's Spells section

Owner ask (verbatim): *"the ruby types should show in the spells section of the compendium as well."*

## What shipped

- `packages/ui/src/MinionBook.tsx`: the Spells gallery now lists the Rubies (the plain Ruby plus Warding, Golden,
  Splintered, Ripple and Dark). Rubies are `token: true`, so `poolFor(set).spells` (which drops tokens) never had
  them.
- **The rule** (`rubyCardsFor`): a card is added only if it is `ruby: true`, and only in a set whose pool can make a
  Ruby, meaning at least one card in `poolFor(set).all` previews a Ruby through `relatedCardIds` (the same link the
  hover previews use). A set that makes any Ruby lists all six types, because "a random Ruby" draws from all of
  them. Today that means Set 2 and Set 3 list all six and Set 1 lists none. No other token comes along: Ruby Blast
  (Blast Pump's hidden cast) has no `ruby` flag, so it stays hidden.
- Rubies go into the Spells membership set (`poolIds().spells`) and into `allCards`. Like spells, they are not
  scoped to the run's tribes (the Ruby spells are neutral). The tier chart colours them with the spell colour.
- **Filters:** Rubies are Tier 1, so the Tier 1 chip keeps them and the other tier chips hide them, the same as any
  Tier 1 spell. The search box matches them by name or text. The set picker (#1683) re-derives them per set.
- **Look and live values:** `toView` now passes `ruby` through, so a Ruby wears its spell-like Ruby frame. A Ruby is
  never Gilded (the Gilded toggle leaves it printed). While the book shows the run's own set, a Ruby, and a Ruby
  in a hover preview, prints the grant it would mint at now (`rubyStatBonus(run)` plus its base, green through
  `rubyLiveText`), which matches Prismatic Pick's Discover. From the title or another set it prints its base.

## Tests

`packages/ui/src/compendiumRubies.test.tsx`: Set 2 and Set 3 list all six Rubies in Spells and Set 1 none; Ruby Blast
and every non-Ruby token stay out; the Tier 1 chip and search narrow them; the view is never Gilded and prints the
live grant in a run.
