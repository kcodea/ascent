# Scheduled Stat Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make *when* a stat change lands a property of the change itself, so a cascade's numbers follow the cascade instead of all landing on the reducer tick.

**Architecture:** A hold in `fx/statHold.ts` gains `startAt` (when delivery begins) and `rollMs` (how long it takes). A single module-level rAF ticker drives every hold no effect has claimed, replacing the per-card loop in `Card.tsx`. The `origin` field becomes a three-way rank — `intrinsic` < `cue` < `effect` — so whoever knows most about the timing wins. The two shop cues that already compute a `Land[]` schedule publish it.

**Tech Stack:** TypeScript, React 18, Vitest (headless, `.test.ts` only — no DOM test runner in this repo), Puppeteer-over-CDP for browser verification.

**Source spec:** [`../specs/2026-08-04-stat-readout-choreography-design.md`](../specs/2026-08-04-stat-readout-choreography-design.md)

## Global Constraints

- **Scope is the SHOP only.** Combat unification is a separate plan (see "Why this plan stops here" at the end). Do not touch `Unit.tsx`, `useCombatReplay.ts`, `.statflash`, or `CardView.flashAtk`/`flashHp`.
- **Never commit to `main`.** Work continues on `feat/fx-number-spin`. One feature = one branch = one PR (`CLAUDE.md` §GitHub Flow).
- **Every commit updates `docs/devlog.md` and `docs/roadmap.md`** (`CLAUDE.md` §"Dev log & roadmap"). Order: change → docs → commit together. The final task carries the devlog entry for the whole plan; individual task commits do not each need one.
- **A stat badge is load-bearing information.** Motion may live in the glyph, never in the value: no printed number may ever be one the minion did not have. `heldFor`'s existing wobble maths and the `Math.max(0, …)` floor in `Card.tsx` are the guards — do not weaken either.
- **Fail open.** An unclaimed hold must resolve to the true number on its own. Never introduce a path where a badge can sit on a stale value indefinitely.
- **Run `npx tsc -b` and `npx vitest run` before every commit.** Baseline at plan start: typecheck clean, lint clean except 1 pre-existing warning (`Recruit.tsx:13` `getSpellBuffFxConfig` unused), 3893 tests passing.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/ui/src/fx/statHold.ts` | The hold store: what is withheld, when it is delivered, and the clock that delivers it | Modify — add `startAt`/`rollMs`, the origin rank, the shared ticker, schedule-aware TTL |
| `packages/ui/src/fx/statHold.test.ts` | Headless coverage of the store | Modify — new describes for scheduling, the ticker, the rank |
| `packages/ui/src/Card.tsx` | Detect an unauthored change, place a hold, pop the badge | Modify — delete its rAF loop and failsafe; keep detection and the pop |
| `packages/ui/src/fx/land.ts` | Pure traversal arithmetic (`scheduleLands`, `cascade`, `waves`) | Modify — add `rubyLandSchedule`, the one pure helper both ruby consumers call |
| `packages/ui/src/fx/land.test.ts` | Headless coverage of the traversal arithmetic | Modify — cover `rubyLandSchedule` |
| `packages/ui/src/Recruit.tsx` | The shop's cues | Modify — ruby cascade and fodder tendrils publish their schedules; last `+X/+X` float cut |
| `packages/ui/src/fx/primitives/react.ts` | The authored `react` layer | Modify — one-word origin rename at its `holdStat` call site (it has none today; see Task 3) |
| `packages/ui/src/fx/playDef.ts` | `window.__fx.roll` dev handle | Modify — one-word origin rename |
| `packages/ui/src/store.ts` | Run/phase state | Modify — call `releaseAllStats` on phase change |

---

## Task 1: The hold carries a delivery schedule

Adds the two fields and makes the TTL respect them. **No behaviour changes yet** — nothing sets `startAt`, and `Card` still drives its own reveal. This task exists on its own so the schedule-aware TTL lands and is proven before anything depends on it.

**Files:**
- Modify: `packages/ui/src/fx/statHold.ts`
- Test: `packages/ui/src/fx/statHold.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `holdStat(uid, delta, opts?: { ttlMs?: number; origin?: HoldOrigin; startAt?: number; rollMs?: number })`. `startAt` is milliseconds from *now*, not an absolute timestamp — callers pass `land.at` directly. `DEFAULT_ROLL_MS: number` (420) and `HOLD_GRACE_MS: number` (200) are exported.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ui/src/fx/statHold.test.ts`:

```ts
describe('a delivery schedule', () => {
  it('defaults to delivering immediately, with the standard roll', () => {
    holdStat('a', { attack: 2, health: 0 });
    expect(scheduleFor('a')).toEqual({ startAt: 0, rollMs: DEFAULT_ROLL_MS });
  });

  it('records a startAt as an offset from now', () => {
    holdStat('a', { attack: 2, health: 0 }, { startAt: 300, rollMs: 500 });
    expect(scheduleFor('a')).toEqual({ startAt: 300, rollMs: 500 });
  });

  /**
   * The TTL is what force-delivers a hold nobody claimed. A flat 1200ms would fire BEFORE the tail of a
   * long cascade was due — the failsafe undoing the feature it is protecting.
   */
  it('extends the TTL to cover a scheduled delivery', () => {
    holdStat('a', { attack: 2, health: 0 }, { startAt: 2000, rollMs: 500 });
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1500);
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });   // still alive past the old flat TTL
  });

  it('keeps the 1200ms floor for an unscheduled hold, so a react layer still has room to claim it', () => {
    holdStat('a', { attack: 2, health: 0 }, { startAt: 0, rollMs: 0 });
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 1000);
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });
  });

  it('does expire once the schedule plus grace has passed', () => {
    holdStat('a', { attack: 2, health: 0 }, { startAt: 400, rollMs: 400 });
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + HOLD_TTL_MS + 1);
    expect(heldFor('a')).toBeNull();
  });
});
```

Extend the import at the top of the file:

```ts
import {
  DEFAULT_ROLL_MS, HOLD_GRACE_MS, HOLD_TTL_MS, anyStatHeld, heldFor, holdOrigin, holdStat,
  releaseAllStats, releaseStat, scheduleFor, statHoldKey, revealStat, subscribeStatHolds,
} from './statHold';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/ui/src/fx/statHold.test.ts`
Expected: FAIL — `DEFAULT_ROLL_MS is not defined`, `scheduleFor is not a function`.

- [ ] **Step 3: Add the fields, the constants and the accessor**

In `packages/ui/src/fx/statHold.ts`, add to the `Hold` interface (after `reel`):

```ts
  /** Milliseconds after the hold was placed at which delivery BEGINS. 0 = immediately.
   *  This is what makes a cascade a cascade: the seventh minion's number is withheld until its own gem. */
  startAt: number;
  /** How long the reveal takes once it starts. Ignored for `effect` holds — their player owns the clock. */
  rollMs: number;
```

Add near `HOLD_TTL_MS`:

```ts
/** The roll a hold gets when its placer doesn't specify one. */
export const DEFAULT_ROLL_MS = 420;

/** Slack past a scheduled delivery before the TTL force-delivers it. Long enough that a frame or two of
 *  jank never truncates a roll, short enough that a stranded hold clears before anyone reads the badge. */
export const HOLD_GRACE_MS = 200;
```

In `holdStat`, destructure the new options and use them:

```ts
  const { ttlMs, origin = 'authored', startAt = 0, rollMs = DEFAULT_ROLL_MS } = opts;
```

Replace the `until` computation in the `holds.set(...)` call and the expiry arming with a shared lifetime.
Insert immediately before `holds.set(uid, {`:

```ts
  // The TTL has to outlast the SCHEDULE, or the failsafe force-delivers the tail of a long cascade before
  // its own gem arrives — the exact desync this feature exists to remove, reintroduced by the safety net.
  // `HOLD_TTL_MS` stays the floor: an unscheduled authored hold still needs room for a react layer to peak.
  const lifetimeMs = ttlMs ?? Math.max(HOLD_TTL_MS, startAt + rollMs + HOLD_GRACE_MS);
```

Then in the object literal, add `startAt,` and `rollMs,` and change `until` to `now() + lifetimeMs`. In the
expiry `setTimeout` below it, change the delay from `ttlMs` to `lifetimeMs`.

Update the signature:

```ts
export function holdStat(
  uid: string,
  delta: Partial<StatDelta>,
  opts: { ttlMs?: number; origin?: HoldOrigin; startAt?: number; rollMs?: number } = {},
): void {
```

Add the accessor beside `holdOrigin`:

```ts
/** A live hold's delivery schedule, or `null`. For tests and for the ticker. */
export function scheduleFor(uid: string): { startAt: number; rollMs: number } | null {
  const h = holds.get(uid);
  if (h === undefined || h.until <= now()) return null;
  return { startAt: h.startAt, rollMs: h.rollMs };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/ui/src/fx/statHold.test.ts`
Expected: PASS, 47 tests.

- [ ] **Step 5: Full gates and commit**

```bash
npx tsc -b && npx vitest run
git add packages/ui/src/fx/statHold.ts packages/ui/src/fx/statHold.test.ts
git commit -m "feat(fx): a hold carries when to deliver it, and the TTL respects that"
```

---

## Task 2: One shared ticker replaces the per-card loop

**Files:**
- Modify: `packages/ui/src/fx/statHold.ts`
- Modify: `packages/ui/src/Card.tsx:497-537` (the intrinsic `useLayoutEffect` and the unmount effect below it)
- Test: `packages/ui/src/fx/statHold.test.ts`

**Interfaces:**
- Consumes: `startAt`/`rollMs` from Task 1.
- Produces: nothing new in the public API. The store now advances non-`effect` holds by itself; `Card` no longer calls `revealStat`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/ui/src/fx/statHold.test.ts`:

```ts
describe('the shared ticker', () => {
  /** rAF does not run under vitest, so the tests drive the exported step directly. */
  it('reveals nothing before startAt', () => {
    const t0 = performance.now();
    holdStat('a', { attack: 4, health: 0 }, { startAt: 500, rollMs: 200 });
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 100);
    stepHolds();
    expect(heldFor('a')).toEqual({ attack: 4, health: 0 });   // untouched
  });

  it('walks the reveal once startAt has passed', () => {
    const t0 = performance.now();
    holdStat('a', { attack: 4, health: 0 }, { startAt: 100, rollMs: 400 });
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 300);   // 200ms into a 400ms roll
    stepHolds();
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });
  });

  it('releases when the roll completes', () => {
    const t0 = performance.now();
    holdStat('a', { attack: 4, health: 0 }, { startAt: 0, rollMs: 200 });
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 200);
    stepHolds();
    expect(heldFor('a')).toBeNull();
    expect(anyStatHeld()).toBe(false);
  });

  /** An authored layer drives its own reveal off the player's clock; two clocks on one counter stutter.
   *  NOTE: this origin is still called `authored` at this point in the plan — Task 3 renames it to `effect`
   *  and updates both this test and the ticker's branch. */
  it('never advances an authored-origin hold', () => {
    const t0 = performance.now();
    holdStat('a', { attack: 4, health: 0 }, { origin: 'authored', startAt: 0, rollMs: 200 });
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 5000);
    stepHolds();
    expect(heldFor('a')).toEqual({ attack: 4, health: 0 });
  });

  it('emits once per step, not once per hold', () => {
    let notified = 0;
    holdStat('a', { attack: 4, health: 0 }, { rollMs: 400 });
    holdStat('b', { attack: 4, health: 0 }, { rollMs: 400 });
    const t0 = performance.now();
    const stop = subscribeStatHolds(() => { notified++; });
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 200);
    stepHolds();
    expect(notified).toBe(1);
    stop();
  });
});
```

Add `stepHolds` to the import list.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/ui/src/fx/statHold.test.ts`
Expected: FAIL — `stepHolds is not a function`.

- [ ] **Step 3: Implement the ticker**

In `packages/ui/src/fx/statHold.ts`, add after `revealStat`:

```ts
/**
 * Advance every hold the store owns. Exported for tests, which have no rAF.
 *
 * `emit` fires ONCE at the end rather than per hold. That is not a micro-optimisation: every mounted card
 * subscribes, so a per-hold emit makes N rolling badges cost N × (every card on screen) snapshot reads per
 * frame, most of them cards answering "nothing changed for me".
 */
export function stepHolds(): void {
  const t = now();
  let changed = false;
  for (const [uid, h] of [...holds]) {
    if (h.origin === 'authored') continue;    // its player owns the clock (renamed to `effect` in Task 3)
    if (t < h.placedAt + h.startAt) continue; // scheduled for later in the cascade
    const p = h.rollMs <= 0 ? 1 : (t - h.placedAt - h.startAt) / h.rollMs;
    if (revealQuiet(uid, Math.min(1, p))) changed = true;
  }
  if (changed) emit();
}
```

`stepHolds` needs two supports. Add `placedAt: number` to the `Hold` interface (set to `now()` in
`holdStat`), because `startAt` is an offset and the ticker needs the origin point.

And split the reveal so the ticker can batch its notification. **Do not copy `revealStat`'s body** — move it
into a non-emitting core and make `revealStat` delegate, so there is exactly one copy of the monotonic rule:

```ts
/** The reveal itself, WITHOUT notifying. Returns whether anything actually moved.
 *  Split out so `stepHolds` can advance many holds and emit once; `revealStat` is this plus an emit. */
function revealQuiet(uid: string, progress: number): boolean {
  const h = holds.get(uid);
  if (h === undefined) return false;
  const p = Math.max(0, Math.min(1, progress));
  if (p <= h.revealed) return false;   // MONOTONIC — a counter that ticked back reads as an arithmetic bug
  if (p >= 1) { disarm(uid); holds.delete(uid); return true; }
  h.revealed = p;
  return true;
}
```

Then rewrite `revealStat` to delegate rather than repeat it, preserving its existing `reel` behaviour and its
doc comment:

```ts
export function revealStat(uid: string, progress: number, reel = 0): void {
  const h = holds.get(uid);
  if (h !== undefined) h.reel = Math.max(0, reel);
  if (revealQuiet(uid, progress)) emit();
}
```

Drive it from rAF. Add beside the ticker:

```ts
let raf = 0;

/** Start the loop if it isn't already running. Called whenever a hold is placed. */
function ensureTicking(): void {
  if (raf !== 0 || typeof requestAnimationFrame === 'undefined') return;
  const loop = (): void => {
    stepHolds();
    raf = holds.size > 0 ? requestAnimationFrame(loop) : 0;
  };
  raf = requestAnimationFrame(loop);
}
```

Call `ensureTicking();` as the last line of `holdStat`, after `emit()`.

In `releaseAllStats`, stop the loop so a torn-down scene leaves nothing running:

```ts
  if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/ui/src/fx/statHold.test.ts`
Expected: PASS, 52 tests.

- [ ] **Step 5: Delete `Card`'s loop**

In `packages/ui/src/Card.tsx`, the intrinsic effect keeps its detection and hold but loses everything after
`holdStat`. Replace the body from `holdStat(uid, …)` through the effect's closing `}, [uid, card.attack, card.health]);` with:

```tsx
    holdStat(uid, { attack: dA, health: dH }, { origin: 'intrinsic' });
    // NO local loop and no failsafe timer. `fx/statHold.ts` owns the clock for every hold no effect claimed
    // — one rAF for the whole board instead of one per card, and it survives this card unmounting mid-roll.
    // Its schedule-aware TTL is what force-delivers a hold nobody finished.
  }, [uid, card.attack, card.health]);
```

Delete the unmount-only `useEffect` immediately below it (the one calling `releaseStat` when
`holdOrigin(u) === 'intrinsic'`) — the store's TTL covers that case now, and releasing on unmount would cut
a cascade short whenever a card re-keys mid-schedule.

Delete the now-unused `STAT_ROLL_MS` and `STAT_ROLL_GRACE_MS` constants and drop `holdOrigin`, `releaseStat`
and `revealStat` from the `./fx/statHold` import, keeping `heldFor`, `holdStat`, `statHoldKey` and
`subscribeStatHolds`.

- [ ] **Step 6: Verify in the browser that the roll still works**

Run: `node verify.mjs` from the harness directory (see Task 7 for how to stand it up if absent).
Expected: `A. intrinsic roll` still steps through intermediate values and lands exactly, `NEGATIVE_FRAMES: 0`.

- [ ] **Step 7: Full gates and commit**

```bash
npx tsc -b && npx vitest run && npx eslint packages/ui/src/Card.tsx packages/ui/src/fx/statHold.ts
git add packages/ui/src/fx/statHold.ts packages/ui/src/fx/statHold.test.ts packages/ui/src/Card.tsx
git commit -m "refactor(fx): one shared ticker owns the roll, not one loop per card"
```

---

## Task 3: `origin` becomes a three-way rank

**Files:**
- Modify: `packages/ui/src/fx/statHold.ts`
- Modify: `packages/ui/src/fx/playDef.ts:445` (the `window.__fx.roll` handle)
- Test: `packages/ui/src/fx/statHold.test.ts`

**Interfaces:**
- Consumes: the ticker from Task 2 (which already branches on `origin === 'effect'`).
- Produces: `HoldOrigin = 'intrinsic' | 'cue' | 'effect'`. `'authored'` is gone — every existing caller that passed it, or defaulted to it, now means `'effect'`.

- [ ] **Step 1: Write the failing tests**

Replace the existing `describe('origin — who owns a change when two paths see it', …)` block wholesale:

```ts
describe('origin rank — who owns a change when several paths see it', () => {
  it('a cue REPLACES an intrinsic hold instead of stacking a second copy', () => {
    holdStat('a', { attack: 1, health: 1 }, { origin: 'intrinsic' });
    holdStat('a', { attack: 1, health: 1 }, { origin: 'cue', startAt: 300 });
    expect(heldFor('a')).toEqual({ attack: 1, health: 1 });
    expect(holdOrigin('a')).toBe('cue');
    expect(scheduleFor('a')?.startAt).toBe(300);
  });

  it('an effect REPLACES a cue hold', () => {
    holdStat('a', { attack: 2, health: 0 }, { origin: 'cue', startAt: 300 });
    holdStat('a', { attack: 2, health: 0 }, { origin: 'effect' });
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });
    expect(holdOrigin('a')).toBe('effect');
  });

  it('a lower rank never lands on top of a higher one', () => {
    holdStat('a', { attack: 2, health: 2 }, { origin: 'effect' });
    holdStat('a', { attack: 2, health: 2 }, { origin: 'cue' });
    holdStat('a', { attack: 2, health: 2 }, { origin: 'intrinsic' });
    expect(heldFor('a')).toEqual({ attack: 2, health: 2 });
    expect(holdOrigin('a')).toBe('effect');
  });

  it('replaces even when the lower-ranked hold already showed part of the change', () => {
    holdStat('a', { attack: 4, health: 0 }, { origin: 'intrinsic' });
    revealStat('a', 0.5);
    holdStat('a', { attack: 4, health: 0 }, { origin: 'cue' });
    expect(heldFor('a')).toEqual({ attack: 4, health: 0 });   // the whole change again, from the top
  });

  it('SAME rank still accumulates — two genuinely separate changes', () => {
    holdStat('a', { attack: 1, health: 0 }, { origin: 'cue' });
    holdStat('a', { attack: 1, health: 0 }, { origin: 'cue' });
    expect(heldFor('a')).toEqual({ attack: 2, health: 0 });
  });

  it('defaults to effect, so every existing caller keeps its precedence', () => {
    holdStat('a', { attack: 1, health: 0 });
    expect(holdOrigin('a')).toBe('effect');
  });

  it('an EXPIRED hold does not block a later one of any rank', () => {
    holdStat('a', { attack: 2, health: 0 }, { origin: 'effect' });
    vi.spyOn(performance, 'now').mockReturnValue(performance.now() + HOLD_TTL_MS + 1);
    holdStat('a', { attack: 3, health: 0 }, { origin: 'intrinsic' });
    expect(heldFor('a')).toEqual({ attack: 3, health: 0 });
    expect(holdOrigin('a')).toBe('intrinsic');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/ui/src/fx/statHold.test.ts`
Expected: FAIL — `expect(holdOrigin('a')).toBe('cue')` receives `'authored'`.

- [ ] **Step 3: Implement the rank**

In `packages/ui/src/fx/statHold.ts`, replace the `HoldOrigin` type and its doc comment:

```ts
/**
 * WHO placed a hold, ordered by HOW MUCH THEY KNOW about when the number should land. Higher wins.
 *
 * `intrinsic` — `Card` noticed its own printed value move. Knows nothing but that something changed, and
 *   exists so a stat change is never silent because an effect was never authored for it.
 * `cue` — a cue that computed a stagger (`Land[]`) and can say when this particular minion's number is due.
 * `effect` — a `react` layer with "Carries the number" ticked. Knows the moment AND owns a clock, so the
 *   store's ticker leaves it alone entirely.
 *
 * Higher replaces lower outright, because they describe the SAME change and the better-informed one should
 * deliver it. Equal accumulates — two of those really are two changes. Lower never overwrites higher, which
 * is what stops `Card`'s intrinsic hold (React flushes layout effects child-first, so it always lands first)
 * from stomping the cue's.
 */
export type HoldOrigin = 'intrinsic' | 'cue' | 'effect';

const RANK: Record<HoldOrigin, number> = { intrinsic: 1, cue: 2, effect: 3 };
```

In `holdStat`, change the default and replace the two precedence branches:

```ts
  const { ttlMs, origin = 'effect', startAt = 0, rollMs = DEFAULT_ROLL_MS } = opts;
```

```ts
  // A better-informed placer owns this change; a worse-informed one stands down rather than stacking a
  // second copy of the same delta on top of it.
  if (live && RANK[origin] < RANK[prev.origin]) return;
  // …and supersedes outright, so its delta lands whole and its roll starts from the top instead of
  // inheriting a fraction the lower-ranked one had already shown.
  const supersedes = live && RANK[origin] > RANK[prev.origin];
```

- [ ] **Step 4: Point the ticker at the renamed origin**

Task 2's ticker skips holds an effect owns, branching on the old name. In `stepHolds`, change:

```ts
    if (h.origin === 'authored') continue;    // its player owns the clock (renamed to `effect` in Task 3)
```

to:

```ts
    if (h.origin === 'effect') continue;      // its player owns the clock
```

and in `statHold.test.ts`, change the ticker test `'never advances an authored-origin hold'` to
`'never advances an effect-origin hold'`, with `{ origin: 'effect', startAt: 0, rollMs: 200 }`. Delete the
NOTE comment above it — the rename it warned about has now happened.

- [ ] **Step 5: Rename the one existing caller**

In `packages/ui/src/fx/playDef.ts`, the `roll` dev handle calls `holdStat(uid, { attack: delta, health: delta })`. It relies on the default, which is now `'effect'` — correct, since it drives its own loop. Add a clarifying comment above it:

```ts
      // Defaults to `effect` origin: this handle drives its own rAF below, so the store's ticker must not
      // also advance it.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/ui/src/fx/statHold.test.ts`
Expected: PASS, 58 tests.

- [ ] **Step 7: Full gates and commit**

```bash
npx tsc -b && npx vitest run
git add packages/ui/src/fx/statHold.ts packages/ui/src/fx/statHold.test.ts packages/ui/src/fx/playDef.ts
git commit -m "feat(fx): hold precedence becomes a rank — intrinsic < cue < effect"
```

---

## Task 4: One schedule, two consumers (the pure helper)

The ruby cascade's hold lives in a layout effect and its fires live in a later `useEffect`. If each computes
its own schedule they can drift. This extracts the arithmetic so both call one pure function — testable
headlessly, which the React sites are not.

**Files:**
- Modify: `packages/ui/src/fx/land.ts`
- Test: `packages/ui/src/fx/land.test.ts`

**Interfaces:**
- Consumes: `scheduleLands`, `cascade` (already in this file).
- Produces: `rubyLandSchedule(lands: readonly { uid: string; count: number }[]): Land[]` — the shop ruby cascade's schedule, derived once from the raw `RubyLandedFx` list.

- [ ] **Step 1: Write the failing test**

Append to `packages/ui/src/fx/land.test.ts`:

```ts
describe('rubyLandSchedule', () => {
  it('staggers recipients by the ruby gap and stack members by the beat', () => {
    const out = rubyLandSchedule([{ uid: 'a', count: 2 }, { uid: 'b', count: 1 }]);
    expect(out.map((l) => l.uid)).toEqual(['a', 'a', 'b']);
    expect(out[0]!.at).toBe(0);
    expect(out[1]!.at).toBe(RUBY_BEAT_MS);
    expect(out[2]!.at).toBe(RUBY_GAP_MS);
  });

  it('is PURE — the same input twice gives identical timings, which is what keeps the hold and the fire in step', () => {
    const input = [{ uid: 'a', count: 1 }, { uid: 'b', count: 3 }];
    expect(rubyLandSchedule(input)).toEqual(rubyLandSchedule(input));
  });

  it('returns nothing for no lands', () => {
    expect(rubyLandSchedule([])).toEqual([]);
  });
});
```

Add to the imports at the top of `land.test.ts`:

```ts
import { rubyLandSchedule } from './land';
import { RUBY_BEAT_MS, RUBY_GAP_MS } from '../choreo/channels/rubyLanded';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/ui/src/fx/land.test.ts`
Expected: FAIL — `rubyLandSchedule is not a function`.

- [ ] **Step 3: Implement the helper**

Append to `packages/ui/src/fx/land.ts`:

```ts
/**
 * The shop Ruby cascade's schedule, derived ONCE from the raw land list.
 *
 * Exists because two consumers need the identical timing: the layout effect that withholds each minion's
 * number, and the later effect that fires each gem. Two independent `scheduleLands` calls would be two
 * schedules that happen to agree today — this makes agreement structural instead. Alignment between the
 * number and the effect is a consequence of one computation, not something maintained by hand.
 */
export function rubyLandSchedule(lands: readonly { uid: string; count: number }[]): Land[] {
  return scheduleLands(cascade(lands), { gap: RUBY_GAP_MS, beat: RUBY_BEAT_MS });
}
```

Add the import at the top of `land.ts`:

```ts
import { RUBY_BEAT_MS, RUBY_GAP_MS } from '../choreo/channels/rubyLanded';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/ui/src/fx/land.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gates and commit**

```bash
npx tsc -b && npx vitest run
git add packages/ui/src/fx/land.ts packages/ui/src/fx/land.test.ts
git commit -m "refactor(fx): rubyLandSchedule — one schedule for the hold and the fire"
```

---

## Task 5: The shop ruby cascade publishes its schedule

**Files:**
- Modify: `packages/ui/src/Recruit.tsx:864-911`

**Interfaces:**
- Consumes: `rubyLandSchedule` (Task 4), `holdStat`'s `origin`/`startAt` (Tasks 1 and 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite the hold effect to schedule per land**

Replace the body of the `useLayoutEffect` at `Recruit.tsx:864` (keep the doc comment above it, and append the
paragraph shown in Step 2) with:

```tsx
  useLayoutEffect(() => {
    const seq = run.rubyLandedFxSeq;
    if (seq === undefined || seq === prevRubyLandedSeq.current) return;
    if (!defCarriesNumber(RUBY_LANDED_DEF)) return;
    const lands = run.rubyLandedFx ?? [];
    for (const land of rubyLandSchedule(lands)) {
      const buff = run.board.find((c) => c.uid === land.uid)?.buffs?.find((b) => b.source === 'Ruby');
      if (!buff || buff.count <= 0) continue;
      holdStat(land.uid, {
        attack: Math.round((buff.attack / buff.count) * land.count),
        health: Math.round((buff.health / buff.count) * land.count),
      }, { origin: 'cue', startAt: land.at + RUBY_DELIVER_OFFSET_MS });
    }
    // `prevRubyLandedSeq` is deliberately NOT advanced here — the cue effect below owns that bookkeeping, and
    // moving it would make this effect silently swallow the cue.
  }, [run.rubyLandedFxSeq, run.rubyLandedFx, run.board]);
```

Add the constant beside `RUBY_LANDED_DEF`'s import usage, near the top-level constants at `Recruit.tsx:76`:

```tsx
/** How far into a gem's own effect its number lands. `land.at` is when the effect STARTS; the dust takes a
 *  moment to look like it seated, and the number should arrive with the seating rather than the launch.
 *  Per-cue rather than per-def: a def that wants the number tied to a specific beat of its own motion says
 *  so with a `react` layer, which outranks this entirely. */
const RUBY_DELIVER_OFFSET_MS = 120;
```

- [ ] **Step 2: Extend the effect's doc comment**

Append to the block comment above the layout effect:

```
   * Each land is withheld until ITS OWN gem, not until the reducer tick. `rubyLandSchedule` is the single
   * source of the rhythm and the fire effect below reads the same function, so the number and the dust
   * cannot drift — alignment is structural rather than maintained. Without this, an Excavator dropping gems
   * one at a time across the board moved all seven numbers simultaneously, which visibly proves to the
   * player that the effect is not what is causing them.
```

- [ ] **Step 3: Point the fire effect at the same helper**

At `Recruit.tsx:890`, replace:

```tsx
      for (const land of scheduleLands(cascade(lands), { gap: RUBY_GAP_MS, beat: RUBY_BEAT_MS })) {
```

with:

```tsx
      // The SAME schedule the hold above used — see `rubyLandSchedule`. Two `scheduleLands` calls would be
      // two schedules that merely agree today.
      for (const land of rubyLandSchedule(lands)) {
```

Add `rubyLandSchedule` to the `./fx/land` import at `Recruit.tsx:52`. Remove `cascade` and `scheduleLands`
from that import **only if** no other site in the file still uses them — the fodder effect at
`Recruit.tsx:2758` does, so keep them.

- [ ] **Step 4: Verify in the browser**

Run the cascade harness from Task 7.
Expected: per-badge delivery times staggered by ~`RUBY_GAP_MS`, in board order, not simultaneous.

- [ ] **Step 5: Full gates and commit**

```bash
npx tsc -b && npx vitest run && npx eslint packages/ui/src/Recruit.tsx
git add packages/ui/src/Recruit.tsx
git commit -m "feat(fx): the shop gem cascade delivers each number with its own gem"
```

---

## Task 6: The fodder tendril publishes its schedule, and the last float goes

**Files:**
- Modify: `packages/ui/src/Recruit.tsx:2751-3055`

**Interfaces:**
- Consumes: `holdStat`'s `origin`/`startAt`.
- Produces: nothing.

- [ ] **Step 1: Hold the eater's gain, scheduled to the tendril's arrival**

In the fodder effect, immediately after the `keyed` array is built (the `[...gains].map(...)` line around
`Recruit.tsx:3022`), add:

```tsx
        // The eater's number lands WITH the tendril, not at the reducer tick. This is why the `+X/+X` float
        // below could finally be cut: it existed because the badge changed too early for the beat to have a
        // payoff, and scheduling the badge to the same arrival removes the reason for a second readout.
        for (const k of keyed) {
          holdStat(k.uid, { attack: k.attack, health: k.health },
            { origin: 'cue', startAt: CRUMBLE_MS + icfg.travelMs });
        }
```

Place it *before* the `floatT = window.setTimeout(...)` that follows, so the hold is installed at commit time
rather than at the tendril's arrival — the number must be withheld from the moment it changes.

- [ ] **Step 2: Cut the fodder `+X/+X` float**

Delete the `setStatFloats` call inside that `floatT` timeout and its paired 1500ms clean-up
`window.setTimeout(() => setStatFloats(...))`, keeping the impact-wiggle `el?.animate(...)` loop between
them. Replace the deleted lines with:

```tsx
        // CUT (2026-08-04): the badge carries this now, scheduled to this same arrival — see the `holdStat`
        // above. This was the LAST `+X/+X` float in the game; the combat one went in `choreo/channels/float.ts`
        // and the generic recruit one went with the intrinsic roll.
```

- [ ] **Step 3: Remove the now-dead float state if nothing else uses it**

Run: `npx eslint packages/ui/src/Recruit.tsx`

If `statFloats`, `setStatFloats`, `statFloatKey` and the `buffFloat` prop threading at `Recruit.tsx:4109`
and `4158` now have no remaining producer, delete all of them, plus `Card`'s `buffFloat` prop
(`Card.tsx:276`, `:316`, `:667-669`) and the `.float.buff.cardfloat` rule in `styles.css`. If any producer
remains, leave them and note which in the commit message.

- [ ] **Step 4: Verify in the browser**

Feed a Demon a Fodder in the Scene Builder and confirm: no `+X/+X` float appears, and the eater's badge
changes as the tendril lands rather than at the click.

- [ ] **Step 5: Full gates and commit**

```bash
npx tsc -b && npx vitest run && npx eslint packages/ui/src/Recruit.tsx packages/ui/src/Card.tsx
git add packages/ui/src/Recruit.tsx packages/ui/src/Card.tsx packages/ui/src/styles.css
git commit -m "feat(fx): the eater's number lands with the tendril; the last +X/+X float goes"
```

---

## Task 7: Wire `releaseAllStats`, and prove the cascade in a browser

**Files:**
- Modify: `packages/ui/src/store.ts`
- Create: `docs/superpowers/harness/cascade-verify.mjs`
- Modify: `docs/devlog.md`, `docs/roadmap.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the committed harness later plans reuse.

- [ ] **Step 1: Call `releaseAllStats` on a phase change**

`releaseAllStats` is currently never called in production — only from tests — despite its doc comment
describing exactly this.

The hook point is the post-dispatch cue dispatcher in `packages/ui/src/store.ts` — the function containing
the `switch` on action type that ends `case 'faceOmen': sfx.combatStart(); break;` at `store.ts:124`. It
already receives both `prev` and `next` run states and compares them (`store.ts:129` does
`if (!prev.discover && next.discover)`), so the phase edge is available without new plumbing. Immediately
after that switch's closing brace at `store.ts:126`, add:

```ts
  // A hold must never outlive the scene that placed it. uids are reused across runs, so a survivor
  // withholds someone else's number — and `heldFor` sweeps on read, so nothing would notice. Caught while
  // scoping the combat unification: `releaseAllStats` has existed, documented for exactly this, and been
  // called by nothing but its own tests. Survivable only while the store served a single surface.
  if (prev.phase !== next.phase) {
    releaseAllStats();
    clearAllSpellBuffs();
  }
```

Add the imports at the top of `store.ts`:

```ts
import { releaseAllStats } from './fx/statHold';
import { clearAllSpellBuffs } from './spellBuffFx';
```

Verify the local names: confirm the dispatcher's parameters really are `prev` and `next` before pasting —
if they differ, use the local names rather than renaming them.

- [ ] **Step 2: Write the cascade harness**

Create `docs/superpowers/harness/cascade-verify.mjs`:

```js
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.env.URL ?? 'http://localhost:5205';

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=swiftshader'],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await page.goto(URL, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 1800));
await page.evaluate(() => window.useGame.getState().startSceneBuilder());
await new Promise((r) => setTimeout(r, 900));

const res = await page.evaluate(async () => {
  const G = () => window.useGame.getState();
  // Four minions on the board.
  for (let i = 0; i < 4; i++) {
    window.useGame.setState((s) => ({ run: { ...s.run, shop: [{ ...s.run.shop[0], uid: 'z' + i }] } }));
    await new Promise((r) => setTimeout(r, 150));
    G().dispatch({ type: 'buy', uid: 'z' + i });
    await new Promise((r) => setTimeout(r, 150));
    const h = G().run.hand;
    G().dispatch({ type: 'play', uid: h[h.length - 1].uid });
    await new Promise((r) => setTimeout(r, 350));
  }
  const uids = G().run.board.map((m) => m.uid);
  const readAll = () => Object.fromEntries(uids.map((u) => {
    const el = document.querySelector(`.card[data-uid="${u}"] .badge.atk .value`);
    return [u, el ? el.textContent : null];
  }));

  const before = readAll();
  const landedAt = {};
  const t0 = performance.now();
  const tick = () => {
    const now = readAll();
    for (const u of uids) if (landedAt[u] === undefined && now[u] !== before[u]) landedAt[u] = Math.round(performance.now() - t0);
    if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // A Ruby landing on every minion at once — the Excavator shape.
  window.useGame.setState((s) => ({
    run: {
      ...s.run,
      board: s.run.board.map((c) => ({
        ...c, attack: c.attack + 2, health: c.health + 2,
        buffs: [...(c.buffs ?? []), { source: 'Ruby', attack: 2, health: 2, count: 1 }],
      })),
      rubyLandedFx: uids.map((u) => ({ uid: u, count: 1 })),
      rubyLandedFxSeq: (s.run.rubyLandedFxSeq ?? 0) + 1,
    },
  }));
  await new Promise((r) => setTimeout(r, 3100));

  const times = uids.map((u) => landedAt[u]);
  const spread = Math.max(...times) - Math.min(...times);
  return { uids, landedAt, spread, allLanded: times.every((t) => t !== undefined) };
});

console.log(JSON.stringify(res, null, 2));
const ok = res.allLanded && res.spread > 80;
console.log(ok ? '\nPASS — numbers are staggered' : `\nFAIL — spread ${res.spread}ms, expected a real cascade`);
await browser.close();
process.exit(ok ? 0 : 1);
```

- [ ] **Step 3: Run it against the dev server**

```bash
npm run dev -w apps/web -- --port 5205 --strictPort
node docs/superpowers/harness/cascade-verify.mjs
```

Expected: `PASS`, with `landedAt` values roughly `RUBY_GAP_MS` apart in board order.

- [ ] **Step 4: Run the negative control**

Temporarily change `{ origin: 'cue', startAt: land.at + RUBY_DELIVER_OFFSET_MS }` in `Recruit.tsx` to
`{ origin: 'cue' }`, re-run the harness, and confirm it prints `FAIL` with a spread near 0. **Revert the
change.** A sync test that passes because everything happened to land at once is worse than no test.

- [ ] **Step 5: Update the devlog and roadmap**

Prepend a dated entry to `docs/devlog.md` covering the whole plan: the model (delta / when / how, split
apart), the shared ticker replacing the per-card loop and why, the rank, both cue adoptions, the last float
cut, `releaseAllStats` finally being called, and the harness result including the negative control. In
`docs/roadmap.md`, edit the "Stat readout choreography" Now item down to what remains — the combat
unification — and note that the shop half has shipped.

- [ ] **Step 6: Full gates and commit**

```bash
npx tsc -b && npx vitest run && npx eslint packages/ui/src
git add -A
git commit -m "feat(fx): scheduled stat delivery — the shop half"
git push origin feat/fx-number-spin
```

---

## Why this plan stops at the shop

The spec's combat unification is deliberately **not** in this plan, and it is not a scope cut — it is a
subsystem with a structural problem this plan does not have to solve.

Reading `useCombatReplay.ts` closely: the combat hold is installed by a layout effect
(`useCombatReplay.ts:1491`) which rebuilds the whole map wholesale each beat from `preBuffHolds(beat, events, frame)`,
while the RELEASE lives in two separate post-paint callbacks (`fireBuffCasts` at `:844-858` and
`fireSelfBuffs` at `:866-888`) as `setTimeout`s keyed on a `strikeMs` that is only computed in the post-paint
effect. Under `startAt` those have to become one decision, because the hold must know its own delivery time
at install. That is a genuine restructure of the beat pipeline, not a field addition — plus the
absolute-to-delta conversion, the wholesale-rebuild semantics needing a per-beat clear the accumulating store
does not have, `.statflash`'s retirement, and `autoRoll` on `Card`.

Each half produces working, testable software alone: this plan makes shop cascades sync, and the combat plan
makes combat use the same system. Writing them together would mix a low-risk mechanism change with the
riskiest surface in the game, and the spec already says combat's merge should be gated on a per-frame
assertion that no badge shows a wrong number mid-fight.

**Write the combat plan after this one lands**, against the real behaviour of the shared ticker rather than
against a prediction of it.
