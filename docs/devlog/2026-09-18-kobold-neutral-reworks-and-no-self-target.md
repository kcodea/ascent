# 2026-09-18 — Eleven card reworks (owner handoff) + R-TARGET-03: no card targets itself

Branch `feat/kobold-neutral-reworks-2026-09-18`. Content by NAME per the owner's handoff; ids unchanged.

## What shipped, card by card

| Card | Rework | How |
| --- | --- | --- |
| Dual Rubetta's (Kaura) | improve +1/+1 (was +1/+2); "left-most and right-most Kobold" | `equipmentRubyDuel` params only |
| Korn and the Kob (`k3_korn`; the handoff wrote "Korn on the Kob" — not renamed, flagged) | Rally Ruby is PERMANENT | `rallyPlayRubiesSelf` + `permanent: true` (Boulderdash's flag) |
| Kobe | Taunt; **when this takes damage**, 3 permanent Rubies on this + adjacent Kobolds | new combat factory `onDamagedPlayRubiesSelfAndAdjacentTribe` → the SAME arena body Kobe's SoC used; permanence rides `playRubyOn`'s carry-back |
| Boulderdash | + Flurry | keyword `W` |
| Livewire | a Ruby on this + 2 **random other** Kobolds (was adjacent) | new recruit factory `onSpellCastPlayRubiesSelfAndRandomTribe` (distinct picks off the run cursor) |
| Paragon | +5/+5 | params |
| Deathsayer | Rally: left-most Echo **and Shout** | `rallyProcDeathrattle` arena body extended: the left-most `onPlay` body re-fires through `replayShout` (gild ×2) |
| Neptus | copy of the first Shop spell — EVERY attack | the per-instance `firstSpellCopyFired` latch removed (field kept, unread) |
| Arena Heckler 6/5 | opposite minion gains Taunt **and Heckler attacks it immediately** | `scGrantEnemyTaunt` + `attack: true` → new arena verb `attackNow(target)`; combat queues via the existing `attackNow` lane with a **forced target** (`performAttack`'s Porkbelly path) and drains at once; shop no-op |
| Spear Warden 4/2 | HAS +4/+2 per Spear Warden that died this game | see below |
| Cage Breaker / EMS | never themselves | the global rule below |

## Spear Warden — the finding

The old card was an **Echo** (`deathrattleBuffCardTypeRunWide`). That means it did not count deaths: an Echo
multiplier (Sylus / Uron / Grave Contract) doubled the grant, a Deathsayer / Echohorn proc grew it with no death
at all, and a gilded Warden dying paid +6/+4. The owner's sentence is a HAS derived from a death count, so it is
now a **passive marker** (`cardDeathScaler`) read at the death site: `noteCardDeath` in `simulate.ts` (all three
death paths — real, Rise, Rebirth) and `noteShopCardDeath` in `recruit.ts` (a shop destroy is a death). The grant
still rides the run-wide `cardBuffs.knit` enchant every copy inherits (board, hand, future, a Rune-of-the-Warden
token), and the live text prints the total in place (`Has **{{+8/+4}}** (+4/+2 for every Spear Warden that died
this game; {{2}} so far)`) on the shared shop/combat chain. A gilded copy's death is ONE death; an enemy Warden's
death pays you nothing.

## R-TARGET-03 — no card targets itself (global)

The owner made the Cage Breaker / EMS fix the rule for every card. One helper per phase carries it — `others`
(arena), `otherFriends` (combat factories), `othersOnBoard` (recruit) — and the reducer refuses any self-aim
(aimed Shouts: `battlecryTarget`; aimed Equipment: the granting `sourceUids`). The aim UI and the bot view mirror
it. **Positional / identity reads are not choices** and are untouched: adjacent, left-most, "on this", "your
minions", and Paragon's "a minion of every type" (the owner's worked example has it paying itself).

Behaviour changed for: Bloodpot / Titan Hammer (never the granter — a lone Frank cannot buff himself), Auric
Runemaster, Gravetwin, Runic Beetle (alone → no grant), Brood Whelp / Twilight Emissary / Baby Gastrid /
Appetite Agent un-aimed re-fires (the "fall back to self" is gone), Gangplank, Drunken Oaf, Billings, Runekeg
(`excludeSelf` implied), Flowing Monk, Squirl Scout, Orbiting Familiar, Candle Conduit, Runic Archivist,
Runesnout Archivist, Mage-Pup's taught aimed spell, Rot Weaver, Spell Drummer, and every minion that casts a
named/hand aimed spell in combat.

`packages/sim/src/docbot/noSelfTarget.test.ts` drives every arena picker against a fake arena, every aimed Shout
and Equipment through the reducer, and carries a static tripwire over the three files: a body that draws RNG
over a friendly pool must go through the helper or be named with why it is not a choice. Rule registered as
`R-TARGET-03` in `packages/rules/src/registry/approved.ts`.

## Registries touched

`EffectFactoryId` + schema whitelist + `policies.ts` (three new ids; two ghosts removed), `anotherMinionExcludesSelf`
declarations, `textParse` unresolved cap 87 → 89 (Kobe's "play … Rubies", Heckler's "attack it immediately"),
`contracts:extract` regenerated, `final-report.md` headline numbers.
