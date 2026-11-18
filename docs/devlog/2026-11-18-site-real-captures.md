# Landing page: real game captures

The site's eight capture slots and three mode stills were placeholders. They are now recorded from the game itself by
`apps/site/scripts/capture.mjs` (`npm run capture -w apps/site -- <slot>`).

How it works, for the next session that has to re-record one:

- The script starts the game's dev server itself with no backend address, opens headless Chrome at 1920x1080 with
  every non-local request blocked, and drives a fresh guest Practice game through `window.useGame` plus real mouse
  drags. Dev-only reducer actions open the moments (`devOpenRuneforge`, `ancientSetMeter`, the
  `ascent:cratefx-play` event for the chest).
- Playwright's own video recording needs a browser download we do not have, so frames come from the browser's
  screencast and `ffmpeg-static` stitches, crops and encodes them (poster jpg, VP9 webm, H.264 mp4).
- A screencast has no pointer, so the script draws the gauntlet cursor itself.
- Buying is a drag from the shop to the HAND zone, then a second drag from hand to board. A drag to the board does
  nothing.
- The Runeforge slot sits inside the forge's gold frame on the page, so its clip is cropped to the frame's inner
  window only.
- The Career chart has no guest data. `captureCareer.mjs` fills the career cache with made-up games (invented
  ratings and dates; boards and runes from real bot-played runs) and needs a dead local backend address to render.
  The README has the exact command.

Not done: the production deploy (still waits for the owner's go), and the absolute share-image address.
