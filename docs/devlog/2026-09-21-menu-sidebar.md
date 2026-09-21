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
