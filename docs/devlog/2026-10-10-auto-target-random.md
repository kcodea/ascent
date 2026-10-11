# 2026-10-10 — Un-aimed targeted effects pick a random legal target (R-TARGET-07)

**Owner bug:** "in this setup, the humphry end of turn triggers should target a random dragon. they are targeting
the same one every time for some reason. this should be the case for all targeted minions when they get triggered
in a way that doesnt allow the player to target. it picks a random minion from the available options, not the same
one every time."

## Root cause

Two Shriekers re-fire both Humphrys every End of Turn through `replayBattlecry`, which calls the Shout factory with
no target. The un-aimed fallback of the arena's `battlecryBuffTarget` (Humphry, Twilight Emissary, Brood Whelp) and
`battlecryGrantKeyword` was `pool.reduce(highest Attack)`, so every fire fed the already-biggest Dragon (the
125/124 Shrieker). Same shape elsewhere: Roomworks took `board.find(legal)` (the left-most), the stranded-aim
resolve in `endRecruitTurn` took the highest-Attack "carry" (and, on an untyped aim, could pick the Shout itself),
and a Cage Breaker re-fire did nothing at all. R-TARGET-06 (2026-09-26) had already made Gravetwin / Runemaster /
Graverobber random; the rest never got the memo.

## Fix

One helper, `pickAutoTarget(rng, pool)` in `packages/core/src/effects/arena.ts` (one `rng.int` draw, the draw
`rng.pick` makes, so the swapped combat factories are draw-identical). Every un-aimed pick goes through it:

- arena `battlecryBuffTarget`, `battlecryGrantKeyword` (both phases: `arena.rng()` is the run cursor in the Shop,
  the fight's rng in combat)
- combat factories `battlecryBuffTargetPerGoldSpent`, `battlecryCopyEcho`, `battlecryGildTarget`,
  `battlecryDestroyForSpell` (were `ctx.rng.pick`, same draw)
- Shop `refireTarget` (now wraps `pickAutoTarget`), used by Roomworks (was left-most), Cage Breaker (was a no-op;
  now destroys a random other friendly Undead immediately, Graverobber's re-fire path, then Discovers), Baby
  Gastrid and Appetite Agent (inline draws folded in, same draw), Gravetwin, Runemaster, Graverobber
- `endRecruitTurn` stranded aim: random legal target, never self, honouring `battlecryTargetAllowed`

Because the fallback lives in the factory, every caller that fires without a target is covered: Shrieker / Moira
(`endOfTurnTriggerShouts`), Myra, Resonance, Echoing Roar, Rune of the Last Word, High King Mykel, borrowed-card
Shouts (`triggerBorrowedEcho`), Dawnclaw / Ryme / Ancient of Time in combat, and Roomworks re-fires settled in the
Shop (`replayEconomyBattlecry`). Each `replayBattlecry` repeat calls the factory again, so each trigger re-rolls.

**Repeat precedent (unchanged):** a PLAYER-aimed Shout's own repeats (Drakko, Warm Embers) reuse the chosen target
(`applyBattlecryTarget` passes `target` on every repeat). A gilded Roomworks' "twice" is one trigger and replays the
same picked minion twice. Neither is an un-aimed trigger.

**Owner rulings on #2027 (2026-10-10):** Cage Breaker "Yes, random Undead" (kept). Named spells "Yes, random
too": a minion or rune that CASTS a named targeted spell with no aim now goes through the same helper.
`minionCastTarget` (the highest-Attack "carry", the caster itself on a lone board) is replaced by
`castSpellFromMinion`, used by the `castSpell` factory (Rope Wrangler, Gemling), `endOfTurnCastSpellEscalating` and
the shop arena's `castNamedSpell` (Firebird, Flamebeat, Warflame); a targeted cast with no legal other friend
fizzles and is not counted, like `castSpellWithoutAim`. `pickRandomSpellTarget` (rune casts, Mage-Pup) now draws
through `refireTarget` (same draw). Combat's `castNamedSpellInCombat` now honours the spell's `targetTribe` /
`targetNoGolden`; the other combat cast paths (Sporebat, Mage-Pup, Beast casters, Meteor Storm, Celestial casts, a
taught Echo) were already random and now call `pickAutoTarget` (same draw). No live card currently casts a targeted
named spell at a chosen-by-engine target (Arnold casts on itself, Adept on "this"), so this is future-proofing plus
the R-TARGET-03 self-fallback fix. Stale comments in `set1/dragons.ts` / `set2/dragons.ts` fixed after #2023 landed.

## Verification

`packages/sim/src/autoTargetRandom.test.ts` (12 tests; 5 fail on `main`): the owner's Humphry + Shrieker board over
40 seeds reaches several Dragons, never the non-Dragon or itself, splits within one End of Turn, deterministic per
cursor; an aimed Humphry still lands on the aim; Roomworks random + aimed; stranded aim random; Cage Breaker random;
Twilight Emissary re-fired by Dawnclaw in combat reaches both Dragons, never the non-Dragon; same seed, same fight.

Named-spell tests (5 more): a Shop minion cast reaches every other friend across seeds, fizzles alone, is
deterministic; a combat Rally cast (test-only card index) reaches both other friends, never the caster.

Not changed: `deathrattleBuffRandom` (Shop half) still buffs the highest-Attack friend despite "random" in its name;
no card uses it today, and it is a random effect rather than a targeted one. Flagged, not changed.
