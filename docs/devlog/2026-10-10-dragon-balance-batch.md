# 2026-10-10 — Owner balance batch: Dragons, Fatecarver, Steward, Conductor

Owner balance batch 2026-10-10, the Dragon slice (Kobolds/Rubies, Demons/Dwarves/Beasts and the Scene Builder were
other agents). Shared cards change in every set they are in (owner confirmed).

## Card changes

| Card | Change |
|---|---|
| Mushy (`d2_scalefeather`) | Shout and Echo: get a Dragonflame (was Growth). |
| Rune of Living Growth | ARCHIVED (it only worked with Mushy's Growth). Moved to `ARCHIVED_RUNES` with `sets: []`; its policy entry removed. |
| Vaultkeeper (`d2_herzog`) | Effect REPLACED: "When this gains Attack, give adjacent Dragons +3/+4." (gilded +6/+8). |
| Rune of the Vaultkeeper (`rune_herzog`) | "Get a Vaultkeeper. Your Vaultkeepers buff all Dragons." Same reward kinds (`runeVaultkeeper`), so saves keep working. |
| Broodfire | Shout: Dragons +3/+2. |
| Riverback (`d2_riverdrake`) | Sell: get a Dragonflame. |
| Karwind | Tier 5, +4/+4; gilded +4/+4 twice (two pulses, both phases already looped `mul`). |
| Humphry | "+2/+2 for every Dragon played this turn" with a live (+X/+Y). |
| Fatecarver | Tier 6; "When you cast a Shop Spell, give a friendly minion of each type +6/+6." Choose One removed. |
| Steward of Spells | Tier 4, 4/6. |
| Conductor | Tier 3, +3/+3. |
| Traveling Skald, Fel Conjurer | ARCHIVED (moved to `cards/archive.ts`); Fel Conjurer left the Dragonflame guide's enablers. |
| Roomworks (new) | T3 4/3 Dragon. Targeted Shout: trigger a friendly minion's End of Turn. Gilded twice. |
| Shrieker (new) | T5 5/4 Dragon. End of Turn: trigger your minions' Shouts (except Roomworks). Gilded twice. |

Roomworks and Shrieker are appended at the END of `SET2_DRAGONS` (owner: "so seeds don't shift"). Art wired from
`Set 2 Minions/Dragons/Roomworks.png` + `Shrieker.png`.

## New primitives and rules

- **`onGainAttackBuffAdjacentTribe` (Vaultkeeper), R-VAULT-01.** One arena body (`ARENA_EFFECTS`), two dispatches.
  Combat rides `onGainAttack`, which `ctx.buff` already emits per positive Attack gain. The Shop used to dispatch
  `onGainAttack` from the reducer's per-ACTION board diff, which folds every gain of an action into one; Vaultkeeper
  instead fires from the `addBuff` chokepoint (stamped run state, like Sable/Xerox), so every separate Attack buff is a
  gain. It deliberately has no `RECRUIT_FACTORIES` entry, so the diff never fires it a second time. Loop guard:
  `runVaultPulse` in `arena.ts` (shared by both phases): while any pulse resolves, no Vaultkeeper reacts. Each pulse is
  its own source-attributed beat (`factory:onGainAttackBuffAdjacentTribe:onGainAttack`, ownBeat). The rune reaches
  combat as `QuestCombatMods.runeVaultkeeper` (`ctx.vaultkeeperAllFor`).
- **Humphry, R-HUMPHRY-01.** `battlecryBuffTarget` gained `perPlayedTribe`: one lump buff of base x Dragons played
  this turn. The Shout fires after `playedThisTurn` records Humphry, so its own play is in the count (first Dragon =
  +2/+2, second = +4/+4, per the owner's examples). Live text `perPlayedTargetText`: hand/Shop/Discover copies add
  their own coming play, board and combat bodies (new `inCombat` flag from `Unit.tsx`) do not.
- **Roomworks: `battlecryReplayTargetEndOfTurn` + `targetHasEndOfTurn`.** A new CardDef target filter, enforced by
  `battlecryTargetAllowed` (reducer guard, `opensBattlecryAim`, the factory's auto-pick, and both aim checks in
  `Recruit.tsx`). Fires via `replayEndOfTurn`. A re-fire with no target auto-picks the left-most legal minion.
- **Shrieker: `endOfTurnTriggerShouts` gained `exclude`.** Each re-fired Shout is now its own beat sourced on the
  shouter.
- **R-ROOMWORKS-01 loop guard (`SHOUT_EOT_CHAIN` in recruit.ts).** No Roomworks Shout while a Roomworks Shout or a
  "trigger your Shouts" End of Turn is resolving; no nested "trigger your Shouts" End of Turn. Keyed by factory.
  Proven by `dragonBatch1010.test.ts` (Roomworks into Moira, which has no exclusion): with the guard removed the run
  dies of an out-of-memory recursion.

## Fatecarver save compatibility + skin

The effect carries no `option` gate any more, so a saved body with `chosenOption: 1` (the retired Growth branch) does
the new thing. The alt art `n2_fatecarver2.webp` moved to `art/skins/skin_fatecarver_1.webp` as the catalog skin
`skin_fatecarver_1` ("Astral Fatecarver", **Rare**: a builder's pick, since the master sits in the Set 2 Neutral
folder rather than a Skins rarity folder).

## Open for the owner

- The set-2 lesser quest **First Blood** still grants a Traveling Skald (it resolves through `CARD_INDEX`, so the
  reward works). Keep, or point it at another Dragon?
- The skin name and rarity are placeholders.
