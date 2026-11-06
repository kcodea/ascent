# Owner balance pass 2026-11-06

18 minions, 2 spells, 5 heroes and 10 runes. Most are numbers. The parts a future session would otherwise re-derive:

- **Portsmith** lost its Avenge. New primitive `onFriendlyAttackPlayRubies` (arena body, both phases). Its own attacks count.
  `avengeRubyStatGain` has no live user now, so its policy entry went. The factory stays.
- **Spell Cart** stamps `ShopCard.cartCut` on the spells it rolls. The row buy reads it and clears it from the whole row.
  The three price readers are the reducer, `visibleState` and `Recruit.tsx`. A new reader must add the same cut.
- **Dawnclaw** is back on `one: true`. The Shop factory ignored `params`, and the rune re-fires passed `{}`, so all three
  were changed. Without that, a Shop Echo would still have fired both neighbours.
- **Gem Carver** uses the new `goldenGolems` param: Gilded adds a body and skips the x2. Kurse keeps one 2x Golem.
- **Geode Guardian** moved back to `deathrattleSummonGolemsWithRuby`, which adds Rubies at their current value.
- **Baller** has its step in three places: `recruit.ts`, `runeLiveState.ts`, `runeTally.ts`.

Judgement calls are listed in the PR.
