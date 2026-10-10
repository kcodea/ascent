# 2026-10-10 · Kobold / Ruby balance batch

Owner balance batch, Kobold + Ruby slice (14 cards). The cards are shared, so Set 2 and Set 3 both change.

## What changed

| Card | Before | After |
|---|---|---|
| Veinstorm | Shop minions permanently get Ruby stats | ALSO casts a Ruby on every friendly minion (minions first, then the Shop) |
| Facetwright | +1 Attack / +1 Health | +2 Attack / +2 Health |
| Storm Chaser | Shout: get a Veinstorm | Shout: Cast Veinstorm (gilded twice) |
| Scrapper | Echo: Rubies +1 Attack | Echo: Rubies +1/+1 |
| Ruby Mender | Shout: Rubies +1 Health | +2 Health |
| Prospector | Shout: get 2 Rubies | get a random Ruby (gilded 2) |
| Beggy | Sell: get 2 Rubies | get a random Ruby (gilded 2) |
| Cave Cutter | +1/+1 or 4 Rubies | +2/+2 or 4 random Rubies (gilded +4/+4 or 8) |
| Gemling | EoT: get a Veinstorm | EoT: Cast Veinstorm 3 times (gilded 6), one beat per cast |
| Crownvein | Rally: Rubies +1/+1 | +2/+3 (+ new art) |
| Portsmith | Avenge (3): +1/+1 and a Kobold | +2/+2 and 2 Kobolds |
| Cavern Fiend | Consume a random Shop minion | Consume the highest-Health Shop minion |
| Tunneller Rik | Rally: get 3 Rubies | get 2 random Rubies |
| Kobe | Taunt | Taunt + Ward |

## New parameters (no new factories)

- `spellBuffShopByRuby { minions: true }`: Veinstorm first casts the same Ruby (same value, spell power folded per
  the 2026-08-26 ruling) on every friendly minion, then gems the Shop. Kept inside the one factory so both halves
  share one printed value; a separate `spellPlayRubiesAll` would have printed one number for two different values.
- `castSpell { times: N }`: N casts, each its own End-of-Turn tick (`eotTickCount`). Gilding doubles the TICKS
  here (not the casts per tick, unlike Rope Wrangler's `perGold`), because the owner asked for a beat per cast.
  `eotTickCount` / `endOfTurnTicksOf` take the caster's `golden` so the commit, projection and beat list agree.
- `rallyGetRubies { random: true }` (arena, both phases) and `onSellGetRubies { random: true }` route through the
  random-Ruby mint.
- `rubyCastConsumeShop { pick: 'highestHealth' }`: uses the shared `pickShopMinionFor` (ties right-most, Starform
  excluded); no RNG drawn.

## Judgement calls

- Storm Chaser rides `battlecryCastNamedSpell` (Shardluck's path). It is now a top-level Shout, so R-REALTIME-03 made
  it choose: it joined `SHOP_ONLY_SHOUTS` (a combat re-fire logs its line, the whole Veinstorm cast lands once at
  settle). The alternative, a live combat half for the minion Rubies plus a deferred Shop half, would split one
  spell across two phases. Owner to confirm.
- Gilded Gemling = 6 ticks of one cast each, not 3 ticks of two.

## Side fixes

- Doc Bot beat conservation: a body RETURNED from board to hand (Second Draft) keeps its uid; its `cardGranted` is
  a real arrival, not a phantom. The builder sweep only reached it because Gemling joined the End-of-Turn cast plants.
- Re-pinned tests (numbers moved with the cards): rubies, rubyTypes, runeBatchAug19, runeFacetwrightDuplication,
  set2Dragons, set2NewMinionsAug18, set3RunesBatch3 (Veinstorm's own Ruby added to the Red Storm counts), spellBatch,
  chooseOneFlow, ownerRulings20260826, liveRubyPower, liveMidCombatTriggers, detectCardKeywords, reworks0918
  (Livewire's fixture spell swapped to Golden Ale), seatRunner (generated card moved to the archived Wardstone
  Jeweler), packages census, entryPaths unstaged queue (+ Golden Ruby), combatShoutsRealtime Shop-only list.
