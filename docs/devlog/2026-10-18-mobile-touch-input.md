# Mobile touch pass 1: long-press, tap targeting, safe area, fill the screen (2026-10-18)

Owner (Kevin, iPhone, Home Screen app, landscape): "I added it to Home Screen and the camera line also lines up with
some ui elements and it's annoying", then, with a screenshot of a black bar down one side: "Make sure it fills the
screen too". He approved this first PR of fixes from the read-only mobile audit. Rules R-TOUCH-AIMTAP-01,
R-TOUCH-LONGPRESS-01, R-TOUCH-INSPECTACT-01, R-TOUCH-AUDIO-01, R-TOUCH-SAFEAREA-01, R-TOUCH-FILL-01,
R-TOUCH-WORDING-01, R-TOUCH-ROTATE-01.

## What shipped

- **Tap targeting** (`Recruit.tsx` aim effect, `touchInput.aimReleaseResolves`): a release resolves the aim when the
  pointer moved OR the press started after the aim armed. A finger tap sends no pointermove, so the old `if (!moved)
  return` left the power armed on a phone.
- **Long-press** (`touchInput.createLongPress` + `installTouchInput`): 350 ms inside the 10 px slop fires ONE synthetic
  `contextmenu` at the held element, so every existing right-click answers it (Inspect, the portrait emote menu,
  spectator mute, the rail scout pin). Nothing with a right-click of its own (hero card, rune offer) gets its hover
  face (`.tt-on` + a synthetic `mouseover`). The native Android contextmenu from a finger is swallowed, the release
  click is eaten, a fired hold blocks the drag (`longPressActive()` in `dragThreshold`), `navigator.vibrate(10)`.
  "Did a game handler take it" is read at DOCUMENT level, because `main.tsx` cancels every contextmenu on window.
- **Inspect Buy / Pick** on touch (`Inspect.tsx`, `inspectActionFor`): reuses the Discover's gold Peek pill.
- **Audio unlock** (`audioUnlock.ts`): pointerdown + touchend + click + keydown, kept for the page's life; resume on
  visibilitychange / pageshow / focus and on the context's own `statechange` to `interrupted`.
- **Safe area** (`stage.ts` + `styles.css :root`): the root cause was raw `env(safe-area-inset-*)` INSIDE the scaled
  stage, where the transform shrank a 59 px inset to about 21 px. Now `fitStage` takes the insets, fits the scale to
  the window less them (the box stays exactly 1920 x 1080 layout px), and `applyStage` writes `--safe-t/r/b/l` in
  LAYOUT px. `--gw/--gh` fit inside `--avw/--avh`.
- **Fill** (`--surplus-x/y`, `--edge-l/r/t/b`): corner HUD anchors on the real screen edge inset by its side's safe
  area; margin from a CAP (4K pin, resolution scaler) is kept so 16:9 desktop is unchanged at every size. Moved:
  gear / book / rules / version, title account card / menu / footer, menu sidebar + page padding, hero select Main
  Menu, Versus room top/controls, spectator plates, the lobby rail's growth clamp. `html` background is the backdrop
  navy. `windowSize()` uses the screen size in an installed phone app when it is larger than a (stale) innerWidth,
  and a rotation re-fits again at 150 and 500 ms.
- **Wording**: `isTouchDevice` / `touchText` / `touchWording`, `WikiEntry.aTouch`.
- **Rotate prompt**: phones only (`data-tablet` from stage.ts, shorter side >= 700 px); "device", not "phone".

## Verified

Headless Chrome 150 with `Emulation.setSafeAreaInsetsOverride`: iPhone 15 landscape 852 x 393 (island left, island
right, both), Android 915 x 412, iPad 1024 x 768, desktop 1920 x 1080 and 2560 x 1080. An audit script listed every
visible text / button element inside an unsafe zone: 0 on title, hero select, shop, combat, modes, career, Versus,
settings (only scrollable list rows reach the home indicator). Touch flows driven with real CDP touch events.

## Needs a real device

The owner's black bar is not reproducible in desktop Chrome (its innerWidth is always right). The stale-size guard
and the late re-fit are the fix for the likely cause. Also only on device: the haptic tick (iOS Safari has no
`navigator.vibrate`), iOS audio unlock after a call, and the iOS callout / selection suppression.
