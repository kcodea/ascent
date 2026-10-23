# Summoned from hand: one seamless lift and land (2026-10-23)

Owner ask: "build an animation for when a minion is summoned from hand." It took five rounds the same day, each one
reviewed on 5173:

1. A ghost arced to the slot with a flash. Owner: "doesn't look super clean cut ... just showing that it came from hand."
2. One straight move and a crossfade. Owner: "it should land and have a small pulse ... feels like a summon and not a
   path the card took."
3. A lift, a dissolve and a settle. Owner: "like a 4/10, can you get it to 9/10."
4. A quality pass. Three looks went behind a dev setting (Lift and land, Quick fly, Spirit pull), with fixes found by
   comparing 60 to 90 fps screencasts frame by frame against `main`. Then a 🃏 Hand Summon tuner.
5. Owner: "use the lift and land animation, but smooth it out and make it overall less clunky and way more
   seamless." Lift and land is now THE animation. The fly and spirit code was dropped.

The owner signed off on round 5: "hand summon animation looks good to me". The shipped DEFAULTS in
`handSummonConfig.ts` are the values that round ran with on 5173.

## The motion (handSummonFx.ts)

It is one continuous movement, with overlapping phases instead of chained ones.

- **The card leaves.** A copy of the hand card starts exactly on it: same centre, layout size, fan tilt, full opacity.
  The real hand card is hidden under it.
  - The copy lifts straight up first, then curves on toward the board slot. The path is one cubic Bézier with one
    easing. The copy swells a touch, then shrinks.
  - The real hand card fades back in (greyed in combat) as the copy clears it.
- **The minion forms in its slot while the copy is still dissolving.**
  - It fades in from 0.9 scale, rises through one slight overshoot to 1.05 and eases back to exactly 1 with zero
    velocity. The curve is (1-u)²(q0+q1u), with q1 solved for the peak.
  - The copy starts to fade just after the minion starts to show. It is gone exactly when the minion is solid, so
    the screen is never empty and the two are never both solid.
- **The landing starts as the minion arrives.** The game's `landing-dust`, a small cut of its buff pulse (one white
  ring and a warm core, plus 10 sparks off phones; `PulseCfg.ringAlpha` is new), and the summon sound.
- **The slot opens first.** In combat, the arrival's `summonexpand` is hurried (`playbackRate`) to finish by the time
  the minion starts to form, so nothing shuffles after it appears.
- **Every curve is sampled into 25 Web Animation keyframes** (transform and opacity only), so position, scale and
  opacity are continuous with no velocity kick. The tests check this.
- **Timing:** 550 ms at 1x, divided by the combat speed. Several at once are staggered 90 ms, shorter than the motion,
  so a chain flows.

Every value is in the DEV 🃏 Hand Summon tuner (Dev menu, **Plate FX** group, **Hand Summon**). It is live, with
▶ Preview, ▶ Preview ×3 and Copy values. Production always uses the DEFAULTS in `handSummonConfig.ts`.

## Problems the frame strips found along the way

- The fading copy sat half-transparent over the greyed hand card. **Fix:** the hand card is hidden under the copy.
- The landing glow (a pale `screen` disc) was invisible on the board. **Fix:** the pulse ring.
- The hand card greyed on the BEAT, while a Rally summon was still withheld. **Fix:** `handSummonedShownThrough`
  skips withheld bodies.
- A flight launched on a frame that `summonHold` was about to remove. **Fix:** flights launch only when the body is
  really drawn.
- The next swing could start over a minion that was still landing. **Fix:** the combat scheduler floors its hold at
  `handSummonRemainingMs()`. This is 0 when nothing flies, so every other fight is unchanged.

## Where it hooks (presentation only, rule R-HANDSUMMON-FX-01)

- **Combat:** a layout effect in `useCombatReplay` launches a flight when a hand-summoned body enters `visibleFrame`.
  - A seek, a beat jump or turbo flies nothing, and `resetTo` tears everything down.
  - The `sfx` channel and `onSummonFx` stand down for bodies in flight.
  - The landing rings the sound, unless the body was withheld, because its beat already rang it.
- **Sources:**
  - Spirit hand-summons carry `fromHandUid`.
  - Rune of the Waking Reserve leaves its card unmarked. It is matched in the UI to the hand card of that id after its
    `questTrigger`.
  - Rope Wrangler's hand-summon factory is used by no card today and is not covered.
- **Shop:** a layout effect in `Recruit` pairs each hand uid newly in `handCopiedThisTurn` with the new body of that
  id.
  - Bodies that End-of-Turn playback already drew are skipped.
  - The Shop Waking Reserve (End-of-Turn replays only) is not covered.
- **Origin:** the "from" point is a per-side source (`setHandSummonSource`). The player's hand is registered; a future
  opponent hand area can register `'enemy'`.

## Perf

All measured in headless Chrome on prod bench builds, `main` vs this branch.

**Combat, 4 hand-summons, 3 runs each.** Main-thread frame work in the 750 ms windows around the arrivals:

| | frames over 6.25 ms (per run) | window p99 | whole fight, frames over 6.25 ms |
|---|---|---|---|
| branch | 1 / 0 / 1 of ~810 | 2.2 to 2.9 ms | 6 / 5 / 6 |
| main | 1 / 0 / 0 of ~815 | 2.4 to 2.6 ms | 8 / 5 / 6 |

**Shop triple summon, 1.2 s after the commit, 2 runs each.** On the branch the commit frame costs 4 to 7 ms, the
launch's rect reads and clones; one frame went over 6.25 ms (1 of 277). `main` peaks at 3.4 to 3.8 ms.
