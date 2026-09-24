# 2026-09-24: Set 3 rune cuts

Owner ask 2026-09-24: cut runes from Set 3. The owner named 20 runes, plus *"any runes that are labeled tribes that
are not in set 3. this should be dragon, imps, demons, beasts, and mech related runes."*

## How

Runes are set-scoped by the `RuneDef.sets` field (absent = every set). The Runeforge (`runeforgePool` in
`packages/sim/src/reducer.ts`) filters on the run's PINNED `setIdOf(s)`, then on the rolled-tribe gate. Every cut is
a `sets` edit in `packages/content/src/runes.ts` and nothing else:

- a rune scoped `['set2', 'set3']` became `['set2']`, and `['set1', 'set3']` became `['set1']`;
- an unscoped rune (every set) became `['set1', 'set2']`;
- a rune scoped `['set3']` alone became `[]`, which means offered in no set.

No rune was archived. Every cut rune stays in `RUNES` / `EPIC_RUNES` and resolves through `RUNE_INDEX`, so an
in-flight or replayed Set 3 run that already owns one keeps working (its reward, badge and tallies read the def by
id). Set 3 is still `enabled: false`, so no live run changes today.

The tribe rule used `SETS.set3.tribes` = kobold, dwarf, undead, spirit, celestial. The 34 tribal runes were already
unreachable in a Set 3 run through the tribe gate (a Set 3 run can only roll Set 3 tribes); the scope now says so in
the data too.

## Cut list (name → id)

**Kobold (named, 8):** Contraband `rune_contraband`, Facetwright `rune_facetwright`, Gemcutting `rune_gemcutting`,
the Lapidary `rune_lapidary` (Epic), Redirection `rune_redirection` (Epic), Ruby Shrapnel `rune_ruby_shrapnel` (Epic),
the Unbroken Vein `rune_unbroken_vein`, Shifting Facets `rune_shifting_facets`. All now `['set2']`.

**Dwarf (named, 6):** Last Call `rune_last_call`, Shared Pour `rune_shared_pour`, Baal `rune_baal` (Epic),
the Chef `rune_chef` (Epic), Mykel `rune_brisbane` (Epic), Runic Exchange `rune_runic_exchange` (Epic). All now `['set2']`.

**Undead (named, 4):** Pillaging `rune_pillaging` → `['set1', 'set2']`, Rising Graves `rune_rising_graves` (Epic) →
`['set1']`, Soul Taxes `rune_soul_taxes` (Epic) → `['set1', 'set2']`, the Grave Orbit `rune_grave_orbit` (Epic) → `[]`.

**Spirit (named, 1):** the Full Hand `rune_full_hand` → `[]`.

**Other (named, 1):** Aftershocks `rune_aftershocks` → `['set1', 'set2']`.

**Tribe not in Set 3 (34, all were unscoped, all now `['set1', 'set2']`):**

- Dragon (14): Hoardcalling `rune_hoardcalling`, the Last Word `rune_last_word`, the Runic Hoard `rune_runic_hoard`,
  the Glider `rune_glider`, the Drake Skull `rune_drake_skull`, Draconic Curiosity `rune_draconic_curiosity`, the
  Dragon's Pantry `rune_dragons_pantry`; Epic: Stormcalling `rune_stormcalling`, Scales `rune_scales`, Chimerus
  `rune_chimerus`, Dragonscale `rune_dragonscale`, the Foundry `rune_foundry`, Ancestral Roar `rune_ancestral_roar`,
  Ascension `rune_ascension`.
- Demon / Imp (10): Summoning `rune_summoning`, the Brood `rune_brood`, Ashen Payroll `rune_ashen_payroll`, the
  Night Market `rune_night_market`; Epic: the Broodpit `rune_broodpit`, Finality `rune_finality`, the Cinder Ledger
  `rune_cinder_ledger`, the Food Chain `rune_food_chain`, Refreshments `rune_refreshments`, the Bottomless Portrait
  `rune_bottomless_portrait`.
- Beast (8): the Burrow `rune_burrow`, the Muckbroker `rune_muckbroker`, the Returning Pack `rune_returning_pack`;
  Epic: First Claws `rune_first_claws`, the Wild Hunt `rune_wild_hunt`, Savagery `rune_savagery`, the Ancient Den
  `rune_ancient_den`, Delayed Duplication `rune_delayed_duplication`.
- Mech (2): Ancient Expenditure `rune_ancient_expenditure`, Clockwork Promotion `rune_clockwork_promotion`.

14 Dragon + 10 Demon + 8 Beast + 2 Mech = 34. Totals: 26 Basic + 28 Epic = 54 runes.

## Judgement calls for the owner

- **Every name matched exactly one rune.** "mykel" is Rune of Mykel, whose id is `rune_brisbane`.
- **The Grave Orbit and the Full Hand were Set-3-only.** Cutting them from Set 3 leaves them offered in no set
  (`sets: []`). They are not archived and still resolve. Say the word if they should be archived instead, or moved
  to another set.
- **No multi-tribe rune straddled the line.** No rune still in Set 3 had a tribe gate mixing a Set 3 tribe with a
  non-Set-3 tribe. The multi-tribe runes in Set 3 (Soul Script: Undead + Celestial; the Festival Circuit: Spirit +
  Celestial) are all-Set-3 and stay.
- **No untagged rune names an off-set tribe.** A text sweep of the remaining unscoped / Set 3 runes for
  Dragon/Beast/Demon/Imp/Mech/Attachment/Fodder found nothing, so "untribed runes stay" cost nothing.
- **Not changed: `grantRune`** (the Spare Forge / Runic Passage hero-quest reward, `reducer.ts`) hands out a random
  rune of a rarity without reading `sets` or `tribes` at all. That is pre-existing and affects every set, not just
  these cuts; fixing it would shift the RNG draw for replays, so it is left for its own ruling.

## Remaining Set 3 static rune pool

The static pool is `sets` absent or including set3. A multi-tribe rune counts once per tribe.

| | Basic | Epic |
|---|---|---|
| Total | 120 (was 146) | 107 (was 135) |
| Untribed | 86 | 69 |
| Kobold | 9 | 12 |
| Dwarf | 10 | 8 |
| Undead | 4 | 5 |
| Spirit | 6 | 6 |
| Celestial | 6 | 8 |

Before the cut the static pool also carried 34 Dragon/Beast/Demon/Mech runes the tribe gate already hid; excluding
those, the reachable pool went from 109 + 21 Basic / 87 + 30 Epic to 100 + 20 / 78 + 29 (carryovers + Set 3
originals), as pinned in `set3RuneRoster.test.ts`.

## Tests and tooling

- New: `packages/sim/src/set3RuneCuts.test.ts`. No cut rune is scoped to set 3 or offered at a Set 3 forge (even
  with every tribe rolled), each is still offered in its other sets where its tribe rolls, every cut still resolves,
  and the 120 / 107 counts.
- Updated pins in 18 existing rune spec tests that asserted the old `sets` values.
- `contractExtract.ts` now emits `setIds: []` for a `sets: []` rune instead of dropping the field (which read as
  unscoped). `npm run contracts:extract` regenerated `extracted.generated.ts`.
- `docs/GAME-RULES.md` rune scoping section updated. Balance patch note added.
