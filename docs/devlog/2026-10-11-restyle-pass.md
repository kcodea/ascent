# 2026-10-11 — Restyle pass: the combat ramp's whole-document restyle, the hand-glide thrash, and what a restyle costs

Owner approval 2026-10-11 ("once all of this is committed we will try the css restructure"), then the owner's
pick after the first measurements: **"C then A"**. C (this entry) targets what actually holds frames over budget.
A (the prod-only constant fold of `var()` references) is a separate PR.

## The CSS restructure as proposed did not survive measurement

The plan was card geometry on container-query units (`42cqw` instead of `calc(var(--ccw) * 0.42)`), on the
premise that deleting ~280 matched `var()` rules took a full restyle from 13.4 to 1.9 ms. Measured on the PROD
bench build (heavy shop scenario, 1,128 elements, 24 cards):

| Variant (a card re-mount / a forced cache-miss restyle) | Re-mount style+layout | Cache-miss us/element |
|---|---|---|
| As shipped | 8.1 ms | 15.2 |
| `container-type` on cards + `--ccw` -> `100cqw` | 13.9 ms | ~20 |
| Size vars in `.card` rules frozen to literals | | 12.6 |
| Other vars in `.card` rules frozen | | 12.6 |
| EVERY `var()` in the document frozen (ceiling) | | 8.0 |

- Container units move the style of a container's descendants into layout and cost more in total.
- Deleting rules removes what renders, so it is not a measurement. Freezing values is.
- Even the ceiling (every `var()` frozen) halved the biggest single restyle of a roll (4.9 -> 2.9 ms) and a play
  (3.5 -> 2.0 ms), but frames over 6.25 ms per action did not move (play ~9 -> ~8.5, roll 4 -> 4). Those frames
  are JS and GPU raster.

## What shipped (no visual change)

1. **The combat auto-ramp no longer writes `<html>` every frame.** It wrote `--combat-speed` plus ~16 float vars
   onto the root each frame for up to ~20 s of a long fight (grace 3.6 s, then a 10 s ease up and a 10 s ease
   down). A root custom-property write restyles the whole document: ~1,040 elements, ~19 ms a frame. The ramp
   now records the live speed in memory (`setLiveCombatSpeed`). Floats, death floats, a `.unit` entering a
   death / Rise / Rebirth animation, and the Rebirth DOM nodes stamp the speed they START at on themselves
   (`speedVars`, floatConfig.ts). :root keeps the base values, written only when they change. A ramp-off fight
   stamps exactly the root values; a ramped one starts each animation at the same speed as before (the old
   path also rescaled an animation already running, by a fraction of a percent per frame; nothing visible).
2. **The hand-glide seed reads before it writes** (Recruit.tsx). It read `offsetLeft` after writing the previous
   card's seed, which forced ~16 restyles inside one play. `--hand-glide` is registered `inherits: false`, so a
   write restyles the card alone, not its ~45-element subtree.

## Measured (PROD bench builds, before = origin/main f3d771343, after = this branch)

Rad Rachel fight (7 Demons, 2 Rachels, 2 Gaskets, Fel Spikes), frames per second through the fight:

| Seconds into the fight | Before | After |
|---|---|---|
| 1-5 (before the ramp starts) | 234-239 | 235-239 |
| 6-13 (ramping) | 30-42 (over 6.25 ms: 31-43 per second) | 205-239 (over 6.25 ms: 0-21 per second) |

Main thread in a 1 s window mid-fight: style 866 ms -> 40 ms.

Play from hand, 4 plays x 2 sessions per build: longest task 25.5 / 34.8 ms -> 20.1 / 19.7 ms; style inside it
9.5-14.5 -> 8.8 ms. Frames over 6.25 ms per play unchanged (~16): the rest is GPU raster.

The per-action shop suite (hover, roll, buy, sell, freeze, drags, upgrade) is flat, as expected: none of those
paths changed.

Full game, 16 rounds, the long-run bot (`longrun.mjs` from the 2026-10-10 pass), frames over 6.25 ms summed over
all rounds. The bots play different games, so this is a curve, not a paired comparison.

| Build | Shop script | Combat |
|---|---|---|
| Before | 1,116 | 4,800 (rounds 6-16: 263-639 per fight) |
| After, rounds 1-3 (the only comparable rounds) | 30 | 36 |
| Before, rounds 1-3 | 37 | 259 |

The after game stalled at round 4, the round where the bot lets the turn timer run out. That was a harness
artefact, not this change. A stray bot click had opened the Compendium, and every full-screen overlay
(Compendium included) pauses the recruit clock and the combat replay by design (Recruit.tsx `overlayOpen`).
The run's final screenshot shows the Compendium open. A rerun with a "close the Compendium each round" guard was
started and stopped when the owner asked to wrap up, so the 16-round after curve is still owed. The Rachel fight
and the per-action numbers above are the A/B evidence.

## Investigated, not shipped

- **Idle CSS animations** (Flurry rings x21, Ward glass x14, sheens, tier pulse). They are already
  transform/opacity only and composited. Chrome still restyles each animated element on the main thread every
  frame (a plain synthetic rotate does the same): ~0.15 ms a frame for 43 animations. No change without a visual
  change.
- **Raster of new cards.** Pre-decoding the next roll's art (predictable from the seed) removed all ~60 ms of
  decode work per roll but not one frame over budget. The long frames are the React commit and the GPU upload of
  full-size (1254 px) art. Card-size art would fix the upload; that is an owner decision, still not approved.

## Verification

- `combatSpeedRestyle.test.ts`: the live speed writes no DOM, `speedVars` equals the root values at every speed,
  root writers skip unchanged values, and source contracts for the ramp tick, every stamper, the hand-glide read
  order and the `--hand-glide` registration.
- A root/body write probe over shop actions and a full fight: before, ~1,200 root writes per fight; after, none.

## A (the prod-only constant fold of `var()`): shelved by the owner, 2026-10-11

Future work, if it comes back:

- **Payoff ceiling.** Freezing every `var()` in the document halves a cache-miss restyle (15 -> 8 us an element)
  and the style inside a play's long task, but did not move frames over budget. A fold can only reach part of
  that ceiling: the per-card inline values (`--c`, art tuning) and the registered size chain cannot fold.
- **Static analysis is NOT safe here.** The audit (postcss over 26 CSS files plus a literal scan of 888 TS
  files) found 76 `:root` constants (1,337 references) and 140 never-declared names that always take their
  fallback (166 references). But many names are BUILT at runtime, so a literal scan misses them:
  - the player's UI theme (`--ui-*` via `uiVar()`, uiThemes.ts), which changes in prod from Settings;
  - `--hd-rune${n}-x`, `--smed-${k}-*`, `--rb-crown-${k}`, `--rsh${n}-*`, `--hsc-*`, `--mp-${id}-*`, `--tier-${n}`.
  A static fold would have frozen the theme picker.
- **What a safe version needs.** An explicit allowlist, folded in the prod build only (dev keeps live tuners),
  verified against a runtime dump of every root custom property the prod bundle writes across a session (theme
  switches included). Prod tuners do write their DEFAULTS once at module load (`!import.meta.env.DEV`) and
  DevMenu is dev-only, so those names are constant in prod, but only a runtime check proves the list complete.
