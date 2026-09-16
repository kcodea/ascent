# 2026-09-15 — Balance bot B2 + B3: planning coverage (Equipment, reveals by effect) + the generalist pilot with a repaired fightScore

Work packages B2 and B3 of `docs/balance-bot-roadmap.md`, built against the shared contract in
`packages/sim/src/balance/types.ts` (`SeatPilot`, `PilotBudget`). Engine + tooling only — no player-facing change,
so no patch note.

## B2 — the planning boundary now covers the whole recruit surface

- **Equipment is inside the boundary.** `actionCatalog.ts` promoted `selectEquipment` / `activateEquipment` from
  `never` to `recruit`. `legalActions.ts` generates an activation of the SELECTED Equipment (one candidate per
  friendly target when it aims, one when it does not), and a free `selectEquipment` swap for every other held
  Equipment that could then fire. Charges (`equipmentChargesOf`) and live cost (`equipmentCostOf`) gate it.
  A Choose One Equipment (Prismatic Pick) opens its prompt, answered from the mandatory family.
- **Every wielded hero power with its target shape**: `BotHeroView.powers[]` carries slot / kind / targeting
  (`passive` | `untargeted` | `friendly` | `friendlyOrShop` (Quillen) | `commission` (Cassen) | `flashPick`) with
  the reducer's availability gates mirrored (unlock wave, per-turn / per-game / max-uses, Gold). Void's second
  slot is generated with `slot: 1`.
- **Spells at every legal target**: `any` spells (Rubies, Apples) are also generated onto non-spell shop offers;
  Choose One spells open their prompt first. Targeted MINION Shouts are the engine's two-step (`play`, then
  `battlecryTarget` as a mandatory follow-up) — a `play` carries no `targetUid` because the reducer ignores one
  on a minion. `mandatoryOf` now mirrors the reducer's aim guards (self / tribe / offers for `any`).
- **Live prices**: `BotOfferView.cost` reads `offerBuyPrice` (the reducer's own source) instead of
  `minionCostOverride ?? 3`, so Cadence, Trade-In, a free first buy and the Starform's ticking price all plan
  correctly. `BotVisibleState` gained `equipment[]`, `starform`, `runCounters.{rubyCasts, revelerX,
  tavernBuyBonus}` and `friendly` (below). Still a curated projection — every field is named going IN.
- **Reveals are audited BY EFFECT, in two halves** (`transition.ts`):
  1. static — `revealOf(action, visible)` looks at what the action fires: the played card's recruit-phase effect
     ids (and `discoverOnPlay`), the hero-power kind, the Equipment's factory / Choose One branches / cast spell,
     and board watchers on the action's event. The content package publishes no "this factory is random"
     metadata (its maps cover card references), so the predicate is a documented name-pattern (`RANDOM_EFFECT`:
     random / discover / conjure / transform / swap / steal / magnet / …) restricted to recruit-phase triggers.
     `coverage.test.ts` checks it against the factory-id union so a new random factory named by convention
     cannot dodge it. `getRubies` is deliberately excluded — it mints a NAMED Ruby.
  2. dynamic — `applyCandidate` reports `rngConsumed` when the run's RNG cursor moved; that alone marks the
     transition a reveal (`kind: 'rngConsumed'`). Probed over five runs: buy / sell / freeze / upgrade / discover
     never move it; roll always; play 3/87; buyRune 10/36.
- **Sampled futures instead of the real one**: `sampleCandidate(parent, action, panelSeed, n)` applies a reveal
  action to `n` clones whose `seed` + `rngCursor` are replaced from a per-decision panel. Every candidate in a
  decision is scored against the SAME imagined futures. This is what finally gives a refresh an expected value
  (the old model — same state minus the Gold — made refreshing read as pure loss).
- `coverage.test.ts` (25 tests): per mechanic class (Equipment, Choose One, targeted Shout, Discover, triple, hero
  power, rune buy, Starform, the plain verbs) — the action is generated AND accepted, the live run + root +
  siblings are untouched, and twisting the hidden future (cursor, seed, pinned opponent) changes neither the
  candidate list nor the fingerprint before a reveal.

## B3 — fightScore repaired, then the pilot

Three discrepancies between `fightScore` and the real fight, closed:

1. **The friendly side is prepared as `faceOmen` prepares it.** `productionBots/combatContext.ts::
   friendlyCombatSideOf(run)` mirrors the reducer's player-board mapping (per-instance carries, one-fight marks,
   grafted effects, banked Start-of-Combat payouts — Fleeting Vigor, Open the Gates' Imps, banked keywords) and
   its `combatSide({...})` (spell power, Ruby casts, Reveler value, spell history, auras, fodder, hand minions,
   quest mods, …). Marked `TODO(B1-merge)` to be replaced by B1's shared helper; until then a test pins every
   `combatSide` key the reducer sets against `MIRRORED_SIDE_KEYS`, so a scaler added to `faceOmen` without a
   mirror fails the suite. The prep rides in `BotVisibleState.friendly` so `fightScore` stays behind the
   projection (module-boundary test unchanged in spirit; `combatContext.ts` joins the sanctioned conversion layer).
2. **The enemy side is the snapshot's**, via `sideFromSnapshot` + `opponentBoard` — the reducer's own builders —
   and the pool is filtered to the run's SET and a wave band. No registered pool for the set → the result says
   `panel: 'procedural'`; it is never silent.
3. **Margins come from the authoritative result**: `enemyDamage` / `playerDamage` (the engine's settlement
   formula) and its survivor counts, not initial-bodies-minus-deaths (which could not see summons, Rise or growth).

The evaluator gained one term, `tripleReady` (weight 10): an unopened Discover — a golden minion in hand, the
Triple Reward token, a Discover spell, or a pending offer. Measured: without it the depth-1 pilot bought a filler
body over a triple's third copy, because the fight terms read the combine (two bodies off the board) as a loss.

**The pilot** — `packages/sim/src/balance/generalistPilot.ts`, `createGeneralistPilot(budget, seed): SeatPilot`,
budgets `GENERALIST_BUDGETS.{smoke, dev, deep}` = {1/1/40/2}, {2/3/200/4}, {3/5/800/6}. Its search
(`productionBots/pilotSearch.ts`) is a sibling of the Practice bots' `search.ts`: reveals scored by sampling,
mandatory continuations (aim, Choose One, forge) resolved before a play is scored, a buy → field chain generated
as its own candidate, seeded tie-breaks. Decision order: queued plan (fingerprint-checked) → mandatory answer →
search → never-end-with-spendable-Gold → curated positioning (Taunt forward, cannon back, edge moves) → end turn.
Every returned action is validated against the reducer on a clone first; it never touches the run or its RNG.

`generalistPilot.test.ts`: six competence scenarios (buys-and-plays, takes the triple, aims the best target, uses
Equipment when it helps the fight, picks the better Choose One branch, walls the glass cannon), determinism +
no-mutation + no handle leak, and a **held-out benchmark**: 20 seeds × set2 / set3, one turn from a shared
greedy-built wave-6 state, the resulting boards fought directly (a stated PROXY for run strength, both sides
prepared with `friendlyCombatSideOf`):

| | smoke vs legacy greedy | dev vs greedy | dev vs smoke |
|---|---|---|---|
| set2 | W17 L0 T3, +0.85 [0.69, 1.01] | W19 L0 T1, +0.95 | W10 L7 T3, +0.15 [−0.26, 0.56] |
| set3 | W17 L3 T0, +0.70 [0.38, 1.02] | W18 L2 T0, +0.80 | W7 L7 T6, 0.00 [−0.38, 0.38] |

No depth regression (the assertion is that the dev-vs-smoke interval reaches 0), but no measurable gain from
depth over ONE turn either — that needs multi-turn play through B1's runner. Both sets ran on the PROCEDURAL
panel (the committed pool is set1-only). Decision latency: smoke 10.8 ms mean (p95 21), dev 21.5 ms (p95 59),
deep 49 ms (max 128).

`bots.test.ts`'s mis-titled "every difficulty is far stronger than the legacy greedy policy" now actually runs
the legacy policy: over 8 seeds, legacy 2.63 wins vs expert 8.75; the assertion is expert > legacy + 2 over 6 seeds.

## Unfinished / for the next session

- `SeatContext.scoutedOpponent` is not yet folded into the panel (a scouted board should join it).
- `reorderHand` and `buyHenchman` (archived) are still not generated.
- The dev budget's freeze/unfreeze toggles are wasted plan steps — a "returns to parent fingerprint" prune.
- Register a set2 / set3 pool before trusting the benchmark's absolute numbers.
