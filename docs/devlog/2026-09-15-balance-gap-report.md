# 2026-09-15 — `balance:gap` + the pinned "bought 0" fix (B8 instrumentation)

## The pinned report's `bought 0` (fixed)

Every real `pinnedLobby` job's minion / spell table printed `bought 0` while the self-play mode attributed buys
correctly. Root cause: `pinnedLobby.ts` called `playRecruitTurn` WITHOUT the per-seat `lineage` map, so the runner
fell through to its legacy lean effect diff (`effectsOf`, `cardGained` keyed by `targetId`), while the aggregate's
funnel reads the recorder's attributer (`sourceId` + `route: 'shop'`, `effectsFromTransition.ts`). The self-play
runner had been fixed for exactly this on the integration branch (it passes `seat.lineage`); the pinned runner
never was.

Fix: the pinned lobby keeps ONE `CardLineage` per pilot run and passes it every turn (so a played / sold / cast card
also says how it came to be), and the lean fallback is RETIRED — `playRecruitTurn` now always attributes through
`effectsFromTransition.ts` (a caller that omits `lineage` gets a per-turn throwaway map), so no runner can silently
regress to the wrong shape again. `packages/sim/src/balance/seatRunner.ts` lost ~40 lines.

Tests: `pinnedLobby.test.ts` asserts every accepted `buy` is one `cardGained` with `sourceId` + `route: 'shop'`,
bought cards later played keep `route: 'shop'`, and no card event is `sourceId`-less; the new
`tools/balance/pinnedFunnel.test.ts` runs three pinned fixture lobbies through `aggregate` and asserts
Σ `bought` over the minion + spell rows equals the pilot's accepted buys. The fixture corpus moved to
`sim/balance/fixtures/pinnedCorpus.ts` so both packages share it (exported through `tools/balance/deps.ts`).

## `balance:gap` — the pilot ↔ players measuring stick

```
npm run balance:gap -- --job <job> [--corpus set2-players-v1] [--out gap.md] [--format json]
```

`packages/tools/src/balance/gap.ts`. For the job's PILOT seats against the named recorded corpus (default: the one
the job's manifest names) it prints, per wave 1..16: n, board stat total (Σ attack + health) median and p80, minion
count, golden count, mean tier, largest-tribe share (neutral excluded) — pilot / corpus side by side; a per-wave
growth multiplier (median stat total at W ÷ W−1) per side; the top-25 card frequencies at wave ≥ 10 (share of boards
holding the card) side by side; and the pilot's placement histogram, mean with a lobby-level bootstrap 95% CI,
firsts, top-3, and the pass line (owner 2026-09-15: < 4.0 pass, < 3.0 strong, < 2.0 phenomenal). Markdown or
`--format json`.

`RoundRecord` already carried what it needs (`snapshot` = the pilot's served board at the end of its recruit turn,
`tier`); no record fields were added. An empty pilot board carries no snapshot and counts as a 0-stat board. Corpus
boards group into runs by `author | hero | seed` (the `playerRunsFrom` key); a duplicate upload of one wave keeps
the last. Tested on the hermetic pinned fixture (`gap.test.ts`).

Measured on `set2-pinned-gen-dev100` (generalist, dev budget, 100 pinned set-2 lobbies): mean placement **6.76
[6.50, 7.00]** → FAIL; 0 firsts, 2 top-3. The board-shape table says where the gap opens: the pilot's median stat
total tracks the corpus through wave 5 (37 vs 31) with MORE bodies (6.2 vs 4.3) at a LOWER tier (2.0 vs 3.1), then
the corpus compounds ×1.6–1.9 per wave from wave 6 (53 → 88 → 139 → 248 → 432 → 821 → 1,109) while the pilot grows
×1.1–1.3 (48 → 54 → 61 → 69 → 84 → 97 → 80). At wave ≥ 10 the pilot's boards are tier-1/2 bodies (Void Panther 64%,
Oathshield Orin 60%, Packstrider 35%) that the players hold on 0–8% of theirs; the players' boards are engines the
pilot never fields (Drakko 25% vs 0%, Echohorn 21% vs 4%, Broad-Axe Brakka 19% vs 1%).

Docs: `docs/balance-bot.md` (lever list + the pinned-lobby defect notes).
