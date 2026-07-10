# Combat Buff-Cast FX — Energy Tendrils (Design)

**Date:** 2026-07-10 · **Author:** Mike (+ Claude) · **Status:** approved, pre-plan

When a unit buffs **another** unit during combat, play a directed effect: an energy **tendril** shoots from the
buffer to the target, **strikes** it, and the target releases a quick **flash** — signalling it received the
buff. Built as a **reusable, preset-driven effect system** (not a one-off), so a tuned look can be duplicated,
tweaked, and assigned to a different unit without touching the original.

**Presentation-only.** The sim event log, resolution order, and combat outcomes are untouched — this only
changes how existing `buff` events are *rendered*. Same guarantee as the Echo poof.

## Background — how combat buffs work

Every combat buff flows through `ctx.buff(target, atk, hp, source)` in `simulate.ts`, which emits
`{ type: 'buff', target, attack, health, source }`. The event carries **both** the buffer (`source`) and the
recipient (`target`) uids — the two anchors a tendril needs. Buffs come in two shapes:

- **Self-buffs** (`source === target`) — e.g. a minion gaining +3/+3 on summon. No source to shoot from.
- **Buff-others** (`source !== target`) — almost always **tribe-wide auras**: one source → *every* matching
  ally at once (Start-of-Combat tribe auras, on-attack Growth casts, …). There is essentially no
  "one unit buffs one specific other unit" in combat, so the effect is **inherently one-source → many-targets**.

Today a combat buff pops a `+N/+N` float on the target (float channel, `float.ts`).

## Desired behavior

For each buff where `source !== target`, at the buff's moment in the replay:

1. **Emit** — the source flashes a brief empowerment pulse (a soft glow at the caster).
2. **Travel** — an organic **tendril** grows from the source toward the target along a gently curved, wavy path
   (a quadratic curve + sine wobble), drawn as a **tapered ribbon**: bright core + soft glow, thick at the base,
   tapering to a point. Whips out over ~150–250 ms.
3. **Strike, flash & stat tick** — the tip stabs the target, which releases a quick **radial flash** (additive
   bloom, keyed to the effect colour) + a small burst of motes. **At this instant the target's affected stat
   badge(s) flash in place and tick over to their new value** — only the stats that actually changed (a
   Health-only buff flashes only Health; a +1/+1 flashes both Attack and Health). The tendril then
   retracts/dissolves fast so it doesn't linger.

The buffer fires **one tendril per target, all simultaneously** — a wide board reads as several tendrils
lancing out at once.

**Float handling & the stat read.** The `+N/+N` float is **suppressed only for buffs that get a tendril**
(`source !== target`). The magnitude is read instead off the **badge flash→new-value** at the strike — a
better read than the old passive jump, because the number changes *on* the hit. This requires a **held stat
value**: today the badge updates at the *start* of the buff moment, but the tendril travels ~150–250 ms first,
so for a tendril-buffed target the **displayed** Attack/Health is held at its pre-buff number until the strike,
then flashes and swaps (the same "hold the effect until it lands" pattern as the Echo aftermath). Without the
hold, the number would change before the tendril visually arrives and cause/effect would read backwards. (The
underlying sim stats are unchanged — this is a presentation-only deferral of the *displayed* value.) **Self-buffs
keep their existing float** and their current at-moment-start stat update (no tendril this iteration).

## Architecture — a reusable, preset-driven effect system

The core design decision: **separate the renderer from its dials**, so effects are data.

### 1. Generic renderer — `pixiFx.buffTendril(from, to, cfg)`

Takes a source rect, a target rect, and a **config object**. Every dial is a field of `cfg`, not a hardcoded
constant: `style`, colour(s), curve amount, wobble amplitude/frequency, thickness, taper, travel duration,
glow, flash size, mote count, caster-pulse size, etc. The renderer draws whatever the config says. (The tendril
ribbon is likely a Pixi `MeshRope`/rope along the sampled path; the cheapest primitive is confirmed on the
preview before wiring. Motes/flash reuse the existing `glowTex` particle system.)

### 2. Presets — `buffPresets.ts` (a named registry of dial-bags)

```ts
export const BUFF_PRESETS = {
  default:     { style: 'tendril', color: '#c8e070', curve: 0.3, wobble: …, … },
  kennelmaster:{ style: 'tendril', color: '#c8e070', … },
  // future: 'ember-drake': { style: 'tendril', color: '#ff7a3c', curve: 0.5, … },
};
```

Each preset is one **complete look**. Duplicating a preset and nudging a few dials yields a new look that
**shares nothing** with the original — editing one preset can never affect another. `style` (`'tendril'` for
now; `'lightning'`/`'beam'` later) is just a field, so all variants live in the same structure.

### 3. Resolver — `buffPreset(sourceCardId, tribe): PresetName`

**Most-specific wins:** a per-card entry → else a per-tribe entry → else `default`. A separate assignment map
keys cards/tribes to preset names:

```ts
const BUFF_ASSIGN = { byCard: { kennel: 'kennelmaster' }, byTribe: { /* beast: 'kennelmaster' */ } };
```

Assigning a tuned look to a different unit is a **one-line data entry** — no code, no risk to existing effects.

### 4. Cue channel — `buffCast`

A new choreographer cue channel (sibling to `impact`/`aura` in `choreo/channels/`). On a `buffWave` moment it
groups that moment's `buff` events **by source**, and for each source with `source !== target` calls
`pixiFx.buffTendril(sourceRect, targetRect, BUFF_PRESETS[buffPreset(sourceCard, tribe)])` per target. Anchors
resolve from the event's `source`/`target` uids exactly as the aura/float channels resolve rects today.

### 5. Stat-badge flash + held value (UI layer)

The badge flash is a **DOM/CSS** animation on the card's Attack/Health corner badge (`Card`/`Unit`), not a Pixi
particle — a quick scale-pop + colour flash, keyed per-stat. Two pieces wire it:

- **Held displayed value.** For a target buffed by a tendril this moment, the replay holds the shown Attack/
  Health at its **pre-buff** number until the strike callback fires (`buffCast` schedules it at the tendril's
  arrival, `~travelDur` after launch), then releases the new value. Only the *displayed* value is deferred; the
  sim/frame stats are already final. Mirrors the Echo aftermath's "hold until it lands."
- **Flash trigger.** At the strike, the target's changed badges get a transient `flash` class (per-stat), so
  Attack and Health flash independently and only when they actually changed.

The set of "which stats changed for whom this moment" comes from the same by-source buff grouping the cue channel
already computes (attack/health deltas per target), so the flash and the tendril fire from one source of truth.

### 6. Editor — `apps/web/public/fx/buff-tendril-preview.html`

Standalone `file://`-openable rig, **preset-aware**: a preset **dropdown** (pick one to edit), **duplicate as
new** (name it), sliders for every dial, two **draggable anchor points** (source + target) and a **multi-target
toggle** to preview the fan-out, and **export the whole registry as JSON**. Baking = pasting that JSON into
`buffPresets.ts`. Mirrors the particle/timing math of the engine so tuned numbers transfer (same discipline as
the skull rig — including any per-frame↔per-second drag conversion).

## Iteration 1 scope

- The generic `buffTendril` renderer (config-driven), the `buffPresets.ts` registry (a `default` + a
  `kennelmaster` preset), and the `buffPreset` resolver (card → tribe → default).
- The `buffCast` cue channel + float suppression for `source !== target` buffs.
- The **stat-badge flash + held displayed value** on tendril-buffed targets (Attack/Health flash and tick to
  their new number at the strike; only the changed stats flash).
- The preset-aware preview rig, tuned and baked.
- Tuned + verified live on **Kennelmaster** (`kennel`; `scBeastAura`, Start-of-Combat +1/+1 to Beasts → one
  tendril per Beast, simultaneous). Chosen because it fires **once, deterministically, every fight**, emits
  clean per-target `buff` events, and is a common Tier-2 Beast easy to force a Beast board around. (Its aura
  also re-buffs Beasts summoned later mid-fight; the clean first-iteration test is the Start-of-Combat burst.)

## Non-goals / deferred

- The **lightning** and **beam** styles (the `style` field + renderer seam are ready; only `tendril` is built).
- **Per-tribe/per-buff colour theming** beyond what presets already allow (the system supports it; we ship a
  `default` + one tuned preset).
- Changing **self-buff** feedback (they keep their `+N/+N` float this iteration).
- **Staggered** fan-out (iteration 1 is simultaneous).
- No `@game/core`/`sim`/`content` changes.

## Testing

- **Unit-test the pure logic:** the group-buffs-by-source pass (attack/health deltas per target), the
  `source !== target` predicate that decides tendril-vs-float, and the held-value/flash selection (which target's
  which stat changed this moment). The resolver (`buffPreset` most-specific-wins) gets a small table test. FX
  methods no-op under node, so the visual is **preview-verified**, not unit-tested.
- Full suite green: `npm run typecheck && npm run lint && npm test && npm run build:web`.
- **Live:** force a Beast board + Kennelmaster, enter a fight, watch the Start-of-Combat tendrils fan out and
  strike; confirm each target's Attack/Health badge **holds its old value, then flashes and ticks to the new
  value on the strike** (the magnitude read that replaces the float), and that only the changed stats flash.

## Rollout

Isolated worktree (`feat/buff-tendril`, off `main`). Preview-first per the repo FX rule — the look is agreed and
tuned on the rig **before** any `pixiFx.ts` wiring. Baked, docs (devlog/roadmap/README) updated, PR → CI →
squash-merge. Owner previews before merge. Same flow as the Echo poof.
