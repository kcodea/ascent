# Keyword Definition Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a column of per-keyword definition boxes to the right of the enlarged card, on both the hover reveal and the right-click Inspect overlay, listing only the terms that card's text uses.

**Architecture:** A static glossary module + a pure detection function (union of the card's badge `keywords` and a word-boundary scan of its displayed text) + a thin presentational component, wired into the two existing enlarged-card surfaces. Presentation-only; no engine/content changes.

**Tech Stack:** TypeScript, React, Vitest. Package `@game/ui` (`packages/ui/`).

## Global Constraints

- **Presentation only.** No edits outside `packages/ui/src/` except `docs/` and `README.md`.
- **Names use the displayed vocabulary** (`renameTerms` output): Ward, Echo, Flurry, Execute, Rise, Shout, Attachment, Gilded. Classic names go in `aliases`.
- **No animated paint properties** in any looping animation (perf rule). The boxes are static DOM.
- **Detection is pure** — no DOM, no engine calls; one call per inspected/hovered card, memoized.
- **`Keyword` type** is imported from `@game/core`. The 16 badge codes are: `T, DS, V, W, R, C, M, SC, CN, FD, IMM, ST, RL, SL, CR, EG`.
- **Fixed glossary order** — the detection result is always returned in the glossary's declaration order (never text-appearance order), so the panel never reflows between cards.
- Run `npm install` inside the worktree before trusting any local `typecheck`/`test` (fresh worktree has no `node_modules`).
- Every feature commit updates `docs/devlog.md` + `README.md` (repo contract).

---

### Task 0: Worktree setup

**Files:** none (environment only)

- [ ] **Step 1: Install deps in the worktree**

Run: `npm install`
Expected: completes; `node_modules/` now exists in the worktree root.

- [ ] **Step 2: Baseline gate**

Run: `npm run typecheck`
Expected: PASS (proves the worktree resolves `@game/*` correctly before we add anything).

---

### Task 1: Keyword glossary data

**Files:**
- Create: `packages/ui/src/keywordGlossary.ts`
- Test: `packages/ui/src/keywordGlossary.test.ts`

**Interfaces:**
- Consumes: `Keyword` from `@game/core`.
- Produces:
  - `interface KeywordDef { id: string; name: string; aliases: string[]; badge?: Keyword; def: string }`
  - `const KEYWORD_GLOSSARY: KeywordDef[]` (ordered)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/keywordGlossary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { Keyword } from '@game/core';
import { KEYWORD_GLOSSARY } from './keywordGlossary';

const ALL_BADGES: Keyword[] = ['T', 'DS', 'V', 'W', 'R', 'C', 'M', 'SC', 'CN', 'FD', 'IMM', 'ST', 'RL', 'SL', 'CR', 'EG'];

describe('KEYWORD_GLOSSARY', () => {
  it('has unique ids', () => {
    const ids = KEYWORD_GLOSSARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every entry a non-empty name and definition', () => {
    for (const e of KEYWORD_GLOSSARY) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.def.length).toBeGreaterThan(0);
    }
  });

  it('maps all 16 badge codes exactly once', () => {
    const badges = KEYWORD_GLOSSARY.map((e) => e.badge).filter(Boolean) as Keyword[];
    expect(new Set(badges).size).toBe(badges.length);          // no badge used twice
    for (const b of ALL_BADGES) expect(badges).toContain(b);   // all covered
    expect(badges.length).toBe(ALL_BADGES.length);             // no extras
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/keywordGlossary.test.ts`
Expected: FAIL — cannot resolve `./keywordGlossary`.

- [ ] **Step 3: Write the glossary module**

Create `packages/ui/src/keywordGlossary.ts`:

```ts
import type { Keyword } from '@game/core';

/**
 * The player-facing glossary for the keyword definition panel (`KeywordDefs`). ONE ordered source of truth:
 * `detectCardKeywords` scans a card against this list and the panel renders the hits in THIS order (never
 * text-appearance order, so the column never reflows between cards).
 *
 * `name` is the DISPLAYED term (post-`terms.ts` renaming — Ward, Echo, Flurry, Execute, Rise, Shout,
 * Attachment, Gilded); classic names live in `aliases` so detection still matches raw text. `badge` is the
 * schema keyword code when the term is also a badge keyword — those entries appear whenever the card carries
 * the badge, even if the word isn't in its text.
 *
 * Order: ability triggers, then combat keywords, then mechanic nouns. Definitions are owner-reviewed
 * (spec 2026-08-20). Tribe names are deliberately excluded.
 */
export interface KeywordDef {
  /** Stable key + React key. */
  id: string;
  /** Displayed header word, e.g. 'Ward'. */
  name: string;
  /** Extra strings to match in card text (classic names, plurals, etc.). */
  aliases: string[];
  /** The schema badge code, when this term is also a badge keyword. */
  badge?: Keyword;
  /** One-line player-facing definition. */
  def: string;
}

export const KEYWORD_GLOSSARY: KeywordDef[] = [
  // --- Ability triggers ---
  { id: 'shout', name: 'Shout', aliases: ['Battlecry'], def: 'Triggers when you play this minion from your hand.' },
  { id: 'echo', name: 'Echo', aliases: ['Deathrattle', 'Deathrattles', 'Echoes'], def: 'Triggers when this minion dies.' },
  { id: 'startofcombat', name: 'Start of Combat', aliases: [], badge: 'SC', def: 'Triggers once at the start of combat, before any attacks.' },
  { id: 'endofturn', name: 'End of Turn', aliases: [], def: 'Triggers at the end of each of your shop turns.' },
  { id: 'avenge', name: 'Avenge', aliases: [], def: 'After enough friendly minions have died this combat, triggers its effect.' },
  { id: 'rally', name: 'Rally', aliases: [], badge: 'RL', def: 'Triggers each time this minion attacks in combat.' },
  { id: 'slaughter', name: 'Slaughter', aliases: [], badge: 'SL', def: 'Triggers whenever this minion kills an enemy.' },
  { id: 'chooseone', name: 'Choose One', aliases: [], def: 'When you play it, pick one of its two effects.' },
  { id: 'dawndusk', name: 'Dawn / Dusk', aliases: ['Dawn', 'Dusk'], def: 'Celestial cards alternate between Dawn and Dusk each combat; the active state picks which half of the effect fires.' },

  // --- Combat keywords ---
  { id: 'taunt', name: 'Taunt', aliases: [], badge: 'T', def: 'Enemies must attack this minion before any other.' },
  { id: 'ward', name: 'Ward', aliases: ['Divine Shield'], badge: 'DS', def: 'Blocks the first instance of damage it would take, then breaks.' },
  { id: 'execute', name: 'Execute', aliases: ['Venomous'], badge: 'V', def: 'Any damage it deals to a minion destroys that minion.' },
  { id: 'flurry', name: 'Flurry', aliases: ['Windfury'], badge: 'W', def: 'Attacks twice each combat turn.' },
  { id: 'rise', name: 'Rise', aliases: ['Reborn'], badge: 'R', def: 'The first time it dies, it returns with 1 Health.' },
  { id: 'cleave', name: 'Cleave', aliases: [], badge: 'C', def: 'Its attack also strikes the minions beside its target.' },
  { id: 'crit', name: 'Crit', aliases: ['Critical'], badge: 'CR', def: 'Its attack has a chance to deal double damage.' },
  { id: 'attachment', name: 'Attachment', aliases: ['Magnetic', 'Magnetize', 'Attach'], badge: 'M', def: 'When played, can fuse onto a friendly minion, adding its stats and keywords.' },
  { id: 'immune', name: 'Immune', aliases: [], badge: 'IMM', def: 'Takes no damage.' },
  { id: 'stealth', name: 'Stealth', aliases: [], badge: 'ST', def: "Can't be attacked or targeted until it attacks." },
  { id: 'engraved', name: 'Engraved', aliases: [], badge: 'EG', def: 'Keeps the stat gains it earns during combat (normally combat buffs are shed afterward).' },

  // --- Mechanic nouns ---
  { id: 'consume', name: 'Consume', aliases: ['Consumes'], badge: 'CN', def: 'Devours a friendly minion (usually Fodder) to take its stats.' },
  { id: 'fodder', name: 'Fodder', aliases: [], badge: 'FD', def: 'A disposable minion meant to be eaten by Consume effects for its stats.' },
  { id: 'discover', name: 'Discover', aliases: [], def: 'Choose one of a few offered cards to add.' },
  { id: 'ruby', name: 'Ruby', aliases: ['Rubies'], def: "A spell-like token minted to your hand; drop it on a friendly minion to grant that minion the Ruby's Attack and Health as permanent stats." },
  { id: 'ale', name: 'Dwarven Ale', aliases: ['Ale', 'Ales'], def: "A token brewed by Dwarves; the more Ale you've brewed, the bigger your 'per Ale' payoffs." },
  { id: 'shopspell', name: 'Shop spell', aliases: ['Shop spells'], def: 'A spell cast in the shop (recruit phase), not in combat.' },
  { id: 'gilded', name: 'Gilded', aliases: ['Golden'], def: 'A minion made from three copies — stronger, with a doubled effect.' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/src/keywordGlossary.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/keywordGlossary.ts packages/ui/src/keywordGlossary.test.ts
git commit -m "feat(ui): keyword glossary data for the definition panel"
```

---

### Task 2: The detection function

**Files:**
- Create: `packages/ui/src/detectCardKeywords.ts`
- Test: `packages/ui/src/detectCardKeywords.test.ts`

**Interfaces:**
- Consumes: `KEYWORD_GLOSSARY`, `KeywordDef` from `./keywordGlossary`; `renameTerms` from `./terms`; `Keyword` from `@game/core`.
- Produces:
  - `interface DetectableCard { keywords: Keyword[]; text: string }`
  - `function detectCardKeywords(card: DetectableCard): KeywordDef[]`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/detectCardKeywords.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectCardKeywords } from './detectCardKeywords';

const ids = (card: { keywords: any[]; text: string }) => detectCardKeywords(card).map((e) => e.id);

describe('detectCardKeywords', () => {
  it('returns badge keywords in glossary order (Taunt before Ward)', () => {
    expect(ids({ keywords: ['DS', 'T'], text: '' })).toEqual(['taunt', 'ward']);
  });

  it('detects terms from the text, in glossary order not text order', () => {
    // Echo (ability) is declared before nothing here; Choose One before Echo in the glossary.
    expect(ids({ keywords: [], text: '**Echo:** do a thing. **Choose One:** a or b.' }))
      .toEqual(['chooseone', 'echo']);
  });

  it('unions badge + text and de-dupes (Ward named AND badged appears once)', () => {
    expect(ids({ keywords: ['DS'], text: 'Gain **Ward**.' })).toEqual(['ward']);
  });

  it('matches classic aliases in raw text (Deathrattle -> echo)', () => {
    expect(ids({ keywords: [], text: '**Deathrattle:** boom.' })).toEqual(['echo']);
  });

  it('respects word boundaries (Warden does not match Ward; Uprising not Rise)', () => {
    expect(ids({ keywords: [], text: 'The Warden watches the Uprising.' })).toEqual([]);
  });

  it('returns [] for a vanilla card', () => {
    expect(ids({ keywords: [], text: '' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/detectCardKeywords.test.ts`
Expected: FAIL — cannot resolve `./detectCardKeywords`.

- [ ] **Step 3: Write the detection function**

Create `packages/ui/src/detectCardKeywords.ts`:

```ts
import type { Keyword } from '@game/core';
import { renameTerms } from './terms';
import { KEYWORD_GLOSSARY, type KeywordDef } from './keywordGlossary';

/** The minimal card shape detection needs — a full `CardView` satisfies it structurally. */
export interface DetectableCard {
  keywords: Keyword[];
  text: string;
}

/** Escape a term for use in a RegExp. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Per-entry matcher: true when the entry's name or any alias appears in `text` on word boundaries.
 * Case-sensitive — every glossary term is Capitalised in card text, and this avoids matching common
 * lowercase words (e.g. the verb "rise"). Built once at module load; RegExp is reused across calls.
 */
const MATCHERS: { def: KeywordDef; re: RegExp }[] = KEYWORD_GLOSSARY.map((def) => {
  const terms = [def.name, ...def.aliases].map(esc).join('|');
  return { def, re: new RegExp(`(?<![A-Za-z])(?:${terms})(?![A-Za-z])`) };
});

/**
 * The glossary entries a card references: the UNION of its badge `keywords` and any glossary term named in
 * its displayed text. Deduped, returned in glossary declaration order (stable — never text order), so the
 * panel never reflows. Pure; safe to memoize on `(keywords, text)`.
 */
export function detectCardKeywords(card: DetectableCard): KeywordDef[] {
  const text = renameTerms(card.text ?? '').replace(/\*\*/g, ''); // displayed vocabulary, bold markers stripped
  const badges = new Set<Keyword>(card.keywords ?? []);
  const out: KeywordDef[] = [];
  for (const { def, re } of MATCHERS) {
    const hit = (def.badge !== undefined && badges.has(def.badge)) || re.test(text);
    if (hit) out.push(def);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/src/detectCardKeywords.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/detectCardKeywords.ts packages/ui/src/detectCardKeywords.test.ts
git commit -m "feat(ui): detectCardKeywords — badge + text-scan union"
```

---

### Task 3: Formatting-drift guard test

Assert every text-detected glossary term actually appears in some real card's displayed text, so if the card vocabulary ever drifts from the glossary CI fails loudly instead of the panel silently missing a term.

**Files:**
- Test: `packages/ui/src/keywordGlossaryCoverage.test.ts`

**Interfaces:**
- Consumes: `KEYWORD_GLOSSARY` from `./keywordGlossary`; `detectCardKeywords` from `./detectCardKeywords`; `CARD_INDEX` from `@game/content`.

- [ ] **Step 1: Write the test**

Create `packages/ui/src/keywordGlossaryCoverage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { KEYWORD_GLOSSARY } from './keywordGlossary';
import { detectCardKeywords } from './detectCardKeywords';

// Terms that are real game vocabulary but never appear inside a single card's own body text:
// 'gilded' is a display STATE of a card, not a word a card prints about itself.
const EXEMPT = new Set(['gilded']);

describe('keyword glossary coverage', () => {
  it('every glossary term is detected on at least one real card', () => {
    const seen = new Set<string>();
    for (const def of Object.values(CARD_INDEX)) {
      const card = { keywords: def.keywords ?? [], text: def.text ?? '' };
      for (const e of detectCardKeywords(card)) seen.add(e.id);
    }
    const missing = KEYWORD_GLOSSARY.map((e) => e.id).filter((id) => !seen.has(id) && !EXEMPT.has(id));
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run packages/ui/src/keywordGlossaryCoverage.test.ts`
Expected: PASS. If it FAILS listing ids, either (a) an alias is wrong — fix it in `keywordGlossary.ts`, or (b) the term genuinely never appears in a card body — add its id to `EXEMPT` with a one-line reason. Do NOT weaken the matcher to force a pass.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/keywordGlossaryCoverage.test.ts
git commit -m "test(ui): guard that every keyword-glossary term appears on a real card"
```

---

### Task 4: The KeywordDefs component + box styling

**Files:**
- Create: `packages/ui/src/KeywordDefs.tsx`
- Modify: `packages/ui/src/styles.css` (append new rules near the `.inspect-buffs` block, ~line 2360)

**Interfaces:**
- Consumes: `detectCardKeywords`, `DetectableCard` from `./detectCardKeywords`.
- Produces: `function KeywordDefs({ card }: { card: DetectableCard }): JSX.Element | null`

- [ ] **Step 1: Write the component**

Create `packages/ui/src/KeywordDefs.tsx`:

```tsx
import { useMemo } from 'react';
import { detectCardKeywords, type DetectableCard } from './detectCardKeywords';

/**
 * The keyword definition panel — a column of boxes shown beside the enlarged card (hover reveal + right-click
 * Inspect), one per glossary term the card's text uses. Word-led: the term's name on its own line, definition
 * below. Renders nothing when the card references no glossary terms. Static DOM — no per-frame work.
 */
export function KeywordDefs({ card }: { card: DetectableCard }): JSX.Element | null {
  const defs = useMemo(() => detectCardKeywords(card), [card.keywords, card.text]);
  if (defs.length === 0) return null;
  return (
    <div className="kwdefs" aria-label="Keyword definitions">
      {defs.map((d) => (
        <div className="kwbox" key={d.id}>
          <div className="kwbox-name">{d.name}</div>
          <div className="kwbox-def">{d.def}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add the styling**

In `packages/ui/src/styles.css`, immediately AFTER the `.ib-row { … }` line (the end of the inspect-buffs block, ~line 2360), add:

```css
/* Keyword definition panel (KeywordDefs) — a column of word-led boxes beside the enlarged card on the hover
   reveal and the right-click Inspect. Mirrors the .inspect-buffs glass chrome so the two side panels read as
   one family. Static DOM only — no animated paint. */
.kwdefs { align-self: center; display: flex; flex-direction: column; gap: 6px; max-width: min(240px, 42vw); max-height: min(72vh, 560px); overflow-y: auto; }
.kwdefs::-webkit-scrollbar { width: 0; height: 0; display: none; }
.kwbox { background: linear-gradient(180deg, #241a13, #17110c); border: 2px solid color-mix(in srgb, var(--gold) 55%, #000); border-radius: 9px; padding: 6px 9px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 4px 14px -6px rgba(0, 0, 0, 0.45); }
.kwbox-name { font-family: var(--font-ui); font-weight: 800; font-size: 12px; letter-spacing: 0.03em; color: var(--acc, #ff9d4d); }
.kwbox-def { font-family: var(--font-ui); font-weight: 500; font-size: 10.5px; line-height: 1.35; color: #e9dcc4; margin-top: 2px; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (component + styles compile; component is unused so far — that is fine, wiring comes next).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/KeywordDefs.tsx packages/ui/src/styles.css
git commit -m "feat(ui): KeywordDefs panel component + box styling"
```

---

### Task 5: Wire into the right-click Inspect overlay

**Files:**
- Modify: `packages/ui/src/Inspect.tsx`

**Interfaces:**
- Consumes: `KeywordDefs` from `./KeywordDefs`.

- [ ] **Step 1: Import the component**

In `packages/ui/src/Inspect.tsx`, add after the existing `import { Card } from './Card';` line:

```tsx
import { KeywordDefs } from './KeywordDefs';
```

- [ ] **Step 2: Render it beside the card**

In `Inspect.tsx`, the `.inspect-card` div currently ends with:

```tsx
        <Card card={{ ...inspect, stepProgress: undefined }} forceFull plated />
      </div>
```

Change it to add the panel to the right of the card:

```tsx
        <Card card={{ ...inspect, stepProgress: undefined }} forceFull plated />
        <KeywordDefs card={inspect} />
      </div>
```

(`.inspect-card` is already `display: flex`, so the panel lands to the card's right. `inspect` has `keywords` and `text`, satisfying `DetectableCard`.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Verify live in the browser**

Run the dev server for THIS worktree and confirm: right-click a minion with keywords (e.g. a Taunt/Ward minion, or any card whose text says **Echo:** / **Choose One:**) → the definition boxes appear to the right of the enlarged card, one per term, word on top and definition below; right-click a vanilla-stat minion → no panel. (Use `preview_start` for this worktree's dev server; do not rely on another session's server.)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/Inspect.tsx
git commit -m "feat(ui): keyword definitions beside the right-click inspect card"
```

---

### Task 6: Wire into the hover reveal

**Files:**
- Modify: `packages/ui/src/Card.tsx` (the `.cardref` portal block, ~line 1183; and the import block near the top)

**Interfaces:**
- Consumes: `KeywordDefs` from `./KeywordDefs`.

- [ ] **Step 1: Import the component**

In `packages/ui/src/Card.tsx`, add with the other local imports near the top (e.g. after `import { renameTerms } from './terms';`):

```tsx
import { KeywordDefs } from './KeywordDefs';
```

- [ ] **Step 2: Append the panel inside the hover reveal**

Find the `.cardref` portal block (~line 1183). It reads:

```tsx
      {refPos && hasPopup && createPortal(
        <div className="cardref" style={{ left: refPos.left, top: refPos.top } as CSSProperties}>
          <div className="cardref-inner" style={{ transformOrigin: `${refPos.origin} center` } as CSSProperties}>
            {popupCards.map((rc, i) => (
              <Card key={`${rc.cardId ?? i}-${i}`} card={rc} forceFull plated />
            ))}
          </div>
        </div>,
        document.body,
      )}
```

Add the panel after the `popupCards.map(...)` block, still inside `.cardref-inner`:

```tsx
      {refPos && hasPopup && createPortal(
        <div className="cardref" style={{ left: refPos.left, top: refPos.top } as CSSProperties}>
          <div className="cardref-inner" style={{ transformOrigin: `${refPos.origin} center` } as CSSProperties}>
            {popupCards.map((rc, i) => (
              <Card key={`${rc.cardId ?? i}-${i}`} card={rc} forceFull plated />
            ))}
            <KeywordDefs card={card} />
          </div>
        </div>,
        document.body,
      )}
```

(`card` is the component's own `CardView` prop, in scope here; it satisfies `DetectableCard`. `.cardref-inner` is `display: flex`, so the panel trails to the right exactly like the referenced cards already do.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Verify live in the browser**

On this worktree's dev server, hover (don't click) a shop/warband/hand card with keywords → after the existing reveal dwell, the enlarged card shows the definition column to its right. Hover a card near the RIGHT screen edge (where the reveal opens leftward) → confirm the cluster still reads on-screen; if it clips, note it as a follow-up (positioning reuses the existing `refPos` origin logic — do not re-architect it in this task).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/Card.tsx
git commit -m "feat(ui): keyword definitions beside the hover reveal card"
```

---

### Task 7: Docs + full verification

**Files:**
- Modify: `docs/devlog.md`, `README.md`

- [ ] **Step 1: Prepend the devlog entry**

At the top of `docs/devlog.md`, immediately after the `# ASCENT — development log` header, add a dated entry describing: the new `KeywordDefs` panel; that it shows on both the hover reveal and right-click Inspect; the glossary + pure `detectCardKeywords` (badge ∪ text-scan, word-boundary, glossary order); the coverage guard test; and that it is presentation-only. (Newest first.)

- [ ] **Step 2: Add the README highlight**

In `README.md`, under the `## Recent changes` list, add one bullet:

```markdown
- **Keyword definitions beside a card** — hovering or inspecting a card now shows a box for each keyword it uses (Ward, Echo, Slaughter, Choose One…), word on top and a one-line definition below.
```

- [ ] **Step 3: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all PASS. (`lint` reports errors only in gitignored `.agents/` / `.github/skills/` tooling — those are pre-existing and out of scope; confirm no errors in `packages/ui/src/`.)

- [ ] **Step 4: Commit**

```bash
git add docs/devlog.md README.md
git commit -m "docs: keyword definition panel"
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/keyword-defs
```

Open a PR into `main`, watch `gh pr checks <n> --watch` until `verify` passes, then squash-merge and clean up the worktree/branch.

---

## Notes for the implementer

- **Where the displayed text comes from:** `CardView.text` is RAW (classic vocabulary, with `**bold**`). `renameTerms` is applied at render (`mdBold` in `Card.tsx`). `detectCardKeywords` applies `renameTerms` itself and strips `**`, so it matches the same words the player sees — while the classic-name `aliases` also catch the raw form. Don't pass pre-rendered HTML in.
- **Why a fixed order:** returning glossary order (not text order) keeps the panel identical for the same card every time and avoids reflow when the same terms appear in a different sentence order on golden vs base text.
- **Scope discipline:** do not refactor the four existing code→name maps (`Card.tsx`, `float.ts`, `questText.ts`, `UnitEditor.tsx`) into the glossary in this PR — that's a separate proposal noted in the spec.
