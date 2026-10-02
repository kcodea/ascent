# 2026-10-02 — Loss cap uncapped from round 15; round + max damage moved above the lobby rail

Owner ask: "change the damage cap rules - on turn 15 it should become uncapped. move the Round text to be above the
lobby rail. move the max dmg next to the new round location above the rail. make both larger. add a mouseover
tooltip for the heart explaining this means the max dmg for that round. dont let these elements move anything else
in the game".

## What changed

- **Loss cap.** `lossDamageCap` (packages/sim/src/reducer.ts) is now 5 (rounds 1-3), 10 (4-7), 15 (8-11),
  20 (12-14), then uncapped from round 15 (it was 20 through round 15, uncapped from 16). Only the normal game's
  table moved: the Gauntlet's `lossCaps` are untouched. Every reader already goes through `roundLossCap` /
  `lossDamageCap` (fight, lobby settle, odds probe, HUD, announcer, fight recap), so nothing else needed rewiring.
  Oracle R-LOBBY-10, GAME-RULES "Health & economy", and the two rules-wiki answers carry the new numbers.
- **Rail header.** "Round N" and the heart + max damage moved out of the rail's top row into `.lobbyrailhead`, a
  SIBLING of `.lobbyrail` rendered by `LobbyPanel`. It cannot be a child: the rail is a scroll container and clips
  anything outside its box. It is absolutely positioned from the rail's own `right` / `width` / `top` expressions
  (as `bottom`), re-derives the rail's `--lu` / `--lfont` units, so the Lobby Rail tuner moves both together, and
  slides off with the rail on `.app.staged`. Font 20 x `--lfont` (was 11 / 10). "8 left" stays in the rail row,
  now centred on its own; the row keeps its height.
- **Tooltip.** First built on the small `.gtip` / `data-tip` bubble; the owner's screenshot found it unreadable
  ("fix this tooltip, it's unreadable": pale, low contrast). It now uses the game's standard HUD tip panel,
  `.herotip` (the hero-power / Equipment hover: opaque dark slate, gold hairline, gold title, cream rule text), as
  the chip's sibling opened by `.lobbymax:hover + .lobbymax-tip` (the opponent-power tip's pattern, and `.tt-on`
  for touch). Only its anchor is new: above the header, right-aligned to the chip, so it stays on screen and never
  covers "Round N". Title "Max damage this round", rule "A loss this round costs at most N Health."; uncapped,
  "No max damage this round" / "A loss deals full damage." A parallel branch (`feat/unify-tooltips`) is moving
  every tip to this same look, so nothing here is a new style. The label reads "No cap" when uncapped, as before.

## Proof it moves nothing

Bounding boxes of every element down to depth 5 under `.app` (233 boxes, the new header excluded) were captured in
the shop before the change and compared after, at 1920x1080 and 1366x768. Identical, apart from the in-rail
`.lobbyhead` children (expected) and the Refresh button's sheen bar, which is mid keyframe animation. The rail rect
is 1703.25,153.7,198.56,655.44 at 1920x1080 and 1211.53,109.3,141.2,466.09 at 1366x768 in both. Nothing visible
intersects the header (overflow clipping honoured) at 1920x1080, 1366x768, 1280x1024 (letterboxed stage) or
2560x1080 (pillarboxed stage).
