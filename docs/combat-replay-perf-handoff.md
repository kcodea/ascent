# Handoff — combat-replay perf under attachment / Beatbot boards (for Mike)

**Owner:** presentation (`packages/ui`) — this is combat-arena replay, deliberately left out of the
attachment/weld perf PR (owner asked not to touch combat replay in that pass).

## Why this exists

Late-game **attachment / Beatbot** boards bog down. The root multiplier is engine-side: attachment-heavy
boards inflate the combat **event log**. Better Bot (`rallyMechAtk`) buffs *every friendly Mech on every
swing* → O(Mechs) buff events per swing, doubled by Windfury (`packages/core/src/combat/simulate.ts:1204-1210`,
SoC variant `1618-1632`); Chorus Engine (`packages/core/src/effects/factories.ts:787`) is similar; and
**Beatbot mirrors every weld onto itself, uncapped** (`packages/sim/src/recruit.ts:584-593`), adding more
welded hosts that each rally. So `events` grows ~quadratically with board size × weld count.

That inflated log is fine for the pure sim — but the **replay** re-pays for it in two places, both in
`packages/ui/src/useCombatReplay.ts`. Neither was touched in the weld/autosave PR.

## Driver 1 (dominant in-combat) — O(events²) frame fold

`computeFrame` re-folds the **entire event log from index 0 on every beat**:

- `useCombatReplay.ts:127` — `for (let i = 0; i < Math.min(upto, events.length); i++)` folds from 0 each call.
- `useCombatReplay.ts:1115-1118` — `frame` is a `useMemo` keyed on `processedEnd` / `beatStart`, both of which
  change every beat (`1111-1114`), so the fold re-runs per beat.
- `useCombatReplay.ts:95` — each invocation rebuilds all `UnitFrame`s via `fromSnap`, cloning every unit's
  `buffs` array (`s.buffs.map((b) => ({ ...b }))`). Attachment boards carry longer `buffs` and (critically) far
  more buff *events* to fold, so both loop length and per-unit clone cost inflate.

Net: per-beat cost is O(events-so-far); summed over all beats it's **O(events²)**, and `events` is exactly
what attachments blow up.

**Suggested fix:** make the fold **incremental** — cache the folded state at beat *k* and advance forward from
it to beat *k+1* instead of refolding from 0. Turns O(events²) → O(events). Combat replay is load-bearing:
gate behind the existing determinism + golden tests and a before/after `npm run perf` on a Beatbot-heavy 7v7
(add that archetype to `packages/tools/src/perf.ts` if it isn't there).

## Driver 2 — getBoundingClientRect / tendril volume per beat

`fireBuffCasts` reads **two** rects (source + target) for **every** buff-OTHER cast in the beat
(`useCombatReplay.ts:625` and `632`) and spawns a Pixi tendril each. Better Bot casts one buff per friendly
Mech per swing, so a single welded-host swing on a 7-Mech board is ~6 casts → ~12 `getBoundingClientRect`
reads + 6 tendrils that beat. This is the mechanism behind the docs' "~100k getBoundingClientRect/combat"
(`docs/performance.md`) — it's driven by attachment buff-cast volume, not a fixed per-frame read. The per-beat
cue effect adds more rect reads per acting unit (`useCombatReplay.ts:818, 856, 867, 877, 889, 900`).

**Suggested fix:** measure each unit's rect **once per beat** and reuse it across that beat's casts/cues
(the roadmap's "cache the rects, re-measure only on layout change"). Optionally cap/batch simultaneous tendrils
on very wide buff fans.

## Not in scope here (already handled or held)
- **Autosave O(n²)** and the **drag pre-roll** — fixed in the weld/autosave PR (debounced autosave; `magSlideMs`
  390→200).
- **Weld beat cadence** (the 930ms End-of-Turn beat clock in `Recruit.tsx:2738`) and **Blueprint Cache /
  Beatbot growth** (`recruit.ts:3165` + the uncapped mirror) — held for an owner feel/balance call; both are
  entangled with tuned End-of-Turn pacing (the 2026-07-18 attachment-major ruling) and, for Beatbot, run
  balance.

## Verify
- `npm run perf` before/after (Beatbot 7v7 archetype) — watch the simulate + `reduce()`-with-`lastCombat` lines.
- Prod build + `?perf=1`, play to a late-game Beatbot combat; read `worst` / `jank` during the replay.
- Determinism + golden tests must pass unchanged.
