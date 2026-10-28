# 2026-10-28 — Supabase cleanup P1.3: Career reads match details on demand

Scope: `docs/design/2026-10-28-supabase-cleanup.md` section 3.1c. Every Career open (and the idle Social prefetch) read
the light rows AND the full `entry` jsonb of the newest 50 runs. On prod an entry averages ~12.7 KB (p90 15 KB), most of
it `entry.match` (every seat's board), so up to ~630 KB per open and ~2 GB in 16 days.

## What changed (`packages/ui`)

- `fetchMyRuns`: the second `run_history` read is `CAREER_BOARD_SELECT` = `id, created_at, placement, board:entry->board`
  for the newest `CAREER_DETAIL_ROWS` (50). The list portraits (recorded skins), the banner's final team and runes, and
  the MMR tip's board all keep working; `detailed` stays false (the match details are not loaded).
- `careerRunOf` reads `row.board` when the row has no `entry`; `withRunDetails` merges a board row (board + runes) or a
  full row (board + runes + match, `detailed: true`), a full row winning in either order.
- `Career.tsx`: the game open in the detail panel (`openRun`, the same pick GameSplit renders) is read in full with
  `fetchRunDetails(user, [id])`, once per game per page (a failed read is asked again next open). The hero filter's
  older games read their boards only (`fetchRunBoards`, one batch per hero pick; was the full rows of up to 50 games).
  A game not yet read in full shows an empty lobby slot (`aria-busy`), not "no details".

## Measured

Synthetic but realistic entry (7-minion boards, 8-seat match details built by `buildMatchDetails`): full entry 5,616 B,
board alone 1,185 B (21%). A Career open: 50 x 5,616 = 281 KB before; 50 x 1,185 + one opened game 5,616 = 65 KB
after (-77%), each further opened game +5.6 KB once. At prod's 12.7 KB average entry the same ratio is ~635 KB ->
~150 KB per open. The light select (up to 1000 rows) and the telemetry probe are unchanged.

Rule: R-EGRESS-03 (persistence). No migration. No patch note: the page looks the same; the lobby details of a game
appear a moment after it is opened.
