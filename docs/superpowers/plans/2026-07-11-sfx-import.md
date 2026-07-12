# SFX Drop-Folder Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run sfx:import` — move loosely-named `.mp3` clips from `audio-inbox/` into their exact `packages/ui/src/audio/…` target, resolving display-name/id + variant word (Pennycat→`alley`, Yirin→`rohan`), moving confident matches and reporting the rest.

**Architecture:** A pure, unit-tested matcher (`sfx-import.lib.ts`) that turns a filename into a target path using an index built from `ALL_CARDS`/`HEROES`, plus a thin fs runner (`sfx-import.ts`) that reads the inbox, applies confident matches, prints a report, and best-effort runs the manifest regen. Self-contained — no dependency on the (unmerged) manifest generator.

**Tech Stack:** TypeScript, `tsx` runner (like the other `packages/tools` scripts), Vitest (`packages/**/*.test.ts`), Node fs.

---

## File Structure

- **Create** `packages/tools/src/sfx-import.lib.ts` — pure: `slugify`, `levenshtein`, `buildIndex`, `parseName`, `resolveId`, `matchFile`. No fs, no `@game/*` imports.
- **Create** `packages/tools/src/sfx-import.lib.test.ts` — Vitest over the pure matcher.
- **Create** `packages/tools/src/sfx-import.ts` — runner: reads `audio-inbox/`, moves/copies, reports, regen.
- **Modify** `package.json` — add the `sfx:import` script.
- **Modify** `.gitignore` — ignore `audio-inbox/`.

---

## Task 1: Pure matcher library + tests

**Files:**
- Create: `packages/tools/src/sfx-import.lib.ts`
- Test: `packages/tools/src/sfx-import.lib.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/tools/src/sfx-import.lib.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { slugify, parseName, resolveId, matchFile, buildIndex, type MatchCard, type MatchHero } from './sfx-import.lib';

const cards: MatchCard[] = [
  { id: 'alley', name: 'Pennycat', effects: [{ on: 'onPlay' }] },
  { id: 'pack', name: 'Mama Pup', effects: [{ on: 'onDeath' }] },
  { id: 'plain', name: 'Plain Beast', effects: [] },
];
const heroes: MatchHero[] = [
  { id: 'warden', name: 'Warden' },
  { id: 'rohan', name: 'Yirin' }, // id kept stable; display name differs
];
const index = buildIndex(cards, heroes);
const m = (fn: string) => matchFile(fn, index);

describe('slugify + parseName', () => {
  it('slugifies to lowercase alphanumerics', () => {
    expect(slugify('Mama Pup!')).toBe('mamapup');
    expect(slugify('Yirin')).toBe('yirin');
  });
  it('pulls a trailing variant word across separators', () => {
    expect(parseName('Pennycat death.mp3')).toEqual({ variant: 'death', phraseSlug: 'pennycat' });
    expect(parseName('alley.death.mp3')).toEqual({ variant: 'death', phraseSlug: 'alley' });
    expect(parseName('warden_power.mp3')).toEqual({ variant: 'power', phraseSlug: 'warden' });
    expect(parseName('Yirin.mp3')).toEqual({ variant: null, phraseSlug: 'yirin' });
  });
  it('does not treat a leading/embedded variant word as the variant', () => {
    expect(parseName('Death Knight.mp3')).toEqual({ variant: null, phraseSlug: 'deathknight' });
  });
});

describe('resolveId', () => {
  it('matches an exact id, an exact display name, and a fuzzy typo', () => {
    expect(resolveId('alley', index)).toMatchObject({ id: 'alley', kind: 'card', confidence: 'exact' });
    expect(resolveId('pennycat', index)).toMatchObject({ id: 'alley', kind: 'card', confidence: 'exact' });
    expect(resolveId('yirin', index)).toMatchObject({ id: 'rohan', kind: 'hero', confidence: 'exact' });
    expect(resolveId('penycat', index)).toMatchObject({ id: 'alley', confidence: 'fuzzy' });
  });
  it('returns suggestions when nothing is close', () => {
    const r = resolveId('zzzzzzz', index);
    expect('id' in r).toBe(false);
    expect((r as { suggestions: string[] }).suggestions.length).toBeGreaterThan(0);
  });
});

describe('matchFile', () => {
  it('maps each variant to the right target', () => {
    expect(m('Pennycat death.mp3')).toMatchObject({ ok: true, target: 'cards/alley.death.mp3' });
    expect(m('mama pup death.mp3')).toMatchObject({ ok: true, target: 'cards/pack.death.mp3' });
    expect(m('alley effect.mp3')).toMatchObject({ ok: true, target: 'cards/alley.effect.mp3' });
    expect(m('alley.mp3')).toMatchObject({ ok: true, target: 'cards/alley.mp3' });
    expect(m('warden power.mp3')).toMatchObject({ ok: true, target: 'heroes/warden.power.mp3' });
    expect(m('Yirin.mp3')).toMatchObject({ ok: true, target: 'heroes/rohan.mp3', variant: 'select' });
  });
  it('rejects a .effect clip for a vanilla minion', () => {
    const r = m('plain effect.mp3');
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/no effect/);
  });
  it('rejects a minion-variant on a hero', () => {
    const r = m('warden death.mp3');
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/hero/);
  });
  it('passes an already-correct exact basename straight through', () => {
    expect(m('rohan.power.mp3')).toMatchObject({ ok: true, target: 'heroes/rohan.power.mp3' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/tools/src/sfx-import.lib.test.ts`
Expected: FAIL — `Cannot find module './sfx-import.lib'`.

- [ ] **Step 3: Write the implementation**

Create `packages/tools/src/sfx-import.lib.ts`:

```ts
/**
 * Pure matcher for `npm run sfx:import`. No fs / no `@game/*` imports — every function is pure over plain
 * inputs, so the tests run on fixtures. The runner (`sfx-import.ts`) feeds `buildIndex` the real card/hero
 * data and does the file moving.
 */

export type Variant = 'play' | 'death' | 'effect' | 'select' | 'power';

/** Minimal shape the matcher needs from a CardDef / HeroDef. */
export interface MatchCard { id: string; name: string; effects: { on?: string }[] }
export interface MatchHero { id: string; name: string }

export interface ImportIndex {
  cardIds: Set<string>;
  heroIds: Set<string>;
  effectCardIds: Set<string>;             // cards with any effect trigger → eligible for a .effect clip
  nameToCard: Map<string, string>;        // slug(displayName) → cardId
  nameToHero: Map<string, string>;        // slug(displayName) → heroId
  cardEntries: { slug: string; id: string }[]; // id-slug + name-slug per card, for fuzzy
  heroEntries: { slug: string; id: string }[];
}

export interface Resolved { id: string; kind: 'card' | 'hero'; confidence: 'exact' | 'fuzzy' }
export type MatchOk = { ok: true; target: string; id: string; kind: 'card' | 'hero'; variant: Variant; confidence: 'exact' | 'fuzzy' };
export type MatchNo = { ok: false; reason: string; suggestions: string[] };

/** Lowercase alphanumerics only — the join key for ids and display names. */
export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
}

const SEP = /[\s._\-]+/;
const VARIANT: Record<string, Variant> = {
  death: 'death',
  effect: 'effect', battlecry: 'effect', deathrattle: 'effect', shout: 'effect', echo: 'effect',
  power: 'power', heropower: 'power',
  select: 'select', pick: 'select', choose: 'select',
  play: 'play', cast: 'play',
};

/** Split a filename into a trailing variant word (if any) + the remaining name/id phrase (slugged). */
export function parseName(basename: string): { variant: Variant | null; phraseSlug: string } {
  const stem = basename.replace(/\.[a-z0-9]+$/i, '');
  const tokens = stem.split(SEP).filter(Boolean).map((t) => t.toLowerCase());
  let variant: Variant | null = null;
  if (tokens.length > 1 && VARIANT[tokens[tokens.length - 1]]) {
    variant = VARIANT[tokens.pop() as string];
  }
  return { variant, phraseSlug: slugify(tokens.join('')) };
}

export function buildIndex(cards: MatchCard[], heroes: MatchHero[]): ImportIndex {
  return {
    cardIds: new Set(cards.map((c) => c.id)),
    heroIds: new Set(heroes.map((h) => h.id)),
    effectCardIds: new Set(cards.filter((c) => c.effects.some((e) => e.on)).map((c) => c.id)),
    nameToCard: new Map(cards.map((c) => [slugify(c.name), c.id])),
    nameToHero: new Map(heroes.map((h) => [slugify(h.name), h.id])),
    cardEntries: cards.flatMap((c) => [{ slug: c.id, id: c.id }, { slug: slugify(c.name), id: c.id }]),
    heroEntries: heroes.flatMap((h) => [{ slug: h.id, id: h.id }, { slug: slugify(h.name), id: h.id }]),
  };
}

/** Classic Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** Resolve a name/id phrase to a card or hero: exact id → exact display name → conservative fuzzy. */
export function resolveId(phraseSlug: string, index: ImportIndex): Resolved | { suggestions: string[] } {
  if (!phraseSlug) return { suggestions: [] };
  const c = index.cardIds.has(phraseSlug) ? phraseSlug : index.nameToCard.get(phraseSlug);
  if (c) return { id: c, kind: 'card', confidence: 'exact' };
  const h = index.heroIds.has(phraseSlug) ? phraseSlug : index.nameToHero.get(phraseSlug);
  if (h) return { id: h, kind: 'hero', confidence: 'exact' };
  const all = [
    ...index.cardEntries.map((e) => ({ ...e, kind: 'card' as const })),
    ...index.heroEntries.map((e) => ({ ...e, kind: 'hero' as const })),
  ];
  let best: (typeof all)[number] | null = null, bestD = Infinity, second = Infinity;
  for (const e of all) {
    const d = levenshtein(phraseSlug, e.slug);
    if (d < bestD) { second = bestD; bestD = d; best = e; }
    else if (d < second) second = d;
  }
  const thr = phraseSlug.length >= 4 ? 2 : 1;             // conservative: short strings must be near-exact
  if (best && bestD <= thr && bestD < second) return { id: best.id, kind: best.kind, confidence: 'fuzzy' };
  const suggestions = [...new Set(
    all.map((e) => ({ id: e.id, d: levenshtein(phraseSlug, e.slug) })).sort((a, b) => a.d - b.d).map((x) => x.id),
  )].slice(0, 3);
  return { suggestions };
}

/** Resolve one dropped filename to a concrete target path (or an explained non-match). */
export function matchFile(basename: string, index: ImportIndex): MatchOk | MatchNo {
  const { variant, phraseSlug } = parseName(basename);
  const r = resolveId(phraseSlug, index);
  if (!('id' in r)) return { ok: false, reason: `couldn't match "${phraseSlug || basename}"`, suggestions: r.suggestions };
  const v: Variant = variant ?? (r.kind === 'hero' ? 'select' : 'play');
  if ((v === 'power' || v === 'select') && r.kind === 'card')
    return { ok: false, reason: `"${v}" is a hero sound but ${r.id} is a minion`, suggestions: [] };
  if ((v === 'death' || v === 'effect' || v === 'play') && r.kind === 'hero')
    return { ok: false, reason: `"${v}" is a minion sound but ${r.id} is a hero`, suggestions: [] };
  let target: string;
  if (r.kind === 'hero') target = v === 'power' ? `heroes/${r.id}.power.mp3` : `heroes/${r.id}.mp3`;
  else if (v === 'death') target = `cards/${r.id}.death.mp3`;
  else if (v === 'effect') {
    if (!index.effectCardIds.has(r.id)) return { ok: false, reason: `${r.id} has no effect to voice (vanilla minion)`, suggestions: [] };
    target = `cards/${r.id}.effect.mp3`;
  } else target = `cards/${r.id}.mp3`;
  return { ok: true, target, id: r.id, kind: r.kind, variant: v, confidence: r.confidence };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/tools/src/sfx-import.lib.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/sfx-import.lib.ts packages/tools/src/sfx-import.lib.test.ts
git commit -m "feat(tools): sfx-import matcher — resolve a clip filename to its audio target"
```

---

## Task 2: Runner + npm script + .gitignore

**Files:**
- Create: `packages/tools/src/sfx-import.ts`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write the runner**

Create `packages/tools/src/sfx-import.ts`:

```ts
/**
 * `npm run sfx:import` — move recorded clips from audio-inbox/ into packages/ui/src/audio/ at their exact
 * target names. Confident matches move; ambiguous ones stay put and are reported. Flags: --dry (preview),
 * --keep (copy not move), --force (overwrite existing), --no-manifest (skip the status refresh),
 * --inbox <dir> (override the drop folder).
 */
import { readdirSync, existsSync, mkdirSync, writeFileSync, renameSync, copyFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { NEUTRAL, BEASTS, DRAGONS, UNDEAD, MECHS, DEMONS, TOKENS, SPELLS } from '@game/content';
import { HEROES } from '@game/sim';
import { buildIndex, matchFile, type MatchCard, type MatchHero } from './sfx-import.lib';

const args = process.argv.slice(2);
const has = (n: string): boolean => args.includes(`--${n}`);
const flag = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const dry = has('dry'), keep = has('keep'), force = has('force'), noManifest = has('no-manifest');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const INBOX = resolve(ROOT, flag('inbox') ?? 'audio-inbox');
const AUDIO = resolve(ROOT, 'packages/ui/src/audio');

if (!existsSync(INBOX)) {
  mkdirSync(INBOX, { recursive: true });
  writeFileSync(resolve(INBOX, 'README.txt'),
    'Drop recorded .mp3 clips here, named by card/hero name (or id) + a variant word:\n' +
    '  Pennycat death.mp3   warden power.mp3   alley effect.mp3   Yirin.mp3\n' +
    'Then run:  npm run sfx:import\n');
  console.log(`Created ${INBOX} — drop your .mp3 clips there, then re-run \`npm run sfx:import\`.`);
  process.exit(0);
}

const cards = [...NEUTRAL, ...BEASTS, ...DRAGONS, ...UNDEAD, ...MECHS, ...DEMONS, ...TOKENS, ...SPELLS] as unknown as MatchCard[];
const index = buildIndex(cards, HEROES as unknown as MatchHero[]);

const entries = readdirSync(INBOX).filter((f) => !f.startsWith('.') && f !== 'README.txt');
const moved: string[] = [], skipped: string[] = [], unmatched: string[] = [];

for (const f of entries) {
  if (!f.toLowerCase().endsWith('.mp3')) { skipped.push(`${f}  — not an .mp3 (export as mp3)`); continue; }
  const r = matchFile(f, index);
  if (!r.ok) { unmatched.push(`${f}  — ${r.reason}${r.suggestions.length ? `  (did you mean: ${r.suggestions.join(', ')}?)` : ''}`); continue; }
  const dest = resolve(AUDIO, r.target);
  if (existsSync(dest) && !force) { skipped.push(`${f}  — ${r.target} already exists (use --force to overwrite)`); continue; }
  if (!dry) {
    mkdirSync(dirname(dest), { recursive: true });
    const src = resolve(INBOX, f);
    if (keep) copyFileSync(src, dest);
    else { try { renameSync(src, dest); } catch { copyFileSync(src, dest); rmSync(src); } } // cross-device fallback
  }
  moved.push(`${f}  →  ${r.target}${r.confidence === 'fuzzy' ? '  (fuzzy)' : ''}`);
}

const head = dry ? 'DRY RUN — nothing moved' : keep ? 'Imported (copied)' : 'Imported';
console.log(`\n${head}: ${moved.length} · skipped: ${skipped.length} · unmatched: ${unmatched.length}\n`);
if (moved.length) console.log(`  ${dry ? 'would move' : 'moved'}:\n` + moved.map((s) => '    ' + s).join('\n'));
if (skipped.length) console.log(`\n  skipped:\n` + skipped.map((s) => '    ' + s).join('\n'));
if (unmatched.length) console.log(`\n  left in inbox (rename & re-run):\n` + unmatched.map((s) => '    ' + s).join('\n'));

if (moved.length && !dry && !noManifest) {
  try { await import('./sfx-manifest.ts'); } // regenerate statuses if the generator is present on this branch
  catch { console.log('\nNext: run `npm run sfx:manifest` to refresh the manifest statuses.'); }
} else if (!dry && moved.length) {
  console.log('\nNext: run `npm run sfx:manifest` to refresh the manifest statuses.');
}
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"` (next to the other `packages/tools` runners):

```json
    "sfx:import": "tsx packages/tools/src/sfx-import.ts",
```

- [ ] **Step 3: Ignore the drop folder**

Append to `.gitignore`:

```gitignore
# Audio import drop folder (see npm run sfx:import)
audio-inbox/
```

- [ ] **Step 4: Smoke-run: it creates the inbox**

Run: `npm run sfx:import`
Expected: prints `Created …/audio-inbox — drop your .mp3 clips there…` and the folder now exists with a `README.txt`. (No clips yet, so nothing to move.)

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/sfx-import.ts package.json .gitignore
git commit -m "feat(tools): sfx:import runner — drop-folder importer + npm script"
```

---

## Task 3: End-to-end verification + docs

**Files:** none created — verification + docs only.

- [ ] **Step 1: Verify a real dry-run resolves fixtures correctly**

Create three empty placeholder files in the inbox and dry-run (this exercises the runner end to end against real card/hero data without moving anything):

```bash
cd packages/ui/src/audio >/dev/null 2>&1; cd - >/dev/null   # ensure audio dir exists
touch audio-inbox/"Pennycat death.mp3" audio-inbox/"warden power.mp3" audio-inbox/"zzzz effect.mp3"
npm run sfx:import -- --dry
```
Expected: the report shows
`Pennycat death.mp3 → cards/alley.death.mp3`, `warden power.mp3 → heroes/warden.power.mp3` under "would move",
and `zzzz effect.mp3` under "left in inbox" with a suggestion. Nothing is actually moved (dry).

- [ ] **Step 2: Verify a real move + collision handling**

```bash
npm run sfx:import --no-manifest        # moves the two matched placeholders into packages/ui/src/audio/
ls packages/ui/src/audio/cards/alley.death.mp3 packages/ui/src/audio/heroes/warden.power.mp3
npm run sfx:import --no-manifest        # (inbox now only has the unmatched one) → 0 moved
```
Expected: first run moves 2 files (leaves `zzzz effect.mp3`); the target files now exist. Second run moves 0.

- [ ] **Step 3: Clean up the placeholder files (they are empty, not real clips)**

```bash
rm -f packages/ui/src/audio/cards/alley.death.mp3 packages/ui/src/audio/heroes/warden.power.mp3
rm -f audio-inbox/"zzzz effect.mp3"
git status --porcelain    # expect: clean except tracked source changes; audio-inbox/ is gitignored
```
Expected: no stray empty `.mp3` files remain under `packages/ui/src/audio/`; `git status` shows nothing under `audio-inbox/` (ignored).

- [ ] **Step 4: Full green gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all pass (incl. the new `sfx-import.lib.test.ts`).

- [ ] **Step 5: Update the dev log + roadmap + README**

Prepend a dated entry to `docs/devlog.md` (the importer: what/why, the smart matcher, verified via dry-run + lib tests), update the audio item in `docs/roadmap.md` (importer shipped; recording flow is now drag-into-folder + `npm run sfx:import`), and add a README "Recent changes" bullet. Then:

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: devlog + roadmap + README for sfx:import"
```

---

## Self-Review

**Spec coverage:**
- Workflow (inbox → import → move → regen) → Task 2 runner + Task 3 verify. ✅
- Naming→target rules (variant table, card/hero decision) → `parseName` + `matchFile` (Task 1). ✅
- `buildIndex`/`parseName`/`resolveId`/`matchFile` architecture → Task 1. ✅
- Confident-move / ambiguous-report, collision skip, non-mp3 skip, vanilla-`.effect` skip, `--dry/--keep/--force/--inbox`, auto-regen best-effort → Task 2 runner. ✅
- Tests (parseName across separators, resolveId exact/name/fuzzy/suggestions, matchFile per-variant + hero + vanilla + exact passthrough) → Task 1 Step 1. ✅
- Out-of-scope (no conversion, no TUI, no artifact-write) → not present. ✅
- Open decisions: auto-regen **on** (best-effort, `--no-manifest` to skip); fuzzy **conservative** (`≤2` for len≥4, must beat runner-up); **move** default (`--keep` copies) — all implemented as the spec's assumed defaults.

**Placeholder scan:** No TBD/TODO; every code step has complete code; every command has an expected result. ✅

**Type consistency:** `MatchCard`/`MatchHero`/`ImportIndex`/`Resolved`/`MatchOk`/`MatchNo`/`Variant` and the functions `slugify`/`levenshtein`/`buildIndex`/`parseName`/`resolveId`/`matchFile` are used identically across the lib, its test, and the runner. The runner reads `r.ok`/`r.target`/`r.reason`/`r.suggestions`/`r.confidence` exactly as typed on `MatchOk`/`MatchNo`. ✅
