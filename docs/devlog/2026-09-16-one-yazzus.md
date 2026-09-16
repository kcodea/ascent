# 2026-09-16 — One Yazzus (the set-3 fork becomes THE card) + Frontline Glory leaves Set 3

Owner rulings (2026-09-16): *"There is no legacy or new Yazzus. Just make the set 3 Yazzus the permanent Yazzus.
The only change is it works with ALL targeted spells instead of Shop spells only."* And Rune of Frontline Glory is
dropped from Set 3.

## What the two defs actually differed in

| | `yazzus` (set 1/2, before) | `n3_yazzus` (set-3 fork) → now `yazzus` |
| --- | --- | --- |
| Tier | 7 | 7 |
| Stats | **5/7** | **4/8** |
| Scope | targeted **Shop** spells (`spellCastMult` only) | **every** targeted spell — Shop spells, Rubies (`rubyCastCount`), Tower Shield / Clue (`giftMulticast` via `yazzusExtraCasts`) |
| Text | "Your **targeted** Shop spells cast **twice** / three times." | "Your **targeted** spells cast **an additional** time / 2 additional times." |
| Pool slot | set 1 + set 2 (`SET1_NEUTRALS_IN_SET2`) | set 3 (`SET3_NEUTRAL`) |

Scope was the intended difference; the **stats also differed** (5/7 vs 4/8). Per the ruling the Set 3 version wins
wholesale, so Yazzus is 4/8 in set 2 as well now (`sets.test.ts`'s "carried at set-1 stats" pin moved with it).

## What changed

- **Content.** `yazzus` (`cards/set1/neutral.ts`) carries the set-3 body + text; the `n3_yazzus` def is deleted
  from `cards/set3/neutral.ts`. Set 3 opts the shared `yazzus` in at exactly the manifest slot the fork occupied
  (`YAZZUS_IN_SET3` in `sets.ts`), so seeded set-3 pool order did not move. `SET_FORKS` is now `{}`; the
  mechanism and `forkedCardId` stay for the next set that genuinely needs a fork.
- **Legacy id.** `LEGACY_CARD_IDS` (`packages/content/src/index.ts`): `n3_yazzus → yazzus`, bound onto
  `CARD_INDEX` as a **non-enumerable** alias — `CARD_INDEX['n3_yazzus']` resolves, while every
  `Object.values/keys(CARD_INDEX)` sweep (audits, Compendium, Doc Bot registries, balance tools) still sees the
  card once. `deserialize` (`state.ts`) additionally rewrites every `cardId` in a loaded save to the current id
  (`healLegacyCardIds`, one walk at load), so id-keyed engine reads (`c.cardId === 'yazzus'`) see a resumed run
  as a fresh one. `canonicalCardId()` is exported for anything else that wants the mapping.
- **Engine.** `spellCastMult` is `1 + yazzusExtraCasts` and both read `yazzus` only.
- **Runes.** `rune_frontline_glory.sets` → `['set1']`. Set 3's carryover pool is **115 Basic / 97 Epic** (was 98);
  set 1 / set 2 unchanged (105/90, 135/126). The originals (21 Basic / 28 Epic) sit on top as before.
- **Art.** `ART_ALIAS` is empty; the duplicate `art/minions/n3_yazzus.webp` is deleted (it was a byte-identical
  copy of `yazzus.webp`).
- **Docs/notes.** GAME-RULES roster numbers + the set-forks paragraph; a patch note (Card Change + Rune Change).

## Verification

`npm run typecheck && npm run lint && npm test && npm run audit && npm run text:audit && npm run
contracts:extract && npm run docbot:report -- --check` green; the regenerated registry / final-report numbers are
committed with the change. New pins: `set3RuneRoster.test.ts` (empty `SET_FORKS`, alias resolves, Rune of Yazzus
grants `yazzus` in set 2 and set 3, Frontline Glory out of the set-3 forge), `set3Neutral.test.ts` (one Yazzus
doubles Shop spells, Rubies, Tower Shields and Clues; golden ×3).
