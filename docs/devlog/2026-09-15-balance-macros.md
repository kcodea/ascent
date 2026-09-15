# 2026-09-15 — Balance bot B11: engine-combo macros in the candidate set

**Branch** `feat/balance-b11-macros` → base `feat/balance-bot`. Five levers on the strategist each moved the pinned
placement by < 0.2 (line prior 6.44, growth probe 6.39, imitation 6.63, two-turn horizon 6.27 within noise, hand
operators 5.7–7.2 per line), and two independent readings reached the same diagnosis: the search's CANDIDATE SET never
proposes multi-turn engine assembly, so no evaluator can select "buy Hank now so Blart eats a buffed shop next turn".
B11 puts assembly into the candidate set and the plan.

## What shipped

- **`strategy/combos.ts`** — the engine-combo roster as data: 15 two- and three-card combos with roles (payoff /
  feeder / enabler; alternatives; a payoff may want two COPIES), sourced from the operators' `core` pieces and the
  player study's co-occurring pairs (Blart + Hank + Horse, Brunni + Gangplank, Coinfire ×2 + Brunni, Chorus + Mirrorwing
  / Earthbreaker / Transcendant / Vaultkeeper, Standard Bearer + Transcendant + a Dragon, Echohorn + an Echo body / Hawkus
  / Sylus, Kobe + Deepvein + Faultline, Paragon + a Rally body). `comboProgress` reads held / fielded / on-offer /
  missing pieces from the visible state; `findChance` / `completionChance` give the honest chance of drawing a piece
  from the printed pool quantities over a roll window. A test pins every piece to the set-2 pool and the package roster.
- **`assemble(combo)` in the generalist** (`generalistPilot.ts`, opt-in through `GeneralistOptions.macros`): one
  candidate per combo the run has a stake in — buy the pieces on offer (payoff first, the pair copy counts), field them
  (selling the weakest non-piece, non-pair body on a full board), answer the prompts a play opens, then FEED the engine
  with the line operator's own procedure (`operators/feedSteps.ts` reads B9's `feed` / `spellTarget` hooks as steps —
  nothing rewritten). Every step is reducer-validated on a clone and queued with fingerprints like any plan.
- **The completion probe** (`growth.ts::probeCompletion`, `ProbeSession.plantOffers`): the two-turn horizon probe with
  the combo's MISSING pieces planted into the imagined shop (bought first, fielded even into a full board, printed
  stats netted out), so a half-built engine is credited for what it becomes. The strategist's macro term weights it by
  the find chance: `p × completed + (1 − p) × held`. It re-ranks the root and the assemble chains only (`horizonTop` 0)
  — two imagined futures each — which is what keeps the runtime at ~1.5× the growth-only pilot.
- **Commit-and-roll + pivot**: a seat COMMITS to a combo when an assemble step is chosen, or when a fielded payoff's
  expected gain (`p × (completed − held)`) clears `macroCommitGain`; at waves `macroCommitFrom..macroCommitTo` (3–6) a
  wanted piece on offer is bought on sight (frozen when unaffordable) and up to `macroReserve` Gold a turn goes into
  refreshes before the search spends the rest; at `macroPivotWave` (7) an incomplete commitment is dropped for good.
- **Triples**: the payoff's second copy is a combo piece; a held pair and the committed combo's pieces are never sold by
  the replace macro.
- **`balance:gap` "Engine assembly"**: share of runs with a FULL combo on the board by wave 6 / 8 / ever, pilot vs
  corpus, per combo, and the pilot's placement split by it.
- Manifest keys `macroWeight` (0 = off; every older job reproduces), `macroFightWeight`, `macroReserve`,
  `macroCommitFrom/To`, `macroPivotWave`, `macroSeeds`, `macroCommitGain`; six curricula in `combos.test.ts`.

## What it measured (100 pinned set-2 lobbies each, seeds 1–100, smoke budget + growth 20, corpus `set2-players-v1`)

The baseline (`set2-pinned-strategist-b11-base`, the growth-20 strategist at this build) reproduces B6's **6.37 [6.09,
6.65]**. Paired by seed:

| arm | placement | paired Δ | full engine by w6 / w8 | rolls / lobby, waves 3–6 |
|---|---|---|---|---|
| v1 — commit on any assemble step, rolls unconditioned | 6.60 | **+0.23 [+0.06, +0.41]** (worse) | 3% / 7% | 5.20 |
| v2 `m20` — payoff held to commit; roll only for a drawable piece, never below 3 Gold | 6.33 | −0.04 [−0.19, +0.11] | 4% / 9% | 2.16 |
| v2 `m40-r6-p8` — weight 40, reserve 6, pivot 8, commit gain 0 | 6.50 | +0.13 [−0.05, +0.31] | 2% / 8% | 2.11 |
| v2 `m20-piece-r5` — commit on a feeder while the payoff is drawable, reserve 5 | 6.36 | −0.01 [−0.17, +0.16] | 5% / 8% | 2.56 |
| v2 `m20-r0` — no rolling | 6.43 | +0.06 [−0.08, +0.21] | 1% / 7% | 1.97 |
| baseline / corpus | 6.37 / 4.38 | — | 1% / 4% · corpus 9% / 19% | 1.98 |

Stat medians at waves 8 / 10 / 12: baseline 98 / 171 / 266; the arms 97–99 / 152–174 / 267–286; the players 139 /
432 / 1,109. Every v2 arm sits inside the baseline's interval, with 70–75 of 100 lobbies byte-identical: the macro
engages only when a payoff is held, and a Tier-3 payoff is held by wave 6 in a minority of runs. The first build is the
finding worth keeping: it committed on a lone Hank and rolled 4 Gold a turn at Tier 2 for a Tier-3 Blart through
waves 4–6 — never tiering up — and was worse with the interval clear of zero. Rolling for a piece the tier cannot draw
is the one thing this instrument proved a pilot must not do. The assembly metric moves the way it should (1% → 4–5% by
wave 6; the corpus' own strict full-combo rate is 9%), and the lobbies where the engine does assemble are the ones that
place (seed 12: Brunni + Coinfire + Blart at wave 6 → 303 stats at wave 9, 5th → 3rd). Runtime 1.5–1.8× the baseline.

## Next lever

Not another way to score a plan the pilot rarely gets to make — the ENGINE RATE: (1) a Tier-3 opening (T3 by wave 4,
the recorded curve) so the reserve has shops to draw a payoff from; (2) a roster that matches what the corpus holds
(one payoff + any buff source — the survivors' Blart ate a Butcher-buffed shop, not a Hank + Horse one). Both read on
the assembly metric before placement.

## Verification

`npm run typecheck`, `npm run lint`, `npx vitest run packages/sim/src/balance packages/sim/src/productionBots` green;
the 100-lobby jobs ran with 0 failed lobbies and 0 refused actions.
