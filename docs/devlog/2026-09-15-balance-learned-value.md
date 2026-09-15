# 2026-09-15 — balance bot: the learned value model (survival-labelled, run-split)

**What.** `packages/sim/src/balance/value/` + `packages/tools/src/balance/value/`: a dataset builder over the
recorded set-2 player corpus (label = normalised waves survived after the board — recordings have no placement)
plus the pinned-lobby pilot rounds (same label, placement + fight kept as evaluation columns), ONE feature function
shared by training and inference (`featuresOf` / `featuresOfSnapshot` → `featuresOfInput`; visible information
only; twelve mechanic buckets from the effect vocabulary), a deterministic per-band ridge regression with per-wave
standardisation, K-fold validation split by ORIGINATING RUN, and the committed `models/set2-v1.json`.
`valueTermOf(visibleState, model)` + `loadDefaultValueModel(setId)` are the hook; the strategist wires it.

**Measured.** 2,716 rows (794 corpus / 70 runs; 1,922 pilot rounds / 200 lobbies). Held-out R² 0.483 vs the
wave-mean null 0.250; recordings alone 0.195 vs −0.201; early band 0.31 / mid 0.51 / late NOT predictive. Top
predictors of survival: mean minion tier for the wave, per-turn scalers, Consume, Kobold engines; at 6–10 a full
hand, Wards/Taunts and Demon/Dragon/Dwarf-heavy boards predict elimination.

**Standalone benchmark (local wiring, not committed).** 50 pinned lobbies paired on seeds: W 30 → 6.70 (Δ −0.14 ±
0.20), W 100 → 7.10, W 300 → 7.64. A heavier term makes the pilot tier on the recorded curve and die earlier — the
depth-1 search cashes a tier-up as an unrecoverable fight loss. The term is a direction for B4, not a weight.

**Lessons.** (1) Per-wave standardisation on thin waves explodes without shrinkage toward the band (held-out R²
−21,000 before the fix; clip standardised values at ±6). (2) Row order must not affect a closed-form fit: sort
rows by content, not input index, before accumulating. (3) The wave-mean null is the honest baseline — survival is
mostly the wave.
