# In-Run UI Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dev-only, direct-manipulation editor for the in-run DOM UI (cards, HUD, shop, panels, text) that applies live edits via an injected override stylesheet and emits a copyable summary the user pastes into chat.

**Architecture:** Approach A — the editor writes one CSS rule per edited element into a single injected `<style id="ui-editor-overrides">`, so React re-renders and GSAP's inline writes don't clobber it. A `localStorage`-backed scratchpad (persisted synchronously on every edit — no debounce, avoiding the FX-workbench Save-bug class) holds the model; a serializer turns it into the paste-ready summary. Asset uploads POST to a dev-only Vite route that writes a real file to disk, mirroring `apps/web/fxDefsPlugin.ts`.

**Tech Stack:** TypeScript, React, Zustand (existing), Vitest (Node env — **no jsdom**), Vite plugin middleware. All new UI code under `packages/ui/src/uiEditor/`; the upload route under `apps/web/`.

## Global Constraints

- **Presentation seam only.** No changes to `packages/core`, `packages/content`, or `packages/sim`. Nothing touches shared types or the hot chokepoint files (`store.ts`, `state.ts`, `reducer.ts`, `types.ts`).
- **Dev-only.** The editor mounts under `import.meta.env.DEV` (like `DevMenu`); the upload plugin is `apply: 'serve'` (like `fxDefsPlugin`). Neither may reach the production bundle.
- **No `Math.random`** anywhere reachable from `core`/`content`/`sim` (not relevant here, but the ESLint ban is global).
- **Vitest runs in Node with no DOM.** Pure logic (resolver, selector, transforms, scratchpad, rule text, upload validator) is tested with hand-rolled fake `Element` objects cast `as unknown as Element` — the established shim pattern (see `packages/ui/src/publicAssetPaths.test.ts`, `apps/web/fxDefsPlugin.test.ts`). DOM-touching code (the injected sheet, the overlay) is verified live in the dev server, not unit-tested.
- **Gates before "done":** `npm run typecheck && npm run lint && npm test && npm run build:web` all green. Run `npm install` inside the worktree first so imports resolve locally.
- **Living docs** (`docs/devlog.md`, `docs/roadmap.md`, `README.md`) are updated in the final task; the branch squash-merges to one commit.
- **Never push to `main`.** Feature branch → PR → wait for `verify` green → squash-merge.

## File Structure

```
packages/ui/src/uiEditor/
  config.ts          on/off mode state + subscribe (localStorage-backed)   [Task 1]
  resolver.ts        click target → nearest meaningful anchor element        [Task 2]
  selector.ts        Scope + buildSelector + matchCount                      [Task 3]
  transforms.ts      pure move/resize math → CSS prop strings                [Task 4]
  scratchpad.ts      EditEntry model + ruleText + toSummary + (de)serialize  [Task 5]
  overrideSheet.ts   injected <style> writer consuming EditEntry             [Task 6]
  EditorOverlay.tsx  the React overlay: mode, selection box, toolbar, edits  [Task 8]
apps/web/
  uiAssetPlugin.ts   /__ui/asset dev route (planUiAsset validator + plugin)  [Task 7]
```

Wiring touch-points: `packages/ui/src/DevMenu.tsx` (toggle row, Task 8), `packages/ui/src/Game.tsx` (dev-only mount, Task 8), `apps/web/vite.config.ts` (register plugin, Task 7).

---

### Task 1: Edit-mode state — `uiEditor/config.ts`

Module-level on/off state with best-effort `localStorage` persistence and a listener set, so the DevMenu toggle and the overlay stay in sync. Pattern mirrors `boardConfig.ts` (guarded `localStorage`, side-effect apply at load) but adds a subscription because two components observe it.

**Files:**
- Create: `packages/ui/src/uiEditor/config.ts`
- Test: `packages/ui/src/uiEditor/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parseMode(raw: string | null): boolean`
  - `isUiEditMode(): boolean`
  - `setUiEditMode(on: boolean): void`
  - `subscribeUiEditMode(fn: (on: boolean) => void): () => void` (returns an unsubscribe)

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/uiEditor/config.test.ts
import { describe, it, expect } from 'vitest';
import { parseMode, isUiEditMode, setUiEditMode, subscribeUiEditMode } from './config';

describe('parseMode', () => {
  it('is off by default (null / unknown values)', () => {
    expect(parseMode(null)).toBe(false);
    expect(parseMode('nonsense')).toBe(false);
    expect(parseMode('0')).toBe(false);
  });
  it('is on only for the exact "1" flag', () => {
    expect(parseMode('1')).toBe(true);
  });
});

describe('mode state + subscription', () => {
  it('set updates the getter and notifies subscribers', () => {
    const seen: boolean[] = [];
    const off = subscribeUiEditMode((on) => seen.push(on));
    setUiEditMode(true);
    expect(isUiEditMode()).toBe(true);
    setUiEditMode(false);
    expect(isUiEditMode()).toBe(false);
    off();
    setUiEditMode(true); // no longer observed
    expect(seen).toEqual([true, false]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/uiEditor/config.test.ts`
Expected: FAIL — cannot resolve `./config`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/uiEditor/config.ts
/**
 * DEV-only "UI Edit Mode" flag. Two components observe it — the DevMenu toggle and the EditorOverlay — so it
 * carries a small listener set on top of the boardConfig-style guarded-localStorage persistence.
 */
const KEY = 'ascent.uiEdit';

export function parseMode(raw: string | null): boolean {
  return raw === '1';
}

function load(): boolean {
  try {
    return parseMode(localStorage.getItem(KEY));
  } catch {
    return false;
  }
}

let current = load();
const listeners = new Set<(on: boolean) => void>();

export function isUiEditMode(): boolean {
  return current;
}

export function setUiEditMode(on: boolean): void {
  current = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode / no storage — in-memory state still updates */
  }
  for (const fn of listeners) fn(on);
}

export function subscribeUiEditMode(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/src/uiEditor/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/uiEditor/config.ts packages/ui/src/uiEditor/config.test.ts
git commit -m "feat(ui-editor): edit-mode flag with subscription"
```

---

### Task 2: Anchor resolver — `uiEditor/resolver.ts`

A click lands on a deep inner node (a glyph inside a pill). Walk up `parentElement` to the nearest **meaningful anchor**: an element carrying an anchor data-attr, or whose class list contains a known component class. Also expose `selectParent` for the toolbar's "select parent ▲".

**Files:**
- Create: `packages/ui/src/uiEditor/resolver.ts`
- Test: `packages/ui/src/uiEditor/resolver.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ANCHOR_ATTRS: readonly string[]` = `['data-uid','data-zone','data-ui','data-hud','data-pill']`
  - `ANCHOR_CLASSES: readonly string[]` = `['card','cgem','badge','pill','row','hud']`
  - `isAnchor(el: Element): boolean`
  - `resolveAnchor(el: Element): Element` (nearest anchor at or above `el`; falls back to `el`)
  - `selectParent(el: Element): Element | null` (nearest anchor strictly above `el`)

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/uiEditor/resolver.test.ts
import { describe, it, expect } from 'vitest';
import { resolveAnchor, selectParent, isAnchor } from './resolver';

/** Minimal fake Element: only the members resolver reads. */
function node(opts: {
  attrs?: Record<string, string>;
  classes?: string[];
  parent?: Element | null;
}): Element {
  const attrs = opts.attrs ?? {};
  const classes = new Set(opts.classes ?? []);
  return {
    getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
    classList: { contains: (c: string) => classes.has(c) },
    parentElement: opts.parent ?? null,
  } as unknown as Element;
}

describe('resolveAnchor', () => {
  it('returns the nearest known-class ancestor, not the outermost', () => {
    const card = node({ attrs: { 'data-uid': 'abc' }, classes: ['card'] });
    const cgem = node({ classes: ['cgem'], parent: card });
    const glyph = node({ parent: cgem }); // clicked target
    expect(resolveAnchor(glyph)).toBe(cgem);
  });
  it('resolves an element that is itself an anchor to itself', () => {
    const pill = node({ classes: ['pill'] });
    expect(resolveAnchor(pill)).toBe(pill);
  });
  it('falls back to the original element when nothing up-chain is an anchor', () => {
    const outer = node({});
    const inner = node({ parent: outer });
    expect(resolveAnchor(inner)).toBe(inner);
  });
  it('treats any anchor data-attr as an anchor', () => {
    expect(isAnchor(node({ attrs: { 'data-ui': 'hud-gold' } }))).toBe(true);
    expect(isAnchor(node({}))).toBe(false);
  });
});

describe('selectParent', () => {
  it('skips the element itself and returns the next anchor above', () => {
    const zone = node({ attrs: { 'data-zone': 'warband' } });
    const card = node({ classes: ['card'], parent: zone });
    expect(selectParent(card)).toBe(zone);
  });
  it('returns null when there is no anchor above', () => {
    const root = node({});
    const card = node({ classes: ['card'], parent: root });
    expect(selectParent(card)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/uiEditor/resolver.test.ts`
Expected: FAIL — cannot resolve `./resolver`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/uiEditor/resolver.ts
/**
 * Click-target → nearest meaningful element. A raw pointer target is usually a leaf glyph; the editor should
 * select the pill/card/row it belongs to. "Meaningful" = carries an anchor data-attr, or has a known component
 * class. Ranked by proximity (nearest wins), so a `.cgem` inside a `.card` selects the cgem.
 */
export const ANCHOR_ATTRS = ['data-uid', 'data-zone', 'data-ui', 'data-hud', 'data-pill'] as const;
export const ANCHOR_CLASSES = ['card', 'cgem', 'badge', 'pill', 'row', 'hud'] as const;

export function isAnchor(el: Element): boolean {
  for (const a of ANCHOR_ATTRS) if (el.getAttribute(a) !== null) return true;
  for (const c of ANCHOR_CLASSES) if (el.classList.contains(c)) return true;
  return false;
}

export function resolveAnchor(el: Element): Element {
  let cur: Element | null = el;
  while (cur) {
    if (isAnchor(cur)) return cur;
    cur = cur.parentElement;
  }
  return el; // nothing up-chain qualifies — edit the clicked element directly
}

export function selectParent(el: Element): Element | null {
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (isAnchor(cur)) return cur;
    cur = cur.parentElement;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/src/uiEditor/resolver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/uiEditor/resolver.ts packages/ui/src/uiEditor/resolver.test.ts
git commit -m "feat(ui-editor): anchor resolver for click targets"
```

---

### Task 3: Selector generation — `uiEditor/selector.ts`

Turn a selected element into a stable, specific-enough CSS selector, honoring the **scope** choice: `this-element` (exact, uses the per-instance id) vs `all-like-this` (strips per-run ids, scopes by zone + class). Plus a thin `matchCount` for the toolbar's blast-radius readout.

**Files:**
- Create: `packages/ui/src/uiEditor/selector.ts`
- Test: `packages/ui/src/uiEditor/selector.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Scope = 'this-element' | 'all-like-this'`
  - `buildSelector(el: Element, scope: Scope): string`
  - `matchCount(selector: string, root?: ParentNode): number`

Selector rules (first match wins):
- `this-element`: `data-uid` → `.card[data-uid="X"]` (or `[data-uid="X"]` if no `card` class); else `data-ui` → `[data-ui="X"]`; else `tag.firstStableClass` (or bare `tag`).
- `all-like-this`: `data-ui` (already stable) → `[data-ui="X"]`; else, if a `data-zone` ancestor exists and the element has a stable class → `[data-zone="Z"] .cls`; else `.firstStableClass` (or bare `tag`).
- A "stable class" is the element's first class that is **not** in `VOLATILE_CLASSES` (transient animation/state classes). Start with `VOLATILE_CLASSES = ['dragging','buffpop','flip','selected','active','hover']`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/uiEditor/selector.test.ts
import { describe, it, expect } from 'vitest';
import { buildSelector } from './selector';

function node(opts: {
  tag?: string;
  attrs?: Record<string, string>;
  classes?: string[];
  parent?: Element | null;
}): Element {
  const attrs = opts.attrs ?? {};
  const classes = opts.classes ?? [];
  return {
    tagName: (opts.tag ?? 'div').toUpperCase(),
    getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
    classList: {
      contains: (c: string) => classes.includes(c),
      item: (i: number) => classes[i] ?? null,
      length: classes.length,
    },
    parentElement: opts.parent ?? null,
  } as unknown as Element;
}

describe('buildSelector — this-element', () => {
  it('uses data-uid with the card class', () => {
    const el = node({ attrs: { 'data-uid': 'abc' }, classes: ['card'] });
    expect(buildSelector(el, 'this-element')).toBe('.card[data-uid="abc"]');
  });
  it('uses data-ui when present', () => {
    const el = node({ attrs: { 'data-ui': 'hud-gold' }, classes: ['hud'] });
    expect(buildSelector(el, 'this-element')).toBe('[data-ui="hud-gold"]');
  });
});

describe('buildSelector — all-like-this', () => {
  it('scopes a card by its zone ancestor and class, dropping the uid', () => {
    const zone = node({ attrs: { 'data-zone': 'warband' } });
    const el = node({ attrs: { 'data-uid': 'abc' }, classes: ['card'], parent: zone });
    expect(buildSelector(el, 'all-like-this')).toBe('[data-zone="warband"] .card');
  });
  it('keeps a data-ui selector stable', () => {
    const el = node({ attrs: { 'data-ui': 'hud-gold' } });
    expect(buildSelector(el, 'all-like-this')).toBe('[data-ui="hud-gold"]');
  });
  it('skips a volatile first class', () => {
    const el = node({ classes: ['dragging', 'pill'] });
    expect(buildSelector(el, 'all-like-this')).toBe('.pill');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/uiEditor/selector.test.ts`
Expected: FAIL — cannot resolve `./selector`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/uiEditor/selector.ts
export type Scope = 'this-element' | 'all-like-this';

const VOLATILE_CLASSES = ['dragging', 'buffpop', 'flip', 'selected', 'active', 'hover'];

function stableClass(el: Element): string | null {
  const list = el.classList;
  for (let i = 0; i < list.length; i++) {
    const c = list.item(i);
    if (c && !VOLATILE_CLASSES.includes(c)) return c;
  }
  return null;
}

function tag(el: Element): string {
  return el.tagName.toLowerCase();
}

function zoneAncestor(el: Element): string | null {
  let cur: Element | null = el;
  while (cur) {
    const z = cur.getAttribute('data-zone');
    if (z !== null) return z;
    cur = cur.parentElement;
  }
  return null;
}

export function buildSelector(el: Element, scope: Scope): string {
  const ui = el.getAttribute('data-ui');
  const cls = stableClass(el);

  if (scope === 'this-element') {
    const uid = el.getAttribute('data-uid');
    if (uid !== null) return `${cls ? `.${cls}` : ''}[data-uid="${uid}"]`;
    if (ui !== null) return `[data-ui="${ui}"]`;
    return cls ? `${tag(el)}.${cls}` : tag(el);
  }

  // all-like-this
  if (ui !== null) return `[data-ui="${ui}"]`;
  const zone = zoneAncestor(el);
  if (zone !== null && cls) return `[data-zone="${zone}"] .${cls}`;
  return cls ? `.${cls}` : tag(el);
}

export function matchCount(selector: string, root: ParentNode = document): number {
  try {
    return root.querySelectorAll(selector).length;
  } catch {
    return 0; // invalid selector typed into the editable field
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/src/uiEditor/selector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/uiEditor/selector.ts packages/ui/src/uiEditor/selector.test.ts
git commit -m "feat(ui-editor): scope-aware selector generation"
```

---

### Task 4: Move/resize math — `uiEditor/transforms.ts`

Pure conversion of drag gestures to CSS property strings. Keeps the overlay's pointer handlers thin and lets the tricky math (transform composition, aspect-locked resize) be unit-tested.

**Files:**
- Create: `packages/ui/src/uiEditor/transforms.ts`
- Test: `packages/ui/src/uiEditor/transforms.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `composeTransform(t: { x: number; y: number }, scale: number): string`
  - `resizeToPx(base: { w: number; h: number }, dW: number, dH: number, keepAspect: boolean): { width: string; height: string }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/uiEditor/transforms.test.ts
import { describe, it, expect } from 'vitest';
import { composeTransform, resizeToPx } from './transforms';

describe('composeTransform', () => {
  it('emits translate then scale, omitting a 1x scale', () => {
    expect(composeTransform({ x: 4, y: -6 }, 1)).toBe('translate(4px, -6px)');
    expect(composeTransform({ x: 0, y: 0 }, 1.08)).toBe('scale(1.08)');
    expect(composeTransform({ x: 4, y: -6 }, 1.08)).toBe('translate(4px, -6px) scale(1.08)');
  });
  it('is the empty string for the identity transform', () => {
    expect(composeTransform({ x: 0, y: 0 }, 1)).toBe('');
  });
});

describe('resizeToPx', () => {
  it('adds deltas to the base box', () => {
    expect(resizeToPx({ w: 100, h: 50 }, 20, 10, false)).toEqual({ width: '120px', height: '60px' });
  });
  it('locks aspect to the width delta when keepAspect', () => {
    expect(resizeToPx({ w: 100, h: 50 }, 20, 999, true)).toEqual({ width: '120px', height: '60px' });
  });
  it('never produces a non-positive dimension', () => {
    expect(resizeToPx({ w: 30, h: 30 }, -100, -100, false)).toEqual({ width: '1px', height: '1px' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/uiEditor/transforms.test.ts`
Expected: FAIL — cannot resolve `./transforms`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/uiEditor/transforms.ts
/** Round to at most 2 decimals and drop a trailing ".0". */
function n(v: number): string {
  return String(Math.round(v * 100) / 100);
}

export function composeTransform(t: { x: number; y: number }, scale: number): string {
  const parts: string[] = [];
  if (t.x !== 0 || t.y !== 0) parts.push(`translate(${n(t.x)}px, ${n(t.y)}px)`);
  if (scale !== 1) parts.push(`scale(${n(scale)})`);
  return parts.join(' ');
}

export function resizeToPx(
  base: { w: number; h: number },
  dW: number,
  dH: number,
  keepAspect: boolean,
): { width: string; height: string } {
  let w = base.w + dW;
  let h = keepAspect ? base.h * (w / base.w) : base.h + dH;
  w = Math.max(1, w);
  h = Math.max(1, h);
  return { width: `${n(w)}px`, height: `${n(h)}px` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/src/uiEditor/transforms.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/uiEditor/transforms.ts packages/ui/src/uiEditor/transforms.test.ts
git commit -m "feat(ui-editor): pure move/resize math"
```

---

### Task 5: Scratchpad model, rule text & summary — `uiEditor/scratchpad.ts`

The pure data model (one `EditEntry` per selector), the CSS **rule text** builder (consumed by the injected sheet in Task 6), the **summary** serializer (the paste-to-chat output), and JSON (de)serialization for the `localStorage` mirror. All pure — no DOM.

**Files:**
- Create: `packages/ui/src/uiEditor/scratchpad.ts`
- Test: `packages/ui/src/uiEditor/scratchpad.test.ts`

**Interfaces:**
- Consumes: `Scope` from `./selector`.
- Produces:
  - `interface EditEntry { selector: string; scope: Scope; props: Record<string, string>; assetPath?: string }`
  - `type Scratchpad = Record<string, EditEntry>` (keyed by `selector`)
  - `upsertProp(sp: Scratchpad, selector: string, scope: Scope, prop: string, value: string): Scratchpad`
  - `setAsset(sp: Scratchpad, selector: string, scope: Scope, assetPath: string): Scratchpad`
  - `removeEntry(sp: Scratchpad, selector: string): Scratchpad`
  - `ruleText(entry: EditEntry): string` (e.g. `.card { transform: translate(...); }`)
  - `toSummary(sp: Scratchpad, counts: Record<string, number>): string`
  - `serialize(sp: Scratchpad): string`
  - `deserialize(raw: string | null): Scratchpad`

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/src/uiEditor/scratchpad.test.ts
import { describe, it, expect } from 'vitest';
import {
  upsertProp, setAsset, removeEntry, ruleText, toSummary, serialize, deserialize,
  type Scratchpad,
} from './scratchpad';

describe('scratchpad model', () => {
  it('upserts props under a selector without mutating the input', () => {
    const a: Scratchpad = {};
    const b = upsertProp(a, '.pill', 'all-like-this', 'font-size', '22px');
    expect(a).toEqual({}); // immutability
    expect(b['.pill'].props).toEqual({ 'font-size': '22px' });
    const c = upsertProp(b, '.pill', 'all-like-this', 'color', '#fff');
    expect(c['.pill'].props).toEqual({ 'font-size': '22px', color: '#fff' });
  });
  it('records an uploaded asset', () => {
    const sp = setAsset({}, '.medallion', 'all-like-this', 'assets/ui-editor/m.png');
    expect(sp['.medallion'].assetPath).toBe('assets/ui-editor/m.png');
  });
  it('removes an entry', () => {
    const sp = upsertProp({}, '.pill', 'this-element', 'opacity', '0.5');
    expect(removeEntry(sp, '.pill')).toEqual({});
  });
});

describe('ruleText', () => {
  it('renders a selector rule with declarations and a background-image for the asset', () => {
    const entry = {
      selector: '.medallion', scope: 'all-like-this' as const,
      props: { 'border-radius': '12px' }, assetPath: 'assets/ui-editor/m.png',
    };
    expect(ruleText(entry)).toBe(
      ".medallion { border-radius: 12px; background-image: url('assets/ui-editor/m.png'); }",
    );
  });
});

describe('toSummary', () => {
  it('emits one block per entry with selector, scope, props and match count', () => {
    let sp: Scratchpad = {};
    sp = upsertProp(sp, '[data-ui="hud-gold"]', 'this-element', 'font-size', '22px');
    sp = upsertProp(sp, '[data-ui="hud-gold"]', 'this-element', 'color', '#ffd76b');
    const out = toSummary(sp, { '[data-ui="hud-gold"]': 1 });
    expect(out).toContain('UI-EDIT');
    expect(out).toContain('selector: [data-ui="hud-gold"]   (matches 1)');
    expect(out).toContain('scope: this-element');
    expect(out).toContain('font-size: 22px');
    expect(out).toContain('color: #ffd76b');
  });
});

describe('serialize / deserialize', () => {
  it('round-trips the scratchpad', () => {
    const sp = upsertProp({}, '.pill', 'this-element', 'opacity', '0.5');
    expect(deserialize(serialize(sp))).toEqual(sp);
  });
  it('returns an empty scratchpad for null or garbage', () => {
    expect(deserialize(null)).toEqual({});
    expect(deserialize('not json')).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/uiEditor/scratchpad.test.ts`
Expected: FAIL — cannot resolve `./scratchpad`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/ui/src/uiEditor/scratchpad.ts
import type { Scope } from './selector';

export interface EditEntry {
  selector: string;
  scope: Scope;
  props: Record<string, string>;
  assetPath?: string;
}
export type Scratchpad = Record<string, EditEntry>;

function ensure(sp: Scratchpad, selector: string, scope: Scope): EditEntry {
  return sp[selector] ?? { selector, scope, props: {} };
}

export function upsertProp(
  sp: Scratchpad, selector: string, scope: Scope, prop: string, value: string,
): Scratchpad {
  const entry = ensure(sp, selector, scope);
  return { ...sp, [selector]: { ...entry, scope, props: { ...entry.props, [prop]: value } } };
}

export function setAsset(sp: Scratchpad, selector: string, scope: Scope, assetPath: string): Scratchpad {
  const entry = ensure(sp, selector, scope);
  return { ...sp, [selector]: { ...entry, scope, assetPath } };
}

export function removeEntry(sp: Scratchpad, selector: string): Scratchpad {
  const next = { ...sp };
  delete next[selector];
  return next;
}

/** Ordered declaration list for an entry — props first, then the asset as a background-image. */
function declarations(entry: EditEntry): string[] {
  const decls = Object.entries(entry.props).map(([k, v]) => `${k}: ${v};`);
  if (entry.assetPath) decls.push(`background-image: url('${entry.assetPath}');`);
  return decls;
}

export function ruleText(entry: EditEntry): string {
  return `${entry.selector} { ${declarations(entry).join(' ')} }`;
}

export function toSummary(sp: Scratchpad, counts: Record<string, number>): string {
  const blocks = Object.values(sp).map((entry) => {
    const count = counts[entry.selector] ?? 0;
    const lines = [
      `  selector: ${entry.selector}   (matches ${count})`,
      `  scope: ${entry.scope}`,
      ...Object.entries(entry.props).map(([k, v]) => `  ${k}: ${v}`),
    ];
    if (entry.assetPath) lines.push(`  background-image: url('${entry.assetPath}')   [uploaded]`);
    return lines.join('\n');
  });
  return ['UI-EDIT', blocks.join('\n--\n')].join('\n');
}

export function serialize(sp: Scratchpad): string {
  return JSON.stringify(sp);
}

export function deserialize(raw: string | null): Scratchpad {
  if (!raw) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Scratchpad) : {};
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/src/uiEditor/scratchpad.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/uiEditor/scratchpad.ts packages/ui/src/uiEditor/scratchpad.test.ts
git commit -m "feat(ui-editor): scratchpad model, rule text, summary"
```

---

### Task 6: Injected override stylesheet — `uiEditor/overrideSheet.ts`

The one DOM-touching core: owns `<style id="ui-editor-overrides">`, upserts a rule per selector from an `EditEntry`, and clears rules. Thin by design — the rule string comes from Task 5's tested `ruleText`. Verified live (Node has no `document`), so no unit test; correctness of the rule text is already covered.

**Files:**
- Create: `packages/ui/src/uiEditor/overrideSheet.ts`

**Interfaces:**
- Consumes: `EditEntry`, `ruleText` from `./scratchpad`.
- Produces:
  - `applyEntry(entry: EditEntry): void`
  - `clearRule(selector: string): void`
  - `clearAll(): void`
  - `applyAll(sp: Record<string, EditEntry>): void`

- [ ] **Step 1: Write the implementation**

```ts
// packages/ui/src/uiEditor/overrideSheet.ts
import { ruleText, type EditEntry, type Scratchpad } from './scratchpad';

/**
 * A single injected stylesheet the editor owns. Rules here survive React reconciliation and GSAP's inline
 * writes (they live outside the element's `style` prop) — the whole reason Approach A works. Each edited
 * selector maps to exactly one rule, replaced wholesale on every change.
 */
const STYLE_ID = 'ui-editor-overrides';
const ruleIndex = new Map<string, number>(); // selector -> index in sheet.cssRules

function sheet(): CSSStyleSheet {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  return el.sheet as CSSStyleSheet;
}

export function applyEntry(entry: EditEntry): void {
  const s = sheet();
  clearRule(entry.selector); // idempotent replace
  const idx = s.insertRule(ruleText(entry), s.cssRules.length);
  ruleIndex.set(entry.selector, idx);
}

export function clearRule(selector: string): void {
  const s = sheet();
  const idx = ruleIndex.get(selector);
  if (idx === undefined) return;
  // Rebuild the index map because deleteRule shifts every following index.
  s.deleteRule(idx);
  ruleIndex.clear();
  for (let i = 0; i < s.cssRules.length; i++) {
    const sel = (s.cssRules[i] as CSSStyleRule).selectorText;
    ruleIndex.set(sel, i);
  }
}

export function clearAll(): void {
  const s = sheet();
  while (s.cssRules.length) s.deleteRule(0);
  ruleIndex.clear();
}

export function applyAll(sp: Scratchpad): void {
  clearAll();
  for (const entry of Object.values(sp)) applyEntry(entry);
}
```

- [ ] **Step 2: Typecheck the module**

Run: `npm run typecheck:web`
Expected: PASS (no type errors in the new module).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/uiEditor/overrideSheet.ts
git commit -m "feat(ui-editor): injected override stylesheet writer"
```

---

### Task 7: Asset upload route — `apps/web/uiAssetPlugin.ts`

A dev-only Vite middleware that writes an uploaded PNG to `packages/ui/src/assets/ui-editor/<slug>.png` and returns the repo-relative path. Mirrors `fxDefsPlugin.ts` exactly: a pure `planUiAsset` validator (slug grammar, size cap, PNG magic bytes, traversal containment) plus a thin server shell. PNG only in v1 (magic-byte-checked); other formats are a follow-up.

**Files:**
- Create: `apps/web/uiAssetPlugin.ts`
- Test: `apps/web/uiAssetPlugin.test.ts`
- Modify: `apps/web/vite.config.ts` (add `uiAssetPlugin()` to `plugins`)

**Interfaces:**
- Consumes: nothing (self-contained; may re-declare `WritePlan`/`SLUG_RE`/PNG constants locally — do NOT import from `fxDefsPlugin.ts`; keep each plugin's security boundary independent, matching that file's "duplicated ON PURPOSE" convention).
- Produces:
  - `planUiAsset(body: unknown, assetsRoot: string): WritePlan`
  - `uiAssetPlugin(options?: { assetsRoot?: string }): Plugin`
  - re-exported constants for the test: `UI_SLUG_RE`, `MAX_ASSET_BYTES`, `ASSET_DATA_URL_PREFIX`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/uiAssetPlugin.test.ts
import { Buffer } from 'node:buffer';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { planUiAsset, ASSET_DATA_URL_PREFIX, MAX_ASSET_BYTES } from './uiAssetPlugin';

const ROOT = path.resolve('/repo/packages/ui/src/assets/ui-editor');
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngDataUrl = (extra = 0) =>
  ASSET_DATA_URL_PREFIX + Buffer.concat([PNG_HEADER, Buffer.alloc(extra, 1)]).toString('base64');

describe('planUiAsset', () => {
  it('accepts a valid PNG and targets <root>/<slug>.png', () => {
    const plan = planUiAsset({ slug: 'medallion-v2', dataUrl: pngDataUrl(10) }, ROOT);
    expect(plan.status).toBe(200);
    expect(plan.file).toBe(path.join(ROOT, 'medallion-v2.png'));
  });
  it('rejects a bad slug', () => {
    expect(planUiAsset({ slug: '../evil', dataUrl: pngDataUrl() }, ROOT).status).toBe(400);
  });
  it('rejects a non-PNG payload', () => {
    expect(planUiAsset({ slug: 'x', dataUrl: 'data:image/png;base64,AAAA' }, ROOT).status).toBe(400);
  });
  it('rejects an oversize payload', () => {
    const big = ASSET_DATA_URL_PREFIX + 'A'.repeat(MAX_ASSET_BYTES * 2 + 4);
    expect(planUiAsset({ slug: 'x', dataUrl: big }, ROOT).status).toBe(413);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/uiAssetPlugin.test.ts`
Expected: FAIL — cannot resolve `./uiAssetPlugin`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/uiAssetPlugin.ts
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * DEV-ONLY route (`apply: 'serve'`, never in a production build) that lets the UI editor upload an image to a
 * real committed file, so a swapped asset can be wired up for real. Same shape and same security posture as
 * `fxDefsPlugin.ts`: one pure validator (`planUiAsset`) is the boundary, the middleware is a thin shell.
 * Constants are duplicated ON PURPOSE — this is an independent boundary, not a shared helper.
 */
export const UI_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;
export const ASSET_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface WritePlan {
  status: number;
  error?: string;
  file?: string;
  data?: Buffer;
}

function bad(status: number, error: string): WritePlan {
  return { status, error };
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function planUiAsset(body: unknown, assetsRoot: string): WritePlan {
  if (!isRecord(body)) return bad(400, 'Expected a JSON object body.');
  const { slug, dataUrl } = body;
  if (typeof slug !== 'string' || slug === '') return bad(400, 'Missing `slug`.');
  if (!UI_SLUG_RE.test(slug)) return bad(400, `'${slug}' is not a valid asset slug.`);
  if (typeof dataUrl !== 'string') return bad(400, 'Missing `dataUrl`.');
  if (!dataUrl.startsWith(ASSET_DATA_URL_PREFIX)) return bad(400, 'Asset must be a PNG data URL.');
  if (dataUrl.length > MAX_ASSET_BYTES * 2) return bad(413, `Asset is larger than ${MAX_ASSET_BYTES} bytes.`);
  const buf = Buffer.from(dataUrl.slice(ASSET_DATA_URL_PREFIX.length), 'base64');
  if (buf.byteLength === 0) return bad(400, 'Asset data URL is empty.');
  if (buf.byteLength > MAX_ASSET_BYTES) return bad(413, `Asset is larger than ${MAX_ASSET_BYTES} bytes.`);
  if (!buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return bad(400, 'Asset is not a PNG.');
  const root = path.resolve(assetsRoot);
  const file = path.resolve(root, `${slug}.png`);
  if (!isInside(root, file)) return bad(400, 'Refusing to write outside the assets directory.');
  return { status: 200, file, data: buf };
}

const MAX_BODY_BYTES = MAX_ASSET_BYTES * 2 + 4096;
const DEFAULT_ROOT = fileURLToPath(new URL('../packages/ui/src/assets/ui-editor', import.meta.url));

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('Request body is too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export function uiAssetPlugin(options: { assetsRoot?: string } = {}): Plugin {
  const assetsRoot = path.resolve(options.assetsRoot ?? DEFAULT_ROOT);
  const repoRoot = path.resolve(assetsRoot, '..', '..', '..', '..', '..');
  return {
    name: 'ascent:ui-asset',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__ui/asset', (req, res) => {
        void (async () => {
          if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'POST only.' }); return; }
          let body: unknown;
          try { body = JSON.parse(await readBody(req)); }
          catch (e) { send(res, 400, { ok: false, error: (e as Error).message }); return; }
          const plan = planUiAsset(body, assetsRoot);
          if (plan.status !== 200 || !plan.file || plan.data === undefined) {
            send(res, plan.status, { ok: false, error: plan.error ?? 'Rejected.' }); return;
          }
          try {
            await mkdir(path.dirname(plan.file), { recursive: true });
            await writeFile(plan.file, plan.data);
          } catch (e) { send(res, 500, { ok: false, error: (e as Error).message }); return; }
          send(res, 200, { ok: true, path: path.relative(repoRoot, plan.file).split(path.sep).join('/') });
        })();
      });
    },
  };
}

export default uiAssetPlugin;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/uiAssetPlugin.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the plugin**

In `apps/web/vite.config.ts`, import and add it next to `fxDefsPlugin()`:

```ts
import { uiAssetPlugin } from './uiAssetPlugin';
// ...
  plugins: [react(), fxDefsPlugin(), uiAssetPlugin()],
```

- [ ] **Step 6: Verify the build still transpiles**

Run: `npm run build:web`
Expected: PASS (the plugin is `apply: 'serve'`, so it doesn't affect the built bundle, but the import must resolve).

- [ ] **Step 7: Commit**

```bash
git add apps/web/uiAssetPlugin.ts apps/web/uiAssetPlugin.test.ts apps/web/vite.config.ts
git commit -m "feat(ui-editor): dev-only /__ui/asset upload route"
```

---

### Task 8: The overlay, toggle & mount — `uiEditor/EditorOverlay.tsx`

The integration layer that ties the tested cores into a working tool: the mode UI, the capture-phase selector, the selection box + resize handles, the toolbar (editable selector + live match count, scope toggle, restyle knobs, image pick/upload, Copy Summary, Reset element, Reset all), the drag/resize pointer handlers, and the animated-element warning. Wires a toggle into `DevMenu` and a dev-only mount into `Game.tsx`. Verified **live** in the dev server — this is DOM/pointer code Node's test env can't exercise; its pure helpers are already covered by Tasks 1–7.

**Files:**
- Create: `packages/ui/src/uiEditor/EditorOverlay.tsx`
- Modify: `packages/ui/src/DevMenu.tsx` (add a "UI Edit Mode" toggle row that calls `setUiEditMode`)
- Modify: `packages/ui/src/Game.tsx:251` area (mount `{import.meta.env.DEV && <EditorOverlay />}` alongside `<DevMenu />`)

**Interfaces:**
- Consumes: `isUiEditMode`/`setUiEditMode`/`subscribeUiEditMode` (`./config`); `resolveAnchor`/`selectParent` (`./resolver`); `buildSelector`/`matchCount`/`Scope` (`./selector`); `composeTransform`/`resizeToPx` (`./transforms`); `upsertProp`/`setAsset`/`removeEntry`/`toSummary`/`serialize`/`deserialize`/`Scratchpad` (`./scratchpad`); `applyEntry`/`clearRule`/`clearAll`/`applyAll` (`./overrideSheet`).
- Produces: `EditorOverlay: () => JSX.Element | null`.

Behavioral spec (implement to this; verify each line live):

1. **Mount & mode.** `EditorOverlay` subscribes to `subscribeUiEditMode`. When OFF it renders `null` and installs no listeners. On first turn-ON it loads the scratchpad via `deserialize(localStorage.getItem('ascent.uiEdit.scratchpad'))` and calls `applyAll` so prior edits are visible.
2. **Persistence (no debounce).** After every edit, immediately `localStorage.setItem('ascent.uiEdit.scratchpad', serialize(sp))`. Synchronous-on-edit — deliberately avoids the FX-workbench Save-bug's debounce-flush race.
3. **Selection.** A capture-phase `pointerdown` listener on `document`: when in edit mode, `preventDefault()` + `stopPropagation()`, `resolveAnchor(e.target)`, store as the selected element, and draw a highlighted bounding box (a positioned overlay div using `getBoundingClientRect`, read once per selection, not per frame). Ignore clicks inside the editor's own toolbar (tag the toolbar root and bail if `e.target.closest('[data-ui-editor]')`).
4. **Toolbar.** Shows the generated selector (editable text input; on edit, recompute `matchCount` for the blast-radius label), a scope toggle (`this-element` default for elements with `data-uid`, `all-like-this` default otherwise), the restyle knob set (`font-size`, `color`, `background`, `border-radius`, `padding`, `opacity`), an image section (pick from a static list of existing in-run images + an upload button), **Copy Summary**, **Reset element**, **Reset all**, and a **select parent ▲** button (`selectParent`).
5. **Move.** Drag the selection box → accumulate `dx,dy` → `composeTransform` → `upsertProp(sp, selector, scope, 'transform', ...)` → `applyEntry`. Cache the box rect once at drag start.
6. **Resize.** 8 handles → `resizeToPx(baseBox, dW, dH, shiftHeld)` → `upsertProp` width/height (or a `scale()` transform when the "scale as unit" toggle is on) → `applyEntry`.
7. **Restyle.** Each knob writes its CSS prop via `upsertProp` → `applyEntry` live.
8. **Image pick / upload.** Pick sets `background-image` via `setAsset(selector, scope, <existingPath>)`. Upload reads the file as a PNG data URL, POSTs `{ slug, dataUrl }` to `/__ui/asset`, and on `{ ok, path }` calls `setAsset(selector, scope, path)`. Show the server error on non-ok.
9. **Copy Summary.** Build `counts` via `matchCount(selector)` for each entry, then `navigator.clipboard.writeText(toSummary(sp, counts))`; toast "Copied".
10. **Reset element** → `removeEntry` + `clearRule(selector)`; **Reset all** → `{}` + `clearAll()`; both re-persist.
11. **Animated-element badge.** If the selected element (or an ancestor) carries a GSAP marker — detect via `gsap.getTweensOf(el).length > 0` if `gsap` is importable, else a heuristic `el.closest('.card')` during combat — show a warning badge: "animated — transform edits may not stick during combat; edit at rest."

- [ ] **Step 1: Implement `EditorOverlay.tsx`** per the behavioral spec above, importing only the tested cores. Keep the file focused on wiring + JSX; push any non-trivial pure logic that emerges into the Task 4/5 modules and add a test there.

- [ ] **Step 2: Add the DevMenu toggle.** In `DevMenu.tsx`, add a row (near the top-level actions) that reads `isUiEditMode()` and calls `setUiEditMode(!on)` — label "🎛️ UI Edit Mode", hint "Direct-manipulation editor for in-run UI".

- [ ] **Step 3: Mount in Game.tsx.** Beside `{import.meta.env.DEV && <DevMenu />}` add `{import.meta.env.DEV && <EditorOverlay />}`.

- [ ] **Step 4: Gates.**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all PASS.

- [ ] **Step 5: Live verification (dev server).**
  - `npm run dev`; open the app; start a run so in-run UI is present.
  - Open DevMenu → toggle **UI Edit Mode** on.
  - Click a HUD element and a shop card: confirm the selection box snaps to the resolved anchor (pill, not glyph).
  - Move it, resize it, change font-size/color: confirm live changes and that the generated selector + match count update.
  - Tick a value that re-renders the element (e.g. spend gold): confirm the override **survives** the re-render (proves Approach A).
  - Upload a PNG: confirm the file appears under `packages/ui/src/assets/ui-editor/`, the element's background swaps, and the summary names the path.
  - Select a combat card mid-animation: confirm the animated-element badge appears.
  - Click **Copy Summary**: paste it somewhere and confirm it matches the documented format.
  - Screenshot the editor over a selected element and share as proof.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/uiEditor/EditorOverlay.tsx packages/ui/src/DevMenu.tsx packages/ui/src/Game.tsx
git commit -m "feat(ui-editor): overlay, DevMenu toggle, dev mount"
```

---

### Task 9: Living docs + PR

**Files:**
- Modify: `docs/devlog.md` (prepend a dated entry), `docs/roadmap.md` (move the item out of the queue), `README.md` (Recent changes + Short-term roadmap).

- [ ] **Step 1: Update the three living docs** with what shipped (the in-run UI editor: Approach A override sheet, copyable summary, `/__ui/asset` upload), how it was verified (unit tests for the pure cores + live DOM checks), and any follow-ups (webp/jpg upload support; adding `data-ui` hooks to chrome as elements are selected; optional re-import of a pasted summary).

- [ ] **Step 2: Commit**

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: in-run UI editor devlog/roadmap/README"
```

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin docs/in-run-ui-editor-spec   # or the feature branch this work lives on
gh pr create --fill
```

- [ ] **Step 4: Watch CI and merge**

```bash
gh pr checks <n> --watch   # wait for `verify` green
gh pr merge <n> --squash --delete-branch
```

Confirm with `gh pr view <n> --json state,mergedAt` (the `--delete-branch` local checkout step can report a false failure when a worktree holds `main`). Then mirror `main` to backup if that's the session's habit.

---

## Self-Review

**1. Spec coverage** (each spec section → task):
- Activation & mode toggle → Task 1 (state) + Task 8 (DevMenu toggle, mount). ✔
- Selection & element resolver → Task 2. ✔
- Override stylesheet (heart of Approach A) → Task 6 (writer) + Task 5 (rule text). ✔
- Selector generation (scope, match count) → Task 3. ✔
- Manipulation controls (move/resize/image/restyle) → Task 4 (math) + Task 8 (wiring). ✔
- Asset upload endpoint → Task 7. ✔
- Animated-element caveat → Task 8 step 11 (badge). ✔
- Copyable summary → Task 5 (`toSummary`) + Task 8 step 9. ✔
- File layout / no engine changes → enforced by Global Constraints + the file map. ✔
- Testing & verification → per-task TDD + Task 8 live checks. ✔
- Non-goals (text content, FX, auto-ship, menus) → nothing in any task touches them. ✔
- Persistence lesson (no debounce) → Task 8 step 2. ✔

**2. Placeholder scan:** No "TBD/TODO/handle edge cases" — every code step has real code; every test has real assertions. The one intentional deferral (webp/jpg upload) is stated as a follow-up in Task 9, not left as a gap.

**3. Type consistency:** `Scope` is defined once in `selector.ts` and imported by `scratchpad.ts` and the overlay. `EditEntry`/`Scratchpad` defined in `scratchpad.ts`, consumed by `overrideSheet.ts` and the overlay. `WritePlan` is local to `uiAssetPlugin.ts` (deliberately not shared, matching the fxDefsPlugin convention). Function names used in Task 8's Interfaces (`upsertProp`, `setAsset`, `removeEntry`, `toSummary`, `applyEntry`, `clearRule`, `clearAll`, `applyAll`, `buildSelector`, `matchCount`, `composeTransform`, `resizeToPx`, `resolveAnchor`, `selectParent`) all match their defining tasks exactly.
