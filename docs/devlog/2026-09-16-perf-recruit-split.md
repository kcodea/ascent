# 2026-09-16 — perf: `Recruit` split into memoized subtrees + the hand-glide layout read gated

**Owner-approved mechanical cleanup (2026-09-16): "must not change how the game looks or functions."** No
gameplay change, no patch note. Branch `perf/recruit-split`.

## The finding

The owner's 2002 s / 240 Hz recording put `render:recruit` — the shop screen's render body + React
reconciliation + DOM commit, measured from the top of the render to the first layout effect — at **106 ms in
its worst call**, 49–92 ms in the other bad seconds, 230 ms at game over, with ~2 recruit renders per bad
second. So it is **cost per render**, not render count. `Recruit` is one component subscribed to the whole
`run` plus a dozen store slices, holding ~40 pieces of local state; any one of them changing (a drag decision,
an aim target, a loss-tally tick, an overlay toggle, a combat beat) reconciled the ENTIRE screen: three card
rows, seven buttons, the timer, every overlay. Two `useLayoutEffect`s with no deps ran a forced layout on
every commit on top of that (`layout:handglide` at 39.8 ms worst).

## What changed

**D — memo boundaries.** The JSX that used to sit inline in `Recruit`'s return was moved VERBATIM (same
file, same DOM order, same class names, same `data-*` attributes, same handler semantics) into `React.memo`
components that take only the slices they render from:

| component | what it owns | re-renders when |
|---|---|---|
| `ShopControls` | shopbar + timer, End Turn / End Combat diamond, Freeze, Refresh, Tavern Up, Gold pill, Rift, Summary, Skip | one of ~27 primitives changes (Gold, tier, timer-up, phase, the offer flags…) |
| `TavernRow` | the tavern zone (offers + pinned spell / combat enemies / sandbox foe) | the shop view map, a drag scalar, an aim target, `heldUids`… — and per beat in combat (`replay` is passed only while units show) |
| `WarbandRow` | the warband zone | the board view map, the pulse/flame/electrify sets, a drag scalar, … |
| `HandRow` | the hand zone + grant previews | the hand view map, `gambleHand`, the drag scalars, `handPreviewViews` |
| `CombatLogOverlay`, `ChooseOneOverlay`, `DiscoverOverlay`, `ScoutOverlay`, `QuestOverlay`, `PowerOverlay`, `RuneforgeOverlay` | each overlay (+ its toggle; the Runeforge one also carries the two lock-in mounts that sit between its toggle and panel) | its own inputs — the ones that read `run` still re-render per dispatch, exactly as before, but no longer per drag / hover / local-state render |

Handlers were made referentially stable so the memos actually hold: `boardSlide` / `shopSlide` / `handSlide`
/ `isDragging` / `isPendingTarget` / `onSbEnemyPointerDown` are `useCallback`s over the scalars they read;
`endTurn` (which closes over most of the component) is wrapped by a stable `endTurnStable` that calls the
latest through a ref (the `runRef` pattern); `skipCombat` reads the replay through `replayRef` instead of a
`[replay]` dep (the hook returns a fresh object every render); the inline `() => dispatch(...)` arrows on the
buttons became `onFreeze` / `onRefresh` / `onUpgrade`; `heldUids` and the grant previews' views are
`useMemo`d. `ShopTimer`, `ChargeGlyph`, `HudBar`, `CombatOpponent`, `FxUnderSlot`, `LobbyPanel` and the six
button components are `memo`'d at their definitions (they take no props or primitives only).

**B — the layout effects.** The `layout:handglide` cache (each hand card's `offsetLeft`, the "from" of the
make-room glide) used to be read on EVERY commit. It now keys on `handLayoutKey` = hand order/count +
grant-preview count + compact mode (+ `inCombat`), and repeats the read on window `resize` — the only things
that move a hand card's LAYOUT x; a drag, hover or overlay moves cards by transform only, which `offsetLeft`
ignores. The glide effect keys on a subset of this, so within one commit it still reads the previous frame's
positions first (the contract the comments there describe). The FLIP effect (`layout:flip:*`) was **already
keyed** on `flipKey` (row composition + the live drop-gap indices) — both its capture and its write — so
nothing to gate there; a drag's per-slot slides are exactly the commits it must run on.

**Audited and left alone:** every pointer-driven path already writes refs / Pixi, not React state (the drag's
decision gate, the two aim lines, the gamble pointer). The `lastCentreRef` layout effect still reads rects
every commit — it must hold the previous layout for a body that just died, and gating it on a board key would
leave stale mid-tween centres; not asked for, flagged for a follow-up.

## Measured (same script, same route, before/after)

Dev build (StrictMode double-invokes render bodies, so the absolute numbers are higher than prod; the
before/after is like-for-like), 1413×1316, a lobby run at tier 6 with board 7 / hand 8 / shop 6. The drive
script (`window.useGame` + a tap on `perfMonitor`'s span/count sinks): five rolls → a Discover opens and
closes → a synthetic drag of a shop offer with 100 `pointermove`s across the row → 12 card hovers. Three
passes each.

| | before | after |
|---|---|---|
| `recruit renders` per pass | 52 | 52 (unchanged by design — the count was never the problem) |
| `render:recruit` avg | 6.46 / 6.66 / 5.95 ms | **3.31 / 3.40 / 3.29 ms** |
| `render:recruit` worst | 13.4 / 13.5 / 11.3 ms | **7.7 / 8.8 / 8.0 ms** |
| … during the rolls (avg / worst) | 12.3 / 13.4 | **7.5 / 7.7** |
| … during the Discover (avg / worst) | 6.7 / 9.7 | **3.6 / 5.0** |
| … during the drag (avg / worst) | 3.8 / 10.5 | **1.4 / 5.9** |
| `layout:handglide` calls per pass | 17–18 (every commit) | **0** (no hand change in the window) |
| `layout:flip:write` worst (a drag slot slide) | 23.3 / 23.3 / 24.3 ms | 15.3 / 13.4 / 14.9 ms |
| `layout:flip:read` avg | 1.74 / 1.67 / 1.76 ms | 1.21 / 1.13 / 0.94 ms |
| `npm run perf` (engine, unaffected) | full run 183 ms/op | full run 183 ms/op |

`layout:flip:write` is the GSAP slide itself and was not touched; it got cheaper because the commit it runs
in now dirties far less DOM before its forced reflow.

## What could not be made stable

- `TavernRow` / `WarbandRow` still take the whole `replay` object while combat units are shown, so they
  re-render every combat beat — which is correct (the units move every beat) and what `render:combat` already
  measures separately.
- The overlays that need `run` (`ChooseOne`, `Discover`, `Runeforge`) re-render on every dispatch, as they
  always did — the reducer `structuredClone`s the run, so nothing under it is reference-stable.
