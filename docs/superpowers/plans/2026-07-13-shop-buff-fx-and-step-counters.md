# Shop-phase buff FX + step-progress counters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play combat's source→target buff FX (tendril / descend) when cards buff other minions in the shop, and show an `X/N` step-progress counter below step-based scaling minions.

**Architecture:** Two independent milestones. **M1 (counter)** is UI-only (`cardText.ts` → `CardView` → `Card.tsx`, folded in via `instView.ts` for shop and `Unit.tsx` for combat) — shippable as its own PR. **M2 (buff FX)** captures who-buffed-whom at the recruit-engine dispatch layer into a transient `RunState.recruitBuffFx` list (mirroring the existing `fodderEaten`/`fodderEatenSeq` one-shot-anim pattern), which a new `Recruit.tsx` effect renders through the same `pixiFx.buffTendril` / `pixiFx.descend` singleton combat already uses.

**Tech Stack:** TypeScript monorepo (`@game/sim`, `@game/ui`), Vitest, React, Pixi (via the `pixiFx` singleton). Commands: `npm run typecheck`, `npm test`, `npm run lint`, `npm run build:web`.

**Spec:** `docs/superpowers/specs/2026-07-13-shop-buff-fx-and-step-counters-design.md`

**Ship as two PRs:** M1 first (no sim changes, no dependency on Kevin's files); then M2 (touches `packages/sim/src/recruit.ts` — flag Kevin).

---

## Reference facts (verified in code)

- `pixiFx` is a module singleton: `export const pixiFx = new FxController()` (`packages/ui/src/pixiFx.ts:2041`). Import it anywhere. Renderers: `buffTendril(from, to, cfg)` (`pixiFx.ts:1612`, returns void, fires over `cfg.travelMs`), `descend(x, y, cfg)` (`pixiFx.ts:824`, drops over `cfg.dropMs`).
- Presets: `BUFF_PRESETS[buffPreset(cardId, tribe)]` (`buffPresets.ts:74`) → `TendrilCfg` with `.travelMs`; `DESCEND_PRESETS[descendPreset(cardId, tribe)]` (`descendPresets.ts:48`) → `DescendCfg` with `.dropMs`. Both fall back to a `default`/per-tribe entry, so any cardId resolves.
- Combat's existing trigger `fireBuffCasts` (`useCombatReplay.ts:544`) already branches deathrattle→descend vs living-source→tendril; M2 extracts its render core.
- Recruit dispatch chokepoints (all in `packages/sim/src/recruit.ts`): `applyCastEffects` (2268, spell casts), `fire` (2281, onSummon/onBuy/onConsume), `fireRecruitDeathrattles.fireOnce` (485), the `castSpell` spellCast board-scan (2788), the overflow loop in `makeContext.summon` (2342), and the onPlay/battlecry loops (`playCard` 2987; targeted play 2502; Myra 2572).
- `addBuff(card, source: string, attack, health)` (`recruit.ts:65`) — `source` is only a display-name label, **not** a board reference; that is why capture must happen at the dispatch layer where the source `BoardCard` is known.
- `BoardCard` per-instance scaler fields (`state.ts:73`): `spellProgress?`, `ascendProgress?`, `summonBonus?`, `overflowBonus?`, `hpGrantBonus?`, `eotTick?`, `sellBonus?`, `uid`.
- `reduce` (`reducer.ts:178`) is the single action entry; it already diffs board stats before/after (187-203).
- `CardView` interface: `Card.tsx:54`. Card root `<div className="card …" data-uid={uid}>`: `Card.tsx:301-303`. `instView` composes the shop/board `CardView` (`instView.ts:85`); `Unit.tsx` composes the combat `CardView` (`Unit.tsx:76`). Shop board vs hand `instView` calls: `Recruit.tsx:1141` / `1145`.

---

# Milestone 1 — Step-progress counter (UI-only, ship first)

### Task 1: `stepProgress()` resolver + `StepProgress` type

**Files:**
- Modify: `packages/ui/src/cardText.ts` (append at end of file)
- Test: `packages/ui/src/stepProgress.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/stepProgress.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stepProgress } from './cardText';

describe('stepProgress', () => {
  it('Guel counts 1..4 then wraps (cyclic, per 4 spells)', () => {
    expect(stepProgress('archmagus', { spellProgress: 0 })).toEqual({ current: 0, total: 4 });
    expect(stepProgress('archmagus', { spellProgress: 1 })).toEqual({ current: 1, total: 4 });
    expect(stepProgress('archmagus', { spellProgress: 4 })).toEqual({ current: 4, total: 4 });
    expect(stepProgress('archmagus', { spellProgress: 5 })).toEqual({ current: 1, total: 4 });
  });
  it('Spirit Pup clamps up to its one-time transform threshold', () => {
    const sp = stepProgress('spiritpup', { spellProgress: 3 });
    expect(sp?.total).toBeGreaterThan(0);
    expect(sp?.current).toBe(3);
    const done = stepProgress('spiritpup', { spellProgress: 999 });
    expect(done?.current).toBe(done?.total);
  });
  it('returns null for a continuous accumulator (no threshold)', () => {
    expect(stepProgress('kennelmaster', { summonBonus: 5 })).toBeNull();
  });
  it('returns null for an unknown card', () => {
    expect(stepProgress('not-a-card', {})).toBeNull();
  });
});
```

> Confirm the exact card ids before running: `rg "id: 'archmagus'|Archmagus Guel" packages/content/src` and `rg "spellCastTransform" packages/content/src` (Spirit Pup) and `rg "buffOnSummon" packages/content/src` (a Kennelmaster-style continuous card). If an id differs, update the test literals to the real ids. The resolver itself keys off **effect `do` names**, not ids, so only the test literals depend on this.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- stepProgress`
Expected: FAIL — `stepProgress is not a function` (not yet exported).

- [ ] **Step 3: Implement `stepProgress` + `StepProgress`**

Append to `packages/ui/src/cardText.ts`:

```ts
export interface StepProgress { current: number; total: number; }

/**
 * Discrete "X/N toward the next step / transform / proc" for the STEP-BASED scalers only — the cards whose
 * *ProgressText helpers above compute a countdown: Guel (per 4 spells), Flowing Monk (every N overflows),
 * Crypt Drake (every N attacks), Frontdrake / Money Maker (every N turns), Spirit Pup (transform at N spells),
 * Tara (ascend at N). Cyclic scalers count 1..N then wrap (matching Guel's "1/4 → 2/4 → 4/4 → 1/4"); the
 * one-time transform / ascend count up to and clamp at the threshold. Continuous accumulators (Kennelmaster,
 * Mama Bear, Sergeant, Grim, Squirl Scout, Trail Forager, …) have no threshold → null (no counter). Keys off
 * effect `do` names so it stays in lock-step with the text helpers and needs no per-id list.
 */
export function stepProgress(
  cardId: string,
  p: { spellProgress?: number; summonBonus?: number; ascendProgress?: number; eotTick?: number; attackSeen?: number },
): StepProgress | null {
  const def = CARD_INDEX[cardId];
  if (!def) return null;
  const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
  const cyc = (v: number, total: number): StepProgress => ({ current: v <= 0 ? 0 : ((v - 1) % total) + 1, total });

  if (def.effects.some((e) => e.do === 'spellCastBuffOthers')) return cyc(p.spellProgress ?? 0, 4); // Guel
  const monk = def.effects.find((e) => e.do === 'overflowBuffRandom');
  if (monk) return cyc(p.summonBonus ?? 0, Math.max(1, n((monk.params as { improveEvery?: number })?.improveEvery, 5)));
  const crypt = def.effects.find((e) => e.do === 'onAllyAttackBuffAll');
  if (crypt) return cyc(p.attackSeen ?? 0, Math.max(1, n((crypt.params as { every?: number })?.every, 2)));
  const cadence = def.effects.find((e) => e.on === 'endOfTurn' && (e.params as { every?: number } | undefined)?.every !== undefined);
  if (cadence) return cyc(p.eotTick ?? 0, Math.max(1, n((cadence.params as { every?: number })?.every, 3)));
  const pup = def.effects.find((e) => e.do === 'spellCastTransform');
  if (pup) { const at = Math.max(1, n((pup.params as { at?: number })?.at, 10)); return { current: Math.min(p.spellProgress ?? 0, at), total: at }; }
  if (def.ascendAt && def.ascendInto) { const at = def.ascendAt; return { current: Math.min(p.ascendProgress ?? 0, at), total: at }; }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- stepProgress`
Expected: PASS (all 4).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add packages/ui/src/cardText.ts packages/ui/src/stepProgress.test.ts
git commit -m "feat(ui): stepProgress resolver for step-based scaling cards"
```

---

### Task 2: `CardView.stepProgress` field + `.stepcounter` pill in `Card.tsx`

**Files:**
- Modify: `packages/ui/src/Card.tsx` (interface `CardView` ~54; render inside card root ~339)
- Modify: `packages/ui/src/styles.css` (append `.stepcounter` rule)

- [ ] **Step 1: Add the field to `CardView`**

In `packages/ui/src/Card.tsx`, import the type near the other `./cardText` imports (find the existing `from './cardText'` import and add `type StepProgress`), then add to the `CardView` interface (after line 66, the `goldenText?` field):

```ts
  /** "X/N toward next step" pill for step-based scalers (Guel, Monk, Spirit Pup, …). Absent = no counter. */
  stepProgress?: StepProgress;
```

- [ ] **Step 2: Render the pill inside the card root**

In `Card.tsx`, immediately after the `buffFloat` block (ends line 339) and before the `tierbadge` line (340), insert:

```tsx
      {/* Step-progress counter — "X/N to next step" below step-based scalers (Guel 1/4, Monk 2/5, …). Keyed on
          `current` so each tick replays the compositor-only bump. Board minions only (populated by the caller). */}
      {card.stepProgress && (
        <span
          key={card.stepProgress.current}
          className="stepcounter"
          aria-label={`Step progress ${card.stepProgress.current} of ${card.stepProgress.total}`}
        >
          {card.stepProgress.current}/{card.stepProgress.total}
        </span>
      )}
```

- [ ] **Step 3: Add the CSS (Sunward pill, compositor-only bump)**

Append to `packages/ui/src/styles.css`:

```css
/* Step-progress counter ("X/N to next step") centered just below a step-based scaler's card. Transform/opacity
   only — no looped paint properties (see docs/performance.md). Keyed remount replays `stepbump` on each tick. */
.stepcounter {
  position: absolute;
  left: 50%;
  bottom: -0.7rem;
  transform: translateX(-50%);
  z-index: 3;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  font: 700 0.72rem/1 var(--font-ui, system-ui, sans-serif);
  color: var(--ink, #3a2a1e);
  background: var(--cream, #fff5e6);
  border: 1.5px solid color-mix(in srgb, var(--ink, #3a2a1e) 25%, transparent);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
  pointer-events: none;
  white-space: nowrap;
  animation: stepbump 220ms ease-out;
}
@keyframes stepbump {
  0% { transform: translateX(-50%) scale(1); }
  45% { transform: translateX(-50%) scale(1.28); }
  100% { transform: translateX(-50%) scale(1); }
}
```

> Confirm the token names exist: `rg -- "--cream|--ink|--font-ui" packages/ui/src/styles.css`. If a token differs, swap to the real variable (the fallbacks in the rule keep it correct regardless).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (No unit test — verified live in Task 5 after wiring.)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/Card.tsx packages/ui/src/styles.css
git commit -m "feat(ui): .stepcounter pill on CardView"
```

---

### Task 3: Wire the counter into the shop board (`instView.ts`), board-only

**Files:**
- Modify: `packages/ui/src/instView.ts` (import, `live` type ~100, return object ~123)
- Modify: `packages/ui/src/Recruit.tsx` (board `instView` call, line 1141)

- [ ] **Step 1: Import `stepProgress` in `instView.ts`**

In the `from './cardText'` import block (lines 4-9), add `stepProgress` to the imported names.

- [ ] **Step 2: Add `onBoard` to the `live` param type**

In `instView`'s signature, the `live?: { … }` object type (line 100), append `; onBoard?: boolean` before the closing `}`.

- [ ] **Step 3: Populate `stepProgress` in the returned `CardView` (board only)**

In the returned object (starts line 123), add a field (after `buffs: inst.buffs,` line 132):

```ts
    stepProgress: live?.onBoard
      ? (stepProgress(inst.cardId, {
          spellProgress: inst.spellProgress, summonBonus: inst.summonBonus,
          ascendProgress: inst.ascendProgress, eotTick: inst.eotTick,
        }) ?? undefined)
      : undefined,
```

> `attackSeen` is a combat-only accrual (Crypt Drake procs on attacks, which never happen in the shop), so it is omitted here — a shop Crypt Drake reads `0/N`, which is correct.

- [ ] **Step 4: Pass `onBoard: true` from the board call in `Recruit.tsx`**

At `Recruit.tsx:1141`, the board `instView(...)` call passes `live` as its final argument. Replace that final `live` argument with `{ ...live, onBoard: true }`. Leave the hand call (line 1145) unchanged (hand copies show no counter).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add packages/ui/src/instView.ts packages/ui/src/Recruit.tsx
git commit -m "feat(ui): show step counter on board minions in the shop"
```

---

### Task 4: Wire the counter into combat (`Unit.tsx`)

**Files:**
- Modify: `packages/ui/src/Unit.tsx` (import ~5; `view` object ~76-95)

- [ ] **Step 1: Import `stepProgress`**

In `Unit.tsx`'s `from './cardText'` import (line 5), add `stepProgress`.

- [ ] **Step 2: Populate `view.stepProgress`**

In the `const view: CardView = { … }` object (lines 76-95), add (after `buffs: u.buffs,` line 94):

```ts
    // Live step counter (Guel 1/4, Crypt Drake 1/2, …) — ticks mid-fight from the unit's per-instance accruals.
    stepProgress: stepProgress(u.cardId, {
      spellProgress: u.spellProgress, summonBonus: u.summonBonus,
      ascendProgress: u.ascendProgress, eotTick: u.eotTick, attackSeen: u.attackSeen,
    }) ?? undefined,
```

> Verify these fields exist on the combat unit `u`: they are already read a few lines above (`u.spellProgress` at 69, `u.summonBonus` at 70, `u.ascendProgress` at 66, `u.attackSeen` at 65). If `u.eotTick` is not present on the combat unit type, drop that one key (combat has no End-of-Turn cadence, so it is `0/N` regardless).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/Unit.tsx
git commit -m "feat(ui): show live step counter on combat minions"
```

---

### Task 5: Live verification (M1)

- [ ] **Step 1: Full check**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green.

- [ ] **Step 2: Live DOM check in the browser preview**

Start the dev server (`npm run dev` via the preview tool), reach the shop, and confirm via DOM:
- Buy/play an **Archmagus Guel** onto the board → a `.stepcounter` reading `0/4` appears below it.
- Cast a spell → the pill ticks to `1/4`, then `2/4`, … (use `read_page` / a DOM query for `.stepcounter`).
- A **hand/shop** copy of Guel shows **no** `.stepcounter`.
- A continuous scaler (e.g. Kennelmaster) shows **no** pill.

Fix any issues (re-check from Step 1), then this milestone is complete. **Open PR for M1.**

---

# Milestone 2 — Shop-phase buff FX (tendril / descend)

### Task 6: `BuffFxEvent` type + `recruitBuffFx` / `recruitFxSeq` on `RunState`

**Files:**
- Modify: `packages/sim/src/state.ts` (add type near `RunState`; add fields to `RunState` ~207; init ~715-721)
- Test: `packages/sim/src/recruitBuffFx.test.ts` (create)

- [ ] **Step 1: Write the failing test (determinism unaffected + fields initialised)**

Create `packages/sim/src/recruitBuffFx.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { newRun } from './state';

describe('recruitBuffFx run-state fields', () => {
  it('initialise empty on a fresh run', () => {
    const s = newRun(12345);
    expect(s.recruitBuffFx).toEqual([]);
    expect(s.recruitFxSeq).toBe(0);
  });
});
```

> Confirm the run factory name: `rg "export function (newRun|makeRun|createRun|startRun)" packages/sim/src/state.ts`. Use the real name in the test import and in Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- recruitBuffFx`
Expected: FAIL — `recruitBuffFx` is undefined / `recruitFxSeq` is undefined.

- [ ] **Step 3: Add the type + fields + init**

In `packages/sim/src/state.ts`, add the interface just above `export interface RunState` (line 207):

```ts
/** One shop-phase buff-other, captured for the UI to replay as a source→target tendril (living-minion source)
 *  or a rain-down descend (`spell` / `deathrattle` — no living source). Pure display metadata: consumes no RNG
 *  and does not affect stats, so determinism / golden sims are unaffected. Mirrors the `fodderEaten` pattern. */
export interface BuffFxEvent {
  sourceUid?: string;       // present + kind:'minion' → tendril from this board minion; absent → descend
  targetUid: string;
  attack: number;
  health: number;
  sourceCardId: string;     // for buffPreset (tendril tribe look)
  sourceTribe: Tribe;
  kind: 'minion' | 'spell' | 'deathrattle';
}
```

Add these fields inside `RunState` (near `fodderEaten?` at line 398 / `fodderEatenSeq` at 400):

```ts
  /** Transient buff-other FX captured during the CURRENT action (cleared at the top of `reduce`). */
  recruitBuffFx: BuffFxEvent[];
  /** Monotonic bump when `recruitBuffFx` is non-empty after an action — the UI fires once per change. */
  recruitFxSeq: number;
```

In the run-factory initialiser (alongside `fodderEatenSeq: 0,` at line 721), add:

```ts
    recruitBuffFx: [],
    recruitFxSeq: 0,
```

Ensure `Tribe` is imported in `state.ts` (it already imports from `@game/core`; add `Tribe` to that import if absent).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- recruitBuffFx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add packages/sim/src/state.ts packages/sim/src/recruitBuffFx.test.ts
git commit -m "feat(sim): recruitBuffFx transient buff-FX list on RunState"
```

---

### Task 7: `captureBuffFx` dispatch wrapper + wire the dispatch sites

**Files:**
- Modify: `packages/sim/src/recruit.ts` (helper near `addBuff` ~65; wraps at the dispatch sites listed below)
- Test: `packages/sim/src/recruitBuffFx.test.ts` (extend)

**Approach:** one helper snapshots every board card's `{attack,health}` by uid, runs the factory, then diffs — attributing each *other* card's gain to the known source, with the given `kind`. Wrapping the ~6 dispatch loops (not the ~20 `addBuff` call sites) keeps the change small and correct.

- [ ] **Step 1: Write the failing tests**

Extend `packages/sim/src/recruitBuffFx.test.ts`:

```ts
import { reduce } from './reducer';
// (helpers to build a run with a specific board differ per repo — mirror an existing run.test.ts setup.)

describe('captureBuffFx', () => {
  it('a spell cast that buffs the whole board records spell-kind events (no sourceUid)', () => {
    // Arrange a run with 2 board minions + a board-wide buff spell (Growth) in hand, then cast it.
    // Assert: after the cast, run.recruitBuffFx has entries with kind:'spell', sourceUid undefined,
    //         attack/health = the grant, one per buffed board minion.
  });
  it('Archmagus Guel buffing others on a spell cast records minion-kind events sourced from Guel', () => {
    // Arrange: Guel + >=1 other minion on board; cast any spell.
    // Assert: recruitBuffFx contains kind:'minion' events with sourceUid === Guel's uid.
  });
});
```

> These need a board-construction helper. Find the pattern already used for buff tests: `rg "recruit|playCard|castSpell" packages/sim/src/run.test.ts | head` and copy an existing "set up a board then act" test's scaffolding (e.g. the tests around `spellCastBuffOthers` / Growth). Fill the Arrange/Assert bodies with real values from that scaffolding before running.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- recruitBuffFx`
Expected: FAIL — `recruitBuffFx` stays `[]` (nothing captures yet).

- [ ] **Step 3: Add the `captureBuffFx` helper**

In `packages/sim/src/recruit.ts`, just below `addBuff` (after line 81), add:

```ts
/**
 * Run a recruit factory dispatch and capture any buff it applied to OTHER board minions as `BuffFxEvent`s on
 * `state.recruitBuffFx`, for the UI to replay as a tendril (living `source`) or a descend (`source` undefined /
 * kind spell|deathrattle). Diffs board `{attack,health}` by uid around `run()`, attributing each other card's
 * positive delta to `source`. Pure display metadata — the diff is ≤7 entries and never touches RNG or stats.
 */
function captureBuffFx(
  state: RunState,
  source: BoardCard | undefined,
  kind: BuffFxEvent['kind'],
  run: () => void,
): void {
  const before = new Map(state.board.map((c) => [c.uid, { a: c.attack, h: c.health }]));
  run();
  for (const c of state.board) {
    if (source && c.uid === source.uid) continue;      // self-buffs use the pulse channel, not a tendril
    const p = before.get(c.uid);
    if (!p) continue;                                   // a newly summoned card is creation, not a buff
    const da = c.attack - p.a;
    const dh = c.health - p.h;
    if (da <= 0 && dh <= 0) continue;
    state.recruitBuffFx.push({
      sourceUid: kind === 'minion' ? source?.uid : undefined,
      targetUid: c.uid, attack: da, health: dh,
      sourceCardId: source?.cardId ?? '', sourceTribe: source?.tribe ?? 'neutral',
      kind,
    });
  }
}
```

Ensure `BuffFxEvent` is imported from `./state` (add it to the existing `import { … } from './state'`).

- [ ] **Step 4: Wrap the dispatch sites**

Apply these wraps (each is the same pattern — wrap the existing factory-invoking `fn(...)` call). Show every edit exactly:

**(a) Spell casts** — `applyCastEffects`, `recruit.ts:2276`. Replace:
```ts
    if (fn) fn(ctx, target as BoardCard, params, { minion: target as BoardCard });
```
with:
```ts
    if (fn) captureBuffFx(ctx.state, undefined, 'spell', () => fn(ctx, target as BoardCard, params, { minion: target as BoardCard }));
```

**(b) onSummon / onBuy / onConsume** — `fire`, `recruit.ts:2293`. Replace:
```ts
      if (fn) fn(ctx, card, effect.params ?? {}, payload);
```
with:
```ts
      if (fn) captureBuffFx(ctx.state, card, 'minion', () => fn(ctx, card, effect.params ?? {}, payload));
```

**(c) Overflow** — `makeContext.summon`, `recruit.ts:2345`. Replace:
```ts
            if (fn) fn(ctx, c, effect.params ?? {}, { minion: c });
```
with:
```ts
            if (fn) captureBuffFx(ctx.state, c, 'minion', () => fn(ctx, c, effect.params ?? {}, { minion: c }));
```

**(d) Recruit Deathrattles** — `fireRecruitDeathrattles.fireOnce`, `recruit.ts:488`. Replace:
```ts
      RECRUIT_FACTORIES[eff.do]?.(ctx, minion, eff.params ?? {}, { minion });
```
with:
```ts
      captureBuffFx(ctx.state, minion, 'deathrattle', () => RECRUIT_FACTORIES[eff.do]?.(ctx, minion, eff.params ?? {}, { minion }));
```

**(e) spellCast board-scan (Guel)** — `castSpell`, `recruit.ts:2788-2795`. This loop iterates board cards with a `spellCast` effect. Wrap the factory call. Read the exact lines first (`sed -n '2788,2800p' packages/sim/src/recruit.ts`); the factory invocation is `fn(ctx, card, effect.params ?? {}, { minion: card })` (or similar). Wrap it:
```ts
        captureBuffFx(state, card, 'minion', () => fn(ctx, card, effect.params ?? {}, { minion: card }));
```
(`castSpell` has `state` in scope; `ctx = makeContext(state)` shares it.)

**(f) Battlecries (onPlay)** — three loops. For each, wrap the `fn(...)`/factory call with `captureBuffFx(<state>, <the played/target minion>, 'minion', () => …)`:
- `playCard`, `recruit.ts:2987` (read `sed -n '2985,3000p'`) — source is the played minion.
- Targeted play, `recruit.ts:2502` (read `sed -n '2500,2512p'`) — source is the played minion.
- Myra re-fire, `recruit.ts:2572` (read `sed -n '2567,2585p'`) — source is the re-fired minion.

> If any of (e)/(f) uses `RECRUIT_FACTORIES[effect.do]?.(...)` inline rather than a captured `fn`, wrap that whole call expression the same way. Keep the source argument = the minion whose effect is firing.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- recruitBuffFx`
Expected: PASS.

- [ ] **Step 6: Run the full sim suite (determinism guard)**

Run: `npm test -- packages/sim`
Expected: PASS — existing determinism/golden tests unchanged (capture adds no RNG, no stat change).

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add packages/sim/src/recruit.ts packages/sim/src/recruitBuffFx.test.ts
git commit -m "feat(sim): capture shop buff-other source→target as recruitBuffFx"
```

---

### Task 8: Reset `recruitBuffFx` + bump `recruitFxSeq` in `reduce`

**Files:**
- Modify: `packages/sim/src/reducer.ts` (`reduce` entry ~178-179; end of `reduce`)
- Test: `packages/sim/src/recruitBuffFx.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Extend the test: after an action that produces buffs, `next.recruitFxSeq === state.recruitFxSeq + 1` and `next.recruitBuffFx.length > 0`; after an action that produces none (e.g. reroll), `recruitFxSeq` is unchanged and `recruitBuffFx` is `[]`.

```ts
it('bumps recruitFxSeq once per action that buffed, and stays flat otherwise', () => {
  // Act with a buff-producing action → seq +1, list non-empty.
  // Act with a no-buff action (e.g. a plain reroll) → seq unchanged, list [].
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- recruitBuffFx`
Expected: FAIL — seq never advances.

- [ ] **Step 3: Reset at entry, bump at exit**

In `packages/sim/src/reducer.ts`, at the very top of `reduce` (before `const next = reduceCore(...)`, line 179):

```ts
  state.recruitBuffFx = [];   // scratch: only the CURRENT action's captures survive into `next`
```

> `reduceCore` shares the working `state`/board references (the existing before/after diffs at 187-203 rely on this), so clearing here means captures pushed during the action land on the returned `next`. Verify `next` carries the same `recruitBuffFx` array reference (it does when `reduceCore` mutates in place). If `reduceCore` deep-clones state, instead clear on `next` right after it returns and re-run captures — but the existing in-place diffs confirm it does not clone.

At the end of `reduce`, just before `return next;`, add:

```ts
  if (next !== state && next.recruitBuffFx.length > 0) next.recruitFxSeq += 1;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- recruitBuffFx`
Expected: PASS.

- [ ] **Step 5: Full sim suite + typecheck + commit**

```bash
npm test -- packages/sim && npm run typecheck
git add packages/sim/src/reducer.ts packages/sim/src/recruitBuffFx.test.ts
git commit -m "feat(sim): bump recruitFxSeq per buffing action"
```

---

### Task 9: Shared `fireBuffFx` render helper (extract from combat)

**Files:**
- Create: `packages/ui/src/buffFxRender.ts`
- Modify: `packages/ui/src/useCombatReplay.ts` (`fireBuffCasts` render branch ~554-567)
- Test: `packages/ui/src/buffFxRender.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/buffFxRender.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('./pixiFx', () => ({ pixiFx: { descend: vi.fn(), buffTendril: vi.fn() } }));
import { pixiFx } from './pixiFx';
import { fireBuffFx } from './buffFxRender';

describe('fireBuffFx', () => {
  it('sourceless → descend at the target, returns dropMs', () => {
    const ms = fireBuffFx({ target: { x: 10, y: 20 }, cardId: 'x', tribe: 'neutral', sourceless: true });
    expect((pixiFx.descend as any)).toHaveBeenCalledWith(10, 20, expect.anything());
    expect(ms).toBeGreaterThan(0);
  });
  it('with a source → tendril source→target, returns travelMs', () => {
    const ms = fireBuffFx({ source: { x: 0, y: 0 }, target: { x: 5, y: 5 }, cardId: 'x', tribe: 'beast', sourceless: false });
    expect((pixiFx.buffTendril as any)).toHaveBeenCalledWith({ x: 0, y: 0 }, { x: 5, y: 5 }, expect.anything());
    expect(ms).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- buffFxRender`
Expected: FAIL — `fireBuffFx` not found.

- [ ] **Step 3: Implement the helper**

Create `packages/ui/src/buffFxRender.ts`:

```ts
import type { Tribe } from '@game/core';
import { pixiFx } from './pixiFx';
import { BUFF_PRESETS, buffPreset } from './buffPresets';
import { DESCEND_PRESETS, descendPreset } from './descendPresets';

/** Fire ONE buff-other effect on the shared FX overlay and return the strike/landing time (ms) so the caller
 *  can schedule its stat-badge flash. `sourceless` (spell / dead Deathrattle, or a missing source rect) rains a
 *  descend onto the target; otherwise a source→target tendril. The single render path shared by the combat
 *  replay (`useCombatReplay.fireBuffCasts`) and the shop (`Recruit` recruitFxSeq effect). */
export function fireBuffFx(o: {
  source?: { x: number; y: number };
  target: { x: number; y: number };
  cardId: string;
  tribe: Tribe;
  sourceless: boolean;
}): number {
  if (o.sourceless || !o.source) {
    const d = DESCEND_PRESETS[descendPreset(o.cardId, o.tribe)];
    pixiFx.descend(o.target.x, o.target.y, d);
    return d.dropMs;
  }
  const t = BUFF_PRESETS[buffPreset(o.cardId, o.tribe)];
  pixiFx.buffTendril(o.source, o.target, t);
  return t.travelMs;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- buffFxRender`
Expected: PASS.

- [ ] **Step 5: Refactor `fireBuffCasts` to use it (no behaviour change)**

In `packages/ui/src/useCombatReplay.ts`, replace the render branch (lines 553-567, the `let strikeMs …` through the `else { … }` block) with a single `fireBuffFx` call, preserving the surrounding rect/hold logic:

```ts
      const sEl = isDeathrattleBufferCard(cardId) ? null : findEl(c.source);
      const sr = sEl?.getBoundingClientRect();
      const strikeMs = fireBuffFx({
        source: sr ? { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 } : undefined,
        target: tc,
        cardId, tribe,
        sourceless: isDeathrattleBufferCard(cardId),
      });
```

Add `import { fireBuffFx } from './buffFxRender';` at the top. Remove the now-unused direct `pixiFx.descend` / `pixiFx.buffTendril` calls in this function and any now-unused `BUFF_PRESETS` / `DESCEND_PRESETS` / `buffPreset` / `descendPreset` imports **only if** they are unused elsewhere in the file (check with `rg "BUFF_PRESETS|DESCEND_PRESETS|buffPreset|descendPreset" packages/ui/src/useCombatReplay.ts` — keep any still referenced by other channels).

- [ ] **Step 6: Verify combat unchanged**

Run: `npm test -- useCombatReplay choreo` and `npm run typecheck`
Expected: PASS — the combat replay tests still pass (render extracted, logic identical).

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/buffFxRender.ts packages/ui/src/buffFxRender.test.ts packages/ui/src/useCombatReplay.ts
git commit -m "refactor(ui): extract shared fireBuffFx render helper"
```

---

### Task 10: Render shop buff FX + reconcile with the green burst

**Files:**
- Modify: `packages/ui/src/Recruit.tsx` (new effect near the stat-diff effect ~1715; suppress the burst for FX-handled targets in the diff effect ~1686-1687)

- [ ] **Step 1: Add the effect that fires FX on `recruitFxSeq`**

In `Recruit.tsx`, add `import { fireBuffFx } from './buffFxRender';` with the other imports. Add a ref to record which uids the FX handled this tick (declare near the other refs, e.g. beside `prevStatsRef`):

```tsx
  const fxHandledRef = useRef<Set<string>>(new Set());
```

Add this effect (place it right after the stat-diff `useEffect` that ends at line 1715):

```tsx
  // Shop-phase buff FX: when the sim captured buff-others this action (recruitFxSeq bumped), replay each as a
  // source→target tendril (living minion) or a descend (spell / Deathrattle), using the same renderer as combat.
  // Records handled targets so the passive stat-diff green burst below skips them (no double-FX).
  useEffect(() => {
    if (run.recruitFxSeq === 0 || run.recruitBuffFx.length === 0) return;
    const handled = new Set<string>();
    for (const ev of run.recruitBuffFx) {
      const tEl = findEl(ev.targetUid);
      if (!tEl) continue;
      const tr = tEl.getBoundingClientRect();
      const target = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };
      const sEl = ev.sourceUid ? findEl(ev.sourceUid) : null;
      const sr = sEl?.getBoundingClientRect();
      fireBuffFx({
        source: sr ? { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 } : undefined,
        target,
        cardId: ev.sourceCardId, tribe: ev.sourceTribe,
        sourceless: ev.kind !== 'minion' || !sEl,
      });
      handled.add(ev.targetUid);
    }
    fxHandledRef.current = handled;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.recruitFxSeq]);
```

> `run.recruitBuffFx` is intentionally omitted from the deps (it is read fresh each time `recruitFxSeq` changes; `recruitFxSeq` is the single fire signal, matching how `fodderEatenSeq` is consumed — check that pattern with `rg "fodderEatenSeq" packages/ui/src/Recruit.tsx` and mirror its effect deps exactly).

- [ ] **Step 2: Suppress the duplicate green burst for FX-handled targets**

In the stat-diff effect, where the green burst is set (line 1687 `setBuffedUids((s) => new Set([...s, ...newly]));`), filter out uids the FX handled this tick. Replace line 1687 with:

```tsx
    const burstable = newly.filter((u) => !fxHandledRef.current.has(u));
    if (burstable.length > 0) setBuffedUids((s) => new Set([...s, ...burstable]));
    fxHandledRef.current = new Set(); // consumed — clear for the next action
```

Keep the `+X/+X` float (the `gained` / `setStatFloats` block below, lines 1689-1703) unchanged — the float still shows on FX-handled targets; only the burst ring is suppressed.

> Note the ordering: React runs effects in declaration order, and the FX effect (Step 1, added after the stat-diff effect) therefore runs **after** the stat-diff effect within the same commit — so `fxHandledRef` would be set too late for that commit. To fix, move the new FX effect to be declared **before** the stat-diff effect (so it populates `fxHandledRef` first), OR gate the burst on `run.recruitBuffFx` directly instead of the ref. Simplest robust approach: in the stat-diff effect compute handled inline — `const fxTargets = new Set(run.recruitBuffFx.map((e) => e.targetUid));` and filter `newly` by it. Use that inline form (drop `fxHandledRef` entirely) to avoid the cross-effect ordering hazard:

```tsx
    const fxTargets = new Set(run.recruitBuffFx.map((e) => e.targetUid));
    const burstable = newly.filter((u) => !fxTargets.has(u));
    if (burstable.length > 0) setBuffedUids((s) => new Set([...s, ...burstable]));
```

Add `run.recruitBuffFx` to the stat-diff effect's dependency array (line 1715) if using the inline form. Prefer this inline form; remove the `fxHandledRef` ref from Step 1.

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/Recruit.tsx
git commit -m "feat(ui): replay shop buff-other FX (tendril/descend) from recruitFxSeq"
```

---

### Task 11: Live verification (M2)

- [ ] **Step 1: Full check**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green.

- [ ] **Step 2: Live DOM/visual check**

Start `npm run dev` via the preview tool, reach the shop, and verify:
- Play a **Battlecry buff-other** minion (e.g. a Dragon that buffs your Dragons) → a **tendril** flies from the played minion to each buffed ally; the target's badge shows the new stats; **no** separate green burst ring on those targets (the `+X/+X` float still shows).
- Play a beast while a **Kennelmaster** is already on board → the tendril originates from **Kennelmaster** (the true source), not the played beast.
- Cast a board-wide buff spell (Growth) → a **descend** rains onto each buffed minion (no tendril, since the source is the spell).
- **Archmagus Guel** on board + cast a spell → a tendril flies from Guel to the buffed minions, and (M1) Guel's `.stepcounter` ticks.
- Passive auras (Lantern of Souls when you add an Undead) → **no** tendril (excluded).

Use `read_console_messages` to confirm no errors, `computer` screenshot for the tendril/descend. Fix issues (re-check from Step 1), then **open PR for M2** (flag Kevin: touches `packages/sim/src/recruit.ts`).

---

## Docs (both milestones — per CLAUDE.md, same commit as the feature)

- [ ] Update `docs/devlog.md` (newest-first dated entry: what changed in engine/UI, how verified).
- [ ] Update `docs/roadmap.md` (move these items out of the queue).
- [ ] Update `README.md` **Recent changes** + **Short-term roadmap**.

Commit with the final task of each milestone.

---

## Self-review notes (coverage check)

- **Spec Part A (routing by source presence):** Task 7 sets `kind:'minion'` with `sourceUid` (→ tendril) vs `spell`/`deathrattle` (→ descend); Task 9/10 render accordingly. ✓
- **Spec Part A (discrete triggers only, auras excluded):** only the discrete dispatch loops are wrapped (Task 7); passive auras (`applyDenMarker`, Lantern fold, buy-time imp aura) are not wrapped. ✓
- **Spec Part A (reconcile with existing shop flash):** Task 10 Step 2 suppresses the green burst for FX-handled targets, keeps the float. ✓
- **Spec Part B (six step scalers, cadence in, continuous out):** Task 1 resolver keys off the six effect signatures; continuous accumulators → null. ✓
- **Spec Part B (board-only + live in combat, 1→N wrap):** Task 3 gates on `onBoard`; Task 4 combat; `cyc` wraps 1→N, one-time clamps. ✓
- **Determinism:** Task 6/7 note + Task 7 Step 6 runs the sim suite. ✓
- **Type consistency:** `BuffFxEvent` (state.ts) fields used identically in `captureBuffFx` (Task 7) and the Recruit effect (Task 10); `StepProgress` used in cardText.ts (Task 1), CardView (Task 2), instView (Task 3), Unit (Task 4); `fireBuffFx` signature identical in Task 9 def + Task 9 combat call + Task 10 shop call. ✓
