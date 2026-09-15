# 2026-09-15 — Balance bot B1: the authoritative seat runner + eight-seat self-play lobby

Work package B1 of `docs/balance-bot-roadmap.md` ("Faithful turns and fights"). Branch `feat/balance-b1-runner`
onto `feat/balance-bot-base`. Engine + sim only; no player-facing change (no patch note).

## What shipped

- **`packages/sim/src/balance/seatRunner.ts`** — `playRecruitTurn(run, pilot, ctx, recorder, opts)`: the pilot
  proposes, the real `reduce` validates and executes, the recorder sees ACCEPTED transitions only (gold before /
  after, visible offers, pre/post `stateHash`, attributed effect events by state diff). `null` ends the turn
  through the real end-turn action. Three consecutive rejections, an unanswered modal, or the action budget FAIL
  the seat — never a silently forced end turn (roadmap measurement defect #2). `prepareAndFight(a, b, seed,
  opts)`: one `simulate()` per pair, both runs settled through the real `resolveCombat` path.
- **`packages/sim/src/balance/selfPlayLobby.ts`** — `runSelfPlayLobby(manifest, seed, pilotFor, recorder,
  identity)`: eight living `createRun(…, 'lobby', …)` seats pinned to the manifest's set, heroes rotated per seed
  under the production rules (unique per lobby, `wip`/`practiceOnly` excluded unless named, tribe-gated heroes
  only on runs that rolled the tribe), the shipped `pairRunLobby` for pairing, `hitSeat` / `knockOutIfDead` /
  `closeRunLobbyRound` for damage, elimination, shared placements, the wipeout guard and `maxRounds`; the odd seat
  fights the most recently fallen seat's last board (ghost). A seat failure censors the whole lobby (`failure` on
  the record, every run `failed`, no placements). Byte-identical records across two runs of one seed.
- **`packages/sim/src/balance/pilots.ts`** — the `greedy` baseline (first prompt option, cheapest affordable
  minion, play everything, end turn) + `pilotFor(id)`. B3 replaces it.
- **Reducer extraction (behaviour-preserving):** `faceOmen` is now `endRecruitTurn` → `preparePlayerCombatSide`
  → fight → `enterCombat`. `faceOmen { deferFight }` ends the turn, spends the Start-of-Combat banks and parks the
  full prepared side on `run.pendingCombatSide` without resolving a fight; `resolveCombat { fight: { result,
  damageTaken } }` lands a deferred result (armor first) and then settles + advances as before. `settleCombat`
  and a bare `resolveCombat` refuse a deferred run. `runLobby.ts` exports `hitSeat`, `knockOutIfDead`,
  `closeRunLobbyRound` (extracted from `settleRunLobbyRound`, which now calls them).

## Production discrepancies found (documented in code, not silently corrected)

1. **The simulator's carry-backs are player-side only** (`core/src/combat/simulate.ts` return block; 74
   `side === 'player'` gates). ~45 `player*` fields; the enemy side gets exactly `enemyDamage`. Enemy
   Deathrattles are not even counted. The seat that fights as `enemy` therefore keeps its outcome, damage, deaths
   and survivors (`mirrorForEnemySeat`) and none of what it earned. In the shipped table this is invisible because
   no non-player seat progresses; here it is an explicit, auditable loss on the enemy side of every pair. Fix =
   a symmetric carry-back surface in `simulate` (core, shared boundary — its own PR).
2. **Non-player seats enter combat with less than the player** — `runLobby.ts` `settleRunLobbyRound` fights
   seat-vs-seat with a bare `combatSide({ tier })`; the player-vs-seat path uses `sideFromSnapshot`, which lacks
   `firstSpellThisTurnId`, `spellhide`, `pendingQuests`, every pending Start-of-Combat bank (Fleeting Vigor,
   banked keywords, Open the Gates' Imps) and the one-fight `CombatConfig` flags. Runner: `fightRules:
   'corrected'` (default, both seats through `preparePlayerCombatSide`) vs `'shipped'` (enemy through the
   served-board path), labelled on the manifest and every record.
3. **Served / lobby enemy Celestials have no alignment** — `cleanBoard` / `opponentBoard` never stamp `align`, and
   `alignAllows(effect, undefined)` is `false`, so alignment-gated halves are INERT on the enemy side of every
   shipped fight. `corrected` stamps it (`alignmentsOf`), `shipped` reproduces the gap.
4. **`CombatConfig` is player-only** — the enemy seat's Forthcoming / Rallying Offensive one-fight overrides have
   no expression and are spent unused (carried faithfully in both modes; noted in `prepareAndFight`).
5. **`lobby/seats.ts::botSeat`** prepared only while the board was empty, fought the pool for its own progression
   and copied the table's health at settle — replaced for balance use by the runner (not modified).

## Verification

- `packages/sim/src/balance/seatRunner.test.ts` (7) — the roadmap's first deliverable: two seats, two rounds,
  real settlement; armor-first damage equals the simulate() damage under the round cap; Right Hand Hank's Echo
  carry-back (`rightmostSlotBuff`) and Gemline's End-of-Turn Veinstorm are in the next recruit phase, generated
  exactly once; a repeated End Turn / settle / bare resolve is refused; stuck pilot, open modal, action budget all
  FAIL; `mirrorForEnemySeat` strips every `player*` field; `corrected` vs `shipped` proven to differ on a banked
  Start-of-Combat keyword.
- `packages/sim/src/balance/selfPlayLobby.test.ts` (7) — set2 + set3 full lobbies terminate, valid competition
  ranking, every round record's opponent names it back with mirrored damage, byes fight a seat eliminated
  strictly earlier, deterministic across two runs of a seed, failure censoring, `maxRounds` → `capped`.
- Throughput (greedy pilot, no recorder, this machine): set2 166 ms / lobby (34 rounds, 367 accepted actions),
  set3 191 ms / lobby (37 rounds, 475 actions); `shipped` within 5%. Zero failures over 80 lobbies.
