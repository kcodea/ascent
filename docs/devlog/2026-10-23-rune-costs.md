# 2026-10-23 · Rune cost pass: Basic 3-5 and Epic 4-7 cost 1 less, 6+/8+ cost 2 less

Owner asks (2026-10-23, verbatim):

- "let's reduce the cost of all 3,4,5 cost basic runes by 1, and reduce the cost of all 4,5,6,7 cost epic runes by 1 across all sets"
- "if there are any 8+ reduce those by 2"
- "if there are any basic runes a 6+ gold, reduce their cost by 2"

Final rule: **Basic** 3/4/5 -> -1, 6+ -> -2, 1-2 unchanged. **Epic** 4/5/6/7 -> -1, 8+ -> -2, 1-3 unchanged.
Oracle: `R-RUNE-COSTS-1023-01` (`packages/content/src/runeCosts1023.test.ts`).

## How

- Decided per rune from the real `RUNES` / `EPIC_RUNES` / `ARCHIVED_RUNES` arrays loaded through tsx (Basic vs Epic
  by the `epic` flag; no pool/flag mismatches exist), then edited each rune's `cost:` literal in
  `packages/content/src/runes.ts` with an `// owner 2026-10-23 -N (was X)` note. Every cost is a plain literal: no
  computed, spread-shared or per-set cost overrides exist, so nothing needed special-casing.
- Archived runes were repriced too, so a rune costs the same wherever it resolves (stored runs, Scene Builder).
- Untouched mechanics that read the printed cost: the hero forge discount (`runeforgeDiscounts`, Basic 1-2 /
  Epic 2-4, clamped at 0 in `buyRune`) now makes more offers free (a 2 Gold Basic with a 2 discount, a 3 Gold Epic
  with a 3-4 discount); the duplicate sweetener pays `ceil(cost / 2)` of the new, lower cost.
- Stale doc costs fixed in `docs/GAME-RULES.md` (Epic Forge was printed as Basic 4, Ornate Clock as Basic 2; both
  were already lower on main) and two oracle statements (Goleming, Rosey's Garden).

## Counts

324 runes changed (36 of them archived; Top Hat was kept at 6 by owner follow-up):

| band | changed |
|---|---|
| Basic 3 -> 2 | 85 |
| Basic 4 -> 3 | 63 |
| Basic 5 -> 4 | 22 |
| Basic 6 -> 4 | 0 (Top Hat kept at 6 by owner follow-up) |
| Epic 4 -> 3 | 63 |
| Epic 5 -> 4 | 61 |
| Epic 6 -> 5 | 24 |
| Epic 7 -> 6 | 4 |
| Epic 8 -> 6 | 2 |

Content change: versus-resolve needs a redeploy after merge.

## Full table

| id | name | set(s) | epic | pool | old | new |
|---|---|---|---|---|---|---|
| rune_actioned_beasts | Actioned Beasts | set2 | no | basicPool | 3 | 2 |
| rune_afterglow | Afterglow | set4 | no | basicPool | 3 | 2 |
| rune_aftermarket | Aftermarket | set1/set2 | no | basicPool | 3 | 2 |
| rune_altar | Altar | set1/set2 | no | basicPool | 3 | 2 |
| rune_basic_beast | Basic Beasts | set2 | no | basicPool | 3 | 2 |
| rune_basic_celestial | Basic Celestials | set4 | no | basicPool | 3 | 2 |
| rune_basic_demon | Basic Demons | set2 | no | basicPool | 3 | 2 |
| rune_basic_dragon | Basic Dragons | set2 | no | basicPool | 3 | 2 |
| rune_basic_dwarf | Basic Dwarves | set2/set3 | no | basicPool | 3 | 2 |
| rune_basic_kobold | Basic Kobolds | set2/set3 | no | basicPool | 3 | 2 |
| rune_basic_spirit | Basic Spirits | set3 | no | basicPool | 3 | 2 |
| rune_basic_undead | Basic Undead | set3 | no | basicPool | 3 | 2 |
| rune_blood_and_coin | Blood and Coin | set1/set2 | no | basicPool | 3 | 2 |
| rune_body_counting | Body Counting | set3 | no | basicPool | 3 | 2 |
| rune_brood | Brood | set1/set2 | no | basicPool | 3 | 2 |
| rune_call_and_answer | Call and Answer | set3 | no | basicPool | 3 | 2 |
| rune_carrion_coin | Carrion Coin | all | no | basicPool | 3 | 2 |
| rune_catacomb | Catacomb | all | no | basicPool | 3 | 2 |
| rune_centerline | Centerline | all | no | archived | 3 | 2 |
| rune_choices | Choices | set3 | no | basicPool | 3 | 2 |
| rune_chorus | Chorus | all | no | basicPool | 3 | 2 |
| rune_chosen_vessel | Chosen Vessel | set3 | no | basicPool | 3 | 2 |
| rune_closing_time | Closing Time | set3 | no | basicPool | 3 | 2 |
| rune_combatative_rubies | Combatative Rubies | set3 | no | basicPool | 3 | 2 |
| rune_contraband | Contraband |  | no | archived | 3 | 2 |
| rune_deep_breaths | Deep Breaths | set3 | no | basicPool | 3 | 2 |
| rune_defiant_wings | Defiant Wings | set3 | no | basicPool | 3 | 2 |
| rune_drake_skull | Drake Skull | set1/set2 | no | basicPool | 3 | 2 |
| rune_echoing_kobolds | Echoing Kobolds | set3 | no | basicPool | 3 | 2 |
| rune_echoing_shouts | Echoing Shouts | set2 | no | basicPool | 3 | 2 |
| rune_efficient_tooling | Efficient Tooling | set3 | no | basicPool | 3 | 2 |
| rune_ember_inheritance | Ember Inheritance | set3 | no | basicPool | 3 | 2 |
| rune_emberline | Emberline | all | no | archived | 3 | 2 |
| rune_encore | Encore | set3 | no | basicPool | 3 | 2 |
| rune_engraving | Engraving | set2/set3 | no | basicPool | 3 | 2 |
| rune_epic_forge | Epic Forge | all | no | basicPool | 3 | 2 |
| rune_eventide | Eventide | set4 | no | basicPool | 3 | 2 |
| rune_evolution | Evolution | set1/set2 | no | basicPool | 3 | 2 |
| rune_festival_wages | Festival Wages | set3 | no | basicPool | 3 | 2 |
| rune_fresh_pages | Fresh Pages | all | no | basicPool | 3 | 2 |
| rune_gambling | Gambling | all | no | basicPool | 3 | 2 |
| rune_gem_crypt | Gem Crypt | set3 | no | basicPool | 3 | 2 |
| rune_gem_dividend | Gem Dividend |  | no | archived | 3 | 2 |
| rune_gemmed_decisions | Gemmed Decisions | set3 | no | basicPool | 3 | 2 |
| rune_golden_splinter | Golden Splinter | all | no | basicPool | 3 | 2 |
| rune_goleming | Goleming | set3 | no | basicPool | 3 | 2 |
| rune_grave_refreshment | Grave Refreshment | set1/set2 | no | basicPool | 3 | 2 |
| rune_gravedigger | Gravedigger | set3 | no | basicPool | 3 | 2 |
| rune_heralding_star | Heralding Star | set4 | no | basicPool | 3 | 2 |
| rune_infernal_ink | Infernal Ink | set1/set2 | no | basicPool | 3 | 2 |
| rune_kindred_hand | Kindred Hand | set3 | no | basicPool | 3 | 2 |
| rune_last_call_set3 | Last Call | set3 | no | basicPool | 3 | 2 |
| rune_loose_tongues | Loose Tongues | set3 | no | basicPool | 3 | 2 |
| rune_lorekeeping | Lorekeeping | all | no | basicPool | 3 | 2 |
| rune_merchants_chorus | Merchant's Chorus | all | no | basicPool | 3 | 2 |
| rune_open_enrollment | Open Enrollment | all | no | basicPool | 3 | 2 |
| rune_pair | Pair | set1/set2 | no | basicPool | 3 | 2 |
| rune_pendant | Pendant | set1/set2 | no | basicPool | 3 | 2 |
| rune_refraction | Refraction | set2/set3 | no | basicPool | 3 | 2 |
| rune_refrain | Refrain | set1/set2 | no | basicPool | 3 | 2 |
| rune_remains | Remains | all | no | archived | 3 | 2 |
| rune_ruby_resonance | Ruby Resonance |  | no | archived | 3 | 2 |
| rune_scattered_light | Scattered Light | set4 | no | basicPool | 3 | 2 |
| rune_scout | Scout | all | no | basicPool | 3 | 2 |
| rune_second_wind | Second Wind | set3 | no | basicPool | 3 | 2 |
| rune_shifting_facets | Shifting Facets |  | no | archived | 3 | 2 |
| rune_showcase | Showcase | all | no | basicPool | 3 | 2 |
| rune_slaying | Slaying | set1/set2 | no | basicPool | 3 | 2 |
| rune_small_fortune | Small Fortune | set1/set2 | no | basicPool | 3 | 2 |
| rune_soul_toll | Soul Toll | set3 | no | basicPool | 3 | 2 |
| rune_spell_fed_scales | Spell-Fed Scales | set3 | no | basicPool | 3 | 2 |
| rune_spell_tempering | Spell Tempering | set3 | no | basicPool | 3 | 2 |
| rune_spending | Spending | all | no | basicPool | 3 | 2 |
| rune_star_tap | Star Tap |  | no | basicPool | 3 | 2 |
| rune_stellar_echoes | Stellar Echoes | set4 | no | basicPool | 3 | 2 |
| rune_structure | Structure | set1 | no | basicPool | 3 | 2 |
| rune_sunpony | Sunpony | set2 | no | basicPool | 3 | 2 |
| rune_thrift | Thrift | set1/set2 | no | basicPool | 3 | 2 |
| rune_treasure_map | Treasure Map | set1/set2 | no | basicPool | 3 | 2 |
| rune_trophy | Trophy | set1/set2 | no | basicPool | 3 | 2 |
| rune_war_chorus | War Chorus | set1/set2 | no | basicPool | 3 | 2 |
| rune_warding | Warding | set1/set2 | no | basicPool | 3 | 2 |
| rune_whetstone | Whetstone | set3 | no | basicPool | 3 | 2 |
| rune_window_shopping | Window Shopping | set1/set2 | no | basicPool | 3 | 2 |
| rune_wrangler | Wrangler | set2 | no | archived | 3 | 2 |
| rune_aftershocks | Aftershocks | set1/set2 | no | basicPool | 4 | 3 |
| rune_amplification | Amplification | set3 | no | basicPool | 4 | 3 |
| rune_ancient_expenditure | Ancient Expenditure | set1/set2 | no | basicPool | 4 | 3 |
| rune_backbeat | Backbeat | all | no | basicPool | 4 | 3 |
| rune_baller | Baller | all | no | basicPool | 4 | 3 |
| rune_bartering | Bartering | all | no | basicPool | 4 | 3 |
| rune_brew | Brew | set2/set3 | no | basicPool | 4 | 3 |
| rune_cindergem | Cindergem | set2 | no | archived | 4 | 3 |
| rune_clockwork_promotion | Clockwork Promotion | set1/set2 | no | basicPool | 4 | 3 |
| rune_coffers | Coffers | all | no | basicPool | 4 | 3 |
| rune_compounding_wages | Compounding Wages | set2/set3 | no | basicPool | 4 | 3 |
| rune_consumption | Consumption | set1 | no | basicPool | 4 | 3 |
| rune_crowded_crypt | Crowded Crypt | set3 | no | basicPool | 4 | 3 |
| rune_deep_currents | Deep Currents | set3 | no | basicPool | 4 | 3 |
| rune_deep_feast | Deep Feast | all | no | basicPool | 4 | 3 |
| rune_display_case | Display Case | set2 | no | basicPool | 4 | 3 |
| rune_draconic_curiosity | Draconic Curiosity | set1/set2 | no | basicPool | 4 | 3 |
| rune_dragons_pantry | Dragon's Pantry | set1/set2 | no | basicPool | 4 | 3 |
| rune_duplication | Duplication | all | no | basicPool | 4 | 3 |
| rune_echoed_arrival | Echoed Arrival | all | no | basicPool | 4 | 3 |
| rune_facetwright | Facetwright | set2 | no | basicPool | 4 | 3 |
| rune_falling_embers | Falling Embers | set4 | no | basicPool | 4 | 3 |
| rune_first_light | First Light | set4 | no | basicPool | 4 | 3 |
| rune_five_banners | Five Banners | set1/set2/set3 | no | basicPool | 4 | 3 |
| rune_flagship | Flagship | set2/set3 | no | basicPool | 4 | 3 |
| rune_full_hand | Full Hand |  | no | archived | 4 | 3 |
| rune_full_measure | Full Measure | set2/set3 | no | basicPool | 4 | 3 |
| rune_gilded_ledger | Gilded Ledger | all | no | basicPool | 4 | 3 |
| rune_gravity | Gravity | set4 | no | basicPool | 4 | 3 |
| rune_growing_chorus | Growing Chorus | set3 | no | basicPool | 4 | 3 |
| rune_hatchery | Hatchery | set1/set2 | no | basicPool | 4 | 3 |
| rune_heavy_payroll | Heavy Payroll | set2/set3 | no | basicPool | 4 | 3 |
| rune_hoardcalling | Hoardcalling | set1/set2 | no | basicPool | 4 | 3 |
| rune_hunting_bell | Hunting Bell | set1/set2 | no | basicPool | 4 | 3 |
| rune_kegheart | Kegheart | set2/set3 | no | basicPool | 4 | 3 |
| rune_kindling | Kindling | all | no | basicPool | 4 | 3 |
| rune_lantern_keeper | Lantern Keeper | set3 | no | basicPool | 4 | 3 |
| rune_last_rites | Last Rites | set3 | no | basicPool | 4 | 3 |
| rune_living_magic | Living Magic | set1/set2 | no | basicPool | 4 | 3 |
| rune_muckbroker | Muckbroker | set1/set2 | no | basicPool | 4 | 3 |
| rune_night_market | Night Market | set1/set2 | no | basicPool | 4 | 3 |
| rune_overture | Overture | set3 | no | basicPool | 4 | 3 |
| rune_pallbearer | Pallbearer | set3 | no | basicPool | 4 | 3 |
| rune_quick_release | Quick Release |  | no | basicPool | 4 | 3 |
| rune_rallying | Rallying | all | no | basicPool | 4 | 3 |
| rune_rare_goods | Rare Goods | all | no | basicPool | 4 | 3 |
| rune_red_storm | Red Storm |  | no | archived | 4 | 3 |
| rune_returning_pack | Returning Pack | set1/set2 | no | basicPool | 4 | 3 |
| rune_rubywire | Rubywire |  | no | basicPool | 4 | 3 |
| rune_ruinous | Ruinous | set2 | no | basicPool | 4 | 3 |
| rune_runic_hoard | Runic Hoard | set1/set2 | no | basicPool | 4 | 3 |
| rune_seasoned_ledger | Seasoned Ledger | all | no | basicPool | 4 | 3 |
| rune_shared_spoils | Shared Spoils | set2 | no | basicPool | 4 | 3 |
| rune_spare_chair | Spare Chair | all | no | archived | 4 | 3 |
| rune_spellhide | Spellhide | all | no | archived | 4 | 3 |
| rune_spellmarket | Spellmarket | all | no | basicPool | 4 | 3 |
| rune_stampede | Stampede | all | no | basicPool | 4 | 3 |
| rune_tempering | Tempering | set1 | no | basicPool | 4 | 3 |
| rune_transcription | Transcription | all | no | basicPool | 4 | 3 |
| rune_traveling_festival | Traveling Festival | set3 | no | basicPool | 4 | 3 |
| rune_underdog | Underdog | set1/set2 | no | basicPool | 4 | 3 |
| rune_wake | Wake | set3 | no | basicPool | 4 | 3 |
| rune_wheel | Wheel | set1/set2 | no | basicPool | 4 | 3 |
| rune_accretion | Accretion | set4 | no | basicPool | 5 | 4 |
| rune_action | Action | all | no | basicPool | 5 | 4 |
| rune_badger | Badger | all | no | archived | 5 | 4 |
| rune_collector | Collector | all | no | basicPool | 5 | 4 |
| rune_first_round | First Round | set2/set3 | no | basicPool | 5 | 4 |
| rune_flooded_vault | Flooded Vault | set2 | no | archived | 5 | 4 |
| rune_gem_sage | Gem Sage | set2 | no | basicPool | 5 | 4 |
| rune_hunger | Hunger | set2 | no | basicPool | 5 | 4 |
| rune_menagerie | Menagerie | set1 | no | basicPool | 5 | 4 |
| rune_menagerie_set2 | Menagerie | set2 | no | basicPool | 5 | 4 |
| rune_menagerie_set3 | Menagerie | set3 | no | basicPool | 5 | 4 |
| rune_mountain_trade | Mountain Trade | set2 | no | basicPool | 5 | 4 |
| rune_open_appetite | Open Appetite | set2 | no | basicPool | 5 | 4 |
| rune_reinvestment | Reinvestment | set1/set2 | no | basicPool | 5 | 4 |
| rune_resonant_arms | Resonant Arms | set3 | no | basicPool | 5 | 4 |
| rune_scale | Bulk Order | all | no | basicPool | 5 | 4 |
| rune_shopkeep | Shopkeep | all | no | basicPool | 5 | 4 |
| rune_soul_script | Soul Script |  | no | basicPool | 5 | 4 |
| rune_spellslinging | Spellslinging | all | no | basicPool | 5 | 4 |
| rune_summit | Summit | set1/set2 | no | basicPool | 5 | 4 |
| rune_unbroken_vein | Unbroken Vein | set2 | no | basicPool | 5 | 4 |
| rune_warden | Warden | set1/set3 | no | basicPool | 5 | 4 |
| rune_top_hat | Top Hat | set1/set2 | no | basicPool | 6 | 6 (owner: "put top hat back to 6 cost") |
| rune_ancient_den | Ancient Den | set1/set2 | yes | epicPool | 4 | 3 |
| rune_astral_draft | Astral Draft |  | yes | epicPool | 4 | 3 |
| rune_attacking_gems | Attacking Gems | set2/set3 | yes | epicPool | 4 | 3 |
| rune_blart | Blart | set2 | yes | epicPool | 4 | 3 |
| rune_bucky | Bucky | set2/set3 | yes | epicPool | 4 | 3 |
| rune_choir | Choir | all | yes | epicPool | 4 | 3 |
| rune_conductor | Conductor | all | yes | epicPool | 4 | 3 |
| rune_conduit | Conduit | set2 | yes | epicPool | 4 | 3 |
| rune_copycat | Copycat | all | yes | epicPool | 4 | 3 |
| rune_crown | Crown | set1/set2 | yes | epicPool | 4 | 3 |
| rune_crucible | Crucible | all | yes | epicPool | 4 | 3 |
| rune_deathtouched_apple | Deathtouched Apple | all | yes | epicPool | 4 | 3 |
| rune_delayed_duplication | Delayed Duplication | set1/set2 | yes | epicPool | 4 | 3 |
| rune_dismantling | Dismantling | set3 | yes | epicPool | 4 | 3 |
| rune_dragon_breath | Dragon Breath | set2 | yes | epicPool | 4 | 3 |
| rune_dragonscale | Dragonscale | set1/set2 | yes | epicPool | 4 | 3 |
| rune_drakko | Drakko | set2/set3 | yes | epicPool | 4 | 3 |
| rune_dreamed_graves | Dreamed Graves | set3 | yes | epicPool | 4 | 3 |
| rune_embers | Embers | set1/set2 | yes | epicPool | 4 | 3 |
| rune_empty_hands | Empty Hands | set3 | yes | epicPool | 4 | 3 |
| rune_festival_circuit | Festival Circuit |  | yes | epicPool | 4 | 3 |
| rune_flaming_dragon | Flaming Dragon | set2 | yes | epicPool | 4 | 3 |
| rune_gem_golem | Gem Golem | set2/set3 | yes | epicPool | 4 | 3 |
| rune_gem_star | Gem Star |  | yes | epicPool | 4 | 3 |
| rune_gemscript | Gemscript |  | yes | archived | 4 | 3 |
| rune_gemspam | Gemspam | set2 | yes | epicPool | 4 | 3 |
| rune_grim_toast | Grim Toast | set3 | yes | epicPool | 4 | 3 |
| rune_guiding_candle | Guiding Candle | all | yes | epicPool | 4 | 3 |
| rune_high_king | High King | set2 | yes | epicPool | 4 | 3 |
| rune_inheritance | Inheritance | set1/set2 | yes | epicPool | 4 | 3 |
| rune_keepsake_gem | Keepsake Gem | set3 | yes | epicPool | 4 | 3 |
| rune_kobold_bebes | Kobold Bebes | set2 | yes | epicPool | 4 | 3 |
| rune_liquidation | Liquidation | set1/set2 | yes | epicPool | 4 | 3 |
| rune_living_treasure | Living Treasure | set2/set3 | yes | epicPool | 4 | 3 |
| rune_mammoth | Mammoth | set2 | yes | archived | 4 | 3 |
| rune_merry_christmas | Merry Christmas | all | yes | epicPool | 4 | 3 |
| rune_motherlode | Motherlode | set2/set3 | yes | epicPool | 4 | 3 |
| rune_muster_general | Muster General | all | yes | epicPool | 4 | 3 |
| rune_ninefold_commerce | Ninefold Commerce | all | yes | epicPool | 4 | 3 |
| rune_open_grave | Open Grave | set3 | yes | epicPool | 4 | 3 |
| rune_overflow | Overflow | all | yes | epicPool | 4 | 3 |
| rune_profit_sharing | Profit Sharing |  | yes | archived | 4 | 3 |
| rune_redirection | Redirection |  | yes | archived | 4 | 3 |
| rune_rising_echoes | Rising Echoes | all | yes | epicPool | 4 | 3 |
| rune_roseys_garden | Rosey's Garden | set3 | yes | epicPool | 4 | 3 |
| rune_runebound_brood | Runebound Brood | set3 | yes | epicPool | 4 | 3 |
| rune_runic_transposition | Runic Transposition | set3 | yes | epicPool | 4 | 3 |
| rune_satchel | Satchel | set3 | yes | epicPool | 4 | 3 |
| rune_second_life | Second Life | set2 | yes | archived | 4 | 3 |
| rune_second_path | Second Path | all | yes | epicPool | 4 | 3 |
| rune_secret_exchange | Secret Exchange | set3 | yes | epicPool | 4 | 3 |
| rune_spirit_crown | Spirit Crown | set3 | yes | epicPool | 4 | 3 |
| rune_starsong | Starsong | set4 | yes | epicPool | 4 | 3 |
| rune_stoked_menagerie | Stoked Menagerie | all | yes | epicPool | 4 | 3 |
| rune_storming_veins | Storming Veins |  | yes | archived | 4 | 3 |
| rune_tempered_time | Tempered Time | set1/set2 | yes | epicPool | 4 | 3 |
| rune_transfusion | Transfusion | set1 | yes | epicPool | 4 | 3 |
| rune_twilight | Twilight | all | yes | epicPool | 4 | 3 |
| rune_undertow | Undertow | set1/set2 | yes | epicPool | 4 | 3 |
| rune_voidmother | Voidmother | set2 | yes | epicPool | 4 | 3 |
| rune_white_wolf | White Wolf | set2 | yes | archived | 4 | 3 |
| rune_wyrms_hoard | Wyrm's Hoard | set3 | yes | epicPool | 4 | 3 |
| rune_yazzus | Yazzus | set2/set3 | yes | epicPool | 4 | 3 |
| rune_abomination | Abomination | all | yes | epicPool | 5 | 4 |
| rune_adventuring | Adventuring | all | yes | epicPool | 5 | 4 |
| rune_aggressive_golems | Aggressive Golems | set3 | yes | epicPool | 5 | 4 |
| rune_ancestral_roar | Ancestral Roar | set1/set2 | yes | epicPool | 5 | 4 |
| rune_anvil | Anvil | set3 | yes | epicPool | 5 | 4 |
| rune_ashen_heir | Ashen Heir | all | yes | archived | 5 | 4 |
| rune_astral_refrain | Astral Refrain | set3 | yes | epicPool | 5 | 4 |
| rune_banquet_hall | Banquet Hall | set1/set2 | yes | epicPool | 5 | 4 |
| rune_beastial_swarm | Beastial Swarm | set2 | yes | epicPool | 5 | 4 |
| rune_bequeathed_secrets | Bequeathed Secrets | set3 | yes | epicPool | 5 | 4 |
| rune_bottomless_cask | Bottomless Cask | set2 | yes | epicPool | 5 | 4 |
| rune_bottomless_portrait | Bottomless Portrait | set1/set2 | yes | epicPool | 5 | 4 |
| rune_broodmaster | Broodmaster | set2 | yes | archived | 5 | 4 |
| rune_cadence | Cadence | all | yes | epicPool | 5 | 4 |
| rune_chef | Chef |  | yes | archived | 5 | 4 |
| rune_chipper_sticker | Chipper Sticker | set2 | yes | epicPool | 5 | 4 |
| rune_combat_prowess | Combat Prowess | all | yes | epicPool | 5 | 4 |
| rune_counterpoint | Counterpoint | set1/set2 | yes | epicPool | 5 | 4 |
| rune_counterrotation | Counterrotation | set3 | yes | epicPool | 5 | 4 |
| rune_crucible_choir | Crucible Choir | set1/set2 | yes | epicPool | 5 | 4 |
| rune_dawnclaw | Dawnclaw | set2 | yes | epicPool | 5 | 4 |
| rune_deep | Deep | all | yes | epicPool | 5 | 4 |
| rune_deepening_vein | Deepening Vein | set2 | yes | epicPool | 5 | 4 |
| rune_dream_mirror | Dream Mirror | set3 | yes | epicPool | 5 | 4 |
| rune_endless_march | Endless March | set3 | yes | epicPool | 5 | 4 |
| rune_feast | Feast | set1 | yes | epicPool | 5 | 4 |
| rune_first_claws | First Claws | set1/set2 | yes | epicPool | 5 | 4 |
| rune_food_chain | Food Chain | set1/set2 | yes | epicPool | 5 | 4 |
| rune_grave_orbit | Grave Orbit |  | yes | archived | 5 | 4 |
| rune_growing_inferno | Growing Inferno | set3 | yes | epicPool | 5 | 4 |
| rune_guiding_star | Guiding Star | set4 | yes | epicPool | 5 | 4 |
| rune_handy_flame | Handy Flame | set3 | yes | epicPool | 5 | 4 |
| rune_herald | Herald | all | yes | epicPool | 5 | 4 |
| rune_herzog | Vaultkeeper | set2 | yes | epicPool | 5 | 4 |
| rune_investment | Investment | set2/set3 | yes | epicPool | 5 | 4 |
| rune_last_tool | Last Tool | set3 | yes | epicPool | 5 | 4 |
| rune_lasting_cadence | Lasting Cadence | all | yes | epicPool | 5 | 4 |
| rune_lasting_words | Lasting Words | set3 | yes | epicPool | 5 | 4 |
| rune_living_echoes | Living Echoes | set2 | yes | epicPool | 5 | 4 |
| rune_matriarch | Matriarch | set2 | yes | archived | 5 | 4 |
| rune_meteor_storm | Meteor Storm | set4 | yes | epicPool | 5 | 4 |
| rune_mirror_march | Mirror March | set1/set2 | yes | epicPool | 5 | 4 |
| rune_moonhowl | Moonhowl | set2 | yes | archived | 5 | 4 |
| rune_open_hand | Open Hand | set3 | yes | epicPool | 5 | 4 |
| rune_opened_vault | Opened Vault | set3 | yes | epicPool | 5 | 4 |
| rune_overcharge | Overcharge | set3 | yes | epicPool | 5 | 4 |
| rune_red_giant | Red Giant | set4 | yes | epicPool | 5 | 4 |
| rune_restless | Restless | set3 | yes | epicPool | 5 | 4 |
| rune_ruby_shrapnel | Ruby Shrapnel |  | yes | archived | 5 | 4 |
| rune_savagery | Savagery | set1/set2 | yes | epicPool | 5 | 4 |
| rune_shared_revelry | Shared Revelry | set3 | yes | epicPool | 5 | 4 |
| rune_sold_choices | Sold Choices | set3 | yes | epicPool | 5 | 4 |
| rune_soul_furnace | Soul Furnace | set3 | yes | epicPool | 5 | 4 |
| rune_sylus | Sylus | set1/set2 | yes | epicPool | 5 | 4 |
| rune_twin_tongues | Twin Tongues | set3 | yes | epicPool | 5 | 4 |
| rune_unbroken_scales | Unbroken Scales | set3 | yes | epicPool | 5 | 4 |
| rune_waking_dreams | Waking Dreams | set3 | yes | epicPool | 5 | 4 |
| rune_war_council | War Council | set3 | yes | epicPool | 5 | 4 |
| rune_warpath | Warpath | all | yes | archived | 5 | 4 |
| rune_wild_memory | Wild Memory | all | yes | archived | 5 | 4 |
| rune_wildscript | Wildscript | all | yes | archived | 5 | 4 |
| rune_assembly | Assembly | set1 | yes | epicPool | 6 | 5 |
| rune_baal | Baal | set2 | yes | epicPool | 6 | 5 |
| rune_bargain_bin | Bargain Bin | all | yes | epicPool | 6 | 5 |
| rune_battle_refraction | Battle Refraction | set2 | yes | archived | 6 | 5 |
| rune_blasting_voices | Blasting Voices |  | yes | archived | 6 | 5 |
| rune_double_fisting | Double Fisting | set2/set3 | yes | epicPool | 6 | 5 |
| rune_final_gate | Final Gate | set3 | yes | epicPool | 6 | 5 |
| rune_finality | Finality | set1/set2 | yes | epicPool | 6 | 5 |
| rune_grand_procession | Second Showing | set3 | yes | epicPool | 6 | 5 |
| rune_grand_workshop | Grand Workshop | set3 | yes | epicPool | 6 | 5 |
| rune_groveweaver | Groveweaver | all | yes | archived | 6 | 5 |
| rune_might | Might | all | yes | epicPool | 6 | 5 |
| rune_old_pack | Old Pack | all | yes | archived | 6 | 5 |
| rune_open_constellation | Open Constellation | set4 | yes | epicPool | 6 | 5 |
| rune_reconfiguration | Reconfiguration | set1 | yes | epicPool | 6 | 5 |
| rune_ruins | Ruins | set2 | yes | epicPool | 6 | 5 |
| rune_ruptured_rubies | Ruptured Rubies | set3 | yes | epicPool | 6 | 5 |
| rune_shared_scripture | Shared Scripture | set1/set2 | yes | epicPool | 6 | 5 |
| rune_spearline | Spearline | set1/set3 | yes | epicPool | 6 | 5 |
| rune_stolen_constellations | Stolen Constellations | set4 | yes | epicPool | 6 | 5 |
| rune_supernova | Supernova | set4 | yes | epicPool | 6 | 5 |
| rune_unity | Unity | set3 | yes | epicPool | 6 | 5 |
| rune_waking_reserve | Waking Reserve | set3 | yes | epicPool | 6 | 5 |
| rune_zoo | Zoo | set2 | yes | epicPool | 6 | 5 |
| rune_banking | Banking | set1 | yes | epicPool | 7 | 6 |
| rune_den_mother | Den Mother | set1 | yes | epicPool | 7 | 6 |
| rune_mastery | Mastery | set1 | yes | epicPool | 7 | 6 |
| rune_twin_gilding | Twin Gilding | all | yes | epicPool | 7 | 6 |
| rune_endless_appetite | Endless Appetite | set1 | yes | epicPool | 8 | 6 |
| rune_frontline_glory | Frontline Glory | set1 | yes | epicPool | 8 | 6 |
