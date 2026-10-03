# 2026-10-03: placement bonus XP up by half (Top 4 60, 1st 90)

Owner ask 2026-10-03: "increase XP for top 4 and for wins per game", chosen option "+50% bonuses".

## Owner runbook (in this order)

1. Supabase SQL Editor: paste and Run `supabase/migrations/2026-10-03-placement-xp.sql` (also appended to
   `schema.sql`). It only replaces `settle_progression` and re-grants it; it writes no rows, so re-running it is safe.
   If `2026-09-29-hero-titles.sql` (or any earlier file that defines `settle_progression`) is ever re-run, run this
   one again after it.
2. Deploy the `submit-progression` Edge Function straight after (its shared rules carry the new numbers and log
   `parity: false` while the SQL and the function disagree). `progression-inventory` only imports the profile parser
   from the rules file, so it does not need a redeploy for this change.

## What changed

| | Before | After |
|---|---|---|
| Ranked complete | 100 | 100 |
| Top 4 bonus | +40 | **+60** |
| 1st bonus (on top of Top 4) | +60 | **+90** |
| Comeback | +25 | +25 |
| Ranked 1st | 200 | **250** |
| Ranked 2nd to 4th | 140 | **160** |
| Ranked 5th to 8th | 100 | 100 |
| Practice 1st / Top 4 / 5th to 8th | 120 / 84 / 60 | **150 / 96** / 60 |
| Practice 1st with comeback | 135 | **165** |

- `XP_RULES.topFour` 40 -> 60 and `XP_RULES.firstPlace` 60 -> 90 in `packages/progression/src/rules.ts`; the
  generated `supabase/functions/_shared/progressionRules.ts` regenerated (`npm run progression:shared`).
- SQL: the new migration is the 2026-09-29 hero titles writer byte for byte except `c_top_four` and `c_first_place`.
- `PROGRESSION_RULES_VERSION` / `c_rules` stay at 1 on purpose: the client never computes XP (it shows the server's
  result), and a bump would 409 every queued or older-client submission.
- No backfill: games settled before the SQL runs keep the XP they earned.
- Oracle R-PROG-XP-01, `docs/GAME-RULES.md` and a 2026-10-03 patch note updated.

## Verification

`sqlParity.test.ts` reads the new file (it is now the newest `settle_progression`), checks that exactly the two
placement constants moved, and that `schema.sql` carries it last. `achievements.db.test.ts` and
`heroTitles.db.test.ts` execute it in PGlite and assert the settlement equals `xpForSettlement` (Ranked 1st = 250).
