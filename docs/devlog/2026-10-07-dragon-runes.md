# 2026-10-07 — the Dragon rune batch + rune-owned Equipment

Owner batch 2026-10-07: six new runes (Set 2), one forge-only Dragon (Firebird), two Equipment, and the engine
primitives they need. Branch `feat/dragon-runes-1007`.

## What shipped

| Rune | Forge | Cost | Mechanism |
|---|---|---|---|
| Rune of the Echoing Shouts | Basic | 3 | `runeThreshold` shout meter, `per: 1`, `buff: tribe dragon +3/+2` |
| Rune of the Whelps | Epic | 3 | `runeThreshold` shout meter, `per: 3`, `grantCards: ['d2_broodwhelp']` |
| Rune of the Voicekeeper | Epic | 2 | NEW `runeVoicekeeper` reward: sell-Dragon meter → plain copy of one of the 3 |
| Rune of the Flaming Dragon | Epic | 4 | `grant` of `d2_firebird` (T6 6/9 Dragon, `token: true`) |
| Rune of the Dragon's Egg | Epic | 2 | NEW `runeEquip` reward → Equipment `dragons_egg` (2 Gold: Discover a Dragon) |
| Rune of the Wise Armory | Epic | 3 | NEW `runeEquip` reward → Equipment `spell_generator` (2 Gold: spells +1/+1, a random stat spell) |

All are `sets: ['set2']`; the five Dragon runes are `tribes: ['dragon']`. Set 1 also has Dragons (Hoardcalling
and Drake Skull are `['set1', 'set2']`), but Set 1 is disabled, so the batch defaulted to Set 2 only (flagged to
the owner).

## New primitives

- **Rune-owned Equipment** (`runeEquip`, R-RUNE-EQUIP-01). `RunState.runeEquipment` records `{ runeId,
  equipmentId }`; `grantRuneEquipment` writes a `GrantedEquipment` with `sourceKind: 'rune'`, `sourceRuneId`
  and empty `sourceUids`; `rebuildEquipment` calls `syncRuneEquipment` after the board scan and the Star
  Destroyer sync, so the entry survives every Start of Turn with a fresh own charge. `equipmentSourceAlive`
  answers true for a rune source. Activation needs no change: with no board source the reducer's existing
  stand-in body (`eq:<id>`) is the `self`. Saves, replays (state replay) and restores carry it as plain run
  state. The UI rack needs no change: it renders from `run.equipment`, and the two new Equipment fall back to
  the glyph in the default housing (no art wired).
- **`onBattlecryCastNamedSpell`** (Firebird, R-FIREBIRD-CAST-01). One arena body (`arena.castNamedSpell`)
  behind a combat wrapper (side + alive guard) and a shop wrapper (the `fireBattlecryTriggered` dispatcher), so
  every Shout fire in either phase casts Dragonflame through the real cast pipeline. Golden casts twice inside
  `castNamedSpell`. Registered in the factory union, schema whitelist, presentation policies (`ownBeat`,
  `shoutReact`), the named-spell hover map, and Doc Bot's combat named-cast lane.
- **Combat shout-meter payloads** (R-SHOUT-METER-PAYLOADS-01). `QuestCombatMods.shoutMeters` entries can now
  carry `grantCards` (the Whelp into the hand mid-fight) and `buff` (a tribe buff on the side's living members).
  `shoutMetersFor` arms them; the existing tick write-back keeps ONE counter across phases.
- **`runeVoicekeeper`** (R-VOICEKEEPER-COPY-01). `RunState.runeVoicekeeper = { per, tribe, sold[] }`, ticked in
  `settleMinionSale` (the one sale chokepoint, board and hand). Its tally is `runeTally`'s `n/3`.
- **`equipmentSpellPowerAndStatSpell`** (Spell Generator). `spellBonus += +1/+1`, then `conjureToHand` one
  `isStatGrantingSpell` from `runSpells(state)` at or below the tavern tier.

## Judgement calls (flagged to the owner)

- **Echoing Shouts permanence** (owner confirmed 2026-10-07). Shop: Dragons on the board AND in hand, permanent (the `tribe` threshold target).
  Combat: the living board Dragons, **for that fight only**, the moment the Shout fires. That follows Rune of the
  Drake Skull and the Starsong, the two existing "whenever you trigger a Shout, buff X" runes, whose combat halves
  are combat-only.
- **Voicekeeper copy = PLAIN copy.** Base stats, never gilded, whatever the sold body carried. Precedent: the
  Voicekeeper minion ("Get a plain copy of the first Dragon you sell") and Rune of the Collector ("get a random
  copy of one" pays a plain copy). The printed text keeps the owner's wording "get a copy of one".
- **Spell Generator's pool** uses `isStatGrantingSpell` (the owner's 2026-09-23 "spell that gives stats" category,
  which excludes the shop-buff family) rather than the wider `isStatSpell`, and caps at the tavern tier like every
  other "random spell" grant. A full hand keeps the +1/+1 and loses the card.
- **Wise Armory set** (owner confirmed 2026-10-07): Set 2 only, not Set 3.

## Owner rulings on PR #1972 (2026-10-07)

- **Spell Generator costs 2 Gold** (was 3; owner: "change spell generator's cost to 2g"). The Rune of the Wise
  Armory itself stays at 3 Gold; its text now reads "Equip Spell Generator (2): ...".

- **Sets: confirmed.** All six runes are Set 2 only. The Wise Armory is NOT in Set 3. No change.
- **Echoing Shouts in combat: confirmed** "that fight only" (the Drake Skull / Starsong rule). Recorded in
  R-SHOUT-METER-PAYLOADS-01.
- **Equip animation: the full equip-unit animation on purchase.** The `runeEquip` reward now stamps the same
  `equip` cue a minion's equip stamps, gated by the same `equipIsNews` rule (a duplicate rune is silent). The cue
  carries `runeId` (and `uid: rune:<id>`, which names no body), and the UI's equip effect in `Recruit.tsx` starts
  the animation from THAT rune's badge in the rune rack (`runeNodeEl`, falling back to the rack) instead of a card.
  Motion, timing, the slot burst, the clang and the CSS ring are the minion's, unchanged; only the source anchor
  differs, and the react-layer uids stay empty because a rune has no body. Verified live on a throwaway Scene
  Builder run (port 5247): the source flash lands exactly on the Dragon's Egg rune badge and the second on the
  Equipment slot.

## Owner FX

The owner's FX Workbench export for the Spell Generator ships as `fx/defs/spell-generator-activate.json`
(smoke + two bursts, 600 ms, anchored `target`; every post-filter field filled with the Workbench defaults via
`coerceDef`, the owner's numbers verbatim). `SPELL_GENERATOR.useFxId` names it, so the slot plays it on every
activation (an untargeted Equipment's def plays on the slot). Budget: about 360 particles, no filters, under a
third of the heaviest shipped def (`blast-pump`, about 1,331), pinned in `fx/spellGeneratorFx.test.ts`.

## Test-pin moves

`RUNES.length` 187 → 188; Set 2 forge pools [130, 116] → [131, 121]; the Set 2 Dragon token list gains
`d2_firebird`; the set-2 strategy census moves `dragon` and `tempo` rune counts by one; Firebird joins
`ART_PENDING`; the board-fit "1 Pup" seed sweep widened 80 → 300 (the bigger pool reshuffled the seeded offers;
the first discounted Beast-only offer now lands at seed 208).

Tests: `packages/sim/src/dragonRunes1007.test.ts` (shop + combat for each rune, the persistence of rune
Equipment across turns, Spell Generator, determinism and JSON round-trip).
