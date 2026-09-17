# 2026-09-17 — Perf PR 2: pointer state out of `Recruit`, no layout reads on the move path, `store:set` off the frame

**Owner constraint: no visible change** — hover highlights, the drag ghost, the insertion slot, the glides and
slides are the same code paths writing the same DOM; only WHERE the state lives and WHICH component re-renders
moved. No gameplay change, no patch note. Branch `perf/pointer-state`, built on PR 1 (`perf/instrument-pointer`,
merged in so the acceptance numbers come from its counters). This is
[`docs/perf-handoff-2026-09-17.md`](../perf-handoff-2026-09-17.md)'s **PR 2 — "the bet"**.

## The finding it answers

The owner's 240 Hz captures put every catastrophic shop frame under pointer movement. **Mode A** was a measured
chain — a shop action → `store:set` (6–19 ms) → `render:recruit` (13–24 ms) → `layout:flip` (6–10 ms) in one
frame, with "recruit renders 30" in the same second because the drag's decision state lived in `Recruit` and
every crossing re-rendered the shop screen. **Mode B** was a 60–119 ms task with no label open.

## What changed

**1. The transient pointer state lives in `dragStore.ts`, not in `Recruit`.** The live drag, its decision (gap
indices, cast target, magnetize/lift flags), `overZone`, the snap-back / magnet-slide flags, the sell/buy zone
geometry, the hand slot spacing and the hero-aim target are one external-store snapshot (`useSyncExternalStore`,
the `turnClock.ts` pattern). Only the components that DRAW from it subscribe, each to its own slice
(`useDragSlice`, shallow-compared): `TavernRow` / `WarbandRow` / `HandRow` compute their own `shopSlide` /
`boardSlide` / `handSlide` from the slice; a new `DragOverlay` owns the sell/buy zones, the floating drag card,
its weighted-drag rAF and the spell aim line; a new `RowFlip` runs the warband/tavern FLIP (plus the shop-rect
snapshot and the shop death cues, in their original order) in the commit where a row moves. `Recruit` has no
drag `useState` left and subscribes to none of it — a pointermove, a gap crossing, an aim crossing re-render
the row whose gap moved and nothing above it. `RenderMark` records `render:recruit` from exactly where the
inline effect used to sit (after the cards' own layout effects, before the FLIP), so the label still means one
`Recruit` render and never a row-only one.

**2. The drag is an imperative session, not an effect.** `onCardPointerDown` calls `startDragSession` (through
a ref, the `runRef` pattern) in a microtask: it measures the zone rects, the insertion slots, the spell target
rects AND the FLIP baseline (`Flip.getState`) once, installs the listeners, and publishes decisions to the store
from the rAF-coalesced `flushMove`. The decision gate (`deriveDragDecision` at the cursor vs at the last
committed point) is unchanged; the decision is now derived ONCE, in the flush, instead of in the flush and again
in the render. `endSession` is token-guarded so a snap-back or magnet-slide timer from a superseded drag can
never tear a newer one down. **The move path reads no layout**: `flushMove` and `onMove` hit-test the per-drag
cache only — pinned by `dragSession.test.ts` (a source contract, like `handRowViews.test.ts`) and by PR 1's
`layout:read-in-move`, which reads **0 across every drag** on the route below. The pointerdown's own layout pass
(the cache build) is deferred past its `input:pointerdown` span so it is not tallied as a move-path read.

**3. `Flip.from(…, { simple: true })`.** The single biggest number. The captured state was already `simple`
(2026-09-04), but `Flip.from` builds its own "to" state for the same targets and, without the flag, resolves a
global matrix per card — GSAP appends a temp element beside each and reads it, a forced layout per card. These
rows only translate, so the simple path is the same slide. `layout:flip:write` per slot crossing: **10.6 ms avg
/ 24.9 ms worst → 1.4 / 3.2**. Same flag on the hand reorder glide; the Choose One coalesce keeps the full path
(`absolute: true`, it crosses containers).

**4. The FLIP reads first and skips no-op commits.** The `offsetLeft` sweep now runs BEFORE the write pass
(it is transform-immune, so nothing in the effect can change it) on the flush React's DOM writes already made
unavoidable, and the commit branch diffs it against the previous sweep: a commit that moved nothing (a roll — five
new cards in the same five slots) writes no style and forces nothing. `Flip.getState` is only captured during a
drag (the next drag start captures it fresh). A drop commit went from three forced layouts to two, a roll from two
to one.

**5. `store:set` back to sub-millisecond self time.** Each commit step now carries a `commit:*` span
(`commit:actionRing` / `commit:telemetry` / `commit:derive` / `commit:replayFrame`) so the wrapper's self time
is attributable. Two things left the frame: the bug-report action ring's `hashRunState` (a JSON round-trip +
stable-stringify of the whole run — 5–15 ms late-game, and the likely bulk of the owner's 6–19 ms `store:set`)
is now computed on idle time (`idleWork.ts`: `requestIdleCallback` with a 1.5 s timeout; `snapshotActionWindow`
flushes it first, so no reader ever sees an unhashed entry — safe because the reducer never mutates a state it has
returned); and the phase-boundary **autosave** (`serialize` + `localStorage.setItem`) is scheduled the same way
(`flushSave` on quit / tab-hide writes the live state itself and cancels it; `clearSave` cancels it). The window
a crash could lose is the idle wait — a second or two of a turn the boundary save never covered mid-turn anyway.

**6. `shopView` is memoized per offer** (`shopViewCache.ts`): each view is keyed on a signature of the offer +
the opts it is built with; a dispatch that left four of five offers untouched builds one view. Same offer, same
opts → the same object without a `shopView` call at all (`stabilizeView` still value-compares a rebuilt one).
Measured as `view:shop`.

## Measured (same script, same route, same seed, before/after)

Dev build (StrictMode double-invokes render bodies, so the absolute numbers run high; the before/after is
like-for-like), 1413×1316, a practice lobby run at tier 6 with board 7 / hand 6 / shop 6, driven from the
console in the embedded Browser pane. The pane throttles rAF to ~2 fps, so every rAF client was driven off a
4 ms timer for both runs and frame-time columns are NOT reported; instead each action's synchronous task
(dispatch + React's microtask flush) is timed directly, and long tasks come from the Long Tasks API. Route: five
rolls → a 100-move shop reorder drag → a drag-buy → a sell drag + a hand-play drag → a 100-move board reorder
drag → 12 card hovers → a 61-move hero-power aim → 1.5 s idle.

| | before (`fe23cb64`) | after |
|---|---|---|
| `recruit renders`, whole route | 140 | **18** |
| … during the shop reorder drag (100 moves) | 28 | **0** |
| … during the drag-buy (60 moves + drop) | 16 | 2 (the buy's own commit) |
| … during the sell + hand-play drags | 30 | **0** |
| … during the board reorder drag | 24 | 2 (the reposition's commit) |
| … during the hero-power aim (61 moves) | 22 | 4 (arm + disarm) |
| … hovers / idle | 0 / 0 | 0 / 0 |
| `layout:flip` avg / worst | 9.56 / 17.4 ms | **2.42 / 4.6 ms** |
| `layout:flip:write` avg / worst | 8.41 / 15.6 ms | **1.64 / 4.2 ms** |
| `layout:flip:read` avg / worst | 1.14 / 1.8 ms | 0.77 / 1.4 ms |
| `render:recruit` n / avg / worst | 60 / 2.46 / 17.9 ms | **9** / 4.04 / 8.0 ms |
| `store:set` avg / worst (self avg) | 1.23 / 1.8 (0.93) ms | 0.63 / 1.0 (**0.17**) ms |
| a roll's task | 12.5–17.9 ms | **8.4–10.7 ms** |
| a reorder / play drop's task | 16.7–23.8 ms | **9.1–13.7 ms** |
| the buy drop's task | 28.5 ms | 35.4 ms (one sample; see below) |
| layout reads on the drag move path | not instrumented | **0** (`layout:read-in-move` = 0 on every drag) |
| long tasks attributed to a handler | 0 | 0 |
| `npm run perf` (engine, untouched) | full run 260 ms/op | full run 260 ms/op |

`recruit renders` per second during a drag is now ≤ actions per second (0 with no dispatch; the drop's own
commit otherwise). The buy drop is the one action still around 25–35 ms in dev: its task carries the bought card
mounting in the hand, the hand make-room glide (`layout:handglide:seed` 4.8 ms + `layout:handglide` 1.4 ms),
the FLIP and the buy slide, on top of two StrictMode renders — a prod build pays roughly half. It is the next
thing to profile with PR 1's `render:recruit:hand`.

## What Mode B turned out to be (here) — and what it is not

In the embedded pane the unlabelled long tasks are **environmental**: 90–140 ms tasks on a 2-second cadence,
present at idle with no pointer input, no GC (heap flat), and no timer / rAF / rIC callback over 30 ms (every
callback was wrapped and timed) — the pane's own compositing cadence, not the game. They appear identically on
`main`. What this PR does establish about the owner's Mode B: the drag move path can no longer be a
forced-reflow-per-pointer-event (0 layout reads, pinned by test and counter); the two remaining per-gesture
`<body>` class toggles (`dragging`, `aiming`) each cost ~7 ms of style recalc (measured: a body class flip +
flush on this ~1000-node shop), once per gesture, not per move; and the hero-power aim keeps ONE
`elementFromPoint` per rAF flush (61 on the route, 0.21 ms avg for the whole flush including the Pixi line) —
kept on purpose, because a cached-rect hit test would change the edge of a hovered card's 1.06 scale, which is a
visible difference. On the owner's machine PR 1's long-task attribution now says which it is: `pointermove` with
`layout:read-in-move: 0` means paint / style (the DevTools profile the handoff asks for — look for the purple
bar); `pointerover on div.card…` means the hover reveal (`Card.tsx` mounts a plated portal whose art is
`decoding="sync"`, a main-thread decode at paint) — a follow-up, not this PR.

## Where each piece of pointer state went

| was (`Recruit` `useState`) | now |
|---|---|
| `drag` (+ `dragRef`, `dragPosRef`) | `dragStore.drag` (the decision point) + `dragStore.pos` (exact, mutable, silent) |
| `overZone`, `sellTop`, `buyTop` | `dragStore` — read by `DragOverlay` (zones) and `HandRow` (`canDropHand`) |
| the derived decision (`gapIndex`, `shopGapIndex`, `handGapIndex`, `castTargetUid`, `overWarband`, `wouldMagnetize`, `collapsedLift`) | `dragStore.decision`, computed once in `flushMove` |
| `castingSpell`, `castAimRef` | `dragStore.castingSpell` (+ `castAimRef` written by the flush, not the render) |
| `snapping`, `magSlide`, `magTargetUid` | `dragStore` — `DragOverlay` (CSS-driven transform), `WarbandRow` (electrify) |
| `aimTargetUid` | `dragStore.aimTargetUid`, written by the two aim effects, read by the rows |
| `handSlotWRef`, `dragIsTouchRef` | `dragStore.handSlotW`, `dragStore.touch` |
| hovered card | unchanged — `Card`-local (`refPos`) + CSS `:hover`; it never touched `Recruit` |

## Verified

`npm run typecheck`, `npm run lint` (0 errors), `npm test` (681 files), `npm run build:web`, `npm run perf`
(unchanged) — green. New tests: `dragStore.test.ts`, `dragSession.test.ts` (the source contract above),
`idleWork.test.ts` (a burst of schedules → one write with the latest args; flush; cancel; the timer fallback),
`shopViewCache.test.ts` (same offer → same view object, no build; a changed offer rebuilds only itself),
`actionRing.test.ts` (+ the deferred-hash case). The existing drag / glide / FLIP / choreo / source-scan tests
are unchanged and green.
