# 2026-08-26 — Doc Bot: the snapshot-fidelity ratchet

**PR:** feat(docbot): snapshot-fidelity ratchet — every instance field classified at every boundary

## The bug class

A new per-instance field on `BoardCard` (sim/state.ts) or `BoardMinion` (core/types.ts) crosses each
fidelity boundary only if its author remembered every by-name copy site — `cleanBoard` (opponent capture),
the reducer's player→combat mapping, `instantiate`, the `initial` snapshot. Forget one and the field is
dropped **silently**: the served board fights differently than the board it was captured from. PR #453
shipped four of exactly these (copiedEcho / bloodbinderMode / bloodlustRally / allTribes). Nothing forced
a fidelity decision when a field was added — until now.

## The instrument (test-only + registry; docbot barrel/CLI untouched)

New files: `packages/sim/src/docbot/snapshotRegistry.ts` + `snapshotFidelity.test.ts`, following the
`phaseRegistry.ts` / `factoryPhase.test.ts` excuse-registry discipline:

1. **Parsed field lists.** TS types are erased, so the authoritative field lists are re-derived at test
   time by parsing the two `export interface` declarations from source (comment-aware, depth-tracked).
2. **Complete exemplars.** A `Required<BoardCard>` / `Required<BoardMinion>` exemplar sets every field to
   a truthy sentinel — a new field fails typecheck AND the parse-completeness test with "classify me".
3. **Three real boundaries.** The exemplar goes through the actual production paths:
   - `save` — `serialize`/`deserialize` (save-and-continue). All 64 BoardCard fields survive, value-exact.
   - `capture` — `snapshotBoard` (servedBoards / leaderboard). 25 fields survive (2 renamed:
     chefGranted→chefGrantedLast, allTribes→universalTribe, tracked via `SURVIVES_AS`); 39 drops classified.
   - `combat` — `simulate(...)` → `CombatResult.initial`. 18 BoardMinion fields survive; 17 drops classified.
4. **Two-sided ratchet.** Every drop needs a `SNAPSHOT_EXCUSED[(boundary, field)]` entry with a verifiable
   why; an excused field that now survives (or no longer exists) fails as stale; the `needs-triage` count is
   pinned at 8 and can only shrink (the pin is also checked downward, so it can't sit above the backlog).
5. **Sabotage test** proves the diff logic reports a deleted field, including through a rename.

## The needs-triage 8 (drops with no ruling — several are the PR #453 shape)

- `capture:resummon` / `capture:partingCry` / `capture:closedCasket` — one-combat spell marks active for
  the very combat being captured; `bloodlust` (the same shape) IS carried, these three are not, so a served
  board fights without them.
- `capture:grantedEffects` — runtime-grafted Deathrattles (recruit.ts grafts) have no BoardMinion field and
  are dropped by the player combat mapping too: silent in combat and on served boards.
- `capture:echoStripped` — the "no Echo" mark guards shop dispatch only; combat can't honor it.
- `capture:rallySpreadAtk` — Sunmane's run-long shop accrual never seeds combat (which re-accrues per fight);
  unruled whether it should.
- `combat:addedTribes` — folded into live `tribe2` (behaviour holds) but `initial` carries neither, so a
  spell-added tribe can't be derived for the combat display.
- `combat:chefGrantedLast` — declared on `MinionSnapshot` but never populated by `snapshot()`.

Triage = follow the cited reader, thread the field through or upgrade the excuse, and lower the pin.
