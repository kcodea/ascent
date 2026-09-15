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
| `recorder.ts` | the `BalanceRecorder` that builds a `LobbyRecord` | B5 |
