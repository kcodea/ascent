# FX Bindings As Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move "which authored FX def plays at this moment" out of two compiled-in TypeScript literals and
into one `bindings.json` behind a single resolver, with a live session-override layer and a dev endpoint that
commits the merged result back to the file.

**Architecture:** A new `packages/ui/src/choreo/bindings.ts` statically imports `bindings.json`, validates it
per-entry, layers a `localStorage` session patch on top, and answers `bindingFor(cardId, kind)`. The
migration is strangler-style: the file is introduced first as an exact duplicate of the existing literals
(guarded by a parity test), readers are pointed at the resolver one at a time while both sources agree, and
only then are the literals deleted. The `fxDef` cue moves into `BASE` so it exists on every moment kind as a
pure timing row — after which a binding alone is enough to make an effect play.

**Tech Stack:** TypeScript, React, Vite (dev-only plugin middleware), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-27-fx-bindings-as-data-design.md`

**Worktree:** `.claude/worktrees/fx-workbench-p1`, branch `feat/fx-workbench-p1`. All commands below run from
the worktree root. **Never commit to `main`** — this branch goes up as a PR and the owner merges.

---

## Background an engineer needs before starting

**What a "moment" is.** The combat simulator emits a flat `CombatEvent[]`. `choreo/compile.ts` folds that
into `Moment`s, and `choreo/kinds.ts` gives each moment a `MomentKind` (`attackExchange`, `scCast`,
`buffWave`, …). `choreo/score.ts` maps each kind to an ordered list of `Cue`s — a cue is "run this channel at
this time." One of those channels is `fxDef`, which plays an authored effect from `packages/ui/src/fx/defs/`.

**Where bindings live today (the thing being replaced).**
1. Kind-level: a `def: 'spell-cast'` property on the `fxDef` cue inside `SCORE_DEFAULTS` in `score.ts`.
2. Card-level: the `CARD_FX` constant in `choreo/cardFx.ts`, keyed card id → kind → `{ def, fanOut }`.

**`fanOut` explained** — it decides which anchor pairs a def plays at, and today it is split across two
unions that this work merges:
- `'primary'` (default): play once, at the moment's own source→target pair.
- `'damaged'`: play once per distinct unit damaged in the same *resolution step*. Needed because a cast's own
  event often carries no target (Bloodbinder emits one targetless `sc`, then a `dmg` per marked enemy).
- `'selfBuffed'`: play once per unit that buffed itself in the moment.

**Two invariants that must survive the migration:**
- `canPlayDefs()` is checked **before** anything is scheduled, so production pays two property reads per
  moment and allocates nothing. Defs are a dev-only payload.
- The **damage claim** (`claimDamageFx` in `cardFx.ts`) is made **synchronously at schedule time**, not
  inside the deferred callback. Moments are scheduled in log order and a `damage` moment follows its own
  cast, so the claim must already be standing when the later moment's `damageFx` cue is scheduled. Deferring
  it races and the stock hit-burst fires anyway.

**Running one test file:**
```bash
npx vitest run packages/ui/src/choreo/bindings.test.ts
```

**The full gate (must be green before the final commit):**
```bash
npm run typecheck && npm run typecheck:web && npm run lint && npm test && npm run build:web
```

**`typecheck:web` is not optional here.** The root `tsconfig.json` explicitly *excludes* `packages/ui`
(`"exclude": ["packages/ui"]`), so `npm run typecheck` alone does **not** typecheck a single file this plan
touches except `apps/web/fxDefsPlugin.ts`. `npm run typecheck:web` runs `apps/web/tsconfig.json`, whose
`include` covers `packages/ui/src`. Run both.

`resolveJsonModule: true` is already set in `tsconfig.base.json`, which both configs extend — importing
`bindings.json` needs no config change.

`npm run lint` has **1 known pre-existing warning** (`CARD_INDEX` unused in `SceneBuilder.tsx`). 0 errors is
the pass condition; do not "fix" that warning — it is out of scope.

**Worktree note:** if `npm run typecheck` resolves `@game/*` to the main checkout, this worktree needs its own
`npm install`. Run it once before starting.

---

## File Structure

| File | Responsibility |
|---|---|
| **Create** `packages/ui/src/choreo/bindings.json` | The data: `{ version, kinds, cards }`. Git-tracked, reviewable as a diff. |
| **Create** `packages/ui/src/choreo/bindings.ts` | The only module that answers "which def plays here": validated load, session patch, `bindingFor`, `effectiveTables`, `bindingsJson`. |
| **Create** `packages/ui/src/choreo/bindings.test.ts` | Resolution order, tombstones, per-entry validation, parity with the old literals, integrity guards. |
| **Modify** `packages/ui/src/choreo/score.ts` | `fxDef` joins `BASE`; every `def:`/`fanOut:` literal leaves; the runner calls `bindingFor`. `Cue.def` and `Cue.fanOut` are deleted. |
| **Modify** `packages/ui/src/choreo/score.test.ts` | Binding assertions move to `bindings.json`; the split/parity tests simplify to equality. |
| **Modify** `packages/ui/src/choreo/cardFx.ts` | Keeps the fan-out *mechanics* (`damagedUidsIn`, the claim). Loses `CARD_FX`, `CardFxBinding`, `cardFxFor`. |
| **Modify** `packages/ui/src/choreo/cardFx.test.ts` | Drops the `cardFxFor` block. |
| **Modify** `packages/ui/src/fx/ui/catalog.ts` | Reads bindings through the resolver instead of reconciling `getScore()` against `CARD_FX`. |
| **Modify** `packages/ui/src/fx/ui/catalog.test.ts` | The integrity guard reads the resolver. |
| **Modify** `apps/web/fxDefsPlugin.ts` | Adds `planBindingsWrite` + the `POST /__fx/bindings` endpoint. |
| **Modify** `apps/web/fxDefsPlugin.test.ts` | Covers `planBindingsWrite`. |
| **Modify** `docs/devlog.md`, `docs/roadmap.md`, `README.md` | Required by CLAUDE.md on every commit. |

**Task order is load-bearing.** Tasks 1–3 add the new source of truth and point readers at it *while both
sources still agree*, so every task leaves the suite green. Task 4 deletes the literals. Reordering breaks
that property.

---

### Task 1: The bindings file and the resolver

Introduces `bindings.json` as an exact duplicate of today's literals, plus the module that reads it. **No
existing code changes yet** — nothing consumes this in Task 1. A parity test proves the duplicate is exact,
which is the safety net for Tasks 3 and 4.

**Files:**
- Create: `packages/ui/src/choreo/bindings.json`
- Create: `packages/ui/src/choreo/bindings.ts`
- Create: `packages/ui/src/choreo/bindings.test.ts`

- [ ] **Step 1: Create the data file**

Create `packages/ui/src/choreo/bindings.json`. These 14 kind entries and 1 card entry are transcribed
verbatim from `SCORE_DEFAULTS` and `CARD_FX` as they exist today — the parity test in Step 6 enforces that.

```json
{
  "version": 1,
  "kinds": {
    "attackExchange": { "def": "self-buff-gold", "fanOut": "selfBuffed" },
    "buffWave": { "def": "self-buff-gold", "fanOut": "selfBuffed" },
    "hpGrant": { "def": "hp-grant" },
    "keyword": { "def": "keyword-gain" },
    "keywordLost": { "def": "keyword-lost" },
    "questComplete": { "def": "quest-complete" },
    "questTrigger": { "def": "quest-trigger" },
    "rally": { "def": "rally-link" },
    "reveal": { "def": "stealth-break" },
    "scCast": { "def": "spell-cast" },
    "shieldGain": { "def": "ward-gained" },
    "spellProgress": { "def": "spell-progress" },
    "toHand": { "def": "to-hand" },
    "venomSpent": { "def": "venom-spent" }
  },
  "cards": {
    "bloodbinder": {
      "scCast": { "def": "ruby-lance", "fanOut": "damaged" }
    }
  }
}
```

- [ ] **Step 2: Write the failing tests for validation and resolution**

Create `packages/ui/src/choreo/bindings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bindingFor, effectiveTables, parseTable, type FxBinding } from './bindings';

describe('parseTable', () => {
  it('accepts a well-formed table', () => {
    const t = parseTable({
      version: 1,
      kinds: { scCast: { def: 'spell-cast' } },
      cards: { bloodbinder: { scCast: { def: 'ruby-lance', fanOut: 'damaged' } } },
    });
    expect(t.kinds.scCast).toEqual({ def: 'spell-cast' });
    expect(t.cards.bloodbinder?.scCast).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  // Per-entry, not all-or-nothing: losing one binding must not cost the others.
  it('drops only the bad entry and keeps the rest, naming the key', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = parseTable({
      version: 1,
      kinds: { scCast: { def: 'spell-cast' }, buffWave: { def: 42 }, rally: { def: 'rally-link' } },
      cards: {},
    });
    expect(t.kinds.scCast).toEqual({ def: 'spell-cast' });
    expect(t.kinds.rally).toEqual({ def: 'rally-link' });
    expect(t.kinds.buffWave).toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]?.[0])).toContain('kinds.buffWave');
    err.mockRestore();
  });

  it('rejects an unknown fanOut', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = parseTable({ version: 1, kinds: { scCast: { def: 'x', fanOut: 'sideways' } }, cards: {} });
    expect(t.kinds.scCast).toBeUndefined();
    expect(String(err.mock.calls[0]?.[0])).toContain('fanOut');
    err.mockRestore();
  });

  it('returns empty tables for a wholly wrong shape', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseTable(null)).toEqual({ kinds: {}, cards: {} });
    expect(parseTable({ version: 1, kinds: [], cards: 'nope' })).toEqual({ kinds: {}, cards: {} });
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('bindingFor', () => {
  it('resolves a kind-level binding', () => {
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('lets a card-level binding beat the kind default', () => {
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  it('falls back to the kind for a card with no entry at that kind', () => {
    expect(bindingFor('bloodbinder', 'shieldGain')).toEqual({ def: 'ward-gained' });
    expect(bindingFor('somethingelse', 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('returns null for a kind nothing is bound to', () => {
    expect(bindingFor(null, 'damage')).toBeNull();
    expect(bindingFor('bloodbinder', 'damage')).toBeNull();
  });
});

describe('effectiveTables', () => {
  it('exposes the file contents', () => {
    const t = effectiveTables();
    expect(t.kinds.scCast).toEqual({ def: 'spell-cast' });
    expect(Object.keys(t.cards)).toContain('bloodbinder');
  });

  it('hands out a copy — mutating the result cannot corrupt the module', () => {
    const t = effectiveTables();
    delete t.kinds.scCast;
    expect(effectiveTables().kinds.scCast).toEqual({ def: 'spell-cast' });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run packages/ui/src/choreo/bindings.test.ts`
Expected: FAIL — `Failed to resolve import "./bindings"`.

- [ ] **Step 4: Write the resolver**

Create `packages/ui/src/choreo/bindings.ts`:

```ts
import type { MomentKind } from './kinds';
import rawBindings from './bindings.json';

/**
 * WHICH authored FX def plays at a moment — the single answer to that question, for the cue runner, the FX
 * library browser, and the workbench's commit path.
 *
 * It used to be two answers: a `def` literal on an `fxDef` cue in `score.ts` (keyed by moment kind) and the
 * frozen `CARD_FX` table in `cardFx.ts` (keyed by card, then kind). Two shapes, two resolution orders, no
 * override layer on either — so retargeting a card's effect meant editing TypeScript, and the two could
 * disagree about what would play.
 *
 * WHAT plays lives here; WHEN it plays stays on the cue in `score.ts` (`at`/`offset`/`scaled`/`enabled`).
 * That split is deliberate: it keeps this file small enough to review as a diff and keeps timing next to the
 * scheduling code that consumes it.
 *
 * `bindings.json` is a STATIC import, which is what makes the obvious failure mode impossible: a missing or
 * syntactically invalid file is a build error, not a runtime silent-nothing. The only failure left is
 * "parseable but structurally wrong", which `parseTable` handles loudly and per-entry below.
 */

export interface FxBinding {
  /** The def id to play — a file stem under `packages/ui/src/fx/defs/`. */
  def: string;
  /**
   * Which anchor pairs the def plays at. Merges what used to be two separate unions (`Cue.fanOut` and
   * `CardFxBinding.fanOut`) that asked the same question.
   *
   * - `primary` (default): once, at the moment's own source→target pair.
   * - `damaged`: once per distinct unit damaged in the same resolution step. A cast's own event frequently
   *   carries NO target (Bloodbinder emits one targetless `sc`, then a `dmg` per marked enemy), so a
   *   travelling effect bound to it would have nowhere to go and would collapse onto the source.
   * - `selfBuffed`: once per unit that buffed ITSELF in this moment. A self-buff has no pair to travel
   *   between and a moment can carry several at once.
   */
  fanOut?: 'primary' | 'damaged' | 'selfBuffed';
}

const FAN_OUTS: readonly string[] = ['primary', 'damaged', 'selfBuffed'];

/** kind → binding, and card → kind → binding. Both sparse. */
export interface BindingTable {
  kinds: Partial<Record<MomentKind, FxBinding>>;
  cards: Record<string, Partial<Record<MomentKind, FxBinding>>>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** One binding, or null with a console.error naming `where`. Never throws: this is fed untrusted JSON. */
function coerceBinding(v: unknown, where: string): FxBinding | null {
  if (!isRecord(v)) {
    console.error(`[fx] bindings.json: ${where} is not an object — dropped.`);
    return null;
  }
  if (typeof v.def !== 'string' || v.def === '') {
    console.error(`[fx] bindings.json: ${where}.def must be a non-empty string — dropped.`);
    return null;
  }
  if (v.fanOut !== undefined && (typeof v.fanOut !== 'string' || !FAN_OUTS.includes(v.fanOut))) {
    console.error(`[fx] bindings.json: ${where}.fanOut must be one of ${FAN_OUTS.join(', ')} — dropped.`);
    return null;
  }
  return v.fanOut === undefined ? { def: v.def } : { def: v.def, fanOut: v.fanOut as FxBinding['fanOut'] };
}

/**
 * Validate a raw table. LOUD PER ENTRY rather than all-or-nothing: a bad entry is dropped with the exact key
 * named, and every other entry still loads. Losing one binding should not cost the other thirteen — and a
 * binding that silently fails to load is indistinguishable from one nobody wired, which is the single most
 * expensive ambiguity in this subsystem.
 *
 * Exported for the tests, which are the only place a malformed table can be constructed on purpose.
 */
export function parseTable(raw: unknown): BindingTable {
  const out: BindingTable = { kinds: {}, cards: {} };
  if (!isRecord(raw)) {
    console.error('[fx] bindings.json is not an object — no authored FX will be bound.');
    return out;
  }
  if (isRecord(raw.kinds)) {
    for (const [kind, v] of Object.entries(raw.kinds)) {
      const b = coerceBinding(v, `kinds.${kind}`);
      if (b) out.kinds[kind as MomentKind] = b;
    }
  } else {
    console.error('[fx] bindings.json: `kinds` is missing or not an object.');
  }
  if (isRecord(raw.cards)) {
    for (const [cardId, byKind] of Object.entries(raw.cards)) {
      if (!isRecord(byKind)) {
        console.error(`[fx] bindings.json: cards.${cardId} is not an object — dropped.`);
        continue;
      }
      const table: Partial<Record<MomentKind, FxBinding>> = {};
      for (const [kind, v] of Object.entries(byKind)) {
        const b = coerceBinding(v, `cards.${cardId}.${kind}`);
        if (b) table[kind as MomentKind] = b;
      }
      if (Object.keys(table).length > 0) out.cards[cardId] = table;
    }
  } else {
    console.error('[fx] bindings.json: `cards` is missing or not an object.');
  }
  return out;
}

/** The committed baseline, validated once at module load. */
const FILE: BindingTable = parseTable(rawBindings);

/** A deep-ish copy so a caller cannot mutate the module's own tables (the browser iterates these freely). */
function cloneTable(t: BindingTable): BindingTable {
  const cards: BindingTable['cards'] = {};
  for (const [id, byKind] of Object.entries(t.cards)) cards[id] = { ...byKind };
  return { kinds: { ...t.kinds }, cards };
}

/**
 * The binding for a card at a kind, or null.
 *
 * Card layer first — the kind is the right key for "a Ward was gained", but every spell cast shares `scCast`,
 * so a card with its own look needs the narrower key. A `cardId` of null (no unit on screen, or the moment's
 * source is unknown) skips straight to the kind layer.
 */
export function bindingFor(cardId: string | null, kind: MomentKind): FxBinding | null {
  if (cardId !== null) {
    const card = FILE.cards[cardId]?.[kind];
    if (card !== undefined) return card;
  }
  return FILE.kinds[kind] ?? null;
}

/** The whole effective table — what the FX library browser enumerates. Always a fresh copy. */
export function effectiveTables(): BindingTable {
  return cloneTable(FILE);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/ui/src/choreo/bindings.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Add the parity + integrity tests**

These are the migration's safety net. **The parity test is deleted in Task 4**, when the literals it compares
against no longer exist. The two integrity tests are permanent.

Append to `packages/ui/src/choreo/bindings.test.ts`:

```ts
import { CARD_INDEX } from '@game/content';
import { CARD_FX } from './cardFx';
import { SCORE_DEFAULTS } from './score';
import type { MomentKind } from './kinds';

/**
 * TEMPORARY — delete together with `CARD_FX` and the `def:` literals in Task 4.
 *
 * bindings.json is introduced as an exact duplicate of the two literals it replaces, so that readers can be
 * repointed one at a time while both sources still agree. This test is what makes "exact" a fact rather than
 * a hope.
 */
describe('parity with the literals being replaced', () => {
  it('binds every kind → def pair SCORE_DEFAULTS does, and no others', () => {
    const fromScore: Record<string, FxBinding> = {};
    for (const [kind, cues] of Object.entries(SCORE_DEFAULTS)) {
      for (const c of cues) {
        if (c.ch !== 'fxDef' || !c.def) continue;
        fromScore[kind] = c.fanOut === undefined ? { def: c.def } : { def: c.def, fanOut: c.fanOut };
      }
    }
    expect(effectiveTables().kinds).toEqual(fromScore);
  });

  it('binds every card → kind → def entry CARD_FX does, and no others', () => {
    expect(effectiveTables().cards).toEqual(CARD_FX);
  });
});

/**
 * PERMANENT. A binding naming a def that does not exist is a silent no-op at runtime — `playDef` returns null
 * and nothing plays, which is indistinguishable from a binding nobody wired. That ambiguity cost a long
 * debugging session on Bloodbinder.
 */
describe('binding integrity', () => {
  it('every bound def id exists in the registry', async () => {
    await import('../fx/primitives');
    const { listDefs } = await import('../fx/fxDefs');
    const known = new Set(listDefs().map((d) => d.id));
    const t = effectiveTables();
    const missing: string[] = [];
    for (const [kind, b] of Object.entries(t.kinds)) if (!known.has(b.def)) missing.push(`${kind}:${b.def}`);
    for (const [cardId, byKind] of Object.entries(t.cards)) {
      for (const [kind, b] of Object.entries(byKind)) {
        if (b && !known.has(b.def)) missing.push(`${cardId}.${kind}:${b.def}`);
      }
    }
    expect(missing, `bindings naming defs that do not exist: ${missing.join(', ')}`).toEqual([]);
  });

  it('every key is a real moment kind and a real card id', () => {
    const kinds = new Set(Object.keys(SCORE_DEFAULTS));
    const t = effectiveTables();
    const bad: string[] = [];
    for (const kind of Object.keys(t.kinds)) if (!kinds.has(kind)) bad.push(`kinds.${kind}`);
    for (const [cardId, byKind] of Object.entries(t.cards)) {
      if (!(cardId in CARD_INDEX)) bad.push(`cards.${cardId}`);
      for (const kind of Object.keys(byKind)) if (!kinds.has(kind)) bad.push(`cards.${cardId}.${kind}`);
    }
    expect(bad, `keys that name nothing real: ${bad.join(', ')}`).toEqual([]);
  });
});
```

Note the `MomentKind` import is used by the parity test's type annotations only; if the linter flags it as
unused after you write the file, drop the import rather than adding a suppression.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run packages/ui/src/choreo/bindings.test.ts`
Expected: PASS (15 tests). If the parity test fails, `bindings.json` is not a faithful transcription — fix
the JSON, not the test.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/choreo/bindings.json packages/ui/src/choreo/bindings.ts packages/ui/src/choreo/bindings.test.ts
git commit -m "feat(fx): bindings.json + the resolver that reads it

Introduces the single answer to 'which authored def plays here' as data,
duplicating the two literals it will replace. A parity test proves the
duplicate is exact, so readers can be repointed one at a time while both
sources still agree. Nothing consumes it yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The session patch and the commit payload

Adds the live-override layer: changes take effect instantly, persist to `localStorage`, and can be serialized
for the commit endpoint. Still no existing-code changes.

**Files:**
- Modify: `packages/ui/src/choreo/bindings.ts`
- Modify: `packages/ui/src/choreo/bindings.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/ui/src/choreo/bindings.test.ts`:

```ts
import { bindingsJson, resetBindings, setBinding } from './bindings';

describe('session overrides', () => {
  beforeEach(() => resetBindings());

  it('a kind-level override wins over the file', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'test-red-blast' });
  });

  it('a card-level override wins over both the file and a kind override', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', { def: 'ember-lance', fanOut: 'damaged' });
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ember-lance', fanOut: 'damaged' });
    expect(bindingFor('somethingelse', 'scCast')).toEqual({ def: 'test-red-blast' });
  });

  // A tombstone, not an absent key. Against a file baseline "absent" means INHERIT, so without an explicit
  // null there is no way to say "this card should play nothing here" as a live change.
  it('binding to null unbinds, and does NOT fall through to the kind', () => {
    setBinding('bloodbinder', 'scCast', null);
    expect(bindingFor('bloodbinder', 'scCast')).toBeNull();
    expect(bindingFor('somethingelse', 'scCast')).toEqual({ def: 'spell-cast' });
  });

  it('a kind-level tombstone unbinds the kind', () => {
    setBinding(null, 'scCast', null);
    expect(bindingFor(null, 'scCast')).toBeNull();
  });

  it('resetBindings returns everything to the file baseline', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', null);
    resetBindings();
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'spell-cast' });
    expect(bindingFor('bloodbinder', 'scCast')).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  });

  it('effectiveTables reflects overrides and drops tombstoned entries', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', null);
    const t = effectiveTables();
    expect(t.kinds.scCast).toEqual({ def: 'test-red-blast' });
    expect(t.cards.bloodbinder).toBeUndefined();
  });

  it('persists to localStorage under its own key', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    expect(localStorage.getItem('ascent.fxBindings')).toContain('test-red-blast');
    resetBindings();
    expect(localStorage.getItem('ascent.fxBindings')).toBeNull();
  });
});

describe('bindingsJson', () => {
  beforeEach(() => resetBindings());

  // What commit writes must be what the session was playing, or the button lies.
  it('round-trips: the committed text re-parses to the same resolution', () => {
    setBinding(null, 'scCast', { def: 'test-red-blast' });
    setBinding('bloodbinder', 'scCast', null);
    const parsed = parseTable(JSON.parse(bindingsJson()));
    expect(parsed.kinds.scCast).toEqual({ def: 'test-red-blast' });
    expect(parsed.cards.bloodbinder).toBeUndefined();
    expect(parsed.kinds.rally).toEqual({ def: 'rally-link' });
  });

  it('emits version 1, sorted keys, and a trailing newline', () => {
    const text = bindingsJson();
    expect(JSON.parse(text).version).toBe(1);
    expect(text.endsWith('\n')).toBe(true);
    const kinds = Object.keys(JSON.parse(text).kinds);
    expect(kinds).toEqual([...kinds].sort());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/ui/src/choreo/bindings.test.ts`
Expected: FAIL — `setBinding is not a function` (and `resetBindings`, `bindingsJson`).

- [ ] **Step 3: Implement the patch layer**

In `packages/ui/src/choreo/bindings.ts`, add after the `FILE` constant:

```ts
/**
 * Session overrides, layered over the file.
 *
 * Deliberately the same two-tier shape defs already have (session autosave vs. Save), so there is ONE mental
 * model for both: a change is live the instant you make it and survives a reload, and a separate explicit
 * commit writes the git-tracked file.
 *
 * `null` is a TOMBSTONE, not an absence. Against a file baseline an absent key means "inherit", so without an
 * explicit null there would be no way to express "this card plays nothing here" as a live change.
 */
type PatchTable = {
  kinds: Partial<Record<MomentKind, FxBinding | null>>;
  cards: Record<string, Partial<Record<MomentKind, FxBinding | null>>>;
};

const PATCH_KEY = 'ascent.fxBindings';

const EMPTY_PATCH: PatchTable = { kinds: {}, cards: {} };

/** The in-memory patch is the source of truth (this works with no localStorage at all); storage is
 *  persistence only, read once at module load. A corrupt blob degrades to no overrides. */
let patch: PatchTable = (() => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PATCH_KEY) ?? '{}');
    if (!isRecord(raw)) return { kinds: {}, cards: {} };
    return {
      kinds: isRecord(raw.kinds) ? (raw.kinds as PatchTable['kinds']) : {},
      cards: isRecord(raw.cards) ? (raw.cards as PatchTable['cards']) : {},
    };
  } catch {
    return { kinds: {}, cards: {} };
  }
})();

function savePatch(): void {
  try {
    localStorage.setItem(PATCH_KEY, JSON.stringify(patch));
  } catch {
    /* ignore — the in-memory patch still works */
  }
}

/**
 * Bind (or, with `null`, explicitly unbind) a def.
 *
 * Takes the SAME `(cardId, kind)` key `bindingFor` reads, so the write and the read cannot disagree about
 * what a scope is: `cardId === null` addresses the kind layer, a string addresses that card's layer.
 */
export function setBinding(cardId: string | null, kind: MomentKind, binding: FxBinding | null): void {
  if (cardId === null) patch = { ...patch, kinds: { ...patch.kinds, [kind]: binding } };
  else patch = { ...patch, cards: { ...patch.cards, [cardId]: { ...patch.cards[cardId], [kind]: binding } } };
  savePatch();
}

/** Drop every session override, back to the committed file. */
export function resetBindings(): void {
  patch = { kinds: {}, cards: {} };
  try {
    localStorage.removeItem(PATCH_KEY);
  } catch {
    /* ignore */
  }
}
```

Note `EMPTY_PATCH` is declared for readability but each reset builds a fresh literal — sharing one object
across resets would let a later mutation leak between them. If the linter flags `EMPTY_PATCH` as unused,
delete the constant; the fresh literals are the behaviour that matters.

- [ ] **Step 4: Apply the patch in the resolvers**

Replace `bindingFor` and `effectiveTables` in `packages/ui/src/choreo/bindings.ts` with:

```ts
export function bindingFor(cardId: string | null, kind: MomentKind): FxBinding | null {
  if (cardId !== null) {
    // `undefined` means "no opinion, keep looking"; an explicit `null` is a tombstone that STOPS here —
    // falling through to the kind layer would make "play nothing" impossible to express.
    const overridden = patch.cards[cardId]?.[kind];
    if (overridden !== undefined) return overridden;
    const fromFile = FILE.cards[cardId]?.[kind];
    if (fromFile !== undefined) return fromFile;
  }
  const overriddenKind = patch.kinds[kind];
  if (overriddenKind !== undefined) return overriddenKind;
  return FILE.kinds[kind] ?? null;
}

/**
 * The whole effective table: the file with the session patch applied and tombstones REMOVED. This is what
 * the library browser enumerates and what `bindingsJson` commits — in both cases "unbound" is expressed by
 * absence, so tombstones (which only exist to stop resolution falling through) have done their job by here.
 */
export function effectiveTables(): BindingTable {
  const out = cloneTable(FILE);
  for (const [kind, b] of Object.entries(patch.kinds)) {
    if (b) out.kinds[kind as MomentKind] = b;
    else delete out.kinds[kind as MomentKind];
  }
  for (const [cardId, byKind] of Object.entries(patch.cards)) {
    const table = { ...out.cards[cardId] };
    for (const [kind, b] of Object.entries(byKind)) {
      if (b) table[kind as MomentKind] = b;
      else delete table[kind as MomentKind];
    }
    if (Object.keys(table).length > 0) out.cards[cardId] = table;
    else delete out.cards[cardId];
  }
  return out;
}

/**
 * The merged file + patch as the exact text to write to `bindings.json`.
 *
 * Keys are sorted so a commit produces a minimal, readable diff rather than reordering the whole file
 * whenever an object's insertion order happens to change.
 */
export function bindingsJson(): string {
  const t = effectiveTables();
  const kinds: Record<string, FxBinding> = {};
  for (const kind of Object.keys(t.kinds).sort()) kinds[kind] = t.kinds[kind as MomentKind] as FxBinding;
  const cards: Record<string, Record<string, FxBinding>> = {};
  for (const cardId of Object.keys(t.cards).sort()) {
    const byKind = t.cards[cardId] ?? {};
    const inner: Record<string, FxBinding> = {};
    for (const kind of Object.keys(byKind).sort()) inner[kind] = byKind[kind as MomentKind] as FxBinding;
    cards[cardId] = inner;
  }
  return `${JSON.stringify({ version: 1, kinds, cards }, null, 2)}\n`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/ui/src/choreo/bindings.test.ts`
Expected: PASS (24 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/choreo/bindings.ts packages/ui/src/choreo/bindings.test.ts
git commit -m "feat(fx): session overrides + commit payload for bindings

setBinding/resetBindings/bindingsJson, layered over the committed file
and persisted to localStorage — the same session-vs-Save shape defs
already have. A null binding is an explicit tombstone so 'plays nothing
here' is expressible against a file baseline.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The FX library browser reads the resolver

Repoints the first consumer. The parity test from Task 1 guarantees this is a no-op for what the browser
displays — which is exactly why it can land before the literals are removed.

**Files:**
- Modify: `packages/ui/src/fx/ui/catalog.ts`
- Modify: `packages/ui/src/fx/ui/catalog.test.ts`

- [ ] **Step 1: Repoint `catalog.ts`**

In `packages/ui/src/fx/ui/catalog.ts`, replace the `CARD_FX` import:

```ts
import { CARD_FX } from '../../choreo/cardFx';
```

with:

```ts
import { bindingFor, effectiveTables } from '../../choreo/bindings';
```

Replace `bindingsByDef`, `kindCoverage` and `buildCardRows` (the three functions from `export interface
FxBindingCard` onward keep their surrounding types unchanged) with:

```ts
export interface FxBindingCard {
  cardId: string;
  /** The card's display name, or the raw id when the card is unknown (see `missing` below). */
  name: string;
  tribe: string;
  /** True when a binding names a card that is not in `CARD_INDEX` — surfaced rather than skipped. */
  missing: boolean;
}

export interface FxBindings {
  kinds: MomentKind[];
  cards: FxBindingCard[];
}

/**
 * def id → what binds to it. Reads the LIVE resolver (`effectiveTables`, which folds in any session
 * overrides), so the browser shows what would actually play right now rather than what the committed file
 * says.
 */
export function bindingsByDef(): Map<string, FxBindings> {
  const out = new Map<string, FxBindings>();
  const entry = (id: string): FxBindings => {
    const found = out.get(id) ?? { kinds: [], cards: [] };
    out.set(id, found);
    return found;
  };

  const tables = effectiveTables();
  for (const [kind, binding] of Object.entries(tables.kinds)) entry(binding.def).kinds.push(kind as MomentKind);
  for (const [cardId, byKind] of Object.entries(tables.cards)) {
    const card = CARD_INDEX[cardId];
    for (const binding of Object.values(byKind)) {
      if (!binding) continue;
      entry(binding.def).cards.push({
        cardId,
        name: card?.name ?? cardId,
        tribe: card?.tribe ?? 'unknown',
        missing: card === undefined,
      });
    }
  }
  return out;
}

export interface FxKindCoverage {
  kind: MomentKind;
  /** The def bound to this kind, or null when nothing is — the gap the coverage lens exists to show. */
  def: string | null;
}

/**
 * Every moment kind with its bound def or null, in the score's own order.
 *
 * The kind LIST still comes from `getScore()` — that is the authority on which kinds exist — but the def
 * comes from the resolver, since a kind's cue no longer carries one.
 */
export function kindCoverage(): FxKindCoverage[] {
  return (Object.keys(getScore()) as MomentKind[]).map((kind) => ({
    kind,
    def: bindingFor(null, kind)?.def ?? null,
  }));
}
```

And replace `buildCardRows` at the bottom of the file with:

```ts
export function buildCardRows(): FxCardRow[] {
  const cards = effectiveTables().cards;
  return Object.values(CARD_INDEX).map((card) => {
    const byKind = cards[card.id];
    const first = byKind ? Object.values(byKind).find((b) => b !== undefined) : undefined;
    return { cardId: card.id, name: card.name, tribe: card.tribe, defId: first?.def ?? null };
  });
}
```

Leave the doc comment above `buildCardRows` exactly as it is — it explains why unbound cards are kept, which
is still true.

- [ ] **Step 2: Update the catalog test's integrity guard**

In `packages/ui/src/fx/ui/catalog.test.ts`, replace the `CARD_FX` import:

```ts
import { CARD_FX } from '../../choreo/cardFx';
```

with:

```ts
import { effectiveTables } from '../../choreo/bindings';
```

and replace the whole `describe('binding integrity', ...)` block with:

```ts
/**
 * THE guard. A binding naming a def that does not exist is a silent no-op at runtime (`playDef` returns
 * null and nothing plays), indistinguishable from a binding that was never wired — which is exactly the
 * ambiguity that cost a long debugging session on Bloodbinder.
 *
 * `bindings.test.ts` asserts the same thing against the raw tables; this one asserts it through the catalog's
 * own view, so the browser cannot show a green row for a def that isn't there.
 */
describe('binding integrity', () => {
  it('every bound def id exists in the registry', async () => {
    await import('../primitives');
    const { listDefs } = await import('../fxDefs');
    const known = new Set(listDefs().map((d) => d.id));
    const tables = effectiveTables();
    const missing: string[] = [];
    for (const [kind, b] of Object.entries(tables.kinds)) if (!known.has(b.def)) missing.push(`${kind}:${b.def}`);
    for (const [cardId, byKind] of Object.entries(tables.cards)) {
      for (const b of Object.values(byKind)) if (b && !known.has(b.def)) missing.push(`${cardId}:${b.def}`);
    }
    expect(missing, `bindings naming defs that do not exist: ${missing.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the catalog and browser tests**

Run: `npx vitest run packages/ui/src/fx/ui/`
Expected: PASS. The `buildCatalog` case asserting `entry?.bindings.kinds` contains `'shieldGain'` for
`ward-gained` must still pass — that is the parity guarantee doing its job.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/fx/ui/catalog.ts packages/ui/src/fx/ui/catalog.test.ts
git commit -m "refactor(fx): the library browser reads bindings through the resolver

First consumer repointed. Provably a no-op for what the browser shows —
the parity test asserts bindings.json is an exact duplicate of the
literals still in place. kindCoverage now takes the kind LIST from the
score and the def from the resolver.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `score.ts` — fold `fxDef` into `BASE`, drop the literals

The load-bearing task. After this, a binding alone is sufficient to make an effect play.

**Files:**
- Modify: `packages/ui/src/choreo/score.ts`
- Modify: `packages/ui/src/choreo/score.test.ts`
- Modify: `packages/ui/src/choreo/bindings.test.ts` (delete the parity block)

- [ ] **Step 1: Delete `def` and `fanOut` from the `Cue` type**

In `packages/ui/src/choreo/score.ts`, delete these two members of `interface Cue` (lines ~35–49) — the
`def?: string` property with its comment, and the `fanOut?: 'selfBuffed'` property with its comment. The
remaining members (`ch`, `at`, `offset`, `scaled`, `enabled`) are unchanged.

A persisted `ascent.choreoScore` blob from before this change may still contain a `def` key. `getScore()`
spreads overrides over the defaults, so a stale key lands as an unknown extra property and is ignored by
every consumer. No migration is needed.

- [ ] **Step 2: Add `fxDef` to `BASE` and strip every per-kind literal**

Replace `BASE` and `SCORE_DEFAULTS` in `packages/ui/src/choreo/score.ts` with:

```ts
const BASE: Cue[] = [
  { ch: 'sfx', at: 'start' },
  { ch: 'float', at: 'start' },
  { ch: 'auraBurst', at: 'start', offset: 0 },
  { ch: 'auraBreak', at: 'start', offset: 300, scaled: true },
  // `executeFx` is on EVERY kind for the same reason the aura channels are: `poison` is a RESULT_TYPE, so it
  // collapses into whatever moment it lands in (an Execute kill on an attack is an `attackExchange` moment,
  // NOT a `poisonTick` one). Scoring it on `poisonTick` alone meant it never fired for the common case —
  // owner report 2026-07-22. The runner SKIPS it on `attackExchange`, where the impact channel fires the
  // strike at the lunge's real contact point instead (and replaces the standard hit FX doing it).
  { ch: 'executeFx', at: 'start', offset: 0 },
  // `fxDef` is on EVERY kind as a pure TIMING row, carrying no def of its own — what plays comes from
  // `bindings.json` via `bindingFor`. It used to be added per-kind, which meant binding a def to a kind whose
  // cue list happened not to include one silently played nothing: another instance of the failure mode this
  // whole subsystem keeps producing. Inert wherever nothing is bound, and free in production (the runner
  // checks `canPlayDefs()` before it allocates anything). It sits BEFORE `damageFx` in the list on purpose —
  // an authored effect claims the units it covers synchronously, and the claim has to be standing before the
  // stock hit-burst reads it.
  { ch: 'fxDef', at: 'start', offset: 0 },
];
const withReform = (): Cue[] => [...BASE, { ch: 'auraReform', at: 'start', offset: 460, scaled: false }];
/** Every kind runs sfx + float + auraBurst + auraBreak + executeFx + fxDef at start (all adapters no-op for
 *  moments with nothing to show) EXCEPT `attackExchange`, which ALSO still needs sfx (the wind-up whoosh,
 *  `sfx.attack`) + float (absorbed windup events like Rally/buff can carry a float) at `start`, PLUS `lunge`
 *  (the motion) at `start` and `impact` (the smack/FX/recoil) at the `contact` anchor the lunge defines, plus
 *  auraBurst (a death grouped into an attack's absorbed-windup run must still burst in place). A Ward CONSUMED
 *  by the exchange has no `auraBreak` cue here — the engine shatters it at the lunge's real `contact` (see
 *  `onImpactAuras`). The aura sub-channels are on EVERY kind because `death`/`shield` are RESULT_TYPES that
 *  collapse into another kind's moment (e.g. `[dmg, death]` is a `damage`-kind moment CONTAINING a death) —
 *  gating them on death/shieldPop kinds would miss those grouped effects. `auraReform` (the reborn re-form
 *  glow) rides only on the `reborn` kind, since a reborn is never grouped into another kind's moment. The three
 *  aura sub-channels (`auraBurst` = a real death bursting its auras in place at offset 0; `auraBreak` = a
 *  Divine-Shield consume's delayed gold shatter at +300ms scaled; `auraReform` = a reborn re-form glow at
 *  +460ms fixed wall-clock) each carry their own offset so a later authoring pass can retime each
 *  independently. Each kind gets its OWN array (not a shared reference) so a future authoring pass can vary
 *  one kind's cues without mutating others.
 *
 *  WHICH def each kind plays is NOT here — it lives in `bindings.json` (see `bindings.ts`). This table is
 *  timing only. */
export const SCORE_DEFAULTS: Record<MomentKind, Cue[]> = {
  attackExchange: [
    { ch: 'sfx', at: 'start' }, { ch: 'float', at: 'start' },
    { ch: 'lunge', at: 'start' }, { ch: 'impact', at: 'contact', offset: 0 },
    // NB: no `auraBreak` here — a Ward consumed by THIS exchange shatters at the lunge's real `contact` position
    // (engine-driven, `onImpactAuras`), not on a fixed start-relative delay that drifted off the hit and left the
    // bubble lingering disjointed from the unit. `auraBurst` (a death's in-place burst) stays at start.
    { ch: 'auraBurst', at: 'start', offset: 0 },
    // Self-buffs ABSORBED into a wind-up (`absorbIntoWindup` in compile.ts) never produce a `buffWave` moment
    // of their own — a Target Dummy growing as it is hit is exactly this case, which is why `attackExchange`
    // carries an fxDef row at all. (The binding itself is in `bindings.json`.)
    { ch: 'fxDef', at: 'start', offset: 0 },
  ],
  // `damageFx` = a NON-melee hit burst (damageBurst + impact ring) at each dmg target. On `damage` (SC nukes,
  // split damage) and `death` (Blaster's Deathrattle AoE lands in its death moment). Melee dmg stays in
  // `attackExchange` (already has the full lunge/impact FX), so it never double-bursts; the handler no-ops on a
  // plain death that carries no dmg events.
  damage: [...BASE, { ch: 'damageFx', at: 'start', offset: 0 }], shieldPop: [...BASE], poisonTick: [...BASE],
  // `shieldGain` = a unit GAINS a Ward mid-combat (`shieldUp`); `venomSpent` = a Venomous charge SPENT, split
  // out of `poisonTick` (the Execute proc), which keeps its crescent strike untouched. Both carry exactly the
  // cues their predecessor kind had — the splits are purely additive, and what they PLAY is a binding now.
  shieldGain: [...BASE], venomSpent: [...BASE],
  death: [...BASE, { ch: 'damageFx', at: 'start', offset: 0 }], riseDeath: [...BASE],
  // A real Start-of-Combat CAST (`sc` with `cast: true`) vs. mid-combat NARRATION, which classifies as
  // `scNarrate` and stays unbound so a spell-power line is silent.
  scCast: [...BASE], scNarrate: [...BASE],
  // `summonFx` = a dust poof at the arriving unit, at +250ms (scaled) to land on the `summonpop` overshoot (the
  // "bounce") — by then the scale-in has grown the unit to a measurable, full size.
  summon: [...BASE, { ch: 'summonFx', at: 'start', offset: 250 }],
  buffWave: [...BASE, { ch: 'buffCast', at: 'start', offset: 0 }, { ch: 'buffSelf', at: 'start', offset: 0 }],
  reborn: withReform(),
  ascend: [...BASE, { ch: 'ascendFx', at: 'start', offset: 0 }],
  rally: [...BASE], toHand: [...BASE],
  maxGold: [...BASE, { ch: 'coins', at: 'start', offset: 0 }],
  improve: [...BASE, { ch: 'improveSelf', at: 'start', offset: 0 }],
  keyword: [...BASE], keywordLost: [...BASE],
  hpGrant: [...BASE], spellProgress: [...BASE], reveal: [...BASE],
  tribeAura: [...BASE], // the wash itself is fired from the per-beat scan in useCombatReplay (like spell power), not a choreo channel
  // Quest/rune beats. These were classified `damage` before their kinds existed, so they carry `damage`'s exact
  // cue list — the split is provably a no-op for everything that already played. `damageFx` rides along INERT:
  // it bursts at the moment's `dmg` events and a quest moment is a single non-result event, so it has none.
  // Anchors: neither event names a unit (`flag`/`questId` + `side`), so `anchorsForUnits(null, null)` returns
  // null and the def skips silently — these two stay dormant until the score can anchor to a badge/HUD node
  // rather than a board unit. Bound anyway so the intent is recorded in one place.
  questTrigger: [...BASE, { ch: 'damageFx', at: 'start', offset: 0 }],
  questComplete: [...BASE, { ch: 'damageFx', at: 'start', offset: 0 }],
};
```

- [ ] **Step 3: Repoint the runner at the resolver**

In `packages/ui/src/choreo/score.ts`, change the import on line 10 from:

```ts
import { cardFxFor, claimDamageFx, damagedUidsIn, expireDamageFxClaim, isDamageFxClaimed } from './cardFx';
```

to:

```ts
import { claimDamageFx, damagedUidsIn, expireDamageFxClaim, isDamageFxClaimed } from './cardFx';
import { bindingFor } from './bindings';
```

Then replace the entire `else if (cue.ch === 'fxDef') { … }` branch in `runMomentCues` with:

```ts
    // An AUTHORED FX def (fx/playDef) plays at this moment. Guarded BEFORE `at()` so the production path costs
    // nothing: defs are a dev-authoring payload that doesn't ship, so `canPlayDefs()` is false there (two
    // property reads, short-circuiting on the first) and this allocates no closure and schedules no timer.
    else if (cue.ch === 'fxDef') {
      if (!canPlayDefs()) continue;
      // The card comes from `ctx.cardIds` — the replay's own uid→card map, already threaded in for the sfx
      // channel's death voicelines. It replaces a DOM lookup (`[data-card]`), which was the most suspect link
      // in this chain: it depended on the unit being rendered, findable by selector, and carrying an attribute
      // added for this feature. Combat state knows the answer without any of that.
      const { source, target } = momentUnits(moment.primary);
      const cardId = ctx.cardIds?.get(source ?? '') ?? null;
      // Resolved ONCE, here, rather than separately for the claim and again inside the deferred callback —
      // two lookups of the same key are two chances to disagree.
      const binding = bindingFor(cardId, moment.kind);
      if (!binding) continue;                    // nothing bound at this kind/card → nothing to schedule
      if (binding.fanOut === 'damaged') {
        // Claim the stock hit-burst for the units this binding will cover, SYNCHRONOUSLY — before `at()`
        // defers anything. Moments are scheduled in log order and the `damage` moment follows its own cast,
        // so the claim is standing by the time that moment's `damageFx` cue is scheduled. Doing it inside the
        // deferred callback would race: the burst is scheduled first and would fire regardless.
        const claimed = damagedUidsIn(ctx.events, moment.start, moment.end);
        claimDamageFx(moment.primary.step, claimed);
        // DEV-only, and deliberately loud about the FAILURE case. Every miss in this path so far has been
        // silent — the effect simply doesn't appear and the stock burst does, which is indistinguishable
        // from "the binding isn't wired". A binding that matched but found no targets is the specific bug
        // that already happened once (searching the wrong moment), so it gets a warning, not a log line.
        if (import.meta.env.DEV) {
          if (claimed.length === 0) {
            console.warn(
              `[fx] '${cardId ?? moment.kind}' → '${binding.def}' matched at '${moment.kind}' but found NO ` +
                `damaged units in step ${String(moment.primary.step)} — nothing will play.`,
            );
          } else {
            console.info(`[fx] '${cardId ?? moment.kind}' → '${binding.def}' ×${claimed.length}`, claimed);
          }
        }
        at(cue, () => {
          // The cast's own event carries no target (Bloodbinder emits one `sc` then a damage event per
          // marked enemy), so travel to each unit it actually damaged instead of collapsing onto the source.
          for (const uid of damagedUidsIn(ctx.events, moment.start, moment.end)) {
            const fanAnchors = anchorsForUnits(source, uid);
            if (fanAnchors) playDef(binding.def, fanAnchors);
          }
        });
        continue;
      }
      if (binding.fanOut === 'selfBuffed') {
        at(cue, () => {
          // Both ends are the same unit: a self-buff has no pair to travel between, so `source` and `target`
          // resolve to the same card and a travelling layer simply stays put on it.
          for (const sb of groupSelfBuffs(moment, ctx.events)) {
            const selfAnchors = anchorsForUnits(sb.uid, sb.uid);
            if (selfAnchors) playDef(binding.def, selfAnchors);
          }
        });
        continue;
      }
      at(cue, () => {
        const anchors = anchorsForUnits(source, target);
        if (!anchors) return;                    // the unit already left the screen → skip silently
        // Unknown def id → `playDef` returns null, so a build without this def's JSON is a silent no-op. The
        // returned stop() is deliberately NOT wired into this runner's cleanup: every channel here is
        // fire-and-forget (an aura burst outlives its moment too), and cancelling on moment-change would cut
        // the effect off mid-play.
        playDef(binding.def, anchors);
      });
    }
```

- [ ] **Step 4: Run the score tests to see exactly what breaks**

Run: `npx vitest run packages/ui/src/choreo/score.test.ts`
Expected: FAIL — the four binding-table cases in `describe('fxDef channel')` plus the `scoreJson` case still
assert `def` lives on a cue. Every other case should pass; if a *behavioural* case fails (one that runs
`runMomentCues` and asserts `mockPlayDef` calls), the runner rewrite is wrong — fix the runner, not the test.

- [ ] **Step 5: Migrate the score tests**

In `packages/ui/src/choreo/score.test.ts`, add to the imports at the top of the file:

```ts
import { bindingFor, effectiveTables } from './bindings';
```

Replace the `BINDINGS` / `FANOUT_BINDINGS` constants and the four affected cases:

```ts
// THE binding table now lives in `bindings.json`, not in the score. What this file still owns is that the
// score gives every kind a TIMING row to hang a binding on, and that nothing is bound where nobody intended.
const BINDINGS: Record<string, string> = {
  shieldGain: 'ward-gained', venomSpent: 'venom-spent', scCast: 'spell-cast',
  reveal: 'stealth-break', keyword: 'keyword-gain', keywordLost: 'keyword-lost',
  rally: 'rally-link', toHand: 'to-hand', hpGrant: 'hp-grant', spellProgress: 'spell-progress',
  questTrigger: 'quest-trigger', questComplete: 'quest-complete',
};

/** Bindings that FAN OUT rather than playing once at the moment's own pair. `attackExchange` is in here for a
 *  reason worth keeping: a self-buff absorbed into a wind-up never produces a `buffWave` moment, so binding
 *  only to `buffWave` would miss a unit that grows as it is attacked. */
const FANOUT_BINDINGS: Record<string, { def: string; fanOut: string }> = {
  buffWave: { def: 'self-buff-gold', fanOut: 'selfBuffed' },
  attackExchange: { def: 'self-buff-gold', fanOut: 'selfBuffed' },
};
```

(The two constants keep their exact current values — only the comment above them changes.)

Replace the case `it('binds exactly the intended kind → def pairs, and nothing else carries an fxDef cue', …)`
with these two:

```ts
  it('binds exactly the intended kind → def pairs, and nothing else', () => {
    const expected: Record<string, { def: string; fanOut?: string }> = { ...BINDINGS_AS_OBJECTS(), ...FANOUT_BINDINGS };
    expect(effectiveTables().kinds).toEqual(expected);
  });

  // Every kind carries a timing row, so a binding added to `bindings.json` is SUFFICIENT to make it play.
  // Before this, a def bound to a kind whose cue list happened to lack an `fxDef` entry silently played
  // nothing.
  it('gives every moment kind exactly one fxDef timing row', () => {
    for (const [kind, cues] of Object.entries(SCORE_DEFAULTS)) {
      expect(cues.filter((c) => c.ch === 'fxDef').length, kind).toBe(1);
    }
  });
```

and add this helper just below the `FANOUT_BINDINGS` constant:

```ts
/** `{ shieldGain: 'ward-gained' }` → `{ shieldGain: { def: 'ward-gained' } }`, the shape the table stores. */
const BINDINGS_AS_OBJECTS = (): Record<string, { def: string }> =>
  Object.fromEntries(Object.entries(BINDINGS).map(([kind, def]) => [kind, { def }]));
```

Replace `it('leaves every previously-effected kind free of authored defs', …)` with:

```ts
  // Kinds that already existed and already had FX must be untouched — a def on a NEIGHBOURING kind must never
  // reach them. (`damage` is the one that matters most: quest beats used to be classified as damage moments,
  // so binding their def there would have fired it on every hit in the fight.)
  // `attackExchange` and `buffWave` have deliberately LEFT this list: both now carry the self-buff fan-out
  // (see FANOUT_BINDINGS). Everything else stays unbound, so the list keeps doing its job of catching a def
  // bound somewhere nobody intended.
  it('leaves every previously-effected kind unbound', () => {
    for (const kind of ['damage', 'death', 'riseDeath', 'shieldPop', 'poisonTick',
      'scNarrate', 'summon', 'reborn', 'ascend', 'maxGold', 'improve', 'tribeAura'] as const) {
      expect(bindingFor(null, kind), kind).toBeNull();
    }
  });
```

Replace the `it.each` "purely additive" case and the `scNarrate` case with:

```ts
  // Every kinds split must not have cost the moments that MOVED anything they already played: the new kind
  // carries its predecessor's exact cue list, in order — and holds for the same time. (The fxDef row is on
  // both, from BASE, so the lists are now identical rather than differing by one entry.)
  it.each([
    ['shieldGain', 'shieldPop'],    // Ward gained ← Ward consumed
    ['venomSpent', 'poisonTick'],   // Venom spent ← the Execute proc
    ['questTrigger', 'damage'],     // quest tick   ← the `damage` fallthrough (damageFx rides along, inert)
    ['questComplete', 'damage'],
  ] as const)('%s keeps every cue %s had — the split is purely additive', (next, prev) => {
    expect(SCORE_DEFAULTS[next].map((c) => c.ch)).toEqual(SCORE_DEFAULTS[prev].map((c) => c.ch));
    expect(holdMsForKind(next)).toBe(holdMsForKind(prev)); // and the pacing is identical
  });

  // The `sc` split runs the other way: the NEW kind (narration) is the one that gains nothing, and the existing
  // name narrows to `cast: true`. Narration keeps precisely the cues `scCast` has; only the BINDING differs.
  it('scNarrate keeps exactly the cues scCast has, and stays unbound', () => {
    expect(SCORE_DEFAULTS.scNarrate.map((c) => c.ch)).toEqual(SCORE_DEFAULTS.scCast.map((c) => c.ch));
    expect(holdMsForKind('scNarrate')).toBe(holdMsForKind('scCast'));
    expect(bindingFor(null, 'scNarrate')).toBeNull();
    expect(bindingFor(null, 'scCast')).toEqual({ def: 'spell-cast' });
  });
```

Now fix the three `setCue(...)` cases that used `def`. Find `setCue('shieldGain', 'fxDef', { def: undefined })`
and replace that whole `it(...)` case with:

```ts
  it('plays nothing at a kind with no binding', () => {
    const stop = runMomentCues(moment('scNarrate', [{ type: 'sc', source: 'a', text: 'x' }] as CombatEvent[]), ctx());
    expect(mockPlayDef).not.toHaveBeenCalled();
    stop();
  });
```

If the surrounding `describe` does not already have a `ctx()` helper and a `moment()` helper in scope, reuse
whichever names the neighbouring cases in that block use — do not introduce new ones.

The `setCue('shieldGain', 'fxDef', { enabled: false })`, `{ offset: 200 }` and `{ offset: 300, scaled: false }`
cases need **no change**: they patch timing, which still lives on the cue.

Finally, find the `scoreJson` case asserting
`expect(json[kind]?.find((c) => c.ch === 'fxDef')?.def, kind).toBe(def)` and replace that assertion with:

```ts
      expect(json[kind]?.some((c) => c.ch === 'fxDef'), kind).toBe(true);
```

- [ ] **Step 6: Delete the parity block**

In `packages/ui/src/choreo/bindings.test.ts`, delete the entire
`describe('parity with the literals being replaced', …)` block and the now-unused `SCORE_DEFAULTS` /
`CARD_FX` imports it needed. Keep `CARD_INDEX` — the "every key is real" test still uses it. Keep the
`SCORE_DEFAULTS` import if that test uses it for the kind list (it does), and drop only `CARD_FX`.

- [ ] **Step 7: Run the choreo tests**

Run: `npx vitest run packages/ui/src/choreo/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/choreo/score.ts packages/ui/src/choreo/score.test.ts packages/ui/src/choreo/bindings.test.ts
git commit -m "refactor(fx): the score owns timing, bindings.json owns what plays

fxDef joins BASE as a pure timing row on every moment kind, and every
def:/fanOut: literal leaves SCORE_DEFAULTS. Cue.def and Cue.fanOut are
deleted; the runner resolves the binding once via bindingFor instead of
looking it up separately for the claim and again in the deferred play.

A binding is now SUFFICIENT to make an effect play — previously a def
bound to a kind whose cue list lacked an fxDef entry silently played
nothing, which is the failure mode this subsystem keeps reproducing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Retire `CARD_FX`

`cardFx.ts` keeps the fan-out *mechanics*; only the *data* leaves.

**Files:**
- Modify: `packages/ui/src/choreo/cardFx.ts`
- Modify: `packages/ui/src/choreo/cardFx.test.ts`

- [ ] **Step 1: Delete the table and its accessor**

In `packages/ui/src/choreo/cardFx.ts`, delete:
- the `export interface CardFxBinding { … }` block and its doc comment,
- the `export const CARD_FX = { … }` constant and its comment,
- the `export function cardFxFor(…) { … }` function and its comment,
- the now-unused `import type { MomentKind } from './kinds';`

Then replace the file's top doc comment (the block above the deleted interface) with:

```ts
/**
 * The MECHANICS an authored per-card effect needs — which units it fans out over, and suppressing the stock
 * hit-burst for the units it covers.
 *
 * The binding DATA that used to live here (`CARD_FX`: card id → kind → def) now lives in `bindings.json`,
 * behind `bindings.ts`. What stayed is everything that is about how a fan-out is computed rather than about
 * which effect is chosen.
 */
```

Keep `damagedUidsIn`, `claimDamageFx`, `isDamageFxClaimed`, `expireDamageFxClaim`, `resetDamageFxClaims` and
all of their comments exactly as they are. `import type { CombatEvent } from '@game/core';` stays.

- [ ] **Step 2: Trim the test**

In `packages/ui/src/choreo/cardFx.test.ts`, change the import on line 3 to:

```ts
import { claimDamageFx, damagedUidsIn, isDamageFxClaimed, resetDamageFxClaims } from './cardFx';
```

Delete the entire `describe('cardFxFor', …)` block (which also contains the `CARD_FX` iteration at line ~28).
That coverage now lives in `bindings.test.ts` — `bindingFor` resolution order and the "every key is real"
integrity test between them assert strictly more than the deleted block did.

- [ ] **Step 3: Verify nothing still references the deleted symbols**

Run:
```bash
grep -rn "CARD_FX\|cardFxFor\|CardFxBinding" packages/ui/src apps/web
```
Expected: no output.

- [ ] **Step 4: Run the choreo and fx tests**

Run: `npx vitest run packages/ui/src/choreo/ packages/ui/src/fx/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/choreo/cardFx.ts packages/ui/src/choreo/cardFx.test.ts
git commit -m "refactor(fx): retire CARD_FX — bindings.json is the only table

cardFx.ts keeps the fan-out mechanics (damagedUidsIn + the damage claim);
only the binding data leaves. Nothing in ui/ or apps/web references
CARD_FX, cardFxFor or CardFxBinding any more.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The commit endpoint

`POST /__fx/bindings` writes the merged table to the git-tracked file. This is what ③'s "commit animation"
button will call.

**Files:**
- Modify: `apps/web/fxDefsPlugin.ts`
- Modify: `apps/web/fxDefsPlugin.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/fxDefsPlugin.test.ts`:

```ts
import { planBindingsWrite } from './fxDefsPlugin';

const FILE = '/repo/packages/ui/src/choreo/bindings.json';
const ok = (kinds: unknown, cards: unknown = {}): string => JSON.stringify({ version: 1, kinds, cards });

describe('planBindingsWrite', () => {
  it('accepts a well-formed table and writes to the fixed path', () => {
    const plan = planBindingsWrite({ json: ok({ scCast: { def: 'spell-cast' } }) }, FILE);
    expect(plan.status).toBe(200);
    expect(plan.file).toBe(FILE);
    expect(String(plan.data)).toContain('"spell-cast"');
    expect(String(plan.data).endsWith('\n')).toBe(true);
  });

  it('re-serializes rather than echoing, so what lands on disk is stably formatted', () => {
    const plan = planBindingsWrite({ json: '{"version":1,"kinds":{},"cards":{}}' }, FILE);
    expect(plan.status).toBe(200);
    expect(String(plan.data)).toBe('{\n  "version": 1,\n  "kinds": {},\n  "cards": {}\n}\n');
  });

  it('rejects a non-object body, a missing json field, and unparseable json', () => {
    expect(planBindingsWrite(null, FILE).status).toBe(400);
    expect(planBindingsWrite({}, FILE).status).toBe(400);
    expect(planBindingsWrite({ json: '{oops' }, FILE).status).toBe(400);
  });

  it('rejects a wrong version', () => {
    const plan = planBindingsWrite({ json: JSON.stringify({ version: 2, kinds: {}, cards: {} }) }, FILE);
    expect(plan.status).toBe(400);
    expect(plan.error).toContain('version');
  });

  it('rejects a missing or non-object kinds/cards', () => {
    expect(planBindingsWrite({ json: JSON.stringify({ version: 1, cards: {} }) }, FILE).status).toBe(400);
    expect(planBindingsWrite({ json: ok({}, []) }, FILE).status).toBe(400);
  });

  // The def id is a filename stem on disk, so it gets the same grammar the def endpoint enforces.
  it('rejects a def id outside the slug grammar', () => {
    expect(planBindingsWrite({ json: ok({ scCast: { def: '../../etc/passwd' } }) }, FILE).status).toBe(400);
    expect(planBindingsWrite({ json: ok({ scCast: { def: 'Spell Cast' } }) }, FILE).status).toBe(400);
    expect(planBindingsWrite({ json: ok({ scCast: { def: '' } }) }, FILE).status).toBe(400);
  });

  it('rejects an unknown fanOut', () => {
    const plan = planBindingsWrite({ json: ok({ scCast: { def: 'spell-cast', fanOut: 'sideways' } }) }, FILE);
    expect(plan.status).toBe(400);
    expect(plan.error).toContain('fanOut');
  });

  it('validates nested card bindings too', () => {
    expect(planBindingsWrite({ json: ok({}, { bloodbinder: { scCast: { def: 'ruby-lance' } } }) }, FILE).status).toBe(200);
    expect(planBindingsWrite({ json: ok({}, { bloodbinder: { scCast: { def: 'BAD ID' } } }) }, FILE).status).toBe(400);
    expect(planBindingsWrite({ json: ok({}, { bloodbinder: 'nope' }) }, FILE).status).toBe(400);
  });

  it('rejects an oversized payload', () => {
    const huge = JSON.stringify({ version: 1, kinds: {}, cards: {}, pad: 'x'.repeat(300_000) });
    expect(planBindingsWrite({ json: huge }, FILE).status).toBe(413);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/web/fxDefsPlugin.test.ts`
Expected: FAIL — `planBindingsWrite is not a function`.

- [ ] **Step 3: Implement the planner**

In `apps/web/fxDefsPlugin.ts`, add after `planWrite`:

```ts
const BINDING_FAN_OUTS: readonly string[] = ['primary', 'damaged', 'selfBuffed'];

/** One binding entry: `{ def, fanOut? }`. Returns an error string, or null when it is fine. */
function badBinding(v: unknown, where: string): string | null {
  if (!isRecord(v)) return `${where} is not an object.`;
  // The def id becomes a filename stem on disk, so it gets exactly the grammar the def endpoint enforces.
  if (typeof v.def !== 'string' || !SLUG_RE.test(v.def)) {
    return `${where}.def must match ${String(SLUG_RE)}.`;
  }
  if (v.fanOut !== undefined && (typeof v.fanOut !== 'string' || !BINDING_FAN_OUTS.includes(v.fanOut))) {
    return `${where}.fanOut must be one of ${BINDING_FAN_OUTS.join(', ')}.`;
  }
  return null;
}

/**
 * The validation surface for a bindings commit, as a pure function — same contract as `planWrite`: no fs, no
 * server, no globals.
 *
 * NOTE the surface here is SMALLER than `planWrite`'s, not larger. The destination path is fixed by the
 * plugin and never derived from the request, so the traversal question `planWrite` exists to answer simply
 * does not arise: the client supplies content only. What is left is shape, size, and the slug grammar on def
 * ids (which do become filenames, indirectly, when something later loads them).
 */
export function planBindingsWrite(body: unknown, file: string): WritePlan {
  if (!isRecord(body)) return bad(400, 'Expected a JSON object body.');
  const { json } = body;
  if (typeof json !== 'string') return bad(400, 'Missing `json`.');
  if (Buffer.byteLength(json, 'utf8') > MAX_DEF_BYTES) {
    return bad(413, `Bindings are larger than ${MAX_DEF_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return bad(400, '`json` is not valid JSON.');
  }
  if (!isRecord(parsed)) return bad(400, '`json` must describe a bindings object.');
  if (parsed.version !== 1) return bad(400, 'Unsupported bindings `version` — expected 1.');
  if (!isRecord(parsed.kinds)) return bad(400, '`kinds` must be an object.');
  if (!isRecord(parsed.cards)) return bad(400, '`cards` must be an object.');

  for (const [kind, v] of Object.entries(parsed.kinds)) {
    const err = badBinding(v, `kinds.${kind}`);
    if (err) return bad(400, err);
  }
  for (const [cardId, byKind] of Object.entries(parsed.cards)) {
    if (!isRecord(byKind)) return bad(400, `cards.${cardId} is not an object.`);
    for (const [kind, v] of Object.entries(byKind)) {
      const err = badBinding(v, `cards.${cardId}.${kind}`);
      if (err) return bad(400, err);
    }
  }
  // Re-serialized (not echoed) so what lands on disk is always well-formed, stably formatted JSON that
  // reviews cleanly in a diff.
  return { status: 200, file, data: `${JSON.stringify(parsed, null, 2)}\n` };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/web/fxDefsPlugin.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the endpoint**

In `apps/web/fxDefsPlugin.ts`, add the default path next to `DEFAULT_DEFS_ROOT`:

```ts
const DEFAULT_BINDINGS_FILE = fileURLToPath(
  new URL('../../packages/ui/src/choreo/bindings.json', import.meta.url),
);
```

Add the option to `FxDefsPluginOptions`:

```ts
export interface FxDefsPluginOptions {
  /** Where defs are written. Defaults to `packages/ui/src/fx/defs` relative to this file. */
  defsRoot?: string;
  /** Where the FX binding table is committed. Defaults to `packages/ui/src/choreo/bindings.json`. */
  bindingsFile?: string;
}
```

Inside `fxDefsPlugin`, resolve it next to `defsRoot`:

```ts
  const bindingsFile = path.resolve(options.bindingsFile ?? DEFAULT_BINDINGS_FILE);
```

Add the handler alongside `handle`:

```ts
  /**
   * Commit the FX binding table. Its own handler rather than a third `WriteKind`, because the destination is
   * fixed by the plugin instead of derived from the request — sharing `planWrite`'s signature would imply a
   * client-supplied path that does not exist here.
   *
   * No watcher is needed on this file (unlike the defs directory): `bindings.json` is a STATIC import, so a
   * write invalidates through the normal import graph and HMR picks it up. The `import.meta.glob` staleness
   * that forced the defs watcher does not apply.
   */
  const handleBindings = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'POST only.' });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      send(res, 400, { ok: false, error: (e as Error).message || 'Unreadable request body.' });
      return;
    }
    const plan = planBindingsWrite(body, bindingsFile);
    if (plan.status !== 200 || !plan.file || plan.data === undefined) {
      send(res, plan.status, { ok: false, error: plan.error ?? 'Rejected.' });
      return;
    }
    try {
      await mkdir(path.dirname(plan.file), { recursive: true });
      await writeFile(plan.file, plan.data);
    } catch (e) {
      send(res, 500, { ok: false, error: `Could not write the file: ${(e as Error).message}` });
      return;
    }
    send(res, 200, { ok: true, path: path.relative(repoRoot, plan.file).split(path.sep).join('/') });
  };
```

And register it beside the other two, inside `configureServer`:

```ts
      server.middlewares.use('/__fx/bindings', (req, res) => void handleBindings(req, res));
```

- [ ] **Step 6: Run the plugin tests and typecheck**

Run: `npx vitest run apps/web/fxDefsPlugin.test.ts && npm run typecheck && npm run typecheck:web`
Expected: PASS, and both typechecks clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/fxDefsPlugin.ts apps/web/fxDefsPlugin.test.ts
git commit -m "feat(fx): POST /__fx/bindings commits the binding table to disk

Dev-only, like the def and art endpoints. Smaller surface than those:
the destination path is fixed by the plugin rather than derived from the
request, so the traversal question planWrite exists to answer does not
arise. No watcher needed — bindings.json is a static import, so a write
invalidates through the normal import graph.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Full gate and docs

**Files:**
- Modify: `docs/devlog.md`
- Modify: `docs/roadmap.md`
- Modify: `README.md`

- [ ] **Step 1: Run the full gate**

Run:
```bash
npm run typecheck && npm run typecheck:web && npm run lint && npm test && npm run build:web
```
Expected: both typechecks clean; lint 0 errors (1 known pre-existing warning about `CARD_INDEX` in
`SceneBuilder.tsx`); all tests pass; the web build succeeds.

`typecheck:web` is the one that actually covers `packages/ui` — the root config excludes it. Do not report
this plan as verified on `npm run typecheck` alone.

- [ ] **Step 2: Prepend the devlog entry**

Add to the top of `docs/devlog.md` (below the file's heading, above the previous newest entry):

```markdown
## 2026-07-27 — FX bindings as data

**What changed.** "Which authored FX def plays at this moment" moved out of two compiled-in TypeScript
literals — the `def:` property on `fxDef` cues in `SCORE_DEFAULTS`, and the frozen `CARD_FX` table in
`cardFx.ts` — into a single `packages/ui/src/choreo/bindings.json` behind a new `choreo/bindings.ts`. One
resolver, `bindingFor(cardId, kind)`, now answers that question for the cue runner, the FX library browser,
and (next) the workbench's commit button. Card layer beats kind layer; within each, a `localStorage` session
patch beats the committed file.

`fxDef` moved into `BASE`, so every moment kind carries a timing row and a binding alone is now *sufficient*
to make an effect play. Previously a def bound to a kind whose cue list happened to lack an `fxDef` entry
played nothing, silently — the same failure mode that has cost this subsystem several debugging sessions.
`Cue.def` and `Cue.fanOut` are gone; the score owns *when*, `bindings.json` owns *what*. The two `fanOut`
unions (`'selfBuffed'` on the cue, `'primary' | 'damaged'` on the card table) merged into one on `FxBinding`.

The runner now resolves the binding **once** per `fxDef` cue instead of looking it up separately for the
damage claim and again inside the deferred play — two lookups of the same key were two chances to disagree.
The claim itself is unchanged and still synchronous at schedule time.

`POST /__fx/bindings` (dev-only, `apply: 'serve'`) commits the merged table. Its surface is deliberately
*smaller* than the def endpoint's: the destination path is fixed by the plugin rather than derived from the
request, so the traversal guard `planWrite` exists for does not apply. No file watcher is needed either —
`bindings.json` is a static import, so a write invalidates through the normal import graph, unlike the
`import.meta.glob` staleness that forced the defs-directory watcher.

**Why.** This is phase ① of live FX authoring. ② stages a combat in which a chosen card's effect procs and
replays it on demand; ③ ties them together behind a "commit animation" button offering card-only or global
scope. None of that is buildable while the binding tables are constants.

**How it was verified.** Migration was strangler-style: `bindings.json` was introduced as an exact duplicate
of the literals, guarded by a parity test asserting the two agreed exactly, and readers were repointed one at
a time while both sources were live. That test was deleted with the literals it compared against. Permanent
guards took its place: every bound def id resolves to a real file in the registry (14/14 today); every
`kinds` key is a real `MomentKind` and every `cards` key a real `CARD_INDEX` id; and `bindingsJson()`
round-trips through `parseTable` to the same resolution, so what commit writes is what the session was
playing. A malformed entry is dropped **per entry** with a `console.error` naming the exact key, rather than
taking the whole table down. Full gate green: typecheck, lint (0 errors), tests, `build:web`.

**Follow-ups.** No authoring UI yet — clicking a card to rebind it is ③'s job, once ② can stage a combat to
see the change in. `fxScale` is still not threaded into the primitives, `playDef` still takes no per-call
params, and ~30 legacy `pixiFx` effects remain unported to defs.
```

- [ ] **Step 3: Update the roadmap**

In `docs/roadmap.md`, under the **Now** section, replace the FX-authoring entry (or add one if absent) with:

```markdown
- **Live FX authoring, phase ② — the proc harness.** Scan a run combat's event log for the moments a chosen
  card caused, and replay any one of them on demand, so an effect can be watched on the real card at real
  scale. Phase ① (bindings as data) shipped 2026-07-27.
- **Live FX authoring, phase ③ — the authoring panel.** Tie ① and ② together: pick a card, tune its effect
  against a live replay, and commit with a choice of card-only or global scope.
```

- [ ] **Step 4: Update the README**

In `README.md`, add to the top of **Recent changes**:

```markdown
- **FX bindings are data.** Which authored effect plays at a moment now lives in one `bindings.json` behind a
  single resolver, with live session overrides and a dev endpoint that commits them back to the file — the
  foundation for authoring an effect against a real combat.
```

and make sure **Short-term roadmap** names phases ② and ③ as described in Step 3.

- [ ] **Step 5: Commit and push**

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: devlog + roadmap + README for FX bindings as data

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin feat/fx-workbench-p1
```

Then open a PR (the owner merges — branch protection means Claude cannot):

```bash
"/c/Program Files/GitHub CLI/gh.exe" pr create --title "feat(fx): bindings as data" --body "Phase 1 of live FX authoring. See docs/superpowers/specs/2026-07-27-fx-bindings-as-data-design.md."
```

---

## Self-review notes

**Spec coverage.** §1 data model → Task 1 Steps 1+4. §2 resolution + the `BASE` collapse → Tasks 3+4. §3
session overrides → Task 2; commit endpoint → Task 6. §4 per-entry validation → Task 1 Step 4; the three
tests → Task 1 Step 6 (integrity ×2) and Task 2 Step 1 (round-trip); the visible half → Task 3. Scope
boundary honoured: no authoring UI in any task.

**Known deviation from the spec, deliberate.** The spec describes the tests as landing together. This plan
splits them — the two integrity tests land in Task 1 (before anything depends on them) and the round-trip
test in Task 2 (with the function it tests) — plus a temporary parity test the spec does not mention, which
is what lets each task leave the suite green.

**Type consistency.** `FxBinding` / `BindingTable` / `bindingFor` / `effectiveTables` / `parseTable` /
`setBinding` / `resetBindings` / `bindingsJson` / `planBindingsWrite` are used with identical signatures
everywhere they appear. `setBinding(cardId, kind, binding)` matches `bindingFor(cardId, kind)` by design.
