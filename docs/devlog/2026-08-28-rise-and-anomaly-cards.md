# 2026-08-28 — Rise return-stat precision, the exact-copy contract fix, and readable anomaly cards

Three items from the owner's 2026-08-28 triage, all in the rules/Doc-Bot seam. No gameplay changed: every
engine behaviour ruled on here was measured first and already conformed.

## 1. Rise returns at base BEFORE auras (`q-conv-keyword-r`, REVISE)

Owner, verbatim: *"it returns with 1 health and base attack before any auras or effects are added, i.e.
undead aura."*

This sharpens `R-AVWIN-11` (Rise returns at base Attack / 1 Health) with an **ordering**: the return stats are
the printed base taken *before* any Aura or standing effect, and the Auras are then re-applied to the
returned body normally — not baked into the return, and not skipped. Encoded as a NEW approved rule
**`R-RISE-01`** rather than by editing `R-AVWIN-11` (ids are never recycled, and the owner's wording is its own
evidence); `R-AVWIN-11`'s `currentBehaviour` now cross-references it.

**The engine matches.** `simulate.ts`'s Rise branch resets to `def.attack × (golden ? 2 : 1)` / Health 1, sheds
granted keywords, instance buffs and rally gifts, and only then calls `applyAuras(minion, true)` — the
from-base pass that re-adds each side-scoped Aura *including* the buy-time slices. Nothing was pinned as a
violation; `KNOWN_VIOLATIONS` stays at two entries.

**The probe** (`temporalWindow.test.ts`, three cases) distinguishes all three candidate readings from one
fixture — a 1/1 Undead Footman grown to 9/9 with Rise printed:

| aura | base-then-aura (ruled) | auras skipped | aura baked into base |
| --- | --- | --- | --- |
| none | **1 / 1** | 1 / 1 | 9 / 9 |
| Undead +3/+2 (+1 buy slice) | **5 / 3** | 1 / 1 | 12 / 11 |
| same, Gilded | **6 / 3** | 2 / 1 | — |

The gilded case also pins that the gild doubles the *printed base only* — the Aura lands on top at face value.

## 2. A xerox copy is identical in every way (`q-interact2-2ad14500`, REVISE)

Owner, verbatim: *"I do not understand this ask. simply put a xerox copy should be an exact copy, so
identical in every way."* Two separate failures behind that.

**(a) The contract, not the engine.** The anomaly oracle's `copied-source-unexpected-state` detector flagged an
exact copy (Xerox) of a gilded Kennelmaster carrying the source's **gilding**, because `kennel`'s
`copySubject.rides` listed only the `summonBonus` channel. The behaviour is intended (R-COPY-02); the
CONTRACT was incomplete. `packages/rules/src/contracts/curated/index.ts` now states gilding *and* every other
card-owned instance property as riding an exact copy, with the engine-owned queue state stated as shed.

Re-running the oracle: the copy anomaly is **gone**, and the test proves it is gone for the right reason —
the copy probe still measures a gilded, progressed subject, the detector's suppressed count for that class is
zero (nothing was floored away), and a planted subject whose contract does *not* state the rides
(`wolvesden`) still fires.

**(b) The instrument.** The card itself failed the self-contained bar — the owner could not tell what was
being asked. `interactionQuestions.ts` was rewritten so every anomaly card says, on its face: what was
OBSERVED, then what ✓ and ✕ each MEAN, in one sentence at the fly-through bar. Before / after:

> **Before:** "hero:xerox + Kennelmaster: a copy carries per-instance state the card's contract never states
> as riding — intended?" · *Measured: rides stated: [accrued-improve-counters (summonBonus)] where the
> structural expectation was copySubject.rides ⊇ [gilding].*
>
> **After:** "hero:xerox + Kennelmaster: the copy came out carrying the original's own instance state.
> ✓ = intended, copies carry it; ✕ = the copy carries too much" · *What the probe recorded: … What the
> card/contract implied instead: …*

The ✓/✕ mapping was also **inverted** against the recommendation field (the statement offered ✓ as "intended"
while the recommendation said approve endorsed the *bug* reading) — an unanswerable card. The board-wide
convention now holds: **✓ approves the measured behaviour, ✕ calls it a bug**, and `APPROVE_ENDORSES` binds the
readings to the clicks explicitly.

New suite `interactionQuestions.test.ts` pins the template **per detector, independently of the live deck** —
today's deck is empty, so `rules.test.ts`'s format assertions over `INTERACTION_PENDING` pass vacuously and
would not catch a regression.

## 3. The composition law (`q-interact2-32aa654f` / `q-interact2-faeb3c44`, APPROVE)

Both cards asked how Uron's and Chronos's `endOfTurn` / `startOfCombat` multipliers compose, with no ruled
law. The approvals endorse Reading A — *"fold like the ruled ones: additive within a family, best-of across
non-stacking cards"* — encoded as standing rule **`R-MULT-02`**: the law is **family-agnostic**, so a family needs
no ruling of its own. `endOfTurn` and `startOfCombat` joined the anomaly oracle's
`RULED_MULTIPLIER_FAMILIES`, which is the *only* legitimate way that set grows.

Pinned by two new matrix fixtures: **P12** (End of Turn — Uron + Chronos collapse to 2×, not 3×; gild doubles a
contribution; the Chrono Staff one-shot adds on top of the collapsed fold) and **P13** (Start of Combat in real
combat — Uron makes the whole pass run twice). This also resolves `docs/rulebook/interaction-ambiguities.md`
**Q1**.

## Consequence: the Sitting-2 deck regenerates EMPTY

All three anomalies were causes, not questions, once ruled — so `npm run docbot:interactions` now writes an
empty `pendingInteractions.generated.ts`, and the three ids are hand-tombstoned in `registry/retired.ts` with
their dispositions. The live anomaly count is 0 with **24 visibly suppressed** below the floor (unchanged
uncertain detectors). `anomalyOracle.test.ts`'s live-sweep assertion is now a **canary, not a target**: a new
anomaly appearing there is healthy — it becomes a Sitting card — and the count is updated with the story,
never by loosening a detector.

## Landmine for whoever lands the owner's 2026-08-28 decisions

`packages/rules/src/registry/decisions.json` is NOT touched by this PR (it was uncommitted in the primary
checkout, and four sessions are in flight). Committing that block decides every remaining card, which takes
`undecided()` to **zero** — and `packages/ui/src/RulebookTriage.test.tsx` mounts against the LIVE registry and
requires at least one undecided card (`undecided()[0]!.id`), so all eight of its fly-through tests fail with
`Cannot read properties of undefined`. That suite needs a synthetic pending fixture before, or in, the PR
that lands the decisions.
