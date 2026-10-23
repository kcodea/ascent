# Eight emote slots and the five free Comms emotes (2026-10-22)

Owner: "we'll use emotes for quickchat options, then. let's add 4 more emote slots, and give everyone the communication
emotes. i added 5 here: C:\Game Assets\Ascent Art\Emotes\Comms". Then: "give all players the 5 comms emotes for free,
but others im going to continue to add will go into the skins lootboxes". Oracle R-PROG-EMOTE-02 (R-PROG-EMOTE-01 is
marked amended by it).

## What changed

- **Eight positions** (`EMOTE_SLOT_COUNT` 4 -> 8, `EMOTE_POSITION_RE` `^[0-7]$`), shared by the loadout rows, the
  inventory request check (`inventory.ts`, regenerated into `_shared/progressionInventory.ts`), the device layer
  (`ascent.emoteLoadout`, now validated with the same regex via `parseLocalEmotes`) and the SQL (new migration below).
- **The in-game menu** reuses the same `.atip` plate and `.emote-pick` wells, now two rows of four (720 stage px wide,
  112 px tall wells, so it is about as tall as the old two-by-two). On a touch device each pick is at least 48 screen
  px tall (`touchUi.css`). The Collection's slot row already used a 4-column grid; it now wraps to two rows.
- **Five Comms emotes**, Common, each flagged `starter` on its OWN row (no blanket rule; the `emote()` helper still
  defaults to a crate drop, so a future emote lands in the chests unless flagged): `emote_hi` (Hi),
  `emote_good_choice` (Good Choice), `emote_too_nasty` (Too Nasty), `emote_its_beasts` (It's Beasts),
  `emote_lemon_approved` (Lemon Approved). `COMMS_EMOTE_IDS` / `isCommsEmote` name them. Starters are owned by every
  account with no ownership row (`withStarterCosmetics`, the SQL's starter rule) and never enter the crate pool (TS and
  SQL both read only crate items). Tests pin both directions: the free set is exactly Zen Brian + the five, and every
  other live emote is a crate item.
- **Default fill**: positions 1 to 4 stay exactly what the four-slot menu showed (Zen Brian, then owned emotes in
  catalog order), then the Comms emotes, then the rest of the owned emotes. Explicit choices always win. A fresh account
  sees Zen Brian, the five Comms and two empty slots. A player with 4+ owned crate emotes and no explicit choices sees
  four of the five Comms by default (Lemon Approved is the one left off; they can place it in Collections).
- **Collections**: there is no sub-grouping inside a category, so the Comms emotes show as owned Commons, which sort
  first (beside Zen Brian). No "Comms" group was built.
- **Art**: five webps in `packages/ui/src/art/emotes/`, made the 2026-10-15 way (flood-fill key of the black border
  from the edge, keep the largest shape, 1 px feather, trim, 512 px wide, webp q88). `Hi.png`, `it's beasts.png` and
  `lemon approved.png` had black backgrounds (keyed); `Good Choice.png` and `TooNasty.png` had real alpha (trimmed
  only). `assets.master` is `Comms/<filename>`.

## Server (lead), in this order

1. Run `supabase/migrations/2026-10-22-emote-eight-slots.sql` (also appended to `schema.sql`). It only replaces
   `equip_cosmetic` (the card plates version with the emote position check widened to `'^[0-7]$'`); idempotent, writes
   no rows. Run it first: the old function refuses positions 4..7, and the old Edge Function refuses them before they
   reach SQL, so there is no window where one accepts what the other refuses badly.
2. Deploy `progression-inventory` (request check accepts '0'..'7'; its catalog sync writes the five Comms rows as
   `starter`, which the acquisition check has allowed since 2026-10-13). Trigger the sync with any authenticated POST.
3. Optional: redeploy `submit-progression` (it bundles the same generated catalog; nothing it does depends on the
   change, emotes are live-loadout only).

Until 1 and 2 are done, an equip at slots 5 to 8 is kept on the device (the existing fallback) and the Comms emotes
still show (the client treats starters as owned).
