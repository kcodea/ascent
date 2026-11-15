# 2026-11-14: Kennelmaster reworked into a summon buff

Rule R-KENNEL-01 (`summoning`); test `packages/sim/src/kennelmasterSummon1114.test.ts`.

## The change (owner design)

Kennelmaster (`kennel`, tier 2, Set 1 and served in Set 2) is now a **1/3**:

> When you summon a Beast, give it +1 Attack. Avenge (4): Improve this by +1 Attack.

It is no longer a Start of Combat card (the `SC` keyword and its `scBeastAura` effect are gone). Gilded reads
+2 improving +2.

## How

- `buffOnSummon` became one `ARENA_EFFECTS` body (`packages/core/src/effects/arena.ts`) that both phases call:
  `(attack + summonBonus x stepAttack) x golden` per stat. The combat wrapper (`factories.ts`) and the shop
  wrapper (`recruit.ts`) only check the payload. It never buffs itself. The factory had no other live users, so
  its old raw-read formula (no golden multiplier) went with it.
- Shop: a played or summoned Beast gets the buff permanently (the shop arena's `buff`). Combat: a Beast summoned
  mid-fight gets a combat-only buff. A Rise or Rebirth return is a summon (R-SUMMON-RETURN-01): both return paths
  call `summonEntryEffects`, which dispatches `onSummon`, so the returning Beast is buffed. Both are pinned, and both
  tests fail if the return paths stop dispatching.
- The Avenge is still `avengeImproveSummon` (count 4, x Rune of Mastery). It ticks `summonBonus`, which the body
  reads live, so the next summon that fight already gets the bigger buff, and the carry-back makes it permanent.
- Gilding: `kennel` stays in `GOLD_SCALED_ACCRUAL_CARDS`, so an in-place gild halves the count and a triple stores
  the half-sum of the two best copies (R-GILD-SUM-01). The owner's example still holds: a +16 and a +10 make +26.
- Presentation: `factory:buffOnSummon:onSummon` is a `foldedCue` in the `summonReact` family, like Beardsley.
- Live text: `summonBuffText` already handled the attack-only shape. It replaces only the first `**+N Attack**`
  (the grant), so the printed "Improve this by **+1 Attack**" step stays (golden text prints +2).

## Tests that moved

Kennelmaster was the go-to Start of Combat example in many tests. Those that used it for the mechanism (Twilight,
Uron, Combat Prowess replays, the P13 matrix row) now use Thunderous (`d2_sovereign`, archived, the remaining
`scBeastAura` user); Soulbind uses a test-only Start of Combat Beast card. The Twilight minion-only log was
re-pinned (same shape). Kennelmaster's own old-behaviour tests were replaced by the new test file.
