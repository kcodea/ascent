# Community Guides, Step 2: The Editor - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Mike and KC edit Team Ascent guides in game, and let any signed-in player write, duplicate, edit and delete their own private guides, from the Compendium, with an Edit link from the lobby rail.

**Architecture:** Client only. Step 1 already shipped the tables, the permission rules and the `guide-write` function; this step calls them. A pure module turns what the editor holds into the document the server accepts (deriving the cards named in the write-up and the sets the guide shows in), the read seam gains writes and three small reads, the guides store gains "am I on the team" and "my guides", and one editor component takes over the Compendium Guides tab while a guide is being edited. No migration, no change to `packages/guides`, no change to `store.ts`.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest (jsdom for component tests), Supabase JS client.

**Spec:** `docs/superpowers/specs/2026-10-11-community-guides-design.md` (sections 1, 4 and 9 step 2). Read `docs/devlog/2026-10-12-guides-storage.md`, "Carried to the next steps", first: it lists what step 1 left for this step.

**Depends on:** `kcodea/ascent#2043` (step 1) being merged. Do not start before it is on `main`.

**Code in this plan is unrun draft.** Each task's failing-test-then-passing-test cycle is what verifies it. If a snippet does not compile or a test fails for a reason the plan did not predict, fix the code to satisfy the test's intent; do not weaken the test. Step 1's review found about one real defect per task in plan-supplied code, so read each snippet as a draft, not as an answer key.

## Global Constraints

- Branch `feat/guides-editor` off latest `origin/main` (after #2043 has merged), in its own worktree under `.claude/worktrees/`. Run `npm install` inside the worktree before trusting any typecheck or test. Never commit or push to `main`.
- Before claiming done: `npm run typecheck && npm run lint && npm test && npm run build:web` all green; report the output.
- Every commit message ends with the session's `Co-Authored-By` attribution line.
- **Who may do what** (the server enforces it; the client only decides which buttons to draw): a guest may read only; a signed-in player may create, duplicate, edit and delete their OWN guides; only a `guide_team` account may edit or delete a Team Ascent guide or create one. A team edit of a Team Ascent guide must send `official: true`.
- **Every guide a player writes in this step is private.** There is no Publish switch until step 3. Only its author sees it (My guides, and their own lobby rail).
- Limits, verbatim from the spec: title **1 to 40**; tagline **0 to 80**; write-up **1 to 1,200**; "by" line **1 to 24**; Core **1 to 6**; Enablers **0 to 6**; tribes **0 to 2** plus **0 to 1** "pairs with"; nicknames **0 to 6**; **20** guides per player. Import them from `@game/guides` (`GUIDE_LIMITS`); never retype a number.
- Controls that write are enabled only when the guides capability is exactly `on`. `unknown`, `off`, `offline` and `no-backend` all read as "not available".
- A guide holding a missing card cannot be saved: Save is refused with a message until the card is removed.
- The built-in import must run before any new Team Ascent guide can be created (the moment the server has one usable official guide, the client shows the server's list instead of the eleven built-in ones).
- The lobby rail still never subscribes to the guide lists: it reads a snapshot when its Guides view opens.
- Typing in the editor must never close the Compendium: while the editor is open, Tab moves focus and Esc asks to leave the editor.
- UI house rules: NO `title=` attribute, SVG `<title>` or `el.title =` (use `aria-label` / `aria-description`); NO bare `cursor: pointer` or any keyword cursor on an interactive element; NO raw `vw` / `vh` or viewport `@media`; portals go into `stageHost()`, never `document.body`; every `<img>` needs `decoding="sync"`; NO em dashes in player-facing text; no looping animation of a paint property; no per-frame layout reads.
- Performance is the north star: memoize list items, keep props referentially stable, add nothing to the lobby rail's render path while the Guides view is closed.
- KNOWN TOOL PITFALL: file-writing tools turn `\uXXXX` escapes and typographic characters into raw characters. Write plain ASCII in every new file and check with `grep -nP '[^\x00-\x7F]' <file>` (expect no hits).
- `packages/ui/src/store.ts` is NOT edited in this step. `MinionBook.tsx` and `LobbyPanel.tsx` are large shared files: make only the edits the tasks name.
- Test titles describe behaviour and carry no process labels.

## Deviations from the spec (for the owner to confirm or veto on plan review)

1. **Reordering cards uses two small arrow buttons, not drag.** The spec says "drag to reorder". A row holds at most six cards; arrows work with mouse, touch and keyboard and need no drag code under the scaled stage. Drag can be added later without changing anything else.
2. **Editing takes over the Guides tab.** The spec says the card "becomes editable in place". While a guide is being edited the list is hidden and the editor card fills the tab, so tribe pills and search cannot filter the card being edited out from under its author, and the editor has room. What is edited is still the same card layout players read.
3. **Closing the Compendium outright does not ask.** Cancel, Esc and Delete ask before discarding. The X button, a click outside the window, or closing from elsewhere do not: the in-progress guide is kept on the device and offered back ("Resume") the next time the Guides tab opens. Intercepting those would mean editing the shared store.
4. **Buttons are words, not icons.** The game's icon set has no pencil, copy, bin or plus. "Edit", "Duplicate", "Delete", "New guide", and an "Edit" button in the rail instead of a pencil.
5. **A guest who clicks New guide or Duplicate sees an inline "Sign in to write your own guides" line with a Create account button**, not the portrait sign-in pop-up (whose text is about portraits and whose layering over the Compendium is untested).
6. **Card names light up in a live preview under the text box**, not inside it (a text box cannot colour part of its text).
7. **"Import before creating a Team Ascent guide" is enforced by the client only** (the option is absent until the import has run). The two people it constrains are the team.
8. **A copy of a built-in guide made before the import has no "Based on" line**, because there is no server row to point at.
9. **`store.ts` is not touched.** The rail's Edit link reaches the Compendium through the guides store, not through a new field on the game store.

## Review Focus

Inputs the spec implies but does not spell out. Each has a test in the task named.

1. **A save that the server refuses mid-edit** (signed out in another tab, guide deleted elsewhere, 20-guide cap, rate limit, function not deployed yet): the editor stays open with the author's text intact and a plain sentence; nothing is lost. -> Tasks 1, 2, 7.
2. **Two team members edit the same guide**: the second save says so and offers Load their version or Overwrite with mine; Overwrite really saves. -> Task 7.
3. **A write-up that names a card whose name contains another card's name, punctuation, or different capitals** ("Grevlin & Co.", "King Oona" vs "Oona"): the longest name wins, whole names only, case ignored, each card once. -> Task 4.
4. **A long session**: signing in or out while the Compendium is open changes which guides are "mine" without a reload, even if a read was already in flight. -> Task 3.
5. **Keyboard**: Tab and Esc inside the editor never close the Compendium; Enter in the title box does not submit or close anything. -> Task 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/ui/src/guides/guidesRemote.ts` (modify) | Adds the three writes and the three small reads |
| `packages/ui/src/guides/guideMessages.ts` (new) | A server code and field -> the sentence the player reads |
| `packages/ui/src/guides/guidesStore.ts` (modify) | Adds `team`, `mine`, the Compendium pill, the rail's edit request, and the apply-after-save helpers |
| `packages/ui/src/guides/guideDrafts.ts` (new) | Pure: what the editor holds, how it becomes the server document, what is wrong with it |
| `packages/ui/src/guides/guideDraftStore.ts` (new) | The one in-progress draft kept on the device |
| `packages/ui/src/guides/GuideCardPicker.tsx` (new) | Search this set's cards, pick one |
| `packages/ui/src/guides/GuideEditor.tsx`, `guideEditor.css` (new) | The editor card |
| `packages/ui/src/guides/CompendiumGuides.tsx`, `compendiumGuides.css` (modify) | Toolbar, per-guide actions, by line and badges, hosts the editor |
| `packages/ui/src/MinionBook.tsx` (modify, 4 small edits) | Picks the list by pill; opens on Guides when the rail asked |
| `packages/ui/src/guides/LobbyGuides.tsx`, `lobbyGuides.css`, `packages/ui/src/LobbyPanel.tsx` (modify) | "Your guides" section and the Edit button |
| `packages/ui/src/patchNotes.ts`, `docs/devlog/`, `supabase/README.md` (modify) | Player notes, record, runbook |

---

### Task 0: Workspace

**Files:** none committed.

- [ ] **Step 1: Confirm step 1 is on main, create the worktree, install**

```bash
git fetch origin
git log origin/main --oneline -30 | grep -i "guides move to the server"
git worktree add .claude/worktrees/guides-editor -b feat/guides-editor origin/main
cd .claude/worktrees/guides-editor
npm install
git branch --show-current
```
Expected: the `grep` prints the step 1 squash commit (if it prints nothing, STOP: step 1 has not merged), then `feat/guides-editor`.

- [ ] **Step 2: Confirm a clean baseline**

Run: `npx vitest run packages/ui/src/guides packages/guides`
Expected: PASS. If it fails on a clean checkout, stop and report.

---

### Task 1: The seam: three writes and three small reads

**Files:**
- Modify: `packages/ui/src/guides/guidesRemote.ts` (append; change nothing above)
- Test: `packages/ui/src/guides/guidesRemoteWrite.test.ts`

**Interfaces:**
- Consumes: `supabaseClient` from `../remoteBoards`; `fetchAllRows` from `../supabaseRows`; `parseGuideRecord`, `GuideRecord` from `@game/guides`; the existing `GUIDE_COLUMNS`, `timeout`, `READ_TIMEOUT_MS` in this file.
- Produces:
  - `GuideWriteResult<T> = { ok: true; value: T } | { ok: false; code: string; field?: string }`
  - `GuideDraftInput` (the camelCase document the server validates)
  - `saveGuideRemote(guide: GuideDraftInput): Promise<GuideWriteResult<GuideRecord>>`
  - `deleteGuideRemote(rowId: string): Promise<GuideWriteResult<true>>`
  - `importBuiltInsRemote(guides: GuideDraftInput[]): Promise<GuideWriteResult<{ inserted: number; skipped: number }>>`
  - `fetchTeamFlag(userId: string): Promise<boolean | undefined>`
  - `fetchMyGuides(userId: string): Promise<GuideRecord[] | undefined>`
  - `fetchGuideById(rowId: string): Promise<GuideRecord | null | undefined>`
  - Failure codes: the server's own (`sign_in_required`, `not_allowed`, `not_found`, `conflict`, `too_many_guides`, `rate_limited`, `blocked_text`, `reserved_name`, `bad_guide`, `unauthenticated`) plus three made here: `offline` (could not reach it), `unavailable` (the function is not deployed: a 404 with no code), `server` (anything else).

- [ ] **Step 1: Write the failing test**

`packages/ui/src/guides/guidesRemoteWrite.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GUIDES: the write half of the seam, and its three small reads, over a FAKE Supabase client. Pins what is sent to
 * `guide-write`, how each refusal is classified (the server's code and field come through untouched; transport
 * failures become `offline` / `unavailable` / `server`), and that every read is bounded.
 */
type Res = { data: unknown; error: unknown };
let invokeImpl: (fn: string, opts: { body: Record<string, unknown> }) => Promise<Res> | Res;
let tableImpl: (table: string) => Res | Promise<Res>;
let hasClient = true;
const invokes: Array<{ fn: string; body: Record<string, unknown> }> = [];
const seen: Array<{ table: string; columns: string; eq: Array<[string, unknown]>; order: string[]; end: string }> = [];

vi.mock('../remoteBoards', () => ({
  supabaseClient: () => (hasClient ? {
    functions: { invoke: async (fn: string, opts: { body: Record<string, unknown> }) => { invokes.push({ fn, body: opts.body }); return invokeImpl(fn, opts); } },
    from: (table: string) => ({
      select: (columns: string) => {
        const call = { table, columns, eq: [] as Array<[string, unknown]>, order: [] as string[], end: '' };
        seen.push(call);
        const run = (end: string) => { call.end = end; return Promise.resolve(tableImpl(table)); };
        const chain = {
          eq: (k: string, v: unknown) => { call.eq.push([k, v]); return chain; },
          order: (k: string) => { call.order.push(k); return chain; },
          range: () => run('range'),
          maybeSingle: () => run('maybeSingle'),
        };
        return chain;
      },
    }),
  } : null),
}));

const { deleteGuideRemote, fetchGuideById, fetchMyGuides, fetchTeamFlag, importBuiltInsRemote, saveGuideRemote } = await import('./guidesRemote');

const draft = {
  official: false, byline: 'Mike', sets: ['set2'], tribes: ['beast'], pairsWith: [], iconCard: 'grim', title: 'T', tagline: '',
  body: 'B', core: ['grim'], enablers: [], mentions: [], aliases: {},
};
const row = { id: '11111111-1111-4111-8111-111111111111', title: 'T', body: 'B', icon_card: 'grim', core: ['grim'], revision: 1, byline: 'Mike' };
const httpError = (status: number, body?: Record<string, unknown>): Res => ({
  data: null, error: { name: 'FunctionsHttpError', message: 'x', context: { status, json: async () => body ?? {} } },
});

beforeEach(() => {
  hasClient = true;
  invokes.length = 0;
  seen.length = 0;
  invokeImpl = () => ({ data: { guide: row }, error: null });
  tableImpl = () => ({ data: [], error: null });
  vi.useRealTimers();
});

describe('saveGuideRemote', () => {
  it('sends { op: save, guide } to guide-write and returns the parsed guide', async () => {
    const res = await saveGuideRemote(draft);
    expect(invokes).toEqual([{ fn: 'guide-write', body: { op: 'save', guide: draft } }]);
    expect(res).toMatchObject({ ok: true, value: { id: row.id, title: 'T', iconCard: 'grim' } });
  });
  it('passes the server code and field through for every refusal', async () => {
    const cases: Array<[number, Record<string, unknown>, Record<string, unknown>]> = [
      [403, { error: 'sign_in_required' }, { code: 'sign_in_required' }],
      [403, { error: 'not_allowed' }, { code: 'not_allowed' }],
      [404, { error: 'not_found' }, { code: 'not_found' }],
      [409, { error: 'conflict' }, { code: 'conflict' }],
      [422, { error: 'too_many_guides' }, { code: 'too_many_guides' }],
      [429, { error: 'rate_limited' }, { code: 'rate_limited' }],
      [422, { error: 'blocked_text', field: 'body' }, { code: 'blocked_text', field: 'body' }],
      [422, { error: 'reserved_name', field: 'byline' }, { code: 'reserved_name', field: 'byline' }],
      [422, { error: 'bad_guide', field: 'title' }, { code: 'bad_guide', field: 'title' }],
    ];
    for (const [status, body, want] of cases) {
      invokeImpl = () => httpError(status, body);
      expect(await saveGuideRemote(draft), JSON.stringify(body)).toEqual({ ok: false, ...want });
    }
  });
  it('a 404 with no code means the function is not deployed: unavailable', async () => {
    invokeImpl = () => httpError(404);
    expect(await saveGuideRemote(draft)).toEqual({ ok: false, code: 'unavailable' });
  });
  it('a 5xx with no code is server; a thrown call, no client and no answer in 15 s are offline', async () => {
    invokeImpl = () => httpError(500);
    expect(await saveGuideRemote(draft)).toEqual({ ok: false, code: 'server' });
    invokeImpl = () => { throw new Error('network'); };
    expect(await saveGuideRemote(draft)).toEqual({ ok: false, code: 'offline' });
    hasClient = false;
    expect(await saveGuideRemote(draft)).toEqual({ ok: false, code: 'offline' });
    hasClient = true;
    vi.useFakeTimers();
    invokeImpl = () => new Promise<Res>(() => { /* never */ });
    const p = saveGuideRemote(draft);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await p).toEqual({ ok: false, code: 'offline' });
  });
  it('an answer with no usable guide in it is server, not a crash', async () => {
    invokeImpl = () => ({ data: { guide: { nothing: true } }, error: null });
    expect(await saveGuideRemote(draft)).toEqual({ ok: false, code: 'server' });
    invokeImpl = () => ({ data: null, error: null });
    expect(await saveGuideRemote(draft)).toEqual({ ok: false, code: 'server' });
  });
});

describe('deleteGuideRemote and importBuiltInsRemote', () => {
  it('delete sends the row id', async () => {
    invokeImpl = () => ({ data: { deleted: row.id }, error: null });
    expect(await deleteGuideRemote(row.id)).toEqual({ ok: true, value: true });
    expect(invokes).toEqual([{ fn: 'guide-write', body: { op: 'delete', id: row.id } }]);
  });
  it('import sends the guides and returns the counts as numbers', async () => {
    invokeImpl = () => ({ data: { inserted: 11, skipped: 0 }, error: null });
    expect(await importBuiltInsRemote([draft])).toEqual({ ok: true, value: { inserted: 11, skipped: 0 } });
    expect(invokes).toEqual([{ fn: 'guide-write', body: { op: 'importBuiltIns', guides: [draft] } }]);
  });
  it('a refusal comes through for both', async () => {
    invokeImpl = () => httpError(403, { error: 'not_allowed' });
    expect(await deleteGuideRemote(row.id)).toEqual({ ok: false, code: 'not_allowed' });
    expect(await importBuiltInsRemote([draft])).toEqual({ ok: false, code: 'not_allowed' });
  });
});

describe('the three small reads', () => {
  it('fetchTeamFlag reads only the caller\'s own row; a row means team, none means not', async () => {
    tableImpl = () => ({ data: { user_id: 'u-1' }, error: null });
    expect(await fetchTeamFlag('u-1')).toBe(true);
    expect(seen[0]).toMatchObject({ table: 'guide_team', eq: [['user_id', 'u-1']], end: 'maybeSingle' });
    tableImpl = () => ({ data: null, error: null });
    expect(await fetchTeamFlag('u-1')).toBe(false);
  });
  it('fetchTeamFlag is undefined (unknown) on an error or with no client, never false', async () => {
    tableImpl = () => ({ data: null, error: { message: 'x' } });
    expect(await fetchTeamFlag('u-1')).toBeUndefined();
    hasClient = false;
    expect(await fetchTeamFlag('u-1')).toBeUndefined();
  });
  it('fetchMyGuides reads the caller\'s non-official guides, in a stable order, paged', async () => {
    tableImpl = () => ({ data: [row, { id: 'no-title' }], error: null });
    const res = await fetchMyGuides('u-1');
    expect(seen[0]).toMatchObject({ table: 'guides', eq: [['author_id', 'u-1'], ['official', false]], order: ['created_at', 'id'], end: 'range' });
    expect(res).toHaveLength(1);
    expect(res![0]).toMatchObject({ id: row.id });
  });
  it('fetchMyGuides is undefined on an error', async () => {
    tableImpl = () => ({ data: null, error: { message: 'x', code: '500' } });
    expect(await fetchMyGuides('u-1')).toBeUndefined();
  });
  it('fetchGuideById answers the guide, null when it is gone, undefined when it could not ask', async () => {
    tableImpl = () => ({ data: row, error: null });
    expect(await fetchGuideById(row.id)).toMatchObject({ id: row.id });
    expect(seen[0]).toMatchObject({ table: 'guides', eq: [['id', row.id]], end: 'maybeSingle' });
    tableImpl = () => ({ data: null, error: null });
    expect(await fetchGuideById(row.id)).toBeNull();
    tableImpl = () => ({ data: null, error: { message: 'x' } });
    expect(await fetchGuideById(row.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/guides/guidesRemoteWrite.test.ts`
Expected: FAIL (the new functions are not exported).

- [ ] **Step 3: Implement**

Append to `packages/ui/src/guides/guidesRemote.ts` (and update the file's header comment: remove the sentence "Writes (the `guide-write` Edge Function) arrive with the editor." and add one line each for the writes and the three reads):
```ts
// -- Writes (the `guide-write` Edge Function) ---------------------------------------------------------------------

const WRITE_TIMEOUT_MS = 15_000;

/**
 * A write's answer. On a refusal, `code` is the server's own stable code (with the `field` it named, if any), or
 * one of three made here: `offline` (could not reach it), `unavailable` (the function is not deployed yet), `server`
 * (it answered with something this client cannot use). Writes are interactive, never queued: a failure is shown.
 */
export type GuideWriteResult<T> = { ok: true; value: T } | { ok: false; code: string; field?: string };
type GuideWriteFailure = { ok: false; code: string; field?: string };

/** What the client sends for one guide: the camelCase document the server validates (`validateGuideDraft`). */
export interface GuideDraftInput {
  /** The row being updated; absent for a new guide. */
  id?: string;
  /** The revision the editor loaded. Required with `id`. */
  revision?: number;
  /** Built-in import only. */
  slug?: string;
  official: boolean;
  byline: string;
  sets: string[];
  tribes: string[];
  pairsWith: string[];
  iconCard: string;
  title: string;
  tagline: string;
  body: string;
  core: string[];
  enablers: string[];
  mentions: string[];
  aliases: Record<string, string>;
  forkedFrom?: string | null;
}

/** Turn a functions-js error into a failure: the server's code when it sent one, else a transport code. */
async function failureOf(err: unknown): Promise<GuideWriteFailure> {
  const e = err as { context?: { status?: number; json?: () => Promise<unknown> } };
  const status = e.context?.status;
  let code = '';
  let field: string | undefined;
  try {
    const parsed = e.context?.json ? await e.context.json() : null;
    const o = (parsed ?? {}) as { error?: unknown; field?: unknown };
    if (typeof o.error === 'string') code = o.error;
    if (typeof o.field === 'string') field = o.field;
  } catch { /* no readable body */ }
  if (code) return field ? { ok: false, code, field } : { ok: false, code };
  if (status === 404) return { ok: false, code: 'unavailable' };
  return { ok: false, code: status ? 'server' : 'offline' };
}

async function invokeGuideWrite(body: Record<string, unknown>): Promise<GuideWriteResult<Record<string, unknown>>> {
  const c = supabaseClient();
  if (!c) return { ok: false, code: 'offline' };
  try {
    const call = Promise.resolve(c.functions.invoke('guide-write', { body })) as Promise<{ data: unknown; error: unknown }>;
    const raced = await Promise.race([call, timeout(WRITE_TIMEOUT_MS, { timedOut: true } as const)]);
    if ('timedOut' in raced) return { ok: false, code: 'offline' };
    if (raced.error) return await failureOf(raced.error);
    if (!raced.data || typeof raced.data !== 'object') return { ok: false, code: 'server' };
    return { ok: true, value: raced.data as Record<string, unknown> };
  } catch {
    return { ok: false, code: 'offline' };
  }
}

/** Create a guide (no `id`) or update one (`id` + the `revision` it was loaded at). */
export async function saveGuideRemote(guide: GuideDraftInput): Promise<GuideWriteResult<GuideRecord>> {
  const res = await invokeGuideWrite({ op: 'save', guide });
  if (!res.ok) return res;
  const rec = parseGuideRecord(res.value.guide);
  return rec ? { ok: true, value: rec } : { ok: false, code: 'server' };
}

export async function deleteGuideRemote(rowId: string): Promise<GuideWriteResult<true>> {
  const res = await invokeGuideWrite({ op: 'delete', id: rowId });
  return res.ok ? { ok: true, value: true } : res;
}

/** Team only: add the built-in guides as Team Ascent guides. Never overwrites one that is already there. */
export async function importBuiltInsRemote(guides: GuideDraftInput[]): Promise<GuideWriteResult<{ inserted: number; skipped: number }>> {
  const res = await invokeGuideWrite({ op: 'importBuiltIns', guides });
  if (!res.ok) return res;
  return { ok: true, value: { inserted: Number(res.value.inserted ?? 0), skipped: Number(res.value.skipped ?? 0) } };
}

// -- The three small reads ----------------------------------------------------------------------------------------

/** Is this account on the guides team? `undefined` = could not ask (never treat that as "no" for an account that
 *  was already known to be on it). Row level security lets an account read only its own row. */
export async function fetchTeamFlag(userId: string): Promise<boolean | undefined> {
  const c = supabaseClient();
  if (!c || !userId) return undefined;
  try {
    const res = await Promise.race([
      Promise.resolve(c.from('guide_team').select('user_id').eq('user_id', userId).maybeSingle()),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    return res.data !== null;
  } catch {
    return undefined;
  }
}

/** This account's own guides (never Team Ascent ones), oldest first. `undefined` = could not ask. */
export async function fetchMyGuides(userId: string): Promise<GuideRecord[] | undefined> {
  const c = supabaseClient();
  if (!c || !userId) return undefined;
  try {
    const res = await Promise.race([
      fetchAllRows((from, to) => c.from('guides').select(GUIDE_COLUMNS).eq('author_id', userId).eq('official', false).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    return ((res.data as unknown[] | null) ?? []).map(parseGuideRecord).filter((g): g is GuideRecord => g !== null);
  } catch {
    return undefined;
  }
}

/** One guide by row id, as this account may read it. `null` = it is gone (or not readable); `undefined` = could not ask. */
export async function fetchGuideById(rowId: string): Promise<GuideRecord | null | undefined> {
  const c = supabaseClient();
  if (!c || !rowId) return undefined;
  try {
    const res = await Promise.race([
      Promise.resolve(c.from('guides').select(GUIDE_COLUMNS).eq('id', rowId).maybeSingle()),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res || res.error) return undefined;
    return res.data === null ? null : (parseGuideRecord(res.data) ?? undefined);
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run the tests and the row guard**

Run: `npx vitest run packages/ui/src/guides/guidesRemoteWrite.test.ts packages/ui/src/guides/guidesRemote.test.ts packages/ui/src/supabaseRows.guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/guides/guidesRemote.ts packages/ui/src/guides/guidesRemoteWrite.test.ts
git commit -m "feat(guides): the seam can save, delete and import guides, and read my guides and my team flag"
```

---

### Task 2: What the player reads when a save is refused

**Files:**
- Create: `packages/ui/src/guides/guideMessages.ts`
- Test: `packages/ui/src/guides/guideMessages.test.ts`

**Interfaces:**
- Produces: `guideErrorMessage(code: string, field?: string): string`.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/guides/guideMessages.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { GUIDE_LIMITS } from '@game/guides';
import { guideErrorMessage } from './guideMessages';

describe('guideErrorMessage', () => {
  it('names the part of the guide the server refused, in the player\'s words, never the offending word', () => {
    expect(guideErrorMessage('blocked_text', 'title')).toBe('The title has a word that is not allowed.');
    expect(guideErrorMessage('blocked_text', 'body')).toBe('The write-up has a word that is not allowed.');
    expect(guideErrorMessage('blocked_text', 'byline')).toBe('The "by" line has a word that is not allowed.');
    expect(guideErrorMessage('blocked_text', 'aliases')).toBe('The nicknames have a word that is not allowed.');
    expect(guideErrorMessage('bad_guide', 'core')).toBe('Check the Core cards.');
  });
  it('has a plain sentence for every code the save path can answer', () => {
    const codes = ['sign_in_required', 'unauthenticated', 'not_allowed', 'not_found', 'conflict', 'too_many_guides', 'rate_limited', 'reserved_name', 'offline', 'unavailable', 'server'];
    const seen = new Set<string>();
    for (const c of codes) {
      const m = guideErrorMessage(c);
      expect(m.length, c).toBeGreaterThan(10);
      expect(m.includes(String.fromCharCode(0x2014)) || m.includes('--'), c).toBe(false);
      expect(m, c).not.toContain(c);
      seen.add(m);
    }
    expect(seen.size, 'each code reads differently').toBeGreaterThanOrEqual(codes.length - 1); // sign_in_required and unauthenticated share one
  });
  it('quotes the owner\'s 20-guide limit from the shared limits, not a retyped number', () => {
    expect(guideErrorMessage('too_many_guides')).toContain(String(GUIDE_LIMITS.guidesPerPlayer));
  });
  it('tells the author their text is safe when the server could not be reached', () => {
    expect(guideErrorMessage('offline')).toContain('kept on this device');
  });
  it('an unknown code or field still reads as a sentence', () => {
    expect(guideErrorMessage('something_new')).toBe(guideErrorMessage('server'));
    expect(guideErrorMessage('bad_guide', 'something_new')).toBe('Check the guide.');
    expect(guideErrorMessage('bad_guide')).toBe('Check the guide.');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/guides/guideMessages.test.ts`
Expected: FAIL, cannot resolve `./guideMessages`.

- [ ] **Step 3: Implement**

`packages/ui/src/guides/guideMessages.ts`:
```ts
/**
 * GUIDES: a save's refusal, as the sentence the player reads. The server answers with a stable code and, for text
 * rules, the FIELD it refused (never the word). Player voice: what they see and can do, not how it is built.
 */
import { GUIDE_LIMITS } from '@game/guides';

/** A server field name -> how the editor labels that part of the guide. */
const PART: Readonly<Record<string, string>> = {
  title: 'title',
  tagline: 'tagline',
  body: 'write-up',
  byline: '"by" line',
  aliases: 'nicknames',
  core: 'Core cards',
  enablers: 'Enablers',
  mentions: 'write-up',
  iconCard: 'art icon',
  tribes: 'tribes',
  pairsWith: 'tribes',
  sets: 'cards',
};

export function guideErrorMessage(code: string, field?: string): string {
  const part = field ? PART[field] : undefined;
  switch (code) {
    case 'blocked_text':
      if (part === 'nicknames') return 'The nicknames have a word that is not allowed.';
      return `The ${part ?? 'guide'} has a word that is not allowed.`;
    case 'reserved_name': return 'That "by" line is reserved. Pick another name.';
    case 'bad_guide': return `Check the ${part ?? 'guide'}.`;
    case 'sign_in_required':
    case 'unauthenticated': return 'Sign in to write guides.';
    case 'not_allowed': return 'You cannot change this guide.';
    case 'not_found': return 'This guide no longer exists.';
    case 'conflict': return 'Someone else saved this guide while you were editing.';
    case 'too_many_guides': return `You already have ${GUIDE_LIMITS.guidesPerPlayer} guides. Delete one to make room.`;
    case 'rate_limited': return 'That is a lot of saves. Try again in a little while.';
    case 'offline': return 'Could not reach the server. Your guide is kept on this device.';
    case 'unavailable': return 'Guides cannot be saved yet. Try again later.';
    default: return 'Something went wrong saving the guide. Your text is still here.';
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/ui/src/guides/guideMessages.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/guides/guideMessages.ts packages/ui/src/guides/guideMessages.test.ts
git commit -m "feat(guides): plain sentences for a refused save"
```

---

### Task 3: The store knows who I am: team flag, my guides, the pill, the rail's edit request

**Files:**
- Modify: `packages/ui/src/guides/guidesStore.ts`
- Modify: `packages/ui/src/guides/guidesStore.test.ts` (extend the mock; add tests; one existing test's meaning is refined, see Step 1)

**Interfaces:**
- Consumes: `fetchTeamFlag`, `fetchMyGuides` (Task 1); `currentIdentity` from `../identity` (`{ userId, anonymous, ... } | null`).
- Produces (added to the store's state): `team: boolean`, `mine: readonly Guide[]`, `tab: 'team' | 'mine'`, `pendingEdit: string | null`.
- Produces (functions): `setGuidesTab(tab: 'team' | 'mine'): void`, `requestGuideEdit(rowId: string): void`, `takePendingEdit(): string | null`, `guideSaved(g: Guide): void`, `guideDeleted(rowId: string): void`. `loadGuides` and `resetGuidesForTests` keep their signatures.

- [ ] **Step 1: Write the failing tests**

In `packages/ui/src/guides/guidesStore.test.ts`:

1. Replace the `vi.mock('./guidesRemote', ...)` line and add an identity mock directly under it:
```ts
let teamAnswer: boolean | undefined = false;
let mineAnswer: GuideRecord[] | undefined = [];
const asked: string[] = [];
vi.mock('./guidesRemote', () => ({
  fetchOfficialGuides: () => { calls++; return answer(); },
  fetchTeamFlag: async (userId: string) => { asked.push(`team:${userId}`); return teamAnswer; },
  fetchMyGuides: async (userId: string) => { asked.push(`mine:${userId}`); return mineAnswer; },
}));
let identity: { userId: string; anonymous: boolean } | null = null;
vi.mock('../identity', () => ({ currentIdentity: () => identity }));
```
2. Change the dynamic import line to also pull the new functions:
```ts
const { guideDeleted, guideSaved, loadGuides, requestGuideEdit, resetGuidesForTests, setGuidesTab, takePendingEdit, useGuides } = await import('./guidesStore');
```
3. In `beforeEach`, add: `identity = null; teamAnswer = false; mineAnswer = []; asked.length = 0;`
4. Add this describe block at the end of the file:
```ts
describe('who I am: team flag and my guides', () => {
  const mineRec = (id: string, patch: Partial<GuideRecord> = {}): GuideRecord => rec(id, { official: false, published: false, authorId: 'u-1', byline: 'Mike', ...patch });

  it('with no identity, or a guest, it asks for neither and holds no team flag and no guides', async () => {
    await loadGuides();
    identity = { userId: 'g-1', anonymous: true };
    await loadGuides();
    expect(asked).toEqual([]);
    expect(useGuides.getState()).toMatchObject({ team: false, mine: [] });
  });
  it('a signed-in account gets its team flag and its own guides', async () => {
    identity = { userId: 'u-1', anonymous: false };
    teamAnswer = true;
    mineAnswer = [mineRec('m1'), mineRec('m2')];
    await loadGuides();
    expect(asked.sort()).toEqual(['mine:u-1', 'team:u-1']);
    expect(useGuides.getState().team).toBe(true);
    expect(useGuides.getState().mine.map((g) => g.id)).toEqual(['m1', 'm2']);
  });
  it('an unanswerable read leaves what was known: a team member does not lose the flag on a blip', async () => {
    identity = { userId: 'u-1', anonymous: false };
    teamAnswer = true;
    mineAnswer = [mineRec('m1')];
    await loadGuides();
    const before = useGuides.getState().mine;
    teamAnswer = undefined;
    mineAnswer = undefined;
    await loadGuides();
    expect(useGuides.getState().team).toBe(true);
    expect(useGuides.getState().mine).toBe(before);
  });
  it('signing out drops the flag and the guides', async () => {
    identity = { userId: 'u-1', anonymous: false };
    teamAnswer = true;
    mineAnswer = [mineRec('m1')];
    await loadGuides();
    identity = { userId: 'g-2', anonymous: true };
    await loadGuides();
    expect(useGuides.getState()).toMatchObject({ team: false, mine: [] });
  });
  it('a call for the SAME identity while a read is in flight joins it; a call for a DIFFERENT identity queues exactly one re-read', async () => {
    let release: (a: OfficialGuidesAnswer) => void = () => {};
    answer = () => new Promise<OfficialGuidesAnswer>((r) => { release = r; });
    identity = { userId: 'g-1', anonymous: true };
    const p1 = loadGuides();
    const p2 = loadGuides();              // same identity: joins
    identity = { userId: 'u-1', anonymous: false };
    mineAnswer = [mineRec('m1')];
    const p3 = loadGuides();              // signed in mid-read: must not be lost
    expect(calls).toBe(1);
    answer = async () => ({ state: 'on', guides: [rec('a')] });
    release({ state: 'on', guides: [rec('a')] });
    await Promise.all([p1, p2, p3]);
    await vi.waitFor(() => expect(useGuides.getState().mine.map((g) => g.id)).toEqual(['m1']));
    expect(calls).toBe(2);
  });
});

describe('after a save or a delete, without a re-read', () => {
  const g = (patch: Partial<import('./guides').Guide>): import('./guides').Guide => ({ ...GUIDES[0]!, ...patch });

  it('a saved player guide is added to mine, or replaces the same row', () => {
    guideSaved(g({ id: 'r1', rowId: 'r1', official: false, title: 'First', revision: 1 }));
    guideSaved(g({ id: 'r2', rowId: 'r2', official: false, title: 'Second', revision: 1 }));
    guideSaved(g({ id: 'r1', rowId: 'r1', official: false, title: 'First, edited', revision: 2 }));
    expect(useGuides.getState().mine.map((x) => x.title)).toEqual(['First, edited', 'Second']);
  });
  it('a saved Team Ascent guide replaces the same row in the server list, keeping its place', async () => {
    await loadGuides(); // server list: a, b
    const list = useGuides.getState().list;
    guideSaved({ ...list[0]!, title: 'A, edited', revision: 2 });
    expect(useGuides.getState().list.map((x) => x.title)).toEqual(['A, edited', list[1]!.title]);
  });
  it('a deleted guide leaves both lists', async () => {
    await loadGuides();
    const first = useGuides.getState().list[0]!;
    guideSaved(g({ id: 'r1', rowId: 'r1', official: false }));
    guideDeleted('r1');
    guideDeleted(first.rowId!);
    expect(useGuides.getState().mine).toEqual([]);
    expect(useGuides.getState().list.map((x) => x.rowId)).not.toContain(first.rowId);
  });
});

describe('the Compendium pill and the rail\'s edit request', () => {
  it('starts on Team Ascent; the pill can be switched', () => {
    expect(useGuides.getState().tab).toBe('team');
    setGuidesTab('mine');
    expect(useGuides.getState().tab).toBe('mine');
  });
  it('an edit request is taken exactly once', () => {
    requestGuideEdit('r1');
    expect(useGuides.getState().pendingEdit).toBe('r1');
    expect(takePendingEdit()).toBe('r1');
    expect(takePendingEdit()).toBeNull();
  });
});
```
5. The existing test "two callers at once share one request" stays exactly as it is: with `identity` null for both calls it is the same identity, so they still share one request.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run packages/ui/src/guides/guidesStore.test.ts`
Expected: the new tests FAIL (the functions and fields do not exist); the old ones still pass.

- [ ] **Step 3: Implement**

Rewrite `packages/ui/src/guides/guidesStore.ts` to this (the header comment is extended, the first half is step 1's logic kept as it was):
```ts
/**
 * GUIDES: the client slice (2026-10-12). A small store of its OWN rather than more fields on the game store
 * (`store.ts` is a hot file): the game store only calls `loadGuides` when identity lands or changes.
 *
 *   capability  `unknown` until the first read answers; then `on`, `off` (asked, the migration has not run),
 *               `offline` (could not ask) or `no-backend` (no Supabase configured). Only `on` enables writing.
 *   list        the Team Ascent guides every screen filters with `guidesFor`. The BUILT-IN guides until the server
 *               answers with at least one usable guide, so a screen is never empty and never waits.
 *   source      which of the two `list` currently is.
 *   team        this account is on the guides team (may edit Team Ascent guides). False for a guest.
 *   mine        this account's own guides. Empty for a guest.
 *   tab         which pill the Compendium Guides tab shows: Team Ascent, or My guides.
 *   pendingEdit a guide (by row id) the lobby rail asked the Compendium to open in the editor.
 *
 * A failed or empty read never replaces something already showing: one timed-out refresh must not reshuffle the
 * guides, and must not take a team member's Edit buttons away. An unchanged reload keeps the same arrays.
 *
 * WHO IS ASKING CAN CHANGE MID-READ. `loadGuides` is called on every identity change. A call that arrives while a
 * read for the SAME identity is in flight joins it; one for a DIFFERENT identity queues exactly one re-read, so a
 * sign-in that lands mid-read is never answered with the guest's view.
 *
 * THE RAIL DOES NOT SUBSCRIBE to `list` or `mine`. It reads them when its Guides view opens (LobbyPanel), so a
 * refresh that lands while the player is reading never moves a card under them. The Compendium does subscribe.
 */
import { create } from 'zustand';
import { currentIdentity } from '../identity';
import { GUIDES, toGuide, type Guide } from './guides';
import { fetchMyGuides, fetchOfficialGuides, fetchTeamFlag } from './guidesRemote';

export type GuidesCapability = 'unknown' | 'no-backend' | 'off' | 'offline' | 'on';
export type GuidesTab = 'team' | 'mine';

interface GuidesStore {
  capability: GuidesCapability;
  list: readonly Guide[];
  source: 'bundled' | 'server';
  team: boolean;
  mine: readonly Guide[];
  tab: GuidesTab;
  pendingEdit: string | null;
}

const NO_GUIDES: readonly Guide[] = [];
const INITIAL: GuidesStore = { capability: 'unknown', list: GUIDES, source: 'bundled', team: false, mine: NO_GUIDES, tab: 'team', pendingEdit: null };

export const useGuides = create<GuidesStore>(() => ({ ...INITIAL }));

const sameList = (a: readonly Guide[], b: readonly Guide[]): boolean =>
  a.length === b.length && a.every((g, i) => g.rowId === b[i]!.rowId && g.revision === b[i]!.revision);

/** Who a read is for: the account, and whether it is a guest. */
const identityKey = (): string => {
  const id = currentIdentity();
  return id ? `${id.userId}:${id.anonymous ? 'guest' : 'account'}` : '';
};

async function readGuides(): Promise<void> {
  const id = currentIdentity();
  const ans = await fetchOfficialGuides();
  if (ans.state !== 'on') {
    useGuides.setState({ capability: ans.state });
    return;
  }
  const next: Partial<GuidesStore> = { capability: 'on' };
  const server = ans.guides.map(toGuide).filter((g): g is Guide => g !== null);
  const cur = useGuides.getState();
  if (server.length > 0) {
    next.source = 'server';
    next.list = cur.source === 'server' && sameList(cur.list, server) ? cur.list : server;
  }
  if (id && !id.anonymous) {
    const [team, mine] = await Promise.all([fetchTeamFlag(id.userId), fetchMyGuides(id.userId)]);
    if (team !== undefined) next.team = team;
    if (mine !== undefined) {
      const guides = mine.map(toGuide).filter((g): g is Guide => g !== null);
      next.mine = sameList(cur.mine, guides) ? cur.mine : guides;
    }
  } else {
    next.team = false;
    next.mine = NO_GUIDES;
  }
  useGuides.setState(next);
}

let loading: Promise<void> | null = null;
let loadingFor = '';
let again = false;

/** Read the guides this account can see. Safe to call often. Never throws. */
export function loadGuides(): Promise<void> {
  const key = identityKey();
  if (loading) {
    if (key !== loadingFor) again = true;
    return loading;
  }
  loadingFor = key;
  loading = readGuides()
    .catch(() => { /* the reads never throw; this guards the mapping */ })
    .finally(() => {
      loading = null;
      if (again) { again = false; void loadGuides(); }
    });
  return loading;
}

export function setGuidesTab(tab: GuidesTab): void {
  useGuides.setState({ tab });
}

/** The rail asks the Compendium to open this guide in the editor. */
export function requestGuideEdit(rowId: string): void {
  useGuides.setState({ pendingEdit: rowId });
}

/** The Compendium takes the request (once). */
export function takePendingEdit(): string | null {
  const rowId = useGuides.getState().pendingEdit;
  if (rowId !== null) useGuides.setState({ pendingEdit: null });
  return rowId;
}

const upsert = (arr: readonly Guide[], g: Guide): Guide[] =>
  (arr.some((x) => x.rowId === g.rowId) ? arr.map((x) => (x.rowId === g.rowId ? g : x)) : [...arr, g]);

/** Apply a guide the server just saved, without a re-read. */
export function guideSaved(g: Guide): void {
  const s = useGuides.getState();
  if (!g.official) {
    useGuides.setState({ mine: upsert(s.mine, g) });
    return;
  }
  // A Team Ascent guide saved while the built-in copies are showing: the server now has one, so re-read.
  if (s.source === 'server') useGuides.setState({ list: upsert(s.list, g) });
  else void loadGuides();
}

/** Apply a delete the server just confirmed. */
export function guideDeleted(rowId: string): void {
  const s = useGuides.getState();
  useGuides.setState({ list: s.list.filter((g) => g.rowId !== rowId), mine: s.mine.filter((g) => g.rowId !== rowId) });
}

export function resetGuidesForTests(): void {
  loading = null;
  loadingFor = '';
  again = false;
  useGuides.setState({ ...INITIAL });
}
```

- [ ] **Step 4: Run every guide test and the web typecheck**

Run: `npx vitest run packages/ui/src/guides && npm run typecheck:web`
Expected: PASS, no type errors. `lobbyGuidesRail.test.tsx` and `compendiumGuides.test.tsx` mount the real store with the real seam and no backend: they must still pass untouched.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/guides/guidesStore.ts packages/ui/src/guides/guidesStore.test.ts
git commit -m "feat(guides): the store holds my team flag and my guides, and re-reads when I sign in mid-read"
```

---

### Task 4: From what the editor holds to what the server accepts

**Files:**
- Create: `packages/ui/src/guides/guideDrafts.ts`
- Modify: `packages/ui/src/guides/guides.ts` (export one existing constant)
- Modify: `packages/ui/src/guides/guidesRoundTrip.test.ts` (use the new payload builder)
- Test: `packages/ui/src/guides/guideDrafts.test.ts`

**Interfaces:**
- Consumes: `GuideDraftInput` (Task 1); `Guide`, `GUIDES`, `poolIdsFor` from `./guides`; `BUNDLED_GUIDE_DATA` from `./guides.bundled`; `guideSetsFor`, `validateGuideDraft`, `GUIDE_LIMITS`, `TEAM_BYLINE` from `@game/guides`; `poolFor`, `SetId` from `@game/content`.
- Produces:
  - `EditorDraft` (below)
  - `emptyDraft(byline: string): EditorDraft`
  - `draftFromGuide(g: Guide): EditorDraft`
  - `duplicateDraft(g: Guide, byline: string): EditorDraft`
  - `mentionsFor(body: string, setId: SetId, listed: readonly string[]): string[]`
  - `missingIn(d: EditorDraft, setId: SetId): string[]`
  - `toWire(d: EditorDraft, setId: SetId): GuideDraftInput`
  - `draftProblems(d: EditorDraft, setId: SetId): Array<{ field: string; message: string }>`
  - `sameDraft(a: EditorDraft, b: EditorDraft): boolean`
  - `builtInImportPayload(): GuideDraftInput[]`
  - from `guides.ts`: `SET_FACTS` becomes exported.

- [ ] **Step 1: Export the set facts**

In `packages/ui/src/guides/guides.ts`, change `const SET_FACTS: readonly SetFacts[] =` to `export const SET_FACTS: readonly SetFacts[] =` and put this comment above it:
```ts
/** Every set's card ids and tribe roster, in the shape the carry-over rule (`guideSetsFor`) takes. */
```

- [ ] **Step 2: Write the failing test**

`packages/ui/src/guides/guideDrafts.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { GUIDE_LIMITS, validateGuideDraft } from '@game/guides';
import { BUNDLED_GUIDE_DATA } from './guides.bundled';
import { GUIDES, type Guide } from './guides';
import {
  builtInImportPayload, draftFromGuide, draftProblems, duplicateDraft, emptyDraft, mentionsFor, missingIn, sameDraft, toWire,
} from './guideDrafts';

const name = (id: string): string => CARD_INDEX[id]!.name;
const inSet2 = new Set(poolFor('set2').all.map((c) => c.id));
const archived = Object.values(CARD_INDEX).find((c) => !inSet2.has(c.id) && !c.spell && !c.token)!;
const sunmane = GUIDES.find((g) => g.id === 'set2-beast-sunmane')!;
const oona = GUIDES.find((g) => g.id === 'set2-beast-oona')!;
const serverGuide = (g: Guide, patch: Partial<Guide> = {}): Guide => ({ ...g, rowId: '11111111-1111-4111-8111-111111111111', revision: 4, ...patch });

describe('mentionsFor: the cards a write-up names', () => {
  it('finds a card of the set by its name, whatever the capitals, once', () => {
    const body = `Play ${name('grim').toUpperCase()} early, then ${name('grim')} again.`;
    expect(mentionsFor(body, 'set2', [])).toEqual(['grim']);
  });
  it('does not repeat a card the guide already lists as Core or Enabler', () => {
    expect(mentionsFor(`Find ${name('grim')}.`, 'set2', ['grim'])).toEqual([]);
  });
  it('the longest name wins when one card name contains another', () => {
    const longer = poolFor('set2').all.find((a) => poolFor('set2').all.some((b) => b.id !== a.id && a.name.toLowerCase().includes(b.name.toLowerCase()) && a.name.length > b.name.length));
    if (!longer) return; // no such pair in this set today: nothing to pin
    expect(mentionsFor(`Then ${longer.name}.`, 'set2', [])).toEqual([longer.id]);
  });
  it('only whole names: a name inside a longer word is not a mention', () => {
    expect(mentionsFor(`x${name('grim')}x and ${name('grim')}s`, 'set2', [])).toEqual([]);
  });
  it('handles a name with punctuation in it', () => {
    const punct = poolFor('set2').all.find((c) => /[^a-zA-Z0-9 ]/.test(c.name))!;
    expect(mentionsFor(`Use ${punct.name}, then pass.`, 'set2', [])).toEqual([punct.id]);
  });
  it('a card that is not in this set is not found', () => {
    expect(mentionsFor(`Old ${archived.name}.`, 'set2', [])).toEqual([]);
  });
  it('stops at the limit', () => {
    const many = poolFor('set2').all.slice(0, GUIDE_LIMITS.mentions + 5).map((c) => c.name).join(', ');
    expect(mentionsFor(many, 'set2', []).length).toBeLessThanOrEqual(GUIDE_LIMITS.mentions);
  });
});

describe('drafts from guides', () => {
  it('a new guide starts empty, private, with the player\'s by line', () => {
    expect(emptyDraft('Mike')).toMatchObject({ rowId: null, revision: null, official: false, byline: 'Mike', title: '', body: '', core: [], enablers: [], aliases: [], forkedFrom: null });
  });
  it('editing a guide carries its row, revision and every field; nicknames become rows', () => {
    const d = draftFromGuide(serverGuide(oona));
    expect(d).toMatchObject({ rowId: '11111111-1111-4111-8111-111111111111', revision: 4, official: true, title: oona.title, body: oona.body, core: [...oona.core], enablers: [...oona.enablers] });
    expect(d.aliases).toEqual([{ word: 'oona', card: 'b2_oona' }]);
  });
  it('a duplicate is a NEW private guide under the duplicator\'s name that remembers its source', () => {
    const d = duplicateDraft(serverGuide(sunmane), 'Mike');
    expect(d).toMatchObject({ rowId: null, revision: null, official: false, byline: 'Mike', forkedFrom: '11111111-1111-4111-8111-111111111111', core: [...sunmane.core] });
    expect(d.title).toBe(`${sunmane.title} (copy)`);
  });
  it('a duplicate\'s title is cut to the limit; a copy of a built-in with no server row has no source', () => {
    expect(duplicateDraft(serverGuide(sunmane, { title: 'x'.repeat(40) }), 'Mike').title).toHaveLength(GUIDE_LIMITS.title);
    expect(duplicateDraft(sunmane, 'Mike').forkedFrom).toBeNull();
  });
  it('sameDraft compares by value', () => {
    const a = draftFromGuide(serverGuide(sunmane));
    expect(sameDraft(a, { ...a, core: [...a.core] })).toBe(true);
    expect(sameDraft(a, { ...a, title: `${a.title}!` })).toBe(false);
  });
});

describe('toWire: the document sent to the server', () => {
  it('a built-in guide, unchanged, passes the server\'s own validation and keeps its mentions and sets', () => {
    for (const g of GUIDES) {
      const wire = toWire(draftFromGuide(serverGuide(g)), BUNDLED_GUIDE_DATA.find((b) => b.id === g.id)!.set);
      expect(validateGuideDraft(wire), g.id).toMatchObject({ ok: true });
      expect([...wire.mentions].sort(), g.id).toEqual(expect.arrayContaining([...(g.mentions ?? [])].sort()));
      expect(wire.sets, g.id).toContain(BUNDLED_GUIDE_DATA.find((b) => b.id === g.id)!.set);
    }
  });
  it('an update carries id and revision; a new guide carries neither; a Team Ascent guide says official and wears Team Ascent', () => {
    const upd = toWire(draftFromGuide(serverGuide(sunmane)), 'set2');
    expect(upd).toMatchObject({ id: '11111111-1111-4111-8111-111111111111', revision: 4, official: true, byline: 'Team Ascent' });
    const fresh = toWire({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim'] }, 'set2');
    expect(fresh).not.toHaveProperty('id');
    expect(fresh).not.toHaveProperty('revision');
    expect(fresh).toMatchObject({ official: false, byline: 'Mike' });
  });
  it('derives the mentions from the write-up, and a nickname\'s card is listed even when its full name is not written', () => {
    const d = { ...emptyDraft('Mike'), title: 'T', body: `Find ${name('grim')} and the king.`, core: ['b2_sunmane'], aliases: [{ word: 'king', card: 'b2_oona' }] };
    const wire = toWire(d, 'set2');
    expect(wire.mentions).toEqual(expect.arrayContaining(['grim', 'b2_oona']));
    expect(wire.aliases).toEqual({ king: 'b2_oona' });
  });
  it('a blank nickname row is dropped; an empty art icon falls back to the first Core card', () => {
    const wire = toWire({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim'], aliases: [{ word: '  ', card: 'grim' }, { word: 'g', card: '' }] }, 'set2');
    expect(wire.aliases).toEqual({});
    expect(wire.iconCard).toBe('grim');
  });
  it('a duplicate sends its source only when it is new', () => {
    expect(toWire({ ...duplicateDraft(serverGuide(sunmane), 'Mike') }, 'set2').forkedFrom).toBe('11111111-1111-4111-8111-111111111111');
    expect(toWire(draftFromGuide(serverGuide(sunmane)), 'set2').forkedFrom ?? null).toBeNull();
  });
});

describe('draftProblems: what stops a save, in the player\'s words', () => {
  const ok = { ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim'] };
  it('a complete guide has none', () => {
    expect(draftProblems(ok, 'set2')).toEqual([]);
  });
  it('a missing card is reported first and blocks the save', () => {
    const d = { ...ok, core: ['grim', archived.id], enablers: ['card_that_never_existed'] };
    expect(missingIn(d, 'set2').sort()).toEqual([archived.id, 'card_that_never_existed'].sort());
    expect(draftProblems(d, 'set2')[0]).toMatchObject({ field: 'cards' });
    expect(draftProblems(d, 'set2')[0]!.message).toMatch(/missing or removed/i);
  });
  it('names the field for each limit, with a sentence', () => {
    const field = (patch: Partial<typeof ok>): string => draftProblems({ ...ok, ...patch }, 'set2')[0]?.field ?? 'none';
    expect(field({ title: '' })).toBe('title');
    expect(field({ title: 'x'.repeat(41) })).toBe('title');
    expect(field({ body: '' })).toBe('body');
    expect(field({ byline: '' })).toBe('byline');
    expect(field({ core: [] })).toBe('core');
    expect(field({ tagline: 'x'.repeat(81) })).toBe('tagline');
    for (const p of draftProblems({ ...ok, title: '' }, 'set2')) expect(p.message.includes(String.fromCharCode(0x2014)) || p.message.includes('--')).toBe(false);
  });
  it('a tribe that is not in this set stops the save with a sentence about tribes', () => {
    const offRoster = [...new Set(Object.values(SETS).flatMap((s) => [...s.tribes]))].find((t) => !SETS.set2.tribes.includes(t))!;
    const p = draftProblems({ ...ok, tribes: [offRoster] }, 'set2');
    expect(p[0]).toMatchObject({ field: 'tribes' });
  });
});

describe('builtInImportPayload', () => {
  it('is the eleven built-in guides as Team Ascent documents the server accepts, each with its slug', () => {
    const payload = builtInImportPayload();
    expect(payload.map((p) => p.slug)).toEqual(BUNDLED_GUIDE_DATA.map((b) => b.id));
    for (const p of payload) {
      expect(p.official).toBe(true);
      expect(validateGuideDraft(p, { requireSlug: true }), p.slug).toMatchObject({ ok: true });
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/guides/guideDrafts.test.ts`
Expected: FAIL, cannot resolve `./guideDrafts`.

- [ ] **Step 4: Implement**

`packages/ui/src/guides/guideDrafts.ts`:
```ts
/**
 * GUIDES: what the editor holds, and how it becomes the document the server accepts. Pure: no React, no network.
 *
 * The author types a title, a write-up and picks cards. Two things are worked out for them at save time:
 *  - `mentions`: the cards of THIS set the write-up names (owner 2026-10-11: any card name lights up as you type),
 *    so they become hoverable for readers. Whole names only, capitals ignored, the longest name first.
 *  - `sets`: the sets the guide shows in (the carry-over rule, `guideSetsFor`).
 *
 * A guide holding a card that is missing from the set cannot be saved (`draftProblems`), so a saved guide is always
 * whole in the set it was saved in.
 */
import type { Tribe } from '@game/core';
import { poolFor, type SetId } from '@game/content';
import { GUIDE_LIMITS, TEAM_BYLINE, guideSetsFor, validateGuideDraft } from '@game/guides';
import { BUNDLED_GUIDE_DATA } from './guides.bundled';
import { GUIDES, SET_FACTS, poolIdsFor, type Guide } from './guides';
import type { GuideDraftInput } from './guidesRemote';

/** A guide while it is being edited. Nicknames are rows (a word and a card) so a half-typed one can exist. */
export interface EditorDraft {
  /** The server row being edited; null for a new guide. */
  rowId: string | null;
  /** The revision that row was loaded at. */
  revision: number | null;
  official: boolean;
  byline: string;
  tribes: Tribe[];
  pairsWith: Tribe[];
  iconCard: string;
  title: string;
  tagline: string;
  body: string;
  core: string[];
  enablers: string[];
  aliases: Array<{ word: string; card: string }>;
  /** The guide this one was duplicated from (a server row id), sent only when the guide is first created. */
  forkedFrom: string | null;
}

export function emptyDraft(byline: string): EditorDraft {
  return { rowId: null, revision: null, official: false, byline, tribes: [], pairsWith: [], iconCard: '', title: '', tagline: '', body: '', core: [], enablers: [], aliases: [], forkedFrom: null };
}

export function draftFromGuide(g: Guide): EditorDraft {
  return {
    rowId: g.rowId,
    revision: g.rowId ? g.revision : null,
    official: g.official,
    byline: g.byline,
    tribes: [...g.tribes],
    pairsWith: [...(g.pairsWith ?? [])],
    iconCard: g.iconCard,
    title: g.title,
    tagline: g.tagline,
    body: g.body,
    core: [...g.core],
    enablers: [...g.enablers],
    aliases: Object.entries(g.aliases ?? {}).map(([word, card]) => ({ word, card })),
    forkedFrom: null,
  };
}

/** A copy to edit: a NEW private guide under `byline`, remembering the guide it came from (when that has a row). */
export function duplicateDraft(g: Guide, byline: string): EditorDraft {
  const suffix = ' (copy)';
  const title = [...g.title].slice(0, GUIDE_LIMITS.title - suffix.length).join('') + suffix;
  return { ...draftFromGuide(g), rowId: null, revision: null, official: false, byline, title, forkedFrom: g.rowId };
}

export const sameDraft = (a: EditorDraft, b: EditorDraft): boolean => JSON.stringify(a) === JSON.stringify(b);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface NameIndex { byName: Map<string, string>; re: RegExp | null }
const nameIndex = new Map<SetId, NameIndex>();
/** A set's card names (lower case -> id) and one expression that finds any of them as a whole name, longest first. */
function namesOf(setId: SetId): NameIndex {
  let hit = nameIndex.get(setId);
  if (!hit) {
    const byName = new Map<string, string>();
    for (const c of poolFor(setId).all) {
      const key = c.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, c.id);
    }
    const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
    // A whole name: not glued to a letter or digit on either side (a card name may itself end in punctuation).
    hit = { byName, re: names.length ? new RegExp(`(?<![a-z0-9])(?:${names.join('|')})(?![a-z0-9])`, 'gi') : null };
    nameIndex.set(setId, hit);
  }
  return hit;
}

/** The cards of `setId` that `body` names, in the order they first appear, without those in `listed`. */
export function mentionsFor(body: string, setId: SetId, listed: readonly string[]): string[] {
  const { byName, re } = namesOf(setId);
  if (!re || !body) return [];
  const skip = new Set(listed);
  const out: string[] = [];
  for (const m of body.matchAll(re)) {
    const id = byName.get(m[0].toLowerCase());
    if (!id || skip.has(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= GUIDE_LIMITS.mentions) break;
  }
  return out;
}

/** The Core and Enabler cards of the draft that are not in `setId`'s pool (archived, moved, or gone). */
export function missingIn(d: EditorDraft, setId: SetId): string[] {
  const pool = poolIdsFor(setId);
  return [...new Set([...d.core, ...d.enablers])].filter((id) => !pool.has(id));
}

/** The document for `guide-write`. Derives `mentions` and `sets`; never sends a half-typed nickname. */
export function toWire(d: EditorDraft, setId: SetId): GuideDraftInput {
  const aliases: Record<string, string> = {};
  for (const a of d.aliases) {
    const word = a.word.trim();
    if (word && a.card) aliases[word] = a.card;
  }
  const listed = [...d.core, ...d.enablers];
  const mentions = mentionsFor(d.body, setId, listed);
  for (const id of Object.values(aliases)) {
    if (!listed.includes(id) && !mentions.includes(id) && mentions.length < GUIDE_LIMITS.mentions) mentions.push(id);
  }
  const sets = guideSetsFor({ core: d.core, enablers: d.enablers, mentions, tribes: d.tribes, pairsWith: d.pairsWith }, SET_FACTS);
  return {
    ...(d.rowId ? { id: d.rowId, revision: d.revision ?? 1 } : {}),
    official: d.official,
    byline: d.official ? TEAM_BYLINE : d.byline,
    sets,
    tribes: [...d.tribes],
    pairsWith: [...d.pairsWith],
    iconCard: d.iconCard || d.core[0] || '',
    title: d.title,
    tagline: d.tagline,
    body: d.body,
    core: [...d.core],
    enablers: [...d.enablers],
    mentions,
    aliases,
    ...(d.rowId ? {} : { forkedFrom: d.forkedFrom }),
  };
}

/** What the editor tells the author about each part of the guide the limits refuse. */
const HELP: Readonly<Record<string, string>> = {
  title: `Give the guide a title of up to ${GUIDE_LIMITS.title} characters.`,
  tagline: `Keep the tagline to ${GUIDE_LIMITS.tagline} characters.`,
  body: `Write the guide, in up to ${GUIDE_LIMITS.body.toLocaleString('en-US')} characters.`,
  byline: `Add a "by" line of up to ${GUIDE_LIMITS.byline} characters.`,
  core: `Add 1 to ${GUIDE_LIMITS.core} Core cards, each once.`,
  enablers: `Use up to ${GUIDE_LIMITS.enablers} Enablers, each once.`,
  iconCard: 'Pick an art icon.',
  tribes: `Pick up to ${GUIDE_LIMITS.tribes} tribes that are in this set.`,
  pairsWith: 'Pick a "pairs with" tribe that is in this set.',
  aliases: `Each nickname needs a word and a card, up to ${GUIDE_LIMITS.aliases} nicknames.`,
  mentions: 'The write-up names too many cards.',
  sets: 'Add cards from this set.',
};

/** Why this draft cannot be saved yet, most important first. Empty = it can. */
export function draftProblems(d: EditorDraft, setId: SetId): Array<{ field: string; message: string }> {
  const missing = missingIn(d, setId);
  if (missing.length > 0) {
    return [{ field: 'cards', message: missing.length === 1 ? 'Remove the card that is missing or removed before saving.' : 'Remove the cards that are missing or removed before saving.' }];
  }
  const wire = toWire(d, setId);
  const v = validateGuideDraft(wire);
  if (!v.ok) {
    // Two refusals are reported under the field the author can act on. An empty Core row leaves no art icon, and the
    // server checks the icon first: say Core. With every card in this set, an empty `sets` can only mean a tribe that
    // shares no roster with these cards: say tribes.
    const field = v.field === 'iconCard' && d.core.length === 0 ? 'core' : v.field === 'sets' ? 'tribes' : v.field;
    return [{ field, message: HELP[field] ?? 'Something on this guide is not valid.' }];
  }
  // Every card is in this set, so the only way this set is absent from `sets` is a tribe that is not on its roster.
  if (!wire.sets.includes(setId)) return [{ field: 'tribes', message: HELP.tribes! }];
  return [];
}

/** The built-in guides as the documents the team-only import sends (the Import button and the round-trip test). */
export function builtInImportPayload(): GuideDraftInput[] {
  return BUNDLED_GUIDE_DATA.map((b, i) => ({
    slug: b.id,
    official: true,
    byline: TEAM_BYLINE,
    sets: [...GUIDES[i]!.sets],
    tribes: [...b.tribes],
    pairsWith: [...(b.pairsWith ?? [])],
    iconCard: b.iconCard,
    title: b.title,
    tagline: b.tagline,
    body: b.body,
    core: [...b.core],
    enablers: [...b.enablers],
    mentions: [...(b.mentions ?? [])],
    aliases: { ...(b.aliases ?? {}) },
  }));
}
```

Two things to check against the tests rather than assume. (a) `draftProblems` relies on the ORDER of the checks inside `validateGuideDraft` (`packages/guides/src/validate.ts`: title, tagline, write-up, by line, sets, tribes, pairs with, art icon, Core, Enablers, mentions, nicknames). If that order has changed, keep the two remappings above pointing at the field the author can act on, and keep `validateGuideDraft` the authority for every limit: never retype a limit. (b) The built-in Oona guide's nickname key is lower case `oona` in the data.

- [ ] **Step 5: Make the round-trip test use the real payload builder**

In `packages/ui/src/guides/guidesRoundTrip.test.ts`, the test "the eleven built-in guides import through the real handler and read back identical" builds its import payload by hand. Replace that hand-built array with `builtInImportPayload()` (import it from `./guideDrafts`), so the test now proves the exact documents the Import button sends. Change nothing else in that test; its assertions stay.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run packages/ui/src/guides/guideDrafts.test.ts packages/ui/src/guides/guidesRoundTrip.test.ts packages/ui/src/guides/guidesData.test.ts && npm run typecheck:web`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/guides/guideDrafts.ts packages/ui/src/guides/guideDrafts.test.ts packages/ui/src/guides/guides.ts packages/ui/src/guides/guidesRoundTrip.test.ts
git commit -m "feat(guides): turn an edited guide into the server document; derive named cards and sets"
```

---

### Task 5: The draft kept on the device

**Files:**
- Create: `packages/ui/src/guides/guideDraftStore.ts`
- Test: `packages/ui/src/guides/guideDraftStore.test.ts`

**Interfaces:**
- Consumes: `EditorDraft` (Task 4).
- Produces: `saveLocalDraft(userId: string, draft: EditorDraft): void`, `loadLocalDraft(userId: string): EditorDraft | null`, `clearLocalDraft(): void`. One draft at a time, under the key `ascent.guideDraft`.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/guides/guideDraftStore.test.ts`:
```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDraft } from './guideDrafts';
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from './guideDraftStore';

const draft = { ...emptyDraft('Mike'), title: 'Half written', body: 'So far', core: ['grim'], aliases: [{ word: 'g', card: 'grim' }] };

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the in-progress guide kept on this device', () => {
  it('comes back as it was saved, for the account that wrote it', () => {
    saveLocalDraft('u-1', draft);
    expect(loadLocalDraft('u-1')).toEqual(draft);
  });
  it('is not offered to a different account on the same device', () => {
    saveLocalDraft('u-1', draft);
    expect(loadLocalDraft('u-2')).toBeNull();
  });
  it('is one draft: a second save replaces the first; clear removes it', () => {
    saveLocalDraft('u-1', draft);
    saveLocalDraft('u-1', { ...draft, title: 'Newer' });
    expect(loadLocalDraft('u-1')!.title).toBe('Newer');
    clearLocalDraft();
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('junk in storage, or a draft from an older shape, reads as no draft and never throws', () => {
    localStorage.setItem('ascent.guideDraft', 'not json');
    expect(loadLocalDraft('u-1')).toBeNull();
    localStorage.setItem('ascent.guideDraft', JSON.stringify({ userId: 'u-1', draft: { title: 7 } }));
    expect(loadLocalDraft('u-1')).toBeNull();
    localStorage.setItem('ascent.guideDraft', JSON.stringify({ userId: 'u-1' }));
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('storage that throws (a private window) is survived on every call', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => saveLocalDraft('u-1', draft)).not.toThrow();
    expect(loadLocalDraft('u-1')).toBeNull();
    expect(() => clearLocalDraft()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/guides/guideDraftStore.test.ts`
Expected: FAIL, cannot resolve `./guideDraftStore`.

- [ ] **Step 3: Implement**

`packages/ui/src/guides/guideDraftStore.ts`:
```ts
/**
 * GUIDES: the one in-progress guide kept on this device. A per-viewer convenience only (it lives in this browser's
 * storage, which can be empty or can throw): closing the Compendium mid-edit, a crash or a refused save does not
 * lose the author's text, and the Guides tab offers it back. The saved guide itself always lives on the server.
 */
import type { EditorDraft } from './guideDrafts';

const KEY = 'ascent.guideDraft';

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** A stored value is a draft only if every field the editor reads has the right shape. */
function asDraft(v: unknown): EditorDraft | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const text = ['byline', 'iconCard', 'title', 'tagline', 'body'].every((k) => typeof o[k] === 'string');
  const lists = ['tribes', 'pairsWith', 'core', 'enablers'].every((k) => isStrings(o[k]));
  const aliases = Array.isArray(o.aliases) && o.aliases.every((a) => a && typeof a === 'object'
    && typeof (a as { word?: unknown }).word === 'string' && typeof (a as { card?: unknown }).card === 'string');
  const ids = (o.rowId === null || typeof o.rowId === 'string') && (o.revision === null || typeof o.revision === 'number')
    && (o.forkedFrom === null || typeof o.forkedFrom === 'string') && typeof o.official === 'boolean';
  return text && lists && aliases && ids ? (v as EditorDraft) : null;
}

export function saveLocalDraft(userId: string, draft: EditorDraft): void {
  try { localStorage.setItem(KEY, JSON.stringify({ userId, draft })); } catch { /* storage unavailable: nothing to keep */ }
}

/** The kept draft, only for the account that wrote it. */
export function loadLocalDraft(userId: string): EditorDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { userId?: unknown; draft?: unknown };
    return o && o.userId === userId ? asDraft(o.draft) : null;
  } catch {
    return null;
  }
}

export function clearLocalDraft(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/ui/src/guides/guideDraftStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/guides/guideDraftStore.ts packages/ui/src/guides/guideDraftStore.test.ts
git commit -m "feat(guides): keep the in-progress guide on the device"
```

---
### Task 6: The card picker

**Files:**
- Create: `packages/ui/src/guides/GuideCardPicker.tsx`
- Test: `packages/ui/src/guides/guideCardPicker.test.tsx`

**Interfaces:**
- Consumes: `poolFor`, `SetId` from `@game/content`.
- Produces: `GuideCardPicker` with props `{ setId: SetId; label: string; exclude?: readonly string[]; onPick: (cardId: string) => void }`. It renders inline (no portal). It does NOT handle Esc: the editor that hosts it does (Task 7), because the editor claims Esc for the whole tab.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/guides/guideCardPicker.test.tsx`:
```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX, poolFor } from '@game/content';
import { mount, type Mounted } from '../renderedText.mount';
import { GuideCardPicker } from './GuideCardPicker';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const type = (el: HTMLInputElement, value: string): void => {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const rows = (c: HTMLElement): string[] => [...c.querySelectorAll('.gpick-row .gpick-name')].map((n) => n.textContent!);
const grim = CARD_INDEX['grim']!;

describe('the guide card picker', () => {
  it('lists this set\'s cards by name, at most twelve at a time', () => {
    ui = mount(<GuideCardPicker setId="set2" label="Add a Core card" onPick={() => {}} />);
    const shown = rows(ui.container);
    expect(shown.length).toBe(12);
    expect(shown).toEqual([...shown].sort((a, b) => a.localeCompare(b)));
    const inSet = new Set(poolFor('set2').all.map((c) => c.name));
    for (const n of shown) expect(inSet.has(n), n).toBe(true);
  });
  it('narrows as you type, every word must match, capitals ignored', () => {
    ui = mount(<GuideCardPicker setId="set2" label="Add a Core card" onPick={() => {}} />);
    type(ui.container.querySelector('input')!, grim.name.toUpperCase());
    expect(rows(ui.container)).toContain(grim.name);
    type(ui.container.querySelector('input')!, 'zzzz no such card');
    expect(rows(ui.container)).toEqual([]);
    expect(ui.container.textContent).toContain('No card matches.');
  });
  it('leaves out the cards already in the row', () => {
    ui = mount(<GuideCardPicker setId="set2" label="Add a Core card" exclude={['grim']} onPick={() => {}} />);
    type(ui.container.querySelector('input')!, grim.name);
    expect(rows(ui.container)).not.toContain(grim.name);
  });
  it('a click picks that card; Enter picks the top match', () => {
    const onPick = vi.fn();
    ui = mount(<GuideCardPicker setId="set2" label="Add a Core card" onPick={onPick} />);
    const input = ui.container.querySelector('input')!;
    type(input, grim.name);
    act(() => { ui!.container.querySelector<HTMLButtonElement>('.gpick-row')!.click(); });
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onPick.mock.calls.map((c) => c[0])).toEqual(['grim', 'grim']);
  });
  it('carries no native tooltip and labels its search box', () => {
    ui = mount(<GuideCardPicker setId="set2" label="Add a Core card" onPick={() => {}} />);
    expect(ui.container.querySelector('[title]')).toBeNull();
    expect(ui.container.querySelector('input')!.getAttribute('aria-label')).toContain('Add a Core card');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/guides/guideCardPicker.test.tsx`
Expected: FAIL, cannot resolve `./GuideCardPicker`.

- [ ] **Step 3: Implement**

`packages/ui/src/guides/GuideCardPicker.tsx`:
```tsx
import { memo, useMemo, useState } from 'react';
import type { CardDef } from '@game/core';
import { poolFor, type SetId } from '@game/content';

/**
 * THE GUIDE EDITOR'S CARD PICKER: search this set's cards by name and pick one (a Core card, an Enabler, the art
 * icon). Inline, under the row it adds to. Names only, no portraits: it is a search list, and the picked card shows
 * as a real portrait in the row the moment it is added.
 *
 * It does not handle Esc. The editor claims Esc for the whole tab and closes the picker first (GuideEditor).
 */
const MAX_ROWS = 12;

const kindOf = (c: CardDef): string => (c.spell ? 'Spell' : c.token ? 'Token' : `Tier ${c.tier}`);

export const GuideCardPicker = memo(function GuideCardPicker({ setId, label, exclude, onPick }: {
  setId: SetId;
  /** What picking does ("Add a Core card"); read by screen readers on the search box. */
  label: string;
  /** Card ids not to offer (the ones already in this row). */
  exclude?: readonly string[];
  onPick: (cardId: string) => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const cards = useMemo(() => [...poolFor(setId).all].sort((a, b) => a.name.localeCompare(b.name)), [setId]);
  const found = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const skip = new Set(exclude ?? []);
    const out: CardDef[] = [];
    for (const c of cards) {
      if (skip.has(c.id)) continue;
      const hay = c.name.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) continue;
      out.push(c);
      if (out.length === MAX_ROWS) break;
    }
    return out;
  }, [cards, query, exclude]);
  return (
    <div className="gpick" role="group" aria-label={label}>
      <input
        className="gedit-input gpick-find"
        autoFocus
        value={query}
        placeholder="Search cards"
        aria-label={`${label}. Search this set's cards. Enter picks the top match.`}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && found[0]) { e.preventDefault(); onPick(found[0].id); } }}
      />
      <div className="gpick-list">
        {found.map((c) => (
          <button type="button" className="gpick-row" key={c.id} onClick={() => onPick(c.id)}>
            <span className="gpick-name">{c.name}</span>
            <span className="gpick-kind">{kindOf(c)}</span>
          </button>
        ))}
        {found.length === 0 && <span className="gpick-none">No card matches.</span>}
      </div>
    </div>
  );
});
```

Its styles live in `guideEditor.css` (Task 7). Until then the test does not depend on CSS.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/ui/src/guides/guideCardPicker.test.tsx && npm run typecheck:web`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/guides/GuideCardPicker.tsx packages/ui/src/guides/guideCardPicker.test.tsx
git commit -m "feat(guides): search and pick a card of the set"
```

---

### Task 7: The editor

**Files:**
- Create: `packages/ui/src/guides/GuideEditor.tsx`, `packages/ui/src/guides/guideEditor.css`
- Test: `packages/ui/src/guides/guideEditor.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 to 6; `toGuide`, `tribeInk`, `Guide` from `./guides`; `GuideEmblem`, `GuideText`, `TRIBE_NAME`, `guideAccent`, `useGuideViews` from `./GuideParts`; `Card` from `../Card`; `Icon` from `../Icon`; `sfx` from `../sfx`.
- Produces: `GuideEditor` with props:
  - `initial: EditorDraft`
  - `setId: SetId` (the set being edited in)
  - `tribes: readonly Tribe[]` (that set's whole roster, for the tribe pills)
  - `run: RunState | undefined` (for live card values, as elsewhere in the Compendium)
  - `userId: string` (whose device draft this is)
  - `canBeOfficial: boolean` (a team member creating a NEW guide may make it a Team Ascent guide)
  - `onClose: () => void` (called after a save, a delete, or a confirmed discard)

**The look is a first cut.** The CSS below reuses the Compendium's tokens and the existing guide card, but nobody has seen it rendered. Implement it exactly as written and do not tune it; the owner judges it (Task 11).

- [ ] **Step 1: Write the failing test**

`packages/ui/src/guides/guideEditor.test.tsx`:
```tsx
// @vitest-environment jsdom
/**
 * THE GUIDE EDITOR. Pins: every field edits the draft; Save sends the server document and closes; a refused save
 * keeps the editor open with the author's text and a sentence; a missing card blocks the save until removed; a
 * conflict offers Load their version / Overwrite with mine; Cancel and Esc ask before discarding changes; Tab and Esc
 * never reach the game's own handlers (which would close the Compendium); the draft is kept on the device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import type { GuideRecord } from '@game/guides';
import { mount, type Mounted } from '../renderedText.mount';
import type { GuideDraftInput, GuideWriteResult } from './guidesRemote';

let saveAnswer: (g: GuideDraftInput) => GuideWriteResult<GuideRecord>;
let byIdAnswer: GuideRecord | null | undefined;
const saves: GuideDraftInput[] = [];
const deletes: string[] = [];
vi.mock('./guidesRemote', () => ({
  GUIDE_COLUMNS: '',
  fetchOfficialGuides: async () => ({ state: 'offline' }),
  fetchTeamFlag: async () => undefined,
  fetchMyGuides: async () => undefined,
  fetchGuideById: async () => byIdAnswer,
  saveGuideRemote: async (g: GuideDraftInput) => { saves.push(g); return saveAnswer(g); },
  deleteGuideRemote: async (rowId: string) => { deletes.push(rowId); return { ok: true, value: true }; },
  importBuiltInsRemote: async () => ({ ok: true, value: { inserted: 0, skipped: 0 } }),
}));

const { GuideEditor } = await import('./GuideEditor');
const { draftFromGuide, emptyDraft } = await import('./guideDrafts');
const { loadLocalDraft } = await import('./guideDraftStore');
const { GUIDES } = await import('./guides');
const { resetGuidesForTests, useGuides } = await import('./guidesStore');

const ROW = '11111111-1111-4111-8111-111111111111';
const rec = (patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id: ROW, slug: null, authorId: 'u-1', byline: 'Mike', official: false, published: false, hidden: false, sets: ['set2'], tribes: [],
  pairsWith: [], iconCard: 'grim', title: 'Saved', tagline: '', body: 'B', core: ['grim'], enablers: [], mentions: [], aliases: {},
  forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0, revision: 2, createdAt: '', updatedAt: '', ...patch,
});
const inSet2 = new Set(poolFor('set2').all.map((c) => c.id));
const archived = Object.values(CARD_INDEX).find((c) => !inSet2.has(c.id) && !c.spell && !c.token)!;

let ui: Mounted | null = null;
let closed = 0;
const open = (initial = { ...emptyDraft('Mike'), title: 'My guide', body: 'Play it.', core: ['grim'] }, canBeOfficial = false): HTMLElement => {
  ui = mount(<GuideEditor initial={initial} setId="set2" tribes={SETS.set2.tribes} run={undefined} userId="u-1" canBeOfficial={canBeOfficial} onClose={() => { closed++; }} />);
  return ui.container;
};
const type = (el: Element, value: string): void => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const click = (el: Element): void => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const press = async (c: HTMLElement, text: string): Promise<void> => {
  const b = [...c.querySelectorAll('button')].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  await act(async () => { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
};
const alertText = (c: HTMLElement): string => c.querySelector('[role="alert"]')?.textContent ?? '';

beforeEach(() => {
  localStorage.clear();
  resetGuidesForTests();
  saves.length = 0;
  deletes.length = 0;
  closed = 0;
  byIdAnswer = rec();
  saveAnswer = (g) => ({ ok: true, value: rec({ title: g.title, body: g.body, core: g.core }) });
});
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); });

describe('editing the fields', () => {
  it('title, tagline, write-up and by line are typed straight onto the card and are sent on Save', async () => {
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Renamed');
    type(c.querySelector('.gedit-tagline')!, 'A tagline');
    type(c.querySelector('.gedit-body')!, 'New write-up.');
    type(c.querySelector('.gedit-byline')!, 'Mikey');
    await press(c, 'Save');
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ title: 'Renamed', tagline: 'A tagline', body: 'New write-up.', byline: 'Mikey', official: false, core: ['grim'] });
    expect(closed).toBe(1);
    expect(useGuides.getState().mine.map((g) => g.title)).toEqual(['Renamed']);
  });
  it('a tribe pill toggles a tribe, at most two', () => {
    const c = open();
    const pills = [...c.querySelectorAll<HTMLButtonElement>('.gedit-tribes .book-runetribe')];
    click(pills[0]!); click(pills[1]!); click(pills[2]!);
    expect(pills.filter((p) => p.getAttribute('aria-pressed') === 'true')).toHaveLength(2);
    click(pills[0]!);
    expect(pills.filter((p) => p.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });
  it('Add opens the picker under the row, picking adds the card and closes it, x removes, the arrows reorder', () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim', 'b2_sunmane'] });
    const core = c.querySelector('.gedit-row[data-row="core"]')!;
    const ids = (): string[] => [...core.querySelectorAll('.gedit-unit')].map((u) => u.getAttribute('data-card')!);
    expect(ids()).toEqual(['grim', 'b2_sunmane']);
    click(core.querySelector('.gedit-unit[data-card="b2_sunmane"] .gedit-earlier')!);
    expect(ids()).toEqual(['b2_sunmane', 'grim']);
    click(core.querySelector('.gedit-unit[data-card="grim"] .gedit-remove')!);
    expect(ids()).toEqual(['b2_sunmane']);
    click(core.querySelector('.gedit-add')!);
    const picker = c.querySelector('.gpick')!;
    const first = picker.querySelector<HTMLButtonElement>('.gpick-row')!;
    click(first);
    expect(ids()).toHaveLength(2);
    expect(c.querySelector('.gpick')).toBeNull();
  });
  it('the Add button is disabled at the limit, and the picker never offers a card already in the row', () => {
    const six = poolFor('set2').buyable.slice(0, 6).map((x) => x.id);
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: six });
    expect(c.querySelector<HTMLButtonElement>('.gedit-row[data-row="core"] .gedit-add')!.disabled).toBe(true);
  });
  it('a card name typed in the write-up lights up in the preview, and is sent as a mention', async () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['b2_sunmane'] });
    type(c.querySelector('.gedit-body')!, `Then find ${CARD_INDEX['grim']!.name}.`);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect([...c.querySelectorAll('.gedit-preview .lobbyguide-name')].map((n) => n.textContent)).toEqual([CARD_INDEX['grim']!.name]);
    await press(c, 'Save');
    expect(saves[0]!.mentions).toEqual(['grim']);
  });
  it('a nickname row is a word and one of the guide\'s cards', async () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'the big cat', core: ['b2_sunmane'] });
    await press(c, 'Add nickname');
    type(c.querySelector('.gedit-alias-word')!, 'cat');
    const sel = c.querySelector<HTMLSelectElement>('.gedit-alias-card')!;
    act(() => { sel.value = 'b2_sunmane'; sel.dispatchEvent(new Event('change', { bubbles: true })); });
    await press(c, 'Save');
    expect(saves[0]!.aliases).toEqual({ cat: 'b2_sunmane' });
  });
});

describe('who the guide is by', () => {
  it('a player never sees the Team Ascent choice', () => {
    expect(open().textContent).not.toContain('Team Ascent guide');
  });
  it('a team member creating a guide can make it a Team Ascent guide: the by line locks and official is sent', async () => {
    const c = open(undefined, true);
    await press(c, 'Team Ascent guide');
    expect(c.querySelector('.gedit-byline')).toBeNull();
    expect(c.textContent).toContain('by Team Ascent');
    await press(c, 'Save');
    expect(saves[0]).toMatchObject({ official: true, byline: 'Team Ascent' });
  });
  it('editing an existing Team Ascent guide sends official and the row\'s revision', async () => {
    const official = draftFromGuide({ ...GUIDES[0]!, rowId: ROW, revision: 5 });
    saveAnswer = (g) => ({ ok: true, value: rec({ official: true, byline: 'Team Ascent', title: g.title, authorId: null }) });
    const c = open(official);
    type(c.querySelector('.gedit-title')!, 'Sunmane, edited');
    await press(c, 'Save');
    expect(saves[0]).toMatchObject({ id: ROW, revision: 5, official: true });
  });
});

describe('a save that cannot go through', () => {
  it('a guide with no Core card is stopped before the server, with a sentence', async () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: [] });
    await press(c, 'Save');
    expect(saves).toEqual([]);
    expect(alertText(c)).toMatch(/Core/);
    expect(closed).toBe(0);
  });
  it('a missing card blocks the save until Remove missing cards is pressed', async () => {
    const c = open({ ...emptyDraft('Mike'), title: 'T', body: 'B', core: ['grim', archived.id], enablers: ['card_that_never_existed'] });
    expect(c.querySelectorAll('.lobbyguide-unit.missing')).toHaveLength(2);
    await press(c, 'Save');
    expect(saves).toEqual([]);
    expect(alertText(c)).toMatch(/missing or removed/i);
    await press(c, 'Remove missing cards');
    expect(c.querySelectorAll('.lobbyguide-unit.missing')).toHaveLength(0);
    await press(c, 'Save');
    expect(saves[0]).toMatchObject({ core: ['grim'], enablers: [] });
  });
  it('a refusal keeps the editor open with the author\'s text and says why', async () => {
    for (const [answer, want] of [
      [{ ok: false, code: 'blocked_text', field: 'body' }, /write-up has a word/],
      [{ ok: false, code: 'too_many_guides' }, /already have 20 guides/],
      [{ ok: false, code: 'sign_in_required' }, /Sign in/],
      [{ ok: false, code: 'unavailable' }, /cannot be saved yet/],
      [{ ok: false, code: 'offline' }, /kept on this device/],
    ] as const) {
      ui?.unmount();
      saveAnswer = () => answer as GuideWriteResult<GuideRecord>;
      const c = open();
      type(c.querySelector('.gedit-title')!, 'Keep me');
      await press(c, 'Save');
      expect(alertText(c), answer.code).toMatch(want);
      expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Keep me');
    }
    expect(closed).toBe(0);
  });
  it('a conflict offers Load their version, which replaces the text with the server\'s', async () => {
    saveAnswer = () => ({ ok: false, code: 'conflict' });
    byIdAnswer = rec({ title: 'Theirs', revision: 9 });
    const c = open(draftFromGuide({ ...GUIDES[0]!, rowId: ROW, revision: 5, official: false, authorId: 'u-1' }));
    type(c.querySelector('.gedit-title')!, 'Mine');
    await press(c, 'Save');
    expect(c.textContent).toContain('Someone else saved this guide while you were editing.');
    await press(c, 'Load their version');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Theirs');
    expect(closed).toBe(0);
  });
  it('a conflict offers Overwrite with mine, which saves my text at their revision', async () => {
    let n = 0;
    saveAnswer = (g) => (n++ === 0 ? { ok: false, code: 'conflict' } : { ok: true, value: rec({ title: g.title }) });
    byIdAnswer = rec({ title: 'Theirs', revision: 9 });
    const c = open(draftFromGuide({ ...GUIDES[0]!, rowId: ROW, revision: 5, official: false, authorId: 'u-1' }));
    type(c.querySelector('.gedit-title')!, 'Mine');
    await press(c, 'Save');
    await press(c, 'Overwrite with mine');
    expect(saves).toHaveLength(2);
    expect(saves[1]).toMatchObject({ id: ROW, revision: 9, title: 'Mine' });
    expect(closed).toBe(1);
  });
});

describe('leaving the editor', () => {
  it('Cancel with nothing changed just closes', async () => {
    const c = open();
    await press(c, 'Cancel');
    expect(closed).toBe(1);
  });
  it('Cancel with changes asks first; Keep editing stays, Discard closes and forgets the device draft', async () => {
    const c = open();
    type(c.querySelector('.gedit-title')!, 'Changed');
    await press(c, 'Cancel');
    expect(closed).toBe(0);
    expect(c.textContent).toContain('Discard your changes?');
    await press(c, 'Keep editing');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Changed');
    await press(c, 'Cancel');
    await press(c, 'Discard');
    expect(closed).toBe(1);
    expect(loadLocalDraft('u-1')).toBeNull();
  });
  it('Delete asks first, then deletes the row and closes', async () => {
    useGuides.setState({ mine: [{ ...GUIDES[0]!, id: ROW, rowId: ROW, official: false, authorId: 'u-1' }] });
    const c = open(draftFromGuide({ ...GUIDES[0]!, rowId: ROW, revision: 5, official: false, authorId: 'u-1' }));
    await press(c, 'Delete');
    expect(deletes).toEqual([]);
    await press(c, 'Delete for good');
    expect(deletes).toEqual([ROW]);
    expect(useGuides.getState().mine).toEqual([]);
    expect(closed).toBe(1);
  });
  it('a new guide has no Delete button', () => {
    expect([...open().querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Delete')).toBe(false);
  });
});

describe('the keyboard never closes the Compendium from inside the editor', () => {
  it('Tab and Esc are stopped before the game\'s own window handlers; Esc asks to leave; Enter in the title does nothing', () => {
    const reached: string[] = [];
    const game = (e: KeyboardEvent): void => { reached.push(e.key); };
    window.addEventListener('keydown', game);
    try {
      const c = open();
      const title = c.querySelector<HTMLInputElement>('.gedit-title')!;
      type(title, 'Changed');
      act(() => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
      act(() => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
      act(() => { title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
      expect(reached).toEqual(['Enter']);
      expect(c.textContent).toContain('Discard your changes?');
      expect(saves).toEqual([]);
      expect(closed).toBe(0);
    } finally {
      window.removeEventListener('keydown', game);
    }
  });
  it('Esc with the card picker open closes the picker, not the editor', () => {
    const c = open();
    click(c.querySelector('.gedit-row[data-row="core"] .gedit-add')!);
    expect(c.querySelector('.gpick')).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(c.querySelector('.gpick')).toBeNull();
    expect(closed).toBe(0);
    expect(c.textContent).not.toContain('Discard your changes?');
  });
  it('once unmounted, the editor no longer claims the keys', () => {
    open();
    ui!.unmount();
    ui = null;
    const reached: string[] = [];
    const game = (e: KeyboardEvent): void => { reached.push(e.key); };
    window.addEventListener('keydown', game);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    window.removeEventListener('keydown', game);
    expect(reached).toEqual(['Tab']);
  });
});

describe('the draft kept on the device', () => {
  it('is written shortly after a change, and cleared by a save', async () => {
    vi.useFakeTimers();
    const c = open();
    type(c.querySelector('.gedit-title')!, 'In progress');
    expect(loadLocalDraft('u-1')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(loadLocalDraft('u-1')!.title).toBe('In progress');
    vi.useRealTimers();
    await press(c, 'Save');
    expect(loadLocalDraft('u-1')).toBeNull();
  });
});

it('the editor carries no native tooltip', () => {
  expect(open().querySelector('[title]')).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/guides/guideEditor.test.tsx`
Expected: FAIL, cannot resolve `./GuideEditor`.

- [ ] **Step 3: Implement the component**

`packages/ui/src/guides/GuideEditor.tsx`:
```tsx
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Tribe } from '@game/core';
import type { SetId } from '@game/content';
import { GUIDE_LIMITS, TEAM_BYLINE } from '@game/guides';
import type { RunState } from '@game/sim';
import { Card, type CardView } from '../Card';
import { Icon } from '../Icon';
import { sfx } from '../sfx';
import { toGuide, tribeInk, type Guide } from './guides';
import { GuideCardPicker } from './GuideCardPicker';
import { GuideEmblem, GuideText, TRIBE_NAME, guideAccent, useGuideViews } from './GuideParts';
import { draftFromGuide, draftProblems, missingIn, sameDraft, toWire, type EditorDraft } from './guideDrafts';
import { clearLocalDraft, saveLocalDraft } from './guideDraftStore';
import { guideErrorMessage } from './guideMessages';
import { deleteGuideRemote, fetchGuideById, saveGuideRemote } from './guidesRemote';
import { guideDeleted, guideSaved } from './guidesStore';
import './lobbyGuides.css';
import './compendiumGuides.css';
import './guideEditor.css';

/**
 * THE GUIDE EDITOR (owner ask 2026-10-11: "the ability to edit existing guides while in game and save them ... create
 * a new guide either from scratch or by duplicating an existing guide"). The Compendium's guide card with its parts
 * made editable: the same header, write-up and portrait rows a reader sees, so the author edits what players get.
 *
 * The author types text and picks cards. Which cards the write-up names, and which sets the guide shows in, are
 * worked out for them at save (guideDrafts.ts). The server decides whether the save is allowed; a refusal keeps the
 * editor open with the text intact and a plain sentence.
 *
 * KEYS. The game closes the Compendium on Esc and toggles it on Tab (window listeners in Game.tsx). While this is
 * mounted a CAPTURE listener stops both first: Tab moves focus as usual, Esc closes the card picker if it is open,
 * else asks to leave the editor. Nothing else is touched.
 *
 * THE DEVICE DRAFT. A changed draft is written to this device shortly after each change and cleared by a save, a
 * delete or a confirmed discard, so closing the Compendium mid-edit loses nothing (guideDraftStore.ts).
 *
 * PERFORMANCE. Nothing animates. The preview and the derived card list follow a deferred copy of the draft, so
 * typing never waits on them. Portraits are the memoized compact `Card`.
 */

const len = (s: string): number => [...s].length;

/** A character counter that only appears near the limit. */
function Count({ value, max }: { value: string; max: number }): JSX.Element | null {
  const n = len(value);
  if (n < max - Math.max(10, Math.floor(max / 10))) return null;
  return <span className={`gedit-count${n > max ? ' over' : ''}`} aria-live="polite">{n}/{max}</span>;
}

const moved = (ids: readonly string[], from: number, to: number): string[] => {
  const next = [...ids];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
};

/** The draft as a `Guide`, for the shared read-only pieces (the emblem, the highlighted write-up). */
function previewOf(d: EditorDraft, mentions: readonly string[], aliases: Readonly<Record<string, string>>, setId: SetId): Guide {
  return {
    id: 'draft', rowId: d.rowId, sets: [setId], tribes: d.tribes, pairsWith: d.pairsWith.length ? d.pairsWith : undefined,
    iconCard: d.iconCard || d.core[0] || '', title: d.title, tagline: d.tagline, body: d.body, core: d.core, enablers: d.enablers,
    mentions: mentions.length ? mentions : undefined, aliases: Object.keys(aliases).length ? aliases : undefined,
    byline: d.official ? TEAM_BYLINE : d.byline, official: d.official, published: d.official, hidden: false, authorId: null,
    revision: d.revision ?? 0, order: 0,
  };
}

/** One editable portrait row (Core or Enablers): each card with move and remove buttons, and Add. */
function EditRow({ row, label, ids, max, views, missing, adding, setId, onChange, onToggleAdd }: {
  row: 'core' | 'enablers'; label: string; ids: readonly string[]; max: number; views: Map<string, CardView>;
  missing: ReadonlySet<string>; adding: boolean; setId: SetId; onChange: (ids: string[]) => void; onToggleAdd: () => void;
}): JSX.Element {
  return (
    <div className="lobbyguide-units gedit-row" data-row={row}>
      <div className="lobbyguide-unitslabel">{label} <span className="gedit-rowcount">{ids.length}/{max}</span></div>
      <div className="lobbyguide-unitrow">
        {ids.map((id, i) => {
          const v = views.get(id);
          const gone = !v || missing.has(id);
          const name = v?.name ?? 'this card';
          return (
            <div className="gedit-unit" data-card={id} key={`${id}-${i}`}>
              <div className={`lobbyguide-unit${gone ? ' missing' : ''}`} role={gone ? 'img' : undefined} aria-label={gone ? (v ? `${v.name}: missing or removed` : 'Missing or removed card') : undefined}>
                {v ? <div className="lobbyguide-unitscale"><Card card={v} forceCompact suppressPop /></div> : <div className="lobbyguide-blank" />}
                {gone && <span className="lobbyguide-missing" aria-hidden="true">Missing or removed</span>}
              </div>
              <div className="gedit-unitbtns">
                <button type="button" className="gedit-mini gedit-earlier" disabled={i === 0} aria-label={`Move ${name} earlier`} onClick={() => onChange(moved(ids, i, i - 1))}><Icon name="chevron" /></button>
                <button type="button" className="gedit-mini gedit-remove" aria-label={`Remove ${name}`} onClick={() => onChange(ids.filter((_, j) => j !== i))}>x</button>
                <button type="button" className="gedit-mini gedit-later" disabled={i === ids.length - 1} aria-label={`Move ${name} later`} onClick={() => onChange(moved(ids, i, i + 1))}><Icon name="chevron" /></button>
              </div>
            </div>
          );
        })}
        <button type="button" className="gbtn gedit-add" disabled={ids.length >= max} aria-expanded={adding} onClick={onToggleAdd}>Add</button>
      </div>
      {adding && <GuideCardPicker setId={setId} label={`Add to ${label}`} exclude={ids} onPick={(id) => { onChange([...ids, id]); onToggleAdd(); }} />}
    </div>
  );
}

export const GuideEditor = memo(function GuideEditor({ initial, setId, tribes, run, userId, canBeOfficial, onClose }: {
  initial: EditorDraft;
  /** The set being edited in: its cards fill the picker, and the guide must be whole in it to save. */
  setId: SetId;
  /** That set's whole tribe roster. */
  tribes: readonly Tribe[];
  run: RunState | undefined;
  /** Whose device draft this is. */
  userId: string;
  /** A team member creating a NEW guide may make it a Team Ascent guide. */
  canBeOfficial: boolean;
  onClose: () => void;
}): JSX.Element {
  // `base` is what "unchanged" means. It only moves when the author loads someone else's newer version.
  const [base, setBase] = useState(initial);
  const [d, setD] = useState(initial);
  const [picker, setPicker] = useState<'icon' | 'core' | 'enablers' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<'discard' | 'delete' | 'conflict' | null>(null);
  const patch = (p: Partial<EditorDraft>): void => { setD((cur) => ({ ...cur, ...p })); setError(null); };
  const dirty = !sameDraft(d, base);
  const isNew = d.rowId === null;

  // Keys: see the header. The handler reads the latest state through a ref so it is installed once.
  const live = useRef({ picker, dirty, busy });
  live.current = { picker, dirty, busy };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Tab') { e.stopPropagation(); return; }
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      if (live.current.busy) return;
      if (live.current.picker) { setPicker(null); return; }
      if (live.current.dirty) setAsk('discard'); else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // The device draft: written shortly after a change, so a burst of typing is one write.
  useEffect(() => {
    if (!dirty) return;
    const t = window.setTimeout(() => saveLocalDraft(userId, d), 400);
    return () => window.clearTimeout(t);
  }, [d, dirty, userId]);

  // Derived from a deferred copy, so typing never waits on the name scan.
  const shown = useDeferredValue(d);
  const wire = useMemo(() => toWire(shown, setId), [shown, setId]);
  const preview = useMemo(() => previewOf(shown, wire.mentions, wire.aliases, setId), [shown, wire, setId]);
  const ids = useMemo(() => [...new Set([...d.core, ...d.enablers, ...wire.mentions])], [d.core, d.enablers, wire.mentions]);
  const { views, refs } = useGuideViews(ids, run);
  const missing = useMemo(() => new Set(missingIn(d, setId)), [d, setId]);
  const chips: Tribe[] = d.tribes.length ? [...d.tribes, ...d.pairsWith] : ['neutral'];
  const listed = useMemo(() => [...new Set([...d.core, ...d.enablers, ...wire.mentions])].filter((id) => views.has(id)), [d.core, d.enablers, wire.mentions, views]);

  const save = async (override?: EditorDraft): Promise<void> => {
    const cur = override ?? d;
    const problems = draftProblems(cur, setId);
    if (problems.length > 0) { setError(problems[0]!.message); sfx.tick(); return; }
    setBusy(true);
    setError(null);
    const res = await saveGuideRemote(toWire(cur, setId));
    setBusy(false);
    if (res.ok) {
      clearLocalDraft();
      const g = toGuide(res.value);
      if (g) guideSaved(g);
      sfx.pulse();
      onClose();
      return;
    }
    if (res.code === 'conflict') { setAsk('conflict'); return; }
    setError(guideErrorMessage(res.code, res.field));
  };

  /** The server's current version of the guide being edited, or null with the reason shown. */
  const theirs = async (): Promise<Guide | null> => {
    if (!d.rowId) return null;
    setBusy(true);
    const rec = await fetchGuideById(d.rowId);
    setBusy(false);
    const g = rec ? toGuide(rec) : null;
    if (!g) { setAsk(null); setError(guideErrorMessage(rec === null ? 'not_found' : 'offline')); }
    return g;
  };
  const loadTheirs = async (): Promise<void> => {
    const g = await theirs();
    if (!g) return;
    const fresh = draftFromGuide(g);
    setBase(fresh);
    setD(fresh);
    setAsk(null);
    clearLocalDraft();
  };
  const overwrite = async (): Promise<void> => {
    const g = await theirs();
    if (!g) return;
    const next = { ...d, revision: g.revision };
    setD(next);
    setAsk(null);
    await save(next);
  };
  const remove = async (): Promise<void> => {
    if (!d.rowId) return;
    setBusy(true);
    const res = await deleteGuideRemote(d.rowId);
    setBusy(false);
    if (!res.ok) { setAsk(null); setError(guideErrorMessage(res.code, res.field)); return; }
    clearLocalDraft();
    guideDeleted(d.rowId);
    sfx.tick();
    onClose();
  };
  const discard = (): void => { clearLocalDraft(); sfx.tick(); onClose(); };
  const cancel = (): void => { if (dirty) setAsk('discard'); else onClose(); };

  const toggleTribe = (t: Tribe): void => {
    if (d.tribes.includes(t)) patch({ tribes: d.tribes.filter((x) => x !== t) });
    else if (d.tribes.length < GUIDE_LIMITS.tribes) patch({ tribes: [...d.tribes, t], pairsWith: d.pairsWith.filter((x) => x !== t) });
  };

  return (
    <article className="bookguide gedit" style={guideAccent(chips)} aria-label={isNew ? 'New guide' : `Editing ${base.title}`}>
      <header className="bookguide-head gedit-head">
        <button type="button" className="gedit-icon" aria-label="Change the art icon" aria-expanded={picker === 'icon'} onClick={() => setPicker(picker === 'icon' ? null : 'icon')}>
          <GuideEmblem guide={preview} chips={chips} />
          <span className="gedit-iconhint" aria-hidden="true">Change</span>
        </button>
        <div className="bookguide-headtext gedit-headtext">
          <label className="gedit-field">
            <span className="gedit-label">Title <Count value={d.title} max={GUIDE_LIMITS.title} /></span>
            <input className="gedit-input gedit-title" value={d.title} placeholder="Name the build" onChange={(e) => patch({ title: e.target.value })} />
          </label>
          <label className="gedit-field">
            <span className="gedit-label">Tagline <Count value={d.tagline} max={GUIDE_LIMITS.tagline} /></span>
            <input className="gedit-input gedit-tagline" value={d.tagline} placeholder="One line on how it wins" onChange={(e) => patch({ tagline: e.target.value })} />
          </label>
          {isNew && canBeOfficial && (
            <div className="gedit-who" role="group" aria-label="Who this guide is by">
              <button type="button" className={`book-runetribe${d.official ? ' on' : ''}`} style={{ '--c': 'var(--ui-title)' } as CSSProperties} aria-pressed={d.official} onClick={() => patch({ official: true })}>Team Ascent guide</button>
              <button type="button" className={`book-runetribe${d.official ? '' : ' on'}`} style={{ '--c': 'var(--ui-title)' } as CSSProperties} aria-pressed={!d.official} onClick={() => patch({ official: false })}>My own guide</button>
            </div>
          )}
          {d.official
            ? <div className="gedit-by">by {TEAM_BYLINE}</div>
            : (
              <label className="gedit-field gedit-field-inline">
                <span className="gedit-label">by <Count value={d.byline} max={GUIDE_LIMITS.byline} /></span>
                <input className="gedit-input gedit-byline" value={d.byline} placeholder="Your name" onChange={(e) => patch({ byline: e.target.value })} />
              </label>
            )}
        </div>
      </header>
      {picker === 'icon' && (
        <div className="gedit-iconpick">
          <GuideCardPicker setId={setId} label="Pick the art icon" onPick={(id) => { patch({ iconCard: id }); setPicker(null); }} />
        </div>
      )}
      <div className="bookguide-body gedit-bodywrap">
        <div className="gedit-tribes" role="group" aria-label="Tribes this guide is for. None means Neutral.">
          <span className="gedit-label">Tribes</span>
          {tribes.map((t) => (
            <button type="button" key={t} className={`book-runetribe${d.tribes.includes(t) ? ' on' : ''}`} style={{ '--c': tribeInk(t) } as CSSProperties}
              aria-pressed={d.tribes.includes(t)} onClick={() => toggleTribe(t)}>{TRIBE_NAME[t] ?? t}</button>
          ))}
          <label className="gedit-field gedit-field-inline">
            <span className="gedit-label">Pairs with</span>
            <select className="gedit-input gedit-pairs" value={d.pairsWith[0] ?? ''} onChange={(e) => patch({ pairsWith: e.target.value ? [e.target.value as Tribe] : [] })}>
              <option value="">None</option>
              {tribes.filter((t) => !d.tribes.includes(t)).map((t) => <option key={t} value={t}>{TRIBE_NAME[t] ?? t}</option>)}
            </select>
          </label>
        </div>
        <label className="gedit-field">
          <span className="gedit-label">Write-up <Count value={d.body} max={GUIDE_LIMITS.body} /></span>
          <textarea className="gedit-input gedit-body" rows={6} value={d.body} placeholder="How the build works, what to look for, when to commit. Card names light up for readers." onChange={(e) => patch({ body: e.target.value })} />
        </label>
        {d.body.trim() !== '' && (
          <div className="gedit-preview">
            <span className="gedit-label">Preview</span>
            <GuideText guide={preview} ids={ids} views={views} refs={refs} missing={missing} />
          </div>
        )}
        <EditRow row="core" label="Core" ids={d.core} max={GUIDE_LIMITS.core} views={views} missing={missing} adding={picker === 'core'} setId={setId}
          onChange={(core) => patch({ core })} onToggleAdd={() => setPicker(picker === 'core' ? null : 'core')} />
        <EditRow row="enablers" label="Enablers" ids={d.enablers} max={GUIDE_LIMITS.enablers} views={views} missing={missing} adding={picker === 'enablers'} setId={setId}
          onChange={(enablers) => patch({ enablers })} onToggleAdd={() => setPicker(picker === 'enablers' ? null : 'enablers')} />
        <div className="gedit-aliases">
          <span className="gedit-label">Nicknames <span className="gedit-hint">A short word in your write-up that means one of the guide's cards.</span></span>
          {d.aliases.map((a, i) => (
            <div className="gedit-alias" key={i}>
              <input className="gedit-input gedit-alias-word" value={a.word} placeholder="Word" aria-label={`Nickname ${i + 1}: the word`}
                onChange={(e) => patch({ aliases: d.aliases.map((x, j) => (j === i ? { ...x, word: e.target.value } : x)) })} />
              <select className="gedit-input gedit-alias-card" value={a.card} aria-label={`Nickname ${i + 1}: the card it means`}
                onChange={(e) => patch({ aliases: d.aliases.map((x, j) => (j === i ? { ...x, card: e.target.value } : x)) })}>
                <option value="">Pick a card</option>
                {[...new Set([...listed, ...(a.card ? [a.card] : [])])].map((id) => <option key={id} value={id}>{views.get(id)?.name ?? id}</option>)}
              </select>
              <button type="button" className="gedit-mini gedit-remove" aria-label={`Remove nickname ${i + 1}`} onClick={() => patch({ aliases: d.aliases.filter((_, j) => j !== i) })}>x</button>
            </div>
          ))}
          <button type="button" className="gbtn" disabled={d.aliases.length >= GUIDE_LIMITS.aliases} onClick={() => patch({ aliases: [...d.aliases, { word: '', card: '' }] })}>Add nickname</button>
        </div>
      </div>
      <footer className="gedit-foot">
        {error && <p className="gedit-error" role="alert">{error}</p>}
        {ask === 'discard' && (
          <div className="gedit-ask" role="alertdialog" aria-label="Discard your changes?">
            <span>Discard your changes?</span>
            <button type="button" className="gbtn gbtn-danger" onClick={discard}>Discard</button>
            <button type="button" className="gbtn" onClick={() => setAsk(null)}>Keep editing</button>
          </div>
        )}
        {ask === 'delete' && (
          <div className="gedit-ask" role="alertdialog" aria-label="Delete this guide?">
            <span>Delete this guide? It cannot be brought back.</span>
            <button type="button" className="gbtn gbtn-danger" disabled={busy} onClick={() => void remove()}>Delete for good</button>
            <button type="button" className="gbtn" onClick={() => setAsk(null)}>Keep it</button>
          </div>
        )}
        {ask === 'conflict' && (
          <div className="gedit-ask" role="alertdialog" aria-label="Someone else saved this guide">
            <span>{guideErrorMessage('conflict')}</span>
            <button type="button" className="gbtn" disabled={busy} onClick={() => void loadTheirs()}>Load their version</button>
            <button type="button" className="gbtn gbtn-danger" disabled={busy} onClick={() => void overwrite()}>Overwrite with mine</button>
          </div>
        )}
        <div className="gedit-actions">
          {missing.size > 0 && (
            <button type="button" className="gbtn" onClick={() => patch({ core: d.core.filter((id) => !missing.has(id)), enablers: d.enablers.filter((id) => !missing.has(id)) })}>Remove missing cards</button>
          )}
          {!isNew && <button type="button" className="gbtn gbtn-danger" disabled={busy} onClick={() => setAsk('delete')}>Delete</button>}
          <span className="gedit-spacer" />
          <button type="button" className="gbtn" disabled={busy} onClick={cancel}>Cancel</button>
          <button type="button" className="gbtn gbtn-primary" disabled={busy || (!isNew && !dirty)} onClick={() => void save()}>{busy ? 'Saving' : 'Save'}</button>
        </div>
      </footer>
    </article>
  );
});
```

Notes for the implementer, each of which a test pins, so check the test when in doubt:
- The Save button on a NEW guide is enabled even when nothing was typed (so the author gets the "add a Core card" sentence instead of a dead button); on an existing guide it needs a change.
- `useDeferredValue` means the preview and the mention list can lag one render behind the text box. `save()` therefore computes from the CURRENT draft (`toWire(cur, setId)`), never from the deferred `wire`.
- The "Remove missing cards" button must be findable by its exact text, and "Delete" must be distinct from "Delete for good".
- If the test's `press` helper cannot find a button because its text has an extra node (the icon buttons), that is expected: those are found by class in the tests.

- [ ] **Step 4: Implement the styles**

`packages/ui/src/guides/guideEditor.css`:
```css
/* -- THE GUIDE EDITOR (2026-10-12) ---------------------------------------------------------------------------------
   The Compendium's guide card (compendiumGuides.css `.bookguide`) with its parts made editable. Buttons and inputs are
   built from the Compendium's own theme tokens (compendium.css's grammar) so the editor reads as part of the book.
   A FIRST CUT: nobody has judged this rendered yet. Implemented as written; the owner tunes it.

   PERFORMANCE. Nothing animates. No looping effect, no blurred shadow on a large surface.
   CURSOR. No `cursor` anywhere here: the game's global rule paints the gauntlet on every button. */

/* The editor takes the whole grid row (the list is hidden while it is open). */
.gedit { grid-column: 1 / -1; content-visibility: visible; }

/* A plain game button in the Compendium's plate. */
.gbtn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 34px; padding: 0 14px;
  border: 2px solid transparent; border-radius: 7px;
  background: var(--ui-sheen) padding-box, var(--ui-plate) padding-box, var(--ui-edge) border-box;
  box-shadow: var(--ui-bevel), inset 0 0 0 1px rgba(0, 0, 0, 0.55), inset 0 0 0 2px var(--ui-ring);
  color: var(--ui-text); text-shadow: 0 1px 0 rgba(0, 0, 0, 0.7);
  font-family: var(--font-ui); font-weight: 800; font-size: 13.5px; letter-spacing: 0.01em;
}
.gbtn:hover:not(:disabled) { color: #fff; background: var(--ui-sheen) padding-box, var(--ui-hover-plate) padding-box, var(--ui-hover-edge) border-box; }
.gbtn:active:not(:disabled) { transform: translateY(1px); }
.gbtn:disabled { opacity: 0.4; }
.gbtn:focus-visible { outline: 2px solid var(--ui-edge-hi); outline-offset: 2px; }
.gbtn-primary { color: var(--ui-title); }
.gbtn-danger { color: #ff9a8a; }

/* A text box, select or text area. */
.gedit-input {
  width: 100%; min-width: 0; box-sizing: border-box; height: 36px; padding: 0 12px;
  border: 1px solid var(--ui-chip-edge); border-radius: 7px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--ui-chip-bg) 92%, #000), var(--ui-chip-bg));
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.55), 0 1px 0 rgba(255, 255, 255, 0.05);
  color: var(--ui-text); font-family: var(--font-body), sans-serif; font-weight: 600; font-size: 15px;
}
.gedit-input:focus { outline: none; border-color: var(--ui-edge-main); box-shadow: inset 0 2px 5px rgba(0, 0, 0, 0.55), 0 0 0 2px var(--ui-ring); }
.gedit-input::placeholder { color: color-mix(in srgb, var(--ui-muted) 70%, transparent); }
textarea.gedit-input { height: auto; min-height: 132px; padding: 10px 12px; line-height: 1.55; resize: vertical; }
.gedit-title { height: 44px; font-family: var(--font-ui); font-weight: 800; font-size: 24px; color: var(--ui-title); }

.gedit-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.gedit-field-inline { flex-direction: row; align-items: center; gap: 10px; }
.gedit-field-inline .gedit-input { width: auto; flex: 0 1 240px; }
.gedit-label { display: flex; align-items: baseline; gap: 10px; font-family: var(--font-ui); font-size: 12.5px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ui-muted); }
.gedit-hint { font-size: 12.5px; font-weight: 600; letter-spacing: 0; text-transform: none; }
.gedit-count { margin-left: auto; font-size: 12px; letter-spacing: 0.04em; }
.gedit-count.over { color: #ff9a8a; }
.gedit-by { font-size: 14px; font-weight: 700; color: var(--ui-muted); }

/* The header: the art icon is a button; the fields sit where the title and tagline read. */
.gedit-head { align-items: flex-start; }
.gedit-headtext { flex: 1; gap: 12px; }
.gedit-icon { position: relative; flex: none; padding: 0; border: 0; background: none; border-radius: 12px; }
.gedit-icon:focus-visible { outline: 2px solid var(--ui-edge-hi); outline-offset: 3px; }
.gedit-iconhint {
  position: absolute; left: 0; right: 0; bottom: 0; padding: 3px 0; border-radius: 0 0 12px 12px; text-align: center;
  background: rgba(0, 0, 0, 0.72); color: var(--ui-title);
  font-family: var(--font-ui); font-size: 11px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
}
.gedit-iconpick { padding: 0 26px 4px; }
.gedit-who, .gedit-tribes { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
.gedit-tribes .gedit-field-inline { margin-left: 12px; }

.gedit-preview { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border-radius: 8px; border: 1px dashed var(--ui-divider); }

/* An editable portrait: the card, with three small buttons under it. */
.gedit-unit { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.gedit-unitbtns { display: flex; gap: 4px; }
.gedit-mini {
  width: 26px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--ui-chip-edge); border-radius: 6px; background: var(--ui-chip-bg); color: var(--ui-text);
  font-family: var(--font-ui); font-weight: 800; font-size: 13px; line-height: 1;
}
.gedit-mini:hover:not(:disabled) { color: #fff; border-color: var(--ui-edge-main); }
.gedit-mini:disabled { opacity: 0.3; }
.gedit-mini:focus-visible { outline: 2px solid var(--ui-edge-hi); outline-offset: 1px; }
.gedit-mini svg { width: 12px; height: 12px; }
/* The one chevron icon points down; turn it to point at the neighbour the card moves toward. */
.gedit-earlier svg { transform: rotate(90deg); }
.gedit-later svg { transform: rotate(-90deg); }
.gedit-remove { color: #ff9a8a; }
.gedit-rowcount { margin-left: 8px; font-weight: 700; letter-spacing: 0.04em; }
.gedit-row .lobbyguide-unitrow { align-items: flex-end; }
.gedit-add { align-self: center; }

.gedit-aliases { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.gedit-alias { display: flex; align-items: center; gap: 8px; width: min(100%, 520px); }
.gedit-alias-word { flex: 0 1 160px; }
.gedit-alias-card { flex: 1 1 auto; }

/* The picker: a search box over a short list of names. */
.gpick { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding: 12px; border-radius: 8px; border: 1px solid var(--ui-chip-edge); background: rgba(0, 0, 0, 0.28); }
.gpick-find { max-width: 320px; }
.gpick-list { display: flex; flex-wrap: wrap; gap: 6px; }
.gpick-row {
  display: inline-flex; align-items: baseline; gap: 8px; height: 30px; padding: 0 10px;
  border: 1px solid var(--ui-chip-edge); border-radius: 6px; background: var(--ui-chip-bg); color: var(--ui-text);
  font-family: var(--font-ui); font-weight: 700; font-size: 13.5px;
}
.gpick-row:hover { color: #fff; border-color: var(--ui-edge-main); }
.gpick-row:focus-visible { outline: 2px solid var(--ui-edge-hi); outline-offset: 1px; }
.gpick-kind { font-size: 11.5px; font-weight: 700; color: var(--ui-muted); }
.gpick-none { font-size: 14px; font-weight: 600; color: var(--ui-muted); }

/* The foot: what went wrong, a question when one is being asked, then the buttons. */
.gedit-foot { display: flex; flex-direction: column; gap: 12px; padding: 16px 26px 22px; border-top: 1px solid var(--ui-divider); }
.gedit-error { margin: 0; font-size: 15px; font-weight: 700; color: #ffb3a6; }
.gedit-ask { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 8px; border: 1px solid var(--ui-chip-edge); background: rgba(0, 0, 0, 0.28); font-size: 15px; font-weight: 700; }
.gedit-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.gedit-spacer { flex: 1; }
```

Check the token names against `packages/ui/src/uiTheme.css` before relying on them: `--ui-sheen`, `--ui-plate`, `--ui-edge`, `--ui-bevel`, `--ui-ring`, `--ui-hover-plate`, `--ui-hover-edge`, `--ui-edge-hi`, `--ui-edge-main`, `--ui-chip-bg`, `--ui-chip-edge`, `--ui-divider`, `--ui-text`, `--ui-title`, `--ui-muted`, and `--font-ui` / `--font-body` in `styles.css`. Every one is used by `compendium.css` today. If one does not exist, report it; do not invent a value.

- [ ] **Step 5: Run the tests, the typecheck and the tripwires**

Run: `npx vitest run packages/ui/src/guides && npm run typecheck:web && npx vitest run packages/ui/src/stageTripwire.test.ts && npx eslint packages/ui/src/guides`
Expected: PASS, no type errors, no lint errors. Then `grep -nP '[^\x00-\x7F]' packages/ui/src/guides/GuideEditor.tsx packages/ui/src/guides/guideEditor.css packages/ui/src/guides/guideEditor.test.tsx` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/guides/GuideEditor.tsx packages/ui/src/guides/guideEditor.css packages/ui/src/guides/guideEditor.test.tsx
git commit -m "feat(guides): the guide editor"
```

---

### Task 8: The Guides tab: pills, New guide, per-guide actions, and the editor's host

**Files:**
- Modify: `packages/ui/src/guides/guides.ts` (one helper), `packages/ui/src/guides/CompendiumGuides.tsx` (rewritten), `packages/ui/src/guides/compendiumGuides.css` (append), `packages/ui/src/MinionBook.tsx` (four edits)
- Modify: `packages/ui/src/guides/guideMissing.test.tsx` (one prop added to its mount)
- Test: `packages/ui/src/guides/guidesTab.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 to 7; `useGame` (`account.userId`, `account.anonymous`, `playerName`, `closeBook`, `openAccountPanel`); `accountsAvailable` from `../GuestSignIn`.
- Produces: `canEditGuide(g: Guide, userId: string | null, team: boolean): boolean` exported from `guides.ts`; `CompendiumGuides` gains a required prop `setTribes: readonly Tribe[]` (the shown set's whole roster).

- [ ] **Step 1: Write the failing test**

`packages/ui/src/guides/guidesTab.test.tsx`:
```tsx
// @vitest-environment jsdom
/**
 * THE COMPENDIUM GUIDES TAB WITH WRITING. Pins who sees which button (a guest, a player, a team member; a built-in
 * copy with no server row; an offline game), that New guide / Duplicate / Edit open the editor and hide the list,
 * the Team Ascent / My guides pills, the kept-draft Resume bar, the team-only import, and the rail's edit request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { SETS } from '@game/content';
import { mount, type Mounted } from '../renderedText.mount';
import { useGame } from '../store';
import type { GuideDraftInput } from './guidesRemote';

const imports: GuideDraftInput[][] = [];
let officialCalls = 0;
vi.mock('./guidesRemote', () => ({
  GUIDE_COLUMNS: '',
  fetchOfficialGuides: async () => { officialCalls++; return { state: 'offline' }; },
  fetchTeamFlag: async () => undefined,
  fetchMyGuides: async () => undefined,
  fetchGuideById: async () => undefined,
  saveGuideRemote: async () => ({ ok: false, code: 'offline' }),
  deleteGuideRemote: async () => ({ ok: false, code: 'offline' }),
  importBuiltInsRemote: async (g: GuideDraftInput[]) => { imports.push(g); return { ok: true, value: { inserted: g.length, skipped: 0 } }; },
}));
vi.mock('../GuestSignIn', () => ({ accountsAvailable: () => true }));

const { CompendiumGuides } = await import('./CompendiumGuides');
const { GUIDES, canEditGuide, guidesFor } = await import('./guides');
const { emptyDraft } = await import('./guideDrafts');
const { saveLocalDraft } = await import('./guideDraftStore');
const { requestGuideEdit, resetGuidesForTests, useGuides } = await import('./guidesStore');

const ROW = '11111111-1111-4111-8111-111111111111';
const serverList = GUIDES.map((g, i) => ({ ...g, rowId: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, revision: 1 }));
const mineGuide = { ...GUIDES[0]!, id: ROW, rowId: ROW, official: false, published: false, authorId: 'u-1', byline: 'Mike', title: 'My Sunmane', revision: 1 };

let ui: Mounted | null = null;
const prev = useGame.getState();
const as = (who: 'guest' | 'player' | 'team', patch: Partial<ReturnType<typeof useGuides.getState>> = {}): HTMLElement => {
  act(() => {
    useGame.setState({ account: { userId: who === 'guest' ? 'g-1' : 'u-1', email: who === 'guest' ? null : 'm@example.test', anonymous: who === 'guest', discriminator: null }, playerName: 'Mike' });
    useGuides.setState({ capability: 'on', source: 'server', list: serverList, team: who === 'team', mine: who === 'guest' ? [] : [mineGuide], ...patch });
  });
  const s = useGuides.getState();
  const shown = s.tab === 'mine' ? s.mine : guidesFor('set2', SETS.set2.tribes, s.list);
  ui = mount(<CompendiumGuides guides={shown} tribes={SETS.set2.tribes} setTribes={SETS.set2.tribes} run={undefined} setId="set2" />);
  return ui.container;
};
const button = (c: Element, text: string): HTMLButtonElement | undefined => [...c.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const press = async (c: Element, text: string): Promise<void> => {
  const b = button(c, text);
  if (!b) throw new Error(`no button "${text}"`);
  await act(async () => { b.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
};
const card = (c: HTMLElement, id: string): HTMLElement => c.querySelector<HTMLElement>(`.bookguide[data-guide="${id}"]`)!;

beforeEach(() => { localStorage.clear(); resetGuidesForTests(); imports.length = 0; officialCalls = 0; });
afterEach(() => { ui?.unmount(); ui = null; act(() => { useGame.setState({ account: prev.account, playerName: prev.playerName, showBook: prev.showBook, accountPanelOpen: prev.accountPanelOpen }); }); });

describe('canEditGuide', () => {
  it('a Team Ascent guide: the team only, and only once it has a server row', () => {
    expect(canEditGuide(serverList[0]!, 'u-1', true)).toBe(true);
    expect(canEditGuide(serverList[0]!, 'u-1', false)).toBe(false);
    expect(canEditGuide(GUIDES[0]!, 'u-1', true)).toBe(false);
  });
  it('a player guide: its author only, never the team, never a guest', () => {
    expect(canEditGuide(mineGuide, 'u-1', false)).toBe(true);
    expect(canEditGuide(mineGuide, 'u-2', false)).toBe(false);
    expect(canEditGuide(mineGuide, 'u-2', true)).toBe(false);
    expect(canEditGuide(mineGuide, null, false)).toBe(false);
  });
});

describe('who sees which button', () => {
  it('every guide shows who it is by, and offers Duplicate', () => {
    const c = as('player');
    const first = card(c, serverList[0]!.id);
    expect(first.textContent).toContain('by Team Ascent');
    expect(button(first, 'Duplicate')).toBeDefined();
  });
  it('a player sees no Edit on a Team Ascent guide; a team member does', () => {
    expect(button(card(as('player'), serverList[0]!.id), 'Edit')).toBeUndefined();
    ui!.unmount();
    expect(button(card(as('team'), serverList[0]!.id), 'Edit')).toBeDefined();
  });
  it('a built-in copy with no server row has no Edit, even for the team', () => {
    const c = as('team', { source: 'bundled', list: GUIDES });
    expect(button(card(c, GUIDES[0]!.id), 'Edit')).toBeUndefined();
  });
  it('a player sees Edit on their own guide under My guides, with its Private badge', () => {
    const c = as('player', { tab: 'mine' });
    const own = card(c, ROW);
    expect(button(own, 'Edit')).toBeDefined();
    expect(own.textContent).toContain('Private');
    expect(own.textContent).toContain('by Mike');
  });
  it('a guide of mine that is not in the shown set says so', () => {
    const c = as('player', { tab: 'mine', mine: [{ ...mineGuide, sets: ['set3'] }] });
    expect(card(c, ROW).textContent).toContain('Not in this set');
  });
  it('My guides with nothing in it explains how to start, and still shows the toolbar', () => {
    const c = as('player', { tab: 'mine', mine: [] });
    expect(c.textContent).toContain('You have not written a guide yet.');
    expect(button(c, 'New guide')).toBeDefined();
  });
});

describe('starting to write', () => {
  it('New guide opens the editor and hides the list; closing the editor brings the list back', async () => {
    const c = as('player');
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).not.toBeNull();
    expect(c.querySelector('.bookguide:not(.gedit)')).toBeNull();
    expect(c.querySelector<HTMLInputElement>('.gedit-byline')!.value).toBe('Mike');
    await press(c, 'Cancel');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(c.querySelectorAll('.bookguide').length).toBeGreaterThan(0);
  });
  it('Duplicate opens the editor on a private copy named after the source', async () => {
    const c = as('player');
    await press(card(c, serverList[0]!.id), 'Duplicate');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe(`${serverList[0]!.title} (copy)`);
    expect(c.querySelector('.gedit-byline')).not.toBeNull();
  });
  it('Edit opens the editor on that guide', async () => {
    const c = as('team');
    await press(card(c, serverList[1]!.id), 'Edit');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe(serverList[1]!.title);
  });
  it('a guest who presses New guide or Duplicate is asked to sign in; no editor opens', async () => {
    const c = as('guest');
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).toBeNull();
    expect(c.textContent).toContain('Sign in to write your own guides.');
    await press(c, 'Create account');
    expect(useGame.getState().accountPanelOpen).toBe(true);
    expect(useGame.getState().showBook).toBe(false);
  });
  it('when guides are not available, New guide and Duplicate are disabled and the tab says why', () => {
    for (const capability of ['unknown', 'off', 'offline', 'no-backend'] as const) {
      ui?.unmount();
      const c = as('player', { capability });
      expect(button(c, 'New guide')!.disabled, capability).toBe(true);
      expect(button(card(c, serverList[0]!.id), 'Duplicate')!.disabled, capability).toBe(true);
      expect(c.textContent, capability).toContain('Guides are offline.');
    }
  });
});

describe('the pills', () => {
  it('Team Ascent and My guides switch the store\'s pill; My guides shows how many', async () => {
    const c = as('player');
    expect(button(c, 'Team Ascent')!.getAttribute('aria-pressed')).toBe('true');
    expect(button(c, 'My guides (1)')).toBeDefined();
    await press(c, 'My guides (1)');
    expect(useGuides.getState().tab).toBe('mine');
  });
});

describe('the kept draft', () => {
  it('a draft left on this device is offered back; Resume opens it, Discard forgets it', async () => {
    saveLocalDraft('u-1', { ...emptyDraft('Mike'), title: 'Left behind', body: 'half', core: ['grim'] });
    const c = as('player');
    expect(c.textContent).toContain('You have an unsaved guide: Left behind');
    await press(c, 'Resume');
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('Left behind');
    await press(c, 'Cancel');
    await press(c, 'Discard');
    expect(c.textContent).not.toContain('You have an unsaved guide');
  });
  it('another account\'s draft is not offered', () => {
    saveLocalDraft('someone-else', { ...emptyDraft('X'), title: 'Not yours' });
    expect(as('player').textContent).not.toContain('You have an unsaved guide');
  });
});

describe('the team-only import', () => {
  it('is offered only to the team, only while the built-in copies are showing, and sends the eleven guides', async () => {
    expect(button(as('player', { source: 'bundled', list: GUIDES }), 'Import built-in guides')).toBeUndefined();
    ui!.unmount();
    expect(button(as('team'), 'Import built-in guides')).toBeUndefined(); // the server already has guides
    ui!.unmount();
    const c = as('team', { source: 'bundled', list: GUIDES });
    await press(c, 'Import built-in guides');
    expect(imports).toHaveLength(1);
    expect(imports[0]!.map((g) => g.slug)).toEqual(GUIDES.map((g) => g.id));
    expect(officialCalls).toBeGreaterThan(0); // it re-reads afterwards
    expect(c.textContent).toContain('Imported 11 guides.');
  });
  it('a team member cannot start a Team Ascent guide before the import', async () => {
    const c = as('team', { source: 'bundled', list: GUIDES });
    await press(c, 'New guide');
    expect(c.querySelector('.gedit')).not.toBeNull();
    expect(c.textContent).not.toContain('Team Ascent guide');
  });
});

describe('the rail\'s edit request', () => {
  it('opens the editor on that guide and is used up', () => {
    act(() => { requestGuideEdit(ROW); });
    const c = as('player', { pendingEdit: ROW });
    expect(c.querySelector<HTMLInputElement>('.gedit-title')!.value).toBe('My Sunmane');
    expect(useGuides.getState().pendingEdit).toBeNull();
  });
  it('a request for a guide this account may not edit is dropped', () => {
    const c = as('player', { pendingEdit: serverList[0]!.rowId });
    expect(c.querySelector('.gedit')).toBeNull();
    expect(useGuides.getState().pendingEdit).toBeNull();
  });
});

it('the tab carries no native tooltip', () => {
  expect(as('team').querySelector('[title]')).toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/guides/guidesTab.test.tsx`
Expected: FAIL (`canEditGuide` is not exported; `setTribes` is not a prop).

- [ ] **Step 3: Add the permission helper**

Append to `packages/ui/src/guides/guides.ts`:
```ts
/**
 * May this account EDIT (and delete) this guide? Only decides which buttons are drawn: the server is what refuses a
 * write. A Team Ascent guide: the team, once it has a server row (a built-in copy cannot be edited until the import
 * has run). A player guide: its author, and nobody else (the team hides or deletes; it does not rewrite).
 */
export function canEditGuide(g: Guide, userId: string | null, team: boolean): boolean {
  if (g.rowId === null) return false;
  return g.official ? team : userId !== null && g.authorId === userId;
}
```

- [ ] **Step 4: Rewrite the tab**

Replace the whole of `packages/ui/src/guides/CompendiumGuides.tsx` with:
```tsx
import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Tribe } from '@game/core';
import type { SetId } from '@game/content';
import type { RunState } from '@game/sim';
import { accountsAvailable } from '../GuestSignIn';
import { LazyCell, LazyRootProvider } from '../bookLazy';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { canEditGuide, guideMissingIds, type Guide } from './guides';
import { GuideEditor } from './GuideEditor';
import { GuideEmblem, GuideText, GuideTribes, GuideUnits, guideAccent, guideCardIds, guideChips, useGuideViews } from './GuideParts';
import { builtInImportPayload, draftFromGuide, duplicateDraft, emptyDraft, type EditorDraft } from './guideDrafts';
import { clearLocalDraft, loadLocalDraft } from './guideDraftStore';
import { guideErrorMessage } from './guideMessages';
import { importBuiltInsRemote } from './guidesRemote';
import { loadGuides, setGuidesTab, takePendingEdit, useGuides } from './guidesStore';
import './lobbyGuides.css';
import './compendiumGuides.css';

/**
 * THE COMPENDIUM'S GUIDES TAB (owner asks 2026-10-09 and 2026-10-11). The SAME guide pieces as the lobby rail
 * (`GuideParts`), laid out for a big screen: every guide open, two cards across on a wide window. Since 2026-10-12
 * it is also where guides are WRITTEN: a toolbar (the Team Ascent / My guides pills, New guide), Duplicate on every
 * guide, Edit on the ones this account may change, and the editor, which takes over the tab while it is open.
 *
 * Which guides show (pill, set, tribe pills, search) is decided by the caller (MinionBook). Who may do what is
 * decided by the server; this only draws the buttons (`canEditGuide`). Writing needs the guides capability to be
 * `on` and a signed-in account: a guest is asked to sign in, an offline game says so.
 *
 * PERFORMANCE. Guides mount lazily (all but the first two wait until near the viewport). Each guide card is memoized
 * and takes stable callbacks; its portraits are the memoized `Card` fed stabilized views. Off-screen cards skip
 * layout + paint (`content-visibility: auto`, compendiumGuides.css). Nothing animates.
 */
export const CompendiumGuides = memo(function CompendiumGuides({ guides, tribes, setTribes, run, setId }: {
  guides: readonly Guide[];
  /** The tribes the shown set (or run) has: a crossover chip shows only when its tribe is among them. */
  tribes: readonly Tribe[];
  /** The shown set's WHOLE roster: what the editor's tribe pills offer. */
  setTribes: readonly Tribe[];
  /** The run to print live values from, only while the Compendium shows that run's own set. */
  run: RunState | undefined;
  /** The set being shown: a guide's card that is not in it greys out. */
  setId: SetId;
}): JSX.Element {
  const capability = useGuides((s) => s.capability);
  const source = useGuides((s) => s.source);
  const team = useGuides((s) => s.team);
  const tab = useGuides((s) => s.tab);
  const mineCount = useGuides((s) => s.mine.length);
  const pending = useGuides((s) => s.pendingEdit);
  const userId = useGame((s) => s.account.userId);
  const anonymous = useGame((s) => s.account.anonymous);
  const playerName = useGame((s) => s.playerName);

  const online = capability === 'on';
  const signedIn = !anonymous && !!userId;
  const byline = playerName.trim() || 'Player';

  const [editing, setEditing] = useState<{ draft: EditorDraft; key: number } | null>(null);
  const [resume, setResume] = useState<EditorDraft | null>(() => (userId ? loadLocalDraft(userId) : null));
  const [signInAsked, setSignInAsked] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);

  const openEditor = useCallback((draft: EditorDraft): void => {
    setNote(null);
    setEditing((cur) => ({ draft, key: (cur?.key ?? 0) + 1 }));
  }, []);
  /** Writing needs a signed-in account: a guest is asked to sign in instead. */
  const begin = useCallback((make: () => EditorDraft): void => {
    if (!online) return;
    if (!signedIn) { sfx.tick(); setSignInAsked(true); return; }
    sfx.pulse();
    openEditor(make());
  }, [online, signedIn, openEditor]);
  const onEdit = useCallback((g: Guide): void => begin(() => draftFromGuide(g)), [begin]);
  const onDuplicate = useCallback((g: Guide): void => begin(() => duplicateDraft(g, byline)), [begin, byline]);

  // The rail asked for a guide to be edited: take the request once, and open it only if this account may edit it.
  useEffect(() => {
    if (!pending) return;
    const rowId = takePendingEdit();
    const s = useGuides.getState();
    const g = [...s.mine, ...s.list].find((x) => x.rowId === rowId);
    if (g && online && canEditGuide(g, userId, s.team)) openEditor(draftFromGuide(g));
  }, [pending, online, userId, openEditor]);

  const closeEditor = useCallback((): void => {
    setEditing(null);
    setResume(userId ? loadLocalDraft(userId) : null);
  }, [userId]);

  const runImport = async (): Promise<void> => {
    setImporting(true);
    const res = await importBuiltInsRemote(builtInImportPayload());
    setImporting(false);
    if (!res.ok) { setNote(guideErrorMessage(res.code, res.field)); return; }
    setNote(`Imported ${res.value.inserted} guide${res.value.inserted === 1 ? '' : 's'}.`);
    void loadGuides();
  };
  const createAccount = (): void => {
    sfx.pulse();
    const st = useGame.getState();
    st.closeBook();
    st.openAccountPanel();
  };

  if (editing && userId) {
    return (
      <div className="bookguides" ref={setRoot}>
        <GuideEditor key={editing.key} initial={editing.draft} setId={setId} tribes={setTribes} run={run} userId={userId}
          canBeOfficial={team && source === 'server'} onClose={closeEditor} />
      </div>
    );
  }

  return (
    <div className="bookguides" ref={setRoot}>
      <div className="gtool" role="group" aria-label="Guides">
        <div className="gtool-pills" role="group" aria-label="Which guides to show">
          <button type="button" className={`book-runetribe${tab === 'team' ? ' on' : ''}`} style={{ '--c': 'var(--ui-title)' } as CSSProperties}
            aria-pressed={tab === 'team'} onClick={() => setGuidesTab('team')}>Team Ascent</button>
          <button type="button" className={`book-runetribe${tab === 'mine' ? ' on' : ''}`} style={{ '--c': 'var(--ui-title)' } as CSSProperties}
            aria-pressed={tab === 'mine'} onClick={() => setGuidesTab('mine')}>{mineCount > 0 ? `My guides (${mineCount})` : 'My guides'}</button>
        </div>
        <div className="gtool-actions">
          {team && online && source === 'bundled' && (
            <button type="button" className="gbtn" disabled={importing} aria-description="Team only. Adds the built-in guides to the server as Team Ascent guides so they can be edited. Safe to press twice."
              onClick={() => void runImport()}>Import built-in guides</button>
          )}
          <button type="button" className="gbtn gbtn-primary" disabled={!online} onClick={() => begin(() => emptyDraft(byline))}>New guide</button>
        </div>
        {!online && <p className="gtool-note" role="status">Guides are offline. You can read the built-in guides; writing your own needs a connection.</p>}
        {note && <p className="gtool-note" role="status">{note}</p>}
        {signInAsked && !signedIn && (
          <p className="gtool-note gtool-signin" role="status">
            <span>{accountsAvailable(userId) ? 'Sign in to write your own guides. It is free and takes a minute.' : 'Sign in to write your own guides. Accounts cannot be reached right now.'}</span>
            {accountsAvailable(userId) && <button type="button" className="gbtn gbtn-primary" onClick={createAccount}>Create account</button>}
          </p>
        )}
        {resume && signedIn && online && (
          <p className="gtool-note gtool-resume" role="status">
            <span>You have an unsaved guide: {resume.title.trim() || 'untitled'}</span>
            <button type="button" className="gbtn gbtn-primary" onClick={() => openEditor(resume)}>Resume</button>
            <button type="button" className="gbtn" onClick={() => { clearLocalDraft(); setResume(null); }}>Discard</button>
          </p>
        )}
      </div>
      {guides.length === 0 ? (
        <div className="book-empty gtool-empty">
          {tab === 'mine' ? 'You have not written a guide yet. Press New guide, or Duplicate on any guide to start from it.' : 'No guides match these filters.'}
        </div>
      ) : (
        <LazyRootProvider root={root}>
          {guides.map((g, i) => (
            <LazyCell key={g.id} eager={i < 2} className="bookguide-slot">
              {() => (
                <CompendiumGuide guide={g} tribes={tribes} run={run} setId={setId} mineTab={tab === 'mine'} writable={online}
                  editable={online && canEditGuide(g, userId, team)} onEdit={onEdit} onDuplicate={onDuplicate} />
              )}
            </LazyCell>
          ))}
        </LazyRootProvider>
      )}
    </div>
  );
});

const CompendiumGuide = memo(function CompendiumGuide({ guide, tribes, run, setId, mineTab, writable, editable, onEdit, onDuplicate }: {
  guide: Guide; tribes: readonly Tribe[]; run: RunState | undefined; setId: SetId;
  /** Under My guides, a guide wears its state (Private, Hidden, Not in this set). */
  mineTab: boolean;
  /** Guides can be written right now (the capability is on). */
  writable: boolean;
  /** This account may edit this guide. */
  editable: boolean;
  onEdit: (g: Guide) => void; onDuplicate: (g: Guide) => void;
}): JSX.Element {
  const chips = guideChips(guide, tribes);
  const ids = useMemo(() => guideCardIds(guide), [guide]);
  const { views, refs } = useGuideViews(ids, run);
  const missing = useMemo(() => guideMissingIds(guide, setId), [guide, setId]);
  const badges: string[] = [];
  if (mineTab) {
    if (guide.hidden) badges.push('Hidden by Team Ascent');
    else if (!guide.published) badges.push('Private');
    if (!guide.sets.includes(setId)) badges.push('Not in this set');
  }
  return (
    <article className="bookguide" data-guide={guide.id} style={guideAccent(chips)} aria-label={guide.title}>
      <header className="bookguide-head">
        <GuideEmblem guide={guide} chips={chips} />
        <div className="bookguide-headtext">
          <h3 className="bookguide-title">{guide.title}</h3>
          <div className="bookguide-tribes"><GuideTribes chips={chips} /></div>
          <div className="bookguide-tagline">{guide.tagline}</div>
          <div className="bookguide-by">
            <span>by {guide.byline}</span>
            {guide.forkedTitle && <span className="bookguide-fork">Based on {guide.forkedTitle}{guide.forkedByline ? ` by ${guide.forkedByline}` : ''}</span>}
            {badges.map((b) => <span className="bookguide-badge" key={b}>{b}</span>)}
          </div>
        </div>
        <div className="bookguide-actions">
          {editable && <button type="button" className="gbtn" onClick={() => onEdit(guide)}>Edit</button>}
          <button type="button" className="gbtn" disabled={!writable} onClick={() => onDuplicate(guide)}>Duplicate</button>
        </div>
      </header>
      <div className="bookguide-body">
        <GuideText guide={guide} ids={ids} views={views} refs={refs} missing={missing} />
        {/* Core, then Enablers on its own line below (owner 2026-10-09: "always have core + enablers on different
            lines"). */}
        <GuideUnits label="Core" ids={guide.core} views={views} refs={refs} missing={missing} />
        {guide.enablers.length > 0 && <GuideUnits label="Enablers" ids={guide.enablers} views={views} refs={refs} missing={missing} />}
      </div>
    </article>
  );
});
```

Check against the current file before replacing it: keep any import, prop or comment the current `CompendiumGuides.tsx` has that the code above does not account for (step 1's final fix wave changed parts of the guides folder), and say in your report what you kept.

- [ ] **Step 5: Style the toolbar and the new card parts**

Append to `packages/ui/src/guides/compendiumGuides.css`:
```css
/* -- WRITING GUIDES (2026-10-12): the toolbar over the list, and a guide card's by line and buttons -------------------
   Buttons are `.gbtn` (guideEditor.css). A FIRST CUT, owner-judged. Nothing animates; no `cursor` here. */
.gtool {
  grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px;
  padding: 0 2px 2px;
}
.gtool-pills, .gtool-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; }
.gtool-actions { margin-left: auto; }
.gtool-note {
  flex: 1 1 100%; margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
  padding: 10px 14px; border-radius: 8px; border: 1px solid var(--ui-chip-edge); background: rgba(0, 0, 0, 0.28);
  font-size: 15px; font-weight: 700; color: var(--ui-text);
}
.gtool-empty { grid-column: 1 / -1; }

.bookguide-by { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; margin-top: 2px; font-size: 13.5px; font-weight: 700; color: var(--ui-muted); }
.bookguide-badge {
  padding: 2px 8px; border-radius: 999px; border: 1px solid var(--ui-chip-edge); background: var(--ui-chip-bg);
  font-family: var(--font-ui); font-size: 11.5px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ui-title);
}
.bookguide-actions { margin-left: auto; align-self: flex-start; display: flex; gap: 7px; flex: none; }
```
The `.gbtn` rule lives in `guideEditor.css`, which `GuideEditor.tsx` imports; `CompendiumGuides.tsx` imports `GuideEditor`, so it is loaded whenever the tab is.

- [ ] **Step 6: The four MinionBook edits, and the one test mount**

In `packages/ui/src/MinionBook.tsx` (find each anchor by searching; change nothing else):

1. The Guides view's initial state opens on Guides when the rail asked for a guide to be edited. Change
```ts
  const [guidesOn, setGuidesOn] = useState(false);
```
to
```ts
  const [guidesOn, setGuidesOn] = useState(() => useGuides.getState().pendingEdit !== null);
```
2. Directly under the line `const guideList = useGuides((s) => s.list);` add:
```ts
  // The pill (Team Ascent / My guides) lives in the guides store, so this list and the tab's toolbar agree.
  const guideTab = useGuides((s) => s.tab);
  const guideMine = useGuides((s) => s.mine);
```
3. In the `guidesToShow` memo, change `return guidesFor(setId, tribes, guideList)` to
```ts
    // My guides lists every guide the player owns, whatever its set or tribe (a guide that did not carry over is
    // repaired from here); Team Ascent keeps the set + lobby-tribe rule.
    return (guideTab === 'mine' ? [...guideMine] : guidesFor(setId, tribes, guideList))
```
and add `guideTab, guideMine` to that memo's dependency list.
4. Change the render site
```tsx
            <CompendiumGuides guides={guidesToShow} tribes={tribes} run={liveRun} setId={setId} />
```
to
```tsx
            <CompendiumGuides guides={guidesToShow} tribes={tribes} setTribes={SETS[setId].tribes} run={liveRun} setId={setId} />
```

In `packages/ui/src/guides/guideMissing.test.tsx`, every `<CompendiumGuides ... />` mount gains `setTribes={SETS.set2.tribes}` (the prop is now required). Change nothing else there. If that file's tests need the guides store in a state where cards render (they render the list path), no further change is needed: the default store state shows the list.

- [ ] **Step 7: Run every guide test, the typecheck and the tripwires**

Run: `npx vitest run packages/ui/src/guides && npm run typecheck:web && npx vitest run packages/ui/src/stageTripwire.test.ts && npx eslint packages/ui/src/guides packages/ui/src/MinionBook.tsx`
Expected: PASS. `compendiumGuides.test.tsx` (which mounts the whole `MinionBook`) must pass untouched: the list still renders every guide `guidesFor` gives the active set. If one of its assertions fails because a guide card now also contains the words "Duplicate" or "by Team Ascent", read the assertion: if it compares exact text, adapt it only as far as the new by line and buttons require, and say so in your report.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/guides/guides.ts packages/ui/src/guides/CompendiumGuides.tsx packages/ui/src/guides/compendiumGuides.css packages/ui/src/guides/guidesTab.test.tsx packages/ui/src/guides/guideMissing.test.tsx packages/ui/src/MinionBook.tsx
git commit -m "feat(guides): write, duplicate and edit guides from the Compendium"
```

---

### Task 9: The rail: your guides, and Edit

**Files:**
- Modify: `packages/ui/src/LobbyPanel.tsx` (the snapshot holds two lists; passes two props), `packages/ui/src/guides/LobbyGuides.tsx`, `packages/ui/src/guides/lobbyGuides.css` (append)
- Test: additions to `packages/ui/src/guides/lobbyGuidesRail.test.tsx`

**Interfaces:**
- Consumes: `canEditGuide` (Task 8); `requestGuideEdit`, `useGuides` (Task 3); `useGame` (`account.userId`, `toggleBook`).
- Produces: `LobbyGuides` gains two props: `mine: readonly Guide[]` (the player's own guides for this game, shown after Team Ascent's under a "Your guides" label) and `canEdit: (g: Guide) => boolean`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/ui/src/guides/lobbyGuidesRail.test.tsx`, inside the existing `describe('lobby rail guides view', ...)` block (the file already imports `useGuides`, `resetGuidesForTests`, `GUIDES`, `guidesFor`, `useGame`, `act`, and has `mountRail`, `openGuides`, `click`):
```tsx
  it('the player\'s own guides for this game follow Team Ascent\'s, under a "Your guides" label', () => {
    const c = mountRail(8181);
    const run = useGame.getState().run;
    const own = { ...GUIDES[0]!, id: 'own-1', rowId: 'own-1', official: false, published: false, authorId: 'u-1', byline: 'Mike', title: 'My private build', sets: [run.setId ?? 'set1'], tribes: [run.tribes[0]!] };
    const elsewhere = { ...own, id: 'own-2', rowId: 'own-2', title: 'For another set', sets: [] };
    // Set before the Guides view opens: opening it is when the rail takes its snapshot.
    act(() => { useGuides.setState({ mine: [own, elsewhere] }); });
    openGuides(c);
    const labels = [...c.querySelectorAll('.lobbyguides-sec')].map((n) => n.textContent);
    expect(labels).toEqual(['Your guides']);
    const ids = [...c.querySelectorAll('.lobbyguide')].map((g) => g.getAttribute('data-guide'));
    expect(ids[ids.length - 1]).toBe('own-1');
    expect(ids).not.toContain('own-2');
    expect(ids.slice(0, -1)).toEqual(guidesFor(run.setId, run.tribes).map((g) => g.id));
  });

  it('with no guides of their own there is no "Your guides" label', () => {
    const c = mountRail(8282);
    openGuides(c);
    expect(c.querySelector('.lobbyguides-sec')).toBeNull();
  });

  it('an open guide the player may edit has an Edit button that opens the Compendium on it; one they may not edit has none', () => {
    const c = mountRail(8383);
    const run = useGame.getState().run;
    const own = { ...GUIDES[0]!, id: 'own-1', rowId: 'own-1', official: false, published: false, authorId: 'u-1', byline: 'Mike', title: 'Mine', sets: [run.setId ?? 'set1'], tribes: [] };
    act(() => {
      useGame.setState({ account: { userId: 'u-1', email: 'm@example.test', anonymous: false, discriminator: null }, showBook: false });
      useGuides.setState({ mine: [own], capability: 'on' });
    });
    openGuides(c);
    const head = (id: string): Element => c.querySelector(`.lobbyguide[data-guide="${id}"] .lobbyguide-head`)!;
    const official = guidesFor(run.setId, run.tribes)[0]!;
    click(head(official.id));
    expect(c.querySelector(`.lobbyguide[data-guide="${official.id}"] .lobbyguide-editbtn`)).toBeNull();
    click(head('own-1'));
    const edit = c.querySelector(`.lobbyguide[data-guide="own-1"] .lobbyguide-editbtn`)!;
    expect(edit.textContent).toBe('Edit');
    click(edit);
    expect(useGuides.getState().pendingEdit).toBe('own-1');
    expect(useGame.getState().showBook).toBe(true);
    act(() => { useGame.setState({ showBook: false }); });
  });

  it('the rail takes its own guides as a snapshot too: a save that lands while it is open does not add a card', () => {
    const c = mountRail(8484);
    const run = useGame.getState().run;
    openGuides(c);
    const before = c.querySelectorAll('.lobbyguide').length;
    act(() => { useGuides.setState({ mine: [{ ...GUIDES[0]!, id: 'late', rowId: 'late', official: false, authorId: 'u-1', sets: [run.setId ?? 'set1'], tribes: [] }] }); });
    expect(c.querySelectorAll('.lobbyguide').length).toBe(before);
    const tab = c.querySelector('.lobbyrailtab')!;
    click(tab);
    click(tab);
    expect(c.querySelectorAll('.lobbyguide').length).toBe(before + 1);
  });
```
The third test changes the game store's `account` and opens the Compendium, so restore both: add `const prevAccount = useGame.getState().account;` at module level (below the imports) and, in the file's existing `afterEach`, after `resetGuidesForTests();`, add `act(() => { useGame.setState({ account: prevAccount, showBook: false }); });`. The store reset already clears `mine`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run packages/ui/src/guides/lobbyGuidesRail.test.tsx`
Expected: the four new tests FAIL; the existing ones pass.

- [ ] **Step 3: Implement the rail list**

In `packages/ui/src/guides/LobbyGuides.tsx`:

1. Add to the imports: `import { useGame } from '../store';` is already there; add `import { requestGuideEdit } from './guidesStore';`.
2. `LobbyGuides` takes two more props. Its signature becomes:
```tsx
export const LobbyGuides = memo(function LobbyGuides({ guides, mine, canEdit, tribes, runKey, mode, onMode }: {
  guides: readonly Guide[];
  /** The player's own guides for this game (set + lobby tribes), shown after Team Ascent's. */
  mine: readonly Guide[];
  /** May this account edit this guide? Draws the Edit button on an open card. */
  canEdit: (g: Guide) => boolean;
  tribes: readonly Tribe[]; runKey: string;
  /** SIMPLE: the normal-width rail, portraits only. FULL: the wide rail, with the tagline and the write-up. */
  mode: GuidesMode;
  /** The open card's Detailed / Simple button (owner 2026-10-09: per card, not a header pill). */
  onMode: (m: GuidesMode) => void;
}): JSX.Element {
```
3. The fit-probe effect's dependency list `[guides.length]` becomes `[guides.length + mine.length]`.
4. The empty check becomes `if (guides.length === 0 && mine.length === 0) return ...` (same element as today).
5. In the returned list, after the `{guides.map(...)}` block, add:
```tsx
      {/* The player's own guides (2026-10-12): the same rows, after Team Ascent's, under one quiet label. */}
      {mine.length > 0 && <div className="lobbyguides-sec" role="presentation">Your guides</div>}
      {mine.map((g) => (
        <GuideRow key={g.id} guide={g} tribes={tribes} open={open === g.id} full={mode === 'full'} onMode={onMode} editable={canEdit(g)}
          onToggle={() => { userOpened.current = open !== g.id; setOpen((o) => (o === g.id ? null : g.id)); }} />
      ))}
```
and add `editable={canEdit(g)}` to the existing `<GuideRow ... />` in the `guides.map`.
6. `GuideRow` takes `editable: boolean` and passes it to `GuideBody`. `GuideBody` takes `editable: boolean` and renders the Edit button beside the mode button. Replace the mode button's JSX in `GuideBody` with:
```tsx
      <div className="lobbyguide-foot">
        {/* DETAILED / SIMPLE, per open card: Detailed widens the rail to the left and adds the write-up; Simple folds
            back to the normal rail. The choice is remembered (LobbyPanel). */}
        <button type="button" className="lobbyguide-modebtn"
          aria-label={full ? 'Simple view: portraits only, normal rail width' : 'Detailed view: wider rail with the write-up'}
          onClick={() => onMode(full ? 'simple' : 'full')}>
          {full ? 'Simple' : 'Detailed'}
        </button>
        {/* EDIT (2026-10-12): opens the Compendium on this guide in the editor. The rail is too narrow to write in. */}
        {editable && guide.rowId && (
          <button type="button" className="lobbyguide-modebtn lobbyguide-editbtn" aria-label={`Edit ${guide.title} in the Compendium`}
            onClick={() => { requestGuideEdit(guide.rowId!); const st = useGame.getState(); if (!st.showBook) st.toggleBook(); }}>
            Edit
          </button>
        )}
      </div>
```

Append to `packages/ui/src/guides/lobbyGuides.css`:
```css
/* -- YOUR GUIDES (2026-10-12): a quiet label between Team Ascent's guides and the player's own, and the open card's
   foot holding its two buttons. Reuses the rail's own sizing variables; nothing animates. */
.lobbyguides-sec {
  margin: calc(4 * var(--lrow)) 0 calc(1 * var(--lrow)); padding-left: calc(4 * var(--lrow));
  font-size: calc(11 * var(--lfont) * 0.85 * var(--lgt, 1.6)); font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ui-muted);
}
.lobbyguide-foot { display: flex; justify-content: center; gap: calc(6 * var(--lu)); }
.lobbyguide-foot .lobbyguide-modebtn { align-self: auto; }
```

- [ ] **Step 4: Implement the rail's snapshot**

In `packages/ui/src/LobbyPanel.tsx` (find each anchor by searching; change nothing else):

1. Add to the `./guides/guides` import: `canEditGuide`.
2. Replace the three lines that hold and retake the snapshot. Today they read:
```ts
  const [guideList, setGuideList] = useState(() => useGuides.getState().list);
  const guides = useMemo(() => guidesFor(setId, runTribes, guideList), [setId, runTribes, guideList]);
```
and, lower down, `useLayoutEffect(() => { if (showGuides) setGuideList(useGuides.getState().list); }, [showGuides]);`. They become (keep the comment above the first line, adding one sentence that the player's own guides are part of the same snapshot):
```ts
  const [guideSnap, setGuideSnap] = useState(() => ({ list: useGuides.getState().list, mine: useGuides.getState().mine }));
  const guides = useMemo(() => guidesFor(setId, runTribes, guideSnap.list), [setId, runTribes, guideSnap.list]);
  const myGuides = useMemo(() => guidesFor(setId, runTribes, guideSnap.mine), [setId, runTribes, guideSnap.mine]);
```
and
```ts
  useLayoutEffect(() => {
    if (!showGuides) return;
    const s = useGuides.getState();
    // Same two arrays as last time = the same snapshot object, so nothing re-renders.
    setGuideSnap((cur) => (cur.list === s.list && cur.mine === s.mine ? cur : { list: s.list, mine: s.mine }));
  }, [showGuides]);
```
3. Above the `return`, with the other hooks (before any early return), add:
```ts
  // Who may edit: a boolean and an id, both cheap to subscribe to. The guide LISTS are still only a snapshot.
  const guideTeam = useGuides((s) => s.team);
  const guideUserId = useGame((st) => st.account.userId);
  const canEditInRail = useCallback((g: Guide) => canEditGuide(g, guideUserId, guideTeam), [guideUserId, guideTeam]);
```
adding `useCallback` to the file's `react` import if it is not there, and `type Guide` to the `./guides/guides` import.
4. The render site gains the two props:
```tsx
          <LobbyGuides guides={guides} mine={myGuides} canEdit={canEditInRail} tribes={runTribes} runKey={runKey} mode={mode} onMode={setMode} />
```

- [ ] **Step 5: Run every guide test, the typecheck and the tripwires**

Run: `npx vitest run packages/ui/src/guides && npm run typecheck:web && npx vitest run packages/ui/src/stageTripwire.test.ts && npx eslint packages/ui/src/guides packages/ui/src/LobbyPanel.tsx`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/LobbyPanel.tsx packages/ui/src/guides/LobbyGuides.tsx packages/ui/src/guides/lobbyGuides.css packages/ui/src/guides/lobbyGuidesRail.test.tsx
git commit -m "feat(guides): your own guides in the lobby rail, with an Edit link to the Compendium"
```

---

### Task 10: Patch notes, devlog, runbook

**Files:**
- Modify: `packages/ui/src/patchNotes.ts`, `supabase/README.md`
- Create: `docs/devlog/2026-10-12-guides-editor.md` (use the date the work lands if it is later)

- [ ] **Step 1: Patch notes**

Read the header of `packages/ui/src/patchNotes.ts` for the rules (one block per date, no duplicate text, plain English, spoiler-light, no em dashes). PREPEND to the block for the ship date (create the block at the top if that date has none), category `Systems`:
```ts
      {
        category: 'Systems',
        text: 'Guides: write your own. Sign in, open the Compendium, and press New guide, or Duplicate on any guide to start from it.',
        details: [
          'Your guides are private for now: only you see them, under My guides and in your own lobby rail.',
          'Pick the cards, write the build, and any card name you type lights up for hovering.',
          'Edit or delete your guides any time. An unfinished guide is kept on this device if you close the Compendium.',
          'A guide that names a card which has left the set shows that card greyed out as "Missing or removed".',
        ],
      },
```
Run: `npx vitest run packages/ui/src/patchNotes.test.ts`
Expected: PASS.

- [ ] **Step 2: Runbook**

In `supabase/README.md`, in the section "Guides on the server (2026-10-12)", add a subsection at its end:
```markdown
### The editor (step 2)

Nothing new to run in SQL. The client now calls `guide-write`, so:

1. **Deploy the function** if it is not deployed yet: `npx supabase functions deploy guide-write`.
2. **Import the built-in guides, once.** Signed in as a team account, open the Compendium, Guides, and press
   **Import built-in guides**. It is offered only to the team and only while the built-in copies are showing. Do this
   before creating any new Team Ascent guide.
3. **Check row-level security with two real accounts** (this has never been run against the live project):
   - Account A (not on the team): New guide, save. It appears under My guides.
   - Account B: it must NOT see A's guide anywhere. In the SQL editor, `select count(*) from public.guides where not official;` shows it exists; B's Compendium does not.
   - Account A: a Team Ascent guide shows no Edit button. Team account: it does, and an edit shows for A after reopening the Compendium.
   - Guest: New guide asks to sign in.
```

- [ ] **Step 3: Devlog**

`docs/devlog/2026-10-12-guides-editor.md`, in the house style of `docs/devlog/2026-10-12-guides-storage.md` (plain sentences, no em dashes, ASCII only). Sections, with the content filled from what actually shipped:
- A first line with the owner's ask (quote it from the spec's section 0) and links to the spec and this plan.
- `## What shipped`: the seam's writes and reads; the store's team flag and my guides and the mid-read re-read; `guideDrafts` (named cards and sets derived at save, a missing card blocks the save); the device draft; the card picker; the editor (fields, rows, nicknames, preview, conflict, keys); the Guides tab (pills, New guide, Duplicate, Edit, badges, the guest line, offline, Import, Resume); the rail (Your guides, Edit).
- `## Decisions that differ from the spec`: the nine items in this plan's "Deviations from the spec", each with the owner's answer from the plan review, plus any ruling made during execution.
- `## Known gaps (for the owner)`: every player guide is private until step 3; the editor's and toolbar's look is a first cut; closing the Compendium outright does not ask (the draft is kept); reordering is by arrows.
- `## Performance`: left for Task 11 to fill.
- `## Not verified here`: the live two-account check (runbook, step 3) and anything else not run.
- `## Carried to the next steps`: what step 3 and step 4 inherit (copy forward the step 3 and step 4 lists from the storage devlog, and add anything this step found).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/patchNotes.ts supabase/README.md docs/devlog/2026-10-12-guides-editor.md
git commit -m "docs(guides): patch notes, runbook and devlog for the guide editor"
```

---

### Task 11: The owner's look, the render measurement, full gates, pull request (controller, not a subagent)

This task needs a real render and the owner's eyes. It is done by the session that is running the plan, not handed to a subagent.

- [ ] **Step 1: Full gates on the finished tree**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web && npm run docbot:report -- --check`
Expected: all green. If `npm test` fails only in `packages/ui/src/audio/master.test.ts` or `packages/ui/src/audioDefaultMix.test.ts` with 5000 ms timeouts, re-run those two files on an idle machine before concluding anything (they timed out on the development machine under load during step 1, with and without that branch's code).

- [ ] **Step 2: Show the owner the editor, the toolbar, the rail's Edit and the missing slot**

Serve THIS worktree's build and give the owner the address, or screenshots if the pane can render them. Confirm the served code is this branch first (fetch a module that only this branch has, for example `packages/ui/src/guides/GuideEditor.tsx`, and check it loads). Show: the Guides tab with the toolbar; New guide (the empty editor); a guide being edited with a card picker open; a guide holding a missing card (inject one through the guides store, as step 1's plan describes); the rail with "Your guides" and an open card's Edit button. Ask one question: "Is this the look you want, and what should change?" Record the answer in the PR body. Do not adjust the CSS without the owner's say; if the owner asks for changes, they are a follow-up commit on this branch, reviewed like any other.

- [ ] **Step 3: Measure the render**

On the production build (`npm run build:web`, served; never `npm run dev`), with DevTools Performance per `docs/performance.md`: opening the Compendium Guides tab; pressing New guide; typing a 300-character write-up with two card names; opening the rail's Guides view with 20 own guides. Compare against the 2026-10-09 devlog (no long task over 50 ms opening Guides). Put the numbers in the devlog's `## Performance` section. A regression is a defect: stop and report it. If the pane cannot give trustworthy timings, say so plainly in the devlog and ask the owner to run the two-minute routine, rather than writing a number that was not measured.

- [ ] **Step 4: Push and open the pull request**

```bash
git fetch origin && git merge origin/main
npm run typecheck && npx vitest run packages/ui/src/guides packages/guides
git push -u origin feat/guides-editor
gh pr create --title "feat(guides): write and edit guides in the Compendium (step 2 of 4)" --body-file <path to a file holding the body>
```
PR body: what shipped (from the devlog); the deviations and the owner's answer to each; the gate output; the measurement; the owner's answer on the look; the owner's checklist from the runbook (deploy, import, the two-account check). This step touches no server files, so it does not need Kevin's review for ownership reasons; auto-merge follows the owner's standing preference once `verify` is green and the owner has seen the look.

---

## Self-review notes (for the reader, not a task)

- Spec section 9 step 2: "Team members edit Team Ascent guides" (Tasks 3, 7, 8), "Players create and duplicate private guides" (Tasks 4, 7, 8), "My guides pill" (Tasks 3, 8), "Rail pencil and the rail's yours section" (Task 9, as an Edit button).
- Spec section 4, the editor: fields and controls (Task 7), unsaved changes and the device draft (Tasks 5, 7, 8), edit conflicts (Task 7), missing cards block a save (Tasks 4, 7), typing never triggers game hotkeys (Task 7), starting a guide (Task 8), from the rail (Task 9), offline (Task 8).
- Carried from step 1: `official: true` on a team edit (Task 4 `toWire`, pinned in Task 7); import before any Team Ascent create (Task 8); capability `unknown` is not on (Task 8); re-read on an identity change mid-read (Task 3); the live two-account check (Task 10 runbook); the owner's look at the missing slot and the render measurement (Task 11).
- Not in this step, by the spec: the Publish switch, Saved and Community pills, bookmarks (step 3); Report, Hide, the Reports pill, Carry guides over, `guides:pull`, retiring the owner's title pins (step 4). No server file changes.
- No oracle rule is added: this is a feature. R-NET-01 is honoured by the three new reads (Task 1 runs the guard).
