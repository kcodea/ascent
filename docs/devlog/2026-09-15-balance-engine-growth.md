# 2026-09-15 — Balance pilot B6: the engine-growth term (probed turn + carry-back + Rally trial)

**Branch:** `feat/balance-b6-engine` → PR against `feat/balance-bot`.

## What

The strategist's evaluator can now VALUE ENGINE GROWTH — what a board will generate next turn — measured by running
the engine rather than by a per-card table (`packages/sim/src/productionBots/growth.ts`; the full description and
the measured numbers are in `docs/balance-bot.md`, "Engine growth (B6)").

- `transition.ts::probeFuture` — a probe session over a private clone of the state behind a projection: hidden
  future replaced (as `sampleCandidate`), lobby stripped, served board pinned to none; the caller drives ordinary
  actions and reads projections only. `STATE_OF` (a WeakMap projection → state) is how a visible state finds the
  state to clone; a projection this module did not produce probes null.
- `growth.ts` — the scripted turn (End of Turn → a neutral draw → next turn's prompts → field the hand, replacing
  the weakest body when full → buy + field up to three dominant-tribe bodies → the spell offer → the spells the turn
  generated), `carryBackOf` over `CombatResult`'s permanent-gain fields, the `rallyTrial` wall fight, the
  normalised term, the memo cache and the `withGrowth` scope. `EvaluationBreakdown.growth` (weight 0 shipped);
  `FightResult.carryBack`; `PilotBudget.growthWeight` (manifest field, default `GROWTH_WEIGHT` = 20 for the
  strategist, 0 = probe off).
- `balance:pilot-curve` — placement (95% CI, firsts, top-3/4, elimination median) and the per-wave median / p80
  board-stat curve of the pilot beside the corpus curve, from any job.
- Manifests: `set2-pinned-strategist-b6-g{0,8,12,16,20}-smoke100.json` (the baseline manifest is unchanged; the
  `g0` one reproduces the pre-B6 strategist on the new build).

## Defects fixed along the way (surfaced by the probe's traces)

- **Rubies were never cast.** `recruitCandidates` treated `ruby: true` as a minion (a seat index, gated on a full
  board), which the reducer refuses; the pinned records show hands of six Rubies held to elimination.
- **Two held Rubies were a pair** in the prior (and `evaluate.pairsHeld`): 3 utility to hold rather than cast.
- Forced spend with a full board **rolled before every buy** ("refresh ahead of a marginal buy" was implemented as
  "ahead of every buy"): 8 rolls and one buy on 10 Gold past a Standard Bearer and a Chorus Drake.
- A forced hand play the search had just rejected started a **play → sell loop** (seed 52, round 11 hit the
  60-action guard); forced plays are now tolerance-gated on the utility.
- Inside the probe: a **frozen shop** carried into the imagined turn and scored "freeze" over "buy"; **held spells**
  were cast by the probe and rewarded hoarding; a TDZ crash on the early-return path (caught by a 100-lobby job).

## Measured (100 pinned set-2 lobbies per arm, seeds 1–100, smoke budget)

Baseline (pre-B6 build) 6.44 [6.12, 6.76]. Shipped build: growth off 6.55 [6.28, 6.82], weight 12 → 6.41, weight
20 → 6.39 [6.12, 6.66]; paired vs baseline −0.05 [−0.30, +0.20]. Best arm seen 6.27 [5.97, 6.57] (third build,
weight 20). Board stats at waves 8 / 10 / 12: baseline 83 / 133 / 253 → 98 / 176 / 319 (players 139 / 432 / 1,109).
Zero first places in every arm. Runtime 1.5× per lobby with the term on.

Verdict, honestly: the term is a real evaluator gradient (the curve rises 20–35%, the hand empties, round-7/8 win
rates rise) and NOT a pass (placement inside noise of 6.44; the recorded curve is exponential and a one-turn
linear credit cannot price it). Next lever: a two-turn probe whose second-turn yield is the credited number,
scored against wave + 2 corpus boards.

## Verified

`packages/sim/src/productionBots/growth.test.ts` (14): yield vs a stat-identical vanilla in the same imagined
future; bought bodies subtracted; determinism + memoisation; root / live run / handle store byte-identical after a
probe; replaced futures (two seeds, two shops); foreign projection → null; blocked state answered; the term's
normalisation and horizon; `carryBackOf`; the Rally trial; the evaluator wiring and the strategist's per-decision
scope (probes cached, none at weight 0); the Ruby cast candidate accepted by the reducer; Rubies never a pair.
`npm run typecheck && npm run lint && npm test && npm run build:web` green; the balance + productionBots suites
(259 tests, including the B4 mixed-lobby benchmark) green.
