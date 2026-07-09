# Corner-Clack Contact + Distance-Scaled Lunge — Design

**Date:** 2026-07-08 · **Author:** Mike (+ Claude) · **Status:** approved, pre-plan

A feel refinement of the combat attack lunge (choreographer phase 3b). Two coupled changes to the same
motion, both **presentation-only** — no `@game/core`/`sim` changes, nothing that affects fight outcomes.
This is the first of two feel specs the user requested; the second (death & deathrattle ordering, asks
#3/#4) is deferred to its own spec.

## Problem

Two symptoms, one root cause in [`channels/lunge.ts`](../../../packages/ui/src/choreo/channels/lunge.ts)
+ [`lungeConfig.ts`](../../../packages/ui/src/lungeConfig.ts):

1. **Attacks don't read as physical contact.** The strike tweens the attacker by
   `dx * strikeDist` with `strikeDist = 1.44` — a fraction of the *full center-to-center vector*. The
   attacker drives 144% of the way to the defender's **center**, punching through and overlapping it. The
   two cards interpenetrate; there is no notion of their edges/corners meeting, so it reads as phasing, not
   striking.
2. **Far attacks look faster than near ones.** `strikeDur` is a fixed `0.16s` regardless of distance. A
   far-across-the-board attack covers far more pixels in that same time, so its apparent speed is much
   higher than an adjacent-lane attack. Speed should feel roughly constant.

## Goal

Make the lunge land as a **corner clack**: the attacker approaches at a slight angle so a corner leads,
stops when that corner meets the defender's corner (no overlap beyond a small "bite"), and **both** cards
kick back and rotate off the contact point before the elastic settle. And make the strike's **duration
scale with travel distance** so px/second stays roughly constant near→far.

Every new parameter is a tunable dial in the existing DEV **Lunge tuner** so the feel is dialed by eye and
the winning values baked as shipped defaults (the trail/smoke/lunge loop).

## Non-goals

- No change to `simulate()`, event order, or any core/sim/content code. Outcome-neutral.
- No change to the beat-clock advance mechanism (it already rides the real GSAP contact position — see
  below). No pacing/ordering changes (that is the deferred #3/#4 spec).
- Not building generic ms-offset authoring cues; these dials live in `lungeConfig` like the rest of 3b.

## Approach

### Contact geometry (ask #1)

The choreo engine ([`engine.ts`](../../../packages/ui/src/choreo/engine.ts) `runAttackExchangeCues`) already
has both the attacker element and the attacker→defender vector `(dx, dy)`, and can measure the defender
element. It will compute a **surface-contact strike offset** and pass it to `playLunge`, replacing the
center-overshoot:

- `dist = hypot(dx, dy)`; unit axis `(nx, ny) = (dx/dist, dy/dist)`.
- `atkHalf` / `defHalf` = each card's half-extent *projected on the axis*
  (`|nx|·halfW + |ny|·halfH`) from its measured rect.
- `travel = dist − defHalf − atkHalf + bite`, where `bite` is a small overlap (px) so the corner visibly
  bites in rather than leaving a gap. Strike target offset = `(nx·travel, ny·travel)`.
- **Lead with a corner:** the wind-up rotates the attacker to `leadTilt` degrees (sign chosen from the
  horizontal offset `sign(dx)` so it tilts *toward* the defender's near corner, never a flat face-plant),
  and it drives in still tilted, so a corner makes first contact. The settle unwinds rotation to 0.
- **Both jolt** (in [`channels/impact.ts`](../../../packages/ui/src/choreo/channels/impact.ts)
  `playContactImpact`): the defender gets its existing knockback **plus** a counter-rotation `defenderSpin`
  away from the contact corner (sign = opposite the attacker's lead), and the attacker gets a rotational
  rebound `attackerRebound`. Both are short yoyo tweens that clear their transform, composing with the
  lunge's own settle.

### Distance-scaled duration (ask #2)

`strikeDur` becomes derived, computed in the engine from the same `travel`:

- `strikeDur = clamp(travel / targetSpeed, minStrikeDur, maxStrikeDur)` — `targetSpeed` in px/s.
- Passed into `playLunge` (which today reads `c.strikeDur` from config) as an override.
- The wind-up duration stays fixed (anticipation isn't distance-dependent); only the *travel* scales.

**Why no scheduler change is needed:** the beat-clock advance is already welded to the *real* GSAP contact
position — the engine fires `advance` via `playLunge`'s `onContact` at `windupDur + strikeDur − smackLead`
on the actual timeline, and `useCombatReplay`'s scheduler skips its own hold for an attack the engine took
over (`engineAdvancingRef`). So a per-attack `strikeDur` needs no `holdMs` change; the damage float +
advance still land exactly on contact however far apart the units are. The config `strikeDur` remains only
as the unresolved-elements fallback in `holdMs`.

## New config (lungeConfig.ts)

Added to `LungeConfig` (all live-tunable via `LungeTuner`, with `LUNGE_RANGES` bounds):

| key | meaning | starting dial |
|---|---|---|
| `bite` | px the leading corner drives past surface contact | ~6 |
| `leadTilt` | deg the attacker tilts to lead with a corner | ~7 |
| `defenderSpin` | deg the defender counter-rotates on impact | ~6 |
| `attackerRebound` | deg the attacker rotationally rebounds on contact | ~5 |
| `targetSpeed` | strike travel speed (px/s) that sets duration | ~1600 |
| `minStrikeDur` | clamp floor for strike duration (s) | 0.10 |
| `maxStrikeDur` | clamp ceiling for strike duration (s) | 0.28 |

`strikeDist` is retired (replaced by surface `travel` + `bite`); `strikeDur` stays as the fallback value.
Starting dials are illustrative — the point is to tune them by eye in the DEV tuner and bake the winners.

## Testing

TDD on [`channels/lunge.test.ts`](../../../packages/ui/src/choreo/channels/lunge.test.ts) and
[`engine.test.ts`](../../../packages/ui/src/choreo/engine.test.ts) (both seek the timeline via
`.progress()`, no real time):

- Strike lands the attacker's leading edge at the defender surface (`travel` position), not overshooting
  center — assert the tweened `x/y` at the contact frame equals `travel` along the axis, within `bite`.
- The attacker carries `leadTilt` rotation into contact, tilt sign follows `sign(dx)`, and rotation
  unwinds to 0 by settle end.
- `strikeDur` scales with distance between the clamps: a near vector yields `minStrikeDur`, a far vector a
  longer (clamped) duration, a mid vector `travel / targetSpeed`.
- Impact applies `defenderSpin` (opposite sign) + `attackerRebound`, both clearing their transforms.

Plus the full suite green: `npm run typecheck && npm run lint && npm test && npm run build:web`, and a live
feel-pass in the running app / ChoreoPreviewStage before baking defaults.

## Rollout

One PR (`feat/corner-clack-contact`), UI-only, self-mergeable on green. Build behind the tuner → user dials
the corner feel live → bake the chosen values as `lungeConfig` defaults in the same PR. Devlog + roadmap
updated. Asks #3/#4 (deathrattle overlap + death-clears-before-summon ordering) follow as a separate spec.
