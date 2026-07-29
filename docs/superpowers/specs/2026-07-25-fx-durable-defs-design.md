# FX durable defs — design

**Date:** 2026-07-25 · **Status:** approved, implementing · **Branch:** `feat/fx-workbench-p1`

## Problem

The FX workbench can author an effect but cannot *keep* one. Its authoring loop terminates at
`copyDef` → `navigator.clipboard` (`fx/ui/Workbench.tsx`), which is the identical dead end all 41 legacy
tuner panels have. The legacy code states the ritual outright:

> `// Shipping a new feel is still a code change: dial it, Copy, paste into DEFAULTS above, commit.`
> — `lungeConfig.ts`

Consequences, all confirmed by audit:

- **A tuned effect is unrecoverable state.** Layers/params/palettes/curves/timings are plain `useState`. Lost
  on reload, on closing the panel, and on HMR — which editing any primitive *forces*, because primitives
  self-register (`fx/registry.ts`).
- **Nothing can read a def back.** No parser, no importer, no loader. `createPlayer` has exactly two call
  sites: the workbench and a test. No shipped effect uses the system.
- **Defs can't be shared.** The only artifact is clipboard JSON, and the receiving end doesn't exist.
- **Imported art doesn't travel.** A def naming `custom:my-shard` carries only the id; the PNG lives in the
  author's `localStorage`, so on another machine it silently renders a built-in fallback.

Durable defs is the keystone: one change that fixes persistence, sharing, and duplicate-as-template, and is
the precondition for the game ever referencing an effect by id.

## Approach

**Dev-only Vite middleware writing real files, plus localStorage autosave.** The two solve different
failures and neither covers the other:

- **Save** is deliberate and produces a *committed* artifact — that is what makes a def shareable via git and
  referenceable by id later.
- **Autosave** is a safety net for the HMR/reload/panel-close data loss. You do not want a git-tracked file
  written on every slider drag.

Rejected: localStorage-only export/import (fixes lost work, leaves defs stuck in the lab); File System Access
API (permission-prompt driven, effectively Chrome-only, worse daily DX than a Save button).

## Storage layout

```
packages/ui/src/fx/defs/<id>.json        # one committed def per file
packages/ui/src/fx/defs/art/<slug>.png   # imported art referenced by defs
```

`<id>` and `<slug>` are strict slugs: `^[a-z0-9][a-z0-9-]{0,63}$`.

## Def file format

```jsonc
{
  "version": 1,          // schema version — defs are about to become committed artifacts the game reads
  "id": "crit-impact",
  "duration": 1000,
  "layers": [
    { "primitive": "burst", "anchor": "target", "at": 0, "life": 400, "params": { /* … */ } }
  ]
}
```

`version` costs one line now and avoids a migration headache when `FxLayer` grows a field. A loaded def is
validated and coerced on the way in — never trusted — matching how the repo already treats content.

## Components

### 1. `fx/defStore.ts` — the client API (DEV-only)

The single seam both the UI and the middleware are written against.

```ts
export interface StoredFxDef { version: 1; id: string; duration: number; layers: FxLayer[] }
export type SaveResult = { ok: true; path: string } | { ok: false; error: string };

export async function saveDef(def: StoredFxDef): Promise<SaveResult>;
export async function saveArt(slug: string, dataUrl: string): Promise<SaveResult>;
export function parseDef(json: string): StoredFxDef | null;   // validate+coerce, never throws
export function saveSession(state: unknown): void;            // localStorage autosave
export function loadSession<T>(): T | null;
export function clearSession(): void;
```

`parseDef` runs every layer's params through the primitive's own `coerceParams`, so a malformed or
foreign-authored def degrades to defaults rather than breaking the workbench.

### 2. `fx/fxDefs.ts` — the def registry

Loads every committed def via `import.meta.glob('./defs/*.json', { eager: true })`.

```ts
export function listDefs(): StoredFxDef[];
export function getDef(id: string): StoredFxDef | undefined;
```

DEV-gated for now (nothing in prod can play a def yet — the primitives themselves are dev-only). The
game-side flip is a later sub-project; keeping the registry a real module now means that flip is a one-line
change, not a redesign.

### 3. The Vite dev plugin

`apply: 'serve'` only — it cannot exist in a production build. Two endpoints:

- `POST /__fx/def` `{ id, json }` → writes `defs/<id>.json`
- `POST /__fx/art` `{ slug, dataUrl }` → writes `defs/art/<slug>.png`

**Safety constraints (all mandatory):**

- dev-only (`apply: 'serve'`), never registered for `build`;
- `id`/`slug` must match the slug regex — rejects `..`, `/`, absolute paths, empty;
- the resolved output path must still be inside the defs directory after `path.resolve` (belt-and-braces
  traversal check);
- body size caps (def ≤ 256 KB, art ≤ 4 MB) and a `image/png` data-URL prefix check for art;
- writes only ever land under `packages/ui/src/fx/defs/`.

### 4. Art portability

On save, any layer param naming a `custom:` shape has its PNG written to `defs/art/<slug>.png` and the def
rewritten to reference `art:<slug>`. `shapeLibrary.ts` resolves `art:` ids from the committed folder (a glob,
same as defs). Result: defs stay small, art is versioned, and a def shared with the other developer actually
renders what its author saw.

### 5. Workbench UI

- **Save** — name field + button; slugifies, writes, and refreshes the library.
- **Def library** — list of committed defs; load, duplicate (load under a new name — the "template" workflow),
  and delete.
- **Paste def** — the missing counterpart to Copy: paste JSON, validate via `parseDef`, load it.
- **Autosave** — the current composition is written to `localStorage` on change (debounced) and restored when
  the workbench opens, with a "restored unsaved work" affordance to dismiss.

## Data flow

```
author tunes → autosave (localStorage, debounced)         [survives reload/HMR]
             → Save → POST /__fx/def → defs/<id>.json      [committed, shareable]
                    → POST /__fx/art → defs/art/<slug>.png [art travels]
open workbench → fxDefs registry (import.meta.glob) → library list → load → parseDef → editor state
```

## Error handling

Every failure degrades; none throws into render.

- Dev server unreachable / endpoint missing → Save reports an inline error; autosave and clipboard still work.
- Write rejected (bad slug, too large, traversal) → the endpoint returns a 4xx with a reason, surfaced inline.
- Malformed def on load/paste → `parseDef` returns `null`; the UI says so and leaves the current work intact.
- `localStorage` unavailable or full → autosave silently no-ops (matching `shapeLibrary.ts`'s existing
  discipline); Save is unaffected.
- A def naming art that isn't committed → falls back to a built-in shape, as today, and the picker marks it.

## Testing

Pure, headless-testable units carry the logic: the slug validator, the traversal guard, `parseDef`
(valid / malformed / foreign-primitive / out-of-range params → coerced), the art-reference rewrite, and the
session round-trip with a stubbed `localStorage`. The Vite plugin's request handler is written as a pure
function over `(body) → {status, payload, writePath}` so it can be tested without a running server. Browser
verification covers the actual save → file-on-disk → reload → load round trip.

## Out of scope (explicitly)

- The game playing defs (registry flip, anchor provider, `fxDef` Score channel) — the next sub-project.
- Preview fidelity against a real board.
- Known defects to fix separately: `fireOnce` bypassing `at`/`life`; timing sliders respawning mid-drag (and
  re-rolling the ribbon seed); no seed lock.
