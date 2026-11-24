# 2026-11-23: Four runes (Wizened Gems, Petah, Furlboggen, Huntsman) and three rune-only minions

Owner design 2026-11-23. Rules R-WIZENED-1123-01..04. Tests: `packages/sim/src/wizenedRunes1123.test.ts` (engine, both
phases and both sides) and `packages/ui/src/wizenedRunes1123Text.test.tsx` (live text).

## How each one is wired

- **Wizened Gems**: the Sequencing shape. One count (`runeWizenedGemsTick`) and one rule (`advanceWizenedGems`, core).
  Shop half: `wizenedGemsOnCast`, called at the R-SHOPSPELL-01 test inside `noteSpellCast` and at `countRubyAsShopSpell`
  (Spellstone), so Start and End of Turn casts pay the moment they happen. Combat half: `wizenedGemsCombat`, at
  `spellResolved` and at a Spellstone Ruby. The live x/3 rides the existing silent `shopSpellTally` marker (`wizened`),
  not a `questTrigger`, whose lone moment holds 460 ms.
- **Petah**: data only (`onSpellCastBuffRandomTribe` + `includeRubies`), plus the combat half of `includeRubies`.
- **Furlboggen**: new arena effect `onRubyPlayedRubyEachType`. `playRubyOn` now tells the target how many Rubies the cast
  was; the Shop already knew. A module latch held for the whole fan is the owner's no-chain ruling.
- **Huntsman**: new arena effect `onAnyDeathGainSelf`, a friend-death watcher (`DEATH_WATCHER_FACTORIES`), so it is never
  an Echo. Combat rides the `onDeath` broadcast, the Shop rides `fireOnFriendDeath`.

The Shop's `onRubyPlayed` and friend-death dispatches now open their own nested beat per fire (the
`fireSpellCastWatcher` shape). Reflector, Ashen Heir and Echo Mimic get the same beat.

## Found on the way

- The Shop's `damageAll` verb (a Shop-fired Blaster Echo) never told the death watchers about the bodies it killed. Fixed:
  Huntsman needs it, and so did every other watcher.
- NOT fixed: a Blaster destroyed in the Shop fires its Echo twice when its own 3 damage kills its own vacating body.
- NOT fixed: Matriarch counts a combat Ruby twice while the Spellstone is held (`runeRubyCastCombat` plus `castSpell`).
  Petah takes the one-fire path.

## Open for the owner

With the Spellstone and 3 or more casts per Ruby (a Gilded Yazzus), each Ruby cast by hand earns a Ruby back. It never runs
by itself, but the player can keep going until the timer ends. The four runes wear the owner's art (wired as
drawn, owner ask 2026-11-23); the three minions have none yet.
