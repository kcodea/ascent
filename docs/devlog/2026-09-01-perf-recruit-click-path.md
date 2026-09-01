# 2026-09-01 — perf: the recruit click path (audit items 1, 3, 2, 16, 17)

The 2026-09-01 performance audit (seven agents, target 240 Hz = a 4.17 ms frame budget, worst frame is the
metric) ranked 32 findings. The owner picked six for a first branch: 1, 5, 3, 2, 16, 17. Five shipped; one
was measured and dropped. Nothing here changes what the game looks like or how it plays.

## 1 — `normalizeRunState` no longer round-trips the whole run through JSON

It runs on EVERY accepted action (the WP-C exact-reproduction rail hashes the run state per dispatch). It did
`stableStringify(JSON.parse(JSON.stringify(state)))` minus the volatile keys — three full serialisations of a
state that carries the last fight's event log and thirteen pinned boards. It now walks the top level itself,
skips the volatile keys directly, and memoises every by-reference sub-tree in a `WeakMap`. The reducer shares
`lastCombat` and `servedBoards` by reference across dispatches, so after the first hash those are a lookup.

The contract is **byte-identical output** — a changed byte would read as a divergence that never happened.
`normalizeRunState.perf.test.ts` keeps the original formula verbatim as the oracle (nine pins, including
undefined-valued keys, a stripped volatile key, and a replaced sub-tree that must miss the memo).

| late-game-shaped state, 15 KB JSON, 63 combat events | median | p95 |
|---|---|---|
| before | 0.373 ms | 0.568 ms |
| after (memo warm) | 0.017 ms | 0.047 ms |

## 5 — `deltaShopFrameOf` — measured, dropped

The replay recorder re-stringified both the previous and current shop view per key on every action. A
per-view JSON cache was written, then benchmarked against the original on a chained previous view (the way
`store.ts` actually feeds it): **0.028 ms → 0.031 ms median**. The compare was never the cost —
`projectShopView` is, and both paths pay it. Under 1% of a frame either way; the change was reverted rather
than ship a Map allocation for no gain.

## 3 — the tavern-rect measurement is keyed on the SHOP, not the whole flip key

`Recruit.tsx` re-measured every tavern slot's `getBoundingClientRect` in a layout effect keyed on `flipKey`,
which folds in the board's uids too — so every board change (a buy landing, a sell, a drag reorder) forced a
synchronous shop layout read for slots that had not moved. The effect now keys on `shopFlipKey` (shop uids +
spell shown + gap index); `flipKey` is composed from it, so the FLIP animation itself is unchanged.

## 2 — the handglide layout effect bails during a drag

The handglide effect measured hand-card rects on each render; during a drag the hand re-renders per pointer
move and the measurement was pure waste (the glide only matters when a card is added or removed from the
hand). It now returns early while `dragRef.current.active`; the drop dispatch re-renders with the drag
inactive and the glide runs then, as before.

## 16 — `FilterStack.frame` fast path

Every live particle/mesh primitive calls `FilterStack.frame` once per frame. With nothing enabled it still
allocated two arrays and ~31 template-literal keys per call — ~330k allocations/s on a busy board at 240 Hz
for defs of which not one enables a lab filter. A keyed registry (built once per registry via `WeakMap`) and
an `anyEnabled` scan return early with zero allocations; the key for the enabled path is built by string
concatenation. Two new pins cover the idle path (no filter built, `container.filters` not rewritten) and the
enabled path (built the frame it is enabled, retuned without rewriting the array, cleared once on disable).
Behaviour on the enabled path is identical to before.

## 17 — `defaultsOf` caches its plan per spec set

`coerceParams` → `defaultsOf` walked every spec entry and deep-copied every palette/curve/gradient default on
every call, including the per-frame `setParams` path in the FX lab. The scalar defaults are now computed once
per spec object (`WeakMap`) and spread; only the by-reference defaults are still copied per call, because
callers mutate them. Median cost on a 7-key spec set is now ~1 µs.

## Verification

`npm run typecheck`, `npm run lint` (0 errors), `npm test`, `npm run build:web` — all green on the branch.
Not yet re-profiled in Chrome against the prod build; the audit's recruit-phase jank counts (947/989 frames)
are the baseline to re-measure against once the rest of the ranked list lands.
