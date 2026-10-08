# 2026-10-07 - Rune of Shared Scripture never heard most combat casts

**Owner report:** "this rune is not working at all, can you please branch off and fix this?"

**Root cause.** The rune listened on `ctx.onCombatSpellCast`, called from inside `resolveCombatSpellCast`. Only
some combat casters reach that resolver (Sporebat, Quil, Badgington, Mage-Pup, Dragonflame via
`castNamedSpellInCombat`). Every `castRepeat` caster (Fatecarver / Taragosa / Hoardbreaker's Growth, Watcher's
Lantern of Souls, Ashen Broodlord's Staff of Guel) and the random-stat-spell casters (Spell Drummer, Spark
Capacitor) cast a real Shop spell through `castInCombat` without it, so the rune never fired for them. Its only
test used Sporebat, the one path that worked.

**Fix.** The rune now listens on `spellResolved` (the per-cast chokepoint `castInCombat` reports every repetition
through, with the spell id), gated on `isShopPoolSpell` (R-SHOPSPELL-01) like Goldilox and Rubywire. The
`onCombatSpellCast` hook is removed. Reading of the text kept: the left-most minion WITH a Shout and the left-most
minion WITH a Rally (Rune of Rallying / War Chorus convention). The latch is set before firing; it now also fires
once per copy held (the boolean-flag family rule). Oracle: `R-SCRIPTURE-01`.

**Side note.** Rune of Enchantment is wired on `castSpell` (every `castInCombat` repetition), so it does not share
this gap; it does fire on non-Shop spells cast in combat (e.g. a Star Crash), which is a separate question.
