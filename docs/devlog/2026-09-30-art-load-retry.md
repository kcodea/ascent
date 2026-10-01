# 2026-09-30 — Failed art loads retry (a friend's shop of blank ovals)

Owner report with a screenshot from a friend on the Netlify build (`v0.1.0 842413357`, before the pop-in fixes
#1866 / #1868 / #1870): round 12, tier 6 shop. All six Shop minions show **pale blank ovals** (frame, stars and
stats render; the art is missing) and the Shop spell slot shows only its frame. The warband and the hand are fine.
*"why did this happen?"*

## Diagnosis

Those six images (and the spell's) **failed to load, and nothing ever asked for them again.**

- In `842413357` the card art is a plain `<img className="artimg" src=…>` with no `onError`. A failed request
  leaves a broken image; with `alt=""` Chrome paints nothing, so the oval shows the pale window behind it. React
  keeps that element until the card leaves the Shop, so the hole lasts for the rest of that shop.
- Only the Shop was hit because only the Shop had **new `<img>` elements at that moment**: a roll (or the turn's
  new shop) mounts fresh elements, keyed by card `uid`. The warband and hand elements had loaded rounds earlier
  and were untouched. Every Shop image failing together points at the connection, not the files: a dropped or
  congested connection, a mobile hand-off, or Netlify answering an error.
- That build made a blip much more likely to land on a Shop image: no `_headers`, so Netlify sent
  `max-age=0, must-revalidate` and a new element had to ask the server again even for art it already had (722
  revalidations in one warm visit, see `2026-09-29-art-pop-in.md`). Under `must-revalidate`, a failed revalidation
  is an error, not a stale copy.

**Current main still had the same hole, one level down.** `decodeImage` settled on failure or timeout and the queue
then reported the URL **ready**; an `<img>` that errored called `markArtReady` too. So a failed image was never
hidden: it faded in as a broken picture and stayed for the session. Hashed art is `immutable` since #1866, so a new
element for art already fetched no longer goes to the network, which makes this rarer, but any image whose fetch
failed (during the boot gate, or in the `idle` lane) stayed broken.

## Confirmed on the prod build

A small Node server serving `apps/web/dist` that answers **503 to every image for N seconds from the page load**
(no-store, so every run is a cold fetch), driven by headless Chrome over CDP; it samples every visible `<img>`:
loaded, broken and VISIBLE (a hole), or hidden over a placeholder.

| Build | Blip | Just after the boot gate | 20 s later (blip long over) | After `online` |
|---|---|---|---|---|
| main (before) | 5 s | gate opens in 0.6 s (every image failed fast); 4 of 4 title images broken | **4 of 4 still broken**; server served 0 images | n/a |
| this branch | 5 s | gate holds 17 s (retries), 4 of 4 loaded | 4 of 4 loaded | n/a |
| this branch | 30 s | every try failed: 4 of 4 hidden (placeholder) | 4 of 4 hidden, none broken | **4 of 4 loaded** |

The "before" title screen shows the broken-image icon on the logo, the rank crest and the two corner buttons.

## The fix

- **`assetQueue.ts`** — a key requested with `retryDelays` that fails is not settled: it waits out the next delay
  OFF the pipe (no slot held), then re-enters its lane through the same concurrency cap. After the last delay it is
  `failed`: `settled` (the loading gate stops waiting) but never `ready`. `fail(key)` lets an on-screen element
  report a failure (a ready key goes back to backing off); `retryFailed()` re-queues every failed key with a fresh
  budget and cuts any backoff short. Subscriptions are now live for their lifetime (a key can flip ready, pending,
  ready). A key without `retryDelays` (the SFX bank) settles on failure exactly as before.
- **`artPreload.ts`** — art uses `ART_RETRY_DELAYS = [1000, 3000, 8000]` (4 tries, about 12 s). `decodeImage` now
  REJECTS on a failed load or a 15 s timeout. Tries 1-3 use the same URL (the cache answers if the bytes made it
  elsewhere); only the last appends `?retry=…` (never on `data:` / `blob:` URLs), and an element then reloads from
  that URL. Giving up logs one `console.warn` (no asset telemetry channel exists). `online` and `visibilitychange`
  (visible) call `retryFailedArt()`.
- **`useArtFade`** — an `<img>` that errors is NEVER marked ready: it hides (`art-pending`), shows the dark
  `.art-wait` placeholder, reports `queue.fail`, and once the pipe has the image re-sets its own `src` and fades in
  on its load. A URL that gave up keeps the placeholder.
- **Every other `<img>`** (icons, buttons, the title logo): one capture-phase `error` listener on the document hides
  the element (`.img-retrying`, static opacity 0), sends its URL through the same pipe and backoff, and re-sets its
  `src` when the pipe has it. Elements wired through `useArtFade` are skipped (a `WeakSet`).

Perf: nothing runs unless an image fails; no timers or listeners per card; retries share the 6-slot pipe.

Trade-off: a blip during boot now holds the loading gate while the retries run (17 s for a 5 s blip in the table)
instead of opening on a menu of broken images.

## Not covered

- CSS `background-image`s (the title backdrop, boards) are not `<img>`s and do not retry.
- The card frame and hand plate fall back to their SVG look for the session on ANY error (`frameOk` /
  `cardPlateAvailable`), a 404 guard that a network blip also trips. Unchanged here.

Oracle: R-PRESENT-28. Tests: `artRetry.test.tsx` (new), `assetQueue.test.ts`, `artFade.test.tsx`.
