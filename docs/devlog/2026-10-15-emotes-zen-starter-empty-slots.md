# Zen Brian is everyone's; the emote menu always shows four slots (2026-10-15)

Owner, after #2099 merged: "all emotes are crate only except give all players the zen brian emote and show the empty
emote slots so it's obvious they have empty slots".

## What changed

- **Zen Brian is the one starter again** (`cosmetics.ts`: `acquisition: starter`, rarity common, first emote in
  catalog order). Every account owns it with no ownership row, guests included, and it leaves the crate pool. Every
  other emote stays crate-only. Crate maths: Rare 51 -> 50 items (each 31 / 50 = 0.62%); emotes are 5.3% of a crate.
- **No grandfathering.** `supabase/migrations/2026-10-15-emotes-grandfather.sql` (from #2099, never applied) is deleted.
  Flirty Midas and Nervous Jensen are crate drops for everyone.
- **The menu always draws four slots.** `EmoteLayer` renders `useEmoteSlots()` by position: an emote is a pick button;
  an empty position is `EmptyEmoteSlot` (new, `packages/ui/src/emotes/EmptyEmoteSlot.tsx`): the game's empty-slot
  frame (the faint dashed outline of an empty Career tile), a muted "Empty", not clickable, `aria-disabled`, and the
  game's `.gtip` hover bubble "Empty slot. Find more emotes in crates." (no native title). The "No emotes yet" line and
  its CSS are gone. A fresh account sees Zen Brian plus three empty slots.
- **The Collection shows the same four slots** on an emote's page (`EmoteSlotRow` in `CollectionScreen.tsx`), replacing
  the "Slot 1..4" chips: each slot shows its bubble or the empty frame, numbered. With an owned emote selected, each
  slot is a button that puts it there (the one holding it is ringed); with an emote you do not own, the row is
  read-only and the empty slots carry the crates hint.
- Tests: `emotes.test.ts`, `emotes.db.test.ts` (Zen Brian equips with no ownership row; the #2099 catalog -> current
  sync makes it a starter with no SQL), `cosmetics.test.ts` (odds), `ui/emotes/emotes.test.tsx` (four slots, three
  empty), `CollectionScreen.test.tsx` (the slot row, owned and read-only), Collection totals (+1 owned).
- Oracle R-PROG-EMOTE-01, GAME-RULES "Emotes", the 2026-10-15 patch note's details.

## Server (owner)

1. **Deploy `progression-inventory`.** Its catalog sync rewrites `emote_zen_brian` to `acquisition_source = 'starter'`,
   rarity common (the sync updates both on existing rows), so `equip_cosmetic` treats it as owned and
   `progression_crate_pool` stops offering it. No SQL: the acquisition check has allowed `starter` since 2026-10-13.
2. Nothing to clean up. A player who already opened Zen Brian from a crate keeps a harmless ownership row. If the
   withdrawn grandfather file was ever run by hand, its `starter_grandfather` rows still grant Flirty Midas and
   Nervous Jensen; say if those should be removed.
3. Fresh Netlify build after merge.
