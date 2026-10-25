# 2026-10-25 — Versus Duos (2v2 tag-team): the engine and the server (phase 1 of 3)

Owner design 2026-10-25: a 2v2 Versus mode, "TAG-TEAM, like Hearthstone Battlegrounds Duos: one combat per round,
team vs team. Your board fights first; when it is wiped, your teammate's board steps in against whatever survived on
the other side", shared team hearts, a pass slot, exactly 4 players, unrated. Scoped first
(`docs/design/2026-10-25-versus-duos.md`), then ruled: "you have all the rules right except passing should cost 1
gold". Rules: GAME-RULES.md "Versus Duos (2v2 tag-team)"; oracle R-DUOS-TAGTEAM-01, R-DUOS-01, R-DUOS-PASS-01
(approved/foundation.ts).

## What

- **Core: the tag-team primitive.** `simulate(..., { reserve: { player?, enemy? } })`: a side's second board with its
  own `CombatSideState`. At the loop head (a settled moment), a wiped side with a waiting reserve STEPS IN
  (`stepIn` in simulate.ts): the fallen board's end-of-fight claims run (Re-Pete's last death, Reinvestment, Flash's
  last claim, now `finish*` functions the fight's end also calls, in the old order) and its carry-backs are frozen;
  the side's run context becomes the reserve's; EVERY per-side value of the fight re-initializes for that side from it
  (all 134 `Record<Side, ...>` declarations now go through `sideReset(() => ...)`, which re-runs the initializer for
  one side; it registers nothing without a reserve); the reserve's next-combat banks apply, its board is instantiated
  (uids continue the counter), auras fold in, effects register; `boardFallen` then `tagIn` are emitted (two new
  `CombatEvent`s: shared boundary, the trace coverage and the harness narrate them); then its Start of Combat runs
  through the SAME passes as the opening (the Reclaimer, Closed Casket, the run-level grants, Taurus, the minion pass,
  the rune passes with Twilight, Salvage / Unbroken Scales registered per board, First Claws, Bloodlust, the fills),
  each now a `soc*(sides)` function the opening calls with both sides. An empty reserve never steps in. The result
  carries `tagTeam: { members, tagInAt }`: every member's own carry-backs (a member after a step-in counts only its
  own kills).
- **Byte-identical proof.** A digest script over 1231 fights (the 13 parity fixture fights, the 18 group rounds, 1200
  fuzz fights with random run contexts and combat mods across sets 1-3) matched main before and after every step of
  the refactor. `tagTeam.test.ts`: the hand-off, a reserve winning it, team wipe / double wipe draw, an empty first
  board, the reserve's OWN Start of Combat (and the first board's not repeating), determinism, and the R-SYMMETRY-01
  mirror over 450 random 2v2 fights (events, outcome and every member's ledger identical whichever side a team fought
  on; reserves stepped in in well over 50 of them per set).
- **Sim.** `versus/duos.ts`: teams by seat pair, the default order (odd rounds p1 / p3, even p2 / p4), the server's
  flip honoured, an empty first board handing over, ONE fight with both reserves, team hearts (1, or 2 when the
  winner's reserve never stepped in), team B's view as the mirror (`mirrorForEnemySeat` now flips `tagTeam`'s side
  keys), and `duosMemberView(teamView, member)`: one seat's view with only its own board's carry-backs (the
  carry-back field map is shared with the mirror: `carryAsPlayerFields`). `duosFinalize.ts` (+ `finalize_duos` /
  `parity_duos` in versus-resolve; `finalize_group` now refuses a Duos match). Options gain `mode: 'duos'` (4 seats).
- **Passing (run actions).** `duosPass.ts`: `passCard { uid }` (hand or board, 1 Gold through the one Gold-spend
  chokepoint, recorded in `duos.outbox` with where it came from), `receivePass { from, seq, card }` (fresh uid,
  everything the card carried, `passedWave` so it cannot go straight back; a FULL hand refuses it: owner "Pass is
  refused if hand is full"), `passRefunded { seq }` (the refused card back in its place and the Gold and its Gold-spent
  tallies back, once). Only a Duos seat's run has `duos`; every other run is unchanged. Shop clock: `passCard` locks at
  0:00, the other two stay open.
- **Server.** `supabase/migrations/2026-10-25-versus-duos.sql`: a Duos match is a Versus Group match (so Hero Select,
  locks, the clock, pause / auto, End Combat, frames and the stands trigger all apply) with TEAMS as their own record
  (`versus_group_teams`: id, hearts, elimination, placement; `versus_group_seats.team`; ids are letters by seat pair and
  every helper is generic over N pairs, for the owner's likely 4-team Duos), `duos_first` (set at every shop open,
  `versus_duos_flip_order` until the team locks), `versus_duos_commit_round` (one fight row, the team's hearts, a team
  out together at 0 placed by the teams still in, three auto rounds = team out; seats mirror their team), a concede /
  leave taking the team out, the winning team 1st (both seats), and passes (`versus_duos_passes` with a status:
  `versus_duos_pass` refuses `hand_full` from the teammate's reported room (`versus_duos_hand_room`) less its
  unanswered passes; `versus_duos_answer_pass` records landed / refused; shop only, before my lock and the clock +
  grace, teammate only, exactly once per seq, 10 a round; RLS; realtime).
- **XP.** `supabase/migrations/2026-10-25-versus-duos-xp.sql` (also appended to schema.sql): `settle_progression`
  places a Duos seat by its TEAM on the scale of the number of teams: 125 each for the winners, 50 each for the losers
  (owner: "In duos you only place 1 and 2 in a 2v2").
- **Parity.** `npm run versus:parity -- bundle`: 49/49 (the 31 before + 18 Duos rounds: default order, flipped, an
  empty first board).

## Readings made (flag to the owner)

- The Gold for a pass is enforced by the sender's run (as every Versus shop action: the server never holds a run's
  Gold). The server enforces the phase, the clock, the lock, the team, exactly-once and a cap of 10 a round.
- A reserve whose board is empty never steps in; a team whose FIRST board is empty fights with the teammate's.
- Each seat mirrors its team's hearts and placement, so the rail and the group projection read them unchanged.
- A refund gives back the Gold and the Gold-spent tallies, but a payoff that already fired on the spend (a "when you
  spend Gold" effect) is not undone; the server refuses most full-hand passes up front, so this is the rare race.

## Deploy (the lead)

1. Apply `supabase/migrations/2026-10-25-versus-duos.sql` (after every earlier Versus file), then
   `supabase/migrations/2026-10-25-versus-duos-xp.sql`.
2. `npm run versus:bundle && npx supabase functions deploy versus-resolve --no-verify-jwt`, then
   `npm run versus:parity -- remote <url>` (49 cases).
Nothing is reachable by players until phase 2's room option ships; 1v1 and Group are unchanged on both orders.

## Next

Phase 2: the room (Duos in the options panel, the teams as seat pairs), the teammate on the rail, the REAL-TIME
teammate board view, the board fly-in hand-off in combat (`boardFallen` / `tagIn` beats), the pass drag to the
teammate portrait with its own animation, the flip control, patch note. Phase 3: the live 4-account test and edge
cases (disconnect, concede, double wipe, full-hand pass, restore of passes).
