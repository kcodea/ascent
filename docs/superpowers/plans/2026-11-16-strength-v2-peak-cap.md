# Strength v2 Peak Cap (Plan 3 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Bronze, Silver or Gold table never seats a recorded run whose best board (round 3 on) ranks above 90.

**Architecture:** A per-run `strength_peak` computed in the same SQL refresh as the other ratings, and an optional `peakCap` on a band that behaves exactly like `overallCap`: enforced in the server draw, mirrored in the hub Worker draw, and re-checked on the client at seat selection.

**Tech Stack:** TypeScript, Vitest, PGlite db tests, Supabase SQL, Cloudflare Worker.

**Spec:** `docs/superpowers/specs/2026-11-16-strength-v2-design.md` section 6.C and ruling 2 in section 9 (Mike 2026-11-16: "90 for all").

**Depends on:** Plan 2 (`docs/superpowers/plans/2026-11-16-strength-v2-scoring.md`) merged: this plan edits the functions that plan defines in `2026-11-23-strength-v2.sql`. Both can go out in one Ship Ascent.

## Global Constraints

- `peakCap: 90` on Bronze, Silver and Gold; none on Platinum, Diamond, Ascendant.
- Peak = the highest board percentile among a run's REAL rounds 3 and later (`runPeakOf`, `PEAK_FROM_ROUND = 3`). Carried rounds never count.
- Exactly the cap is inside. A null peak is unscored, and unscored runs are already outside every band (Plan 2).
- The cap is hard: `widenBand` keeps it, and a capped band's last step keeps it (`{ min: 0, max: 100, overallCap, peakCap }`), never null.
- Practice's Opponent Rank inherits it through `practiceStrengthBand`; no Practice-specific code.
- Never edit an existing migration: add `supabase/migrations/2026-11-24-strength-peak-cap.sql` and append it to `schema.sql`.

## Review Focus

- A session whose server does not know `p_peak_cap` yet: the request is retried without it and the cap still holds at seat selection, because every row carries its peak.
- A Gold table where the cap leaves too few runs: the band widens, the cap stays, and generated seats fill the rest (23 of 106 Gold runs are over 90 today).
- A run that ended on round 7 with one freak round-5 board at 95: outside Bronze even though its Game strength is 30.
- A saved lobby seated before this change keeps its seats.

---

### Task 1: SQL: the peak and the capped draw

**Files:**
- Create: `supabase/migrations/2026-11-24-strength-peak-cap.sql`
- Test: `packages/sim/src/lobby/strengthPeak.db.test.ts`

**Interfaces:**
- `alter table public.pool_runs add column if not exists strength_peak numeric`.
- `pool_strength_refresh` writes `strength_peak` = max board percentile over real rounds `>= 3`, null for an incomplete run.
- `pool_runs_sample`, `pool_runs__pick`, `pool_runs_sample_keys` gain a last parameter `p_peak_cap numeric default null` and the filter `(p_peak_cap is null or r.strength_peak <= p_peak_cap)`. `pool_runs_sample` and `pool_runs_sample_keys` return an extra column `strength_peak numeric`.
- `pool_mirror_index` returns `strength_peak text`; `pool_mirror_version` includes it in what it hashes; `ops.pool_digest` reports the count of live runs with a peak above 90 per medal band.

- [ ] **Step 1: Failing db tests**: for the 30-run fixture from `strengthV2.db.test.ts`, each run's `strength_peak` equals `rateRunsV2(...)[i].peak`; a run whose only board above 90 is on round 2 has a peak at or below 90; `pool_runs_sample_keys(p_strength_min => 0, p_strength_max => 100, p_peak_cap => 90)` returns no run with a peak above 90 and does return one at exactly 90; with `p_peak_cap` omitted the result equals the call without the parameter; the sample / `__pick` picking blocks are still text-identical.
- [ ] **Step 2: Run** `npx vitest run packages/sim/src/lobby/strengthPeak.db.test.ts`. Expected FAIL. **Step 3: Write the migration. Step 4:** PASS, plus `npx vitest run packages/sim/src/lobby`.
- [ ] **Step 5: Commit** `feat(db): per-run strength peak and a peak cap on the pool draw`.

### Task 2: The band, the fetch, the stamp

**Files:**
- Modify: `packages/sim/src/lobby/strengthBands.ts`, `packages/sim/src/snapshot.ts`, `packages/sim/src/lobby/snapshotSeats.ts` (`PlayerRun`, `playerRunsFrom`), `packages/ui/src/opponentPool/poolFetch.ts`, `packages/ui/src/opponentPool/poolLoader.ts`
- Test: `packages/sim/src/lobby/strengthBands.test.ts`, `packages/ui/src/opponentPool/poolFetch.test.ts`

**Interfaces:**
- `StrengthBand.peakCap?: number`; `RunStrengths.peak?: number | null`.
- `runUnderPeakCap(run: Pick<RunStrengths, 'peak'>, band: StrengthBand | null | undefined): boolean` : true with no cap; false when `peak` is null or above the cap.
- `runInStrengthBand` checks it after the overall cap. `widenBand` and `bandSteps` carry `peakCap` exactly as they carry `overallCap`. `sameBand` compares it.
- `bandVersionLabel` appends `/p90` after the overall cap part, so `STRENGTH_BANDS_VERSION` changes.
- `STRENGTH_BANDS`: Bronze, Silver and Gold each gain `peakCap: 90`.
- `BoardSnapshot.runStrengthPeak?: number`; `PoolRun.peak`; `poolLoader` stamps it beside `runStrengthEarly`; `playerRunsFrom` reads it into `PlayerRun.peak`.
- `poolFetch`: sends `p_peak_cap` when the band has one; `PoolFetchSession.peakCapsMissing?: boolean`, tried first in the missing-function fallback order (drop the peak cap, then the existing order); the widen check filters by `runUnderPeakCap` as well as `runUnderOverallCap`; `SampleRow.strength_peak` maps to `PoolRun.peak`.

- [ ] **Step 1: Failing tests**: peak 90 inside Bronze, 91 outside, null outside; every step of `bandSteps(STRENGTH_BANDS.Gold)` has `peakCap: 90`, including the last; `practiceStrengthBand('gold').peakCap === 90` and `practiceStrengthBand('all') === null`; `bandVersionLabel` of Bronze ends with `/p90`; a table built from 20 in-band runs of which 15 have a peak of 95 seats none of those 15; the fetch sends `p_peak_cap: 90` for Silver, retries without it on `PGRST202`, sets `peakCapsMissing`, and still drops over-cap rows from the widen count.
- [ ] **Step 2-4:** run (FAIL), implement, `npx vitest run packages/sim/src/lobby packages/sim/src/versus packages/ui/src/opponentPool` (PASS).
- [ ] **Step 5: Commit** `feat(sim,ui): peak cap of 90 on Bronze, Silver and Gold tables`.

### Task 3: Hub Worker draw

**Files:**
- Modify: `workers/versus/src/core/poolPick.ts` (`MirrorRun.strength_peak: string | null`, `PickArgs.p_peak_cap?`, `pickRuns`, `keyRowJson`), `workers/versus/src/core/poolMirrorCore.ts` (index mapping)
- Test: `workers/versus/test/sessionCf.db.test.ts`

- [ ] **Step 1:** Add `2026-11-24-strength-peak-cap.sql` to the chain, give the seeded runs synthetic peaks (including one at exactly 90), and add three parameter sets with `p_peak_cap: 90`. **Step 2:** run, expected FAIL. **Step 3:** port the filter with the exact-decimal compare (`cmp`). **Step 4:** PASS: `pickRuns` equals `pool_runs_sample_keys` for every set, and `keysJson` is byte-identical including the new column.
- [ ] **Step 5: Commit** `feat(worker): pool mirror draw honours the peak cap`.

### Task 4: Tools, rules, docs

**Files:**
- Modify: `packages/tools/src/strength/measureV2.lib.ts` (`inBandV2` uses the band's own `peakCap`; the candidate table stays), `packages/rules/src/registry/approved/foundation.ts`, `docs/GAME-RULES.md`, `.claude/skills/ascent-lobby/SKILL.md`, `packages/ui/src/patchNotes.ts`
- Create: `docs/devlog/2026-11-16-strength-peak-cap.md`

- [ ] **Step 1:** Add the rule (next free R-LOBBY number): "A Bronze, Silver or Gold table seats no recorded run whose best board from round 3 on ranks above 90; the cap is never widened away." Evidence: Mike 2026-11-16 "90 for all"; refs: the three test files above. Amend R-LOBBY-15 to name the second cap.
- [ ] **Step 2:** Patch note (Systems): "Bronze, Silver and Gold: you no longer meet a past game that had one runaway board, even if the rest of that game was ordinary."
- [ ] **Step 3: Run** `npm run typecheck && npm run lint && npm test && npm run build:web`, `npx vitest run packages/rules`, `npm run docbot:report -- --check`. Expected: all pass.
- [ ] **Step 4: Commit**, open the PR. Kevin reviews before merge.

### Rollout (owners)

1. Apply `2026-11-24-strength-peak-cap.sql` in Supabase, then `select public.pool_refresh_dirty();`.
2. `npm run strength -- measure --v2`: confirm each medal still seats 7 under the cap (measured 2026-11-16: 38 Bronze, 51 Silver and 83 Gold runs remain).
3. "Ship Ascent" (Mike or Kevin). An old client or an old hub simply does not send or apply the cap; nothing breaks.
