# 2026-10-27: Phone menus batch 2: Recent Games, Live Games, Career, Settings, Friends (R-PHONE-MENUS-04)

**Owner (2026-10-27, iPhone, landscape):** "menu navigation is really bad. you cannot see anything in careers/recent games
etc. they are completely unusable." and "the settings menu is pretty ugly, but not unusable. just not good".

## What was wrong

Captured in Playwright WebKit at 844 x 390 (prod build) before the change:
- **Recent Games** was still the desktop page: desktop pins the list + open game to the window under a 124 px chart, so on
  a phone the list was a ~135 pt sliver, every row's name was cut, and the open game was mostly off the bottom with no
  way to scroll to it (`overflow: hidden` on the scroller).
- **Career** (batch 1) worked for Match History, but the Heroes grid, the Practice game's lobby, the empty states, the
  trends' captions and Seasonal Ranked were still desktop px (4-6 pt on the glass).
- **Live Games** rows were desktop px: 4-6 pt names and a tiny Watch.
- **Settings** was the desktop panel zoomed: rows of every width, notes beside their buttons, and a sticky Done that
  covered the list.

## What changed

All in `packages/ui/src/phoneMenus.css` (the BATCH 2 sections), same contract as batch 1: every rule keyed on the phone
page scale, sizes in points, no zoom, static (the one animation touched is the open game's rise-in, switched off).
- **Recent Games:** the page scrolls as one column. A one-line summary (the four numbers and the most-played hero; the
  placement chart stays on desktop), the tabs and hero chips on one row, then the list (2 parts) beside the open game
  (3 parts). List rows are two lines (name + hero, then the date), the division shows in the open game only.
- **The open game (Recent Games + Career):** placement and hero across the card, Replay / Career on their own row, the
  board, runes and facts under them. The lobby tiles (practice standings) go two across.
- **Career:** Heroes four across; empty / loading states; Seasonal Ranked is the crest beside division, MMR, bar; the Ranked
  Duos teams sit under it beside the trends; trend captions at 11 pt.
- **Live Games:** one 56 pt row per game (portrait + name + hero, division, round + watchers, Watch).
- **Settings:** one sheet (560 pt wide, the screen's height), full-width rows with the note under each, 44 pt controls,
  Done pinned at the foot. Same panel, plates and switches; layout and sizes only. Applies in a run too (the page scale is
  on there as well), which is the same Settings.
- **Friends:** the guest card through the ladder pages' empty state rules; friend rows at 52 pt (not verified with a
  signed-in account: no Claudebot login was used).

## How it was checked

Captures: a scratch Playwright WebKit script (landscape iPhone UA, touch, DPR 3, safe area faked through `#safe-probe`) at
844 x 390 and 667 x 375. The live backend was read ONCE (GETs only, every write, auth, RPC and realtime aborted) and every
response recorded to fixtures; every later run replayed them offline (the backend was answering in 15-30 s that night).
The viewed Career's `run_history` and `duos_teams_of` are fixtures.

## Gotchas

- Headless WebKit can leave a one-shot CSS animation at time 0 for seconds on a busy page (the open game's `menu-rise`
  read opacity 0 in captures). The phone path now skips that rise-in.
- `HeroFilterChips` detects overflow by the row WRAPPING: keep `.rg-filters` `flex-wrap: wrap` or it never drops chips.
- The Esc menu's touch rules use `button.pressable:not(.escmute)`; a phone override needs `button.<class>.pressable` to win.
- Not in this batch: Compendium / Rules (usable, small captions), Patch Notes (readable), Versus room list, Practice
  options (usable), the Ranked Duos party room, hero select, end screen, sign-in.
