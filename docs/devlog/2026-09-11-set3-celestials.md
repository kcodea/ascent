# 2026-09-11 — Set 3 Celestials: the reworked roster (eight spell-tribe minions) + Yazzus to T7

**Owner sheet (2026-09-11):** eight Celestial minions, plus "move yazzus to t7 in set 3, as he is in set 2".

## The roster

`packages/content/src/cards/set3/celestials.ts` (ids `ce3_*`), appended to `SETS.set3.own` after the Spirits rather
than spread through `SET3_CARDS` (which opens the manifest, so a prepend would have reseeded every set-3 shop).
The Orbit / Alignment roster of 2026-08-05 stays archived (`c3_*`); the two names it shared with the new sheet
(Horizon Courier, Starpath Vendor) got an "(Orbit)" suffix on the archived defs so no two cards share a name.

| Card | Primitive | New? |
|---|---|---|
| Horizon Courier — Echo: random Shop spell | `deathrattleGrantRandomSpell` | existing (first live user in a while; policy entry added) |
| Starpath Vendor — next Shop spell +2/+2 | `battlecryBuffNextSpell` → `RunState.nextSpellBonus` | **new** |
| Gravestar Seer — +4 Attack per spell of any kind | `spellCastBuffSelf` + `includeRubies` | existing (dormant primitive, now used) |
| Comet Conductor — Rally: copy of the turn's first spell, once per combat | `rallyGrantFirstSpellCopy` (combat) + `CombatSideState.firstSpellThisTurnId` | **new** |
| Falling Star Herald — Shout and Echo: a Star Crash | `battlecryGrantSpell` + `deathrattleGrantSpell` | existing (two entries) |
| Crashborn Adept — first Star Crash on it each turn also casts on 2 other Celestials | `onSpellCastOnThisSpreadTribeNamed` | **new** |
| Astral Spellcore — every 3 Shop spells cast while on the board: Celestials +6/+6 | `spellCastEveryNBuffTribe` (per-copy `spellProgress` meter, Avenge-style step counter) | **new** |
| Orrery Artificer — Equip Comet (4): next spell casts 2 additional times | Equipment `comet` → `equipmentExtraNextSpellCasts` | **new** (rides Nimbus' `nextSpellExtraCasts`) |

## Rulings applied (flag if wrong)

- **"A spell" = any spell** for the Seer (Rubies and Gifts count), per the Stellar Chorus ruling of 2026-09-10.
  "Shop spell" (Vendor, Spellcore) stays Shop spells only: a Gift neither reads nor spends the Vendor's bonus
  (`castSpell` lifts it out for a Gift's cast), a Ruby reads spell power without it (`rubyStatBonus`), and a Ruby
  under Rune of the Spellstone counts for the Spellcore because it is booked as a Shop spell.
- **"Cast it on 2 other friendly Celestials" is the "also casts on" family** (Mirrorwing / Reflector / Runefire):
  a FULL cast per target, scaled by the cast multiplier, so a Yazzus doubles the spreads too. The per-turn gate
  is its own latch (`namedSpreadUsedThisTurn`), keyed to the NAMED spell, not to the spells-on-this counter.
- **Once per combat** on the Conductor is a per-instance latch: Rallying Offensive's double fire pays once.
- **Astral Spellcore (owner correction, same day):** it first shipped as "the third Shop spell each turn" read off
  the run's `spellsThisTurn`, which counted casts made while the card sat in hand. Now it is a per-copy meter that
  only ticks on the board (the `spellCast` watchers fire for board cards only), fires on every third (repeatable,
  carries across turns), prints "When you cast **3** Shop spells, give your Celestials **+6/+6**.", and shows its
  progress through the shared step counter (`stepProgress`, keyed on the effect shape) — not in the text.
- **Golden lines:** Courier 2 spells; Vendor +4/+4; Seer +8; Conductor 2 copies; Herald 2 Star Crashes; Adept 4
  others; Spellcore +12/+12; Comet 4 additional casts (gilded Artificer).
- **Yazzus:** the set-3 fork `n3_yazzus` moves T6 → T7; stats (4/8) and text untouched (the game is the truth).
  T7 is reachable only on the Summit rift or through `tier7Access`, like the set-2 Yazzus.

## Registries moved

Celestial tribe UN-PARKED in `@game/rules/parked` (Orbit stays parked); Doc Bot lanes: self-exclusion
declaration for the Adept, phase excuses for the Vendor (combat) and Conductor (recruit), R-TURN-01 entry for the
Conductor, policy entries for the two revived primitives, Forsaken-Mage opt-in list, unresolved-parse cap
577 → 582, snapshot fidelity for the new per-turn latch, contracts regenerated. Art owed for all eight
(`ART_PENDING`).

Tests: `packages/sim/src/set3Celestials.test.ts` (23), `packages/ui/src/cardText.test.ts` (Spellcore step counter).
