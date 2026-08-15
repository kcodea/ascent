# Custom SVG emit shapes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an FX author upload an SVG in the workshop and use it as a particle emit shape (spawn region) — outline or fill — alongside point/ring/disc/box.

**Architecture:** The SVG is baked at upload time into a normalized `[-1,1]` point cloud stored in the layer's params (so it ships in the def, no DEV-gated art). The pure `emissionOffset` sampler gains an `'svg'` case that picks a baked point and scales/squashes/offsets it like every other shape. A new `'emitpoints'` param kind carries the array through the schema; the Inspector renders the upload + outline/fill toggle + density control and re-bakes on change.

**Tech Stack:** React + the FX engine under `packages/ui/src/fx/**` (`motion.ts` sampler, `params.ts` schema, `primitives/*.ts`, `ui/Inspector.tsx`), browser SVG/canvas APIs for the baker, Vitest.

## Global Constraints

- **Presentation only.** Touch `packages/ui/**` only. No `packages/sim`/`content`/`core`.
- **Ships to prod:** the emit geometry is a baked point array in the def JSON — never a committed `art:` texture (those are DEV-gated).
- **Sampler stays pure & deterministic:** `emissionOffset` takes randoms as args and allocates nothing per spawn; existing shapes must stay bit-identical at their defaults.
- **Density:** default **400** points, range **64–4000**, hard cap **4000**. Fill alpha threshold fixed at **0.5** (not exposed).
- **Gates:** `typecheck` + `lint` + full `npm test` + `build:web` green. Run the FULL `npm test` (the `fx/directCalls.test.ts` guard lives outside `choreo/`).

---

### Task 1: The sampler — `emitShape: 'svg'` in `motion.ts`

**Files:**
- Modify: `packages/ui/src/fx/motion.ts` (`EmitShape`, `EMIT_SHAPES`, `EmissionParams`, `emissionOffset`)
- Test: `packages/ui/src/fx/motion.test.ts` (add cases; create if absent — check first)

**Interfaces:**
- Produces: `EmitShape` gains `'svg'`; `EMIT_SHAPES` gains `'svg'`.
- Produces: `EmissionParams.emitPoints?: readonly (readonly [number, number])[]` — baked, normalized to `[-1,1]`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

In `packages/ui/src/fx/motion.test.ts` (create it if it doesn't exist, importing `emissionOffset` from `./motion`):

```ts
import { describe, expect, it } from 'vitest';
import { emissionOffset } from './motion';

describe('emissionOffset — svg', () => {
  const base = { emitShape: 'svg' as const, emitRadius: 10, squashX: 1, squashY: 1, offsetX: 0, offsetY: 0 };
  it('picks a baked point by randA and scales by emitRadius', () => {
    const out = { ox: 0, oy: 0 };
    // two points; randA=0.6 → floor(0.6*2)=1 → the second point (1, -0.5), scaled by radius 10
    emissionOffset({ ...base, emitPoints: [[-1, 0], [1, -0.5]] }, 0.6, 0.3, out);
    expect(out).toEqual({ ox: 10, oy: -5 });
  });
  it('applies squash and offset like the other shapes', () => {
    const out = { ox: 0, oy: 0 };
    emissionOffset({ ...base, emitPoints: [[1, 1]], squashX: 2, squashY: 0.5, offsetX: 3, offsetY: -4 }, 0, 0, out);
    expect(out).toEqual({ ox: 1 * 10 * 2 + 3, oy: 1 * 10 * 0.5 - 4 });
  });
  it('falls back to the anchor (plus offset) when there are no baked points', () => {
    const out = { ox: 9, oy: 9 };
    emissionOffset({ ...base, emitPoints: [], offsetX: 2, offsetY: 5 }, 0.5, 0.5, out);
    expect(out).toEqual({ ox: 2, oy: 5 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/fx/motion.test.ts`
Expected: FAIL (`'svg'` not assignable / no svg case → falls through to point, wrong result).

- [ ] **Step 3: Implement**

In `motion.ts`:
```ts
export type EmitShape = 'point' | 'ring' | 'disc' | 'box' | 'svg';
export const EMIT_SHAPES = ['point', 'ring', 'disc', 'box', 'svg'] as const;
```
Add to `interface EmissionParams` (below `emitRadius`):
```ts
  /** Baked, normalized ([-1,1]) spawn points for `emitShape: 'svg'`. A random index picks one per spawn. */
  emitPoints?: readonly (readonly [number, number])[];
```
Add a case to the `switch (p.emitShape)` in `emissionOffset`, before `case 'point'`:
```ts
    case 'svg': {
      const pts = p.emitPoints;
      if (pts && pts.length > 0) {
        const pt = pts[Math.min(pts.length - 1, Math.floor(randA * pts.length))]!;
        out.ox = pt[0] * radius * sx + dx;
        out.oy = pt[1] * radius * sy + dy;
        return;
      }
      out.ox = dx; out.oy = dy; // no baked points → the anchor, like `point`
      return;
    }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/ui/src/fx/motion.test.ts`
Expected: PASS. Then `npx vitest run packages/ui/src/fx/` to confirm existing motion/shape tests still pass (existing shapes unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/motion.ts packages/ui/src/fx/motion.test.ts
git commit -m "feat(fx): emissionOffset 'svg' case — sample a baked emit-point cloud"
```

---

### Task 2: The baker — `svgEmit.ts`

**Files:**
- Create: `packages/ui/src/fx/svgEmit.ts`
- Test: `packages/ui/src/fx/svgEmit.test.ts`

**Interfaces:**
- Produces: `svgToEmitPoints(svgText: string, opts: { fill: boolean; count: number }): [number, number][]` — points normalized to `[-1,1]` (aspect-preserved, centered). `[]` on a malformed/zero-area SVG.
- Produces: `EMIT_POINTS_MAX = 4000`, `EMIT_POINTS_DEFAULT = 400`, `EMIT_POINTS_MIN = 64` (exported constants, reused by the schema in Task 3 and the UI in Task 4).

- [ ] **Step 1: Write the failing test (outline + normalization; deterministic)**

Fill needs a real canvas, so the pure unit tests cover the OUTLINE path and normalization. In `svgEmit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { svgToEmitPoints, EMIT_POINTS_MAX } from './svgEmit';

// jsdom provides SVGPathElement.getTotalLength/getPointAtLength as no-ops in some versions; these tests use a
// straight horizontal path and assert only invariants that hold regardless of sampler resolution.
const LINE = '<svg viewBox="0 0 100 50"><path d="M0 25 L100 25"/></svg>';

describe('svgToEmitPoints — outline', () => {
  it('returns `count` points for a valid path', () => {
    const pts = svgToEmitPoints(LINE, { fill: false, count: 200 });
    expect(pts.length).toBe(200);
  });
  it('normalizes into [-1,1], aspect-preserved (a 2:1 viewBox → x spans ~[-1,1], y near 0)', () => {
    const pts = svgToEmitPoints(LINE, { fill: false, count: 100 });
    for (const [x, y] of pts) { expect(Math.abs(x)).toBeLessThanOrEqual(1.0001); expect(Math.abs(y)).toBeLessThanOrEqual(1.0001); }
    expect(Math.max(...pts.map(p => p[0]))).toBeGreaterThan(0.9); // spans the wide axis
    expect(Math.max(...pts.map(p => Math.abs(p[1])))).toBeLessThan(0.3); // thin on the short axis
  });
  it('caps count at EMIT_POINTS_MAX', () => {
    expect(svgToEmitPoints(LINE, { fill: false, count: 99999 }).length).toBeLessThanOrEqual(EMIT_POINTS_MAX);
  });
  it('returns [] for malformed SVG', () => {
    expect(svgToEmitPoints('not an svg', { fill: false, count: 100 })).toEqual([]);
  });
});
```

*(If jsdom's `getPointAtLength` returns all-zeros, guard the test: assert `pts.length` + `[]`-on-malformed only, and verify normalization live in the workshop. Note this in the commit. Do NOT weaken to a tautology — keep the length + malformed assertions, which are environment-independent.)*

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/fx/svgEmit.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `svgEmit.ts`**

```ts
export const EMIT_POINTS_MAX = 4000;
export const EMIT_POINTS_DEFAULT = 400;
export const EMIT_POINTS_MIN = 64;

type Pt = [number, number];

/** Parse an SVG string into an <svg> element, or null if it isn't valid SVG. */
function parseSvg(svgText: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;
  const svg = doc.documentElement;
  return svg instanceof SVGSVGElement ? svg : null;
}

/** Fit raw points (in SVG user units) to [-1,1], aspect-preserved, centered on the bbox. */
function normalize(pts: Pt[]): Pt[] {
  if (pts.length === 0) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const w = maxX - minX, h = maxY - minY;
  const half = Math.max(w, h) / 2;
  if (half <= 0) return []; // zero-area
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  // SVG y grows DOWN; the FX world y also grows down, so no flip — keep the shape as drawn.
  return pts.map(([x, y]) => [(x - cx) / half, (y - cy) / half] as Pt);
}

/** Sample points ALONG every path's outline, distributing `count` across paths by length. */
function sampleOutline(svg: SVGSVGElement, count: number): Pt[] {
  const paths = Array.from(svg.querySelectorAll('path'));
  if (paths.length === 0) return [];
  const lengths = paths.map((p) => { try { return p.getTotalLength(); } catch { return 0; } });
  const total = lengths.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const out: Pt[] = [];
  paths.forEach((path, i) => {
    const n = Math.max(1, Math.round((lengths[i]! / total) * count));
    for (let s = 0; s < n; s++) {
      const pt = path.getPointAtLength((s / n) * lengths[i]!);
      out.push([pt.x, pt.y]);
    }
  });
  return out;
}

/** Sample points INSIDE the filled silhouette by rasterizing to a canvas and rejection-sampling the alpha. */
function sampleFill(svgText: string, svg: SVGSVGElement, count: number): Pt[] {
  const vb = svg.viewBox.baseVal;
  const W = vb && vb.width ? vb.width : (svg.width.baseVal.value || 256);
  const H = vb && vb.height ? vb.height : (svg.height.baseVal.value || 256);
  const RES = 256; // raster resolution; enough for an emit mask
  const scale = RES / Math.max(W, H);
  const cw = Math.max(1, Math.round(W * scale)), ch = Math.max(1, Math.round(H * scale));
  const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d'); if (!ctx) return [];
  const img = new Image();
  // The workshop bakes synchronously on user action; draw via a data URL. If decode is async in the host,
  // the caller (Task 4) awaits an async variant — but here we keep it sync-friendly for the common path and
  // return [] if the image isn't ready, letting the UI retry. (See Task 4 note.)
  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
  if (!img.complete || img.naturalWidth === 0) return [];
  ctx.drawImage(img, 0, 0, cw, ch);
  const data = ctx.getImageData(0, 0, cw, ch).data;
  const out: Pt[] = [];
  let tries = 0; const maxTries = count * 40;
  // Deterministic-ish LCG so a given (svg,count) reproduces; seeded from dimensions.
  let seed = (cw * 73856093) ^ (ch * 19349663) ^ count; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  while (out.length < count && tries++ < maxTries) {
    const px = Math.floor(rnd() * cw), py = Math.floor(rnd() * ch);
    if (data[(py * cw + px) * 4 + 3]! / 255 > 0.5) out.push([px / scale, py / scale]);
  }
  return out;
}

export function svgToEmitPoints(svgText: string, opts: { fill: boolean; count: number }): Pt[] {
  const count = Math.max(EMIT_POINTS_MIN, Math.min(EMIT_POINTS_MAX, Math.floor(opts.count) || EMIT_POINTS_DEFAULT));
  const svg = parseSvg(svgText);
  if (!svg) return [];
  const raw = opts.fill ? sampleFill(svgText, svg, count) : sampleOutline(svg, count);
  return normalize(raw);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/ui/src/fx/svgEmit.test.ts`
Expected: PASS (length + cap + malformed; normalization if jsdom supports `getPointAtLength`, else per the guard note).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/svgEmit.ts packages/ui/src/fx/svgEmit.test.ts
git commit -m "feat(fx): svgToEmitPoints — bake an SVG into a normalized emit-point cloud (outline/fill)"
```

---

### Task 3: Param schema — the `'emitpoints'` kind + the three primitives

**Files:**
- Modify: `packages/ui/src/fx/params.ts` (`FxParamSpec` union, `ParamsOf`, `defaultsOf`, `coerceParams`)
- Modify: `packages/ui/src/fx/primitives/burst.ts`, `smoke.ts`, `emitter.ts` (declare `emitPoints`, `emitFill`, `emitDensity` in each spec)
- Test: `packages/ui/src/fx/params.test.ts` (add cases; and a round-trip via one primitive's `coerceParams`)

**Interfaces:**
- Consumes: `EMIT_POINTS_MAX/DEFAULT/MIN` from `./svgEmit` (Task 2); `EMIT_SHAPES` already includes `'svg'` (Task 1).
- Produces: param kind `{ kind: 'emitpoints'; default: readonly (readonly [number,number])[] }`; params `emitPoints` (emitpoints), `emitFill` (toggle), `emitDensity` (slider) on burst/smoke/emitter, each `enabledWhen: { param: 'emitShape', is: 'svg' }` (verify the exact `enabledWhen` shape used by neighbours — the existing `emitRadius` uses `{ param: 'emitShape', not: 'point' }`, so `is` may need adding to `isParamEnabled`; if only `not` exists, gate with `not`-based logic or extend `isParamEnabled` to support `is`).

- [ ] **Step 1: Write the failing test**

In `params.test.ts`:
```ts
import { coerceParams } from './params';
import { PARAMS as BURST_PARAMS } from './primitives/burst'; // adjust to the actual exported spec name
// (grep burst.ts for the exported FxParamSpecs object — likely `PARAMS` or `SPEC`.)

it('round-trips emitPoints, clamped to [-1,1] and capped', () => {
  const raw = { emitShape: 'svg', emitPoints: [[0.5, -0.5], [2, -3], 'bad', [0.1]] };
  const out = coerceParams(BURST_PARAMS, raw) as any;
  expect(out.emitShape).toBe('svg');
  // valid pairs kept + clamped; malformed entries dropped
  expect(out.emitPoints).toEqual([[0.5, -0.5], [1, -1]]);
});
it('emitFill and emitDensity default correctly', () => {
  const out = coerceParams(BURST_PARAMS, { emitShape: 'svg' }) as any;
  expect(out.emitFill).toBe(false);
  expect(out.emitDensity).toBe(400);
  expect(out.emitPoints).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/fx/params.test.ts` → FAIL (kind unknown / params undeclared).

- [ ] **Step 3: Implement**

In `params.ts`:
- Add to the `FxParamSpec` union: `| { kind: 'emitpoints'; label: string; group?: string; help?: string; default: readonly (readonly [number, number])[] }`.
- In `ParamsOf`, map it to `readonly (readonly [number, number])[]` (follow the palette/curve conditional-type pattern).
- In `defaultsOf`, add `else if (spec.kind === 'emitpoints') out[key] = spec.default.map((p) => [p[0], p[1]]);`.
- In `coerceParams`, add a case:
```ts
      case 'emitpoints': {
        const arr = Array.isArray(v) ? v : [];
        const pts: [number, number][] = [];
        for (const e of arr) {
          if (Array.isArray(e) && e.length === 2 && typeof e[0] === 'number' && typeof e[1] === 'number' && Number.isFinite(e[0]) && Number.isFinite(e[1])) {
            pts.push([Math.max(-1, Math.min(1, e[0])), Math.max(-1, Math.min(1, e[1]))]);
          }
          if (pts.length >= 4000) break; // EMIT_POINTS_MAX
        }
        out[key] = pts;
        break;
      }
```
- If `isParamEnabled` supports only `not`, add an `is` branch (mirror the `not` handling) so `enabledWhen: { param: 'emitShape', is: 'svg' }` works.

In each of `burst.ts`, `smoke.ts`, `emitter.ts` param specs, next to `emitRadius`, add:
```ts
  emitFill: { kind: 'toggle', label: 'SVG fill', group: 'Physics', default: false, enabledWhen: { param: 'emitShape', is: 'svg' } },
  emitDensity: { kind: 'slider', label: 'SVG density', group: 'Physics', min: 64, max: 4000, step: 1, default: 400, enabledWhen: { param: 'emitShape', is: 'svg' } },
  emitPoints: { kind: 'emitpoints', label: 'SVG shape', group: 'Physics', default: [], enabledWhen: { param: 'emitShape', is: 'svg' } },
```
(Match each file's existing spec formatting and `group` name — grep each for `emitRadius:` to place these beside it.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/ui/src/fx/params.test.ts && npx vitest run packages/ui/src/fx/` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/params.ts packages/ui/src/fx/primitives/burst.ts packages/ui/src/fx/primitives/smoke.ts packages/ui/src/fx/primitives/emitter.ts packages/ui/src/fx/params.test.ts
git commit -m "feat(fx): 'emitpoints' param kind + emitFill/emitDensity/emitPoints on the emitters"
```

---

### Task 4: Inspector control — upload, toggle, density, re-bake

**Files:**
- Modify: `packages/ui/src/fx/ui/Inspector.tsx` (render the `'emitpoints'` kind)
- Modify: `packages/ui/src/styles.css` (or the workbench CSS the Inspector uses) — minimal styling to match sibling controls
- (No new unit test — this is DOM/canvas/file I/O; verified live by Mike.)

**Interfaces:**
- Consumes: `svgToEmitPoints`, `EMIT_POINTS_*` (Task 2); the `'emitpoints'` param kind (Task 3); the Inspector's existing `spec.kind === '…'` render switch and its `change(key, value)` handler.

- [ ] **Step 1: Add the `'emitpoints'` render branch**

In `Inspector.tsx`, alongside the other `{spec.kind === '…' && (…)}` branches, add a control that:
- shows an **Upload SVG** file input (`accept=".svg,image/svg+xml"`);
- on file pick, reads the text (`await file.text()`), stores it in `localStorage` under a per-layer key (e.g. `fx.emitsvg.<layerId-or-slug>`), bakes `svgToEmitPoints(text, { fill: values.emitFill, count: values.emitDensity })`, and calls `change('emitPoints', pts)`;
- shows the current point count (`values.emitPoints.length` — "400 pts") or "no SVG";
- **re-bakes** when the sibling `emitFill`/`emitDensity` change: read the stored SVG text from `localStorage`; if present, re-run the baker and `change('emitPoints', …)`; if absent, show "re-upload to change fill/density".

The `emitFill` (toggle) and `emitDensity` (slider) render through their own existing kinds — this control only owns the upload + point-count readout + the re-bake wiring. Keep the fill toggle re-bake wiring here so the three read as one panel.

Concrete skeleton (adapt to the Inspector's existing prop/handler names — `spec`, `value`, `values`, `change`/`onChange`):
```tsx
{spec.kind === 'emitpoints' && (() => {
  const svgKey = `fx.emitsvg.${layerId}`; // layerId available in the row scope; else derive a stable per-row key
  const bake = (text: string) => {
    const pts = svgToEmitPoints(text, { fill: !!values.emitFill, count: Number(values.emitDensity) || EMIT_POINTS_DEFAULT });
    change('emitPoints', pts);
  };
  return (
    <div className="fxwb-emitsvg">
      <label className="fxwb-shape-import">
        Upload SVG…
        <input type="file" accept=".svg,image/svg+xml" onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          const text = await f.text();
          try { localStorage.setItem(svgKey, text); } catch { /* ignore quota */ }
          bake(text);
        }} />
      </label>
      <span className="fxwb-emitsvg-count">
        {Array.isArray(value) && value.length > 0 ? `${value.length} pts` : 'no SVG'}
      </span>
    </div>
  );
})()}
```
And where `emitFill`/`emitDensity` changes are handled, after writing the value, if `localStorage.getItem(svgKey)` exists, re-bake. (Simplest: a small `useEffect` keyed on `[values.emitFill, values.emitDensity]` inside the emitpoints control that re-bakes from the stored SVG when it changes and an SVG is present.)

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint` → clean.

- [ ] **Step 3: Live verify (Mike)**

In the workshop: add a burst layer, set **Emit shape = SVG**, Upload an SVG. Confirm particles spawn along the outline; flip **SVG fill** → particles fill the silhouette; move **density** → point count changes; `emitRadius`/`squash`/`offset` scale/reshape/move the shape. Save, reload, confirm the emit shape persists (points in the def) and toggling fill still works (SVG restored from localStorage). Cast in a real context to confirm it renders in the app (not just the workshop preview).

- [ ] **Step 4: Full gates + commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web` → all green.
```bash
git add packages/ui/src/fx/ui/Inspector.tsx packages/ui/src/styles.css
git commit -m "feat(fx): workshop control for SVG emit shapes — upload, outline/fill toggle, density"
```

- [ ] **Step 5: Docs**

Prepend a `docs/devlog.md` entry (the feature, why baked-not-textured for prod-portability, how verified), add a line to `docs/roadmap.md` if a related item exists, refresh the README "Recent changes". Commit.

---

## Notes for the executor

- **Exact spec export names vary** — grep each primitive for `emitRadius:` and the exported `FxParamSpecs` object name before editing; match the file's formatting.
- **The fill baker needs a live canvas** — its correctness is a workshop live-check, not a unit test. Don't fake a canvas test that asserts nothing.
- **`enabledWhen`** — confirm whether the codebase's `isParamEnabled` supports `is:` (the neighbours use `not:`); extend it if not, rather than contorting the gate.
- **Never store the raw SVG in the committed def** — only `emitPoints`/`emitFill`/`emitDensity`. The SVG lives in `localStorage` for re-baking during authoring.
