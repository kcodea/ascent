# Dad Kobebe (skins batch 21) and the gift notice (2026-11-13)

Owner: "i just added Dad Kobebe to the ancient mi nion skin folder. add this to the game, and give Ionlime the cosmetic.
have an alert next time he loads up the game".

## The skin

`skin_kobabyboldies_3`, Dad Kobebe, an Ancient skin for Kobebes (`k_kobabyboldies`), master `Ancient/Dad Kobebe.png`.
A crate item, like every other file in the rarity folders. Ancient items in a first crate: 38 (each 0.079%).
Rule R-PROG-SKINS-29.

## Gifts

There was no way to hand one account an item, and nothing that told a player they had been given one. Now:

- **A gift is an ownership row with `source = 'gift'`.** No schema change: `player_cosmetics.source` is free text.
- **The client reads the account's unseen gifts with the progression probe** (`fetchUnseenGiftIds`: source gift,
  `seen_at` null) and `GiftNotice` shows them once on the menus. Closing it calls `markCosmeticsSeen`, so the account's
  seen list is the "already announced" marker, on every device.
- Rule R-PROG-GIFT-01, pinned by `GiftNotice.test.tsx`.

### Granting (manual, for now)

After `progression-inventory` is deployed (the catalog row must exist first), in the Supabase SQL editor:

```sql
insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
values ('<user id>', 'skin_kobabyboldies_3', 'gift', 'owner:2026-11-13')
on conflict (user_id, cosmetic_id) do nothing;
```

The pop-up needs a client build that has the notice. On an older build the item still arrives and wears the Collection's
NEW badge, but nothing pops up; and if the player opens the Minions tab there first, the item is marked seen and the
pop-up never shows. So grant AFTER the release that carries this change.

## Open for the owner

- Should Dad Kobebe be gift-only (never in a chest)? It is a chest item today.
- The pop-up has not been seen in the running game yet.
