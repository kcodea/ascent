# 2026-10-11 — Announcers are a Collection reward; the first new voice is Lemon

Owner: *"i want to create a new announcer voice - the current one is the default. this will be offered as a reward in
collections"*, *"it will be a Legendary reward players can unlock through opening chests"*, *"call the announcer: Lemon"*.
Oracle rule `R-PROG-ANNOUNCER-01`.

## OWNER RUNBOOK (do these after this PR merges, in this order)

1. **SQL.** Paste `supabase/migrations/2026-10-11-announcer-slot.sql` into the Supabase SQL Editor and Run. It only
   replaces `equip_cosmetic` (adds the `announcer` slot); it writes no rows and is safe to re-run.
2. **Deploy the function** (it carries the catalog, which switches the category on and adds Lemon to the crate pool):
   `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`
3. Until both are done the Announcers tab shows Lemon and plays its sample, but Lemon cannot drop or be equipped.
   Doing 2 without 1 lets Lemon drop but equipping it answers `bad_slot`.

To hear it before you own it: the Collection's "Hear a line" button, or the DEV "Unlock everything" switch, then Equip.

## What shipped

- **The voice.** "Lemon" is the owner's second ElevenLabs clone ("Milk Neatron", voice `1u907ByRAGtDfaOw8FWF`), speaking
  the SAME WORDS as the default announcer: all 297 clips, one per default clip, same file names, in
  `apps/web/public/announcer/lemon/`. Generated with the default announcer's voice settings and levelled to −20 LUFS
  with the card chain, like the default clips (mean −19.9).
- **The words.** 162 lines had text on file (the tracker). The owner's 135 original hand recordings had none, so they
  were transcribed with ElevenLabs Speech to Text and the mishearings corrected by hand ("Draco" → Drakko, "Silas" →
  Sylus, "a pear" → "a pair", "our N Jesus" → RNGesus, "drawers" → draws, "Chimi Changa" → Chimichanga). Three stayed
  as heard because the original could not be made out with certainty: `comeback-win` ("Thank Aeon we won that one"),
  `buy-drakko-4` ("Can we find a shout line?") and `time-running-out-21`. Redo those three if the owner corrects them.
- **Catalog.** `announcer('announcer_lemon', 'Lemon', 'legendary', 'lemon')`; the `announcer` category is switched on.
  Legendary went 37 → 38 items, so each Legendary is 9 / 38 = 0.237% of a first crate (was 0.243%). An announcer has no
  default ITEM: nothing equipped = the default voice, like frames and hero attacks.
- **The slot.** `announcer` joins `EQUIP_SLOTS` and `GLOBAL_EQUIP_SLOTS` (target `''`). The live loadout carries
  `announcer`; `announcerOf(loadout)` resolves it (live items only). It is deliberately NOT in `snapshotForRun` or
  `parseCosmeticSnapshot`: only the wearer hears it, so it never rides a run, a replay or an opponent's seat.
- **Playback.** `announcer.ts` builds a clip URL in one place (`announcerClipUrl(file, pack)`), reads the equipped pack
  through `setAnnouncerPackProvider` (wired in `Game.tsx` to `equippedAnnouncerPack`) at the moment a line speaks, and
  falls back to the default voice's clip when the pack's is missing or fails. Take selection, the no-repeat bag and all
  timing are untouched (the bag is keyed by take name, not URL).
- **Collection.** The Announcers tab is live and keeps the last seat on the rail. The detail panel has a "Hear a line"
  preview (owned or not) that cycles `ANNOUNCER_SAMPLE_LINES` through the Announcer volume and mute, Equip, and
  "Use default announcer". The header total is 227.

## Adding the NEXT announcer

1. Generate every default clip in the new voice into `apps/web/public/announcer/<pack>/` (same file names) and level
   them (`normalizeFile(file, -20)`). `announcer.test.ts` fails if a pack is missing a clip or has an extra one.
2. One line in `cosmetics.ts`: `announcer('announcer_<id>', '<Name>', '<rarity>', '<pack>')`, then
   `npm run progression:shared`, update the pinned counts, merge, deploy `progression-inventory`. No SQL (the slot exists).

## Adding a LINE from now on

Every new default clip needs a copy in every pack folder, or that pack's wearers hear the default voice for that line
(the fallback) and `announcer.test.ts` goes red. The `announcer-lemon` voice in `packages/tools/vo-lines.json` has the
right `dest` for `vo:generate` / `vo:approve`, but its line ids would collide with the default voice's (ids are file
names, unique per manifest), so generate pack lines with a small script instead, as this batch did.
