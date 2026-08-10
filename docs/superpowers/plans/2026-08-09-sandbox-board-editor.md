# Sandbox Board Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Scene Builder's sandbox run the FX authoring stage — both boards editable in place, the opponent authored where opponents actually stand, and any fight re-watchable — and delete the workbench's synthetic 3v3 stage it replaces.

**Architecture:** All rules live in one pure module (`sandboxEdit.ts`) of total functions over `RunState` / `BoardSnapshot`, unit-tested directly; the React surfaces stay thin and apply those results through the Zustand store. This repo has no jsdom, so anything worth asserting has to be pure to be testable at all — that constraint sets the boundary. Nothing in `core` / `content` / `sim` changes: the player board is `run.board` (`BoardCard[]`) and the opponent is `run.servedBoards[wave]` (a `BoardSnapshot`), both already modelled and both already read verbatim by combat.

**Tech Stack:** TypeScript, React 18, Zustand (`packages/ui/src/store.ts`), Vitest (node env, no DOM), Vite.

**Spec:** [`docs/superpowers/specs/2026-08-09-sandbox-board-editor-design.md`](../specs/2026-08-09-sandbox-board-editor-design.md)

## Global Constraints

- **Every flag and control added here is gated on `run.sandbox === true`** and stripped from production with the rest of the dev tooling. None of it can reach a played run.
- **Editing sets BASE stats, never buffs.** A typed 40/40 reads as a 40/40 with neutral badges. Never write into `BoardCard.buffs`.
- **Placing a card does NOT fire its Battlecry / summon effects.** It arrives as if it had always been there.
- **A replay re-runs the animation and NOTHING else.** Never re-dispatch `faceOmen` to replay; that resolves a second combat and advances the run.
- **Enemy boards clamp to 1–7 minions.** An empty board ends combat instantly and reads as a broken rig.
- **`Math.random` is banned** in `core` / `content` / `sim` (ESLint-enforced). This plan touches only `packages/ui`, but don't introduce it here either — uids come from a counter.
- **Never hand-edit `packages/sim/src/opponentPool.data.ts`** (generated).
- Gates before any "done" claim: `npm run typecheck && npx eslint packages apps && npm test && npm run build:web`.
  Note `npm run lint` also reports errors from the untracked `impeccable` skill's vendored scripts under
  `.agents/` and `.github/skills/` — those are not repo source. `npx eslint packages apps` is the honest read.
- **Branch:** `feat/sandbox-board-editor` (already created off `origin/main`, holds the spec commit). One PR.
- **Docs:** `docs/devlog.md`, `docs/roadmap.md` and the README's Recent-changes list are updated in Task 8, not per task.

---

### Task 1: Delete the workbench's synthetic stage

The stage shipped 2026-08-08 (PR #936) is superseded: it was scenery that could not fight. Removing it FIRST means nothing later is built beside code that is about to disappear, and it restores `boardAnchors` to plain document queries before any other work touches board reads.

**Files:**
- Delete: `packages/ui/src/fx/ui/Stage.tsx`
- Delete: `packages/ui/src/fx/ui/stageBoard.ts`
- Delete: `packages/ui/src/fx/ui/stageBoard.test.ts`
- Modify: `packages/ui/src/fx/ui/Workbench.tsx` (imports at 58–66; state at 426–431; `stageShown` at 438; `previewOptions` at 444–450; render at 1926–1932; stage controls at ~2030–2070)
- Modify: `packages/ui/src/fx/boardAnchors.ts` (remove `boardRoot`, restore `rectOf`)
- Modify: `packages/ui/src/fx/reactTargets.ts` (remove the `boardRoot` import and its use in `otherRowUids`)
- Modify: `packages/ui/src/styles.css` (remove the `.fxwb-stage` block and `.fxwb-stage-group` / `.fxwb-stage-row` / `.fxwb-stage-pick` rules)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. This task only removes surface. After it, `packages/ui/src/fx/ui/` contains no `Stage`/`stageBoard` module and `boardAnchors.ts` exports exactly what it did before PR #936.

- [ ] **Step 1: Confirm the current behaviour before removing it**

Run: `npx vitest run packages/ui/src/fx/ui/stageBoard.test.ts`
Expected: PASS (8 tests). This is the suite being deleted — running it first proves you are deleting a working thing deliberately, not chasing a failure.

- [ ] **Step 2: Delete the three stage files**

```bash
git rm packages/ui/src/fx/ui/Stage.tsx packages/ui/src/fx/ui/stageBoard.ts packages/ui/src/fx/ui/stageBoard.test.ts
```

- [ ] **Step 3: Remove the stage wiring from `Workbench.tsx`**

Delete the import block (currently lines 58–66):

```tsx
import { FxStage } from './Stage';
import {
  FX_STAGE_SLOTS,
  defaultStageBoard,
  setStageCard,
  stageUnitOptions,
  type FxStageBoard,
  type FxStageSide,
} from './stageBoard';
```

Delete the state block (currently ~426–431) — the `stageOn` / `stageBoard` / `stageCardOptions` declarations and their comment — and the `stageShown` line (~438).

Restore `previewOptions` (currently ~444–450) to its pre-stage form:

```tsx
  const previewOptions = useMemo(
    () => (previewBoard ?? []).map((m, i) => ({ uid: m.uid, label: `${i + 1}. ${CARD_INDEX[m.cardId]?.name ?? m.cardId}` })),
    [previewBoard],
  );
```

Delete the `{stageShown && <FxStage board={stageBoard} />}` render line and its comment block (~1926–1932), and the whole `<div className="fxwb-group fxwb-stage-group">…</div>` control group (~2030–2070).

Change the `BUYABLE_CARDS` import back to `CARD_INDEX` only (line 3):

```tsx
import { CARD_INDEX } from '@game/content';
```

- [ ] **Step 4: Restore `boardAnchors.ts`**

Delete the `boardRoot` export and its doc comment, and restore `rectOf` to:

```ts
const rectOf = (sel: string): RectLike | null => document.querySelector(sel)?.getBoundingClientRect() ?? null;
```

- [ ] **Step 5: Restore `reactTargets.ts`**

Remove `import { boardRoot } from './boardAnchors';` and restore the line in `otherRowUids` (with its original comment, which had none):

```ts
  const rows = [...document.querySelectorAll('.row')].filter((r) => r !== row);
```

- [ ] **Step 6: Remove the stage CSS**

In `packages/ui/src/styles.css`, delete the `/* ---- THE STAGE ---- */` block (the `.fxwb-stage` rule and its comment) and the three rules `.fxwb-stage-group`, `.fxwb-stage-row`, `.fxwb-stage-pick`.

- [ ] **Step 7: Verify nothing references the removed symbols**

Run: `grep -rn "fxwb-stage\|stageBoard\|FxStage\|boardRoot" packages/ui/src apps/web/src`
Expected: no matches.

- [ ] **Step 8: Run the gates**

Run: `npm run typecheck && npx eslint packages apps && npm test`
Expected: typecheck clean, 0 eslint errors, all tests pass (the suite is 8 tests smaller than before).

- [ ] **Step 9: Commit**

```bash
git add -A packages/ui docs
git commit -m "refactor(fx): remove the workbench's synthetic stage

Superseded by the sandbox board editor: the stage was scenery that could
not fight, so an effect could only be previewed there, never fired by a
real attack. boardRoot() goes with it — it existed only to disambiguate a
fake board from a real one on screen at once."
```

---

### Task 2: The pure edit module

**Files:**
- Create: `packages/ui/src/sandboxEdit.ts`
- Create: `packages/ui/src/sandboxEdit.test.ts`
- Modify: `packages/ui/src/fx/harness/procStage.ts` (re-express `sandbagBoard` in terms of the new `stagedBoard`)

**Interfaces:**
- Consumes: `BoardCard`, `BoardSnapshot` (`@game/sim`); `BoardMinion`, `Keyword`, `CardDef` (`@game/core`); `CARD_INDEX` (`@game/content`).
- Produces:
  - `MAX_BOARD = 7`
  - `setCardStats(board: BoardCard[], uid: string, stats: { attack?: number; health?: number }): BoardCard[]`
  - `setCardId(board: BoardCard[], uid: string, cardId: string, defOf: (id: string) => CardDef | undefined): BoardCard[]`
  - `toggleCardKeyword(board: BoardCard[], uid: string, kw: Keyword): BoardCard[]`
  - `stagedBoard(wave: number, minions: BoardMinion[]): BoardSnapshot`
  - `setEnemyStats(snap: BoardSnapshot, index: number, stats: { attack?: number; health?: number }): BoardSnapshot`
  - `setEnemyCardId(snap: BoardSnapshot, index: number, cardId: string, defOf: (id: string) => CardDef | undefined): BoardSnapshot`
  - `toggleEnemyKeyword(snap: BoardSnapshot, index: number, kw: Keyword): BoardSnapshot`
  - `addEnemy(snap: BoardSnapshot, cardId: string, defOf: (id: string) => CardDef | undefined): BoardSnapshot`
  - `removeEnemy(snap: BoardSnapshot, index: number): BoardSnapshot`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/src/sandboxEdit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BoardCard, BoardSnapshot } from '@game/sim';
import type { CardDef } from '@game/core';
import {
  MAX_BOARD,
  addEnemy,
  removeEnemy,
  setCardId,
  setCardStats,
  setEnemyCardId,
  setEnemyStats,
  stagedBoard,
  toggleCardKeyword,
  toggleEnemyKeyword,
} from './sandboxEdit';

const def = (id: string, attack = 3, health = 4): CardDef =>
  ({ id, name: id.toUpperCase(), tribe: 'beast', tier: 1, attack, health, keywords: [], effects: [], text: '' }) as CardDef;
const DEFS: Record<string, CardDef> = { wolf: def('wolf', 3, 4), bear: def('bear', 9, 9) };
const defOf = (id: string): CardDef | undefined => DEFS[id];

const card = (uid: string, cardId = 'wolf'): BoardCard => ({
  uid, cardId, tribe: 'beast', attack: 3, health: 4, keywords: [], golden: false,
});

describe('editing a player board card', () => {
  it('sets base stats and leaves the buff breakdown alone', () => {
    const board = [{ ...card('a'), buffs: [{ source: 'Karwind', attack: 2, health: 2 }] } as BoardCard];
    const next = setCardStats(board, 'a', { attack: 40, health: 40 });
    expect(next[0].attack).toBe(40);
    expect(next[0].health).toBe(40);
    expect(next[0].buffs).toEqual(board[0].buffs);
  });

  it('floors health at 1 and attack at 0 — a 0-health card is a corpse the sim never produces at rest', () => {
    const next = setCardStats([card('a')], 'a', { attack: -5, health: 0 });
    expect(next[0].attack).toBe(0);
    expect(next[0].health).toBe(1);
  });

  it('leaves other cards untouched and returns a new array', () => {
    const board = [card('a'), card('b')];
    const next = setCardStats(board, 'b', { attack: 7 });
    expect(next).not.toBe(board);
    expect(next[0]).toBe(board[0]);
    expect(next[1].attack).toBe(7);
  });

  it('an unknown uid is a no-op, not a throw', () => {
    const board = [card('a')];
    expect(setCardStats(board, 'nope', { attack: 9 })).toEqual(board);
  });

  it('swapping the card keeps the uid and adopts the new printed stats and tribe', () => {
    const next = setCardId([card('a')], 'a', 'bear', defOf);
    expect(next[0].uid).toBe('a');
    expect(next[0].cardId).toBe('bear');
    expect(next[0].attack).toBe(9);
    expect(next[0].health).toBe(9);
    expect(next[0].tribe).toBe('beast');
  });

  it('swapping to an unknown card id changes nothing', () => {
    const board = [card('a')];
    expect(setCardId(board, 'a', 'ghost', defOf)).toEqual(board);
  });

  it('keyword toggles are their own inverse', () => {
    const on = toggleCardKeyword([card('a')], 'a', 'T');
    expect(on[0].keywords).toEqual(['T']);
    expect(toggleCardKeyword(on, 'a', 'T')[0].keywords).toEqual([]);
  });
});

describe('the staged opponent board', () => {
  const snap = (n: number): BoardSnapshot =>
    stagedBoard(3, Array.from({ length: n }, () => ({ cardId: 'wolf', attack: 3, health: 4, keywords: [] })));

  it('carries the wave and the minions verbatim', () => {
    const s = snap(2);
    expect(s.wave).toBe(3);
    expect(s.minions).toHaveLength(2);
    expect(s.minions[0].cardId).toBe('wolf');
  });

  it('power is the sum of attack and health across the board', () => {
    expect(snap(2).power).toBe((3 + 4) * 2);
  });

  it('clamps to at most 7 minions', () => {
    expect(snap(12).minions).toHaveLength(MAX_BOARD);
    expect(addEnemy(snap(MAX_BOARD), 'wolf', defOf).minions).toHaveLength(MAX_BOARD);
  });

  it('never produces an empty board — removing the last minion is refused', () => {
    const one = snap(1);
    expect(removeEnemy(one, 0).minions).toHaveLength(1);
  });

  it('removes the named slot and leaves the others in order', () => {
    const s = setEnemyCardId(snap(3), 1, 'bear', defOf);
    const after = removeEnemy(s, 1);
    expect(after.minions).toHaveLength(2);
    expect(after.minions.every((m) => m.cardId === 'wolf')).toBe(true);
  });

  it('adds a minion with its printed stats', () => {
    const s = addEnemy(snap(1), 'bear', defOf);
    expect(s.minions).toHaveLength(2);
    expect(s.minions[1]).toMatchObject({ cardId: 'bear', attack: 9, health: 9 });
  });

  it('edits recompute power, so a served board never reports a stale strength', () => {
    const s = setEnemyStats(snap(1), 0, { attack: 10, health: 10 });
    expect(s.power).toBe(20);
  });

  it('enemy stats floor exactly like player stats', () => {
    const s = setEnemyStats(snap(1), 0, { attack: -3, health: 0 });
    expect(s.minions[0]).toMatchObject({ attack: 0, health: 1 });
  });

  it('an out-of-range index is a no-op', () => {
    const s = snap(1);
    expect(setEnemyStats(s, 9, { attack: 5 })).toEqual(s);
    expect(removeEnemy(s, -1)).toEqual(s);
  });

  it('enemy keyword toggles are their own inverse', () => {
    const on = toggleEnemyKeyword(snap(1), 0, 'DS');
    expect(on.minions[0].keywords).toEqual(['DS']);
    expect(toggleEnemyKeyword(on, 0, 'DS').minions[0].keywords).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/ui/src/sandboxEdit.test.ts`
Expected: FAIL — `Failed to resolve import "./sandboxEdit"`.

- [ ] **Step 3: Write the module**

Create `packages/ui/src/sandboxEdit.ts`:

```ts
import type { BoardMinion, CardDef, Keyword, Tribe } from '@game/core';
import type { BoardCard, BoardSnapshot } from '@game/sim';

/**
 * The Scene Builder's board edits, as PURE data transforms — the rules half of the sandbox editor.
 *
 * Everything the editor can do lives here as a total function over `BoardCard[]` (your row) or
 * `BoardSnapshot` (the pinned opponent), so the rules are unit-testable and the React surfaces stay thin.
 * That split is not stylistic: this repo has no jsdom, so a rule that lives inside a component cannot be
 * asserted at all.
 *
 * Two invariants run through every function here, and both exist because breaking them produces a rig that
 * looks broken rather than an obvious error:
 *   - **Health floors at 1, attack at 0.** A 0-health minion is a corpse; a board of them ends combat
 *     instantly, which reads as "the sandbox is broken" rather than "you typed 0".
 *   - **An opponent board is never empty and never longer than 7.** Same reason for the floor; the ceiling
 *     is the board size the game itself enforces.
 *
 * Stats set here are BASE stats — nothing writes `BoardCard.buffs` (owner ruling 2026-08-09). A 40/40 you
 * typed should read as a 40/40 with neutral badges, not as "+38 buffed": a buff-coloured badge would be
 * asserting a history the unit does not have.
 */

/** Board size, both sides. The game's own limit; published so the clamps and any UI bound cannot drift. */
export const MAX_BOARD = 7;

/** Stats always arrive as a partial — the editor has two fields and either may be untouched. */
export interface StatEdit {
  attack?: number;
  health?: number;
}

const clampAttack = (n: number): number => (!Number.isFinite(n) ? 0 : Math.max(0, Math.round(n)));
const clampHealth = (n: number): number => (!Number.isFinite(n) ? 1 : Math.max(1, Math.round(n)));

/** Apply a partial stat edit to whatever carries `attack`/`health`, honouring the floors. */
function applyStats<T extends { attack: number; health: number }>(unit: T, stats: StatEdit): T {
  return {
    ...unit,
    attack: stats.attack === undefined ? unit.attack : clampAttack(stats.attack),
    health: stats.health === undefined ? unit.health : clampHealth(stats.health),
  };
}

/** Add or remove a keyword, whichever the unit currently lacks or has. Order is preserved on removal. */
function flipKeyword(keywords: Keyword[], kw: Keyword): Keyword[] {
  return keywords.includes(kw) ? keywords.filter((k) => k !== kw) : [...keywords, kw];
}

/* ── your row: BoardCard[] ─────────────────────────────────────────────────────────────────────────── */

/** Replace one card in `board`, matched by uid. An unknown uid returns the board unchanged — the editor can
 *  race a card leaving the board (sold, magnetized), and a throw there would take the panel down. */
function mapCard(board: BoardCard[], uid: string, fn: (c: BoardCard) => BoardCard): BoardCard[] {
  if (!board.some((c) => c.uid === uid)) return board;
  return board.map((c) => (c.uid === uid ? fn(c) : c));
}

export function setCardStats(board: BoardCard[], uid: string, stats: StatEdit): BoardCard[] {
  return mapCard(board, uid, (c) => applyStats(c, stats));
}

/**
 * Swap which card a slot holds, KEEPING its uid. The uid is what every other system knows this body by
 * (the FX subject picker, drag state, the hold store), so swapping the card must not orphan it.
 *
 * Adopts the new card's printed stats and tribe — the point of a swap is to become that card, and carrying
 * the old body's numbers over would silently produce a minion that exists nowhere in the content.
 */
export function setCardId(
  board: BoardCard[],
  uid: string,
  cardId: string,
  defOf: (id: string) => CardDef | undefined,
): BoardCard[] {
  const def = defOf(cardId);
  if (def === undefined) return board; // unknown id → no-op, never a half-written card
  return mapCard(board, uid, (c) => ({
    ...c,
    cardId,
    tribe: def.tribe,
    attack: clampAttack(def.attack),
    health: clampHealth(def.health),
    keywords: [...def.keywords],
  }));
}

export function toggleCardKeyword(board: BoardCard[], uid: string, kw: Keyword): BoardCard[] {
  return mapCard(board, uid, (c) => ({ ...c, keywords: flipKeyword(c.keywords, kw) }));
}

/* ── the opponent: BoardSnapshot ───────────────────────────────────────────────────────────────────── */

/** Σ(attack + health), which is what `BoardSnapshot.power` is documented to mean. Recomputed on every edit
 *  so a served board can never report a strength its minions don't have. */
const powerOf = (minions: BoardMinion[]): number =>
  minions.reduce((sum, m) => sum + m.attack + m.health, 0);

/**
 * The envelope a pinned opponent board needs, around whatever minions the author staged.
 *
 * The metadata below is the same set `sandbagBoard` (fx/harness/procStage.ts) established, and its audit of
 * which fields are inert for a SERVED board still applies verbatim — read it there before changing any of
 * them. The short version: a served board is pinned into `servedBoards` and read by `nextOpponent`, never
 * selected through `pickOpponent`, so `origin` / `threat` / `seed` / `remote` are all inert; `resolve` is
 * display-only; and `tier` is NOT inert — it feeds loss damage (`enemyState.tier` in `simulate`).
 */
export function stagedBoard(wave: number, minions: BoardMinion[]): BoardSnapshot {
  const clamped = minions.slice(0, MAX_BOARD).map((m) => applyStats(m, {}));
  return {
    v: 1,
    wave,
    heroId: 'warden', // no served-board hero-power branch — see procStage.ts
    resolve: 30,      // display-only
    tier: 7,          // NOT inert: feeds loss damage
    triples: 0,
    tribes: [],
    threat: 'glass',
    power: powerOf(clamped),
    minions: clamped,
    seed: 1,
    origin: 'self',
  };
}

/** Replace one minion by index, recomputing `power`. An out-of-range index is a no-op. */
function mapEnemy(snap: BoardSnapshot, index: number, fn: (m: BoardMinion) => BoardMinion): BoardSnapshot {
  if (index < 0 || index >= snap.minions.length) return snap;
  const minions = snap.minions.map((m, i) => (i === index ? fn(m) : m));
  return { ...snap, minions, power: powerOf(minions) };
}

export function setEnemyStats(snap: BoardSnapshot, index: number, stats: StatEdit): BoardSnapshot {
  return mapEnemy(snap, index, (m) => applyStats(m, stats));
}

export function setEnemyCardId(
  snap: BoardSnapshot,
  index: number,
  cardId: string,
  defOf: (id: string) => CardDef | undefined,
): BoardSnapshot {
  const def = defOf(cardId);
  if (def === undefined) return snap;
  return mapEnemy(snap, index, () => ({
    cardId,
    attack: clampAttack(def.attack),
    health: clampHealth(def.health),
    keywords: [...def.keywords],
  }));
}

export function toggleEnemyKeyword(snap: BoardSnapshot, index: number, kw: Keyword): BoardSnapshot {
  return mapEnemy(snap, index, (m) => ({ ...m, keywords: flipKeyword(m.keywords ?? [], kw) }));
}

/** Append a minion at its printed stats. Refused at `MAX_BOARD` — the game's own board limit. */
export function addEnemy(
  snap: BoardSnapshot,
  cardId: string,
  defOf: (id: string) => CardDef | undefined,
): BoardSnapshot {
  const def = defOf(cardId);
  if (def === undefined || snap.minions.length >= MAX_BOARD) return snap;
  const minions: BoardMinion[] = [
    ...snap.minions,
    { cardId, attack: clampAttack(def.attack), health: clampHealth(def.health), keywords: [...def.keywords] },
  ];
  return { ...snap, minions, power: powerOf(minions) };
}

/** Remove a minion. REFUSED at one minion left: an empty served board ends combat the instant it starts,
 *  and the rig would then report "no moments" for an effect that is working perfectly. */
export function removeEnemy(snap: BoardSnapshot, index: number): BoardSnapshot {
  if (index < 0 || index >= snap.minions.length || snap.minions.length <= 1) return snap;
  const minions = snap.minions.filter((_, i) => i !== index);
  return { ...snap, minions, power: powerOf(minions) };
}
```

Note the unused-import risk: `Tribe` is imported above only if you reference it. If TypeScript reports it unused, delete it from the import — `def.tribe` is already typed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/ui/src/sandboxEdit.test.ts`
Expected: PASS (all 17 tests).

- [ ] **Step 5: Re-express `sandbagBoard` in terms of `stagedBoard`**

In `packages/ui/src/fx/harness/procStage.ts`, replace the body of `sandbagBoard` so the snapshot envelope lives in exactly one place. Keep the whole existing comment block above it — it is the audit of which fields are inert, and `stagedBoard` now points back to it.

```ts
export function sandbagBoard(wave: number, spec: SandbagSpec): BoardSnapshot {
  const count = clamp(spec.count, 1, SANDBAG_LIMITS.maxCount);
  const health = clamp(spec.hp, 1, SANDBAG_LIMITS.maxHp);
  const attack = clamp(spec.attack, 0, SANDBAG_LIMITS.maxAttack);
  return stagedBoard(
    wave,
    Array.from({ length: count }, () => ({ cardId: 'sandbag', attack, health, keywords: [] as Keyword[] })),
  );
}
```

Add the import: `import { stagedBoard } from '../../sandboxEdit';`

- [ ] **Step 6: Fix the one test this intentionally changes**

`stagedBoard` computes `power` as Σ(attack + health); the old `sandbagBoard` used `health * count`, which the existing comment documents as "wrong-but-consistent". Making them consistent is the point of this step, so a `procStage.test.ts` assertion on `power` will now fail.

Run: `npx vitest run packages/ui/src/fx/harness/procStage.test.ts`
Expected: a `power` assertion fails (or passes, if none exists). If it fails, update the expected value to `(attack + health) * count` and add to that test's name or a comment: `power is now Σ(attack+health) — see stagedBoard`.

- [ ] **Step 7: Run the gates**

Run: `npm run typecheck && npx eslint packages apps && npm test`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/sandboxEdit.ts packages/ui/src/sandboxEdit.test.ts packages/ui/src/fx/harness/procStage.ts packages/ui/src/fx/harness/procStage.test.ts
git commit -m "feat(sandbox): pure board-edit rules

Every edit the sandbox editor can make, as a total function over
BoardCard[] or BoardSnapshot: base stats with floors, card swap keeping
the uid, keyword toggles, enemy add/remove clamped to 1-7. sandbagBoard
now builds its envelope through stagedBoard, so the served-board metadata
lives in one place."
```

---

### Task 3: Store — sandbox flags and the replay action

**Files:**
- Modify: `packages/ui/src/store.ts` (add to the state interface near the other dev flags around line 300; add the implementations near `startSceneBuilder`, ~line 838)

**Interfaces:**
- Consumes: `MAX_BOARD` is not needed here; nothing from Task 2.
- Produces:
  - `sbEditMode: boolean` — the click-to-edit gate.
  - `setSbEditMode(on: boolean): void`
  - `sbTavernShowsEnemy: boolean` — false = shop offers (default), true = the pinned opponent.
  - `setSbTavernShowsEnemy(on: boolean): void`
  - `replayLastCombat(): void` — re-enters the combat phase on the stored `lastCombat` without resolving anything.

- [ ] **Step 1: Add the state declarations**

In the store's state interface, beside the other dev-only flags:

```ts
  /** SANDBOX ONLY (dev). Click-to-edit is armed: a click on a board minion opens the unit editor instead of
   *  starting a drag / a buy. A MODE rather than a modifier because a bare click already means something on
   *  both rows, and the rig has to leave normal play intact — the shop phase is where some of the
   *  interactions under test only ever happen. */
  sbEditMode: boolean;
  setSbEditMode: (on: boolean) => void;
  /** SANDBOX ONLY (dev). What the tavern row renders: the shop offers (false, the default and exactly the
   *  shipped behaviour) or the opponent pinned for the coming fight (true). A RENDER switch — flipping it
   *  changes no run state, so returning to the shop leaves it precisely as it was. */
  sbTavernShowsEnemy: boolean;
  setSbTavernShowsEnemy: (on: boolean) => void;
  /** SANDBOX ONLY (dev). Watch the last fight again: same boards, same seed, same beats. */
  replayLastCombat: () => void;
```

- [ ] **Step 2: Write the implementations**

Beside `startSceneBuilder`:

```ts
  sbEditMode: false,
  setSbEditMode: (on) => set({ sbEditMode: on }),
  sbTavernShowsEnemy: false,
  setSbTavernShowsEnemy: (on) => set({ sbTavernShowsEnemy: on }),
  /**
   * Re-enter the combat phase on the CombatResult already stored, so `useCombatReplay` remounts and animates
   * it from beat 0. Byte-identical by construction rather than by luck: nothing re-simulates.
   *
   * Deliberately NOT a re-dispatch of the action that produced the fight. Resolving a real combat also
   * settles Resolve, the wave, quests, telemetry and the autosave; a second `faceOmen` would reach all of
   * that, and the run would silently advance behind a button labelled "watch that again".
   *
   * Sandbox-gated, and a no-op with no stored fight — the button is hidden in that state, but a store action
   * must not depend on its caller's guard.
   */
  replayLastCombat: () => {
    const s = get();
    if (!s.run.sandbox || !s.run.lastCombat) return;
    set({ run: { ...s.run, phase: 'combat', combatSettled: false } });
  },
```

- [ ] **Step 3: Verify the field name against the run state**

Run: `grep -n "combatSettled" packages/sim/src/state.ts`
Expected: a `combatSettled` field exists on `RunState`. If it does not, drop it from the `set` above and keep only `phase: 'combat'` — the point of the line is to re-enter the phase, and inventing a field would not typecheck anyway.

- [ ] **Step 4: Run the gates**

Run: `npm run typecheck && npx eslint packages apps`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/store.ts
git commit -m "feat(sandbox): edit-mode and tavern-row flags, replayLastCombat

replayLastCombat re-enters the combat phase on the stored CombatResult so
the replay remounts and animates it again. It never re-dispatches the
action that produced the fight: that would resolve a second combat and
advance the run behind a button labelled 'watch that again'."
```

---

### Task 4: The unit editor popover

**Files:**
- Create: `packages/ui/src/UnitEditor.tsx`
- Modify: `packages/ui/src/styles.css` (append a `.uned` block near the other dev-tool surfaces)

**Interfaces:**
- Consumes: `MAX_BOARD` is not needed; `Keyword` (`@game/core`); `BUYABLE_CARDS` (`@game/content`).
- Produces:
  - `UnitEditorValue = { cardId: string; attack: number; health: number; keywords: Keyword[] }`
  - `EDITABLE_KEYWORDS: readonly Keyword[]`
  - `UnitEditor(props: { value: UnitEditorValue; anchor: DOMRect; onChange: (patch: Partial<UnitEditorValue>) => void; onToggleKeyword: (kw: Keyword) => void; onRemove?: () => void; onClose: () => void }): JSX.Element`

- [ ] **Step 1: Write the component**

Create `packages/ui/src/UnitEditor.tsx`:

```tsx
import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BUYABLE_CARDS } from '@game/content';
import type { Keyword } from '@game/core';

/**
 * The sandbox unit editor — a popover anchored to one card, holding everything that can be set about it
 * directly: which card it is, its base attack and health, and its keywords.
 *
 * Presentation only. Every rule (the floors, the uid-preserving card swap, the board clamps) lives in
 * `sandboxEdit.ts`; this component reads a value and reports intent. That is what keeps the rules testable
 * in a repo with no jsdom.
 *
 * Portalled to `<body>` so it escapes the board's stacking contexts — a card sets its own z-index while
 * hovered/dragging, and an editor nested inside one would be clipped by the row it is editing.
 */

export interface UnitEditorValue {
  cardId: string;
  attack: number;
  health: number;
  keywords: Keyword[];
}

/**
 * The keywords worth a toggle. NOT every `Keyword` in the union: several are granted-only bookkeeping that a
 * body cannot meaningfully be given at rest, and offering them would suggest the rig can stage states the
 * sim never produces. These six are the ones that visibly change how a unit fights and how its card reads.
 */
export const EDITABLE_KEYWORDS: readonly Keyword[] = ['T', 'DS', 'V', 'W', 'R', 'C'];

const KEYWORD_LABEL: Record<string, string> = {
  T: 'Taunt', DS: 'Ward', V: 'Venom', W: 'Windfury', R: 'Rise', C: 'Cleave',
};

export function UnitEditor({
  value, anchor, onChange, onToggleKeyword, onRemove, onClose,
}: {
  value: UnitEditorValue;
  /** The edited card's rect, in viewport coordinates — the popover seats itself under it. */
  anchor: DOMRect;
  onChange: (patch: Partial<UnitEditorValue>) => void;
  onToggleKeyword: (kw: Keyword) => void;
  /** Present only for opponent slots, which can be removed; your own row is edited, never emptied here. */
  onRemove?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cards = useMemo(
    () => [...BUYABLE_CARDS].sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ id: c.id, name: c.name })),
    [],
  );

  // Escape closes, and a pointerdown anywhere outside closes. Both on the CAPTURE phase: the board beneath
  // has its own pointerdown handlers (drag, buy), and a bubbling listener would let the click start a drag
  // before the editor ever saw it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const onDown = (e: PointerEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  // Seated under the card, clamped into the viewport so an edit on the rightmost slot doesn't run off-screen.
  const width = 232;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left + anchor.width / 2 - width / 2));
  const top = Math.min(window.innerHeight - 8, anchor.bottom + 6);

  return createPortal(
    <div className="uned" ref={ref} style={{ left, top, width }} onPointerDown={(e) => e.stopPropagation()}>
      <select
        className="uned-card"
        value={value.cardId}
        onChange={(e) => onChange({ cardId: e.target.value })}
        title="Which card this unit is — swapping adopts its printed stats"
      >
        {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div className="uned-stats">
        <label className="uned-num">
          <span>atk</span>
          <input
            type="number" min={0} value={value.attack}
            onChange={(e) => onChange({ attack: Number(e.target.value) })}
          />
        </label>
        <label className="uned-num">
          <span>hp</span>
          <input
            type="number" min={1} value={value.health}
            onChange={(e) => onChange({ health: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="uned-kw">
        {EDITABLE_KEYWORDS.map((kw) => (
          <button
            key={kw}
            className={`uned-kwbtn${value.keywords.includes(kw) ? ' on' : ''}`}
            onClick={() => onToggleKeyword(kw)}
            title={KEYWORD_LABEL[kw] ?? kw}
          >
            {KEYWORD_LABEL[kw] ?? kw}
          </button>
        ))}
      </div>
      {onRemove !== undefined && (
        <button className="uned-remove" onClick={onRemove} title="Remove this unit from the opponent board">
          remove
        </button>
      )}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `packages/ui/src/styles.css`, in the dev-tooling section (after the `.fxwb` rules):

```css
/* ---- SANDBOX UNIT EDITOR (dev) ----
   A popover seated under the card being edited. Portalled to <body>, so it is positioned in viewport
   coordinates by the component; everything here is appearance only. Workshop-slate, matching the tuner
   panels and the FX workbench (DESIGN.md, "The dev tooling surface"). */
.uned {
  position: fixed; z-index: 600; display: flex; flex-direction: column; gap: 6px;
  padding: 8px; border-radius: 8px;
  background: #100d08; border: 1px solid #4a4136; color: #efe7db;
  font-family: var(--font-ui); font-size: 12px;
  box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.8);
}
.uned select, .uned input {
  background: #241f17; border: 1px solid #4a4136; color: #efe7db;
  border-radius: 6px; padding: 4px 6px; font-family: var(--font-ui); font-size: 12px;
}
.uned-card { width: 100%; }
.uned-stats { display: flex; gap: 6px; }
.uned-num { display: flex; align-items: center; gap: 4px; flex: 1; }
.uned-num span { color: #8a7f6d; }
.uned-num input { width: 100%; min-width: 0; }
.uned-kw { display: flex; flex-wrap: wrap; gap: 4px; }
.uned-kwbtn {
  background: #241f17; border: 1px solid #4a4136; color: #8a7f6d;
  border-radius: 6px; padding: 3px 6px; font-family: var(--font-ui); font-size: 11px;
}
.uned-kwbtn.on { color: #100d08; background: #c8a45c; border-color: #c8a45c; }
.uned-remove {
  background: #241f17; border: 1px solid #4a4136; color: #efe7db;
  border-radius: 6px; padding: 4px 6px; font-family: var(--font-ui); font-size: 11px;
}
/* The game cursor, like every other dev surface — without this the popover flickers to the OS hand. */
.uned.uned, .uned.uned * { cursor: url('/cursors/gauntlet_default.svg') 6 2, default; }
.uned.uned button, .uned.uned select, .uned.uned input {
  cursor: url('/cursors/gauntlet_open.svg') 6 2, pointer;
}
.uned.uned input[type="number"] { cursor: url('/cursors/gauntlet_default.svg') 6 2, text; }
```

- [ ] **Step 3: Run the gates**

Run: `npm run typecheck && npx eslint packages apps`
Expected: clean. (No test — this is presentation with no rules of its own, and the repo has no jsdom.)

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/UnitEditor.tsx packages/ui/src/styles.css
git commit -m "feat(sandbox): the unit editor popover

Card picker, base attack and health, keyword toggles. Presentation only —
every rule lives in sandboxEdit.ts. Portalled to <body> so it escapes the
board's stacking contexts, and its dismiss listeners are capture-phase so
a click cannot start a drag underneath before the editor sees it."
```

---

### Task 5: Click-to-edit on your own board

**Files:**
- Modify: `packages/ui/src/Recruit.tsx` (the warband row JSX, currently ~4270; the card pointer-down path, `onCardPointerDown`)

**Interfaces:**
- Consumes: `setCardStats`, `setCardId`, `toggleCardKeyword` (Task 2); `sbEditMode` (Task 3); `UnitEditor`, `UnitEditorValue` (Task 4).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the editor state and the click intercept**

Inside the Recruit component, near the other local state:

```tsx
  // SANDBOX ONLY: which board minion the unit editor is open on, and the rect it is seated under. Held as a
  // uid + rect rather than an element so a re-render (a stat edit is a re-render) can't leave a stale node.
  const sbEditMode = useGame((s) => s.sbEditMode);
  const [sbEditing, setSbEditing] = useState<{ uid: string; rect: DOMRect } | null>(null);
```

In `onCardPointerDown`, before any drag setup:

```tsx
    // Edit mode claims the click outright: a bare pointerdown on a board card otherwise starts a drag, and a
    // drag that begins under an open editor would move the card you are editing.
    if (sbEditMode && run.sandbox) {
      const el = (e.currentTarget as HTMLElement).closest('[data-uid]');
      const uid = el?.getAttribute('data-uid');
      if (uid !== null && uid !== undefined && run.board.some((c) => c.uid === uid)) {
        e.preventDefault();
        e.stopPropagation();
        setSbEditing({ uid, rect: (el as HTMLElement).getBoundingClientRect() });
        return;
      }
    }
```

- [ ] **Step 2: Render the editor**

At the end of the component's JSX, beside the other overlays:

```tsx
      {sbEditing !== null && (() => {
        const card = run.board.find((c) => c.uid === sbEditing.uid);
        if (card === undefined) return null; // it left the board under us — close rather than crash
        const apply = (next: BoardCard[]): void => useGame.setState({ run: { ...run, board: next } });
        return (
          <UnitEditor
            value={{ cardId: card.cardId, attack: card.attack, health: card.health, keywords: card.keywords }}
            anchor={sbEditing.rect}
            onChange={(patch) => {
              if (patch.cardId !== undefined) apply(setCardId(run.board, card.uid, patch.cardId, (id) => CARD_INDEX[id]));
              else apply(setCardStats(run.board, card.uid, patch));
            }}
            onToggleKeyword={(kw) => apply(toggleCardKeyword(run.board, card.uid, kw))}
            onClose={() => setSbEditing(null)}
          />
        );
      })()}
```

- [ ] **Step 3: Add the imports**

```tsx
import { setCardId, setCardStats, toggleCardKeyword } from './sandboxEdit';
import { UnitEditor } from './UnitEditor';
```

`CARD_INDEX` and `BoardCard` are already imported in `Recruit.tsx`; confirm with `grep -n "CARD_INDEX\|BoardCard" packages/ui/src/Recruit.tsx | head -3` and add whichever is missing.

- [ ] **Step 4: Verify in a browser**

Run: `npx vite --port 5402 --strictPort` from `apps/web`, or add an `fx-stage`-style entry to `.claude/launch.json`.
Then: open the app → 🛠️ → Scene Builder → the Edit-mode toggle (Task 6 adds the toggle itself; until then, set it from the console with `useGame.setState({ sbEditMode: true })`) → click a board minion.
Expected: the popover opens under that card; typing 40 in `hp` updates the card's health badge live and leaves it a neutral colour, not buff-green.

- [ ] **Step 5: Run the gates**

Run: `npm run typecheck && npx eslint packages apps && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/Recruit.tsx
git commit -m "feat(sandbox): click a board minion to edit it

Edit mode claims the pointerdown outright — a bare click on a board card
otherwise starts a drag, and a drag beginning under an open editor would
move the card being edited."
```

---

### Task 6: The Shop ⇄ Next enemy toggle, and editing the opponent

**Files:**
- Modify: `packages/ui/src/Recruit.tsx` (the tavern row JSX, currently line 4218)
- Modify: `packages/ui/src/SceneBuilder.tsx` (add an "Editing" section holding both toggles)

**Interfaces:**
- Consumes: `stagedBoard`, `setEnemyStats`, `setEnemyCardId`, `toggleEnemyKeyword`, `addEnemy`, `removeEnemy`, `MAX_BOARD` (Task 2); `sbEditMode`, `sbTavernShowsEnemy` (Task 3); `UnitEditor` (Task 4).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Render the pinned opponent in the tavern row**

In `Recruit.tsx`, the tavern zone currently branches `fighting ? <combat units> : <shop offers>`. Add a third branch ahead of the shop, so the flag only ever affects the recruit phase:

```tsx
          {fighting ? (
            /* …existing combat branch, unchanged… */
          ) : sbTavernShowsEnemy && run.sandbox ? (
            /* SANDBOX: the board pinned for the coming fight, in the row enemies actually occupy — so the
               on-screen distance an effect travels is the distance it will travel in the real fight. */
            (run.servedBoards?.[run.wave]?.minions ?? []).map((m, i) => (
              <Card
                key={`sbfoe-${i}`}
                uid={`sbfoe-${i}`}
                card={{
                  name: CARD_INDEX[m.cardId]?.name ?? m.cardId,
                  cardId: m.cardId,
                  tribe: CARD_INDEX[m.cardId]?.tribe ?? 'neutral',
                  attack: m.attack,
                  health: m.health,
                  keywords: m.keywords ?? [],
                  golden: m.golden ?? false,
                  text: CARD_INDEX[m.cardId]?.text ?? '',
                  tier: CARD_INDEX[m.cardId]?.tier,
                }}
                onPointerDown={onSbEnemyPointerDown}
              />
            ))
          ) : (
            /* …existing shop branch, unchanged… */
          )}
```

Confirm the `CardView` field names against the type before writing this — run `grep -n "interface CardView" -A20 packages/ui/src/Card.tsx` and match it exactly. The list above is the minimum a card needs to render; add any field the type requires.

- [ ] **Step 2: Add the enemy click handler and editor**

```tsx
  const sbTavernShowsEnemy = useGame((s) => s.sbTavernShowsEnemy);
  const [sbEditingFoe, setSbEditingFoe] = useState<{ index: number; rect: DOMRect } | null>(null);

  const sbEnemySnap = run.servedBoards?.[run.wave] ?? null;
  const applyFoe = (next: BoardSnapshot): void =>
    useGame.setState({ run: { ...run, servedBoards: { ...(run.servedBoards ?? {}), [run.wave]: next } } });

  const onSbEnemyPointerDown = (e: React.PointerEvent): void => {
    if (!sbEditMode || !run.sandbox) return;
    const el = (e.currentTarget as HTMLElement).closest('[data-uid]');
    const uid = el?.getAttribute('data-uid') ?? '';
    const index = Number(uid.replace('sbfoe-', ''));
    if (!Number.isInteger(index)) return;
    e.preventDefault();
    e.stopPropagation();
    setSbEditingFoe({ index, rect: (el as HTMLElement).getBoundingClientRect() });
  };
```

And beside the player editor:

```tsx
      {sbEditingFoe !== null && sbEnemySnap !== null && sbEnemySnap.minions[sbEditingFoe.index] !== undefined && (() => {
        const m = sbEnemySnap.minions[sbEditingFoe.index];
        const i = sbEditingFoe.index;
        return (
          <UnitEditor
            value={{ cardId: m.cardId, attack: m.attack, health: m.health, keywords: m.keywords ?? [] }}
            anchor={sbEditingFoe.rect}
            onChange={(patch) => {
              if (patch.cardId !== undefined) applyFoe(setEnemyCardId(sbEnemySnap, i, patch.cardId, (id) => CARD_INDEX[id]));
              else applyFoe(setEnemyStats(sbEnemySnap, i, patch));
            }}
            onToggleKeyword={(kw) => applyFoe(toggleEnemyKeyword(sbEnemySnap, i, kw))}
            onRemove={() => { applyFoe(removeEnemy(sbEnemySnap, i)); setSbEditingFoe(null); }}
            onClose={() => setSbEditingFoe(null)}
          />
        );
      })()}
```

- [ ] **Step 3: Add the Scene Builder controls**

In `SceneBuilder.tsx`, add a section above "Next enemy":

```tsx
          {/* EDITING — the two rig modes. Edit mode arms click-to-edit on both rows; the row toggle decides
              whether the top row shows the shop or the opponent you are about to fight. Both are sandbox-only
              and neither changes run state, so the shop is exactly as you left it when you flip back. */}
          <div className="sb-sec">
            <div className="sb-label">Editing</div>
            <div className="sb-row">
              <button
                className={`sb-btn${sbEditMode ? ' sb-primary' : ''}`}
                onClick={() => setSbEditMode(!sbEditMode)}
                title="Click a minion on either row to set its card, attack, health and keywords"
              >
                {sbEditMode ? '✎ edit mode ON' : 'edit mode'}
              </button>
              <button
                className={`sb-btn${sbTavernShowsEnemy ? ' sb-primary' : ''}`}
                onClick={() => setSbTavernShowsEnemy(!sbTavernShowsEnemy)}
                title="Swap the top row between the shop and the opponent pinned for the coming fight"
              >
                {sbTavernShowsEnemy ? 'showing: enemy' : 'showing: shop'}
              </button>
            </div>
            {sbTavernShowsEnemy && (
              <div className="sb-row">
                <button
                  className="sb-btn"
                  disabled={(run?.servedBoards?.[run.wave]?.minions.length ?? 0) >= MAX_BOARD}
                  onClick={() => {
                    const snap = run?.servedBoards?.[run.wave] ?? stagedBoard(run?.wave ?? 1, []);
                    const first = BUYABLE_CARDS[0];
                    if (first !== undefined) applyFoeFromPanel(addEnemy(snap, first.id, (id) => CARD_INDEX[id]));
                  }}
                >
                  + add enemy
                </button>
                <span className="sb-mini">{run?.servedBoards?.[run.wave]?.minions.length ?? 0} / {MAX_BOARD}</span>
              </div>
            )}
          </div>
```

with, near the panel's other helpers:

```tsx
  const sbEditMode = useGame((s) => s.sbEditMode);
  const setSbEditMode = useGame((s) => s.setSbEditMode);
  const sbTavernShowsEnemy = useGame((s) => s.sbTavernShowsEnemy);
  const setSbTavernShowsEnemy = useGame((s) => s.setSbTavernShowsEnemy);
  const applyFoeFromPanel = (next: BoardSnapshot): void =>
    mutate((r) => ({ ...r, servedBoards: { ...(r.servedBoards ?? {}), [r.wave]: next } }));
```

Note `stagedBoard(wave, [])` produces a zero-minion board; `addEnemy` immediately puts one in it, so the "never empty" rule is never observably violated. If you prefer belt-and-braces, seed with one minion instead of an empty array.

- [ ] **Step 4: Verify in a browser**

Open Scene Builder → **showing: enemy** → the top row shows the pinned opponent (or is empty) → **+ add enemy** → **edit mode ON** → click the new enemy and set it to a real card at 30/30 → flip back to **showing: shop** and confirm the shop is untouched → End Turn.
Expected: the fight uses exactly the units you authored.

- [ ] **Step 5: Run the gates**

Run: `npm run typecheck && npx eslint packages apps && npm test && npm run build:web`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/Recruit.tsx packages/ui/src/SceneBuilder.tsx
git commit -m "feat(sandbox): author the opponent in the tavern row

A toggle swaps the top row between the shop offers and the board pinned
for the coming fight, editable exactly like your own. It writes
servedBoards[wave], which combat reads verbatim — so the board you author
is literally the board that fights."
```

---

### Task 7: Run it again

**Files:**
- Modify: `packages/ui/src/SceneBuilder.tsx` (add the button to the Editing section)

**Interfaces:**
- Consumes: `replayLastCombat` (Task 3).
- Produces: nothing.

- [ ] **Step 1: Add the button**

In the Editing section:

```tsx
            {/* Tuning an effect means watching the same moment many times. This re-mounts the replay on the
                CombatResult already stored — same boards, same seed, same beats — and resolves nothing, so
                the wave stays pinned and the boards you authored survive. */}
            {run?.lastCombat !== undefined && (
              <div className="sb-row">
                <button className="sb-btn sb-primary" onClick={replayLastCombat} title="Watch the last fight again — nothing advances">
                  ↻ run it again
                </button>
              </div>
            )}
```

with `const replayLastCombat = useGame((s) => s.replayLastCombat);` beside the other selectors.

- [ ] **Step 2: Verify in a browser**

Fight once in the sandbox, return to recruit, click **↻ run it again**.
Expected: the same fight animates from the top. Confirm the run did NOT advance: the wave number, Resolve and your board are unchanged after the replay finishes. **This is the step most likely to reveal a defect** — if any of those three move, `replayLastCombat` is reaching resolution and needs narrowing.

- [ ] **Step 3: Run the gates**

Run: `npm run typecheck && npx eslint packages apps && npm test && npm run build:web`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/SceneBuilder.tsx
git commit -m "feat(sandbox): run it again

Re-mounts the replay on the stored CombatResult. Nothing re-simulates and
nothing resolves, so the wave, Resolve and both boards survive."
```

---

### Task 8: Docs and the PR

**Files:**
- Modify: `docs/devlog.md` (prepend), `docs/roadmap.md`, `README.md` (Recent changes)

- [ ] **Step 1: Prepend the devlog entry**

Newest first. Cover: what the rig now is; that the synthetic stage was deleted and why; the base-stats and no-Battlecry rulings; that `servedBoards` is what makes the authored board the fought board; and that a replay resolves nothing. State how it was verified (gates + the browser checks in Tasks 5–7).

- [ ] **Step 2: Update the roadmap**

Strike the "fire a real combat MOMENT on the stage / pick source vs target" line added under the FX-workbench entry on 2026-08-08 — this plan supersedes it. Add anything discovered and deferred (scenario save/load is the likely one).

- [ ] **Step 3: Update the README's Recent changes**

One bullet at the top of the list, in the existing voice.

- [ ] **Step 4: Full gates, then open the PR**

```bash
npm run typecheck && npx eslint packages apps && npm test && npm run build:web
git add docs README.md
git commit -m "docs: sandbox board editor"
git push -u origin feat/sandbox-board-editor
```

Then open the PR, wait for CI's `verify` job to pass, and read `gh pr checks` before merging. Do not merge on pending or failing.

---

## Self-review notes

- **Spec coverage.** Stage deletion → Task 1. Click-to-edit + base stats → Tasks 2, 4, 5. Shop ⇄ enemy toggle + 7-a-side + `servedBoards` → Tasks 2, 6. Replay → Tasks 3, 7. Sandbox gating → Global Constraints, enforced at each call site. The spec's "not building" list is honoured: no in-combat editing, no scenario save/load, no synthetic moments, no Battlecry on placement.
- **Two steps deliberately verify rather than assert.** Task 3 Step 3 checks `combatSettled` exists before relying on it, and Task 6 Step 1 checks `CardView`'s field names. Both are shapes I have not read end-to-end, and a plan that guessed them would send an implementer down a wrong path with false confidence.
- **Task 2 Step 6 expects a test to fail.** Unifying `power` on Σ(attack+health) changes `sandbagBoard`'s output; that is intended, and the step says so rather than letting it look like a regression.
