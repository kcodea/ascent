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

**Not changed (flag for the owner):** minion-cast TARGETED SPELLS (named-spell casts, rune casts) still auto-aim at
"the carry", the highest-Attack other friend (`recruit.ts` ~9320 / ~13084 and the combat twin). Those are spells,
not targeted minions, and have their own documented convention; ask before moving them.

## Verification

`packages/sim/src/autoTargetRandom.test.ts` (12 tests; 5 fail on `main`): the owner's Humphry + Shrieker board over
40 seeds reaches several Dragons, never the non-Dragon or itself, splits within one End of Turn, deterministic per
cursor; an aimed Humphry still lands on the aim; Roomworks random + aimed; stranded aim random; Cage Breaker random;
Twilight Emissary re-fired by Dawnclaw in combat reaches both Dragons, never the non-Dragon; same seed, same fight.

Stale content comments left for a follow-up to avoid colliding with the `fix/humphry-baseline` branch:
`packages/content/src/cards/set2/dragons.ts` (Humphry "highest-Attack", Roomworks "left-most") and
`packages/content/src/cards/set1/dragons.ts` (Emissary "highest-Attack").
