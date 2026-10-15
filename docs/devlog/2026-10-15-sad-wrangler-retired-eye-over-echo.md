# Sad Wrangler retired; the Watcher eye outranks Echo on the medallion (2026-10-15)

Two small owner rulings, one PR.

## 1. "remove the sad wrangler"

- `emote_sad_wrangler` is `active: false` in `packages/progression/src/cosmetics.ts` (and the generated
  `supabase/functions/_shared/progressionCosmetics.ts`), exactly like Angry Mushy: the row is kept, never deleted, so
  the id stays known. Its webp is deleted from `packages/ui/src/art/emotes/`; the master stays in the Game Assets folder.
- It is the **first retired CRATE item** (Angry Mushy was a starter). A player who already OWNS it keeps the
  `player_cosmetics` row, but: the Collection hides it and leaves it out of its counts; the menu skips it (a
  `cosmetic_loadouts` row naming it is ignored by `progression_profile_json`, and the client drops it, refilling the
  position); `equip_cosmetic` refuses it (`not_equippable`); `progression_crate_pool` never offers it (it filters
  `c.active`); a recording of it plays nothing (`emoteOf` is null).
- Crate drop tables need nothing by hand: the pool is computed from the catalog. Rare goes 50 -> 49 items (each
  31 / 49 = 0.633% of a first crate); emotes are 4.6% of a crate. Mad Tormentor stays.
- Tests: `emotes.test.ts`, `emotes.db.test.ts` (a new case: an owner with it equipped, then the retiring sync),
  `cosmetics.test.ts` and `skins.db.test.ts` (their crate-item lists now filter `active`, since a retired crate row
  exists), `CollectionScreen.test.tsx` (an owned Sad Wrangler stays hidden), Collection totals (267 -> 266).
- Oracle R-PROG-EMOTE-01 (4 Rare now), GAME-RULES "Emotes", the 2026-10-15 patch note.

### Server (owner)

1. **Deploy `progression-inventory`.** Its catalog sync writes `active = false` for `emote_sad_wrangler`. No SQL.
2. Optional (bundle parity only): `submit-progression` and `gauntlet-clear` also bundle the catalog copy but never read
   emotes.
3. Nothing to clean up: ownership and loadout rows naming it stay and are ignored.
4. Fresh Netlify build after merge.

## 2. "eye should win > echo"

- After #2104 (granted triggers drive the medallion, R-MEDAL-GRANTED-01), a Watcher given an Echo switched to the Echo
  gem, because Watcher has no text term and sorted last. `resolveMech` (`packages/ui/src/mechIcon.ts`) now has
  `MEDALLION_OUTRANKS = [['watcher', 'echo']]`: when a body has both, Echo leaves the race and the eye runs in the
  better of its own place and Echo's. So a badge that already beat the Echo (a leading Shout) still wins.
- Applies to printed cards too, with no hand-picked exceptions. Printed badges that changed, Echo -> eye: **Sporeling**,
  **Sergey**, **Ashen Heir** (token). **Alchemist Brisbane** (both, plus Shout) keeps its Shout. No other printed minion
  has both. Found by resolving every card in `CARD_INDEX` before and after.
- New approved rule R-MEDAL-EYE-01 (`text.ts`); R-MEDAL-GRANTED-01 points at it. Tests in `mechIcon.test.ts` (the four
  cards + a sweep: nothing with both resolves to Echo) and `grantedMedallion.test.tsx` (Enigma given an Echo keeps
  its eye).
