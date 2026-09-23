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
