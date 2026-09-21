# 2026-09-21 — Social menu: five title plaques, a Losses tile, two patch-note buckets

Owner asks (2026-09-21, from four screenshots of the title, the ladder sidebar, Patch Notes and the Career
stats column): drop the Compendium link from the title; fold Career / Leaderboard / Hall of Champions /
Recent Games into one **Social** plaque that opens the Career page (its sidebar does the rest); promote
Patch Notes and Scene Builder to main plaques; add a **Losses** tile under Top 4 Finish; and re-sort the
patch notes into just **Balance** and **Systems**.

## What changed (`packages/ui` + the two skills)

- **`Title.tsx`** — `nav.titlenav` is now Continue (when saved) · Play · **Social** · **Patch Notes** ·
  **Scene Builder** (DEV only, same `import.meta.env.DEV` gate as before) · Settings. Social wears the Career
  helm (`IconHelm`, the same glyph the sidebar's Career plaque wears) and calls `openCareer()` — `careerOf`
  is already null on the title (`openTitle` spreads `PAGES_CLOSED`), so it is always your own page. Not
  `goTo('career')`: that stamps `navHopAt`, so the Career page mounted wearing `.hop` (page fade off, sidebar
  cut in hard) as if a sidebar hop had opened it (review 2026-09-21). Patch Notes wears the `clock` Icon →
  `openPatchNotes()`; Scene Builder the `anvil` Icon → `startSceneBuilder()`. The secondary row keeps Report a
  Problem · Balance Report (DEV) · Rewatch Last Game (when a replay exists); Compendium is gone from the title
  (still Tab / `toggleBook`, the store action is untouched). The unused `openRankings` / `openLeaderboard` /
  `openRecentGames` / `toggleBook` subscriptions left the component. The title's last two native `title=`
  attributes went in the review pass: Play-with-a-saved-run now carries "New run. Replaces your saved run."
  as a `data-tip` on a `.tn-item` wrapper (the plaque's own `::after` is its sheen), and the Continue row's
  discard button carries "Discard your saved run." / "Click again to discard your saved run." as its own
  `data-tip`; both bubbles sit to the RIGHT of their element on the sidebar's `.msb-item` rules (a bubble
  below the discard button painted under the Play plaque, since its hover `filter` + `transform` make it a
  stacking context). `.titleversion`'s build-date `title=` is the one left on the title (dev info, bottom
  corner).
- **`MenuSidebar.tsx`** — unchanged behaviour (Play · Career · Leaderboard · Hall of Champions · Recent Games
  · Settings, same Back semantics); only the header comment now says the title folds these into Social.
- **`styles.css`** — the `.titlenav > *:nth-child(n)` seat-in stagger gains a 7th seat (max today is 6:
  Continue + 5 plaques in DEV) so an extra plaque can never seat at delay 0. The `.pntag-*` hue rules are two:
  `.pntag-balance { --pn-c: var(--gold-lt) }` (the HUD's warm gold trim) and `.pntag-systems { --pn-c:
  var(--ink3) }` (the neutral label ink).
- **`careerData.ts`** — `CareerAggregates.losses`: the count of placed runs with placement 5–8, tallied in
  the same loop as `firsts` / `top4` (`if (placement <= 4) top4++; else losses++;`); a null placement (course
  / rift runs) counts in neither, exactly as `top4Pct`. **`Career.tsx`** — the left column is 1st Place Wins ·
  Top 4 Finish · **Losses** (skull icon) · Avg Placement · Favorite Tribe. Tests: `careerData.test.ts` (RUNS
  placements 1, 4, 7, 2, 6 + one null → losses 2; the empty shape) and `Career.test.tsx` (fixture 1st, 3rd, 7th
  → `'1'`; the tile order; the no-runs state `['0', '—', '0', '—', '—']`).
- **`patchNotes.ts`** — `PatchCategory = 'Balance' | 'Systems'`, `PATCH_CATEGORY_ORDER = ['Balance',
  'Systems']`. Every one of the 389 existing changes was re-bucketed by script: New Hero / Hero Change / New
  Card / Card Change / New Rune / Rune Change → Balance (209); UI / Info → Systems (177), except the three
  ranked-ladder entries read by hand and moved to Balance: *Leaderboard crests* (2026-09-21), *Rank screen: the
  demotion effect* (2026-09-21) and *Medal ranks: season 3 and the post-game rank screen* (2026-09-20). Header
  comment + the bucket definitions updated. **`PatchNotesOverlay.tsx`** — `CAT_CLASS` is the two classes.
  **Skills** — `ascent-content` and `ascent-gameplay` now name the two buckets in their patch-note
  instructions.
- Patch note prepended (2026-09-21, Systems: "Social menu"). The second of two identical *Career match
  history* patches (2026-09-21, pre-existing) was dropped in the review pass.

## Judgement calls (flagged for the owner)

Kept in Systems, though they brush the ladder: *Career: match wins by placement* (a Career page display
rule, not a rating rule), *Leaderboard rows* (a row redesign), *Title screen: your portrait, name and rank*
(shows the rank, changes no rule), *No ghost rematches* (lobby pairing, not ranked), *Quests are out of the
game for now* (not a card / hero / rune / spell). Easy to flip if the owner reads them the other way.

## Verified

`npm run typecheck && npm run lint && npm test && npm run build:web`; visual pass on a background vite
(1920×1080 and 1366×768): the five DEV plaques, Social → Career with the sidebar, the Patch Notes plaque's
overlay with only Balance / Systems tags, the five Career tiles.
