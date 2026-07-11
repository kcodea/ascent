# Buff Pulse — preset-driven point-blast for self-buffs

**Date:** 2026-07-11
**Status:** design approved (owner sign-off 2026-07-11)
**Sibling of:** [`2026-07-10-buff-tendril-design.md`](2026-07-10-buff-tendril-design.md) — the pulse is the in-place
counterpart of the tendril. Where a tendril is a source→target *beam* (a unit buffing **other** allies), a pulse
is an in-place *blast* on a unit buffing **itself**.

## Goal

Add a second combat buff visual: when a unit buffs **only itself** during combat (`source === target`), emit a
procedural **point-blast** at that unit — expanding ring(s) + a core flash + optional sparks — instead of the
`+N/+N` float. The blast look is fully preset-driven (a dial-bag per tribe/card), tuned live in a browser rig,
exactly like the tendril system.

Together, tendrils (buff-others) and pulses (buff-self) cover **100%** of combat `buff` events, so **no** combat
buff shows a `+N` float anymore — the float is replaced by a directed FX in both cases.

## Non-goals (this pass)

- **Recruit-phase** hero-power / spell pulses. Those buffs resolve in the shop phase (a different code path from
  the combat replay) and today get only a sound + CSS medallion glow. Wiring them to `pixiFx.pulse` is a
  **follow-up PR** once the look is locked. This pass is combat self-buffs only.
- Non-`ring` styles (`shard`, `nova`) — reserved in the type, not built.
- A dedicated **neutral** preset — neutral + any unmapped source falls through to `default`.
- Any change to simulation outcomes. This is **presentation-only** (the FX + float suppression + badge timing);
  `simulate()` and the event log are untouched.

## Architecture

Faithful mirror of the tendril system. Five pieces:

### 1. Renderer — `pixiFx.pulse(x, y, cfg)`

A phase-agnostic point-blast fired at a screen coordinate. Composed of dial-driven layers, all procedural (no
art assets), reusing the pooled `spawn(tex, {...})` particle contract and existing textures:

- **Ring(s):** `ringCount` (1–3) concentric rings expanding from center — thin `pulseTex`, each
  `fromScale → toScale` over `ringMs`, staggered by a small per-ring delay so they read as a shockwave.
- **Core flash:** a soft `glowTex` disc that pops to `coreFlashSize` and fades over `coreFlashMs`.
- **Sparks (optional):** `sparkCount` motes radiating outward at `sparkSpeed`, living `sparkLife`, sized
  `sparkSize` (0 = no sparks).
- **`blend`** field (`add` | `normal` | `screen`) — the same cream-board fidelity fix tendrils needed; additive
  washes out on the light board, so tribe presets will mostly use `normal`.

Sizes (`ringSize`, `coreFlashSize`) are **px radii, 1:1 with the preview rig** — the engine divides by the
texture radius to get the sprite scale, so preview values transfer to the game with no bake conversion (same
convention as tendril `flashSize`/`pulseSize`).

State advances in the existing `update` ticker alongside the tendril state arrays; cleanup in `clearParticles` /
`detach`.

**Approach decision:** a dedicated `pulse()` method, *not* a generalization of `buffTendril`. They share the
`spawn()` primitives, but beam geometry vs radial-blast geometry differ enough that one merged config would be
muddy. Separate, readable renderers.

### 2. Presets — `pulsePresets.ts` (sibling of `buffPresets.ts`)

```ts
export interface PulsePresetCfg {
  style: 'ring' | 'shard' | 'nova';   // only 'ring' built; others reserved
  blend: 'add' | 'normal' | 'screen';
  // rings
  ringCount: number; ringSize: number; ringWidth: number; ringSpeed: number; ringMs: number; ringStaggerMs: number;
  // core flash
  coreFlashSize: number; coreFlashMs: number;
  // sparks (sparkCount 0 = off)
  sparkCount: number; sparkSpeed: number; sparkLife: number; sparkSize: number;
  // badge — how long the old value holds before the flash+tick (in-place, so short)
  holdMs: number;
  // colors
  colorRing: string; colorCore: string; colorSpark: string;
}
```

- `PULSE_PRESETS: Record<string, PulsePresetCfg>` — **starts with only `default`.** Per-tribe presets are added
  **after the owner tunes them** on the rig (exactly how the tendril tribe presets were seeded — do not invent
  tuned numbers).
- `PULSE_ASSIGN = { byCard: {}, byTribe: {} }` — empty to start; tribe mappings added alongside the tuned presets.
- `pulsePreset(cardId, tribe): string` — resolve per-card → per-tribe → `'default'`, returning a name only if it
  exists in `PULSE_PRESETS` (a stale mapping falls through to `default`). Identical shape to `buffPreset`.

### 3. Trigger wiring — combat self-buffs

- **New pure channel** `choreo/channels/buffSelf.ts`:
  ```ts
  export interface SelfBuff { uid: string; attack: number; health: number; }
  export function groupSelfBuffs(moment: Moment, events: CombatEvent[]): SelfBuff[]
  ```
  Collects `buff` events where `source === target`, summed per uid, in first-appearance order. Mirror of
  `groupBuffCasts` with the opposite predicate. Pure + unit-tested.
- **`score.ts`:** add a `'buffSelf'` channel; include it in the `buffWave` moment kind (fires at moment start,
  alongside `buffCast`); add `onSelfBuffs(selfBuffs: SelfBuff[])` to `CueContext`; route it in the handler.
- **`useCombatReplay.ts`:** implement `onSelfBuffs` — for each self-buff, resolve the unit's `cardId`/`tribe`
  (via the existing `cardIds` map + `CARD_INDEX`) → `pulsePreset` → look up `PULSE_PRESETS[name]` →
  `pixiFx.pulse(cx, cy, cfg)` at the unit's on-screen rect center (same rect source the tendril strike uses).

### 4. Badge + float

- **Float suppression** (`choreo/channels/float.ts`): the buff branch currently does
  `if (e.source !== e.target) continue;` (suppress buff-others, keep self floats). Change it to suppress **both**
  — i.e. drop every `buff` float. Rationale: tendrils handle source≠target, pulses handle source===target, and
  those two sets are exhaustive over combat buff events (every combat `buff` carries a real `source` uid that is
  either equal to or different from `target` — verified, there is no source-less combat buff).
- **Badge hold + flash** (`useCombatReplay.ts`, reusing the tendril `statHold`/`statFlash` machinery): snapshot
  the unit's pre-buff badge value, hold it for `holdMs` (~100ms default — a short windup; a pulse is in-place so
  there is no travel to cover), then flash the badge and tick it to the new value at the blast peak. Only the
  stats that actually changed flash (atk and/or hp). Uses the same `.statflash` compositor-only CSS class
  (transform/opacity, 60fps) and the same `React.memo` comparator additions already in `Unit.tsx`.

### 5. Editor rig — `apps/web/public/fx/buff-pulse-preview.html`

A self-contained clone of `buff-tendril-preview.html`:
- Cream-accurate board background + a `blend` dropdown (add/normal/screen).
- Every `PulsePresetCfg` dial as a labeled slider (ring count/size/width/speed/ms/stagger, core flash size/ms,
  spark count/speed/life/size, holdMs, and color pickers for ring/core/spark).
- A draggable unit anchor, a **Fire** button + an auto-repeat toggle, and a live **preset-export JSON** textarea.
- The owner tunes, copies the JSON, and it is **baked** into `pulsePresets.ts` (generated straight from the JSON
  to avoid transcription drift — same discipline as the tendril bake).

Loads at `http://localhost:5173/fx/buff-pulse-preview.html` off `npm run dev`.

## Data flow

```
combat event log ──▶ compileMoments ──▶ buffWave moment
                                          ├─ buffCast channel  ─▶ groupBuffCasts  ─▶ onBuffCasts  ─▶ pixiFx.buffTendril  (buff-others)
                                          └─ buffSelf channel  ─▶ groupSelfBuffs  ─▶ onSelfBuffs  ─▶ pixiFx.pulse        (buff-self)
float channel: every buff float suppressed (both sets are FX-driven now)
badge: statHold snapshot ─(holdMs)─▶ statFlash + tick to new value at blast peak
```

## Testing / verification

- **Unit test** `buffSelf.test.ts`: self-buffs grouped + summed per uid; buff-others excluded; order stable.
  (Mirror of `buffCast.test.ts`.)
- **Preset test** `pulsePresets.test.ts`: `pulsePreset` resolution (card → tribe → default; stale mapping →
  default); every `PULSE_PRESETS` entry has all `PulsePresetCfg` fields.
- **Float test**: extend the existing float channel test to assert no float is emitted for a self-buff.
- `npm run typecheck && npm run lint && npm test && npm run build:web` all green before the PR.
- **Live check** on the dev server: a mono-self-buff board (e.g. a unit that pumps only itself Start-of-Combat)
  fires a pulse at that unit, the badge holds then flashes to the new value, and no `+N` float appears.

## Follow-ups (tracked in roadmap, not this PR)

- Recruit-phase hero-power / spell pulses (shop-phase action path → `pixiFx.pulse`).
- `shard` / `nova` pulse styles.
- A dedicated neutral pulse preset.
- Per-tribe pulse presets get tuned + baked in this PR's tuning loop (the rig is delivered; the tuned numbers
  land once the owner dials them, same as tendrils).
