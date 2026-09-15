# 2026-09-15 — Balance pilot B6 round 2: the two-turn horizon probe (compounding, fought at wave + 2)

**Branch:** `feat/balance-b6-horizon` → PR against `feat/balance-bot`.

## What

The next lever B6 named, pulled: `probeHorizon` (`packages/sim/src/productionBots/growth.ts`) scripts TWO turns
on the isolated clone, credits the SECOND turn's engine yield, and fights the horizon board with `fightScore` at
the clone's wave (the corpus panel two waves out). Applied as a RE-RANKING of the search step — the root, the
search's top `horizonTop` non-terminal end states (`PilotSearchResult.top`, new) and the replace chain's end —
through `GeneralistOptions.horizon`; `PilotBudget.horizonWeight` / `horizonFightWeight` / `horizonTop` (manifest
fields, both weights 0 by default so the growth-only pilot is unchanged). Three imagined futures averaged.

Also: the bodies the probe buys are now left OUT of its after-mass (their Shouts were the shop's, and counting
them made an emptier board read as a better engine — the horizon rewarded selling); the second turn re-fields the
hand (a held engine is seated at the discount of the body it displaces rather than reading 0);
`maxActionsPerTurn` 120 on the round-2 manifests (a Shout-cycling Embermouth turn is not a stuck pilot).

## Measured (100 pinned set-2 lobbies per arm, seeds 1–100, paired vs the growth-20 pilot at this build: 6.37 [6.09, 6.65])

| weights (yield / fight, top) | placement | paired Δ | stats w8 / w10 / w12 |
|---|---|---|---|
| 20 / 13, top 3 | 6.27 [5.97, 6.57] | −0.10 [−0.31, +0.11] | 98 / 168 / 292 |
| 10 / 6 · 20 / 0 · 30 / 13 · 0 / 13 · 20 / 13 top 6 | 6.39 · 6.35 · 6.41 · 6.49 · 6.35 | +0.02 · −0.02 · +0.04 · +0.12 · −0.02 | 92–101 / 163–181 / 201–293 |
| baseline (growth 20, no horizon) · players | 6.37 · 4.38 | — | 98 / 171 / 266 · 139 / 432 / 1,109 |

Zero first places. Runtime 1.9× at top 3, 3.0× at top 6. Verdict: the mechanism works and the placement does not
move — a two-turn probe on an imagined shop measures the engines the pilot has; the players' curve comes from
two-card combos the depth-1 candidate set never proposes. Next lever: engine-combo MACROS in the candidate set
(`buy A → field → next turn buy B` from the package roster's engine pairs), scored end-to-end by this probe.

## Verified

`growth.test.ts` 18 tests (+4: the horizon board is at wave + 2 and fought, an Arnold's second-turn yield beats
its vanilla twin, memoised, root untouched; null on an unprobeable or foreign state; `pilotSearch` top-K shape;
the strategist re-ranks at its weights and probes nothing at 0). `npm run typecheck && npm run lint && npm test
&& npm run build:web` green.
