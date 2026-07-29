# The authoring panel — design

**Date:** 2026-07-28
**Status:** approved (owner, 2026-07-28)
**Phase:** ③ of three, and the last. ① (bindings as data) shipped 2026-07-27; ② (the proc harness) shipped
2026-07-28.

## The problem

Phases ① and ② built both halves of a loop that doesn't yet close. ① made "which effect plays here" into
writable data with a live session layer and a dev endpoint that commits it. ② put a real, replayable combat
underneath the editor, so an effect can be watched on the real card at real scale.

What's missing is the join. Today, tuning an effect for a specific card means: edit in the workbench, Save
(rewriting a git-tracked file), hand-edit `bindings.json`, reload, play a fight, and repeat. Every iteration
touches the working tree and costs a context switch.

**Three findings from the codebase shaped this design:**

- **The entire binding write path is built, tested, and has zero UI callers.** `setBinding`, `resetBindings`
  and `bindingsJson` in `choreo/bindings.ts` are called only by their own tests, and `POST /__fx/bindings`
  has no client wrapper at all — unlike defs, which have `saveDef` in `defStore.ts`. Phase ① built exactly
  the machine this phase drives.
- **The harness owns its card selection privately.** `ProcHarness` keeps `cardId` in local state and hands
  nothing back. Commit needs `(cardId, kind)`, so that seam has to open.
- **A committed binding does not take effect in the running session.** `COMMITTED` is parsed once at module
  load, so a write to `bindings.json` only lands after HMR re-evaluates. The *session patch*, by contrast,
  applies instantly and `bindingFor` reads it first. That split is what makes a live preview possible at all.

## Decisions

| Question | Chosen | Rejected, and why |
|---|---|---|
| How the live loop gets an in-progress edit onto the card | **An in-memory draft def** registered in-session and bound via the session patch | Saving to disk each iteration — rewrites a tracked file on every look, exactly what the def/session split exists to prevent. No live binding — gives up the thing the tool is for |
| What card-only scope means | **Fork the def**, with the blast radius shown before you commit | Bind the same def id card-scoped — achieves nothing, since editing the shared def already changed it for every card. Make the user fork manually — silent, destructive failure mode |
| An uncommitted draft | **Discarded on leaving rail mode** | Persist it — survives into normal play with nothing on screen explaining why, and after a reload the binding points at a def the registry no longer has |
| Where the commit logic lives | **A pure `planCommit` module** + a thin panel | Logic in the component — untestable by construction, no jsdom in this repo. Extending `save()` — conflates "write this file" with "make this card play this" |

## Architecture

```
rail mode: pick card + moment (harness) · tune (editor)
   ↓  every edit
draft: registerSavedDef(draftId) + setBinding(cardId, kind, { def: draftId })
   ↓  re-seek the moment → the real card plays your current edit
COMMIT ANIMATION
   ↓  card-only → fork: write <name>-<card>.json, bind cards[card][kind]
   ↓  global    → overwrite: write <name>.json,   bind kinds[kind]
   ↓  both      → POST /__fx/bindings, drop the draft
leave rail mode → draft def + session binding discarded
```

This introduces one concept: a def is in exactly one of three states, and the UI must always say which.

| State | Where it lives | Survives a reload? |
|---|---|---|
| **Committed** | a file on disk, referenced by `bindings.json` | yes |
| **Draft** | in-memory registry + the session patch | no — discarded on leaving rail mode |
| **Editor content** | the workbench's own state, bound to nothing | via the editor's existing autosave |

**Commit must not call `resetBindings()`.** The file write doesn't reach the running session until HMR
re-evaluates the module, so clearing the patch at commit time would make the effect vanish at the exact
moment you committed it. The patch is dropped on leaving rail mode, by which point the file is authoritative.

### The draft's identity

The draft is registered under a single fixed id, **`fx-draft`**. One draft exists at a time — you are tuning
one effect for one card — so a generated or name-derived id would buy nothing and would leave a trail of
stale overlays in the registry as the name field changed. A fixed id also makes the draft trivially
recognisable in the library and in any `[fx]` console line, which matters when the question is "is what I'm
watching saved or not".

It is never written to disk: `registerSavedDef` overlays it in memory only, and `saveDef` is called at commit
time with the *real* id from the plan. Because the id is fixed and unsaved, it cannot collide with a
committed def and cannot survive a reload.

### When no card is selected

Commit requires `(cardId, kind)`. Until a card is picked *and* a moment row selected, the button is disabled
and says which of the two is missing — the workbench still works exactly as it does today, editing content
bound to nothing. This is the third state in the table above, and it is the normal state outside rail mode.

## Units

### `packages/ui/src/fx/harness/commitPlan.ts` — pure

Every decision lives here, so every decision is testable.

```ts
export interface CommitInput {
  scope: 'card' | 'global';
  /** The editor's current name field, slugified — the def id for a global commit. */
  baseId: string;
  cardId: string;
  kind: MomentKind;
  fanOut: FxBinding['fanOut'];
  /** Ids already in the registry — for the "overwrites existing" determination. */
  knownDefIds: readonly string[];
  /** The live tables, for the blast radius. */
  tables: BindingTable;
}

export interface CommitPlan {
  scope: 'card' | 'global';
  /** What gets written — the forked id under card scope, `baseId` under global. */
  defId: string;
  /** The def being forked from, or null for a plain write. */
  forkedFrom: string | null;
  /** True when `defId` already exists — a re-tune, not a new def. */
  overwritesExisting: boolean;
  binding: FxBinding;
  bindingTarget: { cardId: string | null; kind: MomentKind };
  /** Every OTHER place the def being written is referenced. Empty for a fresh fork. */
  alsoAffects: { cardId: string | null; kind: MomentKind }[];
}

export function planCommit(input: CommitInput): CommitPlan;
```

`alsoAffects` is computed by scanning `tables` for every entry whose `def` matches the id being written. It
is the number the panel shows before anything happens, and it is the single most important thing to get
right: "which other cards inherit this change" is not a question to answer by eye.

**Fork naming** is `<baseId>-<cardId>`. The endpoint enforces `^[a-z0-9][a-z0-9-]{0,63}$`, so an over-long
pair is truncated deterministically to 64 characters rather than being rejected at write time.

### `packages/ui/src/fx/defStore.ts` — one addition

```ts
export async function saveBindings(json: string): Promise<SaveResult>;
```

POSTs `{ json }` to `/__fx/bindings`, mirroring `saveDef` exactly — fails closed outside DEV, never throws,
always resolves a `SaveResult`. That endpoint has existed since phase ① with no client; this is the client.

### `packages/ui/src/fx/harness/CommitPanel.tsx`

Scope toggle, the resulting def id, the blast-radius line, a `fanOut` select, and the button. Thin by
design: nothing worth asserting lives here, because nothing here can be tested.

### `packages/ui/src/fx/harness/ProcHarness.tsx` — modified

`cardId` lifts to props so the workbench can see it. Clicking a moment row now **selects** it as well as
seeking to it, making `(cardId, kind)` a natural product of the action the author was already taking.

### `packages/ui/src/fx/ui/Workbench.tsx` — modified

Owns the selection state and the draft lifecycle: register the composition under a draft id as it changes,
`setBinding` to it, and tear both down on leaving rail mode.

## `fanOut`, and why it is prefilled rather than chosen

A binding carries `fanOut`, which decides **how many copies of the effect play and on which units**:

| Value | Means | Example |
|---|---|---|
| `primary` | once, between the two units the moment names | a normal attack, attacker → defender |
| `damaged` | one per enemy damaged in that moment | Bloodbinder's bleed, which hits several marked enemies at once |
| `selfBuffed` | one per unit that buffed itself | Target Dummy growing its own Attack |

The wrong value is a silent failure: a travelling effect set to `primary` on a cast whose event names no
target collapses onto the caster; a self-buff effect set to `primary` plays once on whichever unit came
first and not at all on the others.

So it **prefills from `bindingFor(cardId, kind)`** — whatever is currently playing at that card and moment.
Replacing Target Dummy's self-buff inherits `selfBuffed`; replacing Bloodbinder's inherits `damaged`. Only a
genuinely new binding falls back to `primary`. The control stays visible either way, so the value being
written is never invisible.

## Commit order and failure

**The def file is written first, then `bindings.json`. Never the reverse.**

| Failure | Result |
|---|---|
| Def write fails | Abort; no binding written. Nothing changed anywhere, and the draft stays live so no tuning is lost. |
| Binding write fails | An unbound def file — a library entry nothing plays. The error names what to retry. |

Neither path can leave a binding pointing at a def that does not exist, which is this subsystem's signature
failure and the reason the order is fixed rather than incidental.

## Testing

`planCommit` gets real unit tests: fork naming including the truncation case; blast radius over a table with
several references to one def; card-vs-global targeting; `fanOut` inheritance (the case that would otherwise
silently mis-bind a self-buff); and `overwritesExisting` for a re-tune of an existing fork.

`CommitPanel` gets none — this repo has no jsdom and no `@testing-library/react`, so React components cannot
be tested here. It stays thin enough that this costs nothing.

The write ordering is verified by a browser pass: commit, confirm the def file lands, confirm the binding
lands, confirm the card plays it.

## A limitation to record

Immediately after commit, the running session is still showing the **draft** binding from the session patch;
the committed file does not reach `COMMITTED` until HMR re-evaluates the module. What you see is correct, but
correct for the wrong reason. Leaving rail mode drops the patch, and the file is authoritative from then on.

This is recorded so nobody later "fixes" it by calling `resetBindings()` at commit time — which would make
the effect vanish at the exact moment you committed it.

## Scope

**In:** the four units above, the `defStore` addition, the draft lifecycle, and the `planCommit` tests.

**Out:** editing a def's `label`/`tags` from the panel (the library browser reads them; authoring them is its
own small feature). Deleting or unbinding from the panel — `setBinding(…, null)` exists and works, but a
delete affordance needs its own confirmation design. Any change to what an effect *is* (①) or to how a fight
is staged (②).
