# Combat Buff-Cast Energy Tendrils — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a unit buffs *another* unit in combat, shoot an energy tendril from buffer to each target, strike it, flash a bloom, and make the target's changed stat badge(s) flash-and-tick to their new value — built as a reusable, preset-driven effect system.

**Architecture:** A generic config-driven Pixi renderer (`pixiFx.buffTendril`), a named preset registry + most-specific-wins resolver (`buffPresets.ts`), a new `buffCast` choreographer cue channel that groups `buff` events by source and fires one tendril per `source !== target` target, plus a UI-layer held-stat-value + badge flash. Preview-rig-first: the look is tuned on a standalone HTML rig before any engine code. Presentation-only — the sim event log, resolution order, and outcomes are untouched.

**Tech Stack:** TypeScript, React, Zustand, PixiJS v8 (`MeshRope`/`Graphics`/`Sprite` on the existing `pixiFx` particle layer), GSAP, Vitest. Monorepo workspaces: `@game/ui` (`packages/ui`), `apps/web`.

**Worktree:** `feat/buff-tendril` at `C:/Users/micha/Desktop/ascent-tendril` (already created off `origin/main`). All paths below are relative to that worktree root.

**Standing rules (from CLAUDE.md):**
- Presentation-only. Never touch `@game/core` / `@game/content` / `@game/sim`. No change to fight outcomes.
- Never animate paint properties in a loop (`box-shadow`/`filter`/`background`/`border-radius`). Animate `transform`/`opacity` only. The badge flash must obey this.
- Agree the FX look on the cheap preview rig BEFORE wiring the feature (owner rejected 3 full trail builds previously).
- Every commit updates `docs/devlog.md` + `docs/roadmap.md` + README summary (batched at the end here, Phase 5).
- Before any commit, verify `git branch --show-current` is `feat/buff-tendril` (the working dir is shared across sessions).
- Never push to `main`; PR → CI → squash-merge. `gh` is at `/c/Program Files/GitHub CLI/gh.exe`.

**Verification commands (run from the worktree root):**
- `npm run typecheck` · `npm run lint` · `npm test` · `npm run build:web`

---

## File structure

**Create:**
- `apps/web/public/fx/buff-tendril-preview.html` — standalone, preset-aware tuning rig (Phase 0).
- `packages/ui/src/buffPresets.ts` — preset registry (dial-bags), the `BuffPresetCfg` type, the `BUFF_ASSIGN` map, and the `buffPreset(cardId, tribe)` resolver.
- `packages/ui/src/buffPresets.test.ts` — resolver table tests.
- `packages/ui/src/choreo/channels/buffCast.ts` — groups a moment's `buff` events by source; exposes the pure grouping + the fire function.
- `packages/ui/src/choreo/channels/buffCast.test.ts` — grouping + `source !== target` predicate tests.

**Modify:**
- `packages/ui/src/pixiFx.ts` — add `buffTendril(from, to, cfg)` + its ticker-driven tendril/flash/mote state.
- `packages/ui/src/choreo/channels/float.ts` — suppress the `+N/+N` float for `source !== target` buffs.
- `packages/ui/src/choreo/channels/float.test.ts` (create if absent) — the suppression predicate.
- `packages/ui/src/choreo/score.ts` — add the `buffCast` channel + a `buffCast` cue on the `buffWave` kind + `CueContext` hooks.
- `packages/ui/src/useCombatReplay.ts` — wire the `buffCast` cue: resolve rects, fire tendrils, schedule the held-value release + badge-flash at strike.
- `packages/ui/src/Unit.tsx` — thread `statFlash` + held display value into the `CardView`.
- `packages/ui/src/Card.tsx` — add the transient flash class to the `.atk`/`.hp` badge spans.
- `packages/ui/src/styles.css` — the `@keyframes` + `.atk.statflash` / `.hp.statflash` rule (transform/opacity only).
- `docs/devlog.md`, `docs/roadmap.md`, `README.md` — Phase 5.

---

## Phase 0 — The preview rig (tune the look first)

No engine code. Deliver a standalone rig; the owner tunes it and returns a preset JSON that later phases bake.

### Task 0.1: Scaffold the preset-aware tendril preview

**Files:**
- Create: `apps/web/public/fx/buff-tendril-preview.html`

- [ ] **Step 1: Write the rig.** Model it on the shipped `apps/web/public/fx/purple-skull-preview.html` (same structure: a stage canvas, a right-hand panel of grouped sliders/colors, `localStorage` persistence wrapped in try/catch, an on-page error banner, a diagnostic line, a JSON bake box). Read that file first and mirror its conventions. This rig adds:
  - **Two draggable anchor points** on the stage — a **source** dot and a **target** dot — so the tendril's endpoints can be moved by dragging. A **"targets: 1/3/5"** control that clones the target into a fan (evenly-spread targets) to preview simultaneous multi-tendril fan-out from one source.
  - A **canvas 2D** tendril renderer mirroring the intended engine math: a quadratic-curve path from source→target with a **sine wobble** along its length, drawn as a **tapered ribbon** (sample N points along the path; width tapers base→tip; a bright core stroke + a wider soft-glow underlay). Animate a **head** travelling source→tip over `travelMs`, the ribbon drawn only up to the head; on arrival fire a **flash** (radial additive bloom at the target) + **motes** (small radial particles) and then **retract/dissolve** the ribbon over `retractMs`. A **caster pulse** (soft glow at the source) on launch.
  - **Preset management**: a preset **dropdown** (select which preset to edit), **"Duplicate as new"** (prompts for a name, deep-copies the current dials), **"Delete preset"**, and the bake box shows the **whole registry** as JSON (`{ presetName: {…dials} }`), not just the active preset. Presets persist in `localStorage` under a single key.
  - **Dial groups** (each a slider unless noted): **Path** — `curve` (0–1 bow), `wobbleAmp` (px), `wobbleFreq`, `travelMs`, `retractMs`. **Ribbon** — `baseWidth`, `tipWidth`, `coreAlpha`, `glowWidth`, `glowAlpha`. **Strike** — `flashSize`, `flashMs`, `moteCount`, `moteSpeed`, `moteLife`. **Caster** — `pulseSize`, `pulseAlpha`, `pulseMs`. **Colors** (color inputs) — `colorCore`, `colorGlow`, `colorFlash`, `colorMote`. Include a `style` field fixed to `'tendril'` (a disabled dropdown listing `tendril`/`lightning`/`beam`) so the preset shape matches the engine's `BuffPresetCfg`.
  - **Fire** button + **space** to replay + **auto-loop** toggle (re-fire every ~1.6s), same as the skull rig.

- [ ] **Step 2: Syntax-check the script.** Extract the `<script>` body and run `node --check` on it (same technique used for the skull rig). Expected: no syntax errors.

Run:
```bash
cd /c/Users/micha/Desktop/ascent-tendril
node -e "const fs=require('fs');const h=fs.readFileSync('apps/web/public/fx/buff-tendril-preview.html','utf8');const m=h.match(/<script>([\s\S]*)<\/script>/);fs.writeFileSync(process.env.TEMP+'/tendrilchk.js',m[1]);"
node --check "$TEMP/tendrilchk.js" && echo "SYNTAX OK"
```
Expected: `SYNTAX OK`.

- [ ] **Step 3: Verify branch, then commit.**

```bash
cd /c/Users/micha/Desktop/ascent-tendril
[ "$(git branch --show-current)" = "feat/buff-tendril" ] || { echo "WRONG BRANCH"; exit 1; }
git add apps/web/public/fx/buff-tendril-preview.html
git commit -m "feat(fx): preset-aware buff-tendril preview rig"
```

### Task 0.2: OWNER GATE — tune and return the preset JSON

- [ ] **Step 1:** Tell the owner to open `C:\Users\micha\Desktop\ascent-tendril\apps\web\public\fx\buff-tendril-preview.html` in real Chrome (double-click; it is standalone — do NOT rely on the built-in preview pane, which runs a degenerate viewport where rAF is unreliable). Have them drag the anchors, toggle multi-target, tune all dials, and — for iteration 1 — produce at least a **`default`** preset and a **`kennelmaster`** preset (they can be identical to start). Ask them to paste back the **full registry JSON** from the bake box.
- [ ] **Step 2:** Do not proceed to Phase 2 (the engine renderer) until the owner returns tuned JSON. Phase 1 (pure data/logic) may proceed in parallel — it does not depend on the tuned numbers.

**STOP. This is an owner checkpoint.**

---

## Phase 1 — Preset data + resolver (pure; no tuned numbers needed)

### Task 1.1: The `BuffPresetCfg` type + preset registry + resolver

**Files:**
- Create: `packages/ui/src/buffPresets.ts`
- Test: `packages/ui/src/buffPresets.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// packages/ui/src/buffPresets.test.ts
import { describe, expect, it } from 'vitest';
import { buffPreset, BUFF_PRESETS } from './buffPresets';

describe('buffPreset resolver — most-specific wins', () => {
  it('returns the per-card preset when the card is mapped', () => {
    expect(buffPreset('kennel', 'beast')).toBe('kennelmaster');
  });
  it('falls back to the per-tribe preset when only the tribe is mapped', () => {
    // no card entry for this id; tribe map is empty by default → default (proves the fall-through order)
    expect(buffPreset('someUnmappedCard', 'beast')).toBe('default');
  });
  it('falls back to default when neither card nor tribe is mapped', () => {
    expect(buffPreset('nope', 'dragon')).toBe('default');
  });
  it('every preset name the resolver can return exists in BUFF_PRESETS', () => {
    for (const name of ['default', 'kennelmaster']) expect(BUFF_PRESETS[name]).toBeDefined();
  });
  it('every preset is a complete tendril config (style + colors + numeric dials)', () => {
    for (const cfg of Object.values(BUFF_PRESETS)) {
      expect(cfg.style).toBe('tendril');
      expect(typeof cfg.colorCore).toBe('string');
      expect(typeof cfg.travelMs).toBe('number');
    }
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npx vitest run packages/ui/src/buffPresets.test.ts`
Expected: FAIL — `Cannot find module './buffPresets'`.

- [ ] **Step 3: Implement `buffPresets.ts`.** Use placeholder-but-complete numeric dials (the owner's tuned values replace them in Phase 2 Task 2.3; these keep the type + tests honest now). The `BuffPresetCfg` fields MUST match the preview rig's dial names exactly.

```ts
// packages/ui/src/buffPresets.ts
import type { Tribe } from '@game/core';

/** One buff-cast look. Every dial the renderer reads is a field here (no hardcoded constants), so a preset is
 *  a complete, self-contained config. `style` selects the renderer (only 'tendril' is built; 'lightning' /
 *  'beam' are reserved). Colors are hex strings; the renderer converts to Pixi tints. */
export interface BuffPresetCfg {
  style: 'tendril' | 'lightning' | 'beam';
  // path
  curve: number; wobbleAmp: number; wobbleFreq: number; travelMs: number; retractMs: number;
  // ribbon
  baseWidth: number; tipWidth: number; coreAlpha: number; glowWidth: number; glowAlpha: number;
  // strike
  flashSize: number; flashMs: number; moteCount: number; moteSpeed: number; moteLife: number;
  // caster
  pulseSize: number; pulseAlpha: number; pulseMs: number;
  // colors
  colorCore: string; colorGlow: string; colorFlash: string; colorMote: string;
}

/** Starter dials — replaced by the owner's tuned values (Phase 2). Complete + typed so logic/tests are honest. */
const BASE: BuffPresetCfg = {
  style: 'tendril',
  curve: 0.3, wobbleAmp: 10, wobbleFreq: 2.5, travelMs: 200, retractMs: 140,
  baseWidth: 10, tipWidth: 1.5, coreAlpha: 1, glowWidth: 22, glowAlpha: 0.5,
  flashSize: 1.6, flashMs: 200, moteCount: 12, moteSpeed: 260, moteLife: 420,
  pulseSize: 1.4, pulseAlpha: 0.5, pulseMs: 180,
  colorCore: '#eaffb0', colorGlow: '#c8e070', colorFlash: '#dfffa0', colorMote: '#c8e070',
};

export const BUFF_PRESETS: Record<string, BuffPresetCfg> = {
  default: { ...BASE },
  kennelmaster: { ...BASE },
};

/** Card-id / tribe → preset-name assignment. Most-specific wins (see `buffPreset`). */
const BUFF_ASSIGN: { byCard: Record<string, string>; byTribe: Partial<Record<Tribe, string>> } = {
  byCard: { kennel: 'kennelmaster' },
  byTribe: {},
};

/** Resolve the preset name for a buff source: per-card → per-tribe → 'default'. A name is only returned if it
 *  exists in BUFF_PRESETS (a stale mapping falls through to 'default'). */
export function buffPreset(cardId: string, tribe: Tribe): string {
  const byCard = BUFF_ASSIGN.byCard[cardId];
  if (byCard && BUFF_PRESETS[byCard]) return byCard;
  const byTribe = BUFF_ASSIGN.byTribe[tribe];
  if (byTribe && BUFF_PRESETS[byTribe]) return byTribe;
  return 'default';
}
```

- [ ] **Step 4: Run tests, verify pass.**

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npx vitest run packages/ui/src/buffPresets.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Verify branch + commit.**

```bash
cd /c/Users/micha/Desktop/ascent-tendril
[ "$(git branch --show-current)" = "feat/buff-tendril" ] || { echo "WRONG BRANCH"; exit 1; }
git add packages/ui/src/buffPresets.ts packages/ui/src/buffPresets.test.ts
git commit -m "feat(fx): buff preset registry + most-specific-wins resolver"
```

### Task 1.2: Group buffs by source + the tendril predicate (pure)

**Files:**
- Create: `packages/ui/src/choreo/channels/buffCast.ts`
- Test: `packages/ui/src/choreo/channels/buffCast.test.ts`

Context: a moment is a slice `[start, end)` of the `events` array. A buff event is `{ type: 'buff'; target; attack; health; source }`. Read `packages/ui/src/choreo/channels/float.ts` for the exact iteration idiom (`for (let i = moment.start; i < moment.end; i++)`).

- [ ] **Step 1: Write the failing test.**

```ts
// packages/ui/src/choreo/channels/buffCast.test.ts
import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { groupBuffCasts } from './buffCast';

const M = (start: number, end: number): Moment =>
  ({ start, end, primary: { type: 'buff' } as CombatEvent, stepGroups: [[start]], kind: 'buffWave' });

describe('groupBuffCasts — one entry per (source→target) with source !== target', () => {
  it('groups a tribe aura: one source, one entry per distinct target', () => {
    const events: CombatEvent[] = [
      { type: 'buff', source: 'A', target: 'x', attack: 1, health: 1 },
      { type: 'buff', source: 'A', target: 'y', attack: 1, health: 1 },
    ] as CombatEvent[];
    const casts = groupBuffCasts(M(0, 2), events);
    expect(casts).toEqual([
      { source: 'A', target: 'x', attack: 1, health: 1 },
      { source: 'A', target: 'y', attack: 1, health: 1 },
    ]);
  });
  it('excludes self-buffs (source === target)', () => {
    const events: CombatEvent[] = [
      { type: 'buff', source: 'S', target: 'S', attack: 3, health: 3 },
    ] as CombatEvent[];
    expect(groupBuffCasts(M(0, 1), events)).toEqual([]);
  });
  it('sums multiple buffs to the same (source,target) into one cast', () => {
    const events: CombatEvent[] = [
      { type: 'buff', source: 'A', target: 'x', attack: 1, health: 0 },
      { type: 'buff', source: 'A', target: 'x', attack: 0, health: 2 },
    ] as CombatEvent[];
    expect(groupBuffCasts(M(0, 2), events)).toEqual([{ source: 'A', target: 'x', attack: 1, health: 2 }]);
  });
  it('only reads events inside the moment slice', () => {
    const events: CombatEvent[] = [
      { type: 'buff', source: 'A', target: 'x', attack: 9, health: 9 },
      { type: 'buff', source: 'A', target: 'y', attack: 1, health: 1 },
    ] as CombatEvent[];
    expect(groupBuffCasts(M(1, 2), events)).toEqual([{ source: 'A', target: 'y', attack: 1, health: 1 }]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npx vitest run packages/ui/src/choreo/channels/buffCast.test.ts`
Expected: FAIL — `groupBuffCasts` not exported.

- [ ] **Step 3: Implement the pure grouping in `buffCast.ts`.**

```ts
// packages/ui/src/choreo/channels/buffCast.ts
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

/** One tendril to fire: a buffer (`source`) empowering another unit (`target`) by the summed delta this moment. */
export interface BuffCast { source: string; target: string; attack: number; health: number; }

/** Collect this moment's buff events into per-(source,target) casts, EXCLUDING self-buffs (source === target),
 *  summing repeated buffs to the same pair. Order: first appearance of each (source,target) pair. Pure. */
export function groupBuffCasts(moment: Moment, events: CombatEvent[]): BuffCast[] {
  const order: string[] = [];
  const byKey = new Map<string, BuffCast>();
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e || e.type !== 'buff') continue;
    if (e.source === e.target) continue; // self-buff: keeps its +N float, no tendril
    const key = `${e.source} ${e.target}`;
    const cur = byKey.get(key);
    if (cur) { cur.attack += e.attack; cur.health += e.health; }
    else { const c = { source: e.source, target: e.target, attack: e.attack, health: e.health }; byKey.set(key, c); order.push(key); }
  }
  return order.map((k) => byKey.get(k)!);
}
```

- [ ] **Step 4: Run tests, verify pass.**

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npx vitest run packages/ui/src/choreo/channels/buffCast.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify branch + commit.**

```bash
cd /c/Users/micha/Desktop/ascent-tendril
[ "$(git branch --show-current)" = "feat/buff-tendril" ] || { echo "WRONG BRANCH"; exit 1; }
git add packages/ui/src/choreo/channels/buffCast.ts packages/ui/src/choreo/channels/buffCast.test.ts
git commit -m "feat(fx): pure group-buffs-by-source (excludes self-buffs)"
```

### Task 1.3: Suppress the `+N/+N` float for buff-others

**Files:**
- Modify: `packages/ui/src/choreo/channels/float.ts`
- Test: `packages/ui/src/choreo/channels/float.test.ts` (create if absent)

Context: `spawnFloats` sums `buff` events per target into a `+A/+H` float. We must drop the float ONLY for buffs where `source !== target`; self-buffs still float. Read `float.ts` — the buff summing is `buffByTarget`.

- [ ] **Step 1: Write the failing test** (create the file if it does not exist; if it exists, add this `describe`).

```ts
// packages/ui/src/choreo/channels/float.test.ts
import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { spawnFloats } from './float';

const M = (start: number, end: number): Moment =>
  ({ start, end, primary: { type: 'buff' } as CombatEvent, stepGroups: [[start]], kind: 'buffWave' });
const noEl = () => null;

describe('spawnFloats — buff float suppression', () => {
  it('does NOT emit a +N float for a buff-other (source !== target)', () => {
    const events = [{ type: 'buff', source: 'A', target: 'x', attack: 1, health: 1 }] as CombatEvent[];
    const { floats } = spawnFloats(M(0, 1), events, noEl, null);
    expect(floats.filter((f) => f.kind === 'buff')).toEqual([]);
  });
  it('STILL emits a +N float for a self-buff (source === target)', () => {
    const events = [{ type: 'buff', source: 'S', target: 'S', attack: 3, health: 3 }] as CombatEvent[];
    const { floats } = spawnFloats(M(0, 1), events, noEl, null);
    expect(floats.filter((f) => f.kind === 'buff')).toHaveLength(1);
    expect(floats.find((f) => f.kind === 'buff')?.text).toBe('+3/+3');
  });
});
```

- [ ] **Step 2: Run it, verify it fails.**

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npx vitest run packages/ui/src/choreo/channels/float.test.ts`
Expected: FAIL — the first test fails (a `+1/+1` float is currently emitted for the buff-other).

- [ ] **Step 3: Edit `float.ts` — skip buff-other in the buff sum.** In the buff-collecting loop, change the guard so a buff with `source !== target` is not accumulated (only self-buffs sum into `buffByTarget`). Find the branch:

```ts
    if (e?.type === 'buff') {
      const cur = buffByTarget.get(e.target) ?? { a: 0, h: 0, id: i };
      cur.a += e.attack;
      cur.h += e.health;
      buffByTarget.set(e.target, cur);
      continue;
    }
```

Replace its first line with a source-check so buff-others are skipped entirely (they get a tendril instead):

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

- [ ] **Step 4: Run tests, verify pass.**

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npx vitest run packages/ui/src/choreo/channels/float.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite** to confirm no golden/replay test asserted the old buff-other float.

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npm test`
Expected: all green. If a test asserted a buff-other `+N` float, update it to reflect the new tendril behavior (the float is intentionally gone).

- [ ] **Step 6: Verify branch + commit.**

```bash
cd /c/Users/micha/Desktop/ascent-tendril
[ "$(git branch --show-current)" = "feat/buff-tendril" ] || { echo "WRONG BRANCH"; exit 1; }
git add packages/ui/src/choreo/channels/float.ts packages/ui/src/choreo/channels/float.test.ts
git commit -m "feat(fx): suppress the +N buff float for buff-others (tendril replaces it)"
```

---

## Phase 2 — The Pixi tendril renderer (bake the tuned look)

Requires the owner's tuned JSON from Task 0.2.

### Task 2.1: `pixiFx.buffTendril(from, to, cfg)` — the renderer

**Files:**
- Modify: `packages/ui/src/pixiFx.ts`

Context: read `pixiFx.ts` around the Echo `deathrattle`/`burstSkull` methods and the `update` ticker for the established patterns — the pooled-particle `spawn(tex, {...})` contract, `glowTex`, the `SkullPop`-style per-effect state array advanced in `update`, `clearParticles`, and `destroy`. The tendril reuses `glowTex` for the flash/motes/caster-pulse and adds a ribbon primitive.

- [ ] **Step 1: Add the tendril config type + state.** Near the Echo `DR_*` block, add an interface mirroring `BuffPresetCfg`'s renderer-relevant fields (import is avoided to keep `pixiFx` UI-framework-agnostic; accept a structural type):

```ts
/** Renderer-facing tendril config (structural match of BuffPresetCfg — pixiFx stays import-light). */
export interface TendrilCfg {
  curve: number; wobbleAmp: number; wobbleFreq: number; travelMs: number; retractMs: number;
  baseWidth: number; tipWidth: number; coreAlpha: number; glowWidth: number; glowAlpha: number;
  flashSize: number; flashMs: number; moteCount: number; moteSpeed: number; moteLife: number;
  pulseSize: number; pulseAlpha: number; pulseMs: number;
  colorCore: string; colorGlow: string; colorFlash: string; colorMote: string;
}
interface Tendril {
  rope: MeshRope | null; ribbon: Sprite | null; // whichever primitive Task 2.1 Step 2 lands on
  pts: { x: number; y: number }[]; from: { x: number; y: number }; to: { x: number; y: number };
  cfg: TendrilCfg; age: number; struck: boolean;
}
```
Add `private readonly tendrils: Tendril[] = [];` beside `skullPops`. Add a hex→number helper if one isn't already present (`0xRRGGBB` from `#RRGGBB`).

- [ ] **Step 2: Implement `buffTendril`.** Port the preview rig's proven path + draw math (the owner tuned it there, so match it). Sample `N≈24` points along the quadratic curve from `from`→`to` with a control point offset perpendicular by `curve`, plus a sine wobble (`wobbleAmp`,`wobbleFreq`) that eases to 0 at both ends. Render the ribbon along those points. **Primitive choice (confirm on the preview which reads best, then commit to one):** a Pixi v8 `MeshRope` textured with a soft 1×N gradient strip (tapered via per-vertex width) is the faithful ribbon; if that proves fiddly, fall back to a `Graphics` polygon rebuilt per frame (acceptable — one Graphics, not a per-frame paint-property animation). The **head** advances `0→1` over `travelMs` (ease-out); draw the ribbon only up to the head. Fire the **caster pulse** immediately (`spawn(glowTex, { at from, tint colorGlow, life pulseMs, scale pulseSize, blend 'add', peakAlpha pulseAlpha })`).

```ts
buffTendril(from: { x: number; y: number }, to: { x: number; y: number }, cfg: TendrilCfg): void {
  if (!this.ready || !this.glowTex || !this.layer) return;
  // caster pulse (reuse glowTex like the Echo flash)
  this.spawn(this.glowTex, { x: from.x, y: from.y, vx: 0, vy: 0, drag: 1, life: cfg.pulseMs,
    fromScale: 0.004 * 60 * cfg.pulseSize, toScale: 0.010 * 60 * cfg.pulseSize, spin: 0,
    tint: hexNum(cfg.colorGlow), blend: 'add', peakAlpha: cfg.pulseAlpha });
  // build the path points (curve + eased wobble), create the ribbon primitive, push a Tendril record
  // …(port from the preview rig; see Step 1's Tendril shape)…
}
```
Leave the exact ribbon construction to match the preview; the acceptance test is visual (Task 2.4).

- [ ] **Step 3: Advance tendrils in `update`.** In the ticker loop (beside the `skullPops` advance), for each tendril: `age += dtMs`; while travelling, recompute the head fraction and redraw the ribbon up to the head; **on crossing `travelMs`** (once, guard with `struck`), fire the **flash** (`spawn(glowTex, at to, tint colorFlash, life flashMs, scale flashSize, blend 'add')`) + **motes** (`moteCount` radial `glowTex`, `blend 'add'`, `tint colorMote`, speed `moteSpeed`, life `moteLife`, shrink to 0); after `travelMs + retractMs`, dissolve/destroy the ribbon primitive, recycle, and splice out. Match the Echo `perFrameDrag`/`DR_GLOW_K` conventions if the preview used per-frame drag or the 128-vs-80 glow-size basis (reconcile so tuned numbers transfer 1:1).

- [ ] **Step 4: Cleanup.** In `clearParticles()`, destroy/remove any live tendril ribbons and clear `tendrils` (mirror the `skullPops` handling). In `destroy()`, destroy tendril primitives too.

- [ ] **Step 5: Typecheck.**

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npm run typecheck`
Expected: no errors. (Import `MeshRope` from `pixi.js` if used.)

- [ ] **Step 6: Verify branch + commit.**

```bash
cd /c/Users/micha/Desktop/ascent-tendril
[ "$(git branch --show-current)" = "feat/buff-tendril" ] || { echo "WRONG BRANCH"; exit 1; }
git add packages/ui/src/pixiFx.ts
git commit -m "feat(fx): pixiFx.buffTendril — curved tapered energy tendril + strike flash + motes"
```

### Task 2.2: Bake the owner's tuned preset values

**Files:**
- Modify: `packages/ui/src/buffPresets.ts`

- [ ] **Step 1:** Replace the `BASE`/`BUFF_PRESETS` starter dials with the exact numbers from the owner's Task 0.2 JSON (per preset: `default`, `kennelmaster`). Keep the `BuffPresetCfg` shape. If the owner's rig used a per-frame drag basis for motes, note the conversion in a comment (as the Echo `perFrameDrag` did).
- [ ] **Step 2: Run the resolver tests** (unchanged behavior).

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npx vitest run packages/ui/src/buffPresets.test.ts`
Expected: PASS.

- [ ] **Step 3: Verify branch + commit.**

```bash
cd /c/Users/micha/Desktop/ascent-tendril
[ "$(git branch --show-current)" = "feat/buff-tendril" ] || { echo "WRONG BRANCH"; exit 1; }
git add packages/ui/src/buffPresets.ts
git commit -m "feat(fx): bake owner-tuned tendril preset values"
```

---

## Phase 3 — Wire the `buffCast` cue channel

### Task 3.1: Add the `buffCast` channel to the Score + a cue on `buffWave`

**Files:**
- Modify: `packages/ui/src/choreo/score.ts`

- [ ] **Step 1: Extend the `Channel` union** — add `'buffCast'`:

```ts
export type Channel = 'sfx' | 'float' | 'lunge' | 'impact' | 'auraBurst' | 'auraBreak' | 'auraReform' | 'buffCast';
```

- [ ] **Step 2: Add a `buffCast` cue to the `buffWave` kind.** In `SCORE_DEFAULTS`, give `buffWave` its own array including the base cues plus `buffCast` at `start`:

```ts
  buffWave: [...BASE, { ch: 'buffCast', at: 'start', offset: 0 }],
```
(Leave the other kinds referencing `[...BASE]`.)

- [ ] **Step 3: Add the `CueContext` hook.** Add to the `CueContext` interface:

```ts
  /** This moment's buff-OTHER casts (source !== target), grouped per (source,target). The replay fires a
   *  tendril per cast + schedules the held-value release / badge flash at the strike. */
  onBuffCasts: (casts: import('./channels/buffCast').BuffCast[]) => void;
```

- [ ] **Step 4: Handle the channel in `runMomentCues`.** Add a branch (import `groupBuffCasts`):

```ts
    else if (cue.ch === 'buffCast') at(cue, () => {
      const casts = groupBuffCasts(moment, ctx.events);
      if (casts.length) ctx.onBuffCasts(casts);
    });
```
Add the import at the top: `import { groupBuffCasts } from './channels/buffCast';`

- [ ] **Step 5: Typecheck** (this will error until Task 3.2 provides `onBuffCasts` at the call site — that's expected; proceed to 3.2 before running the suite).

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npm run typecheck`
Expected: an error at the `runMomentCues` call site in `useCombatReplay.ts` (missing `onBuffCasts`). Fixed in Task 3.2.

- [ ] **Step 6: Commit** (compiles after 3.2; commit together with 3.2 instead — skip a standalone commit here).

### Task 3.2: Fire tendrils from the replay

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts`

Context: find the `runMomentCues(...)` call and the `ctx`/context object passed to it (the `onFloats`, `onAuraBurst`, … handlers). Rects are resolved via the existing `findEl(uid)` → `getBoundingClientRect()`. Import `pixiFx`, `buffPreset`, `BUFF_PRESETS`, and the minion lookup used elsewhere in the file to get a source's `cardId`/`tribe`.

- [ ] **Step 1: Add the `onBuffCasts` handler** to the context object passed into `runMomentCues`. For each cast, resolve source + target rects (centers), look up the source minion's `cardId` + `tribe` (use the same per-beat frame/minion map the file already builds), pick the preset, and fire the tendril:

```ts
onBuffCasts: (casts) => {
  for (const c of casts) {
    const sEl = findEl(c.source); const tEl = findEl(c.target);
    if (!sEl || !tEl) continue;
    const sr = sEl.getBoundingClientRect(); const tr = tEl.getBoundingClientRect();
    const src = minionOf(c.source); // the file's existing uid→frame-minion lookup
    const preset = BUFF_PRESETS[buffPreset(src?.cardId ?? '', (src?.tribe ?? 'neutral') as Tribe)];
    pixiFx.buffTendril(
      { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 },
      { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 },
      preset,
    );
    // Task 4 adds: schedule held-value release + badge flash at (preset.travelMs / combatSpeed).
  }
},
```
Adjust `minionOf` to whatever the file actually calls its uid→minion accessor; if none exists, derive `cardId`/`tribe` from the current `frame` minions array by `uid`.

- [ ] **Step 2: Typecheck.**

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Full suite + lint.**

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npm run lint && npm test`
Expected: all green.

- [ ] **Step 4: Verify branch + commit (3.1 + 3.2 together).**

```bash
cd /c/Users/micha/Desktop/ascent-tendril
[ "$(git branch --show-current)" = "feat/buff-tendril" ] || { echo "WRONG BRANCH"; exit 1; }
git add packages/ui/src/choreo/score.ts packages/ui/src/useCombatReplay.ts
git commit -m "feat(fx): buffCast cue channel — fire a tendril per buff-other target"
```

---

## Phase 4 — Held stat value + badge flash

The number must change ON the strike, not at moment start. We hold the target's DISPLAYED Attack/Health at its pre-buff value until `travelMs` after launch, then release + flash the changed badge(s).

### Task 4.1: The badge flash class (Card + CSS)

**Files:**
- Modify: `packages/ui/src/Card.tsx`, `packages/ui/src/styles.css`

Context: `Card.tsx` renders the badges as `<span className={`atk${statCls(...)}`}>{card.attack}</span>` and the `hp` equivalent (~lines 373-374). `CardView` needs two optional flags.

- [ ] **Step 1: Add `statFlash` to `CardView`.** In `Card.tsx`'s `CardView` type add:

```ts
  /** Transient per-stat flash (a buff just landed on this unit this frame). */
  flashAtk?: boolean;
  flashHp?: boolean;
```

- [ ] **Step 2: Apply the class** to the badge spans:

```tsx
<span className={`atk${statCls(card.attack, card.baseAttack, card.floorAttack)}${card.flashAtk ? ' statflash' : ''}`}>{card.attack}</span>
<span className={`hp${statCls(card.health, card.baseHealth, card.floorHealth)}${card.flashHp ? ' statflash' : ''}`}>{card.health}</span>
```

- [ ] **Step 3: Add the CSS** (compositor-only — `transform`/`opacity`, NO paint properties in the loop, per CLAUDE.md). Append to `styles.css` near the other stat-badge rules:

```css
/* A buff just landed here → the changed stat badge pops once (transform/opacity only — no paint props). */
.card .atk.statflash, .card .hp.statflash { animation: statflash 0.34s ease-out; }
@keyframes statflash {
  0%   { transform: scale(1); opacity: 1; }
  30%  { transform: scale(1.5); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
```

- [ ] **Step 4: Typecheck.**

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npm run typecheck`
Expected: no errors (the new `CardView` fields are optional; `Unit.tsx` sets them in Task 4.2).

- [ ] **Step 5: Verify branch + commit.**

```bash
cd /c/Users/micha/Desktop/ascent-tendril
[ "$(git branch --show-current)" = "feat/buff-tendril" ] || { echo "WRONG BRANCH"; exit 1; }
git add packages/ui/src/Card.tsx packages/ui/src/styles.css
git commit -m "feat(fx): per-stat badge flash class (compositor-only)"
```

### Task 4.2: Held displayed value + flash trigger

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts`, `packages/ui/src/Unit.tsx`

Approach: keep a replay-state map `statHold: Map<uid, { atk: number; hp: number }>` of PRE-buff display values, and a `statFlash: Map<uid, { atk: boolean; hp: boolean }>`. When a tendril launches (Task 3.2), snapshot the target's current displayed `attack`/`health` into `statHold` and, at `travelMs / combatSpeed` later, delete the hold entry (releasing the real value) and set the flash flags (clear them ~350ms after). `Unit.tsx` reads these: displayed attack = `statHold.get(uid)?.atk ?? u.attack`; `flashAtk = statFlash.get(uid)?.atk`.

- [ ] **Step 1: Add the two maps to replay state.** Near the other `useState`/refs in `useCombatReplay.ts`:

```ts
const [statHold, setStatHold] = useState<Map<string, { atk: number; hp: number }>>(new Map());
const [statFlash, setStatFlash] = useState<Map<string, { atk: boolean; hp: boolean }>>(new Map());
```

- [ ] **Step 2: In `onBuffCasts` (Task 3.2), snapshot + schedule.** Before firing the tendril, capture the target's current displayed stats (from the current `frame` minion by uid) into `statHold`. After `preset.travelMs / combatSpeed` ms (push the timer onto the same `timers` array the cue effect already cleans up), release the hold and raise the flash for the changed stats:

```ts
const tgt = minionOf(c.target);
const held = { atk: tgt?.attack ?? 0, hp: tgt?.health ?? 0 };
setStatHold((m) => new Map(m).set(c.target, held));
const strikeMs = preset.travelMs / (combatSpeedRef.current > 0 ? combatSpeedRef.current : 1);
timers.push(window.setTimeout(() => {
  setStatHold((m) => { const n = new Map(m); n.delete(c.target); return n; });
  setStatFlash((m) => new Map(m).set(c.target, { atk: c.attack !== 0, hp: c.health !== 0 }));
  timers.push(window.setTimeout(() => setStatFlash((m) => { const n = new Map(m); n.delete(c.target); return n; }), 360));
}, strikeMs));
```
Use the file's existing `combatSpeedRef` (the Echo aftermath used it). Ensure `statHold`/`statFlash` are cleared on replay reset/skip (find where `floats`/`triggers` are reset and clear these there too).

- [ ] **Step 3: Return the maps** from the hook and thread them to `Unit`. Add `statHold`, `statFlash` to the hook's return object and to the props the combat board passes to each `Unit` (follow how `floatsFor`/`triggerUids` are threaded).

- [ ] **Step 4: Apply in `Unit.tsx`.** When building the `CardView`, override the displayed stats with the hold and set the flash flags:

```ts
const hold = statHold?.get(u.uid);
const flash = statFlash?.get(u.uid);
// in the CardView literal:
attack: hold?.atk ?? u.attack,
health: hold ? hold.hp : Math.max(0, u.health),
flashAtk: flash?.atk,
flashHp: flash?.hp,
```
Add `statHold`/`statFlash` to `Unit`'s props and to its `React.memo` comparator (compare the two entries for this uid so a held/flashing unit re-renders; e.g. compare `a.statHold?.get(a.u.uid)` vs `b...`).

- [ ] **Step 5: Typecheck + lint + full suite.**

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npm run typecheck && npm run lint && npm test`
Expected: all green.

- [ ] **Step 6: Verify branch + commit.**

```bash
cd /c/Users/micha/Desktop/ascent-tendril
[ "$(git branch --show-current)" = "feat/buff-tendril" ] || { echo "WRONG BRANCH"; exit 1; }
git add packages/ui/src/useCombatReplay.ts packages/ui/src/Unit.tsx
git commit -m "feat(fx): hold the target's stat until the tendril strikes, then flash + tick"
```

---

## Phase 5 — Gate, live verify, docs, PR

### Task 5.1: OWNER GATE — live feel pass

- [ ] **Step 1: Build + start the dev server** (let Vite pick the port; read it from the output — do NOT pass `--port` through `npm run dev`, npm eats it):

```bash
cd /c/Users/micha/Desktop/ascent-tendril && npm run build:web   # prove prod build is clean
cd /c/Users/micha/Desktop/ascent-tendril && npm run dev          # run in background; read the localhost:PORT it prints
```

- [ ] **Step 2:** Confirm the server serves the app (curl `/` → 200 and `/src/main.tsx` → 200), then give the owner the exact `localhost:PORT`. Ask them to force a Beast board with **Kennelmaster** and enter a fight. They should see, at Start-of-Combat: the caster pulse on Kennelmaster, a tendril to each Beast simultaneously, a strike flash + motes on each, and each target's Attack **and** Health badge **hold, then flash and tick +1/+1 on the strike** (only the changed stats). Confirm no console errors and that self-buffs (if any on the board) still show their `+N` float.
- [ ] **Step 3:** Iterate on any feedback: tendril feel → re-tune on the rig → re-bake `buffPresets.ts` (Task 2.2); timing of the hold/flash → adjust `strikeMs`/the 360ms flash window (Task 4.2). Re-verify.

**STOP. Owner confirms the look before docs + PR.**

### Task 5.2: Docs

**Files:**
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `README.md`

- [ ] **Step 1:** Prepend a dated `docs/devlog.md` entry (newest first): what changed (the preset-driven buff-cast tendril system, the `buffCast` channel, float suppression for buff-others, the held-value + badge flash), why, the preset/resolver architecture (how to add a look for a new unit: duplicate a preset in the rig, tweak, assign in `BUFF_ASSIGN`, bake), the Kennelmaster test, and verification (typecheck/lint/tests/build + live). Note the deferred items (lightning/beam styles, staggered fan-out, self-buff redesign).
- [ ] **Step 2:** In `docs/roadmap.md`, move the buff-tendril work out of the queue into done/devlog, and add the follow-ups: build the `lightning` + `beam` styles on the ready seam; consider per-tribe preset assignments; extend the effect to more buff sources (Pack Leader, Growth casts).
- [ ] **Step 3:** Update the README **Recent changes** + **Short-term roadmap** summaries.
- [ ] **Step 4: Verify branch + commit.**

```bash
cd /c/Users/micha/Desktop/ascent-tendril
[ "$(git branch --show-current)" = "feat/buff-tendril" ] || { echo "WRONG BRANCH"; exit 1; }
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: buff-cast tendril FX (devlog + roadmap + README)"
```

### Task 5.3: Rebase, PR, CI, merge

- [ ] **Step 1: Final full verification.**

Run: `cd /c/Users/micha/Desktop/ascent-tendril && npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green.

- [ ] **Step 2: Sync with main** (it may have advanced). Fetch, merge `origin/main`, resolve any `docs/devlog.md` conflict by keeping both entries (newest first), reinstall if deps changed, and re-run the full suite.

```bash
cd /c/Users/micha/Desktop/ascent-tendril
git fetch origin --quiet
git merge origin/main --no-edit   # resolve docs/devlog.md conflict if any; keep both entries
npm install
npm run typecheck && npm run lint && npm test && npm run build:web
```

- [ ] **Step 3: Push + open the PR.**

```bash
cd /c/Users/micha/Desktop/ascent-tendril
[ "$(git branch --show-current)" = "feat/buff-tendril" ] || { echo "WRONG BRANCH"; exit 1; }
git push -u origin feat/buff-tendril
"/c/Program Files/GitHub CLI/gh.exe" pr create --base main --head feat/buff-tendril \
  --title "feat(fx): combat buff-cast energy tendrils (preset-driven)" \
  --body "Preset-driven buff-cast FX: a tendril shoots from a buffer to each buffed ally, strikes, flashes, and the target's changed stat badge(s) flash + tick to the new value. Tuned on a standalone preset-aware rig. Presentation-only. Spec: docs/superpowers/specs/2026-07-10-buff-tendril-design.md. 🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Watch CI, then squash-merge.**

```bash
cd /c/Users/micha/Desktop/ascent-tendril
"/c/Program Files/GitHub CLI/gh.exe" pr checks --watch --interval 20
"/c/Program Files/GitHub CLI/gh.exe" pr merge --squash --delete-branch
```
Expected: `verify` check passes, then a clean squash-merge.

- [ ] **Step 5: Verify main is healthy** (the feature's files present, no duplicated commits) and tear down the worktree + dev server.

---

## Self-review notes

- **Spec coverage:** renderer/dials separation (T2.1), presets + resolver (T1.1), `buffCast` channel (T3.1–3.2), one-tendril-per-target simultaneous (T3.2 loop), float suppression for buff-others + self-buffs keep float (T1.3), stat-badge flash + held value (T4.1–4.2), preset-aware editor (T0.1), Kennelmaster test (T5.1), preview-first (Phase 0 gate), outcome-neutrality (no core/content/sim touched), deferred styles ready on the `style` field (T1.1/T2.1). All covered.
- **Placeholder scan:** starter dials in T1.1 are intentional, complete, and typed; the owner's tuned values bake in T2.2. The ribbon primitive choice (MeshRope vs Graphics) is explicitly decided on the preview in T2.1 — not a code placeholder.
- **Type consistency:** `BuffPresetCfg` (T1.1) ⊇ `TendrilCfg` (T2.1) field names match the preview dials (T0.1); `BuffCast` (T1.2) is consumed unchanged by `onBuffCasts` (T3.1/T3.2); `flashAtk`/`flashHp`/held-stat flow Card←Unit←replay is consistent across T4.1/T4.2.
- **Assumption to confirm at execution:** `useCombatReplay.ts`'s exact uid→minion accessor (`minionOf`) and `combatSpeedRef` names — Task 3.2/4.2 say to match the file's real identifiers.
