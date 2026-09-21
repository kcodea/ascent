# 2026-09-20 — Leaderboard row re-laid: the board strip out, CAREER PAGE in, everything bigger

**Owner report (screenshot of the row shipped in #1583):** the row was mostly empty — a small medallion, a
small portrait, name + hero, "782 MMR", "46", then a huge "LATEST BOARD" strip of 7 card tiles, then WATCH.

## What changed (`packages/ui/src/Rankings.tsx` + the `.lb-table` / `.lb-trow` block in `styles.css`)

- **The Latest Board section is gone** — the tiles, the "Victory · Sep 20, 2026" caption, the per-row
  loading state, and the two-step `run_telemetry` read behind it. `fetchLatestGamesForUsers` +
  `LatestGameFacts` were deleted from `remoteBoards.ts` (Rankings was their only caller); the `.lb-c-board` /
  `.lb-latest-place` / `.lb-team-none.dim` / `.lb-table .lb-team` rules went with them. Rankings now does ONE
  read (`fetchTopPlayers`) and paints.
- **CAREER PAGE** is the row's primary button — `openCareer({userId, author, rating, gamesPlayed,
  favoriteHero})`, exactly what the row click already did (the row click stays; the button stops the bubble
  so it opens once). **WATCH survived** as the secondary, hollow button (`.lb-btn-ghost`): it never depended
  on the board read — `fetchLatestReplayForUser(userId)` is its own query.
- **The row reads full:** 120px tall (88px hero frame + 14px padding + the 2px frame); columns
  `# 84px · Player 1fr · Rating 210px · Games 130px · Actions 272px` with 24px gutters; the medallion at 64px
  (gold / silver / bronze coins, a ringed plain numeral beyond); the handle at 24px with the hero name at
  15px under it; the rating at 40px gold with "MMR" at 14px; games at 28px with a small-caps "played"
  caption; the header labels at 14px aligned over the columns (#, PLAYER, RATING, GAMES). At ≥2200px the row
  steps up to 136px (100px frame, 72px coin, 46px rating); at ≤1180px it steps down (76px frame, 34px
  rating). Your own row keeps the accent ring.
- **Gotcha kept in a comment:** the header is its own grid, so the actions track must be px — an `auto` track
  sized to 0 in the header's empty cell and shifted the RATING / GAMES labels off their columns.
- **Coordination hook:** the rating cell is ONE element, `.lb-c-rating` aliased `.rk-rating`, so the
  rank-screen work can slot a medal crest into it without re-laying the row.

Tests: `ladderPages.test.tsx` — the columns, no tiles / captions, three CAREER PAGE buttons that call
`openCareer` with the row's user exactly once, WATCH still plays the latest run.
