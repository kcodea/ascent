# 2026-10-09: Lobby rail Guides tab

Owner ask: "we're going to add a guides tab to the lobby rail in game ... the guides have a card similar looking to
the opponent rail, except will have cards that can expand by clicking ... and have a guide for the build. the guide
cards should have minion art references like in game with mouseover support with hover previews etc."

## What shipped

- **Data** (`packages/ui/src/guides/guides.ts`): one `Guide` per build line (owner: "each line should have its own
  card"), 11 for Set 2. Each has id, set, tribes (empty = neutral), optional `pairsWith` (display-only crossover
  chip), title, tagline, body, `core` and `enablers` card ids. `guides.test.ts` fails an unknown card id, a card
  outside the guide's set, or a tribe outside the set. Only the Dwarves Ale guide has real text (the owner's,
  verbatim); the rest read "Guide coming soon." with best-guess cards.
- **Visibility** (`guidesFor`): the run's pinned set, tribes in `run.tribes`, neutral always.
- **Tab** (`LobbyPanel.tsx`, `.lobbyrailtab`): a sibling of the rail (the Gem rail clips its children), positioned
  off the rail's own `--lby-*` expressions, vertically centred on it. Two glyphs (sword / new `book` icon), the
  current view lit. Gauntlet cursor via the global button rule, `aria-label` + `data-tip`, no `title`.
- **View memory**: per run for the session (module memo keyed on runId + seed), so a remount keeps it and a new game
  starts on Opponents. The open guide is remembered the same way. Off in the Tutorial (its coach marks anchor on
  seats).
- **Modes** (follow-up asks the same day): **Simple** (default, flagged for the owner) keeps the rail's width and
  shows only the Core / Enablers rows, two portraits across; **Full** widens the rail, its header and the tab by
  `--lby-guide-w` (2x) to the LEFT and adds the tagline + write-up. The switch is a **Detailed / Simple** button at
  the foot of each OPEN card (a header pill came first; the owner moved it onto the card). Stored in
  `localStorage['ascent.guidesMode']` (try/catch). Full covers the End Turn diamond and part of Refresh while open,
  which is why Simple is the default. Text is the same size in both modes (owner: "the text should be the same size
  as the full size"); long titles ellipsize.
- **Look**: each card wears its `iconCard`'s art in a round gold frame with a tribe-ink rim (the Ale line wears Golden
  Ale, `wo_mine`), its tribe name(s) in the tribe's ink (`tribeInk`: `--t-<tribe>`, Dragon coral `#ff8a6a`, Neutral
  soft gold `#e8c27a`, the rune cards' values), and a thin left tribe bar + faint wash. No tribe group headings
  (owner: "we reference the tribes in the card"); data order keeps a tribe's builds adjacent. Titles drop "line".
- **Portraits** are the real compact board `Card` at board size inside a `transform: scale()` wrapper. Sizing the
  card down through `--ccw` (the first cut) left the milestone-framed stat coins, which are fixed px, at full board
  size (owner: "the stat bubbles are messed up size"). The slot reserves the frame's measured overhang (0.29 above,
  0.21 below, 0.10 / 0.09 sides, as fractions of card width) so labels and rows never sit under a crest or coin.
  Hover = the card's own `.cardref` chain (incl. `useFitRefPopup` placement from #1995). Card names in the Full
  write-up are hoverable too (`GuideCardLink`, the same `.cardref` markup + measured pass).
- **Centre on expand**: when a card opens, the list scrolls (smooth; instant under reduced motion) so the card is
  centred, or top-aligned if taller than the rail. Measured once on the fold's `transitionend` (400 ms fallback).
- **Tuner**: 🪑 Lobby Rail gets Rail width (1.3) and a Guides group: Expanded width (1.55), Full text size (1.6), Full
  portrait size (0.6), Simple portrait size cap (0.5).

- **Wider rail (same PR, owner ask)**: the base rail grows RIGHT by `--lby-wgrow` (🪑 Lobby Rail → Rail width, 1.3)
  into the room beside it, out into the window's side margin past the 16:9 stage, clamped 10px short of the window
  edge (`--lr-right` / `--lr-w` in `.lobbyrail` + `.lobbyrailhead`, styles.css). Its left edge never moves. On a 16:9
  or narrower window there is no margin, so it only takes the stage's own right gap. Gem name / health text went up
  (1.3 -> 1.42, 1.32 -> 1.42); rows keep their height. Full's multiplier became 1.55 so its left edge is unchanged.
- **Simple = 3 portraits across**: a hidden probe row (a real row's insets + gap, one board-width card box) is read by
  a ResizeObserver on the list (window resizes only) and the fitting scale is written onto the list as `--lgu-fit`;
  CSS uses `min(cap, fit)` (cap = 🪑 Simple portrait size, 0.5).

## Performance

All animations are one-shot: the view fade (opacity + transform), the Full widen / narrow (`scaleX` from the old
footprint, origin the right edge, plus a translate on the tab and header), the chevron turn, and the fold
(`grid-template-rows` 0fr -> 1fr; no height measured). Card views are built once per open guide and stabilized with
`stabilizeViewMap` / `stabilizeRefMap`, so the memoized `Card` holds across run updates. No per-frame layout reads.

## Combat

The guides ride the rail, which slides away when combat stages, so they are unavailable in combat and come back on
the view they left. The tab gets the same `.app.staged` slide + pointer-inert treatment (R-PRESENT-31's rule).
