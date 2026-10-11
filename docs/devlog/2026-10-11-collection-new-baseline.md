# 2026-10-11 — Collection: NEW is saved on the account, and no longer badges everything you own

Owner report (with a screenshot of the Attack Animations tab, the EQUIPPED item wearing NEW): "whenever i load the
game, all of my stuff that i already own shows up as 'new' how can we fix this?" Then, after a device-only fix was
opened: "i want to save the 'seen' on the account level, though".

## Root cause

Not a wipe. The seen list (`ascent.collection.seen.<userId>`) was `localStorage` only, so it was per browser ORIGIN:
every dev port, the web build and the desktop app each kept their own. It started EMPTY, and the only thing that
ever added to it was a click on one owned tile. So any address that had not been clicked through badged the whole
collection, and clearing it cost one click per item. Nothing treated "equipped" as seen either.

## The fix

**The list lives on the account.** `supabase/migrations/2026-10-11-cosmetics-seen.sql`:

- `player_cosmetics.seen_at` (null = owned, not looked at yet). Every existing writer inserts without it, so a new
  unlock is unseen with no change to `settle_progression` / `open_crate` / the gauntlet grant.
- The first run marks everything owned so far as seen (guarded by the column not existing, so a re-run of the file,
  or of `schema.sql`, never swallows later finds).
- `mark_cosmetics_seen(p_ids)`: `security definer`, `auth.uid()`, only ever sets a null `seen_at` on the caller's own
  rows. Clients still have no way to write the table directly (RLS has a read policy only).

**The client** (all under `packages/ui/src/progression/`):

- `progressionRemote.ts`: `fetchSeenCosmeticIds` (the ids with a seen time) and `markCosmeticsSeenRemote`.
- `progressionStore.ts`: `refreshSeenList` runs with the probe; `markCosmeticsSeen` writes the device copy at once
  and the account when the server holds the list, sending each id once and again later if the write failed.
  `seenKnown` is the reactive answer the page lays over its snapshot.
- `collectionSeen.ts`: the device's COPY (so badges draw before the server answers, and offline) and the marker that
  says this device has been told what the account has seen.
- `CollectionScreen.tsx`: clear on view (the open tab is marked seen while you look; the page draws from a snapshot,
  so the badges stay for the visit), a pick clears at once, the equipped item never wears NEW, and no badge at all
  until the device knows what the account has seen.
- **Mark all as seen** (owner: "we should also create a button that 'Marks all as seen'. when a player clicks that,
  all 'new' pills go away"): a quiet button in the header beside the meters, only while something is NEW. It marks
  everything owned on every tab (one write to the account) and, unlike the view effect, updates the snapshot too, so
  the badges leave at once. Placement was my call (the filter row is full and the tab row is a fixed grid); move it
  if it reads wrong.

## Three traps worth remembering

1. **An empty list is "not asked yet", not "nothing seen".** That misreading was the whole bug. The page now shows no
   NEW badge until the device has an answer (`hasSeenBaseline` or `seenKnown`).
2. **"Unsupported" must be a definite answer.** Only an undefined column / table code means "the server is from
   before the migration, keep the list on the device and take a baseline". A timeout or any other error is "could
   not ask" and changes nothing. Guessing would let a device mark the whole collection seen over the account's list.
3. **The snapshot is re-read during RENDER, not in a mount effect.** Under StrictMode's effect re-run (the dev build)
   a mount effect lands after the clear-on-view effect and wipes the open tab's badges as the page opens. Likewise
   the ids a write confirmed are kept in a NON-reactive set, so a badge you are looking at does not vanish because
   its write landed.

## The migration is live

The owner ran `supabase/migrations/2026-10-11-cosmetics-seen.sql` on 2026-10-11, before this merged. Checked from
outside with the public key: the column answers, zero owned items were left unseen (the baseline took), and the
function refuses a signed-out caller. Order never mattered: against a database from before the file the client gets
"undefined column" and keeps the list per device with a one-time baseline. Nothing to deploy (no Edge Function).

Oracle: `R-PROG-COLLECTION-05`. Tests: `CollectionScreen.test.tsx` ("the Collection screen: NEW"),
`cosmeticsSeenRemote.test.ts`, `progressionStore.test.ts`, and the SQL executed in
`packages/progression/src/cosmeticsSeen.db.test.ts`.
