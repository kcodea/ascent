# 2026-09-11 — Doc Bot nightly answered: two root causes fixed, and a red night can no longer go unnoticed

The Doc Bot nightly (`.github/workflows/nightly.yml` → `npm run docbot:nightly`) had been **RED on every one of
its 15 scheduled runs since 2026-08-28** with the same two findings, and nobody looked. Both are fixed at the
root, and the lane now has three things it lacked: a pinned tracking issue, an acknowledgement registry, and a
status line in `npm run docbot`.

Reproduced locally first (deterministic — the seeds are `60000 + k·977`):
`npm run docbot:nightly -- --runs 6 --out <scratch>` → `NIGHTLY RED in 267.6s`, exactly the two nightly findings.

## Finding 1 — `seed 62931 · brackus · set1 — ✗ [roundtrip]` was a REAL save/load bug

**Root cause:** `deserialize` heals a save by merging it over a fresh `createRun` skeleton
(`{...defaults, ...parsed}`). Brackus's run-start Discover seeds `discoverLockGold: 70` into that skeleton
(`queueDiscover(state, { kind: 'minion', tier: 7, exactTier: 7, lockGold: 70 })`). Once the pick is taken
the live run clears the key to `undefined` — which `JSON.stringify` **omits** — so the merge silently put `70`
back. The 2026-07-13 fix for the same shape only forced `discover` / `discoverLockTier` / `discoverQueue` from
the save; the rest of the one-shot Discover family (`discoverGolden`, `discoverLockGold`, `discoverLockWave`,
`discoverBorrowed`, `discoverSetStats`, `discoverIntoShopUid`) still leaked.

Diffing `normalizeRunState(live)` vs `normalizeRunState(deserialize(serialize(live)))` at the first checkpoint
gave exactly one key: `discoverLockGold: undefined → 70`. Not a normalizer artifact.

**Player-observable?** Yes, narrowly: the store saves on every dispatch, so a reload can land while an
*ordinary* Discover is open. `deserialize` forced `discover` from the save but let the skeleton's lock through —
the pick from that ordinary Discover arrived **locked until 70 Gold spent**. Verified on `HEAD`
(`lockedUntilGoldSpent = 70`) and gone after the fix. Patch-notes entry added under Hero Change.

**Fix:** `packages/sim/src/state.ts` `deserialize` forces the whole family from the save. **Test:**
`run.test.ts` "Brackus does NOT re-arm his run-start Gold lock after save/load" pins the field byte-for-byte AND
the observable pick; sabotage-checked (reverting the fix fails it with `expected 70 to be undefined`).

## Finding 2 — `contracts: … 1 DISAGREEMENT: shaper · effects.1.summons.count.plain` was the DRIVER

Neither the extracted contract (1 Stray) nor the engine was wrong. The `shop-battlecry-summon` driver in
`contractOracle.ts` plays the card through the real reducer, but Wildwood Shaper is **Choose One**: the play
pauses on the prompt and nothing is summoned until a branch is picked. The driver counted 0 Strays against an
unanswered prompt every night. Fix: the driver answers the prompt through the real `chooseOne` action with the
branch that owns the summon (`chooseOneSummonBranch`, derived from the def — the same place the extractor read
it). No contract was curated, nothing silenced. **Tests:** `contractOracle.test.ts` proves the count is now
OBSERVED = 1 with zero mismatches, plus a sabotage row (doctor the count to 2 → still a mismatch, observed 1).
Reverting the driver fails the first test with `expected +0 to be 1`.

## Making a red nightly unignorable

- **Tracking issue** — `scripts/nightly-issue.mjs` (plain node, no deps; `issues: write` on the job) runs
  `if: always()` after the upload step. It finds the ONE open issue titled **"Doc Bot nightly status"** by exact
  title; on red it creates (and pins) or rewrites it, and comments the two-line-per-finding summary + repro
  commands + artifact link; on green it comments "green" and closes it; a lane that crashed before writing its
  status is reported as red. Planning/rendering are pure and pinned by `packages/tools/src/nightlyIssue.test.ts`.
- **Acknowledgement registry** — `packages/sim/src/docbot/nightlyAck.ts`: `{ fingerprint, date, reason }`
  rows. Every gating finding (lifecycle, lobby law, verified contract bug, interaction failure — the last was
  previously only a log line) goes through `nightlyVerdict`: unacknowledged → RED; acknowledged → printed as
  `known (acknowledged YYYY-MM-DD: reason)` and not failing. Fingerprints are structural, so re-wording can't
  create or silence an ack. `nightlyAck.test.ts` is the sabotage proof (unknown fails / acknowledged passes /
  an ack covers only its own fingerprint). The registry is EMPTY — both findings were fixed, not parked.
- **Status document** — the nightly writes `nightly-status.json` to its artifact dir and mirrors it to the
  gitignored `.local/docbot/nightly-status.json`; `npm run docbot` prints it when present, otherwise
  `nightly status unknown — run \`gh run list --workflow=nightly.yml -L 1\``. Offline-safe.
- The two full sweeps in the workflow now run `if: always()` — a red lifecycle lane used to skip them, so the
  ledger lost their findings on exactly the nights that mattered.

## Verification

`npm run typecheck && npm run lint && npm test && npm run build:web` green (lint: 0 errors, pre-existing
warnings only). Post-fix `npm run docbot:nightly -- --runs 6 --out <scratch>` → **NIGHTLY GREEN**, `contracts:
… every executed case agreed`.

Follow-up worth a look: `deserialize`'s merge-over-skeleton heal will leak ANY future field a hero seeds at
`createRun` and later clears — the durable fix is to seed run-start actions *after* the heal, not in the
skeleton. Out of scope here; flagged in the PR.
