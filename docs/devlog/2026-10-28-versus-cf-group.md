# 2026-10-28 · Versus on Cloudflare: Group (3-4 players)

Phase 2 of the Cloudflare move (design: `docs/design/2026-10-28-versus-cloudflare.md`, section 13). A room now plays
Versus Group as well as 1v1: `workers/versus/src/core/groupMatch.ts` is a port of every `versus_group_*` function
(round robin with Copy boards and ghosts, Health/Armor with the lobby cap, live Armor, End Turn as a ready signal,
knockouts together sharing a placement with the wipeout guard, knocked-out players to the stands, missed rounds,
pause with auto-resume on return, `void` on an unresolvable round, the event log). The round is resolved in the object by
`handleVersusGroupFinalize`, the Edge Function's own handler, so every round's digest equals versus-resolve's.

- The dev transport (`?versusHost=cf` / `cf-live`) now serves the Group store calls (`groupMatch`, `groupRounds`, every
  `group*` op) from the same socket; a group match is told apart by its `seats` array.
- Results: `supabase/migrations/2026-11-05-versus-cf-writer-group.sql` extends the limited writer to the Group tables
  (`backend` column, `group_match` with its seats, `group_round` with its fights) and keeps `versus_sweep` off them.
- Tests: 15 fake-clock Group tests named after the chaos-harness scenarios they stand for (baseline, simultaneous, timer,
  emptyAll, mendArmor, dropRestore, dropShort, lostCombatReady, resolver failure, hibernation), the writer's PGlite test,
  and a 4-player workerd test (one push carries both fights to every client; a drop pauses).

One parity trap: `versus_group__eliminate` places a leaving seat at `versus_group__living()` read INSIDE the update, which
still counts the seat itself (Postgres reads the pre-update rows), so a forfeit from 4 is 4th, not 3rd. The port counts
before it marks the seat out.
