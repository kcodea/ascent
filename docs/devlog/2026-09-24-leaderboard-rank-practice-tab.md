# 2026-09-24 — Leaderboard Rank column centred, and a Practice tab on Recent Games

Owner asks (2026-09-24, with a screenshot of the ranked table):

1. "better center the rank text over the rank column"
2. "can we add a practice tab to recent games, which shows the latest practice mode games played?"

(An Avg. Placement column was built in the same PR and then withdrawn by the owner before merge: "remove the
avg placement from the leaderboard actually". Nothing of it shipped; the table keeps main's five columns and
widths.)

## What changed

**Rank column centred.** The RANK header was right-aligned while the cell's crest + name + bar block sat
right-justified inside a wider track, so the header read right of the block's visual centre. Both now centre on
the same grid track (`.lb-thead .lb-c-rating` and `.lb-c-rating` / `.lb-c-rating .rankbar-row` →
`justify-content: center`). Column widths are unchanged from main. Measured live in headless Chrome at 1280 /
1500 / 1854 / 2400 px wide: the header text centre and the cell block centre sit within a few px at every width.

**Practice tab on Recent Games** (`RecentGames.tsx`). Two tabs, `Ranked` (the feed as before) and `Practice`,
in the Career page's `.cv2-tabs` pill, placed where the Hall's sort toggle sits (top-bar right). Each tab
fetches the first time it is shown and keeps its list for the rest of the visit.

Practice runs uploaded NOTHING before this (every upload path is gated on `mode !== 'practice'`), and that stays
true for the ladder tables: the Balance Report, Hall and Career must never see a practice game. So practice
games get their own table, `practice_games` (`supabase/migrations/2026-09-24-practice-games.sql`, appended to
`schema.sql`), and their own run-end block in `store.ts` (never a sandbox, never the tutorial). The row is
LIGHT: hero, author, placement (the one the practice end screen shows), record, final round, the end-state
board, runes, length (first to last replay frame) and the practice options (opponents, bot level, health). The
row builder is pure (`practiceGames.ts`). **No replay payload** is stored (practice is played far more often
than the ladder and a 100-450 KB recording each is not worth the storage), so practice banners have no Watch
button; the banner still opens the player's Career (without focusing a run, since practice is not in the
match history). Practice rows show two extra facts: Opponents ("Bots Lv 5" / "Players") and Health
("Unlimited" / "Normal").

Until the owner runs the migration, the insert fails quietly and the tab shows "No practice games yet."

## Owner Supabase steps

1. Open Supabase → SQL Editor → New query.
2. Paste the whole of `supabase/migrations/2026-09-24-practice-games.sql` and Run. It is idempotent.
3. Verify with the anon REST probe (should return `[]`, not a PGRST205 "could not find the table" error):
   `curl "$VITE_SUPABASE_URL/rest/v1/practice_games?select=id&limit=1" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"`
4. Finish one practice game (any options), reopen Recent Games → Practice: the game is listed. The probe now
   returns one row.

## Verification

- Tests: `practiceGames.test.ts` (`fetchPracticeGames` / `asPracticeGameRow` incl. pre-migration,
  `uploadPracticeGame` incl. no session, `practiceGameOf`); `ladderPages.test.tsx` (tab switching without
  refetch, practice banners, practice empty state; the ranked table's columns unchanged).
- Live on a private port (5194) against the real backend: the Practice tab showed its empty state (table not
  migrated yet) and, with the practice read shimmed in the page, the two-row banner layout.

## Follow-ups / owner calls flagged

- Tab names "Ranked" / "Practice" are a judgement call.
- Practice rows carry no replay. If a Watch is wanted there, it is a `replay jsonb` column plus the v2 assembly
  for practice runs (and a storage decision).
