# The proc harness — design

**Date:** 2026-07-28
**Status:** approved (owner, 2026-07-28)
**Phase:** ② of three. ① (bindings as data) shipped 2026-07-27. ③ is the authoring panel that ties ① and ②
together behind a "commit animation" button offering card-only or global scope.

## The problem

Authoring a visual effect for a card currently means tuning it against a synthetic stage — two staged
anchors, a scenario, a Fire button — and then *hoping* it reads correctly in a real fight. The only way to
see it on the real card at real scale is to play until the moment happens to occur, which for a periodic
proc (Bloodbinder's bleed fires every fourth attack) can be many beats into a fight you don't control.

The gap is not "we can't play the effect". `window.__fx.play` already fires any def at any anchors. The gap
is **watching it in the real thing, on demand, repeatably** — with the card at its real size, in its real
slot, surrounded by the sound and damage numbers and recoil it has to sit inside.

Three findings shaped the design:

- **`lastCombat` is a single slot**, replaced every wave, and its object identity is deliberately held stable
  because a reference change is what resets the replay. There is no history of past combats.
- **The replay driver has no seek.** `beatIdx` only increments, resets to 0, or jumps to the end; the sole
  reset trigger is a `[combat]` reference change. "Play that moment again" has no existing hook.
- **`computeFrame` is a from-scratch fold** (`initial.player.map(fromSnap)`, then a loop from event 0 to
  `upto`). The board at any beat is a pure function of `(initial, events, upto)` — so seeking is *trivially*
  correct for board state, with no incremental state to repair. This is what makes ② affordable.

## Decisions

| Question | Chosen | Rejected, and why |
|---|---|---|
| Where the combat comes from | A **staged** fight, run on demand | The wave you happened to fight — every iteration then depends on a fight you can't control, which is the problem the tool exists to kill |
| What's in it | **Your current board vs N tunable sandbags** | The card alone — silently misrepresents any card that reads the board, and many do. A real pooled opponent — back to hoping |
| Fidelity | **A run-up**: seek to a few beats before, play through | Effect-only (can't show "great alone, invisible in the fight"). Whole-moment-in-isolation (same blind spot, less run-up context) |
| Where it lives | The **workbench collapses to a rail** and hosts the harness | A separate floating panel — loses the tune → watch → tune loop to a context switch. SceneBuilder — splits the tool from the thing being tuned |

## Architecture

```
pick card → stage board + sandbags → fight (the REAL faceOmen path)
          → scan lastCombat for that card's moments → pick one
          → seek to (moment − runUp) → plays through → auto-pause
          → tune → seek again
```

**Staging dispatches a real `faceOmen`** rather than calling `simulate()` on the side. This inherits
SceneBuilder's philosophy — *"it mutates the LIVE run via the store, so every real system runs exactly as in
a normal game; nothing bypasses the sim"* — and means `run.lastCombat` is populated the ordinary way, so the
replay hook, the board renderer, the choreo engine and the FX bridge all work untouched.

The alternative, constructing a `CombatResult` and injecting it, requires substituting it at the
`useCombatReplay` call site *and* forcing `combatStage` to `'fighting'` from outside — two new seams in the
file every fight runs through, to avoid advancing a wave counter in a sandbox run. Not worth it.

**Accepted consequence:** staging advances the run's wave. The harness resets it via the same direct
`mutate()` SceneBuilder already uses for gold and tier, so re-staging is unbounded.

## Units

Each is independently testable and has one job.

### `packages/ui/src/fx/harness/procScan.ts` — pure

Answers "which moments did this card cause".

```ts
export interface ProcMoment {
  /** Index into the compiled moments array — what `seekTo` takes. */
  index: number;
  kind: MomentKind;
  /** The acting unit, for the label and for anchoring. */
  sourceUid: string;
  /** What `bindingFor` says would play here, or null when nothing is bound. */
  boundDef: string | null;
}

export function scanProcs(combat: CombatResult, cardId: string): ProcMoment[];
```

Builds the reverse map (cardId → uids) from `initial.player` + `initial.enemy` + every `summon` event's
`minion` — the same two sources `cardIds` already folds in `useCombatReplay`, just inverted. Then
`compileMoments(events)` (pure, cheap, documented safe to call repeatedly outside the hook) and keeps moments
whose acting unit is one of those uids. The acting unit is `primary.attacker` for an `attack`, else
`primary.source`.

`boundDef` comes from `bindingFor(cardId, kind)`. Showing it in the list — including `null` — is what makes
"this moment has no effect yet" visible rather than something you discover by watching nothing happen.

### `packages/ui/src/fx/harness/procStage.ts` — pure

Turns "N sandbags at H hp / A attack" into the board patch and the wave reset, as data. Pure so the staging
rules are testable without a store. Mirrors SceneBuilder's existing `setEnemies` shape.

### `seekTo` in `packages/ui/src/useCombatReplay.ts` — the one hot-file change

An extraction, not new machinery. The existing `[combat]` reset effect already clears fourteen pieces of
transient state (floats, death floats, pulse timers, triggers, rally pulses, finished, attack uid, projectiles,
shake, shaking, crit-shaking, hand grant, stat holds, stat flashes) and kills stray GSAP tweens. That body
becomes `resetTo(index)`; the effect calls `resetTo(0)`; the hook exports `seekTo(index)`.

Correct by construction: `computeFrame` rebuilds from `initial` on every call, so a jump cannot desynchronise
board state. The transient UI state that *would* be stale is exactly the set the reset already clears.

### `packages/ui/src/fx/harness/ProcHarness.tsx` — the rail UI

Card picker, sandbag knobs (count / HP / attack), **Stage fight**, the moment list, a run-up slider,
**Replay**.

### Workbench rail mode

The workbench collapses its panels to one side and hosts `ProcHarness`. The mode is a **separate hosted
component**, not another branch threaded through `Workbench.tsx` — that file is already large, and ③ needs
somewhere clean to land.

## Integration details

**The workbench currently pauses the fight.** `Recruit.tsx` passes `paused: overlayOpen`, and the workbench
is an overlay — so today, opening it freezes combat. Rail mode must exempt itself or the harness watches a
permanently-still board. One condition, but the kind of thing that otherwise surfaces in the browser at the
end rather than in the design at the start.

> **SUPERSEDED (2026-07-28):** false — `overlayOpen` never included the workbench, whose open state lives in
> local `DevMenu` state, so there was no exemption to make. See the devlog's 2026-07-28 proc-harness entry.

**Auto-pause after the moment** reuses that same `paused` plumbing: `seekTo` records a stop beat; when
`beatIdx` reaches it the harness pauses. No new clock machinery.

> **SUPERSEDED (2026-07-28):** not built — after a seek, playback runs on to the end of the fight instead of
> stopping at the moment. See the devlog's 2026-07-28 proc-harness entry (Follow-ups).

**Failure is loud.** A staged fight containing no moments for the chosen card says so explicitly — *"no
moments from Bloodbinder in this fight; try more sandbag HP"* — rather than rendering an empty list, which
reads identically to "the scan is broken". Every significant defect in this subsystem so far has presented as
"nothing happened"; the standing rule is that the tool must distinguish *nothing to show* from *failed to
show*.

## Testing

- `scanProcs` — against fixture combats: finds a card's moments, ignores other cards', covers summoned
  instances, returns `boundDef` including null, and returns empty (not throwing) for a card that never acted.
- `procStage` — the board patch and wave reset are what they claim, at the range extremes.
- `seekTo` — **the property the whole feature rests on**: seeking to beat N produces the same frame as
  playing forward to beat N. Asserted directly against `computeFrame`.

## Scope

**In:** the four units above, rail mode, and the tests.

**Out:** any change to what an effect *is* or how it's bound (that was ①). The "commit animation" button and
per-card vs global scope (that's ③). Multi-combat history — the harness works against the fight it just
staged. Real pooled opponents — sandbags only; the final look-check against a real board stays a manual
step until it earns automation.
