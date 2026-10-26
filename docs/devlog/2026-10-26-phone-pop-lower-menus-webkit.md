# 2026-10-26 — Phones: a lower, smaller hand pop (R-PHONE-POP-01) and the menus in real WebKit (R-PHONE-MENUS-02)

**Owner (2026-10-26), after the phone captures:** "Generally looks really good, I think the hand pop still goes a bit too
vertical is really my biggest gripe. How about the menu screens? Do they all look good". On the first captures of the
lower pop: "The hand pop location is better but needs to be a bit larger".

## 1. The hand pop (R-PHONE-POP-01)

`touchInput.ts popGeometry`: the popped card's FOOT now stays on the resting hand row's own foot (the untransformed
card's extent, plates included; never below the run's foot line, `PHONE_FOOT_FRAC`), instead of lifting to just above
the gesture strip. Its height is 0.57 of the safe height (was 0.68). Measured in WebKit (iPhone app and Safari sizes) and
Chromium (Pixel 8), as a share of the screen height:

| | top | foot | height |
|---|---|---|---|
| main | 0.29 (over the Shop row) | 0.92 (~30 pt above the edge) | 0.63 |
| first pass (0.54) | 0.48 | 0.98 | 0.50 |
| shipped (0.57) | 0.45 (just below the Shop row, 0.452) | 0.98 (~8 pt) | 0.53 |

0.60 (the coordinator's first guess) put the top at 0.42, over the Shop minions' stat badges. Both numbers are DEV tuner
values (`phonePopConfig.ts`, the "Phone hand pop" panel: Pop height, Foot lift), read on each press. The full-res art swap
(#2312) is unchanged.

## 2. The menus in real WebKit (R-PHONE-MENUS-02)

Every menu screen captured in Playwright WebKit (iPhone 15 Pro, Home Screen size) and Chromium (Pixel 8) from a prod
build (`VITE_PERF_BENCH=1`, no dev overlays; network off except Google Fonts). Fixed, phone-only (`touchUi.css`, keyed on
`html[data-touch-ui][data-touch-small]`; desktop never matches):

- **Compendium cards ~3x too big in WebKit** (one card filled the gallery). `.book` was enlarged with CSS `zoom`, and
  WebKit zooms a registered length (`--ch` / `--cw` / `--ccw`, `@property` in styles.css) a second time inside a zoomed
  subtree, both where a chain re-declares it and where a property uses it. The book now grows by `scale` (it lays out at
  the same divided size, so Chromium draws the same). The lifted search field already measures its containing block's
  scale (`touchKeyboard.ts place`).
- **Sidebar plaques overlapping** (LIVE GAMES over SETTINGS) once Collection is in the rail: `.msb-nav` grows to its
  content (`flex: 1 0 auto`) so the column scrolls instead, and the rail's gaps tighten so it fits without scrolling on
  the reference phones. **LEADERBOARD lost its last letter** to the plaque's clip: a hair less tracking and icon gap.
- **Title column into the footer**: SETTINGS ran into Report a Problem, and with a saved run plus Collection the column
  ran off both edges. It centres 50 px above the middle and steps down a size at 5 and 6 plaques (`:has()` rules inside
  the touch media query, so desktop never evaluates them).

## Gotchas

- Playwright WebKit on Windows draws the hero select backdrop (a `filter: blur` full-screen `::before`) as flat beige and
  the hero power line in a serif; Chromium draws both as designed. Not changed: unverified on a real iPhone.
- `getBoundingClientRect` inside a zoomed subtree reports different coordinate spaces in WebKit and Chromium; compare
  WebKit layouts by screenshot or ratios, not raw rects.
- Any other menu card under a CSS `zoom` (the card tiles of Career, Leaderboard and Recent Games inside `.lbpage`'s
  `--touch-p` zoom, the Versus seat card inside `.mpbox`) has the same WebKit exposure. They need backend data to render
  and were not captured here.
