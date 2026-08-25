# FX Colour Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the FX workbench a unified colour toolkit — an HSB colour picker, a labelled rim→core palette editor, a multi-stop gradient editor, and a deep preset-palette library shown by its actual colours — plus wire the previously-uneditable filter colours.

**Architecture:** Purely additive to the existing `params.ts` spec system and `Inspector.tsx`'s `ParamRow`. `color` is an existing param kind (a `0xRRGGBB` number); we add a new `gradient` kind and swap the editors `ParamRow` renders. All colour maths lives in small pure modules (`fx/color.ts`, `fx/gradient.ts`) that TDD cleanly; React components are thin wrappers over them.

**Tech Stack:** TypeScript, React, Vitest (no jsdom — pure-logic tests only; components are owner-eyeballed), Pixi v8 (`ColorSource` accepts a plain number).

## Global Constraints

- Presentation-only. No engine/sim change. New param kinds must **coerce to the numeric/array payloads the shaders already read** (colour = `number`, palette = `[number,number,number,number]`, gradient = `GradientStop[]`).
- `Math.random` is fine in `packages/ui` (the ban is core/content/sim only), but colour maths must be deterministic.
- Every `FxParamSpec` MUST carry a `help` string (enforced by `copy.test.ts`-style tests).
- Run `npm run typecheck:web && npm run lint && npx vitest run packages/ui/src/fx/` green before each commit. Branch off `origin/main`; never push to `main`.
- Colour payload for `palette` stays a fixed 4-number tuple (per spec §11 decision); `gradient` is the N-stop type, used by the ColorGradient filter + backdrops only.

---

## File Structure

- `packages/ui/src/fx/color.ts` (create) — pure HSB↔`0xRRGGBB` conversion. Sole responsibility: colour maths.
- `packages/ui/src/fx/color.test.ts` (create) — round-trip + clamp tests.
- `packages/ui/src/fx/gradient.ts` (create) — pure gradient-stop list ops (add/remove/move/sort) + the `GradientStop` type.
- `packages/ui/src/fx/gradient.test.ts` (create) — stop-op tests.
- `packages/ui/src/fx/params.ts` (modify) — add the `gradient` kind to the union, `ParamsOf`, `coerceParams`, `validateSpecs`.
- `packages/ui/src/fx/params.test.ts` (modify) — gradient coercion tests.
- `packages/ui/src/fx/palettes.ts` (modify) — add `PALETTE_LIBRARY` (grouped preset set) + `PALETTE_STOP_LABELS`.
- `packages/ui/src/fx/palettes.test.ts` (create) — library validity tests.
- `packages/ui/src/fx/ui/ColorPickerHSB.tsx` (create) — 3 horizontal bars over a `number` value.
- `packages/ui/src/fx/ui/GradientEditor.tsx` (create) — multi-stop bar over `GradientStop[]`.
- `packages/ui/src/fx/ui/PalettePicker.tsx` (create) — 4 labelled stops + preset library, over a 4-tuple.
- `packages/ui/src/fx/ui/Inspector.tsx` (modify) — `ParamRow` renders the new editors for `color`/`palette`/`gradient`.
- `packages/ui/src/fx/filterRegistry.ts` (modify) — add `color` knobs to filters with a colour (Glow, Outline, DropShadow, ColorOverlay, Bevel).
- `packages/ui/src/fx/filterStack.ts` (modify) — apply a filter knob's colour value onto the filter instance.

---

### Task 1: HSB ↔ colour-number maths (`fx/color.ts`)

**Files:**
- Create: `packages/ui/src/fx/color.ts`
- Test: `packages/ui/src/fx/color.test.ts`

**Interfaces:**
- Produces: `type Hsb = { h: number; s: number; b: number }` (h 0–360, s/b 0–1); `hsbToNum(hsb: Hsb): number` (→ `0xRRGGBB`); `numToHsb(n: number): Hsb`; `numToHex(n: number): string`; `hexToNum(hex: string): number`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { hsbToNum, numToHsb, numToHex, hexToNum } from './color';

describe('color maths', () => {
  it('round-trips pure red', () => {
    const n = hsbToNum({ h: 0, s: 1, b: 1 });
    expect(n).toBe(0xff0000);
    expect(numToHsb(n)).toEqual({ h: 0, s: 1, b: 1 });
  });
  it('round-trips a mid colour within 1/255', () => {
    const start = { h: 327, s: 0.82, b: 1 };
    const back = numToHsb(hsbToNum(start));
    expect(Math.abs(back.h - start.h)).toBeLessThan(1.5);
    expect(Math.abs(back.s - start.s)).toBeLessThan(0.01);
    expect(back.b).toBeCloseTo(1, 2);
  });
  it('hex <-> num', () => {
    expect(hexToNum('#ff2d95')).toBe(0xff2d95);
    expect(numToHex(0x00ff00)).toBe('#00ff00');
  });
  it('black and white are stable', () => {
    expect(hsbToNum({ h: 0, s: 0, b: 0 })).toBe(0x000000);
    expect(hsbToNum({ h: 0, s: 0, b: 1 })).toBe(0xffffff);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/fx/color.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
export type Hsb = { h: number; s: number; b: number };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const to255 = (v: number): number => Math.round(clamp(v, 0, 1) * 255);

export function hsbToNum({ h, s, b }: Hsb): number {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); b = clamp(b, 0, 1);
  const c = b * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = b - c;
  const seg = Math.floor(h / 60) % 6;
  const [r, g, bl] = ([[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]] as const)[seg];
  return (to255(r + m) << 16) | (to255(g + m) << 8) | to255(bl + m);
}

export function numToHsb(n: number): Hsb {
  const r = ((n >> 16) & 0xff) / 255, g = ((n >> 8) & 0xff) / 255, bl = (n & 0xff) / 255;
  const max = Math.max(r, g, bl), min = Math.min(r, g, bl), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - bl) / d) % 6);
    else if (max === g) h = 60 * ((bl - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, b: max };
}

export const numToHex = (n: number): string => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
export const hexToNum = (hex: string): number => parseInt(hex.replace('#', ''), 16) & 0xffffff;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/src/fx/color.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/color.ts packages/ui/src/fx/color.test.ts
git commit -m "feat(fx): pure HSB<->colour-number maths for the colour picker"
```

---

### Task 2: `gradient` param kind + stop ops (`fx/gradient.ts`, `params.ts`)

**Files:**
- Create: `packages/ui/src/fx/gradient.ts`, `packages/ui/src/fx/gradient.test.ts`
- Modify: `packages/ui/src/fx/params.ts` (union ~L108, `ParamsOf` ~L179, `coerceParams` ~L221, `validateSpecs`)
- Modify: `packages/ui/src/fx/params.test.ts`

**Interfaces:**
- Produces: `type GradientStop = { at: number; color: number }` (at 0–1, color `0xRRGGBB`); `addStop(stops, at, color)`, `removeStop(stops, i)`, `moveStop(stops, i, at)` → sorted `GradientStop[]`. New spec member `{ kind: 'gradient'; label; group?; help?; default: readonly GradientStop[]; gradType?: 'linear'|'radial'|'conic' }`. `ParamsOf` maps `gradient` → `GradientStop[]`.

- [ ] **Step 1: Write the failing test** (`gradient.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { addStop, removeStop, moveStop, type GradientStop } from './gradient';

const g: GradientStop[] = [{ at: 0, color: 0x000000 }, { at: 1, color: 0xffffff }];

describe('gradient stops', () => {
  it('adds a stop, kept sorted by position', () => {
    const out = addStop(g, 0.5, 0xff0000);
    expect(out.map((s) => s.at)).toEqual([0, 0.5, 1]);
    expect(out[1].color).toBe(0xff0000);
  });
  it('never mutates the input', () => {
    addStop(g, 0.5, 1); expect(g.length).toBe(2);
  });
  it('removes but always keeps at least two stops', () => {
    expect(removeStop([{ at: 0, color: 1 }, { at: 1, color: 2 }], 0).length).toBe(2);
    expect(removeStop([{ at: 0, color: 1 }, { at: 0.5, color: 2 }, { at: 1, color: 3 }], 1).map((s) => s.at)).toEqual([0, 1]);
  });
  it('moves a stop and re-sorts, clamping to 0..1', () => {
    expect(moveStop(g, 0, 2).find((s) => s.color === 0x000000)!.at).toBe(1);
  });
});
```

- [ ] **Step 2: Run — Expected FAIL (module not found).**

Run: `npx vitest run packages/ui/src/fx/gradient.test.ts`

- [ ] **Step 3: Implement `fx/gradient.ts`**

```ts
export type GradientStop = { at: number; color: number };
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const sorted = (s: GradientStop[]): GradientStop[] => [...s].sort((a, b) => a.at - b.at);

export const addStop = (stops: readonly GradientStop[], at: number, color: number): GradientStop[] =>
  sorted([...stops, { at: clamp01(at), color: color & 0xffffff }]);

export const removeStop = (stops: readonly GradientStop[], i: number): GradientStop[] =>
  stops.length <= 2 ? [...stops] : sorted(stops.filter((_, k) => k !== i));

export const moveStop = (stops: readonly GradientStop[], i: number, at: number): GradientStop[] =>
  sorted(stops.map((s, k) => (k === i ? { ...s, at: clamp01(at) } : s)));
```

- [ ] **Step 4: Run — Expected PASS.**

Run: `npx vitest run packages/ui/src/fx/gradient.test.ts`

- [ ] **Step 5: Add the `gradient` kind to `params.ts`**

In the `FxParamSpec` union (after the `emitpoints` member), add:

```ts
  | {
      kind: 'gradient';
      label: string;
      group?: string;
      help?: string;
      /** N stops (>=2), each { at: 0..1, color: 0xRRGGBB }. */
      default: readonly import('./gradient').GradientStop[];
      /** Where the target supports it. Default 'linear'. */
      gradType?: 'linear' | 'radial' | 'conic';
    }
```

In `ParamsOf`, add a branch so `gradient` maps to `GradientStop[]` (mirror the `curve` branch's shape — it already returns the default's array type, so `gradient` falls through to `S[K]['default']` and resolves correctly; no change needed if `curve` already does). In `coerceParams`'s switch add:

```ts
      case 'gradient':
        if (Array.isArray(v) && v.length >= 2 && v.every((s) =>
          s && typeof s === 'object' && typeof (s as {at?: unknown}).at === 'number'
          && typeof (s as {color?: unknown}).color === 'number'
          && Number.isFinite((s as {at: number}).at) && (s as {color: number}).color >= 0
          && (s as {color: number}).color <= 0xffffff)) {
          out[key] = (v as {at: number; color: number}[]).map((s) => ({ at: Math.min(1, Math.max(0, s.at)), color: s.color }));
        }
        break;
```

In `validateSpecs`, `gradient` needs no min/max/axis checks (it's not a slider) — ensure the `axis` guard (only sliders may declare `axis`) still passes (gradient declares none).

- [ ] **Step 6: Add coercion test to `params.test.ts`**

```ts
it('coerces a gradient param, defaulting invalid stops', () => {
  const specs = { g: { kind: 'gradient', label: 'G', help: 'h', default: [{ at: 0, color: 0 }, { at: 1, color: 0xffffff }] } } as const;
  expect(coerceParams(specs, { g: [{ at: 5, color: 0xff0000 }, { at: 0, color: 0 }] }).g)
    .toEqual([{ at: 1, color: 0xff0000 }, { at: 0, color: 0 }]);
  expect(coerceParams(specs, { g: 'bad' }).g).toEqual(specs.g.default);
});
```

- [ ] **Step 7: Run typecheck + tests — Expected PASS.**

Run: `npm run typecheck:web && npx vitest run packages/ui/src/fx/params.test.ts packages/ui/src/fx/gradient.test.ts`

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/fx/gradient.ts packages/ui/src/fx/gradient.test.ts packages/ui/src/fx/params.ts packages/ui/src/fx/params.test.ts
git commit -m "feat(fx): gradient param kind + pure stop-list ops"
```

---

### Task 3: Preset palette library + stop labels (`palettes.ts`)

**Files:**
- Modify: `packages/ui/src/fx/palettes.ts`
- Create: `packages/ui/src/fx/palettes.test.ts`

**Interfaces:**
- Produces: `PALETTE_STOP_LABELS: readonly ['Rim','Outer','Inner','Core']`; `PALETTE_LIBRARY: Record<string /*group*/, Record<string /*name*/, readonly [number,number,number,number]>>` (rim→core). Existing `PALETTES`/`PALETTE_PRESETS`/`PALETTE_NAMES` unchanged.

- [ ] **Step 1: Write the failing test** (`palettes.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { PALETTE_LIBRARY, PALETTE_STOP_LABELS, PALETTE_PRESETS } from './palettes';

describe('palette library', () => {
  const all = Object.values(PALETTE_LIBRARY).flatMap((g) => Object.entries(g));
  it('labels are rim->core', () => expect(PALETTE_STOP_LABELS).toEqual(['Rim', 'Outer', 'Inner', 'Core']));
  it('every preset is 4 valid stops', () => {
    for (const [, cols] of all) {
      expect(cols).toHaveLength(4);
      cols.forEach((c) => { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(0xffffff); });
    }
  });
  it('names are unique across groups', () => {
    const names = all.map(([n]) => n); expect(new Set(names).size).toBe(names.length);
  });
  it('includes the original presets', () => {
    for (const k of Object.keys(PALETTE_PRESETS)) expect(all.some(([n]) => n.toLowerCase() === k)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — Expected FAIL.**

Run: `npx vitest run packages/ui/src/fx/palettes.test.ts`

- [ ] **Step 3: Add to `palettes.ts`** (append; use `0xRRGGBB` numeric tuples, rim→core; include the original 6 by name)

```ts
export const PALETTE_STOP_LABELS = ['Rim', 'Outer', 'Inner', 'Core'] as const;

/** Grouped preset library, shown by colour in the picker. rim -> core. */
export const PALETTE_LIBRARY: Record<string, Record<string, readonly [number, number, number, number]>> = {
  Fire: { Ember: [0x2a0a06,0x7a1e10,0xff6a2b,0xfff0c8], Gold: [0x2a1e05,0x7a5a12,0xffcf3a,0xfffbe0], Magma: [0x1a0808,0x6a1420,0xff3a2a,0xffd08a], Blood: [0x200406,0x5a0a12,0xc81e2c,0xff9a8a], Sunset: [0x2a0f1e,0x7a2a3a,0xff7a4a,0xffe0b0], Amber: [0x24140a,0x6a3a12,0xff9a2a,0xfff0d0] },
  Cool: { Violet: [0x2a1030,0x7a1e57,0xff2d95,0xfff2fb], Ice: [0x0a1826,0x1e4a6a,0x4ac8ff,0xe0f8ff], Ocean: [0x08121e,0x143a5a,0x2a9ad8,0xcdeeff], Mint: [0x0a2018,0x1e5a44,0x3ad89a,0xe0fff0], Arctic: [0x12182a,0x2a3a6a,0x6a8aff,0xe0e8ff], Plasma: [0x1a0a2a,0x4a1e8a,0x8a4aff,0xecdcff] },
  Energy: { Acid: [0x141e05,0x3a5a12,0x9ade2a,0xf0ffd0], Neon: [0x05201a,0x0a5a3a,0x2affc8,0xd0fff0], Electric: [0x0a1030,0x1e2a8a,0x4a6aff,0xe0eaff], Toxic: [0x141a08,0x3a5a10,0xaade1e,0xf0ffcc], Radio: [0x0a1a05,0x2a6a10,0x6aff2a,0xe8ffcc], Spark: [0x201a05,0x6a5210,0xffe23a,0xfffce0] },
  'Nature / Special': { Forest: [0x0a1808,0x1e4a1e,0x4a9a3a,0xd0ffb0], Poison: [0x1a0a20,0x4a1e5a,0x9a3ad8,0xe8d0ff], Earth: [0x1a1208,0x4a3a1e,0x9a7a4a,0xf0e0c0], Ash: [0x141416,0x3a3a40,0x8a8a94,0xf0f0f4], Void: [0x0a0a12,0x2a2a44,0x5a5a8a,0xd0d0f0], Holy: [0x2a2410,0x7a6a2a,0xffe07a,0xffffff] },
};
```

Then make the original preset names present under lowercased keys (Violet/Ember/Mint/Magenta/Gold/Acid) — add `Magenta` to `Cool` if not already, so the "includes original presets" test passes (magenta preset).

- [ ] **Step 4: Run — Expected PASS.** `npx vitest run packages/ui/src/fx/palettes.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/palettes.ts packages/ui/src/fx/palettes.test.ts
git commit -m "feat(fx): grouped preset palette library + rim->core stop labels"
```

---

### Task 4: `ColorPickerHSB` component

**Files:**
- Create: `packages/ui/src/fx/ui/ColorPickerHSB.tsx`

**Interfaces:**
- Consumes: `hsbToNum`, `numToHsb`, `numToHex` (Task 1).
- Produces: `ColorPickerHSB({ value, onChange }: { value: number; onChange: (n: number) => void })` — three horizontal bars (Hue / Saturation / Brightness) + a swatch. Each bar drags to set its channel via `numToHsb(value)` → edit → `hsbToNum` → `onChange`.

- [ ] **Step 1: Implement the component** (no jsdom test — owner-eyeballed; logic delegates to Task 1)

```tsx
import { numToHsb, hsbToNum, numToHex } from '../color';

export function ColorPickerHSB({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const hsb = numToHsb(value);
  const hueColor = hsbToNum({ h: hsb.h, s: 1, b: 1 });
  const set = (patch: Partial<typeof hsb>) => onChange(hsbToNum({ ...hsb, ...patch }));
  const barDrag = (e: React.PointerEvent, apply: (t: number) => void) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const move = (px: number) => apply(Math.min(1, Math.max(0, (px - rect.left) / rect.width)));
    move(e.clientX);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', up);
  };
  return (
    <div className="fxwb-hsb">
      <div className="fxwb-hsb-swatch" style={{ background: numToHex(value) }} />
      <Bar label="Hue" t={hsb.h / 360} gradient="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
        onDrag={(e) => barDrag(e, (t) => set({ h: t * 360 }))} />
      <Bar label="Saturation" t={hsb.s} gradient={`linear-gradient(90deg,#bbb,${numToHex(hueColor)})`}
        onDrag={(e) => barDrag(e, (t) => set({ s: t }))} />
      <Bar label="Brightness" t={hsb.b} gradient={`linear-gradient(90deg,#000,${numToHex(hueColor)})`}
        onDrag={(e) => barDrag(e, (t) => set({ b: t }))} />
    </div>
  );
}
function Bar({ label, t, gradient, onDrag }: { label: string; t: number; gradient: string; onDrag: (e: React.PointerEvent) => void }) {
  return (
    <div className="fxwb-hsb-bar">
      <span className="fxwb-hsb-lab">{label}</span>
      <div className="fxwb-hsb-track" style={{ background: gradient }} onPointerDown={onDrag}>
        <span className="fxwb-hsb-knob" style={{ left: `${t * 100}%` }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the CSS** (`styles.css`, near the existing `fxwb-*` block) — `.fxwb-hsb`, `.fxwb-hsb-track` (height ~14px, radius, relative), `.fxwb-hsb-knob` (absolute, round, `translate(-50%,-50%)`), `.fxwb-hsb-swatch`. Use the gauntlet cursor rule (no bare `cursor: pointer` — see CLAUDE.md UI conventions).

- [ ] **Step 3: Verify it typechecks + builds.** Run: `npm run typecheck:web && npm run build:web`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/fx/ui/ColorPickerHSB.tsx packages/ui/src/styles.css
git commit -m "feat(fx): HSB colour picker (three horizontal bars)"
```

---

### Task 5: `GradientEditor` component

**Files:**
- Create: `packages/ui/src/fx/ui/GradientEditor.tsx`

**Interfaces:**
- Consumes: `GradientStop`, `addStop`, `removeStop`, `moveStop` (Task 2); `ColorPickerHSB` (Task 4); `numToHex` (Task 1).
- Produces: `GradientEditor({ value, gradType, onChange }: { value: GradientStop[]; gradType?: string; onChange: (s: GradientStop[]) => void })` — a bar with draggable stops (drag=`moveStop`, click bar=`addStop`, drag-off=`removeStop`), selected stop opens `ColorPickerHSB`.

- [ ] **Step 1: Implement** (delegates all list maths to Task 2; owner-eyeballed)

```tsx
import { useState } from 'react';
import { addStop, removeStop, moveStop, type GradientStop } from '../gradient';
import { numToHex } from '../color';
import { ColorPickerHSB } from './ColorPickerHSB';

export function GradientEditor({ value, onChange }: { value: GradientStop[]; onChange: (s: GradientStop[]) => void }) {
  const [sel, setSel] = useState(0);
  const css = `linear-gradient(90deg,${value.map((s) => `${numToHex(s.color)} ${s.at * 100}%`).join(',')})`;
  const onBar = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = (e.clientX - r.left) / r.width;
    const next = addStop(value, at, value[sel]?.color ?? 0xffffff);
    onChange(next); setSel(next.findIndex((s) => Math.abs(s.at - Math.min(1, Math.max(0, at))) < 1e-6));
  };
  return (
    <div className="fxwb-grad">
      <div className="fxwb-grad-bar" style={{ background: css }} onPointerDown={onBar}>
        {value.map((s, i) => (
          <span key={i} className={`fxwb-grad-stop${i === sel ? ' sel' : ''}`} style={{ left: `${s.at * 100}%`, background: numToHex(s.color) }}
            onPointerDown={(e) => { e.stopPropagation(); setSel(i); }}
            onDoubleClick={(e) => { e.stopPropagation(); onChange(removeStop(value, i)); setSel(0); }} />
        ))}
      </div>
      {value[sel] && <ColorPickerHSB value={value[sel].color} onChange={(c) => onChange(value.map((s, i) => (i === sel ? { ...s, color: c } : s)))} />}
    </div>
  );
}
```

(Stop-position dragging uses `moveStop` inside a pointer handler mirroring `ColorPickerHSB.barDrag` — wire it on the stop's `onPointerDown` when you add drag; the click-to-add + double-click-remove above are the minimum.)

- [ ] **Step 2: CSS** — `.fxwb-grad-bar` (height ~26px, radius, relative), `.fxwb-grad-stop` (absolute round marker, `translateX(-50%)`, `.sel` outline).

- [ ] **Step 3: Verify** `npm run typecheck:web && npm run build:web` clean.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/fx/ui/GradientEditor.tsx packages/ui/src/styles.css
git commit -m "feat(fx): multi-stop gradient editor"
```

---

### Task 6: `PalettePicker` (labelled stops + preset library)

**Files:**
- Create: `packages/ui/src/fx/ui/PalettePicker.tsx`

**Interfaces:**
- Consumes: `PALETTE_STOP_LABELS`, `PALETTE_LIBRARY` (Task 3); `ColorPickerHSB` (Task 4); `numToHex` (Task 1).
- Produces: `PalettePicker({ value, onChange }: { value: [number,number,number,number]; onChange: (v: [number,number,number,number]) => void })` — 4 labelled swatches (Rim/Outer/Inner/Core), selected one opens `ColorPickerHSB`; a grouped preset gallery (4-swatch chips) that replaces all four on click.

- [ ] **Step 1: Implement** (owner-eyeballed; data + editors from earlier tasks)

```tsx
import { useState } from 'react';
import { PALETTE_STOP_LABELS, PALETTE_LIBRARY } from '../palettes';
import { numToHex } from '../color';
import { ColorPickerHSB } from './ColorPickerHSB';

type Quad = [number, number, number, number];
export function PalettePicker({ value, onChange }: { value: Quad; onChange: (v: Quad) => void }) {
  const [sel, setSel] = useState(2);
  const setStop = (c: number) => onChange(value.map((v, i) => (i === sel ? c : v)) as Quad);
  return (
    <div className="fxwb-pal">
      <div className="fxwb-pal-stops">
        {value.map((c, i) => (
          <button key={i} className={`fxwb-pal-stop${i === sel ? ' sel' : ''}`} onClick={() => setSel(i)}>
            <span className="sw" style={{ background: numToHex(c) }} />
            <span className="nm">{PALETTE_STOP_LABELS[i]}</span>
          </button>
        ))}
      </div>
      <ColorPickerHSB value={value[sel]} onChange={setStop} />
      <details className="fxwb-pal-lib"><summary>Presets</summary>
        {Object.entries(PALETTE_LIBRARY).map(([group, pals]) => (
          <div key={group} className="fxwb-pal-group">
            <div className="fxwb-pal-gname">{group}</div>
            <div className="fxwb-pal-grid">
              {Object.entries(pals).map(([name, cols]) => (
                <button key={name} className="fxwb-pal-chip" title={name} onClick={() => onChange([...cols] as Quad)}>
                  {cols.map((c, i) => <span key={i} style={{ background: numToHex(c) }} />)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </details>
    </div>
  );
}
```

- [ ] **Step 2: CSS** — `.fxwb-pal-stops` (4-col), `.fxwb-pal-chip` (flex of 4 tiny squares), `.fxwb-pal-grid` (repeat(6,1fr)).

- [ ] **Step 3: Verify** `npm run typecheck:web && npm run build:web` clean.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/fx/ui/PalettePicker.tsx packages/ui/src/styles.css
git commit -m "feat(fx): palette picker with labelled stops + preset library"
```

---

### Task 7: Wire the new editors into `ParamRow`

**Files:**
- Modify: `packages/ui/src/fx/ui/Inspector.tsx` (the `ParamRow` component + its color/palette rendering ~L284)

**Interfaces:**
- Consumes: `ColorPickerHSB`, `GradientEditor`, `PalettePicker`.

- [ ] **Step 1: Read `ParamRow`** to find where it switches on `spec.kind`. Confirm the current `color` branch (hex input, `hexToColor`/`colorToHex`) and the `palette` branch (`stops`).

- [ ] **Step 2: Replace the editors** — in `ParamRow`'s kind switch:
  - `case 'color'`: render `<ColorPickerHSB value={value as number} onChange={onChange} />` (drop the raw hex input, or keep a small hex readout).
  - `case 'palette'`: render `<PalettePicker value={value as Quad} onChange={onChange} />`.
  - `case 'gradient'`: render `<GradientEditor value={value as GradientStop[]} onChange={onChange} />`.
  Keep the existing `onChange` plumbing (it already writes the param value up to the workbench).

- [ ] **Step 3: Verify** — `npm run typecheck:web && npm run lint && npx vitest run packages/ui/src/fx/` all green (no existing Inspector test asserts the old color input markup; if one does, update it to the new component's role/label).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/fx/ui/Inspector.tsx
git commit -m "feat(fx): render HSB/palette/gradient editors in the inspector"
```

---

### Task 8: Filter colours — make the omitted colour knobs editable

**Files:**
- Modify: `packages/ui/src/fx/filterRegistry.ts` (add `color` knobs to Glow, Outline, DropShadow, ColorOverlay, Bevel)
- Modify: `packages/ui/src/fx/filterStack.ts` (apply a colour knob's number onto the filter instance)

**Interfaces:**
- Consumes: the `color` param kind (already exists) + `filterLabSpecs`'s knob machinery. Extend `FxFilterKnob` with `kind: 'color'` support so a colour knob emits a `{ kind: 'color' }` param and `FilterStack.frame` sets `filter[prop] = value` (a pixi `ColorSource` accepts a number).

- [ ] **Step 1: Extend `filterLabSpecs`** in `filterStack.ts` so a knob with `kind: 'color'` produces a `{ kind: 'color', default }` param (currently knobs are slider/toggle). Its per-frame apply in `FilterStack.frame` sets `rec[k.prop] = num(params, knobKey(...))` — a colour is just a number, so the existing numeric apply works; add a `'color'` branch that reads the number and sets it (no curve).

- [ ] **Step 2: Add colour knobs** to the registry entries: Glow `{ name:'color', label:'Colour', prop:'color', kind:'color', default:0xffffff }`, Outline `color` (default 0x000000), DropShadow `color` (0x000000), ColorOverlay `color` (0xff0000), Bevel `lightColor`/`shadowColor` (0xffffff/0x000000).

- [ ] **Step 3: Verify** — `npm run typecheck:web && npx vitest run packages/ui/src/fx/` green (the "every param has help" + "copy covers every primitive" tests still pass — colour knobs get a default help via `filterLabSpecs`).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/fx/filterStack.ts packages/ui/src/fx/filterRegistry.ts
git commit -m "feat(fx): editable colours on Glow/Outline/DropShadow/Overlay/Bevel filters"
```

---

## Self-Review

**Spec coverage (spec §5):** §5.1 HSB picker → Tasks 1,4,7. §5.2 labelled palette → Tasks 3,6,7. §5.3 gradient editor → Tasks 2,5,7 (ColorGradient filter wiring is a follow-on in the Stage Setter/filter plan — noted, not in this plan's scope since it needs the filter's stops binding). §5.4 preset library → Tasks 3,6. Filter colours (spec §5.1 "filter colours previously omitted") → Task 8. Blend modes (§6), layout (§3), Stage Setter (§4), drag (§7) are **separate plans** (stated up front). Gap: none within the colour-kit scope.

**Placeholder scan:** No TBD/TODO; every code step carries real code. The two component tasks (4,5,6) are explicitly owner-eyeballed (no jsdom/WebGL) with their pure logic fully TDD'd in Tasks 1–3 — this is honest, not a placeholder.

**Type consistency:** `Hsb`, `hsbToNum`/`numToHsb`/`numToHex`/`hexToNum` (Task 1) used verbatim in 4/5/6. `GradientStop`/`addStop`/`removeStop`/`moveStop` (Task 2) used verbatim in 5. `PALETTE_STOP_LABELS`/`PALETTE_LIBRARY` (Task 3) used verbatim in 6. `Quad = [number,number,number,number]` consistent in 6/7. No signature drift.

**Scope check:** One subsystem (colour), independently shippable, produces a visibly better picker on its own.
