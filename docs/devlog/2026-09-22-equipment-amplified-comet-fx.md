# Equipment FX: the Amplified glow on the slot, and Comet's use effect

**Date:** 2026-09-22 · **Branch:** `feat/equipment-amplified-comet-fx`

## What shipped

Two owner-authored FX defs from the workbench, both on Equipment.

- `packages/ui/src/fx/defs/amplified-slot.json` — the AMPLIFIED cue. Owner: *"i created an amplified effect that
  should play on equipment when amplified. it should only play when a usable equipment is equipped/selected. if
  an equipment has 0 charges it should not show the animation."* Three `emitter` layers on `source`, a ring of
  blue motes (`emitShape: ring`, radius 79), `loopMode: seamless`. Saved under the id `amplified-slot` (the
  workbench wrote `amplified-effect`); params untouched.
- `packages/ui/src/fx/defs/comet.json` — Comet's use effect. Owner: *"i made a comet effect to be played on the
  comet equipment when used."* Three `burst` layers on `source` plus a `sound` layer (the swoosh clip, now in
  `packages/ui/src/audio/fx/`). Saved under the id `comet`; params untouched.

## How the Amplified loop is wired

`packages/ui/src/useAmplifiedSlotFx.ts`, called from `StatusBar`:

```
useAmplifiedSlotFx(hasEquip && equipAmplified > 0 && equipUses > 0 && run.phase === 'recruit' && !overlayCovering)
```

- `equipAmplified` is `equipmentWillAmplify(run, selected.id)` — the same read that paints the charge number
  blue (own stack, Rune of Empty Hands' permanent Amplification, or a pending Calibration Wrench charge; never
  the Wrench itself).
- `equipUses` is `equipmentUsesLeft(run)` — the selected Equipment's own once-per-turn charge plus the shared
  pool. Zero charges, no glow. Using the Equipment drops both in one reducer action, so the loop ends in the
  same render as the number.
- The phase gate is load-bearing: End of Turn hands every own charge back (`expireEquipmentTurn`) in the same
  action that starts combat, and the bar stays mounted through the fight.
- `overlayCovering` = a Discover, a Choose One, a quest / power / Runeforge offer, or a scouted board in the run
  state. The FX canvas (z110) sits beneath those overlays (z160), so the loop would burn its particles behind
  a backdrop, and inside a Discover its size alone is over the scene's 2,000 cap. Judgement call: a minimised
  Discover also counts as covering (the bar has no way to read the minimise flag); the glow comes back the
  moment the overlay closes.

The hook follows the `useChooseBothFx` contract: `loop: true`, caller-owned teardown, one loop at a time (a
swap between two Amplified Equipment keeps the same loop on the same point), disposed when the condition ends,
when the tab is hidden, and on unmount. Two departures, both deliberate:

- `follow` returns a CACHED point. The slot is measured once per (re)start and again on `resize` (rAF-debounced,
  because `Game.tsx` rewrites `--scale` on every resize and the slot moves with it). Zero layout reads per
  frame. Verified in the browser: after a 1600×900 → 1200×700 resize the ring stayed centred on the moved slot.
- The two "can't start yet" cases are waited for, not dropped: the FX runtime not ready (a Continue run landing
  straight in the shop — `ensureDefsReady()` + `pixiFx.onRendererReady`) and a slot with no layout box yet (a
  bounded rAF retry). Every wait re-checks the latest condition when it lands and is cancelled on stop, so a
  stale start can never fire.

Registered as production-consumed: `fx/directCalls.ts` (`'amplified-slot': ['useAmplifiedSlotFx.ts']`), the
sorted allow-list in `directCalls.test.ts`, and `playDefUids.test.ts`'s `UNIT_LESS` (the slot is HUD chrome
with no unit uid).

## How Comet is wired

Data only, the Stellar Lens / Revelmaker recipe (PR #1626): `COMET.useFxId = 'comet'` in
`packages/content/src/equipment.ts`. `Recruit.tsx` already plays `eq.useFxId` from the slot on activation, and
that call is a declared dynamic site in `fx/directCalls.ts`, so nothing was added there. Comet is
`targetMode: 'none'`: the `use` cue carries no target, `to === slot`, and every `source`-anchored burst fires at
the slot-button centre. The bursts are `aimMode: travel` with `spread: 1` (a full circle), so a zero-length
source→target vector changes nothing about their direction.

## Measured (the particle budget)

Steady state of the loop on the shop screen, read off the perf monitor's counters (`fx:particles` is the whole
particle population):

| | expected (rate × life) | measured |
|---|---|---|
| live particles | 142 + 353 + 3,224 = **3,719** | **3,723–3,730** |
| live emitter instances (`fx:layers`) | ~11–12 (seamless generations overlap) | 12–13 |
| blur filters (`fx:filters`) | ~5 (L2's generations, `blur: 2`) | 5–6 |
| `fx:culled` | | 0 (nothing else was playing) |

Per-frame cost on the DEV build (StrictMode, unminified; 1600×900 viewport in the embedded browser, 81 Hz
display, ~5,000 frames sampled): `fx:def:amplified-slot` **0.78 ms/frame mean, 2.5 ms max**; `fx:sim` 0.78 ms
mean; `fx:render` 0.63 ms mean; `fx:tick` 1.41 ms mean. The spawn (`fx:amplified-slot`) cost 2.6 ms once.
Frame health while it ran: 79 fps at 81 Hz, median 12.5 ms (the display period), p95 16.6 ms.

PROD build (`npm run build:web` served by `vite preview`, same viewport, 120 Hz display in the pane, DPR 1,
12 s / 1,750 frames with the loop live and nothing else playing):

| label | mean / frame | max |
|---|---|---|
| `fx:def:amplified-slot` (the loop's own sim) | **0.85 ms** | 3.1 ms |
| `fx:sim` | 0.85 ms | 3.1 ms |
| `fx:render` | 0.39 ms | 12.3 ms |
| `fx:tick` (sim + render) | **1.24 ms** | 13.2 ms |

Frame health with the loop: 119.5–120 fps at 120 Hz, median 8.3 ms (the display period), p95 8.4 ms, worst
12.5 ms, `long` 0 and `jank` 0 in every bucket after the shop had settled (the 143 long frames were the four
seconds of card fly-in right after Continue). Without the loop, the same screen measured 120 fps / median
8.3 ms / p95 8.4 ms. So on this machine the glow is ~1.2 ms of main thread per frame and drops no frames at
120 Hz. Stated against the project's 240 Hz target (4.17 ms budget): that is ~30% of a frame for as long as
the slot glows, which is heavy for a persistent effect. The counters read the same in prod: 3,722–3,728
particles, 12–13 layers, 5–6 filters, culled 0.

The budget interplay, stated rather than hidden: the loop registers an expected load of 3,719 against
`maxParticles` 4,000 (`fxBudgetConfig.ts`). It is `protected` (a loop is never trimmed), so while it runs any
other particle play larger than ~280 particles trims every trimmable live play before it spawns — the
one-shots on the shop screen (landing dust, click puffs, coin bursts) will cut each other short for as long as
the slot glows. `fx:culled` in the perf HUD is where that shows up. The def is the owner's to tune; this note
records the cost.

## Tests

`packages/ui/src/useAmplifiedSlotFx.test.tsx` (25 cases, mounting the real `StatusBar` against the store with
`playDef` stubbed): starts once, `loop: true`, on the slot centre, only when selected + Amplified + charged in
the shop phase, for all three `equipmentWillAmplify` branches and never for the Wrench on its own Calibration;
never twice (unrelated re-render, swap between two Amplified Equipment); stops exactly once on each ending
(stack spent, charge spent, selection moved, phase left, Equipment state gone, overlay, hidden tab, unmount)
and restarts when the condition returns; the readiness / unpainted waits re-check the condition, are bounded,
and are cancelled; `follow` reads the cache and moves one frame after a resize. Sabotaging the gate (dropping
the charge / phase / overlay terms) fails six of them.

The rule is in the oracle as `R-PRESENT-02` (`packages/rules/src/registry/approved.ts`, enforced by that test
file); `docs/docbot2/final-report.md` bumped to 167 rules / 81 approved.

## Found on the way, not fixed here

`deserialize` (`packages/sim/src/state.ts`, the "charges moved to a per-Equipment own charge" heal) rebuilds
`state.equipment` from a fixed field list and DROPS `amplified` and `calibrationPending`, so a Save & Quit
followed by Continue loses every Amplified stack and any pending Wrench charge. Reproduced while seeding the
prod-build measurement (a saved `amplified: { comet: 1 }` came back undefined; the Empty Hands branch, which
rides `equipmentAmplifiedCards` and `sourceCardIds`, survives and is what the measurement used). Engine seam,
its own fix: flagged as a follow-up task rather than folded into this presentation PR.

## Not done

- No browser check of the hidden-tab teardown (the embedded browser cannot background the tab); unit-tested.
- The owner should confirm one consequence of the rule as stated: under Rune of Empty Hands (permanent
  Amplification) with Rune of Overcharge (no charge spent), using the Equipment ends nothing, so the slot glows
  for the whole shop turn, every turn.
