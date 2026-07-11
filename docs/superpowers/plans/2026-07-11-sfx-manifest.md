# SFX Manifest & Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single sound-effects manifest (`docs/audio/sfx-manifest.md`) whose Filename+Trigger rows are generated from the real card/hero/spell data by `npm run sfx:manifest`, while the human-owned Creative-brief + Status columns survive every regeneration.

**Architecture:** A pure logic library (`sfx-manifest.lib.ts`, unit-tested with fixtures — no data/fs imports, so it never needs `@game/sim` resolution) plus a thin runner (`sfx-manifest.ts`) that imports the real data + does fs read/merge/write. The doc has a hand-authored prose zone (overview, naming conventions, wiring plan) above a marker, and a generated zone (the tables) below it that the runner alone rewrites.

**Tech Stack:** TypeScript, `tsx` runner (matches the other `packages/tools` scripts), Vitest (`packages/**/*.test.ts`), Node fs.

**Scope note:** This plan delivers the manifest doc + generator. The *implementation* of the new audio hooks (per-card death/effect, hero select/power, spell default bed) is documented as prose in Task 1 but built in a **separate follow-up plan** — it has a different testing profile (choreo-channel tests + live preview) and depends on assets existing.

---

## File Structure

- **Create** `docs/audio/sfx-manifest.md` — the manifest. Prose zone (hand-authored) + generated zone (tables).
- **Create** `packages/tools/src/sfx-manifest.lib.ts` — pure row-derivation, table parse, merge, render. No imports of `@game/*` or `node:fs`.
- **Create** `packages/tools/src/sfx-manifest.lib.test.ts` — Vitest for the pure lib.
- **Create** `packages/tools/src/sfx-manifest.ts` — runner: imports `@game/content` + `@game/sim`, reads/merges/writes the doc, scans the audio dir for status.
- **Modify** `package.json` — add the `sfx:manifest` script.

---

## Task 1: Manifest prose zone (hand-authored)

Creates the doc with everything above the generated marker. The runner (Task 3) refuses to run if the marker is absent, so this must land first.

**Files:**
- Create: `docs/audio/sfx-manifest.md`

- [ ] **Step 1: Write the prose zone + marker**

Create `docs/audio/sfx-manifest.md` with exactly this content (the final line is the marker the generator keys on — nothing may follow it in this commit):

```markdown
# ASCENT — Sound-Effects Manifest

> **Generated file.** The tables below the marker are (re)built by `npm run sfx:manifest` from the real
> card / hero / spell data. **Edit only the `Creative brief` and `Status` columns** — they're preserved
> across regenerations. `Filename` and `Trigger` are authoritative and will be overwritten. Everything
> ABOVE the marker is hand-authored and never touched by the generator.

## How the audio system works

`packages/ui/src/sfx.ts` is a Web-Audio sound bank: named cues, each an mp3 sample with a synth fallback,
routed through a master limiter + mute bus, with per-clip volumes (dev SFX mixer) and dedupe throttles on
combat cues. Samples are globbed from `audio/*.mp3` and `audio/cards/*.mp3` and keyed by path-minus-`.mp3`.

**Layering model.** A generic *bed* always plays for an action (landing, cast, death, summon); the per-card
clip layers on top when present. Every per-card / per-hero clip is **optional** — a missing file is silent,
never an error. So this manifest can be filled in gradually, one sound at a time.

## Naming conventions (the filename *is* the contract)

| Sound | File | Fires when | Wired today? |
|---|---|---|---|
| Minion **play** | `audio/cards/<id>.mp3` | minion played to board (over landing bed) | ✅ yes (`sfx.cardVoice`) |
| Minion **death** | `audio/cards/<id>.death.mp3` | that minion dies in combat | ⚠️ needs hook |
| Card **effect** | `audio/cards/<id>.effect.mp3` | signature effect procs (Battlecry in shop, or Deathrattle / Start-of-Combat / trigger in combat) | ⚠️ needs hook |
| Spell **unique cast** | `audio/cards/<id>.mp3` | spell cast (over default bed) | ✅ yes (spells use `cardVoice`) |
| Spell **default bed** | `audio/spellcast.mp3` | any spell cast | ⚠️ replace synth `castSpell()` |
| Hero **select** | `audio/heroes/<id>.mp3` | hero picked in Hero Select | ⚠️ needs hook |
| Hero **power** | `audio/heroes/<id>.power.mp3` | that hero's power activates | ⚠️ needs hook |

Dotted variants (`<id>.death.mp3`) live in `cards/` and already match the `cards/*.mp3` glob — `sampleName()`
strips only the trailing `.mp3`, so the key becomes `cards/<id>.death`. The `heroes/` folder is a new glob.

Status legend: `⬜` to record · `🎙️` recorded (file in tree) · `✅` recorded + wired · `➖` N/A (vanilla card, no effect to proc).

## Wiring plan (the hooks that don't exist yet — built in a follow-up PR)

Each hook is additive and guarded by "clip present?", so it stays silent until you drop the asset.

1. **Spell default bed** — route `sfx.castSpell()` to a real `spellcast` sample (keep the synth fallback).
   *File:* `packages/ui/src/sfx.ts`. Per-spell unique clips already fire via `cardVoice` in `store.ts`.
2. **Minion death (per-card)** — in `playMomentSfx` (`packages/ui/src/choreo/channels/sfx.ts`), on a
   non-Rise `death` event, also play `cards/<cardId>.death.mp3`. The dead unit's uid is `e.target`; map it
   to a cardId via the replay's `cardIds` map (`packages/ui/src/useCombatReplay.ts:391`), which must be
   threaded into the channel.
3. **Card effect (per-card)** — one clip, two proc sites:
   - *Combat:* at the `sfx.triggerPulse()` sites (`useCombatReplay.ts:572,752`), also fire
     `cards/<cardId>.effect.mp3` for the effect's source uid (via `cardIds`), deduped like the pulse.
   - *Shop:* in `store.ts`'s `play` case (the block that already inspects `onPlay` effects for a `tokenId`),
     fire `cards/<cardId>.effect.mp3` when the played card has any `onPlay` effect.
4. **Hero select** — `packages/ui/src/HeroSelect.tsx:53` (`pickHero(id)` onClick): play `heroes/<id>.mp3`.
5. **Hero power** — `packages/ui/src/StatusBar.tsx:176` (currently `sfx.pulse()`): branch to
   `heroes/<heroId>.power.mp3` when present, else the generic pulse. Needs the active hero's id in scope.
6. **Loader** — add `./audio/heroes/*.mp3` to the `import.meta.glob` set in `sfx.ts`; add `sampleVol`
   defaults for the new categories.

<!-- GENERATED BELOW — edit the Creative brief + Status columns only; Filename/Trigger are regenerated. -->
```

- [ ] **Step 2: Commit**

```bash
git add docs/audio/sfx-manifest.md
git commit -m "docs: SFX manifest prose zone (overview, naming, wiring plan)"
```

---

## Task 2: Generator pure library + tests

The heart. Pure functions over plain inputs — fixtures in the test, no `@game/*` or fs.

**Files:**
- Create: `packages/tools/src/sfx-manifest.lib.ts`
- Test: `packages/tools/src/sfx-manifest.lib.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/tools/src/sfx-manifest.lib.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  deriveRows, mergeRows, parseExistingTables, renderGeneratedZone, GEN_MARKER,
  type ManifestCard, type ManifestHero,
} from './sfx-manifest.lib';

const cat: ManifestCard = { id: 'alley', name: 'Pennycat', tribe: 'beast', effects: [{ on: 'onPlay', do: 'battlecrySummon' }] };
const vanilla: ManifestCard = { id: 'plain', name: 'Plain Beast', tribe: 'beast', effects: [] };
const tokenCard: ManifestCard = { id: 'stray', name: 'Stray', tribe: 'beast', token: true, effects: [] };
const spell: ManifestCard = { id: 'spiritfire', name: 'Spirit Fire', tribe: 'neutral', spell: true, effects: [{ on: 'onPlay', do: 'spellBuffTarget' }] };
const hero: ManifestHero = { id: 'warden', name: 'Warden', power: { name: 'Aegis' } };

describe('deriveRows', () => {
  const rows = deriveRows([cat, vanilla, tokenCard, spell], [hero], ['buy1.mp3', 'roll.mp3']);
  const byFile = (f: string) => rows.find((r) => r.filename === f)!;

  it('gives a minion three rows: play, death, effect', () => {
    expect(byFile('cards/alley.mp3').section).toBe('Beasts');
    expect(byFile('cards/alley.mp3').trigger).toMatch(/Played/);
    expect(byFile('cards/alley.death.mp3').trigger).toMatch(/Dies/);
    expect(byFile('cards/alley.effect.mp3').trigger).toMatch(/Battlecry/);
  });

  it('marks a vanilla minion\'s effect row N/A', () => {
    const eff = byFile('cards/plain.effect.mp3');
    expect(eff.status).toBe('➖');
    expect(eff.trigger).toMatch(/Vanilla/);
  });

  it('puts tokens in Tokens and spells in Spells (spell = one cast row)', () => {
    expect(byFile('cards/stray.mp3').section).toBe('Tokens');
    expect(byFile('cards/spiritfire.mp3').section).toBe('Spells');
    expect(rows.filter((r) => r.filename.startsWith('cards/spiritfire')).length).toBe(1);
  });

  it('gives a hero select + power rows, and a spell default bed + system rows', () => {
    expect(byFile('heroes/warden.mp3').trigger).toMatch(/selected/);
    expect(byFile('heroes/warden.power.mp3').trigger).toMatch(/Aegis/);
    expect(byFile('spellcast.mp3').section).toBe('Spells');
    expect(byFile('buy1.mp3').section).toBe('System / UI');
    expect(byFile('buy1.mp3').status).toBe('✅');
  });
});

describe('merge round-trip preserves human columns', () => {
  it('carries brief + status from an existing rendered table, seeds new rows', () => {
    const first = deriveRows([cat], [], []);
    const edited = renderGeneratedZone(first.map((r) =>
      r.filename === 'cards/alley.mp3' ? { ...r, brief: 'my custom meow', status: '✅' } : r));
    const parsed = parseExistingTables(edited);
    const merged = mergeRows(deriveRows([cat, vanilla], [], []), parsed);
    const play = merged.find((r) => r.filename === 'cards/alley.mp3')!;
    expect(play.brief).toBe('my custom meow');
    expect(play.status).toBe('✅');
    // a genuinely new card gets the seeded brief + default status
    expect(merged.find((r) => r.filename === 'cards/plain.mp3')!.status).toBe('⬜');
  });
});

describe('renderGeneratedZone', () => {
  it('emits a table per non-empty section and escapes pipes', () => {
    const md = renderGeneratedZone(deriveRows([cat], [], []));
    expect(md).toMatch(/### Beasts \(3\)/);
    expect(md).toMatch(/\| Filename \| Trigger \| Creative brief \| Status \|/);
    expect(md).not.toContain(GEN_MARKER); // the zone does not include the marker itself
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/tools/src/sfx-manifest.lib.test.ts`
Expected: FAIL — `Cannot find module './sfx-manifest.lib'`.

- [ ] **Step 3: Write the implementation**

Create `packages/tools/src/sfx-manifest.lib.ts`:

```ts
/**
 * Pure logic for the SFX manifest generator (`npm run sfx:manifest`). No fs / no `@game/*` imports here —
 * every function is pure over plain inputs, so the tests run with fixtures and never need `@game/sim` alias
 * resolution. The runner (`sfx-manifest.ts`) feeds these the real data and does the fs read/write.
 */

export type SfxStatus = '⬜' | '🎙️' | '✅' | '➖';

export interface SfxRow {
  section: string;
  filename: string;
  trigger: string;
  brief: string;
  status: SfxStatus;
}

/** Minimal shape the generator needs from a CardDef (decouples pure logic from @game/core's full type). */
export interface ManifestCard {
  id: string;
  name: string;
  tribe?: string;
  token?: boolean;
  spell?: boolean;
  effects: { on?: string; do?: string }[];
}
export interface ManifestHero {
  id: string;
  name: string;
  power: { name: string };
}

export const GEN_MARKER =
  '<!-- GENERATED BELOW — edit the Creative brief + Status columns only; Filename/Trigger are regenerated. -->';

export const SECTION_ORDER = [
  'System / UI', 'Heroes', 'Spells', 'Neutral', 'Beasts', 'Dragons', 'Undead', 'Mechs', 'Demons', 'Tokens',
];

const TRIBE_SECTION: Record<string, string> = {
  neutral: 'Neutral', beast: 'Beasts', dragon: 'Dragons', undead: 'Undead', mech: 'Mechs', demon: 'Demons',
};

/** Human-readable label for an effect trigger id (`on`), falling back to the raw value. */
const EFFECT_LABEL: Record<string, string> = {
  onPlay: 'Battlecry', onDeath: 'Deathrattle', onStartCombat: 'Start-of-Combat', startOfCombat: 'Start-of-Combat',
  onSummon: 'on-summon', onKill: 'on-kill', onBuy: 'on-buy', onSell: 'on-sell', onFriendDeath: 'on-ally-death',
};

/** Section a card belongs to. Spell/token are checked before tribe (a spell's tribe is 'neutral'). */
export function sectionOf(card: ManifestCard): string {
  if (card.spell) return 'Spells';
  if (card.token) return 'Tokens';
  return TRIBE_SECTION[card.tribe ?? 'neutral'] ?? 'Neutral';
}

/** The card's dominant effect trigger (`on`), or undefined for a vanilla minion. */
function dominantEffect(card: ManifestCard): string | undefined {
  return card.effects.find((e) => e.on)?.on;
}

/** Rows for one card: a spell → one cast row; a minion/token → play + death + effect. */
export function cardRows(card: ManifestCard): SfxRow[] {
  const section = sectionOf(card);
  if (card.spell) {
    return [{
      section, filename: `cards/${card.id}.mp3`,
      trigger: 'Spell cast — unique clip over the default bed',
      brief: `${card.name} — spell cast cue (~0.4s).`, status: '⬜',
    }];
  }
  const rows: SfxRow[] = [
    { section, filename: `cards/${card.id}.mp3`, trigger: 'Played to the board (over the landing bed)',
      brief: `${card.name} — play cue (~0.4s).`, status: '⬜' },
    { section, filename: `cards/${card.id}.death.mp3`, trigger: 'Dies in combat (over the death bed)',
      brief: `${card.name} — death cue (~0.4s).`, status: '⬜' },
  ];
  const eff = dominantEffect(card);
  rows.push(eff
    ? { section, filename: `cards/${card.id}.effect.mp3`, trigger: `${EFFECT_LABEL[eff] ?? eff} procs (shop or combat)`,
        brief: `${card.name} — ${EFFECT_LABEL[eff] ?? eff} proc cue (~0.4s).`, status: '⬜' }
    : { section, filename: `cards/${card.id}.effect.mp3`, trigger: 'Vanilla — no effect to proc',
        brief: '(vanilla — no clip needed)', status: '➖' });
  return rows;
}

export function heroRows(hero: ManifestHero): SfxRow[] {
  return [
    { section: 'Heroes', filename: `heroes/${hero.id}.mp3`, trigger: `${hero.name} selected in Hero Select`,
      brief: `${hero.name} — hero select cue.`, status: '⬜' },
    { section: 'Heroes', filename: `heroes/${hero.id}.power.mp3`, trigger: `${hero.name}'s power "${hero.power.name}" activates`,
      brief: `${hero.power.name} — hero power cue.`, status: '⬜' },
  ];
}

/** Sort by section order, then filename, so reruns produce no spurious diffs. */
function sortRows(rows: SfxRow[]): SfxRow[] {
  return [...rows].sort((a, b) => {
    const s = SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section);
    return s !== 0 ? s : a.filename.localeCompare(b.filename);
  });
}

/** Build every row from the current data. `systemFiles` = existing top-level audio/*.mp3 (status ✅). */
export function deriveRows(cards: ManifestCard[], heroes: ManifestHero[], systemFiles: string[]): SfxRow[] {
  const rows: SfxRow[] = [];
  for (const f of systemFiles) {
    rows.push({ section: 'System / UI', filename: f, trigger: 'Existing UI / system cue', brief: '(shipped)', status: '✅' });
  }
  rows.push({ section: 'Spells', filename: 'spellcast.mp3', trigger: 'Default bed under every spell cast',
    brief: 'Generic spell whoosh (~0.3s).', status: '⬜' });
  for (const h of heroes) rows.push(...heroRows(h));
  for (const c of cards) rows.push(...cardRows(c));
  return sortRows(rows);
}

const escCell = (s: string): string => s.replace(/\|/g, '\\|').trim();

/** Parse the generated tables of an existing doc into filename → { brief, status }. */
export function parseExistingTables(md: string): Map<string, { brief: string; status: string }> {
  const out = new Map<string, { brief: string; status: string }>();
  for (const line of md.split('\n')) {
    const m = line.match(/^\|(.+)\|$/);
    if (!m) continue;
    const cells = m[1].split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
    if (cells.length !== 4) continue;
    const filename = cells[0].replace(/`/g, '').trim();
    if (!filename || filename === 'Filename' || /^-+$/.test(filename)) continue;
    out.set(filename, { brief: cells[2], status: cells[3] });
  }
  return out;
}

/** Overlay preserved human columns (brief, status) onto freshly-derived rows, keyed by filename. */
export function mergeRows(fresh: SfxRow[], existing: Map<string, { brief: string; status: string }>): SfxRow[] {
  return fresh.map((r) => {
    const prev = existing.get(r.filename);
    if (!prev) return r;
    return { ...r, brief: prev.brief || r.brief, status: (prev.status as SfxStatus) || r.status };
  });
}

/** Render the generated zone: one `### Section (n)` + table per non-empty section, in SECTION_ORDER. */
export function renderGeneratedZone(rows: SfxRow[]): string {
  const bySection = new Map<string, SfxRow[]>();
  for (const r of rows) {
    const list = bySection.get(r.section) ?? [];
    list.push(r);
    bySection.set(r.section, list);
  }
  const parts: string[] = [];
  for (const section of SECTION_ORDER) {
    const list = bySection.get(section);
    if (!list?.length) continue;
    parts.push(`### ${section} (${list.length})`, '');
    parts.push('| Filename | Trigger | Creative brief | Status |', '|---|---|---|---|');
    for (const r of list) parts.push(`| \`${r.filename}\` | ${escCell(r.trigger)} | ${escCell(r.brief)} | ${r.status} |`);
    parts.push('');
  }
  return parts.join('\n').trimEnd();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/tools/src/sfx-manifest.lib.test.ts`
Expected: PASS (4 test cases green).

- [ ] **Step 5: Commit**

```bash
git add packages/tools/src/sfx-manifest.lib.ts packages/tools/src/sfx-manifest.lib.test.ts
git commit -m "feat(tools): SFX manifest generator — pure row-derivation + merge lib"
```

---

## Task 3: Generator runner + npm script

The thin fs/data wrapper. Reads the doc, merges, flips status from disk, writes the generated zone.

**Files:**
- Create: `packages/tools/src/sfx-manifest.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Write the runner**

Create `packages/tools/src/sfx-manifest.ts`:

```ts
/**
 * `npm run sfx:manifest` — regenerate the Filename/Trigger rows of docs/audio/sfx-manifest.md from the real
 * card/hero/spell data, preserving the human-authored Creative brief + Status columns. Only the zone below
 * GEN_MARKER is rewritten; the hand-authored prose above it is left byte-for-byte untouched.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { NEUTRAL, BEASTS, DRAGONS, UNDEAD, MECHS, DEMONS, TOKENS, SPELLS } from '@game/content';
import { HEROES } from '@game/sim';
import {
  deriveRows, mergeRows, parseExistingTables, renderGeneratedZone, GEN_MARKER,
  type ManifestCard, type ManifestHero, type SfxRow,
} from './sfx-manifest.lib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DOC = resolve(ROOT, 'docs/audio/sfx-manifest.md');
const AUDIO = resolve(ROOT, 'packages/ui/src/audio');

// Cards: every tribe + tokens + all spells. Excludes ENEMY filler (not in these arrays).
const cards = [...NEUTRAL, ...BEASTS, ...DRAGONS, ...UNDEAD, ...MECHS, ...DEMONS, ...TOKENS, ...SPELLS] as unknown as ManifestCard[];

// System/UI clips = top-level audio/*.mp3 (the per-card clips live in audio/cards/, a subdir readdir skips).
// Exclude the spellcast bed — deriveRows emits its own row for it under Spells.
const systemFiles = readdirSync(AUDIO).filter((f) => f.endsWith('.mp3') && f !== 'spellcast.mp3').sort();

const fresh = deriveRows(cards, HEROES as unknown as ManifestHero[], systemFiles);
const existingDoc = existsSync(DOC) ? readFileSync(DOC, 'utf8') : '';
const merged: SfxRow[] = mergeRows(fresh, parseExistingTables(existingDoc));

// Disk status flip: a still-to-record row whose mp3 now exists in the tree → mark recorded (🎙️).
for (const r of merged) {
  if (r.status === '⬜' && existsSync(resolve(AUDIO, r.filename))) r.status = '🎙️';
}

const marker = existingDoc.indexOf(GEN_MARKER);
if (marker === -1) {
  throw new Error(`sfx-manifest: marker not found in ${DOC}. The prose zone (Task 1) must exist first.`);
}
const prose = existingDoc.slice(0, marker + GEN_MARKER.length);
writeFileSync(DOC, `${prose}\n\n${renderGeneratedZone(merged)}\n`);

const sections = new Set(merged.map((r) => r.section)).size;
const todo = merged.filter((r) => r.status === '⬜').length;
console.log(`sfx-manifest: ${merged.length} rows across ${sections} sections (${todo} still to record) → ${DOC}`);
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"` (next to the other `packages/tools` runners like `pool`):

```json
    "sfx:manifest": "tsx packages/tools/src/sfx-manifest.ts",
```

- [ ] **Step 3: Run the generator**

Run: `npm run sfx:manifest`
Expected: console prints e.g. `sfx-manifest: 5xx rows across 10 sections (5xx still to record) → …/docs/audio/sfx-manifest.md`, and the doc now has tables below the marker. If it throws "marker not found", Task 1 wasn't committed.

- [ ] **Step 4: Sanity-check the output**

Run: `git diff --stat docs/audio/sfx-manifest.md && grep -c '^| `' docs/audio/sfx-manifest.md`
Expected: the doc grew by ~570 lines; the row count is in the hundreds. Open the file and confirm: prose zone unchanged, a `### Heroes (46)` table, a `### Spells` table containing `spellcast.mp3`, and vanilla minions showing `➖` in their `.effect.mp3` row.

- [ ] **Step 5: Commit**

```bash
git add package.json packages/tools/src/sfx-manifest.ts docs/audio/sfx-manifest.md
git commit -m "feat(tools): sfx:manifest runner + generated manifest tables"
```

---

## Task 4: Idempotency + preservation checks

Proves the generator is safe to re-run and truly preserves edits.

**Files:** none created — verification only.

- [ ] **Step 1: Idempotency — a no-change rerun is a no-op**

Run: `npm run sfx:manifest && git diff --stat docs/audio/sfx-manifest.md`
Expected: **no diff** (empty output). If there's a diff, the render isn't deterministic — inspect ordering/escaping in `renderGeneratedZone`.

- [ ] **Step 2: Preservation — a hand edit survives a rerun**

Manually edit one row in `docs/audio/sfx-manifest.md`: change a `⬜` to `✅` and rewrite its Creative brief. Save, then run: `npm run sfx:manifest`
Then: `git diff docs/audio/sfx-manifest.md`
Expected: your edited brief + `✅` are still there (the only diff is your own edit; the generator did not revert it). Revert the manual edit afterward: `git checkout docs/audio/sfx-manifest.md`.

- [ ] **Step 3: Full green gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all pass. (`npm test` includes the new `sfx-manifest.lib.test.ts`.)

- [ ] **Step 4: Update the dev log + roadmap (project rule)**

Prepend a dated entry to `docs/devlog.md` describing the manifest + generator (what/why/how-verified), move any completed item out of `docs/roadmap.md` and add the follow-up "audio wiring" plan to its queue, and refresh the README "Recent changes" line. Then:

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: devlog + roadmap for SFX manifest generator"
```

---

## Self-Review

**Spec coverage:**
- Naming conventions (spec §Naming) → Task 1 prose table + Task 2 `cardRows`/`heroRows` filenames. ✅
- Generated manifest doc, prose+generated zones with marker (spec Deliverable 1) → Task 1 + Task 3. ✅
- Generator: location, inputs, merge/preservation, disk status flip, determinism, idempotency (Deliverable 2) → Task 2 (merge/derive/render + tests) + Task 3 (runner, disk flip) + Task 4 (idempotency, preservation). ✅
- Brief auto-seed once, human-owned thereafter (Open decision 1, assumed on) → `cardRows`/`heroRows` seed; `mergeRows` keeps `prev.brief` when present. ✅
- Status auto-flip from disk (Open decision 2, assumed on) → Task 3 Step (disk flip). ✅
- One combined marker-guarded file (Open decision 3, assumed) → Task 1 marker + Task 3 splice. ✅
- Wiring plan documented (Deliverable 3) → Task 1 prose "Wiring plan" section. Implementation deferred to a follow-up plan (stated in header scope note). ✅
- Out-of-scope items (music, split shop/combat effect, curation) → not present in any task. ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code; every command has an expected result. ✅

**Type consistency:** `SfxRow`/`ManifestCard`/`ManifestHero` used identically in `.lib.ts`, its test, and the runner. Function names (`deriveRows`, `mergeRows`, `parseExistingTables`, `renderGeneratedZone`, `cardRows`, `heroRows`, `sectionOf`) and the `GEN_MARKER` constant match across tasks. Status glyphs (`⬜ 🎙️ ✅ ➖`) consistent between prose legend, seeds, and tests. ✅
