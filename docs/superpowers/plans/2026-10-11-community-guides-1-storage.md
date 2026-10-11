# Community Guides, Step 1: Storage and Reading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move guides from fixed code data to a server table the game reads at boot, with the built-in guides kept as the offline fallback, and a permission-checked server write path ready for the editor in step 2.

**Architecture:** A new dependency-free package `@game/guides` holds the wire types, limits, validation, word filter, set-membership rule and the write handler; a generator copies it into `supabase/functions/_shared/` for the Deno Edge Function (the `@game/progression` pattern). Row rules (who may write which row, the 20-guide cap, the rate limit, edit conflicts) live in `security definer` SQL functions callable only by the service role; text rules live in the TypeScript handler. The client reads official guides directly under row-level security into a small Zustand store that falls back to the bundled guides.

**Tech Stack:** TypeScript, Vitest, PGlite (in-process Postgres for SQL tests), Supabase (Postgres + RLS + Deno Edge Functions), React 18, Zustand.

**Spec:** `docs/superpowers/specs/2026-10-11-community-guides-design.md`. This plan implements delivery step 1 of section 9 only. Steps 2 (editor), 3 (community) and 4 (moderation, release tools) each get their own plan once the step before has merged.

**Code in this plan is unrun draft.** Each task's failing-test-then-passing-test cycle is what verifies it. If a snippet does not compile or a test fails for a reason the plan did not predict, fix the code to satisfy the test's intent; do not weaken the test.

## Global Constraints

- Branch `feat/guides-storage` off latest `origin/main`, in its own worktree under `.claude/worktrees/`. Run `npm install` inside the worktree before trusting any typecheck or test. Never commit or push to `main`.
- Before claiming done: `npm run typecheck && npm run lint && npm test && npm run build:web` all green; report the output.
- Every commit message ends with the session's `Co-Authored-By` attribution line.
- Limits, verbatim from the spec: guides per player **20**; title **1 to 40**; tagline **0 to 80**; write-up **1 to 1,200**; "by" line **1 to 24**; Core **1 to 6**; Enablers **0 to 6**; tribes **0 to 2** plus **0 to 1** "pairs with"; nicknames **0 to 6**; saves **30 per hour per account**.
- Official guides: `byline` is always `Team Ascent`, `published` is always true.
- Guests (anonymous accounts) are refused every write with `sign_in_required`.
- Every Supabase list read runs through `fetchAllRows` or carries an explicit bound (R-NET-01; `supabaseRows.guard.test.ts` enforces it). A server-side `admin.rpc(` call carries a `// rows:` note.
- No `title=` attributes. No bare `cursor: pointer`. No raw `vw` / `vh`. No em dashes in player-facing text. No looping animation of paint properties.
- `supabase/functions/_shared/guides*.ts` are generated: never hand-edit them; run `npm run guides:shared`.
- `packages/guides/src` sources that are copied to Deno import only each other, with the exact form `from './name';`.
- `packages/ui/src/store.ts` is a hot file: this plan adds exactly two lines and one import to it.

## Deviations from the spec (agreed here, to be confirmed by the owner on plan review)

1. **The art icon does not count toward set membership.** The spec's rule lists the icon. The Imps guide's icon (`impscrap`) is a token that is in no set's pool, so the spec's rule would drop a live guide. The icon only needs to resolve to a card with art.
2. **Official guides keep today's order.** The spec says "sort by the set's tribe order". Set 2's roster order (Kobold first) would visibly reorder the rail. Instead: a `sort_order` column, guides grouped by first tribe in order of each tribe's first appearance, Neutral last. Today's order is unchanged and a new Beast guide lands beside the other Beasts.
3. **A dropped connection keeps the last list.** The spec says the list is the bundled fallback whenever the capability is not `on`. Swapping a loaded list back to the bundled copies on one timed-out refresh would reshuffle guides mid-session, so the store keeps the last good list and only updates the capability.
4. **`store.ts` gets the boot call now** (two lines), in addition to the deep link the spec mentions for step 2. Loading on first open instead would show stale guides on the first open of every session.
5. **The import button is not in this step.** The `importBuiltIns` op ships and is tested here; its team-only button arrives with the editor in step 2. Until it is pressed, every player sees the bundled guides, so nothing changes for players when this step merges.
6. **`author_id` is nullable, `on delete set null`.** A team member deleting their account must not delete the Team Ascent guides they created.

## Review Focus

Inputs the spec implies but does not spell out. Each has a test in the task named.

1. **A title that looks empty but is not** (only zero-width or bidi-control characters, or only whitespace): refused as `bad_guide`, field `title`. Lengths are counted in code points, so an emoji title is not cut mid-character. → Task 1.
2. **A malformed or newer-than-this-client server row** (null arrays, an unknown tribe, an unknown set id, a card id this build has never heard of): the client drops or greys it and never throws. → Tasks 1, 6, 9.
3. **The server answers with zero usable official guides** (nothing imported yet, or every row unparseable): the rail and Compendium keep showing the bundled guides, never an empty list. → Task 8.
4. **A hung network at boot, and two callers loading at once**: the read is time-boxed to 4 s and reports `offline`; concurrent `loadGuides()` calls share one request. → Tasks 7, 8.
5. **An oversized request body** sent straight to the function (megabytes of text): refused with 413 before it is parsed. → Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/guides/package.json` | Workspace manifest for `@game/guides` |
| `packages/guides/src/types.ts` | Limits, id patterns, `GuideRecord` (wire shape), `parseGuideRecord` |
| `packages/guides/src/validate.ts` | `cleanText`, `GuideDraft`, `validateGuideDraft`, `draftToSqlDoc` |
| `packages/guides/src/wordFilter.ts` | Word list, `isBlockedText`, `isReservedByline`, `guideTextProblem` |
| `packages/guides/src/sets.ts` | `guideSetsFor` (the carry-over rule) |
| `packages/guides/src/server.ts` | `handleGuideWrite` (the Edge Function's logic, pure) |
| `packages/guides/src/sharedArtifact.ts` | Which sources are copied to Deno, and how |
| `packages/guides/src/index.ts` | Public entry: types, validate, sets. Not the word list, not the handler |
| `packages/tools/src/guides-shared.ts` | `npm run guides:shared` |
| `supabase/migrations/2026-10-12-guides.sql` | Tables, RLS, the three write functions |
| `schema.sql` | The same block appended |
| `supabase/functions/guide-write/index.ts` | Thin Deno entry |
| `supabase/functions/_shared/guides{Types,Validate,WordFilter,Server}.ts` | Generated |
| `packages/ui/src/guides/guides.bundled.ts` | The 11 built-in guides (moved, unchanged) |
| `packages/ui/src/guides/guides.ts` | UI `Guide` type, `GUIDES`, `toGuide`, `guidesFor`, `guideMissingIds` |
| `packages/ui/src/guides/guidesRemote.ts` | The Supabase read seam |
| `packages/ui/src/guides/guidesStore.ts` | `useGuides`, `loadGuides` |
| `packages/ui/src/guides/GuideParts.tsx`, `lobbyGuides.css` | The missing-card slot |
| `packages/ui/src/guides/CompendiumGuides.tsx`, `LobbyGuides.tsx`, `packages/ui/src/LobbyPanel.tsx`, `packages/ui/src/MinionBook.tsx` | Read the store; pass the set through |

---

### Task 0: Workspace

**Files:** none committed.

- [ ] **Step 1: Create the worktree and install**

```bash
git fetch origin
git worktree add .claude/worktrees/guides-storage -b feat/guides-storage origin/main
cd .claude/worktrees/guides-storage
npm install
git branch --show-current
```
Expected: `feat/guides-storage`.

- [ ] **Step 2: Confirm a clean baseline**

Run: `npx vitest run packages/ui/src/guides`
Expected: PASS (3 files). If it fails on a clean checkout, stop and report; do not build on a red baseline.

---

### Task 1: `@game/guides` package: types, limits, validation

**Files:**
- Create: `packages/guides/package.json`, `packages/guides/src/types.ts`, `packages/guides/src/validate.ts`, `packages/guides/src/index.ts`
- Test: `packages/guides/src/types.test.ts`, `packages/guides/src/validate.test.ts`
- Modify: `apps/web/vite.config.ts` (alias), `packages/ui/package.json` (dependency), `CLAUDE.md` (Monorepo block)

**Interfaces:**
- Produces: `GUIDE_LIMITS`, `TEAM_BYLINE`, `CARD_ID_RE`, `TRIBE_RE`, `SET_ID_RE`, `SLUG_RE`, `UUID_RE`, `GuideRecord`, `parseGuideRecord(v: unknown): GuideRecord | null`, `cleanText(v: unknown): string`, `GuideDraft`, `validateGuideDraft(v: unknown, opts?: { requireSlug?: boolean }): { ok: true; draft: GuideDraft } | { ok: false; error: 'bad_guide'; field: string }`, `draftToSqlDoc(d: GuideDraft): Record<string, unknown>`.

- [ ] **Step 1: Write the manifest**

`packages/guides/package.json`:
```json
{
  "name": "@game/guides",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.8"
  }
}
```

In `packages/ui/package.json`, add `"@game/guides": "*",` to `dependencies`, directly after the `@game/core` line.

In `apps/web/vite.config.ts`, add this line directly after the `'@game/progression'` alias:
```ts
      '@game/guides': r('../../packages/guides/src/index.ts'),
```

In `CLAUDE.md`, in the Monorepo code block, add directly after the `packages/progression/` entry (two lines):
```
packages/guides/   @game/guides   guide wire types, limits, validation, word filter, write handler (dependency-free; Deno copy generated by
                                     `npm run guides:shared`, never hand-edit supabase/functions/_shared/guides*)
```

Run: `npm install`
Expected: `package-lock.json` gains a `node_modules/@game/guides` link entry.

- [ ] **Step 2: Write the failing tests**

`packages/guides/src/types.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CARD_ID_RE, parseGuideRecord } from './types';

const row = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'set2-beast-sunmane', author_id: null, byline: 'Team Ascent',
  official: true, published: true, hidden: false, sets: ['set2'], tribes: ['beast'], pairs_with: [], icon_card: 'b2_sunmane',
  title: 'Sunmane', tagline: 'Rally Attack.', body: 'Body.', core: ['b2_sunmane'], enablers: [], mentions: [], aliases: {},
  forked_from: null, forked_title: null, forked_byline: null, bookmark_count: 0, sort_order: 3, revision: 2,
  created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z',
};

describe('parseGuideRecord', () => {
  it('reads a full row into camelCase', () => {
    expect(parseGuideRecord(row)).toMatchObject({ id: row.id, slug: 'set2-beast-sunmane', authorId: null, official: true, iconCard: 'b2_sunmane', pairsWith: [], sortOrder: 3, revision: 2 });
  });
  it('never throws on a malformed row: null arrays become empty, junk array members are dropped', () => {
    const r = parseGuideRecord({ ...row, sets: null, tribes: 'beast', enablers: [1, 'ok', null], aliases: ['x'], bookmark_count: 'many' });
    expect(r).toMatchObject({ sets: [], tribes: [], enablers: ['ok'], aliases: {}, bookmarkCount: 0 });
  });
  it('answers null when the row has no id, no title or no write-up', () => {
    expect(parseGuideRecord(null)).toBeNull();
    expect(parseGuideRecord({ ...row, id: 7 })).toBeNull();
    expect(parseGuideRecord({ ...row, title: '' })).toBeNull();
    expect(parseGuideRecord({ ...row, body: undefined })).toBeNull();
  });
  it('the card id pattern takes underscores and hyphens (gemheart-shard is a real id)', () => {
    for (const id of ['b2_sunmane', 'grim', 'gemheart-shard']) expect(CARD_ID_RE.test(id), id).toBe(true);
    for (const id of ['', 'Has Space', 'UPPER', 'a'.repeat(49)]) expect(CARD_ID_RE.test(id), id).toBe(false);
  });
});
```

`packages/guides/src/validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { cleanText, draftToSqlDoc, validateGuideDraft } from './validate';

const good = {
  byline: 'Mike', sets: ['set2'], tribes: ['beast'], pairsWith: [], iconCard: 'b2_sunmane', title: 'My Sunmane',
  tagline: 'Rally it.', body: 'Stack the rally.', core: ['b2_sunmane', 'b2_solaris'], enablers: ['b2_sunmane'], mentions: [], aliases: {},
};
const bad = (patch: Record<string, unknown>, opts?: { requireSlug?: boolean }): string => {
  const r = validateGuideDraft({ ...good, ...patch }, opts);
  return r.ok ? 'ok' : r.field;
};

describe('cleanText', () => {
  it('collapses whitespace, trims, and strips zero-width and bidi control characters', () => {
    expect(cleanText('  a \n\t b  ')).toBe('a b');
    expect(cleanText('a​b‮c﻿')).toBe('abc');
    expect(cleanText(42)).toBe('');
  });
});

describe('validateGuideDraft', () => {
  it('accepts a good draft and normalises it (a new guide has no id and no revision)', () => {
    const r = validateGuideDraft({ ...good, title: '  My   Sunmane ' });
    expect(r).toMatchObject({ ok: true, draft: { id: null, revision: null, slug: null, official: false, title: 'My Sunmane', forkedFrom: null } });
  });
  it('a card may sit in both Core and Enablers (Sunmane does), but not twice in one row', () => {
    expect(bad({})).toBe('ok');
    expect(bad({ core: ['b2_sunmane', 'b2_sunmane'] })).toBe('core');
  });
  it('enforces every limit at its edge', () => {
    expect(bad({ title: 'x'.repeat(40) })).toBe('ok');
    expect(bad({ title: 'x'.repeat(41) })).toBe('title');
    expect(bad({ tagline: '' })).toBe('ok');
    expect(bad({ tagline: 'x'.repeat(81) })).toBe('tagline');
    expect(bad({ body: 'x'.repeat(1200) })).toBe('ok');
    expect(bad({ body: 'x'.repeat(1201) })).toBe('body');
    expect(bad({ body: '' })).toBe('body');
    expect(bad({ byline: 'x'.repeat(25) })).toBe('byline');
    expect(bad({ byline: '' })).toBe('byline');
    expect(bad({ core: [] })).toBe('core');
    expect(bad({ core: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).toBe('core');
    expect(bad({ enablers: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })).toBe('enablers');
    expect(bad({ tribes: ['beast', 'dragon', 'demon'] })).toBe('tribes');
    expect(bad({ pairsWith: ['dwarf', 'kobold'] })).toBe('pairsWith');
    expect(bad({ sets: [] })).toBe('sets');
  });
  it('REVIEW FOCUS 1: a title of only invisible characters is refused, and length counts code points', () => {
    expect(bad({ title: '​​‮' })).toBe('title');
    expect(bad({ title: '   ' })).toBe('title');
    expect(bad({ title: '🐉'.repeat(40) })).toBe('ok');
    expect(bad({ title: '🐉'.repeat(41) })).toBe('title');
  });
  it('refuses ids, tribes and sets that are not the right shape', () => {
    expect(bad({ iconCard: 'Not An Id' })).toBe('iconCard');
    expect(bad({ core: ['ok', 'NOT OK'] })).toBe('core');
    expect(bad({ tribes: ['Beast!'] })).toBe('tribes');
    expect(bad({ sets: ['two'] })).toBe('sets');
    expect(bad({ id: 'nope', revision: 1 })).toBe('id');
    expect(bad({ id: '11111111-1111-4111-8111-111111111111' })).toBe('revision');
    expect(bad({ forkedFrom: 'nope' })).toBe('forkedFrom');
  });
  it('a nickname must point at a card the guide lists', () => {
    expect(bad({ aliases: { sunny: 'b2_sunmane' } })).toBe('ok');
    expect(bad({ aliases: { sunny: 'grim' } })).toBe('aliases');
    expect(bad({ aliases: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`w${i}`, 'b2_sunmane'])) })).toBe('aliases');
  });
  it('an official guide needs no byline (the server writes Team Ascent)', () => {
    expect(bad({ official: true, byline: '' })).toBe('ok');
  });
  it('an import requires a slug; a normal save ignores one', () => {
    expect(bad({ official: true, slug: 'set2-beast-sunmane' }, { requireSlug: true })).toBe('ok');
    expect(bad({ official: true }, { requireSlug: true })).toBe('slug');
    expect(validateGuideDraft({ ...good, slug: 'set2-x' })).toMatchObject({ ok: true, draft: { slug: null } });
  });
  it('anything that is not an object is refused', () => {
    expect(validateGuideDraft(null)).toEqual({ ok: false, error: 'bad_guide', field: 'guide' });
    expect(validateGuideDraft('x')).toEqual({ ok: false, error: 'bad_guide', field: 'guide' });
  });
});

describe('draftToSqlDoc', () => {
  it('writes the snake_case document the SQL functions read', () => {
    const r = validateGuideDraft({ ...good, pairsWith: ['dwarf'], forkedFrom: '11111111-1111-4111-8111-111111111111' });
    if (!r.ok) throw new Error('expected ok');
    expect(draftToSqlDoc(r.draft)).toMatchObject({ icon_card: 'b2_sunmane', pairs_with: ['dwarf'], forked_from: '11111111-1111-4111-8111-111111111111', official: false });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run packages/guides`
Expected: FAIL, cannot resolve `./types` and `./validate`.

- [ ] **Step 4: Implement**

`packages/guides/src/types.ts`:
```ts
/**
 * GUIDES: the wire shapes and limits shared by the client, the `guide-write` Edge Function and the tests
 * (spec: docs/superpowers/specs/2026-10-11-community-guides-design.md).
 *
 * Dependency-free. `npm run guides:shared` copies this file VERBATIM into supabase/functions/_shared/guidesTypes.ts;
 * `sharedArtifact.test.ts` fails CI on drift.
 */

/** Every number here is the owner's (spec section 1). The SQL repeats `guidesPerPlayer` and `savesPerHour`. */
export const GUIDE_LIMITS = Object.freeze({
  guidesPerPlayer: 20,
  title: 40,
  tagline: 80,
  body: 1200,
  byline: 24,
  core: 6,
  enablers: 6,
  mentions: 20,
  tribes: 2,
  pairsWith: 1,
  aliases: 6,
  aliasWord: 24,
  sets: 8,
  savesPerHour: 30,
  importBatch: 50,
  /** The request body ceiling the Edge Function enforces before parsing. */
  bodyBytes: 64 * 1024,
});

/** The "by" line every official guide wears. Reserved: a player's guide can never use it. */
export const TEAM_BYLINE = 'Team Ascent';

export const CARD_ID_RE = /^[a-z0-9_-]{1,48}$/;
export const TRIBE_RE = /^[a-z]{2,20}$/;
export const SET_ID_RE = /^set[0-9]{1,3}$/;
export const SLUG_RE = /^[a-z0-9-]{3,60}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One `guides` row as the client sees it. */
export interface GuideRecord {
  id: string;
  /** Only on the imported built-in guides. */
  slug: string | null;
  authorId: string | null;
  byline: string;
  official: boolean;
  published: boolean;
  hidden: boolean;
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
  forkedFrom: string | null;
  forkedTitle: string | null;
  forkedByline: string | null;
  bookmarkCount: number;
  sortOrder: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0);

/** Parse a `guides` row (snake_case). Tolerant of a malformed row; null when it has no id, title or write-up. */
export function parseGuideRecord(v: unknown): GuideRecord | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id);
  const title = str(o.title);
  const body = str(o.body);
  if (!id || !title || !body) return null;
  const aliases: Record<string, string> = {};
  if (o.aliases && typeof o.aliases === 'object' && !Array.isArray(o.aliases)) {
    for (const [k, val] of Object.entries(o.aliases as Record<string, unknown>)) if (typeof val === 'string') aliases[k] = val;
  }
  return {
    id,
    slug: strOrNull(o.slug),
    authorId: strOrNull(o.author_id),
    byline: str(o.byline),
    official: o.official === true,
    published: o.published === true,
    hidden: o.hidden === true,
    sets: strs(o.sets),
    tribes: strs(o.tribes),
    pairsWith: strs(o.pairs_with),
    iconCard: str(o.icon_card),
    title,
    tagline: str(o.tagline),
    body,
    core: strs(o.core),
    enablers: strs(o.enablers),
    mentions: strs(o.mentions),
    aliases,
    forkedFrom: strOrNull(o.forked_from),
    forkedTitle: strOrNull(o.forked_title),
    forkedByline: strOrNull(o.forked_byline),
    bookmarkCount: int(o.bookmark_count),
    sortOrder: int(o.sort_order),
    revision: int(o.revision),
    createdAt: str(o.created_at),
    updatedAt: str(o.updated_at),
  };
}
```

`packages/guides/src/validate.ts`:
```ts
/**
 * GUIDES: shape and limit validation for a guide being saved. Text rules (the word filter) are in wordFilter.ts;
 * row rules (ownership, the 20-guide cap, the rate limit, edit conflicts) are in the SQL functions.
 *
 * Dependency-free. Generated VERBATIM into supabase/functions/_shared/guidesValidate.ts.
 */
import { CARD_ID_RE, GUIDE_LIMITS, SET_ID_RE, SLUG_RE, TRIBE_RE, UUID_RE } from './types';

/** A guide as the save path accepts it, already cleaned. */
export interface GuideDraft {
  /** Null = a new guide. */
  id: string | null;
  /** The revision the editor loaded. Required with `id`. */
  revision: number | null;
  /** Import only. */
  slug: string | null;
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
  forkedFrom: string | null;
}

export type GuideValidation = { ok: true; draft: GuideDraft } | { ok: false; error: 'bad_guide'; field: string };

/** Zero-width and bidi control characters: invisible, and a way to fake an empty or reordered title. */
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/g;

/** One line of clean text: invisible characters removed, every whitespace run one space, trimmed. */
export function cleanText(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** Length in code points, so an emoji counts once. */
const len = (s: string): number => [...s].length;

const fail = (field: string): GuideValidation => ({ ok: false, error: 'bad_guide', field });

/** A list of strings matching `re`, at most `max`, with no repeats. Null when it is not that. */
function list(v: unknown, re: RegExp, max: number): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || !re.test(x) || out.includes(x)) return null;
    out.push(x);
  }
  return out;
}

export function validateGuideDraft(v: unknown, opts: { requireSlug?: boolean } = {}): GuideValidation {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('guide');
  const o = v as Record<string, unknown>;
  const official = o.official === true;

  let id: string | null = null;
  let revision: number | null = null;
  if (o.id !== undefined && o.id !== null) {
    if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) return fail('id');
    id = o.id;
    if (typeof o.revision !== 'number' || !Number.isInteger(o.revision) || o.revision < 1) return fail('revision');
    revision = o.revision;
  }

  let slug: string | null = null;
  if (opts.requireSlug) {
    if (typeof o.slug !== 'string' || !SLUG_RE.test(o.slug)) return fail('slug');
    slug = o.slug;
  }

  const title = cleanText(o.title);
  if (len(title) < 1 || len(title) > GUIDE_LIMITS.title) return fail('title');
  const tagline = cleanText(o.tagline);
  if (len(tagline) > GUIDE_LIMITS.tagline) return fail('tagline');
  const body = cleanText(o.body);
  if (len(body) < 1 || len(body) > GUIDE_LIMITS.body) return fail('body');
  const byline = cleanText(o.byline);
  if (!official && (len(byline) < 1 || len(byline) > GUIDE_LIMITS.byline)) return fail('byline');

  const sets = list(o.sets, SET_ID_RE, GUIDE_LIMITS.sets);
  if (!sets || sets.length < 1) return fail('sets');
  const tribes = list(o.tribes, TRIBE_RE, GUIDE_LIMITS.tribes);
  if (!tribes) return fail('tribes');
  const pairsWith = list(o.pairsWith, TRIBE_RE, GUIDE_LIMITS.pairsWith);
  if (!pairsWith) return fail('pairsWith');

  if (typeof o.iconCard !== 'string' || !CARD_ID_RE.test(o.iconCard)) return fail('iconCard');
  const core = list(o.core, CARD_ID_RE, GUIDE_LIMITS.core);
  if (!core || core.length < 1) return fail('core');
  const enablers = list(o.enablers, CARD_ID_RE, GUIDE_LIMITS.enablers);
  if (!enablers) return fail('enablers');
  const mentions = list(o.mentions, CARD_ID_RE, GUIDE_LIMITS.mentions);
  if (!mentions) return fail('mentions');

  const aliases: Record<string, string> = {};
  if (o.aliases !== undefined && o.aliases !== null) {
    if (typeof o.aliases !== 'object' || Array.isArray(o.aliases)) return fail('aliases');
    const entries = Object.entries(o.aliases as Record<string, unknown>);
    if (entries.length > GUIDE_LIMITS.aliases) return fail('aliases');
    const listed = new Set([...core, ...enablers, ...mentions]);
    for (const [word, target] of entries) {
      const w = cleanText(word);
      if (len(w) < 1 || len(w) > GUIDE_LIMITS.aliasWord) return fail('aliases');
      if (typeof target !== 'string' || !listed.has(target)) return fail('aliases');
      aliases[w] = target;
    }
  }

  let forkedFrom: string | null = null;
  if (o.forkedFrom !== undefined && o.forkedFrom !== null) {
    if (typeof o.forkedFrom !== 'string' || !UUID_RE.test(o.forkedFrom)) return fail('forkedFrom');
    forkedFrom = o.forkedFrom;
  }

  return { ok: true, draft: { id, revision, slug, official, byline, sets, tribes, pairsWith, iconCard: o.iconCard, title, tagline, body, core, enablers, mentions, aliases, forkedFrom } };
}

/** The jsonb document `guide_save` and `guide_import_builtins` read (snake_case keys). */
export function draftToSqlDoc(d: GuideDraft): Record<string, unknown> {
  return {
    id: d.id,
    revision: d.revision,
    slug: d.slug,
    official: d.official,
    byline: d.byline,
    sets: d.sets,
    tribes: d.tribes,
    pairs_with: d.pairsWith,
    icon_card: d.iconCard,
    title: d.title,
    tagline: d.tagline,
    body: d.body,
    core: d.core,
    enablers: d.enablers,
    mentions: d.mentions,
    aliases: d.aliases,
    forked_from: d.forkedFrom,
  };
}
```

`packages/guides/src/index.ts`:
```ts
/**
 * @game/guides public entry. The word list (wordFilter.ts) and the Edge Function's handler (server.ts) are NOT
 * exported here: the client never needs them, and importing them would ship the word list in the player's bundle.
 */
export * from './types';
export * from './validate';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/guides`
Expected: PASS, 2 files.

- [ ] **Step 6: Commit**

```bash
git add packages/guides package-lock.json packages/ui/package.json apps/web/vite.config.ts CLAUDE.md
git commit -m "feat(guides): @game/guides package with wire types, limits and draft validation"
```

---

### Task 2: Word filter and reserved "by" lines

**Files:**
- Create: `packages/guides/src/wordFilter.ts`
- Test: `packages/guides/src/wordFilter.test.ts`

**Interfaces:**
- Consumes: `GuideDraft` from `./validate`.
- Produces: `isBlockedText(text: string): boolean`, `isReservedByline(text: string): boolean`, `guideTextProblem(d: GuideDraft): { error: 'blocked_text' | 'reserved_name'; field: string } | null`.

- [ ] **Step 1: Write the failing test**

`packages/guides/src/wordFilter.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES } from '@game/content';
import { guideTextProblem, isBlockedText, isReservedByline } from './wordFilter';
import { validateGuideDraft } from './validate';

const draft = (patch: Record<string, unknown>) => {
  const r = validateGuideDraft({
    byline: 'Mike', sets: ['set2'], tribes: [], pairsWith: [], iconCard: 'grim', title: 'A title', tagline: 'A tagline',
    body: 'A body.', core: ['grim'], enablers: [], mentions: [], aliases: {}, ...patch,
  });
  if (!r.ok) throw new Error(`bad test draft: ${r.field}`);
  return r.draft;
};

describe('isBlockedText', () => {
  it('blocks a listed word whatever its case, accents, letter swaps or stretched letters', () => {
    for (const s of ['shit', 'SHIT', 'sh1t', '$hit', 'shiiiit', 'shít', 'well shit.']) expect(isBlockedText(s), s).toBe(true);
  });
  it('blocks the strong stems inside a longer word', () => {
    for (const s of ['fucking', 'motherfucker', 'bullshitter']) expect(isBlockedText(s), s).toBe(true);
  });
  it('matches whole words, so innocent words that contain a listed one pass', () => {
    for (const s of ['Scunthorpe', 'cockatrice', 'grape', 'therapist', 'Niger', 'assassin', 'class', 'Dickens']) expect(isBlockedText(s), s).toBe(false);
  });
  it('passes every card and rune name in the game', () => {
    for (const c of Object.values(CARD_INDEX)) expect(isBlockedText(c.name), c.name).toBe(false);
    for (const r of [...RUNES, ...EPIC_RUNES]) expect(isBlockedText(r.name), r.name).toBe(false);
  });
});

describe('isReservedByline', () => {
  it('reserves Team Ascent and its lookalikes, and staff words', () => {
    for (const s of ['Team Ascent', 'team  ascent', 'T3am Asc3nt', 'TeamAscent', 'Ascent Team', 'Ascent Official', 'xX Team Ascent Xx', 'Admin', 'the moderator', 'Developer', 'Official']) expect(isReservedByline(s), s).toBe(true);
  });
  it('leaves ordinary names alone', () => {
    for (const s of ['Mike', 'KC', 'Ascendant', 'Teamwork', 'Dev', 'Administrivia']) expect(isReservedByline(s), s).toBe(false);
  });
});

describe('guideTextProblem', () => {
  it('names the FIELD that was refused, never the word', () => {
    expect(guideTextProblem(draft({ title: 'shit build' }))).toEqual({ error: 'blocked_text', field: 'title' });
    expect(guideTextProblem(draft({ tagline: 'so shit' }))).toEqual({ error: 'blocked_text', field: 'tagline' });
    expect(guideTextProblem(draft({ body: 'this is shit' }))).toEqual({ error: 'blocked_text', field: 'body' });
    expect(guideTextProblem(draft({ byline: 'shit' }))).toEqual({ error: 'blocked_text', field: 'byline' });
    expect(guideTextProblem(draft({ aliases: { shit: 'grim' } }))).toEqual({ error: 'blocked_text', field: 'aliases' });
  });
  it('refuses a reserved by line on a player guide, and skips the by line on an official guide', () => {
    expect(guideTextProblem(draft({ byline: 'Team Ascent' }))).toEqual({ error: 'reserved_name', field: 'byline' });
    expect(guideTextProblem(draft({ official: true, byline: 'Team Ascent' }))).toBeNull();
  });
  it('clean text passes', () => {
    expect(guideTextProblem(draft({}))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/guides/src/wordFilter.test.ts`
Expected: FAIL, cannot resolve `./wordFilter`.

- [ ] **Step 3: Implement**

`packages/guides/src/wordFilter.ts`:
```ts
/**
 * GUIDES: the word filter and the reserved "by" lines (spec section 3). The game's first word filter.
 *
 * It is deliberately basic: whole-word matching after normalising case, accents, common letter swaps and stretched
 * letters, plus a few strong stems matched inside longer words. It is not a defence against a determined author;
 * Report and Hide (step 4) are. The owner reviews WORDS before publishing ships (step 3).
 *
 * Server and tests only: NOT exported from index.ts, so the list never ships in the player's bundle.
 * Dependency-free. Generated VERBATIM into supabase/functions/_shared/guidesWordFilter.ts.
 */
import type { GuideDraft } from './validate';

/** Matched as a whole word. */
const WORDS: readonly string[] = [
  'shit', 'shitty', 'cunt', 'bitch', 'asshole', 'dick', 'cock', 'pussy', 'whore', 'slut', 'bastard', 'retard', 'rape', 'rapist',
  'nigga', 'kike', 'spic', 'chink', 'tranny', 'nazi', 'hitler',
];
/** Matched anywhere inside a word: stems that do not occur inside innocent words. */
const STEMS: readonly string[] = ['fuck', 'nigger', 'faggot', 'bullshit'];

const SWAPS: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };

/** Lower case, accents stripped, letter swaps undone. */
const fold = (text: string): string =>
  text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[013457@$!]/g, (c) => SWAPS[c] ?? c);

/** The words of a text: runs of a to z. */
const tokens = (text: string): string[] => fold(text).split(/[^a-z]+/).filter(Boolean);

/** "shiiiit" -> "shiit": runs of three or more become two. */
const squeeze2 = (s: string): string => s.replace(/(.)\1{2,}/g, '$1$1');
/** "shiit" -> "shit": every run becomes one. */
const squeeze1 = (s: string): string => s.replace(/(.)\1+/g, '$1');

const hasDouble = (s: string): boolean => /(.)\1/.test(s);
const WORD_SET: ReadonlySet<string> = new Set(WORDS);
/** Listed words with no doubled letter may also be matched fully squeezed ("shiit"). A word WITH a doubled letter
 *  is not, or "Niger" would match a longer listed word once both are squeezed. */
const WORD_SET_SQUEEZED: ReadonlySet<string> = new Set(WORDS.filter((w) => !hasDouble(w)));

export function isBlockedText(text: string): boolean {
  for (const t of tokens(text)) {
    const two = squeeze2(t);
    const one = squeeze1(t);
    if (WORD_SET.has(two) || WORD_SET_SQUEEZED.has(one)) return true;
    // A stem with a doubled letter is only matched un-squeezed, for the same reason as WORD_SET_SQUEEZED.
    for (const stem of STEMS) if (two.includes(stem) || (!hasDouble(stem) && one.includes(stem))) return true;
  }
  return false;
}

const RESERVED_PHRASES: readonly string[] = ['teamascent', 'ascentteam', 'ascentofficial'];
const RESERVED_WORDS: ReadonlySet<string> = new Set(['admin', 'moderator', 'developer', 'official']);

/** True when a "by" line would pass a guide off as the team's, or as staff. */
export function isReservedByline(text: string): boolean {
  const toks = tokens(text);
  const joined = toks.join('');
  if (RESERVED_PHRASES.some((p) => joined.includes(p))) return true;
  return toks.some((t) => RESERVED_WORDS.has(t));
}

/** The first text rule a draft breaks, naming the field (never the word), or null. */
export function guideTextProblem(d: GuideDraft): { error: 'blocked_text' | 'reserved_name'; field: string } | null {
  if (isBlockedText(d.title)) return { error: 'blocked_text', field: 'title' };
  if (isBlockedText(d.tagline)) return { error: 'blocked_text', field: 'tagline' };
  if (isBlockedText(d.body)) return { error: 'blocked_text', field: 'body' };
  if (Object.keys(d.aliases).some(isBlockedText)) return { error: 'blocked_text', field: 'aliases' };
  if (!d.official) {
    if (isBlockedText(d.byline)) return { error: 'blocked_text', field: 'byline' };
    if (isReservedByline(d.byline)) return { error: 'reserved_name', field: 'byline' };
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/guides/src/wordFilter.test.ts`
Expected: PASS. If "passes every card and rune name" fails, the failure message names the card: the fix is to remove or narrow the colliding entry in `WORDS` / `STEMS`, never to rename the card, and to say so in the PR body.

- [ ] **Step 5: Commit**

```bash
git add packages/guides/src/wordFilter.ts packages/guides/src/wordFilter.test.ts
git commit -m "feat(guides): word filter and reserved by lines"
```

---

### Task 3: The carry-over rule

**Files:**
- Create: `packages/guides/src/sets.ts`
- Modify: `packages/guides/src/index.ts`
- Test: `packages/guides/src/sets.test.ts`

**Interfaces:**
- Produces: `SetFacts { id: string; cardIds: ReadonlySet<string>; tribes: readonly string[] }`, `GuideCards { core; enablers; mentions?; tribes; pairsWith? }`, `guideSetsFor(g: GuideCards, sets: readonly SetFacts[]): string[]`.

- [ ] **Step 1: Write the failing test**

`packages/guides/src/sets.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { guideSetsFor, type SetFacts } from './sets';

const SETS: SetFacts[] = [
  { id: 'set2', cardIds: new Set(['a', 'b', 'c', 'spell']), tribes: ['beast', 'dwarf'] },
  { id: 'set3', cardIds: new Set(['a', 'b', 'spell']), tribes: ['beast', 'spirit'] },
];
const g = { core: ['a'], enablers: ['b'], mentions: ['spell'], tribes: ['beast'], pairsWith: [] };

describe('guideSetsFor (owner 2026-10-11: "any guides that still have all referenced cards can carry over")', () => {
  it('a guide whose every card and tribe exists in a set belongs to it', () => {
    expect(guideSetsFor(g, SETS)).toEqual(['set2', 'set3']);
  });
  it('one missing Core, Enabler or named card keeps it out of that set', () => {
    expect(guideSetsFor({ ...g, core: ['a', 'c'] }, SETS)).toEqual(['set2']);
    expect(guideSetsFor({ ...g, enablers: ['c'] }, SETS)).toEqual(['set2']);
    expect(guideSetsFor({ ...g, mentions: ['c'] }, SETS)).toEqual(['set2']);
  });
  it('a tribe or a pairs-with tribe missing from the roster keeps it out', () => {
    expect(guideSetsFor({ ...g, tribes: ['dwarf'] }, SETS)).toEqual(['set2']);
    expect(guideSetsFor({ ...g, pairsWith: ['spirit'] }, SETS)).toEqual(['set3']);
  });
  it('a Neutral guide (no tribes) only needs its cards', () => {
    expect(guideSetsFor({ ...g, tribes: [] }, SETS)).toEqual(['set2', 'set3']);
  });
  it('a card in no set belongs nowhere', () => {
    expect(guideSetsFor({ ...g, core: ['ghost'] }, SETS)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/guides/src/sets.test.ts`
Expected: FAIL, cannot resolve `./sets`.

- [ ] **Step 3: Implement**

`packages/guides/src/sets.ts`:
```ts
/**
 * GUIDES: which sets a guide shows in (spec section 5; owner 2026-10-11: "any guides that still have all referenced
 * cards can carry over").
 *
 * A guide belongs in set S when every Core card, every Enabler and every card named in the write-up is in S's
 * pool, and its tribes and "pairs with" tribe are on S's roster. The ART ICON does not count: it may be any card
 * with art, a token included (the Imps guide wears `impscrap`, which is in no set's pool).
 *
 * Client only (the server does not know the card list). Pure: the caller supplies the pools.
 */
export interface SetFacts {
  id: string;
  cardIds: ReadonlySet<string>;
  tribes: readonly string[];
}

export interface GuideCards {
  core: readonly string[];
  enablers: readonly string[];
  mentions?: readonly string[];
  tribes: readonly string[];
  pairsWith?: readonly string[];
}

export function guideSetsFor(g: GuideCards, sets: readonly SetFacts[]): string[] {
  const ids = [...g.core, ...g.enablers, ...(g.mentions ?? [])];
  const tribes = [...g.tribes, ...(g.pairsWith ?? [])];
  return sets.filter((s) => ids.every((id) => s.cardIds.has(id)) && tribes.every((t) => s.tribes.includes(t))).map((s) => s.id);
}
```

Append to `packages/guides/src/index.ts`:
```ts
export * from './sets';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/guides/src/sets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/guides/src/sets.ts packages/guides/src/sets.test.ts packages/guides/src/index.ts
git commit -m "feat(guides): the set carry-over rule"
```

---

### Task 4: The database: tables, row-level security, write functions

**Files:**
- Create: `supabase/migrations/2026-10-12-guides.sql`
- Modify: `schema.sql` (append the same block)
- Test: `packages/guides/src/guides.db.test.ts`

**Interfaces:**
- Produces (service role only): `public.guide_save(p_user uuid, p_doc jsonb) returns jsonb` (the saved row), `public.guide_delete(p_user uuid, p_id uuid) returns jsonb` (`{ "deleted": "<id>" }`), `public.guide_import_builtins(p_user uuid, p_docs jsonb) returns jsonb` (`{ "inserted": n, "skipped": m }`). Raised error codes: `unauthenticated`, `not_allowed`, `not_found`, `conflict`, `too_many_guides`, `rate_limited`.
- Produces (readable): table `public.guides` under the policy in the migration; `public.is_guide_team()`.

- [ ] **Step 1: Write the failing test**

`packages/guides/src/guides.db.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE GUIDES SQL, EXECUTED. PGlite runs the migration (twice: it must re-run cleanly), then drives the three write
 * functions as the Edge Function does (service role) and reads the table as the REST API does (the `anon` /
 * `authenticated` role with the caller's id in the JWT claim). Pins spec section 1's permission table at the row
 * level: who reads what, who may write what, the 20-guide cap, the 30-per-hour rate limit and edit conflicts.
 */
const root = join(__dirname, '../../..');
const MIGRATION = readFileSync(join(root, 'supabase/migrations/2026-10-12-guides.sql'), 'utf8');

const STUB = `
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
`;

const TEAM = '00000000-0000-0000-0000-00000000000a';
const ALICE = '00000000-0000-0000-0000-00000000000b';
const BOB = '00000000-0000-0000-0000-00000000000c';
const SPAM = '00000000-0000-0000-0000-00000000000d';
let db: PGlite;

const doc = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  official: false, byline: 'Alice', sets: ['set2'], tribes: ['beast'], pairs_with: [], icon_card: 'grim', title: 'T', tagline: '',
  body: 'B', core: ['grim'], enablers: [], mentions: [], aliases: {}, forked_from: null, ...patch,
});

type Row = Record<string, unknown>;
/** Call a write function as the service role (the connection's own superuser stands in for it). */
const save = async (user: string, d: Record<string, unknown>): Promise<Row> =>
  (await db.query<{ r: Row }>('select public.guide_save($1::uuid, $2::jsonb) as r', [user, JSON.stringify(d)])).rows[0]!.r;
const err = async (p: Promise<unknown>): Promise<string> => p.then(() => 'no error', (e) => String((e as Error).message));

/** Run a statement the way the REST API does: as `role`, with `user` in the JWT claim. */
async function asRole<T = Row>(role: 'anon' | 'authenticated', user: string | null, sql: string): Promise<T[] | string> {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
    await db.exec(`set local role ${role}`);
    const rows = (await db.query<T>(sql)).rows;
    await db.exec('commit');
    return rows;
  } catch (e) {
    await db.exec('rollback');
    return String((e as Error).message);
  }
}
const titlesSeenBy = async (role: 'anon' | 'authenticated', user: string | null): Promise<string[]> => {
  const rows = await asRole<{ title: string }>(role, user, 'select title from public.guides order by title');
  if (typeof rows === 'string') throw new Error(rows);
  return rows.map((r) => r.title);
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // re-runs cleanly
  for (const u of [TEAM, ALICE, BOB, SPAM]) await db.query('insert into auth.users (id) values ($1)', [u]);
  await db.query('insert into public.guide_team (user_id) values ($1)', [TEAM]);
  // Supabase grants the API roles every table privilege by default; row level security is what holds the line.
  await db.exec('grant select, insert, update, delete on all tables in schema public to anon, authenticated;');
}, 60_000);
afterAll(async () => { await db.close(); });

describe('guide_save', () => {
  it('a player creates a PRIVATE guide: not official, not published, revision 1, their by line', async () => {
    const r = await save(ALICE, doc({ title: 'Alice private' }));
    expect(r).toMatchObject({ author_id: ALICE, byline: 'Alice', official: false, published: false, hidden: false, revision: 1, title: 'Alice private' });
  });

  it('a non-team account can never create an official guide', async () => {
    expect(await err(save(ALICE, doc({ official: true })))).toMatch(/not_allowed/);
  });

  it('a team member creates an official guide: by line forced to Team Ascent, public, appended in order', async () => {
    const a = await save(TEAM, doc({ official: true, byline: 'ignored', title: 'Official A' }));
    const b = await save(TEAM, doc({ official: true, title: 'Official B' }));
    expect(a).toMatchObject({ official: true, published: true, byline: 'Team Ascent' });
    expect(Number(b.sort_order)).toBe(Number(a.sort_order) + 1);
  });

  it('an update needs the revision it loaded, bumps it, and a stale one is a conflict', async () => {
    const r = await save(ALICE, doc({ title: 'Rev' }));
    const r2 = await save(ALICE, doc({ id: r.id, revision: 1, title: 'Rev 2' }));
    expect(r2).toMatchObject({ title: 'Rev 2', revision: 2 });
    expect(await err(save(ALICE, doc({ id: r.id, revision: 1, title: 'stale' })))).toMatch(/conflict/);
  });

  it('only the author may update a player guide; only the team may update an official one', async () => {
    const mine = await save(ALICE, doc({ title: 'Mine' }));
    expect(await err(save(BOB, doc({ id: mine.id, revision: 1 })))).toMatch(/not_allowed/);
    expect(await err(save(TEAM, doc({ id: mine.id, revision: 1 })))).toMatch(/not_allowed/); // the team hides or deletes; it does not rewrite a player's guide
    const off = await save(TEAM, doc({ official: true, title: 'Official C' }));
    expect(await err(save(ALICE, doc({ id: off.id, revision: 1, official: true })))).toMatch(/not_allowed/);
    expect(await err(save(ALICE, doc({ id: off.id, revision: 1 })))).toMatch(/not_allowed/);
    expect(await save(TEAM, doc({ id: off.id, revision: 1, official: true, title: 'Official C2' }))).toMatchObject({ title: 'Official C2', byline: 'Team Ascent' });
  });

  it('a save never flips a guide between official and player', async () => {
    const off = await save(TEAM, doc({ official: true, title: 'Flip' }));
    expect(await err(save(TEAM, doc({ id: off.id, revision: 1, official: false })))).toMatch(/not_allowed/);
  });

  it('an unknown id is not_found', async () => {
    expect(await err(save(ALICE, doc({ id: '99999999-9999-4999-8999-999999999999', revision: 1 })))).toMatch(/not_found/);
  });

  it('a duplicate snapshots the source title and by line, and only from a guide the caller can read', async () => {
    const off = await save(TEAM, doc({ official: true, title: 'Source' }));
    const copy = await save(BOB, doc({ byline: 'Bob', forked_from: off.id }));
    expect(copy).toMatchObject({ forked_from: off.id, forked_title: 'Source', forked_byline: 'Team Ascent' });
    const secret = await save(ALICE, doc({ title: 'Alice secret' }));
    const sneaky = await save(BOB, doc({ byline: 'Bob', forked_from: secret.id }));
    expect(sneaky).toMatchObject({ forked_from: null, forked_title: null });
  });

  it('a player may own at most 20 guides; official guides do not count', async () => {
    for (let i = 0; i < 20; i++) await save(SPAM, doc({ byline: 'Spam', title: `S${i}` }));
    expect(await err(save(SPAM, doc({ byline: 'Spam', title: 'S20' })))).toMatch(/too_many_guides/);
  });

  it('30 saves an hour, then rate_limited (SPAM has made 20)', async () => {
    const first = (await db.query<Row>('select id, revision from public.guides where author_id = $1 order by created_at limit 1', [SPAM])).rows[0]!;
    let rev = Number(first.revision);
    for (let i = 0; i < 10; i++) rev = Number((await save(SPAM, doc({ id: first.id, revision: rev, byline: 'Spam' }))).revision);
    expect(await err(save(SPAM, doc({ id: first.id, revision: rev, byline: 'Spam' })))).toMatch(/rate_limited/);
  });
});

describe('who can read a guide', () => {
  let hiddenId: unknown;
  beforeAll(async () => {
    const pub = await save(ALICE, doc({ title: 'Alice public' }));
    const hid = await save(ALICE, doc({ title: 'Alice hidden' }));
    hiddenId = hid.id;
    // Publishing and hiding get their own functions in later steps; set the flags directly here.
    await db.query('update public.guides set published = true where id = any($1::uuid[])', [[pub.id, hid.id]]);
    await db.query('update public.guides set hidden = true where id = $1', [hid.id]);
  });

  it('everyone reads official and published guides; a private or hidden one only its author and the team', async () => {
    const bob = await titlesSeenBy('authenticated', BOB);
    expect(bob).toContain('Official A');
    expect(bob).toContain('Alice public');
    expect(bob).not.toContain('Alice private');
    expect(bob).not.toContain('Alice hidden');
    const alice = await titlesSeenBy('authenticated', ALICE);
    expect(alice).toEqual(expect.arrayContaining(['Alice private', 'Alice hidden', 'Alice public']));
    const team = await titlesSeenBy('authenticated', TEAM);
    expect(team).toEqual(expect.arrayContaining(['Alice private', 'Alice hidden']));
    const anon = await titlesSeenBy('anon', null);
    expect(anon).toContain('Official A');
    expect(anon).not.toContain('Alice private');
  });

  it('no client can write the table or call a write function', async () => {
    await asRole('authenticated', BOB, "update public.guides set title = 'hacked'");
    await asRole('authenticated', BOB, 'delete from public.guides');
    await asRole('authenticated', BOB, `insert into public.guides (author_id, byline, icon_card, title, body, core) values ('${BOB}', 'Bob', 'grim', 'Sneak', 'B', '{grim}')`);
    const all = (await db.query<{ title: string }>('select title from public.guides')).rows.map((r) => r.title);
    expect(all).not.toContain('hacked');
    expect(all).not.toContain('Sneak');
    expect(all).toContain('Official A');
    expect(await asRole('authenticated', BOB, `select public.guide_save('${BOB}'::uuid, '{}'::jsonb)`)).toMatch(/permission denied/);
    expect(await asRole('authenticated', BOB, `select public.guide_delete('${BOB}'::uuid, '${String(hiddenId)}'::uuid)`)).toMatch(/permission denied/);
    expect(await asRole('authenticated', BOB, `select public.guide_import_builtins('${BOB}'::uuid, '[]'::jsonb)`)).toMatch(/permission denied/);
  });

  it('a player learns only their own team membership', async () => {
    expect(await asRole('authenticated', TEAM, 'select user_id from public.guide_team')).toHaveLength(1);
    expect(await asRole('authenticated', BOB, 'select user_id from public.guide_team')).toHaveLength(0);
  });
});

describe('guide_delete', () => {
  const del = (user: string, id: unknown): Promise<unknown> => db.query('select public.guide_delete($1::uuid, $2::uuid)', [user, id]);
  it('the author deletes their own; another player cannot; the team can delete anyone\'s', async () => {
    const a = await save(ALICE, doc({ title: 'Del A' }));
    const b = await save(ALICE, doc({ title: 'Del B' }));
    expect(await err(del(BOB, a.id))).toMatch(/not_allowed/);
    expect(await err(del(ALICE, a.id))).toBe('no error');
    expect(await err(del(TEAM, b.id))).toBe('no error');
    expect(await err(del(ALICE, a.id))).toMatch(/not_found/);
  });
  it('only the team deletes an official guide', async () => {
    const off = await save(TEAM, doc({ official: true, title: 'Del Official' }));
    expect(await err(del(ALICE, off.id))).toMatch(/not_allowed/);
    expect(await err(del(TEAM, off.id))).toBe('no error');
  });
});

describe('guide_import_builtins', () => {
  const imp = async (user: string, docs: unknown[]): Promise<Row> =>
    (await db.query<{ r: Row }>('select public.guide_import_builtins($1::uuid, $2::jsonb) as r', [user, JSON.stringify(docs)])).rows[0]!.r;
  const docs = [doc({ slug: 'set2-one', title: 'One' }), doc({ slug: 'set2-two', title: 'Two' })];

  it('team only', async () => {
    expect(await err(imp(ALICE, docs))).toMatch(/not_allowed/);
  });
  it('inserts each built-in once as an official guide, in the order given', async () => {
    expect(await imp(TEAM, docs)).toEqual({ inserted: 2, skipped: 0 });
    const rows = (await db.query<Row>("select slug, official, published, byline, sort_order from public.guides where slug like 'set2-%' order by sort_order")).rows;
    expect(rows.map((r) => r.slug)).toEqual(['set2-one', 'set2-two']);
    expect(rows[0]).toMatchObject({ official: true, published: true, byline: 'Team Ascent' });
  });
  it('pressing it twice changes nothing, and never overwrites a guide the team has edited since', async () => {
    await db.query("update public.guides set title = 'One, edited' where slug = 'set2-one'");
    expect(await imp(TEAM, docs)).toEqual({ inserted: 0, skipped: 2 });
    expect((await db.query<Row>("select title from public.guides where slug = 'set2-one'")).rows[0]!.title).toBe('One, edited');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/guides/src/guides.db.test.ts`
Expected: FAIL, `ENOENT ... 2026-10-12-guides.sql`.

- [ ] **Step 3: Write the migration**

`supabase/migrations/2026-10-12-guides.sql`:
```sql
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- GUIDES ON THE SERVER: Team Ascent guides, player guides, the write functions  (2026-10-12)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent: safe to re-run. Depends on nothing but auth.users.
-- The same block is appended to schema.sql; keep the two identical.
-- Spec: docs/superpowers/specs/2026-10-11-community-guides-design.md. Devlog: docs/devlog/2026-10-12-guides-storage.md.
--
-- WHY (owner 2026-10-11: "i'd like the ability to edit existing guides while in game and save them. The existing
-- [guides] are written by 'Team Ascent' and should only be able to be modified by myself and KC. outside of that,
-- one should be able to create a new guide either from scratch or by duplicating an existing guide"): guides were
-- fixed data in the client. They move here so an edit reaches every player on their next load.
--
-- WHAT
--  - `guide_team`: the accounts that may edit Team Ascent guides. A player can read only their own row.
--  - `guides`: every guide. READ: official, or published and not hidden, or your own, or you are on the team.
--    WRITE: no client policy at all. The three functions below, callable only by the service role (the
--    `guide-write` Edge Function), are the only writers.
--  - `guide_bookmarks`, `guide_reports`: created now so later steps add functions, not tables.
--  - `guide_writes`: one row per save, for the 30-per-hour rate limit.
--  - `guide_save`, `guide_delete`, `guide_import_builtins`: the row rules (ownership, official = team only, the
--    20-guide cap, the rate limit, edit conflicts). The text rules (limits, word filter) are the Edge Function's.
--
-- AFTER RUNNING: add the team, ONCE, with the two real emails typed here and NOT committed anywhere:
--   insert into public.guide_team (user_id) select id from auth.users where email in ('<mike>', '<kc>')
--   on conflict do nothing;
-- A client from before this file ignores these tables. A client from after it, talking to a database from before
-- it, gets "relation does not exist", treats guides as switched off, and shows its built-in guides.

begin;

create table if not exists public.guide_team (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.guide_team enable row level security;
drop policy if exists "read own guide_team" on public.guide_team;
create policy "read own guide_team" on public.guide_team for select to authenticated using (auth.uid() = user_id);

create or replace function public.is_guide_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.guide_team where user_id = auth.uid());
$$;
revoke all on function public.is_guide_team() from public;
grant execute on function public.is_guide_team() to anon, authenticated, service_role;

create table if not exists public.guides (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique,                                             -- imported built-ins only
  author_id      uuid references auth.users(id) on delete set null,       -- set null: a team member leaving must not delete Team Ascent guides
  byline         text not null,
  official       boolean not null default false,
  published      boolean not null default false,
  published_at   timestamptz,
  hidden         boolean not null default false,
  hidden_by      uuid,
  hidden_at      timestamptz,
  sets           text[] not null default '{}',
  tribes         text[] not null default '{}',
  pairs_with     text[] not null default '{}',
  icon_card      text not null,
  title          text not null,
  tagline        text not null default '',
  body           text not null,
  core           text[] not null,
  enablers       text[] not null default '{}',
  mentions       text[] not null default '{}',
  aliases        jsonb not null default '{}'::jsonb,
  forked_from    uuid references public.guides(id) on delete set null,
  forked_title   text,
  forked_byline  text,
  bookmark_count int not null default 0,
  sort_order     int not null default 0,
  revision       int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid
);
create index if not exists guides_sets on public.guides using gin (sets);
create index if not exists guides_author on public.guides (author_id);
create index if not exists guides_official on public.guides (sort_order) where official;

alter table public.guides enable row level security;
drop policy if exists "read guides" on public.guides;
create policy "read guides" on public.guides for select to anon, authenticated
  using (official or (published and not hidden) or author_id = auth.uid() or public.is_guide_team());

create table if not exists public.guide_bookmarks (
  user_id    uuid not null references auth.users(id) on delete cascade,
  guide_id   uuid not null references public.guides(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, guide_id)
);
alter table public.guide_bookmarks enable row level security;
drop policy if exists "read own guide_bookmarks" on public.guide_bookmarks;
create policy "read own guide_bookmarks" on public.guide_bookmarks for select to authenticated using (auth.uid() = user_id);

create table if not exists public.guide_reports (
  id          uuid primary key default gen_random_uuid(),
  guide_id    uuid not null references public.guides(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason      text not null check (reason in ('offensive', 'spam', 'impersonation', 'other')),
  note        text not null default '',
  status      text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (guide_id, reporter_id)
);
alter table public.guide_reports enable row level security;
drop policy if exists "team reads guide_reports" on public.guide_reports;
create policy "team reads guide_reports" on public.guide_reports for select to authenticated using (public.is_guide_team());

create table if not exists public.guide_writes (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists guide_writes_user_at on public.guide_writes (user_id, at desc);
alter table public.guide_writes enable row level security; -- no policy: the service role only

-- A jsonb array of strings as text[], order kept. Anything that is not an array is the empty list.
create or replace function public.guide_text_array(j jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(x order by n), '{}'::text[])
  from jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end) with ordinality as t(x, n);
$$;

create or replace function public.guide_save(p_user uuid, p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team     boolean;
  v_id       uuid := nullif(p_doc->>'id', '')::uuid;
  v_official boolean := coalesce((p_doc->>'official')::boolean, false);
  v_fork     uuid := nullif(p_doc->>'forked_from', '')::uuid;
  v_ftitle   text;
  v_fbyline  text;
  v_row      public.guides;
  v_count    int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  v_team := exists (select 1 from public.guide_team where user_id = p_user);
  if v_official and not v_team then raise exception 'not_allowed'; end if;

  select count(*) into v_count from public.guide_writes where user_id = p_user and at > now() - interval '1 hour';
  if v_count >= 30 then raise exception 'rate_limited'; end if;

  if v_id is null then
    if not v_official then
      select count(*) into v_count from public.guides where author_id = p_user and not official;
      if v_count >= 20 then raise exception 'too_many_guides'; end if;
    end if;
    if v_fork is not null then
      select title, byline into v_ftitle, v_fbyline from public.guides
       where id = v_fork and (official or (published and not hidden) or author_id = p_user);
      if not found then v_fork := null; v_ftitle := null; v_fbyline := null; end if;
    end if;
    insert into public.guides (author_id, byline, official, published, published_at, sets, tribes, pairs_with, icon_card,
                               title, tagline, body, core, enablers, mentions, aliases,
                               forked_from, forked_title, forked_byline, sort_order, updated_by)
    values (p_user,
            case when v_official then 'Team Ascent' else p_doc->>'byline' end,
            v_official, v_official, case when v_official then now() end,
            public.guide_text_array(p_doc->'sets'), public.guide_text_array(p_doc->'tribes'), public.guide_text_array(p_doc->'pairs_with'),
            p_doc->>'icon_card', p_doc->>'title', coalesce(p_doc->>'tagline', ''), p_doc->>'body',
            public.guide_text_array(p_doc->'core'), public.guide_text_array(p_doc->'enablers'), public.guide_text_array(p_doc->'mentions'),
            coalesce(p_doc->'aliases', '{}'::jsonb),
            v_fork, v_ftitle, v_fbyline,
            case when v_official then (select coalesce(max(sort_order), -1) + 1 from public.guides where official) else 0 end,
            p_user)
    returning * into v_row;
  else
    select * into v_row from public.guides where id = v_id for update;
    if not found then raise exception 'not_found'; end if;
    if v_row.official then
      if not v_team then raise exception 'not_allowed'; end if;
    elsif v_row.author_id is distinct from p_user then
      raise exception 'not_allowed';
    end if;
    if v_official <> v_row.official then raise exception 'not_allowed'; end if; -- a save never flips official
    if (p_doc->>'revision')::int is distinct from v_row.revision then raise exception 'conflict'; end if;
    update public.guides set
      byline     = case when v_row.official then 'Team Ascent' else p_doc->>'byline' end,
      sets       = public.guide_text_array(p_doc->'sets'),
      tribes     = public.guide_text_array(p_doc->'tribes'),
      pairs_with = public.guide_text_array(p_doc->'pairs_with'),
      icon_card  = p_doc->>'icon_card',
      title      = p_doc->>'title',
      tagline    = coalesce(p_doc->>'tagline', ''),
      body       = p_doc->>'body',
      core       = public.guide_text_array(p_doc->'core'),
      enablers   = public.guide_text_array(p_doc->'enablers'),
      mentions   = public.guide_text_array(p_doc->'mentions'),
      aliases    = coalesce(p_doc->'aliases', '{}'::jsonb),
      revision   = v_row.revision + 1,
      updated_at = now(),
      updated_by = p_user
    where id = v_id
    returning * into v_row;
  end if;

  insert into public.guide_writes (user_id) values (p_user);
  return to_jsonb(v_row);
end $$;

create or replace function public.guide_delete(p_user uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team boolean;
  v_row  public.guides;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  v_team := exists (select 1 from public.guide_team where user_id = p_user);
  select * into v_row from public.guides where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if not v_team and (v_row.official or v_row.author_id is distinct from p_user) then raise exception 'not_allowed'; end if;
  delete from public.guides where id = p_id;
  return jsonb_build_object('deleted', p_id);
end $$;

create or replace function public.guide_import_builtins(p_user uuid, p_docs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_doc  jsonb;
  v_n    bigint;
  v_in   int := 0;
  v_skip int := 0;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.guide_team where user_id = p_user) then raise exception 'not_allowed'; end if;
  for v_doc, v_n in select value, ordinality from jsonb_array_elements(case when jsonb_typeof(p_docs) = 'array' then p_docs else '[]'::jsonb end) with ordinality loop
    if coalesce(v_doc->>'slug', '') = '' then v_skip := v_skip + 1; continue; end if;
    insert into public.guides (slug, author_id, byline, official, published, published_at, sets, tribes, pairs_with, icon_card,
                               title, tagline, body, core, enablers, mentions, aliases, sort_order, updated_by)
    values (v_doc->>'slug', p_user, 'Team Ascent', true, true, now(),
            public.guide_text_array(v_doc->'sets'), public.guide_text_array(v_doc->'tribes'), public.guide_text_array(v_doc->'pairs_with'),
            v_doc->>'icon_card', v_doc->>'title', coalesce(v_doc->>'tagline', ''), v_doc->>'body',
            public.guide_text_array(v_doc->'core'), public.guide_text_array(v_doc->'enablers'), public.guide_text_array(v_doc->'mentions'),
            coalesce(v_doc->'aliases', '{}'::jsonb), (v_n - 1)::int, p_user)
    on conflict (slug) do nothing;
    if found then v_in := v_in + 1; else v_skip := v_skip + 1; end if;
  end loop;
  return jsonb_build_object('inserted', v_in, 'skipped', v_skip);
end $$;

revoke all on function public.guide_save(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.guide_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guide_import_builtins(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.guide_save(uuid, jsonb) to service_role;
grant execute on function public.guide_delete(uuid, uuid) to service_role;
grant execute on function public.guide_import_builtins(uuid, jsonb) to service_role;

commit;

-- Tell the REST API about the new tables and functions.
notify pgrst, 'reload schema';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/guides/src/guides.db.test.ts`
Expected: PASS. A PGlite-specific failure on `notify` or `gen_random_uuid()` would be an environment difference, not a design error: report it rather than editing the SQL to suit PGlite, since the existing progression migrations use the same statements.

- [ ] **Step 5: Append the same block to `schema.sql` and verify the two match**

Append the migration file's full text to the end of `schema.sql`, preceded by one blank line.

Run:
```bash
node -e "const f=require('fs');const n=s=>s.replace(/\r\n/g,'\n').trim();const m=n(f.readFileSync('supabase/migrations/2026-10-12-guides.sql','utf8'));process.exit(n(f.readFileSync('schema.sql','utf8')).endsWith(m)?0:1)" && echo SAME
```
Expected: `SAME`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/2026-10-12-guides.sql schema.sql packages/guides/src/guides.db.test.ts
git commit -m "feat(guides): guides tables, row level security and the write functions"
```

---

### Task 5: The write handler, its Deno copy, and the Edge Function

**Files:**
- Create: `packages/guides/src/server.ts`, `packages/guides/src/sharedArtifact.ts`, `packages/tools/src/guides-shared.ts`, `supabase/functions/guide-write/index.ts`
- Create (generated): `supabase/functions/_shared/guidesTypes.ts`, `guidesValidate.ts`, `guidesWordFilter.ts`, `guidesServer.ts`
- Modify: `package.json` (script)
- Test: `packages/guides/src/server.test.ts`, `packages/guides/src/sharedArtifact.test.ts`

**Interfaces:**
- Consumes: `validateGuideDraft`, `draftToSqlDoc` (Task 1); `guideTextProblem` (Task 2); `parseGuideRecord`, `GUIDE_LIMITS` (Task 1); the SQL functions (Task 4).
- Produces: `RpcCall`, `HandlerResponse`, `GUIDE_ERROR_STATUS`, `handleGuideWrite(userId: string | null, anonymous: boolean, body: unknown, rpc: RpcCall, log?: (msg: string, detail?: unknown) => void): Promise<HandlerResponse>`. Request bodies: `{ op: 'save', guide }` → 200 `{ guide: GuideRecord }`; `{ op: 'delete', id }` → 200 `{ deleted: id }`; `{ op: 'importBuiltIns', guides: [...] }` → 200 `{ inserted, skipped }`.

- [ ] **Step 1: Write the failing handler test**

`packages/guides/src/server.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { handleGuideWrite, type RpcCall } from './server';

const UID = '00000000-0000-0000-0000-00000000000b';
const GID = '11111111-1111-4111-8111-111111111111';
const good = {
  byline: 'Mike', sets: ['set2'], tribes: ['beast'], pairsWith: [], iconCard: 'grim', title: 'A title', tagline: '',
  body: 'A body.', core: ['grim'], enablers: [], mentions: [], aliases: {},
};
const row = { id: GID, title: 'A title', body: 'A body.', icon_card: 'grim', core: ['grim'], revision: 1, byline: 'Mike' };

/** A fake service-role RPC that records what it was asked. */
function fake(answer: { data?: unknown; error?: { message: string } | null } | (() => never) = { data: row, error: null }): { rpc: RpcCall; calls: Array<{ fn: string; args: Record<string, unknown> }> } {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rpc: RpcCall = async (fn, args) => {
    calls.push({ fn, args });
    if (typeof answer === 'function') return answer();
    return { data: answer.data ?? null, error: answer.error ?? null };
  };
  return { rpc, calls };
}

describe('handleGuideWrite: who', () => {
  it('no verified user is 401; a guest is 403 sign_in_required; neither touches the database', async () => {
    const f = fake();
    expect(await handleGuideWrite(null, false, { op: 'save', guide: good }, f.rpc)).toEqual({ status: 401, body: { error: 'unauthenticated' } });
    expect(await handleGuideWrite(UID, true, { op: 'save', guide: good }, f.rpc)).toEqual({ status: 403, body: { error: 'sign_in_required' } });
    expect(f.calls).toEqual([]);
  });
  it('a body that is not an object, or names no known op, is 400', async () => {
    const f = fake();
    expect((await handleGuideWrite(UID, false, 'nope', f.rpc)).body).toEqual({ error: 'bad_body' });
    expect((await handleGuideWrite(UID, false, { op: 'publishEverything' }, f.rpc)).body).toEqual({ error: 'bad_op' });
    expect(f.calls).toEqual([]);
  });
});

describe('handleGuideWrite: save', () => {
  it('passes the caller from the token and the cleaned document to guide_save, and returns the saved guide', async () => {
    const f = fake();
    const res = await handleGuideWrite(UID, false, { op: 'save', guide: { ...good, title: '  A   title ', authorId: 'someone-else' } }, f.rpc);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.fn).toBe('guide_save');
    expect(f.calls[0]!.args.p_user).toBe(UID);
    expect(f.calls[0]!.args.p_doc).toMatchObject({ title: 'A title', icon_card: 'grim', official: false });
    expect(f.calls[0]!.args.p_doc).not.toHaveProperty('authorId');
    expect(res).toMatchObject({ status: 200, body: { guide: { id: GID, title: 'A title' } } });
  });
  it('a draft over a limit is 422 bad_guide with the field, before the database', async () => {
    const f = fake();
    expect(await handleGuideWrite(UID, false, { op: 'save', guide: { ...good, title: 'x'.repeat(41) } }, f.rpc)).toEqual({ status: 422, body: { error: 'bad_guide', field: 'title' } });
    expect(f.calls).toEqual([]);
  });
  it('blocked text and a reserved by line are 422 with the field, before the database', async () => {
    const f = fake();
    expect(await handleGuideWrite(UID, false, { op: 'save', guide: { ...good, body: 'shit' } }, f.rpc)).toEqual({ status: 422, body: { error: 'blocked_text', field: 'body' } });
    expect(await handleGuideWrite(UID, false, { op: 'save', guide: { ...good, byline: 'Team Ascent' } }, f.rpc)).toEqual({ status: 422, body: { error: 'reserved_name', field: 'byline' } });
    expect(f.calls).toEqual([]);
  });
  it('maps each SQL refusal to its status', async () => {
    const cases: Array<[string, number]> = [['not_allowed', 403], ['not_found', 404], ['conflict', 409], ['too_many_guides', 422], ['rate_limited', 429], ['unauthenticated', 401]];
    for (const [code, status] of cases) {
      const f = fake({ error: { message: `P0001: ${code}` } });
      expect(await handleGuideWrite(UID, false, { op: 'save', guide: good }, f.rpc), code).toEqual({ status, body: { error: code } });
    }
  });
  it('an unknown database error, a thrown call and a malformed answer are 500s', async () => {
    expect((await handleGuideWrite(UID, false, { op: 'save', guide: good }, fake({ error: { message: 'deadlock' } }).rpc)).status).toBe(500);
    expect((await handleGuideWrite(UID, false, { op: 'save', guide: good }, fake(() => { throw new Error('boom'); }).rpc)).status).toBe(500);
    expect(await handleGuideWrite(UID, false, { op: 'save', guide: good }, fake({ data: { nothing: true } }).rpc)).toEqual({ status: 500, body: { error: 'guide_malformed' } });
  });
});

describe('handleGuideWrite: delete', () => {
  it('needs a uuid, and calls guide_delete as the caller', async () => {
    const f = fake({ data: { deleted: GID } });
    expect(await handleGuideWrite(UID, false, { op: 'delete', id: 'nope' }, f.rpc)).toEqual({ status: 400, body: { error: 'bad_id' } });
    expect(await handleGuideWrite(UID, false, { op: 'delete', id: GID }, f.rpc)).toEqual({ status: 200, body: { deleted: GID } });
    expect(f.calls).toEqual([{ fn: 'guide_delete', args: { p_user: UID, p_id: GID } }]);
  });
});

describe('handleGuideWrite: importBuiltIns', () => {
  const builtIn = { ...good, slug: 'set2-beast-sunmane' };
  it('forces every guide official, requires its slug, and sends them in order', async () => {
    const f = fake({ data: { inserted: 2, skipped: 0 } });
    const res = await handleGuideWrite(UID, false, { op: 'importBuiltIns', guides: [builtIn, { ...builtIn, slug: 'set2-beast-oona' }] }, f.rpc);
    expect(res).toEqual({ status: 200, body: { inserted: 2, skipped: 0 } });
    const docs = f.calls[0]!.args.p_docs as Array<Record<string, unknown>>;
    expect(f.calls[0]!.fn).toBe('guide_import_builtins');
    expect(docs.map((d) => d.slug)).toEqual(['set2-beast-sunmane', 'set2-beast-oona']);
    expect(docs.every((d) => d.official === true)).toBe(true);
  });
  it('refuses a missing slug, an empty list and more than 50', async () => {
    const f = fake();
    expect(await handleGuideWrite(UID, false, { op: 'importBuiltIns', guides: [good] }, f.rpc)).toEqual({ status: 422, body: { error: 'bad_guide', field: 'slug', index: 0 } });
    expect((await handleGuideWrite(UID, false, { op: 'importBuiltIns', guides: [] }, f.rpc)).body).toEqual({ error: 'bad_guides' });
    expect((await handleGuideWrite(UID, false, { op: 'importBuiltIns', guides: Array.from({ length: 51 }, () => builtIn) }, f.rpc)).body).toEqual({ error: 'bad_guides' });
    expect(f.calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/guides/src/server.test.ts`
Expected: FAIL, cannot resolve `./server`.

- [ ] **Step 3: Implement the handler**

`packages/guides/src/server.ts`:
```ts
/**
 * GUIDES: the `guide-write` Edge Function's logic, as a pure function (spec section 3).
 *
 * The caller's id comes from the verified token, never the body. This file owns the TEXT rules (shape, limits, the
 * word filter, reserved by lines); the SQL functions it calls as the service role own the ROW rules (ownership,
 * official = team only, the 20-guide cap, the rate limit, edit conflicts) and are the only writers of the tables.
 *
 * Step 1 ops: `save`, `delete`, `importBuiltIns`. Later steps add `setPublished`, `bookmark`, `report`, `setHidden`.
 *
 * Not exported from index.ts (the client never runs it). Dependency-free. `npm run guides:shared` generates this
 * file VERBATIM into supabase/functions/_shared/guidesServer.ts; `sharedArtifact.test.ts` fails CI on drift.
 */
import { GUIDE_LIMITS, UUID_RE, parseGuideRecord } from './types';
import { draftToSqlDoc, validateGuideDraft } from './validate';
import { guideTextProblem } from './wordFilter';

export type RpcCall = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;

export interface HandlerResponse { status: number; body: Record<string, unknown> }

/** `raise exception '<code>'` inside the SQL functions → HTTP status. */
export const GUIDE_ERROR_STATUS: Readonly<Record<string, number>> = Object.freeze({
  unauthenticated: 401,
  not_allowed: 403,
  not_found: 404,
  conflict: 409,
  too_many_guides: 422,
  rate_limited: 429,
});

type Log = (msg: string, detail?: unknown) => void;

/** Run one SQL function; a known refusal becomes its status, anything else a 500 the client may retry. */
async function call(rpc: RpcCall, fn: string, args: Record<string, unknown>, log: Log): Promise<{ ok: true; data: unknown } | { ok: false; res: HandlerResponse }> {
  let res: Awaited<ReturnType<RpcCall>>;
  try {
    res = await rpc(fn, args);
  } catch (e) {
    log(`${fn} threw`, e);
    return { ok: false, res: { status: 500, body: { error: 'guide_failed' } } };
  }
  if (res.error) {
    const message = String(res.error.message ?? '');
    const code = Object.keys(GUIDE_ERROR_STATUS).find((k) => message.includes(k));
    if (code) return { ok: false, res: { status: GUIDE_ERROR_STATUS[code]!, body: { error: code } } };
    log(`${fn} failed`, res.error);
    return { ok: false, res: { status: 500, body: { error: 'guide_failed' } } };
  }
  return { ok: true, data: res.data };
}

/**
 * Handle one write for a verified caller. `userId` null = the token did not verify (401); `anonymous` = a guest
 * session (403). Never throws.
 */
export async function handleGuideWrite(userId: string | null, anonymous: boolean, body: unknown, rpc: RpcCall, log: Log = () => {}): Promise<HandlerResponse> {
  if (!userId) return { status: 401, body: { error: 'unauthenticated' } };
  if (anonymous) return { status: 403, body: { error: 'sign_in_required' } };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, body: { error: 'bad_body' } };
  const o = body as Record<string, unknown>;

  if (o.op === 'save') {
    const v = validateGuideDraft(o.guide);
    if (!v.ok) return { status: 422, body: { error: v.error, field: v.field } };
    const problem = guideTextProblem(v.draft);
    if (problem) return { status: 422, body: { error: problem.error, field: problem.field } };
    const out = await call(rpc, 'guide_save', { p_user: userId, p_doc: draftToSqlDoc(v.draft) }, log);
    if (!out.ok) return out.res;
    const guide = parseGuideRecord(out.data);
    if (!guide) {
      log('guide_save malformed', out.data);
      return { status: 500, body: { error: 'guide_malformed' } };
    }
    return { status: 200, body: { guide } };
  }

  if (o.op === 'delete') {
    if (typeof o.id !== 'string' || !UUID_RE.test(o.id)) return { status: 400, body: { error: 'bad_id' } };
    const out = await call(rpc, 'guide_delete', { p_user: userId, p_id: o.id }, log);
    if (!out.ok) return out.res;
    return { status: 200, body: { deleted: o.id } };
  }

  if (o.op === 'importBuiltIns') {
    if (!Array.isArray(o.guides) || o.guides.length < 1 || o.guides.length > GUIDE_LIMITS.importBatch) return { status: 400, body: { error: 'bad_guides' } };
    const docs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < o.guides.length; i++) {
      const raw = o.guides[i];
      const v = validateGuideDraft(raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>), official: true, id: undefined } : raw, { requireSlug: true });
      if (!v.ok) return { status: 422, body: { error: v.error, field: v.field, index: i } };
      const problem = guideTextProblem(v.draft);
      if (problem) return { status: 422, body: { error: problem.error, field: problem.field, index: i } };
      docs.push(draftToSqlDoc(v.draft));
    }
    const out = await call(rpc, 'guide_import_builtins', { p_user: userId, p_docs: docs }, log);
    if (!out.ok) return out.res;
    const d = (out.data ?? {}) as Record<string, unknown>;
    return { status: 200, body: { inserted: Number(d.inserted ?? 0), skipped: Number(d.skipped ?? 0) } };
  }

  return { status: 400, body: { error: 'bad_op' } };
}
```

- [ ] **Step 4: Run the handler test to verify it passes**

Run: `npx vitest run packages/guides/src/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing generated-copy test**

`packages/guides/src/sharedArtifact.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHARED_ARTIFACTS, generateArtifact } from './sharedArtifact';

/**
 * ONE hand-edited copy of the guide rules. The Edge Function's modules in supabase/functions/_shared/ are GENERATED
 * from this package (`npm run guides:shared`); this test regenerates them in memory and fails when the committed
 * copies differ, so the limits and the word filter can never differ between what is tested and what is deployed.
 */
const root = join(__dirname, '../../..');

describe('generated Deno copies of the guide rules', () => {
  for (const a of SHARED_ARTIFACTS) {
    it(`supabase/functions/_shared/${a.target} is up to date with packages/guides/src/${a.source}`, () => {
      const source = readFileSync(join(root, 'packages/guides/src', a.source), 'utf8');
      const committed = readFileSync(join(root, 'supabase/functions/_shared', a.target), 'utf8').replace(/\r\n/g, '\n');
      expect(committed, 'run `npm run guides:shared` and commit the result').toBe(generateArtifact(a.source, source));
    });
  }

  it('the shared sources import only each other (Deno bundles them with no import map)', () => {
    const siblings = new Set(SHARED_ARTIFACTS.map((a) => `./${a.source.replace(/\.ts$/, '')}`));
    for (const a of SHARED_ARTIFACTS) {
      const text = readFileSync(join(root, 'packages/guides/src', a.source), 'utf8');
      const froms = [...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+'([^']+)';/gms)].map((m) => m[1]!);
      for (const f of froms) expect(siblings.has(f), `${a.source} imports ${f}`).toBe(true);
    }
  });

  it('the Edge Function entry imports the generated module, never the package', () => {
    const entry = readFileSync(join(root, 'supabase/functions/guide-write/index.ts'), 'utf8');
    expect(entry).toContain("from '../_shared/guidesServer.ts'");
    expect(entry).not.toContain('@game/');
  });

  it('REVIEW FOCUS 5: the entry refuses an oversized body before parsing it', () => {
    const entry = readFileSync(join(root, 'supabase/functions/guide-write/index.ts'), 'utf8');
    expect(entry).toContain('GUIDE_LIMITS.bodyBytes');
    expect(entry.indexOf('payload_too_large')).toBeGreaterThan(-1);
    expect(entry.indexOf('payload_too_large')).toBeLessThan(entry.indexOf('JSON.parse'));
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run packages/guides/src/sharedArtifact.test.ts`
Expected: FAIL, cannot resolve `./sharedArtifact`.

- [ ] **Step 7: Implement the generator and the entry**

`packages/guides/src/sharedArtifact.ts`:
```ts
/**
 * The GENERATED Deno copies of the guide rules. `npm run guides:shared` (packages/tools/src/guides-shared.ts) writes
 * them into `supabase/functions/_shared/`; `sharedArtifact.test.ts` regenerates them in memory and fails when the
 * committed files differ. Pure string transforms, so the test and the writer cannot disagree.
 */

/** Source file (relative to packages/guides/src) → generated file (relative to supabase/functions/_shared). */
export const SHARED_ARTIFACTS: ReadonlyArray<{ source: string; target: string }> = [
  { source: 'types.ts', target: 'guidesTypes.ts' },
  { source: 'validate.ts', target: 'guidesValidate.ts' },
  { source: 'wordFilter.ts', target: 'guidesWordFilter.ts' },
  { source: 'server.ts', target: 'guidesServer.ts' },
];

const HEADER = (source: string): string =>
  `// GENERATED from packages/guides/src/${source} by \`npm run guides:shared\`. DO NOT EDIT.\n`
  + '// Edit the source, re-run the script, and commit both; sharedArtifact.test.ts fails CI when they drift.\n'
  + '// Deno module (the guide-write Edge Function imports it); the repo\'s tsc/eslint skip supabase/**.\n';

/** The generated text for one source file. Relative imports gain the Deno path of their generated sibling. */
export function generateArtifact(source: string, text: string): string {
  let body = text.replace(/\r\n/g, '\n');
  for (const a of SHARED_ARTIFACTS) {
    const bare = a.source.replace(/\.ts$/, '');
    body = body.split(`from './${bare}';`).join(`from './${a.target}';`);
  }
  return HEADER(source) + body;
}
```

`packages/tools/src/guides-shared.ts`:
```ts
/**
 * `npm run guides:shared`: write the GENERATED Deno copies of the guide rules into supabase/functions/_shared/
 * (see packages/guides/src/sharedArtifact.ts). Run it after editing packages/guides/src/{types,validate,wordFilter,
 * server}.ts, then commit the generated files with the source.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHARED_ARTIFACTS, generateArtifact } from '../../guides/src/sharedArtifact';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');
for (const a of SHARED_ARTIFACTS) {
  const text = readFileSync(join(root, 'packages/guides/src', a.source), 'utf8');
  const out = join(root, 'supabase/functions/_shared', a.target);
  writeFileSync(out, generateArtifact(a.source, text), 'utf8');
  console.log(`wrote ${out}`);
}
```

In the root `package.json`, add directly after the `"progression:shared"` script line:
```json
    "guides:shared": "tsx packages/tools/src/guides-shared.ts",
```

`supabase/functions/guide-write/index.ts`:
```ts
/**
 * guide-write: the only writer of guides (2026-10-12).
 *
 * The client sends `{ op, ... }` (`save`, `delete`, `importBuiltIns`). This function verifies the caller's token,
 * takes the user id from it (never from the body), then hands the request to `handleGuideWrite`
 * (../_shared/guidesServer.ts, GENERATED from packages/guides/src/server.ts), which checks shape, limits and the
 * word filter and calls the SQL functions as the SERVICE ROLE. The `guides` tables have no client write policy, so
 * every guard here and in the SQL is unbypassable:
 *   · authenticated caller required, and NOT a guest: an anonymous session is refused `sign_in_required`;
 *   · 64 KB body ceiling, checked before the body is parsed;
 *   · a Team Ascent guide can be written only by an account in `guide_team` (checked in SQL).
 *
 * Deploy: `npx supabase functions deploy guide-write`, after running supabase/migrations/2026-10-12-guides.sql.
 *
 * Deno runtime, NOT part of the Node monorepo build (the repo's tsc/eslint don't compile this directory).
 */
// @ts-nocheck: Deno globals + remote imports aren't visible to the repo's Node TypeScript config.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleGuideWrite } from '../_shared/guidesServer.ts';
import { GUIDE_LIMITS } from '../_shared/guidesTypes.ts';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'not_configured' });

  // WHO is calling: `getUser()` verifies the token server-side. Anonymous sessions are real user ids, so the
  // guest check reads `is_anonymous` off the verified user (never a client claim).
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const user = !userErr && userData?.user ? userData.user : null;
  const userId = user ? user.id : null;
  const anonymous = user ? user.is_anonymous === true : false;

  // Size gate BEFORE parsing: read the raw text and measure it.
  const raw = await req.text();
  if (raw.length > GUIDE_LIMITS.bodyBytes) return json(413, { error: 'payload_too_large', maxBytes: GUIDE_LIMITS.bodyBytes });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return json(400, { error: 'bad_body' }); }

  const admin = createClient(url, serviceKey);
  // rows: these server RPCs return one jsonb result each, never a table (R-NET-01).
  const rpc = (fn: string, args: Record<string, unknown>) => admin.rpc(fn, args);
  const log = (msg: string, detail?: unknown) => console.error(msg, detail);
  const res = await handleGuideWrite(userId, anonymous, body, rpc, log);
  return json(res.status, res.body);
});
```

Run: `npm run guides:shared`
Expected: four `wrote .../supabase/functions/_shared/guides*.ts` lines.

- [ ] **Step 8: Run the package's tests and the row guard**

Run: `npx vitest run packages/guides packages/ui/src/supabaseRows.guard.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/guides/src/server.ts packages/guides/src/server.test.ts packages/guides/src/sharedArtifact.ts packages/guides/src/sharedArtifact.test.ts packages/tools/src/guides-shared.ts package.json supabase/functions/guide-write supabase/functions/_shared/guidesTypes.ts supabase/functions/_shared/guidesValidate.ts supabase/functions/_shared/guidesWordFilter.ts supabase/functions/_shared/guidesServer.ts
git commit -m "feat(guides): guide-write Edge Function, its handler and generated Deno copies"
```

---

### Task 6: UI data layer: the bundled fallback, the `Guide` type, `guidesFor` over a list

**Files:**
- Create: `packages/ui/src/guides/guides.bundled.ts`
- Modify: `packages/ui/src/guides/guides.ts` (rewritten), `packages/ui/src/guides/guides.test.ts`
- Test: `packages/ui/src/guides/guidesData.test.ts`

**Interfaces:**
- Consumes: `guideSetsFor`, `TEAM_BYLINE`, `CARD_ID_RE`, `GuideRecord` from `@game/guides`.
- Produces: `BundledGuide`, `BUNDLED_GUIDE_DATA`; UI `Guide` (fields below); `GUIDES: readonly Guide[]`; `toGuide(r: GuideRecord): Guide | null`; `guidesFor(setId: SetId | undefined, tribes: readonly Tribe[], list?: readonly Guide[]): Guide[]`; `poolIdsFor(setId: SetId): ReadonlySet<string>`; `guideMissingIds(guide: Guide, setId: SetId | undefined): ReadonlySet<string>`. Unchanged exports: `GuidesMode`, `PLACEHOLDER_BODY`, `tribeInk`.

- [ ] **Step 1: Move the built-in guides to their own file**

Create `packages/ui/src/guides/guides.bundled.ts` with this header, then move the array literal from `guides.ts` (the eleven objects between `export const GUIDES: readonly Guide[] = [` and its closing `];`) into it **unchanged**, including every comment:

```ts
/**
 * THE BUILT-IN GUIDES (owner's text, 2026-10-09). Since 2026-10-12 guides live on the server (guidesStore.ts);
 * these copies are the OFFLINE FALLBACK and the seed the team imports once (`importBuiltIns`). Until that import
 * has run, every player sees exactly these.
 *
 * DATA, not JSX. Each guide is ONE build line, grouped by tribe in data order. `guides.test.ts` fails a guide whose
 * card id does not resolve, or resolves to a card that is not in the guide's set.
 */
import type { Tribe } from '@game/core';
import type { SetId } from '@game/content';

export interface BundledGuide {
  /** Also the server row's `slug` once imported, so the two can be matched. */
  id: string;
  /** The set this guide was written for. It shows there always, and in any other set every card of it exists in. */
  set: SetId;
  /** The tribes this guide is for. Empty = a neutral guide (always shown). */
  tribes: readonly Tribe[];
  /** A crossover tribe, shown as a second chip when it is also in the lobby. Never gates visibility. */
  pairsWith?: readonly Tribe[];
  /** The card whose ART stands for this guide on its row. Any card id with art, tokens and spells included. */
  iconCard: string;
  title: string;
  tagline: string;
  body: string;
  core: readonly string[];
  enablers: readonly string[];
  /** Other cards the body names. Not shown as portraits; only their names in the body become hoverable. */
  mentions?: readonly string[];
  /** Body words that stand for a card under a shorter name ("Oona" for King Oona). Word → card id. */
  aliases?: Readonly<Record<string, string>>;
}

export const BUNDLED_GUIDE_DATA: readonly BundledGuide[] = [
  // ← the eleven guide objects, moved from guides.ts unchanged
];
```

- [ ] **Step 2: Write the failing test**

`packages/ui/src/guides/guidesData.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { CARD_ID_RE, type GuideRecord } from '@game/guides';
import { BUNDLED_GUIDE_DATA } from './guides.bundled';
import { GUIDES, guideMissingIds, guidesFor, toGuide, type Guide } from './guides';

const rec = (patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id: '11111111-1111-4111-8111-111111111111', slug: null, authorId: 'u-1', byline: 'Mike', official: false, published: true, hidden: false,
  sets: ['set2'], tribes: ['beast'], pairsWith: [], iconCard: 'b2_sunmane', title: 'T', tagline: '', body: 'B', core: ['b2_sunmane'],
  enablers: [], mentions: [], aliases: {}, forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0,
  revision: 3, createdAt: '', updatedAt: '', ...patch,
});
const g = (patch: Partial<Guide>): Guide => ({ ...GUIDES[0]!, ...patch });

describe('the built-in guides as Guide objects', () => {
  it('are the bundled data, in order, as official Team Ascent guides with no server row', () => {
    expect(GUIDES.map((x) => x.id)).toEqual(BUNDLED_GUIDE_DATA.map((x) => x.id));
    for (const [i, x] of GUIDES.entries()) expect(x).toMatchObject({ official: true, published: true, hidden: false, byline: 'Team Ascent', rowId: null, authorId: null, order: i });
  });
  it('each shows in the set it was written for', () => {
    for (const [i, x] of GUIDES.entries()) expect(x.sets, x.id).toContain(BUNDLED_GUIDE_DATA[i]!.set);
  });
  it('every card id in the game fits the wire pattern the server checks', () => {
    for (const id of Object.keys(CARD_INDEX)) expect(CARD_ID_RE.test(id), id).toBe(true);
  });
});

describe('toGuide (a server row → what the UI draws)', () => {
  it('keeps the slug as the id when there is one, so a built-in keeps its identity once imported', () => {
    expect(toGuide(rec({ slug: 'set2-beast-sunmane' }))).toMatchObject({ id: 'set2-beast-sunmane', rowId: '11111111-1111-4111-8111-111111111111' });
    expect(toGuide(rec())).toMatchObject({ id: '11111111-1111-4111-8111-111111111111', rowId: '11111111-1111-4111-8111-111111111111', revision: 3, byline: 'Mike' });
  });
  it('REVIEW FOCUS 2: a guide for a tribe this build has never heard of is dropped, not shown as Neutral', () => {
    expect(toGuide(rec({ tribes: ['merfolk'] }))).toBeNull();
  });
  it('REVIEW FOCUS 2: an unknown set id and an unknown pairs-with tribe are dropped from the guide; unknown cards are kept (they grey out)', () => {
    const out = toGuide(rec({ sets: ['set2', 'set99'], pairsWith: ['merfolk'], core: ['b2_sunmane', 'card_from_the_future'] }))!;
    expect(out.sets).toEqual(['set2']);
    expect(out.pairsWith).toBeUndefined();
    expect(out.core).toEqual(['b2_sunmane', 'card_from_the_future']);
  });
});

describe('guidesFor over a list', () => {
  it('defaults to the built-in guides and keeps today\'s order', () => {
    expect(guidesFor('set2', ['kobold', 'beast']).map((x) => x.id)).toEqual(['set2-beast-sunmane', 'set2-beast-oona', 'set2-kobold-combat', 'set2-kobold-mountainbond', 'set2-neutral-paragon']);
  });
  it('filters on `sets`, so one guide can show in two sets', () => {
    const list = [g({ id: 'both', sets: ['set2', 'set3'], tribes: [] }), g({ id: 'only2', sets: ['set2'], tribes: [] })];
    expect(guidesFor('set3', [], list).map((x) => x.id)).toEqual(['both']);
    expect(guidesFor('set2', [], list).map((x) => x.id)).toEqual(['both', 'only2']);
  });
  it('groups by first tribe in order of first appearance, Neutral last: a new Beast guide lands beside the Beasts', () => {
    const list = [
      g({ id: 'beast-1', tribes: ['beast'], order: 0 }), g({ id: 'dragon-1', tribes: ['dragon'], order: 1 }),
      g({ id: 'neutral-1', tribes: [], order: 2 }), g({ id: 'beast-2', tribes: ['beast'], order: 3 }),
    ];
    expect(guidesFor('set2', ['beast', 'dragon'], list).map((x) => x.id)).toEqual(['beast-1', 'beast-2', 'dragon-1', 'neutral-1']);
  });
});

describe('guideMissingIds', () => {
  const inSet2 = new Set(poolFor('set2').all.map((c) => c.id));
  const archived = Object.keys(CARD_INDEX).find((id) => !inSet2.has(id))!;
  it('names the Core, Enabler and mentioned cards that are not in the set, or do not exist', () => {
    const guide = g({ core: ['b2_sunmane', archived], enablers: ['no_such_card'], mentions: undefined });
    expect([...guideMissingIds(guide, 'set2')].sort()).toEqual([archived, 'no_such_card'].sort());
  });
  it('is empty (one shared set) for a whole guide, and for every built-in guide in its own set', () => {
    expect(guideMissingIds(GUIDES[0]!, 'set2').size).toBe(0);
    expect(guideMissingIds(GUIDES[0]!, 'set2')).toBe(guideMissingIds(GUIDES[1]!, 'set2'));
    for (const [i, x] of GUIDES.entries()) expect(guideMissingIds(x, BUNDLED_GUIDE_DATA[i]!.set).size, x.id).toBe(0);
  });
  it('the icon never counts (the Imps guide wears a token that is in no set)', () => {
    expect(inSet2.has('impscrap')).toBe(false);
    expect(guideMissingIds(GUIDES.find((x) => x.id === 'set2-demon-imps')!, 'set2').size).toBe(0);
  });
});

it('SETS has the three set ids the tests above assume', () => {
  expect(Object.keys(SETS)).toEqual(expect.arrayContaining(['set2', 'set3']));
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/guides/guidesData.test.ts`
Expected: FAIL (`toGuide` / `guideMissingIds` are not exported).

- [ ] **Step 4: Rewrite `guides.ts`**

Replace the whole of `packages/ui/src/guides/guides.ts` with:
```ts
/**
 * GUIDES: the build guides the lobby rail and the Compendium show.
 *
 * Since 2026-10-12 a guide is a SERVER ROW (guidesStore.ts loads them; spec:
 * docs/superpowers/specs/2026-10-11-community-guides-design.md). The eleven built-in guides (guides.bundled.ts) are
 * the offline fallback, turned into the same `Guide` shape here as `GUIDES`.
 *
 * WHICH GUIDES SHOW (owner rulings 2026-10-09 and 2026-10-11): a guide shows in a set when that set is in its
 * `sets`, and only when its tribe is in this lobby. Neutral guides always show. `pairsWith` is display only: a
 * second tribe chip the card wears when that tribe is also in the lobby; it never decides visibility.
 *
 * A CARD THAT LEFT (owner 2026-10-11: "lets grey out the card and say 'missing or removed'"): a guide keeps a card
 * that was archived or removed. `guideMissingIds` names them so the portrait row can grey them out.
 */
import type { Tribe } from '@game/core';
import { SETS, poolFor, type SetId } from '@game/content';
import { TEAM_BYLINE, guideSetsFor, type GuideRecord, type SetFacts } from '@game/guides';
import { BUNDLED_GUIDE_DATA } from './guides.bundled';

export interface Guide {
  /** Stable for React keys and the rail's "open guide" memory: the built-in slug when there is one, else the row id. */
  id: string;
  /** The server row's id; null for a built-in copy that has no row. Writes address the guide by this. */
  rowId: string | null;
  /** The sets this guide shows in. */
  sets: readonly SetId[];
  /** The tribes this guide is for. Empty = a neutral guide (always shown). */
  tribes: readonly Tribe[];
  /** A crossover tribe, shown as a second chip when it is also in the lobby. Never gates visibility. */
  pairsWith?: readonly Tribe[];
  /** The card whose ART stands for this guide on its row. Any card id with art, tokens and spells included. */
  iconCard: string;
  title: string;
  tagline: string;
  body: string;
  core: readonly string[];
  enablers: readonly string[];
  /** Other cards the body names. Not shown as portraits; only their names in the body become hoverable. */
  mentions?: readonly string[];
  /** Body words that stand for a card under a shorter name. Word → card id. */
  aliases?: Readonly<Record<string, string>>;
  /** The "by" line. `Team Ascent` on every official guide. */
  byline: string;
  official: boolean;
  published: boolean;
  hidden: boolean;
  authorId: string | null;
  /** The row's revision (0 for a built-in copy). A save sends back the one it loaded. */
  revision: number;
  /** Position among official guides (the built-in data order, then creation order). */
  order: number;
  forkedTitle?: string;
  forkedByline?: string;
}

/** The Guides view's display mode: SIMPLE = the normal-width rail, portraits only; FULL = the wide rail + write-up. */
export type GuidesMode = 'simple' | 'full';

export const PLACEHOLDER_BODY = 'Guide coming soon.';

const SET_IDS = Object.keys(SETS) as SetId[];
const KNOWN_SETS: ReadonlySet<string> = new Set(SET_IDS);
const KNOWN_TRIBES: ReadonlySet<string> = new Set(SET_IDS.flatMap((s) => SETS[s].tribes));

const poolIds = new Map<SetId, ReadonlySet<string>>();
/** Every card id in a set's pool (tokens included), memoized. */
export function poolIdsFor(setId: SetId): ReadonlySet<string> {
  let ids = poolIds.get(setId);
  if (!ids) {
    ids = new Set(poolFor(setId).all.map((c) => c.id));
    poolIds.set(setId, ids);
  }
  return ids;
}

const SET_FACTS: readonly SetFacts[] = SET_IDS.map((id) => ({ id, cardIds: poolIdsFor(id), tribes: SETS[id].tribes }));

/** The built-in guides as `Guide`s: each shows in the set it was written for, plus any set all of its cards are in. */
export const GUIDES: readonly Guide[] = BUNDLED_GUIDE_DATA.map((d, i) => {
  const { set, ...rest } = d;
  const carried = guideSetsFor(rest, SET_FACTS) as SetId[];
  return {
    ...rest,
    rowId: null,
    sets: carried.includes(set) ? carried : [set, ...carried],
    byline: TEAM_BYLINE,
    official: true,
    published: true,
    hidden: false,
    authorId: null,
    revision: 0,
    order: i,
  };
});

/**
 * A server row as the UI draws it. Null for a guide this build cannot place: one for a tribe it has never heard of
 * (an older client must not show it as Neutral, in every lobby). An unknown set id or crossover tribe is dropped
 * from the guide; an unknown card id is kept and greys out (`guideMissingIds`).
 */
export function toGuide(r: GuideRecord): Guide | null {
  if (r.tribes.some((t) => !KNOWN_TRIBES.has(t))) return null;
  const pairsWith = r.pairsWith.filter((t) => KNOWN_TRIBES.has(t)) as Tribe[];
  return {
    id: r.slug ?? r.id,
    rowId: r.id,
    sets: r.sets.filter((s): s is SetId => KNOWN_SETS.has(s)),
    tribes: r.tribes as Tribe[],
    pairsWith: pairsWith.length ? pairsWith : undefined,
    iconCard: r.iconCard,
    title: r.title,
    tagline: r.tagline,
    body: r.body,
    core: r.core,
    enablers: r.enablers,
    mentions: r.mentions.length ? r.mentions : undefined,
    aliases: Object.keys(r.aliases).length ? r.aliases : undefined,
    byline: r.byline,
    official: r.official,
    published: r.published,
    hidden: r.hidden,
    authorId: r.authorId,
    revision: r.revision,
    order: r.sortOrder,
    forkedTitle: r.forkedTitle ?? undefined,
    forkedByline: r.forkedByline ?? undefined,
  };
}

/** A tribe's INK for text and accents: its `--t-<tribe>` token, except Dragon (white, so the rune cards' warm coral)
 *  and Neutral (the rune cards' soft gold). Owner ask 2026-10-09: "color the tribe names so they stand out". */
export function tribeInk(t: Tribe): string {
  if (t === 'dragon') return '#ff8a6a';
  if (t === 'neutral') return '#e8c27a';
  return `var(--t-${t})`;
}

/**
 * The guides this game shows, from `list` (the store's, or the built-in ones): the set's, and only tribes in this
 * lobby (neutral always). A tribe's guides stay together: tribes come in the order each FIRST appears in the list,
 * Neutral last, and each tribe's guides in list order. So today's order is unchanged, and a guide the team adds
 * later for an existing tribe lands beside that tribe's others.
 */
export function guidesFor(setId: SetId | undefined, tribes: readonly Tribe[], list: readonly Guide[] = GUIDES): Guide[] {
  const set = setId ?? 'set1';
  const shown = list.filter((g) => g.sets.includes(set) && (g.tribes.length === 0 || g.tribes.some((t) => tribes.includes(t))));
  const firstSeen = new Map<string, number>();
  for (const g of shown) {
    const key = g.tribes[0] ?? '';
    const at = firstSeen.get(key);
    if (at === undefined || g.order < at) firstSeen.set(key, g.order);
  }
  const rank = (g: Guide): number => (g.tribes.length === 0 ? Number.MAX_SAFE_INTEGER : firstSeen.get(g.tribes[0]!)!);
  return [...shown].sort((a, b) => rank(a) - rank(b) || a.order - b.order || a.id.localeCompare(b.id));
}

const NO_MISSING: ReadonlySet<string> = new Set();
/** The Core, Enabler and mentioned cards of `guide` that are not in `setId`'s pool (archived, moved, or gone). */
export function guideMissingIds(guide: Guide, setId: SetId | undefined): ReadonlySet<string> {
  const pool = poolIdsFor(setId ?? 'set1');
  const out = [...guide.core, ...guide.enablers, ...(guide.mentions ?? [])].filter((id) => !pool.has(id));
  return out.length ? new Set(out) : NO_MISSING;
}
```

- [ ] **Step 5: Point the existing data tests at the bundled file**

In `packages/ui/src/guides/guides.test.ts`:

1. Add this import below the existing `./guides` import:
```ts
import { BUNDLED_GUIDE_DATA } from './guides.bundled';
```
2. In the test `'every card id resolves to a card in the guide\'s own set'`, change `for (const g of GUIDES) {` to `for (const g of BUNDLED_GUIDE_DATA) {`. (It reads `g.set`.)
3. In the test `'every tribe a guide names is one of its set\'s tribes'`, change `for (const g of GUIDES) {` to `for (const g of BUNDLED_GUIDE_DATA) {`.
4. In the test `'the owner-written guides keep the owner\'s cards and titles (2026-10-09)'`, change `for (const g of GUIDES.filter((x) => x.set === 'set2'))` to `for (const g of BUNDLED_GUIDE_DATA.filter((x) => x.set === 'set2'))`.
5. In the test `'is one card per build line: eleven Set 2 lines, every tribe of the set covered'`, change `expect(GUIDES.filter((g) => g.set === 'set2')).toHaveLength(11);` to `expect(BUNDLED_GUIDE_DATA.filter((g) => g.set === 'set2')).toHaveLength(11);`.

Leave every other line of that file as it is. The owner's title and card pins stay in this step; they retire with `guides:pull` in step 4 of the feature.

- [ ] **Step 6: Run the guide tests and the web typecheck**

Run: `npx vitest run packages/ui/src/guides && npm run typecheck:web`
Expected: PASS, and no type errors. A type error in `CompendiumGuides.tsx`, `LobbyGuides.tsx`, `LobbyPanel.tsx` or `MinionBook.tsx` here means a caller read `guide.set`; the only readers are the tests changed above, so report anything else rather than patching it.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/guides/guides.bundled.ts packages/ui/src/guides/guides.ts packages/ui/src/guides/guides.test.ts packages/ui/src/guides/guidesData.test.ts
git commit -m "refactor(guides): built-in guides become the fallback; guidesFor filters a list on sets"
```

---

### Task 7: The read seam

**Files:**
- Create: `packages/ui/src/guides/guidesRemote.ts`
- Test: `packages/ui/src/guides/guidesRemote.test.ts`

**Interfaces:**
- Consumes: `parseGuideRecord`, `GuideRecord` (Task 1); `supabaseClient` from `../remoteBoards`; `fetchAllRows` from `../supabaseRows`.
- Produces: `GUIDE_COLUMNS: string`, `OfficialGuidesAnswer = { state: 'on'; guides: GuideRecord[] } | { state: 'off' | 'offline' | 'no-backend' }`, `fetchOfficialGuides(): Promise<OfficialGuidesAnswer>`.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/guides/guidesRemote.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GUIDES: the read seam over a FAKE Supabase client. Pins the query (official guides only, a stable order, paged per
 * R-NET-01), how each failure is classified (no backend / migration not run / could not ask), and that a malformed
 * row is dropped rather than thrown on.
 */
type Res = { data: unknown; error: { message: string; code?: string } | null };
let tableImpl: () => Res | Promise<Res>;
let hasClient = true;
const seen: { table?: string; columns?: string; eq: Array<[string, unknown]>; order: string[]; ranges: Array<[number, number]> } = { eq: [], order: [], ranges: [] };

vi.mock('../remoteBoards', () => ({
  supabaseClient: () => (hasClient ? {
    from: (table: string) => ({
      select: (columns: string) => {
        seen.table = table; seen.columns = columns;
        const chain = {
          eq: (k: string, v: unknown) => { seen.eq.push([k, v]); return chain; },
          order: (k: string) => { seen.order.push(k); return chain; },
          range: (a: number, b: number) => { seen.ranges.push([a, b]); return Promise.resolve(tableImpl()); },
        };
        return chain;
      },
    }),
  } : null),
}));

const { fetchOfficialGuides, GUIDE_COLUMNS } = await import('./guidesRemote');

const row = (id: string): Record<string, unknown> => ({ id, title: 'T', body: 'B', icon_card: 'grim', core: ['grim'], official: true, sort_order: 0, revision: 1 });

beforeEach(() => {
  hasClient = true;
  seen.eq = []; seen.order = []; seen.ranges = [];
  tableImpl = () => ({ data: [row('a'), row('b')], error: null });
  vi.useRealTimers();
});

describe('fetchOfficialGuides', () => {
  it('reads official guides in a stable order, paged, and parses them', async () => {
    const res = await fetchOfficialGuides();
    expect(seen.table).toBe('guides');
    expect(seen.columns).toBe(GUIDE_COLUMNS);
    expect(seen.eq).toEqual([['official', true]]);
    expect(seen.order).toEqual(['sort_order', 'id']);
    expect(seen.ranges[0]).toEqual([0, 999]);
    expect(res).toMatchObject({ state: 'on', guides: [{ id: 'a' }, { id: 'b' }] });
  });
  it('no backend configured is `no-backend`', async () => {
    hasClient = false;
    expect(await fetchOfficialGuides()).toEqual({ state: 'no-backend' });
  });
  it('a missing table (the migration has not run) is a definite `off`', async () => {
    for (const code of ['42P01', 'PGRST205', 'PGRST204', '42703']) {
      tableImpl = () => ({ data: null, error: { message: 'x', code } });
      expect(await fetchOfficialGuides(), code).toEqual({ state: 'off' });
    }
  });
  it('any other error, and a thrown call, are `offline`', async () => {
    tableImpl = () => ({ data: null, error: { message: 'boom', code: '500' } });
    expect(await fetchOfficialGuides()).toEqual({ state: 'offline' });
    tableImpl = () => { throw new Error('network'); };
    expect(await fetchOfficialGuides()).toEqual({ state: 'offline' });
  });
  it('REVIEW FOCUS 4: a read that never answers is `offline` after 4 seconds', async () => {
    vi.useFakeTimers();
    tableImpl = () => new Promise<Res>(() => { /* never */ });
    const p = fetchOfficialGuides();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(await p).toEqual({ state: 'offline' });
  });
  it('REVIEW FOCUS 2: a malformed row is dropped, the rest are kept', async () => {
    tableImpl = () => ({ data: [row('a'), { id: 'no-title' }, null, row('c')], error: null });
    expect(await fetchOfficialGuides()).toMatchObject({ state: 'on', guides: [{ id: 'a' }, { id: 'c' }] });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/guides/guidesRemote.test.ts`
Expected: FAIL, cannot resolve `./guidesRemote`.

- [ ] **Step 3: Implement**

`packages/ui/src/guides/guidesRemote.ts`:
```ts
/**
 * GUIDES: the network seam (2026-10-12). Every Supabase call the guides feature makes lives here, so the store and
 * the screens stay testable with a fake client. Mirrors `gauntlet/gauntletRemote.ts`.
 *
 *  - `fetchOfficialGuides`: the Team Ascent guides, read directly under row level security. It doubles as the
 *    CAPABILITY PROBE: a missing table (the migration not run yet) is a definite `off`.
 *
 * Writes (the `guide-write` Edge Function) arrive with the editor.
 *
 * Never throws; every read is time-boxed.
 */
import { parseGuideRecord, type GuideRecord } from '@game/guides';
import { supabaseClient } from '../remoteBoards';
import { fetchAllRows } from '../supabaseRows';

const READ_TIMEOUT_MS = 4_000;

export const GUIDE_COLUMNS = 'id, slug, author_id, byline, official, published, hidden, sets, tribes, pairs_with, icon_card, title, tagline, body, core, enablers, mentions, aliases, forked_from, forked_title, forked_byline, bookmark_count, sort_order, revision, created_at, updated_at';

/** `on` = asked, here they are. `off` = asked, and the tables are not there. `offline` = could not ask. */
export type OfficialGuidesAnswer = { state: 'on'; guides: GuideRecord[] } | { state: 'off' | 'offline' | 'no-backend' };

const timeout = <T>(ms: number, value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), ms));

export async function fetchOfficialGuides(): Promise<OfficialGuidesAnswer> {
  const c = supabaseClient();
  if (!c) return { state: 'no-backend' };
  try {
    const res = await Promise.race([
      fetchAllRows((from, to) => c.from('guides').select(GUIDE_COLUMNS).eq('official', true).order('sort_order', { ascending: true }).order('id', { ascending: true }).range(from, to)),
      timeout(READ_TIMEOUT_MS, null),
    ]);
    if (!res) return { state: 'offline' };
    if (res.error) {
      const code = String((res.error as { code?: string }).code ?? '');
      return { state: code === '42P01' || code === 'PGRST205' || code === 'PGRST204' || code === '42703' ? 'off' : 'offline' };
    }
    const guides = ((res.data as unknown[] | null) ?? []).map(parseGuideRecord).filter((g): g is GuideRecord => g !== null);
    return { state: 'on', guides };
  } catch {
    return { state: 'offline' };
  }
}
```

- [ ] **Step 4: Run it, and the row guard, to verify they pass**

Run: `npx vitest run packages/ui/src/guides/guidesRemote.test.ts packages/ui/src/supabaseRows.guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/guides/guidesRemote.ts packages/ui/src/guides/guidesRemote.test.ts
git commit -m "feat(guides): read official guides from the server"
```

---

### Task 8: The guides store, the boot load, and the two screens reading it

**Files:**
- Create: `packages/ui/src/guides/guidesStore.ts`
- Modify: `packages/ui/src/store.ts` (one import, two lines), `packages/ui/src/LobbyPanel.tsx`, `packages/ui/src/MinionBook.tsx`
- Test: `packages/ui/src/guides/guidesStore.test.ts`; additions to `packages/ui/src/guides/lobbyGuidesRail.test.tsx`

**Interfaces:**
- Consumes: `GUIDES`, `toGuide`, `Guide`, `guidesFor` (Task 6); `fetchOfficialGuides` (Task 7).
- Produces: `GuidesCapability = 'unknown' | 'no-backend' | 'off' | 'offline' | 'on'`, `useGuides` (Zustand: `{ capability, list: readonly Guide[], source: 'bundled' | 'server' }`), `loadGuides(): Promise<void>`, `resetGuidesForTests(): void`.

- [ ] **Step 1: Write the failing store test**

`packages/ui/src/guides/guidesStore.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideRecord } from '@game/guides';
import type { OfficialGuidesAnswer } from './guidesRemote';

let answer: () => Promise<OfficialGuidesAnswer>;
let calls = 0;
vi.mock('./guidesRemote', () => ({ fetchOfficialGuides: () => { calls++; return answer(); } }));

const { GUIDES } = await import('./guides');
const { loadGuides, resetGuidesForTests, useGuides } = await import('./guidesStore');

const rec = (id: string, patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id, slug: null, authorId: null, byline: 'Team Ascent', official: true, published: true, hidden: false, sets: ['set2'], tribes: ['beast'],
  pairsWith: [], iconCard: 'b2_sunmane', title: `Guide ${id}`, tagline: '', body: 'B', core: ['b2_sunmane'], enablers: [], mentions: [], aliases: {},
  forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0, revision: 1, createdAt: '', updatedAt: '', ...patch,
});

beforeEach(() => {
  resetGuidesForTests();
  calls = 0;
  answer = async () => ({ state: 'on', guides: [rec('a'), rec('b', { sortOrder: 1 })] });
});

describe('the guides store', () => {
  it('starts on the built-in guides, capability unknown', () => {
    expect(useGuides.getState()).toMatchObject({ capability: 'unknown', source: 'bundled' });
    expect(useGuides.getState().list).toBe(GUIDES);
  });
  it('adopts the server\'s official guides once they load', async () => {
    await loadGuides();
    expect(useGuides.getState()).toMatchObject({ capability: 'on', source: 'server' });
    expect(useGuides.getState().list.map((g) => g.id)).toEqual(['a', 'b']);
  });
  it('REVIEW FOCUS 3: zero usable official guides keeps the built-in ones (never an empty rail)', async () => {
    answer = async () => ({ state: 'on', guides: [] });
    await loadGuides();
    expect(useGuides.getState()).toMatchObject({ capability: 'on', source: 'bundled' });
    expect(useGuides.getState().list).toBe(GUIDES);
    answer = async () => ({ state: 'on', guides: [rec('x', { tribes: ['merfolk'] })] }); // every row unusable on this build
    await loadGuides();
    expect(useGuides.getState().list).toBe(GUIDES);
  });
  it('off, offline and no-backend keep the built-in guides and record why', async () => {
    for (const state of ['off', 'offline', 'no-backend'] as const) {
      resetGuidesForTests();
      answer = async () => ({ state });
      await loadGuides();
      expect(useGuides.getState(), state).toMatchObject({ capability: state, source: 'bundled' });
      expect(useGuides.getState().list).toBe(GUIDES);
    }
  });
  it('a dropped connection after a good load keeps the loaded list', async () => {
    await loadGuides();
    const loaded = useGuides.getState().list;
    answer = async () => ({ state: 'offline' });
    await loadGuides();
    expect(useGuides.getState().capability).toBe('offline');
    expect(useGuides.getState().list).toBe(loaded);
  });
  it('an unchanged reload keeps the SAME list object, so nothing re-renders; a new revision replaces it', async () => {
    await loadGuides();
    const first = useGuides.getState().list;
    await loadGuides();
    expect(useGuides.getState().list).toBe(first);
    answer = async () => ({ state: 'on', guides: [rec('a', { revision: 2 }), rec('b', { sortOrder: 1 })] });
    await loadGuides();
    expect(useGuides.getState().list).not.toBe(first);
  });
  it('REVIEW FOCUS 4: two callers at once share one request', async () => {
    let release: (a: OfficialGuidesAnswer) => void = () => {};
    answer = () => new Promise<OfficialGuidesAnswer>((r) => { release = r; });
    const p1 = loadGuides();
    const p2 = loadGuides();
    release({ state: 'on', guides: [rec('a')] });
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/guides/guidesStore.test.ts`
Expected: FAIL, cannot resolve `./guidesStore`.

- [ ] **Step 3: Implement the store**

`packages/ui/src/guides/guidesStore.ts`:
```ts
/**
 * GUIDES: the client slice (2026-10-12). A small store of its OWN rather than more fields on the game store
 * (`store.ts` is a hot file): the game store only calls `loadGuides` when identity lands or changes.
 *
 *   capability  `unknown` until the first read answers; then `on`, `off` (asked, the migration has not run),
 *               `offline` (could not ask) or `no-backend` (no Supabase configured).
 *   list        the Team Ascent guides every screen filters with `guidesFor`. The BUILT-IN guides until the server
 *               answers with at least one usable guide, so a screen is never empty and never waits.
 *   source      which of the two `list` currently is.
 *
 * A failed or empty read never replaces a list that is already showing: one timed-out refresh must not reshuffle
 * the guides mid-session. An unchanged reload keeps the same array, so no screen re-renders.
 *
 * THE RAIL DOES NOT SUBSCRIBE. It reads `useGuides.getState().list` when its Guides view opens (LobbyPanel), so a
 * refresh that lands while the player is reading never moves a card under them. The Compendium does subscribe.
 */
import { create } from 'zustand';
import { GUIDES, toGuide, type Guide } from './guides';
import { fetchOfficialGuides } from './guidesRemote';

export type GuidesCapability = 'unknown' | 'no-backend' | 'off' | 'offline' | 'on';

interface GuidesStore {
  capability: GuidesCapability;
  list: readonly Guide[];
  source: 'bundled' | 'server';
}

const INITIAL: GuidesStore = { capability: 'unknown', list: GUIDES, source: 'bundled' };

export const useGuides = create<GuidesStore>(() => ({ ...INITIAL }));

const sameList = (a: readonly Guide[], b: readonly Guide[]): boolean =>
  a.length === b.length && a.every((g, i) => g.rowId === b[i]!.rowId && g.revision === b[i]!.revision);

let loading: Promise<void> | null = null;

/** Read the official guides. Safe to call often: concurrent calls share one request. Never throws. */
export function loadGuides(): Promise<void> {
  if (loading) return loading;
  loading = (async (): Promise<void> => {
    const ans = await fetchOfficialGuides();
    if (ans.state !== 'on') {
      useGuides.setState({ capability: ans.state });
      return;
    }
    const server = ans.guides.map(toGuide).filter((g): g is Guide => g !== null);
    if (server.length === 0) {
      useGuides.setState({ capability: 'on' });
      return;
    }
    const cur = useGuides.getState();
    useGuides.setState({ capability: 'on', source: 'server', list: cur.source === 'server' && sameList(cur.list, server) ? cur.list : server });
  })().catch(() => { /* fetchOfficialGuides never throws; this guards the mapping */ }).finally(() => { loading = null; });
  return loading;
}

export function resetGuidesForTests(): void {
  loading = null;
  useGuides.setState({ ...INITIAL });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/ui/src/guides/guidesStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing rail test**

Append to `packages/ui/src/guides/lobbyGuidesRail.test.tsx`, inside the existing `describe('lobby rail guides view', ...)` block, and add `import { useGuides, resetGuidesForTests } from './guidesStore';` and `import { GUIDES } from './guides';` to the file's imports (extend the existing `./guides` import rather than adding a second one), and `resetGuidesForTests();` as the first statement of the existing `afterEach`:

```tsx
  it('reads the guides store when the Guides view opens, and an open rail never reshuffles (owner 2026-10-11)', () => {
    const c = mountRail(7777);
    const run = useGame.getState().run;
    const builtIn = guidesFor(run.setId, run.tribes).map((g) => g.id);
    openGuides(c);
    const shown = (): string[] => [...c.querySelectorAll('.lobbyguide')].map((g) => g.getAttribute('data-guide')!);
    expect(shown()).toEqual(builtIn);

    // A refresh lands while the player is reading: one guide renamed and moved to the front.
    const first = GUIDES.find((g) => g.id === builtIn[builtIn.length - 1])!;
    const refreshed = [{ ...first, title: 'Renamed on the server', order: -1 }, ...GUIDES.filter((g) => g.id !== first.id)];
    act(() => { useGuides.setState({ list: refreshed, source: 'server', capability: 'on' }); });
    expect(shown()).toEqual(builtIn);
    expect(c.textContent).not.toContain('Renamed on the server');

    // Leaving and reopening the view picks the refresh up.
    const tab = c.querySelector('.lobbyrailtab')!;
    click(tab);
    click(tab);
    expect(c.textContent).toContain('Renamed on the server');
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/guides/lobbyGuidesRail.test.tsx`
Expected: the new test FAILS on its last assertion (the rail still reads the built-in list); the existing tests pass.

- [ ] **Step 7: Wire the rail, the Compendium and the boot load**

In `packages/ui/src/LobbyPanel.tsx`:

1. Below the line `import { guidesFor, type GuidesMode } from './guides/guides';` add:
```ts
import { useGuides } from './guides/guidesStore';
```
2. Replace
```ts
  const guides = useMemo(() => guidesFor(setId, runTribes), [setId, runTribes]);
```
with
```ts
  // The guide list is a SNAPSHOT of the guides store, retaken each time the Guides view opens (below), never a
  // subscription: a refresh that lands while the player is reading must not move a card under them.
  const [guideList, setGuideList] = useState(() => useGuides.getState().list);
  const guides = useMemo(() => guidesFor(setId, runTribes, guideList), [setId, runTribes, guideList]);
```
3. Directly after the line `const showGuides = guidesOn && view === 'guides';` add:
```ts
  useEffect(() => { if (showGuides) setGuideList(useGuides.getState().list); }, [showGuides]);
```

In `packages/ui/src/MinionBook.tsx`:

1. Below the line `import { guidesFor } from './guides/guides';` add:
```ts
import { loadGuides, useGuides } from './guides/guidesStore';
```
2. Directly above the comment block that starts `// The build GUIDES for the Guides tab`, add:
```ts
  // The Compendium SUBSCRIBES to the guides store (unlike the rail's snapshot), and refreshes it when the tab opens.
  const guideList = useGuides((s) => s.list);
  useEffect(() => { if (guidesOn) void loadGuides(); }, [guidesOn]);
```
3. In the `guidesToShow` memo, change `return guidesFor(setId, tribes)` to `return guidesFor(setId, tribes, guideList)` and its dependency list from `[setId, tribes, guideTribes, searchQ]` to `[setId, tribes, guideTribes, searchQ, guideList]`.

If `useEffect` is not already imported from `'react'` in `MinionBook.tsx`, add it to that import.

In `packages/ui/src/store.ts`:

1. Add next to the other feature imports near the top of the file:
```ts
import { loadGuides } from './guides/guidesStore';
```
2. Directly after the line `void probeProgression(); // ACCOUNT PROGRESSION: is the feature on? then the mirror + any XP stranded pending` add:
```ts
    void loadGuides(); // GUIDES: the Team Ascent guides from the server (the built-in ones show until it answers)
```
3. Directly after the line `if (id) void probeProgression(); // …and progression (same user id across the magic-link upgrade)` add:
```ts
    if (id) void loadGuides(); // …and the guides (a team account now reads every guide)
```

- [ ] **Step 8: Run the guide tests and the web typecheck**

Run: `npx vitest run packages/ui/src/guides && npm run typecheck:web`
Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/guides/guidesStore.ts packages/ui/src/guides/guidesStore.test.ts packages/ui/src/guides/lobbyGuidesRail.test.tsx packages/ui/src/LobbyPanel.tsx packages/ui/src/MinionBook.tsx packages/ui/src/store.ts
git commit -m "feat(guides): guides store loaded at boot; rail snapshots it, Compendium subscribes"
```

---

### Task 9: The missing-card slot

**Files:**
- Modify: `packages/ui/src/guides/GuideParts.tsx`, `packages/ui/src/guides/CompendiumGuides.tsx`, `packages/ui/src/guides/LobbyGuides.tsx`, `packages/ui/src/MinionBook.tsx`, `packages/ui/src/guides/lobbyGuides.css`
- Test: `packages/ui/src/guides/guideMissing.test.tsx`

**Interfaces:**
- Consumes: `guideMissingIds` (Task 6).
- Produces: `GuideUnits` and `GuideText` gain an optional `missing?: ReadonlySet<string>` prop; `CompendiumGuides` gains a required `setId: SetId` prop.

- [ ] **Step 1: Write the failing test**

`packages/ui/src/guides/guideMissing.test.tsx`:
```tsx
// @vitest-environment jsdom
/**
 * A CARD THAT LEFT (owner 2026-10-11: "lets grey out the card and say 'missing or removed'"). A guide keeps a card
 * that was archived out of the set, or that no longer exists: its portrait stays in the row, greyed, labelled, with
 * no hover preview, and its name in the write-up is plain text.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, poolFor } from '@game/content';
import { mount, type Mounted } from '../renderedText.mount';
import { CompendiumGuides } from './CompendiumGuides';
import { GUIDES, type Guide } from './guides';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const inSet2 = new Set(poolFor('set2').all.map((c) => c.id));
/** A real minion with a definition that is NOT in set 2: what an archived card looks like to a guide. */
const archived = Object.values(CARD_INDEX).find((c) => !inSet2.has(c.id) && !c.spell && !c.token)!;
const present = CARD_INDEX['b2_sunmane']!;

const guide: Guide = {
  ...GUIDES[0]!,
  id: 'test-missing',
  body: `Play ${present.name} with ${archived.name}.`,
  core: [present.id, archived.id],
  enablers: ['card_that_never_existed'],
  mentions: undefined,
  aliases: undefined,
};

const render = (): HTMLElement => {
  ui = mount(<CompendiumGuides guides={[guide]} tribes={SETS.set2.tribes} run={undefined} setId="set2" />);
  return ui.container;
};

describe('missing or removed cards in a guide', () => {
  it('an archived card keeps its slot, greyed and labelled; a card that no longer exists gets a blank slot', () => {
    const c = render();
    const units = [...c.querySelectorAll('.lobbyguide-unit')];
    expect(units).toHaveLength(3);
    const missing = units.filter((u) => u.classList.contains('missing'));
    expect(missing).toHaveLength(2);
    expect(missing.every((u) => u.textContent?.includes('Missing or removed'))).toBe(true);
    expect(missing[0]!.getAttribute('aria-label')).toBe(`${archived.name}: missing or removed`);
    expect(missing[0]!.querySelector('.lobbyguide-unitscale')).not.toBeNull(); // the greyed art
    expect(missing[1]!.getAttribute('aria-label')).toBe('Missing or removed card');
    expect(missing[1]!.querySelector('.lobbyguide-blank')).not.toBeNull();
    expect(missing[1]!.querySelector('.lobbyguide-unitscale')).toBeNull();
  });
  it('a card that is still in the set is untouched', () => {
    const c = render();
    const ok = [...c.querySelectorAll('.lobbyguide-unit')].filter((u) => !u.classList.contains('missing'));
    expect(ok).toHaveLength(1);
    expect(ok[0]!.textContent).not.toContain('Missing or removed');
  });
  it('the write-up links the present card\'s name and leaves the missing card\'s name as plain text', () => {
    const c = render();
    const links = [...c.querySelectorAll('.lobbyguide-text .lobbyguide-name')].map((n) => n.textContent);
    expect(links).toEqual([present.name]);
    expect(c.querySelector('.lobbyguide-text')!.textContent).toContain(archived.name);
  });
  it('carries no native tooltip', () => {
    const c = render();
    expect(c.querySelector('[title]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/guides/guideMissing.test.tsx`
Expected: FAIL (`setId` is not a prop; no `.missing` units).

- [ ] **Step 3: Implement**

In `packages/ui/src/guides/GuideParts.tsx`:

1. Replace the `GuideText` function with:
```tsx
/** The write-up paragraph, its card names highlighted and hoverable. A `missing` card's name stays plain text. */
export function GuideText({ guide, ids, views, refs, missing }: {
  guide: Guide; ids: readonly string[]; views: Map<string, CardView>; refs: Map<string, CardView[]>; missing?: ReadonlySet<string>;
}): JSX.Element {
  const live = missing?.size ? ids.filter((id) => !missing.has(id)) : ids;
  return <p className="lobbyguide-text">{linkCardNames(guide.body, live, views, refs, guide.aliases)}</p>;
}
```
2. Replace the `GuideUnits` function with:
```tsx
/**
 * A row of board-style portraits: the real compact `Card`, so hover opens the game's own preview chain.
 *
 * A card in `missing` (no longer in this set), or one with no definition at all, keeps its slot greyed and labelled
 * "Missing or removed" (owner 2026-10-11), and is inert: no hover preview. The art stays when the card still exists.
 */
export function GuideUnits({ label, ids, views, refs, missing }: {
  label: string; ids: readonly string[]; views: Map<string, CardView>; refs: Map<string, CardView[]>; missing?: ReadonlySet<string>;
}): JSX.Element {
  return (
    <div className="lobbyguide-units">
      <div className="lobbyguide-unitslabel">{label}</div>
      <div className="lobbyguide-unitrow">
        {ids.map((id, i) => {
          const v = views.get(id);
          if (!v || missing?.has(id)) {
            return (
              <div className="lobbyguide-unit missing" key={`${id}-${i}`} role="img" aria-label={v ? `${v.name}: missing or removed` : 'Missing or removed card'}>
                {v
                  ? <div className="lobbyguide-unitscale"><Card card={v} forceCompact suppressPop /></div>
                  : <div className="lobbyguide-blank" />}
                <span className="lobbyguide-missing" aria-hidden="true">Missing or removed</span>
              </div>
            );
          }
          return <div className="lobbyguide-unit" key={`${id}-${i}`}><div className="lobbyguide-unitscale"><Card card={v} forceCompact suppressPop refCards={refs.get(id)} /></div></div>;
        })}
      </div>
    </div>
  );
}
```
3. In `linkCardNames`, the alias loop must not link a nickname for a card that was filtered out. Replace
```ts
  for (const [word, id] of Object.entries(aliases ?? {})) if (views.has(id)) byName.set(word.toLowerCase(), id);
```
with
```ts
  for (const [word, id] of Object.entries(aliases ?? {})) if (views.has(id) && ids.includes(id)) byName.set(word.toLowerCase(), id);
```

In `packages/ui/src/guides/CompendiumGuides.tsx`:

1. Change the imports `import type { Tribe } from '@game/core';` / `import { type Guide } from './guides';` to:
```ts
import type { Tribe } from '@game/core';
import type { SetId } from '@game/content';
import type { RunState } from '@game/sim';
import { guideMissingIds, type Guide } from './guides';
```
(keep the existing `RunState` import as the single one; do not duplicate it).
2. Add `setId` to `CompendiumGuides`' props and pass it down. The component signature becomes:
```tsx
export const CompendiumGuides = memo(function CompendiumGuides({ guides, tribes, run, setId }: {
  guides: readonly Guide[];
  /** The tribes the shown set (or run) has: a crossover chip shows only when its tribe is among them. */
  tribes: readonly Tribe[];
  /** The run to print live values from, only while the Compendium shows that run's own set. */
  run: RunState | undefined;
  /** The set being shown: a guide's card that is not in it greys out. */
  setId: SetId;
}): JSX.Element {
```
and the `LazyCell` child becomes `{() => <CompendiumGuide guide={g} tribes={tribes} run={run} setId={setId} />}`.
3. `CompendiumGuide` takes `setId: SetId` in its props, computes
```ts
  const missing = useMemo(() => guideMissingIds(guide, setId), [guide, setId]);
```
directly after the `useGuideViews` line, and passes `missing={missing}` to `GuideText` and to both `GuideUnits`.

In `packages/ui/src/MinionBook.tsx`, change
```tsx
            <CompendiumGuides guides={guidesToShow} tribes={tribes} run={liveRun} />
```
to
```tsx
            <CompendiumGuides guides={guidesToShow} tribes={tribes} run={liveRun} setId={setId} />
```

In `packages/ui/src/guides/LobbyGuides.tsx`:

1. Change `import { type Guide, type GuidesMode } from './guides';` to `import { guideMissingIds, type Guide, type GuidesMode } from './guides';`.
2. In `GuideBody`, directly after the `useGuideViews` line, add:
```ts
  const missing = useMemo(() => guideMissingIds(guide, run.setId), [guide, run.setId]);
```
and pass `missing={missing}` to `GuideText` and to both `GuideUnits`.

Append to `packages/ui/src/guides/lobbyGuides.css`:
```css
/* ── A CARD THAT LEFT (owner 2026-10-11: "lets grey out the card and say 'missing or removed'") ────────────────────
   A guide keeps a card that was archived out of the set or no longer exists. Its slot stays in the row, greyed and
   labelled, and is inert (no hover preview). STATIC filter on a handful of portraits: nothing here animates. */
.lobbyguide-unit.missing { pointer-events: none; }
.lobbyguide-unit.missing .lobbyguide-unitscale { filter: grayscale(1) brightness(0.5); }
/* No definition at all: an empty oval where the portrait would sit (the scaled card box, less the frame's overhang). */
.lobbyguide-blank {
  position: absolute; left: calc(var(--lgu-w) * 0.1); top: calc(var(--lgu-w) * 0.3); width: var(--lgu-w); height: calc(var(--lgu-w) * 1.05);
  border-radius: 50%; border: 2px dashed color-mix(in srgb, var(--ui-muted) 60%, transparent); background: rgba(0, 0, 0, 0.35);
}
.lobbyguide-missing {
  position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); text-align: center;
  font-family: var(--font-ui); font-size: calc(var(--lgu-w) * 0.13); line-height: 1.15; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ui-title); text-shadow: 0 1px 2px #000, 0 0 6px #000;
}
```

- [ ] **Step 4: Run the guide tests and the web typecheck**

Run: `npx vitest run packages/ui/src/guides && npm run typecheck:web`
Expected: PASS, no type errors.

- [ ] **Step 5: Run the tripwires this touches**

Run: `npx vitest run packages/ui/src/stageTripwire.test.ts && npm run lint`
Expected: PASS (no raw `vw` / `vh`, no `title=`).

- [ ] **Step 6: Show the owner the slot**

The greyed slot's geometry (label size, blank oval) is a first cut written without seeing it rendered; the owner judges it, and this step exists so it is not shipped on inference. From THIS worktree, run the dev server on a spare port (`npm run dev -- --port 5199`), confirm the served code is this branch by fetching `/@fs/<absolute path to this worktree>/packages/ui/src/guides/guides.ts` and checking it contains `guideMissingIds`, then in the page console run:

```js
// The SAME /@fs/ URL Vite serves the module under (no ?v= suffix), or this imports a second, empty copy of the store.
const s = await import('/@fs/<absolute path to this worktree>/packages/ui/src/guides/guidesStore.ts');
const list = s.useGuides.getState().list;
s.useGuides.setState({ list: [{ ...list[0], core: [...list[0].core, 'card_that_never_existed'], enablers: ['<ARCHIVED_ID>'] }, ...list.slice(1)] });
```

For `<ARCHIVED_ID>`, use the archived Fel Conjurer's card id: find it with `git grep -n "Fel Conjurer" packages/content/src`. Open the Compendium Guides tab, take one screenshot of the first guide, and send it to the owner with the question "is this the look you want for a missing card?". Record the answer in the PR body. Do not adjust the CSS without the owner's say.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/guides/GuideParts.tsx packages/ui/src/guides/CompendiumGuides.tsx packages/ui/src/guides/LobbyGuides.tsx packages/ui/src/MinionBook.tsx packages/ui/src/guides/lobbyGuides.css packages/ui/src/guides/guideMissing.test.tsx
git commit -m "feat(guides): a missing or removed card greys out in its slot"
```

---

### Task 10: Docs, full gates, pull request

**Files:**
- Create: `docs/devlog/2026-10-12-guides-storage.md`
- Modify: `supabase/README.md`

- [ ] **Step 1: Write the server runbook**

Append to `supabase/README.md`:
```markdown
## Guides on the server (2026-10-12)

Guides (Team Ascent's and, from the next steps, players') live in `public.guides`. Spec:
`docs/superpowers/specs/2026-10-11-community-guides-design.md`.

1. **Run the migration.** Paste `supabase/migrations/2026-10-12-guides.sql` into the SQL Editor and Run. It is
   idempotent and depends on nothing but `auth.users`.
2. **Add the team, once.** In the SQL Editor, with the two real emails typed in (never commit them):
   `insert into public.guide_team (user_id) select id from auth.users where email in ('<mike>', '<kc>') on conflict do nothing;`
   Then check it took: `select count(*) from public.guide_team;` should say 2.
3. **Deploy the function.** `npx supabase functions deploy guide-write`.

Until step 1 runs, the client reads "relation does not exist", treats guides as switched off, and shows its built-in
guides: shipping the client first is safe. Until the built-in guides are imported (a team-only button that arrives
with the editor), the table has no official rows and every player still sees the built-in guides.

`functions/guide-write` imports `_shared/guides*.ts`, which are GENERATED from `packages/guides/src` by
`npm run guides:shared` (CI fails if they drift, so never edit them by hand). The function is the only writer: the
tables have no client write policy.
```

- [ ] **Step 2: Write the devlog entry**

`docs/devlog/2026-10-12-guides-storage.md`:
```markdown
# 2026-10-12: Guides move to the server (step 1 of 4)

Owner ask (2026-10-11): "i'd like the ability to edit existing guides while in game and save them. The existing
[guides] are written by 'Team Ascent' and should only be able to be modified by myself and KC. outside of that, one
should be able to create a new guide either from scratch or by duplicating an existing guide."

Spec: `docs/superpowers/specs/2026-10-11-community-guides-design.md`. Plan:
`docs/superpowers/plans/2026-10-11-community-guides-1-storage.md`. This is the storage and reading step. Nothing a
player sees changes yet: the editor is step 2, publishing step 3, moderation step 4.

## What shipped

- **`@game/guides`** (`packages/guides/`): wire types, the owner's limits, draft validation, the game's first word
  filter, the set carry-over rule, and the `guide-write` handler. Dependency-free; `npm run guides:shared` generates
  the Deno copies and a test fails CI when they drift.
- **Database** (`supabase/migrations/2026-10-12-guides.sql`): `guides`, `guide_team`, `guide_bookmarks`,
  `guide_reports`. Read under row-level security (official, or published and not hidden, or your own, or you are on
  the team). No client write policy: `guide_save`, `guide_delete` and `guide_import_builtins` are the only writers
  and only the service role may call them. They hold the row rules: official = team only, 20 guides per player, 30
  saves an hour, a stale revision is a conflict.
- **`guide-write`** Edge Function: verifies the token, refuses guests, refuses a body over 64 KB before parsing it,
  then runs the handler.
- **Client**: `guidesStore` loads the official guides in the background when identity lands; the eleven built-in
  guides (`guides.bundled.ts`) show until the server answers with at least one usable guide. The rail takes a
  snapshot when its Guides view opens, so a refresh never moves a card under the reader; the Compendium subscribes.
- **Sets**: a guide carries `sets` instead of one `set`. `guidesFor` filters on it.
- **A card that left**: its portrait stays in the row, greyed and labelled "Missing or removed", with no hover.

## Decisions that differ from the spec

1. The art icon does not count toward set membership (the Imps guide's icon is a token in no set's pool).
2. Official guides keep today's order (`sort_order`, grouped by first tribe in order of first appearance) rather than
   following the set's tribe roster, which would have reordered the rail.
3. A dropped connection keeps the last loaded list rather than falling back to the built-in copies mid-session.
4. `store.ts` gets the boot call (two lines).
5. The import button waits for step 2; the op and its tests are here.
6. `guides.author_id` is nullable and `on delete set null`, so a team member leaving cannot delete Team Ascent guides.

## Owner actions before step 2 can be used

Run the migration, add the two team accounts, deploy `guide-write` (`supabase/README.md`, "Guides on the server").

## Not verified here

Row-level security and the write functions are executed against PGlite, not the live project. The live check (a
private guide unreadable by a second account) is in the step 2 plan, when there is a way to create one.
```

- [ ] **Step 3: Run every gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all four green. Paste the tail of each into the PR body. If `npm test` fails in a file this branch did not touch, check `git status` and `git branch --show-current` before concluding anything: a wrong-branch or missing-`npm install` worktree produces exactly that.

- [ ] **Step 4: Measure the Guides tab**

On the production build (`npm run build:web`, served; not `npm run dev`), open the Compendium Guides tab and the rail's Guides view with DevTools Performance recording, per `docs/performance.md`. Compare against the 2026-10-09 devlog ("no long task over 50 ms" opening Guides). Add the numbers to the devlog entry under a `## Performance` heading. A regression is a defect: stop and report it.

- [ ] **Step 5: Commit, push, open the pull request**

```bash
git add docs/devlog/2026-10-12-guides-storage.md supabase/README.md
git commit -m "docs(guides): server runbook and devlog for guides storage"
git fetch origin && git rebase origin/main
git push -u origin feat/guides-storage
gh pr create --title "feat(guides): guides move to the server (storage and reading, step 1 of 4)" --body-file <path to a file holding the body below>
```

PR body: the devlog's "What shipped" and "Decisions that differ from the spec" sections; the gate output; the performance numbers; the owner's answer on the missing-card look; and this line at the top: `@kcodea this adds a migration, a block in schema.sql and a new Edge Function on your side of the ownership map. Nothing is live until the migration is run.`

Do **not** arm auto-merge on this PR: it adds server tables and Kevin should see it first. After `verify` is green and Kevin has looked, `gh pr merge --squash`.

---

## Self-review notes (for the reader, not a task)

- Spec section 9 step 1 lists: the migration (Task 4), `@game/guides` (Tasks 1 to 3, 5), `guide-write` with `save` / `delete` / `importBuiltIns` (Task 5), `guidesRemote` + `guidesStore` (Tasks 7, 8), the bundled fallback split and `sets`-based `guidesFor` (Task 6), the missing-card slot (Task 9), the word filter on every save (Tasks 2, 5), `supabase/README.md` (Task 10).
- Not in this step, by the spec: the editor, the team flag on the client, My guides / Saved / Community pills, `setPublished`, bookmarks, reports, hide, carry-over, `guides:pull`, retiring the owner's title and card pins, patch notes (nothing a player sees changes), the rules wiki entry.
- No oracle rule is added: this is a feature, not a bug fix. R-NET-01 is honoured by the read seam and re-checked in Tasks 5 and 7.
