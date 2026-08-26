# Doc Bot → QA machine: limitations, circumventions, and the build order

Doc Bot today (tripwires 1–12) is a **tripwire layer**: it proves wiring exists and that effects *act*. This
document states exactly what it cannot see, how each blind spot is circumvented, and the order in which the
circumventions should be built. It is the execution plan for the owner's Interaction Verification Lab
blueprint (Codex, 2026-06-29) — every phase below cites the blueprint section it implements, because the
blueprint already designed most of this; Doc Bot's job is to reach it incrementally, with each increment
catching real bugs on the day it lands (as tripwires 1–12 each did).

**Goal restated honestly:** find MOST bugs in a current build and surface the rest as verified-reachable
questions for human confirmation. Not: find every bug, judge balance, or see pixels.

---

## The limitations, explicitly

| # | Limitation | Consequence | Circumvention | Blueprint § |
|---|---|---|---|---|
| L1 | **One fixture, one fight.** Differentials run a single scenario. | A card correct mid-game but wrong at a boundary (full board, 0 Gold, exact threshold, empty shop, slot 0/6) passes. | **Scenario matrix**: parameterize the existing fixtures over a small covering array — board fullness × Gold × tier × position × golden — and run every differential lane across it. The lanes already exist; this multiplies them. | §18.3 |
| L2 | **Presence ≠ correctness.** The differentials prove an effect *does something*, not the *right amount to the right target*. | +2/+2 coded as +4/+2 passes every current lane. | **Magnitude oracles**: for the stat/summon-shaped families (the majority of effects), assert the normalized delta EQUALS the params — attack/health × golden × improve reps; summon count = `count` × golden. The diff machinery already isolates the delta; this compares it to the contract instead of to nothing. | §19.1–19.2 |
| L3 | **Condition-gated queues** (54 combat + 5 play + 14 spells). | Cards whose trigger the generic scenario doesn't stage are *unverified*, only *queued*. | **Trigger stagers**: a library of tiny scenario-builders keyed by factory family — an adjacent-Battlecry neighbour for Ryme, an Echo neighbour for Dawnclaw, a guaranteed own-kill for Moe, a pre-cast Ale for Oaf. Each stager drains queue entries into verified-active. The 54 are enumerable; this is mechanical work, not research. | §9 (Scenario Forge) |
| L4 | **No pairwise interactions.** Every lane tests one card alone. | The #900/#897/#4b2 class — a repeater that misses a family member, copy semantics dropping per-instance state, aura stacking — is invisible. | **Applicable-pair matrix, seeded from data we already have**: the multiplier cards are now *empirically known* (the control-body hunt found them: Drakko, Sylus, Chronos, Uron, Zyff…). Run each multiplier × one representative per effect family and assert the multiplied run differs correctly from the plain run. Add the **additivity metamorphic**: two independent buff sources equal the sum of each alone. | §16–17, §19.3 |
| L5 | **Hero powers uncovered.** 59 heroes, 58 power kinds, no differential. | A power that silently no-ops (the adopted-power routing class, §13.5) ships. | **Hero-power lane**: the play-differential pattern via the real `{type:'heroPower'}` action for active kinds; a per-kind stager for passive/threshold kinds (58 kinds, enumerable). | §13 |
| L6 | **One seed.** Random-selection effects are sampled once. | An eligibility bug on an unexplored rng branch passes. | **Multi-seed eligibility sweeps**: for every random-target factory, N seeds; assert each sampled target was eligible, and that across seeds every eligible class is reached. Deterministic assertions only — no distribution testing gates CI. | §19.5 |
| L7 | **Shallow fuzz.** 70 steps ≈ a few rounds; invariants but no deep oracle. | Late-run and cross-round bugs (accrual drift, snapshot decay) escape. | Three upgrades: (a) **snapshot-restore equivalence** inside the fuzz — restoring mid-trajectory must equal the uninterrupted run, which catches the whole #453/#888 snapshot class *generically*; (b) **coverage-guided retention** — keep seeds that reach new factories/triggers, so the corpus deepens itself; (c) a **nightly long-lifecycle lane** (full runs to elimination) that doesn't gate PRs. | §28, §19.3 |
| L8 | **UI/FX/render invisible** (~half of historical fixes). | A pill that flashes, an FX that fires twice, a cursor that breaks — never seen. | Partially: the **presentation parity oracle** — `reduceWithPresentation` must produce the same gameplay state as `reduce` for every fuzz trajectory (headless, cheap). The truly visual half stays human + Mike's harness; Doc Bot must say so rather than imply coverage. | §19 (presentationOracle) |
| L9 | **Registries encode my judgment.** An excuse wrong on my say-so silences a real bug. | Hidden bug with a confident label. | Three mechanisms: excuse diffs are a named PR-review item; every `needs-triage` ruling converts into either an implementation or a *probe* that proves the excused claim (an excuse that says "handled at settle" gets a settle-time assertion); queues are two-sided ratchets so they only move under review. | §20 |
| L10 | **Balance/design wrongness invisible.** A mechanically perfect card can still be mis-designed. | Out of scope, permanently. | Telemetric flags only (event volume, unbounded-economy detection in the fuzz) reported separately — never as failures. The blueprint is explicit that balance is not a correctness oracle. | §3.2, §33 |

---

## Status after the 2026-08-26 build-out (tripwires 13–15 + lane upgrades)

| Limitation | Status |
|---|---|
| L1 scenario space | **Combat: done** — seven staged variants, inert queue 54 → 7. Play lane still runs one fixture (+targeted enrichments); its variants are the next increment. |
| L2 magnitude | **Done for 3 contracts** (`spellBuffTarget`, `battlecryBuffTarget`, `deathrattleSummon` incl. `fixed`/`goldenTokens`) — tripwire 13. Growth = one contract per family as each is ruled unambiguous. |
| L3 conditional queues | **Largely drained**: combat 54 → 7; hero fixture drained Myra/Djinn; play queue at 5 excused + gravebody. |
| L4 interactions | **First order done** — tripwire 14: multiplier × family with EXACT doubling (the #900/#897 genus), additivity metamorphic, eligibility sweeps. Copy-semantics probes remain. |
| L5 hero powers | **Done** — tripwire 15: 34 verified active through the real action; 25 passive/scheduled pinned by kind. Staging the passive kinds is the next increment. |
| L6 randomness | **Done for tribe-random targets** (10-seed eligibility). Distribution telemetry deliberately not gating. |
| L7 fuzz depth | **Serialize-resume equivalence + presentation parity added.** Coverage-guided retention and the nightly lifecycle lane remain (the nightly lane needs a workflow file — owner call). |
| L8 UI | Presentation parity (the machine-checkable half) **done**; the visual half stays human, as stated. |
| L9 registries | Process unchanged: excuse diffs in review, rulings → probes. |

Instrument catches during this build-out, all recorded in code: partial-result serialization hid economy
carry-backs (Moe); uid-keyed masking never fired on remapped uids; trigger telemetry (`playerDeathrattles`,
quest events) masked dead factories; `initial`'s golden flag made the golden lane vacuous; Blessing's doubled
effect, Emissary's tribe gate and two-step aim, and Manasaber's `fixed` taught the magnitude oracle its own
contracts; the stable-stringify lesson appeared a third time in serialize-resume.

## MEASURED coverage — retro-validation (2026-08-26, the harness in packages/tools/retro/)

Estimates were replaced by measurement: eight out-of-sample historical bugs were REINJECTED at the source
line and run against the full Doc Bot suite. **Before the miss-driven build-out: 0 of 8 caught.** The misses
built tripwires 16 (the 135-key combat-mod lane) and 17 (copy semantics, watcher ordering, chain
multipliers, the combat-castable registry). **After: 7 of 8.**

| Reinjected bug | Before | After | Caught by |
|---|---|---|---|
| #941 Aftershocks paid per rattle-watcher | MISSED | **CAUGHT** | mod-lane rider (delta 16 vs 0) |
| #932 Undertow warded unbounded | MISSED | **CAUGHT** | mod-lane rider (8 > cap 4) |
| #832 Soulbind matched the wrong uid | MISSED | **CAUGHT** | mod-lane inert pin |
| #986 summon watchers out of board order | MISSED | **CAUGHT** | ordering oracle (Oona/Beardsley non-commuting) |
| #933 triples kept temporary keywords | MISSED | **CAUGHT** | copy-semantics probe |
| #897 Echohorn chain dropped Sylus | MISSED | **CAUGHT** | chain-multiplier oracle (exact 2×) |
| #1111 Beefy/Lantern Light fizzled | MISSED | **CAUGHT** | combat-castable registry |
| #1176 Avenge counted the whole fight | MISSED | MISSED | honest gap: per-instance counter windows need the contract layer; no deterministic summon-an-Avenge-body stager exists, and its own regression test lives in-repo |

The five in-sample bugs (this week's, which tripwires 1–8 were built from) were already caught by their
sabotage checks — 12 of 13 total. The harness catalog grows one entry per interesting future fix; a MISS is
the build signal for the next generic oracle. This corrects the earlier ESTIMATED 65–75% claim: what was
measured this morning was ~30% wiring-only, and the number that now stands is measured, not guessed.

## Build order — each phase ships value the day it lands

Ordered by (bugs caught per effort), using the historical fix log as the yield estimator.

**Phase A — correctness, not just presence (L2 + L1). ~2 days.**
Magnitude oracles for the stat/summon families, then the scenario matrix multiplying all lanes.
*This is the single biggest jump*: it converts "acted" into "acted correctly" for the majority of effects,
and boundary scenarios catch the full-board/threshold class (#1176, #695, Funeral-on-Loan's cousin bugs).

**Phase B — drain the queues (L3 + L5). ~3 days.**
Trigger stagers until the 54-card combat queue and 5-card play queue read near zero; the hero-power lane for
all 58 kinds. After this, "unverified" stops being a category with members and starts being an authoring-time
event.

**Phase C — interactions (L4). ~3 days.**
Multiplier × family matrix, additivity metamorphic, copy-semantics probes (what a copy inherits: gilded
state, buffs, counters, once-latches — §15.2's table as assertions). This is where #900's whole genus lives.

**Phase D — depth and fidelity (L6 + L7 + L8-partial). ~2 days.**
Multi-seed eligibility, snapshot-restore equivalence in the fuzz, presentation parity, nightly lifecycle lane.

**Phase E — the standing loop (L9). Ongoing, process not code.**
Weekly: run `npm run docbot`, rule on the top of each queue, convert rulings to probes or fixes, lower the
pins. The queues are the QA backlog; the ratchets make draining them permanent.

## What "most bugs" honestly means at the end of this

Measured against the ~480-commit fix history: tripwires 1–12 would have caught or prevented roughly **30%**
of sim/core gameplay fixes. Phases A–D raise that to an estimated **65–75% of sim/core** bugs — magnitude
errors, boundary failures, silent interactions, snapshot drift, and eligibility bugs all gain generic
detection. Against ALL bugs including UI/FX, the ceiling is ~50%, because the render half needs eyes; Doc
Bot's job there is only parity (the gameplay state under presentation must match the gameplay state without).

Two properties matter more than the percentages:
1. **Every failure is a minimal, deterministic, named reproduction** — a card id, a scenario, both values.
   Nothing lands as "something seems off".
2. **Everything unverified is a visible queue entry, never silence.** The system's honest answer set is
   {verified-correct, verified-bug, queued-with-reason} — and the third category only shrinks.

## Standing doctrine (unchanged, and the reason to trust the rest)

Worklists re-derive from content and source. Excuses carry verifiable reasons or `needs-triage`. Every new
lane is **sabotage-proofed before it ships** — reintroduce a real bug, demand the alarm, treat a silent alarm
as an instrument bug (this discipline caught the instrument itself five times while building 1–12: Drakko,
Sylus, JSON key-order, `flagCopies` masking, event-bookkeeping masking). An instrument that cannot fail its
own sabotage check does not get to call anything verified.
