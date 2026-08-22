# 2026-08-21 — Fi & Coran walk the road: the hero-quest system

Owner rework: both heroes' powers are replaced outright. Fi's turn-4 Errand and Coran's turn-10 Pathfinder
are gone; each now opens the run on a **turn-1 two-option Discover** from their **own private quest list**,
and every one of those quests shares a single objective — **`journey`**, the "steps down the road" counter:
**+1 per minion played from hand, per spell cast, per Shop upgrade** (owner call 2026-08-21: tier-ups count,
combat kills do not). The quests differ only in how many steps and what waits at the end.

## The ten quests (owner's numbers, verbatim)

| Hero | Quest | Steps | Reward |
| --- | --- | --- | --- |
| Fi | Gilded Favor | 12 | a Goldcrafter |
| Fi | Open Road | 16 | Tier 7 unlocked this game |
| Fi | Spare Forge | 18 | a random Basic Rune, immediately |
| Fi | Opening Act (×3 variants) | 23 | first Shout / Echo / Rally each round triggers again |
| Fi | First Pick | 26 | first shop minion each turn is free |
| Coran | Summit Passage | 28 | Tier 7 unlocked **and** a free Shop tier |
| Coran | Runic Passage | 30 | a random Epic Rune, immediately |
| Coran | Gilded Shortcut | 38 | Gild at 2 copies |
| Coran | Resonant Path (×3 variants) | 44 | Shouts / Echoes / Rallies **always** trigger again |
| Coran | Merchant's Road | 46 | shop minions cost 2 Gold |

Opening Act and Resonant Path are each **three quests wearing one name** (a Shout, an Echo and a Rally
variant, `variantGroup`), and the offer generator takes **at most one per family** — the owner's "you can
never have more than one Opening Act offered". A 400-seed sweep pins that every variant stays reachable.

## How it rides the existing quest system

Almost everything is the machinery that already existed: the offer is a normal `questOffer` (so it inherits
the modal guard, the picker UI and `buyQuest` untouched), progress lives in `ActiveQuest`, rewards run
through `applyQuestReward`, and the badge row shows the live `x / N` beside the hero. What's new:

- **`heroQuest` on `QuestDef`** fences the two lists off in *both* directions — the universal turn-5/11 pool
  filters hero quests out, and the hero offer draws only its own.
- **The offer is minted in `createRun`**, not the turn advance — turn 1 never passes through an advance, so a
  wave-1 branch in `questOfferPlan` alone would silently never fire.
- **`journey` ticks** sit on existing seams: the `castSpell` delta (so a double-cast is two steps, exactly as
  spell quests count it), the `play` tick **narrowed to minions** (a spell reaches the reducer as a `play`
  too — unnarrowed it would double-count), and the `upgrade` case.
- **Five new reward kinds**: `grantRune` (applies through the same path a *bought* rune takes, so a granted
  rune is indistinguishable downstream), `freeFirstBuy` (shares the Freedom rift's spend-marker — owning both
  is still one freebie), `tier7Access`, `gildCopies` (read via `gildCopiesNeeded`, joining Midas + Twin
  Gilding), and `upgradeShopTier` (the `payCommission` citadel idiom; ordered after the unlock inside Summit
  Passage's `multi` so the free step can reach 7).

## A latent gap this surfaced

`tier7Access` opened Tier-7 **Discovers** but the `upgrade` case still clamped the ladder at
`maxTierFor(s.rift)` — so "Tier 7 is unlocked this game" would have meant only half of what it says. The
upgrade ceiling now reads `hasTier7Access` too.

The retired `lesserQuest` / `pathfinder` power kinds and their `questOfferPlan` branches are **kept** so
pre-rework saves and replays still resolve their turn-4/10 offers exactly as recorded.

## Verification

- `heroQuests.test.ts` (14 cases): offer shape/scoping/variant exclusion across hundreds of seeds, all three
  journey sources (+ buy/sell/roll *not* counting), and every reward landing — including the ladder climb to 7.
- Live in the browser: Fi's turn-1 Quest Shop renders both options with the travel text, picking activates,
  and the first play ticks the hero badge to 1/16.
- Old tests asserting the retired powers rewritten; the runes pivot-discount test moved off Coran (his
  turn-1 modal now blocks the advance it drives — it only ever needed "a hero without a forge").
- Gates: typecheck ✅ · lint 0 errors ✅ · 6527 tests ✅ · build:web ✅
