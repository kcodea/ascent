# 2026-10-26: Phone menus get phone layouts, batch 1 (R-PHONE-MENUS-03)

**Owner (2026-10-26, iPhone, Netlify 792caa34a):** "The menus are almost all completely unusable on mobile." Then, to
clarify: "No the menus just aren't fit to work on the screen size it's not that they literally don't work. We need a
better mobile ui for the various menus". Taps did work (the clarification confirmed it). The problem was the layouts.

## Why the old phone menus failed

Each phone menu page was the DESKTOP page with its content zoomed by `--touch-p` (2.1, touchUi.css). The zoom reflowed
the desktop grids into a box about a third of their designed width:
- the Leaderboard's player column collapsed to nothing, so names vanished;
- one Career or Leaderboard row filled the screen;
- the Collection category tiles spilled their names;
- captions read at 5-7 pt.

WebKit also double-zooms the registered card lengths inside a zoom (R-PHONE-MENUS-02).

## What changed

New `packages/ui/src/phoneMenus.css`, imported after touchUi.css:
- **Keyed on the phone page scale.** Every rule starts `html[data-touch-ui][data-touch-small][data-page-scale]`. A
  desktop never takes the page scale (`stageModeFor`), so desktop is pixel-identical. `phoneMenus.test.ts` checks every
  selector for that prefix.
- **Point units, no zoom.** `--pt` is one screen point in layout px (`--touch-inv-s`). Every size is written in points, so
  a 12 pt label is 12 pt on every phone. The only zoom in the file resets the desktop zoom to 1.
- **Batch 1 covers:**
  - **Rail.** 168 pt wide, 35 pt plaques with 12 pt labels, fits the height, chips at the right edge.
  - **Title.** Plaques and the Solo/Duo switch are finger-sized; Report a Problem is a button.
  - **Leaderboard.**
    - Flat podium cards above 52 pt one-line rows.
    - Your row is pinned to the foot.
    - The Solo/Duos tabs are finger-sized.
  - **Career.**
    - A one-row stats strip.
    - Match History (44 pt rows, a scroll fade) beside the open match, which now shows whole.
    - Seasonal Ranked and the trends below.
  - **Collection.**
    - Sideways chip rows (categories and filters) with edge fades; the picked category scrolls into view (the only JS
      change, a no-op on desktop).
    - A 3-across grid, with the chests stacked in a slim side column.

## How it was checked

Captures come from a prod bench build in Playwright WebKit (iPhone 15 Pro, Home Screen size, safe area 59/59/21) and
Chromium (Pixel 8):
- The Leaderboard and Career read the LIVE backend read-only: GETs only, and every write and auth call is aborted.
- The viewed Career's runs are a 30-game fixture served for `run_history`.

A fresh blind critic (screenshots only, against Hearthstone's mobile menus) ran six rounds:
- Round 1 failed four screens: clipping, tiny toggles, rail overflow, density.
- Round 5 passed four of the five; the iPhone podium cut "PLAYED", which round 6 fixed.

## Gotchas

- Playwright's `touchscreen.tap` does not activate buttons in Windows WebKit. The capture script dispatches pointer
  events plus `click()` on the element, as `phone:webkit` does.
- Pages inside a zoomed column (the title's `--ui-zoom`) divide their point sizes by that zoom.
- Still on the zoomed desktop layout (batch 2): Recent Games, Live Games, Friends, Compendium, Settings, Patch Notes,
  Versus, Practice, the Ranked Duos party, hero select, end screen, sign-in.
