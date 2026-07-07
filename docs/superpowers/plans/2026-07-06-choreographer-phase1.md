# Combat Choreographer — Phase 1: Step Tags + Moment Compiler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The sim tags every combat event with a resolution-step id (pure metadata, outcomes unchanged), and a new config-driven Moment Compiler replaces `buildBeats` behind an equivalence guarantee.

**Architecture:** `simulate()` gains a step counter bumped at each atomic resolution point; all event emissions route through one `emit()` that stamps the current step. `packages/ui/src/choreo/compile.ts` introduces `compileMoments(events, rules)` whose DEFAULT rules reproduce `buildBeats` byte-identically (golden-tested) while carrying per-moment `stepGroups` for later phases. `useCombatReplay` swaps to the compiler via its `Beat`-compatible shape. No visible behavior change anywhere.

**Tech Stack:** TypeScript monorepo; Vitest; the existing determinism/golden suites are the safety net.

**Spec:** `docs/superpowers/specs/2026-07-06-combat-choreographer-design.md` (Phase 1 section).
**Branch:** `feat/combat-choreographer` (already created; spec committed).
**Coordination:** Task 1 touches `packages/core/src/types.ts` + `combat/simulate.ts` (Kevin's territory — pre-agreed; the owner announces taking the files when execution starts). Phases 2–4 are separate plans.

---

### Task 1: `step` tag — type + emitter + bump sites in `simulate()`

**Files:**
- Modify: `packages/core/src/types.ts:444-463` (the `CombatEvent` union)
- Modify: `packages/core/src/combat/simulate.ts` (emitter + ~21 push-site conversions + bump sites)
- Test: `packages/core/src/combat/simulate.test.ts` (append a new `describe`)

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/combat/simulate.test.ts`:

```ts
describe('resolution step tags', () => {
  it('every event carries a monotonically non-decreasing step id', () => {
    const r = simulate(
      [{ cardId: 'stray', attack: 3, health: 10 }, { cardId: 'sandbag', attack: 0, health: 5 }],
      [{ cardId: 'pack', attack: 2, health: 2 }],
      makeRng(3), CARD_INDEX,
    );
    expect(r.events.length).toBeGreaterThan(0);
    let prev = -1;
    for (const e of r.events) {
      expect(typeof e.step).toBe('number');
      expect(e.step!).toBeGreaterThanOrEqual(prev);
      prev = e.step!;
    }
  });

  it('an attack and its same-swing damage (hit + retaliation) share one step', () => {
    const r = simulate(
      [{ cardId: 'stray', attack: 3, health: 10 }],
      [{ cardId: 'sandbag', attack: 2, health: 8 }],
      makeRng(3), CARD_INDEX,
    );
    const atkIdx = r.events.findIndex((e) => e.type === 'attack');
    const atk = r.events[atkIdx]!;
    const dmgs = r.events.filter((e) => e.type === 'dmg' && e.step === atk.step);
    // both bodies of the clash take their damage inside the attack's own step
    expect(dmgs.map((d) => (d as { target: string }).target).sort()).toEqual(
      [(atk as { attacker: string }).attacker, (atk as { defender: string }).defender].sort(),
    );
  });

  it("a Deathrattle's summons land in a LATER step than the death they follow", () => {
    const r = simulate(
      [{ cardId: 'stray', attack: 3, health: 10 }],
      [{ cardId: 'pack', attack: 2, health: 2 }], // Mama Pup — Deathrattle summons 2 Pups
      makeRng(3), CARD_INDEX,
    );
    const death = r.events.find((e) => e.type === 'death')!;
    const summon = r.events.find((e) => e.type === 'summon')!;
    expect(summon.step!).toBeGreaterThan(death.step!);
  });

  it('step tags are deterministic (same seed → identical tags)', () => {
    const roster: Parameters<typeof simulate>[0] = [{ cardId: 'stray', attack: 3, health: 10 }];
    const foe: Parameters<typeof simulate>[1] = [{ cardId: 'pack', attack: 2, health: 2 }];
    const a = simulate(roster, foe, makeRng(7), CARD_INDEX);
    const b = simulate(roster, foe, makeRng(7), CARD_INDEX);
    expect(a.events.map((e) => e.step)).toEqual(b.events.map((e) => e.step));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/core/src/combat/simulate.test.ts -t 'resolution step tags'`
Expected: FAIL — `e.step` is `undefined` (type error first: `step` not on `CombatEvent`; add the type in step 3 then re-run).

- [ ] **Step 3: Add the type.** In `packages/core/src/types.ts`, directly ABOVE the `export type CombatEvent =` union (line ~444), add the doc + wrap the union. The union's 18 variants stay verbatim; only the declaration line and a closing intersection change:

```ts
/** Resolution-step tag: `simulate()` stamps every event with the id of the atomic resolution that emitted
 *  it (one attack swing's exchange, one death's rattle, one Start-of-Combat cast, …). Pure presentation
 *  metadata — it never affects outcomes — letting the UI's moment compiler know true simultaneity instead
 *  of inferring it. Optional so synthetic fixtures (tests) can omit it; real sim output always carries it. */
export type CombatEvent = (
  | { type: 'sc'; source: string; text: string; cast?: true }
  // … all 18 existing variants, UNCHANGED, moved inside the parens …
  | { type: 'hpGrant'; target: string; amount: number }
) & { step?: number };
```

(Discriminated-union narrowing on `e.type` is unaffected by the intersection.)

- [ ] **Step 4: Add the emitter + counter in `simulate.ts`.** Right after the `events` array is created (near the top of `simulate()`, before `ctx` at line ~197), add:

```ts
  // Resolution-step tag (choreographer spec 2026-07-06): `stepN` identifies the atomic resolution moment
  // each event belongs to. `emit` stamps it; `nextStep()` is called wherever a NEW atomic resolution begins
  // (one attack swing's exchange, one victim's death resolution, its rattle's effects, one SC cast, …).
  // Pure metadata: zero logic/RNG/order impact — outcomes are locked by the determinism + golden suites.
  // Rule of thumb when extending the sim: finer is safer (the UI compiler can MERGE steps, never split them).
  let stepN = 0;
  const nextStep = (): void => { stepN++; };
  const emit = (e: CombatEvent): void => { events.push({ ...e, step: stepN }); };
```

- [ ] **Step 5: Route every emission through `emit`.** Mechanical conversion — replace all 19 `events.push(` call sites with `emit(` (they're at lines 208, 224, 275, 286, 319, 334, 421, 472, 536, 577, 583, 618, 648, 653, 662, 666, 699, 706, 804 pre-edit; grep `events.push\(` and convert every hit — zero must remain). Two are inside `ctx`:

```ts
    log: (event) => {
      emit(event);
    },
```
and in `ctx.buff` the push becomes `emit({ type: 'buff', target: target.uid, attack, health, source });`.

- [ ] **Step 6: Insert the `nextStep()` bumps.** Seven insertions, each shown with its anchor:

(a) **Per attack call** — `performAttack` entry (line ~694), first statement, so the Stealth `reveal` joins the first swing's step:
```ts
  function performAttack(attacker: Minion, defenderSide: Side, depth: number): void {
    if (attacker.dead || attacker.health <= 0) return;
    nextStep(); // a new exchange begins (re-attacks and Whelp strikes each get their own step too)
```

(b) **Per extra Windfury swing** — top of the `for (let s = 0; s < swings; s++) {` body (line ~702), after the existing guards:
```ts
      if (attacker.dead || attacker.health <= 0) break;
      const target = chooseTarget(defenderSide);
      if (!target) break;
      if (s > 0) nextStep(); // each Windfury swing is its own exchange
```
(The `emit` of the `attack` event follows immediately — same step as its phase-1 damage.)

(c) **Per victim resolution** — `killOrReborn` entry (line ~512), first statement:
```ts
  function killOrReborn(minion: Minion, killer?: Minion): void {
    nextStep(); // this victim's death is its own resolution step (the exchange's damage came before)
```

(d) **Rattle effects step** — in `killOrReborn`, both paths, immediately BEFORE the rattle fires. Rise path (before `fireOwnDeathrattles(minion);` at line ~537):
```ts
      emit({ type: 'death', target: minion.uid, side: minion.side, rise: true });
      nextStep(); // the rattle's effects are a separate resolution from the death itself
      fireOwnDeathrattles(minion);
```
Normal path (before `bus.emit('onDeath', …)` at line ~588):
```ts
    emit({ type: 'death', target: minion.uid, side: minion.side });
    // …(the two counter lines stay between)…
    nextStep(); // Deathrattles + on-death watchers resolve as their own step
    bus.emit('onDeath', { minion, side: minion.side, killer });
```

(e) **The Rise return** — before the `reborn` emit (line ~577):
```ts
      nextStep(); // the body's return is its own moment, after the rattle's summons
      emit({ type: 'reborn', target: minion.uid, hp: minion.health, attack: minion.attack, keywords: [...minion.keywords], ...(after ? { after } : {}) });
```

(f) **Per SC cast** — in the Start-of-Combat double loop (line ~856), before each factory invocation:
```ts
      for (const effect of minion.effects) {
        if (effect.on !== 'startOfCombat') continue;
        const fn = FACTORIES[effect.do];
        if (fn) { nextStep(); fn(ctx, minion, effect.params ?? {}, {}); }
      }
```

(g) **Per Reclaimer resummon + per Whelp queue entry** — top of the `while` bodies in `flushResummons()` (line ~611) and `flushImmediateAttacks()` (line ~797):
```ts
    while (pendingResummons.length > 0 && living('player').length < 7) {
      nextStep(); // each reclaimed body re-entering is its own moment
```
```ts
    while (pendingAttackOnSummon.length > 0 && guard++ < IMMEDIATE_ATTACK_GUARD) {
      nextStep(); // each out-of-turn Whelp strike (and its Solaris shield grant) is its own moment
```
Also `ascendMinion` entry (line ~455): `nextStep(); // a mid-combat transform is its own moment`.

- [ ] **Step 7: Run the new tests + the full core suite**

Run: `npx vitest run packages/core/src/combat/simulate.test.ts`
Expected: ALL pass — the 4 new tests AND the existing ~106 (they assert fields/behavior, not exact event objects vs literals; the run-vs-run determinism `toEqual` sees identical tags on both sides). If any existing test compares an event to an object literal and fails on the extra `step`, fix the TEST with `expect.objectContaining` — never strip the tag.

- [ ] **Step 8: Full workspace check**

Run: `npm run typecheck && npm run lint && npm test`
Expected: green (the UI packages don't read `step` yet; `step?` is optional so no synthetic-fixture breakage).

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/combat/simulate.ts packages/core/src/combat/simulate.test.ts
git commit -m "feat(core): resolution-step tags on combat events — pure metadata for the choreographer"
```

---

### Task 2: Outcome-neutrality proof (harness + goldens)

**Files:** none modified — verification only, then a tiny doc note.

- [ ] **Step 1: Determinism harness**

Run: `npm run harness`
Expected: the narrated log + determinism proof print exactly as on `main` (the harness output includes no step tags; outcomes identical).

- [ ] **Step 2: Cross-check outcomes vs main.** Run the sim test suite on this branch and on `main`, confirm identical pass counts:

```bash
npx vitest run packages/core packages/sim 2>&1 | tail -3
git stash && npx vitest run packages/core packages/sim 2>&1 | tail -3 && git stash pop
```
Expected: same suites, same counts, all green both times. (The sim/golden tests re-simulate seeded fights — unchanged outcomes ARE the proof.)

- [ ] **Step 3: Commit nothing — proceed** (this task produces evidence for the PR body, not code).

---

### Task 3: The Moment Compiler (`choreo/compile.ts`) — equivalence-locked

**Files:**
- Create: `packages/ui/src/choreo/compile.ts`
- Test: `packages/ui/src/choreo/compile.test.ts`

- [ ] **Step 1: Write the failing tests** — `packages/ui/src/choreo/compile.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { makeRng, simulate } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { buildBeats } from '../combatBeats';
import { compileMoments, DEFAULT_RULES } from './compile';

/** Real fights across the shapes that exercise every grouping rule: plain exchange, Deathrattle cascade,
 *  Windfury/cleave-style multi-hit, Rise, Start-of-Combat casts. Seeds/rosters picked from the existing
 *  test suites so the logs are known-interesting. */
const FIGHTS: [string, () => ReturnType<typeof simulate>][] = [
  ['exchange + rattle', () => simulate(
    [{ cardId: 'stray', attack: 3, health: 10 }, { cardId: 'sandbag', attack: 0, health: 5 }],
    [{ cardId: 'pack', attack: 2, health: 2 }], makeRng(3), CARD_INDEX)],
  ['mutual chip', () => simulate(
    [{ cardId: 'stray', attack: 3, health: 10 }],
    [{ cardId: 'sandbag', attack: 2, health: 8 }], makeRng(3), CARD_INDEX)],
  ['bigger board', () => simulate(
    [{ cardId: 'stray', attack: 3, health: 4 }, { cardId: 'pack', attack: 2, health: 2 }, { cardId: 'sandbag', attack: 0, health: 9 }],
    [{ cardId: 'pack', attack: 2, health: 2 }, { cardId: 'stray', attack: 3, health: 4 }], makeRng(11), CARD_INDEX)],
];

describe('compileMoments — default rules reproduce buildBeats exactly', () => {
  for (const [name, run] of FIGHTS) {
    it(`equivalence: ${name}`, () => {
      const r = run();
      const beats = buildBeats(r.events);
      const moments = compileMoments(r.events, DEFAULT_RULES);
      expect(moments.map(({ start, end, primary }) => ({ start, end, primary })))
        .toEqual(beats.map(({ start, end, primary }) => ({ start, end, primary })));
    });
  }

  it('carries stepGroups: contiguous event-index runs sharing a step, inside each moment', () => {
    const r = FIGHTS[0]![1]();
    const moments = compileMoments(r.events, DEFAULT_RULES);
    for (const m of moments) {
      const flat = m.stepGroups.flat();
      // exactly the moment's event indices, in order, no gaps
      expect(flat).toEqual(Array.from({ length: m.end - m.start }, (_, k) => m.start + k));
      // each group is step-homogeneous (when tags exist)
      for (const g of m.stepGroups) {
        const steps = new Set(g.map((i) => r.events[i]!.step));
        expect(steps.size).toBeLessThanOrEqual(1);
      }
    }
  });

  it('untagged events (synthetic fixtures) still compile — one group per moment', () => {
    const moments = compileMoments(
      [{ type: 'sc', source: 'a', text: 'x' }, { type: 'dmg', target: 'b', amount: 1, remainingHp: 4 }],
      DEFAULT_RULES,
    );
    expect(moments).toHaveLength(2);
    expect(moments[0]!.stepGroups).toEqual([[0]]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/ui/src/choreo/compile.test.ts`
Expected: FAIL — module `./compile` not found.

- [ ] **Step 3: Implement `packages/ui/src/choreo/compile.ts`:**

```ts
import type { CombatEvent } from '@game/core';
import { RESULT_TYPES, type Beat } from '../combatBeats';

/**
 * The Moment Compiler — phase 1 of the combat choreographer (spec: docs/superpowers/specs/
 * 2026-07-06-combat-choreographer-design.md). Groups the sim's event log into presentation MOMENTS.
 * With DEFAULT_RULES it reproduces `buildBeats` exactly (locked by the equivalence tests), while also
 * carrying each moment's `stepGroups` — the sim-declared simultaneity (resolution-step tags) later phases
 * use for ordering/stagger authoring. Pure + deterministic; moments are contiguous slices of the log, so
 * `computeFrame`'s in-order fold is never violated.
 */

/** Grouping rules — today's hardcoded buildBeats behavior expressed as data. Later phases extend this
 *  (chain/splitPerTarget) and make it live-tunable; phase 1 ships the defaults only. */
export interface GroupingRules {
  /** Result events: a contiguous run collapses into one impact moment. */
  collapse: ReadonlySet<CombatEvent['type']>;
  /** Runs of these collapse too (multi-target buff waves land at once). */
  collapseRuns: ReadonlySet<CombatEvent['type']>;
  /** On-attack "flash" events absorbed into the attack's wind-up moment. */
  absorbIntoWindup: ReadonlySet<CombatEvent['type']>;
}

export const DEFAULT_RULES: GroupingRules = {
  collapse: RESULT_TYPES,
  collapseRuns: new Set(['buff']),
  absorbIntoWindup: new Set(['buff', 'rally', 'summon', 'reveal', 'improve']),
};

/** A presentation moment — `Beat`-shaped (start/end/primary) so every existing consumer
 *  (`attackerOfImpact`, the scheduler, float/anim derivation) works unchanged, plus the step structure. */
export interface Moment extends Beat {
  /** The moment's event INDICES grouped by resolution step, in log order — sim-declared simultaneity.
   *  Untagged events (synthetic fixtures) fall into one group. */
  stepGroups: number[][];
}

/** Split a moment's index range into contiguous runs sharing a `step` tag. */
function groupBySteps(events: CombatEvent[], start: number, end: number): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  let curStep: number | undefined;
  for (let i = start; i < end; i++) {
    const s = events[i]!.step;
    if (cur.length > 0 && s !== curStep) { groups.push(cur); cur = []; }
    cur.push(i);
    curStep = s;
  }
  if (cur.length > 0) groups.push(cur);
  return groups;
}

export function compileMoments(events: CombatEvent[], rules: GroupingRules = DEFAULT_RULES): Moment[] {
  const moments: Moment[] = [];
  let i = 0;
  while (i < events.length) {
    const start = i;
    const t = events[i]!.type;
    if (rules.collapse.has(t)) {
      while (i < events.length && rules.collapse.has(events[i]!.type)) i++;
    } else if (rules.collapseRuns.has(t)) {
      while (i < events.length && events[i]!.type === t) i++;
    } else if (t === 'attack') {
      i++;
      while (i < events.length && rules.absorbIntoWindup.has(events[i]!.type)) i++;
    } else {
      i++;
    }
    moments.push({ start, end: i, primary: events[start]!, stepGroups: groupBySteps(events, start, i) });
  }
  return moments;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/ui/src/choreo/compile.test.ts`
Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/choreo/compile.ts packages/ui/src/choreo/compile.test.ts
git commit -m "feat(ui): moment compiler — config-driven grouping, buildBeats-equivalent defaults, stepGroups"
```

---

### Task 4: Swap `useCombatReplay` onto the compiler

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts` (one import + one line)

- [ ] **Step 1: Swap the call.** In `packages/ui/src/useCombatReplay.ts`, the import block keeps `buildBeats`'s siblings and adds the compiler:

```ts
import { RESULT_TYPES, attackerOfImpact } from './combatBeats';
import { compileMoments } from './choreo/compile';
```
(remove `buildBeats` from the combatBeats import — it stays exported for its own tests), and the memo at line ~493 becomes:

```ts
  const beats = useMemo(() => compileMoments(events), [events]);
```
`Moment extends Beat`, so `attackerOfImpact(beats, …)`, the scheduler, and every other consumer typecheck unchanged. Add one comment above the memo:
```ts
  // Moments are Beat-shaped (choreographer phase 1): identical grouping to the old buildBeats (equivalence-
  // tested), now carrying stepGroups for later phases. buildBeats itself remains only as the test oracle.
```
Also update `combatBeats.ts`'s header comment: append `— superseded at runtime by choreo/compile.ts (this stays as the equivalence oracle + attackerOfImpact home).`

- [ ] **Step 2: Full verification**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green (test count grows by the new suites). Also: `$c = (npm run typecheck:web 2>&1 | Select-String 'error TS').Count` must equal the branch baseline (21) — zero new UI type errors.

- [ ] **Step 3: Live smoke.** `npm run dev` (or preview): play into a combat; the fight must look byte-identical to main (grouping/pacing unchanged). Watch one Deathrattle kill and one Rise.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/useCombatReplay.ts packages/ui/src/combatBeats.ts
git commit -m "refactor(ui): combat replay consumes compileMoments (buildBeats-equivalent, step-aware)"
```

---

### Task 5: Docs + PR

**Files:**
- Modify: `docs/devlog.md` (prepend entry), `docs/roadmap.md` (add choreographer phases 2–4 under the queue), `README.md` (Recent changes)

- [ ] **Step 1: Docs.** Devlog entry (match file style): what phase 1 delivers (step tags = pure metadata + proof method; compiler + equivalence lock; replay swap), why (choreographer foundation, spec link), verification (suite counts, harness, baseline comparisons, live smoke). Roadmap: add "Choreographer phase 2 (engine) / 3 (channels) / 4 (authoring + 🎬 panel, retire Pacing tuner)" under the appropriate section. README: one Recent-changes bullet.

- [ ] **Step 2: Full suite once more** — `npm run typecheck && npm run lint && npm test && npm run build:web` green.

- [ ] **Step 3: Commit docs, push, open the PR**

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: devlog/roadmap/README for choreographer phase 1"
git push -u origin feat/combat-choreographer
"/c/Program Files/GitHub CLI/gh.exe" pr create --title "feat: combat choreographer phase 1 — sim step tags + moment compiler" --body "<summary per PR conventions; note for Kevin: types.ts + simulate.ts touched (pre-agreed, metadata only, outcome-neutrality proven by determinism/golden suites + main-vs-branch comparison); 🤖 footer>"
```

---

## Self-review

- **Spec coverage (phase 1 section):** step tags ✓ (Task 1), outcome-neutrality proof ✓ (Task 2 + Task 1 step 7), compiler with default-equivalence golden ✓ (Task 3), replay consumes moments via Beat shape ✓ (Task 4), `attackerOfImpact` contract preserved ✓ (shape-compatible + equivalence test), docs/PR ✓ (Task 5). Phases 2–4 explicitly out of scope (own plans).
- **Type consistency:** `CombatEvent & { step?: number }` (Task 1) ⇄ `events[i]!.step` reads (Task 3) ⇄ `Moment extends Beat` consumed as `beats` (Task 4). `DEFAULT_RULES`/`compileMoments`/`stepGroups` names consistent across Tasks 3–4.
- **No placeholders:** every code step is complete; the one mechanical sweep (push→emit) is bounded by an exact grep with an expected-zero-remaining check.
