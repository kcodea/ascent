# 2026-11-25: Game Breaker, Cassen, Chimerus

Owner: "Cassen - remove max gold for completing a commission", "chimerus - add "different" so that it cannot buff another chimerus or
itself", and "add a unique title not earnable called Game Breaker. it should be yellow and green with a lemon leaf eclipsing the corner".

- **Cassen** (R-CASSEN-03): `COMMISSION_MAX_GOLD` is gone from the payout and from every text. Max Gold already earned in a run stays.
- **Chimerus** (R-TARGET-CHIMERUS-01): `rallyGiveHealthToDragons` takes `excludeId`, the same channel Lieutenant Thane uses for "different".
- **Game Breaker** (R-PROG-TITLE-GIFT-01): the first gift-only title. `acquisition: { type: 'event', id: 'gift' }`, Secret rarity (hidden until
  owned), look `lemon`. The first look (a drawn lemon) was "super cliparty": it is now the normal pill in satin yellow in a green frame, with one
  leaf. The leaf leaves the box, so it is the only look with `overflow: visible`, and its light sweep runs in its own clipped layer (`tb-shine`)
  behind the letters. The gift notice now shows any plated title as its badge.

## Granting it

After `progression-inventory` is deployed (the catalog row must exist) AND the release that carries the look is out:

```sql
insert into public.player_cosmetics (user_id, cosmetic_id, source, source_id)
values ('<user id>', 'title_game_breaker', 'gift', 'owner:2026-11-25')
on conflict (user_id, cosmetic_id) do nothing;
```

The notice shows on the menus the next time that account loads the game.
