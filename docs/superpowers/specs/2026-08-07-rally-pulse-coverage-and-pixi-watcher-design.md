# Rally pulse coverage + Pixi watcher effect

**Date:** 2026-08-07
**Status:** Design approved, pending spec review
**Follows:** the rally beat choreography feature (PR #918, branch `feat/rally-beat-choreography`). This work extends that branch.
**Owner ask:** *"every single unit with a rally effect needs to pause with their medallion flashing. every single one."* + *"can i create a pixi effect for the watcher effect instead? ... i want to build it in the fx workshop."*

## Goal

Two follow-ups to the rally beat:

- **A — every rally pulses.** Close the coverage gap so *every* rally card flashes its pulse at `T`, including rallies whose effect fires outside the attack beat.
- **B — Pixi watcher effect.** Replace the watcher's CSS frame pulse with a ring-bloom Pixi effect the owner authors in the FX workshop; this spec covers the wiring, not the visual.

Both are presentation/choreography changes. **A touches the sim layer** with a cosmetic marker event (no gameplay change); B is UI-only plus one owner-authored def.

---

## Piece A — every rally pulses (sim `rallyPulse` marker)

### The gap

The pulse currently fires only if the unit has the `RL` keyword **or** its rally effect emits an event *inside* the attack beat (which the classifier `rallyPulseUnits` scans). A rally whose effect is a **shop/economy mutation** logs in a separate trailing beat and, without `RL`, is caught by neither trigger. Confirmed gaps: **Demon Horse** (`dm_hungerling`, self-rally, buffs the Shop) and **Mineral Master** (`k_mineralmaster`, watcher, "play Rubies"). The root cause: the pulse is tied to the *effect's* FX, when it should be tied to the fact that a *rally fired*.

### Design

A new **cosmetic** combat event marks when a unit's on-attack rally actually acts, so the pulse no longer depends on the effect's own FX.

- **New event type** (`packages/core/src/types.ts`): `{ type: 'rallyPulse'; source: string }` — `source` is the unit whose rally acted. Carries no amount, no target, no gameplay payload.
- **Emit point** (`packages/core/src/combat/simulate.ts`, the `bus.emit('onAttack', …)` dispatch ~line 1601): bracket **only the on-attack effect firing** (not the strike damage). Snapshot the combat-log length immediately before and after an attacker's/watcher's on-attack effect runs; if the log grew, that unit's rally *acted* → emit one `rallyPulse` for that unit. A watcher whose handler early-returns on its own non-triggering swing appends nothing → no marker. This is the discriminator: **acted = appended to the log**.
  - Must be scoped so an attacker's ordinary strike `dmg` (appended later in attack resolution) never triggers a spurious `rallyPulse`. The snapshot brackets the on-attack *effect* dispatch, not the whole swing.
  - One marker per acting unit per swing (dedup is the classifier's existing first-per-source behavior; still, avoid emitting duplicates for a multi-effect unit).
- **Absorption** (`packages/ui/src/choreo/compile.ts`): add `rallyPulse` to `absorbIntoWindup`, so the marker lands inside the attacker's wind-up moment where the classifier reads it.
- **Classifier** (`packages/ui/src/choreo/channels/rallyFired.ts`): add `'rallyPulse'` to `PULSE_EVENT_TYPES`. `rallyPulseUnits` already keys on the event's `source` and classifies `source === attacker` → medallion, else → frame — so a `rallyPulse` from the attacker pulses the medallion, from a watcher pulses the frame. No new classifier logic.

### Why this covers everything

Any rally — self-rally or watcher, board-FX or economy, current or future — that *does something* appends to the log, so it emits a `rallyPulse` and pulses. RL-keyword cards and in-beat-FX cards keep working exactly as before (they still pulse via their existing triggers; the marker is additive and the classifier dedups per source). No per-card patching, no gameplay change.

### Verification

- **Determinism/log tests:** the new marker appears in the combat event log, so log-snapshot tests update. It consumes no RNG and mutates no board state — confirm the fight OUTCOME is byte-identical with and without the marker (only the log's cosmetic markers differ).
- **Negative control:** a watcher on a swing where it does *not* trigger (its condition unmet) must emit **no** `rallyPulse` — test the discriminator doesn't over-fire, and that ordinary strike damage never emits one.
- **Harness:** extend `rally-beat-verify.mjs` with **Demon Horse** (asserts a medallion pulse now fires) and **Mineral Master** (asserts a frame pulse now fires).

### Risk

The bracket placement is the crux — it must wrap exactly the on-attack effect dispatch. The implementer investigates the precise call boundary in `simulate.ts` (the `bus.emit('onAttack')` handler loop and the RL re-fire loop) before emitting, and proves via the negative control that strike damage / non-triggering watchers never mark.

---

## Piece B — Pixi watcher effect (owner-authored def + wiring)

### Design

- **Owner authors** a light-blue ring-bloom effect in the FX workshop and saves it as a committed def `packages/ui/src/fx/defs/watcher-pulse.json` (id **`watcher-pulse`**). This spec does not define the visual.
- **Wiring (this work):** in the pulse-firing code (`useCombatReplay.ts`, the attack-exchange callback that fires pulses at `T`), for a `frame`-surface pulse (a watcher), fire the Pixi def via `playDef('watcher-pulse', anchorsForUnits(uid, uid), …)` at `T` — anchored on the watcher's own card (source = target = the watcher) — instead of bumping the CSS frame-pulse nonce.
- **Fallback:** if the `watcher-pulse` def is not in the registry (not yet authored/committed), fall back to the existing CSS `.framepulsering` pulse, so nothing regresses before the def lands. Gate on the def registry (`getDef`/`listDefs` from `fxDefs.ts`).
- Once `watcher-pulse` is committed, watchers pulse via Pixi; the CSS path remains only as the registry-miss fallback. `--framepulse-color` stays for that fallback.

### Verification

- Pixi renders on a canvas, not the DOM, so the harness can't detect it via a CSS class. Instrument the watcher channel to detect the `playDef('watcher-pulse', …)` call (e.g. a dev hook / spy on `playDef`) to confirm the Pixi def fires at `T` on the watcher; the CSS-fallback path keeps its existing DOM detection.
- Eyeball on :5174 once the owner's def is committed.

### Split of work

- **Owner:** author the `watcher-pulse` ring-bloom def in the FX workshop, commit it under `fx/defs/`.
- **This implementation:** the sim `rallyPulse` marker (A), the Pixi wiring + registry-miss fallback (B), the harness extensions.

## Out of scope

- The watcher def's visual design (owner-authored).
- Any gameplay change (Demon Horse's `RL` keyword is deliberately NOT added — the marker is cosmetic).
- Retuning the 300ms gap or the medallion pulses (unchanged).

## Constants / tunables

- No new timing constant (reuses `RALLY_EFFECT_GAP_MS`).
- Watcher color: carried by the owner's Pixi def; `--framepulse-color` remains for the CSS fallback only.
