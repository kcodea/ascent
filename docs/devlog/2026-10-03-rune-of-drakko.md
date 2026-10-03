# 2026-10-03: Rune of Drakko (a Dragon / Spirit Drakko)

Owner ask (verbatim): "add this rune to set 2 and 3: All Drakko - 4 cost: Get a Drakko with Dragon/Spirit type."
Follow-ups the same day: pool "Epic"; name "Rune of Drakko"; gate "if either tribe is in a set it should be
offered. categorize it as a dragon and/or spirit rune".

## What shipped

- **`rune_drakko`** (`packages/content/src/runes.ts`, `EPIC_RUNES`): Epic, 4 Gold, `sets: ['set2', 'set3']`,
  `tribes: ['dragon', 'spirit']` (the forge gate is already an OR, `tribes.some`), reward
  `{ kind: 'grant', cards: ['n2_drakko_dragonspirit'] }`. Text: "Get a **Drakko** that is a **Dragon** and a **Spirit**."
- **`n2_drakko_dragonspirit`** (`cards/set2/tokens.ts`, member of no set, `token: true`): Drakko's body and rule
  (T5 3/5, "Your Shouts trigger twice", Gilded three times) printed as a Dragon / Spirit dual type.

## Why a dual-type token, not `addedTribes` on a regular Drakko

The instance channel (`BoardCard.addedTribes`, Anomaly Reactor's) is not enough for "counts as both everywhere".
Three reasons:
- `playedThisTurn` is a list of card ids read through `CARD_INDEX`. So "Spirits played this turn" (Kindled Sprite,
  Mother Moss, Crescendo) would never see an instance tribe.
- Dozens of def-level `tribe` / `tribe2` checks would also miss it.
- In combat it holds only ONE extra tribe, in the `tribe2` slot.

A printed tribe pair is read correctly by every path, in every phase, with no engine special-casing. The Baal token
(Rune of Baal) set the precedent.

## Engine touch: the multiplier `group`

`extraTriggerFires` keys "best copy per card" multipliers by card id. Left alone, a regular Drakko plus this one
would be x4. So `TriggerMultiplierDef` gained an optional `group` (`core/types.ts` + the content schema). Copies
sharing a group are one multiplier, which keeps the owner's "two Drakkos are still twice" ruling. A different
multiplier (Chronos) still multiplies with it.

## Categorisation

- `RuneDef` gained an optional `synergy` override (schema-validated) that `runeSynergies` already honoured in
  type only.
- The rune names `['dragon', 'spirit']`. The text tagger has no Spirit pattern (Set 3 tribes are deferred there), so
  without the override the forge synergy pick would read it as Dragon only.
- The Compendium's rune filter and the forge gate read `tribes` with `some`, so the rune lists under both tribes.

## Known trade-offs

- It does not triple with regular Drakkos (a different id).
- Drakko's skins and art are keyed by `drummer`, so it shows the placeholder art. Art wiring waits on an owner ask.
- It wears the Epic medallion (`epicMedallion.ts`).
- In Set 2 the Spirit half has nothing to hit, and in Set 3 the Dragon half has nothing to hit. Each set has only
  one of the two tribes.

Tests: `packages/sim/src/runeDrakko.test.ts`. Oracle: R-RUNE-35.
