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

## What it measured

See `docs/balance-bot.md` — "Engine-combo macros (B11)".

## Verification

`npm run typecheck`, `npm run lint`, `npx vitest run packages/sim/src/balance packages/sim/src/productionBots` green;
the 100-lobby jobs ran with 0 failed lobbies and 0 refused actions.
