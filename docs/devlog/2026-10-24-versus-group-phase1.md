# 2026-10-24 — Versus Group (3-4 players) + room options: the server side (phase 1 of 3)

Owner 2026-10-24: "for versus, how hard would it be to make a 4 player round robin lobby version?" (7 hearts, last
one standing, 3 or 4 players, unrated, "a player faces a copy of another player's board instead of a ghost"), then
"add custom options/modes to versus lobbies", "customizable within a lobby ... change them game to game without
needing to rehost", and "remove time/lives from options for now". Rules: GAME-RULES.md "Versus room options and Versus
Group"; oracle R-VERSUS-GROUP-01, R-VERSUS-GROUP-02, R-VERSUS-OPTIONS-01 (approved/foundation.ts).

## What

- **`packages/sim/src/versus/options.ts`**: the room options object `{ v: 1, mode: 'duel' | 'group', modifiers }`
  (modifiers = up to one of the rifts Freedom / Summit), its whitelist (`versusOptionsError`), `normalizeVersusOptions`
  (missing/old = today's defaults) and `VERSUS_MODE_SEATS`. Hearts and timers deliberately absent (owner); adding one
  later is a new key whose default is today's value, so stored objects keep their meaning without a version bump.
- **`group.ts`**: `versusGroupPairings` (pure, from the seats + each seat's elimination round: 4 alive = the three
  matchings in turn; 3 alive = one fight + the odd player vs a COPY, a 3-round rotation where every pair fights once,
  everyone faces the copy once and is copied once; 2 alive = each other; a new living set restarts the cycle at the
  first offset that avoids last round's pairs), `versusGroupCombatSeed` (own seed per round + fight), and
  `resolveVersusGroupRound` (one `simulate()` per fight; a copy or a ghost never loses a heart).
- **`groupFinalize.ts`**: `handleVersusGroupFinalize`, the `finalize_group` twin of `finalize.ts` over an injected
  store. **`server.ts`** exports it + `parityGroupRecord` into the Deno bundle; **versus-resolve** gains
  `finalize_group` and `parity_group` actions (the 1v1 actions are byte-identical).
- **`run.ts`**: `createVersusRun(..., options)` pins the modifier's rift (and its Armor) onto the run, exactly as a Rift
  run does; no options = today's run byte for byte (tested). `versusTimeoutRng` / `catchUpVersusRun` accept p3/p4
  (p1/p2 seeds unchanged).
- **`supabase/migrations/2026-10-24-versus-group.sql`**. Lowest-risk data model: the 1v1 match tables and match RPCs
  are untouched; options + p3/p4 seats + gates go on the shared ROOM tables; group matches get their own
  `versus_group_*` tables (match, seats, seat_private, submissions, rounds, fights, spectator_frames; RLS as the 1v1
  ones) and RPCs (`versus_group_register_offer / pick_hero / reroll_hero / intro_done / submit / combat_ready /
  forfeit / request_resume / unpause / reconcile / publish_frame`, service-role `versus_group_commit_round`). New room
  RPC `versus_set_options` + a 7-argument `versus_create_room`. Replaced in place, each with ONLY a mode branch added:
  `versus_join_room`, `versus_take_seat`, `versus_start_game`, `versus_reconcile_room`, `versus_press_gate`,
  `versus_leave_room`, `versus_heartbeat`, `versus_list_rooms`, `versus_open_rooms`. `versus_matches.options` snapshots
  the room's options on every new 1v1 match too.
- **Parity**: `npm run versus:parity -- bundle` now also resolves 18 group rounds (4 alive, 3 alive with a copy, a
  ghost) derived from the existing fixture sides (fixture file unchanged): 31/31 byte-identical.

## Readings made (flagged for the owner)

- Damage to a Copy never hurts the copied player; the Copy's win costs the facing player a heart (BG ghost style).
- Simultaneous knockouts share the LOWER placement (the lobby's `closeRunLobbyRound` rule: two out from four are both
  4th). A wipeout is only reachable through ghosts; the lobby's guard (most hearts, then seat) keeps one standing.
- Leaving or conceding mid-match = out at once (placed below everyone still in); the match goes on. A seat that goes
  out during a round's shop still fights that round as a ghost of its last locked board, so nobody's pairing changes
  mid-shop.
- End Combat: the 1v1 "first one back gives the other 5 s" became "when all but one are back, the last gets 5 s"
  (fights differ in length in a group round, so the 1v1 rule would cut a long fight short).
- Switching a room to 1v1 with 3-4 seated: the lowest seats keep theirs, p3/p4 first fill an empty p1/p2, the rest go
  to the stands (may push the stands past 20 for that moment; the cap still gates joins).
- Modifiers: max ONE (a run pins a single rift). Proof modifiers Freedom and Summit; both are shop rules, combat never
  reads `rift`, so the resolver needs nothing per modifier today.
- Group XP/achievements are NOT wired (settle_progression reads `versus_matches` only).
- Fixed in passing: `versus_press_gate` let a non-member press seat 2's gem (`null not in (...)` is null); it now
  refuses non-players.

## Verification

`versusGroup.test.ts` (pairing properties, copy/ghost hearts, determinism), `versusGroup.db.test.ts` (PGlite, every
Versus migration then this one twice: options, seats, a whole 4-player match through the real finalize handler to
last one standing, shared placements, ghosts, wipeout guard, pause/auto/missed, the 5 s rule, hero timeout + intro
barrier), `versusOptions.test.ts` (SQL whitelist = TS whitelist code for code; runs). Every existing 1v1 db test
(schema, match, hero re-roll, bot, open rooms) now loads the new migration too and passes unchanged.

## Deploy (the lead)

1. Apply `supabase/migrations/2026-10-24-versus-group.sql` (after all earlier Versus files).
2. `npm run versus:bundle && npx supabase functions deploy versus-resolve --no-verify-jwt`, then
   `npm run versus:parity -- remote <url>` (31 cases).
No other function changes. The current client keeps working on both orders (it never calls the new RPCs; the room RPCs
it calls behave identically for a 1v1 room).

## Next

Phase 2: the room's options panel + 3-4 seats + the in-game rail with the Copy slot, per-round opponent, spectator
fight picker. Phase 3: edge cases + a live 4-account test.

Other rift ideas that could become modifiers (owner to pick): Runic Behavior (the turn-6 basic Runeforge; a no-op
today because every run already gets it), a Tribe Surge (Practice's 2x draw weight for one tribe), picked tribes
(Practice's tribe override), and a starting-tier or starting-Gold bump.
