# Corner-Clack Contact + Distance-Scaled Lunge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the combat attack lunge land as a *corner clack* — the attacker leads with a tilted corner, stops at the defender's surface (no center-overshoot), and both cards jolt — and make the strike duration scale with travel distance so apparent speed stays constant near→far.

**Architecture:** All changes are in the choreographer's UI presentation layer — a new pure `contactGeometry` helper (surface travel + distance-scaled duration + signed lead-tilt), consumed by `playLunge` (attacker motion) and `playContactImpact` (defender reaction), wired in `engine.ts` which measures both cards' rects. Every parameter is a dial in `lungeConfig` (DEV Lunge tuner) so the feel is tuned by eye and baked as defaults. **No `@game/core`/`content`/`sim` changes — nothing affects fight outcomes.** The beat-clock advance already rides the real GSAP contact position, so distance-scaled duration needs no scheduler change.

**Tech Stack:** TypeScript monorepo (`packages/ui`), React + GSAP + PixiJS. Vitest in the node env (no jsdom — tests use stubbed `Element`s; GSAP timelines are seeked via `.progress()`/`.duration()` without real time). Spec: `docs/superpowers/specs/2026-07-08-corner-clack-contact-design.md`. **Branch:** `feat/corner-clack-contact` (already created off latest `main`; the spec is already committed on it).

---

### Task 0: Confirm branch

- [ ] **Step 1: Verify you are on the feature branch with the spec committed**

Run: `git branch --show-current && git log --oneline -1`
Expected: branch `feat/corner-clack-contact`; top commit is the `docs(spec): corner-clack contact…` commit.

---

### Task 1: Extend `lungeConfig` with the corner-clack + distance dials

**Why:** Add the seven new tunable parameters and retire `strikeDist` (replaced by surface `travel` + `bite`). `strikeDur` stays as the unresolved-elements fallback. The DEV tuner renders from `LUNGE_KEYS`/`LUNGE_RANGES` automatically, so adding keys + a label is all the UI needs.

**Files:**
- Modify: `packages/ui/src/lungeConfig.ts`
- Modify: `packages/ui/src/LungeTuner.tsx:12-21` (LABELS map)
- Test: `packages/ui/src/lungeConfig.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/lungeConfig.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { getLungeConfig, LUNGE_KEYS, LUNGE_RANGES } from './lungeConfig';

describe('lungeConfig corner-clack dials', () => {
  it('exposes the new contact + distance dials with defaults', () => {
    const c = getLungeConfig();
    expect(c.bite).toBeGreaterThan(0);
    expect(c.leadTilt).toBeGreaterThan(0);
    expect(c.defenderSpin).toBeGreaterThan(0);
    expect(c.attackerRebound).toBeGreaterThan(0);
    expect(c.targetSpeed).toBeGreaterThan(0);
    expect(c.minStrikeDur).toBeLessThan(c.maxStrikeDur);
  });
  it('gives every key a slider range', () => {
    for (const k of LUNGE_KEYS) expect(LUNGE_RANGES[k]).toHaveLength(3);
  });
  it('has retired strikeDist', () => {
    expect((getLungeConfig() as Record<string, number>).strikeDist).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @game/ui -- lungeConfig`
Expected: FAIL — `bite`/`leadTilt`/… undefined; `strikeDist` still present.

- [ ] **Step 3: Update `lungeConfig.ts`**

In `packages/ui/src/lungeConfig.ts`, replace the `strikeDist` field in the `LungeConfig` interface and add the new fields (keep `strikeDur`, `windup*`, `smackLead`, `settleDur`, `attackGap`):
```ts
  /** Strike duration (s) — FALLBACK only (used when elements are unresolved). Live strikes derive
   *  duration from travel distance (see contactGeometry). */
  strikeDur: number;
  /** Bite (px) — how far the leading corner drives past surface contact, so it visibly bites in. */
  bite: number;
  /** Lead tilt (deg) — the attacker tilts this much to lead with a corner (sign chosen from dx). */
  leadTilt: number;
  /** Defender spin (deg) — the defender counter-rotates this much on impact (opposite the lead). */
  defenderSpin: number;
  /** Attacker rebound (deg) — the attacker's rotational kick-back at contact before the settle. */
  attackerRebound: number;
  /** Target speed (px/s) — strike travel speed that sets the (distance-scaled) strike duration. */
  targetSpeed: number;
  /** Strike duration clamp floor (s). */
  minStrikeDur: number;
  /** Strike duration clamp ceiling (s). */
  maxStrikeDur: number;
```
Delete the `strikeDist` interface line. In `DEFAULTS`, remove `strikeDist` and add (starting dials — tuned in Task 6):
```ts
  strikeDur: 0.16,   // fallback only now (elements unresolved); live strikes derive from distance
  bite: 6,
  leadTilt: 7,
  defenderSpin: 6,
  attackerRebound: 5,
  targetSpeed: 1600,
  minStrikeDur: 0.1,
  maxStrikeDur: 0.28,
```
In `LUNGE_RANGES`, remove `strikeDist` and add:
```ts
  bite: [0, 24, 1],
  leadTilt: [0, 20, 0.5],
  defenderSpin: [0, 20, 0.5],
  attackerRebound: [0, 20, 0.5],
  targetSpeed: [600, 3000, 50],
  minStrikeDur: [0.05, 0.2, 0.01],
  maxStrikeDur: [0.15, 0.45, 0.01],
```

- [ ] **Step 4: Update the tuner LABELS**

In `packages/ui/src/LungeTuner.tsx`, replace the `strikeDist` label line and add labels so the `LABELS` map covers every key:
```ts
  strikeDur: 'strike dur (fb)',
  bite: 'corner bite',
  leadTilt: 'lead tilt',
  defenderSpin: 'defender spin',
  attackerRebound: 'atk rebound',
  targetSpeed: 'target px/s',
  minStrikeDur: 'min strike',
  maxStrikeDur: 'max strike',
```
(Remove the old `strikeDist: 'lunge dist',` entry.)

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @game/ui -- lungeConfig`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/lungeConfig.ts packages/ui/src/LungeTuner.tsx packages/ui/src/lungeConfig.test.ts
git commit -m "feat(ui): corner-clack lunge dials in lungeConfig + tuner"
```

---

### Task 2: The `contactGeometry` pure helper (surface travel + distance-scaled duration + lead tilt)

**Why:** The heart of asks #1 and #2, kept pure (no GSAP/DOM) so it's exhaustively unit-testable. Given the attacker→defender vector and both cards' rects, it returns where the strike should land (surface contact + bite), how long the strike should take (distance / targetSpeed, clamped), and the signed lead-tilt.

**Files:**
- Create: `packages/ui/src/choreo/contactGeometry.ts`
- Test: `packages/ui/src/choreo/contactGeometry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/choreo/contactGeometry.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { contactGeometry, type RectSize } from './contactGeometry';

const cfg = { bite: 6, targetSpeed: 1600, minStrikeDur: 0.1, maxStrikeDur: 0.28, leadTilt: 7 };
const card = (): RectSize => ({ width: 80, height: 100 });

describe('contactGeometry', () => {
  it('strike stops at the surface (center distance minus both half-extents, plus bite)', () => {
    // straight up: dy = -300, cards 100 tall → travel = 300 - 50 - 50 + 6 = 206
    const g = contactGeometry(0, -300, card(), card(), cfg);
    expect(g.strike.x).toBeCloseTo(0, 5);
    expect(g.strike.y).toBeCloseTo(-206, 5);
  });
  it('scales strike duration with travel, clamped to [min, max]', () => {
    const near = contactGeometry(0, -120, card(), card(), cfg); // travel small → clamps to min
    const far = contactGeometry(0, -3000, card(), card(), cfg);  // travel huge → clamps to max
    expect(near.strikeDur).toBeCloseTo(0.1, 5);
    expect(far.strikeDur).toBeCloseTo(0.28, 5);
    // a mid distance lands strictly between the clamps and equals travel / targetSpeed
    const mid = contactGeometry(0, -450, card(), card(), cfg); // travel = 450-100+6 = 356
    expect(mid.strikeDur).toBeCloseTo(356 / 1600, 4);
    expect(mid.strikeDur).toBeGreaterThan(near.strikeDur);
    expect(mid.strikeDur).toBeLessThan(far.strikeDur);
  });
  it('lead tilt sign follows the horizontal offset', () => {
    expect(contactGeometry(200, -300, card(), card(), cfg).leadTilt).toBe(7);
    expect(contactGeometry(-200, -300, card(), card(), cfg).leadTilt).toBe(-7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @game/ui -- contactGeometry`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/choreo/contactGeometry.ts`:
```ts
/** Just the size fields of a DOM rect — all contactGeometry needs (kept minimal so tests can stub it). */
export interface RectSize {
  width: number;
  height: number;
}

/** The subset of LungeConfig the geometry reads. */
export interface ContactCfg {
  bite: number;
  targetSpeed: number;
  minStrikeDur: number;
  maxStrikeDur: number;
  leadTilt: number;
}

export interface Contact {
  /** Strike target offset from the attacker's rest center (its leading corner meets the surface). */
  strike: { x: number; y: number };
  /** Strike duration (s), derived from travel distance and clamped. */
  strikeDur: number;
  /** Signed lead-tilt (deg) — the attacker rotates this much to present a corner. */
  leadTilt: number;
}

/**
 * Corner-clack contact geometry (choreographer, corner-clack contact). Given the attacker→defender vector
 * and both cards' sizes, compute where the strike lands (their surfaces meet, plus a small `bite`), how long
 * the strike takes (constant px/s via `targetSpeed`, clamped), and the signed lead-tilt. Pure — no DOM/GSAP.
 */
export function contactGeometry(dx: number, dy: number, atk: RectSize, def: RectSize, c: ContactCfg): Contact {
  const dist = Math.hypot(dx, dy) || 1;
  const nx = dx / dist;
  const ny = dy / dist;
  // Half-extent of a card projected onto the approach axis (a box's support width along a direction).
  const projHalf = (r: RectSize): number => (Math.abs(nx) * r.width) / 2 + (Math.abs(ny) * r.height) / 2;
  const travel = Math.max(0, dist - projHalf(def) - projHalf(atk) + c.bite);
  const strikeDur = Math.min(c.maxStrikeDur, Math.max(c.minStrikeDur, travel / c.targetSpeed));
  const leadTilt = (dx >= 0 ? 1 : -1) * c.leadTilt;
  return { strike: { x: nx * travel, y: ny * travel }, strikeDur, leadTilt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @game/ui -- contactGeometry`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/choreo/contactGeometry.ts packages/ui/src/choreo/contactGeometry.test.ts
git commit -m "feat(ui): contactGeometry — surface travel + distance-scaled strike duration"
```

---

### Task 3: `playLunge` consumes the geometry (stop at surface, lead-tilt, rebound)

**Why:** Replace the center-overshoot (`dx * strikeDist`) and fixed `strikeDur` with the passed-in strike offset + duration, tilt the attacker to lead with a corner, and add the rotational rebound at contact. Keep `dx/dy` for the wind-up lean-back direction and the trail.

**Files:**
- Modify: `packages/ui/src/choreo/channels/lunge.ts`
- Test: `packages/ui/src/choreo/channels/lunge.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the body of `packages/ui/src/choreo/channels/lunge.test.ts` with (the new ctx fields make the calls explicit; a sized fake rect lets us read the tweened transform):
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import gsap from 'gsap';
import { playLunge } from './lunge';

const fakeEl = (): Element => ({
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 80, height: 100 }),
  classList: { contains: () => false },
  querySelector: () => null,
}) as unknown as Element;

const base = () => ({
  attacker: fakeEl(), dx: 0, dy: -300, speed: 1,
  strike: { x: 0, y: -206 }, strikeDur: 0.16, leadTilt: 7, attackerRebound: 5,
  onContact: () => {},
});

afterEach(() => vi.restoreAllMocks());

describe('playLunge', () => {
  it('fires onContact exactly once when the timeline is seeked to completion', () => {
    const onContact = vi.fn();
    const tl = playLunge({ ...base(), onContact });
    tl.progress(1);
    expect(onContact).toHaveBeenCalledTimes(1);
  });

  it('onContact fires BEFORE the timeline fully completes (at the smack-lead position)', () => {
    let at = -1;
    const tl = playLunge({ ...base(), onContact: () => { at = tl.progress(); } });
    tl.progress(0.99);
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(1);
  });

  it('timeScales the whole timeline by the given speed', () => {
    const tl = playLunge({ ...base(), speed: 2 });
    expect(tl.timeScale()).toBe(2);
  });

  it('drives the attacker to the surface strike offset (not overshooting center) at contact', () => {
    const el = fakeEl();
    const tl = playLunge({ ...base(), attacker: el });
    // seek to the end of the strike (wind-up 0.37 + strike 0.16 = 0.53 of ~1.6s timeline)
    tl.time(0.53);
    expect(Number(gsap.getProperty(el, 'y'))).toBeCloseTo(-206, 0);
    expect(Number(gsap.getProperty(el, 'rotation'))).toBeCloseTo(7, 0); // leads with the corner tilt
  });

  it('returns to rest (x/y/rotation ≈ 0) once fully settled', () => {
    const el = fakeEl();
    const tl = playLunge({ ...base(), attacker: el });
    tl.progress(1);
    expect(Number(gsap.getProperty(el, 'x'))).toBeCloseTo(0, 1);
    expect(Number(gsap.getProperty(el, 'y'))).toBeCloseTo(0, 1);
    expect(Number(gsap.getProperty(el, 'rotation'))).toBeCloseTo(0, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @game/ui -- channels/lunge`
Expected: FAIL — `playLunge` doesn't accept `strike`/`strikeDur`/`leadTilt`/`attackerRebound`; still overshoots.

- [ ] **Step 3: Update `playLunge`**

In `packages/ui/src/choreo/channels/lunge.ts`, extend `LungeCtx` — add after `dy`:
```ts
  /** Strike target offset (surface contact + bite) from contactGeometry — replaces the center-overshoot. */
  strike: { x: number; y: number };
  /** Distance-scaled strike duration (s) from contactGeometry — replaces the fixed config value. */
  strikeDur: number;
  /** Signed lead-tilt (deg) — the attacker rotates this to lead with a corner. */
  leadTilt: number;
  /** Attacker rotational rebound (deg) at contact, before the settle. */
  attackerRebound: number;
```
Then update the destructure and the timeline. Change the destructure line to include the new fields:
```ts
  const { attacker, dx, dy, speed, strike, strikeDur, leadTilt, attackerRebound, onContact, onImpact, impactOffsetMs = 0 } = ctx;
```
Change `trailCutoff` to use the param duration:
```ts
  const trailCutoff = c.windupDur + strikeDur;
```
Replace the wind-up + strike + contact + settle chain (the `.to(...).to(...).add(...).to(...)`) with:
```ts
    .to(attacker, { x: -dx * c.windupDepth, y: -dy * c.windupDepth, rotation: leadTilt, scale: c.windupScale, duration: c.windupDur, ease: 'power1.out' })  // wind up, tilt to lead a corner
    .to(attacker, { x: strike.x, y: strike.y, rotation: leadTilt, scale: 1, duration: strikeDur, ease: 'power3.in' })                                       // strike to the surface, corner leading
    .add(onContact, `-=${c.smackLead}`)                                                                                                                      // contact — the beat advance, smackLead before the strike completes
    .to(attacker, { rotation: -Math.sign(leadTilt || 1) * attackerRebound, duration: 0.06, ease: 'power2.out' })                                            // rotational rebound off the clack
    .to(attacker, { x: 0, y: 0, rotation: 0, duration: c.settleDur, ease: 'elastic.out(1, 0.45)' });                                                        // settle
```
Update the impact absolute-position line to use the param duration:
```ts
    const contactAt = c.windupDur + strikeDur - c.smackLead;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @game/ui -- channels/lunge`
Expected: PASS (5 tests). (GSAP may print benign "Invalid property" warnings — expected in the node env.)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/choreo/channels/lunge.ts packages/ui/src/choreo/channels/lunge.test.ts
git commit -m "feat(ui): playLunge stops at the surface, leads with a corner + rebounds"
```

---

### Task 4: Wire the geometry in `engine.ts` (measure both rects, pass to playLunge)

**Why:** The engine has both the attacker element and the defender element and computes `dx/dy` — it's the one place that can measure both cards and call `contactGeometry`, then hand the result to `playLunge`.

**Files:**
- Modify: `packages/ui/src/choreo/engine.ts`
- Test: `packages/ui/src/choreo/engine.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/ui/src/choreo/engine.test.ts`, give the fake element a real size and add a duration-scaling test. Change `fakeEl`'s rect to `{ left: 0, top: 0, width: 80, height: 100 }`, then append inside `describe('runAttackExchangeCues', …)`:
```ts
  it('scales the timeline duration with attack distance (far strike takes longer)', () => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    const near = runAttackExchangeCues(attackMoment(5), fakeEl(), null, 0, 200, { combatSpeed: 1, advance: vi.fn() });
    const far = runAttackExchangeCues(attackMoment(5), fakeEl(), null, 0, 3000, { combatSpeed: 1, advance: vi.fn() });
    expect(far!.duration()).toBeGreaterThan(near!.duration());
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @game/ui -- choreo/engine`
Expected: FAIL — durations equal (fixed strikeDur) and/or type error on missing playLunge fields.

- [ ] **Step 3: Update `engine.ts`**

In `packages/ui/src/choreo/engine.ts`, import the config + geometry at the top:
```ts
import { getLungeConfig } from '../lungeConfig';
import { contactGeometry } from '../contactGeometry';
```
In `runAttackExchangeCues`, just before the `return playLunge({…})`, compute the geometry from both rects and pass it in:
```ts
  const cfg = getLungeConfig();
  const atkRect = attacker.getBoundingClientRect();
  const defRect = defender?.getBoundingClientRect() ?? { width: 0, height: 0 };
  const geo = contactGeometry(dx, dy, atkRect, defRect, cfg);
  return playLunge({
    attacker, dx, dy, speed: ctx.combatSpeed,
    strike: geo.strike, strikeDur: geo.strikeDur, leadTilt: geo.leadTilt, attackerRebound: cfg.attackerRebound,
    onContact: () => ctx.advance(),
    onImpact: impact ? () => playContactImpact(defender, dx, dy, power, ctx.combatSpeed, geo.leadTilt) : undefined,
    impactOffsetMs: impact?.offset ?? 0,
  });
```
(Delete the old `return playLunge({…})` block it replaces. Note the new trailing `geo.leadTilt` arg on `playContactImpact` — Task 5 adds that parameter; until then TypeScript will flag it, which Task 5 resolves. If running tasks strictly in order, keep the arg — the engine test only calls with `defender: null`, so impact is skipped.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @game/ui -- choreo/engine`
Expected: PASS (existing tests + the new duration-scaling test).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/choreo/engine.ts packages/ui/src/choreo/engine.test.ts
git commit -m "feat(ui): engine measures both cards, feeds contactGeometry to the lunge"
```

---

### Task 5: Defender spin on impact (`playContactImpact`)

**Why:** Complete the "both jolt" read — the defender counter-rotates away from the contact corner as it's knocked back. Sign is opposite the attacker's lead-tilt.

**Files:**
- Modify: `packages/ui/src/choreo/channels/impact.ts`
- Test: `packages/ui/src/choreo/channels/impact.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/ui/src/choreo/channels/impact.test.ts`, update the two-arg calls and assert a rotation tween. Change the existing calls to pass the new `leadTilt` arg, and add a test:
```ts
  it('counter-rotates the defender opposite the lead tilt on impact', () => {
    vi.spyOn(sfx, 'hit').mockImplementation(() => {});
    vi.spyOn(pixiFx, 'impact').mockImplementation(() => {});
    const el = fakeDefender();
    playContactImpact(el, 0, -10, 1, 1, 7); // attacker led with +7° → defender spins negative
    const tween = gsap.getTweensOf(el)[0];
    // the tween animates rotation to a non-zero value (the counter-spin)
    expect(tween).toBeDefined();
    expect(tween.vars.rotation).toBeLessThan(0);
  });
```
Also update the existing `playContactImpact(null, 10, 0, 1, 1)` and `playContactImpact(el, 10, 0, 1.5, 1)` calls to add a trailing `, 0` (leadTilt) so they match the new signature.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @game/ui -- channels/impact`
Expected: FAIL — `playContactImpact` takes 5 args / no rotation on the tween.

- [ ] **Step 3: Update `playContactImpact`**

In `packages/ui/src/choreo/channels/impact.ts`, add the `leadTilt` param and the defender spin. Import the config:
```ts
import { getLungeConfig } from '../../lungeConfig';
```
Change the signature and the knockback tween:
```ts
export function playContactImpact(defender: Element | null, dx: number, dy: number, power: number, speed: number, leadTilt = 0): void {
  sfx.hit();
  if (!defender) return;
  const r = defender.getBoundingClientRect();
  pixiFx.impact(r.left + r.width / 2, r.top + r.height / 2, dx, dy, power);
  gsap.killTweensOf(defender);
  const kb = 0.14 * (0.75 + 0.25 * power);
  const spin = -Math.sign(leadTilt || 1) * getLungeConfig().defenderSpin; // counter-rotate away from the lead corner
  gsap.fromTo(defender, { x: 0, y: 0, rotation: 0 }, {
    x: dx * kb, y: dy * kb, rotation: spin, duration: 0.1 / speed, yoyo: true, repeat: 1, ease: 'power2.out',
    onComplete: () => gsap.set(defender, { clearProps: 'transform' }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @game/ui -- channels/impact`
Expected: PASS (hitPower + the three playContactImpact tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/choreo/channels/impact.ts packages/ui/src/choreo/channels/impact.test.ts
git commit -m "feat(ui): defender counter-spins on impact (the corner clack)"
```

---

### Task 6: Full-suite gate, live feel-pass, bake defaults, docs + PR

**Why:** Prove the change is green everywhere, dial the corner feel by eye in the running app, bake the chosen values, and ship.

**Files:**
- Modify: `packages/ui/src/lungeConfig.ts` (baked defaults, after tuning)
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `README.md`

- [ ] **Step 1: Run the full check suite**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green. (If `typecheck:web` surfaces a pre-existing-baseline error unrelated to these files, note it but don't fix it here.)

- [ ] **Step 2: Live feel-pass (manual, with the user)**

Run `npm run dev`, open the Dev Tuning Menu → Lunge Tuner, and watch fights. Dial `bite`, `leadTilt`, `defenderSpin`, `attackerRebound`, `targetSpeed`, `minStrikeDur`, `maxStrikeDur` until near and far attacks feel equally weighty and the corners read as clacking. Confirm the damage float + advance still land on contact at 1× and at faster combat speeds. Use "Copy values" to grab the tuned JSON.

- [ ] **Step 3: Bake the tuned values as defaults**

Paste the tuned numbers into `DEFAULTS` in `packages/ui/src/lungeConfig.ts` (replacing the Task-1 starting dials).

- [ ] **Step 4: Update the docs**

Prepend a dated `docs/devlog.md` entry (what changed + why + how verified: the new `contactGeometry` helper, surface-stop + corner lead-tilt + both-jolt, distance-scaled strike duration, the baked dials, tests + live pass). Move the item out of `docs/roadmap.md`'s queue. Refresh `README.md`'s Recent changes + Short-term roadmap.

- [ ] **Step 5: Commit + push + open PR**

```bash
git add packages/ui/src/lungeConfig.ts docs/devlog.md docs/roadmap.md README.md
git commit -m "feat(ui): bake corner-clack lunge defaults + docs"
git push -u origin feat/corner-clack-contact
```
Then open the PR (UI-only, self-mergeable on green) via the gh CLI at `/c/Program Files/GitHub CLI/gh.exe`, titled `feat(ui): corner-clack contact + distance-scaled lunge`, body summarizing asks #1/#2, the outcome-neutrality (no core/sim changes), and the tuned dials.

---

## Notes for the executor

- **Outcome-neutrality is absolute:** touch only `packages/ui`. No `packages/core`/`content`/`sim` edits. If a task seems to need one, stop and flag it.
- **Task ordering:** Task 4's `engine.ts` passes a 6th arg to `playContactImpact` that Task 5 adds. Running in order, the engine test (defender null → impact skipped) still passes; the full typecheck in Task 6 is the first place the arg is enforced, by which point Task 5 has landed. If you run typecheck between Tasks 4 and 5, expect one transient arity error that Task 5 clears.
- **Starting dials are illustrative** — the real values come from Task 6's live pass. Don't treat the Task-1 numbers as final.
- After each task, the relevant `npm test -w @game/ui -- <file>` must be green before moving on.
```
