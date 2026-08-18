# Combat Speed Auto-Ramp — Design

**Date:** 2026-08-18
**Branch:** `feat/combat-speed-ramp`
**Owner seam:** presentation (`packages/ui/**`) — Mike's domain. No engine/content/sim changes.

## Summary

A toggle-able option that makes each combat's replay **automatically accelerate as the fight goes on,
then ease back to normal for the finish** — so long fights stop dragging without the opening or the
finishing blows ever playing as a blur. When the toggle is off, behavior is byte-for-byte what it is today.

The ramp is a **multiplier layer applied on top of the existing Speed slider** — it never mutates the
stored slider value, and it never writes to the store per-frame (that would thrash React and violate the
performance north star). The slider becomes the *starting* speed; the ramp climbs from there.

## Decisions (from brainstorming)

- **Trigger:** within each combat. Every fight resets to the start and ramps independently.
- **Base & ceiling:** the Speed slider sets the *starting* speed; the ramp climbs from there to a fixed
  **absolute** ceiling (a target speed, e.g. `3×`, not a multiple of the base). Clamped to the store's
  existing `0.5–5×` range. If the slider is already at/above the ceiling, the ramp is a no-op (never slows
  the fight below the player's chosen base).
- **Basis:** wall-clock time elapsed in the fight, plus estimated wall-clock time remaining (see below).
- **Shape:** grace period at base speed, then ease up to the ceiling, then — for the tail of the fight —
  ease back down to base.
- **Default state:** toggle **ON** by default (auto-ramp is the intended default experience). The off
  path still exists and is a pure no-op (effective speed = base), so turning it off restores today's feel.
- **Tunable:** every ramp number lives in a dev tuner, following the existing tuner-registry pattern.

## Architecture

### The effective-speed layer (the key principle)

`combatSpeed` today is a single store number (`0.5–5×`, persisted to `localStorage`, default `1×`), read
live during replay — most timing paths already sample `combatSpeedRef.current` per beat — and mirrored to
the `--combat-speed` CSS var + `applyFloatSpeed()` so CSS animations track it. `fighting` (the replay's
`active` flag) marks a combat's start and end. Tutorial hard-forces `1×`.

The ramp adds an **effective speed** = `base × … ` computed per frame, WITHOUT touching the store:

1. A lightweight **rAF loop, alive only while `fighting`**, computes the effective speed each frame and:
   - writes it to the `--combat-speed` CSS var and calls `applyFloatSpeed()` → CSS + float lifetimes ramp
     live with **zero React renders**;
   - stores it in a shared `effectiveCombatSpeedRef`.
2. The replay's **JS timing paths** (beat holds, lunge `timeScale`, float/hold lifetimes, roll clocks)
   sample `effectiveCombatSpeedRef` when they arm each beat — which most already do via `combatSpeedRef`.
   Implementation re-points the remaining few spots that still read the static prop (notably the beat
   scheduler's `holdMs(next, shown, combatSpeed)` and `lead / combatSpeed`, the `finalHold` effect, and the
   `runAttackExchangeCues` / `runRiseReturn` call sites) to the effective ref so newly-armed beats pick up
   the ramp. Because these are sampled per-beat (beats are frequent), that's smooth enough without any
   per-frame React churn.
3. **Reset:** the ramp clock (fight start timestamp + the prefix-sum table below) is (re)initialized when
   `fighting` transitions to true, and the rAF loop is torn down when it goes false.
4. **Off / tutorial:** when the toggle is off (or `run.mode === 'tutorial'`), the effective speed is just
   the base — the rAF loop can be skipped entirely, so the off-path has no added cost.

> **Why not just drive the store's `combatSpeed` from a loop?** It would re-render every `combatSpeed`
> subscriber (the EscMenu slider, the CSS-sync effect) and restart the beat-scheduler effect ~60×/s, and it
> would clobber the player's chosen base value. The ref + CSS-var layer avoids all of that.

### The ramp profile

Within a fight the effective speed is the **minimum of two curves**, clamped to `[base, ceiling]`:

```
speed = clamp( min( rampUp(elapsedMs), rampDown(remainingMs) ), base, ceiling )
```

- **`rampUp(elapsedMs)`** — a function of time since fight start: returns `base` for the grace window
  (`graceMs`), then eases `base → ceiling` over `rampUpMs`, then stays at `ceiling`.
- **`rampDown(remainingMs)`** — a function of estimated authored time remaining: returns `ceiling` while
  `remainingMs > tailMs`, then eases `ceiling → base` as `remainingMs → 0`, reaching `base` at the end.

Taking the **min** composes the two with no special-casing per fight length:

- **Long fight:** climbs after grace, cruises at ceiling, eases back down over the last `tailMs`.
- **Short fight** (shorter than `graceMs + tailMs`): the down-curve is already low from the first frame, so
  the fight effectively never speeds up — it plays at base, which is correct.
- **Medium fight:** climbs partway, then the descent catches it before it reaches the ceiling — a smooth hump.

Easing is a smooth ease-in-out (exact curve is a tuner concern; start with `smoothstep`).

### Determining "time remaining"

The combat timeline is fully known before the replay starts: the deterministic event log is compiled into
an ordered `beats` array, walked by a `beatIdx` cursor. The authored (base-speed) duration of each
inter-beat gap is `holdMs(next, prev, 1)`.

At fight start we compute a **prefix-sum table** of cumulative authored ms per beat (plus `finalHold`), so
per frame:

```
remainingAuthoredMs = totalAuthoredMs − cumulativeAt[beatIdx]
```

— an O(1) lookup, no per-frame summing and no layout reads.

**Known approximation (accepted):** a plain `holdMs` sum captures the gaps *between* beats but under-counts
an `attackExchange`/lunge beat's internal timeline (wind-up → contact → pull-home). So the estimate drifts
low on swing-heavy fights — it thinks slightly less time remains than truly does, which makes the ramp-down
ease to base a touch **early**. That's the safe direction (the finish is already at normal speed rather than
still braking through it), and `tailMs` is a tuner knob to compensate. Making it frame-exact (each exchange
reporting its real duration into the prefix table) is explicitly deferred as gold-plating unless live feel
demands it.

## Data model & tuner

New store state (in `packages/ui/src/store.ts`, persisted to `localStorage` like `combatSpeed`):

- `combatRampUp: boolean` — the toggle. Default `true`.
- `setCombatRampUp(on: boolean)` — setter; persists.

Ramp parameters live in a dedicated config module (e.g. `packages/ui/src/combatRampConfig.ts`) with a
`CONFIG` object + defaults, exposed through a dev tuner (`CombatRampTuner`) registered in `DevMenu.tsx`
alongside the existing tuners:

| Param | Default | Meaning |
|---|---|---|
| `graceMs` | `2000` | Hold at base speed at the start of the fight. |
| `rampUpMs` | `4000` | Ease base → ceiling over this long, after the grace window. |
| `ceiling` | `3.0` | Absolute target speed to climb to (clamped to `≤ 5×`). |
| `tailMs` | `5000` | Estimated authored time-left at which the descent to base begins. |
| `ease` | `smoothstep` | Easing applied to both ramps. |

Defaults are a starting point to feel in live and settle via the tuner, exactly like the Consume /
Board-Edge tuners.

## UI

In the Esc / Settings menu (`EscMenu.tsx`), under the existing **Combat** section:

- Keep the Speed slider; update its sublabel to convey that, with auto-ramp on, it's the *starting* speed.
- Directly **below the slider**, add a toggle button (same `escbtn pressable` style as the Sound-on
  toggle, showing its on/off state) — **"Auto-ramp speed"**, with a one-line blurb ("Long fights speed up,
  then ease back down for the finish"). On by default.

No in-combat HUD control (consistent with the 2026-07-14 decision to keep combat pacing in the menu).

## Testing / verification

- **Unit tests** (Vitest) for the pure ramp math: `rampSpeed(elapsedMs, remainingMs, cfg, base)` — grace
  holds base; climbs to ceiling; short-fight case never exceeds base meaningfully; descent reaches base at
  `remaining = 0`; clamps to `[base, ceiling]`; base ≥ ceiling ⇒ constant base.
- **Unit test** for the prefix-sum "remaining" helper against a synthetic beats array.
- **Off-path regression:** with `combatRampUp = false`, effective speed equals base for all inputs (the
  no-op guarantee).
- **Gates:** `npm run typecheck && npm run lint && npm test && npm run build:web` all green.
- **Live check:** drive a real fight in the focused Chrome tab (per the FX-verification habit) with the
  toggle on; confirm the `--combat-speed` CSS var ramps up after grace and eases back for the finish, and
  that combat still reads correctly. Owner plays at `1×` base — verify the ramp is visible and correct at
  that base specifically.

## Out of scope

- Across-the-run speed creep, hold-to-fast-forward (considered and rejected in brainstorming).
- Frame-exact remaining-time accounting (deferred; see approximation note).
- Any engine/content/sim change.

## Files touched (anticipated)

- `packages/ui/src/store.ts` — `combatRampUp` state + setter + load/persist.
- `packages/ui/src/combatRampConfig.ts` — **new**: ramp config + defaults + pure `rampSpeed()` math.
- `packages/ui/src/combatRampConfig.test.ts` — **new**: ramp math + remaining-time tests.
- `packages/ui/src/useCombatReplay.ts` — prefix-sum table at fight start, rAF ramp loop, re-point timing
  paths to the effective-speed ref.
- `packages/ui/src/Recruit.tsx` — thread the toggle in; apply/skip the ramp; keep tutorial at `1×`.
- `packages/ui/src/EscMenu.tsx` — the toggle + slider sublabel copy.
- `packages/ui/src/CombatRampTuner.tsx` + `DevMenu.tsx` — **new** dev tuner + registration.
- `docs/devlog.md`, `docs/roadmap.md`, `README.md` — history + queue + front-page summary.
