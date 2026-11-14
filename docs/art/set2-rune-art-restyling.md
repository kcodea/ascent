# Set 2 Rune Art Restyling

Owner ask 2026-11-14: Mike is restyling the rune art listed below. The art is already in the repo, so there is
nothing to download. These are the in-game WebPs.

## For Mike's Claude: fetch the art

Copy every rune below from the game files into a local folder named **`Set 2 Rune Art Restyling`**. Put it outside
the repo, or anywhere git ignores, and **never commit that folder**. Run from the repo root:

```bash
mkdir -p "../Set 2 Rune Art Restyling"
grep -oE '`rune_[a-z0-9_]+`' "docs/art/set2-rune-art-restyling.md" | tr -d '`' | sort -u | while read id; do
  cp "packages/ui/src/art/runes/$id.webp" "../Set 2 Rune Art Restyling/$id.webp"
done
ls "../Set 2 Rune Art Restyling" | wc -l   # expect 112
```

Each file is named by its rune id, the same key the game uses, so a restyled piece maps straight back.

## Wiring a restyled piece back in

1. Save the new art as `packages/ui/src/art/runes/<rune id>.png`. Keep the id as the name and keep it square.
2. Run `npm run optimize-art`. It converts the PNG to WebP and deletes the PNG.
3. Commit on a branch, open a PR, and wait for `verify`.

Owner art rules:
- Wire art exactly as drawn. Don't tone, desaturate or recolour it in code.
- No code-drawn props.
- Only wire art whose name matches the rune.

## The runes (112)

"Sets" is where the rune can be offered; "all" means every set. Every one of these can appear in Set 2.

| Rune | Id | Pool | Sets |
|---|---|---|---|
| Action | `rune_action` | Basic | all |
| Adventuring | `rune_adventuring` | Epic | all |
| Aftershocks | `rune_aftershocks` | Basic | set1, set2 |
| Altar | `rune_altar` | Basic | set1, set2 |
| Appraisal | `rune_appraisal` | Epic | set1, set2 |
| Attacking Gems | `rune_attacking_gems` | Epic | set2, set3 |
| Baal | `rune_baal` | Epic | set2 |
| Bartering | `rune_bartering` | Basic | all |
| Blood and Coin | `rune_blood_and_coin` | Basic | set1, set2 |
| Bottomless Cask | `rune_bottomless_cask` | Epic | set2 |
| Brew | `rune_brew` | Basic | set2, set3 |
| Mykel | `rune_brisbane` | Epic | set2 |
| Broodpit | `rune_broodpit` | Epic | set1, set2 |
| Brood | `rune_brood` | Basic | set1, set2 |
| Cadence | `rune_cadence` | Epic | all |
| Champion | `rune_champion` | Epic | all |
| Chimerus | `rune_chimerus` | Epic | set1, set2 |
| Choir | `rune_choir` | Epic | all |
| Chorus | `rune_chorus` | Basic | all |
| Cinder Ledger | `rune_cinder_ledger` | Epic | set1, set2 |
| Conductor | `rune_conductor` | Epic | all |
| Copies | `rune_copies` | Epic | all |
| Copycat | `rune_copycat` | Epic | all |
| Corrupted Tome | `rune_corrupted_tome` | Epic | all |
| Counterpoint | `rune_counterpoint` | Epic | set1, set2 |
| Crown | `rune_crown` | Epic | set1, set2 |
| Crucible | `rune_crucible` | Epic | all |
| Deep | `rune_deep` | Epic | all |
| Distillation | `rune_distillation` | Basic | set2, set3 |
| Double Fisting | `rune_double_fisting` | Epic | set2, set3 |
| Dragonscale | `rune_dragonscale` | Epic | set1, set2 |
| Duplication | `rune_duplication` | Basic | all |
| Enchantment | `rune_enchantment` | Epic | all |
| Engraving | `rune_engraving` | Basic | set2, set3 |
| Epic Forge | `rune_epic_forge` | Basic | all |
| Evolution | `rune_evolution` | Basic | set1, set2 |
| Exgalloper | `rune_exgalloper` | Epic | set2 |
| Facetwright | `rune_facetwright` | Basic | set2 |
| Finality | `rune_finality` | Epic | set1, set2 |
| First Claws | `rune_first_claws` | Epic | set1, set2 |
| First Round | `rune_first_round` | Basic | set2, set3 |
| Flagship | `rune_flagship` | Basic | set2, set3 |
| Food Chain | `rune_food_chain` | Epic | set1, set2 |
| Forthcoming | `rune_forthcoming` | Basic | all |
| Fury | `rune_fury` | Basic | all |
| Gemspam | `rune_gemspam` | Epic | set2 |
| Gilded Spark | `rune_gilded_spark` | Epic | set1, set2 |
| Golden Splinter | `rune_golden_splinter` | Basic | all |
| Guiding Candle | `rune_guiding_candle` | Epic | all |
| Hatchery | `rune_hatchery` | Basic | set1, set2 |
| Herald | `rune_herald` | Epic | all |
| High King | `rune_high_king` | Epic | set2 |
| Hunger | `rune_hunger` | Basic | set2 |
| Hunting Bell | `rune_hunting_bell` | Basic | set1, set2 |
| Infernal Ink | `rune_infernal_ink` | Basic | set1, set2 |
| Inheritance | `rune_inheritance` | Epic | set1, set2 |
| Investment | `rune_investment` | Epic | set2, set3 |
| Kindling | `rune_kindling` | Basic | all |
| Lapidary | `rune_lapidary` | Epic | set2 |
| Lazarus | `rune_lazarus` | Epic | set2, set3 |
| Liquidation | `rune_liquidation` | Epic | set1, set2 |
| Living Echoes | `rune_living_echoes` | Epic | set2 |
| Living Treasure | `rune_living_treasure` | Epic | set2, set3 |
| Long Shift | `rune_long_shift` | Epic | all |
| Lorekeeping | `rune_lorekeeping` | Basic | all |
| Merchant's Chorus | `rune_merchants_chorus` | Basic | all |
| Mirror March | `rune_mirror_march` | Epic | set1, set2 |
| Motherlode | `rune_motherlode` | Epic | set2, set3 |
| Muster | `rune_muster` | Epic | all |
| Overtime | `rune_overtime` | Basic | set2, set3 |
| Packcraft | `rune_packcraft` | Basic | set1, set2 |
| Pair | `rune_pair` | Basic | set1, set2 |
| Quick Study | `rune_quick_study` | Basic | all |
| Rallying | `rune_rallying` | Basic | all |
| Rebirth | `rune_rebirth` | Basic | set1, set2 |
| Recollection | `rune_recollection` | Basic | set2, set3 |
| Recurrence | `rune_recurrence` | Epic | set1, set2 |
| Refrain | `rune_refrain` | Basic | set1, set2 |
| Reinvestment | `rune_reinvestment` | Basic | set1, set2 |
| Resonance | `rune_resonance` | Basic | set2, set3 |
| Runic Exchange | `rune_runic_exchange` | Epic | set2 |
| Savagery | `rune_savagery` | Epic | set1, set2 |
| Scales | `rune_scales` | Epic | set1, set2 |
| Bulk Order | `rune_scale` | Basic | all |
| Scout | `rune_scout` | Basic | all |
| Second Path | `rune_second_path` | Epic | all |
| Shared Table | `rune_shared_table` | Epic | set2, set3 |
| Showcase | `rune_showcase` | Basic | all |
| Slaying | `rune_slaying` | Basic | set1, set2 |
| Small Fortune | `rune_small_fortune` | Basic | set1, set2 |
| Spellslinging | `rune_spellslinging` | Basic | all |
| Spellstone | `rune_spellstone` | Epic | set2 |
| Spending | `rune_spending` | Basic | all |
| Stampede | `rune_stampede` | Basic | all |
| Stormcalling | `rune_stormcalling` | Epic | set1, set2 |
| Summit | `rune_summit` | Basic | set1, set2 |
| Summoning | `rune_summoning` | Basic | set1, set2 |
| Tempered Time | `rune_tempered_time` | Epic | set1, set2 |
| Thrift | `rune_thrift` | Basic | set1, set2 |
| Top Hat | `rune_top_hat` | Basic | set1, set2 |
| Transcription | `rune_transcription` | Basic | all |
| Treasure Map | `rune_treasure_map` | Basic | set1, set2 |
| Trophy | `rune_trophy` | Basic | set1, set2 |
| Twilight | `rune_twilight` | Epic | all |
| Twin Gilding | `rune_twin_gilding` | Epic | all |
| Underdog | `rune_underdog` | Basic | set1, set2 |
| Undertow | `rune_undertow` | Epic | set1, set2 |
| Vanguard | `rune_vanguard` | Epic | set1, set2 |
| Vault | `rune_vault` | Basic | set1, set2 |
| War Chorus | `rune_war_chorus` | Basic | set1, set2 |
| Wheel | `rune_wheel` | Basic | set1, set2 |
| Wild Hunt | `rune_wild_hunt` | Epic | set1, set2 |
