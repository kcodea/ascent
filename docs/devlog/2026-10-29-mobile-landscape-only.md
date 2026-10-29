# 2026-10-29: phones always play in landscape (no rotate step)

Owner: "Make it so mobile only loads in landscape so it doesn't require a rotate". Rule R-PHONE-SIDEWAYS-01.

## What changed
- **The rotate prompt is gone.** A phone held upright plays the landscape game turned a quarter turn clockwise
  (notch on the left of the game). Turned to landscape it renders as before. Tablets still play upright, letterboxed
  (R-TOUCH-ROTATE-01). Desktop is untouched (nothing installs off a phone).
- **`stage.ts`** fits a turned phone as the same phone in landscape (sides and safe-area insets swapped), then adds
  `translateX(pw) rotate(90deg)` on `#stage` (one transform, set on resize/rotation only). On the page-scale path the
  meta viewport width is the layout HEIGHT (the upright document's width) and the scale snaps to it.
- **`sideways.ts`** keeps the whole game in its landscape frame while turned: it wraps, once and on phones only,
  trusted event coordinates (`clientX/Y`, `x/y`, `pageX/Y`, `movementX/Y`, Touch), `getBoundingClientRect` /
  `getClientRects`, `elementFromPoint(s)` and `innerWidth/innerHeight` (swapped). Events the game builds itself
  (untrusted: the long-press `contextmenu`, replayed `pointerout`) are already in the game frame and pass through.
  stage.ts reads the real window size through `realInnerSize`. Each wrapper is one boolean check while not turned.
- **`orientationLock.ts`** (Android): the first `pointerup` asks for fullscreen then `screen.orientation.lock('landscape')`;
  refusals are silent (the turned render stays), and it re-arms when fullscreen is left. iPhone has neither API.
- **`touchKeyboard.ts`**: while turned, the lifted text field is placed from the visible viewport mapped into the game
  frame; `applyStage` holds the fit while a text field is focused on a turned phone (the keyboard would otherwise
  shrink the game's width).
- **`index.html`**: an inline head script sets `data-sideways` before first paint so the boot splash comes up turned.
- The manifest already had `"orientation": "landscape"`.

## Verification
`npm run phone:sideways` (new): production build, WebKit iPhone 15 Pro upright + landscape, Chromium Pixel upright +
landscape. Real input: a tap on a Shop minion opens Inspect (WebKit + Chromium); real CDP touch drags buy and play a
minion and a real long-press opens the emote menu beside the portrait (Chromium, upright and landscape). Headless
WebKit cannot drive a card drag to a drop in either orientation (pre-existing harness limit), so its drags are a note.
Chromium idle Shop frames: p50 4.2 / p95 4.3 ms upright and landscape alike; a wrapped `getBoundingClientRect` ~1 us.

## Limits (honest)
- iOS cannot lock orientation from a web page; an iPhone held upright always uses the turned render. The on-screen
  keyboard (sign-in) comes up in portrait, i.e. sideways relative to the game; the field still lifts beside it.
- Android fullscreen + lock is verified as REQUESTED only; headless Chromium cannot rotate, and its element
  fullscreen under device emulation breaks the emulated page scale, so the harness records the calls instead.
- WebKit's `getBoundingClientRect` inside CSS `zoom` (title menu, Esc panel, Inspect) is off in BOTH orientations
  (pre-existing); the turned frame inherits it unchanged. Real taps there still land (the browser hit-tests).
- Not yet seen on a real iPhone: WebKit layer memory under the rotate transform (no scale in it, so it should not
  hit the R-TOUCH-RUN-MEMORY-01 scale blow-up, but only the device can prove it).
