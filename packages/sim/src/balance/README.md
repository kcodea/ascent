# `packages/sim/src/balance` — the balance bot (2026-09-15)

Built from [docs/balance-bot-roadmap.md](../../../../docs/balance-bot-roadmap.md). Reusable simulation interfaces
live here; Node workers, storage and the CLI live in `packages/tools/src/balance`.

| File | Work package | Owner |
|---|---|---|
| `types.ts` | the shared contract (manifest, identity, pilot boundary, records, recorder) | everyone reads, nobody renames |
| `hash.ts` | `stateHash` for accepted-action reconciliation | B0 |
| `identity.ts` | `ExperimentIdentity` (engine rev, dirty digest, content/pool/effect digests) | B0 |
| `seatRunner.ts` | drive ONE seat's recruit turn through the real reducer with a `SeatPilot`; combat prep + settlement helpers | B1 |
| `selfPlayLobby.ts` | eight living seats, real pairing, one authoritative fight per pair, real settlement, carried into the next recruit | B1 |
| `pilots.ts` | the `SeatPilot` registry (`greedy` baseline, `generalist`) | B3 |
| `recorder.ts` | the `BalanceRecorder` that builds a `LobbyRecord` (`createRecorder` → `observeTransition` / `finalize`) | B5 |
| `effectsFromTransition.ts` | `effectEventsOf(before, after, action, ctx, lineage)` — attributed `EffectEvent`s read off the sim's per-action channels (the channel table is in the file header) | B5 |
| `fixtures/syntheticLobby.ts` | deterministic SYNTHETIC `LobbyRecord[]` from a seed (real ids, plausible streams) so the report/compare are testable before the runner lands; `heroBias` is the positive control | B5 |

Tools side (`packages/tools/src/balance`): `store.ts` (job dirs under `out/<jobId>/`, atomic + checksummed + resumable),
`aggregate.ts` (coverage ledger → Heroes / Runes / Minions / Spells / pacing, lobby-level bootstrap), `report.ts`
(markdown / JSON), `compare.ts` (baseline → candidate with the identity gate, paired-by-seed diffs, the seven questions),
`cli.ts` (`balance:report`, `balance:compare`, `balance:synth`; `balance:run` is a stub until B1 integrates).

`@game/sim/balance/*` is a package subpath export so tools can import the contract without going through the sim index.
