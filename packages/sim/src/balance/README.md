# `packages/sim/src/balance` — the balance bot (2026-09-15)

Built from [docs/balance-bot-roadmap.md](../../../../docs/balance-bot-roadmap.md). Reusable simulation interfaces
live here; Node workers, storage and the CLI live in `packages/tools/src/balance`.

| File | Work package | Owner |
|---|---|---|
| `types.ts` | the shared contract (manifest, identity, pilot boundary, records, recorder) | everyone reads, nobody renames |
| `hash.ts` | `stateHash` for accepted-action reconciliation | B0 |
| `identity.ts` | the PURE half of `ExperimentIdentity`: `digest` (FNV-1a 64), `canonicalJson`, content / pool / effect / manifest digests, `resolveManifest` defaults. Takes an `EnvironmentIdentity` for the Node-only inputs | B0 |
| `legacyDefects.test.ts` | the roadmap's measurement defects, each pinned as a green test that asserts CURRENT behaviour (`DEFECT — retire in Bx`) | B0 |
| `seatRunner.ts` | **shipped (B1, 2026-09-15)** — `playRecruitTurn` drives ONE seat's recruit turn through the real reducer with a `SeatPilot` (rejections / open modals / the action budget FAIL the seat); `prepareAndFight` resolves a pair with ONE `simulate()` and lands it on both runs through `resolveCombat { fight }`; `mirrorForEnemySeat` is the documented enemy-side seam | B1 |
| `selfPlayLobby.ts` | **shipped (B1)** — `runSelfPlayLobby`: eight living seats, the shipped `pairRunLobby` / `hitSeat` / `knockOutIfDead` / `closeRunLobbyRound`, one authoritative fight per pair, ghosts for the odd seat, real settlement carried into the next recruit; a seat failure censors the lobby | B1 |
| `pilots.ts` | the `SeatPilot` registry — `greedy` (B1's test baseline: first option / cheapest minion / end turn); the generalist is B3's | B3 |
| `recorder.ts` | the `BalanceRecorder` that builds a `LobbyRecord` | B5 |

## Where the Node-only parts live (B0 decision)

`@game/sim` is consumed by the browser (the dev panel runs `balanceReport`), so nothing here may import
`node:child_process` / `node:fs`. The identity is therefore split:

- **`sim/balance/identity.ts`** — pure. `computeExperimentIdentity(manifest, env?)` computes `contentDigest`
  (the set's cards in POOL ORDER + heroes + runes + quests + equipment + the set entry), `poolDigest` (ordered pool
  ids), `manifestDigest` (the resolved manifest) and `effectDigest` (the sorted `EffectFactoryId` list + whatever
  source texts `env` supplies). Without an `env` the revision is `'unknown'` and a report must refuse to treat two
  such identities as the same build.
- **`tools/src/balance/identity.ts`** — Node. `nodeEnvironment()` = `git rev-parse HEAD`, digest of `git diff HEAD`
  ('' when clean), and the text of `sim/src/recruit.ts` + `reducer.ts` resolved from `import.meta.url`.
  `computeNodeIdentity(manifest)` is what the CLI and the runner stamp on every record.

CLI: `npm run balance:manifest -- packages/tools/src/balance/manifests/set3-selfplay-smoke.json` prints the resolved
manifest + identity; `npm run balance:census` prints the per-set content census + mechanic coverage and writes
`tools/src/balance/out/census-<set>.json` (gitignored).

## How a self-play fight is faithful (B1)

The reducer's `faceOmen` was split into `endRecruitTurn` → `preparePlayerCombatSide` → (fight) → `enterCombat`
(behaviour-preserving extraction; the shipped player path calls the same functions). `faceOmen { deferFight }`
ends the turn and parks the prepared side on `run.pendingCombatSide` without resolving a fight; the lobby runs
ONE `simulate()` per pair and each run lands its perspective through `resolveCombat { fight: { result,
damageTaken } }`, which then settles and advances exactly as a bare `resolveCombat` does. While a fight is
deferred, `settleCombat` and a bare `resolveCombat` are refused.

`ExperimentManifest.fightRules` labels which combat rules the fights use — `corrected` (both seats through the
player's full builder) or `shipped` (the enemy seat through the served-board `sideFromSnapshot` path). The
production discrepancies the label covers, and the one it cannot (the simulator's player-only carry-backs), are
spelled out on `FightRules` and `mirrorForEnemySeat` in `seatRunner.ts`.
