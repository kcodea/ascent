# Crystal Fuse Charge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the end-of-turn Charge Glyph's look with a crystal fuse that burns left→right into the End Turn
gem, driven by a seeded force simulation, with every existing timing/sound/pause behaviour unchanged.

**Architecture:** A renderer-free simulation module (`fuseSim.ts`) owns particles and forces. A small render module
(`fuseRender.ts`) draws it on two 2D canvases: one behind the cards (the debris stream) and one over the End Turn
button (the gem swirl). The existing `ChargeGlyph` component in `Recruit.tsx` keeps all its clock/hold/sound wiring
and swaps its visuals: a CSS-masked fuse image plus the sim. Tuning lives in `fuseTune.ts` with a Dev Menu panel.

**Tech Stack:** React 18 + TypeScript, 2D canvas, CSS masks, Vitest (jsdom where needed).

**Spec:** `docs/superpowers/specs/2026-10-26-crystal-fuse-charge-design.md` (read it first; this plan argues from it).

## Global Constraints

- Behaviour contract (spec table "What must stay exactly the same") is untouched: window
  `min(CHARGE_SECONDS, turnSeconds)`, `chargeElapsed` drives progress, holds via `useTurnClockRunning`, `covered`,
  `quiet`, `sfx.turnCharge(offset)` / `stopTurnCharge(CHARGE_HOLD_FADE_MS)`, `sfx.turnExplode()` at 0:00 (Recruit.tsx
  ~L5279, unchanged), `ShopTimer`'s last-5s tick + `final-countdown-tick` (unchanged), perf marks
  `chargeglyph:lit` / `chargeglyph:out`.
- `R-TIMER-SYNC-01`: fuse, particles, gem and sound all freeze when the clock is held and resume in place.
- Performance north star (CLAUDE.md): one rAF while lit; sprite-blit (pre-baked sprites), never per-particle
  gradients; no looping CSS animation on paint properties; rects measured once per light (plus on window resize),
  never per frame.
- Stage rule (CLAUDE.md): measure in screen space (`getBoundingClientRect`); convert with `rectToStage` / `toStage`
  only where a value is written into a CSS length; portal into `stageHost()`, never `document.body`; no raw `vw`/`vh`.
- No `title=` attributes; no bare `cursor:` keywords (the overlays are `pointer-events: none` anyway).
- `Math.random` is allowed in `packages/ui`, but the sim uses `makeRng(seed)` from `packages/ui/src/fx/rng.ts` so a
  "lock seed" toggle can replay one look.
- Never edit `docs/docbot2/final-report.md`. Patch notes entry required (in-game UI change).
- Work in a worktree: `.claude/worktrees/crystal-fuse` off latest `origin/main`, branch `feat/crystal-fuse`; run
  `npm install` inside it before trusting checks. Never push to `main`; PR + green `verify`, squash-merge.

## Review Focus

1. **A long wait after 0:00** (player goes AFK for minutes before End Turn): the cost must stay flat. No spawning,
   live particles ≤ `idleOrbiters`, no growth. → Task 2 test `idle wait stays bounded`.
2. **A hold mid-window** (Discover, Esc menu, Ancients offer): nothing moves, and the resume takes no catch-up jump.
   → Task 2 test `step(0) is an exact no-op`; Task 5 updates `chargeGlyphHold.test.ts` to pin "no sim step while held".
3. **Continue / un-cover onto a dead clock (0:00):** no collapse burst, no sound; straight to the charged idle.
   → Task 5 test on `fusePhaseOnLight`.
4. **End Turn pressed on the very frame the clock hits 0:** treat it as a press after 0:00 (release with the strike,
   no flash-and-fade, one strike). → Task 5 test on `fuseExitKind`; Task 6 test on the strike dedupe.
5. **A turn whose window is shorter than 20 s, or a frame hitch** (one 200 ms step): debris spawned at the front must
   follow fuse progress (charge delta), not frame time, so a hitch does not leave a gap or a burst.
   → Task 2 test `spawn tracks charge, not dt`.

---

### Task 0: Worktree setup

- [ ] **Step 1:** `cd C:/Users/micha/Desktop/ascent && git fetch origin && git worktree add .claude/worktrees/crystal-fuse -b feat/crystal-fuse origin/main`
- [ ] **Step 2:** `cd .claude/worktrees/crystal-fuse && npm install` → completes without errors.
- [ ] **Step 3:** Copy the owner's art in: `cp "C:/Users/micha/Desktop/Reference Art/test countdown.png" apps/web/public/fx/crystal-fuse.png`
  (1929×194 RGBA). Committed in Task 4 with the CSS that uses it.
- [ ] **Step 4:** The spec and this plan were written in the primary checkout (uncommitted). Move them into the
  worktree (`docs/superpowers/specs/2026-10-26-crystal-fuse-charge-design.md`,
  `docs/superpowers/plans/2026-10-26-crystal-fuse-charge.md`), delete the primary-checkout copies, and commit
  `docs: crystal fuse design + plan`.

---

### Task 1: Tuning config (`fuseTune.ts`)

**Files:**
- Create: `packages/ui/src/fuseTune.ts`
- (`chargeGlyphTune.ts` keeps `chargePreview` / `useChargePreview`; its `chargeTune` export is deleted in Task 8,
  after its last users go in Tasks 5 and 7.)
- Test: `packages/ui/src/fuseTune.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FuseCfg {
    aggression: number;      // master: scales every force's ramp (0..2, default 1)
    rampPow: number;         // ramp curve exponent; force(p) = base * (floor + (1-floor) * p^rampPow) * aggression
    rampFloor: number;       // 0..1 share of each force present at charge 0
    pull: number;            // px/s² constant-magnitude pull toward gem (like burst.ts pointGravity)
    vortex: number;          // px/s² tangential push at vortexR
    vortexR: number;         // px (stage) radius where vortex is at full strength; falls off as (vortexR / max(d, vortexR*0.25))
    turbulence: number;      // px/s², uses fx/motion.ts turbulenceX/Y
    turbScale: number;       // spatial frequency for turbulenceX/Y
    drag: number;            // per-second velocity retention (0..1), applied as drag^dt
    shardMass: number;       // ≥1; force/mass for shards
    moteMass: number;        // ≥0.2
    spawnPerFuse: number;    // particles spawned over the whole fuse (charge 0→1)
    shardShare: number;      // 0..1 share of spawns that are shards
    spawnSpeed: number; spawnSpeedVar: number;
    shardSize: number; moteSize: number; sizeVar: number;
    life: number; lifeVar: number;      // seconds (particles also die on absorb)
    maxLive: number;         // hard cap on live particles
    captureR: number;        // px: inside this a particle is drawn by the gem overlay
    absorbR: number;         // px: inside this it is absorbed
    collapsePull: number;    // px/s² pull used during the 0:00 collapse
    idleOrbiters: number;    // particles kept orbiting during the 0:00→press wait
    idleVortex: number;      // calm vortex during the wait
    gemGlow: number; gemGlowSize: number; // peak glow alpha, glow radius px
    burnFeather: number;     // % soft edge of the burning front
    frontGlow: number; frontGlowW: number;
    flashOutMs: number;      // early End Turn flash-and-fade length (owner: very quick; default 180)
    flashOutPeak: number;    // brightness multiplier of that flash
    colorShard: string; colorMote: string; colorHot: string; colorGem: string;
  }
  export const FUSE_DEFAULTS: FuseCfg;
  export function getFuseCfg(): FuseCfg;                 // prod → FUSE_DEFAULTS; dev → localStorage overrides
  export function setFuseValue(key: keyof FuseCfg, v: number | string): void;
  export function resetFuseCfg(): void;
  export function forceRamp(cfg: FuseCfg, charge: number): number; // the multiplier above
  export const fuseSeed: { locked: number | null };       // dev "lock seed"; null = fresh per light
  ```
  Persistence follows `endTurnConfig.ts` (`KEY = 'ascent.crystalFuse'`, dev-only overrides, `try/catch` around storage).

- [ ] **Step 1: Write the failing tests** in `fuseTune.test.ts`:
  - `forceRamp(FUSE_DEFAULTS, 0)` equals `FUSE_DEFAULTS.rampFloor * FUSE_DEFAULTS.aggression`.
  - `forceRamp(cfg, 1)` equals `cfg.aggression` (1 at defaults).
  - monotonic: `forceRamp(cfg, 0.3) < forceRamp(cfg, 0.6) < forceRamp(cfg, 0.9)`.
  - `forceRamp({...cfg, aggression: 2}, 0.5) === 2 * forceRamp(cfg, 0.5)`.
  - `setFuseValue('pull', 999)` then `getFuseCfg().pull === 999`; `resetFuseCfg()` restores `FUSE_DEFAULTS.pull`.
  - `FUSE_DEFAULTS.flashOutMs <= 200` (owner: "flash and fade out very quickly").
- [ ] **Step 2:** `npx vitest run packages/ui/src/fuseTune.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `fuseTune.ts` per Interfaces. Pick starting defaults that look like the approved
  prototype (stage px; ~1400 px fuse): e.g. pull 420, vortex 520, vortexR 70, turbulence 140, drag 0.35,
  shardMass 2.4, moteMass 0.6, spawnPerFuse 1400, shardShare 0.35, maxLive 700, captureR 90, absorbR 14,
  idleOrbiters 10. Also add `seamBoost: number` (front-glow multiplier at a seam, default 1.8; owner may set 1 to
  drop the seam flare) and `export const FUSE_SEAMS: readonly number[]`: the bright-seam x fractions of
  `crystal-fuse.png` (measure them once from the image's brightest columns; roughly every 1/12).
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit `feat(ui): crystal fuse tuning config`.

---

### Task 2: The simulation (`fuseSim.ts`)

**Files:**
- Create: `packages/ui/src/fuseSim.ts`
- Test: `packages/ui/src/fuseSim.test.ts`

**Interfaces:**
- Consumes: `FuseCfg`, `forceRamp` (Task 1); `makeRng` (`fx/rng.ts`); `turbulenceX/Y` (`fx/motion.ts`).
- Produces:
  ```ts
  export type FuseKind = 'shard' | 'mote';
  export interface FuseParticle {
    kind: FuseKind; x: number; y: number; vx: number; vy: number;
    mass: number; size: number; rot: number; spin: number;
    age: number; life: number; heat: number;       // heat 1→0, drives white-hot colour
  }
  export interface FuseGeom {
    fuseX0: number; fuseX1: number; fuseY: number; // the fuse span (sim space = stage px)
    fuseThick: number;                              // spawn y spread
    gemX: number; gemY: number;
  }
  export type FuseMode = 'charging' | 'collapsing' | 'idle';
  export class FuseSim {
    constructor(cfg: FuseCfg, seed: number);
    reset(seed: number): void;
    setCfg(cfg: FuseCfg): void;
    step(dtSec: number, charge: number, g: FuseGeom): void;
    collapse(): void;            // 0:00 → mode 'collapsing'; stops spawning, pull = collapsePull
    prewarm(charge: number, g: FuseGeom, maxSteps?: number): void; // default maxSteps 90 (1.5 s @ 60 Hz)
    readonly particles: readonly FuseParticle[];
    readonly mode: FuseMode;
    readonly absorbPulse: number; // 0..1, bumps per absorb, decays ~4/s; feeds gem glow
    readonly collapseDone: boolean; // true once a collapse has absorbed all but ≤ idleOrbiters
  }
  ```
  Physics per particle per step (stage px): `a = (pullVec + vortexVec + turbVec) * forceRamp(cfg, charge) / mass`;
  pull is unit-direction × `pull` (constant magnitude, skip when `d < 0.01`); vortex is the perpendicular
  (clockwise on screen) × `vortex × min(1, vortexR / max(d, vortexR*0.25))`; `v *= drag ** dt`; integrate.
  Spawning: on each step spawn `round(spawnPerFuse × (charge − lastCharge) + carry)` at `x = fuseX0 + charge ×
  (fuseX1 − fuseX0)`, y within `fuseThick`, velocity random up/back with `spawnSpeed`; never above `maxLive`.
  Absorb at `d < absorbR`. In 'idle' (entered automatically after the collapse leaves ≤ `idleOrbiters`), no
  spawning, no absorb, pull/vortex replaced by a calm orbit force (`idleVortex`, weak pull) so the survivors circle.

- [ ] **Step 1: Write the failing tests** (`fuseSim.test.ts`, fixed `geom` with fuse 0→1000 at y 0, gem at 1100,0):
  - `same seed, same inputs → identical particles` (run 120 steps at charge ramping 0→0.5 twice, deep-equal).
  - `different seeds diverge` (positions differ after 60 steps).
  - `step(0) is an exact no-op` (snapshot particles, `step(0, sameCharge, g)`, deep-equal).
  - `spawn tracks charge, not dt`: one `step(0.2, 0.1)` spawns the same count as ten `step(0.02, …)` steps reaching
    charge 0.1 (± 1, from the carry), both ≈ `spawnPerFuse × 0.1`.
  - `pull draws a still particle toward the gem` (inject one via a test-only `__add(p)` or spawn then zero velocity;
    after 30 steps its distance to the gem is smaller).
  - `vortex gives tangential motion` (a particle at the gem's left with zero velocity gains `vy` of the vortex's sign).
  - `heavier shards turn slower` (shard and mote at the same spot: after one step the mote's |Δv| > shard's).
  - `absorb inside absorbR` (a particle placed at the gem centre is gone after one step; `absorbPulse > 0`).
  - `maxLive is never exceeded` (step charge 0→1 in one call with `spawnPerFuse` 10× maxLive).
  - `collapse empties to idle`: after `collapse()`, 4 s of steps at charge 1 → `collapseDone`, `mode === 'idle'`,
    `particles.length <= cfg.idleOrbiters`.
  - `idle wait stays bounded`: then 600 s of 1/60 steps → length never grows, all particles stay within
    `vortexR * 3` of the gem.
  - `prewarm fills in debris` (`prewarm(0.6, g)` → `particles.length > 0`, and it ran ≤ `maxSteps` steps:
    expose `lastPrewarmSteps` or assert via a spy on `step`).
- [ ] **Step 2:** `npx vitest run packages/ui/src/fuseSim.test.ts` → FAIL.
- [ ] **Step 3:** Implement `FuseSim` per Interfaces. Allocation-free hot loop (reuse particle objects via a pool;
  compact dead ones in one pass like `emitter.ts`).
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit `feat(ui): crystal fuse force simulation`.

---

### Task 3: Rendering (`fuseRender.ts`)

**Files:**
- Create: `packages/ui/src/fuseRender.ts`
- Test: `packages/ui/src/fuseRender.test.ts`

**Interfaces:**
- Consumes: `FuseSim`, `FuseParticle`, `FuseGeom` (Task 2); `FuseCfg` (Task 1).
- Produces:
  ```ts
  export interface FuseView { ox: number; oy: number; scale: number; dpr: number } // stage px → canvas CSS px: (x - ox) * scale
  export function inGemPass(p: FuseParticle, g: FuseGeom, captureR: number): boolean;
  export class FuseRenderer {
    constructor(cfg: FuseCfg);
    setCfg(cfg: FuseCfg): void;                 // re-bakes sprites
    drawBehind(ctx: CanvasRenderingContext2D, sim: FuseSim, g: FuseGeom, v: FuseView): void;
    drawGem(ctx: CanvasRenderingContext2D, sim: FuseSim, g: FuseGeom, v: FuseView, charge: number, timeSec: number): void;
    burst(): void;   // the 0:00 collapse burst (a one-shot ring + white flash on the gem pass, ~cfg-driven)
  }
  ```
  Sprites baked once per cfg (radial glow per colour, a shard sprite cut from `crystal-fuse.png` when loaded, else a
  diamond). The gem pass draws: glow (alpha `gemGlow × (0.15 + 0.85 charge²) + absorbPulse`), the burst, then
  particles where `inGemPass` is true. The behind pass draws the rest. Additive (`'lighter'`) composite. No
  `createRadialGradient` per particle or per frame (bake).

- [ ] **Step 1: Write the failing tests:** `inGemPass` true at distance `captureR - 1`, false at `captureR + 1`;
  with a stub ctx (`drawImage` counter), `drawBehind` + `drawGem` together draw each live particle exactly once;
  neither pass calls `createRadialGradient` (stub throws if called) after construction.
- [ ] **Step 2:** `npx vitest run packages/ui/src/fuseRender.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit `feat(ui): crystal fuse renderer`.

---

### Task 4: The fuse look in CSS + art

**Files:**
- Add: `apps/web/public/fx/crystal-fuse.png` (from Task 0)
- Modify: `packages/ui/src/styles.css` (`.chargeglyph` block ~L847–922)
- Modify: `packages/ui/src/layoutConfig.ts` (Charge Glyph rows ~L108–114)

**Interfaces:**
- Produces DOM contract used by Task 5: `.chargeglyph` (box) containing `.fuse-body` (the image, masked) and
  `.fuse-front` (front glow); classes `.fading` (generic fade), `.flashout` (early End Turn), `.held` (pause);
  vars `--charge` (0→1), `--feather` (%), `--front-boost` (seam flare multiplier), `--flash-ms` (ms),
  `--flash-peak`; behind-cards canvas `.charge-motes`; gem canvas
  `.fuse-gemfx`.

- [ ] **Step 1:** Replace the three `.masked` layers with `.fuse-body`: `background: url('/fx/crystal-fuse.png')
  center / contain no-repeat;` plus a mask `linear-gradient(90deg, transparent 0, transparent calc(var(--charge) *
  100%), #fff calc(var(--charge) * 100% + var(--feather)), #fff 100%)` (the burnt part on the LEFT disappears).
  `aspect-ratio: 1929 / 194`. `.fuse-front`: a narrow white→cyan radial positioned at `left: calc(var(--charge) *
  100%)`, `transform`-based; its opacity is `min(1, var(--front-glow) * var(--front-boost, 1))` (written per frame
  as a custom prop, like `--charge`). `.chargeglyph.flashout`: `filter: brightness(var(--flash-peak))`
  one-shot then `opacity: 0` over `var(--flash-ms)` (one-shot paint animation is allowed). Delete the old
  `.charge-base/.charge-fill/.charge-core` rules and `chargepulse` keyframes. Add `.fuse-gemfx { position: fixed;
  pointer-events: none; z-index: 42; }` (above `.etbwrap` z 41). Keep `.charge-motes` (resized in Task 5).
- [ ] **Step 2:** Layout Lab: keep the `--charge-w/-x/-yoff` rows (rename group label to "Crystal Fuse"); set
  defaults so the fuse's right tip meets the End Turn gem on a 1920×1080 stage, and mirror them into the CSS
  fallbacks (`.chargeglyph` width/transform). Verify by eye in a dev build with the Task 7 preview (or temporarily
  pin `--charge: 0` in DevTools).
- [ ] **Step 3:** `npx vitest run packages/ui/src/stageTripwire.test.ts packages/ui/src/publicAssetPaths.test.ts` → PASS.
- [ ] **Step 4:** Commit `feat(ui): crystal fuse art and burn mask` (include the PNG).

---

### Task 5: Wire it into `ChargeGlyph`

**Files:**
- Modify: `packages/ui/src/Recruit.tsx` (`ChargeGlyph`, ~L561–710; constants ~L441–443)
- Create: `packages/ui/src/fusePhase.ts` + `packages/ui/src/fusePhase.test.ts`
- Modify: `packages/ui/src/chargeGlyphHold.test.ts`, `packages/ui/src/turnTick.test.ts` (only where they assert
  the old visuals / old names)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces (`fusePhase.ts`):
  ```ts
  export type FuseLightPhase = 'charging' | 'charged';
  export function fusePhaseOnLight(secondsLeft: number): FuseLightPhase; // 0 → 'charged' (no burst, silent)
  export type FuseExit = 'flashFade' | 'release';
  export function fuseExitKind(secondsLeftAtUnlight: number): FuseExit; // > 0 → 'flashFade'; ≤ 0 → 'release'
  ```

- [ ] **Step 1: Write the failing tests** (`fusePhase.test.ts`): `fusePhaseOnLight(7) === 'charging'`,
  `fusePhaseOnLight(0) === 'charged'`; `fuseExitKind(3) === 'flashFade'`, `fuseExitKind(0) === 'release'`,
  `fuseExitKind(-1) === 'release'`. In `chargeGlyphHold.test.ts` add a source pin: the `ChargeGlyph` slice contains
  `heldRef.current` guarding the sim step (regex `/if \(!heldRef\.current\)[^\n]*sim\.step/`) and no
  `ChargeMotes` reference.
- [ ] **Step 2:** Run both test files → FAIL.
- [ ] **Step 3:** Implement `fusePhase.ts`, then rework `ChargeGlyph`, keeping every clock/hold/sound/`lit`/
  `covered`/`quiet`/perf-mark line as it is. Changes:
  - Markup: `.chargeglyph` → `.fuse-body` + `.fuse-front`; `.charge-motes` canvas (behind); a `.fuse-gemfx` canvas
    portalled into `stageHost()`.
  - On light: measure the fuse box and `.etbwrap` (`document.querySelector('.etbwrap')`) once with
    `getBoundingClientRect`; size `.charge-motes` to span fuse-left → gem (+ `captureR` margin) and `.fuse-gemfx`
    to a square of `2 × (captureR + gemGlowSize)` centred on the gem, writing CSS lengths via `rectToStage`.
    Build `FuseGeom` in stage px. Re-measure on `window` `resize` (listener added/removed with the light).
  - Seed: `fuseSeed.locked ?? randomSeed()` per light; `new FuseSim(getFuseCfg(), seed)`, `new FuseRenderer(...)`.
  - Phase on light: `fusePhaseOnLight(seconds)`. `'charging'` with `chargeElapsed > 0.5` → `sim.prewarm(charge, g)`.
    `'charged'` → `sim.collapse()` then step it to idle off-screen (bounded), no `burst()`.
  - One rAF: paint `--charge`/`--feather` (existing) and `--front-boost` (= `seamBoost` easing to 1 over ~2% of the
    fuse either side of the nearest `FUSE_SEAMS` entry, else 1), then `if (!heldRef.current) sim.step(dt, charge, g)`, then
    `drawBehind` + `drawGem`. When `held`, paint once and draw once, no rAF (as today).
  - 0:00 while lit and running: on the first frame `charge >= 1`, call `sim.collapse()` + `renderer.burst()` once
    (lands with `sfx.turnExplode()`, which fires on the same clock step).
  - Unlight (End Turn, Versus `quiet`, `covered`, combat): `fuseExitKind(turnClock.get())`. `'flashFade'` → add
    `.flashout` with `--flash-ms` = `flashOutMs` and `--flash-peak` = `flashOutPeak`, unmount after that; `'release'` → clear both canvases and unmount within
    `flashOutMs` (the gem's own strike carries the moment). Replace `CHARGE_FADEOUT_MS` with the cfg value; keep
    `stopTurnCharge()` calls exactly where they are.
  - Delete the core-bloom paint, the `chargeTune` import and the `ChargeMotes` import.
- [ ] **Step 4:** `npx vitest run packages/ui/src/fusePhase.test.ts packages/ui/src/chargeGlyphHold.test.ts packages/ui/src/turnTick.test.ts` → PASS.
- [ ] **Step 5:** `npm run typecheck && npm run lint` → clean.
- [ ] **Step 6:** Commit `feat(ui): end-of-turn charge becomes the crystal fuse`.

---

### Task 6: The strike on every End Turn path (Versus auto-advance)

**Files:**
- Modify: `packages/ui/src/EndTurnButton.tsx` (`playStrike` ~L80–100)
- Modify: `packages/ui/src/versus/VersusHud.tsx` (~L82–86)
- Test: `packages/ui/src/endTurnStrikeOnce.test.tsx` (pattern: `skipDiamond.test.tsx` mounting)

**Interfaces:**
- Consumes: `emitPressCue('endTurn')` (`pressCue.ts`).
- Produces: `playStrike` is idempotent per press: a second strike while `pressed` stays true is skipped (reset when
  `pressed` flips false — the relight).

- [ ] **Step 1: Write the failing test:** mount `<EndTurnButton … pressed={false} />`, click it, rerender with
  `pressed`, then `emitPressCue('endTurn')` → exactly one `.etb-flash` appeared across the sequence (count insertions
  via a MutationObserver or spy on `playDef('impact-dust', …)` with `vi.mock('./fx/playDef')`). Second case:
  `pressed` false→true with no click, then `emitPressCue('endTurn')` → one strike.
- [ ] **Step 2:** `npx vitest run packages/ui/src/endTurnStrikeOnce.test.tsx` → FAIL (second strike plays).
- [ ] **Step 3:** Add a `struckRef` guard to `playStrike` (set on strike, cleared in the relight effect when
  `pressed` → false). In `VersusHud`, call `emitPressCue('endTurn')` immediately before `endTurn()` in the
  fire effect. Spectate's existing emits now dedupe too.
- [ ] **Step 4:** Re-run, plus `npx vitest run packages/ui/src/skipDiamond.test.tsx packages/ui/src/versus` → PASS.
- [ ] **Step 5:** Commit `feat(ui): the End Turn gem strikes on the Versus auto End Turn too`.

---

### Task 7: The Crystal Fuse tuner (replaces Charge Glyph tuner)

**Files:**
- Create: `packages/ui/src/CrystalFuseTuner.tsx`
- Delete: `packages/ui/src/ChargeGlyphTuner.tsx`
- Modify: `packages/ui/src/DevMenu.tsx` (~L102, ~L304), `packages/ui/src/tunerAll.ts` (~L33, ~L134)

**Interfaces:**
- Consumes: `getFuseCfg/setFuseValue/resetFuseCfg/FUSE_DEFAULTS/fuseSeed` (Task 1), `chargePreview`.
- Produces: `export const SPEC: TunerSpec<FuseCfg>`; `export function CrystalFuseTuner(): JSX.Element`.
  Panel id `'crystalfuse'`, title "Crystal Fuse", groups in order: Master (aggression, rampPow, rampFloor), Forces,
  Spawning, Gem, Fuse, Colours. Readout block: scrub (sets `chargePreview` 0→1), Play 20 s, "Show 0:00" (preview at
  1 → collapse → idle), "Lock seed" toggle (writes `fuseSeed.locked`). Copy → JSON of the cfg for `FUSE_DEFAULTS`.
  Closing restores `chargePreview.set(null)` and `fuseSeed.locked = null`.
  The live `ChargeGlyph` must re-read `getFuseCfg()` (call `sim.setCfg`/`renderer.setCfg` on a tuner change event,
  e.g. a `window` `'ascent:fusecfg'` event dispatched by `setFuseValue`).

- [ ] **Step 1:** Run the existing tuner suite to learn its contract: `npx vitest run packages/ui/src -t "tuner"` → note
  what `tunerAll` / `assertGroupRuns` require.
- [ ] **Step 2:** Implement the panel and the menu/registry swap (`key: 'crystalfuse'`, icon 💎, hint "The
  end-of-turn crystal fuse").
- [ ] **Step 3:** Re-run the tuner suite → PASS; `npm run typecheck` → clean.
- [ ] **Step 4:** Commit `feat(ui): Crystal Fuse dev tuner`.

---

### Task 8: Remove the old glyph

**Files:**
- Delete: `packages/ui/src/chargeMotes.ts`, `apps/web/public/fx/turn-glyph.svg`,
  `apps/web/public/fx/turn-glyph-preview.html`, `apps/web/public/fx/turn-glyph-motes-preview.html`
- Modify: `packages/ui/src/chargeGlyphTune.ts` (delete the `chargeTune` export; keep `chargePreview`)

- [ ] **Step 1:** `git grep -n "turn-glyph\|chargeMotes\|ChargeMotes\|chargeTune\|ChargeGlyphTuner"` → only docs/devlog
  history remains (fix any live code/test reference).
- [ ] **Step 2:** Delete the files; `npx vitest run packages/ui/src/publicAssetPaths.test.ts` → PASS.
- [ ] **Step 3:** Commit `chore(ui): remove the old charge glyph sigil and motes`.

---

### Task 9: Docs, rules, verification, PR

**Files:**
- Modify: `packages/ui/src/patchNotes.ts` (prepend), `packages/rules/src/registry/approved/triggers.ts`
  (`R-TIMER-SYNC-01` `currentBehaviour` / code refs only, if they name the old glyph visuals)
- Create: `docs/devlog/2026-10-26-crystal-fuse.md`
- Modify: `.claude/skills/ascent-choreography` if it describes the charge glyph (grep it)

- [ ] **Step 1:** Patch note (Systems): "The end-of-turn countdown is now a crystal fuse that burns into the End Turn
  gem, which charges up and strikes when you end the turn." Devlog entry: what changed, owner rulings (0:00 collapse →
  charged wait → press strike; early press flash-and-fade; Versus strike), tuner location.
- [ ] **Step 2:** `npx vitest run packages/rules && npm run docbot:report -- --check` → PASS.
- [ ] **Step 3:** Full gates: `npm run typecheck && npm run lint && npm test && npm run build:web` → all green.
- [ ] **Step 4:** Perf check on the prod build (`npm run build:web` + preview): Chrome DevTools performance trace over
  the last 20 s of a turn with a full board, then the 0:00 wait for 30 s. Expect no long frames attributable to the
  fuse; the wait shows near-idle rAF cost. Record the numbers in the PR body.
- [ ] **Step 5:** `git push -u origin feat/crystal-fuse`; `gh pr create` (body ends with the Claude Code line);
  `gh pr checks <n> --watch` until `verify` is green. Merge only on the owner's go-ahead.
