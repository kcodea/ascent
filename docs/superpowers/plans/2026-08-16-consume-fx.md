# Consume FX (shop phase) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shop-phase consume visual (ghost-Fred swirl + `pixiFx.buffTendril`) with an eaten-minion ghost that shakes, taffy-stretches toward the eater, and is pulled in — synced with a workshop-authored `consume-bands` Pixi def.

**Architecture:** Keep the existing `fodderEatenSeq`/`shopEatenSeq` → `playFodderEat` → React-rendered `fodderghost` pipeline (it already covers every shop eater). Rewire only the *animation half* of `playFodderEat`: drive each rendered ghost with a GSAP timeline (shake → taffy-stretch aimed at its eater → pull → vanish) using a pure transform helper, and fire `playDef('consume-bands', { source: ghostCenter, target: eaterCenter, camera })` at t=0 in place of the tendril. A localStorage-backed config + dev tuner (mirroring `aimFxConfig.ts`) dials the feel and a show-stats toggle.

**Tech Stack:** React + GSAP (`packages/ui/src/Recruit.tsx`), the FX `playDef` + workshop def system (`packages/ui/src/fx`), the config/tuner pattern (`*FxConfig.ts` + `DevMenu`), Vitest.

## Global Constraints

- **Presentation only.** Touch `packages/ui/**` (+ its `docs/**`). No `packages/sim`/`content`/`core`.
- **Coverage = every shop eat via the two shared signals.** Do NOT add per-card wiring. `playFodderEat` is reached from the mid-turn `fodderEatenSeq`/`shopEatenSeq` watchers AND the End-of-Turn beat loop (`eotEatKey`) — the rewire must work for all of them (one code path).
- **Out of scope:** combat consumes (no `CN` event exists), the `spellDevour` / `orbitDevourArriver` orphans, and the not-eats (Hellrider gain-stats, sells, destroys, reactions). Don't touch them.
- **Performance (CLAUDE.md north star):** animate `transform`/`opacity` only, one-shot; no per-frame `getBoundingClientRect` in a loop (measure eater once per eat); GSAP timeline, not a rAF that re-reads layout.
- **Duration:** the ghost timeline length `D` = `consumeFxConfig.durationMs`, kept in step with the authored def's `duration`. Default `D = 800`.
- **Gates:** `typecheck` + `lint` + full `npm test` + `build:web` green. Run the FULL `npm test` — `fx/directCalls.test.ts` lives outside `choreo/`, and `playDef('consume-bands', …)` is a LITERAL call site that must be added to `DIRECT_CALL_SITES`.

---

### Task 1: Pure feel modules — `consumeFxConfig.ts` + `consumeTransform.ts`

**Files:**
- Create: `packages/ui/src/consumeFxConfig.ts`
- Create: `packages/ui/src/fx/consumeTransform.ts`
- Test: `packages/ui/src/fx/consumeTransform.test.ts`

**Interfaces:**
- Produces: `interface ConsumeFxConfig`, `getConsumeFxConfig()`, `setConsumeFxValue(key, value)`, `resetConsumeFxConfig()`, `CONSUMEFX_RANGES`, `DEFAULTS`.
- Produces: `consumeTransform(from: Pt, to: Pt, t: number, cfg: ConsumeFxConfig): { tx: number; ty: number; rotDeg: number; scaleX: number; scaleY: number }` — the deterministic taffy transform for progress `t∈[0,1]` (shake is added separately in the GSAP layer). `Pt = { x: number; y: number }`.

- [ ] **Step 1: Write the failing transform test**

`packages/ui/src/fx/consumeTransform.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { consumeTransform } from './consumeTransform';

const CFG = { durationMs: 800, shakeAmp: 4, shakeFreq: 22, stretch: 0.8, thin: 0.35, pullDist: 1, showStats: true } as const;
const from = { x: 100, y: 100 };
const to = { x: 300, y: 100 }; // straight right → rotDeg ≈ 0

describe('consumeTransform', () => {
  it('is at rest at t=0 (no translate, no stretch, aimed at the eater)', () => {
    const r = consumeTransform(from, to, 0, CFG);
    expect(r.tx).toBeCloseTo(0); expect(r.ty).toBeCloseTo(0);
    expect(r.scaleX).toBeCloseTo(1); expect(r.scaleY).toBeCloseTo(1);
    expect(r.rotDeg).toBeCloseTo(0); // vector points +x
  });
  it('stretches along the aim axis and thins across it mid-flight', () => {
    const r = consumeTransform(from, to, 0.5, CFG);
    expect(r.scaleX).toBeGreaterThan(1);   // elongated toward the eater
    expect(r.scaleY).toBeLessThan(1);      // thinned across
    expect(r.tx).toBeGreaterThan(0);       // pulling toward the eater
  });
  it('arrives at the eater and collapses by t=1', () => {
    const r = consumeTransform(from, to, 1, CFG);
    expect(r.tx).toBeCloseTo((to.x - from.x) * CFG.pullDist); // 200
    expect(r.ty).toBeCloseTo(0);
    expect(r.scaleX).toBeLessThan(0.2); expect(r.scaleY).toBeLessThan(0.2); // vanished
  });
  it('aims the rotation at the eater for a diagonal vector', () => {
    const r = consumeTransform({ x: 0, y: 0 }, { x: 100, y: 100 }, 0.5, CFG);
    expect(r.rotDeg).toBeCloseTo(45);
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npx vitest run packages/ui/src/fx/consumeTransform.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `consumeTransform.ts`**

```ts
export interface Pt { x: number; y: number }

/** A smooth 0→1→0 bell (peaks at t=0.5) for the mid-flight stretch. */
function bell(t: number): number { return Math.sin(Math.PI * Math.max(0, Math.min(1, t))); }
/** Ease-in pull: slow start, accelerating into the eater. */
function pullEase(t: number): number { const c = Math.max(0, Math.min(1, t)); return c * c; }
/** Collapse: full size until ~0.6, then shrink to ~0 by t=1. */
function collapse(t: number): number { return t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4; }

/** The deterministic taffy transform at progress `t`. Shake (a small random jitter) is layered on by the
 *  caller so this stays pure/testable. `pullDist` (0..1) is the fraction of the full vector the ghost travels. */
export function consumeTransform(
  from: Pt, to: Pt, t: number,
  cfg: { stretch: number; thin: number; pullDist: number },
): { tx: number; ty: number; rotDeg: number; scaleX: number; scaleY: number } {
  const dx = to.x - from.x, dy = to.y - from.y;
  const rotDeg = Math.atan2(dy, dx) * 180 / Math.PI;
  const b = bell(t), col = collapse(t), pull = pullEase(t);
  return {
    tx: dx * cfg.pullDist * pull,
    ty: dy * cfg.pullDist * pull,
    rotDeg,
    scaleX: (1 + cfg.stretch * b) * col,
    scaleY: (1 - cfg.thin * b) * col,
  };
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `npx vitest run packages/ui/src/fx/consumeTransform.test.ts` → PASS.

- [ ] **Step 5: Implement `consumeFxConfig.ts`** (mirror `packages/ui/src/aimFxConfig.ts` exactly — read it first for the precise getter/persist shape)

```ts
export interface ConsumeFxConfig {
  durationMs: number;   // D — the whole eat; matches the authored def's duration
  shakeAmp: number;     // px of jitter at the shake peak
  shakeFreq: number;    // shake oscillations/sec
  stretch: number;      // taffy elongation along the aim axis (0..2)
  thin: number;         // thinning across the axis (0..1)
  pullDist: number;     // fraction of the ghost→eater vector travelled (0..1)
  showStats: boolean;   // render the eaten minion's stats on the ghost
}

const DEFAULTS: ConsumeFxConfig = {
  durationMs: 800, shakeAmp: 4, shakeFreq: 22, stretch: 0.8, thin: 0.35, pullDist: 1, showStats: true,
};

// [min, max, step] for the tuner sliders (booleans handled as a toggle, not here).
export const CONSUMEFX_RANGES: Partial<Record<keyof ConsumeFxConfig, [number, number, number]>> = {
  durationMs: [200, 2000, 10], shakeAmp: [0, 20, 0.5], shakeFreq: [0, 60, 1],
  stretch: [0, 2.5, 0.05], thin: [0, 1, 0.02], pullDist: [0, 1.2, 0.02],
};

const KEY = 'ascent.consumeFx';
let cfg: ConsumeFxConfig = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<ConsumeFxConfig>) : {}) };
  } catch { return { ...DEFAULTS }; }
})();

export function getConsumeFxConfig(): ConsumeFxConfig { return cfg; }
export function setConsumeFxValue(key: keyof ConsumeFxConfig, value: number | boolean): void {
  cfg = { ...cfg, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}
export function resetConsumeFxConfig(): void {
  cfg = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
export { DEFAULTS as CONSUMEFX_DEFAULTS };
```

Add a small always-on test in `consumeTransform.test.ts` (or a sibling) asserting `CONSUMEFX_DEFAULTS.showStats === true` and that `getConsumeFxConfig()` returns the documented keys.

- [ ] **Step 6: Run the fx suite + typecheck**

Run: `npx vitest run packages/ui/src/fx/ && npm run typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/consumeFxConfig.ts packages/ui/src/fx/consumeTransform.ts packages/ui/src/fx/consumeTransform.test.ts
git commit -m "feat(fx): consume-FX config + pure taffy transform helper"
```

---

### Task 2: Placeholder `consume-bands` def + rewire `playFodderEat` animation

**Files:**
- Create: `packages/ui/src/fx/defs/consume-bands.json` (placeholder — reuse a simple source→target def's content, e.g. copy `packages/ui/src/fx/defs/ruby-lance.json` and set `"id": "consume-bands"`; Mike authors the real look in Task 4)
- Modify: `packages/ui/src/fx/directCalls.ts` (`DIRECT_CALL_SITES` — add `consume-bands`)
- Modify: `packages/ui/src/Recruit.tsx` (`playFodderEat` ~3483; the `fodderghost` render ~5338)

**Interfaces:**
- Consumes: `getConsumeFxConfig`, `consumeTransform` (Task 1); `playDef` (`./fx/playDef`), `gsap` (already used in Recruit for `devourBolt`).

- [ ] **Step 1: Add the placeholder def + its call-site record**

Copy an existing source→target def to `packages/ui/src/fx/defs/consume-bands.json`, set `"id": "consume-bands"`. In `packages/ui/src/fx/directCalls.ts`, add to `DIRECT_CALL_SITES` (keys sorted): `'consume-bands': ['Recruit.tsx'],`.

- [ ] **Step 2: Replace the Pixi tendril with the authored def in `playFodderEat`**

In `Recruit.tsx` `playFodderEat` (~3483), the `crumbleT` timeout loops ghosts and calls `pixiFx.buffTendril(from, to, {...})` (~3519). Replace that `pixiFx.buffTendril(...)` call with:
```ts
playDef('consume-bands', { source: from, target: to, camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 } }, { uids: { source: g.eaterUid, target: g.eaterUid } });
```
(Keep the `from`/`to` measurement above it — it already computes ghost center → eater center. Remove the now-unused `getInfuseFxConfig()`/`icfg` reads only if nothing else in the function uses them; if the wiggle timing `icfg.travelMs` is still referenced, replace it with `getConsumeFxConfig().durationMs`.)

- [ ] **Step 3: Drive each ghost with a GSAP timeline (shake → taffy → pull → vanish)**

Give the rendered ghost a queryable handle: in the `fodderghost` render (~5347) add `data-gidx={i}` and a stable class token, and set the ghost's transform-origin to center. In `playFodderEat`, after `setFodderAnim`, schedule (via the existing rAF-after-mount pattern or a `requestAnimationFrame`) a GSAP timeline per ghost:
```ts
const cfg = getConsumeFxConfig();
// measured: from = ghost center, to = eater center (as computed for the def)
const el = document.querySelector<HTMLElement>(`.fodderghost[data-gidx="${i}"]`);
if (el) {
  const shakePhase = 0.28; // first ~28% is the shake, then stretch+pull take over
  gsap.to(el, {
    duration: cfg.durationMs / 1000, ease: 'none',
    onUpdate: function () {
      const t = this.progress();
      const tf = consumeTransform(from, to, t, cfg);
      // shake: decaying jitter over the first shakePhase (transform-only)
      const s = t < shakePhase ? (1 - t / shakePhase) : 0;
      const jx = s * cfg.shakeAmp * Math.sin(t * cfg.shakeFreq * Math.PI * 2);
      const jy = s * cfg.shakeAmp * Math.cos(t * cfg.shakeFreq * Math.PI * 2 * 1.3);
      el.style.transform = `translate(${tf.tx + jx}px, ${tf.ty + jy}px) rotate(${tf.rotDeg}deg) scale(${tf.scaleX}, ${tf.scaleY})`;
      el.style.opacity = String(t < 0.85 ? 1 : (1 - t) / 0.15);
    },
    onComplete: () => { el.style.opacity = '0'; },
  });
}
```
Fire the `playDef` (Step 2) at the SAME instant this timeline starts (t=0), so the bands and the pull share the clock and duration `cfg.durationMs`. Remove/replace the old CSS `fodderpop` reliance on the ghost so it doesn't fight the GSAP transform (the ghost's visual is now GSAP-driven; keep only the card face + purple wreath styling that isn't a transform/opacity keyframe). Update the cleanup `setTimeout(() => setFodderAnim(null), …)` to `cfg.durationMs + 150`.

- [ ] **Step 4: Gate the eaten stats on `showStats`**

In the `fodderghost` render, wrap the `<Card card={view} />` (which shows the eaten stats) so it renders the full card when `getConsumeFxConfig().showStats` is true, and a faceless silhouette (or the card with a `data-nostats` class that CSS hides the stat cluster on) when false. Simplest: read the config once into the render (`const showStats = getConsumeFxConfig().showStats;`) and add `className={`fodderghost${showStats ? '' : ' nostats'}`}`, with a `.fodderghost.nostats .statcell { visibility: hidden }` rule in `styles.css`.

- [ ] **Step 5: Typecheck + directCalls + a live-fire smoke**

Run: `npm run typecheck && npx vitest run packages/ui/src/fx/directCalls.test.ts` → PASS (`consume-bands` resolves in the registry; the new literal call site is accounted for).

- [ ] **Step 6: Live verify (Mike)** — in a Set-2 run, get a Demon to eat a Fodder or shop offer (e.g. Bob Blart at End of Turn, or the tavern auto-eat): confirm the ghost shakes, stretches toward and is pulled into the eater as the placeholder bands fire, and the stats show (toggle off via the tuner once Task 3 lands).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/fx/defs/consume-bands.json packages/ui/src/fx/directCalls.ts packages/ui/src/Recruit.tsx packages/ui/src/styles.css
git commit -m "feat(fx): consume ghost — GSAP shake+taffy+pull, fire consume-bands def, stats toggle"
```

---

### Task 3: Dev tuner `ConsumeFxTuner.tsx` + DevMenu registration

**Files:**
- Create: `packages/ui/src/ConsumeFxTuner.tsx` (mirror an existing tuner, e.g. `packages/ui/src/AuraFxTuner.tsx` — read it for the exact slider/reset scaffolding)
- Modify: `packages/ui/src/DevMenu.tsx` (register the panel in the tuner list, ~line 156)

**Interfaces:** Consumes `getConsumeFxConfig`/`setConsumeFxValue`/`resetConsumeFxConfig`/`CONSUMEFX_RANGES` (Task 1).

- [ ] **Step 1: Build the tuner** — a panel with one slider per `CONSUMEFX_RANGES` entry (label, min/max/step from the range, value from `getConsumeFxConfig()`, `onChange → setConsumeFxValue`), plus a **checkbox** for `showStats` (`setConsumeFxValue('showStats', e.target.checked)`) and a **Reset** button (`resetConsumeFxConfig`). Copy the structure of `AuraFxTuner.tsx` verbatim and swap the config module + keys.

- [ ] **Step 2: Register in DevMenu** — add to the tuner list (near the `spellpowerfx` / aura entries, ~`DevMenu.tsx:156`): `{ key: 'consumefx', icon: '🍖', label: 'Consume FX', hint: 'The eaten-minion shake/taffy/pull + bands', C: ConsumeFxTuner }` and import it at the top.

- [ ] **Step 3: Typecheck + lint** — `npm run typecheck && npm run lint` → clean.

- [ ] **Step 4: Live verify (Mike)** — open Dev menu → 🍖 Consume FX; dial shake/stretch/pull/duration and flip **show stats**; trigger an eat and confirm the dials + toggle apply live (config is read at fire time).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/ConsumeFxTuner.tsx packages/ui/src/DevMenu.tsx
git commit -m "feat(fx): Consume FX dev tuner (shake/stretch/pull/duration + show-stats toggle)"
```

---

### Task 4: Author the real `consume-bands` def + full gates + docs

**Files:**
- Modify: `packages/ui/src/fx/defs/consume-bands.json` (Mike authors the energy-bands look in the FX workshop; source→target, duration = `consumeFxConfig.durationMs`)
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `README.md`

- [ ] **Step 1: Author the def (Mike, workshop)** — in the FX Workbench, author `consume-bands` as a source→target def of energy bands pulling from the eaten ghost toward the eater; set its `duration` to match `D` (default 800). Save (overwrites the placeholder). Tune the ghost feel (Task 3 tuner) alongside it so the bands and the pull land together.

- [ ] **Step 2: Full gates** — `npm run typecheck && npm run lint && npm test && npm run build:web` → all green. (Full `npm test` covers `directCalls.test.ts` + the whole suite.)

- [ ] **Step 3: Docs** — prepend a `docs/devlog.md` entry (replace the ghost-Fred swirl with shake+taffy+bands across every shop eater; the GSAP-conducts-the-clock sync; the `consume-bands` def + tuner; combat/orphans out); refresh the README "Recent changes"; move any related roadmap item. Commit with the code or as a follow-up.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/fx/defs/consume-bands.json docs/devlog.md docs/roadmap.md README.md
git commit -m "feat(fx): author consume-bands energy-bands def + docs"
```

---

## Notes for the executor

- **`playFodderEat` is the single choke point** — it is reached from the mid-turn watchers AND the EoT beat loop AND (remapped) `shopEaten`. Do the rewire ONCE there; do not add a second path.
- **Read `aimFxConfig.ts` and `AuraFxTuner.tsx` before writing the config/tuner** — match their exact getter/persist/slider scaffolding rather than inventing a variant.
- **GSAP is already imported in `Recruit.tsx`** (see `devourBolt`); reuse it, don't add a dep.
- **Measure the eater ONCE per eat** (already done in `playFodderEat`), never per frame; the GSAP `onUpdate` only reads the cached `from`/`to`.
- **Don't touch** the sim, the not-eats, the two devour orphans, or combat.
