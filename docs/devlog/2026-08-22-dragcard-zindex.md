# 2026-08-22 — Dragged cards ride above the board furniture (portal to body)

Owner report: a card dragged across the board slid **behind** the hero portrait, hero power button and rune
badges. The floating `.dragcard` lived inside `.app` (`position:relative; z-index:1`), so its `z-index:115` was
trapped in app's stacking context. Root-level furniture — the `.statusbar` at `z-index:40`, which holds the
hero portrait, hero power and rune badges — painted **over** the whole `.app` subtree, dragcard included. (The
in-app buttons at z-41 — freeze/reroll/tavern/end-turn/gold — the dragcard already cleared, since it shared
their context at 115; that's why only the statusbar-hosted furniture showed the bug.)

**Fix:** `createPortal` the `.dragcard` to `document.body` so it escapes `.app`'s context. At the root its
z-index 115 beats the z-40 furniture (and the z-41 in-app buttons) while still sitting below the modal overlays
(460+). It's `position:fixed`, positioned in viewport coords by the rAF, and its layout vars (`--u`/`--ccw`/…)
are defined on `:root`, so the DOM move changes nothing but stacking. One comprehensive fix — lifts dragged
cards above every board element at once, not selector-by-selector.

Verified: typecheck ✅, build:web ✅. Confirmed on the live DOM that the dragcard renders under `<body>` and
all `.dragcard` CSS is self-scoped (no `.app`-ancestor rules that the portal would break).
