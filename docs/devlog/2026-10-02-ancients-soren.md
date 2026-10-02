# 2026-10-02: Ancients × Soren

Soren's six Ancient pairings (hero id `soren`, power **Reclaim**: "Choose a friendly minion. At the start of combat,
destroy it and resummon a copy when there is room."), in the owner's words. Built on the Xerox branch
([2026-10-02](2026-10-02-ancients-xerox.md)) because every Ancients PR edits `packages/sim/src/ancients.ts`. Still
dev-only (the Scene Builder's Set 3 Ancients flag), so there is no patch note.

What Reclaim already did: it is free and once per turn. The Shop MARKS one board minion (`BoardCard.resummon`). At Start
of Combat the simulator destroys it as a true death (Rise and Rebirth are skipped, and its Echo fires), then queues an
exact copy of its current body. The copy returns the moment its side has room, beside the dead body's slot.

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Echoes triggered by Reclaim trigger an additional time." | The Echo from Reclaim's Start-of-Combat destroy fires once more, through `playerEchoExtras` (the shared Echo fold), scoped to that body. Echo watchers and the Echo tally hear both fires. |
| Fortune | "Reclaim works in Recruit phase instead. Gain 5g when it is used." | No mark. The use destroys the minion in the Shop right away (a true death, its Echo fires) and an exact copy returns to its slot as a summon. +5 Gold at once. Full board after the Echo: an overflow, and the copy is lost. |
| War | "Reclaimed minions gain +10/+10 on re-summon. Start of Turn: Improve this." | Each returned copy gains +X/+X as a combat buff. X starts at 10 and grows +10 every Start of Turn (`AncientsState.sorenWarGain`). The power prints X live. |
| Genesis | "Reclaim grants a plain copy of the minion you target, but it is locked for 3 turns." | Reclaim still marks, and a plain copy goes to hand with `lockedUntilWave = wave + 3`. The padlock shows the turns left. Full hand: no copy. |
| Time | "Reclaim summons twice." | Two copies are queued. Each waits for room. Only the first keeps the run card's `sourceUid`. |
| Bonds | "When the reclaimed minion summons, grant its attack to adjacent minions." | When a copy lands, its living neighbours gain Attack equal to its Attack, as a combat buff. |

## Owner rulings (2026-10-02, on the build's flags)

- **War**: "fight only, but engraving etc would carry it back". The +X/+X is a normal combat buff (`ctx.buff`), so
  Engraved keeps it.
- **Bonds**: "That fight only". Same: the neighbours' Attack is a normal combat buff.
- **Fortune, full board**: "it'd be an 'overflow' technically, but if no room then it is lost". The codebase has an
  overflow rule for a return with no room (`riseReturn`'s `fireSummonOverflow`), so that applies: the overflow
  watchers fire and the copy is lost. It is never sent to hand.

## How it is wired

- **Registry** (`packages/sim/src/ancients.ts`): a `soren` block, six `AncientEffect` variants (`reclaimEchoExtra`,
  `reclaimInShop`, `reclaimGainImproves`, `reclaimCopyLocked`, `reclaimSummonsTwice`, `reclaimBondsAdjacent`) and the
  hooks `ancientReclaimInShop` / `ancientShopReclaim` (Fortune), `ancientAfterReclaimMark` (Genesis),
  `ancientReclaimGain` + `sorenStartOfTurn` (War). One new state field: `sorenWarGain`.
- **Reducer**: the `resummon` branch either runs `ancientShopReclaim` (Fortune) or marks as before, then calls
  `ancientAfterReclaimMark`.
- **Combat** (`@game/core`): one mod, `QuestCombatMods.ancientReclaim` `{ echoExtra, copies, gain, bonds, label }`,
  read in the Reclaim Start-of-Combat loop (`reclaimEchoUid` for Death, extra queue entries for Time) and in
  `flushResummons` (War's gain, then Bonds' neighbour grant, both after the summon's own watchers).
- **UI**: the wave-lock padlock prints "N turns" while more than one turn is left (it read "Next turn" only, which was
  right for Hourglass Reserve's one-turn lock).
- **Doc Bot**: `ancientReclaim` is armed in the combat-mod scanner. It acts only on a Reclaim-MARKED body, which the
  staged fight has none of, so the inert pin goes 101 to 102 (pinned in the Soren tests).
- **Oracle**: R-ANCSOREN-01..06 in `packages/rules/src/registry/approved/heroes.ts`. **Tests**:
  `packages/sim/src/ancientsSoren.test.ts`.

## Judgement calls (open for the owner)

- **"Improve this"** follows the house convention: grow by the printed base amount, so +10/+10 more each Start of Turn.
  The first growth is the Start of Turn after the pick.
- **Genesis comes on top of Reclaim** (the mark still happens). The copy is the pool body
  (`grantMinionToHandOrBoard`'s plain copy, like Indy's Genesis). "Locked for 3 turns" means locked this turn and the
  next two, playable on the third turn after.
- **Fortune ignores Rise and Rebirth** on the target, the way combat Reclaim forces a true death. The copy is still
  exact, so it keeps its Rise for later. The copy fires the on-summon watchers (combat's resummon does).
- **Time's second copy** carries no `sourceUid`, so an Engraved gain on it does not reach the run card. The first copy
  keeps the link, as native Reclaim does.
- **FX**: no new beats. Combat uses the existing summon and buff events. Fortune's Shop destroy and return use the
  Shop death stamp and the board diff.
