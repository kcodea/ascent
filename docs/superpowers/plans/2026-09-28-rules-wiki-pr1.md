# Rules Wiki PR 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a searchable **Rules** panel to the Compendium, backed by data-only Q&A entries, with tests that keep
the answers true.

**Architecture:** Entries are plain data in `packages/ui/src/rulesWiki/<topic>.ts`, concatenated by `index.ts`. A
pure `searchWiki()` ranks them. `RulesWiki.tsx` renders chips, search and accordion. `MinionBook.tsx` gains a
`Rules` header toggle, mutually exclusive with `Glossary`. The tests import `@game/rules` (the approved
registry) and `KEYWORD_GLOSSARY` to fingerprint what each answer `covers`.

**Tech Stack:** React 18, Zustand store (`useGame`), Vitest with jsdom (`renderedText.mount` helper).

**Spec:** `docs/superpowers/specs/2026-09-28-rules-wiki-design.md`

## Global Constraints

- Player-level voice; no dev jargon (banned in answers: `seed`, `RNG`, `reducer`, `simulate`, `event log`, `deterministic`).
- No `title=` attributes; no bare `cursor:` keyword (use the gauntlet URL form); no `document.body` portals; no raw `vw`/`vh`.
- Looping animations only on `transform`/`opacity`.
- Answers render through `mdBold` (bold + term colouring).

---

### Task 1: Data model, fingerprint, search

**Files:** Create `rulesWiki/types.ts`, `rulesWiki/fingerprint.ts`, `rulesWiki/search.ts`, and `rulesWiki/index.ts`
(plus empty topic files). Test: `rulesWikiSearch.test.ts`.

**Produces:**
- `WikiTopic` (union), `WIKI_TOPICS: {id, label}[]`, `WikiEntry`, `WikiCover`
- `fingerprint(text: string): string`: FNV-1a 32-bit, 8 lowercase hex characters, input whitespace-collapsed
- `searchWiki(entries, query, topics: ReadonlySet<WikiTopic>): WikiEntry[]`. An empty query keeps source order
  filtered by topic. Otherwise every whitespace token must match somewhere in q + aliases + a (case-insensitive).
  Score: q hit = 3, alias hit = 2, answer hit = 1 (summed over tokens), sorted by score descending, stable.
- `WIKI_ENTRIES`, `WIKI_BY_ID`

Steps: write tests (empty query order, topic filter, alias outranks body, multi-token AND, no-match returns []) →
fail → implement → pass → commit.

### Task 2: Integrity + tripwire + keyword ratchet tests

**Files:** Test: `rulesWiki.test.ts`. Create: `rulesWiki/uncoveredKeywords.ts` (`UNCOVERED_KEYWORDS: readonly string[]`).

Checks:
- ids are unique and match `/^[a-z0-9]+(-[a-z0-9]+)*$/`
- topics are known; `q` ends with `?`; `a` is non-empty; no banned words
- every `seeAlso` id exists and isn't self
- for each `covers`: the rule id exists in `APPROVED_RULES` (else "unknown rule") and `fingerprint(rule.statement) === fp`
  (else a message naming the entry, the rule and the new fp); same for keywords against `KEYWORD_GLOSSARY[].def`
- ratchet: each glossary id is either covered by some entry or in `UNCOVERED_KEYWORDS`, never both; every
  `UNCOVERED_KEYWORDS` id is a real glossary id

Steps: write test → run (passes vacuously with an empty list, apart from a ratchet failing until
`UNCOVERED_KEYWORDS` is filled) → fill the list with all glossary ids → pass → commit.

### Task 3: Panel + Compendium wiring + styles

**Files:** Create `RulesWiki.tsx`. Modify `MinionBook.tsx` (header toggle + body branch) and `styles.css` (a
`.wiki-*` block next to `.book-gloss-body`). Test: `rulesWikiPanel.test.tsx`.

`RulesWiki` state: `query`, `topics:Set`, `open:Set<string>`. Render:
- `.wiki-body` holding `.wiki-bar`: an input `.wiki-search` (autoFocus, `aria-label`) plus chip buttons `.wiki-chip`
  (`aria-pressed`)
- `.wiki-list`: groups by topic (`h3.wiki-grouphead`); each entry is a `div.wiki-item` holding a
  `button.wiki-q[aria-expanded]` and, when open, a `.wiki-a` (`dangerouslySetInnerHTML={{__html: mdBold(a)}}`)
  followed by a "See also" row of `button.wiki-see`, which opens the target, clears query/topics, and scrolls it
  into view via a ref map. When searching, it shows a flat ranked list with no group heads.
- Empty result: `.book-empty`-style "Nothing matches "x". Try a topic above, or fewer words."

In `MinionBook`, add `const [rules, setRules] = useState(false)`. The Rules button (`.book-gloss` class and
`.book-rules`) toggles it and clears `glossary`; the Glossary button clears `rules`. Header: hide search, Gilded
and zoom when `glossary || rules`. Subtitle when rules: "Rules & how-to. Search any question." Body: `rules ?
<RulesWiki/> : glossary ? … : …`.

Panel tests: mount `MinionBook`, click `.book-rules`, and check that `.wiki-item` count === `WIKI_ENTRIES.length`;
type into `.wiki-search`, which narrows; click a question, which expands and renders the answer; `aria-expanded`
toggles.

### Task 4: Seed content (~20 entries), patch note, gates

**Files:** `rulesWiki/{basics,shop,combat,keywords,lobby,questsRunes,controls,glossary}.ts`,
`uncoveredKeywords.ts` (shrink), `patchNotes.ts` (prepend).

Every answer is verified by the research reports (file:line). `covers` fps are computed by running the tripwire
and pasting the reported fp. Gates: `npm run typecheck && npm run lint && npm test && npm run build:web`.
