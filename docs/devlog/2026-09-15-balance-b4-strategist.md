# Balance bot B4 — the strategist pilot (packages, lines, priors, curricula)

Branch `feat/balance-b4-strategist` → PR against `feat/balance-bot`. Owner ask: "a bot that understands synergies
and strategies so that I can sim it 30 times for every hero where it picks different lines and runes and cards
… competent enough to understand what was good/bad/overpowered." Set 2 is the target.

## What shipped

- `packages/sim/src/balance/strategy/packages.ts` — eleven strategy packages DERIVED from the content
  (predicates over `CardDef` / `RuneDef`; the hero intent manifest is the one hand-maintained part). Census via
  `npm run balance:packages`; set-2 counts pinned in `packages.test.ts`. Mech is declared and reported
  **unsupported** in set 2; Echo/Rise keeps a neutral core and ranks last without Undead.
- `strategy/lines.ts` — fit = tribe availability × hero affinity × pool depth; `pickLineForRun(hero, tribes,
  seed, exploration)` gives the k-th best viable line. Recorded additively on `RunRecord.line` / `SeatContext.line`.
- `strategy/prior.ts` + `productionBots/evaluate.ts::withEvaluationPrior` — a scoped, capped evaluator term
  (weight 0 in the shipped config; the generalist's numbers do not move).
- `strategy/strategistPilot.ts` — the generalist wrapped (`createGeneralistPilot(budget, seed, { id, wrap })` is
  the additive seam); registered as `strategist`, `strategist:rotate`, `strategist:explore<k>`.
- Curricula (`curriculum.test.ts`, 5 scenarios × 10 set-2 packages + the generalist's competence set) and the
  mixed-lobby benchmark (`benchmark.ts` / `npm run balance:strategist-bench`).

## Lessons

- **Never credit a payoff SPELL held in hand.** The first prior counted hand cards at 0.6 of board value for every
  member; a tempo line then sat on Spirit Fire rather than cast it (the cast lost the "held payoff" credit and the
  fight gain was smaller). Hand credit is minions only — a spell's value is the cast.
- The vanilla-body fixture must offer the Stray token at `atk/hp` DELTAS (offer buffs add to the base), not the
  target stats — the first fixture accidentally made the "vanilla" body bigger than the engine piece.
- Tier timing is an in-turn preference: Gold resets to the max every turn, so "hold Gold toward a tier-up" means
  "upgrade before buying when the curve is due", scored as a penalty for being behind the profile and a smaller one
  for being ahead. It took −1.0 per tier behind / +0.5 on the curve (×10) to beat a Ward body at wave 3 with 5
  Gold — the one-turn fight gain of a 2/2 Ward is ~7.5 utility. The profiles are anchored on the recorded set-2
  players' tier curve (T2 by 2–3, T3 ~5, T4 ~8, T5 ~10, T6 ~12).
- The REPLACE macro (`sell weakest → buy → field`) is opt-in on the generalist and on for the strategist: depth-1
  search never turns a full board over, because the sell alone reads as a lost body.
- **Against the recorded players the strategist plateaus at 6.72 / 8** (100 pinned lobbies; generalist 6.80; the
  owner's bar is < 4.0) while beating the generalist in self-play (4.05 vs 5.33, +1.27 [0.42, 2.13]). Four
  iterations (prior only 6.89 → replace macro 6.67 → mass + investment terms 6.63 → pairs 6.72) moved tiering,
  turnover and the gradient, not the placement: the players' boards grow exponentially on goldens and per-turn
  engines that a one-turn evaluator cannot see, and a capped prior cannot fake a horizon. Numbers and the
  diagnosis are in `docs/balance-bot.md`.
- The seat runner charged the table's STALE health when a recruit-phase effect changed it (Mend set Armor to 5;
  `hitSeat` charged Armor 0 → the seat/run assertion failed the lobby, benchmark seed 101). The lobby now mirrors
  the run's resolve / armor onto the seat after every recruit turn.
- Set 2 has exactly five tribes and every run rolls five, so tribe availability is constant there; line diversity
  comes from hero affinity, ties broken by seed, and `exploration`.
