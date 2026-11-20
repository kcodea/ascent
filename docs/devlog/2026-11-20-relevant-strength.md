# 2026-11-20 — Relevant Strength and Run Strength on the game recap

**What shipped.** A game's recap now shows two named numbers per seat (owner: *"lets call it Relevant Strength and Run
Strength"*). **Relevant Strength** is how strong that seat's board was across only the rounds you played it (round-weighted
mean of its per-round board percentiles, frozen into the match record). **Run Strength** is the old whole-run "Game
strength". Relevant is first and larger, Run second and smaller: `Relevant Strength 90 · Run Strength 40`. Spec:
`docs/superpowers/specs/2026-11-20-strength-while-you-faced-them-design.md` (5.6); rule R-RESULTS-STRENGTH-WINDOW-01.

**Where (UI, this PR).** Lobby tile hover text, scoreboard rows (each part with its own `.gtip` tip, never `title=`), the
selected seat's strip ("Relevant Strength by round", now for ANY seat that recorded rounds), and the game page header facts
in Recent Games (party home) and the Career game detail. Helpers live in `matchDetailsText.ts`: `seatStrengthParts`,
`strengthLabel`, `headerStrengthFacts`. Career and Recent Games list rows keep `GAME_STRENGTH_LABEL`.

**New vs old records.** A record built by the new code carries `strengthWindow: 1`. In one, a seat without a
`windowStrength` shows Run Strength only (no fallback, so the two numbers never swap meaning on a page). A record without
the marker shows Run Strength alone, and its strip keeps the old "Game strength by round" label.

**Rollout.** SQL first: run `2026-11-26-pool-board-scores.sql` in Supabase (pool boards then carry their v2 score). Every
client and the hub mirror re-fetch the live runs once (the salted `rev`), a one-time re-download. The next Ship Ascent
carries the client. Until a pool reaches a player with scores, their recaps show Run Strength only, as before.

**Verified.** `npx vitest run packages/ui/src/matchDetails packages/ui/src/partyHome` plus the full gates
(typecheck, lint, test, build:web).
