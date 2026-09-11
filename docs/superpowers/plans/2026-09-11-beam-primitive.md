# Beam FX Primitive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new mesh FX primitive `beam` — a clean, sustained source→target energy beam (grow-in → hold → fade) — fully authorable in the FX workbench, the ordered counterpart to `lightning`.

**Architecture:** A faithful structural clone of the `lightning` primitive. A pure geometry module (`beamGeometry.ts`) builds a single straight quad strip A→B (subdivided for an optional animated waver); the primitive (`primitives/beam.ts`) wraps it in a pooled custom shader with the same two-point anchoring (`setHead`/`setAim`), travel/dwell/release phase clock, `FilterStack` + `ContainerTransform`, then registers itself and is wired into the prewarm step lists. No choreography, simulator, or binding changes — this ships the primitive and its workbench authorability only.

**Tech Stack:** TypeScript, PixiJS v8 (`Mesh`/`MeshGeometry`/`Shader`, GLSL ES 3.00), Vitest. Monorepo package `@game/ui` (`packages/ui/src/fx`).

**Spec:** `docs/superpowers/specs/2026-09-11-beam-primitive-design.md`

## Global Constraints

- **Work in the worktree** `.claude/worktrees/beam` (branch `feat/beam-primitive`, off `origin/main`). Run all commands there. Run `npm install` in the worktree before trusting typecheck/test (fresh worktrees resolve `@game/*` through the primary checkout otherwise).
- **Mesh-first, mirror `lightning`.** The reference files to imitate are `packages/ui/src/fx/primitives/lightning.ts` and `packages/ui/src/fx/lightningGeometry.ts`. Diverge ONLY where this plan says so (no `aBorn` attribute — reveal is on `vUV.x`; no branches; no per-strike regeneration).
- **House shader conventions:** GLSL `#version 300 es`, premultiplied output, `mesh.blendMode = params.blendMode` (default `'add'`), pooled shader via `acquireShader`/`releaseShader`.
- **Performance:** pooled shader (prewarmed, no first-fire compile); rebuild the strip only when `waver > 0` or the anchors moved; additive mesh; no paint-property animation; no per-frame layout reads.
- **Prismatic/neutral defaults** (owner decision) — understated colours so every card tints the beam from the workbench. The exact default values are locked in Task 2 and asserted by a test; a later change to any default must be deliberate.
- **Gates before PR:** `npm run typecheck && npm run lint && npm test && npm run build:web` all green. Commit per task.
- **Enum params need `as const`** on their `options` or `ParamsOf` infers `string` (the lightning gotcha).
- **Filter-lab specs are runtime-generated**, so they are not in the static params type — in tests, cast `beamPrimitive.params as Record<string, unknown>` to check them by key.

---

### Task 1: Beam geometry module

Pure, deterministic strip generator with no renderer. Mirrors `lightningGeometry.ts`'s buffer discipline (pre-sized, never resized; degenerate index tail). Simpler: one strip, no branches/displacement, reveal coordinate is `uv.u` itself.

**Files:**
- Create: `packages/ui/src/fx/beamGeometry.ts`
- Test: `packages/ui/src/fx/beamGeometry.test.ts`

**Interfaces:**
- Consumes: nothing (pure maths).
- Produces:
  - `interface BeamShape { width?: number; segments?: number; waver?: number; waverFreq?: number }`
  - `interface BeamMeshBuffers { position: Float32Array; uv: Float32Array; index: Uint32Array }`
  - `const BEAM_MAX_SEGMENTS = 48`, `const BEAM_MAX_VERTS = (BEAM_MAX_SEGMENTS + 1) * 2`, `const BEAM_MAX_INDICES = BEAM_MAX_SEGMENTS * 6`
  - `function makeBeamBuffers(): BeamMeshBuffers`
  - `function writeBeamMesh(buf: BeamMeshBuffers, ax: number, ay: number, bx: number, by: number, shape: BeamShape, phase: number): { vertexCount: number; indexCount: number }` — `uv.u` = along-fraction 0(source)→1(target); `uv.v` = 0/1 edge; `phase` (radians) animates the waver; `A==B` writes nothing live.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/fx/beamGeometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  makeBeamBuffers, writeBeamMesh,
  BEAM_MAX_SEGMENTS, BEAM_MAX_VERTS, BEAM_MAX_INDICES,
} from './beamGeometry';

/** Midpoint of the two edge verts for along-point `i` — the spine position the shape was built around. */
const spineAt = (buf: ReturnType<typeof makeBeamBuffers>, i: number) => ({
  x: (buf.position[i * 4]! + buf.position[i * 4 + 2]!) / 2,
  y: (buf.position[i * 4 + 1]! + buf.position[i * 4 + 3]!) / 2,
});

describe('writeBeamMesh', () => {
  it('builds a strip of (segments+1)*2 vertices and segments*6 indices', () => {
    const buf = makeBeamBuffers();
    const { vertexCount, indexCount } = writeBeamMesh(buf, 0, 0, 100, 0, { segments: 24, waver: 0 }, 0);
    expect(vertexCount).toBe((24 + 1) * 2);
    expect(indexCount).toBe(24 * 6);
  });

  it('uv.u runs monotonically 0→1 along the beam and v alternates 0/1', () => {
    const buf = makeBeamBuffers();
    writeBeamMesh(buf, 0, 0, 100, 0, { segments: 4, waver: 0 }, 0);
    const us: number[] = [];
    for (let i = 0; i < (4 + 1) * 2; i++) { us.push(buf.uv[i * 2]!); expect(buf.uv[i * 2 + 1]).toBe(i % 2); }
    expect(us[0]).toBe(0);
    expect(us[us.length - 1]).toBeCloseTo(1);
    for (let i = 1; i < us.length; i++) expect(us[i]).toBeGreaterThanOrEqual(us[i - 1]!);
  });

  it('endpoints sit on A and B, offset only perpendicular by ±width/2', () => {
    const buf = makeBeamBuffers();
    writeBeamMesh(buf, 10, 20, 110, 20, { segments: 8, width: 18, waver: 0 }, 0);
    const first = spineAt(buf, 0), last = spineAt(buf, 8);
    expect(first.x).toBeCloseTo(10); expect(first.y).toBeCloseTo(20);
    expect(last.x).toBeCloseTo(110); expect(last.y).toBeCloseTo(20);
    expect(Math.abs(buf.position[1]! - buf.position[3]!)).toBeCloseTo(18); // straddle A by ±9 in y
  });

  it('a straight beam (waver 0) keeps every spine point colinear on A→B', () => {
    const buf = makeBeamBuffers();
    writeBeamMesh(buf, 0, 0, 100, 50, { segments: 12, waver: 0 }, 0);
    for (let i = 0; i <= 12; i++) { const s = spineAt(buf, i); expect(100 * s.y - 50 * s.x).toBeCloseTo(0, 2); }
  });

  it('waver bows interior spine points but pins both endpoints', () => {
    const buf = makeBeamBuffers();
    writeBeamMesh(buf, 0, 0, 100, 0, { segments: 12, width: 20, waver: 0.5, waverFreq: 1 }, Math.PI / 2);
    expect(spineAt(buf, 0).y).toBeCloseTo(0);
    expect(spineAt(buf, 12).y).toBeCloseTo(0);
    expect(Math.abs(spineAt(buf, 6).y)).toBeGreaterThan(1);
  });

  it('is safe for a zero-length beam (A==B): no verts, no NaNs', () => {
    const buf = makeBeamBuffers();
    const { vertexCount, indexCount } = writeBeamMesh(buf, 5, 5, 5, 5, { segments: 8 }, 0);
    expect(vertexCount).toBe(0); expect(indexCount).toBe(0);
    expect(buf.position.some((n) => Number.isNaN(n))).toBe(false);
  });

  it('clamps segments to the cap and never overruns the buffers', () => {
    const buf = makeBeamBuffers();
    const { vertexCount, indexCount } = writeBeamMesh(buf, 0, 0, 100, 0, { segments: 999 }, 0);
    expect(vertexCount).toBe((BEAM_MAX_SEGMENTS + 1) * 2);
    expect(vertexCount).toBeLessThanOrEqual(BEAM_MAX_VERTS);
    expect(indexCount).toBeLessThanOrEqual(BEAM_MAX_INDICES);
  });

  it('degenerates the unused index tail to 0', () => {
    const buf = makeBeamBuffers();
    writeBeamMesh(buf, 0, 0, 100, 0, { segments: 2, waver: 0 }, 0);
    for (let i = 2 * 6; i < BEAM_MAX_INDICES; i++) expect(buf.index[i]).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:/Users/micha/Desktop/ascent/.claude/worktrees/beam" && npx vitest run packages/ui/src/fx/beamGeometry.test.ts`
Expected: FAIL — cannot resolve `./beamGeometry`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/fx/beamGeometry.ts`:

```ts
/**
 * BEAM geometry — the pure strip generator behind the `beam` primitive, split out of the Pixi code the way
 * `lightningGeometry.ts` is split out of `lightning.ts`, so the maths is unit-testable with no renderer.
 *
 * A beam is a single straight quad STRIP from A(source) to B(target), `width` px wide, subdivided into
 * `segments` spans along its length. The subdivision exists so an optional `waver` can bow the beam with an
 * animated sine without rebuilding its topology. Unlike lightning there are no branches and no midpoint
 * displacement — the shape is deterministic from its endpoints (plus the `phase` the caller passes for waver),
 * so no seed is needed.
 *
 * `writeBeamMesh` lays the strip into pre-sized, never-resized buffers (the lightning/ribbon discipline): 2
 * verts per along-point (left/right of the spine), triangle-list indices, surplus index tail degenerated.
 * `uv.u` = along-fraction 0(source)→1(target) — ALSO the travel-reveal coordinate the shader gates on, so the
 * beam needs no third "born" attribute. `uv.v` = 0 on one edge, 1 on the other (shader carves the bright core).
 */

export interface BeamShape {
  /** Full glow-envelope width (px); the shader carves the bright core out of the middle. Default 18. */
  width?: number;
  /** Length subdivisions — more = smoother waver bow. Clamped to [1, BEAM_MAX_SEGMENTS]. Default 24. */
  segments?: number;
  /** Sinusoidal bow amplitude as a fraction of `width`. 0 = dead straight. Default 0.12. */
  waver?: number;
  /** Sine cycles along the beam for the waver bow. Default 2.5. */
  waverFreq?: number;
}

const TAU = Math.PI * 2;

/** Max length subdivisions — sizes the vertex buffers; the `segments` knob is capped here. */
export const BEAM_MAX_SEGMENTS = 48;
/** Vertices the position buffer must hold: (segments+1) along-points × 2 edge verts. */
export const BEAM_MAX_VERTS = (BEAM_MAX_SEGMENTS + 1) * 2;
/** Indices the buffer must hold: segments quads × 6 (triangle list). */
export const BEAM_MAX_INDICES = BEAM_MAX_SEGMENTS * 6;

export interface BeamMeshBuffers {
  /** 2 floats per vertex — x, y in the container's local space. */
  position: Float32Array;
  /** 2 floats per vertex — u (0 at source → 1 at target; reveal + core→tip gradient) and v (0/1 edge). */
  uv: Float32Array;
  /** Triangle-list indices; the unused tail is 0 (a zero-area triangle the rasteriser drops). */
  index: Uint32Array;
}

/** Allocate a full-capacity buffer set. Call once per instance; reuse every frame. */
export function makeBeamBuffers(): BeamMeshBuffers {
  return {
    position: new Float32Array(BEAM_MAX_VERTS * 2),
    uv: new Float32Array(BEAM_MAX_VERTS * 2),
    index: new Uint32Array(BEAM_MAX_INDICES),
  };
}

/**
 * Lay a beam strip from A(ax,ay) to B(bx,by) into `buf`. `phase` (radians) animates the waver bow; pass 0 for
 * a still beam. A zero-length beam (A≈B) writes nothing live (counts 0) rather than dividing by zero. Returns
 * live vertex/index counts; the index tail is zero-filled so a fixed index count never draws stale triangles.
 */
export function writeBeamMesh(
  buf: BeamMeshBuffers, ax: number, ay: number, bx: number, by: number, shape: BeamShape, phase: number,
): { vertexCount: number; indexCount: number } {
  const width = shape.width ?? 18;
  const waver = shape.waver ?? 0.12;
  const waverFreq = shape.waverFreq ?? 2.5;
  const segs = Math.max(1, Math.min(BEAM_MAX_SEGMENTS, Math.round(shape.segments ?? 24)));

  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) { buf.index.fill(0); return { vertexCount: 0, indexCount: 0 }; }
  const dirx = dx / len, diry = dy / len;   // unit along
  const nx = -diry, ny = dirx;              // unit normal (perpendicular)
  const hw = Math.max(0.2, width * 0.5);
  const amp = waver * width;                // bow amplitude in px

  let v = 0, idx = 0;
  const n = segs + 1;
  for (let i = 0; i < n; i++) {
    const u = i / segs;                     // along-fraction 0→1
    // `window` (sin πu) is 0 at both ends and peaks mid-beam, so the endpoints always meet their anchors.
    const window = Math.sin(Math.PI * u);
    const bow = amp * window * Math.sin(u * waverFreq * TAU + phase);
    const sxp = ax + dirx * (len * u) + nx * bow;
    const syp = ay + diry * (len * u) + ny * bow;
    buf.position[v * 2] = sxp - nx * hw; buf.position[v * 2 + 1] = syp - ny * hw;   // left edge (v=0)
    buf.uv[v * 2] = u; buf.uv[v * 2 + 1] = 0; v++;
    buf.position[v * 2] = sxp + nx * hw; buf.position[v * 2 + 1] = syp + ny * hw;   // right edge (v=1)
    buf.uv[v * 2] = u; buf.uv[v * 2 + 1] = 1; v++;
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    buf.index[idx++] = a; buf.index[idx++] = a + 1; buf.index[idx++] = a + 2;
    buf.index[idx++] = a + 2; buf.index[idx++] = a + 1; buf.index[idx++] = a + 3;
  }
  buf.index.fill(0, idx); // degenerate the surplus so a fixed index count never draws stale triangles
  return { vertexCount: v, indexCount: idx };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "C:/Users/micha/Desktop/ascent/.claude/worktrees/beam" && npx vitest run packages/ui/src/fx/beamGeometry.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/micha/Desktop/ascent/.claude/worktrees/beam"
git add packages/ui/src/fx/beamGeometry.ts packages/ui/src/fx/beamGeometry.test.ts
git commit -m "feat(fx): beam geometry — a pure, subdivided source->target strip generator"
```

---

### Task 2: Beam primitive

The Pixi instance: pooled shader, two-point anchoring, phase clock, filter lab, `SPECS` with locked prismatic/neutral defaults. Registers itself via `registerPrimitive`, but nothing imports it yet (so the global registry tests stay green — they break in Task 3 when `index.ts` imports it).

**Files:**
- Create: `packages/ui/src/fx/primitives/beam.ts`
- Test: `packages/ui/src/fx/primitives/beam.test.ts`

**Interfaces:**
- Consumes (Task 1): `makeBeamBuffers`, `writeBeamMesh`, `type BeamShape` from `../beamGeometry`.
- Produces:
  - `const beamPrimitive: FxPrimitive<typeof SPECS>` with `id: 'beam'` (registered at module load).
  - `function prewarmBeamShaders(renderer: Renderer | null, count?: number): void`
  - `function linkBeamShaderOn(renderer: Renderer): Shader`
  - Locked defaults (asserted by the test): `travelMs 200, dwellMs 520, releaseMs 200, width 18, coreWidth 3, segments 24, waver 0.12, waverFreq 2.5, waverSpeed 1.2, endSoftness 0.12, flowAmt 0.35, flowSpeed 1.4, flowFreq 6, flowDir 'target', glowStrength 0.7, gain 1, coreColor 0xf2f6ff, tipColor 0xdce8ff, glowColor 0x9fb8ff, flicker 0, blendMode 'add'`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/fx/primitives/beam.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultsOf, validateSpecs } from '../params';
import { beamPrimitive } from './beam';

/**
 * `BeamInstance` needs a real WebGL context (Mesh + Shader), so — exactly as `lightning.test.ts` does — the
 * instance is exercised at runtime and the unit tests cover what CAN be checked headless: the specs are
 * well-formed, and the shipped defaults are the prismatic/neutral look the owner approved. The strip geometry
 * has its own suite in `beamGeometry.test.ts`.
 */
describe('beam primitive', () => {
  it('registers with valid specs under the id "beam"', () => {
    expect(beamPrimitive.id).toBe('beam');
    expect(validateSpecs(beamPrimitive.params)).toEqual([]);
  });

  it('ships the prismatic-neutral defaults (a changed default must be a deliberate, reviewed edit)', () => {
    const d = defaultsOf(beamPrimitive.params);
    expect(d).toMatchObject({
      blendMode: 'add',
      travelMs: 200, dwellMs: 520, releaseMs: 200,
      width: 18, coreWidth: 3, segments: 24,
      waver: 0.12, waverFreq: 2.5, waverSpeed: 1.2, endSoftness: 0.12,
      flowAmt: 0.35, flowSpeed: 1.4, flowFreq: 6, flowDir: 'target',
      glowStrength: 0.7, gain: 1,
      coreColor: 0xf2f6ff, tipColor: 0xdce8ff, glowColor: 0x9fb8ff,
      flicker: 0,
    });
  });

  it('carries the full filter lab, blur and transform knobs, so every workshop filter applies', () => {
    const p = beamPrimitive.params as Record<string, unknown>;
    expect(p.blur).toBeDefined();
    expect(p.fxSpin).toBeDefined();
    expect(p.bloomOn).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:/Users/micha/Desktop/ascent/.claude/worktrees/beam" && npx vitest run packages/ui/src/fx/primitives/beam.test.ts`
Expected: FAIL — cannot resolve `./beam`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/fx/primitives/beam.ts`:

```ts
import { Mesh, MeshGeometry, Shader, type Renderer } from 'pixi.js';
import { BLUR_PARAM_SPECS } from '../blurFilter';
import { FilterStack, filterLabSpecs } from '../filterStack';
import { FILTERS } from '../filterRegistry';
import { ContainerTransform, TRANSFORM_PARAM_SPECS } from '../transformEnvelope';
import type { FxParamSpecs, ParamsOf } from '../params';
import type { FxContext, FxInstance, FxPrimitive } from '../primitive';
import { FX_BLEND_MODES } from '../blendModes';
import { registerPrimitive } from '../registry';
import { acquireShader, linkShader, prewarmShaders, releaseShader } from '../shaderPool';
import { makeBeamBuffers, writeBeamMesh, type BeamMeshBuffers, type BeamShape } from '../beamGeometry';

/**
 * The `beam` primitive: a clean, sustained beam of energy that reaches from a source to a target over
 * `travelMs`, holds for `dwellMs`, then fades over `releaseMs`. The ordered sibling to `lightning`. Geometry
 * is the straight strip from `beamGeometry.ts` (optionally bowed by an animated `waver`); the shader draws a
 * core→tip gradient core with a soft glow and a scrolling flow band, and the travel growth is a single
 * `uReach` uniform gating on `vUV.x` (the along-fraction — no separate "born" attribute needed). The full
 * filter lab wraps the container, so bloom/blur/etc. apply. Defaults are prismatic/neutral so every card tints
 * the beam from the workbench.
 */

const BEAM_VERT = `#version 300 es
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
}`;

const BEAM_FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;

uniform float uReach;      // travel clip: along-fraction (vUV.x) beyond this is not drawn yet
uniform float uAlpha;      // lifecycle brightness (life * flicker envelope)
uniform float uCoreFrac;   // bright-core fraction of the half-width
uniform float uGlow;       // glow-halo strength
uniform float uGain;       // overall intensity
uniform float uEndSoft;    // soft fade length at each end, in along-fraction
uniform float uFlowAmt;    // scrolling flow band strength (0 = off)
uniform float uFlowSpeed;  // flow scroll speed
uniform float uFlowFreq;   // flow bands along the beam
uniform float uFlowDir;    // +1 toward target, -1 toward source
uniform float uTime;       // seconds — drives the flow scroll
uniform vec3  uCore;       // core colour at the source end
uniform vec3  uTip;        // core colour at the target end
uniform vec3  uGlowCol;    // halo colour

const float TAU = 6.28318530718;

void main() {
  if (vUV.x > uReach) discard;                       // not reached yet during travel
  float across = abs(vUV.y * 2.0 - 1.0);             // 0 at the spine, 1 at the edge
  float core = 1.0 - smoothstep(uCoreFrac, min(1.0, uCoreFrac * 2.5 + 0.02), across);
  float halo = pow(1.0 - across, 2.0) * uGlow;

  // Soft end-caps: fade near u=0 and u=1 so the strip's ends aren't hard rectangles.
  float ends = smoothstep(0.0, uEndSoft, vUV.x) * (1.0 - smoothstep(1.0 - uEndSoft, 1.0, vUV.x));

  // Scrolling flow band along the beam — sells a channelled beam; direction is uFlowDir.
  float flow = 1.0;
  if (uFlowAmt > 0.0) {
    float f = 0.5 + 0.5 * sin((vUV.x * uFlowFreq - uTime * uFlowSpeed * uFlowDir) * TAU);
    flow = mix(1.0, f, uFlowAmt);
  }

  vec3 grad = mix(uCore, uTip, clamp(vUV.x, 0.0, 1.0));
  float lum = uGain * uAlpha * ends;
  float coreA = core * lum * flow;
  float haloA = halo * lum;
  float a = coreA + haloA;
  if (a <= 0.002) discard;
  // Premultiplied output (house convention). mesh.blendMode = 'add' gives the additive glow.
  vec3 rgb = grad * coreA + uGlowCol * haloA;
  finalColor = vec4(rgb, min(a, 1.0));
}`;

const SPECS = {
  travelMs: {
    kind: 'slider', label: 'Travel to target', group: 'Lifecycle', min: 0, max: 1500, step: 20, default: 200, axis: 'time',
    help: 'How long the beam takes to reach from source to target (ms). 0 = full-length at once (a hold).',
  },
  dwellMs: {
    kind: 'slider', label: 'Dwell on target', group: 'Lifecycle', min: 0, max: 2000, step: 20, default: 520, axis: 'time',
    help: 'How long the beam stays connected at full length (ms).',
  },
  releaseMs: {
    kind: 'slider', label: 'Release (fade)', group: 'Lifecycle', min: 0, max: 1000, step: 20, default: 200, axis: 'time',
    help: 'How long the beam fades out at the end (ms).',
  },

  width: {
    kind: 'slider', label: 'Glow width', group: 'Shape', min: 2, max: 80, step: 1, default: 18, axis: 'scale',
    help: 'Overall beam width including its glow envelope, in pixels.',
  },
  coreWidth: {
    kind: 'slider', label: 'Core width', group: 'Shape', min: 0.4, max: 12, step: 0.1, default: 3, axis: 'scale',
    help: 'Width of the bright inner core, in pixels — thin against a wide Glow width reads as a hot filament.',
  },
  segments: {
    kind: 'slider', label: 'Segments', group: 'Shape', min: 2, max: 48, step: 1, default: 24,
    help: 'Length subdivisions — more gives a smoother waver bow.',
  },
  waver: {
    kind: 'slider', label: 'Waver (bow)', group: 'Shape', min: 0, max: 1, step: 0.01, default: 0.12,
    help: 'Subtle animated sinusoidal bow, as a fraction of width. 0 = dead straight.',
  },
  waverFreq: {
    kind: 'slider', label: 'Waver cycles', group: 'Shape', min: 0, max: 8, step: 0.1, default: 2.5,
    enabledWhen: { param: 'waver', above: 0 },
    help: 'How many sine cycles the bow has along the beam.',
  },
  waverSpeed: {
    kind: 'slider', label: 'Waver speed', group: 'Shape', min: 0, max: 6, step: 0.1, default: 1.2,
    enabledWhen: { param: 'waver', above: 0 },
    help: 'How fast the bow travels along the beam.',
  },
  endSoftness: {
    kind: 'slider', label: 'End softness', group: 'Shape', min: 0, max: 0.5, step: 0.01, default: 0.12,
    help: 'Soft fade length at each end so the beam does not end in a hard rectangle.',
  },

  flowAmt: {
    kind: 'slider', label: 'Flow strength', group: 'Flow', min: 0, max: 1, step: 0.02, default: 0.35,
    help: 'Strength of the scrolling energy band along the beam. 0 = off (a steady beam).',
  },
  flowSpeed: {
    kind: 'slider', label: 'Flow speed', group: 'Flow', min: 0, max: 6, step: 0.1, default: 1.4,
    enabledWhen: { param: 'flowAmt', above: 0 },
    help: 'How fast the flow band scrolls.',
  },
  flowFreq: {
    kind: 'slider', label: 'Flow bands', group: 'Flow', min: 1, max: 20, step: 1, default: 6,
    enabledWhen: { param: 'flowAmt', above: 0 },
    help: 'How many flow bands run along the beam at once.',
  },
  flowDir: {
    kind: 'enum', label: 'Flow direction', group: 'Flow', options: ['target', 'source'] as const, default: 'target',
    enabledWhen: { param: 'flowAmt', above: 0 },
    help: 'Which way the flow travels: toward the target (cast/heal) or back toward the source (drain).',
  },

  glowStrength: {
    kind: 'slider', label: 'Glow strength', group: 'Glow & colour', min: 0, max: 1, step: 0.02, default: 0.7,
    help: 'Brightness of the soft glow halo around the core.',
  },
  gain: {
    kind: 'slider', label: 'Gain', group: 'Glow & colour', min: 0.2, max: 3, step: 0.05, default: 1, axis: 'intensity',
    help: 'Overall intensity of the whole beam.',
  },
  coreColor: { kind: 'color', label: 'Core color', group: 'Glow & colour', default: 0xf2f6ff, help: 'Colour of the bright core at the source end.' },
  tipColor: { kind: 'color', label: 'Tip color', group: 'Glow & colour', default: 0xdce8ff, help: 'Colour the core fades to at the target end.' },
  glowColor: { kind: 'color', label: 'Glow color', group: 'Glow & colour', default: 0x9fb8ff, help: 'Colour of the surrounding glow halo.' },

  flicker: {
    kind: 'slider', label: 'Flicker (breathing)', group: 'Glow & colour', min: 0, max: 20, step: 1, default: 0,
    help: 'Subtle brightness breathing, in Hz. 0 = a steady beam.',
  },

  blendMode: {
    kind: 'enum', label: 'Blend', group: 'Glow & colour', options: FX_BLEND_MODES, default: 'add',
    help: 'How the beam composites. Add gives the luminous look.',
  },
  ...BLUR_PARAM_SPECS,
  ...filterLabSpecs(FILTERS),
  ...TRANSFORM_PARAM_SPECS,
} satisfies FxParamSpecs;

type BeamParams = ParamsOf<typeof SPECS>;

const BEAM_SHADER_KEY = 'fx-beam';
const TAU = Math.PI * 2;

const rgb3 = (hex: number): Float32Array =>
  new Float32Array([((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]);

/** Bright-core fraction of the half-width, clamped so the core never vanishes or eats the whole envelope. */
const coreFracOf = (p: BeamParams): number => Math.min(0.9, Math.max(0.01, p.coreWidth / Math.max(1, p.width)));
const flowDirOf = (p: BeamParams): number => (p.flowDir === 'source' ? -1 : 1);

function makeBeamShader(): Shader {
  return Shader.from({
    gl: { vertex: BEAM_VERT, fragment: BEAM_FRAG },
    resources: {
      beamUniforms: {
        uReach: { value: 1, type: 'f32' },
        uAlpha: { value: 0, type: 'f32' },
        uCoreFrac: { value: 0.16, type: 'f32' },
        uGlow: { value: 0.7, type: 'f32' },
        uGain: { value: 1, type: 'f32' },
        uEndSoft: { value: 0.12, type: 'f32' },
        uFlowAmt: { value: 0.35, type: 'f32' },
        uFlowSpeed: { value: 1.4, type: 'f32' },
        uFlowFreq: { value: 6, type: 'f32' },
        uFlowDir: { value: 1, type: 'f32' },
        uTime: { value: 0, type: 'f32' },
        uCore: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
        uTip: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' },
        uGlowCol: { value: new Float32Array([0.6, 0.7, 1]), type: 'vec3<f32>' },
      },
    },
  });
}

/** Build + GL-link the beam material at load, so the first beam of a session doesn't pay the compile. */
export function prewarmBeamShaders(renderer: Renderer | null, count = 2): void {
  prewarmShaders(BEAM_SHADER_KEY, count, renderer, makeBeamShader);
}

/** Link the beam program on `renderer` without pooling — for a slot canvas the module pool doesn't serve. */
export function linkBeamShaderOn(renderer: Renderer): Shader {
  const shader = makeBeamShader();
  linkShader(renderer, shader);
  return shader;
}

/** The pool's mandatory acquire reset: write EVERY uniform this shader owns, unconditionally (see ribbon). */
function writeAllUniforms(shader: Shader, p: BeamParams): void {
  const u = (shader.resources.beamUniforms as { uniforms: Record<string, number | Float32Array> }).uniforms;
  u.uReach = p.travelMs > 0 ? 0 : 1; // start un-grown if it travels, full-length if travelMs is 0
  u.uAlpha = 0;
  u.uCoreFrac = coreFracOf(p);
  u.uGlow = p.glowStrength;
  u.uGain = p.gain;
  u.uEndSoft = p.endSoftness;
  u.uFlowAmt = p.flowAmt;
  u.uFlowSpeed = p.flowSpeed;
  u.uFlowFreq = p.flowFreq;
  u.uFlowDir = flowDirOf(p);
  u.uTime = 0;
  u.uCore = rgb3(p.coreColor);
  u.uTip = rgb3(p.tipColor);
  u.uGlowCol = rgb3(p.glowColor);
}

const easeOut = (x: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

class BeamInstance implements FxInstance<BeamParams> {
  private readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly geometry: MeshGeometry;
  private readonly shader: Shader;
  private readonly buffers: BeamMeshBuffers;
  private params: BeamParams;
  private readonly oneShot: boolean;
  private readonly filters: FilterStack;
  private readonly transform: ContainerTransform;

  private clockMs = 0;
  private castStartMs = 0;
  private indexCount = 0;
  private done = false;

  // Anchors, in container space. `aim*` come from setAim (both ends staged); `head*` is the per-frame anchored
  // point (the source fallback if setAim never fires — then the beam has no target and draws nothing).
  private aimSet = false;
  private sx = 0; private sy = 0; private tx = 0; private ty = 0;
  private headX = 0; private headY = 0;
  // Last built anchors + a build flag, so a straight beam rebuilds only when its endpoints move.
  private builtOnce = false;
  private bSx = NaN; private bSy = NaN; private bTx = NaN; private bTy = NaN;

  constructor(ctx: FxContext, params: BeamParams) {
    this.params = params;
    this.oneShot = ctx.oneShot ?? false;
    this.buffers = makeBeamBuffers();
    this.geometry = new MeshGeometry({ positions: this.buffers.position, uvs: this.buffers.uv, indices: this.buffers.index });
    this.shader = acquireShader(BEAM_SHADER_KEY, makeBeamShader, (sh) => writeAllUniforms(sh, params));
    this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    this.mesh.blendMode = params.blendMode;
    this.mesh.visible = false;
    ctx.container.addChild(this.mesh);
    this.filters = new FilterStack(ctx.container, FILTERS);
    this.transform = new ContainerTransform(ctx.container);
  }

  private get uniforms(): Record<string, number | Float32Array> {
    return (this.shader.resources.beamUniforms as { uniforms: Record<string, number | Float32Array> }).uniforms;
  }

  setHead(x: number, y: number): void { this.headX = x; this.headY = y; }
  setAim(sx: number, sy: number, tx: number, ty: number): void {
    this.sx = sx; this.sy = sy; this.tx = tx; this.ty = ty; this.aimSet = true;
  }

  private endpoints(): { sx: number; sy: number; tx: number; ty: number } {
    const sx = this.aimSet ? this.sx : this.headX;
    const sy = this.aimSet ? this.sy : this.headY;
    const tx = this.aimSet ? this.tx : sx; // no aim → zero-length → draws nothing
    const ty = this.aimSet ? this.ty : sy;
    return { sx, sy, tx, ty };
  }

  /** Rebuild the strip from the current anchors + params at `phase`, and re-upload the buffers. */
  private regenerate(phase: number): void {
    const { sx, sy, tx, ty } = this.endpoints();
    const shape: BeamShape = { width: this.params.width, segments: this.params.segments, waver: this.params.waver, waverFreq: this.params.waverFreq };
    const { indexCount } = writeBeamMesh(this.buffers, sx, sy, tx, ty, shape, phase);
    this.indexCount = indexCount;
    this.geometry.getBuffer('aPosition').update();
    this.geometry.getBuffer('aUV').update();
    this.geometry.getIndex().update();
    this.bSx = sx; this.bSy = sy; this.bTx = tx; this.bTy = ty; this.builtOnce = true;
  }

  update(dtMs: number): void {
    this.clockMs += dtMs;
    const p = this.params;
    const T = p.travelMs, D = p.dwellMs, R = p.releaseMs, gap = this.oneShot ? 0 : 300;
    const total = T + D + R + gap;

    let e = this.clockMs - this.castStartMs;
    if (!this.oneShot && total > 0 && e >= total) { this.castStartMs = this.clockMs; e = 0; }

    let reach: number, life: number, live: boolean;
    if (e < T) { reach = easeOut(e / Math.max(1, T)); life = 1; live = true; }
    else if (e < T + D) { reach = 1; life = 1; live = true; }
    else if (e < T + D + R) { reach = 1; life = 1 - (e - (T + D)) / Math.max(1, R); live = true; }
    else { reach = 1; life = 0; live = false; if (this.oneShot) this.done = true; }

    // Rebuild the strip when the anchors moved or the beam wavers (a straight beam builds once per move).
    const phase = this.clockMs / 1000 * p.waverSpeed;
    const { sx, sy, tx, ty } = this.endpoints();
    const moved = sx !== this.bSx || sy !== this.bSy || tx !== this.bTx || ty !== this.bTy;
    if (live && (!this.builtOnce || moved || p.waver > 0)) this.regenerate(phase);

    // Optional subtle brightness breathing.
    const flick = p.flicker > 0 ? 0.8 + 0.2 * (0.5 + 0.5 * Math.sin(this.clockMs / 1000 * p.flicker * TAU)) : 1;
    const bright = life * flick;

    const u = this.uniforms;
    u.uReach = reach;
    u.uAlpha = bright;
    u.uTime = this.clockMs / 1000;

    const prog = total > 0 ? Math.min(1, e / total) : 1;
    this.filters.frame(p, prog, dtMs / 1000);
    this.transform.frame(p, prog, dtMs / 1000, sx, sy);

    this.mesh.visible = bright > 0.003 && this.indexCount > 0;
  }

  isComplete(): boolean { return this.done; }

  setParams(next: BeamParams): void {
    this.params = next;
    const u = this.uniforms;
    u.uCoreFrac = coreFracOf(next);
    u.uGlow = next.glowStrength;
    u.uGain = next.gain;
    u.uEndSoft = next.endSoftness;
    u.uFlowAmt = next.flowAmt;
    u.uFlowSpeed = next.flowSpeed;
    u.uFlowFreq = next.flowFreq;
    u.uFlowDir = flowDirOf(next);
    u.uCore = rgb3(next.coreColor);
    u.uTip = rgb3(next.tipColor);
    u.uGlowCol = rgb3(next.glowColor);
    this.mesh.blendMode = next.blendMode;
    // Width/segments/waver may have changed the geometry — force a rebuild on the next update.
    this.builtOnce = false;
  }

  destroy(): void {
    this.filters.destroy();
    this.mesh.destroy();
    this.geometry.destroy(true);
    releaseShader(BEAM_SHADER_KEY, this.shader);
  }
}

export const beamPrimitive: FxPrimitive<typeof SPECS> = {
  id: 'beam',
  params: SPECS,
  spawn: (ctx, params) => new BeamInstance(ctx, params),
};

registerPrimitive(beamPrimitive as FxPrimitive);
```

- [ ] **Step 4: Run the test + typecheck to verify it passes**

Run: `cd "C:/Users/micha/Desktop/ascent/.claude/worktrees/beam" && npx vitest run packages/ui/src/fx/primitives/beam.test.ts && npm run typecheck:web`
Expected: PASS (3 tests); typecheck clean. (If `validateSpecs` flags a group/axis value, align it to the lightning spec — the `axis`/`group`/`enabledWhen` shapes are copied from there.)

- [ ] **Step 5: Commit**

```bash
cd "C:/Users/micha/Desktop/ascent/.claude/worktrees/beam"
git add packages/ui/src/fx/primitives/beam.ts packages/ui/src/fx/primitives/beam.test.ts
git commit -m "feat(fx): beam primitive — sustained source->target energy beam (pooled shader, filter lab)"
```

---

### Task 3: Register, prewarm-wire, starter def, and fix the registration-breakage tests

Importing `beam` into `primitives/index.ts` registers it globally, which breaks three hand-maintained goldens (`prodPlayback` sorted id list, `prewarm` step counts + mock, `copy` coverage). Fix all of them plus the starter def in one task so the suite ends green.

**Files:**
- Create: `packages/ui/src/fx/defs/beam.json`
- Modify: `packages/ui/src/fx/primitives/index.ts` (import + both prewarm step lists)
- Modify: `packages/ui/src/fx/primitives/prewarm.test.ts` (add `vi.mock('./beam', …)`; two `toBe(5)` → `toBe(6)`)
- Modify: `packages/ui/src/fx/prodPlayback.test.ts` (add `'beam'` to the sorted id list)
- Modify: `packages/ui/src/fx/ui/copy.ts` (add the `beam` copy entry)

**Interfaces:**
- Consumes (Task 2): `beamPrimitive` (self-registers on import), `prewarmBeamShaders`, `linkBeamShaderOn` from `./beam`.
- Produces: nothing new — wiring + goldens only.

- [ ] **Step 1: Create the starter def**

Create `packages/ui/src/fx/defs/beam.json` (mirror `lightning.json`; duration = travel 200 + dwell 520 + release 200 = 920):

```json
{
  "version": 1,
  "id": "beam",
  "duration": 920,
  "layers": [
    {
      "primitive": "beam",
      "anchor": "source",
      "at": 0,
      "life": 920,
      "params": {}
    }
  ]
}
```

- [ ] **Step 2: Wire registration + prewarm into `primitives/index.ts`**

Near the other primitive imports (the `import { linkLightningShaderOn, prewarmLightningShaders } from './lightning';` line ~25 and the `import './lightning';` side-effect line ~28), add:

```ts
import { linkBeamShaderOn, prewarmBeamShaders } from './beam';
```
```ts
import './beam';
```

In `fxPrewarmSteps`, add after the lightning warm:
```ts
    () => prewarmBeamShaders(renderer),
```
In `slotPrewarmSteps`, add after the lightning link:
```ts
    keep(linkBeamShaderOn),
```

- [ ] **Step 3: Run the suite to see exactly what the registration broke**

Run: `cd "C:/Users/micha/Desktop/ascent/.claude/worktrees/beam" && npx vitest run packages/ui/src/fx/prodPlayback.test.ts packages/ui/src/fx/primitives/prewarm.test.ts packages/ui/src/fx/ui/copy.test.ts packages/ui/src/fx/defs.test.ts packages/ui/src/fx/fxDefs.test.ts`
Expected: FAIL in `prodPlayback` (id list missing `'beam'`), `prewarm` (step count 6 ≠ 5, and `./beam` not mocked → real import drags a GL path), and `copy` (`listPrimitives()` has `beam` but `PRIMITIVE_COPY` doesn't). `defs.test.ts`/`fxDefs.test.ts` should PASS (they validate `beam.json` structurally — confirms the starter def is well-formed).

- [ ] **Step 4: Fix `prodPlayback.test.ts`**

In the sorted `listPrimitives().map((p) => p.id)` expectation (~line 106), add `'beam',` as the first element (alphabetical, before `'burst'`):

```ts
    expect(listPrimitives().map((p) => p.id).sort()).toEqual([
      'beam',
      'burst',
      'emitter',
      'lightning',
      'react',
      'ribbon',
      'screen',
      'shockwave',
      'smoke',
    ]);
```

- [ ] **Step 5: Fix `prewarm.test.ts`**

Add the beam mock next to the other primitive mocks (after the `./lightning` mock line):

```ts
vi.mock('./beam', () => ({ prewarmBeamShaders: vi.fn(), linkBeamShaderOn: vi.fn(() => ({ id: 'beam' })) }));
```

Change BOTH `expect(steps.length).toBe(5)` assertions (the `slotPrewarmSteps` one and the `fxPrewarmSteps` one) to `toBe(6)`.

- [ ] **Step 6: Fix `copy.ts`**

Add a `beam` entry to `PRIMITIVE_COPY` (place it alphabetically, before the `burst`/`lightning` entries — order is cosmetic, the label must be unique):

```ts
  beam: {
    label: 'Beam',
    blurb: 'A clean sustained beam from source to target — grows in, holds, fades. Rays, heals, drains, links, channels.',
  },
```

- [ ] **Step 7: Re-run those tests to verify they pass**

Run: `cd "C:/Users/micha/Desktop/ascent/.claude/worktrees/beam" && npx vitest run packages/ui/src/fx/prodPlayback.test.ts packages/ui/src/fx/primitives/prewarm.test.ts packages/ui/src/fx/ui/copy.test.ts`
Expected: PASS.

- [ ] **Step 8: Full gates**

Run: `cd "C:/Users/micha/Desktop/ascent/.claude/worktrees/beam" && npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green. (If any other derived FX test surfaces `beam` — a catalog/ranges `problems==[]` check — resolve it by making the data correct, never by excluding beam.)

- [ ] **Step 9: Commit**

```bash
cd "C:/Users/micha/Desktop/ascent/.claude/worktrees/beam"
git add packages/ui/src/fx/defs/beam.json packages/ui/src/fx/primitives/index.ts packages/ui/src/fx/primitives/prewarm.test.ts packages/ui/src/fx/prodPlayback.test.ts packages/ui/src/fx/ui/copy.ts
git commit -m "feat(fx): register the beam primitive — prewarm wiring, starter def, golden updates"
```

---

## Post-plan: PR

After Task 3 is green, open the PR from the `feat/beam-primitive` worktree (the beam is now authorable in the FX workbench; no card is wired to it yet — wiring a card to a beam def is a separate change, the way lightning shipped before Paragon). This is a presentation-only, new-primitive change — no patch note is required (no gameplay/card/UI-info change ships to players yet); the devlog entry is optional but recommended given the new primitive.

## Self-Review

**1. Spec coverage:** two-point anchoring (Task 2 `setHead`/`setAim`) ✓; phase clock travel/dwell/release, `travelMs=0`=hold (Task 2 `update`) ✓; pooled shader + prewarm/link (Task 2 + Task 3 wiring) ✓; filter lab + transform (Task 2 SPECS spreads + `FilterStack`/`ContainerTransform`) ✓; single-strip geometry, reveal on `uv.u`, no `aBorn`/branches (Task 1) ✓; flow band + direction knob, soft end-caps, waver, core→tip gradient (Task 2 shader + SPECS) ✓; prismatic/neutral locked defaults (Task 2 test) ✓; starter def (Task 3) ✓; the five registration touch-points (Task 2 `registerPrimitive` + Task 3 index/prodPlayback/prewarm/copy) ✓; tests per the spec's Testing section (Tasks 1 & 2) ✓. `endSoftness` — in the spec prose/shader but omitted from the spec's param table — is included here as a Shape param (default 0.12) so the shader's `uEndSoft` has a knob; flagged for the owner.

**2. Placeholder scan:** no TBD/TODO; every code step has complete, runnable code; test code is concrete; Step 8 names the concrete action if a further derived test surfaces beam (fix the data) rather than hand-waving.

**3. Type consistency:** `BeamShape`/`BeamMeshBuffers`/`makeBeamBuffers`/`writeBeamMesh` signatures match between Task 1 (produced) and Task 2 (consumed); `beamPrimitive`/`prewarmBeamShaders`/`linkBeamShaderOn` match between Task 2 (produced) and Task 3 (consumed); default values in the Task 2 SPECS match the Task 2 test's `toMatchObject`; `flowDir` enum uses `as const`; uniform names consistent between `makeBeamShader`, `writeAllUniforms`, `update`, `setParams`, and the fragment source.
