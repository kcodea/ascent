# 2026-10-21 - Set 3 Sell Dwarves, and Sell as a capitalised keyword

Two owner content asks in one PR.

## A. Four new Set 3 Dwarves

All four were NEW (no name or id collision in any set, the archive, runes or tokens). Appended to `SET3_DWARVES`, so
they join Set 3's pool and not Set 2's. No art wired (the owner did not name any).

| Card | Tier, body | Text | Built from |
| --- | --- | --- | --- |
| Salezar Sails (`dw3_salezarsails`) | T2 3/1 | **Sell:** Give your Dwarves +2/+3 | `battlecryBuffTribe` on `onSell` (`includeSelf: false`) |
| Mark Eting (`dw3_marketing`) | T3 2/6 | When you **Sell** 4 minions, get a random Shop Spell | `minionSoldGrantSpell` `{ count: 4 }` (Runic Archivist's meter) |
| Valyou (`dw3_valyou`) | T5 6/9 | When you **Sell** a minion, gain +3/+3. Every 4 triggers also grants 2 Gold | `minionSoldBuffSelf` + new `health` / `count` / `gold` params |
| Leeds (`dw3_leeds`) | T6 6/8 | When you play a Dwarf, give your Dwarves +2/+2. Improves when you **Sell** 4 minions | new `tribePlayedBuffTribeSellImproving` + new `minionSoldTally` |

Conventions chosen:

- **Gilded.** Salezar +4/+6. Mark Eting follows Runic Archivist: two spells per payout, still every 4 sales (not a
  halved counter). Valyou doubles the stats AND the Gold (+6/+6, 4 Gold), the Keg Runner / Hoard Whelp convention.
  Leeds doubles the base and so every step (+4/+4, +8/+8, ...).
- **Improves.** Each step adds the base grant again: +2/+2, then +4/+4, then +6/+6. This is the convention of Aspect
  ("Improves every 3 times this triggers", +2 base, +2 step), Flowing Monk and Archmagus Guel.
- **Meters.** All three counters ride the existing per-instance `soldProgress` field, which already survives combat,
  snapshots and serving. Mark Eting and Valyou store it reduced (Archivist's shape); Leeds stores the lifetime count,
  since its level is `floor(sales / 4)`. Every reader takes it `% 4`. Sales only count while the card is on the
  board; a copy in hand neither counts nor fires.
- **Shop Spell pool.** Mark Eting draws from `runSpells` at or below the Shop tier: set-pinned, tribe-gated, no
  tokens, Gifts or Rubies. (The #2185 legal-pool helper is minions only; this is its spell twin.)
- **Leeds' trigger** is `onTribePlayed`, the real-play watcher Coin Counter uses (never a token summon; the dispatcher's
  `defIsTribe` lets an All-types play count and skips Leeds' own arrival). It buffs every Dwarf on the board, itself
  and the played Dwarf included, like Chef Gary Toast's "your Dwarves". Its improve param is `sellEvery`, not
  `every`, so the shared step counter does not mistake it for a Spirit-play tally.

Live text (`packages/ui/src/cardText.ts`, wired into `instView`, so shop, board, hand, Discover and combat all read
it): Mark Eting prints "{{2 more minions}}" in place of "4 minions" (and `soldProgressText` now reads the Gilded text
when Gilded, a latent Archivist gap); Valyou prints "Every 4 triggers ({{3 more}})"; Leeds prints its current grant
in place and the sales owed to the next step. All three wear the shared N/4 sold counter.

## B. Sell is a keyword, capitalised everywhere

Owner ruling: "capitalized, it's a keyword". Every printed use of the sell verb is now `**Sell**`, `**Sells**` or
`**Selling**` (or the existing `**Sell:**` trigger lead), across cards plain and Gilded in every set and the archive,
runes, Equipment (Thymepiece), Robin's hero power, the Ancient pairing lines, Smokey Joe's live text and Rune of
Investment's quest-reward line. Text only, no behaviour change.

Left alone on purpose: "sell value" (a noun; its live-text helper keys on the lower-case phrase), "sold" and "sales",
patch-note history, the rules wiki prose, and the tutorial lines. The hover pill stays pinned to "Sell:" (R-TEXT-09):
its definition is "Triggers when this minion is sold", which would be wrong on "When you Sell a minion".

Pinned by `packages/sim/src/sellKeywordText.test.ts`, which sweeps the whole printed corpus.

## Oracle

R-DWARF-1021-05 (the four cards) in `registry/approved/triggers.ts`; R-TEXT-SELL-CAPS-01 in `registry/approved/text.ts`
(R-TEXT-09's example updated to the capitalised Arcane Behemoth text). `npm run docbot:sync` regenerated the
contracts and wording queues; the final report's contract count moved 1099 -> 1103.
