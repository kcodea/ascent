# 2026-10-16 — Menu UI refinement (experiment branch `feat/menu-ui-refinement`)

Owner ask: "i want to do this work on one branch so i can compare to the current ui and see if it's an improvement".
Plan: `docs/ui-refinement-handoff.md` + `docs/reports/AAA game menu UI patterns.md`. Menu / meta screens only; nothing
in recruit, combat or the in-match lobby / Versus UI. One commit per workstream so any piece can be kept or dropped.

## What landed (in order)

- **WS-1 backdrop layer** (`MenuBackdrop.tsx`, mounted by `MenuSidebar`): every sidebar host paints a plate from
  `MENU_BACKDROPS`; the great hall is the interim art (sharp on Mode, pre-blurred + pre-darkened on data screens).
  `scripts/build-menu-backdrop.mjs <art> <name>` bakes both files into `apps/web/public/backdrops/`. Only a scene ->
  data change crossfades; coming back to the sharp hall cuts to it (the fade read as a flash on Career -> Play).
- **WS-2 rail + Play**: ASCENT mark = Home (replaced Back), Play first and gold, Progress / Community groups,
  Settings at the foot, a sliding selection bar. The **gold rule**: Play is the one bright filled-gold control
  (`--cta-*` tokens). Mode screen: one fixed grid (Play the big tile), "Last played" tag (`lastMode.ts`), the
  player strip across the top (`PlayerStrip.tsx`).
- **WS-4 / game card**: `GameCard.tsx` is shared by Career and Recent Games (placement once, band, hero, board strip
  on its own row sized to the badge minimums from #2120, runes, actions, one meta line with the rating change).
  Meta separators are a left rule, never a `::before` (a `.gtip` owns its pseudos; the dot collided).
- **Recent Games redesign**: summary strip, hero chips, and two layouts on trial behind a DEV toggle
  (`ascent.recentLayout`): A list, B split. Production shows A until the owner picks.
- **WS-5**: Leaderboard podium (same rows re-laid by CSS), own row `position: sticky`, an off-board standing pin;
  Hall of Champions hidden behind `hallFlag.ts` (`HALL_VISIBLE = false`, owner).
- **WS-3**: Gem plates for every non-Play button, lit-plate selected tabs, Compendium frame on hero panels.
- **WS-6 Collection**: unowned is dimmed, never blurred (supersedes 2026-09-28), silhouettes, how-to-get on tiles,
  category bars, rarity shapes.
- **WS-7 + transitions**: page enter (opacity + 10px, 225 ms), list stagger, press scale, hover-tick rate limit; the
  ranked confirm uses the pre-blurred hall instead of a live backdrop-filter.
- **Career**: chosen profile picture (needs `supabase/migrations/2026-10-16-profile-avatar.sql`; the client falls back
  without it), trends with depth (`careerTrends.tsx`), no stray scrollbars.
- **Practice setup** rebuilt on the hall with two art tiles.

## Non-obvious findings

- **Recent Games / Hall idle cost** was card keyword FX (wisp, fl-ring, ex-shard, wardglass) restyling ~240 elements
  every frame. A plain `animation-play-state: paused` lost to the FX rules' `animation` shorthand; the menu-board
  pause needs `!important`, like `.is-far`. Found with a CDP trace (`StyleRecalcInvalidationTracking | Animation`).
- **Blank frame Career -> Play**: `.titlescreen.covered` was cleared by an effect one frame after the page closed;
  it is now derived in render (`covered && pageOpen`).
- The refinement CSS must stay ABOVE the portrait-frames section of `styles.css`: `portraitFrame.test` reads from that
  section to the end of the file and forbids `@media` / animation there.
