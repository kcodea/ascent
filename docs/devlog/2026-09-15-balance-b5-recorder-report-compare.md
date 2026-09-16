# 2026-09-15 — balance bot B5: recorder, effect attribution, aggregate + report + compare

Work package B5 (+ the report half of B6) of `docs/balance-bot-roadmap.md`, built against the shared contract in
`packages/sim/src/balance/types.ts` on `feat/balance-bot-base`. Everything works from `LobbyRecord[]` ONLY — the
authoritative runner (B1) is not on this branch, so a deterministic synthetic fixture stands in for it.

## What shipped

**sim** (`packages/sim/src/balance/`)
- `recorder.ts` — `createRecorder(lobbyId, seed, manifest, identity)`: the `BalanceRecorder` plus
  `observeTransition(before, after, action, seat, round, index)` (records the accepted action with pre/post
  `stateHash`, Gold, and the surface's visible offers — tavern+spell slot / Runeforge / quest shop / Discover — and
  derives the transition's effect events, keeping a per-seat uid → route lineage), `fail()`, `setRoundsPlayed()`,
  `finalize()` (canonical ordering: two recorders fed the same events in any interleaving produce byte-identical
  records).
- `effectsFromTransition.ts` — `effectEventsOf`: reads `recruitBuffFx`, `shopEaten`, `fodderEaten`, `starformFx`,
  `equipFx` (`use`), the `spellsThisTurn` delta + `lastSpellCastId`, the `ownedRunes` delta, hand/board uid diffs
  (`cardGained` / `cardPlayed` / `summon`), the `triplesMade` delta (+ a new golden uid), the `sell` action and the
  `heroPower` action. Route inference: buy → shop, discover → discover, buyRune → rune, buyQuest → quest, heroPower →
  hero, activateEquipment → equipment, a hand card that appeared under any other action → generated.
- `fixtures/syntheticLobby.ts` — eight seats, real hero/card/rune ids for the manifest's set, an offer → buy → play →
  sell → cast stream with matching effects, pairing/byes/damage/armor/elimination, placement. `heroBias` (+ = weaker)
  is the compare's positive control; `failRate` feeds the coverage ledger.
- `types.ts`: ADDED `EffectEvent.detail?: string` (additive). `package.json`: `./balance/*` subpath export.

**tools** (`packages/tools/src/balance/`)
- `store.ts` — `out/<jobId>/{manifest,identity}.json`, `lobbies/<seed>.json` (envelope with an FNV checksum, written
  atomically), `summary.json`. `completedSeeds()` only counts a file whose checksum AND identity AND manifest match.
- `aggregate.ts` — coverage first (planned/started/complete/failed/censored/capped lobbies; placed/capped/failed runs;
  failure rate by hero and policy; refused modes; mixed identities), then Heroes / Runes / Minions / Spells / pacing.
  Every interval is a LOBBY-level bootstrap (seeded, 1000 reps); rows under `minSupport` (20) are labelled
  `suppressed`; sparse placement means are also shrunk toward the population mean (k = 10). "Likely problems" =
  entities whose CI excludes the population mean, ranked by effect size, all evidence level 1.
- `report.ts` — markdown (header with manifest + identity digests → coverage → problems → four tables → pacing; every
  number carries its count) or JSON.
- `compare.ts` — `compareJobs(baseline, candidate, { allowDiff, target })`: refuses undeclared identity differences;
  pairs by seed, unpaired otherwise; candidate − baseline effects with CIs for hero placement / top-half, rune pick
  rate + lift, minion buy / final-board / placement-held, spell buy / cast-per-buy / held-unused, acquisition
  consistency (holder rate, acquisition-round mean + sd), hero × rune top-half combos, pacing series, early-card
  retention, unsupported lists. `isZeroEffect` + `selfCompare` are the A/A check. Markdown answers the roadmap's
  seven questions in order.
- `cli.ts` — `npm run balance:report -- --job <id>`, `balance:compare -- --baseline <id> --candidate <id>
  [--allow-diff …] [--target hero:midas]`, `balance:synth -- --set set3 --seeds 40 [--heroes …] [--nerf midas=1.5]`.
  `balance:run` throws "runner not integrated" until B1 lands.

## Measured

- A/A (`compareJobs(x, x)`): zero effect, zero-width intervals, everywhere (test + CLI).
- Positive control (synthetic, 8-hero roster, 40 paired seeds, Midas +1.5 weakness): Midas 4.10 → 7.25,
  +3.15 [2.53, 3.77]; the other seven move less than the target (self-play placement is zero-sum).
- CI widths shrink from 10 → 60 lobbies for every hero; suppression and censoring verified.

## Not done / for the integrator

- `balance:run` wiring once `selfPlayLobby` exists: read the manifest, build the identity (B0), `createJob`, skip
  `completedSeeds`, one `createRecorder` per lobby, `observeTransition` per accepted action, `onRound` / `onRun`,
  `writeLobby(finalize())`.
- Hero "eligible" uses the manifest roster or the production `playableHeroes` rule on the seat's tribes — B0's census
  may want to replace it with the exact per-run eligibility.
- Level-2 (controlled decision branches) is out of scope here.
