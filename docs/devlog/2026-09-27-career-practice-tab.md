# 2026-09-27: the Career Practice tab, and practice replays

Owner asks (verbatim): "add practice games as a tab in the career as well so players can see practice games they
played ... the practice bot games should include the bot level." Then: "we dont need to store replays for practice i
guess, will we be able to at least show the results?" Then, reversing that: "okay go ahead and do it" (practice games
get replays after all).

Rule: R-CAREER-PRACTICE-01 (foundation). Follows #1767, which made practice uploads record at all (22P02 fix).

## OWNER ACTION: run the migration

Paste `supabase/migrations/2026-09-27-practice-games-replay.sql` into the Supabase SQL Editor and Run (also appended
to `schema.sql`). It is one line: `alter table public.practice_games add column if not exists replay jsonb;`.
Policies are unchanged. Until it runs, practice games still record their RESULT (the upload retries without the
replay on 42703 / PGRST204) and the lists show no Watch. Only games finished AFTER it runs have a replay.

## What shipped

- **Career centre column: MATCH HISTORY | HEROES | PRACTICE** (`Career.tsx`), persisted in `ascent.career.tab`
  like the other two. The tab reads the career owner's rows (`fetchMyPracticeGames(userId, 25)`, by `user_id`,
  newest first) the first time it is shown, and keeps them while the page is open. On a viewed player's Career it
  reads THAT player's rows (practice_games is public read), not yours: judgement call, the brief said "the current
  player's", which is what your own Career shows.
- **The row** (`PracticeRow`) is the Match History banner: hero frame + name, WIN/LOSS by placement, the fight record,
  the placement verdict, Played date, Length, Rounds, the 7-slot final team, the runes, and the options as pills
  ("Bots · Level N" / "Players", "Unlimited HP" / "Normal HP"). Watch Replay only when the row carries a replay; no
  disabled placeholder otherwise. Loading, error (Retry) and empty ("No practice games yet. Finish a practice game
  to see it here.") states.
- **Recent Games Practice tab** already showed the bot level ("Bots Lv N"); it now also gets Watch on rows with a
  replay (reads `fetchPracticeReplay`, never `run_telemetry`).
- **Upload** (`store.ts`): the v2 assembly moved into `assembleReplayV2`, shared by the ranked telemetry upload and
  the practice upload, so both carry the same `replay` shape (`{ seed, heroId, mode, actions, v2 }`). Practice has
  no lobby-strength stamp (no fight ledger). The recorded placement is the practice end screen's.
- **Lists never download a payload**: the practice selects probe `replay_v2_version:replay->v2->version`, falling
  back to the plain select on a backend without the column. `hasReplay` = that probe is 2.

## Verification

Browser check against a LOCAL mock Supabase (a throwaway node server; nothing touched the live DB): a scripted
Bots Level 10, Normal HP practice run reached game over, the store seam uploaded one row with a 13-frame v2 replay,
the Career Practice tab listed it with "Bots · Level 10" and Watch Replay, and Watch played it in the replay viewer
(Round 1 to Round 6); the same from the Recent Games Practice tab.
