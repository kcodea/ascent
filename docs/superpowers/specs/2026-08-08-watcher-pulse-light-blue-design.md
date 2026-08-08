# Watcher pulse — light-blue medallion + frame bloom (on `main`)

**Date:** 2026-08-08
**Status:** Design approved (direction), pending spec review
**Supersedes:** PR #918 (`feat/rally-beat-choreography`). That branch collided with rally-pulse work `main` shipped meanwhile (#909 per-proc pulse, #922/#925 HP-down roll). Rather than merge it, this rebuilds ONLY its genuinely-new piece — the distinct watcher visual — on top of current `main`. #918 will be closed.

## Goal

Give **watcher** cards a distinct, unmistakable look when they react to an ally's attack: their medallion pulses **light blue** (not the generic white) AND a **light-blue bloom** fires on their card frame (the owner-authored Pixi `watcher-pulse` def, CSS fallback until/where it can't play). So a watcher reads differently at a glance from a self-rally (yellow medallion) or a Battlecry/aura (white medallion).

A "watcher" is a card whose `onAttack` effect fires in response to *another friendly's* attack — factories named `on*` (`onAllyAttackBuffAll` / Crypt Drake, `onRallyPlayRubiesTribe` / Mineral Master, `onTribeAttackBuffAttacker` / Traveling Skald, `onFriendlyAttackBuffTribe` / Raptor), as opposed to a self-rally (`rally*` factory on an `RL` unit).

## What `main` already does (do NOT rebuild)

- **Every rally already pulses.** The attacker's yellow medallion pulse (`firePulse` → `.cgem.pulsing.rally`) fires once per proc, gated purely on the `RL` keyword — Demon Horse (now RL) included. The abandoned #918 "sim `rallyPulse` marker" is **redundant here and is dropped**.
- **Watchers already pulse — incidentally and generically.** A watcher is the `source` of the buff it grants, so `main`'s generic trigger scan (`useCombatReplay.ts` ~1196-1219: a unit that is the `source` of `sc`/`buff`/`keyword`/`summon`/`toHand`, or `target` of `improve`/`maxGold`/`hpGrant`/`reborn`, on a beat) flashes its `.cgem` **white** — the same path a Battlecry uses. Indistinguishable, medallion-only.
- **No frame-surface pulse exists** anywhere (`Card.tsx`/`styles.css` have no `.framepulsering`, no `--framepulse-color`; every pulse is on the `.cgem` medallion). This is new ground.

## Non-goals

- No sim / gameplay / RNG change — cosmetic only.
- No change to the attacker's yellow rally pulse, the per-proc model (`firePulse` / `rallyProcsFor` / the `rallyFx` cue), or the combat rolls (`COMBAT_ROLL_MS=650`, `combatDamageDeltas`).
- No sim `rallyPulse` marker (dropped — redundant on `main`).
- Not authoring the Pixi visual — the owner authored `watcher-pulse.json` (id `watcher-pulse`, a light-blue ring-bloom).

## Design

### Classification — who is a "watcher pulse" this beat

Within an **attack** beat's wind-up moment (the run of events absorbed after the `attack` event), a **friendly unit that is the `source`/`target` of a stat-grant event AND is NOT the beat's attacker** is a watcher reacting to the swing. This is exactly `main`'s existing trigger-source scan, narrowed to (a) attack beats and (b) non-attacker units. A dedicated pure helper `watcherPulseUids(moment, events, attackerUid): string[]` returns those distinct uids in log order. (The attacker's own rally buffs carry `source === attacker`, so they classify OUT — correct; the attacker keeps its own medallion pulse via the existing paths.)

### Two surfaces, both light blue, ADDITIVE

A watcher gets BOTH (the medallion pulse is kept — recolored, not removed — and the frame bloom is added):

- **Medallion → light blue.** A new `.cgem.pulsing.watcher` variant tinted with a shared `--watcher-pulse-color` (`#7fc8ff`, tunable). Driven by a `watcherPulse` nonce map (mirrors `rallyPulse`), threaded to `Card` as a `pulseWatcher` prop. In `Card.tsx`'s class ternary it sits: `pulseRally` (yellow) → else `pulseWatcher` (light blue) → else `pulse` (white) → else `glow`. A watcher's uid is **excluded from the white `trig` set** for that beat so it takes the light-blue class rather than white (still a medallion pulse — additive in the user's sense: recolored, not dropped).
- **Frame → light-blue bloom.** A new `.framepulsering` overlay on the card frame (not the medallion), tinted with the same `--watcher-pulse-color`. Fired via `playDef('watcher-pulse', anchorsForUnits(uid, uid), { speed })` (anchored on the watcher's own card) when the def is committed AND the renderer can play it; otherwise a CSS `framePulse` nonce drives the `.framepulsering` overlay as the registry-miss fallback.

Both fire from the **same point** `main` currently sets the white `triggerUids` (the beat-boundary trigger effect), rerouted for watcher uids — so timing matches `main`'s existing watcher pulse; no new scheduling.

### Pixi wiring + fallback

- `packages/ui/src/fx/watcherPulse.ts`: `WATCHER_PULSE_DEF_ID = 'watcher-pulse'` and pure `useWatcherPixi(defAvailable: boolean, canPlay: boolean): boolean` (`defAvailable && canPlay`).
- Gate: `useWatcherPixi(!!getDef(WATCHER_PULSE_DEF_ID), canPlayDefs())` → Pixi, else CSS `.framepulsering`.
- `playDef.ts`: DEV-only `window.__fxFires.push({ id, t })` seam (Pixi paints a canvas with no DOM class, so the browser harness needs this to observe a fire).
- `fx/directCalls.ts` + its pinned test: register `useCombatReplay.ts` as a `watcher-pulse` direct call site (the governance snapshot fails until updated).

### The def

Bring the authored `packages/ui/src/fx/defs/watcher-pulse.json` (id `watcher-pulse`) into the branch. No imported art (procedural `burst` + `shockwave` layers), so nothing else to carry.

## Verification

- **Unit:** `watcherPulseUids` classifier — attacker's own rally buff excluded; a non-attacker friendly source (watcher) included; order preserved; non-attack beats yield none. `useWatcherPixi` truth table.
- **Browser/harness:** a Crypt-Drake scenario asserting, when the Drake reacts, its `.cgem.pulsing.watcher` (light-blue) rising edge AND a frame pulse (CSS `.framepulsering` OR a `watcher-pulse` entry in `window.__fxFires`); and that the attacker of that beat gets NO frame pulse.
- **Regression:** full suite green; the yellow rally pulse, per-proc model, and combat rolls unchanged (no diff to `firePulse`/`rallyProcsFor`/`COMBAT_ROLL_MS`/`combatDamageDeltas` beyond additive threading).

## Files

- `packages/ui/src/Card.tsx` — `pulseWatcher` prop + `.cgem.pulsing.watcher` class + `.framepulsering` overlay.
- `packages/ui/src/styles.css` — `--watcher-pulse-color`, `.cgem.pulsing.watcher` light-blue keyframe, `.framepulsering` frame bloom.
- `packages/ui/src/useCombatReplay.ts` — `watcherPulse`/`framePulse` state, the reroute in the trigger scan, Pixi-or-CSS fire, threading to `Card`.
- `packages/ui/src/choreo/channels/rallyFired.ts` (or a small new `watcherPulse` channel) — `watcherPulseUids` pure classifier + test.
- `packages/ui/src/fx/watcherPulse.ts` (+ test) — def id + gate helper.
- `packages/ui/src/fx/playDef.ts` — DEV `__fxFires` seam.
- `packages/ui/src/fx/directCalls.ts` (+ test) — register the call site.
- `packages/ui/src/fx/defs/watcher-pulse.json` — the authored def.
- `docs/superpowers/harness/…` — a watcher scenario (port the relevant probe).

## Constants / tunables

- `--watcher-pulse-color: #7fc8ff` — shared by the medallion light-blue and the frame bloom; the Pixi def carries its own (light-blue) palette.
- No new timing constant; reuses the existing trigger-pulse timing.
