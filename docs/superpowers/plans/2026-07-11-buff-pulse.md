# Buff Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a preset-driven procedural **point-blast** ("pulse") FX that fires on combat **self-buffs** (`source === target`) — expanding ring(s) + core flash + optional sparks — replacing the `+N/+N` float and flashing the unit's badge to its new value, with a live tuning rig, exactly mirroring the tendril system.

**Architecture:** Sibling of the buff-tendril system. A phase-agnostic `pixiFx.pulse(x, y, cfg)` renderer (fire-and-forget particles + a small per-pulse state array for ring stagger), a `pulsePresets.ts` dial-bag registry + `pulsePreset(cardId, tribe)` resolver, a pure `groupSelfBuffs` channel, a `buffSelf` cue on the `buffWave` moment, and a `useCombatReplay` handler that fires the pulse and reuses the existing `statHold`/`statFlash` badge machinery. Float suppression is extended so **every** combat buff float is now FX-driven.

**Tech Stack:** TypeScript, React, Zustand, PixiJS v8 (pooled `spawn()` particle contract), Vitest. Monorepo: `@game/ui` (all changes), `@game/core`/`@game/content` (read-only types + `CARD_INDEX`).

**Working dir:** the isolated worktree `.claude/worktrees/buff-pulse` on branch `feat/buff-pulse`. Run all commands from there.

---

## File Structure

- **Create** `apps/web/public/fx/buff-pulse-preview.html` — the tuning rig (self-contained; clone of `buff-tendril-preview.html`).
- **Create** `packages/ui/src/pulsePresets.ts` — `PulsePresetCfg`, `PULSE_PRESETS`, `PULSE_ASSIGN`, `pulsePreset()`.
- **Create** `packages/ui/src/pulsePresets.test.ts` — resolver + shape tests.
- **Create** `packages/ui/src/choreo/channels/buffSelf.ts` — pure `groupSelfBuffs()`.
- **Create** `packages/ui/src/choreo/channels/buffSelf.test.ts` — grouping tests.
- **Modify** `packages/ui/src/choreo/channels/float.ts` — suppress self-buff floats too.
- **Modify** `packages/ui/src/choreo/channels/float.test.ts` (or wherever float is tested) — assert self-buff → no float.
- **Modify** `packages/ui/src/pixiFx.ts` — `PulseCfg` type, `pulses` state array, `pulse()` method, `update` advance, `clearParticles`/`detach` cleanup.
- **Modify** `packages/ui/src/choreo/score.ts` — `'buffSelf'` channel, `buffWave` cue, `onSelfBuffs` in `CueContext`, runner handler.
- **Modify** `packages/ui/src/choreo/score.test.ts` — route a self-buff → `onSelfBuffs`.
- **Modify** `packages/ui/src/useCombatReplay.ts` — `onSelfBuffs` handler (fire pulse + held-value/flash).
- **Modify** `docs/devlog.md`, `docs/roadmap.md`, `README.md` — history/queue/front-page.

**Note on the badge:** the `statHold`/`statFlash` state maps, their `statHoldFor`/`statFlashFor` accessors, the `Unit.tsx` props + memo comparator, the `Card.tsx` `flashAtk`/`flashHp`, and the `.statflash` CSS class ALL already exist (built for tendrils). The pulse reuses them verbatim — no new badge files.

---

## Task 0: Preview rig — `buff-pulse-preview.html`

**Files:**
- Create: `apps/web/public/fx/buff-pulse-preview.html`
- Reference: `apps/web/public/fx/buff-tendril-preview.html` (clone its structure: cream bg, blend dropdown, sliders, draggable anchor, Fire button + auto-repeat, live JSON export)

- [ ] **Step 1: Read the tendril rig to copy its skeleton**

Run: open `apps/web/public/fx/buff-tendril-preview.html` and study the canvas setup, the cream background color, the slider-row helper, the blend `<select>`, the JSON export textarea, and the requestAnimationFrame loop. Reproduce that skeleton.

- [ ] **Step 2: Build the rig with the pulse dial set**

Create `apps/web/public/fx/buff-pulse-preview.html` as a self-contained page (inline `<style>` + `<script>`, no imports). It must:
- Use the same cream board background as the tendril rig (match its `--bg` / canvas fill exactly — copy the literal color).
- Render a draggable "unit" marker (a card-sized rounded rect) the pulse fires on; default it near center.
- Expose a labeled slider (with a live numeric readout) for every `PulsePresetCfg` dial:
  `ringCount (1–3, step 1)`, `ringSize (10–200 px)`, `ringWidth (1–24 px)`, `ringSpeed (0.2–3 multiplier)`, `ringMs (100–1200)`, `ringStaggerMs (0–200)`, `coreFlashSize (10–200 px)`, `coreFlashMs (100–1000)`, `sparkCount (0–60, step 1)`, `sparkSpeed (0–900)`, `sparkLife (200–1400)`, `sparkSize (2–40 px)`, `holdMs (0–400)`, and a `blend` `<select>` (`add`/`normal`/`screen`).
- Expose three `<input type="color">` pickers: `colorRing`, `colorCore`, `colorSpark`.
- A **Fire** button that plays one pulse at the marker, and an **Auto-repeat** checkbox that re-fires every ~1.2s.
- A read-only **JSON** textarea that always reflects the current dials as a `PulsePresetCfg` literal (include `style: 'ring'`), updated on every input — this is what the owner copies for the bake.
- Implement the pulse visually in plain canvas 2D to match the intended engine look: `ringCount` expanding stroked rings (radius `0 → ringSize`, staggered by `ringStaggerMs`, each fading over `ringMs`, line width `ringWidth`, color `colorRing`), a filled radial-gradient core flash (radius → `coreFlashSize`, fading over `coreFlashMs`, color `colorCore`), and `sparkCount` dots radiating outward at `sparkSpeed` px/s, living `sparkLife`, size `sparkSize`, color `colorSpark`. Honor `blend` via `ctx.globalCompositeOperation` (`add`→`lighter`, `screen`→`screen`, `normal`→`source-over`).
- Sizes are px radii (the engine will divide by its texture radius, so the rig is the source of truth in px).

- [ ] **Step 3: Verify it loads**

Run: `cd .claude/worktrees/buff-pulse && npm run dev` (Vite), then open `http://localhost:5173/fx/buff-pulse-preview.html`.
Expected: page renders on the cream background; dragging the marker moves it; **Fire** plays a ring+flash+sparks blast; changing dials updates the look and the JSON textarea live. (This is a manual eyeball — no automated test for the rig.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/public/fx/buff-pulse-preview.html
git commit -m "feat(fx): buff-pulse tuning rig (preview) — dials, blend, live JSON export"
```

---

## Task 1: `pulsePresets.ts` — type + registry + resolver

**Files:**
- Create: `packages/ui/src/pulsePresets.ts`
- Test: `packages/ui/src/pulsePresets.test.ts`
- Reference: `packages/ui/src/buffPresets.ts` (mirror its `buffPreset` resolver + `BUFF_ASSIGN` shape)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/pulsePresets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PULSE_PRESETS, pulsePreset, type PulsePresetCfg } from './pulsePresets';
import type { Tribe } from '@game/core';

const FIELDS: (keyof PulsePresetCfg)[] = [
  'style', 'blend', 'ringCount', 'ringSize', 'ringWidth', 'ringSpeed', 'ringMs', 'ringStaggerMs',
  'coreFlashSize', 'coreFlashMs', 'sparkCount', 'sparkSpeed', 'sparkLife', 'sparkSize', 'holdMs',
  'colorRing', 'colorCore', 'colorSpark',
];

describe('pulsePresets', () => {
  it('every preset has every PulsePresetCfg field', () => {
    for (const [name, cfg] of Object.entries(PULSE_PRESETS)) {
      for (const f of FIELDS) expect(cfg[f], `${name}.${String(f)}`).not.toBeUndefined();
    }
  });

  it('always has a default preset', () => {
    expect(PULSE_PRESETS.default).toBeDefined();
  });

  it('pulsePreset falls through to default for an unmapped card + tribe', () => {
    expect(pulsePreset('no-such-card', 'neutral' as Tribe)).toBe('default');
  });

  it('pulsePreset returns default when a mapping points at a missing preset (stale mapping)', () => {
    // With no byCard/byTribe entries yet, everything resolves to default.
    expect(pulsePreset('anything', 'beast' as Tribe)).toBe('default');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .claude/worktrees/buff-pulse && npm test -- pulsePresets`
Expected: FAIL — cannot resolve `./pulsePresets` (module not created yet).

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/pulsePresets.ts`:

```ts
// packages/ui/src/pulsePresets.ts
import type { Tribe } from '@game/core';

/** One self-buff pulse look. Every dial the renderer reads is a field here (no hardcoded constants), so a
 *  preset is a complete, self-contained config. `style` selects the renderer (only 'ring' is built; 'shard' /
 *  'nova' are reserved). Colors are hex strings; the renderer converts to Pixi tints. Sizes (`ringSize`,
 *  `coreFlashSize`, `sparkSize`) are PX RADII — 1:1 with the preview rig; the engine divides by the texture
 *  radius to get the sprite scale, so preview values transfer with no bake conversion. */
export interface PulsePresetCfg {
  style: 'ring' | 'shard' | 'nova';
  /** How the layers composite. 'add' = additive bloom (washes on the light board); 'normal' = paints the actual
   *  color (reads on cream); 'screen' = lighten. Tribe presets will mostly use 'normal'. */
  blend: 'add' | 'normal' | 'screen';
  // rings
  ringCount: number; ringSize: number; ringWidth: number; ringSpeed: number; ringMs: number; ringStaggerMs: number;
  // core flash
  coreFlashSize: number; coreFlashMs: number;
  // sparks (sparkCount 0 = off)
  sparkCount: number; sparkSpeed: number; sparkLife: number; sparkSize: number;
  /** ms the old badge value holds before the flash+tick. A pulse is in-place (no travel), so this is short. */
  holdMs: number;
  // colors
  colorRing: string; colorCore: string; colorSpark: string;
}

/** A neutral starter look (owner tunes the real values on the rig; per-tribe presets are added AFTER tuning,
 *  same as the tendril tribe presets — do NOT invent tuned numbers here). */
const DEFAULT: PulsePresetCfg = {
  style: 'ring', blend: 'normal',
  ringCount: 2, ringSize: 90, ringWidth: 6, ringSpeed: 1, ringMs: 460, ringStaggerMs: 70,
  coreFlashSize: 70, coreFlashMs: 320,
  sparkCount: 14, sparkSpeed: 420, sparkLife: 620, sparkSize: 10,
  holdMs: 100,
  colorRing: '#ffd24a', colorCore: '#fff0d0', colorSpark: '#ffb054',
};

export const PULSE_PRESETS: Record<string, PulsePresetCfg> = {
  default: { ...DEFAULT },
};

/** Card-id / tribe → preset-name assignment. Most-specific wins (see `pulsePreset`). Empty to start; per-tribe
 *  mappings are added alongside the tuned presets in the bake task. */
const PULSE_ASSIGN: { byCard: Record<string, string>; byTribe: Partial<Record<Tribe, string>> } = {
  byCard: {},
  byTribe: {},
};

/** Resolve the preset name for a self-buff source: per-card → per-tribe → 'default'. A name is only returned if
 *  it exists in PULSE_PRESETS (a stale mapping falls through to 'default'). Mirror of `buffPreset`. */
export function pulsePreset(cardId: string, tribe: Tribe): string {
  const byCard = PULSE_ASSIGN.byCard[cardId];
  if (byCard && PULSE_PRESETS[byCard]) return byCard;
  const byTribe = PULSE_ASSIGN.byTribe[tribe];
  if (byTribe && PULSE_PRESETS[byTribe]) return byTribe;
  return 'default';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd .claude/worktrees/buff-pulse && npm test -- pulsePresets`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pulsePresets.ts packages/ui/src/pulsePresets.test.ts
git commit -m "feat(fx): pulsePresets — PulsePresetCfg + default registry + resolver"
```

---

## Task 2: `groupSelfBuffs` channel

**Files:**
- Create: `packages/ui/src/choreo/channels/buffSelf.ts`
- Test: `packages/ui/src/choreo/channels/buffSelf.test.ts`
- Reference: `packages/ui/src/choreo/channels/buffCast.ts` (mirror with the OPPOSITE predicate)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/choreo/channels/buffSelf.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import { groupSelfBuffs } from './buffSelf';
import type { Moment } from '../compile';

const moment = (start: number, end: number): Moment => ({ start, end } as Moment);

describe('groupSelfBuffs', () => {
  it('collects self-buffs (source === target), summing repeats per uid', () => {
    const events: CombatEvent[] = [
      { type: 'buff', target: 'a', source: 'a', attack: 2, health: 1 },
      { type: 'buff', target: 'a', source: 'a', attack: 1, health: 3 },
      { type: 'buff', target: 'b', source: 'b', attack: 4, health: 0 },
    ];
    expect(groupSelfBuffs(moment(0, 3), events)).toEqual([
      { uid: 'a', attack: 3, health: 4 },
      { uid: 'b', attack: 4, health: 0 },
    ]);
  });

  it('excludes buff-OTHERS (source !== target)', () => {
    const events: CombatEvent[] = [
      { type: 'buff', target: 'x', source: 'y', attack: 5, health: 5 },
    ];
    expect(groupSelfBuffs(moment(0, 1), events)).toEqual([]);
  });

  it('only reads events within the moment window', () => {
    const events: CombatEvent[] = [
      { type: 'buff', target: 'a', source: 'a', attack: 1, health: 1 },
      { type: 'buff', target: 'b', source: 'b', attack: 9, health: 9 },
    ];
    expect(groupSelfBuffs(moment(1, 2), events)).toEqual([{ uid: 'b', attack: 9, health: 9 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .claude/worktrees/buff-pulse && npm test -- buffSelf`
Expected: FAIL — cannot resolve `./buffSelf`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/choreo/channels/buffSelf.ts`:

```ts
// packages/ui/src/choreo/channels/buffSelf.ts
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

/** One self-buff pulse to fire: a unit (`uid`) empowering ITSELF by the summed delta this moment. */
export interface SelfBuff { uid: string; attack: number; health: number; }

/** Collect this moment's buff events where `source === target` into per-uid totals, summing repeated self-buffs
 *  to the same unit. Order: first appearance of each uid. Buff-OTHERS (source !== target) are excluded (they are
 *  handled by the tendril channel). Pure. Mirror of `groupBuffCasts` with the opposite predicate. */
export function groupSelfBuffs(moment: Moment, events: CombatEvent[]): SelfBuff[] {
  const order: string[] = [];
  const byUid = new Map<string, SelfBuff>();
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'buff') continue;
    if (e.source !== e.target) continue; // buff-OTHER: handled by the tendril channel
    const cur = byUid.get(e.target);
    if (cur) { cur.attack += e.attack; cur.health += e.health; }
    else { const s = { uid: e.target, attack: e.attack, health: e.health }; byUid.set(e.target, s); order.push(e.target); }
  }
  return order.map((k) => byUid.get(k)!);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd .claude/worktrees/buff-pulse && npm test -- buffSelf`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/choreo/channels/buffSelf.ts packages/ui/src/choreo/channels/buffSelf.test.ts
git commit -m "feat(fx): groupSelfBuffs channel (self-buffs, summed per uid)"
```

---

## Task 3: Suppress the self-buff float

**Files:**
- Modify: `packages/ui/src/choreo/channels/float.ts:68-74` (the `buff` branch in `spawnFloats`)
- Test: `packages/ui/src/choreo/channels/float.test.ts` (create if absent)

- [ ] **Step 1: Write/extend the failing test**

If `packages/ui/src/choreo/channels/float.test.ts` exists, add the case below; otherwise create it:

```ts
import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import { spawnFloats } from './float';
import type { Moment } from '../compile';

const moment = (start: number, end: number): Moment => ({ start, end } as Moment);
const noEl = () => null;

describe('spawnFloats — buff suppression', () => {
  it('emits NO float for a self-buff (source === target) — the pulse handles it', () => {
    const events: CombatEvent[] = [{ type: 'buff', target: 'a', source: 'a', attack: 2, health: 2 }];
    const { floats } = spawnFloats(moment(0, 1), events, noEl, null);
    expect(floats.filter((f) => f.kind === 'buff')).toEqual([]);
  });

  it('emits NO float for a buff-other (source !== target) — the tendril handles it', () => {
    const events: CombatEvent[] = [{ type: 'buff', target: 'a', source: 'b', attack: 2, health: 2 }];
    const { floats } = spawnFloats(moment(0, 1), events, noEl, null);
    expect(floats.filter((f) => f.kind === 'buff')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .claude/worktrees/buff-pulse && npm test -- float`
Expected: FAIL — the self-buff case still emits a `+2/+2` buff float (current code keeps self-buff floats).

- [ ] **Step 3: Make the change**

In `packages/ui/src/choreo/channels/float.ts`, the buff branch currently reads:

```ts
    if (e?.type === 'buff') {
      if (e.source !== e.target) continue; // buff-OTHER: rendered as a tendril + badge flash, not a float
      const cur = buffByTarget.get(e.target) ?? { a: 0, h: 0, id: i };
      cur.a += e.attack;
      cur.h += e.health;
      buffByTarget.set(e.target, cur);
      continue;
    }
```

Replace the whole `if (e?.type === 'buff') { … }` block with a single skip — every combat buff is now FX-driven (tendril for others, pulse for self), so no buff produces a float:

```ts
    // Every combat buff is now a directed FX, not a float: buff-OTHER (source !== target) → tendril,
    // self-buff (source === target) → pulse. Both flash the badge to the new value. So suppress ALL buff floats.
    if (e?.type === 'buff') continue;
```

Then remove the now-dead `buffByTarget` map declaration (line ~65) and the trailing loop that flushed it into `spawned` (lines ~85-87):

```ts
  const buffByTarget = new Map<string, { a: number; h: number; id: number }>();   // DELETE this line
  …
  for (const [uid, { a, h, id }] of buffByTarget) {                                 // DELETE this whole loop
    spawned.push({ id, uid, text: `+${a}/+${h}`, kind: 'buff' });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd .claude/worktrees/buff-pulse && npm test -- float`
Expected: PASS (both buff cases emit no float). Also run `npm run typecheck` to confirm no unused-var / type errors from the deletions.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/choreo/channels/float.ts packages/ui/src/choreo/channels/float.test.ts
git commit -m "feat(fx): suppress ALL combat buff floats (self→pulse, other→tendril)"
```

---

## Task 4: `pixiFx.pulse()` renderer

**Files:**
- Modify: `packages/ui/src/pixiFx.ts` — add `PulseCfg` type (near `TendrilCfg`, ~line 407), a `pulses` state array + `PulseFx` interface, the `pulse()` method (near `impactPulse`, ~line 796), the advance loop in `update` (after the tendrils loop, ~line 1866), and cleanup in `clearParticles` (~1248) + `detach` (~627).
- Reference: `impactPulse` (line 796, ring via `spawn(pulseTex, …)`), `buffTendril` (line 1633, per-frame state), the `Particle`/`spawn` contract (line 326), `PULSE_TEX_R` (line 481), `TENDRIL_GLOW_R` (line 432).

There is no automated test for Pixi rendering (it needs a WebGL context); verification is the live rig + in-game check. Keep the method a pure translation of the rig's math.

- [ ] **Step 1: Add the `PulseCfg` type**

In `packages/ui/src/pixiFx.ts`, right after the `TendrilCfg` interface (~line 415), add:

```ts
/** Renderer-facing pulse config (structural match of PulsePresetCfg — pixiFx stays import-light). */
export interface PulseCfg {
  style: 'ring' | 'shard' | 'nova';
  blend: 'add' | 'normal' | 'screen';
  ringCount: number; ringSize: number; ringWidth: number; ringSpeed: number; ringMs: number; ringStaggerMs: number;
  coreFlashSize: number; coreFlashMs: number;
  sparkCount: number; sparkSpeed: number; sparkLife: number; sparkSize: number;
  holdMs: number;
  colorRing: string; colorCore: string; colorSpark: string;
}
```

- [ ] **Step 2: Add the `PulseFx` state interface + the `pulses` array field**

After the `Tendril` interface (~line 447), add:

```ts
/** One live pulse blast at a point. Rings are staggered, so a tiny state entry emits ring `i` when its stagger
 *  time elapses (the pooled particles then animate on their own); the core flash + sparks fire at birth. Removed
 *  once every ring has been emitted and its life has elapsed. */
interface PulseFx {
  x: number; y: number;
  cfg: PulseCfg;
  age: number;        // ms lived
  ringsSpawned: number; // how many rings have been emitted so far
}
```

Then find the `tendrils` array field on the controller class (it is declared near the other private FX collections — search for `private readonly tendrils` or `tendrils: Tendril[]`) and add alongside it:

```ts
  private readonly pulses: PulseFx[] = [];
```

- [ ] **Step 3: Add the `pulse()` method**

After `impactPulse` (ends ~line 813), add. It spawns the core flash + sparks immediately (fire-and-forget via the pooled `spawn`), and registers a `PulseFx` so `update` can emit the staggered rings:

```ts
  /**
   * A procedural point-blast at (x, y) — the self-buff FX (owner-tuned per tribe on buff-pulse-preview.html).
   * `ringCount` expanding rings (staggered by `ringStaggerMs`, emitted from `update`), a core flash, and
   * `sparkCount` outward sparks. Sizes are px radii → ÷ the texture radius gives the sprite scale (1:1 with the
   * rig). Every dial lives in `cfg` (a structural mirror of PulsePresetCfg) so any preset drives it.
   */
  pulse(x: number, y: number, cfg: PulseCfg): void {
    if (!this.ready || !this.glowTex || !this.pulseTex || !this.layer) return;

    // Core flash — a soft glow disc that pops and fades.
    if (cfg.coreFlashMs > 0 && cfg.coreFlashSize > 0) {
      const s = cfg.coreFlashSize / TENDRIL_GLOW_R;
      this.spawn(this.glowTex, {
        x, y, vx: 0, vy: 0, drag: 1, life: cfg.coreFlashMs,
        fromScale: s * 0.3, toScale: s, spin: 0,
        tint: hexNum(cfg.colorCore), blend: cfg.blend, peakAlpha: 1,
      });
    }

    // Sparks — radial motes decelerating outward (glowTex, small).
    if (cfg.sparkCount > 0 && cfg.sparkSpeed > 0) {
      const sparkScale = cfg.sparkSize / TENDRIL_GLOW_R;
      for (let i = 0; i < cfg.sparkCount; i++) {
        const ang = (i / cfg.sparkCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
        const speed = cfg.sparkSpeed * (0.6 + Math.random() * 0.6);
        this.spawn(this.glowTex, {
          x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, drag: TENDRIL_MOTE_DRAG,
          life: cfg.sparkLife, fromScale: sparkScale, toScale: sparkScale * 0.2, spin: 0,
          tint: hexNum(cfg.colorSpark), blend: cfg.blend, peakAlpha: 0.9,
        });
      }
    }

    // Register the blast so `update` emits the staggered rings (ring 0 fires next frame at age ~0).
    this.pulses.push({ x, y, cfg, age: 0, ringsSpawned: 0 });
  }

  /** Emit ring index `i` of a pulse — a thin expanding ring (pulseTex) from ~0 out to `ringSize`. */
  private spawnPulseRing(p: PulseFx, i: number): void {
    if (!this.pulseTex) return;
    const cfg = p.cfg;
    const toScale = (cfg.ringSize / PULSE_TEX_R) * (1 - i * 0.12); // inner rings slightly smaller → concentric
    this.spawn(this.pulseTex, {
      x: p.x, y: p.y, vx: 0, vy: 0, drag: 1,
      life: cfg.ringMs / (cfg.ringSpeed > 0 ? cfg.ringSpeed : 1),
      fromScale: 0.15, toScale, spin: 0,
      tint: hexNum(cfg.colorRing), blend: cfg.blend, peakAlpha: 0.85,
    });
  }
```

Note: `TENDRIL_MOTE_DRAG` and `TENDRIL_GLOW_R` and `PULSE_TEX_R` and `hexNum` already exist in this file (reused). `spawn` already clamps `toScale`/alpha and advances the sprite each frame.

- [ ] **Step 4: Advance the pulses in `update`**

In the `update(dtMs)` ticker, immediately AFTER the `for (… this.tendrils …)` loop (ends ~line 1866), add:

```ts
    // Pulse blasts: emit each ring as its stagger time elapses; retire once all rings emitted + last life done.
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i]!;
      p.age += dtMs;
      while (p.ringsSpawned < p.cfg.ringCount && p.age >= p.ringsSpawned * p.cfg.ringStaggerMs) {
        this.spawnPulseRing(p, p.ringsSpawned);
        p.ringsSpawned++;
      }
      const lastRingBorn = (p.cfg.ringCount - 1) * p.cfg.ringStaggerMs;
      const ringLife = p.cfg.ringMs / (p.cfg.ringSpeed > 0 ? p.cfg.ringSpeed : 1);
      if (p.ringsSpawned >= p.cfg.ringCount && p.age >= lastRingBorn + ringLife) {
        this.pulses.splice(i, 1); // the spawned ring particles finish on their own in the pool
      }
    }
```

- [ ] **Step 5: Clear pulses on teardown**

In `clearParticles()` (~line 1248, next to `this.tendrils.length = 0`) add:

```ts
    this.pulses.length = 0;
```

In `detach()` (~line 627, next to the tendrils cleanup) add:

```ts
    this.pulses.length = 0;
```

(The ring/flash/spark sprites are pooled particles cleared by the existing particle teardown; `pulses` only tracks pending ring emission, so emptying the array is the full cleanup.)

- [ ] **Step 6: Typecheck + build**

Run: `cd .claude/worktrees/buff-pulse && npm run typecheck && npm run build:web`
Expected: both green (no type errors; the web bundle builds).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/pixiFx.ts
git commit -m "feat(fx): pixiFx.pulse — procedural point-blast (rings + flash + sparks)"
```

---

## Task 5: `buffSelf` cue channel + runner wiring

**Files:**
- Modify: `packages/ui/src/choreo/score.ts` — add `'buffSelf'` to `Channel`, import `groupSelfBuffs`, add it to the `buffWave` cue array, add `onSelfBuffs` to `CueContext`, handle the cue in `runMomentCues`.
- Test: `packages/ui/src/choreo/score.test.ts` — assert a self-buff routes to `onSelfBuffs`.
- Reference: the existing `buffCast` channel wiring in the same file (lines 6, 18, 61, 133, 170-173).

- [ ] **Step 1: Extend the shared context stub, then add the tests**

The file's context helper is `baseCtx(events, overrides)` (aliased `ctx`), and the moment helper is `moment(kind, events)` (both defined at the top of `score.test.ts`, lines 7-13). First add `onBuffCasts` + `onSelfBuffs` to the `baseCtx` defaults so every `buffWave` test has them — change line 11 from:

```ts
  onAuraBurst: vi.fn(), onShieldBreak: vi.fn(), onReborn: vi.fn(), ...overrides,
```
to:
```ts
  onAuraBurst: vi.fn(), onShieldBreak: vi.fn(), onReborn: vi.fn(), onBuffCasts: vi.fn(), onSelfBuffs: vi.fn(), ...overrides,
```

Then add these two tests inside the `describe('score', …)` block:

```ts
  it('runMomentCues routes a self-buff (source === target) → onSelfBuffs', () => {
    const c = ctx([{ type: 'buff', target: 'a', source: 'a', attack: 2, health: 1 }]);
    runMomentCues(moment('buffWave', c.events), c);
    expect(c.onSelfBuffs).toHaveBeenCalledWith([{ uid: 'a', attack: 2, health: 1 }]);
  });

  it('does NOT call onSelfBuffs for a buff-other (source !== target)', () => {
    const c = ctx([{ type: 'buff', target: 'a', source: 'b', attack: 2, health: 1 }]);
    runMomentCues(moment('buffWave', c.events), c);
    expect(c.onSelfBuffs).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd .claude/worktrees/buff-pulse && npm test -- score`
Expected: FAIL — `onSelfBuffs` is not defined on `CueContext` / never called.

- [ ] **Step 3: Make the changes in `score.ts`**

3a. Import the channel (next to the `groupBuffCasts` import, line 6):

```ts
import { groupSelfBuffs } from './channels/buffSelf';
```

3b. Add `'buffSelf'` to the `Channel` union (line 18):

```ts
export type Channel = 'sfx' | 'float' | 'lunge' | 'impact' | 'auraBurst' | 'auraBreak' | 'auraReform' | 'buffCast' | 'buffSelf';
```

3c. Add the cue to `buffWave` (line 61) — alongside `buffCast`:

```ts
  summon: [...BASE], buffWave: [...BASE, { ch: 'buffCast', at: 'start', offset: 0 }, { ch: 'buffSelf', at: 'start', offset: 0 }], reborn: withReform(), ascend: [...BASE],
```

3d. Add `onSelfBuffs` to `CueContext` (after `onBuffCasts`, line 133):

```ts
  /** This moment's SELF-buffs (source === target), grouped per uid. The replay fires a pulse per unit and holds
   *  then flashes its badge to the new value (Task 6). */
  onSelfBuffs: (selfBuffs: import('./channels/buffSelf').SelfBuff[]) => void;
```

3e. Handle the cue in `runMomentCues` (after the `buffCast` handler, line 173):

```ts
    else if (cue.ch === 'buffSelf') at(cue, () => {
      const selfBuffs = groupSelfBuffs(moment, ctx.events);
      if (selfBuffs.length) ctx.onSelfBuffs(selfBuffs);
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd .claude/worktrees/buff-pulse && npm test -- score`
Expected: PASS. Any other test that constructs a `CueContext` will now fail to typecheck without `onSelfBuffs` — fix each by adding `onSelfBuffs: vi.fn()` (or a no-op) to its context literal. Run `npm run typecheck` and resolve all such spots.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/choreo/score.ts packages/ui/src/choreo/score.test.ts
git commit -m "feat(fx): buffSelf cue channel on buffWave → onSelfBuffs"
```

---

## Task 6: Fire the pulse + badge flash from the replay

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts` — add the `onSelfBuffs` handler inside the `runMomentCues({ … })` context object (right after the `onBuffCasts` handler, ~line 662), reusing the existing `statHold`/`statFlash` setters + `frameRef` + `cardIds`/`CARD_INDEX` + `findEl` + `pixiFx`.
- Reference: the `onBuffCasts` handler (lines 622-662) — copy its held-value/flash pattern; the imports for `pulsePreset`/`PULSE_PRESETS` mirror the existing `buffPreset`/`BUFF_PRESETS` imports.

- [ ] **Step 1: Add the imports**

Near the existing `import { BUFF_PRESETS } from './buffPresets'` and `import { buffPreset } from …` (find the actual lines — they import from `./buffPresets`), add:

```ts
import { PULSE_PRESETS, pulsePreset } from './pulsePresets';
```

- [ ] **Step 2: Add the `onSelfBuffs` handler**

Inside the `runMomentCues(beat, { … })` context object, immediately after the `onBuffCasts: (casts) => { … },` property (closes ~line 662), add:

```ts
      onSelfBuffs: (selfBuffs) => {
        // Fire one in-place pulse per self-buffing unit, then HOLD its pre-buff badge value and, after holdMs,
        // release the hold + flash the changed badge(s) to the new value — the blast "causes" the tick.
        const unitOf = (uid: string) =>
          frameRef.current?.player.find((u) => u.uid === uid) ?? frameRef.current?.enemy.find((u) => u.uid === uid);
        for (const s of selfBuffs) {
          const el = findEl(s.uid);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const cardId = cardIds.get(s.uid) ?? '';
          const cfg = PULSE_PRESETS[pulsePreset(cardId, (CARD_INDEX[cardId]?.tribe ?? 'neutral') as Tribe)];
          pixiFx.pulse(r.left + r.width / 2, r.top + r.height / 2, cfg);

          const tgt = unitOf(s.uid);
          if (!tgt) continue; // no frame entry → fall back to normal display (no negative held value)
          const held = { atk: tgt.attack - s.attack, hp: tgt.health - s.health };
          setStatHold((m) => new Map(m).set(s.uid, held));
          const holdMs = cfg.holdMs / (combatSpeedRef.current > 0 ? combatSpeedRef.current : 1);
          timers.push(window.setTimeout(() => {
            setStatHold((m) => { const n = new Map(m); n.delete(s.uid); return n; });
            setStatFlash((m) => new Map(m).set(s.uid, { atk: s.attack !== 0, hp: s.health !== 0 }));
            timers.push(window.setTimeout(() =>
              setStatFlash((m) => { const n = new Map(m); n.delete(s.uid); return n; }), 360));
          }, holdMs));
        }
      },
```

(This mirrors the tendril handler's held-value math: the `frame` already reflects the post-buff stats at cue time, so pre-buff = current − delta. `Tribe`, `CARD_INDEX`, `findEl`, `pixiFx`, `frameRef`, `cardIds`, `combatSpeedRef`, `setStatHold`, `setStatFlash`, `timers` are all already in scope in this effect — the same ones the tendril handler uses.)

- [ ] **Step 3: Typecheck**

Run: `cd .claude/worktrees/buff-pulse && npm run typecheck`
Expected: green. (If `Tribe` is not already imported in this file, it is — the tendril handler uses it; confirm the import exists.)

- [ ] **Step 4: Live verification on the dev server**

Run: `cd .claude/worktrees/buff-pulse && npm run dev`, open the app, and reach a combat where a unit buffs ONLY itself Start-of-Combat (e.g. a mono-board with a self-pumping unit). Confirm via the running app that: (a) a ring/flash/spark pulse fires ON that unit, (b) its badge holds the old value ~holdMs then flashes and ticks to the new value, (c) NO `+N/+N` float appears for that self-buff. Use the DOM/console verification path from the memory notes (the preview pane can't watch rAF; drive the focused tab / inspect `statHold` via `window.useGame` if needed). If any is wrong, debug with systematic-debugging before proceeding.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/useCombatReplay.ts
git commit -m "feat(fx): fire self-buff pulse + hold/flash badge from combat replay"
```

---

## Task 7: Bake owner-tuned presets (tuning loop)

**Files:**
- Modify: `packages/ui/src/pulsePresets.ts` (`PULSE_PRESETS` + `PULSE_ASSIGN`), `packages/ui/src/pulsePresets.test.ts` (still passes — shape unchanged).

This task is the collaborative tuning loop — it produces the shipped tribe looks, exactly like the tendril bake.

- [ ] **Step 1: Hand the owner the rig**

Tell the owner the rig is at `http://localhost:5173/fx/buff-pulse-preview.html` and let them tune a look (per tribe or a single default). They copy the JSON for each.

- [ ] **Step 2: Bake the JSON verbatim**

For each tuned preset, paste the JSON literal into `PULSE_PRESETS` under its name (e.g. `'beast-tribe'`), and add the tribe mapping to `PULSE_ASSIGN.byTribe` (e.g. `beast: 'beast-tribe'`). Generate the values straight from the owner's JSON — do NOT hand-transcribe numbers (avoids drift; same rule as the tendril bake). Keep `default` as a sane fallback.

- [ ] **Step 3: Re-run the preset test**

Run: `cd .claude/worktrees/buff-pulse && npm test -- pulsePresets`
Expected: PASS (every baked preset still has every field).

- [ ] **Step 4: Re-verify live** — repeat Task 6 Step 4 with the tuned looks (each tribe's self-buff fires its tuned pulse).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pulsePresets.ts
git commit -m "feat(fx): bake owner-tuned pulse presets + tribe assignments"
```

---

## Task 8: Gate, docs, PR

**Files:**
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `README.md`.

- [ ] **Step 1: Full green gate**

Run: `cd .claude/worktrees/buff-pulse && npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all four green. Report the actual results (do not claim green without seeing it).

- [ ] **Step 2: Update the docs**

- `docs/devlog.md`: prepend a dated (2026-07-11) entry — the pulse system (renderer, presets, `groupSelfBuffs`, `buffSelf` cue, float suppression, badge reuse, rig), what changed and why, and how it was verified (unit tests + live check). Newest first.
- `docs/roadmap.md`: move the pulse item out of the queue; add the follow-ups (recruit-phase hero-power/spell pulses, `shard`/`nova` styles, dedicated neutral preset) under the right section.
- `README.md`: update **Recent changes** + **Short-term roadmap** to reflect the pulse FX.

- [ ] **Step 3: Commit the docs**

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: log buff-pulse self-buff FX + update roadmap/README"
```

- [ ] **Step 4: Push + open the PR** (never push to `main`; PR + squash-merge)

```bash
git push -u origin feat/buff-pulse
"/c/Program Files/GitHub CLI/gh.exe" pr create --title "feat(fx): buff pulse — self-buff point-blast" \
  --body "Preset-driven procedural pulse (rings + flash + sparks) on combat self-buffs; replaces the +N float, holds then flashes the badge. Mirrors the tendril system. Tuning rig at /fx/buff-pulse-preview.html. Presentation-only. See docs/superpowers/specs/2026-07-11-buff-pulse-design.md."
```

- [ ] **Step 5: Verify CI is green** on the PR, then request the owner's review before squash-merge.

---

## Notes for the implementer

- **Presentation-only:** never touch `simulate()`, the event log, or any `@game/core`/`@game/content` logic. This PR only adds FX + float suppression + badge timing in `@game/ui` (+ read-only type/`CARD_INDEX` imports).
- **Performance rule (north star):** the pulse is compositor-friendly — pooled `spawn()` particles animate `transform`/`opacity` only; the `.statflash` badge class is transform/opacity only. Do NOT animate paint props (`box-shadow`/`filter`/`background`) in the badge flash. Don't read layout per frame — the handler reads each unit's rect once at cue time.
- **Isolated worktree:** all work is on `feat/buff-pulse` in `.claude/worktrees/buff-pulse`; the main checkout is on a concurrent session's branch — do not switch it.
- **Reused, do NOT recreate:** `statHold`/`statFlash` maps + `statHoldFor`/`statFlashFor` accessors, `Unit.tsx` props + memo comparator, `Card.tsx` `flashAtk`/`flashHp`, `.statflash` CSS, `hexNum`, `TENDRIL_GLOW_R`, `PULSE_TEX_R`, `TENDRIL_MOTE_DRAG`, the `spawn()` contract — all already exist.
```
