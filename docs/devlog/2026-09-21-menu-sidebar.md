# 2026-09-21 — Menu sidebar on the ladder pages + Mode screen; wider Career side columns; navy Mode backdrop

Owner ask (two screenshots): the Career page at ~2000px had a lot of dead space right of the 7 match cards
with narrow side columns; and every ladder page needed a way to reach the rest of the menu without going
back to the title. Three things shipped together:

**Menu sidebar** (`packages/ui/src/MenuSidebar.tsx`, `.msb` / `.sbbtn` in `styles.css`). A 240px column
pinned to the left edge of Career, Leaderboard (Rankings), Hall of Champions, Recent Games, and the title's
mode picker + Learn hub. Back sits top-left (the page's own `.lbback` pill; each host keeps its own Back
semantics — a Career opened from the Leaderboard still backs out to the Leaderboard; the picker backs out to
the main menu, the Learn hub to the picker). Below it, vertically centred in the remaining height, the main
menu as compact `.menubtn`-language plaques (navy plaque, gold rim, 4px hard edge, sheen on hover, press
compresses; no hover slide, no seat-in stagger) in the title's order: Play · Career · Leaderboard · Hall of
Champions · Recent Games · Settings, with the title's exact icons + labels (`menuIcons.tsx` now holds the
Crest / helm / trophy glyphs both surfaces use). The current screen's plaque wears the title's blue
`.active` treatment and `aria-current="page"`. Fill: `linear-gradient(180deg, #1f4380, #14305c 40%,
#0c1d3d 72%, #070f22)` with the gold rim (`border-right: 2px rgba(196,160,92,.55)` + inset hairline) and a
soft inner blue glow — leaves the navy band the page radial and the `.lb-panel`/`.cv2-panel` fills sit in.
Static; no looping paint. The host reserves the column with `padding-left: var(--sb-w)` (`.lbpage`,
`.modepick.sb-host`) and the sidebar is `position: absolute; left: 0; top: 0; bottom: 0` — no DOM
restructure, so `.lb-ladder .lbscroll`'s `margin: 0 auto` and the picker's `.mpbox` centre in the remaining
width. Sidebar z-index stays inside the page (≤ 470): the portalled tooltips (z 520) and card reveal still win.

**Store** (`store.ts`): `titleView: 'menu' | 'modes' | 'learn'` + `setTitleView` replace Title's local
`modePick` / `learnPick` (`tutorialPrompt` stays local); `openTitle` and `cancelPracticeSetup` reset it to
`'menu'` (the 2026-08-24 "Save & Quit lands on the main menu" rule, now in the store instead of a Title
effect); `titleView` joins the replay `SNAPSHOT_KEYS`. ONE navigation action, `goTo(dest)` with `dest ∈
menu | modes | career | rankings | hall | recent`, closes EVERY ladder page flag first (the same set
`startReplay` clears — the four pages are z-470 siblings that stack in DOM order, so a hop that only opened
a flag left the current page painted on top) and then opens the destination; a page destination leaves
`titleView` alone, so Back from that page returns to the view beneath. `openTitle` now also closes the pages
(Settings is reachable from a page, and its Save & Quit / Leave replay say "back to the main menu"). The
Settings modal moved from Game's local `menuOpen` to `settingsOpen` + `openSettings` / `closeSettings` so
the sidebar can open it anywhere; Game's Esc handler, gear button and Title's `onSettings` route through it.

**Career columns** (`.cv2-cols`): `minmax(300px, 1fr) minmax(0, 1270px) minmax(340px, 1fr)` (270/320 and
250/290 at the narrower steps), `width: 100%; max-width: 2390px; margin: 4px auto 0`. The centre is capped
at the 7-tile strip at the new **160px** tile cap (was 150) plus the banner's padding/borders, so a wide page
grows the cards to the cap first and then hands every further pixel to the side columns instead of leaving it
right of the 7th card; below the cap nothing changes. The 1700/1360/1100 breakpoints are now
`@container cv2` queries on `.cv2-page` (`container: cv2 / inline-size`), so they measure the width beside
the sidebar; the ladder pages' viewport tile steps moved 1400 → 1640 and 1180 → 1420 for the same reason.
NOTE: with `minmax(a, b)` tracks CSS Grid's "maximize tracks" step grows all non-flexible tracks EQUALLY, which
starves the centre — the sides must be `fr` (frozen at their minimum until the capped centre is satisfied),
which is why the ultrawide clamp lives on the grid's `max-width`, not on the side tracks.

**Mode screen**: `.modepick`'s background is the ladder pages' navy radial
(`radial-gradient(ellipse 60% 60% at 50% 50%, #24468a 0%, #0a1730 100%)`) instead of the dimmed title art;
the tutorial nudge and Practice options inherit it (they reuse the class).

Verified in the browser at 1920×1080 and 2560×1440 (vite on 5193, the live backend had no runs, so the card
row was measured with a synthetic 7-tile `.cv2-row`): 1920 → tracks 270 / 994 / 320, tiles 121px, 0px slack
right of the 7th tile; 2560 → tracks 477 / 1270 / 477, tiles 160px, 10px slack. Sidebar 240×full-height,
plaques centred, blue current plaque, gauntlet cursor from the global button rule. Tests: new
`MenuSidebar.test.tsx` (renders on each page, current plaque, `goTo` closes the stack, Back keeps the page's
own close, Settings flag, `openTitle` lands on the menu, no `[title]`, no `scrollIntoView`, no `lb-`/`cv2-`
classes); `Career.test` / `ladderPages.test` unchanged and green. Player-facing entry in `patchNotes.ts`.

## Review fixes (same day, same branch)

Three reviewers examined the build; what changed in response:

- **Back pulsed twice** on the four ladder pages (the sidebar's Back handler pulsed, then the page's `back`
  pulsed again — two copies of the clip on one tick). The sidebar's Back now carries NO sound: the host's
  `onBack` owns the click along with the close (the pages' `back` already pulses; Title's two picker/Learn
  `onBack`s now pulse too). Pinned by a spy test.
- **Laptop widths starved the Career cards.** With the sidebar's 240px, the old ≤1100 container stack point
  let a 1366 laptop hit ~51px tiles (250/290 side minimums + gaps in a 1126px page). The stack point moved to
  `@container cv2 (max-width: 1300px)` (≤1540 viewport): 1366 / 1440 / 1536 laptops get the single-column
  layout with the strip at the tile cap (measured 133 / 143 / 157px tiles); 1600 keeps three columns at 85px;
  1920 (270 / 994 / 320, 122.6px) and 2560 (477 / 1270 / 477, 160px) are unchanged. An icon-only sidebar rail
  under ~1600px would keep three columns on laptops instead — a design the owner has not seen, so it was
  not built; owner's call.
- **Sides at ~2000px are NOT wider** (300 / 340, exactly the old minimums; tiles 127px instead of 150). This
  is the budget, not a bug: at 1920–2245px the sidebar's 240px came out of the centre's dead space plus the
  card size, and the sides only grow once 240 + 60 + 300 + 1270 + 340 + 36 = 2246px of viewport exist. Left
  as built and flagged for the owner: the knobs are `--cv2-center-max` / the 160px tile cap (lowering them
  hands surplus to the sides sooner, at the cost of card size) or the ≥1700 side minimums.
- **Settings from a ladder page / the picker** showed "Save & Quit — Saves this exact moment…" with no run on
  screen. `EscMenu` now picks its primary action by where it opened: a replay → Leave replay (unchanged); a
  title surface with a page or picker view open → **Main menu** ("Closes this page and returns to the main
  menu"); the bare title menu → no primary section at all; a run → Save & Quit (unchanged).
- **The Play plaque's saved-run bubble** dropped BELOW the plaque (the shared `.lbpage [data-tip]` placement)
  and covered the Career plaque. `.msb .msb-item[data-tip]` (after the shared rules) places it to the RIGHT,
  vertically centred, with the pointer square showing its left vertex.
- **Short viewports**: `.msb-nav` is `justify-content: safe center` (a stack taller than the column aligns
  under Back instead of overflowing both ends), and under `max-height: 560px` the plaques compact (44px, 6px
  gaps, 14px labels) — measured at 1280×440: Back bottom 60, first plaque top 101, last bottom 395 of 440. Not
  a scroll container: `overflow-y: auto` would clip the plaques' shadows and the Play bubble beside the column.
- **Every hop re-faded the sidebar** (`.lbpage { animation: fadein }` on the remounted page; the title showed
  through it for 200ms). The store's `goTo` now stamps `navHopAt` (a `performance.now()`, self-expiring); a
  host that mounts within 400ms of it renders through `SidebarHost` with `.hop`, which turns the page fade off
  and fades only the content beside the sidebar (`.lbpage.hop > :not(.msb)`, `.modepick.hop > :not(.msb)`).
  Opening a page from the title or a row click carries no stamp, so those still fade as before.
- **HALL OF CHAMPIONS was 55px** against 54 for the rest: `.sbbtn { min-height: 56px }` (the two-line plaque's
  own height) — measured [56 × 6].
- **The picker's sidebar is `position: fixed`** inside `.modepick.sb-host` (the picker scrolls as a whole on a
  short viewport; an absolute sidebar scrolled away with the cards).
- Left as built (owner's call, flagged): Settings → Leave replay lands on the main MENU while the replay bar's
  ✕ returns to the page the replay was launched from — the button's own subtitle says "Back to the main menu".
