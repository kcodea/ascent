# Balance bot: from old experiments to a trustworthy balance instrument

Drafted 2026-09-12 from the current repository. Scope: planning and source audit; this document does not implement the new system or establish current balance rankings.

## The outcome we want

An offline tool that plays complete, legal games through Ascent's real rules, understands enough strategies to exercise the content, and answers: **what should we change, by how much, for which reason, and what else will that change affect?**

This needs three independently proven capabilities:

1. **Game fidelity:** the simulated game follows the same transitions, combat, resources, offers, and settlement as the playable game.
2. **Pilot competence:** bots can execute the strategies whose balance they measure, with player-legal information.
3. **Experimental validity:** reports distinguish availability, player selection, strategy strength, and the effect of an actual rules change.

Sharing `simulate()` proves only part of the first requirement. Winning against a weak bot proves little about the second. Large sample counts do not repair either problem.

Build on the existing engine and planning boundary. Do not build a second rules engine, start with expensive training, or promise a universal card-power score. Our cohesive balance lever should be a reproducible **baseline → candidate patch → measured consequences → designer decision** workflow.

## What the previous attempts actually left us

The historical starting points are [bot-sims-handoff.md](bot-sims-handoff.md), [bot-handoff.md](bot-handoff.md), and the much older [balance handoff](archive/handoffs/balance-handoff.md). Their results and timelines describe earlier versions; they are not current benchmarks.

| System | Current source evidence | Decision |
|---|---|---|
| Original balance report | `packages/sim/src/balanceReport.ts` now accepts policies; `bots/index.ts` contains greedy, tempo, midrange, meta, and explorer. Default remains greedy. | Reuse export/presentation ideas and baselines. Replace its measurement loop. The old claim that policies are still unimplemented is obsolete. |
| Legacy rollout bot | `bots/rollout.ts` tests arrangements by running `faceOmen` against the pinned opponent and actual combat seed. | Preserve as an explicitly privileged diagnostic reference. Do not mix its scores into fair-player benchmarks. Audit shallow-clone isolation before further use. |
| Production planning bots | `productionBots/` has visible-state projection, cloned transitions, action catalog, queued search, evaluation, and tests. | Preferred foundation for the offline policy API. Preserve its isolation and information boundaries. |
| Fight evaluator | `productionBots/fightScore.ts` can sample registered boards, otherwise falls back to procedural threats. It reduces friendly bodies to card ID, stats, keywords and golden; both combat sides receive only tier. | Repair combat preparation/context before tuning weights or depth. Pool registration alone does not make this faithful. |
| Difficulty profiles | All four profiles currently use depth 1, beam 1, 40 nodes, two positioning candidates; blunder rate differs. | Practice difficulty is not evidence that we have a strong balance pilot. Add independently benchmarked offline budgets. |
| Live lobby bots | `lobby/seats.ts::botSeat` advances a private run through reducer fights; `settle` copies lobby health/armor. `prepare` only shops explicitly while the board is empty after reaching the round. | Replace this execution path for balance use. Audit incomplete recruitment, unrelated fights, settlement, and repeated preparation. |
| Lobby combat | `lobby/lobby.ts` and non-player combat in `lobby/runLobby.ts` pass tier-only combat contexts. The player's reducer fight constructs extensive run modifiers. | Compare these paths and extract shared authoritative preparation/settlement. Track live behavior versus intended corrected behavior explicitly. |
| Snapshot/practice opponents | `hybridSeat` is recording-backed; `practiceBots.ts` authors scaling boards with utility substitutions at higher levels. | Useful benchmarks for their modes, not full strategic self-play. Preserve their role in the shipped experience. |
| Training attempts | `bot-rollouts.ts` already has worker sharding and exploration; its run creation hardcodes Drakko. `bot-learn.ts` fits values and splits by run seed. | Reuse infrastructure after provenance, rules identity, targets, and coverage are repaired. Do not reuse old weights as validated current knowledge. |
| Rules identity | `rulesIdentity.ts` hashes card ID/tier/stats, rune and quest IDs, and token IDs. Build/content stamps are not compared. | Insufficient for balance: effect, cost, hero, rune-parameter, and engine changes can escape detection. Introduce an experiment identity. |
| New mechanics | `actionCatalog.ts` explicitly marks equipment selection/activation `never`. Set 2 is enabled; Set 3 is present but disabled in `content/src/sets.ts`. | Explicit set/mode manifests and mechanic coverage are required. Do not silently benchmark only the live default. |

### Measurement defects to retire first

The shared report records intended purchases before checking reducer acceptance; no-op recovery may force end turn; capped/interrupted runs still reach outcome accounting. Minion outcome credit uses the final board, so sold economy cards and setup pieces disappear. Spells are also credited through the final board and therefore lack meaningful cast-outcome attribution. Run-level unique offers conceal repeated opportunities and timing. The CLI does not itself register an opponent pool or identify its source.

These are source-level findings, not estimates of their present numerical impact. Reproduce each with a small fixture before changing implementation. Keep old outputs available as legacy artifacts, clearly marked unsuitable for patch decisions.

The benchmark assertions also need review: `productionBots/bots.test.ts` has a test titled “every difficulty is far stronger than the legacy greedy policy,” but it only checks easy/expert against an absolute wins threshold and never runs the legacy policy for comparison. Passing that assertion would not establish its advertised claim.

## Define the games being measured

Use separate experiment modes, with the exact configuration printed on every report:

| Mode | Question | Primary outcomes |
|---|---|---|
| Shipped asynchronous lobby | How does this hero/build perform in the experience people currently play, against a pinned compatible recording population? | Placement, first/top-half rates, elimination round, damage and economy trajectory |
| Full live eight-seat self-play | What happens when every seat shops and develops under the actual results of its own lobby fights? | Placement distributions, matchup matrix, strategy prevalence, adaptation and pacing |
| Fixed combat/scenario suite | Does an interaction work, and what changes in a controlled encounter? | Rule assertions, combat outcome distribution, damage, carryover |
| Legacy course or authored practice | Does a change affect these particular modes? | Their actual victory/difficulty/pacing definitions; separate tables |

Do not pool course victory with lobby placement. Do not claim snapshot opponents adapt to a patch. A self-play result describes the selected policy population, not automatically the human population. For all-eight-seat symmetric self-play, overall average placement is mechanically 4.5: hero-specific comparisons and controlled seat substitution supply the useful signal.

The default initial deliverable should cover the live Set 2 lobby and a separately pinned Set 3 development experiment. Generate eligibility from set pools, run tribes, and the production hero-selection rules, not `!wip` alone. Include runes, quests, equipment, gifts, tokens and special resources wherever they alter the four requested content categories. These are dependencies of faithful measurement even when they are not headline tables.

## Architecture and non-negotiable contracts

```text
Experiment manifest + immutable rules/pool/policy identities
                         ↓
Scenario or lobby runner → player-visible observation → pilot
           ↑                                      ↓
Authoritative preparation / reducer / combat / settlement
                         ↓
Accepted actions + attributed events + round snapshots + outcomes
                         ↓
Coverage and validity checks → analysis → patch comparison report
```

The policy chooses; the engine validates and executes. The recorder observes accepted transitions. Analysis never invents gameplay outcomes. Keep Node workers and storage in `packages/tools`; keep reusable simulation interfaces in `packages/sim`. Suggested new `balance/` directories below are proposed, not existing APIs.

### Faithful turns and fights

Extract reusable recruit completion, combat preparation, combat execution and settlement from the authoritative flow, preserving trigger order. Audit `reducer.ts` around `faceOmen` and combat settlement, the snapshot converters, and both lobby implementations first.

Each living seat must shop until it legally ends recruitment, resolve pending choices, apply end-of-turn effects once, prepare its full combat state, fight its paired opponent once, then settle that exact result once. Carry permanent stat changes, generated cards, resource changes, quest/hero progress, runes, equipment, armor, health, death and turn resets into the next recruit phase. Handle byes, ghosts, simultaneous eliminations and damage caps using the selected mode's real rules. Repeated `prepare` calls must not buy cards or replay triggers.

Use the same complete preparation helpers for candidate evaluation. Friendly instance state, attachments, buffs, run counters, eligible pools, hand-sensitive effects, hero/rune modifiers and opponent snapshot context must survive conversion. Current reducer context includes spell power, Ruby casts, Reveler values, spell history and many other scalers that a tier-only call loses. Calculate evaluator margins from authoritative final combat state; the current initial-bodies-minus-deaths approximation cannot faithfully represent summons and evolving stats.

Never silently correct a production discrepancy inside only the simulator. Capture the discrepancy, choose the production fix deliberately, version it, and label whether an experiment measures current shipped behavior or the proposed corrected rules.

### Fair information and useful planning

Keep engine RNG and hidden future shops/opponents outside observations. Legally revealed scout information should be available under the same conditions as for a player. Offline omniscient analysis may exist, but must have a separate label and cannot be the headline pilot.

Audit reveals by effect, not only action name: playing a card or using a hero power can generate random cards even when the action catalog calls that action non-revealing. Sample unknown outcomes independently of the real hidden future, with consistent scenario panels across candidates. Preserve queued plans and revalidate after state changes. Prove sibling plans cannot mutate one another or consume the live RNG.

### Experiment identity and isolation

Every job must identify engine revision plus dirty-diff digest, serialized gameplay definitions and effect implementation identity, pool order, set/tribe eligibility, mode/rules/configuration, hero definitions, scenario overrides, policy/model/features/search budget, opponent-corpus digest, seed schedule and schema version. Pool order matters because it can affect seeded draws.

Pin baseline and candidate builds in separate worker processes. Existing global registries make simultaneous mutable overrides unsafe. A data patch may use validated overlays where supported; an effect-code patch uses a separate build. Never mutate the checkout's content to run a parameter sweep. Resumption requires matching identities and completed shard checksums, not merely an existing filename.

## Pilots that exercise the game

First build one competent generalist through the production planning boundary. It must consider purchases, sales, tiering, rerolls, freeze, board and hand order, triples, targeted play, alternative branches, Discover, hero powers, runes, quests, henchmen and equipment. Generate all strategically relevant legal targets before pruning. A compile-time catalog entry is not evidence the bot can use a mechanic.

Score immediate fight outcomes alongside future economy, survival and progression. Test short multi-turn rollouts for setup decisions; train a continuation model only after the trajectories are valid. Increasing search effort must earn its place through held-out improvement, because the old handoff documents deeper search making play worse.

Then add strategy specialists through shared search with package priors and different risk/economy preferences. Derive the package roster from each set's actual effects, supported by a small designer-maintained intent manifest. Include tempo, economy-to-tier, spell engines, summon/deathrattle, attachment, Consume, Ruby, Heat, alignment, and relevant Set 3 engines where available. Priors guide construction; they do not replace engine outcomes or force illegal resource access.

Each specialist needs a curriculum: a ready payoff state, an early setup state, a weak-shop pivot, a contested/poor-offer case, and a complete naturally acquired run. Test sequencing, targeting, positioning, resource expenditure and delayed payoff. A specialist that only wins with a preassembled board has not demonstrated drafting competence.

Maintain separate populations for natural play, deliberate content exploration, and ceiling/exploit search. Record forced choices and their probabilities. Do not present forced exposure as natural pick rate. Rotate heroes, seats and seeds across policies; evaluate on unseen seed families and human-run groups. Where player recordings exist, split by originating run and preferably player/time, not individual boards from the same run. Keep evaluator, training, tuning and final-test populations disjoint.

## Telemetry and analytics

Reuse `runTelemetry.ts` and replay infrastructure where their semantics fit; extend through observational hooks. Avoid another hand-maintained accounting loop.

Store a compact run record, a record for each round, accepted decision events, and attributed effect/resource events. Include run/lobby/seat IDs, policy, hero, set, tribes, identity, action index, actual price, source ID/instance, target, visible offers, chosen option, acquisition route, pre/post state hashes and termination reason. Retain full traces for failures, suspicious results and a sampled baseline; aggregate ordinary runs cheaply.

Distinguish offered, affordable/eligible, chosen, purchased, generated, played, attached, sold, transformed and retained. Spell casts need source, target, cost, repeat/trigger route and downstream resource/effect events; generated spells are not shop purchases. Record instance lineage for triples, transformations and attachments. Preserve direct effect attribution separately from estimated long-term value: direct damage or stat grants do not by themselves equal win contribution.

| Category | Required analytics | Useful candidate levers |
|---|---|---|
| Heroes | Eligible/assigned/picked counts; placement and top-half intervals; power use/missed opportunities; early survival; strategy compatibility; skill sensitivity | Armor/health, activation price, trigger cadence, reward strength, unlock timing |
| Runes | Eligible offers and affordable opportunities; picks/skips/rerolls; acquisition round; trigger count; value realization; performance by hero/package | Price, magnitude, trigger threshold, timing, availability |
| Minions | Offer→buy→play funnel; tier/round acquired; time held and sale value; triple rate; setup/payoff success; combat contribution; late-game relevance | Stats, tier, effect magnitude/frequency/cap, access and synergy requirements |
| Spells | Offer→buy→cast funnel; actual spend; cast source and repeats; targeting; immediate and delayed payoff; held/unusable rate | Price, scaling, target restriction, repeat behavior, generation frequency |

Add hero×rune, rune×package, minion×minion and spell×engine views, but suppress sparse combinations. Show pacing, tier curve, unused gold, board turnover, strategy concentration, matchup diversity and early-card retention alongside win metrics. Global economy and damage changes are separate levers because they alter many content rankings at once.

### Evidence levels

1. **Descriptive:** what these pilots encountered and did. Co-occurrence is a lead, not a card's causal power. Split by acquisition round, tier, hero, policy, set, tribes and opponent cohort to expose survivorship and selection effects.
2. **Controlled decision branches:** at a legal opportunity, clone the pre-choice state, take option A versus a legal alternative B, then continue with the same policy and sampled futures. Include price, lost opportunity, later decisions and setup costs. Report the population of states this estimates.
3. **Patch experiments:** change one explicit parameter or coherent design change and compare full runs/lobbies against a pinned baseline. This is the primary evidence for an actual balance adjustment.

Final-board removal is a combat sensitivity diagnostic only. It cannot measure a spell already spent, a sold economy minion, or the acquisition cost of a build. Hero and persistent-rune interventions must begin before their effects occur; removing them late cannot undo their history.

Use seat-rotated, paired seed schedules for patch tests. Same initial seed does not guarantee matched later randomness when rules change draw counts: record divergence and use enough independent pairs. Keep policies frozen first to isolate immediate patch impact; then adapt/retrain separately to estimate the new meta. Compare both fixed-opposition and candidate-population self-play where appropriate.

Report effect sizes and 95% uncertainty intervals with underlying counts. Resample at independent run/lobby level, keeping paired experiments together; eight seats in one lobby are not eight independent trials. Use shrinkage or minimum support for sparse rankings, and control false discoveries when scanning many entities. Allocate simulation budget by a predefined precision target, with a maximum budget and planned stopping rule. An inconclusive interval means inconclusive, not balanced.

## Ordered implementation backlog

Effort ranges are planning estimates for focused engineering, not measurements. A two-person team should execute these in order; speed and model work come after fidelity.

| Work package | Concrete deliverable and likely files | Exit gate | Estimate |
|---|---|---|---|
| B0: Freeze and reproduce | Experiment inventory; `tools/src/balance/manifest`; small fixtures reproducing report attribution, pool fallback, context loss and seat progression; census per set | Every run names its actual mode, pool, policy, rules and termination; legacy defects have reproducible cases | 1–2 days |
| B1: Authoritative turn/combat adapter | Shared preparation/settlement around `reducer.ts`, snapshots and `lobby/`; full self-play seat state | Identical scripted state/action/RNG cases match production state and outcomes after every phase; real lobby results carry into next recruit; no duplicate fights/triggers | 4–7 days |
| B2: Coverage and planning safety | `productionBots/{visibleState,actionCatalog,legalActions,transition}`; mechanic fixtures including equipment and current set resources | All in-scope mechanics have legal-action, isolation, settlement and replay coverage; hidden-future changes do not change decisions before reveal | 3–5 days |
| B3: Generalist pilot | Repaired `fightScore`, evaluation, controller and search; offline budget profiles; versioned opponent panels | Zero silent failed runs; competent shop/target/position scenarios; held-out advantage over existing baselines with uncertainty; no observed depth regression accepted without diagnosis | 4–8 days |
| B4: Strategy coverage | Specialist package manifests and curricula, natural/exploration populations | Every intended package has a competent pilot or is explicitly labeled unsupported; designer reviews sample traces | 3–6 days initially, ongoing |
| B5: Event dataset and first report | `sim/src/balance/recorder`, tools aggregation/export; hero/rune/minion/spell tables and coverage ledger | Accepted-action reconciliation; spells and sold setup cards visible; failed/censored runs separated; deterministic report regeneration | 3–5 days |
| B6: Patch comparison | Isolated candidate builds/overlays, paired branch and full-lobby experiments, uncertainty and interaction reports | No-change A/A reproduces; designed positive controls register; one real candidate has replayable evidence and collateral-impact analysis | 4–7 days |
| B7: Operational workflow | Resumable workers, job budgets, local report viewer or existing dev-panel integration, scheduled CI smoke/nightly entry points | Fresh checkout can reproduce a pinned report; interruptions resume without missing/duplicate runs; changed rules invalidate stale results | 2–4 days |

B5's basic recorder belongs in B1 so failures are inspectable; rich analysis waits for B3. After correctness is established, a useful first report is likely several weeks of work, with the fuller instrument roughly 5–9 focused engineer-weeks and continuing pilot refinement. Re-estimate after B1 benchmarks. The old one-week promise does not account for the now-visible fidelity gaps or current content surface.

### First implementation slice

Start with B0 and one B1 vertical slice: one explicitly pinned Set 2 hero, one scripted opponent context, two complete rounds, actual combat settlement and a recorded trace. Include a persistent rune or generated spell so the test proves more than vanilla combat. Then add an equipment hero and a Set 3 persistent-resource case. Finally scale the same adapter to all eight living seats.

The first deliverable is a proof that the next recruit phase contains the exact resources and effects earned in the preceding fight. Once that passes, improving the pilot and multiplying games becomes worthwhile.

## Validation and release gates

Maintain a small permanent suite for hand/board overflow, full-board sell→buy→play, targeted branches, triples and transformations, attachments, hero powers, rune choices, spell generation/recasts, equipment, resource scaling, permanent combat gains, quest completion, pool eligibility, elimination, byes/ghosts and replay determinism. Expand generated scenarios around changed effects using existing Docbot contracts/differential-testing infrastructure. A changed mechanic invalidates its coverage stamp until rerun.

For every job, count planned, started, complete, failed and censored runs separately. Unexpected no-ops, action limits, timeouts, missing pools and incompatible snapshots produce visible failures; they must never become ordinary losses or silently forced turns. Report failure rate by hero/policy/mechanic to expose bias from selectively losing hard cases.

Before using a report to balance content, require:

- Fidelity fixtures pass for the active mechanics, and no unexplained simulation failures remain.
- The relevant strategy pilot passes its competence cases; unsupported content is labeled, not ranked as weak.
- Baseline/candidate identities and opponent populations are inspectable and reproducible.
- The estimate reaches the declared precision/support target or is labeled inconclusive.
- At least one representative trace has been inspected for the proposed change, and its cross-content effects are reported.

Do not target an arbitrary overall bot win rate: the opponent population sets that rate. Set human calibration expectations from observed current games rather than historical handoff numbers. Bot-vs-bot success is provisional until real-player traces or playtests corroborate its decisions.

## The day-to-day balance lever

Proposed interface, **not commands implemented today**:

```text
balance:run      --manifest <experiment.json>
balance:report   --job <job-id>
balance:compare  --baseline <job-id> --candidate <job-id>
balance:replay   --job <job-id> --run <run-id>
```

The designer opens a report showing coverage first, then likely problems with evidence level and uncertainty. Each issue links to decision/fight traces, affected heroes/runes/packages, and a specific editable parameter. Create a bounded candidate patch, run the paired comparison, inspect effect and collateral changes, then accept, revise or reject. Actual content edits remain a designer decision; no autonomous nerf/buff loop.

The comparison must answer: Did the target move? Did it move because of rules or policy behavior? Did acquisition become less consistent? Did a hero/rune combination become dominant? Did pacing or strategy diversity deteriorate? Did early cards lose their role? What remains unsupported?

Use a fast deterministic smoke suite for relevant changes, a medium development batch for candidates, and larger scheduled coverage sweeps once measured throughput supports them. Budget CPU-seconds, memory, trace storage and precision, not a decorative fixed game count. Keep heavyweight search offline so this work does not reintroduce the historical lobby/UI hitch.

## Audit verification

This draft is grounded in current source inspection and the historical handoffs. Focused baseline check: `productionBots/planning.test.ts` passed 19 tests and `lobby/runLobby.test.ts` passed 24 tests. The combined run was stopped while `productionBots/bots.test.ts` remained unfinished; that suite is unverified, not a reported pass or assertion failure. The first attempt hit sandbox filesystem restrictions; the retry ran with approval. No current hero/card strength rankings or throughput estimates were measured. Runtime defect reproductions, complete mechanic census and statistical calibration are explicitly B0/B1 work, not claimed completed here.
