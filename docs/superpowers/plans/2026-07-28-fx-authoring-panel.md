# The Authoring Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tune an effect against a live combat and press one button to write both the def and its binding — card-only (forking the def) or global (overwriting it).

**Architecture:** A pure `planCommit` decides everything — forked id, blast radius, which binding row — and a thin panel renders it. Live preview works through an in-memory draft def bound via phase ①'s session patch, so iterating costs nothing on disk. Commit writes the def file first and `bindings.json` second, so no failure path can leave a binding pointing at a def that doesn't exist.

**Tech Stack:** TypeScript, React, Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-28-fx-authoring-panel-design.md`

**Worktree:** `.claude/worktrees/fx-phase3`, branch `feat/fx-authoring-panel`, branched off the merged `main` (`16742753`). **Never commit to `main`** — the owner merges.

---

## Background the engineer needs

**The three phases.** ① made "which effect plays at which moment" into data: `packages/ui/src/choreo/bindings.json`, read through `choreo/bindings.ts`, with a live `localStorage` session patch that `bindingFor` consults *before* the committed file. ② built a proc harness that stages a controlled fight and seeks the replay to any moment a chosen card caused. ③ (this) joins them.

**The key mechanic.** `COMMITTED` in `bindings.ts` is parsed **once at module load**, so writing `bindings.json` does not affect the running session until HMR re-evaluates. The session patch *does* apply instantly. That is what makes a live preview possible, and it is why **commit must not call `resetBindings()`** — doing so would make the effect vanish at the moment you committed it.

**A def can only be played by id.** `playDef` resolves ids through the registry in `fx/fxDefs.ts`. `registerSavedDef(def)` overlays a def into the running session's registry **without writing any file** — that is what makes an in-memory draft possible.

**Testing reality.** This repo has **no jsdom and no `@testing-library/react`**; Vitest runs bare Node. **Do not write React component or hook tests — they cannot run.** Pure logic gets real tests; components are covered by typecheck, `build:web`, and a manual browser pass.

**The gate (exactly what CI runs):**
```bash
npm run typecheck && npm run lint && npm test && npm run build:web
```
Lint passes at **0 errors**. There are 3 known pre-existing warnings (`CARD_INDEX` in `SceneBuilder.tsx`, `sellValueOf` in `reducer.ts`, `getSpellBuffFxConfig` in `Recruit.tsx`) — leave them. **Do not use `npm run typecheck:web` as a gate**; it is red on a clean `main` for ~10 pre-existing reasons and is not in CI. Run it only to confirm no reported error names a file you touched.

**Shell discipline.** Prefix every command with an explicit `cd` to `C:\Users\micha\Desktop\ascent\.claude\worktrees\fx-phase3` — the cwd can silently revert to the primary checkout. Verify `git branch --show-current` prints `feat/fx-authoring-panel` before committing. **Never `git add -A`** — list explicit paths.

---

## File Structure

| File | Responsibility |
|---|---|
| **Create** `packages/ui/src/fx/harness/commitPlan.ts` | Pure. Every commit decision: forked id, blast radius, which binding row. |
| **Create** `packages/ui/src/fx/harness/commitPlan.test.ts` | Fork naming + truncation, blast radius, targeting, fanOut, overwrite detection. |
| **Modify** `packages/ui/src/fx/defStore.ts` | Add `saveBindings(json)` — the client for `/__fx/bindings`, which has had none since ①. |
| **Modify** `packages/ui/src/choreo/bindings.ts` | Add `clearBinding(cardId, kind)` — *remove* a patch entry, as distinct from tombstoning it. |
| **Modify** `packages/ui/src/choreo/bindings.test.ts` | Cover `clearBinding` vs the tombstone. |
| **Modify** `packages/ui/src/fx/defStore.test.ts` | Cover `saveBindings`. |
| **Create** `packages/ui/src/fx/harness/CommitPanel.tsx` | The commit UI: scope, resulting id, blast radius, fanOut, button. |
| **Modify** `packages/ui/src/fx/harness/ProcHarness.tsx` | Lift `cardId` to props; a row click selects as well as seeks. |
| **Modify** `packages/ui/src/fx/ui/Workbench.tsx` | Selection state, the draft lifecycle, wiring commit. |
| **Modify** `packages/ui/src/styles.css` | Commit panel + selected-row styling. |
| **Modify** `docs/devlog.md`, `docs/roadmap.md`, `README.md` | Required by CLAUDE.md on every commit. |

Tasks 1 and 2 are independent. Task 3 is independent of both. Task 4 depends on 1. Task 5 depends on everything. Task 6 is the gate and docs.

---

### Task 1: `planCommit` — every commit decision, as a pure function

**Files:**
- Create: `packages/ui/src/fx/harness/commitPlan.ts`
- Create: `packages/ui/src/fx/harness/commitPlan.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/ui/src/fx/harness/commitPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BindingTable } from '../../choreo/bindings';
import { forkId, MAX_SLUG, planCommit, referencesTo } from './commitPlan';

const tables: BindingTable = {
  kinds: {
    buffWave: { def: 'self-buff-gold', fanOut: 'selfBuffed' },
    attackExchange: { def: 'self-buff-gold', fanOut: 'selfBuffed' },
    scCast: { def: 'spell-cast' },
  },
  cards: {
    bloodbinder: { scCast: { def: 'ruby-lance', fanOut: 'damaged' } },
  },
};

const input = (over: Partial<Parameters<typeof planCommit>[0]> = {}): Parameters<typeof planCommit>[0] => ({
  scope: 'card',
  baseId: 'self-buff-gold',
  cardId: 'targetdummy',
  kind: 'buffWave',
  fanOut: 'selfBuffed',
  knownDefIds: ['self-buff-gold', 'spell-cast', 'ruby-lance'],
  tables,
  ...over,
});

describe('forkId', () => {
  it('joins the base and the card', () => {
    expect(forkId('self-buff-gold', 'targetdummy')).toBe('self-buff-gold-targetdummy');
  });

  // The write endpoint enforces ^[a-z0-9][a-z0-9-]{0,63}$. Truncating HERE means an over-long pair is a
  // predictable id shown in the panel before you press anything, instead of a 400 after you do.
  it('truncates to the slug limit', () => {
    const long = forkId('a'.repeat(50), 'b'.repeat(50));
    expect(long.length).toBe(MAX_SLUG);
    expect(long.startsWith('a'.repeat(50))).toBe(true);
  });
});

describe('referencesTo', () => {
  it('finds every kind and card entry pointing at a def', () => {
    expect(referencesTo(tables, 'self-buff-gold')).toEqual([
      { cardId: null, kind: 'buffWave' },
      { cardId: null, kind: 'attackExchange' },
    ]);
    expect(referencesTo(tables, 'ruby-lance')).toEqual([{ cardId: 'bloodbinder', kind: 'scCast' }]);
  });

  it('returns empty for a def nothing points at', () => {
    expect(referencesTo(tables, 'nobody-uses-me')).toEqual([]);
  });
});

describe('planCommit — card scope', () => {
  it('forks the def and targets the card row', () => {
    const p = planCommit(input());
    expect(p.defId).toBe('self-buff-gold-targetdummy');
    expect(p.forkedFrom).toBe('self-buff-gold');
    expect(p.bindingTarget).toEqual({ cardId: 'targetdummy', kind: 'buffWave' });
  });

  // THE point of forking. A fresh fork is referenced by nothing, so committing it cannot disturb any other
  // card — which is exactly what "card-only" has to guarantee.
  it('affects nothing else, because the forked def is new', () => {
    expect(planCommit(input()).alsoAffects).toEqual([]);
  });

  it('reports an existing fork as an overwrite, not a new def', () => {
    const p = planCommit(input({ knownDefIds: ['self-buff-gold-targetdummy'] }));
    expect(p.overwritesExisting).toBe(true);
    expect(planCommit(input()).overwritesExisting).toBe(false);
  });
});

describe('planCommit — global scope', () => {
  it('writes the base id and targets the kind row', () => {
    const p = planCommit(input({ scope: 'global' }));
    expect(p.defId).toBe('self-buff-gold');
    expect(p.forkedFrom).toBeNull();
    expect(p.bindingTarget).toEqual({ cardId: null, kind: 'buffWave' });
  });

  // The blast radius, and the reason it excludes the row being written: "also affects" must mean OTHER
  // places, or the panel would always report at least one and the number would be meaningless.
  it('reports the other places the overwritten def is bound, excluding the target row', () => {
    const p = planCommit(input({ scope: 'global' }));
    expect(p.alsoAffects).toEqual([{ cardId: null, kind: 'attackExchange' }]);
  });
});

describe('planCommit — fanOut', () => {
  it('carries a non-default fanOut into the binding', () => {
    expect(planCommit(input({ fanOut: 'damaged' })).binding).toEqual({
      def: 'self-buff-gold-targetdummy',
      fanOut: 'damaged',
    });
  });

  // `primary` is the default, so it is written as an ABSENT key — matching every entry in bindings.json
  // that doesn't fan out. Writing it explicitly would work but would make the committed file noisier than
  // the ones already there.
  it('omits fanOut entirely when it is primary or unset', () => {
    expect(planCommit(input({ fanOut: 'primary' })).binding).toEqual({ def: 'self-buff-gold-targetdummy' });
    expect(planCommit(input({ fanOut: undefined })).binding).toEqual({ def: 'self-buff-gold-targetdummy' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

`cd` to the worktree, then: `npx vitest run packages/ui/src/fx/harness/commitPlan.test.ts`
Expected: FAIL — `Failed to resolve import "./commitPlan"`.

- [ ] **Step 3: Implement**

Create `packages/ui/src/fx/harness/commitPlan.ts`:

```ts
import type { BindingTable, FxBinding } from '../../choreo/bindings';
import type { MomentKind } from '../../choreo/kinds';

/**
 * What a "commit animation" would write — decided as pure data, before anything is written.
 *
 * Every decision lives here so every decision is testable: this repo has no jsdom, so anything left in the
 * panel is untestable by construction. The blast radius especially — "which other cards inherit this
 * change" is not a question to answer by eye, and getting it wrong means silently restyling effects the
 * author never looked at.
 */

/** The write endpoint enforces `^[a-z0-9][a-z0-9-]{0,63}$`; a forked id is truncated to fit. */
export const MAX_SLUG = 64;

/** One place a binding lives: a kind row (`cardId: null`) or a card's row. */
export interface CommitRef {
  cardId: string | null;
  kind: MomentKind;
}

export interface CommitInput {
  scope: 'card' | 'global';
  /** The editor's name field, slugified. The def id for a global commit; the fork's stem for a card one. */
  baseId: string;
  cardId: string;
  kind: MomentKind;
  fanOut: FxBinding['fanOut'];
  /** Ids already in the registry — decides `overwritesExisting`. */
  knownDefIds: readonly string[];
  /** The live tables (`effectiveTables()`), for the blast radius. */
  tables: BindingTable;
}

export interface CommitPlan {
  scope: 'card' | 'global';
  /** What gets written: the forked id under card scope, `baseId` under global. */
  defId: string;
  /** The def this forked from, or null for a plain write. */
  forkedFrom: string | null;
  /** True when `defId` already exists — a re-tune, not a new def. */
  overwritesExisting: boolean;
  binding: FxBinding;
  bindingTarget: CommitRef;
  /** Every OTHER place `defId` is referenced. Empty for a fresh fork — which is the point of forking. */
  alsoAffects: CommitRef[];
}

/**
 * `<base>-<card>`, truncated to the slug limit.
 *
 * Truncating here rather than letting the endpoint reject it means an over-long pair becomes a predictable
 * id, shown in the panel before the author presses anything, instead of a 400 afterwards.
 */
export function forkId(baseId: string, cardId: string): string {
  return `${baseId}-${cardId}`.slice(0, MAX_SLUG);
}

/** Every binding row pointing at `defId`, kind rows first then card rows. */
export function referencesTo(tables: BindingTable, defId: string): CommitRef[] {
  const out: CommitRef[] = [];
  for (const [kind, b] of Object.entries(tables.kinds)) {
    if (b?.def === defId) out.push({ cardId: null, kind: kind as MomentKind });
  }
  for (const [cardId, byKind] of Object.entries(tables.cards)) {
    for (const [kind, b] of Object.entries(byKind)) {
      if (b?.def === defId) out.push({ cardId, kind: kind as MomentKind });
    }
  }
  return out;
}

export function planCommit(input: CommitInput): CommitPlan {
  const card = input.scope === 'card';
  const defId = card ? forkId(input.baseId, input.cardId) : input.baseId;
  const bindingTarget: CommitRef = { cardId: card ? input.cardId : null, kind: input.kind };
  // `primary` is the default, so it serialises as an ABSENT key — matching every non-fanning entry already
  // in bindings.json rather than making the committed file noisier than the ones beside it.
  const binding: FxBinding =
    input.fanOut === undefined || input.fanOut === 'primary' ? { def: defId } : { def: defId, fanOut: input.fanOut };
  return {
    scope: input.scope,
    defId,
    forkedFrom: card ? input.baseId : null,
    overwritesExisting: input.knownDefIds.includes(defId),
    binding,
    bindingTarget,
    // The row being written is excluded: "also affects" has to mean OTHER places, or the count would
    // always be at least one and would tell the author nothing.
    alsoAffects: referencesTo(input.tables, defId).filter(
      (r) => !(r.cardId === bindingTarget.cardId && r.kind === bindingTarget.kind),
    ),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

`npx vitest run packages/ui/src/fx/harness/commitPlan.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/harness/commitPlan.ts packages/ui/src/fx/harness/commitPlan.test.ts
git commit -m "feat(fx): plan a commit as pure data before writing anything

Forked id, blast radius, which binding row, whether this overwrites an
existing def -- all decided in one pure function, because this repo has
no jsdom and anything left in the panel cannot be tested.

alsoAffects excludes the row being written, so the number means OTHER
places and is worth reading; a fresh fork reports zero, which is the
guarantee card-only scope exists to make.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The two module additions the panel needs

**Files:**
- Modify: `packages/ui/src/fx/defStore.ts`
- Modify: `packages/ui/src/fx/defStore.test.ts`
- Modify: `packages/ui/src/choreo/bindings.ts`
- Modify: `packages/ui/src/choreo/bindings.test.ts`

Two small gaps. `/__fx/bindings` has existed since phase ① with **no client**. And tearing down a draft needs to *remove* a patch entry, which `setBinding(…, null)` does not do — that writes a **tombstone** meaning "plays nothing", which is a different thing and would leave the card silent instead of restored.

- [ ] **Step 1: Write the failing tests**

In `packages/ui/src/fx/defStore.test.ts`, **first read how the existing `saveDef` test stubs `fetch`** and match it exactly. Then add, in the same style:

```ts
describe('saveBindings', () => {
  it('posts the json to the bindings endpoint', async () => {
    // …stub fetch exactly as the saveDef test does, capturing the URL and body…
    const result = await saveBindings('{"version":1,"kinds":{},"cards":{}}');
    expect(result.ok).toBe(true);
    // assert the URL was '/__fx/bindings' and the body was { json: '…' }
  });

  it('fails closed with a readable reason when there is no dev server', async () => {
    // …the same "unavailable" path the saveDef test exercises…
  });
});
```

In `packages/ui/src/choreo/bindings.test.ts`, add:

```ts
describe('clearBinding', () => {
  beforeEach(() => resetBindings());

  // The distinction this function exists for. A tombstone says "this card plays NOTHING here" and stops
  // resolution; clearing says "I have no opinion", so the file's own binding applies again. Tearing down a
  // draft needs the second — the first would leave the card silent instead of restored.
  it('removes an override, restoring the file binding — unlike a tombstone', () => {
    setBinding('bloodbinder', 'scCast', { def: 'test-red-blast' });
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'test-red-blast' });

    clearBinding('bloodbinder', 'scCast');
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });

    setBinding('bloodbinder', 'scCast', null); // tombstone, for contrast
    expect(bindingFor('bloodbinder', 'scCast')).toBeNull();
  });

  it('clears a kind-level override', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    clearBinding(null, 'scCast');
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('is a no-op when nothing was overridden', () => {
    clearBinding('bloodbinder', 'scCast');
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  it('persists the removal, so a reload does not resurrect the override', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    clearBinding(null, 'scCast');
    expect(localStorage.getItem('ascent.fxBindings') ?? '').not.toContain('test-red-blast');
  });
});
```

The last case needs the same `withLocalStorage` stub the existing persistence test in that file uses — Vitest runs bare Node here, so there is no global `localStorage`. **Read that test and reuse its helper**; do not invent a second one.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run packages/ui/src/fx/defStore.test.ts packages/ui/src/choreo/bindings.test.ts
```
Expected: FAIL — `saveBindings is not a function`, `clearBinding is not a function`.

- [ ] **Step 3: Implement `saveBindings`**

In `packages/ui/src/fx/defStore.ts`, add directly after `saveDef`:

```ts
/**
 * Commit the whole binding table to `packages/ui/src/choreo/bindings.json`.
 *
 * Takes the serialised text (from `bindingsJson()`) rather than an object, mirroring `saveDef`'s `json`
 * field — the endpoint re-serialises whatever it is given, so what lands on disk is stably formatted
 * regardless of the caller.
 *
 * Unlike `saveDef` there is no id to validate: the destination path is fixed by the plugin and never
 * derived from the request, so the traversal question `saveDef`'s slug check answers does not arise here.
 */
export async function saveBindings(json: string): Promise<SaveResult> {
  return post('/__fx/bindings', { json });
}
```

- [ ] **Step 4: Implement `clearBinding`**

In `packages/ui/src/choreo/bindings.ts`, add directly after `setBinding`:

```ts
/**
 * Drop a session override so the committed file applies again.
 *
 * NOT the same as `setBinding(cardId, kind, null)`. That writes a TOMBSTONE — an explicit "this plays
 * nothing here" that stops resolution falling through to the file. This removes the entry entirely, which
 * is what tearing down a preview needs: the author's draft should leave no trace, and the card should go
 * back to whatever it played before, not go silent.
 */
export function clearBinding(cardId: string | null, kind: MomentKind): void {
  if (cardId === null) {
    const kinds = { ...patch.kinds };
    delete kinds[kind];
    patch = { ...patch, kinds };
  } else {
    const byKind = { ...patch.cards[cardId] };
    delete byKind[kind];
    const cards = { ...patch.cards };
    // Drop the card entirely once it has no overrides left, so the persisted patch doesn't accumulate
    // empty objects across a long session.
    if (Object.keys(byKind).length > 0) cards[cardId] = byKind;
    else delete cards[cardId];
    patch = { ...patch, cards };
  }
  savePatch();
}
```

- [ ] **Step 5: Run to verify they pass**

```bash
npx vitest run packages/ui/src/fx/defStore.test.ts packages/ui/src/choreo/bindings.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/fx/defStore.ts packages/ui/src/fx/defStore.test.ts packages/ui/src/choreo/bindings.ts packages/ui/src/choreo/bindings.test.ts
git commit -m "feat(fx): a client for the bindings endpoint, and clearBinding

/__fx/bindings has existed since phase 1 with no caller; saveBindings is
that caller, mirroring saveDef.

clearBinding removes a session override, which setBinding(..., null) does
NOT do -- that writes a tombstone meaning 'plays nothing'. Tearing down a
draft preview needs removal, or the card goes silent instead of going
back to what it played before.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The harness reports its selection

**Files:**
- Modify: `packages/ui/src/fx/harness/ProcHarness.tsx`
- Modify: `packages/ui/src/styles.css`

`ProcHarness` currently keeps `cardId` in local state and hands nothing back, so the workbench cannot know what to commit for. Lift it, and make a row click *select* as well as seek.

No test — component, no jsdom. Keep it mechanical.

- [ ] **Step 1: Change the props**

Replace the `ProcHarnessProps` interface and the component signature:

```tsx
export interface ProcHarnessProps {
  /** Jump the live replay to a moment index (from `useCombatReplay`). */
  onSeek: (index: number) => void;
  /** The fight currently loaded in the replay, or null when none has been staged yet. */
  combat: RunState['lastCombat'];
  /**
   * The selected card, lifted OUT of this component so the workbench can commit for it. Was local state
   * until phase ③: the commit panel needs `(cardId, kind)`, and the harness is where both are chosen.
   */
  cardId: string;
  onCardChange: (cardId: string) => void;
  /** The moment kind whose row was last clicked — the commit target. Null until one is picked. */
  selectedKind: MomentKind | null;
  onSelectMoment: (kind: MomentKind) => void;
}

export function ProcHarness({
  onSeek, combat, cardId, onCardChange, selectedKind, onSelectMoment,
}: ProcHarnessProps): React.ReactElement {
```

Delete the `const [cardId, setCardId] = useState('');` line. Replace every `setCardId(...)` with `onCardChange(...)`. Add the `MomentKind` type import from `../../choreo/kinds` if absent.

- [ ] **Step 2: A row click selects and seeks**

Replace the row `<button>`'s `onClick` and className:

```tsx
          <button
            key={p.index}
            className={`fxharness-row${p.kind === selectedKind ? ' fxharness-row-sel' : ''}`}
            onClick={() => { onSelectMoment(p.kind); onSeek(Math.max(0, p.index - runUp)); }}
          >
```

Selecting and seeking together is deliberate: the moment you just watched is the moment you want to commit for, so the author never has to make the connection twice.

- [ ] **Step 3: Style the selected row**

In `packages/ui/src/styles.css`, directly after the existing `.fxharness-row:hover` rule:

```css
/* The row last clicked — the commit target. Distinct from :hover, which is only where the pointer is. */
.fxharness-row-sel { border-color: #6f5bd0; background: #2a2340; }
```

- [ ] **Step 4: Confirm it compiles**

```bash
npm run typecheck:web 2>&1 | grep "harness/" || echo "no errors in harness/"
```
Expected: `no errors in harness/`. It will report ~10 unrelated pre-existing errors elsewhere — ignore those.

`Workbench.tsx` will not compile until Task 5 supplies the new props. That is expected; `npm run build:web` will fail until then, so **do not run it as a gate for this task**.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/fx/harness/ProcHarness.tsx packages/ui/src/styles.css
git commit -m "refactor(fx): the harness reports its card and moment selection

cardId lifts to props and a row click now selects as well as seeks, so
the commit panel can address (cardId, kind) without the author making
the connection twice. Workbench does not compile until it supplies the
new props -- that lands in the wiring task.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The commit panel

**Files:**
- Create: `packages/ui/src/fx/harness/CommitPanel.tsx`
- Modify: `packages/ui/src/styles.css`

Thin by design — all decisions come in as a `CommitPlan`.

- [ ] **Step 1: Write the component**

Create `packages/ui/src/fx/harness/CommitPanel.tsx`:

```tsx
import { CARD_INDEX } from '@game/content';
import type { FxBinding } from '../../choreo/bindings';
import type { CommitPlan } from './commitPlan';

/**
 * The "commit animation" control: turn the live draft into a committed def plus a committed binding.
 *
 * Renders a `CommitPlan` and nothing else — every decision was made in `planCommit`, which is pure and
 * tested. This repo has no jsdom, so logic left here could not be tested at all.
 */
export interface CommitPanelProps {
  /** Null when a card or a moment has yet to be chosen — the button explains which. */
  plan: CommitPlan | null;
  missing: string | null;
  scope: 'card' | 'global';
  onScopeChange: (scope: 'card' | 'global') => void;
  fanOut: FxBinding['fanOut'];
  onFanOutChange: (fanOut: FxBinding['fanOut']) => void;
  busy: boolean;
  error: string | null;
  note: string | null;
  onCommit: () => void;
}

const FAN_OUTS: NonNullable<FxBinding['fanOut']>[] = ['primary', 'damaged', 'selfBuffed'];

const refLabel = (cardId: string | null, kind: string): string =>
  cardId === null ? `every ${kind}` : `${CARD_INDEX[cardId]?.name ?? cardId} · ${kind}`;

export function CommitPanel({
  plan, missing, scope, onScopeChange, fanOut, onFanOutChange, busy, error, note, onCommit,
}: CommitPanelProps): React.ReactElement {
  return (
    <div className="fxcommit">
      <div className="fxcommit-h">Commit animation</div>

      <div className="fxcommit-scope">
        <label>
          <input type="radio" checked={scope === 'card'} onChange={() => onScopeChange('card')} />
          This card only
        </label>
        <label>
          <input type="radio" checked={scope === 'global'} onChange={() => onScopeChange('global')} />
          Everywhere
        </label>
      </div>

      <label htmlFor="fxcommit-fanout" title="How many copies play, and on which units">Plays</label>
      <select
        id="fxcommit-fanout"
        value={fanOut ?? 'primary'}
        onChange={(e) => onFanOutChange(e.target.value as NonNullable<FxBinding['fanOut']>)}
      >
        <option value="primary">once, between the moment&apos;s two units</option>
        <option value="damaged">once per enemy damaged</option>
        <option value="selfBuffed">once per unit that buffed itself</option>
      </select>

      {plan !== null && (
        <div className="fxcommit-plan">
          <div>
            Writes <code>{plan.defId}.json</code>
            {plan.overwritesExisting && <span className="fxcommit-warn"> · overwrites existing</span>}
            {plan.forkedFrom !== null && <span className="fxcommit-note"> · forked from {plan.forkedFrom}</span>}
          </div>
          <div>Binds {refLabel(plan.bindingTarget.cardId, plan.bindingTarget.kind)}</div>
          {/* The blast radius. Shown BEFORE the button rather than confirmed after, because "I overwrote the
              shared one by accident" is unrecoverable once you've forgotten which numbers you changed. */}
          {plan.alsoAffects.length > 0 && (
            <div className="fxcommit-warn">
              Also changes: {plan.alsoAffects.map((r) => refLabel(r.cardId, r.kind)).join(', ')}
            </div>
          )}
        </div>
      )}

      <button className="fxwb-btn" disabled={busy || plan === null} onClick={onCommit}>
        {busy ? 'Committing…' : 'Commit animation'}
      </button>
      {missing !== null && <p className="fxcommit-missing">{missing}</p>}
      {error !== null && <p className="fxcommit-error">{error}</p>}
      {note !== null && <p className="fxcommit-note">{note}</p>}
    </div>
  );
}
```

Note `FAN_OUTS` is declared for the type it pins but the `<select>` lists its options literally, so each can carry prose. If lint flags `FAN_OUTS` as unused, delete the constant.

- [ ] **Step 2: Style it**

Append to `packages/ui/src/styles.css`, after the `.fxharness-*` rules:

```css
/* Commit panel — sits under the harness in the rail. */
.fxcommit { display: flex; flex-direction: column; gap: 6px; margin-top: 12px;
  padding-top: 12px; border-top: 1px solid #2c2740; }
.fxcommit-h { font-weight: 600; letter-spacing: 0.02em; }
.fxcommit-scope { display: flex; gap: 12px; }
.fxcommit-scope label { display: flex; align-items: center; gap: 4px; }
.fxcommit-plan { display: flex; flex-direction: column; gap: 3px;
  padding: 6px 8px; border-radius: 4px; background: #1e1a2b; font-size: 0.9em; line-height: 1.4; }
.fxcommit-plan code { font-family: ui-monospace, monospace; }
.fxcommit-warn { color: #e0a24a; }
.fxcommit-note { opacity: 0.75; }
.fxcommit-error { color: #e06a6a; }
.fxcommit-missing { opacity: 0.7; font-size: 0.9em; }
```

- [ ] **Step 3: Confirm it compiles**

```bash
npm run typecheck:web 2>&1 | grep "CommitPanel" || echo "no errors in CommitPanel"
```
Expected: `no errors in CommitPanel`.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/fx/harness/CommitPanel.tsx packages/ui/src/styles.css
git commit -m "feat(fx): the commit panel — scope, blast radius, one button

Renders a CommitPlan and nothing else; every decision was made in the
pure planner. The blast radius is shown BEFORE the button rather than
confirmed after, because overwriting a shared def by accident is
unrecoverable once you have forgotten which numbers you changed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The draft lifecycle and the wiring

**Files:**
- Modify: `packages/ui/src/fx/ui/Workbench.tsx`

The task that makes it work. Read `Workbench.tsx`'s existing `save()` handler (~line 1134) first — the commit executor mirrors its shape and reuses its `toStoredDef` / `registerSavedDef` / `refreshLibrary` calls.

- [ ] **Step 1: Selection state and the draft id**

Add near the other `useState`s (~line 220, beside `railMode`):

```tsx
  // The harness's selection, lifted here so the commit panel can address it (see ProcHarnessProps).
  const [harnessCard, setHarnessCard] = useState('');
  const [harnessKind, setHarnessKind] = useState<MomentKind | null>(null);
  const [commitScope, setCommitScope] = useState<'card' | 'global'>('card');
  const [commitFanOut, setCommitFanOut] = useState<FxBinding['fanOut']>('primary');
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitNote, setCommitNote] = useState<string | null>(null);
```

And at module scope, above the component:

```tsx
/**
 * The id the in-memory draft is registered under while tuning against a live card.
 *
 * ONE fixed id, because one draft exists at a time — you are tuning one effect for one card. A generated or
 * name-derived id would leave a trail of stale overlays in the registry every time the name field changed,
 * and would make "is what I'm watching saved?" impossible to answer from a console line. Never written to
 * disk: `registerSavedDef` overlays it in memory only, and commit calls `saveDef` with the real id.
 */
const DRAFT_ID = 'fx-draft';
```

- [ ] **Step 2: Keep the draft in sync**

Add an effect after the state declarations:

```tsx
  // While rail mode has a card AND a moment selected, the editor's current composition IS what that card
  // plays — registered in memory under DRAFT_ID and bound through the session patch, which `bindingFor`
  // consults before the committed file. Nothing touches disk; re-seek the moment and you see the edit.
  useEffect(() => {
    if (!railMode || harnessCard === '' || harnessKind === null) return;
    registerSavedDef(toStoredDef(DRAFT_ID, durationMs, toStoredLayers(layers, artRefs), seedLocked ? seed : undefined));
    setBinding(harnessCard, harnessKind, commitFanOut === 'primary' || commitFanOut === undefined
      ? { def: DRAFT_ID }
      : { def: DRAFT_ID, fanOut: commitFanOut });
  }, [railMode, harnessCard, harnessKind, layers, durationMs, seed, seedLocked, commitFanOut, artRefs]);

  // Tearing the draft down uses `clearBinding`, NOT `setBinding(..., null)`: the latter writes a tombstone
  // meaning "plays nothing", which would leave the card silent rather than restoring what it played before.
  useEffect(() => {
    if (railMode) return;
    if (harnessCard !== '' && harnessKind !== null) clearBinding(harnessCard, harnessKind);
  }, [railMode, harnessCard, harnessKind]);
```

**Read the existing `save()` handler to get `toStoredLayers(layers, artRefs)` exactly right** — the artRefs argument name and shape must match what `save()` passes.

- [ ] **Step 3: Prefill `fanOut` from what is already playing**

Add an effect that runs when the selection changes:

```tsx
  // Inherit the fanOut of whatever plays there now. The wrong value is a silent failure — a self-buff
  // effect set to `primary` plays once on whichever unit came first and not at all on the others — so the
  // default is "what is already working here", not a fixed guess.
  useEffect(() => {
    if (harnessCard === '' || harnessKind === null) return;
    setCommitFanOut(bindingFor(harnessCard, harnessKind)?.fanOut ?? 'primary');
  }, [harnessCard, harnessKind]);
```

- [ ] **Step 4: Build the plan and the executor**

```tsx
  const commitPlan = useMemo(() => {
    if (harnessCard === '' || harnessKind === null) return null;
    const baseId = slugify(defName);
    if (!isValidSlug(baseId)) return null;
    return planCommit({
      scope: commitScope,
      baseId,
      cardId: harnessCard,
      kind: harnessKind,
      fanOut: commitFanOut,
      knownDefIds: defs.map((d) => d.id),
      tables: effectiveTables(),
    });
  }, [harnessCard, harnessKind, defName, commitScope, commitFanOut, defs]);

  const commitMissing =
    harnessCard === '' ? 'Pick a card in the harness first.'
    : harnessKind === null ? 'Click a moment row to choose what this effect plays on.'
    : !isValidSlug(slugify(defName)) ? 'Give the effect a name first.'
    : null;

  /**
   * Write the def, THEN the binding. Never the reverse: a binding written first with the def write failing
   * would point at a def that does not exist, which resolves to nothing and looks exactly like the tool
   * being broken. In this order a def failure changes nothing at all, and a binding failure leaves only an
   * unbound def file — a library entry that nothing plays.
   *
   * Deliberately does NOT call `resetBindings()`. The committed file does not reach `COMMITTED` until HMR
   * re-evaluates the module, so dropping the session patch here would make the effect vanish at the exact
   * moment it was committed. The patch is cleared on leaving rail mode, by which point the file is
   * authoritative.
   */
  const commit = async (): Promise<void> => {
    const plan = commitPlan;
    if (plan === null) return;
    setCommitting(true);
    setCommitError(null);
    setCommitNote(null);
    const stored = toStoredDef(plan.defId, durationMs, toStoredLayers(layers, artRefs), seedLocked ? seed : undefined);
    const defResult = await saveDef(stored);
    if (!defResult.ok) {
      setCommitError(`Def not written — nothing changed. ${defResult.error}`);
      setCommitting(false);
      return;
    }
    registerSavedDef(stored);
    refreshLibrary();
    setBinding(plan.bindingTarget.cardId, plan.bindingTarget.kind, plan.binding);
    const bindResult = await saveBindings(bindingsJson());
    setCommitting(false);
    if (!bindResult.ok) {
      setCommitError(`Def saved, but the binding was not written: ${bindResult.error}`);
      return;
    }
    setDefName(plan.defId);
    setCommitNote(`Committed → ${plan.defId} · ${bindResult.path}`);
  };
```

- [ ] **Step 5: Render it and pass the harness its props**

Replace the rail-mode render block:

```tsx
      {railMode && (
        <>
          <ProcHarness
            onSeek={seekReplay}
            combat={lastCombat}
            cardId={harnessCard}
            onCardChange={setHarnessCard}
            selectedKind={harnessKind}
            onSelectMoment={setHarnessKind}
          />
          <CommitPanel
            plan={commitPlan}
            missing={commitMissing}
            scope={commitScope}
            onScopeChange={setCommitScope}
            fanOut={commitFanOut}
            onFanOutChange={setCommitFanOut}
            busy={committing}
            error={commitError}
            note={commitNote}
            onCommit={() => void commit()}
          />
        </>
      )}
```

`CommitPanel` must render **inside** the `.fxharness` rail so it inherits `pointer-events: auto`. If it sits outside, it is completely inert — `.fxwb` is `pointer-events: none` and that exact bug shipped once in the library browser. **Check this in the browser, don't assume.** If it needs its own opt-in, add `.fxcommit { pointer-events: auto; }`.

Add the imports: `planCommit` from `../harness/commitPlan`, `CommitPanel` from `../harness/CommitPanel`, `bindingFor`/`setBinding`/`clearBinding`/`bindingsJson`/`effectiveTables`/`type FxBinding` from `../../choreo/bindings`, `saveBindings` from `../defStore`, `type MomentKind` from `../../choreo/kinds`.

- [ ] **Step 6: Browser verification — this task cannot be verified any other way**

Start the dev server from the worktree (`npm run dev`) and **read the port it prints**. Then, reporting exactly what you saw at each step:

1. Dev menu → 🎨 FX Workbench → **Watch in combat**. Is the commit panel visible under the harness, and are its controls **clickable**? (If not, the `pointer-events` note above.)
2. Before picking anything, does the button say what's missing?
3. Put a card on the board, pick it, **Stage fight**, click a moment row. Does the row highlight as selected, and does the plan appear naming a def id?
4. **Change a slider in the editor, then click the same row again.** Does the card play the changed effect? (This is the whole feature — an in-memory draft, no save.)
5. Switch scope to **Everywhere**. Does the def id change from the forked one to the plain one, and does a blast-radius line appear if that def is bound elsewhere?
6. Press **Commit animation** with card scope. Check the def file appeared in `packages/ui/src/fx/defs/`, and that `packages/ui/src/choreo/bindings.json` gained the card row. Does the note report both?
7. Leave rail mode, re-enter, re-stage. Does the card still play it — now from the committed file rather than the draft?

If any step fails, fix it and re-check. **Do not commit a version you have not seen work.**

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/fx/ui/Workbench.tsx
git commit -m "feat(fx): commit animation — the live draft becomes a committed binding

While a card and moment are selected, the editor's composition is
registered in memory under a fixed draft id and bound through the session
patch, so iterating costs nothing on disk. Commit writes the def file
first and bindings.json second, so no failure can leave a binding
pointing at a def that does not exist.

Does NOT reset the session patch at commit time: the file does not reach
COMMITTED until HMR re-evaluates, so clearing the patch would make the
effect vanish at the moment it was committed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Gate and docs

**Files:**
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `README.md`, `docs/fx-workbench-guide.md`

- [ ] **Step 1: Run the gate**

```bash
npm run typecheck && npm run lint && npm test && npm run build:web
```
Expected: typecheck clean; lint 0 errors with the 3 known warnings; ~2791 + your new tests passing; build succeeds. If anything fails, **stop and report**.

- [ ] **Step 2: Devlog**

Prepend to `docs/devlog.md`, matching the voice of the two most recent entries:

```markdown
## 2026-07-28 — commit animation: the authoring loop closes

**What changed.** Phase ③, the last. In the workbench's rail mode, picking a card and a moment now makes the
editor's current composition *what that card plays* — registered in memory under a fixed draft id and bound
through phase ①'s session patch, which `bindingFor` consults before the committed file. Tune a slider,
re-seek the moment, watch the real card. Nothing touches disk until **Commit animation**, which writes the
def file and the binding together.

**Card-only scope forks the def, and that is the whole point.** Binding a shared def card-scoped after
editing it would change that effect for every card using it — the opposite of what the button says. So card
scope writes `<name>-<card>.json` and binds only that card's row; global scope overwrites the def in place
and binds the kind row. The panel shows the resulting id and the blast radius *before* you press anything,
because "I overwrote the shared one by accident" is unrecoverable once you've forgotten which numbers you
changed.

**The commit order is fixed, not incidental.** Def file first, `bindings.json` second. A def failure changes
nothing at all; a binding failure leaves only an unbound def file, which is a library entry nothing plays.
Neither path can leave a binding pointing at a def that does not exist — the signature failure of this
subsystem, removed by construction rather than by care.

**Two things the phase needed that didn't exist.** `/__fx/bindings` had been sitting there since ① with no
client, so `saveBindings` is that client. And tearing down a draft needs `clearBinding` — `setBinding(…,
null)` writes a *tombstone* meaning "plays nothing", which would leave the card silent instead of restoring
what it played before. That distinction is now tested directly against each other.

**`fanOut` prefills rather than defaulting.** A binding decides how many copies play and on which units, and
the wrong value fails silently — a self-buff effect set to `primary` plays once on whichever unit came first
and not at all on the others. So it inherits from `bindingFor(cardId, kind)`: whatever is already working
there. Only a genuinely new binding falls back to `primary`, and the control stays visible either way.

**Deliberately not done: `resetBindings()` at commit time.** The committed file doesn't reach `COMMITTED`
until HMR re-evaluates the module, so dropping the patch at commit would make the effect vanish at the exact
moment it was committed. The patch is cleared on leaving rail mode instead.

**How it was verified.** `planCommit` has real unit tests — fork naming and truncation, blast radius over a
table with several references, card-vs-global targeting, `fanOut` omission for the default, and overwrite
detection. `clearBinding` is tested directly against the tombstone it is not. The panel has none (no jsdom
in this repo) and is thin enough that this costs nothing. The full loop was walked in a browser: draft
preview updating on a slider change, scope switching the id, commit landing both files, and the card still
playing it after leaving and re-entering rail mode. Full gate green.

**Follow-ups.** Editing a def's `label`/`tags` from the panel (the library browser reads them; authoring them
is its own small feature). An unbind affordance — `setBinding(…, null)` works but a delete needs its own
confirmation design. And the auto-pause after a seeked moment, still unbuilt from phase ②.
```

- [ ] **Step 3: Roadmap**

In `docs/roadmap.md`, remove the phase ③ entry from **Now** and record all three phases as shipped. Read the file first and match its structure.

- [ ] **Step 4: README**

Add at the top of **Recent changes**:

```markdown
- **Commit animation.** Pick a card and a moment in the workbench, tune the effect while watching it on the
  real card, then commit — writing the effect and its binding together, for that card only (forking it) or
  everywhere.
```

- [ ] **Step 5: The guide**

`docs/fx-workbench-guide.md` §7 currently says binding is hand-edited with "There is no UI for this yet; that's phase ③". Replace that with the real flow, and note that hand-editing still works.

- [ ] **Step 6: Commit and push**

```bash
git add docs/devlog.md docs/roadmap.md README.md docs/fx-workbench-guide.md
git commit -m "docs: devlog + roadmap + README + guide for commit animation

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin feat/fx-authoring-panel
```

Then open a PR with `gh` (full path `/c/Program Files/GitHub CLI/gh.exe`). **Do not merge** — the owner merges.

---

## Self-review notes

**Spec coverage.** Draft mechanism → T5 Step 2. Fork-on-card-scope → T1. Blast radius → T1 + T4. Discard on leave → T5 Step 2. Commit order → T5 Step 4. `fanOut` prefill → T5 Step 3. Draft id → T5 Step 1. No-card-selected → T5 Step 4 (`commitMissing`). Testing → T1, T2.

**Two additions the spec did not name**, both discovered while writing this: `clearBinding` (the spec said "drop the patch" without noticing `setBinding(…, null)` tombstones instead of removing), and `saveBindings` (the spec named the endpoint but not that it has no client). Both are in Task 2.

**Known soft spot.** T5 Step 5 leaves the `pointer-events` question to a browser check rather than asserting the answer, because whether `.fxcommit` inherits from `.fxharness` depends on where it lands in the DOM. The plan states the failure mode and that it has shipped before.

**Type consistency.** `CommitInput` / `CommitPlan` / `CommitRef` / `planCommit` / `forkId` / `referencesTo` / `MAX_SLUG` / `saveBindings` / `clearBinding` / `DRAFT_ID` are used with identical signatures throughout.
