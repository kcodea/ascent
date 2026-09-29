# Rules wiki: a searchable in-game FAQ (design)

Owner ask, 2026-09-28: friends are trying the game, and there are lots of mechanics they won't know yet ("how is
going first decided?", "how do I sell a unit?", "what's a friendly unit?"). Build a comprehensive, searchable
wiki of hundreds of short Q&As in a casual, human voice.

## Decisions (owner, 2026-09-28)

| Question | Answer |
|---|---|
| Where it lives | **Inside the game**, in the **Compendium** |
| Accuracy | **Code-verified, plus a tripwire test** that flags answers whose underlying rule changed |
| Scope | **Mechanics only**: rules, keywords, shop, combat, lobby/Rating, quests/runes as systems, controls, glossary terms. No per-card, per-hero or per-rune entries (the Compendium already shows those) |
| Voice | Casual, player-level. Say what the player sees and can do. **Never** explain the implementation ("seeded so replays match" is out; "it's a coin flip" is in) |

## What players see

- A **Rules** button in the Compendium header, a sibling of **Glossary**, that swaps the book body for the wiki
  (the same pattern the Glossary uses). Tab / Esc still close the book. The Compendium already opens from the title
  screen and mid-run, so there are no new entry points.
- Top: a search box (autofocused) and a row of **topic chips**: Basics · Shop · Combat · Keywords · Lobby &
  Rating · Quests & Runes · Controls · Glossary. With no chip lit, every topic shows.
- Below: questions grouped under topic headings. Click a question to expand its answer (accordion; several can be
  open at once). Answers support `**bold**` and "See also" links that jump to and expand another entry.
- **Search** matches the question, the answer and hidden `aliases` (ways a player would phrase it: "get rid of a
  minion" → the selling entry). It ranks question/alias hits above answer-body hits. Searching lights no chip:
  it searches everything, but a lit chip narrows the search, the same as the card gallery. A search with no
  results says so and suggests the topic chips.
- Keyword names inside answers use the game's existing term colouring (`termColour.ts`).
- Stage rules apply: nothing portals to `document.body`, no raw `vw`/`vh`, no `title=` attributes, no bare
  `cursor:` keywords (buttons pick up the gauntlet from the global rule).

## Data

`packages/ui/src/rulesWiki/`: **one file per topic** (so parallel authoring never conflicts), plus `index.ts`,
which concatenates them.

```ts
interface WikiEntry {
  id: string;            // stable kebab slug, e.g. 'sell-a-unit'. Never recycled.
  topic: WikiTopic;      // one of the fixed chip topics
  q: string;             // the question, as a player would ask it
  a: string;             // the answer: casual, 1-4 short sentences, **bold** allowed
  aliases?: string[];    // other phrasings / words players might search
  seeAlso?: string[];    // ids of related entries
  covers?: WikiCover[];  // what this answer depends on (the tripwire)
}
type WikiCover =
  | { rule: string; fp: string }     // an approved R-… rule id + fingerprint of its statement
  | { keyword: string; fp: string }; // a KEYWORD_GLOSSARY id + fingerprint of its def
```

The runtime bundle contains only the entries. The rules registry is imported **only by the test**.

## Keeping it true (tests, `rulesWiki.test.ts`)

1. **Integrity:** ids are unique and slug-shaped; every `seeAlso` id exists; every topic is a known topic; `q`
   ends with `?`; the answer is non-empty and has no `title=`-style or dev jargon (a small banned-word list:
   `seed`, `RNG`, `reducer`, `simulate`, `event log`, `deterministic`).
2. **Tripwire:** every `covers` rule id exists in `APPROVED_RULES` (or the resolved approved set) and every
   keyword id exists in `KEYWORD_GLOSSARY`, and each `fp` equals a short hash of the current statement / def. A
   mismatch fails with the entry id and the new fingerprint: "rule R-X changed; re-check answer 'y' and update
   fp to 'abcd1234'". This is a deliberate false alarm on typo-only edits; the owner accepted that trade.
3. **Keyword coverage ratchet:** every `KEYWORD_GLOSSARY` term must be covered by at least one entry, except
   those listed in `UNCOVERED_KEYWORDS`. That list may only **shrink**: the test also fails on a listed keyword
   that is now covered, so the list is kept honest. It starts with everything the seed batch doesn't cover and
   empties as content lands.

## Authoring the content

- About 250–400 entries in total. Each answer is verified against the engine/sim code, `docs/GAME-RULES.md` and
  the approved rule registry. Not from memory.
- Written by parallel research agents, one per topic, then given a single consistency and voice pass.
- When an answer can't be pinned down from the code (ambiguous or undecided behaviour), it is **not guessed**.
  It's collected into a list for the owner instead.

## Delivery

1. **PR 1:** the Rules panel, search, tests/tripwire, and about 20 seed entries across topics. Patch-notes entry.
2. **PR 2+:** content in topic batches (each PR shrinks `UNCOVERED_KEYWORDS`).

## Out of scope

Per-card/hero/rune pages, images or videos in answers, a web version, and editing from inside the game.
