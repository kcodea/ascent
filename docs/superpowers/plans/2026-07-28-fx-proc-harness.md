# The Proc Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author pick a card, stage a controlled fight, and re-play any moment that card caused — with a run-up, on the real board, on demand.

**Architecture:** Two pure modules (find the moments, stage the board) plus one extraction in the combat replay hook that turns its existing reset-to-beat-0 effect into a seek-to-any-beat. The workbench collapses to a rail and hosts the harness UI, so tuning and watching happen without a context switch. Staging goes through the real `faceOmen` dispatch — no parallel combat path.

**Tech Stack:** TypeScript, React, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-28-fx-proc-harness-design.md`

**Worktree:** `.claude/worktrees/fx-workbench-p1`, branch `feat/fx-workbench-p1`. All commands run from the worktree root. **Never commit to `main`** — this branch is PR #689 and the owner merges.

---

## Background the engineer needs

**The domain.** Combat is a pure simulation that emits a flat `CombatEvent[]`. `choreo/compile.ts` folds that log into `Moment`s — contiguous slices of the log, each classified with a `MomentKind`. `useCombatReplay.ts` walks those moments on a timer (`beatIdx`), and for each one fires cues: sound, damage numbers, the lunge, and authored visual effects.

**Why this is affordable.** `computeFrame(initial, events, upto, beatStart, names)` (exported, `useCombatReplay.ts:174`) rebuilds the entire board **from scratch** on every call — `initial.player.map(fromSnap)` then a loop from event 0 to `upto`. So the board at any beat is a pure function of its arguments, and jumping to an arbitrary beat cannot desynchronise anything. **This property is the foundation of the whole feature** and Task 3 exists largely to pin it.

**What does not exist today:** any seek. `beatIdx` only increments, resets to 0, or jumps to the end. The sole reset trigger is a `[combat]` reference change.

**Testing reality.** This repo has **no `@testing-library/react`, no jsdom** — Vitest runs in bare Node. **Do not write React component or hook tests; they cannot run.** Pure logic gets real unit tests; UI is covered by typecheck, `build:web`, and a manual browser check. This is the same standard the FX library browser shipped under.

**The gate (exactly what CI runs):**
```bash
npm run typecheck && npm run lint && npm test && npm run build:web
```
Lint passes at **0 errors**; there are 3 known pre-existing warnings (`CARD_INDEX` in `SceneBuilder.tsx`, `sellValueOf` in `reducer.ts`, `getSpellBuffFxConfig` in `Recruit.tsx`) — leave all three alone. **Do not use `npm run typecheck:web` as a gate** — it is red on a clean `main` (66 errors) and is not in CI; run it for information only and check no reported error names a file you touched.

**Shell discipline.** Prefix every command with an explicit `cd` to the worktree absolute path — the cwd can silently revert to the primary checkout. Verify `git branch --show-current` prints `feat/fx-workbench-p1` before committing. **Never `git add -A`** — the checkout is shared; list explicit paths.

---

## File Structure

| File | Responsibility |
|---|---|
| **Create** `packages/ui/src/fx/harness/procScan.ts` | Pure. Which moments did this card cause, and what's bound to each. |
| **Create** `packages/ui/src/fx/harness/procScan.test.ts` | Fixture combats: attribution, summons, empty, bindings. |
| **Create** `packages/ui/src/fx/harness/procStage.ts` | Pure. "N sandbags at H hp / A atk" → the board patch + wave reset, as data. |
| **Create** `packages/ui/src/fx/harness/procStage.test.ts` | The patch is what it claims, at the range extremes. |
| **Modify** `packages/ui/src/useCombatReplay.ts` | Extract the reset effect body into `resetTo(index)`; export `seekTo`. |
| **Create** `packages/ui/src/computeFrame.purity.test.ts` | Pins the from-scratch-fold property seek depends on. |
| **Create** `packages/ui/src/fx/harness/ProcHarness.tsx` | The rail UI: card picker, sandbag knobs, Stage, moment list, run-up, Replay. |
| **Modify** `packages/ui/src/fx/ui/Workbench.tsx` | Rail mode — collapse the panels, host `ProcHarness`. |
| **Modify** `packages/ui/src/Recruit.tsx` | Don't pause the fight when the workbench is in rail mode. |
| **Modify** `packages/ui/src/styles.css` | Rail-mode layout. |
| **Modify** `docs/devlog.md`, `docs/roadmap.md`, `README.md` | Required by CLAUDE.md on every commit. |

> **SUPERSEDED (2026-07-28):** the `Recruit.tsx` row's premise was false — `overlayOpen` never included the
> workbench, so there was nothing to exempt. See the devlog's 2026-07-28 proc-harness entry.

Tasks 1–3 are independent and testable. Task 4 depends on 1–3. Task 5 wires it in. Task 6 is the gate and docs.

---

### Task 1: `procScan` — which moments did this card cause

**Files:**
- Create: `packages/ui/src/fx/harness/procScan.ts`
- Create: `packages/ui/src/fx/harness/procScan.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/src/fx/harness/procScan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CombatEvent, CombatResult, MinionSnapshot } from '@game/core';
import { actingUid, scanProcs, uidsForCard } from './procScan';

/** A minimal snapshot — only the fields procScan reads. */
const snap = (uid: string, cardId: string): MinionSnapshot =>
  ({ uid, cardId, name: cardId, tribe: 'neutral', attack: 1, health: 1, keywords: [] }) as MinionSnapshot;

/** A CombatResult carrying only what procScan touches. */
const combatOf = (player: MinionSnapshot[], enemy: MinionSnapshot[], events: CombatEvent[]): CombatResult =>
  ({ initial: { player, enemy }, events } as unknown as CombatResult);

describe('uidsForCard', () => {
  it('finds a card on either starting board', () => {
    const c = combatOf([snap('p1', 'bloodbinder')], [snap('e1', 'bloodbinder')], []);
    expect([...uidsForCard(c, 'bloodbinder')].sort()).toEqual(['e1', 'p1']);
  });

  // A unit summoned mid-fight never appears in `initial`, so a scan that only reads the starting
  // rosters silently misses every moment it caused.
  it('finds an instance summoned mid-combat', () => {
    const events = [
      { type: 'summon', minion: snap('s1', 'imp'), side: 'player', index: 0 },
    ] as unknown as CombatEvent[];
    const c = combatOf([snap('p1', 'bloodbinder')], [], events);
    expect([...uidsForCard(c, 'imp')]).toEqual(['s1']);
  });

  it('returns empty for a card that was never in the fight', () => {
    const c = combatOf([snap('p1', 'bloodbinder')], [], []);
    expect(uidsForCard(c, 'nothere').size).toBe(0);
  });
});

describe('actingUid', () => {
  it('reads an attack from its attacker, not its defender', () => {
    expect(actingUid({ type: 'attack', attacker: 'a', defender: 'b' } as CombatEvent)).toBe('a');
  });

  it('reads every other event from its source', () => {
    expect(actingUid({ type: 'sc', source: 'a', text: 'x' } as unknown as CombatEvent)).toBe('a');
  });

  // A `dmg` carries only a target — the unit that was HIT. Attributing it to the target would credit
  // every moment to the victim.
  it('returns null when the event names no actor', () => {
    expect(actingUid({ type: 'dmg', target: 'b', amount: 1 } as unknown as CombatEvent)).toBeNull();
  });
});

describe('scanProcs', () => {
  const events = [
    { type: 'sc', source: 'p1', text: 'bleeds', cast: true, step: 1 },
    { type: 'dmg', target: 'e1', amount: 3, step: 1 },
    { type: 'attack', attacker: 'e1', defender: 'p1', step: 2 },
  ] as unknown as CombatEvent[];
  const combat = combatOf([snap('p1', 'bloodbinder')], [snap('e1', 'sandbag')], events);

  it('finds the moments the card acted in, and none it did not', () => {
    const procs = scanProcs(combat, 'bloodbinder');
    expect(procs.length).toBeGreaterThan(0);
    expect(procs.every((p) => p.sourceUid === 'p1')).toBe(true);
  });

  it('attributes the enemy attack to the enemy card, not ours', () => {
    expect(scanProcs(combat, 'sandbag').some((p) => p.kind === 'attackExchange')).toBe(true);
    expect(scanProcs(combat, 'bloodbinder').some((p) => p.kind === 'attackExchange')).toBe(false);
  });

  // The index is what `seekTo` consumes — if it isn't a valid index into the compiled moments the
  // harness seeks to the wrong beat, or throws.
  it('returns indices that are real positions in the compiled moment list', async () => {
    const { compileMoments } = await import('../../choreo/compile');
    const total = compileMoments(events).length;
    for (const p of scanProcs(combat, 'bloodbinder')) {
      expect(p.index).toBeGreaterThanOrEqual(0);
      expect(p.index).toBeLessThan(total);
    }
  });

  // The whole point of surfacing `boundDef` is that "no effect here yet" is VISIBLE rather than
  // something you discover by watching nothing happen.
  it('reports the bound def, and null where nothing is bound', () => {
    const procs = scanProcs(combat, 'bloodbinder');
    const cast = procs.find((p) => p.kind === 'scCast');
    expect(cast?.boundDef).toBe('ruby-lance'); // bloodbinder's per-card binding
    const sandbag = scanProcs(combat, 'sandbag').find((p) => p.kind === 'attackExchange');
    expect(sandbag?.boundDef).toBe('self-buff-gold'); // attackExchange's kind-level binding
  });

  it('returns an empty array — not a throw — for a card that never acted', () => {
    expect(scanProcs(combat, 'nothere')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/ui/src/fx/harness/procScan.test.ts`
Expected: FAIL — `Failed to resolve import "./procScan"`.

- [ ] **Step 3: Implement**

Create `packages/ui/src/fx/harness/procScan.ts`:

```ts
import type { CombatEvent, CombatResult } from '@game/core';
import { bindingFor } from '../../choreo/bindings';
import { compileMoments } from '../../choreo/compile';
import type { MomentKind } from '../../choreo/kinds';

/**
 * Which moments in a fought combat a given card caused — the list the proc harness offers you to replay.
 *
 * Pure and React-free on purpose: it is the piece worth testing, and it works on any `CombatResult`,
 * including a fixture. `compileMoments` is documented as pure and cheap, so calling it here rather than
 * reaching into the replay hook's memo costs nothing and keeps this module standalone.
 */
export interface ProcMoment {
  /** Index into the compiled moments array — exactly what `seekTo` takes. */
  index: number;
  kind: MomentKind;
  /** The acting unit — for the row label, and to disambiguate two copies of the same card. */
  sourceUid: string;
  /** What `bindingFor` says would play here, or null when nothing is bound. */
  boundDef: string | null;
}

/**
 * Every uid this card ever occupied in this fight.
 *
 * Reads BOTH starting rosters and every `summon` event — the same two sources `useCombatReplay` folds to
 * build its uid→cardId map, just inverted. Missing the summon half would silently drop every moment caused
 * by a token, which is a large share of what the harness is for.
 */
export function uidsForCard(combat: CombatResult, cardId: string): Set<string> {
  const out = new Set<string>();
  for (const u of [...combat.initial.player, ...combat.initial.enemy]) {
    if (u.cardId === cardId) out.add(u.uid);
  }
  for (const e of combat.events) {
    if (e.type === 'summon' && e.minion.cardId === cardId) out.add(e.minion.uid);
  }
  return out;
}

/**
 * The unit that ACTED in this event, or null when the event names none.
 *
 * `attack` names its pair differently (attacker/defender) and the attacker is the actor. Everything else
 * carries at most a `source`. A `dmg` deliberately returns null: it names only the unit that was HIT, so
 * attributing it would credit the moment to the victim — and a run of damage collapses into its own moment
 * anyway, whose cast is what the harness wants you to seek to.
 */
export function actingUid(e: CombatEvent): string | null {
  if (e.type === 'attack') return e.attacker;
  return 'source' in e && typeof e.source === 'string' ? e.source : null;
}

/** The card's moments, in replay order. Empty (never throwing) when the card never acted. */
export function scanProcs(combat: CombatResult, cardId: string): ProcMoment[] {
  const uids = uidsForCard(combat, cardId);
  if (uids.size === 0) return [];
  const out: ProcMoment[] = [];
  const moments = compileMoments(combat.events);
  for (let i = 0; i < moments.length; i++) {
    const m = moments[i];
    const actor = actingUid(m.primary);
    if (actor === null || !uids.has(actor)) continue;
    out.push({
      index: i,
      kind: m.kind,
      sourceUid: actor,
      boundDef: bindingFor(cardId, m.kind)?.def ?? null,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/ui/src/fx/harness/procScan.test.ts`
Expected: PASS (11 tests).

If the `boundDef` case fails, read `packages/ui/src/choreo/bindings.json` and use whatever it actually binds — do not change `bindings.json` to suit the test.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/harness/procScan.ts packages/ui/src/fx/harness/procScan.test.ts
git commit -m "feat(fx): scan a fought combat for the moments one card caused

Pure and React-free, so it works on a fixture as well as a live fight.
Reads both starting rosters AND every summon event, so a token's moments
aren't silently dropped; attributes an attack to its attacker and a dmg
to nobody, so a moment is never credited to the unit that was hit.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `procStage` — the staged board, as data

**Files:**
- Create: `packages/ui/src/fx/harness/procStage.ts`
- Create: `packages/ui/src/fx/harness/procStage.test.ts`

Mirrors `SceneBuilder.tsx`'s existing `setEnemies` (~line 125), which writes `servedBoards[wave]` with N `sandbag` minions. That version is a closure over `mutate`; this one is a pure function returning the board, so the staging rules are testable without a store.

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/src/fx/harness/procStage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { sandbagBoard, SANDBAG_LIMITS } from './procStage';

describe('sandbagBoard', () => {
  it('builds N sandbags at the requested stats', () => {
    const b = sandbagBoard(3, { count: 4, hp: 30, attack: 2 });
    expect(b.wave).toBe(3);
    expect(b.minions).toHaveLength(4);
    expect(b.minions.every((m) => m.cardId === 'sandbag')).toBe(true);
    expect(b.minions[0].health).toBe(30);
    expect(b.minions[0].attack).toBe(2);
  });

  // A board of zero minions is not a fight — combat would end instantly and the harness would report
  // "no moments" for a card that is working perfectly.
  it('clamps the count to at least one', () => {
    expect(sandbagBoard(1, { count: 0, hp: 10, attack: 1 }).minions).toHaveLength(1);
    expect(sandbagBoard(1, { count: -5, hp: 10, attack: 1 }).minions).toHaveLength(1);
  });

  // 0 health is a corpse; 0 attack is legal and useful (a pure punching bag that never kills you).
  it('clamps health to at least one but allows zero attack', () => {
    expect(sandbagBoard(1, { count: 1, hp: 0, attack: 0 }).minions[0].health).toBe(1);
    expect(sandbagBoard(1, { count: 1, hp: 10, attack: 0 }).minions[0].attack).toBe(0);
    expect(sandbagBoard(1, { count: 1, hp: 10, attack: -3 }).minions[0].attack).toBe(0);
  });

  it('clamps to the published limits so the UI and the builder agree', () => {
    const big = sandbagBoard(1, { count: 999, hp: 99999, attack: 99999 });
    expect(big.minions).toHaveLength(SANDBAG_LIMITS.maxCount);
    expect(big.minions[0].health).toBe(SANDBAG_LIMITS.maxHp);
    expect(big.minions[0].attack).toBe(SANDBAG_LIMITS.maxAttack);
  });

  it('stamps the wave it was built for', () => {
    expect(sandbagBoard(7, { count: 1, hp: 1, attack: 1 }).wave).toBe(7);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/ui/src/fx/harness/procStage.test.ts`
Expected: FAIL — `Failed to resolve import "./procStage"`.

- [ ] **Step 3: Implement**

Create `packages/ui/src/fx/harness/procStage.ts`:

```ts
import type { BoardSnapshot } from '@game/sim';
import type { Keyword } from '@game/core';

/**
 * The staged opponent for a harness fight, as DATA.
 *
 * `SceneBuilder.setEnemies` does the same job as a closure over its `mutate` helper, which makes the
 * clamping rules untestable. This is the pure half: the caller applies it to the store.
 *
 * Sandbags rather than a real pooled opponent because the harness needs a fight it can re-run identically
 * and tune the LENGTH of — more health means more beats, which is what makes a periodic proc (every fourth
 * attack, say) actually land before the fight ends.
 */
export interface SandbagSpec {
  count: number;
  hp: number;
  attack: number;
}

/** Published so the UI's slider bounds and the builder's clamps cannot drift apart. */
export const SANDBAG_LIMITS = { maxCount: 7, maxHp: 9999, maxAttack: 99 } as const;

const clamp = (v: number, lo: number, hi: number): number =>
  !Number.isFinite(v) ? lo : Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * The board to pin at `wave`. Combat reads a served board verbatim, so this is exactly what will be fought.
 *
 * Count and health floor at 1 — a board of nothing, or of corpses, ends combat instantly and the harness
 * would then report "no moments" for a card that is working perfectly, which is the confusing-failure case
 * this whole subsystem keeps trying to eliminate. Attack floors at 0, which is legal and useful: a punching
 * bag that never kills you lets a long fight run to completion.
 */
export function sandbagBoard(wave: number, spec: SandbagSpec): BoardSnapshot {
  const count = clamp(spec.count, 1, SANDBAG_LIMITS.maxCount);
  const health = clamp(spec.hp, 1, SANDBAG_LIMITS.maxHp);
  const attack = clamp(spec.attack, 0, SANDBAG_LIMITS.maxAttack);
  return {
    v: 1,
    wave,
    heroId: 'warden',
    resolve: 30,
    tier: 7,
    triples: 0,
    tribes: [],
    threat: 'glass',
    power: health * count,
    minions: Array.from({ length: count }, () => ({
      cardId: 'sandbag',
      attack,
      health,
      keywords: [] as Keyword[],
    })),
    seed: 1,
    origin: 'self',
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run packages/ui/src/fx/harness/procStage.test.ts`
Expected: PASS (5 tests).

If `BoardSnapshot` is not exported from `@game/sim`, import it from wherever `SceneBuilder.tsx` imports it — match that file's import exactly rather than reaching into an internal path.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/harness/procStage.ts packages/ui/src/fx/harness/procStage.test.ts
git commit -m "feat(fx): the harness's staged sandbag board, as a pure function

SceneBuilder.setEnemies does the same job as a closure over its mutate
helper, which leaves the clamping rules untestable. This is the pure
half. Count and health floor at 1 because an empty board ends combat
instantly and the harness would then report 'no moments' for a card that
works fine.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `seekTo` — jump the replay to any beat

**Files:**
- Create: `packages/ui/src/computeFrame.purity.test.ts`
- Modify: `packages/ui/src/useCombatReplay.ts`

The one change to a hot file. It is an **extraction**, not new machinery.

- [ ] **Step 1: Write the failing test for the property seek depends on**

`seekTo` is a hook method and this repo has no jsdom, so it cannot be tested directly. The property that makes seek *correct*, though, is pure and exported: `computeFrame` must rebuild from `initial` every call, with no memory of previous calls. Pin that.

Create `packages/ui/src/computeFrame.purity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CombatEvent, MinionSnapshot } from '@game/core';
import { computeFrame } from './useCombatReplay';

const snap = (uid: string, health: number): MinionSnapshot =>
  ({ uid, cardId: 'sandbag', name: 'Sandbag', tribe: 'neutral', attack: 1, health, keywords: [] }) as MinionSnapshot;

const initial = { player: [snap('p1', 10)], enemy: [snap('e1', 10)] };
const events = [
  { type: 'attack', attacker: 'p1', defender: 'e1', step: 1 },
  { type: 'dmg', target: 'e1', amount: 3, step: 1 },
  { type: 'attack', attacker: 'e1', defender: 'p1', step: 2 },
  { type: 'dmg', target: 'p1', amount: 2, step: 2 },
] as unknown as CombatEvent[];
const names = new Map<string, string>();

/**
 * THE property the proc harness rests on. `seekTo` jumps `beatIdx` to an arbitrary moment, and that is only
 * safe because `computeFrame` rebuilds the board from `initial` on every call rather than folding
 * incrementally from the previous frame.
 *
 * If anyone ever "optimises" it into an incremental update — a reasonable-looking perf change — seeking
 * breaks SILENTLY: the board would show whatever state the last-played beat left behind. These tests are
 * what make that a red build instead of a bug report.
 */
describe('computeFrame is a from-scratch fold', () => {
  it('gives the same result for the same arguments, called twice', () => {
    const a = computeFrame(initial, events, 4, 2, names);
    const b = computeFrame(initial, events, 4, 2, names);
    expect(b).toEqual(a);
  });

  // The seek case: reaching beat N by jumping must equal reaching it by playing forward.
  it('is unaffected by what was computed before it — jumping equals playing forward', () => {
    const direct = computeFrame(initial, events, 4, 2, names);
    computeFrame(initial, events, 1, 0, names);
    computeFrame(initial, events, 2, 1, names);
    computeFrame(initial, events, 3, 2, names);
    const afterWalking = computeFrame(initial, events, 4, 2, names);
    expect(afterWalking).toEqual(direct);
  });

  // Backwards too — the harness re-seeks the same moment repeatedly while tuning.
  it('is unaffected by having previously computed a LATER frame', () => {
    const early = computeFrame(initial, events, 1, 0, names);
    computeFrame(initial, events, 4, 2, names);
    expect(computeFrame(initial, events, 1, 0, names)).toEqual(early);
  });

  it('does not mutate the initial snapshots it is given', () => {
    const before = JSON.stringify(initial);
    computeFrame(initial, events, 4, 2, names);
    expect(JSON.stringify(initial)).toBe(before);
  });
});
```

- [ ] **Step 2: Run it — it should PASS immediately**

Run: `npx vitest run packages/ui/src/computeFrame.purity.test.ts`
Expected: **PASS (4 tests)**. This is a characterisation test: it documents and locks behaviour that already holds. If any case fails, **stop and report** — the whole design assumes this property, and a failure means seek is not safe to build.

- [ ] **Step 3: Commit the guard before changing anything**

```bash
git add packages/ui/src/computeFrame.purity.test.ts
git commit -m "test(ui): pin that computeFrame is a from-scratch fold

The proc harness seeks the replay to an arbitrary beat, which is only
safe because computeFrame rebuilds from `initial` every call instead of
folding from the previous frame. Optimising that into an incremental
update would break seeking silently — the board would show whatever the
last-played beat left behind. This makes it a red build instead.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Extract the reset body**

In `packages/ui/src/useCombatReplay.ts`, find the effect at ~line 702 that begins `// A fresh combat resets the replay to the top` and ends `}, [combat]);`. Replace the whole effect with:

```ts
  /**
   * Put the replay at `index` and clear every piece of transient per-beat state.
   *
   * Extracted from the fresh-combat reset so a SEEK can reuse it: jumping to an arbitrary beat needs exactly
   * the same clearing that starting a new fight does. The board itself needs no repair — `computeFrame`
   * rebuilds from `initial` on every call (see `computeFrame.purity.test.ts`) — but this transient state is
   * accumulated per beat and would otherwise carry stale floats, pulses and holds across the jump.
   *
   * `useCallback` with no deps: every setter here is stable, so the identity never changes and callers can
   * hold it without re-subscribing.
   */
  const resetTo = useCallback((index: number): void => {
    setBeatIdx(index);
    setFloats([]);
    setDeathFloats([]);
    // …and drop the pulse holds with it, or a timer from the last fight clears a uid mid-pulse in this one.
    for (const t of pulseTimersRef.current.values()) window.clearTimeout(t);
    pulseTimersRef.current.clear();
    setTriggers(new Set());
    setRallyPulse(new Map());
    setFinished(false);
    setAttackUid(null);
    gsap.killTweensOf('[data-zone] .unit'); // stop any lunge left mid-flight by the previous fight
    setProjectiles([]);
    setShake(0);
    // …and drop the shake FLAGS with the counters. The shake effects bail on `!shake`, so zeroing the counter
    // cancelled their 300ms clear (effect cleanup) and then early-returned — leaving `.shaking` latched on
    // into the next fight. Only reachable when a fight starts within 300ms of a shake (a Skip), but it is the
    // same cleanup-cancels-the-clear defect as #735 / #736.
    setShaking(false);
    setCritShaking(false);
    setHandGrant(null);
    setStatHold(new Map());
    setStatFlash(new Map());
  }, []);

  // A fresh combat resets the replay to the top (the hook persists across fights).
  useEffect(() => {
    resetTo(0);
  }, [combat, resetTo]);
```

Make sure `useCallback` is in the React import at the top of the file — add it to the existing `import { … } from 'react'` line if absent.

- [ ] **Step 5: Expose `seekTo` on the hook's return**

Add to the `CombatReplay` interface (`useCombatReplay.ts:455`), next to `skip`:

```ts
  /**
   * DEV (proc harness): jump the replay to `index` in the compiled moment list, clearing per-beat transient
   * state as a fresh fight would. Playback continues forward from there on the normal clock.
   *
   * Safe for any index because the board is a pure fold of `(initial, events, upto)` — see
   * `computeFrame.purity.test.ts`, which exists to keep that true.
   */
  seekTo: (index: number) => void;
  /** Total moments in this fight — the valid range for `seekTo` is `[0, beatCount)`. */
  beatCount: number;
```

`beatCount` is already returned; if it is already declared on the interface, leave that declaration alone and add only `seekTo`.

Then add `seekTo` to the returned object at ~line 1546:

```ts
    beatCount: beats.length, enemyDeaths, combatBuffs, questDelta, triggeredQuests, completedQuests,
    skip: () => setBeatIdx(beats.length),
    // Clamped here rather than at the call site: an out-of-range seek from a stale moment list (the fight
    // was re-staged while the harness still showed the old one) must land somewhere valid, not wedge the
    // replay past its end.
    seekTo: (index: number) => resetTo(Math.max(0, Math.min(beats.length - 1, index))),
```

- [ ] **Step 6: Verify nothing regressed**

Run:
```bash
npx vitest run packages/ui/src/ && npm run lint
```
Expected: all UI tests pass; lint 0 errors. The replay's own behaviour is unchanged — `resetTo(0)` is byte-identical to what the effect did before.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/useCombatReplay.ts
git commit -m "feat(ui): the combat replay can seek to an arbitrary beat

An extraction, not new machinery: the fresh-combat reset already cleared
every piece of transient per-beat state, so a seek is that same body with
a target index. resetTo(0) is byte-identical to what the effect did.

Correct for any index because computeFrame rebuilds the board from
`initial` on every call, so there is no incremental state a jump could
desynchronise. seekTo clamps, so a stale moment list can't wedge the
replay past its end.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `ProcHarness` — the rail UI

**Files:**
- Create: `packages/ui/src/fx/harness/ProcHarness.tsx`

No test — this repo has no jsdom, so React components are covered by typecheck, `build:web` and a browser check. Keep logic out of this file: anything worth asserting belongs in `procScan.ts` or `procStage.ts`.

- [ ] **Step 1: Read the two files this must match**

Read `packages/ui/src/fx/ui/LibraryBrowser.tsx` (the closest existing panel — prop shape, class naming, list rendering) and `packages/ui/src/SceneBuilder.tsx` lines 100–140 (how `mutate` writes run state, and the `setEnemies` shape you are replacing with `sandbagBoard`).

- [ ] **Step 2: Write the component**

Create `packages/ui/src/fx/harness/ProcHarness.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { CARD_INDEX } from '@game/content';
import type { RunState } from '@game/sim';
import { useGame } from '../../store';
import { sandbagBoard, SANDBAG_LIMITS, type SandbagSpec } from './procStage';
import { scanProcs, type ProcMoment } from './procScan';

/**
 * The proc harness: stage a controlled fight, find the moments a card caused, and replay any of them.
 *
 * Hosted by the workbench in rail mode so tuning and watching happen without a context switch — the whole
 * point is the loop "tune a param → watch it on the real card → tune again", which a separate window breaks.
 *
 * Deliberately thin. Everything worth testing lives in `procScan.ts` and `procStage.ts`, because this repo
 * has no jsdom and a component test cannot run.
 */
export interface ProcHarnessProps {
  /** Jump the live replay to a moment index (from `useCombatReplay`). */
  onSeek: (index: number) => void;
  /** The fight currently loaded in the replay, or null when none has been staged yet. */
  combat: RunState['lastCombat'];
}

const DEFAULT_SANDBAGS: SandbagSpec = { count: 4, hp: 40, attack: 1 };

export function ProcHarness({ onSeek, combat }: ProcHarnessProps): React.ReactElement {
  const [cardId, setCardId] = useState('');
  const [spec, setSpec] = useState<SandbagSpec>(DEFAULT_SANDBAGS);
  const [runUp, setRunUp] = useState(2);
  const [staged, setStaged] = useState(false);

  // Only cards actually on the board can proc — offering the whole index would let you pick a card that
  // cannot possibly appear in the fight you are about to stage, and then wonder why the list is empty.
  const boardCards = useGame((s) => {
    const board = s.run?.board ?? [];
    return [...new Set(board.map((m) => m.cardId))];
  });

  const procs: ProcMoment[] = useMemo(
    () => (combat && cardId ? scanProcs(combat, cardId) : []),
    [combat, cardId],
  );

  /** Pin the sandbag board at the current wave, then run the real combat dispatch. */
  const stage = (): void => {
    const state = useGame.getState();
    const run = state.run;
    if (!run) return;
    useGame.setState({
      run: { ...run, servedBoards: { ...(run.servedBoards ?? {}), [run.wave]: sandbagBoard(run.wave, spec) } },
    });
    state.dispatch({ type: 'faceOmen' });
    setStaged(true);
  };

  return (
    <div className="fxharness">
      <div className="fxharness-h">🎯 Proc harness</div>

      <label htmlFor="fxh-card">Card</label>
      <select id="fxh-card" value={cardId} onChange={(e) => setCardId(e.target.value)}>
        <option value="">— pick a card on your board —</option>
        {boardCards.map((id) => (
          <option key={id} value={id}>{CARD_INDEX[id]?.name ?? id}</option>
        ))}
      </select>

      <label htmlFor="fxh-count">Sandbags</label>
      <input id="fxh-count" type="range" min={1} max={SANDBAG_LIMITS.maxCount} step={1}
        value={spec.count} onChange={(e) => setSpec({ ...spec, count: Number(e.target.value) })} />
      <span className="fxharness-val">{spec.count}</span>

      {/* Health is the real knob: it sets how LONG the fight runs, which is what decides whether a periodic
          proc gets to fire at all. */}
      <label htmlFor="fxh-hp">Sandbag HP</label>
      <input id="fxh-hp" type="range" min={1} max={200} step={1}
        value={spec.hp} onChange={(e) => setSpec({ ...spec, hp: Number(e.target.value) })} />
      <span className="fxharness-val">{spec.hp}</span>

      <label htmlFor="fxh-atk">Sandbag Attack</label>
      <input id="fxh-atk" type="range" min={0} max={20} step={1}
        value={spec.attack} onChange={(e) => setSpec({ ...spec, attack: Number(e.target.value) })} />
      <span className="fxharness-val">{spec.attack}</span>

      <button className="fxwb-btn" onClick={stage}>Stage fight</button>

      <label htmlFor="fxh-runup" title="How many beats before the moment to start from, so you see it in context">
        Run-up
      </label>
      <input id="fxh-runup" type="range" min={0} max={8} step={1}
        value={runUp} onChange={(e) => setRunUp(Number(e.target.value))} />
      <span className="fxharness-val">{runUp} beats</span>

      <div className="fxharness-list">
        {procs.map((p) => (
          <button
            key={p.index}
            className="fxharness-row"
            onClick={() => onSeek(Math.max(0, p.index - runUp))}
          >
            <span className="fxharness-kind">{p.kind}</span>
            {p.boundDef === null ? (
              <span className="fxharness-unbound">nothing bound</span>
            ) : (
              <span className="fxharness-def">{p.boundDef}</span>
            )}
          </button>
        ))}
        {/* Loud about the empty case, on purpose. An empty list reads identically to "the scan is broken",
            and every significant defect in this subsystem so far has presented as "nothing happened". */}
        {staged && cardId !== '' && procs.length === 0 && (
          <p className="fxharness-empty">
            No moments from {CARD_INDEX[cardId]?.name ?? cardId} in this fight. Try more sandbag HP so the
            fight runs longer, or check the card is on your board.
          </p>
        )}
        {!staged && <p className="fxharness-empty">Stage a fight to see this card&apos;s moments.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck the new file compiles**

Run: `npm run typecheck:web 2>&1 | grep "harness/" || echo "no errors in harness/"`
Expected: `no errors in harness/`. (Remember `typecheck:web` is red overall on this repo for unrelated pre-existing reasons — you are only checking your own files.)

If `useGame` does not expose `dispatch` on its state, find how `SceneBuilder.tsx` dispatches (`grep -n "dispatch" packages/ui/src/SceneBuilder.tsx`) and match it exactly.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/fx/harness/ProcHarness.tsx
git commit -m "feat(fx): the proc harness panel — stage, scan, replay a moment

Deliberately thin: the logic worth asserting lives in procScan/procStage,
since this repo has no jsdom and a component test cannot run. The card
picker offers only cards on your board, because offering the whole index
lets you choose one that cannot appear in the fight you are staging. The
empty case says so out loud rather than rendering a blank list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Rail mode — host it, and stop pausing the fight

> **SUPERSEDED (2026-07-28):** "and stop pausing the fight" turned out to be a no-op — `overlayOpen` never
> included the workbench, so there was no existing pause to stop. See the devlog's 2026-07-28 proc-harness
> entry.

**Files:**
- Modify: `packages/ui/src/fx/ui/Workbench.tsx`
- Modify: `packages/ui/src/Recruit.tsx`
- Modify: `packages/ui/src/styles.css`

- [ ] **Step 1: Add rail mode to the workbench**

In `packages/ui/src/fx/ui/Workbench.tsx`, add near the other `useState` declarations (~line 213, beside `const [browsing, setBrowsing] = useState(false);`):

```tsx
  // Rail mode: collapse to one side so the live board is visible underneath, and host the proc harness.
  // A MODE rather than a second overlay, because the whole point is tuning and watching without a context
  // switch — two windows would put them a click apart, which is the loop this is meant to remove.
  const [railMode, setRailMode] = useState(false);
```

Add the toggle next to the existing "Browse all" button (~line 1344):

```tsx
        <button className="fxwb-btn" onClick={() => setRailMode((r) => !r)}>
          {railMode ? 'Full editor' : 'Watch in combat'}
        </button>
```

Add `railMode` to the root element's className (find the root `<div className="fxwb...">` the component returns):

```tsx
    <div className={`fxwb${railMode ? ' fxwb-rail' : ''}`}>
```

And render the harness inside that root, beside the `{browsing && …}` block:

```tsx
      {railMode && (
        <ProcHarness
          onSeek={(index) => replay?.seekTo(index)}
          combat={useGame.getState().run?.lastCombat ?? null}
        />
      )}
```

**The `replay` reference is the one thing this task must resolve.** The workbench does not currently have access to the live `CombatReplay`. Read how `Recruit.tsx` holds it (`const replay = useCombatReplay(...)` at ~line 1072) and pick the smaller of these two: pass `seekTo` down as a prop from wherever the workbench is mounted, or publish `seekTo` on the store when a replay is active. **Prefer the prop** — it keeps the dependency explicit and avoids a new store slot. Add the import for `ProcHarness` and `useGame` at the top of the file.

> **SUPERSEDED (2026-07-28):** "prefer the prop" turned out to be impossible — `DevMenu` renders the
> workbench as a *sibling* of `Recruit`, so no ancestor sees the replay to pass it down. Wired instead through
> a DEV-only `window.__fxSeek` handle, matching the existing `__pixiFx` / `__perfHud` pattern. See the
> devlog's 2026-07-28 proc-harness entry.

- [ ] **Step 2: Stop the workbench pausing combat in rail mode**

`Recruit.tsx` passes `paused: overlayOpen` to `useCombatReplay` (~line 1072), and the workbench counts as an overlay — so today, opening it freezes the fight and rail mode would watch a still board.

> **SUPERSEDED (2026-07-28):** false — `overlayOpen` never included the workbench (its open state lives in
> local `DevMenu` state), so this step was a no-op; nothing pauses in rail mode because nothing paused for
> the workbench at all. See the devlog's 2026-07-28 proc-harness entry.

Find where `overlayOpen` is computed in `Recruit.tsx` and exclude the workbench-in-rail-mode case. Add a comment at the change site:

```tsx
  // Rail mode deliberately does NOT pause: the harness exists to watch the fight play, and `overlayOpen`
  // otherwise freezes it the moment the workbench opens.
```

- [ ] **Step 3: Style the rail**

Add to `packages/ui/src/styles.css`, directly after the `.fxwb-top, .fxwb-transport, .fxwb-side, .fxlib { pointer-events: auto; }` rule:

```css
/* Rail mode — the workbench narrows to one column so the live board plays in the space it vacates. The root
   stays pointer-events:none (see above), so the board underneath keeps receiving the pointer. */
.fxwb-rail .fxwb-side { width: 320px; }
.fxwb-rail .fxwb-top,
.fxwb-rail .fxwb-transport { display: none; }
.fxharness {
  position: absolute; top: 0; right: 0; bottom: 0; width: 320px;
  display: flex; flex-direction: column; gap: 8px;
  padding: 12px; box-sizing: border-box; overflow-y: auto;
  background: #17141f; color: #d9d3ea; pointer-events: auto;
}
.fxharness-h { font-weight: 600; letter-spacing: 0.02em; }
.fxharness-val { font-variant-numeric: tabular-nums; opacity: 0.8; }
.fxharness-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.fxharness-row {
  display: flex; justify-content: space-between; gap: 8px;
  padding: 6px 8px; border-radius: 4px; border: 1px solid #2c2740;
  background: #1e1a2b; color: inherit; cursor: pointer; text-align: left;
}
.fxharness-row:hover { background: #272136; }
.fxharness-kind { font-weight: 600; }
.fxharness-def { opacity: 0.75; }
.fxharness-unbound { opacity: 0.6; font-style: italic; }
.fxharness-empty { opacity: 0.7; font-size: 0.9em; line-height: 1.4; }
```

- [ ] **Step 4: Verify in the browser — this task cannot be verified any other way**

Start the dev server from the worktree (`npm run dev`) and read the port it prints. Then:
1. Dev menu → 🎨 FX Workbench → **Watch in combat**. The panels should narrow and the board should be visible.
2. Put a card on your board, pick it, **Stage fight**. The fight should run — **not freeze**. If it freezes, Step 2 is wrong.
3. Click a moment row. The replay should jump to that beat and play on.
4. Click **Full editor** to return.

Report exactly what you saw at each step. If any step fails, fix it and re-check before committing.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/ui/Workbench.tsx packages/ui/src/Recruit.tsx packages/ui/src/styles.css
git commit -m "feat(fx): workbench rail mode hosts the proc harness

A mode rather than a second overlay: the loop this exists to serve is
tune -> watch on the real card -> tune again, and two windows put those
a click apart. Rail mode also exempts itself from the overlay pause,
which otherwise freezes the fight the moment the workbench opens.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

> **SUPERSEDED (2026-07-28):** the commit message's premise was false — `overlayOpen` never included the
> workbench, so there was no pause to exempt rail mode from. See the devlog's 2026-07-28 proc-harness entry.

---

### Task 6: Full gate and docs

**Files:**
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `README.md`

- [ ] **Step 1: Run the gate**

```bash
npm run typecheck && npm run lint && npm test && npm run build:web
```
Expected: typecheck clean; lint **0 errors** (3 known warnings); all tests pass (2766 before this work, plus ~20 added); `build:web` succeeds.

- [ ] **Step 2: Prepend the devlog entry**

Add at the top of `docs/devlog.md`, below the `# ASCENT — development log` heading:

```markdown
## 2026-07-28 — the proc harness: replay any moment a card caused

**What changed.** Phase ② of live FX authoring. You can now pick a card, stage a controlled fight against
tunable sandbags, get the list of moments that card actually caused, and jump the replay to any one of them
with a run-up — on the real board, at real scale, as many times as you like.

Four pieces. `fx/harness/procScan.ts` is pure: it inverts the uid→cardId map the replay already builds
(reading BOTH starting rosters and every `summon`, so a token's moments aren't dropped), compiles the
moments, and keeps the ones whose acting unit belongs to the card. An `attack` is attributed to its attacker
and a `dmg` to nobody — attributing damage would credit the moment to the unit that was hit. Each row
carries what `bindingFor` says would play, including `null`, so "no effect here yet" is visible rather than
something you discover by watching nothing happen. `fx/harness/procStage.ts` is the pure half of
SceneBuilder's `setEnemies`, extracted so the clamping rules are testable. `ProcHarness.tsx` is the rail UI.

**The one hot-file change is an extraction.** `useCombatReplay`'s fresh-combat effect already cleared
fourteen pieces of transient per-beat state and killed stray GSAP tweens; that body became `resetTo(index)`,
the effect calls `resetTo(0)`, and the hook exports a clamped `seekTo`. `resetTo(0)` is byte-identical to
what the effect did.

**Why seeking is safe at all** — and this is the load-bearing fact — is that `computeFrame` rebuilds the
board from `initial` on *every* call rather than folding from the previous frame. The board at any beat is a
pure function of `(initial, events, upto)`, so a jump cannot desynchronise it. That property is now pinned by
`computeFrame.purity.test.ts`, written and committed *before* the extraction: same args twice are equal,
jumping equals playing forward, computing a later frame first changes nothing, and the initial snapshots are
never mutated. Optimising `computeFrame` into an incremental update is a reasonable-looking change that would
break seeking silently — the board would show whatever the last-played beat left behind. Now it's a red build.

**Staging goes through the real `faceOmen` dispatch** rather than building a `CombatResult` on the side. That
inherits SceneBuilder's philosophy (nothing bypasses the sim) and means the replay hook, board renderer,
choreo engine and FX bridge all work untouched. The alternative needed two new seams in `Recruit.tsx` — the
file every fight runs through — to avoid advancing a wave counter in a sandbox run.

**Two integration details** that would otherwise surface in the browser instead of the design: the workbench
counts as an overlay and `Recruit.tsx` passes `paused: overlayOpen`, so rail mode had to exempt itself or the
harness would watch a permanently-still board; and rail mode is a *mode* on the workbench, not a second
overlay, because the loop being served is tune → watch → tune and two windows put those a click apart.

> **SUPERSEDED (2026-07-28):** the first premise was false — `overlayOpen` never included the workbench, so
> there was no pause and no exemption needed. See the devlog's 2026-07-28 proc-harness entry.

**How it was verified.** `procScan` and `procStage` have real unit tests (attribution across both rosters and
summons, an attack credited to its attacker, a `dmg` credited to nobody, indices valid against the compiled
list, bound and unbound defs, the empty case returning `[]` rather than throwing; clamping at both extremes).
`seekTo` itself cannot be unit-tested — this repo has no jsdom — so it is covered by the `computeFrame`
purity tests plus a manual browser check of the full loop. Full gate green.

**Follow-ups.** Phase ③ — the authoring panel with a "commit animation" button offering card-only or global
scope — is now unblocked. The harness stages sandbags only; the final look-check against a real pooled
opponent stays manual until it earns automation.
```

- [ ] **Step 3: Update the roadmap**

In `docs/roadmap.md`, under **Now**, remove the phase ② entry and leave phase ③, adjusting its note:

```markdown
- **Live FX authoring, phase ③ — the authoring panel.** Tie ① and ② together: pick a card, tune its effect
  against the live replay the proc harness stages, and commit with a choice of card-only or global scope.
  Phase ① (bindings as data) shipped 2026-07-27; phase ② (the proc harness) shipped 2026-07-28.
```

- [ ] **Step 4: Update the README**

Add at the top of **Recent changes** in `README.md`:

```markdown
- **Replay any moment a card caused.** Stage a controlled fight, pick from the list of moments your card
  actually produced, and jump the replay to any of them with a run-up — so an authored effect can be judged
  on the real card at real scale, on demand, instead of by playing until its moment happens to occur.
```

- [ ] **Step 5: Commit and push**

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: devlog + roadmap + README for the proc harness

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin feat/fx-workbench-p1
```

The branch is already PR #689 — no new PR. **Do not merge**; branch protection requires a review Claude cannot satisfy.

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: `procScan` → T1, `procStage` → T2, `seekTo` → T3,
`ProcHarness` → T4, rail mode + the pause exemption → T5, testing → T1/T2/T3, docs → T6. The spec's "failure
is loud" requirement is implemented in T4's empty-state copy and asserted indirectly by T1's `boundDef: null`
case.

**Deliberate deviation from the spec.** The spec says `seekTo` gets a test that "seeking to beat N produces
the same frame as playing forward to beat N". That cannot be written as stated — the repo has no jsdom, so
the hook cannot be rendered. T3 tests the same property one level down, on the exported pure `computeFrame`,
which is strictly stronger: it pins the invariant that *makes* seek correct rather than one instance of it.

**Known soft spot.** T5 Step 1 leaves one decision to the implementer (how the workbench reaches the live
`seekTo`) because it depends on where the workbench is mounted relative to `Recruit.tsx`'s replay — which
needs reading at implementation time. The plan states the preferred answer (prop over store slot) and why.

**Type consistency.** `ProcMoment` / `SandbagSpec` / `SANDBAG_LIMITS` / `sandbagBoard` / `scanProcs` /
`uidsForCard` / `actingUid` / `seekTo` / `resetTo` are used with identical signatures everywhere they appear.
