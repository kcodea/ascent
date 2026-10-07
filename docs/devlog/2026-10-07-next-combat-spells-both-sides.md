# 2026-10-07: Next-combat spells carry over, work for both sides, and cast at Start of Combat

Owner rulings (verbatim): on the lost spells, "these should carry over."; "rallying offensive and marked target
should work for opponents."; on bare seat-vs-seat sides, "is a significant issue that needs to be fixed."; on the
shared snapshot, "this is probably okay as long as they are spent on the turn the player played them"; on the beat,
"we need to show these spells being cast in a start of combat beat ... for opponents, they should cast on the right
side of the screen opposite where the player's side is."

Rules: **R-LOBBY-14** (foundation), **R-NEXTCOMBAT-01** (persistence), **R-NEXTCOMBAT-02** (combat),
**R-NEXTCOMBAT-03** (ordering).

## Engine

- **One per-side channel.** Rallying Offensive, Marked Target, Fleeting Vigor, the banked keywords (Field
  Maneuvers / Last Stand / Executioner's Edge) and Open the Gates now ride `QuestCombatMods` (`rallyDouble`,
  `markFoeRightmostTaunt`, `fleetingVigor`, `bankedKeywords` by board INDEX, `bankedImps`), built by
  `nextCombatBankMods` inside `questCombatMods`, so `snapshotBoard` captures them like Weaken. `simulate` applies
  them for whichever side holds them through `core/combat/bankedOpeners.ts` `applyBankedOpeners`: the reducer's
  historical player pre-bake, verbatim in order and numbers, run on copies before the boards are read. Marked
  Target is applied after both sides' openers, to the holder's FOE.
- **Spent at settle, not at End Turn.** The run keeps the banks armed through the fight (`settleCombat` clears
  them), which is what lets the snapshot captured after `faceOmen` carry them. `preparePlayerCombatSide` no longer
  mutates the banks; its End-Turn collector beats (`system:startOfCombat:*`) are emitted from a scratch copy.
- **Problem B.** `simulate` spends its own shallow copy of each side's `questMods`; `sideFromSnapshot` builds a
  fresh mods object per fight and takes an optional `fightRound`. **"The round they were cast"** =
  `snap.wave === fightRound` (`snapshotBanksLive`): `boardAt` serves a seat's board for that exact round when it
  has one, and every re-serve (a recorded seat's final board past its end, the earlier board for a skipped wave, a
  ghost from the round it died) carries an older wave, so its banks AND one-combat marks (Bloodlust, Parting Cry,
  Closed Casket) are stripped. Non-lobby pool boards pass no round and behave as before.
- **Problem A.** `seatCombatSide` is the one seat builder: the player's lobby foe, every opponent-vs-opponent pair
  and the bye-vs-ghost fight in `runLobby.ts`, and the headless `lobby.ts`. The balance runner's manual Marked
  Target and the production bots' double pre-bake are gone (simulate does both now).
- **Pre-emptive Assault** is captured (`attackFirstNext`) but still applies only through the player's
  `CombatConfig.playerAttacksFirst`: NEEDS AN OWNER RULING on both sides holding it.

## The cast beat

New combat event `bankedCast { side, spellId, count? }` (additive in `types.ts`, stamped with the policy key
`system:startOfCombat:bankedCast`). `openingEvents` rewinds the starting snapshot to the pre-bank board and opens
the log with each bank's marker then its effect (`buff` / `keyword` / `summon`), exactly the way `enterCombat`
used to rewind Fleeting Vigor; Weaken's marker is emitted inline before its Health drop; armed-for-later banks
(Decoy Sigil, Solid Ground, Containment, Stolen Initiative, Summoning Bulwark, Rallying Offensive, the per-minion
marks) announce as the fight opens. UI: moment kind `bankedCast` (own `bankedCast: 620` pacing key), score channel
`bankedCastFx` → `showBankedCastPreviews`, the rune-cast preview (shop look) anchored at the rune rack / hero power
for the player and mirrored across the screen for the opponent; an opponent's card prints the opponent's spell
power. One-shot, opacity/transform only (the existing cast-preview CSS).

## Verification

`nextCombatSpells.test.ts` (43): every spell's player fight vs a reproduction of the removed player path (same
outcome, same gameplay events, same Start-of-Combat board); every spell served as the enemy applies with its beat;
stale re-serves repeat nothing; the snapshot is never mutated; the odds probe sees the banks un-spent; seat fights
use full sides; determinism. `nextCombatBanks.guard.test.ts` fails a new bank-shaped RunState field until it is
classified, and a next-combat bank without a capture + enemy application. Scene Builder repro:
`packages/sim/src/docbot/scenarios/next-combat-casts.json` (import it, End Turn).

Re-pins: `legacyDefects.test.ts` defect (c) flipped to RETIRED; `seatRunner.test.ts` corrected-vs-shipped
difference test rewritten (shipped now lands the enemy's banked keyword too); Fleeting Vigor / keyword / Imps /
Marked Target tests fold the opening (the effect is a beat now, not in `initial`) and check the spend at settle;
`replayOdds` Fleeting test reads `questMods.fleetingVigor`; the Doc Bot mod lane arms the new object-shaped mods
(inert pin unchanged at 101; `attackFirstNext` is the one inert new key, by design).
