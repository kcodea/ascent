# Mechanic Medallion PNG Rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the card mechanic medallion's monochrome SVG glyph with authored PNG art (keyed by mechanic, hybrid SVG fallback), wired at the medallion + compendium, plus a dev tuner for medallion size/placement.

**Architecture:** A pure `mechMedallion` module maps mechanic ids → webp URLs. `resolveMechIcon` returns the mechanic (id + glyph) so both mechanic-render sites (Card `.cgem`, MinionBook glossary) render the PNG when one exists and fall back to the existing `<Icon>` SVG otherwise. Adds one mechanic (`spend`) + gives `rebirth` its own glyph. A schema-driven tuner (`medallionConfig`) drives `.cgem` size/placement via CSS vars.

**Tech Stack:** TypeScript, React, sharp (asset conversion), the repo's tuner schema (`tunerSchema.ts`), Vitest, CSS.

**Spec:** `docs/superpowers/specs/2026-09-21-medallion-png-rework-design.md` (read it — this plan implements it).

## Global Constraints

- **Presentation + one small content addition only.** UI/content: `packages/ui/**`, `apps/web/public/**`, and the `spend` mechanic/glossary. No sim/reducer/core-types.
- **Key by MECHANIC ID, never glyph** — generic glyph names (`sword`, `skull`, `shield`, `star`, `eye`, `sc`, `target`) are reused for non-mechanic icons and MUST stay SVG. Only the two mechanic-keyed sites change.
- **Hybrid:** the 15 wired mechanics render PNG; the other 12 keep their SVG glyph unchanged.
- **`spend` = gold-spent ONLY** (`detect: hasOn('goldSpent')`), NOT `cardsBought`.
- **Tuner is GLOBAL** — one size/placement for all cards (no compact-card variant).
- **Wired mechanic ids (15):** shout, echo, startCombat, endTurn, avenge, rally, chooseOne, cleave, crit, flurry, rise, rebirth, attachment, watcher, spend.
- **webp path:** `apps/web/public/medallions/<mechanicId>.webp`, referenced `${import.meta.env.BASE_URL}medallions/<id>.webp`.
- **Every `<img>` in `packages/ui` needs `decoding="sync"`** (repo convention).
- **Commit each webp with its wiring** (art-without-commit ships blank).
- **Gates before done:** `npm run typecheck && npm run lint && npm test && npm run build:web`. Run `npm install` in the worktree first.
- **Patch notes:** prepend a player-facing entry (medallions are a visible UI change).

---

### Task 1: Convert the 15 medallion PNGs to webp

**Files:**
- Create: `apps/web/public/medallions/{shout,echo,startCombat,endTurn,avenge,rally,chooseOne,cleave,crit,flurry,rise,rebirth,attachment,watcher,spend}.webp`

**Interfaces:**
- Produces: 15 webp files at the paths above, named by **mechanic id** (not by source filename).

Source→id mapping (source filenames differ from mechanic ids):
`shout.png→shout, echo.png→echo, startturn.png→startCombat, endturn.png→endTurn, avenge.png→avenge, rally.png→rally, chooseone.png→chooseOne, cleave.png→cleave, crit.png→crit, flurry.png→flurry, rise.png→rise, rebirth.png→rebirth, attachment.png→attachment, watcher.png→watcher, spend.png→spend`.

- [ ] **Step 1: Convert with sharp**

Run this Node one-liner from the worktree root (sharp is already a dep):

```bash
node -e "
const sharp=require('sharp');const fs=require('fs');
const src='C:/Users/micha/Desktop/Reference Art/Medallions/';
const out='apps/web/public/medallions/';
fs.mkdirSync(out,{recursive:true});
const map={shout:'shout',echo:'echo',startCombat:'startturn',endTurn:'endturn',avenge:'avenge',rally:'rally',chooseOne:'chooseone',cleave:'cleave',crit:'crit',flurry:'flurry',rise:'rise',rebirth:'rebirth',attachment:'attachment',watcher:'watcher',spend:'spend'};
(async()=>{for(const[id,file]of Object.entries(map)){const o=out+id+'.webp';await sharp(src+file+'.png').resize(256,256,{fit:'inside'}).webp({quality:85,effort:5}).toFile(o);console.log(id,(fs.statSync(o).size/1024|0)+'KB');}})().catch(e=>{console.error(e.message);process.exit(1);});
"
```

- [ ] **Step 2: Verify all 15 exist**

Run: `ls apps/web/public/medallions/ | wc -l`
Expected: `15`. Each file should be well under 100 KB.

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/medallions/
git commit -m "feat(ui): medallion PNG art as webp (15 mechanics)"
```

---

### Task 2: Pure `mechMedallion` module

**Files:**
- Create: `packages/ui/src/mechMedallion.ts`
- Test: `packages/ui/src/mechMedallion.test.ts`

**Interfaces:**
- Produces:
  - `const MECH_MEDALLION_PNGS: ReadonlySet<string>` — the 15 wired mechanic ids
  - `function mechMedallionSrc(mechanicId: string): string | null`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/mechMedallion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MECH_MEDALLION_PNGS, mechMedallionSrc } from './mechMedallion';

describe('mechMedallionSrc', () => {
  it('returns a webp URL for a wired mechanic', () => {
    expect(mechMedallionSrc('shout')).toBe('/medallions/shout.webp');
    expect(mechMedallionSrc('spend')).toBe('/medallions/spend.webp');
    expect(mechMedallionSrc('rebirth')).toBe('/medallions/rebirth.webp');
  });
  it('returns null for a mechanic with no art (keeps its SVG)', () => {
    expect(mechMedallionSrc('taunt')).toBeNull();
    expect(mechMedallionSrc('ward')).toBeNull();
    expect(mechMedallionSrc('nonsense')).toBeNull();
  });
  it('has exactly the 15 wired ids', () => {
    expect(MECH_MEDALLION_PNGS.size).toBe(15);
  });
});
```

(`import.meta.env.BASE_URL` is `/` under Vitest, so the URL is `/medallions/...`.)

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module './mechMedallion'`).

Run: `npx vitest run packages/ui/src/mechMedallion.test.ts`

- [ ] **Step 3: Implement**

Create `packages/ui/src/mechMedallion.ts`:

```ts
/**
 * Which mechanics have authored PNG medallion art, and where it lives. Keyed by MECHANIC ID (not glyph): glyph
 * names like `sword`/`skull`/`shield` are reused for generic non-mechanic icons and must stay SVG. A mechanic not
 * in the set renders its `<Icon>` SVG glyph as before (hybrid). See the spec for the mapping.
 */
export const MECH_MEDALLION_PNGS: ReadonlySet<string> = new Set([
  'shout', 'echo', 'startCombat', 'endTurn', 'avenge', 'rally', 'chooseOne', 'cleave',
  'crit', 'flurry', 'rise', 'rebirth', 'attachment', 'watcher', 'spend',
]);

/** The webp URL for a mechanic's medallion art, or null when it has none. BASE_URL-relative (itch/exe serve from
 *  a CDN sub-path, where a root-absolute '/medallions/…' 404s). */
export function mechMedallionSrc(mechanicId: string): string | null {
  return MECH_MEDALLION_PNGS.has(mechanicId) ? `${import.meta.env.BASE_URL}medallions/${mechanicId}.webp` : null;
}
```

- [ ] **Step 4: Run — expect PASS.**

Run: `npx vitest run packages/ui/src/mechMedallion.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/mechMedallion.ts packages/ui/src/mechMedallion.test.ts
git commit -m "feat(ui): mechMedallion — mechanic-id → PNG map (hybrid)"
```

---

### Task 3: Add the `spend` mechanic + give `rebirth` its own glyph

**Files:**
- Modify: `packages/ui/src/mechanics.ts` (registry, ~lines 111–141)
- Modify: `packages/ui/src/keywordGlossary.ts` (add a `spend` entry linked by `mechanic: 'spend'`)
- Modify: `packages/ui/src/Icon.tsx` (add `rebirth` + `spend` SVG fallbacks)
- Modify (as tests demand): `packages/ui/src/mechanics.test.ts`, `packages/ui/src/mechIcon.test.ts`, `packages/ui/src/keywordGlossaryCoverage.test.ts`

**Interfaces:**
- Produces: a `spend` mechanic (id `spend`, glyph `spend`, `detect: hasOn('goldSpent')`); `rebirth` now has glyph `rebirth`.

- [ ] **Step 1: Confirm the trigger id**

Grep the Tapkeeper card and the gold-sink cards for the trigger:
Run: `grep -rn "goldSpent" packages/content/src/cards/set2/dwarves.ts`
Expected: an effect with `on: 'goldSpent'`. (If Tapkeeper uses a different `on:`, use that id in `hasOn(...)`; the spec commits to gold-spent semantics, not a specific card.)

- [ ] **Step 2: Change `rebirth`'s glyph and add `spend` to the registry**

In `packages/ui/src/mechanics.ts`, change the `rebirth` line's `glyph: 'rise'` → `glyph: 'rebirth'`. Then add, in the `— Build & shop —` group (order 20 sits it near the other trigger-family entries; keep it before the combat block):

```ts
  { id: 'spend', term: 'Spend', glyph: 'spend', detect: hasOn('goldSpent'), termRe: /spend .*gold|gold spent/i, order: 20 },
```

- [ ] **Step 3: Add the glossary entry** (required — `glossaryDefOf('spend')` throws without it)

In `packages/ui/src/keywordGlossary.ts`, add a `KeywordDef` with `mechanic: 'spend'`, `section: 'build'`, an owner-style definition (e.g. "**Spend:** an effect that triggers when you spend Gold this turn."), and `name: 'Spend'`. Match the exact `KeywordDef` shape of a neighbouring `build`-section entry (read one first). Because `keywordGlossaryCoverage.test.ts` requires every definition to be USED in shipped text (or listed as deliberately kept): the gold-spend cards say "spend … Gold", so add a `detectRe` for `/spend\b/i` if `name`/`aliases` don't already hit that text; if coverage still fails, add `spend` to that test's kept-list with a one-line reason.

- [ ] **Step 4: Add SVG fallbacks in `Icon.tsx`**

In `ICONS` (`packages/ui/src/Icon.tsx`), add a `rebirth` entry (reuse the `rise` SVG's JSX) and a `spend` entry (a simple coin glyph, e.g. `<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2.4"/><path fill="currentColor" d="M11 7h2v2h2v2h-2v2h2v2h-2v1h-2v-1H9v-2h2v-2H9V9h2z"/>`). These are defensive; the PNGs normally cover both.

- [ ] **Step 5: Run the mechanic tests, update expectations**

Run: `npx vitest run packages/ui/src/mechanics.test.ts packages/ui/src/mechIcon.test.ts packages/ui/src/keywordGlossaryCoverage.test.ts`
Update: `mechIcon.test.ts:56` builds `registryGlyphs` — it now includes `rebirth` and `spend`; adjust any exact-set assertion. Add/adjust a `mechanics.test.ts` case asserting `spend`'s glyph and `rebirth`'s new glyph. Fix coverage per Step 3. Expected after edits: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/mechanics.ts packages/ui/src/keywordGlossary.ts packages/ui/src/Icon.tsx packages/ui/src/mechanics.test.ts packages/ui/src/mechIcon.test.ts packages/ui/src/keywordGlossaryCoverage.test.ts
git commit -m "feat(ui): add Spend mechanic + give Rebirth its own glyph"
```

---

### Task 4: `resolveMech` returns the mechanic; render PNG-or-SVG at both sites

**Files:**
- Modify: `packages/ui/src/mechIcon.ts` (return the mechanic, keep a glyph helper)
- Modify: `packages/ui/src/Card.tsx` (the `.cgem` render, ~line 1152)
- Modify: `packages/ui/src/MinionBook.tsx` (glossary row icon, ~line 172 + its render site)
- Modify: `packages/ui/src/styles.css` (`.cgem` img rules)
- Modify: `packages/ui/src/mechIcon.test.ts` (signature)

**Interfaces:**
- Consumes: `mechMedallionSrc` (Task 2); the `spend`/`rebirth` mechanics (Task 3).
- Produces: `resolveMech(view: CardView): Mechanic | null` in `mechIcon.ts`. A shared render: PNG `<img class="cgem-img">` when `mechMedallionSrc(mech.id)` is non-null, else `<Icon name={mech.glyph} />`.

- [ ] **Step 1: Change `mechIcon.ts` to return the mechanic**

Rename `resolveMechIcon` → `resolveMech`, returning the winning `Mechanic | null` (return the object, not `.glyph`, at the three return sites). Keep a thin `export function resolveMechIcon(view): string | null { return resolveMech(view)?.glyph ?? null; }` ONLY if a grep shows another caller needs the glyph string:
Run: `grep -rn "resolveMechIcon" packages/ui/src` — update every caller. `Card.tsx` switches to `resolveMech`.

- [ ] **Step 2: Render PNG-or-SVG in the Card medallion**

In `Card.tsx`, replace `const mechIcon = resolveMechIcon(card);` with `const mech = resolveMech(card);`. In the `.cgem` span (currently `{mechIcon && <Icon name={mechIcon} />}`), render:

```tsx
{mech && (mechMedallionSrc(mech.id)
  ? <img decoding="sync" className="cgem-img" src={mechMedallionSrc(mech.id)!} alt="" aria-hidden="true" />
  : <Icon name={mech.glyph} />)}
```

Import `mechMedallionSrc` and `resolveMech`. Leave the `.cgem` wrapper's pulse/glow classes exactly as they are.

- [ ] **Step 3: Render PNG-or-SVG in the compendium glossary**

In `MinionBook.tsx`, the row built at ~line 172 carries `icon: m.glyph`; add the mechanic id (`mechId: m.id`). At the render site (grep `row.icon` / `\.icon` / `<Icon name={` in `MinionBook.tsx`), render the same PNG-or-SVG: `mechMedallionSrc(row.mechId)` → `<img className="cgem-img …">` else the existing `<Icon name={row.icon} />`. For glossary rows that have no `mechanic` (their own `icon`), keep `<Icon>` unchanged — only mechanic-linked rows can have a PNG.

- [ ] **Step 4: CSS for the medallion image**

In `styles.css`, near the `.cgem` rules (grep `.cgem`), add:

```css
.cgem > .cgem-img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.card.compact .cgem > .cgem-img { width: 100%; height: 100%; }
```

(The `.cgem` box already sizes/positions the medallion; the img fills it. Full-colour art replaces the gold SVG tint — no `color`/`currentColor` applies.) If the compendium row's icon box differs, add a matching `.<row-class> .cgem-img` rule so the art fills it.

- [ ] **Step 5: Typecheck, lint, run mech tests**

Run: `npm run typecheck:web && npx eslint packages/ui/src/Card.tsx packages/ui/src/MinionBook.tsx packages/ui/src/mechIcon.ts && npx vitest run packages/ui/src/mechIcon.test.ts`
Update `mechIcon.test.ts` for the `resolveMech` signature (it likely asserted the returned glyph string — assert `resolveMech(...)?.glyph` or `.id`). Expected: PASS/clean.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/mechIcon.ts packages/ui/src/Card.tsx packages/ui/src/MinionBook.tsx packages/ui/src/styles.css packages/ui/src/mechIcon.test.ts
git commit -m "feat(ui): render PNG medallion (hybrid SVG fallback) at card + compendium"
```

---

### Task 5: Medallion size/placement tuner

**Files:**
- Create: `packages/ui/src/medallionConfig.ts`, `packages/ui/src/MedallionTuner.tsx`
- Modify: `packages/ui/src/styles.css` (`.cgem` reads the tuner vars), `packages/ui/src/tunerAll.ts`, `packages/ui/src/tunerSchema.ts` (`PANEL_EMBLEMS`), `packages/ui/src/DevMenu.tsx`

**Interfaces:**
- Consumes: the `.cgem` markup (Task 4).
- Produces: `SPEC` (TunerSpec) exported from `medallionConfig.ts`; `MedallionTuner` component.

- [ ] **Step 1: Write `medallionConfig.ts`** (mirror `milestoneFrameConfig.ts` / `equipSlotConfig.ts` exactly — read one first for the get/set/reset/apply/SPEC pattern)

Config interface + DEFAULTS (owner-tunable; start at current look = 1× / no offset):

```ts
export interface MedallionConfig {
  size: number;   // medallion scale (× of its current box)
  dx: number;     // px offset X
  dy: number;     // px offset Y
  artScale: number; // the PNG's scale within the medallion box (× of 100%)
}
const DEFAULTS: MedallionConfig = { size: 1, dx: 0, dy: 0, artScale: 1 };
```

Ranges: `size [0.4, 2.5, 0.01]`, `dx/dy [-40, 40, 0.5]`, `artScale [0.4, 2, 0.01]`. Apply to CSS vars `--cgem-size`, `--cgem-dx`, `--cgem-dy`, `--cgem-art-scale` (px units on dx/dy). Persistence key `ascent.medallion`. `id: 'medallion'` (FROZEN). Controls in one "Medallion" group. Call `applyMedallionVars()` at module load.

- [ ] **Step 2: `MedallionTuner.tsx`** (thin wrapper + live preview)

Mirror `MilestoneFrameTuner.tsx`: `<TunerPanel spec={{ ...SPEC, readout: () => <MedallionPreview /> }} />`. The preview renders a small flex row of `.cgem` medallions for a handful of wired mechanics (e.g. shout, echo, rally, crit, spend, watcher), using the same PNG-or-SVG render as Task 4, in a preview container that neutralises `.cgem`'s absolute positioning (see the `.msprev` pattern in `styles.css`).

- [ ] **Step 3: `styles.css` — `.cgem` reads the tuner vars**

Update the `.cgem` rules so size/offset come from the vars with the current values as fallbacks (grep `.cgem {` and `.card.compact .cgem`):
- `.cgem` (and/or compact): apply `transform: translate(var(--cgem-dx,0px), var(--cgem-dy,0px)) scale(var(--cgem-size,1));` layered with any existing transform (preserve current centering), and `.cgem > .cgem-img { transform: scale(var(--cgem-art-scale,1)); }`. Match the existing transform origin/centering so defaults reproduce today's look exactly.

- [ ] **Step 4: Register the panel**

- `tunerAll.ts`: `import { SPEC as MedallionSpec } from './medallionConfig';` and add `MedallionSpec` to `ALL_TUNER_SPECS`.
- `tunerSchema.ts`: add `medallion: '🎖️'` to `PANEL_EMBLEMS`.
- `DevMenu.tsx`: import `MedallionTuner` and add a group item `{ key: 'medallion', icon: '🎖️', label: 'Medallions', C: MedallionTuner, hint: 'Card mechanic medallion — size, placement, and the art inset', alt: 'medallion mechanic icon size position' }` near Card Pills.

- [ ] **Step 5: Typecheck + lint + build**

Run: `npm run typecheck:web && npm run lint && npm run build:web`
Expected: typecheck clean, lint 0 errors, build passes.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/medallionConfig.ts packages/ui/src/MedallionTuner.tsx packages/ui/src/styles.css packages/ui/src/tunerAll.ts packages/ui/src/tunerSchema.ts packages/ui/src/DevMenu.tsx
git commit -m "feat(ui): 🎖️ Medallion tuner — size / placement / art inset"
```

---

### Task 6: Patch notes + full verification

**Files:**
- Modify: `packages/ui/src/patchNotes.ts`
- Create: `docs/devlog/2026-09-21-medallion-png-rework.md`

- [ ] **Step 1: Patch note** — prepend a spoiler-light entry (match the file's entry shape):

> **Mechanic medallions.** Card mechanic medallions are now authored art instead of flat glyphs, with a new Spend medallion for gold-spender minions.

- [ ] **Step 2: Devlog** — new file summarising: mechanic-keyed PNG (hybrid SVG fallback), the two render sites, the `spend` mechanic + `rebirth` glyph, the tuner, and that `pummel`/`equip` art is held for Set 3. Link the spec.

- [ ] **Step 3: Full gates**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green. Update any golden that legitimately moved (mechanic/glossary tests). Report the results.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/patchNotes.ts docs/devlog/2026-09-21-medallion-png-rework.md
git commit -m "docs(ui): medallion rework patch note + devlog"
```

---

## Self-Review

**Spec coverage:** §2 mechanic-keying → Task 4 (resolveMech + both sites) + Global Constraints. §3 decisions → Tasks 3 (spend/rebirth), 4 (hybrid), 5 (global tuner). §4 asset mapping → Task 1. §5.1 mechMedallion → Task 2. §5.2 resolveMech → Task 4. §5.3 both render sites → Task 4. §5.4 mechanics/glossary/Icon → Task 3. §5.5 CSS → Task 4. §5.6 tuner → Task 5. §6 testing → each task's tests + Task 6. §7 non-goals honored (generic icons untouched; pummel/equip held). ✓
**Placeholder scan:** no TBDs; the two "grep the exact site" instructions (MinionBook render, other resolveMechIcon callers) are concrete verification steps against real, named symbols, not deferrals.
**Type consistency:** `mechMedallionSrc(id)` (Task 2) used verbatim in Task 4; `resolveMech(view): Mechanic|null` (Task 4) consumed by Card; `MECH_MEDALLION_PNGS` 15 ids match the wired list in Global Constraints; webp filenames = mechanic ids (Task 1) = the keys `mechMedallionSrc` builds.
