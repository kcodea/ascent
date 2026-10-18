# 2026-10-18 — Touch UI scale: hit slop, Touch UI size, bigger menus and card views (desktop pixel-identical)

Owner (2026-10-18): "I want to make sure it's a AAA experience, seamless 1:1 from mobile to desktop", with the hard
requirement that desktop (mouse / fine pointer) stays pixel-identical. Follows #2149 (touch input + safe area).

## The gate

`touchUi.ts` writes `html[data-touch-ui="normal|large|larger"]` (plus `data-touch-small` under stage scale 0.5 and the
`--touch-*` vars) only when the device is a touch device (`(hover: none) and (pointer: coarse)`) AND the stage is
scaled (`s < 1`). It re-applies on every stage change (resize / rotation), never per frame. A mouse device never gets
the attribute or a var, at any window size. Every selector in `touchUi.css` starts with `html[data-touch-ui]`
(`touchUi.test.ts` fails on an unkeyed rule), so nothing in it can reach desktop.

## What the touch UI does

- **Hit slop** (`touchSlop.ts`, R-TOUCH-HITSLOP-01). A finger that lands on nothing interactive goes to the nearest
  control whose rect, grown to 44 x 44 screen px, contains the point; distance splits neighbours, then a button beats
  an info tip, then the smaller control. The press is replayed on the control (pointerdown / up / click) BEFORE
  touchInput's listeners, so tap = hover and long-press work on it too. Direct hits (controls, cards, the board, a
  `gauntlet_open` cursor) are never redirected; moving past the tap slop cancels the replay. One rect read per missed
  tap. `window.__ascentTouchResolve(x, y)` is the QA hook the audit measures effective targets with.
- **Touch UI size** in Settings (Display, touch devices only): Normal / Large / Larger, stored as
  `ascent.touchUiSize`, default Larger on a phone (shorter side < 600) and Large on a tablet. It drives `--touch-k`
  (HUD: 1 / 1.3 / 1.6) and `--touch-p` (menu pages: 1 / 1.35 / 1.8).
- **HUD**: the ? / book / settings squares, the shop's Tier / Freeze / cost pills (their own tuned transform with the
  scale term multiplied in place), the rail's guide tab, the Practice timer picker, combat Skip, hero select's Main
  Menu, finger-sized Settings slider tracks + thumbs; `--ui-zoom` (title menu, account card, Settings, title foot)
  multiplied by k.
- **Menu pages**: `.lbpage` children zoom by `--touch-p` (they reflow into the narrower box and scroll), the sidebar by
  `min(p, 1.4)` (so its plaques still fit the height), `.modepick` / `.heroselect` via `--hs-zoom`, with their width
  caps re-derived beside the wider sidebar. The mode picker home spread is capped at 1.15 on a phone and stays 1 on a tablet. Recent Games puts its sparkline on its own row. Career's stat tiles wrap.
- **Card views on a phone** (`data-touch-small`): Inspect x1.4 (raised), Discover / Choose One panel x1.7 with the
  banner zoomed back to ~1.1 so the height goes to the cards, the Runeforge as one composition x1.12 anchored low,
  the Peek pill to the right edge. The Discover entrance converts its fan offset with the row's measured scale on the
  touch UI (toStage unchanged everywhere else). The Ancients offer is excluded.
- **Buy drop zone** (R-TOUCH-BUYZONE-01): a finger drag from the shop buys below a line raised 6% of the box height
  above the midline (`touchBuyLine`). Mouse unchanged. Tap-to-buy from Inspect (#2149) kept.
- **Text entry** (`touchKeyboard.ts`, R-TOUCH-KEYBOARD-01): a focused text field is lifted (inline fixed style,
  restored on blur) to a 52 px bar along the bottom of the visual viewport, i.e. on top of the keyboard, 17 screen px
  text (computed 17 / s, so iOS never zooms). Focus never moves, so Enter / blur handlers are untouched. Bottom, not
  top: a search's results drop below its field and the sign-in panel stays readable above.
- **Hover guard** (`apps/web/hoverGuardPlugin.ts`, R-TOUCH-HOVERGUARD-01): build-time PostCSS. 413 of 432 `:hover`
  rules move into `@media (hover: hover)` (mixed selector lists split in place, plain half first). Kept: 19 hover
  REVEALS with no `.tt-on` twin (a finger may have no other way in). Decorative glows / pseudo-element layers are
  guarded even though they fade opacity. A mouse always matches the query; the test proves every stylesheet flattens
  to the same (selector, declarations) per selector in the same order.

## Verification

See the PR for the before/after tables (iPhone landscape both rotations with safe-area insets, Android 20:9, iPad) and
the 1920x1080 desktop pixel diff. Not reached: a "Haul" control (none exists in the codebase); 11 px text everywhere
on a phone (the card-art and composed screens top out around 8 to 10 px; see the PR).

## Follow-ups

- The lobby rail rows (~28 px on a phone) and the shop's equipment sockets were left at their size (no room); the
  slop covers them.
- Rail-row text and shop card stats are still ~4 to 6 px on a phone: a phone-specific shop layout is its own project.
