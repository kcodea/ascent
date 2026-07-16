# ASCENT — Content Snapshot

**⚠️ This is a point-in-time snapshot (verified 2026-07-15). These counts drift as content is
added or removed — do not treat them as current without re-checking.** The **source of truth** is the
card / quest / rune arrays under `packages/content/src/`, not this file:

- Minions: `packages/content/src/cards/{beasts,dragons,undead,mechs,demons,neutral}.ts`
- Spells: `packages/content/src/cards/spells.ts`
- Tokens (never in the shop): `packages/content/src/cards/tokens.ts`
- Enemy-only filler (never in the shop): `packages/content/src/cards/enemy.ts`
- Quests: `packages/content/src/quests.ts` (`QUEST_DEFS`)
- Runes: `packages/content/src/runes.ts` (`RUNES` + `EPIC_RUNES`)
- Heroes: `packages/sim/src/heroes.ts` (`HEROES`)

Aggregated, shop-filtered views live in `packages/content/src/index.ts`:
`BUYABLE_CARDS` (shop minions = non-token, non-spell) and `SPELL_CARDS` (shop spells = spell,
non-token). "Shop" counts below **exclude** `token: true` cards and the enemy-only pool.

---

## Counts (verified)

| Content | Count | Source |
| --- | ---: | --- |
| Shop minions (`BUYABLE_CARDS`) | **119** | `cards/{beasts,dragons,undead,mechs,demons,neutral}.ts` |
| Shop spells (`SPELL_CARDS`) | **37** | `cards/spells.ts` |
| Quests (`QUEST_DEFS`) | **79** | `quests.ts` |
| Basic runes (`RUNES`) | **25** | `runes.ts` |
| Epic runes (`EPIC_RUNES`) | **23** | `runes.ts` |
| Runes total | **48** | `runes.ts` |
| Heroes defined (`HEROES`) | **27** | `heroes.ts` |
| Heroes selectable (non-`wip`) | **24** | `heroes.ts` (filter `HEROES.filter(h => !h.wip)`) |
| Tribes | **6** | Beasts, Dragons, Undead, Mechs, Demons + Neutral glue |

Shop-minion breakdown by tribe file (non-token, non-spell): Beasts 21 · Dragons 18 · Undead 20 ·
Mechs 19 · Demons 18 · Neutral 23 = **119**.

Full card pool (`ALL_CARDS`, everything incl. tokens/spells/enemy) = **198**.

Three heroes are withheld from the picker via `wip: true` (Warden, Myra, Chaos), leaving **24 of 27**
selectable.

---

## Regenerating these numbers

- **`npm run dump-cards`** → writes `docs/cards.csv`, the canonical card reference, straight from
  `CARD_INDEX` (always accurate; re-run after card changes). `packages/tools/src/dump-cards.ts`.
- **`npm run audit`** → card audit / sanity report. `packages/tools/src/card-audit.ts`.
- **`npm run balance`** / **`npm run report`** → the headless balance runner + report over the
  counter matrix. `packages/tools/src/balance.ts`, `balance-report.ts`.

To recount programmatically, import the exported arrays from `@game/content`
(`BUYABLE_CARDS`, `SPELL_CARDS`, `QUEST_DEFS`, `RUNES`, `EPIC_RUNES`) and `@game/sim` (`HEROES`) and
read `.length` / filter by `.token` / `.spell` / `.wip`.
