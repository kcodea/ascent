# 2026-10-25 · Versus Duos: who fights first is a seeded 50/50 (R-DUOS-ORDER-01)

**Owner ruling (2026-10-25):** "I want the 'who fights first' to be a 50/50, not a player decision for duos teams.
Every round it should say who fights first but players cannot decide who it is."

## What changed

- **The order is a pure function.** `duosRandomFirst(matchSeed, round, teams)` (`packages/sim/src/versus/duos.ts`):
  per team, one mulberry32 draw seeded by `versusDuosOrderSeed` (the fight seed's mixer over match seed, round, an order
  tag and the team index, plus a murmur3 finalizer so neighbouring seeds and rounds are independent). Measured over
  40k (seed, round) pairs: 49.8% / 50.2% per team, 24.9% both-first-seats, 49.8% change round to round.
- **The resolver fights it.** `resolveVersusDuosRound` no longer takes a `first` input; `finalize_duos` and
  `parity_duos` stop reading / posting one. An empty first board still hands over. A committed fight keeps the order
  it actually fought in its result (`duosFirst`), so old matches and replays read unchanged.
- **The client shows it.** `duosFirstAt` computes the same pick from `raw.seed` + round (it ignores any `duos_first` an
  old row still holds). `DuosOrderPlate` is now a static `div` ("You fight first" / "<Name> fights first",
  `role="status"`, `pointer-events: none`): no click, no hover look, no cursor swap. `versusRemote.duosFlipOrder` and
  the `duos_first` client type are gone.
- **SQL** (`supabase/migrations/2026-10-25-versus-duos-random-order.sql`): drops `versus_duos_flip_order`, and
  `versus_group__open_shop` clears `duos_first` on a Duos match instead of writing the old alternation. The column
  stays (nullable, unread).
- **Parity:** the Duos cases are now `duos`, `duos-reseeded` (a second match seed, so the pick lands differently) and
  `duos-empty-first` (the picked first board emptied). They are derived from the 1v1 fixture at run time; no fixture
  file changed.

## Deploy

All three together: the SQL migration, a `versus-resolve` redeploy (`npm run versus:bundle` first; the old function
honours `duos_first`, which would disagree with the new clients), and the web build. Until the redeploy, remote
`versus:parity` fails on the Duos cases (expected).
