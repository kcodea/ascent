# 2026-09-02 — stripping the four generic buff FX (visuals only, moments kept)

Owner ask: *"strip every single shop and combat tendril effect from the game … tendrils, descend effect,
self-buff, and possibly one more"* — clearing the way to author fresh pixi effects on those same moments. Scope
confirmed: **the four GENERIC cues only, visuals only**. The per-card authored cousins stay; the sim-side buff
data and the choreography channels stay, so a replacement effect drops straight onto each moment.

## What was removed

Four generic buff cues, fired two different ways:

- **Tendril** (living source → buffed target ribbon) and **Descend** (sourceless rain-down) — procedural,
  fired through `buffFxRender.fireBuffFx`. That function now computes and returns ONLY its flight time (so the
  target's stat-badge roll still rides the exact same clock) and draws nothing.
- **Self-buff** — two implementations, both cut: the procedural gold **pulse** (`useCombatReplay.fireSelfBuffs`,
  the pulse call removed; the preset is still read for its hold time so the roll is unchanged) AND the authored
  **`self-buff-gold`** def, which was the kind-level binding on `attackExchange` / `buffWave` /
  `minionSelfBuffed`.
- **Aura wave** — the tribe-aura board wash, both the procedural `pixiFx.auraWave` fires (`Recruit.fireAuraWave`,
  `useCombatReplay.fireCombatAuraWave`, both gutted to empty hooks) AND the authored **`shop-buff-aura`** def
  (the `shopBuffAll` kind binding and the one literal `playDef('shop-buff-aura')` in `useCombatReplay`).

The two now-orphaned defs (`self-buff-gold.json`, `shop-buff-aura.json`) were deleted.

## What was deliberately KEPT

- **Every moment + channel + the sim data.** `recruitBuffFx` / `auraFx`, the `buffCast` / `buffSelf` channels,
  and the `buffWave` / `attackExchange` / `minionSelfBuffed` / `shopBuffAll` moment cues all still fire — they
  now resolve to no def. The empty fire hooks (`fireAuraWave`, `fireCombatAuraWave`) and the preset/timing reads
  are left in place as the exact spot a new effect plugs in.
- **The per-card authored effects**, which were always separate bindings and are untouched: Dragonflame
  (`buffedOn`), Karwind's flame-ring, Broodfire, the tavern Shout burst (`shop-buff-shout`), and the
  rune/quest reward tendril (which reuses `pixiFx.buffTendril` under its own `questTendril` config).
- **Feel-preserving details**: the stat-badge count-up timing, the mid-combat Shop-buff number float, and every
  sound.

## Why this shape

The renderers `buffTendril` and `pulse` are SHARED — the quest/rune-reward ribbon and the Fodder-Infusion cue
both build on `buffTendril`, and `onImprove` still uses `pulse` — so the strip is surgical at the FIRE SITES
and the BINDINGS, not at the renderers. Bindings are removed rather than tombstoned: a kind has no layer
beneath it, so an absent key already reads as "plays nothing", and the golden binding tests assert exactly that.

## Tests

The binding/def contracts encode "these generic cues exist", so they moved in the same PR: `bindings.test.ts`
(the four kinds dropped from the golden tables and added to the "stays unbound" guard), `score.test.ts` (the
self-buff fan-out block now asserts silence — the regression guard that the generic cue stays gone),
`procScan.test.ts` (`attackExchange` now reports a null bound def), and `directCalls.test.ts` +
`directCalls.ts` (`shop-buff-aura` dropped from the played-from-code snapshot).

## Deferred

The procedural **tuners** (Buff FX ⬆️, Aura Wave 🌊) and their config modules were left in place: `buffFxConfig`
is still load-bearing for the roll timing and Brightwing coalescing, and the tuners still preview the old looks
in the workbench, useful as reference while authoring replacements. Removing them is a clean follow-up once the
new effects define the replacement timing.
