# 2026-09-25: the Set 3 rune list, plus Rune of Action / Bulk Order / Bargain Bin reworks

Owner ask 2026-09-25: set Set 3's rune list EXACTLY to the owner's list, and rework three runes.

## Part A: three rune changes

- **Rune of Action** (`rune_action`, Basic): *"End of Turn: Give 3 random minions +2/+2. Repeat for every card played
  this turn."* Built as the REPEAT form (R-REPEAT-01, like Kringle and Striker): the base tick once, then one more per
  card played, 1 + count ticks, each its own state delta, ROOT trigger and beat. "Random minions" = **friendly**
  minions (the old rune buffed your own three left-most). Each tick picks 3 distinct friendly minions, re-rolled per
  tick off the run cursor; with fewer than 3 on board every one gets the tick. The commit (`applyEndOfTurn`), the
  projection (`projectEndOfTurnSteps`) and the legacy beat list (`questEndOfTurnBeats`) all read one new count,
  `recurringTickCount`, so they agree 1:1. The badge tally is now `×N` (the live tick count), was `N cards`.
- **Rune of Bulk Order** (`rune_scale`, Basic): *"When you spend 10 gold, give 4 friendly minions +4/+4."* Data only:
  `runeScale` count 4, +4/+4, per 10 (was 3, +3/+3, per 5). The existing meter already banks the remainder across
  spends and turns and picks all minions when fewer than the count. The badge reads `x/10g`.
- **Rune of the Bargain Bin** (`rune_bargain_bin`, Epic): *"the refresh should only include SHOUT minions. edit the
  description to match"*. The binned refresh now draws only Shout (Battlecry) minions from the run's pool at the
  Tavern tier or below (`bargainBinPool` in `reducer.ts`). Text: "fills the Shop with **Shout** minions that cost 1
  Gold". **Fallback chosen:** when no Shout minion is reachable, the refresh stays an ordinary one and the rune's use
  for the turn is NOT spent (a later refresh can still bin). In practice every set fields Shout minions from tier 1,
  so this only guards an empty draw.

Oracle: R-RUNE-19 / 20 / 21 in `packages/rules/src/registry/approved/runes.ts`. Tests:
`packages/sim/src/runeReworks0925.test.ts` (commit, projection, beat list, replay path, fewer-than-N boards, the Gold
meter across a turn boundary, both Set 2 and Set 3 bins, the fallback), plus updated pins in `runes.test.ts`,
`socEotTendrils.test.ts` (9 ribbons for 3 ticks x 3 picks) and `tallyCoverage.test.ts`.

## Part B: the Set 3 rune list

Every rune named is in Set 3; every rune not named left Set 3 only. All edits are `sets` edits in
`packages/content/src/runes.ts`: `['set2', 'set3']` became `['set2']`, `['set1', 'set3']` became `['set1']`, an
unscoped rune became `['set1', 'set2']`, and a `['set3']`-only rune became `[]`. No rune was archived, and no rarity
or tribe gate was changed. The exact ids are pinned by `packages/sim/src/set3RuneList.test.ts` (static pool AND the
live Basic + Epic forge with every Set 3 tribe rolled both equal the list).

### Name matching

Every name matched exactly one live rune. The non-obvious ones:

- "bulk order" is Rune of Bulk Order, id `rune_scale`.
- "dwarf king brill" is Rune of the High King (`rune_high_king`), which gets a Dwarf King, Brill.
- "spear warden" is Rune of the Warden (`rune_warden`), which gets a Spear Warden. (Spearline and the Endless March
  also summon Spear Wardens, but both are named separately.)
- "reflector" is Rune of Refraction (`rune_refraction`), which gets a Reflector.
- "death touched apple" is Rune of the Deathtouched Apple; "basic/epic <tribe>" are the tribe faucets
  (`rune_basic_kobold`, `rune_epic_dwarf`, ...); "chorus" is Rune of the Chorus (`rune_chorus`), distinct from the
  Growing Chorus and the Merchant's Chorus, which are both also named; "crucible" is Rune of the Crucible
  (`rune_crucible`), not the Crucible Choir; "muster" is Rune of the Muster, not the Muster General (also named).

**Unmatched names: none. Archived runes named: none.**

### ADDED to Set 3

**None.** Every rune on the list was already offered in Set 3.

### REMOVED from Set 3 (64: 36 Basic, 28 Epic)


**Basic (36)**
| Rune | id | Tribe gate | Was | Now |
|---|---|---|---|---|
| Rune of Warding | `rune_warding` | none | every set | set1, set2 |
| Rune of Slaying | `rune_slaying` | none | every set | set1, set2 |
| Rune of Infernal Ink | `rune_infernal_ink` | none | every set | set1, set2 |
| Rune of the Hatchery | `rune_hatchery` | none | every set | set1, set2 |
| Rune of Blood and Coin | `rune_blood_and_coin` | none | every set | set1, set2 |
| Rune of Reinvestment | `rune_reinvestment` | none | every set | set1, set2 |
| Rune of the War Chorus | `rune_war_chorus` | none | every set | set1, set2 |
| Rune of Small Fortune | `rune_small_fortune` | none | every set | set1, set2 |
| Rune of the Summit | `rune_summit` | none | every set | set1, set2 |
| Rune of Packcraft | `rune_packcraft` | none | every set | set1, set2 |
| Rune of Rebirth | `rune_rebirth` | none | every set | set1, set2 |
| Rune of the Trophy | `rune_trophy` | none | every set | set1, set2 |
| Rune of the Vault | `rune_vault` | none | every set | set1, set2 |
| Rune of the Altar | `rune_altar` | none | every set | set1, set2 |
| Rune of Thrift | `rune_thrift` | none | every set | set1, set2 |
| Rune of the Wheel | `rune_wheel` | none | every set | set1, set2 |
| Rune of the Underdog | `rune_underdog` | none | every set | set1, set2 |
| Rune of the Top Hat | `rune_top_hat` | none | every set | set1, set2 |
| Rune of Evolution | `rune_evolution` | none | every set | set1, set2 |
| Rune of the Treasure Map | `rune_treasure_map` | none | every set | set1, set2 |
| Rune of the Empty Plate | `rune_empty_plate` | none | every set | set1, set2 |
| Rune of the Gem Dividend | `rune_gem_dividend` | kobold | set2, set3 | set2 |
| Rune of the Five Banners | `rune_five_banners` | none | every set | set1, set2 |
| Rune of the Aftermarket | `rune_aftermarket` | none | every set | set1, set2 |
| Rune of Mountain Trade | `rune_mountain_trade` | kobold | set2, set3 | set2 |
| Rune of the Strange Caravan | `rune_strange_caravan` | none | every set | set1, set2 |
| Rune of Restocking | `rune_restocking` | none | every set | set1, set2 |
| Rune of Trade-In | `rune_trade_in` | none | every set | set1, set2 |
| Rune of Window Shopping | `rune_window_shopping` | none | every set | set1, set2 |
| Rune of Ruby Resonance | `rune_ruby_resonance` | kobold | set2, set3 | set2 |
| Rune of Hoardflame | `rune_hoardflame` | none | every set | set1, set2 |
| Rune of the Pendant | `rune_pendant` | none | every set | set1, set2 |
| Rune of the Wishbone | `rune_wishbone` | none | every set | set1, set2 |
| Rune of the Gem Sage | `rune_gem_sage` | kobold | set2, set3 | set2 |
| Rune of Shared Spoils | `rune_shared_spoils` | dwarf | set2, set3 | set2 |
| Rune of Charted Skies | `rune_charted_skies` | none | set3 | none |

**Epic (28)**
| Rune | id | Tribe gate | Was | Now |
|---|---|---|---|---|
| Rune of the Reliquary | `rune_reliquary` | none | every set | set1, set2 |
| Rune of Appraisal | `rune_appraisal` | none | every set | set1, set2 |
| Rune of Gemscript | `rune_gemscript` | kobold | set2, set3 | set2 |
| Rune of Inheritance | `rune_inheritance` | none | every set | set1, set2 |
| Rune of the Gilded Spark | `rune_gilded_spark` | none | every set | set1, set2 |
| Rune of the Mirror March | `rune_mirror_march` | none | every set | set1, set2 |
| Rune of the Undertow | `rune_undertow` | none | every set | set1, set2 |
| Rune of Mastery | `rune_mastery` | none | set1, set3 | set1 |
| Rune of Liquidation | `rune_liquidation` | none | every set | set1, set2 |
| Rune of Gemspam | `rune_gemspam` | kobold | set2, set3 | set2 |
| Rune of the Bottomless Cask | `rune_bottomless_cask` | dwarf | set2, set3 | set2 |
| Rune of the Vanguard | `rune_vanguard` | none | every set | set1, set2 |
| Rune of Gemstorm | `rune_gemstorm` | kobold | set2, set3 | set2 |
| Rune of the Spellstone | `rune_spellstone` | kobold | set2, set3 | set2 |
| Rune of Counterpoint | `rune_counterpoint` | none | every set | set1, set2 |
| Rune of the Crown | `rune_crown` | none | every set | set1, set2 |
| Rune of the Embers | `rune_embers` | none | every set | set1, set2 |
| Rune of Tempered Time | `rune_tempered_time` | none | every set | set1, set2 |
| Rune of the Conduit | `rune_conduit` | kobold | set2, set3 | set2 |
| Rune of Shared Scripture | `rune_shared_scripture` | none | every set | set1, set2 |
| Rune of the Banquet Hall | `rune_banquet_hall` | none | every set | set1, set2 |
| Rune of the Crucible Choir | `rune_crucible_choir` | none | every set | set1, set2 |
| Rune of Kobold Bebes | `rune_kobold_bebes` | kobold | set2, set3 | set2 |
| Rune of Blasting Voices | `rune_blasting_voices` | none | every set | set1, set2 |
| Rune of Borrowed Echoes | `rune_borrowed_echoes` | none | every set | set1, set2 |
| Rune of the Deepening Vein | `rune_deepening_vein` | kobold | set2, set3 | set2 |
| Rune of the Festival Circuit | `rune_festival_circuit` | spirit, celestial | set3 | none |
| Rune of the Open Constellation | `rune_open_constellation` | celestial | set3 | none |

**Three runes are now offered in NO set:** Charted Skies, the Festival Circuit and the Open Constellation were
Set-3-only, so leaving Set 3 leaves them `sets: []`. They are not archived (still resolve by id). Owner call: archive
them, or give them another set.

## Mismatch report (the game was NOT changed; owner decides)

**Rarity** (listed under Basic but Epic in the game, or the reverse):

- **Engraving Gems** (`rune_engraving_gems`): listed Kobold **Basic**, is **Epic** in the game.
- No Epic-listed rune is Basic in the game.

**Tribe** (listed under a tribe but not gated that way, or gated to another tribe):

- **Seller's Market** (`rune_sellers_market`): listed Dwarf Epic, is **untribed**.
- **Spearline** (`rune_spearline`): listed Undead Epic, is **untribed**.
- **Dream Mirror** (`rune_dream_mirror`): listed Spirit Epic, is **untribed**.
- **Open Hand** (`rune_open_hand`): listed Spirit Epic, is **untribed**.
- **Waking Reserve** (`rune_waking_reserve`): listed Spirit Epic, is **untribed**.
- **Waking Dreams** (`rune_waking_dreams`): listed Spirit Epic, is **untribed**.
- **Lazarus** (`rune_lazarus`): listed Neutral Epic, is gated **Undead**.
- **Soul Script** (`rune_soul_script`): listed Undead Basic, is gated **Undead + Celestial** (listed under one of its
  two tribes only).

Untribed means the forge offers it whatever tribes rolled; a tribe gate means it is offered only when that tribe rolled.

## New Set 3 counts

163 runes: **83 Basic / 80 Epic** (was 119 / 108). By the game's tribe gate (Soul Script counts for both of its
tribes, so the rows sum to 84 Basic):

| | Basic | Epic |
|---|---|---|
| Untribed | 55 | 51 |
| Kobold | 4 | 6 |
| Dwarf | 9 | 7 |
| Undead | 4 | 5 |
| Spirit | 6 | 5 |
| Celestial | 6 | 6 |

By the owner's grouping: Kobold 5 / 5, Dwarf 9 / 8, Undead 4 / 5, Spirit 6 / 9, Celestial 5 / 6, Neutral 55 / 46.

## Judgement calls for the owner

- "Random minions" on Rune of Action = friendly minions.
- The Bargain Bin fallback above (ordinary refresh, use not spent).
- Pre-existing, not changed: Rune of Bulk Order does not bank Gold spent while your board is empty (the meter only
  runs with at least one minion on board).
- Archived runes were left as they are. A few archived defs still carry `set3` in their data (e.g. the Open Market),
  but archived runes are never offered, so the Set 3 pool is exactly the list.

## Tests and tooling

- New: `set3RuneList.test.ts`, `runeReworks0925.test.ts`.
- Updated count / scope pins: `set3RuneCuts.test.ts` (83 / 80), `set3RuneRoster.test.ts` (64 + 19 Basic / 53 + 27
  Epic; Gem Golem and Attacking Gems replace the cut Gemscript and Spellstone in the forge check), and the per-batch
  `sets` pins in `epicRuneBatchAug07`, `runeBatch10`, `runeBatch3Aug07`, `runeBatch4T1`, `runeBatch4T4`,
  `runeBatch6`, `runeBatch7`, `runeBatch8`, `runeBatchAug07`, `runeCardKeyed`, `set2Dwarves`,
  `set3RunesTrancheA`, `set3RunesTrancheB`.
- Regenerated: `npm run contracts:extract` and `npm run docbot:text`.
- `docs/GAME-RULES.md` rune scoping section, Balance patch note.
