# 2026-09-20 — Leaderboard, Hall of Champions + Recent Games polished to the Career page's standard

**Owner ask:** make the Leaderboard and Recent Games pages look *significantly* better — to the standard of
the new (in-flight) Career page: chunky readable banners, the ink/gold tokens, the circular hero frame, real
card tiles for boards, real rune emblems, clear headers, designed loading / empty / offline states.

"Leaderboard" was ambiguous — the title menu's **Leaderboard** button opens `Rankings.tsx` (top players by
rating), while `Leaderboard.tsx` is the **Hall of Champions** (victory runs). The ask's spec covered both
(rating + own-row highlight = Rankings; board tiles = Hall), so all three ladder pages were rebuilt in one
shared visual language.

## What shipped

**Shared pieces** — `packages/ui/src/LadderBits.tsx` (presentational) + `leaderboardData.ts` (pure labels,
tested) + one `lb-` / `rg-` CSS block in `styles.css`:
- `LbHeroFrame` — the in-run `.hero > .f > img.heroimg` markup re-seated (the same ring/disc rules), like the
  Career page's `cv2-heroframe`. **Never give it a bare `row` class** — that is the board row's class and its
  layout rules applied (hit during the build: a 180px-tall portrait).
- `LbTeam` — 7 fixed slots, the REAL `Card` rendered at `--tile-cw` and scaled by a transform (compositor
  only); empty slots are dashed blanks; no board → a labelled empty plate. Tile scale steps with the viewport
  (0.82 banners / 0.7 table at 1600, 0.95 / 0.9 at ≥2200px, down to 0.5 / 0.44 at ≤1180px).
- `LbMedallion` — gold / silver / bronze coins for the podium, a plain numeral beyond.
- `LbRunes` — rune emblem (Runeforge art in a purple ring) + name, with the standard floating tooltip.
- The Card's own hover reveal (`.cardref`, portalled to `<body>` at z 460) opened INVISIBLY behind the ladder
  pages (`.lbpage` is z 470) — the same trap the Compendium hit on 2026-09-18. `body:has(.lb-ladder) .cardref`
  now lifts it to 490 (still under Inspect at 500). So hovering any tile shows the full card + keyword defs.

**Rankings (the Leaderboard)** — a gold-panel ranked table: `#` · Player (frame + handle + favourite hero) ·
Rating (big gold number + "MMR") · Games · Latest board (7 tiles + how that game ended + date) · Watch. Your
row (matched by `user_id`, never by name) is highlighted and `scrollIntoView`'d once when the list lands.
The latest board comes from a new light two-step read, `fetchLatestGamesForUsers`: an ids-only probe over
the ranked players' newest telemetry rows, then `replay->v2->result->finalBoard` for the one newest row per
player (a few KB each; never a frame).

**Hall of Champions** — one banner per victory: medallion · hero frame + author + hero + W–L (folded from the
`history` spread) · the winning warband as tiles + round pips + the quest/rune trophies · VICTORY block (date,
round, the board's round-17 fight record). The Most recent / Most wins toggle is a segmented control.

**Recent Games** — one banner per recording: hero frame + handle + hero + record · Final team tiles + Runes ·
outcome block (VICTORY / ordinal, date + time, Length, Rounds, a "Partial recording · from round N" caption)
and ONE **Watch replay** button (disabled "No replay" when the row carries none). The banner still opens the
player's Career. `RecentGameRow` grew `board`, `record`, `durationMs`, `partial`, `firstRecordedWave`, `runes`,
`wave` — all read as JSON-path scalars / small subtrees (`replay->v2->result->finalBoard`, `->record`,
`->>partial`, `frames->0/-1->>tMs`, `picked_runes`, `derived->>finalWave`). The select is a four-rung ladder
(`RECENT_GAMES_SELECTS`): a backend that rejects a rung (no negative frame index, no `derived` column, no
`replay` column) drops to the next and only loses what that rung read.

**Duplication, on purpose:** `outcomeOf` / `runLengthText` / `playedOnText` / `ordinalOf` also exist in the
Career branch's `careerData.ts` (`feat/career-page-v2`), which does not exist on `main`. `leaderboardData.ts`
carries its own copies with a header note; fold them into one module once both branches are in.

## Verification

- `packages/ui/src/ladderPages.test.tsx` — 20 jsdom tests: three rows per page (incl. a partial recording, a
  board-less row, a pre-accounts row), medallion tiers, own-row highlight + single scroll, 7-slot tiles vs the
  empty plate, verdict classes, rune emblems, the one-Watch-per-row contract, loading / empty / offline states,
  the widened `asRecentGameRow` and the select ladder. Existing `replayListing` tests untouched and green.
- Live on Vite (port 5211 — 5199 was already taken by another process) at 1600×900 and 2560×1440 against the
  real backend: no horizontal overflow on any page (`scrollWidth === clientWidth`), only the list scrolls,
  tiles 92px (table) / 108px (banners) at 1600 and 119 / 125px at 2560, labels 13px+, values 15px+.
- `npm run typecheck && npm run lint && npm test && npm run build:web` green.

## Merge notes

Kept clear of the Career branch: `Career.tsx`, `careerData.ts`, `RoundRail.tsx` and the Career fetches in
`remoteBoards.ts` are untouched; the CSS edits replace the old `.rank*` / `.lbrecord` / `.lbsort*` rules (far
from that branch's hunks) and add the new block there. The old `.matchlist` / `.matchrow` rules are now unused
by Recent Games but were left in place because they sit directly against a hunk the Career branch deletes —
remove them after both merge.

## Data the rows lack (not fixable client-side)

- Hall rows (`runs`) carry no `user_id`, so the Hall cannot highlight *your* row (name matching was ruled out
  2026-08-10).
- Ranked rows (`profiles`) carry no per-player W–L / placement summary; the table shows the latest game's
  placement instead.
- Recent Games rows recorded before replay v2 have no board / record / length / runes — they show the empty
  plate, the scalar win count and "—".
