# Versus room: the players are cards (2026-10-16)

Owner ask (Kevin, with a screenshot of the room): "for versus - we want to make the players actually show as cards,
using their portrait art as the minion art, their equipped title and name in the card text, their versus wins as the
attack pill, their versus losses as their health pill. it should use the equipped card plate they have equipped as well".

## What shipped

- `VersusPlayerCard.tsx`: the game's own `Card` (plated, `forceFull`), in the seat holder's card plate via
  `CardPlateContext`. Click / right-click are swallowed (no Inspect). The tribe line is hidden (a player has no tribe).
- `versusSeatCard.ts`: the pure model (`playerCardView`, `seatCardSource`, `playerCardArt`) and the reads
  (`useSeatData`: `versus_records` + a `profiles` read for the live avatar, title and favourite hero, cached per player).
- `VersusRoom.tsx` / `versus.css`: a seated player is a card in front of their painted frame (plate from 4% to 57% of
  the painting, so the ribbon shows under it); the ribbon reads HOST / Player 1 / Player 2; an open seat is unchanged
  (painted frame + Take seat). The seat-portrait mask (`art/versus/seat-mask.webp`) had no other user and is removed.
- `supabase/migrations/2026-10-16-versus-records.sql`: `versus_records(uuid[])`, security definer (it reads
  `auth.users.is_anonymous`), at most 22 ids, returns only `{ userId, wins, losses }`. A match counts only when BOTH
  seats are real accounts (a `profiles` row and a non-anonymous auth user): the first cut counted every match and
  showed the owner 4-25, of which 25 were against anonymous dev/test accounts. No client fallback count (it cannot see
  `auth.users`): until the RPC is live the badges print "-".
- The room card's Attack / Health badges are scaled x1.45 as a whole (`scale`, on `.vspcard-hold` only), owner:
  "the attack badges should be larger".

## Judgement calls

- "Show opponent cosmetics" gates the opponent's plate and hero skin only (the ask named "plate/skin"); their picture,
  title and record always show. The Leaderboard gates the picture and title too; this is deliberately narrower.
- Fallback art: profile picture -> favourite hero in skin -> the default hero (`DEFAULT_HERO_ID`), so a brand-new
  account never shows the Card's tribe-sprite placeholder.
- The opponent's plate comes from the cosmetic snapshot their room profile already carries (the same one the Versus
  combat skins use; `snapshotForRun` includes `cardPlate` and `title`), so no change to `fetchPortraitLoadouts` was
  needed. It is taken when they join, so a plate changed mid-room shows after they rejoin.
- Refresh key: the two seated ids + open/busy + `current_match_id` + the last finished match id.

Oracle: R-VERSUS-PLAYER-CARD-01. Tests: `versusSeatCard.test.tsx`, `versusRecords.db.test.ts`, the room geometry test
now pins `.vspcard` in % of the painting.
