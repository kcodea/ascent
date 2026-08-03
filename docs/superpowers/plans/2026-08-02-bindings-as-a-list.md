# Bindings as a list — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** let SEVERAL authored effects bind to the same moment kind, so every moment type is reachable from
the workbench instead of the first binding claiming the slot.

**Architecture:** a binding *row* — the value at `(cardId | null, kind)` — becomes `FxBinding[]` instead of a
single `FxBinding`. Tombstones stay `null`. Overlay semantics stay **row-level**: a session patch entry still
replaces the whole row, exactly as today. The only new identity rule is **within** a row, where an entry is
keyed by its `def` id.

**Tech stack:** TypeScript, Vitest. No new dependencies. All inside `packages/ui`.

---

## Why row-level overlays stay row-level

Tempting to make the patch overlay merge *entry by entry*. Don't. The current module's hardest-won property
is stated in `bindingsJson`'s doc comment: a draft must be excluded by **choosing a different overlay**, never
by filtering after a merge, because an overlay entry overwrites the row beneath it and post-filtering deletes
the committed value underneath. That bug shipped once — "Bloodbinder's own `ruby-lance` binding silently
gone… only visible sessions later."

Entry-level merging reintroduces exactly that class of question at a finer grain. Keeping rows atomic means
`mergedTable`, `withoutTombstones`, `bindingsJson` and `unbindJson` keep their current shape, and the list is
a leaf-type change rather than a semantics change.

What *does* move: a **draft is now an entry, not a row.** `persistablePatch` must strip draft entries from
inside rows and then drop rows left empty. That is the single subtlest change in this plan and T3 is where it
lives.

---

## Decisions (settle these before writing code — they are assumed throughout)

| Question | Decision | Why |
|---|---|---|
| Identity within a row | the `def` id | two entries playing the same def at one moment is meaningless |
| Duplicate def in a row | last wins, `devError` naming the row | same "loud per entry, never all-or-nothing" rule `parseTable` already follows |
| Empty array `[]` | normalised to **absent** at parse | absence = "no opinion"; `null` = "plays nothing". `[]` is neither, so it must not be a third state |
| Play order | file order; a new entry appends | deterministic, and the author controls it by editing the file |
| One-entry row on write | serialised as a bare object, not a 1-element array | the existing `bindings.json` round-trips unchanged — zero diff churn on 14 untouched rows |
| Legacy read | a bare object parses as a 1-element list | no migration step, and an old file in a stale localStorage patch still loads |

---

## File structure

| File | Change |
|---|---|
| `packages/ui/src/choreo/bindings.ts` | 568 lines — the core. Leaf type, parse, serialise, resolvers, writers |
| `packages/ui/src/choreo/bindings.test.ts` | 631 lines — every case re-expressed against rows |
| `packages/ui/src/choreo/bindings.json` | unchanged by T1–T3 (round-trips); gains the Ruby row in T4 |
| `packages/ui/src/choreo/score.ts` | `fxDef` loops the row; `rubied` fan-out + `stagger`; delete the `rubyFx` channel |
| `packages/ui/src/choreo/channels/rubyLanded.ts` | keeps `rubiedUidsIn` (now called from the fan-out) and `RUBY_STAGGER_MS`; drops `RUBY_LANDED_DEF` |
| `packages/ui/src/fx/harness/commitPlan.ts` + test | commit must ADD to a row, not overwrite it |
| `packages/ui/src/fx/harness/unbindPlan.ts` | unbind targets ONE entry in a row |
| `packages/ui/src/fx/ui/catalog.ts` | coverage map counts entries, not rows |
| `packages/ui/src/fx/harness/procScan.ts`, `fx/defStore.ts`, `fx/ui/Workbench.tsx` | read-site updates |

---

## Task 1 — leaf type, parse, serialise

**Files:** `choreo/bindings.ts`, `choreo/bindings.test.ts`

- [ ] **Step 1: write the failing round-trip tests**

```ts
it('parses a bare object as a one-entry row', () => {
  const t = parseTable({ kinds: { buffWave: { def: 'a' } }, cards: {} });
  expect(t.kinds.buffWave).toEqual([{ def: 'a' }]);
});
it('parses an array as a multi-entry row', () => {
  const t = parseTable({ kinds: { buffWave: [{ def: 'a' }, { def: 'b', fanOut: 'rubied' }] }, cards: {} });
  expect(t.kinds.buffWave).toEqual([{ def: 'a' }, { def: 'b', fanOut: 'rubied' }]);
});
it('drops ONE bad entry and keeps the rest', () => {
  const t = parseTable({ kinds: { buffWave: [{ def: 'a' }, { def: '' }] }, cards: {} });
  expect(t.kinds.buffWave).toEqual([{ def: 'a' }]);
});
it('normalises an empty array to absent — [] is not a third state', () => {
  const t = parseTable({ kinds: { buffWave: [] }, cards: {} });
  expect(t.kinds.buffWave).toBeUndefined();
});
it('keeps a null tombstone', () => {
  const t = parseTable({ kinds: { buffWave: null }, cards: {} });
  expect(t.kinds.buffWave).toBeNull();
});
it('de-duplicates by def id, last wins', () => {
  const t = parseTable({ kinds: { buffWave: [{ def: 'a' }, { def: 'a', fanOut: 'damaged' }] }, cards: {} });
  expect(t.kinds.buffWave).toEqual([{ def: 'a', fanOut: 'damaged' }]);
});
it('writes a one-entry row back as a bare object', () => {
  expect(serialiseFor({ kinds: { buffWave: [{ def: 'a' }] }, cards: {} })).toContain('"buffWave": {');
});
```

- [ ] **Step 2:** run them — expect failures on the array cases.
- [ ] **Step 3: implement.** Change `BindingTable`/`LayerTable` leaves to `FxBinding[]` / `FxBinding[] | null`.
  Add `coerceRow(v, where): FxBinding[] | null | undefined` wrapping the existing `coerceBinding`; it accepts
  an object, an array, or `null`, and returns `undefined` for "drop this row". Teach `serialise` to unwrap a
  1-element row. Add `stagger?: number` and `'rubied'` to `FxBinding` (`FAN_OUTS` too) in the same step —
  they are part of the leaf type and splitting them costs a second pass over the same lines.
- [ ] **Step 4:** run — green.
- [ ] **Step 5:** add a guard that the REAL `bindings.json` round-trips byte-identically:

```ts
it('round-trips the committed file unchanged', async () => {
  const raw = (await import('./bindings.json')).default;
  expect(JSON.parse(serialiseFor(parseTable(raw)))).toEqual(raw);
});
```

- [ ] **Step 6: commit** — `refactor(fx): a binding row is a list (parse + serialise)`.

---

## Task 2 — read side

**Files:** `choreo/bindings.ts`, `choreo/bindings.test.ts`

- [ ] **Step 1:** write tests for `bindingsFor(cardId, kind): FxBinding[]` — card layer wins whole-row over
  the kind layer; a tombstone returns `[]` and stops; absent falls through.
- [ ] **Step 2:** implement `bindingsFor`, `bindingsBeneathDraft`, and make `bindingAt` return
  `{ bindings: FxBinding[] | null; source }`. **Keep `bindingFor` as a shim returning the first entry** so
  nothing outside this file breaks yet — it is deleted in T6.
- [ ] **Step 3:** `bindingsBeneathDraft` filters draft ENTRIES out of a row rather than treating the row as
  see-through. A row of `[real, draft]` must resolve to `[real]`, not fall through to the kind layer.
- [ ] **Step 4:** run — green. **Commit.**

---

## Task 3 — write side (the subtle one)

**Files:** `choreo/bindings.ts`, `choreo/bindings.test.ts`

- [ ] **Step 1: write the regression test FIRST — this is the bug that shipped before:**

```ts
it('committing a kind while a card DRAFT is live keeps the card row', () => {
  setBindingEntry('bloodbinder', 'scCast', { def: DRAFT_DEF_ID });   // rail-mode preview
  setBindingEntry(null, 'buffWave', { def: 'new-thing' });           // commit Everywhere
  const written = JSON.parse(bindingsJson());
  expect(written.cards.bloodbinder.scCast).toEqual({ def: 'ruby-lance', fanOut: 'damaged' });
  expect(JSON.stringify(written)).not.toContain(DRAFT_DEF_ID);
});
```

- [ ] **Step 2:** implement `setBindingEntry(cardId, kind, binding)` — resolves the current row, replaces the
  entry with the same `def` or appends, writes the whole row into the patch. `setBinding(…, null)` still
  writes a row tombstone.
- [ ] **Step 3:** implement `clearBindingEntry(cardId, kind, defId)` — removes one entry; a row left empty is
  deleted entirely (not left as `[]`, per the decision table). `clearBinding` still drops the whole row.
- [ ] **Step 4:** rewrite `persistablePatch` to strip draft ENTRIES from inside each row, then drop rows left
  empty. Today it drops a row whose single binding is the draft; a row of `[real, draft]` must persist as
  `[real]`.
- [ ] **Step 5:** `unbindJson(cardId, kind, op, defId?)` — with `defId`, remove that entry; without, the
  current whole-row behaviour. `bindingWithout` returns the row that would remain.
- [ ] **Step 6:** run — green. **Commit.**

---

## Task 4 — score.ts plays every entry, and the Ruby cue becomes data

**Files:** `choreo/score.ts`, `choreo/channels/rubyLanded.ts`, `choreo/bindings.json`, `choreo/score.test.ts`

- [ ] **Step 1:** in the `fxDef` channel, replace the single `binding` with `for (const binding of
  bindingsFor(cardId, moment.kind))`, keeping the existing `primary` / `damaged` / `selfBuffed` branches
  unchanged inside the loop.
- [ ] **Step 2:** add the `rubied` branch, moved verbatim from the `rubyFx` channel — `rubiedUidsIn`, anchors
  resolved inside each timer, stagger `binding.stagger ?? RUBY_STAGGER_MS` divided by `combatSpeed`.
- [ ] **Step 3:** delete the `rubyFx` channel, its `Channel` union member, and its two score rows. Drop
  `RUBY_LANDED_DEF`.
- [ ] **Step 4:** add the rows to `bindings.json`:

```json
"attackExchange": [
  { "def": "self-buff-gold", "fanOut": "selfBuffed" },
  { "def": "ruby-gem-apply", "fanOut": "rubied" }
],
"buffWave": [
  { "def": "self-buff-gold", "fanOut": "selfBuffed" },
  { "def": "ruby-gem-apply", "fanOut": "rubied" }
]
```

- [ ] **Step 5:** `ruby-gem-apply` now plays via a binding in combat but still via a literal `playDef` in
  `Recruit.tsx` (the shop has no binding surface — see `docs/fx-workbench-friction.md`). Update
  `fx/directCalls.ts` to `'ruby-gem-apply': ['Recruit.tsx']` and the id list in its test. **`npm test` prints
  the exact expected object on failure — paste it rather than hand-editing.**
- [ ] **Step 6:** run — green. **Commit.**

---

## Task 5 — consumers

**Files:** `fx/harness/commitPlan.ts` + test, `fx/harness/unbindPlan.ts`, `fx/ui/catalog.ts`,
`fx/harness/procScan.ts`, `fx/defStore.ts`, `fx/ui/Workbench.tsx`

- [ ] **Step 1:** `commitPlan` — a commit ADDS to the row. Its blast-radius summary must say "alongside N
  existing" rather than implying a replacement, or the panel will describe the wrong outcome.
- [ ] **Step 2:** `unbindPlan` — takes the def id being unbound and prints the entries that remain.
- [ ] **Step 3:** `catalog.ts` — coverage counts ENTRIES; a def bound alongside another must not read as
  unbound.
- [ ] **Step 4:** Workbench — the moment picker shows what is already bound at a kind (now possibly several)
  and the commit button reads "Add here", not "Bind here".
- [ ] **Step 5:** run — green. **Commit.**

---

## Task 6 — remove the shim, docs

- [ ] **Step 1:** delete `bindingFor`; fix any remaining caller.
- [ ] **Step 2:** update `docs/fx-workbench-guide.md` with the list format and `stagger`.
- [ ] **Step 3:** strike "One binding per moment kind" from `docs/fx-workbench-friction.md` (it moves to the
  devlog). **Leave "The shop phase has no binding surface at all" standing — this plan does not fix it.**
- [ ] **Step 4:** devlog + roadmap + README per CLAUDE.md. **Commit.**

---

## Task 7 — gate and PR

- [ ] `npm run typecheck && npm run lint && npm test && npm run build:web`, all green, reported.
- [ ] Open the PR. Call out in the body: the row-level-overlay decision and why, the draft-as-entry change,
  and the fact that `bindings.json` round-trips unchanged.

---

## Risks

| Risk | Mitigation |
|---|---|
| **Draft leaks into the committed file** — the bug that shipped once and cost a real binding | T3 Step 1 is that exact regression test, written before the implementation |
| Silent double-play: a def bound at both `buffWave` and `attackExchange` fires twice for one Ruby | moments partition the event stream, so ranges are disjoint — assert it with a test that compiles a real Rally fight and counts fires |
| A stale `localStorage` patch from before this change | the legacy bare-object parse covers it; add a test that feeds an old-shape patch |
| Merge conflict — `score.ts` and `bindings.ts` are hot | land T1–T3 (self-contained in `bindings.ts`) before touching `score.ts`; rebase between tasks |
