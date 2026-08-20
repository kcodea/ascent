# Keyword definition panel — design

**Date:** 2026-08-20
**Status:** Design (awaiting owner review)
**Owner:** Mike (presentation / `packages/ui`)

## Summary

When a player **hovers** a card (the enlarged reveal) or **right-click inspects** it (the centred
overlay), show a column of small **definition boxes** to the right of the enlarged card — one box per
game term that appears in that card's text. Each box leads with the **term's word on its own line**,
with its definition on the line(s) below. Boxes are individual (not one grouped list), stacked
vertically.

Goal: a player reading a card never has to remember what *Ward*, *Echo*, *Slaughter*, *Choose One*,
etc. mean — the relevant definitions sit right beside the card, and only the ones that card actually
uses.

Scope is **presentation only** — no engine, content, or card-data changes. New files and edits live
entirely in `packages/ui/`.

## Decisions locked in brainstorming

1. **Thumbnail = a boxed text chip**, not an icon. Header line is the term's **word**; definition
   below. One box per term; a vertical stack, not a grouped list.
2. **Detection = scan the card's displayed description text** for known glossary terms, unioned with
   the card's structured badge `keywords`. (Approach A — UI-only, matches "keywords in the
   description".)
3. **Both surfaces:** the hover reveal (`.cardref` in `Card.tsx`) and the right-click `Inspect`
   overlay. Panel docks to the **right** of the enlarged card in both.
4. **Glossary scope:** combat keywords + ability triggers + gameplay mechanic nouns (~28 entries).
   **Excludes tribe names** (Beast, Demon, Dragon, Imp, Dwarf, …).

## Architecture

Three new units in `packages/ui/src/`, plus edits to two existing components and the stylesheet.

### `keywordGlossary.ts` (new) — the single source of truth

An ordered array of entries, each:

```ts
interface KeywordDef {
  id: string;            // stable key, e.g. 'ward'
  name: string;          // DISPLAYED header word, e.g. 'Ward' (post-terms.ts naming)
  aliases: string[];     // extra strings to match in text (classic names, plurals, ':' forms)
  badge?: Keyword;       // the schema code (e.g. 'DS') when this term is also a badge keyword
  def: string;           // one-line player-facing definition
}
```

- One array, in a fixed **reading order** (abilities → combat keywords → mechanic nouns), so the
  rendered column is stable and never reflows between cards.
- `name` uses the game's displayed vocabulary (Ward, Echo, Flurry, Execute, Rise, Shout, Attachment,
  Gilded) — matching what `terms.ts` renders — with the classic names in `aliases` as a safety net.
- Consolidates the four scattered code→name maps that exist today (`Card.tsx`, `float.ts`,
  `questText.ts`, `UnitEditor.tsx`) into one authoritative list. Those maps stay as-is for this PR
  (out of scope to refactor), but the glossary becomes the place new terms are documented.

### `detectCardKeywords.ts` (new) — pure detection function

```ts
function detectCardKeywords(card: CardView): KeywordDef[]
```

- Input: a card view (has `keywords: Keyword[]` and a text description).
- Reads the card's **displayed** description (the same `liveCardText` output the card renders, so it
  is post-`terms.ts` and includes live values — we only need its words).
- Returns the glossary entries the card references, computed as the union of:
  1. **Badge keywords** — every entry whose `badge` code is in `card.keywords`.
  2. **Text matches** — every entry whose `name` or any `alias` appears in the description, matched
     on **word boundaries** (so "Ward" doesn't match "Warden", "Rise" doesn't match "Uprising"), and
     bold-agnostic (strip the `**` first).
- **Deduped** (an entry that is both a badge and named in text appears once) and returned in the
  glossary's fixed order — never the order of appearance, to keep the panel stable.
- Pure and memo-friendly: no DOM, no engine calls. One call per inspected/hovered card.

### `KeywordDefs.tsx` (new) — the panel component

```tsx
function KeywordDefs({ card }: { card: CardView }): JSX.Element | null
```

- Calls `detectCardKeywords(card)` (memoized on the card identity + its live text).
- Renders **nothing** (`null`) when the card references no glossary terms — so a vanilla-stat
  minion adds no panel.
- Otherwise renders a `.kwdefs` column of `.kwbox` items, each:
  - `.kwbox-name` — the term's word (header line).
  - `.kwbox-def` — the definition (below).

### Integration points

- **`Inspect.tsx`:** wrap the existing `<Card …/>` and a `<KeywordDefs card={inspect} />` in a flex
  row inside `.inspect-card`, card first, defs column to its right. Inspect is already disabled during
  combat, so no combat interaction.
- **`Card.tsx` `.cardref` hover reveal:** the reveal already renders the card plus any trailing
  referenced cards in a horizontal flex row (`.cardref-inner`), portalled to `<body>`. Append
  `<KeywordDefs card={card} />` after the popup cards. It inherits the reveal's existing left/right
  `origin` positioning, so near the right screen edge the whole cluster still fits (same behaviour the
  trailing referenced-cards already rely on).

### Styling (`styles.css`)

- `.kwdefs` — a vertical flex column, small gap, fixed max-width, aligned to the top of the card,
  scrolls within its own height if a card somehow references many terms (`overflow-y: auto`).
- `.kwbox` — a bordered chip in the board's glass-chrome family (reuse existing surface tokens; no new
  literal colours). `.kwbox-name` bold, its own line; `.kwbox-def` lighter, smaller, wraps.
- **No animated paint properties** (per the perf rule): boxes are static DOM. No per-frame work.

## Data flow

```
hover / right-click
      │
      ▼
KeywordDefs({ card })
      │  detectCardKeywords(card)          ← pure, memoized
      ▼
[ KeywordDef, … ]  (fixed glossary order, deduped)
      │
      ▼
.kwdefs → .kwbox( name + def ) × N         ← static DOM, right of the card
```

## The glossary (DRAFT — owner reviews wording)

Names are the **displayed** terms. Definitions are first-draft, one line each — **the wording is
yours to edit.** Grouped here for review; in code they live in one ordered array.

### Ability triggers

| Term | Badge | Definition (draft) |
| --- | --- | --- |
| **Shout** | — | Triggers when you play this minion from your hand. *(classic: Battlecry)* |
| **Echo** | — | Triggers when this minion dies. *(classic: Deathrattle)* |
| **Start of Combat** | SC | Triggers once at the start of combat, before any attacks. |
| **End of Turn** | — | Triggers at the end of each of your shop turns. |
| **Avenge (N)** | — | After N friendly minions have died this combat, triggers its effect. |
| **Rally** | RL | Triggers each time this minion attacks in combat. |
| **Slaughter** | SL | Triggers whenever this minion kills an enemy. |
| **Choose One** | — | When you play it, pick one of its two effects. |
| **Dawn / Dusk** | — | Celestial cards alternate between Dawn and Dusk each combat; the active state picks which half of the effect fires. |

### Combat keywords

| Term | Badge | Definition (draft) |
| --- | --- | --- |
| **Taunt** | T | Enemies must attack this minion before any other. |
| **Ward** | DS | Blocks the first instance of damage it would take, then breaks. *(classic: Divine Shield)* |
| **Execute** | V | Any damage it deals to a minion destroys that minion. *(classic: Venomous)* |
| **Flurry** | W | Attacks twice each combat turn. *(classic: Windfury)* |
| **Rise** | R | The first time it dies, it returns with 1 Health. *(classic: Reborn)* |
| **Cleave** | C | Its attack also strikes the minions beside its target. |
| **Crit** | CR | Its attack has a chance to deal double damage. |
| **Attachment** | M | When played, can fuse onto a friendly minion, adding its stats and keywords. *(classic: Magnetic)* |
| **Immune** | IMM | Takes no damage. |
| **Stealth** | ST | Can't be attacked or targeted until it attacks. |
| **Engraved** | EG | Keeps the stat gains it earns during combat (normally combat buffs are shed afterward). |

### Mechanic nouns

| Term | Badge | Definition (draft) |
| --- | --- | --- |
| **Consume** | CN | Devours a friendly minion (usually Fodder) to take its stats. |
| **Fodder** | FD | A disposable minion meant to be eaten by Consume effects for its stats. |
| **Discover** | — | Choose one of a few offered cards to add. |
| **Ruby** | — | A spell-like token minted to your hand; drop it on a friendly minion to grant that minion the Ruby's Attack and Health as permanent stats. |
| **Dwarven Ale** | — | A token brewed by Dwarves; the more Ale you've brewed, the bigger your "per Ale" payoffs. |
| **Shop spell** | — | A spell cast in the shop (recruit phase), not in combat. |
| **Gilded** | — | A minion made from three copies — stronger, with a doubled effect. *(classic: Golden)* |

**Open wording questions for the owner:** the exact rules text for **Avenge (N)** (does N reset per
combat?), **Dwarven Ale** (its precise payoff), **Ruby** (whether to mention it grows with "Rubies
gain +X"), and whether **Gilded** and **Shop spell** belong in the panel at all or read as too
obvious. Flagged, not blocking.

## Testing

- **`detectCardKeywords` unit tests** (`detectCardKeywords.test.ts`):
  - A Taunt/Ward minion → `[Taunt, Ward]` in glossary order.
  - A card with a Deathrattle **and** Choose One → `[Choose One, Echo]` (order = glossary order, not
    text order), no duplicates.
  - A card whose badge keyword is **not** named in its text (e.g. a plain Taunt statline) → still
    includes Taunt from the badge union.
  - A vanilla minion with empty text and no keywords → `[]` (panel renders nothing).
  - Word-boundary guard: a card whose text contains "Warden" or "Uprising" does **not** match Ward /
    Rise.
- **Formatting-drift guard test:** assert every glossary entry's `name`/`alias` set actually appears
  (bolded) in at least one real card's displayed text — so if the card vocabulary ever drifts from the
  glossary, CI fails loudly rather than the panel silently missing a term. *(If some entries like
  "Shop spell" or "Gilded" aren't in any single card's own text, they're exempted from this assertion
  with a comment.)*
- **No render tests needed** beyond the above; the component is a thin map over the pure function.

## Non-goals / YAGNI

- No icons in the boxes (explicitly dropped).
- No new keyword art.
- No refactor of the four existing name-maps into the glossary (propose separately).
- No combat-surface support (Inspect is off in combat; hover reveal is a shop/hand/warband affordance).
- No click-through / linking between boxes.

## Files touched

- **New:** `packages/ui/src/keywordGlossary.ts`, `packages/ui/src/detectCardKeywords.ts`,
  `packages/ui/src/detectCardKeywords.test.ts`, `packages/ui/src/KeywordDefs.tsx`.
- **Edited:** `packages/ui/src/Inspect.tsx`, `packages/ui/src/Card.tsx` (the `.cardref` block only),
  `packages/ui/src/styles.css` (new `.kwdefs` / `.kwbox` rules).
- **Docs:** `docs/devlog.md`, `README.md` (per the commit contract).
