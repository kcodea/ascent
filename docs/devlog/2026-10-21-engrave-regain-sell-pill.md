# 2026-10-21 · Engraved regains a lost one-fight keyword; the Sell pill and the sold counters

Two small PRs off owner rulings the same day, one devlog file kept IDENTICAL on both branches so neither merge
conflicts: `fix/engrave-regained-temp-keyword` (the Engraved half) and `fix/sell-pill-and-counters` (the Sell half).

## Engraved regains a lost one-fight keyword (fix/engrave-regained-temp-keyword)

Follow-up to #2206 (R-ENGRAVE-03). Owner: "yea if it re-gained in a 'legit' way it should carry back".

### The gap

#2206 measured combat keyword gains against the start-of-fight keyword list. A body that opened the fight with a
TEMPORARY keyword (Maw of the Pit's one-fight Ward, Lord of the Risen's one-fight Rise, a banked next-combat keyword
such as Field Maneuvers, a Whisper keyword), lost it, and then regained it from a combat effect kept nothing, because
the keyword was on its starting list.

### Mechanism

- `BoardMinion.tempKeywords` (core types): the entries of `keywords` that are one-fight only on the run card. Built by
  `tempKeywordsOf` in `playerBoardMinions` (sim reducer) from `tempShield` (DS), `tempReborn` (R) and
  `whisperKeywords`. No combat effect reads it. Served lobby snapshots do not carry it: they never settle.
- `simulate`: next to the existing baseline, `engraveKwPerm` = the INPUT board's keywords (before the banked
  openers stamp anything) minus `tempKeywords`. Every other baseline keyword is temporary. `scanEngravedKeywords`
  marks a temporary baseline keyword the body is seen without as lost (`engraveKwLost`); holding it again later while
  Engraved is recorded like any other gain. Permanent keywords never count. Rise copies are still skipped
  (`riseCarry`), so a risen copy regaining its Ward carries nothing.
- `settleCombat`: a carried keyword the card holds temporarily drops its mark (`tempShield` / `tempReborn` /
  `whisperKeywords`), so the post-fight strip or the next Start of Turn leaves it in place.

### Decisions

- Permanent keyword lost and regained: nothing reported (the card already keeps it), so the recap shows no "+Ward".
- Foamguard: a Foamguard whose Ward was temporary now keeps the Ward it regains; one with its printed Ward reports
  nothing.
- Rebirth gains carry (Rebirth is the same body, R-RISE-06), unchanged; cited in R-ENGRAVE-03.
- A keyword stamped on at combat start by a run-wide aura is treated as temporary too (it is not on the run card).

## Sell pill and the sold counters (fix/sell-pill-and-counters)

- **Sell pill broadened.** #2203 made every printed sell verb the capitalised keyword (R-TEXT-SELL-CAPS-01), but the
  pill was still pinned to the "Sell:" lead by a `match` regex, because its definition read "Triggers when this
  minion is sold". Owner: show it on "When you Sell…" and other Sell mentions too. The glossary entry
  (`packages/ui/src/keywordGlossary.ts`) drops `match` and takes aliases Sells / Selling, so it matches like every
  other term (case-sensitive word match, and it now colours like one). New one-line definition covering both
  meanings: `Return a minion to the Shop for Gold. "Sell:" effects trigger when this minion is sold.`
- **Countdowns are integers.** #2203's live text wrote countdown prose for Mark Eting ("2 more minions"), Valyou
  ("(3 more)") and Leeds. Owner: "i dont think we use text for this, just integers". The game's convention is the
  integer counter under the card (`stepProgress`, the Avenge-style N/4 tally, ruled for Astral Spellcore and Festival
  Keeper on 2026-09-11), and all three already wore it. So `soldProgressText` and `sellGoldMeterText` are gone (the
  text stays authored) and `sellImproveText` only swaps Leeds' CURRENT grant in place of +2/+2 once it has improved.
  Runic Archivist (archived) shared `soldProgressText` and now follows the same convention.
- **Price sense stays capitalised** ("Cards **Sell** for +1 Gold"): owner KEEP, cited in R-TEXT-SELL-CAPS-01.
