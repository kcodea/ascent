# 2026-10-13 — Combat side symmetry (R-SYMMETRY-01)

Owner ruling: *"all of this just shows bugged logic, then. all of this should work on both sides. it's imperative
that both sides are equal in what's captured, represented, buffed etc. they should be 1:1 exact"*.

## What changed

`simulate()` no longer treats the `enemy` side as a silent accumulation. Every rule, live read, event and
carry-back runs identically for both sides.

Fixed asymmetries (all gameplay bugs on the enemy side):

- Starting-board auras: `applyAuras(start)` ran for the player only, so a served board's Undead fought without its
  Lantern aura (and Grim Toast Dwarves without the Undead Aura).
- Per-card stacks banked this fight (`cardBuffGains`) and the side's `cardBuffs` prior: player only.
- Pack Mentality live growth / progress carry-back: player only.
- Blood Trail mark + Beast grant: player only.
- Mid-combat quest completion (`pendingQuests`): player only.
- Live Echo tally (`deathrattleTally`): enemy read its frozen value.
- Live spell power (`grantSpellPower`): enemy frozen; its combat spell tally started at 0 instead of `spellsCast`.
- Rune of the Cinder Ledger: enemy Imp Aura not advanced live.
- Echo Warden: player only.
- Rune of the Herald: the enemy folded no Echo multipliers.
- Soulbind / Xerox bond: player only.
- Perfect Core / Spell Weld rally grants drew from the player's pool for either side.
- Hand: enemy hand grants were recorded but never emitted, never fired its `onGainCard` reactors; enemy hand buffs
  never grew the live hand copy (a later hand-summon fielded the unbuffed body).
- Presentation: many rune / hero triggers, `toHand`, `handBuff`, `tribeAura`, `maxGold`, Spell Power / Shop / next
  spell narrations were emitted for the player only. They now emit for both sides, side-tagged.

New `CombatConfig` options (additive): `enemyAttacksFirst` (Pre-emptive Assault is a per-side engine option; both at
once cancel) and `firstSide`, the tie-break for things that happen to both sides at once (SoC pass order, a
board-wide spray, uid minting order, which side's random hand grants use the main RNG stream, which side the
first-attacker coin names). Default `player` = the order every recorded fight used, so default fights keep their
RNG sequence. `CombatContext.sideOrder` exposes it to the factories.

Also found by the mirror test: a temporal-dead-zone crash when a Star Crash / Ruby cast resolved during Start of
Combat (`meteorEchoing` / `gemStarUsed` were declared after the SoC pass). Hoisted.

## Serialization

`snapshotBoard` now captures exactly what the owner's fight read: `questMods` from `playerCombatSideState` (Ancient
hero mods included, `attackFirstNext` still stripped per R-PREEMPTIVE-PLAYER-01), `firstSpellThisTurnId`,
`spellhide`, `pendingQuests`, and each minion's run-card uid as `sourceUid` (so uid-keyed mods resolve on a served
board). `sideFromSnapshot` / `opponentBoard` restore them; old snapshots default to none. `mirrorForEnemySeat` now
maps the Shout and Ancient carry-backs too.

## UI

Side filters for the newly two-sided events: hand-grant flights and the shown-grant list (player only), the
narration ("your" / "their" hand / max Gold), Squirl Scout's `scout` fold and the Spell Power drawer fold
(untagged = player, for old logs).

## Tests

- `packages/core/src/combat/sideSymmetry.test.ts`: the mirror property test. 900 random pairs across sets 1-3 with
  random run contexts and random mods from the whole `QuestCombatMods` catalogue; A-vs-B must equal B-vs-A
  (`firstSide: 'enemy'`) up to the side swap: outcome, both damages, starting snapshots, every event, both
  carry-backs. Mutation-checked: reverting any of the fixes above fails it or the targeted file.
- `packages/core/src/combat/enemySideLive.test.ts`: one case per fixed card / mechanic on the enemy side.
- Fixture changes: `simulate.test.ts` "captured ENEMY Spear Warden re-gains its OWN enchant" now 23/13 (was 19/11:
  its own death's +4/+2 stack is live, as on the player side); `symmetricCarry.test.ts` "pure accumulation", "side
  stream" and "kept asymmetries" cases rewritten for the new contract; `snapshot.test.ts` expects `sourceUid`.

## Perf (`npm run perf`, same machine, back to back)

| metric | main | branch |
|---|---|---|
| simulate 2v2 | 0.137-0.150 ms | 0.146-0.158 ms |
| simulate 4v4 | 0.147-0.153 ms | 0.149-0.153 ms |
| simulate 7v7 | 0.135-0.141 ms | 0.135 ms |
| 7v7 keyword-heavy | 0.191-0.194 ms | 0.189-0.197 ms |
| full run | 152 ms | 141-150 ms |

No measurable change.

## Remaining (not asymmetries of rules)

- `firstSide` tie-break (by design; documented in `CombatConfig`).
- `CombatConfig.playerRallyDouble` (legacy, unused by the run loop; the live channel is per-side
  `questMods.rallyDouble`) and `forceEnemyFirstTargetCard` (tutorial only).
- `CombatResult.enemyScalers` and the legacy `player*` fields / `ctx.spellsThisTurn` style accessors are one-sided
  by shape (presentation / back-compat), not by behaviour.
- Fleeting Vigor's narration text reads "your" / "their" by seat.
- `sideFromSnapshot` still gives the served board the live run's pool (R-LOBBY policy) and strips Pre-emptive
  Assault (R-PREEMPTIVE-PLAYER-01): run-level policies, not engine rules.
- `mirrorForEnemySeat` keeps the shared event log's labels (one fight, two seats).

`feat/versus-phase0`'s `packages/sim/src/versus/mirror.ts` can drop its asymmetry list.
