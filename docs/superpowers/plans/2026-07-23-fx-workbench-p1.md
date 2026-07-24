# FX Workbench P1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation of the FX workbench — a primitive contract whose parameters describe themselves, a runtime player, the ribbon primitive, and a dev-only shell that can stage, loop and scrub it against the real board.

**Architecture:** An effect is data (`FxDef`) played by a runtime player over primitives registered in a registry. Each primitive declares its parameters **once** as an `FxParamSpec` record; the params TypeScript type and the editor UI are both *derived* from that record, so the two can never drift. The player mounts into the existing `pixiFx` overlay canvas via a small new public seam, so effects render through the real pipeline rather than a parallel one.

**Tech Stack:** TypeScript, React 18, PixiJS 8 (WebGL2 / GLSL ES 3.0), Vitest (node environment), Vite.

**Spec:** [`docs/superpowers/specs/2026-07-23-fx-workbench-design.md`](../specs/2026-07-23-fx-workbench-design.md)

---

## Deviations from the spec (deliberate — read before starting)

1. **No zod.** `packages/ui` does not depend on zod, and adding it would put a validator in the production bundle for a dev-only benefit. Parameters are declared in one plain-TS `FxParamSpec` record from which both the params type (`ParamsOf<S>`) and the inspector UI are derived. This is *stronger* single-sourcing than "zod schema + UI hints", which is still two lists.
2. **"Ships the trail effect for real" means the ribbon primitive renders through the real overlay canvas in the real app**, tunable in the workbench. It does **not** mean replacing the existing `pixiFx.trail` wisps. That swap is a visual change to shipped FX and belongs in its own PR after the owner has tuned the look.

## File structure

| File | Responsibility |
|---|---|
| `packages/ui/src/fx/params.ts` | `FxParamSpec` union, `ParamsOf<S>`, `defaultsOf`, `coerceParams`. Pure. |
| `packages/ui/src/fx/params.test.ts` | Tests for the above. |
| `packages/ui/src/fx/primitive.ts` | `FxPrimitive`, `FxInstance`, `FxContext` contracts. Types only. |
| `packages/ui/src/fx/registry.ts` | `registerPrimitive` / `getPrimitive` / `listPrimitives`. |
| `packages/ui/src/fx/registry.test.ts` | Tests for the registry. |
| `packages/ui/src/fx/def.ts` | `FxDef`, `FxLayer`, and the pure `layersActiveAt` scheduler. |
| `packages/ui/src/fx/def.test.ts` | Tests for scheduling. |
| `packages/ui/src/fx/player.ts` | `createPlayer(def, ctx)` → play/stop/scrub/setSpeed/update. |
| `packages/ui/src/fx/player.test.ts` | Tests with a stub primitive — no WebGL needed. |
| `packages/ui/src/fx/ribbonGeometry.ts` | Pure arc-length resample + extrude producing ribbon vertex positions. |
| `packages/ui/src/fx/ribbonGeometry.test.ts` | Tests for the geometry math. |
| `packages/ui/src/fx/primitives/ribbon.ts` | The ribbon primitive: GLSL, param specs, `spawn`. |
| `packages/ui/src/fx/anchors.ts` | `FxAnchors` + resolution to screen space. |
| `packages/ui/src/fx/scenarios.ts` | `twoUnits` and `cursor` scenarios. |
| `packages/ui/src/fx/ui/Workbench.tsx` | The dev-only shell: stage, transport, inspector. |
| `packages/ui/src/fx/ui/Inspector.tsx` | Controls generated from `FxParamSpec`. |
| `packages/ui/src/pixiFx.ts` | **Modify:** add `mountLayer` + `addUpdater` public seam. |
| `packages/ui/src/Game.tsx` | **Modify:** mount `<FxWorkbench />` behind `import.meta.env.DEV`. |
| `packages/ui/src/DevMenu.tsx` | **Modify:** add the launcher entry. |
| `packages/ui/src/styles.css` | **Modify:** append the `.fxwb` shell styles. |

Tests run in the **node** environment (`vitest.config.ts` sets no jsdom), so nothing in a `.test.ts` may touch WebGL, `document`, or PixiJS rendering. Every test below is pure logic or uses a stub. Rendering is verified in the browser at Task 9.

---

### Task 1: Parameter specs — one declaration, two derivations

**Files:**
- Create: `packages/ui/src/fx/params.ts`
- Test: `packages/ui/src/fx/params.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/fx/params.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { coerceParams, defaultsOf, type FxParamSpecs } from './params';

const SPECS = {
  width: { kind: 'slider', label: 'Width', min: 1, max: 100, step: 1, default: 40 },
  loop: { kind: 'toggle', label: 'Loop', default: true },
  palette: { kind: 'enum', label: 'Palette', options: ['violet', 'ember'], default: 'violet' },
} satisfies FxParamSpecs;

describe('defaultsOf', () => {
  it('lifts every default into a params object', () => {
    expect(defaultsOf(SPECS)).toEqual({ width: 40, loop: true, palette: 'violet' });
  });

  it('returns a fresh object each call so callers cannot share state', () => {
    expect(defaultsOf(SPECS)).not.toBe(defaultsOf(SPECS));
  });
});

describe('coerceParams', () => {
  it('fills missing keys from defaults', () => {
    expect(coerceParams(SPECS, { width: 12 })).toEqual({ width: 12, loop: true, palette: 'violet' });
  });

  it('clamps a slider to its declared range', () => {
    expect(coerceParams(SPECS, { width: 1000 }).width).toBe(100);
    expect(coerceParams(SPECS, { width: -5 }).width).toBe(1);
  });

  it('falls back to the default when a value has the wrong type', () => {
    expect(coerceParams(SPECS, { width: 'wide' }).width).toBe(40);
    expect(coerceParams(SPECS, { loop: 'yes' }).loop).toBe(true);
  });

  it('rejects an enum value that is not in options', () => {
    expect(coerceParams(SPECS, { palette: 'chartreuse' }).palette).toBe('violet');
  });

  it('ignores unknown keys rather than passing them through', () => {
    expect(coerceParams(SPECS, { nope: 1 })).toEqual({ width: 40, loop: true, palette: 'violet' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/ui/src/fx/params.test.ts`
Expected: FAIL — `Failed to resolve import "./params"`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/fx/params.ts`:

```ts
/**
 * A primitive's parameters are declared ONCE, here. The params type and the editor UI are both derived
 * from the same record, so it is impossible to add a parameter without a label, or to label a parameter
 * that does not exist — the failure mode that left two Trail tuner sliders blank for months.
 */
export type FxParamSpec =
  | { kind: 'slider'; label: string; group?: string; help?: string; min: number; max: number; step: number; default: number }
  | { kind: 'toggle'; label: string; group?: string; help?: string; default: boolean }
  | { kind: 'color'; label: string; group?: string; help?: string; default: number }
  | { kind: 'enum'; label: string; group?: string; help?: string; options: readonly string[]; default: string };

export type FxParamSpecs = Record<string, FxParamSpec>;

/** The params object a spec record describes. Derived — never hand-written alongside the specs. */
export type ParamsOf<S extends FxParamSpecs> = { [K in keyof S]: S[K]['default'] };

export function defaultsOf<S extends FxParamSpecs>(specs: S): ParamsOf<S> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(specs)) out[key] = specs[key].default;
  return out as ParamsOf<S>;
}

/** Merge caller-supplied values over the defaults, dropping anything invalid. Never throws: a bad value in
 *  a saved def must degrade to the default rather than break the effect. */
export function coerceParams<S extends FxParamSpecs>(specs: S, raw: unknown): ParamsOf<S> {
  const out = defaultsOf(specs) as Record<string, unknown>;
  if (raw === null || typeof raw !== 'object') return out as ParamsOf<S>;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(specs)) {
    if (!(key in src)) continue;
    const spec = specs[key];
    const v = src[key];
    switch (spec.kind) {
      case 'slider':
      case 'color':
        if (typeof v === 'number' && Number.isFinite(v)) {
          out[key] = spec.kind === 'slider' ? Math.min(spec.max, Math.max(spec.min, v)) : v;
        }
        break;
      case 'toggle':
        if (typeof v === 'boolean') out[key] = v;
        break;
      case 'enum':
        if (typeof v === 'string' && spec.options.includes(v)) out[key] = v;
        break;
    }
  }
  return out as ParamsOf<S>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/ui/src/fx/params.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/params.ts packages/ui/src/fx/params.test.ts
git commit -m "feat(fx): parameter specs that derive both the params type and the UI"
```

---

### Task 2: Primitive contract and registry

**Files:**
- Create: `packages/ui/src/fx/primitive.ts`, `packages/ui/src/fx/registry.ts`
- Test: `packages/ui/src/fx/registry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/fx/registry.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { clearPrimitives, getPrimitive, listPrimitives, registerPrimitive } from './registry';
import type { FxPrimitive } from './primitive';

const stub = (id: string): FxPrimitive => ({
  id,
  params: { size: { kind: 'slider', label: 'Size', min: 0, max: 10, step: 1, default: 5 } },
  spawn: () => ({ update: () => {}, setParams: () => {}, destroy: () => {} }),
});

describe('primitive registry', () => {
  beforeEach(() => clearPrimitives());

  it('returns a registered primitive by id', () => {
    const p = stub('ribbon');
    registerPrimitive(p);
    expect(getPrimitive('ribbon')).toBe(p);
  });

  it('returns undefined for an unknown id rather than throwing', () => {
    expect(getPrimitive('nope')).toBeUndefined();
  });

  it('throws on a duplicate id so a copy-pasted primitive is caught at load', () => {
    registerPrimitive(stub('ribbon'));
    expect(() => registerPrimitive(stub('ribbon'))).toThrow(/already registered/i);
  });

  it('lists primitives sorted by id for a stable palette order', () => {
    registerPrimitive(stub('shockwave'));
    registerPrimitive(stub('burst'));
    expect(listPrimitives().map((p) => p.id)).toEqual(['burst', 'shockwave']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/ui/src/fx/registry.test.ts`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/fx/primitive.ts`:

```ts
import type { Container, Renderer } from 'pixi.js';
import type { FxParamSpecs, ParamsOf } from './params';

/** What a primitive is handed when it spawns. The container is already parented to the overlay stage. */
export interface FxContext {
  container: Container;
  renderer: Renderer;
}

/** A live instance of a primitive. The player owns its lifetime. */
export interface FxInstance {
  /** Advance by `dtMs`. Called once per frame while the layer is active. */
  update(dtMs: number): void;
  /** Apply edited parameters without a respawn — this is what makes live tuning feel instant. */
  setParams(next: Record<string, unknown>): void;
  destroy(): void;
}

/** A unit of rendering. Its parameters are declared once in `params` (see `params.ts`). */
export interface FxPrimitive<S extends FxParamSpecs = FxParamSpecs> {
  id: string;
  params: S;
  spawn(ctx: FxContext, params: ParamsOf<S>): FxInstance;
}
```

Create `packages/ui/src/fx/registry.ts`:

```ts
import type { FxPrimitive } from './primitive';

const REGISTRY = new Map<string, FxPrimitive>();

export function registerPrimitive(p: FxPrimitive): void {
  if (REGISTRY.has(p.id)) throw new Error(`[fx] primitive '${p.id}' is already registered`);
  REGISTRY.set(p.id, p);
}

export function getPrimitive(id: string): FxPrimitive | undefined {
  return REGISTRY.get(id);
}

export function listPrimitives(): FxPrimitive[] {
  return [...REGISTRY.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Test-only: reset between cases. Not called by app code. */
export function clearPrimitives(): void {
  REGISTRY.clear();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/ui/src/fx/registry.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/primitive.ts packages/ui/src/fx/registry.ts packages/ui/src/fx/registry.test.ts
git commit -m "feat(fx): primitive contract and registry"
```

---

### Task 3: Def format and the timeline scheduler

**Files:**
- Create: `packages/ui/src/fx/def.ts`
- Test: `packages/ui/src/fx/def.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/fx/def.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { layerStateAt, type FxDef } from './def';

const DEF: FxDef = {
  id: 'test',
  duration: 600,
  layers: [
    { primitive: 'ribbon', anchor: 'travel', at: 0, life: 400, params: {} },
    { primitive: 'burst', anchor: 'target', at: 180, life: 200, params: {} },
  ],
};

describe('layerStateAt', () => {
  it('reports a layer pending before its start time', () => {
    expect(layerStateAt(DEF, 0).map((l) => l.state)).toEqual(['active', 'pending']);
  });

  it('reports a layer active once its start time is reached', () => {
    expect(layerStateAt(DEF, 180).map((l) => l.state)).toEqual(['active', 'active']);
  });

  it('reports a layer done once its life has elapsed', () => {
    expect(layerStateAt(DEF, 420).map((l) => l.state)).toEqual(['done', 'done']);
  });

  it('gives each active layer its local elapsed time, not the global clock', () => {
    const [ribbon, burst] = layerStateAt(DEF, 200);
    expect(ribbon.localMs).toBe(200);
    expect(burst.localMs).toBe(20);
  });

  it('treats a layer with no life as running to the end of the def', () => {
    const open: FxDef = { id: 'o', duration: 500, layers: [{ primitive: 'r', anchor: 'target', at: 100, params: {} }] };
    expect(layerStateAt(open, 499)[0].state).toBe('active');
    expect(layerStateAt(open, 500)[0].state).toBe('done');
  });

  it('clamps a negative clock to the start rather than reporting nonsense', () => {
    expect(layerStateAt(DEF, -50).map((l) => l.state)).toEqual(['active', 'pending']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/ui/src/fx/def.test.ts`
Expected: FAIL — cannot resolve `./def`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/fx/def.ts`:

```ts
/**
 * An effect is DATA. Deliberately not a language: no expressions, no conditionals, no branching. Anything
 * that needs logic becomes a hand-written primitive registered into the same system.
 */
export type FxAnchorId = 'source' | 'target' | 'travel' | 'cursor' | 'slot' | 'camera';

export interface FxLayer {
  primitive: string;
  anchor: FxAnchorId;
  /** Milliseconds from effect start at which this layer spawns. */
  at: number;
  /** Milliseconds the layer lives. Omitted = until the def's duration. */
  life?: number;
  params: Record<string, unknown>;
}

export interface FxDef {
  id: string;
  duration: number;
  layers: FxLayer[];
}

export type FxLayerState = 'pending' | 'active' | 'done';

export interface FxLayerAt {
  layer: FxLayer;
  state: FxLayerState;
  /** Milliseconds since this layer's own start. 0 while pending. */
  localMs: number;
}

/** Pure: what every layer is doing at clock time `ms`. The player owns spawning; this owns the arithmetic,
 *  which is what makes scrubbing to an arbitrary frame testable without a renderer. */
export function layerStateAt(def: FxDef, ms: number): FxLayerAt[] {
  const clock = Math.max(0, ms);
  return def.layers.map((layer) => {
    const end = layer.at + (layer.life ?? def.duration - layer.at);
    if (clock < layer.at) return { layer, state: 'pending', localMs: 0 };
    if (clock >= end) return { layer, state: 'done', localMs: end - layer.at };
    return { layer, state: 'active', localMs: clock - layer.at };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/ui/src/fx/def.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/def.ts packages/ui/src/fx/def.test.ts
git commit -m "feat(fx): def format and pure timeline scheduler"
```

---

### Task 4: The player

**Files:**
- Create: `packages/ui/src/fx/player.ts`
- Test: `packages/ui/src/fx/player.test.ts`

The player is tested with a stub primitive and a stub context, so it needs no WebGL.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/fx/player.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPlayer } from './player';
import { clearPrimitives, registerPrimitive } from './registry';
import type { FxContext, FxInstance } from './primitive';
import type { FxDef } from './def';

const spawned: { id: string; inst: FxInstance }[] = [];

const stubPrimitive = (id: string) => ({
  id,
  params: { size: { kind: 'slider' as const, label: 'Size', min: 0, max: 10, step: 1, default: 5 } },
  spawn: () => {
    const inst: FxInstance = { update: vi.fn(), setParams: vi.fn(), destroy: vi.fn() };
    spawned.push({ id, inst });
    return inst;
  },
});

const CTX = { container: { addChild: vi.fn(), removeChild: vi.fn() }, renderer: {} } as unknown as FxContext;

const DEF: FxDef = {
  id: 'test',
  duration: 500,
  layers: [
    { primitive: 'a', anchor: 'target', at: 0, life: 300, params: {} },
    { primitive: 'b', anchor: 'target', at: 200, life: 100, params: {} },
  ],
};

describe('createPlayer', () => {
  beforeEach(() => {
    spawned.length = 0;
    clearPrimitives();
    registerPrimitive(stubPrimitive('a'));
    registerPrimitive(stubPrimitive('b'));
  });

  it('spawns a layer only when its start time is reached', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    expect(spawned.map((s) => s.id)).toEqual(['a']);
    p.update(200);
    expect(spawned.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('destroys a layer when its life elapses', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    const a = spawned[0].inst;
    p.update(299);
    expect(a.destroy).not.toHaveBeenCalled();
    p.update(2);
    expect(a.destroy).toHaveBeenCalledTimes(1);
  });

  it('scales elapsed time by speed', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.setSpeed(2);
    p.update(100);
    expect(p.timeMs()).toBe(200);
  });

  it('scrub rebuilds state at an arbitrary time', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.scrub(250);
    expect(p.timeMs()).toBe(250);
    expect(spawned.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('scrubbing backwards destroys layers that have not started yet', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.scrub(250);
    const b = spawned.find((s) => s.id === 'b')!.inst;
    p.scrub(50);
    expect(b.destroy).toHaveBeenCalled();
  });

  it('loops back to zero at the duration when looping is on', () => {
    const p = createPlayer(DEF, CTX, { loop: true });
    p.play();
    p.update(520);
    expect(p.timeMs()).toBe(20);
  });

  it('stops at the duration when looping is off', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.update(520);
    expect(p.timeMs()).toBe(500);
    expect(p.isPlaying()).toBe(false);
  });

  it('destroys every live layer on stop', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.update(200);
    p.stop();
    for (const s of spawned) expect(s.inst.destroy).toHaveBeenCalled();
  });

  it('does not advance while paused', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    p.pause();
    p.update(100);
    expect(p.timeMs()).toBe(0);
  });

  it('pushes edited params to a live layer without respawning it', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    const a = spawned[0].inst;
    p.setLayerParams(0, { size: 9 });
    expect(a.setParams).toHaveBeenCalledWith({ size: 9 });
    expect(spawned).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/ui/src/fx/player.test.ts`
Expected: FAIL — cannot resolve `./player`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/fx/player.ts`:

```ts
import { Container } from 'pixi.js';
import { coerceParams } from './params';
import { layerStateAt, type FxDef } from './def';
import { getPrimitive } from './registry';
import type { FxContext, FxInstance } from './primitive';

export interface FxPlayerOptions {
  loop?: boolean;
}

export interface FxPlayer {
  play(): void;
  pause(): void;
  stop(): void;
  update(dtMs: number): void;
  scrub(ms: number): void;
  setSpeed(n: number): void;
  setLayerParams(index: number, next: Record<string, unknown>): void;
  timeMs(): number;
  isPlaying(): boolean;
  destroy(): void;
}

interface Live {
  inst: FxInstance;
  container: Container;
}

/**
 * Drives an `FxDef`. Owns layer lifetimes, the clock, and scrubbing. Deliberately has no idea how any
 * primitive renders — that indirection is why one player can be optimised on behalf of every effect.
 */
export function createPlayer(def: FxDef, ctx: FxContext, opts: FxPlayerOptions = {}): FxPlayer {
  const live = new Map<number, Live>();
  let clock = 0;
  let speed = 1;
  let playing = false;

  const spawn = (index: number): void => {
    if (live.has(index)) return;
    const layer = def.layers[index];
    const prim = getPrimitive(layer.primitive);
    if (!prim) {
      console.warn(`[fx] def '${def.id}' references unknown primitive '${layer.primitive}'`);
      return;
    }
    const container = new Container();
    ctx.container.addChild(container);
    const inst = prim.spawn({ container, renderer: ctx.renderer }, coerceParams(prim.params, layer.params));
    live.set(index, { inst, container });
  };

  const kill = (index: number): void => {
    const l = live.get(index);
    if (!l) return;
    l.inst.destroy();
    l.container.destroy({ children: true });
    live.delete(index);
  };

  /** Bring live layers in line with the clock, then tick the survivors. */
  const reconcile = (dtMs: number): void => {
    const states = layerStateAt(def, clock);
    states.forEach((s, i) => {
      if (s.state === 'active') spawn(i);
      else kill(i);
    });
    if (dtMs > 0) for (const l of live.values()) l.inst.update(dtMs);
  };

  return {
    play(): void {
      playing = true;
      reconcile(0);
    },
    pause(): void {
      playing = false;
    },
    stop(): void {
      playing = false;
      clock = 0;
      for (const i of [...live.keys()]) kill(i);
    },
    update(dtMs: number): void {
      if (!playing) return;
      clock += dtMs * speed;
      if (clock >= def.duration) {
        if (opts.loop) clock -= def.duration;
        else {
          clock = def.duration;
          playing = false;
        }
      }
      reconcile(dtMs * speed);
    },
    scrub(ms: number): void {
      clock = Math.min(def.duration, Math.max(0, ms));
      reconcile(0);
    },
    setSpeed(n: number): void {
      speed = n;
    },
    setLayerParams(index: number, next: Record<string, unknown>): void {
      def.layers[index].params = { ...def.layers[index].params, ...next };
      live.get(index)?.inst.setParams(next);
    },
    timeMs: () => clock,
    isPlaying: () => playing,
    destroy(): void {
      for (const i of [...live.keys()]) kill(i);
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/ui/src/fx/player.test.ts`
Expected: PASS — 10 tests.

> If `container.destroy` is undefined in the stub, that is expected: the stub context's `addChild` is a
> spy, but the per-layer `Container` is a real PixiJS container constructed by the player, and PixiJS
> containers construct fine in node. Only *rendering* requires WebGL.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/player.ts packages/ui/src/fx/player.test.ts
git commit -m "feat(fx): runtime player with scrub, loop and live param edits"
```

---

### Task 5: Ribbon geometry (pure)

**Files:**
- Create: `packages/ui/src/fx/ribbonGeometry.ts`
- Test: `packages/ui/src/fx/ribbonGeometry.test.ts`

Extracted from the 2026-07-23 prototype. Pure so the arc-length maths is testable without a renderer.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/fx/ribbonGeometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RIBBON_SEGMENTS, buildRibbonUVs, writeRibbonPositions } from './ribbonGeometry';

const straight = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

describe('buildRibbonUVs', () => {
  it('runs u from 0 at the head to 1 at the tail, with v on both edges', () => {
    const uvs = buildRibbonUVs();
    expect(uvs.length).toBe((RIBBON_SEGMENTS + 1) * 4);
    expect([uvs[0], uvs[1], uvs[2], uvs[3]]).toEqual([0, 0, 0, 1]);
    expect(uvs[uvs.length - 4]).toBeCloseTo(1);
    expect(uvs[uvs.length - 2]).toBeCloseTo(1);
  });
});

describe('writeRibbonPositions', () => {
  it('extrudes perpendicular to a horizontal spine', () => {
    const pos = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    expect(writeRibbonPositions(pos, straight, 40)).toBe(true);
    const mid = Math.floor(RIBBON_SEGMENTS / 2) * 4;
    expect(pos[mid]).toBeCloseTo(pos[mid + 2]);        // same x on both edges
    expect(pos[mid + 1]).toBeGreaterThan(pos[mid + 3]); // offset in opposite y directions
  });

  it('tapers to nothing at the tail', () => {
    const pos = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(pos, straight, 40);
    const last = RIBBON_SEGMENTS * 4;
    expect(Math.abs(pos[last + 1] - pos[last + 3])).toBeLessThan(0.5);
  });

  it('pinches the head so the ribbon comes to a point', () => {
    const pos = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(pos, straight, 40);
    expect(Math.abs(pos[1] - pos[3])).toBeLessThan(Math.abs(pos[4 * 8 + 1] - pos[4 * 8 + 3]));
  });

  it('reports false for a degenerate spine so the caller can hide the mesh', () => {
    const pos = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    expect(writeRibbonPositions(pos, [{ x: 5, y: 5 }], 40)).toBe(false);
    expect(writeRibbonPositions(pos, [{ x: 5, y: 5 }, { x: 5, y: 5 }], 40)).toBe(false);
  });

  it('resamples to even arc length regardless of input point spacing', () => {
    const clumped = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 100, y: 0 }];
    const a = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    const b = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
    writeRibbonPositions(a, clumped, 40);
    writeRibbonPositions(b, straight, 40);
    for (let i = 0; i < a.length; i += 4) expect(a[i]).toBeCloseTo(b[i], 1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/ui/src/fx/ribbonGeometry.test.ts`
Expected: FAIL — cannot resolve `./ribbonGeometry`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/fx/ribbonGeometry.ts`:

```ts
/** Segments along the ribbon spine. 48 is enough for a smooth curve at trail lengths up to ~700px. */
export const RIBBON_SEGMENTS = 48;

export interface RibbonPoint {
  x: number;
  y: number;
}

/** Static UVs: u runs 0 (head) → 1 (tail); v is 0 on one edge and 1 on the other. */
export function buildRibbonUVs(): Float32Array {
  const uvs = new Float32Array((RIBBON_SEGMENTS + 1) * 4);
  for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
    const t = i / RIBBON_SEGMENTS;
    uvs[i * 4] = t;
    uvs[i * 4 + 1] = 0;
    uvs[i * 4 + 2] = t;
    uvs[i * 4 + 3] = 1;
  }
  return uvs;
}

export function buildRibbonIndices(): Uint32Array {
  const indices = new Uint32Array(RIBBON_SEGMENTS * 6);
  for (let i = 0; i < RIBBON_SEGMENTS; i++) {
    const a = i * 2;
    indices.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i * 6);
  }
  return indices;
}

/**
 * Lay the ribbon along `spine` (head first) and extrude it to `width`.
 *
 * Resamples to even arc length first: without that, a slow frame bunches spine points together and the
 * noise visibly swims along the trail. Returns false for a degenerate spine so the caller hides the mesh
 * rather than rendering a NaN triangle.
 */
export function writeRibbonPositions(out: Float32Array, spine: RibbonPoint[], width: number): boolean {
  if (spine.length < 2) return false;

  const cum = [0];
  for (let i = 1; i < spine.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(spine[i].x - spine[i - 1].x, spine[i].y - spine[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (total < 1) return false;

  let seek = 1;
  for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
    const t = i / RIBBON_SEGMENTS;
    const target = t * total;
    while (seek < cum.length - 1 && cum[seek] < target) seek++;
    const span = cum[seek] - cum[seek - 1] || 1;
    const f = (target - cum[seek - 1]) / span;
    const a = spine[seek - 1];
    const b = spine[seek];
    const x = a.x + (b.x - a.x) * f;
    const y = a.y + (b.y - a.y) * f;

    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const m = Math.hypot(tx, ty) || 1;
    tx /= m;
    ty /= m;

    // Pinched at the head, full through the body, feathered at the tail.
    const w = width * 0.5 * Math.min(1, t / 0.12) * Math.pow(1 - t, 0.35);
    out[i * 4] = x - ty * w;
    out[i * 4 + 1] = y + tx * w;
    out[i * 4 + 2] = x + ty * w;
    out[i * 4 + 3] = y - tx * w;
  }
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/ui/src/fx/ribbonGeometry.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ribbonGeometry.ts packages/ui/src/fx/ribbonGeometry.test.ts
git commit -m "feat(fx): pure ribbon geometry with arc-length resampling"
```

---

### Task 6: The ribbon primitive

**Files:**
- Create: `packages/ui/src/fx/primitives/ribbon.ts`

The shader is the validated prototype from 2026-07-23. Two things in it are load-bearing and must not be
"simplified": the band quantisation (`floor(q * bands)`) is the entire art style, and the plateau width
profile is what lets the top colour band fire at all.

- [ ] **Step 1: Write the primitive**

Create `packages/ui/src/fx/primitives/ribbon.ts`:

```ts
import { Mesh, MeshGeometry, Shader } from 'pixi.js';
import { registerPrimitive } from '../registry';
import { buildRibbonIndices, buildRibbonUVs, RIBBON_SEGMENTS, writeRibbonPositions, type RibbonPoint } from '../ribbonGeometry';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import type { FxParamSpecs, ParamsOf } from '../params';

const VERT = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

/**
 * Posterized energy trail. The look is NOT soft additive particles — it is hard-edged cel banding:
 * `floor(d * uBands)` instead of a smooth ramp. `uPlateau` gives the flat hot core; with a linear width
 * falloff only a ~3px centre line ever crosses the top band's threshold and the white core never fires.
 */
const FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;

uniform float uTime;
uniform float uBands;
uniform vec2  uNoise;
uniform float uWarp;
uniform float uScroll;
uniform float uErode;
uniform float uGain;
uniform float uHead;
uniform float uTail;
uniform float uPlateau;
uniform float uSoft;
uniform float uAlpha;
uniform float uSeed;
uniform vec4  uPal[4];

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1, 0));
  float c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}
vec4 pal(float t) {
  float s = clamp(t, 0.0, 1.0) * 3.0;
  int i = int(floor(s));
  if (i >= 3) return uPal[3];
  return mix(uPal[i], uPal[i + 1], fract(s));
}

void main() {
  float across = abs(vUV.y * 2.0 - 1.0);
  float head  = smoothstep(0.0, max(uHead, 0.001), vUV.x);
  float tail  = pow(clamp(1.0 - vUV.x, 0.0, 1.0), uTail);
  float wfall = 1.0 - smoothstep(uPlateau, 1.0, across);
  float shape = head * tail * wfall * uGain;

  vec2 p = vec2(vUV.x * uNoise.x - uTime * uScroll, vUV.y * uNoise.y + uSeed);
  p += (vec2(fbm(p * 1.7), fbm(p * 1.7 + 19.3)) - 0.5) * uWarp;
  float n = fbm(p);

  float d = shape - n * uErode;
  if (d <= 0.0) discard;

  float q = clamp(d / max(uGain, 0.001), 0.0, 1.0);
  float b = floor(q * uBands) / max(uBands - 1.0, 1.0);
  vec4 c = pal(b);

  float aa = smoothstep(0.0, fwidth(d) * uSoft, d);
  finalColor = vec4(c.rgb, 1.0) * (c.a * aa * uAlpha);
}
`;

/** Rim → core, four stops each. Read off the reference art. */
const PALETTES: Record<string, [string, string, string, string]> = {
  violet: ['#7a17bd', '#c936ef', '#f0a0ff', '#ffffff'],
  ember: ['#e04a12', '#ff9c1e', '#ffe08a', '#ffffff'],
  mint: ['#0d8f7d', '#2ee0ac', '#b6ffe8', '#ffffff'],
  magenta: ['#a81290', '#ff33a8', '#ffc4ea', '#ffffff'],
  gold: ['#ff5f0a', '#ffb81f', '#fff0a8', '#ffffff'],
  acid: ['#2c9612', '#7ade22', '#ecffa8', '#ffffff'],
};

const palToFloats = (name: string): Float32Array => {
  const out = new Float32Array(16);
  (PALETTES[name] ?? PALETTES.violet).forEach((hex, i) => {
    const n = parseInt(hex.slice(1), 16);
    out[i * 4] = ((n >> 16) & 255) / 255;
    out[i * 4 + 1] = ((n >> 8) & 255) / 255;
    out[i * 4 + 2] = (n & 255) / 255;
    out[i * 4 + 3] = 1;
  });
  return out;
};

const SPECS = {
  bands: { kind: 'slider', group: 'Style', label: 'Bands', min: 1, max: 8, step: 1, default: 4,
    help: 'The style knob. 3-4 is the reference look; 8 washes out to generic fire.' },
  plateau: { kind: 'slider', group: 'Style', label: 'Core width', min: 0, max: 0.9, step: 0.01, default: 0.3,
    help: 'Width of the flat hot core. At 0 the top band never fires.' },
  palette: { kind: 'enum', group: 'Style', label: 'Palette', options: Object.keys(PALETTES), default: 'violet' },
  noiseAlong: { kind: 'slider', group: 'Noise', label: 'Noise along', min: 0.5, max: 12, step: 0.1, default: 3 },
  noiseAcross: { kind: 'slider', group: 'Noise', label: 'Noise across', min: 1, max: 20, step: 0.1, default: 7,
    help: 'Higher than "along" gives the stretched, sheared licks that read as speed.' },
  warp: { kind: 'slider', group: 'Noise', label: 'Domain warp', min: 0, max: 1.5, step: 0.01, default: 0.35 },
  scroll: { kind: 'slider', group: 'Noise', label: 'Scroll speed', min: 0, max: 6, step: 0.05, default: 1.4 },
  erode: { kind: 'slider', group: 'Noise', label: 'Erosion', min: 0, max: 1.2, step: 0.01, default: 0.5 },
  gain: { kind: 'slider', group: 'Shape', label: 'Gain', min: 0.3, max: 2, step: 0.01, default: 1.5 },
  head: { kind: 'slider', group: 'Shape', label: 'Head sharpness', min: 0.01, max: 0.5, step: 0.005, default: 0.06 },
  tail: { kind: 'slider', group: 'Shape', label: 'Tail falloff', min: 0.3, max: 4, step: 0.05, default: 1.6 },
  soft: { kind: 'slider', group: 'Shape', label: 'Edge AA', min: 0.5, max: 6, step: 0.1, default: 1.5 },
  length: { kind: 'slider', group: 'Shape', label: 'Length px', min: 60, max: 700, step: 5, default: 300 },
  width: { kind: 'slider', group: 'Shape', label: 'Width px', min: 8, max: 160, step: 1, default: 54 },
  alpha: { kind: 'slider', group: 'Shape', label: 'Alpha', min: 0, max: 1, step: 0.01, default: 1 },
  additive: { kind: 'toggle', group: 'Style', label: 'Additive blend', default: false },
} satisfies FxParamSpecs;

type RibbonParams = ParamsOf<typeof SPECS>;

class RibbonInstance implements FxInstance {
  private mesh: Mesh;
  private geometry: MeshGeometry;
  private uniforms: Record<string, unknown>;
  private spine: RibbonPoint[] = [];
  private params: RibbonParams;
  private clock = 0;

  constructor(ctx: FxContext, params: RibbonParams) {
    this.params = params;
    this.geometry = new MeshGeometry({
      positions: new Float32Array((RIBBON_SEGMENTS + 1) * 4),
      uvs: buildRibbonUVs(),
      indices: buildRibbonIndices(),
    });
    const shader = Shader.from({
      gl: { vertex: VERT, fragment: FRAG },
      resources: {
        ribbonUniforms: {
          uTime: { value: 0, type: 'f32' },
          uBands: { value: params.bands, type: 'f32' },
          uNoise: { value: new Float32Array([params.noiseAlong, params.noiseAcross]), type: 'vec2<f32>' },
          uWarp: { value: params.warp, type: 'f32' },
          uScroll: { value: params.scroll, type: 'f32' },
          uErode: { value: params.erode, type: 'f32' },
          uGain: { value: params.gain, type: 'f32' },
          uHead: { value: params.head, type: 'f32' },
          uTail: { value: params.tail, type: 'f32' },
          uPlateau: { value: params.plateau, type: 'f32' },
          uSoft: { value: params.soft, type: 'f32' },
          uAlpha: { value: params.alpha, type: 'f32' },
          uSeed: { value: 0, type: 'f32' },
          uPal: { value: palToFloats(params.palette), type: 'vec4<f32>', size: 4 },
        },
      },
    });
    this.uniforms = (shader.resources.ribbonUniforms as { uniforms: Record<string, unknown> }).uniforms;
    this.mesh = new Mesh({ geometry: this.geometry, shader });
    this.mesh.blendMode = params.additive ? 'add' : 'normal';
    this.mesh.visible = false;
    ctx.container.addChild(this.mesh);
  }

  /** The player-facing anchor hook: push the current head position each frame. */
  pushHead(x: number, y: number): void {
    this.spine.unshift({ x, y });
    let acc = 0;
    for (let i = 1; i < this.spine.length; i++) {
      acc += Math.hypot(this.spine[i].x - this.spine[i - 1].x, this.spine[i].y - this.spine[i - 1].y);
      if (acc > this.params.length) {
        this.spine.length = i + 1;
        break;
      }
    }
    if (this.spine.length > 200) this.spine.length = 200;
  }

  update(dtMs: number): void {
    this.clock += dtMs / 1000;
    this.uniforms.uTime = this.clock;
    const ok = writeRibbonPositions(this.geometry.positions, this.spine, this.params.width);
    this.mesh.visible = ok;
    if (ok) this.geometry.getBuffer('aPosition').update();
  }

  setParams(next: Record<string, unknown>): void {
    this.params = { ...this.params, ...next } as RibbonParams;
    const p = this.params;
    const u = this.uniforms;
    u.uBands = p.bands;
    (u.uNoise as Float32Array)[0] = p.noiseAlong;
    (u.uNoise as Float32Array)[1] = p.noiseAcross;
    u.uWarp = p.warp;
    u.uScroll = p.scroll;
    u.uErode = p.erode;
    u.uGain = p.gain;
    u.uHead = p.head;
    u.uTail = p.tail;
    u.uPlateau = p.plateau;
    u.uSoft = p.soft;
    u.uAlpha = p.alpha;
    u.uPal = palToFloats(p.palette);
    this.mesh.blendMode = p.additive ? 'add' : 'normal';
  }

  destroy(): void {
    this.mesh.destroy(true);
  }
}

export const ribbonPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'ribbon',
  params: SPECS,
  spawn: (ctx, params) => new RibbonInstance(ctx, params),
};

registerPrimitive(ribbonPrimitive as FxPrimitive);
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck:web 2>&1 | grep "fx/"`
Expected: no output (the pre-existing 50 unrelated errors elsewhere are tracked separately — do not fix them here).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/fx/primitives/ribbon.ts
git commit -m "feat(fx): ribbon primitive — posterized cel-band trail shader"
```

---

### Task 7: Anchors and scenarios

**Files:**
- Create: `packages/ui/src/fx/anchors.ts`, `packages/ui/src/fx/scenarios.ts`
- Test: `packages/ui/src/fx/anchors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/fx/anchors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pointOnTravel, resolveAnchor, type FxAnchors } from './anchors';

const ANCHORS: FxAnchors = {
  source: { x: 0, y: 0 },
  target: { x: 100, y: 0 },
  cursor: { x: 50, y: 50 },
};

describe('resolveAnchor', () => {
  it('returns the named point', () => {
    expect(resolveAnchor(ANCHORS, 'target', 0)).toEqual({ x: 100, y: 0 });
  });

  it('falls back to the origin for an anchor the scenario did not stage', () => {
    expect(resolveAnchor({}, 'target', 0)).toEqual({ x: 0, y: 0 });
  });

  it('interpolates travel from source to target by progress', () => {
    expect(resolveAnchor(ANCHORS, 'travel', 0.5)).toEqual({ x: 50, y: 0 });
  });
});

describe('pointOnTravel', () => {
  it('bows the path so the trail curves instead of running dead straight', () => {
    const mid = pointOnTravel({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5, 0.28);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).not.toBeCloseTo(0);
  });

  it('starts exactly at the source and ends exactly at the target', () => {
    const a = { x: 3, y: 7 };
    const b = { x: 90, y: 40 };
    expect(pointOnTravel(a, b, 0, 0.28)).toEqual(a);
    expect(pointOnTravel(a, b, 1, 0.28)).toEqual(b);
  });

  it('runs straight when bow is zero', () => {
    expect(pointOnTravel({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5, 0)).toEqual({ x: 50, y: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/ui/src/fx/anchors.test.ts`
Expected: FAIL — cannot resolve `./anchors`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/fx/anchors.ts`:

```ts
import type { FxAnchorId } from './def';

export interface FxPoint {
  x: number;
  y: number;
}

/** Screen-space points a scenario (or a real game moment) stages for a def to attach to. */
export type FxAnchors = Partial<Record<'source' | 'target' | 'cursor' | 'slot' | 'camera', FxPoint>>;

const ORIGIN: FxPoint = { x: 0, y: 0 };

/** Quadratic arc between two anchors. `bow` is the perpendicular offset as a fraction of the span. */
export function pointOnTravel(a: FxPoint, b: FxPoint, t: number, bow: number): FxPoint {
  const mx = (a.x + b.x) / 2 + (b.y - a.y) * bow;
  const my = (a.y + b.y) / 2 - (b.x - a.x) * bow;
  const it = 1 - t;
  return {
    x: it * it * a.x + 2 * it * t * mx + t * t * b.x,
    y: it * it * a.y + 2 * it * t * my + t * t * b.y,
  };
}

/** `progress` is the layer's own 0..1 through its life; only `travel` uses it. */
export function resolveAnchor(anchors: FxAnchors, id: FxAnchorId, progress: number): FxPoint {
  if (id === 'travel') {
    return pointOnTravel(anchors.source ?? ORIGIN, anchors.target ?? ORIGIN, progress, 0.28);
  }
  if (id === 'camera') return anchors.camera ?? ORIGIN;
  return anchors[id] ?? ORIGIN;
}
```

Create `packages/ui/src/fx/scenarios.ts`:

```ts
import type { FxAnchors } from './anchors';

export interface FxScenario {
  id: string;
  label: string;
  hint: string;
  /** Stage the anchors for this frame. `cursor` is the live pointer position in page coordinates. */
  anchorsAt(viewport: { w: number; h: number }, cursor: { x: number; y: number }): FxAnchors;
}

/** Two units facing off — the shape of an attack. */
export const twoUnits: FxScenario = {
  id: 'twoUnits',
  label: 'Two units',
  hint: 'Source on the left, target on the right — the shape an attack takes.',
  anchorsAt: (v) => ({
    source: { x: v.w * 0.3, y: v.h * 0.5 },
    target: { x: v.w * 0.7, y: v.h * 0.5 },
    camera: { x: v.w * 0.5, y: v.h * 0.5 },
  }),
};

/** Follows the pointer — the fastest way to judge noise shear and scroll speed. */
export const cursorScenario: FxScenario = {
  id: 'cursor',
  label: 'Follow cursor',
  hint: 'Move the pointer over the stage. Best for judging noise shear and scroll speed.',
  anchorsAt: (v, c) => ({
    source: { x: v.w * 0.5, y: v.h * 0.5 },
    target: c,
    cursor: c,
    camera: { x: v.w * 0.5, y: v.h * 0.5 },
  }),
};

export const SCENARIOS: FxScenario[] = [twoUnits, cursorScenario];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/ui/src/fx/anchors.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/anchors.ts packages/ui/src/fx/scenarios.ts packages/ui/src/fx/anchors.test.ts
git commit -m "feat(fx): anchors and the first two scenarios"
```

---

### Task 8: The pixiFx seam

**Files:**
- Modify: `packages/ui/src/pixiFx.ts`

The player needs somewhere to draw and something to tick it. Rather than give the workbench its own
PixiJS Application (which would make it a parallel pipeline and defeat the point), add a small public
seam to the existing controller.

- [ ] **Step 1: Add the fields and public methods**

In `packages/ui/src/pixiFx.ts`, find the `hasLiveWork()` method (near line 687) and add these members
immediately **above** it, inside the `FxController` class:

```ts
  /** Externally-mounted layers + per-frame updaters (the FX workbench player). Kept deliberately small:
   *  this is the only seam through which code outside this file draws on the overlay canvas. */
  private extraUpdaters: ((dtMs: number) => void)[] = [];

  /** Mount a container on the overlay stage. Returns a disposer. */
  mountLayer(c: Container): () => void {
    this.layer?.addChild(c);
    return () => {
      this.layer?.removeChild(c);
    };
  }

  /** Register a per-frame callback driven by the overlay ticker. Returns a disposer. */
  addUpdater(fn: (dtMs: number) => void): () => void {
    this.extraUpdaters.push(fn);
    this.app?.ticker.start(); // an idled controller must wake while an external updater is live
    return () => {
      const i = this.extraUpdaters.indexOf(fn);
      if (i >= 0) this.extraUpdaters.splice(i, 1);
    };
  }
```

> If the private container field is not named `layer`, use whatever the field created at
> `app.stage.addChild(layer)` (near line 740) is assigned to.

- [ ] **Step 2: Keep the idle ticker awake while an updater is live**

In the same file, in `hasLiveWork()` (near line 687), add `this.extraUpdaters.length > 0 ||` as the first
clause of the returned boolean expression.

- [ ] **Step 3: Drive the updaters each frame**

In the `private update = (ticker: Ticker): void => {` method (near line 3207), add this as the **first**
statement in the body:

```ts
    if (this.extraUpdaters.length > 0) {
      const dtMs = ticker.deltaMS;
      for (const fn of [...this.extraUpdaters]) fn(dtMs);
    }
```

Iterating a copy matters: an updater may dispose itself mid-frame.

- [ ] **Step 4: Verify nothing regressed**

Run: `npm test`
Expected: PASS — the existing pixiFx-touching tests (choreographer impact/lunge/engine) still pass.

Run: `npm run typecheck:web 2>&1 | grep -E "pixiFx|fx/"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pixiFx.ts
git commit -m "feat(fx): public mountLayer/addUpdater seam on the overlay controller"
```

---

### Task 9: The workbench shell

**Files:**
- Create: `packages/ui/src/fx/ui/Inspector.tsx`, `packages/ui/src/fx/ui/Workbench.tsx`
- Modify: `packages/ui/src/DevMenu.tsx`, `packages/ui/src/Game.tsx`, `packages/ui/src/styles.css`

- [ ] **Step 1: Write the generated inspector**

Create `packages/ui/src/fx/ui/Inspector.tsx`:

```tsx
import type { FxParamSpecs } from '../params';

/**
 * Every control in this panel is generated from the primitive's own `FxParamSpec` record. There is no
 * labels map, no ranges table and no keys array to keep in sync — that is the whole point.
 */
export function Inspector({
  specs,
  values,
  onChange,
}: {
  specs: FxParamSpecs;
  values: Record<string, unknown>;
  onChange: (key: string, value: number | boolean | string) => void;
}): React.ReactElement {
  const groups = new Map<string, string[]>();
  for (const key of Object.keys(specs)) {
    const g = specs[key].group ?? 'General';
    const list = groups.get(g) ?? [];
    list.push(key);
    groups.set(g, list);
  }

  return (
    <div className="fxwb-inspector">
      {[...groups.entries()].map(([group, keys]) => (
        <section key={group}>
          <h3>{group}</h3>
          {keys.map((key) => {
            const spec = specs[key];
            return (
              <div className="fxwb-row" key={key} title={spec.help ?? ''}>
                <label htmlFor={`fxwb-${key}`}>{spec.label}</label>
                {spec.kind === 'slider' && (
                  <>
                    <input
                      id={`fxwb-${key}`}
                      type="range"
                      min={spec.min}
                      max={spec.max}
                      step={spec.step}
                      value={values[key] as number}
                      onChange={(e) => onChange(key, Number(e.target.value))}
                    />
                    <span className="fxwb-val">{String(values[key])}</span>
                  </>
                )}
                {spec.kind === 'toggle' && (
                  <input
                    id={`fxwb-${key}`}
                    type="checkbox"
                    checked={values[key] as boolean}
                    onChange={(e) => onChange(key, e.target.checked)}
                  />
                )}
                {spec.kind === 'enum' && (
                  <select
                    id={`fxwb-${key}`}
                    value={values[key] as string}
                    onChange={(e) => onChange(key, e.target.value)}
                  >
                    {spec.options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                )}
                {spec.kind === 'color' && (
                  <input
                    id={`fxwb-${key}`}
                    type="color"
                    value={`#${((values[key] as number) >>> 0).toString(16).padStart(6, '0')}`}
                    onChange={(e) => onChange(key, parseInt(e.target.value.slice(1), 16))}
                  />
                )}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write the shell**

Create `packages/ui/src/fx/ui/Workbench.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Container } from 'pixi.js';
import { pixiFx } from '../../pixiFx';
import { createPlayer, type FxPlayer } from '../player';
import { getPrimitive, listPrimitives } from '../registry';
import { defaultsOf } from '../params';
import { resolveAnchor } from '../anchors';
import { SCENARIOS } from '../scenarios';
import { Inspector } from './Inspector';
import type { FxDef } from '../def';
import '../primitives/ribbon';

/**
 * DEV-only FX workbench. Deliberately NOT a `.sfxmix` tuner panel: it is a full-screen shell with its own
 * layout, because the whole point is to stop shipping one bespoke panel per effect. Stripped from
 * production along with the rest of the dev tooling.
 */
export function FxWorkbench({ onClose }: { onClose: () => void }): React.ReactElement {
  const [primitiveId, setPrimitiveId] = useState('ribbon');
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [params, setParams] = useState<Record<string, unknown>>(() =>
    defaultsOf(getPrimitive('ribbon')?.params ?? {}),
  );
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [fps, setFps] = useState(0);

  const playerRef = useRef<FxPlayer | null>(null);
  const cursorRef = useRef({ x: 0, y: 0 });
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Rebuild the player whenever the primitive or scenario changes.
  useEffect(() => {
    const prim = getPrimitive(primitiveId);
    if (!prim) return;
    const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
    const def: FxDef = {
      id: `workbench-${primitiveId}`,
      duration: 1200,
      layers: [{ primitive: primitiveId, anchor: 'travel', at: 0, params: paramsRef.current }],
    };

    const host = new Container();
    const unmount = pixiFx.mountLayer(host);
    const renderer = (pixiFx as unknown as { app?: { renderer: unknown } }).app?.renderer;
    const player = createPlayer(def, { container: host, renderer: renderer as never }, { loop: true });
    playerRef.current = player;
    player.play();

    let elapsed = 0;
    let frames = 0;
    const stopUpdater = pixiFx.addUpdater((dtMs) => {
      player.update(dtMs);
      // Drive the head along the scenario's travel path so the ribbon has a spine to follow.
      const progress = (player.timeMs() % def.duration) / def.duration;
      const pt = resolveAnchor(
        scenario.anchorsAt({ w: window.innerWidth, h: window.innerHeight }, cursorRef.current),
        'travel',
        progress,
      );
      const inst = (player as unknown as { headSink?: (x: number, y: number) => void }).headSink;
      if (inst) inst(pt.x, pt.y);
      elapsed += dtMs;
      frames += 1;
      if (elapsed >= 500) {
        setFps(Math.round((frames * 1000) / elapsed));
        elapsed = 0;
        frames = 0;
      }
    });

    return () => {
      stopUpdater();
      player.destroy();
      unmount();
      host.destroy({ children: true });
      playerRef.current = null;
    };
  }, [primitiveId, scenarioId]);

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  const specs = getPrimitive(primitiveId)?.params ?? {};
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];

  const change = (key: string, value: number | boolean | string): void => {
    setParams((p) => ({ ...p, [key]: value }));
    playerRef.current?.setLayerParams(0, { [key]: value });
  };

  return (
    <div className="fxwb">
      <header className="fxwb-top">
        <strong>FX Workbench</strong>
        {listPrimitives().map((p) => (
          <button key={p.id} className={p.id === primitiveId ? 'on' : ''} onClick={() => setPrimitiveId(p.id)}>
            {p.id}
          </button>
        ))}
        <span className="fxwb-sep" />
        {SCENARIOS.map((s) => (
          <button key={s.id} className={s.id === scenarioId ? 'on' : ''} onClick={() => setScenarioId(s.id)}>
            {s.label}
          </button>
        ))}
        <span className="fxwb-fps">{fps} fps</span>
        <button onClick={onClose}>close</button>
      </header>

      <div className="fxwb-transport">
        <button
          onClick={() => {
            const p = playerRef.current;
            if (!p) return;
            if (playing) p.pause();
            else p.play();
            setPlaying(!playing);
          }}
        >
          {playing ? 'pause' : 'play'}
        </button>
        <input
          type="range"
          min={0}
          max={1200}
          step={1}
          value={playerRef.current?.timeMs() ?? 0}
          onChange={(e) => {
            playerRef.current?.pause();
            setPlaying(false);
            playerRef.current?.scrub(Number(e.target.value));
          }}
        />
        <label>
          speed
          <input
            type="range"
            min={0.1}
            max={3}
            step={0.1}
            value={speed}
            onChange={(e) => {
              const n = Number(e.target.value);
              setSpeed(n);
              playerRef.current?.setSpeed(n);
            }}
          />
          <span className="fxwb-val">{speed}x</span>
        </label>
        <span className="fxwb-hint">{scenario.hint}</span>
      </div>

      <aside className="fxwb-side">
        <Inspector specs={specs} values={params} onChange={change} />
        <button
          className="fxwb-copy"
          onClick={() => void navigator.clipboard?.writeText(JSON.stringify(params, null, 2))}
        >
          copy params
        </button>
      </aside>
    </div>
  );
}
```

> **Known gap, resolved in Step 3:** the ribbon needs its head pushed each frame, but `FxInstance` has no
> such method. Step 3 adds it to the contract properly rather than reaching through the player.

- [ ] **Step 3: Add the head hook to the contract**

The ribbon is a path-following primitive, so the contract needs a way to feed it a position. Add to
`FxInstance` in `packages/ui/src/fx/primitive.ts`:

```ts
  /** Optional: primitives that follow a path (ribbons, trails) receive their head position each frame. */
  setHead?(x: number, y: number): void;
```

Rename `RibbonInstance.pushHead` to `setHead` in `packages/ui/src/fx/primitives/ribbon.ts`.

Add to `FxPlayer` in `packages/ui/src/fx/player.ts` (interface and implementation):

```ts
  setHead(index: number, x: number, y: number): void;
```

```ts
    setHead(index: number, x: number, y: number): void {
      live.get(index)?.inst.setHead?.(x, y);
    },
```

Then in `Workbench.tsx`, replace the `headSink` block with:

```ts
      player.setHead(0, pt.x, pt.y);
```

- [ ] **Step 4: Add a test for the new player method**

Append to `packages/ui/src/fx/player.test.ts`:

```ts
  it('forwards setHead to the live layer and ignores primitives that do not implement it', () => {
    const p = createPlayer(DEF, CTX);
    p.play();
    expect(() => p.setHead(0, 10, 20)).not.toThrow();
    expect(() => p.setHead(99, 10, 20)).not.toThrow();
  });
```

Run: `npx vitest run packages/ui/src/fx/player.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Add the shell styles**

Append to `packages/ui/src/styles.css`:

```css
/* ---- FX WORKBENCH (dev only) ------------------------------------------------ */
.fxwb { position: fixed; inset: 0; z-index: 400; pointer-events: none; font: 12px/1.4 system-ui, sans-serif; color: #d9d3ea; }
.fxwb > * { pointer-events: auto; }
.fxwb-top { position: absolute; top: 0; left: 0; right: 0; display: flex; gap: 6px; align-items: center;
  padding: 7px 10px; background: rgba(27, 24, 38, .93); border-bottom: 1px solid #3d3752; }
.fxwb-top button, .fxwb-transport button { background: #2b2739; color: #8d85a8; border: 1px solid #3d3752;
  border-radius: 5px; padding: 4px 9px; cursor: pointer; font: inherit; }
.fxwb-top button.on { background: #c936ef; border-color: #c936ef; color: #fff; }
.fxwb-sep { flex: 0 0 14px; }
.fxwb-fps { margin-left: auto; font-variant-numeric: tabular-nums; }
.fxwb-transport { position: absolute; bottom: 0; left: 0; right: 288px; display: flex; gap: 10px;
  align-items: center; padding: 8px 12px; background: rgba(27, 24, 38, .93); border-top: 1px solid #3d3752; }
.fxwb-transport input[type=range] { flex: 1; accent-color: #c936ef; }
.fxwb-transport label { display: flex; gap: 6px; align-items: center; flex: 0 0 190px; }
.fxwb-hint { color: #8d85a8; flex: 0 0 auto; }
.fxwb-side { position: absolute; top: 38px; right: 0; bottom: 0; width: 288px; overflow-y: auto;
  padding: 10px; background: rgba(27, 24, 38, .93); border-left: 1px solid #3d3752; }
.fxwb-inspector h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #8d85a8;
  margin: 12px 0 6px; }
.fxwb-row { display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; align-items: center; margin-bottom: 5px; }
.fxwb-row input[type=range] { grid-column: 1 / -1; width: 100%; accent-color: #c936ef; }
.fxwb-val { font-variant-numeric: tabular-nums; }
.fxwb-copy { width: 100%; margin-top: 14px; background: #3d3752; color: #d9d3ea; border: 1px solid #3d3752;
  border-radius: 5px; padding: 7px; cursor: pointer; font: inherit; }
```

- [ ] **Step 6: Mount it**

In `packages/ui/src/DevMenu.tsx`, add the import and a launcher entry. The `TUNERS` array holds panels
rendered as-is; the workbench needs an `onClose`, so add it as its own entry after the array instead —
follow the existing "Test FX" one-shot action pattern in that file for placement.

In `packages/ui/src/Game.tsx`, beside the existing `{import.meta.env.DEV && <DevMenu />}` on line 180, add:

```tsx
      {import.meta.env.DEV && fxWorkbenchOpen && <FxWorkbench onClose={() => setFxWorkbenchOpen(false)} />}
```

with `const [fxWorkbenchOpen, setFxWorkbenchOpen] = useState(false);` in the component body and the
import at the top. Pass `setFxWorkbenchOpen` down to `DevMenu` as a prop so its entry can open it.

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev`

Then, in the browser:
1. Open the dev menu (🛠️) and launch the FX Workbench.
2. Confirm a violet posterized trail is drawing over the board.
3. Drag **Bands** to 1, then 8 — the trail should go flat, then wash out to a smooth gradient. This proves the band quantisation is live.
4. Drag **Core width** to 0 — the white core should disappear entirely. This is the plateau finding from the prototype.
5. Switch to **Follow cursor** and move the pointer — the ribbon should follow, curved and evenly sampled.
6. Press **pause**, then drag the scrub slider — the effect should hold a single frame and change with the slider.
7. Confirm the fps readout stays at 60.
8. Open DevTools and confirm no console errors.

- [ ] **Step 8: Verify the workbench is stripped from production**

```bash
npm run build:web
grep -rl "fxwb\|FX Workbench" apps/web/dist/assets/ || echo "STRIPPED (expected)"
```

Expected: `STRIPPED (expected)`.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/fx packages/ui/src/styles.css packages/ui/src/Game.tsx packages/ui/src/DevMenu.tsx
git commit -m "feat(fx): dev-only workbench shell with generated inspector and transport"
```

---

### Task 10: Full verification and docs

**Files:**
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `README.md`

- [ ] **Step 1: Run every gate**

```bash
npm run typecheck && npm run lint && npm test && npm run build:web
```

Expected: all four green. Then:

```bash
npm run typecheck:web 2>&1 | grep "fx/" || echo "NO FX ERRORS (expected)"
```

Expected: `NO FX ERRORS (expected)`. The ~50 pre-existing errors elsewhere in `packages/ui` are tracked
separately — do not fix them in this PR.

- [ ] **Step 2: Measure the cost**

```bash
npm run perf
```

Record the result in the devlog entry. There is no engine change here, so this is a baseline check rather
than a comparison — the meaningful number is the workbench's own fps readout staying at 60 with the ribbon
live, recorded from Task 9 Step 7.

- [ ] **Step 3: Update the docs**

Prepend a dated entry to `docs/devlog.md` covering: the `FxParamSpec` single-source approach and why (the
`TrailTuner` drift), the player and its scrub semantics, the ribbon primitive with the banding and plateau
findings, the `pixiFx` seam, and the verification results from Step 1.

In `docs/roadmap.md`, replace the "FX Workbench — P1 foundation" entry under **Next** with a P2 entry
(timeline, anchors in real game moments, burst/shockwave/shaderQuad/emitter primitives, save-to-file).

In `README.md`, update the FX workbench bullet under **Recent changes** from "designed and queued" to
shipped, noting that a new effect no longer costs a bespoke panel.

- [ ] **Step 4: Commit and open the PR**

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: FX workbench P1"
git push -u origin feat/fx-workbench-p1
```

Open the PR against `main`. The owner merges — branch protection requires a review that cannot be
satisfied solo.

---

## Self-review notes

Checked against the spec:

- §3.1 primitive contract → Task 2; §3.2 def → Task 3; §3.3 anchors → Task 7; §3.4 player → Task 4;
  §3.5 scenarios → Task 7; §4 shell/inspector/transport → Task 9; §6 testing → Tasks 1–5, 7;
  §6 prod stripping → Task 9 Step 8; §7 P1 scope → all tasks.
- **Not built in P1, by design:** save-to-file via Vite middleware (P2 — the shell copies params to the
  clipboard for now), A/B compare (P3), the timeline UI (P2 — the def format supports multiple layers and
  `layerStateAt` schedules them, but the shell edits a single layer), and the legacy tuner adapter (P4).
- The `FxInstance.setHead` gap surfaced while writing Task 9 and is closed inside it (Steps 3–4) rather
  than left as a landmine.
