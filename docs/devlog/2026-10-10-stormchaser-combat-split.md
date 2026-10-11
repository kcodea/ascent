# 2026-10-10 · Storm Chaser combat split + First Blood archived

Follow-up to #2016, two owner rulings.

## Storm Chaser in combat: "Split (real time)"

#2016 had put `battlecryCastNamedSpell` in `SHOP_ONLY_SHOUTS`, so a combat re-fire deferred the whole Veinstorm to
settle. The owner ruled "Split (real time)":

- New combat factory `battlecryCastNamedSpell` (core/effects/factories.ts). For a Shop-Ruby spell
  (`spellBuffShopByRuby`), each cast is a real combat cast (`castInCombat`: counted, watchers, gilded = 2). The
  minion half lands NOW: a Ruby on every living friendly minion via `playRubyOn`, with a new optional `extra`
  per-Ruby bonus carrying spell power, so the value is 1 + Ruby strength + spell power. The Ruby is temporary, like
  every combat Ruby (owner ruling 2026-07-31). Any other named spell falls back to `castNamedSpellInCombat`.
- The Shop half is banked through a new `ctx.deferShopSpellHalf` into `ShoutCarry.shopSpellHalves`. At settle,
  `applyShopSpellHalf` (recruit.ts) runs the spell's own `spellBuffShopByRuby` body WITHOUT `minions`, once per
  cast. This is not a second counted cast.
- `SHOP_ONLY_SHOUTS` is back to 10. Oracle: R-STORMCHASER-01 (triggers.ts).
- Shrieker and Gemling are unchanged. Both run in the Shop through `castSpell`, so the whole Veinstorm still casts
  at once (pinned in koboldBalance1010.test.ts).

## First Blood archived

`q_first_blood` now has `sets: []` (offered in no set, the rune archive convention). The def stays in
`QUEST_DEFS` / `QUEST_INDEX`, so saves that hold it still load and pay out.
