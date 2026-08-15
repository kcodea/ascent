# Beat Lab — remaining work (handoff)

**Status as of 2026-08-14.** The Beat Lab's core is shipped and on `main`. This document scopes the two
remaining phases we intend to build, the seams they touch, and the one hard problem each carries. It exists so
the next session can pick up without re-deriving the architecture.

> Prereq reading: [`docs/superpowers/specs/2026-07-06-combat-choreographer-design.md`](superpowers/specs/2026-07-06-combat-choreographer-design.md)
> (the original moment-compiler spec — its "phase 4" forward-notes are exactly Phase A below).

---

## Where the tool is TODAY (baseline — do not rebuild)

- **End of Turn** — fully authored. `ownBeat`/`foldedCue` restructures the sequence; holds pace real playback
  with LIVE on; **Commit to repo** bakes into `beat-defaults.json`. This is the tool working as designed.
- **Combat** — **re-timing only.** Combat runs on *moments* compiled mechanically from the sim event log
  (`compileMoments` + `DEFAULT_RULES`, grouped by event **type**). The Lab can stretch/shrink the `holdMs` of
  the moments that grouping happens to produce, gated by the **LIVE toggle** (PR: `feat/beatlab-live-drives-combat`,
  the single switch — no more `ascent.combatbeats` console flag). It **cannot** decide which events form a
  moment, so it cannot carve out a proc the grouping rules currently fold away.
- **Shop actions** — inspect-only, instant by design (owner ruling 2026-08-14: "shop actions MUST remain
  immediate"). Not a gap; a permanent design state.
- **Capture / Library / Combat tabs** — inspection surfaces (source-attributed beat tree; every registered
  effect + its `ownBeat`/`foldedCue`/`passive`/`silent` classification; last-fight timeline).

### The current combat pipeline (so the gap is unambiguous)

```
simulate() ──▶ flat CombatEvent[] ──▶ replayOrder() ──▶ compileMoments(DEFAULT_RULES) ──▶ moments (= beats)
                                                                                              │
                              useCombatReplay walks moments; holdMs(next, shown) paces them ──┘
                              PixiFxLayer renders each moment's FX via bindingFor(cardId, kind)
```

Grouping is **type-based** (`compile.ts` `DEFAULT_RULES`): result runs collapse; buff runs collapse; and
`buff`/`summon`/`rally`/`improve`/`tribeAura` adjacent to an attack are **absorbed into the swing's wind-up**.
So a proc becomes a beat only by accident of *where it sits in the log*. Oona's `onSummon` buff got its own
moment because it landed between two summons; the same buff next to an attack would vanish into the swing.

---

## Phase A — combat gets real "own beats" (identity-aware grouping)

**Goal.** Let a specific combat proc be **guaranteed to exist as a discrete, held, addressable moment** —
never absorbed, never collapsed — regardless of where it falls in the event log. "Own beat" here means
*structurally distinct*, not merely *held longer*.

**Why first.** Phase B (FX-on-beat) has nowhere to attach until a proc is a real, identity-addressable
moment. Build A before B.

### The core change

`compileMoments` groups by **event type** today. Phase A makes grouping **identity-aware**, using the
`key` / `srcCard` the simulator already stamps on combat events (PR 23). Concretely:

- Extend `GroupingRules` beyond `Set<type>` membership to **predicate/key-based rules** (the spec's phase-4
  `chain` / `splitPerTarget`, already flagged in `compile.ts:18-21`).
- Add an **"isolate" rule**: an event whose stamped `key` is classified `ownBeat` is forced into its own
  moment — exempt from `collapseRuns` and, critically, from `absorbIntoWindup`.
- Source the per-key policy from the **same registry + Lab draft** the timing path already reads
  (`PRESENTATION_POLICIES` + `combatKeyedHoldMs`'s resolution), so the Lab's `ownBeat` flip drives *structure*,
  not just duration.

### Files / seams

| File | Role in Phase A |
|---|---|
| `packages/ui/src/choreo/compile.ts` | `GroupingRules` + `compileMoments` — the grouping change lives here. `buildBeats` is the equivalence ORACLE; **do not** delete it or make the two delegate. |
| `packages/ui/src/choreo/clock.ts` | `holdMs` + `KEYED_HOLD_KINDS` — already applies keyed holds; a now-isolated moment should read its `ownBeat` completion offset. |
| `packages/ui/src/choreographer/combatHolds.ts` | `combatKeyedHoldMs` — the policy/timing resolution for a stamped key. Structure decisions should read the same resolved policy. |
| `packages/core/src/combat/simulate.ts` | Already stamps `key`/`srcCard` (PR 23). No sim change expected — identity is present. |
| `packages/ui/src/useCombatReplay.ts` | Consumes `beats`; verify an isolated moment schedules + reads cleanly (watch the summon-withholding / death-lead machinery — the source of the earlier hang). |

### The hard problem

**Absorption vs isolation without breaking engine-coupled pacing.** The earlier combat hang (Oona+Pack, 12s
vs 1.7s) came from overriding a **summon**'s hold — summon withholding, cue release and death leads are
engine-coupled. Pulling a proc *out* of `absorbIntoWindup` must not destabilize the swing it was riding.
Isolation has to be proven on a real fight (harness + paired timing measurement), not just unit tests. The
`KEYED_HOLD_KINDS` safe-list is the precedent: expand structure-authoring only over moments whose scheduling
is a plain timeout.

### Done when

- A Lab `ownBeat` flip on a combat proc makes it a **visibly distinct, held moment** in a real fight where the
  proc fires — even when it sits adjacent to an attack (the absorb case).
- `foldedCue` restores today's absorbed/collapsed behavior byte-for-byte.
- No fight regresses in wall-clock (harness paired-measurement, prod build).
- `buildBeats` equivalence tests still pass for the default (unauthored) path.

---

## Phase B — assign FX from the workbench to a beat

**Goal.** From the Lab: pick a trigger (now a real own-beat, per Phase A), choose an effect from the FX
catalog, preview it, and commit — so that FX plays during that beat in real fights.

**Good news: the machinery mostly exists.** This is joining two systems built to the same
draft→LIVE→commit shape, not new infrastructure.

### What already exists

| Piece | Location | Note |
|---|---|---|
| **FX catalog** (the "workbench" output) | `packages/ui/src/fx/defs/*.json` | ~40 named, **enumerable** defs (`flame-ring`, `self-buff-gold`, `hp-grant`, `ruby-lance`…). |
| **FX workbench UI + runtime** | `packages/ui/src/fx/harness/ProcHarness.tsx`, `CommitPanel.tsx`; `fx/registry.ts`, `fx/playDef.ts`, `fx/fxRuntime.ts` | Authors/plays a def by name. Reuse `ProcHarness` for the Lab's preview. |
| **Trigger→FX binding table** | `packages/ui/src/choreo/bindings.json` + `bindings.ts` | Maps `(cardId, kind) → { def, fanOut }`. Has `bindingFor()` (combat read) and `setBinding()` with **draft + commit** semantics mirroring the Lab's own. |
| **Combat already renders bindings** | `PixiFxLayer` via `bindingFor` → `playDef` | The consume side is done. |

So Phase B is: **a per-trigger FX control in the Lab** — a dropdown populated from `fx/defs/`, a `fanOut`
selector, a `ProcHarness` preview — that writes through `setBinding` and commits to `bindings.json`.

### The hard problem

**Identity reconciliation (same theme as PR 1/23).** The Lab keys by **trigger identity**
(`source:minion:b2_oona:onSummon`). The binding table keys by **`(cardId, moment-kind)`** (`b2_oona`,
`buffWave`). These are different axes. Phase B must map Lab identity → binding key **without guessing** — the
mapping is only unambiguous once Phase A makes the proc a single addressable moment (another reason A precedes
B). Decide: extend `bindings` to accept the registry key directly, or derive `(cardId, kind)` from the stamped
event at bind time.

### Done when

- Selecting a combat trigger in the Lab shows its current FX (or "none") and an enumerable catalog dropdown.
- Assigning a def previews via `ProcHarness` and, with LIVE on, plays during that proc's beat in a real fight.
- Commit writes `bindings.json`; the write and the `bindingFor` read cannot disagree about the key.

---

## Deferred / optional (owner's call — not scheduled)

- Review the **~29 remaining `flag`ged** classifications in the Library (correctness pass on the registry).
- Retire the legacy End-of-Turn playback path once the choreographer path is trusted everywhere.
- Promote committed **combat** values to always-on (drop even the LIVE-toggle gate) once confident.
- **Reactive hero payouts** (sellGold, fourPeat, recurringGoldcrafter) are deliberately **not** emitted —
  they fire during shop actions, which stay instant. Leave un-wired unless the instant-shop ruling changes.

## Recommended order

1. **Phase A** (identity-aware grouping) — unblocks everything, carries the real risk (engine-coupled pacing).
   Prove on the harness before touching the Library UI.
2. **Phase B** (FX assignment) — mostly wiring two existing systems; the only novelty is the key mapping,
   which A makes tractable.

Do **not** start B before A: FX would have no stable beat to attach to, and the key mapping stays ambiguous.

---

## Real-time presentation queue (owner priority, 2026-08-14)

The owner's directive: EVERYTHING should present in real time on its beat, not snap in at resolution/commit.

1. **EoT edge cases — IN PROGRESS.** `cardSummoned` + `keywordChanged` at End of Turn (only reachable via
   Moira re-firing a summoner / keyword-granter Shout) still snap in at commit. Same shape as the shop-consume
   fix: emit the consequence + project into `displayBoard` / keyword pips + an on-beat animation. (The reported
   bugs — ruby strength, shop consume, Discover grants — are already fixed/merged or up as #1048.)
2. **Combat real-time — NEXT.** Combat replays its own event log on a separate runtime from the EoT
   choreographer; mid-fight summons, hand-grants and buffs are a distinct animation system. Needs live
   verification per increment (pair on a real fight — headless can't reproduce boards).
3. **Funeral on Loan / borrowed-Echo class — 3rd priority (GAMEPLAY bug, not presentation).** `funeral_on_loan`
   (Set 1 spell, `discoverOnPlay: { filter: 'deathrattle', borrowed: true }`) discovers a borrowed Echo
   minion that should fire its Echo (Deathrattle) and self-destroy when played that turn. Owner report: **some
   Echo cards don't properly trigger their effect when played borrowed, and the card is janky in general.**
   Investigate the whole borrowed-Echo path — `triggerBorrowedEcho` (recruit.ts), the `borrowed` flag flow
   through play → Echo resolution → destroy, and `borrowedEcho.test.ts` coverage gaps. Cover the CLASS (any
   borrowed Echo), not just one card.
