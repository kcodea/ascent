# 2026-09-19 — Replay viewer: round-rail rework, Win % / Power, shop sounds, recorded cursor, held ghost

Owner handoff 2026-09-19 (six items + one follow-up report). Everything lives on the UI side of the replay
seam (`packages/ui/src/replay/`) plus the recording format in `packages/sim/src/replayV2.ts`.

## 1. The rail is one table, collapsible and draggable

`RoundRail.tsx` no longer has the slide-out "metrics dock" (2026-08-19) as a separate aside. One grid:
**Round · Recruit · Combat · Gold · Acts · Tier · Power · Win %**. The three dock numbers are the same
`rollupRounds` fold as before, just columns now.

- **Collapse** (◂ / ▸ on the rail's own title bar) folds it to a slim plate `⋮⋮ R7 ⚒ ▸` naming the current round
  + phase. Unlike the 2026-08-30 chevron that "danced", the toggle sits on the rail's title bar and never moves
  out from under the pointer.
- **Drag** by the `⋮⋮` grab: one `getBoundingClientRect` at pointerdown (pointer capture on the handle), every
  move is arithmetic + two CSS vars (`--rrl-dx/--rrl-dy`) written on the wrapper — a transform, no React
  render until release. `railPlacement.ts` persists `{dx, dy, collapsed}` per browser (try/caught) and
  `clampRailOffset` keeps ≥40 px of the rail on screen; a `resize` re-clamps (one rect read per event).
- Tuner: `dockW` is gone; `colW` (data column width) and `collapsedW` are new in `replayRailConfig.ts` +
  `ReplayRailTuner.tsx`. `x`/`y` are now the rail's HOME; the viewer's drag offset rides on top.

## 2. Recruit + Combat cells → `seekReplayPhase`

`roundMarks()` now records frame INDICES per wave: `shopIndex` (the `turnStart`), `lastShopIndex`,
`combatIndex`. `seekReplayPhase(wave, 'shop' | 'combat')` seeks by index; the combat path passes
`playCombat: true` to `seekReplayIndex`, the one caller allowed to land ON a combat frame (the scrub rule
otherwise skips to the fight's resolved world). A freshly rendered combat frame has `combatSettled: false`,
so the arena plays it from the top. `ReplaySession.phase` says which cell to highlight.

## 3. Win % — was it already recorded? No.

`CombatFrame extends Omit<CombatResult, 'oddsInput'>` so `odds` was always a legal field — but it was always
**absent**: the 200-sim probe has been deferred to UI idle time since 2026-08-01, so at `faceOmen` (capture
time) there is nothing to record. Two halves:

- **Going forward:** when Recruit's idle probe finishes it calls the new store action `stampReplayOdds(odds)`,
  which patches the current wave's combat frame (once; never during playback). That lands before the next
  `turnStart`, so the round-boundary draft write carries it. The rail prints the exact number the player saw.
- **Old recordings:** `oddsInputFromCombatFrame(frame, view)` rebuilds an APPROXIMATE matchup from the frame's
  `initial` rosters with neutral side states at the recorded tier (run-level scalers are not recoverable — the
  exact input was stripped by design). `replayPlayer.ts` runs `createOddsProbe` over it per round in
  `requestIdleCallback` slices (10 sims per step, setTimeout fallback), off the render path; each landed
  round bumps `replaySession.roundInfoTick` and the rail prints `~N%` with an "estimated" title. A seek does
  not cancel the backfill (it runs on `replayEpoch`, not the seek `token`); `endReplay` does.

## 4. Power

`boardPowerOf(view, wave)` = `boardStrength` (the learned board model the production bots search with) over
the round's `lastShopIndex` board, ×100 rounded; `null` (an em-dash) for an empty board. Nothing in the UI
displayed a "power" before, so this is the sim's own evaluator, not a HUD number.

## 5. Shop sounds in replays

`actionSfx` is now **exported** from `store.ts`. Playback's `advance` (never a seek) synthesises the action a
shop frame stands for — `frameAction(prev, f)`: the cause as `type`, `causeIndex` as `index`, and a `uid`
from the drag path when recorded or from the zone diff (the card that left the hand/board/shop) — and calls
`actionSfx(action, prevRun, nextRun)` with the store's synthetic runs before/after the render. `sfx` applies
the mixer/mute as always; a 🔊 toggle on the transport (`setReplaySounds`, `ascent.replay.sounds`) mutes it.

## 6. Free-cursor recording + playback

- `ReplayV2.cursorTrail?: CursorSample[]` — `[tMs, x, y]` tuples (viewport fractions, 3 decimals) on the
  frames' clock. Optional; version stays 2; documented beside `inspectTrail`.
- Capture: Recruit adds a passive window `pointermove` listener on the live recruit screen →
  `recordCursorSample` (store) → `cursorTrace.ts` (`sampleCursor`, throttled to 50 ms = 20 Hz; no layout
  reads). Each closed round is simplified once (`simplifyCursorTrail`: rests collapsed to their endpoints, then
  RDP over x/y with timestamps kept). `takeCursorTrail` thins the whole run uniformly to `CURSOR_TRAIL_MAX`
  (6,000). Draft chunks carry `cursorTrail?` per wave and a resume shifts + re-seeds it like the inspect trail.
- Playback: `ReplayCursorGhost.tsx` moves the open-gauntlet SVG along the trail via ONE transform per rAF on
  `replayClockMs()` (the frames' clock read between frames, mid-ghost counted back from the landing frame);
  `cursorAt` is O(1) per frame with the last index as a hint. Hidden in combat, during a ghost flight, with no
  trail, or with the 🖱 toggle off (`ascent.replay.cursor`). Sits under the drag ghost (z 535 < 540).
- **Size on a real replay:** a two-action, one-fight run recorded from the browser produced 8 samples (the
  automation only sends discrete moves; a human's mouse yields far more — the throttle bounds it at 20/s, so
  ~1,200 per minute of shop before simplification, capped at 6,000 per run ≈ 120 KB JSON).

## 7. Follow-up: the held card during a ghost flight

Owner screenshot: the Chipper stayed on the board while its ghost travelled. `DragPath.uid?` is now recorded
(`beginDragTrace(cardId, x, y, uid)`); older paths derive it from the frame diff. When a ghost launches,
`holdGhostCard` sets the SAME `dragStore.drag` slice the live drag sets (`active: true` + the uid + source +
a decision opening the gap at the recorded destination) flagged `ghost: true`. The rows' existing
`isDragging` → `dimmed` → `.dragsrc { opacity: 0 }` lifts the original; `DragOverlay` skips the floating card
and the sell/buy zones for a ghost. `renderFrame` / `endReplay` call `releaseGhostHold`. The gap is placed at
the destination for the whole flight rather than sliding with the ghost.

## Tests

`replayV2.test.ts` (indices, power, backfill input, cursor helpers, JSON round trip), `cursorTrace.test.ts`,
`railPlacement.test.ts` (jsdom), `RoundRail.test.tsx` (jsdom: cells, highlight, collapse/drag persistence,
resize clamp), `replayViewer.test.ts` (seek-to-phase, round info + backfill, `frameAction` / `ghostHoldFor`,
held uid during flight, `actionSfx` per applied frame via a mocked `sfx`, cursor on the clock, `stampReplayOdds`),
`replayDraft.test.ts` (cursor chunks).

## Verification notes

Verified in the Browser pane against a Vite server started from THIS worktree on port 5199 (the pane's
`preview_start` launches from the session's original checkout — the first attempt served another worktree's
code). The pane reports `document.hidden === true`, which pauses the arena's beat clock; overriding it in the
console was needed to let the live fight resolve. Screenshots in the pane lag the DOM by a repaint.
