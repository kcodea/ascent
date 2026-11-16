# Strength v2, Plan 1 of 3: Measurement Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `npm run strength` a v2 mode that builds a candidate v2 reference, measures the live pool under the v2 rules (carry-forward, live-window population, peak), and checks strength against real fight results, with no change to the game.

**Architecture:** The v2 rules that the game will later share (7-round floor, fielded rounds, early/late windows, peak) go in one new pure module in `packages/sim`. Tool-only logic (reference picking, drift, calibration) goes in small `*.lib.ts` files beside the CLI, each with a vitest file. `cli.ts` only wires them to the cached pool and prints.

**Tech Stack:** TypeScript, tsx, vitest, the existing `@game/sim` strength API (`createStrengthProbe`, `percentileOf`, `meanFromSum`, `rankAmongRuns`, `runWeightedAverageOf`, `runPercentileOf`).

**Spec:** `docs/superpowers/specs/2026-11-16-strength-v2-design.md` (sections 6.A, 6.B, 6.B2, 6.C, 6.E, 7 step 1).

**The three plans:** this one (tooling, no behaviour change); Plan 2 (v2 scoring, carry-forward, 7-round floor, unscored rule, "Calculating Score" lock; client + SQL + Worker); Plan 3 (peak cap). Plans 2 and 3 are written after this one's output is in front of Mike, because the peak numbers and the final reference come from it.

## Global Constraints

- No game behaviour changes: nothing in `packages/ui`, `apps/web`, `workers/`, `supabase/` is touched; `loadStrengthReference`, `STRENGTH_REF_VERSION`, `STRENGTH_BANDS`, `MIN_RUN_WAVES` and seat selection are untouched.
- The tools never write to the backend: anon/session REST GETs only (`getAll` in `livePool.ts`).
- The candidate v2 reference is written to `packages/tools/.cache/strengthReference.v2.candidate.json` (gitignored) and is NOT committed and NOT imported by any package. Plan 2 generates and commits the final one.
- Reference v2: version string `set2-v2`, 40 boards per round (28 evenly spaced by rank + 12 evenly spaced in the top 20%), `fightsPerRef: 4`, at most 10 of a round's 40 from one player, a round gets its own reference round only with at least 40 real boards.
- Population: LIVE runs only (`pool_runs.live`, set `set2`), each run once per round: its real board, or its final board carried, an empty board counting as raw 0.
- A run whose recording ends on round 6 or earlier is excluded everywhere. Round 7 is in.
- EARLY = rounds 1-9, LATE = rounds 10-15, both over real and carried rounds. Game strength = `runWeightedAverageOf` over REAL rounds only. Peak = highest percentile among REAL rounds 3 and later.
- Drift alarm: flag `RE-BASELINE` when a round's median raw is above 0.60 or its 90th percentile above 0.92.
- `Math.random` is banned (ESLint). All fights are seeded as today.
- Run `npm install` inside this worktree before trusting any local check (CLAUDE.md, worktree note).
- Before claiming done: `npm run typecheck && npm run lint && npm test && npm run build:web`, all green.
- New code in `packages/sim` is Kevin's side: tell him before the PR opens.

## Review Focus

1. A round with fewer than 40 real boards (rounds 17, 18 today): it must merge into the last reference round, not produce a short reference. Pinned in Task 3.
2. A run whose final board is empty: every carried round is raw 0, no fights, no crash. Pinned in Task 5.
3. `lobby_fights` rows naming a generated seat (`bot:...`) or a run outside the live window: skipped and counted, never a crash or a NaN. Pinned in Task 6.
4. Every board in a round sharing one raw score (round 1 has few distinct values): percentiles stay whole numbers 1..100. Pinned in Task 5.
5. No cached pool on disk, or a cache fetched before `live` existed: a clear "run `npm run strength -- fetch` first" error, not an empty report. Pinned in Task 1.

---

### Task 1: The tools read the live window

**Files:**
- Modify: `packages/tools/src/strength/livePool.ts`
- Test: `packages/tools/src/strength/livePool.test.ts` (create)

**Interfaces:**
- Produces: `LiveRun.live: boolean`; `liveRunsOf(pool: LivePool, setId: string): LiveRun[]` (eligible, live, that set, in pool order); `LIVE_CACHE_ERROR: string`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { liveRunsOf, LIVE_CACHE_ERROR, type LivePool, type LiveRun } from './livePool';

const run = (key: string, over: Partial<LiveRun> = {}): LiveRun =>
  ({ key, author: key, userId: null, setId: 'set2', patchPrefix: '', eligible: true, live: true, boards: [], ...over });

describe('liveRunsOf', () => {
  it('keeps eligible live runs of the set, in order', () => {
    const pool: LivePool = { fetchedAt: '', runs: [run('a'), run('b', { live: false }), run('c', { eligible: false }), run('d', { setId: 'set1' }), run('e')] };
    expect(liveRunsOf(pool, 'set2').map((r) => r.key)).toEqual(['a', 'e']);
  });
  it('refuses a cache fetched before the live flag existed', () => {
    const old = { fetchedAt: '', runs: [{ ...run('a'), live: undefined }] } as unknown as LivePool;
    expect(() => liveRunsOf(old, 'set2')).toThrow(LIVE_CACHE_ERROR);
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run packages/tools/src/strength/livePool.test.ts`. Expected: FAIL, `liveRunsOf` is not exported.

- [ ] **Step 3: Implement.** Add `live` to `PoolRunRow` and the `pool_runs` select list (`...,eligible,live`), set it on each `LiveRun`. Add `export const LIVE_CACHE_ERROR = 'the cached pool has no live flag: run `npm run strength -- fetch` first'` and `liveRunsOf`, which throws `LIVE_CACHE_ERROR` when any run's `live` is not a boolean.

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Commit** — `git add packages/tools/src/strength && git commit -m "feat(tools): strength tools read the live pool window"`

---

### Task 2: The v2 rules, as pure functions in sim

**Files:**
- Create: `packages/sim/src/lobby/strengthV2.ts`
- Modify: `packages/sim/src/lobby/index.ts` (add `export * from './strengthV2';`)
- Test: `packages/sim/src/lobby/strengthV2.test.ts`

**Interfaces:**
- Consumes: `meanFromSum(sum: number, n: number): number | null` from `./boardStrength`.
- Produces:
  - `MIN_RUN_LAST_ROUND = 7`, `LATE_LAST_ROUND = 15`, `PEAK_FROM_ROUND = 3`
  - `runLongEnough(lastRound: number): boolean`
  - `interface FieldedRound { round: number; from: number; carried: boolean }`
  - `fieldedRoundsOf(realRounds: readonly number[], lastRefRound: number): FieldedRound[]`
  - `earlyLateV2Of(rounds: Iterable<{ round: number; value: number | null | undefined }>): { early: number | null; late: number | null }`
  - `runPeakOf(realRounds: Iterable<{ round: number; value: number | null | undefined }>): number | null`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { runLongEnough, fieldedRoundsOf, earlyLateV2Of, runPeakOf } from './strengthV2';

describe('strength v2 rules', () => {
  it('a run must reach round 7', () => {
    expect(runLongEnough(6)).toBe(false);
    expect(runLongEnough(7)).toBe(true);
  });
  it('carries the final board to every later reference round', () => {
    const f = fieldedRoundsOf([1, 2, 3, 7, 8], 16);
    expect(f.filter((x) => !x.carried).map((x) => x.round)).toEqual([1, 2, 3, 7, 8]);
    expect(f.filter((x) => x.carried).map((x) => x.round)).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(f.filter((x) => x.carried).every((x) => x.from === 8)).toBe(true);
    expect(f.find((x) => x.round === 7)).toEqual({ round: 7, from: 7, carried: false });
  });
  it('carries nothing for a run that outlasts the reference, and ignores duplicate rounds', () => {
    expect(fieldedRoundsOf([15, 16, 17, 17], 16).map((x) => x.round)).toEqual([15, 16, 17]);
    expect(fieldedRoundsOf([], 16)).toEqual([]);
  });
  it('EARLY is rounds 1-9, LATE is rounds 10-15, later rounds count for neither', () => {
    const rounds = [...Array(9)].map((_, i) => ({ round: i + 1, value: 20 }))
      .concat([10, 11, 12, 13, 14, 15].map((r) => ({ round: r, value: 60 })), [{ round: 16, value: 100 }]);
    expect(earlyLateV2Of(rounds)).toEqual({ early: 20, late: 60 });
    expect(earlyLateV2Of([{ round: 3, value: 40 }])).toEqual({ early: 40, late: null });
  });
  it('peak is the best real board from round 3 on', () => {
    expect(runPeakOf([{ round: 1, value: 95 }, { round: 2, value: 90 }, { round: 3, value: 40 }, { round: 8, value: 70 }])).toBe(70);
    expect(runPeakOf([{ round: 1, value: 95 }, { round: 2, value: null }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run packages/sim/src/lobby/strengthV2.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement the six exports.** `fieldedRoundsOf` returns the distinct real rounds ascending (`from === round`), then `lastReal + 1 .. lastRefRound` with `from: lastReal, carried: true`. `earlyLateV2Of` rounds each value like `earlyLateStrengthOf` does and uses `meanFromSum`. Header comment cites the spec and Mike's 2026-11-16 rulings; state that nothing in the game calls this module yet.

- [ ] **Step 4: Run it.** Expected: PASS. Then `npm run typecheck:pkgs`. Expected: clean.

- [ ] **Step 5: Commit** — `git commit -m "feat(sim): strength v2 rules as pure functions (not yet used by the game)"`

---

### Task 3: Picking the v2 reference boards

**Files:**
- Create: `packages/tools/src/strength/refPick.lib.ts`
- Test: `packages/tools/src/strength/refPick.lib.test.ts`

**Interfaces:**
- Produces:
  - `interface RefPickOptions { total: number; even: number; top: number; topShare: number; maxPerOwner: number }`
  - `REF_PICK_V2: RefPickOptions = { total: 40, even: 28, top: 12, topShare: 0.2, maxPerOwner: 10 }`
  - `pickReferenceIndices(owners: readonly (string | null)[], opts?: RefPickOptions): number[]` — `owners[i]` is the owner of the i-th board, weakest to strongest; returns distinct indices ascending.
  - `referenceBuckets(boardsPerRound: ReadonlyMap<number, number>, minBoards?: number): number[]` — the rounds that start a reference round (default `minBoards` 40).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { pickReferenceIndices, referenceBuckets } from './refPick.lib';

const count = (xs: (string | null)[], picks: number[], who: string): number => picks.filter((i) => xs[i] === who).length;

describe('pickReferenceIndices', () => {
  it('picks 40 across the whole range with extra weight in the top 20%', () => {
    const owners = [...Array(200)].map((_, i) => `p${i}`);
    const picks = pickReferenceIndices(owners);
    expect(picks).toHaveLength(40);
    expect(new Set(picks).size).toBe(40);
    expect(picks[0]).toBe(0);
    expect(picks[39]).toBe(199);
    expect(picks.filter((i) => i >= 160).length).toBeGreaterThanOrEqual(17);
  });
  it('never takes more than 10 from one player', () => {
    const owners = [...Array(200)].map((_, i) => ['a', 'b', 'c', 'd'][i % 4]!);
    const picks = pickReferenceIndices(owners);
    expect(picks).toHaveLength(40);
    for (const who of ['a', 'b', 'c', 'd']) expect(count(owners, picks, who)).toBe(10);
  });
  it('does not cap boards with no owner, and returns everything when there are 40 or fewer', () => {
    expect(pickReferenceIndices([...Array(100)].map(() => null))).toHaveLength(40);
    expect(pickReferenceIndices([...Array(12)].map(() => 'a'))).toEqual([...Array(12)].map((_, i) => i));
  });
});

describe('referenceBuckets', () => {
  it('a round needs 40 real boards to stand alone; thin rounds merge into the last one', () => {
    const live = new Map([...[...Array(15)].map((_, i) => [i + 1, 200] as const), [16, 50], [17, 12], [18, 4]]);
    expect(referenceBuckets(live)).toEqual([...Array(16)].map((_, i) => i + 1));
    expect(referenceBuckets(new Map([[1, 200], [2, 39], [3, 200]]))).toEqual([1, 3]);
    expect(referenceBuckets(new Map([[1, 200], [2, 39], [3, 12]]))).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run it.** Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** The picking algorithm, which the signature does not determine:

```ts
// n = owners.length. If n <= opts.total: every index.
// Targets, in this order:
//   even: round(i * (n - 1) / (even - 1)) for i in 0..even-1
//   top:  start = floor(n * (1 - topShare)); round(start + (j + 0.5) * (n - start) / top) for j in 0..top-1, clamped to n - 1
// For each target, take the nearest index not yet taken whose owner has fewer than maxPerOwner picks
// (a null owner is never capped); on a distance tie take the lower index. Search distance 0, 1, 2, ...
// If no index qualifies (every remaining owner is at the cap), take the nearest untaken index regardless.
// Return the picks sorted ascending.
```

`referenceBuckets` walks the rounds ascending and mirrors the merge rule already in `buildReference` (`cli.ts`): a round merges into the previous bucket when it, or that bucket so far, has fewer than `minBoards`.

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(tools): v2 reference picking (40 per round, top-weighted, 10 per player)"`

---

### Task 4: `npm run strength -- ref --v2` writes the candidate reference

**Files:**
- Modify: `packages/tools/src/strength/cli.ts`

**Interfaces:**
- Consumes: `liveRunsOf` (Task 1), `runLongEnough` (Task 2), `pickReferenceIndices`, `referenceBuckets`, `REF_PICK_V2` (Task 3).
- Produces: `REF_V2_CANDIDATE = 'packages/tools/.cache/strengthReference.v2.candidate.json'`; `loadCandidateReference(): StrengthReference` (throws `'no candidate v2 reference: run `npm run strength -- ref --v2` first'` when the file is missing).

- [ ] **Step 1: Implement `buildReferenceV2()`** beside `buildReference` (leave v1 untouched). Differences from v1, all from the Global Constraints: source runs are `liveRunsOf(pool, SET)` whose last round passes `runLongEnough`; buckets from `referenceBuckets` over real boards with minions; inside a bucket, the round robin and weakest-to-strongest order are v1's; picks from `pickReferenceIndices(order.map(owner))` where owner is `userId` when present, else the lowercased author, else null; output `{ version: 'set2-v2', setId: SET, fightsPerRef: 4, waves }` to `REF_V2_CANDIDATE`. Print per round: boards, picks, picks per player.

- [ ] **Step 2: Wire the flag.** `ref` with `--v2` in `process.argv` calls `buildReferenceV2`; without it, v1 as today. Update the usage line and the file header comment.

- [ ] **Step 3: Verify.** Run `npm run strength -- fetch` then `npm run strength -- ref --v2`. Expected: 16 lines `wave N: … 40 refs`, no player above 10 in any line, and `git status` shows no new tracked file (the `.cache` directory is gitignored).

- [ ] **Step 4: Verify v1 is untouched.** `git diff --stat packages/sim/src/lobby/strengthReference.v1.json` prints nothing.

- [ ] **Step 5: Commit** — `git commit -m "feat(tools): strength ref --v2 builds a candidate v2 reference from the live window"`

---

### Task 5: `npm run strength -- measure --v2`

**Files:**
- Create: `packages/tools/src/strength/measureV2.lib.ts`
- Test: `packages/tools/src/strength/measureV2.lib.test.ts`
- Modify: `packages/tools/src/strength/cli.ts`

**Interfaces:**
- Consumes: `fieldedRoundsOf`, `earlyLateV2Of`, `runPeakOf`, `LATE_LAST_ROUND` (Task 2); `percentileOf`, `runWeightedAverageOf`, `rankAmongRuns`, `runInStrengthBand`, `bandSteps`, `STRENGTH_BANDS`, `MAX_SEATS_PER_PLAYER` from `@game/sim`; `loadCandidateReference` (Task 4).
- Produces:
  - `interface RawRound { runKey: string; round: number; raw: number; carried: boolean }`
  - `interface RunV2 { key: string; owner: string | null; rounds: { round: number; value: number; carried: boolean }[]; early: number | null; late: number | null; strength: number | null; peak: number | null }`
  - `rateRunsV2(raws: readonly RawRound[], owners: ReadonlyMap<string, string | null>): RunV2[]`
  - `driftOf(raws: readonly number[]): { median: number; p90: number; rebaseline: boolean }`
  - `peakCapRows(runs: readonly RunV2[], band: StrengthBand | null, caps: readonly number[]): { cap: number; runs: number; removed: number; seats: number }[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { STRENGTH_BANDS } from '@game/sim';
import { rateRunsV2, driftOf, peakCapRows, type RawRound } from './measureV2.lib';

const rounds = (runKey: string, raws: number[], lastReal: number): RawRound[] =>
  raws.map((raw, i) => ({ runKey, round: i + 1, raw, carried: i + 1 > lastReal }));

describe('rateRunsV2', () => {
  const raws = [...rounds('weak', Array(15).fill(0.1), 15), ...rounds('mid', Array(15).fill(0.5), 15), ...rounds('strong', Array(15).fill(0.9), 15)];
  const owners = new Map<string, string | null>([['weak', 'a'], ['mid', 'b'], ['strong', 'c']]);
  const by = new Map(rateRunsV2(raws, owners).map((r) => [r.key, r]));

  it('ranks each round among the runs, ties half, whole numbers 1..100', () => {
    expect(by.get('weak')!.rounds[0]!.value).toBe(17);
    expect(by.get('mid')!.rounds[0]!.value).toBe(50);
    expect(by.get('strong')!.rounds[0]!.value).toBe(83);
  });
  it('gives every run a LATE rating and orders the runs', () => {
    expect(by.get('weak')!.late).toBeLessThan(by.get('mid')!.late!);
    expect(by.get('mid')!.early).toBeLessThan(by.get('strong')!.early!);
  });
  it('a round where every board ties stays inside 1..100', () => {
    const tied = [...rounds('x', Array(15).fill(0.5), 15), ...rounds('y', Array(15).fill(0.5), 15)];
    for (const r of rateRunsV2(tied, new Map())) for (const x of r.rounds) expect(x.value).toBe(50);
  });
  it('carried rounds count for LATE but never for the peak or the Game strength', () => {
    const short = [...rounds('short', [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, ...Array(8).fill(0)], 7), ...rounds('long', Array(15).fill(0.5), 15)];
    const s = rateRunsV2(short, new Map()).find((r) => r.key === 'short')!;
    expect(s.rounds.filter((x) => x.carried)).toHaveLength(8);
    expect(s.peak).toBe(75);          // its real rounds beat 'long'
    expect(s.late).toBeLessThan(50);  // its carried rounds lose to 'long'
  });
});

describe('driftOf', () => {
  it('flags a round the pool has outgrown', () => {
    expect(driftOf([0.2, 0.5, 0.55, 0.6, 0.7]).rebaseline).toBe(false);
    expect(driftOf([0.5, 0.6, 0.65, 0.7, 0.8]).rebaseline).toBe(true);        // median above 0.60
    expect(driftOf([0.1, 0.2, 0.3, 0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.95]).rebaseline).toBe(true); // p90 above 0.92
  });
});

describe('peakCapRows', () => {
  it('counts what each cap removes from a band and the seats left under the 4-per-player cap', () => {
    const run = (key: string, peak: number, owner: string) => ({ key, owner, rounds: [], early: 10, late: 10, strength: 10, peak });
    const runs = [run('a', 50, 'p1'), run('b', 85, 'p1'), run('c', 95, 'p2')];
    const rows = peakCapRows(runs, STRENGTH_BANDS.Bronze, [80, 90]);
    expect(rows).toEqual([{ cap: 80, runs: 1, removed: 2, seats: 1 }, { cap: 90, runs: 2, removed: 1, seats: 2 }]);
  });
});
```

- [ ] **Step 2: Run it.** Expected: FAIL, module not found.

- [ ] **Step 3: Implement the lib.** `rateRunsV2`: per round, percentile of each raw among that round's raws with `percentileOf(raw, others, true)` (others = the round's histogram minus the board itself, as `measure` does today); per run `earlyLateV2Of` over all rounds, `runPeakOf` and `runWeightedAverageOf` over non-carried rounds; then `rankAmongRuns` for early, late and strength across the runs. `driftOf`: `median` = element at `floor(n / 2)` of the sorted raws, `p90` at `floor(0.9 * n)`, `rebaseline` = `median > 0.60 || p90 > 0.92`. `peakCapRows`: in-band runs via `runInStrengthBand({ strength, early, late }, band)`, a run with `peak` above the cap removed (exactly the cap stays), `seats` = sum over owners of `min(MAX_SEATS_PER_PLAYER, runs)`, a null owner counting alone.

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Add the empty-final-board test, then wire the CLI.** Add to the lib test file a test of the CLI's scoring helper, exported from `measureV2.lib.ts` as `rawRoundsOfRun(run: { key: string; boards: { wave: number; minions: number }[] }, lastRefRound: number, score: (boardWave: number, atRound: number) => number): RawRound[]`:

```ts
it('an empty board is raw 0 and costs no fights, real or carried', () => {
  const calls: number[] = [];
  const out = rawRoundsOfRun({ key: 'r', boards: [{ wave: 7, minions: 3 }, { wave: 8, minions: 0 }] }, 10, (w, at) => { calls.push(at); return 0.4; });
  expect(out.map((x) => [x.round, x.raw, x.carried])).toEqual([[7, 0.4, false], [8, 0, false], [9, 0, true], [10, 0, true]]);
  expect(calls).toEqual([7]);
});
```

Implement it with `fieldedRoundsOf`. Then in `cli.ts` add `measureV2()`: live runs passing `runLongEnough`; `score` = `createStrengthProbe({ ...snapshot, wave: atRound }, ref)` run to completion against the candidate reference, cached in `packages/tools/.cache/strength-scores-v2.json` keyed by `runKey|boardWave|atRound`; then `rateRunsV2`. Print, in this order: runs measured and runs dropped by the 7-round floor; per round `driftOf` with ` RE-BASELINE` appended when flagged; the EARLY vs LATE correlation; per medal the in-band run count, players and seats (as the v1 report does); per medal a peak table from `peakCapRows(..., [60, 70, 80, 90, 95])`; per medal and round the median, 90th percentile and maximum REAL board percentile of in-band runs. `measure --v2` calls it; plain `measure` is unchanged.

- [ ] **Step 6: Verify.** `npx vitest run packages/tools/src/strength` passes. `npm run strength -- measure --v2` prints all six sections with no `NaN` and no `undefined` (`... | grep -c "NaN\|undefined"` prints `0`). Expect several minutes on the first run and seconds on the second (cache).

- [ ] **Step 7: Commit** — `git commit -m "feat(tools): strength measure --v2 (carry-forward ranking, drift alarm, peak table)"`

---

### Task 6: `npm run strength -- validate`

**Files:**
- Create: `packages/tools/src/strength/validate.lib.ts`
- Test: `packages/tools/src/strength/validate.lib.test.ts`
- Modify: `packages/tools/src/strength/cli.ts`

**Interfaces:**
- Consumes: `getAll` (`livePool.ts`), `RunV2`, `rateRunsV2` output (Task 5).
- Produces:
  - `interface FightRow { round: number; run_a: string; run_b: string; outcome: 'a' | 'b' | 'draw' }`
  - `interface RatedFight { round: number; a: string; b: string; pa: number; pb: number; outcome: 'a' | 'b' | 'draw' }`
  - `rateFights(fights: readonly FightRow[], percentileAt: (runKey: string, round: number) => number | null): { rated: RatedFight[]; skipped: { generated: number; unknown: number } }`
  - `gapCalibration(fights: readonly RatedFight[]): { bucket: string; fights: number; strongerWinRate: number }[]`
  - `runRecords(fights: readonly RatedFight[]): Map<string, { early: { fights: number; points: number }; late: { fights: number; points: number } }>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { rateFights, gapCalibration, runRecords } from './validate.lib';

describe('validate', () => {
  const pct = (k: string): number | null => ({ s: 90, w: 10, m: 50 } as Record<string, number>)[k] ?? null;
  it('skips generated seats and unknown runs, and counts them', () => {
    const { rated, skipped } = rateFights([
      { round: 5, run_a: 's', run_b: 'w', outcome: 'a' },
      { round: 5, run_a: 'bot:hybrid:nadja', run_b: 'w', outcome: 'a' },
      { round: 5, run_a: 's', run_b: 'gone', outcome: 'b' },
    ], pct);
    expect(rated).toHaveLength(1);
    expect(skipped).toEqual({ generated: 1, unknown: 1 });
  });
  it('reports how often the stronger board really wins, by percentile gap; a draw is half; equal boards are left out', () => {
    const f = (a: string, b: string, outcome: 'a' | 'b' | 'draw') => ({ round: 5, a, b, pa: pct(a)!, pb: pct(b)!, outcome });
    const rows = gapCalibration([f('s', 'w', 'a'), f('w', 's', 'a'), f('s', 'w', 'draw'), f('m', 'm', 'a'), f('s', 'm', 'a')]);
    expect(rows.find((r) => r.bucket === '80-90')).toEqual({ bucket: '80-90', fights: 3, strongerWinRate: 0.5 });
    expect(rows.find((r) => r.bucket === '40-50')).toEqual({ bucket: '40-50', fights: 1, strongerWinRate: 1 });
    expect(rows.reduce((a, r) => a + r.fights, 0)).toBe(4);
  });
  it('splits a run record into rounds 1-9 and 10-15', () => {
    const rec = runRecords([
      { round: 9, a: 's', b: 'w', pa: 90, pb: 10, outcome: 'a' },
      { round: 10, a: 's', b: 'w', pa: 90, pb: 10, outcome: 'draw' },
      { round: 16, a: 's', b: 'w', pa: 90, pb: 10, outcome: 'a' },
    ]);
    expect(rec.get('s')).toEqual({ early: { fights: 1, points: 1 }, late: { fights: 1, points: 0.5 } });
    expect(rec.get('w')).toEqual({ early: { fights: 1, points: 0 }, late: { fights: 1, points: 0.5 } });
  });
});
```

- [ ] **Step 2: Run it.** Expected: FAIL, module not found.

- [ ] **Step 3: Implement the lib.** A key starting `bot:` is generated. Buckets are `'0-10'` … `'90-100'` by `floor(gap / 10)` with a gap of 100 in `'90-100'`, a gap of 0 left out, rows returned ascending and only for buckets with fights.

- [ ] **Step 4: Run it.** Expected: PASS.

- [ ] **Step 5: Wire the CLI.** `validate` reads `lobby_fights?select=round,run_a,run_b,outcome&order=id.asc` with `getAll`, builds `percentileAt` from the Task 5 ratings (a round past a run's fielded rounds returns null), and prints: fights read, rated, skipped by kind; the calibration table; the correlation between EARLY rating and early win rate, and LATE rating and late win rate, over runs with at least 20 fights in that half; the 20 runs with at least 20 fights whose win rate differs most from their rating. Update the usage line and header comment.

- [ ] **Step 6: Verify.** `npm run strength -- validate` prints the four sections with no `NaN`.

- [ ] **Step 7: Commit** — `git commit -m "feat(tools): strength validate checks ratings against real lobby fights"`

---

### Task 7: Gates, devlog, and the numbers for Mike

**Files:**
- Create: `docs/devlog/2026-11-16-strength-v2-tooling.md`
- Modify: `docs/board-pool.md` (the strength-tool section: the three new commands)

- [ ] **Step 1: Run the gates.** `npm run typecheck && npm run lint && npm test && npm run build:web`. Expected: all green. Report the result as printed.

- [ ] **Step 2: Capture the reports.** Save the output of `measure --v2` and `validate` into the devlog entry, with the date of the pool fetch and the count of live runs.

- [ ] **Step 3: Write the devlog entry** per `docs/devlog/README.md`: what the three commands do, that the candidate reference is not committed and nothing in the game changed, and the open decisions for Mike (the three peak caps, read from the peak table).

- [ ] **Step 4: Commit and open the PR** — `git commit -m "docs: strength v2 tooling devlog and tool notes"`, push the branch, `gh pr create`, arm `gh pr merge --auto --squash`, and tell Kevin the PR adds `packages/sim/src/lobby/strengthV2.ts`.

- [ ] **Step 5: Hand Mike the peak table** (per medal: runs left, runs removed, seats left for caps 60, 70, 80, 90, 95) and the calibration table, in plain language, and ask for the three caps. Plans 2 and 3 are written from his answer.
