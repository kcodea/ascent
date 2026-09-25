# 2026-09-24: Fight Recap (the Combat Summary redesign)

**Owner ask:** "a lot of this window is ugly/old/untouched these days and never really gets used. how can we
fix this up and make it better fit our current aesthetic and use cases?" The owner picked the "Fight Recap"
direction. It still opens only from the Summary pill, never on its own.

## What shipped

- **`packages/ui/src/FightRecap.tsx`**: the new overlay. It uses the house modal look: a dark glass panel
  (`#241a13` to `#17110c`), dark gold trim and cream text, the same chrome as the Discover banner, the
  Runeforge gold chip and the End Combat tip. The header shows the round, the result as a big gradient word
  (gold, red or silver) and the foe's hero portrait, name and hero. The "You dealt" and "You took" tiles
  split each number into Armor and Resolve. Below that come one line of odds, Stars of the fight, What you
  keep, a Details drawer (Procs and Log, closed by default) and the Watch replay and Close buttons.
- **`packages/ui/src/fightRecapData.ts`**: pure helpers, tested in `fightRecapData.test.ts`.
  - `fightStars`: reads the event log only. **damage** adds up every player `dmg` on an enemy. **kills**
    gives each enemy death (not a Rise's first death) to the LAST player minion that hit that body.
    **procs** counts effect triggers the minion sourced (`sc`, `shout`, `rally`, `summon`, `toHand`, `buff`,
    `keyword`, `handBuff`, `proccrit`, `pummelTrigger`, `maxGold`). Events on the same step count once, so a
    buff wave that lands on three minions is one trigger. Each category has one leader, and a tie goes to
    the minion that entered the fight first. A minion that leads two categories appears once, with both
    chips.
  - `oddsRecap`: the one-line copy, plus the Upset or Heartbreaker tag. The tag uses `ANNOUNCER_LOW_ODDS` /
    `ANNOUNCER_HIGH_ODDS` with the announcer's own comparisons. The slim bar shows only when more than one
    outcome rounds to 1% or more. The average-loss line shows only when a loss was possible but not certain.
  - `splitDamage`: Armor first, then Resolve, the same order as `hitSeat`.
  - `combatGainItems`: the same carry-back channels as `combatGains`, one mini card each. Kept or engraved
    stats are split out per minion. `sourceUid` is the RUN-board uid, so the run board resolves it.
- **Where the header data comes from.** The recap exists only during the combat phase, and the lobby round
  settles later, on End Combat (`resolveCombat`). So `playerOpponent(lobby)` still names this fight's foe,
  and every seat's `armor` is still its value going in, which is exactly what the split needs. "You took"
  uses the HUD's own `playerLossDamage` (or the capped `playerDamage` outside a rated lobby). "You dealt" is
  the capped `enemyDamage` on a win, and 0 against a ghost.
- **Watch replay** calls `useCombatReplay`'s `seekTo(0)` on the live fight, since the board is a pure fold of
  `(initial, events, upto)`. The button appears only once `run.combatSettled` is true, so the settle and the
  damage strike can never run twice. Verified live: seat and run health, hand and history were identical
  before and after a rewatch, and End Combat then settled the round once (seat 30/10 to 30/8).
- The recap now sets `body.modalup` while it is open, like every other board-covering modal.
- The old `.logov` / `.logbox` / `.logtab` / `.oddsbar` CSS is gone. `combatGains` (the string list) stays,
  because the em-dash guard test still reads it.

## Gotcha

`fightRecap.ts` next to `FightRecap.tsx` broke on Windows. Import resolution is case-insensitive, and it tries
`.ts` before `.tsx`, so `import './FightRecap'` loaded the helper module and the component came through as
`undefined`. The helpers are named `fightRecapData.ts` for that reason.

## Judgement calls (flag to owner)

- The Upset screenshot uses a real win with its odds stamped to 28%. A real low-odds win cannot be forced.
- 100% and 0% odds read "You were always going to win this one" and "This one was never winnable".
- "Triggers" counts effect firings, not attacks.
