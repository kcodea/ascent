# Match History and Recent Games: minions grow with the window (2026-10-23)

Owner report, with a screenshot of the Career Match History detail at about 2000px wide: "minion sizes are really
small here and in recent games. can you fix that?"

## Why they were small

The stage (`stage.ts`) only scales DOWN. At or above 1920 x 1080 the layout is the real window, so on a 1440p
screen the detail panel is ~1540px wide (Career) or ~1740px (Recent Games). The 2026-10-21 "one card size for every
detail board" rule pinned the board to a fixed `min(100px, ...)`, on the assumption that the stage always lays out
at 1920 x 1080. That holds below the design size but not above it, so the board sat at 100px in a huge empty panel.
The lobby tiles' mini portraits had a 40px cap for the same reason.

## The fix (CSS only, `styles.css`)

- The detail board's `--tw` is now derived from the LAYOUT VIEWPORT (`--lvw` / `--lvh`, which fall back to the real
  window when the stage is unscaled). Both pages still print the SAME card size at a given window (keeping the
  2026-10-21 ruling): it is the width the narrower host (the Career centre column, roughly the window less 1064px)
  gives 7 cards + 6 gaps of 0.2 + the 0.1 badge overhang each side (8.4 card widths). It is capped at 200px, and by
  the window height (112px at 1080 tall, +0.5px per extra px) so the Career still fits without scrolling. The host's
  own `100cqw` still bounds it, for a phone.
- The board's bottom padding shrank from `0.3 card + 6px` to `10px` (the badges end at the tile; the old padding
  was empty) and the side padding follows the badge overhang. This took the Recent Games detail's small scroll at
  1920 x 1080 away.
- `.lp-mini-m` may grow to 72px (was 40px); it fills its tile's seventh.

Measured on a seeded local profile (fake backend, Claudebot names):

| Window | Board card (before, after) | Lobby minis Career / Recent (before, after) |
|---|---|---|
| 1920 x 1080 | 100, 102 | 24 / 36, 24 / 36 |
| 2560 x 1440 | 100, 178 | 40 / 40, 47 / 54 |
| 1280 x 720 (scaled) | 67, 68 | 16 / 24, 16 / 24 |

At 1920 x 1080 the Career's centre column is width-bound: seven cards with their pill gaps in its ~860px board
are ~102px, and a 4-column lobby leaves 24px per mini. Making those bigger there would need a layout change (a
narrower game list or right column, or fewer lobby columns, which add height the no-scroll Career does not have).
Not done here; it is an owner call.

The minion art is the full card art (`artFor`, phone path through `phoneAssetUrl`), so the bigger tiles are not
upscaled thumbnails. Rule R-MATCH-MINION-SIZE-01 (persistence domain, next to R-GAME-RANK-01).
