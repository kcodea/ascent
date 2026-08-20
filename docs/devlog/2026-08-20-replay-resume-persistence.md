# 2026-08-20 — a resumed run no longer amputates its replay (and its balance telemetry)

Two independent data-loss bugs, both surfaced by one public leaderboard row: a completed 18-round lobby run
whose Replay V2 timeline offered **rounds 7-18**, and whose derived balance telemetry also began at wave 7 —
while its 18 uploaded board snapshots and its full result history covered the whole run. The viewer was
faithfully showing the only frames that were ever uploaded. Both causes were confirmed in code before any
fix was written.

## Root cause 1 — `flushSave` silently dropped the derivation accumulator

The turn-boundary autosave persisted five things; the **durability** path persisted four:

```ts
writeSave(next, replayActions, capturedBoards, telemetryLog, deriveState); // turn boundary
writeSave(s.run, s.replayActions, s.capturedBoards, s.telemetryLog);       // quit / pagehide / tab hide
```

`writeSave` only serializes what it is handed, so the omission did not merely *skip* an update — it
**rewrote `ascent.save` without `derive`**, and the boot fallback (`BOOT_SAVE?.derive ?? beginDerive(run)`)
then restarted the accumulator at the resumed wave. `flushSave` fires on quit-to-title, `pagehide`, and
`visibilitychange → hidden`, so this was every departure that wasn't a crash. One argument, plus
`flushSaveDerive.test.ts` — **verified to fail without the fix** (3 of its 4 cases go red when the argument is
removed), including the guards that must stay closed: sandbox runs, the title screen, and an active replay.

## Root cause 2 — Replay V2 frames only ever lived in memory

By design: frames are hundreds of KB of JSON, and `localStorage` is a synchronous ~5 MB string store that
would have to re-serialize all of it on every autosave — squarely against the perf contract. So on restore,
`seedReplayFrames(BOOT_SAVE.run)` started a fresh recording at the resumed wave and flagged `partial`.

**Frames now persist per round to IndexedDB** (`packages/ui/src/replay/replayDraft.ts`), keyed `[runId, wave]`
with the run seed as `runId` — the identity a resumed run can rediscover without the save carrying a new
field. Chunks are written at the **round boundary**, when the closed round has stopped changing, and again
from `flushSave` for the round still in progress; a chunk **replaces** its predecessor, so the mid-round flush
converges on the complete round instead of duplicating it. At boot, `hydrateReplayDraft` splices the restored
rounds in front of the resume keyframe and shifts the new session's frames along the cumulative clock, so the
two halves form one monotonic timeline joined by a single deliberate `RESUME_GAP_MS` beat — never the real
hours the tab was closed.

Everything is best-effort by contract: every entry point resolves rather than rejects, a failure downgrades
the recording and marks *why*, and capture never gates the app booting or the run playing.

**Why once per round.** It matches the round rail and the autosave rhythm, bounds a crash's loss to part of
one round, and keeps the write off the interaction path entirely — one asynchronous IndexedDB transaction per
round, none per action.

## Partial is now a real, labelled state

`ReplayV2` gained `firstRecordedWave` and `partialReason`
(`resumed_without_frames` | `storage_failure` | `legacy_capture`), and `partial` changed meaning: it is
"does not begin at round 1", not "was resumed". The round rail shows a **Partial replay · Rounds N–M
recorded** banner before playback, because a rail that silently starts at R7 reads as *filtered*, not as
*never captured*. Existing partial replays stay watchable and now say so.

## Verification

- `replayDraft.test.ts` (20 cases) drives the **real reducer with the real bot**, plays to wave 6, "quits",
  resumes, and finishes — then asserts the stitched recording starts at wave 1 with no gap, that the clock is
  monotonic across the seam with exactly one `RESUME_GAP_MS` step, that it survives `expandFrames` with every
  delta still having its keyframe baseline, and that inspect events on both sides stay ordered. It also pins
  the broken baseline: the post-reload half **alone** starts above wave 1 — the shape of the shipped defect.
- A dedicated case replays the store's exact write schedule and proves every chunk written at a round boundary
  is byte-identical to that wave's final recording — the late `resolveLost` patch lands before the flip, so a
  "closed" round really is immutable.
- The three risky IndexedDB assumptions were checked in a **real browser**, not assumed: `±Infinity` are valid
  keys and a compound-key bound range selects exactly one run's chunks in wave order; `put` on a compound
  keyPath replaces rather than duplicating; range `delete` scopes to one run.
- Gates: typecheck ✅ · lint 0 errors ✅ · 6317 tests / 387 files ✅ · build:web ✅

## Not done / follow-ups

- The IndexedDB adapter itself has no automated coverage — node has no IDB, and the suite runs without a DOM.
  The pure layer (chunking, merge, clock stitching, validation) is fully covered; the adapter was verified by
  hand in a browser. A jsdom+fake-indexeddb project would close this.
- **Mike's existing run stays partial.** Its intermediate shop frames, pacing, drag paths, inspect events and
  wave 1-6 combat logs were never recorded, and synthesizing them from the raw action log would be a
  reconstruction dressed as exact playback — the one thing state replay exists to prevent.
