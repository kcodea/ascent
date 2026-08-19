# Combat Speed Auto-Ramp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggle-able option (on by default) that makes each combat's replay automatically speed up as the fight runs, then ease back to normal for the finish.

**Architecture:** A pure ramp function computes an *effective* combat speed each frame from `(base slider, time elapsed, estimated time remaining)`. A rAF loop — alive only during a fight, only when the toggle is on — writes that speed into the replay's live speed ref, the `--combat-speed` CSS var, and `applyFloatSpeed()`, so CSS/floats/JS timing all ramp together with **zero per-frame React renders**. The base slider value and the store are never mutated by the ramp.

**Tech Stack:** TypeScript, React, Zustand (`packages/ui`), Vitest. No engine/content/sim changes.

## Global Constraints

- **Performance is the north star.** No per-frame `getBoundingClientRect`; no per-frame React state writes; the ramp drives a ref + CSS var only. The off-path must add zero cost (no rAF loop when the toggle is off).
- **`Math.random` is banned in core/content/sim** (ESLint) — N/A here (UI), but do not introduce it. `performance.now()` is fine in `packages/ui`.
- **Branch/PR discipline:** work on `feat/combat-speed-ramp`. Never push to `main`. Open a PR; wait for the required `verify` check green; squash-merge.
- **Docs every commit:** update `docs/devlog.md`, `docs/roadmap.md`, `README.md` in the same PR (final task).
- **Prove the gates:** `npm run typecheck && npm run lint && npm test && npm run build:web` all green before claiming done.
- **Tutorial stays at 1×** and never ramps (`run.mode === 'tutorial'`).
- **Default toggle state: ON.** Turning it off is a pure no-op that restores today's exact behavior.

## File Structure

- `packages/ui/src/combatRampConfig.ts` — **new.** Pure ramp math (`smoothstep`, `rampSpeed`, `buildAuthoredTimeline`), the tunable `CombatRampConfig` + defaults + get/set/reset, and the tuner `SPEC`. One responsibility: "given base + elapsed + remaining, what speed, and what are the knobs."
- `packages/ui/src/combatRampConfig.test.ts` — **new.** Unit tests for the math + the timeline helper.
- `packages/ui/src/CombatRampTuner.tsx` — **new.** Thin `<TunerPanel spec={SPEC} />` wrapper.
- `packages/ui/src/store.ts` — **modify.** `combatRampUp` boolean state + setter + `loadCombatRampUp()` helper.
- `packages/ui/src/DevMenu.tsx` — **modify.** Register the tuner.
- `packages/ui/src/EscMenu.tsx` — **modify.** Toggle button under the Speed slider + slider sublabel copy.
- `packages/ui/src/useCombatReplay.ts` — **modify.** Timeline useMemo, rAF ramp loop, re-point timing reads to the effective-speed ref, accept `rampEnabled` opt.
- `packages/ui/src/Recruit.tsx` — **modify.** Read `combatRampUp`, pass `rampEnabled` into `useCombatReplay`.
- `docs/devlog.md`, `docs/roadmap.md`, `README.md` — **modify.** History + queue + front page.

---

### Task 1: Ramp math + config module (the core)

**Files:**
- Create: `packages/ui/src/combatRampConfig.ts`
- Test: `packages/ui/src/combatRampConfig.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface CombatRampConfig { graceMs: number; rampUpMs: number; ceiling: number; tailMs: number }`
  - `function rampSpeed(base: number, elapsedMs: number, remainingMs: number, cfg: CombatRampConfig): number`
  - `interface AuthoredTimeline { totalMs: number; remainingAt(beatIdx: number): number }`
  - `function buildAuthoredTimeline<T>(beats: T[], holdAt: (next: T, prev: T) => number, finalHoldMs: number): AuthoredTimeline`
  - `function getCombatRampConfig(): CombatRampConfig`
  - `const SPEC: TunerSpec<CombatRampConfig>`
  - `const COMBAT_RAMP_DEFAULTS: CombatRampConfig`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/combatRampConfig.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildAuthoredTimeline, rampSpeed, type CombatRampConfig } from './combatRampConfig';

const CFG: CombatRampConfig = { graceMs: 2000, rampUpMs: 4000, ceiling: 3, tailMs: 5000 };
const FAR = 1_000_000; // "lots of time left" — keeps the down-curve pinned at ceiling

describe('rampSpeed', () => {
  it('holds at base during the grace window', () => {
    expect(rampSpeed(1, 0, FAR, CFG)).toBeCloseTo(1);
    expect(rampSpeed(1, 1999, FAR, CFG)).toBeCloseTo(1);
  });

  it('reaches the ceiling after grace + rampUp', () => {
    expect(rampSpeed(1, CFG.graceMs + CFG.rampUpMs, FAR, CFG)).toBeCloseTo(3);
    expect(rampSpeed(1, CFG.graceMs + CFG.rampUpMs + 5000, FAR, CFG)).toBeCloseTo(3);
  });

  it('climbs monotonically between grace and full ramp', () => {
    const a = rampSpeed(1, 3000, FAR, CFG);
    const b = rampSpeed(1, 4000, FAR, CFG);
    const c = rampSpeed(1, 5000, FAR, CFG);
    expect(a).toBeGreaterThan(1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThanOrEqual(3);
  });

  it('eases back to base as the fight ends (down-curve)', () => {
    expect(rampSpeed(1, FAR, 0, CFG)).toBeCloseTo(1);         // no time left → base
    expect(rampSpeed(1, FAR, CFG.tailMs, CFG)).toBeCloseTo(3); // exactly at tail → ceiling
    const mid = rampSpeed(1, FAR, 2500, CFG);
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(3);
  });

  it('short fight (little time left) never really speeds up', () => {
    // elapsed is large but only 1s of authored time remains → min() picks the low down-curve
    const s = rampSpeed(1, FAR, 1000, CFG);
    expect(s).toBeGreaterThanOrEqual(1);
    expect(s).toBeLessThan(3);
  });

  it('is a no-op when base is already at/above the ceiling', () => {
    expect(rampSpeed(5, FAR, FAR, CFG)).toBeCloseTo(5);
    expect(rampSpeed(3, FAR, FAR, CFG)).toBeCloseTo(3);
  });

  it('never leaves the [base, ceiling] band across a sweep', () => {
    for (let e = 0; e <= 12000; e += 250) {
      for (let r = 0; r <= 12000; r += 250) {
        const s = rampSpeed(1, e, r, CFG);
        expect(s).toBeGreaterThanOrEqual(1 - 1e-9);
        expect(s).toBeLessThanOrEqual(3 + 1e-9);
      }
    }
  });
});

describe('buildAuthoredTimeline', () => {
  it('sums inter-beat holds and adds the final hold', () => {
    // beats carry a cumulative marker; holdAt returns the gap into each beat
    const beats = [0, 10, 30, 60];
    const t = buildAuthoredTimeline(beats, (next, prev) => next - prev, 100);
    expect(t.totalMs).toBe(160);            // 60 + finalHold 100
    expect(t.remainingAt(0)).toBe(160);
    expect(t.remainingAt(1)).toBe(150);
    expect(t.remainingAt(3)).toBe(100);     // only the final hold left
    expect(t.remainingAt(99)).toBe(100);    // clamps past the end
  });

  it('handles an empty beats array', () => {
    const t = buildAuthoredTimeline<number>([], () => 0, 100);
    expect(t.totalMs).toBe(100);
    expect(t.remainingAt(0)).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/combatRampConfig.test.ts`
Expected: FAIL — `Cannot find module './combatRampConfig'`.

- [ ] **Step 3: Write the module**

Create `packages/ui/src/combatRampConfig.ts`:

```ts
/**
 * Combat speed AUTO-RAMP (owner ask 2026-08-18). Within a fight the replay eases UP from the player's Speed
 * slider (the base/starting speed) to a ceiling, then eases back DOWN to base for the finish, so long fights
 * stop dragging while the opening and the finishing blows still read at normal speed.
 *
 * Pure math here; the wiring (a rAF loop that samples this per frame) lives in useCombatReplay.ts. The ramp is
 * a MULTIPLIER LAYER — it never mutates the store's combatSpeed. Every number is dev-tunable via the SPEC.
 */
import type { TunerControl, TunerSpec } from './tunerSchema';

export interface CombatRampConfig {
  /** Hold at the starting speed for this long at the top of the fight. */
  graceMs: number;
  /** After the grace window, ease base → ceiling over this long. */
  rampUpMs: number;
  /** Absolute target speed to climb to (clamped ≤ 5× at the call site). */
  ceiling: number;
  /** Begin easing ceiling → base once estimated authored time-left drops below this. */
  tailMs: number;
}

export const COMBAT_RAMP_DEFAULTS: CombatRampConfig = {
  graceMs: 2000,
  rampUpMs: 4000,
  ceiling: 3,
  tailMs: 5000,
};

/** Smooth ease-in-out on [0,1]. */
function smoothstep(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

function lerp(base: number, ceiling: number, t: number): number {
  return base + (ceiling - base) * smoothstep(t);
}

/**
 * Effective speed = min(up-curve, down-curve), clamped to [base, ceiling]. Taking the min composes the two
 * with no per-fight-length special-casing: a short fight's down-curve is low from frame one so it never
 * speeds up; a long fight climbs, cruises, then eases back down.
 */
export function rampSpeed(base: number, elapsedMs: number, remainingMs: number, cfg: CombatRampConfig): number {
  const ceiling = cfg.ceiling;
  if (base >= ceiling) return base; // slider already at/above target → nothing to ramp
  // Up-curve: base during grace, then ease to ceiling over rampUpMs.
  const up = elapsedMs <= cfg.graceMs
    ? base
    : lerp(base, ceiling, (elapsedMs - cfg.graceMs) / cfg.rampUpMs);
  // Down-curve: ceiling while there's time to spare, else ease to base as remaining → 0.
  const down = remainingMs >= cfg.tailMs
    ? ceiling
    : lerp(base, ceiling, remainingMs / cfg.tailMs);
  const s = Math.min(up, down);
  return s < base ? base : s > ceiling ? ceiling : s;
}

export interface AuthoredTimeline {
  /** Total authored (base-speed) ms for the whole fight, incl. the final hold. */
  totalMs: number;
  /** Estimated authored ms remaining once beat `beatIdx` is on screen (clamps to the ends). */
  remainingAt(beatIdx: number): number;
}

/**
 * Prefix-sum of the authored (base-speed) duration of every inter-beat gap, so "time remaining" is an O(1)
 * lookup per frame. `holdAt(next, prev)` is the base-speed hold BEFORE `next` shows (in the replay that is
 * `holdMs(next, prev, 1)`). Generic over the beat type so it is trivially testable with plain numbers.
 *
 * Estimate, not a stopwatch: a plain hold sum under-counts an attackExchange/lunge beat's internal timeline,
 * so it errs toward easing to base slightly EARLY — the safe direction. `tailMs` compensates. See the spec.
 */
export function buildAuthoredTimeline<T>(
  beats: T[],
  holdAt: (next: T, prev: T) => number,
  finalHoldMs: number,
): AuthoredTimeline {
  const cumulativeInto: number[] = new Array(beats.length);
  cumulativeInto[0] = 0;
  for (let k = 1; k < beats.length; k++) {
    cumulativeInto[k] = cumulativeInto[k - 1] + holdAt(beats[k]!, beats[k - 1]!);
  }
  const lastCum = beats.length > 0 ? cumulativeInto[beats.length - 1]! : 0;
  const totalMs = lastCum + finalHoldMs;
  return {
    totalMs,
    remainingAt(beatIdx: number): number {
      if (beats.length === 0) return totalMs;
      const i = beatIdx < 0 ? 0 : beatIdx >= beats.length ? beats.length - 1 : beatIdx;
      return totalMs - cumulativeInto[i]!;
    },
  };
}

// ---- Dev tuner plumbing (dev-only persistence; prod always uses DEFAULTS) --------------------------------

const KEY = 'ascent.combatrampcfg';
const RANGES: Record<keyof CombatRampConfig, [number, number, number]> = {
  graceMs: [0, 6000, 100],
  rampUpMs: [500, 10000, 100],
  ceiling: [1, 5, 0.1],
  tailMs: [0, 10000, 100],
};

let cfg: CombatRampConfig = (() => {
  if (!import.meta.env.DEV) return { ...COMBAT_RAMP_DEFAULTS };
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...COMBAT_RAMP_DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<CombatRampConfig>) : {}) };
  } catch {
    return { ...COMBAT_RAMP_DEFAULTS };
  }
})();

export function getCombatRampConfig(): CombatRampConfig {
  return cfg;
}

export function setCombatRampValue(key: keyof CombatRampConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetCombatRampConfig(): void {
  cfg = { ...COMBAT_RAMP_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

const controls: TunerControl<Extract<keyof CombatRampConfig, string>>[] = [
  { key: 'graceMs', label: 'Grace hold', unit: 'ms', hint: 'How long each fight stays at the starting speed before it begins to accelerate.', group: 'Speed ramp', min: RANGES.graceMs[0], max: RANGES.graceMs[1], step: RANGES.graceMs[2] },
  { key: 'rampUpMs', label: 'Ramp-up', unit: 'ms', hint: 'How long the climb from starting speed up to the ceiling takes, after the grace hold.', group: 'Speed ramp', min: RANGES.rampUpMs[0], max: RANGES.rampUpMs[1], step: RANGES.rampUpMs[2] },
  { key: 'ceiling', label: 'Ceiling', unit: '×', hint: 'The top speed the ramp climbs to. Capped at 5×; ignored if the slider is already above it.', group: 'Speed ramp', min: RANGES.ceiling[0], max: RANGES.ceiling[1], step: RANGES.ceiling[2] },
  { key: 'tailMs', label: 'Ease-down tail', unit: 'ms', hint: 'When estimated time-left in the fight drops below this, ease back to the starting speed for the finish.', group: 'Speed ramp', min: RANGES.tailMs[0], max: RANGES.tailMs[1], step: RANGES.tailMs[2] },
];

export const SPEC: TunerSpec<CombatRampConfig> = {
  id: 'combatramp',                // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Speed Ramp',
  note: 'dev · live · needs auto-ramp ON',
  read: getCombatRampConfig,
  write: (key, value) => setCombatRampValue(key, value as number),
  reset: resetCombatRampConfig,
  defaults: COMBAT_RAMP_DEFAULTS,
  controls,
};
```

> **Before writing:** open `packages/ui/src/tunerSchema.ts` and confirm the `TunerControl` / `TunerSpec` field names used above (`read`/`write`/`reset`/`defaults`/`controls`, and control `kind`/`unit`/`group`). Match `boardEdgeConfig.ts` exactly. If a numeric control needs no `kind`, omit it as `boardEdgeConfig.ts` does for `fade`. Adjust field names to whatever the schema actually declares — do not invent fields.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/src/combatRampConfig.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + lint the new module**

Run: `npm run typecheck && npm run lint`
Expected: green. (If lint flags the non-null `!` assertions, keep them — the loop bounds guarantee the indices — or refactor to locals; match repo style.)

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/combatRampConfig.ts packages/ui/src/combatRampConfig.test.ts
git commit -m "feat(ui): pure combat speed auto-ramp math + tuner config"
```

---

### Task 2: Store toggle state

**Files:**
- Modify: `packages/ui/src/store.ts` (add `loadCombatRampUp` near `loadCombatSpeed` ~line 485; add state field near `combatSpeed` ~line 263 in the interface and ~line 977 in the store body).
- Test: `packages/ui/src/combatRampConfig.test.ts` (append a `loadCombatRampUp` block — keep the store's pure loader testable here rather than spinning up the whole store).

**Interfaces:**
- Consumes: nothing.
- Produces (store): `combatRampUp: boolean`, `setCombatRampUp(on: boolean): void`, and exported `loadCombatRampUp(): boolean`.

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/src/combatRampConfig.test.ts`:

```ts
import { loadCombatRampUp } from './store';

describe('loadCombatRampUp', () => {
  const realLS = globalThis.localStorage;
  afterEach(() => { (globalThis as { localStorage?: unknown }).localStorage = realLS; });

  it('defaults to true when nothing is stored', () => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null } as Storage;
    expect(loadCombatRampUp()).toBe(true);
  });

  it('reads a stored "false"', () => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => 'false' } as Storage;
    expect(loadCombatRampUp()).toBe(false);
  });

  it('reads a stored "true"', () => {
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => 'true' } as Storage;
    expect(loadCombatRampUp()).toBe(true);
  });
});
```

Add `import { afterEach, describe, expect, it } from 'vitest';` to the file's existing vitest import (merge, don't duplicate).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/combatRampConfig.test.ts`
Expected: FAIL — `store` has no export `loadCombatRampUp`.

> If importing `./store` into a vitest file drags in DOM/browser globals and the test crashes on load (see the "Headless UI module dump" note — `store.ts` is a large UI module), fall back: move `loadCombatRampUp` into `combatRampConfig.ts` instead (it is a pure localStorage read), import it from there in `store.ts`, and point this test at `./combatRampConfig`. Prefer the `store.ts` home if the import is clean.

- [ ] **Step 3: Implement**

In `packages/ui/src/store.ts`, beside `loadCombatSpeed` (~line 485):

```ts
/** Persisted auto-ramp toggle. Defaults to ON (true) on anything missing/malformed. Best-effort. */
export function loadCombatRampUp(): boolean {
  try {
    return localStorage.getItem('ascent.combatrampup') !== 'false';
  } catch { return true; }
}
```

In the store state interface, right after the `combatSpeed` / `setCombatSpeed` lines (~line 264):

```ts
  /** Auto-ramp: within a fight the replay eases up from the Speed slider (its starting speed) to a ceiling,
   *  then back down for the finish. On by default. See combatRampConfig.ts. */
  combatRampUp: boolean;
  setCombatRampUp: (on: boolean) => void;
```

In the store body, right after the `setCombatSpeed` block (~line 982):

```ts
  combatRampUp: loadCombatRampUp(),
  setCombatRampUp: (on) => {
    try { localStorage.setItem('ascent.combatrampup', String(on)); } catch { /* ignore */ }
    set({ combatRampUp: on });
  },
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run packages/ui/src/combatRampConfig.test.ts && npm run typecheck`
Expected: PASS + green.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/store.ts packages/ui/src/combatRampConfig.test.ts
git commit -m "feat(ui): combatRampUp store toggle (default on)"
```

---

### Task 3: Dev tuner registration

**Files:**
- Create: `packages/ui/src/CombatRampTuner.tsx`
- Modify: `packages/ui/src/DevMenu.tsx` (import ~line 15–40 block; add an item to the `strikes` group `items` array ~line 148).

**Interfaces:**
- Consumes: `SPEC` from `combatRampConfig.ts` (Task 1); `TunerPanel` from `./TunerPanel`.
- Produces: `CombatRampTuner` component; a DevMenu entry keyed `speedramp`.

- [ ] **Step 1: Create the wrapper**

`packages/ui/src/CombatRampTuner.tsx`:

```tsx
import { SPEC } from './combatRampConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV-only tuner for the combat speed AUTO-RAMP curve — grace hold, ramp-up length, ceiling, and the
 * ease-down tail. Live while a fight plays with the auto-ramp toggle ON (Settings → Combat). Rendered
 * through the shared `TunerPanel` from `combatRampConfig`'s spec.
 */
export function CombatRampTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
```

- [ ] **Step 2: Register it in DevMenu**

In `packages/ui/src/DevMenu.tsx`, add the import next to the other tuner imports (~line 15):

```tsx
import { CombatRampTuner } from './CombatRampTuner';
```

Add this item to the `strikes` group's `items` array (the group at ~line 146, after the `lunge` entry):

```tsx
      { key: 'speedramp', icon: '⏩', label: 'Speed Ramp', C: CombatRampTuner, hint: 'The auto speed-up curve during combat — grace, ramp-up, ceiling, ease-down', alt: 'combat replay pacing auto ramp' },
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build:web`
Expected: green. (No unit test — a tuner is dev UI; the pure math it drives is already covered in Task 1.)

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/CombatRampTuner.tsx packages/ui/src/DevMenu.tsx
git commit -m "feat(ui): register Speed Ramp dev tuner"
```

---

### Task 4: Settings toggle UI

**Files:**
- Modify: `packages/ui/src/EscMenu.tsx` (the `Combat` section, ~lines 76–89).

**Interfaces:**
- Consumes: `combatRampUp` + `setCombatRampUp` from the store (Task 2); `sfx` for the click.
- Produces: nothing downstream (pure UI).

- [ ] **Step 1: Read the store values**

In `EscMenu.tsx`, beside the existing `combatSpeed` reads (~line 25):

```tsx
  const combatRampUp = useGame((s) => s.combatRampUp);
  const setCombatRampUp = useGame((s) => s.setCombatRampUp);
```

- [ ] **Step 2: Add the toggle under the slider**

Replace the Combat section's slider block (the `<div className="escsec">Combat</div>` + its `escvol` slider, ~lines 76–89) so the toggle sits directly **below** the slider and the slider sublabel notes it's the *starting* speed:

```tsx
        <div className="escsec">Combat</div>
        <div className="escvol">
          <span className="evl">{combatRampUp ? 'Start speed' : 'Speed'}</span>
          <input
            type="range"
            min={0.5}
            max={5}
            step={0.1}
            value={combatSpeed}
            aria-label="Combat replay speed"
            onChange={(e) => setCombatSpeed(Number(e.target.value))}
          />
          <span className="evv">{combatSpeed.toFixed(1)}×</span>
        </div>
        <button
          className={`escbtn pressable${combatRampUp ? ' on' : ''}`}
          onPointerDown={() => { setCombatRampUp(!combatRampUp); sfx.pulse(); }}
          aria-pressed={combatRampUp}
        >
          <span className="ebl">Auto-ramp speed{combatRampUp ? ' ✓' : ''}</span>
          <span className="ebs">Long fights speed up, then ease back down for the finish</span>
        </button>
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build:web`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/EscMenu.tsx
git commit -m "feat(ui): auto-ramp toggle under the combat speed slider"
```

---

### Task 5: Wire the ramp into the replay (integration)

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts`
- Modify: `packages/ui/src/Recruit.tsx`

**Interfaces:**
- Consumes: `rampSpeed`, `buildAuthoredTimeline`, `getCombatRampConfig` (Task 1); `holdMs` (already imported); `applyFloatSpeed` from `./floatConfig`; `getChoreoConfig().finalHold`; store `combatRampUp` (Task 2).
- Produces: `useCombatReplay(...)` accepts `opts.rampEnabled?: boolean`.

**Design notes (read before editing):**
- `combatSpeedRef` (declared ~line 988, assigned `combatSpeedRef.current = combatSpeed` every render) is *already* the live speed most timing paths read. We repurpose it as the **effective** speed: the rAF loop writes it when ramping; the per-render line only sets it when NOT ramping.
- The base input speed is the local `combatSpeed` (line 791) — the store value with tutorial forced to 1×. The ramp never exceeds `min(cfg.ceiling, 5)` and never drops below base.
- Pause: read a `pausedRef` inside the loop and stop accumulating elapsed while paused, so the loop's effect does NOT depend on `paused` (no re-arm churn).

- [ ] **Step 1: Add imports + the `rampEnabled` opt**

Near the other imports:

```ts
import { applyFloatSpeed } from './floatConfig';
import { buildAuthoredTimeline, getCombatRampConfig, rampSpeed } from './combatRampConfig';
```

Extend the options type (the `opts` param ~line 762) and its destructure:

```ts
  opts: { active: boolean; findEl: (uid: string) => Element | null; combatSpeed?: number; paused?: boolean; rampEnabled?: boolean },
```
```ts
  const { active, findEl, paused = false, rampEnabled = false } = opts;
```

- [ ] **Step 2: Add a paused ref + beatIdx ref + authored timeline**

After `const [beatIdx, setBeatIdx] = useState(0);` (~line 809):

```ts
  // Mirrors read by the rAF ramp loop WITHOUT making it a React dep (so pause / beat advance don't re-arm it).
  const beatIdxRef = useRef(0);
  beatIdxRef.current = beatIdx;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  // Authored (base-speed) duration table for "time remaining" — O(1) per frame. Rebuilt only when the fight
  // (its beats) changes. `holdMs(next, prev, 1)` is the base-speed hold before each beat shows.
  const authored = useMemo(
    () => buildAuthoredTimeline(beats, (next, prev) => holdMs(next, prev, 1), getChoreoConfig().finalHold),
    [beats],
  );
```

- [ ] **Step 3: Gate the per-render effective-speed write**

Find (~line 988):

```ts
  const combatSpeedRef = useRef(combatSpeed);
  combatSpeedRef.current = combatSpeed;
```

Replace the second line so the ramp loop owns the ref while it runs:

```ts
  const combatSpeedRef = useRef(combatSpeed);
  // When NOT ramping, the ref tracks the base slider every render (today's behavior). While the ramp loop is
  // live it owns this ref; a stray render can only clobber it for a single frame before the loop reasserts.
  if (!(rampEnabled && active)) combatSpeedRef.current = combatSpeed;
```

- [ ] **Step 4: Add the rAF ramp loop**

Add this effect right after the `combatSpeedRef` block (before the existing scheduler effects):

```ts
  // AUTO-RAMP (owner ask 2026-08-18): while a fight plays with the toggle on, ease the effective speed up from
  // the base slider to the ceiling after a grace hold, then back down to base as the fight's estimated time
  // runs out. Drives a ref + CSS var + float speed only — NO per-frame React render. Off-path costs nothing.
  useEffect(() => {
    const root = typeof document !== 'undefined' ? document.documentElement.style : null;
    if (!active || !rampEnabled) return; // off / not fighting → base drives everything (see the gated ref write)
    let raf = 0;
    let elapsed = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = now - last;
      last = now;
      if (!pausedRef.current) elapsed += dt;
      const cfg = getCombatRampConfig();
      const ceiling = Math.min(cfg.ceiling, 5); // never exceed the store's 5× cap
      const remaining = authored.remainingAt(beatIdxRef.current);
      const spd = rampSpeed(combatSpeed, elapsed, remaining, { ...cfg, ceiling });
      combatSpeedRef.current = spd;
      root?.setProperty('--combat-speed', String(spd > 0 ? spd : 1));
      applyFloatSpeed(spd);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Restore base on teardown so the post-combat UI + the next fight start from the slider value.
      combatSpeedRef.current = combatSpeed;
      root?.setProperty('--combat-speed', String(combatSpeed > 0 ? combatSpeed : 1));
      applyFloatSpeed(combatSpeed);
    };
    // combat in deps → new fight rebuilds `authored` and resets `elapsed`. `paused`/`beatIdx` intentionally
    // excluded (read via refs) so they never re-arm the loop.
  }, [active, rampEnabled, combat, combatSpeed, authored]);
```

- [ ] **Step 5: Re-point the beat scheduler + cue call sites to the effective ref**

In the beat scheduler effect, change the hold + lead to sample the live effective speed so each newly-armed beat picks up the ramp:

- Line ~1201: `let d = holdMs(next, shown, combatSpeed);` → `let d = holdMs(next, shown, combatSpeedRef.current);`
- Line ~1209: `if (lead) d += lead / combatSpeed;` → `if (lead) d += lead / combatSpeedRef.current;`

In the attack-exchange cue call (~line 1720): `combatSpeed, advance: ...` → `combatSpeed: combatSpeedRef.current, advance: ...`

In the Rise-return call (~line 1669): `runRiseReturn(el, combatSpeed, ...)` → `runRiseReturn(el, combatSpeedRef.current, ...)`

> Leave the `finalHold` effect (~line 1230) reading base `combatSpeed`: the ramp-down has already eased effective speed to ≈ base by the final beat, and the final hold is a fixed tail we want stable. Leave the scheduler effect's dep array as-is (it still lists `combatSpeed`); the ramp updates a ref, not state, so it deliberately does not re-arm the in-flight beat — the next beat samples the new speed. This matches the spec's "per-beat sampling."

- [ ] **Step 6: Thread `rampEnabled` from Recruit**

In `packages/ui/src/Recruit.tsx`, near `rawCombatSpeed` (~line 734):

```tsx
  const combatRampUp = useGame((s) => s.combatRampUp);
  // Tutorial always plays at a flat 1× (see below), so it never ramps either.
  const rampEnabled = run.mode !== 'tutorial' && combatRampUp;
```

Update the `useCombatReplay` call (~line 1531):

```tsx
  const replay = useCombatReplay(run.lastCombat, { active: fighting, findEl, combatSpeed, paused: overlayOpen, rampEnabled });
```

- [ ] **Step 7: Typecheck, lint, test, build**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green. The determinism/golden suites must be untouched (no sim change).

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/useCombatReplay.ts packages/ui/src/Recruit.tsx
git commit -m "feat(ui): drive combat replay from the auto-ramp effective speed"
```

---

### Task 6: Live verification + docs

**Files:**
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `README.md`.

- [ ] **Step 1: Live check in the focused Chrome tab**

Per the FX-verification habit (drive the real focused Chrome tab, not the headless preview — `window.useGame` / `__pixiFx`), with auto-ramp ON and the Speed slider at **1×** (the owner's play speed):
- Start a combat with a reasonably long board. Confirm `getComputedStyle(document.documentElement).getPropertyValue('--combat-speed')` reads ~1.0 during the opening grace, climbs toward the ceiling mid-fight, and eases back toward ~1.0 as the fight ends.
- Confirm the finish (last kills + death collapse + damage floats) reads at normal speed — no ripped-out final frame.
- Toggle auto-ramp OFF in Settings → confirm `--combat-speed` holds a flat `1.0` for the whole fight (today's behavior exactly).
- Sanity: a very short fight barely accelerates.

Record what you observed (the var's arc, and that the finish reads clean). If the ease-down feels late/clips the finish, raise `tailMs` in the Speed Ramp tuner; if the opening feels rushed, raise `graceMs`.

- [ ] **Step 2: Update the docs**

- `docs/devlog.md` — prepend a dated entry: what changed (the effective-speed layer, the min-of-two-curves profile, the O(1) authored-time estimate + its approximation, default-ON toggle under the slider, the Speed Ramp tuner), why, and how verified (Task 1 unit tests + gates + the live `--combat-speed` arc check).
- `docs/roadmap.md` — move the auto-ramp item into done / out of the queue (add it first if it wasn't listed).
- `README.md` — add a line to **Recent changes**; adjust **Short-term roadmap** if it referenced this.

- [ ] **Step 3: Commit**

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: log combat speed auto-ramp"
```

- [ ] **Step 4: Push + open the PR**

```bash
git push -u origin feat/combat-speed-ramp
"<gh path>" pr create --fill --base main
```

Then watch the required check to green and squash-merge:

```bash
"<gh path>" pr checks <n> --watch
"<gh path>" pr merge <n> --squash --delete-branch
```

(Use the full `gh` path per the "gh CLI path" memory. Confirm `verify` is green before merging — do not `--admin`. If `--delete-branch` reports a worktree error after a successful server-side merge, confirm with `gh pr view <n> --json state,mergedAt` and clean the branch by hand.)

---

## Self-Review

**Spec coverage:**
- Effective-speed layer, no store mutation, no per-frame render → Task 5 (gated ref + rAF loop). ✔
- Slider = starting speed; absolute ceiling; no-op when base ≥ ceiling → `rampSpeed` (Task 1) + Task 4 label. ✔
- Wall-clock basis + grace + ramp-up + ease-down (min of two curves) → `rampSpeed` (Task 1). ✔
- O(1) "time remaining" via prefix sum + approximation caveat → `buildAuthoredTimeline` (Task 1) + Task 5 `authored`. ✔
- Reset per fight → `authored` useMemo on `[beats]` + loop `elapsed=0` on `[combat]` (Task 5). ✔
- Off / tutorial = no-op → `rampEnabled` gate (Task 5) + gated ref write; tutorial forced in Recruit. ✔
- Default-ON toggle **under** the slider in Settings → Task 2 (default true) + Task 4 (placement). ✔
- Dev tuner for every number → Tasks 1 (SPEC) + 3 (registration). ✔
- Tests: ramp math, timeline, off-path no-op, default-on loader → Task 1 + Task 2. ✔
- Docs (devlog/roadmap/README) + gates → Task 6. ✔

**Placeholder scan:** none — every code step is concrete. The two `<gh path>` / `<n>` tokens in Task 6 are runtime values (the gh binary path and the PR number), not unresolved design.

**Type consistency:** `rampSpeed(base, elapsedMs, remainingMs, cfg)`, `buildAuthoredTimeline(beats, holdAt, finalHoldMs)`, `AuthoredTimeline.remainingAt(beatIdx)`, `getCombatRampConfig()`, `CombatRampConfig{graceMs,rampUpMs,ceiling,tailMs}`, store `combatRampUp`/`setCombatRampUp`/`loadCombatRampUp`, opt `rampEnabled` — names are identical across Tasks 1, 2, 3, 5. `combatSpeedRef` reused as the effective ref (not renamed) to minimize churn.

**Risk notes for the implementer:**
- Confirm `tunerSchema.ts` field names before trusting the Task 1 `SPEC`/`controls` shape (a `write`-only spec vs the `writeColor` boardEdge uses — a numeric-only tuner should omit `writeColor`).
- Line numbers are from 2026-08-18 `feat/combat-speed-ramp`; if the file shifted, match on the quoted code, not the number.
