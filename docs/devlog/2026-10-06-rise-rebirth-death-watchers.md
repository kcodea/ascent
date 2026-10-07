# 2026-10-06: A Rise or Rebirth death is a real death for every death listener (R-DEATH-RETURN-01)

Owner ruling, after #1967 found Rune of Beastial Swarm deaf to a Beast that Rises or Rebirths: "yeah a minion that
rises/rebirths should get benefits from beastial swarm"

## Root cause

`killOrReborn` has three death branches: Rebirth, Rise and the true death. All three already shared the tallies, the
bus `onDeath` broadcast (with `ownAlreadyFired`), the dying body's own Echo, kill credit and `emitAvenge`. But a long
run of death listeners was written INLINE in the true-death branch only, so a death that led to a return skipped them:

- Rune of Beastial Swarm (the payout) and its Avenge (2) improvement.
- The Avenge-paced side watchers keyed on `deaths[side] % N`: The Bone Throne, Assembly Line, Rune of Blood and Coin.
  The Rise branch counted the death but never ran the check, so a Rise death that landed on the Nth death paid nothing
  and the payout skipped a whole cycle.
- The rune-granted Echoes and other body watchers: Rune of Moonhowl, Rune of Ancestral Roar, Rune of Ruby Shrapnel,
  Rune of Emberline's bank, Rune of Backbeat, Candlelight Toll, Rune of the Gem Golem, and the Parting Cry spell.

The Shop already did this right: `destroyMinionInShop` and `settlePendingDeath` call `fireOnFriendDeath` before the
return either way.

## Fix

- The inline listeners moved into four helpers in `simulate.ts`, one implementation called from all three branches at
  the same point in each: `deathWatchers(minion, returning)` right after the `death` event, `firePartingCry`, then
  `beastialSwarmImprove` before `emitAvenge` and `avengePacedDeathWatchers(minion, trueDeath)` after it. The true-death
  event order is unchanged.
- One death, one hearing: the shared parts (bus broadcast, own Echo, tallies) were not touched, so nothing doubles.
  Parting Cry is one-shot, so a returning body now spends it on its first death instead of carrying it to the next.
- True-death only, by scope: the Mossmemory Colossus and Final Gate graveyards (a returning body is not in the grave,
  and resurrecting it would copy a living minion) and the "last minion died" checks (Pit Without End, Finality,
  Crucible), since the board is not really empty.
- The returning Beast gets the swarm. A Rise return already does: `applyAuras` adds the side's Beast pool, which now
  includes its own death's payout. A Rebirth return keeps its body, so `beastialGiven[side]` tracks the swarm paid, and
  the return takes what landed while it was dead as a visible buff beat after `reborn`. In the Shop,
  `fireOnFriendDeath(…, { returnsWhole })` includes a rebirthing Beast in its own death's payout.

## Doc Bot

`deathReturnRider` in `combatModScan.ts` is the death-side twin of `summonReturnRider`. For each `QuestCombatMods` key it
compares the events between a body's death and the next swing (true death) against the window between the death and
the return (Rise, Rebirth), armed vs unarmed. On the old engine it names Beastial Swarm, Gem Golem and Assembly Line.
`runeRisingGraves` and `stolenInitiative` are exempt with reasons (they move the fixture's window, they do not listen).

## Not changed (siblings checked)

The hero/rune death meters (Rune of Body Counting, Xerox / Tradesman / Gorr / Nadja / Brackus Death Ancients, Bone
Taxer, Soul Taxes) read `deaths[side]`, the `onDeath` bus or `noteCardDeath`, which the return branches already ran.
Mossmemory Colossus's graveyard stays true-death only; its old comment claimed a Rise death "still counts", but the code
never did, and copying a body that is back on the board would be a new ruling.
