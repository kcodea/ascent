# 2026-10-28: The Secret rarity and the Plushie Plate

The owner made a Plushie card plate (2026-10-27) and asked for it to be "a secrete unlock that the players are given once
they unlock every Plushie Beast cosmetic", not shown with the other plates, behind a new achievement whose reward reads
"Unique Card Plate Only Available From Completing This Achievement". Then: "wont it have its own category as \"Secret\"?
we can make it Red, over Ancient. Should ONLY show up once you unlock it". Answers to the follow-up questions: visible
with a progress bar, and a player who already earned it keeps it when a new Plushie Beast is added.

Rule: R-PROG-SECRET-01.

## What shipped

- **The Secret rarity** (`SECRET_RARITY`, `CosmeticRarity = CrateRarity | 'secret'`): red (`.r-secret`), labelled
  "Secret", ranked above Ancient. `COSMETIC_RARITIES` stays the five-rung CRATE ladder (`CrateRarity`), so the odds, the
  roll, the chest tiers and the SQL pick are unchanged; `ALL_COSMETIC_RARITIES` is the display list.
- **The Collection hides an unowned Secret item** (`albumOf`): not in the album, any count, or the collected total.
  Owned, it leads its album with its own Secret rarity chip and a red breathing glow (opacity only).
- **The Plushie Plate** (`plate_plushie`): Dark interior, `frameX 0.008`, `interiorSx 0.983`, `interiorSy 0.958`,
  `interiorY -0.0075` (its window is narrower than Galaxy's). Acquisition `achievement`, never in a crate.
- **Collections**: `CosmeticDef.collection` tags the 24 Plushie Beast skins (`PLUSHIE_BEAST_SKIN_IDS`; a test fails a
  "Plushie" minion skin left out). The sync sends it as `collectionId`.
- **The Plushie Collector achievement** (`collection.plushie_beasts`, the new Collection category): target = the
  collection's size (24), metric `collectionOwned`, no XP, `rewards.cosmeticId = plate_plushie`. The tile shows the
  reward line instead of an XP chip.

## The server (2026-11-03-secret-plushie-plate.sql)

- Widens the rarity check to six, adds `cosmetic_catalog.collection_id`, and replaces `sync_cosmetic_catalog` to write it.
- `progression_refresh_collection(user, collection)` recounts owned active members, writes the progress, completes it
  (0 XP) when all are owned, and grants the `achievement` items keyed to it. A trigger on `player_cosmetics` runs it for
  every granted collection item, whatever granted it. A changed catalog sync recounts everyone, which is also the
  backfill: the first sync after the deploy credits players who already own all 24.
- A guard trigger drops any other write to a `collection.%` achievement's progress or completion, so a client naming
  `collectionOwned` in a game's metrics moves nothing (`settle_progression` reads metrics it does not know as given).
- Re-running 2026-10-02-ancient-rarity.sql's section 0 now fails (its five-rarity check rejects the Secret item); the
  file header says so.

## Owner runbook

1. Run `supabase/migrations/2026-11-03-secret-plushie-plate.sql` in the SQL Editor.
2. Then deploy `progression-inventory` (the sync sends the Secret item, which the old check rejects, so SQL first).
3. The art ships with the next web release.

## Calls made without an owner ruling

- The achievement is named **Plushie Collector** and pays no XP (the plate is the reward).
- It lives in a new **Collection** achievement category.
- The Secret chip's gem is a heart.
