# 2026-09-23 — Sell: the self-sold trigger gets a printed keyword

Owner ask (verbatim): *"i want to make Sell a keyword. any card that operates on a 'When you sell this' should
now say 'Sell: xyz' with sell being a highlighted keyword. no mechanical change, just text and keyword updates.
put a pill in for Sell that says 'Triggers when this minion is sold.'"*

Text and keyword only. No effect, trigger or parameter changed; every `onSell` wiring is as it was.

## The texts

Every minion with an `onSell` effect (the trigger that fires when THIS minion is sold) now prints the keyword
form. Hoard Whelp already read `**Sell:** get **6 Gold**` and is unchanged; it set the convention (lower-case
verb after the colon, the same as `**Shout:** give …` on 345 of the 393 keyword-colon texts in the corpus).

| Card | Before | After |
| --- | --- | --- |
| Salvatore McKlusky (`salvatore`) | When you sell this, **Discover** 2 Tier 6 minions. | **Sell:** **Discover** 2 Tier 6 minions. (gilded: 2 **golden** Tier 6) |
| River Drake (`d2_riverdrake`) | When you **sell** this, get a **random Spell**. | **Sell:** get a **random Spell**. (gilded: **2 random Spells**) |
| Beggy (`k_beggy`) | When you **sell** this, get **2 Rubies**. | **Sell:** get **2 Rubies**. (gilded: 4) |
| Cheap Date (`k_pouchpincher`) | When you **sell** this, get a random **Tier 1** minion. | **Sell:** get a random **Tier 1** minion. (gilded: 2) |
| Traveling Salesman (`n2_salesman`) | When you **sell** this, **Discover** a minion you control **exactly one** copy of. | **Sell:** **Discover** a minion you control **exactly one** copy of. (gilded: **Discover 2**) |
| Flame Reveler (`sp3_flamereveler`) | When you **sell** this, give your Spirits **+1 Attack**, then increase that by 1. | **Sell:** give your Spirits **+1 Attack**, then increase that by 1. (gilded +2) |
| Tide Reveler (`sp3_tidereveler`) | When you **sell** this, give your Spirits **+1 Health**, then increase that by 1. | **Sell:** give your Spirits **+1 Health**, then increase that by 1. (gilded +2) |
| Grove Reveler (`sp3_grovereveler`) | When you **sell** this, give your minions **+1/+1**, then increase that by 1. | **Sell:** give your minions **+1/+1**, then increase that by 1. (gilded +2/+2) |

The one live-text helper that reprinted the phrase moved with them: `spiritText` in `packages/ui/src/cardText.ts`
(the Revelers' shared live value, read by both the shop chain via `instView` and the combat Unit). No other
helper emits the sentence.

**Kept as they are, on purpose.** The keyword means *this minion is sold*. A card that reacts to selling
another minion is the `minionSold` watcher, not `onSell`: Arcane Behemoth ("When you sell a Demon, this gains
its stats"), Shift Broker, Voicekeeper, Grand Procession, Festival Treasurer, Runic Archivist, Grevlin & Co.
Robin's hero power counts sales ("For each minion you sell, gain 1 Gold next turn"), the sell spells and the
Rune of the Fire Sale sell other minions, and "Sells for 2 Gold" is a value line. None of those is "this minion
is sold", so none takes the keyword.

## The keyword

- **Glossary** (`packages/ui/src/keywordGlossary.ts`, section Triggers, icon `mana` — the Gold coin): `sell` /
  "Sell", the owner's definition verbatim. No schema badge and no `MECHANICS` medallion row (`onSell` stays
  "deliberately unclassified" there; a medallion would be a presentation change the ask did not make). The
  pill renders from the text hit, like Shout.
- **`match`**, a new optional `KeywordDef` field: a RegExp that REPLACES the name / alias word-boundary matcher
  for pill detection AND term colouring. Sell needs it because the bare word is ordinary text elsewhere:
  "Sell a friendly minion" (three spells, a Gift, a rune) and "Sells for 2 Gold" (two value lines). Without it
  those would raise a pill that says "this minion". Sell's `match` is `/(?<![A-Za-z])Sell(?=\s*[:：])/`, the
  keyword form only. `detectCardKeywords` uses `def.match ?? <name matcher>`; `termColour` builds `TERM_RE`
  from the form matchers plus the flat vocabulary, and `COLOURED_TERMS` no longer lists a `match` entry's name
  (so the sweep never expects "Sell" coloured in a spell). On the cards themselves the word is inside
  `**Sell:**`, so the bold pass paints it in the tribe colour on every surface (shop, board, hand, Discover,
  Inspect, Compendium, combat Unit — all through `mdBold` / `rulesHtml`) and the colouring pass leaves it alone.
- **Compendium**: the row is generated from the glossary; a non-mechanic row filters the gallery by the pill's
  own text hit, so "Sell" lists exactly the nine `onSell` minions.
- **Doc Bot**: `TRIGGER_LEXICON` already carried `{ /^Sell\s*[:：]/ → 'onSell' }` (Hoard Whelp's form), and
  `classify.ts` already aliased `onSell` to `[onSell, minionSold]`, so "Sell:" parses exactly like "Shout:" and
  no parser or lexicon change was needed. `npm run docbot` and every text rail are unchanged.

## Tests, rule, docs

- `packages/ui/src/detectCardKeywords.test.ts`: every `onSell` minion prints `**Sell:** ` in both texts and
  raises the pill; three texts pinned; the definition and section pinned; the verb, the value line, a lower-case
  "sell" and a `minionSold` sentence never raise it; Hoard Whelp raises `endofturn` + `sell` in glossary order.
- `packages/ui/src/termColour.test.tsx`: "Sell:" colours, "Sell a friendly minion" and "Sells for 2 Gold" do not,
  and `COLOURED_TERMS` does not carry the bare word.
- `keywordGlossaryCoverage.test.ts` passes both ways with no keep-list change.
- Oracle: **R-TEXT-09** in `packages/rules/src/registry/approved/text.ts` (owner quote as evidence, the three
  test files as enforcement).
- `docs/GAME-RULES.md`: Sell joins the kept-as-is vocabulary list and has its own section beside Pummel.
- Patch note (Balance, 2026-09-23) prepended.
