# Lobby strength: printed as a percentage, and it is the field going in

**Date:** 2026-09-22 · **Branch:** `fix/lobby-strength-percent` · **Owner asks (verbatim):** "can you remove the
easy/medium/hard etc and just have it say for example, 47% since its basically a percentile." and, minutes later,
"the lobby difficulty shows 47 in my career and 50 in recent games, why".

## The label

`strengthText` now prints `47%`. The tier (`Easy` / `Even` / `Hard` / `Brutal`) is still computed and stored on the
stamp (`tier`), because the data, the SQL and the Edge Function carry it; it is simply not printed anywhere. The
Career match rows and the Recent Games rows read the same helper, so there is one label. The aria-labels say
"Lobby strength 47 percent".

## Why the two rows disagreed (47 vs 50)

Read straight off the ledger for the owner's Hunch game (seed 1309785592): the client's stamp on the telemetry
row held seven opponents at 0 fights (the prior, 50). The run-end tick then uploaded that lobby's **45** fight rows
(32 observed, 13 played out), and `settle_rank` settled a moment later, reading the same seven keys from the view
WITH this game folded in: Bram 12-5 → 0.595, Quillen 0-8 → 0.357, … mean 0.47 → **47**. So the Career row's
number depended on how the game just played went, and the two surfaces could never agree.

## The fix: the field GOING IN, on both copies

- **Server:** `settle_rank` (same seven-argument signature; `create or replace` swaps the body) computes each key's
  record from `lobby_fights` directly, **excluding `lobby_seed = p_seed`**, instead of the view (which cannot
  exclude by seed). Migration `supabase/migrations/2026-09-22-lobby-strength-going-in.sql`, the same block
  appended to `schema.sql`.
- **Client:** `fetchLobbyStrength(keys, ownRows)` subtracts this lobby's own rows (the exact `FightRow[]` the tick
  uploads) from what the view reports before the formula: `excludeOwnFights` in `packages/sim/src/lobbyStrength.ts`,
  clamped at 0 per key. Order no longer matters: whether the upload has landed or not, the fetch folds the rows out.
- Nothing else moves: the prior, the bot rate, the tiers, the bonus and its three copies are untouched, and the
  parity test still parses the constants from the original fight-ledger migration.

Pinned by `packages/ui/src/lobbyStrengthGoingIn.test.ts` (the store hands the fetch the very rows it uploads; the
owner's case: seven unserved seats read 50, the same seats with the game folded in read lower, subtracting the game
restores 50), `lobbyStrength.test.ts`, the label tests in `Career.test.tsx` / `ladderPages.test.tsx`, and
`lobbyRatingParity.test.ts` (the going-in block keeps the constants, contains the exclusion, and `schema.sql`
carries it byte for byte). Oracle `R-LOBBY-04`; `R-LOBBY-03`'s label sentence amended.

## Owner runbook

One paste, any time after the fight-ledger block: Supabase → SQL Editor → paste the whole of
`supabase/migrations/2026-09-22-lobby-strength-going-in.sql` → Run. Idempotent. No Edge Function change (the
function's signature is unchanged and the Edge Function only re-derives the bonus from the SQL's value). Until it
runs, the Career row keeps printing the server's old number (with the game folded in); the Recent Games row is
already the going-in number once this client ships.

Verify in the SQL editor: `select prosrc like '%lobby_seed <> p_seed%' from pg_proc where proname = 'settle_rank';`
→ `true`.

## Later the same evening: the floor moves to 50, and one number on the rank screen

Owner: "why did i get +3 bonus mmr for winning a 45% lobby? isnt that an extremely even game?" The 30 / 70 line
had been chosen so the anchors sat on one straight line (1st at 75 = +10), with the side effect that everything
above 30 paid: a 45 lobby paid +3, a dead-even 50 paid +4. The owner chose **floor 50, straight line**: nothing at
or below even; 1st at 55 = +2, at 60 = +3, at 75 = +8 (was +10), at 100 = +15; 4th at 100 still +7. Changed in
all three copies (`STRENGTH_BONUS_FLOOR` 30 to 50 in `lobbyStrength.ts` and `_shared/lobbyRating.ts`;
`c_bonus_floor` / `c_bonus_span` 50 / 50 in `supabase/migrations/2026-09-22-lobby-strength-bonus-floor.sql`, the
same block at the tail of `schema.sql`; the parity test now reads its constants from that newest body). The anchor
tables in the three test files moved with it.

Owner: "dont say +40 +3 in the mmr post game rank screen, just say +43 MMR." `deltaText` prints the summed
`baseDelta` as one number, and the rank screen's unit word is MMR everywhere it printed RP (the delta, the
uncapped Ascendant counter, the dev-lab fixture captions). Two more SQL pastes for the owner today, then: the
going-in block (already run) and this floor block.
