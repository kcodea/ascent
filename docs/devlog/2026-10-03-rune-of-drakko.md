# 2026-10-03: Rune of Drakko (every Drakko is a Dragon and a Spirit)

Owner ask (verbatim): "add this rune to set 2 and 3: All Drakko - 4 cost: Get a Drakko with Dragon/Spirit type."
Follow-ups the same day: pool "Epic"; name "Rune of Drakko"; gate "if either tribe is in a set it should be
offered. categorize it as a dragon and/or spirit rune". Then the rework: "for drakko - it SHOULD triple with regular
drakkos. sorry, reword the rune a bit. It should be Get a Drakko. Drakko is a Dragon/Spirit this game. this makes all
drakkos in shop and everywhere a dragon/spirit. it isnt a new minion, it's just a drakko that has new types."

## What shipped

- **`rune_drakko`** (`EPIC_RUNES`): Epic, 4 Gold, `sets: ['set2', 'set3']`, `tribes: ['dragon', 'spirit']` (the forge gate
  is already an OR, `tribes.some`), `synergy: ['dragon', 'spirit']`. Text: "Get a **Drakko**. **Drakko** is a
  **Dragon** and a **Spirit** this game."
- Reward: `multi` of a new `cardTribes` reward (`drummer` → Dragon + Spirit) then a plain `grant` of `drummer`. The
  override lands first, so the granted copy arrives typed. No new card: it is the regular Drakko, so it triples.

## The run-level type override (one source of truth)

`RunState.cardTribes` maps a card id to the extra tribes EVERY copy of it has for the rest of the run. Union-only,
so a second rune is a no-op. Everything reads it through the shared predicates:

- **Def / id level** (Shop offers, pools, buy-time checks, the played-this-turn tallies): `defIsTribe(def, t, state)`
  folds it in, and the hand-rolled `x.tribe === t || x.tribe2 === t` sites in `recruit.ts`, `reducer.ts` and
  `spellFizzle.ts` gained `|| hasRunTribe(state, id, t)`. Their All-types semantics are unchanged.
- **Instance level**: `syncRunTribes` stamps the override onto every board and hand copy's `addedTribes`.
  `isTribeNatural` already reads that field. It runs at the action boundary (beside `syncUnity`), at the `playCard`
  chokepoint and in `grantMinionToHandOrBoard`.
- **Combat**: stamped bodies carry `addedTribes` into `BoardMinion`. `instantiate` now folds them through
  `foldTribes` (core/combat/minion.ts). A neutral printed tribe yields its slot, so a Drakko is a Dragon / Spirit in
  combat. A printed dual keeps its pair. `CombatSideState.cardTribes` (player side, and served boards via
  `BoardSnapshot.cardTribes` → `sideFromSnapshot`) gives a Drakko summoned mid-fight the same types.
- **Recorded boards**: snapshots already carry each body's `addedTribes`, and now also carry `cardTribes`.
- **Display**: `tribeFace` (instView) prints the folded pair on board / hand. It also reads the run map for Shop
  offers, held offers, Discover and Choose One options. Scouted and stored boards fold the body's `addedTribes`. In
  combat, `MinionSnapshot.tribe2` carries an added second tribe to `Unit`. The live-text "per Spirit / Dragon
  played" counts read `cardTribes` too.

## Side effect worth knowing

`foldTribes` replaced the old "added tribe fills a free `tribe2`" rule in `instantiate`. For a neutral card given ONE
added tribe (Anomaly Reactor, a Set 1 card), combat now reads it as `tribe: <added>` instead of
`tribe: 'neutral', tribe2: <added>`. That is equivalent for every tribe check.

## Not covered

Bot / balance heuristics (`bots/`, `productionBots/` beyond the tally, `balance/`) still read printed tribes only.
They are strategy scoring, not rules.

## Removed from the first cut (#1936)

The first version granted a separate Dragon / Spirit token and added a multiplier `group` field. The owner's rework
made both unnecessary, and both are gone.

Tests: `packages/sim/src/runeDrakko.test.ts`. Oracle: R-RUNE-35.
