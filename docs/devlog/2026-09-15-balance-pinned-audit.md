# 2026-09-15 — Balance bot B10: the pinned lobby audited fair to the pilot

**Question.** B6 read "the pilot takes ~2× the per-round damage the recordings take from each other (the shipped
tier-only path)" as an asymmetry of the game as played. Is `pinnedLobby` actually fair to the pilot — does seat 0
get exactly what a real player gets in the shipped eight-seat lobby?

**Verdict: clean — no fix.** Point by point (the full evidence table with file:line is in
`docs/balance-bot.md` → "Pinned-lobby fairness audit (B10)"):

1. **Recording-vs-recording fights** are a real `simulate()` of both recorded boards (`runLobby.ts`
   `settleRunLobbyRound`), both sides `combatSide({ tier })`; the pinned runner never resolves one itself — it
   dispatches the reducer's `resolveCombat`, which runs the same settle the client runs. The damage formula is
   one function for every fight (`winner tier + Σ surviving-minion tiers`, capped by `lossDamageCap(round)`,
   through one `hitSeat`).
2. **The served board** is the paired recording's board at the pilot's current round (`prepare(lobby.round)` →
   `boardAt`), stats verbatim, its snapshot's run-level scalers through `sideFromSnapshot` — the same
   `playerOpponent` / `lobbyOpponentBoard` lookup the client's `faceOmen` makes. Repeat-final past the
   recording's last wave, ghosts and byes identical.
3. **Recordings take damage and die** through the same `hitSeat` + `knockOutIfDead` as any seat; the pilot's seat
   starts at its hero's own Resolve / Armor exactly as `createLobbyRun` seeds a human's, and the runner asserts
   seat and run agree every round.
4. **Placement** is `closeRunLobbyRound`, the only writer. The recordings' mean (4.46–4.49) is NOT (36 − pilot)/7
   = 4.23 because simultaneous knockouts share the WORSE place (shipped rule, `lobby.ts:190-193`): the per-lobby
   placement sum on the shipped-build job averages 37.80, and (37.80 − 6.39)/7 = 4.49. Consistent.
5. **Seating** is the client's `createRunLobby` (seeded shuffle, unique heroes, no author cap) seat for seat;
   the corpus population equals what the client fetches today (every `set2-players-v1` patch stamp passes the
   client's `0.1.0+` filter; no wave exceeds the client's 120-per-wave cap). Survivorship is identical for a
   human. Hero eligibility is the same tribe gate, sampled by rotation instead of a 3-hero offer.
6. **Hero powers, Runeforge, quests, Discovers** are real reducer prompts on a `'lobby'` run the pilot must
   answer or the seat fails; End Turn is the shipped `faceOmen`.

**The "2× damage" is a loss-rate effect, not a fight asymmetry.** On `b6-r4-g20` (100 lobbies) the damage a seat
takes *when it loses* is the same for the pilot and for a recording losing to a recording — 12.4 vs 12.7 at round
8, 14.4 vs 13.7 at round 10 — while the pilot loses 73% of its round-8 fights and a recording 43%. Early it is the
reverse (rounds 1–4: pilot 13–29% losses, recordings 34–46%). The pilot's placement is its board.

**Two shipped facts worth an owner ruling, unchanged here:**
- Every non-player seat starts at the lobby rules' 30 / **15** while the player's seat (human or pilot) starts at
  30 / **hero Armor** (4–18, mean 11.25 across 53 playable heroes; 7 are ≥ 15). Identical handicap for a human, so
  not an instrument defect — but a ~8% health deficit against the table for the average hero, and a recording's
  hero is known, so seating it at its own hero's Armor is a one-liner if that is the intent.
- The recording fights the player at full strength (snapshot scalers) and other recordings at tier-only; named
  in the trust ledger since B1, shipped, the same for a human.

**Future population drifts** (not today): the client caps at the newest 120 boards per wave and fetches waves
1..`CONFIG.courseRounds` only; `balance:corpus` pulls everything. `set2-players-v1` sits under both limits (busiest
wave 70 boards; 2 boards at wave 18).

**Tripwires added** (`packages/sim/src/balance/pinnedLobby.test.ts`, "B10 fairness tripwires"): the runner's
table equals `createLobbyRun(seed, hero, {}, 'lobby').lobby` seat for seat (ids, kinds, recordings, starting pools);
every fought encounter — pilot's or recordings' — has the winner at 0 and the loser in
`[min(cap, winner tier), cap]`; every seat's placement is `8 − seats fallen earlier` (or 1), and a one-winner
table sums to ≥ 36.

**Placement before / after.** Nothing in the instrument changed, so `audit-after` (the same
`set2-pinned-strategist-smoke100` manifest, re-run on this branch) is the determinism check, not a candidate:
see the PR for the number beside the 6.39–6.44 baseline.

Verified: `npm run typecheck`, `npm run lint`, `npx vitest run packages/sim/src/balance` green.
