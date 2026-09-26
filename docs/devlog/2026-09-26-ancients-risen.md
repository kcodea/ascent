# 2026-09-26: Ancients × Lord of the Risen

Lord of the Risen's six Ancient pairings (hero id `risen`, power **Undying**: "Give a friendly minion **Rise** for the
next combat."), in the owner's words, built on the Ancients proof of concept and mirroring the Warden
([2026-09-26](2026-09-26-ancients-warden.md)) and Auctioneer ([2026-09-26](2026-09-26-ancients-auctioneer.md))
pairings. Still dev-only (the Scene Builder's Set 3 Ancients flag), so there is no patch note.

## The pairings

| Ancient | Owner's words | What it does |
| --- | --- | --- |
| Death | "Undying's target gains Rise after rising. (Once per combat.)" (blue) | In combat the Undying body regains Rise right after its return, once per combat, so it Rises twice. The regained Rise is BLUE. |
| Fortune | "When a minion Rises each combat, gain 1 Gold next turn." | Every friendly Rise in combat is counted the moment it happens (`onRise`); settle adds 1 Gold per Rise to next turn. The power text prints the last combat's Gold. |
| War | "The minion chosen by Undying returns with double Attack and attacks immediately." (red) | Every Rise of the Undying body doubles the Attack it returns with, then it strikes at once through the immediate-attack queue as an interrupting item (R-ORD-05: before the next normal attacker, between a Flurry's swings). Its Rise is RED, in the Shop and in combat. |
| Genesis | "Your summons summon an extra minion in combat." (+ "make sure these count as overflows"; "echo summons summon an extra body") | Every friendly combat summon summons one more copy through `summonMinion` (`summonGenesisExtras` in both halves of `placeSummon`), and every Rise / Rebirth return summons a copy of the returned body without the returning keyword (`summonReturnExtras`). On a full board the copy is a real overflow. Copies carry `doubled`, so they never copy themselves. |
| Time | "Start of Turn: Give your minions +3/+2 for every minion summoned in combat." (previous combat only) | Combat counts every friendly summon at the summon-entry chokepoint (`summonEntryEffects`); the next Start of Turn (`ancientStartOfTurn`, after `applyStartOfTurn`) gives every board minion +3/+2 per summon, permanently. |
| Bonds | "When a minion Rises, trigger an adjacent Echo." | Combat: an `onRise` listener fires a living neighbour's Echo through `triggerEcho` (every Echo multiplier, the `asEcho` chokepoint, a `rally` cue from the risen body); random when both neighbours have one. Shop: `riseReturn` (the one Rise return both shop-destroy paths share) fires it through the shop Echo ritual. |

## How it is wired

- **Finding the Undying body in combat**: nothing new rides the board card. `ancientCombatMods` sends the run uids of
  the `tempReborn` cards (`QuestCombatMods.ancientUndying.uids`), and `simulate` matches them against each combat
  body's `sourceUid` once the boards exist. Mods are player-only and never snapshotted, like every other Ancient mod.
- **New combat mods**: `ancientUndying` (Death / War), `ancientCountRises` (Fortune), `ancientSummonExtra`
  (Genesis), `ancientCountSummons` (Time), `ancientRiseEcho` (Bonds). New carry-backs `rises` / `summonsMade`
  (`CombatResult.playerRises` / `playerSummonsMade`), present only when their mod is on, so every other result is
  byte-identical.
- **Rise detection now counts Rises** (`risesOf` in simulate). performAttack used to decide "did this body die and
  rise this exchange?" by `rebornAvailable` flipping to false. A body that REGAINS Rise on return (Death here, and the
  Deathtouched Apple) holds Rise again afterwards and read as never having died: a Flurry minion kept its second
  swing, kill credit was missed. The five sites now compare a per-body Rise count before and after.
- **`triggerEcho` takes an optional `sourceMul`** so an Ancient's Echo fire is not doubled by the risen body's gild.
- **The tinted Rise look** (`RiseTint`, `'blue' | 'red'`): the combat snapshot carries `riseTint` (War's red from the
  first frame), the `reborn` event carries the tint of the Rise it spent, and Death's regain is a `keyword` event with
  `tint: 'blue'`. The UI frame, `Unit`, and the Shop board (`ancientRiseTint`) put `risetint-*` on the card. CSS
  recolours the dome, the wisps and the frame rim (static colours; the loops are still opacity / transform only). The
  Pixi spirit release and re-form (`rebornShatter` / `rebornSummon`) take a palette, and the unit's return pop has
  `risepopblue` / `risepopred` one-shots.
- **Oracle**: R-ANCRISEN-01..06 in `packages/rules/src/registry/approved/heroes.ts`.
- **Tests**: `packages/sim/src/ancientsRisen.test.ts`.

## Judgement calls (open for the owner)

- **Death's first Rise is the ordinary green one**; only the regained Rise (and its return) is blue.
- **War applies to every Rise of the Undying body**, so with another Rise source (the Apple) each return doubles and
  strikes again. Death / War / Genesis / Fortune / Time are combat-only (their texts say combat); Bonds runs in both.
- **Genesis is per body**: "summon two Pups" becomes four Pups (each Pup brings a copy), the Echo Warden precedent,
  and matches "echo summons summon an extra body". Rebirth returns get a copy too (a Rebirth return is a summon).
  The Reclaimer's Start-of-Combat resummon does not (it bypasses the summon-entry suite).
- **Fortune counts only Rises that return**; a Rise that overflowed (the body stayed dead) pays nothing.
- **Bonds is not gilded by the risen body**, and in combat reads the nearest LIVING neighbour on each side.
- **Known gap, not changed here**: the immediate shop-destroy path's `riseReturn` never ran the shop `onRise` watchers
  (`fireOnRise` is only called from the deferred `settlePendingDeath` path). Bonds' shop half lives in `riseReturn`
  so it reaches both paths. FIXED the same day: see [2026-09-26-shop-rise-watchers](2026-09-26-shop-rise-watchers.md).
