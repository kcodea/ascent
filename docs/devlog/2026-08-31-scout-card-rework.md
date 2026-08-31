# Scout card rework (opponent scouting report)

**2026-08-31** — reworked the lobby rail's hover/pin scout card into a bigger, self-contained **scouting
report**, added a `🔎 Scout Card` dev tuner, and changed how it opens.

## What shipped
- **Contents:** shop tier, gilded units (triples), dominant tribe **+ count**, three **rune sockets** (dotted
  circles that fill with rune art), and a **titled fight-history table** (ROUND / VS / OUTCOME / DMG) — each row
  showing the round, the foe's **portrait**, WON/LOST, and outcome-coloured damage with a blast icon.
- **Interaction:** left **or** right click a seat pins the card; clicking a different seat switches to it;
  clicking anywhere outside closes it (Escape too). The corner ✕ is gone.
- **Tuner:** `🔎 Scout Card` (`scoutCardConfig.ts`) drives everything via `--sc-*` vars with CSS fallbacks that
  mirror the shipped defaults, so production paints correctly with no JS. Sizes are multipliers of baked base
  measurements; a colour dial exists per component (bg, frame, dividers, name, hero line, stat values, labels,
  rune socket) plus three **outcome colours** (won/lost/drew) that drive the result text, damage and portrait
  ring together.

## Non-obvious things (so a future session doesn't re-derive them)
- **The card is `createPortal`'d to `<body>`.** It was originally a child of `.lobbyseat`, but the rail's
  `overflow`/backplate could clip/swallow it. Two consequences the portal creates:
  1. **It cannot inherit the rail's `--lu` / `--lrow` / `--lfont`** (those are defined only on `.lobbyrail`),
     so every `calc(... * var(--lu))` collapsed and the portrait *images* fell back to natural size ("utterly
     massive"). Fix: `.lobbyscout` re-derives `--u/--lu/--lrow/--lfont` from the same globals.
  2. **React synthetic events still bubble through the REACT tree** (parent is `ScoutCard` → the seat), so a
     click *inside* the portaled card reached the seat's `onClick` and toggled the pin shut. Fixed with
     `stopPropagation` on the card; the native `mousedown` document handler (used for click-outside) is
     unaffected because it fires on the real DOM tree where the card lives under `<body>`.
- **Sim additions (small, additive):** `SeatIntel.topTribeCount` (the count behind the dominant tribe —
  `boardIntel` already computed it and threw it away) and `SeatResult.foeHeroId` (so the log can show the foe's
  portrait). Both in `packages/sim/src/lobby/runLobby.ts`.
- **Fight log is a CSS grid with `display: contents` rows**, so a header row of column titles lines up over the
  data rows' cells.
- **Odds were declined:** combat is a deterministic seeded sim, so a past fight has one result, not a
  probability; a real win-% would need Monte-Carlo re-simulation and the past boards aren't stored anyway.
